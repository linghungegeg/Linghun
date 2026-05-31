import { describe, expect, it } from "vitest";
import {
  type WorkflowBridgeRequestProposal,
  bridgeWorkflowPlanToMainChainRequests,
} from "./workflow-agent-runtime-bridge.js";
import {
  DEFAULT_WORKFLOW_RUNNING_CAP,
  type NormalizedWorkflowPlan,
  type WorkflowPlan,
  normalizeWorkflowPlan,
} from "./workflow-plan-schema.js";

function createPlan(overrides: Partial<WorkflowPlan> = {}): WorkflowPlan {
  return {
    id: "wf-14h-c",
    title: "Workflow bridge",
    source: "manual",
    createdAt: "2026-06-01T12:00:00.000Z",
    permissionMode: "default",
    currentPhaseId: "phase-c",
    references: [
      { kind: "workspace_cache", ref: "cache:workspace-1", summary: "bounded cache" },
      { kind: "file", ref: "packages/tui/src/workflow-plan-schema.ts", summary: "schema file" },
    ],
    evidence: [
      {
        ref: "ev-plan",
        kind: "grep_result",
        claim: "plan schema exists",
        passEvidence: true,
      },
    ],
    phases: [
      {
        id: "phase-c",
        title: "Runtime bridge",
        status: "running",
        stopPoint: {
          required: true,
          confirmationRequired: true,
          reason: "Confirm D.14H-C phase stop before execution proposals.",
        },
        slices: [
          {
            id: "slice-fork",
            title: "Fork worker",
            role: "worker",
            status: "queued",
            targetRuntime: { kind: "slash", slash: "/fork", role: "worker", mutating: true },
            nextAction: "write packages/tui/src/example.ts ok",
            budget: { maxTokens: 1200, maxDurationMs: 30_000 },
            evidence: [
              {
                ref: "ev-agent",
                kind: "agent_summary",
                claim: "agent finished",
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
  if (!result.ok) {
    throw new Error(result.errors.map((error) => error.message).join("\n"));
  }
  return result.plan;
}

function bridge(
  plan: WorkflowPlan,
  options: Parameters<typeof bridgeWorkflowPlanToMainChainRequests>[1] = {
    confirmedPhaseStopPoints: ["phase-c"],
  },
) {
  return bridgeWorkflowPlanToMainChainRequests(normalize(plan), options);
}

function requestBySlice(
  requests: WorkflowBridgeRequestProposal[],
  sliceId: string,
): WorkflowBridgeRequestProposal {
  const request = requests.find((item) => item.sliceId === sliceId);
  expect(request).toBeDefined();
  if (!request) throw new Error(`missing request for ${sliceId}`);
  return request;
}

describe("D.14H-C workflow agent runtime bridge", () => {
  it("converts eligible queued current-phase slices into structured /fork and /job proposals", () => {
    const result = bridge(
      createPlan({
        phases: [
          {
            id: "phase-c",
            title: "Runtime bridge",
            status: "running",
            stopPoint: {
              required: true,
              confirmationRequired: true,
              reason: "Confirm.",
            },
            slices: [
              {
                id: "slice-fork",
                title: "Fork worker",
                role: "worker",
                status: "queued",
                targetRuntime: { kind: "slash", slash: "/fork", role: "worker", mutating: true },
                nextAction: "write packages/tui/src/example.ts ok",
              },
              {
                id: "slice-job",
                title: "Create job",
                role: "planner",
                status: "created",
                targetRuntime: { kind: "slash", slash: "/job", action: "create", mutating: true },
                nextAction: "Create durable job for bridge checks.",
              },
            ],
          },
        ],
      }),
    );

    const fork = requestBySlice(result.requests, "slice-fork");
    expect(fork.status).toBe("runnable");
    expect(fork.executable).toBe(true);
    expect(fork.proposalOnly).toBe(true);
    expect(fork.request).toMatchObject({
      mainChain: "fork",
      role: "worker",
      task: "write packages/tui/src/example.ts ok",
    });
    expect("command" in (fork.request as object)).toBe(false);
    expect(fork.backgroundProjection.backgroundStatus).toBeUndefined();
    expect(fork.backgroundProjection.jobAgentStatus).toBe("queued");
    expect(fork.backgroundProjection.nextAction).toBe("write packages/tui/src/example.ts ok");

    const job = requestBySlice(result.requests, "slice-job");
    expect(job.request).toMatchObject({ mainChain: "job", action: "create" });
    expect(result.summary.runnable).toBe(2);
  });

  it("blocks dependency-unsatisfied slices without creating runnable requests", () => {
    const result = bridge(
      createPlan({
        phases: [
          {
            id: "phase-c",
            title: "Runtime bridge",
            status: "running",
            stopPoint: {
              required: true,
              confirmationRequired: true,
              reason: "Confirm.",
            },
            slices: [
              {
                id: "slice-a",
                title: "Dependency",
                role: "explorer",
                status: "queued",
                targetRuntime: { kind: "details", view: "evidence", mutating: false },
              },
              {
                id: "slice-b",
                title: "Blocked worker",
                role: "worker",
                status: "queued",
                dependsOnSliceIds: ["slice-a"],
                targetRuntime: { kind: "slash", slash: "/fork", role: "worker", mutating: true },
              },
            ],
          },
        ],
      }),
    );

    const blocked = requestBySlice(result.requests, "slice-b");
    expect(blocked.status).toBe("blocked");
    expect(blocked.executable).toBe(false);
    expect(blocked.request).toBeNull();
    expect(blocked.reason).toContain("slice dependency not satisfied");
  });

  it("keeps the default running cap at 3 and queues excess mutating proposals", () => {
    const slices = Array.from({ length: 4 }, (_, index) => ({
      id: `slice-${index + 1}`,
      title: `Slice ${index + 1}`,
      role: "worker" as const,
      status: "queued" as const,
      targetRuntime: {
        kind: "slash" as const,
        slash: "/fork" as const,
        role: "worker" as const,
        mutating: true,
      },
    }));
    const result = bridge(
      createPlan({
        phases: [
          {
            id: "phase-c",
            title: "Runtime bridge",
            status: "running",
            stopPoint: {
              required: true,
              confirmationRequired: true,
              reason: "Confirm.",
            },
            slices,
          },
        ],
      }),
    );

    expect(result.runningCap).toBe(DEFAULT_WORKFLOW_RUNNING_CAP);
    expect(result.summary.runnable).toBe(3);
    expect(result.summary.queued).toBe(1);
    expect(requestBySlice(result.requests, "slice-4").reason).toContain("running cap 3 reached");
  });

  it("requires confirmed phase stopPoint before mutating proposals become runnable", () => {
    const result = bridge(createPlan(), { confirmedPhaseStopPoints: [] });
    const proposal = requestBySlice(result.requests, "slice-fork");

    expect(proposal.status).toBe("start_gate_needed");
    expect(proposal.executable).toBe(false);
    expect(proposal.request).toMatchObject({ mainChain: "fork" });
    expect(proposal.startGateProposal).toMatchObject({
      kind: "start-gate-proposal",
      requiresExactConfirmation: true,
      doesNotReplacePermissionPipeline: true,
    });
  });

  it("does not generate executable mutating proposals in plan mode", () => {
    const plan = normalize(createPlan());
    const forcedPlanMode = { ...plan, permissionMode: "plan" as const };
    const result = bridgeWorkflowPlanToMainChainRequests(forcedPlanMode, {
      confirmedPhaseStopPoints: ["phase-c"],
    });
    const proposal = requestBySlice(result.requests, "slice-fork");

    expect(proposal.status).toBe("blocked");
    expect(proposal.executable).toBe(false);
    expect(proposal.reason).toContain("plan mode");
  });

  it("allows readonly targets as readonly proposals without start gate", () => {
    const result = bridge(
      createPlan({
        phases: [
          {
            id: "phase-c",
            title: "Runtime bridge",
            status: "running",
            stopPoint: {
              required: true,
              confirmationRequired: true,
              reason: "Confirm.",
            },
            slices: [
              {
                id: "slice-agents",
                title: "List agents",
                role: "explorer",
                status: "queued",
                targetRuntime: { kind: "slash", slash: "/agents", action: "list", mutating: false },
              },
              {
                id: "slice-details",
                title: "Show evidence",
                role: "planner",
                status: "sleeping",
                targetRuntime: { kind: "details", view: "evidence", mutating: false },
              },
            ],
          },
        ],
      }),
      { confirmedPhaseStopPoints: [] },
    );

    const agents = requestBySlice(result.requests, "slice-agents");
    expect(agents.status).toBe("readonly");
    expect(agents.proposalOnly).toBe(true);
    expect(agents.safety).toMatchObject({
      readonly: true,
      requiresStartGate: false,
      requiresPermissionPipeline: false,
      requiredPermissionAction: "none",
    });
    expect(agents.startGateProposal).toBeUndefined();
    expect(agents.backgroundProjection.backgroundStatus).toBeUndefined();
    expect(agents.backgroundProjection.jobAgentStatus).toBe("queued");
    expect(agents.backgroundProjection.nextAction).toBe(
      "Hand this proposal to the existing main-chain dispatcher.",
    );
    expect(requestBySlice(result.requests, "slice-details").request).toMatchObject({
      mainChain: "details",
      view: "evidence",
    });
  });

  it("rejects raw command strings even if they are forced into a normalized plan", () => {
    const plan = normalize(createPlan());
    const slice0 = plan.phases[0]?.slices[0];
    if (slice0) {
      slice0.targetRuntime = {
        kind: "slash",
        slash: "/job",
        action: "run",
        mutating: true,
        rawCommand: "/job run do-not-execute",
      } as never;
    }

    const result = bridgeWorkflowPlanToMainChainRequests(plan, {
      confirmedPhaseStopPoints: ["phase-c"],
    });
    const proposal = requestBySlice(result.requests, "slice-fork");

    expect(proposal.status).toBe("blocked");
    expect(proposal.request).toBeNull();
    expect(proposal.reason).toContain("raw command strings are rejected");
  });

  it("marks permission pipeline, required action, and conservative evidence policy", () => {
    const proposal = requestBySlice(bridge(createPlan()).requests, "slice-fork");

    expect(proposal.safety).toMatchObject({
      readonly: false,
      mutating: true,
      requiresStartGate: true,
      requiresPermissionPipeline: true,
      requiredPermissionAction: "Write",
      evidencePolicy: "neverTreatCompletionAsPass",
    });
    expect(proposal.permissionProposal).toMatchObject({
      via: "decidePermission-or-pendingLocalApproval",
      bypassed: false,
    });
  });

  it("keeps handoff/context refs bounded and excludes full transcript/source/log/index refs", () => {
    const result = bridge(
      createPlan({
        references: [
          { kind: "workspace_cache", ref: "cache:workspace", summary: "x".repeat(500) },
          { kind: "file", ref: "packages/tui/src/index.ts", summary: "key file" },
          { kind: "transcript", ref: "transcript:full", summary: "should be dropped" },
          { kind: "log", ref: "log:full", summary: "should be dropped" },
          { kind: "index", ref: "index:full", summary: "should be dropped" },
        ],
      }),
    );
    const refs = requestBySlice(result.requests, "slice-fork").handoffProposal;

    expect(refs.workspaceCacheRefs).toEqual(["cache:workspace"]);
    expect(refs.keyFilesSummary).toEqual(["key file"]);
    expect(refs.droppedRefKinds).toEqual(["transcript", "log", "index"]);
    expect(refs.notIncluded.join(" ")).toContain("full transcript");
    expect(JSON.stringify(refs)).not.toContain("should be dropped");
    expect(refs.boundedRefs[0]?.summary?.length).toBeLessThanOrEqual(300);
  });

  it("does not allow agent or job completion evidence to become PASS evidence", () => {
    const proposal = requestBySlice(bridge(createPlan()).requests, "slice-fork");
    const completionEvidence = proposal.handoffProposal.evidenceRefs.find(
      (item) => item.kind === "agent_summary",
    );

    expect(completionEvidence).toMatchObject({ passEvidenceAllowed: false });
    expect(proposal.backgroundProjection.jobAgentStatus).toBe("queued");
    expect(proposal.backgroundProjection).not.toMatchObject({ result: "pass" });
  });

  it("does not allow remote event or failure learning evidence to become PASS evidence", () => {
    const plan = normalize(
      createPlan({
        evidence: [
          {
            ref: "ev-remote",
            kind: "remote_event",
            claim: "remote notification was sent",
            passEvidence: false,
          },
          {
            ref: "ev-learning",
            kind: "failure_learning",
            claim: "failure learning captured a risk",
            passEvidence: false,
          },
        ],
      }),
    );
    plan.evidence = plan.evidence?.map((item) => ({ ...item, passEvidence: true }));
    const result = bridgeWorkflowPlanToMainChainRequests(plan, {
      confirmedPhaseStopPoints: ["phase-c"],
    });
    const evidence = requestBySlice(result.requests, "slice-fork").handoffProposal.evidenceRefs;

    expect(evidence.find((item) => item.kind === "remote_event")).toMatchObject({
      passEvidenceAllowed: false,
    });
    expect(evidence.find((item) => item.kind === "failure_learning")).toMatchObject({
      passEvidenceAllowed: false,
    });
  });

  it("does not create independent dashboard or panel source fields", () => {
    const serialized = JSON.stringify(bridge(createPlan()));
    expect(serialized).not.toMatch(/dashboard|independent panel|standalone panel|panelSource/iu);
  });

  it("does not expose provider env key or model route mutation fields", () => {
    const serialized = JSON.stringify(bridge(createPlan()));
    expect(serialized).not.toMatch(
      /providerEnv|apiKey|baseUrl|modelRoute|modelRoutes|routeChange/iu,
    );
    expect(serialized).toContain("provider/env/key/model route changes");
  });
});
