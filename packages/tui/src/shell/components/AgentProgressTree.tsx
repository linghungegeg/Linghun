import { Box, Text } from "ink";
import type React from "react";
import { messages } from "../../tui-messages.js";
import { fitText } from "../text-utils.js";
import { createShellTheme } from "../theme.js";
import type { AgentProgressTreeView } from "../types.js";

export function AgentProgressTree({
  tree,
  width,
  noColor,
  language,
}: {
  tree: AgentProgressTreeView;
  width: number;
  noColor: boolean;
  language: "zh-CN" | "en-US";
}): React.ReactNode {
  if (tree.rows.length === 0) return null;
  const theme = createShellTheme(noColor);
  const innerWidth = Math.max(20, width - 2);
  const text = messages[language];
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={theme.muted} bold>
        {text.r3AgentsTitle}
      </Text>
      {tree.rows.map((row) => {
        const branch = row.branch === "last" ? "└─" : "├─";
        const tokens = row.tokens > 0 ? ` · ${row.tokens} ${text.r3TokensLabel}` : "";
        const tools = row.toolUses > 0 ? ` · ${text.r3ToolsLabel} ${row.toolUses}` : "";
        const activity = row.activity ? ` · ${row.activity}` : "";
        return (
          <Text key={row.id} color={row.status === "blocked" ? theme.status.blocked : undefined}>
            {fitText(`${branch} ${row.name} · ${row.status}${tools}${tokens}${activity}`, innerWidth)}
          </Text>
        );
      })}
      {tree.hiddenPending > 0 ? (
        <Text color={theme.muted} dimColor>
          {`…+${tree.hiddenPending} ${text.r3PendingHiddenSuffix}`}
        </Text>
      ) : null}
    </Box>
  );
}
