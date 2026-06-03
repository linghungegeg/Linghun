import type { Language } from "@linghun/shared";
import { estimateModelMessageChars } from "./context-estimator.js";
import type { IndexState } from "./index-runtime.js";
import type { ModelMessage } from "@linghun/providers";
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
  contextMaxChars?: number;
  triggerChars?: number;
  index: IndexState;
  evidence: EvidenceRecord[];
  failureLearning: FailureLearningState;
  backgroundTasks: BackgroundTaskState[];
  workflow?: WorkflowState["activeRun"];
  lastToolFailure?: { toolName: string; summary: string };
  providerFailure?: { provider: string; model: string; code?: string; message: string };
};

export type MetaSchedulerDecision = {
  directives: string[];
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
  const pressure = computeContextPressure(input.messages, input.contextMaxChars, input.triggerChars);
  const indexStrategy = classifyIndexStrategy(input.index);

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

  return {
    directives,
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
    "- Keep RuntimeStatusForModel, gateId, raw evidence, raw tool_result, and internal scheduler labels out of the user-visible final answer.",
  ].join("\n");
}

function hasHighRiskCompletionClaim(text: string): boolean {
  return /(?:\bPASS\b|\bpassed\b|\bverified\b|\btests?\s+pass(?:ed)?\b|\bfixed\b|\bcompleted\b|已完成|已修复|已验证|验证通过|测试通过|可以进入下一阶段|ready\s+for|可进入)/iu.test(
    text,
  );
}

function lacksVerificationEvidence(evidence: EvidenceRecord[]): boolean {
  return !evidence.some((item) =>
    item.kind === "test_result" ||
    (item.kind === "command_output" &&
      /test|typecheck|build|lint|smoke|verification|验证|测试/iu.test(
        [item.source, item.summary, ...item.supportsClaims].join(" "),
      )),
  );
}

function computeContextPressure(
  messages: ModelMessage[] | undefined,
  contextMaxChars: number | undefined,
  triggerChars: number | undefined,
): { shouldCompact: boolean } {
  if (!messages || !contextMaxChars || !triggerChars) return { shouldCompact: false };
  const chars = estimateModelMessageChars(messages);
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
