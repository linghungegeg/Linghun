import { describe, expect, it } from "vitest";
import {
  buildTranscriptScreenBuffer,
  parseSgrMouseEvent,
  reduceTranscriptSelection,
  selectionLineRangesForBlock,
  selectedTextFromRows,
} from "./transcript-selection-state.js";

const rows = Array.from({ length: 8 }, (_, index) => {
  const text = `row ${index}`;
  return {
    index,
    text,
    cells: Array.from(text).map((char) => ({
      char,
      selectableText: char,
      width: 1,
    })),
  };
});
const geometry = { x: 0, y: 0, width: 10, height: 3, contentHeight: 8, topOffset: 2 };

describe("transcript selection reducer", () => {
  it("parses SGR left down/drag/up events", () => {
    expect(parseSgrMouseEvent("\x1B[<0;2;2M")).toMatchObject({
      x: 1,
      y: 1,
      button: "left",
      action: "down",
    });
    expect(parseSgrMouseEvent("\x1B[<32;2;3M")).toMatchObject({ action: "drag" });
    expect(parseSgrMouseEvent("\x1B[<0;2;3m")).toMatchObject({ action: "up" });
    expect(parseSgrMouseEvent("\x1B[<3;2;3m")).toMatchObject({
      button: "left",
      action: "up",
    });
  });

  it("selects and copies text on left drag release", () => {
    const down = reduceTranscriptSelection({
      state: undefined,
      event: { x: 0, y: 0, button: "left", action: "down" },
      rows,
      geometry,
    });
    const drag = reduceTranscriptSelection({
      state: down.state,
      event: { x: 5, y: 1, button: "left", action: "drag" },
      rows,
      geometry,
    });
    const up = reduceTranscriptSelection({
      state: drag.state,
      event: { x: 5, y: 1, button: "left", action: "up" },
      rows,
      geometry,
    });

    expect(up.consumed).toBe(true);
    expect(up.copyText).toBe("row 2\nrow 3");
    expect(up.state?.copiedText).toBe("row 2\nrow 3");
  });

  it("bounds edge autoscroll deltas to remaining scroll range", () => {
    const down = reduceTranscriptSelection({
      state: undefined,
      event: { x: 0, y: 0, button: "left", action: "down" },
      rows,
      geometry,
      scroll: { scrollOffset: 4, stickToBottom: false, viewportHeight: 3, contentHeight: 8 },
    });
    const dragDown = reduceTranscriptSelection({
      state: down.state,
      event: { x: 0, y: 5, button: "left", action: "drag" },
      rows,
      geometry,
      scroll: { scrollOffset: 1, stickToBottom: false, viewportHeight: 3, contentHeight: 8 },
    });
    expect(dragDown.scrollDelta).toBe(-1);

    const dragUp = reduceTranscriptSelection({
      state: down.state,
      event: { x: 0, y: -1, button: "left", action: "drag" },
      rows,
      geometry,
      scroll: { scrollOffset: 4, stickToBottom: false, viewportHeight: 3, contentHeight: 8 },
    });
    expect(dragUp.scrollDelta).toBe(1);
  });

  it("finishes copy when release happens outside the transcript viewport during a drag", () => {
    const down = reduceTranscriptSelection({
      state: undefined,
      event: { x: 0, y: 0, button: "left", action: "down" },
      rows,
      geometry,
    });
    const drag = reduceTranscriptSelection({
      state: down.state,
      event: { x: 5, y: 1, button: "left", action: "drag" },
      rows,
      geometry,
    });
    const up = reduceTranscriptSelection({
      state: drag.state,
      event: { x: 99, y: 5, button: "left", action: "up" },
      rows,
      geometry,
    });

    expect(up.consumed).toBe(true);
    expect(up.copyText).toBe("row 2\nrow 3\nrow 4");
    expect(up.state?.copiedText).toBe("row 2\nrow 3\nrow 4");
  });

  it("finishes copy when SGR release uses button code 3", () => {
    const down = reduceTranscriptSelection({
      state: undefined,
      event: { x: 0, y: 0, button: "left", action: "down" },
      rows,
      geometry,
    });
    const release = parseSgrMouseEvent("\x1B[<3;6;2m");
    const up = reduceTranscriptSelection({
      state: down.state,
      event: release ?? { x: 0, y: 0, button: "other", action: "up" },
      rows,
      geometry,
    });

    expect(up.consumed).toBe(true);
    expect(up.copyText).toBe("row 2\nrow 3");
  });

  it("does not consume out-of-bounds left events without an active drag", () => {
    const result = reduceTranscriptSelection({
      state: undefined,
      event: { x: 99, y: 0, button: "left", action: "up" },
      rows,
      geometry,
    });
    expect(result.consumed).toBe(false);
    expect(result.state).toBeUndefined();
  });

  it("does not consume left selection without viewport geometry", () => {
    expect(
      reduceTranscriptSelection({
        state: undefined,
        event: { x: 0, y: 0, button: "left", action: "down" },
        rows,
      }).consumed,
    ).toBe(false);
  });

  it("builds a screen buffer with cells, soft wraps, and noSelect metadata", () => {
    const screen = buildTranscriptScreenBuffer(
      [
        {
          id: "assistant",
          kind: "details",
          status: "info",
          title: "",
          summary: "",
          fullText: "abcdef",
          messageKind: "assistant_text",
        },
        {
          id: "command",
          kind: "command",
          status: "info",
          title: "❯ /details",
          summary: "❯ /details",
          messageKind: "command_transcript",
        },
      ],
      3,
    );

    expect(screen.rows.map((row) => ({ text: row.text, softWrapped: row.softWrapped }))).toEqual([
      { text: "abc", softWrapped: false },
      { text: "def", softWrapped: true },
      { text: "", softWrapped: undefined },
      { text: "", softWrapped: false },
      { text: "", softWrapped: true },
      { text: "", softWrapped: true },
      { text: "", softWrapped: true },
    ]);
    expect(screen.rows[0]?.cells).toHaveLength(3);
    expect(screen.rows[3]?.noSelect).toBe(true);
    expect(screen.rows[3]?.cells.every((cell) => cell.noSelect)).toBe(true);
  });

  it("copies from screen cells without adding newlines across soft wraps", () => {
    const screen = buildTranscriptScreenBuffer(
      [
        {
          id: "assistant",
          kind: "details",
          status: "info",
          title: "",
          summary: "",
          fullText: "abcdef",
          messageKind: "assistant_text",
        },
      ],
      3,
    );

    expect(selectedTextFromRows(screen.rows, { row: 0, column: 0 }, { row: 1, column: 3 })).toBe(
      "abcdef",
    );
  });

  it("exposes selection ranges from the same screen cells used for copy", () => {
    const screen = buildTranscriptScreenBuffer(
      [
        {
          id: "assistant",
          kind: "details",
          status: "info",
          title: "",
          summary: "",
          fullText: "abcdef",
          messageKind: "assistant_text",
        },
      ],
      3,
    );
    const selection = {
      dragging: true,
      anchor: { row: 1, column: 1 },
      focus: { row: 1, column: 3 },
    };

    expect(selectedTextFromRows(screen.rows, selection.anchor, selection.focus)).toBe("ef");
    expect(selectionLineRangesForBlock(selection, screen.rows, "assistant")).toEqual([
      { lineIndex: 0, startColumn: 4, endColumn: 6 },
    ]);
  });

  it("excludes noSelect rows from copied text", () => {
    const screen = buildTranscriptScreenBuffer(
      [
        {
          id: "command",
          kind: "command",
          status: "info",
          title: "❯ /details",
          summary: "❯ /details",
          messageKind: "command_transcript",
        },
        {
          id: "assistant",
          kind: "details",
          status: "info",
          title: "",
          summary: "",
          fullText: "copy me",
          messageKind: "assistant_text",
        },
      ],
      80,
    );

    expect(selectedTextFromRows(screen.rows, { row: 0, column: 0 }, { row: 2, column: 7 })).toBe(
      "copy me",
    );
  });

  it("uses screen cell columns for wide CJK characters", () => {
    const screen = buildTranscriptScreenBuffer(
      [
        {
          id: "assistant",
          kind: "details",
          status: "info",
          title: "",
          summary: "",
          fullText: "你a",
          messageKind: "assistant_text",
        },
      ],
      80,
    );

    expect(screen.rows[0]?.cells).toHaveLength(3);
    expect(selectedTextFromRows(screen.rows, { row: 0, column: 0 }, { row: 0, column: 2 })).toBe(
      "你",
    );
    expect(
      selectionLineRangesForBlock(
        { dragging: true, anchor: { row: 0, column: 0 }, focus: { row: 0, column: 2 } },
        screen.rows,
        "assistant",
      ),
    ).toEqual([{ lineIndex: 0, startColumn: 0, endColumn: 2 }]);
  });
});
