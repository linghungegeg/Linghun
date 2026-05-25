import { Box, Text, useCursor, useInput } from "ink";
import type React from "react";
import { useCallback, useRef, useState } from "react";
import type { TerminalCapability } from "../terminal-capability.js";
import { charWidth, fitText } from "../text-utils.js";
import type { ShellInputEvent, ShellViewModel } from "../types.js";

type ComposerProps = {
  view: ShellViewModel;
  onInput: (event: ShellInputEvent) => void | Promise<void>;
  capability: TerminalCapability;
};

// ---------------------------------------------------------------------------
// Edit buffer — the core editing model
// ---------------------------------------------------------------------------

export type EditBuffer = {
  /** Characters stored as an array (supports CJK/emoji correctly). */
  chars: string[];
  /** Cursor position in character units (0 = before first char). */
  cursor: number;
};

export function createEditBuffer(text = ""): EditBuffer {
  return { chars: Array.from(text), cursor: Array.from(text).length };
}

export function bufferToString(buf: EditBuffer): string {
  return buf.chars.join("");
}

export function bufferDisplayWidth(buf: EditBuffer): number {
  let w = 0;
  for (const ch of buf.chars) w += charWidth(ch);
  return w;
}

/** Insert text at cursor position. */
export function bufferInsert(buf: EditBuffer, text: string): EditBuffer {
  const insertChars = Array.from(text);
  const chars = [...buf.chars.slice(0, buf.cursor), ...insertChars, ...buf.chars.slice(buf.cursor)];
  return { chars, cursor: buf.cursor + insertChars.length };
}

/** Delete character before cursor (backspace). */
export function bufferBackspace(buf: EditBuffer): EditBuffer {
  if (buf.cursor === 0) return buf;
  const chars = [...buf.chars.slice(0, buf.cursor - 1), ...buf.chars.slice(buf.cursor)];
  return { chars, cursor: buf.cursor - 1 };
}

/** Delete character at cursor (delete key). */
export function bufferDelete(buf: EditBuffer): EditBuffer {
  if (buf.cursor >= buf.chars.length) return buf;
  const chars = [...buf.chars.slice(0, buf.cursor), ...buf.chars.slice(buf.cursor + 1)];
  return { chars, cursor: buf.cursor };
}

/** Move cursor left by one character. */
export function bufferMoveLeft(buf: EditBuffer): EditBuffer {
  if (buf.cursor === 0) return buf;
  return { ...buf, cursor: buf.cursor - 1 };
}

/** Move cursor right by one character. */
export function bufferMoveRight(buf: EditBuffer): EditBuffer {
  if (buf.cursor >= buf.chars.length) return buf;
  return { ...buf, cursor: buf.cursor + 1 };
}

/** Move cursor to start (Home). */
export function bufferHome(buf: EditBuffer): EditBuffer {
  return { ...buf, cursor: 0 };
}

/** Move cursor to end (End). */
export function bufferEnd(buf: EditBuffer): EditBuffer {
  return { ...buf, cursor: buf.chars.length };
}

/** Move cursor left by one word (Ctrl+Left / Alt+Left). */
export function bufferWordLeft(buf: EditBuffer): EditBuffer {
  let pos = buf.cursor;
  // Skip whitespace/punctuation going left
  while (pos > 0 && isWordBoundary(buf.chars[pos - 1] ?? "")) pos--;
  // Skip word characters going left
  while (pos > 0 && !isWordBoundary(buf.chars[pos - 1] ?? "")) pos--;
  return { ...buf, cursor: pos };
}

/** Move cursor right by one word (Ctrl+Right / Alt+Right). */
export function bufferWordRight(buf: EditBuffer): EditBuffer {
  let pos = buf.cursor;
  const len = buf.chars.length;
  // Skip word characters going right
  while (pos < len && !isWordBoundary(buf.chars[pos] ?? "")) pos++;
  // Skip whitespace/punctuation going right
  while (pos < len && isWordBoundary(buf.chars[pos] ?? "")) pos++;
  return { ...buf, cursor: pos };
}

/** Delete word before cursor (Ctrl+Backspace / Ctrl+W). */
export function bufferDeleteWordLeft(buf: EditBuffer): EditBuffer {
  const target = bufferWordLeft(buf).cursor;
  const chars = [...buf.chars.slice(0, target), ...buf.chars.slice(buf.cursor)];
  return { chars, cursor: target };
}

/** Clear entire line (Ctrl+U). */
export function bufferClearLine(buf: EditBuffer): EditBuffer {
  void buf;
  return { chars: [], cursor: 0 };
}

/** Kill to end of line (Ctrl+K). */
export function bufferKillToEnd(buf: EditBuffer): EditBuffer {
  return { chars: buf.chars.slice(0, buf.cursor), cursor: buf.cursor };
}

/** Move cursor up one line, preserving column position (CJK-aware). */
export function bufferMoveUp(buf: EditBuffer): EditBuffer {
  const { row, col } = getCursorLinePosition(buf, false);
  if (row === 0) return buf; // already on first line
  // Find the start of the target line (row - 1) and move to same column
  const lines = bufferToString(buf).split("\n");
  const targetLine = lines[row - 1] ?? "";
  const targetChars = Array.from(targetLine);
  // Clamp column to target line length
  const targetCol = Math.min(col, targetChars.length);
  // Calculate new cursor position: sum of chars in lines before target + newlines + targetCol
  let newCursor = 0;
  for (let i = 0; i < row - 1; i++) {
    newCursor += Array.from(lines[i] ?? "").length + 1; // +1 for \n
  }
  newCursor += targetCol;
  return { ...buf, cursor: newCursor };
}

/** Move cursor down one line, preserving column position (CJK-aware). */
export function bufferMoveDown(buf: EditBuffer): EditBuffer {
  const { row, col } = getCursorLinePosition(buf, false);
  const lines = bufferToString(buf).split("\n");
  if (row >= lines.length - 1) return buf; // already on last line
  // Find the start of the target line (row + 1) and move to same column
  const targetLine = lines[row + 1] ?? "";
  const targetChars = Array.from(targetLine);
  // Clamp column to target line length
  const targetCol = Math.min(col, targetChars.length);
  // Calculate new cursor position: sum of chars in lines before target + newlines + targetCol
  let newCursor = 0;
  for (let i = 0; i <= row; i++) {
    newCursor += Array.from(lines[i] ?? "").length + 1; // +1 for \n
  }
  newCursor += targetCol;
  return { ...buf, cursor: newCursor };
}

function isWordBoundary(ch: string): boolean {
  return /[\s\p{P}]/u.test(ch);
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export type InputHistory = {
  entries: string[];
  position: number; // -1 = current input (not browsing history)
  draft: string; // saved current input when browsing history
};

const MAX_HISTORY = 100;

export function createInputHistory(): InputHistory {
  return { entries: [], position: -1, draft: "" };
}

export function historyAdd(history: InputHistory, text: string): InputHistory {
  if (!text.trim()) return { ...history, position: -1, draft: "" };
  // Deduplicate consecutive
  const entries =
    history.entries[0] === text
      ? history.entries
      : [text, ...history.entries].slice(0, MAX_HISTORY);
  return { entries, position: -1, draft: "" };
}

export function historyUp(history: InputHistory, currentText: string): InputHistory | undefined {
  const nextPos = history.position + 1;
  if (nextPos >= history.entries.length) return undefined;
  const draft = history.position === -1 ? currentText : history.draft;
  return { ...history, position: nextPos, draft };
}

export function historyDown(history: InputHistory): InputHistory | undefined {
  if (history.position <= -1) return undefined;
  const nextPos = history.position - 1;
  return { ...history, position: nextPos, draft: history.draft };
}

export function historyCurrentText(history: InputHistory): string | undefined {
  if (history.position === -1) return undefined;
  return history.entries[history.position];
}

// ---------------------------------------------------------------------------
// Composer component
// ---------------------------------------------------------------------------

const COMPOSER_MAX_VISIBLE_LINES = 5;
const PROMPT_MARKER = "> ";
const PROMPT_MARKER_CONTINUATION = "  ";

export function Composer({ view, onInput, capability }: ComposerProps): React.ReactNode {
  const [buffer, setBuffer] = useState<EditBuffer>(createEditBuffer());
  const historyRef = useRef<InputHistory>(createInputHistory());
  const maxWidth = Math.min(80, Math.max(30, view.width - 4));
  const noColor = view.themeMode === "no-color";
  const { setCursorPosition } = useCursor();

  const resetBuffer = useCallback((text = "") => {
    setBuffer(createEditBuffer(text));
  }, []);

  useInput((input, key) => {
    // Submit: Enter (without shift)
    if (key.return && !key.shift) {
      const text = bufferToString(buffer).trim();
      historyRef.current = historyAdd(historyRef.current, bufferToString(buffer));
      resetBuffer();
      void onInput(text ? { type: "submit", text } : { type: "empty-submit" });
      return;
    }

    // Multiline: Shift+Enter
    if (key.return && key.shift) {
      setBuffer(bufferInsert(buffer, "\n"));
      return;
    }

    // Escape
    if (key.escape) {
      resetBuffer();
      void onInput({ type: "escape" });
      return;
    }

    // Navigation: arrow keys
    if (key.leftArrow) {
      if (key.ctrl || key.meta) {
        setBuffer(bufferWordLeft(buffer));
      } else {
        setBuffer(bufferMoveLeft(buffer));
      }
      return;
    }
    if (key.rightArrow) {
      if (key.ctrl || key.meta) {
        setBuffer(bufferWordRight(buffer));
      } else {
        setBuffer(bufferMoveRight(buffer));
      }
      return;
    }

    // History: up/down arrows — in multiline, move within lines first
    if (key.upArrow) {
      const { row } = getCursorLinePosition(buffer, false);
      if (row > 0) {
        // Move cursor up one line within the buffer
        setBuffer(bufferMoveUp(buffer));
      } else {
        // First line — trigger history navigation
        const next = historyUp(historyRef.current, bufferToString(buffer));
        if (next) {
          historyRef.current = next;
          const histText = historyCurrentText(next);
          if (histText !== undefined) resetBuffer(histText);
        }
      }
      return;
    }
    if (key.downArrow) {
      const { row } = getCursorLinePosition(buffer, false);
      const totalLines = bufferToString(buffer).split("\n").length;
      if (row < totalLines - 1) {
        // Move cursor down one line within the buffer
        setBuffer(bufferMoveDown(buffer));
      } else {
        // Last line — trigger history navigation
        const next = historyDown(historyRef.current);
        if (next) {
          historyRef.current = next;
          const histText = historyCurrentText(next);
          resetBuffer(histText ?? next.draft);
        }
      }
      return;
    }

    // Home / End
    if (key.ctrl && input === "a") {
      setBuffer(bufferHome(buffer));
      return;
    }
    if (key.ctrl && input === "e") {
      setBuffer(bufferEnd(buffer));
      return;
    }

    // Delete operations
    if (key.backspace || key.delete) {
      if (key.ctrl || key.meta) {
        setBuffer(bufferDeleteWordLeft(buffer));
      } else if (key.backspace) {
        setBuffer(bufferBackspace(buffer));
      } else {
        setBuffer(bufferDelete(buffer));
      }
      return;
    }

    // Ctrl+U: clear line
    if (key.ctrl && input === "u") {
      setBuffer(bufferClearLine(buffer));
      return;
    }

    // Ctrl+K: kill to end
    if (key.ctrl && input === "k") {
      setBuffer(bufferKillToEnd(buffer));
      return;
    }

    // Ctrl+W: delete word left
    if (key.ctrl && input === "w") {
      setBuffer(bufferDeleteWordLeft(buffer));
      return;
    }

    // Ignore other ctrl/meta sequences
    if (key.ctrl || key.meta) return;

    // Regular character input — ignore raw CR/LF (handled by return above)
    if (input && input !== "\r" && input !== "\n") {
      setBuffer(bufferInsert(buffer, input));
    }
  });

  // Render
  const text = bufferToString(buffer);
  const { lines, truncatedCount, cursorCol, cursorRow } = formatComposerRenderLines({
    buffer,
    placeholder: view.composer.placeholder,
    masking: view.composer.masking,
    noColor,
    maxWidth,
  });

  // Position native cursor — only if terminal supports cursor positioning
  if (capability.cursorPositioning) {
    setCursorPosition({ x: cursorCol, y: cursorRow + (truncatedCount > 0 ? 1 : 0) });
  }

  const placeholderColor = noColor ? undefined : "gray";
  const color = text ? undefined : placeholderColor;

  return (
    <Box width="100%" flexDirection="column">
      {truncatedCount > 0 ? <Text color="gray">{`… ${truncatedCount} line(s) above`}</Text> : null}
      {lines.map((line, index) => (
        <Text key={`${index}-${line}`} color={color} bold={Boolean(text)}>
          {fitText(line, maxWidth)}
        </Text>
      ))}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Render helpers (exported for testing)
// ---------------------------------------------------------------------------

export function formatComposerRenderLines({
  buffer,
  placeholder,
  masking,
  noColor,
  maxWidth,
}: {
  buffer: EditBuffer;
  placeholder: string;
  masking: boolean;
  noColor: boolean;
  maxWidth?: number;
}): { lines: string[]; truncatedCount: number; cursorCol: number; cursorRow: number } {
  void noColor;
  const text = bufferToString(buffer);
  const displayText = text ? (masking ? "*".repeat(buffer.chars.length) : text) : "";

  if (!displayText) {
    // Show placeholder
    const line = `${PROMPT_MARKER}${placeholder}`;
    return {
      lines: [line],
      truncatedCount: 0,
      cursorCol: displayWidthOf(PROMPT_MARKER),
      cursorRow: 0,
    };
  }

  const rawLines = displayText.split("\n");
  const truncated = rawLines.length > COMPOSER_MAX_VISIBLE_LINES;
  const skipCount = truncated ? rawLines.length - COMPOSER_MAX_VISIBLE_LINES : 0;
  const displayLines = truncated ? rawLines.slice(-COMPOSER_MAX_VISIBLE_LINES) : rawLines;

  const lines = displayLines.map((line, index) => {
    const isFirstVisible = !truncated && index === 0;
    const prefix = isFirstVisible ? PROMPT_MARKER : PROMPT_MARKER_CONTINUATION;
    return `${prefix}${line}`;
  });

  // Calculate cursor position based on buffer.cursor
  // Find which line and column the cursor is on
  const { row: cursorLineIndex, col: cursorCharCol } = getCursorLinePosition(buffer, masking);

  // Adjust for truncation
  const adjustedRow = cursorLineIndex - skipCount;
  const visibleRow = Math.max(0, Math.min(adjustedRow, lines.length - 1));

  // Calculate display width up to cursor column on that line
  const lineChars = rawLines[cursorLineIndex]
    ? Array.from(masking ? "*".repeat(rawLines[cursorLineIndex].length) : rawLines[cursorLineIndex])
    : [];
  const prefix = cursorLineIndex === 0 && !truncated ? PROMPT_MARKER : PROMPT_MARKER_CONTINUATION;
  let cursorCol = displayWidthOf(prefix);
  for (let i = 0; i < cursorCharCol && i < lineChars.length; i++) {
    cursorCol += charWidth(lineChars[i] ?? "");
  }

  // Clamp to maxWidth if provided
  if (maxWidth && cursorCol > maxWidth) cursorCol = maxWidth;

  return {
    lines,
    truncatedCount: skipCount,
    cursorCol,
    cursorRow: visibleRow,
  };
}

/** Find which line and character column the cursor is on. */
function getCursorLinePosition(buffer: EditBuffer, masking: boolean): { row: number; col: number } {
  void masking;
  let row = 0;
  let col = 0;
  for (let i = 0; i < buffer.cursor && i < buffer.chars.length; i++) {
    if (buffer.chars[i] === "\n") {
      row++;
      col = 0;
    } else {
      col++;
    }
  }
  return { row, col };
}

/** Calculate display width of a string (CJK = 2, others = 1). */
function displayWidthOf(value: string): number {
  let width = 0;
  for (const char of value) {
    width += charWidth(char);
  }
  return width;
}

// ---------------------------------------------------------------------------
// Legacy compatibility: handleComposerInput for tests that use the old API
// ---------------------------------------------------------------------------

type ComposerKey = {
  escape?: boolean;
  return?: boolean;
  shift?: boolean;
  backspace?: boolean;
  delete?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
};

export type ComposerDecision =
  | { kind: "set"; text: string }
  | { kind: "append"; text: string }
  | { kind: "emit"; event: ShellInputEvent; nextText: string }
  | { kind: "ignore" };

/**
 * Pure input handler for testing — maps key events to buffer operations.
 * This is a compatibility shim; the real Composer uses the buffer model directly.
 */
export function handleComposerInput(
  text: string,
  input: string,
  key: ComposerKey,
): ComposerDecision {
  if (key.escape) {
    return { kind: "emit", event: { type: "escape" }, nextText: "" };
  }
  if (key.return && key.shift) {
    return { kind: "append", text: "\n" };
  }
  if (key.return) {
    const submitted = text.trim();
    return {
      kind: "emit",
      event: submitted ? { type: "submit", text: submitted } : { type: "empty-submit" },
      nextText: "",
    };
  }
  if (key.backspace || key.delete) {
    return { kind: "set", text: Array.from(text).slice(0, -1).join("") };
  }
  if (key.ctrl || key.meta || input === "\r" || input === "\n") {
    return { kind: "ignore" };
  }
  if (input) {
    return { kind: "append", text: input };
  }
  return { kind: "ignore" };
}
