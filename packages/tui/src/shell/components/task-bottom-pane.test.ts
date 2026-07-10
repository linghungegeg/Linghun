import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COMPACT_TRANSCRIPT_ROWS,
  COMPACT_FRAME_ROWS,
  MIN_TRANSCRIPT_ROWS,
  TINY_TRANSCRIPT_ROWS,
  estimateAgentProgressRows,
  estimateWorkflowProgressRows,
  nativeScrollbackTaskFrameHeight,
  taskBottomPaneBudget,
  taskTranscriptReserve,
} from "../native-scrollback-frame.js";
import {
  allocateBottomPaneBudget,
  isAgentProgressPaneActive,
  isTaskListPaneActive,
  isWorkflowProgressPaneActive,
} from "./TaskBottomPane.js";

describe("TaskBottomPane budget allocation", () => {
  it("keeps full mode within the frame budget while allowing optional rows", () => {
    const allocation = allocateBottomPaneBudget(20, {
      workingRows: 1,
      agentProgressRows: 2,
      workflowProgressRows: 2,
    });

    expect(allocation.mode).toBe("full");
    expect(allocation.maxRows).toBe(20 - taskTranscriptReserve(20));
    expect(allocation.composerMaxVisibleLines).toBeGreaterThan(1);
    expect(allocation.showAgentProgress || allocation.showWorkflowProgress).toBe(true);
  });

  it("evicts completed agent and workflow progress from the bottom pane budget", () => {
    expect(
      isAgentProgressPaneActive({
        rows: [
          {
            id: "agent-1",
            branch: "last",
            name: "agent 1",
            status: "completed",
            mailboxMessages: 1,
            tokens: 10,
          },
        ],
        hiddenPending: 0,
        cursor: -1,
      }),
    ).toBe(false);
    expect(
      isAgentProgressPaneActive({
        rows: [
          {
            id: "agent-running",
            branch: "last",
            name: "agent running",
            status: "running",
            mailboxMessages: 0,
            tokens: 0,
          },
        ],
        hiddenPending: 0,
        cursor: -1,
      }),
    ).toBe(true);
    expect(
      isAgentProgressPaneActive({
        rows: [
          {
            id: "agent-failed",
            branch: "last",
            name: "agent failed",
            status: "failed",
            mailboxMessages: 1,
            tokens: 10,
          },
        ],
        hiddenPending: 0,
        cursor: -1,
      }),
    ).toBe(true);
    expect(
      isWorkflowProgressPaneActive({
        runs: [
          {
            id: "workflow-1",
            goal: "done",
            status: "completed",
            completedSteps: 2,
            totalSteps: 2,
            steps: [],
          },
          {
            id: "workflow-2",
            goal: "cancelled",
            status: "cancelled",
            completedSteps: 1,
            totalSteps: 2,
            steps: [],
          },
        ],
        hiddenPending: 0,
      }),
    ).toBe(false);
    expect(
      isWorkflowProgressPaneActive({
        runs: [
          {
            id: "workflow-running",
            goal: "run",
            status: "running",
            completedSteps: 1,
            totalSteps: 2,
            steps: [],
          },
        ],
        hiddenPending: 0,
      }),
    ).toBe(true);
    expect(
      isWorkflowProgressPaneActive({
        runs: [
          {
            id: "workflow-failed",
            goal: "failed",
            status: "failed",
            completedSteps: 1,
            totalSteps: 2,
            steps: [],
          },
        ],
        hiddenPending: 0,
      }),
    ).toBe(true);
  });

  it("evicts stale completed task-list views from the bottom pane budget", () => {
    expect(
      isTaskListPaneActive({
        rows: [
          {
            id: "todo-done",
            subject: "done",
            status: "completed",
          },
        ],
        hiddenPending: 0,
        totalCount: 1,
        currentIndex: 1,
        completedCount: 1,
      }),
    ).toBe(false);
    expect(
      isTaskListPaneActive({
        rows: [
          {
            id: "todo-active",
            subject: "active",
            status: "in_progress",
          },
        ],
        hiddenPending: 0,
        totalCount: 1,
        currentIndex: 1,
        completedCount: 0,
      }),
    ).toBe(true);
  });

  it("does not allocate task-list rows for stale completed task-list views", () => {
    const source = readFileSync(new URL("./TaskBottomPane.tsx", import.meta.url), "utf8");

    expect(source).toContain("taskListRows: estimateTaskListRows(view.taskListView, statusActive)");
    expect(source).toContain("if (!isTaskListPaneActive(taskListView)) return 0;");
    expect(source).toContain("allocation.showTaskList && isTaskListPaneActive(view.taskListView)");
  });

  it("uses compact mode at 10 rows and keeps composer/status ahead of optional rows", () => {
    const allocation = allocateBottomPaneBudget(10, {
      workingRows: 1,
      runtimeSummaryRows: 2,
      taskListRows: 2,
      agentProgressRows: 2,
    });

    expect(allocation.mode).toBe("compact");
    expect(allocation.composerMaxVisibleLines).toBe(1);
    expect(allocation.footerRows).toBe(1);
    expect(allocation.workingRows).toBe(1);
    expect(allocation.maxRows).toBeLessThanOrEqual(10 - MIN_TRANSCRIPT_ROWS);
  });

  it("keeps workflow as the orchestration axis when only one progress surface fits", () => {
    const allocation = allocateBottomPaneBudget(14, {
      workflowProgressRows: 4,
      agentProgressRows: 3,
    });

    expect(allocation.showWorkflowProgress).toBe(true);
    expect(allocation.showAgentProgress).toBe(false);
  });

  it("keeps queued follow-ups ahead of optional progress rows", () => {
    const allocation = allocateBottomPaneBudget(14, {
      queuedInputRows: 3,
      workflowProgressRows: 4,
      agentProgressRows: 3,
      sessionForkRows: 1,
    });

    expect(allocation.queuedInputRows).toBeGreaterThan(0);
    expect(allocation.showWorkflowProgress).toBe(false);
    expect(allocation.showAgentProgress).toBe(false);
  });

  it("does not break the transcript reserve at the compact boundary", () => {
    const allocation = allocateBottomPaneBudget(6, {
      workingRows: 1,
      slashRows: 4,
      agentProgressRows: 2,
    });

    expect(allocation.mode).toBe("compact");
    expect(allocation.maxRows).toBe(6 - COMPACT_TRANSCRIPT_ROWS);
    expect(allocation.footerRows).toBe(0);
    expect(allocation.workingRows).toBe(1);
    expect(allocation.slashMaxRows + allocation.composerMaxVisibleLines + allocation.footerRows).toBeLessThanOrEqual(
      allocation.maxRows,
    );
  });

  it("shows the one-line task summary only when its real spacing fits after preview", () => {
    const allocation = allocateBottomPaneBudget(14, {
      workingRows: 1,
      taskListRows: 2,
      agentProgressRows: 2,
    });

    expect(allocation.mode).toBe("compact");
    expect(allocation.footerRows).toBe(1);
    expect(allocation.workingRows).toBe(1);
    expect(allocation.showAgentProgress).toBe(true);
    expect(allocation.showTaskList).toBe(true);
  });

  it("does not show the task summary when higher-priority rows use the post-preview budget", () => {
    const allocation = allocateBottomPaneBudget(14, {
      workingRows: 1,
      taskListRows: 3,
      agentProgressRows: 2,
      backgroundOverlayRows: 2,
    });

    expect(allocation.mode).toBe("compact");
    expect(allocation.footerRows).toBe(1);
    expect(allocation.workingRows).toBe(1);
    expect(allocation.showAgentProgress).toBe(true);
    expect(allocation.showBackgroundOverlay).toBe(true);
    expect(allocation.showTaskList).toBe(false);
  });

  it("caps slash popup before it can hide the compact footer", () => {
    const allocation = allocateBottomPaneBudget(10, {
      workingRows: 1,
      slashRows: 9,
      taskListRows: 3,
      agentProgressRows: 2,
      workflowProgressRows: 2,
    });

    expect(allocation.mode).toBe("compact");
    expect(allocation.composerMaxVisibleLines).toBe(1);
    expect(allocation.footerRows).toBe(1);
    expect(allocation.slashMaxRows).toBeLessThanOrEqual(7);
    expect(allocation.showTaskList).toBe(false);
  });

  it("allows a taller compact slash popup when the frame has room", () => {
    const withBlockedStatus = allocateBottomPaneBudget(13, {
      workingRows: 1,
      slashRows: 9,
    });
    const withoutBlockedStatus = allocateBottomPaneBudget(13, {
      slashRows: 9,
    });

    expect(withBlockedStatus.mode).toBe("compact");
    expect(withBlockedStatus.slashMaxRows).toBe(3);
    expect(withoutBlockedStatus.slashMaxRows).toBe(4);
  });

  it("uses optional rows only after composer, status, footer, and slash budget", () => {
    const allocation = allocateBottomPaneBudget(22, {
      workingRows: 1,
      slashRows: 5,
      taskListRows: 1,
      runtimeSummaryRows: 2,
      notificationRows: 2,
    });

    expect(allocation.mode).toBe("full");
    expect(allocation.composerMaxVisibleLines).toBeLessThanOrEqual(5);
    expect(allocation.workingRows).toBe(1);
    expect(allocation.footerRows).toBeGreaterThan(0);
    expect(allocation.showTaskList).toBe(true);
    expect(allocation.showRuntimeSummary).toBe(false);
    expect(allocation.showNotifications).toBe(false);
  });

  it("uses minimal mode for tiny frames and preserves at least the composer budget", () => {
    const allocation = allocateBottomPaneBudget(4, {
      workingRows: 1,
      slashRows: 4,
    });

    expect(allocation.mode).toBe("minimal");
    expect(allocation.maxRows).toBe(4 - TINY_TRANSCRIPT_ROWS);
    expect(allocation.composerMaxVisibleLines).toBe(1);
    expect(allocation.slashMaxRows).toBe(0);
  });

  it("keeps the running work status visible in minimal mode when one row fits", () => {
    const allocation = allocateBottomPaneBudget(5, {
      workingRows: 1,
      slashRows: 4,
    });

    expect(allocation.mode).toBe("minimal");
    expect(allocation.footerRows).toBe(0);
    expect(allocation.workingRows).toBe(1);
    expect(
      allocation.composerMaxVisibleLines + allocation.footerRows + allocation.workingRows,
    ).toBeLessThanOrEqual(allocation.maxRows);
  });

  it("keeps native slash overlay frame compact instead of double-budgeting full height", () => {
    const height = nativeScrollbackTaskFrameHeight({
      height: 24,
      composerOverlayRows: 8,
      blocks: [],
    } as never);

    expect(height).toBe(COMPACT_FRAME_ROWS + 7);
  });

  it("reserves bottom status room while slash overlay rows are measured", () => {
    const height = nativeScrollbackTaskFrameHeight({
      height: 24,
      composerOverlayRows: 1,
      bottomPaneStatus: {
        kind: "blocked",
        source: "resource",
        text: "上下文预算受限",
      },
      blocks: [],
    } as never);

    expect(height).toBe(COMPACT_FRAME_ROWS + 7 + 1);
  });

  it("exports the same budget function used by the pane", () => {
    expect(taskBottomPaneBudget(6)).toBe(6 - COMPACT_TRANSCRIPT_ROWS);
    expect(taskBottomPaneBudget(10)).toBe(10 - MIN_TRANSCRIPT_ROWS);
    expect(taskBottomPaneBudget(16)).toBe(16 - taskTranscriptReserve(16));
    expect(taskBottomPaneBudget(4)).toBe(4 - TINY_TRANSCRIPT_ROWS);
  });

  it("reserves more live preview rows as the frame grows", () => {
    expect(taskTranscriptReserve(4)).toBe(TINY_TRANSCRIPT_ROWS);
    expect(taskTranscriptReserve(6)).toBe(COMPACT_TRANSCRIPT_ROWS);
    expect(taskTranscriptReserve(10)).toBe(MIN_TRANSCRIPT_ROWS);
    expect(taskTranscriptReserve(14)).toBe(5);
    expect(taskTranscriptReserve(40)).toBe(5);
  });

  it("uses the rendered agent and workflow row counts instead of fixed estimates", () => {
    const agentRows = estimateAgentProgressRows({
      rows: [
        { id: "agent-1", branch: "middle", name: "one", status: "running", mailboxMessages: 0, tokens: 0 },
        { id: "agent-2", branch: "last", name: "two", status: "completed", mailboxMessages: 1, tokens: 2 },
      ],
      hiddenPending: 3,
      cursor: 0,
      expandedId: "agent-1",
    });
    const workflowRows = estimateWorkflowProgressRows({
      runs: [
        {
          id: "workflow-1",
          goal: "ship",
          status: "running",
          completedSteps: 1,
          totalSteps: 3,
          steps: [
            { id: "step-1", title: "one", status: "completed", active: false },
            { id: "step-2", title: "two", status: "running", active: true },
            { id: "step-3", title: "three", status: "pending", active: false },
          ],
          hiddenSteps: 2,
        },
      ],
      hiddenPending: 1,
    });

    expect(agentRows).toBe(6);
    expect(workflowRows).toBe(8);
    const allocation = allocateBottomPaneBudget(14, {
      workingRows: 1,
      agentProgressRows: agentRows,
      workflowProgressRows: workflowRows,
    });
    expect(allocation.showAgentProgress).toBe(false);
    expect(allocation.showWorkflowProgress).toBe(false);
    expect(allocation.maxRows).toBe(9);
  });

  it("expands live preview frames consistently across terminal height tiers", () => {
    for (const height of [16, 24, 28, 40]) {
      const idleHeight = nativeScrollbackTaskFrameHeight({
        height,
        blocks: [],
      } as never);
      const streamingHeight = nativeScrollbackTaskFrameHeight({
        height,
        blocks: [],
        streamingAssistantText: "live",
      } as never);
      const agentHeight = nativeScrollbackTaskFrameHeight({
        height,
        blocks: [],
        agentProgressTree: {
          rows: [
            { id: "agent", branch: "last", name: "agent", status: "running", mailboxMessages: 0, tokens: 0 },
          ],
          hiddenPending: 0,
          cursor: -1,
        },
      } as never);

      expect(idleHeight).toBe(COMPACT_FRAME_ROWS);
      expect(streamingHeight).toBe(14);
      expect(agentHeight).toBe(14);
      expect(taskTranscriptReserve(streamingHeight)).toBe(5);
    }
  });

  it("accounts for blocked status rows when bootstrapping slash suggestions", () => {
    const withBlockedStatus = allocateBottomPaneBudget(9, {
      workingRows: 1,
      slashRows: 9,
    });
    const withoutBlockedStatus = allocateBottomPaneBudget(9, {
      slashRows: 9,
    });

    expect(withBlockedStatus.workingRows).toBe(1);
    expect(withBlockedStatus.slashMaxRows).toBe(2);
    expect(withoutBlockedStatus.slashMaxRows).toBe(3);
    expect(withBlockedStatus.slashMaxRows).toBeLessThan(withoutBlockedStatus.slashMaxRows);
    expect(
      withBlockedStatus.slashMaxRows +
        withBlockedStatus.composerMaxVisibleLines +
        withBlockedStatus.footerRows +
        withBlockedStatus.workingRows,
    ).toBeLessThanOrEqual(withBlockedStatus.maxRows);
  });

  it("keeps slash bootstrap rows available before the overlay reports measured rows", () => {
    const source = readFileSync(new URL("./TaskBottomPane.tsx", import.meta.url), "utf8");

    expect(source).toContain("const slashAllocation = slashRows > 0");
    expect(source).toContain("frameHeight < view.height");
    expect(source).toContain("nativeScrollbackTaskFrameHeight({ ...view, composerOverlayRows: 1 })");
    expect(source).toContain("const slashMaxRows = slashAllocation.slashMaxRows;");
    expect(source).toContain("const TASK_LIST_TOP_GAP_ROWS = 1;");
    expect(source).toContain("const TASK_STATUS_GAP_ROWS = 1;");
    expect(source).toContain(
      "return 1 + TASK_LIST_TOP_GAP_ROWS + (hasFollowingStatus ? TASK_STATUS_GAP_ROWS : 0);",
    );
  });

  it("keeps task progress visually distinct from running work status", () => {
    const taskListSource = readFileSync(new URL("./TaskListView.tsx", import.meta.url), "utf8");
    const paneSource = readFileSync(new URL("./TaskBottomPane.tsx", import.meta.url), "utf8");

    expect(taskListSource).toContain("inProgress ? theme.accent : theme.muted");
    expect(taskListSource).not.toContain("inProgress ? theme.brand : theme.muted");
    expect(paneSource).toContain("running: theme.status.running");
  });

  it("keeps migrated status/footer theme colors wired in the bottom pane", () => {
    const source = readFileSync(new URL("./TaskBottomPane.tsx", import.meta.url), "utf8");

    expect(source).toContain("action_required: theme.status.blocked");
    expect(source).toContain("theme.toolRunning ?? colorMap[status.kind]");
    expect(source).toContain("color={footer.permissionModeColor || undefined}");
    expect(source).not.toContain("footer.permissionModeColor || theme.permission");
  });

  it("keeps a low-noise working status while permission is active", () => {
    const source = readFileSync(new URL("./TaskBottomPane.tsx", import.meta.url), "utf8");

    expect(source).toContain("const bottomPaneStatus = view.bottomPaneStatus ?? legacyStatusFromActivity(view.activity)");
    expect(source).not.toContain("const bottomPaneStatus = view.permission");
    expect(source).not.toContain("? undefined");
  });

  it("keeps ScrollViewport resilient after fullscreen panel teardown and scroll-only updates", () => {
    const source = readFileSync(new URL("./ScrollViewport.tsx", import.meta.url), "utf8");

    expect(source).toContain("scheduleLayoutRecovery(`zero:");
    expect(source).toContain("scheduleLayoutRecovery(`settle:");
    expect(source).toContain("const dimensionsChanged = dimKey !== lastDimKey.current;");
    expect(source).toContain("const geometryKey =");
    expect(source).not.toContain("if (dimKey === lastDimKey.current) return;");
  });
});
