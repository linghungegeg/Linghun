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

  it("routes explicit external app capability mentions without stealing workflow or agent routes", () => {
    const capability = evaluateMetaScheduler({
      ...baseInput(),
      userText: "连接外部画图 app 创建一个画布",
    });
    expect(capability.policyDecision.taskKind).toBe("capability");
    expect(capability.policyDecision.capabilitySignal).toMatchObject({
      active: true,
      reason: "external_app",
      permission: "external_app",
      riskLevel: "medium",
    });
    expect(capability.policyDecision.capabilitySignal.candidateIds).toContain("mock.canvas.create");
    expect(capability.policyDecision.executionPlan.preferAgent).toBe(false);
    expect(capability.policyDecision.executionPlan.preferWorkflow).toBe(false);

    const agent = evaluateMetaScheduler({
      ...baseInput(),
      userText: "多开 agent 继续工作，不要走外部 app capability",
    });
    expect(agent.policyDecision.taskKind).toBe("agent");
    expect(agent.policyDecision.capabilitySignal.active).toBe(false);
  });

  it("keeps strategic exploration in chat even when capability is mentioned", () => {
    const decision = evaluateMetaScheduler({
      ...baseInput(),
      userText: "先讨论 capability runtime 和 app bridge 的架构取舍，不要实现",
    });

    expect(decision.policyDecision.taskKind).toBe("chat");
    expect(decision.policyDecision.capabilitySignal.active).toBe(true);
    expect(decision.policyDecision.executionPlan.preferAgent).toBe(false);
    expect(decision.policyDecision.executionPlan.preferWorkflow).toBe(false);
    expect(decision.policyDecision.permissionPlan.expectedMutating).toBe(false);
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
    expect(decision.policyDecision.verificationSignal.recommendedLevel).toBe("basic");
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

  it("UserState hotfix: frustrated command request keeps strengthened verification and becomes command-first", () => {
    const decision = evaluateMetaScheduler({
      ...baseInput(),
      userText: "又错了，给我命令。",
    });

    expect(decision.policyDecision.userState.kind).toBe("frustrated");
    expect(decision.policyDecision.userState.interactionPlan.commandFirst).toBe(true);
    expect(decision.policyDecision.userState.detailPlan.style).toBe("command_first");
    expect(decision.policyDecision.userState.detailPlan.background).toBe("minimal");
    expect(decision.policyDecision.userState.verificationPlan.strength).toBe("strengthened");
    expect(decision.policyDecision.userState.verificationPlan.requireSourceFacts).toBe(true);
    expect(decision.policyDecision.userState.verificationPlan.forbidEarlyPass).toBe(true);
    expect(decision.policyDecision.userState.notificationPlan.maxHints).toBeLessThanOrEqual(2);
    expect(decision.policyDecision.verificationSignal.route.commands).toEqual(
      expect.arrayContaining(["source-facts", "focused-test"]),
    );
  });

  it("UserState hotfix: no-fluff command request remains command-first", () => {
    const decision = evaluateMetaScheduler({
      ...baseInput(),
      userText: "别废话，直接给我命令。",
    });

    expect(decision.policyDecision.userState.kind).toBe("decisive_command");
    expect(decision.policyDecision.userState.interactionPlan.commandFirst).toBe(true);
    expect(decision.policyDecision.userState.detailPlan.style).toBe("command_first");
    expect(decision.policyDecision.userState.detailPlan.background).toBe("minimal");
    expect(decision.policyDecision.userState.notificationPlan.maxHints).toBeLessThanOrEqual(2);
  });

  it("UserState hotfix: trust repair command request keeps source facts and becomes command-first", () => {
    const decision = evaluateMetaScheduler({
      ...baseInput(),
      userText: "不要再复述摘要，给我命令。",
      lastVerificationStatus: "fail",
    });

    expect(decision.policyDecision.userState.kind).toBe("trust_repair");
    expect(decision.policyDecision.userState.interactionPlan.commandFirst).toBe(true);
    expect(decision.policyDecision.userState.detailPlan.style).toBe("command_first");
    expect(decision.policyDecision.userState.detailPlan.background).toBe("minimal");
    expect(decision.policyDecision.userState.verificationPlan.strength).toBe("strengthened");
    expect(decision.policyDecision.userState.verificationPlan.requireSourceFacts).toBe(true);
    expect(decision.policyDecision.userState.verificationPlan.forbidEarlyPass).toBe(true);
    expect(decision.policyDecision.verificationSignal.route.commands).toContain("source-facts");
  });

  it("UserState hotfix: stability point command request is high-stakes release and command-first", () => {
    const decision = evaluateMetaScheduler({
      ...baseInput(),
      userText: "准备稳定点，给我命令。",
      lastVerificationStatus: "fail",
    });

    expect(decision.policyDecision.userState.kind).toBe("high_stakes_release");
    expect(decision.policyDecision.userState.interactionPlan.commandFirst).toBe(true);
    expect(decision.policyDecision.userState.detailPlan).toMatchObject({
      style: "command_first",
      background: "minimal",
    });
    expect(decision.policyDecision.userState.verificationPlan).toMatchObject({
      strength: "release",
      requireDirtyTreeCheck: true,
      requireBuild: true,
      requireFocusedTests: true,
      requireStabilityBoundary: true,
    });
    expect(decision.policyDecision.verificationSignal.route.commands).toEqual(
      expect.arrayContaining([
        "dirty-tree",
        "untracked-files",
        "build",
        "focused-test",
        "stability-boundary",
      ]),
    );
  });

  it("UserState hotfix: direct command request still classifies as decisive_command", () => {
    const decision = evaluateMetaScheduler({
      ...baseInput(),
      userText: "直接给我命令，不用解释。",
    });

    expect(decision.policyDecision.userState.kind).toBe("decisive_command");
    expect(decision.policyDecision.userState.interactionPlan.commandFirst).toBe(true);
    expect(decision.policyDecision.userState.detailPlan).toMatchObject({
      style: "command_first",
      background: "minimal",
    });
  });

  it("UserState hotfix: strategic exploration remains discussion-only without command-first", () => {
    const decision = evaluateMetaScheduler({
      ...baseInput(),
      userText: "先讨论架构取舍，不要实现代码。",
    });

    expect(decision.policyDecision.userState.kind).toBe("strategic_exploration");
    expect(decision.policyDecision.userState.interactionPlan.allowImplementationPush).toBe(false);
    expect(decision.policyDecision.userState.interactionPlan.commandFirst).toBe(false);
    expect(decision.policyDecision.taskKind).toBe("chat");
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
    const directive = formatMetaSchedulerDirective(decision);
    expect(directive).toContain("Windows shell boundary");
    expect(directive).toContain("Edit/MultiEdit/Write structured tools");
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
        userText: "更新 README.md 的 markdown link 和 frontmatter",
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

  it("keeps public README install and verification value visible", () => {
    const readme = readFileSync(resolve(process.cwd(), "README.md"), "utf8");

    expect(readme).toContain("npm install -g @linghun/cli");
    expect(readme).toContain("反幻觉");
    expect(readme).toContain("验证");
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
      workflow,
    });

    expect(decision.shouldStopForBlockedRuntime).toBe(true);
    expect(decision.internalEvents).toContain("meta_scheduler:blocked_runtime_stop");
  });

  it("keeps historical non-pass task states out of blocked runtime stop", () => {
    const backgroundTasks: BackgroundTaskState[] = [
      makeBackgroundTask("agent-stale", "agent", "stale", "stale"),
      makeBackgroundTask("agent-cancelled", "agent", "cancelled", "cancelled"),
      makeBackgroundTask("agent-blocked", "agent", "blocked", "fail"),
      makeBackgroundTask("job-timeout", "job", "timeout", "timeout"),
      makeBackgroundTask("job-done", "job", "completed", "partial"),
    ];
    const decision = evaluateMetaScheduler({
      ...baseInput(),
      backgroundTasks,
    });

    expect(decision.shouldStopForBlockedRuntime).toBe(false);
    expect(decision.internalEvents).not.toContain("meta_scheduler:blocked_runtime_stop");
    expect(decision.policyDecision.hints.map((hint) => hint.id)).not.toContain("blocked-runtime");
    expect(decision.policyDecision.verificationSignal.route.noPassReasons).toEqual(
      expect.arrayContaining([
        "agent:stale",
        "agent:cancelled",
        "agent:blocked",
        "job:timeout",
        "job:completed_not_pass",
      ]),
    );
  });

  it("keeps terminal blocked workflow history out of blocked runtime stop", () => {
    const workflow: NonNullable<WorkflowState["activeRun"]> = {
      id: "wf-history",
      goal: "ship",
      planId: "plan-1",
      status: "blocked",
      steps: [
        {
          id: "s1",
          title: "audit",
          status: "blocked",
          runtime: "agent",
          evidenceRefs: [],
          summary: "old blocked step",
          endedAt: new Date(0).toISOString(),
        },
      ],
      startedAt: new Date(0).toISOString(),
      endedAt: new Date(1).toISOString(),
      result: "blocked",
    };
    const decision = evaluateMetaScheduler({
      ...baseInput(),
      workflow,
    });

    expect(decision.shouldStopForBlockedRuntime).toBe(false);
    expect(decision.internalEvents).not.toContain("meta_scheduler:blocked_runtime_stop");
    expect(decision.policyDecision.hints.map((hint) => hint.id)).not.toContain("blocked-runtime");
    expect(decision.policyDecision.verificationSignal.route.noPassReasons).toContain(
      "workflow:blocked",
    );
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
    expect(sanitized).not.toContain("Internal runtime context was omitted");
  });

  it("injects engineering profile strategy as an internal scheduler signal", () => {
    const decision = evaluateMetaScheduler({
      ...baseInput(),
      userText: "fix the C++ solution",
      engineeringProfile: "polyglot_cpp",
    });

    expect(decision.policyDecision.engineeringSignal.profile).toBe("polyglot_cpp");
    expect(decision.policyDecision.engineeringSignal.strategyHint).toContain("headers/tests");
    expect(formatMetaSchedulerDirective(decision)).toContain("EngineeringTaskProfile");
    expect(formatMetaSchedulerDirective(decision)).not.toContain("Terminal-Bench");
  });

  it("maps provider and timeout failures into engineering final-boundary hints", () => {
    const provider = evaluateMetaScheduler({
      ...baseInput(),
      providerFailure: { provider: "openai-compatible", model: "gpt-5.5", message: "upstream" },
    });
    expect(provider.policyDecision.engineeringSignal.failureCategory).toBe("provider_error");
    expect(provider.policyDecision.engineeringSignal.finalBoundaryHint).toContain("provider");

    const timeout = evaluateMetaScheduler({
      ...baseInput(),
      engineeringProfile: "large_python_project",
      lastVerificationStatus: "timeout",
    });
    expect(timeout.policyDecision.engineeringSignal.failureCategory).toBe("test_timeout");
    expect(timeout.policyDecision.engineeringSignal.finalBoundaryHint).toContain("timeout");
  });

  it("sanitizes engineering strategy labels from main-screen echoes", () => {
    const cleaned = sanitizeMainScreenLeakage(
      "EngineeringTaskProfile: profile=polyglot_cpp; strategy=read headers/tests\nEngineeringStrategyHint=read tests first\nnormal answer",
      "en-US",
    );

    expect(cleaned).toBe("normal answer");
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

  describe("Task 6: intent classifier — signal-aware multi-intent", () => {
    it("forces code_fact when consecutive failures >= 2 and edit keywords dominate", () => {
      const decision = evaluateMetaScheduler({
        ...baseInput(),
        userText: "修改 meta-scheduler-runtime.ts 的 bug",
        consecutiveFailures: 2,
      });

      expect(decision.policyDecision.taskKind).toBe("code_fact");
      expect(decision.policyDecision.executionPlan.preferSourceFirst).toBe(true);
      expect(decision.internalEvents).toEqual(
        expect.arrayContaining([expect.stringContaining("连续失败后强制源码优先")]),
      );
    });

    it("flags ambiguous intent when no domain scores >= 10", () => {
      const decision = evaluateMetaScheduler({
        ...baseInput(),
        userText: "帮我看看那个东西",
      });

      expect(decision.policyDecision.taskKind).toBe("chat");
      expect(decision.internalEvents).toContain("meta_scheduler:intent_unclear_clarify");
      expect(decision.directives).toContain("用户意图不明确，先澄清再操作");
    });

    it("appends verification to secondaries when last verification failed", () => {
      const decision = evaluateMetaScheduler({
        ...baseInput(),
        userText: "修改文件",
        lastVerificationStatus: "fail",
      });

      expect(decision.policyDecision.executionPlan.requireVerification).toBe(true);
      expect(decision.internalEvents).toEqual(
        expect.arrayContaining([expect.stringContaining("上轮验证失败")]),
      );
    });

    it("scores edit over code_fact when edit keywords dominate", () => {
      const decision = evaluateMetaScheduler({
        ...baseInput(),
        userText: "修改并实现这个功能",
      });

      // 修改(10) 实现(8) → edit=10, no code_fact keywords → clear edit win
      expect(decision.policyDecision.taskKind).toBe("edit");
    });

    it("records provider failure history in classifier reason", () => {
      const failureLearning = baseFailureLearning();
      failureLearning.records.push({
        id: "p-fail",
        createdAt: new Date(0).toISOString(),
        lastSeen: new Date(0).toISOString(),
        projectScope: failureLearning.projectScope,
        sourceRef: "evidence:xyz",
        category: "provider_failure",
        failureSummary: "provider rate limited",
        rootCauseGuess: "rate limit",
        inferred: true,
        avoidNextTime: "use fallback",
        severity: "high",
        dedupeHash: "hash",
        count: 1,
        status: "active",
      });

      const decision = evaluateMetaScheduler({
        ...baseInput(),
        userText: "修改文件",
        failureLearning,
        hasActiveProviderFailure: true,
      });

      expect(decision.internalEvents).toEqual(
        expect.arrayContaining([expect.stringContaining("provider 历史失败")]),
      );
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
