/**
 * Output formatting utilities for terminal display
 * Based on CCB's behavior without copying implementation
 */

import type { Language } from "@linghun/shared";

const MAX_LINES_TO_SHOW = 3;
const PADDING_TO_PREVENT_OVERFLOW = 10;

/**
 * Calculate visible width of a string (ANSI-aware)
 * Simple implementation: count characters excluding ANSI escape sequences
 */
function getVisibleWidth(text: string): number {
  // Remove ANSI escape sequences
  // eslint-disable-next-line no-control-regex
  const withoutAnsi = text.replace(/\x1b\[[0-9;]*m/g, "");
  // Simple character count (not fully Unicode-aware, but good enough)
  return withoutAnsi.length;
}

/**
 * Slice a string at a specific visible position (ANSI-aware)
 * Preserves ANSI escape sequences
 */
function sliceAnsi(text: string, start: number, end: number): string {
  let visiblePos = 0;
  let result = "";
  let inEscape = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    // Detect ANSI escape sequence start
    if (char === "\x1b" && text[i + 1] === "[") {
      inEscape = true;
      result += char;
      continue;
    }

    if (inEscape) {
      result += char;
      if (char === "m") {
        inEscape = false;
      }
      continue;
    }

    // Count visible characters
    if (visiblePos >= start && visiblePos < end) {
      result += char;
    }
    visiblePos++;

    if (visiblePos >= end) {
      break;
    }
  }

  return result;
}

/**
 * Wrap text to fit terminal width, breaking long lines
 */
function wrapText(
  text: string,
  wrapWidth: number,
): { aboveTheFold: string; remainingLines: number } {
  const lines = text.split("\n");
  const wrappedLines: string[] = [];

  for (const line of lines) {
    const visibleWidth = getVisibleWidth(line);
    if (visibleWidth <= wrapWidth) {
      wrappedLines.push(line.trimEnd());
    } else {
      // Break long lines into chunks
      let position = 0;
      while (position < visibleWidth) {
        const chunk = sliceAnsi(line, position, position + wrapWidth);
        wrappedLines.push(chunk.trimEnd());
        position += wrapWidth;
      }
    }
  }

  const remainingLines = wrappedLines.length - MAX_LINES_TO_SHOW;

  // If only 1 line remaining, show it instead of "+1 line"
  if (remainingLines === 1) {
    return {
      aboveTheFold: wrappedLines
        .slice(0, MAX_LINES_TO_SHOW + 1)
        .join("\n")
        .trimEnd(),
      remainingLines: 0,
    };
  }

  return {
    aboveTheFold: wrappedLines.slice(0, MAX_LINES_TO_SHOW).join("\n").trimEnd(),
    remainingLines: Math.max(0, remainingLines),
  };
}

/**
 * Render content with smart truncation and wrapping
 */
export function renderTruncatedContent(
  content: string,
  terminalWidth: number,
  language: Language = "zh-CN",
): string {
  const trimmedContent = content.trimEnd();
  if (!trimmedContent) {
    return "";
  }

  const wrapWidth = Math.max(terminalWidth - PADDING_TO_PREVENT_OVERFLOW, 10);

  // Performance optimization: only process what we need to display
  const maxChars = MAX_LINES_TO_SHOW * wrapWidth * 4;
  const preTruncated = trimmedContent.length > maxChars;
  const contentForWrapping = preTruncated
    ? trimmedContent.slice(0, maxChars)
    : trimmedContent;

  const { aboveTheFold, remainingLines } = wrapText(contentForWrapping, wrapWidth);

  const estimatedRemaining = preTruncated
    ? Math.max(
        remainingLines,
        Math.ceil(trimmedContent.length / wrapWidth) - MAX_LINES_TO_SHOW,
      )
    : remainingLines;

  if (estimatedRemaining > 0) {
    const expandHint = language === "zh-CN" ? "（按 Ctrl+O 展开）" : "(ctrl+o to expand)";
    return `${aboveTheFold}\n… +${estimatedRemaining} ${language === "zh-CN" ? "行" : "lines"} ${expandHint}`;
  }

  return aboveTheFold;
}

/**
 * Try to format a single line as JSON
 */
export function tryFormatJsonLine(line: string): string {
  try {
    const parsed = JSON.parse(line);
    const formatted = JSON.stringify(parsed, null, 2);
    return formatted;
  } catch {
    return line;
  }
}

/**
 * Try to format content as JSON (line by line)
 */
export function tryJsonFormatContent(content: string): string {
  const MAX_JSON_FORMAT_LENGTH = 10_000;
  if (content.length > MAX_JSON_FORMAT_LENGTH) {
    return content;
  }

  const lines = content.split("\n");
  return lines.map(tryFormatJsonLine).join("\n");
}

/**
 * Fast check: would content be truncated?
 */
export function isContentTruncated(content: string): boolean {
  let pos = 0;
  for (let i = 0; i <= MAX_LINES_TO_SHOW; i++) {
    pos = content.indexOf("\n", pos);
    if (pos === -1) return false;
    pos++;
  }
  return pos < content.length;
}
