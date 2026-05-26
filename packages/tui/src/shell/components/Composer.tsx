import { Box, type DOMElement, Text, useInput } from "ink";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  formatUnknownSlashCommand,
  getCoreSlashCandidates,
  getSlashPrefixCandidates,
} from "../../slash-dispatch.js";
import type { TerminalCapability } from "../terminal-capability.js";
import { charWidth, composerMaxWidth, fitText } from "../text-utils.js";
import { createShellTheme } from "../theme.js";
import type { PermissionActionId, ShellInputEvent, ShellViewModel } from "../types.js";
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

function isWordBoundary(ch: string): boolean {
  return /[\s\p{P}]/u.test(ch);
}

// 极简 ANSI 去除：识别 CSI / OSC / 单字节 ESC 序列。
// 不引入新依赖（CCB 用 strip-ansi 包，这里就地实现以保持 LingHun 已有依赖收敛）。
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences inherently contain control characters.
const ANSI_STRIP_PATTERN = /\u001B\[[\d;?]*[a-zA-Z]|\u001B\][^\u0007]*(?:\u0007|\u001B\\)|\u001B./g;
function stripAnsi(value: string): string {
  return value.replace(ANSI_STRIP_PATTERN, "");
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

const COMPOSER_MAX_VISIBLE_LINES = 5;
const PROMPT_MARKER = "> ";
const PROMPT_MARKER_CONTINUATION = "  ";

const PERMISSION_ACTION_ORDER: PermissionActionId[] = ["yes", "no", "details", "cancel"];

const PERMISSION_TEXT_MAP: Record<PermissionActionId, string> = {
  yes: "yes",
  no: "no",
  details: "details",
  cancel: "cancel",
};

// ---------------------------------------------------------------------------
// Owner-priority dispatcher constants
// ---------------------------------------------------------------------------
// PASTE_THRESHOLD: 单次 useInput 的 input.length 超过该阈值 → 视作粘贴片段。
// 标准 ink@7 不暴露 event.keypress.isPasted（CCB 用的是 @anthropic 私有 fork），
// 所以只能通过 chunk 大小 + 100ms 聚合窗口降级识别 bracketed paste。
const PASTE_THRESHOLD = 16;
const PASTE_COMPLETION_TIMEOUT_MS = 100;
// DOUBLE_PRESS_WINDOW_MS: 双击 Esc / Ctrl+C 的有效窗口（CCB ~1s）。
const DOUBLE_PRESS_WINDOW_MS = 1000;
const HINT_NOTICE_DECAY_MS = 1500;

export function Composer({ view, onInput, capability }: ComposerProps): React.ReactNode {
  const [buffer, setBuffer] = useState<EditBuffer>(createEditBuffer());
  const [slashSelection, setSlashSelection] = useState(0);
  const [slashHidden, setSlashHidden] = useState(false);
  const [permissionFocus, setPermissionFocus] = useState<PermissionActionId>("yes");
  const [hintNotice, setHintNotice] = useState<string | undefined>(undefined);
  const historyRef = useRef<InputHistory>(createInputHistory());
  const pasteChunksRef = useRef<string[]>([]);
  const pasteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pastePendingRef = useRef(false);
  const lastEscAtRef = useRef(0);
  const lastCtrlCAtRef = useRef(0);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxWidth = composerMaxWidth(view.width);
  const noColor = view.themeMode === "no-color";
  const theme = useMemo(() => createShellTheme(noColor), [noColor]);
  const anchorRef = useRef<DOMElement | null>(null);

  // Permission active = a permission card is on screen and the composer is in
  // selector mode (key bindings change; ordinary chars do NOT enter the buffer).
  const permissionActive = Boolean(view.permission);
  const permissionActions = useMemo(
    () => buildPermissionActions(view.permission?.actions),
    [view.permission],
  );

  const text = bufferToString(buffer);
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
    setBuffer(createEditBuffer(nextText));
    setSlashSelection(0);
  }, []);

  const setBufferAndResetSelection = useCallback((next: EditBuffer) => {
    setBuffer(next);
    setSlashSelection(0);
  }, []);

  const submitPermissionAction = useCallback(
    (id: PermissionActionId) => {
      if (id === "cancel") {
        void onInput({ type: "escape" });
        return;
      }
      void onInput({ type: "submit", text: PERMISSION_TEXT_MAP[id] });
    },
    [onInput],
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
    const joined = stripAnsi(chunks.join("")).replace(/\r\n?/g, "\n");
    if (!joined) return;
    setBuffer((prev) => bufferInsert(prev, joined));
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

  useInput((input, key) => {
    // ─── 1. Permission selector mode（最高优先级）────────────────────────
    if (permissionActive) {
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
        if (lower === "y") {
          submitPermissionAction("yes");
          return;
        }
        if (lower === "n") {
          submitPermissionAction("no");
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

    // ─── 2. Paste 聚合（次高优先级）────────────────────────────────────
    // pending 期间 Enter 被吞掉（CCB BaseTextInput 的 paste-blocks-Enter 模式）。
    // pending 期间 Esc 主动取消粘贴。
    if (pastePendingRef.current && key.return) {
      // 把剩余 chunk 一并 flush 但不提交。
      enqueuePasteChunk("");
      return;
    }
    if (pastePendingRef.current && key.escape) {
      cancelPaste();
      return;
    }
    // 大 chunk 或已在 pending 期内的任意输入 → 进 paste 路径（不识别为按键）。
    const looksLikePasteChunk =
      input.length > PASTE_THRESHOLD ||
      (pastePendingRef.current &&
        input.length > 0 &&
        !key.ctrl &&
        !key.meta &&
        !key.escape &&
        !key.tab);
    if (looksLikePasteChunk) {
      enqueuePasteChunk(input);
      return;
    }

    // ─── 3. Slash candidates（仅在可见时拦截 ↑↓ Tab Esc Enter）─────────
    const slashVisible = slashCandidates.length > 0 && !slashHidden;

    // ─── Submit: Enter（无 shift）─────────────────────────────────────
    if (key.return && !key.shift) {
      // slash 可见且光标只在 head 上 → 接受候选再提交。
      if (slashVisible && slashSelection >= 0 && !text.includes(" ")) {
        const picked = slashCandidates[slashSelectionClamped];
        if (picked && picked.slash !== text) {
          const submitText = picked.slash;
          historyRef.current = historyAdd(historyRef.current, submitText);
          resetBuffer();
          setSlashHidden(false);
          clearHintNotice();
          void onInput({ type: "submit", text: submitText });
          return;
        }
      }
      const submitText = text.trim();
      historyRef.current = historyAdd(historyRef.current, text);
      resetBuffer();
      setSlashHidden(false);
      clearHintNotice();
      void onInput(submitText ? { type: "submit", text: submitText } : { type: "empty-submit" });
      return;
    }

    // Multiline: Shift+Enter
    if (key.return && key.shift) {
      setBufferAndResetSelection(bufferInsert(buffer, "\n"));
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
      return;
    }

    // Shift+Tab — 切换 permission mode。
    if (key.tab && key.shift) {
      void onInput({ type: "cycle-permission-mode" });
      return;
    }

    // Escape — 分层归属：slash 可见 → 仅隐藏；buffer 非空 → 双击清空；空 → 上抛 escape。
    if (key.escape) {
      if (slashVisible && slashSelection >= 0) {
        setSlashHidden(true);
        setSlashSelection(-1);
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
      // 空 buffer → 走上层 escape 链路（既有交互行为）。
      clearHintNotice();
      void onInput({ type: "escape" });
      return;
    }

    // Navigation: arrow keys / Ctrl+B/F
    if (key.leftArrow || (key.ctrl && input === "b")) {
      if ((key.ctrl && key.leftArrow) || key.meta) {
        setBufferAndResetSelection(bufferWordLeft(buffer));
      } else {
        setBufferAndResetSelection(bufferMoveLeft(buffer));
      }
      return;
    }
    if (key.rightArrow || (key.ctrl && input === "f")) {
      if ((key.ctrl && key.rightArrow) || key.meta) {
        setBufferAndResetSelection(bufferWordRight(buffer));
      } else {
        setBufferAndResetSelection(bufferMoveRight(buffer));
      }
      return;
    }

    // Up / Down — slash 列表优先；多行先在内部走，到达边界再走历史。
    if (key.upArrow) {
      if (slashVisible && slashSelection >= 0) {
        setSlashSelection((current) => {
          const safe = current < 0 ? 0 : current;
          return safe === 0 ? slashCandidates.length - 1 : safe - 1;
        });
        return;
      }
      const { row } = getCursorLinePosition(buffer);
      if (row > 0) {
        setBufferAndResetSelection(bufferMoveUp(buffer));
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
      const { row } = getCursorLinePosition(buffer);
      const totalLines = text.split("\n").length;
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
    //  - buffer 空 + 请求运行中：走既有 escape/interrupt 链路。
    //  - buffer 空 + 空闲：交既有上层链路（exit 由控制器决定）。
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
      void onInput({ type: "escape" });
      return;
    }

    // Ctrl+V — 终端 host 通常拦截系统粘贴；这里不写入 "v"。
    // 真实粘贴会进 paste 路径（looksLikePasteChunk 已处理）。
    if (key.ctrl && input === "v") {
      return;
    }

    // 其他 ctrl/meta 不处理
    if (key.ctrl || key.meta) return;

    // 普通字符输入：去掉 ANSI、\r → \n（处理终端粘贴 SSH coalesce）。
    if (input && input !== "\r" && input !== "\n") {
      const sanitized = stripAnsi(input).replace(/\r\n?/g, "\n");
      if (sanitized) {
        setBufferAndResetSelection(bufferInsert(buffer, sanitized));
      }
    }
  });

  // ─── Render ─────────────────────────────────────────────────────────────
  // Pick placeholder. Permission active wins over setup, which wins over task.
  const placeholderText =
    view.permission || view.composer.setupActive
      ? view.composer.placeholder
      : view.viewMode === "task" || view.viewMode === "pending"
        ? view.composer.taskPlaceholder
        : view.composer.placeholder;

  const { lines, truncatedAbove, truncatedBelow, cursorCol, cursorRow } = formatComposerRenderLines(
    {
      buffer,
      placeholder: placeholderText,
      masking: view.composer.masking,
      noColor,
      maxWidth,
    },
  );

  // Position native cursor — anchored to Composer's outer Box via parent-chain
  // accumulation. Composer only declares row/col; absolute coordinates are
  // resolved by useAnchoredCursor against ink-root in the render phase.
  // Permission-exclusive focus: while a permission card is on screen, the
  // selector row owns the visible focus. The native cursor MUST NOT also be
  // positioned over the buffer line; otherwise the user sees two competing
  // focus owners. We pass null so useAnchoredCursor hides the cursor instead.
  // Task-mode fallback: real-machine smoke showed yoga parent-chain cursor
  // accumulation drifting on Win10 conhost when the Composer band sits below
  // a flexGrow output region. Task mode therefore yields the native cursor
  // (declared=null) and renders an inline reverse-video cursor character at
  // (cursorRow, cursorCol). Home keeps native cursor for parity with the
  // 80-col centered composer.
  // Truncation indicator rows have been removed (cursor-centered viewport
  // already conveys overflow), so cursorRow is used as-is without an offset.
  void truncatedAbove;
  void truncatedBelow;
  const isTaskMode = view.viewMode === "task" || view.viewMode === "pending";
  const useInlineCursor = isTaskMode && !permissionActive;
  const declaredRow = cursorRow;
  useAnchoredCursor(
    permissionActive || useInlineCursor ? null : { row: declaredRow, col: cursorCol },
    anchorRef,
    capability,
  );

  const placeholderColor = noColor ? undefined : "gray";
  const color = text ? undefined : placeholderColor;

  const showSuggestions =
    !permissionActive && slashCandidates.length > 0 && slashSelection >= 0 && !slashHidden;

  // Unknown slash hint: only after the user pressed Enter with an unknown
  // command. The composer no longer pesters the user mid-typing.
  const showUnknownHint = false;

  return (
    <Box flexDirection="column" width={maxWidth}>
      {permissionActive ? (
        <PermissionActionRow
          actions={permissionActions}
          focused={permissionFocus}
          theme={theme}
          width={maxWidth}
        />
      ) : null}
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
      <Box ref={anchorRef} width="100%" flexDirection="column">
        {lines.map((line, index) => {
          if (useInlineCursor && index === cursorRow) {
            const segs = splitLineAtDisplayCol(line, cursorCol);
            return (
              <Text key={`${index}-${line}`} color={color} bold={Boolean(text)}>
                {segs.before}
                <Text inverse>{segs.cursorChar}</Text>
                {segs.after}
              </Text>
            );
          }
          return (
            <Text key={`${index}-${line}`} color={color} bold={Boolean(text)}>
              {fitText(line, maxWidth)}
            </Text>
          );
        })}
      </Box>
      {showUnknownHint ? (
        <Text color={theme.muted}>
          {fitText(formatUnknownSlashCommand(text, view.language), maxWidth)}
        </Text>
      ) : null}
      {hintNotice ? <Text color={theme.muted}>{fitText(hintNotice, maxWidth)}</Text> : null}
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
  // Narrow-screen guard: at 40/60 columns the inline action row would overflow.
  // Fall back to a vertical column layout below ~64 columns so each action
  // gets its own line and stays inside the composer width.
  const inlineLine = segments.map((s) => s.text).join(" ");
  const compact = width < 64 || inlineLine.length > Math.max(20, width - 2);
  if (compact) {
    return (
      <Box flexDirection="column" width={width}>
        {segments.map((s) => (
          <Text key={s.id} color={s.focused ? theme.accent : theme.muted} bold={s.focused}>
            {fitText(s.text, Math.max(8, width - 2))}
          </Text>
        ))}
      </Box>
    );
  }
  return (
    <Box width={width}>
      <Text>
        {segments.map((s) => (
          <Text key={s.id} color={s.focused ? theme.accent : theme.muted} bold={s.focused}>
            {`${s.text} `}
          </Text>
        ))}
      </Text>
    </Box>
  );
}

function buildPermissionActions(
  actions?: { id: PermissionActionId; label: string; shortcut?: string }[],
): { id: PermissionActionId; label: string; shortcut?: string }[] {
  if (actions && actions.length > 0) return actions;
  return [
    { id: "yes", label: "Allow", shortcut: "y" },
    { id: "no", label: "Deny", shortcut: "n" },
    { id: "details", label: "Details", shortcut: "d" },
    { id: "cancel", label: "Cancel" },
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
  return ids[next] ?? ids[0] ?? "yes";
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
  truncatedAbove: number;
  truncatedBelow: number;
  cursorCol: number;
  cursorRow: number;
};

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
}): ComposerRenderResult {
  void noColor;
  const text = bufferToString(buffer);
  const displayText = text ? (masking ? "*".repeat(buffer.chars.length) : text) : "";

  if (!displayText) {
    const line = `${PROMPT_MARKER}${placeholder}`;
    return {
      lines: [line],
      truncatedAbove: 0,
      truncatedBelow: 0,
      cursorCol: displayWidthOf(PROMPT_MARKER),
      cursorRow: 0,
    };
  }

  const rawLines = displayText.split("\n");
  const { row: cursorLineIndex, col: cursorCharCol } = getCursorLinePosition(buffer);

  // ─── Multi-line viewport: cursor-centered ────────────────────────────────
  const totalLines = rawLines.length;
  let startLine = 0;
  let endLineExclusive = totalLines;
  if (totalLines > COMPOSER_MAX_VISIBLE_LINES) {
    const half = Math.floor(COMPOSER_MAX_VISIBLE_LINES / 2);
    startLine = Math.max(0, cursorLineIndex - half);
    endLineExclusive = startLine + COMPOSER_MAX_VISIBLE_LINES;
    if (endLineExclusive > totalLines) {
      endLineExclusive = totalLines;
      startLine = endLineExclusive - COMPOSER_MAX_VISIBLE_LINES;
    }
  }
  const truncatedAbove = startLine;
  const truncatedBelow = totalLines - endLineExclusive;

  const visibleLines = rawLines.slice(startLine, endLineExclusive);
  const isFirstVisibleAtTop = startLine === 0;

  // ─── Single-line horizontal viewport ─────────────────────────────────────
  const composerWidth = Math.max(8, maxWidth ?? 80);
  // Reserve room for the prompt marker on the cursor's line.
  const promptForCursor =
    cursorLineIndex === startLine && isFirstVisibleAtTop
      ? PROMPT_MARKER
      : PROMPT_MARKER_CONTINUATION;
  const promptWidth = displayWidthOf(promptForCursor);
  const lineBudget = Math.max(4, composerWidth - promptWidth);

  // Compute display width of the cursor column on its raw line.
  const cursorRawLineRaw = rawLines[cursorLineIndex] ?? "";
  const cursorRawLineDisplay = masking ? "*".repeat(cursorRawLineRaw.length) : cursorRawLineRaw;
  const cursorRawChars = Array.from(cursorRawLineDisplay);
  let cursorDisplayCol = 0;
  for (let i = 0; i < cursorCharCol && i < cursorRawChars.length; i++) {
    cursorDisplayCol += charWidth(cursorRawChars[i] ?? "");
  }

  // Choose horizontal window per visible line. We only horizontally clip the
  // cursor's line aggressively; non-cursor lines are clipped to the same
  // budget but with a left-anchored window for a stable visual.
  const ELLIPSIS = "…";
  const ELLIPSIS_WIDTH = 1;

  const renderedLines: string[] = [];
  let cursorOutCol = 0;
  for (let visibleIndex = 0; visibleIndex < visibleLines.length; visibleIndex++) {
    const lineRaw = visibleLines[visibleIndex] ?? "";
    const lineDisplay = masking ? "*".repeat(lineRaw.length) : lineRaw;
    const isFirstLine = isFirstVisibleAtTop && visibleIndex === 0;
    const linePrompt = isFirstLine ? PROMPT_MARKER : PROMPT_MARKER_CONTINUATION;
    const linePromptWidth = displayWidthOf(linePrompt);
    const budget = Math.max(4, composerWidth - linePromptWidth);
    const isCursorLine = startLine + visibleIndex === cursorLineIndex;

    if (displayWidthOf(lineDisplay) <= budget) {
      renderedLines.push(`${linePrompt}${lineDisplay}`);
      if (isCursorLine) {
        cursorOutCol = linePromptWidth + cursorDisplayCol;
      }
      continue;
    }

    if (!isCursorLine) {
      // Non-cursor line: left-anchored, right-ellipsis.
      const sliced = sliceWidth(lineDisplay, budget - ELLIPSIS_WIDTH);
      renderedLines.push(`${linePrompt}${sliced}${ELLIPSIS}`);
      continue;
    }

    // Cursor line: cursor-centered horizontal viewport with side ellipses.
    const lineWidth = displayWidthOf(lineDisplay);
    const half = Math.max(2, Math.floor(budget / 2));
    let windowStart = Math.max(0, cursorDisplayCol - half);
    let windowEnd = windowStart + budget;
    if (windowEnd > lineWidth) {
      windowEnd = lineWidth;
      windowStart = Math.max(0, windowEnd - budget);
    }

    let leftEllipsis = "";
    let rightEllipsis = "";
    let effectiveStart = windowStart;
    let effectiveEnd = windowEnd;
    if (windowStart > 0) {
      leftEllipsis = ELLIPSIS;
      effectiveStart += ELLIPSIS_WIDTH;
    }
    if (windowEnd < lineWidth) {
      rightEllipsis = ELLIPSIS;
      effectiveEnd -= ELLIPSIS_WIDTH;
    }

    const sliced = sliceWindow(
      lineDisplay,
      effectiveStart,
      Math.max(0, effectiveEnd - effectiveStart),
    );
    renderedLines.push(`${linePrompt}${leftEllipsis}${sliced}${rightEllipsis}`);

    // Map cursor column into the rendered window.
    const cursorWithinWindow = cursorDisplayCol - effectiveStart;
    const clamped = Math.max(0, Math.min(cursorWithinWindow, effectiveEnd - effectiveStart));
    cursorOutCol = linePromptWidth + (leftEllipsis ? ELLIPSIS_WIDTH : 0) + clamped;
  }

  const cursorVisibleRow = Math.max(
    0,
    Math.min(cursorLineIndex - startLine, renderedLines.length - 1),
  );

  return {
    lines: renderedLines,
    truncatedAbove,
    truncatedBelow,
    cursorCol: maxWidth && cursorOutCol > maxWidth ? maxWidth : cursorOutCol,
    cursorRow: cursorVisibleRow,
  };
}

/** Slice the leading portion of `value` whose display width <= max. */
function sliceWidth(value: string, max: number): string {
  let width = 0;
  let result = "";
  for (const ch of value) {
    const next = width + charWidth(ch);
    if (next > max) break;
    result += ch;
    width = next;
  }
  return result;
}

/** Slice a window starting at display column `start` for up to `width` columns. */
function sliceWindow(value: string, start: number, width: number): string {
  let consumed = 0;
  let used = 0;
  let result = "";
  for (const ch of value) {
    const w = charWidth(ch);
    if (consumed < start) {
      consumed += w;
      continue;
    }
    if (used + w > width) break;
    result += ch;
    used += w;
  }
  return result;
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
 *   - cursorChar: the single character under the cursor (or " " if at line end)
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
    return { before: chars.join(""), cursorChar: " ", after: "" };
  }
  const before = chars.slice(0, i).join("");
  const cursorChar = chars[i] ?? " ";
  const after = chars.slice(i + 1).join("");
  return { before, cursorChar, after };
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
