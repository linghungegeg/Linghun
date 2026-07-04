import { describe, expect, it } from "vitest";
import { computeScrollWindow, slashSuggestionRowCount } from "./SlashSuggestions.js";

describe("SlashSuggestions sliding window", () => {
  it("returns an empty window for no candidates", () => {
    expect(computeScrollWindow(0, 0, 8)).toEqual({ start: 0, end: 0 });
  });

  it("does not stretch a short list", () => {
    expect(computeScrollWindow(3, 1, 8)).toEqual({ start: 0, end: 3 });
  });

  it("keeps the selected candidate inside a capped window", () => {
    const window = computeScrollWindow(20, 15, 8);

    expect(window.end - window.start).toBe(8);
    expect(window.start).toBeLessThanOrEqual(15);
    expect(window.end).toBeGreaterThan(15);
  });

  it("clamps at the first and last candidates", () => {
    expect(computeScrollWindow(20, 0, 8)).toEqual({ start: 0, end: 8 });
    expect(computeScrollWindow(20, 19, 8)).toEqual({ start: 12, end: 20 });
  });

  it("counts maxRows as the total popup budget including the hint row", () => {
    expect(slashSuggestionRowCount(20, 80, 9) + 1).toBe(9);
    expect(slashSuggestionRowCount(20, 80, 4) + 1).toBe(4);
  });
});
