import type { TaskScrollView } from "../types.js";

/**
 * D.13Q-UX Task Surface — 任务区滚动状态推进（纯函数）。
 *
 * scrollOffset 语义：从底部向上偏移的行数。
 *   - 0 = 吸底（最新内容贴近 composer）
 *   - >0 = 用户主动向上滚动了 N 行
 *
 * action 语义：
 *   - { type: "scroll", delta }：scrollOffset += delta；
 *     delta>0 表示**向上滚动**（看更早内容），delta<0 表示**向下滚动**。
 *   - { type: "end" }：scrollOffset 归零，stickToBottom=true。
 *
 * stickToBottom 推导：
 *   - next.scrollOffset === 0 → true（无偏移即视为吸底）。
 *   - next.scrollOffset > 0 → false（detached；新输出不强制跳底）。
 *
 * Clamp：scrollOffset 永远 >= 0，避免负数越界。
 */
export type TaskScrollAction =
  | { type: "scroll"; delta: number }
  | { type: "end" };

export function createInitialTaskScroll(): TaskScrollView {
  return { scrollOffset: 0, stickToBottom: true };
}

export function reduceTaskScroll(
  state: TaskScrollView | undefined,
  action: TaskScrollAction,
): TaskScrollView {
  const current = state ?? createInitialTaskScroll();
  if (action.type === "end") {
    return { scrollOffset: 0, stickToBottom: true };
  }
  const raw = current.scrollOffset + action.delta;
  const next = raw < 0 ? 0 : raw;
  return {
    scrollOffset: next,
    stickToBottom: next === 0,
  };
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
 * - stickToBottom 不变（由 reduceTaskScroll 负责吸底推导），这里只夹 offset 并
 *   回填 hasOverflow，供底部 affordance / footer 决策。
 */
export function clampTaskScroll(
  state: TaskScrollView | undefined,
  maxOffset: number,
): TaskScrollView {
  const current = state ?? createInitialTaskScroll();
  const ceiling = maxOffset > 0 ? Math.floor(maxOffset) : 0;
  const offset = current.scrollOffset;
  const clamped = offset < 0 ? 0 : offset > ceiling ? ceiling : offset;
  return {
    scrollOffset: clamped,
    stickToBottom: current.stickToBottom,
    hasOverflow: ceiling > 0,
  };
}
