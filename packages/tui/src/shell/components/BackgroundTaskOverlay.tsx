import { Box, Text } from "ink";
import type React from "react";
import { fitText, wrapText } from "../text-utils.js";
import { createShellTheme } from "../theme.js";
import type { BackgroundTaskOverlayView } from "../types.js";

const MAX_ROWS = 10;

export function BackgroundTaskOverlay({
  overlay,
  width,
  noColor,
}: {
  overlay: BackgroundTaskOverlayView;
  width: number;
  noColor: boolean;
}): React.ReactNode {
  const theme = createShellTheme(noColor);
  const cardWidth = Math.max(24, Math.min(width, 110));
  const innerWidth = Math.max(20, cardWidth - 4);
  const offset = Math.max(0, Math.min(overlay.cursor - MAX_ROWS + 1, Math.max(0, overlay.rows.length - MAX_ROWS)));
  const rows = overlay.rows.slice(offset, offset + MAX_ROWS);
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.panel ?? theme.border}
      paddingX={1}
      marginTop={1}
      width={cardWidth}
    >
      <Text color={theme.accent} bold>
        {fitText(`❯ ${overlay.title}`, innerWidth)}
      </Text>
      <Text color={theme.muted}>{fitText(overlay.summary, innerWidth)}</Text>
      <Box flexDirection="column" marginTop={1}>
        {rows.length > 0 ? (
          rows.map((row, index) => {
            const actualIndex = offset + index;
            const selected = actualIndex === overlay.cursor;
            const progress = row.progress ? ` · ${row.progress.completed}/${row.progress.total ?? "?"}` : "";
            return (
              <Text key={row.id} color={selected ? theme.accent : undefined}>
                {fitText(`${selected ? ">" : " "} ${row.kind} · ${row.title} · ${row.status}${progress}`, innerWidth)}
              </Text>
            );
          })
        ) : (
          <Text color={theme.muted}>-</Text>
        )}
      </Box>
      {overlay.rows[overlay.cursor]?.detailsText ? (
        <Box flexDirection="column" marginTop={1}>
          {wrapText(overlay.rows[overlay.cursor]?.detailsText ?? "", innerWidth).map((line, index) => (
            <Text key={`${index}-${line}`} color={theme.dim ?? theme.muted}>
              {line}
            </Text>
          ))}
        </Box>
      ) : null}
      <Text color={theme.dim ?? theme.muted} dimColor>
        {fitText(overlay.hint, innerWidth)}
      </Text>
    </Box>
  );
}
