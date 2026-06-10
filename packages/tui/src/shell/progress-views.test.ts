import { describe, expect, it } from "vitest";
import {
  buildAgentProgressTreeView,
  buildBackgroundTaskOverlayView,
  buildTaskListView,
  buildWorkflowProgressView,
  getBackgroundOverlaySelectedTask,
  updateBackgroundOverlayCursor,
} from "./progress-views.js";
import type { TuiContext } from "../tui-context-runtime.js";

function createContext(): TuiContext {
  return {
    language: "zh-CN",
    tools: { todos: [] },
    agents: [],
    workflows: { enabled: true, templates: [], disabledIds: [] },
    backgroundTasks: [],
    dismissedBackgroundTaskIds: new Set<string>(),
  } as unknown as TuiContext;
}

describe("Phase R3 progress view projectors", () => {
  it("projects agent progress as a tree with tool and token counts", () => {
    const ctx = createContext();
    ctx.agents = [
      {
        id: "agent-1",
        displayName: "Explore",
        status: "running",
        activitySummary: "reading files",
        mailbox: [{ id: "m1" }, { id: "m2" }],
        cost: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, estimatedCny: 0 },
      },
    ] as unknown as TuiContext["agents"];

    const view = buildAgentProgressTreeView(ctx);

    expect(view?.rows[0]).toMatchObject({ name: "Explore", status: "running", toolUses: 2, tokens: 0 });
  });

  it("projects todos with owner and blocked-by fields when present", () => {
    const ctx = createContext();
    ctx.tools.todos = [
      {
        id: "todo-1",
        content: "实现面板",
        status: "in_progress",
        owner: "agent-a",
        blockedBy: ["todo-0"],
      },
    ] as unknown as TuiContext["tools"]["todos"];

    const view = buildTaskListView(ctx);

    expect(view?.rows[0]).toMatchObject({ subject: "实现面板", owner: "agent-a", blockedBy: ["todo-0"] });
  });

  it("projects workflow steps and marks the running step active", () => {
    const ctx = createContext();
    ctx.workflows.activeRuns = [
      {
        id: "wf-1",
        goal: "R3",
        status: "running",
        steps: [
          { id: "s1", title: "Scan", status: "completed" },
          { id: "s2", title: "Implement", status: "running" },
        ],
      },
    ] as unknown as NonNullable<TuiContext["workflows"]["activeRuns"]>;

    const view = buildWorkflowProgressView(ctx);

    expect(view?.runs[0]?.currentStepId).toBe("s2");
    expect(view?.runs[0]?.steps[1]).toMatchObject({ title: "Implement", active: true });
  });

  it("opens a navigable background overlay and selects the cursor row", () => {
    const ctx = createContext();
    ctx.backgroundOverlayState = { open: true, cursor: 0 };
    ctx.backgroundTasks = [
      {
        id: "bg-1",
        kind: "bash",
        title: "build",
        status: "running",
        currentStep: "pnpm build",
        userVisibleSummary: "running",
      },
      {
        id: "bg-2",
        kind: "job",
        title: "job",
        status: "blocked",
        userVisibleSummary: "blocked",
      },
    ] as unknown as TuiContext["backgroundTasks"];

    updateBackgroundOverlayCursor(ctx, 1);
    const overlay = buildBackgroundTaskOverlayView(ctx, []);

    expect(getBackgroundOverlaySelectedTask(ctx)?.id).toBe("bg-2");
    expect(overlay?.rows).toHaveLength(2);
    expect(overlay?.cursor).toBe(1);
    expect(overlay?.summary).toContain("运行中 1");
  });

  it("agent tree shows running and eviction-phase completed agents, hides blocked/stale", () => {
    const ctx = createContext();
    ctx.agents = [
      {
        id: "agent-1",
        displayName: "Runner",
        status: "running",
        activitySummary: "reading",
        mailbox: [],
        cost: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, estimatedCny: 0 },
      },
      {
        id: "agent-2",
        displayName: "Blocker",
        status: "blocked",
        activitySummary: "stuck",
        mailbox: [],
        cost: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, estimatedCny: 0 },
      },
      {
        id: "agent-3",
        displayName: "Done",
        status: "completed",
        activitySummary: undefined,
        mailbox: [],
        cost: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, estimatedCny: 0 },
      },
    ] as unknown as TuiContext["agents"];

    // Simulate that agent-3 completed 2 seconds ago (within 5s eviction window).
    ctx.agentCompletedAt = { "agent-3": Date.now() - 2_000 };

    const view = buildAgentProgressTreeView(ctx);

    // Runner (running) + Done (recently completed, eviction) = 2 rows.
    expect(view?.rows).toHaveLength(2);
    expect(view?.rows[0]?.name).toBe("Runner");
    expect(view?.rows[1]?.name).toBe("Done");
    expect(view?.rows[1]?.status).toBe("completed");
  });

  it("returns undefined when no agents are running and eviction has expired", () => {
    const ctx = createContext();
    ctx.agents = [
      {
        id: "agent-1",
        displayName: "Done",
        status: "completed",
        mailbox: [],
        cost: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, estimatedCny: 0 },
      },
    ] as unknown as TuiContext["agents"];

    // Eviction expired (completed 10s ago, beyond 5s delay).
    ctx.agentCompletedAt = { "agent-1": Date.now() - 10_000 };

    expect(buildAgentProgressTreeView(ctx)).toBeUndefined();
  });
});
