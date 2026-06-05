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
};

export type PolicyDecision = {
  taskKind: "chat" | "code_fact" | "edit" | "workflow" | "agent" | "verification";
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
  const highRiskClaim =
    typeof input.assistantText === "string" && hasHighRiskCompletionClaim(input.assistantText);
  const toolFailure = Boolean(input.lastToolFailure);
  const providerFailure = Boolean(input.providerFailure);
  const blockedRuntime = hasBlockedAgentOrWorkflow(input.backgroundTasks, input.workflow);
  const runtimeSignal = summarizeRuntimeSignal(input);
  const pressure = computeContextPressure(
    input.messages,
    input.estimatedContextChars,
    input.contextMaxChars,
    input.triggerChars,
  );
  const indexStrategy = classifyIndexStrategy(input.index);
  const taskKind = classifyTaskKind(input.userText);
  const expectedMutating = expectsMutatingAction(input.userText, taskKind);
  const includeFailureLearning = hasActiveFailureLearning(input.failureLearning);
  const failureSignal = summarizeFailureSignal(input.failureLearning);
  const preferSourceFirst = shouldPreferSourceFirst(taskKind, indexStrategy);
  const requireVerification =
    highRiskClaim ||
    taskKind === "verification" ||
    expectedMutating ||
    isRiskyVerificationStatus(input.lastVerificationStatus);
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

  const policyDecision = createPolicyDecision({
    taskKind,
    riskLevel: classifyRiskLevel({
      highRiskClaim,
      blockedRuntime,
      expectedMutating,
      providerFailure,
      toolFailure,
      pressure: pressure.shouldCompact,
    }),
    includeMemory: (input.memoryAcceptedCount ?? 0) > 0,
    includeFailureLearning,
    compactBeforeProvider: pressure.shouldCompact,
    preferSourceFirst,
    preferWorkflow: taskKind === "workflow",
    preferAgent: taskKind === "agent",
    requireVerification,
    requireFinalGate: highRiskClaim,
    expectedMutating,
    requireExplicitGate: expectedMutating || blockedRuntime || Boolean(input.pendingApproval),
    providerPlan,
    blockedRuntime,
    toolFailure,
    providerFailure,
    surfaceWindowsSafeHint,
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
      }),
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
    shouldRunFinalAnswerGate: highRiskClaim,
    shouldPreferVerifier: highRiskClaim && lacksVerificationEvidence(input.evidence),
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
    `- Typed policy route: task ${decision.policyDecision.taskKind}; risk ${decision.policyDecision.riskLevel}; provider ${decision.policyDecision.providerPlan}; source-first ${decision.policyDecision.executionPlan.preferSourceFirst ? "yes" : "no"}; verification ${decision.policyDecision.executionPlan.requireVerification ? "required" : "normal"}; explicit-gate ${decision.policyDecision.permissionPlan.requireExplicitGate ? "required" : "normal"}.`,
    "- Keep RuntimeStatusForModel, gateId, raw evidence, raw tool_result, and internal scheduler labels out of the user-visible final answer.",
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

function classifyTaskKind(userText: string): PolicyDecision["taskKind"] {
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

function expectsMutatingAction(userText: string, taskKind: PolicyDecision["taskKind"]): boolean {
  return (
    taskKind === "edit" ||
    /(?:写入|修改|更新|新增|删除|创建|实现|修复|提交|commit|write|edit|modify|update|delete|create|implement|fix)/iu.test(
      userText,
    )
  );
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
  return indexStrategy !== "ready" && taskKind !== "chat";
}

function classifyRiskLevel(input: {
  highRiskClaim: boolean;
  blockedRuntime: boolean;
  expectedMutating: boolean;
  providerFailure: boolean;
  toolFailure: boolean;
  pressure: boolean;
}): PolicyDecision["riskLevel"] {
  if (input.highRiskClaim || input.blockedRuntime) return "high";
  if (input.expectedMutating || input.providerFailure || input.toolFailure || input.pressure) {
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

function classifyVerificationLevel(input: {
  highRiskClaim: boolean;
  expectedMutating: boolean;
  taskKind: PolicyDecision["taskKind"];
  blockedRuntime: boolean;
  lastStatus?: MetaSchedulerInput["lastVerificationStatus"];
}): PolicyDecision["verificationSignal"]["recommendedLevel"] {
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

function summarizeRuntimeSignal(input: {
  backgroundTasks: BackgroundTaskState[];
  workflow?: ActiveWorkflowRun;
  activeAgentCount?: number;
  activeJobCount?: number;
  activeWorkflowStatus?: MetaSchedulerInput["activeWorkflowStatus"];
}): PolicyDecision["runtimeSignal"] {
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
  return {
    runningAgents,
    runningJobs,
    ...(workflowStatus ? { workflowStatus } : {}),
    resourceCapPressure: runningAgents > 0 || runningJobs > 0,
  };
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
  permissionSignal: PolicyDecision["permissionSignal"];
  modelRouteSignal: PolicyDecision["modelRouteSignal"];
  verificationSignal: PolicyDecision["verificationSignal"];
  memorySignal: PolicyDecision["memorySignal"];
  failureSignal: PolicyDecision["failureSignal"];
  architectureSignal: PolicyDecision["architectureSignal"];
  platformSignal: PolicyDecision["platformSignal"];
  budgetSignal: PolicyDecision["budgetSignal"];
  runtimeSignal: PolicyDecision["runtimeSignal"];
}): PolicyDecision {
  const hints: PolicyHint[] = [];
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
    runtimeSignal: input.runtimeSignal,
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

function lacksVerificationEvidence(evidence: EvidenceRecord[]): boolean {
  return !evidence.some(
    (item) =>
      item.kind === "test_result" ||
      (item.kind === "command_output" &&
        /test|typecheck|build|lint|smoke|verification|验证|测试/iu.test(
          [item.source, item.summary, ...item.supportsClaims].join(" "),
        )),
  );
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
      (task.status === "paused" || task.status === "stale" || task.result === "stale"),
  );
}
