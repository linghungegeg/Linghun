import type { Language } from "@linghun/shared";
import { Box, Text, useInput } from "ink";
import type React from "react";
import { fitText } from "../text-utils.js";
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
    list: "↑↓ 选择 · Enter 进入 · Esc 关闭",
    detail: "↑↓ 选择 · Enter 执行 · Esc 返回",
  },
  "en-US": {
    list: "↑↓ select · Enter open · Esc close",
    detail: "↑↓ select · Enter run · Esc back",
  },
} as const;

export function ConfigPanel({
  panel,
  controller,
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

  useInput((_input, key) => {
    if (key.escape) {
      void controller.onInput({ type: "config-back" });
      return;
    }
    if (key.return) {
      void controller.onInput({ type: "config-enter" });
      return;
    }
    if (key.upArrow) {
      void controller.onInput({ type: "config-move", delta: -1 });
      return;
    }
    if (key.downArrow) {
      void controller.onInput({ type: "config-move", delta: 1 });
      return;
    }
  });

  const innerWidth = Math.max(20, Math.min(width, 76) - 4);

  if (panel.phase === "panel_list") {
    return (
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor={theme.border}
        paddingX={1}
        marginTop={1}
        width={Math.min(width, 76)}
      >
        <Text color={theme.accent} bold>
          {fitText("/config", innerWidth)}
        </Text>
        <Text color={theme.muted}>{fitText(hint.list, innerWidth)}</Text>
        {panel.panels.map((p, idx) => {
          const active = idx === panel.cursor;
          return (
            <Text key={p.id} color={active ? theme.accent : undefined}>
              {fitText(`${active ? "▸ " : "  "}${p.title}  ${p.summary}`, innerWidth)}
            </Text>
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
      width={Math.min(width, 76)}
    >
      <Text color={theme.accent} bold>
        {fitText(`/config · ${panel.panel.title}`, innerWidth)}
      </Text>
      <Text color={theme.muted}>{fitText(panel.panel.summary, innerWidth)}</Text>
      <Text color={theme.muted}>{fitText(hint.detail, innerWidth)}</Text>
      {panel.actions.map((a, idx) => {
        const active = idx === panel.actionCursor;
        return (
          <Text key={a.id} color={active ? theme.accent : undefined}>
            {fitText(`${active ? "▸ " : "  "}${a.label}`, innerWidth)}
          </Text>
        );
      })}
    </Box>
  );
}
