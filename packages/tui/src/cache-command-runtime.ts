import { randomUUID } from "node:crypto";
import type { Writable } from "node:stream";
import type { CacheFreshness } from "@linghun/core";
import { redactCommonSecrets } from "@linghun/shared";
import {
  diagnoseCacheBreak,
  formatCacheBreakDiagnosis,
} from "./cache-break-diagnostics-runtime.js";
import { diffFreshness } from "./cache-freshness.js";
import type { CacheRequestObservation } from "./cache-policy-runtime.js";
import {
  calculateContextPercentages,
  formatContextProgressBar,
  getContextWindowForModel,
} from "./context-window-runtime.js";
import type { TuiContext } from "./index.js";
import type { CommandPanelView } from "./shell/types.js";
import { sanitizeDiagnosticText } from "./startup-runtime.js";
import type { LightHint, CompactProgressSnapshot } from "./tui-data-types.js";
import { getSelectedModelRuntime } from "./tui-model-runtime.js";
import { formatPercent } from "./usage-stats-presenter.js";
const DEFAULT_LIGHT_HINT_COOLDOWN_MS = 5 * 60 * 1000;
const MAX_LIGHT_HINTS_PER_TURN = 1;

/**
 * D.13Q-UX Task Surface — /cache 的降噪 CommandPanel 视图。
 * 仅暴露：是否启用、最近一轮 hitRate、是否 cache_low、下一步。
 * compacted / cacheReadTokens / cacheWriteTokens / freshness 等内部字段
 * 进 detailsText（Ctrl+O 展开）。
 */
export function buildCacheStatusPanel(
  context: TuiContext,
  currentFreshness: CacheFreshness,
): CommandPanelView {
  const isEn = context.language === "en-US";
  const last = context.cache.history.at(-1);
  const hitRate = last?.hitRate ?? null;
  const summary: string[] = [];
  if (hitRate === null || Number.isNaN(hitRate)) {
    summary.push(isEn ? "Cache · no usage yet" : "缓存 · 尚无样本");
  } else {
    const pct = `${Math.round(hitRate * 100)}%`;
    summary.push(isEn ? `Cache hit rate: ${pct}` : `缓存命中率：${pct}`);
  }
  const isLow = typeof hitRate === "number" && Number.isFinite(hitRate) && hitRate < 0.3;
  const tone: "neutral" | "warning" = isLow ? "warning" : "neutral";
  if (isLow) {
    summary.push(
      isEn
        ? "Hit rate is low — try /cache warmup or check provider usage."
        : "命中率偏低 — 可运行 /cache warmup 或核对 provider usage。",
    );
  }
  const promptSections = context.cache.lastPromptSections;
  if (promptSections) {
    const dynamicPct = Math.round((promptSections.dynamicChars / Math.max(promptSections.totalChars, 1)) * 100);
    summary.push(
      isEn
        ? `Prompt dynamic share: ${dynamicPct}% · largest ${promptSections.largestSection ?? "none"}`
        : `Prompt 动态占比：${dynamicPct}% · 最大段 ${promptSections.largestSection ?? "无"}`,
    );
  }
  return {
    title: "/cache",
    tone,
    summary,
    actions: ["/cache warmup", "/cache refresh"],
    detailsText: formatCacheStatus(context, currentFreshness),
  };
}

export function formatCacheLog(context: TuiContext): string {
  if (context.cache.history.length === 0) {
    return "最近缓存日志为空。真实 usage 需要 provider 返回 token/cache 字段；可用 /cache warmup 尝试预热。";
  }
  return [
    `Cache log 最近 ${context.cache.history.length}/${context.cache.config.maxTurns} 轮：`,
    ...context.cache.history.map(
      (item) =>
        `#${item.turn} 命中率 ${formatPercent(item.hitRate)} 输入 ${item.inputTokens} 输出 ${item.outputTokens} 缓存读取 ${item.cacheReadTokens} 缓存写入 ${item.cacheWriteTokens} 来源 ${formatCacheWriteSource(item.cacheWriteTokensSource)} 模型 ${item.model} provider ${item.provider}`,
    ),
  ].join("\n");
}

function formatCacheWriteSource(source: string): string {
  if (source === "reported") return "provider reported";
  if (source === "zero_reported") return "provider reported zero";
  if (source === "estimated") return "estimated";
  return "not reported";
}

export function formatCacheStatus(context: TuiContext, currentFreshness: CacheFreshness): string {
  const latest = context.cache.history.at(-1);
  const freshness = latest?.freshness ?? currentFreshness;
  const changed =
    latest?.freshness.changedKeys ?? diffFreshness(context.cache.lastFreshness, freshness);
  const source = latest?.cacheWriteTokensSource ?? "missing";
  const latestObservation = context.cache.lastRequestObservation;
  const diagnosticObservation = context.cache.lastMainChainRequestObservation ?? latestObservation;
  const diagnosis = diagnoseCacheBreak({
    latest,
    observation: diagnosticObservation,
    freshnessChangedKeys: changed,
    warnBelowHitRate: context.cache.config.warnBelowHitRate,
    postCompactWarmup: context.cache.postCompactCacheWarmup,
  });
  const zeroNote =
    source === "zero_reported"
      ? "provider 当前返回 cache_creation/cache write 为 0；这只是字段口径，不代表零写入成本。"
      : source === "missing"
        ? "provider 未返回 cache_creation/cache write 字段；不支持真实缓存写入统计。"
        : "cache write/create 字段来自 provider/API usage。";
  return [
    "Cache status",
    `- history: ${context.cache.history.length}/${context.cache.config.maxTurns}`,
    `- latest hitRate: ${formatPercent(latest?.hitRate ?? null)}（公式：cacheRead / (input + cacheWrite + cacheRead)，output 不进分母）`,
    `- read/write tokens: ${latest?.cacheReadTokens ?? 0}/${latest?.cacheWriteTokens ?? 0}`,
    `- cache write source: ${source}`,
    `- compact: ${context.cache.compacted ? "yes" : "no"}`,
    `- post-compact warmup: ${formatPostCompactWarmupStatus(context)}`,
    `- prompt sections: ${formatPromptSectionsStatus(context)}`,
    `- workspace reference: hits ${context.cache.workspaceReference.hits}; misses ${context.cache.workspaceReference.misses}; failures ${context.cache.workspaceReference.failures}; latest ${context.cache.workspaceReference.latest?.source ?? "none"}`,
    `- workspace snapshot lite: ${formatWorkspaceSnapshotLiteStatus(context)}`,
    `- freshness changedKeys: ${changed.length > 0 ? changed.join(", ") : "none"}`,
    `- latest telemetry: ${formatCacheTelemetryObservation(latestObservation)}`,
    `- telemetry by kind: ${formatCacheTelemetryByKind(context.cache.lastRequestObservationByKind)}`,
    `- drift reason: ${formatCacheTelemetryDrift(diagnosticObservation)}`,
    `- break diagnosis: ${formatCacheBreakDiagnosis(diagnosis)}`,
    `- note: ${zeroNote}`,
  ].join("\n");
}

function formatPostCompactWarmupStatus(context: TuiContext): string {
  const warmup = context.cache.postCompactCacheWarmup;
  if (!warmup) return "none";
  const lastChanged = warmup.lastChangedKeys.length > 0 ? warmup.lastChangedKeys.join(",") : "none";
  return `${warmup.status}; compact ${warmup.compactId}; remaining ${warmup.remainingTurns}/${warmup.totalTurns}; summary ${warmup.summaryHash}; baseline ${warmup.baselinePrefixHash ?? "pending"}; changed ${lastChanged}`;
}

function formatPromptSectionsStatus(context: TuiContext): string {
  const snapshot = context.cache.lastPromptSections;
  if (!snapshot) return "none";
  const dynamicPct = snapshot.totalChars > 0 ? snapshot.dynamicChars / snapshot.totalChars : 0;
  const topSections = [...snapshot.sections]
    .sort((a, b) => b.chars - a.chars)
    .slice(0, 5)
    .map((section) => {
      const bar = formatContextProgressBar(section.percent, 12);
      const volatility = section.volatile ? "volatile" : "stable";
      const truncated = section.truncated ? "; truncated" : "";
      return `${section.name} ${bar} ${formatPercent(section.percent)} ${section.chars} chars ${volatility}${truncated}`;
    });
  const headline = `stable ${snapshot.stableChars} chars; dynamic ${snapshot.dynamicChars} chars (${formatPercent(dynamicPct)}); largest ${snapshot.largestSection ?? "none"}; sampled ${snapshot.createdAt}`;
  return topSections.length > 0 ? `${headline}; top ${topSections.join(" | ")}` : headline;
}

const CACHE_REQUEST_KIND_ORDER: CacheRequestObservation["kind"][] = [
  "main",
  "continuation",
  "final",
  "agent-child",
  "side-question",
  "deep-compact",
];

function formatCacheTelemetryObservation(observation: CacheRequestObservation | undefined): string {
  if (!observation) return "none";
  const usage = observation.usage;
  const usageText = usage
    ? `usage ${usage.source}; read/write ${usage.cacheReadTokens}/${usage.cacheWriteTokens}; input/output ${usage.inputTokens}/${usage.outputTokens}; endpoint ${usage.endpoint ?? "unknown"}`
    : "usage pending";
  return [
    `${observation.kind}`,
    `provider ${observation.provider}`,
    `model ${observation.model}`,
    `profile ${observation.endpointProfile ?? "default"}`,
    `messages/tools ${observation.messageCount}/${observation.toolCount}`,
    `cache ${observation.promptCacheEnabled ? "enabled" : "disabled"}${observation.promptCacheTtl ? ` ttl ${observation.promptCacheTtl}` : ""}${observation.hasCacheBreakNonce ? " break-nonce" : ""}`,
    usageText,
  ].join("; ");
}

function formatCacheTelemetryByKind(
  byKind: Partial<Record<CacheRequestObservation["kind"], CacheRequestObservation>> | undefined,
): string {
  if (!byKind) return "none";
  const parts = CACHE_REQUEST_KIND_ORDER.map((kind) => {
    const observation = byKind[kind];
    if (!observation) return undefined;
    const usage = observation.usage;
    const usageText = usage
      ? `r/w ${usage.cacheReadTokens}/${usage.cacheWriteTokens} ${usage.source}`
      : "usage pending";
    return `${kind}:${observation.provider}/${observation.endpointProfile ?? "default"}/${usageText}`;
  }).filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" | ") : "none";
}

function formatCacheTelemetryDrift(observation: CacheRequestObservation | undefined): string {
  const changedKeys = observation?.fingerprint.changedKeys ?? [];
  if (changedKeys.length === 0) return "none";
  return changedKeys.map(formatCacheFingerprintChangedKey).join(", ");
}

function formatCacheFingerprintChangedKey(key: string): string {
  switch (key) {
    case "requestHash":
      return "request shape changed";
    case "messagePrefixHash":
      return "stable message prefix changed";
    case "systemPrefixHash":
      return "system prefix changed";
    case "conversationPrefixHash":
      return "conversation prefix changed";
    case "latestMessageHash":
      return "latest message changed";
    case "toolSchemaHash":
      return "tools changed";
    case "stableToolSchemaHash":
      return "stable tools changed";
    case "dynamicToolSchemaHash":
      return "dynamic tools changed";
    case "modelHash":
      return "model/toolChoice changed";
    case "reasoningHash":
      return "reasoning changed";
    case "cacheConfigHash":
      return "cache config changed";
    default:
      return key;
  }
}

export function formatWorkspaceSnapshotLiteStatus(context: TuiContext): string {
  const snapshot = context.cache.workspaceReference.latest?.workspaceSnapshot;
  if (!snapshot) {
    return "none";
  }
  const changed = snapshot.changedSummary?.changedKeys.length
    ? snapshot.changedSummary.changedKeys.join(",")
    : "none";
  return `files ${snapshot.counts.files}; dirs ${snapshot.counts.directories}; ignored ${snapshot.counts.ignored}; stored ${snapshot.counts.storedEntries}; partial ${snapshot.partial ? "yes" : "no"}; changed ${changed}`;
}

export function formatCompactStatus(context: TuiContext): string {
  const latest = context.cache.compactBoundaries.at(-1);
  const pressure = context.cache.compactPressure;
  const runtime = getSelectedModelRuntime(context);
  const contextUsage = pressure
    ? calculateContextPercentages(
        Math.ceil(pressure.estimatedChars / 4),
        Math.ceil(pressure.maxChars / 4) || getContextWindowForModel(runtime.model),
      )
    : undefined;
  const projection = context.cache.compactProjection;
  const activeProgress = context.cache.compactProgress ?? projection?.progress;
  const deep = context.cache.deepCompact;
  const failure = context.cache.compactFailure;
  const lines = [
    "Context Compact status",
    `- pressure: ${pressure ? `${formatPercent(pressure.ratio)} (${pressure.estimatedChars}/${pressure.maxChars} chars; trigger ${pressure.triggerChars})` : "unknown"}`,
    `- compacted: ${context.cache.compacted ? "yes" : "no"} · boundaries: ${context.cache.compactBoundaries.length}`,
    `- latest: ${latest ? `${latest.kind}/${latest.id}` : "none"}`,
    `- latest tokens: ${latest ? `${latest.preCompactTokenEstimate ?? "-"}→${latest.postCompactTokenEstimate ?? "-"}` : "-"}`,
    `- latest compact time: ${deep?.createdAt ?? projection?.createdAt ?? latest?.createdAt ?? "none"}`,
  ];
  // Phase 10: 可视化 token 分布条形图
  if (contextUsage) {
    const bar = formatContextProgressBar(contextUsage.ratio, 24);
    lines.push(`  context ${bar} ${contextUsage.usedTokens}/${contextUsage.maxTokens}`);
  }
  // Phase 10: API token count 当前只持久化 inputTokens；不要展示未记录的 output。
  const apiInputTokens = context.lastApiTokenCount?.inputTokens;
  if (apiInputTokens !== undefined) {
    const inputK = Math.round(apiInputTokens / 1000);
    lines.push(`  latest request tokens: input ${inputK}k`);
  }
  lines.push(
    "- deep scope: full transcript semantic compact",
    "- projection scope: provider-visible recent context projection",
    `- deep packet: ${deep ? `${deep.id}; trigger ${deep.trigger}; events ${deep.transcriptEventCount}` : "none"}`,
    `- deep summary: ${deep ? sanitizeCompactStatusText(deep.summary.split(/\r?\n/).slice(0, 4).join(" | ")) : "none"}`,
    `- projection summary: ${projection ? sanitizeCompactStatusText(projection.summary.split(/\r?\n/).slice(0, 4).join(" | ")) : "none"}`,
    `- projection budget: ${projection?.postCompactTargetChars !== undefined ? `target ${projection.postCompactTargetChars} chars; post ${projection.postCompactChars} chars; saved ${((projection.savingsRatio ?? 0) * 100).toFixed(1)}%` : "none"}`,
    `- acceptance: ${projection?.acceptance ? `budget ${projection.acceptance.budget}; replacement ${projection.acceptance.replacementProjection}; terminal ${projection.acceptance.terminalVisibleProjection}; notice ${projection.acceptance.uiNotice}` : "none"}`,
  );
  const compactProgress = formatCompactProgressBar(activeProgress);
  if (compactProgress) {
    lines.push(`- progress: ${compactProgress}`);
  }
  lines.push(
    `- rollback: ${projection?.acceptance ? projection.acceptance.rollback : "none"}`,
    `- feature flags: ${projection?.acceptance?.featureFlags ? `replacement ${projection.acceptance.featureFlags.replacementProjection ? "on" : "off"}; terminal projection ${projection.acceptance.featureFlags.terminalVisibleProjection ? "on" : "off"}; retained budget ${projection.acceptance.featureFlags.retainedBudget ? "on" : "off"}` : "unknown"}`,
    `- restore context: ${projection?.restoreContext ? `goal ${sanitizeCompactStatusText(projection.restoreContext.goal)}; task ${sanitizeCompactStatusText(projection.restoreContext.currentTask)}; files ${projection.restoreContext.keyFiles.length}; evidence ${projection.restoreContext.evidenceRefs.length}; pending ${projection.restoreContext.pendingItems.length}` : "none"}`,
    `- discarded/degraded scope: ${projection ? sanitizeCompactStatusText(projection.discardedRange) : "none"}`,
    `- tool pairing safe: ${projection ? (projection.toolPairingSafe ? "yes" : "no") : pressure ? (pressure.toolPairingSafe ? "yes" : "no") : "unknown"}`,
    `- failure/cooldown: ${failure ? `${failure.blocked ? "blocked" : "partial"}; ${sanitizeCompactStatusText(failure.reason)}; cooldown until ${failure.cooldownUntil}` : "none"}`,
    `- preserved evidence refs: ${deep?.preservedEvidenceRefs.length ?? latest?.preservedEvidenceRefs.length ?? 0}`,
    `- preserved files: ${deep?.preservedFiles.length ?? latest?.preservedFiles.length ?? 0}`,
    "- boundary: deep summary and projection are redacted; raw transcript, secrets, large tool results, provider raw requests, and absolute paths stay out.",
  );
  // Phase 10: 优化建议
  const suggestions = buildCompactSuggestions(context, contextUsage, pressure);
  if (suggestions.length > 0) {
    lines.push("", ...suggestions);
  }
  return lines.join("\n");
}

export function formatCompactProgressBar(progress: CompactProgressSnapshot | undefined): string | undefined {
  if (!progress || progress.status === "complete") return undefined;
  const stage = progress.stages.at(-1);
  if (!stage) return "compact running";
  return `compact ${formatContextProgressBar(compactStageRatio(stage), 12)} ${formatCompactProgressStage(stage)}`;
}

function compactStageRatio(stage: CompactProgressSnapshot["stages"][number]): number {
  switch (stage) {
    case "scan_context":
      return 0.2;
    case "generate_summary":
      return 0.45;
    case "trim_old_records":
      return 0.7;
    case "restore_context":
      return 0.9;
    case "complete":
      return 1;
  }
}

function formatCompactProgressStage(stage: CompactProgressSnapshot["stages"][number]): string {
  return stage.replace(/_/g, "-");
}

function buildCompactSuggestions(
  context: TuiContext,
  usage: ReturnType<typeof calculateContextPercentages> | undefined,
  pressure:
    | { ratio: number; toolPairingSafe: boolean; estimatedChars: number; triggerChars: number }
    | undefined,
): string[] {
  const out: string[] = [];
  const en = context.language === "en-US";
  if (!usage || !pressure) return out;
  if (usage.ratio > 0.85) {
    out.push(
      en
        ? `⚠ Suggestion: Context at ${(usage.ratio * 100).toFixed(0)}% — run /compact to summarize older context and free capacity.`
        : `⚠ 建议：上下文使用率 ${(usage.ratio * 100).toFixed(0)}% — 运行 /compact 摘要较早上下文以释放容量。`,
    );
  } else if (usage.ratio > 0.7) {
    out.push(
      en
        ? `Suggestion: Context at ${(usage.ratio * 100).toFixed(0)}% — approaching limit. Compact is available when needed.`
        : `建议：上下文使用率 ${(usage.ratio * 100).toFixed(0)}% — 接近上限。需要时可运行 /compact。`,
    );
  }
  if (usage.ratio > 0.6 && !context.cache.compacted) {
    out.push(
      en
        ? "Tip: Auto-compact triggers around 80%. You can also run /compact for a semantic rewrite of older context."
        : "提示：自动压缩约在 80% 触发。你也可以运行 /compact 对较早上下文做语义重写。",
    );
  }
  return out;
}

function sanitizeCompactStatusText(value: string): string {
  return sanitizeDiagnosticText(redactCommonSecrets(value));
}

export function collectLightHints(context: TuiContext): LightHint[] {
  const latest = context.cache.history.at(-1);
  const hints: LightHint[] = [];
  const postCompactWarming = context.cache.postCompactCacheWarmup?.status === "warming";
  if (
    !postCompactWarming &&
    latest?.hitRate !== null &&
    latest?.hitRate !== undefined &&
    latest.hitRate < context.cache.config.warnBelowHitRate
  ) {
    hints.push(
      createLightHint(
        "cache-hit-low",
        "info",
        10,
        context.language === "en-US"
          ? "Reuse became less effective in the latest turn"
          : "最近一轮复用效果变低",
        "/break-cache status",
      ),
    );
  }
  if ((latest?.inputTokens ?? 0) > 96_000) {
    hints.push(
      createLightHint(
        "context-long",
        "info",
        4,
        context.language === "en-US"
          ? "This conversation is getting long; compact only if it starts feeling slow"
          : "这轮对话较长；如果开始变慢，再按需压缩",
        "/compact",
      ),
    );
  }
  if (postCompactWarming) {
    hints.push(
      createLightHint(
        "cache-post-compact-warmup",
        "info",
        9,
        context.language === "en-US"
          ? "Cache is warming after compact; low reuse is expected for the next turn or two"
          : "压缩后缓存正在重建；接下来一两轮低复用属于预热期",
        "/cache status",
      ),
    );
  }
  if (latest?.cacheWriteTokensSource === "zero_reported" && latest.cacheReadTokens > 0) {
    hints.push(
      createLightHint(
        "cache-zero-create-with-read",
        "info",
        2,
        context.language === "en-US"
          ? "Usage numbers may need checking before cost claims"
          : "要下成本结论前，建议先核对用量口径",
        "/usage",
      ),
    );
  }
  const changedKeys = latest?.freshness.changedKeys ?? [];
  if (
    changedKeys.some((key) =>
      ["systemPromptHash", "toolSchemaHash", "mcpToolListHash"].includes(key),
    )
  ) {
    hints.push(
      createLightHint(
        "freshness-changed",
        "warning",
        8,
        context.language === "en-US"
          ? "Project context changed; refresh reuse data when results look stale"
          : "项目上下文有变化；结果像旧信息时再刷新复用数据",
        "/cache warmup",
      ),
    );
  }
  return hints;
}

export function createLightHint(
  dedupeKey: string,
  severity: "info" | "warning",
  priority: number,
  message: string,
  suggestedCommand: string,
): LightHint {
  return {
    id: randomUUID(),
    severity,
    priority,
    message,
    suggestedCommand,
    dedupeKey,
    cooldownMs: DEFAULT_LIGHT_HINT_COOLDOWN_MS,
  };
}

export function writeLightHints(_output: Writable, context: TuiContext): void {
  if (context.cache.config.hintsMuted) {
    return;
  }
  const now = Date.now();
  for (const hint of collectLightHints(context)
    .filter((hint) => now - (context.cache.hintLastShownAt[hint.dedupeKey] ?? 0) >= hint.cooldownMs)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, MAX_LIGHT_HINTS_PER_TURN)) {
    context.cache.hintLastShownAt[hint.dedupeKey] = now;
  }
}

export function formatPlainLightHint(hint: LightHint, language: TuiContext["language"]): string {
  const isEn = language === "en-US";
  switch (hint.dedupeKey) {
    case "cache-hit-low":
      return isEn
        ? "Cache reuse dipped a bit; the next response may be slower."
        : "最近缓存复用变低，后续响应可能会慢一点。";
    case "context-long":
      return isEn
        ? "This conversation is getting long; compact only if it starts feeling slow."
        : "这轮对话较长；如果开始变慢，再按需压缩。";
    case "cache-post-compact-warmup":
      return isEn
        ? "Cache is warming after compact; judge persistent breaks after the warmup window."
        : "压缩后缓存正在预热；等预热窗口过后再判断是否持续破坏。";
    case "cache-zero-create-with-read":
      return isEn
        ? "Usage numbers may need a quick check before drawing cost conclusions."
        : "用量数据可能需要复核后再下结论。";
    case "freshness-changed":
      return isEn
        ? "Project context changed; refresh reuse data when results look stale."
        : "项目上下文有变化；结果像旧信息时再刷新。";
    default:
      return hint.message;
  }
}

export function writeLightHintsForTest(output: Writable, context: TuiContext): void {
  writeLightHints(output, context);
}
