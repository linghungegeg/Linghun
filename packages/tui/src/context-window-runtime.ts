import type { RoleModelRoute } from "@linghun/config";
import { findKnownModel } from "@linghun/providers";
import { readPositiveIntEnv } from "@linghun/shared";

export type ContextPercentage = {
  usedTokens: number;
  maxTokens: number;
  ratio: number;
  label: string;
  bar: string;
};

const DEFAULT_CONTEXT_WINDOW_TOKENS = readPositiveIntEnv("LINGHUN_CONTEXT_WINDOW_TOKENS", 128_000);
const CONTEXT_1M_TOKENS = 1_000_000;

/** Model name ends with `[1m]` (case-insensitive) → explicit 1M opt-in. */
function has1mSuffix(model: string | undefined): boolean {
  return model ? /\[1m\]$/i.test(model) : false;
}

export function getContextWindowForModel(
  model: string | undefined,
  route?: Pick<RoleModelRoute, "maxInputTokens">,
): number {
  if (route?.maxInputTokens) return route.maxInputTokens;
  if (has1mSuffix(model)) return CONTEXT_1M_TOKENS;
  return findKnownModel(model ?? "")?.contextWindow ?? DEFAULT_CONTEXT_WINDOW_TOKENS;
}

export function calculateContextPercentages(
  usedTokens: number,
  maxTokens: number,
): ContextPercentage {
  const safeUsed = Number.isFinite(usedTokens) ? Math.max(0, Math.ceil(usedTokens)) : 0;
  const safeMax = Number.isFinite(maxTokens) ? Math.max(1, Math.ceil(maxTokens)) : 1;
  const ratio = Math.min(1, safeUsed / safeMax);
  return {
    usedTokens: safeUsed,
    maxTokens: safeMax,
    ratio,
    label: `上下文 ${(ratio * 100).toFixed(1)}% (${formatCompactNumber(safeUsed)}/${formatCompactNumber(safeMax)})`,
    bar: formatContextProgressBar(ratio),
  };
}

export function formatContextProgressBar(ratio: number, width = 10): string {
  const safeWidth = Math.max(4, Math.floor(width));
  const safeRatio = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
  const filled = Math.round(safeRatio * safeWidth);
  return `[${"█".repeat(filled)}${"░".repeat(safeWidth - filled)}]`;
}

function formatCompactNumber(value: number): string {
  if (value >= 1000) return `${Math.round(value / 1000)}k`;
  return String(value);
}
