import { defaultConfig } from "@linghun/config";
import { describe, expect, it } from "vitest";
import {
  appendUsageEvents,
  markContextUsageStale,
  recordConfirmedContextUsage,
  refreshCompactPressureSnapshot,
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
    memory: {
      items: [],
      projectRules: "",
      candidates: [],
      accepted: [],
    },
    index: {
      status: "disabled",
    },
    skills: {
      enabled: false,
      skills: [],
    },
    plugins: {
      enabled: false,
      plugins: [],
    },
    hooks: {
      enabled: false,
      hooks: [],
    },
    mcp: {
      enabled: false,
      servers: [],
    },
    evidence: [],
    backgroundTasks: [],
    solutionCompleteness: {
      triggered: false,
    },
    failureLearning: {
      records: [],
    },
  } as unknown as TuiContext;
}

describe("context usage ledger", () => {
  it("writes one lightweight usage event per turn without duplicate cache_update payloads", async () => {
    const context = makeContext();
    const events: Array<{ type: string }> = [];
    context.store = {
      appendEvent: async (_sessionId: string, event: { type: string }) => {
        events.push(event);
      },
    } as unknown as TuiContext["store"];
    const stats = {
      turn: 1,
      timestamp: 1,
      hitRate: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cacheWriteTokensSource: "zero_reported",
      inputTokens: 1,
      outputTokens: 1,
      model: "test",
      provider: "test",
      endpoint: "/v1/messages",
      source: "api_usage",
      compacted: false,
      freshness: {},
    } as Parameters<typeof appendUsageEvents>[2];

    for (let turn = 0; turn < 1_000; turn += 1) {
      await appendUsageEvents(context, "session", { ...stats, turn });
    }

    expect(events).toHaveLength(1_000);
    expect(events.every((event) => event.type === "usage")).toBe(true);
  });

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
      source: "pressure",
      estimatedChars: 500,
      confirmedUsedTokens: 125,
      staleReason: undefined,
      lastConfirmedTurn: 7,
      model: "gpt-5.5",
      provider: "unknown",
    });
    expect(context.cache.contextUsage?.contextWindowTokens).toBeGreaterThan(125);
    expect(context.cache.contextUsage?.compactTriggerTokens).toBeGreaterThan(0);
  });

  it("keeps the displayed context total monotonic between compactions", () => {
    const context = makeContext();
    context.cache.contextUsage = {
      estimatedChars: 800,
      maxChars: 200_000 * 4,
      updatedAt: "2026-01-01T00:00:00.000Z",
      source: "pressure",
    };

    recordConfirmedContextUsage(context, {
      inputTokens: 100,
      outputTokens: 10,
      totalTokens: 110,
    });

    expect(context.cache.contextUsage).toMatchObject({
      estimatedChars: 800,
      confirmedUsedTokens: 100,
    });
  });

  it("does not mark low confirmed usage stale", () => {
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
      staleReason: undefined,
    });
  });

  it("marks near-trigger usage stale without clearing the confirmed ledger", () => {
    const context = makeContext();
    recordConfirmedContextUsage(context, {
      inputTokens: 100,
      outputTokens: 10,
      totalTokens: 110,
    });
    const nearTrigger = Math.ceil((context.cache.contextUsage?.compactTriggerTokens ?? 1) * 0.5);
    context.cache.contextUsage!.confirmedUsedTokens = nearTrigger;

    markContextUsageStale(context, "disconnected_mid_stream");

    expect(context.cache.contextUsage).toMatchObject({
      confirmedUsedTokens: nearTrigger,
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
    recordConfirmedContextUsage(context, {
      inputTokens: 100,
      outputTokens: 10,
      totalTokens: 110,
    });
    const currentTrigger = context.cache.contextUsage?.compactTriggerTokens ?? 1;
    context.cache.contextUsage!.confirmedUsedTokens = currentTrigger - 1;

    expect(shouldForceCompactFromConfirmedUsage(context)).toBe(false);

    context.cache.contextUsage!.confirmedUsedTokens = currentTrigger;
    markContextUsageStale(context, "disconnected_mid_stream");

    expect(shouldForceCompactFromConfirmedUsage(context)).toBe(true);
    expect(context.cache.contextUsage).toMatchObject({
      confirmedUsedTokens: currentTrigger,
      staleReason: "disconnected_mid_stream",
    });
  });

  it("records confirmed usage against the executor effective input window", () => {
    const context = makeContext("openai-compatible");
    context.model = "custom-model[1m]";
    context.config.modelRoutes = {
      ...context.config.modelRoutes,
      routes: context.config.modelRoutes.routes.map((route) =>
        route.role === "executor"
          ? {
              ...route,
              provider: "openai-compatible",
              primaryModel: "custom-model[1m]",
              maxInputTokens: 200_000,
            }
          : route,
      ),
    };

    recordConfirmedContextUsage(context, {
      inputTokens: 10_000,
      outputTokens: 10,
      totalTokens: 10_010,
    });

    expect(context.cache.contextUsage?.contextWindowTokens).toBe(200_000);
    expect(context.cache.contextUsage?.compactTriggerTokens).toBeLessThan(200_000);
  });

  it("records pressure usage against the executor effective input window", async () => {
    const context = makeContext("openai-compatible");
    context.sessionId = "session-1";
    context.model = "custom-model[1m]";
    context.config.modelRoutes = {
      ...context.config.modelRoutes,
      routes: context.config.modelRoutes.routes.map((route) =>
        route.role === "executor"
          ? {
              ...route,
              provider: "openai-compatible",
              primaryModel: "custom-model[1m]",
              maxInputTokens: 200_000,
            }
          : route,
      ),
    };
    const events: unknown[] = [];
    context.store = {
      readRecentTranscriptEvents: async () => ({ events: [] }),
      appendEvent: async (_sessionId: string, event: unknown) => {
        events.push(event);
      },
    } as unknown as TuiContext["store"];

    await refreshCompactPressureSnapshot(context);

    expect(events).toEqual([]);
    expect(context.cache.compactPressure?.maxChars).toBe(200_000 * 4);
    expect(context.cache.contextUsage?.maxChars).toBe(200_000 * 4);
  });

  it("does not reuse an old model trigger after the runtime route changes", () => {
    const context = makeContext();
    context.cache.contextUsage = {
      estimatedChars: 920,
      maxChars: 1_024,
      updatedAt: "2026-01-01T00:00:00.000Z",
      source: "provider_usage",
      confirmedUsedTokens: 230,
      contextWindowTokens: 256,
      compactTriggerTokens: 1,
      model: "old-model",
      provider: "old-provider",
    };

    expect(shouldForceCompactFromConfirmedUsage(context)).toBe(false);

    expect(context.cache.contextUsage).toMatchObject({
      model: "old-model",
      provider: "old-provider",
      compactTriggerTokens: 1,
    });
  });

  it("recalculates the trigger only after the runtime snapshot is marked stale", () => {
    const context = makeContext();
    recordConfirmedContextUsage(context, {
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
    });
    const currentTrigger = context.cache.contextUsage?.compactTriggerTokens ?? 0;
    context.cache.contextUsage = {
      ...context.cache.contextUsage!,
      confirmedUsedTokens: currentTrigger,
      compactTriggerTokens: currentTrigger + 1,
      model: "gpt-5.5",
      provider: "unknown",
    };

    expect(shouldForceCompactFromConfirmedUsage(context)).toBe(false);

    context.cache.contextUsage.staleReason = "runtime_changed";
    expect(shouldForceCompactFromConfirmedUsage(context)).toBe(true);
  });
});
