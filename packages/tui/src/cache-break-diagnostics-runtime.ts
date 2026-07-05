import type { CacheTurnStats } from "@linghun/core";
import type { CacheRequestObservation } from "./cache-policy-runtime.js";

export type CacheBreakDiagnosisInput = {
  latest?: Pick<
    CacheTurnStats,
    "hitRate" | "cacheReadTokens" | "cacheWriteTokens" | "cacheWriteTokensSource" | "source"
  >;
  observation?: CacheRequestObservation;
  freshnessChangedKeys?: string[];
  warnBelowHitRate: number;
};

export type CacheBreakDiagnosis = {
  status: "ok" | "no_sample" | "read_miss" | "low_reuse";
  reasons: string[];
  nextAction: string;
};

export function diagnoseCacheBreak(input: CacheBreakDiagnosisInput): CacheBreakDiagnosis {
  const latest = input.latest;
  const observation = input.observation;
  if (!latest && !observation) {
    return {
      status: "no_sample",
      reasons: ["no cache telemetry sample yet"],
      nextAction: "run a provider request, then inspect /cache status or /break-cache status",
    };
  }

  const changedKeys = observation?.fingerprint.changedKeys ?? input.freshnessChangedKeys ?? [];
  const reasons = new Set<string>();
  if (observation?.hasCacheBreakNonce) reasons.add("explicit break-cache nonce was attached");
  for (const key of changedKeys) reasons.add(formatCacheBreakKey(key));
  if (latest?.cacheReadTokens === 0) reasons.add("provider reported zero cache read tokens");
  if (latest?.cacheWriteTokensSource === "missing") {
    reasons.add("provider did not report cache write/create fields");
  }
  if (latest?.source === "estimated") {
    reasons.add("cache usage is estimated rather than provider-reported");
  }

  const hitRate = latest?.hitRate;
  if (hitRate === null || hitRate === undefined || Number.isNaN(hitRate)) {
    return {
      status: "no_sample",
      reasons: Array.from(reasons).concat("hit rate is unavailable"),
      nextAction: "collect one provider usage sample before judging cache reuse",
    };
  }
  if (!latest) {
    return {
      status: "no_sample",
      reasons: Array.from(reasons).concat("cache usage sample is unavailable"),
      nextAction: "collect one provider usage sample before judging cache reuse",
    };
  }
  if (latest.cacheReadTokens === 0) {
    return {
      status: "read_miss",
      reasons: reasons.size > 0 ? Array.from(reasons) : ["no cache read tokens were reported"],
      nextAction: chooseNextAction(changedKeys, observation?.hasCacheBreakNonce === true),
    };
  }
  if (hitRate < input.warnBelowHitRate) {
    return {
      status: "low_reuse",
      reasons: reasons.size > 0 ? Array.from(reasons) : ["cache read tokens were low relative to input"],
      nextAction: chooseNextAction(changedKeys, observation?.hasCacheBreakNonce === true),
    };
  }
  return {
    status: "ok",
    reasons: reasons.size > 0 ? Array.from(reasons) : ["no obvious cache break detected"],
    nextAction: "no action needed",
  };
}

export function formatCacheBreakDiagnosis(diagnosis: CacheBreakDiagnosis): string {
  return `${diagnosis.status}; reasons ${diagnosis.reasons.join("; ")}; next ${diagnosis.nextAction}`;
}

function chooseNextAction(changedKeys: string[], hasNonce: boolean): string {
  if (hasNonce) return "turn off /break-cache if the namespace change was not intentional";
  if (changedKeys.some((key) => key.includes("ToolSchemaHash"))) {
    return "inspect tool schema changes; dynamic tool drift should not require rebuilding stable tools";
  }
  if (changedKeys.length > 0) return "inspect changed cache keys, then warm up only if the drift is expected";
  return "check provider cache support and repeat the same stable request shape";
}

function formatCacheBreakKey(key: string): string {
  switch (key) {
    case "requestHash":
      return "overall request shape changed";
    case "messagePrefixHash":
      return "stable message prefix changed";
    case "systemPrefixHash":
      return "system prompt prefix changed";
    case "conversationPrefixHash":
      return "conversation prefix changed";
    case "latestMessageHash":
      return "latest user turn changed";
    case "toolSchemaHash":
      return "tool schema changed";
    case "stableToolSchemaHash":
      return "stable tool schema changed";
    case "dynamicToolSchemaHash":
      return "dynamic tool schema changed";
    case "modelHash":
      return "model or tool choice changed";
    case "reasoningHash":
      return "reasoning settings changed";
    case "cacheConfigHash":
      return "prompt cache config changed";
    default:
      return `${key} changed`;
  }
}
