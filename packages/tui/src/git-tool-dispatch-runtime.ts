/**
 * git-tool-dispatch-runtime.ts — D.14G-Refactor-Closure
 *
 * 把 D.14G 的结构化 Git 工具执行 glue 从 index.ts 迁出。职责：
 *   model tool_call → git-operation-runtime → evidence/event/tool_result/主屏摘要。
 *
 * 设计原则：
 * - **不 value import ./index.js**；需要 TuiContext 只 `import type`。
 * - 需要 index-owned 的运行时 helper（startRequestActivity / appendSystemEvent /
 *   createEvidenceRecord / recordToolEvidence / appendDeferredToolResultEvent 等）时
 *   一律走 `GitToolDispatchDeps` 注入，不制造运行时环。
 * - 真实 git 操作仍在 git-operation-runtime.ts；本模块只编排 + 写事件/evidence + 摘要。
 * - 行为与 D.14G 完全一致（行为保持的结构化拆分，不改用户可见行为）。
 */

import type { Writable } from "node:stream";
import type { ModelToolCall } from "@linghun/providers";
import type { ToolName, ToolOutput } from "@linghun/tools";
import {
  type StablePointOutcome,
  type WorktreeCreateOutcome,
  type WorktreeRemoveResult,
  computeWorktreeContext,
  createGitStablePoint,
  createManagedWorktree,
  defaultStablePointMessage,
  executeManagedWorktreeRemove,
  planManagedWorktreeRemove,
  validateStablePointMessage,
} from "./git-operation-runtime.js";
import { readGitStatus, readWorktreeList } from "./git-runtime.js";
import {
  GIT_STABLE_POINT_CREATE,
  GIT_STATUS_INSPECT,
  MANAGED_WORKTREE_CREATE,
  parseStablePointInput,
  parseWorktreeCreateInput,
  parseWorktreeRemoveInput,
  summarizeStablePointOutcome,
  summarizeWorktreeContextForPrompt,
  summarizeWorktreeCreateOutcome,
  summarizeWorktreeRemovePlan,
} from "./git-tool-runtime.js";
import type { PendingModelContinuation, TuiContext } from "./index.js";
import type { CheckpointState, EvidenceRecord } from "./tui-data-types.js";

export type GitToolResult = {
  ok: boolean;
  tool: string;
  text: string;
  data?: unknown;
  evidenceId?: string;
  pendingApproval?: boolean;
};

export type StablePointRunResult = {
  ok: boolean;
  text: string;
  evidenceId?: string;
  outcome: StablePointOutcome | "snapshot_only";
};

export type WorktreeCreateRunResult = {
  ok: boolean;
  text: string;
  evidenceId?: string;
  outcome: WorktreeCreateOutcome;
};

export type WorktreeRemoveExecuteResult = {
  ok: boolean;
  text: string;
  evidenceId?: string;
  result: WorktreeRemoveResult;
};

/**
 * index-owned 运行时 helper 注入。保持与 index.ts 既有实现完全一致的行为；
 * 本模块不复制这些 helper，只编排调用顺序。
 */
export type GitToolDispatchDeps = {
  maxCheckpoints: number;
  startRequestActivity: (
    output: Writable,
    context: TuiContext,
    phase: "tool_running",
    values: { toolName?: string },
  ) => void;
  clearRequestActivity: (context: TuiContext) => void;
  writeLine: (output: Writable, text: string) => void;
  formatError: (error: unknown, language: TuiContext["language"]) => string;
  appendSystemEvent: (
    context: TuiContext,
    sessionId: string,
    message: string,
    level: "info" | "warning",
  ) => Promise<void>;
  createEvidenceRecord: (
    kind: EvidenceRecord["kind"],
    summary: string,
    source: string,
    supportsClaims: string[],
  ) => EvidenceRecord;
  rememberEvidence: (context: TuiContext, evidence: EvidenceRecord) => void;
  recordToolEvidence: (
    context: TuiContext,
    sessionId: string,
    name: ToolName,
    output: ToolOutput,
    input?: unknown,
  ) => Promise<EvidenceRecord | null>;
  recordToolFailureEvidence: (
    context: TuiContext,
    sessionId: string,
    name: ToolName,
    summary: string,
  ) => Promise<EvidenceRecord>;
  appendDeferredToolResultEvent: (
    context: TuiContext,
    sessionId: string,
    toolUseId: string,
    dispatchName: string,
    content: unknown,
    isError: boolean,
    evidenceId?: string,
  ) => Promise<void>;
  createSingleToolCallContinuation: (
    continuation: PendingModelContinuation,
    toolCall: ModelToolCall,
  ) => PendingModelContinuation;
  randomUUID: () => string;
  resolvePath: (...segments: string[]) => string;
  readFileUtf8: (path: string) => Promise<string>;
};

// git_operation evidence：仅在真实 runtime 成功执行后写入，supportsClaims 含
// git_operation + 具体操作标签，被 D.13U final-answer gate 识别，防止模型空口
// 声称“已建立稳定点/已创建 worktree/已删除 worktree”。
async function recordGitOperationEvidence(
  deps: GitToolDispatchDeps,
  context: TuiContext,
  sessionId: string,
  operation: string,
  summary: string,
  extraClaims: string[],
): Promise<EvidenceRecord> {
  const evidence = deps.createEvidenceRecord(
    "command_output",
    `git_operation ${operation}: ${summary}`,
    `git-operation:${operation}`,
    ["git_operation", operation, ...extraClaims],
  );
  deps.rememberEvidence(context, evidence);
  await context.store.appendEvent(sessionId, {
    type: "evidence_record",
    ...evidence,
  });
  return evidence;
}

// system_event：结构化 git 事件，不含 secrets / 大输出 / 完整 env；用于 transcript 审计。
export async function appendGitOperationEvent(
  deps: GitToolDispatchDeps,
  context: TuiContext,
  sessionId: string,
  fields: Record<string, unknown>,
  level: "info" | "warning",
): Promise<void> {
  const safe = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join("; ");
  await deps.appendSystemEvent(context, sessionId, safe, level);
}

// 在 git 稳定点前创建 Linghun snapshot checkpoint 作为本地安全垫（非 git repo 也用它）。
async function createSnapshotStablePoint(
  deps: GitToolDispatchDeps,
  context: TuiContext,
  sessionId: string,
  reason: string,
): Promise<CheckpointState> {
  const status = await readGitStatus(context.projectPath);
  const changedFiles =
    status.kind === "ok"
      ? [...status.staged, ...status.unstaged, ...status.untracked].slice(0, 50)
      : [];
  const checkpoint: CheckpointState = {
    id: deps.randomUUID(),
    sessionId,
    createdAt: new Date().toISOString(),
    reason,
    changedFiles,
    restoreKind: "snapshot",
    files: [],
  };
  for (const file of changedFiles) {
    const target = deps.resolvePath(context.projectPath, file);
    try {
      checkpoint.files.push({
        path: file,
        existed: true,
        content: await deps.readFileUtf8(target),
      });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        checkpoint.files.push({ path: file, existed: false });
        continue;
      }
      // 安全垫读取失败不阻断稳定点；记录文件名但不带内容。
      checkpoint.files.push({ path: file, existed: false });
    }
  }
  context.checkpoints.unshift(checkpoint);
  context.checkpoints = context.checkpoints.slice(0, deps.maxCheckpoints);
  await context.store.appendEvent(sessionId, {
    type: "checkpoint_created",
    checkpoint: {
      id: checkpoint.id,
      sessionId: checkpoint.sessionId,
      createdAt: checkpoint.createdAt,
      reason: checkpoint.reason,
      changedFiles: checkpoint.changedFiles,
      restoreKind: checkpoint.restoreKind,
    },
    createdAt: checkpoint.createdAt,
  });
  return checkpoint;
}

export async function executeGitToolUse(
  toolCall: ModelToolCall,
  context: TuiContext,
  sessionId: string,
  output: Writable,
  deps: GitToolDispatchDeps,
  continuation?: PendingModelContinuation,
): Promise<GitToolResult> {
  deps.startRequestActivity(output, context, "tool_running", { toolName: toolCall.name });
  await context.store.appendEvent(sessionId, {
    type: "tool_call_start",
    id: toolCall.id,
    name: toolCall.name as unknown as ToolName,
    input: toolCall.input,
    createdAt: new Date().toISOString(),
  });
  try {
    if (toolCall.name === GIT_STATUS_INSPECT) {
      return await runGitStatusInspectTool(toolCall, context, sessionId, output, deps);
    }
    if (toolCall.name === GIT_STABLE_POINT_CREATE) {
      return await runStablePointTool(
        toolCall,
        context,
        sessionId,
        output,
        deps,
        parseStablePointInput(toolCall.input),
        continuation,
      );
    }
    if (toolCall.name === MANAGED_WORKTREE_CREATE) {
      return await runWorktreeCreateTool(toolCall, context, sessionId, output, deps);
    }
    // ManagedWorktreeRemove
    return await runWorktreeRemoveTool(toolCall, context, sessionId, output, deps, continuation);
  } catch (error) {
    deps.clearRequestActivity(context);
    const text = deps.formatError(error, context.language);
    const evidence = await deps.recordToolFailureEvidence(
      context,
      sessionId,
      "Read",
      `${toolCall.name}: ${text}`,
    );
    await deps.appendDeferredToolResultEvent(
      context,
      sessionId,
      toolCall.id,
      toolCall.name,
      text,
      true,
      evidence.id,
    );
    return { ok: false, tool: toolCall.name, text, evidenceId: evidence.id };
  }
}

async function runGitStatusInspectTool(
  toolCall: ModelToolCall,
  context: TuiContext,
  sessionId: string,
  output: Writable,
  deps: GitToolDispatchDeps,
): Promise<GitToolResult> {
  const status = await readGitStatus(context.projectPath);
  const worktrees = await readWorktreeList(context.projectPath);
  const worktreeContext = await computeWorktreeContext(context.projectPath);
  const summary =
    status.kind === "ok"
      ? `branch=${status.branch ?? "(detached)"}; changed=${status.changedCount}; untracked=${status.untrackedCount}; head=${status.headShort ?? "?"}`
      : status.kind === "not_a_git_repo"
        ? "not a git repository"
        : `git unavailable: ${status.error}`;
  const data = {
    status:
      status.kind === "ok"
        ? {
            branch: status.branch,
            head: status.headShort,
            changedCount: status.changedCount,
            untrackedCount: status.untrackedCount,
            ahead: status.ahead,
            behind: status.behind,
          }
        : { kind: status.kind },
    worktree: summarizeWorktreeContextForPrompt(worktreeContext),
    worktreeCount: worktrees.kind === "ok" ? worktrees.entries.length : 0,
  };
  // 只读探测：用 file_read 类 evidence 即可（不写 git_operation，避免被当成 mutating 证据）。
  const evidence = await deps.recordToolEvidence(context, sessionId, "Read", {
    text: `GitStatusInspect: ${summary}`,
    data,
  } as ToolOutput);
  await deps.appendDeferredToolResultEvent(
    context,
    sessionId,
    toolCall.id,
    toolCall.name,
    { text: summary, data },
    false,
    evidence?.id,
  );
  deps.clearRequestActivity(context);
  deps.writeLine(
    output,
    context.language === "en-US" ? `Git status: ${summary}` : `Git 状态：${summary}`,
  );
  return { ok: true, tool: toolCall.name, text: summary, data, evidenceId: evidence?.id };
}

async function runStablePointTool(
  toolCall: ModelToolCall,
  context: TuiContext,
  sessionId: string,
  output: Writable,
  deps: GitToolDispatchDeps,
  input: { message?: string; includeUntracked?: boolean },
  continuation?: PendingModelContinuation,
): Promise<GitToolResult> {
  // D.14D-R2 P1-1/R2 fix — 模型工具创建 stable point 是写仓库状态：
  // default/auto-review 先确认，plan 直接拒绝，full-access 直接执行。slash
  // /git stable create 是显式用户动作，不经此模型工具路径，确认语义不受影响。
  if (context.permissionMode === "plan") {
    deps.clearRequestActivity(context);
    const text =
      context.language === "en-US"
        ? "stable point was NOT created because Plan mode is read-only."
        : "stable point was NOT created because Plan mode is read-only. 稳定点未创建：计划模式只读。";
    const evidence = await deps.recordToolFailureEvidence(
      context,
      sessionId,
      "Read",
      `GitStablePointCreate denied: ${text}`,
    );
    await appendGitOperationEvent(
      deps,
      context,
      sessionId,
      {
        operation: "stable_point_denied",
        createdAt: new Date().toISOString(),
        project: context.projectPath,
        includeUntracked: Boolean(input.includeUntracked),
        result: "plan_read_only",
      },
      "warning",
    );
    await deps.appendDeferredToolResultEvent(
      context,
      sessionId,
      toolCall.id,
      toolCall.name,
      { text, ok: false, outcome: "plan_read_only" },
      true,
      evidence.id,
    );
    deps.writeLine(output, text);
    return { ok: false, tool: toolCall.name, text, evidenceId: evidence.id };
  }
  if (context.permissionMode !== "full-access") {
    deps.clearRequestActivity(context);
    context.pendingLocalApproval = {
      kind: "git_stable_point",
      sessionId,
      message: input.message,
      includeUntracked: input.includeUntracked,
      continuation: continuation
        ? deps.createSingleToolCallContinuation(continuation, toolCall)
        : undefined,
      toolCall,
    };
    const summaryText =
      context.language === "en-US"
        ? "Confirm creating a stable point (git commit / snapshot) for the current workspace."
        : "确认为当前工作区创建稳定点（git commit / snapshot）。";
    await appendGitOperationEvent(
      deps,
      context,
      sessionId,
      {
        operation: "stable_point_requested",
        createdAt: new Date().toISOString(),
        project: context.projectPath,
        includeUntracked: Boolean(input.includeUntracked),
        result: "pending_confirmation",
      },
      "info",
    );
    if (!context.isInkSession) {
      deps.writeLine(output, summaryText);
    }
    return { ok: false, tool: toolCall.name, text: summaryText, pendingApproval: true };
  }
  const result = await performStablePoint(context, sessionId, input, deps);
  deps.clearRequestActivity(context);
  await deps.appendDeferredToolResultEvent(
    context,
    sessionId,
    toolCall.id,
    toolCall.name,
    { text: result.text, ok: result.ok },
    !result.ok,
    result.evidenceId,
  );
  deps.writeLine(output, result.text);
  return { ok: result.ok, tool: toolCall.name, text: result.text, evidenceId: result.evidenceId };
}

// stable point 共用核心：slash 与模型工具都走这里。先创建 snapshot 安全垫，再按 git
// 状态决定 skipped / snapshot / git_commit / failed；成功才写 git_operation evidence。
export async function performStablePoint(
  context: TuiContext,
  sessionId: string,
  input: { message?: string; includeUntracked?: boolean },
  deps: GitToolDispatchDeps,
): Promise<StablePointRunResult> {
  // message 校验：缺失时用安全默认；非空则校验长度/控制字符。
  let message = input.message?.trim() ?? "";
  if (message === "") {
    message = defaultStablePointMessage();
  } else {
    const check = validateStablePointMessage(message);
    if (!check.ok) {
      return { ok: false, text: `稳定点 message 非法：${check.reason}`, outcome: "snapshot_only" };
    }
    message = check.message;
  }

  // 本地安全垫：稳定点前先 snapshot。
  await createSnapshotStablePoint(deps, context, sessionId, `before stable point: ${message}`);

  const outcome = await createGitStablePoint(context.projectPath, {
    message,
    includeUntracked: input.includeUntracked,
  });
  const { ok, text } = summarizeStablePointOutcome(outcome, context.language);

  if (outcome.kind === "git_commit") {
    const evidence = await recordGitOperationEvidence(
      deps,
      context,
      sessionId,
      "stable_point_created",
      `kind=git_commit sha=${outcome.sha} branch=${outcome.branch ?? "-"} changed=${outcome.changedCount}`,
      ["stable_point_created"],
    );
    await appendGitOperationEvent(
      deps,
      context,
      sessionId,
      {
        operation: "stable_point_created",
        kind: "git_commit",
        createdAt: new Date().toISOString(),
        project: context.projectPath,
        branch: outcome.branch,
        sha: outcome.sha,
        subject: outcome.subject,
        changedCount: outcome.changedCount,
        includedUntracked: outcome.includedUntracked,
        rejectedUntracked: outcome.rejectedUntracked.length,
        result: "ok",
      },
      "info",
    );
    return { ok, text, evidenceId: evidence.id, outcome };
  }

  if (outcome.kind === "skipped") {
    await appendGitOperationEvent(
      deps,
      context,
      sessionId,
      {
        operation: "stable_point_skipped",
        createdAt: new Date().toISOString(),
        branch: outcome.branch,
        head: outcome.head,
        result: "skipped",
      },
      "info",
    );
    return { ok, text, outcome };
  }

  if (outcome.kind === "snapshot" || outcome.kind === "not_a_git_repo") {
    // snapshot stable point 也写 git_operation evidence（已真实创建本地安全垫），
    // 让“已保存当前状态”这种 claim 有据可依，但明确 kind=snapshot。
    const reason = outcome.kind === "not_a_git_repo" ? "not_a_git_repo" : outcome.reason;
    const evidence = await recordGitOperationEvidence(
      deps,
      context,
      sessionId,
      "stable_point_created",
      `kind=snapshot reason=${reason}`,
      ["stable_point_created"],
    );
    await appendGitOperationEvent(
      deps,
      context,
      sessionId,
      {
        operation: "stable_point_created",
        kind: "snapshot",
        createdAt: new Date().toISOString(),
        reason,
        result: "ok",
      },
      "info",
    );
    return { ok, text, evidenceId: evidence.id, outcome };
  }

  // failed / git_unavailable：fail-closed，不写 git_operation evidence。
  await appendGitOperationEvent(
    deps,
    context,
    sessionId,
    {
      operation: "git_operation_failed",
      target: "stable_point",
      createdAt: new Date().toISOString(),
      reason: text,
      result: "failed",
    },
    "warning",
  );
  return { ok, text, outcome };
}

async function runWorktreeCreateTool(
  toolCall: ModelToolCall,
  context: TuiContext,
  sessionId: string,
  output: Writable,
  deps: GitToolDispatchDeps,
): Promise<GitToolResult> {
  const input = parseWorktreeCreateInput(toolCall.input);
  const result = await performWorktreeCreate(
    context,
    sessionId,
    { name: input.name ?? "", branch: input.branch, fromRef: input.fromRef },
    deps,
  );
  deps.clearRequestActivity(context);
  await deps.appendDeferredToolResultEvent(
    context,
    sessionId,
    toolCall.id,
    toolCall.name,
    { text: result.text, ok: result.ok },
    !result.ok,
    result.evidenceId,
  );
  deps.writeLine(output, result.text);
  return { ok: result.ok, tool: toolCall.name, text: result.text, evidenceId: result.evidenceId };
}

// worktree create 共用核心：slash 与模型工具都走这里。safe-create，不二次确认。
export async function performWorktreeCreate(
  context: TuiContext,
  sessionId: string,
  input: { name: string; branch?: string; fromRef?: string },
  deps: GitToolDispatchDeps,
): Promise<WorktreeCreateRunResult> {
  const outcome = await createManagedWorktree(context.projectPath, input);
  const { ok, text } = summarizeWorktreeCreateOutcome(outcome, context.language);
  if (outcome.kind === "created") {
    const evidence = await recordGitOperationEvidence(
      deps,
      context,
      sessionId,
      "worktree_created",
      `name=${outcome.name} branch=${outcome.branch ?? "-"} from=${outcome.fromRef}`,
      ["worktree_created"],
    );
    await appendGitOperationEvent(
      deps,
      context,
      sessionId,
      {
        operation: "worktree_created",
        createdAt: outcome.createdAt,
        project: context.projectPath,
        name: outcome.name,
        path: outcome.path,
        branch: outcome.branch,
        fromRef: outcome.fromRef,
        head: outcome.head,
        managedRoot: outcome.managedRoot,
        result: "ok",
      },
      "info",
    );
    return { ok, text, evidenceId: evidence.id, outcome };
  }
  if (outcome.kind === "resumed") {
    const evidence = await recordGitOperationEvidence(
      deps,
      context,
      sessionId,
      "worktree_resumed",
      `name=${outcome.name} branch=${outcome.branch ?? "-"}`,
      ["worktree_resumed"],
    );
    await appendGitOperationEvent(
      deps,
      context,
      sessionId,
      {
        operation: "worktree_resumed",
        createdAt: new Date().toISOString(),
        name: outcome.name,
        path: outcome.path,
        managedRoot: outcome.managedRoot,
        result: "exists",
      },
      "info",
    );
    return { ok, text, evidenceId: evidence.id, outcome };
  }
  // invalid / failed / not_a_git_repo / git_unavailable：fail-closed。
  await appendGitOperationEvent(
    deps,
    context,
    sessionId,
    {
      operation: "git_operation_failed",
      target: "worktree_create",
      createdAt: new Date().toISOString(),
      reason: text,
      result: "failed",
    },
    "warning",
  );
  return { ok, text, outcome };
}

async function runWorktreeRemoveTool(
  toolCall: ModelToolCall,
  context: TuiContext,
  sessionId: string,
  output: Writable,
  deps: GitToolDispatchDeps,
  continuation?: PendingModelContinuation,
): Promise<GitToolResult> {
  const input = parseWorktreeRemoveInput(toolCall.input);
  const plan = await planManagedWorktreeRemove(context.projectPath, {
    name: input.name ?? "",
    force: input.force,
  });
  const summary = summarizeWorktreeRemovePlan(plan, context.language);
  deps.clearRequestActivity(context);

  if (summary.needsConfirmation && (plan.kind === "clean" || plan.kind === "dirty_force")) {
    // 进入轻/强确认；本工具本轮返回 pendingApproval，结果由 yes/no 后的 execute 回灌。
    context.pendingLocalApproval = {
      kind: "git_worktree_remove",
      sessionId,
      name: plan.name,
      path: plan.path,
      force: plan.kind === "dirty_force",
      strong: summary.strong,
      continuation: continuation
        ? deps.createSingleToolCallContinuation(continuation, toolCall)
        : undefined,
      toolCall,
    };
    await appendGitOperationEvent(
      deps,
      context,
      sessionId,
      {
        operation: "worktree_remove_requested",
        createdAt: new Date().toISOString(),
        name: plan.name,
        path: plan.path,
        force: plan.kind === "dirty_force",
        result: "pending_confirmation",
      },
      "info",
    );
    deps.writeLine(output, summary.text);
    return { ok: false, tool: toolCall.name, text: summary.text, pendingApproval: true };
  }

  // 拒绝路径（dirty_blocked / not_managed / not_found / invalid / unavailable）。
  if (plan.kind === "dirty_blocked" || plan.kind === "not_managed") {
    await appendGitOperationEvent(
      deps,
      context,
      sessionId,
      {
        operation: "worktree_remove_denied",
        createdAt: new Date().toISOString(),
        name: input.name,
        reason: summary.text,
        result: "denied",
      },
      "warning",
    );
  }
  const evidence = await deps.recordToolFailureEvidence(
    context,
    sessionId,
    "Read",
    `ManagedWorktreeRemove: ${summary.text}`,
  );
  await deps.appendDeferredToolResultEvent(
    context,
    sessionId,
    toolCall.id,
    toolCall.name,
    summary.text,
    true,
    evidence.id,
  );
  deps.writeLine(output, summary.text);
  return { ok: false, tool: toolCall.name, text: summary.text, evidenceId: evidence.id };
}

// 确认后真正删除 managed worktree（slash 与模型工具确认共用）。
export async function performWorktreeRemoveExecute(
  context: TuiContext,
  sessionId: string,
  name: string,
  path: string,
  force: boolean,
  deps: GitToolDispatchDeps,
): Promise<WorktreeRemoveExecuteResult> {
  const result = await executeManagedWorktreeRemove(context.projectPath, path, force);
  if (result.kind === "removed") {
    const evidence = await recordGitOperationEvidence(
      deps,
      context,
      sessionId,
      "worktree_removed",
      `name=${name} force=${force}`,
      ["worktree_removed"],
    );
    await appendGitOperationEvent(
      deps,
      context,
      sessionId,
      {
        operation: "worktree_removed",
        createdAt: new Date().toISOString(),
        name,
        path,
        force,
        result: "ok",
      },
      "info",
    );
    const text =
      context.language === "en-US"
        ? `Worktree removed: "${name}".`
        : `已删除 worktree：「${name}」。`;
    return { ok: true, text, evidenceId: evidence.id, result };
  }
  await appendGitOperationEvent(
    deps,
    context,
    sessionId,
    {
      operation: "git_operation_failed",
      target: "worktree_remove",
      createdAt: new Date().toISOString(),
      name,
      reason: result.reason,
      result: "failed",
    },
    "warning",
  );
  const text =
    context.language === "en-US"
      ? `Worktree removal failed; nothing removed: ${result.reason}`
      : `worktree 删除失败，未删除：${result.reason}`;
  return { ok: false, text, result };
}

// ---------------------------------------------------------------------------
// pendingLocalApproval yes/no 解析（git_worktree_remove）。index.ts 的 yes/no glue
// 只调用这两个薄函数；continuation 续轮经 `continueAfterToolResults` 回调注入，
// 避免把模型 loop 反向 import 进本模块。
// ---------------------------------------------------------------------------

export type GitWorktreeRemoveApproval = {
  sessionId: string;
  name: string;
  path: string;
  force: boolean;
  continuation?: PendingModelContinuation;
  toolCall?: ModelToolCall;
};

// D.14D-R2 P1-1 — 模型工具 GitStablePointCreate 的确认载体。
export type GitStablePointApproval = {
  sessionId: string;
  message?: string;
  includeUntracked?: boolean;
  continuation?: PendingModelContinuation;
  toolCall: ModelToolCall;
};

export type WorktreeRemoveResolveDeps = GitToolDispatchDeps & {
  writeLightHints: (output: Writable, context: TuiContext) => void;
  writeStatus: (output: Writable, context: TuiContext) => void;
  formatPermissionDenialPrimary: (language: TuiContext["language"]) => string;
  continueAfterToolResults: (
    continuation: PendingModelContinuation,
    context: TuiContext,
    output: Writable,
  ) => Promise<void>;
};

const MANAGED_WORKTREE_REMOVE_TOOL = "ManagedWorktreeRemove";

export async function resolveWorktreeRemoveApprove(
  approval: GitWorktreeRemoveApproval,
  context: TuiContext,
  output: Writable,
  deps: WorktreeRemoveResolveDeps,
): Promise<void> {
  const result = await performWorktreeRemoveExecute(
    context,
    approval.sessionId,
    approval.name,
    approval.path,
    approval.force,
    deps,
  );
  deps.writeLine(output, result.text);
  if (approval.continuation && approval.toolCall) {
    approval.continuation.messages.push({
      role: "tool",
      tool_call_id: approval.toolCall.id,
      content: JSON.stringify({
        ok: result.ok,
        tool: MANAGED_WORKTREE_REMOVE_TOOL,
        text: result.text,
        evidenceId: result.evidenceId,
      }),
    });
    await deps.continueAfterToolResults(approval.continuation, context, output);
  }
  deps.writeLightHints(output, context);
  deps.writeStatus(output, context);
}

export async function resolveWorktreeRemoveDeny(
  approval: GitWorktreeRemoveApproval,
  context: TuiContext,
  output: Writable,
  cancelled: boolean,
  deps: WorktreeRemoveResolveDeps,
): Promise<void> {
  const outcomeText = cancelled ? "permission cancelled by user" : "permission denied by user";
  const evidence = await deps.recordToolFailureEvidence(
    context,
    approval.sessionId,
    "Read",
    `${outcomeText}: ManagedWorktreeRemove ${approval.name}`,
  );
  await appendGitOperationEvent(
    deps,
    context,
    approval.sessionId,
    {
      operation: "worktree_remove_denied",
      createdAt: new Date().toISOString(),
      name: approval.name,
      path: approval.path,
      result: cancelled ? "cancelled" : "denied",
    },
    "warning",
  );
  const deniedText =
    context.language === "en-US"
      ? `Worktree removal ${cancelled ? "cancelled" : "denied"}; "${approval.name}" was not removed.`
      : `已${cancelled ? "取消" : "拒绝"}删除 worktree；「${approval.name}」未被删除。`;
  deps.writeLine(output, deniedText);
  if (approval.continuation && approval.toolCall) {
    approval.continuation.messages.push({
      role: "tool",
      tool_call_id: approval.toolCall.id,
      content: JSON.stringify({
        ok: false,
        tool: MANAGED_WORKTREE_REMOVE_TOOL,
        text: deniedText,
        outcome: cancelled ? "cancelled" : "denied",
        evidenceId: evidence.id,
      }),
    });
    await deps.continueAfterToolResults(approval.continuation, context, output);
  }
  deps.writeLightHints(output, context);
  deps.writeStatus(output, context);
}

// D.14D-R2 P1-1 — 用户确认后真实创建稳定点，并把工具结果回灌模型续轮。
export async function resolveStablePointApprove(
  approval: GitStablePointApproval,
  context: TuiContext,
  output: Writable,
  deps: WorktreeRemoveResolveDeps,
): Promise<void> {
  const result = await performStablePoint(
    context,
    approval.sessionId,
    { message: approval.message, includeUntracked: approval.includeUntracked },
    deps,
  );
  await deps.appendDeferredToolResultEvent(
    context,
    approval.sessionId,
    approval.toolCall.id,
    GIT_STABLE_POINT_CREATE,
    { text: result.text, ok: result.ok },
    !result.ok,
    result.evidenceId,
  );
  deps.writeLine(output, result.text);
  if (approval.continuation) {
    approval.continuation.messages.push({
      role: "tool",
      tool_call_id: approval.toolCall.id,
      content: JSON.stringify({
        ok: result.ok,
        tool: GIT_STABLE_POINT_CREATE,
        text: result.text,
        evidenceId: result.evidenceId,
      }),
    });
    await deps.continueAfterToolResults(approval.continuation, context, output);
  }
  deps.writeLightHints(output, context);
  deps.writeStatus(output, context);
}

// D.14D-R2 P1-1 — 拒绝稳定点：不创建 commit/snapshot，回灌"NOT created"给模型，
// 让 final answer 无法声称已建立稳定点。
export async function resolveStablePointDeny(
  approval: GitStablePointApproval,
  context: TuiContext,
  output: Writable,
  cancelled: boolean,
  deps: WorktreeRemoveResolveDeps,
): Promise<void> {
  const outcomeText = cancelled ? "permission cancelled by user" : "permission denied by user";
  const evidence = await deps.recordToolFailureEvidence(
    context,
    approval.sessionId,
    "Read",
    `${outcomeText}: GitStablePointCreate`,
  );
  await appendGitOperationEvent(
    deps,
    context,
    approval.sessionId,
    {
      operation: "stable_point_denied",
      createdAt: new Date().toISOString(),
      project: context.projectPath,
      result: cancelled ? "cancelled" : "denied",
    },
    "warning",
  );
  const deniedText =
    context.language === "en-US"
      ? `Stable point ${cancelled ? "cancelled" : "denied"}; no commit or snapshot was created. The stable point was NOT created.`
      : `已${cancelled ? "取消" : "拒绝"}创建稳定点；未创建任何 commit 或 snapshot。稳定点未创建。`;
  deps.writeLine(output, deniedText);
  if (approval.continuation) {
    approval.continuation.messages.push({
      role: "tool",
      tool_call_id: approval.toolCall.id,
      content: JSON.stringify({
        ok: false,
        tool: GIT_STABLE_POINT_CREATE,
        text: deniedText,
        outcome: cancelled ? "cancelled" : "denied",
        evidenceId: evidence.id,
      }),
    });
    await deps.continueAfterToolResults(approval.continuation, context, output);
  }
  deps.writeLightHints(output, context);
  deps.writeStatus(output, context);
}
