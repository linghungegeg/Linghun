import { describe, expect, it } from "vitest";
import { evaluateMetaScheduler } from "./meta-scheduler-runtime.js";
import type { EvidenceRecord, FailureLearningState } from "./tui-data-types.js";
import { evaluateUserStateSignal } from "./user-state-signal-runtime.js";

describe("user-state signal runtime", () => {
  it("classifies frustration from repeated runtime failures without text phrasing", () => {
    const signal = evaluateUserStateSignal({
      userText: "继续处理这个问题",
      repeatedFailureCount: 2,
      events: [{ kind: "tool_failure", summary: "Bash exited 1" }],
    });

    expect(signal.decision.kind).toBe("frustrated");
    expect(signal.decision.verificationPlan).toMatchObject({
      strength: "strengthened",
      requireSourceFacts: true,
      forbidEarlyPass: true,
    });
    expect(signal.evidence.map((item) => item.type)).toContain("repeated_failure");
  });

  it("does not treat wording-only frustration as a mature signal", () => {
    const signal = evaluateUserStateSignal({
      userText: "这个设计太离谱了，但先聊聊看法",
    });

    expect(signal.decision.kind).toBe("neutral");
    expect(signal.evidence).toContainEqual(
      expect.objectContaining({ type: "text_hint", weight: 0.42 }),
    );
  });

  it("honors dismiss, cooldown, policy disabled, and busy panel suppression", () => {
    const nowMs = 1000;
    expect(
      evaluateUserStateSignal({
        userText: "继续",
        repeatedFailureCount: 3,
        dismissedUntilMs: 2000,
        nowMs,
      }).suppressedReason,
    ).toBe("dismissed");
    expect(
      evaluateUserStateSignal({
        userText: "继续",
        repeatedFailureCount: 3,
        cooldownUntilMs: 2000,
        nowMs,
      }).suppressedReason,
    ).toBe("cooldown");
    expect(
      evaluateUserStateSignal({
        userText: "继续",
        repeatedFailureCount: 3,
        policyEnabled: false,
      }).suppressedReason,
    ).toBe("policy_disabled");
    expect(
      evaluateUserStateSignal({
        userText: "继续",
        repeatedFailureCount: 3,
        otherPanelOpen: true,
      }).suppressedReason,
    ).toBe("busy_surface");
  });

  it("feeds typed user-state decisions into meta scheduler verification plan", () => {
    const decision = evaluateMetaScheduler({
      language: "en-US",
      userText: "继续处理，不要直接说完成",
      index: { enabled: true, status: "ready", projectName: "F-Linghun" },
      evidence: [] as EvidenceRecord[],
      failureLearning: failureLearning(2),
      backgroundTasks: [],
      lastVerificationStatus: "fail",
    });

    expect(decision.policyDecision.userState.kind).toBe("frustrated");
    expect(decision.policyDecision.verificationSignal.route.commands).toEqual(
      expect.arrayContaining(["source-facts", "focused-test"]),
    );
    expect(decision.policyDecision.verificationSignal.route.noPassReasons).toContain(
      "user_state:frustrated",
    );
  });

  it("keeps other panels from surfacing user-state notification pressure", () => {
    const decision = evaluateMetaScheduler({
      language: "en-US",
      userText: "继续处理",
      index: { enabled: true, status: "ready", projectName: "F-Linghun" },
      evidence: [] as EvidenceRecord[],
      failureLearning: failureLearning(3),
      backgroundTasks: [],
      otherPanelOpen: true,
    });

    expect(decision.policyDecision.userState.kind).toBe("neutral");
    expect(decision.policyDecision.userState.notificationPlan.quiet).toBe(false);
  });
});

function failureLearning(count: number): FailureLearningState {
  return {
    directory: ".linghun/failures",
    projectScope: "F-Linghun",
    degradedWarnings: [],
    records: Array.from({ length: count }, (_, index) => ({
      id: `failure-${index}`,
      createdAt: "2026-06-07T00:00:00.000Z",
      lastSeen: "2026-06-07T00:00:00.000Z",
      projectScope: "F-Linghun",
      sourceRef: "test",
      category: "tool_failure" as const,
      failureSummary: "tool failed",
      rootCauseGuess: "unknown",
      inferred: true,
      avoidNextTime: "verify",
      severity: "medium" as const,
      dedupeHash: `hash-${index}`,
      count: 1,
      status: "active" as const,
    })),
  };
}
