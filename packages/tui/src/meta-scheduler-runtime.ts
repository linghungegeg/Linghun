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
import { evaluateUserStateSignal } from "./user-state-signal-runtime.js";
import {
  LINGHUN_AGENT_CHILD_TURNS_AGENT,
  LINGHUN_AGENT_CHILD_TURNS_BASE,
  LINGHUN_AGENT_CHILD_TURNS_CODE_FACT,
  LINGHUN_AGENT_CHILD_TURNS_VERIFICATION,
  LINGHUN_AGENT_CHILD_TURNS_WORKFLOW,
  LINGHUN_AGENT_TOOL_ROUNDS_AGENT,
  LINGHUN_AGENT_TOOL_ROUNDS_BASE,
  LINGHUN_AGENT_TOOL_ROUNDS_CODE_FACT,
  LINGHUN_AGENT_TOOL_ROUNDS_VERIFICATION,
  LINGHUN_AGENT_TOOL_ROUNDS_WORKFLOW,
  LINGHUN_BACKGROUND_CONCURRENCY_AGENT,
  LINGHUN_BACKGROUND_CONCURRENCY_BASE,
  LINGHUN_BACKGROUND_CONCURRENCY_CODE_FACT,
  LINGHUN_BACKGROUND_CONCURRENCY_VERIFICATION,
  LINGHUN_BACKGROUND_CONCURRENCY_WORKFLOW,
  LINGHUN_MAX_TODO_ONLY_AGENT,
  LINGHUN_MAX_TODO_ONLY_BASE,
  LINGHUN_MAX_TODO_ONLY_CODE_FACT,
  LINGHUN_MAX_TODO_ONLY_VERIFICATION,
  LINGHUN_MAX_TODO_ONLY_WORKFLOW,
} from "./runtime-budget.js";
import {
  detectEngineeringArtifactTargets,
  type EngineeringFailureCategory,
  type EngineeringTaskProfile,
  formatEngineeringFailureBoundaryHint,
  formatEngineeringProfileStrategyHint,
} from "./headless-bench-runtime.js";

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
  engineeringProfile?: EngineeringTaskProfile;
  engineeringFailureCategory?: EngineeringFailureCategory;
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
  hasActiveProviderFailure?: boolean;
  terminalCapability?: Pick<TerminalCapability, "tier" | "alternateScreen" | "cursorPositioning">;
  platform?: NodeJS.Platform;
  shellFamily?: "powershell" | "cmd" | "bash" | "zsh" | "sh" | "unknown";
  usageSampleCount?: number;
  roleBudgetStop?: boolean;
  toolResultBudgetPersistedCount?: number;
  userStateDecision?: UserStateDecision;
  userStateDismissedUntilMs?: number;
  userStateCooldownUntilMs?: number;
  userStatePolicyEnabled?: boolean;
  loading?: boolean;
  activePrompt?: boolean;
  otherPanelOpen?: boolean;
  nowMs?: number;
  /** 跨轮连续性信号 */
  consecutiveFailures?: number;
  consecutiveSuccesses?: number;
  taskDomainSwitched?: boolean;
  userStatePersistence?: number;
  trustScore?: number;
  totalTurns?: number;
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
  engineeringSignal: {
    profile: EngineeringTaskProfile;
    strategyHint: string;
    artifactTargets: string[];
    failureCategory?: EngineeringFailureCategory;
    finalBoundaryHint?: string;
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
  userStatePersistence: number;
};

export type TaskIntent = {
  kind: PolicyDecision["taskKind"];
  score: number; // 0-100
};

export type TaskClassification = {
  primary: PolicyDecision["taskKind"];
  secondaries: PolicyDecision["taskKind"][];
  intentUnclear: boolean;
  reason: string; // 调试用，写 internalEvents
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
  /** Adaptive planning budget: derived from taskKind, fed into the runaway guard loop. */
  suggestedMaxTodoRounds: number;
  /** Adaptive agent child turn budget: derived from taskKind. */
  suggestedMaxAgentChildTurns: number;
  /** Adaptive agent tool rounds budget: derived from taskKind. */
  suggestedMaxAgentToolRounds: number;
  /** Adaptive background concurrency budget: derived from taskKind. */
  suggestedBackgroundConcurrency: number;
  internalEvents: string[];
};

export function evaluateMetaScheduler(input: MetaSchedulerInput): MetaSchedulerDecision {
  const internalEvents: string[] = [];
  const directives: string[] = [];
  const userStateSignal =
    input.userStateDecision ??
    evaluateUserStateSignal({
      userText: input.userText,
      repeatedFailureCount:
        (input.lastToolFailure ||
        input.providerFailure ||
        isRiskyVerificationStatus(input.lastVerificationStatus)
          ? 1
          : 0) + countRecentFailureLearning(input.failureLearning),
      events: [
        ...(input.lastToolFailure
          ? [
              {
                kind: "tool_failure" as const,
                summary: `${input.lastToolFailure.toolName}: ${input.lastToolFailure.summary}`,
              },
            ]
          : []),
        ...(input.providerFailure
          ? [
              {
                kind: "provider_failure" as const,
                summary: `${input.providerFailure.provider}/${input.providerFailure.model}: ${input.providerFailure.message}`,
              },
            ]
          : []),
        ...(isRiskyVerificationStatus(input.lastVerificationStatus)
          ? [
              {
                kind: "verification_failure" as const,
                summary: `last verification ${input.lastVerificationStatus}`,
              },
            ]
          : []),
      ],
      loading: input.loading,
      activePrompt: input.activePrompt,
      otherPanelOpen: input.otherPanelOpen,
      dismissedUntilMs: input.userStateDismissedUntilMs,
      cooldownUntilMs: input.userStateCooldownUntilMs,
      policyEnabled: input.userStatePolicyEnabled,
      backgroundTasks: input.backgroundTasks,
      nowMs: input.nowMs,
    }).decision;
  const userStateDecision = input.userStateDecision ?? userStateSignal;
  const highRiskClaim =
    typeof input.assistantText === "string" && hasHighRiskCompletionClaim(input.assistantText);
  const toolFailure = Boolean(input.lastToolFailure);
  const providerFailure = Boolean(input.providerFailure);
  const blockedRuntime = hasActiveBlockedWorkflow(input.workflow);
  const pressure = computeContextPressure(
    input.messages,
    input.estimatedContextChars,
    input.contextMaxChars,
    input.triggerChars,
  );
  const indexStrategy = classifyIndexStrategy(input.index);
  const capabilityPlan = createCapabilityPlan(input.userText);
  const classification = classifyTaskKind(input.userText, capabilityPlan, {
    consecutiveFailures: input.consecutiveFailures,
    taskDomainSwitched: input.taskDomainSwitched,
    lastVerificationStatus: input.lastVerificationStatus,
    userStatePersistence: input.userStatePersistence,
    failureLearning: input.failureLearning,
    hasActiveProviderFailure: input.hasActiveProviderFailure,
  });
  let taskKind = adjustTaskKindForUserState(classification.primary, userStateDecision);
  if (classification.intentUnclear) {
    taskKind = "chat";
    directives.push("用户意图不明确，先澄清再操作");
    internalEvents.push("meta_scheduler:intent_unclear_clarify");
  }
  if (classification.reason) {
    internalEvents.push(`meta_scheduler:classifier_reason=${classification.reason}`);
  }
  const expectedMutating =
    userStateDecision.interactionPlan.allowImplementationPush &&
    expectsMutatingAction(input.userText, taskKind, capabilityPlan);
  const verificationDomain = classifyVerificationDomain(input.userText, taskKind, expectedMutating);
  const evidenceFreshness = classifyVerificationEvidenceFreshness(input.evidence, input.nowMs);
  const runtimeSignal = summarizeRuntimeSignal(input, evidenceFreshness);
  const includeFailureLearning = hasActiveFailureLearning(input.failureLearning);
  const failureSignal = summarizeFailureSignal(input.failureLearning);
  let preferSourceFirst =
    shouldPreferSourceFirst(taskKind, indexStrategy) ||
    userStateDecision.interactionPlan.sourceFactsFirst;
  let requireVerification =
    highRiskClaim ||
    taskKind === "verification" ||
    expectedMutating ||
    isRiskyVerificationStatus(input.lastVerificationStatus) ||
    userStateDecision.verificationPlan.strength === "strengthened" ||
    userStateDecision.verificationPlan.strength === "release";
  if (classification.secondaries.includes("code_fact")) {
    preferSourceFirst = true;
  }
  if (classification.secondaries.includes("verification")) {
    requireVerification = true;
  }
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
  const engineeringProfile = input.engineeringProfile ?? "generic";
  const inferredFailureCategory =
    input.engineeringFailureCategory ??
    inferEngineeringFailureCategory({
      providerFailure,
      lastVerificationStatus: input.lastVerificationStatus,
      lastToolFailure: input.lastToolFailure,
    });
  const finalBoundaryHint = formatEngineeringFailureBoundaryHint({
    profile: engineeringProfile,
    failureCategory: inferredFailureCategory,
  });
  const engineeringSignal: PolicyDecision["engineeringSignal"] = {
    profile: engineeringProfile,
    strategyHint: formatEngineeringProfileStrategyHint(engineeringProfile),
    artifactTargets: detectEngineeringArtifactTargets(input.userText),
    ...(inferredFailureCategory ? { failureCategory: inferredFailureCategory } : {}),
    ...(finalBoundaryHint ? { finalBoundaryHint } : {}),
  };

  // 连续性信号驱动的决策增强
  const trustScore = input.trustScore ?? 50;
  const consecutiveFailures = input.consecutiveFailures ?? 0;
  const consecutiveSuccesses = input.consecutiveSuccesses ?? 0;
  const taskDomainSwitched = input.taskDomainSwitched ?? false;
  const userStatePersistence = input.userStatePersistence ?? 1;
  const totalTurns = input.totalTurns ?? 0;

  let adjustedUserStateDecision = userStateDecision;
  let adjustedIncludeFailureLearning = includeFailureLearning;
  let adjustedShouldCompact = pressure.shouldCompact;
  let adjustedRequireVerification = requireVerification;
  let adjustedRequireFinalGate = highRiskClaim || userStateDecision.verificationPlan.forbidEarlyPass;
  let adjustedShouldUseRetryGuard = toolFailure || providerFailure;
  let adjustedVerificationStrength = userStateDecision.verificationPlan.strength;

  if (trustScore < 30 && userStateDecision.kind === "neutral") {
    adjustedUserStateDecision = {
      ...userStateDecision,
      kind: "trust_repair",
      interactionPlan: { ...userStateDecision.interactionPlan, sourceFactsFirst: true, explainFirst: true },
    };
    internalEvents.push("meta_scheduler:continuity_trust_repair_escalation");
  }

  if (consecutiveFailures >= 2) {
    adjustedShouldUseRetryGuard = true;
    internalEvents.push("meta_scheduler:continuity_retry_guard_escalation");
  }

  if (consecutiveSuccesses >= 5 && trustScore > 70) {
    adjustedVerificationStrength = "focused";
    adjustedRequireFinalGate = false;
    internalEvents.push("meta_scheduler:continuity_verification_downgrade");
  }

  if (taskDomainSwitched) {
    adjustedIncludeFailureLearning = false;
    internalEvents.push("meta_scheduler:continuity_domain_switch_failure_reset");
  }

  if (userStatePersistence >= 5) {
    directives.push(
      `User state "${userStateDecision.kind}" persisted for ${userStatePersistence} turns; suppressing repeat hints for 5 minutes.`,
    );
    internalEvents.push("meta_scheduler:continuity_user_state_cooldown");
  }

  if (totalTurns > 30) {
    adjustedShouldCompact = true;
    internalEvents.push("meta_scheduler:continuity_long_session_compact");
  }

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
    userStateDecision: adjustedUserStateDecision,
  });
  directives.push(formatVerificationRouteDirective(verificationRoute));
  directives.push(formatUserStateDirective(adjustedUserStateDecision));
  appendUserStateInternalEvents(internalEvents, adjustedUserStateDecision);

  const policyDecision = createPolicyDecision({
    taskKind,
    riskLevel: classifyRiskLevel({
      highRiskClaim,
      blockedRuntime,
      expectedMutating,
      providerFailure,
      toolFailure,
      pressure: pressure.shouldCompact,
      userStateDecision: adjustedUserStateDecision,
    }),
    includeMemory: (input.memoryAcceptedCount ?? 0) > 0,
    includeFailureLearning: adjustedIncludeFailureLearning,
    compactBeforeProvider: adjustedShouldCompact,
    preferSourceFirst,
    preferWorkflow:
      taskKind === "workflow" && adjustedUserStateDecision.interactionPlan.allowImplementationPush,
    preferAgent: taskKind === "agent" && adjustedUserStateDecision.interactionPlan.allowImplementationPush,
    requireVerification: adjustedRequireVerification,
    requireFinalGate: adjustedRequireFinalGate,
    expectedMutating,
    requireExplicitGate: expectedMutating || blockedRuntime || Boolean(input.pendingApproval),
    providerPlan,
    blockedRuntime,
    toolFailure,
    providerFailure,
    surfaceWindowsSafeHint,
    userState: adjustedUserStateDecision,
    capabilityPlan,
    userStatePersistence,
    engineeringSignal,
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
      required: adjustedRequireVerification,
      recommendedLevel: adjustedVerificationStrength === "focused"
        ? "focused"
        : classifyVerificationLevel({
            highRiskClaim,
            expectedMutating,
            taskKind,
            blockedRuntime,
            lastStatus: input.lastVerificationStatus,
            userStateDecision: adjustedUserStateDecision,
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
      contextPressure: adjustedShouldCompact,
      usageNearLimit: Boolean(input.roleBudgetStop),
      toolResultBudgetPressure: (input.toolResultBudgetPersistedCount ?? 0) > 0,
    },
  });

  return {
    directives,
    policyDecision,
    shouldRunFinalAnswerGate: adjustedRequireFinalGate,
    shouldPreferVerifier:
      (highRiskClaim || adjustedUserStateDecision.verificationPlan.strength === "release") &&
      evidenceFreshness !== "fresh",
    shouldCaptureFailureLearning: toolFailure || providerFailure,
    shouldUseRetryGuard: adjustedShouldUseRetryGuard,
    shouldCompactBeforeProvider: adjustedShouldCompact,
    shouldStopForBlockedRuntime: blockedRuntime,
    indexStrategy,
    suggestedMaxTodoRounds: computeSuggestedMaxTodoRounds(taskKind),
    suggestedMaxAgentChildTurns: computeSuggestedAgentChildTurns(taskKind),
    suggestedMaxAgentToolRounds: computeSuggestedAgentToolRounds(taskKind),
    suggestedBackgroundConcurrency: computeSuggestedBackgroundConcurrency(taskKind),
    internalEvents,
  };
}

function computeSuggestedMaxTodoRounds(taskKind: PolicyDecision["taskKind"]): number {
  switch (taskKind) {
    case "agent":
      return LINGHUN_MAX_TODO_ONLY_AGENT;
    case "workflow":
      return LINGHUN_MAX_TODO_ONLY_WORKFLOW;
    case "verification":
      return LINGHUN_MAX_TODO_ONLY_VERIFICATION;
    case "code_fact":
      return LINGHUN_MAX_TODO_ONLY_CODE_FACT;
    default:
      return LINGHUN_MAX_TODO_ONLY_BASE;
  }
}

function computeSuggestedAgentChildTurns(taskKind: PolicyDecision["taskKind"]): number {
  switch (taskKind) {
    case "agent":
      return LINGHUN_AGENT_CHILD_TURNS_AGENT;
    case "workflow":
      return LINGHUN_AGENT_CHILD_TURNS_WORKFLOW;
    case "verification":
      return LINGHUN_AGENT_CHILD_TURNS_VERIFICATION;
    case "code_fact":
      return LINGHUN_AGENT_CHILD_TURNS_CODE_FACT;
    default:
      return LINGHUN_AGENT_CHILD_TURNS_BASE;
  }
}

function computeSuggestedAgentToolRounds(taskKind: PolicyDecision["taskKind"]): number {
  switch (taskKind) {
    case "agent":
      return LINGHUN_AGENT_TOOL_ROUNDS_AGENT;
    case "workflow":
      return LINGHUN_AGENT_TOOL_ROUNDS_WORKFLOW;
    case "verification":
      return LINGHUN_AGENT_TOOL_ROUNDS_VERIFICATION;
    case "code_fact":
      return LINGHUN_AGENT_TOOL_ROUNDS_CODE_FACT;
    default:
      return LINGHUN_AGENT_TOOL_ROUNDS_BASE;
  }
}

function computeSuggestedBackgroundConcurrency(taskKind: PolicyDecision["taskKind"]): number {
  switch (taskKind) {
    case "agent":
      return LINGHUN_BACKGROUND_CONCURRENCY_AGENT;
    case "workflow":
      return LINGHUN_BACKGROUND_CONCURRENCY_WORKFLOW;
    case "verification":
      return LINGHUN_BACKGROUND_CONCURRENCY_VERIFICATION;
    case "code_fact":
      return LINGHUN_BACKGROUND_CONCURRENCY_CODE_FACT;
    default:
      return LINGHUN_BACKGROUND_CONCURRENCY_BASE;
  }
}

export function formatMetaSchedulerDirective(decision: MetaSchedulerDecision): string {
  return [
    "MetaSchedulerForModel:",
    ...decision.directives.map((item) => `- ${item}`),
    `- Typed policy route: task ${decision.policyDecision.taskKind}; risk ${decision.policyDecision.riskLevel}; budget ${decision.suggestedMaxTodoRounds} rounds; agent-max-turns ${decision.suggestedMaxAgentChildTurns}; agent-tool-rounds ${decision.suggestedMaxAgentToolRounds}; bg-concurrency ${decision.suggestedBackgroundConcurrency}; provider ${decision.policyDecision.providerPlan}; source-first ${decision.policyDecision.executionPlan.preferSourceFirst ? "yes" : "no"}; verification ${decision.policyDecision.executionPlan.requireVerification ? "required" : "normal"}; explicit-gate ${decision.policyDecision.permissionPlan.requireExplicitGate ? "required" : "normal"}; user-state ${decision.policyDecision.userState.kind}; capability ${decision.policyDecision.capabilitySignal.active ? "candidate" : "none"}.`,
    `- EngineeringTaskProfile: profile=${decision.policyDecision.engineeringSignal.profile}; strategy=${decision.policyDecision.engineeringSignal.strategyHint}; failure=${decision.policyDecision.engineeringSignal.failureCategory ?? "none"}; final-boundary=${decision.policyDecision.engineeringSignal.finalBoundaryHint ?? "normal"}.`,
    ...(decision.policyDecision.platformSignal.windowsSafeHint
      ? ["- Windows shell boundary: do not use shell apply_patch, heredoc, cat redirects, or tee redirects for file writes; use Edit/MultiEdit/Write structured tools instead."]
      : []),
    ...(decision.policyDecision.executionPlan.preferAgent || decision.policyDecision.executionPlan.preferWorkflow
      ? ["- Action: this is an agent/workflow-classified task. Delegate execution via StartAgent or RunWorkflow tools. Do not serial-Todo-plan every step yourself; use the extended planning budget to set up delegation, then call the tool."]
      : []),
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

function countRecentFailureLearning(state: FailureLearningState): number {
  return state.records.filter(
    (record) => record.status === "active" && record.projectScope === state.projectScope,
  ).length;
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

// ── 意图分类器：信号优先 + 关键词加权 + 模糊澄清 ──

type KeywordWeight = [string, number];

const DOMAIN_KEYWORD_WEIGHTS: Record<string, KeywordWeight[]> = {
  code_fact: [
    ["读", 10], ["定位", 10], ["源码", 10], ["read", 10], ["source", 10],
    ["看", 8], ["找", 8], ["grep", 8], ["search", 8], ["调用链", 8], ["code", 8],
    ["审计", 8], ["review", 8], ["分析", 6], ["audit", 8], ["梳理", 6],
    ["查看", 6], ["inspect", 6], ["trace", 6], ["文件", 6],
    ["file", 4],
  ],
  edit: [
    ["修改", 10], ["修", 10], ["改", 10], ["fix", 10], ["modify", 10],
    ["实现", 8], ["写入", 8], ["write", 8], ["implement", 8], ["update", 8],
    ["新增", 6], ["创建", 6], ["删除", 6], ["create", 6], ["delete", 6],
  ],
  verification: [
    ["测试", 10], ["验证", 10], ["test", 10], ["verify", 10],
    ["typecheck", 8], ["lint", 8], ["check", 8],
    ["build", 6],
    ["检查", 4],
  ],
  agent: [
    ["agent", 10], ["智能体", 10], ["multi-agent", 10],
    ["fork", 8],
    ["多开", 6], ["并行", 6],
  ],
  workflow: [
    ["workflow", 10], ["job", 10], ["工作流", 10],
    ["流水线", 6],
    ["后台", 4], ["托管", 4],
  ],
};

// Precompiled Latin keyword regex patterns — built once at module load
const LATIN_KEYWORD_PATTERNS: Map<string, RegExp> = new Map();
for (const keywords of Object.values(DOMAIN_KEYWORD_WEIGHTS)) {
  for (const [keyword] of keywords) {
    if (/^[a-zA-Z0-9_-]+$/.test(keyword) && !LATIN_KEYWORD_PATTERNS.has(keyword)) {
      LATIN_KEYWORD_PATTERNS.set(
        keyword,
        new RegExp(
          `\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
          "iu",
        ),
      );
    }
  }
}

function matchKeyword(text: string, keyword: string): boolean {
  const pattern = LATIN_KEYWORD_PATTERNS.get(keyword);
  if (pattern) return pattern.test(text);
  return text.includes(keyword);
}

function scoreDomain(text: string, keywords: KeywordWeight[]): number {
  let maxScore = 0;
  for (const [keyword, weight] of keywords) {
    if (matchKeyword(text, keyword)) {
      maxScore = Math.max(maxScore, weight);
    }
  }
  return maxScore;
}

function classifyTaskKind(
  userText: string,
  capabilityPlan: CapabilityPlan = createEmptyCapabilityPlan(),
  input?: Pick<
    MetaSchedulerInput,
    | "consecutiveFailures"
    | "taskDomainSwitched"
    | "lastVerificationStatus"
    | "userStatePersistence"
    | "failureLearning"
    | "hasActiveProviderFailure"
  >,
): TaskClassification {
  // Layer 2: 对所有域独立打分
  const scores: TaskIntent[] = [];
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORD_WEIGHTS)) {
    scores.push({
      kind: domain as PolicyDecision["taskKind"],
      score: scoreDomain(userText, keywords),
    });
  }
  scores.push({
    kind: "capability",
    score: capabilityPlan.route === "capability" ? 15 : 0,
  });
  scores.push({ kind: "chat", score: 5 });

  scores.sort((a, b) => b.score - a.score);
  const dominant = scores[0];

  const secondaries: PolicyDecision["taskKind"][] = [];
  const reasons: string[] = [];

  const consecutiveFailures = input?.consecutiveFailures ?? 0;
  const lastVerificationStatus = input?.lastVerificationStatus;
  const failureLearning = input?.failureLearning;

  // Layer 1: 信号优先
  if (consecutiveFailures >= 2 && dominant.kind === "edit") {
    reasons.push("连续失败后强制源码优先");
  }

  if (lastVerificationStatus === "fail") {
    if (!secondaries.includes("verification")) {
      secondaries.push("verification");
    }
    reasons.push("上轮验证失败");
  }

  if (input?.hasActiveProviderFailure) {
    reasons.push("provider 历史失败，避免重压力操作");
  }

  // 确定 primary：信号可覆盖关键词打分
  let primary: PolicyDecision["taskKind"];
  if (consecutiveFailures >= 2 && dominant.kind === "edit") {
    primary = "code_fact";
  } else {
    primary = dominant.kind;
  }

  // Layer 3: 模糊时标记澄清
  const intentUnclear = scores.every((s) => s.score < 10);
  if (intentUnclear && reasons.length === 0) {
    reasons.push("意图模糊，建议模型先澄清");
  }

  // 归并 secondaries：第二高分 ≥ 最高分 * 0.6
  const primaryScore =
    primary === "code_fact" && dominant.kind === "edit"
      ? dominant.score // 取原始 edit 分数作为参照
      : scores.find((s) => s.kind === primary)?.score ?? 0;
  for (const s of scores) {
    if (s.kind === primary) continue;
    if (s.score >= primaryScore * 0.6 && s.score > 0) {
      if (!secondaries.includes(s.kind)) {
        secondaries.push(s.kind);
      }
    }
  }

  return {
    primary: intentUnclear ? "chat" : primary,
    secondaries,
    intentUnclear,
    reason: reasons.join("; "),
  };
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

export function hasActiveProviderFailure(state: FailureLearningState): boolean {
  return state.records.some(
    (record) =>
      record.status === "active" &&
      record.category === "provider_failure" &&
      record.projectScope === state.projectScope,
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

function inferEngineeringFailureCategory(input: {
  providerFailure: boolean;
  lastVerificationStatus?: MetaSchedulerInput["lastVerificationStatus"];
  lastToolFailure?: MetaSchedulerInput["lastToolFailure"];
}): EngineeringFailureCategory | undefined {
  if (input.providerFailure) return "provider_error";
  if (input.lastVerificationStatus === "timeout") return "test_timeout";
  if (input.lastToolFailure && /missing artifact|missing required artifact|no such file|not found/iu.test(input.lastToolFailure.summary)) {
    return "missing_artifact";
  }
  return undefined;
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
  // Single pass over backgroundTasks: running counts, state counts, noPass reasons
  let runningAgents = 0;
  let runningJobs = 0;
  const agentStates: RuntimeStateCounts = {
    running: 0, completed: 0, blocked: 0, stale: 0, cancelled: 0, timeout: 0,
  };
  const jobStates: RuntimeStateCounts = {
    running: 0, completed: 0, blocked: 0, stale: 0, cancelled: 0, timeout: 0,
  };
  const noPassReasonSet = new Set<string>();

  for (const task of input.backgroundTasks) {
    const isAgent = task.kind === "agent";
    const isJob = task.kind === "job";
    if (!isAgent && !isJob) continue;

    if (isAgent && task.status === "running") runningAgents++;
    if (isJob && task.status === "running") runningJobs++;

    if (isAgent && task.status in agentStates) {
      (agentStates as Record<string, number>)[task.status] += 1;
    }
    if (isJob && task.status in jobStates) {
      (jobStates as Record<string, number>)[task.status] += 1;
    }

    // noPass reasons (inline collectRuntimeNoPassStates task-level)
    if (
      task.status === "blocked" || task.status === "stale" ||
      task.status === "cancelled" || task.status === "timeout"
    ) {
      noPassReasonSet.add(`${task.kind}:${task.status}`);
    }
    if (
      task.result === "stale" || task.result === "cancelled" ||
      task.result === "timeout"
    ) {
      noPassReasonSet.add(`${task.kind}:${task.result}`);
    }
    if (task.status === "completed" && task.result !== "pass") {
      noPassReasonSet.add(`${task.kind}:completed_not_pass`);
    }
  }

  // Workflow-level noPass checks (preserved from collectRuntimeNoPassStates)
  if (
    input.workflow?.status === "blocked" ||
    input.workflow?.status === "stale" ||
    input.workflow?.status === "cancelled"
  ) {
    noPassReasonSet.add(`workflow:${input.workflow.status}`);
  }
  if (input.workflow?.status === "completed") {
    noPassReasonSet.add("workflow:completed_not_pass");
  }
  for (const step of input.workflow?.steps ?? []) {
    if (
      step.status === "blocked" || step.status === "stale" ||
      step.status === "cancelled"
    ) {
      noPassReasonSet.add(`workflow_step:${step.status}`);
    }
  }

  runningAgents = input.activeAgentCount ?? runningAgents;
  runningJobs = input.activeJobCount ?? runningJobs;
  const workflowStatus =
    input.activeWorkflowStatus ??
    normalizeWorkflowRuntimeStatus(input.workflow?.status, input.workflow?.steps);
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
    noPassStates: [...noPassReasonSet],
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
  userStatePersistence: number;
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
  engineeringSignal: PolicyDecision["engineeringSignal"];
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
    engineeringSignal: input.engineeringSignal,
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
    userStatePersistence: input.userStatePersistence,
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

function hasActiveBlockedWorkflow(workflow: WorkflowState["activeRun"] | undefined): boolean {
  if (workflow?.status === "blocked") return !workflow.endedAt;
  if (
    workflow?.status === "running" &&
    workflow.steps.some((step) => step.status === "blocked" || step.status === "stale")
  ) {
    return true;
  }
  return false;
}
