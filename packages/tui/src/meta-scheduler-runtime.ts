import type { ModelRole } from "@linghun/config";
import type { ModelMessage } from "@linghun/providers";
import type { Language, PermissionMode } from "@linghun/shared";
import { estimateModelMessageChars } from "./context-estimator.js";
import type { IndexState } from "./index-runtime.js";
import type { TerminalCapability } from "./shell/terminal-capability.js";
import type {
  BackgroundTaskState,
  EvidenceRecord,
  FailureLearningState,
  WorkflowState,
} from "./tui-data-types.js";

type ActiveWorkflowRun = NonNullable<WorkflowState["activeRun"]>;

export type VerificationRouteDomain =
  | "code_change"
  | "documentation"
  | "tui_interactive"
  | "provider_model_config"
  | "agent_job_workflow"
  | "general";

export type VerificationRoute = {
  domain: VerificationRouteDomain;
  commands: string[];
  evidenceFreshness: "fresh" | "stale" | "missing";
  conservativeNoPass: boolean;
  noPassReasons: string[];
};

type RuntimeStateCounts = {
  running: number;
  completed: number;
  blocked: number;
  stale: number;
  cancelled: number;
  timeout: number;
};

export type UserStateKind =
  | "neutral"
  | "frustrated"
  | "trust_repair"
  | "confused"
  | "decisive_command"
  | "strategic_exploration"
  | "high_stakes_release";

export type UserStateDecision = {
  kind: UserStateKind;
  confidence: number;
  interactionPlan: {
    route:
      | "normal"
      | "source_fact_first"
      | "command_first"
      | "explain_first"
      | "discussion_only"
      | "release_gate";
    sourceFactsFirst: boolean;
    commandFirst: boolean;
    explainFirst: boolean;
    discussionOnly: boolean;
    allowImplementationPush: boolean;
  };
  verificationPlan: {
    strength: "normal" | "focused" | "strengthened" | "release";
    requireSourceFacts: boolean;
    forbidEarlyPass: boolean;
    requireDirtyTreeCheck: boolean;
    requireBuild: boolean;
    requireFocusedTests: boolean;
    requireStabilityBoundary: boolean;
  };
  detailPlan: {
    style: "normal" | "concise" | "command_first" | "explain_first" | "discussion";
    background: "minimal" | "normal" | "expanded";
  };
  notificationPlan: {
    quiet: boolean;
    suppressGenericHints: boolean;
    maxHints: number;
  };
  memoryCandidate: {
    shouldCreate: boolean;
    scope: "session";
    summary?: string;
    autoAccept: false;
  };
};

export type MetaSchedulerInput = {
  language: Language;
  userText: string;
  assistantText?: string;
  messages?: ModelMessage[];
  estimatedContextChars?: number;
  contextMaxChars?: number;
  triggerChars?: number;
  index: IndexState;
  evidence: EvidenceRecord[];
  failureLearning: FailureLearningState;
  memoryAcceptedCount?: number;
  memoryCandidateCount?: number;
  memoryAutoLearningActive?: boolean;
  lastVerificationStatus?:
    | "pass"
    | "fail"
    | "partial"
    | "skipped"
    | "stale"
    | "cancelled"
    | "timeout";
  pendingApproval?: boolean;
  activeAgentCount?: number;
  activeJobCount?: number;
  activeWorkflowStatus?: "running" | "blocked" | "stale" | "paused";
  backgroundTasks: BackgroundTaskState[];
  workflow?: ActiveWorkflowRun;
  lastToolFailure?: { toolName: string; summary: string };
  providerFailure?: { provider: string; model: string; code?: string; message: string };
  providerCooldownBlocked?: boolean;
  permissionMode?: PermissionMode;
  recentDeniedCount?: number;
  currentRole?: ModelRole;
  currentProvider?: string;
  currentModel?: string;
  routeFallbackUsed?: boolean;
  routeProviderCooldown?: boolean;
  routeProviderFailure?: boolean;
  currentArchitectureCard?: boolean;
  architectureDriftPending?: boolean;
  terminalCapability?: Pick<TerminalCapability, "tier" | "alternateScreen" | "cursorPositioning">;
  platform?: NodeJS.Platform;
  shellFamily?: "powershell" | "cmd" | "bash" | "zsh" | "sh" | "unknown";
  usageSampleCount?: number;
  roleBudgetStop?: boolean;
  toolResultBudgetPersistedCount?: number;
  userStateDecision?: UserStateDecision;
  nowMs?: number;
};

export type CapabilityPlan = {
  route: "none" | "capability";
  reason: "none" | "external_app" | "explicit_capability";
  candidateIds: string[];
  permission: "read" | "write" | "bash" | "network" | "external_app";
  riskLevel: "low" | "medium" | "high";
};

export type PolicyDecision = {
  taskKind: "chat" | "code_fact" | "edit" | "workflow" | "agent" | "verification" | "capability";
  riskLevel: "low" | "medium" | "high";
  permissionSignal: {
    permissionMode: PermissionMode;
    recentDenied: boolean;
    recentDeniedCount: number;
    expectedMutating: boolean;
    requireExplicitGate: boolean;
    pendingApproval: boolean;
  };
  modelRouteSignal: {
    role: ModelRole;
    provider: string;
    model: string;
    fallback: boolean;
    providerCooldown: boolean;
    providerFailure: boolean;
    suggestedRole?: "planner" | "verifier";
  };
  verificationSignal: {
    required: boolean;
    recommendedLevel: "focused" | "basic" | "full";
    reason: "mutating" | "high_risk_claim" | "requested" | "normal";
    lastStatus?: MetaSchedulerInput["lastVerificationStatus"];
    route: VerificationRoute;
  };
  memorySignal: {
    accepted: boolean;
    acceptedCount: number;
    candidateCount: number;
    autoLearningActive: boolean;
  };
  failureSignal: {
    activeCount: number;
    highSeverityCount: number;
    mediumSeverityCount: number;
    categories: string[];
  };
  architectureSignal: {
    cardPresent: boolean;
    guardReminder: boolean;
    driftPending: boolean;
  };
  runtimeSignal: {
    runningAgents: number;
    runningJobs: number;
    workflowStatus?: "running" | "blocked" | "stale" | "paused";
    agentStates: RuntimeStateCounts;
    jobStates: RuntimeStateCounts;
    completedWithoutFreshVerification: boolean;
    noPassStates: string[];
    resourceCapPressure: boolean;
  };
  platformSignal: {
    platform: NodeJS.Platform | "unknown";
    shellFamily: "powershell" | "cmd" | "bash" | "zsh" | "sh" | "unknown";
    terminalTier: TerminalCapability["tier"] | "unknown";
    windowsSafeHint: boolean;
  };
  budgetSignal: {
    contextPressure: boolean;
    usageNearLimit: boolean;
    toolResultBudgetPressure: boolean;
  };
  capabilitySignal: {
    active: boolean;
    reason: CapabilityPlan["reason"];
    candidateIds: string[];
    permission: CapabilityPlan["permission"];
    riskLevel: CapabilityPlan["riskLevel"];
  };
  capabilityPlan: CapabilityPlan;
  userState: UserStateDecision;
  contextPlan: {
    includeMemory: boolean;
    includeFailureLearning: boolean;
    compactBeforeProvider: boolean;
  };
  executionPlan: {
    preferSourceFirst: boolean;
    preferWorkflow: boolean;
    preferAgent: boolean;
    requireVerification: boolean;
    requireFinalGate: boolean;
  };
  permissionPlan: {
    expectedMutating: boolean;
    requireExplicitGate: boolean;
  };
  providerPlan: "keepCurrent" | "fallbackCandidate" | "cooldownBlocked";
  hints: PolicyHint[];
};

export type PolicyHint = {
  id: string;
  severity: "info" | "warning";
  text: { "zh-CN": string; "en-US": string };
};

export type MetaSchedulerDecision = {
  directives: string[];
  policyDecision: PolicyDecision;
  shouldRunFinalAnswerGate: boolean;
  shouldPreferVerifier: boolean;
  shouldCaptureFailureLearning: boolean;
  shouldUseRetryGuard: boolean;
  shouldCompactBeforeProvider: boolean;
  shouldStopForBlockedRuntime: boolean;
  indexStrategy: "ready" | "stale" | "unknown-project" | "disabled" | "missing" | "error";
  internalEvents: string[];
};

export function evaluateMetaScheduler(input: MetaSchedulerInput): MetaSchedulerDecision {
  const internalEvents: string[] = [];
  const directives: string[] = [];
  const userStateDecision = input.userStateDecision ?? classifyUserStateDecision(input.userText);
  const highRiskClaim =
    typeof input.assistantText === "string" && hasHighRiskCompletionClaim(input.assistantText);
  const toolFailure = Boolean(input.lastToolFailure);
  const providerFailure = Boolean(input.providerFailure);
  const blockedRuntime = hasBlockedAgentOrWorkflow(input.backgroundTasks, input.workflow);
  const pressure = computeContextPressure(
    input.messages,
    input.estimatedContextChars,
    input.contextMaxChars,
    input.triggerChars,
  );
  const indexStrategy = classifyIndexStrategy(input.index);
  const capabilityPlan = createCapabilityPlan(input.userText);
  const taskKind = adjustTaskKindForUserState(
    classifyTaskKind(input.userText, capabilityPlan),
    userStateDecision,
  );
  const expectedMutating =
    userStateDecision.interactionPlan.allowImplementationPush &&
    expectsMutatingAction(input.userText, taskKind, capabilityPlan);
  const verificationDomain = classifyVerificationDomain(input.userText, taskKind, expectedMutating);
  const evidenceFreshness = classifyVerificationEvidenceFreshness(input.evidence, input.nowMs);
  const runtimeSignal = summarizeRuntimeSignal(input, evidenceFreshness);
  const includeFailureLearning = hasActiveFailureLearning(input.failureLearning);
  const failureSignal = summarizeFailureSignal(input.failureLearning);
  const preferSourceFirst =
    shouldPreferSourceFirst(taskKind, indexStrategy) ||
    userStateDecision.interactionPlan.sourceFactsFirst;
  const requireVerification =
    highRiskClaim ||
    taskKind === "verification" ||
    expectedMutating ||
    isRiskyVerificationStatus(input.lastVerificationStatus) ||
    userStateDecision.verificationPlan.strength === "strengthened" ||
    userStateDecision.verificationPlan.strength === "release";
  const surfaceWindowsSafeHint = shouldSurfaceWindowsSafeHint({
    userText: input.userText,
    taskKind,
    expectedMutating,
    blockedRuntime,
    toolFailure,
    providerFailure,
    providerCooldownBlocked: Boolean(input.providerCooldownBlocked || input.routeProviderCooldown),
  });
  const suggestedRole = highRiskClaim
    ? "verifier"
    : taskKind === "workflow" || taskKind === "agent"
      ? "planner"
      : undefined;
  const recentDeniedCount = input.recentDeniedCount ?? 0;
  const providerPlan = input.providerCooldownBlocked
    ? "cooldownBlocked"
    : providerFailure
      ? "fallbackCandidate"
      : "keepCurrent";

  if (highRiskClaim) {
    directives.push(
      "High-risk completion or verification claims require existing verification/final-answer-gate evidence before PASS.",
    );
    internalEvents.push("meta_scheduler:final_answer_gate_required");
  }
  if (toolFailure || providerFailure) {
    directives.push(
      "Tool/provider failures must be captured as failure learning or an explicit degraded state; do not claim completion from a failed turn.",
    );
    internalEvents.push("meta_scheduler:failure_learning_required");
  }
  if (pressure.shouldCompact) {
    directives.push(
      "Context is near provider budget; run compact/tool-result artifact flow before sending provider-visible messages.",
    );
    internalEvents.push("meta_scheduler:compact_required");
  }
  if (blockedRuntime) {
    directives.push(
      "Blocked/stale agent or workflow state is a hard stop for PASS; require real recovery, cancellation, or explicit degradation.",
    );
    internalEvents.push("meta_scheduler:blocked_runtime_stop");
  }
  directives.push(formatIndexStrategyDirective(indexStrategy, input.index));
  const verificationRoute = createVerificationRoute({
    domain: verificationDomain,
    evidenceFreshness,
    lastStatus: input.lastVerificationStatus,
    blockedRuntime,
    runtimeSignal,
    failureSignal,
    resourceCapPressure: runtimeSignal.resourceCapPressure,
    userStateDecision,
  });
  directives.push(formatVerificationRouteDirective(verificationRoute));
  directives.push(formatUserStateDirective(userStateDecision));
  appendUserStateInternalEvents(internalEvents, userStateDecision);

  const policyDecision = createPolicyDecision({
    taskKind,
    riskLevel: classifyRiskLevel({
      highRiskClaim,
      blockedRuntime,
      expectedMutating,
      providerFailure,
      toolFailure,
      pressure: pressure.shouldCompact,
      userStateDecision,
    }),
    includeMemory: (input.memoryAcceptedCount ?? 0) > 0,
    includeFailureLearning,
    compactBeforeProvider: pressure.shouldCompact,
    preferSourceFirst,
    preferWorkflow:
      taskKind === "workflow" && userStateDecision.interactionPlan.allowImplementationPush,
    preferAgent: taskKind === "agent" && userStateDecision.interactionPlan.allowImplementationPush,
    requireVerification,
    requireFinalGate: highRiskClaim || userStateDecision.verificationPlan.forbidEarlyPass,
    expectedMutating,
    requireExplicitGate: expectedMutating || blockedRuntime || Boolean(input.pendingApproval),
    providerPlan,
    blockedRuntime,
    toolFailure,
    providerFailure,
    surfaceWindowsSafeHint,
    userState: userStateDecision,
    capabilityPlan,
    permissionSignal: {
      permissionMode: input.permissionMode ?? "default",
      recentDenied: recentDeniedCount > 0,
      recentDeniedCount,
      expectedMutating,
      requireExplicitGate:
        expectedMutating ||
        blockedRuntime ||
        recentDeniedCount > 0 ||
        Boolean(input.pendingApproval),
      pendingApproval: Boolean(input.pendingApproval),
    },
    modelRouteSignal: {
      role: input.currentRole ?? "executor",
      provider: input.currentProvider ?? "unknown",
      model: input.currentModel ?? "unknown",
      fallback: Boolean(input.routeFallbackUsed || providerPlan === "fallbackCandidate"),
      providerCooldown: Boolean(input.routeProviderCooldown || input.providerCooldownBlocked),
      providerFailure: Boolean(input.routeProviderFailure || providerFailure),
      suggestedRole,
    },
    verificationSignal: {
      required: requireVerification,
      recommendedLevel: classifyVerificationLevel({
        highRiskClaim,
        expectedMutating,
        taskKind,
        blockedRuntime,
        lastStatus: input.lastVerificationStatus,
        userStateDecision,
      }),
      route: verificationRoute,
      reason: highRiskClaim
        ? "high_risk_claim"
        : taskKind === "verification"
          ? "requested"
          : expectedMutating
            ? "mutating"
            : "normal",
      ...(input.lastVerificationStatus ? { lastStatus: input.lastVerificationStatus } : {}),
    },
    runtimeSignal,
    memorySignal: {
      accepted: (input.memoryAcceptedCount ?? 0) > 0,
      acceptedCount: input.memoryAcceptedCount ?? 0,
      candidateCount: input.memoryCandidateCount ?? 0,
      autoLearningActive: Boolean(input.memoryAutoLearningActive),
    },
    failureSignal,
    architectureSignal: {
      cardPresent: Boolean(input.currentArchitectureCard),
      guardReminder: Boolean(input.currentArchitectureCard && (expectedMutating || blockedRuntime)),
      driftPending: Boolean(input.architectureDriftPending),
    },
    platformSignal: {
      platform: input.platform ?? "unknown",
      shellFamily: input.shellFamily ?? "unknown",
      terminalTier: input.terminalCapability?.tier ?? "unknown",
      windowsSafeHint: (input.platform ?? "unknown") === "win32",
    },
    budgetSignal: {
      contextPressure: pressure.shouldCompact,
      usageNearLimit: Boolean(input.roleBudgetStop),
      toolResultBudgetPressure: (input.toolResultBudgetPersistedCount ?? 0) > 0,
    },
  });

  return {
    directives,
    policyDecision,
    shouldRunFinalAnswerGate: highRiskClaim || userStateDecision.verificationPlan.forbidEarlyPass,
    shouldPreferVerifier:
      (highRiskClaim || userStateDecision.verificationPlan.strength === "release") &&
      evidenceFreshness !== "fresh",
    shouldCaptureFailureLearning: toolFailure || providerFailure,
    shouldUseRetryGuard: toolFailure || providerFailure,
    shouldCompactBeforeProvider: pressure.shouldCompact,
    shouldStopForBlockedRuntime: blockedRuntime,
    indexStrategy,
    internalEvents,
  };
}

export function formatMetaSchedulerDirective(decision: MetaSchedulerDecision): string {
  return [
    "MetaSchedulerForModel:",
    ...decision.directives.map((item) => `- ${item}`),
    `- Typed policy route: task ${decision.policyDecision.taskKind}; risk ${decision.policyDecision.riskLevel}; provider ${decision.policyDecision.providerPlan}; source-first ${decision.policyDecision.executionPlan.preferSourceFirst ? "yes" : "no"}; verification ${decision.policyDecision.executionPlan.requireVerification ? "required" : "normal"}; explicit-gate ${decision.policyDecision.permissionPlan.requireExplicitGate ? "required" : "normal"}; user-state ${decision.policyDecision.userState.kind}; capability ${decision.policyDecision.capabilitySignal.active ? "candidate" : "none"}.`,
    "- Keep RuntimeStatusForModel, UserStateDecision, capabilitySignal, capabilityPlan, CapabilityExecutionRequest, CapabilityExecutionResult, raw capability payload, interactionPlan, verificationPlan, notificationPlan, confidence, gateId, raw evidence, raw tool_result, and internal scheduler labels out of the user-visible final answer.",
  ].join("\n");
}

export function formatPolicyDecisionSummary(decision: PolicyDecision, language: Language): string {
  const parts: string[] = [];
  if (decision.executionPlan.preferSourceFirst) {
    parts.push(language === "en-US" ? "source-first" : "源码优先");
  }
  if (decision.executionPlan.requireVerification) {
    parts.push(language === "en-US" ? "verification required" : "需要验证");
  }
  if (decision.userState.interactionPlan.explainFirst) {
    parts.push(language === "en-US" ? "explain-first" : "先解释");
  }
  if (decision.userState.interactionPlan.discussionOnly) {
    parts.push(language === "en-US" ? "discussion-only" : "仅讨论判断");
  }
  if (decision.userState.interactionPlan.commandFirst) {
    parts.push(language === "en-US" ? "command-first" : "命令优先");
  }
  if (decision.userState.verificationPlan.strength === "release") {
    parts.push(language === "en-US" ? "release gate" : "发布闸门");
  }
  if (decision.contextPlan.compactBeforeProvider) {
    parts.push(language === "en-US" ? "compact before provider" : "先压缩上下文");
  }
  if (decision.providerPlan === "fallbackCandidate") {
    parts.push(language === "en-US" ? "fallback candidate ready" : "准备 fallback 候选");
  }
  if (decision.providerPlan === "cooldownBlocked") {
    parts.push(language === "en-US" ? "provider cooldown blocked" : "provider 冷却阻塞");
  }
  if (decision.executionPlan.preferWorkflow) {
    parts.push(language === "en-US" ? "workflow route" : "workflow 路线");
  }
  if (decision.executionPlan.preferAgent) {
    parts.push(language === "en-US" ? "agent route" : "agent 路线");
  }
  if (decision.capabilitySignal.active) {
    parts.push(language === "en-US" ? "capability route" : "capability 路线");
  }
  if (decision.platformSignal.windowsSafeHint) {
    parts.push(language === "en-US" ? "Windows-safe shell" : "Windows 兼容命令");
  }
  if (decision.modelRouteSignal.suggestedRole) {
    parts.push(
      language === "en-US"
        ? `suggest ${decision.modelRouteSignal.suggestedRole}`
        : `建议 ${decision.modelRouteSignal.suggestedRole}`,
    );
  }
  const summary =
    parts.length > 0
      ? parts.join("; ")
      : language === "en-US"
        ? "keep current route"
        : "保持当前路线";
  return language === "en-US"
    ? `strategy: ${summary}; task ${decision.taskKind}; risk ${decision.riskLevel}`
    : `策略：${summary}；任务 ${decision.taskKind}；风险 ${decision.riskLevel}`;
}

export type FailureLearningContractResult =
  | { satisfied: true }
  | { satisfied: false; reason: string };

/**
 * Enforce the meta-scheduler's failure-learning directive at runtime.
 * Call this after the model turn when tool/provider failures were detected.
 * If the directive required capture but no new record was added, the contract
 * is unsatisfied and the caller MUST record a degraded state event.
 */
export function verifyFailureLearningContract(input: {
  decision: Pick<MetaSchedulerDecision, "shouldCaptureFailureLearning"> &
    Partial<MetaSchedulerDecision>;
  preTurnRecordCount: number;
  postTurnRecordCount: number;
  failureKind: "tool" | "provider" | "workflow" | "verification" | "final_gate";
}): FailureLearningContractResult {
  if (!input.decision.shouldCaptureFailureLearning) {
    return { satisfied: true };
  }
  if (input.postTurnRecordCount > input.preTurnRecordCount) {
    return { satisfied: true };
  }
  return {
    satisfied: false,
    reason: `meta-scheduler required failure learning capture for ${input.failureKind} failure but no new record was added; degraded state recorded`,
  };
}

function hasHighRiskCompletionClaim(text: string): boolean {
  return /(?:\bPASS\b|\bpassed\b|\bverified\b|\btests?\s+pass(?:ed)?\b|\bfixed\b|\bcompleted\b|已完成|已修复|已验证|验证通过|测试通过|可以进入下一阶段|ready\s+for|可进入)/iu.test(
    text,
  );
}

function classifyUserStateDecision(userText: string): UserStateDecision {
  const text = userText.trim();
  if (!text) return createUserStateDecision("neutral", 0.35);
  const commandFirst = matchesDecisiveCommand(text);
  if (matchesHighStakesRelease(text)) {
    return createUserStateDecision("high_stakes_release", 0.88, {
      commandFirst,
      memorySummary:
        "User treats release/deploy/open-source readiness as high stakes; require dirty tree/build/focused verification/stability boundary.",
    });
  }
  if (matchesTrustRepair(text)) {
    return createUserStateDecision("trust_repair", 0.86, {
      commandFirst,
      memorySummary:
        "User is repairing trust after prior mismatch; require source facts before delivery summaries.",
    });
  }
  if (matchesFrustrated(text)) {
    return createUserStateDecision("frustrated", 0.78, {
      commandFirst,
      memorySummary:
        "User is frustrated by repeated shallow work; reduce generic hints and strengthen source-first verification.",
    });
  }
  if (matchesConfused(text)) {
    return createUserStateDecision("confused", 0.74);
  }
  if (matchesStrategicExploration(text)) {
    return createUserStateDecision("strategic_exploration", 0.72);
  }
  if (commandFirst) {
    return createUserStateDecision("decisive_command", 0.7);
  }
  return createUserStateDecision("neutral", 0.5);
}

function createUserStateDecision(
  kind: UserStateKind,
  confidence: number,
  options: { memorySummary?: string; commandFirst?: boolean } = {},
): UserStateDecision {
  const sourceFactFirst = kind === "frustrated" || kind === "trust_repair";
  const highStakes = kind === "high_stakes_release";
  const confused = kind === "confused";
  const strategic = kind === "strategic_exploration";
  const decisive = kind === "decisive_command" || options.commandFirst === true;
  const strengthened = sourceFactFirst || highStakes;
  const route =
    kind === "trust_repair" || kind === "frustrated"
      ? "source_fact_first"
      : highStakes
        ? "release_gate"
        : confused
          ? "explain_first"
          : strategic
            ? "discussion_only"
            : decisive
              ? "command_first"
              : "normal";
  return {
    kind,
    confidence,
    interactionPlan: {
      route,
      sourceFactsFirst: sourceFactFirst,
      commandFirst: decisive,
      explainFirst: confused,
      discussionOnly: strategic,
      allowImplementationPush: !(confused || strategic),
    },
    verificationPlan: {
      strength: highStakes ? "release" : strengthened ? "strengthened" : "normal",
      requireSourceFacts: sourceFactFirst || highStakes,
      forbidEarlyPass: sourceFactFirst || highStakes,
      requireDirtyTreeCheck: highStakes,
      requireBuild: highStakes,
      requireFocusedTests: strengthened || highStakes,
      requireStabilityBoundary: highStakes,
    },
    detailPlan: {
      style: decisive
        ? "command_first"
        : confused
          ? "explain_first"
          : strategic
            ? "discussion"
            : kind === "neutral"
              ? "normal"
              : "concise",
      background: decisive ? "minimal" : confused || strategic ? "expanded" : "normal",
    },
    notificationPlan: {
      quiet: kind === "frustrated" || kind === "trust_repair" || decisive,
      suppressGenericHints: kind !== "neutral",
      maxHints: kind === "neutral" ? 3 : 2,
    },
    memoryCandidate: {
      shouldCreate: Boolean(options.memorySummary),
      scope: "session",
      ...(options.memorySummary ? { summary: options.memorySummary } : {}),
      autoAccept: false,
    },
  };
}

function matchesHighStakesRelease(text: string): boolean {
  return /(?:发布|上线|发版|开源发布|稳定点|提交稳定点|建立稳定点|release|deploy|deployment|production|prod|open-?source|上线前|发布前|release readiness|smoke-ready|beta pass|stable point|checkpoint|commit point)/iu.test(
    text,
  );
}

function matchesTrustRepair(text: string): boolean {
  return /(?:别再|不要再|上次|之前.*(?:错|漏|幻觉|没看|没读|误判)|信任|可信|别复述|不要只复述|不要.*(?:复述|摘要)|trust repair|regain trust|don't just summarize|do not just summarize|you missed|you were wrong)/iu.test(
    text,
  );
}

function matchesFrustrated(text: string): boolean {
  return /(?:烦|崩溃|离谱|又错|还错|怎么又|别糊弄|少废话|少说多做|别废话|别绕|不要绕|别空泛|别瞎猜|frustrated|annoyed|again\?|stop guessing|stop hand-?waving|less talk|no fluff|too noisy)/iu.test(
    text,
  );
}

function matchesConfused(text: string): boolean {
  return /(?:不懂|没懂|看不懂|为什么|啥意思|什么意思|解释一下|先解释|讲清楚|怎么理解|我困惑|confused|don't understand|do not understand|explain|what does .* mean|why\b|how should i understand)/iu.test(
    text,
  );
}

function matchesStrategicExploration(text: string): boolean {
  return /(?:讨论|分析方案|架构判断|战略|路线|取舍|探索|先别写|不要写代码|不要实现|先聊|评估一下|brainstorm|strategy|strategic|explore|discuss|architecture decision|trade-?off|do not implement|don't implement|no code changes)/iu.test(
    text,
  );
}

function matchesDecisiveCommand(text: string): boolean {
  return /(?:直接给(?:我)?命令|只给命令|给(?:我)?命令|命令即可|不用解释|不要解释|只要命令|command only|just commands|give me the command|no explanation|直接执行|立刻执行|马上执行|do it now|run it now)/iu.test(
    text,
  );
}

function adjustTaskKindForUserState(
  taskKind: PolicyDecision["taskKind"],
  decision: UserStateDecision,
): PolicyDecision["taskKind"] {
  if (decision.kind === "confused" || decision.kind === "strategic_exploration") {
    return "chat";
  }
  return taskKind;
}

function classifyTaskKind(
  userText: string,
  capabilityPlan: CapabilityPlan = createEmptyCapabilityPlan(),
): PolicyDecision["taskKind"] {
  if (
    /(?:验证|复检|测试|typecheck|lint|build|test|verify|verification|claim-check)/iu.test(userText)
  ) {
    return "verification";
  }
  if (/(?:智能体|子智能体|\bagent\b|\bfork\b|multi-agent|多开)/iu.test(userText)) {
    return "agent";
  }
  if (/(?:工作流|\bworkflow\b|\bjob\b|流水线)/iu.test(userText)) {
    return "workflow";
  }
  if (capabilityPlan.route === "capability") {
    return "capability";
  }
  if (
    /(?:实现|修复|修改|更新|新增|删除|写入|创建|改动|edit|write|modify|update|fix|implement|create|delete)/iu.test(
      userText,
    )
  ) {
    return "edit";
  }
  if (
    /(?:源码|代码事实|文件|读取|定位|调用链|source|code|file|read|grep|search|inspect)/iu.test(
      userText,
    )
  ) {
    return "code_fact";
  }
  return "chat";
}

function expectsMutatingAction(
  userText: string,
  taskKind: PolicyDecision["taskKind"],
  capabilityPlan: CapabilityPlan = createEmptyCapabilityPlan(),
): boolean {
  return (
    taskKind === "edit" ||
    (taskKind === "capability" && capabilityPlan.permission !== "read") ||
    /(?:写入|修改|更新|新增|删除|创建|实现|修复|提交|commit|write|edit|modify|update|delete|create|implement|fix)/iu.test(
      userText,
    )
  );
}

function createCapabilityPlan(userText: string): CapabilityPlan {
  const text = userText.trim();
  if (!text) return createEmptyCapabilityPlan();
  const mentionsWorkflowAgentOrJob =
    /(?:智能体|子智能体|\bagent\b|\bfork\b|multi-agent|多开|工作流|\bworkflow\b|\bjob\b|流水线|后台|background|scheduler|调度)/iu.test(
      text,
    );
  if (mentionsWorkflowAgentOrJob) return createEmptyCapabilityPlan();
  const explicitCapability =
    /(?:\bcapabilit(?:y|ies)\b|能力运行时|外部能力|app bridge|应用桥|应用连接|connector|插件能力|plugin capability)/iu.test(
      text,
    );
  const externalApp =
    /(?:外部软件|外部应用|连接应用|连接软件|第三方软件|第三方应用|desktop bridge|本地应用|画布|画图|表格|spreadsheet|canvas|external app|connect app|app connector|plugin|插件|mcp|http connector|websocket)/iu.test(
      text,
    );
  if (!explicitCapability && !externalApp) return createEmptyCapabilityPlan();
  const readOnly = /(?:列表|查看|读取|查询|list|doctor|status|read|inspect|show)/iu.test(text);
  const artifact =
    /(?:导出|export|artifact|文件|保存|save|生成|create|创建|画图|画布|canvas)/iu.test(text);
  const permission = readOnly && !artifact ? "read" : externalApp ? "external_app" : "write";
  return {
    route: "capability",
    reason: explicitCapability ? "explicit_capability" : "external_app",
    candidateIds: externalApp ? ["mock.canvas.create", "mock.canvas.export"] : ["mock.echo.read"],
    permission,
    riskLevel: permission === "read" ? "low" : "medium",
  };
}

function createEmptyCapabilityPlan(): CapabilityPlan {
  return {
    route: "none",
    reason: "none",
    candidateIds: [],
    permission: "read",
    riskLevel: "low",
  };
}

function classifyVerificationDomain(
  userText: string,
  taskKind: PolicyDecision["taskKind"],
  expectedMutating: boolean,
): VerificationRouteDomain {
  if (taskKind === "capability") {
    return "agent_job_workflow";
  }
  if (
    /(?:provider|model|模型|供应商|baseUrl|api[_-]?key|\bkey\b|env|环境变量|config|配置|doctor|route|路由)/iu.test(
      userText,
    )
  ) {
    return "provider_model_config";
  }
  if (
    /(?:文档|markdown|frontmatter|link|链接|README|docs?\/|\.md\b|交付文档|delivery)/iu.test(
      userText,
    )
  ) {
    return "documentation";
  }
  if (
    /(?:\btui\b.*(?:交互|ui|render|renderer|keyboard|hotkey|面板)|terminal|终端|交互|\bink\b|render|renderer|keyboard|hotkey|快捷键|面板)/iu.test(
      userText,
    )
  ) {
    return "tui_interactive";
  }
  if (
    /(?:智能体|子智能体|\bagent\b|\bfork\b|\bjob\b|workflow|工作流|后台|background|scheduler|调度)/iu.test(
      userText,
    )
  ) {
    return "agent_job_workflow";
  }
  if (
    taskKind === "edit" ||
    expectedMutating ||
    /(?:代码|源码|ts|tsx|js|jsx|test|typecheck|lint|build|diff|实现|修复)/iu.test(userText)
  ) {
    return "code_change";
  }
  return "general";
}

function shouldSurfaceWindowsSafeHint(input: {
  userText: string;
  taskKind: PolicyDecision["taskKind"];
  expectedMutating: boolean;
  blockedRuntime: boolean;
  toolFailure: boolean;
  providerFailure: boolean;
  providerCooldownBlocked: boolean;
}): boolean {
  if (input.expectedMutating || input.taskKind === "verification") return true;
  if (input.taskKind === "workflow" || input.taskKind === "agent") return true;
  if (input.blockedRuntime || input.toolFailure || input.providerFailure) return true;
  if (input.providerCooldownBlocked) return true;
  return /(?:\bbash\b|\bshell\b|\bcmd\b|powershell|pwsh|terminal|命令行|终端|命令|路径|执行(?:命令|脚本|测试|验证)|运行(?:命令|脚本|测试|验证)|\bpath\b|\bcommand\b|\bexecute\b|\bpnpm\b|\bnpm\b|\bnpx\b|\bnode\b|\bpython\b|\bgit\b|\brun\b\s+(?:test|build|lint|script|command|shell|bash|pnpm|npm|npx|node|python|git))/iu.test(
    input.userText,
  );
}

function hasActiveFailureLearning(state: FailureLearningState): boolean {
  return state.records.some(
    (record) => record.status === "active" && record.projectScope === state.projectScope,
  );
}

function shouldPreferSourceFirst(
  taskKind: PolicyDecision["taskKind"],
  indexStrategy: MetaSchedulerDecision["indexStrategy"],
): boolean {
  if (taskKind === "code_fact" || taskKind === "edit" || taskKind === "verification") return true;
  if (taskKind === "capability") return false;
  return indexStrategy !== "ready" && taskKind !== "chat";
}

function classifyRiskLevel(input: {
  highRiskClaim: boolean;
  blockedRuntime: boolean;
  expectedMutating: boolean;
  providerFailure: boolean;
  toolFailure: boolean;
  pressure: boolean;
  userStateDecision: UserStateDecision;
}): PolicyDecision["riskLevel"] {
  if (
    input.highRiskClaim ||
    input.blockedRuntime ||
    input.userStateDecision.kind === "high_stakes_release"
  ) {
    return "high";
  }
  if (input.expectedMutating || input.providerFailure || input.toolFailure || input.pressure) {
    return "medium";
  }
  if (
    input.userStateDecision.kind === "frustrated" ||
    input.userStateDecision.kind === "trust_repair"
  ) {
    return "medium";
  }
  return "low";
}

function summarizeFailureSignal(state: FailureLearningState): PolicyDecision["failureSignal"] {
  const active = state.records.filter(
    (record) => record.status === "active" && record.projectScope === state.projectScope,
  );
  const categories = [...new Set(active.map((record) => record.category))].sort();
  return {
    activeCount: active.length,
    highSeverityCount: active.filter((record) => record.severity === "high").length,
    mediumSeverityCount: active.filter((record) => record.severity === "medium").length,
    categories,
  };
}

function createVerificationRoute(input: {
  domain: VerificationRouteDomain;
  evidenceFreshness: VerificationRoute["evidenceFreshness"];
  lastStatus?: MetaSchedulerInput["lastVerificationStatus"];
  blockedRuntime: boolean;
  runtimeSignal: PolicyDecision["runtimeSignal"];
  failureSignal: PolicyDecision["failureSignal"];
  resourceCapPressure: boolean;
  userStateDecision: UserStateDecision;
}): VerificationRoute {
  const commands = applyUserStateVerificationCommands(
    verificationCommandsForDomain(input.domain),
    input.userStateDecision,
  );
  const noPassReasons = collectNoPassReasons(input);
  return {
    domain: input.domain,
    commands,
    evidenceFreshness: input.evidenceFreshness,
    conservativeNoPass: noPassReasons.length > 0,
    noPassReasons,
  };
}

function verificationCommandsForDomain(domain: VerificationRouteDomain): string[] {
  if (domain === "documentation") {
    return ["markdown", "link", "frontmatter", "sensitive-path", "consistency"];
  }
  if (domain === "tui_interactive") {
    return ["focused-tui-tests", "build", "cli-smoke"];
  }
  if (domain === "provider_model_config") {
    return ["doctor", "provider-smoke", "config-isolation"];
  }
  if (domain === "agent_job_workflow") {
    return [
      "background-state",
      "job-state",
      "agent-state",
      "workflow-state",
      "no-pass-without-verification",
    ];
  }
  if (domain === "code_change") {
    return ["typecheck", "test", "lint", "build", "diff"];
  }
  return ["focused-verification"];
}

function applyUserStateVerificationCommands(
  commands: string[],
  decision: UserStateDecision,
): string[] {
  const next = [...commands];
  if (decision.verificationPlan.requireSourceFacts) {
    next.unshift("source-facts");
  }
  if (decision.verificationPlan.requireDirtyTreeCheck) {
    next.push("dirty-tree");
    next.push("untracked-files");
  }
  if (decision.verificationPlan.requireFocusedTests) {
    next.push("focused-test");
  }
  if (decision.verificationPlan.requireBuild) {
    next.push("build");
  }
  if (decision.verificationPlan.requireStabilityBoundary) {
    next.push("stability-boundary");
  }
  return [...new Set(next)];
}

function collectNoPassReasons(input: {
  domain: VerificationRouteDomain;
  evidenceFreshness: VerificationRoute["evidenceFreshness"];
  lastStatus?: MetaSchedulerInput["lastVerificationStatus"];
  blockedRuntime: boolean;
  runtimeSignal: PolicyDecision["runtimeSignal"];
  failureSignal: PolicyDecision["failureSignal"];
  resourceCapPressure: boolean;
  userStateDecision: UserStateDecision;
}): string[] {
  const reasons: string[] = [];
  if (input.domain !== "general" && input.evidenceFreshness !== "fresh") {
    reasons.push(`evidence:${input.evidenceFreshness}`);
  }
  if (input.userStateDecision.verificationPlan.forbidEarlyPass) {
    reasons.push(`user_state:${input.userStateDecision.kind}`);
  }
  if (input.lastStatus && input.lastStatus !== "pass") {
    reasons.push(`verification:${input.lastStatus}`);
  }
  if (input.blockedRuntime || input.runtimeSignal.noPassStates.length > 0) {
    reasons.push(...input.runtimeSignal.noPassStates);
  }
  if (input.runtimeSignal.completedWithoutFreshVerification) {
    reasons.push("completed_without_fresh_verification");
  }
  if (input.failureSignal.activeCount > 0) {
    reasons.push("active_failure_learning");
  }
  if (input.resourceCapPressure) {
    reasons.push("resource_guard_pressure");
  }
  return [...new Set(reasons)];
}

function formatVerificationRouteDirective(route: VerificationRoute): string {
  const noPass = route.conservativeNoPass
    ? ` conservative-no-pass=${route.noPassReasons.join(",")}`
    : " conservative-no-pass=no";
  return `Verification route: domain=${route.domain}; commands=${route.commands.join("+")}; evidence=${route.evidenceFreshness};${noPass}.`;
}

function formatUserStateDirective(decision: UserStateDecision): string {
  return `UserStateDecision: kind=${decision.kind}; confidence=${decision.confidence.toFixed(2)}; interaction=${decision.interactionPlan.route}; verification=${decision.verificationPlan.strength}; detail=${decision.detailPlan.style}; notification=${decision.notificationPlan.quiet ? "quiet" : "normal"}; memoryCandidate=${decision.memoryCandidate.shouldCreate ? "candidate_only" : "none"}.`;
}

function appendUserStateInternalEvents(events: string[], decision: UserStateDecision): void {
  if (decision.kind === "neutral") return;
  events.push(`user_state_decision:${decision.kind}`);
  if (decision.verificationPlan.forbidEarlyPass) {
    events.push("user_state:forbid_early_pass");
  }
  if (!decision.interactionPlan.allowImplementationPush) {
    events.push("user_state:no_implementation_push");
  }
}

function classifyVerificationLevel(input: {
  highRiskClaim: boolean;
  expectedMutating: boolean;
  taskKind: PolicyDecision["taskKind"];
  blockedRuntime: boolean;
  lastStatus?: MetaSchedulerInput["lastVerificationStatus"];
  userStateDecision: UserStateDecision;
}): PolicyDecision["verificationSignal"]["recommendedLevel"] {
  if (input.userStateDecision.verificationPlan.strength === "release") return "full";
  if (input.userStateDecision.verificationPlan.strength === "strengthened") return "full";
  if (input.highRiskClaim || input.blockedRuntime) return "full";
  if (
    input.lastStatus === "fail" ||
    input.lastStatus === "timeout" ||
    input.lastStatus === "stale"
  ) {
    return "full";
  }
  if (
    input.lastStatus === "partial" ||
    input.lastStatus === "cancelled" ||
    input.lastStatus === "skipped"
  ) {
    return "focused";
  }
  if (input.expectedMutating || input.taskKind === "verification") return "focused";
  return "basic";
}

function isRiskyVerificationStatus(status: MetaSchedulerInput["lastVerificationStatus"]): boolean {
  return (
    status === "fail" ||
    status === "partial" ||
    status === "stale" ||
    status === "cancelled" ||
    status === "timeout"
  );
}

function summarizeRuntimeSignal(
  input: {
    backgroundTasks: BackgroundTaskState[];
    workflow?: ActiveWorkflowRun;
    activeAgentCount?: number;
    activeJobCount?: number;
    activeWorkflowStatus?: MetaSchedulerInput["activeWorkflowStatus"];
  },
  evidenceFreshness: VerificationRoute["evidenceFreshness"],
): PolicyDecision["runtimeSignal"] {
  const runningAgents =
    input.activeAgentCount ??
    input.backgroundTasks.filter((task) => task.kind === "agent" && task.status === "running")
      .length;
  const runningJobs =
    input.activeJobCount ??
    input.backgroundTasks.filter((task) => task.kind === "job" && task.status === "running").length;
  const workflowStatus =
    input.activeWorkflowStatus ??
    normalizeWorkflowRuntimeStatus(input.workflow?.status, input.workflow?.steps);
  const agentStates = countRuntimeStates(input.backgroundTasks, "agent");
  const jobStates = countRuntimeStates(input.backgroundTasks, "job");
  const noPassStates = collectRuntimeNoPassStates(input.backgroundTasks, input.workflow);
  const completedWithoutFreshVerification =
    evidenceFreshness !== "fresh" &&
    (agentStates.completed > 0 ||
      jobStates.completed > 0 ||
      input.workflow?.status === "completed");
  return {
    runningAgents,
    runningJobs,
    ...(workflowStatus ? { workflowStatus } : {}),
    agentStates,
    jobStates,
    completedWithoutFreshVerification,
    noPassStates,
    resourceCapPressure: runningAgents > 0 || runningJobs > 0,
  };
}

function countRuntimeStates(
  tasks: BackgroundTaskState[],
  kind: "agent" | "job",
): RuntimeStateCounts {
  const counts: RuntimeStateCounts = {
    running: 0,
    completed: 0,
    blocked: 0,
    stale: 0,
    cancelled: 0,
    timeout: 0,
  };
  for (const task of tasks) {
    if (task.kind !== kind) continue;
    if (task.status in counts) {
      counts[task.status as keyof RuntimeStateCounts] += 1;
    }
  }
  return counts;
}

function collectRuntimeNoPassStates(
  tasks: BackgroundTaskState[],
  workflow: WorkflowState["activeRun"] | undefined,
): string[] {
  const reasons: string[] = [];
  for (const task of tasks) {
    if (task.kind !== "agent" && task.kind !== "job") continue;
    if (
      task.status === "blocked" ||
      task.status === "stale" ||
      task.status === "cancelled" ||
      task.status === "timeout"
    ) {
      reasons.push(`${task.kind}:${task.status}`);
    }
    if (task.result === "stale" || task.result === "cancelled" || task.result === "timeout") {
      reasons.push(`${task.kind}:${task.result}`);
    }
    if (task.status === "completed" && task.result !== "pass") {
      reasons.push(`${task.kind}:completed_not_pass`);
    }
  }
  if (
    workflow?.status === "blocked" ||
    workflow?.status === "stale" ||
    workflow?.status === "cancelled"
  ) {
    reasons.push(`workflow:${workflow.status}`);
  }
  if (workflow?.status === "completed") {
    reasons.push("workflow:completed_not_pass");
  }
  for (const step of workflow?.steps ?? []) {
    if (step.status === "blocked" || step.status === "stale" || step.status === "cancelled") {
      reasons.push(`workflow_step:${step.status}`);
    }
  }
  return [...new Set(reasons)];
}

function normalizeWorkflowRuntimeStatus(
  status: ActiveWorkflowRun["status"] | undefined,
  steps: ActiveWorkflowRun["steps"] | undefined,
): PolicyDecision["runtimeSignal"]["workflowStatus"] | undefined {
  if (status === "blocked") return "blocked";
  if (status === "running") return "running";
  if (steps?.some((step) => step.status === "stale")) return "stale";
  if (steps?.some((step) => step.status === "blocked")) return "blocked";
  return undefined;
}

function createPolicyDecision(input: {
  taskKind: PolicyDecision["taskKind"];
  riskLevel: PolicyDecision["riskLevel"];
  includeMemory: boolean;
  includeFailureLearning: boolean;
  compactBeforeProvider: boolean;
  preferSourceFirst: boolean;
  preferWorkflow: boolean;
  preferAgent: boolean;
  requireVerification: boolean;
  requireFinalGate: boolean;
  expectedMutating: boolean;
  requireExplicitGate: boolean;
  providerPlan: PolicyDecision["providerPlan"];
  blockedRuntime: boolean;
  toolFailure: boolean;
  providerFailure: boolean;
  surfaceWindowsSafeHint: boolean;
  userState: UserStateDecision;
  permissionSignal: PolicyDecision["permissionSignal"];
  modelRouteSignal: PolicyDecision["modelRouteSignal"];
  verificationSignal: PolicyDecision["verificationSignal"];
  memorySignal: PolicyDecision["memorySignal"];
  failureSignal: PolicyDecision["failureSignal"];
  architectureSignal: PolicyDecision["architectureSignal"];
  platformSignal: PolicyDecision["platformSignal"];
  budgetSignal: PolicyDecision["budgetSignal"];
  capabilityPlan: CapabilityPlan;
  runtimeSignal: PolicyDecision["runtimeSignal"];
}): PolicyDecision {
  const hints: PolicyHint[] = [];
  if (
    input.userState.kind === "frustrated" ||
    input.userState.kind === "trust_repair" ||
    input.userState.kind === "high_stakes_release"
  ) {
    hints.push({
      id: `user-state-${input.userState.kind}`,
      severity: input.userState.kind === "high_stakes_release" ? "warning" : "info",
      text: {
        "zh-CN":
          input.userState.kind === "high_stakes_release"
            ? "策略：发布风险较高，先做工作树、构建和验证边界检查。"
            : "策略：先核对源码事实，再给结论。",
        "en-US":
          input.userState.kind === "high_stakes_release"
            ? "Strategy: release risk is high; checking worktree, build, and verification boundaries first."
            : "Strategy: checking source facts before conclusions.",
      },
    });
  }
  if (input.userState.kind === "decisive_command") {
    hints.push({
      id: "user-state-command-first",
      severity: "info",
      text: {
        "zh-CN": "策略：命令优先，减少背景解释。",
        "en-US": "Strategy: command-first; reducing background explanation.",
      },
    });
  }
  if (input.userState.kind === "confused") {
    hints.push({
      id: "user-state-explain-first",
      severity: "info",
      text: {
        "zh-CN": "策略：先解释，不直接推进实现。",
        "en-US": "Strategy: explain-first; not pushing implementation yet.",
      },
    });
  }
  if (input.userState.kind === "strategic_exploration") {
    hints.push({
      id: "user-state-discussion-only",
      severity: "info",
      text: {
        "zh-CN": "策略：保持讨论和架构判断，不启动代码执行。",
        "en-US": "Strategy: staying in discussion/architecture judgment; no code execution route.",
      },
    });
  }
  if (input.permissionSignal.requireExplicitGate) {
    hints.push({
      id: "permission-risk",
      severity: "warning",
      text: {
        "zh-CN": "策略：检测到权限风险，写入前会请求确认。",
        "en-US": "Strategy: permission risk detected; write actions will ask before running.",
      },
    });
  }
  if (input.platformSignal.windowsSafeHint && input.surfaceWindowsSafeHint) {
    hints.push({
      id: "windows-safe",
      severity: "info",
      text: {
        "zh-CN": "策略：Windows 环境，优先使用兼容命令。",
        "en-US": "Strategy: Windows environment; using compatible commands first.",
      },
    });
  }
  if (input.preferSourceFirst) {
    hints.push({
      id: "source-first",
      severity: "info",
      text: {
        "zh-CN": "策略：源码优先，先读取关键文件。",
        "en-US": "Strategy: source-first; reading key files before answering.",
      },
    });
  }
  if (input.requireVerification) {
    hints.push({
      id: "verification-required",
      severity: input.riskLevel === "high" ? "warning" : "info",
      text: {
        "zh-CN":
          input.verificationSignal.recommendedLevel === "focused"
            ? "策略：建议先做 focused verification。"
            : "策略：高风险结论需要验证后再说通过。",
        "en-US":
          input.verificationSignal.recommendedLevel === "focused"
            ? "Strategy: focused verification is recommended before completion."
            : "Strategy: high-risk claims need verification before PASS.",
      },
    });
  }
  if (input.architectureSignal.guardReminder) {
    hints.push({
      id: "architecture-guard",
      severity: "warning",
      text: {
        "zh-CN": "策略：已有架构卡片，写入会继续走架构边界检查。",
        "en-US": "Strategy: architecture card is active; edits keep architecture guard checks.",
      },
    });
  }
  if (input.compactBeforeProvider) {
    hints.push({
      id: "compact-before-provider",
      severity: "warning",
      text: {
        "zh-CN": "策略：上下文接近上限，先压缩再请求模型。",
        "en-US": "Strategy: context is near limit; compacting before provider request.",
      },
    });
  }
  if (input.blockedRuntime) {
    hints.push({
      id: "blocked-runtime",
      severity: "warning",
      text: {
        "zh-CN": "策略：已有任务阻塞，先检查 workflow/agent 状态。",
        "en-US": "Strategy: blocked runtime detected; checking workflow/agent state first.",
      },
    });
  }
  if (input.runtimeSignal.resourceCapPressure) {
    hints.push({
      id: "background-occupancy",
      severity: "info",
      text: {
        "zh-CN": "策略：已有后台 agent/job 占用，先避免重复启动。",
        "en-US": "Strategy: background agent/job is already running; avoiding duplicate starts.",
      },
    });
  }
  if (input.capabilityPlan.route === "capability") {
    hints.push({
      id: "capability-route",
      severity: input.capabilityPlan.riskLevel === "high" ? "warning" : "info",
      text: {
        "zh-CN": "策略：识别为 capability 候选；执行仍走显式命令和权限边界。",
        "en-US":
          "Strategy: capability candidate detected; execution still uses explicit commands and permission gates.",
      },
    });
  }
  if (input.providerPlan === "fallbackCandidate") {
    hints.push({
      id: "provider-fallback",
      severity: "warning",
      text: {
        "zh-CN": "策略：Provider 最近失败，准备 fallback 候选。",
        "en-US": "Strategy: provider failure detected; keeping fallback candidate ready.",
      },
    });
  }
  if (input.providerPlan === "cooldownBlocked") {
    hints.push({
      id: "provider-cooldown",
      severity: "warning",
      text: {
        "zh-CN": "策略：Provider 冷却中，暂停本轮请求。",
        "en-US": "Strategy: provider cooldown is active; pausing this request.",
      },
    });
  }
  if (input.includeFailureLearning || input.toolFailure || input.providerFailure) {
    hints.push({
      id: "failure-learning",
      severity: input.riskLevel === "high" ? "warning" : "info",
      text: {
        "zh-CN": "策略：参考历史失败，只作为风险提示。",
        "en-US": "Strategy: using failure lessons as risk hints only.",
      },
    });
  }
  if (input.includeMemory) {
    hints.push({
      id: "memory",
      severity: "info",
      text: {
        "zh-CN": "策略：带入已接受记忆作为约束。",
        "en-US": "Strategy: using accepted memory as constraints.",
      },
    });
  }
  return {
    taskKind: input.taskKind,
    riskLevel: input.riskLevel,
    permissionSignal: input.permissionSignal,
    modelRouteSignal: input.modelRouteSignal,
    verificationSignal: input.verificationSignal,
    memorySignal: input.memorySignal,
    failureSignal: input.failureSignal,
    architectureSignal: input.architectureSignal,
    platformSignal: input.platformSignal,
    budgetSignal: input.budgetSignal,
    capabilitySignal: {
      active: input.capabilityPlan.route === "capability",
      reason: input.capabilityPlan.reason,
      candidateIds: input.capabilityPlan.candidateIds,
      permission: input.capabilityPlan.permission,
      riskLevel: input.capabilityPlan.riskLevel,
    },
    capabilityPlan: input.capabilityPlan,
    runtimeSignal: input.runtimeSignal,
    userState: input.userState,
    contextPlan: {
      includeMemory: input.includeMemory,
      includeFailureLearning: input.includeFailureLearning,
      compactBeforeProvider: input.compactBeforeProvider,
    },
    executionPlan: {
      preferSourceFirst: input.preferSourceFirst,
      preferWorkflow: input.preferWorkflow,
      preferAgent: input.preferAgent,
      requireVerification: input.requireVerification,
      requireFinalGate: input.requireFinalGate,
    },
    permissionPlan: {
      expectedMutating: input.expectedMutating,
      requireExplicitGate: input.requireExplicitGate,
    },
    providerPlan: input.providerPlan,
    hints,
  };
}

function classifyVerificationEvidenceFreshness(
  evidence: EvidenceRecord[],
  nowMs = Date.now(),
): VerificationRoute["evidenceFreshness"] {
  const passEvidence = evidence.filter((item) =>
    item.supportsClaims.some((claim) =>
      /^(?:verification_passed|test_passed|typecheck_passed|build_passed|lint_passed|diff_check_passed|smoke_passed)$/u.test(
        claim,
      ),
    ),
  );
  if (passEvidence.length === 0) return "missing";
  const freshWindowMs = 30 * 60 * 1000;
  return passEvidence.some((item) => {
    const createdAt = Date.parse(item.createdAt);
    return Number.isFinite(createdAt) && nowMs - createdAt <= freshWindowMs;
  })
    ? "fresh"
    : "stale";
}

function computeContextPressure(
  messages: ModelMessage[] | undefined,
  estimatedContextChars: number | undefined,
  contextMaxChars: number | undefined,
  triggerChars: number | undefined,
): { shouldCompact: boolean } {
  if (!contextMaxChars || !triggerChars) return { shouldCompact: false };
  const chars = estimatedContextChars ?? (messages ? estimateModelMessageChars(messages) : 0);
  return { shouldCompact: chars > Math.min(contextMaxChars, triggerChars) };
}

function classifyIndexStrategy(index: IndexState): MetaSchedulerDecision["indexStrategy"] {
  if (!index.enabled || index.status === "disabled") return "disabled";
  if (index.status === "ready" || index.status === "indexing") return "ready";
  if (index.status === "stale") return "stale";
  if (index.status === "unknown-project") return "unknown-project";
  if (index.status === "missing") return "missing";
  if (index.status === "error") return "error";
  return index.projectName ? "stale" : "unknown-project";
}

function formatIndexStrategyDirective(
  strategy: MetaSchedulerDecision["indexStrategy"],
  index: IndexState,
): string {
  const project = index.projectName ? ` project=${index.projectName}` : "";
  if (strategy === "ready") {
    return `Index strategy:${project} ready/indexing; use index as a locator, then confirm with source before editing or claiming facts.`;
  }
  if (strategy === "stale") {
    return `Index strategy:${project} stale/unknown; prefer refresh or source confirmation before relying on index facts.`;
  }
  if (strategy === "unknown-project") {
    return "Index strategy: unknown project; do not treat index facts as ready, use direct source reads or ask for index repair.";
  }
  if (strategy === "disabled") {
    return "Index strategy: disabled; rely on direct source reads and local search.";
  }
  if (strategy === "missing") {
    return "Index strategy: missing; use direct source reads/local search and suggest /index init fast only when useful.";
  }
  return "Index strategy: error; use direct source reads/local search and surface a short degraded index action.";
}

function hasBlockedAgentOrWorkflow(
  backgroundTasks: BackgroundTaskState[],
  workflow: WorkflowState["activeRun"] | undefined,
): boolean {
  if (workflow?.status === "blocked") return true;
  if (workflow?.steps.some((step) => step.status === "blocked" || step.status === "stale")) {
    return true;
  }
  return backgroundTasks.some(
    (task) =>
      (task.kind === "agent" || task.kind === "job") &&
      (task.status === "blocked" ||
        task.status === "paused" ||
        task.status === "stale" ||
        task.status === "cancelled" ||
        task.status === "timeout" ||
        task.result === "stale" ||
        task.result === "cancelled" ||
        task.result === "timeout"),
  );
}
