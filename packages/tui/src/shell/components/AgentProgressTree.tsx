import { Box, Text } from "@linghun/ink-runtime";
import type React from "react";
import { useMemo } from "react";
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
  const theme = useMemo(() => createShellTheme(noColor), [noColor]);
  const innerWidth = Math.max(20, width - 2);
  const text = messages[language];
  const workLabel = language === "en-US" ? "working" : "工作";

  const runningRows = tree.rows.filter((r) => r.status === "running");
  const completedRows = tree.rows.filter((r) => r.status === "completed");
  const allCompleted = runningRows.length === 0 && completedRows.length > 0;

  // All agents completed: collapse entire tree into a single summary line
  if (allCompleted) {
    const summaryText = language === "en-US"
      ? `✓ ${completedRows.length} agents completed · Ctrl+O details`
      : `✓ ${completedRows.length} 个 agent 已完成 · Ctrl+O 详情`;
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color={theme.muted} dimColor>
          {fitText(summaryText, innerWidth)}
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      {tree.rows.map((row, index) => {
        const selected = tree.cursor === index;
        const expanded = tree.expandedId === row.id;
        const completed = row.status === "completed";

        // Completed agents: collapse to single-line summary
        if (completed && !expanded) {
          const completedText = `✓ ${row.name} · ${row.toolUses} tools${row.elapsed ? ` · ${row.elapsed}` : ""}`;
          return (
            <Box key={row.id}>
              <Text color={theme.muted} dimColor>
                {"  "}{fitText(completedText, innerWidth - 2)}
              </Text>
            </Box>
          );
        }

        // CCB: highlighted → ╞═/╘═, normal → ├─/└─
        const isLast = index === tree.rows.length - 1;
        const treeChar = selected
          ? isLast
            ? "╘═"
            : "╞═"
          : isLast
            ? "└─"
            : "├─";
        const rowText = `${row.name}${row.activity ? `: ${row.activity}` : ""}${
          row.elapsed ? ` · ${workLabel} ${row.elapsed}` : ""
        }`;

        return (
          <Box key={row.id} flexDirection="column">
            <Box>
              {/* Selection pointer: ▶ when selected, space otherwise (CCB figures.pointer pattern) */}
              <Text
                color={theme.dim ?? theme.muted}
                bold={selected}
                dimColor={!selected}
              >
                {completed ? "✓" : selected ? "▶" : " "}
              </Text>
              <Text color={theme.dim ?? theme.muted} dimColor={!selected}>
                {treeChar}{" "}
              </Text>
              <Text color={theme.dim ?? theme.muted} dimColor={!selected || completed}>
                {fitText(rowText, innerWidth - 2)}
              </Text>
            </Box>
            {/* Expanded detail row (CCB enter-to-view pattern) */}
            {expanded ? (
              <Box paddingLeft={4}>
                <Text color={theme.muted} dimColor>
                  {text.r3AgentDetailStatus}: {row.status}
                  {" · "}
                  {text.r3AgentDetailTools}: {row.toolUses}
                  {row.elapsed ? ` · ${workLabel} ${row.elapsed}` : ""}
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
