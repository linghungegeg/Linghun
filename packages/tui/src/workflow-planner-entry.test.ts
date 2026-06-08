import { describe, expect, it } from "vitest";
import {
  type WorkflowPlannerGoal,
  formatWorkflowPlanPreview,
  generateWorkflowPlanPreview,
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
    expect(result.surface.summaryText).toContain("Result:");
    expect(result.surface.summaryText).toContain("Impact:");
    expect(result.surface.summaryText).toContain("Next:");
    expect(result.surface.detailsText).toContain("Evidence Merge:");
  });

  it("keeps en-US surface labels in the default planner result", () => {
    const result = generateWorkflowPlanPreview(goal());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summaryText).toContain("Result:");
    expect(result.summaryText).toContain("Impact:");
    expect(result.summaryText).toContain("Next:");
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

  it("treats audit, investigation, and inspection goals as readonly unless edits are explicit", () => {
    for (const readonlyGoal of [
      "请做源码审计并给结论",
      "只读源码事实调查，不修改文件",
      "定位 workflow blocked 的原因",
      "复核最新实测问题",
      "read-only source fact investigation without editing",
      "inspect the runtime failure and report findings",
    ]) {
      const result = generateWorkflowPlanPreview(goal({ goal: readonlyGoal }));
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const slices = result.plan.phases[0].slices;
      expect(slices.some((slice) => slice.id === "slice-implement")).toBe(false);
      expect(slices.find((slice) => slice.id === "slice-verify")?.dependsOnSliceIds).toEqual([
        "slice-architecture-review",
      ]);
    }

    const fixResult = generateWorkflowPlanPreview(goal({ goal: "请修复 workflow blocked 问题" }));
    expect(fixResult.ok).toBe(true);
    if (!fixResult.ok) return;
    expect(fixResult.plan.phases[0].slices.some((slice) => slice.id === "slice-implement")).toBe(
      true,
    );
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
    const result = generateWorkflowPlanPreview(goal({ goal: "帮我修复 bug 并跑测试" }));
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
    expect(result.detailsText.split("\n").length).toBeGreaterThan(
      result.summaryText.split("\n").length,
    );
    expect(result.detailsText).toContain("Evidence Merge:");
  });

  it("evidence merge does not treat job/agent/remote/failure_learning as PASS", () => {
    const result = generateWorkflowPlanPreview(goal());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const row of result.surface.evidenceMergeRows) {
      if (
        ["agent_summary", "job_completed", "remote_event", "failure_learning"].includes(row.kind)
      ) {
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
    expect(text).toContain("结果：");
    expect(text).toContain("影响：");
    expect(text).toContain("下一步：");
    expect(text).not.toMatch(/\bResult:|\bImpact:|\bNext:/u);
    expect(text).not.toMatch(/start_gate|passEvidence|raw evidence|sourceRef|merge/iu);
    expect(text).toContain("尚未开始执行");

    const textEn = formatWorkflowPlanPreview(result, "en-US");
    expect(textEn).toContain("Workflow Plan Preview");
    expect(textEn).toContain("Result:");
    expect(textEn).toContain("Impact:");
    expect(textEn).toContain("Next:");
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

describe("D.14H-F workflow planner core-system wiring", () => {
  function goal(overrides: Partial<WorkflowPlannerGoal> = {}): WorkflowPlannerGoal {
    return {
      goal: "Implement a cache hit rate report feature",
      permissionMode: "default",
      ...overrides,
    };
  }

  it("generates architecture-review slice after explore, before implement", () => {
    const result = generateWorkflowPlanPreview(goal());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const slices = result.plan.phases[0].slices;
    const exploreIdx = slices.findIndex((s) => s.id === "slice-explore");
    const archIdx = slices.findIndex((s) => s.id === "slice-architecture-review");
    const implIdx = slices.findIndex((s) => s.id === "slice-implement");
    expect(archIdx).toBeGreaterThan(exploreIdx);
    expect(archIdx).toBeLessThan(implIdx);
  });

  it("generates explicit independent slices and durable /job target for multi-agent goals", () => {
    const result = generateWorkflowPlanPreview(
      goal({
        goal: "复杂审计 workflow 多智能体分片实现",
        permissionMode: "full-access",
        agents: 4,
        multiAgent: true,
        runningCap: 2,
        teamName: "workflow-team",
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const slices = result.plan.phases[0].slices;
    const independent = slices.filter((slice) => slice.independent);
    expect(independent.length).toBeGreaterThanOrEqual(2);
    expect(independent.every((slice) => slice.canRunInParallel)).toBe(true);
    expect(independent.every((slice) => (slice.dependsOnSliceIds ?? []).length === 0)).toBe(true);
    const implement = slices.find((slice) => slice.id === "slice-implement");
    expect(implement?.targetRuntime).toMatchObject({
      kind: "slash",
      slash: "/job",
      action: "run",
      mutating: true,
    });
    expect(implement?.budget?.maxRunningAgents).toBe(2);
    expect(implement?.budget?.requestedAgents).toBe(4);
    expect(result.bridgeResult.runningCap).toBe(2);
    expect(result.bridgeResult.requests.some((request) => request.sliceId === "slice-implement")).toBe(
      true,
    );
  });

  it("does not invent a hidden multi-agent running cap when agents are not explicit", () => {
    const result = generateWorkflowPlanPreview(
      goal({
        goal: "复杂 workflow multi-agent review",
        permissionMode: "full-access",
        multiAgent: true,
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const implement = result.plan.phases[0].slices.find((slice) => slice.id === "slice-implement");
    expect(result.plan.budget.maxRunningAgents).toBe(result.plan.phases[0].slices.length);
    expect(result.bridgeResult.runningCap).toBe(result.plan.phases[0].slices.length);
    expect(implement?.budget?.requestedAgents).toBeUndefined();
    expect(implement?.budget?.maxRunningAgents).toBeUndefined();
  });

  it("does not generate mutating implement slice for explicit readonly audit goals", () => {
    const result = generateWorkflowPlanPreview(
      goal({
        goal: "只读审计当前项目源码，不看文档，不修改代码，找过度设计和主链风险",
        permissionMode: "full-access",
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const slices = result.plan.phases[0].slices;
    expect(slices.some((s) => s.id === "slice-implement")).toBe(false);
    expect(slices.find((s) => s.id === "slice-verify")?.dependsOnSliceIds).toEqual([
      "slice-architecture-review",
    ]);
    expect(result.bridgeResult.requests.some((request) => request.safety.mutating)).toBe(false);
  });

  it("architecture-review slice exists in all permission modes", () => {
    for (const mode of ["plan", "default", "auto-review", "full-access"] as const) {
      const result = generateWorkflowPlanPreview(goal({ permissionMode: mode }));
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const archSlice = result.plan.phases[0].slices.find(
        (s) => s.id === "slice-architecture-review",
      );
      expect(archSlice).toBeDefined();
      expect(archSlice?.role).toBe("planner");
      expect(archSlice?.targetRuntime?.mutating).toBe(false);
    }
  });

  it("architecture-review has correct acceptance criteria and evidence with passEvidence=false", () => {
    const result = generateWorkflowPlanPreview(goal());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const archSlice = result.plan.phases[0].slices.find(
      (s) => s.id === "slice-architecture-review",
    );
    expect(archSlice?.acceptanceCriteria).toContain("confirm architecture boundaries respected");
    expect(archSlice?.acceptanceCriteria).toContain("identify impacted modules");
    expect(archSlice?.acceptanceCriteria).toContain("assess AntiCodeBlob risk");
    const archEvidence = archSlice?.evidence?.find((e) => e.kind === "architecture");
    expect(archEvidence).toBeDefined();
    expect(archEvidence?.passEvidence).toBe(false);
  });

  it("does not inject a stable-point suggestion slice into workflow execution", () => {
    for (const mode of ["plan", "default", "auto-review", "full-access"] as const) {
      const result = generateWorkflowPlanPreview(goal({ permissionMode: mode }));
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.plan.phases[0].slices.some((s) => s.id === "slice-stable-point")).toBe(false);
      expect(JSON.stringify(result.plan)).not.toContain("Suggest git stable point");
    }
  });

  it("workflow planner does not auto-commit or auto-snapshot", () => {
    const result = generateWorkflowPlanPreview(goal());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const json = JSON.stringify(result);
    expect(json).not.toContain('"autoCommit"');
    expect(json).not.toContain('"autoSnapshot"');
    expect(json).not.toContain("slice-stable-point");
  });

  it("controlled memory ref injects workspace_cache reference without writing memory", () => {
    const result = generateWorkflowPlanPreview(
      goal({
        controlledMemoryRef: { rulesFound: true, summary: "Project uses pnpm monorepo" },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const memRef = result.plan.references?.find((r) => r.ref === "controlled-memory-context");
    expect(memRef).toBeDefined();
    expect(memRef?.kind).toBe("workspace_cache");
    expect(memRef?.summary).toContain("pnpm monorepo");
    const json = JSON.stringify(result);
    expect(json).not.toContain('"writeMemory"');
    expect(json).not.toContain('"autoAccept"');
  });

  it("controlled memory ref is not injected when rulesFound=false", () => {
    const result = generateWorkflowPlanPreview(
      goal({ controlledMemoryRef: { rulesFound: false } }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const memRef = result.plan.references?.find((r) => r.ref === "controlled-memory-context");
    expect(memRef).toBeUndefined();
  });

  it("self-learning hints inject as references, never write new learning", () => {
    const result = generateWorkflowPlanPreview(
      goal({ selfLearningHints: ["prefer vitest over jest", "use pnpm not npm"] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const hints = result.plan.references?.filter((r) => r.ref === "self-learning-hint");
    expect(hints?.length).toBe(2);
    expect(hints?.[0]?.summary).toContain("vitest");
    const json = JSON.stringify(result);
    expect(json).not.toContain('"writeLearning"');
    expect(json).not.toContain('"autoLearn"');
  });

  it("failure-learning refs inject as evidence with passEvidence=false", () => {
    const result = generateWorkflowPlanPreview(
      goal({
        failureLearningRefs: [
          { lesson: "Provider timeout on large files", source: "provider-timeout-2026" },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const flEvidence = result.plan.evidence?.filter((e) => e.kind === "failure_learning");
    expect(flEvidence?.length).toBe(1);
    expect(flEvidence?.[0]?.passEvidence).toBe(false);
    expect(flEvidence?.[0]?.claim).toContain("Provider timeout");
  });

  it("failure_learning risk hints appear in detailsText but not summaryText", () => {
    const result = generateWorkflowPlanPreview(
      goal({
        failureLearningRefs: [{ lesson: "Git lock file race condition", source: "git-lock-2026" }],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.detailsText).toContain("Risk Hints:");
    expect(result.detailsText).toContain("Git lock file race condition");
    expect(result.summaryText).not.toContain("Risk Hints:");
    expect(result.summaryText).not.toContain("Git lock file race condition");
  });

  it("cache/budget unset is not defaulted to a fake budget value", () => {
    const result = generateWorkflowPlanPreview(goal());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.budget.maxCostCny).toBeUndefined();
    expect(result.surface.meta.costEstimate).toBe("unset");
    expect(result.surface.meta.cacheBudgetHint.budgetSet).toBe(false);
  });

  it("cacheFreshnessHint injects as workspace_cache reference", () => {
    const result = generateWorkflowPlanPreview(
      goal({ cacheFreshnessHint: "cache freshness changed model route" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const cacheRef = result.plan.references?.find((r) => r.ref === "cache-freshness-hint");
    expect(cacheRef).toBeDefined();
    expect(cacheRef?.summary).toContain("cache freshness changed");
  });

  it("workflow worker context carries bounded index, memory, cache, failure, and architecture summaries", () => {
    const result = generateWorkflowPlanPreview(
      goal({
        controlledMemoryRef: { rulesFound: true, summary: "Use pnpm and vitest" },
        cacheFreshnessHint: "cache freshness changed none",
        failureLearningRefs: [{ lesson: "Re-run typecheck before claiming pass", source: "ev-1" }],
        indexStatusRef: {
          status: "ready",
          projectName: "F-Linghun",
          freshness: "stale hint none",
        },
        architectureRef: {
          target: "workflow worker context",
          summary: "reuse existing bridge and handoff only",
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const refs = result.plan.references ?? [];
    expect(refs.find((r) => r.ref === "controlled-memory-context")?.summary).toContain("pnpm");
    expect(refs.find((r) => r.ref === "cache-freshness-hint")?.summary).toContain("changed none");
    expect(refs.find((r) => r.ref === "index-status-context")?.summary).toContain("F-Linghun");
    expect(refs.find((r) => r.ref === "architecture-runtime-context")).toMatchObject({
      kind: "architecture",
    });
    expect(result.plan.evidence?.find((e) => e.kind === "failure_learning")).toMatchObject({
      passEvidence: false,
    });
    expect(JSON.stringify(result)).not.toMatch(/sourceRef|raw context/iu);
  });

  it("memory/self-learning/failure_learning do not enter PASS evidence", () => {
    const result = generateWorkflowPlanPreview(
      goal({
        controlledMemoryRef: { rulesFound: true, summary: "rules" },
        selfLearningHints: ["hint"],
        failureLearningRefs: [{ lesson: "lesson", source: "src" }],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const row of result.surface.evidenceMergeRows) {
      if (row.kind === "failure_learning") {
        expect(row.verdict).not.toBe("PASS");
      }
    }
    expect(result.surface.evidenceMergeSummary).not.toBe("PASS");
  });

  it("mobileSummary includes riskHintCount when failure_learning refs present", () => {
    const result = generateWorkflowPlanPreview(
      goal({
        failureLearningRefs: [
          { lesson: "lesson1", source: "src1" },
          { lesson: "lesson2", source: "src2" },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mobileSummary).toContain("Risk hints: 2");
  });

  it("mobileSummary is redacted and does not contain raw memory/log/key/path", () => {
    const result = generateWorkflowPlanPreview(
      goal({
        controlledMemoryRef: { rulesFound: true, summary: "C:\\Users\\Admin\\secret" },
        failureLearningRefs: [{ lesson: "sk-abcdefghijklmnop leaked", source: "key-leak" }],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mobileSummary).not.toContain("C:\\Users\\Admin");
    expect(result.mobileSummary).not.toContain("sk-abcdefghijklmnop");
  });

  it("proposal-only/start_gate/blocked request prevents Evidence Merge PASS", () => {
    const result = generateWorkflowPlanPreview(goal());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.surface.evidenceMergeSummary).not.toBe("PASS");
    const hasStartGate = result.bridgeResult.summary.startGateNeeded > 0;
    const hasBlocked = result.bridgeResult.summary.blocked > 0;
    const hasQueued = result.bridgeResult.summary.queued > 0;
    expect(hasStartGate || hasBlocked || hasQueued).toBe(true);
  });

  it("natural language workflow plan routes still pass", () => {
    const phrases = [
      "工作流计划 帮我拆分实现一个缓存命中率报告功能",
      "请生成工作流计划：实现缓存命中率报告",
      "workflow plan add a cache hit rate report",
    ];
    for (const phrase of phrases) {
      const result = generateWorkflowPlanPreview(goal({ goal: phrase }));
      expect(result.ok).toBe(true);
    }
  });

  it("does not create a second runtime, fifth permission mode, or auto-execute", () => {
    const result = generateWorkflowPlanPreview(goal());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const json = JSON.stringify(result);
    expect(json).not.toContain('"executor"');
    expect(json).not.toContain('"scheduler"');
    expect(json).not.toContain('"jobStore"');
    expect(json).not.toContain('"workflowRuntime"');
    expect(json).not.toContain('"autoExecute"');
    expect(["default", "auto-review", "plan", "full-access"]).toContain(result.plan.permissionMode);
    for (const req of result.bridgeResult.requests) {
      expect(req.proposalOnly).toBe(true);
    }
  });

  it("cacheBudgetHint.cacheFreshnessRef only matches cache-freshness-hint, not other workspace_cache refs", () => {
    const result = generateWorkflowPlanPreview(
      goal({
        controlledMemoryRef: { rulesFound: true, summary: "pnpm monorepo" },
        cacheFreshnessHint: "modelProviderHash changed",
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.surface.meta.cacheBudgetHint.cacheFreshnessRef).toBe("cache-freshness-hint");
  });

  it("mobileSummary includes done/running/blocked/queued slice counts", () => {
    const result = generateWorkflowPlanPreview(goal());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mobileSummary).toContain("done ");
    expect(result.mobileSummary).toContain("running ");
    expect(result.mobileSummary).toContain("blocked ");
    expect(result.mobileSummary).toContain("queued ");
  });

  it("failureLearningRefs with secrets are sanitized in detailsText and mobileSummary", () => {
    const result = generateWorkflowPlanPreview(
      goal({
        failureLearningRefs: [
          {
            lesson: "sk-abcdefghijklmnop was exposed in C:\\Users\\Admin\\logs",
            source: "key-leak-path",
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.detailsText).not.toContain("sk-abcdefghijklmnop");
    expect(result.detailsText).not.toContain("C:\\Users\\Admin");
    expect(result.mobileSummary).not.toContain("sk-abcdefghijklmnop");
    expect(result.mobileSummary).not.toContain("C:\\Users\\Admin");
    expect(result.detailsText).toContain("[key]");
    expect(result.detailsText).toContain("[path]");
  });
});
