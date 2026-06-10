import { Box, Text } from "@linghun/ink-runtime";
import type React from "react";
import { messages } from "../../tui-messages.js";
import { fitText } from "../text-utils.js";
import { createShellTheme, getStatusMarker } from "../theme.js";
import type { WorkflowProgressView as WorkflowProgressViewModel } from "../types.js";

export function WorkflowProgressView({
  workflow,
  width,
  noColor,
  language,
}: {
  workflow: WorkflowProgressViewModel;
  width: number;
  noColor: boolean;
  language: "zh-CN" | "en-US";
}): React.ReactNode {
  if (workflow.runs.length === 0) return null;
  const theme = createShellTheme(noColor);
  const innerWidth = Math.max(20, width - 2);
  const text = messages[language];
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={theme.muted} bold>
        {text.r3WorkflowsTitle}
      </Text>
      {workflow.runs.map((run) => (
        <Box key={run.id} flexDirection="column">
          <Text color={run.status === "blocked" ? theme.status.blocked : theme.accent}>
            {fitText(`${run.goal} · ${run.status}`, innerWidth)}
          </Text>
          {run.steps.map((step, index) => {
            const branch = index === run.steps.length - 1 ? "└─" : "├─";
            const marker = workflowMarker(step.status, noColor);
            return (
              <Text key={step.id} color={step.active ? theme.status.running : theme.muted}>
                {fitText(`${branch} ${marker} ${step.title}`, innerWidth)}
              </Text>
            );
          })}
        </Box>
      ))}
      {workflow.hiddenPending > 0 ? (
        <Text color={theme.muted} dimColor>
          {`…+${workflow.hiddenPending} ${text.r3PendingHiddenSuffix}`}
        </Text>
      ) : null}
    </Box>
  );
}

function workflowMarker(status: string, noColor: boolean): string {
  if (status === "completed") return getStatusMarker("pass", noColor);
  if (status === "failed" || status === "blocked") return getStatusMarker("fail", noColor);
  if (status === "running") return "■";
  return "□";
}
