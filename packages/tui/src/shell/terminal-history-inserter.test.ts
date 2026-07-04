import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  canInsertTerminalHistoryText,
  insertTerminalHistoryText,
} from "./terminal-history-inserter.js";

describe("terminal history inserter", () => {
  it("inserts rendered history above the live viewport and restores cursor", () => {
    let written = "";
    const output = new Writable({
      write(chunk, _encoding, callback) {
        written += String(chunk);
        callback();
      },
    });

    const inserted = insertTerminalHistoryText(output, "A\r\nB\r\n", {
      viewportGeometry: { x: 0, y: 17, width: 80, height: 8, contentHeight: 8, topOffset: 0 },
      terminalRows: 30,
    });

    expect(inserted).toBe(true);
    expect(written).toContain("\x1B[s");
    expect(written).toContain("\x1B[1;17r");
    expect(written).toContain("\x1B[17;1H");
    expect(written).toContain("\r\nA\x1B[K");
    expect(written).toContain("\r\nB\x1B[K");
    expect(written).toContain("\x1B[r\x1B[u");
    expect(written).toContain("\x1B[u");
  });

  it("refuses insertion without a measured live viewport boundary", () => {
    let written = "";
    const output = new Writable({
      write(chunk, _encoding, callback) {
        written += String(chunk);
        callback();
      },
    });

    const inserted = insertTerminalHistoryText(output, "A\r\n", {});

    expect(inserted).toBe(false);
    expect(written).toBe("");
  });

  it("uses the same geometry guard for preflight and insert", () => {
    const geometry = { x: 0, y: 17, width: 80, height: 8, contentHeight: 8, topOffset: 0 };

    expect(canInsertTerminalHistoryText({ viewportGeometry: geometry, terminalRows: 30 })).toBe(
      true,
    );
    expect(canInsertTerminalHistoryText({ viewportGeometry: geometry, terminalRows: 5 })).toBe(
      false,
    );
    expect(canInsertTerminalHistoryText({})).toBe(false);
  });

  it("refuses insertion when the live viewport starts at the top", () => {
    let written = "";
    const output = new Writable({
      write(chunk, _encoding, callback) {
        written += String(chunk);
        callback();
      },
    });

    const inserted = insertTerminalHistoryText(output, "A\r\n", {
      viewportGeometry: { x: 0, y: 0, width: 80, height: 20, contentHeight: 20, topOffset: 0 },
      terminalRows: 30,
    });

    expect(inserted).toBe(false);
    expect(written).toBe("");
  });

  it("refuses insertion without room above the live input area", () => {
    let written = "";
    const output = new Writable({
      write(chunk, _encoding, callback) {
        written += String(chunk);
        callback();
      },
    });

    const inserted = insertTerminalHistoryText(output, "A\r\n", {
      viewportGeometry: { x: 0, y: 1, width: 80, height: 8, contentHeight: 8, topOffset: 0 },
      terminalRows: 30,
    });

    expect(inserted).toBe(false);
    expect(written).toBe("");
  });

  it("refuses insertion when the measured history boundary is outside terminal rows", () => {
    let written = "";
    const output = new Writable({
      write(chunk, _encoding, callback) {
        written += String(chunk);
        callback();
      },
    });

    const inserted = insertTerminalHistoryText(output, "A\r\n", {
      viewportGeometry: { x: 0, y: 24, width: 80, height: 4, contentHeight: 4, topOffset: 0 },
      terminalRows: 20,
    });

    expect(inserted).toBe(false);
    expect(written).toBe("");
  });

  it("can replay rendered rows after clearing only the visible screen", () => {
    let written = "";
    const output = new Writable({
      write(chunk, _encoding, callback) {
        written += String(chunk);
        callback();
      },
    });

    const inserted = insertTerminalHistoryText(output, "A\r\n", {
      viewportGeometry: { x: 0, y: 17, width: 80, height: 8, contentHeight: 8, topOffset: 0 },
      terminalRows: 30,
      clearBefore: true,
    });

    expect(inserted).toBe(true);
    expect(written.startsWith("\x1B[r\x1B[2J\x1B[H\x1B[s")).toBe(true);
    expect(written).not.toContain("\x1B[3J");
    expect(written).toContain("\r\nA\x1B[K");
    expect(written).toContain("\x1B[r\x1B[u");
  });

  it("falls back to resetting the scroll region when terminal rows are unavailable", () => {
    let written = "";
    const output = new Writable({
      write(chunk, _encoding, callback) {
        written += String(chunk);
        callback();
      },
    });

    const inserted = insertTerminalHistoryText(output, "A\r\n", {
      viewportGeometry: { x: 0, y: 17, width: 80, height: 8, contentHeight: 8, topOffset: 0 },
    });

    expect(inserted).toBe(true);
    expect(written).toContain("\x1B[r\x1B[u");
  });
});
