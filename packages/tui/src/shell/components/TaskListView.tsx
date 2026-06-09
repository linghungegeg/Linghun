import { Box, Text } from "ink";
import type React from "react";
import { messages } from "../../tui-messages.js";
import { fitText } from "../text-utils.js";
import { createShellTheme, getStatusMarker } from "../theme.js";
import type { TaskListView as TaskListViewModel } from "../types.js";

export function TaskListView({
  list,
  width,
  noColor,
  language,
}: {
  list: TaskListViewModel;
  width: number;
  noColor: boolean;
  language: "zh-CN" | "en-US";
}): React.ReactNode {
  if (list.rows.length === 0) return null;
  const theme = createShellTheme(noColor);
  const innerWidth = Math.max(20, width - 2);
  const text = messages[language];
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={theme.muted} bold>
        {text.r3TasksTitle}
      </Text>
      {list.rows.map((row) => {
        const marker = taskMarker(row.status, noColor);
        const owner = row.owner ? ` · ${row.owner}` : "";
        const blocked = row.blockedBy && row.blockedBy.length > 0 ? ` · ${text.r3BlockedByLabel} ${row.blockedBy.join(",")}` : "";
        return (
          <Text key={row.id} color={row.status === "in_progress" ? theme.status.running : undefined}>
            {fitText(`${marker} ${row.subject}${owner}${blocked}`, innerWidth)}
          </Text>
        );
      })}
      {list.hiddenPending > 0 ? (
        <Text color={theme.muted} dimColor>
          {`…+${list.hiddenPending} ${text.r3PendingHiddenSuffix}`}
        </Text>
      ) : null}
    </Box>
  );
}

function taskMarker(status: string, noColor: boolean): string {
  if (status === "completed") return getStatusMarker("pass", noColor);
  if (status === "in_progress") return "■";
  return "□";
}
