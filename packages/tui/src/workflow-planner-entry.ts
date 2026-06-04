import type { PermissionMode } from "@linghun/shared";
import {
  type WorkflowAgentRuntimeBridgeResult,
  bridgeWorkflowPlanToMainChainRequests,
} from "./workflow-agent-runtime-bridge.js";
import {
  type NormalizedWorkflowPlan,
  type WorkflowPlan,
  type WorkflowPlanValidationResult,
  normalizeWorkflowPlan,
} from "./workflow-plan-schema.js";
import {
  type WorkflowTaskSurfaceResult,
  projectWorkflowTaskSurface,
} from "./workflow-task-surface.js";

export type WorkflowPlannerEntryResult =
  | {
      ok: true;
      plan: NormalizedWorkflowPlan;
      bridgeResult: WorkflowAgentRuntimeBridgeResult;
      surface: WorkflowTaskSurfaceResult;
      summaryText: string;
      detailsText: string;
      mobileSummary: string;
    }
  | {
      ok: false;
      reason: string;
    };

export type WorkflowPlannerGoal = {
  goal: string;
  permissionMode: PermissionMode;
  confirmedPhaseStopPoints?: string[];
  controlledMemoryRef?: { rulesFound: boolean; summary?: string };
  selfLearningHints?: string[];
  failureLearningRefs?: Array<{ lesson: string; source: string }>;
  cacheFreshnessHint?: string;
  deepCompactRef?: { id: string; summary: string };
  indexStatusRef?: { status: string; projectName?: string; freshness?: string };
  architectureRef?: { target: string; summary: string };
};

export function generateWorkflowPlanPreview(
  input: WorkflowPlannerGoal,
): WorkflowPlannerEntryResult {
  const rawPlan = buildConservativePlan(input);
  const validation = normalizeWorkflowPlan(rawPlan, { permissionMode: input.permissionMode });
  if (!validation.ok) {
    return {
      ok: false,
      reason: `Plan validation failed: ${validation.errors.map((e) => e.message).join("; ")}`,
    };
  }
  const plan = validation.plan;
  const bridgeResult = bridgeWorkflowPlanToMainChainRequests(plan, {
    confirmedPhaseStopPoints: input.confirmedPhaseStopPoints ?? [],
  });
  const surface = projectWorkflowTaskSurface(plan, bridgeResult);

  return {
    ok: true,
    plan,
    bridgeResult,
    surface,
    summaryText: surface.summaryText,
    detailsText: surface.detailsText,
    mobileSummary: surface.mobileSummary,
  };
}

function buildConservativePlan(input: WorkflowPlannerGoal): WorkflowPlan {
  const {
    goal,
    permissionMode,
    controlledMemoryRef,
    selfLearningHints,
    failureLearningRefs,
    cacheFreshnessHint,
    deepCompactRef,
    indexStatusRef,
    architectureRef,
  } = input;
  const sanitizedGoal = sanitizeGoalText(goal);
  const planId = `wf-plan-${Date.now()}`;
  const phaseId = "phase-1";

  const references: WorkflowPlan["references"] = [];
  const evidence: WorkflowPlan["evidence"] = [];

  if (controlledMemoryRef?.rulesFound && controlledMemoryRef.summary) {
    references.push({
      kind: "workspace_cache",
      ref: "controlled-memory-context",
      summary: sanitizeRefText(controlledMemoryRef.summary).slice(0, 500),
    });
  }

  if (selfLearningHints && selfLearningHints.length > 0) {
    for (const hint of selfLearningHints.slice(0, 5)) {
      references.push({
        kind: "workspace_cache",
        ref: "self-learning-hint",
        summary: sanitizeRefText(hint).slice(0, 200),
      });
    }
  }

  if (failureLearningRefs && failureLearningRefs.length > 0) {
    for (const ref of failureLearningRefs.slice(0, 5)) {
      evidence.push({
        ref: `failure-learning:${sanitizeRefText(ref.source).slice(0, 80)}`,
        kind: "failure_learning",
        claim: sanitizeRefText(ref.lesson).slice(0, 300),
        passEvidence: false,
      });
    }
  }

  if (cacheFreshnessHint) {
    references.push({
      kind: "workspace_cache",
      ref: "cache-freshness-hint",
      summary: sanitizeRefText(cacheFreshnessHint).slice(0, 200),
    });
  }

  if (deepCompactRef) {
    references.push({
      kind: "transcript",
      ref: `deep-compact:${sanitizeRefText(deepCompactRef.id).slice(0, 80)}`,
      summary: sanitizeRefText(deepCompactRef.summary).slice(0, 500),
    });
  }

  if (indexStatusRef) {
    const project = indexStatusRef.projectName
      ? `project ${indexStatusRef.projectName}`
      : "project unresolved";
    const freshness = indexStatusRef.freshness
      ? `; ${indexStatusRef.freshness.replace(/=/gu, " ")}`
      : "";
    references.push({
      kind: "workspace_cache",
      ref: "index-status-context",
      summary: sanitizeRefText(`status ${indexStatusRef.status}; ${project}${freshness}`).slice(
        0,
        200,
      ),
    });
  }

  if (architectureRef?.summary) {
    references.push({
      kind: "architecture",
      ref: "architecture-runtime-context",
      summary: sanitizeRefText(`${architectureRef.target}: ${architectureRef.summary}`).slice(
        0,
        300,
      ),
    });
  }

  return {
    id: planId,
    title: sanitizedGoal.slice(0, 80) || "Workflow plan",
    source: "slash",
    createdAt: new Date().toISOString(),
    permissionMode,
    currentPhaseId: phaseId,
    phases: [
      {
        id: phaseId,
        title: `Execute: ${sanitizedGoal.slice(0, 60) || "goal"}`,
        status: "pending",
        stopPoint: {
          required: true,
          confirmationRequired: true,
          reason: "Confirm plan before any execution.",
        },
        budget: { maxTokens: 10_000 },
        slices: buildSlicesForGoal(sanitizedGoal, permissionMode),
      },
    ],
    budget: { maxRunningAgents: 3 },
    evidence,
    references,
    stopConditions: ["stop after each phase and wait for explicit user confirmation"],
  };
}

function buildSlicesForGoal(goal: string, permissionMode: PermissionMode) {
  const slices: WorkflowPlan["phases"][number]["slices"] = [
    {
      id: "slice-explore",
      title: "Explore context",
      role: "explorer",
      status: "queued",
      targetRuntime: { kind: "details", view: "evidence", mutating: false },
      acceptanceCriteria: ["locate relevant code"],
      nextAction: "Read relevant files and gather evidence.",
    },
    {
      id: "slice-architecture-review",
      title: "Architecture review",
      role: "planner",
      status: "queued",
      dependsOnSliceIds: ["slice-explore"],
      targetRuntime: { kind: "details", view: "evidence", mutating: false },
      acceptanceCriteria: [
        "confirm architecture boundaries respected",
        "identify impacted modules",
        "check frontend/TUI constraints",
        "assess AntiCodeBlob risk",
      ],
      evidence: [
        {
          ref: "architecture-boundary-check",
          kind: "architecture",
          claim: "Architecture boundaries and impacted modules reviewed",
          passEvidence: false,
        },
      ],
      nextAction: "Review architecture boundaries, impacted modules, and AntiCodeBlob risk.",
    },
  ];

  const readonlyAuditGoal = isReadonlyAuditGoal(goal);
  if (permissionMode !== "plan" && !readonlyAuditGoal) {
    slices.push({
      id: "slice-implement",
      title: "Implement changes",
      role: "worker",
      status: "queued",
      dependsOnSliceIds: ["slice-architecture-review"],
      targetRuntime: { kind: "slash", slash: "/fork", role: "worker", mutating: true },
      budget: { maxTokens: 5000, maxDurationMs: 120_000 },
      acceptanceCriteria: ["apply changes after approval"],
      nextAction: goal.slice(0, 200) || "Apply changes after approval.",
    });
  }

  const lastExecutionSlice =
    permissionMode === "plan" || readonlyAuditGoal
      ? "slice-architecture-review"
      : "slice-implement";

  slices.push({
    id: "slice-stable-point",
    title: "Suggest git stable point",
    role: "verifier",
    status: "queued",
    dependsOnSliceIds: [lastExecutionSlice],
    targetRuntime: { kind: "details", view: "evidence", mutating: false },
    acceptanceCriteria: [
      "suggest git stable point check (proposal only, no auto-commit or snapshot)",
    ],
    nextAction:
      "Suggest creating a git stable point before/after execution. This is a proposal only — do not auto-commit or snapshot.",
  });

  slices.push({
    id: "slice-verify",
    title: "Verify result",
    role: "verifier",
    status: "queued",
    dependsOnSliceIds: ["slice-stable-point"],
    targetRuntime: { kind: "verification", level: "typecheck", mutating: false },
    acceptanceCriteria: readonlyAuditGoal
      ? ["run lightweight verification after readonly audit"]
      : ["run typecheck/tests after execution"],
    nextAction: readonlyAuditGoal
      ? "Run lightweight verification after readonly audit."
      : "Run typecheck and tests after execution.",
  });

  return slices;
}

function isReadonlyAuditGoal(goal: string): boolean {
  const normalized = goal.toLowerCase();
  return (
    /(审计|检查|评估|分析|review|audit|inspect|analy[sz]e)/iu.test(goal) &&
    /(不要修改|不修改|只读|不写|no\s+(?:code\s+)?changes|read[-\s]?only|do\s+not\s+(?:edit|modify|write))/iu.test(
      normalized,
    )
  );
}

function sanitizeGoalText(goal: string): string {
  return sanitizeRefText(goal).slice(0, 500).trim();
}

function sanitizeRefText(text: string): string {
  return text
    .replace(/[A-Za-z]:\\[^\s]+/gu, "[path]")
    .replace(/\/(?:Users|home|var|tmp|private|mnt)\/[^\s]+/gu, "[path]")
    .replace(/sk-[A-Za-z0-9_-]{8,}/gu, "[key]")
    .replace(/(api[_-]?key\s*[=:]\s*)\S+/giu, "$1[key]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/giu, "Bearer [key]")
    .replace(
      /\b(?:full transcript|raw transcript|full source|raw source|full log|raw log)\b/giu,
      "[redacted]",
    );
}

export function formatWorkflowPlanPreview(
  result: WorkflowPlannerEntryResult,
  language: "zh-CN" | "en-US" = "zh-CN",
): string {
  if (!result.ok) {
    return language === "en-US"
      ? `Workflow plan generation failed: ${result.reason}`
      : `工作流计划生成失败：${result.reason}`;
  }
  const header = language === "en-US" ? "Workflow Plan Preview" : "工作流计划预览";
  const surface =
    language === "en-US"
      ? result.surface
      : projectWorkflowTaskSurface(result.plan, result.bridgeResult, language);
  const note =
    language === "en-US"
      ? "This is a preview only. No execution has started. Confirm the phase stop point to proceed."
      : "这只是预览。尚未开始执行。确认阶段停止点后才能继续。";
  return [header, "", surface.summaryText, "", note].join("\n");
}
