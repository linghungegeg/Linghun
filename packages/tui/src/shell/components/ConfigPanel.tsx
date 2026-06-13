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
const MIN_PANEL_WIDTH = 64;
const MAX_PANEL_WIDTH = 108;

const HINT_TEXT = {
  "zh-CN": {
    list: "↑↓ 选择 · Enter 进入 · Esc 关闭",
    detail: "↑↓ 选择 · Enter 执行 · Esc 返回",
    count: (start: number, end: number, total: number) => `第 ${start}-${end} 项，共 ${total} 项`,
  },
  "en-US": {
    list: "↑↓ select · Enter open · Esc close",
    detail: "↑↓ select · Enter dispatch · Esc back",
    count: (start: number, end: number, total: number) => `${start}-${end} of ${total}`,
  },
} as const;

export function ConfigPanel({
  panel,
  controller: _controller,
  width,
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

  const panelWidth = Math.max(
    40,
    Math.max(Math.min(width - 2, MIN_PANEL_WIDTH), Math.min(width - 2, MAX_PANEL_WIDTH)),
  );
  const innerWidth = Math.max(36, panelWidth - 4);

  if (panel.phase === "panel_list") {
    const total = panel.panels.length;
    const maxOffset = Math.max(0, total - MAX_VISIBLE);
    const scrollOffset = Math.max(0, Math.min(panel.scrollOffset, maxOffset));
    const visible = panel.panels.slice(scrollOffset, scrollOffset + MAX_VISIBLE);
    const visibleEnd = Math.min(scrollOffset + MAX_VISIBLE, total);
    const titleWidth = Math.min(
      18,
      Math.max(8, ...panel.panels.map((p) => [...p.title].length)) + 2,
    );
    const summaryWidth = Math.max(16, innerWidth - titleWidth - 5);

    return (
      <Box
        flexDirection="column"
        paddingX={1}
        marginTop={1}
        width={panelWidth}
        borderStyle="round"
        borderColor={theme.panel ?? theme.border}
      >
        <Box paddingX={2}>
          <Text color={theme.accent} bold>
            CONFIG
          </Text>
          <Text color={theme.dim ?? theme.muted} dimColor>
            {fitText(
              `  /config  ${total > 0 ? hint.count(scrollOffset + 1, visibleEnd, total) : ""}`,
              innerWidth - 6,
            )}
          </Text>
        </Box>
        <Box paddingX={2}>
          <Text color={theme.muted}>{fitText(hint.list, innerWidth)}</Text>
        </Box>
        <Box flexDirection="column" marginTop={1} paddingX={2}>
          {visible.map((p, vi) => {
            const realIdx = scrollOffset + vi;
            const active = realIdx === panel.cursor;
            const titleCol = p.title.padEnd(titleWidth);
            return (
              <Box key={p.id} marginTop={vi > 0 ? 1 : 0}>
                <Text color={active ? theme.accent : (theme.dim ?? theme.muted)} bold={active}>
                  {active ? "▌ " : "  "}
                </Text>
                <Text color={active ? theme.accent : undefined} bold={active}>
                  {fitText(titleCol, titleWidth)}
                </Text>
                <Text color={active ? undefined : (theme.dim ?? theme.muted)}>
                  {fitText(p.summary, summaryWidth)}
                </Text>
              </Box>
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
    <Box
      flexDirection="column"
      paddingX={1}
      marginTop={1}
      width={panelWidth}
      borderStyle="round"
      borderColor={theme.panel ?? theme.border}
    >
      <Box paddingX={2}>
        <Text color={theme.accent} bold>
          {fitText(panel.panel.title.toUpperCase(), Math.max(8, Math.floor(innerWidth * 0.45)))}
        </Text>
        <Text color={theme.dim ?? theme.muted} dimColor>
          {fitText(
            `  /config · ${panel.panel.title}`,
            Math.max(8, innerWidth - panel.panel.title.length - 2),
          )}
        </Text>
      </Box>
      <Box flexDirection="column" marginTop={1} paddingX={2}>
        {wrapText(panel.panel.summary, innerWidth).map((line, idx) => (
          <Text key={`summary-${idx}-${line}`} color={theme.muted}>
            {line}
          </Text>
        ))}
      </Box>
      <Box paddingX={2}>
        <Text color={theme.muted}>
          {fitText(
            [total > 0 ? hint.count(scrollOffset + 1, visibleEnd, total) : "", hint.detail]
              .filter(Boolean)
              .join(" · "),
            innerWidth,
          )}
        </Text>
      </Box>
      <Box flexDirection="column" marginTop={1} paddingX={2}>
        {visible.map((a, vi) => {
          const realIdx = scrollOffset + vi;
          const active = realIdx === panel.actionCursor;
          return (
            <Box key={a.id} flexDirection="column" marginTop={vi > 0 ? 1 : 0}>
              {wrapText(`${active ? "▌ " : "  "}${a.label}`, innerWidth).map((part, lineIdx) => (
                <Text
                  key={`${a.id}-${lineIdx}`}
                  color={active ? theme.accent : undefined}
                  bold={active}
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
