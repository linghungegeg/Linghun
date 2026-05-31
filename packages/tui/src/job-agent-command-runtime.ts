import { randomUUID } from "node:crypto";
import type { Writable } from "node:stream";
import type { ModelRole, RoleModelRoute } from "@linghun/config";
import type { TranscriptEvent } from "@linghun/core";
import type { ToolName, ToolOutput } from "@linghun/tools";
import { runTool } from "@linghun/tools";
import { showCommandPanel } from "./command-panel-runtime.js";
import type { FailureLearningInput } from "./failure-learning-runtime.js";
import { loadOrCreateHandoffPacket, validateHandoffPacket } from "./handoff-session-runtime.js";
import type { TuiContext } from "./index.js";
import {
  formatBackgroundTask,
  formatJobRunnerInline,
  mapDurableJobToBackgroundResult,
  mapDurableJobToBackgroundStatus,
} from "./job-runner-presenter.js";
import {
  DEFAULT_JOB_RUNNING_AGENT_CAP,
  JOB_AGENT_HIGH_CONFIG_CANDIDATE,
  JOB_RECOVERY_HEARTBEAT_STALE_MS,
  MAX_AGENTS,
  type ParsedJobRunOptions,
  appendJobLog,
  createDurableJobAgents,
  deriveAgentDisplayName,
  estimateJobTokens,
  formatJobAgentLabels,
  formatJobStatus,
  getDurableJobMaxSteps,
  parseJobRunOptions,
  persistDurableJob,
  rescheduleDurableJobAgents,
  writeDurableJobReport,
} from "./job-runtime.js";
import { getRoleRoute } from "./model-doctor-runtime.js";
import {
  type RunnerContext,
  type RunnerRuntimeDeps,
  markJobRunnerTerminal,
  refreshRunnerStatusForJob as refreshRunnerStatusForJobImpl,
  startRunnerForDurableJob as startRunnerForDurableJobImpl,
  stopRunnerForDurableJob as stopRunnerForDurableJobImpl,
} from "./runner-runtime.js";
import { truncateDisplay, writeLine } from "./startup-runtime.js";
import {
  createAgentBackgroundTask,
  createAgentContextSummary,
  createEmptyAgentCost,
  findAgent,
  findDurableJob,
  formatAgentSummary,
  formatJobList,
  formatJobLogs,
  formatJobPrimary,
  formatJobReport,
  getAgentPermissionMode,
  getAgentRole,
  getDurableJobPaths,
  isActiveBackgroundStatus,
  isAgentType,
  listDurableJobs,
  mapAgentBackgroundResult,
  rememberBackgroundTask,
  toJobContext,
  upsertJobBackgroundTask,
} from "./tui-agent-job-runtime.js";
import type {
  AgentRun,
  AgentType,
  BackgroundTaskState,
  DurableJobState,
  DurableJobStatus,
  RoleHandoff,
  RoleRouteDecision,
} from "./tui-data-types.js";
import { formatAgentDetails } from "./tui-details-runtime.js";
import { formatRoutePauseMessage, resolveRoleRoute } from "./tui-model-runtime.js";
import { decidePermission } from "./tui-permission-runtime.js";
import { createVerificationPlan, runVerificationPlan } from "./verification-command-runtime.js";
import { isFallbackWorkspaceReferenceSnapshot } from "./workspace-reference-cache.js";

export type JobAgentCommandRuntimeDeps = {
  addRoleUsage: (
    context: TuiContext,
    role: ModelRole,
    route: RoleModelRoute,
    inputTokens: number,
    outputTokens: number,
    note?: string,
  ) => void;
  appendBackgroundTaskEvent: (
    context: TuiContext,
    sessionId: string,
    task: BackgroundTaskState,
  ) => Promise<void>;
  appendRouteDecisionEvent: (
    context: TuiContext,
    sessionId: string,
    decision: RoleRouteDecision,
  ) => Promise<void>;
  checkBackgroundStartGuard: (
    context: TuiContext,
    kind: BackgroundTaskState["kind"],
    heavy?: boolean,
    ignoreTaskId?: string,
  ) => string | null;
  checkResourceGuard: (
    context: TuiContext,
    kind: BackgroundTaskState["kind"] | "model" | "heavy",
    ignoreTaskId?: string,
  ) => string | null;
  createRoleHandoff: (
    from: ModelRole,
    to: ModelRole,
    source: string,
    summary: string,
    context: TuiContext,
  ) => RoleHandoff;
  ensureSession: (context: TuiContext) => Promise<string>;
  refreshBackgroundLifecycle: (context: TuiContext) => void;
  writeStatus: (output: Writable, context: TuiContext) => void;
  captureFailureLearning: (
    context: TuiContext,
    sessionId: string,
    input: FailureLearningInput,
  ) => Promise<void>;
};

let runtimeDeps: JobAgentCommandRuntimeDeps | undefined;

export function configureJobAgentCommandRuntime(deps: JobAgentCommandRuntimeDeps): void {
  runtimeDeps = deps;
}

function deps(): JobAgentCommandRuntimeDeps {
  if (!runtimeDeps) {
    throw new Error("job-agent-command-runtime deps not configured");
  }
  return runtimeDeps;
}

function toRunnerContext(context: TuiContext): RunnerContext {
  return { config: context.config, projectPath: context.projectPath };
}

function getRunnerRuntimeDeps(): RunnerRuntimeDeps {
  return { appendJobLog, rescheduleDurableJobAgents };
}

async function startRunnerForDurableJob(context: TuiContext, job: DurableJobState): Promise<void> {
  await startRunnerForDurableJobImpl(toRunnerContext(context), job, getRunnerRuntimeDeps());
}

function refreshRunnerStatusForJob(context: TuiContext, job: DurableJobState): void {
  refreshRunnerStatusForJobImpl(toRunnerContext(context), job, getRunnerRuntimeDeps());
}

async function stopRunnerForDurableJob(context: TuiContext, job: DurableJobState): Promise<void> {
  await stopRunnerForDurableJobImpl(toRunnerContext(context), job, getRunnerRuntimeDeps());
}

export async function handleBackgroundCommand(
  _args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  await hydrateDurableJobBackgroundTasks(context);
  deps().refreshBackgroundLifecycle(context);
  // D.13Q-UX Task Surface — ink session 走降噪 CommandPanel；
  // plain TUI / 非交互保留旧 writeLine 行为，避免破坏既有字符串断言。
  if (context.isInkSession) {
    const isEn = context.language === "en-US";
    const total = context.backgroundTasks.length;
    if (total === 0) {
      showCommandPanel(context, output, {
        title: "/background",
        tone: "neutral",
        summary: [isEn ? "No background tasks." : "没有后台任务。"],
      });
      return;
    }
    const running = context.backgroundTasks.filter((t) => t.status === "running").length;
    const failed = context.backgroundTasks.filter((t) => t.status === "failed").length;
    const completed = context.backgroundTasks.filter((t) => t.status === "completed").length;
    const summary: string[] = [
      isEn
        ? `Background · ${total} total · ${running} running · ${failed} failed · ${completed} done`
        : `后台 · 共 ${total} · 运行中 ${running} · 失败 ${failed} · 已完成 ${completed}`,
    ];
    const sections = [
      {
        title: isEn ? "Tasks" : "任务",
        rows: context.backgroundTasks.slice(0, 8).map((t) => `${t.title} · ${t.status}`),
      },
    ];
    const detailsText = context.backgroundTasks
      .map((task) => formatBackgroundTask(task, context.language))
      .join("\n\n");
    showCommandPanel(context, output, {
      title: "/background",
      tone: failed > 0 ? "warning" : "neutral",
      summary,
      sections,
      actions: failed > 0 ? ["/job logs <id>"] : [],
      detailsText,
    });
    return;
  }
  if (context.backgroundTasks.length === 0) {
    writeLine(output, context.language === "en-US" ? "No background tasks." : "没有后台任务。");
    return;
  }
  for (const task of context.backgroundTasks) {
    writeLine(output, formatBackgroundTask(task, context.language));
  }
}

export async function handleJobCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0] ?? "list";
  await hydrateDurableJobBackgroundTasks(context);
  if (action === "list") {
    const jobs = await listDurableJobs(context);
    // D.13Q-UX Task Surface — /job list 默认走降噪 CommandPanel。
    const isEn = context.language === "en-US";
    const total = jobs.length;
    const running = jobs.filter((j) => j.status === "running").length;
    const failed = jobs.filter((j) => j.status === "failed").length;
    if (total === 0) {
      showCommandPanel(context, output, {
        title: "/job",
        tone: "neutral",
        summary: [isEn ? "No jobs." : "没有 job。"],
        actions: ["/job run <goal>"],
      });
      return;
    }
    showCommandPanel(context, output, {
      title: "/job",
      tone: failed > 0 ? "warning" : "neutral",
      summary: [
        isEn
          ? `Jobs · ${total} total · ${running} running · ${failed} failed`
          : `Job · 共 ${total} · 运行中 ${running} · 失败 ${failed}`,
      ],
      sections: [
        {
          title: isEn ? "Recent" : "最近",
          rows: jobs.slice(0, 8).map((j) => `${j.id} · ${j.status}`),
        },
      ],
      actions: ["/job status <id>", "/job logs <id>"],
      detailsText: formatJobList(jobs, context),
    });
    return;
  }
  if (action === "run" || action === "create" || action === "new") {
    const options = parseJobRunOptions(args.slice(1));
    if (!options.goal) {
      writeLine(
        output,
        "用法：/job run <goal> [--phase <phase>] [--target <target>] [--agents <n>] [--tokens <n>] [--max-steps <n>] [--timeout <ms>] [--allow-edit] [--allow-bash] [--multi-agent]",
      );
      return;
    }
    const start = action === "run";
    const job = await createDurableJob(context, options, start);
    if (start && job.status === "running") {
      await startRunnerForDurableJob(context, job);
    }
    await persistDurableJob(job);
    await appendJobLog(
      job,
      `job ${action}: ${job.status}; pauseReason=${job.pauseReason ?? "none"}`,
    );
    await writeDurableJobReport(job);
    const background = upsertJobBackgroundTask(context, job);
    await deps().appendBackgroundTaskEvent(
      context,
      await deps().ensureSession(context),
      background,
    );
    if (start && job.status === "running") {
      await runDurableJobLiteTick(context, job);
    }
    writeLine(output, formatJobPrimary(job, context));
    return;
  }
  if (["status", "report", "logs", "pause", "resume", "cancel"].includes(action)) {
    const job = await findDurableJob(context, args[1]);
    if (!job) {
      writeLine(output, "未找到 job。用法：/job status|report|logs|pause|resume|cancel <id>");
      return;
    }
    if (action === "status") {
      refreshRunnerStatusForJob(context, job);
      await persistDurableJob(job);
      await writeDurableJobReport(job);
      upsertJobBackgroundTask(context, job);
      // D.14D-E — /job status 走降噪 CommandPanel：完整状态进 detailsText。
      showCommandPanel(context, output, {
        title: "/job status",
        tone: "neutral",
        summary: [
          context.language === "en-US"
            ? `Job ${job.id} · ${job.status} — Ctrl+O for details.`
            : `Job ${job.id} · ${job.status} — Ctrl+O 查看详情。`,
        ],
        detailsText: formatJobStatus(job),
      });
      return;
    }
    if (action === "report") {
      refreshRunnerStatusForJob(context, job);
      await persistDurableJob(job);
      await writeDurableJobReport(job);
      upsertJobBackgroundTask(context, job);
      // D.14D-E — /job report 走降噪 CommandPanel：完整报告进 detailsText。
      showCommandPanel(context, output, {
        title: "/job report",
        tone: "neutral",
        summary: [
          context.language === "en-US"
            ? `Job ${job.id} report — Ctrl+O for details.`
            : `Job ${job.id} 报告 — Ctrl+O 查看详情。`,
        ],
        detailsText: formatJobReport(job),
      });
      return;
    }
    if (action === "logs") {
      // D.14D-E — /job logs 走降噪 CommandPanel：完整日志尾部进 detailsText。
      showCommandPanel(context, output, {
        title: "/job logs",
        tone: "neutral",
        summary: [
          context.language === "en-US"
            ? `Job ${job.id} logs — Ctrl+O for details.`
            : `Job ${job.id} 日志 — Ctrl+O 查看详情。`,
        ],
        detailsText: await formatJobLogs(job),
      });
      return;
    }
    if (action === "pause") {
      await transitionDurableJob(job, context, "sleeping", "user_paused");
      writeLine(output, formatJobPrimary(job, context));
      return;
    }
    if (action === "resume") {
      await resumeDurableJob(job, context);
      writeLine(output, formatJobPrimary(job, context));
      return;
    }
    if (job.runner) {
      await stopRunnerForDurableJob(context, job);
    }
    await transitionDurableJob(job, context, "cancelled", "user_cancelled");
    writeLine(output, formatJobPrimary(job, context));
    return;
  }
  writeLine(
    output,
    "用法：/job list | /job run <goal> | /job create <goal> | /job status <id> | /job logs <id> | /job report <id> | /job pause <id> | /job resume <id> | /job cancel <id>",
  );
}

export async function createDurableJob(
  context: TuiContext,
  options: ParsedJobRunOptions,
  start: boolean,
): Promise<DurableJobState> {
  const now = new Date().toISOString();
  const id = `job-${randomUUID().slice(0, 8)}`;
  const paths = getDurableJobPaths(context, id);
  const handoffPacket = await loadOrCreateHandoffPacket(
    context,
    await deps().ensureSession(context),
  );
  const missing = validateHandoffPacket(handoffPacket);
  const resourceGuard = start
    ? (deps().checkResourceGuard(context, "model") ??
      deps().checkBackgroundStartGuard(context, "job", true))
    : null;
  const runningCap = DEFAULT_JOB_RUNNING_AGENT_CAP;
  const status: DurableJobStatus = !start
    ? "created"
    : missing.length > 0
      ? "blocked"
      : resourceGuard
        ? "sleeping"
        : "running";
  const pauseReason =
    missing.length > 0
      ? `needs_handoff_repair:${missing.join(",")}`
      : resourceGuard
        ? `resource_guard:${resourceGuard}`
        : undefined;
  const agents = createDurableJobAgents(options, status, runningCap);
  return {
    id,
    goal: options.goal,
    projectPath: context.projectPath,
    phase: options.phase,
    target: options.target,
    plan: options.plan,
    budget: {
      maxTokens: options.maxTokens,
      maxRunningAgents: runningCap,
      maxSteps: options.maxSteps,
      note: `${runningCap} running agents is the default cap; ${JOB_AGENT_HIGH_CONFIG_CANDIDATE} is benchmark/high-config candidate only, not default.`,
      usedTokens: 0,
      remainingTokens: options.maxTokens,
      usedSteps: 0,
      maxRuntimeMs: options.timeoutMs,
      explicit: { ...options.budgetExplicit },
    },
    timeoutMs: options.timeoutMs,
    permissionPolicy: context.permissionMode,
    allowEdit: options.allowEdit,
    allowBash: options.allowBash,
    allowMultiAgent: options.allowMultiAgent,
    status,
    pauseReason,
    agents,
    handoffPacket,
    createdAt: now,
    updatedAt: now,
    startedAt: start && status === "running" ? now : undefined,
    ownerSessionId: start && status === "running" ? await deps().ensureSession(context) : undefined,
    ownerPid: start && status === "running" ? process.pid : undefined,
    heartbeatAt: start && status === "running" ? now : undefined,
    worker: { status: "not_started", summary: "Lite worker has not run yet." },
    logPath: paths.logPath,
    reportPath: paths.reportPath,
    fullOutputPath: paths.fullOutputPath,
    evidenceRefs: context.evidence
      .map((item) => ({ id: item.id, kind: item.kind, source: item.source, summary: item.summary }))
      .slice(0, 8),
    verification: { status: "not_run", summary: "not run in Phase 17A Lite job loop" },
    adoptedConclusions: [],
    rejectedConclusions:
      status === "blocked" || status === "sleeping"
        ? ["No PASS evidence is generated for blocked/sleeping jobs."]
        : [],
  };
}

export async function resumeDurableJob(job: DurableJobState, context: TuiContext): Promise<void> {
  if (
    job.status === "cancelled" ||
    job.status === "timeout" ||
    job.status === "failed" ||
    job.status === "completed"
  ) {
    job.result = {
      status: job.status === "timeout" ? "timeout" : job.status === "failed" ? "failed" : "blocked",
      summary: `Resume refused for terminal ${job.status} job; no PASS evidence generated.`,
      facts: [`terminalStatus=${job.status}`, job.pauseReason ?? "no pause reason"],
      evidenceRefs: job.evidenceRefs.map((item) => item.id),
      generatedAt: new Date().toISOString(),
    };
    job.rejectedConclusions = [
      ...job.rejectedConclusions,
      `Terminal ${job.status} job was not upgraded by resume and is not PASS evidence.`,
    ];
    await persistDurableJobProgress(
      context,
      job,
      `resume refused for terminal status ${job.status}`,
    );
    return;
  }
  const missing = job.handoffPacket ? validateHandoffPacket(job.handoffPacket) : ["handoffPacket"];
  if (missing.length > 0) {
    await transitionDurableJob(
      job,
      context,
      "blocked",
      `needs_handoff_repair:${missing.join(",")}`,
    );
    return;
  }
  const resourceGuard =
    deps().checkResourceGuard(context, "model") ??
    deps().checkBackgroundStartGuard(context, "job", true, job.id);
  if (resourceGuard) {
    await transitionDurableJob(job, context, "sleeping", `resource_guard:${resourceGuard}`);
    return;
  }
  await transitionDurableJob(job, context, "running");
  if (job.status === "running") {
    await startRunnerForDurableJob(context, job);
    await persistDurableJob(job);
    await writeDurableJobReport(job);
    upsertJobBackgroundTask(context, job);
  }
  await runDurableJobLiteTick(context, job);
}

export async function transitionDurableJob(
  job: DurableJobState,
  context: TuiContext,
  status: DurableJobStatus,
  pauseReason?: string,
): Promise<void> {
  const now = new Date().toISOString();
  job.status = status;
  job.pauseReason = pauseReason;
  job.updatedAt = now;
  if (status === "running") {
    job.startedAt ??= now;
    job.ownerSessionId = await deps().ensureSession(context);
    job.ownerPid = process.pid;
    job.heartbeatAt = now;
  }
  if (
    status === "cancelled" ||
    status === "completed" ||
    status === "failed" ||
    status === "stale" ||
    status === "timeout"
  ) {
    job.endedAt = now;
  }
  if (status === "cancelled" || status === "failed" || status === "stale" || status === "timeout") {
    job.result = {
      status,
      summary: `Durable job moved to ${status}; no PASS evidence generated.`,
      facts: [pauseReason ?? "no pause reason", formatJobRunnerInline(job)],
      evidenceRefs: job.evidenceRefs.map((item) => item.id),
      generatedAt: now,
    };
  }
  rescheduleDurableJobAgents(job);
  await appendJobLog(job, `job transition: ${status}; pauseReason=${pauseReason ?? "none"}`);
  await persistDurableJob(job);
  await writeDurableJobReport(job);
  const background = upsertJobBackgroundTask(context, job);
  await deps().appendBackgroundTaskEvent(context, await deps().ensureSession(context), background);
}

export async function hydrateDurableJobBackgroundTasks(context: TuiContext): Promise<void> {
  const jobs = await listDurableJobs(context);
  for (const job of jobs) {
    const recovered = await recoverDurableJobForContext(context, job);
    upsertJobBackgroundTask(context, recovered);
  }
}

export async function recoverDurableJobForContext(
  context: TuiContext,
  job: DurableJobState,
): Promise<DurableJobState> {
  const recoverableStatuses: DurableJobStatus[] = ["running", "sleeping", "blocked", "stale"];
  if (!recoverableStatuses.includes(job.status)) {
    return job;
  }
  const originalStatus = job.status;
  const missing = job.handoffPacket ? validateHandoffPacket(job.handoffPacket) : ["handoffPacket"];
  if (missing.length > 0) {
    job.status = "blocked";
    job.pauseReason = `needs_handoff_repair:${missing.join(",")}`;
  } else if (
    originalStatus === "running" &&
    (!job.ownerSessionId || !job.ownerPid || !job.heartbeatAt)
  ) {
    job.status = "stale";
    job.pauseReason = "recovered_without_owner_or_heartbeat";
  } else if (originalStatus === "running") {
    const heartbeatAge = Date.now() - Date.parse(job.heartbeatAt ?? "");
    if (Number.isNaN(heartbeatAge) || heartbeatAge > JOB_RECOVERY_HEARTBEAT_STALE_MS) {
      job.status = "stale";
      job.pauseReason = "recovered_stale_heartbeat";
    }
  }
  if (job.status === originalStatus && originalStatus !== "stale") {
    return job;
  }
  if (job.runner && job.status === "stale") {
    await stopRunnerForDurableJob(context, job);
    markJobRunnerTerminal(job, "stale", job.pauseReason ?? "recovered stale job");
  }
  const now = new Date().toISOString();
  job.updatedAt = now;
  job.endedAt = job.status === "stale" ? now : job.endedAt;
  job.result = {
    status: job.status === "blocked" ? "blocked" : "stale",
    summary: `Recovered job moved to ${job.status}; no PASS evidence generated.`,
    facts: ["startup recovery", job.pauseReason ?? "no pause reason"],
    evidenceRefs: job.evidenceRefs.map((item) => item.id),
    generatedAt: now,
  };
  job.rejectedConclusions = [
    ...job.rejectedConclusions,
    `Recovered ${job.status} job is conservative and not PASS evidence.`,
  ];
  rescheduleDurableJobAgents(job);
  await appendJobLog(job, `job recovery: ${job.status}; pauseReason=${job.pauseReason ?? "none"}`);
  await persistDurableJob(job);
  await writeDurableJobReport(job);
  return job;
}

export async function runDurableJobLiteTick(
  context: TuiContext,
  job: DurableJobState,
): Promise<void> {
  if (job.status !== "running") {
    return;
  }
  const budgetStop = await applyDurableJobBudgetStop(context, job, "before_worker_loop");
  if (budgetStop) {
    return;
  }
  const startedAt = new Date().toISOString();
  const workerSession = await context.store.create({
    model: context.model,
    summary: `job-worker:${job.id}:${truncateDisplay(job.goal, 40)}`,
  });
  job.worker = {
    sessionId: workerSession.id,
    status: "running",
    startedAt,
    currentStep: job.budget.usedSteps ?? 0,
    completedSteps: job.budget.usedSteps ?? 0,
    summary: "Bounded local worker loop is running with trimmed refs only.",
  };
  await persistDurableJobProgress(context, job, "worker loop started");

  while (job.status === "running" && (job.budget.usedSteps ?? 0) < job.plan.length) {
    const stepIndex = job.budget.usedSteps ?? 0;
    // P1-5 — maxSteps 预算只在用户显式设置（--max-steps）时强制；默认无用户可见
    // 预算（默认 maxSteps 等于 plan 步数，while 条件自然终止，不走该 blocked 分支）。
    if (job.budget.explicit?.steps === true && stepIndex >= getDurableJobMaxSteps(job)) {
      job.result = {
        status: "blocked",
        summary: "Durable worker stopped at maxSteps; no PASS evidence generated.",
        facts: [`maxSteps=${getDurableJobMaxSteps(job)}`, `plannedSteps=${job.plan.length}`],
        evidenceRefs: job.evidenceRefs.map((item) => item.id),
        generatedAt: new Date().toISOString(),
      };
      job.worker = {
        ...job.worker,
        status: "blocked",
        endedAt: job.result.generatedAt,
        summary: job.result.summary,
      };
      await transitionDurableJob(
        job,
        context,
        "blocked",
        `max_steps_reached:${getDurableJobMaxSteps(job)}`,
      );
      return;
    }

    const stop = await applyDurableJobBudgetStop(context, job, `before_step_${stepIndex + 1}`);
    if (stop) {
      return;
    }

    const stepFacts = createDurableJobStepFacts(context, job, stepIndex);
    const summary = [
      `Phase 17A bounded worker step ${stepIndex + 1}/${job.plan.length}: ${job.plan[stepIndex]}.`,
      "Input boundary: trimmed handoff/project facts/evidence refs/workspace cache/index status only.",
      `Permissions: allowEdit=${job.allowEdit}; allowBash=${job.allowBash}; no write/Bash/network action is executed by this local worker loop.`,
      "No full transcript/source/index/log output was injected.",
    ].join(" ");
    const estimatedTokens = estimateJobTokens(`${summary}\n${stepFacts.join("\n")}`);
    // P1-5 — token 预算只在用户显式设置（--tokens）时强制；默认无用户可见预算。
    if (
      job.budget.explicit?.tokens === true &&
      (job.budget.usedTokens ?? 0) + estimatedTokens > job.budget.maxTokens
    ) {
      job.result = {
        status: "overbudget",
        summary:
          "Durable worker stopped before the next step because maxTokens would be exceeded; no PASS evidence generated.",
        facts: stepFacts,
        evidenceRefs: job.evidenceRefs.map((item) => item.id),
        generatedAt: new Date().toISOString(),
      };
      job.worker = {
        ...job.worker,
        status: "blocked",
        currentStep: stepIndex + 1,
        completedSteps: stepIndex,
        endedAt: job.result.generatedAt,
        summary: job.result.summary,
      };
      await transitionDurableJob(
        job,
        context,
        "blocked",
        `budget_exceeded:maxTokens=${job.budget.maxTokens}`,
      );
      return;
    }

    const now = new Date().toISOString();
    job.budget.usedTokens = (job.budget.usedTokens ?? 0) + estimatedTokens;
    job.budget.remainingTokens = Math.max(0, job.budget.maxTokens - job.budget.usedTokens);
    job.budget.usedSteps = stepIndex + 1;
    job.worker = {
      ...job.worker,
      status: "running",
      currentStep: stepIndex + 1,
      completedSteps: stepIndex + 1,
      summary,
    };
    job.result = {
      status: "partial",
      summary,
      facts: stepFacts,
      evidenceRefs: job.evidenceRefs.map((item) => item.id),
      generatedAt: now,
    };
    job.verification = {
      status: "partial",
      summary: "Bounded worker output is structured but not verification PASS.",
    };
    job.heartbeatAt = now;
    job.updatedAt = now;
    await context.store.appendEvent(workerSession.id, {
      type: "system_event",
      id: randomUUID(),
      level: "info",
      message: `${summary} facts=${stepFacts.join(" | ")}`,
      createdAt: now,
    });
    await appendJobLog(
      job,
      `worker step ${stepIndex + 1}/${job.plan.length}: tokens=${estimatedTokens}; refs=${stepFacts.join(" | ")}`,
    );
    await persistDurableJobProgress(context, job, `worker step ${stepIndex + 1} persisted`);

    const afterStop = await applyDurableJobBudgetStop(context, job, `after_step_${stepIndex + 1}`);
    if (afterStop) {
      return;
    }
  }

  if (job.status !== "running") {
    return;
  }
  const endedAt = new Date().toISOString();
  job.worker = {
    ...job.worker,
    status: "completed",
    endedAt,
    currentStep: job.budget.usedSteps ?? job.plan.length,
    completedSteps: job.budget.usedSteps ?? job.plan.length,
    summary:
      "Phase 17A bounded worker loop completed local read-only task graph steps; verification is still partial.",
  };
  job.result = {
    status: "partial",
    summary: job.worker.summary,
    facts: createDurableJobStepFacts(context, job, Math.max(0, (job.budget.usedSteps ?? 1) - 1)),
    evidenceRefs: job.evidenceRefs.map((item) => item.id),
    generatedAt: endedAt,
  };
  job.verification = {
    status: "partial",
    summary: "Worker loop completion is not verification PASS and not smoke-ready proof.",
  };
  job.status = "completed";
  job.pauseReason = undefined;
  job.endedAt = endedAt;
  job.heartbeatAt = endedAt;
  job.updatedAt = endedAt;
  job.adoptedConclusions = [
    ...job.adoptedConclusions,
    "Bounded worker loop produced read-only structured results from trimmed refs.",
  ];
  job.rejectedConclusions = [
    ...job.rejectedConclusions,
    "Completed job lifecycle only means the bounded worker loop ended; it is not PASS evidence, not Beta readiness, and not smoke-ready proof.",
  ];
  rescheduleDurableJobAgents(job);
  await appendJobLog(job, `worker loop completed: session=${workerSession.id}`);
  await persistDurableJobProgress(context, job, "worker loop completed without verification PASS");
}

export async function persistDurableJobProgress(
  context: TuiContext,
  job: DurableJobState,
  message: string,
): Promise<void> {
  await appendJobLog(job, message);
  await persistDurableJob(job);
  await writeDurableJobReport(job);
  const background = upsertJobBackgroundTask(context, job);
  await deps().appendBackgroundTaskEvent(context, await deps().ensureSession(context), background);
}

export function createDurableJobStepFacts(
  context: TuiContext,
  job: DurableJobState,
  stepIndex: number,
): string[] {
  const workspaceRef = context.cache.workspaceReference.latest;
  const workspaceSnapshot = workspaceRef?.workspaceSnapshot;
  // D.13V — fallback snapshot 在 step facts 中显式标 "stale-fallback"，不让
  // 模型把上次成功的旧数据当 confirmed current fact。
  const snapshotState = !workspaceSnapshot
    ? "missing"
    : isFallbackWorkspaceReferenceSnapshot(workspaceRef)
      ? "stale-fallback"
      : "ready";
  return [
    `step=${stepIndex + 1}/${job.plan.length}`,
    `goal=${truncateDisplay(job.goal, 120)}`,
    `phase=${job.phase}`,
    `target=${job.target}`,
    `handoff=${job.handoffPacket?.id ?? "missing"}`,
    `index=${context.index.status}${context.index.projectName ? `:${context.index.projectName}` : ""}`,
    `workspaceCache=${workspaceRef?.source ?? "missing"};snapshot=${snapshotState}`,
    `evidenceRefs=${job.evidenceRefs.map((item) => item.id).join(",") || "none"}`,
    `agents=${job.agents.filter((agent) => agent.status === "running").length}/${job.agents.length}`,
    `logs=${job.logPath};report=${job.reportPath}`,
  ];
}

export async function applyDurableJobBudgetStop(
  context: TuiContext,
  job: DurableJobState,
  phase: string,
): Promise<boolean> {
  const started = Date.parse(job.startedAt ?? job.createdAt);
  const runtimeMs = Number.isNaN(started) ? 0 : Date.now() - started;
  const maxRuntimeMs = job.budget.maxRuntimeMs ?? job.timeoutMs;
  // P1-5 — runtime/timeout 预算只在用户显式设置（--timeout/--max-runtime-ms）时强制。
  if (job.budget.explicit?.runtime === true && runtimeMs > maxRuntimeMs) {
    await transitionDurableJob(
      job,
      context,
      "timeout",
      `timeout:${phase}:${runtimeMs}/${maxRuntimeMs}`,
    );
    job.result = {
      status: "timeout",
      summary: "Durable job exceeded maxRuntime/timeout; no PASS evidence generated.",
      facts: [`runtimeMs=${runtimeMs}`, `maxRuntimeMs=${maxRuntimeMs}`],
      evidenceRefs: job.evidenceRefs.map((item) => item.id),
      generatedAt: new Date().toISOString(),
    };
    await persistDurableJob(job);
    await writeDurableJobReport(job);
    return true;
  }
  if (job.budget.explicit?.tokens === true && (job.budget.usedTokens ?? 0) > job.budget.maxTokens) {
    await transitionDurableJob(job, context, "blocked", `budget_exceeded:${phase}`);
    return true;
  }
  return false;
}

// Module 5 — formatEvidenceDetails / parseLogArtifactRequest /
// readPositiveIntegerArg / createLogArtifactRegistry 实现见
// ./tui-details-runtime.ts；下方 export+import 块将其引回 index.ts。

export async function handleAgentsCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0] ?? "list";
  if (action === "list") {
    // D.14D-E — /agents 走降噪 CommandPanel：完整 agent 列表进 detailsText。
    const isEn = context.language === "en-US";
    const total = context.agents.length;
    const running = context.agents.filter((a) => a.status === "running").length;
    showCommandPanel(context, output, {
      title: "/agents",
      tone: "neutral",
      summary: [
        isEn
          ? `Agents · ${total} total · ${running} running — Ctrl+O for details.`
          : `Agents · 共 ${total} · 运行中 ${running} — Ctrl+O 查看详情。`,
      ],
      actions:
        total > 0
          ? ["/agents show <id>", "/agents cancel <id>"]
          : ["/fork explorer|planner|verifier|worker <task>"],
      detailsText: formatAgentsList(context),
    });
    return;
  }
  if (action === "show") {
    const agent = findAgent(context, args[1]);
    if (!agent) {
      writeLine(output, "未找到 agent。");
      return;
    }
    // D.14D-E — /agents show 走降噪 CommandPanel：完整 agent 详情进 detailsText。
    showCommandPanel(context, output, {
      title: "/agents show",
      tone: "neutral",
      summary: [
        context.language === "en-US"
          ? `Agent ${agent.id} · ${agent.status} — Ctrl+O for details.`
          : `Agent ${agent.id} · ${agent.status} — Ctrl+O 查看详情。`,
      ],
      detailsText: formatAgentDetails(agent, context),
    });
    return;
  }
  if (action === "cancel" || action === "interrupt") {
    const agent = findAgent(context, args[1]);
    if (!agent) {
      writeLine(output, "未找到 agent。");
      return;
    }
    await cancelAgent(agent, context, output);
    return;
  }
  writeLine(output, "用法：/agents | /agents show <id> | /agents cancel <id>");
}

export async function handleForkCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const type = args[0] as AgentType | undefined;
  const task = args.slice(1).join(" ").trim();
  if (!type || !isAgentType(type) || !task) {
    writeLine(output, "用法：/fork explorer|planner|verifier|worker <task>");
    return;
  }
  const guard = deps().checkBackgroundStartGuard(context, "agent", true);
  if (guard) {
    writeLine(output, guard);
    return;
  }
  const runningCount = context.agents.filter((agent) => agent.status === "running").length;
  if (runningCount >= DEFAULT_JOB_RUNNING_AGENT_CAP) {
    writeLine(
      output,
      `最多同时运行 ${DEFAULT_JOB_RUNNING_AGENT_CAP} 个 agent；请先 /agents cancel <id> 或等待完成。`,
    );
    return;
  }

  const parentSessionId = await deps().ensureSession(context);
  const packet = await loadOrCreateHandoffPacket(context, parentSessionId);
  const role = getAgentRole(type);
  const resolved = resolveRoleRoute(context, role, `/fork ${type}`);
  await deps().appendRouteDecisionEvent(context, parentSessionId, resolved.decision);
  if (!resolved.usable) {
    writeLine(output, formatRoutePauseMessage(role, resolved.decision));
    return;
  }
  const route = resolved.route;
  const child = await context.store.create({
    model: route.primaryModel || context.model,
    summary: `agent:${type}:${truncateDisplay(task, 60)}`,
  });
  const now = new Date().toISOString();
  const agent: AgentRun = {
    id: `agent-${randomUUID().slice(0, 8)}`,
    type,
    displayName: deriveAgentDisplayName(type, task),
    role,
    provider: route.provider || "unconfigured",
    parentSessionId,
    forkedFrom: packet.id,
    task,
    model: route.primaryModel || context.model,
    permissionMode: getAgentPermissionMode(type, context.permissionMode),
    status: "running",
    transcriptPath: child.transcriptPath,
    transcriptSessionId: child.id,
    summary: "agent running",
    contextSummary: createAgentContextSummary(packet, task, context),
    cost: createEmptyAgentCost(task),
    startedAt: now,
    updatedAt: now,
  };
  context.agents.unshift(agent);
  context.agents = context.agents.slice(0, MAX_AGENTS);
  const background = createAgentBackgroundTask(agent, context);
  rememberBackgroundTask(context, background);
  await context.store.appendEvent(parentSessionId, { type: "agent_start", agent, createdAt: now });
  await context.store.appendEvent(child.id, {
    type: "system_event",
    id: randomUUID(),
    level: "info",
    message: agent.contextSummary,
    createdAt: now,
  });
  await deps().appendBackgroundTaskEvent(context, parentSessionId, background);
  writeLine(output, formatBackgroundTask(background, context.language));

  if (task.includes("--background")) {
    writeLine(
      output,
      context.language === "en-US"
        ? "Background agent execution is not available in this runtime; running synchronously instead so no fake running state is created."
        : "当前 runtime 不支持真实后台 agent 执行；已降级为同步执行，避免生成假的 running 状态。",
    );
  }

  await completeAgent(agent, background, context, output);
}

export async function completeAgent(
  agent: AgentRun,
  task: BackgroundTaskState,
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const parentSessionId = agent.parentSessionId ?? (await deps().ensureSession(context));
  let summary: string;
  try {
    summary = await runAgentWork(agent, context, output);
  } catch (error) {
    await failAgent(agent, task, context, output, parentSessionId, error);
    return;
  }
  const now = new Date().toISOString();
  agent.status = "completed";
  agent.summary = summary;
  agent.updatedAt = now;
  agent.cost.outputTokens = Math.ceil(summary.length / 4);
  deps().addRoleUsage(
    context,
    agent.role,
    {
      ...getRoleRoute(context.config, agent.role),
      provider: agent.provider,
      primaryModel: agent.model,
    },
    agent.cost.inputTokens,
    agent.cost.outputTokens,
    `${agent.type} agent summary`,
  );
  context.roleHandoffs.unshift(
    deps().createRoleHandoff("executor", agent.role, agent.id, summary, context),
  );
  const verifierStatus = agent.type === "verifier" ? context.lastVerification?.status : undefined;
  task.status = "completed";
  task.result = mapAgentBackgroundResult(agent, verifierStatus);
  task.currentStep = context.language === "en-US" ? "summary ready" : "摘要已生成";
  task.progress = { completed: 1, total: 1, label: agent.type };
  task.updatedAt = now;
  task.lastOutputAt = now;
  task.nextAction =
    context.language === "en-US" ? "Review /agents show output." : "查看 /agents show 输出。";
  await context.store.appendEvent(agent.transcriptSessionId, {
    type: "assistant_text_delta",
    id: randomUUID(),
    text: summary,
    createdAt: now,
  });
  await context.store.appendEvent(parentSessionId, {
    type: "agent_end",
    agentId: agent.id,
    status: "completed",
    summary,
    createdAt: now,
  });
  await deps().appendBackgroundTaskEvent(context, parentSessionId, task);
  writeLine(output, formatAgentSummary(agent, context));
  deps().writeStatus(output, context);
}

// D.14C — agent 真实执行异常（非用户取消、非权限拒绝）才走这里。把 agent/task
// 标记 failed，记 agent_end(failed)，并搭车进 D.14B failure learning。用户取消由
// cancelAgent 处理（status=cancelled，不调用本函数）；worker 权限拒绝由
// runWorkerAgent 返回普通 summary 字符串（不抛异常），也不会进这里。
async function failAgent(
  agent: AgentRun,
  task: BackgroundTaskState,
  context: TuiContext,
  output: Writable,
  parentSessionId: string,
  error: unknown,
): Promise<void> {
  const now = new Date().toISOString();
  const message = error instanceof Error ? error.message : String(error);
  agent.status = "failed";
  agent.summary = `agent ${agent.id} 执行失败：${truncateDisplay(message, 160)}`;
  agent.updatedAt = now;
  task.status = "failed";
  task.result = "fail";
  task.currentStep = context.language === "en-US" ? "failed" : "已失败";
  task.updatedAt = now;
  task.lastOutputAt = now;
  task.nextAction =
    context.language === "en-US"
      ? "Inspect /agents show output and retry if needed."
      : "查看 /agents show 输出，必要时重试。";
  await context.store.appendEvent(parentSessionId, {
    type: "agent_end",
    agentId: agent.id,
    status: "failed",
    summary: agent.summary,
    createdAt: now,
  });
  await deps().appendBackgroundTaskEvent(context, parentSessionId, task);
  // 真实失败搭车进 D.14B；失败摘要交给 captureFailureLearning 内部脱敏，只当风险提示，
  // 不进 context.evidence，不污染 D.13U/D.13V final answer gate。
  await deps().captureFailureLearning(context, parentSessionId, {
    category: "tool_failure",
    failureSummary: `agent ${agent.type} execution threw: ${message}`,
    rootCauseGuess: `agent ${agent.type} work failed before producing a summary`,
    avoidNextTime: `Check the ${agent.type} agent task and inputs before re-running; do not assume the agent succeeded`,
    sourceRef: `agent:${agent.id}`,
    relatedTarget: `agent_${agent.type}`,
    severity: "medium",
  });
  writeLine(output, agent.summary);
  deps().writeStatus(output, context);
}

export async function runAgentWork(
  agent: AgentRun,
  context: TuiContext,
  output: Writable,
): Promise<string> {
  if (agent.type === "explorer") {
    return `explorer 摘要：只读分析任务「${agent.task}」。可读取索引/证据/关键文件；不会写入。上下文已裁剪为 handoff、Todo、证据和关键文件。`;
  }
  if (agent.type === "planner") {
    return `planner 摘要：只规划任务「${agent.task}」。输出计划建议，不执行写入、Bash 或后续阶段能力。`;
  }
  if (agent.type === "verifier") {
    const plan = await createVerificationPlan(context.projectPath, "smoke");
    const report = await runVerificationPlan(
      plan,
      context,
      agent.transcriptSessionId,
      output,
      deps().appendBackgroundTaskEvent,
    );
    context.lastVerification = report;
    return `verifier 摘要：session-scoped conservative verification；不是 durable job、不是第二套 job system、不是 Phase 17。已在独立 transcript 中运行验证命令，结果 ${report.status.toUpperCase()}；任务「${agent.task}」。`;
  }
  return runWorkerAgent(agent, context, output);
}

export async function runWorkerAgent(
  agent: AgentRun,
  context: TuiContext,
  output: Writable,
): Promise<string> {
  const match = /^write\s+(\S+)\s+([\s\S]+)$/u.exec(agent.task);
  if (!match) {
    return `worker 摘要：已接收明确子任务「${agent.task}」。worker 可编辑，但本次没有匹配低风险 write 路径，因此未改文件。所有编辑必须走权限管道。`;
  }
  const [, path, content] = match;
  const input = { path, content };
  const parentSessionId = agent.parentSessionId ?? (await deps().ensureSession(context));
  const permission = await decidePermission("Write", input, context, parentSessionId);
  await context.store.appendEvent(parentSessionId, {
    type: "permission_request",
    request: permission.request,
    createdAt: new Date().toISOString(),
  });
  await context.store.appendEvent(parentSessionId, {
    type: "permission_result",
    requestId: permission.request.id,
    decision: permission.decision,
    reason: permission.reason,
    createdAt: new Date().toISOString(),
  });
  if (permission.decision !== "allow") {
    return `worker 摘要：权限管道拒绝写入 ${path}。原因：${permission.reason}`;
  }
  if (permission.preflight) {
    writeLine(output, permission.preflight);
  }
  const result = await runTool("Write", input, context.tools);
  await context.store.appendEvent(agent.transcriptSessionId, {
    type: "tool_call_start",
    id: randomUUID(),
    name: "Write",
    input,
    createdAt: new Date().toISOString(),
  });
  await context.store.appendEvent(
    agent.transcriptSessionId,
    createToolEndEvent(randomUUID(), result.output),
  );
  return `worker 摘要：已通过权限管道执行低风险写入 ${path}。${result.output.text}`;
}

export async function cancelAgent(
  agent: AgentRun,
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const now = new Date().toISOString();
  agent.status = "cancelled";
  agent.summary = `agent ${agent.id} 已取消；主会话可继续。`;
  agent.updatedAt = now;
  const background = context.backgroundTasks.find((task) => task.id === agent.id);
  if (background) {
    background.status = "cancelled";
    background.result = "cancelled";
    background.updatedAt = now;
    background.currentStep = context.language === "en-US" ? "cancelled" : "已取消";
  }
  const parentSessionId = agent.parentSessionId ?? (await deps().ensureSession(context));
  await context.store.appendEvent(parentSessionId, {
    type: "agent_end",
    agentId: agent.id,
    status: "cancelled",
    summary: agent.summary,
    createdAt: now,
  });
  if (background) {
    await deps().appendBackgroundTaskEvent(context, parentSessionId, background);
  }
  writeLine(output, agent.summary);
  deps().writeStatus(output, context);
}

// Module 4 — findAgent moved to ./tui-agent-job-runtime.ts

function formatAgentsList(context: TuiContext): string {
  if (context.agents.length === 0) {
    return context.language === "en-US"
      ? "No agents. Usage: /fork explorer|planner|verifier|worker <task>."
      : "当前没有 agent。用法：/fork explorer|planner|verifier|worker <task>。";
  }
  const lines = [context.language === "en-US" ? "Agents:" : "Agents："];
  for (const agent of context.agents) {
    const label = agent.displayName ?? deriveAgentDisplayName(agent.type, agent.task);
    lines.push(
      `${agent.id}  ${label}  type=${agent.type}  role=${agent.role}  ${agent.status}  mode=${agent.permissionMode}  tokens~${agent.cost.inputTokens + agent.cost.outputTokens}  task=${truncateDisplay(agent.task, 24)}`,
    );
  }
  lines.push(
    context.language === "en-US"
      ? "displayName is cosmetic only; role, permission mode, resource guard, evidence, and lifecycle stay unchanged."
      : "displayName 仅用于展示；role、权限模式、资源守卫、证据和生命周期不变。",
  );
  return lines.join("\n");
}

function createToolEndEvent(id: string, output: ToolOutput): TranscriptEvent {
  return {
    type: "tool_call_end",
    id,
    output,
    createdAt: new Date().toISOString(),
  };
}
