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
};

export function generateWorkflowPlanPreview(
  input: WorkflowPlannerGoal,
): WorkflowPlannerEntryResult {
  const rawPlan = buildConservativePlan(input.goal, input.permissionMode);
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

function buildConservativePlan(goal: string, permissionMode: PermissionMode): WorkflowPlan {
  const sanitizedGoal = sanitizeGoalText(goal);
  const planId = `wf-plan-${Date.now()}`;
  const phaseId = "phase-1";

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
    evidence: [],
    references: [],
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
  ];

  if (permissionMode !== "plan") {
    slices.push({
      id: "slice-implement",
      title: "Implement changes",
      role: "worker",
      status: "queued",
      dependsOnSliceIds: ["slice-explore"],
      targetRuntime: { kind: "slash", slash: "/fork", role: "worker", mutating: true },
      budget: { maxTokens: 5000, maxDurationMs: 120_000 },
      acceptanceCriteria: ["apply changes after approval"],
      nextAction: goal.slice(0, 200) || "Apply changes after approval.",
    });
  }

  slices.push({
    id: "slice-verify",
    title: "Verify result",
    role: "verifier",
    status: "queued",
    dependsOnSliceIds: permissionMode === "plan" ? ["slice-explore"] : ["slice-implement"],
    targetRuntime: { kind: "verification", level: "typecheck", mutating: false },
    acceptanceCriteria: ["run typecheck/tests after execution"],
    nextAction: "Run typecheck and tests after execution.",
  });

  return slices;
}

function sanitizeGoalText(goal: string): string {
  return goal
    .replace(/[A-Za-z]:\\[^\s]+/gu, "[path]")
    .replace(/\/(?:Users|home|var|tmp|private|mnt)\/[^\s]+/gu, "[path]")
    .replace(/sk-[A-Za-z0-9_-]{8,}/gu, "[key]")
    .replace(/(api[_-]?key\s*[=:]\s*)\S+/giu, "$1[key]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/giu, "Bearer [key]")
    .slice(0, 500)
    .trim();
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
  const note =
    language === "en-US"
      ? "This is a preview only. No execution has started. Confirm the phase stop point to proceed."
      : "这只是预览。尚未开始执行。确认阶段停止点后才能继续。";
  return [header, "", result.summaryText, "", note].join("\n");
}
