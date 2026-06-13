// Module 4: tui-agent-job-runtime
// Pure agent / job / background helpers extracted from packages/tui/src/index.ts
// as part of the D.13 mechanical split. Behavior is unchanged. Coordinators
// that depend on i18n (`t`), ensureSession, store.appendEvent, runTool,
// runAgentWork, addRoleUsage, createRoleHandoff, runVerificationPlan,
// writeLine/writeStatus/appendBackgroundTaskEvent stay in index.ts to avoid
// cross-module circular dependencies (Path A safety valve #2).
//
// What moved here:
//   - isAgentType / getAgentRole / getAgentPermissionMode (pure)
//   - createEmptyAgentCost (pure)
//   - createAgentContextSummary (type-only TuiContext)
//   - createAgentBackgroundTask (type-only TuiContext)
//   - mapAgentBackgroundResult (pure)
//   - findAgent / formatAgentSummary
//   - findBackgroundTask / isActiveBackgroundStatus / rememberBackgroundTask
//   - getBackgroundAbortControllers / registerBackgroundAbortController /
//     clearBackgroundAbortController / abortBackgroundTask
//   - toJobContext / listDurableJobs / findDurableJob /
//     getDurableJobsRoot / getDurableJobPaths / formatJobList /
//     formatJobPrimary / formatJobReport / formatJobLogs
//   - createJobBackgroundTask / upsertJobBackgroundTask
//
// All consumers continue to import via "../index.js"; index.ts re-exports
// the symbols below and imports them value-side for internal callers.

import type { ModelRole } from "@linghun/config";
import type { PermissionMode } from "@linghun/shared";
import { formatIndexRuntimeRef } from "./index-runtime.js";
import type { TuiContext } from "./index.js";
import {
  formatJobNextAction,
  mapDurableJobToBackgroundResult,
  mapDurableJobToBackgroundStatus,
} from "./job-runner-presenter.js";
import { deriveAgentDisplayName } from "./job-runtime.js";
import type { JobContext } from "./job-runtime.js";
import {
  findDurableJob as findDurableJobFromFs,
  formatJobList as formatJobListImpl,
  formatJobLogs as formatJobLogsImpl,
  formatJobPrimary as formatJobPrimaryImpl,
  formatJobReport as formatJobReportImpl,
  getDurableJobMaxSteps,
  getDurableJobPaths as getDurableJobPathsImpl,
  getDurableJobsRoot as getDurableJobsRootImpl,
  listDurableJobs as listDurableJobsFromFs,
} from "./job-runtime.js";
import { truncateDisplay } from "./startup-runtime.js";
import type { DurableJobState } from "./tui-data-types.js";
import type {
  AgentRun,
  AgentType,
  BackgroundTaskState,
  BackgroundTaskStatus,
  HandoffPacket,
} from "./tui-data-types.js";

// MAX_BACKGROUND_TASKS lives in tui-context-runtime.ts; re-exported to keep
// rememberBackgroundTask self-contained. Module-private shadow removed.
import { MAX_BACKGROUND_TASKS } from "./tui-context-runtime.js";

export function isAgentType(value: string): value is AgentType {
  return value === "explorer" || value === "worker" || value === "verifier" || value === "planner";
}

export function getAgentRole(type: AgentType): ModelRole {
  if (type === "planner") {
    return "planner";
  }
  if (type === "verifier") {
    return "verifier";
  }
  return "executor";
}

export function getAgentPermissionMode(
  type: AgentType,
  parentMode: PermissionMode,
): PermissionMode {
  if (type === "explorer" || type === "planner") {
    return "plan";
  }
  if (type === "verifier") {
    return "default";
  }
  return parentMode;
}

export function createEmptyAgentCost(task: string): AgentRun["cost"] {
  const inputTokens = Math.ceil(task.length / 4);
  return { inputTokens, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, estimatedCny: 0 };
}

export function createAgentContextSummary(
  packet: HandoffPacket,
  task: string,
  context: TuiContext,
): string {
  const evidence = packet.evidenceRefs.map((item) => `${item.kind}:${item.source}`).slice(0, 5);
  const files = packet.keyFiles.slice(0, 8);
  const activeFailures = context.failureLearning.records.filter(
    (item) =>
      item.status === "active" && item.projectScope === context.failureLearning.projectScope,
  );
  const freshness = context.cache.lastFreshness
    ? `changed ${context.cache.lastFreshness.changedKeys.slice(0, 5).join(", ") || "none"}`
    : "not checked";
  const architecture = packet.currentArchitectureCard
    ? truncateDisplay(packet.currentArchitectureCard.recommendedApproach, 120)
    : "none";
  const indexSummary = formatIndexRuntimeRef(packet.indexStatus).replace(/=/gu, " ");
  return [
    "Agent context package (trimmed)",
    `handoff ${packet.id}`,
    `task ${truncateDisplay(task, 200)}`,
    `language ${context.language}`,
    `todos ${packet.todos.length}`,
    `evidence ${evidence.length > 0 ? evidence.join("; ") : "none"}`,
    `key files ${files.length > 0 ? files.join(", ") : "none"}`,
    `index ${indexSummary}`,
    `cache freshness ${freshness}`,
    `architecture ${architecture}`,
    `failure learning ${activeFailures.length}`,
    `permission ${context.permissionMode}`,
    "not included: full transcript/full memory/full index/large logs",
  ].join(" | ");
}

export function createAgentBackgroundTask(
  agent: AgentRun,
  context: TuiContext,
): BackgroundTaskState {
  const label = agent.displayName ?? deriveAgentDisplayName(agent.type, agent.task);
  const isEn = context.language === "en-US";
  const isTerminal =
    agent.status === "blocked" || agent.status === "cancelled" || agent.status === "failed";
  const isIdle = agent.status === "idle";
  const backgroundStatus: BackgroundTaskState["status"] = isTerminal
    ? agent.status === "blocked"
      ? "blocked"
      : agent.status === "cancelled"
        ? "cancelled"
        : agent.status === "failed"
          ? "failed"
          : "completed"
    : isIdle
      ? "completed"
      : agent.status === "stale"
        ? "stale"
        : "running";
  const backgroundResult: BackgroundTaskState["result"] = isTerminal
    ? agent.status === "cancelled"
      ? "cancelled"
      : "fail"
    : isIdle
      ? mapAgentBackgroundResult(agent, agent.lastTerminalStatus)
      : agent.status === "stale"
        ? "partial"
        : undefined;
  const currentStep = isTerminal
    ? agent.status
    : isIdle
      ? agent.activitySummary
        ? `idle: ${agent.activitySummary}`
        : "idle"
      : agent.status === "stale"
        ? "stale/resumable"
        : isEn
          ? `running ${agent.type}`
          : `正在运行 ${agent.type}`;
  const progress =
    isTerminal || isIdle ? { completed: 1, total: 1, label } : { completed: 0, total: 1, label };
  const userVisibleSummary = isTerminal
    ? agent.summary
    : isIdle
      ? agent.summary
      : agent.status === "stale"
        ? agent.summary
        : isEn
          ? `Started ${label}. Use /agents show ${agent.id}.`
          : `已启动 ${label}。可用 /agents show ${agent.id} 查看。`;
  return {
    id: agent.id,
    kind: "agent",
    title: `Agent ${label}`,
    status: backgroundStatus,
    currentStep,
    progress,
    result: backgroundResult,
    startedAt: agent.startedAt,
    updatedAt: agent.updatedAt,
    heartbeatIntervalMs: 30_000,
    staleAfterMs: 120_000,
    outputPath: agent.transcriptPath,
    hasOutput: true,
    userVisibleSummary,
    nextAction: isEn
      ? `Use /agents cancel ${agent.id} to interrupt.`
      : `可用 /agents cancel ${agent.id} 中断。`,
  };
}

export function isAgentCancellable(agent: Pick<AgentRun, "status">): boolean {
  return agent.status === "running";
}

export function mapAgentBackgroundResult(
  agent: AgentRun,
  lastTerminalStatus?: "completed" | "failed" | "blocked",
): BackgroundTaskState["result"] {
  if (agent.type !== "verifier") {
    return "partial";
  }
  return lastTerminalStatus === "completed"
    ? "partial"
    : lastTerminalStatus === "failed"
      ? "fail"
      : "partial";
}

export function findAgent(context: TuiContext, id: string | undefined): AgentRun | undefined {
  if (id) {
    const normalized = id.trim();
    return context.agents.find(
      (agent) =>
        agent.id === normalized ||
        agent.id.endsWith(normalized) ||
        agent.addressableName === normalized ||
        agent.teamName === normalized,
    );
  }
  return (
    context.agents.find((agent) => agent.status === "running") ??
    context.agents.find((agent) => agent.status === "idle") ??
    context.agents.find((agent) => agent.status === "stale") ??
    context.agents.find((agent) => agent.status === "blocked") ??
    context.agents[0]
  );
}

export function listCancellableAgents(context: TuiContext): AgentRun[] {
  return context.agents.filter(isAgentCancellable);
}

export function formatAgentSummary(agent: AgentRun, _context: TuiContext): string {
  const displayStatus = agent.status === "idle" && agent.lastTerminalStatus
    ? agent.lastTerminalStatus
    : agent.status;
  return `[agent] ${agent.id} · ${agent.type} · ${displayStatus} · ${agent.summary}`;
}

export function findBackgroundTask(
  context: TuiContext,
  id: string | undefined,
): BackgroundTaskState | undefined {
  if (!id) {
    return context.backgroundTasks[0];
  }
  return context.backgroundTasks.find((task) => task.id === id || task.id.endsWith(id));
}

export function isActiveBackgroundStatus(status: BackgroundTaskStatus): boolean {
  return status === "running";
}

export function isRuntimeActiveBackgroundTask(task: BackgroundTaskState): boolean {
  return task.status === "running";
}

export function rememberBackgroundTask(context: TuiContext, task: BackgroundTaskState): void {
  context.backgroundTasks.unshift(task);
  context.backgroundTasks = context.backgroundTasks.slice(0, MAX_BACKGROUND_TASKS);
}

// P1-6: 自动清理完成超过 5 秒的任务
const AUTO_REMOVE_COMPLETED_TASKS_MS = 5_000;

export function cleanupCompletedBackgroundTasks(context: TuiContext): void {
  if (!context.dismissedBackgroundTaskIds) {
    context.dismissedBackgroundTaskIds = new Set();
  }

  const now = Date.now();
  for (const task of context.backgroundTasks) {
    if (
      task.status === "completed" &&
      task.completedAt &&
      !context.dismissedBackgroundTaskIds.has(task.id)
    ) {
      const completedTime = Date.parse(task.completedAt);
      if (Number.isFinite(completedTime) && now - completedTime >= AUTO_REMOVE_COMPLETED_TASKS_MS) {
        context.dismissedBackgroundTaskIds.add(task.id);
      }
    }
  }
}


export function getBackgroundAbortControllers(context: TuiContext): Map<string, AbortController> {
  if (!context.backgroundAbortControllers) {
    context.backgroundAbortControllers = new Map();
  }
  return context.backgroundAbortControllers;
}

export function registerBackgroundAbortController(
  context: TuiContext,
  taskId: string,
): AbortController {
  const controller = new AbortController();
  getBackgroundAbortControllers(context).set(taskId, controller);
  return controller;
}

export function clearBackgroundAbortController(context: TuiContext, taskId: string): void {
  context.backgroundAbortControllers?.delete(taskId);
}

export function abortBackgroundTask(context: TuiContext, taskId: string): boolean {
  const controller = context.backgroundAbortControllers?.get(taskId);
  if (!controller) {
    return false;
  }
  controller.abort();
  clearBackgroundAbortController(context, taskId);
  return true;
}

// ---------------------------------------------------------------------------
// Job runtime — thin wrappers delegating to job-runtime.ts
// ---------------------------------------------------------------------------

export function toJobContext(context: TuiContext): JobContext {
  return { config: context.config, projectPath: context.projectPath, language: context.language };
}

export async function listDurableJobs(context: TuiContext): Promise<DurableJobState[]> {
  return listDurableJobsFromFs(toJobContext(context));
}

export async function findDurableJob(
  context: TuiContext,
  id: string | undefined,
): Promise<DurableJobState | undefined> {
  return findDurableJobFromFs(toJobContext(context), id);
}

export function getDurableJobsRoot(context: TuiContext): string {
  return getDurableJobsRootImpl(toJobContext(context));
}

export function getDurableJobPaths(
  context: TuiContext,
  id: string,
): Pick<DurableJobState, "logPath" | "reportPath" | "fullOutputPath"> {
  return getDurableJobPathsImpl(toJobContext(context), id);
}

export function formatJobList(jobs: DurableJobState[], context: TuiContext): string {
  return formatJobListImpl(jobs, toJobContext(context));
}

export function formatJobPrimary(job: DurableJobState, context: TuiContext): string {
  return formatJobPrimaryImpl(job, toJobContext(context));
}

export function formatJobReport(job: DurableJobState): string {
  return formatJobReportImpl(job);
}

export async function formatJobLogs(job: DurableJobState): Promise<string> {
  return formatJobLogsImpl(job);
}

export function createJobBackgroundTask(
  job: DurableJobState,
  context: TuiContext,
): BackgroundTaskState {
  const runningAgents = job.agents.filter((agent) => agent.status === "running").length;
  return {
    id: job.id,
    kind: "job",
    title: `Job: ${truncateDisplay(job.goal, 40)}`,
    status: mapDurableJobToBackgroundStatus(job.status),
    currentStep:
      job.pauseReason ??
      `worker step ${job.budget.usedSteps ?? 0}/${getDurableJobMaxSteps(job)}; agents ${runningAgents}/${job.agents.length}`,
    progress: {
      completed: job.budget.usedSteps ?? 0,
      total: getDurableJobMaxSteps(job),
      label: "worker steps",
    },
    startedAt: job.startedAt ?? job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.status === "completed" ? job.endedAt : undefined,
    heartbeatIntervalMs: 30_000,
    staleAfterMs: job.timeoutMs,
    logPath: job.logPath,
    outputPath: job.fullOutputPath,
    hasOutput: true,
    result: mapDurableJobToBackgroundResult(job.status),
    userVisibleSummary:
      job.status === "running"
        ? `Job running with ${runningAgents}/${job.agents.length} agents under cap ${job.budget.maxRunningAgents}; output stays in logs.`
        : `Job ${job.status}; ${job.pauseReason ?? "no evidence that verification passed was generated"}.`,
    nextAction: formatJobNextAction(job, context.language),
  };
}

export function upsertJobBackgroundTask(
  context: TuiContext,
  job: DurableJobState,
): BackgroundTaskState {
  const existing = context.backgroundTasks.find((task) => task.id === job.id);
  const task = createJobBackgroundTask(job, context);
  if (existing) {
    Object.assign(existing, task);
    return existing;
  }
  rememberBackgroundTask(context, task);
  return task;
}
