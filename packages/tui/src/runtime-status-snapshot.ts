import type { Language } from "@linghun/shared";
import { formatElapsedSince } from "./job-runner-presenter.js";
import type { BackgroundTaskState, WorkflowState } from "./tui-data-types.js";

export type RuntimeRequestActivity =
  | "idle"
  | "thinking"
  | "tool_running"
  | "permission_waiting"
  | "completed"
  | "error";

export type RuntimeStatusSnapshotInput = {
  language: Language;
  requestActivityPhase?: string;
  requestActivityStartedAt?: number;
  requestActivityToolName?: string;
  pendingApproval?: boolean;
  workflow?: WorkflowState["activeRun"];
  backgroundTasks: BackgroundTaskState[];
  lastVerification?: { status: string; summary: string; endedAt: string };
  lastModelRequest?: { phase: string; toolName?: string; endedAt: string };
};

export type RuntimeTaskSnapshot = {
  kind: "workflow" | BackgroundTaskState["kind"] | "verification" | "model_request";
  id?: string;
  title: string;
  status: string;
  currentStep?: string;
  progress?: { completed: number; total?: number; label?: string };
  elapsed?: string;
  result?: string;
  nextAction?: string;
  endedAt?: string;
  summary?: string;
};

export type RuntimeStatusSnapshot = {
  requestActivity: RuntimeRequestActivity;
  pendingApproval: boolean;
  activeWorkflow?: RuntimeTaskSnapshot;
  activeAgents: RuntimeTaskSnapshot[];
  activeBackgroundTasks: RuntimeTaskSnapshot[];
  needsAttentionTasks: RuntimeTaskSnapshot[];
  staleResumableTasks: RuntimeTaskSnapshot[];
  recentTerminalTasks: RuntimeTaskSnapshot[];
};

export function createRuntimeStatusSnapshot(
  input: RuntimeStatusSnapshotInput,
): RuntimeStatusSnapshot {
  const requestActivity = mapRequestActivity(input.requestActivityPhase, input.pendingApproval);
  const activeWorkflow =
    input.workflow && isActiveWorkflowStatus(input.workflow.status)
      ? mapWorkflow(input.workflow, input.language)
      : undefined;
  const activeTasks = input.backgroundTasks.filter((task) => task.status === "running");
  const needsAttentionTasks = input.backgroundTasks.filter(
    (task) => task.status === "paused" || task.status === "blocked",
  );
  const staleTasks = input.backgroundTasks.filter((task) => task.status === "stale");
  const terminalTasks = input.backgroundTasks
    .filter((task) => isTerminalBackgroundStatus(task.status))
    .sort((a, b) => compareIsoDesc(a.updatedAt, b.updatedAt))
    .slice(0, 3)
    .map((task) => mapBackgroundTask(task, input.language, false));

  const recentTerminalTasks = [...terminalTasks];
  if (input.lastVerification) {
    recentTerminalTasks.push({
      kind: "verification",
      title: "verification",
      status: input.lastVerification.status,
      summary: input.lastVerification.summary,
      endedAt: input.lastVerification.endedAt,
    });
  }
  if (input.lastModelRequest) {
    recentTerminalTasks.push({
      kind: "model_request",
      title: "model request",
      status: input.lastModelRequest.phase,
      currentStep: input.lastModelRequest.toolName,
      endedAt: input.lastModelRequest.endedAt,
    });
  }
  recentTerminalTasks.sort((a, b) => compareIsoDesc(a.endedAt, b.endedAt));

  return {
    requestActivity,
    pendingApproval: Boolean(input.pendingApproval),
    activeWorkflow,
    activeAgents: activeTasks
      .filter((task) => task.kind === "agent")
      .map((task) => mapBackgroundTask(task, input.language, true)),
    activeBackgroundTasks: activeTasks
      .filter((task) => task.kind !== "agent")
      .map((task) => mapBackgroundTask(task, input.language, true)),
    needsAttentionTasks: needsAttentionTasks.map((task) =>
      mapBackgroundTask(task, input.language, true),
    ),
    staleResumableTasks: staleTasks.map((task) => mapBackgroundTask(task, input.language, true)),
    recentTerminalTasks: recentTerminalTasks.slice(0, 3),
  };
}

export function formatRuntimeStatusSnapshotForBtw(
  snapshot: RuntimeStatusSnapshot,
  language: Language,
): string {
  const lines: string[] = [];
  if (snapshot.requestActivity !== "idle") {
    lines.push(formatRequestActivityLine(snapshot, language));
  }
  if (snapshot.activeWorkflow) {
    lines.push(formatTaskLine(language, "active", snapshot.activeWorkflow));
  }
  for (const task of [...snapshot.activeAgents, ...snapshot.activeBackgroundTasks]) {
    if (lines.length >= 3) break;
    lines.push(formatTaskLine(language, "active", task));
  }
  for (const task of snapshot.needsAttentionTasks) {
    if (lines.length >= 3) break;
    lines.push(formatTaskLine(language, "attention", task));
  }
  for (const task of snapshot.staleResumableTasks) {
    if (lines.length >= 3) break;
    lines.push(formatTaskLine(language, "resumable", task));
  }
  if (lines.length === 0) {
    lines.push(language === "en-US" ? "Current: no running task." : "当前：没有正在运行的任务。");
  }
  const recent = snapshot.recentTerminalTasks[0];
  if (recent && lines.length < 3) {
    const summary = recent.currentStep ?? recent.summary ?? recent.status;
    const status = recent.result ?? recent.status;
    lines.push(
      language === "en-US"
        ? `Recent: ${recent.title} ${formatStatus(status, language)} · ${truncate(summary, 80)}.`
        : `最近：${recent.title} ${formatStatus(status, language)} · ${truncate(summary, 80)}。`,
    );
  }
  return lines.join("\n");
}

function mapRequestActivity(
  phase: string | undefined,
  pendingApproval: boolean | undefined,
): RuntimeRequestActivity {
  if (pendingApproval) return "permission_waiting";
  if (!phase) return "idle";
  if (phase === "thinking" || phase === "tool_running" || phase === "permission_waiting") {
    return phase;
  }
  if (phase.includes("failed") || phase === "error") return "error";
  if (phase.includes("completed") || phase === "completed") return "completed";
  return "thinking";
}

function mapWorkflow(
  workflow: NonNullable<WorkflowState["activeRun"]>,
  language: Language,
): RuntimeTaskSnapshot {
  const runningStep = workflow.steps.find((step) => step.status === "running");
  const completed = workflow.steps.filter(
    (step) => step.status === "completed" || step.status === "partial",
  ).length;
  const currentStep =
    runningStep?.title ??
    workflow.steps.find((step) => step.status === "blocked")?.summary ??
    workflow.goal;
  return {
    kind: "workflow",
    id: workflow.id,
    title: "workflow",
    status: workflow.status,
    currentStep,
    progress: { completed, total: workflow.steps.length },
  };
}

function mapBackgroundTask(
  task: BackgroundTaskState,
  language: Language,
  includeElapsed: boolean,
): RuntimeTaskSnapshot {
  return {
    kind: task.kind,
    id: task.id,
    title: formatTaskKind(task.kind),
    status: task.status,
    currentStep: task.currentStep ?? task.userVisibleSummary,
    progress: task.progress,
    result: task.result,
    nextAction: task.nextAction,
    elapsed: includeElapsed ? formatElapsed(task.startedAt, language) : undefined,
    endedAt: task.updatedAt,
    summary: task.userVisibleSummary,
  };
}

function formatRequestActivityLine(snapshot: RuntimeStatusSnapshot, language: Language): string {
  if (snapshot.pendingApproval || snapshot.requestActivity === "permission_waiting") {
    return language === "en-US"
      ? "Current: waiting for your approval."
      : "当前：正在等待你的确认。";
  }
  const status = formatStatus(snapshot.requestActivity, language);
  return language === "en-US" ? `Current: model request ${status}.` : `当前：模型请求${status}。`;
}

function formatTaskLine(
  language: Language,
  mode: "active" | "attention" | "resumable",
  task: RuntimeTaskSnapshot,
): string {
  const label =
    mode === "active"
      ? language === "en-US"
        ? "Running"
        : "正在运行"
      : mode === "attention"
        ? language === "en-US"
          ? "Needs attention"
          : "需处理"
        : language === "en-US"
          ? "Resumable"
          : "可恢复";
  const progress = task.progress?.total
    ? ` · ${task.progress.label ? `${task.progress.label} ` : ""}${task.progress.completed}/${task.progress.total}`
    : "";
  const step = task.currentStep ? ` · ${truncate(task.currentStep, 80)}` : "";
  const elapsed = task.elapsed ? ` · ${task.elapsed}` : "";
  const action =
    mode === "resumable" && task.nextAction ? ` · ${truncate(task.nextAction, 60)}` : "";
  const separator = language === "en-US" ? ": " : "：";
  return `${label}${separator}${task.title} ${formatStatus(task.status, language)}${progress}${step}${elapsed}${action}`;
}

function isActiveWorkflowStatus(
  status: NonNullable<WorkflowState["activeRun"]>["status"],
): boolean {
  return status === "running" || status === "blocked";
}

function isTerminalBackgroundStatus(status: BackgroundTaskState["status"]): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled" || status === "timeout"
  );
}

function formatTaskKind(kind: RuntimeTaskSnapshot["kind"]): string {
  if (kind === "bash") return "background task";
  if (kind === "model_request") return "model request";
  return kind;
}

function formatStatus(status: string, language: Language): string {
  const zh: Record<string, string> = {
    running: "运行中",
    paused: "已暂停",
    completed: "已完成",
    pass: "通过",
    fail: "失败",
    failed: "失败",
    partial: "部分完成",
    blocked: "阻塞",
    cancelled: "已取消",
    timeout: "超时",
    stale: "可恢复",
    thinking: "思考中",
    tool_running: "工具运行中",
    permission_waiting: "等待确认",
    error: "失败",
  };
  return language === "en-US" ? status.replaceAll("_", " ") : (zh[status] ?? status);
}

function formatElapsed(startedAt: string, language: Language): string {
  const elapsed = formatElapsedSince(startedAt);
  return language === "en-US" ? `elapsed ${elapsed}` : `耗时 ${elapsed}`;
}

function truncate(value: string, max: number): string {
  const normalized = String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 1))}…`;
}

function compareIsoDesc(left: string | undefined, right: string | undefined): number {
  return safeTimeMs(right) - safeTimeMs(left);
}

function safeTimeMs(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
