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
  width,
  rail = false,
  tone = "default",
}: {
  children: React.ReactNode;
  width?: number;
  rail?: boolean;
  tone?: "default" | "diagnostic" | "error";
}): React.ReactNode {
  const prefixWidth = rail ? 4 : 5;
  const childWidth = width ? Math.max(8, width - prefixWidth) : undefined;
  const railText = tone === "error" ? "  ! " : "  │ ";
  return (
    <Box flexDirection="row" width={width}>
      <Box flexShrink={0}>
        <Text dimColor>{rail ? railText : "  ⎿  "}</Text>
      </Box>
      <Box flexShrink={1} flexGrow={1} width={childWidth}>
        {children}
      </Box>
    </Box>
  );
}
