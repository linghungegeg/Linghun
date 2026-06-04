import { DEFAULT_JOB_RUNNING_AGENT_CAP } from "./job-runtime.js";
import type { AgentType, BackgroundTaskState, DurableJobAgentStatus } from "./tui-data-types.js";
import type {
  NormalizedWorkflowPlan,
  WorkflowEvidenceKind,
  WorkflowEvidenceRequirement,
  WorkflowPhase,
  WorkflowReference,
  WorkflowRuntimeTarget,
  WorkflowSlice,
  WorkflowSliceStatus,
  WorkflowToolClass,
} from "./workflow-plan-schema.js";

export type WorkflowBridgePermissionAction = "Write" | "Bash" | "Git" | "network" | "none";

export type WorkflowBridgeRequestStatus =
  | "runnable"
  | "readonly"
  | "start_gate_needed"
  | "blocked"
  | "queued"
  | "status_only";

export type WorkflowMainChainRequest =
  | {
      mainChain: "job";
      action: "create" | "run" | "status" | "report";
      workflowId: string;
      phaseId: string;
      sliceId: string;
      goal?: string;
      jobRef?: string;
      phase: string;
      target: string;
      requestedAgents?: number;
      runningCap?: number;
      maxTokens?: number;
      maxDurationMs?: number;
    }
  | {
      mainChain: "fork";
      role: AgentType;
      task: string;
      workflowId: string;
      phaseId: string;
      sliceId: string;
      contextRefs: WorkflowBridgeContextRefs;
    }
  | {
      mainChain: "agents";
      action: "list" | "show";
      workflowId: string;
      phaseId: string;
      sliceId: string;
      agentRef?: string;
    }
  | {
      mainChain: "verification";
      level: "smoke" | "focused" | "typecheck" | "test" | "build" | "lint";
      workflowId: string;
      phaseId: string;
      sliceId: string;
      evidenceRefs: string[];
    }
  | {
      mainChain: "details";
      view: "evidence" | "background" | "job" | "agent";
      workflowId: string;
      phaseId: string;
      sliceId: string;
      refs: string[];
    };

export type WorkflowBridgeSafety = {
  readonly: boolean;
  mutating: boolean;
  requiresStartGate: boolean;
  requiresPermissionPipeline: boolean;
  requiredPermissionAction: WorkflowBridgePermissionAction;
  evidencePolicy: "neverTreatCompletionAsPass";
};

export type WorkflowBridgeContextRefs = {
  boundedRefs: Array<Pick<WorkflowReference, "kind" | "ref" | "summary">>;
  workspaceCacheRefs: string[];
  evidenceRefs: Array<{
    ref: string;
    kind: WorkflowEvidenceKind;
    claim: string;
    passEvidenceAllowed: boolean;
  }>;
  keyFilesSummary: string[];
  droppedRefKinds: WorkflowReference["kind"][];
  notIncluded: string[];
};

export type WorkflowBridgeStartGateProposal = {
  kind: "start-gate-proposal";
  reason: string;
  scope: string;
  requiresExactConfirmation: true;
  doesNotReplacePermissionPipeline: true;
};

export type WorkflowBridgePermissionProposal = {
  kind: "permission-proposal";
  requiredPermissionAction: WorkflowBridgePermissionAction;
  via: "decidePermission-or-pendingLocalApproval";
  bypassed: false;
};

export type WorkflowBridgeBackgroundProjection = {
  source: "background-task-projection";
  kind: BackgroundTaskState["kind"];
  backgroundStatus?: BackgroundTaskState["status"];
  jobAgentStatus?: DurableJobAgentStatus;
  userVisibleSummary: string;
  nextAction: string;
};

export type WorkflowBridgeTaskSurfaceInput = {
  phaseId: string;
  sliceId: string;
  requestStatus: WorkflowBridgeRequestStatus;
  routeRef?: string;
  tokenEstimate?: number;
  costEstimateCny?: number;
  durationEstimateMs?: number;
  evidenceRefs: string[];
  nextAction: string;
};

export type WorkflowBridgeRequestProposal = {
  id: string;
  proposalOnly: true;
  workflowId: string;
  phaseId: string;
  sliceId: string;
  status: WorkflowBridgeRequestStatus;
  reason: string;
  executable: boolean;
  request: WorkflowMainChainRequest | null;
  safety: WorkflowBridgeSafety;
  startGateProposal?: WorkflowBridgeStartGateProposal;
  permissionProposal?: WorkflowBridgePermissionProposal;
  handoffProposal: WorkflowBridgeContextRefs;
  backgroundProjection: WorkflowBridgeBackgroundProjection;
  taskSurfaceInput: WorkflowBridgeTaskSurfaceInput;
};

export type WorkflowBridgePhaseStatus = {
  phaseId: string;
  status: NormalizedWorkflowPlan["phases"][number]["status"];
  current: boolean;
};

export type WorkflowAgentRuntimeBridgeResult = {
  workflowId: string;
  currentPhaseId: string;
  runningCap: number;
  runnableSlots: number;
  phaseStopPointConfirmed: boolean;
  requests: WorkflowBridgeRequestProposal[];
  phaseStatuses: WorkflowBridgePhaseStatus[];
  summary: {
    runnable: number;
    readonly: number;
    startGateNeeded: number;
    blocked: number;
    queued: number;
    statusOnly: number;
  };
};

export type WorkflowAgentRuntimeBridgeOptions = {
  currentPhaseId?: string;
  confirmedPhaseStopPoints?: string[];
  runningCap?: number;
};

type BridgeWorkflowSlice = WorkflowSlice & {
  status: WorkflowSliceStatus;
  allowedToolClasses: WorkflowToolClass[];
  evidence: WorkflowEvidenceRequirement[];
  references: WorkflowReference[];
};

type BridgeWorkflowPhase = Omit<WorkflowPhase, "slices"> & {
  status: NonNullable<WorkflowPhase["status"]>;
  slices: BridgeWorkflowSlice[];
};

const ELIGIBLE_SLICE_STATUSES = new Set(["queued", "created", "sleeping"]);
const PASS_BANNED_EVIDENCE_KINDS = new Set<WorkflowEvidenceKind>([
  "agent_summary",
  "job_completed",
  "remote_event",
  "failure_learning",
]);
const SAFE_CONTEXT_REF_KINDS = new Set<WorkflowReference["kind"]>([
  "evidence",
  "workspace_cache",
  "file",
  "architecture",
]);

export type WorkflowStepCapabilityDecision =
  | { ok: true; reason: string }
  | { ok: false; reason: string };

export function decideWorkflowStepCapability(input: {
  permissionMode: NormalizedWorkflowPlan["permissionMode"];
  phaseStopPointConfirmed: boolean;
  target: WorkflowRuntimeTarget | undefined;
  request: WorkflowMainChainRequest | null;
}): WorkflowStepCapabilityDecision {
  if (!input.target) {
    return { ok: false, reason: "missing structured targetRuntime" };
  }
  if (containsRawCommand(input.target)) {
    return { ok: false, reason: "raw command strings are rejected by the workflow bridge" };
  }
  if (input.permissionMode === "plan" && input.target.mutating) {
    return {
      ok: false,
      reason: "plan mode cannot produce executable mutating workflow proposals",
    };
  }
  if (!input.request) {
    return {
      ok: false,
      reason: "targetRuntime is outside the D.14H-C bridge allowlist",
    };
  }
  if (input.target.mutating && !input.phaseStopPointConfirmed) {
    return {
      ok: false,
      reason: "phase stopPoint must be confirmed before a mutating request becomes runnable",
    };
  }
  return { ok: true, reason: "workflow step is executable through the existing main chain" };
}

export function bridgeWorkflowPlanToMainChainRequests(
  plan: NormalizedWorkflowPlan,
  options: WorkflowAgentRuntimeBridgeOptions = {},
): WorkflowAgentRuntimeBridgeResult {
  const phases = plan.phases as BridgeWorkflowPhase[];
  const currentPhase = selectCurrentPhase(phases, plan.currentPhaseId, options.currentPhaseId);
  const currentPhaseId = currentPhase?.id ?? options.currentPhaseId ?? plan.currentPhaseId ?? "";
  const runningCap = normalizeRunningCap(options.runningCap ?? plan.budget.maxRunningAgents);
  const confirmedStopPoints = new Set(options.confirmedPhaseStopPoints ?? []);
  const phaseStopPointConfirmed = confirmedStopPoints.has(currentPhaseId);
  const phaseStatuses = phases.map((phase) => ({
    phaseId: phase.id,
    status: phase.status,
    current: phase.id === currentPhaseId,
  }));

  if (!currentPhase) {
    return {
      workflowId: plan.id,
      currentPhaseId,
      runningCap,
      runnableSlots: 0,
      phaseStopPointConfirmed,
      requests: [],
      phaseStatuses,
      summary: emptySummary(),
    };
  }

  let runnableSlots = Math.max(
    0,
    runningCap - currentPhase.slices.filter((slice) => slice.status === "running").length,
  );
  const initialRunnableSlots = runnableSlots;

  const requests = currentPhase.slices.map((slice) => {
    const contextRefs = createContextRefs(plan, slice);
    const target = slice.targetRuntime;
    const safety = createSafety(slice.role, target);
    const base = {
      id: `${plan.id}:${currentPhase.id}:${slice.id}`,
      proposalOnly: true as const,
      workflowId: plan.id,
      phaseId: currentPhase.id,
      sliceId: slice.id,
      handoffProposal: contextRefs,
    };

    const blockedReason = getBlockedReason(phases, currentPhase.id, slice.id);
    if (blockedReason) {
      return createProposal(base, {
        status: "blocked",
        reason: blockedReason,
        executable: false,
        request: null,
        safety,
        phase: currentPhase.title,
        sliceTitle: slice.title,
        nextAction: slice.nextAction ?? blockedReason,
        contextRefs,
      });
    }

    if (!ELIGIBLE_SLICE_STATUSES.has(slice.status)) {
      return createProposal(base, {
        status: "status_only",
        reason: `slice status is ${slice.status}; bridge does not convert it into execution`,
        executable: false,
        request: null,
        safety,
        phase: currentPhase.title,
        sliceTitle: slice.title,
        nextAction: slice.nextAction ?? "Inspect status before requesting another action.",
        contextRefs,
      });
    }

    const request = createMainChainRequest(plan, currentPhase.id, currentPhase.title, slice);
    const capability = decideWorkflowStepCapability({
      permissionMode: plan.permissionMode,
      phaseStopPointConfirmed,
      target,
      request,
    });

    if (!capability.ok && capability.reason === "missing structured targetRuntime") {
      return createProposal(base, {
        status: "blocked",
        reason: capability.reason,
        executable: false,
        request: null,
        safety,
        phase: currentPhase.title,
        sliceTitle: slice.title,
        nextAction: slice.nextAction ?? "Add a structured main-chain target.",
        contextRefs,
      });
    }

    if (!capability.ok && capability.reason.includes("raw command strings")) {
      return createProposal(base, {
        status: "blocked",
        reason: capability.reason,
        executable: false,
        request: null,
        safety,
        phase: currentPhase.title,
        sliceTitle: slice.title,
        nextAction: "Replace raw command text with a structured main-chain target.",
        contextRefs,
      });
    }

    if (!capability.ok && capability.reason.includes("plan mode")) {
      return createProposal(base, {
        status: "blocked",
        reason: capability.reason,
        executable: false,
        request: null,
        safety,
        phase: currentPhase.title,
        sliceTitle: slice.title,
        nextAction: "Leave plan mode through the existing approval path before mutating actions.",
        contextRefs,
      });
    }

    if (!capability.ok && capability.reason.includes("allowlist")) {
      return createProposal(base, {
        status: "blocked",
        reason: capability.reason,
        executable: false,
        request: null,
        safety,
        phase: currentPhase.title,
        sliceTitle: slice.title,
        nextAction:
          "Use /job create|run|status|report, /fork, /agents list|show, verification, or details.",
        contextRefs,
      });
    }

    if (!capability.ok && capability.reason.includes("stopPoint")) {
      return createProposal(base, {
        status: "start_gate_needed",
        reason: capability.reason,
        executable: false,
        request,
        safety,
        phase: currentPhase.title,
        sliceTitle: slice.title,
        nextAction: slice.nextAction ?? currentPhase.stopPoint.reason,
        contextRefs,
        startGateProposal: {
          kind: "start-gate-proposal",
          reason: currentPhase.stopPoint.reason,
          scope: `${currentPhase.title} / ${slice.title}`,
          requiresExactConfirmation: true,
          doesNotReplacePermissionPipeline: true,
        },
      });
    }

    if (!target) {
      return createProposal(base, {
        status: "blocked",
        reason: "missing structured targetRuntime",
        executable: false,
        request: null,
        safety,
        phase: currentPhase.title,
        sliceTitle: slice.title,
        nextAction: slice.nextAction ?? "Add a structured main-chain target.",
        contextRefs,
      });
    }

    if (target.mutating && hasArchitectureBoundaryRisk(plan, slice)) {
      return createProposal(base, {
        status: "blocked",
        reason: "architecture boundary risk blocks mutating workflow step",
        executable: false,
        request: null,
        safety,
        phase: currentPhase.title,
        sliceTitle: slice.title,
        nextAction: "Review architecture findings before running the mutating step.",
        contextRefs,
      });
    }

    if (target.mutating && runnableSlots <= 0) {
      return createProposal(base, {
        status: "queued",
        reason: `running cap ${runningCap} reached; slice remains queued/sleeping`,
        executable: false,
        request: null,
        safety,
        phase: currentPhase.title,
        sliceTitle: slice.title,
        nextAction: "Wait for an existing agent/job to finish or inspect /agents and /job status.",
        contextRefs,
      });
    }

    if (target.mutating) {
      runnableSlots -= 1;
    }

    return createProposal(base, {
      status: target.mutating ? "runnable" : "readonly",
      reason: target.mutating
        ? "eligible slice converted into a proposal for the existing main chain"
        : "readonly target converted into a readonly main-chain proposal",
      executable: true,
      request,
      safety,
      phase: currentPhase.title,
      sliceTitle: slice.title,
      nextAction: slice.nextAction ?? "Hand this proposal to the existing main-chain dispatcher.",
      contextRefs,
    });
  });

  return {
    workflowId: plan.id,
    currentPhaseId,
    runningCap,
    runnableSlots: initialRunnableSlots,
    phaseStopPointConfirmed,
    requests,
    phaseStatuses,
    summary: summarizeRequests(requests),
  };
}

function createProposal(
  base: Pick<
    WorkflowBridgeRequestProposal,
    "id" | "proposalOnly" | "workflowId" | "phaseId" | "sliceId" | "handoffProposal"
  >,
  input: {
    status: WorkflowBridgeRequestStatus;
    reason: string;
    executable: boolean;
    request: WorkflowMainChainRequest | null;
    safety: WorkflowBridgeSafety;
    phase: string;
    sliceTitle: string;
    nextAction: string;
    contextRefs: WorkflowBridgeContextRefs;
    startGateProposal?: WorkflowBridgeStartGateProposal;
  },
): WorkflowBridgeRequestProposal {
  const permissionProposal =
    input.safety.requiresPermissionPipeline || input.safety.requiredPermissionAction !== "none"
      ? {
          kind: "permission-proposal" as const,
          requiredPermissionAction: input.safety.requiredPermissionAction,
          via: "decidePermission-or-pendingLocalApproval" as const,
          bypassed: false as const,
        }
      : undefined;
  return {
    ...base,
    status: input.status,
    reason: input.reason,
    executable: input.executable,
    request: input.request,
    safety: input.safety,
    startGateProposal: input.startGateProposal,
    permissionProposal,
    backgroundProjection: createBackgroundProjection(input),
    taskSurfaceInput: {
      phaseId: base.phaseId,
      sliceId: base.sliceId,
      requestStatus: input.status,
      tokenEstimate: getRequestTokenEstimate(input.request),
      durationEstimateMs: getRequestDurationEstimate(input.request),
      evidenceRefs: input.contextRefs.evidenceRefs.map((ref) => ref.ref),
      nextAction: input.nextAction,
    },
  };
}

function createBackgroundProjection(input: {
  status: WorkflowBridgeRequestStatus;
  request: WorkflowMainChainRequest | null;
  phase: string;
  sliceTitle: string;
  nextAction: string;
}): WorkflowBridgeBackgroundProjection {
  const kind =
    input.request?.mainChain === "job"
      ? "job"
      : input.request?.mainChain === "fork"
        ? "agent"
        : "verification";
  return {
    source: "background-task-projection",
    kind,
    jobAgentStatus: mapRequestStatusToJobAgentStatus(input.status),
    userVisibleSummary: `${input.phase} / ${input.sliceTitle}: ${input.status}`,
    nextAction: input.nextAction,
  };
}

function createMainChainRequest(
  plan: NormalizedWorkflowPlan,
  phaseId: string,
  phaseTitle: string,
  slice: BridgeWorkflowSlice,
): WorkflowMainChainRequest | null {
  const target = slice.targetRuntime;
  if (!target) return null;
  if (target.kind === "slash" && target.slash === "/job") {
    if (!["create", "run", "status", "report"].includes(target.action)) return null;
    const action = target.action as "create" | "run" | "status" | "report";
    return {
      mainChain: "job",
      action,
      workflowId: plan.id,
      phaseId,
      sliceId: slice.id,
      goal: action === "create" || action === "run" ? (slice.nextAction ?? slice.title) : undefined,
      jobRef:
        action === "status" || action === "report" ? (slice.nextAction ?? "latest") : undefined,
      phase: phaseTitle,
      target: "workflow-agent-runtime-bridge",
      requestedAgents: slice.budget?.requestedAgents,
      runningCap: slice.budget?.maxRunningAgents,
      maxTokens: slice.budget?.maxTokens,
      maxDurationMs: slice.budget?.maxDurationMs,
    };
  }
  if (target.kind === "slash" && target.slash === "/fork") {
    return {
      mainChain: "fork",
      role: target.role,
      task: slice.nextAction ?? slice.title,
      workflowId: plan.id,
      phaseId,
      sliceId: slice.id,
      contextRefs: createContextRefs(plan, slice),
    };
  }
  if (target.kind === "slash" && target.slash === "/agents") {
    if (!["list", "show"].includes(target.action)) return null;
    return {
      mainChain: "agents",
      action: target.action as "list" | "show",
      workflowId: plan.id,
      phaseId,
      sliceId: slice.id,
      agentRef: target.action === "show" ? slice.nextAction : undefined,
    };
  }
  if (target.kind === "verification") {
    return {
      mainChain: "verification",
      level: target.level,
      workflowId: plan.id,
      phaseId,
      sliceId: slice.id,
      evidenceRefs: slice.evidence.map((item) => item.ref),
    };
  }
  if (target.kind === "details") {
    return {
      mainChain: "details",
      view: target.view,
      workflowId: plan.id,
      phaseId,
      sliceId: slice.id,
      refs: slice.references.map((ref) => ref.ref),
    };
  }
  return null;
}

function createSafety(
  role: AgentType,
  target: WorkflowRuntimeTarget | undefined,
): WorkflowBridgeSafety {
  const mutating = Boolean(target?.mutating);
  return {
    readonly: !mutating,
    mutating,
    requiresStartGate: mutating,
    requiresPermissionPipeline: mutating,
    requiredPermissionAction: inferPermissionAction(role, target),
    evidencePolicy: "neverTreatCompletionAsPass",
  };
}

function hasArchitectureBoundaryRisk(
  plan: NormalizedWorkflowPlan,
  slice: BridgeWorkflowSlice,
): boolean {
  if (
    slice.evidence.some(
      (item) =>
        item.passEvidence === false &&
        isArchitectureRiskText(`${item.kind} ${item.ref} ${item.claim}`),
    )
  ) {
    return true;
  }
  return [...slice.references, ...(plan.references ?? [])].some((item) =>
    isArchitectureRiskReference(`${item.kind} ${item.ref} ${item.summary ?? ""}`),
  );
}

function isArchitectureRiskReference(value: string): boolean {
  if (/\b(?:no architecture risk|no risk|passed|pass|clean|ok)\b/iu.test(value)) return false;
  if (/无风险|已通过|通过|未发现(?:架构)?风险/u.test(value)) return false;
  return isArchitectureRiskText(value);
}

function isArchitectureRiskText(value: string): boolean {
  return (
    /architecture/iu.test(value) &&
    /\b(?:risk|violation|boundary|god-file|code-blob|large-file)\b/iu.test(value)
  );
}

function inferPermissionAction(
  role: AgentType,
  target: WorkflowRuntimeTarget | undefined,
): WorkflowBridgePermissionAction {
  if (!target?.mutating) return "none";
  if (target.kind === "slash" && target.slash === "/fork" && role === "worker") return "Write";
  return "none";
}

function createContextRefs(
  plan: NormalizedWorkflowPlan,
  slice: BridgeWorkflowSlice,
): WorkflowBridgeContextRefs {
  const refs = [...(plan.references ?? []), ...slice.references];
  const boundedRefs = refs
    .filter((ref) => SAFE_CONTEXT_REF_KINDS.has(ref.kind))
    .map((ref) => ({
      kind: ref.kind,
      ref: truncateText(ref.ref, 240),
      summary: ref.summary ? truncateText(ref.summary, 300) : undefined,
    }))
    .slice(0, 20);
  const droppedRefKinds = Array.from(
    new Set(refs.filter((ref) => !SAFE_CONTEXT_REF_KINDS.has(ref.kind)).map((ref) => ref.kind)),
  );
  const workspaceCacheRefs = boundedRefs
    .filter((ref) => ref.kind === "workspace_cache")
    .map((ref) => ref.ref);
  const keyFilesSummary = boundedRefs
    .filter((ref) => ref.kind === "file")
    .map((ref) => ref.summary ?? ref.ref)
    .slice(0, 8);
  const evidenceRefs = [...(plan.evidence ?? []), ...slice.evidence]
    .map((item) => ({
      ref: truncateText(item.ref, 240),
      kind: item.kind,
      claim: truncateText(item.claim, 300),
      passEvidenceAllowed: item.passEvidence === true && !PASS_BANNED_EVIDENCE_KINDS.has(item.kind),
    }))
    .slice(0, 20);
  return {
    boundedRefs,
    workspaceCacheRefs,
    evidenceRefs,
    keyFilesSummary,
    droppedRefKinds,
    notIncluded: [
      "full transcript",
      "full source",
      "full index",
      "full log",
      "provider/env/key/model route changes",
    ],
  };
}

function selectCurrentPhase(
  phases: BridgeWorkflowPhase[],
  planCurrentPhaseId: string | undefined,
  explicitPhaseId: string | undefined,
): BridgeWorkflowPhase | undefined {
  const phaseId = explicitPhaseId ?? planCurrentPhaseId;
  return (
    phases.find((phase) => phase.id === phaseId) ??
    phases.find((phase) => phase.status === "running" || phase.status === "blocked") ??
    phases[0]
  );
}

function getBlockedReason(
  phases: BridgeWorkflowPhase[],
  phaseId: string,
  sliceId: string,
): string | null {
  const phase = phases.find((item) => item.id === phaseId);
  const slice = phase?.slices.find((item) => item.id === sliceId);
  if (!phase || !slice) return "unknown phase or slice";
  const phaseDeps = phase.dependsOnPhaseIds ?? [];
  const unsatisfiedPhaseDep = phaseDeps.find(
    (depId) => phases.find((item) => item.id === depId)?.status !== "completed",
  );
  if (unsatisfiedPhaseDep) {
    return `phase dependency not satisfied: ${unsatisfiedPhaseDep}`;
  }
  const allSlices = new Map(phases.flatMap((item) => item.slices.map((s) => [s.id, s])));
  const unsatisfiedSliceDep = (slice.dependsOnSliceIds ?? []).find((depId) => {
    const status = allSlices.get(depId)?.status;
    return status !== "completed" && status !== "partial";
  });
  return unsatisfiedSliceDep ? `slice dependency not satisfied: ${unsatisfiedSliceDep}` : null;
}

function containsRawCommand(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsRawCommand);
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => {
    const lowered = key.toLowerCase();
    if ((lowered === "command" || lowered === "rawcommand") && typeof child === "string") {
      return true;
    }
    return containsRawCommand(child);
  });
}

function mapRequestStatusToJobAgentStatus(
  status: WorkflowBridgeRequestStatus,
): DurableJobAgentStatus {
  if (status === "runnable" || status === "readonly") return "queued";
  if (status === "queued" || status === "start_gate_needed") return "queued";
  if (status === "blocked") return "blocked";
  return "created";
}

function getRequestTokenEstimate(request: WorkflowMainChainRequest | null): number | undefined {
  return request?.mainChain === "job" ? request.maxTokens : undefined;
}

function getRequestDurationEstimate(request: WorkflowMainChainRequest | null): number | undefined {
  return request?.mainChain === "job" ? request.maxDurationMs : undefined;
}

function normalizeRunningCap(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined || value < 1) {
    return DEFAULT_JOB_RUNNING_AGENT_CAP;
  }
  return Math.max(1, Math.floor(value));
}

function summarizeRequests(
  requests: WorkflowBridgeRequestProposal[],
): WorkflowAgentRuntimeBridgeResult["summary"] {
  return requests.reduce((summary, request) => {
    if (request.status === "runnable") summary.runnable += 1;
    if (request.status === "readonly") summary.readonly += 1;
    if (request.status === "start_gate_needed") summary.startGateNeeded += 1;
    if (request.status === "blocked") summary.blocked += 1;
    if (request.status === "queued") summary.queued += 1;
    if (request.status === "status_only") summary.statusOnly += 1;
    return summary;
  }, emptySummary());
}

function emptySummary(): WorkflowAgentRuntimeBridgeResult["summary"] {
  return {
    runnable: 0,
    readonly: 0,
    startGateNeeded: 0,
    blocked: 0,
    queued: 0,
    statusOnly: 0,
  };
}

function truncateText(text: string, max: number): string {
  const compact = text.replace(/\s+/gu, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, Math.max(0, max - 1))}…`;
}
