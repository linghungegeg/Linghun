import { Box, Text } from "@linghun/ink-runtime";
import type React from "react";
import { fitText } from "../text-utils.js";
import { createShellTheme } from "../theme.js";

/**
 * HistorySearchPanel — Phase R4 Ctrl+R history search
 *
 * Presentation-only panel. Receives filtered results, cursor position,
 * and query from the parent state machine. Does NOT perform disk I/O.
 *
 * Parent is responsible for:
 * - useInput handling (Up/Down/Enter/Esc)
 * - Filtering history entries by query
 * - Managing cursor bounds
 */

const MAX_VISIBLE = 10;
const MAX_ENTRY_CHARS = 60;

const HINT_TEXT = {
  "zh-CN": {
    prefix: "搜索: ",
    hint: "Enter 选择 · Esc 关闭",
    empty: "无匹配",
  },
  "en-US": {
    prefix: "search: ",
    hint: "Enter select · Esc close",
    empty: "no matches",
  },
} as const;

export type HistorySearchPanelProps = {
  query: string;
  results: { text: string; timestamp: number }[];
  cursor: number;
  language: "zh-CN" | "en-US";
  noColor?: boolean;
  width?: number;
};

export function HistorySearchPanel({
  query,
  results,
  cursor,
  language,
  noColor = false,
  width = 80,
}: HistorySearchPanelProps): React.ReactNode {
  const theme = createShellTheme(noColor);
  const hint = HINT_TEXT[language] ?? HINT_TEXT["zh-CN"];

  const cardWidth = Math.min(width, 84);
  const innerWidth = Math.max(20, cardWidth - 4);

  const visible = results.slice(0, MAX_VISIBLE);

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={theme.border}
      paddingX={1}
      marginTop={1}
      width={cardWidth}
    >
      {/* Search input line */}
      <Text>
        <Text color={theme.accent} bold>
          {hint.prefix}
        </Text>
        <Text>{query || ""}</Text>
      </Text>

      {/* Results list */}
      {visible.length === 0 ? (
        <Text color={theme.dim ?? theme.muted} dimColor>
          {hint.empty}
        </Text>
      ) : (
        visible.map((entry, idx) => {
          const active = idx === cursor;
          const truncated = truncateEntry(entry.text, MAX_ENTRY_CHARS);
          return (
            <Text key={`${idx}-${entry.timestamp}`} bold={active} inverse={active}>
              {active ? "▸ " : "  "}
              <HighlightedText
                text={truncated}
                query={query}
                matchColor={theme.warning ?? "yellow"}
                noColor={noColor}
              />
            </Text>
          );
        })
      )}

      {/* Bottom hint */}
      <Text color={theme.dim ?? theme.muted} dimColor>
        {fitText(hint.hint, innerWidth)}
      </Text>
    </Box>
  );
}

/* --- Internal helpers --- */

function truncateEntry(text: string, max: number): string {
  const single = text.replace(/[\r\n]+/g, " ").trim();
  if (single.length <= max) return single;
  return `${single.slice(0, max - 1)}…`;
}

/**
 * Renders text with the first occurrence of `query` highlighted.
 * Case-insensitive substring match.
 */
function HighlightedText({
  text,
  query,
  matchColor,
  noColor,
}: {
  text: string;
  query: string;
  matchColor: string | undefined;
  noColor: boolean;
}): React.ReactElement {
  if (!query || noColor) {
    return <Text>{text}</Text>;
  }

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lowerText.indexOf(lowerQuery);

  if (idx === -1) {
    return <Text>{text}</Text>;
  }

  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + query.length);
  const after = text.slice(idx + query.length);

  return (
    <Text>
      {before}
      <Text color={matchColor} bold>
        {match}
      </Text>
      {after}
    </Text>
  );
}
