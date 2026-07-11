import { describe, expect, it } from "vitest";
import type { TuiContext } from "./tui-context-runtime.js";
import type { SelectedModelRuntime } from "./tui-model-runtime.js";
import { providerRuntimeKey, resolveRuntimeFallback } from "./provider-loop-runtime.js";

function makeContext(provider: "gemini" | "grok", model: string): TuiContext {
  return {
    config: {
      providers: {
        base: { type: "openai-compatible", model: "base-model" },
        [provider]: {
          type: provider,
          model,
          reasoningLevel: "High",
        },
      },
      modelRoutes: {
        defaultModel: "base-model",
        routes: [
          {
            role: "executor",
            provider: "base",
            primaryModel: "base-model",
            fallbackModels: [model],
          },
        ],
      },
    },
  } as unknown as TuiContext;
}

const baseRuntime: SelectedModelRuntime = {
  role: "executor",
  provider: "base",
  model: "base-model",
  endpointProfile: "chat_completions",
  reasoningLevel: "High",
  reasoningStatus: "effective/sent High",
  reasoningSent: true,
};

describe("provider fallback reasoning contract", () => {
  it("marks Gemini reasoning as sent", () => {
    const fallback = resolveRuntimeFallback(
      makeContext("gemini", "gemini-test"),
      baseRuntime,
      Object.assign(new Error("rate limited"), { status: 429 }),
    );

    expect(fallback?.runtime).toMatchObject({
      provider: "gemini",
      endpointProfile: "chat_completions",
      reasoningSent: true,
    });
  });

  it("moves through configured fallbacks once and then terminates", () => {
    const context = makeContext("gemini", "fallback-b");
    context.config.providers.grok = { type: "grok", model: "fallback-c" };
    context.config.modelRoutes.routes[0]!.fallbackModels = ["fallback-b", "fallback-c"];
    const attempted = new Set([providerRuntimeKey(baseRuntime)]);
    const error = Object.assign(new Error("gateway failed"), { status: 502 });

    const fallbackB = resolveRuntimeFallback(context, baseRuntime, error, attempted);
    expect(fallbackB?.runtime.model).toBe("fallback-b");
    attempted.add(providerRuntimeKey(fallbackB!.runtime));

    const fallbackC = resolveRuntimeFallback(context, fallbackB!.runtime, error, attempted);
    expect(fallbackC?.runtime.model).toBe("fallback-c");
    attempted.add(providerRuntimeKey(fallbackC!.runtime));

    expect(resolveRuntimeFallback(context, fallbackC!.runtime, error, attempted)).toBeUndefined();
  });

  it("marks Grok reasoning as not sent", () => {
    const fallback = resolveRuntimeFallback(
      makeContext("grok", "grok-test"),
      baseRuntime,
      Object.assign(new Error("rate limited"), { status: 429 }),
    );

    expect(fallback?.runtime).toMatchObject({
      provider: "grok",
      endpointProfile: "responses",
      reasoningSent: false,
    });
  });
});
