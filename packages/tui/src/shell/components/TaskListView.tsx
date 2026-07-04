import { Box, Text } from "@linghun/ink-runtime";
import type React from "react";
import { messages } from "../../tui-messages.js";
import { fitText } from "../text-utils.js";
import { createShellTheme } from "../theme.js";
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
        const blocked = row.status === "blocked";
        const inProgress = row.status === "in_progress";
        const marker = taskMarker(row.status, noColor);
        const hasBlockers = blocked && row.blockedBy && row.blockedBy.length > 0;
        const blockedByLabel = language === "en-US" ? "blocked by" : "被阻塞";
        const ownerText = row.owner ? ` (@${row.owner})` : "";
        const blockerText = hasBlockers
          ? ` ▸ ${blockedByLabel} ${row.blockedBy!.map((id) => `#${id}`).join(", ")}`
          : "";
        const activityText = inProgress && !blocked && row.activity ? ` · ${row.activity}…` : "";
        const rowText = `${marker} ${row.subject}${ownerText}${blockerText}${activityText}`;
        return (
          <Box key={row.id}>
            <Text
              color={inProgress ? theme.status.running : undefined}
              bold={inProgress}
              dimColor={blocked}
            >
              {fitText(rowText, innerWidth)}
            </Text>
          </Box>
        );
      })}
      {list.hiddenPending > 0 ? (
        <Text color={theme.muted} dimColor>
          {`… +${list.hiddenPending} ${text.r3PendingHiddenSuffix}`}
        </Text>
      ) : null}
    </Box>
  );
}

function taskMarker(status: string, noColor: boolean): string {
  if (status === "in_progress") return "■";
  return "□";
}
