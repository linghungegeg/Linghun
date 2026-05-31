import { Box, type DOMElement, Text, useInput } from "ink";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  formatUnknownSlashCommand,
  getCoreSlashCandidates,
  getSlashPrefixCandidates,
} from "../../slash-dispatch.js";
import { selectInputOwner } from "../models/input-owner-controller.js";
import type { TerminalCapability } from "../terminal-capability.js";
import { charWidth, composerMaxWidth, fitText, taskComposerMaxWidth } from "../text-utils.js";
import { createShellTheme } from "../theme.js";
import type {
  PermissionActionId,
  ShellInputEvent,
  ShellViewModel,
  TaskPermissionView,
} from "../types.js";
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

// D.13L Block E — 权限卡对齐 CCB：主屏只暴露 3 个动作 [是 / 始终允许 / 否]，
// 顺序 allow_once → allow_always_tool → deny。details / cancel 不再出现在
// PermissionActionRow / 单字母快捷键表，但 PermissionActionId 类型仍保留这两个值，
// 兼容已有 controller 路径（Esc 仍由 useInput 直接派发 cancel）。
const PERMISSION_ACTION_ORDER: PermissionActionId[] = ["allow_once", "allow_always_tool", "deny"];

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
const PASTE_COMPLETION_TIMEOUT_MS = 100;
// DOUBLE_PRESS_WINDOW_MS: 双击 Esc / Ctrl+C 的有效窗口（CCB ~1s）。
const DOUBLE_PRESS_WINDOW_MS = 1000;
const HINT_NOTICE_DECAY_MS = 1500;

export function Composer({ view, onInput, capability }: ComposerProps): React.ReactNode {
  const [buffer, setBuffer] = useState<EditBuffer>(createEditBuffer());
  const [slashSelection, setSlashSelection] = useState(0);
  const [slashHidden, setSlashHidden] = useState(false);
  const [permissionFocus, setPermissionFocus] = useState<PermissionActionId>("allow_once");
  const [hintNotice, setHintNotice] = useState<string | undefined>(undefined);
  const historyRef = useRef<InputHistory>(createInputHistory());
  const pasteChunksRef = useRef<string[]>([]);
  const pasteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pastePendingRef = useRef(false);
  const lastEscAtRef = useRef(0);
  const lastCtrlCAtRef = useRef(0);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // D.13Q-UX Real Smoke Fix v2 — B. task/pending 模式必须用 taskComposerMaxWidth，
  // 与 ShellApp.TaskLayout 的 cw 对齐；否则 useAnchoredCursor 的父链 Yoga 计算
  // 出来的 cursor 锚是 80-col 居中容器，而真正的 Composer 容器是 view.width-4，
  // 视觉上就会出现 cursor 漂移。
  const maxWidth =
    view.viewMode === "task" || view.viewMode === "pending"
      ? taskComposerMaxWidth(view.width)
      : composerMaxWidth(view.width);
  const noColor = view.themeMode === "no-color";
  const theme = useMemo(() => createShellTheme(noColor), [noColor]);
  const anchorRef = useRef<DOMElement | null>(null);

  // Permission active = a permission card is on screen and the composer is in
  // selector mode (key bindings change; ordinary chars do NOT enter the buffer).
  const permissionActive = Boolean(view.permission);
  const permissionActions = useMemo(
    () => buildPermissionActions(view.language, view.permission?.actions),
    [view.language, view.permission],
  );

  // D.13E Step 2 修正 #1：ConfigPanel 渲染时 Composer.useInput 必须 isActive=false，
  // 让 ConfigPanel/HelpPanel/BtwPanel/SessionsPanel 等独立面板自己的 useInput 成为 ↑↓/Enter/Esc
  // 的唯一消费者，避免双消费窗口。permission 优先级最高（permission 渲染时其它面板不渲染，
  // ShellApp 互斥保证）。D.13Q-UX Task Surface：commandPanel 同样独占 Esc，
  // Composer 在 commandPanel 渲染时也应让出输入。
  const configPanelActive = Boolean(
    view.configPanel || view.helpPanel || view.btwPanel || view.sessionsPanel || view.commandPanel,
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
      // D.13Q-UX Real Smoke Fix v2 — E. 全部走结构化 permission-action 事件，
      // 不再把 yes / allow_once / allow_always_tool / no 这类内部 id 当成 text
      // 通过 submit 文本路径回灌（避免被 handleNaturalInput 当用户正常发言）。
      // cancel 仍上抛 escape 关闭面板（与既有交互链兼容）。
      if (id === "cancel") {
        void onInput({ type: "escape" });
        return;
      }
      void onInput({ type: "permission-action", actionId: id });
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

  useInput(
    (input, key) => {
      // D.13E Step 2 — Owner-priority dispatcher 显式化：
      // 用 selectInputOwner 决定本次事件归属，permission > paste > slash > composer。
      const owner = selectInputOwner(input, key, {
        permissionActive,
        pastePending: pastePendingRef.current,
        slashVisible: slashCandidates.length > 0 && !slashHidden,
      });

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
          //   a → allow_always_tool（持久化 allow rule + 当次 approve）
          //   n → deny（拒绝；旧 no 别名同义）
          // details / cancel 不再走单字母路径；Esc 仍触发 cancel 关闭权限卡。
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
        }
        // 其他按键吞掉，避免 buffer 被污染。
        return;
      }

      // ─── 2. Paste 聚合（次高优先级）────────────────────────────────────
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

      // ─── 3. Slash candidates owner（统一消费并 return；禁止 fall-through）────
      const slashVisible = slashCandidates.length > 0 && !slashHidden;
      if (owner === "slash") {
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
        if (key.return && !key.shift) {
          if (slashSelection >= 0 && !text.includes(" ")) {
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
          void onInput(
            submitText ? { type: "submit", text: submitText } : { type: "empty-submit" },
          );
          return;
        }
        // 兜底 — slash owner 内未命中明确分支：吞掉，避免 fall-through 到 composer。
        return;
      }

      // ─── 4. Composer default owner ────────────────────────────────────────

      // D.13Q-UX Task Surface — 任务区滚动键（PageUp / PageDown / End）。
      // 方向语义：scrollOffset = 从底部向上偏移的行数。
      //   - PgUp / wheel-up / 空 buffer ↑ → 向上看更早内容 → delta=+N（offset 增大）
      //   - PgDn / wheel-down / 空 buffer ↓ → 向下回到更新内容 → delta=-N
      //   - End → task-scroll-end，offset 归零
      // 仅在 task / pending 模式生效；home 模式无 transcript 滚动需求。
      const inTaskMode = view.viewMode === "task" || view.viewMode === "pending";
      const k = key as { pageUp?: boolean; pageDown?: boolean; end?: boolean; home?: boolean };
      if (inTaskMode && k.pageUp) {
        void onInput({ type: "task-scroll", delta: 5 });
        return;
      }
      if (inTaskMode && k.pageDown) {
        void onInput({ type: "task-scroll", delta: -5 });
        return;
      }
      if (inTaskMode && k.end && text.length === 0) {
        void onInput({ type: "task-scroll-end" });
        return;
      }

      // ─── Submit: Enter（无 shift）─────────────────────────────────────
      if (key.return && !key.shift) {
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
      // D.13Q-UX Task Surface — 鼠标滚轮归属：在 task/pending 模式下 buffer 为空时，
      // ↑↓ 派发 task-scroll（Win10 conhost 等终端把 wheel 报告为 ↑↓），让滚轮
      // 滚动 transcript 而不是切 history。buffer 非空时仍走 history（用户已经
      // 在打字，明确在用键盘 ↑↓ 翻 history 草稿）。
      const inTaskModeWheel = view.viewMode === "task" || view.viewMode === "pending";
      if (key.upArrow) {
        if (slashVisible && slashSelection >= 0) {
          setSlashSelection((current) => {
            const safe = current < 0 ? 0 : current;
            return safe === 0 ? slashCandidates.length - 1 : safe - 1;
          });
          return;
        }
        if (inTaskModeWheel && text.length === 0) {
          void onInput({ type: "task-scroll", delta: 1 });
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
        if (inTaskModeWheel && text.length === 0) {
          void onInput({ type: "task-scroll", delta: -1 });
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

      // D.13Q-UX Ctrl+O — 查看完整内容：派发 toggle-details 事件，由 onInput
      // 路由到 handleDetailsCommand。**不再 submit "/details"**，避免 transcript
      // 命令行里冒出 ❯ /details；/details slash 仍保留为兼容命令，但用户按
      // Ctrl+O 时不应当作 slash 提交。
      if (key.ctrl && input === "o") {
        clearHintNotice();
        void onInput({ type: "toggle-details" });
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
    },
    // D.13E Step 2 修正 #1：ConfigPanel 渲染时 isActive=false，让 ConfigPanel
    // 自己的 useInput 独占 ↑↓/Enter/Esc，避免双消费。
    { isActive: !configPanelActive },
  );

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
  // D.13Q-UX Task Surface — 光标分层（用户实测在 task / pending 模式下出现
  // 1-2 行错位，且任务区滚动后 yoga marginTop 不进 getComputedLayout，使
  // parent-chain accumulation 给出的 y 坐标不再可靠）：
  //   - home: useAnchoredCursor 原生光标（Yoga parent-chain 在居中容器下稳定）。
  //   - task / pending: 让出 native cursor（declared=null），改用 inline
  //     reverse-video cursor（splitLineAtDisplayCol 在 cursorRow 行做拆分），
  //     不依赖父链坐标。
  //   - permissionActive: 永远隐藏 native cursor，让 PermissionControl 独占焦点。
  void truncatedAbove;
  void truncatedBelow;
  const isTaskMode = view.viewMode === "task" || view.viewMode === "pending";
  // D.13Q-UX Task Surface — task / pending 模式下让出 native cursor，改用 inline
  // reverse-video cursor。useInlineCursor 与 permissionActive 任一为真都要把
  // useAnchoredCursor 切到 null（permission 卡独占焦点 / inline cursor 自己画）。
  const useInlineCursor = isTaskMode;
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
      {permissionActive && view.permission ? (
        <PermissionControl
          permission={view.permission}
          actions={permissionActions}
          focused={permissionFocus}
          theme={theme}
          width={maxWidth}
          language={view.language}
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
          // D.13Q-UX Task Surface — task / pending 模式 + 非 permission 时，
          // 在 cursorRow 这一行渲染 inline reverse-video cursor；其他行原样渲染。
          // home 模式仍用 useAnchoredCursor 的 native cursor，这里直接原样渲染。
          if (useInlineCursor && !permissionActive && index === cursorRow) {
            const { before, cursorChar, after } = splitLineAtDisplayCol(line, cursorCol);
            return (
              <Text key={`${index}-${line}`} color={color} bold={Boolean(text)}>
                {fitText(before, maxWidth)}
                <Text inverse>{cursorChar}</Text>
                {fitText(after, Math.max(0, maxWidth - before.length - 1))}
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
      <PermissionActionRow actions={actions} focused={focused} theme={theme} width={innerWidth} />
      <Text color={theme.dim ?? theme.muted} dimColor>
        {fitText(
          isEn ? "Enter confirm · Tab switch · Esc cancel" : "Enter 确认 · Tab 切换 · Esc 取消",
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
  language: ShellViewModel["language"],
  _actions?: { id: PermissionActionId; label: string; shortcut?: string }[],
): { id: PermissionActionId; label: string; shortcut?: string }[] {
  // D.13L Section 2 — 主屏权限卡固定 3 动作 [是 / 始终允许 / 否]，
  // 不再读 view.permission.actions：避免 buildElevationOptions 因
  // 已存在的 allow rule 把 allow_always_tool 过滤掉，导致主屏丢按钮。
  // 用户始终能在主屏看到"是 / 始终允许 / 否"完整选择；底层 controller
  // 仍以 allowList 作为持久化判定来源，行为不变。
  const isEn = language === "en-US";
  return [
    { id: "allow_once", label: isEn ? "Yes" : "是", shortcut: "y" },
    { id: "allow_always_tool", label: isEn ? "Always allow" : "始终允许", shortcut: "a" },
    { id: "deny", label: isEn ? "No" : "否", shortcut: "n" },
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
