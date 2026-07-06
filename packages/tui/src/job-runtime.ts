/**
 * Durable job pure helpers — parsing, persistence, formatting, and state queries.
 * Extracted from index.ts (Slice D.10C) — behavior-preserving move only.
 */
import { createHash } from "node:crypto";
import { appendFile as fsAppendFile } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { LinghunConfig } from "@linghun/config";
import { resolveStoragePaths } from "@linghun/config";
import type { Language } from "@linghun/shared";
import type {
  AgentType,
  DurableJobAgent,
  DurableJobAgentStatus,
  DurableJobState,
  DurableJobStatus,
} from "./index.js";
import {
  formatJobNextAction,
  formatJobRunnerInline,
  formatJobRunnerReportLine,
  mapDurableJobToBackgroundResult,
  mapDurableJobToBackgroundStatus,
} from "./job-runner-presenter.js";
import { formatApprovedRunnerSpecLine } from "./runner-runtime.js";
import { formatDisplayPath, sanitizeDisplayPaths, truncateDisplay } from "./startup-runtime.js";
import { isRecord } from "./tui-state-runtime.js";

const appendFileAsync = promisify(fsAppendFile);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_JOB_TIMEOUT_MS = 30 * 60 * 1000;
export const DEFAULT_JOB_BUDGET_TOKENS = 120_000;
export const JOB_LOG_TAIL_LINES = 40;
export const JOB_RECOVERY_HEARTBEAT_STALE_MS = 2 * 60 * 1000;
export const DEFAULT_JOB_MAX_STEPS = 4;
export const MAX_JOB_MAX_STEPS = 20;
export const JOB_AGENT_HIGH_CONFIG_CANDIDATE = 8;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ParsedJobRunOptions = {
  goal: string;
  phase: string;
  target: string;
  plan: string[];
  maxTokens: number;
  maxSteps: number;
  requestedAgents: number;
  runningCap?: number;
  timeoutMs: number;
  allowEdit: boolean;
  allowBash: boolean;
  allowMultiAgent: boolean;
  isolation?: "worktree";
  // P1-5 — 仅当用户显式传入 --tokens / --max-steps / --timeout 时为 true。
  // 未显式设置时 /job 没有用户可见预算，enforcement 不触发，UI 显示"budget: not set"。
  budgetExplicit: { tokens: boolean; steps: boolean; runtime: boolean };
};

export type JobContext = {
  config: LinghunConfig;
  projectPath: string;
  language: Language;
};

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export function parseJobRunOptions(args: string[]): ParsedJobRunOptions {
  const goalParts: string[] = [];
  let phase = "default";
  let target = "local-durable-jobs";
  let requestedAgents = 1;
  let runningCap: number | undefined;
  let maxTokens = DEFAULT_JOB_BUDGET_TOKENS;
  let maxSteps = DEFAULT_JOB_MAX_STEPS;
  let timeoutMs = DEFAULT_JOB_TIMEOUT_MS;
  let allowEdit = false;
  let allowBash = false;
  let allowMultiAgent = false;
  let isolation: "worktree" | undefined;
  const budgetExplicit = { tokens: false, steps: false, runtime: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      continue;
    }
    if (arg === "--phase") {
      phase = args[index + 1] ?? phase;
      index += 1;
      continue;
    }
    if (arg === "--target") {
      target = args[index + 1] ?? target;
      index += 1;
      continue;
    }
    if (arg === "--agents") {
      requestedAgents = normalizePositiveInt(args[index + 1]) ?? requestedAgents;
      index += 1;
      continue;
    }
    if (arg === "--running-cap" || arg === "--runningCap" || arg === "--cap") {
      runningCap = normalizePositiveInt(args[index + 1]) ?? runningCap;
      index += 1;
      continue;
    }
    if (arg === "--tokens") {
      maxTokens = clampPositiveInt(args[index + 1], DEFAULT_JOB_BUDGET_TOKENS, 10_000_000);
      budgetExplicit.tokens = true;
      index += 1;
      continue;
    }
    if (arg === "--max-steps" || arg === "--steps") {
      maxSteps = clampPositiveInt(args[index + 1], DEFAULT_JOB_MAX_STEPS, MAX_JOB_MAX_STEPS);
      budgetExplicit.steps = true;
      index += 1;
      continue;
    }
    if (arg === "--timeout" || arg === "--max-runtime-ms") {
      timeoutMs = clampPositiveInt(args[index + 1], DEFAULT_JOB_TIMEOUT_MS, 24 * 60 * 60 * 1000);
      budgetExplicit.runtime = true;
      index += 1;
      continue;
    }
    if (arg === "--allow-edit") {
      allowEdit = true;
      continue;
    }
    if (arg === "--allow-bash") {
      allowBash = true;
      continue;
    }
    if (arg === "--multi-agent") {
      allowMultiAgent = true;
      continue;
    }
    if (arg === "--isolation") {
      if (args[index + 1] === "worktree") isolation = "worktree";
      index += 1;
      continue;
    }
    goalParts.push(arg);
  }
  const goal = goalParts.join(" ").trim();
  const normalizedAgents = allowMultiAgent ? requestedAgents : 1;
  return {
    goal,
    phase,
    target,
    plan: [
      goal || "prepare job",
      "validate handoff",
      "schedule bounded local agents",
      "write report",
    ],
    maxTokens,
    maxSteps,
    requestedAgents: normalizedAgents,
    runningCap,
    timeoutMs,
    allowEdit,
    allowBash,
    allowMultiAgent,
    isolation,
    budgetExplicit,
  };
}

export function clampPositiveInt(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.min(parsed, max);
}

function normalizePositiveInt(value: string | undefined): number | undefined {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return undefined;
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Pure computation
// ---------------------------------------------------------------------------

export function estimateJobTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function getDurableJobMaxSteps(job: DurableJobState): number {
  return Math.max(1, Math.min(job.budget.maxSteps ?? DEFAULT_JOB_MAX_STEPS, MAX_JOB_MAX_STEPS));
}

// P1-5 — 预算只指用户主动设置的预算（--tokens / --max-steps / --timeout）。
// 未显式设置时 /job 没有用户可见预算，状态/报告显示"budget not set"，不展示默认 max。
function formatJobBudgetLine(job: DurableJobState): string {
  const explicit = job.budget.explicit;
  const parts: string[] = [];
  if (explicit?.tokens === true) {
    parts.push(`tokens ${job.budget.usedTokens ?? 0}/${job.budget.maxTokens}`);
  } else {
    parts.push(`tokens ${job.budget.usedTokens ?? 0}/not set`);
  }
  if (explicit?.steps === true) {
    parts.push(`steps ${job.budget.usedSteps ?? 0}/${getDurableJobMaxSteps(job)}`);
  } else {
    parts.push(`steps ${job.budget.usedSteps ?? 0}/not set`);
  }
  parts.push(explicit?.runtime === true ? `timeout ${job.timeoutMs}ms` : "timeout not set");
  const anyExplicit = Boolean(explicit?.tokens || explicit?.steps || explicit?.runtime);
  const prefix = anyExplicit ? "budget" : "budget not set";
  return `- ${prefix}: ${parts.join("; ")}\n- cap scope: durable job agents only; unrelated /fork agents do not silently consume this effective cap.`;
}

export function countDurableJobAgents(job: DurableJobState): Record<DurableJobAgentStatus, number> {
  return job.agents.reduce(
    (counts, agent) => {
      counts[agent.status] += 1;
      return counts;
    },
    {
      created: 0,
      running: 0,
      queued: 0,
      sleeping: 0,
      skipped: 0,
      budget_limited: 0,
      resource_limited: 0,
      blocked: 0,
      stale: 0,
      cancelled: 0,
      timeout: 0,
      completed: 0,
      failed: 0,
    } satisfies Record<DurableJobAgentStatus, number>,
  );
}

export function rescheduleDurableJobAgents(job: DurableJobState): void {
  let running = 0;
  const cap = getEffectiveAgentCap(job);
  for (const agent of job.agents) {
    const previousStatus = agent.status;
    if (agent.status === "completed" || agent.status === "failed" || agent.status === "cancelled") {
      continue;
    }
    if (
      job.status === "running" &&
      (agent.status === "running" || agent.status === "queued" || agent.status === "sleeping") &&
      running < cap
    ) {
      agent.status = "running";
      agent.heartbeatAt = job.updatedAt;
      running += 1;
      continue;
    }
    if (job.status === "running") {
      agent.status =
        previousStatus === "running" || previousStatus === "sleeping" || agent.runId
          ? "sleeping"
          : "queued";
      continue;
    }
    agent.status =
      job.status === "sleeping" ? "sleeping" : job.status === "blocked" ? "blocked" : job.status;
  }
}

export function getEffectiveAgentCap(job: DurableJobState): number {
  return Math.max(
    0,
    Math.min(job.effectiveAgentCap ?? job.budget.maxRunningAgents, job.agents.length),
  );
}

export function updateDurableJobEffectiveAgentCap(
  job: DurableJobState,
  cap: number,
  reason: string,
): void {
  job.effectiveAgentCap = Math.max(
    0,
    Math.min(cap, job.budget.maxRunningAgents, job.agents.length),
  );
  const preflightSuffix = extractJobPreflightCapSuffix(job.capReason);
  job.capReason = preflightSuffix ? `${reason};${preflightSuffix}` : reason;
}

function extractJobPreflightCapSuffix(reason: string | undefined): string | undefined {
  if (!reason) return undefined;
  const parts = reason
    .split(";")
    .filter(
      (part) =>
        part.startsWith("generatedEvidence=") ||
        part === "generatedVerification=partial" ||
        part === "index=unknown_nonblocking",
    );
  return parts.length > 0 ? parts.join(";") : undefined;
}

// ---------------------------------------------------------------------------
// Agent display name derivation
// ---------------------------------------------------------------------------

export function deriveAgentDisplayName(type: AgentType, task: string): string {
  const stopWords = new Set([
    "a",
    "an",
    "and",
    "for",
    "help",
    "job",
    "please",
    "run",
    "task",
    "the",
    "to",
    "with",
  ]);
  const asciiTask = Array.from(task.normalize("NFKD").toLowerCase())
    .map((char) => (char.charCodeAt(0) <= 127 ? char : " "))
    .join("");
  const tokens = asciiTask
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter((token) => token && !stopWords.has(token))
    .slice(0, 3);
  const base =
    tokens.length > 0
      ? tokens.join("-")
      : `task-${createHash("sha1").update(task).digest("hex").slice(0, 6)}`;
  const label = base.endsWith(`-${type}`) ? base : `${base}-${type}`;
  return truncateAsciiLabel(label, 36);
}

export function truncateAsciiLabel(value: string, maxLength: number): string {
  const cleaned = value
    .replace(/[^a-z0-9-]/gu, "-")
    .replace(/-{2,}/gu, "-")
    .replace(/^-|-$/gu, "");
  if (cleaned.length <= maxLength) {
    return cleaned || "agent";
  }
  return cleaned.slice(0, maxLength).replace(/-+$/u, "") || "agent";
}

export function createDurableJobAgents(
  options: ParsedJobRunOptions,
  status: DurableJobStatus,
  runningCap: number,
): DurableJobAgent[] {
  const total = Math.max(1, options.requestedAgents);
  const tasks = createDurableJobAgentTasks(options.goal, total);
  return Array.from({ length: total }, (_, index) => {
    const active = false;
    const agentStatus: DurableJobAgentStatus =
      status === "running"
        ? index < runningCap
          ? "queued"
          : "sleeping"
        : status === "created"
          ? "created"
          : status;
    const type =
      index === 0 ? "planner" : index === 1 ? "worker" : index === 2 ? "verifier" : "explorer";
    return {
      id: `job-agent-${index + 1}`,
      type,
      displayName: deriveAgentDisplayName(type, options.goal),
      goal: `${options.goal}#${index + 1}`,
      task: tasks[index] ?? `${type}: ${options.goal}`,
      status: agentStatus,
      budgetTokens: Math.floor(options.maxTokens / total),
      heartbeatAt: active ? new Date().toISOString() : undefined,
      summary: active
        ? "scheduled with trimmed handoff/evidence/cache refs only; no full transcript/source/index/log output"
        : "planned; not started until durable job scheduler creates a real AgentRun",
    };
  });
}

export function createDurableJobAgentTasks(goal: string, total: number): string[] {
  const templates = [
    `planner subtask: turn the job goal into a concise execution plan. Goal: ${goal}`,
    `worker subtask: execute the next bounded work item with real tools when available. Goal: ${goal}`,
    `verifier subtask: run verification or synthetic self-check only; do not treat job lifecycle completion as verified. Goal: ${goal}`,
  ];
  for (let index = templates.length; index < total; index += 1) {
    templates.push(
      `explorer subtask ${index - 2}: inspect facts and risks with read-only tools. Goal: ${goal}`,
    );
  }
  return templates.slice(0, total);
}

// ---------------------------------------------------------------------------
// Persistence (fs only, no TuiContext)
// ---------------------------------------------------------------------------

export function getDurableJobStatePath(job: DurableJobState): string {
  return join(dirname(job.logPath), "state.json");
}

export async function persistDurableJob(job: DurableJobState): Promise<void> {
  await mkdir(dirname(job.logPath), { recursive: true });
  await writeFile(getDurableJobStatePath(job), `${JSON.stringify(job, null, 2)}\n`, "utf8");
}

export async function appendJobLog(job: DurableJobState, message: string): Promise<void> {
  await mkdir(dirname(job.logPath), { recursive: true });
  await appendFileAsync(job.logPath, `[${new Date().toISOString()}] ${message}\n`, "utf8");
  await appendFileAsync(job.fullOutputPath, `[${new Date().toISOString()}] ${message}\n`, "utf8");
}

export async function readDurableJobState(path: string): Promise<DurableJobState | null> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    return isDurableJobState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isDurableJobState(value: unknown): value is DurableJobState {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.goal === "string" &&
    typeof value.projectPath === "string" &&
    typeof value.status === "string" &&
    Array.isArray(value.plan) &&
    Array.isArray(value.agents) &&
    typeof value.logPath === "string" &&
    typeof value.reportPath === "string" &&
    typeof value.fullOutputPath === "string"
  );
}

// ---------------------------------------------------------------------------
// Path resolution (needs config + projectPath only)
// ---------------------------------------------------------------------------

export function getDurableJobsRoot(context: JobContext): string {
  return resolveStoragePaths(context.config, context.projectPath).jobs;
}

export function getDurableJobPaths(
  context: JobContext,
  id: string,
): Pick<DurableJobState, "logPath" | "reportPath" | "fullOutputPath"> {
  const dir = join(getDurableJobsRoot(context), id);
  return {
    logPath: join(dir, "job.log"),
    reportPath: join(dir, "report.md"),
    fullOutputPath: join(dir, "full-output.log"),
  };
}

export async function listDurableJobs(context: JobContext): Promise<DurableJobState[]> {
  const root = getDurableJobsRoot(context);
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const jobs: DurableJobState[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const job = await readDurableJobState(join(root, entry.name, "state.json"));
    if (job && isCurrentProjectJob(job, context.projectPath)) jobs.push(job);
  }
  return jobs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function isCurrentProjectJob(job: DurableJobState, projectPath: string): boolean {
  const currentProjectPath = resolve(projectPath);
  return (
    resolve(currentProjectPath, job.projectPath).toLowerCase() === currentProjectPath.toLowerCase()
  );
}

export async function findDurableJob(
  context: JobContext,
  id: string | undefined,
): Promise<DurableJobState | undefined> {
  const jobs = await listDurableJobs(context);
  if (!id) return jobs[0];
  return jobs.find((job) => job.id === id || job.id.endsWith(id));
}

// ---------------------------------------------------------------------------
// Report writing
// ---------------------------------------------------------------------------

export async function writeDurableJobReport(job: DurableJobState): Promise<void> {
  const lines = [
    `# Job Report ${job.id}`,
    "",
    `- status: ${job.status}`,
    `- goal: ${job.goal}`,
    `- projectPath: ${formatDisplayPath(job.projectPath, job.projectPath)}`,
    `- isolation: ${job.isolation ?? "none"}`,
    `- phase/target: ${job.phase} / ${job.target}`,
    `- permission: ${job.permissionPolicy}; edit ${job.allowEdit}; bash ${job.allowBash}; multi-agent ${job.allowMultiAgent}`,
    `- budget: max tokens ${job.budget.maxTokens}; used ${job.budget.usedTokens ?? 0}; remaining ${job.budget.remainingTokens ?? job.budget.maxTokens}; max steps ${getDurableJobMaxSteps(job)}; used steps ${job.budget.usedSteps ?? 0}; running agent cap ${job.budget.maxRunningAgents}; effective cap ${getEffectiveAgentCap(job)}; cap reason ${job.capReason ?? "default"}; timeout ${job.timeoutMs}ms; max runtime ${job.budget.maxRuntimeMs ?? job.timeoutMs}ms`,
    `- budget note: ${job.budget.note}`,
    `- pause reason: ${job.pauseReason ?? "-"}`,
    `- owner: session ${job.ownerSessionId ?? "-"}; pid ${job.ownerPid ?? "-"}; heartbeat ${job.heartbeatAt ?? "-"}`,
    `- worker: ${job.worker?.status ?? "not_started"}; session ${job.worker?.sessionId ?? "-"}; ${job.worker?.summary ?? "-"}`,
    `- verification: ${job.verification?.status ?? "not_run"}; ${job.verification?.summary ?? "-"}`,
    formatJobRunnerReportLine(job),
    formatApprovedRunnerSpecLine(job),
    `- handoff: ${job.handoffPacket?.id ?? "missing"}`,
    `- summary: lifecycle ${job.status}; result ${formatJobResultStatus(job)}; next ${formatJobNextAction(job, "en-US")}`,
    `- status semantics: ${formatJobLifecycleLegend()}`,
    "- evidence boundary: lifecycle/status lines are not verification evidence; use verification report/evidence refs before claiming work passed.",
    `- evidence refs: ${job.evidenceRefs.map((item) => item.id).join(", ") || "none"}`,
    `- logs: ${formatDisplayPath(job.logPath, job.projectPath)}`,
    `- fullOutput: ${formatDisplayPath(job.fullOutputPath, job.projectPath)}`,
    "",
    "## Task graph",
    ...job.plan.map((step, index) => `${index + 1}. ${step}`),
    "",
    "## Agent assignment",
    ...job.agents.map(
      (agent) =>
        `- ${agent.id}: ${agent.type}; status ${agent.status}; run ${agent.runId ?? "-"}; reason ${agent.statusReason ?? "-"}; budget tokens ${agent.budgetTokens}; goal ${agent.goal}`,
    ),
    "",
    "## Worker result",
    `- status: ${job.result?.status ?? "not_run"}`,
    `- summary: ${job.result?.summary ?? "Worker loop has not produced a result yet."}`,
    `- lifecycle: ${job.status === "completed" ? "completed means the bounded worker loop ended; verification remains partial until evidence is reviewed" : job.status}`,
    `- facts: ${job.result?.facts.join(" | ") ?? "none"}`,
    `- evidence refs: ${job.result?.evidenceRefs.join(", ") ?? "none"}`,
    "",
    "## Budget enforcement",
    `- used tokens: ${job.budget.usedTokens ?? 0}`,
    `- remaining tokens: ${job.budget.remainingTokens ?? job.budget.maxTokens}`,
    `- max runtime ms: ${job.budget.maxRuntimeMs ?? job.timeoutMs}`,
    "- conservative: overbudget/timeout/stale/blocked states do not generate evidence that verification passed.",
    "",
    "## Adopted conclusions",
    ...(job.adoptedConclusions.length > 0 ? job.adoptedConclusions : ["- none"]),
    "",
    "## Rejected conclusions",
    ...(job.rejectedConclusions.length > 0
      ? job.rejectedConclusions.map((item) => `- ${item}`)
      : [
          "- No blocked/cancelled/timeout/stale state is treated as evidence that verification passed.",
        ]),
    "",
    "## Boundaries",
    "- Node/TUI runtime remains default and explicit fallback; Phase 17C only adds a gated native runner resolver/adapter for approved durable job specs.",
    "- Native runner lifecycle completion is not verification evidence; failed/timeout/cancelled/stale/crash/protocol mismatch paths do not create evidence that verification passed.",
    "- DEFERRED: managed/bundled binary distribution, signing/AV/install matrix, real native-runner process-guard smoke, and parent hard-kill/crash proof.",
    "- Remote channels / Phase 17B, Fast Workspace Scanner, and Phase 18 desktop are NOT entered.",
    "- Agent context is trimmed to handoff/evidence/cache/index refs; no full transcript/source/index/log output is injected.",
  ];
  await mkdir(dirname(job.reportPath), { recursive: true });
  await writeFile(job.reportPath, `${lines.join("\n")}\n`, "utf8");
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatJobList(jobs: DurableJobState[], context: JobContext): string {
  if (jobs.length === 0) {
    return context.language === "en-US"
      ? "No durable jobs. Usage: /job run <goal>."
      : "\u5F53\u524D\u6CA1\u6709 durable job\u3002\u7528\u6CD5\uFF1A/job run <goal>\u3002";
  }
  return [
    context.language === "en-US" ? "Durable jobs:" : "Durable jobs\uFF1A",
    ...jobs.map((job) => {
      const counts = countDurableJobAgents(job);
      const label = job.agents[0]?.displayName ?? deriveAgentDisplayName("worker", job.goal);
      return `${job.id}  lifecycle ${formatJobStateSummary(job.status)}  result ${formatJobResultStatus(job)}  label ${label}  agents ${job.agents.length}/${counts.running}  queued ${counts.queued} sleeping ${counts.sleeping} blocked ${counts.blocked} stale ${counts.stale}  step ${job.budget.usedSteps ?? 0}/${getDurableJobMaxSteps(job)}  goal ${truncateDisplay(job.goal, 42)}  next /job status ${job.id}`;
    }),
    context.language === "en-US"
      ? `No default 3/4/20 visible running cap; requested agents are scheduled under explicit/requested cap and resource guard. Full troubleshooting is only in /job status <id>, /job report <id>, or /job logs <id>.`
      : `\u4E0D\u518D\u4EE5\u9ED8\u8BA4 3/4/20 \u4F5C\u4E3A\u7528\u6237\u53EF\u611F\u77E5\u8FD0\u884C\u4E0A\u9650\uFF1B\u8BF7\u6C42\u7684 agents \u4F1A\u6309\u663E\u5F0F/\u8BF7\u6C42 cap \u548C resource guard \u8C03\u5EA6\u3002\u5B8C\u6574\u6392\u67E5\u5165\u53E3\u53EA\u5728 /job status <id>\u3001/job report <id> \u6216 /job logs <id>\u3002`,
  ].join("\n");
}

export function formatJobPrimary(job: DurableJobState, context: JobContext): string {
  const runningAgents = job.agents.filter((agent) => agent.status === "running").length;
  const label = job.agents[0]?.displayName ?? deriveAgentDisplayName("worker", job.goal);
  return [
    `[job] ${job.id} \u00B7 ${job.status} \u00B7 ${label}`,
    context.language === "en-US"
      ? `- goal: ${truncateDisplay(job.goal, 72)}`
      : `- \u76EE\u6807\uFF1A${truncateDisplay(job.goal, 72)}`,
    context.language === "en-US"
      ? "- scope: local durable metadata + unified background task; no remote channel, Phase 18, Beta readiness, or smoke-ready claim."
      : "- \u8303\u56F4\uFF1A\u672C\u5730 durable metadata + \u7EDF\u4E00\u540E\u53F0\u4EFB\u52A1\uFF1B\u672A\u8FDB\u5165 remote\u3001Phase 18\u3001Beta readiness \u6216 smoke-ready\u3002",
    `- agents: planned ${job.agents.length}; scheduled ${job.agents.filter((agent) => agent.runId).length}; started ${job.agents.filter((agent) => agent.startedAt).length}; running ${runningAgents}; queued ${job.agents.filter((agent) => agent.status === "queued").length}; skipped ${job.agents.filter((agent) => agent.status === "skipped").length}; limited ${job.agents.filter((agent) => agent.status === "budget_limited" || agent.status === "resource_limited").length}; effective cap ${getEffectiveAgentCap(job)}; cap reason ${job.capReason ?? "default"}.`,
    `- status semantics: ${formatJobLifecycleLegend()}`,
    `- runner: ${formatJobRunnerInline(job)}`,
    `- verification: ${job.verification?.status ?? "not_run"}; lifecycle states never equal verification evidence.`,
    `- next: ${formatJobNextAction(job, context.language)}`,
    `- details: /job report ${job.id}; logs: /job logs ${job.id}; background: /background`,
  ].join("\n");
}

export function formatJobStatus(job: DurableJobState, language: Language = "en-US"): string {
  const counts = countDurableJobAgents(job);
  if (language !== "en-US") {
    return [
      `Job ${job.id}`,
      `- 状态：${formatJobStateSummary(job.status, language)}`,
      `- 结果：${formatJobResultStatus(job, language)}`,
      `- 下一步：${formatJobNextAction(job, language)}`,
      `- 暂停原因：${job.pauseReason ?? "无"}`,
      "- 恢复检查：执行任何 worker 步骤前先检查 handoff/evidence/index/resource guard",
      `- 目标：${truncateDisplay(job.goal, 120)}`,
      `- projectPath：${formatDisplayPath(job.projectPath, job.projectPath)}`,
      `- isolation：${job.isolation ?? "none"}`,
      `- phase/target：${job.phase} / ${job.target}`,
      `- agents：planned ${job.agents.length}; scheduled ${job.agents.filter((agent) => agent.runId).length}; started ${job.agents.filter((agent) => agent.startedAt).length}; running ${counts.running}; completed ${counts.completed}; queued ${counts.queued}; sleeping ${counts.sleeping}; skipped ${counts.skipped}; budget limited ${counts.budget_limited}; resource limited ${counts.resource_limited}; blocked ${counts.blocked}; stale ${counts.stale}; cap ${job.budget.maxRunningAgents}; effective cap ${getEffectiveAgentCap(job)}; cap reason ${job.capReason ?? "default"}`,
      `- 状态语义：${formatJobLifecycleLegend(language)}`,
      `- agent labels：${formatJobAgentLabels(job.agents)}`,
      formatJobBudgetLine(job),
      `- worker：${job.worker?.status ?? "not_started"}; step ${job.worker?.completedSteps ?? job.budget.usedSteps ?? 0}/${getDurableJobMaxSteps(job)}; session ${job.worker?.sessionId ?? "-"}; ${truncateDisplay(job.worker?.summary ?? "-", 120)}`,
      `- runner：${formatJobRunnerInline(job)}`,
      `- 证据边界：status/result 行不是验证通过证据；使用结论前请查看 /job report ${job.id}。`,
      `- permission：${job.permissionPolicy}; edit ${job.allowEdit}; bash ${job.allowBash}; multi-agent ${job.allowMultiAgent}`,
      `- 排障：/job report ${job.id}; /job logs ${job.id}; /details background ${job.id}`,
    ].join("\n");
  }
  return [
    `Job ${job.id}`,
    `- status: ${formatJobStateSummary(job.status, language)}`,
    `- result: ${formatJobResultStatus(job, language)}`,
    `- next action: ${formatJobNextAction(job, language)}`,
    `- pause reason: ${job.pauseReason ?? "-"}`,
    "- resume check: handoff/evidence/index/resource guard before any worker step",
    `- goal: ${truncateDisplay(job.goal, 120)}`,
    `- projectPath: ${formatDisplayPath(job.projectPath, job.projectPath)}`,
    `- isolation: ${job.isolation ?? "none"}`,
    `- phase/target: ${job.phase} / ${job.target}`,
    `- agents: planned ${job.agents.length}; scheduled ${job.agents.filter((agent) => agent.runId).length}; started ${job.agents.filter((agent) => agent.startedAt).length}; running ${counts.running}; completed ${counts.completed}; queued ${counts.queued}; sleeping ${counts.sleeping}; skipped ${counts.skipped}; budget limited ${counts.budget_limited}; resource limited ${counts.resource_limited}; blocked ${counts.blocked}; stale ${counts.stale}; cap ${job.budget.maxRunningAgents}; effective cap ${getEffectiveAgentCap(job)}; cap reason ${job.capReason ?? "default"}`,
    `- status semantics: ${formatJobLifecycleLegend(language)}`,
    `- agent labels: ${formatJobAgentLabels(job.agents)}`,
    formatJobBudgetLine(job),
    `- worker: ${job.worker?.status ?? "not_started"}; step ${job.worker?.completedSteps ?? job.budget.usedSteps ?? 0}/${getDurableJobMaxSteps(job)}; session ${job.worker?.sessionId ?? "-"}; ${truncateDisplay(job.worker?.summary ?? "-", 120)}`,
    `- runner: ${formatJobRunnerInline(job)}`,
    `- evidence boundary: status/result lines are not proof that verification passed; inspect /job report ${job.id} before using conclusions.`,
    `- permission: ${job.permissionPolicy}; edit ${job.allowEdit}; bash ${job.allowBash}; multi-agent ${job.allowMultiAgent}`,
    `- troubleshooting: /job report ${job.id}; /job logs ${job.id}; /details background ${job.id}`,
  ].join("\n");
}

export function formatJobReport(job: DurableJobState, language: Language = "en-US"): string {
  const counts = countDurableJobAgents(job);
  if (language !== "en-US") {
    return [
      `Job report ${job.id}`,
      `- 状态：${formatJobStateSummary(job.status, language)}；结果 ${formatJobResultStatus(job, language)}；暂停原因 ${job.pauseReason ?? "无"}`,
      `- 结论：${formatJobReportConclusion(job, language)}`,
      `- 下一步：${formatJobNextAction(job, language)}`,
      `- task graph：${job.plan.length} steps; worker ${job.worker?.status ?? "not_started"}; used steps ${job.budget.usedSteps ?? 0}/${getDurableJobMaxSteps(job)}`,
      `- isolation：${job.isolation ?? "none"}`,
      `- agent assignment：${formatJobAgentLabels(job.agents)}`,
      `- agent counts：planned ${job.agents.length}; scheduled ${job.agents.filter((agent) => agent.runId).length}; started ${job.agents.filter((agent) => agent.startedAt).length}; running ${counts.running}; completed ${counts.completed}; queued ${counts.queued}; sleeping ${counts.sleeping}; skipped ${counts.skipped}; budget limited ${counts.budget_limited}; resource limited ${counts.resource_limited}; blocked ${counts.blocked}; stale ${counts.stale}; cap ${job.budget.maxRunningAgents}; effective cap ${getEffectiveAgentCap(job)}; cap reason ${job.capReason ?? "default"}`,
      `- 状态语义：${formatJobLifecycleLegend(language)}`,
      formatJobBudgetLine(job),
      `- verification：${job.verification?.status ?? "not_run"}; ${truncateDisplay(job.verification?.summary ?? "-", 120)}`,
      "- 证据边界：report 只汇总有限 job 证据；完整诊断保留在下方 redacted/relative 路径中。",
      `- evidence refs：${formatJobEvidenceRefs(job)}`,
      `- runner：${formatJobRunnerInline(job)}`,
      `- adopted：${job.adoptedConclusions.join("; ") || "none"}`,
      `- rejected：${job.rejectedConclusions.join("; ") || "blocked/cancelled/timeout/stale 都不是验证通过证据"}`,
      `- log path：${formatDisplayPath(job.logPath, job.projectPath)}`,
      `- full output path：${formatDisplayPath(job.fullOutputPath, job.projectPath)}`,
      `- report path：${formatDisplayPath(job.reportPath, job.projectPath)}`,
    ].join("\n");
  }
  return [
    `Job report ${job.id}`,
    `- status: ${formatJobStateSummary(job.status, language)}; result ${formatJobResultStatus(job, language)}; pause reason ${job.pauseReason ?? "-"}`,
    `- conclusion: ${formatJobReportConclusion(job, language)}`,
    `- next action: ${formatJobNextAction(job, language)}`,
    `- task graph: ${job.plan.length} steps; worker ${job.worker?.status ?? "not_started"}; used steps ${job.budget.usedSteps ?? 0}/${getDurableJobMaxSteps(job)}`,
    `- isolation: ${job.isolation ?? "none"}`,
    `- agent assignment: ${formatJobAgentLabels(job.agents)}`,
    `- agent counts: planned ${job.agents.length}; scheduled ${job.agents.filter((agent) => agent.runId).length}; started ${job.agents.filter((agent) => agent.startedAt).length}; running ${counts.running}; completed ${counts.completed}; queued ${counts.queued}; sleeping ${counts.sleeping}; skipped ${counts.skipped}; budget limited ${counts.budget_limited}; resource limited ${counts.resource_limited}; blocked ${counts.blocked}; stale ${counts.stale}; cap ${job.budget.maxRunningAgents}; effective cap ${getEffectiveAgentCap(job)}; cap reason ${job.capReason ?? "default"}`,
    `- status semantics: ${formatJobLifecycleLegend(language)}`,
    formatJobBudgetLine(job),
    `- verification: ${job.verification?.status ?? "not_run"}; ${truncateDisplay(job.verification?.summary ?? "-", 120)}`,
    "- evidence boundary: report summarizes bounded job evidence only; full diagnostics stay in redacted/relative paths below.",
    `- evidence refs: ${formatJobEvidenceRefs(job)}`,
    `- runner: ${formatJobRunnerInline(job)}`,
    `- adopted: ${job.adoptedConclusions.join("; ") || "none"}`,
    `- rejected: ${job.rejectedConclusions.join("; ") || "blocked/cancelled/timeout/stale are never verification pass evidence"}`,
    `- log path: ${formatDisplayPath(job.logPath, job.projectPath)}`,
    `- full output path: ${formatDisplayPath(job.fullOutputPath, job.projectPath)}`,
    `- report path: ${formatDisplayPath(job.reportPath, job.projectPath)}`,
  ].join("\n");
}

function formatJobLifecycleLegend(language: Language = "en-US"): string {
  if (language !== "en-US") {
    return "running 当前活跃；queued 等待执行槽位；sleeping 被用户或 resource guard 暂停；blocked 需要明确修复；stale 丢失 owner/heartbeat 新鲜度；cancelled 被用户停止；timeout 达到运行时限；completed 只是生命周期结束；partial 表示不完整或未验证证据。";
  }
  return "running active now; queued waiting for an execution slot; sleeping paused by user/resource guard; blocked needs a concrete fix; stale lost owner/heartbeat freshness; cancelled stopped by user; timeout hit runtime limit; completed lifecycle ended only; partial means incomplete or unverified evidence.";
}

function formatJobStateSummary(
  status: DurableJobStatus | DurableJobAgentStatus | string,
  language: Language = "en-US",
): string {
  return `${status} (${formatJobStateMeaning(status, language)})`;
}

function formatJobStateMeaning(status: string, language: Language = "en-US"): string {
  if (language !== "en-US") {
    if (status === "running") return "当前活跃";
    if (status === "queued") return "等待执行槽位";
    if (status === "sleeping" || status === "created") return "已暂停或尚未启动";
    if (status === "blocked") return "需要明确修复后才能恢复";
    if (status === "stale") return "owner 或 heartbeat 新鲜度缺失";
    if (status === "cancelled") return "已被用户停止";
    if (status === "timeout") return "达到运行时限";
    if (status === "completed") return "生命周期结束；仍需单独查看证据";
    if (status === "partial") return "证据不完整或未验证";
    if (status === "failed") return "运行错误；请查看日志";
    return "durable job 生命周期状态";
  }
  if (status === "running") return "active now";
  if (status === "queued") return "waiting for execution slot";
  if (status === "sleeping" || status === "created") return "paused or not started";
  if (status === "blocked") return "needs a concrete fix before resume";
  if (status === "stale") return "owner or heartbeat freshness is missing";
  if (status === "cancelled") return "stopped by user";
  if (status === "timeout") return "runtime limit reached";
  if (status === "completed") return "lifecycle ended; review evidence separately";
  if (status === "partial") return "incomplete or unverified evidence";
  if (status === "failed") return "runtime error; inspect logs";
  return "durable job lifecycle state";
}

function formatJobResultStatus(job: DurableJobState, language: Language = "en-US"): string {
  return formatJobStateSummary(job.result?.status ?? "partial", language);
}

function formatJobEvidenceRefs(job: DurableJobState): string {
  if (job.evidenceRefs.length === 0 && !job.result?.evidenceRefs?.length) return "none";
  const durableRefs = job.evidenceRefs.map(
    (item) => `${item.id}:${item.kind}:${truncateDisplay(item.summary, 56)}`,
  );
  const resultRefs = job.result?.evidenceRefs.map((item) => `${item}:worker-result`) ?? [];
  return [...durableRefs, ...resultRefs].join(", ");
}

export function formatJobAgentLabels(agents: DurableJobAgent[]): string {
  return truncateDisplay(
    agents
      .map(
        (agent) =>
          `${agent.id}:${agent.displayName ?? deriveAgentDisplayName(agent.type, agent.goal)}:${agent.status}${agent.runId ? `:${agent.runId}` : ""}${agent.resultSummary ? `:${truncateDisplay(agent.resultSummary, 80)}` : ""}`,
      )
      .join(", "),
    200,
  );
}

export function formatJobReportConclusion(job: DurableJobState, language: Language = "en-US"): string {
  if (language !== "en-US") {
    if (job.status === "stale") {
      return "stale：heartbeat/owner 恢复失败；/job resume 会先重新检查 handoff、evidence/index 状态和 resource guard。";
    }
    if (job.status === "blocked") {
      return "blocked：需要先修复 handoff/evidence/index/resource guard；当前没有生成验证通过证据。";
    }
    if (job.status === "cancelled" || job.status === "timeout" || job.status === "completed") {
      return `${job.status} 是终态或保守状态；作为有效证据前请先检查 verification。`;
    }
    return "running/created job 使用裁剪后的 handoff、evidence refs、cache/index refs 和 resource guard。";
  }
  if (job.status === "stale") {
    return "stale because heartbeat/owner recovery failed; /job resume first rechecks handoff, evidence/index state, and resource guard.";
  }
  if (job.status === "blocked") {
    return "blocked until handoff/evidence/index/resource guard is repaired; no evidence that verification passed was generated.";
  }
  if (job.status === "cancelled" || job.status === "timeout" || job.status === "completed") {
    return `${job.status} is terminal or conservative; inspect verification before treating it as useful evidence.`;
  }
  return "running/created job uses trimmed handoff, evidence refs, cache/index refs, and resource guard.";
}

export function getJobPanelTone(job: DurableJobState): "neutral" | "warning" | "error" {
  if (job.status === "blocked" || job.status === "stale" || job.status === "timeout") {
    return "warning";
  }
  if (job.status === "cancelled" || job.result?.status === "failed") {
    return "error";
  }
  return "neutral";
}

export function formatJobPanelSummary(
  job: DurableJobState,
  language: Language,
  mode: "status" | "report",
): string[] {
  const nextAction = formatJobNextAction(job, language);
  const pauseReason = job.pauseReason ?? (language === "en-US" ? "none" : "无");
  const detailHint =
    language === "en-US"
      ? mode === "report"
        ? "Ctrl+O opens the full report."
        : "Ctrl+O opens the full status."
      : mode === "report"
        ? "Ctrl+O 查看完整报告。"
        : "Ctrl+O 查看完整状态。";
  const panelResult = job.result?.status ?? "pending";
  return [
    language === "en-US"
      ? `Job ${job.id} · ${job.status} · result ${panelResult}`
      : `Job ${job.id} · ${job.status} · result ${panelResult}`,
    language === "en-US" ? `- pause reason: ${pauseReason}` : `- pause reason：${pauseReason}`,
    language === "en-US" ? `- next: ${nextAction}` : `- next：${nextAction}`,
    `- ${detailHint}`,
  ];
}

export async function formatJobLogs(
  job: DurableJobState,
  language: Language = "en-US",
): Promise<string> {
  const content = await readFile(job.logPath, "utf8").catch(() => "");
  const tail = content
    .split(/\r?\n/u)
    .filter(Boolean)
    .slice(-JOB_LOG_TAIL_LINES)
    .map((line) => sanitizeDisplayPaths(line, job.projectPath));
  if (language !== "en-US") {
    return [
      `Job logs ${job.id}`,
      `- path：${formatDisplayPath(job.logPath, job.projectPath)}`,
      `- full output path：${formatDisplayPath(job.fullOutputPath, job.projectPath)}`,
      `- tail：仅显示最后 ${tail.length}/${JOB_LOG_TAIL_LINES} 行；完整排障使用上方 redacted/relative 路径`,
      `- 状态：${formatJobStateSummary(job.status, language)}；结果 ${formatJobResultStatus(job, language)}`,
      tail.length > 0 ? tail.join("\n") : "日志为空；job 可能尚未写入输出。",
    ].join("\n");
  }
  return [
    `Job logs ${job.id}`,
    `- path: ${formatDisplayPath(job.logPath, job.projectPath)}`,
    `- full output path: ${formatDisplayPath(job.fullOutputPath, job.projectPath)}`,
    `- tail: bounded last ${tail.length}/${JOB_LOG_TAIL_LINES} lines; full troubleshooting uses the redacted/relative paths above`,
    `- status: ${formatJobStateSummary(job.status, language)}; result ${formatJobResultStatus(job, language)}`,
    tail.length > 0
      ? tail.join("\n")
      : "Logs are empty; the job may not have written output yet.",
  ].join("\n");
}
