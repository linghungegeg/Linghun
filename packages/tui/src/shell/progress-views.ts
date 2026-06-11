import type { TodoItem } from "@linghun/tools";
import type { TuiContext } from "../tui-context-runtime.js";
import type { AgentRun, BackgroundTaskState, WorkflowRunState, WorkflowStepState } from "../tui-data-types.js";
import { messages } from "../tui-messages.js";
import type {
  AgentProgressTreeView,
  BackgroundTaskOverlayView,
  BackgroundTaskSummary,
  TaskListView,
  WorkflowProgressView,
} from "./types.js";

const MAX_LIST_ITEMS = 8;
const MAX_DETAIL_LINES = 12;
/** Agent eviction delay: completed agents stay visible for 5s (CCB evictAfter pattern). */
const AGENT_EVICTION_DELAY_MS = 5_000;
/** Workflow eviction delay: completed/failed workflows stay visible for 8s then auto-dismiss. */
const WORKFLOW_EVICTION_DELAY_MS = 8_000;

/**
 * Summarize repetitive activities (e.g. "Read × 5, Glob × 3") instead of
 * showing each one individually. CCB-style activity condensation.
 */
function summarizeActivity(agents: AgentRun[]): string | undefined {
  const activities: string[] = [];
  for (const a of agents) {
    if (a.status !== "running") continue;
    const summary = a.activitySummary ?? a.activeTask?.summary;
    if (summary) activities.push(summary);
  }
  if (activities.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const act of activities) {
    const base = act.replace(/\s+\d+.*$/, "").replace(/…$/, "").trim();
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  const parts: string[] = [];
  for (const [base, count] of counts) {
    parts.push(count > 1 ? `${base} ×${count}` : base);
  }
  return parts.slice(0, 3).join(", ");
}

export function buildAgentProgressTreeView(context: TuiContext): AgentProgressTreeView | undefined {
  const allAgents = context.agents ?? [];
  const now = Date.now();
  let completedMap = context.agentCompletedAt;

  // Track completion timestamps on first discovery (auto-record).
  for (const agent of allAgents) {
    if (agent.status === "completed" && (!completedMap || !completedMap[agent.id])) {
      if (!completedMap) {
        context.agentCompletedAt = {};
        completedMap = context.agentCompletedAt;
      }
      completedMap[agent.id] = now;
    }
  }

  // Eviction: recently completed agents stay visible for AGENT_EVICTION_DELAY_MS.
  const recentlyCompleted = allAgents.filter(
    (a) =>
      a.status === "completed" &&
      completedMap?.[a.id] !== undefined &&
      now - completedMap[a.id] < AGENT_EVICTION_DELAY_MS,
  );

  const running = allAgents.filter((a) => a.status === "running");
  const visible = [...running, ...recentlyCompleted];
  if (visible.length === 0) return undefined;

  const cursor = context.agentTreeState?.cursor ?? -1;
  const state = context.agentTreeState;
  return {
    rows: visible.map((agent, index) => ({
      id: agent.id,
      branch: index === visible.length - 1 ? "last" : "middle",
      name: agent.displayName ?? agent.addressableName ?? agent.id,
      status: agent.status,
      activity: agent.activitySummary ?? agent.activeTask?.summary ?? agent.lastResultSummary,
      toolUses: agent.mailbox.length,
      tokens: 0,
    })),
    hiddenPending: 0,
    activitySummary: summarizeActivity(allAgents),
    cursor,
    expandedId: state?.expandedId,
  };
}

export function buildTaskListView(context: TuiContext): TaskListView | undefined {
  const todos = smartSlice(context.tools?.todos ?? [], MAX_LIST_ITEMS, (todo) => todo.status === "in_progress");
  if (todos.visible.length === 0) return undefined;
  return {
    rows: todos.visible.map((todo) => ({
      id: todo.id,
      subject: todo.content,
      status: todo.status,
      owner: readOptionalString(todo, "owner"),
      blockedBy: readBlockedBy(todo),
      activity: readOptionalString(todo, "evidence"),
    })),
    hiddenPending: todos.hiddenPending,
  };
}

export function buildWorkflowProgressView(context: TuiContext): WorkflowProgressView | undefined {
  if (!context.workflows) return undefined;
  const activeRuns = [
    ...(context.workflows.activeRuns ?? []),
    ...(context.workflows.activeRun ? [context.workflows.activeRun] : []),
  ];
  const runs = dedupeById(activeRuns).filter((run) => run.steps.length > 0);

  // Track completion timestamps on first discovery.
  const now = Date.now();
  let completedMap = context.workflowCompletedAt;
  for (const run of runs) {
    if (
      (run.status === "completed" || run.status === "failed" || run.status === "cancelled") &&
      (!completedMap || !completedMap[run.id])
    ) {
      if (!completedMap) {
        context.workflowCompletedAt = {};
        completedMap = context.workflowCompletedAt;
      }
      completedMap[run.id] = now;
    }
  }

  // Eviction: recently completed workflows stay visible for WORKFLOW_EVICTION_DELAY_MS.
  const visible = runs.filter((run) => {
    if (run.status === "running" || run.status === "blocked" || run.status === "stale") return true;
    if (!completedMap?.[run.id]) return true;
    return now - completedMap[run.id] < WORKFLOW_EVICTION_DELAY_MS;
  });

  const sliced = smartSlice(visible, 3, isActiveWorkflow);
  if (sliced.visible.length === 0) return undefined;
  return {
    runs: sliced.visible.map((run) => {
      const current = selectCurrentStep(run);
      return {
        id: run.id,
        goal: run.goal,
        status: run.status,
        currentStepId: current?.id,
        steps: smartSlice(run.steps, MAX_LIST_ITEMS, (step) => step.status === "running").visible.map(
          (step) => ({
            id: step.id,
            title: step.title,
            status: step.status,
            active: step.id === current?.id,
          }),
        ),
      };
    }),
    hiddenPending: sliced.hiddenPending,
  };
}

export function buildBackgroundTaskOverlayView(
  context: TuiContext,
  summaries: BackgroundTaskSummary[],
): BackgroundTaskOverlayView | undefined {
  const state = context.backgroundOverlayState;
  if (!state?.open) return undefined;
  const active = (context.backgroundTasks ?? []).filter((task) => !context.dismissedBackgroundTaskIds?.has(task.id));
  const rows = smartSlice(active, 20, isActiveBackground).visible.map((task) => ({
    id: task.id,
    kind: task.kind,
    title: task.title,
    status: task.status,
    currentStep: task.currentStep,
    progress: task.progress,
    detailsText: formatBackgroundOverlayDetails(task, messages[context.language]),
  }));
  const cursor = Math.max(0, Math.min(state.cursor ?? 0, Math.max(0, rows.length - 1)));
  const text = messages[context.language];
  return {
    title: text.r3BackgroundTitle,
    hint: text.r3BackgroundHint,
    rows,
    cursor,
    summary: formatOverlaySummary(context, active, summaries),
  };
}

export function updateBackgroundOverlayCursor(context: TuiContext, delta: -1 | 1): void {
  const count = (context.backgroundTasks ?? []).filter((task) => !context.dismissedBackgroundTaskIds?.has(task.id)).length;
  const current = context.backgroundOverlayState?.cursor ?? 0;
  context.backgroundOverlayState = {
    open: true,
    cursor: count > 0 ? Math.max(0, Math.min(current + delta, count - 1)) : 0,
  };
}

export function getBackgroundOverlaySelectedTask(context: TuiContext): BackgroundTaskState | undefined {
  const rows = (context.backgroundTasks ?? []).filter((task) => !context.dismissedBackgroundTaskIds?.has(task.id));
  const cursor = Math.max(0, Math.min(context.backgroundOverlayState?.cursor ?? 0, Math.max(0, rows.length - 1)));
  return rows[cursor];
}

function isActiveWorkflow(run: WorkflowRunState): boolean {
  return run.status === "running" || run.status === "blocked" || run.status === "stale";
}

function isActiveBackground(task: BackgroundTaskState): boolean {
  return task.status === "running" || task.status === "blocked" || task.status === "stale";
}

function selectCurrentStep(run: WorkflowRunState): WorkflowStepState | undefined {
  return (
    run.steps.find((step) => step.status === "running") ??
    run.steps.find((step) => step.status === "blocked" || step.status === "failed") ??
    run.steps.find((step) => step.status === "queued") ??
    run.steps.at(-1)
  );
}

function smartSlice<T>(items: T[], max: number, priority: (item: T) => boolean): { visible: T[]; hiddenPending: number } {
  if (items.length <= max) return { visible: items, hiddenPending: 0 };
  const priorityItems = items.filter(priority);
  const recent = items.slice(-max);
  const visible = dedupeByIdentity([...priorityItems, ...recent]).slice(0, max);
  return { visible, hiddenPending: Math.max(0, items.length - visible.length) };
}

function dedupeByIdentity<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }
  return result;
}

function readOptionalString(todo: TodoItem, key: string): string | undefined {
  const value = (todo as unknown as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readBlockedBy(todo: TodoItem): string[] | undefined {
  const value = (todo as unknown as Record<string, unknown>).blockedBy;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
}

function formatOverlaySummary(
  context: TuiContext,
  tasks: BackgroundTaskState[],
  summaries: BackgroundTaskSummary[],
): string {
  const running = tasks.filter((task) => task.status === "running").length;
  const blocked = tasks.filter((task) => task.status === "blocked" || task.status === "stale").length;
  const completed = tasks.filter((task) => task.status === "completed").length;
  const text = messages[context.language];
  return `${text.r3BackgroundRunning} ${running} · ${text.r3BackgroundBlocked} ${blocked} · ${text.r3BackgroundCompleted} ${completed} · ${text.r3BackgroundVisible} ${summaries.length}`;
}

function formatBackgroundOverlayDetails(
  task: BackgroundTaskState,
  text: (typeof messages)["zh-CN"],
): string {
  return [
    `${task.kind} ${task.id}`,
    `- ${text.r3OverlayStatus}: ${task.status}`,
    `- ${text.r3OverlayStep}: ${task.currentStep ?? "-"}`,
    `- ${text.r3OverlayProgress}: ${task.progress ? `${task.progress.completed}/${task.progress.total ?? "?"}` : "-"}`,
    `- ${text.r3OverlayResult}: ${task.result ?? "-"}`,
    `- ${text.r3OverlayNext}: ${task.nextAction ?? "-"}`,
    `- ${text.r3OverlayLog}: ${task.logPath ?? "-"}`,
  ]
    .slice(0, MAX_DETAIL_LINES)
    .join("\n");
}
