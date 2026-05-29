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
