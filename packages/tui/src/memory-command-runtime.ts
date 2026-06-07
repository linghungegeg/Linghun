import { writeFile } from "node:fs/promises";
import { basename } from "node:path";
import type { Writable } from "node:stream";
import type { TranscriptEvent } from "@linghun/core";
import { TOGGLE_DETAILS_KEYBIND } from "@linghun/shared";
import { showCommandPanel } from "./command-panel-runtime.js";
import {
  createHandoffPacket,
  formatResumePacket,
  hydrateResumeContext,
  validateHandoffPacket,
} from "./handoff-session-runtime.js";
import type { TuiContext } from "./index.js";
import {
  applyMemoryExtractionDecision,
  decideMemoryExtraction,
  refreshAutoMemoryFiles,
  writeAutoMemoryFiles,
} from "./memory-extraction-runtime.js";
import { formatError, writeLine } from "./startup-runtime.js";
import type { MemoryCandidate, MemoryLearningRun } from "./tui-data-types.js";
import {
  createEvidenceBackedMemoryCandidates,
  createLinghunMdTemplate,
  createMemoryCandidate,
  findMemoryRecord,
  formatMemoryLearningRun,
  formatMemoryReview,
  formatMemoryScope,
  formatMemoryStats,
  formatMemoryStatus,
  formatMemoryStorage,
  getMemoryDirectory,
  parseMemoryCandidateArgs,
  removeMemoryFromState,
  removeMemoryRecord,
  writeMemoryLearningMode,
  writeMemoryRecord,
} from "./tui-memory-runtime.js";
import { writeErrorLine } from "./tui-output-surface.js";
import { pathExists, summarizeProjectRules } from "./tui-state-runtime.js";

export type MemoryCommandRuntimeDeps = {
  appendSystemEvent: (
    context: TuiContext,
    sessionId: string,
    message: string,
    level: "info" | "warning",
  ) => Promise<void>;
  ensureSession: (context: TuiContext) => Promise<string>;
  requestMemoryMutationApproval: (
    context: TuiContext,
    output: Writable,
    mutation: MemoryMutation,
  ) => Promise<"approved" | "blocked" | "pending">;
  refreshCacheFreshness: (context: TuiContext) => void;
  recordMemoryMutationEvidence: (
    context: TuiContext,
    sessionId: string,
    action: string,
    memory: MemoryCandidate,
  ) => Promise<void>;
  writeStatus: (output: Writable, context: TuiContext) => void;
};

export type MemoryMutation =
  | { action: "accept"; candidate: MemoryCandidate }
  | { action: "reject"; candidate: MemoryCandidate }
  | { action: "disable"; memory: MemoryCandidate }
  | { action: "rollback"; memory: MemoryCandidate }
  | { action: "delete"; memory: MemoryCandidate }
  | { action: "init" };

let runtimeDeps: MemoryCommandRuntimeDeps | undefined;

export function configureMemoryCommandRuntime(deps: MemoryCommandRuntimeDeps): void {
  runtimeDeps = deps;
}

function deps(): MemoryCommandRuntimeDeps {
  if (!runtimeDeps) {
    throw new Error("memory-command-runtime deps not configured");
  }
  return runtimeDeps;
}

function isSessionEnded(transcript: TranscriptEvent[]): boolean {
  return transcript.at(-1)?.type === "session_end";
}

/**
 * D.13Q-UX Task Surface — /memory status / list 的降噪 CommandPanel 视图。
 * 仅暴露：候选/已接受/已禁用计数、注入条数、autoLearning 是否开启、下一步。
 * promptInjection 内部参数（topK / estimatedTokens）、lastHandoff、详细 hint
 * 进 detailsText（Ctrl+O 展开）。
 */
function buildMemoryStatusPanel(context: TuiContext): import("./shell/types.js").CommandPanelView {
  const isEn = context.language === "en-US";
  const candidates = context.memory.candidates.length;
  const accepted = context.memory.accepted.length;
  const disabled = context.memory.disabled.length;
  const rejected = context.memory.rejected.length;
  const learning = context.memory.learningMode === "active";
  const summary: string[] = [
    isEn
      ? `Memory · accepted ${accepted} · candidates ${candidates} · disabled ${disabled}${rejected > 0 ? ` · rejected ${rejected}` : ""}`
      : `记忆 · 已接受 ${accepted} · 候选 ${candidates} · 已禁用 ${disabled}${rejected > 0 ? ` · 已拒绝 ${rejected}` : ""}`,
    isEn
      ? `Auto-learning: ${learning ? "on" : "off"}`
      : `自动学习：${learning ? "已开启" : "已关闭"}`,
  ];
  const actions: string[] = [];
  if (candidates > 0) actions.push("/memory review");
  if (!learning) actions.push("/memory learn on");
  actions.push("/memory storage");
  return {
    title: "/memory",
    tone: candidates > 0 ? "warning" : "neutral",
    summary,
    actions,
    detailsText: formatMemoryStatus(context),
  };
}

export async function handleMemoryCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0] ?? "status";
  if (action === "status" || action === "list") {
    // D.13Q-UX Task Surface — /memory status / list 默认走降噪 CommandPanel。
    showCommandPanel(context, output, buildMemoryStatusPanel(context));
    return;
  }
  if (action === "storage") {
    // D.14D-E — /memory storage 走降噪 CommandPanel：完整存储路径进 detailsText。
    showCommandPanel(context, output, {
      title: "/memory storage",
      tone: "neutral",
      summary: [
        context.language === "en-US"
          ? `Memory storage paths — ${TOGGLE_DETAILS_KEYBIND} for details.`
          : `记忆存储路径 — ${TOGGLE_DETAILS_KEYBIND} 查看详情。`,
      ],
      detailsText: formatMemoryStorage(context),
    });
    return;
  }
  if (action === "review") {
    // D.14D-E — /memory review 走降噪 CommandPanel：完整复核清单进 detailsText。
    showCommandPanel(context, output, {
      title: "/memory review",
      tone: "neutral",
      summary: [
        context.language === "en-US"
          ? `Memory review — ${TOGGLE_DETAILS_KEYBIND} for details.`
          : `记忆复核 — ${TOGGLE_DETAILS_KEYBIND} 查看详情。`,
      ],
      detailsText: formatMemoryReview(context),
    });
    return;
  }
  if (action === "stats") {
    // D.14D-E — /memory stats 走降噪 CommandPanel：完整统计进 detailsText。
    showCommandPanel(context, output, {
      title: "/memory stats",
      tone: "neutral",
      summary: [
        context.language === "en-US"
          ? `Memory stats — ${TOGGLE_DETAILS_KEYBIND} for details.`
          : `记忆统计 — ${TOGGLE_DETAILS_KEYBIND} 查看详情。`,
      ],
      detailsText: formatMemoryStats(context),
    });
    return;
  }
  if (action === "learn") {
    const subAction = args[1];
    if (subAction === "on") {
      context.memory.learningMode = "active";
      await writeMemoryLearningMode(context);
      const sessionId = await deps().ensureSession(context);
      await deps().appendSystemEvent(context, sessionId, "memory learning mode active", "info");
      writeLine(
        output,
        context.language === "en-US"
          ? "Auto-learning enabled. Stable taxonomy memory can be accepted automatically; uncertain content stays candidate-only. Disable with /memory learn off."
          : "自动学习已开启。稳定 taxonomy 记忆可自动接受；不确定内容保留候选。关闭：/memory learn off",
      );
      return;
    }
    if (subAction === "off") {
      context.memory.learningMode = "off";
      await writeMemoryLearningMode(context);
      const sessionId = await deps().ensureSession(context);
      await deps().appendSystemEvent(context, sessionId, "memory learning mode off", "info");
      writeLine(
        output,
        context.language === "en-US"
          ? "Auto-learning disabled. No new candidates will be generated automatically."
          : "自动学习已关闭。不再自动生成新候选记忆。",
      );
      return;
    }
    if (subAction === "status") {
      writeLine(
        output,
        context.language === "en-US"
          ? `Learning mode: ${context.memory.learningMode}; source ${context.memory.learningModeSource ?? "default"}; candidates ${context.memory.candidates.length}; accepted ${context.memory.accepted.length}`
          : `学习模式：${context.memory.learningMode === "active" ? "开启" : "关闭"}；来源 ${context.memory.learningModeSource ?? "default"}；候选 ${context.memory.candidates.length}；已接受 ${context.memory.accepted.length}`,
      );
      return;
    }
    const result = await runControlledMemoryLearning(context);
    // D.14D-E — /memory learn 运行结果走降噪 CommandPanel：完整 run 报告进 detailsText。
    showCommandPanel(context, output, {
      title: "/memory learn",
      tone: "neutral",
      summary: [
        context.language === "en-US"
          ? `Memory learn — ${result.candidatesCreated} candidate(s), ${result.acceptedCreated ?? 0} accepted; ${TOGGLE_DETAILS_KEYBIND} for details.`
          : `记忆学习 — 新候选 ${result.candidatesCreated} 条，自动接受 ${result.acceptedCreated ?? 0} 条；${TOGGLE_DETAILS_KEYBIND} 查看详情。`,
      ],
      detailsText: formatMemoryLearningRun(result, context.language),
    });
    return;
  }
  if (action === "candidate") {
    const parsed = parseMemoryCandidateArgs(args.slice(1));
    if (!parsed.summary) {
      writeLine(
        output,
        "用法：/memory candidate <短小稳定记忆摘要> [--scope project|user|session]",
      );
      return;
    }
    const candidate = createMemoryCandidate(
      parsed.scope,
      parsed.summary,
      "manual /memory candidate",
      ["user:/memory candidate"],
    );
    context.memory.candidates.unshift(candidate);
    await writeMemoryRecord(candidate, context);
    const sessionId = await deps().ensureSession(context);
    await context.store.appendEvent(sessionId, {
      type: "memory_candidate",
      candidate,
      createdAt: new Date().toISOString(),
    });
    deps().refreshCacheFreshness(context);
    writeLine(
      output,
      `已创建候选记忆：${candidate.id}。写入长期记忆前请运行 /memory review 和 /memory accept ${candidate.id}`,
    );
    return;
  }
  if (action === "accept") {
    const id = args[1];
    const candidate = context.memory.candidates.find((item) => item.id === id);
    if (!candidate) {
      writeLine(output, "未找到候选记忆。用法：/memory accept <candidate-id>");
      return;
    }
    await executeMemoryMutation(context, output, { action: "accept", candidate });
    return;
  }
  if (action === "reject") {
    const id = args[1];
    const candidate = context.memory.candidates.find((item) => item.id === id);
    if (!candidate) {
      writeLine(output, "未找到候选记忆。用法：/memory reject <candidate-id>");
      return;
    }
    if (
      (await deps().requestMemoryMutationApproval(context, output, {
        action: "reject",
        candidate,
      })) !== "approved"
    ) {
      return;
    }
    await executeMemoryMutation(context, output, { action: "reject", candidate });
    return;
  }
  if (action === "disable") {
    const id = args[1];
    const memory = context.memory.accepted.find((item) => item.id === id);
    if (!memory) {
      writeLine(output, "未找到已接受记忆。用法：/memory disable <accepted-id>");
      return;
    }
    if (
      (await deps().requestMemoryMutationApproval(context, output, {
        action: "disable",
        memory,
      })) !== "approved"
    ) {
      return;
    }
    await executeMemoryMutation(context, output, { action: "disable", memory });
    return;
  }
  if (action === "rollback") {
    const id = args[1];
    const memory = context.memory.disabled.find((item) => item.id === id);
    if (!memory) {
      writeLine(output, "未找到已禁用记忆。用法：/memory rollback <disabled-id>");
      return;
    }
    if (
      (await deps().requestMemoryMutationApproval(context, output, {
        action: "rollback",
        memory,
      })) !== "approved"
    ) {
      return;
    }
    await executeMemoryMutation(context, output, { action: "rollback", memory });
    return;
  }
  if (action === "delete" || action === "forget") {
    const id = args[1];
    const memory = findMemoryRecord(context.memory, id);
    if (!memory) {
      writeLine(output, "未找到该记忆。用法：/memory delete <id> 或 /memory forget <id>");
      return;
    }
    if (
      (await deps().requestMemoryMutationApproval(context, output, {
        action: "delete",
        memory,
      })) !== "approved"
    ) {
      return;
    }
    await executeMemoryMutation(context, output, { action: "delete", memory });
    return;
  }
  if (action === "init") {
    if (await pathExists(context.memory.projectRulesPath)) {
      await initLinghunMd(context, output);
      return;
    }
    if (
      (await deps().requestMemoryMutationApproval(context, output, { action: "init" })) !==
      "approved"
    ) {
      return;
    }
    await executeMemoryMutation(context, output, { action: "init" });
    return;
  }
  if (action === "import" && args[1] === "sessions") {
    await importAiSessions(args.slice(2), context, output);
    return;
  }
  writeLine(
    output,
    "用法：/memory | /memory storage | /memory review | /memory stats | /memory learn [on|off|status] | /memory candidate <摘要> [--scope project|user|session] | /memory accept|reject|disable|rollback|delete|forget <id> | /memory init | /memory import sessions [source] [query]",
  );
}

export async function resumeSessionWithHandoff(
  sessionId: string,
  context: TuiContext,
  output: Writable,
  source: "resume" | "sessions resume",
): Promise<void> {
  try {
    const resumed = await context.store.resume(sessionId);
    context.sessionId = resumed.session.id;
    context.sessionEnded = isSessionEnded(resumed.transcript);
    context.model = resumed.session.model;
    hydrateResumeContext(context, resumed.transcript);
    deps().refreshCacheFreshness(context);
    const packet = context.memory.lastHandoff ?? createHandoffPacket(context, resumed.transcript);
    const missing = validateHandoffPacket(packet);
    context.memory.lastResumeReadonly = missing.length > 0;
    writeLine(output, `已恢复会话：${resumed.session.id}`);
    writeLine(output, `恢复方式：${source}；不会把完整 transcript 塞回上下文。`);
    writeLine(output, formatResumePacket(packet, missing, context));
    if (context.index.status === "stale" || context.index.status === "missing") {
      writeLine(
        output,
        "索引不是 ready：建议先运行 /index status 或 /index refresh；不会自动刷新。 ",
      );
    }
    deps().writeStatus(output, context);
  } catch (error) {
    writeErrorLine(output, formatError(error));
  }
}

// Module 7 (tui-memory-runtime): createMemoryCandidate / parseMemoryCandidateArgs /
// writeMemoryRecord / removeMemoryRecord / getMemoryDirectory / findMemoryRecord /
// removeMemoryFromState moved out — see re-export+import block below.

async function appendMemoryLifecycleEvent(
  context: TuiContext,
  sessionId: string,
  action: string,
  memory: MemoryCandidate,
): Promise<void> {
  await deps().appendSystemEvent(
    context,
    sessionId,
    `memory_lifecycle action=${action} id=${memory.id} scope=${memory.scope} status=${memory.status} source=${memory.source}`,
    action === "deleted" ? "warning" : "info",
  );
}

export async function executeMemoryMutation(
  context: TuiContext,
  output: Writable,
  mutation: MemoryMutation,
): Promise<void> {
  if (mutation.action === "accept") {
    const accepted = { ...mutation.candidate, status: "accepted" as const };
    await writeMemoryRecord(accepted, context);
    if (accepted.taxonomy && accepted.scope !== "session") {
      await writeAutoMemoryFiles(getMemoryDirectory(accepted.scope, context), accepted);
    }
    context.memory.candidates = context.memory.candidates.filter((item) => item.id !== accepted.id);
    context.memory.accepted.unshift(accepted);
    const sessionId = await deps().ensureSession(context);
    await context.store.appendEvent(sessionId, {
      type: "memory_accepted",
      memory: accepted,
      createdAt: new Date().toISOString(),
    });
    await appendMemoryLifecycleEvent(context, sessionId, "accepted", accepted);
    await deps().recordMemoryMutationEvidence(context, sessionId, "accepted", accepted);
    deps().refreshCacheFreshness(context);
    writeLine(
      output,
      `已写入${formatMemoryScope(accepted.scope)}级长期记忆：${accepted.id}；后续注入仍受 accepted-only top-k/字符预算限制。`,
    );
    return;
  }
  if (mutation.action === "reject") {
    const rejected = { ...mutation.candidate, status: "rejected" as const };
    await writeMemoryRecord(rejected, context);
    context.memory.candidates = context.memory.candidates.filter((item) => item.id !== rejected.id);
    context.memory.rejected.unshift(rejected);
    const sessionId = await deps().ensureSession(context);
    await appendMemoryLifecycleEvent(context, sessionId, "rejected", rejected);
    await deps().recordMemoryMutationEvidence(context, sessionId, "rejected", rejected);
    deps().refreshCacheFreshness(context);
    writeLine(output, `已拒绝候选记忆：${rejected.id}；不会写入长期记忆或注入 prompt。`);
    return;
  }
  if (mutation.action === "disable") {
    const disabled = { ...mutation.memory, status: "disabled" as const };
    await writeMemoryRecord(disabled, context);
    context.memory.accepted = context.memory.accepted.filter((item) => item.id !== disabled.id);
    context.memory.disabled.unshift(disabled);
    if (disabled.taxonomy && disabled.scope !== "session") {
      await refreshAutoMemoryFiles(
        getMemoryDirectory(disabled.scope, context),
        context.memory.accepted.filter((item) => item.scope === disabled.scope),
        context.memory.disabled.filter((item) => item.scope === disabled.scope),
      );
    }
    const sessionId = await deps().ensureSession(context);
    await appendMemoryLifecycleEvent(context, sessionId, "disabled", disabled);
    await deps().recordMemoryMutationEvidence(context, sessionId, "disabled", disabled);
    deps().refreshCacheFreshness(context);
    writeLine(output, `已禁用长期记忆：${disabled.id}；保留记录但不再注入 prompt。`);
    return;
  }
  if (mutation.action === "rollback") {
    const accepted = { ...mutation.memory, status: "accepted" as const };
    await writeMemoryRecord(accepted, context);
    context.memory.disabled = context.memory.disabled.filter((item) => item.id !== accepted.id);
    context.memory.accepted.unshift(accepted);
    if (accepted.taxonomy && accepted.scope !== "session") {
      await refreshAutoMemoryFiles(
        getMemoryDirectory(accepted.scope, context),
        context.memory.accepted.filter((item) => item.scope === accepted.scope),
        context.memory.disabled.filter((item) => item.scope === accepted.scope),
      );
    }
    const sessionId = await deps().ensureSession(context);
    await appendMemoryLifecycleEvent(context, sessionId, "rollback", accepted);
    await deps().recordMemoryMutationEvidence(context, sessionId, "rollback", accepted);
    deps().refreshCacheFreshness(context);
    writeLine(output, `已回滚启用长期记忆：${accepted.id}；仍受受控 prompt 注入预算限制。`);
    return;
  }
  if (mutation.action === "delete") {
    await removeMemoryRecord(mutation.memory, context);
    removeMemoryFromState(context.memory, mutation.memory.id);
    if (mutation.memory.taxonomy && mutation.memory.scope !== "session") {
      await refreshAutoMemoryFiles(
        getMemoryDirectory(mutation.memory.scope, context),
        context.memory.accepted.filter((item) => item.scope === mutation.memory.scope),
        context.memory.disabled.filter((item) => item.scope === mutation.memory.scope),
      );
    }
    const sessionId = await deps().ensureSession(context);
    await appendMemoryLifecycleEvent(context, sessionId, "deleted", mutation.memory);
    await deps().recordMemoryMutationEvidence(context, sessionId, "deleted", mutation.memory);
    deps().refreshCacheFreshness(context);
    writeLine(output, `已删除记忆记录：${mutation.memory.id}；不会保留在候选/长期/禁用列表。`);
    return;
  }
  if (mutation.action === "init") {
    const created = await initLinghunMd(context, output);
    if (!created) {
      return;
    }
    const sessionId = await deps().ensureSession(context);
    await deps().appendSystemEvent(
      context,
      sessionId,
      "memory_lifecycle action=init path=LINGHUN.md",
      "info",
    );
    await deps().recordMemoryMutationEvidence(
      context,
      sessionId,
      "init",
      createMemoryCandidate("project", "generated LINGHUN.md", "memory init", ["LINGHUN.md"]),
    );
    return;
  }
  const unknown: never = mutation;
  throw new Error(
    `未知 memory mutation action：${String((unknown as { action?: unknown }).action)}`,
  );
}

// Module 7 (tui-memory-runtime): formatMemoryScope / formatMemoryStatus /
// formatMemoryStorage / formatMemoryReview / formatMemoryStats /
// countMemoryScopes moved out — see re-export+import block below.

async function runControlledMemoryLearning(context: TuiContext): Promise<MemoryLearningRun> {
  const candidates = createEvidenceBackedMemoryCandidates(context).slice(0, 3);
  context.memory.candidates.unshift(...candidates);
  const sessionId = await deps().ensureSession(context);
  for (const candidate of candidates) {
    await writeMemoryRecord(candidate, context);
    await context.store.appendEvent(sessionId, {
      type: "memory_candidate",
      candidate,
      createdAt: new Date().toISOString(),
    });
  }
  const run: MemoryLearningRun = {
    trigger: "manual",
    candidatesCreated: candidates.length,
    modelCalled: false,
    ...(candidates.length === 0
      ? { skippedReason: "no bounded evidence/todo/verification/handoff source" }
      : {}),
    createdAt: new Date().toISOString(),
  };
  context.memory.lastLearningRun = run;
  await deps().appendSystemEvent(
    context,
    sessionId,
    `memory_learning trigger=${run.trigger} candidates=${run.candidatesCreated} modelCalled=no skipped=${run.skippedReason ?? "none"}`,
    candidates.length === 0 ? "warning" : "info",
  );
  deps().refreshCacheFreshness(context);
  return run;
}

// Module 7 (tui-memory-runtime): createEvidenceBackedMemoryCandidates moved
// out — see re-export+import block below.

// --- Pre-Smoke 2: memory extraction runtime ---
// Auto memory no longer falls back to fixed phrase / regex candidate patches.
// All turn-end learning decisions go through memory-extraction-runtime.

export async function runAutoLearningOnTurnEnd(
  context: TuiContext,
  userInput: string,
): Promise<MemoryLearningRun> {
  if (context.memory.learningMode !== "active") {
    return {
      trigger: "manual",
      candidatesCreated: 0,
      modelCalled: false,
      skippedReason: "learning_mode=off",
      createdAt: new Date().toISOString(),
    };
  }

  const decision = decideMemoryExtraction({
    recentMessages: [userInput],
    accepted: context.memory.accepted,
    disabled: context.memory.disabled,
    candidates: context.memory.candidates,
  });

  if (decision.action === "create" || decision.action === "update") {
    const existing = context.memory.accepted.find((item) => item.id === decision.id);
    const applied = await applyMemoryExtractionDecision({
      decision,
      memoryDir: getMemoryDirectory(decision.scope, context),
      existing,
    });
    if (!applied.memory) {
      throw new Error("memory extraction returned no accepted memory");
    }
    await writeMemoryRecord(applied.memory, context);
    context.memory.accepted = [
      applied.memory,
      ...context.memory.accepted.filter((item) => item.id !== applied.memory?.id),
    ];
    const sessionId = await deps().ensureSession(context);
    await context.store.appendEvent(sessionId, {
      type: "memory_accepted",
      memory: applied.memory,
      createdAt: new Date().toISOString(),
    });
    await appendMemoryLifecycleEvent(context, sessionId, `auto_${decision.action}`, applied.memory);
    await deps().recordMemoryMutationEvidence(
      context,
      sessionId,
      `auto_${decision.action}`,
      applied.memory,
    );
    const run: MemoryLearningRun = {
      trigger: "evidence",
      candidatesCreated: 0,
      acceptedCreated: decision.action === "create" ? 1 : 0,
      acceptedUpdated: decision.action === "update" ? 1 : 0,
      modelCalled: false,
      createdAt: new Date().toISOString(),
    };
    context.memory.lastLearningRun = run;
    await deps().appendSystemEvent(
      context,
      sessionId,
      `auto_memory_extraction action=${decision.action} taxonomy=${decision.taxonomy} topic=${decision.topic}`,
      "info",
    );
    deps().refreshCacheFreshness(context);
    return run;
  }

  return {
    trigger: "manual",
    candidatesCreated: 0,
    modelCalled: false,
    skippedReason:
      decision.action === "no-op"
        ? `memory_extraction:${decision.reason}${decision.blockedBy ? `:${decision.blockedBy}` : ""}`
        : "no_learnable_content",
    createdAt: new Date().toISOString(),
  };
}

export async function initLinghunMd(context: TuiContext, output: Writable): Promise<boolean> {
  if (await pathExists(context.memory.projectRulesPath)) {
    context.memory.projectRulesExists = true;
    writeLine(output, `LINGHUN.md 已存在：${context.memory.projectRulesPath}`);
    return false;
  }
  const content = createLinghunMdTemplate(context.language);
  await writeFile(context.memory.projectRulesPath, content, "utf8");
  context.memory.projectRulesExists = true;
  context.memory.projectRulesSummary = summarizeProjectRules(content);
  context.memory.projectRulesError = undefined;
  deps().refreshCacheFreshness(context);
  writeLine(output, `已生成基础 LINGHUN.md：${context.memory.projectRulesPath}`);
  return true;
}

export async function importAiSessions(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const source = args[0] ?? "auto";
  const query = args.slice(1).join(" ").trim() || basename(context.projectPath);
  const summary = `AI sessions import requested: source=${source}, query=${query}. 当前 Linghun 最小入口只记录摘要和证据引用，不读取或保存敏感聊天原文；如 MCP bridge 不可用，请先配置 ai-sessions。`;
  const sessionId = await deps().ensureSession(context);
  await context.store.appendEvent(sessionId, {
    type: "session_import",
    source,
    summary,
    createdAt: new Date().toISOString(),
  });
  const candidate = createMemoryCandidate(
    "project",
    `外部会话导入线索：${source} / ${query}`,
    "AI sessions import summary",
    [`ai-sessions:${source}:${query}`],
  );
  context.memory.candidates.unshift(candidate);
  await writeMemoryRecord(candidate, context);
  deps().refreshCacheFreshness(context);
  writeLine(output, summary);
  writeLine(output, `已创建候选记忆等待确认：${candidate.id}`);
}
