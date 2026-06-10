import { Box, Text } from "@linghun/ink-runtime";
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
        const completed = row.status === "completed";
        const blocked = row.status === "blocked";
        const inProgress = row.status === "in_progress";
        const marker = taskMarker(row.status, noColor);
        const dimmed = completed || blocked;
        const hasBlockers = blocked && row.blockedBy && row.blockedBy.length > 0;
        const blockedByLabel = language === "en-US" ? "blocked by" : "被阻塞";
        return (
          <Box key={row.id} flexDirection="column">
            {/* Row 1: marker + subject + owner + blockedBy */}
            <Box flexDirection="row">
              <Text
                color={inProgress ? theme.status.running : undefined}
                bold={inProgress}
                strikethrough={completed}
                dimColor={dimmed}
              >
                {marker} {fitText(row.subject, Math.max(8, innerWidth - 4 - (row.owner ? row.owner.length + 3 : 0)))}
              </Text>
              {row.owner ? (
                <Text color={theme.muted} dimColor>
                  {" "}(@{row.owner})
                </Text>
              ) : null}
              {hasBlockers ? (
                <Text color={theme.muted} dimColor>
                  {" "}▸ {blockedByLabel} {row.blockedBy!.map((id) => `#${id}`).join(", ")}
                </Text>
              ) : null}
            </Box>
            {/* Row 2: activity summary (in_progress + not blocked + has activity) */}
            {inProgress && !blocked && row.activity ? (
              <Box paddingLeft={2}>
                <Text color={theme.muted} dimColor>
                  {fitText(`${row.activity}…`, Math.max(8, innerWidth - 4))}
                </Text>
              </Box>
            ) : null}
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
  if (status === "completed") return getStatusMarker("pass", noColor);
  if (status === "in_progress") return "■";
  return "□";
}
