/** Shared text utilities for shell components and plain renderer. */

import type { TerminalCapability } from "./terminal-capability.js";

export function fitText(value: string, max: number): string {
  if (max <= 0) return "";
  const chars = Array.from(value.replace(/\s+/gu, " ").trim());
  let width = 0;
  let result = "";
  for (const char of chars) {
    const next = width + charWidth(char);
    if (next > max) return `${result}...`;
    result += char;
    width = next;
  }
  return result;
}

export function wrapText(value: string, max: number): string[] {
  if (max <= 0) return [""];
  const normalized = value.replace(/\r/g, "");
  const out: string[] = [];
  for (const rawLine of normalized.split("\n")) {
    if (rawLine.length === 0) {
      out.push("");
      continue;
    }
    let line = "";
    let width = 0;
    for (const char of Array.from(rawLine)) {
      const nextWidth = charWidth(char);
      if (width > 0 && width + nextWidth > max) {
        out.push(line);
        line = char;
        width = nextWidth;
        continue;
      }
      line += char;
      width += nextWidth;
    }
    out.push(line);
  }
  return out.length > 0 ? out : [""];
}

const CJK_WIDE_CHAR_RE =
  /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/u;

export function charWidth(char: string): number {
  return CJK_WIDE_CHAR_RE.test(char) ? 2 : 1;
}

export function displayWidth(value: string): number {
  let width = 0;
  for (const char of value) width += charWidth(char);
  return width;
}

export type WrappedInputStateInput = {
  text: string;
  cursorOffset: number;
  width: number;
  prefixWidth?: number;
  paddingLeft?: number;
  paddingRight?: number;
  minContentWidth?: number;
};

export type WrappedInputState = {
  lines: string[];
  cursorRow: number;
  cursorCol: number;
  contentWidth: number;
};

export function computeWrappedInputState(input: WrappedInputStateInput): WrappedInputState {
  const normalizedText = String(input.text ?? "").replace(/\r/g, "");
  const chars = Array.from(normalizedText);
  const cursorOffset = clamp(input.cursorOffset, 0, chars.length);
  const safeWidth = Math.max(0, Math.floor(Number.isFinite(input.width) ? input.width : 0));
  const safePrefixWidth = Math.max(0, Math.floor(input.prefixWidth ?? 0));
  const safePaddingLeft = Math.max(0, Math.floor(input.paddingLeft ?? 0));
  const safePaddingRight = Math.max(0, Math.floor(input.paddingRight ?? 0));
  const safeMinContentWidth = Math.max(0, Math.floor(input.minContentWidth ?? 0));
  const contentWidth = Math.max(
    safeMinContentWidth,
    safeWidth - safePaddingLeft - safePaddingRight,
  );
  const firstLineWidth = Math.max(1, contentWidth - safePrefixWidth);
  const wrappedLines: string[] = [];
  let cursorRow = 0;
  let cursorCol = 0;
  let cursorResolved = false;
  const logicalLines = normalizedText.split("\n");
  let logicalLineStart = 0;
  let fallbackLineStart = 0;
  let fallbackLineChars: string[] = [];

  for (let logicalIndex = 0; logicalIndex < logicalLines.length; logicalIndex += 1) {
    const lineText = logicalLines[logicalIndex] ?? "";
    const lineChars = Array.from(lineText);
    const lineStartOffset = logicalLineStart;
    const lineEndOffset = lineStartOffset + lineChars.length;
    const wrapWidth = logicalIndex === 0 ? firstLineWidth : Math.max(1, contentWidth);
    const segments = wrapInputLine(lineChars, wrapWidth);

    fallbackLineStart = lineStartOffset;
    fallbackLineChars = lineChars;

    for (const segment of segments) {
      const segmentText = lineChars.slice(segment.start, segment.end).join("");
      wrappedLines.push(segmentText);

      if (!cursorResolved && cursorOffset >= lineStartOffset && cursorOffset <= lineEndOffset) {
        const lineCursorOffset = cursorOffset - lineStartOffset;
        if (lineCursorOffset >= segment.start && lineCursorOffset <= segment.end) {
          cursorRow = wrappedLines.length - 1;
          cursorCol = displayWidth(lineChars.slice(segment.start, lineCursorOffset).join(""));
          cursorResolved = true;
        }
      }
    }

    logicalLineStart += lineChars.length + 1;
  }

  if (!cursorResolved) {
    cursorRow = Math.max(0, wrappedLines.length - 1);
    cursorCol = displayWidth(
      fallbackLineChars
        .slice(0, clamp(cursorOffset - fallbackLineStart, 0, fallbackLineChars.length))
        .join(""),
    );
    if (chars.length === 0) cursorCol = 0;
  }

  return {
    lines: wrappedLines.length > 0 ? wrappedLines : [""],
    cursorRow,
    cursorCol,
    contentWidth,
  };
}

function wrapInputLine(chars: string[], wrapWidth: number): Array<{ start: number; end: number }> {
  const safeWrapWidth = Math.max(1, Math.floor(wrapWidth));
  const segments: Array<{ start: number; end: number }> = [];
  let start = 0;
  while (start < chars.length || (chars.length === 0 && start === 0)) {
    let end = start;
    let width = 0;
    while (end < chars.length) {
      const nextWidth = charWidth(chars[end] ?? "");
      if (width > 0 && width + nextWidth > safeWrapWidth) break;
      width += nextWidth;
      end += 1;
    }
    if (end === start && chars.length > 0) end += 1;
    segments.push({ start, end });
    if (chars.length === 0) break;
    start = end;
  }
  return segments;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

export function truncateDisplay(value: string, max: number): string {
  const normalized = String(value || "")
    .replace(/\s+/gu, " ")
    .trim();
  if (displayWidth(normalized) <= max) return normalized;
  if (max <= 0) return "";
  const chars = Array.from(normalized);
  let width = 0;
  let result = "";
  for (const char of chars) {
    const next = width + charWidth(char);
    if (next > max) return `${result}\u2026`;
    result += char;
    width = next;
  }
  return result;
}

export function truncateMiddle(value: string, max: number, fallback = ""): string {
  const normalized = String(value || fallback)
    .replace(/\s+/gu, " ")
    .trim();
  if (displayWidth(normalized) <= max) return normalized;
  if (max <= 1) return "\u2026";
  const head = Math.max(1, Math.floor((max - 1) / 2));
  const tail = Math.max(1, max - head - 1);
  return `${sliceDisplayFront(normalized, head)}\u2026${sliceDisplayBack(normalized, tail)}`;
}

function sliceDisplayFront(value: string, max: number): string {
  let width = 0;
  let result = "";
  for (const char of value) {
    const next = width + charWidth(char);
    if (next > max) break;
    result += char;
    width = next;
  }
  return result;
}

function sliceDisplayBack(value: string, max: number): string {
  const chars = Array.from(value);
  let width = 0;
  let result = "";
  for (let i = chars.length - 1; i >= 0; i -= 1) {
    const char = chars[i] ?? "";
    const next = width + charWidth(char);
    if (next > max) break;
    result = `${char}${result}`;
    width = next;
  }
  return result;
}

/** Shared composer width formula, kept consistent across Ink and plain renderer. */
export function composerMaxWidth(viewWidth: number): number {
  return Math.min(80, Math.max(40, viewWidth - 6));
}

/**
 * Task-mode composer width.
 *
 * Home keeps the centered 80-col composer that doubles as a brand frame.
 * Task mode is a working surface — the composer band should fill the terminal
 * width minus a small symmetric padding so long output (URLs, code, paste
 * payloads) is not artificially clipped at 80 columns. The minimum 40 keeps
 * narrow terminals readable; on wider terminals the band stretches.
 */
export function taskComposerMaxWidth(viewWidth: number): number {
  return Math.max(40, viewWidth - 4);
}

/**
 * Terminal-safe horizontal line character.
 * Legacy terminals get ASCII dash; modern/basic get box-drawing.
 */
export function lineChar(noColor: boolean, capability?: TerminalCapability): string {
  if (noColor) return "-";
  if (capability && !capability.unicodeBox) return "-";
  return "\u2500";
}

/**
 * Home brand wordmark.
 *
 * Foundation rule (D13D): the wordmark is a single, deterministic line
 * "LingHun" at every width and capability tier. ASCII art / Unicode
 * box-drawing wordmarks were intentionally removed — they break alignment
 * across terminals (CJK widths, mintty, conhost), introduce empty-string
 * spacer lines for vertical padding, and inflate the home view above the
 * fold. No version number is appended; no empty strings are used as
 * spacers (callers control vertical spacing via Box marginTop).
 */
export function brandWordmark(
  noColor: boolean,
  width = 80,
  capability?: TerminalCapability,
): string[] {
  void noColor;
  void width;
  void capability;
  return ["LingHun"];
}

/** Phase 14 — CCB-aligned brief timestamp by time gradient. */
export function formatBriefTimestamp(ms: number, language: "zh-CN" | "en-US"): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const dayDiff = startOfDay(now) - startOfDay(d);
  const daysAgo = Math.round(dayDiff / 86_400_000);
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

  if (daysAgo === 0) return time;

  if (daysAgo > 0 && daysAgo < 7) {
    if (language === "zh-CN") {
      return `${ZH_WEEKDAY[d.getDay()]} ${time}`;
    }
    return `${EN_WEEKDAY[d.getDay()]} ${time}`;
  }

  const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  return `${date} ${time}`;
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

const ZH_WEEKDAY = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const EN_WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
