import { Box, Text } from "ink";
import type React from "react";
import type { ShellTheme } from "../theme.js";
import type { NotificationView } from "../types.js";

/**
 * D.13Q-UX — NotificationStack
 *
 * CCB Notifications.tsx 范式：右对齐栈，单时刻只显示 1 条主消息（priority +
 * 队列）。轻提示**绝不进 transcript**；用于 cache-low / freshness / shortcut /
 * setup-hint 等短暂状态。
 *
 * 不引入 ink 计时器：消息超时由 view-model 在下一次 createShellViewModel 时
 * 移除 notification（保持渲染纯函数）。本组件只负责显示当前队列里 priority
 * 最高的一条；priority 排序：immediate > medium > low。
 */

export function NotificationStack({
  notifications,
  theme,
}: {
  notifications: NotificationView[] | undefined;
  theme: ShellTheme;
}): React.ReactNode {
  if (!notifications || notifications.length === 0) return null;
  const sorted = [...notifications].sort(comparePriority);
  const top = sorted[0];
  if (!top) return null;
  return (
    <Box justifyContent="flex-end" paddingX={2}>
      <Text color={pickToneColor(theme, top.tone)} dimColor={isDim(top.tone)}>
        {top.text}
      </Text>
    </Box>
  );
}

function comparePriority(a: NotificationView, b: NotificationView): number {
  const order: Record<NotificationView["priority"], number> = {
    immediate: 0,
    medium: 1,
    low: 2,
  };
  return order[a.priority] - order[b.priority];
}

function pickToneColor(theme: ShellTheme, tone: NotificationView["tone"]): string | undefined {
  switch (tone) {
    case "error":
      return theme.error ?? theme.status.fail;
    case "warning":
      return theme.warning ?? theme.status.partial;
    case "success":
      return theme.success ?? theme.status.pass;
    case "default":
      return theme.notification ?? theme.muted;
    default:
      return theme.dim ?? theme.muted;
  }
}

function isDim(tone: NotificationView["tone"]): boolean {
  return !tone || tone === "dim";
}
