import { describe, expect, it } from "vitest";
import {
  createToolBatchFailFastSkippedResult,
  evaluateAggregatedFinalAnswerGate,
  isToolBatchFailure,
} from "./model-stream-runtime.js";

function withClaims(text: string, claims: Array<{ kind: string; phrase: string }>): string {
  return `${text}\nLinghunFinalAnswerClaims: ${JSON.stringify({ claims })}`;
}

function makeGateContext() {
  return {
    evidence: [],
    currentArchitectureCard: undefined,
    solutionCompleteness: {
      triggered: false,
      classificationRequired: true,
      classification: "systemic_gap",
      impactAreas: [],
      severity: "unknown",
    },
  };
}

describe("tool batch fail-fast helpers", () => {
  it("counts failed tool results as failures even when they carry evidence", () => {
    expect(isToolBatchFailure({ ok: false, evidenceId: "evidence-1" } as never)).toBe(true);
    expect(isToolBatchFailure({ ok: true, evidenceId: "evidence-1" } as never)).toBe(false);
  });

  it("creates skipped tool result with the original tool call id handled by caller", () => {
    const skipped = createToolBatchFailFastSkippedResult(
      { id: "call-4", name: "Read", input: { file_path: "x.ts" } },
      "Read failed",
    );

    expect(skipped).toMatchObject({
      ok: false,
      tool: "Read",
      data: { skipped: true, reason: "tool_batch_fail_fast", lastFailure: "Read failed" },
    });
  });
});

describe("final answer gate aggregation", () => {
  it("aggregates claim gate and extended gate issues in one verdict", () => {
    const result = evaluateAggregatedFinalAnswerGate(
      makeGateContext() as never,
      withClaims("测试通过，架构已闭合。", [
        { kind: "completion_pass", phrase: "测试通过" },
        { kind: "completeness", phrase: "架构已闭合" },
      ]),
    );

    expect(result.status).toBe("needs_disclaimer");
    if (result.status !== "needs_disclaimer") return;
    expect(result.claimVerdict?.unsupportedKinds).toContain("completion_pass");
    expect(result.extendedVerdict?.unsupportedKinds).toContain("completeness");
    expect(result.unsupportedKinds).toEqual(
      expect.arrayContaining(["completion_pass", "completeness"]),
    );
  });

  it("can skip the extended gate when the scheduler disables it", () => {
    const result = evaluateAggregatedFinalAnswerGate(
      makeGateContext() as never,
      withClaims("架构已闭合。", [{ kind: "completeness", phrase: "架构已闭合" }]),
      false,
    );

    expect(result.status).toBe("passed");
  });
});
