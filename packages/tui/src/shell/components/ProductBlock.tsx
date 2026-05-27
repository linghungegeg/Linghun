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
  // P0-3：command 显式保持 marginBottom=0，紧贴下方 tool/output 块；
  // 其他 kind 之间统一加 marginBottom=1，让长 transcript 可扫读。
  // P2-3：command 行额外加 marginTop=1，与上方块拉开 1 行视觉间隔，
  // 不引入全局序号或时间戳（避免依赖外部状态 / 假数据）。
  if (block.kind === "command") {
    return (
      <Box marginTop={1} marginBottom={0}>
        <Text>
          <Text color={theme.muted}>{"\u276F "}</Text>
          <Text color={theme.accent}>{fitText(block.title, Math.max(8, width - 2))}</Text>
        </Text>
      </Box>
    );
  }
  // P2-1：permission / fail / blocked / error 在非 compact 宽度下都用 bordered card。
  // - permission：原 P0-1 已用 single border。
  // - fail：原 D.13D 已用 single border。
  // - blocked / error：新增，使用 status 配色 (blocked=yellow, error→fail=red)
  //   作为 borderColor，让长 transcript 中的阻塞 / 错误块可扫读。
  // 其余状态（info / running / pass / partial）保持无边框，避免视觉过载。
  const isAlert =
    block.kind === "permission" ||
    block.kind === "error" ||
    block.status === "fail" ||
    block.status === "blocked";
  const emphasized = isAlert && !compact;
  // permission 卡保持中性 border 色（与 P0-1 锚定问题行配色一致）；
  // error / blocked / fail 用 status 色边框：red / yellow / red。
  const borderColor = emphasized
    ? block.kind === "permission"
      ? theme.border
      : (theme.status[block.status] ?? theme.border)
    : undefined;
  // P2-2：detail / nextAction 走 fitText 防御截断。
  // 边框态 paddingX=1，左右各 1 列+边框 2 列 = 4 列开销，预留出来防溢出。
  const innerWidth = Math.max(8, width - (emphasized ? 4 : 0));
  return (
    <Box
      flexDirection="column"
      borderStyle={emphasized ? "single" : undefined}
      borderColor={borderColor}
      paddingX={emphasized ? 1 : 0}
      marginBottom={1}
    >
      {block.title ? (
        <Text color={theme.status[block.status]}>
          {getStatusMarker(block.status, theme.mode === "no-color")} {block.title}
        </Text>
      ) : null}
      <Text>{block.summary}</Text>
      {block.detail ? (
        <Text color={theme.muted}>{fitText(block.detail, innerWidth)}</Text>
      ) : null}
      {block.nextAction ? (
        <Text color={theme.muted}>{fitText(block.nextAction, innerWidth)}</Text>
      ) : null}
    </Box>
  );
}
