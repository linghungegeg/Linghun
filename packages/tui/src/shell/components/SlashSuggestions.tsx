import type { Language } from "@linghun/shared";
import { Box, Text } from "@linghun/ink-runtime";
import type React from "react";
import type { CommandCapability } from "../../natural-command-bridge.js";
import { fitText } from "../text-utils.js";
import type { ShellTheme } from "../theme.js";

export function slashSuggestionColumnCount(width: number): number {
  void width;
  return 1;
}

export function slashSuggestionRowCount(
  candidateCount: number,
  width: number,
  maxRows?: number,
): number {
  if (candidateCount <= 0) return 0;
  const uncapped = Math.ceil(candidateCount / slashSuggestionColumnCount(width));
  if (maxRows === undefined) return uncapped;
  return Math.min(uncapped, Math.max(0, Math.floor(maxRows) - 1));
}

export function computeScrollWindow(
  total: number,
  selected: number,
  maxVisible: number,
): { start: number; end: number } {
  const safeTotal = Math.max(0, Math.floor(total));
  const safeMaxVisible = Math.max(0, Math.floor(maxVisible));
  if (safeTotal === 0 || safeMaxVisible === 0) return { start: 0, end: 0 };
  if (safeTotal <= safeMaxVisible) return { start: 0, end: safeTotal };
  const safeSelected = Math.max(0, Math.min(Math.floor(selected), safeTotal - 1));
  const half = Math.floor(safeMaxVisible / 2);
  const start = Math.max(0, Math.min(safeSelected - half, safeTotal - safeMaxVisible));
  return { start, end: start + safeMaxVisible };
}

/**
 * Inline slash command suggestion list, shown above the composer when the user
 * is typing a slash prefix (e.g. "/m"). Pure render — selection state and
 * keyboard handling live in the Composer.
 *
 * Rendering rules:
 *   - Single-column layout: each row keeps slash and title aligned, with the
 *     slash label padded to the widest visible slash (capped at 14).
 *   - Selected row uses an accent marker; others use muted color.
 *   - Render a capped sliding window; maxRows is the total popup budget
 *     including the hint line, and overflow indicators reuse candidate rows.
 */
export function SlashSuggestions({
  candidates,
  selectedIndex,
  theme,
  language,
  width,
  maxRows,
  hint,
}: {
  candidates: CommandCapability[];
  selectedIndex: number;
  theme: ShellTheme;
  language: Language;
  width: number;
  maxRows?: number;
  hint?: string;
}): React.ReactNode {
  if (candidates.length === 0) return null;
  const safeIndex = Math.max(0, Math.min(selectedIndex, candidates.length - 1));
  const maxCandidateRows =
    maxRows === undefined ? candidates.length : Math.max(0, Math.floor(maxRows) - (hint ? 1 : 0));
  const window = computeScrollWindow(candidates.length, safeIndex, maxCandidateRows);
  const visibleCandidates = candidates.slice(window.start, window.end);
  if (visibleCandidates.length === 0) return null;
  const hasBefore = window.start > 0;
  const hasAfter = window.end < candidates.length;
  const widest = visibleCandidates.reduce((acc, item) => Math.max(acc, item.slash.length), 0);
  const labelWidth = Math.min(Math.max(widest + 2, 12), 14);
  const columnCount = slashSuggestionColumnCount(width);
  const rowCount = slashSuggestionRowCount(visibleCandidates.length, width);
  const colWidth = Math.max(18, Math.floor(width / columnCount));
  return (
    <Box flexDirection="column" width={width}>
      {Array.from({ length: rowCount }, (_, rowIndex) => {
        const cells: string[] = [];
        let selectedInRow = false;
        for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
          const itemIndex = rowIndex * columnCount + columnIndex;
          const item = visibleCandidates[itemIndex];
          if (!item) continue;
          const absoluteIndex = window.start + itemIndex;
          const title = language === "en-US" ? item.titleEn : item.titleZh;
          const isSelected = absoluteIndex === safeIndex;
          if (isSelected) selectedInRow = true;
          const marker = isSelected ? "›" : " ";
          const overflow =
            rowIndex === 0 && hasBefore
              ? " ▲"
              : rowIndex === rowCount - 1 && hasAfter
                ? " ▼"
                : "";
          const cell = `${marker} ${item.slash.padEnd(labelWidth, " ")}${title}${overflow}`;
          cells.push(fitText(cell, Math.max(10, colWidth - 1)).padEnd(colWidth, " "));
        }
        const line = cells.join("");
        return (
          <Text key={`slash-row-${rowIndex}`} color={selectedInRow ? theme.accent : theme.muted} bold={selectedInRow}>
            {fitText(line, Math.max(20, width - 2))}
          </Text>
        );
      })}
      {hint ? <Text color={theme.muted}>{fitText(hint, Math.max(20, width - 2))}</Text> : null}
    </Box>
  );
}
