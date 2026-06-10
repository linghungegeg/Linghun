import { Box, Text } from "@linghun/ink-runtime";
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
  const narrow = innerWidth < 60;
  const text = messages[language];
  return (
    <Box flexDirection="column" marginTop={1}>
      {tree.rows.map((row) => {
        const branch = row.branch === "last" ? "└─" : "├─";
        const name = narrow ? "" : ` ${row.name}`;
        const activity = row.activity ? ` ${row.activity}` : "";
        const line = `${branch}${name}${activity}`;
        return (
          <Text key={row.id} color={row.status === "blocked" ? theme.status.blocked : theme.muted}>
            {fitText(line, innerWidth)}
          </Text>
        );
      })}
      {tree.hiddenPending > 0 ? (
        <Text color={theme.muted} dimColor>
          {`  +${tree.hiddenPending} ${text.r3PendingHiddenSuffix} · Shift+↓`}
        </Text>
      ) : null}
    </Box>
  );
}
