import type { Language } from "@linghun/shared";
import { Box, Text, useInput } from "@linghun/ink-runtime";
import type React from "react";
import { fitText } from "../text-utils.js";
import { createShellTheme } from "../theme.js";
import type { ShellController } from "../types.js";

/**
 * HelpPanel — D.13Q-UX Closure
 *
 * 真 UI 面板替换 /help 的 writeLine 文本表。CCB HelpV2 范式：
 * - Pane border + 标题 + 分组 Tab（core / advanced / details）
 * - Select 列表：↑↓ 选择，Enter dispatch slash，Esc 关闭
 * - Tab 或 ←→ 切组
 * - 隐藏命令（userVisible=false / /status 等）永远过滤（数据层在 help-panel.ts）
 *
 * 自带 useInput；与 Composer 互斥（Composer.useInput 在 helpPanel 渲染时
 * isActive=false）。dispatch 通过 controller.onInput → index.ts wiring。
 */

const HINT_TEXT = {
  "zh-CN": {
    title: "/help",
    nav: "↑↓ 选择 · Enter 执行 · Tab/←→ 切换分组 · Esc 关闭",
    groupCore: "核心",
    groupAdvanced: "进阶",
    groupDetails: "详情",
  },
  "en-US": {
    title: "/help",
    nav: "↑↓ select · Enter dispatch · Tab/←→ switch group · Esc close",
    groupCore: "Core",
    groupAdvanced: "Advanced",
    groupDetails: "Details",
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
    entries: { slash: string; description: string }[];
  };
  controller: ShellController;
  width: number;
  noColor: boolean;
  language: Language;
}): React.ReactNode {
  const theme = createShellTheme(noColor);
  const hint = HINT_TEXT[language] ?? HINT_TEXT["zh-CN"];

  useInput(() => undefined, { isActive: false });

  const cardWidth = Math.min(width, 84);
  const innerWidth = Math.max(20, cardWidth - 4);

  const groupLabel = (g: "core" | "advanced" | "details", current: boolean): string => {
    const text =
      g === "core" ? hint.groupCore : g === "advanced" ? hint.groupAdvanced : hint.groupDetails;
    return current ? `[ ${text} ]` : `  ${text}  `;
  };

  return (
    <Box
      flexDirection="column"
      paddingX={1}
      marginTop={1}
      width={cardWidth}
    >
      <Text color={theme.dim ?? theme.muted} dimColor>
        {"─".repeat(Math.min(cardWidth, 80))}
      </Text>
      <Text color={theme.help ?? theme.accent} bold>
        {fitText(hint.title, innerWidth)}
      </Text>
      <Text>
        <Text
          color={panel.group === "core" ? (theme.help ?? theme.accent) : theme.muted}
          bold={panel.group === "core"}
        >
          {groupLabel("core", panel.group === "core")}
        </Text>
        <Text
          color={panel.group === "advanced" ? (theme.help ?? theme.accent) : theme.muted}
          bold={panel.group === "advanced"}
        >
          {groupLabel("advanced", panel.group === "advanced")}
        </Text>
        <Text
          color={panel.group === "details" ? (theme.help ?? theme.accent) : theme.muted}
          bold={panel.group === "details"}
        >
          {groupLabel("details", panel.group === "details")}
        </Text>
      </Text>
      <Text color={theme.dim ?? theme.muted} dimColor>
        {fitText(hint.nav, innerWidth)}
      </Text>
      {panel.entries.length === 0 ? (
        <Text color={theme.dim ?? theme.muted} dimColor>
          {language === "en-US" ? "(no commands in this group)" : "（此分组没有命令）"}
        </Text>
      ) : (
        panel.entries.map((entry, idx) => {
          const active = idx === panel.cursor;
          const slashCol = entry.slash.padEnd(20);
          const line = `${active ? "▸ " : "  "}${slashCol}${entry.description}`;
          return (
            <Text
              key={entry.slash}
              color={active ? (theme.help ?? theme.accent) : undefined}
              bold={active}
            >
              {fitText(line, innerWidth)}
            </Text>
          );
        })
      )}
    </Box>
  );
}
