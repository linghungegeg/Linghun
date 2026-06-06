import type { RoleModelRoute } from "@linghun/config";
import { findKnownModel } from "@linghun/providers";

export type ContextPercentage = {
  usedTokens: number;
  maxTokens: number;
  ratio: number;
  label: string;
};

const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000;

export function getContextWindowForModel(
  model: string | undefined,
  route?: Pick<RoleModelRoute, "maxInputTokens">,
): number {
  return (
    route?.maxInputTokens ??
    findKnownModel(model ?? "")?.contextWindow ??
    DEFAULT_CONTEXT_WINDOW_TOKENS
  );
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
  };
}

function formatCompactNumber(value: number): string {
  if (value >= 1000) return `${Math.round(value / 1000)}k`;
  return String(value);
}
