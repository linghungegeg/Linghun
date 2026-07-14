import { OpenAiCompatibleProvider, type ModelRequest, type ModelUsage } from "@linghun/providers";
import { describe, expect, it } from "vitest";
import {
  applyCacheWritePolicyToRequest,
  applyLastCacheSafePrefix,
  applyPostCompactMainChainCacheSafePrefix,
  type CacheRequestKind,
  type CacheRequestObservationState,
  createPostCompactCacheWarmup,
  computeLocalCacheDisplayState,
  computeRecentCacheHitRate,
  normalizeCacheUsageObservation,
  observeCacheSafeRequest,
  observeCacheUsage,
  recordCacheRequestObservation,
  recordCacheUsageObservation,
  rememberCacheSafePrefix,
  resolveCachePolicy,
} from "./cache-policy-runtime.js";

describe("local cache footer observations", () => {
  it("ignores estimated usage and keeps the latest trusted 20-turn ratio", () => {
    const history = [
      { hitRate: 0.8, inputTokens: 20, cacheReadTokens: 80, cacheWriteTokens: 0, source: "api_usage" as const },
      { hitRate: 0, inputTokens: 1_000, cacheReadTokens: 0, cacheWriteTokens: 0, source: "estimated" as const },
    ];

    expect(computeRecentCacheHitRate(history)).toBe(0.8);
  });

  it("uses trusted usage observation when local history has not recorded the turn yet", () => {
    const observation = observeCacheUsage({
      observation: observeCacheSafeRequest({ kind: "main", provider: "test", request: makeRequest() }),
      usage: makeUsage({ inputTokens: 20, cacheReadTokens: 80, cacheWriteTokens: 0 }),
    });

    expect(computeLocalCacheDisplayState({ history: [], observation })).toMatchObject({
      hitRate: 0.8,
      freshness: "stable",
      sampleSize: 1,
    });
  });
});

function makeRequest(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    messages: [
      { role: "system", content: "system" },
      { role: "user", content: "hello" },
    ],
    model: "claude-sonnet-4-5",
    endpointProfile: "anthropic_messages",
    reasoningLevel: "high",
    promptCacheEnabled: true,
    tools: [
      { name: "Write", description: "write file", inputSchema: { type: "object" } },
      { name: "Read", description: "read file", inputSchema: { type: "object" } },
    ],
    toolChoice: "auto",
    ...overrides,
  };
}

function makeUsage(overrides: Partial<ModelUsage> = {}): ModelUsage {
  return {
    inputTokens: 100,
    outputTokens: 10,
    totalTokens: 110,
    cacheReadTokens: 70,
    cacheWriteTokens: 20,
    endpoint: "/v1/messages",
    ...overrides,
  };
}

describe("cache-policy-runtime", () => {
  it("detects provider-visible tool order changes", () => {
    const first = observeCacheSafeRequest({
      kind: "main",
      provider: "anthropic",
      request: makeRequest(),
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    const second = observeCacheSafeRequest({
      previous: first,
      kind: "main",
      provider: "anthropic",
      request: makeRequest({ tools: [...(makeRequest().tools ?? [])].reverse() }),
      now: new Date("2026-01-01T00:00:01.000Z"),
    });

    expect(second.fingerprint.toolSchemaHash).not.toBe(first.fingerprint.toolSchemaHash);
    expect(second.fingerprint.changedKeys).toEqual([
      "requestHash",
      "toolSchemaHash",
      "stableToolSchemaHash",
    ]);
  });

  it("separates stable built-in tool schema from dynamic discovered tools", () => {
    const first = observeCacheSafeRequest({
      kind: "main",
      provider: "anthropic",
      request: makeRequest({
        tools: [
          ...(makeRequest().tools ?? []),
          {
            name: "mcp__memory__trace_path",
            description: "dynamic memory tool",
            inputSchema: { type: "object", properties: { symbol: { type: "string" } } },
          },
        ],
      }),
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    const second = observeCacheSafeRequest({
      previous: first,
      kind: "main",
      provider: "anthropic",
      request: makeRequest({
        tools: [
          ...(makeRequest().tools ?? []),
          {
            name: "mcp__memory__trace_path",
            description: "dynamic memory tool",
            inputSchema: { type: "object", properties: { symbol: { type: "string" } } },
          },
          {
            name: "plugin__lint__run",
            description: "dynamic plugin tool",
            inputSchema: { type: "object", properties: { target: { type: "string" } } },
          },
        ],
      }),
      now: new Date("2026-01-01T00:00:01.000Z"),
    });

    expect(second.fingerprint.stableToolSchemaHash).toBe(
      first.fingerprint.stableToolSchemaHash,
    );
    expect(second.fingerprint.dynamicToolSchemaHash).not.toBe(
      first.fingerprint.dynamicToolSchemaHash,
    );
    expect(second.fingerprint.changedKeys).toEqual([
      "requestHash",
      "toolSchemaHash",
      "dynamicToolSchemaHash",
    ]);
  });

  it("separates same-name tool identities by source and compact schema hash", () => {
    const first = observeCacheSafeRequest({
      kind: "main",
      provider: "anthropic",
      request: makeRequest({
        tools: [
          {
            name: "Read",
            description: "built-in read",
            inputSchema: { type: "object", properties: { path: { type: "string" } } },
            source: "built-in",
            schemaHash: "builtin-read-hash",
          },
        ],
      }),
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    const second = observeCacheSafeRequest({
      previous: first,
      kind: "main",
      provider: "anthropic",
      request: makeRequest({
        tools: [
          {
            name: "Read",
            description: "built-in read",
            inputSchema: { type: "object", properties: { path: { type: "string" } } },
            source: "built-in",
            schemaHash: "builtin-read-hash",
          },
          {
            name: "Read",
            description: "mcp read",
            inputSchema: { type: "object", properties: { remote: { type: "boolean" } } },
            source: "mcp",
            schemaHash: "mcp-read-hash",
          },
        ],
      }),
      now: new Date("2026-01-01T00:00:01.000Z"),
    });

    expect(second.fingerprint.stableToolSchemaHash).toBe(first.fingerprint.stableToolSchemaHash);
    expect(second.fingerprint.dynamicToolSchemaHash).not.toBe(
      first.fingerprint.dynamicToolSchemaHash,
    );
    expect(second.fingerprint.toolSchemaHash).not.toContain("remote");
    expect(second.fingerprint.toolSchemaHash).toMatch(/^[0-9a-f]{12}$/);
    expect(second.fingerprint.changedKeys).toEqual([
      "requestHash",
      "toolSchemaHash",
      "dynamicToolSchemaHash",
    ]);
  });

  it("separates stable prompt prefix drift from the latest dynamic message", () => {
    const first = observeCacheSafeRequest({
      kind: "main",
      provider: "anthropic",
      request: makeRequest({
        messages: [
          { role: "system", content: "stable system" },
          { role: "user", content: "stable prefix" },
          { role: "assistant", content: "ack" },
          { role: "user", content: "current question" },
        ],
      }),
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    const second = observeCacheSafeRequest({
      previous: first,
      kind: "main",
      provider: "anthropic",
      request: makeRequest({
        messages: [
          { role: "system", content: "stable system" },
          { role: "user", content: "stable prefix" },
          { role: "assistant", content: "ack" },
          { role: "user", content: "different current question" },
        ],
      }),
      now: new Date("2026-01-01T00:00:01.000Z"),
    });

    expect(second.fingerprint.systemPrefixHash).toBe(first.fingerprint.systemPrefixHash);
    expect(second.fingerprint.conversationPrefixHash).toBe(
      first.fingerprint.conversationPrefixHash,
    );
    expect(second.fingerprint.latestMessageHash).not.toBe(first.fingerprint.latestMessageHash);
    expect(second.fingerprint.changedKeys).toEqual(["requestHash", "latestMessageHash"]);
  });

  it("keeps volatile system sections out of the cacheable system prefix", () => {
    const first = observeCacheSafeRequest({
      kind: "main",
      provider: "anthropic",
      request: makeRequest({
        messages: [
          { role: "system", content: "stable base", promptCache: "cacheable" },
          { role: "system", content: "stable memory", promptCache: "cacheable" },
          { role: "system", content: "turn evidence a", promptCache: "volatile" },
          { role: "user", content: "current question" },
        ],
      }),
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    const second = observeCacheSafeRequest({
      previous: first,
      kind: "main",
      provider: "anthropic",
      request: makeRequest({
        messages: [
          { role: "system", content: "stable base", promptCache: "cacheable" },
          { role: "system", content: "stable memory", promptCache: "cacheable" },
          { role: "system", content: "turn evidence b", promptCache: "volatile" },
          { role: "user", content: "current question" },
        ],
      }),
      now: new Date("2026-01-01T00:00:01.000Z"),
    });

    expect(second.fingerprint.systemPrefixHash).toBe(first.fingerprint.systemPrefixHash);
    expect(second.fingerprint.changedKeys).toEqual(["requestHash"]);
  });

  it("matches the provider cache boundary for legacy multi-system prompts without hints", () => {
    const first = observeCacheSafeRequest({
      kind: "main",
      provider: "anthropic",
      request: makeRequest({
        messages: [
          { role: "system", content: "stable system" },
          { role: "system", content: "dynamic system a" },
          { role: "user", content: "current question" },
        ],
      }),
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    const second = observeCacheSafeRequest({
      previous: first,
      kind: "main",
      provider: "anthropic",
      request: makeRequest({
        messages: [
          { role: "system", content: "stable system" },
          { role: "system", content: "dynamic system b" },
          { role: "user", content: "current question" },
        ],
      }),
      now: new Date("2026-01-01T00:00:01.000Z"),
    });

    expect(second.fingerprint.systemPrefixHash).toBe(first.fingerprint.systemPrefixHash);
    expect(second.fingerprint.changedKeys).toEqual(["requestHash"]);
  });

  it("keeps compact stable summaries out of rolling recent-window drift", () => {
    const stableMessages: ModelRequest["messages"] = [
      { role: "system", content: "stable system" },
      { role: "user", content: "Deep compact context\nsummary stable older context" },
      { role: "user", content: "Context compact projection\nsummary stable recent context" },
    ];
    const first = observeCacheSafeRequest({
      kind: "main",
      provider: "anthropic",
      request: makeRequest({
        messages: [
          ...stableMessages,
          { role: "user", content: "rolling recent window a" },
          { role: "assistant", content: "ack a" },
          { role: "user", content: "current question a" },
        ],
      }),
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    const second = observeCacheSafeRequest({
      previous: first,
      kind: "main",
      provider: "anthropic",
      request: makeRequest({
        messages: [
          ...stableMessages,
          { role: "user", content: "rolling recent window b" },
          { role: "assistant", content: "ack b" },
          { role: "user", content: "current question b" },
        ],
      }),
      now: new Date("2026-01-01T00:00:01.000Z"),
    });

    expect(second.fingerprint.systemPrefixHash).toBe(first.fingerprint.systemPrefixHash);
    expect(second.fingerprint.conversationPrefixHash).toBe(
      first.fingerprint.conversationPrefixHash,
    );
    expect(second.fingerprint.messagePrefixHash).toBe(first.fingerprint.messagePrefixHash);
    expect(second.fingerprint.latestMessageHash).not.toBe(first.fingerprint.latestMessageHash);
    expect(second.fingerprint.changedKeys).toEqual(["requestHash", "latestMessageHash"]);
  });

  it("refreshes the compact conversation prefix when the stable summary changes", () => {
    const first = observeCacheSafeRequest({
      kind: "main",
      provider: "anthropic",
      request: makeRequest({
        messages: [
          { role: "system", content: "stable system" },
          { role: "user", content: "Deep compact context\nsummary stable older context" },
          { role: "user", content: "Context compact projection\nsummary stable recent context" },
          { role: "user", content: "current question" },
        ],
      }),
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    const second = observeCacheSafeRequest({
      previous: first,
      kind: "main",
      provider: "anthropic",
      request: makeRequest({
        messages: [
          { role: "system", content: "stable system" },
          { role: "user", content: "Deep compact context\nsummary updated older context" },
          { role: "user", content: "Context compact projection\nsummary stable recent context" },
          { role: "user", content: "current question" },
        ],
      }),
      now: new Date("2026-01-01T00:00:01.000Z"),
    });

    expect(second.fingerprint.conversationPrefixHash).not.toBe(
      first.fingerprint.conversationPrefixHash,
    );
    expect(second.fingerprint.changedKeys).toEqual([
      "requestHash",
      "messagePrefixHash",
      "conversationPrefixHash",
    ]);
  });

  it("detects message/model/reasoning/cache shape drift without storing raw request text", () => {
    const first = observeCacheSafeRequest({
      kind: "main",
      provider: "openai-compatible",
      request: makeRequest({ endpointProfile: "responses" }),
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    const second = observeCacheSafeRequest({
      previous: first,
      kind: "final",
      provider: "openai-compatible",
      request: makeRequest({
        messages: [...makeRequest().messages, { role: "user", content: "next" }],
        model: "gpt-5.5",
        endpointProfile: "responses",
        reasoningLevel: "low",
        promptCacheEnabled: false,
      }),
      now: new Date("2026-01-01T00:00:01.000Z"),
    });

    expect(second.kind).toBe("final");
    expect(second.messageCount).toBe(3);
    expect(second.promptCacheEnabled).toBe(false);
    expect(second.fingerprint.changedKeys).toEqual([
      "requestHash",
      "messagePrefixHash",
      "conversationPrefixHash",
      "latestMessageHash",
      "modelHash",
      "reasoningHash",
      "cacheConfigHash",
    ]);
    expect(JSON.stringify(second)).not.toContain("next");
    expect(JSON.stringify(second)).not.toContain("hello");
  });

  it("fingerprints prompt cache keys by hash without storing the raw key", () => {
    const first = observeCacheSafeRequest({
      kind: "main",
      provider: "openai-compatible",
      request: makeRequest({ endpointProfile: "responses" }),
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    const second = observeCacheSafeRequest({
      previous: first,
      kind: "continuation",
      provider: "openai-compatible",
      request: makeRequest({
        endpointProfile: "responses",
        promptCacheKey: "linghun:secret-session-cache-key",
      }),
      now: new Date("2026-01-01T00:00:01.000Z"),
    });

    expect(second.fingerprint.promptCacheKeyHash).toMatch(/^[0-9a-f]{12}$/);
    expect(second.fingerprint.promptCacheKeyHash).not.toBe(first.fingerprint.promptCacheKeyHash);
    expect(second.fingerprint.changedKeys).toEqual([
      "requestHash",
      "cacheConfigHash",
      "promptCacheKeyHash",
    ]);
    expect(JSON.stringify(second)).not.toContain("secret-session-cache-key");
  });

  it("normalizes provider usage and attaches it to the latest observation", () => {
    const observation = observeCacheSafeRequest({
      kind: "continuation",
      provider: "deepseek",
      request: makeRequest({ endpointProfile: "chat_completions" }),
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    const updated = observeCacheUsage({
      observation,
      usage: makeUsage({
        cacheWriteTokensEstimated: true,
        cacheCreationEphemeral5mTokens: 12,
        cacheCreationEphemeral1hTokens: 3,
      }),
    });

    expect(updated?.usage).toEqual({
      inputTokens: 100,
      outputTokens: 10,
      totalTokens: 110,
      cacheReadTokens: 70,
      cacheWriteTokens: 20,
      cacheWriteTokensEstimated: true,
      cacheCreationEphemeral5mTokens: 12,
      cacheCreationEphemeral1hTokens: 3,
      endpoint: "/v1/messages",
      source: "api_usage",
    });
  });

  it("records request and usage observations into shared cache state", () => {
    const state: CacheRequestObservationState = {};
    const request = applyCacheWritePolicyToRequest(
      makeRequest({ promptCacheTtl: "1h", cacheBreakNonce: "nonce" }),
      resolveCachePolicy("side-question"),
    );
    const observation = recordCacheRequestObservation(
      state,
      "side-question",
      "anthropic",
      request,
    );
    const updated = recordCacheUsageObservation(state, makeUsage({ cacheReadTokens: 8 }));

    expect(observation.kind).toBe("side-question");
    expect(observation.promptCacheEnabled).toBe(false);
    expect(observation.hasCacheBreakNonce).toBe(false);
    expect(state.lastRequestObservationByKind?.["side-question"]?.id).toBe(observation.id);
    expect(updated?.usage?.cacheReadTokens).toBe(8);
    expect(state.lastRequestObservationByKind?.["side-question"]?.usage?.cacheReadTokens).toBe(8);
  });

  it("compares cache drift against the previous observation for the same request kind", () => {
    const state: CacheRequestObservationState = {};
    recordCacheRequestObservation(state, "main", "anthropic", makeRequest());
    recordCacheRequestObservation(
      state,
      "side-question",
      "anthropic",
      makeRequest({
        messages: [{ role: "user", content: "btw" }],
        tools: undefined,
        toolChoice: "none",
        promptCacheEnabled: undefined,
      }),
    );
    const nextMain = recordCacheRequestObservation(state, "main", "anthropic", makeRequest());

    expect(nextMain.fingerprint.changedKeys).toEqual([]);
  });

  it("attaches cache usage to the requested kind when sidechain observations interleave", () => {
    const state: CacheRequestObservationState = {};
    const main = recordCacheRequestObservation(state, "main", "anthropic", makeRequest());
    const side = recordCacheRequestObservation(
      state,
      "side-question",
      "anthropic",
      makeRequest({
        messages: [{ role: "user", content: "btw" }],
        tools: undefined,
        toolChoice: "none",
        promptCacheEnabled: undefined,
      }),
    );
    const updated = recordCacheUsageObservation(
      state,
      makeUsage({ cacheReadTokens: 42 }),
      "main",
    );

    expect(updated?.id).toBe(main.id);
    expect(state.lastRequestObservation?.id).toBe(side.id);
    expect(state.lastRequestObservationByKind?.main?.usage?.cacheReadTokens).toBe(42);
    expect(state.lastRequestObservationByKind?.["side-question"]?.usage).toBeUndefined();
  });

  it("tracks post-compact warmup across main-chain observations", () => {
    const state: CacheRequestObservationState = {};
    state.postCompactCacheWarmup = createPostCompactCacheWarmup({
      projection: {
        boundaryId: "compact-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        summary: "summary",
        pressureRatio: 0.8,
        preCompactChars: 120_000,
        postCompactChars: 40_000,
        discardedRange: "older context summarized",
        toolPairingSafe: true,
        risks: [],
        evidenceRefs: [],
      },
      totalTurns: 2,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    recordCacheRequestObservation(state, "main", "anthropic", makeRequest());
    expect(state.postCompactCacheWarmup.status).toBe("warming");
    expect(state.postCompactCacheWarmup.remainingTurns).toBe(1);
    expect(state.postCompactCacheWarmup.baselinePrefixHash).toMatch(/^[0-9a-f]{12}$/);

    recordCacheRequestObservation(
      state,
      "continuation",
      "anthropic",
      makeRequest({
        messages: [
          { role: "system", content: "system" },
          { role: "user", content: "next" },
        ],
      }),
    );
    expect(state.postCompactCacheWarmup.status).toBe("complete");
    expect(state.postCompactCacheWarmup.remainingTurns).toBe(0);
    expect(state.postCompactCacheWarmup.lastChangedKeys).toContain("requestHash");
  });

  it("reuses post-compact main-chain compact prefix during warmup", () => {
    const state: CacheRequestObservationState = {
      postCompactCacheWarmup: createPostCompactCacheWarmup({
        projection: {
          boundaryId: "compact-1",
          createdAt: "2026-01-01T00:00:00.000Z",
          summary: "summary",
          pressureRatio: 0.8,
          preCompactChars: 120_000,
          postCompactChars: 40_000,
          discardedRange: "older context summarized",
          toolPairingSafe: true,
          risks: [],
          evidenceRefs: [],
        },
        totalTurns: 2,
      }),
    };
    const compactMessages: ModelRequest["messages"] = [
      { role: "system", content: "runtime v1" },
      { role: "user", content: "Deep compact context\nolder stable summary" },
      { role: "user", content: "Context compact projection\nrecent stable summary" },
      { role: "user", content: "first post compact request" },
    ];
    rememberCacheSafePrefix(state, makeRequest({ messages: compactMessages }));

    const result = applyPostCompactMainChainCacheSafePrefix({
      state,
      request: makeRequest({
        messages: [
          { role: "system", content: "runtime v2" },
          { role: "user", content: "second post compact request" },
        ],
        promptCacheTtl: "1h",
        cacheBreakNonce: "fresh-nonce",
      }),
    });

    expect(result.status).toBe("applied");
    expect(result.request.messages.map((message) => message.content)).toEqual([
      "runtime v2",
      "Deep compact context\nolder stable summary",
      "Context compact projection\nrecent stable summary",
      "second post compact request",
    ]);
    expect(result.request.promptCacheTtl).toBe("1h");
    expect(result.request.cacheBreakNonce).toBe("fresh-nonce");
    const parentObservation = observeCacheSafeRequest({
      kind: "main",
      provider: "anthropic",
      request: makeRequest({ messages: compactMessages }),
    });
    const shapedObservation = observeCacheSafeRequest({
      kind: "main",
      provider: "anthropic",
      request: result.request,
    });
    expect(shapedObservation.fingerprint.conversationPrefixHash).toBe(
      parentObservation.fingerprint.conversationPrefixHash,
    );
  });

  it("skips post-compact main-chain inheritance when compact prefix changed", () => {
    const state: CacheRequestObservationState = {
      postCompactCacheWarmup: createPostCompactCacheWarmup({
        projection: {
          boundaryId: "compact-2",
          createdAt: "2026-01-01T00:00:00.000Z",
          summary: "new summary",
          pressureRatio: 0.8,
          preCompactChars: 120_000,
          postCompactChars: 40_000,
          discardedRange: "older context summarized",
          toolPairingSafe: true,
          risks: [],
          evidenceRefs: [],
        },
        totalTurns: 2,
      }),
    };
    rememberCacheSafePrefix(
      state,
      makeRequest({
        messages: [
          { role: "system", content: "runtime v1" },
          { role: "user", content: "Context compact projection\nold summary" },
          { role: "user", content: "first request" },
        ],
      }),
    );

    const result = applyPostCompactMainChainCacheSafePrefix({
      state,
      request: makeRequest({
        messages: [
          { role: "system", content: "runtime v2" },
          { role: "user", content: "Context compact projection\nnew summary" },
          { role: "user", content: "second request" },
        ],
      }),
    });

    expect(result.status).toBe("skipped");
    expect(state.lastCacheSafePrefixSkipReason).toBe("compact stable prefix differs from parent");
    expect(result.request.messages.map((message) => message.content)).toEqual([
      "runtime v2",
      "Context compact projection\nnew summary",
      "second request",
    ]);
  });

  it("skips post-compact main-chain inheritance when current tail contains tool results", () => {
    const state: CacheRequestObservationState = {
      postCompactCacheWarmup: createPostCompactCacheWarmup({
        projection: {
          boundaryId: "compact-1",
          createdAt: "2026-01-01T00:00:00.000Z",
          summary: "summary",
          pressureRatio: 0.8,
          preCompactChars: 120_000,
          postCompactChars: 40_000,
          discardedRange: "older context summarized",
          toolPairingSafe: true,
          risks: [],
          evidenceRefs: [],
        },
        totalTurns: 2,
      }),
    };
    rememberCacheSafePrefix(
      state,
      makeRequest({
        messages: [
          { role: "system", content: "runtime" },
          { role: "user", content: "Context compact projection\nsummary" },
          { role: "user", content: "first request" },
        ],
      }),
    );

    const result = applyPostCompactMainChainCacheSafePrefix({
      state,
      request: makeRequest({
        messages: [
          { role: "system", content: "runtime" },
          { role: "user", content: "Context compact projection\nsummary" },
          { role: "assistant", content: "calling tool" },
          { role: "tool", content: "tool result", tool_call_id: "tool-1" },
          { role: "user", content: "continue" },
        ],
      }),
    });

    expect(result.status).toBe("skipped");
    expect(state.lastCacheSafePrefixSkipReason).toBe("request has no safe current main-chain tail");
  });

  it("reuses post-compact compact prefix when only dynamic tools changed", () => {
    const state: CacheRequestObservationState = {
      postCompactCacheWarmup: createPostCompactCacheWarmup({
        projection: {
          boundaryId: "compact-dynamic-tools",
          createdAt: "2026-01-01T00:00:00.000Z",
          summary: "summary",
          pressureRatio: 0.8,
          preCompactChars: 120_000,
          postCompactChars: 40_000,
          discardedRange: "older context summarized",
          toolPairingSafe: true,
          risks: [],
          evidenceRefs: [],
        },
        totalTurns: 2,
      }),
    };
    const parentTools: ModelRequest["tools"] = [
      { name: "Read", description: "read file", inputSchema: { type: "object" }, source: "built-in" },
      { name: "mcp__search", description: "search v1", inputSchema: { type: "object" }, source: "mcp" },
    ];
    const currentTools: ModelRequest["tools"] = [
      parentTools[0],
      {
        name: "mcp__search",
        description: "search v2",
        inputSchema: { type: "object", properties: { query: { type: "string" } } },
        source: "mcp",
      },
    ];
    rememberCacheSafePrefix(
      state,
      makeRequest({
        messages: [
          { role: "system", content: "runtime" },
          { role: "user", content: "Context compact projection\nsummary" },
          { role: "user", content: "first request" },
        ],
        tools: parentTools,
      }),
    );

    const result = applyPostCompactMainChainCacheSafePrefix({
      state,
      request: makeRequest({
        messages: [
          { role: "system", content: "runtime" },
          { role: "user", content: "second request" },
        ],
        tools: currentTools,
      }),
    });

    expect(result.status).toBe("applied");
    expect(result.request.tools).toBe(currentTools);
    expect(result.request.messages.map((message) => message.content)).toEqual([
      "runtime",
      "Context compact projection\nsummary",
      "second request",
    ]);
  });

  it("does not spend post-compact warmup on sidechain observations", () => {
    const state: CacheRequestObservationState = {
      postCompactCacheWarmup: createPostCompactCacheWarmup({
        projection: {
          boundaryId: "compact-side",
          createdAt: "2026-01-01T00:00:00.000Z",
          summary: "summary",
          pressureRatio: 0.8,
          preCompactChars: 120_000,
          postCompactChars: 40_000,
          discardedRange: "older context summarized",
          toolPairingSafe: true,
          risks: [],
          evidenceRefs: [],
        },
        totalTurns: 2,
      }),
    };

    recordCacheRequestObservation(state, "side-question", "anthropic", makeRequest());

    expect(state.postCompactCacheWarmup?.status).toBe("warming");
    expect(state.postCompactCacheWarmup?.remainingTurns).toBe(2);
  });

  it("lets side questions reuse the parent message prefix without inheriting tools", () => {
    const state: CacheRequestObservationState = {};
    rememberCacheSafePrefix(
      state,
      makeRequest({
        promptCacheTtl: "1h",
        cacheBreakNonce: "parent-nonce",
      }),
    );

    const result = applyLastCacheSafePrefix({
      state,
      inheritMessages: true,
      request: makeRequest({
        messages: [{ role: "user", content: "btw" }],
        tools: undefined,
        toolChoice: "none",
        promptCacheEnabled: undefined,
      }),
    });
    const shaped = applyCacheWritePolicyToRequest(result.request, resolveCachePolicy("side-question"));

    expect(result.status).toBe("applied");
    expect(shaped.messages.map((message) => message.content)).toEqual(["system", "hello", "btw"]);
    expect(shaped.tools).toBeUndefined();
    expect(shaped.toolChoice).toBe("none");
    expect(shaped.promptCacheEnabled).toBeUndefined();
    expect(shaped.cacheBreakNonce).toBeUndefined();
  });

  it("skips cache-safe inheritance when child tool schema differs from parent", () => {
    const state: CacheRequestObservationState = {};
    rememberCacheSafePrefix(state, makeRequest());

    const result = applyLastCacheSafePrefix({
      state,
      inheritTools: true,
      request: makeRequest({
        tools: [{ name: "Read", description: "read file", inputSchema: { type: "object" } }],
      }),
    });

    expect(result.status).toBe("skipped");
    expect(state.lastCacheSafePrefixSkipReason).toBe("tool schema differs from parent prefix");
    expect(result.request.tools).toHaveLength(1);
  });

  it("lets child agents inherit only parent system prefix and matching tool shape", () => {
    const state: CacheRequestObservationState = {};
    rememberCacheSafePrefix(
      state,
      makeRequest({
        messages: [
          { role: "system", content: "stable runtime" },
          { role: "user", content: "parent task" },
          { role: "assistant", content: "parent reply" },
        ],
      }),
    );

    const result = applyLastCacheSafePrefix({
      state,
      inheritSystemPrefix: true,
      inheritTools: true,
      request: makeRequest({
        messages: [{ role: "user", content: "child task" }],
      }),
    });

    expect(result.status).toBe("applied");
    expect(result.request.messages.map((message) => message.content)).toEqual([
      "stable runtime",
      "child task",
    ]);
    expect(result.request.tools).toEqual(makeRequest().tools);
    expect(result.request.toolChoice).toBe("auto");
  });

  it("skips system-prefix inheritance when parent has no stable system message", () => {
    const state: CacheRequestObservationState = {};
    rememberCacheSafePrefix(
      state,
      makeRequest({
        messages: [{ role: "user", content: "parent task" }],
      }),
    );

    const result = applyLastCacheSafePrefix({
      state,
      inheritSystemPrefix: true,
      request: makeRequest({
        messages: [{ role: "user", content: "child task" }],
      }),
    });

    expect(result.status).toBe("skipped");
    if (result.status === "skipped") {
      expect(result.reason).toBe("parent prefix has no stable system messages");
    }
    expect(result.request.messages.map((message) => message.content)).toEqual(["child task"]);
  });

  it("marks usage as estimated when provider returns no cache fields", () => {
    expect(
      normalizeCacheUsageObservation(
        makeUsage({ cacheReadTokens: undefined, cacheWriteTokens: undefined }),
      ),
    ).toMatchObject({
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      source: "estimated",
    });
  });

  it("allows cache writes only for main-chain request kinds", () => {
    expect(resolveCachePolicy("main").write.allowWrite).toBe(true);
    expect(resolveCachePolicy("continuation").write.allowWrite).toBe(true);
    expect(resolveCachePolicy("final").write.allowWrite).toBe(true);
    expect(resolveCachePolicy("agent-child").write.allowWrite).toBe(false);
    expect(resolveCachePolicy("side-question").write.allowWrite).toBe(false);
    expect(resolveCachePolicy("deep-compact").write.allowWrite).toBe(false);
  });

  it("covers the Phase 4 request-shape and cache-write route matrix", () => {
    const provider = new OpenAiCompatibleProvider({
      id: "claude-relay",
      type: "openai-compatible",
      baseUrl: "https://relay.example.com/v1",
      apiKey: "test-key",
      model: "claude-3-5-sonnet-latest",
      endpointProfile: "anthropic_messages",
    });
    const state: CacheRequestObservationState = {};
    const routeInputs: Array<{
      kind: CacheRequestKind;
      expectedWrite: boolean;
      request: ModelRequest;
    }> = [
      {
        kind: "main",
        expectedWrite: true,
        request: makeRequest({ promptCacheTtl: "1h", cacheBreakNonce: "main-nonce" }),
      },
      {
        kind: "continuation",
        expectedWrite: true,
        request: makeRequest({
          promptCacheTtl: undefined,
          cacheBreakNonce: "continuation-nonce",
          endpointProfile: "chat_completions",
          reasoningLevel: "low",
        }),
      },
      {
        kind: "final",
        expectedWrite: true,
        request: makeRequest({
          promptCacheTtl: undefined,
          cacheBreakNonce: "final-nonce",
          endpointProfile: "chat_completions",
          reasoningLevel: "minimal",
        }),
      },
      {
        kind: "agent-child",
        expectedWrite: false,
        request: makeRequest({ requestContext: "agent", cacheBreakNonce: "agent-nonce" }),
      },
      {
        kind: "side-question",
        expectedWrite: false,
        request: makeRequest({ toolChoice: "none", cacheBreakNonce: "btw-nonce" }),
      },
      {
        kind: "deep-compact",
        expectedWrite: false,
        request: makeRequest({ toolChoice: "none", cacheBreakNonce: "compact-nonce" }),
      },
    ];

    for (const { kind, expectedWrite, request } of routeInputs) {
      const policy = resolveCachePolicy(kind);
      const shaped = applyCacheWritePolicyToRequest(request, policy, state);
      const body = provider.createAnthropicMessagesRequest({
        ...shaped,
        tools: [
          { name: "Read", description: "Read file", inputSchema: { type: "object" } },
          { name: "mcp__search", description: "MCP search", inputSchema: { type: "object" } },
        ],
      });

      expect(policy.write.allowWrite, kind).toBe(expectedWrite);
      expect(shaped.promptCacheEnabled === true, kind).toBe(expectedWrite);
      const expectedToolNames =
        request.toolChoice === "none"
          ? ["Read", "mcp__search"]
          : ["Read", "mcp__search", "web_search"];
      expect(body.tools?.map((tool) => tool.name), kind).toEqual(expectedToolNames);

      if (expectedWrite) {
        expect(shaped.promptCacheTtl, kind).toBe("1h");
        expect(shaped.cacheBreakNonce, kind).toBe("main-nonce");
        expect(shaped.endpointProfile, kind).toBe("anthropic_messages");
        expect(shaped.reasoningLevel, kind).toBe("high");
        expect(Array.isArray(body.system), kind).toBe(true);
        expect(body.tools?.map((tool) => tool.cache_control), kind).toEqual(
          expectedToolNames.map((_, index) =>
            index === 0 ? { type: "ephemeral", ttl: "1h" } : undefined,
          ),
        );
        expect(JSON.stringify(body), kind).toContain("linghun-break-cache:main-nonce");
      } else {
        expect(shaped.promptCacheTtl, kind).toBeUndefined();
        expect(shaped.cacheBreakNonce, kind).toBeUndefined();
        expect(typeof body.system, kind).toBe("string");
        expect(body.tools?.map((tool) => tool.cache_control), kind).toEqual(
          expectedToolNames.map(() => undefined),
        );
        expect(JSON.stringify(body), kind).not.toContain("linghun-break-cache");
      }
    }
  });

  it("keeps main-chain cache fields unchanged without a request-shape latch", () => {
    const request = makeRequest({ promptCacheTtl: "1h", cacheBreakNonce: "nonce" });
    const next = applyCacheWritePolicyToRequest(request, resolveCachePolicy("main"));

    expect(next).toBe(request);
    expect(next.promptCacheEnabled).toBe(true);
    expect(next.promptCacheTtl).toBe("1h");
    expect(next.cacheBreakNonce).toBe("nonce");
  });

  it("latches main-chain prompt cache request shape for continuations", () => {
    const state: CacheRequestObservationState = {};
    const first = applyCacheWritePolicyToRequest(
      makeRequest({ promptCacheTtl: "1h", cacheBreakNonce: "nonce-a", reasoningLevel: "High" }),
      resolveCachePolicy("main"),
      state,
    );
    const second = applyCacheWritePolicyToRequest(
      makeRequest({
        promptCacheTtl: undefined,
        cacheBreakNonce: "nonce-b",
        endpointProfile: "chat_completions",
        reasoningLevel: "Low",
      }),
      resolveCachePolicy("continuation"),
      state,
    );

    expect(first.promptCacheTtl).toBe("1h");
    expect(second).not.toBe(first);
    expect(second.promptCacheEnabled).toBe(true);
    expect(second.promptCacheTtl).toBe("1h");
    expect(second.cacheBreakNonce).toBe("nonce-a");
    expect(second.endpointProfile).toBe("anthropic_messages");
    expect(second.reasoningLevel).toBe("High");
    expect(state.cacheRequestShapeLatch).toEqual({
      promptCacheEnabled: true,
      promptCacheTtl: "1h",
      cacheBreakNonce: "nonce-a",
      endpointProfile: "anthropic_messages",
      reasoningLevel: "High",
    });
  });

  it("does not let final requests promote a latched 5m cache shape to 1h", () => {
    const state: CacheRequestObservationState = {};
    applyCacheWritePolicyToRequest(
      makeRequest({ promptCacheTtl: undefined }),
      resolveCachePolicy("main"),
      state,
    );
    const next = applyCacheWritePolicyToRequest(
      makeRequest({ promptCacheTtl: "1h" }),
      resolveCachePolicy("final"),
      state,
    );

    expect(next.promptCacheEnabled).toBe(true);
    expect(next.promptCacheTtl).toBeUndefined();
    expect(state.cacheRequestShapeLatch).toEqual({
      promptCacheEnabled: true,
      promptCacheTtl: "5m",
      cacheBreakNonce: undefined,
      endpointProfile: "anthropic_messages",
      reasoningLevel: "high",
    });
  });

  it("latches disabled prompt cache shape for continuations without re-enabling writes", () => {
    const state: CacheRequestObservationState = {};
    applyCacheWritePolicyToRequest(
      makeRequest({ promptCacheEnabled: false, promptCacheTtl: "1h", cacheBreakNonce: "nonce" }),
      resolveCachePolicy("main"),
      state,
    );
    const next = applyCacheWritePolicyToRequest(
      makeRequest({ promptCacheEnabled: true, promptCacheTtl: "1h", cacheBreakNonce: "new-nonce" }),
      resolveCachePolicy("continuation"),
      state,
    );

    expect(next.promptCacheEnabled).toBeUndefined();
    expect(next.promptCacheTtl).toBeUndefined();
    expect(next.cacheBreakNonce).toBeUndefined();
  });

  it("refreshes request-shape latch for a new main request", () => {
    const state: CacheRequestObservationState = {};
    applyCacheWritePolicyToRequest(
      makeRequest({ promptCacheTtl: "1h" }),
      resolveCachePolicy("main"),
      state,
    );
    const next = applyCacheWritePolicyToRequest(
      makeRequest({ promptCacheEnabled: false, promptCacheTtl: undefined }),
      resolveCachePolicy("main"),
      state,
    );

    expect(next.promptCacheEnabled).toBe(false);
    expect(next.promptCacheTtl).toBeUndefined();
    expect(state.cacheRequestShapeLatch).toMatchObject({
      promptCacheEnabled: false,
      promptCacheTtl: "5m",
    });
  });

  it("removes cache write fields from sidechain requests while preserving request shape", () => {
    const request = makeRequest({
      promptCacheTtl: "1h",
      cacheBreakNonce: "nonce",
      requestContext: "agent",
    });
    const next = applyCacheWritePolicyToRequest(request, resolveCachePolicy("agent-child"));

    expect(next).not.toBe(request);
    expect(next.promptCacheEnabled).toBeUndefined();
    expect(next.promptCacheTtl).toBeUndefined();
    expect(next.cacheBreakNonce).toBeUndefined();
    expect(next.messages).toBe(request.messages);
    expect(next.model).toBe(request.model);
    expect(next.endpointProfile).toBe(request.endpointProfile);
    expect(next.requestContext).toBe("agent");
    expect(next.tools).toBe(request.tools);
    expect(next.toolChoice).toBe("auto");
  });
});
