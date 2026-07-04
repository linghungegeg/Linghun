import type { Writable } from "node:stream";
import type { TranscriptViewportGeometryView } from "./types.js";

export type TerminalHistoryInsertOptions = {
  viewportGeometry?: TranscriptViewportGeometryView;
  terminalRows?: number;
  clearBefore?: boolean;
  // Explicit frame-top row (1-indexed) for the history boundary, derived from
  // the live terminal height (stdout.rows - frameHeight) instead of the
  // possibly-stale view geometry captured at commit time. When present this
  // wins over viewportGeometry.y so user rows committed the instant Enter is
  // pressed land at the correct boundary too.
  frameTopRow?: number;
};

export function insertTerminalHistoryText(
  output: Writable,
  text: string,
  options: TerminalHistoryInsertOptions,
): boolean {
  const historyBoundary = resolveHistoryBoundary(options);
  if (!historyBoundary) return false;
  const lines = splitRenderedLines(text);
  if (lines.length === 0) return true;

  const restoreScrollRegion =
    options.frameTopRow && options.terminalRows
      ? `\x1B[${options.frameTopRow};${options.terminalRows}r`
      : "\x1B[r";

  const sequence = [
    options.clearBefore ? "\x1B[r\x1B[2J\x1B[H" : "",
    "\x1B[s",
    `\x1B[1;${historyBoundary}r`,
    `\x1B[${historyBoundary};1H`,
    ...lines.map((line) => `\r\n${line}\x1B[K`),
    restoreScrollRegion,
    "\x1B[u",
  ].join("");
  output.write(sequence);
  return true;
}

export function canInsertTerminalHistoryText(options: TerminalHistoryInsertOptions): boolean {
  return Boolean(resolveHistoryBoundary(options));
}

function resolveHistoryBoundary(options: TerminalHistoryInsertOptions): number | undefined {
  const terminalRows = options.terminalRows ? Math.floor(options.terminalRows) : undefined;
  // Plan B fix: prefer the explicit frame-top row derived from live terminal
  // height. This is valid at any moment (including the instant Enter is
  // pressed), so user rows are no longer dropped when the view geometry has
  // not settled yet.
  if (options.frameTopRow !== undefined) {
    const boundary = Math.floor(options.frameTopRow);
    if (boundary <= 1) return undefined;
    if (terminalRows && boundary > terminalRows) return undefined;
    return boundary;
  }
  const geometry = options.viewportGeometry;
  if (!geometry) return undefined;
  const historyBoundary = Math.floor(geometry.y);
  if (historyBoundary <= 1) return undefined;
  if (terminalRows && historyBoundary > terminalRows) return undefined;
  return historyBoundary;
}

function splitRenderedLines(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line, index, lines) => line.length > 0 || index < lines.length - 1);
}
