import { Box, type DOMElement, Text, useInput } from "ink";
import type React from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import { formatUnknownSlashCommand, getSlashPrefixCandidates } from "../../slash-dispatch.js";
import type { TerminalCapability } from "../terminal-capability.js";
import { charWidth, composerMaxWidth, fitText } from "../text-utils.js";
import { createShellTheme } from "../theme.js";
import type { ShellInputEvent, ShellViewModel } from "../types.js";
import { SlashSuggestions } from "./SlashSuggestions.js";
import { useAnchoredCursor } from "./useAnchoredCursor.js";

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
  const [slashSelection, setSlashSelection] = useState(0);
  const historyRef = useRef<InputHistory>(createInputHistory());
  const maxWidth = composerMaxWidth(view.width);
  const noColor = view.themeMode === "no-color";
  const theme = useMemo(() => createShellTheme(noColor), [noColor]);
  const anchorRef = useRef<DOMElement | null>(null);

  // Slash candidate state — derived from buffer text. Suggestions are visible
  // when the buffer is exactly one line and starts with "/" with at least one
  // following character. Empty "/" or "/?" defers to the dispatch help text on
  // submit; we intentionally do not show inline candidates for the bare "/".
  const text = bufferToString(buffer);
  const isSingleLineSlash =
    text.startsWith("/") && !text.includes("\n") && text.length >= 2 && text !== "/?";
  const slashCandidates = useMemo(
    () => (isSingleLineSlash ? getSlashPrefixCandidates(text) : []),
    [isSingleLineSlash, text],
  );
  const slashSelectionClamped =
    slashCandidates.length === 0
      ? 0
      : Math.max(0, Math.min(slashSelection, slashCandidates.length - 1));

  const resetBuffer = useCallback((nextText = "") => {
    setBuffer(createEditBuffer(nextText));
    setSlashSelection(0);
  }, []);

  const setBufferAndResetSelection = useCallback((next: EditBuffer) => {
    setBuffer(next);
    setSlashSelection(0);
  }, []);

  useInput((input, key) => {
    // Submit: Enter (without shift)
    if (key.return && !key.shift) {
      // If a slash candidate is highlighted (via Tab/Up/Down) and the buffer
      // text differs from the candidate's slash, accept the candidate first.
      // Plain Enter on the first candidate still submits the current buffer
      // verbatim — this matches CCB-style behavior boundaries.
      const submitText = bufferToString(buffer).trim();
      historyRef.current = historyAdd(historyRef.current, bufferToString(buffer));
      resetBuffer();
      void onInput(submitText ? { type: "submit", text: submitText } : { type: "empty-submit" });
      return;
    }

    // Multiline: Shift+Enter
    if (key.return && key.shift) {
      setBufferAndResetSelection(bufferInsert(buffer, "\n"));
      return;
    }

    // Tab — accept the highlighted slash candidate (replaces buffer with the
    // canonical slash). When no candidates are visible, Tab is ignored to
    // preserve raw composition behavior.
    if (key.tab && !key.shift) {
      if (slashCandidates.length > 0) {
        const picked = slashCandidates[slashSelectionClamped];
        if (picked) {
          resetBuffer(picked.slash);
          return;
        }
      }
      return;
    }

    // Escape — when slash candidates are visible, hide them by clearing
    // selection (buffer keeps its text). Otherwise propagate as a shell escape.
    if (key.escape) {
      if (slashCandidates.length > 0) {
        setSlashSelection(-1);
        return;
      }
      resetBuffer();
      void onInput({ type: "escape" });
      return;
    }

    // Navigation: arrow keys
    if (key.leftArrow) {
      if (key.ctrl || key.meta) {
        setBufferAndResetSelection(bufferWordLeft(buffer));
      } else {
        setBufferAndResetSelection(bufferMoveLeft(buffer));
      }
      return;
    }
    if (key.rightArrow) {
      if (key.ctrl || key.meta) {
        setBufferAndResetSelection(bufferWordRight(buffer));
      } else {
        setBufferAndResetSelection(bufferMoveRight(buffer));
      }
      return;
    }

    // Up arrow:
    //   - When slash candidates are visible: move selection up (wraps).
    //   - When buffer cursor is on a non-first line: move within buffer.
    //   - Otherwise: history navigation.
    if (key.upArrow) {
      if (slashCandidates.length > 0) {
        setSlashSelection((current) => {
          const safe = current < 0 ? 0 : current;
          return safe === 0 ? slashCandidates.length - 1 : safe - 1;
        });
        return;
      }
      const { row } = getCursorLinePosition(buffer, false);
      if (row > 0) {
        setBufferAndResetSelection(bufferMoveUp(buffer));
      } else {
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
      if (slashCandidates.length > 0) {
        setSlashSelection((current) => {
          const safe = current < 0 ? 0 : current;
          return safe >= slashCandidates.length - 1 ? 0 : safe + 1;
        });
        return;
      }
      const { row } = getCursorLinePosition(buffer, false);
      const totalLines = bufferToString(buffer).split("\n").length;
      if (row < totalLines - 1) {
        setBufferAndResetSelection(bufferMoveDown(buffer));
      } else {
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
      setBufferAndResetSelection(bufferHome(buffer));
      return;
    }
    if (key.ctrl && input === "e") {
      setBufferAndResetSelection(bufferEnd(buffer));
      return;
    }

    // Delete operations
    if (key.backspace || key.delete) {
      if (key.ctrl || key.meta) {
        setBufferAndResetSelection(bufferDeleteWordLeft(buffer));
      } else if (key.backspace) {
        setBufferAndResetSelection(bufferBackspace(buffer));
      } else {
        setBufferAndResetSelection(bufferDelete(buffer));
      }
      return;
    }

    // Ctrl+U: clear line
    if (key.ctrl && input === "u") {
      setBufferAndResetSelection(bufferClearLine(buffer));
      return;
    }

    // Ctrl+K: kill to end
    if (key.ctrl && input === "k") {
      setBufferAndResetSelection(bufferKillToEnd(buffer));
      return;
    }

    // Ctrl+W: delete word left
    if (key.ctrl && input === "w") {
      setBufferAndResetSelection(bufferDeleteWordLeft(buffer));
      return;
    }

    // Ignore other ctrl/meta sequences
    if (key.ctrl || key.meta) return;

    // Regular character input — ignore raw CR/LF (handled by return above)
    if (input && input !== "\r" && input !== "\n") {
      setBufferAndResetSelection(bufferInsert(buffer, input));
    }
  });

  // Render
  // Pick placeholder based on view mode and active flow:
  //   - permission: composer placeholder is the permission hint
  //   - setup active: composer placeholder is the per-step setup hint
  //   - task/pending: composer placeholder is taskPlaceholder
  //   - home: composer placeholder is the default placeholder
  const placeholderText =
    view.permission || view.composer.setupActive
      ? view.composer.placeholder
      : view.viewMode === "task" || view.viewMode === "pending"
        ? view.composer.taskPlaceholder
        : view.composer.placeholder;

  const { lines, truncatedCount, cursorCol, cursorRow } = formatComposerRenderLines({
    buffer,
    placeholder: placeholderText,
    masking: view.composer.masking,
    noColor,
    maxWidth,
  });

  // Position native cursor — anchored to Composer's outer Box via parent-chain
  // accumulation. Composer only declares row/col; absolute coordinates are
  // resolved by useAnchoredCursor against ink-root in the render phase.
  const declaredRow = cursorRow + (truncatedCount > 0 ? 1 : 0);
  useAnchoredCursor({ row: declaredRow, col: cursorCol }, anchorRef, capability);

  const placeholderColor = noColor ? undefined : "gray";
  const color = text ? undefined : placeholderColor;

  // Show slash suggestions only when we have candidates AND selection is not
  // explicitly hidden by Esc.
  const showSuggestions = slashCandidates.length > 0 && slashSelection >= 0;

  return (
    <Box flexDirection="column" width={maxWidth}>
      {showSuggestions ? (
        <SlashSuggestions
          candidates={slashCandidates}
          selectedIndex={slashSelectionClamped}
          theme={theme}
          language={view.language}
          width={maxWidth}
          hint={
            view.language === "en-US"
              ? "Tab accept · ↑↓ pick · Esc hide · Enter submit"
              : "Tab 选中 · ↑↓ 切换 · Esc 隐藏 · Enter 提交"
          }
        />
      ) : null}
      {view.composer.setupActive && view.composer.setupStep ? (
        <Text color={theme.warning}>{fitText(view.composer.setupStep, maxWidth)}</Text>
      ) : null}
      <Box ref={anchorRef} width="100%" flexDirection="column">
        {truncatedCount > 0 ? (
          <Text color="gray">
            {fitText(
              view.language === "en-US"
                ? `… ${truncatedCount} line(s) above`
                : `… 上面还有 ${truncatedCount} 行`,
              maxWidth,
            )}
          </Text>
        ) : null}
        {lines.map((line, index) => (
          <Text key={`${index}-${line}`} color={color} bold={Boolean(text)}>
            {fitText(line, maxWidth)}
          </Text>
        ))}
      </Box>
      {isSingleLineSlash && slashCandidates.length === 0 ? (
        <Text color={theme.muted}>
          {fitText(formatUnknownSlashCommand(text, view.language), maxWidth)}
        </Text>
      ) : null}
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
