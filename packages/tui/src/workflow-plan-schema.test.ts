import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORKFLOW_RUNNING_CAP,
  type WorkflowPlan,
  normalizeWorkflowPlan,
  projectWorkflowPlan,
} from "./workflow-plan-schema.js";

function createValidPlan(overrides: Partial<WorkflowPlan> = {}): WorkflowPlan {
  return {
    id: "wf-14h-b",
    title: "Workflow plan schema",
    source: "manual",
    createdAt: "2026-06-01T10:00:00.000Z",
    permissionMode: "default",
    currentPhaseId: "phase-a",
    budget: { maxTokens: 9000, maxCostCny: 1.5 },
    evidence: [
      {
        ref: "ev-file-1",
        kind: "file_read",
        claim: "schema source was read",
        requiredForPass: true,
        passEvidence: true,
      },
    ],
    phases: [
      {
        id: "phase-a",
        title: "Audit-shaped plan",
        status: "running",
        stopPoint: {
          required: true,
          confirmationRequired: true,
          reason: "Stop after phase-a and wait for user confirmation.",
        },
        slices: [
          {
            id: "slice-a",
            title: "Plan schema",
            role: "planner",
            status: "running",
            allowedToolClasses: ["readonly", "details"],
            targetRuntime: {
              kind: "slash",
              slash: "/job",
              action: "report",
              mutating: false,
            },
            evidence: [
              {
                ref: "ev-grep-1",
                kind: "grep_result",
                claim: "job/report path exists",
                requiredForPass: true,
                passEvidence: true,
              },
            ],
            budget: { maxTokens: 3000, maxDurationMs: 60000 },
            acceptanceCriteria: ["schema validates without executing runtime"],
            nextAction: "Review detailsText projection.",
          },
        ],
      },
    ],
    stopConditions: ["stop at every phase boundary"],
    ...overrides,
  };
}

function expectInvalid(plan: WorkflowPlan): string {
  const result = normalizeWorkflowPlan(plan);
  expect(result.ok).toBe(false);
  return result.ok
    ? ""
    : result.errors.map((error) => `${error.path}: ${error.message}`).join("\n");
}

describe("D.14H-B workflow plan schema", () => {
  it("normalizes a legal workflow plan and generates summary/details/mobile projections", () => {
    const result = normalizeWorkflowPlan(createValidPlan());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.budget.maxRunningAgents).toBe(DEFAULT_WORKFLOW_RUNNING_CAP);
    expect(result.plan.phases[0]?.slices[0]?.allowedToolClasses).toEqual(["readonly", "details"]);

    const projection = projectWorkflowPlan(result.plan);
    expect(projection.surface).toBe("task-summary");
    expect(projection.summary.currentPhase).toBe("Audit-shaped plan");
    expect(projection.summary.agents.running).toBe(1);
    expect(projection.summary.evidenceCount).toBe(2);
    expect(projection.summaryText).toContain("Current phase: Audit-shaped plan");
    expect(projection.detailsText).toContain(
      "phase | slice | role | status | evidence refs | budget | next action",
    );
    expect(projection.mobileSummary).toContain("Agents done/running/blocked: 0/1/0");
  });

  it("validates phase, slice, dependency, role, budget, and stop condition basics", () => {
    const plan = createValidPlan({
      phases: [
        {
          id: "phase-a",
          title: "",
          dependsOnPhaseIds: ["missing-phase"],
          stopPoint: { required: true, confirmationRequired: false, reason: "bad stop" },
          autoAdvance: true,
          budget: { maxTokens: -1 },
          slices: [
            {
              id: "slice-a",
              title: "",
              role: "reviewer" as never,
              dependsOnSliceIds: ["missing-slice"],
              budget: { maxDurationMs: -1 },
              targetRuntime: { kind: "details", view: "evidence", mutating: false },
            },
          ],
        },
      ],
    });

    const errors = expectInvalid(plan);
    expect(errors).toContain("$.phases[0].title");
    expect(errors).toContain("unknown or self phase dependency");
    expect(errors).toContain("stop point");
    expect(errors).toContain("auto-advance is forbidden");
    expect(errors).toContain("unknown agent role");
    expect(errors).toContain("unknown or self slice dependency");
    expect(errors).toContain("budget values must be non-negative");
  });

  it("returns validation errors instead of throwing for malformed phases and slices", () => {
    const malformedPhases = {
      ...createValidPlan(),
      phases: "not-array",
    } as never;
    expect(() => normalizeWorkflowPlan(malformedPhases)).not.toThrow();
    const phaseErrors = normalizeWorkflowPlan(malformedPhases);
    expect(phaseErrors.ok).toBe(false);
    expect(
      phaseErrors.ok ? "" : phaseErrors.errors.map((error) => error.path).join("\n"),
    ).toContain("$.phases");

    const missingSlices = {
      ...createValidPlan(),
      phases: [
        {
          id: "phase-a",
          title: "Missing slices",
          stopPoint: {
            required: true,
            confirmationRequired: true,
            reason: "Stop.",
          },
        },
      ],
    } as never;
    expect(() => normalizeWorkflowPlan(missingSlices)).not.toThrow();
    const missingSliceErrors = normalizeWorkflowPlan(missingSlices);
    expect(missingSliceErrors.ok).toBe(false);
    expect(
      missingSliceErrors.ok
        ? ""
        : missingSliceErrors.errors.map((error) => `${error.path}: ${error.message}`).join("\n"),
    ).toContain("$.phases[0].slices");

    const nonArraySlices = {
      ...createValidPlan(),
      phases: [
        {
          id: "phase-a",
          title: "Bad slices",
          stopPoint: {
            required: true,
            confirmationRequired: true,
            reason: "Stop.",
          },
          slices: "not-array",
        },
      ],
    } as never;
    expect(() => normalizeWorkflowPlan(nonArraySlices)).not.toThrow();
    const nonArraySliceErrors = normalizeWorkflowPlan(nonArraySlices);
    expect(nonArraySliceErrors.ok).toBe(false);
    expect(
      nonArraySliceErrors.ok
        ? ""
        : nonArraySliceErrors.errors.map((error) => `${error.path}: ${error.message}`).join("\n"),
    ).toContain("$.phases[0].slices");
  });

  it("validates top-level and phase budgets independently", () => {
    const plan = createValidPlan({
      budget: { maxTokens: -1, maxRunningAgents: 3 },
      phases: [
        {
          id: "phase-a",
          title: "Bad phase budget",
          budget: { maxTokens: Number.POSITIVE_INFINITY },
          stopPoint: {
            required: true,
            confirmationRequired: true,
            reason: "Stop.",
          },
          slices: [
            {
              id: "slice-a",
              title: "Valid slice budget",
              role: "planner",
              budget: { maxTokens: 1 },
              targetRuntime: { kind: "details", view: "evidence", mutating: false },
            },
          ],
        },
      ],
    });

    const errors = expectInvalid(plan);
    expect(errors).toContain("$.budget.maxTokens");
    expect(errors).toContain("$.phases[0].budget.maxTokens");
    expect(errors).not.toContain("$.phases[0].slices[0].budget.maxTokens");
  });

  it("rejects duplicate phase and slice ids", () => {
    const plan = createValidPlan({
      phases: [
        {
          id: "phase-a",
          title: "Phase A",
          stopPoint: {
            required: true,
            confirmationRequired: true,
            reason: "Stop.",
          },
          slices: [
            {
              id: "slice-a",
              title: "Slice A",
              role: "planner",
              targetRuntime: { kind: "details", view: "evidence", mutating: false },
            },
          ],
        },
        {
          id: "phase-a",
          title: "Phase A duplicate",
          stopPoint: {
            required: true,
            confirmationRequired: true,
            reason: "Stop.",
          },
          slices: [
            {
              id: "slice-a",
              title: "Slice A duplicate",
              role: "explorer",
              targetRuntime: { kind: "details", view: "agent", mutating: false },
            },
          ],
        },
      ],
    });

    const errors = expectInvalid(plan);
    expect(errors).toContain("duplicate phase id: phase-a");
    expect(errors).toContain("duplicate slice id: slice-a");
  });

  it("rejects raw transcript/source/log injection and oversized inline reference summaries", () => {
    const plan = createValidPlan({
      references: [
        {
          kind: "workspace_cache",
          ref: "cache-1",
          summary: "x".repeat(1001),
        },
      ],
    }) as WorkflowPlan & { rawFullTranscript?: string };
    plan.rawFullTranscript = "full transcript should never enter a workflow plan";
    const slice0 = plan.phases[0]?.slices[0];
    if (slice0) {
      plan.phases[0]?.slices.splice(0, 1, {
        ...slice0,
        rawSource: "export const huge = true",
      } as never);
    }

    const errors = expectInvalid(plan);
    expect(errors).toContain("raw transcript/source/log injection is forbidden");
    expect(errors).toContain("reference summary is too large");
  });

  it.each(["failure_learning", "remote_event", "agent_summary", "job_completed"] as const)(
    "rejects %s as PASS evidence",
    (kind) => {
      const plan = createValidPlan({
        evidence: [
          {
            ref: `bad-${kind}`,
            kind,
            claim: "should not prove PASS",
            requiredForPass: true,
            passEvidence: true,
          },
        ],
      });

      const errors = expectInvalid(plan);
      expect(errors).toContain(`${kind} cannot be used as PASS evidence`);
    },
  );

  it("rejects unknown tool classes and untrusted or undiscovered execution proposals", () => {
    const plan = createValidPlan();
    const slice0 = plan.phases[0]?.slices[0];
    if (slice0) {
      slice0.allowedToolClasses = ["shell" as never];
      slice0.toolProposals = [
        {
          toolClass: "mcp-local-stdio",
          toolName: "mcp:server:tool",
          execution: "execute",
          discovered: true,
          trusted: false,
          executable: true,
        },
      ];
    }

    const errors = expectInvalid(plan);
    expect(errors).toContain("unknown tool class: shell");
    expect(errors).toContain("requires discovered=true, trusted=true, and executable=true");
  });

  it("keeps default running cap at 3 and queues excess running slices", () => {
    const slices = Array.from({ length: 5 }, (_, index) => ({
      id: `slice-${index + 1}`,
      title: `Slice ${index + 1}`,
      role: "explorer" as const,
      status: "running" as const,
      targetRuntime: {
        kind: "details" as const,
        view: "evidence" as const,
        mutating: false as const,
      },
    }));
    const result = normalizeWorkflowPlan(
      createValidPlan({
        phases: [
          {
            id: "phase-a",
            title: "Many slices",
            status: "running",
            stopPoint: {
              required: true,
              confirmationRequired: true,
              reason: "Stop before any next phase.",
            },
            slices,
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const statuses = result.plan.phases[0]?.slices.map((slice) => slice.status);
    expect(statuses.filter((status) => status === "running")).toHaveLength(3);
    expect(statuses.slice(3)).toEqual(["queued", "queued"]);
  });

  it("rejects mutating proposals in plan mode", () => {
    const plan = createValidPlan({ permissionMode: "plan" });
    const slice0 = plan.phases[0]?.slices[0];
    if (slice0) {
      slice0.targetRuntime = {
        kind: "slash",
        slash: "/fork",
        role: "worker",
        mutating: true,
      };
    }

    const errors = expectInvalid(plan);
    expect(errors).toContain("plan mode cannot contain mutating execution proposals");
  });

  it("requires every phase to stop and forbids automatic cross-phase execution", () => {
    const plan = createValidPlan({
      phases: [
        {
          id: "phase-a",
          title: "No stop",
          autoAdvance: true,
          stopPoint: { required: false, confirmationRequired: false, reason: "" },
          slices: [
            {
              id: "slice-a",
              title: "No stop slice",
              role: "planner",
              targetRuntime: { kind: "details", view: "job", mutating: false },
            },
          ],
        },
      ],
    });

    const errors = expectInvalid(plan);
    expect(errors).toContain("each phase must have a required stop point");
    expect(errors).toContain("phase auto-advance is forbidden");
  });

  it("redacts mobile-safe summary secrets, absolute paths, and raw detail markers", () => {
    const result = normalizeWorkflowPlan(
      createValidPlan({
        title: "C:\\Users\\Admin\\repo sk-abcdefghijklmnopqrstuvwxyz1234567890 full transcript",
        phases: [
          {
            id: "phase-a",
            title: "/home/admin/project raw source",
            status: "running",
            stopPoint: {
              required: true,
              confirmationRequired: true,
              reason:
                "Review /tmp/project/full.log with api_key=super-secret-value and raw log details",
            },
            slices: [
              {
                id: "slice-a",
                title: "mobile redaction",
                role: "planner",
                status: "running",
                targetRuntime: { kind: "details", view: "evidence", mutating: false },
              },
            ],
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const mobile = projectWorkflowPlan(result.plan).mobileSummary;
    expect(mobile).not.toContain("C:\\Users");
    expect(mobile).not.toContain("/home/admin");
    expect(mobile).not.toContain("/tmp/project");
    expect(mobile).not.toContain("sk-abcdefghijklmnopqrstuvwxyz1234567890");
    expect(mobile).not.toContain("super-secret-value");
    expect(mobile).not.toMatch(/full transcript|raw source|raw log/iu);
  });

  it("does not create an independent dashboard or panel surface", () => {
    const result = normalizeWorkflowPlan(createValidPlan());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const projection = projectWorkflowPlan(result.plan);

    expect(projection.surface).toBe("task-summary");
    expect(
      `${projection.summaryText}\n${projection.detailsText}\n${projection.mobileSummary}`,
    ).not.toMatch(/dashboard|independent panel|standalone panel/iu);
  });

  it("rejects raw command strings in runtime mapping proposals", () => {
    const plan = createValidPlan();
    const slice0 = plan.phases[0]?.slices[0];
    if (slice0) {
      slice0.targetRuntime = {
        kind: "slash",
        slash: "/job",
        action: "run",
        mutating: true,
        rawCommand: "/job run something",
      } as never;
    }

    const errors = expectInvalid(plan);
    expect(errors).toContain("not a raw command string");
  });
});
