import { describe, expect, it } from "vitest";
import type { TuiContext } from "./tui-context-runtime.js";
import type { SelectedModelRuntime } from "./tui-model-runtime.js";
import { resolveRuntimeFallback } from "./provider-loop-runtime.js";

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
