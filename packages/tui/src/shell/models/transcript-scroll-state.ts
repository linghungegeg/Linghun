import type { TranscriptScrollActionName, TranscriptScrollView } from "../types.js";

/**
 * D.13Q-UX Task Surface — 主 transcript 滚动状态推进（纯函数）。
 *
 * scrollOffset 语义：从底部向上偏移的行数。
 *   - 0 = 吸底（最新内容贴近 composer）
 *   - >0 = 用户主动向上滚动了 N 行
 *
 * action 语义：
 *   - { type: "scroll", action }：CCB-like semantic pager action；
 *     PgUp/PgDn 按测量视口滚半页，wheel/arrow 滚一行。
 *   - { type: "scroll", delta }：兼容旧测试/调用，delta>0 向上看更早内容。
 *   - { type: "end" } / { type: "scroll", action: "bottom" }：归零吸底。
 *
 * stickToBottom 推导：
 *   - next.scrollOffset === 0 → true（无偏移即视为吸底）。
 *   - next.scrollOffset > 0 → false（detached；新输出不强制跳底）。
 *
 * Clamp：scrollOffset 永远 >= 0，避免负数越界。
 */
export type TranscriptScrollAction =
  | { type: "scroll"; delta: number }
  | { type: "scroll"; action: TranscriptScrollActionName }
  | { type: "end" }
  | { type: "top" }
  | { type: "measure"; viewportHeight: number; contentHeight: number };

export function createInitialTranscriptScroll(): TranscriptScrollView {
  return { scrollOffset: 0, stickToBottom: true };
}

export function reduceTranscriptScroll(
  state: TranscriptScrollView | undefined,
  action: TranscriptScrollAction,
): TranscriptScrollView {
  const current = state ?? createInitialTranscriptScroll();
  if (action.type === "measure") {
    return clampTranscriptScroll(
      {
        ...current,
        viewportHeight: action.viewportHeight,
        contentHeight: action.contentHeight,
      },
      action.contentHeight - action.viewportHeight,
    );
  }
  if (action.type === "end") {
    return { ...current, scrollOffset: 0, stickToBottom: true };
  }
  if (action.type === "top") {
    return {
      ...current,
      scrollOffset: maxScrollOffset(current) ?? Number.MAX_SAFE_INTEGER,
      stickToBottom: false,
    };
  }
  const delta = "delta" in action ? action.delta : deltaForScrollAction(current, action.action);
  const raw = current.scrollOffset + delta;
  const next = raw < 0 ? 0 : raw;
  const maxOffset = maxScrollOffset(current);
  const clamped = maxOffset === undefined ? next : Math.min(next, maxOffset);
  return {
    ...current,
    scrollOffset: clamped,
    stickToBottom: clamped === 0,
  };
}

function maxScrollOffset(state: TranscriptScrollView): number | undefined {
  if (state.viewportHeight === undefined || state.contentHeight === undefined) return undefined;
  return Math.max(0, Math.floor(state.contentHeight - state.viewportHeight));
}

function pageSize(state: TranscriptScrollView, factor: number): number {
  const fallback = factor >= 1 ? 10 : 5;
  const viewport = state.viewportHeight && state.viewportHeight > 0 ? state.viewportHeight : fallback;
  return Math.max(1, Math.floor(viewport * factor));
}

function deltaForScrollAction(
  state: TranscriptScrollView,
  action: TranscriptScrollActionName,
): number {
  switch (action) {
    case "lineUp":
    case "wheelUp":
      return state.wheelStep ?? 1;
    case "lineDown":
    case "wheelDown":
      return -(state.wheelStep ?? 1);
    case "halfPageUp":
      return pageSize(state, 0.5);
    case "halfPageDown":
      return -pageSize(state, 0.5);
    case "fullPageUp":
      return pageSize(state, 1);
    case "fullPageDown":
      return -pageSize(state, 1);
    case "top": {
      const maxOffset = maxScrollOffset(state);
      return maxOffset === undefined ? Number.MAX_SAFE_INTEGER : maxOffset - state.scrollOffset;
    }
    case "bottom":
      return -state.scrollOffset;
  }
}

/**
 * D.14D-C2 — 测量后夹紧（pure，供 ScrollViewport 在量出高度后调用）。
 *
 * 视口测量出内容高度与可视高度后得到 maxOffset = max(0, contentH - viewH)，
 * 即"最多还能向上滚动的行数"。本函数把 state.scrollOffset 夹到 [0, maxOffset]，
 * 修掉旧的无界 `marginTop={-scrollOffset}` 缺陷（offset 没有上界，用户可以一直
 * 向上滚动把内容整体推出可视区进入空白）。
 *
 * 语义保持：scrollOffset 仍是"从底部向上偏移的行数"（0=吸底，maxOffset=顶部）。
 * - maxOffset<=0（内容未溢出或尚未测量到溢出）→ 强制 offset=0、hasOverflow=false。
 * - stickToBottom 不变（由 reduceTranscriptScroll 负责吸底推导），这里只夹 offset 并
 *   回填 hasOverflow，供底部 affordance / footer 决策。
 */
export function clampTranscriptScroll(
  state: TranscriptScrollView | undefined,
  maxOffset: number,
): TranscriptScrollView {
  const current = state ?? createInitialTranscriptScroll();
  const ceiling = maxOffset > 0 ? Math.floor(maxOffset) : 0;
  const offset = current.scrollOffset;
  const clamped = offset < 0 ? 0 : offset > ceiling ? ceiling : offset;
  return {
    ...current,
    scrollOffset: clamped,
    stickToBottom: current.stickToBottom,
    hasOverflow: ceiling > 0,
  };
}

export function computeScrollViewportOffset(
  maxOffset: number,
  scroll: TranscriptScrollView | undefined,
): { topOffset: number; marginTop: number; bottomOffset: number } {
  const clamped = clampTranscriptScroll(scroll, maxOffset);
  const bottomOffset = (scroll?.stickToBottom ?? true) ? 0 : clamped.scrollOffset;
  const topOffset = Math.max(0, Math.floor(maxOffset > 0 ? maxOffset : 0) - bottomOffset);
  return {
    topOffset,
    marginTop: topOffset > 0 ? -topOffset : 0,
    bottomOffset,
  };
}
