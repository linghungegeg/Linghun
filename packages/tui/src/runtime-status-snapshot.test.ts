import { describe, expect, it } from "vitest";
import {
  createRuntimeStatusSnapshot,
  formatRuntimeStatusSnapshotForBtw,
} from "./runtime-status-snapshot.js";
import type { BackgroundTaskState } from "./tui-data-types.js";

function task(overrides: Partial<BackgroundTaskState>): BackgroundTaskState {
  const now = new Date().toISOString();
  return {
    id: "task-1",
    kind: "job",
    title: "Job",
    status: "running",
    currentStep: "checking",
    startedAt: now,
    updatedAt: now,
    heartbeatIntervalMs: 30_000,
    staleAfterMs: 120_000,
    hasOutput: true,
    userVisibleSummary: "checking files",
    ...overrides,
  };
}

describe("runtime status snapshot", () => {
  it("separates active, stale/resumable, and terminal history", () => {
    const now = new Date().toISOString();
    const snapshot = createRuntimeStatusSnapshot({
      language: "zh-CN",
      backgroundTasks: [
        task({ id: "agent-active", kind: "agent", status: "running", currentStep: "coding" }),
        task({
          id: "job-stale",
          kind: "job",
          status: "stale",
          currentStep: "stale/resumable",
          nextAction: "/job resume job-stale",
        }),
        task({
          id: "job-done",
          kind: "job",
          status: "completed",
          result: "pass",
          currentStep: "done",
          updatedAt: now,
        }),
      ],
    });

    expect(snapshot.activeAgents.map((item) => item.id)).toEqual(["agent-active"]);
    expect(snapshot.staleResumableTasks.map((item) => item.id)).toEqual(["job-stale"]);
    expect(snapshot.recentTerminalTasks.map((item) => item.id)).toEqual(["job-done"]);

    const text = formatRuntimeStatusSnapshotForBtw(snapshot, "zh-CN");
    expect(text).toContain("正在运行：agent 运行中");
    expect(text).toContain("可恢复：job 可恢复");
    expect(text).not.toContain("raw");
  });

  it("reports idle plus recent verification without provider calls", () => {
    const now = new Date().toISOString();
    const snapshot = createRuntimeStatusSnapshot({
      language: "zh-CN",
      backgroundTasks: [],
      lastVerification: { status: "pass", summary: "typecheck 通过", endedAt: now },
    });
    const text = formatRuntimeStatusSnapshotForBtw(snapshot, "zh-CN");
    expect(text).toContain("当前：没有正在运行的任务。");
    expect(text).toContain("最近：verification 通过 · typecheck 通过。");
  });
});
