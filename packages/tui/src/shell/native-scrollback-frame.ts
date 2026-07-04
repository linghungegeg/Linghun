import type { ShellViewModel, TranscriptViewportGeometryView } from "./types.js";

export const MIN_TRANSCRIPT_ROWS = 2;
export const TINY_TRANSCRIPT_ROWS = 1;
export const COMPACT_FRAME_ROWS = 6;
export const FULL_FRAME_ROWS = 15;

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
      view.taskListView ||
      view.agentProgressTree ||
      view.workflowProgressView ||
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
    const cappedOverlayRows = Math.min(7, Math.max(1, Math.floor(view.composerOverlayRows ?? 0)));
    const requiredRows = compactComposerAndFooterRows + cappedOverlayRows;
    return Math.max(1, Math.min(maxNonFullscreenHeight, requiredRows));
  }

  if (view.permission || view.backgroundTaskOverlay) {
    return Math.max(1, Math.min(maxNonFullscreenHeight, overlayFrameRows));
  }

  if (!nativeScrollbackTaskFrameHasContent(view)) {
    return Math.max(1, Math.min(maxNonFullscreenHeight, idleFrameRows));
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
  const transcriptReserve =
    normalizedFrameHeight >= COMPACT_FRAME_ROWS ? MIN_TRANSCRIPT_ROWS : TINY_TRANSCRIPT_ROWS;
  return Math.max(1, normalizedFrameHeight - transcriptReserve);
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
