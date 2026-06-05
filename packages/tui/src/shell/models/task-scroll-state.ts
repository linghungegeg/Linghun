import type { TaskScrollView } from "../types.js";
import {
  clampTranscriptScroll as _clamp,
  computeScrollViewportOffset as _compute,
  createInitialTranscriptScroll as _create,
  reduceTranscriptScroll as _reduce,
} from "./transcript-scroll-state.js";

/**
 * D.13Q-UX Task Surface — 任务区滚动状态推进（纯函数）。
 *
 * 本模块是 transcript-scroll-state 的轻量适配。TaskScrollView === TranscriptScrollView，
 * 核心逻辑统一由 transcript-scroll-state 提供，这里保留 task-scroll 特定的 action 子集。
 */

export type TaskScrollAction =
  | { type: "scroll"; delta: number }
  | { type: "end" }
  | { type: "top" };

export function createInitialTaskScroll(): TaskScrollView {
  return _create();
}

export function reduceTaskScroll(
  state: TaskScrollView | undefined,
  action: TaskScrollAction,
): TaskScrollView {
  return _reduce(state, action);
}

export function clampTaskScroll(
  state: TaskScrollView | undefined,
  maxOffset: number,
): TaskScrollView {
  return _clamp(state, maxOffset);
}

export function computeScrollViewportOffset(
  maxOffset: number,
  scroll: TaskScrollView | undefined,
): { topOffset: number; marginTop: number; bottomOffset: number } {
  return _compute(maxOffset, scroll);
}
