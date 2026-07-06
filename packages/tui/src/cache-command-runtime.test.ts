import type { CacheFreshness } from "@linghun/core";
import { defaultConfig } from "@linghun/config";
import { describe, expect, it } from "vitest";
import { formatCacheStatus, formatCompactStatus } from "./cache-command-runtime.js";
import type { CacheRequestObservation } from "./cache-policy-runtime.js";
import type { TuiContext } from "./tui-context-runtime.js";

const freshness: CacheFreshness = {
  systemPromptHash: "system",
  toolSchemaHash: "tools",
  mcpToolListHash: "mcp",
  modelProviderHash: "model",
  changedKeys: [],
};

function makeObservation(
  overrides: Partial<CacheRequestObservation> = {},
): CacheRequestObservation {
  return {
    id: "obs-1",
    kind: "main",
    provider: "openai-compatible",
    model: "gpt-5.5",
    endpointProfile: "responses",
    messageCount: 4,
    toolCount: 2,
    promptCacheEnabled: true,
    promptCacheTtl: "1h",
    hasCacheBreakNonce: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    fingerprint: {
      requestHash: "request",
      messagePrefixHash: "messages",
      systemPrefixHash: "system-prefix",
      conversationPrefixHash: "conversation-prefix",
      latestMessageHash: "latest-message",
      toolSchemaHash: "tools",
      stableToolSchemaHash: "stable-tools",
      dynamicToolSchemaHash: "dynamic-tools",
      modelHash: "model",
      reasoningHash: "reasoning",
      cacheConfigHash: "cache",
      promptCacheKeyHash: "none",
      changedKeys: ["messagePrefixHash", "reasoningHash"],
    },
    usage: {
      inputTokens: 100,
      outputTokens: 12,
      totalTokens: 112,
      cacheReadTokens: 70,
      cacheWriteTokens: 5,
      cacheWriteTokensEstimated: false,
      endpoint: "/v1/responses",
      source: "api_usage",
    },
    ...overrides,
  };
}

function makeContext(): TuiContext {
  const observation = makeObservation();
  return {
    language: "zh-CN",
    model: "gpt-5.5",
    config: defaultConfig,
    cache: {
      config: { maxTurns: 8, warnBelowHitRate: 0.3, persistPath: "", hintsMuted: false },
      history: [
        {
          turn: 1,
          timestamp: 1,
          hitRate: 0.4,
          cacheReadTokens: 70,
          cacheWriteTokens: 5,
          cacheWriteTokensSource: "reported",
          inputTokens: 25,
          outputTokens: 12,
          model: "gpt-5.5",
          provider: "openai-compatible",
          endpoint: "/v1/responses",
          source: "api_usage",
          compacted: false,
          freshness: { ...freshness, changedKeys: [] },
        },
      ],
      nextTurn: 2,
      lastFreshness: freshness,
      lastRequestObservation: observation,
      lastRequestObservationByKind: {
        main: observation,
        "side-question": makeObservation({
          id: "obs-side",
          kind: "side-question",
          provider: "deepseek",
          endpointProfile: "chat_completions",
          promptCacheEnabled: false,
          usage: {
            inputTokens: 40,
            outputTokens: 4,
            totalTokens: 44,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            cacheWriteTokensEstimated: false,
            endpoint: "/chat/completions",
            source: "estimated",
          },
        }),
      },
      hintLastShownAt: {},
      compacted: false,
      compactBoundaries: [],
      compactProjection: {
        boundaryId: "boundary-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        summary: "Linghun compact summary\nscope provider-visible recent context projection",
        windowId: "boundary-1",
        replacementKind: "provider-visible",
        replacedMessageCount: 8,
        replacementMessageCount: 3,
        terminalVisibleBeforeCount: 30,
        terminalVisibleAfterCount: 8,
        pressureRatio: 0.91,
        preCompactChars: 120_000,
        postCompactChars: 40_000,
        postCompactTargetChars: 60_000,
        savingsRatio: 0.667,
        acceptance: {
          budget: "hit",
          replacementProjection: "active",
          terminalVisibleProjection: "reduced",
          uiNotice: "quiet-success",
          rollback: "available",
          featureFlags: {
            replacementProjection: true,
            terminalVisibleProjection: true,
            retainedBudget: true,
          },
        },
        progress: {
          status: "complete",
          stages: [
            "scan_context",
            "generate_summary",
            "trim_old_records",
            "restore_context",
            "complete",
          ],
          preCompactChars: 120_000,
          postCompactChars: 40_000,
          targetChars: 60_000,
          savingsRatio: 0.667,
        },
        discardedRange: "older provider-visible recent context summarized",
        toolPairingSafe: true,
        risks: [],
        evidenceRefs: ["ev-1"],
      },
      workspaceReference: {
        hits: 0,
        misses: 0,
        failures: 0,
      },
      startedAt: 1,
    },
  } as unknown as TuiContext;
}

describe("cache-command-runtime", () => {
  it("shows unified cache telemetry and drift reasons in /cache status details", () => {
    const text = formatCacheStatus(makeContext(), freshness);

    expect(text).toContain("latest telemetry: main; provider openai-compatible");
    expect(text).toContain("profile responses");
    expect(text).toContain("usage api_usage; read/write 70/5");
    expect(text).toContain("endpoint /v1/responses");
    expect(text).toContain("telemetry by kind: main:openai-compatible/responses/r/w 70/5 api_usage");
    expect(text).toContain("side-question:deepseek/chat_completions/r/w 0/0 estimated");
    expect(text).toContain("drift reason: stable message prefix changed, reasoning changed");
    expect(text).toContain("break diagnosis: ok");
  });

  it("shows compact acceptance, progress, and rollback status", () => {
    const text = formatCompactStatus(makeContext());

    expect(text).toContain(
      "acceptance: budget hit; replacement active; terminal reduced; notice quiet-success",
    );
    expect(text).not.toContain("progress: compact");
    expect(text).toContain("rollback: available");
    expect(text).toContain(
      "feature flags: replacement on; terminal projection on; retained budget on",
    );
  });

  it("shows transient compact progress while a compact run is active", () => {
    const context = makeContext();
    context.cache.compactProgress = {
      status: "running",
      stages: ["scan_context", "generate_summary"],
      preCompactChars: 0,
      postCompactChars: 0,
    };

    const text = formatCompactStatus(context);

    expect(text).toContain("progress: compact");
    expect(text).toContain("generate-summary");
    expect(text).not.toContain("[████────────]");
  });

  it("shows indeterminate compact progress when no stage is available", () => {
    const context = makeContext();
    context.cache.compactProgress = {
      status: "running",
      stages: [],
      preCompactChars: 0,
      postCompactChars: 0,
    };

    const text = formatCompactStatus(context);

    expect(text).toContain("progress: compact running");
    expect(text).not.toContain("[████────────]");
  });
});
