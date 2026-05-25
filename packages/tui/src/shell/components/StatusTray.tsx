import { Box, Text } from "ink";
import type React from "react";
import type { ShellTheme } from "../theme.js";
import type { StatusTrayViewModel } from "../types.js";

export function StatusTray({
  status,
  theme,
  width,
}: {
  status: StatusTrayViewModel;
  theme: ShellTheme;
  width: number;
}): React.ReactNode {
  const items = [status.project, status.model, status.permission, status.index, status.background];
  // P1-2: narrow terminal keeps background visible (already uses short label from view-model)
  // Drop index first when narrow, keep background
  const visible = width < 60 ? [items[0], items[1], items[2], items[4]] : items;
  return (
    <Box marginTop={0} marginBottom={0}>
      <Text color={theme.muted}>{visible.join("  ")}</Text>
    </Box>
  );
}
