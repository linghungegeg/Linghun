import type { Language } from "@linghun/shared";
import { Box, Text, useInput } from "ink";
import type React from "react";
import { fitText } from "../text-utils.js";
import { createShellTheme } from "../theme.js";
import type { CommandPanelView, ShellController } from "../types.js";

/**
 * CommandPanel — D.13Q-UX Task Surface Maturity Sweep
 *
 * 高级 slash 命令（/mcp, /memory, /index status, /cache, /background, /job,
 * /plugins, /skills, /remote, /doctor, /model 等）的默认输出容器。
 *
 * 与 transcript 隔离：assistant_text / tool_result_* 等消息语义 block 仍走
 * ProductBlock + transcript 流；CommandPanel 是命令操作面板，不污染对话流。
 *
 * 渲染层级（克制配色）：
 *   - 边框走 theme.panel（neutral muted）/ warning / error
 *   - 标题走 theme.accent，命令文本前缀 "❯"
 *   - summary 行走默认色，sections 标题走 theme.muted
 *   - actions 走 theme.accent dim
 *
 * 键盘：Esc 关闭面板（派发 command-panel-close）。其他键盘交给 Composer。
 */
const HINT_TEXT = {
  "zh-CN": "Esc 关闭面板 · Ctrl+O 展开详情",
  "en-US": "Esc close · Ctrl+O details",
} as const;

export function CommandPanel({
  panel,
  controller,
  width,
  noColor,
  language,
}: {
  panel: CommandPanelView;
  controller: ShellController;
  width: number;
  noColor: boolean;
  language: Language;
}): React.ReactNode {
  const theme = createShellTheme(noColor);
  const hint = HINT_TEXT[language] ?? HINT_TEXT["zh-CN"];

  useInput((_input, key) => {
    if (key.escape) {
      void controller.onInput({ type: "command-panel-close" });
      return;
    }
  });

  const cardWidth = Math.min(width, 90);
  const innerWidth = Math.max(20, cardWidth - 4);
  const tone = panel.tone ?? "neutral";
  const borderColor =
    tone === "error"
      ? (theme.error ?? theme.status.fail)
      : tone === "warning"
        ? theme.warning
        : (theme.panel ?? theme.border);

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={borderColor}
      paddingX={1}
      marginTop={1}
      width={cardWidth}
    >
      {panel.title && panel.title.trim().length > 0 ? (
        <Text color={theme.accent} bold>
          {fitText(`❯ ${panel.title}`, innerWidth)}
        </Text>
      ) : null}
      {panel.summary && panel.summary.length > 0 ? (
        <Box flexDirection="column">
          {panel.summary.map((line, idx) => (
            <Text key={`${idx}-${line}`}>{fitText(line, innerWidth)}</Text>
          ))}
        </Box>
      ) : null}
      {panel.sections && panel.sections.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          {panel.sections.map((section) => (
            <Box key={`section-${section.title ?? section.rows.join("\n")}`} flexDirection="column">
              {section.title ? (
                <Text color={theme.muted} bold>
                  {fitText(section.title, innerWidth)}
                </Text>
              ) : null}
              {section.rows.map((row) => (
                <Text key={`row-${section.title ?? "untitled"}-${row}`}>
                  {fitText(row, innerWidth)}
                </Text>
              ))}
            </Box>
          ))}
        </Box>
      ) : null}
      {panel.expanded && panel.detailsText ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color={theme.muted}>
            {fitText(language === "en-US" ? "— details —" : "— 详情 —", innerWidth)}
          </Text>
          {panel.detailsText.split("\n").map((line, idx) => (
            <Text key={`detail-${idx}-${line}`} color={theme.dim ?? theme.muted}>
              {fitText(line, innerWidth)}
            </Text>
          ))}
        </Box>
      ) : null}
      {panel.actions && panel.actions.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          {panel.actions.map((action, idx) => (
            <Text key={`action-${idx}-${action}`} color={theme.dim ?? theme.muted}>
              {fitText(`→ ${action}`, innerWidth)}
            </Text>
          ))}
        </Box>
      ) : null}
      <Text color={theme.dim ?? theme.muted} dimColor>
        {fitText(hint, innerWidth)}
      </Text>
    </Box>
  );
}
