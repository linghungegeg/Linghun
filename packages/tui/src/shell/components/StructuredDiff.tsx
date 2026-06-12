import { Box, Text } from "@linghun/ink-runtime";
import type React from "react";
import { wrapText } from "../text-utils.js";
import type { ShellTheme } from "../theme.js";

/**
 * StructuredDiff — renders unified diff content with:
 * - Dashed top/bottom border (subtle color)
 * - Gutter column: +/- marker + line number, dimColor (visually separated)
 * - Content column: syntax-colored diff lines with background tinting
 * - Hunk separators (···)
 *
 * Phase 3 output-maturity component.
 */

type DiffLine = {
  type: "add" | "remove" | "context" | "header" | "hunk";
  content: string;
  /** Original-file line number (for remove/context). */
  oldNum?: number;
  /** New-file line number (for add/context). */
  newNum?: number;
};

function parseDiffLines(code: string): DiffLine[] {
  const raw = code.split("\n");
  const lines: DiffLine[] = [];
  let oldLine = 1;
  let newLine = 1;

  for (const line of raw) {
    if (line.startsWith("@@")) {
      // Hunk header — parse line numbers
      const match = line.match(/@@ -(\d+)/u);
      if (match) {
        oldLine = Number(match[1]);
      }
      const matchNew = line.match(/@@ -\d+(?:,\d+)? \+(\d+)/u);
      if (matchNew) {
        newLine = Number(matchNew[1]);
      }
      lines.push({ type: "hunk", content: line });
      continue;
    }
    if (line.startsWith("---") || line.startsWith("+++")) {
      lines.push({ type: "header", content: line });
      continue;
    }
    if (line.startsWith("+")) {
      lines.push({ type: "add", content: line.slice(1), newNum: newLine });
      newLine++;
      continue;
    }
    if (line.startsWith("-")) {
      lines.push({ type: "remove", content: line.slice(1), oldNum: oldLine });
      oldLine++;
      continue;
    }
    // Context line (may start with space or be empty)
    const content = line.startsWith(" ") ? line.slice(1) : line;
    lines.push({ type: "context", content, oldNum: oldLine, newNum: newLine });
    oldLine++;
    newLine++;
  }
  return lines;
}

function computeGutterWidth(lines: DiffLine[]): number {
  let maxNum = 1;
  for (const line of lines) {
    if (line.oldNum && line.oldNum > maxNum) maxNum = line.oldNum;
    if (line.newNum && line.newNum > maxNum) maxNum = line.newNum;
  }
  // marker(1) + space + digits + space + │ + space = digits + 5
  return String(maxNum).length + 5;
}

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
  const lines = parseDiffLines(code);
  const gutterWidth = computeGutterWidth(lines);
  const contentWidth = Math.max(8, wrapWidth - gutterWidth - 2);
  const borderChar = "┈";
  const borderLine = borderChar.repeat(Math.min(wrapWidth, 60));

  return (
    <Box flexDirection="column" marginLeft={1}>
      <Text color={theme.subtle ?? theme.dim ?? theme.muted} dimColor>
        {borderLine}
      </Text>
      {lines.map((line, idx) => {
        if (line.type === "hunk") {
          return (
            <Box key={`hunk-${idx}`}>
              <Text color={theme.muted} dimColor>
                {"  ···"}
              </Text>
            </Box>
          );
        }
        if (line.type === "header") {
          return (
            <Box key={`header-${idx}`}>
              <Text color={theme.muted} dimColor>
                {"  "}{line.content}
              </Text>
            </Box>
          );
        }

        const marker = line.type === "add" ? "+" : line.type === "remove" ? "-" : " ";
        const lineNum = line.type === "add"
          ? line.newNum
          : line.type === "remove"
            ? line.oldNum
            : line.newNum;
        const numStr = lineNum !== undefined
          ? String(lineNum).padStart(String(gutterWidth - 5).length > 0 ? gutterWidth - 5 : 1, " ")
          : " ";
        const gutter = `${marker} ${numStr} │ `;

        const lineColor =
          line.type === "add"
            ? (theme.diffAddedWord ?? theme.success ?? "green")
            : line.type === "remove"
              ? (theme.diffRemovedWord ?? theme.error ?? "red")
              : undefined;

        const lineBg =
          line.type === "add"
            ? (theme.diffAdded ?? undefined)
            : line.type === "remove"
              ? (theme.diffRemoved ?? undefined)
              : undefined;

        const wrapped = wrapText(line.content || " ", contentWidth);

        return (
          <Box key={`line-${idx}-${marker}-${lineNum}`} flexDirection="column">
            {wrapped.map((wrappedLine, wIdx) => (
              <Box key={`${idx}-w${wIdx}`} flexDirection="row">
                <Text color={theme.dim ?? theme.muted} dimColor>
                  {wIdx === 0 ? gutter : " ".repeat(gutter.length)}
                </Text>
                <Text
                  color={lineColor}
                  backgroundColor={lineBg}
                  dimColor={dim || line.type === "context"}
                >
                  {wrappedLine}
                </Text>
              </Box>
            ))}
          </Box>
        );
      })}
      <Text color={theme.subtle ?? theme.dim ?? theme.muted} dimColor>
        {borderLine}
      </Text>
    </Box>
  );
}
