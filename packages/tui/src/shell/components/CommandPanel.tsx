import type { Language } from "@linghun/shared";
import { Box, Text } from "@linghun/ink-runtime";
import type React from "react";
import { fitText, lineChar, wrapText } from "../text-utils.js";
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
  "zh-CN": "",
  "en-US": "",
} as const;

const SELECTABLE_HINT_TEXT = {
  "zh-CN": "Enter · x · Esc",
  "en-US": "Enter · x · Esc",
} as const;

const DETAILS_HINT_TEXT = {
  "zh-CN": "Ctrl+O 详情",
  "en-US": "Ctrl+O details",
} as const;

const MAX_SELECTABLE_ROWS = 8;
const MAX_PANEL_WIDTH = 108;

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
  const hasDetailsText = Boolean((selectedDetailsText ?? panel.detailsText ?? "").trim());
  const detailsHint = DETAILS_HINT_TEXT[language] ?? DETAILS_HINT_TEXT["zh-CN"];
  const renderedHint = [hint, hasDetailsText ? detailsHint : ""].filter(Boolean).join(" · ");
  const expandedDetailsText = panel.expanded
    ? (selectedDetailsText ?? panel.detailsText)
    : undefined;

  const availableWidth = Math.max(20, width - 2);
  const cardWidth = Math.min(availableWidth, MAX_PANEL_WIDTH);
  const innerWidth = Math.max(20, cardWidth - 4);
  const tone = panel.tone ?? "neutral";
  const borderColor =
    tone === "error"
      ? (theme.error ?? theme.status.fail)
      : tone === "warning"
        ? theme.warning
        : (theme.panel ?? theme.border);
  const rule = lineChar(noColor);
  const title = panel.title?.trim() ?? "";
  const titleLabel = formatPanelTitle(title);
  const titleMeta = title && titleLabel !== title ? title : "";
  const topRuleWidth = Math.max(8, innerWidth - titleLabel.length - 4);

  return (
    <Box flexDirection="column" paddingX={1} marginTop={1} width={cardWidth}>
      {title ? (
        <Box flexDirection="column">
          <Text color={borderColor} dimColor>
            {`${rule.repeat(2)} ${titleLabel} ${rule.repeat(topRuleWidth)}`}
          </Text>
          <Box>
            <Text color={theme.accent} bold>
              {fitText(`❯ ${titleLabel}`, Math.max(8, Math.floor(innerWidth * 0.45)))}
            </Text>
            {titleMeta ? (
              <Text color={theme.dim ?? theme.muted} dimColor>
                {fitText(`  ${titleMeta}`, Math.max(8, innerWidth - titleLabel.length - 2))}
              </Text>
            ) : null}
          </Box>
        </Box>
      ) : null}
      {panel.summary && panel.summary.length > 0 ? (
        <Box flexDirection="column" marginTop={title ? 1 : 0}>
          {panel.summary.map((line, idx) => (
            <Box key={`${idx}-${line}`} flexDirection="column">
              {renderSummaryLine(line, innerWidth).map(({ label, value }, lineIdx) => (
                <Box key={`${idx}-${lineIdx}-${label}-${value}`}>
                  {label ? (
                    <Text color={theme.dim ?? theme.muted}>{fitText(label, 16)}</Text>
                  ) : null}
                  <Text bold={Boolean(label)}>
                    {fitText(value, label ? innerWidth - 16 : innerWidth)}
                  </Text>
                </Box>
              ))}
            </Box>
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
                    {fitText(section.title.toUpperCase(), innerWidth)}
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
            <Box key={`detail-${idx}-${line}`} flexDirection="column">
              {wrapText(line, innerWidth).map((part, lineIdx) => (
                <Text key={`detail-${idx}-${lineIdx}-${part}`} color={theme.dim ?? theme.muted}>
                  {part}
                </Text>
              ))}
            </Box>
          ))}
        </Box>
      ) : null}
      {panel.actions && panel.actions.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          {panel.actions.map((action, idx) => (
            <Box key={`action-${idx}-${action}`} flexDirection="column">
              {wrapText(`→ ${action}`, innerWidth).map(
                (part, lineIdx) => (
                  <Text
                    key={`action-${idx}-${lineIdx}-${part}`}
                    color={lineIdx === 0 ? theme.accent : (theme.dim ?? theme.muted)}
                  >
                    {part}
                  </Text>
                ),
              )}
            </Box>
          ))}
        </Box>
      ) : null}
      {renderedHint ? (
        <Box marginTop={1}>
          <Text color={borderColor} dimColor>
            {rule.repeat(innerWidth)}
          </Text>
        </Box>
      ) : null}
      {renderedHint ? (
        <Text color={theme.dim ?? theme.muted} dimColor>
          {fitText(renderedHint, innerWidth)}
        </Text>
      ) : null}
    </Box>
  );
}

function formatPanelTitle(title: string): string {
  const normalized = title.replace(/^\/+/, "").replace(/\s+/gu, " ").trim();
  if (!normalized) return "";
  return normalized.split(" ")[0]?.toUpperCase() ?? normalized.toUpperCase();
}

function renderSummaryLine(
  line: string,
  innerWidth: number,
): Array<{ label: string; value: string }> {
  const colon = line.match(/^([^：:]{1,16})[：:]\s*(.+)$/u);
  if (colon?.[1] && colon[2]) {
    return wrapText(colon[2], Math.max(8, innerWidth - 16)).map((part, idx) => ({
      label: idx === 0 ? `${colon[1]} ` : "",
      value: part,
    }));
  }
  return wrapText(line, innerWidth).map((part) => ({ label: "", value: part }));
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
  const prefix = isSelectable ? (selected ? "▌ > " : "    ") : "";
  return (
    <Box key={`row-${selectableIndex}-${text}`} flexDirection="column" marginTop={selected ? 0 : 0}>
      {wrapText(`${prefix}${text}`, innerWidth).map((part, lineIdx) => (
        <Text
          key={`row-${selectableIndex}-${lineIdx}-${part}`}
          color={selected ? theme.accent : undefined}
          bold={selected}
        >
          {lineIdx === 0 ? part : `  ${fitText(part, Math.max(8, innerWidth - 2))}`}
        </Text>
      ))}
    </Box>
  );
}
