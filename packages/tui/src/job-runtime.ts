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
import { formatDisplayPath } from "./startup-runtime.js";

const appendFileAsync = promisify(fsAppendFile);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_JOB_RUNNING_AGENT_CAP = 3;
export const JOB_AGENT_HIGH_CONFIG_CANDIDATE = 8;
export const DEFAULT_JOB_TIMEOUT_MS = 30 * 60 * 1000;
export const DEFAULT_JOB_BUDGET_TOKENS = 120_000;
export const JOB_LOG_TAIL_LINES = 40;
export const JOB_RECOVERY_HEARTBEAT_STALE_MS = 2 * 60 * 1000;
export const DEFAULT_JOB_MAX_STEPS = 4;
export const MAX_JOB_MAX_STEPS = 20;
export const MAX_AGENTS = 20;

// ---------------------------------------------------------------------------
// Private utility copies (avoid circular import from index.ts)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripAnsi(text: string): string {
  const escapeChar = String.fromCharCode(27);
  return text.replace(new RegExp(`${escapeChar}\\[[0-9;]*m`, "g"), "");
}

function truncateDisplay(text: string, maxWidth: number): string {
  let width = 0;
  let result = "";
  for (const char of stripAnsi(text)) {
    const charWidth = char.charCodeAt(0) > 0xff ? 2 : 1;
    if (width + charWidth > maxWidth) {
      return `${result}\u2026`;
    }
    width += charWidth;
    result += char;
  }
  return result;
}

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
  timeoutMs: number;
  allowEdit: boolean;
  allowBash: boolean;
  allowMultiAgent: boolean;
  // P1-5 — 仅当用户显式传入 --tokens / --max-steps / --timeout 时为 true。
  // 未显式设置时 /job 没有用户可见预算，enforcement 不触发，UI 显示"预算：未设置"。
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
  let phase = "Phase 17A";
  let target = "local-durable-jobs";
  let requestedAgents = 1;
  let maxTokens = DEFAULT_JOB_BUDGET_TOKENS;
  let maxSteps = DEFAULT_JOB_MAX_STEPS;
  let timeoutMs = DEFAULT_JOB_TIMEOUT_MS;
  let allowEdit = false;
  let allowBash = false;
  let allowMultiAgent = false;
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
      requestedAgents = clampPositiveInt(args[index + 1], 1, MAX_AGENTS);
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
    timeoutMs,
    allowEdit,
    allowBash,
    allowMultiAgent,
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
// 未显式设置时 /job 没有用户可见预算，状态/报告显示"预算：未设置"，不展示默认 max。
function formatJobBudgetLine(job: DurableJobState): string {
  const explicit = job.budget.explicit;
  const parts: string[] = [];
  if (explicit?.tokens === true) {
    parts.push(`tokens=${job.budget.usedTokens ?? 0}/${job.budget.maxTokens}`);
  } else {
    parts.push(`tokens=${job.budget.usedTokens ?? 0}/未设置`);
  }
  if (explicit?.steps === true) {
    parts.push(`steps=${job.budget.usedSteps ?? 0}/${getDurableJobMaxSteps(job)}`);
  } else {
    parts.push(`steps=${job.budget.usedSteps ?? 0}/未设置`);
  }
  parts.push(explicit?.runtime === true ? `timeoutMs=${job.timeoutMs}` : "timeoutMs=未设置");
  const anyExplicit = Boolean(explicit?.tokens || explicit?.steps || explicit?.runtime);
  const prefix = anyExplicit ? "budget" : "budget(预算：未设置)";
  return `- ${prefix}: ${parts.join("; ")}`;
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
  job.capReason = reason;
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
  const total = Math.max(1, Math.min(options.requestedAgents, MAX_AGENTS));
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
    `verifier subtask: run real verification only; do not treat job lifecycle completion as PASS. Goal: ${goal}`,
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
  return resolve(job.projectPath).toLowerCase() === resolve(projectPath).toLowerCase();
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
    `- phase/target: ${job.phase} / ${job.target}`,
    `- permission: ${job.permissionPolicy}; allowEdit=${job.allowEdit}; allowBash=${job.allowBash}; allowMultiAgent=${job.allowMultiAgent}`,
    `- budget: maxTokens=${job.budget.maxTokens}; usedTokens=${job.budget.usedTokens ?? 0}; remainingTokens=${job.budget.remainingTokens ?? job.budget.maxTokens}; maxSteps=${getDurableJobMaxSteps(job)}; usedSteps=${job.budget.usedSteps ?? 0}; runningAgentCap=${job.budget.maxRunningAgents}; effectiveCap=${getEffectiveAgentCap(job)}; capReason=${job.capReason ?? "default"}; timeoutMs=${job.timeoutMs}; maxRuntimeMs=${job.budget.maxRuntimeMs ?? job.timeoutMs}`,
    `- budget note: ${job.budget.note}`,
    `- pauseReason: ${job.pauseReason ?? "-"}`,
    `- owner: session=${job.ownerSessionId ?? "-"}; pid=${job.ownerPid ?? "-"}; heartbeatAt=${job.heartbeatAt ?? "-"}`,
    `- worker: ${job.worker?.status ?? "not_started"}; session=${job.worker?.sessionId ?? "-"}; ${job.worker?.summary ?? "-"}`,
    `- verification: ${job.verification?.status ?? "not_run"}; ${job.verification?.summary ?? "-"}`,
    formatJobRunnerReportLine(job),
    formatApprovedRunnerSpecLine(job),
    `- handoff: ${job.handoffPacket?.id ?? "missing"}`,
    `- evidenceRefs: ${job.evidenceRefs.map((item) => item.id).join(", ") || "none"}`,
    `- logs: ${formatDisplayPath(job.logPath, job.projectPath)}`,
    `- fullOutput: ${formatDisplayPath(job.fullOutputPath, job.projectPath)}`,
    "",
    "## Task graph",
    ...job.plan.map((step, index) => `${index + 1}. ${step}`),
    "",
    "## Agent assignment",
    ...job.agents.map(
      (agent) =>
        `- ${agent.id}: ${agent.type} status=${agent.status} runId=${agent.runId ?? "-"} statusReason=${agent.statusReason ?? "-"} budgetTokens=${agent.budgetTokens} goal=${agent.goal}`,
    ),
    "",
    "## Worker result",
    `- status: ${job.result?.status ?? "not_run"}`,
    `- summary: ${job.result?.summary ?? "Worker loop has not produced a result yet."}`,
    `- lifecycle: ${job.status === "completed" ? "completed means the bounded worker loop ended; verification remains partial and is not PASS/smoke-ready" : job.status}`,
    `- facts: ${job.result?.facts.join(" | ") ?? "none"}`,
    `- evidenceRefs: ${job.result?.evidenceRefs.join(", ") ?? "none"}`,
    "",
    "## Budget enforcement",
    `- usedTokens: ${job.budget.usedTokens ?? 0}`,
    `- remainingTokens: ${job.budget.remainingTokens ?? job.budget.maxTokens}`,
    `- maxRuntimeMs: ${job.budget.maxRuntimeMs ?? job.timeoutMs}`,
    "- conservative: overbudget/timeout/stale/blocked states do not generate PASS evidence.",
    "",
    "## Adopted conclusions",
    ...(job.adoptedConclusions.length > 0 ? job.adoptedConclusions : ["- none"]),
    "",
    "## Rejected conclusions",
    ...(job.rejectedConclusions.length > 0
      ? job.rejectedConclusions.map((item) => `- ${item}`)
      : ["- No blocked/cancelled/timeout/stale state is treated as PASS evidence."]),
    "",
    "## Boundaries",
    "- Node/TUI runtime remains default and explicit fallback; Phase 17C only adds a gated native runner resolver/adapter for approved durable job specs.",
    "- Native runner lifecycle completion is not verification PASS; failed/timeout/cancelled/stale/crash/protocol mismatch paths do not create PASS evidence.",
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
      return `${job.id}  ${job.status}  label=${label}  agents=${job.agents.length}/${counts.running}  queued=${counts.queued} skipped=${counts.skipped} limited=${counts.budget_limited + counts.resource_limited} blocked=${counts.blocked} stale=${counts.stale}  effectiveCap=${getEffectiveAgentCap(job)} capReason=${job.capReason ?? "default"}  step=${job.budget.usedSteps ?? 0}/${getDurableJobMaxSteps(job)}  goal=${truncateDisplay(job.goal, 42)}  next=/job status ${job.id}`;
    }),
    context.language === "en-US"
      ? `Running cap=${DEFAULT_JOB_RUNNING_AGENT_CAP}; ${JOB_AGENT_HIGH_CONFIG_CANDIDATE} remains benchmark-only. Details: /job report <id> or /job logs <id>.`
      : `\u771F\u5B9E\u8FD0\u884C\u4E0A\u9650=${DEFAULT_JOB_RUNNING_AGENT_CAP}\uFF1B${JOB_AGENT_HIGH_CONFIG_CANDIDATE} \u4ECD\u662F benchmark \u5019\u9009\u3002\u8BE6\u60C5\uFF1A/job report <id> \u6216 /job logs <id>\u3002`,
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
      ? "- scope: local durable metadata + unified background task; no remote channel, Phase 18, Beta PASS, or smoke-ready claim."
      : "- \u8303\u56F4\uFF1A\u672C\u5730 durable metadata + \u7EDF\u4E00\u540E\u53F0\u4EFB\u52A1\uFF1B\u672A\u8FDB\u5165 remote\u3001Phase 18\u3001Beta PASS \u6216 smoke-ready\u3002",
    `- agents: planned=${job.agents.length}, scheduled=${job.agents.filter((agent) => agent.runId).length}, started=${job.agents.filter((agent) => agent.startedAt).length}, running=${runningAgents}, queued=${job.agents.filter((agent) => agent.status === "queued").length}, skipped=${job.agents.filter((agent) => agent.status === "skipped").length}, limited=${job.agents.filter((agent) => agent.status === "budget_limited" || agent.status === "resource_limited").length}, effectiveCap=${getEffectiveAgentCap(job)}; capReason=${job.capReason ?? "default"}.`,
    `- runner: ${formatJobRunnerInline(job)}`,
    `- verification: ${job.verification?.status ?? "not_run"}; completed/cancelled/timeout/stale/blocked never equals verification PASS.`,
    `- next: ${formatJobNextAction(job, context.language)}`,
    `- details: /job report ${job.id}; logs: /job logs ${job.id}; background: /background`,
  ].join("\n");
}

export function formatJobStatus(job: DurableJobState): string {
  const counts = countDurableJobAgents(job);
  return [
    `Job ${job.id}`,
    `- status: ${job.status}`,
    `- pauseReason: ${job.pauseReason ?? "-"}`,
    "- resumeCheck: handoff/evidence/index/resource guard before any worker step",
    `- goal: ${truncateDisplay(job.goal, 120)}`,
    `- projectPath: ${formatDisplayPath(job.projectPath, job.projectPath)}`,
    `- phase/target: ${job.phase} / ${job.target}`,
    `- agents: planned=${job.agents.length}; scheduled=${job.agents.filter((agent) => agent.runId).length}; started=${job.agents.filter((agent) => agent.startedAt).length}; running=${counts.running}; completed=${counts.completed}; queued=${counts.queued}; sleeping=${counts.sleeping}; skipped=${counts.skipped}; budget_limited=${counts.budget_limited}; resource_limited=${counts.resource_limited}; blocked=${counts.blocked}; stale=${counts.stale}; cap=${job.budget.maxRunningAgents}; effectiveCap=${getEffectiveAgentCap(job)}; capReason=${job.capReason ?? "default"}`,
    `- agent labels: ${formatJobAgentLabels(job.agents)}`,
    formatJobBudgetLine(job),
    `- worker: ${job.worker?.status ?? "not_started"}; step=${job.worker?.completedSteps ?? job.budget.usedSteps ?? 0}/${getDurableJobMaxSteps(job)}; session=${job.worker?.sessionId ?? "-"}; ${truncateDisplay(job.worker?.summary ?? "-", 120)}`,
    `- runner: ${formatJobRunnerInline(job)}`,
    `- permission: ${job.permissionPolicy}; allowEdit=${job.allowEdit}; allowBash=${job.allowBash}; allowMultiAgent=${job.allowMultiAgent}`,
    `- logPath: ${formatDisplayPath(job.logPath, job.projectPath)}`,
    `- fullOutputPath: ${formatDisplayPath(job.fullOutputPath, job.projectPath)}`,
    `- reportPath: ${formatDisplayPath(job.reportPath, job.projectPath)}`,
  ].join("\n");
}

export function formatJobReport(job: DurableJobState): string {
  const counts = countDurableJobAgents(job);
  return [
    `Job report ${job.id}`,
    `- status: ${job.status}; pauseReason=${job.pauseReason ?? "-"}`,
    `- conclusion: ${formatJobReportConclusion(job)}`,
    `- task graph: ${job.plan.length} steps; worker=${job.worker?.status ?? "not_started"}; usedSteps=${job.budget.usedSteps ?? 0}/${getDurableJobMaxSteps(job)}`,
    `- agent assignment: ${formatJobAgentLabels(job.agents)}`,
    `- agent counts: planned=${job.agents.length}; scheduled=${job.agents.filter((agent) => agent.runId).length}; started=${job.agents.filter((agent) => agent.startedAt).length}; running=${counts.running}; completed=${counts.completed}; queued=${counts.queued}; sleeping=${counts.sleeping}; skipped=${counts.skipped}; budget_limited=${counts.budget_limited}; resource_limited=${counts.resource_limited}; blocked=${counts.blocked}; stale=${counts.stale}; cap=${job.budget.maxRunningAgents}; effectiveCap=${getEffectiveAgentCap(job)}; capReason=${job.capReason ?? "default"}`,
    formatJobBudgetLine(job),
    `- verification: ${job.verification?.status ?? "not_run"}; ${truncateDisplay(job.verification?.summary ?? "-", 120)}`,
    `- runner: ${formatJobRunnerInline(job)}`,
    `- adopted: ${job.adoptedConclusions.join("; ") || "none"}`,
    `- rejected: ${job.rejectedConclusions.join("; ") || "blocked/cancelled/timeout/stale are never PASS"}`,
    `- logPath: ${formatDisplayPath(job.logPath, job.projectPath)}`,
    `- fullOutputPath: ${formatDisplayPath(job.fullOutputPath, job.projectPath)}`,
    `- reportPath: ${formatDisplayPath(job.reportPath, job.projectPath)}`,
  ].join("\n");
}

export function formatJobAgentLabels(agents: DurableJobAgent[]): string {
  return truncateDisplay(
    agents
      .map(
        (agent) =>
          `${agent.id}:${agent.displayName ?? deriveAgentDisplayName(agent.type, agent.goal)}:${agent.status}${agent.runId ? `:${agent.runId}` : ""}`,
      )
      .join(", "),
    140,
  );
}

export function formatJobReportConclusion(job: DurableJobState): string {
  if (job.status === "stale") {
    return "stale because heartbeat/owner recovery failed; /job resume first rechecks handoff, evidence/index state, and resource guard.";
  }
  if (job.status === "blocked") {
    return "blocked until handoff/evidence/index/resource guard is repaired; no PASS evidence generated.";
  }
  if (job.status === "cancelled" || job.status === "timeout" || job.status === "completed") {
    return `${job.status} is terminal or conservative; inspect verification before treating it as useful evidence.`;
  }
  return "running/created job uses trimmed handoff, evidence refs, cache/index refs, and resource guard.";
}

export async function formatJobLogs(job: DurableJobState): Promise<string> {
  const content = await readFile(job.logPath, "utf8").catch(() => "");
  const tail = content.split(/\r?\n/u).filter(Boolean).slice(-JOB_LOG_TAIL_LINES);
  return [
    `Job logs ${job.id}`,
    `- path: ${formatDisplayPath(job.logPath, job.projectPath)}`,
    `- fullOutputPath: ${formatDisplayPath(job.fullOutputPath, job.projectPath)}`,
    `- tailLines: ${tail.length}/${JOB_LOG_TAIL_LINES}`,
    tail.length > 0
      ? tail.join("\n")
      : "\u65E5\u5FD7\u4E3A\u7A7A\uFF1Bjob \u53EF\u80FD\u5C1A\u672A\u5199\u5165\u8F93\u51FA\u3002",
  ].join("\n");
}
