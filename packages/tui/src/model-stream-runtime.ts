import { randomUUID } from "node:crypto";
import type { Writable } from "node:stream";
import type { ModelGateway, ModelMessage, ModelToolCall } from "@linghun/providers";
import { findKnownModel } from "@linghun/providers";
import type { Language } from "@linghun/shared";
import {
  createArchitectureCard,
  createArchitectureRuntimeDirective,
  shouldTriggerArchitectureRuntime,
} from "./architecture-runtime.js";
import { RESOURCE_GUARD_KIND, checkResourceGuard } from "./background-control-runtime.js";
import { buildPromptCacheRequestFields } from "./break-cache-runtime.js";
import { writeLightHints } from "./cache-command-runtime.js";
import {
  appendUsageEvents,
  compactPreflightDeps,
  recordModelUsage,
  refreshWorkspaceReferenceCache,
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
import { computeWorktreeContext } from "./git-operation-runtime.js";
import { summarizeWorktreeContextForPrompt } from "./git-tool-runtime.js";
import { runAutoLearningOnTurnEnd } from "./memory-command-runtime.js";
import {
  type MetaSchedulerInput,
  type PolicyDecision,
  evaluateMetaScheduler,
  formatMetaSchedulerDirective,
  formatPolicyDecisionSummary,
  verifyFailureLearningContract,
} from "./meta-scheduler-runtime.js";
import { startModelSetup } from "./model-command-runtime.js";
import {
  buildDowngradedFinalAnswer,
  createFinalAnswerClaimReminder,
  createModelToolDefinitionsForReportGuard,
  evaluateFinalAnswerClaims,
} from "./model-loop-runtime.js";
import type { FinalAnswerClaimVerdict } from "./model-loop-runtime.js";
import {
  buildExtendedDowngradedFinalAnswer,
  createExtendedFinalAnswerReminder,
  stripStructuredFinalAnswerClaims,
} from "./model-loop-runtime.js";
import { createModelSystemPrompt, sanitizeMainScreenLeakage } from "./model-prompt-runtime.js";
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
import { clearProviderBreaker, recordProviderFailure } from "./provider-circuit-breaker.js";
import {
  checkAndWriteProviderCooldown,
  recordProviderFallbackAttempt,
  resolveRuntimeFallback,
} from "./provider-loop-runtime.js";
import { checkAndWriteProviderCooldown as _cooldown } from "./provider-loop-runtime.js";
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
  formatProviderFallbackAttemptSummary,
  formatProviderThinkingOnlyResponsePrimary,
  formatReportEvidenceRequired,
  formatRequestActivity,
} from "./request-lifecycle-presenter.js";
import {
  LINGHUN_MAX_AGENTIC_TURNS,
  LINGHUN_MAX_RAW_TOOL_PROTOCOL_TEXT_RETRIES,
} from "./runtime-budget.js";
import { detectTerminalCapability } from "./shell/terminal-capability.js";
import { addRoleUsage } from "./slash-command-runtime.js";
import { handleSlashCommand } from "./slash-command-runtime.js";
import { formatError, writeLine } from "./startup-runtime.js";
import { createAssistantPrimaryTextSanitizer } from "./tool-output-presenter.js";
import { applyToolResultBudgetToMessages } from "./tool-result-budget.js";
import type { PendingModelContinuation, TuiContext } from "./tui-context-runtime.js";
import {
  createSingleToolCallContinuation,
  runtimeFromContinuation,
} from "./tui-context-runtime.js";
import {
  MAX_CONTEXT_MESSAGES,
  MAX_MODEL_TOTAL_TOOL_ROUNDS,
  MAX_RAW_TOOL_PROTOCOL_TEXT_RETRIES,
  MAX_TODO_ONLY_CONSECUTIVE_ROUNDS,
  REQUEST_SLOW_HINT_MS,
} from "./tui-context-runtime.js";
import type { RemoteInboundDecision, RemoteInboundMessage } from "./tui-data-types.js";
import {
  getRuntimeStatusProvider,
  getSelectedModelRuntime,
  shouldOfferUserScopedModelSetup,
} from "./tui-model-runtime.js";
import {
  beginAssistantStream,
  discardAssistantBlock,
  endAssistantStream,
  replaceAssistantBlockContent,
  writeAssistantDelta,
  writeDiagnosticLine,
  writeErrorLine,
} from "./tui-output-surface.js";
import { ShellBlockOutput } from "./tui-output-surface.js";

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

  if (/^(yes|y|confirm|ok|okay|确认|是|继续|执行)$/iu.test(text.trim())) {
    return "handled";
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
  if (context.memory.learningMode === "active") {
    const run = await runAutoLearningOnTurnEnd(context, text);
    if (run.candidatesCreated > 0) {
      enqueueMemoryCandidateHint(context, run.candidatesCreated);
    }
  }
  return "message";
}

export function clearRequestActivity(context: TuiContext): void {
  const timer = context.requestActivity?.slowTimer;
  if (timer) {
    clearTimeout(timer);
  }
  if (context.requestActivityPhase) {
    const startedAt = (context as { requestActivityStartedAt?: number }).requestActivityStartedAt;
    context.lastModelRequest = {
      phase: context.requestActivityPhase,
      toolName: context.requestActivityToolName,
      startedAt: startedAt ? new Date(startedAt).toISOString() : undefined,
      endedAt: new Date().toISOString(),
    };
  }
  context.requestActivity = undefined;
  context.requestActivityPhase = undefined;
  context.requestActivityToolName = undefined;
  (context as { requestActivityStartedAt?: number }).requestActivityStartedAt = undefined;
}

export function startRequestActivity(
  output: Writable,
  context: TuiContext,
  phase: RequestActivityPhase,
  values: { reportPath?: string; toolName?: string } = {},
): void {
  clearRequestActivity(context);
  context.requestActivityPhase = phase;
  context.requestActivityToolName = values.toolName;
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
    context.requestActivity = { slowHintShown: true };
    if (!isInkOutput) {
      writeLine(output, formatRequestActivity("waiting_first_delta", context.language, values));
    }
  }, REQUEST_SLOW_HINT_MS);
  context.requestActivity = { slowHintShown: false, slowTimer };
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
    await appendRuntimePolicyHint(context, cooldownSessionId, text, {
      providerCooldownBlocked: true,
    });
    return;
  }
  const sessionId = await ensureSession(context);
  context.sessionEnded = false;
  await context.store.appendEvent(sessionId, createUserMessageEvent(text));
  let selectedRuntime = getSelectedModelRuntime(context);
  context.model = selectedRuntime.model;
  let selectedTools = currentModelSupportsTools(context, selectedRuntime);
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
  beginAssistantStream(output, assistantStreamBlockId);
  let assistantText = "";
  let finalAnswerClaimRetried = false;
  let modelLoopCompleted = false;
  const controller = new AbortController();
  context.activeAbortController = controller;
  context.tools.abortSignal = controller.signal;
  context.interrupt = { type: "running", taskId: "model-stream", canCancel: true };
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
  }
  const architectureDirective = architectureCard
    ? createArchitectureRuntimeDirective(architectureCard)
    : undefined;
  await refreshWorkspaceReferenceCache(context, runtimeStatus);
  // D.14G — 最小 WorktreeContext（redacted，无 provider/baseUrl）；仅隔离 worktree 内注入。
  const worktreeContext = await computeWorktreeContext(context.projectPath);

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

  const metaSchedulerDecision = evaluateMetaScheduler({
    ...createMetaSchedulerInput(context, selectedRuntime, text, false),
    userText: text,
    messages: createPolicyContextPressureMessages(runtimeStatus, text),
    ...(context.lastToolFailure ? { lastToolFailure: context.lastToolFailure } : {}),
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
  context.lastMetaSchedulerFailureLearningRequired =
    metaSchedulerDecision.shouldCaptureFailureLearning;
  context.lastMetaSchedulerFailureLearningFulfilled = false;
  for (const event of metaSchedulerDecision.internalEvents) {
    await appendSystemEvent(context, sessionId, event, "info");
  }
  enqueuePolicyHints(context, metaSchedulerDecision.policyDecision);
  await appendPolicyDecisionEvent(context, sessionId, metaSchedulerDecision.policyDecision);
  const systemPrompt = createModelSystemPrompt(
    text,
    context,
    runtimeStatus,
    architectureDirective,
    summarizeWorktreeContextForPrompt(worktreeContext),
    buildFailureLearningSummaryForPrompt(context.failureLearning),
    formatMetaSchedulerDirective(metaSchedulerDecision),
  );
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
    systemPrompt,
    text,
    selectedRuntime,
  );
  let messagesForProvider = messages;
  if (reportWriteGuard) {
    messagesForProvider.push({
      role: "user",
      content: createReportTaskGuard(reportWriteGuard, context.language),
    });
  }
  try {
    let evidenceRounds = 0;
    let consecutiveTodoOnlyRounds = 0;
    let totalPlanningOnlyRounds = 0;
    let todoOnlyHintSent = false;
    let rawToolProtocolTextRetries = 0;
    modelRoundLoop: for (let round = 0; round < MAX_MODEL_TOTAL_TOOL_ROUNDS; round += 1) {
      if (round > 0) {
        assistantStreamBlockId = `assistant-stream-${assistantEventId}-${round}`;
        beginAssistantStream(output, assistantStreamBlockId);
      }
      const toolCalls: ModelToolCall[] = [];
      let roundAssistantText = "";
      const textSanitizer = createAssistantPrimaryTextSanitizer(context.language);
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
      const preflight = await prepareMessagesForProviderPreflight({
        messages: messagesForProvider,
        context,
        sessionId,
        runtime: selectedRuntime,
        trigger: "request",
        deps: compactPreflightDeps,
      });
      if (preflight.blocked) {
        clearRequestActivity(context);
        context.activeAbortController = undefined;
        context.tools.abortSignal = undefined;
        context.interrupt = { type: "idle" };
        writeLine(output, preflight.message);
        writeStatus(output, context);
        return;
      }
      messagesForProvider = preflight.messages;
      const requestMessages = preflight.messages;
      const contextMaxChars = getProviderContextMaxChars(context, selectedRuntime);
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
        clearRequestActivity(context);
        context.activeAbortController = undefined;
        context.tools.abortSignal = undefined;
        context.interrupt = { type: "idle" };
        writeLine(output, warning);
        writeStatus(output, context);
        return;
      }
      const promptCacheFields = await buildPromptCacheRequestFields(context);
      for await (const event of gateway.stream(
        selectedRuntime.provider,
        {
          messages: requestMessages,
          model: selectedRuntime.model,
          endpointProfile: selectedRuntime.endpointProfile,
          ...(selectedRuntime.reasoningSent
            ? { reasoningLevel: selectedRuntime.reasoningLevel }
            : {}),
          ...(modelSupportsTools
            ? {
                tools: createModelToolDefinitionsForReportGuard(reportWriteGuard),
                toolChoice: "auto" as const,
              }
            : {}),
          ...promptCacheFields,
        },
        controller.signal,
      )) {
        if (controller.signal.aborted) {
          clearRequestActivity(context);
          endAssistantStream(output);
          writeLine(output, t(context, "toolInterrupted"));
          return;
        }
        if (event.type === "assistant_text_delta") {
          clearRequestActivity(context);
          const visibleText = textSanitizer.push(event.text);
          assistantText += visibleText;
          roundAssistantText += visibleText;
          if (visibleText) {
            writeAssistantPreviewDelta(output, assistantStreamBlockId, visibleText);
          }
          continue;
        }
        if (event.type === "tool_use") {
          const visibleText = textSanitizer.flush();
          assistantText += visibleText;
          roundAssistantText += visibleText;
          if (visibleText) {
            writeAssistantPreviewDelta(output, assistantStreamBlockId, visibleText);
          }
          clearRequestActivity(context);
          toolCalls.push({ id: event.id, name: event.name, input: event.input });
          continue;
        }
        if (event.type === "assistant_thinking_delta") {
          roundHadThinking = true;
          continue;
        }
        if (event.type === "usage") {
          roundHadUsage = true;
          const stats = recordModelUsage(context, event.usage);
          await appendUsageEvents(context, sessionId, stats);
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
          await recordProviderFailureEvidence(context, sessionId, event.error, selectedRuntime);
          recordProviderFailure(
            context.providerBreaker,
            selectedRuntime.provider,
            selectedRuntime.model,
            event.error.code ?? "UNKNOWN",
          );
          const fallback = resolveRuntimeFallback(context, selectedRuntime, event.error);
          if (fallback) {
            await recordProviderFallbackAttempt(context, sessionId, {
              from: selectedRuntime,
              to: fallback.runtime,
              kind: fallback.kind,
              code: fallback.code,
              status: "attempted",
            });
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
            context.model = selectedRuntime.model;
            selectedTools = currentModelSupportsTools(context, selectedRuntime);
            if (checkAndWriteProviderCooldown(context, selectedRuntime, output)) {
              return;
            }
            continue modelRoundLoop;
          }
          writeErrorLine(output, formatProviderFailurePrimary(event.error, context.language));
          return;
        }
      }
      const finalVisibleText = textSanitizer.flush();
      assistantText += finalVisibleText;
      roundAssistantText += finalVisibleText;
      if (finalVisibleText) {
        writeAssistantPreviewDelta(output, assistantStreamBlockId, finalVisibleText);
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
        // D.13U — Final Answer Claim Gate（仅一次自我修正）
        if (!finalAnswerClaimRetried && assistantText) {
          const verdict = evaluateFinalAnswerClaims(assistantText, context.evidence);
          if (verdict.status === "needs_disclaimer") {
            await appendSystemEvent(
              context,
              sessionId,
              `final_answer_claim_gate retry kinds=${verdict.unsupportedKinds.join(",")}`,
              "warning",
            );
            messagesForProvider.push({
              role: "user",
              content: createFinalAnswerClaimReminder(verdict, context.language),
            });
            finalAnswerClaimRetried = true;
            assistantText = "";
            // D.13V — 同时清掉本轮 streaming block 累计的违规原文，
            // 避免 Ctrl+O/details/lastFullOutput 残留。
            discardAssistantBlock(output, assistantStreamBlockId);
            continue;
          }
        }
        // D.13V-B — Architecture / Completeness Final Gate（共享一次重试预算）
        if (!finalAnswerClaimRetried && assistantText) {
          const extended = runArchitectureAndCompletenessFinalGate(context, assistantText);
          if (extended.status === "needs_disclaimer") {
            await appendSystemEvent(
              context,
              sessionId,
              `final_answer_extended_gate retry kinds=${extended.verdict.unsupportedKinds.join(",")}`,
              "warning",
            );
            messagesForProvider.push({
              role: "user",
              content: createExtendedFinalAnswerReminder(extended.verdict, context.language),
            });
            finalAnswerClaimRetried = true;
            assistantText = "";
            discardAssistantBlock(output, assistantStreamBlockId);
            continue;
          }
        }
        break;
      }
      if (roundAssistantText) {
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
      for (const toolCall of toolCalls) {
        const result = await executeModelToolUse(toolCall, context, sessionId, output, {
          messages: messagesForProvider,
          provider: selectedRuntime.provider,
          model: selectedRuntime.model,
          endpointProfile: selectedRuntime.endpointProfile,
          reasoningLevel: selectedRuntime.reasoningLevel,
          reasoningSent: selectedRuntime.reasoningSent,
          ...(reportWriteGuard ? { reportWriteGuard } : {}),
        });
        await recordModelToolFailureForMetaScheduler(context, sessionId, result);
        if (result.pendingApproval) {
          return;
        }
        if (doesWriteSatisfyReportGuard(reportWriteGuard, toolCall, result)) {
          reportWriteGuard.completed = true;
        }
        messagesForProvider.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
      if (todoOnly) {
        totalPlanningOnlyRounds += 1;
        if (consecutiveTodoOnlyRounds > MAX_TODO_ONLY_CONSECUTIVE_ROUNDS && !todoOnlyHintSent) {
          const todoHint =
            context.language === "en-US"
              ? "Planning recorded. Please proceed with verification tools (Read/Grep/Bash/GitStatusInspect) or provide an unverified conclusion."
              : "计划已记录。请继续执行验证工具（Read/Grep/Bash/GitStatusInspect）或给出尚未验证结论。";
          messagesForProvider.push({ role: "user", content: todoHint });
          todoOnlyHintSent = true;
          continue;
        }
      }
      const reachedTotalLimit = round + 1 >= MAX_MODEL_TOTAL_TOOL_ROUNDS;
      if (reachedTotalLimit) {
        const onlyPlanning = evidenceRounds === 0;
        const limitMsg = onlyPlanning
          ? context.language === "en-US"
            ? `Execution turn budget exhausted after ${MAX_MODEL_TOTAL_TOOL_ROUNDS} turns. Only planning/Todo was executed; no repository verification was performed. If verification is needed, run the matching command or send the request again.`
            : `执行轮次预算已耗尽（${MAX_MODEL_TOTAL_TOOL_ROUNDS} 轮）。仅完成计划整理，尚未执行仓库验证。如需验证请运行对应命令或重新发起请求。`
          : context.language === "en-US"
            ? `Execution turn budget exhausted after ${MAX_MODEL_TOTAL_TOOL_ROUNDS} turns. Summarizing with what was gathered so far; no further tools will run. If an action still needs to finish (for example refreshing the index), run the matching command such as /index refresh, or send the request again.`
            : `执行轮次预算已耗尽（${MAX_MODEL_TOTAL_TOOL_ROUNDS} 轮）。将基于目前已收集的信息给出回答，不再继续调用工具。如果还有动作需要完成（例如刷新索引），请运行对应命令（如 /index refresh）或重新发起请求。`;
        writeLine(output, limitMsg);
        const finalText = await streamFinalModelAnswerWithoutTools(
          {
            messages: messagesForProvider,
            provider: selectedRuntime.provider,
            model: selectedRuntime.model,
            endpointProfile: selectedRuntime.endpointProfile,
            reasoningLevel: selectedRuntime.reasoningLevel,
            reasoningSent: selectedRuntime.reasoningSent,
          },
          context,
          gateway,
          sessionId,
          output,
          controller.signal,
          assistantStreamBlockId,
        );
        assistantText += finalText;
        break;
      }
    }
    modelLoopCompleted = true;
  } finally {
    if (!modelLoopCompleted || !assistantText) {
      endAssistantStream(output);
    }
    clearRequestActivity(context);
    context.activeAbortController = undefined;
    context.tools.abortSignal = undefined;
    context.interrupt = { type: "idle" };
  }

  // Successful response — clear the circuit breaker for this provider+model
  clearProviderBreaker(context.providerBreaker, selectedRuntime.provider, selectedRuntime.model);
  if (
    context.lastProviderFallbackAttempt?.toProvider === selectedRuntime.provider &&
    context.lastProviderFallbackAttempt.toModel === selectedRuntime.model &&
    context.lastProviderFallbackAttempt.status === "attempted"
  ) {
    context.lastProviderFallbackAttempt.status = "succeeded";
    context.lastProviderFallbackAttempt.createdAt = new Date().toISOString();
    await appendSystemEvent(
      context,
      sessionId,
      `provider fallback attempt: status succeeded; to ${selectedRuntime.provider}/${selectedRuntime.model}`,
      "info",
    );
  }

  if (reportWriteGuard && !reportWriteGuard.completed) {
    const message = await recordReportIncompleteEvidence(context, sessionId, reportWriteGuard);
    writeLine(output, message);
  }

  if (assistantText) {
    // D.13U — 最后一道关卡：所有 final answer（含预算耗尽后的 no-tool summary）
    // 入 transcript 前都必须 gate；没有 retry 机会时直接降级，原文不入 transcript。
    {
      const verdict = evaluateFinalAnswerClaims(assistantText, context.evidence);
      if (verdict.status === "needs_disclaimer") {
        assistantText = await downgradeUnsupportedFinalAnswer(
          assistantText,
          verdict,
          context,
          sessionId,
          output,
          assistantStreamBlockId,
        );
      }
      const extended = runArchitectureAndCompletenessFinalGate(context, assistantText);
      if (extended.status === "needs_disclaimer") {
        await appendSystemEvent(
          context,
          sessionId,
          `final_answer_extended_gate downgrade kinds=${extended.verdict.unsupportedKinds.join(",")}`,
          "warning",
        );
        assistantText = buildExtendedDowngradedFinalAnswer(
          assistantText,
          extended.verdict,
          context.language,
        );
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
      const sanitized = sanitizeMainScreenLeakage(assistantText, context.language);
      if (sanitized !== assistantText) {
        assistantText = sanitized;
        replaceAssistantBlockContent(output, assistantStreamBlockId, assistantText);
      }
    }
    replaceAssistantBlockContent(output, assistantStreamBlockId, assistantText);
    endAssistantStream(output);
    writeFinalAssistantText(output, assistantText);
    output.write("\n");
    await context.store.appendEvent(sessionId, {
      type: "assistant_text_delta",
      id: assistantEventId,
      text: assistantText,
      createdAt: new Date().toISOString(),
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
  };
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

function shouldSurfacePolicyHint(id: string, decision: PolicyDecision): boolean {
  return (
    id === "user-state-trust_repair" ||
    id === "user-state-high_stakes_release" ||
    id === "provider-cooldown" ||
    (id === "blocked-runtime" && hasRealBlockedRuntime(decision)) ||
    id === "compact-before-provider" ||
    id === "provider-fallback"
  );
}

function hasRealBlockedRuntime(decision: PolicyDecision): boolean {
  const runtime = decision.runtimeSignal;
  if (runtime.workflowStatus === "blocked" || runtime.workflowStatus === "stale") return true;
  if (runtime.agentStates.blocked + runtime.jobStates.blocked > 0) return true;
  if (runtime.agentStates.stale + runtime.jobStates.stale > 0) return true;
  if (runtime.agentStates.cancelled + runtime.jobStates.cancelled > 0) return true;
  if (runtime.agentStates.timeout + runtime.jobStates.timeout > 0) return true;
  return runtime.noPassStates.some((state) => /(?:blocked|stale|cancelled|timeout)/iu.test(state));
}

function enqueueMemoryCandidateHint(context: TuiContext, count: number): void {
  const key = "memory:auto-learning-candidates";
  context.notifications ??= [];
  if (context.notifications.some((item) => item.key === key)) return;
  context.notifications.push({
    key,
    text:
      context.language === "en-US"
        ? `Memory: ${count} candidate(s) created; review with /memory review.`
        : `记忆：已生成 ${count} 条候选；用 /memory review 查看。`,
    priority: "low",
    timeoutMs: 5000,
    createdAt: Date.now(),
    tone: "dim",
  });
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
    `strategy: ${formatPolicyDecisionSummary(decision, context.language)}; hints=${decision.hints.map((hint) => hint.id).join(",") || "none"}; role_suggestion=${decision.modelRouteSignal.suggestedRole ?? "none"}; verification=${decision.verificationSignal.recommendedLevel}; route_commands=${decision.verificationSignal.route.commands.join("+")}; permission_gate=${decision.permissionSignal.requireExplicitGate ? "yes" : "no"}; windows_safe=${decision.platformSignal.windowsSafeHint ? "yes" : "no"}; user_state=${decision.userState.kind}; detail=${decision.userState.detailPlan.style}; notification=${decision.userState.notificationPlan.quiet ? "quiet" : "normal"}; memory_candidate=${decision.userState.memoryCandidate.shouldCreate ? "candidate_only" : "none"}`,
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
  const decision = evaluateMetaScheduler({
    ...createMetaSchedulerInput(context, runtime, userText, Boolean(extra.providerCooldownBlocked)),
    userText,
    messages: createPolicyContextPressureMessages(undefined, userText),
    ...extra,
  }).policyDecision;
  enqueuePolicyHints(context, decision);
  await appendPolicyDecisionEvent(context, sessionId, decision);
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
      activeJob: context.backgroundTasks.some(
        (task) => task.kind === "job" && task.status === "running",
      ),
      toolRunning: context.backgroundTasks.some(
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

export async function buildModelMessagesWithRecentContext(
  context: TuiContext,
  sessionId: string,
  systemPrompt: string,
  currentUserText: string,
  runtime = getSelectedModelRuntime(context),
): Promise<ModelMessage[]> {
  const messages: ModelMessage[] = [{ role: "system", content: systemPrompt }];
  try {
    const resumed = await context.store.resume(sessionId);
    const recent = resumed.transcript
      .filter(
        (event) =>
          event.type === "user_message" ||
          event.type === "assistant_text_delta" ||
          event.type === "tool_call_start" ||
          event.type === "tool_result",
      )
      .slice(-MAX_CONTEXT_MESSAGES * 2 - 1);
    const lastRecent = recent.at(-1);
    const withoutCurrent =
      lastRecent?.type === "user_message" && lastRecent.text === currentUserText
        ? recent.slice(0, -1)
        : recent;
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
        const toolCall = toolCalls.get(event.toolUseId);
        if (!toolCall) {
          const content = await budgetToolResultTranscriptContent(
            context,
            sessionId,
            event.toolUseId,
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
            content: event.content,
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
  } catch (error) {
    await appendSystemEvent(
      context,
      sessionId,
      `recent_context_unavailable: ${error instanceof Error ? error.message : String(error)}`,
      "warning",
    );
  }
  messages.push({ role: "user", content: currentUserText });
  return messages;
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
  });
  for (const record of budgeted.records) {
    await recordToolResultBudgetEvidence(context, sessionId, record);
  }
  return budgeted.messages;
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
): Promise<string> {
  let assistantText = "";
  const textSanitizer = createAssistantPrimaryTextSanitizer(context.language);
  // 与 sendMessage 一致的 assistant streaming block：避免最后一轮 assistant 文本
  // 被 _write 的 ephemeral splice 淘汰，保证完整正文落到 keep:true block。
  const assistantStreamBlockId =
    reuseAssistantStreamBlockId ?? `assistant-stream-final-${randomUUID()}`;
  if (!reuseAssistantStreamBlockId) {
    beginAssistantStream(output, assistantStreamBlockId);
  }
  let chunkCount = 0;
  let hadUsage = false;
  let finishReason: string | undefined;
  let hadThinking = false;
  let ignoredRawToolProtocolText = false;
  const runtime = runtimeFromContinuation(continuation);
  const preflight = await prepareMessagesForProviderPreflight({
    messages: continuation.messages,
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
  if (checkAndWriteProviderCooldown(context, runtime, output)) {
    return "";
  }
  continuation.messages = preflight.messages;
  const promptCacheFields = await buildPromptCacheRequestFields(context);
  for await (const event of gateway.stream(
    continuation.provider,
    {
      messages: preflight.messages,
      model: continuation.model,
      endpointProfile: continuation.endpointProfile,
      ...(continuation.reasoningSent ? { reasoningLevel: continuation.reasoningLevel } : {}),
      toolChoice: "none",
      ...promptCacheFields,
    },
    signal,
  )) {
    if (signal.aborted) {
      clearRequestActivity(context);
      endAssistantStream(output);
      writeLine(output, t(context, "toolInterrupted"));
      return assistantText;
    }
    if (event.type === "assistant_text_delta") {
      clearRequestActivity(context);
      const visibleText = textSanitizer.push(event.text);
      assistantText += visibleText;
      if (visibleText) {
        writeAssistantPreviewDelta(output, assistantStreamBlockId, visibleText);
      }
      continue;
    }
    if (event.type === "assistant_thinking_delta") {
      hadThinking = true;
      continue;
    }
    if (event.type === "usage") {
      hadUsage = true;
      const stats = recordModelUsage(context, event.usage);
      await appendUsageEvents(context, sessionId, stats);
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
      if (visibleText) {
        writeAssistantPreviewDelta(output, assistantStreamBlockId, visibleText);
      }
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
      recordProviderFailure(
        context.providerBreaker,
        continuation.provider,
        continuation.model,
        event.error.code ?? "UNKNOWN",
      );
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
        continuation.model = fallback.runtime.model;
        continuation.endpointProfile = fallback.runtime.endpointProfile;
        continuation.reasoningLevel = fallback.runtime.reasoningLevel;
        continuation.reasoningSent = fallback.runtime.reasoningSent;
        if (checkAndWriteProviderCooldown(context, fallback.runtime, output)) {
          return assistantText;
        }
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
          ))
        );
      }
      writeErrorLine(output, formatProviderFailurePrimary(event.error, context.language));
      return assistantText;
    }
  }
  const finalVisibleText = textSanitizer.flush();
  assistantText += finalVisibleText;
  if (finalVisibleText) {
    writeAssistantPreviewDelta(output, assistantStreamBlockId, finalVisibleText);
  }
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
    const verdict = evaluateFinalAnswerClaims(assistantText, context.evidence);
    if (verdict.status === "needs_disclaimer") {
      assistantText = await downgradeUnsupportedFinalAnswer(
        assistantText,
        verdict,
        context,
        sessionId,
        output,
        assistantStreamBlockId,
      );
    }
    const extended = runArchitectureAndCompletenessFinalGate(context, assistantText);
    if (extended.status === "needs_disclaimer") {
      await appendSystemEvent(
        context,
        sessionId,
        `final_answer_extended_gate downgrade kinds=${extended.verdict.unsupportedKinds.join(",")}`,
        "warning",
      );
      assistantText = buildExtendedDowngradedFinalAnswer(
        assistantText,
        extended.verdict,
        context.language,
      );
      replaceAssistantBlockContent(output, assistantStreamBlockId, assistantText);
    }
    const visibleAssistantText = stripStructuredFinalAnswerClaims(assistantText);
    if (visibleAssistantText !== assistantText) {
      assistantText = visibleAssistantText;
      replaceAssistantBlockContent(output, assistantStreamBlockId, assistantText);
    }
  }
  if (assistantText) {
    replaceAssistantBlockContent(output, assistantStreamBlockId, assistantText);
  }
  // D.13V — 仅当我们自己 begin 的 stream 才负责 end；复用外层 id 时由外层 end。
  if (!reuseAssistantStreamBlockId) {
    endAssistantStream(output);
    writeFinalAssistantText(output, assistantText);
  }
  clearProviderBreaker(context.providerBreaker, continuation.provider, continuation.model);
  if (
    context.lastProviderFallbackAttempt?.toProvider === continuation.provider &&
    context.lastProviderFallbackAttempt.toModel === continuation.model &&
    context.lastProviderFallbackAttempt.status === "attempted"
  ) {
    context.lastProviderFallbackAttempt.status = "succeeded";
    context.lastProviderFallbackAttempt.createdAt = new Date().toISOString();
    await appendSystemEvent(
      context,
      sessionId,
      `provider fallback attempt: status succeeded; to ${continuation.provider}/${continuation.model}`,
      "info",
    );
  }
  return assistantText;
}

async function downgradeUnsupportedFinalAnswer(
  assistantText: string,
  verdict: FinalAnswerClaimVerdict,
  context: TuiContext,
  sessionId: string,
  output: Writable,
  assistantStreamBlockId: string,
): Promise<string> {
  await appendSystemEvent(
    context,
    sessionId,
    `final_answer_claim_gate downgrade kinds=${verdict.unsupportedKinds.join(",")}`,
    "warning",
  );
  const downgraded = buildDowngradedFinalAnswer(assistantText, verdict, context.language);
  replaceAssistantBlockContent(output, assistantStreamBlockId, downgraded);
  const isBenignSecretSafety =
    (/secret|api[_\s-]?key|密钥|安全|不应|不能|建议|避免|谨慎/iu.test(assistantText) &&
      !/代码里|调用链是|\bin\s+the\s+code\b|\bcall\s+chain\s+is\b/iu.test(assistantText)) ||
    verdict.unsupportedKinds.length === 0;
  if (!isBenignSecretSafety) {
    await captureFailureLearning(context, sessionId, {
      category: "final_gate_downgrade",
      failureSummary: `final answer downgraded: unsupported claim kinds=${verdict.unsupportedKinds.join(",")}`,
      rootCauseGuess: "claimed completion/verification/fact without supporting evidence",
      avoidNextTime:
        "Only declare completion/verification/fixed when matching evidence exists; otherwise remove the claim or gather evidence first",
      sourceRef: "event:final_answer_claim_gate",
      relatedTarget: verdict.unsupportedKinds.join(","),
      severity: "high",
    });
  }
  return downgraded;
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
  const controller = new AbortController();
  context.activeAbortController = controller;
  context.tools.abortSignal = controller.signal;
  context.interrupt = { type: "running", taskId: "model-continuation", canCancel: true };
  startRequestActivity(output, context, "continuing_after_tool");
  let assistantText = "";
  let finalAnswerClaimRetried = false;
  let continuationLoopCompleted = false;
  const assistantEventId = randomUUID();
  // 每轮 round 都会开新的 streaming block，避免不同轮的输出粘到同一行。
  let assistantStreamBlockId = `assistant-stream-cont-${assistantEventId}-0`;
  beginAssistantStream(output, assistantStreamBlockId);
  const sessionId = await ensureSession(context);
  try {
    let evidenceRounds = 0;
    let consecutiveTodoOnlyRounds = 0;
    let totalPlanningOnlyRounds = 0;
    let todoOnlyHintSent = false;
    let rawToolProtocolTextRetries = 0;
    let runtimeFallbackAttempted = false;
    continuationRoundLoop: for (let round = 0; round < MAX_MODEL_TOTAL_TOOL_ROUNDS; round += 1) {
      if (round > 0) {
        assistantStreamBlockId = `assistant-stream-cont-${assistantEventId}-${round}`;
        beginAssistantStream(output, assistantStreamBlockId);
      }
      const toolCalls: ModelToolCall[] = [];
      let roundAssistantText = "";
      const textSanitizer = createAssistantPrimaryTextSanitizer(context.language);
      const continuationRuntime = runtimeFromContinuation(continuation);
      const preflight = await prepareMessagesForProviderPreflight({
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
      if (checkAndWriteProviderCooldown(context, continuationRuntime, output)) {
        clearRequestActivity(context);
        writeStatus(output, context);
        return;
      }
      continuation.messages = preflight.messages;
      const requestMessages = preflight.messages;
      const promptCacheFields = await buildPromptCacheRequestFields(context);
      for await (const event of gateway.stream(
        continuation.provider,
        {
          messages: requestMessages,
          model: continuation.model,
          endpointProfile: continuation.endpointProfile,
          ...(continuation.reasoningSent ? { reasoningLevel: continuation.reasoningLevel } : {}),
          tools: createModelToolDefinitionsForReportGuard(continuation.reportWriteGuard),
          toolChoice: "auto",
          ...promptCacheFields,
        },
        controller.signal,
      )) {
        // D.13O — abort 后必须早返回，迟到的 SSE delta 不再写主屏 / transcript /
        // continuation messages。与 sendMessage 顶层的 controller.signal.aborted
        // 早返回保持一致。
        if (controller.signal.aborted) {
          clearRequestActivity(context);
          endAssistantStream(output);
          writeLine(output, t(context, "toolInterrupted"));
          return;
        }
        if (event.type === "assistant_text_delta") {
          clearRequestActivity(context);
          const visibleText = textSanitizer.push(event.text);
          assistantText += visibleText;
          roundAssistantText += visibleText;
          if (visibleText) {
            writeAssistantPreviewDelta(output, assistantStreamBlockId, visibleText);
          }
          continue;
        }
        if (event.type === "tool_use") {
          const visibleText = textSanitizer.flush();
          assistantText += visibleText;
          roundAssistantText += visibleText;
          if (visibleText) {
            writeAssistantPreviewDelta(output, assistantStreamBlockId, visibleText);
          }
          clearRequestActivity(context);
          toolCalls.push({ id: event.id, name: event.name, input: event.input });
          continue;
        }
        if (event.type === "usage") {
          const stats = recordModelUsage(context, event.usage);
          await appendUsageEvents(context, sessionId, stats);
          continue;
        }
        if (event.type === "error") {
          clearRequestActivity(context);
          const currentRuntime = runtimeFromContinuation(continuation);
          await recordProviderFailureEvidence(context, sessionId, event.error, currentRuntime);
          recordProviderFailure(
            context.providerBreaker,
            continuation.provider,
            continuation.model,
            event.error.code ?? "UNKNOWN",
          );
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
            continuation.model = fallback.runtime.model;
            continuation.endpointProfile = fallback.runtime.endpointProfile;
            continuation.reasoningLevel = fallback.runtime.reasoningLevel;
            continuation.reasoningSent = fallback.runtime.reasoningSent;
            if (checkAndWriteProviderCooldown(context, fallback.runtime, output)) {
              writeStatus(output, context);
              return;
            }
            continue continuationRoundLoop;
          }
          writeErrorLine(output, formatProviderFailurePrimary(event.error, context.language));
          return;
        }
      }
      const finalVisibleText = textSanitizer.flush();
      assistantText += finalVisibleText;
      roundAssistantText += finalVisibleText;
      if (finalVisibleText) {
        writeAssistantPreviewDelta(output, assistantStreamBlockId, finalVisibleText);
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
        // D.13U — Final Answer Claim Gate（仅一次自我修正，continuation 镜像）
        if (!finalAnswerClaimRetried && assistantText) {
          const verdict = evaluateFinalAnswerClaims(assistantText, context.evidence);
          if (verdict.status === "needs_disclaimer") {
            await appendSystemEvent(
              context,
              sessionId,
              `final_answer_claim_gate retry kinds=${verdict.unsupportedKinds.join(",")}`,
              "warning",
            );
            continuation.messages.push({
              role: "user",
              content: createFinalAnswerClaimReminder(verdict, context.language),
            });
            finalAnswerClaimRetried = true;
            assistantText = "";
            // D.13V — 同步丢弃 continuation 当前 streaming block 累计的违规原文。
            discardAssistantBlock(output, assistantStreamBlockId);
            continue;
          }
        }
        // D.13V-B — Architecture / Completeness Final Gate（continuation 镜像）
        if (!finalAnswerClaimRetried && assistantText) {
          const extended = runArchitectureAndCompletenessFinalGate(context, assistantText);
          if (extended.status === "needs_disclaimer") {
            await appendSystemEvent(
              context,
              sessionId,
              `final_answer_extended_gate retry kinds=${extended.verdict.unsupportedKinds.join(",")}`,
              "warning",
            );
            continuation.messages.push({
              role: "user",
              content: createExtendedFinalAnswerReminder(extended.verdict, context.language),
            });
            finalAnswerClaimRetried = true;
            assistantText = "";
            discardAssistantBlock(output, assistantStreamBlockId);
            continue;
          }
        }
        break;
      }
      if (roundAssistantText) {
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
      for (const toolCall of toolCalls) {
        const result = await executeModelToolUse(
          toolCall,
          context,
          sessionId,
          output,
          continuation,
        );
        await recordModelToolFailureForMetaScheduler(context, sessionId, result);
        if (result.pendingApproval) {
          return;
        }
        if (doesWriteSatisfyReportGuard(continuation.reportWriteGuard, toolCall, result)) {
          continuation.reportWriteGuard.completed = true;
        }
        continuation.messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
      if (todoOnly) {
        totalPlanningOnlyRounds += 1;
      }
      if (todoOnly && consecutiveTodoOnlyRounds > MAX_TODO_ONLY_CONSECUTIVE_ROUNDS) {
        if (!todoOnlyHintSent) {
          const todoHint =
            context.language === "en-US"
              ? "Planning recorded. Please proceed with verification tools (Read/Grep/Bash/GitStatusInspect) or provide an unverified conclusion."
              : "计划已记录。请继续执行验证工具（Read/Grep/Bash/GitStatusInspect）或给出尚未验证结论。";
          continuation.messages.push({ role: "user", content: todoHint });
          todoOnlyHintSent = true;
          continue;
        }
      }
      const reachedTotalLimit = round + 1 >= MAX_MODEL_TOTAL_TOOL_ROUNDS;
      if (reachedTotalLimit) {
        const onlyPlanning = evidenceRounds === 0;
        const limitMsg = onlyPlanning
          ? context.language === "en-US"
            ? `Continuation execution turn budget exhausted after ${MAX_MODEL_TOTAL_TOOL_ROUNDS} turns. Only planning/Todo was executed; no repository verification was performed.`
            : `续轮执行轮次预算已耗尽（${MAX_MODEL_TOTAL_TOOL_ROUNDS} 轮）。仅完成计划整理，尚未执行仓库验证。如需验证请运行对应命令或重新发起请求。`
          : context.language === "en-US"
            ? `Continuation execution turn budget exhausted after ${MAX_MODEL_TOTAL_TOOL_ROUNDS} turns. Summarizing with what was gathered so far; no further tools will run. If an action still needs to finish (for example refreshing the index), run the matching command such as /index refresh, or send the request again.`
            : `续轮执行轮次预算已耗尽（${MAX_MODEL_TOTAL_TOOL_ROUNDS} 轮）。将基于目前已收集的信息给出回答，不再继续调用工具。如果还有动作需要完成（例如刷新索引），请运行对应命令（如 /index refresh）或重新发起请求。`;
        writeLine(output, limitMsg);
        const finalText = await streamFinalModelAnswerWithoutTools(
          continuation,
          context,
          gateway,
          sessionId,
          output,
          controller.signal,
          assistantStreamBlockId,
        );
        assistantText += finalText;
        break;
      }
    }
    continuationLoopCompleted = true;
    if (assistantText) {
      // D.13U — 最后一道关卡：所有 final answer（含预算耗尽后的 no-tool summary）
      // 入 transcript 前都必须 gate；没有 retry 机会时直接降级，原文不入 transcript。
      {
        const verdict = evaluateFinalAnswerClaims(assistantText, context.evidence);
        if (verdict.status === "needs_disclaimer") {
          assistantText = await downgradeUnsupportedFinalAnswer(
            assistantText,
            verdict,
            context,
            sessionId,
            output,
            assistantStreamBlockId,
          );
        }
        const extended = runArchitectureAndCompletenessFinalGate(context, assistantText);
        if (extended.status === "needs_disclaimer") {
          await appendSystemEvent(
            context,
            sessionId,
            `final_answer_extended_gate downgrade kinds=${extended.verdict.unsupportedKinds.join(",")}`,
            "warning",
          );
          assistantText = buildExtendedDowngradedFinalAnswer(
            assistantText,
            extended.verdict,
            context.language,
          );
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
      replaceAssistantBlockContent(output, assistantStreamBlockId, assistantText);
      endAssistantStream(output);
      writeFinalAssistantText(output, assistantText);
      output.write("\n");
      await context.store.appendEvent(sessionId, {
        type: "assistant_text_delta",
        id: assistantEventId,
        text: assistantText,
        createdAt: new Date().toISOString(),
      });
    }
    clearProviderBreaker(context.providerBreaker, continuation.provider, continuation.model);
    if (
      context.lastProviderFallbackAttempt?.toProvider === continuation.provider &&
      context.lastProviderFallbackAttempt.toModel === continuation.model &&
      context.lastProviderFallbackAttempt.status === "attempted"
    ) {
      context.lastProviderFallbackAttempt.status = "succeeded";
      context.lastProviderFallbackAttempt.createdAt = new Date().toISOString();
      await appendSystemEvent(
        context,
        sessionId,
        `provider fallback attempt: status succeeded; to ${continuation.provider}/${continuation.model}`,
        "info",
      );
    }
  } finally {
    if (!continuationLoopCompleted || !assistantText) {
      endAssistantStream(output);
    }
    clearRequestActivity(context);
    context.activeAbortController = undefined;
    context.tools.abortSignal = undefined;
    context.interrupt = { type: "idle" };
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
  const providerConfig = context.config.providers[runtime.provider];
  if (
    providerConfig &&
    "supportsTools" in providerConfig &&
    providerConfig.supportsTools === false
  ) {
    return false;
  }
  const known = findKnownModel(runtime.model);
  return known?.supportsTools !== false;
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
