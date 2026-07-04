import { findStableMarkdownLinePrefixLength } from "./markdown-stability.js";

export type AssistantStreamCommitMode = "idle" | "smooth" | "catch_up";

export type AssistantStreamDisplayState = {
  fullText: string;
  committedText: string;
  pendingStableText: string;
  liveTail: string;
  pendingSinceMs?: number;
};

export type AssistantStreamDrainOptions = {
  smoothMaxLines?: number;
  catchUpQueuedLines?: number;
  catchUpOldestMs?: number;
};

const DEFAULT_SMOOTH_MAX_LINES = 4;
const DEFAULT_CATCH_UP_QUEUED_LINES = 8;
const DEFAULT_CATCH_UP_OLDEST_MS = 120;

export function createAssistantStreamDisplayState(): AssistantStreamDisplayState {
  return {
    fullText: "",
    committedText: "",
    pendingStableText: "",
    liveTail: "",
  };
}

export function appendAssistantStreamDelta(
  state: AssistantStreamDisplayState | undefined,
  delta: string,
  nowMs = Date.now(),
): AssistantStreamDisplayState {
  const current = state ?? createAssistantStreamDisplayState();
  if (!delta) return current;
  const fullText = current.fullText + delta;
  const uncommitted = fullText.slice(current.committedText.length);
  const stableLength = findStableMarkdownLinePrefixLength(uncommitted);
  const pendingStableText = stableLength > 0 ? uncommitted.slice(0, stableLength) : "";
  const liveTail = uncommitted.slice(stableLength);
  const pendingSinceMs =
    pendingStableText.length > 0
      ? (current.pendingStableText.length > 0 ? current.pendingSinceMs : nowMs)
      : undefined;

  return {
    fullText,
    committedText: current.committedText,
    pendingStableText,
    liveTail,
    ...(pendingSinceMs === undefined ? {} : { pendingSinceMs }),
  };
}

export function drainAssistantStreamCommits(
  state: AssistantStreamDisplayState,
  nowMs = Date.now(),
  options: AssistantStreamDrainOptions = {},
): {
  state: AssistantStreamDisplayState;
  committedDelta: string;
  mode: AssistantStreamCommitMode;
} {
  if (!state.pendingStableText) {
    return { state, committedDelta: "", mode: "idle" };
  }
  const queuedLines = countQueuedLines(state.pendingStableText);
  const oldestAgeMs =
    state.pendingSinceMs === undefined ? 0 : Math.max(0, nowMs - state.pendingSinceMs);
  const shouldCatchUp =
    queuedLines >= (options.catchUpQueuedLines ?? DEFAULT_CATCH_UP_QUEUED_LINES) ||
    oldestAgeMs >= (options.catchUpOldestMs ?? DEFAULT_CATCH_UP_OLDEST_MS);
  const committedDelta = shouldCatchUp
    ? state.pendingStableText
    : firstQueuedLines(state.pendingStableText, options.smoothMaxLines ?? DEFAULT_SMOOTH_MAX_LINES);
  const pendingStableText = state.pendingStableText.slice(committedDelta.length);

  return {
    state: {
      ...state,
      committedText: state.committedText + committedDelta,
      pendingStableText,
      ...(pendingStableText ? { pendingSinceMs: state.pendingSinceMs ?? nowMs } : { pendingSinceMs: undefined }),
    },
    committedDelta,
    mode: shouldCatchUp ? "catch_up" : "smooth",
  };
}

export function finalizeAssistantStreamDisplayState(
  state: AssistantStreamDisplayState | undefined,
): AssistantStreamDisplayState {
  const current = state ?? createAssistantStreamDisplayState();
  return {
    fullText: current.fullText,
    committedText: current.fullText,
    pendingStableText: "",
    liveTail: "",
  };
}

export function assistantStreamVisibleTail(state: AssistantStreamDisplayState | undefined): string {
  if (!state) return "";
  return state.pendingStableText + state.liveTail;
}

function firstQueuedLines(text: string, maxLines: number): string {
  const lineLimit = Math.max(1, Math.floor(maxLines));
  let cursor = 0;
  for (let line = 0; line < lineLimit; line++) {
    const next = text.indexOf("\n", cursor);
    if (next < 0) return text;
    cursor = next + 1;
  }
  return text.slice(0, cursor);
}

function countQueuedLines(text: string): number {
  if (!text) return 0;
  return Math.max(1, (text.match(/\n/g) ?? []).length);
}
