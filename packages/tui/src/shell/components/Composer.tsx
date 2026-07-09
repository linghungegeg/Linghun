import { Box, type DOMElement, Text, useInput } from "@linghun/ink-runtime";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeGhostText } from "../../ghost-text.js";
import { resolveKeybinding } from "../../keybinding-runtime.js";
import { createPromptStash, toggleStash } from "../../prompt-stash.js";
import {
  formatUnknownSlashCommand,
  getCoreSlashCandidates,
  getSlashPrefixCandidates,
} from "../../slash-dispatch.js";
import { type UndoRing, createUndoRing, undoRingPop, undoRingPush } from "../../undo-ring.js";
import {
  classifyTerminalInput,
  isMultilineEnterSequence as isNormalizedMultilineEnterSequence,
  normalizeTerminalInput,
  sanitizeTerminalText,
} from "../models/terminal-input-runtime.js";
import type { TerminalCapability } from "../terminal-capability.js";
import { resolveTerminalInteractionModes } from "../terminal-interaction-runtime.js";
import { charWidth, computeWrappedInputState, fitText } from "../text-utils.js";
import { createShellTheme } from "../theme.js";
import type {
  CommandPanelView,
  PermissionActionId,
  ShellInputEvent,
  ShellViewModel,
  TaskPermissionView,
} from "../types.js";
import {
  SlashSuggestions,
  slashSuggestionRowCount,
} from "./SlashSuggestions.js";
import { useAnchoredCursor } from "./useAnchoredCursor.js";

type ComposerProps = {
  view: ShellViewModel;
  onInput: (event: ShellInputEvent) => void | Promise<void>;
  capability: TerminalCapability;
  layout?: ComposerLayout;
  composerMaxVisibleLines?: number;
  slashMaxRows?: number;
};

export type ComposerLayout = {
  width: number;
  paddingLeft: number;
  paddingRight: number;
  prefixWidth: number;
  minContentWidth: number;
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
  const { row, col } = getCursorLinePosition(buf);
  if (row === 0) return buf; // already on first line
  const lines = bufferToString(buf).split("\n");
  const targetLine = lines[row - 1] ?? "";
  const targetChars = Array.from(targetLine);
  const targetCol = Math.min(col, targetChars.length);
  let newCursor = 0;
  for (let i = 0; i < row - 1; i++) {
    newCursor += Array.from(lines[i] ?? "").length + 1; // +1 for \n
  }
  newCursor += targetCol;
  return { ...buf, cursor: newCursor };
}

/** Move cursor down one line, preserving column position (CJK-aware). */
export function bufferMoveDown(buf: EditBuffer): EditBuffer {
  const { row, col } = getCursorLinePosition(buf);
  const lines = bufferToString(buf).split("\n");
  if (row >= lines.length - 1) return buf; // already on last line
  const targetLine = lines[row + 1] ?? "";
  const targetChars = Array.from(targetLine);
  const targetCol = Math.min(col, targetChars.length);
  let newCursor = 0;
  for (let i = 0; i <= row; i++) {
    newCursor += Array.from(lines[i] ?? "").length + 1; // +1 for \n
  }
  newCursor += targetCol;
  return { ...buf, cursor: newCursor };
}

type VisualLine = {
  rawLineIndex: number;
  startChar: number;
  endChar: number;
  absoluteStart: number;
  promptWidth: number;
};

/** Move cursor up one soft-wrapped visual row, preserving display column. */
export function bufferMoveVisualUp(buf: EditBuffer, maxWidth?: number): EditBuffer {
  return bufferMoveVisual(buf, maxWidth, -1);
}

/** Move cursor down one soft-wrapped visual row, preserving display column. */
export function bufferMoveVisualDown(buf: EditBuffer, maxWidth?: number): EditBuffer {
  return bufferMoveVisual(buf, maxWidth, 1);
}

function bufferMoveVisual(
  buf: EditBuffer,
  maxWidth: number | undefined,
  delta: -1 | 1,
): EditBuffer {
  const visual = getVisualLinePosition(buf, maxWidth);
  const target = visual.lines[visual.index + delta];
  if (!target) return buf;
  const cursorCol = Math.max(0, visual.cursorDisplayCol - visual.current.promptWidth);
  const targetText = getRawLineText(buf, target.rawLineIndex);
  const targetChars = Array.from(targetText).slice(target.startChar, target.endChar);
  let used = 0;
  let offset = 0;
  for (; offset < targetChars.length; offset++) {
    const next = charWidth(targetChars[offset] ?? "");
    if (used + next > cursorCol) break;
    used += next;
  }
  return { ...buf, cursor: target.absoluteStart + offset };
}

function getVisualLinePosition(
  buf: EditBuffer,
  maxWidth?: number,
): { lines: VisualLine[]; index: number; current: VisualLine; cursorDisplayCol: number } {
  const lines = buildVisualLines(buf, maxWidth);
  const fallback = lines[0] ?? {
    rawLineIndex: 0,
    startChar: 0,
    endChar: 0,
    absoluteStart: 0,
    promptWidth: displayWidthOf(PROMPT_MARKER),
  };
  let index = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? fallback;
    const lineEnd = line.absoluteStart + line.endChar - line.startChar;
    const nextLine = lines[i + 1];
    const wrapsToNextVisualLine = nextLine?.rawLineIndex === line.rawLineIndex;
    if (
      buf.cursor >= line.absoluteStart &&
      (wrapsToNextVisualLine ? buf.cursor < lineEnd : buf.cursor <= lineEnd)
    ) {
      index = i;
      break;
    }
  }
  const current = lines[index] ?? fallback;
  let cursorDisplayCol = current.promptWidth;
  const inLineOffset = Math.max(0, buf.cursor - current.absoluteStart);
  const rawLine = getRawLineText(buf, current.rawLineIndex);
  const chars = Array.from(rawLine).slice(current.startChar, current.startChar + inLineOffset);
  for (const ch of chars) cursorDisplayCol += charWidth(ch);
  return { lines, index, current, cursorDisplayCol };
}

function buildVisualLines(buf: EditBuffer, maxWidth?: number): VisualLine[] {
  const rawLines = bufferToString(buf).split("\n");
  const composerWidth = Math.max(8, maxWidth ?? 80);
  const result: VisualLine[] = [];
  let absoluteLineStart = 0;
  for (let rawIndex = 0; rawIndex < rawLines.length; rawIndex++) {
    const rawLine = rawLines[rawIndex] ?? "";
    const chars = Array.from(rawLine);
    const isFirstRawLine = rawIndex === 0;
    let startChar = 0;
    while (startChar < chars.length || (chars.length === 0 && startChar === 0)) {
      const prompt = isFirstRawLine && startChar === 0 ? PROMPT_MARKER : "";
      const promptWidth = displayWidthOf(prompt);
      const budget = Math.max(4, composerWidth - promptWidth);
      let width = 0;
      let endChar = startChar;
      while (endChar < chars.length) {
        const next = charWidth(chars[endChar] ?? "");
        if (width > 0 && width + next > budget) break;
        width += next;
        endChar++;
      }
      if (endChar === startChar && chars.length > 0) endChar++;
      result.push({
        rawLineIndex: rawIndex,
        startChar,
        endChar,
        absoluteStart: absoluteLineStart + startChar,
        promptWidth,
      });
      if (chars.length === 0) break;
      startChar = endChar;
    }
    absoluteLineStart += chars.length + 1;
  }
  return result;
}

function getRawLineText(buf: EditBuffer, rawLineIndex: number): string {
  return bufferToString(buf).split("\n")[rawLineIndex] ?? "";
}

function isWordBoundary(ch: string): boolean {
  return /[\s\p{P}]/u.test(ch);
}

export function sanitizeComposerInput(value: string): string {
  return sanitizeTerminalText(value);
}

export function sanitizeComposerPasteInput(value: string): string {
  const sanitized = sanitizeComposerInput(value);
  return sanitized
    .replace(/[ \t\f\v]+\n/g, "\n")
    .replace(/\n[ \t\f\v]+/g, "\n")
    .replace(/[ \t\f\v]{2,}/g, " ")
    .replace(/[ \t\f\v]+\n[ \t\f\v]*/g, "\n")
    .replace(/[ \t\f\v]+$/g, "");
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
// Owner-priority dispatcher pure helpers (exported for tests)
// ---------------------------------------------------------------------------

/**
 * 判断当前 useInput 事件是否应当走 paste 聚合路径。
 * - 若 paste 已在 pending 中，且当前事件不是 ctrl/meta/escape/tab，且 input 非空，则继续聚合。
 * - 若单次 chunk 长度超过阈值（标准 ink@7 fallback），视作粘贴。
 *
 * 决策不依赖 React state，单纯由 (input, key, pasteState) 决定，便于单测。
 */
export function shouldEnterPastePath(
  input: string,
  key: {
    ctrl?: boolean;
    meta?: boolean;
    escape?: boolean;
    tab?: boolean;
    return?: boolean;
  },
  pastePending: boolean,
): boolean {
  if (input.length > PASTE_THRESHOLD) return true;
  if (
    pastePending &&
    input.length > 0 &&
    !key.ctrl &&
    !key.meta &&
    !key.escape &&
    !key.tab &&
    !key.return
  ) {
    return true;
  }
  return false;
}

export type InputOwner = "permission" | "panel" | "paste" | "slash" | "composer";

export type OwnerKeyShape = {
  ctrl?: boolean;
  meta?: boolean;
  escape?: boolean;
  tab?: boolean;
  return?: boolean;
  shift?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
};

export type OwnerContext = {
  permissionActive: boolean;
  panelActive?: boolean;
  panelInteractive?: boolean;
  panelNumericShortcuts?: boolean;
  panelSpaceAction?: boolean;
  pastePending: boolean;
  slashVisible: boolean;
};

export function selectInputOwner(input: string, key: OwnerKeyShape, ctx: OwnerContext): InputOwner {
  if (ctx.permissionActive) return "permission";
  if (ctx.panelActive === true && isPanelOwnerKey(input, key, ctx)) return "panel";
  if (ctx.pastePending && (key.return || key.escape)) return "paste";
  if (shouldEnterPastePath(input, key, ctx.pastePending)) return "paste";
  if (ctx.slashVisible && isSlashOwnerKey(input, key)) return "slash";
  return "composer";
}

function isPanelOwnerKey(input: string, key: OwnerKeyShape, ctx: OwnerContext): boolean {
  if (key.escape) return true;
  if (ctx.panelInteractive !== true) return false;
  if (isModifiedEnter(input, key)) return false;
  if (key.return || key.tab || key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) {
    return true;
  }
  if (ctx.panelNumericShortcuts && /^[1-9]$/.test(input) && !key.ctrl && !key.meta) return true;
  if (ctx.panelSpaceAction && input === " " && !key.ctrl && !key.meta) return true;
  return input.toLowerCase() === "x" && !key.ctrl && !key.meta;
}

function isSlashOwnerKey(input: string, key: OwnerKeyShape): boolean {
  return Boolean(
    (key.return && !isModifiedEnter(input, key)) ||
      key.escape ||
      key.tab ||
      key.upArrow ||
      key.downArrow,
  );
}

function isModifiedEnter(input: string, key: OwnerKeyShape): boolean {
  return Boolean(
    key.return && (key.shift || key.meta) && input.length > 0 && input !== "\r" && input !== "\n",
  );
}

export function isNavigationKey(key: OwnerKeyShape): boolean {
  return Boolean(key.upArrow || key.downArrow || key.leftArrow || key.rightArrow);
}

export function isVerticalNavigationKey(key: OwnerKeyShape): boolean {
  return Boolean(key.upArrow || key.downArrow);
}

export const OWNER_PRIORITY: ReadonlyArray<InputOwner> = [
  "permission",
  "panel",
  "paste",
  "slash",
  "composer",
];

export const shouldOwnerBePaste = shouldEnterPastePath;

/**
 * 判断双击窗口（Esc / Ctrl+C 二次清空）是否命中。
 * 命中时视作"清空"动作；未命中视作"提示"动作。
 */
export function isDoublePressWithin(
  lastPressAt: number,
  now: number,
  windowMs = DOUBLE_PRESS_WINDOW_MS,
): boolean {
  if (lastPressAt <= 0) return false;
  return now - lastPressAt < windowMs;
}

/**
 * Slash hidden 粘性：若文本不再以 "/" 开头，或 head 改变，则取消粘性。
 */
export function shouldUnstickSlashHidden(
  prevHead: string,
  nextText: string,
  nextHead: string,
): boolean {
  if (!nextText.startsWith("/")) return true;
  return prevHead !== nextHead;
}

export function isMultilineEnterSequence(input: string): boolean {
  return isNormalizedMultilineEnterSequence(input);
}

const COMPOSER_MAX_VISIBLE_LINES = 5;
const PROMPT_MARKER = "› ";

const PERMISSION_ACTION_ORDER: PermissionActionId[] = [
  "allow_once",
  "allow_always_tool",
  "deny",
  "details",
];

// D.13Q-UX Real Smoke Fix v2 — E. 旧的 PERMISSION_TEXT_MAP 把 PermissionActionId
// 序列化为 yes / no / allow_once 文本，再通过 submit 文本路径上抛（让用户
// 输入区里冒出 yes / allow_once 当成自然语言）。新路径直接派发结构化的
// permission-action 事件，不再需要这张表，因此移除。

// ---------------------------------------------------------------------------
// Owner-priority dispatcher constants
// ---------------------------------------------------------------------------
// PASTE_THRESHOLD: 单次 useInput 的 input.length 超过该阈值 → 视作粘贴片段。
// 标准 ink@7 不暴露 event.keypress.isPasted（CCB 用的是 @anthropic 私有 fork），
// 所以只能通过 chunk 大小 + 100ms 聚合窗口降级识别 bracketed paste。
const PASTE_THRESHOLD = 16;
export const OWNER_PASTE_THRESHOLD = PASTE_THRESHOLD;
const PASTE_COMPLETION_TIMEOUT_MS = 100;
// DOUBLE_PRESS_WINDOW_MS: 双击 Esc / Ctrl+C 的有效窗口（CCB ~1s）。
const DOUBLE_PRESS_WINDOW_MS = 1000;
const HINT_NOTICE_DECAY_MS = 1500;
const INLINE_CURSOR_BLINK_MS = 530;

export function Composer({
  view,
  onInput,
  capability,
  layout,
  composerMaxVisibleLines,
  slashMaxRows: slashMaxRowsProp,
}: ComposerProps): React.ReactNode {
  const [buffer, setBuffer] = useState<EditBuffer>(
    createEditBuffer(view.composer.draftText ?? ""),
  );
  const bufferRef = useRef<EditBuffer>(buffer);
  const [slashSelection, setSlashSelection] = useState(0);
  const [slashHidden, setSlashHidden] = useState(false);
  const [permissionFocus, setPermissionFocus] = useState<PermissionActionId>("allow_once");
  const [hintNotice, setHintNotice] = useState<string | undefined>(undefined);
  const [cursorBlinkOn, setCursorBlinkOn] = useState(true);
  const historyRef = useRef<InputHistory>(createInputHistory());
  const pasteChunksRef = useRef<string[]>([]);
  const pasteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pastePendingRef = useRef(false);
  const focusReportPrefixPendingRef = useRef(false);
  const lastEscAtRef = useRef(0);
  const lastCtrlCAtRef = useRef(0);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chordBufferRef = useRef<string[]>([]);
  const undoRingRef = useRef<UndoRing>(createUndoRing());
  const stashRef = useRef(createPromptStash());
  const composerLayout = useMemo(
    () =>
      layout ?? {
        width: Math.max(40, view.width - 6),
        paddingLeft: 2,
        paddingRight: 2,
        prefixWidth: displayWidthOf(PROMPT_MARKER),
        minContentWidth: 4,
      },
    [layout, view.width],
  );
  const maxWidth = composerLayout.width;
  const noColor = view.themeMode === "no-color";
  const theme = useMemo(() => createShellTheme(noColor), [noColor]);
  const anchorRef = useRef<DOMElement | null>(null);
  const emitInput = useCallback(
    (event: ShellInputEvent) => {
      Promise.resolve(onInput(event)).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        setHintNotice(message);
      });
    },
    [onInput],
  );

  // Permission active = a permission card is on screen and the composer is in
  // selector mode (key bindings change; ordinary chars do NOT enter the buffer).
  const permissionActive = Boolean(view.permission);
  const permissionActions = useMemo(
    () => buildPermissionActions(view.language, view.permission?.actions),
    [view.language, view.permission],
  );

  const configPanelActive = Boolean(
    view.configPanel ||
      view.helpPanel ||
      view.btwPanel ||
      view.sessionsPanel ||
      view.backgroundTaskOverlay ||
      view.historySearchPanel ||
      view.shortcutPanel,
  );
  const terminalInteractionModes = useMemo(
    () => resolveTerminalInteractionModes({ capability, appOwnedScreen: false }),
    [capability],
  );

  const text = bufferToString(buffer);
  const composerDraftRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (composerDraftRef.current === text) return;
    composerDraftRef.current = text;
    emitInput({ type: "composer-draft-change", text });
  }, [emitInput, text]);
  const commandPanelActive = Boolean(view.commandPanel);
  const commandPanelConsumesInput = hasSelectableCommandPanelRows(view.commandPanel);
  const slashHeadCurrent = useMemo(() => slashHead(text), [text]);
  // Slash candidates surface in two cases:
  //   1. Bare "/" — show the core 5 entries as a soft onboarding affordance.
  //   2. "/<prefix>" with at least one non-slash char — prefix-match candidates.
  // "/?" is reserved for inline help and never triggers candidates here.
  const isBareSlash = !permissionActive && text === "/";
  const isSingleLineSlash =
    !permissionActive &&
    text.startsWith("/") &&
    !text.includes("\n") &&
    text.length >= 2 &&
    text !== "/?";
  const slashCandidates = useMemo(() => {
    if (isBareSlash) return getCoreSlashCandidates();
    if (isSingleLineSlash) return getSlashPrefixCandidates(slashHeadCurrent);
    return [];
  }, [isBareSlash, isSingleLineSlash, slashHeadCurrent]);
  // slashHidden 在 head 不再以 "/" 开头时强制还原。head 改变（"/m" → "/me"）也还原。
  const lastSlashHeadRef = useRef(slashHeadCurrent);
  useEffect(() => {
    if (!text.startsWith("/")) {
      if (slashHidden) setSlashHidden(false);
      lastSlashHeadRef.current = slashHeadCurrent;
      return;
    }
    if (lastSlashHeadRef.current !== slashHeadCurrent) {
      if (slashHidden) setSlashHidden(false);
      lastSlashHeadRef.current = slashHeadCurrent;
    }
  }, [text, slashHeadCurrent, slashHidden]);
  const slashSelectionClamped =
    slashCandidates.length === 0
      ? 0
      : Math.max(0, Math.min(slashSelection, slashCandidates.length - 1));

  const resetBuffer = useCallback((nextText = "") => {
    const next = createEditBuffer(nextText);
    bufferRef.current = next;
    setBuffer(next);
    setSlashSelection(0);
  }, []);

  const setBufferAndResetSelection = useCallback((next: EditBuffer) => {
    undoRingRef.current = undoRingPush(undoRingRef.current, bufferRef.current);
    bufferRef.current = next;
    setBuffer(next);
    setSlashSelection(0);
  }, []);
  const updateBufferAndResetSelection = useCallback(
    (update: (current: EditBuffer) => EditBuffer) => {
      undoRingRef.current = undoRingPush(undoRingRef.current, bufferRef.current);
      const next = update(bufferRef.current);
      bufferRef.current = next;
      setBuffer(next);
      setSlashSelection(0);
    },
    [],
  );

  const submitPermissionAction = useCallback(
    (id: PermissionActionId) => {
      // D.13Q-UX Real Smoke Fix v2 — E. 全部走结构化 permission-action 事件，
      // 不再把 yes / allow_once / allow_always_tool / no 这类内部 id 当成 text
      // 通过 submit 文本路径回灌（避免被 handleNaturalInput 当用户正常发言）。
      // cancel 仍上抛 escape 关闭面板（与既有交互链兼容）。
      if (id === "cancel") {
        emitInput({ type: "escape" });
        return;
      }
      emitInput({ type: "permission-action", actionId: id });
    },
    [emitInput],
  );

  // 提示通知（Esc again to clear / Ctrl+C again to clear）
  const showHintNotice = useCallback((notice: string) => {
    setHintNotice(notice);
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    hintTimerRef.current = setTimeout(() => {
      setHintNotice(undefined);
      hintTimerRef.current = null;
    }, HINT_NOTICE_DECAY_MS);
  }, []);

  const clearHintNotice = useCallback(() => {
    if (hintTimerRef.current) {
      clearTimeout(hintTimerRef.current);
      hintTimerRef.current = null;
    }
    setHintNotice(undefined);
  }, []);

  // Paste 聚合：100ms 内连续到达的大 chunk 合并为一次 buffer 插入。
  // 提交 Enter 在 pending 期间被吞，避免多行粘贴尾部 \r 触发误提交。
  const flushPaste = useCallback(() => {
    const chunks = pasteChunksRef.current;
    pasteChunksRef.current = [];
    if (pasteTimerRef.current) {
      clearTimeout(pasteTimerRef.current);
      pasteTimerRef.current = null;
    }
    pastePendingRef.current = false;
    if (chunks.length === 0) return;
    const joined = sanitizeComposerPasteInput(chunks.join(""));
    if (!joined) return;
    const next = bufferInsert(bufferRef.current, joined);
    bufferRef.current = next;
    setBuffer(next);
    setSlashSelection(0);
  }, []);

  const cancelPaste = useCallback(() => {
    pasteChunksRef.current = [];
    if (pasteTimerRef.current) {
      clearTimeout(pasteTimerRef.current);
      pasteTimerRef.current = null;
    }
    pastePendingRef.current = false;
  }, []);

  const enqueuePasteChunk = useCallback(
    (chunk: string) => {
      pasteChunksRef.current.push(chunk);
      pastePendingRef.current = true;
      if (pasteTimerRef.current) clearTimeout(pasteTimerRef.current);
      pasteTimerRef.current = setTimeout(flushPaste, PASTE_COMPLETION_TIMEOUT_MS);
    },
    [flushPaste],
  );

  // 卸载时清理所有 timer，避免内存泄漏。
  useEffect(() => {
    return () => {
      if (pasteTimerRef.current) clearTimeout(pasteTimerRef.current);
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (permissionActive) return;
    setCursorBlinkOn(true);
    const timer = setInterval(() => {
      setCursorBlinkOn((current) => !current);
    }, INLINE_CURSOR_BLINK_MS);
    return () => clearInterval(timer);
  }, [permissionActive]);

  useInput(
    (input, key) => {
      if (input === "\x1B[I" || input === "\x1B[O" || input === "[I" || input === "[O") {
        focusReportPrefixPendingRef.current = false;
        return;
      }
      if (input === "\x1B[") {
        focusReportPrefixPendingRef.current = true;
        return;
      }
      if (focusReportPrefixPendingRef.current) {
        focusReportPrefixPendingRef.current = false;
        if (input === "I" || input === "O") return;
      }
      if (classifyTerminalInput(input) !== "keyboard") return;

      const buffer = bufferRef.current;
      const text = bufferToString(buffer);
      const terminalAction = normalizeTerminalInput(input, key);
      const longInputChip = getComposerLongInputChipState({
        buffer,
        maxWidth,
        layout: composerLayout,
        maxVisibleLines: composerMaxVisibleLines,
      });
      // D.13E Step 2 — Owner-priority dispatcher 显式化：
      // 用 selectInputOwner 决定本次事件归属，permission > panel > paste > slash > composer。
      const owner = selectInputOwner(input, key, {
        permissionActive,
        panelActive: configPanelActive || commandPanelActive,
        panelInteractive: Boolean(
          view.configPanel ||
            view.helpPanel ||
            view.btwPanel ||
            view.sessionsPanel ||
            view.backgroundTaskOverlay ||
            view.historySearchPanel ||
            view.shortcutPanel ||
            view.commandPanel ||
            commandPanelConsumesInput,
        ),
        panelNumericShortcuts: Boolean(view.helpPanel),
        panelSpaceAction: Boolean(view.btwPanel),
        pastePending: pastePendingRef.current,
        slashVisible: slashCandidates.length > 0 && !slashHidden,
      });
      if (!permissionActive) {
        const binding = resolveKeybinding(
          view.keybindings ?? [],
          "chat",
          {
            input,
            ctrl: key.ctrl,
            meta: key.meta,
            shift: key.shift,
            tab: key.tab,
            escape: key.escape,
            return: key.return,
            backspace: key.backspace,
            delete: key.delete,
          },
          chordBufferRef.current,
        );
        chordBufferRef.current = binding.chordBuffer;
        if (binding.pending) return;
        if (binding.action === "toggle-details") {
          clearHintNotice();
          emitInput({ type: "toggle-details" });
          return;
        }
        if (binding.action === "cycle-permission-mode") {
          emitInput({ type: "cycle-permission-mode" });
          return;
        }
        if (binding.action === "clear-line") {
          setBufferAndResetSelection(bufferClearLine(buffer));
          return;
        }
        if (binding.action === "delete-word-left") {
          setBufferAndResetSelection(bufferDeleteWordLeft(buffer));
          return;
        }
        if (binding.action === "history-search") {
          emitInput({ type: "history-search-open" });
          return;
        }
        if (binding.action === "undo") {
          const result = undoRingPop(undoRingRef.current);
          undoRingRef.current = result.ring;
          if (result.buffer) {
            bufferRef.current = result.buffer;
            setBuffer(result.buffer);
            setSlashSelection(0);
          }
          return;
        }
        if (binding.action === "stash") {
          const currentText = bufferToString(bufferRef.current);
          const result = toggleStash(stashRef.current, currentText);
          stashRef.current = result.stash;
          if (result.bufferText !== undefined) {
            resetBuffer(result.bufferText);
          }
          return;
        }
        if (binding.action === "external-editor") {
          emitInput({ type: "external-editor" });
          return;
        }
        if (binding.action === "shortcuts-panel") {
          if (bufferToString(bufferRef.current).length === 0) {
            emitInput({ type: "shortcuts-panel-open" });
            return;
          }
        }
      }

      if (
        !permissionActive &&
        key.downArrow &&
        key.shift &&
        (view.viewMode === "task" || view.viewMode === "pending")
      ) {
        emitInput({ type: "background-overlay-open" });
        return;
      }

      // Ctrl+Shift+C — copy current transcript selection to clipboard.
      if (key.ctrl && key.shift && input.toLowerCase() === "c") {
        emitInput({ type: "copy-selection" });
        return;
      }

      // ─── 1. Permission selector mode（最高优先级）────────────────────────
      if (owner === "permission") {
        if (key.escape) {
          submitPermissionAction("cancel");
          return;
        }
        if (key.return) {
          submitPermissionAction(permissionFocus);
          return;
        }
        if (key.tab && !key.shift) {
          setPermissionFocus(cyclePermissionFocus(permissionActions, permissionFocus, 1));
          return;
        }
        if (key.tab && key.shift) {
          setPermissionFocus(cyclePermissionFocus(permissionActions, permissionFocus, -1));
          return;
        }
        if (key.leftArrow || key.upArrow) {
          setPermissionFocus(cyclePermissionFocus(permissionActions, permissionFocus, -1));
          return;
        }
        if (key.rightArrow || key.downArrow) {
          setPermissionFocus(cyclePermissionFocus(permissionActions, permissionFocus, 1));
          return;
        }
        if (!key.ctrl && !key.meta && input && input.length === 1) {
          const lower = input.toLowerCase();
          // D.13L Block E — 权限卡 3 档（与 CCB 对齐）单字母快捷键：
          //   y → allow_once（本次允许；旧 yes 别名同义）
          //   a → allow_always_tool（项目级 allow rule + 当次 approve）
          //   n → deny（拒绝；旧 no 别名同义）
          //   d → details（查看详情）
          if (lower === "y") {
            submitPermissionAction(resolveActionId(permissionActions, "allow_once", "yes"));
            return;
          }
          if (lower === "a") {
            if (permissionActions.some((act) => act.id === "allow_always_tool")) {
              submitPermissionAction("allow_always_tool");
              return;
            }
          }
          if (lower === "n") {
            submitPermissionAction(resolveActionId(permissionActions, "deny", "no"));
            return;
          }
          if (lower === "d") {
            submitPermissionAction("details");
            return;
          }
        }
        // 其他按键吞掉，避免 buffer 被污染。
        return;
      }

      // ─── 2. Panel layer keys ───────────────────────────────────────────
      if (owner === "panel") {
        if (key.escape) {
          if (view.helpPanel) emitInput({ type: "help-close" });
          else if (view.btwPanel) emitInput({ type: "btw-close" });
          else if (view.sessionsPanel) emitInput({ type: "sessions-close" });
          else if (view.backgroundTaskOverlay) emitInput({ type: "background-overlay-close" });
          else if (view.historySearchPanel) emitInput({ type: "history-search-close" });
          else if (view.shortcutPanel) emitInput({ type: "shortcuts-panel-close" });
          else if (view.configPanel) emitInput({ type: "config-back" });
          else if (view.commandPanel) emitInput({ type: "command-panel-close" });
          else emitInput({ type: "escape" });
          return;
        }
        if (view.historySearchPanel) {
          if (key.return) emitInput({ type: "history-search-accept" });
          else if (key.upArrow) emitInput({ type: "history-search-move", delta: -1 });
          else if (key.downArrow) emitInput({ type: "history-search-move", delta: 1 });
          else if (!key.ctrl && !key.meta && input.length > 0 && !key.return && !key.tab) {
            const newQuery = (view.historySearchPanel.query ?? "") + input;
            emitInput({ type: "history-search-input", query: newQuery });
          } else if (key.backspace) {
            const currentQuery = view.historySearchPanel.query ?? "";
            emitInput({ type: "history-search-input", query: currentQuery.slice(0, -1) });
          }
          return;
        }
        if (view.shortcutPanel) {
          emitInput({ type: "shortcuts-panel-close" });
          return;
        }
        if (view.helpPanel) {
          if (!key.ctrl && !key.meta && /^[1-9]$/.test(input)) {
            const idx = Number(input) - 1;
            if (idx < view.helpPanel.entries.length) {
              emitInput({ type: "help-select", index: idx });
            }
          } else if (key.return) emitInput({ type: "help-enter" });
          else if (key.upArrow) emitInput({ type: "help-move", delta: -1 });
          else if (key.downArrow) emitInput({ type: "help-move", delta: 1 });
          else if (key.tab || key.rightArrow) emitInput({ type: "help-switch-group", delta: 1 });
          else if (key.leftArrow) emitInput({ type: "help-switch-group", delta: -1 });
          return;
        }
        if (view.btwPanel) {
          if (key.return || input === " ") emitInput({ type: "btw-close" });
          return;
        }
        if (view.configPanel) {
          if (key.return) {
            if (view.configPanel.phase === "panel_list") {
              const selected = view.configPanel.panels[view.configPanel.cursor];
              if (selected) {
                // Panels with detail actions (language toggle) need config-enter;
                // all others dispatch slash command directly.
                if (selected.id === "language") {
                  emitInput({ type: "config-enter" });
                } else {
                  emitInput({ type: "config-submit", command: selected.slash });
                }
              }
            } else {
              const action = view.configPanel.actions[view.configPanel.actionCursor];
              if (action) emitInput({ type: "config-submit", command: action.id });
            }
          } else if (key.upArrow) emitInput({ type: "config-move", delta: -1 });
          else if (key.downArrow) emitInput({ type: "config-move", delta: 1 });
          return;
        }
        if (view.sessionsPanel) {
          // Phase 8: search mode routes all input to search box.
          if (view.sessionsPanel.mode === "search") {
            if (key.escape) emitInput({ type: "sessions-search-close" });
            else if (key.return) emitInput({ type: "sessions-search-close" });
            else if (key.backspace || key.delete) emitInput({ type: "sessions-search-delete" });
            else if (input && !key.ctrl && !key.meta && !key.tab) {
              emitInput({ type: "sessions-search-input", input });
            }
            return;
          }
          // Phase 8: preview mode — only Esc to return to list.
          if (view.sessionsPanel.mode === "preview") {
            if (key.escape) emitInput({ type: "sessions-preview-close" });
            return;
          }
          // List mode: navigation + enter search/preview.
          if (key.return) emitInput({ type: "sessions-resume" });
          else if (key.upArrow) emitInput({ type: "sessions-move", delta: -1 });
          else if (key.downArrow) emitInput({ type: "sessions-move", delta: 1 });
          else if (input === "/" && !key.ctrl && !key.meta) {
            emitInput({ type: "sessions-search" });
          } else if (input === "v" && key.ctrl) {
            emitInput({ type: "sessions-preview" });
          }
          return;
        }
        if (view.backgroundTaskOverlay) {
          if (key.upArrow) emitInput({ type: "background-overlay-move", delta: -1 });
          else if (key.downArrow) emitInput({ type: "background-overlay-move", delta: 1 });
          else if (key.return) emitInput({ type: "background-overlay-toggle" });
          else if (input.toLowerCase() === "x" && !key.ctrl && !key.meta) {
            emitInput({ type: "background-overlay-stop" });
          }
          return;
        }
        if (commandPanelConsumesInput) {
          if (key.upArrow) {
            emitInput({ type: "command-panel-move", delta: -1 });
            return;
          }
          if (key.downArrow) {
            emitInput({ type: "command-panel-move", delta: 1 });
            return;
          }
          if (key.return) {
            emitInput({ type: "command-panel-toggle" });
            return;
          }
          if (input.toLowerCase() === "x" && !key.ctrl && !key.meta) {
            emitInput({ type: "command-panel-stop" });
            return;
          }
          return;
        }
        if (view.commandPanel) return;
      }
      if (configPanelActive) return;

      // ─── 3. Paste 聚合（次高优先级）────────────────────────────────────
      // owner === "paste" 表示进入 paste 路径，包含 pending 期 Enter / Esc /
      // 普通字符聚合 / 大 chunk 4 种情况。
      if (owner === "paste") {
        // pending 期间 Enter 被吞掉（CCB BaseTextInput 的 paste-blocks-Enter 模式）。
        if (pastePendingRef.current && key.return) {
          enqueuePasteChunk("");
          return;
        }
        // pending 期间 Esc 主动取消粘贴。
        if (pastePendingRef.current && key.escape) {
          cancelPaste();
          return;
        }
        enqueuePasteChunk(input);
        return;
      }

      // ─── 4. Slash candidates owner（统一消费并 return；禁止 fall-through）────
      const slashVisible = slashCandidates.length > 0 && !slashHidden;
      if (owner === "slash") {
        if (terminalAction.type === "newline") {
          updateBufferAndResetSelection((current) => bufferInsert(current, "\n"));
          return;
        }
        if (key.escape) {
          setSlashHidden(true);
          setSlashSelection(-1);
          return;
        }
        if (key.tab && !key.shift) {
          if (slashSelection >= 0) {
            const picked = slashCandidates[slashSelectionClamped];
            if (picked) {
              const spaceIndex = text.indexOf(" ");
              const args = spaceIndex >= 0 ? text.slice(spaceIndex) : "";
              const next = args ? `${picked.slash}${args}` : `${picked.slash} `;
              resetBuffer(next);
              setSlashHidden(false);
              return;
            }
          }
          return;
        }
        if (key.upArrow) {
          if (slashSelection >= 0) {
            setSlashSelection((current) => {
              const safe = current < 0 ? 0 : current;
              return safe === 0 ? slashCandidates.length - 1 : safe - 1;
            });
          }
          return;
        }
        if (key.downArrow) {
          if (slashSelection >= 0) {
            setSlashSelection((current) => {
              const safe = current < 0 ? 0 : current;
              return safe >= slashCandidates.length - 1 ? 0 : safe + 1;
            });
          }
          return;
        }
        if (key.return) {
          if (slashSelection >= 0 && !text.includes(" ")) {
            const picked = slashCandidates[slashSelectionClamped];
            if (picked && picked.slash !== text) {
              const submitText = picked.slash;
              historyRef.current = historyAdd(historyRef.current, submitText);
              resetBuffer();
              setSlashHidden(false);
              clearHintNotice();
              emitInput({ type: "submit", text: submitText });
              return;
            }
          }
          const submitText = text.trim();
          historyRef.current = historyAdd(historyRef.current, text);
          resetBuffer();
          setSlashHidden(false);
          clearHintNotice();
          emitInput(submitText ? { type: "submit", text: submitText } : { type: "empty-submit" });
          return;
        }
        // 兜底 — slash owner 内未命中明确分支：吞掉，避免 fall-through 到 composer。
        return;
      }

      // ─── 4. Composer default owner ────────────────────────────────────────

      // Main transcript scroll keys（PageUp / PageDown / Home / End）。
      // 仅在 task / pending 模式生效；home 模式无 transcript 滚动需求。
      // 事件只表达用户意图，页大小/夹紧/吸底由 transcript-scroll-state 统一计算。
      const inTaskMode = view.viewMode === "task" || view.viewMode === "pending";
      const k = key as { pageUp?: boolean; pageDown?: boolean; end?: boolean; home?: boolean };
      if (inTaskMode && k.pageUp) {
        emitInput({ type: "transcript-scroll", action: "halfPageUp" });
        return;
      }
      if (inTaskMode && k.pageDown) {
        emitInput({ type: "transcript-scroll", action: "halfPageDown" });
        return;
      }
      if (inTaskMode && k.home && text.length === 0) {
        emitInput({ type: "transcript-scroll", action: "top" });
        return;
      }
      if (inTaskMode && k.end && text.length === 0) {
        emitInput({ type: "transcript-scroll", action: "bottom" });
        return;
      }

      if (terminalAction.type === "newline") {
        updateBufferAndResetSelection((current) => bufferInsert(current, "\n"));
        return;
      }
      if (key.return && text.endsWith("\\")) {
        const withoutBackslash: EditBuffer = {
          chars: buffer.chars.slice(0, -1),
          cursor: Math.max(0, buffer.cursor - 1),
        };
        setBufferAndResetSelection(bufferInsert(withoutBackslash, "\n"));
        return;
      }

      // ─── Submit: Enter（无 shift / fallback modifier）──────────────────
      if (key.return) {
        if (text.length === 0 && view.agentProgressTree && view.agentProgressTree.cursor >= 0) {
          emitInput({ type: "agent-tree-enter" });
          return;
        }
        if (text.length === 0 && view.taskSuggestions && view.taskSuggestions.length > 0) {
          const index = Math.max(
            0,
            Math.min(view.taskSuggestionCursor ?? 0, view.taskSuggestions.length - 1),
          );
          const suggestion = view.taskSuggestions[index];
          if (suggestion) {
            emitInput({ type: "task-suggestion-action", suggestionId: suggestion.id });
            return;
          }
        }
        // D.13Q-UX Real Smoke Fix v2 — D. busy guard：模型仍在处理上一条时
        // Enter 不提交、不清空 buffer，仅显示一行轻提示。Ctrl+C 双击清空 / 上抛
        // interrupt 由现有分支接管，不在这里处理。slash command / setup flow
        // 走自己的 submit 路径，不受 busy 限制（slash 通常是控制类命令；setup
        // flow 在 busy 之前就完成）。
        const isSlashSubmit = text.startsWith("/");
        const setupActive = view.composer.setupActive;
        if (view.composer.busy && !isSlashSubmit && !setupActive) {
          showHintNotice(
            view.composer.busyHint ??
              (view.language === "en-US"
                ? "Still working on the previous request. Press Ctrl+C to interrupt, then send again."
                : "正在处理上一条，按 Ctrl+C 可中断，稍后再发。"),
          );
          return;
        }
        // slash 可见且光标只在 head 上 → 接受候选再提交。
        if (slashVisible && slashSelection >= 0 && !text.includes(" ")) {
          const picked = slashCandidates[slashSelectionClamped];
          if (picked && picked.slash !== text) {
            const submitText = picked.slash;
            historyRef.current = historyAdd(historyRef.current, submitText);
            resetBuffer();
            setSlashHidden(false);
            clearHintNotice();
            emitInput({ type: "submit", text: submitText });
            return;
          }
        }
        const submitText = text.trim();
        historyRef.current = historyAdd(historyRef.current, text);
        resetBuffer();
        setSlashHidden(false);
        clearHintNotice();
        emitInput(submitText ? { type: "submit", text: submitText } : { type: "empty-submit" });
        return;
      }

      // Tab — 接受 slash 候选 head（保留 args）。
      if (key.tab && !key.shift) {
        if (slashVisible && slashSelection >= 0) {
          const picked = slashCandidates[slashSelectionClamped];
          if (picked) {
            const spaceIndex = text.indexOf(" ");
            const args = spaceIndex >= 0 ? text.slice(spaceIndex) : "";
            const next = args ? `${picked.slash}${args}` : `${picked.slash} `;
            resetBuffer(next);
            setSlashHidden(false);
            return;
          }
        }
        const ghost = computeGhostText(
          text,
          slashCandidates.map((c) => ({ slash: c.slash, description: c.descriptionZh })),
        );
        if (ghost) {
          resetBuffer(`${text}${ghost} `);
          return;
        }
        return;
      }

      // Shift+Tab — 切换 permission mode。
      if (key.tab && key.shift) {
        emitInput({ type: "cycle-permission-mode" });
        return;
      }

      // Escape — 分层归属：slash 可见 → 仅隐藏；buffer 非空 → 双击清空；空 → 上抛 escape。
      if (key.escape) {
        if (slashVisible && slashSelection >= 0) {
          setSlashHidden(true);
          setSlashSelection(-1);
          return;
        }
        if (text.length === 0 && view.agentProgressTree && view.agentProgressTree.cursor >= 0) {
          emitInput({ type: "agent-tree-escape" });
          return;
        }
        if (view.composer.busy) {
          clearHintNotice();
          emitInput({ type: "interrupt" });
          return;
        }
        if (text.length > 0) {
          const now = Date.now();
          if (now - lastEscAtRef.current < DOUBLE_PRESS_WINDOW_MS) {
            lastEscAtRef.current = 0;
            resetBuffer();
            clearHintNotice();
            return;
          }
          lastEscAtRef.current = now;
          showHintNotice(view.language === "en-US" ? "Esc again to clear" : "再按 Esc 清空输入");
          return;
        }
        if (
          view.commandPanel ||
          view.helpPanel ||
          view.configPanel ||
          view.btwPanel ||
          view.sessionsPanel
        ) {
          clearHintNotice();
          return;
        }
        clearHintNotice();
        emitInput(view.composer.busy ? { type: "interrupt" } : { type: "escape" });
        return;
      }

      // Agent tree: x 关闭选中的 agent（CCB eviction 模式，仅空输入 + 有 cursor 时生效）。
      if (
        text.length === 0 &&
        input.toLowerCase() === "x" &&
        !key.ctrl &&
        !key.meta &&
        view.agentProgressTree &&
        view.agentProgressTree.cursor >= 0
      ) {
        emitInput({ type: "agent-tree-close" });
        return;
      }

      // Navigation: arrow keys / Ctrl+B/F
      if (key.leftArrow || (key.ctrl && input === "b")) {
        if (!key.ctrl && !key.meta && longInputChip.cursorOnLeadingChip) {
          setBufferAndResetSelection(bufferHome(buffer));
          return;
        }
        if ((key.ctrl && key.leftArrow) || key.meta) {
          setBufferAndResetSelection(bufferWordLeft(buffer));
        } else {
          setBufferAndResetSelection(bufferMoveLeft(buffer));
        }
        return;
      }
      if (key.rightArrow || (key.ctrl && input === "f")) {
        if (!key.ctrl && !key.meta && longInputChip.cursorOnTrailingChip) {
          setBufferAndResetSelection(bufferEnd(buffer));
          return;
        }
        if ((key.ctrl && key.rightArrow) || key.meta) {
          setBufferAndResetSelection(bufferWordRight(buffer));
        } else {
          setBufferAndResetSelection(bufferMoveRight(buffer));
        }
        return;
      }

      // Up / Down — also used by terminal alternate-scroll (CSI ?1007) to
      // bridge mouse wheels into the same transcript-scroll path.
      const appTranscriptScrollKeys = inTaskMode;
      if (key.upArrow) {
        if (slashVisible && slashSelection >= 0) {
          setSlashSelection((current) => {
            const safe = current < 0 ? 0 : current;
            return safe === 0 ? slashCandidates.length - 1 : safe - 1;
          });
          return;
        }
        if (text.length === 0 && view.taskSuggestions && view.taskSuggestions.length > 0) {
          emitInput({ type: "task-suggestion-move", delta: -1 });
          return;
        }
        if (text.length === 0 && view.agentProgressTree && view.agentProgressTree.rows.length > 0) {
          emitInput({ type: "agent-tree-move", delta: -1 });
          return;
        }
        if (text.length === 0 && appTranscriptScrollKeys) {
          emitInput({ type: "transcript-scroll", action: "lineUp" });
          return;
        }
        const moved = bufferMoveVisualUp(buffer, maxWidth);
        if (moved.cursor !== buffer.cursor) {
          setBufferAndResetSelection(moved);
        } else {
          const next = historyUp(historyRef.current, text);
          if (next) {
            historyRef.current = next;
            const histText = historyCurrentText(next);
            if (histText !== undefined) resetBuffer(histText);
          }
        }
        return;
      }
      if (key.downArrow) {
        if (slashVisible && slashSelection >= 0) {
          setSlashSelection((current) => {
            const safe = current < 0 ? 0 : current;
            return safe >= slashCandidates.length - 1 ? 0 : safe + 1;
          });
          return;
        }
        if (text.length === 0 && view.taskSuggestions && view.taskSuggestions.length > 0) {
          emitInput({ type: "task-suggestion-move", delta: 1 });
          return;
        }
        if (text.length === 0 && view.agentProgressTree && view.agentProgressTree.rows.length > 0) {
          emitInput({ type: "agent-tree-move", delta: 1 });
          return;
        }
        if (text.length === 0 && appTranscriptScrollKeys) {
          emitInput({ type: "transcript-scroll", action: "lineDown" });
          return;
        }
        const moved = bufferMoveVisualDown(buffer, maxWidth);
        if (moved.cursor !== buffer.cursor) {
          setBufferAndResetSelection(moved);
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
      if (key.home) {
        setBufferAndResetSelection(bufferHome(buffer));
        return;
      }
      if (key.end) {
        setBufferAndResetSelection(bufferEnd(buffer));
        return;
      }
      if (key.ctrl && input === "a") {
        setBufferAndResetSelection(bufferHome(buffer));
        return;
      }
      if (key.ctrl && input === "e") {
        if (longInputChip.active) {
          emitInput({ type: "external-editor" });
          return;
        }
        setBufferAndResetSelection(bufferEnd(buffer));
        return;
      }

      // Ctrl+U / Ctrl+K / Ctrl+W
      if (key.ctrl && input === "u") {
        setBufferAndResetSelection(bufferClearLine(buffer));
        return;
      }
      if (key.ctrl && input === "k") {
        setBufferAndResetSelection(bufferKillToEnd(buffer));
        return;
      }
      if (key.ctrl && input === "w") {
        setBufferAndResetSelection(bufferDeleteWordLeft(buffer));
        return;
      }

      // Ctrl+C — 不是复制（复制走终端选区 / Ctrl+Shift+C）。
      //  - buffer 非空：第一次显示提示；窗口内第二次清空 buffer。不走上层 escape。
      //  - buffer 空：明确触发 interrupt；Esc 只负责 UI 关闭，不再穿透停止任务。
      if (key.ctrl && input === "c") {
        if (text.length > 0) {
          const now = Date.now();
          if (now - lastCtrlCAtRef.current < DOUBLE_PRESS_WINDOW_MS) {
            lastCtrlCAtRef.current = 0;
            resetBuffer();
            clearHintNotice();
            return;
          }
          lastCtrlCAtRef.current = now;
          showHintNotice(
            view.language === "en-US" ? "Ctrl+C again to clear" : "再按 Ctrl+C 清空输入",
          );
          return;
        }
        clearHintNotice();
        emitInput({ type: "interrupt" });
        return;
      }

      // Ctrl+V — 终端 host 通常拦截系统粘贴；这里不写入 "v"。
      // 真实粘贴会进 paste 路径（looksLikePasteChunk 已处理）。
      if (key.ctrl && input === "v") {
        return;
      }

      // D.13Q-UX Ctrl+O — 查看完整内容：派发 toggle-details 事件，由 onInput
      // 切换 transcript/message verbose 展开态。**不再 submit "/details"**，避免
      // transcript 命令行里冒出 ❯ /details；/details slash 仍保留为兼容命令，
      // 但用户按 Ctrl+O 时不应当作 slash 提交，也不应打开 CommandPanel。
      if (key.ctrl && input === "o") {
        clearHintNotice();
        emitInput({ type: "toggle-details" });
        return;
      }

      if (terminalAction.type === "backspace") {
        if (shouldDeleteLongInputChip(longInputChip, buffer, "backspace")) {
          updateBufferAndResetSelection(() => bufferClearLine(buffer));
          return;
        }
        setBufferAndResetSelection(bufferBackspace(buffer));
        return;
      }
      if (terminalAction.type === "delete") {
        if (shouldDeleteLongInputChip(longInputChip, buffer, "delete")) {
          updateBufferAndResetSelection(() => bufferClearLine(buffer));
          return;
        }
        setBufferAndResetSelection(bufferDelete(buffer));
        return;
      }
      if (terminalAction.type === "delete-word-left") {
        setBufferAndResetSelection(bufferDeleteWordLeft(buffer));
        return;
      }
      if (terminalAction.type === "text" && terminalAction.text) {
        updateBufferAndResetSelection((current) => bufferInsert(current, terminalAction.text));
      }
    },
    { isActive: true },
  );
  // ─── Render ─────────────────────────────────────────────────────────────
  // Pick placeholder. Permission active wins over setup, which wins over task.
  const placeholderText =
    view.permission || view.composer.setupActive
      ? view.composer.placeholder
      : view.viewMode === "task" || view.viewMode === "pending"
        ? view.composer.taskPlaceholder
        : view.composer.placeholder;

  const { visualLines, cursorCol, cursorRow } = useMemo(
    () =>
      formatComposerRenderLines({
        buffer,
        placeholder: placeholderText,
        masking: view.composer.masking,
        noColor,
        layout: composerLayout,
        maxVisibleLines: composerMaxVisibleLines,
      }),
    [buffer, placeholderText, view.composer.masking, noColor, composerLayout, composerMaxVisibleLines],
  );

  // Position native cursor — anchored to Composer's outer Box via parent-chain
  // accumulation. Composer only declares row/col; absolute coordinates are
  // resolved by useAnchoredCursor against ink-root in the render phase.
  // Permission-exclusive focus: while a permission card is on screen, the
  // selector row owns the visible focus. The native cursor MUST NOT also be
  // positioned over the buffer line; otherwise the user sees two competing
  // focus owners. We pass null so useAnchoredCursor hides the cursor instead.
  // Task/pending now use the same native cursor declaration as home. If the
  // terminal cannot position it, useAnchoredCursor hides it via capability.
  const showSuggestions =
    !permissionActive &&
    !configPanelActive &&
    !commandPanelActive &&
    slashCandidates.length > 0 &&
    slashSelection >= 0 &&
    !slashHidden &&
    (slashMaxRowsProp ?? 1) > 0;
  const composerOverlayRowsRef = useRef(-1);
  const slashSuggestionWidth = composerContentWidth(composerLayout);
  const slashMaxRows = Math.max(0, Math.floor(slashMaxRowsProp ?? Number.MAX_SAFE_INTEGER));
  useEffect(() => {
    const rows = composerSlashOverlayRows({
      visible: showSuggestions,
      candidateCount: slashCandidates.length,
      width: slashSuggestionWidth,
      slashMaxRows,
    });
    if (composerOverlayRowsRef.current === rows) return;
    composerOverlayRowsRef.current = rows;
    emitInput({ type: "composer-overlay-rows-change", rows });
  }, [emitInput, showSuggestions, slashCandidates.length, slashSuggestionWidth, slashMaxRows]);

  // Windows Terminal + normal-screen Ink output does not provide a stable
  // native cursor anchor when the composer soft-wraps or moves between Home
  // and Task layouts. Render the composer caret inline with the text instead;
  // keep the native terminal cursor hidden so there is only one focus owner.
  useAnchoredCursor(null, anchorRef, capability);

  const placeholderColor = noColor ? undefined : "gray";
  const color = text ? undefined : placeholderColor;

  const ghostSuffix = useMemo(() => {
    if (permissionActive || slashHidden) return undefined;
    return computeGhostText(
      text,
      slashCandidates.map((c) => ({ slash: c.slash, description: c.descriptionZh })),
    );
  }, [text, slashCandidates, permissionActive, slashHidden]);

  // Unknown slash hint: only after the user pressed Enter with an unknown
  // command. The composer no longer pesters the user mid-typing.
  const showUnknownHint = false;

  return (
    <Box
      flexDirection="column"
      width={maxWidth}
      borderStyle="round"
      borderColor={theme.border ?? theme.muted}
      paddingLeft={2}
      paddingRight={1}
    >
      {permissionActive && view.permission ? (
        <PermissionControl
          permission={view.permission}
          actions={permissionActions}
          focused={permissionFocus}
          theme={theme}
          width={composerContentWidth(composerLayout)}
          language={view.language}
        />
      ) : (
        <>
          {showSuggestions ? (
            <SlashSuggestions
              candidates={slashCandidates}
              selectedIndex={slashSelectionClamped}
              theme={theme}
              language={view.language}
              width={slashSuggestionWidth}
              maxRows={slashMaxRows}
              hint={
                view.language === "en-US"
                  ? "Tab accept · ↑↓ pick · Esc hide · Enter submit"
                  : "Tab 选中 · ↑↓ 切换 · Esc 隐藏 · Enter 提交"
              }
            />
          ) : null}
          <Box ref={anchorRef} width="100%" flexDirection="column">
            {visualLines.map((line, index) => {
              const clippedLine = line.text;
              const showInlineCursor = index === cursorRow;
              return (
                <Text key={`${index}-${line.prefix}-${line.text}`} color={color} bold={Boolean(text)}>
                  <Text color={theme.muted} dimColor={!text}>
                    {line.prefix}
                  </Text>
                  {showInlineCursor
                    ? renderInlineComposerCursor(clippedLine, cursorCol, cursorBlinkOn)
                    : clippedLine}
                  {index === visualLines.length - 1 && ghostSuffix ? (
                    <Text color="gray" dimColor>
                      {ghostSuffix}
                    </Text>
                  ) : null}
                </Text>
              );
            })}
          </Box>
          {showUnknownHint ? (
            <Text color={theme.muted}>
              {fitText(formatUnknownSlashCommand(text, view.language), composerContentWidth(composerLayout))}
            </Text>
          ) : null}
          {hintNotice ? (
            <Text color={theme.muted}>{fitText(hintNotice, composerContentWidth(composerLayout))}</Text>
          ) : null}
        </>
      )}
    </Box>
  );
}

function PermissionControl({
  permission,
  actions,
  focused,
  theme,
  width,
  language,
}: {
  permission: TaskPermissionView;
  actions: { id: PermissionActionId; label: string; shortcut?: string }[];
  focused: PermissionActionId;
  theme: ReturnType<typeof createShellTheme>;
  width: number;
  language: ShellViewModel["language"];
}): React.ReactNode {
  // D.13Q-UX Real Smoke Fix v2 — F. 主屏降噪：
  //   - headline + 一行 actionSummary + 3 actions + 一行 Enter/Tab/Esc 提示。
  //   - explanationLines / rule.id / scope / risk 等内部细节不再渲染在主屏。
  //   - 详情仍可通过 /details 展开（保留 explanationLines 在 view-model 上）。
  const isEn = language === "en-US";
  const cardWidth = Math.min(width, 76);
  const innerWidth = Math.max(20, cardWidth - 4);
  const headline = isEn ? "Permission requested" : "需要您授权";
  const summaryLine =
    permission.actionSummary && permission.actionSummary.length > 0
      ? permission.actionSummary
      : isEn
        ? `Use tool: ${permission.toolName}`
        : `使用工具：${permission.toolName}`;

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={theme.permission ?? theme.border}
      paddingX={1}
      width={cardWidth}
    >
      <Text bold color={theme.permission ?? theme.assistantText ?? theme.brand}>
        {fitText(headline, innerWidth)}
      </Text>
      <Text color={theme.muted}>{fitText(summaryLine, innerWidth)}</Text>
      <Text color={theme.dim ?? theme.muted} dimColor>
        {"─".repeat(Math.min(innerWidth, 60))}
      </Text>
      <PermissionActionRow actions={actions} focused={focused} theme={theme} width={innerWidth} />
      <Text color={theme.dim ?? theme.muted} dimColor>
        {fitText(
          isEn
            ? "Enter confirm · Tab switch · d details · Esc cancel"
            : "Enter 确认 · Tab 切换 · d 详情 · Esc 取消",
          innerWidth,
        )}
      </Text>
    </Box>
  );
}

function PermissionActionRow({
  actions,
  focused,
  theme,
  width,
}: {
  actions: { id: PermissionActionId; label: string; shortcut?: string }[];
  focused: PermissionActionId;
  theme: ReturnType<typeof createShellTheme>;
  width: number;
}): React.ReactNode {
  const segments = actions.map((action) => {
    const isFocused = action.id === focused;
    const shortcut = action.shortcut ? ` (${action.shortcut})` : "";
    const text = isFocused ? `[ ${action.label}${shortcut} ]` : `  ${action.label}${shortcut}  `;
    return { text, focused: isFocused, id: action.id };
  });
  // 始终使用纵向布局，每个按钮一行
  return (
    <Box flexDirection="column" width={width}>
      {segments.map((s) => (
        <Text
          key={s.id}
          color={s.focused ? undefined : theme.muted}
          backgroundColor={s.focused && theme.mode !== "no-color" ? theme.permission : undefined}
          inverse={s.focused}
        >
          {fitText(s.text, Math.max(8, width - 2))}
        </Text>
      ))}
    </Box>
  );
}

function buildPermissionActions(
  language: ShellViewModel["language"],
  actions?: { id: PermissionActionId; label: string; shortcut?: string }[],
): { id: PermissionActionId; label: string; shortcut?: string }[] {
  if (actions && actions.length > 0) {
    return actions;
  }
  const isEn = language === "en-US";
  return [
    { id: "allow_once", label: isEn ? "Yes" : "是", shortcut: "y" },
    {
      id: "allow_always_tool",
      label: isEn ? "Allow future similar actions" : "允许以后这类操作",
      shortcut: "a",
    },
    { id: "deny", label: isEn ? "No" : "否", shortcut: "n" },
    { id: "details", label: isEn ? "Details" : "详情", shortcut: "d" },
  ];
}

function cyclePermissionFocus(
  actions: { id: PermissionActionId }[],
  current: PermissionActionId,
  delta: number,
): PermissionActionId {
  const order = actions.map((a) => a.id);
  const ids = order.length > 0 ? order : PERMISSION_ACTION_ORDER;
  const idx = ids.indexOf(current);
  const safeIdx = idx < 0 ? 0 : idx;
  const next = (safeIdx + delta + ids.length) % ids.length;
  return ids[next] ?? ids[0] ?? "allow_once";
}

// D.13E Step 2 — y/n 单字母在新 4 档 elevation（allow_once / allow_always_tool /
// deny / details）与旧 fallback（yes / no / details / cancel）之间做兼容映射：
// 优先返回 primary（新 id），不存在则回退到 legacy（旧 id），都不存在仍返回 primary
// 让 submitPermissionAction 的 unknown action 路径吞掉而不污染 buffer。
function resolveActionId(
  actions: { id: PermissionActionId }[],
  primary: PermissionActionId,
  legacy: PermissionActionId,
): PermissionActionId {
  if (actions.some((a) => a.id === primary)) return primary;
  if (actions.some((a) => a.id === legacy)) return legacy;
  return primary;
}

function slashHead(value: string): string {
  const space = value.indexOf(" ");
  return space >= 0 ? value.slice(0, space) : value;
}

// ---------------------------------------------------------------------------
// Render helpers (exported for testing)
// ---------------------------------------------------------------------------

export type ComposerRenderResult = {
  lines: string[];
  visualLines: Array<{ prefix: string; text: string }>;
  truncatedAbove: number;
  truncatedBelow: number;
  cursorCol: number;
  cursorRow: number;
};

export type ComposerLongInputChipState = {
  active: boolean;
  cursorOnLeadingChip: boolean;
  cursorOnTrailingChip: boolean;
};

export function getComposerLongInputChipState({
  buffer,
  maxWidth,
  layout,
  maxVisibleLines,
}: {
  buffer: EditBuffer;
  maxWidth?: number;
  layout?: ComposerLayout;
  maxVisibleLines?: number;
}): ComposerLongInputChipState {
  const rendered = formatComposerRenderLines({
    buffer,
    placeholder: "",
    masking: false,
    noColor: true,
    maxWidth,
    layout,
    maxVisibleLines,
  });
  const active = rendered.truncatedAbove > 0 || rendered.truncatedBelow > 0;
  return {
    active,
    cursorOnLeadingChip: active && buffer.cursor === 0,
    cursorOnTrailingChip: active && buffer.cursor >= buffer.chars.length,
  };
}

export function shouldDeleteLongInputChip(
  chip: ComposerLongInputChipState,
  buffer: EditBuffer,
  action: "backspace" | "delete",
): boolean {
  void chip;
  void buffer;
  void action;
  return false;
}

export function composerSlashOverlayRows({
  visible,
  candidateCount,
  width,
  slashMaxRows,
}: {
  visible: boolean;
  candidateCount: number;
  width: number;
  slashMaxRows?: number;
}): number {
  if (!visible || candidateCount <= 0) return 0;
  const cappedRows = Math.max(0, Math.floor(slashMaxRows ?? Number.MAX_SAFE_INTEGER));
  if (cappedRows <= 0) return 0;
  return slashSuggestionRowCount(candidateCount, width, cappedRows) + 1;
}

export function formatComposerRenderLines({
  buffer,
  placeholder,
  masking,
  noColor,
  maxWidth,
  layout,
  maxVisibleLines,
}: {
  buffer: EditBuffer;
  placeholder: string;
  masking: boolean;
  noColor: boolean;
  maxWidth?: number;
  layout?: ComposerLayout;
  maxVisibleLines?: number;
}): ComposerRenderResult {
  void noColor;
  const text = bufferToString(buffer);
  const displayText = text ? (masking ? "*".repeat(buffer.chars.length) : text) : "";

  if (!displayText) {
    return {
      lines: [placeholder],
      visualLines: [{ prefix: PROMPT_MARKER, text: placeholder }],
      truncatedAbove: 0,
      truncatedBelow: 0,
      cursorCol: 0,
      cursorRow: 0,
    };
  }

  const wrapped = computeWrappedInputState({
    text: displayText,
    cursorOffset: buffer.cursor,
    width: layout?.width ?? maxWidth ?? 80,
    prefixWidth: layout?.prefixWidth ?? displayWidthOf(PROMPT_MARKER),
    paddingLeft: layout?.paddingLeft ?? 4,
    paddingRight: layout?.paddingRight ?? 0,
    minContentWidth: layout?.minContentWidth ?? 4,
  });

  const totalLines = wrapped.lines.length;
  const visibleLineLimit = Math.max(
    1,
    Math.floor(maxVisibleLines ?? COMPOSER_MAX_VISIBLE_LINES),
  );
  let startLine = 0;
  let endLineExclusive = totalLines;
  if (totalLines > visibleLineLimit) {
    const half = Math.floor(visibleLineLimit / 2);
    startLine = Math.max(0, wrapped.cursorRow - half);
    endLineExclusive = startLine + visibleLineLimit;
    if (endLineExclusive > totalLines) {
      endLineExclusive = totalLines;
      startLine = Math.max(0, endLineExclusive - visibleLineLimit);
    }
  }
  const renderedLines = wrapped.lines.slice(startLine, endLineExclusive);
  const truncatedAbove = startLine;
  const truncatedBelow = totalLines - endLineExclusive;
  const cursorVisibleRow = Math.max(0, Math.min(wrapped.cursorRow - startLine, renderedLines.length - 1));
  const visualLines = renderedLines.map((line, index) => {
    const isTopTruncated = index === 0 && truncatedAbove > 0;
    const isBottomTruncated = index === renderedLines.length - 1 && truncatedBelow > 0;
    if (isTopTruncated) return bracketTruncatedComposerLine(line, wrapped.contentWidth, truncatedAbove);
    if (isBottomTruncated) return bracketTruncatedComposerLine(line, wrapped.contentWidth, truncatedBelow);
    return line;
  });
  const cursorLineMarked =
    (cursorVisibleRow === 0 && truncatedAbove > 0) ||
    (cursorVisibleRow === renderedLines.length - 1 && truncatedBelow > 0);
  const cursorHiddenCount =
    cursorVisibleRow === 0 && truncatedAbove > 0
      ? truncatedAbove
      : cursorVisibleRow === renderedLines.length - 1 && truncatedBelow > 0
        ? truncatedBelow
        : 0;
  const rawCursorCol = Math.min(wrapped.cursorCol, Math.max(4, wrapped.contentWidth));
  const visualLineWidth = displayWidthOf(visualLines[cursorVisibleRow] ?? "");
  const rawCursorLineWidth = displayWidthOf(renderedLines[cursorVisibleRow] ?? "");
  const cursorCol = cursorLineMarked
    ? rawCursorCol >= rawCursorLineWidth
      ? visualLineWidth
      : Math.min(
          rawCursorCol + truncatedComposerLineInset(cursorHiddenCount),
          visualLineWidth,
        )
    : rawCursorCol;

  return {
    lines: renderedLines,
    visualLines: renderedLines.map((line, index) => ({
      prefix: startLine + index === 0 ? PROMPT_MARKER : "",
      text: visualLines[index] ?? line,
    })),
    truncatedAbove,
    truncatedBelow,
    cursorCol,
    cursorRow: cursorVisibleRow,
  };
}

function bracketTruncatedComposerLine(line: string, maxWidth: number, hiddenCount: number): string {
  const safeWidth = Math.max(0, Math.floor(maxWidth));
  if (safeWidth < 4) return line;
  const label = truncatedComposerLineLabel(hiddenCount);
  return `[${label}${clipDisplayWidth(line, safeWidth - displayWidthOf(label) - 2)}]`;
}

function truncatedComposerLineLabel(hiddenCount: number): string {
  return `+${Math.max(1, Math.floor(hiddenCount))} lines `;
}

function truncatedComposerLineInset(hiddenCount: number): number {
  return displayWidthOf(`[${truncatedComposerLineLabel(hiddenCount)}`);
}

function clipDisplayWidth(value: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  let width = 0;
  let out = "";
  for (const char of Array.from(value)) {
    const next = width + charWidth(char);
    if (next > maxWidth) break;
    out += char;
    width = next;
  }
  return out;
}

function composerContentWidth(layout: ComposerLayout): number {
  return computeWrappedInputState({
    text: "",
    cursorOffset: 0,
    width: layout.width,
    prefixWidth: layout.prefixWidth,
    paddingLeft: layout.paddingLeft,
    paddingRight: layout.paddingRight,
    minContentWidth: layout.minContentWidth,
  }).contentWidth;
}

function renderInlineComposerCursor(line: string, col: number, visible: boolean): React.ReactNode {
  const { before, cursorChar, after } = splitLineAtDisplayCol(line, col);
  const cursorCell = cursorChar || " ";
  return (
    <>
      {before}
      {visible ? <Text inverse>{cursorCell}</Text> : cursorCell}
      {after}
    </>
  );
}

/** Find which line and character column the cursor is on. */
function getCursorLinePosition(buffer: EditBuffer): { row: number; col: number } {
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

/**
 * Split a rendered composer line at a target display column for inline cursor
 * rendering (Task mode fallback when native cursor positioning is unreliable).
 *
 * Returns three segments:
 *   - before: characters before the cursor column (display-width aligned)
 *   - cursorChar: the single character under the cursor (or "" if at line end)
 *   - after: characters after the cursor column
 *
 * The caller renders cursorChar with `inverse` to produce a reverse-video
 * cursor block. CJK wide characters are kept atomic — when the cursor lands
 * on the second visual cell of a wide char, the whole wide char is the
 * cursor cell.
 */
export function splitLineAtDisplayCol(
  line: string,
  col: number,
): { before: string; cursorChar: string; after: string } {
  const chars = Array.from(line);
  let acc = 0;
  let i = 0;
  for (; i < chars.length; i++) {
    const ch = chars[i] ?? "";
    const w = charWidth(ch);
    if (acc + w > col) break;
    acc += w;
  }
  if (i >= chars.length) {
    return { before: chars.join(""), cursorChar: "", after: "" };
  }
  const before = chars.slice(0, i).join("");
  const cursorChar = chars[i] ?? " ";
  const after = chars.slice(i + 1).join("");
  return { before, cursorChar, after };
}

export function composerCursorAnchorRowOffset({
  textAnchorRowBase = 0,
  permissionActive,
  permissionActionCount,
  showSuggestions,
  slashCandidateCount,
  cursorRow,
}: {
  textAnchorRowBase?: number;
  permissionActive: boolean;
  permissionActionCount: number;
  showSuggestions: boolean;
  slashCandidateCount: number;
  cursorRow: number;
}): number {
  void permissionActive;
  void permissionActionCount;
  void showSuggestions;
  void slashCandidateCount;
  return Math.max(0, textAnchorRowBase) + Math.max(0, cursorRow);
}

function hasSelectableCommandPanelRows(panel: CommandPanelView | undefined): boolean {
  return Boolean(
    panel?.sections?.some((section) =>
      section.rows.some(
        (row) => typeof row !== "string" && row.selectable !== false && Boolean(row.taskRef),
      ),
    ),
  );
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
  const normalized = normalizeTerminalInput(input, {
    backspace: key.backspace === true,
    delete: key.delete === true,
    ctrl: key.ctrl === true,
    meta: key.meta === true,
    return: key.return === true,
    shift: key.shift === true,
  });
  if (key.escape) {
    return { kind: "emit", event: { type: "escape" }, nextText: "" };
  }
  if (normalized.type === "newline") {
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
  if (normalized.type === "backspace" || normalized.type === "delete") {
    return { kind: "set", text: Array.from(text).slice(0, -1).join("") };
  }
  if (normalized.type === "ignore") {
    return { kind: "ignore" };
  }
  if (normalized.type === "text") {
    return { kind: "append", text: normalized.text };
  }
  return { kind: "ignore" };
}
