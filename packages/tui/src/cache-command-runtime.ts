import { randomUUID } from "node:crypto";
import type { Writable } from "node:stream";
import type { CacheFreshness } from "@linghun/core";
import { diffFreshness } from "./cache-freshness.js";
import type { TuiContext } from "./index.js";
import type { CommandPanelView } from "./shell/types.js";
import { sanitizeDiagnosticText } from "./startup-runtime.js";
import type { LightHint } from "./tui-data-types.js";
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
        `#${item.turn} 命中率=${formatPercent(item.hitRate)} 输入=${item.inputTokens} 输出=${item.outputTokens} 缓存读取=${item.cacheReadTokens} 缓存写入=${item.cacheWriteTokens} 来源=${formatCacheWriteSource(item.cacheWriteTokensSource)} 模型=${item.model} provider=${item.provider}`,
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
    `- workspace reference: hits=${context.cache.workspaceReference.hits} misses=${context.cache.workspaceReference.misses} failures=${context.cache.workspaceReference.failures} latest=${context.cache.workspaceReference.latest?.source ?? "none"}`,
    `- workspace snapshot lite: ${formatWorkspaceSnapshotLiteStatus(context)}`,
    `- freshness changedKeys: ${changed.length > 0 ? changed.join(", ") : "none"}`,
    `- note: ${zeroNote}`,
  ].join("\n");
}

export function formatWorkspaceSnapshotLiteStatus(context: TuiContext): string {
  const snapshot = context.cache.workspaceReference.latest?.workspaceSnapshot;
  if (!snapshot) {
    return "none";
  }
  const changed = snapshot.changedSummary?.changedKeys.length
    ? snapshot.changedSummary.changedKeys.join(",")
    : "none";
  return `files=${snapshot.counts.files} dirs=${snapshot.counts.directories} ignored=${snapshot.counts.ignored} stored=${snapshot.counts.storedEntries} partial=${snapshot.partial ? "yes" : "no"} changed=${changed}`;
}

export function formatCompactStatus(context: TuiContext): string {
  const latest = context.cache.compactBoundaries.at(-1);
  const pressure = context.cache.compactPressure;
  const projection = context.cache.compactProjection;
  const deep = context.cache.deepCompact;
  const failure = context.cache.compactFailure;
  return [
    "Context Compact status",
    "- deep scope: full transcript semantic compact",
    "- projection scope: provider-visible recent context projection",
    `- pressure: ${pressure ? `${formatPercent(pressure.ratio)} (${pressure.estimatedChars}/${pressure.maxChars} chars; trigger=${pressure.triggerChars})` : "unknown"}`,
    `- compacted: ${context.cache.compacted ? "yes" : "no"}`,
    `- boundaries: ${context.cache.compactBoundaries.length}`,
    `- latest: ${latest ? `${latest.kind}/${latest.id}` : "none"}`,
    `- latest tokens: ${latest ? `${latest.preCompactTokenEstimate ?? "-"}->${latest.postCompactTokenEstimate ?? "-"}` : "-"}`,
    `- latest compact time: ${deep?.createdAt ?? projection?.createdAt ?? latest?.createdAt ?? "none"}`,
    `- deep packet: ${deep ? `${deep.id}; trigger=${deep.trigger}; events=${deep.transcriptEventCount}` : "none"}`,
    `- deep summary: ${deep ? sanitizeCompactStatusText(deep.summary.split(/\r?\n/u).slice(0, 4).join(" | ")) : "none"}`,
    `- projection summary: ${projection ? sanitizeCompactStatusText(projection.summary.split(/\r?\n/u).slice(0, 4).join(" | ")) : "none"}`,
    `- discarded/degraded scope: ${projection ? sanitizeCompactStatusText(projection.discardedRange) : "none"}`,
    `- tool pairing safe: ${projection ? (projection.toolPairingSafe ? "yes" : "no") : pressure ? (pressure.toolPairingSafe ? "yes" : "no") : "unknown"}`,
    `- failure/cooldown: ${failure ? `${failure.blocked ? "blocked" : "partial"}; ${sanitizeCompactStatusText(failure.reason)}; cooldownUntil=${failure.cooldownUntil}` : "none"}`,
    `- preserved evidence refs: ${deep?.preservedEvidenceRefs.length ?? latest?.preservedEvidenceRefs.length ?? 0}`,
    `- preserved files: ${deep?.preservedFiles.length ?? latest?.preservedFiles.length ?? 0}`,
    "- boundary: deep summary and projection are redacted; raw transcript, secrets, large tool results, provider raw requests, and absolute paths stay out.",
  ].join("\n");
}

function sanitizeCompactStatusText(value: string): string {
  return sanitizeDiagnosticText(value)
    .replace(
      /(api[_-]?key|apiKey|token|Authorization)(\s*[:=]\s*)(Bearer\s+)?[^\s;&,)}\]]+/giu,
      (_match, key: string, sep: string) => `${key}${sep}***`,
    )
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/giu, "Bearer ***")
    .replace(/sk-[A-Za-z0-9_-]+/gu, "sk-***");
}

export function collectLightHints(context: TuiContext): LightHint[] {
  const latest = context.cache.history.at(-1);
  const hints: LightHint[] = [];
  if (
    latest?.hitRate !== null &&
    latest?.hitRate !== undefined &&
    latest.hitRate < context.cache.config.warnBelowHitRate
  ) {
    hints.push(
      createLightHint(
        "cache-hit-low",
        "warning",
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
  const visibleHints = collectLightHints(context)
    .filter((hint) => now - (context.cache.hintLastShownAt[hint.dedupeKey] ?? 0) >= hint.cooldownMs)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, MAX_LIGHT_HINTS_PER_TURN);
  // D.13Q-UX Closure: writeLightHints 不再写主屏 transcript。
  // 改为推到 context.notifications 队列，由 view-model 复制给 view.notifications，
  // NotificationStack 右对齐单条主显（priority 高 = immediate）。
  // 不再需要 suppressLastFullOutputCapture workaround：
  // 既不写 transcript，就不会替换 lastFullOutput。
  if (visibleHints.length === 0) return;
  if (!context.notifications) context.notifications = [];
  for (const hint of visibleHints) {
    context.cache.hintLastShownAt[hint.dedupeKey] = now;
    const text = formatPlainLightHint(hint, context.language);
    context.notifications.push({
      key: `lighthint:${hint.dedupeKey}`,
      text,
      priority: hint.severity === "warning" ? "medium" : "low",
      timeoutMs: 5000,
      createdAt: now,
      tone: hint.severity === "warning" ? "warning" : "dim",
    });
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
