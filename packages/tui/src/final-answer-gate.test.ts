import { describe, expect, it } from "vitest";
import type { TuiContext } from "./index.js";
import { evaluateAggregatedFinalAnswerGate } from "./model-stream-runtime.js";
import type { EvidenceRecord } from "./tui-data-types.js";

describe("final-answer-gate artifact freshness integration", () => {
  const now = new Date("2024-01-01T12:00:00.000Z");
  const projectPath = "/workspace/project";

  function createBaseContext(overrides?: Partial<TuiContext>): TuiContext {
    return {
      projectPath,
      sessionId: "session-1",
      currentRequestTurnId: "turn-1",
      evidence: [],
      language: "en-US",
      permissionMode: "default",
      lastMetaSchedulerDecision: {
        policyDecision: {
          engineeringSignal: {
            artifactTargets: ["dist/report.md"],
          },
        },
      },
      ...overrides,
    } as TuiContext;
  }

  function createArtifactEvidence(overrides?: Partial<EvidenceRecord>): EvidenceRecord {
    return {
      id: "evidence-1",
      kind: "command_output",
      summary: "Write dist/report.md",
      source: "Write",
      createdAt: new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
      ownerScope: {
        ownerSessionId: "session-1",
        requestTurnId: "turn-1",
        cwd: projectPath,
      },
      supportsClaims: ["file_write", "artifact_created"],
      data: {
        artifactHint: {
          path: "dist/report.md",
          exists: true,
        },
      },
      ...overrides,
    };
  }

  it("passes when artifact evidence is fresh and matches current request", () => {
    const context = createBaseContext({
      evidence: [createArtifactEvidence()],
    });

    const result = evaluateAggregatedFinalAnswerGate(
      context,
      "LinghunFinalAnswerClaims: completion_claim",
    );

    // Should pass because artifact evidence is fresh, has valid createdAt, and matches owner
    expect(result.status).toBe("passed");
  });

  it("fails when artifact evidence has no createdAt", () => {
    const context = createBaseContext({
      evidence: [
        createArtifactEvidence({
          createdAt: "",
        }),
      ],
    });

    const result = evaluateAggregatedFinalAnswerGate(
      context,
      "LinghunFinalAnswerClaims: completion_claim",
    );

    // Should fail because createdAt is missing
    expect(result.status).toBe("needs_disclaimer");
    if (result.status === "needs_disclaimer") {
      expect(result.unsupportedKinds).toContain("engineering_missing_artifact");
    }
  });

  it("fails when artifact evidence has invalid createdAt", () => {
    const context = createBaseContext({
      evidence: [
        createArtifactEvidence({
          createdAt: "invalid-date-string",
        }),
      ],
    });

    const result = evaluateAggregatedFinalAnswerGate(
      context,
      "LinghunFinalAnswerClaims: completion_claim",
    );

    // Should fail because createdAt is invalid
    expect(result.status).toBe("needs_disclaimer");
    if (result.status === "needs_disclaimer") {
      expect(result.unsupportedKinds).toContain("engineering_missing_artifact");
    }
  });

  it("fails when artifact evidence is stale (older than 30 minutes)", () => {
    const context = createBaseContext({
      evidence: [
        createArtifactEvidence({
          createdAt: new Date(now.getTime() - 40 * 60 * 1000).toISOString(),
        }),
      ],
    });

    const result = evaluateAggregatedFinalAnswerGate(
      context,
      "LinghunFinalAnswerClaims: completion_claim",
    );

    // Should fail because evidence is older than 30 minutes
    expect(result.status).toBe("needs_disclaimer");
    if (result.status === "needs_disclaimer") {
      expect(result.unsupportedKinds).toContain("engineering_missing_artifact");
    }
  });

  it("fails when artifact evidence is from a different requestTurnId", () => {
    const context = createBaseContext({
      evidence: [
        createArtifactEvidence({
          ownerScope: {
            ownerSessionId: "session-1",
            requestTurnId: "turn-OLD",
            cwd: projectPath,
          },
        }),
      ],
    });

    const result = evaluateAggregatedFinalAnswerGate(
      context,
      "LinghunFinalAnswerClaims: completion_claim",
    );

    // Should fail because requestTurnId doesn't match
    expect(result.status).toBe("needs_disclaimer");
    if (result.status === "needs_disclaimer") {
      expect(result.unsupportedKinds).toContain("engineering_missing_artifact");
    }
  });

  it("fails when artifact evidence is from a different session", () => {
    const context = createBaseContext({
      evidence: [
        createArtifactEvidence({
          ownerScope: {
            ownerSessionId: "session-OLD",
            requestTurnId: "turn-1",
            cwd: projectPath,
          },
        }),
      ],
    });

    const result = evaluateAggregatedFinalAnswerGate(
      context,
      "LinghunFinalAnswerClaims: completion_claim",
    );

    // Should fail because sessionId doesn't match
    expect(result.status).toBe("needs_disclaimer");
    if (result.status === "needs_disclaimer") {
      expect(result.unsupportedKinds).toContain("engineering_missing_artifact");
    }
  });

  it("fails when artifact evidence is from an agent", () => {
    const context = createBaseContext({
      evidence: [
        createArtifactEvidence({
          ownerScope: {
            ownerSessionId: "session-1",
            requestTurnId: "turn-1",
            ownerAgentId: "agent-123",
            cwd: projectPath,
          },
        }),
      ],
    });

    const result = evaluateAggregatedFinalAnswerGate(
      context,
      "LinghunFinalAnswerClaims: completion_claim",
    );

    // Should fail because evidence has ownerAgentId
    expect(result.status).toBe("needs_disclaimer");
    if (result.status === "needs_disclaimer") {
      expect(result.unsupportedKinds).toContain("engineering_missing_artifact");
    }
  });

  it("fails when artifact evidence is from a workflow", () => {
    const context = createBaseContext({
      evidence: [
        createArtifactEvidence({
          ownerScope: {
            ownerSessionId: "session-1",
            requestTurnId: "turn-1",
            workflowRunId: "workflow-123",
            cwd: projectPath,
          },
        }),
      ],
    });

    const result = evaluateAggregatedFinalAnswerGate(
      context,
      "LinghunFinalAnswerClaims: completion_claim",
    );

    // Should fail because evidence has workflowRunId
    expect(result.status).toBe("needs_disclaimer");
    if (result.status === "needs_disclaimer") {
      expect(result.unsupportedKinds).toContain("engineering_missing_artifact");
    }
  });

  it("passes when multiple artifacts and at least one is fresh and valid", () => {
    const context = createBaseContext({
      evidence: [
        createArtifactEvidence({
          id: "evidence-stale",
          createdAt: new Date(now.getTime() - 40 * 60 * 1000).toISOString(),
        }),
        createArtifactEvidence({
          id: "evidence-fresh",
          createdAt: new Date(now.getTime() - 5 * 60 * 1000).toISOString(),
        }),
      ],
    });

    const result = evaluateAggregatedFinalAnswerGate(
      context,
      "LinghunFinalAnswerClaims: completion_claim",
    );

    // Should pass because at least one artifact is fresh and valid
    expect(result.status).toBe("passed");
  });

  it("falls back to simple existence check when no currentRequestTurnId", () => {
    const context = createBaseContext({
      currentRequestTurnId: undefined,
      evidence: [
        createArtifactEvidence({
          createdAt: new Date(now.getTime() - 40 * 60 * 1000).toISOString(),
          ownerScope: {
            ownerSessionId: "session-OLD",
            requestTurnId: "turn-OLD",
            cwd: projectPath,
          },
        }),
      ],
    });

    const result = evaluateAggregatedFinalAnswerGate(
      context,
      "LinghunFinalAnswerClaims: completion_claim",
    );

    // Should pass because without currentRequestTurnId, only existence is checked
    expect(result.status).toBe("passed");
  });
});
