import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LinghunError } from "@linghun/core";
import { ModelGateway, type LinghunEvent, type ModelInfo, type Provider } from "@linghun/providers";
import {
  BREAKER_CONSTANTS,
  type ProviderCircuitBreakerState,
  checkProviderCooldown,
  clearProviderBreaker,
  createProviderCircuitBreakerState,
  formatCooldownDoctorLine,
  formatCooldownMessage,
  isRecoverableProviderFailure,
  makeBreakerKey,
  recordProviderFailure,
  withProviderRetry,
} from "./provider-circuit-breaker.js";

describe("provider-circuit-breaker", () => {
  let state: ProviderCircuitBreakerState;

  beforeEach(() => {
    state = createProviderCircuitBreakerState();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("createProviderCircuitBreakerState", () => {
    it("returns empty entries map", () => {
      expect(state.entries.size).toBe(0);
    });
  });

  describe("makeBreakerKey", () => {
    it("combines provider and model with separator", () => {
      expect(makeBreakerKey("openai", "gpt-4o")).toBe("openai::gpt-4o");
    });
  });

  describe("isRecoverableProviderFailure", () => {
    it("returns true for PROVIDER_SERVER_ERROR", () => {
      expect(isRecoverableProviderFailure("PROVIDER_SERVER_ERROR")).toBe(true);
    });

    it("returns true for PROVIDER_RATE_LIMITED", () => {
      expect(isRecoverableProviderFailure("PROVIDER_RATE_LIMITED")).toBe(true);
    });

    it("returns true for PROVIDER_REQUEST_TIMEOUT", () => {
      expect(isRecoverableProviderFailure("PROVIDER_REQUEST_TIMEOUT")).toBe(true);
    });

    it("returns true for PROVIDER_STREAM_TIMEOUT", () => {
      expect(isRecoverableProviderFailure("PROVIDER_STREAM_TIMEOUT")).toBe(true);
    });

    it("returns true for PROVIDER_NETWORK_ERROR", () => {
      expect(isRecoverableProviderFailure("PROVIDER_NETWORK_ERROR")).toBe(true);
    });

    it("returns false for PROVIDER_AUTH_ERROR", () => {
      expect(isRecoverableProviderFailure("PROVIDER_AUTH_ERROR")).toBe(false);
    });

    it("returns false for PROVIDER_SCHEMA_ERROR", () => {
      expect(isRecoverableProviderFailure("PROVIDER_SCHEMA_ERROR")).toBe(false);
    });

    it("returns true for PROVIDER_QUOTA_EXHAUSTED", () => {
      expect(isRecoverableProviderFailure("PROVIDER_QUOTA_EXHAUSTED")).toBe(true);
    });

    it("returns false for ABORT", () => {
      expect(isRecoverableProviderFailure("ABORT")).toBe(false);
    });

    it("returns false for UNKNOWN", () => {
      expect(isRecoverableProviderFailure("UNKNOWN")).toBe(false);
    });
  });

  describe("recordProviderFailure", () => {
    it("ignores non-recoverable error codes", () => {
      recordProviderFailure(state, "openai", "gpt-4o", "PROVIDER_AUTH_ERROR");
      expect(state.entries.size).toBe(0);
    });

    it("does not enter cooldown for schema/tool_choice bad request failures", () => {
      recordProviderFailure(state, "openai", "gpt-4o", "PROVIDER_BAD_REQUEST");
      recordProviderFailure(state, "openai", "gpt-4o", "PROVIDER_BAD_REQUEST");

      expect(state.entries.size).toBe(0);
      expect(checkProviderCooldown(state, "openai", "gpt-4o").blocked).toBe(false);
    });

    it("does not count protocol or stream-boundary failures toward cooldown", () => {
      for (const code of [
        "PROVIDER_NON_SSE_STREAM",
        "PROVIDER_MALFORMED_STREAM",
        "PROVIDER_PARTIAL_TOOL_CALL",
      ]) {
        recordProviderFailure(state, "openai", "gpt-4o", code);
      }

      expect(state.entries.size).toBe(0);
      expect(checkProviderCooldown(state, "openai", "gpt-4o").blocked).toBe(false);
    });

    it("records first recoverable failure without entering cooldown", () => {
      recordProviderFailure(state, "openai", "gpt-4o", "PROVIDER_RATE_LIMITED");
      const entry = state.entries.get("openai::gpt-4o");
      expect(entry).toBeDefined();
      expect(entry?.state).toBe("closed");
      expect(entry?.consecutiveFailures).toBe(1);
      expect(entry?.cooldownUntil).toBe(0);
      expect(entry?.reasonCode).toBe("PROVIDER_RATE_LIMITED");
    });

    it("enters cooldown after reaching threshold (5 consecutive failures)", () => {
      vi.setSystemTime(1000);
      for (let i = 0; i < 4; i += 1) {
        vi.setSystemTime(1000 + i * 100);
        recordProviderFailure(state, "openai", "gpt-4o", "PROVIDER_SERVER_ERROR");
      }
      vi.setSystemTime(2000);
      recordProviderFailure(state, "openai", "gpt-4o", "PROVIDER_SERVER_ERROR");
      const entry = state.entries.get("openai::gpt-4o");
      expect(entry).toBeDefined();
      expect(entry?.state).toBe("open");
      expect(entry?.consecutiveFailures).toBe(5);
      expect(entry?.cooldownUntil).toBe(2000 + BREAKER_CONSTANTS.COOLDOWN_MS);
      expect(entry?.reasonCode).toBe("PROVIDER_SERVER_ERROR");
    });

    it("tracks different provider+model combinations independently", () => {
      recordProviderFailure(state, "openai", "gpt-4o", "PROVIDER_RATE_LIMITED");
      recordProviderFailure(state, "anthropic", "claude-3", "PROVIDER_SERVER_ERROR");
      expect(state.entries.size).toBe(2);
      expect(state.entries.get("openai::gpt-4o")?.consecutiveFailures).toBe(1);
      expect(state.entries.get("anthropic::claude-3")?.consecutiveFailures).toBe(1);
    });

    it("updates reason code to the latest failure", () => {
      recordProviderFailure(state, "openai", "gpt-4o", "PROVIDER_RATE_LIMITED");
      recordProviderFailure(state, "openai", "gpt-4o", "PROVIDER_STREAM_TIMEOUT");
      const entry = state.entries.get("openai::gpt-4o");
      expect(entry?.reasonCode).toBe("PROVIDER_STREAM_TIMEOUT");
    });
  });

  describe("clearProviderBreaker", () => {
    it("removes the entry for the given provider+model", () => {
      for (let i = 0; i < 5; i += 1) {
        recordProviderFailure(state, "openai", "gpt-4o", "PROVIDER_SERVER_ERROR");
      }
      expect(state.entries.has("openai::gpt-4o")).toBe(true);
      clearProviderBreaker(state, "openai", "gpt-4o");
      expect(state.entries.has("openai::gpt-4o")).toBe(false);
    });

    it("does not throw when clearing a non-existent entry", () => {
      expect(() => clearProviderBreaker(state, "openai", "gpt-4o")).not.toThrow();
    });

    it("does not affect other provider+model entries", () => {
      for (let i = 0; i < 5; i += 1) {
        recordProviderFailure(state, "openai", "gpt-4o", "PROVIDER_SERVER_ERROR");
        recordProviderFailure(state, "anthropic", "claude-3", "PROVIDER_SERVER_ERROR");
      }
      clearProviderBreaker(state, "openai", "gpt-4o");
      expect(state.entries.has("anthropic::claude-3")).toBe(true);
    });
  });

  describe("checkProviderCooldown", () => {
    it("returns blocked=false when no entry exists", () => {
      const result = checkProviderCooldown(state, "openai", "gpt-4o");
      expect(result.blocked).toBe(false);
    });

    it("returns blocked=false when below threshold (4 failures)", () => {
      for (let i = 0; i < 4; i += 1) {
        vi.setSystemTime(1000 + i * 100);
        recordProviderFailure(state, "openai", "gpt-4o", "PROVIDER_SERVER_ERROR");
      }
      const result = checkProviderCooldown(state, "openai", "gpt-4o");
      expect(result.blocked).toBe(false);
    });

    it("returns blocked=true with remaining time when in cooldown", () => {
      vi.setSystemTime(10_000);
      for (let i = 0; i < 5; i += 1) {
        vi.setSystemTime(10_000 + i * 100);
        recordProviderFailure(state, "openai", "gpt-4o", "PROVIDER_SERVER_ERROR");
      }
      // Still at time 10_500 — full cooldown remaining
      const result = checkProviderCooldown(state, "openai", "gpt-4o");
      expect(result.blocked).toBe(true);
      if (result.blocked) {
        expect(result.remainingMs).toBe(BREAKER_CONSTANTS.COOLDOWN_MS);
        expect(result.reasonCode).toBe("PROVIDER_SERVER_ERROR");
        expect(result.entry.providerId).toBe("openai");
        expect(result.entry.model).toBe("gpt-4o");
      }
    });

    it("returns blocked=false and moves to half-open after cooldown expires", () => {
      vi.setSystemTime(10_000);
      for (let i = 0; i < 5; i += 1) {
        vi.setSystemTime(10_000 + i * 100);
        recordProviderFailure(state, "openai", "gpt-4o", "PROVIDER_SERVER_ERROR");
      }
      // Advance past cooldown
      vi.setSystemTime(11_000 + BREAKER_CONSTANTS.COOLDOWN_MS + 1);
      const result = checkProviderCooldown(state, "openai", "gpt-4o");
      expect(result.blocked).toBe(false);
      expect(state.entries.get("openai::gpt-4o")?.state).toBe("half-open");
      expect(state.entries.get("openai::gpt-4o")?.cooldownUntil).toBe(0);
    });

    it("returns correct remaining time mid-cooldown", () => {
      vi.setSystemTime(10_000);
      for (let i = 0; i < 10; i += 1) {
        vi.setSystemTime(10_000 + i * 100);
        recordProviderFailure(state, "openai", "gpt-4o", "PROVIDER_RATE_LIMITED");
      }
      // Advance 20 seconds into cooldown
      vi.setSystemTime(31_000);
      const result = checkProviderCooldown(state, "openai", "gpt-4o");
      expect(result.blocked).toBe(true);
      if (result.blocked) {
        // cooldownUntil = 10_900 + 120_000 = 130_900; remaining = 130_900 - 31_000 = 99_900
        expect(result.remainingMs).toBe(99_900);
      }
    });
  });

  describe("formatCooldownMessage", () => {
    it("formats English message with seconds and next steps", () => {
      const msg = formatCooldownMessage("openai", "gpt-4o", 30_000, "en-US");
      expect(msg).toContain("openai/gpt-4o");
      expect(msg).toContain("30s");
      expect(msg).toContain("/model doctor");
      expect(msg).toContain("/model");
    });

    it("formats Chinese message with seconds and next steps", () => {
      const msg = formatCooldownMessage("openai", "gpt-4o", 15_000, "zh-CN");
      expect(msg).toContain("openai/gpt-4o");
      expect(msg).toContain("15 秒");
      expect(msg).toContain("/model doctor");
      expect(msg).toContain("/model");
    });

    it("rounds up partial seconds", () => {
      const msg = formatCooldownMessage("openai", "gpt-4o", 1_500, "en-US");
      expect(msg).toContain("2s");
    });

    it("formats cooldown cause for non-SSE compatibility without generic instability", () => {
      const msg = formatCooldownMessage(
        "openai",
        "gpt-4o",
        10_000,
        "zh-CN",
        "PROVIDER_NON_SSE_STREAM",
      );
      expect(msg).toContain("SSE");
      expect(msg).toContain("endpointProfile");
      expect(msg).not.toContain("暂时不稳定");
    });
  });

  describe("formatCooldownDoctorLine", () => {
    it("returns undefined when no active cooldowns", () => {
      const result = formatCooldownDoctorLine(state, "en-US");
      expect(result).toBeUndefined();
    });

    it("returns undefined when entry exists but cooldown expired", () => {
      vi.setSystemTime(10_000);
      for (let i = 0; i < 10; i += 1) {
        vi.setSystemTime(10_000 + i * 100);
        recordProviderFailure(state, "openai", "gpt-4o", "PROVIDER_SERVER_ERROR");
      }
      vi.setSystemTime(11_000 + BREAKER_CONSTANTS.COOLDOWN_MS + 1);
      // Entry still in map but cooldown expired
      const result = formatCooldownDoctorLine(state, "en-US");
      expect(result).toBeUndefined();
    });

    it("returns English doctor line with active cooldown", () => {
      vi.setSystemTime(10_000);
      for (let i = 0; i < 10; i += 1) {
        vi.setSystemTime(10_000 + i * 100);
        recordProviderFailure(state, "openai", "gpt-4o", "PROVIDER_RATE_LIMITED");
      }
      vi.setSystemTime(16_000);
      const result = formatCooldownDoctorLine(state, "en-US");
      expect(result).toBeDefined();
      expect(result).toContain("Active model-service cooldown");
      expect(result).toContain("openai/gpt-4o");
      expect(result).toContain("PROVIDER_RATE_LIMITED");
    });

    it("returns Chinese doctor line with active cooldown", () => {
      vi.setSystemTime(10_000);
      for (let i = 0; i < 10; i += 1) {
        vi.setSystemTime(10_000 + i * 100);
        recordProviderFailure(state, "openai", "gpt-4o", "PROVIDER_SERVER_ERROR");
      }
      vi.setSystemTime(16_000);
      const result = formatCooldownDoctorLine(state, "zh-CN");
      expect(result).toBeDefined();
      expect(result).toContain("模型服务等待恢复");
      expect(result).toContain("openai/gpt-4o");
    });

    it("shows multiple active cooldowns", () => {
      vi.setSystemTime(10_000);
      for (let i = 0; i < 10; i += 1) {
        vi.setSystemTime(10_000 + i * 100);
        recordProviderFailure(state, "openai", "gpt-4o", "PROVIDER_SERVER_ERROR");
        recordProviderFailure(state, "anthropic", "claude-3", "PROVIDER_RATE_LIMITED");
      }
      vi.setSystemTime(16_000);
      const result = formatCooldownDoctorLine(state, "en-US");
      expect(result).toBeDefined();
      expect(result).toContain("openai/gpt-4o");
      expect(result).toContain("anthropic/claude-3");
    });
  });

  describe("end-to-end flow", () => {
    it("full lifecycle: failures → cooldown → expiry → clear", () => {
      vi.setSystemTime(0);

      // First 4 failures — no cooldown
      for (let i = 0; i < 4; i += 1) {
        vi.setSystemTime(i * 100);
        recordProviderFailure(state, "openai", "gpt-4o", "PROVIDER_SERVER_ERROR");
      }
      expect(checkProviderCooldown(state, "openai", "gpt-4o").blocked).toBe(false);

      // 5th failure — enters cooldown
      vi.setSystemTime(1000);
      recordProviderFailure(state, "openai", "gpt-4o", "PROVIDER_SERVER_ERROR");
      const check1 = checkProviderCooldown(state, "openai", "gpt-4o");
      expect(check1.blocked).toBe(true);

      // Mid-cooldown — still blocked
      vi.setSystemTime(20_000);
      const check2 = checkProviderCooldown(state, "openai", "gpt-4o");
      expect(check2.blocked).toBe(true);

      // After cooldown expires — unblocked
      vi.setSystemTime(1000 + BREAKER_CONSTANTS.COOLDOWN_MS + 1);
      const check3 = checkProviderCooldown(state, "openai", "gpt-4o");
      expect(check3.blocked).toBe(false);
      expect(state.entries.get("openai::gpt-4o")?.state).toBe("half-open");
    });

    it("successful request clears breaker mid-accumulation", () => {
      recordProviderFailure(state, "openai", "gpt-4o", "PROVIDER_SERVER_ERROR");
      expect(state.entries.has("openai::gpt-4o")).toBe(true);

      // Simulate successful request
      clearProviderBreaker(state, "openai", "gpt-4o");
      expect(state.entries.has("openai::gpt-4o")).toBe(false);

      // Next failure starts fresh
      recordProviderFailure(state, "openai", "gpt-4o", "PROVIDER_SERVER_ERROR");
      expect(state.entries.get("openai::gpt-4o")?.consecutiveFailures).toBe(1);
      expect(checkProviderCooldown(state, "openai", "gpt-4o").blocked).toBe(false);
    });

    it("non-recoverable errors do not affect breaker state", () => {
      recordProviderFailure(state, "openai", "gpt-4o", "PROVIDER_SERVER_ERROR");
      recordProviderFailure(state, "openai", "gpt-4o", "PROVIDER_AUTH_ERROR");
      recordProviderFailure(state, "openai", "gpt-4o", "PROVIDER_SCHEMA_ERROR");
      // Schema error should not increment — still at 1
      expect(state.entries.get("openai::gpt-4o")?.consecutiveFailures).toBe(1);
      expect(checkProviderCooldown(state, "openai", "gpt-4o").blocked).toBe(false);
    });
  });

  describe("withProviderRetry", () => {
    it("queues requests above the provider active limit", async () => {
      const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
      try {
        const releases: Array<() => void> = [];
        let active = 0;
        let maxActive = 0;
        let started = 0;
        const model: ModelInfo = {
          id: "gpt-4o",
          displayName: "GPT-4o",
          providerId: "openai",
          contextWindow: 128_000,
          maxOutputTokens: 4_096,
          supportsTools: true,
          supportsVision: false,
          supportsThinking: false,
          supportsPromptCache: false,
        };
        const provider: Provider = {
          id: "openai",
          displayName: "OpenAI",
          supports: { streaming: true, usage: true },
          async listModels() {
            return [model];
          },
          async *stream() {
            const streamId = started + 1;
            started += 1;
            active += 1;
            maxActive = Math.max(maxActive, active);
            await new Promise<void>((resolve) => releases.push(resolve));
            active -= 1;
            yield {
              type: "message_stop",
              id: `stop-${streamId}`,
              chunkCount: 1,
              hadUsage: false,
            } satisfies LinghunEvent;
          },
        };
        const gateway = new ModelGateway([provider]);
        const signal = new AbortController().signal;
        const flushMicrotasks = async () => {
          for (let i = 0; i < 5; i += 1) {
            await Promise.resolve();
          }
        };
        const collect = async () => {
          const events: LinghunEvent[] = [];
          for await (const event of withProviderRetry(
            gateway,
            state,
            "openai",
            { messages: [], model: "gpt-4o" },
            signal,
            { maxRetries: 0 },
          )) {
            events.push(event);
          }
          return events;
        };

        const limit = BREAKER_CONSTANTS.PROVIDER_ACTIVE_LIMIT;
        const runs = Array.from({ length: limit + 1 }, () => collect());
        await flushMicrotasks();

        expect(started).toBe(limit);
        expect(maxActive).toBe(limit);

        releases[0]?.();
        await flushMicrotasks();
        await vi.advanceTimersByTimeAsync(3_000);
        await flushMicrotasks();

        expect(started).toBe(limit + 1);
        expect(maxActive).toBe(limit);
        expect(releases).toHaveLength(limit + 1);

        for (const release of releases.slice(1)) {
          release();
        }

        const results = await Promise.all(runs);
        expect(results).toHaveLength(limit + 1);
        expect(results.every((events) => events.some((event) => event.type === "message_stop"))).toBe(true);
        expect(state.entries.size).toBe(0);
      } finally {
        randomSpy.mockRestore();
      }
    });

    it("counts exhausted same-provider retries as one breaker failure", async () => {
      const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
      try {
        let calls = 0;
        const retryEvents: Array<{ attempt: number; maxAttempts: number; code: string }> = [];
        const model: ModelInfo = {
          id: "gpt-4o",
          displayName: "GPT-4o",
          providerId: "openai",
          contextWindow: 128_000,
          maxOutputTokens: 4_096,
          supportsTools: true,
          supportsVision: false,
          supportsThinking: false,
          supportsPromptCache: false,
        };
        const provider: Provider = {
          id: "openai",
          displayName: "OpenAI",
          supports: { streaming: true, usage: true },
          async listModels() {
            return [model];
          },
          async *stream() {
            calls += 1;
            yield {
              type: "error",
              error: new LinghunError({
                code: "PROVIDER_SERVER_ERROR",
                message: "gateway unavailable",
                recoverable: true,
              }),
            } satisfies LinghunEvent;
          },
        };
        const gateway = new ModelGateway([provider]);
        const events: LinghunEvent[] = [];
        const run = (async () => {
          for await (const event of withProviderRetry(
            gateway,
            state,
            "openai",
            { messages: [], model: "gpt-4o" },
            new AbortController().signal,
            { maxRetries: 3, onRetry: (info) => retryEvents.push(info) },
          )) {
            events.push(event);
          }
        })();

        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(500);
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(1_000);
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(2_000);
        await run;

        expect(calls).toBe(4);
        expect(retryEvents.map((event) => `${event.attempt}/${event.maxAttempts}:${event.code}`)).toEqual([
          "1/3:PROVIDER_SERVER_ERROR",
          "2/3:PROVIDER_SERVER_ERROR",
          "3/3:PROVIDER_SERVER_ERROR",
        ]);
        expect(events).toHaveLength(1);
        expect(events[0]?.type).toBe("error");
        expect(state.entries.get("openai::gpt-4o")?.consecutiveFailures).toBe(1);
        expect(checkProviderCooldown(state, "openai", "gpt-4o").blocked).toBe(false);
      } finally {
        randomSpy.mockRestore();
      }
    });

    it("times out idle provider streams and routes them through same-provider retry", async () => {
      const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
      try {
        let calls = 0;
        const retryEvents: Array<{ attempt: number; maxAttempts: number; code: string }> = [];
        const model: ModelInfo = {
          id: "gpt-4o",
          displayName: "GPT-4o",
          providerId: "openai",
          contextWindow: 128_000,
          maxOutputTokens: 4_096,
          supportsTools: true,
          supportsVision: false,
          supportsThinking: false,
          supportsPromptCache: false,
        };
        const provider: Provider = {
          id: "openai",
          displayName: "OpenAI",
          supports: { streaming: true, usage: true },
          async listModels() {
            return [model];
          },
          async *stream(_request, signal) {
            calls += 1;
            await new Promise<void>((resolve) => {
              if (signal?.aborted) {
                resolve();
                return;
              }
              signal?.addEventListener("abort", () => resolve(), { once: true });
            });
          },
        };
        const gateway = new ModelGateway([provider]);
        const events: LinghunEvent[] = [];
        const run = (async () => {
          for await (const event of withProviderRetry(
            gateway,
            state,
            "openai",
            { messages: [], model: "gpt-4o" },
            new AbortController().signal,
            {
              maxRetries: 1,
              streamEventIdleMs: 10,
              onRetry: (info) => retryEvents.push(info),
            },
          )) {
            events.push(event);
          }
        })();

        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(10);
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(500);
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(10);
        await run;

        expect(calls).toBe(2);
        expect(retryEvents.map((event) => `${event.attempt}/${event.maxAttempts}:${event.code}`)).toEqual([
          "1/1:PROVIDER_STREAM_TIMEOUT",
        ]);
        expect(events).toHaveLength(1);
        expect(events[0]?.type).toBe("error");
        if (events[0]?.type === "error") {
          expect(events[0].error.code).toBe("PROVIDER_STREAM_TIMEOUT");
        }
        expect(state.entries.get("openai::gpt-4o")?.consecutiveFailures).toBe(1);
      } finally {
        randomSpy.mockRestore();
      }
    });

    it("does not trip the idle watchdog when stream events keep arriving", async () => {
      const model: ModelInfo = {
        id: "gpt-4o",
        displayName: "GPT-4o",
        providerId: "openai",
        contextWindow: 128_000,
        maxOutputTokens: 4_096,
        supportsTools: true,
        supportsVision: false,
        supportsThinking: false,
        supportsPromptCache: false,
      };
      const provider: Provider = {
        id: "openai",
        displayName: "OpenAI",
        supports: { streaming: true, usage: true },
        async listModels() {
          return [model];
        },
        async *stream() {
          yield { type: "assistant_text_delta", id: "delta-1", text: "ok" } satisfies LinghunEvent;
          yield {
            type: "message_stop",
            id: "stop-1",
            chunkCount: 1,
            hadUsage: false,
            finishReason: "stop",
          } satisfies LinghunEvent;
        },
      };
      const gateway = new ModelGateway([provider]);
      const events: LinghunEvent[] = [];

      for await (const event of withProviderRetry(
        gateway,
        state,
        "openai",
        { messages: [], model: "gpt-4o" },
        new AbortController().signal,
        { maxRetries: 1, streamEventIdleMs: 10 },
      )) {
        events.push(event);
      }

      expect(events.map((event) => event.type)).toEqual(["assistant_text_delta", "message_stop"]);
      expect(state.entries.has("openai::gpt-4o")).toBe(false);
    });

    it("surfaces partial tool-call stream failures without same-provider retry", async () => {
      const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
      try {
        let calls = 0;
        const retryEvents: Array<{ attempt: number; maxAttempts: number; code: string }> = [];
        const model: ModelInfo = {
          id: "gpt-4o",
          displayName: "GPT-4o",
          providerId: "openai",
          contextWindow: 128_000,
          maxOutputTokens: 4_096,
          supportsTools: true,
          supportsVision: false,
          supportsThinking: false,
          supportsPromptCache: false,
        };
        const provider: Provider = {
          id: "openai",
          displayName: "OpenAI",
          supports: { streaming: true, usage: true },
          async listModels() {
            return [model];
          },
          async *stream() {
            calls += 1;
            yield {
              type: "error",
              error: new LinghunError({
                code: "PROVIDER_PARTIAL_TOOL_CALL",
                message: "unfinished tool call",
                recoverable: true,
              }),
            } satisfies LinghunEvent;
          },
        };
        const gateway = new ModelGateway([provider]);
        const events: LinghunEvent[] = [];
        const run = (async () => {
          for await (const event of withProviderRetry(
            gateway,
            state,
            "openai",
            { messages: [], model: "gpt-4o" },
            new AbortController().signal,
            { maxRetries: 1, onRetry: (info) => retryEvents.push(info) },
          )) {
            events.push(event);
          }
        })();

        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(500);
        await run;

        expect(calls).toBe(1);
        expect(retryEvents).toEqual([]);
        expect(events).toHaveLength(1);
        expect(events[0]?.type).toBe("error");
        expect(state.entries.size).toBe(0);
      } finally {
        randomSpy.mockRestore();
      }
    });
  });

  describe("constants", () => {
    it("threshold is 5", () => {
      expect(BREAKER_CONSTANTS.FAILURE_THRESHOLD).toBe(5);
    });

    it("cooldown is 120 seconds", () => {
      expect(BREAKER_CONSTANTS.COOLDOWN_MS).toBe(120_000);
    });

    it("recoverable codes exclude protocol and stream-boundary compatibility failures", () => {
      expect(Array.from(BREAKER_CONSTANTS.RECOVERABLE_CODES)).toEqual(
        expect.arrayContaining([
          "PROVIDER_SERVER_ERROR",
          "PROVIDER_RATE_LIMITED",
          "PROVIDER_REQUEST_TIMEOUT",
          "PROVIDER_STREAM_TIMEOUT",
          "PROVIDER_NETWORK_ERROR",
          "PROVIDER_STREAM_ERROR",
          "PROVIDER_STREAM_DECODE_ERROR",
          "PROVIDER_RETRY_EXHAUSTED",
        ]),
      );
      expect(BREAKER_CONSTANTS.RECOVERABLE_CODES.has("PROVIDER_NON_SSE_STREAM")).toBe(false);
      expect(BREAKER_CONSTANTS.RECOVERABLE_CODES.has("PROVIDER_MALFORMED_STREAM")).toBe(false);
      expect(BREAKER_CONSTANTS.RECOVERABLE_CODES.has("PROVIDER_PARTIAL_TOOL_CALL")).toBe(false);
    });

    it("same-provider retry is limited to real transient errors", () => {
      expect(Array.from(BREAKER_CONSTANTS.SAME_PROVIDER_RETRY_CODES)).toEqual([
        "PROVIDER_NETWORK_ERROR",
        "PROVIDER_REQUEST_TIMEOUT",
        "PROVIDER_STREAM_TIMEOUT",
        "PROVIDER_SERVER_ERROR",
        "PROVIDER_RATE_LIMITED",
      ]);
    });
  });
});
