import {
  type SyntaxDiffLine,
  inferDiffFilePath,
  renderSyntaxHighlightedDiffHunk,
} from "./diff-syntax-highlighter.js";
import { displayWidth, wrapText } from "./text-utils.js";

import type { ShellTheme } from "./theme.js";

export type PlainDiffRendererOptions = {
  noColor: boolean;
  wrapWidth: number;
  prefix?: string;
  theme?: ShellTheme;
  filePath?: string;
};

export type DiffLineKind = "fileHeader" | "metadata" | "hunk" | "add" | "remove" | "context";

export type ParsedDiffLine = {
  kind: DiffLineKind;
  text: string;
  oldLine?: number;
  newLine?: number;
};

const ESC = "\x1B[";
const RESET = `${ESC}0m`;

function ansi(code: string, text: string, noColor: boolean): string {
  if (noColor) return text;
  return `${ESC}${code}m${text}${RESET}`;
}

function ansiColor(color: string | undefined, text: string, noColor: boolean): string {
  if (noColor || !color) return text;
  const code = ansiColorCode(color);
  return code ? ansi(code, text, false) : text;
}

function ansiColorCode(color: string): string | undefined {
  const normalized = color.trim();
  const named: Record<string, string> = {
    black: "30",
    red: "31",
    green: "32",
    yellow: "33",
    blue: "34",
    magenta: "35",
    cyan: "36",
    white: "37",
    redBright: "91",
    greenBright: "92",
    yellowBright: "93",
    blueBright: "94",
    magentaBright: "95",
    cyanBright: "96",
    whiteBright: "97",
  };
  if (named[normalized]) return named[normalized];
  const hex = normalized.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/iu);
  if (!hex) return undefined;
  const red = Number.parseInt(hex[1] ?? "0", 16);
  const green = Number.parseInt(hex[2] ?? "0", 16);
  const blue = Number.parseInt(hex[3] ?? "0", 16);
  return `38;2;${red};${green};${blue}`;
}

function dim(text: string, noColor: boolean): string {
  return ansi("2", text, noColor);
}

function green(text: string, noColor: boolean): string {
  return ansi("32", text, noColor);
}

function red(text: string, noColor: boolean): string {
  return ansi("31", text, noColor);
}

function cyan(text: string, noColor: boolean): string {
  return ansi("36", text, noColor);
}

const WORD_DIFF_LINE_LIMIT = 80;
const WORD_DIFF_CHAR_LIMIT = 240;

export function isDiffFenceLanguage(lang: string | undefined): boolean {
  const normalized = lang?.toLowerCase();
  return normalized === "diff" || normalized === "patch";
}

export function renderPlainDiffLines(
  rawLines: string[],
  options: PlainDiffRendererOptions,
): string[] {
  const prefix = options.prefix ?? "  | ";
  const parsed = parseDiffLines(rawLines);
  const wordHighlights = computeWordHighlights(parsed);
  const lineNumberWidth = computeLineNumberWidth(parsed);
  const gutterWidth = lineNumberWidth * 2 + 5;
  const contentWidth = Math.max(8, options.wrapWidth - displayWidth(prefix) - gutterWidth);
  const syntaxHighlights = computeSyntaxHighlights(parsed, rawLines, options, contentWidth);
  const rendered: string[] = [];

  for (const line of parsed) {
    if (line.kind === "fileHeader" || line.kind === "metadata") {
      rendered.push(`${dim(prefix, options.noColor)}${dim(line.text || " ", options.noColor)}`);
      continue;
    }
    if (line.kind === "hunk") {
      rendered.push(
        `${dim(prefix, options.noColor)}${
          ansiColor(
            options.theme?.accent ?? options.theme?.diagnostic,
            line.text || " ",
            options.noColor,
          ) || cyan(line.text || " ", options.noColor)
        }`,
      );
      continue;
    }

    const oldText = formatLineNumber(line.oldLine, lineNumberWidth);
    const newText = formatLineNumber(line.newLine, lineNumberWidth);
    const marker = markerFor(line.kind);
    const gutter = `${oldText} ${newText} ${marker} `;
    const continuationGutter = `${" ".repeat(lineNumberWidth)} ${" ".repeat(lineNumberWidth)}   `;
    const body = line.text.length === 0 ? " " : line.text;
    const wrapped = wrapText(body, contentWidth);

    wrapped.forEach((part, index) => {
      const rawGutter = index === 0 ? gutter : continuationGutter;
      const bodyPart = index === 0 ? part : part.trimStart();
      const highlight = wordHighlights.get(line);
      const syntaxHighlight = syntaxHighlights.get(line);
      const styledGutter = colorByKind(rawGutter, line.kind, options.noColor, true, options.theme);
      const styledBody =
        index === 0 && wrapped.length === 1 && !highlight && syntaxHighlight
          ? syntaxHighlight
          : styleDiffBody(
              bodyPart.length === 0 ? " " : bodyPart,
              line,
              highlight,
              options.noColor,
              options.theme,
            );
      rendered.push(`${dim(prefix, options.noColor)}${styledGutter}${styledBody}`);
    });
  }

  return rendered;
}

export function parseDiffLines(rawLines: string[]): ParsedDiffLine[] {
  const parsed: ParsedDiffLine[] = [];
  let oldLine = 1;
  let newLine = 1;

  for (const raw of rawLines) {
    const hunk = parseHunkHeader(raw);
    if (hunk) {
      oldLine = hunk.oldStart;
      newLine = hunk.newStart;
      parsed.push({ kind: "hunk", text: raw });
      continue;
    }

    if (isFileHeaderLine(raw)) {
      parsed.push({ kind: "fileHeader", text: raw });
      continue;
    }

    if (isMetadataLine(raw)) {
      parsed.push({ kind: "metadata", text: raw });
      continue;
    }

    if (raw.startsWith("+") && !raw.startsWith("+++")) {
      parsed.push({ kind: "add", text: raw.slice(1), newLine });
      newLine += 1;
      continue;
    }

    if (raw.startsWith("-") && !raw.startsWith("---")) {
      parsed.push({ kind: "remove", text: raw.slice(1), oldLine });
      oldLine += 1;
      continue;
    }

    const text = raw.startsWith(" ") ? raw.slice(1) : raw;
    parsed.push({ kind: "context", text, oldLine, newLine });
    oldLine += 1;
    newLine += 1;
  }

  return parsed;
}

function parseHunkHeader(line: string): { oldStart: number; newStart: number } | undefined {
  const match = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/u);
  if (!match) return undefined;
  return {
    oldStart: Number.parseInt(match[1] ?? "1", 10),
    newStart: Number.parseInt(match[2] ?? "1", 10),
  };
}

function isFileHeaderLine(line: string): boolean {
  return line.startsWith("--- ") || line.startsWith("+++ ");
}

function isMetadataLine(line: string): boolean {
  return (
    line.startsWith("diff --git ") ||
    line.startsWith("index ") ||
    line.startsWith("rename from ") ||
    line.startsWith("rename to ") ||
    line.startsWith("new file mode ") ||
    line.startsWith("deleted file mode ") ||
    line.startsWith("similarity index ") ||
    line.startsWith("dissimilarity index ") ||
    line.startsWith("\\ No newline at end of file")
  );
}

export function computeLineNumberWidth(lines: ParsedDiffLine[]): number {
  let max = 0;
  for (const line of lines) {
    if (line.oldLine !== undefined) max = Math.max(max, line.oldLine);
    if (line.newLine !== undefined) max = Math.max(max, line.newLine);
  }
  return Math.max(1, String(max).length);
}

export function formatLineNumber(value: number | undefined, width: number): string {
  return value === undefined ? " ".repeat(width) : String(value).padStart(width, " ");
}

export function markerFor(kind: DiffLineKind): string {
  if (kind === "add") return "+";
  if (kind === "remove") return "-";
  return " ";
}

type DiffBodyHighlight = {
  changedParts: Set<string>;
};

type DiffSyntaxLine = Extract<DiffLineKind, "add" | "remove" | "context">;

function computeSyntaxHighlights(
  lines: ParsedDiffLine[],
  rawLines: string[],
  options: PlainDiffRendererOptions,
  contentWidth: number,
): Map<ParsedDiffLine, string> {
  const filePath = options.filePath ?? inferDiffFilePath(rawLines);
  const highlights = new Map<ParsedDiffLine, string>();
  if (!filePath || options.noColor) return highlights;

  let hunkHeader: string | undefined;
  let hunkLines: ParsedDiffLine[] = [];
  const flushHunk = (): void => {
    if (hunkLines.length === 0) return;
    const syntaxLines: SyntaxDiffLine[] = hunkLines.map((line) => ({
      kind: line.kind as DiffSyntaxLine,
      text: line.text,
    }));
    const rendered = renderSyntaxHighlightedDiffHunk({
      filePath,
      hunkHeader,
      lines: syntaxLines,
      themeKey: syntaxThemeKey(options.theme),
      width: contentWidth,
      noColor: options.noColor,
    });
    rendered?.forEach((value, index) => {
      const line = hunkLines[index];
      if (line && value) highlights.set(line, value);
    });
    hunkLines = [];
  };

  for (const line of lines) {
    if (line.kind === "hunk") {
      flushHunk();
      hunkHeader = line.text;
      continue;
    }
    if (line.kind === "fileHeader" || line.kind === "metadata") {
      flushHunk();
      continue;
    }
    hunkLines.push(line);
  }
  flushHunk();
  return highlights;
}

function syntaxThemeKey(theme: ShellTheme | undefined): string {
  return [theme?.mode ?? "default", theme?.inlineCode ?? "", theme?.accent ?? ""].join(":");
}

function computeWordHighlights(lines: ParsedDiffLine[]): Map<ParsedDiffLine, DiffBodyHighlight> {
  const changed = lines.filter((line) => line.kind === "add" || line.kind === "remove");
  const changedChars = changed.reduce((total, line) => total + line.text.length, 0);
  if (
    changed.length > WORD_DIFF_LINE_LIMIT ||
    changedChars > WORD_DIFF_LINE_LIMIT * WORD_DIFF_CHAR_LIMIT
  ) {
    return new Map();
  }

  const highlights = new Map<ParsedDiffLine, DiffBodyHighlight>();
  for (let index = 0; index < lines.length - 1; index += 1) {
    const current = lines[index];
    const next = lines[index + 1];
    if (!current || !next || current.kind !== "remove" || next.kind !== "add") continue;
    if (current.text.length > WORD_DIFF_CHAR_LIMIT || next.text.length > WORD_DIFF_CHAR_LIMIT)
      continue;
    const oldParts = tokenizeDiffBody(current.text);
    const newParts = tokenizeDiffBody(next.text);
    const oldChanged = changedTokenSet(oldParts, newParts);
    const newChanged = changedTokenSet(newParts, oldParts);
    if (oldChanged.size > 0) highlights.set(current, { changedParts: oldChanged });
    if (newChanged.size > 0) highlights.set(next, { changedParts: newChanged });
  }
  return highlights;
}

function tokenizeDiffBody(value: string): string[] {
  return value.match(/\w+|\s+|[^\w\s]+/gu) ?? [value];
}

function changedTokenSet(primary: string[], other: string[]): Set<string> {
  const counts = new Map<string, number>();
  for (const part of other) counts.set(part, (counts.get(part) ?? 0) + 1);
  const changed = new Set<string>();
  for (const part of primary) {
    if (/^\s+$/u.test(part)) continue;
    const count = counts.get(part) ?? 0;
    if (count > 0) {
      counts.set(part, count - 1);
    } else {
      changed.add(part);
    }
  }
  return changed;
}

function styleDiffBody(
  text: string,
  line: ParsedDiffLine,
  highlight: DiffBodyHighlight | undefined,
  noColor: boolean,
  theme?: ShellTheme,
): string {
  if (!highlight || noColor || (line.kind !== "add" && line.kind !== "remove")) {
    return colorByKind(text, line.kind, noColor, false, theme);
  }
  const baseColor = line.kind === "add" ? theme?.success : theme?.error;
  const wordColor =
    line.kind === "add"
      ? (theme?.diffAddedWord ?? baseColor)
      : (theme?.diffRemovedWord ?? baseColor);
  return tokenizeDiffBody(text)
    .map((part) => {
      const styled = colorByKind(part, line.kind, noColor, false, theme);
      const wordStyled = wordColor ? ansiColor(wordColor, part, noColor) : styled;
      return highlight.changedParts.has(part) ? bold(wordStyled, noColor) : styled;
    })
    .join("");
}

function bold(text: string, noColor: boolean): string {
  return ansi("1", text, noColor);
}

function colorByKind(
  text: string,
  kind: DiffLineKind,
  noColor: boolean,
  gutter: boolean,
  theme?: ShellTheme,
): string {
  if (kind === "add") {
    const color = theme?.diffAddedWord ?? theme?.success;
    return color ? ansiColor(color, text, noColor) : green(text, noColor);
  }
  if (kind === "remove") {
    const color = theme?.diffRemovedWord ?? theme?.error;
    return color ? ansiColor(color, text, noColor) : red(text, noColor);
  }
  return gutter ? dim(text, noColor) : text;
}
