import { Box, Text } from "ink";
import type React from "react";

export type UnseenMessagePillProps = {
  count: number;
  language: "zh-CN" | "en-US";
  width: number;
};

/**
 * Renders a centered pill showing the unseen message count.
 * Returns null when count <= 0.
 */
export function UnseenMessagePill({
  count,
  language,
}: UnseenMessagePillProps): React.ReactNode {
  if (count <= 0) return null;

  const label =
    language === "zh-CN"
      ? `↓ ${count} 条新消息`
      : `↓ ${count} new messages`;

  return (
    <Box justifyContent="center">
      <Text bold dimColor>
        {label}
      </Text>
    </Box>
  );
}
