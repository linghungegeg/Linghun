import { describe, it, expect, vi } from "vitest";
import { parseTerminalInput } from "./terminal-input.js";

/**
 * Phase 7 — Structured runtime hooks unit tests.
 *
 * These tests validate the hook filtering logic at the pure-function level:
 * each hook filters ParsedTerminalInput events by kind. Since the hooks are
 * React hooks (useInput + useCallback), we test the filtering predicate and
 * parseTerminalInput integration rather than React rendering.
 */

describe("useWheelInput — wheel event filtering", () => {
  it("should produce wheel events from SGR wheel sequences", () => {
    const events = parseTerminalInput("\x1B[<64;10;20M");
    const wheelEvents = events.filter((e) => e.kind === "wheel");
    expect(wheelEvents).toHaveLength(1);
    expect(wheelEvents[0]?.direction).toBe("up");
  });

  it("should not produce wheel events from mouse press", () => {
    const events = parseTerminalInput("\x1B[<0;10;20M");
    const wheelEvents = events.filter((e) => e.kind === "wheel");
    expect(wheelEvents).toHaveLength(0);
  });

  it("should not produce wheel events from key input", () => {
    const events = parseTerminalInput("hello");
    const wheelEvents = events.filter((e) => e.kind === "wheel");
    expect(wheelEvents).toHaveLength(0);
  });

  it("should produce wheel-down from SGR code 65", () => {
    const events = parseTerminalInput("\x1B[<65;5;5M");
    const wheelEvents = events.filter((e) => e.kind === "wheel");
    expect(wheelEvents).toHaveLength(1);
    expect(wheelEvents[0]?.direction).toBe("down");
  });
});

describe("useMouseInput — mouse event filtering", () => {
  it("should produce mouse events from SGR press", () => {
    const events = parseTerminalInput("\x1B[<0;10;20M");
    const mouseEvents = events.filter((e) => e.kind === "mouse");
    expect(mouseEvents).toHaveLength(1);
    expect(mouseEvents[0]?.action).toBe("press");
  });

  it("should produce mouse events from SGR drag", () => {
    const events = parseTerminalInput("\x1B[<32;15;25M");
    const mouseEvents = events.filter((e) => e.kind === "mouse");
    expect(mouseEvents).toHaveLength(1);
    expect(mouseEvents[0]?.action).toBe("drag");
  });

  it("should produce mouse events from SGR release", () => {
    const events = parseTerminalInput("\x1B[<0;10;20m");
    const mouseEvents = events.filter((e) => e.kind === "mouse");
    expect(mouseEvents).toHaveLength(1);
    expect(mouseEvents[0]?.action).toBe("release");
  });

  it("should not produce mouse events from wheel", () => {
    const events = parseTerminalInput("\x1B[<64;10;20M");
    const mouseEvents = events.filter((e) => e.kind === "mouse");
    expect(mouseEvents).toHaveLength(0);
  });

  it("should not produce mouse events from key input", () => {
    const events = parseTerminalInput("abc");
    const mouseEvents = events.filter((e) => e.kind === "mouse");
    expect(mouseEvents).toHaveLength(0);
  });
});

describe("usePasteInput — paste event filtering", () => {
  it("should produce paste events from bracketed paste", () => {
    const events = parseTerminalInput("\x1B[200~hello world\x1B[201~");
    const pasteEvents = events.filter((e) => e.kind === "paste");
    expect(pasteEvents).toHaveLength(1);
    expect(pasteEvents[0]?.text).toBe("hello world");
  });

  it("should not produce paste events from key input", () => {
    const events = parseTerminalInput("hello");
    const pasteEvents = events.filter((e) => e.kind === "paste");
    expect(pasteEvents).toHaveLength(0);
  });

  it("should not produce paste events from mouse", () => {
    const events = parseTerminalInput("\x1B[<0;10;20M");
    const pasteEvents = events.filter((e) => e.kind === "paste");
    expect(pasteEvents).toHaveLength(0);
  });

  it("should preserve newlines in pasted text", () => {
    const events = parseTerminalInput("\x1B[200~line1\nline2\x1B[201~");
    const pasteEvents = events.filter((e) => e.kind === "paste");
    expect(pasteEvents[0]?.text).toBe("line1\nline2");
  });
});

describe("useTerminalResponse — terminal response filtering", () => {
  it("should produce terminal-response from DA1 reply", () => {
    const events = parseTerminalInput("\x1B[?64;1;2;4c");
    const responseEvents = events.filter((e) => e.kind === "terminal-response");
    expect(responseEvents).toHaveLength(1);
  });

  it("should produce terminal-response from cursor position report", () => {
    const events = parseTerminalInput("\x1B[24;80R");
    const responseEvents = events.filter((e) => e.kind === "terminal-response");
    expect(responseEvents).toHaveLength(1);
  });

  it("should not produce terminal-response from key input", () => {
    const events = parseTerminalInput("test");
    const responseEvents = events.filter((e) => e.kind === "terminal-response");
    expect(responseEvents).toHaveLength(0);
  });

  it("should not produce terminal-response from mouse", () => {
    const events = parseTerminalInput("\x1B[<0;10;20M");
    const responseEvents = events.filter((e) => e.kind === "terminal-response");
    expect(responseEvents).toHaveLength(0);
  });
});

describe("useTerminalInput — unified event stream", () => {
  it("should produce all event kinds from mixed input", () => {
    // Wheel + key in one chunk
    const events = parseTerminalInput("\x1B[<64;10;20Ma");
    expect(events).toHaveLength(2);
    expect(events[0]?.kind).toBe("wheel");
    expect(events[1]?.kind).toBe("key");
  });

  it("should produce mouse-fragment for orphan tails", () => {
    const events = parseTerminalInput(";47;20M");
    expect(events.some((e) => e.kind === "mouse-fragment")).toBe(true);
  });

  it("should produce unknown-escape for unrecognized sequences", () => {
    // ESC followed by a non-standard char
    const events = parseTerminalInput("\x1B!");
    expect(events.some((e) => e.kind === "unknown-escape")).toBe(true);
  });

  it("Composer guard: keyboard events pass, non-keyboard blocked", () => {
    // Simulate the Composer classifyTerminalInput guard logic
    const keyboardInput = "hello";
    const mouseInput = "\x1B[<0;10;20M";
    const wheelInput = "\x1B[<64;10;20M";

    const keyEvents = parseTerminalInput(keyboardInput);
    const mouseEvents = parseTerminalInput(mouseInput);
    const wheelEvents = parseTerminalInput(wheelInput);

    // Keyboard: all key kind
    expect(keyEvents.every((e) => e.kind === "key")).toBe(true);
    // Mouse: no key kind
    expect(mouseEvents.every((e) => e.kind !== "key")).toBe(true);
    // Wheel: no key kind
    expect(wheelEvents.every((e) => e.kind !== "key")).toBe(true);
  });
});
