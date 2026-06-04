import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { Writable } from "node:stream";
import { type ModelRole, type RoleModelRoute, resolveStoragePaths } from "@linghun/config";
import type { TranscriptEvent } from "@linghun/core";
import type {
  EndpointProfile,
  ModelGateway,
  ModelMessage,
  ModelToolCall,
} from "@linghun/providers";
import type { ToolName, ToolOutput } from "@linghun/tools";
import { builtInTools, createToolContext, runTool } from "@linghun/tools";
import { showCommandPanel } from "./command-panel-runtime.js";
import type {
  CompactPreflightRuntime,
  ProviderPreflightCompactResult,
} from "./compact-preflight-runtime.js";
import type { FailureLearningInput } from "./failure-learning-runtime.js";
import { createManagedWorktree } from "./git-operation-runtime.js";
import { summarizeWorktreeCreateOutcome } from "./git-tool-runtime.js";
import { loadOrCreateHandoffPacket, validateHandoffPacket } from "./handoff-session-runtime.js";
import { createIndexStatusSnapshot, formatIndexRuntimeRef } from "./index-runtime.js";
import type { TuiContext } from "./index.js";
import {
  formatBackgroundTask,
  formatBackgroundTaskPanelDetails,
  formatBackgroundTaskPanelRow,
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
  getEffectiveAgentCap,
  parseJobRunOptions,
  persistDurableJob,
  rescheduleDurableJobAgents,
  updateDurableJobEffectiveAgentCap,
  writeDurableJobReport,
} from "./job-runtime.js";
import { getRoleRoute } from "./model-doctor-runtime.js";
import { inferProviderForRouteModel } from "./model-doctor-runtime.js";
import { createModelToolDefinitionsForTools } from "./model-loop-runtime.js";
import {
  checkProviderCooldown,
  clearProviderBreaker,
  formatCooldownMessage,
  recordProviderFailure,
} from "./provider-circuit-breaker.js";
import {
  type ProviderFailureKind,
  classifyProviderFailure,
  formatProviderFailureKindLabel,
  formatProviderFallbackAttemptSummary,
} from "./request-lifecycle-presenter.js";
import {
  type RunnerContext,
  type RunnerRuntimeDeps,
  markJobRunnerTerminal,
  refreshRunnerStatusForJob as refreshRunnerStatusForJobImpl,
  startRunnerForDurableJob as startRunnerForDurableJobImpl,
  stopRunnerForDurableJob as stopRunnerForDurableJobImpl,
} from "./runner-runtime.js";
import { LINGHUN_MAX_AGENT_CHILD_TURNS } from "./runtime-budget.js";
import { truncateDisplay, writeLine } from "./startup-runtime.js";
import type { ToolResultBudgetRecord } from "./tool-result-budget.js";
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
  registerBackgroundAbortController,
  rememberBackgroundTask,
  toJobContext,
  upsertJobBackgroundTask,
} from "./tui-agent-job-runtime.js";
import type {
  AgentMailboxMessage,
  AgentRun,
  AgentType,
  BackgroundTaskState,
  DurableJobAgentStatus,
  DurableJobState,
  DurableJobStatus,
  RoleHandoff,
  RoleRouteDecision,
  VerificationReport,
} from "./tui-data-types.js";
import { formatAgentDetails } from "./tui-details-runtime.js";
import { formatRoutePauseMessage, resolveRoleRoute } from "./tui-model-runtime.js";
import { decidePermission } from "./tui-permission-runtime.js";
import { createVerificationPlan, runVerificationPlan } from "./verification-command-runtime.js";
import { isFallbackWorkspaceReferenceSnapshot } from "./workspace-reference-cache.js";

type AgentWorkResult = {
  status: "completed" | "failed" | "blocked";
  summary: string;
  evidenceRefs: string[];
};

const AGENT_MAX_MODEL_TURNS = LINGHUN_MAX_AGENT_CHILD_TURNS;

function getAgentRunsDir(context: TuiContext): string {
  return resolveStoragePaths(context.config, context.projectPath).agentRuns;
}

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
  recordVerificationEvidence: (
    context: TuiContext,
    sessionId: string,
    report: VerificationReport,
  ) => Promise<void>;
  createAgentGatewayContinuation: (
    context: TuiContext,
    agent: AgentRun,
  ) => AgentGatewayContinuation | null;
  recordAgentExecutionEvidence: (
    context: TuiContext,
    sessionId: string,
    agent: AgentRun,
    result: AgentWorkResult,
  ) => Promise<string | undefined>;
  recordToolResultBudgetEvidence: (
    context: TuiContext,
    sessionId: string,
    record: ToolResultBudgetRecord,
  ) => Promise<string | undefined>;
  prepareProviderPreflight: (
    context: TuiContext,
    sessionId: string,
    messages: ModelMessage[],
    runtime: CompactPreflightRuntime,
    trigger: "agent-child",
  ) => Promise<ProviderPreflightCompactResult>;
};

export type AgentGatewayContinuation = {
  gateway: ModelGateway;
  provider: string;
  model: string;
  endpointProfile: EndpointProfile;
  reasoningLevel?: string;
  reasoningSent: boolean;
};

type AgentProviderRuntime = Omit<AgentGatewayContinuation, "gateway">;

type JobPreflightResult = {
  missing: string[];
  generatedEvidenceIds: string[];
  generatedVerification: boolean;
  indexUnknown: boolean;
};

let runtimeDeps: JobAgentCommandRuntimeDeps | undefined;

export function configureJobAgentCommandRuntime(deps: JobAgentCommandRuntimeDeps): void {
  runtimeDeps = deps;
}

function validateJobHandoffPreflight(
  packet: NonNullable<DurableJobState["handoffPacket"]>,
): string[] {
  return validateHandoffPacket(packet).filter((item) => item !== "indexStatus");
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
    const needConfirm = context.backgroundTasks.filter((t) => t.status === "paused").length;
    const failedOrBlocked = context.backgroundTasks.filter(
      (t) => t.status === "failed" || t.status === "timeout" || t.status === "stale",
    ).length;
    const completed = context.backgroundTasks.filter((t) => t.status === "completed").length;
    const summary: string[] = [
      isEn
        ? `Tasks · ${running} running · ${needConfirm} need attention · ${failedOrBlocked} failed/blocked · ${completed} done`
        : `任务 · 运行中 ${running} · 待确认 ${needConfirm} · 失败/阻塞 ${failedOrBlocked} · 已完成 ${completed}`,
    ];
    const sections = buildBackgroundPanelSections(context.backgroundTasks, context.language);
    const detailsText = context.backgroundTasks
      .map((task) => formatBackgroundTaskPanelDetails(task, context.language, context.projectPath))
      .join("\n\n");
    showCommandPanel(context, output, {
      title: "/background",
      tone: failedOrBlocked > 0 ? "warning" : "neutral",
      summary,
      sections,
      actions:
        failedOrBlocked > 0
          ? ["/details background <id>", "/details output <id>"]
          : ["/details background <id>"],
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

function buildBackgroundPanelSections(
  tasks: TuiContext["backgroundTasks"],
  language: TuiContext["language"],
): { title?: string; rows: string[] }[] {
  const isEn = language === "en-US";
  const groups: Array<{ kind: TuiContext["backgroundTasks"][number]["kind"]; title: string }> = [
    { kind: "agent", title: isEn ? "Agent" : "Agent" },
    { kind: "verification", title: isEn ? "Verification" : "Verification" },
    { kind: "bash", title: isEn ? "Bash / job" : "Bash / job" },
    { kind: "job", title: isEn ? "Bash / job" : "Bash / job" },
    { kind: "index", title: isEn ? "Index" : "Index" },
    { kind: "mcp", title: isEn ? "MCP" : "MCP" },
    { kind: "compact", title: isEn ? "Other" : "其他" },
  ];
  const sections: { title?: string; rows: string[] }[] = [];
  const used = new Set<string>();
  for (const group of groups) {
    const grouped = tasks.filter((task) => task.kind === group.kind && !used.has(task.id));
    if (grouped.length === 0) continue;
    for (const task of grouped) used.add(task.id);
    sections.push({
      title: group.title,
      rows: grouped.slice(0, 4).map((task) => formatBackgroundTaskPanelRow(task, language)),
    });
    const hidden = grouped.length - 4;
    if (hidden > 0) {
      sections[sections.length - 1]?.rows.push(
        isEn ? `+${hidden} folded` : `另有 ${hidden} 项已折叠`,
      );
    }
  }
  const other = tasks.filter((task) => !used.has(task.id));
  if (other.length > 0) {
    sections.push({
      title: isEn ? "Other" : "其他",
      rows: other.slice(0, 4).map((task) => formatBackgroundTaskPanelRow(task, language)),
    });
  }
  return sections;
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
      `job ${action}: ${job.status}; pause reason ${job.pauseReason ?? "none"}`,
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
  const preflight = prepareJobPreflight(context, handoffPacket, options);
  const missing = preflight.missing;
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
  const effectiveCap = status === "running" ? resolveEffectiveJobAgentCap(context, runningCap) : 0;
  const capReason = formatInitialJobCapReason(status, {
    pauseReason,
    requestedAgents: options.requestedAgents,
    runningCap,
    preflight,
  });
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
    effectiveAgentCap: effectiveCap,
    capReason,
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

function prepareJobPreflight(
  context: TuiContext,
  handoffPacket: NonNullable<DurableJobState["handoffPacket"]>,
  options: ParsedJobRunOptions,
): JobPreflightResult {
  const generatedEvidenceIds: string[] = [];
  const generatedVerification = ensureMinimalJobVerification(context, options);
  const generatedEvidence = ensureMinimalJobEvidence(context, options, generatedVerification);
  if (generatedEvidence) {
    generatedEvidenceIds.push(generatedEvidence);
  }
  const indexUnknown =
    !handoffPacket.indexStatus.status || handoffPacket.indexStatus.status === "unknown";
  syncJobPreflightPacket(handoffPacket, context, generatedVerification);
  return {
    missing: validateJobHandoffPreflight(handoffPacket),
    generatedEvidenceIds,
    generatedVerification,
    indexUnknown,
  };
}

function ensureMinimalJobVerification(context: TuiContext, options: ParsedJobRunOptions): boolean {
  if (context.lastVerification) return false;
  const now = new Date().toISOString();
  context.lastVerification = {
    id: `job-preflight-${randomUUID().slice(0, 8)}`,
    status: "partial",
    summary:
      "Minimal job preflight snapshot: no verification command has run yet; read-only audit may start, and completion is not PASS evidence.",
    commands: [],
    unverified: ["job preflight generated without running verification commands"],
    risk: [
      context.index.status === "unknown"
        ? "index status unknown; job agents must rely on handoff/evidence/workspace snapshot refs"
        : `index status ${formatIndexRuntimeRef(context.index)}`,
    ],
    startedAt: now,
    endedAt: now,
    durationMs: 0,
    nextAction:
      options.allowEdit || options.allowBash
        ? "run targeted verification before edits"
        : "read-only audit may proceed",
  };
  return true;
}

function ensureMinimalJobEvidence(
  context: TuiContext,
  options: ParsedJobRunOptions,
  generatedVerification: boolean,
): string | undefined {
  if (context.evidence.length > 0) return undefined;
  const id = `job-preflight-${randomUUID().slice(0, 8)}`;
  context.evidence.unshift({
    id,
    kind: "user_provided",
    source: "/job preflight",
    summary: `Minimal job preflight evidence for ${options.allowEdit || options.allowBash ? "bounded job" : "read-only audit"}; index ${formatIndexRuntimeRef(context.index)}.`,
    supportsClaims: ["job-preflight-only"],
    createdAt: new Date().toISOString(),
  });
  return generatedVerification ? `${id}:with_minimal_verification` : id;
}

function syncJobPreflightPacket(
  packet: NonNullable<DurableJobState["handoffPacket"]>,
  context: TuiContext,
  generatedVerification: boolean,
): void {
  packet.verification = context.lastVerification ?? packet.verification;
  packet.evidenceRefs = context.evidence
    .map((item) => ({ id: item.id, kind: item.kind, source: item.source, summary: item.summary }))
    .slice(0, 8);
  packet.indexStatus = createIndexStatusSnapshot(context.index);
  if (generatedVerification) {
    packet.pending = [
      ...packet.pending,
      "Job preflight generated minimal verification snapshot; it is not PASS evidence.",
    ];
  }
}

function formatInitialJobCapReason(
  status: DurableJobStatus,
  input: {
    pauseReason?: string;
    requestedAgents: number;
    runningCap: number;
    preflight: JobPreflightResult;
  },
): string {
  const generated = [
    ...input.preflight.generatedEvidenceIds.map((id) => `generatedEvidence=${id}`),
    input.preflight.generatedVerification ? "generatedVerification=partial" : undefined,
    input.preflight.indexUnknown ? "index=unknown_nonblocking" : undefined,
  ].filter(Boolean);
  if (status === "running") {
    const suffix = generated.length > 0 ? `;${generated.join(";")}` : "";
    return `dynamic cap min(default ${input.runningCap}, requested ${input.requestedAgents})${suffix}`;
  }
  if (input.pauseReason) return input.pauseReason;
  if (status === "created") return "planned_not_started:/job create only";
  return `preflight_blocked:${input.preflight.missing.join(",") || "unknown"}`;
}

function resolveEffectiveJobAgentCap(
  context: TuiContext,
  requestedCap: number,
  ignoreTaskId?: string,
): number {
  const runningAgents = context.backgroundTasks.filter(
    (task) =>
      task.id !== ignoreTaskId && task.kind === "agent" && isActiveBackgroundStatus(task.status),
  ).length;
  return Math.max(0, Math.min(requestedCap, DEFAULT_JOB_RUNNING_AGENT_CAP - runningAgents));
}

function hasRunnableJobAgents(job: DurableJobState): boolean {
  return job.agents.some((agent) => agent.status === "queued" || agent.status === "sleeping");
}

function nextRunnableJobAgent(job: DurableJobState): DurableJobState["agents"][number] | undefined {
  const running = job.agents.filter((agent) => agent.status === "running").length;
  if (running >= getEffectiveAgentCap(job)) {
    return undefined;
  }
  return job.agents.find((agent) => agent.status === "queued" || agent.status === "sleeping");
}

function markUnstartedJobAgents(
  job: DurableJobState,
  status: DurableJobState["agents"][number]["status"],
  reason?: string,
): void {
  for (const agent of job.agents) {
    if (agent.runId || agent.status === "completed" || agent.status === "failed") continue;
    agent.status = status;
    agent.statusReason = reason;
    agent.summary =
      status === "queued" || status === "sleeping"
        ? "not started; remains resumable"
        : `not started; ${status}`;
  }
}

function createDurableJobAgentContextSummary(
  packet: NonNullable<DurableJobState["handoffPacket"]>,
  job: DurableJobState,
  assignment: DurableJobState["agents"][number],
): string {
  const evidence = packet.evidenceRefs.map((item) => `${item.id}:${item.kind}`).slice(0, 8);
  const verification = packet.verification
    ? `${packet.verification.status}:${truncateDisplay(packet.verification.summary, 120)}`
    : "none";
  return [
    "Job agent context package (trimmed)",
    `handoff ${packet.id}`,
    `summary ${truncateDisplay(packet.goal || job.goal, 160)}`,
    `task ${truncateDisplay(assignment.task ?? assignment.goal, 200)}`,
    `evidence ${evidence.join("; ") || "none"}`,
    `diff ${packet.changedFiles.slice(0, 8).join(", ") || "none"}`,
    `verification ${verification}`,
    `key files ${packet.keyFiles.slice(0, 8).join(", ") || "none"}`,
    "not included: full transcript/full source/full index/full memory/raw tool_result",
  ].join(" | ");
}

async function startDurableJobAgentRun(
  context: TuiContext,
  job: DurableJobState,
  assignment: DurableJobState["agents"][number],
  output: Writable,
): Promise<AgentRun> {
  const parentSessionId = await deps().ensureSession(context);
  const role = getAgentRole(assignment.type);
  const resolved = resolveRoleRoute(context, role, `/job ${job.id} ${assignment.type}`);
  await deps().appendRouteDecisionEvent(context, parentSessionId, resolved.decision);
  const now = new Date().toISOString();
  const task = assignment.task ?? assignment.goal;
  const effectiveModel = resolved.route.primaryModel ?? context.model;
  const child = await context.store.create({
    model: effectiveModel,
    summary: `job-agent:${job.id}:${assignment.type}:${truncateDisplay(task, 40)}`,
  });
  const packet = job.handoffPacket ?? (await loadOrCreateHandoffPacket(context, parentSessionId));
  const agent: AgentRun = {
    id: `agent-${randomUUID().slice(0, 8)}`,
    type: assignment.type,
    displayName: assignment.displayName,
    role,
    provider: resolved.route.provider || "unconfigured",
    parentSessionId,
    forkedFrom: packet.id,
    task,
    model: effectiveModel,
    permissionMode: getAgentPermissionMode(assignment.type, context.permissionMode),
    status: resolved.usable ? "running" : "blocked",
    transcriptPath: child.transcriptPath,
    transcriptSessionId: child.id,
    mailbox: [],
    cwd: context.projectPath,
    cancelTokenId: randomUUID(),
    heartbeatAt: resolved.usable ? now : undefined,
    summary: resolved.usable
      ? "job child agent running"
      : formatRoutePauseMessage(role, resolved.decision),
    contextSummary: createDurableJobAgentContextSummary(packet, job, assignment),
    cost: createEmptyAgentCost(task),
    startedAt: now,
    updatedAt: now,
  };
  assignment.runId = agent.id;
  assignment.owner = agent.transcriptSessionId;
  assignment.startedAt = now;
  assignment.status = agent.status === "running" ? "running" : "blocked";
  assignment.statusReason = agent.status === "running" ? "started" : "route_unusable";
  assignment.summary = agent.summary;
  context.agents.unshift(agent);
  context.agents = context.agents.slice(0, MAX_AGENTS);
  const background = createAgentBackgroundTask(agent, context);
  rememberBackgroundTask(context, background);
  if (agent.status === "running") {
    registerBackgroundAbortController(context, agent.id);
  }
  await persistAgentRun(context, agent);
  await context.store.appendEvent(parentSessionId, { type: "agent_start", agent, createdAt: now });
  await context.store.appendEvent(child.id, {
    type: "system_event",
    id: randomUUID(),
    level: agent.status === "running" ? "info" : "warning",
    message: agent.contextSummary,
    createdAt: now,
  });
  await deps().appendBackgroundTaskEvent(context, parentSessionId, background);
  if (agent.status !== "running") {
    writeLine(output, agent.summary);
  }
  return agent;
}

function syncJobAssignmentFromAgent(
  assignment: DurableJobState["agents"][number],
  agent: AgentRun,
): void {
  assignment.runId = agent.id;
  assignment.heartbeatAt = agent.heartbeatAt;
  assignment.summary = agent.summary;
  assignment.statusReason = agent.status;
  assignment.endedAt =
    agent.status === "running" || agent.status === "stale" ? undefined : agent.updatedAt;
  assignment.status =
    agent.status === "running"
      ? "running"
      : agent.status === "completed"
        ? "completed"
        : agent.status === "cancelled"
          ? "cancelled"
          : agent.status === "failed"
            ? "failed"
            : agent.status === "stale"
              ? "stale"
              : "blocked";
}

async function syncLinkedAgentRunsForJobTransition(
  context: TuiContext,
  job: DurableJobState,
  status: DurableJobStatus,
  reason?: string,
): Promise<void> {
  const linkedIds = new Set(job.agents.map((agent) => agent.runId).filter(Boolean));
  if (linkedIds.size === 0) return;
  const now = new Date().toISOString();
  for (const agent of context.agents) {
    if (!linkedIds.has(agent.id) || agent.status !== "running") continue;
    agent.status =
      status === "cancelled"
        ? "cancelled"
        : status === "failed" || status === "timeout"
          ? "failed"
          : "stale";
    agent.summary = `agent ${agent.id} synced from job ${job.id} ${status}; ${reason ?? "no reason"}`;
    agent.staleReason = status === "stale" ? reason : agent.staleReason;
    agent.updatedAt = now;
    const background = context.backgroundTasks.find((task) => task.id === agent.id);
    if (background) syncBackgroundWithAgentStatus(background, agent);
    context.backgroundAbortControllers?.get(agent.id)?.abort();
    await persistAgentRun(context, agent);
  }
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
      facts: [`terminal status ${job.status}`, job.pauseReason ?? "no pause reason"],
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
  const missing = job.handoffPacket
    ? validateJobHandoffPreflight(job.handoffPacket)
    : ["handoffPacket"];
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
    markUnstartedJobAgents(job, "resource_limited", `resource_guard:${resourceGuard}`);
    await transitionDurableJob(job, context, "sleeping", `resource_guard:${resourceGuard}`);
    return;
  }
  updateDurableJobEffectiveAgentCap(
    job,
    resolveEffectiveJobAgentCap(context, job.budget.maxRunningAgents, job.id),
    "resume_dynamic_cap",
  );
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
  if (status === "sleeping") {
    markUnstartedJobAgents(
      job,
      pauseReason?.startsWith("resource_guard:") ? "resource_limited" : "sleeping",
      pauseReason,
    );
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
  if (
    job.runner &&
    (status === "blocked" ||
      status === "cancelled" ||
      status === "completed" ||
      status === "failed" ||
      status === "stale" ||
      status === "timeout")
  ) {
    await stopRunnerForDurableJob(context, job);
  }
  if (
    (status === "blocked" && job.result?.status !== "overbudget") ||
    status === "cancelled" ||
    status === "failed" ||
    status === "stale" ||
    status === "timeout"
  ) {
    job.result = {
      status: status === "blocked" ? "blocked" : status,
      summary: `Durable job moved to ${status}; no PASS evidence generated.`,
      facts: [pauseReason ?? "no pause reason", formatJobRunnerInline(job)],
      evidenceRefs: job.evidenceRefs.map((item) => item.id),
      generatedAt: now,
    };
  }
  if (status === "blocked" && job.worker?.status === "running") {
    job.worker = {
      ...job.worker,
      status: "blocked",
      endedAt: now,
      summary: `Durable job blocked; ${pauseReason ?? "no pause reason"}. No PASS evidence generated.`,
    };
  }
  if (status === "cancelled" || status === "timeout" || status === "failed" || status === "stale") {
    await syncLinkedAgentRunsForJobTransition(context, job, status, pauseReason);
    markUnstartedJobAgents(job, status, pauseReason);
  }
  rescheduleDurableJobAgents(job);
  await appendJobLog(job, `job transition: ${status}; pause reason ${pauseReason ?? "none"}`);
  await persistDurableJob(job);
  await writeDurableJobReport(job);
  const background = upsertJobBackgroundTask(context, job);
  await deps().appendBackgroundTaskEvent(context, await deps().ensureSession(context), background);
}

export async function hydrateDurableJobBackgroundTasks(context: TuiContext): Promise<void> {
  const jobs = await listDurableJobs(context);
  for (const job of jobs) {
    const recovered = await recoverDurableJobForContext(context, job);
    if (
      recovered.status === "running" ||
      recovered.status === "stale" ||
      recovered.status === "sleeping" ||
      recovered.status === "blocked"
    ) {
      upsertJobBackgroundTask(context, recovered);
    }
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
  const missing = job.handoffPacket
    ? validateJobHandoffPreflight(job.handoffPacket)
    : ["handoffPacket"];
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
  if (job.status === "stale" || job.status === "blocked") {
    await syncLinkedAgentRunsForJobTransition(context, job, job.status, job.pauseReason);
    markUnstartedJobAgents(job, job.status, job.pauseReason);
  }
  job.rejectedConclusions = [
    ...job.rejectedConclusions,
    `Recovered ${job.status} job is conservative and not PASS evidence.`,
  ];
  rescheduleDurableJobAgents(job);
  await appendJobLog(job, `job recovery: ${job.status}; pause reason ${job.pauseReason ?? "none"}`);
  await persistDurableJob(job);
  await writeDurableJobReport(job);
  return job;
}

export async function runDurableJobLiteTick(
  context: TuiContext,
  job: DurableJobState,
  output: Writable = createSilentOutput(),
): Promise<void> {
  if (job.status !== "running") {
    return;
  }
  updateDurableJobEffectiveAgentCap(
    job,
    resolveEffectiveJobAgentCap(context, job.budget.maxRunningAgents, job.id),
    "runtime_dynamic_cap",
  );
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

  while (job.status === "running" && hasRunnableJobAgents(job)) {
    const stepIndex = job.budget.usedSteps ?? 0;
    // P1-5 — maxSteps 预算只在用户显式设置（--max-steps）时强制；默认无用户可见
    // 预算（默认 maxSteps 等于 plan 步数，while 条件自然终止，不走该 blocked 分支）。
    if (job.budget.explicit?.steps === true && stepIndex >= getDurableJobMaxSteps(job)) {
      job.result = {
        status: "blocked",
        summary: "Durable worker stopped at maxSteps; no PASS evidence generated.",
        facts: [`max steps ${getDurableJobMaxSteps(job)}`, `planned steps ${job.plan.length}`],
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

    const batch: {
      assignment: DurableJobState["agents"][number];
      stepIndex: number;
      stepFacts: string[];
      agent: AgentRun;
      task: BackgroundTaskState;
    }[] = [];
    const batchCap = Math.max(1, getEffectiveAgentCap(job));
    while (job.status === "running" && batch.length < batchCap) {
      const nextStepIndex = job.budget.usedSteps ?? 0;
      if (job.budget.explicit?.steps === true && nextStepIndex >= getDurableJobMaxSteps(job)) {
        break;
      }
      const assignment = nextRunnableJobAgent(job);
      if (!assignment) {
        break;
      }
      const summary = `Durable job scheduling ${assignment.type} subtask ${nextStepIndex + 1}/${job.agents.length}: ${assignment.task ?? assignment.goal}.`;
      const stepFacts = createDurableJobStepFacts(context, job, nextStepIndex, assignment);
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
          currentStep: nextStepIndex + 1,
          completedSteps: nextStepIndex,
          endedAt: job.result.generatedAt,
          summary: job.result.summary,
        };
        await transitionDurableJob(
          job,
          context,
          "blocked",
          `budget exceeded: max tokens ${job.budget.maxTokens}`,
        );
        return;
      }

      const now = new Date().toISOString();
      job.budget.usedTokens = (job.budget.usedTokens ?? 0) + estimatedTokens;
      job.budget.remainingTokens = Math.max(0, job.budget.maxTokens - job.budget.usedTokens);
      job.budget.usedSteps = nextStepIndex + 1;
      assignment.status = "running";
      assignment.statusReason = "started";
      assignment.scheduledAt ??= now;
      assignment.startedAt = now;
      job.worker = {
        ...job.worker,
        status: "running",
        currentStep: nextStepIndex + 1,
        completedSteps: nextStepIndex + 1,
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
        message: `${summary} facts ${stepFacts.join(" | ")}`,
        createdAt: now,
      });
      await appendJobLog(
        job,
        `agent step ${nextStepIndex + 1}/${job.agents.length}: ${assignment.id}/${assignment.type}; tokens ${estimatedTokens}; refs ${stepFacts.join(" | ")}`,
      );
      await persistDurableJobProgress(context, job, `worker step ${nextStepIndex + 1} persisted`);

      const agent = await startDurableJobAgentRun(context, job, assignment, output);
      const task = context.backgroundTasks.find((item) => item.id === agent.id);
      if (!task) {
        assignment.status = "blocked";
        assignment.statusReason = "missing_agent_background_task";
        assignment.summary = "AgentRun started but background task was not found; job blocked.";
        await Promise.all(
          batch.map((item) => completeAgent(item.agent, item.task, context, output)),
        );
        await transitionDurableJob(job, context, "blocked", "missing_agent_background_task");
        return;
      }
      if (agent.status !== "running") {
        syncJobAssignmentFromAgent(assignment, agent);
        await Promise.all(
          batch.map((item) => completeAgent(item.agent, item.task, context, output)),
        );
        await transitionDurableJob(job, context, "blocked", `agent_${agent.status}:${agent.id}`);
        return;
      }
      batch.push({ assignment, stepIndex: nextStepIndex, stepFacts, agent, task });
    }

    if (batch.length === 0) {
      break;
    }

    const completedBatch = await Promise.all(
      batch.map(async (item) => {
        await completeAgent(item.agent, item.task, context, output);
        syncJobAssignmentFromAgent(item.assignment, item.agent);
        return item;
      }),
    );

    for (const item of completedBatch) {
      const assignmentStatus = item.assignment.status as DurableJobAgentStatus;
      job.updatedAt = item.agent.updatedAt;
      job.heartbeatAt = item.agent.updatedAt;
      job.result = {
        status:
          assignmentStatus === "failed"
            ? "failed"
            : assignmentStatus === "cancelled"
              ? "cancelled"
              : "partial",
        summary: `Agent ${item.agent.id} ${assignmentStatus}: ${item.agent.summary}`,
        facts: createDurableJobStepFacts(context, job, item.stepIndex, item.assignment),
        evidenceRefs: job.evidenceRefs.map((entry) => entry.id),
        generatedAt: item.agent.updatedAt,
      };
      job.verification = {
        status: "partial",
        summary:
          item.assignment.type === "verifier"
            ? "Verifier agent used real verification, but durable job lifecycle is not PASS evidence."
            : "Agent output is partial until explicit verification/final gate evidence proves PASS.",
      };
      await persistDurableJobProgress(
        context,
        job,
        `agent ${item.assignment.id} ${assignmentStatus}`,
      );
    }

    const terminalAssignment = completedBatch.find((item) => {
      const status = item.assignment.status as DurableJobAgentStatus;
      return (
        status === "blocked" || status === "failed" || status === "cancelled" || status === "stale"
      );
    });
    if (terminalAssignment) {
      const assignmentStatus = terminalAssignment.assignment.status as DurableJobAgentStatus;
      await transitionDurableJob(
        job,
        context,
        assignmentStatus === "cancelled"
          ? "cancelled"
          : assignmentStatus === "stale"
            ? "stale"
            : "blocked",
        `agent_${assignmentStatus}:${terminalAssignment.agent.id}`,
      );
      return;
    }

    const afterStop = await applyDurableJobBudgetStop(
      context,
      job,
      `after_step_${job.budget.usedSteps ?? stepIndex + 1}`,
    );
    if (afterStop) {
      return;
    }
  }

  if (job.status !== "running") {
    return;
  }
  const endedAt = new Date().toISOString();
  if (
    job.agents.some(
      (agent) =>
        agent.status === "queued" ||
        agent.status === "sleeping" ||
        agent.status === "resource_limited" ||
        agent.status === "budget_limited",
    )
  ) {
    await transitionDurableJob(job, context, "sleeping", "queued_or_limited_agents_remain");
    return;
  }
  job.worker = {
    ...job.worker,
    status: "completed",
    endedAt,
    currentStep: job.budget.usedSteps ?? job.plan.length,
    completedSteps: job.budget.usedSteps ?? job.plan.length,
    summary:
      "Durable multi-agent scheduler finished all started AgentRun subtasks; verification is still partial.",
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
    summary:
      "Job completion only means scheduled AgentRun subtasks ended; it is not PASS evidence, verification PASS, or smoke-ready proof.",
  };
  job.status = "completed";
  job.pauseReason = undefined;
  job.endedAt = endedAt;
  job.heartbeatAt = endedAt;
  job.updatedAt = endedAt;
  job.adoptedConclusions = [
    ...job.adoptedConclusions,
    "Durable scheduler produced real AgentRun child executions from trimmed refs.",
  ];
  job.rejectedConclusions = [
    ...job.rejectedConclusions,
    "Completed job lifecycle only means the bounded worker loop ended; it is not PASS evidence, not Beta readiness, and not smoke-ready proof.",
  ];
  rescheduleDurableJobAgents(job);
  await appendJobLog(job, `agent scheduler completed: session=${workerSession.id}`);
  await persistDurableJobProgress(
    context,
    job,
    "agent scheduler completed without verification PASS",
  );
}

function createSilentOutput(): Writable {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
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
  assignment?: DurableJobState["agents"][number],
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
    `step ${stepIndex + 1}/${job.plan.length}`,
    `agent ${assignment ? `${assignment.id}:${assignment.type}:${assignment.status}:run ${assignment.runId ?? "none"}` : "none"}`,
    `goal ${truncateDisplay(job.goal, 120)}`,
    `phase ${job.phase}`,
    `target ${job.target}`,
    `handoff ${job.handoffPacket?.id ?? "missing"}`,
    `index ${formatIndexRuntimeRef(context.index)}`,
    `workspace cache ${workspaceRef?.source ?? "missing"}; snapshot ${snapshotState}`,
    `evidence refs ${job.evidenceRefs.map((item) => item.id).join(",") || "none"}`,
    `agents ${job.agents.filter((agent) => agent.status === "running").length}/${job.agents.length}`,
    `effective cap ${getEffectiveAgentCap(job)}; cap reason ${job.capReason ?? "default"}`,
    `logs ${job.logPath}; report ${job.reportPath}`,
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
      facts: [`runtime ${runtimeMs}ms`, `max runtime ${maxRuntimeMs}ms`],
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
  if (action === "registry") {
    const detailsText = formatAgentRegistryList(context);
    showCommandPanel(context, output, {
      title: "/agents registry",
      tone: "neutral",
      summary: [
        context.language === "en-US"
          ? `Custom agents · ${context.agentRegistry.agents.length} available — Ctrl+O for details.`
          : `自定义 agents · ${context.agentRegistry.agents.length} 个可用 — Ctrl+O 查看详情。`,
      ],
      actions: ["/fork explorer|planner|verifier|worker <task>", "/workflows registry"],
      detailsText,
    });
    return;
  }
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
  if (action === "send") {
    const to = args[1];
    const message = args.slice(2).join(" ").trim();
    if (!to || !message) {
      writeLine(output, "用法：/agents send <id|name|team> <message>");
      return;
    }
    const result = await sendAgentMessage(context, {
      to,
      message,
      from: "user",
    });
    writeLine(output, result.text);
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
  if (action === "resume") {
    const agent = findAgent(context, args[1]);
    if (!agent) {
      writeLine(output, "未找到 agent。");
      return;
    }
    await resumeAgent(agent, context, output);
    return;
  }
  writeLine(
    output,
    "用法：/agents | /agents registry | /agents show <id> | /agents resume <id> | /agents cancel <id> | /agents send <id|name|team> <message>",
  );
}

export async function handleForkCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const options = parseForkCommandArgs(args);
  const registryAgent = resolveForkRegistryAgent(context, options.rawType);
  const type = registryAgent ? mapRegistryAgentType(registryAgent) : options.type;
  const task = options.task;
  if (!type || !isAgentType(type) || !task) {
    writeLine(
      output,
      "用法：/fork explorer|planner|verifier|worker|<custom-agent-id> <task> [--background] [--name <name>] [--team <team>] [--cwd <path>] [--isolation worktree]",
    );
    return;
  }
  const workflowTaskId =
    context.workflows.activeRun?.status === "running" ? context.workflows.activeRun.id : undefined;
  const guard = deps().checkBackgroundStartGuard(context, "agent", true, workflowTaskId);
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
  const cwdResult = await resolveAgentCwd(context, options);
  if (!cwdResult.ok) {
    writeLine(output, cwdResult.text);
    return;
  }
  const role = getAgentRole(type);
  const effectiveTask = registryAgent ? `${registryAgent.prompt}\n\nTask: ${task}` : task;
  const resolved = resolveRoleRoute(context, role, `/fork ${type}`);
  await deps().appendRouteDecisionEvent(context, parentSessionId, resolved.decision);
  if (!resolved.usable) {
    writeLine(output, formatRoutePauseMessage(role, resolved.decision));
    return;
  }
  const route = resolved.route;
  const effectiveModel = registryAgent?.model ?? route.primaryModel ?? context.model;
  const registryAllowedTools = normalizeRegistryAllowedTools(registryAgent?.allowedTools);
  const registryMaxTurns = normalizeRegistryAgentMaxTurns(registryAgent?.maxTurns);
  const child = await context.store.create({
    model: effectiveModel,
    summary: `agent:${type}:${truncateDisplay(task, 60)}`,
  });
  const now = new Date().toISOString();
  const agent: AgentRun = {
    id: `agent-${randomUUID().slice(0, 8)}`,
    type,
    displayName: deriveAgentDisplayName(type, task),
    addressableName: options.name ?? registryAgent?.name,
    teamName: options.teamName,
    role,
    provider: route.provider || "unconfigured",
    parentSessionId,
    forkedFrom: packet.id,
    task: effectiveTask,
    model: effectiveModel,
    ...(registryAgent ? { registryAgentId: registryAgent.id } : {}),
    ...(registryAllowedTools ? { allowedTools: registryAllowedTools } : {}),
    ...(registryMaxTurns ? { maxTurns: registryMaxTurns } : {}),
    permissionMode: getAgentPermissionMode(type, context.permissionMode),
    status: "running",
    transcriptPath: child.transcriptPath,
    transcriptSessionId: child.id,
    mailbox: [],
    cwd: cwdResult.cwd,
    isolation: cwdResult.isolation,
    cancelTokenId: randomUUID(),
    heartbeatAt: now,
    summary: "agent running",
    contextSummary: createAgentContextSummary(packet, task, context),
    cost: createEmptyAgentCost(effectiveTask),
    startedAt: now,
    updatedAt: now,
  };
  context.agents.unshift(agent);
  context.agents = context.agents.slice(0, MAX_AGENTS);
  const background = createAgentBackgroundTask(agent, context);
  rememberBackgroundTask(context, background);
  registerBackgroundAbortController(context, agent.id);
  await persistAgentRun(context, agent);
  await context.store.appendEvent(parentSessionId, { type: "agent_start", agent, createdAt: now });
  await context.store.appendEvent(child.id, {
    type: "system_event",
    id: randomUUID(),
    level: "info",
    message: `${agent.contextSummary} | cwd ${cwdResult.cwd} | isolation ${cwdResult.isolation ?? "none"} | registry ${agent.registryAgentId ?? "none"} | model ${agent.model} | max turns ${agent.maxTurns ?? AGENT_MAX_MODEL_TURNS} | allowed tools ${agent.allowedTools?.join(",") ?? "default"}`,
    createdAt: now,
  });
  if (cwdResult.evidenceText) {
    await context.store.appendEvent(child.id, {
      type: "system_event",
      id: randomUUID(),
      level: "info",
      message: cwdResult.evidenceText,
      createdAt: now,
    });
  }
  await deps().appendBackgroundTaskEvent(context, parentSessionId, background);
  writeLine(output, formatBackgroundTask(background, context.language));

  if (options.runInBackground) {
    writeLine(
      output,
      context.language === "en-US"
        ? `Background agent started: ${agent.id}. Use /agents show ${agent.id} or /agents cancel ${agent.id}.`
        : `后台 agent 已启动：${agent.id}。可用 /agents show ${agent.id} 或 /agents cancel ${agent.id}。`,
    );
    setTimeout(() => {
      void completeAgent(agent, background, context, output);
    }, 0);
    return;
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
  let result: AgentWorkResult;
  try {
    result = await runAgentWork(agent, context, output);
  } catch (error) {
    if (agent.status === "stale") {
      await persistAgentRun(context, agent);
      await deps().appendBackgroundTaskEvent(context, parentSessionId, task);
      return;
    }
    await failAgent(agent, task, context, output, parentSessionId, error);
    return;
  }
  if (agent.status === "cancelled" || agent.status === "stale") {
    await persistAgentRun(context, agent);
    return;
  }
  const now = new Date().toISOString();
  agent.status = result.status;
  agent.summary = result.summary;
  agent.updatedAt = now;
  agent.cost.outputTokens = Math.ceil(result.summary.length / 4);
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
    `${agent.type} agent ${result.status}`,
  );
  context.roleHandoffs.unshift(
    deps().createRoleHandoff("executor", agent.role, agent.id, result.summary, context),
  );
  syncBackgroundWithAgentStatus(task, agent);
  task.updatedAt = now;
  task.lastOutputAt = now;
  task.nextAction =
    context.language === "en-US" ? "Review /agents show output." : "查看 /agents show 输出。";
  await context.store.appendEvent(agent.transcriptSessionId, {
    type: "assistant_text_delta",
    id: randomUUID(),
    text: result.summary,
    createdAt: now,
  });
  await context.store.appendEvent(parentSessionId, {
    type: "agent_end",
    agentId: agent.id,
    status: result.status,
    summary: result.summary,
    createdAt: now,
  });
  const agentEvidenceId = await deps().recordAgentExecutionEvidence(
    context,
    parentSessionId,
    agent,
    result,
  );
  if (agentEvidenceId) {
    result.evidenceRefs = Array.from(new Set([...result.evidenceRefs, agentEvidenceId]));
  }
  await persistAgentRun(context, agent);
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
  syncBackgroundWithAgentStatus(task, agent);
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
  await persistAgentRun(context, agent);
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
): Promise<AgentWorkResult> {
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
    await deps().recordVerificationEvidence(
      context,
      agent.parentSessionId ?? (await deps().ensureSession(context)),
      report,
    );
    return {
      status:
        report.status === "pass" ? "completed" : report.status === "fail" ? "failed" : "blocked",
      summary: `verifier 已运行真实验证，结果 ${report.status.toUpperCase()}；任务「${agent.task}」。`,
      evidenceRefs: [],
    };
  }
  return runModelBackedAgent(agent, context, output);
}

function getProviderErrorCode(error: unknown): string {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : "PROVIDER_ERROR";
}

function shouldAttemptAgentRuntimeFallback(kind: ProviderFailureKind): boolean {
  return (
    kind === "rate_limit" ||
    kind === "quota_or_balance_exhausted" ||
    kind === "gateway" ||
    kind === "transit" ||
    kind === "timeout"
  );
}

function createAgentRuntimeForFallbackModel(
  context: TuiContext,
  baseRuntime: AgentProviderRuntime,
  fallbackModel: string,
): AgentProviderRuntime | undefined {
  if (!fallbackModel || fallbackModel === baseRuntime.model) return undefined;
  const provider = inferProviderForRouteModel(fallbackModel, context.config);
  const providerConfig = context.config.providers[provider];
  if (!providerConfig) return undefined;
  const rawEndpointProfile = providerConfig.endpointProfile ?? "chat_completions";
  const endpointProfile = rawEndpointProfile === "responses" ? "responses" : "chat_completions";
  const compatibilityProfile =
    providerConfig.compatibilityProfile ??
    (providerConfig.type === "deepseek" ? "deepseek" : "strict_openai_compatible");
  const reasoningLevel = providerConfig.reasoningLevel;
  const reasoningSent = Boolean(
    reasoningLevel &&
      (endpointProfile === "responses" ||
        compatibilityProfile === "permissive_openai_compatible" ||
        rawEndpointProfile === "anthropic_messages"),
  );
  return {
    provider,
    model: fallbackModel,
    endpointProfile,
    reasoningLevel,
    reasoningSent,
  };
}

function resolveAgentRuntimeFallback(
  context: TuiContext,
  agent: AgentRun,
  runtime: AgentProviderRuntime,
  error: unknown,
  attemptedModels: Set<string>,
): { runtime: AgentProviderRuntime; kind: ProviderFailureKind; code: string } | undefined {
  const kind = classifyProviderFailure(error);
  if (!shouldAttemptAgentRuntimeFallback(kind)) return undefined;
  const route = getRoleRoute(context.config, agent.role);
  for (const fallbackModel of route.fallbackModels) {
    if (attemptedModels.has(fallbackModel)) continue;
    const fallbackRuntime = createAgentRuntimeForFallbackModel(context, runtime, fallbackModel);
    if (!fallbackRuntime) continue;
    if (fallbackRuntime.provider === runtime.provider && fallbackRuntime.model === runtime.model) {
      continue;
    }
    return { runtime: fallbackRuntime, kind, code: getProviderErrorCode(error) };
  }
  return undefined;
}

async function recordAgentProviderFallbackAttempt(
  context: TuiContext,
  sessionId: string,
  input: {
    from: AgentProviderRuntime;
    to: AgentProviderRuntime;
    kind: ProviderFailureKind;
    code: string;
    status: "attempted" | "succeeded" | "failed";
  },
): Promise<string> {
  const summary = formatProviderFallbackAttemptSummary(
    {
      fromProvider: input.from.provider,
      fromModel: input.from.model,
      toProvider: input.to.provider,
      toModel: input.to.model,
      reasonKind: input.kind,
    },
    context.language,
  );
  context.lastProviderFallbackAttempt = {
    fromProvider: input.from.provider,
    fromModel: input.from.model,
    toProvider: input.to.provider,
    toModel: input.to.model,
    reasonKind: input.kind,
    reasonCode: input.code,
    status: input.status,
    summary,
    createdAt: new Date().toISOString(),
  };
  await context.store.appendEvent(sessionId, {
    type: "system_event",
    id: randomUUID(),
    level: input.status === "succeeded" ? "info" : "warning",
    message: `provider fallback attempt: from ${input.from.provider}/${input.from.model}; to ${input.to.provider}/${input.to.model}; reason ${input.kind}; code ${input.code}; status ${input.status}`,
    createdAt: new Date().toISOString(),
  });
  return summary;
}

function syncAgentRuntimeFallbackMetadata(
  context: TuiContext,
  agent: AgentRun,
  from: AgentProviderRuntime,
  to: AgentProviderRuntime,
): void {
  agent.provider = to.provider;
  agent.model = to.model;
  const existing = context.routeDecisions.find(
    (decision) =>
      decision.role === agent.role &&
      decision.selectedProvider === to.provider &&
      decision.selectedModel === to.model,
  );
  if (existing) {
    existing.fallbackUsed = true;
    return;
  }
  context.routeDecisions.unshift({
    id: `route-${randomUUID().slice(0, 8)}`,
    triggerReason: "agent child provider runtime fallback",
    role: agent.role,
    selectedProvider: to.provider,
    selectedModel: to.model,
    fallbackCandidates: [to.model],
    requiredCapabilities: [],
    stopConditions: [],
    repairSuggestions: [
      `fallback from ${from.provider}/${from.model} to ${to.provider}/${to.model}`,
    ],
    fallbackUsed: true,
    budgetStop: false,
    createdAt: new Date().toISOString(),
  });
}

export async function runModelBackedAgent(
  agent: AgentRun,
  context: TuiContext,
  output: Writable,
): Promise<AgentWorkResult> {
  const continuation = deps().createAgentGatewayContinuation(context, agent);
  if (!continuation) {
    return {
      status: "blocked",
      summary: `${agent.type} blocked：模型网关未就绪，无法启动真实 agent loop。任务「${agent.task}」未执行。`,
      evidenceRefs: [],
    };
  }
  const parentSessionId = agent.parentSessionId ?? (await deps().ensureSession(context));
  const messages: ModelMessage[] = [
    {
      role: "system",
      content: createAgentLoopSystemPrompt(agent, context),
    },
    {
      role: "user",
      content: buildAgentUserMessage(agent),
    },
  ];
  const backgroundSignal = context.backgroundAbortControllers?.get(agent.id)?.signal;
  const controller = backgroundSignal ? undefined : new AbortController();
  const signal = backgroundSignal ?? controller?.signal;
  if (!signal) {
    return {
      status: "failed",
      summary: `${agent.type} failed：无法创建 agent abort signal。`,
      evidenceRefs: [],
    };
  }
  let finalText = "";
  const maxTurns = getAgentMaxTurns(agent);
  let currentRuntime: AgentProviderRuntime = {
    provider: continuation.provider,
    model: agent.model || continuation.model,
    endpointProfile: continuation.endpointProfile,
    reasoningLevel: continuation.reasoningLevel,
    reasoningSent: continuation.reasoningSent,
  };
  const attemptedFallbackModels = new Set<string>();
  let activeFallback:
    | {
        from: AgentProviderRuntime;
        to: AgentProviderRuntime;
        kind: ProviderFailureKind;
        code: string;
      }
    | undefined;
  for (let round = 0; round < maxTurns; round += 1) {
    const mailbox = consumeAgentMailbox(agent);
    if (mailbox.length > 0) await persistAgentRun(context, agent);
    for (const message of mailbox) {
      messages.push({
        role: "user",
        content: `Mailbox message ${message.id} from ${message.from}: ${message.text}`,
      });
      await context.store.appendEvent(agent.transcriptSessionId, {
        type: "system_event",
        id: randomUUID(),
        level: "info",
        message: `mailbox_consumed:${message.id}`,
        createdAt: message.consumedAt ?? new Date().toISOString(),
      });
    }
    let toolCalls: ModelToolCall[] = [];
    let assistantText = "";
    let providerRequestCompleted = false;
    while (!providerRequestCompleted) {
      toolCalls = [];
      assistantText = "";
      const preflight = await deps().prepareProviderPreflight(
        context,
        agent.transcriptSessionId,
        messages,
        {
          role: agent.role,
          provider: currentRuntime.provider,
          model: currentRuntime.model,
        },
        "agent-child",
      );
      if (preflight.blocked) {
        writeLine(output, preflight.message);
        return {
          status: "blocked",
          summary: `${agent.type} blocked：context compact blocked the child provider request. ${preflight.message}`,
          evidenceRefs: [],
        };
      }
      messages.splice(0, messages.length, ...preflight.messages);
      const cooldown = checkProviderCooldown(
        context.providerBreaker,
        currentRuntime.provider,
        currentRuntime.model,
      );
      if (cooldown.blocked) {
        const message = formatCooldownMessage(
          currentRuntime.provider,
          currentRuntime.model,
          cooldown.remainingMs,
          context.language,
        );
        await context.store.appendEvent(agent.transcriptSessionId, {
          type: "system_event",
          id: randomUUID(),
          level: "warning",
          message: `agent child provider cooldown: provider ${currentRuntime.provider}; model ${currentRuntime.model}; code ${cooldown.reasonCode}`,
          createdAt: new Date().toISOString(),
        });
        return {
          status: "blocked",
          summary:
            context.language === "en-US"
              ? `${agent.type} blocked: child model request is waiting before retry. ${message}`
              : `${agent.type} blocked：子 agent 模型请求正在等待恢复。${message}`,
          evidenceRefs: [],
        };
      }
      let retryWithFallback = false;
      for await (const event of continuation.gateway.stream(
        currentRuntime.provider,
        {
          messages: preflight.messages,
          model: currentRuntime.model,
          endpointProfile: currentRuntime.endpointProfile,
          ...(currentRuntime.reasoningSent
            ? { reasoningLevel: currentRuntime.reasoningLevel }
            : {}),
          tools: createModelToolDefinitionsForTools(getAgentAllowedTools(agent)),
          toolChoice: "auto",
        },
        signal,
      )) {
        if (event.type === "assistant_text_delta") {
          assistantText += event.text;
          continue;
        }
        if (event.type === "tool_use") {
          toolCalls.push({ id: event.id, name: event.name, input: event.input });
          continue;
        }
        if (event.type === "usage") {
          agent.cost.inputTokens += event.usage.inputTokens;
          agent.cost.outputTokens += event.usage.outputTokens;
          continue;
        }
        if (event.type === "error") {
          const code = event.error.code ?? "PROVIDER_ERROR";
          const kind = classifyProviderFailure(event.error);
          recordProviderFailure(
            context.providerBreaker,
            currentRuntime.provider,
            currentRuntime.model,
            code,
          );
          await context.store.appendEvent(agent.transcriptSessionId, {
            type: "system_event",
            id: randomUUID(),
            level: "warning",
            message: `agent child provider failure: kind ${kind}; code ${code}; provider ${currentRuntime.provider}; model ${currentRuntime.model}`,
            createdAt: new Date().toISOString(),
          });
          const fallback = resolveAgentRuntimeFallback(
            context,
            agent,
            currentRuntime,
            event.error,
            attemptedFallbackModels,
          );
          if (fallback) {
            const fallbackCooldown = checkProviderCooldown(
              context.providerBreaker,
              fallback.runtime.provider,
              fallback.runtime.model,
            );
            if (fallbackCooldown.blocked) {
              const message = formatCooldownMessage(
                fallback.runtime.provider,
                fallback.runtime.model,
                fallbackCooldown.remainingMs,
                context.language,
              );
              await context.store.appendEvent(agent.transcriptSessionId, {
                type: "system_event",
                id: randomUUID(),
                level: "warning",
                message: `agent child provider cooldown: provider ${fallback.runtime.provider}; model ${fallback.runtime.model}; code ${fallbackCooldown.reasonCode}`,
                createdAt: new Date().toISOString(),
              });
              return {
                status: "blocked",
                summary:
                  context.language === "en-US"
                    ? `${agent.type} blocked: fallback child model is cooling down. ${message}`
                    : `${agent.type} blocked：备用子 agent 模型仍在冷却中。${message}`,
                evidenceRefs: [],
              };
            }
            attemptedFallbackModels.add(fallback.runtime.model);
            const fromRuntime = { ...currentRuntime };
            const summary = await recordAgentProviderFallbackAttempt(
              context,
              agent.transcriptSessionId,
              {
                from: fromRuntime,
                to: fallback.runtime,
                kind: fallback.kind,
                code: fallback.code,
                status: "attempted",
              },
            );
            writeLine(output, summary);
            activeFallback = {
              from: fromRuntime,
              to: fallback.runtime,
              kind: fallback.kind,
              code: fallback.code,
            };
            currentRuntime = fallback.runtime;
            retryWithFallback = true;
            break;
          }
          if (
            activeFallback &&
            activeFallback.to.provider === currentRuntime.provider &&
            activeFallback.to.model === currentRuntime.model
          ) {
            await recordAgentProviderFallbackAttempt(context, agent.transcriptSessionId, {
              ...activeFallback,
              status: "failed",
            });
          }
          const kindLabel = formatProviderFailureKindLabel(kind, context.language);
          return {
            status: "blocked",
            summary:
              context.language === "en-US"
                ? `${agent.type} blocked: child model request failed with ${kindLabel} (${code}). Run /model doctor for details; no completion was claimed.`
                : `${agent.type} blocked：子 agent 模型请求因${kindLabel}失败（${code}）。可运行 /model doctor 查看详情；本次没有声称已完成。`,
            evidenceRefs: [],
          };
        }
      }
      if (!retryWithFallback) {
        providerRequestCompleted = true;
        if (activeFallback) {
          syncAgentRuntimeFallbackMetadata(context, agent, activeFallback.from, activeFallback.to);
          await persistAgentRun(context, agent);
          clearProviderBreaker(
            context.providerBreaker,
            currentRuntime.provider,
            currentRuntime.model,
          );
          await recordAgentProviderFallbackAttempt(context, agent.transcriptSessionId, {
            ...activeFallback,
            status: "succeeded",
          });
          activeFallback = undefined;
        }
      }
    }
    if (assistantText || toolCalls.length > 0) {
      messages.push({ role: "assistant", content: assistantText, toolCalls });
      if (assistantText) {
        await context.store.appendEvent(agent.transcriptSessionId, {
          type: "assistant_text_delta",
          id: randomUUID(),
          text: assistantText,
          createdAt: new Date().toISOString(),
        });
      }
    }
    if (toolCalls.length === 0) {
      finalText = assistantText.trim();
      break;
    }
    for (const toolCall of toolCalls) {
      const result = await executeAgentToolCall(agent, toolCall, context, parentSessionId, output);
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
      if (result.pendingApproval) {
        return {
          status: "blocked",
          summary: `${agent.type} blocked：${result.tool} 需要用户确认，agent loop 已停止并回灌 tool_result。`,
          evidenceRefs: result.evidenceId ? [result.evidenceId] : [],
        };
      }
      if (!result.ok) {
        return {
          status: "blocked",
          summary: `${agent.type} blocked：${result.tool} 未成功执行：${truncateDisplay(result.text, 180)}`,
          evidenceRefs: result.evidenceId ? [result.evidenceId] : [],
        };
      }
    }
  }
  if (!finalText) {
    return {
      status: "blocked",
      summary: `${agent.type} blocked：agent child execution turn budget exhausted (${maxTurns}) without a final answer.`,
      evidenceRefs: [],
    };
  }
  return {
    status: "completed",
    summary: `${agent.type} completed：${truncateDisplay(finalText, 500)}`,
    evidenceRefs: [],
  };
}

async function executeAgentToolCall(
  agent: AgentRun,
  toolCall: ModelToolCall,
  context: TuiContext,
  parentSessionId: string,
  output: Writable,
): Promise<{
  ok: boolean;
  tool: string;
  text: string;
  data?: unknown;
  evidenceId?: string;
  pendingApproval?: boolean;
}> {
  const toolName = normalizeAgentToolName(toolCall.name);
  if (!toolName) {
    const text = `Unknown agent tool: ${toolCall.name}`;
    await appendAgentToolResultEvent(agent, context, toolCall.id, toolCall.name, text, true);
    return { ok: false, tool: toolCall.name, text };
  }
  const allowedTools = new Set(getAgentAllowedTools(agent).map((tool) => tool.name));
  if (!allowedTools.has(toolName)) {
    const text = `Tool ${toolName} is not allowed for agent ${agent.id}.`;
    await appendAgentToolResultEvent(agent, context, toolCall.id, toolName, text, true);
    return { ok: false, tool: toolName, text };
  }
  const permission = await decidePermission(toolName, toolCall.input, context, parentSessionId);
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
    const text = `${permission.decision}: ${permission.reason}`;
    await appendAgentToolResultEvent(agent, context, toolCall.id, toolName, text, true);
    return {
      ok: false,
      tool: toolName,
      text,
      pendingApproval: permission.decision === "ask",
    };
  }
  if (permission.preflight) {
    writeLine(output, permission.preflight);
  }
  const result = await runAgentToolInCwd(toolName, toolCall.input, agent, context);
  await appendAgentToolEvents(agent, context, toolName, toolCall.input, result.output, toolCall.id);
  const failed = isAgentToolOutputFailure(toolName, result.output);
  return {
    ok: !failed,
    tool: toolName,
    text: result.output.text,
    data: result.output.data,
  };
}

function createAgentLoopSystemPrompt(agent: AgentRun, context: TuiContext): string {
  const readonlyAuditHint = createReadonlyAuditToolHint(agent);
  const roleHint =
    agent.type === "explorer"
      ? "Explore with read-only tools first. Return concise findings and evidence."
      : agent.type === "planner"
        ? "Build a practical plan. Use Todo when it helps, but do not stop at a stub."
        : agent.type === "worker"
          ? "Execute the assigned work with real tools. Stop and report blocked if permission is required."
          : "Verify with real project commands and report PASS/FAIL/PARTIAL honestly.";
  return [
    `You are a Linghun ${agent.type} child agent running in an isolated sidechain transcript.`,
    roleHint,
    `Project path: ${context.projectPath}`,
    `Agent cwd: ${agent.cwd ?? context.projectPath}`,
    `Addressable name: ${agent.addressableName ?? "(none)"}`,
    `Team: ${agent.teamName ?? "(none)"}`,
    `Permission mode: ${agent.permissionMode}`,
    `Pending mailbox messages: ${countPendingMailbox(agent)}`,
    "Use structured tools only; never write raw tool_use/tool_result protocol as text.",
    readonlyAuditHint,
    "Respect the actual OS/shell before Bash. On Windows/PowerShell, prefer PowerShell cmdlets or Node one-liners; avoid Unix-only find|sed|head pipelines unless verified available.",
    "If a required tool is denied, asks for approval, or fails, report blocked instead of claiming completion.",
  ].join("\n");
}

function createReadonlyAuditToolHint(agent: AgentRun): string {
  const factTools = agent.type === "verifier" ? "Read/Grep/Glob" : "Read/Grep/Glob/Todo";
  const base = `For read-only audits, prefer ${factTools} for facts. Read results include totalLines/contentLines/windowLines/selectedLines; use contentLines for file line-count conclusions instead of calling Bash.`;
  if (agent.type !== "worker" && agent.type !== "verifier") {
    return agent.type === "explorer"
      ? `${base} Do not start/done/block guessed Todo ids; list or add Todo items first, or skip Todo when Read/Grep/Glob can answer the audit.`
      : base;
  }
  return [
    base,
    "Bash is not a bypass. When allowBash is false, only commands classified by the permission policy engine as safe readonly auto_allow_readonly may run without confirmation.",
    "If a Bash command would need confirmation, switch back to Read/Grep/Glob when that can answer the audit; otherwise report blocked with the exact command and permission reason.",
  ].join(" ");
}

function buildAgentUserMessage(agent: AgentRun): string {
  const mailbox = consumeAgentMailbox(agent);
  const lines = [agent.task];
  for (const message of mailbox) {
    lines.push(`Mailbox message ${message.id} from ${message.from}: ${message.text}`);
  }
  return lines.join("\n\n");
}

function consumeAgentMailbox(agent: AgentRun): AgentMailboxMessage[] {
  const now = new Date().toISOString();
  const pending = agent.mailbox.filter((message) => !message.consumedAt);
  for (const message of pending) {
    message.consumedAt = now;
  }
  return pending;
}

function getAgentAllowedTools(agent: AgentRun): (typeof builtInTools)[ToolName][] {
  if (agent.allowedTools) {
    return (
      normalizeRegistryAllowedTools(agent.allowedTools)?.map((name) => builtInTools[name]) ?? []
    );
  }
  const readOnly = [builtInTools.Read, builtInTools.Grep, builtInTools.Glob, builtInTools.Todo];
  if (agent.type === "explorer" || agent.type === "planner") return readOnly;
  if (agent.type === "worker") {
    return [
      builtInTools.Read,
      builtInTools.Grep,
      builtInTools.Glob,
      builtInTools.Todo,
      builtInTools.Write,
      builtInTools.Edit,
      builtInTools.MultiEdit,
      builtInTools.Bash,
    ];
  }
  return [builtInTools.Read, builtInTools.Grep, builtInTools.Glob, builtInTools.Bash];
}

function normalizeRegistryAllowedTools(tools: string[] | undefined): ToolName[] | undefined {
  if (!tools?.length) return undefined;
  const normalized = tools.filter((name): name is ToolName =>
    Object.prototype.hasOwnProperty.call(builtInTools, name),
  );
  return normalized.length === tools.length ? normalized : [];
}

function normalizeRegistryAgentMaxTurns(value: number | undefined): number | undefined {
  if (!Number.isInteger(value) || !value || value <= 0) return undefined;
  return Math.min(value, AGENT_MAX_MODEL_TURNS);
}

function getAgentMaxTurns(agent: AgentRun): number {
  return normalizeRegistryAgentMaxTurns(agent.maxTurns) ?? AGENT_MAX_MODEL_TURNS;
}

function normalizeAgentToolName(name: string): ToolName | null {
  return Object.values(builtInTools).some((tool) => tool.name === name) ? (name as ToolName) : null;
}

function isAgentToolOutputFailure(toolName: ToolName, output: ToolOutput): boolean {
  if (toolName !== "Bash") return false;
  const exitCode = (output.data as { exitCode?: unknown } | undefined)?.exitCode;
  return typeof exitCode === "number" && exitCode !== 0;
}

async function appendAgentToolEvents(
  agent: AgentRun,
  context: TuiContext,
  name: ToolName,
  input: unknown,
  output: ToolOutput,
  callId: string = randomUUID(),
): Promise<void> {
  await context.store.appendEvent(agent.transcriptSessionId, {
    type: "tool_call_start",
    id: callId,
    name,
    input,
    createdAt: new Date().toISOString(),
  });
  await context.store.appendEvent(agent.transcriptSessionId, createToolEndEvent(callId, output));
  await appendAgentToolResultEvent(agent, context, callId, name, output, false);
}

async function appendAgentToolResultEvent(
  agent: AgentRun,
  context: TuiContext,
  toolUseId: string,
  toolName: string,
  content: unknown,
  isError: boolean,
): Promise<void> {
  await context.store.appendEvent(agent.transcriptSessionId, {
    type: "tool_result",
    toolUseId,
    toolName: toolName as ToolName,
    content,
    isError,
    createdAt: new Date().toISOString(),
  });
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
    syncBackgroundWithAgentStatus(background, agent);
    background.updatedAt = now;
  }
  context.backgroundAbortControllers?.get(agent.id)?.abort();
  context.backgroundAbortControllers?.delete(agent.id);
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
  await persistAgentRun(context, agent);
  writeLine(output, agent.summary);
  deps().writeStatus(output, context);
}

export async function cancelAgentByRef(
  ref: string | undefined,
  context: TuiContext,
  output: Writable,
): Promise<AgentRun | undefined> {
  const agent = findAgent(context, ref);
  if (!agent) {
    writeLine(output, "未找到 agent。");
    return undefined;
  }
  await cancelAgent(agent, context, output);
  return agent;
}

export async function resumeAgent(
  agent: AgentRun,
  context: TuiContext,
  output: Writable,
): Promise<void> {
  if (agent.status !== "stale") {
    writeLine(output, `Agent 当前状态为 ${agent.status}，无需 stale resume。`);
    return;
  }
  const guard =
    deps().checkResourceGuard(context, "model") ??
    deps().checkBackgroundStartGuard(context, "agent", true, agent.id);
  if (guard) {
    agent.summary = `agent ${agent.id} resume sleeping/resource_limited：${guard}`;
    agent.updatedAt = new Date().toISOString();
    await persistAgentRun(context, agent);
    const background = context.backgroundTasks.find((task) => task.id === agent.id);
    if (background) {
      syncBackgroundWithAgentStatus(background, agent);
      background.nextAction = `资源恢复后重试 /agents resume ${agent.id}`;
      await deps().appendBackgroundTaskEvent(
        context,
        agent.parentSessionId ?? (await deps().ensureSession(context)),
        background,
      );
    }
    writeLine(output, agent.summary);
    return;
  }
  const now = new Date().toISOString();
  agent.status = "running";
  agent.heartbeatAt = now;
  agent.updatedAt = now;
  agent.summary =
    "agent stale resume restarted with a fresh provider turn; old tool_result events are not replayed.";
  const background =
    context.backgroundTasks.find((task) => task.id === agent.id) ??
    createAgentBackgroundTask(agent, context);
  if (!context.backgroundTasks.some((task) => task.id === background.id)) {
    rememberBackgroundTask(context, background);
  }
  syncBackgroundWithAgentStatus(background, agent);
  registerBackgroundAbortController(context, agent.id);
  await persistAgentRun(context, agent);
  await deps().appendBackgroundTaskEvent(
    context,
    agent.parentSessionId ?? (await deps().ensureSession(context)),
    background,
  );
  await completeAgent(agent, background, context, output);
}

const TERMINAL_AGENT_STATUSES = new Set(["blocked", "cancelled", "failed", "completed"]);

export function syncBackgroundWithAgentStatus(
  background: BackgroundTaskState,
  agent: AgentRun,
): void {
  if (TERMINAL_AGENT_STATUSES.has(agent.status)) {
    background.status = agent.status === "blocked" ? "failed" : "completed";
    background.currentStep = `${agent.status}`;
    background.result =
      agent.status === "completed"
        ? mapAgentBackgroundResult(agent, undefined)
        : agent.status === "blocked"
          ? "partial"
          : "fail";
    background.progress = {
      completed: 1,
      total: 1,
      label: background.progress?.label ?? agent.type,
    };
  } else if (agent.status === "stale") {
    background.status = "stale";
    background.currentStep = "stale/resumable";
    background.result = "partial";
    background.progress = {
      completed: 0,
      total: 1,
      label: background.progress?.label ?? agent.type,
    };
  } else if (agent.status === "running") {
    background.status = "running";
    background.currentStep = `running ${agent.type}`;
    background.result = undefined;
  }
  background.userVisibleSummary = agent.summary;
  background.updatedAt = agent.updatedAt;
}

export async function markRunningAgentsStaleForInterrupt(
  context: TuiContext,
  sessionId: string,
): Promise<{ marked: number; aborted: number }> {
  const now = new Date().toISOString();
  let marked = 0;
  let aborted = 0;
  for (const agent of context.agents.filter((item) => item.status === "running")) {
    const controller = context.backgroundAbortControllers?.get(agent.id);
    agent.status = "stale";
    agent.staleReason = controller
      ? "interrupted_abort_signal_sent"
      : "interrupted_without_abort_controller";
    agent.updatedAt = now;
    agent.summary = "Agent marked stale/resumable by interrupt; no completion was claimed.";
    const background =
      context.backgroundTasks.find((task) => task.id === agent.id) ??
      createAgentBackgroundTask(agent, context);
    if (!context.backgroundTasks.some((task) => task.id === background.id)) {
      rememberBackgroundTask(context, background);
    }
    syncBackgroundWithAgentStatus(background, agent);
    if (controller) {
      controller.abort();
      context.backgroundAbortControllers?.delete(agent.id);
      aborted += 1;
    }
    await persistAgentRun(context, agent);
    await deps().appendBackgroundTaskEvent(context, sessionId, background);
    marked += 1;
  }
  return { marked, aborted };
}

export async function hydratePersistentAgents(context: TuiContext): Promise<void> {
  let files: string[];
  try {
    files = await readdir(getAgentRunsDir(context));
  } catch {
    return;
  }
  const existing = new Set(context.agents.map((agent) => agent.id));
  for (const file of files.filter((name) => name.endsWith(".json")).sort()) {
    try {
      const raw = await readFile(resolve(getAgentRunsDir(context), file), "utf8");
      const parsed = JSON.parse(raw) as AgentRun;
      if (!parsed.id || existing.has(parsed.id)) continue;
      const now = new Date().toISOString();
      const allowedTools = normalizeRegistryAllowedTools(parsed.allowedTools);
      const maxTurns = normalizeRegistryAgentMaxTurns(parsed.maxTurns);
      const agent: AgentRun = {
        ...parsed,
        mailbox: parsed.mailbox ?? [],
        ...(allowedTools !== undefined ? { allowedTools } : {}),
        ...(maxTurns ? { maxTurns } : {}),
        status: parsed.status === "running" ? "stale" : parsed.status,
        staleReason:
          parsed.status === "running" ? "hydrate_running_agent_after_restart" : parsed.staleReason,
        summary:
          parsed.status === "running"
            ? `agent ${parsed.id} is stale/resumable after TUI restart; it was not marked completed.`
            : parsed.summary,
        updatedAt: now,
      };
      context.agents.push(agent);
      if (agent.status === "running" || agent.status === "stale") {
        const background = createAgentBackgroundTask(agent, context);
        syncBackgroundWithAgentStatus(background, agent);
        rememberBackgroundTask(context, background);
      }
      if (parsed.status === "running") {
        await persistAgentRun(context, agent);
      }
    } catch {}
  }
}

async function persistAgentRun(context: TuiContext, agent: AgentRun): Promise<void> {
  const dir = getAgentRunsDir(context);
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, `${agent.id}.json`), `${JSON.stringify(agent, null, 2)}\n`, "utf8");
}

export async function sendAgentMessage(
  context: TuiContext,
  input: {
    to?: string;
    name?: string;
    team?: string;
    teamName?: string;
    team_name?: string;
    message: string;
    from?: AgentMailboxMessage["from"];
  },
): Promise<{ ok: boolean; text: string; delivered: string[] }> {
  const target = input.to ?? input.name ?? input.team ?? input.teamName ?? input.team_name;
  const text = input.message.trim();
  if (!target || !text) {
    return { ok: false, text: "SendMessage requires target and non-empty message.", delivered: [] };
  }
  const targets = findMessageTargets(context, target);
  if (targets.length === 0) {
    return {
      ok: false,
      text: `SendMessage failed: no running agent/team found for "${target}".`,
      delivered: [],
    };
  }
  const now = new Date().toISOString();
  for (const agent of targets) {
    const message: AgentMailboxMessage = {
      id: `msg-${randomUUID().slice(0, 8)}`,
      from: input.from ?? "model",
      text,
      createdAt: now,
    };
    agent.mailbox.push(message);
    agent.updatedAt = now;
    await context.store.appendEvent(agent.transcriptSessionId, {
      type: "user_message",
      id: message.id,
      text,
      createdAt: now,
    });
    await persistAgentRun(context, agent);
  }
  const delivered = targets.map((agent) => agent.id);
  return {
    ok: true,
    text: `SendMessage delivered to ${delivered.join(", ")}; pending mailbox updated.`,
    delivered,
  };
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
    const label = truncateDisplay(
      agent.displayName ?? deriveAgentDisplayName(agent.type, agent.task),
      30,
    );
    const pending = countPendingMailbox(agent);
    const cwd = agent.cwd
      ? truncateDisplay(relative(context.projectPath, agent.cwd) || ".", 18)
      : ".";
    lines.push(
      `${agent.id}  ${label}  status ${agent.status}  type ${agent.type}  role ${agent.role}  name ${agent.addressableName ?? "-"}  team ${agent.teamName ?? "-"}  pending ${pending}  cwd ${cwd}`,
    );
  }
  lines.push(
    context.language === "en-US"
      ? "displayName is cosmetic only; role, permission mode, resource guard, evidence, and lifecycle stay unchanged."
      : "displayName 仅用于展示；role、权限模式、资源守卫、证据和生命周期不变。",
  );
  return lines.join("\n");
}

function formatAgentRegistryList(context: TuiContext): string {
  const lines = [context.language === "en-US" ? "Agent registry:" : "Agent registry："];
  if (context.agentRegistry.errors.length > 0) {
    lines.push("- registry schema errors:");
    for (const error of context.agentRegistry.errors) lines.push(`  - ${error}`);
  }
  if (context.agentRegistry.agents.length === 0) {
    lines.push(
      context.language === "en-US"
        ? "- no custom agents found under .linghun/agents"
        : "- .linghun/agents 下暂无自定义 agent",
    );
    return lines.join("\n");
  }
  for (const agent of context.agentRegistry.agents) {
    const tools = agent.allowedTools?.length ? `; tools ${agent.allowedTools.join(",")}` : "";
    const turns = agent.maxTurns ? `; max turns ${agent.maxTurns}` : "";
    const model = agent.model ? `; model ${agent.model}` : "";
    lines.push(`- ${agent.id} ${agent.name}: ${agent.description}${model}${tools}${turns}`);
  }
  return lines.join("\n");
}

function countPendingMailbox(agent: AgentRun): number {
  return agent.mailbox.filter((message) => !message.consumedAt).length;
}

function findMessageTargets(context: TuiContext, target: string): AgentRun[] {
  const normalized = target.trim();
  return context.agents.filter(
    (agent) =>
      agent.status === "running" &&
      (agent.id === normalized ||
        agent.id.endsWith(normalized) ||
        agent.addressableName === normalized ||
        agent.teamName === normalized),
  );
}

type ForkCommandOptions = {
  rawType?: string;
  type?: AgentType;
  task: string;
  name?: string;
  teamName?: string;
  runInBackground: boolean;
  cwd?: string;
  isolation?: "worktree";
};

function parseForkCommandArgs(args: string[]): ForkCommandOptions {
  const rawType = args[0];
  const type = isAgentType(rawType) ? rawType : undefined;
  const taskParts: string[] = [];
  const options: ForkCommandOptions = { rawType, type, task: "", runInBackground: false };
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--background") {
      options.runInBackground = true;
      continue;
    }
    if (
      (arg === "--name" ||
        arg === "--team" ||
        arg === "--team-name" ||
        arg === "--cwd" ||
        arg === "--isolation") &&
      args[index + 1]
    ) {
      const value = args[index + 1];
      index += 1;
      if (arg === "--name") options.name = value;
      if (arg === "--team" || arg === "--team-name") options.teamName = value;
      if (arg === "--cwd") options.cwd = value;
      if (arg === "--isolation" && value === "worktree") options.isolation = "worktree";
      continue;
    }
    taskParts.push(arg);
  }
  options.task = taskParts.join(" ").trim();
  return options;
}

function resolveForkRegistryAgent(
  context: TuiContext,
  rawType: string | undefined,
): TuiContext["agentRegistry"]["agents"][number] | undefined {
  if (!rawType) return undefined;
  return context.agentRegistry.agents.find(
    (agent) => agent.id === rawType || agent.name === rawType,
  );
}

function mapRegistryAgentType(agent: TuiContext["agentRegistry"]["agents"][number]): AgentType {
  return agent.allowedTools?.some(
    (tool) => tool === "Write" || tool === "Edit" || tool === "MultiEdit" || tool === "Bash",
  )
    ? "worker"
    : "planner";
}

async function resolveAgentCwd(
  context: TuiContext,
  options: ForkCommandOptions,
): Promise<
  | { ok: true; cwd: string; isolation?: "worktree"; evidenceText?: string }
  | { ok: false; text: string }
> {
  if (options.cwd && options.isolation === "worktree") {
    return { ok: false, text: "agent cwd and isolation=worktree are mutually exclusive." };
  }
  if (options.isolation === "worktree") {
    const name = options.name ?? `${options.type ?? "agent"}-${randomUUID().slice(0, 6)}`;
    const outcome = await createManagedWorktree(context.projectPath, { name });
    const summary = summarizeWorktreeCreateOutcome(outcome, context.language);
    if (!summary.ok || (outcome.kind !== "created" && outcome.kind !== "resumed")) {
      return { ok: false, text: summary.text };
    }
    return {
      ok: true,
      cwd: outcome.path,
      isolation: "worktree",
      evidenceText: `managed_worktree ${outcome.kind}: ${summary.text}`,
    };
  }
  const cwd = options.cwd ? resolve(context.projectPath, options.cwd) : context.projectPath;
  if (!isSafeAgentCwd(context.projectPath, cwd)) {
    return {
      ok: false,
      text:
        context.language === "en-US"
          ? `Illegal agent cwd rejected: ${options.cwd}. Use the workspace or a managed worktree.`
          : `已拒绝非法 agent cwd：${options.cwd}。只能使用工作区内路径或 managed worktree。`,
    };
  }
  return { ok: true, cwd };
}

function isSafeAgentCwd(projectPath: string, cwd: string): boolean {
  const project = resolve(projectPath);
  const normalized = resolve(cwd);
  return (
    normalized === project ||
    normalized.startsWith(`${project}\\`) ||
    normalized.startsWith(`${project}/`)
  );
}

async function runAgentToolInCwd(
  toolName: ToolName,
  input: unknown,
  agent: AgentRun,
  context: TuiContext,
): ReturnType<typeof runTool> {
  if (!agent.cwd || agent.cwd === context.projectPath) {
    return runTool(toolName, input, context.tools);
  }
  const previousSignal = context.tools.abortSignal;
  const scoped = createToolContext(agent.cwd);
  scoped.abortSignal = previousSignal;
  scoped.todos = context.tools.todos;
  const result = await runTool(toolName, input, scoped);
  context.tools.changedFiles.push(
    ...scoped.changedFiles.map((file) =>
      relative(context.projectPath, resolve(agent.cwd ?? context.projectPath, file)),
    ),
  );
  return result;
}

function createToolEndEvent(id: string, output: ToolOutput): TranscriptEvent {
  return {
    type: "tool_call_end",
    id,
    output,
    createdAt: new Date().toISOString(),
  };
}
