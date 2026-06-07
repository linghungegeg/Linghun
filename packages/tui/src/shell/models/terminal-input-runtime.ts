import type { Key } from "ink";

export type TerminalInputAction =
  | { type: "backspace" }
  | { type: "delete" }
  | { type: "delete-word-left" }
  | { type: "newline" }
  | { type: "text"; text: string }
  | { type: "ignore" };

export type TerminalInputKey = Pick<
  Key,
  "backspace" | "delete" | "ctrl" | "meta" | "return" | "shift"
>;

const DELETE_SEQUENCES = new Set(["\x1B[3~", "\x1B[3;2~", "\x1B[3;3~", "\x1B[3;5~"]);
const BACKSPACE_SEQUENCES = new Set(["\x7F", "\b"]);

export function normalizeTerminalInput(input: string, key: TerminalInputKey): TerminalInputAction {
  if (isDeleteSequence(input) || key.delete) {
    if (key.ctrl || key.meta) return { type: "delete-word-left" };
    return { type: "delete" };
  }

  if (isBackspaceSequence(input) || key.backspace) {
    if (key.ctrl || key.meta) return { type: "delete-word-left" };
    return { type: "backspace" };
  }

  if (isMultilineEnterSequence(input)) return { type: "newline" };
  if (key.return && (key.shift || key.meta)) return { type: "newline" };
  if ((key.ctrl && input === "j") || input === "\n") return { type: "newline" };

  if (key.ctrl || key.meta || input === "\r" || input === "\n") return { type: "ignore" };
  if (!input) return { type: "ignore" };
  return { type: "text", text: sanitizeTerminalText(input) };
}

export function isDeleteSequence(input: string): boolean {
  if (DELETE_SEQUENCES.has(input)) return true;
  return isCsiU(input, [51]) || isModifyOtherKeys(input, [51]);
}

export function isBackspaceSequence(input: string): boolean {
  if (BACKSPACE_SEQUENCES.has(input)) return true;
  return isCsiU(input, [8, 127]) || isModifyOtherKeys(input, [8, 127]);
}

export function isMultilineEnterSequence(input: string): boolean {
  if (!input.startsWith("\x1B[")) return false;
  return isCsiU(input, [10, 13, 57414]) || isModifyOtherKeys(input, [10, 13, 57414]);
}

export function sanitizeTerminalText(value: string): string {
  return (
    value
      .replace(CONTROL_SEQUENCE_PATTERN, "")
      .replace(ANSI_STRIP_PATTERN, "")
      .replace(/\r\n?/g, "\n")
      // biome-ignore lint/suspicious/noControlCharactersInRegex: composer sanitation intentionally drops raw terminal control bytes while preserving real newline.
      .replace(/[\u0001-\u0009\u000B-\u001F]/g, "")
  );
}

function isCsiU(input: string, codes: number[]): boolean {
  if (!input.startsWith("\x1B[") || !input.endsWith("u")) return false;
  const parts = input.slice(2, -1).split(";");
  const code = Number.parseInt(parts[0] ?? "", 10);
  const modifier = Number.parseInt((parts[1] ?? "").split(":")[0] ?? "", 10);
  return codes.includes(code) && modifier > 1;
}

function isModifyOtherKeys(input: string, codes: number[]): boolean {
  if (!input.startsWith("\x1B[") || !input.endsWith("~")) return false;
  const parts = input.slice(2, -1).split(";");
  if (parts.length < 3 || parts[0] !== "27") return false;
  const modifier = Number.parseInt(parts[1] ?? "", 10);
  const code = Number.parseInt(parts[2] ?? "", 10);
  return codes.includes(code) && modifier > 1;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences inherently contain control characters.
const ANSI_STRIP_PATTERN = /\u001B\[[\d;?]*[a-zA-Z]|\u001B\][^\u0007]*(?:\u0007|\u001B\\)|\u001B./g;
const CONTROL_SEQUENCE_PATTERN =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: terminal control sequences are control characters.
  /(?:\u001B\[[0-?]*[ -/]*[@-~]|\u001B\][^\u0007]*(?:\u0007|\u001B\\)|\u001B[P_X^][\s\S]*?(?:\u001B\\)|\u001B[@-_]|\u009B[0-?]*[ -/]*[@-~]|\u0000|\u0007|\u0008|\u000B|\u000C|\u000E|\u000F|\u007F)/g;
