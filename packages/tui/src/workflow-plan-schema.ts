import type { PermissionMode } from "@linghun/shared";
import type { AgentType, DurableJobAgentStatus } from "./tui-data-types.js";

export const DEFAULT_WORKFLOW_RUNNING_CAP = 3;

export type WorkflowPlanSource = "natural" | "slash" | "workflow-template" | "handoff" | "manual";

export type WorkflowSliceStatus =
  | "created"
  | "queued"
  | "sleeping"
  | "blocked"
  | "running"
  | "completed"
  | "failed";

export type WorkflowToolClass =
  | "readonly"
  | "codebase-memory-readonly"
  | "workspace-reference"
  | "verification"
  | "details"
  | "job-control"
  | "agent-control"
  | "workflow-template"
  | "mcp-local-stdio";

export type WorkflowEvidenceKind =
  | "file_read"
  | "grep_result"
  | "index_query"
  | "command_output"
  | "test_result"
  | "verification"
  | "provider"
  | "architecture"
  | "agent_summary"
  | "job_completed"
  | "remote_event"
  | "failure_learning";

export type WorkflowRuntimeTarget =
  | {
      kind: "slash";
      slash: "/job";
      action:
        | "list"
        | "create"
        | "run"
        | "status"
        | "report"
        | "logs"
        | "pause"
        | "resume"
        | "cancel";
      mutating: boolean;
    }
  | {
      kind: "slash";
      slash: "/fork";
      role: AgentType;
      mutating: boolean;
    }
  | {
      kind: "slash";
      slash: "/agents";
      action: "list" | "show" | "cancel";
      mutating: boolean;
    }
  | {
      kind: "slash";
      slash: "/workflows";
      action: "list" | "start_gate";
      mutating: boolean;
    }
  | {
      kind: "verification";
      level: "smoke" | "focused" | "typecheck" | "test" | "build" | "lint";
      mutating: false;
    }
  | {
      kind: "details";
      view: "evidence" | "background" | "job" | "agent";
      mutating: false;
    };

export type WorkflowReference = {
  kind: "evidence" | "workspace_cache" | "file" | "log" | "transcript" | "index" | "architecture";
  ref: string;
  summary?: string;
};

export type WorkflowToolProposal = {
  toolClass: WorkflowToolClass;
  toolName?: string;
  execution: "none" | "discover_only" | "execute";
  discovered?: boolean;
  trusted?: boolean;
  executable?: boolean;
};

export type WorkflowEvidenceRequirement = {
  ref: string;
  kind: WorkflowEvidenceKind;
  claim: string;
  requiredForPass?: boolean;
  passEvidence?: boolean;
};

export type WorkflowBudget = {
  maxTokens?: number;
  maxDurationMs?: number;
  maxCostCny?: number;
  maxRunningAgents?: number;
};

export type WorkflowStopPoint = {
  required: boolean;
  reason: string;
  confirmationRequired: boolean;
};

export type WorkflowSlice = {
  id: string;
  title: string;
  role: AgentType;
  status?: WorkflowSliceStatus;
  dependsOnSliceIds?: string[];
  allowedToolClasses?: WorkflowToolClass[];
  toolProposals?: WorkflowToolProposal[];
  targetRuntime?: WorkflowRuntimeTarget;
  budget?: WorkflowBudget;
  evidence?: WorkflowEvidenceRequirement[];
  acceptanceCriteria?: string[];
  references?: WorkflowReference[];
  nextAction?: string;
};

export type WorkflowPhase = {
  id: string;
  title: string;
  status?: "pending" | "running" | "blocked" | "completed";
  dependsOnPhaseIds?: string[];
  slices: WorkflowSlice[];
  stopPoint: WorkflowStopPoint;
  autoAdvance?: boolean;
  budget?: WorkflowBudget;
  acceptanceCriteria?: string[];
};

export type WorkflowPlan = {
  id: string;
  title: string;
  source: WorkflowPlanSource;
  createdAt: string;
  permissionMode?: PermissionMode;
  currentPhaseId?: string;
  phases: WorkflowPhase[];
  budget?: WorkflowBudget;
  references?: WorkflowReference[];
  evidence?: WorkflowEvidenceRequirement[];
  stopConditions?: string[];
};

export type NormalizedWorkflowPlan = WorkflowPlan & {
  permissionMode: PermissionMode;
  budget: Required<Pick<WorkflowBudget, "maxRunningAgents">> & WorkflowBudget;
  phases: Array<
    Omit<WorkflowPhase, "slices"> & {
      status: NonNullable<WorkflowPhase["status"]>;
      slices: Array<
        WorkflowSlice & {
          status: WorkflowSliceStatus;
          allowedToolClasses: WorkflowToolClass[];
          evidence: WorkflowEvidenceRequirement[];
          references: WorkflowReference[];
        }
      >;
    }
  >;
  stopConditions: string[];
};

export type WorkflowPlanValidationError = {
  path: string;
  message: string;
};

export type WorkflowPlanValidationResult =
  | { ok: true; plan: NormalizedWorkflowPlan }
  | { ok: false; errors: WorkflowPlanValidationError[] };

export type WorkflowPlanProjection = {
  surface: "task-summary";
  summary: {
    currentPhase: string;
    agents: { done: number; running: number; blocked: number };
    evidenceCount: number;
    tokenCostSummary: string;
    nextAction: string;
  };
  summaryText: string;
  detailsText: string;
  mobileSummary: string;
};

const ALLOWED_TOOL_CLASSES = new Set<WorkflowToolClass>([
  "readonly",
  "codebase-memory-readonly",
  "workspace-reference",
  "verification",
  "details",
  "job-control",
  "agent-control",
  "workflow-template",
  "mcp-local-stdio",
]);

const PASS_BANNED_EVIDENCE_KINDS = new Set<WorkflowEvidenceKind>([
  "agent_summary",
  "job_completed",
  "remote_event",
  "failure_learning",
]);

const ALLOWED_SLASH_TARGETS = new Set(["/job", "/fork", "/agents", "/workflows"]);

const MUTATING_SLASH_ACTIONS = new Set(["create", "run", "pause", "resume", "cancel"]);

export function normalizeWorkflowPlan(
  input: WorkflowPlan,
  options: { permissionMode?: PermissionMode; runningCap?: number } = {},
): WorkflowPlanValidationResult {
  const errors: WorkflowPlanValidationError[] = [];
  scanForbiddenRawFields(input, "$", errors);
  const phases = Array.isArray(input.phases) ? input.phases : [];

  if (!input.id?.trim()) {
    errors.push({ path: "$.id", message: "workflow id is required" });
  }
  if (!input.title?.trim()) {
    errors.push({ path: "$.title", message: "workflow title is required" });
  }
  if (!Date.parse(input.createdAt)) {
    errors.push({ path: "$.createdAt", message: "createdAt must be an ISO-like timestamp" });
  }
  if (!Array.isArray(input.phases) || input.phases.length === 0) {
    errors.push({ path: "$.phases", message: "at least one workflow phase is required" });
  }
  validateBudget(input.budget, "$.budget", errors);

  const permissionMode = options.permissionMode ?? input.permissionMode ?? "default";
  const runningCap = normalizeRunningCap(options.runningCap ?? input.budget?.maxRunningAgents);
  const phaseIds = new Set(phases.map((phase) => phase.id).filter(Boolean));
  const sliceIds = new Set(
    phases.flatMap((phase) =>
      Array.isArray(phase.slices) ? phase.slices.map((slice) => slice.id).filter(Boolean) : [],
    ),
  );
  const normalizedPhases: NormalizedWorkflowPlan["phases"] = [];
  let runningSlices = 0;

  validateDuplicateIds(
    phases.map((phase) => phase.id),
    "$.phases",
    "duplicate phase id",
    errors,
  );
  validateDuplicateIds(
    phases.flatMap((phase) =>
      Array.isArray(phase.slices) ? phase.slices.map((slice) => slice.id) : [],
    ),
    "$.phases[].slices",
    "duplicate slice id",
    errors,
  );

  phases.forEach((phase, phaseIndex) => {
    const phasePath = `$.phases[${phaseIndex}]`;
    const slices = Array.isArray(phase.slices) ? phase.slices : [];
    if (!phase.id?.trim()) {
      errors.push({ path: `${phasePath}.id`, message: "phase id is required" });
    }
    if (!phase.title?.trim()) {
      errors.push({ path: `${phasePath}.title`, message: "phase title is required" });
    }
    if (!phase.stopPoint?.required || !phase.stopPoint.confirmationRequired) {
      errors.push({
        path: `${phasePath}.stopPoint`,
        message: "each phase must have a required stop point with confirmationRequired=true",
      });
    }
    if (phase.autoAdvance === true) {
      errors.push({
        path: `${phasePath}.autoAdvance`,
        message: "phase auto-advance is forbidden; stop at the phase boundary",
      });
    }
    for (const dep of phase.dependsOnPhaseIds ?? []) {
      if (!phaseIds.has(dep) || dep === phase.id) {
        errors.push({
          path: `${phasePath}.dependsOnPhaseIds`,
          message: `unknown or self phase dependency: ${dep}`,
        });
      }
    }
    if (!Array.isArray(phase.slices) || phase.slices.length === 0) {
      errors.push({ path: `${phasePath}.slices`, message: "phase requires at least one slice" });
    }
    validateBudget(phase.budget, `${phasePath}.budget`, errors);

    const normalizedSlices = slices.map((slice, sliceIndex) => {
      const slicePath = `${phasePath}.slices[${sliceIndex}]`;
      validateSlice(slice, slicePath, sliceIds, permissionMode, errors);
      let status = slice.status ?? "queued";
      if (status === "running") {
        if (runningSlices >= runningCap) {
          status = "queued";
        } else {
          runningSlices += 1;
        }
      }
      return {
        ...slice,
        status,
        allowedToolClasses: slice.allowedToolClasses ?? [],
        evidence: slice.evidence ?? [],
        references: slice.references ?? [],
      };
    });

    normalizedPhases.push({
      ...phase,
      status: phase.status ?? "pending",
      slices: normalizedSlices,
    });
  });

  validateEvidence(input.evidence ?? [], "$.evidence", errors);
  validateReferences(input.references ?? [], "$.references", errors);

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    plan: {
      ...input,
      permissionMode,
      budget: {
        ...input.budget,
        maxRunningAgents: runningCap,
      },
      phases: normalizedPhases,
      stopConditions:
        input.stopConditions && input.stopConditions.length > 0
          ? input.stopConditions
          : ["stop after each phase and wait for explicit user confirmation"],
    },
  };
}

export function projectWorkflowPlan(plan: NormalizedWorkflowPlan): WorkflowPlanProjection {
  const currentPhase =
    plan.phases.find((phase) => phase.id === plan.currentPhaseId) ??
    plan.phases.find((phase) => phase.status === "running" || phase.status === "blocked") ??
    plan.phases[0];
  const slices = plan.phases.flatMap((phase) => phase.slices);
  const done = slices.filter((slice) => slice.status === "completed").length;
  const running = slices.filter((slice) => slice.status === "running").length;
  const blocked = slices.filter(
    (slice) => slice.status === "blocked" || slice.status === "failed",
  ).length;
  const evidenceCount =
    (plan.evidence ?? []).length +
    slices.reduce((count, slice) => count + (slice.evidence ?? []).length, 0);
  const maxTokens =
    plan.budget.maxTokens ??
    plan.phases.reduce(
      (sum, phase) =>
        sum +
        (phase.budget?.maxTokens ?? 0) +
        phase.slices.reduce((sliceSum, slice) => sliceSum + (slice.budget?.maxTokens ?? 0), 0),
      0,
    );
  const maxCost = plan.budget.maxCostCny;
  const nextAction = currentPhase?.stopPoint.reason ?? "Review workflow plan before execution.";
  const tokenCostSummary = [
    maxTokens ? `tokens<=${maxTokens}` : "tokens=unset",
    maxCost ? `cost<=${maxCost} CNY` : "cost=unset",
  ].join("; ");

  const summaryText = [
    `Workflow ${plan.title}`,
    `Current phase: ${currentPhase?.title ?? "unknown"}`,
    `Agents: done=${done}, running=${running}, blocked=${blocked}`,
    `Evidence refs: ${evidenceCount}`,
    `Budget: ${tokenCostSummary}`,
    `Next: ${nextAction}`,
  ].join("\n");

  const detailsText = [
    `Workflow Matrix details for ${plan.title}`,
    "phase | slice | role | status | evidence refs | budget | next action",
    ...plan.phases.flatMap((phase) =>
      phase.slices.map((slice) =>
        [
          phase.title,
          slice.title,
          slice.role,
          slice.status,
          (slice.evidence ?? []).map((item) => item.ref).join(",") || "none",
          formatSliceBudget(slice),
          slice.nextAction ?? phase.stopPoint.reason,
        ].join(" | "),
      ),
    ),
  ].join("\n");

  const mobileSummary = sanitizeMobileSummary(
    [
      `Workflow ${plan.title}`,
      `Phase: ${currentPhase?.title ?? "unknown"}`,
      `Agents done/running/blocked: ${done}/${running}/${blocked}`,
      `Evidence: ${evidenceCount}`,
      `Budget: ${tokenCostSummary}`,
      `Next: ${nextAction}`,
    ].join("\n"),
  );

  return {
    surface: "task-summary",
    summary: {
      currentPhase: currentPhase?.title ?? "unknown",
      agents: { done, running, blocked },
      evidenceCount,
      tokenCostSummary,
      nextAction,
    },
    summaryText,
    detailsText,
    mobileSummary,
  };
}

function normalizeRunningCap(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined || value < 1) {
    return DEFAULT_WORKFLOW_RUNNING_CAP;
  }
  return Math.max(1, Math.floor(value));
}

function validateDuplicateIds(
  ids: Array<string | undefined>,
  path: string,
  message: string,
  errors: WorkflowPlanValidationError[],
): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (!id) continue;
    if (seen.has(id)) {
      errors.push({ path, message: `${message}: ${id}` });
      continue;
    }
    seen.add(id);
  }
}

function validateSlice(
  slice: WorkflowSlice,
  path: string,
  allSliceIds: Set<string>,
  permissionMode: PermissionMode,
  errors: WorkflowPlanValidationError[],
): void {
  if (!slice.id?.trim()) {
    errors.push({ path: `${path}.id`, message: "slice id is required" });
  }
  if (!slice.title?.trim()) {
    errors.push({ path: `${path}.title`, message: "slice title is required" });
  }
  if (!["explorer", "worker", "verifier", "planner"].includes(slice.role)) {
    errors.push({ path: `${path}.role`, message: `unknown agent role: ${slice.role}` });
  }
  for (const dep of slice.dependsOnSliceIds ?? []) {
    if (!allSliceIds.has(dep) || dep === slice.id) {
      errors.push({
        path: `${path}.dependsOnSliceIds`,
        message: `unknown or self slice dependency: ${dep}`,
      });
    }
  }
  validateBudget(slice.budget, `${path}.budget`, errors);
  validateToolClasses(slice.allowedToolClasses ?? [], `${path}.allowedToolClasses`, errors);
  validateToolProposals(slice.toolProposals ?? [], `${path}.toolProposals`, errors);
  validateEvidence(slice.evidence ?? [], `${path}.evidence`, errors);
  validateReferences(slice.references ?? [], `${path}.references`, errors);
  validateRuntimeTarget(slice.targetRuntime, `${path}.targetRuntime`, permissionMode, errors);
}

function validateBudget(
  budget: WorkflowBudget | undefined,
  path: string,
  errors: WorkflowPlanValidationError[],
): void {
  if (!budget) return;
  for (const [field, value] of Object.entries(budget)) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      errors.push({ path: `${path}.${field}`, message: "budget values must be non-negative" });
    }
  }
}

function validateToolClasses(
  classes: WorkflowToolClass[],
  path: string,
  errors: WorkflowPlanValidationError[],
): void {
  classes.forEach((toolClass, index) => {
    if (!ALLOWED_TOOL_CLASSES.has(toolClass)) {
      errors.push({ path: `${path}[${index}]`, message: `unknown tool class: ${toolClass}` });
    }
  });
}

function validateToolProposals(
  proposals: WorkflowToolProposal[],
  path: string,
  errors: WorkflowPlanValidationError[],
): void {
  proposals.forEach((proposal, index) => {
    const proposalPath = `${path}[${index}]`;
    validateToolClasses([proposal.toolClass], `${proposalPath}.toolClass`, errors);
    if (proposal.execution !== "execute") return;
    if (!proposal.discovered || !proposal.trusted || !proposal.executable) {
      errors.push({
        path: proposalPath,
        message:
          "tool execution proposal requires discovered=true, trusted=true, and executable=true",
      });
    }
    if (proposal.toolClass === "mcp-local-stdio" && !proposal.toolName?.startsWith("mcp:")) {
      errors.push({
        path: `${proposalPath}.toolName`,
        message: "mcp-local-stdio execution must reference an mcp:<server>:<tool> name",
      });
    }
  });
}

function validateEvidence(
  evidence: WorkflowEvidenceRequirement[],
  path: string,
  errors: WorkflowPlanValidationError[],
): void {
  evidence.forEach((item, index) => {
    const evidencePath = `${path}[${index}]`;
    if (!item.ref?.trim()) {
      errors.push({ path: `${evidencePath}.ref`, message: "evidence ref is required" });
    }
    if (PASS_BANNED_EVIDENCE_KINDS.has(item.kind) && (item.requiredForPass || item.passEvidence)) {
      errors.push({
        path: evidencePath,
        message: `${item.kind} cannot be used as PASS evidence`,
      });
    }
  });
}

function validateReferences(
  refs: WorkflowReference[],
  path: string,
  errors: WorkflowPlanValidationError[],
): void {
  refs.forEach((ref, index) => {
    const refPath = `${path}[${index}]`;
    if (!ref.ref?.trim()) {
      errors.push({ path: `${refPath}.ref`, message: "reference id/path is required" });
    }
    if (ref.summary && ref.summary.length > 1_000) {
      errors.push({
        path: `${refPath}.summary`,
        message: "reference summary is too large; use a bounded ref instead",
      });
    }
  });
}

function validateRuntimeTarget(
  target: WorkflowRuntimeTarget | undefined,
  path: string,
  permissionMode: PermissionMode,
  errors: WorkflowPlanValidationError[],
): void {
  if (!target) return;
  const raw = target as unknown as Record<string, unknown>;
  if (typeof raw.command === "string" || typeof raw.rawCommand === "string") {
    errors.push({
      path,
      message: "runtime mapping must be a structured main-chain target, not a raw command string",
    });
  }
  if (target.kind === "slash") {
    if (!ALLOWED_SLASH_TARGETS.has(target.slash)) {
      errors.push({ path: `${path}.slash`, message: `unknown slash target: ${target.slash}` });
    }
    const action = "action" in target ? target.action : undefined;
    if (action && MUTATING_SLASH_ACTIONS.has(action) && !target.mutating) {
      errors.push({
        path: `${path}.mutating`,
        message: `slash action ${target.slash} ${action} must be marked mutating`,
      });
    }
  }
  if (permissionMode === "plan" && target.mutating) {
    errors.push({
      path,
      message: "plan mode cannot contain mutating execution proposals",
    });
  }
}

function scanForbiddenRawFields(
  value: unknown,
  path: string,
  errors: WorkflowPlanValidationError[],
): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForbiddenRawFields(item, `${path}[${index}]`, errors));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.toLowerCase();
    if (
      [
        "rawtranscript",
        "rawfulltranscript",
        "fulltranscript",
        "rawsource",
        "fullsource",
        "sourcecode",
        "rawlog",
        "fulllog",
        "largelog",
        "logbody",
      ].includes(normalizedKey)
    ) {
      errors.push({
        path: `${path}.${key}`,
        message: "raw transcript/source/log injection is forbidden; use bounded refs instead",
      });
      continue;
    }
    scanForbiddenRawFields(child, `${path}.${key}`, errors);
  }
}

function formatSliceBudget(slice: WorkflowSlice): string {
  const parts = [
    slice.budget?.maxTokens ? `tokens<=${slice.budget.maxTokens}` : "tokens=unset",
    slice.budget?.maxDurationMs ? `duration<=${slice.budget.maxDurationMs}ms` : "duration=unset",
  ];
  return parts.join(";");
}

function sanitizeMobileSummary(value: string): string {
  return value
    .replace(/[A-Za-z]:\\[^\s]+/gu, "[local-path]")
    .replace(/\/(?:Users|home|var|tmp|private|mnt)\/[^\s]+/gu, "[local-path]")
    .replace(/sk-[A-Za-z0-9_-]{8,}/gu, "[masked-key]")
    .replace(/(api[_-]?key\s*[=:]\s*)\S+/giu, "$1[masked-key]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/giu, "Bearer [masked-key]")
    .replace(
      /\b(?:full transcript|raw transcript|full source|raw source|full log|raw log)\b/giu,
      "[redacted-detail]",
    )
    .slice(0, 800);
}

export function mapWorkflowSliceStatusToDurableJobAgentStatus(
  status: WorkflowSliceStatus,
): DurableJobAgentStatus {
  if (status === "created") return "created";
  if (status === "queued") return "queued";
  if (status === "sleeping") return "sleeping";
  if (status === "blocked") return "blocked";
  if (status === "running") return "running";
  if (status === "completed") return "completed";
  return "failed";
}
