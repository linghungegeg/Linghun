import { Box, Text } from "ink";
import type React from "react";
import type { TaskSuggestion } from "../models/task-suggestion.js";
import { fitText } from "../text-utils.js";
import { createShellTheme } from "../theme.js";

/**
 * TaskSuggestionBar — D.13E Step 2
 *
 * 静态只读 hint 行：在 Task / Pending 模式下渲染 view-model 计算好的
 * TaskSuggestion[]（permission > tool_error > setup > slash 优先级，最多 4 条）。
 *
 * 不接 useInput；不替代 ConfigPanel；不做键盘热区。
 * 用户仍然必须在 Composer 输入对应 slash / 单字母（permission action）来触发动作；
 * 本组件只是给"现在能做什么"一个稳定的可见落点。
 */
export function TaskSuggestionBar({
  suggestions,
  width,
  noColor,
}: {
  suggestions: TaskSuggestion[];
  width: number;
  noColor: boolean;
}): React.ReactNode {
  if (!suggestions || suggestions.length === 0) return null;
  const theme = createShellTheme(noColor);
  const innerWidth = Math.max(20, width - 4);

  return (
    <Box flexDirection="column" paddingX={2} marginTop={1}>
      {suggestions.map((s) => {
        const cmd = s.action.kind === "slash" ? s.action.command : "";
        const head = cmd ? `${s.label} (${cmd})` : s.label;
        const line = s.hint ? `${head} — ${s.hint}` : head;
        return (
          <Text key={s.id} color={theme.muted}>
            {fitText(line, innerWidth)}
          </Text>
        );
      })}
    </Box>
  );
}
