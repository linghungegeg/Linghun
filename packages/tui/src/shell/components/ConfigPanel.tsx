import type { Language } from "@linghun/shared";
import { Box, Text, useInput } from "@linghun/ink-runtime";
import type React from "react";
import { fitText, wrapText } from "../text-utils.js";
import { createShellTheme } from "../theme.js";
import type { ConfigPanelView, ShellController } from "../types.js";

/**
 * ConfigPanel — D.13E Step 2
 *
 * 渲染 14-panel 配置入口面板。两个阶段：
 *   - panel_list：列表视图（cursor 高亮）
 *   - panel_detail：进入某个 panel 的 actions 列表（actionCursor 高亮）
 *
 * 自带 useInput 接键盘：↑↓ 移动 / Enter 进入或派发 / Esc 返回。
 * 与 Composer 互斥（Composer.useInput 在 ConfigPanel 渲染时 isActive=false），
 * 是当前事件的唯一消费者。
 *
 * 不做内联编辑（不直接修改 setting 值），所有"动作"通过 onInput
 * config-* 事件路由到 controller，再由 controller 派发对应 slash 走
 * processTuiLine（与 /index doctor 等命令一致）。
 *
 * 操作提示按 view.language 本地化（panel title / summary 已在 view-model 层
 * 本地化，这里只本地化"键盘操作行"自身）。
 */
const HINT_TEXT = {
  "zh-CN": {
    list: "Enter · Esc",
    detail: "Enter · Esc",
  },
  "en-US": {
    list: "Enter · Esc",
    detail: "Enter · Esc",
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

  const panelWidth = Math.max(20, Math.min(width, 96));
  const innerWidth = Math.max(20, panelWidth - 4);

  if (panel.phase === "panel_list") {
    return (
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor={theme.border}
        paddingX={1}
        marginTop={1}
        width={panelWidth}
      >
        <Text color={theme.accent} bold>
          {fitText("/config", innerWidth)}
        </Text>
        <Text color={theme.muted}>{fitText(hint.list, innerWidth)}</Text>
        {panel.panels.map((p, idx) => {
          const active = idx === panel.cursor;
          const line = `${active ? "▸ " : "  "}${p.title}  ${p.summary}`;
          return (
            <Box key={p.id} flexDirection="column">
              {wrapText(line, innerWidth).map((part, lineIdx) => (
                <Text key={`${p.id}-${lineIdx}`} color={active ? theme.accent : undefined}>
                  {lineIdx === 0 ? part : `  ${fitText(part, Math.max(8, innerWidth - 2))}`}
                </Text>
              ))}
            </Box>
          );
        })}
      </Box>
    );
  }

  // panel_detail
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={theme.border}
      paddingX={1}
      marginTop={1}
      width={panelWidth}
    >
      <Text color={theme.accent} bold>
        {fitText(`/config · ${panel.panel.title}`, innerWidth)}
      </Text>
      <Box flexDirection="column">
        {wrapText(panel.panel.summary, innerWidth).map((line, idx) => (
          <Text key={`summary-${idx}-${line}`} color={theme.muted}>
            {line}
          </Text>
        ))}
      </Box>
      <Text color={theme.muted}>{fitText(hint.detail, innerWidth)}</Text>
      {panel.actions.map((a, idx) => {
        const active = idx === panel.actionCursor;
        const line = `${active ? "▸ " : "  "}${a.label}`;
        return (
          <Box key={a.id} flexDirection="column">
            {wrapText(line, innerWidth).map((part, lineIdx) => (
              <Text key={`${a.id}-${lineIdx}`} color={active ? theme.accent : undefined}>
                {lineIdx === 0 ? part : `  ${fitText(part, Math.max(8, innerWidth - 2))}`}
              </Text>
            ))}
          </Box>
        );
      })}
    </Box>
  );
}
