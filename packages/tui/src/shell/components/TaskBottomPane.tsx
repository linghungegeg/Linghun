import { Box, Text } from "@linghun/ink-runtime";
import type React from "react";
import {
  taskBottomPaneBudget,
  taskBottomPaneMode,
  type TaskBottomPaneMode,
} from "../native-scrollback-frame.js";
import type { TerminalCapability } from "../terminal-capability.js";
import { fitText, taskComposerMaxWidth } from "../text-utils.js";
import type { ShellTheme } from "../theme.js";
import type { BottomPaneStatusView, ShellController, ShellViewModel } from "../types.js";
import { AgentProgressTree } from "./AgentProgressTree.js";
import { BackgroundTaskOverlay } from "./BackgroundTaskOverlay.js";
import { Composer, type ComposerLayout } from "./Composer.js";
import { NotificationStack } from "./NotificationStack.js";
import { ProductBlock } from "./ProductBlock.js";
import { StatusFooter } from "./StatusFooter.js";
import { TaskListView } from "./TaskListView.js";
import { WorkflowProgressView } from "./WorkflowProgressView.js";

const COMPOSER_BORDER_ROWS = 2;
const COMPOSER_TOP_PADDING_ROWS = 1;
const FULL_COMPOSER_VISIBLE_LINES = 5;
const COMPACT_COMPOSER_VISIBLE_LINES = 1;
const FULL_FOOTER_ROWS = 2;
const COMPACT_FOOTER_ROWS = 1;
const WORKING_ROWS = 1;
const TASK_LIST_TOP_GAP_ROWS = 1;
const TASK_STATUS_GAP_ROWS = 1;
const FULL_SLASH_ROWS = 9;
const COMPACT_SLASH_ROWS = 7;

export type BottomPaneSlotEstimates = {
  slashRows?: number;
  workingRows?: number;
  backgroundOverlayRows?: number;
  notificationRows?: number;
  runtimeSummaryRows?: number;
  taskListRows?: number;
  agentProgressRows?: number;
  workflowProgressRows?: number;
};

export type BottomPaneBudgetAllocation = {
  mode: TaskBottomPaneMode;
  maxRows: number;
  composerMaxVisibleLines: number;
  slashMaxRows: number;
  footerRows: number;
  workingRows: number;
  showBackgroundOverlay: boolean;
  showNotifications: boolean;
  showRuntimeSummary: boolean;
  showTaskList: boolean;
  showAgentProgress: boolean;
  showWorkflowProgress: boolean;
};

export function allocateBottomPaneBudget(
  frameHeight: number,
  slotEstimates: BottomPaneSlotEstimates = {},
): BottomPaneBudgetAllocation {
  const mode = taskBottomPaneMode(frameHeight);
  const maxRows = taskBottomPaneBudget(frameHeight);
  let composerMaxVisibleLines =
    mode === "full" ? FULL_COMPOSER_VISIBLE_LINES : COMPACT_COMPOSER_VISIBLE_LINES;
  let footerRows =
    mode === "full"
      ? FULL_FOOTER_ROWS
      : mode === "compact" ||
          maxRows >= COMPOSER_BORDER_ROWS + COMPACT_COMPOSER_VISIBLE_LINES + 1
        ? COMPACT_FOOTER_ROWS
        : 0;
  let workingRows =
    mode !== "minimal" && (slotEstimates.workingRows ?? 0) > 0 ? WORKING_ROWS : 0;
  const slashCap =
    mode === "full" ? FULL_SLASH_ROWS : mode === "compact" ? COMPACT_SLASH_ROWS : 0;
  let slashMaxRows = Math.min(Math.max(0, slotEstimates.slashRows ?? 0), slashCap);

  const composerRows = () =>
    COMPOSER_BORDER_ROWS +
    composerMaxVisibleLines +
    slashMaxRows +
    (mode === "full" ? COMPOSER_TOP_PADDING_ROWS : 0);
  const requiredRows = () => composerRows() + footerRows + workingRows;

  if (requiredRows() > maxRows && slashMaxRows > 0 && composerMaxVisibleLines > 1) {
    composerMaxVisibleLines = COMPACT_COMPOSER_VISIBLE_LINES;
  }
  while (requiredRows() > maxRows && slashMaxRows > 0) slashMaxRows -= 1;
  while (
    requiredRows() > maxRows &&
    composerMaxVisibleLines > COMPACT_COMPOSER_VISIBLE_LINES
  ) {
    composerMaxVisibleLines -= 1;
  }
  if (requiredRows() > maxRows && footerRows > 0) footerRows = 0;
  if (requiredRows() > maxRows && workingRows > 0) workingRows = 0;

  let remainingRows = Math.max(0, maxRows - requiredRows());
  const take = (rows: number | undefined): boolean => {
    const need = Math.max(0, rows ?? 0);
    if (need === 0 || need > remainingRows) return false;
    remainingRows -= need;
    return true;
  };

  const showAgentProgress = take(slotEstimates.agentProgressRows);
  const showWorkflowProgress = take(slotEstimates.workflowProgressRows);
  const showBackgroundOverlay = take(slotEstimates.backgroundOverlayRows);
  const showTaskList = take(slotEstimates.taskListRows);
  const showRuntimeSummary = take(slotEstimates.runtimeSummaryRows);
  const showNotifications = take(slotEstimates.notificationRows);

  return {
    mode,
    maxRows,
    composerMaxVisibleLines,
    slashMaxRows,
    footerRows,
    workingRows,
    showBackgroundOverlay,
    showNotifications,
    showRuntimeSummary,
    showTaskList,
    showAgentProgress,
    showWorkflowProgress,
  };
}

export function TaskBottomPane({
  view,
  controller,
  capability,
  frameHeight,
  contentWidth,
  noColor,
  theme,
}: {
  view: ShellViewModel;
  controller: ShellController;
  capability: TerminalCapability;
  frameHeight: number;
  contentWidth: number;
  noColor: boolean;
  theme: ShellTheme;
}): React.ReactNode {
  const cw = taskComposerMaxWidth(view.width);
  const bottomPaneStatus = view.bottomPaneStatus ?? legacyStatusFromActivity(view.activity);
  const statusActive = isBottomPaneStatusVisible(bottomPaneStatus);
  const slashRows = Math.max(0, Math.floor(view.composerOverlayRows ?? 0));
  const slotEstimates: BottomPaneSlotEstimates = {
    workingRows: statusActive ? WORKING_ROWS : 0,
    backgroundOverlayRows: view.backgroundTaskOverlay && !view.permission ? 2 : 0,
    notificationRows: (view.notifications?.length ?? 0) > 0 ? 1 : 0,
    runtimeSummaryRows: view.taskRuntimeSummary ? 2 : 0,
    taskListRows: estimateTaskListRows(view.taskListView, statusActive),
    agentProgressRows: view.agentProgressTree ? 2 : 0,
    workflowProgressRows: view.workflowProgressView ? 2 : 0,
  };
  const allocation = allocateBottomPaneBudget(frameHeight, {
    ...slotEstimates,
    slashRows: slashRows > 0 ? FULL_SLASH_ROWS : 0,
  });
  const bootstrapSlashRows =
    allocation.mode === "full"
      ? FULL_SLASH_ROWS
      : allocation.mode === "compact"
        ? COMPACT_SLASH_ROWS
        : 0;
  const slashMaxRows = slashRows > 0 ? allocation.slashMaxRows : bootstrapSlashRows;

  return (
    <Box flexShrink={0} flexDirection="column">
      {allocation.showAgentProgress && view.agentProgressTree ? (
        <Box width={view.width} paddingX={2}>
          <AgentProgressTree
            tree={view.agentProgressTree}
            width={contentWidth}
            noColor={noColor}
            language={view.language}
          />
        </Box>
      ) : null}

      {allocation.showWorkflowProgress && view.workflowProgressView ? (
        <Box width={view.width} paddingX={2}>
          <WorkflowProgressView
            workflow={view.workflowProgressView}
            width={contentWidth}
            noColor={noColor}
            language={view.language}
          />
        </Box>
      ) : null}

      {allocation.showBackgroundOverlay && view.backgroundTaskOverlay && !view.permission ? (
        <BackgroundTaskOverlay
          overlay={view.backgroundTaskOverlay}
          width={contentWidth}
          noColor={noColor}
        />
      ) : null}

      {allocation.showTaskList && view.taskListView ? (
        <Box paddingX={2} marginBottom={statusActive ? TASK_STATUS_GAP_ROWS : 0}>
          <TaskListView
            list={view.taskListView}
            width={contentWidth}
            noColor={noColor}
            language={view.language}
          />
        </Box>
      ) : null}

      {allocation.showRuntimeSummary && view.taskRuntimeSummary ? (
        <Box width={cw} marginTop={1}>
          <ProductBlock
            block={view.taskRuntimeSummary}
            theme={theme}
            width={cw}
            language={view.language}
            capability={capability}
          />
        </Box>
      ) : null}

      {allocation.showNotifications ? (
        <NotificationStack notifications={view.notifications} theme={theme} />
      ) : null}

      {allocation.workingRows > 0 && bottomPaneStatus ? (
        <WorkingStatusLine
          status={bottomPaneStatus}
          width={contentWidth}
          noColor={noColor}
          theme={theme}
          mode={allocation.mode}
        />
      ) : null}

      <Box flexDirection="column" width={cw} paddingTop={allocation.mode === "full" ? 1 : 0}>
        <Composer
          view={view}
          onInput={controller.onInput}
          capability={capability}
          layout={taskComposerLayout(view.width)}
          composerMaxVisibleLines={allocation.composerMaxVisibleLines}
          slashMaxRows={slashMaxRows}
        />
      </Box>

      {view.taskFooter && allocation.footerRows > 0 ? (
        allocation.mode === "full" && allocation.footerRows >= FULL_FOOTER_ROWS ? (
          <StatusFooter
            footer={view.taskFooter}
            theme={theme}
            width={view.width}
            language={view.language}
            modelDim={view.taskFooter.modelDim}
            cacheTone={view.taskFooter.cacheTone}
          />
        ) : (
          <CompactStatusFooter footer={view.taskFooter} width={view.width} />
        )
      ) : null}
    </Box>
  );
}

function isBottomPaneStatusVisible(status: ShellViewModel["bottomPaneStatus"]): boolean {
  return Boolean(status);
}

function estimateTaskListRows(
  taskListView: ShellViewModel["taskListView"],
  hasFollowingStatus = false,
): number {
  if (!taskListView || taskListView.rows.length === 0) return 0;
  return 1 + TASK_LIST_TOP_GAP_ROWS + (hasFollowingStatus ? TASK_STATUS_GAP_ROWS : 0);
}

function legacyStatusFromActivity(
  activity: ShellViewModel["activity"],
): BottomPaneStatusView | undefined {
  if (!activity) return undefined;
  if (activity.phase === "completed") {
    return { kind: "completed_partial", source: "request", text: activity.text, elapsed: activity.elapsed };
  }
  if (activity.phase === "error") {
    return { kind: "failed", source: activity.toolName ? "tool" : "provider", text: activity.text };
  }
  if (activity.phase === "permission_waiting") {
    return {
      kind: "action_required",
      source: "permission",
      text: activity.text,
      elapsed: activity.elapsed,
    };
  }
  return {
    kind: "running",
    source: activity.phase === "tool_running" ? "tool" : "request",
    text: activity.thinkingLabel || activity.text,
    reason:
      activity.phase === "tool_running" && activity.toolName
        ? `${activity.toolName}${activity.toolTarget ? `(${activity.toolTarget})` : ""}`
        : undefined,
    elapsed: activity.elapsed,
  };
}

function WorkingStatusLine({
  status,
  width,
  noColor,
  theme,
  mode,
}: {
  status: BottomPaneStatusView;
  width: number;
  noColor: boolean;
  theme: ShellTheme;
  mode: TaskBottomPaneMode;
}): React.ReactNode {
  const colorMap: Record<BottomPaneStatusView["kind"], string | undefined> = {
    running: theme.status.running,
    action_required: theme.status.blocked,
    verifying: theme.status.info,
    blocked: theme.status.blocked,
    failed: theme.status.fail,
    completed_partial: theme.status.partial,
  };
  const color =
    status.source === "tool" ? (theme.toolRunning ?? colorMap[status.kind]) : colorMap[status.kind];
  const marker = noColor ? "*" : statusMarker(status.kind);
  const reason = status.reason && mode === "full" ? ` · ${status.reason}` : "";
  const next = status.nextAction && mode === "full" ? ` · ${status.nextAction}` : "";
  const elapsed = status.elapsed ? ` · ${status.elapsed}` : "";
  const text = `${marker} ${status.text}${reason}${next}${elapsed}`;
  return (
    <Box paddingX={2} width={width + 4}>
      <Text color={color} bold={status.kind === "running" && theme.mode !== "no-color"}>
        {fitText(text, width)}
      </Text>
    </Box>
  );
}

function statusMarker(kind: BottomPaneStatusView["kind"]): string {
  if (kind === "action_required") return "!";
  if (kind === "blocked") return "!";
  if (kind === "failed") return "x";
  if (kind === "verifying") return "~";
  if (kind === "completed_partial") return "·";
  return "●";
}

function CompactStatusFooter({
  footer,
  width,
}: {
  footer: NonNullable<ShellViewModel["taskFooter"]>;
  width: number;
}): React.ReactNode {
  const model = fitText(footer.model, Math.max(12, Math.min(28, Math.floor(width / 3))));
  const text = `${footer.permissionMode}${footer.cyclePermHint} · ${model} · ${footer.index} · ${footer.cache}`;
  const fitted = fitText(text, Math.max(8, width - 4));
  const modeText = fitted.startsWith(footer.permissionMode) ? footer.permissionMode : fitted;
  const rest = fitted.startsWith(footer.permissionMode) ? fitted.slice(footer.permissionMode.length) : "";
  return (
    <Box paddingX={2} width={width}>
      <Text>
        <Text color={footer.permissionModeColor || undefined}>{modeText}</Text>
        {rest ? <Text>{rest}</Text> : null}
      </Text>
    </Box>
  );
}

function taskComposerLayout(viewWidth: number): ComposerLayout {
  return {
    width: taskComposerMaxWidth(viewWidth),
    paddingLeft: 2,
    paddingRight: 2,
    prefixWidth: 2,
    minContentWidth: 4,
  };
}
