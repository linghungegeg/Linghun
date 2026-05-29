import type { Language } from "@linghun/shared";
import { Box, Text, useInput } from "ink";
import type React from "react";
import { fitText } from "../text-utils.js";
import { createShellTheme } from "../theme.js";
import type { ShellController } from "../types.js";

/**
 * SessionsPanel — D.13Q-UX Closure
 *
 * 真 picker 面板替换 /sessions / /resume 的逐行 writeLine 路径。CCB resume.tsx 范式：
 * - panel border + 标题 /sessions
 * - 列表每行：title (≤columns-4 截断) + 第二行 dim metadata（updatedAt + msgCount + current 标记）
 * - 当前 session 用图标 + 颜色高亮（不可恢复）
 * - 键位：↑↓ 选择，Enter 恢复，Esc 关闭
 * - 空集渲染单行 dim 占位
 * - **不在 picker 内 dump full transcript**：选中后只回传 id，
 *   由 resumeSessionWithHandoff 走 structured handoff
 *
 * 自带 useInput；与 Composer 互斥。
 */

const HINT_TEXT = {
  "zh-CN": {
    title: "/sessions",
    nav: "↑↓ 选择 · Enter 恢复 · Esc 关闭",
    empty: "（暂无可恢复的会话）",
    current: "[当前]",
    currentDisabled: "[当前 · 不可恢复]",
  },
  "en-US": {
    title: "/sessions",
    nav: "↑↓ select · Enter resume · Esc close",
    empty: "(no sessions to resume)",
    current: "[current]",
    currentDisabled: "[current · cannot resume]",
  },
} as const;

export function SessionsPanel({
  panel,
  controller,
  width,
  noColor,
  language,
}: {
  panel: {
    cursor: number;
    entries: {
      id: string;
      title: string;
      updatedAt: string;
      messageCount: number;
      isCurrent: boolean;
    }[];
  };
  controller: ShellController;
  width: number;
  noColor: boolean;
  language: Language;
}): React.ReactNode {
  const theme = createShellTheme(noColor);
  const hint = HINT_TEXT[language] ?? HINT_TEXT["zh-CN"];

  useInput((_input, key) => {
    if (key.escape) {
      void controller.onInput({ type: "sessions-close" });
      return;
    }
    if (key.return) {
      void controller.onInput({ type: "sessions-resume" });
      return;
    }
    if (key.upArrow) {
      void controller.onInput({ type: "sessions-move", delta: -1 });
      return;
    }
    if (key.downArrow) {
      void controller.onInput({ type: "sessions-move", delta: 1 });
      return;
    }
  });

  const cardWidth = Math.min(width, 84);
  const innerWidth = Math.max(20, cardWidth - 4);

  const formatRelativeTime = (iso: string): string => {
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
  };

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={theme.panel ?? theme.border}
      paddingX={1}
      marginTop={1}
      width={cardWidth}
    >
      <Text color={theme.accent} bold>
        {fitText(hint.title, innerWidth)}
      </Text>
      <Text color={theme.dim ?? theme.muted} dimColor>
        {fitText(hint.nav, innerWidth)}
      </Text>
      {panel.entries.length === 0 ? (
        <Text color={theme.dim ?? theme.muted} dimColor>
          {fitText(hint.empty, innerWidth)}
        </Text>
      ) : (
        panel.entries.map((entry, idx) => {
          const active = idx === panel.cursor;
          // D.13Q-UX Closure: 当前 session 不可恢复（resume 自身没有意义）。
          // 即便 cursor 落在当前 session 上，也用 dim + "不可恢复" 标识，
          // Enter 由 index.ts sessions-resume 拦截，不 dispatch /resume。
          const currentMark = entry.isCurrent
            ? ` ${hint.currentDisabled}`
            : "";
          const titleLine = `${active ? "▸ " : "  "}${entry.title}${currentMark}`;
          const metaLine = `   ${formatRelativeTime(entry.updatedAt)} · ${entry.messageCount} ${language === "en-US" ? "msgs" : "条"} · ${entry.id.slice(0, 8)}`;
          return (
            <Box key={entry.id} flexDirection="column">
              <Text
                color={
                  entry.isCurrent
                    ? theme.dim ?? theme.muted
                    : active
                      ? theme.accent
                      : undefined
                }
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
        })
      )}
    </Box>
  );
}
