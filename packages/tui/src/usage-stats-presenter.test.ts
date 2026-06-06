import { describe, expect, it } from "vitest";
import {
  formatEstimatedCny,
  formatStats,
  formatUsage,
  sumRoleUsageEstimatedCny,
} from "./usage-stats-presenter.js";

function createUsageContext() {
  return {
    model: "deepseek-chat",
    cache: {
      startedAt: Date.now(),
      compacted: false,
      history: [
        {
          inputTokens: 100,
          outputTokens: 40,
          cacheReadTokens: 10,
          cacheWriteTokens: 5,
          provider: "deepseek",
          model: "deepseek-chat",
          endpoint: "/v1/chat/completions",
          rawUsage: { prompt_tokens: 100 },
        },
      ],
    },
    roleUsage: [
      {
        role: "executor",
        provider: "deepseek",
        model: "deepseek-chat",
        inputTokens: 1000,
        outputTokens: 1000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        estimatedCny: 0.01,
        createdAt: "2026-06-07T00:00:00.000Z",
        fallbackUsed: false,
        budgetStop: false,
        contributionSummary: "test",
      },
    ],
  };
}

describe("usage-stats-presenter estimated cost", () => {
  it("sums finite role usage estimated CNY and formats unknown values", () => {
    const context = createUsageContext();
    expect(sumRoleUsageEstimatedCny(context as never)).toBe(0.01);
    expect(formatEstimatedCny(0.01234)).toBe("CNY 0.0123");
    expect(formatEstimatedCny(Number.NaN)).toBe("估算中");
  });

  it("/usage and /stats include estimated cost without claiming billing", () => {
    const context = createUsageContext();
    expect(formatUsage(context as never)).toContain("estimated cost: CNY 0.0100");
    const stats = formatStats([], context as never);
    expect(stats).toContain("cost: estimated CNY 0.0100");
    expect(stats).toContain("not billing");
  });
});
