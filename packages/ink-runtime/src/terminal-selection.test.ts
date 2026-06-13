import { describe, expect, it } from "vitest";
import {
  parseTerminalSelectionMouseEvent,
  reduceTerminalSelection,
  type TerminalSelectionTextRow,
} from "./terminal-selection.js";

const rows: TerminalSelectionTextRow[] = Array.from({ length: 6 }, (_, index) => {
  const text = index === 4 ? "   " : `row ${index}`;
  return {
    index,
    text,
    cells: Array.from(text).map((char) => ({ char, selectableText: char, width: 1 })),
  };
});

const geometry = { x: 0, y: 0, width: 10, height: 3, contentHeight: 6, topOffset: 1 };

describe("terminal selection runtime", () => {
  it("parses SGR press, drag, release, and no-button hover", () => {
    expect(parseTerminalSelectionMouseEvent("\x1B[<0;2;2M")).toMatchObject({
      x: 1,
      y: 1,
      button: "left",
      action: "down",
    });
    expect(parseTerminalSelectionMouseEvent("\x1B[<32;2;3M")).toMatchObject({ action: "drag" });
    expect(parseTerminalSelectionMouseEvent("\x1B[<0;2;3m")).toMatchObject({ action: "up" });
    expect(parseTerminalSelectionMouseEvent("\x1B[<35;2;3M")).toMatchObject({ action: "hover" });
  });

  it("does not copy on a single click without drag", () => {
    const down = reduceTerminalSelection({
      state: undefined,
      event: { x: 0, y: 0, button: "left", action: "down" },
      rows,
      geometry,
      now: 1000,
    });
    const up = reduceTerminalSelection({
      state: down.state,
      event: { x: 0, y: 0, button: "left", action: "up" },
      rows,
      geometry,
      now: 1010,
    });

    expect(up.consumed).toBe(true);
    expect(up.copyText).toBeUndefined();
    expect(up.state?.copiedText).toBeUndefined();
  });

  it("copies selected text once on drag release", () => {
    const down = reduceTerminalSelection({
      state: undefined,
      event: { x: 0, y: 0, button: "left", action: "down" },
      rows,
      geometry,
      now: 1000,
    });
    const drag = reduceTerminalSelection({
      state: down.state,
      event: { x: 5, y: 1, button: "left", action: "drag" },
      rows,
      geometry,
      now: 1010,
    });
    const up = reduceTerminalSelection({
      state: drag.state,
      event: { x: 5, y: 1, button: "left", action: "up" },
      rows,
      geometry,
      now: 1020,
    });

    expect(up.copyText).toBe("row 1\nrow 2");
    expect(up.state?.copiedText).toBe("row 1\nrow 2");
  });

  it("does not copy whitespace-only selection", () => {
    const down = reduceTerminalSelection({
      state: undefined,
      event: { x: 0, y: 3, button: "left", action: "down" },
      rows,
      geometry: { ...geometry, height: 5, topOffset: 1 },
      now: 1000,
    });
    const up = reduceTerminalSelection({
      state: down.state,
      event: { x: 3, y: 3, button: "left", action: "up" },
      rows,
      geometry: { ...geometry, height: 5, topOffset: 1 },
      now: 1010,
    });

    expect(up.copyText).toBeUndefined();
    expect(up.state?.copiedText).toBeUndefined();
  });

  it("settles a lost release on focus-out", () => {
    const down = reduceTerminalSelection({
      state: undefined,
      event: { x: 0, y: 0, button: "left", action: "down" },
      rows,
      geometry,
      now: 1000,
    });
    const drag = reduceTerminalSelection({
      state: down.state,
      event: { x: 5, y: 1, button: "left", action: "drag" },
      rows,
      geometry,
      now: 1010,
    });
    const focusOut = reduceTerminalSelection({
      state: drag.state,
      event: { x: 0, y: 0, button: "left", action: "focus-out" },
      rows,
      geometry,
      now: 1020,
    });

    expect(focusOut.copyText).toBe("row 1\nrow 2");
    expect(focusOut.state?.dragging).toBe(false);
  });

  it("settles a lost release on no-button hover while dragging", () => {
    const down = reduceTerminalSelection({
      state: undefined,
      event: { x: 0, y: 0, button: "left", action: "down" },
      rows,
      geometry,
      now: 1000,
    });
    const drag = reduceTerminalSelection({
      state: down.state,
      event: { x: 5, y: 1, button: "left", action: "drag" },
      rows,
      geometry,
      now: 1010,
    });
    const hover = reduceTerminalSelection({
      state: drag.state,
      event: { x: 5, y: 1, button: "left", action: "hover" },
      rows,
      geometry,
      now: 1020,
    });

    expect(hover.copyText).toBe("row 1\nrow 2");
    expect(hover.state?.dragging).toBe(false);
  });

  it("settles previous drag before a fresh press starts a new selection", () => {
    const down = reduceTerminalSelection({
      state: undefined,
      event: { x: 0, y: 0, button: "left", action: "down" },
      rows,
      geometry,
      now: 1000,
    });
    const drag = reduceTerminalSelection({
      state: down.state,
      event: { x: 5, y: 1, button: "left", action: "drag" },
      rows,
      geometry,
      now: 1010,
    });
    const nextDown = reduceTerminalSelection({
      state: drag.state,
      event: { x: 1, y: 1, button: "left", action: "down" },
      rows,
      geometry,
      now: 1020,
    });

    expect(nextDown.copyText).toBe("row 1\nrow 2");
    expect(nextDown.state?.dragging).toBe(true);
    expect(nextDown.state?.selectedText).toBe("");
  });

  it("keeps selection state without copying when copy-on-select is disabled", () => {
    const down = reduceTerminalSelection({
      state: undefined,
      event: { x: 0, y: 0, button: "left", action: "down" },
      rows,
      geometry,
      copyOnSelect: false,
      now: 1000,
    });
    const up = reduceTerminalSelection({
      state: down.state,
      event: { x: 5, y: 1, button: "left", action: "up" },
      rows,
      geometry,
      copyOnSelect: false,
      now: 1010,
    });

    expect(up.copyText).toBeUndefined();
    expect(up.state?.selectedText).toBe("row 1\nrow 2");
    expect(up.state?.copiedText).toBeUndefined();
  });
});
