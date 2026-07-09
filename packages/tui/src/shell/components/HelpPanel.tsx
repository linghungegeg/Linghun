import type { Language } from "@linghun/shared";
import { Box, Text, useInput } from "@linghun/ink-runtime";
import type React from "react";
import { fitText } from "../text-utils.js";
import { createShellTheme } from "../theme.js";
import type { ShellController } from "../types.js";

/**
 * HelpPanel — D.13Q-UX Closure + P0 scroll viewport
 *
 * 真 UI 面板替换 /help 的 writeLine 文本表。
 * - Pane border + 标题 + 分组 Tab（core / advanced / details）
 * - Select 列表：↑↓ 选择，Enter dispatch slash，Esc 关闭
 * - Tab 或 ←→ 切组
 * - scrollOffset 视窗：最多 MAX_VISIBLE 条可见，cursor 自动带滚动
 */

const MAX_VISIBLE = 10;

const HINT_TEXT = {
  "zh-CN": {
    title: "/help",
    nav: "↑↓ 选择 · Enter 执行 · Tab/←→ 切换分组 · Esc 关闭",
    groupCore: "核心",
    groupAdvanced: "进阶",
    groupDetails: "详情",
    count: (start: number, end: number, total: number) =>
      `第 ${start}-${end} 项，共 ${total} 项`,
  },
  "en-US": {
    title: "/help",
    nav: "↑↓ select · Enter dispatch · Tab/←→ switch group · Esc close",
    groupCore: "Core",
    groupAdvanced: "Advanced",
    groupDetails: "Details",
    count: (start: number, end: number, total: number) =>
      `${start}-${end} of ${total}`,
  },
} as const;

export function HelpPanel({
  panel,
  controller: _controller,
  width,
  noColor,
  language,
}: {
  panel: {
    group: "core" | "advanced" | "details";
    cursor: number;
    scrollOffset: number;
    entries: { slash: string; description: string }[];
  };
  controller: ShellController;
  width: number;
  noColor: boolean;
  language: Language;
}): React.ReactNode {
  const theme = createShellTheme(noColor);
  const hint = HINT_TEXT[language] ?? HINT_TEXT["zh-CN"];
  const innerWidth = Math.max(20, Math.min(width - 2, 76));

  useInput(() => undefined, { isActive: false });

  const total = panel.entries.length;
  const maxOffset = Math.max(0, total - MAX_VISIBLE);
  const scrollOffset = Math.max(0, Math.min(panel.scrollOffset, maxOffset));
  const visible = panel.entries.slice(scrollOffset, scrollOffset + MAX_VISIBLE);
  const visibleEnd = Math.min(scrollOffset + MAX_VISIBLE, total);

  const groupTabs: ("core" | "advanced" | "details")[] = ["core", "advanced", "details"];
  const accent = theme.help ?? theme.accent;

  return (
    <Box flexDirection="column" paddingX={1} marginTop={1}>
      <Text color={accent} bold>
        {fitText(hint.title, innerWidth)}
      </Text>

      {/* Group tabs — current group underlined with accent, others muted */}
      <Box marginTop={1}>
        {groupTabs.map((g, i) => {
          const active = g === panel.group;
          const label =
            g === "core"
              ? hint.groupCore
              : g === "advanced"
                ? hint.groupAdvanced
                : hint.groupDetails;
          return (
            <Box key={g}>
              {i > 0 ? (
                <Text color={theme.dim ?? theme.muted}>  </Text>
              ) : null}
              {active ? (
                <Box flexDirection="column">
                  <Text color={accent} bold>
                    {label}
                  </Text>
                  <Text color={accent}>
                    {"─".repeat([...label].length)}
                  </Text>
                </Box>
              ) : (
                <Text color={theme.muted} dimColor>
                  {label}
                </Text>
              )}
            </Box>
          );
        })}
      </Box>

      {/* Count hint */}
      {total > 0 ? (
        <Text color={theme.dim ?? theme.muted} dimColor>
          {hint.count(scrollOffset + 1, visibleEnd, total)}
        </Text>
      ) : null}

      {/* Nav hint */}
      <Text color={theme.dim ?? theme.muted} dimColor>
        {fitText(hint.nav, innerWidth)}
      </Text>

      {/* Entry list — virtual window */}
      {total === 0 ? (
        <Text color={theme.dim ?? theme.muted} dimColor>
          {language === "en-US" ? "(no commands in this group)" : "（此分组没有命令）"}
        </Text>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          {visible.map((entry, vi) => {
            const realIdx = scrollOffset + vi;
            const active = realIdx === panel.cursor;
            const slashWidth = Math.min(
              Math.max(12, Math.min(22, Math.floor(innerWidth * 0.4))),
              Math.max(12, ...panel.entries.map((e) => [...e.slash].length)) + 2,
            );
            const slashCol = entry.slash.padEnd(slashWidth);
            const line = `${active ? "▸" : " "} ${slashCol}${entry.description}`;
            return (
              <Text
                key={entry.slash}
                color={active ? accent : undefined}
                bold={active}
              >
                {fitText(line, innerWidth)}
              </Text>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
