import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import type { Writable } from "node:stream";
import { type ModelRole, type RoleModelRoute, resolveStoragePaths } from "@linghun/config";
import {
  type EndpointProfile,
  type ModelGateway,
  type ModelMessage,
  type ModelRequest,
  type ModelToolCall,
  type ModelToolDefinition,
  resolveEffectiveEndpointProfile,
} from "@linghun/providers";
import { formatDiagnosticError, isNodeErrorWithCode } from "@linghun/shared";
import type { ToolName, ToolOutput, ToolRunResult } from "@linghun/tools";
import { builtInTools, createToolContext, runTool } from "@linghun/tools";
import {
  appendAgentCompletionSystemEvent,
  collectPendingAgentCompletionNotices,
  enqueueAgentCompletionNotice,
  formatAgentCompletionDigest,
  markAgentCompletionNoticeReported,
} from "./agent-completion-finalizer.js";
import {
  applyCacheWritePolicyToRequest,
  applyLastCacheSafePrefix,
  recordCacheRequestObservation,
  recordCacheUsageObservation,
  resolveCachePolicy,
} from "./cache-policy-runtime.js";
import { showCommandPanel } from "./command-panel-runtime.js";
import type {
  CompactPreflightRuntime,
  ProviderPreflightCompactResult,
} from "./compact-preflight-runtime.js";
import { createSilentOutput } from "./details-status-runtime.js";
import { appendSystemEvent, appendToolResultEvent, createToolEndEvent } from "./evidence-runtime.js";
import type { FailureLearningInput } from "./failure-learning-runtime.js";
import { createManagedWorktree } from "./git-operation-runtime.js";
import { summarizeWorktreeCreateOutcome } from "./git-tool-runtime.js";
import { loadOrCreateHandoffPacket, validateHandoffPacket } from "./handoff-session-runtime.js";
import { formatEngineeringProfileStrategyHint } from "./headless-bench-runtime.js";
import { createIndexStatusSnapshot, formatIndexRuntimeRef } from "./index-runtime.js";
import type { TuiContext } from "./index.js";
import {
  type MetaOrchestrationAction,
  handleProviderRetryForMetaOrchestration,
  recordMetaOrchestrationRuntimeEvent,
  resolveMetaOrchestrationAction,
} from "./meta-orchestration-runtime.js";
import {
  formatBackgroundTask,
  formatBackgroundTaskPanelDetails,
  formatBackgroundTaskPanelRow,
  formatJobRunnerInline,
  mapDurableJobToBackgroundResult,
  mapDurableJobToBackgroundStatus,
} from "./job-runner-presenter.js";
import {
  JOB_RECOVERY_HEARTBEAT_STALE_MS,
  type ParsedJobRunOptions,
  appendJobLog,
  createDurableJobAgents,
  deriveAgentDisplayName,
  estimateJobTokens,
  formatJobStatus,
  formatJobPanelSummary,
  getJobPanelTone,
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
import {
  AGENT_CONTROL_DESCRIPTION,
  AGENT_CONTROL_TOOL_NAME,
  type FinalAnswerClaimMatch,
  createAgentControlInputSchema,
  createModelToolDefinitionsForTools,
  evaluateStructuredFinalAnswerClaims,
} from "./model-loop-runtime.js";
import {
  checkProviderCooldown,
  clearProviderBreaker,
  formatCooldownMessage,
  withProviderRetry,
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
import type { CommandPanelRow, CommandPanelSection } from "./shell/types.js";
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
  isAgentCancellable,
  isAgentType,
  isRuntimeActiveBackgroundTask,
  listCancellableAgents,
  listDurableJobs,
  mapAgentBackgroundResult,
  registerBackgroundAbortController,
  rememberBackgroundTask,
  upsertJobBackgroundTask,
} from "./tui-agent-job-runtime.js";
import type {
  AgentCompletionStatus,
  AgentMailboxMessage,
  AgentRun,
  AgentType,
  BackgroundTaskState,
  DurableJobAgentStatus,
  DurableJobState,
  DurableJobStatus,
  EngineeringSignalSnapshot,
  EvidenceRecord,
  RoleHandoff,
  RoleRouteDecision,
  VerificationReport,
} from "./tui-data-types.js";
import { formatAgentDetails } from "./tui-details-runtime.js";
import { messages } from "./tui-messages.js";
import { formatRoutePauseMessage, resolveRoleRoute } from "./tui-model-runtime.js";
import { decidePermission } from "./tui-permission-runtime.js";
import { createVerificationPlan, runVerificationPlan } from "./verification-command-runtime.js";
import { getWorkflowRuns } from "./workflow-command-runtime.js";
import { isFallbackWorkspaceReferenceSnapshot } from "./workspace-reference-cache.js";

type AgentWorkResult = {
  status: "completed" | "failed" | "blocked";
  summary: string;
  evidenceRefs: string[];
};

type AgentWakeMode = "start" | "mailbox" | "permission_approved" | "resume";

type AgentDispatchKind = "durable-job" | "fork-agent";
export type AgentDispatchRuntimePolicy =
  | { action: "run" }
  | { action: "block"; reason: string }
  | { action: "degrade-job-create-only"; reason: string }
  | { action: "degrade-agent-role"; reason: string; type: AgentType };

function blockIntentShift(reason: string, shift: string): AgentDispatchRuntimePolicy {
  return { action: "block", reason: `${reason}; refusing to ${shift} without explicit confirmation` };
}

export function resolveAgentDispatchRuntimePolicy(
  action: Pick<
    MetaOrchestrationAction,
    "mode" | "reason" | "shouldAsk" | "shouldDegrade" | "shouldStop"
  >,
  input: { kind: AgentDispatchKind; type?: AgentType; start?: boolean },
): AgentDispatchRuntimePolicy {
  if (action.shouldStop || action.shouldAsk) {
    return { action: "block", reason: action.reason };
  }
  if (!action.shouldDegrade) {
    return { action: "run" };
  }
  if (input.kind === "durable-job" && input.start) {
    return blockIntentShift(action.reason, "turn a requested job start into create-only");
  }
  if (input.kind === "fork-agent" && input.type && input.type !== "planner") {
    return blockIntentShift(action.reason, `change requested ${input.type} agent into planner`);
  }
  return { action: "run" };
}

const AGENT_MAX_MODEL_TURNS = LINGHUN_MAX_AGENT_CHILD_TURNS;
export const AGENT_MAILBOX_MAX_MESSAGES = 20;
export const AGENT_MAILBOX_MAX_BYTES = 16_384;
export const AGENT_MAILBOX_CONSUME_BATCH = 3;
export const AGENT_TEAM_BROADCAST_MAX = 5;
const AGENT_PERMISSION_BRIDGE_TOOLS = new Set<ToolName>(["Bash", "Edit", "Write", "MultiEdit"]);
const AGENT_IDLE_STATUSES = new Set<AgentRun["status"]>(["idle", "completed"]);
const AGENT_ASSIGNABLE_STATUSES = new Set<AgentRun["status"]>(["running", "idle", "completed"]);
const FULL_CONTEXT_FORK_MARKER = "<linghun-full-context-fork>";

function getAgentRunsDir(context: TuiContext): string {
  return resolveStoragePaths(context.config, context.projectPath).agentRuns;
}

function snapshotEngineeringSignal(context: TuiContext): EngineeringSignalSnapshot {
  const signal = context.lastMetaSchedulerDecision?.policyDecision.engineeringSignal;
  if (!signal) {
    return {
      profile: "generic",
      strategyHint: formatEngineeringProfileStrategyHint("generic"),
    };
  }
  return {
    profile: signal.profile,
    strategyHint: signal.strategyHint,
    artifactTargets: signal.artifactTargets.slice(),
    ...(signal.failureCategory ? { failureCategory: signal.failureCategory } : {}),
    ...(signal.finalBoundaryHint ? { finalBoundaryHint: signal.finalBoundaryHint } : {}),
  };
}

function formatAgentCompletionSummary(agent: AgentRun, context: TuiContext): string {
  const text = messages[context.language];
  const elapsed = Date.now() - Date.parse(agent.startedAt);
  const sec = (elapsed / 1000).toFixed(1);
  const tokens = agent.cost.inputTokens + agent.cost.outputTokens;
  const tools = agent.mailbox.filter((m) => m.status === "consumed").length;
  const conclusion = truncateDisplay((agent.summary ?? "").replace(/\s+/g, " "), 120);
  return [
    `  ${text.r3CompletionDuration}: ${sec}s · ${text.r3TokensLabel} ${tokens} · ${text.r3CompletionTools} ${tools}`,
    `  ${text.r3CompletionConclusion}: ${conclusion}`,
  ].join("\n");
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
  recordAgentMailboxEvidence: (
    context: TuiContext,
    sessionId: string,
    agent: AgentRun,
    messages: AgentMailboxMessage[],
  ) => Promise<string | undefined>;
  recordAgentToolEvidence: (
    context: TuiContext,
    sessionId: string,
    agent: AgentRun,
    toolName: ToolName,
    output: ToolOutput,
    input: unknown,
  ) => Promise<string | undefined>;
  recordAgentToolFailureEvidence: (
    context: TuiContext,
    sessionId: string,
    agent: AgentRun,
    toolName: ToolName,
    summary: string,
  ) => Promise<string | undefined>;
  recordToolResultBudgetEvidence: (
    context: TuiContext,
    sessionId: string,
    record: ToolResultBudgetRecord,
  ) => Promise<string | undefined>;
  createAgentToolApproval: (input: {
    context: TuiContext;
    agent: AgentRun;
    toolCall: ModelToolCall;
    toolName: ToolName;
    parentSessionId: string;
    permission: Awaited<ReturnType<typeof decidePermission>>;
    output: Writable;
  }) => boolean;
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

function setAgentActivity(
  agent: AgentRun,
  activityStatus: NonNullable<AgentRun["activityStatus"]>,
  summary: string,
): void {
  agent.activityStatus = activityStatus;
  agent.activitySummary = truncateDisplay(summary.replace(/\s+/g, " "), 180);
  agent.updatedAt = new Date().toISOString();
}

function isAgentIdle(agent: Pick<AgentRun, "status" | "activityStatus">): boolean {
  return (
    AGENT_IDLE_STATUSES.has(agent.status) ||
    (agent.status === "running" && agent.activityStatus === "idle")
  );
}

function isAgentAssignable(agent: AgentRun): boolean {
  if (!AGENT_ASSIGNABLE_STATUSES.has(agent.status)) return false;
  if (agent.activeTask && agent.activeTask.status === "running") return false;
  if (agent.status === "running" && agent.activityStatus !== "idle") return false;
  return true;
}

function setAgentBusy(
  agent: AgentRun,
  summary: string,
  now: string = new Date().toISOString(),
): void {
  agent.status = "running";
  agent.activityStatus = "processing";
  agent.activitySummary = truncateDisplay(summary.replace(/\s+/g, " "), 180);
  if (agent.activeTask && agent.activeTask.status === "assigned") {
    agent.activeTask.status = "running";
  }
  agent.heartbeatAt = now;
  agent.updatedAt = now;
}

function setAgentIdle(
  agent: AgentRun,
  summary: string,
  now: string = new Date().toISOString(),
): void {
  agent.status = "idle";
  agent.summary = summary;
  agent.lastResultSummary = summary;
  agent.activityStatus = "idle";
  agent.activitySummary = truncateDisplay(summary.replace(/\s+/g, " "), 180);
  if (agent.activeTask) {
    agent.activeTask.status = "completed";
    agent.activeTask.completedAt = now;
    agent.activeTask.resultSummary = summary;
  }
  agent.activeTask = undefined;
  agent.updatedAt = now;
}

function ensureAgentBackgroundTask(agent: AgentRun, context: TuiContext): BackgroundTaskState {
  const existing = context.backgroundTasks.find((task) => task.id === agent.id);
  if (existing) return existing;
  const created = createAgentBackgroundTask(agent, context);
  rememberBackgroundTask(context, created);
  return created;
}

function clearAgentAbortController(context: TuiContext, agentId: string): void {
  context.backgroundAbortControllers?.delete(agentId);
}

function mapAgentCompletionStatusFromRun(agent: AgentRun): AgentCompletionStatus {
  if (agent.status === "cancelled" || agent.status === "failed" || agent.status === "stale")
    return agent.status;
  if (agent.status === "idle" && agent.lastTerminalStatus === "completed") return "completed";
  if (agent.lastTerminalStatus === "failed") return "failed";
  if (agent.lastTerminalStatus === "blocked") return "blocked";
  return "blocked";
}

async function enqueueAgentCompletionReturn(
  context: TuiContext,
  agent: AgentRun,
  task: BackgroundTaskState | undefined,
  status: AgentCompletionStatus,
  summary: string,
  evidenceRefs: string[] = [],
  parentSessionId?: string,
  workflowRunId?: string,
): Promise<void> {
  enqueueAgentCompletionNotice(context, {
    agent,
    task,
    status,
    summary,
    evidenceRefs,
    parentSessionId,
    workflowRunId,
  });
  const targetSession = parentSessionId ?? agent.parentSessionId ?? context.sessionId;
  if (!targetSession) return;
  const label = agent.displayName ?? agent.type ?? agent.id;
  await appendAgentCompletionSystemEvent(context, {
    agentId: agent.id,
    label,
    status,
    summary,
    targetSession,
    fallbackSession: context.sessionId ?? undefined,
  });
}

async function appendAgentLifecycleSystemEvent(
  context: TuiContext,
  agent: AgentRun,
  message: string,
  level: "info" | "warning" = "info",
): Promise<void> {
  await context.store.appendEvent(agent.transcriptSessionId, {
    type: "system_event",
    id: randomUUID(),
    level,
    message,
    createdAt: new Date().toISOString(),
  });
}

async function appendAgentTaskAssignmentEvent(
  context: TuiContext,
  parentSessionId: string,
  agent: AgentRun,
  task: NonNullable<AgentRun["activeTask"]>,
): Promise<void> {
  await appendAgentLifecycleSystemEvent(
    context,
    agent,
    `task_assignment:${task.id}; status=${task.status}; assignedBy=${task.assignedBy}; summary=${task.summary}`,
  );
  await context.store.appendEvent(parentSessionId, {
    type: "system_event",
    id: randomUUID(),
    level: "info",
    message: `agent_task_assignment:${agent.id}; task=${task.id}; status=${task.status}; summary=${task.summary}`,
    createdAt: new Date().toISOString(),
  });
}

async function enqueueAgentSystemMailbox(
  context: TuiContext,
  agent: AgentRun,
  text: string,
): Promise<void> {
  const now = new Date().toISOString();
  agent.mailbox = normalizeAgentMailbox(agent);
  trimAgentMailboxHistory(agent);
  const message: AgentMailboxMessage = {
    id: `msg-${randomUUID().slice(0, 8)}`,
    from: "system",
    to: agent.id,
    text: truncateDisplay(text.replace(/\s+/g, " "), 2_000),
    createdAt: now,
    status: "pending",
    summary: summarizeMailboxText(text),
  };
  agent.mailbox.push(message);
  trimAgentMailboxHistory(agent);
  await appendAgentLifecycleSystemEvent(
    context,
    agent,
    `mailbox_enqueued:${message.id}; kind=message; task=-; from=${message.from}; to=${message.to}; summary=${message.summary}`,
  );
}

function normalizeMailboxMessage(
  agent: AgentRun,
  message: AgentMailboxMessage,
): AgentMailboxMessage {
  const consumedAt = message.consumedAt;
  const failedAt = message.failedAt;
  const status = message.status ?? (failedAt ? "failed" : consumedAt ? "consumed" : "pending");
  return {
    ...message,
    to: message.to ?? agent.id,
    status,
    summary: message.summary ?? summarizeMailboxText(message.text),
  };
}

function normalizeAgentMailbox(agent: AgentRun): AgentMailboxMessage[] {
  return (agent.mailbox ?? [])
    .filter((message) => message && typeof message.id === "string")
    .map((message) => normalizeMailboxMessage(agent, message));
}

function summarizeMailboxText(text: string): string {
  return truncateDisplay(text.replace(/\s+/g, " ").trim(), 120);
}

function mailboxPendingMessages(agent: AgentRun): AgentMailboxMessage[] {
  agent.mailbox = normalizeAgentMailbox(agent);
  return agent.mailbox.filter((message) => message.status === "pending");
}

function mailboxPendingBytes(agent: AgentRun): number {
  return mailboxPendingMessages(agent).reduce(
    (total, message) => total + Buffer.byteLength(message.text, "utf8"),
    0,
  );
}

function trimAgentMailboxHistory(agent: AgentRun): void {
  if (agent.mailbox.length <= AGENT_MAILBOX_MAX_MESSAGES) return;
  const pending = agent.mailbox.filter((message) => message.status === "pending");
  const terminal = agent.mailbox.filter((message) => message.status !== "pending");
  agent.mailbox = [
    ...terminal.slice(-Math.max(0, AGENT_MAILBOX_MAX_MESSAGES - pending.length)),
    ...pending,
  ].slice(-AGENT_MAILBOX_MAX_MESSAGES);
}

function markMailboxMessagesFailed(
  agent: AgentRun,
  messages: AgentMailboxMessage[],
  error: string,
): void {
  const now = new Date().toISOString();
  for (const message of messages) {
    message.status = "failed";
    message.failedAt = now;
    message.error = truncateDisplay(error, 160);
  }
  setAgentActivity(agent, "blocked", `mailbox failed: ${truncateDisplay(error, 120)}`);
}

function formatAgentCandidate(agent: AgentRun): string {
  const labels = [
    agent.id,
    agent.addressableName ? `name=${agent.addressableName}` : undefined,
    agent.teamName ? `team=${agent.teamName}` : undefined,
    `status=${agent.status}`,
  ].filter(Boolean);
  return labels.join(" ");
}

function formatAgentCandidates(agents: AgentRun[]): string {
  return agents.map(formatAgentCandidate).join("; ");
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

async function refreshRunnerStatusForJob(context: TuiContext, job: DurableJobState): Promise<void> {
  await refreshRunnerStatusForJobImpl(toRunnerContext(context), job, getRunnerRuntimeDeps());
}

async function stopRunnerForDurableJob(context: TuiContext, job: DurableJobState): Promise<void> {
  await stopRunnerForDurableJobImpl(toRunnerContext(context), job, getRunnerRuntimeDeps());
}

export async function handleBackgroundCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  await hydrateDurableJobBackgroundTasks(context);
  deps().refreshBackgroundLifecycle(context);
  const action = args[0]?.toLowerCase();
  if (action === "clear" || action === "dismiss") {
    const { dismissBackgroundTask } = await import("./background-control-runtime.js");
    dismissBackgroundTask(args[1] ?? "", context, output);
    return;
  }
  const tasks = context.backgroundTasks
    .filter(isDefaultBackgroundListTask)
    .filter((task) => !context.dismissedBackgroundTaskIds?.has(task.id));
  // D.13Q-UX Task Surface — ink session 走降噪 CommandPanel；
  // plain TUI / 非交互保留旧 writeLine 行为，避免破坏既有字符串断言。
  if (context.isInkSession) {
    const isEn = context.language === "en-US";
    const total = tasks.length;
    if (total === 0) {
      showCommandPanel(context, output, {
        title: "/background",
        tone: "neutral",
        summary: [isEn ? "No background tasks." : "没有后台任务。"],
      });
      return;
    }
    const running = tasks.filter((t) => t.status === "running").length;
    const sleeping = tasks.filter((t) => t.status === "paused").length;
    const blocked = tasks.filter((t) => t.status === "blocked").length;
    const stale = tasks.filter((t) => t.status === "stale").length;
    const timeout = tasks.filter((t) => t.status === "timeout").length;
    const cancelled = tasks.filter((t) => t.status === "cancelled").length;
    const needsAttention = blocked + stale + timeout;
    const summary: string[] = [
      isEn
        ? `Tasks · ${running} running · ${sleeping} sleeping · ${blocked} blocked · ${stale} stale · ${timeout} timeout · ${cancelled} cancelled`
        : `任务 · running ${running} · sleeping ${sleeping} · blocked ${blocked} · stale ${stale} · timeout ${timeout} · cancelled ${cancelled}`,
    ];
    const sections = buildBackgroundPanelSections(tasks, context.language, context.projectPath);
    const detailsText = tasks
      .map((task) => formatBackgroundTaskPanelDetails(task, context.language, context.projectPath))
      .join("\n\n");
    showCommandPanel(context, output, {
      title: "/background",
      tone: needsAttention > 0 ? "warning" : "neutral",
      summary,
      sections,
      detailsText,
      cursor: 0,
      scrollOffset: 0,
      expanded: false,
    });
    return;
  }
  if (tasks.length === 0) {
    writeLine(output, context.language === "en-US" ? "No background tasks." : "没有后台任务。");
    return;
  }
  for (const task of tasks) {
    writeLine(output, formatBackgroundTask(task, context.language));
  }
}

function buildBackgroundPanelSections(
  tasks: TuiContext["backgroundTasks"],
  language: TuiContext["language"],
  projectPath?: string,
): CommandPanelSection[] {
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
  const sections: CommandPanelSection[] = [];
  const used = new Set<string>();
  for (const group of groups) {
    const grouped = tasks.filter((task) => task.kind === group.kind && !used.has(task.id));
    if (grouped.length === 0) continue;
    for (const task of grouped) used.add(task.id);
    sections.push({
      title: group.title,
      rows: grouped
        .slice(0, 4)
        .map((task) => createBackgroundPanelRow(task, language, projectPath)),
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
      rows: other.slice(0, 4).map((task) => createBackgroundPanelRow(task, language, projectPath)),
    });
  }
  return sections;
}

function createBackgroundPanelRow(
  task: BackgroundTaskState,
  language: TuiContext["language"],
  projectPath?: string,
): CommandPanelRow {
  const text = formatBackgroundTaskPanelRow(task, language);
  return {
    text,
    selectable: true,
    taskRef: {
      id: task.id,
      kind: task.kind === "agent" ? "agent" : task.kind === "job" ? "job" : "background",
    },
    detailsText: formatBackgroundTaskPanelDetails(task, language, projectPath),
  };
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
        "用法：/job run <goal> [--phase <phase>] [--target <target>] [--agents <n>] [--running-cap <n>] [--tokens <n>] [--max-steps <n>] [--timeout <ms>] [--allow-edit] [--allow-bash] [--multi-agent] [--isolation worktree]",
      );
      return;
    }
    const start = action === "run";
    const sessionId = await deps().ensureSession(context);
    const orchestrationAction = resolveMetaOrchestrationAction(context, "agent-dispatch");
    const policy = resolveAgentDispatchRuntimePolicy(orchestrationAction, {
      kind: "durable-job",
      start,
    });
    if (policy.action === "block") {
      await recordMetaOrchestrationRuntimeEvent(context, sessionId, {
        stepId: "agent-dispatch",
        status: "blocked",
        summary: `durable job dispatch blocked before start: ${policy.reason}`,
        level: "warning",
      });
      writeLine(output, `Agent dispatch blocked by meta scheduler: ${policy.reason}`);
      return;
    }
    const effectiveStart = policy.action === "degrade-job-create-only" ? false : start;
    if (policy.action === "degrade-job-create-only") {
      await recordMetaOrchestrationRuntimeEvent(context, sessionId, {
        stepId: "agent-dispatch",
        status: "degraded",
        summary: `durable job dispatch degraded to create-only: ${policy.reason}`,
        level: "warning",
      });
    }
    const job = await createDurableJob(context, options, effectiveStart);
    await persistDurableJobProgress(
      context,
      job,
      `job ${action}: ${job.status}; pause reason ${job.pauseReason ?? "none"}`,
    );
    if (effectiveStart && job.status === "running") {
      await startRunnerForDurableJob(context, job);
    }
    if (effectiveStart && job.status === "running") {
      await runDurableJobLiteTick(context, job);
      await persistDurableJobProgress(context, job, `job ${action}: final state ${job.status}`);
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
      await refreshRunnerStatusForJob(context, job);
      await persistDurableJob(job);
      await writeDurableJobReport(job);
      upsertJobBackgroundTask(context, job);
      // D.14D-E — /job status 走降噪 CommandPanel：完整状态进 detailsText。
      const panelSummary = formatJobPanelSummary(job, context.language, "status");
      showCommandPanel(context, output, {
        title: "/job status",
        tone: getJobPanelTone(job),
        summary: panelSummary,
        detailsText: formatJobStatus(job, context.language),
      });
      return;
    }
    if (action === "report") {
      await refreshRunnerStatusForJob(context, job);
      await persistDurableJob(job);
      await writeDurableJobReport(job);
      upsertJobBackgroundTask(context, job);
      // D.14D-E — /job report 走降噪 CommandPanel：完整报告进 detailsText。
      const panelSummary = formatJobPanelSummary(job, context.language, "report");
      showCommandPanel(context, output, {
        title: "/job report",
        tone: getJobPanelTone(job),
        summary: panelSummary,
        detailsText: formatJobReport(job, context.language),
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
        detailsText: await formatJobLogs(job, context.language),
      });
      return;
    }
    if (action === "pause") {
      const noop = formatPauseJobNoop(job, action, context);
      if (noop) {
        writeLine(output, noop);
        return;
      }
      await transitionDurableJob(job, context, "sleeping", "user_paused");
      writeLine(output, formatJobPrimaryWithAttention(job, context));
      return;
    }
    if (action === "resume") {
      const noop = formatResumeJobNoop(job, action, context);
      if (noop) {
        writeLine(output, noop);
        return;
      }
      await resumeDurableJob(job, context);
      writeLine(output, formatJobPrimaryWithAttention(job, context));
      return;
    }
    const noop = formatCancelJobNoop(job, action, context);
    if (noop) {
      writeLine(output, noop);
      return;
    }
    if (job.runner) {
      await stopRunnerForDurableJob(context, job);
    }
    await transitionDurableJob(job, context, "cancelled", "user_cancelled");
    writeLine(output, formatJobPrimaryWithAttention(job, context));
    return;
  }
  writeLine(
    output,
    "用法：/job list | /job run <goal> | /job create <goal> | /job status <id> | /job logs <id> | /job report <id> | /job pause <id> | /job resume <id> | /job cancel <id>",
  );
}

export async function handleBatchCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  if (args.length === 0) {
    writeLine(output, "用法：/batch <目标> [--agents <n>] [--cap <n>] [--max-steps <n>]");
    return;
  }
  await handleJobCommand(
    [
      "run",
      "--multi-agent",
      "--agents",
      "5",
      "--running-cap",
      "3",
      "--max-steps",
      "20",
      "--allow-edit",
      "--allow-bash",
      "--isolation",
      "worktree",
      ...args,
    ],
    context,
    output,
  );
}

function formatPauseJobNoop(
  job: DurableJobState,
  action: string,
  context: TuiContext,
): string | undefined {
  if (job.status === "running") return undefined;
  if (job.status === "sleeping") {
    return formatActiveJobNoop(job, action, context, "already paused/sleeping");
  }
  if (job.status === "blocked" || job.status === "stale") {
    return formatAttentionJobNoop(job, action, context);
  }
  if (isTerminalDurableJobStatus(job.status)) {
    return formatTerminalJobNoop(job, action, context);
  }
  return undefined;
}

function formatResumeJobNoop(
  job: DurableJobState,
  action: string,
  context: TuiContext,
): string | undefined {
  if (job.status === "running") {
    return formatActiveJobNoop(job, action, context, "already running");
  }
  if (isTerminalDurableJobStatus(job.status)) {
    return formatTerminalJobNoop(job, action, context);
  }
  return undefined;
}

function formatCancelJobNoop(
  job: DurableJobState,
  action: string,
  context: TuiContext,
): string | undefined {
  if (isTerminalDurableJobStatus(job.status)) {
    return formatTerminalJobNoop(job, action, context);
  }
  return undefined;
}

function isTerminalDurableJobStatus(status: DurableJobStatus): boolean {
  return (
    status === "cancelled" || status === "timeout" || status === "failed" || status === "completed"
  );
}

function formatJobPrimaryWithAttention(job: DurableJobState, context: TuiContext): string {
  const attention = formatAttentionJobNext(job, context);
  return attention
    ? `${formatJobPrimary(job, context)}\n${attention}`
    : formatJobPrimary(job, context);
}

function formatActiveJobNoop(
  job: DurableJobState,
  action: string,
  context: TuiContext,
  reason: string,
): string {
  if (context.language === "en-US") {
    return [
      `[job] ${job.id} · ${job.status} · unchanged`,
      `- ${action}: ${reason}; no lifecycle transition was written.`,
      `- next: /job report ${job.id}; /job logs ${job.id}; /job pause ${job.id}; /job cancel ${job.id}.`,
    ].join("\n");
  }
  return [
    `[job] ${job.id} · ${job.status} · 状态未改变`,
    `- ${action}：${reason}；未写入生命周期转换。`,
    `- next：/job report ${job.id}；/job logs ${job.id}；/job pause ${job.id}；/job cancel ${job.id}。`,
  ].join("\n");
}

function formatAttentionJobNoop(job: DurableJobState, action: string, context: TuiContext): string {
  return [
    context.language === "en-US"
      ? `[job] ${job.id} · ${job.status} · unchanged`
      : `[job] ${job.id} · ${job.status} · 状态未改变`,
    context.language === "en-US"
      ? `- ${action}: ${job.status} already needs attention; no lifecycle transition was written.`
      : `- ${action}：${job.status} 已停在需处理状态；未写入生命周期转换。`,
    `- pause reason: ${job.pauseReason ?? "no pause reason"}`,
    formatAttentionJobNext(job, context),
  ].join("\n");
}

function formatAttentionJobNext(job: DurableJobState, context: TuiContext): string | undefined {
  if (job.status !== "blocked" && job.status !== "stale") return undefined;
  const repair = job.status === "stale" ? "owner/heartbeat/runtime state" : "blocked reason";
  return context.language === "en-US"
    ? `- next: inspect /job report ${job.id} and /job logs ${job.id}; after fixing ${repair}, run /job resume ${job.id}, or /job cancel ${job.id}.`
    : `- next：先看 /job report ${job.id} 和 /job logs ${job.id}；修复 ${repair} 后用 /job resume ${job.id}，或用 /job cancel ${job.id} 放弃。`;
}

function formatTerminalJobNoop(job: DurableJobState, action: string, context: TuiContext): string {
  if (context.language === "en-US") {
    return [
      `Job ${job.id} is already ${job.status}; /job ${action} did not start a new action.`,
      "- lifecycle terminal states are not verification evidence.",
      `- next: inspect /job report ${job.id} or /job logs ${job.id}; create/run a new job if needed.`,
    ].join("\n");
  }
  return [
    `Job ${job.id} 已是 ${job.status}；/job ${action} 不会启动新动作。`,
    "- terminal lifecycle 不是验证证据。",
    `- 下一步：查看 /job report ${job.id} 或 /job logs ${job.id}；如需继续请新建/运行 job。`,
  ].join("\n");
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
      deps().checkBackgroundStartGuard(context, "job", false))
    : null;
  const runningCap = Math.max(1, options.runningCap ?? options.requestedAgents);
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
  const effectiveCap = status === "running" ? runningCap : 0;
  const capReason = formatInitialJobCapReason(status, {
    pauseReason,
    requestedAgents: options.requestedAgents,
    runningCap,
    preflight,
  });
  return {
    id,
    goal: options.goal,
    projectPath: resolve(context.projectPath),
    phase: options.phase,
    target: options.target,
    plan: options.plan,
    budget: {
      maxTokens: options.maxTokens,
      maxRunningAgents: runningCap,
      maxSteps: options.maxSteps,
      note:
        options.runningCap !== undefined
          ? `${runningCap} running agents requested for this job; resource guard still applies, not a default 3/4/20 user cap.`
          : `${runningCap} running agents derived from the requested agent count; resource guard still applies, not a default 3/4/20 user cap.`,
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
    isolation: options.isolation,
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
    verification: { status: "not_run", summary: "verification not run in default Lite job loop" },
    adoptedConclusions: [],
    rejectedConclusions:
      status === "blocked" || status === "sleeping"
        ? ["No evidence that verification passed is generated for blocked/sleeping jobs."]
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
      "Minimal job preflight snapshot: no verification command has run yet; read-only audit may start, and completion is not verification evidence.",
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
      "Job preflight generated minimal verification snapshot; it is not verification evidence.",
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
    return `dynamic cap requested ${input.runningCap}/${input.requestedAgents}; resource guard applies${suffix}`;
  }
  if (input.pauseReason) return input.pauseReason;
  if (status === "created") return "planned_not_started:/job create only";
  return `preflight_blocked:${input.preflight.missing.join(",") || "unknown"}`;
}

function resolveEffectiveJobAgentCap(job: DurableJobState): number {
  const runningJobAgents = job.agents.filter((agent) => agent.status === "running").length;
  return Math.max(0, job.budget.maxRunningAgents - runningJobAgents);
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
  const cwdResult =
    job.isolation === "worktree" && resolved.usable
      ? await createDurableJobAgentWorktree(context, job, assignment)
      : {
          ok: true as const,
          cwd: context.projectPath,
          isolation: undefined,
          evidenceText: undefined,
        };
  const child = await context.store.create({
    model: effectiveModel,
    summary: `job-agent:${job.id}:${assignment.type}:${truncateDisplay(task, 40)}`,
  });
  const packet = job.handoffPacket ?? (await loadOrCreateHandoffPacket(context, parentSessionId));
  const routeUsable = resolved.usable && cwdResult.ok;
  const blockedSummary = !resolved.usable
    ? formatRoutePauseMessage(role, resolved.decision)
    : cwdResult.ok
      ? "job child agent blocked"
      : cwdResult.text;
  const agent: AgentRun = {
    id: `agent-${randomUUID().slice(0, 8)}`,
    type: assignment.type,
    displayName: assignment.displayName,
    role,
    provider: resolved.route.provider || "unconfigured",
    parentSessionId,
    forkedFrom: packet.id,
    task,
    engineeringSignal: snapshotEngineeringSignal(context),
    model: effectiveModel,
    permissionMode: getAgentPermissionMode(assignment.type, context.permissionMode),
    status: routeUsable ? "running" : "blocked",
    activityStatus: routeUsable ? "processing" : "blocked",
    activitySummary: routeUsable ? "job child agent running" : "route/worktree unusable",
    transcriptPath: child.transcriptPath,
    transcriptSessionId: child.id,
    mailbox: [],
    cwd: cwdResult.ok ? cwdResult.cwd : context.projectPath,
    ...(cwdResult.ok && cwdResult.isolation ? { isolation: cwdResult.isolation } : {}),
    cancelTokenId: randomUUID(),
    heartbeatAt: routeUsable ? now : undefined,
    summary: routeUsable ? "job child agent running" : blockedSummary,
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
    message: `${agent.contextSummary} | cwd ${agent.cwd} | isolation ${agent.isolation ?? "none"}`,
    createdAt: now,
  });
  if (cwdResult.ok && cwdResult.evidenceText) {
    await context.store.appendEvent(child.id, {
      type: "system_event",
      id: randomUUID(),
      level: "info",
      message: cwdResult.evidenceText,
      createdAt: now,
    });
  }
  await deps().appendBackgroundTaskEvent(context, parentSessionId, background);
  if (agent.status !== "running") {
    writeLine(output, agent.summary);
  }
  return agent;
}

async function createDurableJobAgentWorktree(
  context: TuiContext,
  job: DurableJobState,
  assignment: DurableJobState["agents"][number],
): Promise<
  | { ok: true; cwd: string; isolation: "worktree"; evidenceText: string }
  | { ok: false; text: string }
> {
  const name = `${job.id}-${assignment.id}`.replace(/[^a-z0-9-]/giu, "-").slice(0, 48);
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
      : agent.status === "idle"
        ? agent.lastTerminalStatus === "failed"
          ? "failed"
          : agent.lastTerminalStatus === "blocked"
            ? "blocked"
            : "completed"
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
    await enqueueAgentCompletionReturn(
      context,
      agent,
      background,
      mapAgentCompletionStatusFromRun(agent),
      agent.summary,
      job.evidenceRefs.map((item) => item.id),
      agent.parentSessionId ?? job.ownerSessionId,
      background?.workflowRunId,
    );
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
      summary: `Resume refused for terminal ${job.status} job; no evidence that verification passed was generated.`,
      facts: [`terminal status ${job.status}`, job.pauseReason ?? "no pause reason"],
      evidenceRefs: job.evidenceRefs.map((item) => item.id),
      generatedAt: new Date().toISOString(),
    };
    job.rejectedConclusions = [
      ...job.rejectedConclusions,
      `Terminal ${job.status} job was not upgraded by resume and is not verification evidence.`,
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
    resolveEffectiveJobAgentCap(job),
    "resume_job_owned_dynamic_cap",
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
      summary: `Durable job moved to ${status}; no evidence that verification passed was generated.`,
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
      summary: `Durable job blocked; ${pauseReason ?? "no pause reason"}. No evidence that verification passed was generated.`,
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
  if (!context.sessionId) return;
  const jobs = await listDurableJobs(context);
  for (const job of jobs) {
    if (!isDurableJobOwnedBySession(job, context.sessionId)) continue;
    if (context.dismissedBackgroundTaskIds?.has(job.id)) {
      continue;
    }
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
    summary: `Recovered job moved to ${job.status}; no evidence that verification passed was generated.`,
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
    `Recovered ${job.status} job is conservative and not verification evidence.`,
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
    resolveEffectiveJobAgentCap(job),
    "runtime_job_owned_dynamic_cap",
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
        summary:
          "Durable worker stopped at maxSteps; no evidence that verification passed was generated.",
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
            "Durable worker stopped before the next step because maxTokens would be exceeded; no evidence that verification passed was generated.",
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
        summary: "Bounded worker output is structured but not verification evidence.",
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
            ? "Verifier agent produced verification/self-check evidence, but durable job lifecycle is not verification evidence."
            : "Agent output is partial until explicit verification/final gate evidence proves the work passed.",
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

    if (hasRunnableJobAgents(job)) {
      const afterStop = await applyDurableJobBudgetStop(
        context,
        job,
        `after_step_${job.budget.usedSteps ?? stepIndex + 1}`,
      );
      if (afterStop) {
        return;
      }
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
      "Job completion only means scheduled AgentRun subtasks ended; it is not verification evidence or smoke-ready proof.",
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
    "Completed job lifecycle only means the bounded worker loop ended; it is not verification evidence, not Beta readiness, and not smoke-ready proof.",
  ];
  rescheduleDurableJobAgents(job);
  await appendJobLog(job, `agent scheduler completed: session=${workerSession.id}`);
  await persistDurableJobProgress(
    context,
    job,
    "agent scheduler completed without verification evidence",
  );
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

  // P1-5: 任务完成时主动汇报
  if (job.status === "completed") {
    const sessionId = await deps().ensureSession(context);
    const jobLabel = formatJobPrimary(job, context);
    const completionMessage =
      context.language === "zh-CN"
        ? `任务 ${jobLabel} 已完成。详见任务列表。`
        : `Task ${jobLabel} completed. See task list for details.`;
    await appendSystemEvent(context, sessionId, completionMessage, "info");
  }
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
      summary:
        "Durable job exceeded maxRuntime/timeout; no evidence that verification passed was generated.",
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
    const idle = context.agents.filter(
      (a) => a.status === "idle" || a.status === "completed",
    ).length;
    const cancellable = listCancellableAgents(context);
    const pendingCompletions = collectPendingAgentCompletionNotices(context);
    showCommandPanel(context, output, {
      title: "/agents",
      tone: pendingCompletions.some((notice) => notice.validity === "invalid")
        ? "warning"
        : "neutral",
      summary: [
        isEn
          ? `Agents · ${running} running now · ${idle} current-session idle/completed · ${total} historical loaded · ${cancellable.length} cancellable · ${pendingCompletions.length} returned result(s) pending — Ctrl+O for details.`
          : `Agents：当前运行 ${running} · 当前会话空闲/完成 ${idle} · 历史已加载 ${total} · 可取消 ${cancellable.length} · 待处理回流 ${pendingCompletions.length} — Ctrl+O 查看详情。`,
      ],
      actions:
        pendingCompletions.length > 0
          ? [
              "/agents completions",
              "/agents show <id>",
              "/agents cancel <id>",
              "/agents cancel all",
            ]
          : cancellable.length > 0
            ? ["/agents show <id>", "/agents cancel <id>", "/agents cancel all"]
            : total > 0
              ? ["/agents show <id>"]
              : context.agentRegistry.agents.length > 0
                ? [
                    "/agents registry",
                    "/fork explorer|planner|verifier|worker|<custom-agent-id> <task>",
                  ]
                : ["/fork explorer|planner|verifier|worker <task>"],
      detailsText: formatAgentsList(context),
    });
    return;
  }
  if (action === "completions" || action === "returns") {
    const pending = collectPendingAgentCompletionNotices(context);
    const digest = formatAgentCompletionDigest(context);
    if (!digest) {
      writeLine(
        output,
        context.language === "en-US"
          ? "No unreported agent result returns."
          : "没有未汇报的 agent 结果回流。",
      );
      return;
    }
    showCommandPanel(context, output, {
      title: "/agents completions",
      tone: pending.some((notice) => notice.validity === "invalid") ? "warning" : "neutral",
      summary: digest.split("\n").slice(0, 2),
      actions: ["/agents show <id>", "/background", "/details"],
      detailsText: digest,
    });
    const now = new Date().toISOString();
    for (const notice of pending) markAgentCompletionNoticeReported(context, notice.id, now);
    return;
  }
  if (action === "send") {
    const parsed = parseAgentsSendArgs(args.slice(1));
    if (!parsed) {
      writeLine(
        output,
        "用法：/agents send <id|name> <message> 或 /agents send --team <team> <message>",
      );
      return;
    }
    const result = await sendAgentMessage(context, { ...parsed, from: "user" });
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
    const ref = args[1]?.trim();
    if (ref === "all" || ref === "*" || ref === "--all") {
      await cancelAllAgents(context, output);
      return;
    }
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
    "用法：/agents | /agents registry | /agents completions | /agents show <id> | /agents resume <id> | /agents cancel <id>|all | /agents send <id|name> <message> | /agents send --team <team> <message>",
  );
}

function parseAgentsSendArgs(
  args: string[],
): { to?: string; team?: string; message: string } | undefined {
  if (args[0] === "--team" || args[0] === "--team-name") {
    const team = args[1]?.trim();
    const message = args.slice(2).join(" ").trim();
    return team && message ? { team, message } : undefined;
  }
  const target = args[0]?.trim();
  const message = args.slice(1).join(" ").trim();
  return target && message ? { to: target, message } : undefined;
}

export async function handleForkCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
  runtimeOptions: { workflowRunId?: string; engineeringSignal?: EngineeringSignalSnapshot } = {},
): Promise<void> {
  const options = parseForkCommandArgs(args);
  const registryAgent = resolveForkRegistryAgent(context, options.rawType);
  const type = registryAgent ? mapRegistryAgentType(registryAgent) : options.type;
  const task = options.task;
  if (!type || !isAgentType(type) || !task) {
    const baseHelp =
      "用法：/fork explorer|planner|verifier|worker|<custom-agent-id> <task> [--background] [--name <name>] [--team <team>] [--cwd <path>] [--isolation worktree]";
    const registryHint =
      context.agentRegistry.agents.length > 0
        ? `\n已加载 ${context.agentRegistry.agents.length} 个自定义 agent，/agents registry 查看详情。`
        : "\n暂无自定义 agent，可在 .linghun/agents/ 下放置 JSON/MD 定义文件。";
    writeLine(output, `${baseHelp}${registryHint}`);
    return;
  }
  const requestedType: AgentType = type;
  let effectiveType: AgentType = requestedType;
  const workflowTaskId =
    runtimeOptions.workflowRunId ??
    getWorkflowRuns(context).find((run) => run.status === "running")?.id;
  const engineeringSignal = runtimeOptions.engineeringSignal ?? snapshotEngineeringSignal(context);
  const guard = deps().checkBackgroundStartGuard(context, "agent", false, workflowTaskId);
  if (guard) {
    writeLine(output, guard);
    return;
  }

  const parentSessionId = await deps().ensureSession(context);
  const orchestrationAction = resolveMetaOrchestrationAction(context, "agent-dispatch");
  const policy = resolveAgentDispatchRuntimePolicy(orchestrationAction, {
    kind: "fork-agent",
    type: requestedType,
    start: true,
  });
  if (policy.action === "block") {
    await recordMetaOrchestrationRuntimeEvent(context, parentSessionId, {
      stepId: "agent-dispatch",
      status: "blocked",
      summary: `agent fork blocked before start: ${policy.reason}`,
      level: "warning",
    });
    writeLine(output, `Agent dispatch blocked by meta scheduler: ${policy.reason}`);
    return;
  }
  if (policy.action === "degrade-agent-role") {
    effectiveType = policy.type;
    await recordMetaOrchestrationRuntimeEvent(context, parentSessionId, {
      stepId: "agent-dispatch",
      status: "degraded",
      summary: `agent fork degraded from ${requestedType} to ${effectiveType}: ${policy.reason}`,
      level: "warning",
    });
  }
  const packet = await loadOrCreateHandoffPacket(context, parentSessionId);
  const cwdResult = await resolveAgentCwd(context, options);
  if (!cwdResult.ok) {
    writeLine(output, cwdResult.text);
    return;
  }
  const role = getAgentRole(effectiveType);
  const effectiveTask = registryAgent ? `${registryAgent.prompt}\n\nTask: ${task}` : task;
  const resolved = resolveRoleRoute(context, role, `/fork ${effectiveType}`);
  await deps().appendRouteDecisionEvent(context, parentSessionId, resolved.decision);
  if (!resolved.usable) {
    writeLine(output, formatRoutePauseMessage(role, resolved.decision));
    return;
  }
  const route = resolved.route;
  const effectiveModel = registryAgent?.model ?? route.primaryModel ?? context.model;
  const cooldown = checkProviderCooldown(
    context.providerBreaker,
    route.provider ?? "unconfigured",
    effectiveModel,
    "sidechain",
  );
  if (cooldown.blocked) {
    const message = formatCooldownMessage(
      route.provider ?? "unconfigured",
      effectiveModel,
      cooldown.remainingMs,
      context.language,
      cooldown.reasonCode,
    );
    writeLine(output, message);
    return;
  }
  const registryAllowedTools = normalizeRegistryAllowedTools(registryAgent?.allowedTools);
  const registryMaxTurns = normalizeRegistryAgentMaxTurns(registryAgent?.maxTurns);
  const child = await context.store.create({
    model: effectiveModel,
    summary: `agent:${effectiveType}:${truncateDisplay(task, 60)}`,
  });
  const now = new Date().toISOString();
  const agent: AgentRun = {
    id: `agent-${randomUUID().slice(0, 8)}`,
    type: effectiveType,
    displayName: deriveAgentDisplayName(effectiveType, task),
    addressableName: options.name ?? registryAgent?.name,
    teamName: options.teamName,
    role,
    provider: route.provider || "unconfigured",
    parentSessionId,
    forkedFrom: packet.id,
    task: effectiveTask,
    ...(options.contextMode ? { contextMode: options.contextMode } : {}),
    engineeringSignal,
    model: effectiveModel,
    ...(registryAgent ? { registryAgentId: registryAgent.id } : {}),
    ...(registryAllowedTools ? { allowedTools: registryAllowedTools } : {}),
    ...(registryMaxTurns ? { maxTurns: registryMaxTurns } : {}),
    permissionMode: getAgentPermissionMode(effectiveType, context.permissionMode),
    status: "running",
    activityStatus: "processing",
    activitySummary: "agent running",
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
  const background = createAgentBackgroundTask(agent, context);
  if (workflowTaskId) background.workflowRunId = workflowTaskId;
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
      void completeAgent(agent, background, context, output).catch((error: unknown) => {
        const message = `background agent complete failed: ${error instanceof Error ? error.message : String(error)}`;
        background.status = "failed";
        background.result = "fail";
        background.currentStep = message;
        background.updatedAt = new Date().toISOString();
        background.userVisibleSummary = message;
        void deps()
          .appendBackgroundTaskEvent(context, parentSessionId ?? "", background)
          .catch(() => undefined);
      });
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
  wakeMode: AgentWakeMode = "start",
): Promise<void> {
  const parentSessionId = agent.parentSessionId ?? (await deps().ensureSession(context));
  const statusBeforeRun = agent.status;
  if (statusBeforeRun !== "running" && !isAgentIdle(agent)) {
    writeLine(output, `agent ${agent.id} 当前状态为 ${agent.status}，不会派发新任务。`);
    syncBackgroundWithAgentStatus(task, agent);
    await deps().appendBackgroundTaskEvent(context, parentSessionId, task);
    return;
  }
  setAgentBusy(agent, `${wakeMode} processing; pending mailbox ${countPendingMailbox(agent)}`);
  syncBackgroundWithAgentStatus(task, agent);
  await deps().appendBackgroundTaskEvent(context, parentSessionId, task);
  let result: AgentWorkResult;
  try {
    result = await runAgentWork(agent, context, output);
  } catch (error) {
    if (agent.status === "stale") {
      await enqueueAgentCompletionReturn(
        context,
        agent,
        task,
        "stale",
        agent.summary,
        [],
        parentSessionId,
        task.workflowRunId,
      );
      await persistAgentRun(context, agent);
      await deps().appendBackgroundTaskEvent(context, parentSessionId, task);
      return;
    }
    await failAgent(agent, task, context, output, parentSessionId, error);
    return;
  }
  if (agent.status === "cancelled" || agent.status === "stale") {
    if (agent.status === "stale") {
      await enqueueAgentCompletionReturn(
        context,
        agent,
        task,
        "stale",
        agent.summary,
        [],
        parentSessionId,
        task.workflowRunId,
      );
    }
    await persistAgentRun(context, agent);
    return;
  }
  const now = new Date().toISOString();
  agent.status = result.status;
  agent.summary = result.summary;
  if (result.status === "completed") {
    agent.lastTerminalStatus = "completed";
    setAgentIdle(agent, result.summary, now);
  } else {
    agent.lastTerminalStatus = result.status === "failed" ? "failed" : "blocked";
    setAgentActivity(agent, "blocked", result.summary);
    if (agent.activeTask) {
      agent.activeTask.status = "blocked";
      agent.activeTask.resultSummary = result.summary;
    }
    agent.updatedAt = now;
  }
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
  await enqueueAgentCompletionReturn(
    context,
    agent,
    task,
    result.status,
    result.summary,
    result.evidenceRefs,
    parentSessionId,
    task.workflowRunId,
  );
  await persistAgentRun(context, agent);
  await deps().appendBackgroundTaskEvent(context, parentSessionId, task);
  clearAgentAbortController(context, agent.id);
  writeLine(output, formatAgentSummary(agent, context));
  writeLine(output, formatAgentCompletionSummary(agent, context));
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
  agent.lastTerminalStatus = "failed";
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
  await enqueueAgentCompletionReturn(
    context,
    agent,
    task,
    "failed",
    agent.summary,
    [],
    parentSessionId,
    task.workflowRunId,
  );
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
  await recordMetaOrchestrationRuntimeEvent(context, agent.parentSessionId ?? context.sessionId, {
    stepId: "agent-dispatch",
    executor: "agent-runtime",
    status: "consumed",
    summary: `agent=${agent.id}; type=${agent.type}; task=${agent.task}`,
  });
  let result: AgentWorkResult;
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
    const hasRealVerificationPass = report.commands.some(
      (command) => command.status === "pass" && command.synthetic !== true,
    );
    const summary =
      report.status === "pass" && !hasRealVerificationPass
        ? `verifier 已完成 synthetic self-check；真实验证未运行；任务「${agent.task}」。`
        : `verifier 已运行验证，结果 ${report.status.toUpperCase()}；任务「${agent.task}」。`;
    const fullReport = `验证报告：\n${report.commands.map((cmd) => `${cmd.kind}: ${cmd.status} (${cmd.durationMs}ms)\n${cmd.summary}`).join("\n")}`;
    agent.lastResultFullReport = fullReport;
    result = {
      status:
        report.status === "pass" ? "completed" : report.status === "fail" ? "failed" : "blocked",
      summary,
      evidenceRefs: [],
    };
  } else {
    result = await runModelBackedAgent(agent, context, output);
  }
  await recordMetaOrchestrationRuntimeEvent(context, agent.parentSessionId ?? context.sessionId, {
    stepId: "agent-dispatch",
    executor: "agent-runtime",
    status: result.status === "completed" ? "completed" : result.status === "failed" ? "failed" : "blocked",
    summary: `agent=${agent.id}; status=${result.status}; ${result.summary}`,
    level: result.status === "completed" ? "info" : "warning",
  });
  return result;
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

function resolveAgentRuntimeForModel(
  context: TuiContext,
  baseRuntime: AgentProviderRuntime,
  model: string,
): AgentProviderRuntime {
  const providerConfig = context.config.providers[baseRuntime.provider];
  const rawEndpointProfile = providerConfig?.endpointProfile ?? baseRuntime.endpointProfile;
  const endpointProfile = resolveEffectiveEndpointProfile({
    requestEndpointProfile: undefined,
    configEndpointProfile: rawEndpointProfile,
    configBaseUrl: providerConfig?.baseUrl,
    configModel: providerConfig?.model,
    requestModel: model,
  }).endpointProfile;
  const compatibilityProfile =
    providerConfig?.compatibilityProfile ??
    (providerConfig?.type === "deepseek" ? "deepseek" : "strict_openai_compatible");
  const reasoningLevel = providerConfig?.reasoningLevel ?? baseRuntime.reasoningLevel;
  const reasoningSent = Boolean(
    reasoningLevel &&
      (endpointProfile === "responses" ||
        compatibilityProfile === "permissive_openai_compatible" ||
        endpointProfile === "anthropic_messages"),
  );
  return {
    provider: baseRuntime.provider,
    model,
    endpointProfile,
    reasoningLevel,
    reasoningSent,
  };
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
  const endpointProfile = resolveEffectiveEndpointProfile({
    requestEndpointProfile: undefined,
    configEndpointProfile: rawEndpointProfile,
    configBaseUrl: providerConfig.baseUrl,
    configModel: providerConfig.model,
    requestModel: fallbackModel,
  }).endpointProfile;
  const compatibilityProfile =
    providerConfig.compatibilityProfile ??
    (providerConfig.type === "deepseek" ? "deepseek" : "strict_openai_compatible");
  const reasoningLevel = providerConfig.reasoningLevel;
  const reasoningSent = Boolean(
    reasoningLevel &&
      (endpointProfile === "responses" ||
        compatibilityProfile === "permissive_openai_compatible" ||
        endpointProfile === "anthropic_messages"),
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
  let currentRuntime = resolveAgentRuntimeForModel(
    context,
    continuation,
    agent.model || continuation.model,
  );
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
    const mailbox = await consumeAgentMailbox(agent, context, parentSessionId);
    if (mailbox.length > 0) await persistAgentRun(context, agent);
    for (const message of mailbox) {
      messages.push({
        role: "user",
        content: `Mailbox ${message.kind ?? "message"} ${message.id}${message.taskId ? ` task ${message.taskId}` : ""} from ${message.from} to ${message.to}: ${message.text}`,
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
      let retryWithFallback = false;
      let providerRequest: ModelRequest = applyCacheWritePolicyToRequest(
        {
          messages: preflight.messages,
          model: currentRuntime.model,
          endpointProfile: currentRuntime.endpointProfile,
          requestContext: "agent",
          ...(currentRuntime.reasoningSent
            ? { reasoningLevel: currentRuntime.reasoningLevel }
            : {}),
          tools: createAgentToolDefinitions(agent),
          toolChoice: "auto",
        },
        resolveCachePolicy("agent-child"),
      );
      providerRequest = applyAgentCacheSafePrefix(context, agent, providerRequest);
      providerRequest = applyCacheWritePolicyToRequest(
        providerRequest,
        resolveCachePolicy("agent-child"),
      );
      recordCacheRequestObservation(
        context.cache,
        "agent-child",
        currentRuntime.provider,
        providerRequest,
      );
      for await (const event of withProviderRetry(
        continuation.gateway,
        context.providerBreaker,
        currentRuntime.provider,
        providerRequest,
        signal,
        {
          cooldownScope: "sidechain",
          onRetry: (info) =>
            handleProviderRetryForMetaOrchestration(context, agent.transcriptSessionId, info),
        },
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
          recordCacheUsageObservation(context.cache, event.usage, "agent-child");
          continue;
        }
        if (event.type === "error") {
          const code = event.error.code ?? "PROVIDER_ERROR";
          const kind = classifyProviderFailure(event.error);
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
              "sidechain",
            );
            if (fallbackCooldown.blocked) {
              const message = formatCooldownMessage(
                fallback.runtime.provider,
                fallback.runtime.model,
                fallbackCooldown.remainingMs,
                context.language,
                fallbackCooldown.reasonCode,
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
        // Clear breaker on every successful agent provider request.
        clearProviderBreaker(
          context.providerBreaker,
          currentRuntime.provider,
          currentRuntime.model,
          "sidechain",
        );
        if (activeFallback) {
          syncAgentRuntimeFallbackMetadata(context, agent, activeFallback.from, activeFallback.to);
          await persistAgentRun(context, agent);
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
      if (agent.status === "blocked") {
        return {
          status: "blocked",
          summary: agent.summary || result.text,
          evidenceRefs: result.evidenceId ? [result.evidenceId] : [],
        };
      }
      if (result.pendingApproval) {
        return {
          status: "blocked",
          summary: `${agent.type} blocked：${result.tool} 需要用户确认，agent loop 已停止并回灌 tool_result。`,
          evidenceRefs: result.evidenceId ? [result.evidenceId] : [],
        };
      }
    }
  }
  if (!finalText) {
    return {
      status: "blocked",
      summary: `${agent.type} blocked：agent child stopped at an internal safety cap without a final answer.`,
      evidenceRefs: [],
    };
  }
  agent.lastResultFullReport = finalText;
  const summaryGate = evaluateChildAgentSummaryClaims(
    finalText,
    context.evidence,
    context.language,
  );
  if (summaryGate.status === "downgraded") {
    await context.store.appendEvent(agent.transcriptSessionId, {
      type: "system_event",
      id: randomUUID(),
      level: "warning",
      message: `child_summary_claim_gate: downgraded unsupported claims; missing ${summaryGate.missingEvidenceKinds.join(", ") || "matching evidence"}`,
      createdAt: new Date().toISOString(),
    });
  }
  return {
    status: "completed",
    summary: `${agent.type} completed：${truncateDisplay(summaryGate.text, 500)}`,
    evidenceRefs: [],
  };
}

export function evaluateChildAgentSummaryClaims(
  text: string,
  evidence: EvidenceRecord[],
  language: TuiContext["language"],
): {
  status: "passed" | "downgraded";
  text: string;
  missingEvidenceKinds: string[];
  unsupportedKinds: string[];
} {
  const claims = detectChildAgentSummaryClaims(text);
  if (claims.length === 0) {
    return { status: "passed", text, missingEvidenceKinds: [], unsupportedKinds: [] };
  }
  const verdict = evaluateStructuredFinalAnswerClaims(claims, evidence, new Date(), text);
  if (verdict.status === "passed") {
    return { status: "passed", text, missingEvidenceKinds: [], unsupportedKinds: [] };
  }
  const missing = formatChildAgentEvidenceBoundary(verdict.unsupportedKinds, language);
  const safeText =
    language === "en-US"
      ? [
          "Child agent completed its run; its high-risk claim was cleaned against the current evidence boundary before reporting.",
          `Evidence still needed: ${missing}.`,
          "Use the child transcript, tool results, or verification evidence before treating the original claim as proven.",
        ].join("\n")
      : [
          "子 agent 已完成本次运行；其高风险结论已按当前证据边界清洗后回流。",
          `仍需证据：${missing}。`,
          "请先查看子 transcript、工具结果或验证 evidence，再把原始结论当作已证明事实。",
        ].join("\n");
  return {
    status: "downgraded",
    text: safeText,
    missingEvidenceKinds: verdict.missingEvidenceKinds,
    unsupportedKinds: verdict.unsupportedKinds,
  };
}

function formatChildAgentEvidenceBoundary(
  kinds: string[],
  language: TuiContext["language"],
): string {
  const labels = new Set<string>();
  for (const kind of kinds) {
    if (/completion|pass|test|typecheck|build|lint|verification|verified/iu.test(kind)) {
      labels.add(language === "en-US" ? "verification or test evidence" : "验证或测试证据");
    } else if (/artifact|file|report|write/iu.test(kind)) {
      labels.add(language === "en-US" ? "artifact or file-change evidence" : "产物或文件变更证据");
    } else if (/workflow|agent/iu.test(kind)) {
      labels.add(language === "en-US" ? "terminal workflow or agent evidence" : "终态 workflow 或 agent 证据");
    } else if (/git|commit|branch|push/iu.test(kind)) {
      labels.add(language === "en-US" ? "Git operation evidence" : "Git 操作证据");
    } else {
      labels.add(language === "en-US" ? "matching evidence" : "匹配证据");
    }
  }
  return Array.from(labels).join(language === "en-US" ? ", " : "、") ||
    (language === "en-US" ? "matching evidence" : "匹配证据");
}

function detectChildAgentSummaryClaims(text: string): FinalAnswerClaimMatch[] {
  const claims: FinalAnswerClaimMatch[] = [];
  const seen = new Set<string>();
  const add = (kind: FinalAnswerClaimMatch["kind"], phrase: string): void => {
    const key = `${kind}\u0000${phrase}`;
    if (seen.has(key)) return;
    seen.add(key);
    claims.push({ kind, phrase });
  };
  const patterns: Array<{ kind: FinalAnswerClaimMatch["kind"]; pattern: RegExp }> = [
    {
      kind: "test_claim",
      pattern: /测试(?:已)?通过|tests?\s+passed|pytest\s+passed|vitest\s+passed|jest\s+passed/iu,
    },
    {
      kind: "completion_pass",
      pattern:
        /(?:typecheck|type\s+check|tsc|build|smoke|测试|构建|类型检查|冒烟).{0,32}(?:PASS|passed|通过)|\bPASS\b/iu,
    },
    {
      kind: "verification_claim",
      pattern: /验证(?:已)?通过|verification\s+passed|verified\s+pass|verified\s+success/iu,
    },
    {
      kind: "file_change_claim",
      pattern:
        /(?:已|已经)?(?:修复|修改|写入|更新)(?:完成|成功|好了)?|fixed\b|implemented\b|wrote\b|updated\b/iu,
    },
  ];
  for (const { kind, pattern } of patterns) {
    const match = pattern.exec(text);
    if (match?.[0]) add(kind, match[0]);
  }
  return claims;
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
    agent.status = "blocked";
    agent.summary = text;
    setAgentActivity(agent, "blocked", text);
    const background = ensureAgentBackgroundTask(agent, context);
    syncBackgroundWithAgentStatus(background, agent);
    await deps().appendBackgroundTaskEvent(context, parentSessionId, background);
    await persistAgentRun(context, agent);
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
    let pendingApproval = false;
    if (permission.decision === "ask") {
      if (AGENT_PERMISSION_BRIDGE_TOOLS.has(toolName)) {
        pendingApproval = deps().createAgentToolApproval({
          context,
          agent,
          toolCall,
          toolName,
          parentSessionId,
          permission,
          output,
        });
        if (pendingApproval) {
          agent.status = "blocked";
          agent.summary = `${toolName} 需要用户确认，agent loop 已停止并回灌 tool_result。`;
          setAgentActivity(agent, "blocked", `${toolName} waiting for parent approval`);
          const background = ensureAgentBackgroundTask(agent, context);
          syncBackgroundWithAgentStatus(background, agent);
          await deps().appendBackgroundTaskEvent(context, parentSessionId, background);
          await persistAgentRun(context, agent);
          await context.store.appendEvent(agent.transcriptSessionId, {
            type: "system_event",
            id: randomUUID(),
            level: "warning",
            message: `agent_permission_pending:${toolCall.id}; tool=${toolName}; parentSession=${parentSessionId}`,
            createdAt: new Date().toISOString(),
          });
        }
      } else {
        await context.store.appendEvent(agent.transcriptSessionId, {
          type: "system_event",
          id: randomUUID(),
          level: "warning",
          message: `agent_permission_not_bridged:${toolCall.id}; tool=${toolName}`,
          createdAt: new Date().toISOString(),
        });
      }
    }
    await appendAgentToolResultEvent(agent, context, toolCall.id, toolName, text, true);
    return {
      ok: false,
      tool: toolName,
      text,
      pendingApproval,
    };
  }
  if (permission.preflight) {
    writeLine(output, permission.preflight);
  }
  let result: ToolRunResult;
  try {
    result = await runAgentToolInCwd(toolName, toolCall.input, agent, context);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    await appendAgentToolResultEvent(agent, context, toolCall.id, toolName, text, true);
    return {
      ok: false,
      tool: toolName,
      text,
    };
  }
  await appendAgentToolEvents(agent, context, toolName, toolCall.input, result.output, toolCall.id);
  const evidenceId = shouldRecordAgentToolEvidence(toolName)
    ? await deps().recordAgentToolEvidence(
        context,
        parentSessionId,
        agent,
        toolName,
        result.output,
        toolCall.input,
      )
    : undefined;
  const failed = isAgentToolOutputFailure(toolName, result.output);
  return {
    ok: !failed,
    tool: toolName,
    text: result.output.text,
    data: result.output.data,
    evidenceId,
  };
}

function shouldRecordAgentToolEvidence(toolName: ToolName): boolean {
  return (
    toolName === "Bash" || toolName === "Write" || toolName === "Edit" || toolName === "MultiEdit"
  );
}

export async function executeApprovedAgentToolUse(
  agent: AgentRun,
  toolCall: ModelToolCall,
  toolName: ToolName,
  context: TuiContext,
  parentSessionId: string,
): Promise<{
  ok: boolean;
  tool: string;
  text: string;
  data?: unknown;
  evidenceId?: string;
  continued?: boolean;
}> {
  const now = new Date().toISOString();
  if (!AGENT_PERMISSION_BRIDGE_TOOLS.has(toolName)) {
    const text = `Agent permission bridge does not execute ${toolName}; supported tools: Bash, Edit, Write, MultiEdit.`;
    const evidenceId = await deps().recordAgentToolFailureEvidence(
      context,
      parentSessionId,
      agent,
      toolName,
      text,
    );
    await appendAgentToolResultEvent(agent, context, toolCall.id, toolName, text, true);
    setAgentActivity(agent, "blocked", text);
    agent.summary = text;
    await persistAgentRun(context, agent);
    return { ok: false, tool: toolName, text, evidenceId };
  }
  const background = ensureAgentBackgroundTask(agent, context);
  try {
    await context.store.appendEvent(agent.transcriptSessionId, {
      type: "system_event",
      id: randomUUID(),
      level: "info",
      message: `agent_permission_approved:${toolCall.id}; tool=${toolName}; parentSession=${parentSessionId}`,
      createdAt: now,
    });
    const result = await runAgentToolInCwd(toolName, toolCall.input, agent, context);
    await appendAgentToolEvents(
      agent,
      context,
      toolName,
      toolCall.input,
      result.output,
      toolCall.id,
    );
    const evidenceId = await deps().recordAgentToolEvidence(
      context,
      parentSessionId,
      agent,
      toolName,
      result.output,
      toolCall.input,
    );
    const failed = isAgentToolOutputFailure(toolName, result.output);
    if (failed) {
      agent.status = "blocked";
      agent.summary = `agent ${agent.id} approved ${toolName} executed but failed; inspect transcript/evidence ${evidenceId ?? "none"}.`;
      setAgentActivity(agent, "blocked", agent.summary);
      syncBackgroundWithAgentStatus(background, agent);
      await deps().appendBackgroundTaskEvent(context, parentSessionId, background);
      await persistAgentRun(context, agent);
      return {
        ok: false,
        tool: toolName,
        text: result.output.text,
        data: result.output.data,
        evidenceId,
      };
    }
    agent.summary = `agent ${agent.id} approved ${toolName} executed; continuing child loop.`;
    await enqueueAgentSystemMailbox(
      context,
      agent,
      `Approved ${toolName} result: ${result.output.text}`,
    );
    setAgentBusy(agent, `${toolName} approved; continuing child loop`);
    syncBackgroundWithAgentStatus(background, agent);
    await deps().appendBackgroundTaskEvent(context, parentSessionId, background);
    await persistAgentRun(context, agent);
    await completeAgent(agent, background, context, createSilentOutput(), "permission_approved");
    return {
      ok: true,
      tool: toolName,
      text: result.output.text,
      data: result.output.data,
      evidenceId,
      continued: true,
    };
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    const evidenceId = await deps().recordAgentToolFailureEvidence(
      context,
      parentSessionId,
      agent,
      toolName,
      text,
    );
    await appendAgentToolResultEvent(agent, context, toolCall.id, toolName, text, true);
    agent.status = "blocked";
    agent.summary = `agent ${agent.id} approved ${toolName} failed: ${truncateDisplay(text, 160)}`;
    setAgentActivity(agent, "blocked", agent.summary);
    syncBackgroundWithAgentStatus(background, agent);
    await deps().appendBackgroundTaskEvent(context, parentSessionId, background);
    await persistAgentRun(context, agent);
    return { ok: false, tool: toolName, text, evidenceId };
  }
}

export async function denyAgentToolUse(
  agent: AgentRun,
  toolCall: ModelToolCall,
  toolName: ToolName,
  context: TuiContext,
  parentSessionId: string,
  outcomeText: string,
): Promise<{ ok: false; tool: string; text: string; evidenceId?: string }> {
  const text = AGENT_PERMISSION_BRIDGE_TOOLS.has(toolName)
    ? `${outcomeText}; ${toolName} was NOT executed / NOT written.`
    : outcomeText;
  const evidenceId = await deps().recordAgentToolFailureEvidence(
    context,
    parentSessionId,
    agent,
    toolName,
    text,
  );
  await context.store.appendEvent(agent.transcriptSessionId, {
    type: "system_event",
    id: randomUUID(),
    level: "warning",
    message: `agent_permission_denied:${toolCall.id}; tool=${toolName}; parentSession=${parentSessionId}`,
    createdAt: new Date().toISOString(),
  });
  await appendAgentToolResultEvent(agent, context, toolCall.id, toolName, text, true);
  agent.status = "blocked";
  agent.summary = `agent ${agent.id} ${toolName} permission denied; child loop remains stopped.`;
  setAgentActivity(agent, "blocked", agent.summary);
  const background =
    context.backgroundTasks.find((task) => task.id === agent.id) ??
    createAgentBackgroundTask(agent, context);
  if (!context.backgroundTasks.some((task) => task.id === background.id)) {
    rememberBackgroundTask(context, background);
  }
  syncBackgroundWithAgentStatus(background, agent);
  await deps().appendBackgroundTaskEvent(context, parentSessionId, background);
  await persistAgentRun(context, agent);
  return { ok: false, tool: toolName, text, evidenceId };
}

function createAgentLoopSystemPrompt(agent: AgentRun, context: TuiContext): string {
  const readonlyAuditHint = createReadonlyAuditToolHint(agent);
  const engineeringProfile =
    agent.engineeringSignal?.profile ??
    context.lastMetaSchedulerDecision?.policyDecision.engineeringSignal.profile ??
    "generic";
  const engineeringStrategy =
    agent.engineeringSignal?.strategyHint ??
    context.lastMetaSchedulerDecision?.policyDecision.engineeringSignal.strategyHint ??
    formatEngineeringProfileStrategyHint(engineeringProfile);
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
    `EngineeringTaskProfile: profile=${engineeringProfile}; strategy=${engineeringStrategy}; not validation evidence.`,
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
  return agent.task;
}

function applyAgentCacheSafePrefix(
  context: TuiContext,
  agent: AgentRun,
  request: ModelRequest,
): ModelRequest {
  if (agent.contextMode === "full_fork" && !parentPrefixHasFullContextForkMarker(context)) {
    const fullFork = applyLastCacheSafePrefix({
      state: context.cache,
      request: {
        ...request,
        messages: [
          {
            role: "user",
            content: buildFullContextForkUserMessage(agent, context),
          },
        ],
      },
      inheritMessages: true,
    });
    if (fullFork.status === "applied") return fullFork.request;
  }
  return applyLastCacheSafePrefix({
    state: context.cache,
    request,
    inheritSystemPrefix: true,
    inheritTools: true,
  }).request;
}

function parentPrefixHasFullContextForkMarker(context: TuiContext): boolean {
  return Boolean(
    context.cache.lastCacheSafePrefix?.messages.some(
      (message) =>
        typeof message.content === "string" &&
        message.content.includes(FULL_CONTEXT_FORK_MARKER),
    ),
  );
}

function buildFullContextForkUserMessage(agent: AgentRun, context: TuiContext): string {
  return [
    FULL_CONTEXT_FORK_MARKER,
    `You are a Linghun ${agent.type} child agent inheriting the parent conversation as read-only context.`,
    "Use the inherited conversation only to understand the task state; do not replay or summarize it unless needed.",
    createAgentLoopSystemPrompt(agent, context),
    "Child task:",
    agent.task,
  ].join("\n");
}

async function consumeAgentMailbox(
  agent: AgentRun,
  context: TuiContext,
  parentSessionId: string,
): Promise<AgentMailboxMessage[]> {
  agent.mailbox = normalizeAgentMailbox(agent);
  const now = new Date().toISOString();
  const pending = mailboxPendingMessages(agent).slice(0, AGENT_MAILBOX_CONSUME_BATCH);
  if (pending.length === 0) {
    setAgentActivity(agent, "waiting_mailbox", "waiting for mailbox or provider turn");
    return [];
  }
  try {
    setAgentActivity(agent, "processing", `consuming ${pending.length} mailbox message(s)`);
    for (const message of pending) {
      message.status = "consumed";
      message.consumedAt = now;
      message.summary = summarizeMailboxText(message.text);
      await context.store.appendEvent(agent.transcriptSessionId, {
        type: "system_event",
        id: randomUUID(),
        level: "info",
        message: `mailbox_consumed:${message.id}; kind=${message.kind ?? "message"}; task=${message.taskId ?? "-"}; from=${message.from}; to=${message.to}; summary=${message.summary}`,
        createdAt: now,
      });
    }
    await deps().recordAgentMailboxEvidence(context, parentSessionId, agent, pending);
    return pending;
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    markMailboxMessagesFailed(agent, pending, text);
    await persistAgentRun(context, agent);
    throw error;
  }
}

function getAgentAllowedTools(agent: AgentRun): (typeof builtInTools)[ToolName][] {
  if (agent.allowedTools !== undefined) {
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

function createAgentToolDefinitions(agent: AgentRun): ModelToolDefinition[] {
  const baseTools = createModelToolDefinitionsForTools(getAgentAllowedTools(agent));
  // 默认类型（非 explorer/planner/worker）允许使用 AgentControl 启动其他 agent
  // explorer/planner/worker 不允许启动 agent，避免无限递归
  if (agent.type !== "explorer" && agent.type !== "planner" && agent.type !== "worker") {
    baseTools.push({
      name: AGENT_CONTROL_TOOL_NAME,
      description: AGENT_CONTROL_DESCRIPTION,
      inputSchema: createAgentControlInputSchema(),
    });
  }
  return baseTools;
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
  await appendToolResultEvent(
    context,
    agent.transcriptSessionId,
    toolUseId,
    toolName as ToolName,
    content,
    isError,
  );
}

export async function cancelAgent(
  agent: AgentRun,
  context: TuiContext,
  output: Writable,
): Promise<void> {
  if (!isAgentCancellable(agent)) {
    writeLine(output, `agent ${agent.id} 当前状态为 ${agent.status}，无需取消。`);
    return;
  }
  const now = new Date().toISOString();
  agent.status = "cancelled";
  agent.lastTerminalStatus = "blocked";
  agent.summary = `agent ${agent.id} 已取消；主会话可继续。`;
  setAgentActivity(agent, "cancelled", agent.summary);
  if (agent.activeTask) {
    agent.activeTask.status = "cancelled";
    agent.activeTask.completedAt = now;
    agent.activeTask.resultSummary = agent.summary;
  }
  agent.updatedAt = now;
  const background = context.backgroundTasks.find((task) => task.id === agent.id);
  if (background) {
    syncBackgroundWithAgentStatus(background, agent);
    background.updatedAt = now;
    background.cancelState = "confirmed_exited";
    background.cancelRequestedAt ??= now;
    background.confirmedExitedAt = now;
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
  await enqueueAgentCompletionReturn(
    context,
    agent,
    background,
    "cancelled",
    agent.summary,
    [],
    parentSessionId,
    background?.workflowRunId,
  );
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
  if (!isAgentCancellable(agent)) {
    writeLine(output, `agent ${agent.id} 当前状态为 ${agent.status}，无需取消。`);
    return undefined;
  }
  await cancelAgent(agent, context, output);
  return agent;
}

export async function cancelAllAgents(context: TuiContext, output: Writable): Promise<AgentRun[]> {
  const agents = listCancellableAgents(context);
  if (agents.length === 0) {
    writeLine(
      output,
      context.language === "en-US"
        ? "No cancellable agents. Running agents are already clear."
        : "没有可取消的 agent；running agent 已清空。",
    );
    return [];
  }
  for (const agent of agents) {
    await cancelAgent(agent, context, createSilentOutput());
  }
  writeLine(
    output,
    context.language === "en-US"
      ? `Cancelled ${agents.length} agent(s).`
      : `已取消 ${agents.length} 个 agent。`,
  );
  deps().writeStatus(output, context);
  return agents;
}

export async function resumeAgent(
  agent: AgentRun,
  context: TuiContext,
  output: Writable,
): Promise<void> {
  if (agent.status !== "stale" && !isAgentIdle(agent)) {
    writeLine(output, `Agent 当前状态为 ${agent.status}，无需 resume。`);
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
  setAgentBusy(agent, "resumed with a fresh provider turn", now);
  agent.summary =
    context.language === "en-US"
      ? "Resumed with a fresh provider turn; old stream events are not replayed."
      : "已用新的 provider turn 恢复；不会回放旧 stream。";
  const background = ensureAgentBackgroundTask(agent, context);
  syncBackgroundWithAgentStatus(background, agent);
  registerBackgroundAbortController(context, agent.id);
  await persistAgentRun(context, agent);
  await deps().appendBackgroundTaskEvent(
    context,
    agent.parentSessionId ?? (await deps().ensureSession(context)),
    background,
  );
  await completeAgent(agent, background, context, output, "resume");
}

const TERMINAL_AGENT_STATUSES = new Set(["blocked", "cancelled", "failed"]);

export function syncBackgroundWithAgentStatus(
  background: BackgroundTaskState,
  agent: AgentRun,
): void {
  const activitySummary = agent.activitySummary
    ? truncateDisplay(agent.activitySummary, 140)
    : undefined;
  if (TERMINAL_AGENT_STATUSES.has(agent.status)) {
    background.status =
      agent.status === "blocked"
        ? "blocked"
        : agent.status === "cancelled"
          ? "cancelled"
          : agent.status === "failed"
            ? "failed"
            : "completed";
    background.currentStep = activitySummary
      ? `${agent.status}: ${activitySummary}`
      : `${agent.status}`;
    background.result =
      agent.status === "cancelled" ? "cancelled" : agent.status === "blocked" ? "partial" : "fail";
    background.progress = {
      completed: 1,
      total: 1,
      label: background.progress?.label ?? agent.type,
    };
  } else if (agent.status === "idle") {
    background.status = "completed";
    background.currentStep = activitySummary ? `idle: ${activitySummary}` : "idle";
    background.result = mapAgentBackgroundResult(agent, agent.lastTerminalStatus);
    background.progress = {
      completed: 1,
      total: 1,
      label: background.progress?.label ?? agent.type,
    };
  } else if (agent.status === "stale") {
    background.status = "stale";
    background.currentStep = activitySummary
      ? `stale/resumable: ${activitySummary}`
      : "stale/resumable";
    background.result = "partial";
    background.progress = {
      completed: 0,
      total: 1,
      label: background.progress?.label ?? agent.type,
    };
  } else if (agent.status === "running") {
    background.status = "running";
    background.currentStep = activitySummary ?? `running ${agent.type}`;
    background.result = undefined;
  }
  background.userVisibleSummary = activitySummary
    ? `${activitySummary}; ${agent.summary}`
    : agent.summary;
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
    if (agent.activeTask) {
      agent.activeTask.status = "blocked";
      agent.activeTask.resultSummary = "Agent marked stale/resumable by interrupt.";
    }
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
  if (!context.sessionId) return;
  let files: string[];
  try {
    files = await readdir(getAgentRunsDir(context));
  } catch (error) {
    if (!isNodeErrorWithCode(error, "ENOENT")) {
      await appendAgentHydrateWarning(
        context,
        `agent_hydrate_readdir_failed reason=${formatDiagnosticError(error)}`,
      );
    }
    return;
  }
  const existing = new Set(context.agents.map((agent) => agent.id));
  for (const file of files.filter((name) => name.endsWith(".json")).sort()) {
    try {
      const raw = await readFile(resolve(getAgentRunsDir(context), file), "utf8");
      const parsed = JSON.parse(raw) as AgentRun;
      if (!parsed.id || existing.has(parsed.id)) continue;
      if (!isAgentOwnedBySession(parsed, context.sessionId)) continue;
      if (parsed.status !== "running") {
        const filePath = resolve(getAgentRunsDir(context), file);
        try {
          await rm(filePath);
        } catch {
          /* best-effort cleanup */
        }
        continue;
      }
      const now = new Date().toISOString();
      const allowedTools = normalizeRegistryAllowedTools(parsed.allowedTools);
      const maxTurns = normalizeRegistryAgentMaxTurns(parsed.maxTurns);
      const agent: AgentRun = {
        ...parsed,
        mailbox: [],
        ...(allowedTools !== undefined ? { allowedTools } : {}),
        ...(maxTurns ? { maxTurns } : {}),
        status: parsed.status === "running" ? "stale" : parsed.status,
        activityStatus:
          parsed.status === "running"
            ? "blocked"
            : parsed.status === "idle"
              ? "idle"
              : parsed.status === "completed"
                ? "idle"
                : parsed.status === "cancelled"
                  ? "cancelled"
                  : parsed.activityStatus,
        staleReason:
          parsed.status === "running" ? "hydrate_running_agent_after_restart" : parsed.staleReason,
        summary:
          parsed.status === "running"
            ? `agent ${parsed.id} is stale/resumable after TUI restart; it was not marked completed.`
            : parsed.summary,
        updatedAt: now,
      };
      agent.mailbox = normalizeAgentMailbox({ ...agent, mailbox: parsed.mailbox ?? [] });
      context.agents.push(agent);
      if (agent.status === "stale") {
        const background = createAgentBackgroundTask(agent, context);
        syncBackgroundWithAgentStatus(background, agent);
        rememberBackgroundTask(context, background);
      }
      if (parsed.status === "running") {
        await persistAgentRun(context, agent);
      }
    } catch (error) {
      await appendAgentHydrateWarning(
        context,
        `agent_hydrate_read_failed file=${file} reason=${formatDiagnosticError(error)}`,
      );
    }
  }
}

function isDurableJobOwnedBySession(job: DurableJobState, sessionId: string): boolean {
  return job.ownerSessionId === sessionId || job.worker?.sessionId === sessionId;
}

function isAgentOwnedBySession(agent: AgentRun, sessionId: string): boolean {
  return agent.parentSessionId === sessionId || agent.transcriptSessionId === sessionId;
}

async function appendAgentHydrateWarning(context: TuiContext, message: string): Promise<void> {
  if (!context.sessionId) {
    process.stderr.write(`[linghun] ${message}\n`);
    return;
  }
  try {
    await context.store.appendEvent(context.sessionId, {
      type: "system_event",
      id: randomUUID(),
      level: "warning",
      message,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    process.stderr.write(
      `[linghun] ${message}; warning_write_failed=${formatDiagnosticError(error)}\n`,
    );
  }
}

function isDefaultBackgroundListTask(task: BackgroundTaskState): boolean {
  return (
    task.status === "running" ||
    task.status === "paused" ||
    task.status === "blocked" ||
    task.status === "stale" ||
    task.status === "timeout" ||
    task.status === "cancelled" ||
    task.status === "completed" ||
    task.status === "failed"
  );
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
    targetType?: "id" | "name" | "team";
    broadcastTeam?: boolean;
    message: string;
    kind?: "message" | "task";
    taskId?: string;
    from?: AgentMailboxMessage["from"];
  },
): Promise<{ ok: boolean; text: string; delivered: string[] }> {
  const text = input.message.trim();
  if (!text) {
    return { ok: false, text: "SendMessage requires target and non-empty message.", delivered: [] };
  }
  const resolved = resolveMessageTargets(context, input);
  if (!resolved.ok) {
    return { ok: false, text: resolved.text, delivered: [] };
  }
  const messageKind = input.kind === "task" || Boolean(input.taskId) ? "task" : "message";
  const assignment =
    messageKind === "task"
      ? resolveSharedTaskAssignment(context, resolved.targets, input, text)
      : undefined;
  if (assignment && !assignment.ok) {
    return { ok: false, text: assignment.text, delivered: [] };
  }
  const targets = assignment?.ok ? [assignment.target] : resolved.targets;
  const messageBytes = Buffer.byteLength(text, "utf8");
  const capError = firstMailboxCapError(targets, text, messageBytes);
  if (capError) return { ok: false, text: capError, delivered: [] };
  const now = new Date().toISOString();
  const parentSessionId = await deps().ensureSession(context);
  const wakeTargets: Array<{ agent: AgentRun; background: BackgroundTaskState }> = [];
  for (const agent of targets) {
    agent.mailbox = normalizeAgentMailbox(agent);
    trimAgentMailboxHistory(agent);
    const message: AgentMailboxMessage = {
      id: `msg-${randomUUID().slice(0, 8)}`,
      from: input.from ?? "model",
      to: agent.id,
      text,
      createdAt: now,
      status: "pending",
      summary: summarizeMailboxText(text),
      kind: messageKind,
      ...(input.taskId ? { taskId: input.taskId } : {}),
    };
    agent.mailbox.push(message);
    trimAgentMailboxHistory(agent);
    if (messageKind === "task") {
      agent.activeTask = {
        id: input.taskId ?? message.id,
        summary: summarizeMailboxText(text),
        assignedBy: input.from ?? "model",
        assignedAt: now,
        status: "assigned",
        messageId: message.id,
      };
      await appendAgentTaskAssignmentEvent(context, parentSessionId, agent, agent.activeTask);
    }
    setAgentActivity(agent, "waiting_mailbox", `mailbox pending ${countPendingMailbox(agent)}`);
    await context.store.appendEvent(agent.transcriptSessionId, {
      type: "user_message",
      id: message.id,
      text,
      createdAt: now,
    });
    await context.store.appendEvent(agent.transcriptSessionId, {
      type: "system_event",
      id: randomUUID(),
      level: "info",
      message: `mailbox_enqueued:${message.id}; kind=${message.kind ?? "message"}; task=${message.taskId ?? "-"}; from=${message.from}; to=${message.to}; summary=${message.summary}`,
      createdAt: now,
    });
    const background = ensureAgentBackgroundTask(agent, context);
    syncBackgroundWithAgentStatus(background, agent);
    await deps().appendBackgroundTaskEvent(context, parentSessionId, background);
    if (isAgentIdle(agent)) {
      wakeTargets.push({ agent, background });
    }
    await persistAgentRun(context, agent);
  }
  for (const target of wakeTargets) {
    setAgentBusy(
      target.agent,
      `mailbox wake; pending mailbox ${countPendingMailbox(target.agent)}`,
      now,
    );
    syncBackgroundWithAgentStatus(target.background, target.agent);
    registerBackgroundAbortController(context, target.agent.id);
    await persistAgentRun(context, target.agent);
    await deps().appendBackgroundTaskEvent(context, parentSessionId, target.background);
    setTimeout(() => {
      void completeAgent(
        target.agent,
        target.background,
        context,
        createSilentOutput(),
        "mailbox",
      ).catch((error: unknown) => {
        const message = `mailbox wake agent complete failed: ${error instanceof Error ? error.message : String(error)}`;
        target.background.status = "failed";
        target.background.result = "fail";
        target.background.currentStep = message;
        target.background.updatedAt = new Date().toISOString();
        target.background.userVisibleSummary = message;
        void deps()
          .appendBackgroundTaskEvent(context, parentSessionId, target.background)
          .catch(() => undefined);
      });
    }, 0);
  }
  const delivered = targets.map((agent) => agent.id);
  return {
    ok: true,
    text:
      messageKind === "task"
        ? `SendMessage task assigned to ${delivered.join(", ")}; pending mailbox updated.`
        : `SendMessage delivered to ${delivered.join(", ")}; pending mailbox updated.`,
    delivered,
  };
}

function resolveMessageTargets(
  context: TuiContext,
  input: {
    to?: string;
    name?: string;
    team?: string;
    teamName?: string;
    team_name?: string;
    targetType?: "id" | "name" | "team";
    broadcastTeam?: boolean;
  },
): { ok: true; targets: AgentRun[] } | { ok: false; text: string } {
  const toTarget = input.to?.trim();
  const nameTarget = input.name?.trim();
  const teamFields = [input.team, input.teamName, input.team_name]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  const uniqueTeamTargets = Array.from(new Set(teamFields));
  const targetKinds = [
    toTarget ? "to" : undefined,
    nameTarget ? "name" : undefined,
    uniqueTeamTargets.length > 0 ? "team" : undefined,
  ].filter(Boolean);
  if (targetKinds.length > 1 || uniqueTeamTargets.length > 1) {
    return {
      ok: false,
      text: `SendMessage target is conflicting; provide exactly one id/name target or one explicit team target. Received ${[
        toTarget ? `to=${toTarget}` : undefined,
        nameTarget ? `name=${nameTarget}` : undefined,
        uniqueTeamTargets.length > 0 ? `team=${uniqueTeamTargets.join("|")}` : undefined,
      ]
        .filter(Boolean)
        .join(", ")}.`,
    };
  }
  const teamTarget = input.team ?? input.teamName ?? input.team_name;
  const target = input.to ?? input.name ?? teamTarget;
  if (!target?.trim()) {
    return { ok: false, text: "SendMessage requires an explicit id/name target or --team target." };
  }
  const explicitTeam = Boolean(teamTarget) || input.targetType === "team" || input.broadcastTeam;
  if (explicitTeam) {
    const team = (teamTarget ?? input.to ?? input.name ?? "").trim();
    if (!team) {
      return { ok: false, text: "SendMessage team broadcast requires a non-empty team name." };
    }
    const targets = context.agents.filter(
      (agent) => AGENT_ASSIGNABLE_STATUSES.has(agent.status) && agent.teamName === team,
    );
    if (targets.length === 0) {
      return { ok: false, text: `SendMessage failed: no active/idle team found for "${team}".` };
    }
    if (targets.length > AGENT_TEAM_BROADCAST_MAX) {
      return {
        ok: false,
        text: `SendMessage failed: team "${team}" has ${targets.length} active/idle agents; limit is ${AGENT_TEAM_BROADCAST_MAX}. Send to specific ids/names or reduce the team.`,
      };
    }
    return { ok: true, targets };
  }
  const normalized = target.trim();
  const byId = context.agents.filter(
    (agent) =>
      AGENT_ASSIGNABLE_STATUSES.has(agent.status) &&
      (agent.id === normalized || agent.id.endsWith(normalized)),
  );
  const byName = context.agents.filter(
    (agent) => AGENT_ASSIGNABLE_STATUSES.has(agent.status) && agent.addressableName === normalized,
  );
  if (input.targetType === "id") {
    return resolveSingleTarget(normalized, byId, "id");
  }
  if (input.targetType === "name") {
    return resolveSingleTarget(normalized, byName, "name");
  }
  const candidates = uniqueAgents([...byId, ...byName]);
  if (candidates.length === 0) {
    const teamCandidates = context.agents.filter(
      (agent) => AGENT_ASSIGNABLE_STATUSES.has(agent.status) && agent.teamName === normalized,
    );
    const hint =
      teamCandidates.length > 0
        ? ` Team "${normalized}" exists; use /agents send --team ${normalized} <message> for explicit broadcast.`
        : "";
    return {
      ok: false,
      text: `SendMessage failed: no active/idle agent id/name found for "${normalized}".${hint}`,
    };
  }
  if (candidates.length > 1) {
    return {
      ok: false,
      text: `SendMessage target "${normalized}" is ambiguous; candidates: ${formatAgentCandidates(candidates)}. Use a full id or unique name; use --team for explicit team broadcast.`,
    };
  }
  return { ok: true, targets: candidates };
}

function resolveSingleTarget(
  target: string,
  matches: AgentRun[],
  kind: "id" | "name",
): { ok: true; targets: AgentRun[] } | { ok: false; text: string } {
  const candidates = uniqueAgents(matches);
  if (candidates.length === 0) {
    return {
      ok: false,
      text: `SendMessage failed: no active/idle agent ${kind} found for "${target}".`,
    };
  }
  if (candidates.length > 1) {
    return {
      ok: false,
      text: `SendMessage ${kind} "${target}" is ambiguous; candidates: ${formatAgentCandidates(candidates)}.`,
    };
  }
  return { ok: true, targets: candidates };
}

function resolveSharedTaskAssignment(
  context: TuiContext,
  candidates: AgentRun[],
  input: { taskId?: string; from?: AgentMailboxMessage["from"] },
  text: string,
): { ok: true; target: AgentRun } | { ok: false; text: string } {
  const taskId = input.taskId?.trim();
  if (taskId) {
    const existing = context.agents.find(
      (agent) =>
        agent.activeTask?.id === taskId &&
        (agent.activeTask.status === "assigned" || agent.activeTask.status === "running"),
    );
    if (existing) {
      return {
        ok: false,
        text: `SendMessage task ${taskId} is already assigned to ${existing.id}; avoid duplicate work.`,
      };
    }
  }
  const available = candidates.filter(isAgentAssignable);
  if (available.length === 0) {
    return {
      ok: false,
      text: `SendMessage task assignment failed: no idle/available agent among ${candidates.map((agent) => `${agent.id}:${agent.status}:${agent.activityStatus ?? "-"}`).join(", ")}.`,
    };
  }
  const target = available.find(isAgentIdle) ?? available[0];
  if (!target) {
    return {
      ok: false,
      text: `SendMessage task assignment failed for ${truncateDisplay(text, 80)}.`,
    };
  }
  return { ok: true, target };
}

function firstMailboxCapError(
  targets: AgentRun[],
  text: string,
  messageBytes: number,
): string | undefined {
  for (const agent of targets) {
    const mailbox = normalizeAgentMailbox(agent);
    const pendingMessages = mailbox.filter((message) => message.status === "pending");
    const pendingCount = pendingMessages.length;
    const pendingBytes = pendingMessages.reduce(
      (total, message) => total + Buffer.byteLength(message.text, "utf8"),
      0,
    );
    if (pendingCount >= AGENT_MAILBOX_MAX_MESSAGES) {
      return `SendMessage failed: agent ${agent.id} mailbox has ${pendingCount} pending messages; limit is ${AGENT_MAILBOX_MAX_MESSAGES}. Resume/cancel the agent or wait for it to consume mailbox.`;
    }
    if (
      messageBytes > AGENT_MAILBOX_MAX_BYTES ||
      pendingBytes + messageBytes > AGENT_MAILBOX_MAX_BYTES
    ) {
      return `SendMessage failed: agent ${agent.id} mailbox would exceed ${AGENT_MAILBOX_MAX_BYTES} bytes (pending ${pendingBytes}, message ${messageBytes}). Send a shorter message or wait for consumption.`;
    }
    if (!text.trim()) {
      return "SendMessage requires a non-empty message.";
    }
  }
  return undefined;
}

function uniqueAgents(agents: AgentRun[]): AgentRun[] {
  const seen = new Set<string>();
  return agents.filter((agent) => {
    if (seen.has(agent.id)) return false;
    seen.add(agent.id);
    return true;
  });
}

// Module 4 — findAgent moved to ./tui-agent-job-runtime.ts

function formatAgentsList(context: TuiContext): string {
  if (context.agents.length === 0) {
    return context.language === "en-US"
      ? "No agents. Usage: /fork explorer|planner|verifier|worker <task>."
      : "当前没有 agent。用法：/fork explorer|planner|verifier|worker <task>。";
  }
  const cancellable = listCancellableAgents(context);
  const running = context.agents.filter((agent) => agent.status === "running").length;
  const lines = [
    context.language === "en-US"
      ? `Agent history / loaded agents (running now: ${running}, historical loaded: ${context.agents.length}):`
      : `Agents：历史/已加载记录（当前运行：${running}，历史已加载：${context.agents.length}）：`,
  ];
  for (const agent of context.agents) {
    const label = truncateDisplay(
      agent.displayName ?? deriveAgentDisplayName(agent.type, agent.task),
      30,
    );
    const pending = countPendingMailbox(agent);
    const activity = agent.activityStatus ?? (isAgentIdle(agent) ? "idle" : "unknown");
    const task = agent.activeTask ? ` task ${agent.activeTask.id}:${agent.activeTask.status}` : "";
    const cwd = agent.cwd
      ? truncateDisplay(relative(context.projectPath, agent.cwd) || ".", 18)
      : ".";
    lines.push(
      `${agent.id}  ${label}  status ${agent.status}  activity ${activity}${task}  cancellable ${isAgentCancellable(agent) ? "yes" : "no"}  type ${agent.type}  role ${agent.role}  name ${agent.addressableName ?? "-"}  team ${agent.teamName ?? "-"}  pending ${pending}  cwd ${cwd}`,
    );
  }
  lines.push(
    context.language === "en-US"
      ? `cancellable ids: ${cancellable.map((agent) => agent.id).join(", ") || "none"}`
      : `可取消 agent IDs：${cancellable.map((agent) => agent.id).join(", ") || "none"}`,
  );
  lines.push(
    context.language === "en-US"
      ? "Use /agents cancel all to stop every running agent."
      : "使用 /agents cancel all 可停止所有 running agent。",
  );
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
  return normalizeAgentMailbox(agent).filter((message) => message.status === "pending").length;
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
  contextMode?: "handoff" | "full_fork";
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
    if (arg === "--full-context") {
      options.contextMode = "full_fork";
      continue;
    }
    if (
      (arg === "--name" ||
        arg === "--team" ||
        arg === "--team-name" ||
        arg === "--cwd" ||
        arg === "--isolation" ||
        arg === "--context-mode") &&
      args[index + 1]
    ) {
      const value = args[index + 1];
      index += 1;
      if (arg === "--name") options.name = value;
      if (arg === "--team" || arg === "--team-name") options.teamName = value;
      if (arg === "--cwd") options.cwd = value;
      if (arg === "--isolation" && value === "worktree") options.isolation = "worktree";
      if (arg === "--context-mode" && value === "full_fork") options.contextMode = "full_fork";
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
  scoped.readSnapshots = context.tools.readSnapshots;
  scoped.patchSummaries = context.tools.patchSummaries;
  const result = await runTool(toolName, input, scoped);
  context.tools.changedFiles.push(
    ...scoped.changedFiles.map((file) =>
      relative(context.projectPath, resolve(agent.cwd ?? context.projectPath, file)),
    ),
  );
  return result;
}
