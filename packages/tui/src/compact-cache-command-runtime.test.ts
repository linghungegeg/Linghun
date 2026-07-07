import { defaultConfig } from "@linghun/config";
import { describe, expect, it } from "vitest";
import {
  markContextUsageStale,
  recordConfirmedContextUsage,
  shouldForceCompactFromConfirmedUsage,
} from "./compact-cache-command-runtime.js";
import type { TuiContext } from "./tui-context-runtime.js";

function makeContext(provider: "deepseek" | "openai-compatible" = "deepseek"): TuiContext {
  return {
    language: "zh-CN",
    model: provider === "openai-compatible" ? "openai-compatible-model" : "gpt-5.5",
    config: {
      ...defaultConfig,
      defaultModel: provider === "openai-compatible" ? "openai-compatible-model" : defaultConfig.defaultModel,
      modelRoutes: {
        ...defaultConfig.modelRoutes,
        routes: defaultConfig.modelRoutes.routes.map((route) =>
          route.role === "executor"
            ? {
                ...route,
                provider,
                primaryModel:
                  provider === "openai-compatible" ? "openai-compatible-model" : route.primaryModel,
              }
            : route,
        ),
      },
    },
    cache: {
      config: { maxTurns: 8, warnBelowHitRate: 0.3, persistPath: "", hintsMuted: false },
      history: [],
      nextTurn: 7,
      hintLastShownAt: {},
      compacted: false,
      compactBoundaries: [],
      workspaceReference: {
        hash: "workspace",
        snapshot: "ready",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      startedAt: 1,
    },
  } as unknown as TuiContext;
}

describe("context usage ledger", () => {
  it("records provider-confirmed context usage and clears stale state", () => {
    const context = makeContext();
    context.cache.contextUsage = {
      estimatedChars: 12,
      maxChars: 100,
      updatedAt: "2026-01-01T00:00:00.000Z",
      source: "pressure",
      confirmedUsedTokens: 3,
      staleReason: "missing_usage",
    };

    recordConfirmedContextUsage(context, {
      inputTokens: 100,
      outputTokens: 10,
      totalTokens: 110,
      cacheReadTokens: 20,
      cacheWriteTokens: 5,
    });

    expect(context.cache.contextUsage).toMatchObject({
      source: "provider_usage",
      confirmedUsedTokens: 125,
      staleReason: undefined,
      lastConfirmedTurn: 7,
    });
    expect(context.cache.contextUsage?.contextWindowTokens).toBeGreaterThan(125);
    expect(context.cache.contextUsage?.compactTriggerTokens).toBeGreaterThan(0);
  });

  it("marks usage stale without clearing the confirmed ledger", () => {
    const context = makeContext();
    recordConfirmedContextUsage(context, {
      inputTokens: 100,
      outputTokens: 10,
      totalTokens: 110,
      cacheReadTokens: 20,
      cacheWriteTokens: 5,
    });

    markContextUsageStale(context, "disconnected_mid_stream");

    expect(context.cache.contextUsage).toMatchObject({
      confirmedUsedTokens: 125,
      staleReason: "disconnected_mid_stream",
    });
  });

  it("does not double count OpenAI-compatible inclusive prompt usage", () => {
    const context = makeContext("openai-compatible");

    recordConfirmedContextUsage(context, {
      inputTokens: 100,
      outputTokens: 10,
      totalTokens: 110,
      cacheReadTokens: 20,
      cacheWriteTokens: 5,
      endpoint: "/v1/responses",
      rawUsage: { prompt_tokens: 100 },
    });

    expect(context.cache.contextUsage).toMatchObject({
      confirmedUsedTokens: 100,
      staleReason: undefined,
    });
  });

  it("uses confirmed usage to gate the next compact pass", () => {
    const context = makeContext();
    context.cache.contextUsage = {
      estimatedChars: 0,
      maxChars: 256 * 4,
      updatedAt: "2026-01-01T00:00:00.000Z",
      source: "provider_usage",
      confirmedUsedTokens: 100,
      contextWindowTokens: 256,
      compactTriggerTokens: 230,
    };

    expect(shouldForceCompactFromConfirmedUsage(context)).toBe(false);

    context.cache.contextUsage.confirmedUsedTokens = 230;
    markContextUsageStale(context, "disconnected_mid_stream");

    expect(shouldForceCompactFromConfirmedUsage(context)).toBe(true);
    expect(context.cache.contextUsage).toMatchObject({
      confirmedUsedTokens: 230,
      staleReason: "disconnected_mid_stream",
    });
  });
});
