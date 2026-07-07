import { describe, expect, it } from "vitest";
import {
  selectStatusFooterSegments,
  statusFooterCollapseMode,
} from "./StatusFooter.js";
import type { TaskFooterView } from "../types.js";

function footer(overrides: Partial<TaskFooterView> = {}): TaskFooterView {
  return {
    permissionMode: "默认模式",
    model: "模型 gpt-5.5",
    cache: "缓存 42%",
    index: "索引 ready",
    cyclePermHint: "（Shift+Tab 切换模式）",
    reasoning: "推理 High",
    contextUsage: {
      wide: "上下文 [██░░░░░░░░] 12% ↓40%",
      narrow: "上下文 12% ↓40%",
      minimal: "上下文 12% ↓40%",
      ratio: 0.12,
    },
    cost: "费用 ¥0.0001 est",
    ...overrides,
  };
}

describe("StatusFooter collapse rules", () => {
  it("uses explicit wide, narrow, and minimal modes", () => {
    expect(statusFooterCollapseMode(100)).toBe("wide");
    expect(statusFooterCollapseMode(60)).toBe("narrow");
    expect(statusFooterCollapseMode(40)).toBe("minimal");
  });

  it("keeps cache followed by context in narrow mode and drops optional status", () => {
    const segments = selectStatusFooterSegments({
      footer: footer(),
      width: 60,
      cacheTone: "warning",
    });

    expect(segments.map((segment) => segment.key)).toEqual(["model", "index", "cache", "context"]);
    expect(segments.map((segment) => segment.text)).toContain("上下文 12% ↓40%");
  });

  it("keeps only context usage in minimal mode when available", () => {
    const segments = selectStatusFooterSegments({
      footer: footer({ isRemoteMode: true }),
      width: 40,
    });

    expect(segments.map((segment) => segment.key)).toEqual(["context"]);
    expect(segments[0]?.text).toBe("上下文 12% ↓40%");
  });

  it("wide mode includes the context progress bar after cache", () => {
    const segments = selectStatusFooterSegments({
      footer: footer({ isRemoteMode: true }),
      width: 100,
      gitBranch: "main",
    });

    expect(segments.map((segment) => segment.key)).toEqual([
      "model",
      "index",
      "cache",
      "context",
      "remote",
      "branch",
      "reasoning",
    ]);
    expect(segments[3]?.text).toBe("上下文 [██░░░░░░░░] 12% ↓40%");
  });
});
