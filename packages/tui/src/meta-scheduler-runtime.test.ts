import type { ModelMessage } from "@linghun/providers";
import { describe, expect, it } from "vitest";
import type { IndexState } from "./index-runtime.js";
import {
  evaluateMetaScheduler,
  formatMetaSchedulerDirective,
  verifyFailureLearningContract,
} from "./meta-scheduler-runtime.js";
import { sanitizeMainScreenLeakage } from "./model-prompt-runtime.js";
import type {
  BackgroundTaskState,
  EvidenceRecord,
  FailureLearningState,
  WorkflowState,
} from "./tui-data-types.js";

describe("Meta scheduler runtime", () => {
  it("requires verifier/final-answer gate for high-risk completion claims without PASS evidence", () => {
    const decision = evaluateMetaScheduler({
      ...baseInput(),
      assistantText: "All fixed. PASS.",
    });

    expect(decision.shouldRunFinalAnswerGate).toBe(true);
    expect(decision.shouldPreferVerifier).toBe(true);
    expect(decision.policyDecision.riskLevel).toBe("high");
    expect(decision.policyDecision.executionPlan.requireFinalGate).toBe(true);
    expect(decision.policyDecision.executionPlan.requireVerification).toBe(true);
    expect(formatMetaSchedulerDirective(decision)).toContain("final-answer-gate");
  });

  it("does not treat user questions about completion as assistant high-risk claims", () => {
    const decision = evaluateMetaScheduler({
      ...baseInput(),
      userText: "请核对是否已完成，没验证通过就不要说 PASS。",
    });

    expect(decision.shouldRunFinalAnswerGate).toBe(false);
    expect(decision.shouldPreferVerifier).toBe(false);
    expect(decision.policyDecision.riskLevel).toBe("low");
    expect(decision.policyDecision.executionPlan.requireFinalGate).toBe(false);
  });

  it("does not let tool failures become fake completion", () => {
    const decision = evaluateMetaScheduler({
      ...baseInput(),
      lastToolFailure: { toolName: "Bash", summary: "exit code 1" },
    });

    expect(decision.shouldCaptureFailureLearning).toBe(true);
    expect(decision.shouldUseRetryGuard).toBe(true);
    expect(decision.policyDecision.contextPlan.includeFailureLearning).toBe(false);
    expect(decision.policyDecision.hints.some((hint) => hint.id === "failure-learning")).toBe(true);
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
    expect(decision.policyDecision.contextPlan.compactBeforeProvider).toBe(true);
    expect(
      decision.policyDecision.hints.some((hint) => hint.id === "compact-before-provider"),
    ).toBe(true);
    expect(decision.internalEvents).toContain("meta_scheduler:compact_required");
  });

  it("creates source-first typed policy for code fact requests with bilingual hints", () => {
    const decision = evaluateMetaScheduler({
      ...baseInput(),
      language: "zh-CN",
      userText: "先读源码确认 model-stream-runtime.ts 的调用链",
    });

    expect(decision.policyDecision.taskKind).toBe("code_fact");
    expect(decision.policyDecision.executionPlan.preferSourceFirst).toBe(true);
    const sourceHint = decision.policyDecision.hints.find((hint) => hint.id === "source-first");
    expect(sourceHint?.text["zh-CN"]).toBe("策略：源码优先，先读取关键文件。");
    expect(sourceHint?.text["en-US"]).toBe(
      "Strategy: source-first; reading key files before answering.",
    );
  });

  it("marks mutating edit requests as explicit-gate and verification policy", () => {
    const decision = evaluateMetaScheduler({
      ...baseInput(),
      permissionMode: "default",
      recentDeniedCount: 1,
      userText: "fix the bug and edit the runtime file",
    });

    expect(decision.policyDecision.taskKind).toBe("edit");
    expect(decision.policyDecision.riskLevel).toBe("medium");
    expect(decision.policyDecision.permissionPlan.expectedMutating).toBe(true);
    expect(decision.policyDecision.permissionPlan.requireExplicitGate).toBe(true);
    expect(decision.policyDecision.permissionSignal).toMatchObject({
      permissionMode: "default",
      recentDenied: true,
      recentDeniedCount: 1,
      expectedMutating: true,
      requireExplicitGate: true,
      pendingApproval: false,
    });
    expect(decision.policyDecision.executionPlan.requireVerification).toBe(true);
    expect(decision.policyDecision.verificationSignal).toMatchObject({
      required: true,
      recommendedLevel: "focused",
      reason: "mutating",
    });
    expect(decision.policyDecision.hints.map((hint) => hint.id)).toContain("permission-risk");
  });

  it("uses accepted memory and active failure lessons as context policy only", () => {
    const failureLearning = baseFailureLearning();
    failureLearning.records.push({
      id: "failure-1",
      createdAt: new Date(0).toISOString(),
      lastSeen: new Date(0).toISOString(),
      projectScope: failureLearning.projectScope,
      sourceRef: "evidence:abc",
      category: "tool_failure",
      failureSummary: "Bash failed",
      rootCauseGuess: "command failed",
      inferred: true,
      avoidNextTime: "inspect output first",
      severity: "medium",
      dedupeHash: "hash",
      count: 1,
      status: "active",
    });

    const decision = evaluateMetaScheduler({
      ...baseInput(),
      memoryAcceptedCount: 1,
      memoryCandidateCount: 2,
      memoryAutoLearningActive: true,
      failureLearning,
    });

    expect(decision.policyDecision.contextPlan.includeMemory).toBe(true);
    expect(decision.policyDecision.contextPlan.includeFailureLearning).toBe(true);
    expect(decision.policyDecision.memorySignal).toMatchObject({
      accepted: true,
      acceptedCount: 1,
      candidateCount: 2,
      autoLearningActive: true,
    });
    expect(decision.policyDecision.failureSignal).toMatchObject({
      activeCount: 1,
      mediumSeverityCount: 1,
      highSeverityCount: 0,
      categories: ["tool_failure"],
    });
    expect(decision.policyDecision.hints.map((hint) => hint.id)).toContain("memory");
    expect(decision.policyDecision.hints.map((hint) => hint.id)).toContain("failure-learning");
  });

  it("marks provider cooldown and fallback as typed provider policy", () => {
    const cooldown = evaluateMetaScheduler({
      ...baseInput(),
      providerCooldownBlocked: true,
      currentRole: "executor",
      currentProvider: "deepseek",
      currentModel: "v4",
    });
    expect(cooldown.policyDecision.providerPlan).toBe("cooldownBlocked");
    expect(cooldown.policyDecision.modelRouteSignal).toMatchObject({
      role: "executor",
      provider: "deepseek",
      model: "v4",
      fallback: false,
      providerCooldown: true,
      providerFailure: false,
    });
    expect(cooldown.policyDecision.hints.map((hint) => hint.id)).toContain("provider-cooldown");

    const fallback = evaluateMetaScheduler({
      ...baseInput(),
      providerFailure: { provider: "p1", model: "m1", code: "429", message: "rate limit" },
      routeFallbackUsed: true,
    });
    expect(fallback.policyDecision.providerPlan).toBe("fallbackCandidate");
    expect(fallback.policyDecision.modelRouteSignal.fallback).toBe(true);
    expect(fallback.policyDecision.modelRouteSignal.providerFailure).toBe(true);
    expect(fallback.policyDecision.hints.map((hint) => hint.id)).toContain("provider-fallback");
  });

  it("projects architecture, platform, and budget signals from existing runtime state", () => {
    const decision = evaluateMetaScheduler({
      ...baseInput(),
      userText: "修改 model-stream-runtime.ts 并验证",
      currentArchitectureCard: true,
      architectureDriftPending: true,
      platform: "win32",
      shellFamily: "powershell",
      terminalCapability: {
        tier: "basic",
        alternateScreen: true,
        cursorPositioning: true,
      },
      roleBudgetStop: true,
      toolResultBudgetPersistedCount: 2,
    });

    expect(decision.policyDecision.architectureSignal).toMatchObject({
      cardPresent: true,
      guardReminder: true,
      driftPending: true,
    });
    expect(decision.policyDecision.platformSignal).toMatchObject({
      platform: "win32",
      shellFamily: "powershell",
      terminalTier: "basic",
      windowsSafeHint: true,
    });
    expect(decision.policyDecision.budgetSignal).toMatchObject({
      contextPressure: false,
      usageNearLimit: true,
      toolResultBudgetPressure: true,
    });
    expect(decision.policyDecision.hints.map((hint) => hint.id)).toContain("windows-safe");
    expect(decision.policyDecision.hints.map((hint) => hint.id)).toContain("architecture-guard");
  });

  it("projects latest verification, pending approval, and background occupancy signals", () => {
    const backgroundTasks: BackgroundTaskState[] = [
      {
        id: "agent-running",
        kind: "agent",
        title: "agent",
        status: "running",
        startedAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        heartbeatIntervalMs: 1000,
        staleAfterMs: 1000,
        hasOutput: false,
        userVisibleSummary: "running agent",
      },
      {
        id: "job-running",
        kind: "job",
        title: "job",
        status: "running",
        startedAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        heartbeatIntervalMs: 1000,
        staleAfterMs: 1000,
        hasOutput: false,
        userVisibleSummary: "running job",
      },
    ];
    const decision = evaluateMetaScheduler({
      ...baseInput(),
      userText: "继续处理当前任务",
      lastVerificationStatus: "fail",
      pendingApproval: true,
      backgroundTasks,
    });

    expect(decision.policyDecision.verificationSignal).toMatchObject({
      required: true,
      recommendedLevel: "full",
      lastStatus: "fail",
    });
    expect(decision.policyDecision.permissionSignal).toMatchObject({
      requireExplicitGate: true,
      pendingApproval: true,
    });
    expect(decision.policyDecision.runtimeSignal).toMatchObject({
      runningAgents: 1,
      runningJobs: 1,
      resourceCapPressure: true,
    });
    expect(decision.policyDecision.hints.map((hint) => hint.id)).toContain("background-occupancy");
  });

  it("shows Windows-safe hint for Windows edit and verification requests", () => {
    const decision = evaluateMetaScheduler({
      ...baseInput(),
      userText: "请修改 meta-scheduler-runtime.ts 并运行 verification",
      platform: "win32",
      shellFamily: "powershell",
    });

    expect(decision.policyDecision.platformSignal.windowsSafeHint).toBe(true);
    expect(decision.policyDecision.hints.map((hint) => hint.id)).toContain("windows-safe");
  });

  it("keeps Windows-safe as a bottom signal without showing a hint for ordinary chat", () => {
    const decision = evaluateMetaScheduler({
      ...baseInput(),
      userText: "你好，聊聊今天的工作节奏",
      platform: "win32",
      shellFamily: "powershell",
    });

    expect(decision.policyDecision.taskKind).toBe("chat");
    expect(decision.policyDecision.platformSignal.windowsSafeHint).toBe(true);
    expect(decision.policyDecision.hints.map((hint) => hint.id)).not.toContain("windows-safe");
  });

  it("does not show Windows-safe hint for ordinary source fact checks without command or path risk", () => {
    const decision = evaluateMetaScheduler({
      ...baseInput(),
      userText: "请基于源码确认模型流的调用链",
      platform: "win32",
      shellFamily: "powershell",
    });

    expect(decision.policyDecision.taskKind).toBe("code_fact");
    expect(decision.policyDecision.platformSignal.windowsSafeHint).toBe(true);
    expect(decision.policyDecision.hints.map((hint) => hint.id)).not.toContain("windows-safe");
    expect(decision.policyDecision.hints.map((hint) => hint.id)).toContain("source-first");
  });

  it("suggests verifier/planner roles without changing the selected model route", () => {
    const verifierDecision = evaluateMetaScheduler({
      ...baseInput(),
      assistantText: "All fixed. PASS.",
    });
    expect(verifierDecision.shouldPreferVerifier).toBe(true);
    expect(verifierDecision.policyDecision.modelRouteSignal.suggestedRole).toBe("verifier");

    const plannerDecision = evaluateMetaScheduler({
      ...baseInput(),
      userText: "多开 agent 处理这个 workflow",
      currentRole: "executor",
      currentProvider: "deepseek",
      currentModel: "v4",
    });
    expect(plannerDecision.policyDecision.modelRouteSignal).toMatchObject({
      role: "executor",
      provider: "deepseek",
      model: "v4",
      suggestedRole: "planner",
    });
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

  it("keeps policy internals off the main screen while preserving light hint wording", () => {
    const sanitized = sanitizeMainScreenLeakage(
      'PolicyDecision={"taskKind":"edit"}\npolicy_decision: {"risk":"high"}\nTyped policy route: task edit\nStrategy: source-first; reading key files before answering.',
      "en-US",
    );

    expect(sanitized).not.toContain("PolicyDecision");
    expect(sanitized).not.toContain("policy_decision");
    expect(sanitized).not.toContain("Typed policy route");
    expect(sanitized).toContain("Internal runtime context was omitted");
  });

  describe("verifyFailureLearningContract", () => {
    it("satisfied when capture was not required", () => {
      const decision = evaluateMetaScheduler(baseInput());
      const result = verifyFailureLearningContract({
        decision,
        preTurnRecordCount: 0,
        postTurnRecordCount: 0,
        failureKind: "tool",
      });
      expect(result.satisfied).toBe(true);
    });

    it("satisfied when capture was required and new records added", () => {
      const decision = evaluateMetaScheduler({
        ...baseInput(),
        lastToolFailure: { toolName: "Bash", summary: "exit code 1" },
      });
      const result = verifyFailureLearningContract({
        decision,
        preTurnRecordCount: 0,
        postTurnRecordCount: 1,
        failureKind: "tool",
      });
      expect(result.satisfied).toBe(true);
    });

    it("unsatisfied when capture was required but no new records added", () => {
      const decision = evaluateMetaScheduler({
        ...baseInput(),
        lastToolFailure: { toolName: "Bash", summary: "exit code 1" },
      });
      const result = verifyFailureLearningContract({
        decision,
        preTurnRecordCount: 2,
        postTurnRecordCount: 2,
        failureKind: "tool",
      });
      expect(result.satisfied).toBe(false);
      if (!result.satisfied) {
        expect(result.reason).toContain("degraded state recorded");
      }
    });

    it("satisfied when provider failure is detected and captured", () => {
      const decision = evaluateMetaScheduler({
        ...baseInput(),
        providerFailure: { provider: "deepseek", model: "v4", code: "429", message: "rate limit" },
      });
      expect(decision.shouldCaptureFailureLearning).toBe(true);
      const result = verifyFailureLearningContract({
        decision,
        preTurnRecordCount: 1,
        postTurnRecordCount: 2,
        failureKind: "provider",
      });
      expect(result.satisfied).toBe(true);
    });
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
