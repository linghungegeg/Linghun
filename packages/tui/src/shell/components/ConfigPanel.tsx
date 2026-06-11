import type { Language } from "@linghun/shared";
import { Box, Text, useInput } from "@linghun/ink-runtime";
import type React from "react";
import { fitText, wrapText } from "../text-utils.js";
import { createShellTheme } from "../theme.js";
import type { ConfigPanelView, ShellController } from "../types.js";

/**
 * ConfigPanel — D.13E Step 2 + P0 scroll viewport
 *
 * 渲染 14-panel 配置入口面板。两个阶段：
 *   - panel_list：列表视图（cursor 高亮，scroll viewport）
 *   - panel_detail：进入某个 panel 的 actions 列表（actionCursor 高亮，scroll viewport）
 *
 * 自带 useInput 接键盘：↑↓ 移动 / Enter 进入或派发 / Esc 返回。
 * 与 Composer 互斥（Composer.useInput 在 ConfigPanel 渲染时 isActive=false）。
 */

const MAX_VISIBLE = 10;

const HINT_TEXT = {
  "zh-CN": {
    list: "↑↓ 选择 · Enter 进入 · Esc 关闭",
    detail: "↑↓ 选择 · Enter 执行 · Esc 返回",
    count: (start: number, end: number, total: number) =>
      `第 ${start}-${end} 项，共 ${total} 项`,
  },
  "en-US": {
    list: "↑↓ select · Enter open · Esc close",
    detail: "↑↓ select · Enter dispatch · Esc back",
    count: (start: number, end: number, total: number) =>
      `${start}-${end} of ${total}`,
  },
} as const;

export function ConfigPanel({
  panel,
  controller: _controller,
  width: _width,
  noColor,
  language,
}: {
  panel: ConfigPanelView;
  controller: ShellController;
  width: number;
  noColor: boolean;
  language: Language;
}): React.ReactNode {
  const theme = createShellTheme(noColor);
  const hint = HINT_TEXT[language] ?? HINT_TEXT["zh-CN"];

  useInput(() => undefined, { isActive: false });

  const innerWidth = 76;

  if (panel.phase === "panel_list") {
    const total = panel.panels.length;
    const maxOffset = Math.max(0, total - MAX_VISIBLE);
    const scrollOffset = Math.max(0, Math.min(panel.scrollOffset, maxOffset));
    const visible = panel.panels.slice(scrollOffset, scrollOffset + MAX_VISIBLE);
    const visibleEnd = Math.min(scrollOffset + MAX_VISIBLE, total);
    const titleWidth = Math.min(
      20,
      Math.max(8, ...panel.panels.map((p) => [...p.title].length)) + 2,
    );

    return (
      <Box flexDirection="column" paddingX={1} marginTop={1}>
        <Text color={theme.accent} bold>
          {fitText("/config", innerWidth)}
        </Text>
        {total > 0 ? (
          <Text color={theme.dim ?? theme.muted} dimColor>
            {hint.count(scrollOffset + 1, visibleEnd, total)}
          </Text>
        ) : null}
        <Text color={theme.muted}>{fitText(hint.list, innerWidth)}</Text>
        <Box flexDirection="column" marginTop={1}>
          {visible.map((p, vi) => {
            const realIdx = scrollOffset + vi;
            const active = realIdx === panel.cursor;
            const titleCol = p.title.padEnd(titleWidth);
            const line = `${active ? "▸" : " "} ${titleCol}${p.summary}`;
            return (
              <Text
                key={p.id}
                color={active ? theme.accent : undefined}
                bold={active}
              >
                {fitText(line, innerWidth)}
              </Text>
            );
          })}
        </Box>
      </Box>
    );
  }

  // panel_detail
  const actions = panel.actions;
  const total = actions.length;
  const maxOffset = Math.max(0, total - MAX_VISIBLE);
  const scrollOffset = Math.max(0, Math.min(panel.scrollOffset, maxOffset));
  const visible = actions.slice(scrollOffset, scrollOffset + MAX_VISIBLE);
  const visibleEnd = Math.min(scrollOffset + MAX_VISIBLE, total);

  return (
    <Box flexDirection="column" paddingX={1} marginTop={1}>
      <Text color={theme.accent} bold>
        {fitText(`/config · ${panel.panel.title}`, innerWidth)}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {wrapText(panel.panel.summary, innerWidth).map((line, idx) => (
          <Text key={`summary-${idx}-${line}`} color={theme.muted}>
            {line}
          </Text>
        ))}
      </Box>
      {total > 0 ? (
        <Text color={theme.dim ?? theme.muted} dimColor>
          {hint.count(scrollOffset + 1, visibleEnd, total)}
        </Text>
      ) : null}
      <Text color={theme.muted}>{fitText(hint.detail, innerWidth)}</Text>
      <Box flexDirection="column" marginTop={1}>
        {visible.map((a, vi) => {
          const realIdx = scrollOffset + vi;
          const active = realIdx === panel.actionCursor;
          return (
            <Box key={a.id} flexDirection="column">
              {wrapText(
                `${active ? "▸ " : "  "}${a.label}`,
                innerWidth,
              ).map((part, lineIdx) => (
                <Text
                  key={`${a.id}-${lineIdx}`}
                  color={active ? theme.accent : undefined}
                >
                  {lineIdx === 0 ? part : `  ${fitText(part, Math.max(8, innerWidth - 2))}`}
                </Text>
              ))}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
