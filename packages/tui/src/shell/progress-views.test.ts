import { describe, expect, it } from "vitest";
import type { TuiContext } from "../tui-context-runtime.js";
import {
  buildAgentProgressTreeView,
  buildBackgroundTaskOverlayView,
  buildTaskListView,
  buildWorkflowProgressView,
  getBackgroundOverlaySelectedTask,
  updateBackgroundOverlayCursor,
} from "./progress-views.js";

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
  it("projects agent progress with truthful mailbox and token counts", () => {
    const ctx = createContext();
    ctx.agents = [
      {
        id: "agent-1",
        displayName: "Explore",
        status: "running",
        activitySummary: "reading files",
        startedAt: new Date(Date.now() - 12_000).toISOString(),
        mailbox: [{ id: "m1", status: "pending" }, { id: "m2", status: "consumed" }],
        cost: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, estimatedCny: 0 },
      },
    ] as unknown as TuiContext["agents"];

    const view = buildAgentProgressTreeView(ctx);

    expect(view?.rows[0]).toMatchObject({
      name: "Explore",
      status: "running",
      mailboxMessages: 2,
      mailboxPending: 1,
      tokens: 15,
    });
    expect(view?.rows[0]?.elapsed).toMatch(/\d+s/);
  });

  it("keeps agent internal labels out of the main identity", () => {
    const ctx = createContext();
    ctx.agents = [
      {
        id: "agent-1",
        displayName: "Fork Worker",
        teamName: "review",
        contextMode: "full_fork",
        parentSessionId: "session-parent",
        forkedFrom: "handoff-packet",
        status: "running",
        mailbox: [],
      },
    ] as unknown as TuiContext["agents"];
    ctx.backgroundTasks = [
      {
        id: "agent-1",
        kind: "agent",
        workflowRunId: "wf-1",
      },
    ] as unknown as TuiContext["backgroundTasks"];

    const view = buildAgentProgressTreeView(ctx);

    expect(view?.rows[0]?.name).toBe("Fork Worker");
    expect(view?.rows[0]?.detailLabel).toBe("team:review · 完整上下文");
    expect(view?.rows[0]).toMatchObject({
      workflowRunId: "wf-1",
      parentSessionId: "session-parent",
      forkedFrom: "handoff-packet",
      contextMode: "full_fork",
    });
  });

  it("uses short type labels instead of raw agent ids as the visible identity", () => {
    const ctx = createContext();
    ctx.agents = [
      {
        id: "agent-internal-123456",
        type: "worker",
        status: "running",
        mailbox: [],
      },
      {
        id: "agent-internal-abcdef",
        type: "verifier",
        status: "running",
        mailbox: [],
      },
    ] as unknown as TuiContext["agents"];

    const view = buildAgentProgressTreeView(ctx);

    expect(view?.rows.map((row) => row.name)).toEqual(["Agent", "验证"]);
    expect(view?.rows.map((row) => row.name)).not.toContain("agent-internal-123456");
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

  it("shows only active todos, hides when all are completed, and reports active count", () => {
    const ctx = createContext();
    ctx.tools.todos = [
      { id: "todo-1", content: "调查现状", status: "completed", evidence: "已确认" },
      { id: "todo-2", content: "修复显示", status: "in_progress" },
    ] as unknown as TuiContext["tools"]["todos"];

    const view = buildTaskListView(ctx);

    expect(view?.totalCount).toBe(2);
    expect(view?.currentIndex).toBe(2);
    expect(view?.completedCount).toBe(1);
    expect(view?.rows.map((row) => row.status)).toEqual(["in_progress"]);
    expect(view?.rows[0]).toMatchObject({ subject: "修复显示", status: "in_progress" });

    ctx.tools.todos = [{ id: "todo-2", content: "修复显示", status: "completed" }] as unknown as TuiContext["tools"]["todos"];

    expect(buildTaskListView(ctx)).toBeUndefined();
  });

  it("projects workflow steps and marks the running step active", () => {
    const ctx = createContext();
    ctx.workflows.activeRuns = [
      {
        id: "wf-1",
        goal: "R3",
        status: "running",
        startedAt: new Date(Date.now() - 65_000).toISOString(),
        steps: [
          { id: "s1", title: "Scan", status: "completed" },
          {
            id: "s2",
            title: "Implement",
            status: "running",
            dependsOnSliceIds: ["s1"],
            batchId: "batch-2",
            canRunInParallel: true,
          },
        ],
      },
    ] as unknown as NonNullable<TuiContext["workflows"]["activeRuns"]>;

    const view = buildWorkflowProgressView(ctx);

    expect(view?.runs[0]?.currentStepId).toBe("s2");
    expect(view?.runs[0]?.elapsed).toMatch(/\d+m\d{2}s/);
    expect(view?.runs[0]?.completedSteps).toBe(1);
    expect(view?.runs[0]?.totalSteps).toBe(2);
    expect(view?.runs[0]?.steps[1]).toMatchObject({
      title: "Implement",
      active: true,
      dependsOnSliceIds: ["s1"],
      batchId: "batch-2",
      canRunInParallel: true,
    });
  });

  it("projects multi-agent workflow mode labels", () => {
    const ctx = createContext();
    ctx.workflows.activeRuns = [
      {
        id: "wf-1",
        goal: "multi-agent audit",
        status: "running",
        multiAgent: true,
        steps: [{ id: "s1", title: "Plan", status: "running" }],
      },
    ] as unknown as NonNullable<TuiContext["workflows"]["activeRuns"]>;

    const view = buildWorkflowProgressView(ctx);

    expect(view?.runs[0]?.modeLabel).toBe("multi-agent");
    expect(view?.runs[0]?.completedSteps).toBe(0);
    expect(view?.runs[0]?.totalSteps).toBe(1);
  });

  it("projects one current todo with overall progress and folds the rest", () => {
    const ctx = createContext();
    ctx.tools.todos = Array.from({ length: 5 }, (_, index) => ({
      id: `todo-${index + 1}`,
      content: `任务 ${index + 1}`,
      status: index === 0 ? "completed" : "pending",
    })) as unknown as TuiContext["tools"]["todos"];

    const view = buildTaskListView(ctx);

    expect(view?.totalCount).toBe(5);
    expect(view?.currentIndex).toBe(2);
    expect(view?.completedCount).toBe(1);
    expect(view?.rows).toHaveLength(1);
    expect(view?.hiddenPending).toBe(3);
    expect(view?.rows.map((row) => row.subject)).toEqual(["任务 2"]);
  });

  it("adds a main-chain return row only while viewing an agent transcript", () => {
    const ctx = createContext();
    ctx.agents = [
      {
        id: "agent-1",
        displayName: "Explore",
        status: "running",
        transcriptSessionId: "agent-session-1",
        mailbox: [],
      },
    ] as unknown as TuiContext["agents"];

    expect(buildAgentProgressTreeView(ctx)?.rows.map((row) => row.id)).toEqual(["agent-1"]);

    ctx.agentTranscriptViewState = {
      agentId: "agent-1",
      sessionId: "agent-session-1",
      label: "Explore",
      status: "ready",
    };
    ctx.agentTreeState = { cursor: 0 };

    const view = buildAgentProgressTreeView(ctx);

    expect(view?.rows.map((row) => row.id)).toEqual(["__main__", "agent-1"]);
    expect(view?.rows[0]).toMatchObject({
      name: "主链",
      status: "main",
      activity: "返回主链",
    });
  });

  it("bounds agent and workflow progress rows while keeping active work visible", () => {
    const ctx = createContext();
    ctx.agents = Array.from({ length: 9 }, (_, index) => ({
      id: `agent-${index}`,
      displayName: `Agent ${index}`,
      status: index === 0 ? "running" : "idle",
      lastTerminalStatus: index === 0 ? undefined : "completed",
      activitySummary: index === 0 ? "working" : undefined,
      startedAt: new Date(Date.now() - 5_000).toISOString(),
      mailbox: [],
      cost: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, estimatedCny: 0 },
    })) as unknown as TuiContext["agents"];
    ctx.agentCompletedAt = Object.fromEntries(
      Array.from({ length: 8 }, (_, index) => [`agent-${index + 1}`, Date.now()]),
    );
    ctx.workflows.activeRuns = [
      {
        id: "wf-many",
        goal: "bounded progress",
        status: "running",
        steps: Array.from({ length: 9 }, (_, index) => ({
          id: `s${index}`,
          title: `step ${index}`,
          status: index === 4 ? "running" : "queued",
        })),
      },
    ] as unknown as NonNullable<TuiContext["workflows"]["activeRuns"]>;

    const agents = buildAgentProgressTreeView(ctx);
    const workflow = buildWorkflowProgressView(ctx);

    expect(agents?.rows).toHaveLength(6);
    expect(agents?.hiddenPending).toBe(3);
    expect(agents?.rows.some((row) => row.id === "agent-0")).toBe(true);
    expect(workflow?.runs[0]?.steps).toHaveLength(5);
    expect(workflow?.runs[0]?.hiddenSteps).toBe(4);
    expect(workflow?.runs[0]?.steps.some((step) => step.id === "s4" && step.active)).toBe(true);
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

  it("keeps blocked, failed, and stale agent outcomes visible", () => {
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
        displayName: "Failed",
        status: "failed",
        activitySummary: undefined,
        mailbox: [],
        cost: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, estimatedCny: 0 },
      },
      {
        id: "agent-4",
        displayName: "Stale",
        status: "stale",
        activitySummary: "resume available",
        mailbox: [],
        cost: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, estimatedCny: 0 },
      },
    ] as unknown as TuiContext["agents"];

    const view = buildAgentProgressTreeView(ctx);

    expect(view?.rows.map((row) => row.status)).toEqual([
      "running",
      "blocked",
      "failed",
      "stale",
    ]);
  });

  it("returns undefined when no agents are running (completed agents are evicted immediately)", () => {
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

    // Completed just now, but eviction is immediate (delay = 0).
    ctx.agentCompletedAt = { "agent-1": Date.now() };

    expect(buildAgentProgressTreeView(ctx)).toBeUndefined();
  });
});
