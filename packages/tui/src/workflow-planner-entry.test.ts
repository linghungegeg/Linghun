import { describe, expect, it } from "vitest";
import {
  formatWorkflowPlanPreview,
  generateWorkflowPlanPreview,
  type WorkflowPlannerGoal,
} from "./workflow-planner-entry.js";

function goal(overrides: Partial<WorkflowPlannerGoal> = {}): WorkflowPlannerGoal {
  return {
    goal: "Add pagination to the /users API endpoint",
    permissionMode: "default",
    ...overrides,
  };
}

describe("D.14H-E workflow planner entry", () => {
  it("generates a legal WorkflowPlan that passes normalize from /workflows plan goal", () => {
    const result = generateWorkflowPlanPreview(goal());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.phases.length).toBeGreaterThan(0);
    expect(result.plan.phases[0].slices.length).toBeGreaterThanOrEqual(2);
    expect(result.plan.permissionMode).toBe("default");
  });

  it("generates bridge proposals + task surface projection without executing", () => {
    const result = generateWorkflowPlanPreview(goal());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bridgeResult.requests.length).toBeGreaterThan(0);
    for (const req of result.bridgeResult.requests) {
      expect(req.proposalOnly).toBe(true);
    }
    expect(result.surface.summaryText).toContain("Workflow:");
    expect(result.surface.detailsText).toContain("Evidence Merge:");
  });

  it("plan mode only outputs preview, no executable mutating proposals", () => {
    const result = generateWorkflowPlanPreview(goal({ permissionMode: "plan" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const req of result.bridgeResult.requests) {
      if (req.safety.mutating) {
        expect(req.executable).toBe(false);
        expect(req.status).not.toBe("runnable");
      }
    }
    const hasWorkerSlice = result.plan.phases[0].slices.some((s) => s.role === "worker");
    expect(hasWorkerSlice).toBe(false);
  });

  it("default mode marks mutating proposals with requiresStartGate/requiresPermissionPipeline, not directly executable", () => {
    const result = generateWorkflowPlanPreview(goal({ permissionMode: "default" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const mutating = result.bridgeResult.requests.filter((r) => r.safety.mutating);
    expect(mutating.length).toBeGreaterThan(0);
    for (const req of mutating) {
      expect(req.safety.requiresStartGate).toBe(true);
      expect(req.safety.requiresPermissionPipeline).toBe(true);
      expect(req.executable).toBe(false);
      expect(["start_gate_needed", "blocked", "queued"]).toContain(req.status);
    }
  });

  it("auto-review and full-access do not add new semantics, reuse existing permission mode field", () => {
    for (const mode of ["auto-review", "full-access"] as const) {
      const result = generateWorkflowPlanPreview(goal({ permissionMode: mode }));
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.plan.permissionMode).toBe(mode);
      for (const req of result.bridgeResult.requests) {
        expect(req.proposalOnly).toBe(true);
      }
    }
  });

  it("natural language capability maps to workflow plan without keyword interception", () => {
    const result = generateWorkflowPlanPreview(
      goal({ goal: "帮我修复 bug 并跑测试" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.title).toContain("修复");
    expect(result.surface.summaryText).toBeDefined();
  });

  it("raw command strings do not enter plan targetRuntime", () => {
    const result = generateWorkflowPlanPreview(
      goal({ goal: "run rm -rf / and delete everything" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const json = JSON.stringify(result.plan);
    expect(json).not.toContain('"command"');
    expect(json).not.toContain('"rawCommand"');
    for (const phase of result.plan.phases) {
      for (const slice of phase.slices) {
        if (slice.targetRuntime) {
          expect(slice.targetRuntime.kind).toMatch(/^(slash|verification|details)$/);
        }
      }
    }
  });

  it("detailsText contains full matrix, summaryText stays short", () => {
    const result = generateWorkflowPlanPreview(goal());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summaryText.split("\n").length).toBeLessThan(15);
    expect(result.detailsText.split("\n").length).toBeGreaterThan(result.summaryText.split("\n").length);
    expect(result.detailsText).toContain("Evidence Merge:");
  });

  it("evidence merge does not treat job/agent/remote/failure_learning as PASS", () => {
    const result = generateWorkflowPlanPreview(goal());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const row of result.surface.evidenceMergeRows) {
      if (["agent_summary", "job_completed", "remote_event", "failure_learning"].includes(row.kind)) {
        expect(row.verdict).not.toBe("PASS");
      }
    }
  });

  it("source invariant: no new permission mode, no workflow approval store, no dashboard, no executor call", () => {
    const result = generateWorkflowPlanPreview(goal());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const json = JSON.stringify(result);
    expect(json).not.toContain('"dashboard"');
    expect(json).not.toContain('"panel"');
    expect(json).not.toContain('"workflowApproval"');
    expect(json).not.toContain('"executor"');
    expect(["default", "auto-review", "plan", "full-access"]).toContain(result.plan.permissionMode);
  });

  it("does not change provider/env/key/model route", () => {
    const result = generateWorkflowPlanPreview(goal());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const json = JSON.stringify(result);
    expect(json).not.toContain('"providerRoute"');
    expect(json).not.toContain('"envChange"');
    expect(json).not.toContain('"modelRoute"');
  });

  it("does not touch .claude/", () => {
    const result = generateWorkflowPlanPreview(goal());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const json = JSON.stringify(result);
    expect(json).not.toContain(".claude/");
    expect(json).not.toContain(".claude\\\\");
  });

  it("formatWorkflowPlanPreview produces user-facing text", () => {
    const result = generateWorkflowPlanPreview(goal());
    const text = formatWorkflowPlanPreview(result, "zh-CN");
    expect(text).toContain("工作流计划预览");
    expect(text).toContain("尚未开始执行");

    const textEn = formatWorkflowPlanPreview(result, "en-US");
    expect(textEn).toContain("Workflow Plan Preview");
    expect(textEn).toContain("No execution has started");
  });

  it("formatWorkflowPlanPreview handles failure", () => {
    const failed = { ok: false as const, reason: "test error" };
    expect(formatWorkflowPlanPreview(failed, "en-US")).toContain("test error");
    expect(formatWorkflowPlanPreview(failed, "zh-CN")).toContain("test error");
  });

  it("sanitizes secrets and paths in goal text", () => {
    const result = generateWorkflowPlanPreview(
      goal({ goal: "deploy to C:\\Users\\Admin\\secret with sk-abcdefghijklmnop" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.title).not.toContain("C:\\Users\\Admin");
    expect(result.plan.title).not.toContain("sk-abcdefghijklmnop");
  });

  it("preview stage evidenceMergeSummary is never PASS (no pre-fabricated evidence)", () => {
    for (const mode of ["default", "plan", "auto-review", "full-access"] as const) {
      const result = generateWorkflowPlanPreview(goal({ permissionMode: mode }));
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.surface.evidenceMergeSummary).not.toBe("PASS");
    }
  });

  it("preview output does not contain completed-tense evidence claims", () => {
    const result = generateWorkflowPlanPreview(goal());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const allText = result.summaryText + result.detailsText + result.mobileSummary;
    expect(allText).not.toContain("changes applied");
    expect(allText).not.toContain("verification passes");
    expect(allText).not.toContain("relevant code located");
  });

  it("if evidence refs exist in preview, they are passEvidenceAllowed=false and verdict is not PASS", () => {
    const result = generateWorkflowPlanPreview(goal());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const row of result.surface.evidenceMergeRows) {
      expect(row.verdict).not.toBe("PASS");
    }
  });
});
