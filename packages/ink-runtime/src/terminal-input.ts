export type ParsedTerminalInput =
  | { kind: "key"; input: string }
  | { kind: "wheel"; direction: "up" | "down"; raw: string; x: number; y: number }
  | {
      kind: "mouse";
      action: "press" | "drag" | "release" | "hover";
      button: number;
      x: number;
      y: number;
      raw: string;
    }
  | { kind: "paste"; text: string; raw: string }
  | { kind: "terminal-response"; response: string; raw: string }
  | { kind: "mouse-fragment"; raw: string }
  | { kind: "unknown-escape"; raw: string };

export type InputClassification = "keyboard" | "mouse" | "paste" | "terminal-response" | "unknown-escape";

const ESC = "\x1B";
const CSI = `${ESC}[`;
const OSC = `${ESC}]`;
const DCS = `${ESC}P`;
const ST = `${ESC}\\`;
const PASTE_START = `${CSI}200~`;
const PASTE_END = `${CSI}201~`;
const SGR_MOUSE_RE = /^\x1B\[<(\d+);(\d+);(\d+)([mM])/u;
const ORPHAN_SGR_MOUSE_RE = /^\[<(\d+);(\d+);(\d+)([mM])/u;
const SGR_MOUSE_FRAGMENT_RE = /^(?:\x1B\[<\d*(?:;\d*){0,2}|\[<\d*(?:;\d*){0,2}|<\d*(?:;\d*){0,2}|;\d+;\d+[mM]|\d+;\d+;\d+[mM])$/u;
const COMPLETE_MOUSE_TAIL_RE = /^(?:\d+;\d+;\d+[mM]|;\d+;\d+[mM])$/u;

export class TerminalInputTokenizer {
  private buffer = "";

  feed(chunk: string): ParsedTerminalInput[] {
    if (!chunk) return [];
    this.buffer += chunk;
    const events: ParsedTerminalInput[] = [];

    while (this.buffer.length > 0) {
      const parsed = parseNext(this.buffer, false);
      if (parsed.status === "pending") break;
      events.push(parsed.event);
      this.buffer = this.buffer.slice(parsed.length);
    }

    return events;
  }

  flush(): ParsedTerminalInput[] {
    const events: ParsedTerminalInput[] = [];
    while (this.buffer.length > 0) {
      const parsed = parseNext(this.buffer, true);
      if (parsed.status === "pending") {
        events.push({ kind: "key", input: this.buffer });
        this.buffer = "";
        break;
      }
      events.push(parsed.event);
      this.buffer = this.buffer.slice(parsed.length);
    }
    return events;
  }
}

export function createTerminalInputTokenizer(): TerminalInputTokenizer {
  return new TerminalInputTokenizer();
}

export function parseTerminalInput(input: string): ParsedTerminalInput[] {
  const tokenizer = createTerminalInputTokenizer();
  return [...tokenizer.feed(input), ...tokenizer.flush()];
}

export function classifyParsedTerminalInput(input: string): InputClassification {
  const events = parseTerminalInput(input);
  if (events.length === 0) return "keyboard";
  if (events.some((event) => event.kind === "paste")) return "paste";
  if (events.some((event) => event.kind === "terminal-response")) return "terminal-response";
  if (events.some((event) => event.kind === "mouse" || event.kind === "wheel" || event.kind === "mouse-fragment")) {
    return "mouse";
  }
  if (events.some((event) => event.kind === "unknown-escape")) return "unknown-escape";
  return "keyboard";
}

type ParseResult =
  | { status: "parsed"; event: ParsedTerminalInput; length: number }
  | { status: "pending" };

function parseNext(input: string, flush: boolean): ParseResult {
  const paste = parseBracketedPaste(input, flush);
  if (paste) return paste;

  const sgrMouse = parseSgrMouse(input);
  if (sgrMouse) return sgrMouse;

  const orphanMouse = parseOrphanSgrMouse(input);
  if (orphanMouse) return orphanMouse;

  const orphanFocus = parseOrphanFocusReport(input);
  if (orphanFocus) return orphanFocus;

  const x10Mouse = parseX10Mouse(input, flush);
  if (x10Mouse) return x10Mouse;

  const control = parseControlSequence(input, flush);
  if (control) return control;

  if (!flush && isPendingMouseFragment(input)) return { status: "pending" };
  if (isMouseFragment(input)) {
    return { status: "parsed", event: { kind: "mouse-fragment", raw: input }, length: input.length };
  }

  const escapeIndex = input.indexOf(ESC);
  const length = escapeIndex <= 0 ? 1 : escapeIndex;
  return { status: "parsed", event: { kind: "key", input: input.slice(0, length) }, length };
}

function parseBracketedPaste(input: string, flush: boolean): ParseResult | undefined {
  if (!input.startsWith(PASTE_START)) return undefined;
  const end = input.indexOf(PASTE_END, PASTE_START.length);
  if (end < 0) {
    if (!flush) return { status: "pending" };
    return { status: "parsed", event: { kind: "unknown-escape", raw: input }, length: input.length };
  }
  const raw = input.slice(0, end + PASTE_END.length);
  return {
    status: "parsed",
    event: { kind: "paste", text: input.slice(PASTE_START.length, end), raw },
    length: raw.length,
  };
}

function parseSgrMouse(input: string): ParseResult | undefined {
  const match = SGR_MOUSE_RE.exec(input);
  if (!match) return undefined;
  return mouseEventFromSgr(match, match[0]);
}

function parseOrphanSgrMouse(input: string): ParseResult | undefined {
  const match = ORPHAN_SGR_MOUSE_RE.exec(input);
  if (!match) return undefined;
  return mouseEventFromSgr(match, `${ESC}${match[0]}`);
}

function parseOrphanFocusReport(input: string): ParseResult | undefined {
  if (input !== "[I" && input !== "[O") return undefined;
  const response = `${ESC}${input}`;
  return { status: "parsed", event: { kind: "terminal-response", response, raw: input }, length: input.length };
}

function mouseEventFromSgr(match: RegExpExecArray, raw: string): ParseResult {
  const code = Number.parseInt(match[1] ?? "0", 10);
  const x = Number.parseInt(match[2] ?? "0", 10);
  const y = Number.parseInt(match[3] ?? "0", 10);
  const suffix = match[4] ?? "M";
  if ((code & 64) === 64) {
    return {
      status: "parsed",
      event: { kind: "wheel", direction: (code & 1) === 1 ? "down" : "up", raw, x, y },
      length: match[0].length,
    };
  }
  return {
    status: "parsed",
    event: { kind: "mouse", action: actionFromMouseCode(code, suffix === "m"), button: code & 3, raw, x, y },
    length: match[0].length,
  };
}

function parseX10Mouse(input: string, flush: boolean): ParseResult | undefined {
  if (!input.startsWith(`${ESC}[M`)) return undefined;
  if (input.length < 6) return flush ? undefined : { status: "pending" };
  const code = input.charCodeAt(3) - 32;
  const x = input.charCodeAt(4) - 32;
  const y = input.charCodeAt(5) - 32;
  const raw = input.slice(0, 6);
  if ((code & 64) === 64) {
    return {
      status: "parsed",
      event: { kind: "wheel", direction: (code & 1) === 1 ? "down" : "up", raw, x, y },
      length: 6,
    };
  }
  return {
    status: "parsed",
    event: { kind: "mouse", action: actionFromMouseCode(code, (code & 3) === 3), button: code & 3, raw, x, y },
    length: 6,
  };
}

function parseControlSequence(input: string, flush: boolean): ParseResult | undefined {
  if (input.startsWith(CSI)) return parseCsi(input, flush);
  if (input.startsWith(OSC)) return parseStringControl(input, OSC.length, flush);
  if (input.startsWith(DCS)) return parseStringControl(input, DCS.length, flush);
  if (input.startsWith(`${ESC}O`)) return parseSs3(input, flush);
  if (!input.startsWith(ESC)) return undefined;
  if (input.length === 1 && !flush) return { status: "pending" };
  return { status: "parsed", event: { kind: "unknown-escape", raw: input.slice(0, Math.min(2, input.length)) }, length: Math.min(2, input.length) };
}

function parseCsi(input: string, flush: boolean): ParseResult | undefined {
  const finalIndex = findCsiFinalIndex(input);
  if (finalIndex < 0) return flush ? undefined : { status: "pending" };
  const raw = input.slice(0, finalIndex + 1);
  if (isTerminalResponse(raw)) {
    return { status: "parsed", event: { kind: "terminal-response", response: raw, raw }, length: raw.length };
  }
  return { status: "parsed", event: { kind: "key", input: raw }, length: raw.length };
}

function parseStringControl(input: string, prefixLength: number, flush: boolean): ParseResult | undefined {
  const belIndex = input.indexOf("\x07", prefixLength);
  const stIndex = input.indexOf(ST, prefixLength);
  const end = firstNonNegative(belIndex, stIndex);
  if (end < 0) return flush ? undefined : { status: "pending" };
  const length = end + (end === stIndex ? ST.length : 1);
  const raw = input.slice(0, length);
  return { status: "parsed", event: { kind: "terminal-response", response: raw, raw }, length };
}

function parseSs3(input: string, flush: boolean): ParseResult | undefined {
  if (input.length < 3) return flush ? undefined : { status: "pending" };
  return { status: "parsed", event: { kind: "key", input: input.slice(0, 3) }, length: 3 };
}

function findCsiFinalIndex(input: string): number {
  for (let index = 2; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    if (code >= 0x40 && code <= 0x7e) return index;
  }
  return -1;
}

function isTerminalResponse(raw: string): boolean {
  const body = raw.slice(2);
  if (body === "I" || body === "O") return true;
  if (/^\?\d+(?:;\d+)*[cn]$/u.test(body)) return true;
  if (/^>\d+(?:;\d+)*c$/u.test(body)) return true;
  if (/^\d+(?:;\d+)*R$/u.test(body)) return true;
  if (/^\?\d+(?:;\d+)*\$y$/u.test(body)) return true;
  return false;
}

function actionFromMouseCode(code: number, releaseSuffix: boolean): "press" | "drag" | "release" | "hover" {
  if (releaseSuffix) return "release";
  if ((code & 32) === 32 && (code & 3) === 3) return "hover";
  if ((code & 32) === 32) return "drag";
  if ((code & 3) === 3) return "release";
  return "press";
}

function isPendingMouseFragment(input: string): boolean {
  return input === ESC || input === `${ESC}[` || input === `${ESC}[<` || input === "[" || input === "[<" || SGR_MOUSE_FRAGMENT_RE.test(input);
}

function isMouseFragment(input: string): boolean {
  if (SGR_MOUSE_FRAGMENT_RE.test(input)) return true;
  return COMPLETE_MOUSE_TAIL_RE.test(input);
}

function firstNonNegative(a: number, b: number): number {
  if (a < 0) return b;
  if (b < 0) return a;
  return Math.min(a, b);
}
