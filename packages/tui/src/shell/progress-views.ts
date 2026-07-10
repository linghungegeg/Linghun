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

const MAX_AGENT_ROWS = 6;
const MAX_WORKFLOW_STEPS = 5;
const MAX_DETAIL_LINES = 12;
/** Agent eviction delay: completed agents stay visible briefly (3s) then auto-dismiss. */
const AGENT_EVICTION_DELAY_MS = 3_000;
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
    if (
      agent.status === "idle" &&
      agent.lastTerminalStatus === "completed" &&
      (!completedMap || !completedMap[agent.id])
    ) {
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
      a.status === "idle" &&
      a.lastTerminalStatus === "completed" &&
      completedMap?.[a.id] !== undefined &&
      now - completedMap[a.id] < AGENT_EVICTION_DELAY_MS,
  );

  const active = allAgents.filter((agent) => isVisibleAgentStatus(resolveAgentStatus(agent)));
  const agents = dedupeById([...active, ...recentlyCompleted]);
  if (agents.length === 0) return undefined;
  const visible = smartSlice(agents, MAX_AGENT_ROWS, (agent) =>
    isVisibleAgentStatus(resolveAgentStatus(agent)),
  );

  const cursor = context.agentTreeState?.cursor ?? -1;
  const state = context.agentTreeState;
  return {
    rows: visible.visible.map((agent, index) => {
      const background = context.backgroundTasks.find(
        (task) => task.kind === "agent" && task.id === agent.id,
      );
      return {
        id: agent.id,
        branch: index === visible.visible.length - 1 ? "last" : "middle",
        name: agent.displayName ?? agent.addressableName ?? agent.id,
        status: resolveAgentStatus(agent),
        modeLabel: formatAgentModeLabel(agent, context.language),
        workflowRunId: background?.workflowRunId,
        parentSessionId: agent.parentSessionId,
        forkedFrom: agent.forkedFrom,
        contextMode: agent.contextMode,
        activity: agent.activitySummary ?? agent.activeTask?.summary ?? agent.lastResultSummary,
        elapsed:
          typeof agent.startedAt === "string" ? formatElapsedSince(agent.startedAt, now) : undefined,
        mailboxMessages: agent.mailbox.length,
        mailboxPending: agent.mailbox.filter((message) => message.status === "pending").length,
        tokens: (agent.cost?.inputTokens ?? 0) + (agent.cost?.outputTokens ?? 0),
      };
    }),
    hiddenPending: visible.hiddenPending,
    activitySummary: summarizeActivity(allAgents),
    cursor,
    expandedId: state?.expandedId,
  };
}

export function buildTaskListView(context: TuiContext): TaskListView | undefined {
  const allTodos = context.tools?.todos ?? [];
  const activeTodos = allTodos.filter(isActiveTodo);
  if (activeTodos.length === 0) return undefined;
  const currentTodo = selectCurrentTodo(activeTodos);
  if (!currentTodo) return undefined;
  const currentIndex = allTodos.findIndex((todo) => todo.id === currentTodo.id);
  return {
    rows: [
      {
        id: currentTodo.id,
        subject: currentTodo.content,
        status: currentTodo.status,
        owner: readOptionalString(currentTodo, "owner"),
        blockedBy: readBlockedBy(currentTodo),
        activity: readOptionalString(currentTodo, "evidence"),
      },
    ],
    hiddenPending: Math.max(0, activeTodos.length - 1),
    totalCount: allTodos.length,
    currentIndex: currentIndex >= 0 ? currentIndex + 1 : 1,
    completedCount: allTodos.filter((todo) => todo.status === "completed").length,
  };
}

function isActiveTodo(todo: TodoItem): boolean {
  return todo.status === "in_progress" || todo.status === "blocked" || todo.status === "pending";
}

function selectCurrentTodo(todos: TodoItem[]): TodoItem | undefined {
  return todos.find(isFocusedTodo) ?? todos[0];
}

function isFocusedTodo(todo: TodoItem): boolean {
  return todo.status === "in_progress" || todo.status === "blocked";
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
      const steps = smartSlice(run.steps, MAX_WORKFLOW_STEPS, (step) => step.status === "running");
      return {
        id: run.id,
        goal: run.goal,
        status: run.status,
        modeLabel: run.multiAgent ? "multi-agent" : undefined,
        completedSteps: run.steps.filter((step) => step.status === "completed").length,
        totalSteps: run.steps.length,
        elapsed: typeof run.startedAt === "string" ? formatElapsedSince(run.startedAt, now) : undefined,
        currentStepId: current?.id,
        steps: steps.visible.map((step) => ({
          id: step.id,
          title: step.title,
          status: step.status,
          active: step.id === current?.id,
          dependsOnSliceIds: step.dependsOnSliceIds,
          batchId: step.batchId,
          canRunInParallel: step.canRunInParallel,
        })),
        hiddenSteps: steps.hiddenPending,
      };
    }),
    hiddenPending: sliced.hiddenPending,
  };
}

function formatAgentModeLabel(
  agent: AgentRun,
  language: TuiContext["language"],
): string | undefined {
  const labels: string[] = [];
  if (agent.teamName) labels.push(`team:${agent.teamName}`);
  if (agent.contextMode === "full_fork") {
    labels.push(language === "en-US" ? "full context" : "完整上下文");
  } else if (agent.contextMode === "handoff") {
    labels.push(language === "en-US" ? "handoff summary" : "交接摘要");
  }
  return labels.length > 0 ? labels.join(" · ") : undefined;
}

function resolveAgentStatus(agent: AgentRun): string {
  if (agent.status === "idle" && agent.lastTerminalStatus) return agent.lastTerminalStatus;
  return agent.status;
}

function isVisibleAgentStatus(status: string): boolean {
  return status === "running" || status === "blocked" || status === "failed" || status === "stale";
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

function formatElapsedSince(startedAt: string, nowMs: number): string {
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return "0s";
  const seconds = Math.max(0, Math.floor((nowMs - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return `${minutes}m${rest.toString().padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${(minutes % 60).toString().padStart(2, "0")}m`;
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
