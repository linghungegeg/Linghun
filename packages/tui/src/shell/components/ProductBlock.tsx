import { Box, Text } from "ink";
import type React from "react";
import { fitText } from "../text-utils.js";
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
  // Command transcript row — slash command 提交后作为独立 `❯ /command` 行进入
  // task transcript，与下方 tool/output 块视觉分层。U+276F + accent 颜色，
  // 不带 status marker、不带 detail/nextAction，只显示一行命令。
  if (block.kind === "command") {
    return (
      <Box marginBottom={0}>
        <Text>
          <Text color={theme.muted}>{"\u276F "}</Text>
          <Text color={theme.accent}>{fitText(block.title, Math.max(8, width - 2))}</Text>
        </Text>
      </Box>
    );
  }
  // 只有 permission/fail 运行时事件才用 bordered card，setup 不用
  const emphasized = (block.kind === "permission" || block.status === "fail") && !compact;
  return (
    <Box
      flexDirection="column"
      borderStyle={emphasized ? "single" : undefined}
      borderColor={emphasized ? theme.border : undefined}
      paddingX={emphasized ? 1 : 0}
      marginBottom={0}
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
