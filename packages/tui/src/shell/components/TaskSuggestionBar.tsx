import { Box, Text } from "@linghun/ink-runtime";
import type React from "react";
import type { TaskSuggestion } from "../types.js";
import { fitText } from "../text-utils.js";
import { createShellTheme } from "../theme.js";

/**
 * TaskSuggestionBar — D.13E Step 2
 *
 * 在 Task / Pending 模式下渲染 view-model 计算好的 TaskSuggestion[]。
 * 选择由 Composer 的 ↑/↓/Enter 或数字键派发到现有 slash / permission-action 管道。
 */
export function TaskSuggestionBar({
  suggestions,
  cursor,
  width,
  noColor,
}: {
  suggestions: TaskSuggestion[];
  cursor: number;
  width: number;
  noColor: boolean;
}): React.ReactNode {
  if (!suggestions || suggestions.length === 0) return null;
  const theme = createShellTheme(noColor);
  const innerWidth = Math.max(20, width - 4);

  return (
    <Box flexDirection="column" paddingX={2} marginTop={1}>
      {suggestions.map((s, index) => {
        const cmd = s.action.kind === "slash" ? s.action.command : "";
        const marker = index === cursor ? ">" : " ";
        const key = `${index + 1}.`;
        const head = cmd ? `${marker} ${key} ${s.label} (${cmd})` : `${marker} ${key} ${s.label}`;
        const line = s.hint ? `${head} — ${s.hint}` : head;
        return (
          <Text key={s.id} color={index === cursor ? theme.accent : theme.muted}>
            {fitText(line, innerWidth)}
          </Text>
        );
      })}
    </Box>
  );
}
