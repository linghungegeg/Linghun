import { Box, Text } from "@linghun/ink-runtime";
import type React from "react";
import { messages } from "../../tui-messages.js";
import { fitText } from "../text-utils.js";
import { createShellTheme } from "../theme.js";
import type { AgentProgressTreeView } from "../types.js";

export function AgentProgressTree({
  tree,
  width,
  noColor,
  language,
}: {
  tree: AgentProgressTreeView;
  width: number;
  noColor: boolean;
  language: "zh-CN" | "en-US";
}): React.ReactNode {
  if (tree.rows.length === 0) return null;
  const theme = createShellTheme(noColor);
  const innerWidth = Math.max(20, width - 2);
  const text = messages[language];

  return (
    <Box flexDirection="column" marginTop={1}>
      {tree.rows.map((row, index) => {
        const selected = tree.cursor === index;
        const expanded = tree.expandedId === row.id;
        // CCB: highlighted → ╞═/╘═, normal → ├─/└─
        const isLast = index === tree.rows.length - 1;
        const treeChar = selected
          ? isLast
            ? "╘═"
            : "╞═"
          : isLast
            ? "└─"
            : "├─";
        const completed = row.status === "completed";
        const statusColor = completed
          ? theme.status.info
          : row.status === "blocked"
            ? theme.status.blocked
            : theme.muted;

        return (
          <Box key={row.id} flexDirection="column">
            <Box>
              {/* Selection pointer: ▶ when selected, space otherwise (CCB figures.pointer pattern) */}
              <Text
                color={selected ? theme.accent : undefined}
                bold={selected}
              >
                {completed ? "✓" : selected ? "▶" : " "}
              </Text>
              <Text color={statusColor} dimColor={!selected && !completed}>
                {treeChar}{" "}
              </Text>
              <Text
                color={selected ? theme.accent : statusColor}
                dimColor={!selected || completed}
              >
                {fitText(
                  `${row.name}${row.activity ? `: ${row.activity}` : ""}`,
                  innerWidth - 2,
                )}
              </Text>
            </Box>
            {/* Expanded detail row (CCB enter-to-view pattern) */}
            {expanded ? (
              <Box paddingLeft={4}>
                <Text color={theme.muted} dimColor>
                  {text.r3AgentDetailStatus}: {row.status}
                  {" · "}
                  {text.r3AgentDetailTools}: {row.toolUses}
                </Text>
              </Box>
            ) : null}
          </Box>
        );
      })}
      {/* Keyboard hints when selection active */}
      {tree.cursor >= 0 ? (
        <Box paddingLeft={3}>
          <Text color={theme.muted} dimColor>
            {language === "en-US"
              ? "↑↓ select · enter view · x close · esc cancel"
              : "↑↓ 选择 · Enter 查看 · x 关闭 · Esc 取消"}
          </Text>
        </Box>
      ) : tree.rows.some((r) => r.status === "running") ? (
        <Box paddingLeft={2}>
          <Text color={theme.muted} dimColor>
            {language === "en-US"
              ? "↑↓ navigate · x stop · esc cancel"
              : "↑↓ 导航 · x 停止 · Esc 取消"}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
