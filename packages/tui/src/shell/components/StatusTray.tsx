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
  const items = [
    status.model,
    status.mode,
    status.trust,
    status.index,
    status.cache,
    status.background,
  ];
  const visible = width < 60 ? items.slice(0, 4) : items;
  return (
    <Box marginTop={1} marginBottom={1}>
      <Text color={theme.muted}>{visible.join(" · ")}</Text>
    </Box>
  );
}
