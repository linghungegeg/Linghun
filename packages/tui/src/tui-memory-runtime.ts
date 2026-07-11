// Module 7: tui-memory-runtime
// Pure /memory + LINGHUN.md helpers extracted from packages/tui/src/index.ts
// as part of the D.13 mechanical split. Behavior is unchanged.
//
// Coordinators that depend on ensureSession, store.appendEvent,
// appendSystemEvent, refreshCacheFreshness, writeLine and other
// index-side state mutations stay in index.ts to avoid cross-module
// circular dependencies (Path A safety valve #2):
//   - runControlledMemoryLearning
//   - runAutoLearningOnTurnEnd
//   - appendMemoryLifecycleEvent
//   - initLinghunMd
//   - importAiSessions
//   - createMemoryFreshnessSummary (left to be co-located with cache freshness)
//
// What moved here:
//   - createMemoryCandidate (pure)
//   - parseMemoryCandidateArgs (pure)
//   - writeMemoryRecord (fs)
//   - removeMemoryRecord (fs)
//   - getMemoryDirectory (type-only TuiContext)
//   - findMemoryRecord (pure)
//   - removeMemoryFromState (pure)
//   - formatMemoryScope (pure)
//   - formatMemoryStatus (type-only TuiContext)
//   - formatMemoryStorage (type-only TuiContext)
//   - formatMemoryReview (type-only TuiContext)
//   - formatMemoryStats (type-only TuiContext)
//   - countMemoryScopes (pure)
//   - createEvidenceBackedMemoryCandidates (type-only TuiContext)
//   - containsSecret (pure)
//   - formatMemoryLearningRun (pure)
//   - createControlledMemoryInjection (type-only TuiContext)
//   - estimateMemoryTokens (pure)
//   - formatControlledMemoryForModel (type-only TuiContext)
//   - createLinghunMdTemplate (pure)
//   - formatProjectRulesRead (type-only TuiContext, fs read)
//   - formatProjectRulesContext (type-only TuiContext)
//
// All consumers continue to import via "../index.js"; index.ts re-exports
// the symbols below and imports them value-side for internal callers.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveStoragePaths } from "@linghun/config";
import type { Language } from "@linghun/shared";
import type { TuiContext } from "./index.js";
import {
  commitPersistentMemoryMutation,
  type PersistentMemoryCommitResult,
  writePersistentMemoryLearningState,
} from "./memory-extraction-runtime.js";
import { MEMORY_LEARNING_STATE_FILE } from "./runtime-utils.js";
import { formatDisplayPath, formatError, truncateDisplay } from "./startup-runtime.js";
import type {
  MemoryCandidate,
  MemoryLearningCategory,
  MemoryLearningRun,
  MemoryScope,
  MemoryState,
} from "./tui-data-types.js";
import { normalizeMemoryStatus, pathExists, summarizeProjectRules } from "./tui-state-runtime.js";

// Module-private mirrors of MEMORY_PROMPT_* constants; index.ts owns the
// canonical declarations to avoid drift across modules.
const MEMORY_PROMPT_TOP_K = 3;
const MEMORY_PROMPT_ITEM_WIDTH = 180;
const MEMORY_PROMPT_TOTAL_WIDTH = 720;
const PROJECT_RULES_STATUS_WIDTH = 160;
export function createMemoryCandidate(
  scope: MemoryScope,
  summary: string,
  source: string,
  sourceRefs: string[],
): MemoryCandidate {
  return {
    id: randomUUID(),
    scope,
    status: "candidate",
    summary: truncateDisplay(summary.replace(/\s+/g, " "), 240),
    source,
    sourceRefs: sourceRefs.slice(0, 6),
    risk: "low",
    inferred: false,
    createdAt: new Date().toISOString(),
  };
}

export function parseMemoryCandidateArgs(args: string[]): {
  scope: MemoryScope;
  summary: string;
} {
  const scopeIndex = args.findIndex((arg) => arg === "--scope");
  const rawScope = scopeIndex >= 0 ? args[scopeIndex + 1] : undefined;
  const scope: MemoryScope =
    rawScope === "user" || rawScope === "session" || rawScope === "project" ? rawScope : "project";
  const summary = args
    .filter((_, index) => scopeIndex < 0 || (index !== scopeIndex && index !== scopeIndex + 1))
    .join(" ")
    .trim();
  return { scope, summary };
}

export async function writeMemoryRecord(
  candidate: MemoryCandidate,
  context: TuiContext,
  options: { expected?: MemoryCandidate; commitGuard?: () => boolean } = {},
): Promise<PersistentMemoryCommitResult | undefined> {
  if (candidate.scope === "session") {
    return undefined;
  }
  const directory = getMemoryDirectory(candidate.scope, context);
  return commitPersistentMemoryMutation(directory, candidate.scope, {
    action: "upsert",
    next: candidate,
    expected: options.expected,
    commitGuard: options.commitGuard,
  });
}

export async function writeMemoryLearningMode(context: TuiContext): Promise<void> {
  const userDir = context.memory.userDir || resolveStoragePaths(context.config, context.projectPath).memoryUser;
  await mkdir(userDir, { recursive: true });
  await writePersistentMemoryLearningState(
    userDir,
    `${JSON.stringify(
      {
        learningMode: context.memory.learningMode,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  context.memory.userDir = userDir;
  context.memory.learningModeSource = "persisted";
  context.memory.learningModeDiagnostic = undefined;
}

export async function removeMemoryRecord(
  candidate: MemoryCandidate,
  context: TuiContext,
  options: { sessionId: string; requestTurnId?: string; commitGuard?: () => boolean },
): Promise<PersistentMemoryCommitResult | undefined> {
  if (candidate.scope === "session") {
    return undefined;
  }
  const directory = getMemoryDirectory(candidate.scope, context);
  return commitPersistentMemoryMutation(directory, candidate.scope, {
    action: "delete",
    expected: candidate,
    deletion: {
      sessionId: options.sessionId,
      requestTurnId: options.requestTurnId,
    },
    commitGuard: options.commitGuard,
  });
}

export function getMemoryDirectory(scope: MemoryScope, context: TuiContext): string {
  if (scope === "project") return context.memory.projectDir;
  if (scope === "user") return context.memory.userDir;
  return context.memory.sessionDir;
}

export function findMemoryRecord(
  memory: MemoryState,
  id: string | undefined,
): MemoryCandidate | undefined {
  if (!id) return undefined;
  return [
    ...memory.candidates,
    ...memory.accepted,
    ...memory.rejected,
    ...memory.disabled,
    ...memory.retired,
  ].find((item) => item.id === id);
}

export function removeMemoryFromState(memory: MemoryState, id: string): void {
  memory.candidates = memory.candidates.filter((item) => item.id !== id);
  memory.accepted = memory.accepted.filter((item) => item.id !== id);
  memory.rejected = memory.rejected.filter((item) => item.id !== id);
  memory.disabled = memory.disabled.filter((item) => item.id !== id);
  memory.retired = memory.retired.filter((item) => item.id !== id);
}

export function formatMemoryScope(scope: MemoryScope): string {
  if (scope === "project") return "项目";
  if (scope === "user") return "用户";
  return "会话";
}

export function formatProjectRulesContext(context: TuiContext): string {
  if (context.memory.projectRulesError) {
    return "unreadable; 可检查文件权限或运行 /memory storage 定位路径";
  }
  if (!context.memory.projectRulesExists) {
    return "missing; 可运行 /memory init 生成基础模板，不会自动生成";
  }
  return truncateDisplay(context.memory.projectRulesSummary, PROJECT_RULES_STATUS_WIDTH);
}

export function formatMemoryStatus(context: TuiContext): string {
  const injected = createControlledMemoryInjection(context);
  const learningLabel = context.memory.learningMode === "active" ? "on" : "off";
  const learningSource = context.memory.learningModeSource ?? "default";
  const unreadableScopes = [...(context.memory.tombstones?.unreadableScopes ?? [])];
  const tombstoneDiagnosticCount = context.memory.tombstones?.diagnostics.length ?? 0;
  return [
    "Memory status",
    `- LINGHUN.md: ${context.memory.projectRulesExists ? "found" : "missing"}; summary ${formatProjectRulesContext(context)}`,
    `- review queue: candidates ${context.memory.candidates.length}; accepted ${context.memory.accepted.length}; disabled ${context.memory.disabled.length}; rejected ${context.memory.rejected.length}`,
    `- auto learning: ${learningLabel}; auto extraction accepted for stable taxonomy memory; source ${learningSource}; uncertain content stays candidate-only`,
    ...(context.memory.learningModeDiagnostic
      ? [`- auto learning diagnostic: ${context.memory.learningModeDiagnostic}`]
      : []),
    ...(unreadableScopes.length > 0 || tombstoneDiagnosticCount > 0
      ? [
          `- tombstone ledger: fail-closed; unreadable scopes ${unreadableScopes.join(", ") || "none"}; diagnostics ${tombstoneDiagnosticCount}`,
        ]
      : []),
    `- prompt injection: accepted-only topK ${MEMORY_PROMPT_TOP_K}; injected ${injected.items.length}; estimated tokens ${estimateMemoryTokens(injected.text)}; details /memory stats`,
    "- next: /memory review to accept/reject; /memory disable <id> to pause accepted memory; /memory rollback <id> to re-enable",
    `- lastHandoff: ${context.memory.lastHandoff ? context.memory.lastHandoff.createdAt : "none"}`,
    context.memory.projectRulesError
      ? "- hint: LINGHUN.md 读取失败；可运行 /memory storage 定位路径，不会自动生成或打断输入。"
      : context.memory.projectRulesExists
        ? "- note: LINGHUN.md 只显示截断摘要；完整规则不刷主屏、不注入完整聊天。"
        : "- hint: 缺少 LINGHUN.md。可运行 /memory init 生成基础模板；不会打断输入。",
  ].join("\n");
}

export function formatMemoryStorage(context: TuiContext): string {
  const paths = resolveStoragePaths(context.config, context.projectPath);
  return [
    "Memory storage",
    `- project rules: ${formatDisplayPath(context.memory.projectRulesPath, context.projectPath)}`,
    `- project memory: ${formatDisplayPath(paths.memoryProject, context.projectPath)}`,
    `- user memory: ${formatDisplayPath(paths.memoryUser, context.projectPath)}`,
    `- session memory/handoff: ${formatDisplayPath(paths.memorySession, context.projectPath)}`,
    `- sessions: ${formatDisplayPath(paths.sessions, context.projectPath)}`,
    `- logs: ${formatDisplayPath(paths.logs, context.projectPath)}`,
    `- jobs: ${formatDisplayPath(paths.jobs, context.projectPath)}`,
    `- cache: ${formatDisplayPath(paths.cache, context.projectPath)}`,
    `- index metadata: ${formatDisplayPath(paths.index, context.projectPath)}`,
    `- LINGHUN_DATA_DIR: ${
      process.env.LINGHUN_DATA_DIR
        ? formatDisplayPath(process.env.LINGHUN_DATA_DIR, context.projectPath)
        : "not set; default user data is under ~/.linghun/data"
    }`,
  ].join("\n");
}

export function formatMemoryReview(context: TuiContext): string {
  const accepted = context.memory.accepted
    .slice(0, 5)
    .map(
      (item) =>
        `- accepted ${item.id} [${item.scope}] ${truncateDisplay(item.summary, 96)}; disable /memory disable ${item.id}`,
    );
  const disabled = context.memory.disabled
    .slice(0, 5)
    .map(
      (item) =>
        `- disabled ${item.id} [${item.scope}] ${truncateDisplay(item.summary, 96)}; rollback /memory rollback ${item.id}; delete /memory delete ${item.id}`,
    );
  if (context.memory.candidates.length === 0) {
    return [
      "Memory review：暂无候选记忆；稳定 taxonomy 长期记忆可由 extraction runtime 自动写入专用 memory dir。",
      "来源边界：自动抽取只保存长期稳定事实；/memory learn 只看 bounded evidence/Todo/verification/handoff，不读取完整聊天、完整日志或完整索引。",
      "下一步：需要手动复核时用 /memory candidate <短小稳定摘要> [--scope project|user|session] 创建候选，再 /memory accept。",
      ...accepted,
      ...disabled,
      "动作区别：accept=写入长期且可被 topK 注入；reject=丢弃候选；disable=暂停已接受注入；rollback=重新启用；delete=删除记录。",
    ].join("\n");
  }
  return [
    "Memory review（候选 ≠ 长期记忆）",
    ...context.memory.candidates
      .slice(0, 8)
      .map(
        (item) =>
          `- candidate ${item.id} [${item.scope}] ${truncateDisplay(item.summary, 100)}; source ${truncateDisplay(item.source, 48)}; accept /memory accept ${item.id}; reject /memory reject ${item.id}`,
      ),
    ...accepted,
    ...disabled,
    "动作区别：accept=写入长期且可被 topK 注入；reject=丢弃候选；disable=暂停已接受注入；rollback=重新启用；delete=删除记录。",
  ].join("\n");
}

export function formatMemoryStats(context: TuiContext): string {
  const injection = createControlledMemoryInjection(context);
  const acceptedScopeCounts = countMemoryScopes(context.memory.accepted);
  const candidateScopeCounts = countMemoryScopes(context.memory.candidates);
  const learningLabel = context.memory.learningMode === "active" ? "on" : "off";
  const lastRun = context.memory.lastLearningRun
    ? `${context.memory.lastLearningRun.trigger}; candidates ${context.memory.lastLearningRun.candidatesCreated}; accepted created ${context.memory.lastLearningRun.acceptedCreated ?? 0}; accepted updated ${context.memory.lastLearningRun.acceptedUpdated ?? 0}; model called ${context.memory.lastLearningRun.modelCalled ? "yes" : "no"}`
    : "none";
  if (context.language === "en-US") {
    return [
      "Memory stats (controlled learning / cost guard)",
      `- candidates ${context.memory.candidates.length}; accepted ${context.memory.accepted.length}; disabled ${context.memory.disabled.length}; rejected ${context.memory.rejected.length}`,
      `- session scope: accepted ${acceptedScopeCounts.session}; current TuiContext only, not persisted across new sessions`,
      `- project/user persistent scope: accepted ${acceptedScopeCounts.project + acceptedScopeCounts.user} (project ${acceptedScopeCounts.project}; user ${acceptedScopeCounts.user}); accepted-only topK prompt injection`,
      `- candidate scope: project ${candidateScopeCounts.project}; user ${candidateScopeCounts.user}; session ${candidateScopeCounts.session}; candidates are not auto-accepted or injected`,
      `- prompt injection: accepted-only topK ${MEMORY_PROMPT_TOP_K}; injected ${injection.items.length}; chars ${injection.text.length}; estimated tokens ${estimateMemoryTokens(injection.text)}`,
      `- last learning run: ${lastRun}`,
      `- auto learning: ${learningLabel}; stable taxonomy memory auto accepted; uncertain content stays candidate-only; toggle with /memory learn on|off`,
      "- long-term write: auto extraction is limited to the dedicated memory dir; manual candidates still use /memory accept <id>; memory never bypasses ordinary Write/Edit permissions",
      "- full candidates, transcripts, logs, and index dumps are not injected into the prompt",
    ].join("\n");
  }
  return [
    "Memory stats（受控学习 / 成本守卫）",
    `- 候选 ${context.memory.candidates.length}；已接受 ${context.memory.accepted.length}；已禁用 ${context.memory.disabled.length}；已拒绝 ${context.memory.rejected.length}`,
    `- session-scope：已接受 ${acceptedScopeCounts.session}；仅当前 TuiContext / 当前会话生效，不跨新会话持久化`,
    `- project/user persistent scope：已接受 ${acceptedScopeCounts.project + acceptedScopeCounts.user}（project ${acceptedScopeCounts.project}；user ${acceptedScopeCounts.user}）；仅 accepted-only topK 注入 prompt`,
    `- candidate：project ${candidateScopeCounts.project}；user ${candidateScopeCounts.user}；session ${candidateScopeCounts.session}；候选不会自动接受或注入`,
    `- prompt 注入：accepted-only topK ${MEMORY_PROMPT_TOP_K}；injected ${injection.items.length}；chars ${injection.text.length}；estimated tokens ${estimateMemoryTokens(injection.text)}`,
    `- 上次学习：${lastRun}`,
    `- 自动学习：${learningLabel === "on" ? "开启" : "关闭"}；稳定 taxonomy 记忆会自动接受，不确定内容保留候选；切换：/memory learn on|off`,
    "- 长期写入：自动 extraction 只写专用 memory dir；手动候选仍用 /memory accept <id>；memory 不绕过普通 Write/Edit 权限",
    "- 完整候选、聊天、日志和索引 dump 不注入 prompt",
  ].join("\n");
}

export function countMemoryScopes(items: MemoryCandidate[]): Record<MemoryScope, number> {
  return {
    project: items.filter((item) => item.scope === "project").length,
    user: items.filter((item) => item.scope === "user").length,
    session: items.filter((item) => item.scope === "session").length,
  };
}

export function createEvidenceBackedMemoryCandidates(context: TuiContext): MemoryCandidate[] {
  const existing = new Set(
    [...context.memory.candidates, ...context.memory.accepted, ...context.memory.disabled].map(
      (item) => item.summary,
    ),
  );
  const summaries: MemoryCandidate[] = [];
  const add = (summary: string, source: string, refs: string[]): void => {
    const normalized = truncateDisplay(summary.replace(/\s+/g, " "), 240);
    if (!normalized || existing.has(normalized)) {
      return;
    }
    existing.add(normalized);
    summaries.push(createMemoryCandidate("project", normalized, source, refs));
  };
  for (const evidence of context.evidence.slice(0, 3)) {
    if (
      evidence.supportsClaims.includes("verification_self_check_passed") ||
      evidence.supportsClaims.includes("verification_not_run") ||
      /synthetic self-check|SELF-CHECK/iu.test(evidence.summary)
    ) {
      continue;
    }
    add(`证据线索：${evidence.summary}`, `evidence:${evidence.kind}`, [evidence.id]);
  }
  for (const todo of context.tools.todos.slice(0, 3)) {
    if (todo.status === "completed") {
      add(`已完成任务线索：${todo.content}`, "todo:completed", [`todo:${todo.id}`]);
    }
  }
  if (
    context.lastVerification?.status === "pass" &&
    context.lastVerification.commands.some(
      (command) => command.status === "pass" && command.synthetic !== true,
    )
  ) {
    add(`验证通过线索：${context.lastVerification.summary}`, "verification:pass", [
      context.lastVerification.id,
    ]);
  }
  if (context.memory.lastHandoff) {
    add(`handoff 线索：${context.memory.lastHandoff.goal}`, "handoff", [
      context.memory.lastHandoff.id,
    ]);
  }
  return summaries;
}

// --- Pre-Smoke 2: deterministic no-save filter shared by memory extraction ---

const MEMORY_SECRET_PATTERNS = [
  /\b[A-Za-z0-9_-]{20,}(?:key|token|secret|password|credential)/i,
  /\b(?:sk|pk|api|token|secret|key|password|credential)[_-][A-Za-z0-9_-]{16,}/i,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}/,
  /\b(?:xox[bpras])-[A-Za-z0-9-]+/,
  /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/,
  /\b[A-Za-z0-9+/]{40,}={0,2}\b/,
];

export function containsSecret(text: string): boolean {
  return MEMORY_SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

export function formatMemoryLearningRun(run: MemoryLearningRun, language: Language): string {
  if (language === "en-US") {
    return [
      "Memory learn (controlled / extraction runtime)",
      `- source: bounded evidence/Todo/verification/handoff only; trigger ${run.trigger}`,
      `- candidates created: ${run.candidatesCreated}`,
      `- accepted created: ${run.acceptedCreated ?? 0}; accepted updated: ${run.acceptedUpdated ?? 0}`,
      `- model called: ${run.modelCalled ? "yes" : "no"}`,
      `- skipped reason: ${run.skippedReason ?? "none"}`,
      "- next: stable taxonomy memory is accepted automatically into the dedicated memory dir; review uncertain candidates with /memory review.",
    ].join("\n");
  }
  return [
    "Memory learn（受控 / extraction runtime）",
    `- 来源：仅 bounded evidence/Todo/verification/handoff；trigger ${run.trigger}`,
    `- 新候选：${run.candidatesCreated}`,
    `- 自动接受：新增 ${run.acceptedCreated ?? 0}；更新 ${run.acceptedUpdated ?? 0}`,
    `- 调用模型：${run.modelCalled ? "yes" : "no"}`,
    `- 跳过原因：${run.skippedReason ?? "none"}`,
    "- 下一步：稳定 taxonomy 记忆会自动写入专用 memory dir；不确定候选用 /memory review 复核。",
  ].join("\n");
}

export function createControlledMemoryInjection(context: TuiContext, query?: string): {
  items: MemoryCandidate[];
  text: string;
} {
  const items = context.memory.accepted
    .filter((item) => normalizeMemoryStatus(item) === "accepted")
    .map((item, index) => ({
      item,
      index,
      score: query === undefined ? 1 : memoryRelevanceScore(item, query),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, MEMORY_PROMPT_TOP_K)
    .map((entry) => entry.item);
  const text = truncateDisplay(
    items
      .map(
        (item) =>
          `- ${item.id} [${item.scope}] ${truncateDisplay(item.summary.replace(/\s+/g, " "), MEMORY_PROMPT_ITEM_WIDTH)} (source ${truncateDisplay(item.source, 80)})`,
      )
      .join("\n"),
    MEMORY_PROMPT_TOTAL_WIDTH,
  );
  return { items, text };
}

function memoryRelevanceScore(memory: MemoryCandidate, query: string): number {
  const queryTokens = memorySearchTokens(query);
  const memoryTokens = memorySearchTokens(`${memory.topic ?? ""} ${memory.summary}`);
  let score = 0;
  for (const token of queryTokens) {
    if (memoryTokens.has(token)) score += token.length >= 4 ? 3 : 1;
  }
  const normalizedQuery = query.toLocaleLowerCase().replace(/\s+/g, " ").trim();
  const normalizedTopic = memory.topic?.toLocaleLowerCase().replace(/[-_]+/g, " ").trim();
  if (normalizedTopic && normalizedQuery.includes(normalizedTopic)) score += 5;
  return score;
}

function memorySearchTokens(text: string): Set<string> {
  const normalized = text.toLocaleLowerCase();
  const tokens = new Set(
    normalized
      .split(/[^a-z0-9\u4e00-\u9fff]+/u)
      .filter((token) => token.length >= 2),
  );
  for (const sequence of normalized.match(/[\u4e00-\u9fff]{2,}/gu) ?? []) {
    for (let index = 0; index < sequence.length - 1; index += 1) {
      tokens.add(sequence.slice(index, index + 2));
    }
  }
  return tokens;
}

export function estimateMemoryTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function formatControlledMemoryForModel(context: TuiContext, query = ""): string {
  const injection = createControlledMemoryInjection(context, query);
  if (injection.items.length === 0) {
    return "[]";
  }
  return JSON.stringify(
    injection.items.map((item) => ({
      id: item.id,
      scope: item.scope,
      summary: truncateDisplay(item.summary.replace(/\s+/g, " "), MEMORY_PROMPT_ITEM_WIDTH),
      source: truncateDisplay(item.source, 80),
    })),
  );
}

export function createLinghunMdTemplate(language: Language): string {
  if (language === "en-US") {
    return `# Project Rules

## Purpose
- LINGHUN.md records long-lived project rules, stable facts, common commands, and explicit constraints.
- Keep this file concise so it can be loaded into context without adding unnecessary tokens.

## What to write here
- Stable engineering rules, validation commands, architecture boundaries, coding style, and project-specific do/don't items.
- Facts that have been checked against code, index results, command output, or project documents.

## What not to write here
- Temporary plans, phase progress, full transcripts, large logs, raw index dumps, secrets, tokens, billing details, or private credentials.
- Short-term handoff content belongs in structured handoff/todo/verification records, not in long-term rules.

## Work rules
- Prefer facts over guesses: read code, project index, documentation, or command results before making claims.
- Natural-language commands do not bypass Start Gate or permission approval.
- Writing files, Bash, network access, dependency installation, and permission/config changes require explicit user confirmation.
- Long-term memory uses the controlled extraction runtime by default: stable taxonomy facts may be auto-written to the dedicated memory directory; uncertain content remains candidate-only.
- After code changes, run the smallest project-approved validation that covers the touched area.
- Do not paste full transcripts, huge logs, large index results, or full memory stores back into model context.
- Keep clean rewrite boundaries: reference public behavior and project docs, but do not copy suspicious or proprietary source.
- Be friendly to Chinese and English projects; keep names, commands, and errors readable for both when practical.
`;
  }

  return `# 项目规则

## 用途
- LINGHUN.md 记录项目长期稳定规则、稳定事实、常用命令和明确禁止事项。
- 保持短小清晰，避免把完整文件塞进上下文造成 token 负担。

## 应该写入
- 稳定工程规则、验证命令、架构边界、代码风格、项目专属约定和禁止事项。
- 已通过代码、项目索引、文档或命令结果确认过的事实。

## 不应该写入
- 临时计划、阶段进度、完整 transcript、大日志、原始索引结果、密钥、token、账单细节或私有凭据。
- 短期交接内容应进入结构化 handoff、Todo 或验证记录，不要追加到长期规则。

## 工作规则
- 事实优先：先读代码、项目索引、文档或命令结果，再判断和下结论。
- 自然语言命令不能绕过 Start Gate 或权限审批。
- 写文件、Bash、联网、安装依赖、权限或配置变更，都必须先得到用户明确确认。
- 长期记忆默认走受控 extraction runtime：稳定 taxonomy 事实可自动写入专用 memory dir；不确定内容仍保留候选。
- 改代码后运行项目认可的最小必要验证，覆盖本次改动范围。
- 不要把完整 transcript、大日志、大索引结果或完整 memory 塞回模型上下文。
- 遵守 clean rewrite：可参考公开行为和项目文档，不复制可疑或专有源码。
- 中文友好，同时尽量保留中英文项目名、命令和错误信息的可读性。

## 工程纪律
- 默认只做完成当前任务所必需的最小改动，不顺手修无关问题。
- 不主动新增抽象、helper、wrapper、目录层级或结构性改造。
- 优先局部补丁和现有代码风格，避免继续放大屎山、超长文件和复杂分支。
- 重构仅在必要、存在直接风险或用户明确要求时进行。
- 默认不改公共接口、依赖、配置、构建脚本、文件名和目录结构。
- 涉及超过 3 个文件、公共接口、依赖/配置、删除/重命名或明显重构时，先说明理由和范围。
- 修 bug 要定位直接原因，不接受只掩盖症状的补丁。
`;
}

export async function formatProjectRulesRead(context: TuiContext): Promise<string> {
  if (!(await pathExists(context.memory.projectRulesPath))) {
    context.memory.projectRulesExists = false;
    context.memory.projectRulesSummary = "missing";
    return context.language === "en-US"
      ? `Project rules file is missing: ${context.memory.projectRulesPath}\n- To create a template, run /memory init. I will not generate it automatically.`
      : `项目规则文件不存在：${context.memory.projectRulesPath}\n- 如需生成模板，请运行 /memory init。本次不会自动生成。`;
  }
  try {
    const content = await readFile(context.memory.projectRulesPath, "utf8");
    context.memory.projectRulesExists = true;
    context.memory.projectRulesSummary = summarizeProjectRules(content);
    context.memory.projectRulesError = undefined;
    return context.language === "en-US"
      ? `Project rules: ${context.memory.projectRulesPath}\n${truncateDisplay(content, 2000)}`
      : `项目规则：${context.memory.projectRulesPath}\n${truncateDisplay(content, 2000)}`;
  } catch (error) {
    context.memory.projectRulesExists = false;
    context.memory.projectRulesSummary = "unreadable";
    context.memory.projectRulesError = error instanceof Error ? error.message : String(error);
    return context.language === "en-US"
      ? `Failed to read project rules: ${context.memory.projectRulesError}`
      : `读取项目规则失败：${context.memory.projectRulesError}`;
  }
}
