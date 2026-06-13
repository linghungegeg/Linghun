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
  const workLabel = language === "en-US" ? "working" : "工作";
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={theme.dim ?? theme.muted} dimColor>
        {text.r3WorkflowsTitle}
      </Text>
      {workflow.runs.map((run) => {
        const isCompleted = run.status === "completed" || run.status === "cancelled";
        // Completed/cancelled workflows collapse to a single summary line
        if (isCompleted) {
          const completedText = `✓ ${run.goal} completed${run.elapsed ? ` · ${run.elapsed}` : ""}`;
          return (
            <Text key={run.id} color={theme.muted} dimColor>
              {fitText(completedText, innerWidth)}
            </Text>
          );
        }
        return (
          <Box key={run.id} flexDirection="column">
            <Text color={theme.dim ?? theme.muted} dimColor>
              {fitText(
                `${run.goal} · ${run.status}${run.elapsed ? ` · ${workLabel} ${run.elapsed}` : ""}`,
                innerWidth,
              )}
            </Text>
            {run.steps.map((step, index) => {
              const branch = index === run.steps.length - 1 ? "└─" : "├─";
              const marker = workflowMarker(step.status, noColor);
              return (
                <Text key={step.id} color={theme.dim ?? theme.muted} dimColor={!step.active}>
                  {fitText(`${branch} ${marker} ${step.title}`, innerWidth)}
                </Text>
              );
            })}
          </Box>
        );
      })}
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
