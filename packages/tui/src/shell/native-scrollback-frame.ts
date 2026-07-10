import type {
  AgentProgressTreeView,
  ShellViewModel,
  TranscriptViewportGeometryView,
  WorkflowProgressView,
} from "./types.js";

export const MIN_TRANSCRIPT_ROWS = 4;
export const COMPACT_TRANSCRIPT_ROWS = 2;
export const TINY_TRANSCRIPT_ROWS = 1;
export const COMPACT_FRAME_ROWS = 6;
export const FULL_FRAME_ROWS = 15;
const LIVE_PREVIEW_FRAME_ROWS = FULL_FRAME_ROWS - 1;

export type TaskBottomPaneMode = "full" | "compact" | "minimal";

export function shouldUseNativeScrollbackTaskFrame(): boolean {
  if (process.env.LINGHUN_TUI_TERMINAL_FIRST_TRANSCRIPT === "0") return false;
  return process.env.LINGHUN_TUI_NATIVE_SCROLLBACK !== "0";
}

export function nativeScrollbackTaskFrameHasContent(view: ShellViewModel): boolean {
  return Boolean(
    view.permission ||
      nativeScrollbackTaskHasFullscreenPanel(view) ||
      (view.composerOverlayRows ?? 0) > 0 ||
      view.backgroundTaskOverlay ||
      view.bottomPaneStatus ||
      (view.activity && view.activity.phase !== "completed") ||
      view.streamingAssistantText ||
      view.taskRuntimeSummary ||
      hasActiveTaskList(view) ||
      estimateAgentProgressRows(view.agentProgressTree) > 0 ||
      estimateWorkflowProgressRows(view.workflowProgressView) > 0 ||
      (view.taskSuggestions?.length ?? 0) > 0 ||
      view.blocks.length > 0,
  );
}

export function nativeScrollbackTaskHasFullscreenPanel(view: ShellViewModel): boolean {
  return Boolean(
    view.configPanel ||
      view.commandPanel ||
      view.helpPanel ||
      view.btwPanel ||
      view.sessionsPanel,
  );
}

export function nativeScrollbackTaskFrameHeight(view: ShellViewModel): number {
  const overlayFrameRows = FULL_FRAME_ROWS + 1;
  const maxFrameRows = 10;
  const idleFrameRows = COMPACT_FRAME_ROWS;

  const maxNonFullscreenHeight = Math.max(1, view.height - 2);
  if ((view.composerOverlayRows ?? 0) > 0) {
    const compactComposerAndFooterRows = COMPACT_FRAME_ROWS;
    const stableOverlayRows = 7;
    const statusRows = view.bottomPaneStatus || view.activity ? 1 : 0;
    const requiredRows = compactComposerAndFooterRows + stableOverlayRows + statusRows;
    return Math.max(1, Math.min(maxNonFullscreenHeight, requiredRows));
  }

  if (view.permission || view.backgroundTaskOverlay) {
    return Math.max(1, Math.min(maxNonFullscreenHeight, overlayFrameRows));
  }

  if (!nativeScrollbackTaskFrameHasContent(view)) {
    return Math.max(1, Math.min(maxNonFullscreenHeight, idleFrameRows));
  }
  if (
    view.streamingAssistantText ||
    estimateAgentProgressRows(view.agentProgressTree) > 0 ||
    estimateWorkflowProgressRows(view.workflowProgressView) > 0
  ) {
    return Math.max(1, Math.min(maxNonFullscreenHeight, LIVE_PREVIEW_FRAME_ROWS));
  }
  return Math.max(1, Math.min(maxNonFullscreenHeight, maxFrameRows));
}

export function taskBottomPaneMode(frameHeight: number): TaskBottomPaneMode {
  if (frameHeight >= FULL_FRAME_ROWS) return "full";
  if (frameHeight >= COMPACT_FRAME_ROWS) return "compact";
  return "minimal";
}

export function taskBottomPaneBudget(frameHeight: number): number {
  const normalizedFrameHeight = Math.max(1, Math.floor(frameHeight));
  const transcriptReserve = taskTranscriptReserve(normalizedFrameHeight);
  return Math.max(1, normalizedFrameHeight - transcriptReserve);
}

export function taskTranscriptReserve(frameHeight: number): number {
  const normalizedFrameHeight = Math.max(1, Math.floor(frameHeight));
  if (normalizedFrameHeight < COMPACT_FRAME_ROWS) return TINY_TRANSCRIPT_ROWS;
  if (normalizedFrameHeight < 10) return COMPACT_TRANSCRIPT_ROWS;
  return Math.min(5, Math.max(MIN_TRANSCRIPT_ROWS, Math.ceil(normalizedFrameHeight / 3)));
}

export function estimateAgentProgressRows(tree: AgentProgressTreeView | undefined): number {
  if (!tree || !tree.rows.some((row) => !isTerminalProgressStatus(row.status))) return 0;
  const expandedRows = tree.expandedId && tree.rows.some((row) => row.id === tree.expandedId) ? 1 : 0;
  const overflowRows = tree.hiddenPending > 0 ? 1 : 0;
  const hintRows = tree.cursor >= 0 || tree.rows.some((row) => row.status === "running") ? 1 : 0;
  return 1 + tree.rows.length + expandedRows + overflowRows + hintRows;
}

export function estimateWorkflowProgressRows(
  workflow: WorkflowProgressView | undefined,
): number {
  if (!workflow || !workflow.runs.some((run) => !isTerminalProgressStatus(run.status))) return 0;
  const runRows = workflow.runs.reduce(
    (rows, run) =>
      rows +
      1 +
      (isTerminalProgressStatus(run.status) ? 0 : run.steps.length) +
      ((run.hiddenSteps ?? 0) > 0 ? 1 : 0),
    0,
  );
  return 2 + runRows + (workflow.hiddenPending > 0 ? 1 : 0);
}

export function nativeScrollbackTaskFrameTop(view: ShellViewModel): number {
  return Math.max(0, view.height - nativeScrollbackTaskFrameHeight(view));
}

export function nativeScrollbackTaskHistoryGeometry(
  view: ShellViewModel,
): TranscriptViewportGeometryView {
  const frameTop = nativeScrollbackTaskFrameTop(view);
  return {
    x: 0,
    y: frameTop,
    width: view.width,
    height: frameTop,
    contentHeight: 0,
    topOffset: 0,
  };
}

function hasActiveTaskList(view: ShellViewModel): boolean {
  return Boolean(
    view.taskListView?.rows.some((row) => !isTerminalProgressStatus(row.status)),
  );
}

function isTerminalProgressStatus(status: string): boolean {
  return status === "completed" || status === "cancelled";
}
