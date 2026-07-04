import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COMPACT_FRAME_ROWS,
  MIN_TRANSCRIPT_ROWS,
  TINY_TRANSCRIPT_ROWS,
  nativeScrollbackTaskFrameHeight,
  taskBottomPaneBudget,
} from "../native-scrollback-frame.js";
import { allocateBottomPaneBudget } from "./TaskBottomPane.js";

describe("TaskBottomPane budget allocation", () => {
  it("keeps full mode within the frame budget while allowing optional rows", () => {
    const allocation = allocateBottomPaneBudget(16, {
      workingRows: 1,
      agentProgressRows: 2,
      workflowProgressRows: 2,
    });

    expect(allocation.mode).toBe("full");
    expect(allocation.maxRows).toBe(16 - MIN_TRANSCRIPT_ROWS);
    expect(allocation.composerMaxVisibleLines).toBeGreaterThan(1);
    expect(allocation.showAgentProgress || allocation.showWorkflowProgress).toBe(true);
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

  it("does not break the transcript reserve at the compact boundary", () => {
    const allocation = allocateBottomPaneBudget(6, {
      workingRows: 1,
      slashRows: 4,
      agentProgressRows: 2,
    });

    expect(allocation.mode).toBe("compact");
    expect(allocation.maxRows).toBe(6 - MIN_TRANSCRIPT_ROWS);
    expect(allocation.footerRows).toBe(0);
    expect(allocation.workingRows).toBe(1);
    expect(allocation.slashMaxRows + allocation.composerMaxVisibleLines + allocation.footerRows).toBeLessThanOrEqual(
      allocation.maxRows,
    );
  });

  it("keeps compact footer ahead of task list/progress rows while work is active", () => {
    const allocation = allocateBottomPaneBudget(10, {
      workingRows: 1,
      taskListRows: 4,
      agentProgressRows: 2,
      workflowProgressRows: 2,
    });

    expect(allocation.mode).toBe("compact");
    expect(allocation.footerRows).toBe(1);
    expect(allocation.workingRows).toBe(1);
    expect(allocation.showTaskList).toBe(false);
  });

  it("does not show a task list when its real row count would overflow compact budget", () => {
    const allocation = allocateBottomPaneBudget(10, {
      workingRows: 1,
      taskListRows: 8,
    });

    expect(allocation.mode).toBe("compact");
    expect(allocation.footerRows).toBe(1);
    expect(allocation.workingRows).toBe(1);
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
    expect(withBlockedStatus.slashMaxRows).toBe(6);
    expect(withoutBlockedStatus.slashMaxRows).toBe(7);
  });

  it("uses optional rows only after composer, status, footer, and slash budget", () => {
    const allocation = allocateBottomPaneBudget(16, {
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

  it("keeps native slash overlay frame compact instead of double-budgeting full height", () => {
    const height = nativeScrollbackTaskFrameHeight({
      height: 24,
      composerOverlayRows: 8,
      blocks: [],
    } as never);

    expect(height).toBe(COMPACT_FRAME_ROWS + 7);
  });

  it("exports the same budget function used by the pane", () => {
    expect(taskBottomPaneBudget(6)).toBe(6 - MIN_TRANSCRIPT_ROWS);
    expect(taskBottomPaneBudget(10)).toBe(10 - MIN_TRANSCRIPT_ROWS);
    expect(taskBottomPaneBudget(16)).toBe(16 - MIN_TRANSCRIPT_ROWS);
    expect(taskBottomPaneBudget(4)).toBe(4 - TINY_TRANSCRIPT_ROWS);
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

    expect(source).toContain("const bootstrapSlashRows =");
    expect(source).toMatch(/slashMaxRows = slashRows > 0 \? allocation\.slashMaxRows : bootstrapSlashRows/);
    expect(source).toContain("taskListRows: estimateTaskListRows(view.taskListView)");
  });

  it("keeps migrated status/footer theme colors wired in the bottom pane", () => {
    const source = readFileSync(new URL("./TaskBottomPane.tsx", import.meta.url), "utf8");

    expect(source).toContain("action_required: theme.status.blocked");
    expect(source).toContain("theme.toolRunning ?? colorMap[status.kind]");
    expect(source).toContain("color={footer.permissionModeColor || undefined}");
    expect(source).not.toContain("footer.permissionModeColor || theme.permission");
  });

  it("does not render a duplicate working status while permission is active", () => {
    const source = readFileSync(new URL("./TaskBottomPane.tsx", import.meta.url), "utf8");

    expect(source).toContain("const bottomPaneStatus = view.permission");
    expect(source).toContain("? undefined");
    expect(source).toContain("view.bottomPaneStatus ?? legacyStatusFromActivity(view.activity)");
  });
});
