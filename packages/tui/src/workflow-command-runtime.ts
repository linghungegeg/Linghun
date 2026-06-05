import { randomUUID } from "node:crypto";
import { constants, accessSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Writable } from "node:stream";
import { resolveStoragePaths } from "@linghun/config";
import type { CacheFreshness } from "@linghun/core";
import type { Language } from "@linghun/shared";
import type { ToolName } from "@linghun/tools";
import type {
  RegistryAgentDefinition,
  RegistryWorkflowDefinition,
} from "./agent-workflow-registry.js";
import { checkBoundaries, estimateFileMetrics } from "./architecture-boundary.js";
import { summarizeArchitectureCard } from "./architecture-runtime.js";
import { showCommandPanel } from "./command-panel-runtime.js";
import { createEvidenceRecord } from "./evidence-runtime.js";
import { formatWorkflows } from "./extension-command-runtime.js";
import type { FailureLearningInput } from "./failure-learning-runtime.js";
import { formatIndexRuntimeRef } from "./index-runtime.js";
import {
  handleAgentsCommand,
  handleForkCommand,
  handleJobCommand,
} from "./job-agent-command-runtime.js";
import { DEFAULT_JOB_RUNNING_AGENT_CAP, getDurableJobStatePath } from "./job-runtime.js";
import { truncateDisplay, writeLine } from "./startup-runtime.js";
import {
  isRuntimeActiveBackgroundTask,
  listDurableJobs,
  rememberBackgroundTask,
} from "./tui-agent-job-runtime.js";
import type { TuiContext } from "./tui-context-runtime.js";
import { WORKFLOW_ARCHITECTURE_REVIEW_FILE_LIMIT } from "./tui-context-runtime.js";
import type {
  BackgroundTaskState,
  DurableJobState,
  EvidenceRecord,
  VerificationReport,
  WorkflowState,
  WorkflowStepState,
} from "./tui-data-types.js";
import { createVerificationPlan, runVerificationPlan } from "./verification-command-runtime.js";
import type {
  WorkflowBridgeRequestProposal,
  WorkflowMainChainRequest,
} from "./workflow-agent-runtime-bridge.js";
import {
  bridgeWorkflowPlanToMainChainRequests,
  decideWorkflowStepCapability,
} from "./workflow-agent-runtime-bridge.js";
import type { NormalizedWorkflowPlan } from "./workflow-plan-schema.js";
import type { WorkflowPlannerEntryResult } from "./workflow-planner-entry.js";

export type WorkflowCommandRuntimeDeps = {
  ensureSession: (context: TuiContext) => Promise<string>;
  appendSystemEvent: (
    context: TuiContext,
    sessionId: string,
    message: string,
    level: "info" | "warning",
  ) => Promise<void>;
  appendBackgroundTaskEvent: (
    context: TuiContext,
    sessionId: string,
    task: BackgroundTaskState,
  ) => Promise<void>;
  recordVerificationEvidence: (
    context: TuiContext,
    sessionId: string,
    report: VerificationReport,
  ) => Promise<void>;
  captureFailureLearning: (
    context: TuiContext,
    sessionId: string,
    input: FailureLearningInput,
  ) => Promise<void>;
  rememberEvidence: (context: TuiContext, evidence: EvidenceRecord) => void;
  handleSlashCommand: (
    text: string,
    context: TuiContext,
    output: Writable,
  ) => Promise<"handled" | "exit" | "message">;
  handleToolCommand: (
    toolName: ToolName,
    args: string[],
    context: TuiContext,
    output: Writable,
  ) => Promise<void>;
  createSilentOutput: () => Writable;
};

let workflowRuntimeDeps: WorkflowCommandRuntimeDeps | undefined;

export function configureWorkflowCommandRuntime(deps: WorkflowCommandRuntimeDeps): void {
  workflowRuntimeDeps = deps;
}

function getWorkflowDeps(): WorkflowCommandRuntimeDeps {
  if (!workflowRuntimeDeps) {
    throw new Error("workflow command runtime is not configured");
  }
  return workflowRuntimeDeps;
}

function ensureSession(context: TuiContext): Promise<string> {
  return getWorkflowDeps().ensureSession(context);
}

function appendSystemEvent(
  context: TuiContext,
  sessionId: string,
  message: string,
  level: "info" | "warning",
): Promise<void> {
  return getWorkflowDeps().appendSystemEvent(context, sessionId, message, level);
}

function appendBackgroundTaskEvent(
  context: TuiContext,
  sessionId: string,
  task: BackgroundTaskState,
): Promise<void> {
  return getWorkflowDeps().appendBackgroundTaskEvent(context, sessionId, task);
}

function recordVerificationEvidence(
  context: TuiContext,
  sessionId: string,
  report: VerificationReport,
): Promise<void> {
  return getWorkflowDeps().recordVerificationEvidence(context, sessionId, report);
}

function captureFailureLearning(
  context: TuiContext,
  sessionId: string,
  input: FailureLearningInput,
): Promise<void> {
  return getWorkflowDeps().captureFailureLearning(context, sessionId, input);
}

function rememberEvidence(context: TuiContext, evidence: EvidenceRecord): void {
  getWorkflowDeps().rememberEvidence(context, evidence);
}

async function handleSlashCommand(
  text: string,
  context: TuiContext,
  output: Writable,
): Promise<"handled" | "exit" | "message"> {
  return getWorkflowDeps().handleSlashCommand(text, context, output);
}

async function handleToolCommand(
  toolName: ToolName,
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  await getWorkflowDeps().handleToolCommand(toolName, args, context, output);
}

function createSilentOutput(): Writable {
  return getWorkflowDeps().createSilentOutput();
}

export async function handleWorkflowsCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  await hydrateWorkflowRuns(context);
  const name = args[0];
  if (!name) {
    const isEn = context.language === "en-US";
    showCommandPanel(context, output, {
      title: "/workflows",
      tone: "neutral",
      summary: [
        isEn
          ? `Workflows · ${context.workflows.templates.length} template${context.workflows.templates.length === 1 ? "" : "s"} — Ctrl+O for details.`
          : `Workflows · ${context.workflows.templates.length} 个模板 — Ctrl+O 查看详情。`,
      ],
      actions: [
        "/workflows plan <goal>",
        "/workflows run <goal>",
        "/workflows status",
        "/workflows registry",
      ],
      detailsText: formatWorkflows(context),
    });
    return;
  }
  if (name === "status") {
    const isEn = context.language === "en-US";
    const run = context.workflows.activeRun;
    showCommandPanel(context, output, {
      title: "/workflows status",
      tone: run?.status === "blocked" || run?.status === "failed" ? "warning" : "neutral",
      summary: run
        ? [
            isEn
              ? `Workflow ${run.id} · ${run.status} · ${run.result} — Ctrl+O for details.`
              : `Workflow ${run.id} · ${run.status} · ${run.result} — Ctrl+O 查看详情。`,
          ]
        : [
            isEn
              ? "No active workflow run — Ctrl+O for details."
              : "没有 active workflow run — Ctrl+O 查看详情。",
          ],
      actions: run
        ? ["/workflows status", "/background", "/details background <id>"]
        : ["/workflows plan <goal>", "/workflows registry"],
      detailsText: formatWorkflowStatus(context),
    });
    return;
  }
  if (name === "registry" || name === "list") {
    const isEn = context.language === "en-US";
    const agentCount = context.agentRegistry.agents.length;
    const workflowCount = context.workflowRegistry.workflows.length;
    const errorCount = context.agentRegistry.errors.length + context.workflowRegistry.errors.length;
    showCommandPanel(context, output, {
      title: "/workflows registry",
      tone: errorCount > 0 ? "warning" : "neutral",
      summary: [
        isEn
          ? `Registry · ${agentCount} agent${agentCount === 1 ? "" : "s"}, ${workflowCount} workflow${workflowCount === 1 ? "" : "s"}${errorCount > 0 ? ` · ${errorCount} schema error${errorCount === 1 ? "" : "s"}` : ""} — Ctrl+O for details.`
          : `Registry · ${agentCount} 个 agent、${workflowCount} 个 workflow${errorCount > 0 ? ` · ${errorCount} 个 schema 错误` : ""} — Ctrl+O 查看详情。`,
      ],
      actions: ["/workflows plan <goal>", "/workflows run <id>", "/workflows status"],
      detailsText: formatWorkflowRegistryList(context),
    });
    return;
  }
  if (name === "plan") {
    const goal = args.slice(1).join(" ").trim();
    if (!goal) {
      writeLine(
        output,
        context.language === "en-US"
          ? "Usage: /workflows plan <goal>"
          : "用法：/workflows plan <目标描述>",
      );
      return;
    }
    const { generateWorkflowPlanPreview, formatWorkflowPlanPreview } = await import(
      "./workflow-planner-entry.js"
    );
    const result = generateWorkflowPlanPreview({
      goal,
      permissionMode: context.permissionMode,
      ...buildWorkflowPlannerContextInput(context),
    });
    const isEn = context.language === "en-US";
    showCommandPanel(context, output, {
      title: "/workflows plan",
      tone: result.ok ? "neutral" : "warning",
      summary: [
        result.ok
          ? isEn
            ? `Plan for "${goal}" generated — Ctrl+O for details.`
            : `已为 "${goal}" 生成计划 — Ctrl+O 查看详情。`
          : isEn
            ? `Plan for "${goal}" has warnings — Ctrl+O for details.`
            : `"${goal}" 的计划存在警告 — Ctrl+O 查看详情。`,
      ],
      actions: result.ok
        ? ["/workflows run <goal>", "/workflows status", "/workflows registry"]
        : ["/workflows plan <goal>", "/workflows registry"],
      detailsText: formatWorkflowPlanPreview(result, context.language),
    });
    if (result.ok) {
      context.lastFullOutput = result.detailsText;
      await recordWorkflowPlanPreviewEvidence(context, await ensureSession(context), result);
    }
    return;
  }
  if (name === "run") {
    const target = args[1];
    const rest = args.slice(2).join(" ").trim();
    if (!target) {
      writeLine(
        output,
        context.language === "en-US"
          ? "Usage: /workflows run <workflowId|goal>"
          : "用法：/workflows run <workflowId|目标描述>",
      );
      return;
    }
    const registry = findRegistryWorkflow(context, target);
    if (registry) {
      await runRegistryWorkflow(registry, rest, false, context, output);
      return;
    }
    const registryAgent = findRegistryAgentWorkflow(context, target);
    if (registryAgent) {
      await runRegistryAgentWorkflow(registryAgent, rest, false, context, output);
      return;
    }
    const goal = args.slice(1).join(" ").trim();
    await runWorkflowSteps(goal, context, output);
    return;
  }
  const template = context.workflows.templates.find((item) => item.id === name);
  if (!template) {
    writeLine(output, `未知 workflow：${name}。可运行 /workflows 查看可用模板。`);
    return;
  }
  context.workflows.lastStarted = template.id;
  writeLine(
    output,
    [
      `Workflow Start Gate：${template.id}`,
      `- purpose: ${template.purpose}`,
      `- risk: ${template.risk}`,
      `- writesFiles: ${template.writesFiles ? "yes" : "no"}`,
      "- 启动前需要用户明确确认；本命令只展示启动门，不会自动改文件。",
      "- 后续写文件、Bash、联网、安装依赖仍走现有权限管道。",
      `- recommended validation: ${template.recommendedValidation.join(" && ")}`,
      "- finish check: 输出修改文件、验证结果、已知限制、交付检查与是否越界。",
    ].join("\n"),
  );
}

export function buildWorkflowPlannerContextInput(context: TuiContext): {
  controlledMemoryRef?: { rulesFound: boolean; summary?: string };
  selfLearningHints?: string[];
  failureLearningRefs?: Array<{ lesson: string; source: string }>;
  cacheFreshnessHint?: string;
  deepCompactRef?: { id: string; summary: string };
  indexStatusRef?: { status: string; projectName?: string; freshness?: string };
  architectureRef?: { target: string; summary: string };
} {
  const controlledMemoryRef =
    context.memory.projectRulesExists && context.memory.projectRulesSummary
      ? { rulesFound: true, summary: context.memory.projectRulesSummary }
      : undefined;
  const selfLearningHints = context.memory.accepted
    .filter((item) => item.source.startsWith("auto-learning:"))
    .slice(0, 5)
    .map((item) => item.summary)
    .filter(Boolean);
  const activeFailures = context.failureLearning.records
    .filter(
      (item) =>
        item.status === "active" && item.projectScope === context.failureLearning.projectScope,
    )
    .slice(0, 5)
    .map((item) => ({
      lesson: item.avoidNextTime,
      source: `${item.category}:${item.id.slice(0, 8)}`,
    }));
  return {
    ...(controlledMemoryRef ? { controlledMemoryRef } : {}),
    ...(selfLearningHints.length > 0 ? { selfLearningHints } : {}),
    ...(activeFailures.length > 0 ? { failureLearningRefs: activeFailures } : {}),
    ...(context.cache.lastFreshness
      ? { cacheFreshnessHint: summarizeWorkflowCacheFreshness(context.cache.lastFreshness) }
      : {}),
    ...(context.cache.deepCompact
      ? {
          deepCompactRef: {
            id: context.cache.deepCompact.id,
            summary: context.cache.deepCompact.summary,
          },
        }
      : {}),
    indexStatusRef: {
      status: context.index.status,
      projectName: context.index.projectName,
      freshness: formatIndexRuntimeRef(context.index),
    },
    ...(context.currentArchitectureCard
      ? {
          architectureRef: {
            target: context.currentArchitectureCard.target,
            summary: summarizeArchitectureCard(context.currentArchitectureCard).recommendedApproach,
          },
        }
      : {}),
  };
}

type DurableWorkflowRunState = NonNullable<WorkflowState["activeRun"]> & {
  projectPath: string;
  updatedAt: string;
  backgroundTask: BackgroundTaskState;
};

function getWorkflowRunsRoot(context: TuiContext): string {
  return join(dirname(resolveStoragePaths(context.config, context.projectPath).jobs), "workflows");
}

function getWorkflowRunStatePath(context: TuiContext, runId: string): string {
  return join(getWorkflowRunsRoot(context), runId, "state.json");
}

async function persistWorkflowRunState(
  context: TuiContext,
  run: NonNullable<WorkflowState["activeRun"]>,
  task: BackgroundTaskState,
): Promise<void> {
  const path = getWorkflowRunStatePath(context, run.id);
  const state: DurableWorkflowRunState = {
    ...run,
    projectPath: context.projectPath,
    updatedAt: new Date().toISOString(),
    backgroundTask: task,
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export async function hydrateWorkflowRuns(context: TuiContext): Promise<void> {
  const root = getWorkflowRunsRoot(context);
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const state = await readWorkflowRunState(join(root, entry.name, "state.json"));
    if (
      !state ||
      resolve(state.projectPath).toLowerCase() !== resolve(context.projectPath).toLowerCase()
    ) {
      continue;
    }
    const run = recoverWorkflowRunState(state);
    context.workflows.activeRun = run;
    const background = createWorkflowBackgroundProjection(state.backgroundTask, run);
    upsertWorkflowBackgroundTask(context, background);
    if (
      run.status !== state.status ||
      run.steps.some((step, index) => step.status !== state.steps[index]?.status)
    ) {
      await persistWorkflowRunState(context, run, background);
    }
  }
}

async function readWorkflowRunState(path: string): Promise<DurableWorkflowRunState | null> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<DurableWorkflowRunState>;
    if (
      typeof parsed.id !== "string" ||
      typeof parsed.goal !== "string" ||
      typeof parsed.planId !== "string" ||
      typeof parsed.projectPath !== "string" ||
      !Array.isArray(parsed.steps) ||
      !parsed.backgroundTask
    ) {
      return null;
    }
    return parsed as DurableWorkflowRunState;
  } catch {
    return null;
  }
}

function recoverWorkflowRunState(
  state: DurableWorkflowRunState,
): NonNullable<WorkflowState["activeRun"]> {
  const recoveredSteps = state.steps.map((step) =>
    step.status === "running"
      ? {
          ...step,
          status: "stale" as const,
          summary: step.summary ?? "Workflow step was running before restart; marked stale.",
        }
      : step,
  );
  const hasStale = recoveredSteps.some((step) => step.status === "stale");
  const status = state.status === "running" && hasStale ? "stale" : state.status;
  return {
    id: state.id,
    goal: state.goal,
    planId: state.planId,
    status,
    steps: recoveredSteps,
    startedAt: state.startedAt,
    endedAt: state.endedAt,
    result: status === "completed" ? "partial" : status === "stale" ? "stale" : state.result,
    // Preserve persisted gate state; default false for old state files that lack the field.
    phaseGateConfirmed: state.phaseGateConfirmed === true,
  };
}

function createWorkflowBackgroundProjection(
  task: BackgroundTaskState,
  run: NonNullable<WorkflowState["activeRun"]>,
): BackgroundTaskState {
  const runningStep = run.steps.find((step) => step.status === "running");
  const staleStep = run.steps.find((step) => step.status === "stale");
  return {
    ...task,
    status: run.status === "running" ? "running" : run.status === "stale" ? "stale" : task.status,
    currentStep: staleStep?.summary ?? runningStep?.title ?? task.currentStep,
    updatedAt: new Date().toISOString(),
    result: run.status === "completed" ? "partial" : run.status === "failed" ? "fail" : "partial",
    userVisibleSummary:
      run.status === "stale"
        ? "Workflow stale after restart; inspect /workflows status before rerun."
        : task.userVisibleSummary,
    nextAction:
      run.status === "stale"
        ? "Use /workflows status and rerun after checking stale step evidence."
        : task.nextAction,
  };
}

export function upsertWorkflowBackgroundTask(context: TuiContext, task: BackgroundTaskState): void {
  const existing = context.backgroundTasks.find((item) => item.id === task.id);
  if (existing) {
    Object.assign(existing, task);
    return;
  }
  rememberBackgroundTask(context, task);
}

export function createWorkflowInterruptBackgroundTask(
  run: NonNullable<WorkflowState["activeRun"]>,
  language: Language,
): BackgroundTaskState {
  const now = new Date().toISOString();
  const runningStep = run.steps.find((step) => step.status === "running");
  return {
    id: run.id,
    kind: "job",
    title: `Workflow: ${truncateDisplay(run.goal, 50)}`,
    status: "running",
    currentStep: runningStep?.title ?? "workflow running",
    progress: {
      completed: run.steps.filter(
        (step) => step.status === "completed" || step.status === "partial",
      ).length,
      total: run.steps.length,
      label: "workflow",
    },
    startedAt: run.startedAt,
    updatedAt: now,
    heartbeatIntervalMs: 30_000,
    staleAfterMs: 120_000,
    hasOutput: false,
    result: "partial",
    userVisibleSummary:
      language === "en-US"
        ? "Workflow was active; interrupt is reconciling its missing background state."
        : "workflow 仍处于活动状态；中断正在恢复缺失的后台状态。",
    nextAction:
      language === "en-US"
        ? "Inspect /workflows status before rerun."
        : "重跑前请先查看 /workflows status。",
  };
}

export function formatWorkflowStatus(context: TuiContext): string {
  const run = context.workflows.activeRun;
  if (!run) {
    return context.language === "en-US"
      ? "No active workflow run."
      : "当前没有 active workflow run。";
  }
  const counts = run.steps.reduce(
    (acc, step) => {
      acc[step.status] += 1;
      return acc;
    },
    {
      queued: 0,
      running: 0,
      completed: 0,
      partial: 0,
      failed: 0,
      blocked: 0,
      cancelled: 0,
      stale: 0,
    } satisfies Record<WorkflowStepState["status"], number>,
  );
  return [
    `Workflow ${run.id}`,
    `- status: ${run.status}; result ${run.result}`,
    `- goal: ${truncateDisplay(run.goal, 120)}`,
    `- planId: ${run.planId}`,
    `- steps: queued ${counts.queued}; running ${counts.running}; completed ${counts.completed}; partial ${counts.partial}; blocked ${counts.blocked}; failed ${counts.failed}; cancelled ${counts.cancelled}; stale ${counts.stale}`,
    `- evidenceRefs: ${run.steps.flatMap((step) => step.evidenceRefs).join(", ") || "none"}`,
    "- completion is PARTIAL only; blocked/stale/cancelled/failed steps never claim PASS.",
    "- background: /background; details: /details background <id>",
  ].join("\n");
}

export function formatWorkflowStartPrimary(input: {
  language: Language;
  steps: number;
  currentPhase: string;
  background: boolean;
}): string {
  const phase = formatWorkflowDisplayLabel(input.currentPhase, "workflow");
  if (input.language === "en-US") {
    return [
      input.background ? "Background workflow started." : "Workflow started.",
      `- steps: ${input.steps}`,
      `- current phase: ${phase}`,
      "- details: /workflows status or /background",
    ].join("\n");
  }
  return [
    input.background ? "后台 workflow 已启动。" : "workflow 已启动。",
    `- steps: ${input.steps}`,
    `- 当前阶段：${phase}`,
    "- 详情：/workflows status 或 /background",
  ].join("\n");
}

function formatWorkflowBackgroundSummary(input: {
  language: Language;
  steps: number;
  currentPhase: string;
  background: boolean;
}): string {
  const phase = formatWorkflowDisplayLabel(input.currentPhase, "workflow");
  if (input.language === "en-US") {
    return `${input.background ? "Background workflow started" : "Workflow started"}; steps: ${input.steps}; current phase: ${phase}; details: /workflows status or /background.`;
  }
  return `${input.background ? "后台 workflow 已启动" : "workflow 已启动"}；steps: ${input.steps}；当前阶段：${phase}；详情：/workflows status 或 /background。`;
}

function formatWorkflowDisplayLabel(value: string | undefined, fallback: string): string {
  const cleaned = (value ?? "").replace(/\s+/g, " ").trim();
  if (!cleaned) return fallback;
  if (/^workflow(?:[-:_]|$)/iu.test(cleaned)) return fallback;
  if (/^(agent|verification|details|index|bash|write):[\w.-]+$/iu.test(cleaned)) {
    return workflowActionLabel(cleaned.split(":")[0] ?? "", fallback);
  }
  return truncateDisplay(cleaned, 48);
}

function formatRegistryWorkflowStepTitle(
  step: RegistryWorkflowDefinition["steps"][number],
): string {
  if (step.task?.trim()) return truncateDisplay(step.task.replace(/\s+/g, " ").trim(), 48);
  return workflowActionLabel(step.action, "workflow step");
}

function workflowActionLabel(action: string, fallback: string): string {
  switch (action) {
    case "agent":
      return "agent step";
    case "verification":
      return "verification step";
    case "index":
      return "index step";
    case "details":
      return "details step";
    case "bash":
      return "bash step";
    case "write":
      return "write step";
    default:
      return fallback;
  }
}

export async function runWorkflowSteps(
  goal: string,
  context: TuiContext,
  output: Writable,
  options: RunWorkflowExecutionOptions = {},
): Promise<void> {
  const { generateWorkflowPlanPreview } = await import("./workflow-planner-entry.js");
  const preview = generateWorkflowPlanPreview({
    goal,
    permissionMode: context.permissionMode,
    agents: options.agents,
    multiAgent: options.multiAgent,
    runningCap: options.runningCap,
    teamName: options.teamName,
    ...buildWorkflowPlannerContextInput(context),
  });
  if (!preview.ok) {
    writeLine(output, `工作流计划生成失败：${preview.reason}`);
    return;
  }

  const phase =
    preview.plan.phases.find((item) => item.id === preview.plan.currentPhaseId) ??
    preview.plan.phases[0];
  if (!phase) {
    writeLine(output, "工作流运行失败：计划没有可执行 phase。");
    return;
  }
  const confirmed = generateWorkflowPlanPreview({
    goal,
    permissionMode: context.permissionMode,
    agents: options.agents,
    multiAgent: options.multiAgent,
    runningCap: options.runningCap,
    teamName: options.teamName,
    ...buildWorkflowPlannerContextInput(context),
    confirmedPhaseStopPoints: [phase.id],
  });
  if (!confirmed.ok) {
    writeLine(output, `工作流运行失败：${confirmed.reason}`);
    return;
  }

  await runWorkflowPlanSteps(goal, confirmed.plan, context, output, options);
}

type RunWorkflowExecutionOptions = {
  agents?: number;
  multiAgent?: boolean;
  runningCap?: number;
  teamName?: string;
  __testRunId?: string;
  /** Propagated from activeRun.phaseGateConfirmed. When true, the bridge
   *  marks mutating requests as executable (per-tool permission still applies).
   *  When false/undefined, mutating requests stay blocked at the bridge layer. */
  phaseGateConfirmed?: boolean;
};

type WorkflowBatchItem = {
  step: WorkflowStepState;
  request: WorkflowBridgeRequestProposal;
};

export async function __testRunWorkflowStepsWithPlan(
  goal: string,
  plan: NormalizedWorkflowPlan,
  context: TuiContext,
  output: Writable,
  options: RunWorkflowExecutionOptions = {},
): Promise<void> {
  await runWorkflowPlanSteps(goal, plan, context, output, options);
}

export function __testGetCurrentWorkflowStepRequest(
  plan: NormalizedWorkflowPlan,
  phaseId: string,
  steps: WorkflowStepState[],
  stepId: string,
  options: RunWorkflowExecutionOptions = {},
): WorkflowBridgeRequestProposal {
  return getCurrentWorkflowStepRequest(plan, phaseId, steps, stepId, options);
}

async function runWorkflowPlanSteps(
  goal: string,
  plan: NormalizedWorkflowPlan,
  context: TuiContext,
  output: Writable,
  options: RunWorkflowExecutionOptions = {},
): Promise<void> {
  const phase = plan.phases.find((item) => item.id === plan.currentPhaseId) ?? plan.phases[0];
  if (!phase) {
    writeLine(output, "工作流运行失败：计划没有可执行 phase。");
    return;
  }

  const sessionId = await ensureSession(context);
  const runId = options.__testRunId ?? `workflow-${randomUUID().slice(0, 8)}`;
  const startedAt = new Date().toISOString();
  const executableSlices = plan.phases.flatMap((item) => item.slices);
  const stepStates: WorkflowStepState[] = executableSlices.map((slice) => ({
    id: slice.id,
    title: slice.title,
    status: "queued",
    runtime: workflowRuntimeKind(getCurrentWorkflowStepRequest(plan, phase.id, [], slice.id)),
    evidenceRefs: (slice.evidence ?? []).map((item) => item.ref),
    dependsOnSliceIds: slice.dependsOnSliceIds ?? [],
    independent: slice.independent === true,
    canRunInParallel: slice.canRunInParallel === true,
  }));
  const workflowTask: BackgroundTaskState = {
    id: runId,
    kind: "job",
    title: `Workflow: ${truncateDisplay(goal, 50)}`,
    status: "running",
    currentStep: "workflow starting",
    progress: { completed: 0, total: stepStates.length, label: "workflow" },
    startedAt,
    updatedAt: startedAt,
    heartbeatIntervalMs: 30_000,
    staleAfterMs: 120_000,
    hasOutput: false,
    result: "partial",
    userVisibleSummary: formatWorkflowBackgroundSummary({
      language: context.language,
      steps: stepStates.length,
      currentPhase: phase.title || phase.id,
      background: false,
    }),
    nextAction: "等待 step_result；失败时查看 /failures 和 transcript。",
  };
  context.workflows.activeRun = {
    id: runId,
    goal,
    planId: plan.id,
    status: "running",
    steps: stepStates,
    startedAt,
    result: "partial",
    phaseGateConfirmed: true,
  };
  rememberBackgroundTask(context, workflowTask);
  await persistWorkflowRunState(context, context.workflows.activeRun, workflowTask);
  await context.store.appendEvent(sessionId, {
    type: "workflow_start",
    workflow: {
      id: runId,
      goal,
      planId: plan.id,
      steps: stepStates,
      multiAgent: options.multiAgent === true,
      agents: options.agents,
      runningCap: normalizeWorkflowRunningCap(options.runningCap ?? plan.budget.maxRunningAgents),
      teamName: options.teamName,
    },
    createdAt: startedAt,
  });
  await appendBackgroundTaskEvent(context, sessionId, workflowTask);
  writeLine(
    output,
    formatWorkflowStartPrimary({
      language: context.language,
      steps: stepStates.length,
      currentPhase: phase.title || phase.id,
      background: false,
    }),
  );

  let completed = 0;
  let batchIndex = 0;
  const gateOptions: RunWorkflowExecutionOptions = {
    ...options,
    phaseGateConfirmed: context.workflows.activeRun?.phaseGateConfirmed === true,
  };
  while (stepStates.some((step) => step.status === "queued")) {
    if (isWorkflowRunTerminal(context, runId, workflowTask)) return;
    const batch = selectRunnableWorkflowBatch(plan, phase.id, stepStates, gateOptions);
    if (batch.length === 0) {
      const blocked = stepStates.find((step) => step.status === "queued");
      const summary = formatWorkflowStepSummary(
        blocked?.id ?? "workflow",
        "blocked",
        "no runnable workflow slice; dependencies or running cap left all remaining slices waiting",
        context.language,
      );
      if (blocked) {
        blocked.status = "blocked";
        blocked.summary = summary;
        blocked.endedAt = new Date().toISOString();
      }
      await finishWorkflowRun(runId, "blocked", summary, context, sessionId, workflowTask);
      return;
    }
    batchIndex += 1;
    const stepStartedAt = new Date().toISOString();
    for (const item of batch) {
      item.step.status = "running";
      item.step.startedAt = stepStartedAt;
      item.step.batchId = `batch-${batchIndex}`;
    }
    workflowTask.currentStep =
      batch.length === 1
        ? batch[0]?.step.title
        : `workflow batch ${batchIndex}: ${batch.map((item) => item.step.title).join(", ")}`;
    workflowTask.progress = {
      completed,
      total: stepStates.length,
      label: batch.length === 1 ? (batch[0]?.step.runtime ?? "workflow") : "workflow-batch",
    };
    workflowTask.updatedAt = stepStartedAt;
    await persistWorkflowRunState(context, context.workflows.activeRun, workflowTask);
    for (const item of batch) {
      await context.store.appendEvent(sessionId, {
        type: "workflow_step_start",
        workflowId: runId,
        step: item.step,
        createdAt: stepStartedAt,
      });
    }
    await appendBackgroundTaskEvent(context, sessionId, workflowTask);

    const results = await Promise.all(
      batch.map(async (item) => ({
        step: item.step,
        result: await executeWorkflowStep(
          item.request,
          context,
          output,
          runId,
          normalizeWorkflowRunningCap(options.runningCap ?? plan.budget.maxRunningAgents),
        ),
      })),
    );
    if (isWorkflowRunTerminal(context, runId, workflowTask)) return;
    const stepEndedAt = new Date().toISOString();
    for (const item of results) {
      item.step.status = item.result.status;
      item.step.summary = item.result.summary;
      item.step.evidenceRefs = item.result.evidenceRefs;
      item.step.endedAt = stepEndedAt;
      if (item.result.status === "completed" || item.result.status === "partial") completed += 1;
    }
    const terminal = results.find(
      (item) => item.result.status !== "completed" && item.result.status !== "partial",
    );
    workflowTask.currentStep =
      terminal?.result.summary ??
      (results.length === 1
        ? (results[0]?.result.summary ?? "workflow step completed")
        : `workflow batch ${batchIndex} completed`);
    workflowTask.progress = { completed, total: stepStates.length, label: "workflow" };
    workflowTask.updatedAt = stepEndedAt;
    workflowTask.lastOutputAt = stepEndedAt;
    workflowTask.hasOutput = true;
    await persistWorkflowRunState(context, context.workflows.activeRun, workflowTask);
    for (const item of results) {
      await context.store.appendEvent(sessionId, {
        type: "workflow_step_result",
        workflowId: runId,
        stepId: item.step.id,
        status: item.result.status,
        summary: item.result.summary,
        evidenceRefs: item.result.evidenceRefs,
        createdAt: stepEndedAt,
      });
    }
    await appendBackgroundTaskEvent(context, sessionId, workflowTask);

    if (terminal) {
      await finishWorkflowRun(
        runId,
        terminal.result.status,
        terminal.result.summary,
        context,
        sessionId,
        workflowTask,
      );
      return;
    }
  }

  await finishWorkflowRun(
    runId,
    "completed",
    "Workflow steps completed; result remains PARTIAL until verification/final gate evidence proves PASS.",
    context,
    sessionId,
    workflowTask,
  );
  writeLine(
    output,
    context.language === "en-US"
      ? "Workflow completed with PARTIAL result; no PASS evidence generated. Use /workflows status for details."
      : "workflow 已完成，结果仍为 PARTIAL；未生成 PASS 证据。可用 /workflows status 查看详情。",
  );
}

function isWorkflowRunTerminal(
  context: TuiContext,
  runId: string,
  task: BackgroundTaskState,
): boolean {
  const status =
    context.workflows.activeRun?.id === runId ? context.workflows.activeRun.status : undefined;
  return (
    status === "completed" ||
    status === "partial" ||
    status === "failed" ||
    status === "blocked" ||
    status === "cancelled" ||
    status === "stale" ||
    task.status === "completed" ||
    task.status === "failed" ||
    task.status === "cancelled" ||
    task.status === "timeout" ||
    task.status === "stale"
  );
}

function formatWorkflowRegistryList(context: TuiContext): string {
  const lines = [context.language === "en-US" ? "Workflow registry:" : "Workflow registry："];
  if (context.workflowRegistry.errors.length > 0 || context.agentRegistry.errors.length > 0) {
    lines.push("- registry schema errors:");
    for (const error of [...context.agentRegistry.errors, ...context.workflowRegistry.errors]) {
      lines.push(`  - ${error}`);
    }
  }
  if (
    context.workflowRegistry.workflows.length === 0 &&
    context.agentRegistry.agents.length === 0
  ) {
    lines.push(
      context.language === "en-US"
        ? "- no custom agents/workflows found under .linghun/agents or .linghun/workflows"
        : "- .linghun/agents 或 .linghun/workflows 下暂无自定义 agent/workflow",
    );
    return lines.join("\n");
  }
  for (const agent of context.agentRegistry.agents) {
    lines.push(`- agent:${agent.id} ${agent.name}: ${agent.description}`);
  }
  for (const workflow of context.workflowRegistry.workflows) {
    lines.push(`- ${workflow.id} ${workflow.name}: ${workflow.description}`);
  }
  return lines.join("\n");
}

export function findRegistryWorkflow(
  context: TuiContext,
  id: string | undefined,
): RegistryWorkflowDefinition | undefined {
  if (!id) return undefined;
  return context.workflowRegistry.workflows.find((workflow) => workflow.id === id);
}

export function findRegistryAgentWorkflow(
  context: TuiContext,
  id: string | undefined,
): RegistryAgentDefinition | undefined {
  if (!id?.startsWith("agent:")) return undefined;
  const agentId = id.slice("agent:".length);
  return context.agentRegistry.agents.find(
    (agent) => agent.id === agentId || agent.name === agentId,
  );
}

export async function runRegistryAgentWorkflow(
  agent: RegistryAgentDefinition,
  goal: string,
  runInBackground: boolean,
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const task = goal || agent.description;
  await handleForkCommand(
    [agent.id, task, ...(runInBackground ? ["--background"] : [])],
    context,
    output,
  );
}

export async function runRegistryWorkflow(
  workflow: RegistryWorkflowDefinition,
  goal: string,
  runInBackground: boolean,
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const sessionId = await ensureSession(context);
  const runId = `workflow-${workflow.id}-${randomUUID().slice(0, 8)}`;
  const startedAt = new Date().toISOString();
  const stepStates: WorkflowStepState[] = workflow.steps.map((step) => ({
    id: step.id,
    title: formatRegistryWorkflowStepTitle(step),
    status: "queued",
    runtime:
      step.action === "verification"
        ? "verification"
        : step.action === "details"
          ? "details"
          : "agent",
    evidenceRefs: [],
  }));
  const task: BackgroundTaskState = {
    id: runId,
    kind: "job",
    title: `Workflow: ${truncateDisplay(workflow.name || "workflow", 50)}`,
    status: "running",
    currentStep: "workflow starting",
    progress: { completed: 0, total: stepStates.length, label: "workflow" },
    startedAt,
    updatedAt: startedAt,
    heartbeatIntervalMs: 30_000,
    staleAfterMs: 120_000,
    hasOutput: false,
    result: "partial",
    userVisibleSummary: formatWorkflowBackgroundSummary({
      language: context.language,
      steps: stepStates.length,
      currentPhase: workflow.name,
      background: runInBackground || Boolean(workflow.runInBackground),
    }),
    nextAction: "查看 /workflows registry、/background 或 /details background。",
  };
  context.workflows.activeRun = {
    id: runId,
    goal: goal || workflow.description,
    planId: workflow.id,
    status: "running",
    steps: stepStates,
    startedAt,
    result: "partial",
    phaseGateConfirmed: true,
  };
  rememberBackgroundTask(context, task);
  await persistWorkflowRunState(context, context.workflows.activeRun, task);
  await context.store.appendEvent(sessionId, {
    type: "workflow_start",
    workflow: {
      id: runId,
      goal: goal || workflow.description,
      planId: workflow.id,
      steps: stepStates,
    },
    createdAt: startedAt,
  });
  await appendBackgroundTaskEvent(context, sessionId, task);
  writeLine(
    output,
    formatWorkflowStartPrimary({
      language: context.language,
      steps: stepStates.length,
      currentPhase: workflow.name,
      background: runInBackground || Boolean(workflow.runInBackground),
    }),
  );
  if (runInBackground || workflow.runInBackground) {
    writeLine(
      output,
      context.language === "en-US"
        ? "Workflow is running in the background. Use /background for details."
        : "workflow 正在后台运行。可用 /background 查看详情。",
    );
    setTimeout(() => {
      void executeRegistryWorkflowRun(
        workflow,
        goal,
        runId,
        stepStates,
        task,
        context,
        sessionId,
        createSilentOutput(),
      ).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        void finishWorkflowRun(
          runId,
          "failed",
          `Registry workflow failed: ${message}`,
          context,
          sessionId,
          task,
        );
      });
    }, 0);
    return;
  }

  await executeRegistryWorkflowRun(
    workflow,
    goal,
    runId,
    stepStates,
    task,
    context,
    sessionId,
    output,
  );
}

async function executeRegistryWorkflowRun(
  workflow: RegistryWorkflowDefinition,
  goal: string,
  runId: string,
  stepStates: WorkflowStepState[],
  task: BackgroundTaskState,
  context: TuiContext,
  sessionId: string,
  output: Writable,
): Promise<void> {
  let completed = 0;
  for (const step of workflow.steps) {
    if (isWorkflowRunTerminal(context, runId, task)) return;
    const state = stepStates.find((item) => item.id === step.id);
    const started = new Date().toISOString();
    if (state) {
      state.status = "running";
      state.startedAt = started;
    }
    task.currentStep = formatRegistryWorkflowStepTitle(step);
    task.updatedAt = started;
    task.progress = { completed, total: stepStates.length, label: step.action };
    if (context.workflows.activeRun?.id === runId) {
      await persistWorkflowRunState(context, context.workflows.activeRun, task);
    }
    await appendBackgroundTaskEvent(context, sessionId, task);
    const result = await executeRegistryWorkflowStep(workflow, step, goal, context, output);
    if (isWorkflowRunTerminal(context, runId, task)) return;
    const ended = new Date().toISOString();
    if (state) {
      state.status = result.status;
      state.summary = result.summary;
      state.evidenceRefs = result.evidenceRefs;
      state.endedAt = ended;
    }
    if (result.status === "completed") completed += 1;
    task.currentStep = result.summary;
    task.updatedAt = ended;
    task.lastOutputAt = ended;
    task.hasOutput = true;
    task.progress = { completed, total: stepStates.length, label: step.action };
    if (context.workflows.activeRun?.id === runId) {
      await persistWorkflowRunState(context, context.workflows.activeRun, task);
    }
    await appendBackgroundTaskEvent(context, sessionId, task);
    if (result.status !== "completed") {
      await finishWorkflowRun(runId, result.status, result.summary, context, sessionId, task);
      return;
    }
  }
  if (isWorkflowRunTerminal(context, runId, task)) return;
  await finishWorkflowRun(
    runId,
    "completed",
    "Registry workflow completed; result remains PARTIAL until verification/final gate evidence proves PASS.",
    context,
    sessionId,
    task,
  );
}

async function executeRegistryWorkflowStep(
  workflow: RegistryWorkflowDefinition,
  step: RegistryWorkflowDefinition["steps"][number],
  goal: string,
  context: TuiContext,
  output: Writable,
): Promise<{
  status: WorkflowStepTerminalStatus;
  summary: string;
  evidenceRefs: string[];
}> {
  const beforeEvidence = context.evidence.map((item) => item.id);
  try {
    // Mutating registry steps must first pass the workflow-level gate.
    // Readonly steps (details/index/verification) pass straight through.
    // Per-tool decidePermission still gates every Write/Bash/Agent fork.
    const isRegistryMutating =
      step.action === "write" || step.action === "bash" || step.action === "agent";
    if (isRegistryMutating) {
      if (context.permissionMode === "plan") {
        return {
          status: "blocked",
          summary: formatWorkflowStepSummary(
            step.id,
            "blocked",
            "plan mode cannot produce executable mutating workflow proposals",
            context.language,
          ),
          evidenceRefs: [],
        };
      }
      if (context.workflows.activeRun?.phaseGateConfirmed !== true) {
        return {
          status: "blocked",
          summary: formatWorkflowStepSummary(
            step.id,
            "blocked",
            context.language === "en-US"
              ? "workflow start gate not confirmed; mutating registry steps require an explicit /workflows run invocation"
              : "workflow start gate 未确认；mutating registry step 需要明确的 /workflows run 调用",
            context.language,
          ),
          evidenceRefs: [],
        };
      }
    }
    if (step.action === "agent") {
      const role = step.role ?? "worker";
      const task = step.task ?? (goal || workflow.description);
      const previousAgentIds = new Set(context.agents.map((agent) => agent.id));
      await handleForkCommand([role, task], context, output);
      const agent = context.agents.find((item) => !previousAgentIds.has(item.id));
      if (!agent) {
        return {
          status: "blocked",
          summary: formatWorkflowStepSummary(
            step.id,
            "blocked",
            context.language === "en-US"
              ? "agent runtime did not start; step is waiting for runtime/resource availability"
              : "agent runtime 未启动；步骤正在等待 runtime/resource 可用",
            context.language,
          ),
          evidenceRefs: newWorkflowEvidenceRefs(beforeEvidence, context),
        };
      }
      if (agent.status === "failed") {
        return {
          status: "failed",
          summary: formatWorkflowStepSummary(step.id, "failed", agent.summary, context.language),
          evidenceRefs: newWorkflowEvidenceRefs(beforeEvidence, context),
        };
      }
      if (agent.status === "blocked" || agent.status === "stale" || agent.status === "cancelled") {
        return {
          status: agent.status === "cancelled" ? "cancelled" : "blocked",
          summary: formatWorkflowStepSummary(step.id, "blocked", agent.summary, context.language),
          evidenceRefs: newWorkflowEvidenceRefs(beforeEvidence, context),
        };
      }
    } else if (step.action === "verification") {
      const report = await runWorkflowVerificationStep(step.level ?? "focused", context, output);
      const status = workflowStepStatusFromVerification(report.status);
      if (status !== "completed") {
        return {
          status,
          summary: formatWorkflowStepSummary(
            step.id,
            status,
            `verification ${report.status}: ${report.summary}`,
            context.language,
          ),
          evidenceRefs: newWorkflowEvidenceRefs(beforeEvidence, context),
        };
      }
    } else if (step.action === "details") {
      await handleSlashCommand("/details", context, output);
    } else if (step.action === "index") {
      await handleSlashCommand("/index status", context, output);
    } else if (step.action === "bash") {
      if (!step.command)
        return {
          status: "blocked",
          summary: `workflow step ${step.id} blocked: missing command`,
          evidenceRefs: [],
        };
      await handleToolCommand("Bash", [step.command], context, output);
    } else if (step.action === "write") {
      if (!step.path || !step.content) {
        return {
          status: "blocked",
          summary: formatWorkflowStepSummary(
            step.id,
            "blocked",
            context.language === "en-US"
              ? "write registry step requires path and content; add path/content to the step definition"
              : "write registry step 需要 path 和 content；请在 step 定义中添加 path 和 content",
            context.language,
          ),
          evidenceRefs: [],
        };
      }
      await handleToolCommand("Write", [step.path, step.content], context, output);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "failed",
      summary: formatWorkflowStepSummary(step.id, "failed", message, context.language),
      evidenceRefs: newWorkflowEvidenceRefs(beforeEvidence, context),
    };
  }
  return {
    status: "completed",
    summary: formatWorkflowStepSummary(
      step.id,
      "completed",
      context.language === "en-US"
        ? `completed via registry ${step.action}`
        : `已通过 registry ${step.action} 完成`,
      context.language,
    ),
    evidenceRefs: newWorkflowEvidenceRefs(beforeEvidence, context),
  };
}

function formatWorkflowStepSummary(
  stepId: string,
  status: WorkflowStepState["status"],
  detail: string,
  language: TuiContext["language"],
): string {
  if (language === "en-US") {
    return `Workflow step ${stepId} ${status}: ${detail}`;
  }
  const statusText =
    status === "completed"
      ? "已完成"
      : status === "failed"
        ? "失败"
        : status === "cancelled"
          ? "已取消"
          : status === "stale"
            ? "已过期"
            : status === "partial"
              ? "部分完成"
              : "受阻";
  return `工作流步骤 ${stepId} ${statusText}：${detail}`;
}

type WorkflowStepTerminalStatus = Extract<
  WorkflowStepState["status"],
  "completed" | "partial" | "failed" | "blocked" | "cancelled" | "stale"
>;

function workflowStepStatusFromVerification(
  status: VerificationReport["status"],
): WorkflowStepTerminalStatus {
  if (status === "pass") return "completed";
  if (status === "partial") return "partial";
  if (status === "cancelled") return "cancelled";
  if (status === "stale") return "stale";
  return "failed";
}

function workflowStepStatusFromNestedJob(job: DurableJobState): WorkflowStepTerminalStatus {
  const resultStatus = job.result?.status;
  if (job.status === "failed" || job.status === "timeout") return "failed";
  if (job.status === "cancelled") return "cancelled";
  if (job.status === "blocked" || job.status === "sleeping" || job.status === "stale") {
    return "blocked";
  }
  if (resultStatus === "failed" || resultStatus === "timeout" || resultStatus === "overbudget") {
    return "failed";
  }
  if (resultStatus === "cancelled") return "cancelled";
  if (resultStatus === "blocked" || resultStatus === "stale") return "blocked";
  return "completed";
}

async function executeWorkflowStep(
  request: WorkflowBridgeRequestProposal,
  context: TuiContext,
  output: Writable,
  workflowRunId?: string,
  workflowRunningCap?: number,
): Promise<{
  status: WorkflowStepTerminalStatus;
  summary: string;
  evidenceRefs: string[];
}> {
  const phaseGateConfirmed = context.workflows.activeRun?.phaseGateConfirmed === true;
  const capability = decideWorkflowStepCapability({
    permissionMode: context.permissionMode,
    phaseStopPointConfirmed: phaseGateConfirmed,
    target:
      request.safety.mutating || request.request
        ? ({ kind: "details", view: "evidence", mutating: request.safety.mutating } as never)
        : undefined,
    request: request.request,
  });
  if (!capability.ok || !request.executable || !request.request) {
    const summary = formatWorkflowStepSummary(
      request.sliceId,
      "blocked",
      !capability.ok && capability.reason.includes("plan mode")
        ? capability.reason
        : request.reason,
      context.language,
    );
    await captureWorkflowFailureLearning(request, summary, context);
    return { status: "blocked", summary, evidenceRefs: request.taskSurfaceInput.evidenceRefs };
  }
  const beforeEvidence = context.evidence.map((item) => item.id);
  const req = request.request;
  try {
    if (request.sliceId === "slice-architecture-review") {
      return await executeWorkflowArchitectureReviewStep(request, context);
    }
    if (req.mainChain === "fork") {
      const activeWorkflowAgents =
        workflowRunId && workflowRunningCap
          ? context.backgroundTasks.filter(
              (task) =>
                task.kind === "agent" &&
                task.workflowRunId === workflowRunId &&
                isRuntimeActiveBackgroundTask(task),
            ).length
          : 0;
      if (workflowRunningCap && activeWorkflowAgents >= workflowRunningCap) {
        const summary = formatWorkflowStepSummary(
          request.sliceId,
          "blocked",
          `workflow runningCap ${workflowRunningCap} reached; wait for existing workflow agents before starting another /fork`,
          context.language,
        );
        await captureWorkflowFailureLearning(request, summary, context);
        return {
          status: "blocked",
          summary,
          evidenceRefs: newWorkflowEvidenceRefs(beforeEvidence, context),
        };
      }
      const previousAgentIds = new Set(context.agents.map((agent) => agent.id));
      await handleForkCommand([req.role, req.task], context, output, { workflowRunId });
      const agent = context.agents.find((item) => !previousAgentIds.has(item.id));
      const agentTask = agent
        ? context.backgroundTasks.find((task) => task.id === agent.id)
        : undefined;
      if (agentTask && workflowRunId) {
        agentTask.workflowRunId = workflowRunId;
        await appendBackgroundTaskEvent(context, await ensureSession(context), agentTask);
      }
      if (!agent) {
        const summary = formatWorkflowStepSummary(
          request.sliceId,
          "blocked",
          context.language === "en-US"
            ? "agent runtime did not start; step is waiting for runtime/resource availability"
            : "agent runtime 未启动；步骤正在等待 runtime/resource 可用",
          context.language,
        );
        await captureWorkflowFailureLearning(request, summary, context);
        return {
          status: "blocked",
          summary,
          evidenceRefs: newWorkflowEvidenceRefs(beforeEvidence, context),
        };
      }
      if (!agentTask) {
        const summary = formatWorkflowStepSummary(
          request.sliceId,
          "blocked",
          context.language === "en-US"
            ? `agent runtime ${agent.id} has no background task; treating step as waiting/resource blocked`
            : `agent runtime ${agent.id} 没有后台任务；步骤按 waiting/resource blocked 处理`,
          context.language,
        );
        await captureWorkflowFailureLearning(request, summary, context);
        return {
          status: "blocked",
          summary,
          evidenceRefs: newWorkflowEvidenceRefs(beforeEvidence, context),
        };
      }
      if (agent?.status === "failed") {
        const summary = formatWorkflowStepSummary(
          request.sliceId,
          "failed",
          agent.summary,
          context.language,
        );
        await captureWorkflowFailureLearning(request, summary, context);
        return {
          status: "failed",
          summary,
          evidenceRefs: newWorkflowEvidenceRefs(beforeEvidence, context),
        };
      }
      if (agent?.status === "blocked" || agent?.summary.includes("权限管道拒绝")) {
        const summary = formatWorkflowStepSummary(
          request.sliceId,
          "blocked",
          agent.summary,
          context.language,
        );
        await captureWorkflowFailureLearning(request, summary, context);
        return {
          status: "blocked",
          summary,
          evidenceRefs: newWorkflowEvidenceRefs(beforeEvidence, context),
        };
      }
    } else if (req.mainChain === "verification") {
      const report = await runWorkflowVerificationStep(req.level, context, output);
      const status = workflowStepStatusFromVerification(report.status);
      if (status !== "completed") {
        const summary = formatWorkflowStepSummary(
          request.sliceId,
          status,
          `verification ${report.status}: ${report.summary}`,
          context.language,
        );
        await captureWorkflowFailureLearning(request, summary, context);
        return {
          status,
          summary,
          evidenceRefs: newWorkflowEvidenceRefs(beforeEvidence, context),
        };
      }
    } else if (req.mainChain === "details") {
      await handleSlashCommand(formatWorkflowDetailsSlashCommand(req), context, output);
    } else if (req.mainChain === "agents") {
      await handleAgentsCommand([req.action, req.agentRef ?? ""].filter(Boolean), context, output);
    } else if (req.mainChain === "workflows") {
      if (req.action === "list") {
        await handleWorkflowsCommand(["registry"], context, output);
      } else {
        const summary = formatWorkflowStepSummary(
          request.sliceId,
          "blocked",
          context.language === "en-US"
            ? "workflows start_gate is proposal-only; no runtime execution path available"
            : "workflows start_gate 目前仅作为 proposal，无运行时执行路径",
          context.language,
        );
        await captureWorkflowFailureLearning(request, summary, context);
        return { status: "blocked", summary, evidenceRefs: request.taskSurfaceInput.evidenceRefs };
      }
    } else if (req.mainChain === "job") {
      const beforeJobIds = new Set((await listDurableJobs(context)).map((job) => job.id));
      if (req.action === "run" || req.action === "create") {
        await runNestedWorkflowJobCommand(
          [
            req.action,
            req.goal ?? request.taskSurfaceInput.nextAction,
            "--phase",
            req.phase,
            "--target",
            req.target,
            ...(req.maxTokens ? ["--tokens", String(req.maxTokens)] : []),
            ...(req.maxDurationMs ? ["--timeout", String(req.maxDurationMs)] : []),
            ...(req.runningCap ? ["--running-cap", String(req.runningCap)] : []),
            ...(req.requestedAgents && req.requestedAgents > 1
              ? ["--multi-agent", "--agents", String(req.requestedAgents)]
              : []),
          ],
          context,
          output,
        );
      } else {
        await runNestedWorkflowJobCommand(
          [req.action, req.jobRef ?? ""].filter(Boolean),
          context,
          output,
        );
      }
      const readonlyJobActions = new Set(["list", "logs"]);
      if (readonlyJobActions.has(req.action)) {
        return {
          status: "completed",
          summary: formatWorkflowStepSummary(
            request.sliceId,
            "completed",
            `job ${req.action} completed; see output above`,
            context.language,
          ),
          evidenceRefs: newWorkflowEvidenceRefs(beforeEvidence, context),
        };
      }
      const jobs = await listDurableJobs(context);
      const job =
        jobs.find((item) => !beforeJobIds.has(item.id)) ??
        (req.jobRef
          ? jobs.find((item) => item.id === req.jobRef || item.id.endsWith(req.jobRef ?? ""))
          : undefined) ??
        jobs[0];
      if (!job) {
        const summary = formatWorkflowStepSummary(
          request.sliceId,
          "blocked",
          context.language === "en-US"
            ? "nested job did not persist state"
            : "嵌套 job 未持久化 state",
          context.language,
        );
        await captureWorkflowFailureLearning(request, summary, context);
        return { status: "blocked", summary, evidenceRefs: request.taskSurfaceInput.evidenceRefs };
      }
      const nestedStatus = workflowStepStatusFromNestedJob(job);
      if (nestedStatus !== "completed") {
        const summary = formatWorkflowStepSummary(
          request.sliceId,
          nestedStatus,
          `nested job ${job.id} ${job.status}${job.result?.status ? ` result ${job.result.status}` : ""}: ${job.pauseReason ?? job.result?.summary ?? "not runnable"}`,
          context.language,
        );
        await captureWorkflowFailureLearning(request, summary, context);
        return {
          status: nestedStatus,
          summary,
          evidenceRefs: mergeWorkflowEvidenceRefs(
            newWorkflowEvidenceRefs(beforeEvidence, context),
            job.evidenceRefs.map((item) => item.id),
          ),
        };
      }
      return {
        status: "completed",
        summary: formatWorkflowStepSummary(
          request.sliceId,
          "completed",
          `nested job lifecycle ${job.id} ${job.status}; workflow result remains PARTIAL; persisted state ${getDurableJobStatePath(job)}`,
          context.language,
        ),
        evidenceRefs: mergeWorkflowEvidenceRefs(
          newWorkflowEvidenceRefs(beforeEvidence, context),
          job.evidenceRefs.map((item) => item.id),
        ),
      };
    } else {
      const summary = formatWorkflowStepSummary(
        request.sliceId,
        "blocked",
        context.language === "en-US" ? "unsupported nested job request" : "不支持嵌套 job 请求",
        context.language,
      );
      await captureWorkflowFailureLearning(request, summary, context);
      return { status: "blocked", summary, evidenceRefs: request.taskSurfaceInput.evidenceRefs };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const summary = formatWorkflowStepSummary(request.sliceId, "failed", message, context.language);
    await captureWorkflowFailureLearning(request, summary, context);
    return {
      status: "failed",
      summary,
      evidenceRefs: newWorkflowEvidenceRefs(beforeEvidence, context),
    };
  }
  return {
    status: "completed",
    summary: formatWorkflowStepSummary(
      request.sliceId,
      "completed",
      context.language === "en-US"
        ? `completed via ${req.mainChain}`
        : `已通过 ${req.mainChain} 完成`,
      context.language,
    ),
    evidenceRefs: newWorkflowEvidenceRefs(beforeEvidence, context),
  };
}

function formatWorkflowDetailsSlashCommand(
  req: Extract<WorkflowMainChainRequest, { mainChain: "details" }>,
): string {
  const ref = req.refs.find((item) => item.trim().length > 0);
  if ((req.view === "evidence" || req.view === "background") && ref) {
    return `/details ${req.view} ${ref}`;
  }
  return "/details";
}

async function executeWorkflowArchitectureReviewStep(
  request: WorkflowBridgeRequestProposal,
  context: TuiContext,
): Promise<{
  status: WorkflowStepTerminalStatus;
  summary: string;
  evidenceRefs: string[];
}> {
  const sessionId = await ensureSession(context);
  const candidates = await selectWorkflowArchitectureReviewFiles(context);
  if (candidates.length === 0) {
    const evidence = createEvidenceRecord(
      "command_output",
      "workflow architecture review skipped: no project source files available for boundary check",
      "workflow-architecture-review:no-files",
      ["architecture_boundary_check", "workflow_slice_architecture_review", "partial_evidence"],
    );
    rememberEvidence(context, evidence);
    await context.store.appendEvent(sessionId, { type: "evidence_record", ...evidence });
    await appendSystemEvent(
      context,
      sessionId,
      `workflow architecture review: slice ${request.sliceId}; status partial; evidence ${evidence.id}; files 0; reason no files`,
      "warning",
    );
    return {
      status: "partial",
      summary: formatWorkflowStepSummary(
        request.sliceId,
        "partial",
        "architecture boundary check skipped: no project source files found; continue readonly workflow with partial evidence",
        context.language,
      ),
      evidenceRefs: [evidence.id],
    };
  }

  const metrics = [];
  const scannedFiles: string[] = [];
  for (const relativePath of candidates) {
    try {
      const source = await readFile(resolve(context.projectPath, relativePath), "utf8");
      metrics.push(estimateFileMetrics(relativePath, source));
      scannedFiles.push(relativePath);
    } catch {
      // Missing optional workflow files should not hide the result for files that were scanned.
    }
  }

  if (metrics.length === 0) {
    const evidence = createEvidenceRecord(
      "command_output",
      `workflow architecture review skipped: candidate files unreadable (${candidates.join(", ")})`,
      "workflow-architecture-review:unreadable",
      ["architecture_boundary_check", "workflow_slice_architecture_review", "partial_evidence"],
    );
    rememberEvidence(context, evidence);
    await context.store.appendEvent(sessionId, { type: "evidence_record", ...evidence });
    await appendSystemEvent(
      context,
      sessionId,
      `workflow architecture review: slice ${request.sliceId}; status partial; evidence ${evidence.id}; files 0; reason unreadable`,
      "warning",
    );
    return {
      status: "partial",
      summary: formatWorkflowStepSummary(
        request.sliceId,
        "partial",
        "architecture boundary check skipped: no readable project source files; continue readonly workflow with partial evidence",
        context.language,
      ),
      evidenceRefs: [evidence.id],
    };
  }

  const check = checkBoundaries(metrics);
  const status: WorkflowStepTerminalStatus = check.violations.length > 0 ? "partial" : "completed";
  const riskKinds = Array.from(new Set(check.violations.map((item) => item.kind)));
  const evidence = createEvidenceRecord(
    "command_output",
    `workflow architecture boundary check ${check.summary}; files ${scannedFiles.length}; risks ${riskKinds.join(",") || "none"}`,
    `workflow-architecture-review:${request.workflowId}:${request.phaseId}:${request.sliceId}`,
    [
      "architecture_boundary_check",
      "workflow_slice_architecture_review",
      status === "completed" ? "architecture_boundary_clean" : "needs_review",
      ...riskKinds.map((kind) => `architecture_risk:${kind}`),
    ],
  );
  rememberEvidence(context, evidence);
  await context.store.appendEvent(sessionId, { type: "evidence_record", ...evidence });
  await appendSystemEvent(
    context,
    sessionId,
    `workflow architecture review: slice ${request.sliceId}; status ${status}; evidence ${evidence.id}; files ${scannedFiles.join(",")}; summary ${check.summary}`,
    status === "completed" ? "info" : "warning",
  );

  return {
    status,
    summary: formatWorkflowStepSummary(
      request.sliceId,
      status,
      status === "partial"
        ? `architecture boundary risks found (${check.summary}); continue readonly workflow with evidence ${evidence.id}`
        : `architecture boundary check ${check.summary}; evidence ${evidence.id}`,
      context.language,
    ),
    evidenceRefs: [evidence.id],
  };
}

async function selectWorkflowArchitectureReviewFiles(context: TuiContext): Promise<string[]> {
  const files = new Set<string>();
  for (const file of [...context.tools.changedFiles, ...context.recentlyMentionedFiles]) {
    const normalized = file.replace(/\\/g, "/");
    if (!/\.(?:ts|tsx|js|jsx)$/u.test(normalized)) continue;
    files.add(normalized);
  }
  if (files.size < WORKFLOW_ARCHITECTURE_REVIEW_FILE_LIMIT) {
    for (const discovered of await discoverWorkflowArchitectureReviewFiles(context.projectPath)) {
      files.add(discovered);
      if (files.size >= WORKFLOW_ARCHITECTURE_REVIEW_FILE_LIMIT) break;
    }
  }
  for (const file of [
    "packages/tui/src/index.ts",
    "packages/tui/src/workflow-planner-entry.ts",
    "packages/tui/src/workflow-task-surface.ts",
    "packages/tui/src/workflow-agent-runtime-bridge.ts",
  ]) {
    if (files.size >= WORKFLOW_ARCHITECTURE_REVIEW_FILE_LIMIT) break;
    if (canReadProjectFile(context.projectPath, file)) files.add(file);
  }
  return Array.from(files).slice(0, WORKFLOW_ARCHITECTURE_REVIEW_FILE_LIMIT);
}

async function discoverWorkflowArchitectureReviewFiles(projectPath: string): Promise<string[]> {
  const roots = ["src", "packages", "apps", "."];
  const discovered: string[] = [];
  for (const root of roots) {
    await discoverWorkflowArchitectureReviewFilesUnder(
      projectPath,
      root,
      root === "." ? 1 : 4,
      discovered,
    );
    if (discovered.length >= WORKFLOW_ARCHITECTURE_REVIEW_FILE_LIMIT) break;
  }
  return discovered.slice(0, WORKFLOW_ARCHITECTURE_REVIEW_FILE_LIMIT);
}

async function discoverWorkflowArchitectureReviewFilesUnder(
  projectPath: string,
  relativeRoot: string,
  depth: number,
  discovered: string[],
): Promise<void> {
  if (depth < 0 || discovered.length >= WORKFLOW_ARCHITECTURE_REVIEW_FILE_LIMIT) return;
  const entries = await readdir(resolve(projectPath, relativeRoot), { withFileTypes: true }).catch(
    () => undefined,
  );
  if (!entries) return;
  for (const entry of entries) {
    if (discovered.length >= WORKFLOW_ARCHITECTURE_REVIEW_FILE_LIMIT) return;
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
    const relativePath = relativeRoot === "." ? entry.name : `${relativeRoot}/${entry.name}`;
    if (entry.isFile() && /\.(?:ts|tsx|js|jsx)$/u.test(entry.name)) {
      discovered.push(relativePath);
      continue;
    }
    if (entry.isDirectory()) {
      await discoverWorkflowArchitectureReviewFilesUnder(
        projectPath,
        relativePath,
        depth - 1,
        discovered,
      );
    }
  }
}

function canReadProjectFile(projectPath: string, path: string): boolean {
  try {
    accessSync(resolve(projectPath, path), constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function getCurrentWorkflowStepRequest(
  plan: NormalizedWorkflowPlan,
  phaseId: string,
  steps: WorkflowStepState[],
  stepId: string,
  options: RunWorkflowExecutionOptions = {},
): WorkflowBridgeRequestProposal {
  const satisfied = new Map(
    steps
      .filter((step) => step.status === "completed" || step.status === "partial")
      .map((step) => [step.id, step.status] as const),
  );
  const runningPlan: NormalizedWorkflowPlan = {
    ...plan,
    currentPhaseId: phaseId,
    phases: plan.phases.map((phase) => ({
      ...phase,
      status: phase.id === phaseId ? "running" : (phase.status ?? "pending"),
      slices: phase.slices.map((slice) => ({
        ...slice,
        allowedToolClasses: slice.allowedToolClasses ?? [],
        evidence: slice.evidence ?? [],
        references: slice.references ?? [],
        status:
          slice.id === stepId
            ? "queued"
            : satisfied.get(slice.id) === "partial"
              ? "partial"
              : satisfied.has(slice.id)
                ? "completed"
                : slice.status === "blocked"
                  ? "queued"
                  : (slice.status ?? "queued"),
        dependsOnSliceIds: slice.dependsOnSliceIds ?? [],
        independent: slice.independent === true,
        canRunInParallel: slice.canRunInParallel === true,
      })),
    })),
  };
  const bridge = bridgeWorkflowPlanToMainChainRequests(runningPlan, {
    currentPhaseId: phaseId,
    confirmedPhaseStopPoints: options.phaseGateConfirmed === true ? [phaseId] : [],
    runningCap: normalizeWorkflowRunningCap(options.runningCap ?? plan.budget.maxRunningAgents),
  });
  return (
    bridge.requests.find((request) => request.sliceId === stepId) ?? {
      id: `${plan.id}:${phaseId}:${stepId}`,
      proposalOnly: true,
      workflowId: plan.id,
      phaseId,
      sliceId: stepId,
      status: "blocked",
      reason: "workflow step missing from bridge request set",
      executable: false,
      request: null,
      safety: {
        readonly: true,
        mutating: false,
        requiresStartGate: false,
        requiresPermissionPipeline: false,
        requiredPermissionAction: "none",
        evidencePolicy: "neverTreatCompletionAsPass",
      },
      handoffProposal: {
        boundedRefs: [],
        workspaceCacheRefs: [],
        evidenceRefs: [],
        keyFilesSummary: [],
        droppedRefKinds: [],
        notIncluded: [],
      },
      backgroundProjection: {
        source: "background-task-projection",
        kind: "job",
        userVisibleSummary: "workflow step missing from bridge request set",
        nextAction: "Inspect workflow plan.",
      },
      taskSurfaceInput: {
        phaseId,
        sliceId: stepId,
        requestStatus: "blocked",
        evidenceRefs: [],
        nextAction: "Inspect workflow plan.",
      },
    }
  );
}

function selectRunnableWorkflowBatch(
  plan: NormalizedWorkflowPlan,
  phaseId: string,
  steps: WorkflowStepState[],
  options: RunWorkflowExecutionOptions,
): WorkflowBatchItem[] {
  const cap = normalizeWorkflowRunningCap(options.runningCap ?? plan.budget.maxRunningAgents);
  const batch: WorkflowBatchItem[] = [];
  const candidates = steps.filter((step) => {
    if (step.status !== "queued") return false;
    const deps = step.dependsOnSliceIds ?? [];
    return deps.every((depId) => {
      const dep = steps.find((item) => item.id === depId);
      return dep?.status === "completed" || dep?.status === "partial";
    });
  });
  for (const step of candidates) {
    if (batch.length >= cap) {
      break;
    }
    const request = getCurrentWorkflowStepRequest(plan, phaseId, steps, step.id, options);
    if (!request.executable || !request.request) {
      return [{ step, request }];
    }
    const mutating = request.safety.mutating;
    if (mutating && batch.filter((item) => item.request.safety.mutating).length >= cap) {
      continue;
    }
    if (batch.length > 0 && (mutating || !step.independent || step.canRunInParallel !== true)) {
      break;
    }
    batch.push({ step, request });
    if (mutating || !step.independent || step.canRunInParallel !== true) {
      break;
    }
  }
  return batch;
}

function normalizeWorkflowRunningCap(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined || value < 1) {
    return DEFAULT_JOB_RUNNING_AGENT_CAP;
  }
  return Math.max(1, Math.floor(value));
}

export async function runWorkflowVerificationStep(
  level: "smoke" | "focused" | "typecheck" | "test" | "build" | "lint",
  context: TuiContext,
  output: Writable,
): Promise<VerificationReport> {
  const sessionId = await ensureSession(context);
  const plan =
    level === "smoke" || level === "focused"
      ? await createVerificationPlan(context.projectPath, "smoke")
      : (await createVerificationPlan(context.projectPath, "default")).filter(
          (step) => step.kind === level,
        );
  const effectivePlan =
    plan.length > 0 ? plan : await createVerificationPlan(context.projectPath, "smoke");
  const report = await runVerificationPlan(
    effectivePlan,
    context,
    sessionId,
    output,
    appendBackgroundTaskEvent,
  );
  context.lastVerification = report;
  await recordVerificationEvidence(context, sessionId, report);
  return report;
}

async function runNestedWorkflowJobCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const workflowTaskIndex = context.backgroundTasks.findIndex(
    (task) => task.kind === "job" && task.id.startsWith("workflow-") && task.status === "running",
  );
  if (workflowTaskIndex < 0) {
    await handleJobCommand(args, context, output);
    return;
  }
  const [workflowTask] = context.backgroundTasks.splice(workflowTaskIndex, 1);
  try {
    await handleJobCommand(args, context, output);
  } finally {
    if (workflowTask && !context.backgroundTasks.some((task) => task.id === workflowTask.id)) {
      rememberBackgroundTask(context, workflowTask);
    }
  }
}

export async function finishWorkflowRun(
  runId: string,
  status: WorkflowStepTerminalStatus,
  summary: string,
  context: TuiContext,
  sessionId: string,
  task: BackgroundTaskState,
): Promise<void> {
  const now = new Date().toISOString();
  if (context.workflows.activeRun?.id === runId) {
    context.workflows.activeRun.status = status;
    context.workflows.activeRun.endedAt = now;
    context.workflows.activeRun.result = status === "completed" ? "partial" : status;
    for (const step of context.workflows.activeRun.steps) {
      if (step.status !== "running") continue;
      step.status = status;
      step.endedAt = now;
      step.summary = summary;
    }
  }
  task.status =
    status === "completed"
      ? "completed"
      : status === "partial"
        ? "completed"
        : status === "stale"
          ? "stale"
          : status === "cancelled"
            ? "cancelled"
            : "failed";
  task.result =
    status === "completed" || status === "partial" || status === "blocked"
      ? "partial"
      : status === "cancelled"
        ? "cancelled"
        : status === "stale"
          ? "stale"
          : "fail";
  task.currentStep = summary;
  task.updatedAt = now;
  task.lastOutputAt = now;
  task.userVisibleSummary = task.userVisibleSummary || summary;
  task.nextAction =
    status === "completed" || status === "partial"
      ? "Review verification evidence; do not treat workflow completion as PASS."
      : "Inspect /failures and rerun after fixing the failed step.";
  if (context.workflows.activeRun?.id === runId) {
    await persistWorkflowRunState(context, context.workflows.activeRun, task);
  }
  await appendBackgroundTaskEvent(context, sessionId, task);
  await context.store.appendEvent(sessionId, {
    type: "workflow_end",
    workflowId: runId,
    status,
    summary,
    createdAt: now,
  });
  if (status !== "completed" && status !== "cancelled") {
    await captureFailureLearning(context, sessionId, {
      category: "tool_failure",
      failureSummary: summary,
      rootCauseGuess: "workflow step failed or blocked before all planned steps completed",
      avoidNextTime:
        "Inspect the failed workflow step and existing runtime evidence before rerunning; do not claim workflow PASS",
      sourceRef: `workflow:${runId}`,
      relatedTarget: "workflow",
      severity: "medium",
    });
  }
}

async function captureWorkflowFailureLearning(
  request: WorkflowBridgeRequestProposal,
  summary: string,
  context: TuiContext,
): Promise<void> {
  await captureFailureLearning(context, await ensureSession(context), {
    category: "tool_failure",
    failureSummary: summary,
    rootCauseGuess: `workflow step ${request.sliceId} did not complete through the main chain`,
    avoidNextTime:
      "Fix the blocked workflow step and rerun; do not rely on projected task surface state",
    sourceRef: `workflow-step:${request.workflowId}:${request.sliceId}`,
    relatedTarget: "workflow",
    severity: "medium",
  });
}

function workflowRuntimeKind(request: WorkflowBridgeRequestProposal): WorkflowStepState["runtime"] {
  if (request.request?.mainChain === "job") return "job";
  if (request.request?.mainChain === "verification") return "verification";
  if (request.request?.mainChain === "details") return "details";
  if (request.request?.mainChain === "workflows") return "details";
  if (request.request?.mainChain === "agents") return "agent";
  if (request.request?.mainChain === "fork") return "agent";
  return "agent";
}

function findWorkflowSliceTitle(plan: NormalizedWorkflowPlan, sliceId: string): string {
  return (
    plan.phases.flatMap((phase) => phase.slices).find((slice) => slice.id === sliceId)?.title ??
    sliceId
  );
}

function newWorkflowEvidenceRefs(before: string[], context: TuiContext): string[] {
  const seen = new Set(before);
  return context.evidence.map((item) => item.id).filter((id) => !seen.has(id));
}

function mergeWorkflowEvidenceRefs(...groups: string[][]): string[] {
  return Array.from(new Set(groups.flat().filter(Boolean)));
}

async function recordWorkflowPlanPreviewEvidence(
  context: TuiContext,
  sessionId: string,
  result: Extract<WorkflowPlannerEntryResult, { ok: true }>,
): Promise<void> {
  const evidence = createEvidenceRecord(
    "user_provided",
    `workflow plan preview: ${result.plan.title}; evidence merge ${result.surface.evidenceMergeSummary}; requests runnable ${result.bridgeResult.summary.runnable}; start gate ${result.bridgeResult.summary.startGateNeeded}; blocked ${result.bridgeResult.summary.blocked}`,
    `workflow-plan-preview:${result.plan.id}`,
    [
      "workflow_plan_preview",
      "workflow_preview_only",
      `workflow_evidence_merge:${result.surface.evidenceMergeSummary}`,
    ],
  );
  rememberEvidence(context, evidence);
  await context.store.appendEvent(sessionId, { type: "evidence_record", ...evidence });
  await appendSystemEvent(
    context,
    sessionId,
    `workflow plan preview: evidence ${evidence.id}; plan ${result.plan.id}; preview only yes; pass evidence no`,
    "info",
  );
}

function summarizeWorkflowCacheFreshness(freshness: CacheFreshness): string {
  const changed =
    freshness.changedKeys.length > 0
      ? `changed ${freshness.changedKeys.slice(0, 5).join(", ")}`
      : "changed none";
  return `cache freshness ${changed}`;
}
