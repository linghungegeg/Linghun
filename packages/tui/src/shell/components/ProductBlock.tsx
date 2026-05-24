import { Box, Text } from "ink";
import type React from "react";
import { type ShellTheme, getStatusMarker } from "../theme.js";
import type { ProductBlockViewModel } from "../types.js";

export function ProductBlock({
  block,
  theme,
  width,
}: {
  block: ProductBlockViewModel;
  theme: ShellTheme;
  width: number;
}): React.ReactNode {
  const compact = width < 60;
  return (
    <Box
      flexDirection="column"
      borderStyle={compact ? undefined : "round"}
      borderColor={theme.border}
      paddingX={compact ? 0 : 1}
      marginBottom={1}
    >
      <Text color={theme.status[block.status]}>
        {getStatusMarker(block.status, theme.mode === "no-color")} {block.title}
      </Text>
      <Text>{block.summary}</Text>
      {block.detail ? <Text color={theme.muted}>{block.detail}</Text> : null}
      {block.nextAction ? <Text color={theme.muted}>{block.nextAction}</Text> : null}
    </Box>
  );
}
