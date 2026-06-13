import { Box, Text } from "@linghun/ink-runtime";
import { highlight } from "cli-highlight";
import { type Token, type Tokens, lexer } from "marked";
import { createContext, useContext } from "react";
import type React from "react";
import { memo, useRef } from "react";
import { charWidth, displayWidth, wrapText } from "../text-utils.js";
import type { ShellTheme } from "../theme.js";
import type { ProductBlockSelectionRange } from "../types.js";
import { StructuredDiff } from "./StructuredDiff.js";

const MessageResponseContext = createContext<boolean>(false);

export function useInMessageResponse(): boolean {
  return useContext(MessageResponseContext);
}

export function MessageResponseProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactNode {
  return <MessageResponseContext.Provider value={true}>{children}</MessageResponseContext.Provider>;
}

export type MessageMarkdownProps = {
  text: string;
  theme: ShellTheme;
  dim?: boolean;
  tone?: "default" | "error" | "diagnostic";
  wrapWidth?: number;
  selectionLineIndexes?: number[];
  selectionLineRanges?: ProductBlockSelectionRange[];
  isStreaming?: boolean;
};

type InlineToken =
  | { kind: "text"; value: string }
  | { kind: "code"; value: string }
  | { kind: "bold"; value: string }
  | { kind: "italic"; value: string }
  | { kind: "link"; value: string; href: string };

type TableCell = { text: string; lines: string[]; width: number };

const INLINE_TOKEN_RE =
  /(`[^`\n]+`|\*\*[^*\n][^\n]*?\*\*|\*[^*\n][^\n]*?\*|\[[^\]\n]+\]\([^\s)\n]+\))/u;
const ANSI_REGEX = /\x1B\[[0-9;]*m/gu;
const TABLE_VERTICAL_FALLBACK_WIDTH = 48;
const TABLE_MAX_COLUMN_WIDTH = 48;
const TABLE_MIN_COLUMN_WIDTH = 6;
/** When content forces per-column width below this, switch to vertical key-value mode. */
const TABLE_MIN_ACCEPTABLE_COLUMN = 8;
const MARKDOWN_TOKEN_CACHE_LIMIT = 128;
const markdownTokenCache = new Map<string, Token[]>();
const codeHighlightCache = new Map<string, string[]>();

function getCachedMarkdownTokens(text: string): Token[] {
  const cached = markdownTokenCache.get(text);
  if (cached) {
    markdownTokenCache.delete(text);
    markdownTokenCache.set(text, cached);
    return cached;
  }
  const tokens = lexer(text);
  markdownTokenCache.set(text, tokens);
  trimCache(markdownTokenCache);
  return tokens;
}

function getCachedHighlightedCodeLines(code: string, lang: string | undefined): string[] {
  const key = `${lang ?? ""}::${code}`;
  const cached = codeHighlightCache.get(key);
  if (cached) {
    codeHighlightCache.delete(key);
    codeHighlightCache.set(key, cached);
    return cached;
  }
  const lines = highlightedCodeLines(code, lang);
  codeHighlightCache.set(key, lines);
  trimCache(codeHighlightCache);
  return lines;
}

function trimCache<T>(cache: Map<string, T>): void {
  while (cache.size > MARKDOWN_TOKEN_CACHE_LIMIT) {
    const first = cache.keys().next().value;
    if (!first) return;
    cache.delete(first);
  }
}

function tokenizeInline(value: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let remaining = value;
  while (remaining.length > 0) {
    const match = remaining.match(INLINE_TOKEN_RE);
    if (!match || match.index === undefined) {
      tokens.push({ kind: "text", value: remaining });
      break;
    }
    if (match.index > 0) {
      tokens.push({ kind: "text", value: remaining.slice(0, match.index) });
    }
    const matched = match[0];
    if (matched.startsWith("`")) {
      tokens.push({ kind: "code", value: matched.slice(1, -1) });
    } else if (matched.startsWith("**")) {
      tokens.push({ kind: "bold", value: matched.slice(2, -2) });
    } else if (matched.startsWith("[")) {
      const link = matched.match(/^\[([^\]\n]+)\]\(([^\s)\n]+)\)$/u);
      if (link) tokens.push({ kind: "link", value: link[1] ?? "", href: link[2] ?? "" });
      else tokens.push({ kind: "text", value: matched });
    } else {
      tokens.push({ kind: "italic", value: matched.slice(1, -1) });
    }
    remaining = remaining.slice(match.index + matched.length);
  }
  return tokens;
}

function baseColor(
  theme: ShellTheme,
  dim: boolean,
  tone: MessageMarkdownProps["tone"],
): string | undefined {
  if (dim) return theme.dim;
  if (tone === "error") return theme.error;
  if (tone === "diagnostic") return theme.diagnostic;
  return theme.assistantText;
}

function InlineText({
  value,
  theme,
  dim,
  tone,
  selected,
}: {
  value: string;
  theme: ShellTheme;
  dim: boolean;
  tone: MessageMarkdownProps["tone"];
  selected?: boolean;
}): React.ReactNode {
  const color = baseColor(theme, dim, tone);
  const codeColor = theme.inlineCode ?? theme.dim ?? theme.muted;
  const tokens = tokenizeInline(value);
  return (
    <Text
      color={selected ? "white" : color}
      backgroundColor={selected && theme.mode !== "no-color" ? "blue" : undefined}
      dimColor={selected ? false : dim}
    >
      {tokens.map((token, tokenIndex) => {
        const key = `${tokenIndex}-${token.kind}-${token.value}`;
        if (token.kind === "code") {
          return (
            <Text
              key={key}
              color={selected ? "white" : codeColor}
              dimColor={selected ? false : dim}
            >
              {token.value}
            </Text>
          );
        }
        if (token.kind === "bold") {
          return (
            <Text
              key={key}
              bold
              color={selected ? "white" : color}
              dimColor={selected ? false : dim}
            >
              {token.value}
            </Text>
          );
        }
        if (token.kind === "italic") {
          return (
            <Text
              key={key}
              italic
              color={selected ? "white" : color}
              dimColor={selected ? false : dim}
            >
              {token.value}
            </Text>
          );
        }
        if (token.kind === "link") {
          return (
            <Text
              key={key}
              color={selected ? "white" : (theme.diagnostic ?? theme.accent)}
              underline
            >
              {token.value}
            </Text>
          );
        }
        return <Text key={key}>{token.value}</Text>;
      })}
    </Text>
  );
}

function InlineRow({
  value,
  theme,
  dim,
  tone,
  wrapWidth,
  selected,
}: {
  value: string;
  theme: ShellTheme;
  dim: boolean;
  tone: MessageMarkdownProps["tone"];
  wrapWidth?: number;
  selected?: boolean;
}): React.ReactNode {
  const rows = wrapWidth ? wrapText(value, wrapWidth) : [value];
  return (
    <Box flexDirection="column">
      {rows.map((row, rowIndex) => (
        <InlineText
          key={`${rowIndex}-${row}`}
          value={row}
          theme={theme}
          dim={dim}
          tone={tone}
          selected={selected}
        />
      ))}
    </Box>
  );
}

function InlineCellRangeRow({
  value,
  ranges,
  theme,
  dim,
  tone,
}: {
  value: string;
  ranges: ProductBlockSelectionRange[];
  theme: ShellTheme;
  dim: boolean;
  tone: MessageMarkdownProps["tone"];
}): React.ReactNode {
  const segments = splitLineBySelectionRanges(value, ranges);
  return (
    <Text>
      {segments.map((segment, index) => (
        <InlineText
          key={`${index}-${segment.selected ? "selected" : "plain"}-${segment.text}`}
          value={segment.text}
          theme={theme}
          dim={dim}
          tone={tone}
          selected={segment.selected}
        />
      ))}
    </Text>
  );
}

function splitLineBySelectionRanges(
  value: string,
  ranges: ProductBlockSelectionRange[],
): Array<{ text: string; selected: boolean }> {
  const chars = Array.from(value);
  const totalWidth = chars.reduce((width, char) => width + Math.max(1, charWidth(char)), 0);
  const normalized = ranges
    .map((range) => ({
      start: Math.max(0, Math.min(totalWidth, range.startColumn)),
      end: Math.max(0, Math.min(totalWidth, range.endColumn)),
    }))
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  if (normalized.length === 0) return [{ text: value, selected: false }];
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of normalized) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  const segments: Array<{ text: string; selected: boolean }> = [];
  let current = "";
  let currentSelected: boolean | undefined;
  let column = 0;
  const pushCurrent = () => {
    if (currentSelected === undefined || current.length === 0) return;
    segments.push({ text: current, selected: currentSelected });
    current = "";
  };
  for (const char of chars) {
    const width = Math.max(1, charWidth(char));
    const selected = merged.some((range) => range.start < column + width && range.end > column);
    if (currentSelected !== selected) {
      pushCurrent();
      currentSelected = selected;
    }
    current += char;
    column += width;
  }
  pushCurrent();
  return segments;
}

function stripAnsi(value: string): string {
  return value.replace(ANSI_REGEX, "");
}

function highlightedCodeLines(code: string, lang: string | undefined): string[] {
  if (!lang) return code.split("\n");
  if (lang === "diff" || lang === "patch") return code.split("\n");
  try {
    return highlight(code, { language: lang, ignoreIllegals: true }).split("\n");
  } catch {
    return code.split("\n");
  }
}

function CodeLine({
  line,
  highlightedLine,
  lang,
  theme,
  dim,
  selected,
  ranges,
  wrapWidth,
}: {
  line: string;
  highlightedLine?: string;
  lang?: string;
  theme: ShellTheme;
  dim: boolean;
  selected?: boolean;
  ranges?: ProductBlockSelectionRange[];
  wrapWidth: number;
}): React.ReactNode {
  const isDiff = lang === "diff" || lang === "patch";
  const color =
    isDiff && line.startsWith("+") && !line.startsWith("+++")
      ? (theme.success ?? theme.status.pass)
      : isDiff && line.startsWith("-") && !line.startsWith("---")
        ? (theme.error ?? theme.status.fail)
        : (theme.diagnostic ?? theme.accent);
  const dimLine = dim || (isDiff && !line.startsWith("+") && !line.startsWith("-"));
  if (ranges && ranges.length > 0) {
    const segments = splitLineBySelectionRanges(line.length === 0 ? " " : line, ranges);
    return (
      <Text wrap="wrap">
        {segments.map((segment, index) => (
          <Text
            key={`${index}-${segment.selected ? "selected" : "plain"}-${segment.text}`}
            color={segment.selected ? "white" : color}
            backgroundColor={segment.selected && theme.mode !== "no-color" ? "blue" : undefined}
            dimColor={segment.selected ? false : dimLine}
          >
            {segment.text}
          </Text>
        ))}
      </Text>
    );
  }
  const rawWrapped = wrapText(line.length === 0 ? " " : line, wrapWidth);
  const highlightedFits =
    highlightedLine &&
    rawWrapped.length === 1 &&
    displayWidth(stripAnsi(highlightedLine)) <= wrapWidth;
  const rows = highlightedFits ? [highlightedLine] : rawWrapped;
  return (
    <Box flexDirection="column">
      {rows.map((wrapped, index) => {
        const padded = padDisplay(wrapped, wrapWidth);
        return (
          <Text
            key={`${index}-${stripAnsi(wrapped)}`}
            color={selected ? "white" : highlightedFits && !isDiff ? undefined : color}
            backgroundColor={selected && theme.mode !== "no-color" ? "blue" : undefined}
            dimColor={selected ? false : dimLine}
          >
            {padded}
          </Text>
        );
      })}
    </Box>
  );
}

function renderCodeBlock({
  code,
  lang,
  theme,
  dim,
  wrapWidth,
  blockKey,
}: {
  code: string;
  lang?: string;
  theme: ShellTheme;
  dim: boolean;
  wrapWidth: number;
  blockKey: string;
}): React.ReactNode {
  // Phase 3: diff/patch blocks use StructuredDiff for visual diff rendering.
  if (lang === "diff" || lang === "patch") {
    return (
      <StructuredDiff key={blockKey} code={code} theme={theme} wrapWidth={wrapWidth} dim={dim} />
    );
  }
  const rawLines = code.split("\n");
  const highlighted = getCachedHighlightedCodeLines(code, lang);
  const lineCount = rawLines.length;
  const gutterWidth = String(lineCount).length;
  return (
    <Box key={blockKey} flexDirection="column" marginLeft={1}>
      {lang ? (
        <Text color={theme.dim ?? theme.muted} dimColor={dim}>
          {`  ${lang}`}
        </Text>
      ) : null}
      {rawLines.map((line, lineIndex) => {
        const num = String(lineIndex + 1).padStart(gutterWidth, " ");
        return (
          <Box key={`${blockKey}-line-${lineIndex}-${line}`} flexDirection="row">
            <Text color={theme.dim ?? theme.muted} dimColor>
              {`${num} │ `}
            </Text>
            <CodeLine
              line={line}
              highlightedLine={highlighted[lineIndex]}
              lang={lang}
              theme={theme}
              dim={dim}
              wrapWidth={Math.max(8, wrapWidth - gutterWidth - 4)}
            />
          </Box>
        );
      })}
    </Box>
  );
}

function tokenPlainText(token: Token): string {
  const maybeText = token as { text?: unknown; raw?: unknown };
  return typeof maybeText.text === "string"
    ? maybeText.text
    : typeof maybeText.raw === "string"
      ? maybeText.raw
      : "";
}

function renderToken({
  token,
  theme,
  dim,
  tone,
  wrapWidth,
  keyPrefix,
}: {
  token: Token;
  theme: ShellTheme;
  dim: boolean;
  tone: MessageMarkdownProps["tone"];
  wrapWidth: number;
  keyPrefix: string;
}): React.ReactNode {
  switch (token.type) {
    case "space":
      return <Box key={keyPrefix} height={1} />;
    case "heading": {
      const heading = token as Tokens.Heading;
      return (
        <Box key={keyPrefix} flexDirection="column" marginTop={heading.depth <= 2 ? 1 : 0}>
          {wrapText(`${"#".repeat(heading.depth)} ${heading.text}`, wrapWidth).map(
            (line, index) => (
              <Text
                key={`${keyPrefix}-heading-${index}-${line}`}
                bold
                color={dim ? theme.dim : (theme.accent ?? theme.brand)}
                dimColor={dim}
              >
                {line}
              </Text>
            ),
          )}
        </Box>
      );
    }
    case "paragraph":
    case "text":
      return (
        <InlineRow
          key={keyPrefix}
          value={tokenPlainText(token)}
          theme={theme}
          dim={dim}
          tone={tone}
          wrapWidth={wrapWidth}
        />
      );
    case "blockquote": {
      const quote = token as Tokens.Blockquote;
      return (
        <Box key={keyPrefix} flexDirection="row">
          <Text color={theme.dim ?? theme.muted} dimColor={dim}>
            {"▌ "}
          </Text>
          <MessageMarkdown
            text={quote.text}
            theme={theme}
            dim={dim}
            tone={tone}
            wrapWidth={wrapWidth - 2}
          />
        </Box>
      );
    }
    case "list": {
      const list = token as Tokens.List;
      return (
        <Box key={keyPrefix} flexDirection="column">
          {list.items.map((item, index) => {
            const marker = list.ordered
              ? `${Number(list.start || 1) + index}.`
              : item.task
                ? item.checked
                  ? "☑"
                  : "☐"
                : "-";
            return (
              <Box key={`${keyPrefix}-item-${index}`} flexDirection="row">
                <Text color={dim ? theme.dim : theme.muted} dimColor={dim}>
                  {marker}{" "}
                </Text>
                <InlineRow
                  value={item.text.replace(/\n+/gu, " ")}
                  theme={theme}
                  dim={dim}
                  tone={tone}
                  wrapWidth={Math.max(8, wrapWidth - marker.length - 1)}
                />
              </Box>
            );
          })}
        </Box>
      );
    }
    case "code": {
      const code = token as Tokens.Code;
      return renderCodeBlock({
        code: code.text,
        lang: code.lang,
        theme,
        dim,
        wrapWidth,
        blockKey: keyPrefix,
      });
    }
    case "table":
      return renderTable(token as Tokens.Table, theme, dim, tone, wrapWidth, keyPrefix);
    case "hr":
      return (
        <Text key={keyPrefix} color={theme.dim ?? theme.muted} dimColor={dim}>
          {"─".repeat(Math.min(wrapWidth, 40))}
        </Text>
      );
    default:
      return (
        <InlineRow
          key={keyPrefix}
          value={tokenPlainText(token)}
          theme={theme}
          dim={dim}
          tone={tone}
          wrapWidth={wrapWidth}
        />
      );
  }
}

function buildTableCell(text: string, width: number): TableCell {
  const lines = wrapText(text, Math.max(4, width));
  return { text, lines, width };
}

function padDisplay(value: string, width: number): string {
  const visible = displayWidth(stripAnsi(value));
  return `${value}${" ".repeat(Math.max(0, width - visible))}`;
}

function tableWidths(table: Tokens.Table, wrapWidth: number): number[] {
  const columnCount = table.header.length;
  const maxPerCol = Math.max(
    TABLE_MIN_COLUMN_WIDTH,
    Math.min(TABLE_MAX_COLUMN_WIDTH, Math.floor(wrapWidth * 0.45)),
  );
  const rawWidths = Array.from({ length: columnCount }, (_, index) => {
    const values = [
      table.header[index]?.text ?? "",
      ...table.rows.map((row) => row[index]?.text ?? ""),
    ];
    return Math.min(
      maxPerCol,
      Math.max(TABLE_MIN_COLUMN_WIDTH, ...values.map((value) => displayWidth(value))),
    );
  });
  const borderWidth = columnCount + 1;
  const paddingWidth = columnCount * 2;
  const available = Math.max(
    columnCount * TABLE_MIN_COLUMN_WIDTH,
    wrapWidth - borderWidth - paddingWidth,
  );
  const total = rawWidths.reduce((sum, width) => sum + width, 0);
  if (total <= available) return rawWidths;
  // Proportional scaling: give wider columns proportionally more room.
  const scale = available / total;
  const proportional = rawWidths.map((w) =>
    Math.max(TABLE_MIN_COLUMN_WIDTH, Math.floor(w * scale)),
  );
  // If any column dips below the acceptable minimum after proportional scaling,
  // signal the caller to fall back to vertical mode.
  if (proportional.some((w) => w < TABLE_MIN_ACCEPTABLE_COLUMN)) {
    // Return raw (un-compressed) widths so renderTable triggers the vertical fallback.
    return rawWidths;
  }
  return proportional;
}

function renderTable(
  table: Tokens.Table,
  theme: ShellTheme,
  dim: boolean,
  tone: MessageMarkdownProps["tone"],
  wrapWidth: number,
  keyPrefix: string,
): React.ReactNode {
  const columnCount = table.header.length;
  if (columnCount === 0) return null;
  const widths = tableWidths(table, wrapWidth);
  const tableWidth = widths.reduce((sum, width) => sum + width + 2, 1);
  if (wrapWidth < TABLE_VERTICAL_FALLBACK_WIDTH || tableWidth > wrapWidth) {
    return (
      <Box key={keyPrefix} flexDirection="column">
        {table.rows.map((row, rowIndex) => (
          <Box key={`${keyPrefix}-vertical-${rowIndex}`} flexDirection="column" marginBottom={1}>
            {row.map((cell, cellIndex) => (
              <Box key={`${keyPrefix}-vertical-${rowIndex}-${cellIndex}`} flexDirection="row">
                <Text color={theme.muted} dimColor={dim}>
                  {table.header[cellIndex]?.text ?? `#${cellIndex + 1}`}:{" "}
                </Text>
                <InlineRow
                  value={cell.text}
                  theme={theme}
                  dim={dim}
                  tone={tone}
                  wrapWidth={Math.max(
                    8,
                    wrapWidth -
                      displayWidth(table.header[cellIndex]?.text ?? `#${cellIndex + 1}`) -
                      2,
                  )}
                />
              </Box>
            ))}
          </Box>
        ))}
      </Box>
    );
  }
  const borderColor = theme.dim ?? theme.muted;
  const border = (left: string, mid: string, right: string) =>
    `${left}${widths.map((width) => "─".repeat(width + 2)).join(mid)}${right}`;
  const renderRow = (cells: TableCell[], rowKey: string, boldHeader = false) => {
    const height = Math.max(...cells.map((cell) => cell.lines.length));
    return Array.from({ length: height }, (_, lineIndex) => (
      <Text key={`${rowKey}-${lineIndex}`}>
        <Text color={borderColor} dimColor={dim}>
          │
        </Text>
        {cells.map((cell, cellIndex) => (
          <Text key={`${rowKey}-${lineIndex}-${cellIndex}`}>
            {" "}
            <Text bold={boldHeader} color={boldHeader && !dim ? theme.accent : undefined}>
              {padDisplay(cell.lines[lineIndex] ?? "", cell.width)}
            </Text>{" "}
            <Text color={borderColor} dimColor={dim}>
              │
            </Text>
          </Text>
        ))}
      </Text>
    ));
  };
  const header = table.header.map((cell, index) => buildTableCell(cell.text, widths[index] ?? 4));
  const rows = table.rows.map((row) =>
    row.map((cell, index) => buildTableCell(cell.text, widths[index] ?? 4)),
  );
  return (
    <Box key={keyPrefix} flexDirection="column">
      <Text color={borderColor} dimColor={dim}>
        {border("┌", "┬", "┐")}
      </Text>
      {renderRow(header, `${keyPrefix}-header`, true)}
      <Text color={borderColor} dimColor={dim}>
        {border("├", "┼", "┤")}
      </Text>
      {rows.flatMap((row, index) => [
        ...renderRow(row, `${keyPrefix}-row-${index}`),
        ...(index < rows.length - 1
          ? [
              <Text key={`${keyPrefix}-sep-${index}`} color={borderColor} dimColor={dim}>
                {border("├", "┼", "┤")}
              </Text>,
            ]
          : []),
      ])}
      <Text color={borderColor} dimColor={dim}>
        {border("└", "┴", "┘")}
      </Text>
    </Box>
  );
}

export function MessageMarkdown({
  text,
  theme,
  dim = false,
  tone = "default",
  wrapWidth,
  selectionLineIndexes,
  selectionLineRanges,
  isStreaming,
}: MessageMarkdownProps): React.ReactNode {
  if (!text || text.length === 0) return null;
  if ((selectionLineIndexes?.length ?? 0) > 0 || (selectionLineRanges?.length ?? 0) > 0) {
    return renderSelectablePlainMarkdown({
      text,
      theme,
      dim,
      tone,
      wrapWidth,
      selectionLineIndexes,
      selectionLineRanges,
    });
  }
  if (isStreaming) {
    const lines = text.replace(/\r/g, "").split("\n");
    const color = baseColor(theme, dim, tone);
    const effectiveWrapWidth = wrapWidth ?? 80;
    return (
      <Box flexDirection="column">
        {lines.flatMap((line, i) =>
          wrapText(line, effectiveWrapWidth).map((wrapped, wrappedIndex) => (
            <Text key={`s${i}-${wrappedIndex}-${wrapped}`} color={color} dimColor={dim}>
              {wrapped}
            </Text>
          )),
        )}
      </Box>
    );
  }
  const effectiveWrapWidth = wrapWidth ?? 80;
  const tokens = getCachedMarkdownTokens(text.replace(/\r/g, ""));
  return (
    <Box flexDirection="column">
      {tokens.map((token, index) =>
        renderToken({
          token,
          theme,
          dim,
          tone,
          wrapWidth: effectiveWrapWidth,
          keyPrefix: `${index}-${token.type}-${token.raw.slice(0, 16)}`,
        }),
      )}
    </Box>
  );
}

function renderSelectablePlainMarkdown({
  text,
  theme,
  dim,
  tone,
  wrapWidth,
  selectionLineIndexes,
  selectionLineRanges,
}: MessageMarkdownProps & { dim: boolean; tone: MessageMarkdownProps["tone"] }): React.ReactNode {
  const lines = text.replace(/\r/g, "").split("\n");
  const selectedLines = new Set(selectionLineIndexes ?? []);
  const selectedRangesByLine = new Map<number, ProductBlockSelectionRange[]>();
  for (const range of selectionLineRanges ?? []) {
    const existing = selectedRangesByLine.get(range.lineIndex) ?? [];
    existing.push(range);
    selectedRangesByLine.set(range.lineIndex, existing);
  }
  const effectiveWrapWidth = wrapWidth ?? 80;
  let inCode = false;
  let codeLang: string | undefined;
  let codeLineNum = 0;
  const rendered: React.ReactNode[] = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const raw = lines[lineIndex] ?? "";
    const fence = raw.match(/^\s*```\s*([A-Za-z0-9_+-]*)\s*$/u);
    if (fence) {
      inCode = !inCode;
      codeLang = inCode ? fence[1] || undefined : undefined;
      codeLineNum = 0;
      continue;
    }
    const ranges = selectedRangesByLine.get(lineIndex) ?? [];
    if (inCode) {
      codeLineNum++;
      const gutter = String(codeLineNum).padStart(2, " ");
      rendered.push(
        <Box key={`code-line-${lineIndex}-${raw}`} flexDirection="row">
          <Text color={theme.dim ?? theme.muted} dimColor>
            {`${gutter} │ `}
          </Text>
          <CodeLine
            line={raw}
            lang={codeLang}
            theme={theme}
            dim={dim}
            selected={selectedLines.has(lineIndex)}
            ranges={ranges}
            wrapWidth={Math.max(8, effectiveWrapWidth - 5)}
          />
        </Box>,
      );
      continue;
    }
    if (raw.trim().length === 0) {
      rendered.push(<Box key={`blank-${lineIndex}`} height={1} />);
      continue;
    }
    if (ranges.length > 0) {
      rendered.push(
        <InlineCellRangeRow
          key={`range-${lineIndex}`}
          value={raw}
          ranges={ranges}
          theme={theme}
          dim={dim}
          tone={tone}
        />,
      );
      continue;
    }
    rendered.push(
      <InlineRow
        key={`line-${lineIndex}-${raw}`}
        value={raw}
        theme={theme}
        dim={dim}
        tone={tone}
        wrapWidth={wrapWidth}
        selected={selectedLines.has(lineIndex)}
      />,
    );
  }
  return <Box flexDirection="column">{rendered}</Box>;
}

const MemoMessageMarkdown = memo(MessageMarkdown);

export type StreamingMarkdownState = {
  stablePrefix: string;
};

export function splitStreamingMarkdownForRender(
  text: string,
  state: StreamingMarkdownState,
): { stablePrefix: string; unstableSuffix: string; parsedSuffixInput: string } {
  const normalized = text.replace(/\r/g, "");
  if (!normalized.startsWith(state.stablePrefix)) {
    state.stablePrefix = "";
  }
  const boundary = state.stablePrefix.length;
  const suffixInput = normalized.slice(boundary);
  const advance = findStablePrefixAdvance(suffixInput);
  if (advance > 0) {
    state.stablePrefix = normalized.slice(0, boundary + advance);
  }
  return {
    stablePrefix: state.stablePrefix,
    unstableSuffix: normalized.slice(state.stablePrefix.length),
    parsedSuffixInput: suffixInput,
  };
}

function findStablePrefixAdvance(text: string): number {
  let offset = 0;
  let boundary = 0;
  let inCode = false;
  for (const match of text.matchAll(/[^\n]*(?:\n|$)/gu)) {
    const segment = match[0];
    if (!segment) break;
    if (!segment.endsWith("\n")) break;
    const line = segment.slice(0, -1);
    const fence = /^\s*```\s*[A-Za-z0-9_+-]*\s*$/u.test(line);
    if (fence) {
      inCode = !inCode;
      offset += segment.length;
      if (!inCode) boundary = offset;
      continue;
    }
    offset += segment.length;
    if (!inCode && line.trim().length === 0) boundary = offset;
  }
  if (!inCode && text.endsWith("\n") && hasBalancedInlineMarkdown(text)) return text.length;
  return boundary;
}

function hasBalancedInlineMarkdown(text: string): boolean {
  let inInlineCode = false;
  let boldOpen = false;
  let italicOpen = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "`") {
      inInlineCode = !inInlineCode;
      continue;
    }
    if (!inInlineCode && char === "*" && text[index + 1] === "*") {
      boldOpen = !boldOpen;
      index += 1;
      continue;
    }
    if (!inInlineCode && char === "*") {
      italicOpen = !italicOpen;
    }
  }
  return !inInlineCode && !boldOpen && !italicOpen;
}

export function StreamingMarkdown({
  text,
  theme,
  dim = false,
  tone = "default",
  wrapWidth,
}: MessageMarkdownProps): React.ReactNode {
  const stateRef = useRef<StreamingMarkdownState>({ stablePrefix: "" });
  const { stablePrefix, unstableSuffix } = splitStreamingMarkdownForRender(text, stateRef.current);
  return (
    <Box flexDirection="column">
      {stablePrefix ? (
        <MemoMessageMarkdown
          text={stablePrefix}
          theme={theme}
          dim={dim}
          tone={tone}
          wrapWidth={wrapWidth}
        />
      ) : null}
      {unstableSuffix ? (
        <Box flexDirection="row">
          <MessageMarkdown
            text={unstableSuffix}
            theme={theme}
            dim={dim}
            tone={tone}
            wrapWidth={wrapWidth}
            isStreaming
          />
          <Text color={theme.accent}>{"▌"}</Text>
        </Box>
      ) : (
        <Text color={theme.accent}>{"▌"}</Text>
      )}
    </Box>
  );
}
