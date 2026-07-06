import { Box, Text } from "@linghun/ink-runtime";
import type React from "react";
import { messages } from "../../tui-messages.js";
import { fitText } from "../text-utils.js";
import { createShellTheme } from "../theme.js";
import type { TaskListView as TaskListViewModel } from "../types.js";

const PROGRESS_BAR_WIDTH = 5;

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
  const current = list.rows[0];
  const blocked = current.status === "blocked";
  const inProgress = current.status === "in_progress";
  const color = blocked ? theme.status.blocked : inProgress ? theme.accent : theme.muted;
  const title = text.r3TasksTitle;
  const progress = `${progressBar(list.currentIndex, list.totalCount, noColor)} ${list.currentIndex}/${list.totalCount}`;
  const currentLabel = language === "en-US" ? "Current" : "当前";
  const ownerText = current.owner ? ` @${current.owner}` : "";
  const blockedByText = blockedBySummary(current.blockedBy, language);
  const activityText = inProgress && current.activity ? ` · ${current.activity}` : "";
  const overflowText = list.hiddenPending > 0 ? ` · +${list.hiddenPending}` : "";
  const statusText = taskStatusLabel(current.status, language);
  const rowText = `${title}：${progress} · ${currentLabel}：${current.subject}${ownerText}${blockedByText}${activityText} · ${statusText}${overflowText}`;

  return (
    <Box marginTop={1}>
      <Text color={color} bold={inProgress && theme.mode !== "no-color"} dimColor={!inProgress && !blocked}>
        {fitText(rowText, innerWidth)}
      </Text>
    </Box>
  );
}

function progressBar(currentIndex: number, totalCount: number, noColor: boolean): string {
  const total = Math.max(1, totalCount);
  const current = Math.max(1, Math.min(currentIndex, total));
  const filled = Math.max(1, Math.min(PROGRESS_BAR_WIDTH, Math.ceil((current / total) * PROGRESS_BAR_WIDTH)));
  const empty = PROGRESS_BAR_WIDTH - filled;
  return noColor ? `[${"#".repeat(filled)}${"-".repeat(empty)}]` : `[${"█".repeat(filled)}${"░".repeat(empty)}]`;
}

function blockedBySummary(blockedBy: string[] | undefined, language: "zh-CN" | "en-US"): string {
  if (!blockedBy || blockedBy.length === 0) return "";
  const label = language === "en-US" ? "blocked by" : "被阻塞";
  return ` · ${label} ${blockedBy.map((id) => `#${id}`).join(", ")}`;
}

function taskStatusLabel(status: string, language: "zh-CN" | "en-US"): string {
  if (status === "blocked") return language === "en-US" ? "blocked" : "阻塞";
  if (status === "in_progress") return language === "en-US" ? "running" : "运行中";
  if (status === "completed") return language === "en-US" ? "completed" : "已完成";
  return language === "en-US" ? "queued" : "等待中";
}
