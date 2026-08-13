import { describe, expect, it } from "vitest";
import type { TuiContext } from "./index.js";
import {
  createPhase15BetaVerdictScope,
  runArchitectureAndCompletenessFinalGate,
} from "./final-answer-gate.js";
import { createSolutionCompletenessStatus } from "./model-loop-runtime.js";
import { evaluateAggregatedFinalAnswerGate } from "./model-stream-runtime.js";
import type { EvidenceRecord } from "./tui-data-types.js";

function withClaims(text: string, claims: Array<{ kind: string; phrase: string }>): string {
  return `${text}\nLinghunFinalAnswerClaims: ${JSON.stringify({ claims })}`;
}

describe("final-answer-gate artifact freshness integration", () => {
  const now = new Date();
  const projectPath = "/workspace/project";

  function createBaseContext(overrides?: Partial<TuiContext>): TuiContext {
    return {
      projectPath,
      sessionId: "session-1",
      currentRequestTurnId: "turn-1",
      evidence: [],
      language: "en-US",
      permissionMode: "default",
      solutionCompleteness: createSolutionCompletenessStatus(),
      lastMetaSchedulerDecision: {
        policyDecision: {
          engineeringSignal: {
            artifactTargets: ["dist/report.md"],
            failureCategory: "missing_artifact",
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
      supportsClaims: ["file_write", "artifact_created", "Write", "file_written"],
      data: {
        artifactHint: {
          path: "dist/report.md",
          exists: true,
        },
      },
      ...overrides,
    };
  }

  it("passes when file change evidence is fresh and matches current request", () => {
    const context = createBaseContext({
      evidence: [createArtifactEvidence()],
    });

    const result = evaluateAggregatedFinalAnswerGate(
      context,
      withClaims("已修改 dist/report.md。", [
        { kind: "file_change_claim", phrase: "dist/report.md" },
      ]),
    );

    // Should pass because artifact evidence is fresh, has valid createdAt, and matches owner
    expect(result.status).toBe("passed");
  });

  it("does not reject current-owner file change evidence because createdAt is absent", () => {
    const context = createBaseContext({
      evidence: [
        createArtifactEvidence({
          createdAt: "",
        }),
      ],
    });

    const result = evaluateAggregatedFinalAnswerGate(
      context,
      withClaims("已修改 dist/report.md。", [
        { kind: "file_change_claim", phrase: "dist/report.md" },
      ]),
    );

    expect(result.status).toBe("passed");
  });

  it("does not reject current-owner file change evidence because createdAt is invalid", () => {
    const context = createBaseContext({
      evidence: [
        createArtifactEvidence({
          createdAt: "invalid-date-string",
        }),
      ],
    });

    const result = evaluateAggregatedFinalAnswerGate(
      context,
      withClaims("已修改 dist/report.md。", [
        { kind: "file_change_claim", phrase: "dist/report.md" },
      ]),
    );

    expect(result.status).toBe("passed");
  });

  it("keeps current-owner file change evidence valid past the former wall-clock TTL", () => {
    const context = createBaseContext({
      evidence: [
        createArtifactEvidence({
          createdAt: new Date(now.getTime() - 40 * 60 * 1000).toISOString(),
        }),
      ],
    });

    const result = evaluateAggregatedFinalAnswerGate(
      context,
      withClaims("已修改 dist/report.md。", [
        { kind: "file_change_claim", phrase: "dist/report.md" },
      ]),
    );

    expect(result.status).toBe("passed");
  });

  it("fails when file change evidence is from a different requestTurnId", () => {
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
      withClaims("已修改 dist/report.md。", [
        { kind: "file_change_claim", phrase: "dist/report.md" },
      ]),
    );

    // Should fail because requestTurnId doesn't match
    expect(result.status).toBe("needs_disclaimer");
    if (result.status === "needs_disclaimer") {
      expect(result.unsupportedKinds).toContain("engineering_missing_artifact");
    }
  });

  it("fails when file change evidence is from a different session", () => {
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
      withClaims("已修改 dist/report.md。", [
        { kind: "file_change_claim", phrase: "dist/report.md" },
      ]),
    );

    // Should fail because sessionId doesn't match
    expect(result.status).toBe("needs_disclaimer");
    if (result.status === "needs_disclaimer") {
      expect(result.unsupportedKinds).toContain("engineering_missing_artifact");
    }
  });

  it("fails when file change evidence is from an agent", () => {
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
      withClaims("已修改 dist/report.md。", [
        { kind: "file_change_claim", phrase: "dist/report.md" },
      ]),
    );

    // Should fail because evidence has ownerAgentId
    expect(result.status).toBe("needs_disclaimer");
    if (result.status === "needs_disclaimer") {
      expect(result.unsupportedKinds).toContain("engineering_missing_artifact");
    }
  });

  it("fails when file change evidence is from a workflow", () => {
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
      withClaims("已修改 dist/report.md。", [
        { kind: "file_change_claim", phrase: "dist/report.md" },
      ]),
    );

    // Should fail because evidence has workflowRunId
    expect(result.status).toBe("needs_disclaimer");
    if (result.status === "needs_disclaimer") {
      expect(result.unsupportedKinds).toContain("engineering_missing_artifact");
    }
  });

  it("passes when multiple file change artifacts and at least one is fresh and valid", () => {
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
      withClaims("已修改 dist/report.md。", [
        { kind: "file_change_claim", phrase: "dist/report.md" },
      ]),
    );

    // Should pass because at least one artifact is fresh and valid
    expect(result.status).toBe("passed");
  });

  it("fails closed when no current request owner exists", () => {
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
      withClaims("已修改 dist/report.md。", [
        { kind: "file_change_claim", phrase: "dist/report.md" },
      ]),
    );

    expect(result.status).toBe("needs_disclaimer");
    if (result.status === "needs_disclaimer") {
      expect(result.unsupportedKinds).toContain("engineering_missing_artifact");
    }
  });
});

describe("Beta readiness typed evidence", () => {
  function betaEvidence(
    id: string,
    role: string,
    status: string,
    provider?: string,
    summary = "untrusted text says every legacy PASS phrase",
  ): EvidenceRecord {
    return {
      id,
      kind: "command_output",
      source: "untrusted-source",
      summary,
      supportsClaims: ["real TUI report pass", "DeepSeek dual-provider PASS"],
      createdAt: new Date().toISOString(),
      data: { betaEvidence: { role, status, ...(provider ? { provider } : {}) } },
    };
  }

  it("does not treat legacy wording as Beta readiness evidence", () => {
    const verdict = createPhase15BetaVerdictScope([
      betaEvidence(
        "legacy",
        "unknown",
        "pass",
        undefined,
        "real TUI report pass; DeepSeek dual-provider PASS; final answer report",
      ),
    ]);

    expect(verdict.status).toBe("PARTIAL");
    expect(verdict.evidenceRefs).toEqual([]);
  });

  it("accepts only explicit typed Beta evidence for every required fact", () => {
    const verdict = createPhase15BetaVerdictScope([
      betaEvidence("real-tui", "real_tui_report_generation", "pass"),
      betaEvidence("deepseek", "provider_report", "pass", "deepseek"),
      betaEvidence("openai", "provider_report", "pass", "openai-compatible"),
      betaEvidence("write", "report_write", "pass"),
      betaEvidence("reference", "final_answer_report_reference", "pass"),
    ]);

    expect(verdict.status).toBe("PASS");
    expect(verdict.evidenceRefs).toEqual([
      "real-tui",
      "deepseek",
      "openai",
      "write",
      "reference",
    ]);
  });

  it.each(["partial", "skipped", "blocked"])(
    "keeps Beta readiness partial for typed %s evidence",
    (status) => {
      const verdict = createPhase15BetaVerdictScope([
        betaEvidence("real-tui", "real_tui_report_generation", "pass"),
        betaEvidence("deepseek", "provider_report", "pass", "deepseek"),
        betaEvidence("openai", "provider_report", "pass", "openai-compatible"),
        betaEvidence("write", "report_write", "pass"),
        betaEvidence("reference", "final_answer_report_reference", "pass"),
        betaEvidence("blocked", "provider_report", status, "deepseek"),
      ]);

      expect(verdict.status).toBe("PARTIAL");
      expect(verdict.uncoveredItems).toContain(
        "blocking gate evidence still contains SKIPPED, PARTIAL, or BLOCKED",
      );
    },
  );
});

describe("architecture runtime candidate boundary", () => {
  it("does not let a pending candidate satisfy the architecture boundary contract", () => {
    const context = {
      currentArchitectureCard: {
        target: "cross-module change",
        projectFacts: [],
        recommendedApproach: "minimal",
        rejectedApproaches: [],
        stagedBreakdown: [],
        risks: [],
        verification: [],
        nonGoals: [],
      },
      evidence: [
        {
          id: "architecture-candidate",
          kind: "command_output",
          source: "architecture-runtime:v1",
          summary: "candidate",
          supportsClaims: ["architecture_runtime"],
          createdAt: new Date().toISOString(),
        },
      ],
      solutionCompleteness: createSolutionCompletenessStatus(),
      lastMetaSchedulerDecision: {
        policyDecision: {
          architectureSignal: {
            candidate: true,
            cardPresent: true,
            guardReminder: false,
            driftPending: false,
            actualImpact: { status: "pending", files: [] },
          },
        },
      },
    } as unknown as TuiContext;

    const result = runArchitectureAndCompletenessFinalGate(
      context,
      'LinghunFinalAnswerClaims: {"claims":[{"kind":"architecture_boundary","phrase":"架构已闭合"}]}',
    );

    expect(result.status).toBe("needs_disclaimer");
  });
});
