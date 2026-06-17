import { describe, expect, it } from "vitest";
import { computeWrappedInputState } from "./text-utils.js";

describe("computeWrappedInputState", () => {
  it("wraps a single English line predictably at different widths", () => {
    const wide = computeWrappedInputState({
      text: "abcdefghij",
      cursorOffset: 10,
      width: 10,
      paddingLeft: 0,
      paddingRight: 0,
    });
    const narrow = computeWrappedInputState({
      text: "abcdefghij",
      cursorOffset: 10,
      width: 6,
      paddingLeft: 0,
      paddingRight: 0,
    });

    expect(wide.lines).toEqual(["abcdefghij"]);
    expect(narrow.lines).toEqual(["abcdef", "ghij"]);
    expect(wide.cursorRow).toBe(0);
    expect(narrow.cursorRow).toBe(1);
    expect(wide.cursorCol).toBe(10);
    expect(narrow.cursorCol).toBe(4);
  });

  it("keeps cursorCol aligned for wide CJK characters", () => {
    const state = computeWrappedInputState({
      text: "你好世界",
      cursorOffset: 2,
      width: 14,
      prefixWidth: 2,
      paddingLeft: 2,
      paddingRight: 2,
      minContentWidth: 4,
    });

    expect(state.lines).toEqual(["你好世界"]);
    expect(state.cursorRow).toBe(0);
    expect(state.cursorCol).toBe(4);
    expect(state.contentWidth).toBe(10);
  });

  it("preserves pasted line structure", () => {
    const state = computeWrappedInputState({
      text: "line1\nline2\nline3",
      cursorOffset: 17,
      width: 30,
      paddingLeft: 0,
      paddingRight: 0,
    });

    expect(state.lines).toEqual(["line1", "line2", "line3"]);
    expect(state.cursorRow).toBe(2);
    expect(state.cursorCol).toBe(5);
  });

  it("tracks cursor position inside wrapped middle rows", () => {
    const state = computeWrappedInputState({
      text: "abcdefghij",
      cursorOffset: 6,
      width: 4,
      paddingLeft: 0,
      paddingRight: 0,
    });

    expect(state.lines).toEqual(["abcd", "efgh", "ij"]);
    expect(state.cursorRow).toBe(1);
    expect(state.cursorCol).toBe(2);
  });

  it("never returns negative width for narrow long words", () => {
    const state = computeWrappedInputState({
      text: "supercalifragilisticexpialidocious",
      cursorOffset: 34,
      width: 0,
      prefixWidth: 12,
      paddingLeft: 8,
      paddingRight: 8,
      minContentWidth: 0,
    });

    expect(state.contentWidth).toBeGreaterThanOrEqual(0);
    expect(state.lines.length).toBeGreaterThan(0);
    expect(state.cursorRow).toBeGreaterThanOrEqual(0);
    expect(state.cursorCol).toBeGreaterThanOrEqual(0);
  });

  it("stays stable while different Home/Task layout params produce different wraps", () => {
    const home = computeWrappedInputState({
      text: "abcdefghij",
      cursorOffset: 10,
      width: 10,
      prefixWidth: 2,
      paddingLeft: 2,
      paddingRight: 2,
      minContentWidth: 4,
    });
    const task = computeWrappedInputState({
      text: "abcdefghij",
      cursorOffset: 10,
      width: 10,
      prefixWidth: 0,
      paddingLeft: 0,
      paddingRight: 0,
      minContentWidth: 4,
    });
    const homeAgain = computeWrappedInputState({
      text: "abcdefghij",
      cursorOffset: 10,
      width: 10,
      prefixWidth: 2,
      paddingLeft: 2,
      paddingRight: 2,
      minContentWidth: 4,
    });

    expect(home.lines).not.toEqual(task.lines);
    expect(home.cursorCol).not.toBe(task.cursorCol);
    expect(homeAgain).toEqual(home);
  });
});
