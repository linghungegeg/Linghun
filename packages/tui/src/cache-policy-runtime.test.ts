import type { ModelRequest, ModelUsage } from "@linghun/providers";
import { describe, expect, it } from "vitest";
import {
  applyCacheWritePolicyToRequest,
  type CacheRequestObservationState,
  normalizeCacheUsageObservation,
  observeCacheSafeRequest,
  observeCacheUsage,
  recordCacheRequestObservation,
  recordCacheUsageObservation,
  resolveCachePolicy,
} from "./cache-policy-runtime.js";

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
  it("creates stable fingerprints when only tool order changes", () => {
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

    expect(second.fingerprint.toolSchemaHash).toBe(first.fingerprint.toolSchemaHash);
    expect(second.fingerprint.changedKeys).toEqual([]);
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

  it("keeps main-chain cache fields unchanged without a request-shape latch", () => {
    const request = makeRequest({ promptCacheTtl: "1h", cacheBreakNonce: "nonce" });
    const next = applyCacheWritePolicyToRequest(request, resolveCachePolicy("main"));

    expect(next).toBe(request);
    expect(next.promptCacheEnabled).toBe(true);
    expect(next.promptCacheTtl).toBe("1h");
    expect(next.cacheBreakNonce).toBe("nonce");
  });

  it("latches main-chain prompt cache TTL shape once enabled", () => {
    const state: CacheRequestObservationState = {};
    const first = applyCacheWritePolicyToRequest(
      makeRequest({ promptCacheTtl: "1h" }),
      resolveCachePolicy("main"),
      state,
    );
    const second = applyCacheWritePolicyToRequest(
      makeRequest({ promptCacheTtl: undefined }),
      resolveCachePolicy("continuation"),
      state,
    );

    expect(first.promptCacheTtl).toBe("1h");
    expect(second).not.toBe(first);
    expect(second.promptCacheEnabled).toBe(true);
    expect(second.promptCacheTtl).toBe("1h");
    expect(state.cacheRequestShapeLatch).toEqual({ promptCacheTtl: "1h" });
  });

  it("does not let later main-chain requests promote a 5m cache shape to 1h", () => {
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
    expect(state.cacheRequestShapeLatch).toEqual({ promptCacheTtl: "5m" });
  });

  it("does not re-enable prompt cache when a later request disables it", () => {
    const state: CacheRequestObservationState = {};
    applyCacheWritePolicyToRequest(
      makeRequest({ promptCacheTtl: "1h" }),
      resolveCachePolicy("main"),
      state,
    );
    const disabled = makeRequest({ promptCacheEnabled: false, promptCacheTtl: undefined });
    const next = applyCacheWritePolicyToRequest(disabled, resolveCachePolicy("main"), state);

    expect(next).toBe(disabled);
    expect(next.promptCacheEnabled).toBe(false);
    expect(next.promptCacheTtl).toBeUndefined();
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
