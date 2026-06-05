import type { ModelMessage } from "@linghun/providers";
import type { Language } from "@linghun/shared";
import { estimateModelMessageChars } from "./context-estimator.js";
import type { IndexState } from "./index-runtime.js";
import type {
  BackgroundTaskState,
  EvidenceRecord,
  FailureLearningState,
  WorkflowState,
} from "./tui-data-types.js";

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
  backgroundTasks: BackgroundTaskState[];
  workflow?: WorkflowState["activeRun"];
  lastToolFailure?: { toolName: string; summary: string };
  providerFailure?: { provider: string; model: string; code?: string; message: string };
  providerCooldownBlocked?: boolean;
};

export type PolicyDecision = {
  taskKind: "chat" | "code_fact" | "edit" | "workflow" | "agent" | "verification";
  riskLevel: "low" | "medium" | "high";
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
  const highRiskClaim = hasHighRiskCompletionClaim(input.assistantText ?? input.userText);
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
  const taskKind = classifyTaskKind(input.userText);
  const expectedMutating = expectsMutatingAction(input.userText, taskKind);
  const includeFailureLearning = hasActiveFailureLearning(input.failureLearning);
  const preferSourceFirst = shouldPreferSourceFirst(taskKind, indexStrategy);
  const requireVerification = highRiskClaim || taskKind === "verification" || expectedMutating;
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
    requireExplicitGate: expectedMutating || blockedRuntime,
    providerPlan,
    blockedRuntime,
    toolFailure,
    providerFailure,
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
}): PolicyDecision {
  const hints: PolicyHint[] = [];
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
        "zh-CN": "策略：高风险结论需要验证后再说通过。",
        "en-US": "Strategy: high-risk claims need verification before PASS.",
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
