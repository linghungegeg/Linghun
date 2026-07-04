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
    contextUsage: "上下文 12%",
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

  it("keeps key footer items in narrow mode and drops optional status", () => {
    const keys = selectStatusFooterSegments({
      footer: footer(),
      width: 60,
      cacheTone: "warning",
    }).map((segment) => segment.key);

    expect(keys).toEqual(["model", "index", "cache"]);
  });

  it("keeps only the highest-priority metadata in minimal mode", () => {
    const keys = selectStatusFooterSegments({
      footer: footer({ isRemoteMode: true }),
      width: 40,
    }).map((segment) => segment.key);

    expect(keys).toEqual(["model", "index"]);
  });

  it("wide mode may include optional reasoning, context, and remote", () => {
    const keys = selectStatusFooterSegments({
      footer: footer({ isRemoteMode: true }),
      width: 100,
      gitBranch: "main",
    }).map((segment) => segment.key);

    expect(keys).toEqual([
      "model",
      "index",
      "cache",
      "remote",
      "branch",
      "context",
      "reasoning",
    ]);
  });
});
