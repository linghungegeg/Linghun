import { randomUUID } from "node:crypto";
import type { Writable } from "node:stream";
import type { ToolOutput } from "@linghun/tools";
import { getCommandPanelSelectableRows } from "./command-panel-runtime.js";
import { createSilentOutput, ensureSession, t, writeStatus } from "./details-status-runtime.js";
import { appendBackgroundTaskEvent } from "./evidence-runtime.js";
import {
  cancelAgentByRef,
  handleBackgroundCommand,
  handleJobCommand,
  transitionDurableJob,
} from "./job-agent-command-runtime.js";
import { formatBackgroundDetails } from "./job-runner-presenter.js";
import { formatBackgroundTask } from "./job-runner-presenter.js";
import { appendJobLog, rescheduleDurableJobAgents } from "./job-runtime.js";
import { clearRequestActivity } from "./model-stream-runtime.js";
import {
  type RunnerContext,
  type RunnerRuntimeDeps,
  refreshRunnerStatusForJob as refreshRunnerStatusForJobImpl,
  startRunnerForDurableJob as startRunnerForDurableJobImpl,
  stopRunnerForDurableJob as stopRunnerForDurableJobImpl,
} from "./runner-runtime.js";
import type { BackgroundTaskSummary } from "./shell/types.js";
import { writeLine } from "./startup-runtime.js";
import {
  abortBackgroundTask,
  clearBackgroundAbortController,
  findAgent,
  findBackgroundTask,
  getBackgroundAbortControllers,
  isActiveBackgroundStatus,
  isRuntimeActiveBackgroundTask,
  listCancellableAgents,
} from "./tui-agent-job-runtime.js";
import { createJobBackgroundTask, findDurableJob } from "./tui-agent-job-runtime.js";
import type { TuiContext } from "./tui-context-runtime.js";
import { BACKGROUND_KIND_CAPS, BACKGROUND_RUNNING_GLOBAL_CAP } from "./tui-context-runtime.js";
import type { BackgroundTaskState, DurableJobState } from "./tui-data-types.js";
import {
  createWorkflowInterruptBackgroundTask,
  finishWorkflowRun,
  upsertWorkflowBackgroundTask,
} from "./workflow-command-runtime.js";

// ---------------------------------------------------------------------------
// Runner runtime — thin wrappers delegating to runner-runtime.ts
// ---------------------------------------------------------------------------

function toRunnerContext(context: TuiContext): RunnerContext {
  return { config: context.config, projectPath: context.projectPath };
}

function getRunnerRuntimeDeps(): RunnerRuntimeDeps {
  return { appendJobLog, rescheduleDurableJobAgents };
}

export async function startRunnerForDurableJob(
  context: TuiContext,
  job: DurableJobState,
): Promise<void> {
  await startRunnerForDurableJobImpl(toRunnerContext(context), job, getRunnerRuntimeDeps());
}

export function refreshRunnerStatusForJob(context: TuiContext, job: DurableJobState): void {
  refreshRunnerStatusForJobImpl(toRunnerContext(context), job, getRunnerRuntimeDeps());
}

export async function stopRunnerForDurableJob(
  context: TuiContext,
  job: DurableJobState,
): Promise<void> {
  await stopRunnerForDurableJobImpl(toRunnerContext(context), job, getRunnerRuntimeDeps());
}

// Module 5 — findEvidence / formatEvidenceDetails / parseLogArtifactRequest /
// readPositiveIntegerArg / createLogArtifactRegistry / formatAgentDetails
// 已移至 ./tui-details-runtime.ts。

// Module 4 — findBackgroundTask / isActiveBackgroundStatus 已移至
// ./tui-agent-job-runtime.ts。

export function refreshBackgroundLifecycle(context: TuiContext): void {
  const now = Date.now();
  for (const task of context.backgroundTasks) {
    if (!isActiveBackgroundStatus(task.status)) {
      continue;
    }
    const lastActivity = Date.parse(task.lastOutputAt ?? task.updatedAt ?? task.startedAt);
    if (Number.isNaN(lastActivity)) {
      continue;
    }
    if (task.status === "running" && now - lastActivity > task.staleAfterMs) {
      task.status = "stale";
      task.result = "partial";
      task.updatedAt = new Date(now).toISOString();
      task.userVisibleSummary = `${task.userVisibleSummary}（可能卡住或长时间无输出）`;
      task.nextAction =
        context.language === "en-US"
          ? `Open /details background ${task.id}, inspect logs, or use /interrupt.`
          : `可用 /details background ${task.id} 查看日志，或用 /interrupt 取消。`;
    }
  }
}

// D.13V-C — Resource / concurrency guard，并非第五种权限模式。
// 命名/语义说明：
// - 此 guard 仅做 concurrency cap（前台模型请求互斥 + 后台任务上限），不做 access control。
// - mutating access control 仍由 default / auto-review / plan / full-access 四档权限管道决策。
// - 文案、报告、UI、smoke 全部应避免把 "resource guard" 称为 "permission mode" 或第五权限。
// - 测试在 docs/delivery/phase-13V-* 与 D13T audit 已记录；此常量是源码级断言锚点。
export const RESOURCE_GUARD_KIND = "concurrency-cap" as const;

export function checkResourceGuard(
  context: TuiContext,
  kind: BackgroundTaskState["kind"] | "model" | "heavy",
  ignoreTaskId?: string,
): string | null {
  refreshBackgroundLifecycle(context);
  if (kind === "model") {
    return context.activeAbortController
      ? "并发上限：已有前台模型请求正在运行；请等待完成或使用 /interrupt 取消后再继续。这是 resource/concurrency cap，不是权限拒绝。"
      : null;
  }
  const activeTasks = context.backgroundTasks.filter(
    (task) => task.id !== ignoreTaskId && isRuntimeActiveBackgroundTask(task),
  );
  const resourceCountedTasks = activeTasks.filter((task) => isResourceGuardCountedKind(task.kind));
  if (resourceCountedTasks.length >= BACKGROUND_RUNNING_GLOBAL_CAP) {
    return `并发上限：后台任务已达到全局上限 ${BACKGROUND_RUNNING_GLOBAL_CAP}；请等待完成、查看 /background，或用 /interrupt 取消卡住任务。这是 resource/concurrency cap，不是权限拒绝。`;
  }
  const capTasks = resourceCountedTasks.filter(
    (task) => !ignoreTaskId || task.workflowRunId !== ignoreTaskId || task.kind !== "agent",
  );
  if (kind === "heavy") {
    const heavy = capTasks.find(
      (task) =>
        task.kind === "verification" ||
        task.kind === "index" ||
        task.kind === "bash",
    );
    return heavy
      ? `并发上限：已有 ${heavy.kind} 重任务正在运行。请等待完成、查看 /background，或先 /interrupt。这是 resource/concurrency cap，不是权限拒绝。`
      : null;
  }
  const cap = BACKGROUND_KIND_CAPS[kind];
  if (cap !== undefined && capTasks.filter((task) => task.kind === kind).length >= cap) {
    return `并发上限：${kind} 后台任务已达到上限 ${cap}；请等待完成、查看 /background，或用 /interrupt 取消后重试。这是 resource/concurrency cap，不是权限拒绝。`;
  }
  return null;
}

function isResourceGuardCountedKind(kind: BackgroundTaskState["kind"]): boolean {
  return kind === "bash" || kind === "verification" || kind === "index" || kind === "compact";
}

export function checkBackgroundStartGuard(
  context: TuiContext,
  kind: BackgroundTaskState["kind"],
  heavy = false,
  ignoreTaskId?: string,
): string | null {
  return (
    checkResourceGuard(context, kind, ignoreTaskId) ??
    (heavy ? checkResourceGuard(context, "heavy", ignoreTaskId) : null)
  );
}

// Module 4 — rememberBackgroundTask 已移至 ./tui-agent-job-runtime.ts。

export function finishBackgroundTaskFromToolOutput(
  task: BackgroundTaskState,
  output: ToolOutput,
  context: TuiContext,
): void {
  const data = output.data as { exitCode?: unknown; outcome?: unknown } | undefined;
  const exitCode = typeof data?.exitCode === "number" ? data.exitCode : 0;
  const outcome = data?.outcome;
  const now = new Date().toISOString();
  if (outcome === "cancelled") {
    task.status = "cancelled";
    task.result = "cancelled";
    task.cancelState = "confirmed_exited";
    task.confirmedExitedAt = now;
    task.currentStep = context.language === "en-US" ? "cancelled" : "已取消";
  } else if (outcome === "timeout") {
    task.status = "timeout";
    task.result = "timeout";
    task.currentStep = context.language === "en-US" ? "timeout" : "已超时";
  } else if (exitCode !== 0) {
    task.status = "failed";
    task.result = "fail";
    task.currentStep = context.language === "en-US" ? "command failed" : "命令失败";
  } else {
    task.status = "completed";
    task.result = "pass";
    task.currentStep = context.language === "en-US" ? "command completed" : "命令完成";
  }
  task.updatedAt = now;
  task.lastOutputAt = now;
  task.hasOutput = Boolean(output.text.trim() || output.fullOutputPath);
  task.logPath = output.fullOutputPath;
  task.outputPath = output.fullOutputPath;
  task.progress = { completed: 1, total: 1, label: "Bash" };
  task.userVisibleSummary =
    task.status === "completed"
      ? context.language === "en-US"
        ? "Command completed; full output is in the log."
        : "命令已完成；完整输出已写入日志。"
      : context.language === "en-US"
        ? `Command ended with ${task.status}; do not claim it passed.`
        : `命令以 ${task.status} 结束；不得声称已通过。`;
  task.nextAction =
    task.cancelState === "confirmed_exited"
      ? context.language === "en-US"
        ? "Process exit was observed after cancellation; inspect the log before rerunning."
        : "已观察到取消后的进程退出；重跑前请先查看日志。"
      : task.status === "completed"
      ? context.language === "en-US"
        ? "Review the summarized output or open the log."
        : "可查看摘要输出或打开完整日志。"
      : context.language === "en-US"
        ? "Inspect the log, fix the issue, then rerun if needed."
        : "先查看日志并修复问题，必要时重跑。";
}

export function updateCommandPanelSelection(context: TuiContext, delta: -1 | 1): void {
  const panel = context.commandPanelState;
  if (!panel) return;
  const rows = getCommandPanelSelectableRows(panel);
  if (rows.length === 0) return;
  const current = Math.max(0, Math.min(panel.cursor ?? 0, rows.length - 1));
  const next = (current + delta + rows.length) % rows.length;
  const pageSize = 8;
  const currentOffset = Math.max(0, panel.scrollOffset ?? 0);
  const scrollOffset =
    next < currentOffset
      ? next
      : next >= currentOffset + pageSize
        ? Math.max(0, next - pageSize + 1)
        : currentOffset;
  context.commandPanelState = { ...panel, cursor: next, scrollOffset };
}

export function toggleCommandPanelSelection(context: TuiContext): void {
  const panel = context.commandPanelState;
  if (!panel || getCommandPanelSelectableRows(panel).length === 0) return;
  context.commandPanelState = { ...panel, expanded: !panel.expanded };
}

export function __testUpdateCommandPanelSelection(context: TuiContext, delta: -1 | 1): void {
  updateCommandPanelSelection(context, delta);
}

export function __testToggleCommandPanelSelection(context: TuiContext): void {
  toggleCommandPanelSelection(context);
}

export async function stopCommandPanelSelection(
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const panel = context.commandPanelState;
  if (!panel) return;
  const rows = getCommandPanelSelectableRows(panel);
  if (rows.length === 0) return;
  const cursor = Math.max(0, Math.min(panel.cursor ?? 0, rows.length - 1));
  const taskRef = rows[cursor]?.taskRef;
  if (!taskRef) return;
  const dispatchOutput = context.isInkSession ? createSilentOutput() : output;
  if (dismissCommandPanelTaskRef(taskRef.id, context, dispatchOutput)) {
    if (context.isInkSession) {
      await handleBackgroundCommand([], context, createSilentOutput());
    }
    return;
  }
  if (taskRef.kind === "agent") {
    await cancelAgentByRef(taskRef.id, context, dispatchOutput);
  } else if (taskRef.kind === "job") {
    await handleJobCommand(["cancel", taskRef.id], context, dispatchOutput);
  } else {
    await stopSingleBackgroundTask(taskRef.id, context, dispatchOutput);
  }
  if (context.isInkSession) {
    await handleBackgroundCommand([], context, createSilentOutput());
  }
}

export async function __testStopCommandPanelSelection(
  context: TuiContext,
  output: Writable,
): Promise<void> {
  await stopCommandPanelSelection(context, output);
}

async function stopSingleBackgroundTask(
  taskId: string,
  context: TuiContext,
  output: Writable,
): Promise<boolean> {
  const task = findBackgroundTask(context, taskId);
  if (!task || !isRuntimeActiveBackgroundTask(task)) {
    writeLine(
      output,
      context.language === "en-US"
        ? "Selected background task is not running."
        : "选中的后台任务当前未运行。",
    );
    return false;
  }
  const sessionId = await ensureSession(context);
  const now = new Date().toISOString();
  let aborted = false;
  if (task.kind === "verification" && context.activeVerificationAbortController) {
    context.activeVerificationAbortController.abort();
    context.activeVerificationAbortController = undefined;
    context.interrupt = { type: "idle" };
    aborted = true;
  } else {
    aborted = abortBackgroundTask(context, task.id);
  }
  if (task.kind === "job") {
    const job = await findDurableJob(context, task.id);
    if (job) {
      if (job.runner) {
        await stopRunnerForDurableJob(context, job);
      }
      await transitionDurableJob(
        job,
        context,
        aborted ? "cancelled" : "stale",
        aborted ? "selected_abort_signal_sent" : "selected_without_abort_controller",
      );
      const updatedTask = createJobBackgroundTask(job, context);
      Object.assign(task, updatedTask);
      await appendBackgroundTaskEvent(context, sessionId, task);
      return true;
    }
  }
  task.status = aborted ? "cancelled" : "stale";
  task.result = aborted ? "cancelled" : "partial";
  task.updatedAt = now;
  task.cancelState = aborted ? "abort_signal_sent" : "marked_stale";
  task.cancelRequestedAt = now;
  task.nextAction = aborted
    ? context.language === "en-US"
      ? "Abort signal sent; process exit is not confirmed yet. Review /background and the log before continuing."
      : "已发送取消信号；尚未确认进程退出。继续前可先查看 /background 和日志。"
    : context.language === "en-US"
      ? "No live abort controller was available; state marked stale/resumable."
      : "未找到可用取消 controller；已标记为 stale/resumable。";
  await appendBackgroundTaskEvent(context, sessionId, task);
  writeLine(
    output,
    aborted
      ? context.language === "en-US"
        ? `Stopped ${task.title}.`
        : `已停止 ${task.title}。`
      : context.language === "en-US"
        ? `${task.title} has no live abort controller; marked stale.`
        : `${task.title} 没有可用取消 controller；已标记为 stale。`,
  );
  return true;
}

function isDismissibleBackgroundStatus(status: BackgroundTaskState["status"]): boolean {
  return status !== "running";
}

function dismissCommandPanelTaskRef(taskId: string, context: TuiContext, output: Writable): boolean {
  const task = findBackgroundTask(context, taskId);
  if (!task || !isDismissibleBackgroundStatus(task.status)) {
    return false;
  }
  dismissBackgroundTask(task.id, context, output);
  return true;
}

export function dismissBackgroundTask(
  taskId: string,
  context: TuiContext,
  output: Writable,
): boolean {
  const before = context.backgroundTasks.length;
  const task = findBackgroundTask(context, taskId);
  if (!task) {
    writeLine(
      output,
      context.language === "en-US"
        ? "Background task not found."
        : "未找到后台任务。",
    );
    return false;
  }
  if (!isDismissibleBackgroundStatus(task.status)) {
    writeLine(
      output,
      context.language === "en-US"
        ? "Running background tasks must be stopped or cancelled, not dismissed."
        : "running 后台任务只能 stop/cancel，不能直接清理。",
    );
    return false;
  }
  context.backgroundTasks = context.backgroundTasks.filter((item) => item.id !== task.id);
  if (before === context.backgroundTasks.length) {
    return false;
  }
  if (!context.dismissedBackgroundTaskIds) {
    context.dismissedBackgroundTaskIds = new Set();
  }
  context.dismissedBackgroundTaskIds.add(task.id);
  writeLine(
    output,
    context.language === "en-US"
      ? `Dismissed ${task.title}. Transcript and logs are preserved.`
      : `已清理 ${task.title}；transcript 和日志仍保留。`,
  );
  return true;
}

export async function __testStopSingleBackgroundTask(
  taskId: string,
  context: TuiContext,
  output: Writable,
): Promise<boolean> {
  return stopSingleBackgroundTask(taskId, context, output);
}

export async function handleInterruptCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const agentRef = args.join(" ").trim();
  if (agentRef) {
    await cancelAgentByRef(agentRef, context, output);
    return;
  }
  const result = await interruptAllActiveWork(context);
  if (result.cancelled === 0) {
    writeLine(output, t(context, "interruptIdle"));
    return;
  }
  writeLine(
    output,
    context.language === "en-US"
      ? `Interrupt requested for ${result.cancelled} active item(s); abort signal sent ${result.abortSignalsSent}; marked stale ${result.markedOnly}; confirmed exited ${result.confirmedExited}. Inspect /background/logs before assuming processes exited.`
      : `已请求中断 ${result.cancelled} 个活动任务；已发送取消信号 ${result.abortSignalsSent}；已标记 stale ${result.markedOnly}；已确认退出 ${result.confirmedExited}。确认进程退出前请查看 /background 和日志。`,
  );
}

type InterruptAllActiveWorkResult = {
  cancelled: number;
  abortSignalsSent: number;
  markedOnly: number;
  confirmedExited: number;
};

export async function interruptAllActiveWork(
  context: TuiContext,
): Promise<InterruptAllActiveWorkResult> {
  const sessionId = await ensureSession(context);
  const now = new Date().toISOString();
  let cancelled = 0;
  let abortSignalsSent = 0;
  let markedOnly = 0;
  let confirmedExited = 0;
  const appendInterruptEvent = async (message: string) => {
    await context.store.appendEvent(sessionId, {
      type: "interrupt",
      id: randomUUID(),
      status: "cancelled",
      message,
      createdAt: new Date().toISOString(),
    });
  };

  if (context.activeVerificationAbortController) {
    context.activeVerificationAbortController.abort();
    context.activeVerificationAbortController = undefined;
    cancelled += 1;
    abortSignalsSent += 1;
    context.interrupt = { type: "idle" };
    const verificationTasks = context.backgroundTasks.filter(
      (task) => task.kind === "verification" && isActiveBackgroundStatus(task.status),
    );
    for (const verificationTask of verificationTasks) {
      verificationTask.status = "cancelled";
      verificationTask.result = "cancelled";
      verificationTask.updatedAt = now;
      verificationTask.cancelState = "abort_signal_sent";
      verificationTask.cancelRequestedAt = now;
      verificationTask.nextAction =
        context.language === "en-US"
          ? "Abort signal sent; process exit is not confirmed yet. Review the verification log, then rerun /verify if needed."
          : "已发送取消信号；尚未确认进程退出。先查看验证日志，必要时复跑 /verify。";
      await appendBackgroundTaskEvent(context, sessionId, verificationTask);
    }
  }

  if (context.activeAbortController) {
    context.activeAbortController.abort();
    context.activeAbortController = undefined;
    clearRequestActivity(context);
    context.interrupt = { type: "idle" };
    cancelled += 1;
    abortSignalsSent += 1;
  }

  if (context.activeBtwAbortController) {
    context.activeBtwAbortController.abort();
    context.activeBtwAbortController = undefined;
    if (context.btwPanelState?.phase === "loading") {
      context.btwPanelState = {
        question: context.btwPanelState.question,
        phase: "error",
        error: context.language === "en-US" ? "Side question cancelled." : "临时插问已取消。",
      };
    }
    cancelled += 1;
    abortSignalsSent += 1;
  }

  const workflowRun = context.workflows.activeRun;
  const workflowTask =
    workflowRun?.status === "running"
      ? (context.backgroundTasks.find((task) => task.id === workflowRun.id) ??
        createWorkflowInterruptBackgroundTask(workflowRun, context.language))
      : undefined;
  if (workflowRun?.status === "running" && workflowTask) {
    upsertWorkflowBackgroundTask(context, workflowTask);
    cancelled += 1;
    markedOnly += 1;
    await finishWorkflowRun(
      workflowRun.id,
      "cancelled",
      context.language === "en-US"
        ? "Workflow cancelled by interrupt; inspect /workflows status before rerun."
        : "Workflow 已由中断取消；重跑前请先查看 /workflows status。",
      context,
      sessionId,
      workflowTask,
    );
  }

  const runningAgentIds = new Set(
    context.agents.filter((agent) => agent.status === "running").map((agent) => agent.id),
  );
  const activeTasks = context.backgroundTasks
    .filter((task) => isRuntimeActiveBackgroundTask(task) && task.id !== workflowRun?.id)
    .filter((task) => !runningAgentIds.has(task.id));
  for (const task of activeTasks) {
    const aborted = abortBackgroundTask(context, task.id);
    if (aborted) abortSignalsSent += 1;
    else markedOnly += 1;
    cancelled += 1;
    if (task.kind === "job") {
      const job = await findDurableJob(context, task.id);
      if (job) {
        await transitionDurableJob(
          job,
          context,
          aborted ? "cancelled" : "stale",
          aborted ? "interrupt_abort_signal_sent" : "interrupt_without_abort_controller",
        );
        const updatedTask = createJobBackgroundTask(job, context);
        Object.assign(task, updatedTask);
        await appendBackgroundTaskEvent(context, sessionId, task);
        continue;
      }
    }
    task.status = aborted ? "cancelled" : "stale";
    task.result = aborted ? "cancelled" : "partial";
    task.updatedAt = now;
    task.cancelState = aborted ? "abort_signal_sent" : "marked_stale";
    task.cancelRequestedAt = now;
    task.nextAction = aborted
      ? context.language === "en-US"
        ? "Abort signal sent; process exit is not confirmed yet. Review /background and the log before continuing."
        : "已发送取消信号；尚未确认进程退出。继续前可先查看 /background 和日志。"
      : context.language === "en-US"
        ? "No live abort controller was available; state marked stale/resumable."
        : "未找到可用取消 controller；已标记为 stale/resumable。";
    await appendBackgroundTaskEvent(context, sessionId, task);
  }

  for (const agent of context.agents.filter((item) => item.status === "running")) {
    const hadController = Boolean(context.backgroundAbortControllers?.has(agent.id));
    await cancelAgentByRef(agent.id, context, createSilentOutput());
    cancelled += 1;
    if (hadController) abortSignalsSent += 1;
  }

  if (context.workflows.activeRun?.status === "running") {
    context.workflows.activeRun.status = "cancelled";
    context.workflows.activeRun.endedAt = now;
    context.workflows.activeRun.result = "cancelled";
  }

  await appendInterruptEvent(
    cancelled === 0
      ? t(context, "interruptIdle")
      : `${t(context, "interruptCancelled")} abort_signal_sent=${abortSignalsSent}; marked_stale=${markedOnly}; confirmed_exited=${confirmedExited}`,
  );
  return { cancelled, abortSignalsSent, markedOnly, confirmedExited };
}
