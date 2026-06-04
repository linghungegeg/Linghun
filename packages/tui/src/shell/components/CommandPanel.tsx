import type { Language } from "@linghun/shared";
import { Box, Text } from "ink";
import type React from "react";
import { fitText } from "../text-utils.js";
import { createShellTheme } from "../theme.js";
import type { CommandPanelRow, CommandPanelView, ShellController } from "../types.js";

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
 * 键盘：由 Composer 的 input-owner panel 分支统一派发，CommandPanel 只负责渲染。
 */
const HINT_TEXT = {
  "zh-CN": "Esc 关闭面板",
  "en-US": "Esc close",
} as const;

const SELECTABLE_HINT_TEXT = {
  "zh-CN": "↑/↓ 选择 · Enter 详情 · x 停止 · Esc 关闭",
  "en-US": "↑/↓ select · Enter details · x stop · Esc close",
} as const;

const MAX_SELECTABLE_ROWS = 8;

export function CommandPanel({
  panel,
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
  const selectableRows = getSelectableRows(panel);
  const hasSelectableRows = selectableRows.length > 0;
  const hint = hasSelectableRows
    ? (SELECTABLE_HINT_TEXT[language] ?? SELECTABLE_HINT_TEXT["zh-CN"])
    : (HINT_TEXT[language] ?? HINT_TEXT["zh-CN"]);
  const cursor =
    selectableRows.length > 0
      ? Math.max(0, Math.min(panel.cursor ?? 0, selectableRows.length - 1))
      : 0;
  const maxScrollOffset = Math.max(0, selectableRows.length - MAX_SELECTABLE_ROWS);
  const scrollOffset = Math.max(0, Math.min(panel.scrollOffset ?? 0, maxScrollOffset));
  const selectedDetailsText = selectableRows[cursor]?.detailsText;
  const expandedDetailsText = panel.expanded
    ? (selectedDetailsText ?? panel.detailsText)
    : undefined;

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
          {panel.sections.map((section) => {
            const renderedRows = section.rows
              .map((row) =>
                renderCommandPanelRow({
                  row,
                  cursor,
                  scrollOffset,
                  selectableRows,
                  selectableCount: selectableRows.length,
                  innerWidth,
                  theme,
                }),
              )
              .filter((row): row is React.ReactNode => Boolean(row));
            if (renderedRows.length === 0 && !section.title) return null;
            return (
              <Box
                key={`section-${section.title ?? section.rows.map(getRowText).join("\n")}`}
                flexDirection="column"
              >
                {section.title ? (
                  <Text color={theme.muted} bold>
                    {fitText(section.title, innerWidth)}
                  </Text>
                ) : null}
                {renderedRows}
              </Box>
            );
          })}
        </Box>
      ) : null}
      {expandedDetailsText ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color={theme.muted}>
            {fitText(language === "en-US" ? "— details —" : "— 详情 —", innerWidth)}
          </Text>
          {expandedDetailsText.split("\n").map((line, idx) => (
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

function getSelectableRows(panel: CommandPanelView): Exclude<CommandPanelRow, string>[] {
  return (panel.sections ?? [])
    .flatMap((section) => section.rows)
    .filter(
      (row): row is Exclude<CommandPanelRow, string> =>
        typeof row !== "string" && row.selectable !== false && Boolean(row.taskRef),
    );
}

function getRowText(row: CommandPanelRow): string {
  return typeof row === "string" ? row : row.text;
}

function renderCommandPanelRow({
  row,
  cursor,
  scrollOffset,
  selectableRows,
  selectableCount,
  innerWidth,
  theme,
}: {
  row: CommandPanelRow;
  cursor: number;
  scrollOffset: number;
  selectableRows: Exclude<CommandPanelRow, string>[];
  selectableCount: number;
  innerWidth: number;
  theme: ReturnType<typeof createShellTheme>;
}): React.ReactNode {
  const selectableIndex =
    typeof row === "string" || row.selectable === false || !row.taskRef
      ? -1
      : selectableRows.indexOf(row);
  if (selectableIndex >= 0 && selectableCount > MAX_SELECTABLE_ROWS) {
    if (selectableIndex < scrollOffset || selectableIndex >= scrollOffset + MAX_SELECTABLE_ROWS) {
      return null;
    }
  }
  const text = getRowText(row);
  const isSelectable = selectableIndex >= 0;
  const selected = isSelectable && selectableIndex === cursor;
  const prefix = isSelectable ? (selected ? "> " : "  ") : "";
  return (
    <Text key={`row-${selectableIndex}-${text}`} color={selected ? theme.accent : undefined}>
      {fitText(`${prefix}${text}`, innerWidth)}
    </Text>
  );
}
