import { describe, expect, it } from "vitest";
import {
  buildStableContextUsageSnapshot,
  calculateContextPercentages,
  getContextWindowForModel,
  getNativeContextWindowForModel,
} from "./context-window-runtime.js";

describe("context-window-runtime", () => {
  it("prefers route maxInputTokens, then [1m] suffix, then known model context window, then default", () => {
    expect(getContextWindowForModel("deepseek-chat", { maxInputTokens: 80_000 })).toBe(80_000);
    expect(getContextWindowForModel("deepseek-chat[1m]")).toBe(1_000_000);
    expect(getContextWindowForModel("some-model[1M]")).toBe(1_000_000);
    expect(getContextWindowForModel("deepseek-chat")).toBe(200_000);
    expect(getContextWindowForModel("unknown-model")).toBe(200_000);
  });

  it("route maxInputTokens takes precedence over [1m] suffix for configured input budget", () => {
    expect(getContextWindowForModel("model[1m]", { maxInputTokens: 200_000 })).toBe(200_000);
  });

  it("native context window ignores route maxInputTokens for usage display", () => {
    expect(getNativeContextWindowForModel("model[1m]")).toBe(1_000_000);
    expect(getNativeContextWindowForModel("deepseek-chat")).toBe(200_000);
  });

  it("formats bounded context usage percentage", () => {
    const result = calculateContextPercentages(12_000, 200_000);
    expect(result.ratio).toBeCloseTo(0.06);
    expect(result.label).toBe("上下文 6.0% (12k/200k)");
  });

  it("keeps context usage monotonic until compact resets the baseline", () => {
    const first = buildStableContextUsageSnapshot({
      estimatedChars: 40_000,
      maxChars: 800_000,
      updatedAt: "2026-01-01T00:00:00.000Z",
      compacted: false,
    });
    const lower = buildStableContextUsageSnapshot({
      previous: first,
      estimatedChars: 30_000,
      maxChars: 800_000,
      updatedAt: "2026-01-01T00:00:01.000Z",
      compacted: false,
    });
    const compacted = buildStableContextUsageSnapshot({
      previous: lower,
      estimatedChars: 10_000,
      maxChars: 800_000,
      updatedAt: "2026-01-01T00:00:02.000Z",
      compacted: true,
    });
    const grown = buildStableContextUsageSnapshot({
      previous: compacted,
      estimatedChars: 15_000,
      maxChars: 800_000,
      updatedAt: "2026-01-01T00:00:03.000Z",
      compacted: false,
    });

    expect(lower.estimatedChars).toBe(40_000);
    expect(compacted.estimatedChars).toBe(10_000);
    expect(compacted.source).toBe("compact");
    expect(grown.estimatedChars).toBe(15_000);
  });
});
