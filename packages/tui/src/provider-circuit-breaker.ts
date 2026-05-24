import type { Language } from "@linghun/shared";

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
  consecutiveFailures: number;
  lastFailureAt: number;
  cooldownUntil: number;
  reasonCode: string;
};

export type ProviderCircuitBreakerState = {
  entries: Map<BreakerKey, BreakerEntry>;
};

const BREAKER_FAILURE_THRESHOLD = 2;
const BREAKER_COOLDOWN_MS = 45_000; // 45 seconds — conservative middle ground

/** Recoverable error codes that trigger the breaker. */
const RECOVERABLE_CODES = new Set([
  "PROVIDER_SERVER_ERROR",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_REQUEST_TIMEOUT",
  "PROVIDER_STREAM_TIMEOUT",
  "PROVIDER_NETWORK_ERROR",
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
 */
export function recordProviderFailure(
  state: ProviderCircuitBreakerState,
  providerId: string,
  model: string,
  errorCode: string,
): void {
  if (!isRecoverableProviderFailure(errorCode)) {
    return;
  }
  const key = makeBreakerKey(providerId, model);
  const existing = state.entries.get(key);
  const now = Date.now();
  const consecutiveFailures = (existing?.consecutiveFailures ?? 0) + 1;
  const cooldownUntil =
    consecutiveFailures >= BREAKER_FAILURE_THRESHOLD ? now + BREAKER_COOLDOWN_MS : 0;
  state.entries.set(key, {
    providerId,
    model,
    consecutiveFailures,
    lastFailureAt: now,
    cooldownUntil,
    reasonCode: errorCode,
  });
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
    // Cooldown expired — clear the entry
    state.entries.delete(key);
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
      `Provider ${providerId}/${model} is temporarily unstable and in cooldown.`,
      `Retry available in ~${seconds}s.`,
      "You can run /model doctor to diagnose, or switch provider/model with /model.",
    ].join(" ");
  }
  return [
    `Provider ${providerId}/${model} 暂时不稳定，正在冷却中。`,
    `约 ${seconds} 秒后可重试。`,
    "可运行 /model doctor 诊断，或用 /model 切换 provider/model。",
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
        `${entry.providerId}/${entry.model} cooldown=${seconds}s reason=${entry.reasonCode}`,
      );
    }
  }
  if (active.length === 0) {
    return undefined;
  }
  const prefix = language === "en-US" ? "Provider cooldown" : "Provider 冷却";
  return `${prefix}: ${active.join("; ")}`;
}

export const BREAKER_CONSTANTS = {
  FAILURE_THRESHOLD: BREAKER_FAILURE_THRESHOLD,
  COOLDOWN_MS: BREAKER_COOLDOWN_MS,
  RECOVERABLE_CODES,
} as const;
