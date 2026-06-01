import { describe, expect, it } from "vitest";
import {
  type WorkflowAgentRuntimeBridgeResult,
  bridgeWorkflowPlanToMainChainRequests,
} from "./workflow-agent-runtime-bridge.js";
import {
  type NormalizedWorkflowPlan,
  type WorkflowPlan,
  normalizeWorkflowPlan,
} from "./workflow-plan-schema.js";
import {
  type EvidenceMergeRow,
  type WorkflowTaskSurfaceResult,
  projectWorkflowTaskSurface,
} from "./workflow-task-surface.js";

function createPlan(overrides: Partial<WorkflowPlan> = {}): WorkflowPlan {
  return {
    id: "wf-14h-d",
    title: "Task Surface Test",
    source: "manual",
    createdAt: "2026-06-01T14:00:00.000Z",
    permissionMode: "default",
    currentPhaseId: "phase-d",
    references: [
      { kind: "workspace_cache", ref: "cache:ws-1", summary: "workspace cache" },
      { kind: "file", ref: "packages/tui/src/workflow-plan-schema.ts", summary: "schema file" },
    ],
    evidence: [
      {
        ref: "ev-grep-pass",
        kind: "grep_result",
        claim: "grep found the function",
        passEvidence: true,
      },
    ],
    phases: [
      {
        id: "phase-d",
        title: "Task Surface phase",
        status: "running",
        stopPoint: {
          required: true,
          confirmationRequired: true,
          reason: "Confirm D.14H-D phase stop before proceeding.",
        },
        slices: [
          {
            id: "slice-verify",
            title: "Run verification",
            role: "verifier",
            status: "queued",
            targetRuntime: { kind: "verification", level: "typecheck", mutating: false },
            budget: { maxTokens: 2000, maxDurationMs: 60_000 },
            evidence: [
              {
                ref: "ev-test-result",
                kind: "test_result",
                claim: "typecheck passes",
                passEvidence: true,
              },
            ],
          },
          {
            id: "slice-fork",
            title: "Fork worker",
            role: "worker",
            status: "queued",
            targetRuntime: { kind: "slash", slash: "/fork", role: "worker", mutating: true },
            nextAction: "write the task surface module",
            budget: { maxTokens: 5000, maxDurationMs: 120_000 },
            evidence: [
              {
                ref: "ev-agent-done",
                kind: "agent_summary",
                claim: "agent completed task",
                passEvidence: false,
              },
            ],
          },
          {
            id: "slice-blocked",
            title: "Blocked slice",
            role: "explorer",
            status: "blocked",
            targetRuntime: { kind: "details", view: "evidence", mutating: false },
            evidence: [
              {
                ref: "ev-remote",
                kind: "remote_event",
                claim: "remote notification received",
                passEvidence: false,
              },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

function normalize(plan: WorkflowPlan): NormalizedWorkflowPlan {
  const result = normalizeWorkflowPlan(plan);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join("\n"));
  return result.plan;
}

function surface(
  plan: WorkflowPlan,
  options: Parameters<typeof bridgeWorkflowPlanToMainChainRequests>[1] = {
    confirmedPhaseStopPoints: ["phase-d"],
  },
): WorkflowTaskSurfaceResult {
  const normalized = normalize(plan);
  const bridgeResult = bridgeWorkflowPlanToMainChainRequests(normalized, options);
  return projectWorkflowTaskSurface(normalized, bridgeResult);
}

describe("D.14H-D workflow task surface + evidence merge", () => {
  it("generates main-screen summary and detailsText from legal plan + bridge result", () => {
    const result = surface(createPlan());
    expect(result.summaryText).toContain("Result:");
    expect(result.summaryText).toContain("Impact: Task Surface phase");
    expect(result.summaryText).toContain("blocked");
    expect(result.summaryText).toContain("Next:");
    expect(result.detailsText).toContain("Workflow Task Surface details");
    expect(result.detailsText).toContain(
      "phase | slice | role | status | permission | evidence | nextAction",
    );
  });

  it("renders zh-CN summary and mobile summary with human labels", () => {
    const normalized = normalize(createPlan());
    const bridgeResult = bridgeWorkflowPlanToMainChainRequests(normalized, {
      confirmedPhaseStopPoints: ["phase-d"],
    });
    const result = projectWorkflowTaskSurface(normalized, bridgeResult, "zh-CN");
    expect(result.summaryText).toContain("结果：");
    expect(result.summaryText).toContain("影响：");
    expect(result.summaryText).toContain("下一步：");
    expect(result.summaryText).not.toMatch(/\bResult:|\bImpact:|\bNext:/u);
    expect(result.summaryText).not.toMatch(/start_gate|passEvidence|raw evidence|sourceRef|merge/iu);
    expect(result.mobileSummary).toContain("工作流：");
    expect(result.mobileSummary).toContain("下一步：");
    expect(result.mobileSummary).not.toMatch(/\bResult:|\bImpact:|\bNext:/u);
  });

  it("main-screen summary does not contain full matrix/log/source/transcript", () => {
    const result = surface(createPlan());
    expect(result.summaryText).not.toMatch(/full transcript/i);
    expect(result.summaryText).not.toMatch(/raw transcript/i);
    expect(result.summaryText).not.toMatch(/full source/i);
    expect(result.summaryText).not.toMatch(/raw source/i);
    expect(result.summaryText).not.toMatch(/full log/i);
    expect(result.summaryText).not.toMatch(/raw log/i);
    expect(result.summaryText.split("\n").length).toBeLessThan(15);
  });

  it("main-screen summary keeps mechanism words out of the default surface", () => {
    const result = surface(createPlan());
    expect(result.summaryText).not.toMatch(
      /sourceRef|schema|debug|gate retry|retry\/downgrade|retry downgrade|passEvidence|raw evidence|tool_result raw|runtime internals|start_gate|kinds/iu,
    );
    expect(result.detailsText).toContain("Evidence Merge:");
  });

  it("detailsText contains phase/slice/role/status/permission/evidence/nextAction", () => {
    const result = surface(createPlan());
    expect(result.detailsText).toContain("phase-d");
    expect(result.detailsText).toContain("slice-verify");
    expect(result.detailsText).toContain("slice-fork");
    expect(result.detailsText).toContain("slice-blocked");
    expect(result.detailsText).toContain("none");
    expect(result.detailsText).toContain("Evidence Merge:");
  });

  it("evidence merge: verification/test/local evidence with passEvidenceAllowed=true yields PASS", () => {
    const result = surface(createPlan());
    const passRows = result.evidenceMergeRows.filter((r) => r.verdict === "PASS");
    expect(passRows.length).toBeGreaterThan(0);
    for (const row of passRows) {
      expect(row.passEvidenceAllowed).toBe(true);
      expect([
        "file_read",
        "grep_result",
        "index_query",
        "command_output",
        "test_result",
        "verification",
        "provider",
        "architecture",
      ]).toContain(row.kind);
    }
  });

  it("evidence merge: agent_summary / job_completed / remote_event / failure_learning never yield PASS", () => {
    const result = surface(createPlan());
    const bannedKinds = ["agent_summary", "job_completed", "remote_event", "failure_learning"];
    const bannedRows = result.evidenceMergeRows.filter((r) => bannedKinds.includes(r.kind));
    for (const row of bannedRows) {
      expect(row.verdict).not.toBe("PASS");
      expect(row.reason).toContain("context/status only");
    }
  });

  it("evidence merge: runnable/request proposal status is not treated as PASS", () => {
    const result = surface(createPlan());
    expect(result.evidenceMergeSummary).not.toBe("PASS");
  });

  it("blocked/start_gate_needed/queued slices show as PARTIAL/BLOCKED, not faking completion", () => {
    const plan = createPlan();
    const resultNoGate = surface(plan, {});
    expect(resultNoGate.summaryText).toContain("user confirmation needed");
    expect(resultNoGate.summaryText).not.toContain("start_gate");
    expect(resultNoGate.meta.nextAction).toContain("Confirm");
  });

  it("mobile-safe summary sanitizes secrets, absolute paths, and full log/source/transcript", () => {
    const plan = createPlan({
      title: "Test at C:\\Users\\Admin\\project with sk-abcdefghijklmnop and full transcript",
    });
    const result = surface(plan);
    expect(result.mobileSummary).not.toContain("C:\\Users\\Admin");
    expect(result.mobileSummary).not.toContain("sk-abcdefghijklmnop");
    expect(result.mobileSummary).not.toMatch(/full transcript/i);
    expect(result.mobileSummary).toContain("[local-path]");
    expect(result.mobileSummary).toContain("[masked-key]");
  });

  it("does not introduce dashboard/panel/source fields", () => {
    const result = surface(createPlan());
    const json = JSON.stringify(result);
    expect(json).not.toContain('"dashboard"');
    expect(json).not.toContain('"panel"');
    expect(json).not.toContain('"sourceCode"');
    expect(json).not.toContain('"rawSource"');
    expect(json).not.toContain('"fullTranscript"');
    expect(json).not.toContain('"rawTranscript"');
  });

  it("does not execute requests: no slash handler, runner, job runtime, or agent runtime calls", () => {
    const normalized = normalize(createPlan());
    const bridgeResult = bridgeWorkflowPlanToMainChainRequests(normalized, {
      confirmedPhaseStopPoints: ["phase-d"],
    });
    for (const req of bridgeResult.requests) {
      expect(req.proposalOnly).toBe(true);
    }
    const result = projectWorkflowTaskSurface(normalized, bridgeResult);
    expect(result).toBeDefined();
    expect(result.summaryText).toBeDefined();
  });

  it("token/cost/duration estimate shows existing values or unset/unknown when missing", () => {
    const result = surface(createPlan());
    expect(result.meta.tokenEstimate).toMatch(/<=|unset/);
    expect(result.meta.costEstimate).toMatch(/<=|unset/);
    expect(result.meta.durationEstimate).toMatch(/<=|unset/);

    const noBudgetPlan = createPlan({
      phases: [
        {
          id: "phase-d",
          title: "No budget phase",
          status: "running",
          stopPoint: { required: true, confirmationRequired: true, reason: "stop" },
          slices: [
            {
              id: "slice-no-budget",
              title: "No budget slice",
              role: "explorer",
              status: "queued",
              targetRuntime: { kind: "details", view: "evidence", mutating: false },
            },
          ],
        },
      ],
      budget: undefined,
    });
    const noBudgetResult = surface(noBudgetPlan);
    expect(noBudgetResult.meta.tokenEstimate).toBe("unset");
    expect(noBudgetResult.meta.costEstimate).toBe("unset");
    expect(noBudgetResult.meta.durationEstimate).toBe("unset");
  });

  it("detailsText does not duplicate main-screen long text or cause screen flooding", () => {
    const result = surface(createPlan());
    const summaryLines = result.summaryText.split("\n").length;
    const detailsLines = result.detailsText.split("\n").length;
    expect(summaryLines).toBeLessThan(15);
    expect(detailsLines).toBeGreaterThan(summaryLines);
    expect(detailsLines).toBeLessThan(100);
    const summaryInDetails = result.detailsText.includes(result.summaryText);
    expect(summaryInDetails).toBe(false);
  });

  it("overall evidence merge verdict is BLOCKED when no evidence refs exist", () => {
    const emptyPlan = createPlan({
      evidence: [],
      phases: [
        {
          id: "phase-d",
          title: "Empty evidence phase",
          status: "running",
          stopPoint: { required: true, confirmationRequired: true, reason: "stop" },
          slices: [
            {
              id: "slice-empty",
              title: "Empty slice",
              role: "explorer",
              status: "queued",
              targetRuntime: { kind: "details", view: "background", mutating: false },
            },
          ],
        },
      ],
    });
    const result = surface(emptyPlan);
    expect(result.evidenceMergeSummary).toBe("BLOCKED");
    expect(result.evidenceMergeRows).toHaveLength(0);
  });

  it("failure_learning evidence kind never produces PASS even when present in plan", () => {
    const plan = createPlan({
      evidence: [
        {
          ref: "ev-failure",
          kind: "failure_learning",
          claim: "learned from failure",
          passEvidence: false,
        },
      ],
      phases: [
        {
          id: "phase-d",
          title: "Failure learning phase",
          status: "running",
          stopPoint: { required: true, confirmationRequired: true, reason: "stop" },
          slices: [
            {
              id: "slice-fl",
              title: "FL slice",
              role: "verifier",
              status: "queued",
              targetRuntime: { kind: "verification", level: "test", mutating: false },
              evidence: [
                {
                  ref: "ev-job-done",
                  kind: "job_completed",
                  claim: "job finished",
                  passEvidence: false,
                },
              ],
            },
          ],
        },
      ],
    });
    const result = surface(plan);
    expect(result.evidenceMergeRows.length).toBeGreaterThan(0);
    for (const row of result.evidenceMergeRows) {
      if (row.kind === "failure_learning" || row.kind === "job_completed") {
        expect(row.verdict).not.toBe("PASS");
        expect(row.reason).toContain("context/status only");
      }
    }
  });

  it("overall evidenceMergeSummary is PARTIAL when all evidence is PASS but start_gate_needed exists", () => {
    const plan = createPlan({
      evidence: [
        {
          ref: "ev-test-pass",
          kind: "test_result",
          claim: "tests pass",
          passEvidence: true,
        },
      ],
      phases: [
        {
          id: "phase-d",
          title: "Gate needed phase",
          status: "running",
          stopPoint: { required: true, confirmationRequired: true, reason: "Confirm phase stop." },
          slices: [
            {
              id: "slice-mutating",
              title: "Mutating slice",
              role: "worker",
              status: "queued",
              targetRuntime: { kind: "slash", slash: "/fork", role: "worker", mutating: true },
              nextAction: "do work",
              evidence: [
                {
                  ref: "ev-verify",
                  kind: "verification",
                  claim: "verified ok",
                  passEvidence: true,
                },
              ],
            },
          ],
        },
      ],
    });
    const result = surface(plan, {});
    const passRows = result.evidenceMergeRows.filter((r) => r.verdict === "PASS");
    expect(passRows.length).toBeGreaterThan(0);
    expect(result.evidenceMergeSummary).toBe("PARTIAL");
    expect(result.summaryText).not.toContain("merge=PASS");
  });

  it("overall evidenceMergeSummary is BLOCKED when bridge has blocked requests", () => {
    const plan = createPlan({
      evidence: [
        {
          ref: "ev-grep-ok",
          kind: "grep_result",
          claim: "found it",
          passEvidence: true,
        },
      ],
      phases: [
        {
          id: "phase-d",
          title: "Blocked request phase",
          status: "running",
          stopPoint: { required: true, confirmationRequired: true, reason: "stop" },
          slices: [
            {
              id: "slice-no-target",
              title: "Missing target",
              role: "explorer",
              status: "queued",
            },
          ],
        },
      ],
    });
    const result = surface(plan);
    expect(result.evidenceMergeSummary).toBe("BLOCKED");
  });

  it("evidence refs are deduplicated by ref+kind+claim across requests", () => {
    const plan = createPlan({
      evidence: [
        {
          ref: "ev-shared",
          kind: "grep_result",
          claim: "shared evidence",
          passEvidence: true,
        },
      ],
      phases: [
        {
          id: "phase-d",
          title: "Dedup phase",
          status: "running",
          stopPoint: { required: true, confirmationRequired: true, reason: "stop" },
          slices: [
            {
              id: "slice-a",
              title: "Slice A",
              role: "explorer",
              status: "queued",
              targetRuntime: { kind: "details", view: "evidence", mutating: false },
              evidence: [
                {
                  ref: "ev-local",
                  kind: "test_result",
                  claim: "local test",
                  passEvidence: true,
                },
              ],
            },
            {
              id: "slice-b",
              title: "Slice B",
              role: "verifier",
              status: "queued",
              targetRuntime: { kind: "verification", level: "typecheck", mutating: false },
              evidence: [
                {
                  ref: "ev-local-b",
                  kind: "command_output",
                  claim: "typecheck output",
                  passEvidence: true,
                },
              ],
            },
          ],
        },
      ],
    });
    const result = surface(plan);
    const sharedRefs = result.evidenceMergeRows.filter((r) => r.ref === "ev-shared");
    expect(sharedRefs).toHaveLength(1);
    expect(result.meta.evidenceCount).toBe(3);
    const evidenceSection = result.detailsText.split("Evidence Merge:")[1] ?? "";
    const sharedLines = evidenceSection.split("\n").filter((l) => l.includes("ev-shared"));
    expect(sharedLines).toHaveLength(1);
  });
});
