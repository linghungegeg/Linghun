import { describe, expect, it } from "vitest";
import { calculateContextPercentages, getContextWindowForModel } from "./context-window-runtime.js";

describe("context-window-runtime", () => {
  it("prefers route maxInputTokens, then [1m] suffix, then known model context window, then default", () => {
    expect(getContextWindowForModel("deepseek-chat", { maxInputTokens: 80_000 })).toBe(80_000);
    expect(getContextWindowForModel("deepseek-chat[1m]")).toBe(1_000_000);
    expect(getContextWindowForModel("some-model[1M]")).toBe(1_000_000);
    expect(getContextWindowForModel("deepseek-chat")).toBe(128_000);
    expect(getContextWindowForModel("unknown-model")).toBe(128_000);
  });

  it("route maxInputTokens takes precedence over [1m] suffix", () => {
    expect(getContextWindowForModel("model[1m]", { maxInputTokens: 200_000 })).toBe(200_000);
  });

  it("formats bounded context usage percentage", () => {
    const result = calculateContextPercentages(12_000, 200_000);
    expect(result.ratio).toBeCloseTo(0.06);
    expect(result.label).toBe("上下文 6.0% (12k/200k)");
  });
});
