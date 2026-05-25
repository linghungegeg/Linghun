import type { Language } from "@linghun/shared";
import { Box, Text } from "ink";
import type React from "react";
import type { CommandCapability } from "../../natural-command-bridge.js";
import { fitText } from "../text-utils.js";
import type { ShellTheme } from "../theme.js";

/**
 * Inline slash command suggestion list, shown above the composer when the user
 * is typing a slash prefix (e.g. "/m"). Pure render — selection state and
 * keyboard handling live in the Composer.
 *
 * Rendering rules:
 *   - One row per candidate, prefixed with the slash and i18n title.
 *   - Selected row is rendered with an accent marker; others use muted color.
 *   - Truncation hint when more than 8 candidates exist (matches the dispatch
 *     helper's slice).
 */
export function SlashSuggestions({
  candidates,
  selectedIndex,
  theme,
  language,
  width,
  hint,
}: {
  candidates: CommandCapability[];
  selectedIndex: number;
  theme: ShellTheme;
  language: Language;
  width: number;
  hint?: string;
}): React.ReactNode {
  if (candidates.length === 0) return null;
  const safeIndex = Math.max(0, Math.min(selectedIndex, candidates.length - 1));
  return (
    <Box flexDirection="column" width={width}>
      {candidates.map((item, index) => {
        const title = language === "en-US" ? item.titleEn : item.titleZh;
        const isSelected = index === safeIndex;
        const marker = isSelected ? "›" : " ";
        const line = `${marker} ${item.slash} — ${title}`;
        return (
          <Text key={item.slash} color={isSelected ? theme.accent : theme.muted} bold={isSelected}>
            {fitText(line, Math.max(20, width - 2))}
          </Text>
        );
      })}
      {hint ? <Text color={theme.muted}>{fitText(hint, Math.max(20, width - 2))}</Text> : null}
    </Box>
  );
}
