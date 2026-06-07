import { describe, expect, it } from "vitest";
import { parseSgrMouseEvent, reduceTranscriptSelection } from "./transcript-selection-state.js";

const rows = Array.from({ length: 8 }, (_, index) => ({ index, text: `row ${index}` }));
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

  it("does not consume left selection without viewport geometry", () => {
    expect(
      reduceTranscriptSelection({
        state: undefined,
        event: { x: 0, y: 0, button: "left", action: "down" },
        rows,
      }).consumed,
    ).toBe(false);
  });
});
