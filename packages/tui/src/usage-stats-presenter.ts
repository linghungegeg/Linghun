import { type CacheTurnStats, computePromptCacheHitRate } from "@linghun/core";
import type { TuiContext } from "./index.js";

export const CHAT_COMPLETIONS_ENDPOINT = "/v1/chat/completions";

export function formatUsage(context: TuiContext): string {
  const totals = sumCacheHistory(context.cache.history);
  const latest = context.cache.history.at(-1);
  return [
    "Usage（本会话原始 token/cache usage）",
    `- input tokens: ${totals.inputTokens}`,
    `- output tokens: ${totals.outputTokens}`,
    `- cache read tokens: ${totals.cacheReadTokens}`,
    `- cache write/create tokens: ${totals.cacheWriteTokens}`,
    `- model: ${latest?.model ?? context.model}`,
    `- provider: ${latest?.provider ?? "unknown"}`,
    `- endpoint: ${latest?.endpoint ?? CHAT_COMPLETIONS_ENDPOINT}`,
    `- compact: ${context.cache.compacted ? "yes" : "no"}`,
    `- rawUsage records: ${context.cache.history.filter((item) => item.rawUsage !== undefined).length}`,
    "- role usage (estimated):",
    ...formatRoleUsageLines(context),
    "- billing: 未记录真实账单字段；任何金额只能标记 estimated。",
  ].join("\n");
}

export function formatRoleUsageLines(context: TuiContext): string[] {
  if (context.roleUsage.length === 0) {
    return ["  - none yet"];
  }
  return context.roleUsage.map(
    (usage) =>
      `  - ${usage.role}/${usage.provider}/${usage.model}: input=${usage.inputTokens} output=${usage.outputTokens} cache_read=${usage.cacheReadTokens} cache_write=${usage.cacheWriteTokens} estimatedCny=${usage.estimatedCny.toFixed(4)} estimated createdAt=${usage.createdAt} fallbackUsed=${usage.fallbackUsed ? "yes" : "no"} budgetStop=${usage.budgetStop ? "yes" : "no"} contribution=${usage.contributionSummary}`,
  );
}

export function formatStats(args: string[], context: TuiContext): string {
  if (args[0] === "endpoints") {
    return formatEndpointStats(context.cache.history);
  }
  const totals = sumCacheHistory(context.cache.history);
  const latest = context.cache.history.at(-1);
  const provider = latest?.provider ?? "unknown";
  const hitRate = computePromptCacheHitRate({
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    cacheReadTokens: totals.cacheReadTokens,
    cacheWriteTokens: totals.cacheWriteTokens,
    provider,
    model: context.model,
  });
  return [
    "Stats",
    `- samples: ${context.cache.history.length}`,
    `- elapsedMs: ${Date.now() - context.cache.startedAt}`,
    `- model: ${context.model}`,
    `- provider: ${provider}`,
    `- hitRate: ${formatPercent(hitRate)}`,
    `- tokens: input=${totals.inputTokens}, output=${totals.outputTokens}, cache_read=${totals.cacheReadTokens}, cache_write=${totals.cacheWriteTokens}`,
    "- role/model/provider usage (estimated):",
    ...formatRoleUsageLines(context),
    "- cost: estimated unavailable（未配置价格；不伪装成真实账单；状态栏不显示金额）",
  ].join("\n");
}

export function formatEndpointStats(history: CacheTurnStats[]): string {
  if (history.length === 0) {
    return "Endpoint stats：暂无样本。";
  }
  const groups = new Map<string, CacheTurnStats[]>();
  for (const item of history) {
    const key = item.endpoint ?? "unknown";
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [
    "Endpoint stats",
    ...[...groups.entries()].map(([endpoint, items]) => {
      const totals = sumCacheHistory(items);
      const hitRate = computePromptCacheHitRate({
        inputTokens: totals.inputTokens,
        outputTokens: totals.outputTokens,
        cacheReadTokens: totals.cacheReadTokens,
        cacheWriteTokens: totals.cacheWriteTokens,
        provider: items[0]?.provider ?? "unknown",
        model: items[0]?.model ?? "unknown",
      });
      return `- ${endpoint}: samples=${items.length} hitRate=${formatPercent(hitRate)} input=${totals.inputTokens} output=${totals.outputTokens} cache_read=${totals.cacheReadTokens} cache_write=${totals.cacheWriteTokens}`;
    }),
  ].join("\n");
}

export function sumCacheHistory(history: CacheTurnStats[]): {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
} {
  return history.reduce(
    (total, item) => ({
      inputTokens: total.inputTokens + item.inputTokens,
      outputTokens: total.outputTokens + item.outputTokens,
      cacheReadTokens: total.cacheReadTokens + item.cacheReadTokens,
      cacheWriteTokens: total.cacheWriteTokens + item.cacheWriteTokens,
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  );
}

export function formatPercent(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}
