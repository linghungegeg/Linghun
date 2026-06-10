import { Box, Text } from "@linghun/ink-runtime";
import type React from "react";
import { createShellTheme } from "../theme.js";

export type ShortcutEntry = {
  keys: string;
  description: string;
  category: "editing" | "navigation" | "panels" | "system";
};

export type ShortcutPanelProps = {
  shortcuts: ShortcutEntry[];
  language: "zh-CN" | "en-US";
  width: number;
  noColor?: boolean;
};

const CATEGORY_ORDER: ShortcutEntry["category"][] = [
  "editing",
  "navigation",
  "panels",
  "system",
];

const CATEGORY_LABELS: Record<ShortcutEntry["category"], { "zh-CN": string; "en-US": string }> = {
  editing: { "zh-CN": "编辑", "en-US": "Editing" },
  navigation: { "zh-CN": "导航", "en-US": "Navigation" },
  panels: { "zh-CN": "面板", "en-US": "Panels" },
  system: { "zh-CN": "系统", "en-US": "System" },
};

const TITLE: Record<"zh-CN" | "en-US", string> = {
  "zh-CN": "快捷键",
  "en-US": "Shortcuts",
};

const CLOSE_HINT: Record<"zh-CN" | "en-US", string> = {
  "zh-CN": "按任意键关闭",
  "en-US": "Press any key to close",
};

const KEYS_COL_WIDTH = 14;

export function ShortcutPanel(props: ShortcutPanelProps): React.ReactNode {
  const { shortcuts, language, width, noColor } = props;
  const theme = createShellTheme(noColor ?? false);
  const lang = language === "en-US" ? "en-US" : "zh-CN";

  const grouped = new Map<ShortcutEntry["category"], ShortcutEntry[]>();
  for (const entry of shortcuts) {
    const list = grouped.get(entry.category);
    if (list) {
      list.push(entry);
    } else {
      grouped.set(entry.category, [entry]);
    }
  }

  const cardWidth = Math.min(width, 60);

  return (
    <Box flexDirection="column" paddingX={1} marginTop={1} width={cardWidth}>
      <Text bold>{TITLE[lang]}</Text>
      <Text>{""}</Text>
      {CATEGORY_ORDER.filter((cat) => grouped.has(cat)).map((cat) => (
        <Box key={cat} flexDirection="column" marginBottom={1}>
          <Text dimColor color={theme.muted}>
            {CATEGORY_LABELS[cat][lang]}
          </Text>
          {grouped.get(cat)!.map((entry) => (
            <Text key={entry.keys}>
              {"  "}
              <Text bold color={theme.accent ?? "cyan"}>
                {entry.keys.padEnd(KEYS_COL_WIDTH)}
              </Text>
              <Text>{entry.description}</Text>
            </Text>
          ))}
        </Box>
      ))}
      <Text dimColor color={theme.muted}>
        {CLOSE_HINT[lang]}
      </Text>
    </Box>
  );
}
