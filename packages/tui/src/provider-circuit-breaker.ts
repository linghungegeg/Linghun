import type { Language } from "@linghun/shared";
import { readPositiveIntEnv } from "@linghun/shared";

/**
 * Provider Circuit Breaker / Cooldown — D.8 Provider Resilience Lite
 *
 * In-memory, per provider+model cooldown to avoid hammering a provider
 * that is returning recoverable failures (429/502/503/504, request timeout,
 * stream idle timeout, network TypeError).
 *
 * Does NOT persist state. Does NOT block user manual retry after cooldown.
 * Does NOT affect auth/schema/abort failures.
 */

export type BreakerKey = string;

export type BreakerEntry = {
  providerId: string;
  model: string;
  state: "closed" | "open" | "half-open";
  consecutiveFailures: number;
  lastFailureAt: number;
  cooldownUntil: number;
  reasonCode: string;
};

export type ProviderCircuitBreakerState = {
  entries: Map<BreakerKey, BreakerEntry>;
};

const BREAKER_FAILURE_THRESHOLD = 10;
const BREAKER_COOLDOWN_MS = readPositiveIntEnv("LINGHUN_PROVIDER_BREAKER_COOLDOWN_MS", 120_000);

/** Recoverable error codes that trigger the breaker. */
const RECOVERABLE_CODES = new Set([
  "PROVIDER_SERVER_ERROR",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_REQUEST_TIMEOUT",
  "PROVIDER_STREAM_TIMEOUT",
  "PROVIDER_NETWORK_ERROR",
  "PROVIDER_STREAM_ERROR",
  "PROVIDER_STREAM_DECODE_ERROR",
  "PROVIDER_RETRY_EXHAUSTED",
  "PROVIDER_NON_SSE_STREAM",
  "PROVIDER_MALFORMED_STREAM",
]);

export function createProviderCircuitBreakerState(): ProviderCircuitBreakerState {
  return { entries: new Map() };
}

export function makeBreakerKey(providerId: string, model: string): BreakerKey {
  return `${providerId}::${model}`;
}

/**
 * Returns true if the error code is a recoverable provider failure
 * that should count toward the circuit breaker threshold.
 */
export function isRecoverableProviderFailure(errorCode: string): boolean {
  return RECOVERABLE_CODES.has(errorCode);
}

/**
 * Record a provider failure. If the failure is recoverable and the threshold
 * is reached, the breaker enters cooldown.
 * Returns true if this call caused the breaker to open (state transition to "open").
 */
export function recordProviderFailure(
  state: ProviderCircuitBreakerState,
  providerId: string,
  model: string,
  errorCode: string,
): boolean {
  if (!isRecoverableProviderFailure(errorCode)) {
    return false;
  }
  const key = makeBreakerKey(providerId, model);
  const existing = state.entries.get(key);
  const previousState = existing?.state ?? "closed";
  const now = Date.now();
  const consecutiveFailures = (existing?.consecutiveFailures ?? 0) + 1;
  const cooldownUntil =
    consecutiveFailures >= BREAKER_FAILURE_THRESHOLD ? now + BREAKER_COOLDOWN_MS : 0;
  const breakerState = cooldownUntil > 0 ? "open" : "closed";
  state.entries.set(key, {
    providerId,
    model,
    state: breakerState,
    consecutiveFailures,
    lastFailureAt: now,
    cooldownUntil,
    reasonCode: errorCode,
  });
  return breakerState === "open" && previousState !== "open";
}

/**
 * Clear the breaker for a provider+model after a successful request.
 */
export function clearProviderBreaker(
  state: ProviderCircuitBreakerState,
  providerId: string,
  model: string,
): void {
  state.entries.delete(makeBreakerKey(providerId, model));
}

export type CooldownCheckResult =
  | { blocked: false }
  | { blocked: true; remainingMs: number; reasonCode: string; entry: BreakerEntry };

/**
 * Check if a provider+model is currently in cooldown.
 * Returns remaining cooldown time if blocked.
 */
export function checkProviderCooldown(
  state: ProviderCircuitBreakerState,
  providerId: string,
  model: string,
): CooldownCheckResult {
  const key = makeBreakerKey(providerId, model);
  const entry = state.entries.get(key);
  if (!entry || entry.cooldownUntil === 0) {
    return { blocked: false };
  }
  const now = Date.now();
  if (now >= entry.cooldownUntil) {
    entry.state = "half-open";
    entry.cooldownUntil = 0;
    state.entries.set(key, entry);
    return { blocked: false };
  }
  return {
    blocked: true,
    remainingMs: entry.cooldownUntil - now,
    reasonCode: entry.reasonCode,
    entry,
  };
}

/**
 * Format a human-readable cooldown message for the user.
 * Does NOT leak API keys, raw URLs, or raw responses.
 */
export function formatCooldownMessage(
  providerId: string,
  model: string,
  remainingMs: number,
  language: Language,
): string {
  const seconds = Math.ceil(remainingMs / 1000);
  if (language === "en-US") {
    return [
      `Model service ${providerId}/${model} is temporarily unstable and waiting before retry.`,
      `Retry available in ~${seconds}s.`,
      "You can run /model doctor to diagnose, or switch provider/model with /model.",
    ].join(" ");
  }
  return [
    `模型服务 ${providerId}/${model} 暂时不稳定，正在等待恢复。`,
    `约 ${seconds} 秒后可重试。`,
    "可运行 /model doctor 诊断，或用 /model 切换服务商或模型。",
  ].join("");
}

/**
 * Format a short cooldown status line for doctor/problems output.
 */
export function formatCooldownDoctorLine(
  state: ProviderCircuitBreakerState,
  language: Language,
): string | undefined {
  const now = Date.now();
  const active: string[] = [];
  for (const entry of state.entries.values()) {
    if (entry.cooldownUntil > now) {
      const seconds = Math.ceil((entry.cooldownUntil - now) / 1000);
      active.push(
        language === "en-US"
          ? `${entry.providerId}/${entry.model} waiting=${seconds}s reason=${entry.reasonCode}`
          : `${entry.providerId}/${entry.model} 等待=${seconds}秒 原因=${entry.reasonCode}`,
      );
    }
  }
  if (active.length === 0) {
    return undefined;
  }
  const prefix = language === "en-US" ? "Active model-service cooldown" : "模型服务等待恢复";
  return `${prefix}: ${active.join("; ")}`;
}

export const BREAKER_CONSTANTS = {
  FAILURE_THRESHOLD: BREAKER_FAILURE_THRESHOLD,
  COOLDOWN_MS: BREAKER_COOLDOWN_MS,
  RECOVERABLE_CODES,
} as const;
