import { describe, expect, it } from "vitest";
import {
  classifyParsedTerminalInput,
  createTerminalInputTokenizer,
  parseTerminalInput,
} from "./terminal-input.js";

describe("terminal input tokenizer", () => {
  it("parses complete SGR wheel events", () => {
    expect(parseTerminalInput("\x1B[<64;44;14M")).toEqual([
      { kind: "wheel", direction: "up", raw: "\x1B[<64;44;14M", x: 44, y: 14 },
    ]);
    expect(parseTerminalInput("\x1B[<65;44;14M")).toEqual([
      { kind: "wheel", direction: "down", raw: "\x1B[<65;44;14M", x: 44, y: 14 },
    ]);
  });

  it("parses complete SGR press drag release and hover events", () => {
    expect(parseTerminalInput("\x1B[<0;10;5M\x1B[<32;10;6M\x1B[<0;10;6m\x1B[<35;11;7M")).toEqual([
      { kind: "mouse", action: "press", button: 0, raw: "\x1B[<0;10;5M", x: 10, y: 5 },
      { kind: "mouse", action: "drag", button: 0, raw: "\x1B[<32;10;6M", x: 10, y: 6 },
      { kind: "mouse", action: "release", button: 0, raw: "\x1B[<0;10;6m", x: 10, y: 6 },
      { kind: "mouse", action: "hover", button: 3, raw: "\x1B[<35;11;7M", x: 11, y: 7 },
    ]);
  });

  it("buffers split SGR sequences across chunks", () => {
    const tokenizer = createTerminalInputTokenizer();
    expect(tokenizer.feed("\x1B[<64;4")).toEqual([]);
    expect(tokenizer.feed("4;14M")).toEqual([
      { kind: "wheel", direction: "up", raw: "\x1B[<64;44;14M", x: 44, y: 14 },
    ]);
  });

  it("parses orphan SGR mouse tails as mouse events", () => {
    expect(parseTerminalInput("[<64;44;14M")).toEqual([
      { kind: "wheel", direction: "up", raw: "\x1B[<64;44;14M", x: 44, y: 14 },
    ]);
  });

  it("keeps partial mouse fragments out of keyboard classification", () => {
    for (const input of ["[<", "[<64", "[<64;", "[<64;47", "[<64;47;", "[<64;47;20", ";47;20M", "64;47;20M"]) {
      expect(classifyParsedTerminalInput(input)).toBe("mouse");
    }
  });

  it("parses X10 mouse and wheel fallback", () => {
    expect(parseTerminalInput(`\x1B[M${String.fromCharCode(32)}${String.fromCharCode(42)}${String.fromCharCode(37)}`)).toEqual([
      { kind: "mouse", action: "press", button: 0, raw: `\x1B[M${String.fromCharCode(32)}${String.fromCharCode(42)}${String.fromCharCode(37)}`, x: 10, y: 5 },
    ]);
    expect(parseTerminalInput(`\x1B[M${String.fromCharCode(96)}${String.fromCharCode(42)}${String.fromCharCode(37)}`)).toEqual([
      { kind: "wheel", direction: "up", raw: `\x1B[M${String.fromCharCode(96)}${String.fromCharCode(42)}${String.fromCharCode(37)}`, x: 10, y: 5 },
    ]);
  });

  it("keeps escape-looking bytes inside bracketed paste", () => {
    expect(parseTerminalInput("\x1B[200~hello \x1B[<64;44;14M\x1B[201~")).toEqual([
      { kind: "paste", text: "hello \x1B[<64;44;14M", raw: "\x1B[200~hello \x1B[<64;44;14M\x1B[201~" },
    ]);
  });

  it("classifies terminal responses separately from keyboard input", () => {
    expect(classifyParsedTerminalInput("\x1B[?1;2c")).toBe("terminal-response");
    expect(classifyParsedTerminalInput("\x1B[12;40R")).toBe("terminal-response");
    expect(classifyParsedTerminalInput("\x1B[?1000;1$y")).toBe("terminal-response");
  });

  it("classifies focus reports separately from keyboard input", () => {
    expect(classifyParsedTerminalInput("\x1B[I")).toBe("terminal-response");
    expect(classifyParsedTerminalInput("\x1B[O")).toBe("terminal-response");
    expect(classifyParsedTerminalInput("[I")).toBe("terminal-response");
    expect(classifyParsedTerminalInput("[O")).toBe("terminal-response");
  });

  it("preserves ordinary keyboard input", () => {
    expect(parseTerminalInput("hello")).toEqual([
      { kind: "key", input: "h" },
      { kind: "key", input: "e" },
      { kind: "key", input: "l" },
      { kind: "key", input: "l" },
      { kind: "key", input: "o" },
    ]);
    expect(classifyParsedTerminalInput("hello")).toBe("keyboard");
  });

  it("keeps unknown escapes out of text input", () => {
    expect(classifyParsedTerminalInput("\x1B_")).toBe("unknown-escape");
  });

  it("buffers incomplete escape sequences until flush", () => {
    const tokenizer = createTerminalInputTokenizer();
    expect(tokenizer.feed("\x1B")).toEqual([]);
    expect(tokenizer.feed("[A")).toEqual([{ kind: "key", input: "\x1B[A" }]);
  });

  it("parses CSI OSC DCS and SS3 boundaries without leaking control bytes as text", () => {
    expect(parseTerminalInput("\x1B[A")).toEqual([{ kind: "key", input: "\x1B[A" }]);
    expect(parseTerminalInput("\x1BOA")).toEqual([{ kind: "key", input: "\x1BOA" }]);
    expect(parseTerminalInput("\x1B]0;title\x07")).toEqual([
      { kind: "terminal-response", response: "\x1B]0;title\x07", raw: "\x1B]0;title\x07" },
    ]);
    expect(parseTerminalInput("\x1BP1;2\x1B\\")).toEqual([
      { kind: "terminal-response", response: "\x1BP1;2\x1B\\", raw: "\x1BP1;2\x1B\\" },
    ]);
  });
});
