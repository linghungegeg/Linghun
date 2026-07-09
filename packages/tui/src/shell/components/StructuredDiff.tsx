import { Box, Text } from "@linghun/ink-runtime";
import type React from "react";
import {
  type DiffLineKind,
  type ParsedDiffLine,
  computeWordHighlights,
  computeLineNumberWidth,
  type DiffBodyHighlight,
  formatLineNumber,
  markerFor,
  parseDiffLines,
  tokenizeDiffBody,
} from "../diff-renderer.js";
import {
  type SyntaxDiffLine,
  inferDiffFilePath,
  renderSyntaxHighlightedDiffHunk,
} from "../diff-syntax-highlighter.js";
import { displayWidth, fitText, wrapText } from "../text-utils.js";
import type { ShellTheme } from "../theme.js";

/**
 * StructuredDiff renders unified diff content with:
 * - Dashed top/bottom border (subtle color)
 * - Gutter column: +/- marker + line number, dimColor (visually separated)
 * - Content column: syntax-colored diff lines with background tinting
 * - Hunk separators
 */
export function StructuredDiff({
  code,
  theme,
  wrapWidth,
  dim = false,
}: {
  code: string;
  theme: ShellTheme;
  wrapWidth: number;
  dim?: boolean;
}): React.ReactNode {
  const rawLines = code.split("\n");
  const lines = parseDiffLines(rawLines);
  const lineNumberWidth = computeLineNumberWidth(lines);
  const gutterWidth = lineNumberWidth * 2 + 5;
  const safeWrapWidth = Math.max(8, Math.floor(wrapWidth));
  const contentWidth = Math.max(8, safeWrapWidth - gutterWidth - 2);
  const syntaxHighlights = computeStructuredSyntaxHighlights(lines, rawLines, theme, contentWidth);
  const wordHighlights = computeWordHighlights(lines);
  const borderChar = "┈";
  const borderLine = borderChar.repeat(safeWrapWidth);

  return (
    <Box flexDirection="column">
      <Text color={theme.subtle ?? theme.dim ?? theme.muted} dimColor>
        {borderLine}
      </Text>
      {lines.map((line, idx) => {
        if (line.kind === "hunk") {
          const lineKey = `${line.kind}-${line.oldLine ?? ""}-${line.newLine ?? ""}-${line.text}-${idx}`;
          return (
            <Box key={lineKey}>
              <Text color={theme.muted} dimColor>
                {padDisplay("  ···", safeWrapWidth)}
              </Text>
            </Box>
          );
        }
        if (line.kind === "fileHeader" || line.kind === "metadata") {
          const header = fitText(`  ${line.text}`, safeWrapWidth);
          const lineKey = `${line.kind}-${line.oldLine ?? ""}-${line.newLine ?? ""}-${line.text}-${idx}`;
          return (
            <Box key={lineKey}>
              <Text color={theme.muted} dimColor>
                {padDisplay(header, safeWrapWidth)}
              </Text>
            </Box>
          );
        }

        const oldText = formatLineNumber(line.oldLine, lineNumberWidth);
        const newText = formatLineNumber(line.newLine, lineNumberWidth);
        const marker = markerFor(line.kind);
        const gutter = `${oldText} ${newText} ${marker} `;
        const continuationGutter = `${" ".repeat(lineNumberWidth)} ${" ".repeat(lineNumberWidth)}   `;
        const lineKey = `${line.kind}-${line.oldLine ?? ""}-${line.newLine ?? ""}-${line.text}-${idx}`;

        const lineColor =
          line.kind === "add"
            ? (theme.diffAddedWord ?? theme.success ?? "green")
            : line.kind === "remove"
              ? (theme.diffRemovedWord ?? theme.error ?? "red")
              : undefined;

        const lineBg =
          line.kind === "add"
            ? (theme.diffAdded ?? undefined)
            : line.kind === "remove"
              ? (theme.diffRemoved ?? undefined)
              : undefined;

        const wrapped = wrapText(line.text || " ", contentWidth);
        const syntaxHighlight = syntaxHighlights.get(line);

        return (
          <Box key={lineKey} flexDirection="column">
            {wrapped.map((wrappedLine, wIdx) => {
              const paddedLine = padDisplay(wrappedLine, contentWidth);
              const useSyntaxHighlight = wIdx === 0 && wrapped.length === 1 && syntaxHighlight;
              return (
                <Box key={`${lineKey}-wrap-${wIdx}-${wrappedLine}`} flexDirection="row">
                  <Text color={theme.dim ?? theme.muted} dimColor>
                    {wIdx === 0 ? gutter : continuationGutter}
                  </Text>
                  {useSyntaxHighlight ? (
                    <Text backgroundColor={lineBg} dimColor={dim}>
                      {padDisplay(syntaxHighlight, contentWidth)}
                    </Text>
                  ) : (
                    renderStructuredDiffBody({
                      text: paddedLine,
                      line,
                      highlight: wordHighlights.get(line),
                      color: lineColor,
                      backgroundColor: lineBg,
                      dim: dim || line.kind === "context",
                    })
                  )}
                </Box>
              );
            })}
          </Box>
        );
      })}
      <Text color={theme.subtle ?? theme.dim ?? theme.muted} dimColor>
        {borderLine}
      </Text>
    </Box>
  );
}

function renderStructuredDiffBody({
  text,
  line,
  highlight,
  color,
  backgroundColor,
  dim,
}: {
  text: string;
  line: ParsedDiffLine;
  highlight: DiffBodyHighlight | undefined;
  color: string | undefined;
  backgroundColor: string | undefined;
  dim: boolean;
}): React.ReactNode {
  if (!highlight || (line.kind !== "add" && line.kind !== "remove")) {
    return (
      <Text color={color} backgroundColor={backgroundColor} dimColor={dim}>
        {text}
      </Text>
    );
  }
  return (
    <Text color={color} backgroundColor={backgroundColor} dimColor={dim}>
      {tokenizeDiffBody(text).map((part, index) => (
        <Text
          key={`${index}-${part}`}
          bold={highlight.changedParts.has(part)}
          color={color}
          backgroundColor={backgroundColor}
          dimColor={dim}
        >
          {part}
        </Text>
      ))}
    </Text>
  );
}

function padDisplay(value: string, width: number): string {
  const visible = displayWidth(value);
  return `${value}${" ".repeat(Math.max(0, width - visible))}`;
}

type StructuredSyntaxLine = Extract<DiffLineKind, "add" | "remove" | "context">;

function computeStructuredSyntaxHighlights(
  lines: ParsedDiffLine[],
  rawLines: string[],
  theme: ShellTheme,
  contentWidth: number,
): Map<ParsedDiffLine, string> {
  const filePath = inferDiffFilePath(rawLines);
  const highlights = new Map<ParsedDiffLine, string>();
  if (!filePath || theme.mode === "no-color") return highlights;

  let hunkHeader: string | undefined;
  let hunkLines: ParsedDiffLine[] = [];
  const flushHunk = (): void => {
    if (hunkLines.length === 0) return;
    const syntaxLines: SyntaxDiffLine[] = hunkLines.map((line) => ({
      kind: line.kind as StructuredSyntaxLine,
      text: line.text,
    }));
    const rendered = renderSyntaxHighlightedDiffHunk({
      filePath,
      hunkHeader,
      lines: syntaxLines,
      themeKey: syntaxThemeKey(theme),
      width: contentWidth,
      noColor: theme.mode === "no-color",
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

function syntaxThemeKey(theme: ShellTheme): string {
  return [theme.mode, theme.inlineCode ?? "", theme.accent ?? ""].join(":");
}
