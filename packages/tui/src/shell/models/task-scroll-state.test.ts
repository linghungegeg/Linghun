import { describe, expect, it } from "vitest";
import { clampTaskScroll, createInitialTaskScroll, reduceTaskScroll } from "./task-scroll-state.js";

describe("D.13Q-UX Task Surface — reduceTaskScroll", () => {
  it("初始状态：scrollOffset=0 / stickToBottom=true", () => {
    const init = createInitialTaskScroll();
    expect(init.scrollOffset).toBe(0);
    expect(init.stickToBottom).toBe(true);
  });

  it("从 offset=0 PgUp（delta=+5）后 offset 增大且 stickToBottom=false", () => {
    const init = createInitialTaskScroll();
    const next = reduceTaskScroll(init, { type: "scroll", delta: 5 });
    expect(next.scrollOffset).toBe(5);
    expect(next.stickToBottom).toBe(false);
  });

  it("空 buffer ↑（delta=+1）也增加 offset", () => {
    const next = reduceTaskScroll(createInitialTaskScroll(), { type: "scroll", delta: 1 });
    expect(next.scrollOffset).toBe(1);
    expect(next.stickToBottom).toBe(false);
  });

  it("PgDn（delta=-5）从 offset=5 减到 0 并恢复 stickToBottom=true", () => {
    const at5 = reduceTaskScroll(createInitialTaskScroll(), { type: "scroll", delta: 5 });
    const back = reduceTaskScroll(at5, { type: "scroll", delta: -5 });
    expect(back.scrollOffset).toBe(0);
    expect(back.stickToBottom).toBe(true);
  });

  it("delta 越界负数被 clamp 到 0", () => {
    const next = reduceTaskScroll(createInitialTaskScroll(), { type: "scroll", delta: -100 });
    expect(next.scrollOffset).toBe(0);
    expect(next.stickToBottom).toBe(true);
  });

  it("End 从任意 offset 归零并 stickToBottom=true", () => {
    const at12 = reduceTaskScroll(createInitialTaskScroll(), { type: "scroll", delta: 12 });
    const ended = reduceTaskScroll(at12, { type: "end" });
    expect(ended.scrollOffset).toBe(0);
    expect(ended.stickToBottom).toBe(true);
  });

  it("undefined state 视为初始状态", () => {
    const next = reduceTaskScroll(undefined, { type: "scroll", delta: 3 });
    expect(next.scrollOffset).toBe(3);
    expect(next.stickToBottom).toBe(false);
  });

  it("连续向上滚动累加 offset", () => {
    let s = createInitialTaskScroll();
    s = reduceTaskScroll(s, { type: "scroll", delta: 5 });
    s = reduceTaskScroll(s, { type: "scroll", delta: 5 });
    s = reduceTaskScroll(s, { type: "scroll", delta: 1 });
    expect(s.scrollOffset).toBe(11);
    expect(s.stickToBottom).toBe(false);
  });
});

describe("D.14D-C2 Task Surface — clampTaskScroll", () => {
  it("offset 不超过 maxOffset（内容溢出时夹到上界）", () => {
    const detached = reduceTaskScroll(createInitialTaskScroll(), { type: "scroll", delta: 50 });
    // 内容比可视区多 10 行 → 最多向上滚 10 行。
    const clamped = clampTaskScroll(detached, 10);
    expect(clamped.scrollOffset).toBe(10);
    expect(clamped.hasOverflow).toBe(true);
    // stickToBottom 由 reducer 决定，clamp 不改它。
    expect(clamped.stickToBottom).toBe(false);
  });

  it("内容未溢出（maxOffset<=0）时强制 offset=0 / hasOverflow=false", () => {
    const detached = reduceTaskScroll(createInitialTaskScroll(), { type: "scroll", delta: 7 });
    const clamped = clampTaskScroll(detached, 0);
    expect(clamped.scrollOffset).toBe(0);
    expect(clamped.hasOverflow).toBe(false);
  });

  it("offset 在 [0, maxOffset] 区间内保持不变", () => {
    const detached = reduceTaskScroll(createInitialTaskScroll(), { type: "scroll", delta: 3 });
    const clamped = clampTaskScroll(detached, 10);
    expect(clamped.scrollOffset).toBe(3);
    expect(clamped.hasOverflow).toBe(true);
  });

  it("负 maxOffset 视为无溢出，offset 归零", () => {
    const detached = reduceTaskScroll(createInitialTaskScroll(), { type: "scroll", delta: 4 });
    const clamped = clampTaskScroll(detached, -5);
    expect(clamped.scrollOffset).toBe(0);
    expect(clamped.hasOverflow).toBe(false);
  });

  it("undefined state 视为初始（吸底）状态", () => {
    const clamped = clampTaskScroll(undefined, 10);
    expect(clamped.scrollOffset).toBe(0);
    expect(clamped.stickToBottom).toBe(true);
    expect(clamped.hasOverflow).toBe(true);
  });

  it("小数 maxOffset 向下取整作为上界", () => {
    const detached = reduceTaskScroll(createInitialTaskScroll(), { type: "scroll", delta: 50 });
    const clamped = clampTaskScroll(detached, 5.9);
    expect(clamped.scrollOffset).toBe(5);
    expect(clamped.hasOverflow).toBe(true);
  });
});
