import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { Writable } from "node:stream";
import type { TranscriptEvent } from "@linghun/core";
import { computePromptCacheHitRate } from "@linghun/core";
import { computeLocalCacheDisplayState } from "./cache-policy-runtime.js";
import { buildExplicitDetailsCommandPanel, showCommandPanel } from "./command-panel-runtime.js";
import {
  calculateContextPercentages,
  getNativeContextWindowForModel,
} from "./context-window-runtime.js";
import { formatBackgroundDetails, formatBackgroundOutputDetails } from "./job-runner-presenter.js";
import { formatLogArtifactSlice, readLogArtifactSlice } from "./log-artifact.js";
import { formatPermissionModeLabel, formatRuntimeStatusLine } from "./runtime-status-presenter.js";
import { readRuntimeLedgerRecords, type RuntimeLedgerRecord } from "./runtime-storage.js";
import { bindSessionRuntimeStorage } from "./session-runtime-storage.js";
import type { BackgroundTaskSummary, CommandPanelSection, CommandPanelView, ProductBlockViewModel } from "./shell/types.js";
import { formatModeBehavior } from "./slash-dispatch.js";
import { formatError, writeLine } from "./startup-runtime.js";
import type { TerminalReadinessView } from "./terminal-readiness-presenter.js";
import { createVerificationLevelForReadiness } from "./terminal-readiness-runtime.js";
import {
  createJobBackgroundTask,
  findBackgroundTask,
  findDurableJob,
  isRuntimeActiveBackgroundTask,
} from "./tui-agent-job-runtime.js";
import type { TuiContext } from "./tui-context-runtime.js";
import {
  createLogArtifactRegistry,
  findEvidence,
  formatEvidenceDetails,
  parseLogArtifactRequest,
} from "./tui-details-runtime.js";
import type { MessageKey } from "./tui-messages.js";
import { messages } from "./tui-messages.js";
import { getRuntimeStatusProvider, getSelectedModelRuntime } from "./tui-model-runtime.js";
import { formatEstimatedCny, sumCacheHistory, sumRoleUsageEstimatedCny } from "./usage-stats-presenter.js";
import { hydrateWorkflowRuns } from "./workflow-command-runtime.js";
import {
  type AssistantStreamOptions,
  createShellBlockOutputForTest,
  type TerminalFirstAssistantSink,
  writeErrorLine,
} from "./tui-output-surface.js";

// Module 4 — upsertJobBackgroundTask / createJobBackgroundTask /
// toJobContext / listDurableJobs / findDurableJob / getDurableJobsRoot /
// getDurableJobPaths / formatJobList / formatJobPrimary / formatJobReport /
// formatJobLogs 已移至 ./tui-agent-job-runtime.ts。

export async function handleDetailsCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  // /details 的所有 writeLine 都不应该覆盖 lastFullOutput，否则连续 /details
  // 会把"最近一次正文"替换成"上一次的 /details 总览"，陷入套娃。
  context.suppressLastFullOutputCapture = true;
  try {
    await runDetailsCommandBody(args, context, output);
  } finally {
    context.suppressLastFullOutputCapture = false;
  }
}

async function runDetailsCommandBody(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0];
  const id = args[1];
  if (action === "ledger" || action === "runtime") {
    writeLine(output, await formatRuntimeLedgerDetails(context));
    return;
  }
  if (action === "evidence") {
    const evidence = findEvidence(context, id);
    writeLine(
      output,
      evidence
        ? formatEvidenceDetails(evidence, context.projectPath)
        : "未找到 evidence。用法：/details evidence <id>",
    );
    return;
  }
  if (action === "background") {
    const task = await findDurableBackgroundTask(context, id);
    writeLine(
      output,
      task
        ? formatBackgroundDetails(task, context.language, context.projectPath)
        : "未找到 background。用法：/details background <id>",
    );
    return;
  }
  if (action === "output") {
    const task = await findDurableBackgroundTask(context, id);
    const evidence = task ? undefined : findEvidence(context, id);
    const logRequest = parseLogArtifactRequest(args.slice(2));
    if (logRequest) {
      if (!task && !evidence) {
        writeLine(
          output,
          "未找到 output。用法：/details output <backgroundId|evidenceId> --tail [lines] | --grep <pattern> [--context N] | --errors",
        );
        return;
      }
      try {
        const slice = await readLogArtifactSlice(
          task ? { backgroundId: task.id } : { evidenceId: evidence?.id },
          logRequest,
          createLogArtifactRegistry(context),
        );
        writeLine(output, formatLogArtifactSlice(slice, context.language));
      } catch (error) {
        writeErrorLine(output, formatError(error));
      }
      return;
    }
    if (task) {
      writeLine(output, formatBackgroundOutputDetails(task, context.language, context.projectPath));
      return;
    }
    writeLine(
      output,
      evidence
        ? formatEvidenceDetails(evidence, context.projectPath)
        : "未找到 output。用法：/details output <backgroundId|evidenceId>",
    );
    return;
  }
  if (action && action !== "list") {
    writeLine(
      output,
      "用法：/details | /details ledger | /details evidence <id> | /details background <id> | /details output <id>",
    );
    return;
  }

  const panel = buildExplicitDetailsCommandPanel(context);
  if (!panel) {
    writeLine(
      output,
      context.language === "en-US" ? "Nothing to expand right now." : "当前没有可展开的完整内容。",
    );
    return;
  }
  showCommandPanel(context, output, panel);
}

async function formatRuntimeLedgerDetails(context: TuiContext): Promise<string> {
  const result = await readRuntimeLedgerRecords(context.memory.sessionDir);
  if (result.records.length === 0) {
    return context.language === "en-US"
      ? "Runtime ledger is empty for the current session."
      : "当前会话 runtime ledger 为空。";
  }
  const recent = result.records.slice(-12);
  const counts = countRuntimeLedgerKinds(result.records);
  const lines = [
    context.language === "en-US" ? "Runtime ledger" : "运行时账本",
    `- total: ${result.records.length}`,
    `- kinds: ${Array.from(counts.entries()).map(([kind, count]) => `${kind}=${count}`).join(", ")}`,
    ...(result.diagnostics.length > 0
      ? [`- diagnostics: ${result.diagnostics.length} malformed line(s) skipped`]
      : []),
    context.language === "en-US" ? "Recent records:" : "最近记录：",
    ...recent.map((record) => `- ${formatRuntimeLedgerRecord(record)}`),
  ];
  return lines.join("\n");
}

function countRuntimeLedgerKinds(records: RuntimeLedgerRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const record of records) {
    counts.set(record.kind, (counts.get(record.kind) ?? 0) + 1);
  }
  return counts;
}

function formatRuntimeLedgerRecord(record: RuntimeLedgerRecord): string {
  return [
    record.kind,
    record.status ? `status=${record.status}` : "",
    record.evidenceId ? `evidence=${record.evidenceId}` : "",
    record.verificationId ? `verification=${record.verificationId}` : "",
    record.jobId ? `job=${record.jobId}` : "",
    record.agentId ? `agent=${record.agentId}` : "",
    record.workflowId ? `workflow=${record.workflowId}` : "",
    record.handoffId ? `handoff=${record.handoffId}` : "",
    record.artifactPath ? `artifact=${basename(record.artifactPath)}` : "",
    record.summary ? `summary=${record.summary}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

async function findDurableBackgroundTask(
  context: TuiContext,
  id: string | undefined,
): Promise<ReturnType<typeof findBackgroundTask>> {
  let task = findBackgroundTask(context, id);
  if (task || !id) return task;
  await hydrateWorkflowRuns(context);
  task = findBackgroundTask(context, id);
  if (task) return task;
  const job = await findDurableJob(context, id);
  return job ? createJobBackgroundTask(job, context) : undefined;
}

export function formatHomeScreen(context: TuiContext): string {
  const model = getSelectedModelRuntime(context).model;
  const project = basename(context.projectPath) || context.projectPath;
  const mode = formatPermissionModeLabel(context.permissionMode, context.language);
  if (context.language === "en-US") {
    return [
      `Project ${project} · Model ${model} · Mode ${mode}`,
      "You can describe a goal directly, like “check project status” or “run tests”.",
      "For exact commands, use /help.",
      formatModeBehavior(context.permissionMode, context.language),
      "",
    ].join("\n");
  }
  return [
    `项目 ${project} · 模型 ${model} · 模式 ${mode}`,
    "可以直接说“帮我检查项目状态 / 跑测试 / 解释这个报错”。",
    "需要精确命令时，用 /help 查看。",
    formatModeBehavior(context.permissionMode, context.language),
    "",
  ].join("\n");
}

export async function ensureSession(context: TuiContext): Promise<string> {
  if (context.sessionId) {
    if (context.sessionStoreVerifiedId === context.sessionId) {
      bindSessionRuntimeStorage(context, context.sessionId);
      context.sessionEnded = false;
      return context.sessionId;
    }
    try {
      await context.store.resume(context.sessionId);
      context.sessionStoreVerifiedId = context.sessionId;
      bindSessionRuntimeStorage(context, context.sessionId);
      context.sessionEnded = false;
      return context.sessionId;
    } catch (error) {
      if (!isSessionAppendRace(error)) {
        throw error;
      }
      context.sessionId = undefined;
    }
  }

  const session = await context.store.create({ model: context.model });
  context.sessionId = session.id;
  context.sessionStoreVerifiedId = session.id;
  bindSessionRuntimeStorage(context, session.id);
  context.sessionEnded = false;
  return session.id;
}

function isSessionAppendRace(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.message.includes("session not found") ||
    error.message.includes("未找到会话") ||
    error.message.includes("ended session")
  );
}

export const SILENT_OUTPUT_MARKER = Symbol.for("linghun.silentOutput");

export type SilentWritable = Writable & { [SILENT_OUTPUT_MARKER]?: true };

export function createSilentOutput(): Writable {
  const output = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  }) as SilentWritable;
  output[SILENT_OUTPUT_MARKER] = true;
  return output;
}

export function isSilentOutput(output: Writable): boolean {
  return (output as SilentWritable)[SILENT_OUTPUT_MARKER] === true;
}

export function formatShellBackgroundSummaries(context: TuiContext): BackgroundTaskSummary[] {
  return context.backgroundTasks
    .filter((task) => task.kind !== "agent" || task.status === "running")
    .filter(
      (task) => task.status === "running" || task.status === "paused" || task.status === "blocked",
    )
    .map((task) => ({
      id: task.id,
      kind: task.kind,
      title: task.title,
      status: task.status,
      currentStep: task.currentStep,
      progress: task.progress,
      result: task.result,
      nextAction: task.nextAction,
    }));
}

function isSessionEnded(transcript: TranscriptEvent[]): boolean {
  return transcript.at(-1)?.type === "session_end";
}

export function buildStatusPanel(context: TuiContext): CommandPanelView {
  const isEn = context.language === "en-US";
  const runtime = getSelectedModelRuntime(context);
  const provider = getRuntimeStatusProvider(context);
  const mode = formatPermissionModeLabel(context.permissionMode, context.language);

  // ── Summary (always visible) ──────────────────────────────────────────────
  const contextUsage = selectStatusContextUsage(context);
  const ctxLabel = contextUsage
    ? `${(contextUsage.ratio * 100).toFixed(0)}%`
    : "?";
  const summary = isEn
    ? [`Model ${runtime.model} · Ctx ${ctxLabel} · Mode ${mode}`]
    : [`模型 ${runtime.model} · 上下文 ${ctxLabel} · 模式 ${mode}`];

  // ── Sections (visible when expanded) ──────────────────────────────────────
  const sections: CommandPanelSection[] = [];

  // 1. Model
  sections.push({
    title: isEn ? "Model" : "模型/Model",
    rows: [
      isEn
        ? `Name: ${runtime.model}  Provider: ${provider}`
        : `名称: ${runtime.model}  Provider: ${provider}`,
      isEn
        ? `Endpoint: ${runtime.endpointProfile}  Reasoning: ${runtime.reasoningStatus}`
        : `Endpoint: ${runtime.endpointProfile}  推理: ${runtime.reasoningStatus}`,
    ],
  });

  // 2. Context
  if (contextUsage) {
    const usedK = contextUsage.usedTokens >= 1000
      ? `${Math.round(contextUsage.usedTokens / 1000)}k`
      : String(contextUsage.usedTokens);
    const maxK = contextUsage.maxTokens >= 1000
      ? `${Math.round(contextUsage.maxTokens / 1000)}k`
      : String(contextUsage.maxTokens);
    const pressure = context.cache.compactPressure;
    const pressureLabel = pressure
      ? ` compact-pressure ${(pressure.ratio * 100).toFixed(0)}%`
      : "";
    sections.push({
      title: isEn ? "Context" : "上下文/Context",
      rows: [
        `${contextUsage.bar} ${usedK}/${maxK} (${(contextUsage.ratio * 100).toFixed(1)}%)${pressureLabel}`,
      ],
    });
  } else {
    sections.push({
      title: isEn ? "Context" : "上下文/Context",
      rows: [isEn ? "No context usage data yet." : "暂无上下文数据。"],
    });
  }

  // 3. Cost
  const totals = sumCacheHistory(context.cache.history);
  const totalEstimatedCny = sumRoleUsageEstimatedCny(context);
  sections.push({
    title: isEn ? "Cost" : "费用/Cost",
    rows: [
      isEn
        ? `Estimated: ${formatEstimatedCny(totalEstimatedCny)}  Input: ${totals.inputTokens}  Output: ${totals.outputTokens}`
        : `估算: ${formatEstimatedCny(totalEstimatedCny)}  Input: ${totals.inputTokens}  Output: ${totals.outputTokens}`,
    ],
  });

  // 4. Provider health (breaker)
  const breakerEntries = [...context.providerBreaker.entries.values()];
  if (breakerEntries.length > 0) {
    const rows = breakerEntries.map((entry) => {
      const stateIcon =
        entry.state === "closed" ? "✓" : entry.state === "open" ? "✗" : "?";
      const cooldownInfo =
        entry.state === "open" && entry.cooldownUntil > Date.now()
          ? ` cooldown ${Math.ceil((entry.cooldownUntil - Date.now()) / 1000)}s`
          : "";
      return `${stateIcon} ${entry.providerId}/${entry.model} (${entry.state}${cooldownInfo})`;
    });
    sections.push({
      title: isEn ? "Provider Health" : "Provider 健康/Health",
      rows,
    });
  }

  // 5. Cache
  const latestHitRate = context.cache.history.at(-1)?.hitRate ?? null;
  const hitRateLabel = latestHitRate !== null
    ? `${Math.round(latestHitRate * 100)}%`
    : "n/a";
  const sessionHitRate = context.cache.history.length > 0
    ? computePromptCacheHitRate({
        inputTokens: totals.inputTokens,
        outputTokens: totals.outputTokens,
        cacheReadTokens: totals.cacheReadTokens,
        cacheWriteTokens: totals.cacheWriteTokens,
        provider,
        model: runtime.model,
      })
    : null;
  const sessionHitLabel = sessionHitRate !== null
    ? `${Math.round(sessionHitRate * 100)}%`
    : "n/a";
  sections.push({
    title: isEn ? "Cache" : "缓存/Cache",
    rows: [
      isEn
        ? `Last hit rate: ${hitRateLabel}  Session avg: ${sessionHitLabel}  Read: ${totals.cacheReadTokens}  Write: ${totals.cacheWriteTokens}`
        : `最近命中率: ${hitRateLabel}  会话均值: ${sessionHitLabel}  Read: ${totals.cacheReadTokens}  Write: ${totals.cacheWriteTokens}`,
    ],
  });

  // 6. Index
  const indexStatus = context.index.status;
  sections.push({
    title: isEn ? "Index" : "索引/Index",
    rows: [
      isEn
        ? `Status: ${indexStatus}${context.index.nodes ? `  Nodes: ${context.index.nodes}` : ""}${context.index.edges ? `  Edges: ${context.index.edges}` : ""}`
        : `状态: ${indexStatus}${context.index.nodes ? `  节点: ${context.index.nodes}` : ""}${context.index.edges ? `  边: ${context.index.edges}` : ""}`,
    ],
  });

  // 7. Rate limit (only if last provider failure indicates rate limiting)
  if (
    context.lastProviderFailure &&
    context.lastProviderFailure.code === "PROVIDER_RATE_LIMITED"
  ) {
    sections.push({
      title: isEn ? "Rate Limit" : "限流/Rate Limit",
      rows: [
        isEn
          ? `Provider ${context.lastProviderFailure.provider} rate limited (${context.lastProviderFailure.summary})`
          : `Provider ${context.lastProviderFailure.provider} 被限流 (${context.lastProviderFailure.summary})`,
      ],
    });
  }

  return {
    title: "/status",
    tone: "neutral",
    summary,
    sections,
    expanded: false,
  };
}

export function writeStatus(output: Writable, context: TuiContext): void {
  const background = context.backgroundTasks.filter(isRuntimeActiveBackgroundTask).length;
  const cacheObservation =
    context.cache.lastMainChainRequestObservation ??
    context.cache.lastRequestObservationByKind?.main ??
    context.cache.lastRequestObservation;
  const cacheStatus = computeLocalCacheDisplayState({
    history: context.cache.history,
    ...(cacheObservation?.promptCacheEnabled ? { observation: cacheObservation } : {}),
  });
  const gate = context.pendingLocalApproval
    ? "waiting approval"
    : context.pendingNaturalCommand || context.pendingAutopilot
      ? "waiting confirmation"
      : "none";
  const contextUsage = selectStatusContextUsage(context);
  writeLine(
    output,
    formatRuntimeStatusLine(
      {
        session: context.sessionId ?? (context.language === "en-US" ? "new" : "未创建"),
        provider: getRuntimeStatusProvider(context),
        model: getSelectedModelRuntime(context).model,
        endpointProfile: getSelectedModelRuntime(context).endpointProfile,
        reasoningStatus: getSelectedModelRuntime(context).reasoningStatus,
        mode: context.permissionMode,
        background,
        cacheHitRate: cacheStatus.hitRate,
        cacheFreshness: cacheStatus.freshness,
        indexStatus: context.index.status,
        gate,
        contextUsage,
      },
      context.language,
    ),
  );
}

function selectStatusContextUsage(
  context: TuiContext,
): ReturnType<typeof calculateContextPercentages> | undefined {
  const maxTokens = getNativeContextWindowForModel(context.model);
  const usage = context.cache.contextUsage;
  if (usage?.source === "provider_usage") {
    return calculateContextPercentages(
      usage.confirmedUsedTokens ?? Math.ceil(usage.estimatedChars / 4),
      maxTokens,
    );
  }
  if (context.cache.compactPressure) {
    return calculateContextPercentages(
      Math.ceil(context.cache.compactPressure.estimatedChars / 4),
      maxTokens,
    );
  }
  if (!usage) return undefined;
  return calculateContextPercentages(
    usage.confirmedUsedTokens ?? Math.ceil(usage.estimatedChars / 4),
    maxTokens,
  );
}

export function t(
  context: TuiContext,
  key: MessageKey,
  values: Record<string, string> = {},
): string {
  let template = messages[context.language][key];
  for (const [name, value] of Object.entries(values)) {
    template = template.replaceAll(`{${name}}`, value);
  }
  return template;
}

export function createUserMessageEvent(text: string): TranscriptEvent {
  return {
    type: "user_message",
    id: randomUUID(),
    text,
    createdAt: new Date().toISOString(),
  };
}

export function createSessionEndEvent(sessionId: string): TranscriptEvent {
  return {
    type: "session_end",
    sessionId,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Test-only factory. ShellBlockOutput 是 module-internal class（Ink shell 注入），
 * 这里仅为单测暴露一个等价构造器，让测试可以验证 assistant_text_delta 多片
 * 累积到同一条 keep:true block 而不是被 _write 的 ephemeral splice 淘汰。
 * 不要在生产代码里使用这个工厂。
 */
export function __testCreateShellBlockOutput(
  context: TuiContext,
  blocks: ProductBlockViewModel[],
  onWrite: () => void = () => {},
  terminalFirstAssistantSink?: TerminalFirstAssistantSink,
): Writable & {
  beginAssistantStream(id: string, options?: AssistantStreamOptions): void;
  appendAssistantDelta(text: string, id?: string): void;
  endAssistantStream(): void;
  cancelAssistantStream(): void;
  // D.13V — 暴露 retry/downgrade 路径上的 streaming block 操作，便于单测验证
  // unsupported first-pass final answer 不残留于 streaming block / lastFullOutput。
  discardAssistantBlock(id: string): void;
  replaceAssistantBlockContent(id: string, text: string): void;
  compactOutputMemory(options?: { projectMainScreen?: boolean }): Promise<{ beforeCount: number; afterCount: number }>;
} {
  return createShellBlockOutputForTest(context, blocks, onWrite, terminalFirstAssistantSink);
}

/**
 * D.13Q-UX Task Surface — 测试入口：暴露 explicit /details panel 装配器。
 * 单测用它验证 lastFullOutput / evidence / background 的 panel 化行为；
 * Ctrl+O 不走这个 CommandPanel 路径。
 */
export function __testBuildExplicitDetailsCommandPanel(
  context: TuiContext,
): import("./shell/types.js").CommandPanelView | undefined {
  return buildExplicitDetailsCommandPanel(context);
}

/**
 * D.13V-A — 测试入口：暴露 createVerificationLevelForReadiness。单测用它
 * 验证 readiness 不再绕过 verification-level 分级器（仅 build pass 的报告
 * 不应出现 level=real-smoke）。
 */
export function __testCreateVerificationLevelForReadiness(
  context: TuiContext,
): NonNullable<TerminalReadinessView["verificationLevel"]> {
  return createVerificationLevelForReadiness(context);
}
