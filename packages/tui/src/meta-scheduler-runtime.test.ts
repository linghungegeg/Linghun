import { describe, expect, it } from "vitest";
import type { ModelMessage } from "@linghun/providers";
import { sanitizeMainScreenLeakage } from "./model-prompt-runtime.js";
import {
  evaluateMetaScheduler,
  formatMetaSchedulerDirective,
} from "./meta-scheduler-runtime.js";
import type {
  BackgroundTaskState,
  EvidenceRecord,
  FailureLearningState,
  WorkflowState,
} from "./tui-data-types.js";
import type { IndexState } from "./index-runtime.js";

describe("Meta scheduler runtime", () => {
  it("requires verifier/final-answer gate for high-risk completion claims without PASS evidence", () => {
    const decision = evaluateMetaScheduler({
      ...baseInput(),
      assistantText: "All fixed. PASS.",
    });

    expect(decision.shouldRunFinalAnswerGate).toBe(true);
    expect(decision.shouldPreferVerifier).toBe(true);
    expect(formatMetaSchedulerDirective(decision)).toContain("final-answer-gate");
  });

  it("does not let tool failures become fake completion", () => {
    const decision = evaluateMetaScheduler({
      ...baseInput(),
      lastToolFailure: { toolName: "Bash", summary: "exit code 1" },
    });

    expect(decision.shouldCaptureFailureLearning).toBe(true);
    expect(decision.shouldUseRetryGuard).toBe(true);
    expect(decision.directives.join("\n")).toContain("failed turn");
  });

  it("routes oversized context through compact/artifact before provider pressure gets raw objects", () => {
    const messages: ModelMessage[] = [
      { role: "system", content: "system" },
      { role: "user", content: "x".repeat(200) },
    ];
    const decision = evaluateMetaScheduler({
      ...baseInput(),
      messages,
      contextMaxChars: 180,
      triggerChars: 120,
    });

    expect(decision.shouldCompactBeforeProvider).toBe(true);
    expect(decision.internalEvents).toContain("meta_scheduler:compact_required");
  });

  it.each([
    ["ready", "ready"],
    ["stale", "stale"],
    ["unknown-project", "unknown-project"],
    ["disabled", "disabled"],
  ] as const)("distinguishes index state %s", (status, expected) => {
    const decision = evaluateMetaScheduler({
      ...baseInput(),
      index: { ...baseIndex(), enabled: status !== "disabled", status },
    });

    expect(decision.indexStrategy).toBe(expected);
  });

  it("stops PASS when agent or workflow runtime is blocked", () => {
    const backgroundTasks: BackgroundTaskState[] = [
      {
        id: "agent-1",
        kind: "agent",
        title: "agent",
        status: "stale",
        startedAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        heartbeatIntervalMs: 1000,
        staleAfterMs: 1000,
        hasOutput: false,
        userVisibleSummary: "stale agent",
        result: "stale",
      },
    ];
    const workflow: NonNullable<WorkflowState["activeRun"]> = {
      id: "wf-1",
      goal: "ship",
      planId: "plan-1",
      status: "blocked",
      steps: [],
      startedAt: new Date(0).toISOString(),
      result: "blocked",
    };
    const decision = evaluateMetaScheduler({
      ...baseInput(),
      backgroundTasks,
      workflow,
    });

    expect(decision.shouldStopForBlockedRuntime).toBe(true);
    expect(decision.internalEvents).toContain("meta_scheduler:blocked_runtime_stop");
  });

  it("keeps runtime internals off the main screen", () => {
    const sanitized = sanitizeMainScreenLeakage(
      "RuntimeStatusForModel={x}\ngateId=abc\nraw evidence: {}\nFinal answer.",
      "en-US",
    );

    expect(sanitized).not.toContain("RuntimeStatusForModel");
    expect(sanitized).not.toContain("gateId");
    expect(sanitized).not.toContain("raw evidence");
    expect(sanitized).toContain("Final answer.");
  });
});

function baseInput() {
  return {
    language: "en-US" as const,
    userText: "finish the task",
    index: baseIndex(),
    evidence: [] as EvidenceRecord[],
    failureLearning: baseFailureLearning(),
    backgroundTasks: [] as BackgroundTaskState[],
  };
}

function baseIndex(): IndexState {
  return { enabled: true, status: "ready", projectName: "F-Linghun" };
}

function baseFailureLearning(): FailureLearningState {
  return {
    directory: ".linghun/failures",
    projectScope: "F-Linghun",
    records: [],
    degradedWarnings: [],
  };
}
