import { describe, expect, it } from "vitest";
import {
  diagnoseCacheBreak,
  formatCacheBreakDiagnosis,
} from "./cache-break-diagnostics-runtime.js";
import type { CacheRequestObservation } from "./cache-policy-runtime.js";

function observation(overrides: Partial<CacheRequestObservation> = {}): CacheRequestObservation {
  return {
    id: "obs",
    kind: "main",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    endpointProfile: "anthropic_messages",
    messageCount: 4,
    toolCount: 2,
    promptCacheEnabled: true,
    promptCacheTtl: "1h",
    hasCacheBreakNonce: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    fingerprint: {
      requestHash: "request",
      messagePrefixHash: "message-prefix",
      systemPrefixHash: "system-prefix",
      conversationPrefixHash: "conversation-prefix",
      latestMessageHash: "latest",
      toolSchemaHash: "tools",
      stableToolSchemaHash: "stable-tools",
      dynamicToolSchemaHash: "dynamic-tools",
      modelHash: "model",
      reasoningHash: "reasoning",
      cacheConfigHash: "cache-config",
      promptCacheKeyHash: "none",
      changedKeys: [],
    },
    ...overrides,
  };
}

describe("cache-break-diagnostics-runtime", () => {
  it("reports explicit break-cache nonce as the likely cause", () => {
    const diagnosis = diagnoseCacheBreak({
      latest: {
        hitRate: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 100,
        cacheWriteTokensSource: "reported",
        source: "api_usage",
      },
      observation: observation({ hasCacheBreakNonce: true }),
      warnBelowHitRate: 0.3,
    });

    expect(diagnosis.status).toBe("read_miss");
    expect(formatCacheBreakDiagnosis(diagnosis)).toContain(
      "explicit break-cache nonce was attached",
    );
    expect(diagnosis.nextAction).toContain("turn off /break-cache");
  });

  it("distinguishes dynamic tool schema drift from stable tool schema drift", () => {
    const diagnosis = diagnoseCacheBreak({
      latest: {
        hitRate: 0.12,
        cacheReadTokens: 12,
        cacheWriteTokens: 40,
        cacheWriteTokensSource: "reported",
        source: "api_usage",
      },
      observation: observation({
        fingerprint: {
          ...observation().fingerprint,
          changedKeys: ["toolSchemaHash", "dynamicToolSchemaHash"],
        },
      }),
      warnBelowHitRate: 0.3,
    });

    expect(diagnosis.status).toBe("low_reuse");
    expect(diagnosis.reasons).toContain("dynamic tool schema changed");
    expect(diagnosis.nextAction).toContain("dynamic tool drift");
  });

  it("falls back to provider/cache support when no drift explains zero reads", () => {
    const diagnosis = diagnoseCacheBreak({
      latest: {
        hitRate: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cacheWriteTokensSource: "missing",
        source: "estimated",
      },
      observation: observation(),
      warnBelowHitRate: 0.3,
    });

    expect(diagnosis.status).toBe("read_miss");
    expect(diagnosis.reasons).toContain("provider reported zero cache read tokens");
    expect(diagnosis.reasons).toContain("provider did not report cache write/create fields");
    expect(diagnosis.nextAction).toContain("provider cache support");
  });
});
