import { Box, Text } from "@linghun/ink-runtime";
import type React from "react";
import { messages } from "../../tui-messages.js";
import { fitText } from "../text-utils.js";
import { createShellTheme, getStatusMarker } from "../theme.js";
import type {
  AgentProgressTreeView,
  WorkflowProgressView as WorkflowProgressViewModel,
} from "../types.js";

export function WorkflowProgressView({
  workflow,
  agents,
  width,
  noColor,
  language,
}: {
  workflow: WorkflowProgressViewModel;
  agents?: AgentProgressTreeView;
  width: number;
  noColor: boolean;
  language: "zh-CN" | "en-US";
}): React.ReactNode {
  if (workflow.runs.length === 0) return null;
  const theme = createShellTheme(noColor);
  const innerWidth = Math.max(20, width - 2);
  const text = messages[language];
  const workLabel = language === "en-US" ? "working" : "工作";
  const workflowIds = new Set(workflow.runs.map((run) => run.id));
  const unboundAgents = agents?.rows.filter(
    (row) => !row.workflowRunId || !workflowIds.has(row.workflowRunId),
  );
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={theme.dim ?? theme.muted} dimColor>
        {text.r3WorkflowsTitle}
      </Text>
      {workflow.runs.map((run) => {
        const isCompleted = run.status === "completed" || run.status === "cancelled";
        const progress = `${run.completedSteps}/${run.totalSteps}`;
        // Completed/cancelled workflows collapse to a single summary line
        if (isCompleted) {
          const completedText = `✓ ${run.goal}${run.modeLabel ? ` · ${run.modeLabel}` : ""} · ${progress} completed${run.elapsed ? ` · ${run.elapsed}` : ""}`;
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
                `${run.goal}${run.modeLabel ? ` · ${run.modeLabel}` : ""} · ${run.status} · ${progress}${run.elapsed ? ` · ${workLabel} ${run.elapsed}` : ""}`,
                innerWidth,
              )}
            </Text>
            {run.steps.map((step, index) => {
              const branch = index === run.steps.length - 1 ? "└─" : "├─";
              const marker = workflowMarker(step.status, noColor);
              return (
                <Text key={step.id} color={theme.dim ?? theme.muted} dimColor={!step.active}>
                  {fitText(
                    `${branch} ${marker} ${step.title}${workflowStepRelation(step, language)}`,
                    innerWidth,
                  )}
                </Text>
              );
            })}
            <NestedAgentRows
              rows={agents?.rows.filter((row) => row.workflowRunId === run.id) ?? []}
              tree={agents}
              innerWidth={innerWidth}
              language={language}
              noColor={noColor}
            />
            {run.hiddenSteps && run.hiddenSteps > 0 ? (
              <Text color={theme.muted} dimColor>
                {fitText(`… +${run.hiddenSteps} ${text.r3PendingHiddenSuffix}`, innerWidth)}
              </Text>
            ) : null}
          </Box>
        );
      })}
      <NestedAgentRows
        rows={unboundAgents ?? []}
        tree={agents}
        innerWidth={innerWidth}
        language={language}
        noColor={noColor}
      />
      {agents && agents.hiddenPending > 0 ? (
        <Text color={theme.muted} dimColor>
          {fitText(`… +${agents.hiddenPending} ${text.r3PendingHiddenSuffix}`, innerWidth)}
        </Text>
      ) : null}
      {agents && agents.rows.length > 0 ? (
        <Text color={theme.muted} dimColor>
          {fitText(
            language === "en-US"
              ? "↑↓ agents · Enter details · x stop · Esc cancel"
              : "↑↓ Agent · Enter 详情 · x 停止 · Esc 取消",
            innerWidth,
          )}
        </Text>
      ) : null}
      {workflow.hiddenPending > 0 ? (
        <Text color={theme.muted} dimColor>
          {`…+${workflow.hiddenPending} ${text.r3PendingHiddenSuffix}`}
        </Text>
      ) : null}
    </Box>
  );
}

function NestedAgentRows({
  rows,
  tree,
  innerWidth,
  language,
  noColor,
}: {
  rows: AgentProgressTreeView["rows"];
  tree: AgentProgressTreeView | undefined;
  innerWidth: number;
  language: "zh-CN" | "en-US";
  noColor: boolean;
}): React.ReactNode {
  if (!tree || rows.length === 0) return null;
  const theme = createShellTheme(noColor);
  return rows.map((row) => {
    const selected = tree.cursor === tree.rows.findIndex((item) => item.id === row.id);
    const marker = workflowMarker(row.status, noColor);
    const label = `${selected ? "▶" : "↳"} ${marker} Agent ${row.name}${row.modeLabel ? ` · ${row.modeLabel}` : ""} · ${row.status}${row.activity ? `: ${row.activity}` : ""}`;
    return (
      <Box key={row.id} flexDirection="column">
        <Text color={selected ? theme.accent : (theme.dim ?? theme.muted)} dimColor={!selected}>
          {fitText(label, innerWidth)}
        </Text>
        {tree.expandedId === row.id ? (
          <Text color={theme.muted} dimColor>
            {fitText(
              `${language === "en-US" ? "mailbox" : "消息"} ${row.mailboxPending ?? 0}/${row.mailboxMessages} · tokens ${row.tokens}${row.parentSessionId ? ` · parent ${shortId(row.parentSessionId)}` : ""}${row.forkedFrom ? ` · fork ${shortId(row.forkedFrom)}` : ""}`,
              innerWidth,
            )}
          </Text>
        ) : null}
      </Box>
    );
  });
}

function workflowStepRelation(
  step: WorkflowProgressViewModel["runs"][number]["steps"][number],
  language: "zh-CN" | "en-US",
): string {
  const parts: string[] = [];
  if (step.canRunInParallel) {
    parts.push(`${language === "en-US" ? "parallel" : "并行"}:${step.batchId ?? "-"}`);
  }
  if (step.dependsOnSliceIds && step.dependsOnSliceIds.length > 0) {
    parts.push(
      `${language === "en-US" ? "after" : "依赖"}:${step.dependsOnSliceIds.join(",")}`,
    );
  }
  return parts.length > 0 ? ` · ${parts.join(" · ")}` : "";
}

function shortId(value: string): string {
  return value.length > 12 ? `…${value.slice(-8)}` : value;
}

function workflowMarker(status: string, noColor: boolean): string {
  if (status === "completed") return getStatusMarker("pass", noColor);
  if (status === "failed" || status === "blocked") return getStatusMarker("fail", noColor);
  if (status === "stale") return "~";
  if (status === "running") return "■";
  return "□";
}
