import { randomUUID } from "node:crypto";
import type { Writable } from "node:stream";
import type {
  EndpointProfile,
  ModelGateway,
  ModelMessage,
  ModelRequest,
  ModelToolCall,
  ModelUsage,
} from "@linghun/providers";
import type { Language } from "@linghun/shared";
import {
  collectPendingAgentCompletionNotices,
  formatAgentCompletionMainChainContext,
  markAgentCompletionNoticeReported,
} from "./agent-completion-finalizer.js";
import {
  createArchitectureCard,
  createArchitectureRuntimeDirective,
  shouldTriggerArchitectureRuntime,
} from "./architecture-runtime.js";
import {
  hasStructuredArtifactEvidence,
  hasStructuredArtifactEvidenceForPath,
  pathsReferToSameArtifact,
  pathsReferToSameArtifactHint,
  readEvidenceDataRecord,
  uniqueArtifactTargets,
} from "./artifact-evidence-runtime.js";
import { RESOURCE_GUARD_KIND, checkResourceGuard } from "./background-control-runtime.js";
import { buildPromptCacheRequestFields } from "./break-cache-runtime.js";
import { writeLightHints } from "./cache-command-runtime.js";
import { stableHash, stableStringify } from "./cache-freshness.js";
import {
  applyCacheWritePolicyToRequest,
  applyPostCompactMainChainCacheSafePrefix,
  type CacheRequestKind,
  recordCacheRequestObservation as recordCacheRequestObservationState,
  recordCacheUsageObservation as recordCacheUsageObservationState,
  rememberCacheSafePrefix,
  resolveCachePolicy,
} from "./cache-policy-runtime.js";
import {
  appendUsageEvents,
  compactPreflightDeps,
  markContextUsageStale,
  recordModelUsage,
  refreshWorkspaceReferenceCache,
  shouldForceCompactFromConfirmedUsage,
} from "./compact-cache-command-runtime.js";
import { prepareMessagesForProviderPreflight } from "./compact-preflight-runtime.js";
import { getProviderContextMaxChars } from "./compact-preflight-runtime.js";
import { getAutoCompactTriggerChars } from "./compact-preflight-runtime.js";
import { estimateModelMessageChars } from "./context-estimator.js";
import { createUserMessageEvent, ensureSession, t, writeStatus } from "./details-status-runtime.js";
import {
  appendSystemEvent,
  budgetToolResultTranscriptContent,
  captureFailureLearning,
  compactToolResultForModelHistory,
  createEvidenceRecord,
  getToolResultBudgetState,
  recordArchitectureRuntimeCard,
  recordModelToolFailureForMetaScheduler,
  recordProviderFailureEvidence,
  recordToolResultBudgetEvidence,
  rememberEvidence,
  sanitizeProviderFailureError,
  truncateRoundAssistantForProvider,
} from "./evidence-runtime.js";
import {
  buildFailureLearningSummaryForPrompt,
  recordFailureLearningDegradedWarning,
} from "./failure-learning-runtime.js";
import { runArchitectureAndCompletenessFinalGate } from "./final-answer-gate.js";
import { createGitRunner, readGitStatus } from "./git-runtime.js";
import { computeWorktreeContext } from "./git-operation-runtime.js";
import { summarizeWorktreeContextForPrompt } from "./git-tool-runtime.js";
import { runAutoLearningOnTurnEnd } from "./memory-command-runtime.js";
import {
  handleProviderRetryForMetaOrchestration,
  recordMetaOrchestrationRuntimeEvent,
  resolveMetaOrchestrationAction,
} from "./meta-orchestration-runtime.js";
import {
  type MetaSchedulerInput,
  type PolicyDecision,
  evaluateMetaScheduler,
  formatMetaSchedulerDirective,
  formatPolicyDecisionSummary,
  hasActiveProviderFailure,
  verifyFailureLearningContract,
} from "./meta-scheduler-runtime.js";
import { detectEngineeringTaskProfile } from "./headless-bench-runtime.js";
import { startModelSetup } from "./model-command-runtime.js";
import {
  createModelToolDefinitionsForReportGuard,
  isPreEngineToolName,
} from "./model-loop-runtime.js";
import type { FinalAnswerClaimVerdict, FinalAnswerExtendedVerdict } from "./model-loop-runtime.js";
import {
  evaluateFinalAnswerClaims,
  isEvidenceStaleForClaim,
  stripStructuredFinalAnswerClaims,
} from "./model-loop-runtime.js";
import {
  createModelSystemPromptSegments,
  sanitizeMainScreenLeakage,
  type ModelSystemPromptSegment,
} from "./model-prompt-runtime.js";
import { looksLikeModelSetupInput, parseModelSetupPrefill } from "./model-setup-runtime.js";
import { executeModelToolUse, recordReportIncompleteEvidence } from "./model-tool-runtime.js";
import {
  type PendingNaturalCommand,
  buildRuntimeStatusForModel,
  matchesNaturalGateConfirmation,
  routeNaturalIntent,
} from "./natural-command-bridge.js";
import {
  formatPendingApprovalDetails,
  formatPendingNaturalCommandDetails,
} from "./pending-details-presenter.js";
import { executePermissionApprove, executePermissionDeny } from "./permission-approval-runtime.js";
import {
  createReportFinalReferenceReminder,
  createReportTaskGuard,
  createReportWriteGuard,
  createReportWriteReminder,
  doesWriteSatisfyReportGuard,
  hasReportFinalAnswerShape,
  hasReportWriteToolCall,
  shouldSendReportEvidenceReminder,
  shouldSendReportFinalReferenceReminder,
  shouldSendReportWriteReminder,
} from "./permission-continuation-runtime.js";
import { clearProviderBreaker, withProviderRetry } from "./provider-circuit-breaker.js";
import {
  checkAndWriteProviderCooldown,
  recordProviderFallbackAttempt,
  resolveRuntimeFallback,
} from "./provider-loop-runtime.js";
import {
  consumeRemoteInboundMessage,
  processRemoteInbound,
  validateRemotePairingEnvelope,
} from "./remote-command-runtime.js";
import { decideRemoteInbox, processRemoteBindCommand } from "./remote-inbound-bridge-runtime.js";
import {
  type RequestActivityPhase,
  formatProviderEmptyResponsePrimary,
  formatProviderFailurePrimary,
  formatProviderFailureTitle,
  formatProviderFallbackAttemptSummary,
  formatProviderThinkingOnlyResponsePrimary,
  formatReportEvidenceRequired,
  formatRequestActivity,
} from "./request-lifecycle-presenter.js";
import {
  LINGHUN_MAX_RAW_TOOL_PROTOCOL_TEXT_RETRIES,
  LINGHUN_PROVIDER_TOOL_RESULT_CHARS,
} from "./runtime-budget.js";
import { detectTerminalCapability } from "./shell/terminal-capability.js";
import { addRoleUsage } from "./slash-command-runtime.js";
import { handleSlashCommand } from "./slash-command-runtime.js";
import { formatError, writeLine } from "./startup-runtime.js";
import { summarizeEvidenceRecords } from "./task-status-presenter.js";
import { createAssistantPrimaryTextSanitizer } from "./tool-output-presenter.js";
import { applyToolResultBudgetToMessages } from "./tool-result-budget.js";
import {
  forbidsVerificationEvidence,
  parseUserActionConstraints,
} from "./user-action-constraints.js";
import { createVerificationPlan } from "./verification-command-runtime.js";
import type { PendingModelContinuation, TuiContext } from "./tui-context-runtime.js";
import { updateTurnContinuity } from "./turn-continuity-runtime.js";
import {
  createSingleToolCallContinuation,
  runtimeFromContinuation,
} from "./tui-context-runtime.js";
import {
  MAX_CONTEXT_MESSAGES,
  MAX_RAW_TOOL_PROTOCOL_TEXT_RETRIES,
  REQUEST_SLOW_HINT_MS,
  TODO_ONLY_KILL_GRACE,
  MAX_TODO_ONLY_CODE_FACT,
} from "./tui-context-runtime.js";
import type { RemoteInboundDecision, RemoteInboundMessage } from "./tui-data-types.js";
import {
  getRuntimeStatusProvider,
  getSelectedModelRuntime,
  shouldOfferUserScopedModelSetup,
} from "./tui-model-runtime.js";
import {
  beginAssistantStream,
  cancelAssistantStream,
  discardAssistantBlock,
  endAssistantStream,
  replaceAssistantBlockContent,
  writeAssistantDelta,
  writeDiagnosticLine,
  writeErrorLine,
} from "./tui-output-surface.js";
import { ShellBlockOutput } from "./tui-output-surface.js";

type ModelToolExecutionResult = {
  ok: boolean;
  tool: string;
  text: string;
  data?: unknown;
  evidenceId?: string;
  modelContent?: unknown;
  pendingApproval?: boolean;
};

type AggregatedFinalAnswerGateResult =
  | { status: "passed" }
  | {
      status: "needs_disclaimer";
      claimVerdict?: FinalAnswerClaimVerdict;
      extendedVerdict?: FinalAnswerExtendedVerdict;
      engineeringVerdict?: { unsupportedKinds: string[]; message: string };
      unsupportedKinds: string[];
    };

type FinalGateVerificationLevel = "typecheck" | "test" | "build" | "lint" | "smoke";

export type FinalGateEvidenceGapActionPlan = {
  action: "readonly_check" | "verification_request" | "blocked_explanation" | "downgrade_only";
  reason: string;
  directive: string;
  evidenceAction?: {
    toolName: string;
    input?: unknown;
    strategy?: "minimal_bash_verification" | "artifact_readonly_check" | "service_runtime_readonly_check";
    summary: string;
  };
};

export type FinalGateEvidenceActionResult =
  | { status: "evidence_recorded"; messages: ModelMessage[]; result: ModelToolExecutionResult }
  | { status: "attempt_recorded"; messages: ModelMessage[]; result: ModelToolExecutionResult; reason: string }
  | { status: "permission_pending" }
  | { status: "blocked"; reason: string }
  | { status: "unsupported"; reason: string };

const ASSISTANT_PREVIEW_FLUSH_MIN_CHARS = 16;
const ASSISTANT_PREVIEW_FLUSH_MAX_INTERVAL_MS = 24;
const MAX_FINAL_GATE_CLAIM_ALIGNMENT_REWRITES = 2;
const MAX_FINAL_GATE_EVIDENCE_ACTION_RETRIES = 3;
const SAME_TOOL_FAILURE_RETRY_GUARD_LIMIT = 4;
const TOOL_FAILURE_NO_TOOL_RECOVERY_PROMPT_LIMIT = 4;
const MAX_PARALLEL_READONLY_TOOL_CALLS = 2;

const PARALLEL_READONLY_TOOL_NAMES = new Set([
  "Grep",
  "Glob",
  "Diff",
  "pre_context",
  "pre_impact",
  "pre_plan",
  "pre_verify",
]);

function isFallbackRequiredToolResult(result: Pick<ModelToolExecutionResult, "data">): boolean {
  const data = result.data;
  return !!data && typeof data === "object" && !Array.isArray(data) &&
    (data as Record<string, unknown>).fallback_required === true;
}

export function isToolBatchFallbackRequired(result: Pick<ModelToolExecutionResult, "ok" | "data">): boolean {
  return result.ok === true && isFallbackRequiredToolResult(result);
}

export function isToolBatchFailure(result: Pick<ModelToolExecutionResult, "ok" | "data">): boolean {
  return result.ok !== true;
}

export type ToolFailureRecoveryState = {
  previousRoundFingerprint?: string;
  repeatedFailureRounds: number;
};

export function createToolFailureRecoveryFingerprint(
  toolCall: Pick<ModelToolCall, "name" | "input">,
  result: Pick<ModelToolExecutionResult, "tool" | "text">,
): string {
  const toolName = result.tool || toolCall.name;
  return [
    toolName,
    classifyToolFailureForRecovery(result.text),
    stableStringify(toolCall.input ?? null).slice(0, 2_000),
  ].join("|");
}

export function updateToolFailureRecoveryState(
  state: ToolFailureRecoveryState,
  fingerprints: string[],
  limit = SAME_TOOL_FAILURE_RETRY_GUARD_LIMIT,
): { state: ToolFailureRecoveryState; shouldStop: boolean } {
  const roundFingerprint = fingerprints.slice().sort().join("\n");
  if (!roundFingerprint) {
    return { state: { repeatedFailureRounds: 0 }, shouldStop: false };
  }
  const repeatedFailureRounds =
    state.previousRoundFingerprint === roundFingerprint ? state.repeatedFailureRounds + 1 : 1;
  const nextState = {
    previousRoundFingerprint: roundFingerprint,
    repeatedFailureRounds,
  };
  return { state: nextState, shouldStop: repeatedFailureRounds > limit };
}

export function shouldContinueAfterToolFailureWithoutToolCall(
  state: ToolFailureRecoveryState,
  promptCount: number,
  limit = TOOL_FAILURE_NO_TOOL_RECOVERY_PROMPT_LIMIT,
): boolean {
  return state.repeatedFailureRounds > 0 && promptCount < limit;
}

function classifyToolFailureForRecovery(text: string): string {
  const normalized = text.toLowerCase();
  if (
    /old_string|no match|not found|0 replacements|no replacement|找不到|未匹配|没有匹配/.test(
      normalized,
    )
  ) {
    return "edit_no_match";
  }
  if (/permission|denied|rejected|拒绝|权限/.test(normalized)) return "permission";
  if (/timeout|timed out|超时/.test(normalized)) return "timeout";
  if (/not recognized|command not found|不是内部或外部命令|找不到命令/.test(normalized)) {
    return "command_not_found";
  }
  if (/syntax|parse|heredoc|here-string|解析|语法/.test(normalized)) return "shell_syntax";
  return normalized.replace(/\s+/g, " ").trim().slice(0, 240);
}

function createToolFailureRecoveryReminder(language: Language): string {
  return language === "en-US"
    ? [
        "The previous tool attempt failed and the task is not recovered yet.",
        "Continue by calling tools now: read or search the current file context first if needed, then use corrected Edit/MultiEdit/Write/Bash inputs.",
        "Do not only describe what you will do. If permission, scope, or budget blocks the recovery, explain that blocker instead.",
      ].join("\n")
    : [
        "上一轮工具调用失败，任务还没有恢复完成。",
        "现在请继续调用工具：必要时先 Read/Grep 获取最新文件上下文，再用修正后的 Edit/MultiEdit/Write/Bash 输入继续。",
        "不要只描述接下来要做什么；如果权限、范围或预算阻塞恢复，再说明阻塞原因。",
      ].join("\n");
}

export function createToolFallbackRecoveryReminder(language: Language, previousFallbacks = 0): string {
  const repeated = previousFallbacks > 0;
  return language === "en-US"
    ? [
        repeated
          ? "Pre-analysis fallback mode is already active for this task."
          : "The repository pre-analysis tool reported fallback_required and did not complete the task.",
        "For the rest of this task, default to real workspace tools instead of pre-engine analysis.",
        "Your next response MUST call at least one real workspace tool such as Read, ReadSnippets, SourcePack, Grep, Glob, Bash, Diff, or RunVerification.",
        "Do not produce a final natural-language answer and do not call pre_context/pre_plan/pre_impact/pre_verify again unless a real-tool result shows it is still needed.",
      ].join("\n")
    : [
        repeated
          ? "当前任务已经进入 pre 降级恢复模式。"
          : "仓库 pre 预分析工具返回了 fallback_required，任务还没有完成。",
        "本任务后续默认改用真实工作区工具推进，不再优先使用 pre 预分析。",
        "你的下一轮回复必须至少调用一个真实工作区工具，例如 Read、ReadSnippets、SourcePack、Grep、Glob、Bash、Diff 或 RunVerification。",
        "不要输出自然语言最终回答；除非真实工具结果证明仍然需要，否则不要再调用 pre_context/pre_plan/pre_impact/pre_verify。",
      ].join("\n");
}

export function recordPreEngineFallbackPreference(context: TuiContext): void {
  context.preEngineFallbackPreference = {
    projectPath: context.projectPath,
    active: true,
    activatedAt: new Date().toISOString(),
    reason: "fallback_required",
  };
}

function isPreEngineFallbackHardCutActive(context: TuiContext): boolean {
  return (
    context.preEngineFallbackPreference?.active === true &&
    context.preEngineFallbackPreference.projectPath === context.projectPath
  );
}

function createProviderToolDefinitionsForContext(
  context: TuiContext,
  guard: ToolBatchExecutionOptions["continuation"]["reportWriteGuard"],
): ReturnType<typeof createModelToolDefinitionsForReportGuard> {
  const preEngineFallbackActive = isPreEngineFallbackHardCutActive(context);
  return createModelToolDefinitionsForReportGuard(guard, {
    excludePreEngineTools: preEngineFallbackActive,
    excludeDeferredToolDispatch: preEngineFallbackActive,
  });
}

export function createPreFallbackHardCutSkippedToolResult(
  toolCall: ModelToolCall,
): ModelToolExecutionResult {
  return {
    ok: true,
    tool: toolCall.name,
    text: "Pre-engine fallback is active for this task. This tool call was hard-cut; use real workspace tools instead.",
    data: {
      skipped: true,
      reason: "pre_engine_fallback_hard_cut",
      degraded: true,
      fallback_required: true,
    },
  };
}

export function createToolBatchFailFastSkippedResult(
  toolCall: ModelToolCall,
  reason: string,
): ModelToolExecutionResult {
  return {
    ok: false,
    tool: toolCall.name,
    text: `Skipped by tool batch fail-fast after consecutive failures: ${reason}`,
    data: { skipped: true, reason: "tool_batch_fail_fast", lastFailure: reason },
  };
}

export function createMetaOrchestrationSkippedToolResult(
  toolCall: ModelToolCall,
  reason: string,
): ModelToolExecutionResult {
  return {
    ok: false,
    tool: toolCall.name,
    text: `Skipped by meta orchestration stop: ${reason}`,
    data: { skipped: true, reason: "meta_orchestration_stop", detail: reason },
  };
}

function pushToolResultMessage(
  messages: ModelMessage[],
  toolCall: ModelToolCall,
  result: ModelToolExecutionResult,
): void {
  const payload =
    result.modelContent === undefined
      ? result
      : {
          ok: result.ok,
          tool: result.tool,
          evidenceId: result.evidenceId,
          content: result.modelContent,
        };
  messages.push({
    role: "tool",
    tool_call_id: toolCall.id,
    content: JSON.stringify(payload),
  });
}

type ToolExecutionBatch =
  | { mode: "parallel_readonly"; toolCalls: ModelToolCall[] }
  | { mode: "serial"; toolCalls: [ModelToolCall] };

type ToolBatchExecutionState = {
  roundHadProgress: boolean;
  roundHadRealFallbackToolProgress: boolean;
  roundFallbackRequiredCount: number;
  batchFailureCount: number;
  lastBatchFailureReason?: string;
  roundFailureFingerprints: string[];
  stoppedByFailFast: boolean;
};

type ToolBatchExecutionOptions = {
  continuation: PendingModelContinuation;
  failFastContext: string;
  collectFailureFingerprints?: boolean;
};

export function canRunToolCallInParallelReadonlyBatch(toolCall: Pick<ModelToolCall, "name" | "input">): boolean {
  if (PARALLEL_READONLY_TOOL_NAMES.has(toolCall.name)) return true;
  if (toolCall.name !== "Read") return false;
  const path = readToolCallPath(toolCall.input);
  return !!path && isWorkspaceRelativeNonSensitiveReadPath(path);
}

export function createToolExecutionBatches(toolCalls: ModelToolCall[]): ToolExecutionBatch[] {
  const batches: ToolExecutionBatch[] = [];
  let index = 0;
  while (index < toolCalls.length) {
    const current = toolCalls[index]!;
    if (!canRunToolCallInParallelReadonlyBatch(current)) {
      batches.push({ mode: "serial", toolCalls: [current] });
      index += 1;
      continue;
    }

    const group: ModelToolCall[] = [current];
    let cursor = index + 1;
    while (
      cursor < toolCalls.length &&
      group.length < MAX_PARALLEL_READONLY_TOOL_CALLS &&
      canRunToolCallInParallelReadonlyBatch(toolCalls[cursor]!)
    ) {
      group.push(toolCalls[cursor]!);
      cursor += 1;
    }

    batches.push(group.length > 1 ? { mode: "parallel_readonly", toolCalls: group } : { mode: "serial", toolCalls: [current] });
    index = cursor;
  }
  return batches;
}

function isWorkspaceRelativeNonSensitiveReadPath(path: string): boolean {
  const normalized = path.split("\\").join("/").trim();
  if (!normalized || normalized.startsWith("/") || normalized.startsWith("~")) return false;
  if (/^[a-z]:\//i.test(normalized)) return false;
  const segments = normalized.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "..")) return false;
  const lower = normalized.toLowerCase();
  return !/(^|\/)(\.env|\.npmrc|\.netrc|id_rsa|id_dsa|id_ed25519|.*secret.*|.*token.*|.*credential.*|.*key.*)(\.|$|\/)/.test(lower);
}

async function executeToolCallsWithReadonlyParallelism(
  toolCalls: ModelToolCall[],
  context: TuiContext,
  sessionId: string,
  output: Writable,
  options: ToolBatchExecutionOptions,
): Promise<ToolBatchExecutionState & { pendingApproval: boolean }> {
  const state: ToolBatchExecutionState = {
    roundHadProgress: false,
    roundHadRealFallbackToolProgress: false,
    roundFallbackRequiredCount: 0,
    batchFailureCount: 0,
    roundFailureFingerprints: [],
    stoppedByFailFast: false,
  };
  const orchestration = resolveMetaOrchestrationAction(context, "tool-execution");
  const batches = createToolExecutionBatches(toolCalls);
  await recordMetaOrchestrationRuntimeEvent(context, sessionId, {
    stepId: "tool-execution",
    executor: "model-stream-runtime",
    status: "consumed",
    summary: `mode=${orchestration.mode}; tool calls=${toolCalls.length}; batches=${batches.length}`,
    level: orchestration.shouldRun ? "info" : "warning",
  });
  if (orchestration.shouldStop || orchestration.shouldAsk) {
    for (const toolCall of toolCalls) {
      pushToolResultMessage(
        options.continuation.messages,
        toolCall,
        createMetaOrchestrationSkippedToolResult(toolCall, orchestration.reason),
      );
    }
    await recordMetaOrchestrationRuntimeEvent(context, sessionId, {
      stepId: "tool-execution",
      executor: "model-stream-runtime",
      status: orchestration.shouldAsk ? "blocked" : "failed",
      summary: `mode=${orchestration.mode}; skipped=${toolCalls.length}; reason=${orchestration.reason}`,
      level: "warning",
    });
    return { ...state, pendingApproval: false };
  }

  for (const batch of batches) {
    const canUseParallelBatch =
      !orchestration.shouldDegrade && batch.mode === "parallel_readonly" && state.batchFailureCount === 0;
    const calls = canUseParallelBatch ? batch.toolCalls : batch.toolCalls.slice(0, 1);
    const results = canUseParallelBatch
      ? await Promise.all(
          calls.map((toolCall) =>
            executeModelToolUseWithPreFallbackHardCut(
              toolCall,
              context,
              sessionId,
              output,
              options.continuation,
            ),
          ),
        )
      : [
          await executeModelToolUseWithPreFallbackHardCut(
            calls[0]!,
            context,
            sessionId,
            output,
            options.continuation,
          ),
        ];

    for (let resultIndex = 0; resultIndex < results.length; resultIndex += 1) {
      const toolCall = calls[resultIndex]!;
      const result = results[resultIndex]!;
      await recordModelToolFailureForMetaScheduler(context, sessionId, result);
      if (result.pendingApproval) {
        await recordMetaOrchestrationRuntimeEvent(context, sessionId, {
          stepId: "permission-gate",
          executor: "permission-runtime",
          status: "blocked",
          summary: `tool ${toolCall.name} waiting for permission approval`,
          level: "warning",
        });
        return { ...state, pendingApproval: true };
      }
      updateToolBatchExecutionState(state, toolCall, result, options);
      pushToolResultMessage(options.continuation.messages, toolCall, result);
      if (state.stoppedByFailFast) {
        await appendSkippedToolResultsAfterFailFast(
          toolCalls,
          toolCall,
          options.continuation.messages,
          state.lastBatchFailureReason,
        );
        await appendSystemEvent(
          context,
          sessionId,
          `tool_batch_fail_fast: stopped after ${state.batchFailureCount} consecutive failures in ${options.failFastContext}; last: ${state.lastBatchFailureReason}`,
          "warning",
        );
        await recordMetaOrchestrationRuntimeEvent(context, sessionId, {
          stepId: "tool-execution",
          executor: "model-stream-runtime",
          status: "degraded",
          summary: `fail-fast after ${state.batchFailureCount} failures; last=${state.lastBatchFailureReason ?? "unknown"}`,
          level: "warning",
        });
        return { ...state, pendingApproval: false };
      }
    }

    if (!canUseParallelBatch && batch.mode === "parallel_readonly") {
      for (const remaining of batch.toolCalls.slice(1)) {
        const result = await executeModelToolUseWithPreFallbackHardCut(
          remaining,
          context,
          sessionId,
          output,
          options.continuation,
        );
        await recordModelToolFailureForMetaScheduler(context, sessionId, result);
        if (result.pendingApproval) {
          await recordMetaOrchestrationRuntimeEvent(context, sessionId, {
            stepId: "permission-gate",
            executor: "permission-runtime",
            status: "blocked",
            summary: `tool ${remaining.name} waiting for permission approval`,
            level: "warning",
          });
          return { ...state, pendingApproval: true };
        }
        updateToolBatchExecutionState(state, remaining, result, options);
        pushToolResultMessage(options.continuation.messages, remaining, result);
        if (state.stoppedByFailFast) {
          await appendSkippedToolResultsAfterFailFast(
            toolCalls,
            remaining,
            options.continuation.messages,
            state.lastBatchFailureReason,
          );
          await appendSystemEvent(
            context,
            sessionId,
            `tool_batch_fail_fast: stopped after ${state.batchFailureCount} consecutive failures in ${options.failFastContext}; last: ${state.lastBatchFailureReason}`,
            "warning",
          );
          await recordMetaOrchestrationRuntimeEvent(context, sessionId, {
            stepId: "tool-execution",
            executor: "model-stream-runtime",
            status: "degraded",
            summary: `fail-fast after ${state.batchFailureCount} failures; last=${state.lastBatchFailureReason ?? "unknown"}`,
            level: "warning",
          });
          return { ...state, pendingApproval: false };
        }
      }
    }
  }

  await recordMetaOrchestrationRuntimeEvent(context, sessionId, {
    stepId: "tool-execution",
    executor: "model-stream-runtime",
    status: state.batchFailureCount > 0 || state.roundFallbackRequiredCount > 0 ? "degraded" : "completed",
    summary: `progress=${state.roundHadProgress ? "yes" : "no"}; real_fallback_progress=${state.roundHadRealFallbackToolProgress ? "yes" : "no"}; failures=${state.batchFailureCount}; fallback_required=${state.roundFallbackRequiredCount}`,
    level: state.batchFailureCount > 0 || state.roundFallbackRequiredCount > 0 ? "warning" : "info",
  });
  return { ...state, pendingApproval: false };
}

const REAL_FALLBACK_TOOL_NAMES = new Set([
  "Read",
  "ReadSnippets",
  "SourcePack",
  "Grep",
  "Glob",
  "Bash",
  "Diff",
  "GitStatusInspect",
  "RunVerification",
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readExecuteExtraToolTargetName(input: unknown): string | undefined {
  if (!isPlainRecord(input)) return undefined;
  const direct = input.tool_name;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const nested = input.toolName;
  if (typeof nested === "string" && nested.trim()) return nested.trim();
  return undefined;
}

export function isPreEngineToolCall(toolCall: Pick<ModelToolCall, "name" | "input">): boolean {
  if (isPreEngineToolName(toolCall.name)) return true;
  if (toolCall.name !== "ExecuteExtraTool") return false;
  const targetName = readExecuteExtraToolTargetName(toolCall.input);
  return !!targetName && isPreEngineToolName(targetName);
}

async function executeModelToolUseWithPreFallbackHardCut(
  toolCall: ModelToolCall,
  context: TuiContext,
  sessionId: string,
  output: Writable,
  continuation: PendingModelContinuation,
): Promise<ModelToolExecutionResult> {
  if (isPreEngineFallbackHardCutActive(context) && isPreEngineToolCall(toolCall)) {
    return createPreFallbackHardCutSkippedToolResult(toolCall);
  }
  return executeModelToolUse(toolCall, context, sessionId, output, continuation);
}

export function isRealFallbackToolProgress(
  toolCall: Pick<ModelToolCall, "name" | "input">,
  result: Pick<ModelToolExecutionResult, "ok" | "data">,
): boolean {
  if (isToolBatchFailure(result) || isToolBatchFallbackRequired(result)) return false;
  if (REAL_FALLBACK_TOOL_NAMES.has(toolCall.name)) return true;
  if (toolCall.name !== "ExecuteExtraTool") return false;
  const targetName = readExecuteExtraToolTargetName(toolCall.input);
  return !!targetName && !isPreEngineToolName(targetName) && targetName !== "list_projects";
}

function updateToolBatchExecutionState(
  state: ToolBatchExecutionState,
  toolCall: ModelToolCall,
  result: ModelToolExecutionResult,
  options: ToolBatchExecutionOptions,
): void {
  if (doesWriteSatisfyReportGuard(options.continuation.reportWriteGuard, toolCall, result)) {
    options.continuation.reportWriteGuard.completed = true;
  }
  if (isToolBatchFallbackRequired(result)) {
    state.roundFallbackRequiredCount += 1;
    state.batchFailureCount = 0;
    return;
  }
  if (!isToolBatchFailure(result)) {
    state.roundHadProgress = true;
    if (isRealFallbackToolProgress(toolCall, result)) {
      state.roundHadRealFallbackToolProgress = true;
    }
    state.batchFailureCount = 0;
    return;
  }
  if (options.collectFailureFingerprints) {
    state.roundFailureFingerprints.push(createToolFailureRecoveryFingerprint(toolCall, result));
  }
  state.batchFailureCount += 1;
  state.lastBatchFailureReason = result.text;
  state.stoppedByFailFast = state.batchFailureCount >= 3;
}

async function appendSkippedToolResultsAfterFailFast(
  toolCalls: ModelToolCall[],
  failedToolCall: ModelToolCall,
  messages: ModelMessage[],
  lastFailureReason: string | undefined,
): Promise<void> {
  const failedIndex = toolCalls.indexOf(failedToolCall);
  if (failedIndex < 0) return;
  for (const skippedToolCall of toolCalls.slice(failedIndex + 1)) {
    pushToolResultMessage(
      messages,
      skippedToolCall,
      createToolBatchFailFastSkippedResult(skippedToolCall, lastFailureReason ?? "unknown failure"),
    );
  }
}

function latestUserTextFromMessages(messages: ModelMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    const content = message.content.trim();
    if (!content) continue;
    if (isInternalFinalGateUserPrompt(content)) continue;
    return content;
  }
  return undefined;
}

function isInternalFinalGateUserPrompt(content: string): boolean {
  return content.startsWith("Final answer evidence preflight:") ||
    content.startsWith("最终回答证据前置检查：") ||
    content.startsWith("Final answer claim alignment:") ||
    content.startsWith("最终回答声明对齐：");
}

function recordCacheRequestObservation(
  context: TuiContext,
  kind: CacheRequestKind,
  provider: string,
  request: ModelRequest,
): void {
  recordCacheRequestObservationState(context.cache, kind, provider, request);
}

function recordCacheUsageObservation(
  context: TuiContext,
  kind: CacheRequestKind,
  usage: ModelUsage,
): void {
  recordCacheUsageObservationState(context.cache, usage, kind);
}

function injectAgentCompletionMainChainContext(
  messages: ModelMessage[],
  context: TuiContext,
): string[] {
  const pendingNoticeIds = collectPendingAgentCompletionNotices(context).map((notice) => notice.id);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message?.role === "system" &&
      message.content.includes("AgentCompletionReturnsForMainChain=")
    ) {
      messages.splice(index, 1);
    }
  }
  const promptContext = formatAgentCompletionMainChainContext(context);
  if (!promptContext) return pendingNoticeIds;
  messages.push({ role: "system", content: promptContext });
  return pendingNoticeIds;
}

function isHighReasoningLevel(level: string | undefined): boolean {
  return level?.trim().toLowerCase() === "high";
}

function isHighReasoningToolProfile(endpointProfile: EndpointProfile | undefined): boolean {
  return endpointProfile === "responses" || endpointProfile === "anthropic_messages";
}

export function shouldRetryHighReasoningToolsEmptyResponse(input: {
  endpointProfile?: EndpointProfile;
  reasoningLevel?: string;
  reasoningSent: boolean;
  toolsEnabled: boolean;
  alreadyRetried: boolean;
}): boolean {
  return (
    !input.alreadyRetried &&
    input.toolsEnabled &&
    input.reasoningSent &&
    isHighReasoningLevel(input.reasoningLevel) &&
    isHighReasoningToolProfile(input.endpointProfile)
  );
}

function createHighReasoningToolsEmptyRetryPrompt(language: Language): string {
  return language === "en-US"
    ? "The previous high-reasoning tool-capable stream ended without visible text or tool calls. Retry with the same High reasoning level. Either call the needed tool or provide a visible final answer; do not reduce reasoning level."
    : "上一次 High reasoning + tools 流没有返回可见文本或工具调用。请保持相同 High 推理等级重试；要么调用必要工具，要么给出可见最终回答；不要降低推理等级。";
}

function applyHighReasoningToolsRetryShape(
  request: ModelRequest,
  endpointProfile: EndpointProfile | undefined,
): ModelRequest {
  if (isHighReasoningToolProfile(endpointProfile) && request.tools && request.tools.length > 0) {
    return { ...request, parallelToolCalls: false };
  }
  return request;
}

const LATEST_USER_REQUEST_ANCHOR =
  "Recovery retry boundary: prioritize the latest user request and later transcript messages over older summaries or pre-retry drafts.";

function appendLatestUserRequestAnchor(messages: ModelMessage[]): ModelMessage[] {
  const last = messages.at(-1);
  if (last?.role === "user" && last.content === LATEST_USER_REQUEST_ANCHOR) {
    return messages;
  }
  return [...messages, { role: "user", content: LATEST_USER_REQUEST_ANCHOR }];
}

function showProviderRetryActivity(
  context: TuiContext,
  info: { attempt: number; maxAttempts: number; delayMs: number },
): void {
  context.requestActivityPhase = "provider_retrying";
  context.requestActivityToolName = undefined;
  context.retryInfo = {
    attempt: info.attempt,
    max: info.maxAttempts,
    delaySec: Math.ceil(info.delayMs / 1000),
  };
  context.shellRerender?.();
}


function showProviderRecoveryActivity(context: TuiContext): void {
  context.requestActivityPhase = "provider_recovering";
  context.requestActivityToolName = undefined;
  context.retryInfo = undefined;
  context.shellRerender?.();
}

function showProviderSwitchActivity(context: TuiContext): void {
  context.requestActivityPhase = "provider_switching";
  context.requestActivityToolName = undefined;
  context.retryInfo = undefined;
  context.shellRerender?.();
}

export function evaluateAggregatedFinalAnswerGate(
  context: TuiContext,
  assistantText: string,
  runExtendedGate = true,
): AggregatedFinalAnswerGateResult {
  const claimVerdict = evaluateFinalAnswerClaims(assistantText, context.evidence);
  const extended = runExtendedGate
    ? runArchitectureAndCompletenessFinalGate(context, assistantText)
    : { status: "passed" as const };
  const engineeringVerdict = evaluateEngineeringFinalBoundary(context, assistantText);
  const needsClaim = claimVerdict.status === "needs_disclaimer";
  const needsExtended = extended.status === "needs_disclaimer";
  const needsEngineering = engineeringVerdict.status === "needs_disclaimer";
  if (!needsClaim && !needsExtended && !needsEngineering) {
    return { status: "passed" };
  }
  return {
    status: "needs_disclaimer",
    ...(needsClaim ? { claimVerdict } : {}),
    ...(needsExtended ? { extendedVerdict: extended.verdict } : {}),
    ...(needsEngineering ? { engineeringVerdict } : {}),
    unsupportedKinds: [
      ...(needsClaim ? claimVerdict.unsupportedKinds : []),
      ...(needsExtended ? extended.verdict.unsupportedKinds : []),
      ...(needsEngineering ? engineeringVerdict.unsupportedKinds : []),
    ],
  };
}

function evaluateEngineeringFinalBoundary(
  context: TuiContext,
  assistantText: string,
): { status: "passed" } | { status: "needs_disclaimer"; unsupportedKinds: string[]; message: string } {
  const signal = context.lastMetaSchedulerDecision?.policyDecision.engineeringSignal;
  if (!signal) return { status: "passed" };
  const highRiskFinal =
    /(?:已完成|已修复|测试通过|全部通过|验证通过|pass(?:ed)?|completed|fixed|verified|tests? passed)/iu.test(
      assistantText,
    );
  if (!highRiskFinal && !signal.failureCategory) return { status: "passed" };
  if (signal.failureCategory === "missing_artifact" && !hasArtifactEvidence(context)) {
    return {
      status: "needs_disclaimer",
      unsupportedKinds: ["engineering_missing_artifact"],
      message: signal.finalBoundaryHint ?? "missing artifact is not verified",
    };
  }
  if (signal.failureCategory === "test_timeout") {
    return {
      status: "needs_disclaimer",
      unsupportedKinds: ["engineering_test_timeout"],
      message: signal.finalBoundaryHint ?? "verification timed out",
    };
  }
  if (signal.failureCategory === "provider_error") {
    if (!context.lastProviderFailure) return { status: "passed" };
    return {
      status: "needs_disclaimer",
      unsupportedKinds: ["engineering_provider_error"],
      message: signal.finalBoundaryHint ?? "provider output was interrupted",
    };
  }
  if (signal.profile === "binary_or_artifact" && highRiskFinal && !hasArtifactEvidence(context)) {
    return {
      status: "needs_disclaimer",
      unsupportedKinds: ["engineering_artifact_unverified"],
      message: signal.finalBoundaryHint ?? "artifact verification is missing",
    };
  }
  if (
    (signal.profile === "swe_python" || signal.profile === "large_python_project") &&
    /\b(?:all|full|entire)\s+(?:tests?|suite)\s+pass(?:ed)?|全部测试|所有测试/iu.test(assistantText) &&
    !hasFullVerificationEvidence(context)
  ) {
    return {
      status: "needs_disclaimer",
      unsupportedKinds: ["engineering_full_suite_unverified"],
      message: signal.finalBoundaryHint ?? "full-suite verification is missing",
    };
  }
  if (
    (signal.profile === "qemu_or_service" || signal.profile === "security_or_network") &&
    /(?:service|server|port|health|daemon|服务|端口|健康检查).{0,80}(?:verified|pass(?:ed)?|正常|通过)/iu.test(
      assistantText,
    ) &&
    !hasServiceVerificationEvidence(context)
  ) {
    return {
      status: "needs_disclaimer",
      unsupportedKinds: ["engineering_service_unverified"],
      message: signal.finalBoundaryHint ?? "service health verification is missing",
    };
  }
  return { status: "passed" };
}

function hasArtifactEvidence(context: TuiContext): boolean {
  const signalTargets =
    context.lastMetaSchedulerDecision?.policyDecision.engineeringSignal.artifactTargets ?? [];
  return hasStructuredArtifactEvidence(context.evidence, signalTargets);
}

function hasFullVerificationEvidence(context: TuiContext): boolean {
  return context.evidence.some((item) =>
    /full(?: test)? suite|all tests|entire suite|test_passed|verification_passed|全部测试|所有测试/iu.test(
      [item.summary, item.source, ...item.supportsClaims].join(" "),
    ),
  );
}

function hasServiceVerificationEvidence(context: Pick<TuiContext, "evidence">): boolean {
  return context.evidence.some((item) => {
    const service = readEvidenceDataRecord(item, "service");
    const serviceHint = readEvidenceDataRecord(item, "serviceHint");
    return service?.ready === true || serviceHint?.ready === true;
  });
}

function isFinalGateEvidenceActionSatisfied(
  actionPlan: FinalGateEvidenceGapActionPlan,
  newEvidence: TuiContext["evidence"],
  result: ModelToolExecutionResult,
): boolean {
  if (result.ok !== true) return false;
  if (actionPlan.action === "verification_request") {
    return hasFreshVerificationEvidenceForFinalClaimAlignment(newEvidence);
  }
  if (actionPlan.reason === "artifact_gap_readonly") {
    return newEvidence.some((item) => {
      const artifactHint = readEvidenceDataRecord(item, "artifactHint");
      return artifactHint?.exists === true;
    });
  }
  if (actionPlan.reason === "git_gap_readonly") {
    return true;
  }
  if (actionPlan.reason === "service_runtime_gap_readonly") {
    return hasServiceVerificationEvidence({ evidence: newEvidence });
  }
  return false;
}

function classifyFinalGateEvidenceAttemptGap(
  actionPlan: FinalGateEvidenceGapActionPlan,
  result: ModelToolExecutionResult,
): string {
  if (result.ok !== true) return "tool_failed";
  if (actionPlan.action === "verification_request") return "verification_not_proven";
  if (actionPlan.reason === "artifact_gap_readonly") return "artifact_not_proven";
  if (actionPlan.reason === "git_gap_readonly") return "git_not_proven";
  if (actionPlan.reason === "service_runtime_gap_readonly") return "service_not_proven";
  return "evidence_not_proven";
}

export function shouldContinueAfterFinalGateEvidenceAction(
  result: FinalGateEvidenceActionResult,
  evidenceActionRetryCount: number,
): result is Extract<FinalGateEvidenceActionResult, { status: "evidence_recorded" | "attempt_recorded" }> {
  if (result.status === "evidence_recorded") return true;
  return result.status === "attempt_recorded" && evidenceActionRetryCount < MAX_FINAL_GATE_EVIDENCE_ACTION_RETRIES;
}

export function planFinalGateEvidenceGapAction(input: {
  result: Extract<AggregatedFinalAnswerGateResult, { status: "needs_disclaimer" }>;
  context: Pick<TuiContext, "permissionMode" | "evidence" | "language"> &
    Partial<Pick<TuiContext, "tools" | "recentlyMentionedFiles" | "lastMetaSchedulerDecision">>;
  userText?: string;
  assistantText?: string;
  retryBudgetRemaining?: boolean;
  evidenceActionRetryCount?: number;
}): FinalGateEvidenceGapActionPlan {
  const { result, context } = input;
  const language = context.language;
  const gap = classifyFinalGateEvidenceGap(result.unsupportedKinds);
  const constraints = parseUserActionConstraints(input.userText);
  if (gap === "verification" || gap === "completion") {
    if (forbidsVerificationEvidence(constraints)) {
      return {
        action: "blocked_explanation",
        reason: "user_forbid_commands",
        directive: formatEvidenceGapBlocker("user_forbid_commands", language),
      };
    }
  }
  if (constraints.forbidAllTools) {
    return {
      action: "blocked_explanation",
      reason: "user_forbid_commands",
      directive: formatEvidenceGapBlocker("user_forbid_commands", language),
    };
  }
  if (gap === "artifact") {
    const artifactAction = createArtifactReadonlyEvidenceAction({
      text: input.assistantText ?? input.userText ?? "",
      context,
      retryCount: input.evidenceActionRetryCount ?? 0,
    });
    return {
      action: "readonly_check",
      reason: "artifact_gap_readonly",
      directive: formatEvidenceGapToolDirective({
        language,
        action: "readonly_check",
        missing: mapFinalGateKindsToUserLabels(result.unsupportedKinds, language),
        tools: ["Read", "Grep", "Glob"],
        note:
          language === "en-US"
            ? "Only inspect existing files or report references; do not write files and do not run Bash."
            : "只检查已有文件或报告引用；不要写文件，也不要运行 Bash。",
      }),
      evidenceAction: artifactAction,
    };
  }
  if (gap === "git") {
    return {
      action: "readonly_check",
      reason: "git_gap_readonly",
      directive: formatEvidenceGapToolDirective({
        language,
        action: "readonly_check",
        missing: mapFinalGateKindsToUserLabels(result.unsupportedKinds, language),
        tools: ["GitStatusInspect"],
        note:
          language === "en-US"
            ? "Inspect git status only; do not create commits, branches, worktrees, or run Bash."
            : "只检查 git 状态；不要创建 commit、分支、worktree，也不要运行 Bash。",
      }),
      evidenceAction: {
        toolName: "GitStatusInspect",
        input: { includeDetails: true },
        summary: "inspect git status for final-gate git evidence",
      },
    };
  }
  if (gap === "completion") {
    if (context.permissionMode === "plan") {
      return {
        action: "blocked_explanation",
        reason: "readonly_mode_blocks_verification",
        directive: formatEvidenceGapBlocker("readonly_mode_blocks_verification", language),
      };
    }
    return createVerificationEvidenceGapPlan({
      language,
      permissionMode: context.permissionMode,
      reason:
        context.permissionMode === "default"
          ? "completion_gap_verification_requires_permission"
          : "completion_gap_verification_allowed_by_mode",
      missingKinds: result.unsupportedKinds,
      level: selectFinalGateVerificationLevel(result),
    });
  }
  if (gap === "runtime") {
    const runtimeAction = createServiceRuntimeReadonlyEvidenceAction(
      [input.assistantText, input.userText].filter(Boolean).join("\n"),
    );
    return {
      action: "readonly_check",
      reason: "service_runtime_gap_readonly",
      directive: formatEvidenceGapToolDirective({
        language,
        action: "readonly_check",
        missing: mapFinalGateKindsToUserLabels(result.unsupportedKinds, language),
        tools: ["Read", "Grep", "Glob"],
        note:
          language === "en-US"
            ? "Only inspect existing logs, config, or health/status references; do not start services, run Bash, curl networks, or write files."
            : "只检查已有日志、配置或 health/status 线索；不要启动服务，不要运行 Bash，不要 curl 网络，也不要写文件。",
      }),
      evidenceAction: runtimeAction,
    };
  }
  if (gap === "verification") {
    if (context.permissionMode === "plan") {
      return {
        action: "blocked_explanation",
        reason: "readonly_mode_blocks_verification",
        directive: formatEvidenceGapBlocker("readonly_mode_blocks_verification", language),
      };
    }
    return createVerificationEvidenceGapPlan({
      language,
      permissionMode: context.permissionMode,
      reason: context.permissionMode === "default" ? "verification_requires_permission" : "verification_allowed_by_mode",
      missingKinds: result.unsupportedKinds,
      level: selectFinalGateVerificationLevel(result),
    });
  }
  return {
    action: "downgrade_only",
    reason: "unsupported_gap",
    directive: createFinalGateEvidenceTaskDirective(result, language),
  };
}

function createVerificationEvidenceGapPlan(input: {
  language: Language;
  permissionMode: TuiContext["permissionMode"];
  reason: string;
  missingKinds: string[];
  level?: FinalGateVerificationLevel;
}): FinalGateEvidenceGapActionPlan {
  const level = input.level ?? "typecheck";
  return {
    action: "verification_request",
    reason: input.reason,
    directive: formatEvidenceGapToolDirective({
      language: input.language,
      action: "verification_request",
      missing: mapFinalGateKindsToUserLabels(input.missingKinds, input.language),
      tools: input.permissionMode === "default" ? ["Bash"] : ["RunVerification"],
      note:
        input.permissionMode === "default"
          ? input.language === "en-US"
            ? "Use one minimal focused/typecheck Bash command so decidePermission can route approval through pendingLocalApproval/PermissionPanel; do not use RunVerification to bypass ask mode."
            : "使用一条最小 focused/typecheck Bash 命令，让 decidePermission 通过 pendingLocalApproval/PermissionPanel 处理授权；不要用 RunVerification 绕过 ask 模式。"
          : input.language === "en-US"
            ? "Run the smallest focused/typecheck verification first; do not run a full suite unless focused evidence is insufficient."
            : "先运行最小 focused/typecheck 验证；除非 focused 证据不足，不要直接跑全量套件。",
    }),
    evidenceAction:
      input.permissionMode === "default"
        ? {
            toolName: "Bash",
            input: { level },
            strategy: "minimal_bash_verification",
            summary: "run one minimal verification command through Bash permission flow",
          }
        : {
            toolName: "RunVerification",
            input: { level },
            summary: `run minimal ${level} verification through RunVerification`,
          },
  };
}

function selectFinalGateVerificationLevel(
  result: Extract<AggregatedFinalAnswerGateResult, { status: "needs_disclaimer" }>,
): FinalGateVerificationLevel {
  const claimVerdict = result.claimVerdict;
  const phrases = claimVerdict?.matchedClaims
    .filter((claim) => claimVerdict.unsupportedKinds.includes(claim.kind))
    .map((claim) => claim.phrase.toLowerCase()) ?? [];
  const joined = phrases.join(" ");
  if (
    result.unsupportedKinds.includes("test_claim") ||
    /(?:测试|tests?\s+passed|vitest|jest|pytest|go\s+test|cargo\s+test)/iu.test(joined)
  ) {
    return "test";
  }
  if (
    /(?:build|构建)/iu.test(joined) ||
    result.unsupportedKinds.includes("engineering_full_suite_unverified")
  ) {
    return "build";
  }
  if (/(?:lint|eslint|静态检查)/iu.test(joined)) {
    return "lint";
  }
  if (/(?:smoke|冒烟)/iu.test(joined)) {
    return "smoke";
  }
  return "typecheck";
}

function isTerminalFinalGateGapAction(actionPlan: FinalGateEvidenceGapActionPlan): boolean {
  return actionPlan.action === "blocked_explanation" || actionPlan.action === "downgrade_only";
}

async function recordFinalGateGapPlan(input: {
  context: TuiContext;
  output: Writable;
  sessionId: string;
  actionPlan: FinalGateEvidenceGapActionPlan;
  scope?: string;
}): Promise<void> {
  startRequestActivity(input.output, input.context, "verifying_final_answer");
  const scope = input.scope ? ` ${input.scope}` : "";
  const tool = input.actionPlan.evidenceAction?.toolName ?? "none";
  await appendSystemEvent(
    input.context,
    input.sessionId,
    `final_answer_gap_planner${scope} action=${input.actionPlan.action} reason=${input.actionPlan.reason} evidence_action=${tool}`,
    isTerminalFinalGateGapAction(input.actionPlan) ? "warning" : "info",
  );
}

async function runFinalGateEvidenceAction(input: {
  actionPlan: FinalGateEvidenceGapActionPlan;
  context: TuiContext;
  output: Writable;
  sessionId: string;
  messages: ModelMessage[];
  runtime: {
    provider: string;
    model: string;
    endpointProfile: EndpointProfile;
    reasoningLevel?: string;
    reasoningSent: boolean;
  };
  reportWriteGuard?: PendingModelContinuation["reportWriteGuard"];
}): Promise<FinalGateEvidenceActionResult> {
  const toolCall = await createFinalGateEvidenceToolCall(input.actionPlan, input.context);
  if (!toolCall) {
    return { status: "unsupported", reason: input.actionPlan.reason };
  }
  const continuation: PendingModelContinuation = {
    messages: [
      ...input.messages,
      {
        role: "assistant",
        content: "",
        toolCalls: [toolCall],
      },
    ],
    provider: input.runtime.provider,
    model: input.runtime.model,
    endpointProfile: input.runtime.endpointProfile,
    reasoningLevel: input.runtime.reasoningLevel,
    reasoningSent: input.runtime.reasoningSent,
    ...(input.reportWriteGuard ? { reportWriteGuard: input.reportWriteGuard } : {}),
  };
  await appendSystemEvent(
    input.context,
    input.sessionId,
    `final_answer_gap_action dispatch tool=${toolCall.name} reason=${input.actionPlan.reason}`,
    "info",
  );
  const existingEvidenceIds = new Set(input.context.evidence.map((item) => item.id));
  const result = await executeModelToolUse(
    toolCall,
    input.context,
    input.sessionId,
    input.output,
    continuation,
  );
  await recordModelToolFailureForMetaScheduler(input.context, input.sessionId, result);
  await recordFinalGateArtifactProbeEvidence({
    context: input.context,
    sessionId: input.sessionId,
    actionPlan: input.actionPlan,
    toolCall,
    result,
  });
  await recordFinalGateServiceProbeEvidence({
    context: input.context,
    sessionId: input.sessionId,
    actionPlan: input.actionPlan,
    toolCall,
    result,
  });
  if (result.pendingApproval) {
    return { status: "permission_pending" };
  }
  continuation.messages.push({
    role: "tool",
    tool_call_id: toolCall.id,
    content: JSON.stringify(result),
  });
  const newEvidence = input.context.evidence.filter((item) => !existingEvidenceIds.has(item.id));
  const evidenceSatisfied = isFinalGateEvidenceActionSatisfied(
    input.actionPlan,
    newEvidence,
    result,
  );
  if (evidenceSatisfied) {
    return { status: "evidence_recorded", messages: continuation.messages, result };
  }
  const reason = classifyFinalGateEvidenceAttemptGap(input.actionPlan, result);
  await appendSystemEvent(
    input.context,
    input.sessionId,
    `final_answer_gap_action_attempt_recorded reason=${reason} tool=${toolCall.name} ok=${result.ok ? "yes" : "no"}`,
    result.ok ? "info" : "warning",
  );
  return { status: "attempt_recorded", messages: continuation.messages, result, reason };
}

export async function __testRunFinalGateEvidenceAction(
  input: Parameters<typeof runFinalGateEvidenceAction>[0],
): Promise<FinalGateEvidenceActionResult> {
  return runFinalGateEvidenceAction(input);
}

async function createFinalGateEvidenceToolCall(
  actionPlan: FinalGateEvidenceGapActionPlan,
  context: TuiContext,
): Promise<ModelToolCall | undefined> {
  const action = actionPlan.evidenceAction;
  if (!action) return undefined;
  if (action.strategy === "minimal_bash_verification") {
    const actionInput = isFinalGateRecord(action.input) ? action.input : {};
    const command = await selectMinimalBashVerificationCommand(
      context,
      readFinalGateVerificationLevel(actionInput.level),
    );
    if (!command) return undefined;
    return {
      id: `final-gate-evidence-${randomUUID()}`,
      name: "Bash",
      input: {
        command,
        description: "final gate minimal verification evidence",
        timeoutMs: 120_000,
      },
    };
  }
  return {
    id: `final-gate-evidence-${randomUUID()}`,
    name: action.toolName,
    input: action.input ?? {},
  };
}

async function selectMinimalBashVerificationCommand(
  context: TuiContext,
  preferredKind?: FinalGateVerificationLevel,
): Promise<string | undefined> {
  const plan = await createVerificationPlan(context.projectPath, "focused");
  const step =
    (preferredKind
      ? plan.find((item) => item.kind === preferredKind && item.synthetic !== true)
      : undefined) ??
    plan.find((item) => item.kind === "typecheck" && item.synthetic !== true) ??
    plan.find((item) => item.synthetic !== true);
  return step?.command;
}

function readFinalGateVerificationLevel(value: unknown): FinalGateVerificationLevel | undefined {
  return value === "typecheck" ||
    value === "test" ||
    value === "build" ||
    value === "lint" ||
    value === "smoke"
    ? value
    : undefined;
}

function isFinalGateRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function buildAggregatedDowngradedFinalAnswer(
  result: Extract<AggregatedFinalAnswerGateResult, { status: "needs_disclaimer" }>,
  language: Language,
  evidence: TuiContext["evidence"] = [],
): string {
  return buildEvidenceBackedFinalBoundaryAnswer(result, language, evidence);
}

export function buildEvidenceBackedFinalBoundaryAnswer(
  result: Extract<AggregatedFinalAnswerGateResult, { status: "needs_disclaimer" }>,
  language: Language,
  evidence: TuiContext["evidence"] = [],
): string {
  const labels = mapFinalGateKindsToUserLabels(result.unsupportedKinds, language);
  const missing = labels.length > 0
    ? labels.join(language === "en-US" ? ", " : "、")
    : language === "en-US" ? "matching evidence" : "匹配证据";
  const evidenceScope = formatEvidenceBoundaryScope(evidence, language);
  if (language === "en-US") {
    return [
      `I have confirmed the part covered by the checks so far: ${evidenceScope}.`,
      `I still need more evidence for ${missing}; if we continue, I will gather that evidence first.`,
    ].join("\n");
  }
  return [
    `我已确认目前检查覆盖到的部分：${evidenceScope}。`,
    `还需要补充${missing}；如果继续，我会先补这部分证据。`,
  ].join("\n");
}

function formatEvidenceBoundaryScope(evidence: TuiContext["evidence"], language: Language): string {
  const summary = summarizeEvidenceRecords(evidence);
  if (summary.total === 0) {
    return language === "en-US"
      ? "no evidence has been recorded in this turn"
      : "本轮还没有记录到可支撑结论的证据";
  }
  const categories = Object.keys(summary.counts)
    .map((kind) => formatEvidenceBoundaryCategory(kind, language))
    .filter(Boolean);
  const uniqueCategories = Array.from(new Set(categories));
  const label = uniqueCategories.join(language === "en-US" ? ", " : "、");
  return language === "en-US"
    ? `${summary.total} recorded item(s), covering ${label || "runtime evidence"}`
    : `已有 ${summary.total} 条记录，覆盖${label || "运行证据"}`;
}

function formatEvidenceBoundaryCategory(kind: string, language: Language): string {
  const zh: Record<string, string> = {
    verification: "验证记录",
    source_read: "文件读取",
    source_search: "搜索记录",
    file_change: "文件变更",
    artifact: "产物记录",
    runtime: "运行状态记录",
    workflow: "工作流记录",
    permission: "权限记录",
    other: "其他记录",
  };
  const en: Record<string, string> = {
    verification: "verification",
    source_read: "file reads",
    source_search: "searches",
    file_change: "file changes",
    artifact: "artifacts",
    runtime: "runtime checks",
    workflow: "workflow records",
    permission: "permission records",
    other: "other records",
  };
  return (language === "en-US" ? en : zh)[kind] ?? (language === "en-US" ? "other records" : "其他记录");
}


export function shouldRewriteFinalGateClaimAlignment(
  result: AggregatedFinalAnswerGateResult,
  context: Pick<TuiContext, "evidence">,
): boolean {
  if (result.status !== "needs_disclaimer") return false;
  if (!result.claimVerdict) return false;
  if (result.unsupportedKinds.some((kind) => kind !== "completion_claim")) return false;
  if (result.claimVerdict.unsupportedKinds.some((kind) => kind !== "completion_claim")) {
    return false;
  }
  return hasFreshVerificationEvidenceForFinalClaimAlignment(context.evidence);
}

function hasFreshVerificationEvidenceForFinalClaimAlignment(evidence: TuiContext["evidence"]): boolean {
  return evidence.some((record) => {
    if (record.kind !== "command_output" && record.kind !== "test_result") return false;
    if (record.supportsClaims.includes("tool_failure")) return false;
    if (record.supportsClaims.includes("bash_exit_nonzero")) return false;
    if (
      record.supportsClaims.includes("verification_passed") &&
      !isEvidenceStaleForClaim(record, "verification_claim")
    ) {
      return true;
    }
    return (
      ["test_passed", "typecheck_passed", "build_passed", "diff_check_passed", "smoke_passed"].some(
        (claim) => record.supportsClaims.includes(claim),
      ) && !isEvidenceStaleForClaim(record, "completion_pass")
    );
  });
}

function createFinalAnswerEvidencePreflightPrompt(
  language: Language,
  evidence: TuiContext["evidence"],
): string {
  const evidenceScope = formatEvidenceBoundaryScope(evidence, language);
  if (language === "en-US") {
    return [
      "Final answer evidence preflight:",
      `- Current recorded evidence: ${evidenceScope}.`,
      "- Before writing the final answer, align any high-risk claims to the recorded evidence.",
      "- Use LinghunFinalAnswerClaims only for claims supported by fresh evidence.",
      "- If evidence is missing, state the boundary plainly instead of claiming completion.",
      "- Do not call tools in this final-answer rewrite pass.",
    ].join("\n");
  }
  return [
    "最终回答证据前置检查：",
    `- 当前已记录证据：${evidenceScope}。`,
    "- 写最终回答前，请把高风险声明收敛到已有证据能支撑的范围。",
    "- LinghunFinalAnswerClaims 只声明 fresh 证据能支撑的类型。",
    "- 如果证据不足，直接说明边界，不要宣称已完成。",
    "- 本次最终回答整理不要调用工具。",
  ].join("\n");
}

function createFinalGateClaimAlignmentRewritePrompt(language: Language): string {
  if (language === "en-US") {
    return [
      "Final answer claim alignment:",
      "- Existing fresh verification/test evidence supports a verification or pass claim, not broad task completion.",
      "- Rewrite the final answer naturally from the current evidence.",
      "- Keep the visible answer scoped to what was actually verified.",
      "- Use verification_claim or completion_pass in LinghunFinalAnswerClaims. Do not use completion_claim unless task completion evidence exists.",
      "- Do not call tools for this rewrite.",
    ].join("\n");
  }
  return [
    "最终回答声明对齐：",
    "- 当前已有 fresh 验证/测试证据，只能支撑验证通过或测试通过声明，不能扩大成整个任务完成。",
    "- 请基于当前证据重写自然最终答案。",
    "- 可见正文只写实际已验证的范围。",
    "- LinghunFinalAnswerClaims 使用 verification_claim 或 completion_pass；除非已有 task completion evidence，不要使用 completion_claim。",
    "- 本次重写不要调用工具。",
  ].join("\n");
}

function createFinalGateEvidenceTaskDirective(
  result: Extract<AggregatedFinalAnswerGateResult, { status: "needs_disclaimer" }>,
  language: Language,
): string {
  const labels = mapFinalGateKindsToUserLabels(result.unsupportedKinds, language);
  const missing = labels.length > 0 ? labels.join(language === "en-US" ? ", " : "、") : (
    language === "en-US" ? "matching evidence" : "匹配证据"
  );
  return language === "en-US"
    ? [
        "Evidence task:",
        `- Missing: ${missing}.`,
        "- Do not produce another final answer yet if this evidence can be gathered.",
        "- Call the smallest relevant tool or verification command now. If permission, budget, or scope blocks that, explain the blocker and downgrade.",
      ].join("\n")
    : [
        "补证据任务：",
        `- 缺少：${missing}。`,
        "- 如果这些证据可以通过工具获得，不要立刻再次给最终回答。",
        "- 现在调用最小相关工具或验证命令；若权限、预算或范围阻塞，再说明阻塞原因并降级。",
      ].join("\n");
}

function classifyFinalGateEvidenceGap(kinds: string[]): "verification" | "completion" | "artifact" | "git" | "runtime" | "other" {
  if (kinds.some((kind) => /git|commit|branch|push|stable_point/iu.test(kind))) return "git";
  if (kinds.some((kind) => /completion_claim|task_completion|task_completed/iu.test(kind))) {
    return "completion";
  }
  if (kinds.some((kind) => /artifact|file|report|write/iu.test(kind))) return "artifact";
  if (kinds.some((kind) => /service|runtime|port|health|log|daemon|server/iu.test(kind))) {
    return "runtime";
  }
  if (kinds.some((kind) => /test|typecheck|build|lint|verification|pass|full_suite/iu.test(kind))) {
    return "verification";
  }
  return "other";
}

function createArtifactReadonlyEvidenceAction(input: {
  text: string;
  context: Pick<TuiContext, "evidence"> &
    Partial<Pick<TuiContext, "tools" | "recentlyMentionedFiles" | "lastMetaSchedulerDecision">>;
  retryCount: number;
}): NonNullable<FinalGateEvidenceGapActionPlan["evidenceAction"]> {
  const path = extractLikelyArtifactPath(input.text);
  if (path) {
    return {
      toolName: "Read",
      input: { path, limit: 200 },
      strategy: "artifact_readonly_check",
      summary: `read claimed artifact ${path}`,
    };
  }
  const candidate = collectArtifactProbeCandidatePaths(input.context)
    .find((item) => !hasArtifactProbeEvidenceForPath(input.context.evidence, item));
  if (candidate) {
    return {
      toolName: "Read",
      input: { path: candidate, limit: 200 },
      strategy: "artifact_readonly_check",
      summary: `read artifact candidate ${candidate}`,
    };
  }
  if (input.retryCount > 0) {
    return {
      toolName: "Grep",
      input: {
        pattern: "artifact|report|output|generated|created|产物|报告|输出|生成|创建",
        path: ".",
        limit: 30,
      },
      strategy: "artifact_readonly_check",
      summary: "grep for likely artifact references",
    };
  }
  return {
    toolName: "Glob",
    input: { pattern: "**/*.{md,txt,json,log,html,csv,xml,yaml,yml,pdf,png,jpg,jpeg,zip}", path: ".", limit: 20 },
    strategy: "artifact_readonly_check",
    summary: "glob for likely report/artifact files",
  };
}

function collectArtifactProbeCandidatePaths(
  context: Pick<TuiContext, "evidence"> &
    Partial<Pick<TuiContext, "tools" | "recentlyMentionedFiles" | "lastMetaSchedulerDecision">>,
): string[] {
  const targets =
    context.lastMetaSchedulerDecision?.policyDecision.engineeringSignal.artifactTargets ?? [];
  const toolChanged = context.tools?.changedFiles ?? [];
  const mentioned = context.recentlyMentionedFiles ?? [];
  const evidencePaths = context.evidence.flatMap((item) => [
    item.outputPath,
    item.fullOutputPath,
    item.logPath,
    ...extractLikelyFilePathsFromText(`${item.summary} ${item.source}`),
  ]);
  return uniqueArtifactTargets([
    ...targets,
    ...toolChanged,
    ...mentioned,
    ...evidencePaths.filter((item): item is string => Boolean(item)),
  ]).filter((item) => !item.includes("*"));
}

function hasArtifactProbeEvidenceForPath(evidence: TuiContext["evidence"], path: string): boolean {
  return hasStructuredArtifactEvidenceForPath(evidence, path);
}

function extractLikelyFilePathsFromText(text: string): string[] {
  return Array.from(
    text.matchAll(
      /(?:^|[\s"'`：（(])((?:\.{1,2}[\\/]|[A-Za-z]:[\\/]|\/)?[\w .@()-]+(?:[\\/][\w .@()-]+)*\.[A-Za-z0-9._-]+)(?:$|[\s"'`，。；:）)])/giu,
    ),
  )
    .map((match) => match[1]?.trim())
    .filter((item): item is string => Boolean(item));
}

async function recordFinalGateArtifactProbeEvidence(input: {
  context: TuiContext;
  sessionId: string;
  actionPlan: FinalGateEvidenceGapActionPlan;
  toolCall: ModelToolCall;
  result: ModelToolExecutionResult;
}): Promise<void> {
  if (input.actionPlan.reason !== "artifact_gap_readonly") return;
  if (input.actionPlan.evidenceAction?.strategy !== "artifact_readonly_check") return;
  if (input.toolCall.name !== "Read" || input.result.ok !== true) return;
  const path = readToolCallPath(input.toolCall.input);
  if (!path || !artifactProbeMatchesRequestedTarget(input.context, path)) return;
  if (hasArtifactProbeEvidenceForPath(input.context.evidence, path)) return;
  const evidence = createEvidenceRecord(
    "command_output",
    `final gate artifact probe: ${path} exists`,
    "final-gate:artifact-probe",
    ["artifact", "artifact_exists", "readonly_low_noise_evidence"],
  );
  evidence.outputPath = path;
  evidence.data = { artifactHint: { path, exists: true } };
  rememberEvidence(input.context, evidence);
  await input.context.store.appendEvent(input.sessionId, { type: "evidence_record", ...evidence });
  await appendSystemEvent(
    input.context,
    input.sessionId,
    `final_answer_gap_artifact_probe evidence=${evidence.id} path=${path}`,
    "info",
  );
  if (isMissingArtifactToolFailure(input.context.lastToolFailure)) {
    input.context.lastToolFailure = undefined;
    await appendSystemEvent(
      input.context,
      input.sessionId,
      "final_answer_gap_artifact_probe cleared stale missing-artifact tool failure",
      "info",
    );
  }
}

async function recordFinalGateServiceProbeEvidence(input: {
  context: TuiContext;
  sessionId: string;
  actionPlan: FinalGateEvidenceGapActionPlan;
  toolCall: ModelToolCall;
  result: ModelToolExecutionResult;
}): Promise<void> {
  if (input.actionPlan.reason !== "service_runtime_gap_readonly") return;
  if (input.actionPlan.evidenceAction?.strategy !== "service_runtime_readonly_check") return;
  if (input.toolCall.name !== "Read" && input.toolCall.name !== "Grep") return;
  if (input.result.ok !== true || !serviceProbeHasReadySignal(input.result.text)) return;
  const path = readToolCallPath(input.toolCall.input);
  const target = extractServiceProbeTarget(input.result.text) ?? path ?? "service";
  if (hasServiceProbeEvidenceForTarget(input.context.evidence, target)) return;
  const evidence = createEvidenceRecord(
    "command_output",
    `final gate service probe: ${target} ready`,
    "final-gate:service-probe",
    ["runtime", "service", "service_ready", "readonly_low_noise_evidence"],
  );
  evidence.data = { serviceHint: { target, ready: true } };
  rememberEvidence(input.context, evidence);
  await input.context.store.appendEvent(input.sessionId, { type: "evidence_record", ...evidence });
  await appendSystemEvent(
    input.context,
    input.sessionId,
    `final_answer_gap_service_probe evidence=${evidence.id} target=${target}`,
    "info",
  );
}

function serviceProbeHasReadySignal(text: string): boolean {
  const lines = text.split(/\r?\n/u);
  return lines.some((line) => {
    const normalized = line.trim();
    if (!normalized) return false;
    if (/(?:not\s+ready|unhealthy|error|failed|failure|timeout|refused|crash|panic|异常|失败|错误|拒绝|超时)/iu.test(normalized)) {
      return false;
    }
    return /(?:\bready\b|\blistening\b|\bstarted\b|\brunning\b|\bhealthy\b|health\s*(?:check)?\s*(?:ok|pass)|server.{0,24}(?:up|ready|running)|port.{0,24}(?:open|ready|listening)|正常|已启动|启动完成|监听|就绪|健康)/iu.test(
      normalized,
    );
  });
}

function extractServiceProbeTarget(text: string): string | undefined {
  const hostPort = text.match(/\b(?:https?:\/\/)?((?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[[0-9a-f:]+\]|[A-Za-z0-9.-]+):\d{2,5})\b/iu);
  if (hostPort?.[1]) return hostPort[1];
  const port = text.match(/\bport\s+(\d{2,5})\b/iu) ?? text.match(/\b端口\s*(\d{2,5})\b/iu);
  if (port?.[1]) return `port:${port[1]}`;
  return undefined;
}

function hasServiceProbeEvidenceForTarget(evidence: TuiContext["evidence"], target: string): boolean {
  return evidence.some((item) => {
    const service = readEvidenceDataRecord(item, "service");
    const serviceHint = readEvidenceDataRecord(item, "serviceHint");
    return serviceProbeTargetMatches(service, target) || serviceProbeTargetMatches(serviceHint, target);
  });
}

function serviceProbeTargetMatches(data: Record<string, unknown> | undefined, target: string): boolean {
  if (data?.ready !== true) return false;
  const existing = typeof data.target === "string" ? data.target : "";
  return existing === target || (existing !== "" && target !== "" && existing.includes(target));
}

function artifactProbeMatchesRequestedTarget(context: TuiContext, path: string): boolean {
  const targets = context.lastMetaSchedulerDecision?.policyDecision.engineeringSignal.artifactTargets ?? [];
  if (targets.length === 0) return true;
  return uniqueArtifactTargets(targets).some((target) => pathsReferToSameArtifactHint(path, target));
}

function readToolCallPath(input: unknown): string | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const record = input as Record<string, unknown>;
  const value = record.path ?? record.file_path;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isMissingArtifactToolFailure(
  failure: TuiContext["lastToolFailure"] | undefined,
): boolean {
  return Boolean(
    failure &&
      /missing artifact|missing required artifact|no such file|not found|找不到|未找到/iu.test(
        failure.summary,
      ),
  );
}

function createServiceRuntimeReadonlyEvidenceAction(text: string): NonNullable<FinalGateEvidenceGapActionPlan["evidenceAction"]> {
  const path = extractLikelyArtifactPath(text);
  if (path) {
    return {
      toolName: "Read",
      input: { path, limit: 200 },
      strategy: "service_runtime_readonly_check",
      summary: `read claimed runtime evidence ${path}`,
    };
  }
  return {
    toolName: "Grep",
    input: {
      pattern: "health|ready|listening|server|service|daemon|port|localhost|127\\.0\\.0\\.1|error|failed",
      path: ".",
      limit: 30,
    },
    strategy: "service_runtime_readonly_check",
    summary: "grep existing files for service/runtime health evidence",
  };
}

function extractLikelyArtifactPath(text: string): string | undefined {
  const match = text.match(
    /(?:^|[\s"'`：（(])((?:\.{1,2}[\\/]|[A-Za-z]:[\\/]|\/)?[\w .@()-]+(?:[\\/][\w .@()-]+)*\.(?:md|txt|json|jsonl|log|html|csv|xml|yaml|yml|pdf|png|jpg|jpeg|zip|tar|gz|tsx?|jsx?|py|rs|go|java|cs|cpp|c|h))(?:$|[\s"'`，。；:）)])/iu,
  );
  return match?.[1]?.trim();
}

function userForbidsCommandEvidence(userText: string | undefined): boolean {
  return forbidsVerificationEvidence(parseUserActionConstraints(userText));
}

function formatEvidenceGapToolDirective(input: {
  language: Language;
  action: FinalGateEvidenceGapActionPlan["action"];
  missing: string[];
  tools: string[];
  note: string;
}): string {
  const missing = input.missing.length > 0
    ? input.missing.join(input.language === "en-US" ? ", " : "、")
    : input.language === "en-US" ? "matching evidence" : "匹配证据";
  const tools = input.tools.join(", ");
  if (input.language === "en-US") {
    return [
      "Permission-aware evidence gap plan:",
      `- Action: ${input.action}.`,
      `- Missing: ${missing}.`,
      `- Use exactly the smallest relevant tool path first: ${tools}.`,
      `- ${input.note}`,
      "- Do not produce a final answer until the tool result or permission blocker is recorded.",
    ].join("\n");
  }
  return [
    "权限感知补证据计划：",
    `- 动作：${input.action}。`,
    `- 缺少：${missing}。`,
    `- 优先使用最小相关工具路径：${tools}。`,
    `- ${input.note}`,
    "- 在工具结果或权限阻塞被记录前，不要输出最终回答。",
  ].join("\n");
}

function formatEvidenceGapBlocker(
  reason: "retry_budget_exhausted" | "user_forbid_commands" | "readonly_mode_blocks_verification",
  language: Language,
): string {
  if (language === "en-US") {
    if (reason === "user_forbid_commands") {
      return "Evidence gap remains, but the user explicitly constrained this turn to no commands/tests. Downgrade and state the needed authorization.";
    }
    if (reason === "readonly_mode_blocks_verification") {
      return "Evidence gap requires verification commands, but current permission mode is read-only/plan. Downgrade and ask for authorization before running tests or Bash.";
    }
    return "Evidence gap remains and final-gate retry budget is exhausted. Downgrade without claiming completion.";
  }
  if (reason === "user_forbid_commands") {
    return "证据缺口仍存在，但用户明确限制本轮不要执行命令/测试。请降级说明，并写明需要用户授权的下一步。";
  }
  if (reason === "readonly_mode_blocks_verification") {
    return "证据缺口需要验证命令，但当前是只读/plan 模式。请降级说明，并在运行测试或 Bash 前请求授权。";
  }
  return "证据缺口仍存在，且 final-gate retry 预算已用尽。请降级说明，不要声称完成。";
}

function mapFinalGateKindsToUserLabels(kinds: string[], language: Language): string[] {
  const labels = new Set<string>();
  for (const kind of kinds) {
    if (/test|typecheck|build|lint|verification|completion|pass|full_suite/iu.test(kind)) {
      labels.add(language === "en-US" ? "verification or test evidence" : "验证或测试证据");
    } else if (/artifact|file|report|write/iu.test(kind)) {
      labels.add(language === "en-US" ? "artifact or file evidence" : "产物或文件证据");
    } else if (/architecture|completeness|drift|boundary/iu.test(kind)) {
      labels.add(language === "en-US" ? "architecture or closure evidence" : "架构或闭合证据");
    } else if (/service|runtime|port|health/iu.test(kind)) {
      labels.add(language === "en-US" ? "service runtime evidence" : "服务运行证据");
    } else if (/git|commit|branch|push/iu.test(kind)) {
      labels.add(language === "en-US" ? "Git operation evidence" : "Git 操作证据");
    } else {
      labels.add(language === "en-US" ? "matching evidence" : "匹配证据");
    }
  }
  return Array.from(labels);
}

async function recordFinalAnswerGateDowngrade(
  context: TuiContext,
  sessionId: string,
  result: Extract<AggregatedFinalAnswerGateResult, { status: "needs_disclaimer" }>,
): Promise<void> {
  const kinds = result.unsupportedKinds.join(",") || "unsupported_final_claim";
  await appendSystemEvent(
    context,
    sessionId,
    `final_answer_gate_aggregated downgrade kinds=${kinds}`,
    "warning",
  );
  await captureFailureLearning(context, sessionId, {
    category: "final_gate_downgrade",
    failureSummary: `final answer gate downgraded unsupported claims: ${kinds}`,
    rootCauseGuess: "assistant final answer claimed completion/verification without matching evidence",
    avoidNextTime:
      "Only claim done, passed, verified, or ready after matching evidence exists in the current turn.",
    sourceRef: "system_event:final_answer_gate_aggregated",
    relatedTarget: "final_answer_gate",
    severity: "medium",
  });
}

export function handleNaturalInput(
  text: string,
  context: TuiContext,
  output: Writable,
): Promise<"handled" | "message">;

export function handleNaturalInput(
  text: string,
  context: TuiContext,
  gateway: ModelGateway | undefined,
  output: Writable,
): Promise<"handled" | "message">;

export async function handleNaturalInput(
  text: string,
  context: TuiContext,
  gatewayOrOutput: ModelGateway | Writable | undefined,
  maybeOutput?: Writable,
): Promise<"handled" | "message"> {
  const gateway = maybeOutput ? (gatewayOrOutput as ModelGateway) : undefined;
  const output = maybeOutput ?? (gatewayOrOutput as Writable);
  const pendingLocalApproval = context.pendingLocalApproval;
  if (pendingLocalApproval) {
    const normalized = text.trim().toLowerCase();
    if (/^(details|detail|详情|细节)$/iu.test(normalized)) {
      writeLine(output, formatPendingApprovalDetails(pendingLocalApproval, context));
      writeStatus(output, context);
      return "handled";
    }
    if (/^(yes|y|confirm|ok|okay|确认|是|继续|执行)$/iu.test(normalized)) {
      const approval = pendingLocalApproval;
      context.pendingLocalApproval = undefined;
      // D.13E Step 2 修正 #4：复用 executePermissionApprove，避免双实现漂移
      await executePermissionApprove(approval, context, gateway, output);
      return "handled";
    }
    if (/^(no|n|deny|取消|拒绝|不|否|cancel)$/iu.test(normalized)) {
      const approval = pendingLocalApproval;
      context.pendingLocalApproval = undefined;
      const cancelled = /^(cancel|取消)$/iu.test(normalized);
      await executePermissionDeny(approval, context, gateway, output, cancelled);
      return "handled";
    }
    writeLine(
      output,
      context.language === "en-US"
        ? "A local approval is pending. Type yes/confirm to allow once, or no/cancel to deny; this input was not sent to the model."
        : "当前有本地权限审批待处理。输入 yes/确认/继续 可本次允许，输入 no/取消 可拒绝；这条输入不会发送给模型。",
    );
    writeStatus(output, context);
    return "handled";
  }

  if (context.pendingNaturalCommand) {
    const gate = context.pendingNaturalCommand;
    if (/^(details|detail|详情|细节)$/iu.test(text.trim())) {
      writeLine(output, formatPendingNaturalCommandDetails(gate, context));
      writeStatus(output, context);
      return "handled";
    }
    const decision = matchesNaturalGateConfirmation(gate, text);
    if (decision === "expired") {
      context.pendingNaturalCommand = undefined;
      writeLine(output, t(context, "startGateExpired"));
      writeStatus(output, context);
      return "handled";
    }
    if (decision === "exact_required") {
      if (/^(yes|y|confirm|确认|是|执行|继续)$/iu.test(text.trim())) {
        writeLine(output, t(context, "startGatePlainConfirmationRejected"));
        writeStatus(output, context);
        return "handled";
      }
      writeLine(output, t(context, "startGateExactRequired"));
      writeStatus(output, context);
      return "handled";
    }
    if (decision === "confirmed") {
      context.pendingNaturalCommand = undefined;
      writeLine(output, t(context, "startGateConfirmed"));
      await appendNaturalGateDebugEvent(context, gate, "confirmed");
      const result = await handleSlashCommand(gate.exactCommand, context, output);
      return result === "message" ? "message" : "handled";
    }
    context.pendingNaturalCommand = undefined;
  }

  // D.14D — 模型未配好时的 onboarding 入口（state-gated，不是普通自然语言截胡）。
  // 只有当 shouldOfferUserScopedModelSetup 为真（即当前没有可用的 user provider 配置）
  // 时才命中；模型一旦配好，这条永远不触发，普通自然语言照常进模型主链。这是新手安全
  // 配置路径，不依赖关键词把普通对话转 slash。
  if (shouldOfferUserScopedModelSetup(context) && looksLikeModelSetupInput(text)) {
    await startModelSetup(context, output, parseModelSetupPrefill(text));
    return "handled";
  }

  // D.14D — 输入路由边界（参考：plain text 永远进模型，唯一分支是 "/" 前缀）。
  // 普通自然语言（不以 "/" 开头、无 pending approval / 无 pending Start Gate）默认必须
  // 发送给模型。这里**不再**做任何本地 NL 关键词截胡：
  //   - 已移除 workspace-trust NL Start Gate（"信任这个项目"等）；
  //   - 已移除 index safety repair NL 续跑（"把这些文件加入 ignore 后刷新索引"等）；
  //   - 已移除 composite local status NL 应答（"索引和记忆 MCP 打开了吗"等）。
  // 这些产品能力仍可通过精确 slash command 使用（/trust、/index、/doctor、/status），
  // 普通自然语言不再被中文/英文关键词表转成本地命令意图。

  if (!shouldTriggerArchitectureRuntime(text, context)) {
    context.currentArchitectureCard = undefined;
  }
  const modelGuard = checkResourceGuard(context, "model");
  if (modelGuard) {
    writeLine(output, modelGuard);
    return "handled";
  }
  return "message";
}

type RequestActivityOwner = NonNullable<TuiContext["requestActivityOwner"]>;

function resolveRequestActivityOwner(
  context: TuiContext,
  values: { ownerKind?: RequestActivityOwner["kind"]; requestTurnId?: string } = {},
): RequestActivityOwner {
  const requestTurnId =
    values.ownerKind === "background" ? undefined : values.requestTurnId ?? context.currentRequestTurnId;
  return {
    kind: values.ownerKind ?? (requestTurnId ? "foreground" : "background"),
    ...(requestTurnId ? { requestTurnId } : {}),
  };
}

function sameRequestActivityOwner(
  left: RequestActivityOwner | undefined,
  right: RequestActivityOwner | undefined,
): boolean {
  if (!left || !right) return false;
  if (left.kind !== right.kind) return false;
  return left.requestTurnId === right.requestTurnId;
}

function shouldStartRequestActivity(
  context: TuiContext,
  nextOwner: RequestActivityOwner,
): boolean {
  const currentOwner = context.requestActivityOwner;
  if (!currentOwner || sameRequestActivityOwner(currentOwner, nextOwner)) return true;
  if (currentOwner.kind === "foreground" && nextOwner.kind !== "foreground") return false;
  if (
    currentOwner.kind === "foreground" &&
    nextOwner.kind === "foreground" &&
    currentOwner.requestTurnId !== nextOwner.requestTurnId
  ) {
    return false;
  }
  return true;
}

export function clearRequestActivity(
  context: TuiContext,
  owner?: RequestActivityOwner,
): void {
  if (owner && context.requestActivityOwner && !sameRequestActivityOwner(context.requestActivityOwner, owner)) {
    return;
  }
  const timer = context.requestActivity?.slowTimer;
  if (timer) {
    clearTimeout(timer);
  }
  if (context.requestActivityPhase) {
    const startedAt = (context as { requestActivityStartedAt?: number }).requestActivityStartedAt;
    const endedAtMs = Date.now();
    const firstDeltaAt = (context as { requestActivityFirstDeltaAt?: number })
      .requestActivityFirstDeltaAt;
    const firstDeltaType = (context as { requestActivityFirstDeltaType?: string })
      .requestActivityFirstDeltaType;
    context.lastModelRequest = {
      phase: context.requestActivityPhase,
      toolName: context.requestActivityToolName,
      startedAt: startedAt ? new Date(startedAt).toISOString() : undefined,
      endedAt: new Date(endedAtMs).toISOString(),
      durationMs: startedAt ? Math.max(0, endedAtMs - startedAt) : undefined,
      firstDeltaMs:
        startedAt && firstDeltaAt ? Math.max(0, firstDeltaAt - startedAt) : undefined,
      firstDeltaType,
    };
  }
  context.requestActivity = undefined;
  context.retryInfo = undefined;
  context.requestActivityPhase = undefined;
  context.requestActivityToolName = undefined;
  context.requestActivityToolLines = undefined;
  context.requestActivityToolBytes = undefined;
  context.requestActivityOwner = undefined;
  (context as { requestActivityStartedAt?: number }).requestActivityStartedAt = undefined;
  (context as { requestActivityFirstDeltaAt?: number }).requestActivityFirstDeltaAt = undefined;
  (context as { requestActivityFirstDeltaType?: string }).requestActivityFirstDeltaType =
    undefined;
  (context as { requestActivityToolTarget?: string }).requestActivityToolTarget = undefined;
}

export function recordRequestFirstDelta(context: TuiContext, type: string, nowMs = Date.now()): void {
  const state = context as {
    requestActivityStartedAt?: number;
    requestActivityFirstDeltaAt?: number;
    requestActivityFirstDeltaType?: string;
  };
  if (!state.requestActivityStartedAt || state.requestActivityFirstDeltaAt) return;
  state.requestActivityFirstDeltaAt = nowMs;
  state.requestActivityFirstDeltaType = type;
}

export function beginForegroundRequestTurn(
  context: TuiContext,
  userMessageId?: string,
): string {
  const requestTurnId = randomUUID();
  context.runtimeContextId = requestTurnId;
  context.currentRequestTurnId = requestTurnId;
  context.currentRequestUserMessageId = userMessageId;
  return requestTurnId;
}

function isCurrentForegroundRequestTurn(context: TuiContext, requestTurnId: string): boolean {
  return context.currentRequestTurnId === requestTurnId;
}

function clearForegroundRequestState(context: TuiContext, requestTurnId: string): void {
  if (!isCurrentForegroundRequestTurn(context, requestTurnId)) return;
  clearRequestActivity(context, { kind: "foreground", requestTurnId });
  context.activeAbortController = undefined;
  context.foregroundAbortPendingUntilMs = undefined;
  context.tools.abortSignal = undefined;
  context.interrupt = { type: "idle" };
  context.currentRequestTurnId = undefined;
  context.currentRequestUserMessageId = undefined;
}

export async function recordInterruptedForegroundTurn(
  context: TuiContext,
  sessionId: string,
  input: {
    requestTurnId?: string;
    reason: NonNullable<TuiContext["lastInterruptedTurn"]>["reason"];
    userMessageId?: string;
  },
): Promise<void> {
  const requestTurnId = input.requestTurnId ?? context.currentRequestTurnId;
  if (!requestTurnId) return;
  if (context.lastInterruptedTurn?.requestTurnId === requestTurnId) return;
  const at = new Date().toISOString();
  const userMessageId = input.userMessageId ?? context.currentRequestUserMessageId;
  context.lastInterruptedTurn = {
    requestTurnId,
    reason: input.reason,
    ...(userMessageId ? { userMessageId } : {}),
    at,
  };
  await context.store.appendEvent(sessionId, {
    type: "interrupt",
    id: randomUUID(),
    status: "cancelled",
    message: `turn_interrupted: requestTurnId=${requestTurnId}; reason=${input.reason}; userMessageId=${userMessageId ?? "-"}`,
    createdAt: at,
  });
}

export function startRequestActivity(
  output: Writable,
  context: TuiContext,
  phase: RequestActivityPhase,
  values: {
    reportPath?: string;
    toolName?: string;
    toolTarget?: string;
    ownerKind?: RequestActivityOwner["kind"];
    requestTurnId?: string;
  } = {},
): void {
  const owner = resolveRequestActivityOwner(context, values);
  if (!shouldStartRequestActivity(context, owner)) {
    return;
  }
  clearRequestActivity(context);
  context.requestActivityOwner = owner;
  context.requestActivityPhase = phase;
  context.requestActivityToolName = values.toolName;
  (context as { requestActivityToolTarget?: string }).requestActivityToolTarget = values.toolTarget;
  context.requestActivityToolLines = 0;
  context.requestActivityToolBytes = 0;
  (context as { requestActivityStartedAt?: number }).requestActivityStartedAt = Date.now();
  // D13E-P3 single-thinking display: in Ink/Task mode the ActivityIndicator
  // (driven by context.requestActivityPhase via mapRequestActivityToView) is
  // the sole visible "thinking…" surface. Writing the same line into the
  // transcript via writeLine would produce a duplicated "正在思考…" / "Thinking…"
  // row that survives across rerenders. We detect Ink mode by checking whether
  // `output` is the ShellBlockOutput instance and skip the writeLine in that
  // case; plain TUI keeps the writeLine for transcript-style scrollback. The
  // slow-hint timer follows the same gate so plain TUI still gets its
  // waiting_first_delta line on slow requests.
  const isInkOutput = output instanceof ShellBlockOutput;
  if (!isInkOutput) {
    writeLine(output, formatRequestActivity(phase, context.language, values));
  }
  if (
    phase !== "request_started" &&
    phase !== "request_started_report" &&
    phase !== "continuing_after_tool"
  ) {
    context.requestActivity = { slowHintShown: false };
    return;
  }
  const slowTimer = setTimeout(() => {
    const activity = context.requestActivity;
    if (!activity || activity.slowHintShown) {
      return;
    }
    // Suppress slow-hint when a tool is actively running — the user already
    // sees a "Running <tool>…" indicator, so a "still waiting" message is misleading.
    if (context.requestActivityPhase === "tool_running") {
      return;
    }
    context.requestActivity = { slowHintShown: true };
    if (
      context.requestActivityPhase === "request_started" ||
      context.requestActivityPhase === "request_started_report" ||
      context.requestActivityPhase === "continuing_after_tool"
    ) {
      context.requestActivityPhase = "waiting_first_delta";
    }
    if (!isInkOutput) {
      writeLine(output, formatRequestActivity("waiting_first_delta", context.language, values));
    }
  }, REQUEST_SLOW_HINT_MS);
  context.requestActivity = { slowHintShown: false, slowTimer };
}

async function prepareMessagesForProviderPreflightWithActivity(
  output: Writable,
  context: TuiContext,
  input: Parameters<typeof prepareMessagesForProviderPreflight>[0],
): Promise<Awaited<ReturnType<typeof prepareMessagesForProviderPreflight>>> {
  const previousPhase = context.requestActivityPhase;
  const previousOwner = context.requestActivityOwner;
  const preflightInput = shouldForceCompactFromConfirmedUsage(context)
    ? { ...input, trigger: "reactive" as const }
    : input;
  let result: Awaited<ReturnType<typeof prepareMessagesForProviderPreflight>> | undefined;
  startRequestActivity(output, context, "compacting_context");
  try {
    result = await prepareMessagesForProviderPreflight(preflightInput);
    return result;
  } finally {
    if (context.requestActivityPhase === "compacting_context") {
      if (result?.blocked) {
        clearRequestActivity(context, previousOwner);
      } else if (previousPhase) {
        startRequestActivity(output, context, previousPhase, previousOwner);
      } else {
        clearRequestActivity(context, previousOwner);
      }
    }
  }
}

async function appendNaturalGateDebugEvent(
  context: TuiContext,
  gate: PendingNaturalCommand,
  status: "created" | "confirmed",
): Promise<void> {
  const sessionId = await ensureSession(context);
  await appendSystemEvent(
    context,
    sessionId,
    `natural_gate_${status}: capability=${gate.capabilityId} command=${gate.exactCommand} scope=${gate.scope} risk=${gate.risk} requiresExactConfirmation=${gate.requiresExactConfirmation ? "yes" : "no"}`,
    "info",
  );
}

export async function sendMessage(
  text: string,
  context: TuiContext,
  gateway: ModelGateway,
  output: Writable,
): Promise<void> {
  const modelGuard = checkResourceGuard(context, "model");
  if (modelGuard) {
    writeLine(output, modelGuard);
    // D.14B — 并发上限拒绝是真实的"任务无法继续"事件（不是权限拒绝、不是用户取消）。
    const guardSessionId = await ensureSession(context);
    await captureFailureLearning(context, guardSessionId, {
      category: "resource_cap",
      failureSummary:
        "model request blocked by concurrency cap (a foreground request is already running)",
      rootCauseGuess: "started a new model request while one was still active",
      avoidNextTime:
        "Wait for the active model request to finish or use /interrupt before starting another",
      sourceRef: `event:${RESOURCE_GUARD_KIND}`,
      relatedTarget: "model",
      severity: "low",
    });
    return;
  }
  const selectedRuntimeForCooldown = getSelectedModelRuntime(context);
  if (checkAndWriteProviderCooldown(context, selectedRuntimeForCooldown, output)) {
    const cooldownSessionId = await ensureSession(context);
    await appendRuntimePolicyHint(context, cooldownSessionId, text, {});
  }
  const sessionId = await ensureSession(context);
  context.sessionEnded = false;
  const userMessageEvent = createUserMessageEvent(text) as {
    type: "user_message";
    id: string;
    text: string;
    createdAt: string;
  };
  const requestTurnId = beginForegroundRequestTurn(context, userMessageEvent.id);
  await context.store.appendEvent(sessionId, userMessageEvent);
  let selectedRuntime = getSelectedModelRuntime(context);
  // Remember the original provider+model for correct breaker clear after fallback.
  const originalProvider = selectedRuntime.provider;
  const originalModel = selectedRuntime.model;
  context.model = selectedRuntime.model;
  let selectedTools = currentModelSupportsTools(context, selectedRuntime);
  let toolCallingDegradedForRuntime: string | undefined;
  const reportWriteGuard = createReportWriteGuard(text);
  await appendSystemEvent(
    context,
    sessionId,
    `model request: selected role ${selectedRuntime.role}; provider ${selectedRuntime.provider}; model ${selectedRuntime.model}; endpoint profile ${selectedRuntime.endpointProfile}; reasoning level ${selectedRuntime.reasoningLevel ?? "none"}; reasoning sent ${selectedRuntime.reasoningSent ? "yes" : "no"}; tools ${selectedTools ? "yes" : "no"}`,
    "info",
  );
  const assistantEventId = randomUUID();
  // 当 output 是 ShellBlockOutput（Ink task shell）时，每轮 request 用一个稳定的
  // streaming block id，让 assistant_text_delta 累计写入同一条 keep:true block，
  // 避免被 _write 的 ephemeral splice 淘汰为最后一片 chunk。plain TUI / 测试
  // MemoryOutput 上没有 beginAssistantStream，writeAssistantDelta 会回退到 write。
  let assistantStreamBlockId = `assistant-stream-${assistantEventId}-0`;
  beginAssistantStream(output, assistantStreamBlockId, { holdStableCommit: true });
  let assistantText = "";
  let committedIntermediateAssistantText = "";
  let finalAnswerEvidenceActionRetries = 0;
  let finalAnswerClaimAlignmentRewrites = 0;
  let modelLoopCompleted = false;
  const controller = new AbortController();
  context.activeAbortController = controller;
  context.tools.abortSignal = controller.signal;
  context.interrupt = { type: "running", taskId: "model-stream", canCancel: true };
  const perfEvents: string[] = [];
  startRequestActivity(
    output,
    context,
    reportWriteGuard ? "request_started_report" : "request_started",
    {
      reportPath: reportWriteGuard?.requestedPath,
    },
  );
  const runtimeStatus = buildRuntimeStatusForModel({
    ...context,
    provider: getRuntimeStatusProvider(context),
  });
  const architectureCard = shouldTriggerArchitectureRuntime(text, context)
    ? createArchitectureCard(text, context)
    : undefined;
  if (architectureCard) {
    context.currentArchitectureCard = architectureCard;
    await recordArchitectureRuntimeCard(context, sessionId, architectureCard);
    writeLine(
      output,
      context.language === "en-US"
        ? "Architecture preflight started: collecting project facts before changing or verifying."
        : "已进入架构预检：先收集项目事实，再决定是否执行或验证。",
    );
  }
  const architectureDirective = architectureCard
    ? createArchitectureRuntimeDirective(architectureCard)
    : undefined;
  void refreshWorkspaceReferenceCache(context, runtimeStatus).catch(async (error) => {
    const reason = error instanceof Error ? error.message : String(error);
    await appendSystemEvent(
      context,
      sessionId,
      `workspace_reference_lazy_refresh_failed reason=${reason.replace(/\s+/g, " ").slice(0, 220)}`,
      "warning",
    );
  });
  // D.14G — 最小 WorktreeContext（redacted，无 provider/baseUrl）；仅隔离 worktree 内注入。
  const worktreeContext = await computeWorktreeContext(context.projectPath);
  const _tProfile0 = Date.now();
  const engineeringProfile = await resolveEngineeringTaskProfile(text, context.projectPath);
  perfEvents.push(`perf:engineering_profile_ms=${Date.now() - _tProfile0}`);

  // Verify previous turn's failure-learning contract before starting new evaluation.
  if (
    context.lastMetaSchedulerFailureLearningRequired &&
    !context.lastMetaSchedulerFailureLearningFulfilled
  ) {
    const preCount = context.failureLearning.records.length;
    const contract = verifyFailureLearningContract({
      decision: {
        shouldCaptureFailureLearning: true,
        shouldRunFinalAnswerGate: false,
        shouldPreferVerifier: false,
        shouldUseRetryGuard: false,
        shouldCompactBeforeProvider: false,
        shouldStopForBlockedRuntime: false,
        indexStrategy: "ready",
        directives: [],
        internalEvents: [],
      },
      preTurnRecordCount: preCount,
      postTurnRecordCount: preCount,
      failureKind: "tool",
    });
    if (!contract.satisfied) {
      await appendSystemEvent(
        context,
        sessionId,
        `meta_scheduler:failure_learning_contract_unfulfilled reason=${contract.reason}`,
        "warning",
      );
      recordFailureLearningDegradedWarning(context.failureLearning, contract.reason);
    }
  }

  if (context.turnContinuity) {
    const prevDecision = context.lastMetaSchedulerDecision;
    const prevTaskKind = prevDecision?.policyDecision.taskKind ?? "chat";
    const prevUserStateKind = prevDecision?.policyDecision.userState.kind ?? "neutral";
    const _tCont0 = Date.now();
    context.turnContinuity = updateTurnContinuity(
      context.turnContinuity,
      {
        taskKind: prevTaskKind,
        userStateKind: prevUserStateKind,
        hadToolFailure: Boolean(context.lastToolFailure),
        hadProviderFailure: Boolean(context.lastProviderFailure),
        hadVerificationFailure: context.lastVerification?.status === "fail",
        lastVerificationStatus: context.lastVerification?.status,
        userText: text,
        userCorrectedAssistant:
          /(?:不对|错了|不是这样|不是这个|别|不要|停|wrong|incorrect|no that.s not|stop|don.t|not what i|更正|纠正|重新|再来)/iu.test(
            text,
          ),
      },
      context.recentTaskKinds ?? [],
      context.recentMessageLengths ?? [],
    ).state;
    perfEvents.push(`perf:continuity_update_ms=${Date.now() - _tCont0}`);
    context.recentTaskKinds = [...(context.recentTaskKinds ?? []), prevTaskKind].slice(-5);
    context.recentMessageLengths = [
      ...(context.recentMessageLengths ?? []),
      text.length,
    ].slice(-5);
  }
  await clearStaleMissingArtifactToolFailure(context, sessionId);

  const _tMsInput0 = Date.now();
  const _msInput = createMetaSchedulerInput(context, selectedRuntime, text, false);
  perfEvents.push(`perf:scheduler_input_ms=${Date.now() - _tMsInput0}`);
  const _tMsEval0 = Date.now();
  const metaSchedulerDecision = evaluateMetaScheduler({
    ..._msInput,
    userText: text,
    engineeringProfile,
    messages: createPolicyContextPressureMessages(runtimeStatus, text),
    ...(shouldCarryLastToolFailureIntoScheduler(context)
      ? { lastToolFailure: context.lastToolFailure }
      : {}),
    ...(context.lastProviderFailure
      ? {
          providerFailure: {
            provider: context.lastProviderFailure.provider,
            model: context.lastProviderFailure.model,
            message: context.lastProviderFailure.summary,
          },
        }
      : {}),
  });
  perfEvents.push(`perf:scheduler_eval_ms=${Date.now() - _tMsEval0}`);
  context.lastMetaSchedulerDecision = metaSchedulerDecision;
  context.lastMetaSchedulerFailureLearningRequired =
    metaSchedulerDecision.shouldCaptureFailureLearning;
  context.lastMetaSchedulerFailureLearningFulfilled = false;
  metaSchedulerDecision.internalEvents.push(...perfEvents);
  for (const event of metaSchedulerDecision.internalEvents) {
    await appendSystemEvent(context, sessionId, event, "info");
  }
  enqueuePolicyHints(context, metaSchedulerDecision.policyDecision);
  await appendPolicyDecisionEvent(context, sessionId, metaSchedulerDecision.policyDecision);
  if (
    metaSchedulerDecision.policyDecision.userStatePersistence >= 5
  ) {
    context.userStateCooldownUntilMs = Date.now() + 300_000;
    context.userStateDismissedUntilMs = Date.now() + 300_000;
  }
  if (metaSchedulerDecision.shouldStopForBlockedRuntime) {
    writeLine(
      output,
      context.language === "en-US"
        ? "Blocked workflows/agents detected. Resolve them first, then retry."
        : "检测到阻塞的 workflow/agent，请先处理后再继续。",
    );
    writeStatus(output, context);
    await appendSystemEvent(
      context,
      sessionId,
      "meta_scheduler:blocked_runtime_stop",
      "warning",
    );
    clearForegroundRequestState(context, requestTurnId);
    return;
  }
  const gitStatusSummary = await buildGitStatusSummary(context.projectPath);
  const _tDirective0 = Date.now();
  const _msDirective = formatMetaSchedulerDirective(metaSchedulerDecision);
  metaSchedulerDecision.internalEvents.push(`perf:scheduler_directive_ms=${Date.now() - _tDirective0}`);
  const agentCompletionNoticeIdsForTurn = collectPendingAgentCompletionNotices(context).map(
    (notice) => notice.id,
  );
  const _tSysPrompt0 = Date.now();
  const systemPrompt = createModelSystemPromptSegments(
    text,
    context,
    runtimeStatus,
    architectureDirective,
    summarizeWorktreeContextForPrompt(worktreeContext),
    buildFailureLearningSummaryForPrompt(context.failureLearning),
    _msDirective,
    gitStatusSummary,
  );
  metaSchedulerDecision.internalEvents.push(`perf:system_prompt_ms=${Date.now() - _tSysPrompt0}`);
  if (context.solutionCompleteness.triggered) {
    await appendSystemEvent(
      context,
      sessionId,
      `solution_completeness_gate: ${JSON.stringify(context.solutionCompleteness)}`,
      "warning",
    );
  }
  const messages = await buildModelMessagesWithRecentContext(
    context,
    sessionId,
    systemPrompt.cacheable,
    text,
    selectedRuntime,
    systemPrompt.volatile,
  );
  let messagesForProvider = messages;
  if (reportWriteGuard) {
    messagesForProvider.push({
      role: "user",
      content: createReportTaskGuard(reportWriteGuard, context.language),
    });
  }
  const previousUserActionConstraints = context.currentUserActionConstraints;
  context.currentUserActionConstraints = parseUserActionConstraints(text);
  try {
    let evidenceRounds = 0;
    let consecutiveTodoOnlyRounds = 0;
    let noProgressRounds = 0;
    let todoOnlyHintSent = false;
    let todoOnlyWarningSent = false;
    let rawToolProtocolTextRetries = 0;
    let toolFailureRetries = 0;
    let toolFailureRecoveryState: ToolFailureRecoveryState = { repeatedFailureRounds: 0 };
    let toolFailureNoToolRecoveryPrompts = 0;
    let preFallbackRecoveryPrompts = 0;
    let highReasoningToolsEmptyRetried = false;
    let reactiveCompactRetried = false;
    const _suggestedMax = metaSchedulerDecision.suggestedMaxTodoRounds;
    const _hintThreshold = Math.ceil(_suggestedMax * 0.5);
    const _killThreshold = _suggestedMax + TODO_ONLY_KILL_GRACE;
    modelRoundLoop: for (let round = 0; ; round += 1) {
      if (round > 0) {
        assistantStreamBlockId = `assistant-stream-${assistantEventId}-${round}`;
        beginAssistantStream(output, assistantStreamBlockId, { holdStableCommit: true });
      }
      const toolCalls: ModelToolCall[] = [];
      let roundAssistantText = "";
      let pendingAssistantPreviewText = "";
      let lastAssistantPreviewFlushAt = 0;
      let textSanitizer = createAssistantPrimaryTextSanitizer(context.language);
      let roundChunkCount = 0;
      let roundHadUsage = false;
      let roundFinishReason: string | undefined;
      let roundHadThinking = false;
      const modelSupportsTools = selectedTools;
      if (!modelSupportsTools && round === 0) {
        writeLine(
          output,
          context.language === "en-US"
            ? "Tool calling is not supported by the current provider/model; continuing as plain text without tools. Run /model doctor for details."
            : "当前 provider/model 不支持 tool calling；本轮降级为纯文本，不发送 tools/toolChoice。可运行 /model doctor 查看详情。",
        );
      }
      const contextMaxChars = getProviderContextMaxChars(context, selectedRuntime);
      const _tPreflight0 = Date.now();
      const preflight = await prepareMessagesForProviderPreflightWithActivity(output, context, {
        messages: messagesForProvider,
        context,
        sessionId,
        runtime: selectedRuntime,
        trigger: "request",
        deps: compactPreflightDeps,
      });
      metaSchedulerDecision.internalEvents.push(`perf:preflight_ms=${Date.now() - _tPreflight0}`);
      if (preflight.blocked) {
        clearForegroundRequestState(context, requestTurnId);
        writeLine(output, preflight.message);
        writeStatus(output, context);
        return;
      }
      messagesForProvider = preflight.messages;
      const requestMessages = messagesForProvider;
      if (estimateModelMessageChars(requestMessages) > contextMaxChars) {
        const warning =
          context.language === "en-US"
            ? "This request is still too large after automatic compaction. Please shorten the latest input or summarize older context, then retry."
            : "自动压缩后这次请求仍过长。请缩短最新输入或先摘要较早上下文后重试。";
        await appendSystemEvent(
          context,
          sessionId,
          `context_still_too_large_after_compaction: model=${selectedRuntime.model} inputTooLarge=${text.length > contextMaxChars ? "yes" : "no"}`,
          "warning",
        );
        clearForegroundRequestState(context, requestTurnId);
        writeLine(output, warning);
        writeStatus(output, context);
        return;
      }
      const promptCacheFields = await buildPromptCacheRequestFields(context);
      let providerRequest: ModelRequest = {
        messages: requestMessages,
        model: selectedRuntime.model,
        endpointProfile: selectedRuntime.endpointProfile,
        requestContext: "foreground",
        requestContextId: requestTurnId,
        sessionId,
        ...(selectedRuntime.reasoningSent
          ? { reasoningLevel: selectedRuntime.reasoningLevel }
          : {}),
        ...(modelSupportsTools
          ? {
              tools: createProviderToolDefinitionsForContext(context, reportWriteGuard),
              toolChoice: "auto" as const,
              parallelToolCalls: false,
            }
          : {}),
        ...promptCacheFields,
      };
      if (highReasoningToolsEmptyRetried) {
        providerRequest = applyHighReasoningToolsRetryShape(
          providerRequest,
          selectedRuntime.endpointProfile,
        );
      }
      providerRequest = applyCacheWritePolicyToRequest(
        providerRequest,
        resolveCachePolicy("main"),
        context.cache,
      );
      providerRequest = applyPostCompactMainChainCacheSafePrefix({
        state: context.cache,
        request: providerRequest,
      }).request;
      providerRequest = applyPromptCacheKey(providerRequest, context, sessionId);
      rememberCacheSafePrefix(context.cache, providerRequest);
      recordCacheRequestObservation(context, "main", selectedRuntime.provider, providerRequest);
      const resetAssistantDraftForProviderRetry = () => {
        discardAssistantBlock(output, assistantStreamBlockId);
        assistantText = committedIntermediateAssistantText;
        roundAssistantText = "";
        pendingAssistantPreviewText = "";
        lastAssistantPreviewFlushAt = 0;
        textSanitizer = createAssistantPrimaryTextSanitizer(context.language);
      };
      for await (const event of withProviderRetry(
        gateway,
        context.providerBreaker,
        selectedRuntime.provider,
        providerRequest,
        controller.signal,
        {
          stopAfterToolUse: providerRequest.parallelToolCalls === false,
          onRetry: (info) => {
            resetAssistantDraftForProviderRetry();
            showProviderRetryActivity(context, info);
            return handleProviderRetryForMetaOrchestration(context, sessionId, info);
          },
        },
      )) {
        if (controller.signal.aborted) {
          await recordInterruptedForegroundTurn(context, sessionId, {
            requestTurnId,
            reason: "model_abort",
            userMessageId: userMessageEvent.id,
          });
          if (isCurrentForegroundRequestTurn(context, requestTurnId)) {
            clearForegroundRequestState(context, requestTurnId);
            cancelAssistantStream(output);
            writeLine(output, t(context, "toolInterrupted"));
          }
          return;
        }
        recordRequestFirstDelta(context, event.type);
        if (event.type === "assistant_text_delta") {
          await clearActiveProviderFailureAfterRecovery(context, sessionId, selectedRuntime);
          clearRequestActivity(context);
          const visibleText = textSanitizer.push(event.text);
          assistantText += visibleText;
          roundAssistantText += visibleText;
          pendingAssistantPreviewText += visibleText;
          if (shouldFlushAssistantPreview(pendingAssistantPreviewText, lastAssistantPreviewFlushAt)) {
            const result = flushAssistantPreviewDelta(
              output,
              assistantStreamBlockId,
              pendingAssistantPreviewText,
            );
            pendingAssistantPreviewText = result.text;
            if (result.flushed) lastAssistantPreviewFlushAt = Date.now();
          }
          continue;
        }
        if (event.type === "tool_use") {
          await clearActiveProviderFailureAfterRecovery(context, sessionId, selectedRuntime);
          const visibleText = textSanitizer.flush();
          assistantText += visibleText;
          roundAssistantText += visibleText;
          pendingAssistantPreviewText += visibleText;
          const result = flushAssistantPreviewDelta(
            output,
            assistantStreamBlockId,
            pendingAssistantPreviewText,
          );
          pendingAssistantPreviewText = result.text;
          if (result.flushed) lastAssistantPreviewFlushAt = Date.now();
          clearRequestActivity(context);
          toolCalls.push({ id: event.id, name: event.name, input: event.input });
          continue;
        }
        if (event.type === "assistant_thinking_delta") {
          await clearActiveProviderFailureAfterRecovery(context, sessionId, selectedRuntime);
          roundHadThinking = true;
          continue;
        }
        if (event.type === "usage") {
          roundHadUsage = true;
          recordCacheUsageObservation(context, "main", event.usage);
          const stats = recordModelUsage(context, event.usage);
          await appendUsageEvents(context, sessionId, stats);
          await recordApiTokenCountIfAvailable(
            context,
            gateway,
            selectedRuntime,
            requestMessages,
            controller.signal,
          );
          continue;
        }
        if (event.type === "message_stop") {
          roundChunkCount = event.chunkCount;
          roundHadUsage = roundHadUsage || event.hadUsage;
          roundFinishReason = event.finishReason;
          continue;
        }
        if (event.type === "error") {
          clearRequestActivity(context);
          markContextUsageStale(context, "disconnected_mid_stream");
          await recordProviderFailureEvidence(context, sessionId, event.error, selectedRuntime);
          if (!reactiveCompactRetried && isReactiveCompactProviderError(event.error)) {
            reactiveCompactRetried = true;
            const reactivePreflight = await prepareMessagesForProviderPreflight({
              messages: messagesForProvider,
              context,
              sessionId,
              runtime: selectedRuntime,
              trigger: "reactive",
              deps: compactPreflightDeps,
            });
            if (reactivePreflight.blocked) {
              writeLine(output, reactivePreflight.message);
              writeStatus(output, context);
              return;
            }
            messagesForProvider = appendLatestUserRequestAnchor(reactivePreflight.messages);
            resetAssistantDraftForProviderRetry();
            showProviderRecoveryActivity(context);
            await appendSystemEvent(
              context,
              sessionId,
              `reactive_compact_retry: provider=${selectedRuntime.provider} model=${selectedRuntime.model} messages=${messagesForProvider.length}`,
              "warning",
            );
            continue modelRoundLoop;
          }
          const toolCallingKey = runtimeToolCallingKey(selectedRuntime);
          if (
            modelSupportsTools &&
            toolCallingDegradedForRuntime !== toolCallingKey &&
            isToolCallingCompatibilityError(event.error)
          ) {
            selectedTools = false;
            toolCallingDegradedForRuntime = toolCallingKey;
            resetAssistantDraftForProviderRetry();
            showProviderRecoveryActivity(context);
            await appendSystemEvent(
              context,
              sessionId,
              `tool_calling_degraded_retry: provider=${selectedRuntime.provider} model=${selectedRuntime.model} endpointProfile=${selectedRuntime.endpointProfile ?? "default"}`,
              "warning",
            );
            continue modelRoundLoop;
          }
          // withProviderRetry already handled same-provider retries, concurrency gating,
          // and breaker transitions. Only fallback to a different model remains.
          const fallback = resolveRuntimeFallback(context, selectedRuntime, event.error);
          if (fallback) {
            await recordProviderFallbackAttempt(context, sessionId, {
              from: selectedRuntime,
              to: fallback.runtime,
              kind: fallback.kind,
              code: fallback.code,
              status: "attempted",
            });
            resetAssistantDraftForProviderRetry();
            showProviderSwitchActivity(context);
            await appendRuntimePolicyHint(context, sessionId, text, {
              providerFailure: {
                provider: selectedRuntime.provider,
                model: selectedRuntime.model,
                code: fallback.code,
                message: fallback.kind,
              },
            });
            writeLine(
              output,
              context.lastProviderFallbackAttempt?.summary ??
                formatProviderFallbackAttemptSummary(
                  {
                    fromProvider: selectedRuntime.provider,
                    fromModel: selectedRuntime.model,
                    toProvider: fallback.runtime.provider,
                    toModel: fallback.runtime.model,
                    reasonKind: fallback.kind,
                  },
                  context.language,
                ),
            );
            selectedRuntime = fallback.runtime;
            messagesForProvider = appendLatestUserRequestAnchor(messagesForProvider);
            context.model = selectedRuntime.model;
            selectedTools = currentModelSupportsTools(context, selectedRuntime);
            toolCallingDegradedForRuntime = undefined;
            checkAndWriteProviderCooldown(context, selectedRuntime, output);
            continue modelRoundLoop;
          }
          await recordInterruptedForegroundTurn(context, sessionId, {
            requestTurnId,
            reason: "provider_disconnect",
            userMessageId: userMessageEvent.id,
          });
          if (isCurrentForegroundRequestTurn(context, requestTurnId)) {
            writeErrorLine(
              output,
              formatProviderFailurePrimary(event.error, context.language),
              formatProviderFailureTitle(context.language),
            );
          }
          return;
        }
      }
      const finalVisibleText = textSanitizer.flush();
      assistantText += finalVisibleText;
      roundAssistantText += finalVisibleText;
      pendingAssistantPreviewText += finalVisibleText;
      if (pendingAssistantPreviewText) {
        const result = flushAssistantPreviewDelta(
          output,
          assistantStreamBlockId,
          pendingAssistantPreviewText,
        );
        pendingAssistantPreviewText = result.text;
        if (result.flushed) lastAssistantPreviewFlushAt = Date.now();
      }

      if (textSanitizer.hadRawToolProtocol() && toolCalls.length === 0) {
        await appendSystemEvent(
          context,
          sessionId,
          "assistant_raw_tool_protocol_as_text",
          "warning",
        );
        discardAssistantBlock(output, assistantStreamBlockId);
        assistantText = "";
        roundAssistantText = "";
        if (rawToolProtocolTextRetries < MAX_RAW_TOOL_PROTOCOL_TEXT_RETRIES) {
          messagesForProvider.push({
            role: "user",
            content: createRawToolProtocolReminder(context.language),
          });
          rawToolProtocolTextRetries += 1;
          continue;
        }
        writeLine(output, formatRawToolProtocolRetryFailure(context.language));
        break;
      }

      if (!roundAssistantText && toolCalls.length === 0) {
        if (
          shouldRetryHighReasoningToolsEmptyResponse({
            endpointProfile: selectedRuntime.endpointProfile,
            reasoningLevel: selectedRuntime.reasoningLevel,
            reasoningSent: selectedRuntime.reasoningSent,
            toolsEnabled: modelSupportsTools,
            alreadyRetried: highReasoningToolsEmptyRetried,
          })
        ) {
          highReasoningToolsEmptyRetried = true;
          await appendSystemEvent(
            context,
            sessionId,
            `high_reasoning_tools_empty_retry: provider=${selectedRuntime.provider}; model=${selectedRuntime.model}; endpointProfile=${selectedRuntime.endpointProfile}; shape=preserve_high_disable_parallel_tools`,
            "warning",
          );
          messagesForProvider.push({
            role: "user",
            content: createHighReasoningToolsEmptyRetryPrompt(context.language),
          });
          discardAssistantBlock(output, assistantStreamBlockId);
          continue;
        }
        clearRequestActivity(context);
        const result = await recordProviderEmptyResponse(
          context,
          sessionId,
          roundChunkCount,
          roundHadUsage,
          roundFinishReason,
          roundHadThinking,
        );
        if (result.isError) {
          writeErrorLine(output, result.message);
        } else {
          writeLine(output, result.message);
        }
        return;
      }

      if (roundAssistantText || toolCalls.length > 0) {
        messagesForProvider.push({
          role: "assistant",
          content: truncateRoundAssistantForProvider(roundAssistantText, context),
          toolCalls,
        });
      }
      if (toolCalls.length === 0) {
        if (
          shouldContinueAfterToolFailureWithoutToolCall(
            toolFailureRecoveryState,
            toolFailureNoToolRecoveryPrompts,
          )
        ) {
          discardAssistantBlock(output, assistantStreamBlockId);
          assistantText = committedIntermediateAssistantText;
          roundAssistantText = "";
          toolFailureNoToolRecoveryPrompts += 1;
          messagesForProvider.push({
            role: "user",
            content: createToolFailureRecoveryReminder(context.language),
          });
          await appendSystemEvent(
            context,
            sessionId,
            `tool_failure_recovery_no_tool_continue prompts=${toolFailureNoToolRecoveryPrompts}`,
            "warning",
          );
          continue;
        }
        if (consecutiveTodoOnlyRounds >= _killThreshold && todoOnlyWarningSent) {
          const limitMsg =
            evidenceRounds === 0
              ? context.language === "en-US"
                ? "Execution paused at an internal runaway guard. Only planning/Todo was executed; no repository verification was performed. Send the request again or run the matching verification command to continue."
                : "执行已在内部防 runaway 保护处暂停。只完成计划整理，尚未执行仓库验证。请重新发起请求或运行对应验证命令继续。"
              : context.language === "en-US"
                ? "Execution paused at an internal runaway guard before a final answer. The task is not complete; send the request again to continue from the latest visible state."
                : "执行已在内部防 runaway 保护处暂停，尚未生成最终回答。本任务未完成；请基于当前可见状态重新发起请求继续。";
          discardAssistantBlock(output, assistantStreamBlockId);
          assistantText = "";
          roundAssistantText = "";
          writeLine(output, limitMsg);
          break;
        }
        if (reportWriteGuard && shouldSendReportEvidenceReminder(reportWriteGuard)) {
          messagesForProvider.push({
            role: "user",
            content: formatReportEvidenceRequired(context.language),
          });
          reportWriteGuard.evidenceReminderSent = true;
          continue;
        }
        if (reportWriteGuard && shouldSendReportWriteReminder(reportWriteGuard)) {
          messagesForProvider.push({
            role: "user",
            content: createReportWriteReminder(reportWriteGuard, context.language),
          });
          reportWriteGuard.reminderSent = true;
          continue;
        }
        if (
          reportWriteGuard &&
          shouldSendReportFinalReferenceReminder(reportWriteGuard, assistantText)
        ) {
          messagesForProvider.push({
            role: "user",
            content: createReportFinalReferenceReminder(reportWriteGuard, context.language),
          });
          reportWriteGuard.finalReferenceReminderSent = true;
          continue;
        }
        // D.13U — Final Answer Claim Gate 和 Extended Gate 聚合检查
        if (assistantText) {
          await clearActiveProviderFailureAfterRecovery(context, sessionId, selectedRuntime);
          const gateResult = evaluateAggregatedFinalAnswerGate(
            context,
            assistantText,
            metaSchedulerDecision.shouldRunFinalAnswerGate,
          );

          if (gateResult.status === "needs_disclaimer") {
            await appendSystemEvent(
              context,
              sessionId,
              `final_answer_gate_aggregated retry kinds=${gateResult.unsupportedKinds.join(",")}`,
              "warning",
            );
            if (
              shouldRewriteFinalGateClaimAlignment(gateResult, context) &&
              finalAnswerClaimAlignmentRewrites < MAX_FINAL_GATE_CLAIM_ALIGNMENT_REWRITES
            ) {
              finalAnswerClaimAlignmentRewrites += 1;
              await appendSystemEvent(
                context,
                sessionId,
                `final_answer_claim_alignment_rewrite attempt=${finalAnswerClaimAlignmentRewrites}`,
                "warning",
              );
              discardAssistantBlock(output, assistantStreamBlockId);
              assistantText = "";
              roundAssistantText = "";
              messagesForProvider.push({
                role: "user",
                content: createFinalGateClaimAlignmentRewritePrompt(context.language),
              });
              continue;
            }
            const actionPlan = planFinalGateEvidenceGapAction({
              result: gateResult,
              context,
              userText: text,
              assistantText,
              retryBudgetRemaining:
                finalAnswerEvidenceActionRetries < MAX_FINAL_GATE_EVIDENCE_ACTION_RETRIES,
              evidenceActionRetryCount: finalAnswerEvidenceActionRetries,
            });
            await appendSystemEvent(
              context,
              sessionId,
              `final_answer_gap_planner action=${actionPlan.action} reason=${actionPlan.reason}`,
              actionPlan.action === "blocked_explanation" || actionPlan.action === "downgrade_only"
                ? "warning"
                : "info",
            );
            if (actionPlan.action === "blocked_explanation" || actionPlan.action === "downgrade_only") {
              await recordFinalAnswerGateDowngrade(context, sessionId, gateResult);
              assistantText = buildEvidenceBackedFinalBoundaryAnswer(
                gateResult,
                context.language,
                context.evidence,
              );
              replaceAssistantBlockContent(output, assistantStreamBlockId, assistantText);
              break;
            }
            discardAssistantBlock(output, assistantStreamBlockId);
            assistantText = "";
            roundAssistantText = "";
            const actionResult = await runFinalGateEvidenceAction({
              actionPlan,
              context,
              output,
              sessionId,
              messages: messagesForProvider,
              runtime: selectedRuntime,
              ...(reportWriteGuard ? { reportWriteGuard } : {}),
            });
            if (actionResult.status === "permission_pending") {
              return;
            }
            if (shouldContinueAfterFinalGateEvidenceAction(actionResult, finalAnswerEvidenceActionRetries)) {
              messagesForProvider = actionResult.messages;
              finalAnswerEvidenceActionRetries += 1;
              continue;
            }
            await recordFinalAnswerGateDowngrade(context, sessionId, gateResult);
            assistantText = buildEvidenceBackedFinalBoundaryAnswer(
              gateResult,
              context.language,
              context.evidence,
            );
            replaceAssistantBlockContent(output, assistantStreamBlockId, assistantText);
            await appendSystemEvent(
              context,
              sessionId,
              `final_answer_gap_action_${actionResult.status} reason=${actionResult.reason}`,
              "warning",
            );
            break;
          }
        }
        break;
      }
      if (roundAssistantText) {
        replaceAssistantBlockContent(output, assistantStreamBlockId, roundAssistantText);
        endAssistantStream(output);
        committedIntermediateAssistantText = assistantText;
        output.write("\n");
      }
      if (reportWriteGuard && !hasReportWriteToolCall(reportWriteGuard, toolCalls)) {
        reportWriteGuard.nonWriteToolRounds += 1;
      }
      const todoOnly = isTodoOnlyRound(toolCalls);
      if (todoOnly) {
        consecutiveTodoOnlyRounds += 1;
      } else {
        consecutiveTodoOnlyRounds = 0;
        evidenceRounds += 1;
      }
      const toolBatchResult = await executeToolCallsWithReadonlyParallelism(
        toolCalls,
        context,
        sessionId,
        output,
        {
          continuation: {
            messages: messagesForProvider,
            provider: selectedRuntime.provider,
            model: selectedRuntime.model,
            endpointProfile: selectedRuntime.endpointProfile,
            reasoningLevel: selectedRuntime.reasoningLevel,
            reasoningSent: selectedRuntime.reasoningSent,
            ...(reportWriteGuard ? { reportWriteGuard } : {}),
          },
          failFastContext: "this batch",
          collectFailureFingerprints: true,
        },
      );
      if (toolBatchResult.pendingApproval) {
        return;
      }
      const roundHadProgress = toolBatchResult.roundHadProgress;
      const roundHadRealFallbackToolProgress = toolBatchResult.roundHadRealFallbackToolProgress;
      const roundFallbackRequiredCount = toolBatchResult.roundFallbackRequiredCount;
      const roundFailureFingerprints = toolBatchResult.roundFailureFingerprints;
      const roundHadToolFailure = roundFailureFingerprints.length > 0;
      const roundNeedsRealToolFallback =
        toolCalls.length > 0 && !roundHadRealFallbackToolProgress && roundFallbackRequiredCount > 0;
      if (roundHadToolFailure) {
        const recovery = updateToolFailureRecoveryState(
          toolFailureRecoveryState,
          roundFailureFingerprints,
        );
        toolFailureRecoveryState = recovery.state;
        toolFailureRetries = toolFailureRecoveryState.repeatedFailureRounds;
        if (recovery.shouldStop) {
          await appendSystemEvent(
            context,
            sessionId,
            `meta_scheduler:retry_guard_limit tool_failure_retries=${toolFailureRetries} repeated_same_failure=yes`,
            "warning",
          );
          break;
        }
      } else if (roundNeedsRealToolFallback) {
        recordPreEngineFallbackPreference(context);
        toolFailureRetries = 0;
        toolFailureRecoveryState = { repeatedFailureRounds: 0 };
        toolFailureNoToolRecoveryPrompts = 0;
        messagesForProvider.push({
          role: "user",
          content: createToolFallbackRecoveryReminder(context.language, preFallbackRecoveryPrompts),
        });
        preFallbackRecoveryPrompts += 1;
        await appendSystemEvent(
          context,
          sessionId,
          `pre_fallback_requires_real_tools count=${roundFallbackRequiredCount}`,
          "warning",
        );
        continue;
      } else if (roundHadProgress) {
        toolFailureRetries = 0;
        toolFailureRecoveryState = { repeatedFailureRounds: 0 };
        toolFailureNoToolRecoveryPrompts = 0;
      }
      if (todoOnly && consecutiveTodoOnlyRounds >= _hintThreshold && !todoOnlyHintSent) {
        const todoHint =
          context.language === "en-US"
            ? "Planning recorded. Please proceed with verification tools (Read/Grep/Bash/GitStatusInspect); otherwise execution will pause at the runaway guard."
            : "计划已记录。请继续执行验证工具（Read/Grep/Bash/GitStatusInspect）；否则执行将停在 runaway 保护处。";
        messagesForProvider.push({ role: "user", content: todoHint });
        todoOnlyHintSent = true;
        continue;
      }
      if (todoOnly && consecutiveTodoOnlyRounds >= _suggestedMax && !todoOnlyWarningSent) {
        const warnMsg =
          context.language === "en-US"
            ? "Planning phase is complete. This round will proceed without tools; the next round MUST call tools (Read/Grep/Bash or StartAgent/RunWorkflow) or execution will pause."
            : "规划阶段已完成。本轮不会调用工具；下一轮必须调用工具（Read/Grep/Bash 或 StartAgent/RunWorkflow）执行，否则将暂停。";
        messagesForProvider.push({ role: "user", content: warnMsg });
        todoOnlyWarningSent = true;
        continue;
      }
      noProgressRounds = todoOnly || !roundHadProgress ? noProgressRounds + 1 : 0;
      if (noProgressRounds > _killThreshold) {
        const onlyPlanning = evidenceRounds === 0;
        const limitMsg = onlyPlanning
          ? context.language === "en-US"
            ? "Execution paused at an internal runaway guard. Only planning/Todo was executed; no repository verification was performed. Send the request again or run the matching verification command to continue."
            : "执行已在内部防 runaway 保护处暂停。只完成计划整理，尚未执行仓库验证。请重新发起请求或运行对应验证命令继续。"
          : context.language === "en-US"
            ? "Execution paused at an internal runaway guard before a final answer. The task is not complete; send the request again to continue from the latest visible state."
            : "执行已在内部防 runaway 保护处暂停，尚未生成最终回答。本任务未完成；请基于当前可见状态重新发起请求继续。";
        writeLine(output, limitMsg);
        break;
      }
    }
    modelLoopCompleted = true;
  } finally {
    if (!modelLoopCompleted || !assistantText) {
      endAssistantStream(output);
    }
    if (isCurrentForegroundRequestTurn(context, requestTurnId)) {
      context.currentUserActionConstraints = previousUserActionConstraints;
    }
    clearForegroundRequestState(context, requestTurnId);
  }

  // Successful response — clear the circuit breaker for both the current and original provider+model.
  clearProviderBreaker(context.providerBreaker, selectedRuntime.provider, selectedRuntime.model);
  if (selectedRuntime.provider !== originalProvider || selectedRuntime.model !== originalModel) {
    clearProviderBreaker(context.providerBreaker, originalProvider, originalModel);
  }
  if (assistantText) {
    await clearActiveProviderFailureAfterRecovery(context, sessionId, selectedRuntime);
  }

  if (reportWriteGuard && !reportWriteGuard.completed) {
    const message = await recordReportIncompleteEvidence(context, sessionId, reportWriteGuard);
    writeLine(output, message);
  }

  if (assistantText) {
    startRequestActivity(output, context, "verifying_final_answer");
    // D.13U — 最后一道关卡：所有 final answer（含预算耗尽后的 no-tool summary）
    // 入 transcript 前都必须 gate；没有 retry 机会时直接降级，原文不入 transcript。
    {
      const gateResult = evaluateAggregatedFinalAnswerGate(context, assistantText);
      if (gateResult.status === "needs_disclaimer") {
        const shouldRewriteClaimAlignment = shouldRewriteFinalGateClaimAlignment(gateResult, context);
        let retriedClaimAlignment = false;
        if (shouldRewriteClaimAlignment) {
          if (finalAnswerClaimAlignmentRewrites < MAX_FINAL_GATE_CLAIM_ALIGNMENT_REWRITES) {
            finalAnswerClaimAlignmentRewrites += 1;
            await appendSystemEvent(
              context,
              sessionId,
              `final_answer_claim_alignment_rewrite final_safety=yes attempt=${finalAnswerClaimAlignmentRewrites}`,
              "warning",
            );
            messagesForProvider.push({
              role: "assistant",
              content: truncateRoundAssistantForProvider(assistantText, context),
            });
            messagesForProvider.push({
              role: "user",
              content: createFinalGateClaimAlignmentRewritePrompt(context.language),
            });
            replaceAssistantBlockContent(output, assistantStreamBlockId, "");
            assistantText = await streamFinalModelAnswerWithoutTools(
              {
                messages: messagesForProvider,
                provider: selectedRuntime.provider,
                model: selectedRuntime.model,
                endpointProfile: selectedRuntime.endpointProfile,
                reasoningLevel: selectedRuntime.reasoningLevel,
                reasoningSent: selectedRuntime.reasoningSent,
                ...(reportWriteGuard ? { reportWriteGuard } : {}),
              },
              context,
              gateway,
              sessionId,
              output,
              controller.signal,
              assistantStreamBlockId,
              false,
              finalAnswerClaimAlignmentRewrites,
              finalAnswerEvidenceActionRetries,
            );
            if (context.pendingLocalApproval) return;
            retriedClaimAlignment = true;
          }
        }
        if (!retriedClaimAlignment) {
          const actionPlan = planFinalGateEvidenceGapAction({
            result: gateResult,
            context,
            userText: text,
            assistantText,
            retryBudgetRemaining:
              finalAnswerEvidenceActionRetries < MAX_FINAL_GATE_EVIDENCE_ACTION_RETRIES,
            evidenceActionRetryCount: finalAnswerEvidenceActionRetries,
          });
          await appendSystemEvent(
            context,
            sessionId,
            `final_answer_gap_planner final_safety=yes action=${actionPlan.action} reason=${actionPlan.reason}`,
            actionPlan.action === "blocked_explanation" || actionPlan.action === "downgrade_only"
              ? "warning"
              : "info",
          );
          if (actionPlan.action !== "blocked_explanation" && actionPlan.action !== "downgrade_only") {
            replaceAssistantBlockContent(output, assistantStreamBlockId, "");
            const actionResult = await runFinalGateEvidenceAction({
              actionPlan,
              context,
              output,
              sessionId,
              messages: messagesForProvider,
              runtime: selectedRuntime,
              ...(reportWriteGuard ? { reportWriteGuard } : {}),
            });
            if (actionResult.status === "permission_pending") {
              return;
            }
            if (shouldContinueAfterFinalGateEvidenceAction(actionResult, finalAnswerEvidenceActionRetries)) {
              finalAnswerEvidenceActionRetries += 1;
              assistantText = await streamFinalModelAnswerWithoutTools(
                {
                  messages: actionResult.messages,
                  provider: selectedRuntime.provider,
                  model: selectedRuntime.model,
                  endpointProfile: selectedRuntime.endpointProfile,
                  reasoningLevel: selectedRuntime.reasoningLevel,
                  reasoningSent: selectedRuntime.reasoningSent,
                  ...(reportWriteGuard ? { reportWriteGuard } : {}),
                },
                context,
                gateway,
                sessionId,
                output,
                controller.signal,
                assistantStreamBlockId,
                false,
                finalAnswerClaimAlignmentRewrites,
                finalAnswerEvidenceActionRetries,
              );
              if (context.pendingLocalApproval) return;
            } else {
              await appendSystemEvent(
                context,
                sessionId,
                `final_answer_gap_action_${actionResult.status} final_safety=yes reason=${actionResult.reason}`,
                "warning",
              );
              await recordFinalAnswerGateDowngrade(context, sessionId, gateResult);
              assistantText = buildEvidenceBackedFinalBoundaryAnswer(
                gateResult,
                context.language,
                context.evidence,
              );
            }
          } else {
            await recordFinalAnswerGateDowngrade(context, sessionId, gateResult);
            assistantText = buildEvidenceBackedFinalBoundaryAnswer(
              gateResult,
              context.language,
              context.evidence,
            );
          }
        }
        replaceAssistantBlockContent(output, assistantStreamBlockId, assistantText);
      }
      const visibleAssistantText = stripStructuredFinalAnswerClaims(assistantText);
      if (visibleAssistantText !== assistantText) {
        assistantText = visibleAssistantText;
        replaceAssistantBlockContent(output, assistantStreamBlockId, assistantText);
      }
      const coherentAssistantText = enforceSuccessfulToolCoherence(assistantText, context);
      if (coherentAssistantText !== assistantText) {
        await appendSystemEvent(
          context,
          sessionId,
          "final_answer_coherence_guard: replaced contradictory pre-tool failure/success text with evidence-backed final answer",
          "warning",
        );
        assistantText = coherentAssistantText;
        replaceAssistantBlockContent(output, assistantStreamBlockId, assistantText);
      }
    }
    // D.14D — main-screen prompt hygiene：模型若把内部 system-prompt 字段
    // （RuntimeStatusForModel= / ControlledMemorySummary= / MemoryBoundary= /
    // EvidenceSummary= / CommandCapabilitySummary= 等）原样复述，进主屏前清掉，
    // 避免内部运行时 token 泄漏。doctor/details 诊断能力不受影响。必须在
    // final-answer gate 之后执行，避免提前移除 LinghunFinalAnswerClaims 契约。
    {
      const beforeSanitize = assistantText;
      const sanitized = sanitizeMainScreenLeakage(assistantText, context.language);
      if (sanitized !== assistantText) {
        assistantText = sanitized;
        replaceAssistantBlockContent(output, assistantStreamBlockId, assistantText);
      }
      await recordMetaOrchestrationRuntimeEvent(context, sessionId, {
        stepId: "output-presenter",
        executor: "output-presenter-runtime",
        status: sanitized !== beforeSanitize ? "degraded" : "completed",
        summary: `assistant_chars=${assistantText.length}; sanitized=${sanitized !== beforeSanitize ? "yes" : "no"}`,
        level: sanitized !== beforeSanitize ? "warning" : "info",
      });
    }
    const visibleAssistantBlockText =
      committedIntermediateAssistantText && assistantText.startsWith(committedIntermediateAssistantText)
        ? assistantText.slice(committedIntermediateAssistantText.length).trimStart()
        : assistantText;
    if (visibleAssistantBlockText) {
      replaceAssistantBlockContent(output, assistantStreamBlockId, visibleAssistantBlockText);
    }
    endAssistantStream(output);
    clearRequestActivity(context);
    writeFinalAssistantText(output, assistantText);
    output.write("\n");
    await context.store.appendEvent(sessionId, {
      type: "assistant_text_delta",
      id: assistantEventId,
      text: assistantText,
      createdAt: new Date().toISOString(),
    });
    await commitAutoLearningAfterSuccessfulTurn(context, text);
    const reportedAt = new Date().toISOString();
    for (const noticeId of agentCompletionNoticeIdsForTurn) {
      markAgentCompletionNoticeReported(context, noticeId, reportedAt);
    }
  }
  if (metaSchedulerDecision.shouldPreferVerifier && assistantText) {
    await appendSystemEvent(
      context,
      sessionId,
      `meta_scheduler:prefer_verifier auto_trigger candidate assistant_chars=${assistantText.length}`,
      "info",
    );
    context.notifications ??= [];
    context.notifications.push({
      key: "policy:verifier-auto-trigger",
      text:
        context.language === "en-US"
          ? "Verification recommended for this turn. Run /verify focused or review the output."
          : "本轮建议验证。可运行 /verify focused 或检查输出。",
      priority: "medium",
      timeoutMs: 8000,
      createdAt: Date.now(),
      tone: "warning",
    });
  }
  writeLightHints(output, context);
  writeStatus(output, context);
}

export async function __testSendMessage(
  text: string,
  context: TuiContext,
  gateway: ModelGateway,
  output: Writable,
): Promise<void> {
  await sendMessage(text, context, gateway, output);
}

export async function __testStreamFinalModelAnswerWithoutTools(
  continuation: PendingModelContinuation,
  context: TuiContext,
  gateway: ModelGateway,
  sessionId: string,
  output: Writable,
  signal: AbortSignal,
  reuseAssistantStreamBlockId?: string,
  fallbackAttempted = false,
  claimAlignmentRewriteCount = 0,
  evidenceActionRetryCount = 0,
): Promise<string> {
  return streamFinalModelAnswerWithoutTools(
    continuation,
    context,
    gateway,
    sessionId,
    output,
    signal,
    reuseAssistantStreamBlockId,
    fallbackAttempted,
    claimAlignmentRewriteCount,
    evidenceActionRetryCount,
  );
}

export function __testApplyPromptCacheKey(
  request: ModelRequest,
  context: TuiContext,
  sessionId: string,
): ModelRequest {
  return applyPromptCacheKey(request, context, sessionId);
}

function createPolicyContextPressureMessages(
  runtimeStatus: unknown,
  userText: string,
): ModelMessage[] {
  return [
    {
      role: "system",
      content:
        typeof runtimeStatus === "string" ? runtimeStatus : JSON.stringify(runtimeStatus ?? {}),
    },
    { role: "user", content: userText },
  ];
}

async function clearActiveProviderFailureAfterRecovery(
  context: TuiContext,
  sessionId: string,
  runtime: { provider: string; model: string },
): Promise<void> {
  const fallbackAttempt = context.lastProviderFallbackAttempt;
  const recoveredByFallback =
    fallbackAttempt?.toProvider === runtime.provider &&
    fallbackAttempt.toModel === runtime.model &&
    fallbackAttempt.status === "attempted";
  if (recoveredByFallback) {
    fallbackAttempt.status = "succeeded";
    fallbackAttempt.createdAt = new Date().toISOString();
    await appendSystemEvent(
      context,
      sessionId,
      `provider fallback attempt: status succeeded; to ${runtime.provider}/${runtime.model}`,
      "info",
    );
  }
  if (!context.lastProviderFailure) return;
  context.lastProviderFailure = undefined;
  await appendSystemEvent(
    context,
    sessionId,
    `provider failure recovered: active provider failure cleared after successful response from ${runtime.provider}/${runtime.model}`,
    "info",
  );
}

function createMetaSchedulerInput(
  context: TuiContext,
  runtime: ReturnType<typeof getSelectedModelRuntime>,
  userText: string,
  providerCooldownBlocked: boolean,
): MetaSchedulerInput {
  return {
    language: context.language,
    userText,
    estimatedContextChars: context.cache.compactPressure?.estimatedChars,
    contextMaxChars: getProviderContextMaxChars(context, runtime),
    triggerChars: getAutoCompactTriggerChars(context, runtime),
    index: context.index,
    evidence: context.evidence,
    failureLearning: context.failureLearning,
    memoryAcceptedCount: context.memory.accepted.length,
    memoryCandidateCount: context.memory.candidates.length,
    memoryAutoLearningActive: context.memory.learningMode === "active",
    backgroundTasks: context.backgroundTasks,
    workflow: context.workflows.activeRun,
    permissionMode: context.permissionMode,
    recentDeniedCount: context.permissions.recentDenied.length,
    currentRole: runtime.role,
    currentProvider: runtime.provider,
    currentModel: runtime.model,
    routeFallbackUsed: context.lastProviderFallbackAttempt?.status === "attempted",
    routeProviderCooldown: providerCooldownBlocked,
    routeProviderFailure: Boolean(context.lastProviderFailure),
    currentArchitectureCard: Boolean(context.currentArchitectureCard),
    architectureDriftPending: context.pendingLocalApproval?.kind === "architecture_drift",
    hasActiveProviderFailure: hasActiveProviderFailure(context.failureLearning),
    terminalCapability: detectTerminalCapability(),
    platform: process.platform,
    shellFamily: detectShellFamily(process.env),
    usageSampleCount: context.cache.history.length,
    roleBudgetStop: context.roleUsage.some((item) => item.budgetStop),
    toolResultBudgetPersistedCount: context.toolResultBudgetState?.replacements.size ?? 0,
    lastVerificationStatus: context.lastVerification?.status,
    pendingApproval: Boolean(context.pendingLocalApproval),
    activeAgentCount: context.backgroundTasks.filter(
      (task) => task.kind === "agent" && task.status === "running",
    ).length,
    activeJobCount: context.backgroundTasks.filter(
      (task) => task.kind === "job" && task.status === "running",
    ).length,
    activeWorkflowStatus:
      context.workflows.activeRun?.status === "running" ||
      context.workflows.activeRun?.status === "blocked"
        ? context.workflows.activeRun.status
        : context.workflows.activeRun?.steps.some((step) => step.status === "stale")
          ? "stale"
          : undefined,
    ...(providerCooldownBlocked ? { providerCooldownBlocked: true } : {}),
    userStateDismissedUntilMs: context.userStateDismissedUntilMs,
    userStateCooldownUntilMs: context.userStateCooldownUntilMs,
    userStatePolicyEnabled: true,
    consecutiveFailures: context.turnContinuity?.consecutiveFailures ?? 0,
    consecutiveSuccesses: context.turnContinuity?.consecutiveSuccesses ?? 0,
    taskDomainSwitched: context.turnContinuity?.taskDomainSwitched ?? false,
    userStatePersistence: context.turnContinuity?.userStatePersistence ?? 1,
    trustScore: context.turnContinuity?.trustScore ?? 50,
    totalTurns: context.turnContinuity?.totalTurns ?? 0,
  };
}

function shouldCarryLastToolFailureIntoScheduler(context: TuiContext): boolean {
  if (!context.lastToolFailure) return false;
  if (isMissingArtifactToolFailure(context.lastToolFailure)) {
    if (hasArtifactEvidence(context)) return false;
    if (context.turnContinuity?.taskDomainSwitched) return false;
  }
  return true;
}

async function clearStaleMissingArtifactToolFailure(
  context: TuiContext,
  sessionId: string,
): Promise<void> {
  if (!isMissingArtifactToolFailure(context.lastToolFailure)) return;
  if (!hasArtifactEvidence(context) && context.turnContinuity?.taskDomainSwitched !== true) return;
  context.lastToolFailure = undefined;
  await appendSystemEvent(
    context,
    sessionId,
    "meta_scheduler:cleared_stale_missing_artifact_tool_failure",
    "info",
  );
}

function detectShellFamily(
  env: NodeJS.ProcessEnv,
): "powershell" | "cmd" | "bash" | "zsh" | "sh" | "unknown" {
  const shell = `${env.SHELL ?? ""} ${env.ComSpec ?? ""} ${env.PSModulePath ?? ""}`.toLowerCase();
  if (shell.includes("powershell") || shell.includes("pwsh")) return "powershell";
  if (shell.includes("cmd.exe")) return "cmd";
  if (shell.includes("bash")) return "bash";
  if (shell.includes("zsh")) return "zsh";
  if (shell.includes("/sh") || shell.endsWith(" sh")) return "sh";
  return process.platform === "win32" ? "powershell" : "unknown";
}

function writeAssistantPreviewDelta(output: Writable, id: string, text: string): void {
  if (output instanceof ShellBlockOutput) {
    writeAssistantDelta(output, id, text);
  }
}

function shouldFlushAssistantPreview(text: string, lastFlushAt: number, now = Date.now()): boolean {
  return (
    text.length >= ASSISTANT_PREVIEW_FLUSH_MIN_CHARS ||
    text.includes("\n") ||
    now - lastFlushAt >= ASSISTANT_PREVIEW_FLUSH_MAX_INTERVAL_MS
  );
}

function flushAssistantPreviewDelta(
  output: Writable,
  id: string,
  text: string,
): { text: string; flushed: boolean } {
  if (!text) return { text, flushed: false };
  writeAssistantPreviewDelta(output, id, text);
  return { text: "", flushed: true };
}

function writeFinalAssistantText(output: Writable, text: string): void {
  if (!text || output instanceof ShellBlockOutput) return;
  writeLine(output, text);
}

function enqueuePolicyHints(context: TuiContext, decision: PolicyDecision): void {
  if (decision.hints.length === 0) return;
  const now = Date.now();
  context.notifications ??= [];
  const existing = new Set(context.notifications.map((item) => item.key));
  const maxHints = decision.userState.notificationPlan.maxHints;
  const visibleHints = decision.hints
    .filter((hint) => shouldSurfacePolicyHint(hint.id, decision))
    .slice()
    .sort((a, b) => policyHintPriority(b) - policyHintPriority(a))
    .slice(0, maxHints);
  for (const hint of visibleHints) {
    const key = `policy:${hint.id}`;
    if (existing.has(key)) continue;
    context.notifications.push({
      key,
      text: hint.text[context.language],
      priority: hint.severity === "warning" ? "medium" : "low",
      timeoutMs: 5000,
      createdAt: now,
      tone: hint.severity === "warning" ? "warning" : "dim",
    });
    existing.add(key);
  }
}

function shouldSurfacePolicyHint(_id: string, _decision: PolicyDecision): boolean {
  return false;
}

function enqueueMemoryCandidateHint(_context: TuiContext, _count: number): void {
  return;
}

function enqueueAutoMemoryHint(_context: TuiContext, _created: number, _updated: number): void {
  return;
}

async function commitAutoLearningAfterSuccessfulTurn(
  context: TuiContext,
  userText: string,
): Promise<void> {
  if (context.memory.learningMode !== "active") return;
  const run = await runAutoLearningOnTurnEnd(context, userText);
  if (run.candidatesCreated > 0) {
    enqueueMemoryCandidateHint(context, run.candidatesCreated);
  }
  const acceptedChanged = (run.acceptedCreated ?? 0) + (run.acceptedUpdated ?? 0);
  if (acceptedChanged > 0) {
    enqueueAutoMemoryHint(context, run.acceptedCreated ?? 0, run.acceptedUpdated ?? 0);
  }
}

function policyHintPriority(hint: PolicyDecision["hints"][number]): number {
  if (hint.id === "user-state-high_stakes_release") return 120;
  if (hint.id === "user-state-trust_repair") return 118;
  if (hint.id === "user-state-frustrated") return 116;
  if (hint.id === "permission-risk") return 105;
  if (hint.id === "blocked-runtime") return 100;
  if (hint.id === "provider-cooldown") return 95;
  if (hint.id === "compact-before-provider") return 90;
  if (hint.id === "verification-required") return 80;
  if (hint.id === "windows-safe") return 78;
  if (hint.id === "architecture-guard") return 77;
  if (hint.id === "failure-learning") return 75;
  if (hint.id === "provider-fallback") return 70;
  if (hint.id === "source-first") return 60;
  if (hint.id === "background-occupancy") return 50;
  if (hint.id.startsWith("user-state-")) return 40;
  return 10;
}

async function appendPolicyDecisionEvent(
  context: TuiContext,
  sessionId: string,
  decision: PolicyDecision,
): Promise<void> {
  await appendSystemEvent(
    context,
    sessionId,
    `strategy: ${formatPolicyDecisionSummary(decision, context.language)}; hints=${decision.hints.map((hint) => hint.id).join(",") || "none"}; role_suggestion=${decision.modelRouteSignal.suggestedRole ?? "none"}; verification=${decision.verificationSignal.recommendedLevel}; route_commands=${decision.verificationSignal.route.commands.join("+")}; permission_gate=${decision.permissionSignal.requireExplicitGate ? "yes" : "no"}; windows_safe=${decision.platformSignal.windowsSafeHint ? "yes" : "no"}; engineering_profile=${decision.engineeringSignal.profile}; engineering_failure=${decision.engineeringSignal.failureCategory ?? "none"}; user_state=${decision.userState.kind}; detail=${decision.userState.detailPlan.style}; notification=${decision.userState.notificationPlan.quiet ? "quiet" : "normal"}; memory_candidate=${decision.userState.memoryCandidate.shouldCreate ? "candidate_only" : "none"}`,
    decision.riskLevel === "high" || decision.providerPlan === "cooldownBlocked"
      ? "warning"
      : "info",
  );
}

async function appendRuntimePolicyHint(
  context: TuiContext,
  sessionId: string,
  userText: string,
  extra: {
    providerFailure?: { provider: string; model: string; code?: string; message: string };
    providerCooldownBlocked?: boolean;
  },
): Promise<void> {
  const runtime = getSelectedModelRuntime(context);
  const engineeringProfile = await resolveEngineeringTaskProfile(userText, context.projectPath);
  const decision = evaluateMetaScheduler({
    ...createMetaSchedulerInput(context, runtime, userText, Boolean(extra.providerCooldownBlocked)),
    userText,
    engineeringProfile,
    messages: createPolicyContextPressureMessages(undefined, userText),
    ...extra,
  }).policyDecision;
  enqueuePolicyHints(context, decision);
  await appendPolicyDecisionEvent(context, sessionId, decision);
}

async function resolveEngineeringTaskProfile(
  prompt: string,
  projectPath: string,
): Promise<MetaSchedulerInput["engineeringProfile"]> {
  try {
    return await detectEngineeringTaskProfile({ prompt, projectPath });
  } catch {
    return "generic";
  }
}

// D.14E — 远程入站消息进入本地主链的唯一 glue。校验交给 processRemoteInbound（纯
// 逻辑），执行交回既有本地管道：approval_response 复用 executePermissionApprove/
// executePermissionDeny；natural_language_message 原样进 sendMessage（本地模型主链，
// 无关键词截获、无第二套执行器）；status_query 只回脱敏状态。本函数不直接执行任何
// 工具/Bash/写文件/Git。
export async function handleRemoteInboundMessage(
  message: RemoteInboundMessage,
  context: TuiContext,
  gateway: ModelGateway | undefined,
  output: Writable,
): Promise<RemoteInboundDecision> {
  const channel = context.remote.channels.find((item) => item.id === message.channel);
  if (channel && message.kind === "natural_language_message") {
    if ((message.text ?? "").trim().match(/^\/bind\s+[A-Z0-9]{6}$/i)) {
      const envelope = validateRemotePairingEnvelope(context, message);
      const sessionId = await ensureSession(context);
      if (envelope.status !== "envelope_accepted") {
        await appendSystemEvent(
          context,
          sessionId,
          `remote_pair_bind channel=${message.channel} status=${envelope.status} summary=${envelope.summary}`,
          "warning",
        );
        return {
          kind: "natural_language_message",
          status: envelope.status,
          summary: envelope.summary,
          evidenceCreated: false,
        };
      }
      const bind = processRemoteBindCommand(context.remote, channel, message);
      if (!bind) return processRemoteInbound(context, message);
      if (bind.status === "bound") {
        consumeRemoteInboundMessage(context, message.messageId);
      }
      await appendSystemEvent(
        context,
        sessionId,
        `remote_pair_bind channel=${message.channel} status=${bind.status} summary=${bind.summary}`,
        bind.status === "bound" ? "info" : "warning",
      );
      return {
        kind: "natural_language_message",
        status: bind.status === "bound" ? "accepted" : "blocked",
        summary: bind.summary,
        evidenceCreated: false,
      };
    }
  }
  const decision = processRemoteInbound(context, message);
  const sessionId = await ensureSession(context);
  await appendSystemEvent(
    context,
    sessionId,
    `remote_inbound kind=${decision.kind} channel=${message.channel} status=${decision.status} summary=${decision.summary}`,
    decision.status === "accepted" ||
      decision.status === "approved" ||
      decision.status === "rejected"
      ? "info"
      : "warning",
  );
  if (
    decision.status === "approved" ||
    (decision.kind === "approval_response" && decision.status === "rejected")
  ) {
    const approval = context.pendingLocalApproval;
    if (approval) {
      context.pendingLocalApproval = undefined;
      if (decision.status === "approved") {
        await executePermissionApprove(approval, context, gateway, output);
      } else {
        await executePermissionDeny(approval, context, gateway, output, false);
      }
    }
    return decision;
  }
  if (decision.kind === "natural_language_message" && decision.routedText) {
    const inbox = decideRemoteInbox(context.remote, message, {
      activeModelTurn: Boolean(context.activeAbortController),
      activeJob: context.backgroundTasks?.some(
        (task) => task.kind === "job" && task.status === "running",
      ),
      toolRunning: context.backgroundTasks?.some(
        (task) => task.kind !== "job" && task.status === "running",
      ),
      pendingApproval: Boolean(context.pendingLocalApproval),
      sessionId,
    });
    if (inbox.status === "queued") {
      await appendSystemEvent(
        context,
        sessionId,
        `remote inbox queued: channel ${message.channel}; id ${inbox.item.id}; reason ${inbox.reason}`,
        "info",
      );
      return {
        ...decision,
        status: "accepted",
        summary: `remote natural-language message queued; ${inbox.reason}`,
        routedText: undefined,
      };
    }
    if (gateway) {
      await sendMessage(decision.routedText, context, gateway, output);
    }
  }
  return decision;
}

type SystemPromptInput = string | readonly string[] | readonly ModelSystemPromptSegment[];

function toSystemMessages(systemPrompt: SystemPromptInput): ModelMessage[] {
  const rawSystemPrompts = Array.isArray(systemPrompt) ? systemPrompt : [systemPrompt];
  return rawSystemPrompts.flatMap((entry) => {
    const segment = typeof entry === "string" ? { content: entry } : entry;
    const content = segment.content.trim();
    if (!content) return [];
    return [
      {
        role: "system" as const,
        content,
        ...(segment.promptCache ? { promptCache: segment.promptCache } : {}),
      },
    ];
  });
}

function compactToolResultContentForModelHistory(content: unknown, depth = 0): unknown {
  if (depth > 4) return content;
  if (typeof content === "string") return stripPersistedToolResultPreview(content);
  if (!content || typeof content !== "object") return content;
  if (Array.isArray(content)) {
    return content.map((item) => compactToolResultContentForModelHistory(item, depth + 1));
  }
  const record = content as Record<string, unknown>;
  let changed = false;
  const compact: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    const nextValue = compactToolResultContentForModelHistory(value, depth + 1);
    compact[key] = nextValue;
    changed = changed || nextValue !== value;
  }
  return changed ? compact : content;
}

function stripPersistedToolResultPreview(content: string): string {
  if (!content.startsWith("<persisted-tool-result>")) return content;
  const previewStart = content.indexOf("\npreview:");
  if (previewStart < 0) return content;
  const endTag = "\n</persisted-tool-result>";
  const endIndex = content.indexOf(endTag, previewStart);
  if (endIndex < 0) return content;
  return [
    content.slice(0, previewStart),
    "\npreview: <omitted from model history; read artifactPath for full output>",
    content.slice(endIndex),
  ].join("");
}

function compactModelMessageForHistory(message: ModelMessage): ModelMessage {
  if (message.role !== "assistant" && message.role !== "tool") return message;
  const content = stripPersistedToolResultPreview(message.content);
  return content === message.content ? message : { ...message, content };
}

export async function buildModelMessagesWithRecentContext(
  context: TuiContext,
  sessionId: string,
  systemPrompt: SystemPromptInput,
  currentUserText: string,
  runtime = getSelectedModelRuntime(context),
  volatileSystemPrompt: readonly ModelSystemPromptSegment[] = [],
): Promise<ModelMessage[]> {
  const messages: ModelMessage[] = toSystemMessages(systemPrompt);
  try {
    const recentTranscript = await context.store.readRecentTranscriptEvents(sessionId, {
      limit: MAX_CONTEXT_MESSAGES * 2 + 1,
      predicate: (event) =>
        event.type === "user_message" ||
        event.type === "assistant_text_delta" ||
        event.type === "tool_call_start" ||
        event.type === "tool_result" ||
        event.type === "interrupt",
    });
    const recent = recentTranscript.events;
    const lastRecent = recent.at(-1);
    const withoutCurrent =
      lastRecent?.type === "user_message" && lastRecent.text === currentUserText
        ? recent.slice(0, -1)
        : recent;
    let lastAssistantIndex = -1;
    let lastInterruptedTurnMessage: string | undefined;
    for (let index = 0; index < withoutCurrent.length; index += 1) {
      const event = withoutCurrent[index];
      if (event.type === "assistant_text_delta") {
        lastAssistantIndex = index;
      }
      if (
        event.type === "interrupt" &&
        event.message.startsWith("turn_interrupted:") &&
        index > lastAssistantIndex
      ) {
        lastInterruptedTurnMessage = event.message;
      }
    }
    const toolCalls = new Map<string, ModelToolCall>();
    let added = 0;
    for (const event of withoutCurrent.slice().reverse()) {
      if (added >= MAX_CONTEXT_MESSAGES) {
        break;
      }
      if (event.type === "tool_call_start") {
        toolCalls.set(event.id, { id: event.id, name: event.name, input: event.input });
        continue;
      }
      if (event.type === "user_message" || event.type === "assistant_text_delta") {
        added += 1;
        continue;
      }
      if (event.type === "tool_result" && toolCalls.has(event.toolUseId)) {
        added += 2;
      }
    }
    const selected = withoutCurrent.slice(-Math.max(MAX_CONTEXT_MESSAGES, added + toolCalls.size));
    const historyMessages: ModelMessage[] = [];
    for (const event of selected) {
      if (event.type === "user_message") {
        historyMessages.push({ role: "user", content: event.text });
      }
      if (event.type === "assistant_text_delta") {
        historyMessages.push({ role: "assistant", content: event.text });
      }
      if (event.type === "tool_result") {
        const modelHistoryContent = compactToolResultContentForModelHistory(
          compactToolResultForModelHistory(event.toolName, event.content),
        );
        const toolCall = toolCalls.get(event.toolUseId);
        if (!toolCall) {
          const content = await budgetToolResultTranscriptContent(
            context,
            sessionId,
            event.toolUseId,
            modelHistoryContent,
            event.content,
          );
          historyMessages.push({
            role: "assistant",
            content: `Previous ${event.toolName} tool_result summary: ${JSON.stringify({
              isError: event.isError ?? false,
              evidenceId: event.evidenceId,
              content,
            })}`,
          });
          continue;
        }
        historyMessages.push({ role: "assistant", content: "", toolCalls: [toolCall] });
        historyMessages.push({
          role: "tool",
          tool_call_id: event.toolUseId,
          content: JSON.stringify({
            tool: event.toolName,
            isError: event.isError ?? false,
            evidenceId: event.evidenceId,
            content: modelHistoryContent,
          }),
        });
      }
    }
    const budgetedHistory = await budgetRecentContextToolResults(
      context,
      sessionId,
      historyMessages,
    );
    messages.push(...budgetedHistory);
    if (lastInterruptedTurnMessage) {
      const reason = lastInterruptedTurnMessage.match(/reason=([^;\s]+)/u)?.[1] ?? "unknown";
      messages.push({
        role: "system",
        content:
          `Previous foreground turn was interrupted (reason: ${reason}). Treat the latest user message as the authoritative task. Do not infer the task only from current git diff, pending file changes, or unrelated background state unless the user explicitly asks to audit them.`,
      });
    }
  } catch (error) {
    await appendSystemEvent(
      context,
      sessionId,
      `recent_context_unavailable: ${error instanceof Error ? error.message : String(error)}`,
      "warning",
    );
  }
  messages.push(...toSystemMessages(volatileSystemPrompt));
  messages.push({ role: "user", content: currentUserText });
  return messages;
}

export const __testBuildModelMessagesWithRecentContext = buildModelMessagesWithRecentContext;

function applyPromptCacheKey(
  request: ModelRequest,
  context: TuiContext,
  sessionId: string,
): ModelRequest {
  if (request.endpointProfile !== "responses" || request.promptCacheEnabled !== true) {
    return request;
  }
  return {
    ...request,
    promptCacheKey: `linghun:${stableHash({
      version: "v1",
      projectPath: context.projectPath,
      sessionId,
      model: request.model ?? context.model,
      endpointProfile: request.endpointProfile,
      stableToolSchema: normalizeStablePromptCacheTools(request.tools ?? []),
    })}`,
  };
}

function normalizeStablePromptCacheTools(
  tools: NonNullable<ModelRequest["tools"]>,
): Array<{ name: string; source: string; schemaHash: string }> {
  return tools
    .map((tool) => {
      const source = resolvePromptCacheToolSource(tool);
      return {
        name: tool.name,
        source,
        schemaHash:
          tool.schemaHash ??
          stableHash({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            source,
          }),
      };
    })
    .filter((tool) => !isDynamicPromptCacheToolSource(tool.source))
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name) ||
        a.source.localeCompare(b.source) ||
        a.schemaHash.localeCompare(b.schemaHash),
    );
}

function resolvePromptCacheToolSource(tool: NonNullable<ModelRequest["tools"]>[number]): string {
  if (tool.source) return tool.source;
  if (tool.name.startsWith("mcp__")) return "mcp";
  if (tool.name.startsWith("skill__")) return "skill";
  if (tool.name.startsWith("plugin__")) return "plugin";
  return "unknown";
}

function isDynamicPromptCacheToolSource(source: string): boolean {
  return source === "mcp" || source === "skill" || source === "plugin";
}

async function budgetRecentContextToolResults(
  context: TuiContext,
  sessionId: string,
  messages: ModelMessage[],
): Promise<ModelMessage[]> {
  const budgeted = await applyToolResultBudgetToMessages(messages, {
    projectPath: context.projectPath,
    sessionId,
    state: getToolResultBudgetState(context),
    singleResultChars: LINGHUN_PROVIDER_TOOL_RESULT_CHARS,
  });
  for (const record of budgeted.records) {
    await recordToolResultBudgetEvidence(context, sessionId, record);
  }
  return budgeted.messages.map(compactModelMessageForHistory);
}

async function streamFinalModelAnswerWithoutTools(
  continuation: PendingModelContinuation,
  context: TuiContext,
  gateway: ModelGateway,
  sessionId: string,
  output: Writable,
  signal: AbortSignal,
  // D.13V — 外层（sendMessage / continueModelAfterToolResults）已经在用某个
  // assistantStreamBlockId 累计 round 文本，这里复用同一 id，downgrade/discard
  // 才能命中真实 block。不传则保持旧行为新建一个 final 专用 id。
  reuseAssistantStreamBlockId?: string,
  fallbackAttempted = false,
  claimAlignmentRewriteCount = 0,
  evidenceActionRetryCount = 0,
): Promise<string> {
  let assistantText = "";
  let textSanitizer = createAssistantPrimaryTextSanitizer(context.language);
  // 与 sendMessage 一致的 assistant streaming block：避免最后一轮 assistant 文本
  // 被 _write 的 ephemeral splice 淘汰，保证完整正文落到 keep:true block。
  const assistantStreamBlockId =
    reuseAssistantStreamBlockId ?? `assistant-stream-final-${randomUUID()}`;
  if (!reuseAssistantStreamBlockId) {
    beginAssistantStream(output, assistantStreamBlockId, { holdStableCommit: true });
  }
  let chunkCount = 0;
  let hadUsage = false;
  let finishReason: string | undefined;
  let hadThinking = false;
  let ignoredRawToolProtocolText = false;
  let pendingAssistantPreviewText = "";
  let lastAssistantPreviewFlushAt = 0;
  const originalProvider = continuation.provider;
  const originalModel = continuation.model;
  const runtime = runtimeFromContinuation(continuation);
  const preflight = await prepareMessagesForProviderPreflightWithActivity(output, context, {
    messages: [
      ...continuation.messages,
      {
        role: "user",
        content: createFinalAnswerEvidencePreflightPrompt(context.language, context.evidence),
      },
    ],
    context,
    sessionId,
    runtime,
    trigger: "final",
    deps: compactPreflightDeps,
  });
  if (preflight.blocked) {
    writeLine(output, preflight.message);
    return "";
  }
  checkAndWriteProviderCooldown(context, runtime, output);
  continuation.messages = preflight.messages;
  startRequestActivity(output, context, "checking_final_evidence");
  const promptCacheFields = await buildPromptCacheRequestFields(context);
  const providerRequest: ModelRequest = applyPromptCacheKey(
    applyCacheWritePolicyToRequest(
      {
        messages: preflight.messages,
        model: continuation.model,
        endpointProfile: continuation.endpointProfile,
        requestContext: "foreground",
        requestContextId: context.runtimeContextId,
        sessionId,
        ...(continuation.reasoningSent ? { reasoningLevel: continuation.reasoningLevel } : {}),
        toolChoice: "none",
        ...promptCacheFields,
      },
      resolveCachePolicy("final"),
      context.cache,
    ),
    context,
    sessionId,
  );
  recordCacheRequestObservation(context, "final", continuation.provider, providerRequest);
  const resetFinalAssistantDraftForProviderRetry = () => {
    discardAssistantBlock(output, assistantStreamBlockId);
    assistantText = "";
    pendingAssistantPreviewText = "";
    lastAssistantPreviewFlushAt = 0;
    textSanitizer = createAssistantPrimaryTextSanitizer(context.language);
  };
  for await (const event of withProviderRetry(
    gateway,
    context.providerBreaker,
    continuation.provider,
    providerRequest,
    signal,
    {
      onRetry: (info) => {
        resetFinalAssistantDraftForProviderRetry();
        showProviderRetryActivity(context, info);
        return handleProviderRetryForMetaOrchestration(context, sessionId, info);
      },
    },
  )) {
    if (signal.aborted) {
      clearRequestActivity(context);
      cancelAssistantStream(output);
      writeLine(output, t(context, "toolInterrupted"));
      return assistantText;
    }
    recordRequestFirstDelta(context, event.type);
    if (event.type === "assistant_text_delta") {
      await clearActiveProviderFailureAfterRecovery(context, sessionId, continuation);
      clearRequestActivity(context);
      const visibleText = textSanitizer.push(event.text);
      assistantText += visibleText;
      pendingAssistantPreviewText += visibleText;
      if (shouldFlushAssistantPreview(pendingAssistantPreviewText, lastAssistantPreviewFlushAt)) {
        const result = flushAssistantPreviewDelta(
          output,
          assistantStreamBlockId,
          pendingAssistantPreviewText,
        );
        pendingAssistantPreviewText = result.text;
        if (result.flushed) lastAssistantPreviewFlushAt = Date.now();
      }
      continue;
    }
    if (event.type === "assistant_thinking_delta") {
      await clearActiveProviderFailureAfterRecovery(context, sessionId, continuation);
      hadThinking = true;
      continue;
    }
    if (event.type === "usage") {
      hadUsage = true;
      recordCacheUsageObservation(context, "final", event.usage);
      const stats = recordModelUsage(context, event.usage);
      await appendUsageEvents(context, sessionId, stats);
      await recordApiTokenCountIfAvailable(
        context,
        gateway,
        runtimeFromContinuation(continuation),
        preflight.messages,
        signal,
      );
      continue;
    }
    if (event.type === "message_stop") {
      chunkCount = event.chunkCount;
      hadUsage = hadUsage || event.hadUsage;
      finishReason = event.finishReason;
      continue;
    }
    if (event.type === "tool_use") {
      const visibleText = textSanitizer.flush();
      assistantText += visibleText;
      pendingAssistantPreviewText += visibleText;
      await appendSystemEvent(
        context,
        sessionId,
        `final_no_tools_ignored_tool_use: ${event.name}`,
        "warning",
      );
      continue;
    }
    if (event.type === "error") {
      clearRequestActivity(context);
      const currentRuntime = runtimeFromContinuation(continuation);
      await recordProviderFailureEvidence(context, sessionId, event.error, currentRuntime);
      // withProviderRetry already recorded the failure and exhausted same-provider
      // retries. Only fallback to a different model remains.
      const fallback = fallbackAttempted
        ? undefined
        : resolveRuntimeFallback(context, currentRuntime, event.error);
      if (fallback) {
        await recordProviderFallbackAttempt(context, sessionId, {
          from: currentRuntime,
          to: fallback.runtime,
          kind: fallback.kind,
          code: fallback.code,
          status: "attempted",
        });
        resetFinalAssistantDraftForProviderRetry();
        showProviderSwitchActivity(context);
        await appendRuntimePolicyHint(context, sessionId, "continuation", {
          providerFailure: {
            provider: currentRuntime.provider,
            model: currentRuntime.model,
            code: fallback.code,
            message: fallback.kind,
          },
        });
        writeLine(output, context.lastProviderFallbackAttempt?.summary ?? "");
        continuation.provider = fallback.runtime.provider;
        continuation.messages = appendLatestUserRequestAnchor(continuation.messages);
        continuation.model = fallback.runtime.model;
        continuation.endpointProfile = fallback.runtime.endpointProfile;
        continuation.reasoningLevel = fallback.runtime.reasoningLevel;
        continuation.reasoningSent = fallback.runtime.reasoningSent;
        checkAndWriteProviderCooldown(context, fallback.runtime, output);
        return (
          assistantText +
          (await streamFinalModelAnswerWithoutTools(
            continuation,
            context,
            gateway,
            sessionId,
            output,
            signal,
            assistantStreamBlockId,
            true,
            claimAlignmentRewriteCount,
            evidenceActionRetryCount,
          ))
        );
      }
      writeErrorLine(
        output,
        formatProviderFailurePrimary(event.error, context.language),
        formatProviderFailureTitle(context.language),
      );
      return assistantText;
    }
  }
  const finalVisibleText = textSanitizer.flush();
  assistantText += finalVisibleText;
  pendingAssistantPreviewText += finalVisibleText;
  if (textSanitizer.hadRawToolProtocol()) {
    ignoredRawToolProtocolText = true;
    assistantText = "";
    discardAssistantBlock(output, assistantStreamBlockId);
    await appendSystemEvent(
      context,
      sessionId,
      "final_no_tools_raw_tool_protocol_as_text",
      "warning",
    );
  }
  if (!assistantText) {
    clearRequestActivity(context);
    if (ignoredRawToolProtocolText) {
      writeLine(output, formatRawToolProtocolRetryFailure(context.language));
    } else {
      const result = await recordProviderEmptyResponse(
        context,
        sessionId,
        chunkCount,
        hadUsage,
        finishReason,
        hadThinking,
      );
      if (result.isError) {
        writeErrorLine(output, result.message);
      } else {
        writeLine(output, result.message);
      }
    }
  }
  if (assistantText) {
    clearProviderBreaker(context.providerBreaker, continuation.provider, continuation.model);
    if (continuation.provider !== originalProvider || continuation.model !== originalModel) {
      clearProviderBreaker(context.providerBreaker, originalProvider, originalModel);
    }
    await clearActiveProviderFailureAfterRecovery(context, sessionId, continuation);
    startRequestActivity(output, context, "checking_final_evidence");
    const gateResult = evaluateAggregatedFinalAnswerGate(context, assistantText);
    if (gateResult.status === "needs_disclaimer") {
      if (
        shouldRewriteFinalGateClaimAlignment(gateResult, context) &&
        claimAlignmentRewriteCount < MAX_FINAL_GATE_CLAIM_ALIGNMENT_REWRITES
      ) {
        continuation.messages.push({
          role: "assistant",
          content: truncateRoundAssistantForProvider(assistantText, context),
        });
        continuation.messages.push({
          role: "user",
          content: createFinalGateClaimAlignmentRewritePrompt(context.language),
        });
        startRequestActivity(output, context, "rewriting_final_answer");
        replaceAssistantBlockContent(output, assistantStreamBlockId, "");
        return streamFinalModelAnswerWithoutTools(
          continuation,
          context,
          gateway,
          sessionId,
          output,
          signal,
          assistantStreamBlockId,
          fallbackAttempted,
          claimAlignmentRewriteCount + 1,
          evidenceActionRetryCount,
        );
      }
      const actionPlan = planFinalGateEvidenceGapAction({
        result: gateResult,
        context,
        userText: latestUserTextFromMessages(continuation.messages),
        assistantText,
        retryBudgetRemaining:
          evidenceActionRetryCount < MAX_FINAL_GATE_EVIDENCE_ACTION_RETRIES,
        evidenceActionRetryCount,
      });
      await appendSystemEvent(
        context,
        sessionId,
        `final_answer_gap_planner final_no_tools=yes action=${actionPlan.action} reason=${actionPlan.reason}`,
        actionPlan.action === "blocked_explanation" || actionPlan.action === "downgrade_only"
          ? "warning"
          : "info",
      );
      if (actionPlan.action !== "blocked_explanation" && actionPlan.action !== "downgrade_only") {
        startRequestActivity(output, context, "collecting_final_evidence");
        replaceAssistantBlockContent(output, assistantStreamBlockId, "");
        const actionResult = await runFinalGateEvidenceAction({
          actionPlan,
          context,
          output,
          sessionId,
          messages: continuation.messages,
          runtime,
          ...(continuation.reportWriteGuard ? { reportWriteGuard: continuation.reportWriteGuard } : {}),
        });
        if (actionResult.status === "permission_pending") {
          return "";
        }
        if (shouldContinueAfterFinalGateEvidenceAction(actionResult, evidenceActionRetryCount)) {
          continuation.messages = actionResult.messages;
          startRequestActivity(output, context, "rewriting_final_answer");
          return streamFinalModelAnswerWithoutTools(
            continuation,
            context,
            gateway,
            sessionId,
            output,
            signal,
            assistantStreamBlockId,
            fallbackAttempted,
            claimAlignmentRewriteCount,
            evidenceActionRetryCount + 1,
          );
        }
        await appendSystemEvent(
          context,
          sessionId,
          `final_answer_gap_action_${actionResult.status} final_no_tools=yes reason=${actionResult.reason}`,
          "warning",
        );
      }
      await recordFinalAnswerGateDowngrade(context, sessionId, gateResult);
      assistantText = buildEvidenceBackedFinalBoundaryAnswer(
        gateResult,
        context.language,
        context.evidence,
      );
      replaceAssistantBlockContent(output, assistantStreamBlockId, assistantText);
    }
    const visibleAssistantText = stripStructuredFinalAnswerClaims(assistantText);
    if (visibleAssistantText !== assistantText) {
      assistantText = visibleAssistantText;
      replaceAssistantBlockContent(output, assistantStreamBlockId, assistantText);
    }
    if (pendingAssistantPreviewText || !reuseAssistantStreamBlockId) {
      replaceAssistantBlockContent(output, assistantStreamBlockId, assistantText);
    }
  }
  // D.13V — 仅当我们自己 begin 的 stream 才负责 end；复用外层 id 时由外层 end。
  if (!reuseAssistantStreamBlockId) {
    endAssistantStream(output);
    clearRequestActivity(context);
    writeFinalAssistantText(output, assistantText);
  }
  return assistantText;
}

type SuccessfulToolCoherenceKind = "write" | "edit" | "bash";

function enforceSuccessfulToolCoherence(assistantText: string, context: TuiContext): string {
  const kind = detectContradictorySuccessfulToolClaim(assistantText);
  if (!kind) return assistantText;

  const evidence = context.evidence.find((record) => isSuccessfulToolEvidence(record, kind));
  if (!evidence) return assistantText;

  const filePath =
    kind === "bash"
      ? undefined
      : (evidence.supportsClaims
          .find((claim) => claim.startsWith("file:"))
          ?.slice("file:".length) ?? extractToolEvidencePath(evidence.summary));
  if (context.language === "en-US") {
    const action =
      kind === "bash"
        ? "Ran the requested command."
        : filePath
          ? kind === "edit"
            ? `Modified: ${filePath}.`
            : `Saved: ${filePath}.`
          : kind === "edit"
            ? "Modified the requested file."
            : "Saved the requested file.";
    return [
      action,
      `Evidence: ${evidence.summary}`,
      "Note: I replaced a contradictory draft final answer that also claimed the tool could not run or modify files.",
    ].join("\n\n");
  }
  const action =
    kind === "bash"
      ? "已执行请求的命令。"
      : filePath
        ? kind === "edit"
          ? `已修改：${filePath}。`
          : `已保存：${filePath}。`
        : kind === "edit"
          ? "已修改请求的文件。"
          : "已保存请求的文件。";
  return [
    action,
    `证据：${evidence.summary}`,
    "说明：已用本地证据替换一段自相矛盾的草稿最终回复；该草稿同时声称工具不可用或无法完成修改。",
  ].join("\n\n");
}

function detectContradictorySuccessfulToolClaim(
  assistantText: string,
): SuccessfulToolCoherenceKind | undefined {
  const staleFailure =
    /(未完成(?:保存|写入|修改|编辑|执行|运行)|无法(?:真实)?(?:写入|保存|修改|编辑|执行|运行)|不能(?:真实)?(?:写入|保存|修改|编辑|执行|运行)|没有(?:任何)?\s*(?:工具|tool)|没有\s*`?(?:Write|Edit|MultiEdit|Bash|写入|编辑|修改|命令|终端)`?\s*能力|未(?:执行|运行)|没有\s*Bash\s*能力|cannot\s+(?:run|execute|modify|edit|write|save)|can't\s+(?:run|execute|modify|edit|write|save)|could\s+not\s+(?:run|execute|modify|edit|write|save)|no\s+(?:tools?|tooling|bash|write|edit)\s+(?:available|capability|access)|not\s+(?:run|executed|modified|edited|saved|written))/iu.test(
      assistantText,
    );
  if (!staleFailure) return undefined;
  const hasWriteSuccess =
    /(已(?:按要求)?(?:保存|写入|落盘)|Write\s+已完成|saved|written|file\s+(?:saved|written))/iu.test(
      assistantText,
    );
  const hasEditSuccess =
    /(已(?:按要求)?(?:修改|编辑|更新)|(?:Edit|MultiEdit)\s+已完成|modified|edited|updated|file\s+(?:modified|edited|updated))/iu.test(
      assistantText,
    );
  const hasBashSuccess =
    /(已(?:运行|执行)(?:请求的)?命令|命令已(?:完成|执行|运行)|Bash\s+已(?:完成|执行|运行)|退出码\s*0|exit\s+code\s+0|command\s+(?:ran|executed|completed)|ran\s+the\s+(?:command|requested command)|executed\s+the\s+(?:command|requested command))/iu.test(
      assistantText,
    );
  if (hasBashSuccess) return "bash";
  if (hasEditSuccess) return "edit";
  if (hasWriteSuccess) return "write";
  return undefined;
}

function isSuccessfulToolEvidence(
  record: { summary: string; supportsClaims: string[] },
  kind: SuccessfulToolCoherenceKind,
): boolean {
  if (kind === "bash") {
    return (
      record.supportsClaims.includes("Bash") &&
      record.supportsClaims.includes("command_ran") &&
      record.supportsClaims.includes("bash_exit_0")
    );
  }
  if (kind === "edit") {
    return (
      record.supportsClaims.includes("file_written") &&
      (record.supportsClaims.includes("Edit") ||
        record.supportsClaims.includes("MultiEdit") ||
        /^(?:Edit|MultiEdit):/iu.test(record.summary))
    );
  }
  return (
    record.supportsClaims.includes("file_written") &&
    (record.supportsClaims.includes("Write") || /^Write:/iu.test(record.summary))
  );
}

function extractToolEvidencePath(summary: string): string | undefined {
  return summary.match(/[A-Za-z0-9_.\\/-]+\.[A-Za-z0-9]{1,12}/u)?.[0];
}

export async function continueModelAfterToolResults(
  continuation: PendingModelContinuation,
  context: TuiContext,
  gateway: ModelGateway,
  output: Writable,
): Promise<void> {
  const requestTurnId = beginForegroundRequestTurn(context);
  const controller = new AbortController();
  const originalContProvider = continuation.provider;
  const originalContModel = continuation.model;
  context.activeAbortController = controller;
  context.tools.abortSignal = controller.signal;
  context.interrupt = { type: "running", taskId: "model-continuation", canCancel: true };
  startRequestActivity(output, context, "continuing_after_tool");
  let assistantText = "";
  let committedIntermediateAssistantText = "";
  let finalAnswerEvidenceActionRetries = 0;
  let finalAnswerClaimAlignmentRewrites = 0;
  let continuationLoopCompleted = false;
  const assistantEventId = randomUUID();
  // 每轮 round 都会开新的 streaming block，避免不同轮的输出粘到同一行。
  let assistantStreamBlockId = `assistant-stream-cont-${assistantEventId}-0`;
  beginAssistantStream(output, assistantStreamBlockId, { holdStableCommit: true });
  const sessionId = await ensureSession(context);
  const agentCompletionNoticeIdsForTurn = injectAgentCompletionMainChainContext(
    continuation.messages,
    context,
  );
  try {
    let evidenceRounds = 0;
    let consecutiveTodoOnlyRounds = 0;
    let noProgressRounds = 0;
    let todoOnlyHintSent = false;
    let todoOnlyWarningSent = false;
    let rawToolProtocolTextRetries = 0;
    let runtimeFallbackAttempted = false;
    let continuationToolsEnabled = currentModelSupportsTools(context, runtimeFromContinuation(continuation));
    let toolCallingDegradedForRuntime: string | undefined;
    let highReasoningToolsEmptyRetried = false;
    let reactiveCompactRetried = false;
    let preFallbackRecoveryPrompts = 0;
    const _suggestedMax = context.lastMetaSchedulerDecision?.suggestedMaxTodoRounds ?? MAX_TODO_ONLY_CODE_FACT;
    const _hintThreshold = Math.ceil(_suggestedMax * 0.5);
    const _killThreshold = _suggestedMax + TODO_ONLY_KILL_GRACE;
    continuationRoundLoop: for (let round = 0; ; round += 1) {
      if (round > 0) {
        assistantStreamBlockId = `assistant-stream-cont-${assistantEventId}-${round}`;
        beginAssistantStream(output, assistantStreamBlockId, { holdStableCommit: true });
      }
      const toolCalls: ModelToolCall[] = [];
      let roundAssistantText = "";
      let pendingAssistantPreviewText = "";
      let lastAssistantPreviewFlushAt = 0;
      let roundChunkCount = 0;
      let roundHadUsage = false;
      let roundFinishReason: string | undefined;
      let roundHadThinking = false;
      let textSanitizer = createAssistantPrimaryTextSanitizer(context.language);
      const continuationRuntime = runtimeFromContinuation(continuation);
      const preflight = await prepareMessagesForProviderPreflightWithActivity(output, context, {
        messages: continuation.messages,
        context,
        sessionId,
        runtime: continuationRuntime,
        trigger: "continuation",
        deps: compactPreflightDeps,
      });
      if (preflight.blocked) {
        clearRequestActivity(context);
        writeLine(output, preflight.message);
        writeStatus(output, context);
        return;
      }
      checkAndWriteProviderCooldown(context, continuationRuntime, output);
      continuation.messages = preflight.messages;
      const requestMessages = preflight.messages;
      const promptCacheFields = await buildPromptCacheRequestFields(context);
      const pendingContinuationToolUses: Array<{ id: string; name: string; input: unknown }> = [];
      let providerRequest: ModelRequest = {
        messages: requestMessages,
        model: continuation.model,
        endpointProfile: continuation.endpointProfile,
        requestContext: "foreground",
        requestContextId: requestTurnId,
        sessionId,
        ...(continuation.reasoningSent ? { reasoningLevel: continuation.reasoningLevel } : {}),
        ...(continuationToolsEnabled
          ? {
              tools: createProviderToolDefinitionsForContext(context, continuation.reportWriteGuard),
              toolChoice: "auto" as const,
              parallelToolCalls: false,
            }
          : {}),
        ...promptCacheFields,
      };
      if (highReasoningToolsEmptyRetried) {
        providerRequest = applyHighReasoningToolsRetryShape(
          providerRequest,
          continuation.endpointProfile,
        );
      }
      providerRequest = applyCacheWritePolicyToRequest(
        providerRequest,
        resolveCachePolicy("continuation"),
        context.cache,
      );
      providerRequest = applyPostCompactMainChainCacheSafePrefix({
        state: context.cache,
        request: providerRequest,
      }).request;
      providerRequest = applyPromptCacheKey(providerRequest, context, sessionId);
      rememberCacheSafePrefix(context.cache, providerRequest);
      recordCacheRequestObservation(context, "continuation", continuation.provider, providerRequest);
      const resetAssistantDraftForProviderRetry = () => {
        discardAssistantBlock(output, assistantStreamBlockId);
        assistantText = committedIntermediateAssistantText;
        roundAssistantText = "";
        pendingAssistantPreviewText = "";
        lastAssistantPreviewFlushAt = 0;
        textSanitizer = createAssistantPrimaryTextSanitizer(context.language);
      };
      for await (const event of withProviderRetry(
        gateway,
        context.providerBreaker,
        continuation.provider,
        providerRequest,
        controller.signal,
        {
          stopAfterToolUse: providerRequest.parallelToolCalls === false,
          onRetry: (info) => {
            resetAssistantDraftForProviderRetry();
            showProviderRetryActivity(context, info);
            return handleProviderRetryForMetaOrchestration(context, sessionId, info);
          },
        },
      )) {
        // D.13O — abort 后必须早返回，迟到的 SSE delta 不再写主屏 / transcript /
        // continuation messages。与 sendMessage 顶层的 controller.signal.aborted
        // 早返回保持一致。
        if (controller.signal.aborted) {
          await recordInterruptedForegroundTurn(context, sessionId, {
            requestTurnId,
            reason: "model_abort",
          });
          if (isCurrentForegroundRequestTurn(context, requestTurnId)) {
            clearForegroundRequestState(context, requestTurnId);
            cancelAssistantStream(output);
            writeLine(output, t(context, "toolInterrupted"));
          }
          return;
        }
        recordRequestFirstDelta(context, event.type);
        if (event.type === "assistant_text_delta") {
          await clearActiveProviderFailureAfterRecovery(context, sessionId, runtimeFromContinuation(continuation));
          clearRequestActivity(context);
          const visibleText = textSanitizer.push(event.text);
          assistantText += visibleText;
          roundAssistantText += visibleText;
          pendingAssistantPreviewText += visibleText;
          if (shouldFlushAssistantPreview(pendingAssistantPreviewText, lastAssistantPreviewFlushAt)) {
            const result = flushAssistantPreviewDelta(
              output,
              assistantStreamBlockId,
              pendingAssistantPreviewText,
            );
            pendingAssistantPreviewText = result.text;
            if (result.flushed) lastAssistantPreviewFlushAt = Date.now();
          }
          continue;
        }
        if (event.type === "tool_use") {
          await clearActiveProviderFailureAfterRecovery(context, sessionId, runtimeFromContinuation(continuation));
          const visibleText = textSanitizer.flush();
          assistantText += visibleText;
          roundAssistantText += visibleText;
          pendingAssistantPreviewText += visibleText;
          const result = flushAssistantPreviewDelta(
            output,
            assistantStreamBlockId,
            pendingAssistantPreviewText,
          );
          pendingAssistantPreviewText = result.text;
          if (result.flushed) lastAssistantPreviewFlushAt = Date.now();
          clearRequestActivity(context);
          pendingContinuationToolUses.push({ id: event.id, name: event.name, input: event.input });
          continue;
        }
        if (event.type === "assistant_thinking_delta") {
          await clearActiveProviderFailureAfterRecovery(context, sessionId, runtimeFromContinuation(continuation));
          roundHadThinking = true;
          continue;
        }
        if (event.type === "usage") {
          roundHadUsage = true;
          recordCacheUsageObservation(context, "continuation", event.usage);
          const stats = recordModelUsage(context, event.usage);
          await appendUsageEvents(context, sessionId, stats);
          await recordApiTokenCountIfAvailable(
            context,
            gateway,
            runtimeFromContinuation(continuation),
            preflight.messages,
            controller.signal,
          );
          continue;
        }
        if (event.type === "message_stop") {
          roundChunkCount = event.chunkCount;
          roundHadUsage = roundHadUsage || event.hadUsage;
          roundFinishReason = event.finishReason;
          continue;
        }
        if (event.type === "error") {
          clearRequestActivity(context);
          pendingContinuationToolUses.length = 0;
          const currentRuntime = runtimeFromContinuation(continuation);
          markContextUsageStale(context, "disconnected_mid_stream");
          await recordProviderFailureEvidence(context, sessionId, event.error, currentRuntime);
          if (!reactiveCompactRetried && isReactiveCompactProviderError(event.error)) {
            reactiveCompactRetried = true;
            const reactivePreflight = await prepareMessagesForProviderPreflight({
              messages: continuation.messages,
              context,
              sessionId,
              runtime: currentRuntime,
              trigger: "reactive",
              deps: compactPreflightDeps,
            });
            if (reactivePreflight.blocked) {
              writeLine(output, reactivePreflight.message);
              writeStatus(output, context);
              return;
            }
            continuation.messages = appendLatestUserRequestAnchor(reactivePreflight.messages);
            resetAssistantDraftForProviderRetry();
            showProviderRecoveryActivity(context);
            await appendSystemEvent(
              context,
              sessionId,
              `reactive_compact_retry: provider=${currentRuntime.provider} model=${currentRuntime.model} messages=${continuation.messages.length}`,
              "warning",
            );
            continue continuationRoundLoop;
          }
          const toolCallingKey = runtimeToolCallingKey(currentRuntime);
          if (
            continuationToolsEnabled &&
            toolCallingDegradedForRuntime !== toolCallingKey &&
            isToolCallingCompatibilityError(event.error)
          ) {
            continuationToolsEnabled = false;
            toolCallingDegradedForRuntime = toolCallingKey;
            continuation.messages = appendLatestUserRequestAnchor(continuation.messages);
            resetAssistantDraftForProviderRetry();
            showProviderRecoveryActivity(context);
            await appendSystemEvent(
              context,
              sessionId,
              `tool_calling_degraded_retry: provider=${currentRuntime.provider} model=${currentRuntime.model} endpointProfile=${currentRuntime.endpointProfile ?? "default"}`,
              "warning",
            );
            continue continuationRoundLoop;
          }
          // withProviderRetry already handled same-provider retries, concurrency gating,
          // and breaker transitions. Only fallback to a different model remains.
          const fallback = runtimeFallbackAttempted
            ? undefined
            : resolveRuntimeFallback(context, currentRuntime, event.error);
          if (fallback) {
            runtimeFallbackAttempted = true;
            await recordProviderFallbackAttempt(context, sessionId, {
              from: currentRuntime,
              to: fallback.runtime,
              kind: fallback.kind,
              code: fallback.code,
              status: "attempted",
            });
            resetAssistantDraftForProviderRetry();
            showProviderSwitchActivity(context);
            await appendRuntimePolicyHint(context, sessionId, "continuation", {
              providerFailure: {
                provider: currentRuntime.provider,
                model: currentRuntime.model,
                code: fallback.code,
                message: fallback.kind,
              },
            });
            writeLine(output, context.lastProviderFallbackAttempt?.summary ?? "");
            continuation.provider = fallback.runtime.provider;
            continuation.messages = appendLatestUserRequestAnchor(continuation.messages);
            continuation.model = fallback.runtime.model;
            continuation.endpointProfile = fallback.runtime.endpointProfile;
            continuation.reasoningLevel = fallback.runtime.reasoningLevel;
            continuation.reasoningSent = fallback.runtime.reasoningSent;
            continuationToolsEnabled = currentModelSupportsTools(context, fallback.runtime);
            toolCallingDegradedForRuntime = undefined;
            checkAndWriteProviderCooldown(context, fallback.runtime, output);
            continue continuationRoundLoop;
          }
          await recordInterruptedForegroundTurn(context, sessionId, {
            requestTurnId,
            reason: "provider_disconnect",
          });
          if (isCurrentForegroundRequestTurn(context, requestTurnId)) {
            writeErrorLine(
              output,
              formatProviderFailurePrimary(event.error, context.language),
              formatProviderFailureTitle(context.language),
            );
          }
          return;
        }
      }
      for (const ev of pendingContinuationToolUses) {
        toolCalls.push(ev);
      }
      const finalVisibleText = textSanitizer.flush();
      assistantText += finalVisibleText;
      roundAssistantText += finalVisibleText;
      pendingAssistantPreviewText += finalVisibleText;
      if (pendingAssistantPreviewText) {
        const result = flushAssistantPreviewDelta(
          output,
          assistantStreamBlockId,
          pendingAssistantPreviewText,
        );
        pendingAssistantPreviewText = result.text;
        if (result.flushed) lastAssistantPreviewFlushAt = Date.now();
      }
      if (textSanitizer.hadRawToolProtocol() && toolCalls.length === 0) {
        await appendSystemEvent(
          context,
          sessionId,
          "assistant_raw_tool_protocol_as_text",
          "warning",
        );
        discardAssistantBlock(output, assistantStreamBlockId);
        assistantText = "";
        roundAssistantText = "";
        if (rawToolProtocolTextRetries < MAX_RAW_TOOL_PROTOCOL_TEXT_RETRIES) {
          continuation.messages.push({
            role: "user",
            content: createRawToolProtocolReminder(context.language),
          });
          rawToolProtocolTextRetries += 1;
          continue;
        }
        writeLine(output, formatRawToolProtocolRetryFailure(context.language));
        break;
      }
      if (roundAssistantText || toolCalls.length > 0) {
        continuation.messages.push({
          role: "assistant",
          content: truncateRoundAssistantForProvider(roundAssistantText, context),
          toolCalls,
        });
      }
      if (toolCalls.length === 0) {
        if (!roundAssistantText) {
          if (
            shouldRetryHighReasoningToolsEmptyResponse({
              endpointProfile: continuation.endpointProfile,
              reasoningLevel: continuation.reasoningLevel,
              reasoningSent: continuation.reasoningSent,
              toolsEnabled: true,
              alreadyRetried: highReasoningToolsEmptyRetried,
            })
          ) {
            highReasoningToolsEmptyRetried = true;
            await appendSystemEvent(
              context,
              sessionId,
              `high_reasoning_tools_empty_retry: provider=${continuation.provider}; model=${continuation.model}; endpointProfile=${continuation.endpointProfile}; shape=preserve_high_disable_parallel_tools; continuation=yes`,
              "warning",
            );
            continuation.messages.push({
              role: "user",
              content: createHighReasoningToolsEmptyRetryPrompt(context.language),
            });
            discardAssistantBlock(output, assistantStreamBlockId);
            continue;
          }
          const result = await recordProviderEmptyResponse(
            context,
            sessionId,
            roundChunkCount,
            roundHadUsage,
            roundFinishReason,
            roundHadThinking,
          );
          if (result.isError) {
            writeErrorLine(output, result.message);
          } else {
            writeLine(output, result.message);
          }
          break;
        }
        const reportWriteGuard = continuation.reportWriteGuard;
        if (reportWriteGuard && shouldSendReportEvidenceReminder(reportWriteGuard)) {
          continuation.messages.push({
            role: "user",
            content: formatReportEvidenceRequired(context.language),
          });
          reportWriteGuard.evidenceReminderSent = true;
          continue;
        }
        if (reportWriteGuard && shouldSendReportWriteReminder(reportWriteGuard)) {
          continuation.messages.push({
            role: "user",
            content: createReportWriteReminder(reportWriteGuard, context.language),
          });
          reportWriteGuard.reminderSent = true;
          continue;
        }
        if (
          reportWriteGuard &&
          shouldSendReportFinalReferenceReminder(reportWriteGuard, assistantText)
        ) {
          continuation.messages.push({
            role: "user",
            content: createReportFinalReferenceReminder(reportWriteGuard, context.language),
          });
          reportWriteGuard.finalReferenceReminderSent = true;
          continue;
        }
        // D.13U — Final Answer Claim Gate + Extended Gate 聚合（continuation 镜像）
        if (assistantText) {
          await clearActiveProviderFailureAfterRecovery(context, sessionId, runtimeFromContinuation(continuation));
          const gateResult = evaluateAggregatedFinalAnswerGate(context, assistantText);
          if (gateResult.status === "needs_disclaimer") {
            await appendSystemEvent(
              context,
              sessionId,
              `final_answer_gate_aggregated retry kinds=${gateResult.unsupportedKinds.join(",")}`,
              "warning",
            );
            if (
              shouldRewriteFinalGateClaimAlignment(gateResult, context) &&
              finalAnswerClaimAlignmentRewrites < MAX_FINAL_GATE_CLAIM_ALIGNMENT_REWRITES
            ) {
              finalAnswerClaimAlignmentRewrites += 1;
              await appendSystemEvent(
                context,
                sessionId,
                `final_answer_claim_alignment_rewrite continuation=yes attempt=${finalAnswerClaimAlignmentRewrites}`,
                "warning",
              );
              discardAssistantBlock(output, assistantStreamBlockId);
              assistantText = "";
              roundAssistantText = "";
              continuation.messages.push({
                role: "user",
                content: createFinalGateClaimAlignmentRewritePrompt(context.language),
              });
              continue;
            }
            const actionPlan = planFinalGateEvidenceGapAction({
              result: gateResult,
              context,
              userText: latestUserTextFromMessages(continuation.messages),
              assistantText,
              retryBudgetRemaining:
                finalAnswerEvidenceActionRetries < MAX_FINAL_GATE_EVIDENCE_ACTION_RETRIES,
              evidenceActionRetryCount: finalAnswerEvidenceActionRetries,
            });
            await appendSystemEvent(
              context,
              sessionId,
              `final_answer_gap_planner action=${actionPlan.action} reason=${actionPlan.reason}`,
              actionPlan.action === "blocked_explanation" || actionPlan.action === "downgrade_only"
                ? "warning"
                : "info",
            );
            if (actionPlan.action === "blocked_explanation" || actionPlan.action === "downgrade_only") {
              await recordFinalAnswerGateDowngrade(context, sessionId, gateResult);
              assistantText = buildEvidenceBackedFinalBoundaryAnswer(
                gateResult,
                context.language,
                context.evidence,
              );
              replaceAssistantBlockContent(output, assistantStreamBlockId, assistantText);
              break;
            }
            discardAssistantBlock(output, assistantStreamBlockId);
            assistantText = "";
            roundAssistantText = "";
            const actionResult = await runFinalGateEvidenceAction({
              actionPlan,
              context,
              output,
              sessionId,
              messages: continuation.messages,
              runtime: runtimeFromContinuation(continuation),
              ...(continuation.reportWriteGuard ? { reportWriteGuard: continuation.reportWriteGuard } : {}),
            });
            if (actionResult.status === "permission_pending") {
              return;
            }
            if (shouldContinueAfterFinalGateEvidenceAction(actionResult, finalAnswerEvidenceActionRetries)) {
              continuation.messages = actionResult.messages;
              finalAnswerEvidenceActionRetries += 1;
              continue;
            }
            await recordFinalAnswerGateDowngrade(context, sessionId, gateResult);
            assistantText = buildEvidenceBackedFinalBoundaryAnswer(
              gateResult,
              context.language,
              context.evidence,
            );
            replaceAssistantBlockContent(output, assistantStreamBlockId, assistantText);
            await appendSystemEvent(
              context,
              sessionId,
              `final_answer_gap_action_${actionResult.status} reason=${actionResult.reason}`,
              "warning",
            );
            break;
          }
        }
        break;
      }
      if (roundAssistantText) {
        replaceAssistantBlockContent(output, assistantStreamBlockId, roundAssistantText);
        endAssistantStream(output);
        committedIntermediateAssistantText = assistantText;
        output.write("\n");
      }
      const reportWriteGuard = continuation.reportWriteGuard;
      if (reportWriteGuard && !hasReportWriteToolCall(reportWriteGuard, toolCalls)) {
        reportWriteGuard.nonWriteToolRounds += 1;
      }
      const todoOnly = isTodoOnlyRound(toolCalls);
      if (todoOnly) {
        consecutiveTodoOnlyRounds += 1;
      } else {
        consecutiveTodoOnlyRounds = 0;
        evidenceRounds += 1;
      }
      const toolBatchResult = await executeToolCallsWithReadonlyParallelism(
        toolCalls,
        context,
        sessionId,
        output,
        { continuation, failFastContext: "continuation batch" },
      );
      if (toolBatchResult.pendingApproval) {
        return;
      }
      const roundHadProgress = toolBatchResult.roundHadProgress;
      const roundHadRealFallbackToolProgress = toolBatchResult.roundHadRealFallbackToolProgress;
      const roundFallbackRequiredCount = toolBatchResult.roundFallbackRequiredCount;
      const roundNeedsRealToolFallback =
        toolCalls.length > 0 && !roundHadRealFallbackToolProgress && roundFallbackRequiredCount > 0;
      if (roundNeedsRealToolFallback) {
        recordPreEngineFallbackPreference(context);
        continuation.messages.push({
          role: "user",
          content: createToolFallbackRecoveryReminder(context.language, preFallbackRecoveryPrompts),
        });
        preFallbackRecoveryPrompts += 1;
        await appendSystemEvent(
          context,
          sessionId,
          `pre_fallback_requires_real_tools count=${roundFallbackRequiredCount}`,
          "warning",
        );
        noProgressRounds = 0;
        continue;
      }
      if (todoOnly && consecutiveTodoOnlyRounds >= _hintThreshold) {
        if (!todoOnlyHintSent) {
          const todoHint =
            context.language === "en-US"
              ? "Planning recorded. Please proceed with verification tools (Read/Grep/Bash/GitStatusInspect); otherwise execution will pause at the runaway guard."
              : "计划已记录。请继续执行验证工具（Read/Grep/Bash/GitStatusInspect）；否则执行将停在 runaway 保护处。";
          continuation.messages.push({ role: "user", content: todoHint });
          todoOnlyHintSent = true;
          continue;
        }
      }
      noProgressRounds = todoOnly || !roundHadProgress ? noProgressRounds + 1 : 0;
      if (noProgressRounds > _killThreshold) {
        const onlyPlanning = evidenceRounds === 0;
        const limitMsg = onlyPlanning
          ? context.language === "en-US"
            ? "Continuation paused at an internal runaway guard. Only planning/Todo was executed; no repository verification was performed."
            : "续轮执行已在内部防 runaway 保护处暂停。只完成计划整理，尚未执行仓库验证。请重新发起请求或运行对应验证命令继续。"
          : context.language === "en-US"
            ? "Continuation paused at an internal runaway guard before a final answer. The task is not complete; send the request again to continue from the latest visible state."
            : "续轮执行已在内部防 runaway 保护处暂停，尚未生成最终回答。本任务未完成；请基于当前可见状态重新发起请求继续。";
        writeLine(output, limitMsg);
        break;
      }
    }
    continuationLoopCompleted = true;
    if (assistantText) {
      clearProviderBreaker(context.providerBreaker, continuation.provider, continuation.model);
      if (continuation.provider !== originalContProvider || continuation.model !== originalContModel) {
        clearProviderBreaker(context.providerBreaker, originalContProvider, originalContModel);
      }
      await clearActiveProviderFailureAfterRecovery(context, sessionId, continuation);
      startRequestActivity(output, context, "verifying_final_answer");
      // D.13U — 最后一道关卡：所有 final answer（含预算耗尽后的 no-tool summary）
      // 入 transcript 前都必须 gate；没有 retry 机会时直接降级，原文不入 transcript。
      {
        const gateResult = evaluateAggregatedFinalAnswerGate(context, assistantText);
        if (gateResult.status === "needs_disclaimer") {
          const shouldRewriteClaimAlignment = shouldRewriteFinalGateClaimAlignment(gateResult, context);
          let retriedClaimAlignment = false;
          if (shouldRewriteClaimAlignment) {
            if (finalAnswerClaimAlignmentRewrites < MAX_FINAL_GATE_CLAIM_ALIGNMENT_REWRITES) {
              finalAnswerClaimAlignmentRewrites += 1;
              await appendSystemEvent(
                context,
                sessionId,
                `final_answer_claim_alignment_rewrite continuation_final_safety=yes attempt=${finalAnswerClaimAlignmentRewrites}`,
                "warning",
              );
              continuation.messages.push({
                role: "assistant",
                content: truncateRoundAssistantForProvider(assistantText, context),
              });
              continuation.messages.push({
                role: "user",
                content: createFinalGateClaimAlignmentRewritePrompt(context.language),
              });
              replaceAssistantBlockContent(output, assistantStreamBlockId, "");
              assistantText = await streamFinalModelAnswerWithoutTools(
                continuation,
                context,
                gateway,
                sessionId,
                output,
                controller.signal,
                assistantStreamBlockId,
                false,
                finalAnswerClaimAlignmentRewrites,
                finalAnswerEvidenceActionRetries,
              );
              if (context.pendingLocalApproval) return;
              retriedClaimAlignment = true;
            }
          }
          if (!retriedClaimAlignment) {
            const actionPlan = planFinalGateEvidenceGapAction({
              result: gateResult,
              context,
              userText: latestUserTextFromMessages(continuation.messages),
              assistantText,
              retryBudgetRemaining:
                finalAnswerEvidenceActionRetries < MAX_FINAL_GATE_EVIDENCE_ACTION_RETRIES,
              evidenceActionRetryCount: finalAnswerEvidenceActionRetries,
            });
            await appendSystemEvent(
              context,
              sessionId,
              `final_answer_gap_planner continuation_final_safety=yes action=${actionPlan.action} reason=${actionPlan.reason}`,
              actionPlan.action === "blocked_explanation" || actionPlan.action === "downgrade_only"
                ? "warning"
                : "info",
            );
            if (actionPlan.action !== "blocked_explanation" && actionPlan.action !== "downgrade_only") {
              replaceAssistantBlockContent(output, assistantStreamBlockId, "");
              const actionResult = await runFinalGateEvidenceAction({
                actionPlan,
                context,
                output,
                sessionId,
                messages: continuation.messages,
                runtime: runtimeFromContinuation(continuation),
                ...(continuation.reportWriteGuard ? { reportWriteGuard: continuation.reportWriteGuard } : {}),
              });
              if (actionResult.status === "permission_pending") {
                return;
              }
              if (shouldContinueAfterFinalGateEvidenceAction(actionResult, finalAnswerEvidenceActionRetries)) {
                finalAnswerEvidenceActionRetries += 1;
                continuation.messages = actionResult.messages;
                assistantText = await streamFinalModelAnswerWithoutTools(
                  continuation,
                  context,
                  gateway,
                  sessionId,
                  output,
                  controller.signal,
                  assistantStreamBlockId,
                  false,
                  finalAnswerClaimAlignmentRewrites,
                  finalAnswerEvidenceActionRetries,
                );
                if (context.pendingLocalApproval) return;
              } else {
                await appendSystemEvent(
                  context,
                  sessionId,
                  `final_answer_gap_action_${actionResult.status} continuation_final_safety=yes reason=${actionResult.reason}`,
                  "warning",
                );
                await recordFinalAnswerGateDowngrade(context, sessionId, gateResult);
                assistantText = buildEvidenceBackedFinalBoundaryAnswer(
                  gateResult,
                  context.language,
                  context.evidence,
                );
              }
            } else {
              await recordFinalAnswerGateDowngrade(context, sessionId, gateResult);
              assistantText = buildEvidenceBackedFinalBoundaryAnswer(
                gateResult,
                context.language,
                context.evidence,
              );
            }
          }
          replaceAssistantBlockContent(output, assistantStreamBlockId, assistantText);
        }
        const visibleAssistantText = stripStructuredFinalAnswerClaims(assistantText);
        if (visibleAssistantText !== assistantText) {
          assistantText = visibleAssistantText;
          replaceAssistantBlockContent(output, assistantStreamBlockId, assistantText);
        }
        const coherentAssistantText = enforceSuccessfulToolCoherence(assistantText, context);
        if (coherentAssistantText !== assistantText) {
          await appendSystemEvent(
            context,
            sessionId,
            "final_answer_coherence_guard: replaced contradictory pre-tool failure/success text with evidence-backed final answer",
            "warning",
          );
          assistantText = coherentAssistantText;
          replaceAssistantBlockContent(output, assistantStreamBlockId, assistantText);
        }
      }
      // D.14D — main-screen prompt hygiene（与 sendMessage 同款），continuation 路径
      // 同样在 assistant 文本进主屏前清掉内部 system-prompt 字段复述；必须在
      // final-answer gate 之后执行，避免提前移除 LinghunFinalAnswerClaims 契约。
      {
        const sanitized = sanitizeMainScreenLeakage(assistantText, context.language);
        if (sanitized !== assistantText) {
          assistantText = sanitized;
          replaceAssistantBlockContent(output, assistantStreamBlockId, assistantText);
        }
      }
      const visibleAssistantBlockText =
        committedIntermediateAssistantText && assistantText.startsWith(committedIntermediateAssistantText)
          ? assistantText.slice(committedIntermediateAssistantText.length).trimStart()
          : assistantText;
      if (visibleAssistantBlockText) {
        replaceAssistantBlockContent(output, assistantStreamBlockId, visibleAssistantBlockText);
      }
      endAssistantStream(output);
      clearRequestActivity(context);
      writeFinalAssistantText(output, assistantText);
      output.write("\n");
      await context.store.appendEvent(sessionId, {
        type: "assistant_text_delta",
        id: assistantEventId,
        text: assistantText,
        createdAt: new Date().toISOString(),
      });
      const reportedAt = new Date().toISOString();
      for (const noticeId of agentCompletionNoticeIdsForTurn) {
        markAgentCompletionNoticeReported(context, noticeId, reportedAt);
      }
    }
  } finally {
    if (!continuationLoopCompleted || !assistantText) {
      endAssistantStream(output);
    }
    clearForegroundRequestState(context, requestTurnId);
  }
}

async function recordProviderEmptyResponse(
  context: TuiContext,
  sessionId: string,
  chunkCount: number,
  hadUsage: boolean,
  finishReason: string | undefined,
  hadThinking: boolean,
): Promise<{ message: string; isError: boolean }> {
  const provider = getRuntimeStatusProvider(context);
  if (!hadUsage) {
    markContextUsageStale(context, "missing_usage");
  }
  const model = context.model;
  const metadata = [
    `provider ${provider}`,
    `model=${model}`,
    `chunkCount=${chunkCount}`,
    `hadUsage=${hadUsage ? "yes" : "no"}`,
    `hadThinking=${hadThinking ? "yes" : "no"}`,
    `finishReason=${finishReason ?? "unknown"}`,
  ].join("; ");
  // D.14H-F — reasoning-only stream（DeepSeek v4 pro 等 reasoning-first 模型）不再被
  // 视为 provider empty/FAIL。evidence 标记为 provider_reasoning_only，级别为 info。
  if (hadThinking) {
    const evidence = createEvidenceRecord(
      "command_output",
      `provider_reasoning_only: ${metadata}`,
      `provider:${provider}:model:${model}`,
      ["provider_reasoning_only", "reasoning_stream_observed", provider, model],
    );
    rememberEvidence(context, evidence);
    await context.store.appendEvent(sessionId, { type: "evidence_record", ...evidence });
    await appendSystemEvent(context, sessionId, `provider_reasoning_only: ${metadata}`, "info");
    return { message: formatProviderThinkingOnlyResponsePrimary(context.language), isError: false };
  }
  const evidence = createEvidenceRecord(
    "command_output",
    `provider_empty_response: ${metadata}`,
    `provider:${provider}:model:${model}`,
    ["provider_empty_response", "model_empty_response", provider, model],
  );
  rememberEvidence(context, evidence);
  await context.store.appendEvent(sessionId, {
    type: "evidence_record",
    ...evidence,
  });
  await appendSystemEvent(context, sessionId, `provider_empty_response: ${metadata}`, "warning");
  return { message: formatProviderEmptyResponsePrimary(context.language), isError: true };
}

function currentModelSupportsTools(
  context: TuiContext,
  runtime = getSelectedModelRuntime(context),
): boolean {
  return !isToolCallingExplicitlyDisabled(context, runtime);
}

function isToolCallingExplicitlyDisabled(
  context: TuiContext,
  runtime = getSelectedModelRuntime(context),
): boolean {
  const providerConfig = context.config.providers[runtime.provider];
  if (
    providerConfig &&
    "supportsTools" in providerConfig &&
    providerConfig.supportsTools === false
  ) {
    return true;
  }
  const route = context.config.modelRoutes.routes.find((r) => r.role === runtime.role);
  return route?.allowTools === false;
}

function runtimeToolCallingKey(runtime: { provider: string; model: string; endpointProfile?: string }): string {
  return `${runtime.provider}:${runtime.model}:${runtime.endpointProfile ?? "default"}`;
}

function isToolCallingCompatibilityError(error: unknown): boolean {
  const text = providerErrorText(error).toLowerCase();
  if (!text) return false;
  const mentionsTools = /\btools?\b|tool[_ -]?choice|tool[_ -]?calls?|function[_ -]?calling/u.test(
    text,
  );
  if (!mentionsTools) return false;
  return (
    /unsupported|not\s+supported|invalid|unknown|unrecognized|schema|parameter|field|400|bad\s+request/u.test(
      text,
    ) || text.includes("unsupported_parameter")
  );
}

function providerErrorText(error: unknown): string {
  if (error instanceof Error) {
    const parts = [error.name, error.message];
    const maybeError = error as { code?: unknown; status?: unknown; statusCode?: unknown };
    if (maybeError.code !== undefined) parts.push(String(maybeError.code));
    if (maybeError.status !== undefined) parts.push(String(maybeError.status));
    if (maybeError.statusCode !== undefined) parts.push(String(maybeError.statusCode));
    return parts.join(" ");
  }
  if (typeof error === "object" && error !== null) {
    return JSON.stringify(error);
  }
  return String(error ?? "");
}

const GIT_PROMPT_MAX_CHARS = 1000;
const gitPromptRunner = createGitRunner(2500);

async function buildGitStatusSummary(cwd: string): Promise<string | undefined> {
  const status = await readGitStatus(cwd, gitPromptRunner);
  if (status.kind !== "ok") return undefined;
  const [recentCommits, userName] = await Promise.all([
    readGitPromptValue(cwd, ["log", "-5", "--format=%h %s"]),
    readGitPromptValue(cwd, ["config", "user.name"]),
  ]);
  const statusItems = [
    ...status.staged.map((path) => `staged ${path}`),
    ...status.unstaged.map((path) => `unstaged ${path}`),
    ...status.untracked.map((path) => `untracked ${path}`),
  ].slice(0, 20);
  const lines = [
    `branch=${status.branch ?? "(detached)"}`,
    `user=${sanitizeGitPromptLine(userName) || "unknown"}`,
    `changed=${status.changedCount}; untracked=${status.untrackedCount}`,
    status.upstream ? `upstream=${status.upstream}; ahead=${status.ahead}; behind=${status.behind}` : "",
    statusItems.length > 0 ? `status=${statusItems.map(sanitizeGitPromptLine).join(" | ")}` : "status=clean",
    recentCommits ? `recent=${recentCommits.split("\n").map(sanitizeGitPromptLine).join(" | ")}` : "",
  ].filter(Boolean);
  return truncateForGitPrompt(lines.join("; "), GIT_PROMPT_MAX_CHARS);
}

async function recordApiTokenCountIfAvailable(
  context: TuiContext,
  gateway: ModelGateway,
  runtime: { provider: string; model: string; endpointProfile?: EndpointProfile },
  messages: ModelMessage[],
  signal: AbortSignal,
): Promise<void> {
  const result = await gateway
    .countMessagesTokensWithAPI(
      runtime.provider,
      {
        messages,
        model: runtime.model,
        endpointProfile: runtime.endpointProfile,
      },
      signal,
    )
    .catch((error: unknown) => ({
      source: "unavailable" as const,
      reason: error instanceof Error ? error.message : "count_tokens_failed",
    }));
  context.lastApiTokenCount =
    result.source === "api"
      ? {
          provider: runtime.provider,
          model: runtime.model,
          source: "api",
          inputTokens: result.inputTokens,
          createdAt: new Date().toISOString(),
        }
      : {
          provider: runtime.provider,
          model: runtime.model,
          source: "unavailable",
          reason: result.reason,
          createdAt: new Date().toISOString(),
        };
}

async function readGitPromptValue(cwd: string, args: string[]): Promise<string> {
  const result = await gitPromptRunner(cwd, args);
  return result.ok ? result.stdout.trim() : "";
}

function sanitizeGitPromptLine(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function truncateForGitPrompt(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 3))}...`;
}

function isReactiveCompactProviderError(error: unknown): boolean {
  const code = readErrorStringField(error, "code");
  const name = readErrorStringField(error, "name");
  const status = readErrorNumberField(error, "status") ?? readErrorNumberField(error, "statusCode");
  const message =
    error instanceof Error ? error.message : (readErrorStringField(error, "message") ?? String(error ?? ""));
  const text = `${code ?? ""} ${name ?? ""} ${status ?? ""} ${message}`;
  return /prompt[_\s-]?too[_\s-]?long|context[_\s-]?(?:length|exceeded)|maximum context|input too large|tokens?\s+exceed|上下文.*(?:过长|超限)|提示词.*过长/i.test(
    text,
  );
}

function readErrorStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : undefined;
}

function readErrorNumberField(value: unknown, key: string): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "number" ? field : undefined;
}

function createRawToolProtocolReminder(language: Language): string {
  return language === "en-US"
    ? "Use structured tool calls when you need a tool. Do not write raw tool protocol, XML, JSON tool_use blocks, or tool schemas as assistant text. Retry the answer using real tool calls or concise plain text."
    : "需要使用工具时请发起结构化工具调用。不要把 raw tool protocol、XML、JSON tool_use 块或工具 schema 写成 assistant 正文。请用真实工具调用或简短正文重试。";
}

function formatRawToolProtocolRetryFailure(language: Language): string {
  return language === "en-US"
    ? "The model returned tool protocol as plain text again. I did not run any unstructured tool request; please retry or use an explicit slash command."
    : "模型再次把工具协议写成了正文。Linghun 没有执行任何非结构化工具请求；请重试或使用明确的 slash 命令。";
}

function isTodoOnlyRound(toolCalls: ModelToolCall[]): boolean {
  if (toolCalls.length === 0) return false;
  return toolCalls.every((tc) => tc.name === "Todo");
}
