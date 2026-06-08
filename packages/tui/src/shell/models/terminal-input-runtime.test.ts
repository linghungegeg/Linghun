import { describe, expect, it } from "vitest";
import {
  isBackspaceSequence,
  isDeleteSequence,
  isMultilineEnterSequence,
  normalizeTerminalInput,
  sanitizeTerminalText,
} from "./terminal-input-runtime.js";

const key = {
  backspace: false,
  delete: false,
  ctrl: false,
  meta: false,
  return: false,
  shift: false,
};

describe("terminal input normalization", () => {
  it("recognizes Delete from Ink key and raw CSI sequences", () => {
    expect(normalizeTerminalInput("", { ...key, delete: true })).toEqual({ type: "delete" });
    expect(normalizeTerminalInput("\x1B[3~", key)).toEqual({ type: "delete" });
    expect(normalizeTerminalInput("[3~", key)).toEqual({ type: "delete" });
    expect(normalizeTerminalInput("\x1B[3;4~", key)).toEqual({ type: "delete" });
    expect(isDeleteSequence("\x1B[3;5~")).toBe(true);
    expect(isDeleteSequence("[3;5~")).toBe(true);
    expect(isDeleteSequence("\x1B[51;5u")).toBe(true);
    expect(isDeleteSequence("[51;5u")).toBe(true);
  });

  it("recognizes Backspace from DEL/BS and Ink key", () => {
    expect(normalizeTerminalInput("", { ...key, backspace: true })).toEqual({
      type: "backspace",
    });
    expect(normalizeTerminalInput("\x7F", key)).toEqual({ type: "backspace" });
    expect(normalizeTerminalInput("\b", key)).toEqual({ type: "backspace" });
    expect(isBackspaceSequence("\x1B[127;5u")).toBe(true);
  });

  it("maps ctrl/meta delete and backspace to delete-word-left", () => {
    expect(normalizeTerminalInput("\x1B[3~", { ...key, ctrl: true })).toEqual({
      type: "delete-word-left",
    });
    expect(normalizeTerminalInput("\x7F", { ...key, meta: true })).toEqual({
      type: "delete-word-left",
    });
  });

  it("does not guess plain CR as Shift/Meta Enter when terminals only send CR", () => {
    expect(normalizeTerminalInput("\r", { ...key, return: true })).toEqual({ type: "ignore" });
    expect(normalizeTerminalInput("\r", { ...key, return: true, meta: true })).toEqual({
      type: "ignore",
    });
  });

  it("maps explicit Shift+Enter key metadata to newline", () => {
    expect(normalizeTerminalInput("", { ...key, return: true, shift: true })).toEqual({
      type: "newline",
    });
    expect(normalizeTerminalInput("\r", { ...key, return: true, shift: true })).toEqual({
      type: "newline",
    });
    expect(normalizeTerminalInput("x", { ...key, return: true, shift: true })).toEqual({
      type: "newline",
    });
  });

  it("does not accept Meta+Enter key metadata without a parsed sequence", () => {
    expect(normalizeTerminalInput("", { ...key, return: true, meta: true })).toEqual({
      type: "ignore",
    });
  });

  it("recognizes multiline Enter only through Ctrl+J, LF, configured ESC+CR, CSI-u, and modifyOtherKeys", () => {
    expect(normalizeTerminalInput("j", { ...key, ctrl: true })).toEqual({ type: "newline" });
    expect(normalizeTerminalInput("\n", key)).toEqual({ type: "newline" });
    expect(normalizeTerminalInput("\x1B\r", key)).toEqual({ type: "newline" });
    expect(isMultilineEnterSequence("\x1B\r")).toBe(true);
    expect(isMultilineEnterSequence("\x1B[13;2u")).toBe(true);
    expect(isMultilineEnterSequence("[13;2u")).toBe(true);
    expect(isMultilineEnterSequence("\x1B[10;3u")).toBe(true);
    expect(isMultilineEnterSequence("\x1B[13;1u")).toBe(false);
    expect(isMultilineEnterSequence("\x1B[13;2~")).toBe(true);
    expect(isMultilineEnterSequence("[13;2~")).toBe(true);
    expect(isMultilineEnterSequence("\x1B[13;5~")).toBe(true);
    expect(isMultilineEnterSequence("\x1B[13;1~")).toBe(false);
    expect(isMultilineEnterSequence("\x1B[27;2;13~")).toBe(true);
    expect(isMultilineEnterSequence("[27;2;13~")).toBe(true);
    expect(isMultilineEnterSequence("\x1B[27;1;13~")).toBe(false);
    expect(isMultilineEnterSequence("\x1B[1;2C")).toBe(false);
  });

  it("sanitizes terminal control sequences while preserving text newlines", () => {
    expect(sanitizeTerminalText("a\x1B[31mb\x1B[0m\r\nc\x7Fd")).toBe("ab\ncd");
    expect(normalizeTerminalInput("hello", key)).toEqual({ type: "text", text: "hello" });
  });
});
