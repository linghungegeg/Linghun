import { Box, Text } from "@linghun/ink-runtime";
import type { Language } from "@linghun/shared";
import type React from "react";
import { fitText } from "../text-utils.js";
import { createShellTheme } from "../theme.js";

/**
 * SessionsPanel — D.13Q-UX Closure + Phase 8 enhancement
 *
 * Phase 8 adds:
 * - Search input (via Composer dispatch / key → search mode)
 * - Time grouping headers (Today / Yesterday / Older)
 * - Ctrl+V preview mode (first 10 messages metadata)
 *
 * Search/text input flows through Composer → index.ts events, not local useInput.
 */

const HINT_TEXT = {
  "zh-CN": {
    title: "/sessions",
    nav: "↑↓ 选择 · Enter 恢复 · Esc 关闭 · / 搜索 · Ctrl+V 预览",
    empty: "（暂无可恢复的会话）",
    noMatch: "（无匹配结果）",
    current: "[当前]",
    currentDisabled: "[当前 · 不可恢复]",
    today: "今天",
    yesterday: "昨天",
    older: "更早",
    search: "搜索：",
    previewTitle: "预览 · Ctrl+V",
    previewNav: "Esc 返回 · Enter 恢复",
  },
  "en-US": {
    title: "/sessions",
    nav: "↑↓ select · Enter resume · Esc close · / search · Ctrl+V preview",
    empty: "(no sessions to resume)",
    noMatch: "(no matches)",
    current: "[current]",
    currentDisabled: "[current · cannot resume]",
    today: "Today",
    yesterday: "Yesterday",
    older: "Older",
    search: "Search: ",
    previewTitle: "Preview · Ctrl+V",
    previewNav: "Esc back · Enter resume",
  },
} as const;

type PanelEntry = {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
  isCurrent: boolean;
};

export function SessionsPanel({
  panel,
  controller: _controller,
  width,
  noColor,
  language,
}: {
  panel: {
    cursor: number;
    entries: PanelEntry[];
    mode?: "search" | "preview";
    searchQuery?: string;
    previewEntryId?: string;
  };
  controller: unknown;
  width: number;
  noColor: boolean;
  language: Language;
}): React.ReactNode {
  const theme = createShellTheme(noColor);
  const hint = HINT_TEXT[language] ?? HINT_TEXT["zh-CN"];
  const cardWidth = Math.min(width, 84);
  const innerWidth = Math.max(20, cardWidth - 4);

  // ─── Time grouping ──────────────────────────────────────────────────
  const getTimeGroup = (iso: string): "today" | "yesterday" | "older" => {
    try {
      const ms = new Date(iso).getTime();
      if (Number.isNaN(ms)) return "older";
      const now = new Date();
      const startOfDay = (d: Date) =>
        new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const dayDiff = Math.round((startOfDay(now) - startOfDay(new Date(ms))) / 86_400_000);
      if (dayDiff <= 0) return "today";
      if (dayDiff === 1) return "yesterday";
      return "older";
    } catch {
      return "older";
    }
  };

  const groupLabel = (g: "today" | "yesterday" | "older"): string => {
    if (g === "today") return hint.today;
    if (g === "yesterday") return hint.yesterday;
    return hint.older;
  };

  // ─── Search filtering ───────────────────────────────────────────────
  const query = panel.searchQuery?.trim() ?? "";
  const filtered = query
    ? panel.entries.filter(
        (e) =>
          e.title.toLowerCase().includes(query.toLowerCase()) ||
          e.id.toLowerCase().includes(query.toLowerCase()),
      )
    : panel.entries;

  // ─── Preview mode ───────────────────────────────────────────────────
  if (panel.mode === "preview") {
    const entry = panel.previewEntryId
      ? panel.entries.find((e) => e.id === panel.previewEntryId)
      : undefined;
    if (!entry) {
      return (
        <Box flexDirection="column" paddingX={1} marginTop={1} width={cardWidth}>
          <Text color={theme.dim ?? theme.muted} dimColor>
            {"─".repeat(Math.min(cardWidth, 80))}
          </Text>
          <Text color={theme.dim ?? theme.muted} dimColor>
            {fitText(hint.noMatch, innerWidth)}
          </Text>
        </Box>
      );
    }
    const ts = formatSessionTime(entry.updatedAt, language);
    return (
      <Box flexDirection="column" paddingX={1} marginTop={1} width={cardWidth}>
        <Text color={theme.dim ?? theme.muted} dimColor>
          {"─".repeat(Math.min(cardWidth, 80))}
        </Text>
        <Text bold color={theme.accent}>
          {fitText(`${hint.previewTitle}: ${entry.title}`, innerWidth)}
        </Text>
        <Text dimColor color={theme.muted}>
          {fitText(
            `${ts} · ${entry.messageCount} ${language === "en-US" ? "msgs" : "条"} · ${entry.id.slice(0, 10)}`,
            innerWidth,
          )}
        </Text>
        <Box marginTop={1}>
          <Text dimColor color={theme.muted}>
            {fitText(hint.previewNav, innerWidth)}
          </Text>
        </Box>
      </Box>
    );
  }

  // ─── Search bar ─────────────────────────────────────────────────────
  const searchActive = panel.mode === "search";

  // ─── Render entry rows ──────────────────────────────────────────────
  const renderEntry = (entry: PanelEntry, idx: number) => {
    const active = idx === panel.cursor;
    const currentMark = entry.isCurrent ? ` ${hint.currentDisabled}` : "";
    const titleLine = `${active ? "▸ " : "  "}${entry.title}${currentMark}`;
    const ts = formatSessionTime(entry.updatedAt, language);
    const metaLine = `   ${ts} · ${entry.messageCount} ${language === "en-US" ? "msgs" : "条"}`;
    return (
      <Box key={entry.id} flexDirection="column">
        <Text
          color={entry.isCurrent ? (theme.dim ?? theme.muted) : active ? theme.accent : undefined}
          bold={active && !entry.isCurrent}
          dimColor={entry.isCurrent}
        >
          {fitText(titleLine, innerWidth)}
        </Text>
        <Text color={theme.dim ?? theme.muted} dimColor>
          {fitText(metaLine, innerWidth)}
        </Text>
      </Box>
    );
  };

  // ─── Entry list with time group headers ─────────────────────────────
  const renderList = () => {
    if (filtered.length === 0) {
      return (
        <Text color={theme.dim ?? theme.muted} dimColor>
          {fitText(query ? hint.noMatch : hint.empty, innerWidth)}
        </Text>
      );
    }
    let lastGroup = "";
    return filtered.map((entry, idx) => {
      const group = getTimeGroup(entry.updatedAt);
      const showHeader = group !== lastGroup;
      lastGroup = group;
      return (
        <Box key={entry.id} flexDirection="column">
          {showHeader ? (
            <Box marginTop={1}>
              <Text bold color={theme.muted}>
                {groupLabel(group)}
              </Text>
            </Box>
          ) : null}
          {renderEntry(entry, idx)}
        </Box>
      );
    });
  };

  return (
    <Box flexDirection="column" paddingX={1} marginTop={1} width={cardWidth}>
      <Text color={theme.dim ?? theme.muted} dimColor>
        {"─".repeat(Math.min(cardWidth, 80))}
      </Text>
      <Text color={theme.accent} bold>
        {fitText(hint.title, innerWidth)}
      </Text>
      {/* Search bar */}
      {searchActive ? (
        <Box flexDirection="row">
          <Text dimColor color={theme.muted}>
            {hint.search}
          </Text>
          <Text>{fitText(query, Math.max(8, innerWidth - hint.search.length - 1))}</Text>
          <Text dimColor>█</Text>
        </Box>
      ) : (
        <Text color={theme.dim ?? theme.muted} dimColor>
          {fitText(
            filtered.length < panel.entries.length
              ? `${hint.nav} · 过滤后 ${filtered.length}/${panel.entries.length}`
              : hint.nav,
            innerWidth,
          )}
        </Text>
      )}
      {renderList()}
    </Box>
  );
}

function formatSessionTime(iso: string, language: Language): string {
  try {
    const t = new Date(iso).getTime();
    const ms = Date.now() - t;
    const min = Math.floor(ms / 60000);
    if (min < 1) return language === "en-US" ? "now" : "刚刚";
    if (min < 60) return language === "en-US" ? `${min}m ago` : `${min} 分钟前`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return language === "en-US" ? `${hr}h ago` : `${hr} 小时前`;
    const day = Math.floor(hr / 24);
    return language === "en-US" ? `${day}d ago` : `${day} 天前`;
  } catch {
    return iso;
  }
}
