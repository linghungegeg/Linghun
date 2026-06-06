import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

  it("UserState: frustrated input triggers source-first strengthened verification and quiet notification", () => {
    const decision = evaluateMetaScheduler({
      ...baseInput(),
      userText: "又错了，别空泛，先读源码事实再说。",
    });

    expect(decision.policyDecision.userState).toMatchObject({
      kind: "frustrated",
      interactionPlan: {
        route: "source_fact_first",
        sourceFactsFirst: true,
        allowImplementationPush: true,
      },
      verificationPlan: {
        strength: "strengthened",
        requireSourceFacts: true,
        forbidEarlyPass: true,
        requireFocusedTests: true,
      },
      notificationPlan: {
        quiet: true,
        suppressGenericHints: true,
        maxHints: 2,
      },
    });
    expect(decision.policyDecision.executionPlan.preferSourceFirst).toBe(true);
    expect(decision.policyDecision.verificationSignal.recommendedLevel).toBe("full");
    expect(decision.policyDecision.verificationSignal.route.commands).toEqual(
      expect.arrayContaining(["source-facts", "focused-test"]),
    );
    expect(decision.policyDecision.verificationSignal.route.conservativeNoPass).toBe(true);
    expect(decision.policyDecision.verificationSignal.route.noPassReasons).toContain(
      "user_state:frustrated",
    );
  });

  it("UserState: trust repair requires source facts and cannot only summarize delivery", () => {
    const decision = evaluateMetaScheduler({
      ...baseInput(),
      userText: "不要只复述交付摘要，上次你没看代码，这次以代码事实为主。",
    });

    expect(decision.policyDecision.userState.kind).toBe("trust_repair");
    expect(decision.policyDecision.userState.memoryCandidate).toMatchObject({
      shouldCreate: true,
      scope: "session",
      autoAccept: false,
    });
    expect(decision.policyDecision.executionPlan.preferSourceFirst).toBe(true);
    expect(decision.policyDecision.verificationSignal.route.commands).toContain("source-facts");
    expect(decision.shouldRunFinalAnswerGate).toBe(true);
  });

  it("UserState: decisive command goes command-first without long explanation mode", () => {
    const decision = evaluateMetaScheduler({
      ...baseInput(),
      userText: "直接给我命令，不用解释。",
    });

    expect(decision.policyDecision.userState).toMatchObject({
      kind: "decisive_command",
      interactionPlan: { route: "command_first", commandFirst: true },
      detailPlan: { style: "command_first", background: "minimal" },
    });
    expect(decision.policyDecision.userState.notificationPlan.maxHints).toBe(2);
  });

  it("UserState: confused input stays explain-first and does not push implementation", () => {
    const decision = evaluateMetaScheduler({
      ...baseInput(),
      userText: "我没懂这个模块为什么要这么改，先解释一下。",
    });

    expect(decision.policyDecision.taskKind).toBe("chat");
    expect(decision.policyDecision.permissionPlan.expectedMutating).toBe(false);
    expect(decision.policyDecision.userState).toMatchObject({
      kind: "confused",
      interactionPlan: {
        route: "explain_first",
        explainFirst: true,
        allowImplementationPush: false,
      },
    });
  });

  it("UserState: strategic exploration stays discussion-only and avoids code execution scheduling", () => {
    const decision = evaluateMetaScheduler({
      ...baseInput(),
      userText: "先讨论架构取舍，不要实现代码。",
    });

    expect(decision.policyDecision.taskKind).toBe("chat");
    expect(decision.policyDecision.executionPlan.preferAgent).toBe(false);
    expect(decision.policyDecision.executionPlan.preferWorkflow).toBe(false);
    expect(decision.policyDecision.permissionPlan.expectedMutating).toBe(false);
    expect(decision.policyDecision.userState).toMatchObject({
      kind: "strategic_exploration",
      interactionPlan: {
        route: "discussion_only",
        discussionOnly: true,
        allowImplementationPush: false,
      },
    });
  });

  it("UserState: high-stakes release triggers release gate dirty tree build focused test boundary", () => {
    const decision = evaluateMetaScheduler({
      ...baseInput(),
      userText: "准备开源发布前复检，必须确认 dirty tree、build、focused tests 和稳定点。",
    });

    expect(decision.policyDecision.riskLevel).toBe("high");
    expect(decision.policyDecision.userState).toMatchObject({
      kind: "high_stakes_release",
      interactionPlan: { route: "release_gate", sourceFactsFirst: false },
      verificationPlan: {
        strength: "release",
        requireDirtyTreeCheck: true,
        requireBuild: true,
        requireFocusedTests: true,
        requireStabilityBoundary: true,
      },
    });
    expect(decision.policyDecision.verificationSignal.route.commands).toEqual(
      expect.arrayContaining([
        "source-facts",
        "dirty-tree",
        "untracked-files",
        "build",
        "focused-test",
        "stability-boundary",
      ]),
    );
    expect(decision.shouldRunFinalAnswerGate).toBe(true);
    expect(decision.shouldPreferVerifier).toBe(true);
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

  it("routes different task domains to domain-aware verification commands", () => {
    const cases = [
      {
        userText: "修改 packages/tui/src/index.ts 并跑测试",
        domain: "code_change",
        command: "typecheck",
      },
      {
        userText: "更新 docs/delivery/README.md 的 markdown link 和 frontmatter",
        domain: "documentation",
        command: "frontmatter",
      },
      {
        userText: "修复 TUI 交互面板的 keyboard render 问题",
        domain: "tui_interactive",
        command: "focused-tui-tests",
      },
      {
        userText: "检查 provider model config route doctor",
        domain: "provider_model_config",
        command: "config-isolation",
      },
      {
        userText: "收口 agent job workflow 调度状态",
        domain: "agent_job_workflow",
        command: "no-pass-without-verification",
      },
    ] as const;

    for (const item of cases) {
      const decision = evaluateMetaScheduler({ ...baseInput(), userText: item.userText });

      expect(decision.policyDecision.verificationSignal.route.domain).toBe(item.domain);
      expect(decision.policyDecision.verificationSignal.route.commands).toContain(item.command);
    }
  });

  it("consumes job workflow agent verification failure and evidence freshness signals", () => {
    const nowMs = Date.parse("2026-06-05T00:00:00.000Z");
    const stalePassEvidence = makeEvidence({
      createdAt: new Date(nowMs - 31 * 60 * 1000).toISOString(),
      kind: "test_result",
      supportsClaims: ["verification_passed", "typecheck_passed"],
    });
    const failureLearning = baseFailureLearning();
    failureLearning.records.push({
      id: "failure-1",
      createdAt: new Date(0).toISOString(),
      lastSeen: new Date(0).toISOString(),
      projectScope: failureLearning.projectScope,
      sourceRef: "evidence:abc",
      category: "verification_failure",
      failureSummary: "verification timed out",
      rootCauseGuess: "timeout",
      inferred: true,
      avoidNextTime: "rerun focused verification",
      severity: "high",
      dedupeHash: "hash",
      count: 1,
      status: "active",
    });
    const backgroundTasks: BackgroundTaskState[] = [
      makeBackgroundTask("agent-done", "agent", "completed", "partial"),
      makeBackgroundTask("job-timeout", "job", "timeout", "timeout"),
    ];
    const workflow: NonNullable<WorkflowState["activeRun"]> = {
      id: "wf-done",
      goal: "ship",
      planId: "plan-1",
      status: "completed",
      steps: [],
      startedAt: new Date(0).toISOString(),
      result: "partial",
    };

    const decision = evaluateMetaScheduler({
      ...baseInput(),
      userText: "agent job workflow completed 后准备发布",
      nowMs,
      evidence: [stalePassEvidence],
      lastVerificationStatus: "timeout",
      failureLearning,
      backgroundTasks,
      workflow,
    });

    expect(decision.policyDecision.runtimeSignal.agentStates.completed).toBe(1);
    expect(decision.policyDecision.runtimeSignal.jobStates.timeout).toBe(1);
    expect(decision.policyDecision.runtimeSignal.completedWithoutFreshVerification).toBe(true);
    expect(decision.policyDecision.verificationSignal.route).toMatchObject({
      domain: "agent_job_workflow",
      evidenceFreshness: "stale",
      conservativeNoPass: true,
    });
    expect(decision.policyDecision.verificationSignal.route.noPassReasons).toEqual(
      expect.arrayContaining([
        "verification:timeout",
        "job:timeout",
        "agent:completed_not_pass",
        "workflow:completed_not_pass",
        "completed_without_fresh_verification",
        "active_failure_learning",
      ]),
    );
  });

  it("keeps completed lifecycle states conservative until fresh verification evidence exists", () => {
    const decision = evaluateMetaScheduler({
      ...baseInput(),
      userText: "agent completed, workflow completed, job completed，可以 PASS 吗",
      backgroundTasks: [
        makeBackgroundTask("agent-done", "agent", "completed", "partial"),
        makeBackgroundTask("job-done", "job", "completed", "partial"),
      ],
      workflow: {
        id: "wf-done",
        goal: "ship",
        planId: "plan-1",
        status: "completed",
        steps: [],
        startedAt: new Date(0).toISOString(),
        result: "partial",
      },
    });

    expect(decision.policyDecision.verificationSignal.route.conservativeNoPass).toBe(true);
    expect(decision.policyDecision.verificationSignal.route.noPassReasons).toEqual(
      expect.arrayContaining([
        "agent:completed_not_pass",
        "job:completed_not_pass",
        "workflow:completed_not_pass",
        "completed_without_fresh_verification",
      ]),
    );
  });

  it("documents Phase 17A durable jobs as completed while Phase 7.11 is runtime closure", () => {
    const readme = readFileSync(resolve(process.cwd(), "docs/delivery/README.md"), "utf8");
    const phase711 = readme
      .split("\n")
      .find((line) => line.startsWith("| Phase 7.11 Task / Job Verification Routing Closure |"));
    const phase17a = readme
      .split("\n")
      .find((line) => line.startsWith("| Phase 17A local durable jobs |"));

    expect(phase711).toContain("done; focused/local validation only");
    expect(phase711).not.toContain("docs-only");
    expect(phase711).not.toContain("PENDING");
    expect(phase17a).toContain("done; focused/local validation only");
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
      'PolicyDecision={"taskKind":"edit"}\npolicy_decision: {"risk":"high"}\nTyped policy route: task edit\nVerification route: domain=code_change\nStrategy: source-first; reading key files before answering.',
      "en-US",
    );

    expect(sanitized).not.toContain("PolicyDecision");
    expect(sanitized).not.toContain("policy_decision");
    expect(sanitized).not.toContain("Typed policy route");
    expect(sanitized).not.toContain("Verification route");
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

function makeEvidence(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    id: "evidence-1",
    kind: "test_result",
    summary: "verification passed",
    source: "verification",
    supportsClaims: ["verification_passed"],
    createdAt: new Date(0).toISOString(),
    ...overrides,
  };
}

function makeBackgroundTask(
  id: string,
  kind: "agent" | "job",
  status: BackgroundTaskState["status"],
  result?: BackgroundTaskState["result"],
): BackgroundTaskState {
  return {
    id,
    kind,
    title: id,
    status,
    startedAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    heartbeatIntervalMs: 1000,
    staleAfterMs: 1000,
    hasOutput: false,
    ...(result ? { result } : {}),
    userVisibleSummary: id,
  };
}
