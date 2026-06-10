import { Box, Text } from "@linghun/ink-runtime";
import type React from "react";

/**
 * MessageResponse — CCB-aligned output prefix component.
 *
 * Renders a dim "⎿ " prefix followed by children in a flexRow layout.
 * Used for tool_result_success, diagnostic, local_command_output, and
 * tool_result_error blocks to visually distinguish tool output from
 * assistant text without borders.
 */
export function MessageResponse({
  children,
}: {
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <Box flexDirection="row">
      <Box flexShrink={0}>
        <Text dimColor>{"  ⎿  "}</Text>
      </Box>
      <Box flexShrink={1} flexGrow={1}>
        {children}
      </Box>
    </Box>
  );
}
