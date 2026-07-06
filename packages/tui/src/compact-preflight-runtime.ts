import type { ModelRole } from "@linghun/config";
import type { ModelMessage } from "@linghun/providers";
import { redactCommonSecrets } from "@linghun/shared";
import { type CompactBoundary, compactMessagesToFit } from "./compact-context.js";
import { estimateModelMessageChars } from "./context-estimator.js";
import { getContextWindowForModel } from "./context-window-runtime.js";
import {
  type DeepCompactRuntimeDeps,
  injectDeepCompactSummary,
  insertAfterLeadingSystemMessages,
  maybeRunDeepCompactBeforeProvider,
} from "./deep-compact-runtime.js";
import { createEvidenceRecord, rememberEvidence } from "./evidence-runtime.js";
import { isFeatureEnabled } from "./feature-flag-runtime.js";
import type { FailureLearningInput } from "./failure-learning-runtime.js";
import type { TuiContext } from "./index.js";
import { getRoleRoute } from "./model-doctor-runtime.js";
import { createCompactBoundaryBlock } from "./shell/view-model.js";
import {
  sanitizeDiagnosticText,
  sanitizeDisplayPaths,
  truncateDisplay,
} from "./startup-runtime.js";
import {
  type ToolResultBudgetRecord,
  type ToolResultBudgetState,
  applyToolResultBudgetToMessages,
} from "./tool-result-budget.js";
import type {
  CompactPreflightTrigger,
  CompactProjection,
  CompactRestoreContext,
  CompactStrategyStep,
  DeepCompactTrigger,
} from "./tui-data-types.js";

export type CompactPreflightRuntime = {
  role: ModelRole;
  provider: string;
  model: string;
};

export type CompactPreflightDeps = {
  appendSystemEvent: (
    context: TuiContext,
    sessionId: string,
    message: string,
    level: "info" | "warning",
  ) => Promise<void>;
  captureFailureLearning: (
    context: TuiContext,
    sessionId: string,
    input: FailureLearningInput,
  ) => Promise<void>;
  recordToolResultBudgetEvidence: (
    context: TuiContext,
    sessionId: string,
    record: ToolResultBudgetRecord,
  ) => Promise<string | undefined>;
  refreshCacheFreshness: (context: TuiContext) => void;
  runDeepCompact?: DeepCompactRuntimeDeps;
};

export type ProviderPreflightCompactResult =
  | { blocked: false; messages: ModelMessage[] }
  | { blocked: true; messages: ModelMessage[]; message: string };

const MAX_CONTEXT_MESSAGES = 12;

const CONTEXT_INPUT_HEADROOM_TOKENS = 8_192;
const CONTEXT_CHARS_PER_TOKEN_ESTIMATE = 4;
const AUTOCOMPACT_BUFFER_TOKENS = 13_000;
const LARGE_CONTEXT_BUFFER_TOKENS = 30_000;
const HUGE_CONTEXT_BUFFER_TOKENS = 50_000;
const LARGE_CONTEXT_WINDOW_TOKENS = 400_000;
const HUGE_CONTEXT_WINDOW_TOKENS = 800_000;
const COMPACT_FAILURE_COOLDOWN_MS = 2 * 60 * 1000;
const COMPACT_SUMMARY_MAX_CHARS = 3_200;
const COMPACT_SUMMARY_TARGET_RESERVE_CHARS = 4_000;
const POST_COMPACT_TARGET_RATIO = 0.3;
const POST_COMPACT_TARGET_MIN_TOKENS = 40_000;
const POST_COMPACT_TARGET_MAX_TOKENS = 80_000;
const COMPACT_PROJECTION_EVENT_PREFIX = "compact_projection:";
const MAX_COMPACT_BOUNDARIES = 20;

export async function prepareMessagesForProviderPreflight(input: {
  messages: ModelMessage[];
  context: TuiContext;
  sessionId: string;
  runtime: CompactPreflightRuntime;
  trigger: CompactPreflightTrigger;
  deps: CompactPreflightDeps;
}): Promise<ProviderPreflightCompactResult> {
  const originalChars = estimateModelMessageChars(input.messages);
  const budgeted = await prepareMessagesForProviderWithToolResultBudget(
    input.messages,
    input.context,
    input.sessionId,
    input.deps,
  );
  const contextMaxChars = getProviderContextMaxChars(input.context, input.runtime);
  const triggerChars = getAutoCompactTriggerChars(input.context, input.runtime);
  const postCompactTargetChars = getPostCompactTargetChars(input.context, input.runtime, {
    contextMaxChars,
    triggerChars,
  });
  const budgetedChars = estimateModelMessageChars(budgeted);
  const strategySteps: CompactStrategyStep[] = [
    {
      layer: "payload_trim",
      status: budgetedChars < originalChars ? "applied" : "skipped",
      reason:
        budgetedChars < originalChars ? "tool_result_payload_budget" : "no_large_tool_payloads",
      beforeChars: originalChars,
      afterChars: budgetedChars,
    },
  ];
  if (input.trigger !== "reactive" && budgetedChars <= triggerChars) {
    const withDeep = injectDeepCompactSummary(budgeted, input.context.cache.deepCompact);
    const withDeepChars = estimateModelMessageChars(withDeep);
    strategySteps.push({
      layer: "semantic_deep",
      status: input.context.cache.deepCompact ? "applied" : "skipped",
      reason: input.context.cache.deepCompact ? "reuse_existing_deep_compact" : "below_trigger",
      beforeChars: budgetedChars,
      afterChars: withDeepChars,
    });
    if (withDeepChars <= contextMaxChars) {
      strategySteps.push({
        layer: "full_summary",
        status: "skipped",
        reason: "payload_trim_or_existing_deep_compact_within_trigger",
        beforeChars: withDeepChars,
        afterChars: withDeepChars,
      });
      recordCompactStrategy(input.context, {
        trigger: input.trigger,
        contextMaxChars,
        triggerChars,
        postCompactTargetChars,
        finalChars: withDeepChars,
        steps: strategySteps,
      });
      return { blocked: false, messages: withDeep };
    }
  }

  const now = Date.now();
  if (input.context.cache.compactCooldownUntil && input.context.cache.compactCooldownUntil > now) {
    const message =
      input.context.language === "en-US"
        ? "Context compact is cooling down after a previous failure. I will not send an oversized partial context to the provider; retry after the cooldown or run /compact status."
        : "上一次上下文压缩失败后仍在冷却中。我不会把超压的半截上下文继续发给 provider；请稍后重试或运行 /compact status 查看。";
    await input.deps.appendSystemEvent(
      input.context,
      input.sessionId,
      "context_compact_cooldown_active",
      "warning",
    );
    return { blocked: true, messages: budgeted, message };
  }

  const pairing = inspectToolPairingSafety(budgeted);
  if (!pairing.safe) {
    await input.deps.appendSystemEvent(
      input.context,
      input.sessionId,
      `context_compact_skipped_tool_pairing: pending=${pairing.pending} orphan=${pairing.orphan} duplicate=${pairing.duplicate}`,
      "warning",
    );
    recordCompactStrategy(input.context, {
      trigger: input.trigger,
      contextMaxChars,
      triggerChars,
      postCompactTargetChars,
      finalChars: budgetedChars,
      steps: [
        ...strategySteps,
        {
          layer: "semantic_deep",
          status: "skipped",
          reason: "tool_pairing_unsafe",
          beforeChars: budgetedChars,
          afterChars: budgetedChars,
        },
        {
          layer: "full_summary",
          status: "skipped",
          reason: "tool_pairing_unsafe",
          beforeChars: budgetedChars,
          afterChars: budgetedChars,
        },
      ],
    });
    if (budgetedChars > contextMaxChars) {
      await recordCompactFailure(
        input.context,
        input.sessionId,
        "tool_pairing_unsafe_over_context_limit",
        true,
        input.deps,
      );
      const message =
        input.context.language === "en-US"
          ? "Context pressure is over the provider limit, but an unfinished tool pair makes compact unsafe. This provider request is blocked."
          : "当前上下文已超过 provider 上限，但存在未闭合 tool pair，压缩不安全。本次 provider 请求已阻断。";
      return { blocked: true, messages: budgeted, message };
    }
    return { blocked: false, messages: budgeted };
  }

  try {
    if (
      input.deps.runDeepCompact &&
      (input.context.modelGateway || input.context.cache.deepCompact)
    ) {
      const deep = await maybeRunDeepCompactBeforeProvider({
        context: input.context,
        sessionId: input.sessionId,
        runtime: input.runtime,
        trigger: toDeepCompactTrigger(input.trigger),
        gateway: input.context.modelGateway,
        signal: input.context.activeAbortController?.signal,
        deps: input.deps.runDeepCompact,
      });
      const afterDeep = estimateModelMessageChars(
        injectDeepCompactSummary(budgeted, input.context.cache.deepCompact),
      );
      if (!deep.ok) {
        const deepMessage = "message" in deep ? deep.message : "Deep compact failed.";
        strategySteps.push({
          layer: "semantic_deep",
          status: "failed",
          reason: `deep_compact_failed:${deepMessage}`,
          beforeChars: budgetedChars,
          afterChars: afterDeep,
        });
        recordCompactStrategy(input.context, {
          trigger: input.trigger,
          contextMaxChars,
          triggerChars,
          postCompactTargetChars,
          finalChars: afterDeep,
          steps: strategySteps,
        });
        await recordCompactFailure(
          input.context,
          input.sessionId,
          `deep_compact_failed:${deepMessage}`,
          true,
          input.deps,
        );
        return { blocked: true, messages: budgeted, message: deepMessage };
      }
      strategySteps.push({
        layer: "semantic_deep",
        status: "applied",
        reason: "semantic_compact_ready",
        beforeChars: budgetedChars,
        afterChars: afterDeep,
      });
    } else {
      const afterDeep = estimateModelMessageChars(
        injectDeepCompactSummary(budgeted, input.context.cache.deepCompact),
      );
      strategySteps.push({
        layer: "semantic_deep",
        status: input.context.cache.deepCompact ? "applied" : "skipped",
        reason: input.context.cache.deepCompact
          ? "reuse_existing_deep_compact"
          : "deep_compact_unavailable",
        beforeChars: budgetedChars,
        afterChars: afterDeep,
      });
    }
    const compactPayloadTargetChars = Math.max(
      1,
      postCompactTargetChars - COMPACT_SUMMARY_TARGET_RESERVE_CHARS,
    );
    const compacted = compactMessagesToFit(budgeted, {
      maxChars: compactPayloadTargetChars,
      preserveRecentMessages: MAX_CONTEXT_MESSAGES,
      kind: "micro",
    });
    if (!compacted.changed || !compacted.boundary) {
      strategySteps.push({
        layer: "full_summary",
        status: "skipped",
        reason: "recent_context_already_within_compact_target",
        beforeChars: budgetedChars,
        afterChars: budgetedChars,
      });
      recordCompactStrategy(input.context, {
        trigger: input.trigger,
        contextMaxChars,
        triggerChars,
        postCompactTargetChars,
        finalChars: budgetedChars,
        steps: strategySteps,
      });
      return { blocked: false, messages: budgeted };
    }
    const projection = createCompactProjection(input.context, {
      boundary: compacted.boundary,
      originalMessages: budgeted,
      compactedMessages: compacted.messages,
      contextMaxChars,
      triggerChars,
      postCompactTargetChars,
      trigger: input.trigger,
      pairingSafe: pairing.safe,
    });
    const replacementProjectionEnabled = isFeatureEnabled(
      "compactReplacementProjection",
      input.context,
    );
    const terminalVisibleProjectionEnabled = isFeatureEnabled(
      "compactTerminalVisibleProjection",
      input.context,
    );
    refreshCompactProjectionAcceptance(projection, input.context);
    const providerMessages = injectDeepCompactSummary(
      replacementProjectionEnabled
        ? injectCompactProjectionMessage(compacted.messages, projection)
        : compacted.messages,
      input.context.cache.deepCompact,
    );
    const providerMessageChars = estimateModelMessageChars(providerMessages);
    strategySteps.push({
      layer: "full_summary",
      status: "applied",
      reason: replacementProjectionEnabled
        ? "provider_visible_replacement_projection"
        : "legacy_compacted_window_feature_flag",
      beforeChars: budgetedChars,
      afterChars: providerMessageChars,
    });
    if (input.trigger === "reactive") {
      strategySteps.push({
        layer: "reactive",
        status: "applied",
        reason: "provider_context_error_retry_once",
        beforeChars: budgetedChars,
        afterChars: providerMessageChars,
      });
    }
    recordCompactStrategy(input.context, {
      trigger: input.trigger,
      contextMaxChars,
      triggerChars,
      postCompactTargetChars,
      finalChars: providerMessageChars,
      steps: strategySteps,
    });
    if (providerMessageChars > contextMaxChars) {
      await recordCompactFailure(
        input.context,
        input.sessionId,
        "post_compact_summary_over_context_limit",
        true,
        input.deps,
      );
      const message =
        input.context.language === "en-US"
          ? "Context compact summary still exceeds the provider limit, so the request is blocked."
          : "上下文压缩摘要后仍超过 provider 上限，本次请求已阻断。";
      return { blocked: true, messages: budgeted, message };
    }
    if (!inspectToolPairingSafety(providerMessages).safe) {
      await recordCompactFailure(
        input.context,
        input.sessionId,
        "post_compact_pairing_unsafe",
        true,
        input.deps,
      );
      const message =
        input.context.language === "en-US"
          ? "Context compact produced an unsafe tool pairing boundary, so the provider request is blocked."
          : "上下文压缩后的 tool pairing 边界不安全，本次 provider 请求已阻断。";
      return { blocked: true, messages: budgeted, message };
    }
    recordCompactBoundary(input.context, compacted.boundary);
    input.context.cache.compactFailure = undefined;
    input.context.cache.compactCooldownUntil = undefined;
    input.deps.refreshCacheFreshness(input.context);
    input.context.pushTranscriptBlock?.(
      createCompactBoundaryBlock(
        projection.preCompactChars,
        projection.postCompactChars,
        input.context.language,
      ),
    );
    if (terminalVisibleProjectionEnabled) {
      const terminalProjection = await input.context.compactOutputMemory?.({
        projectMainScreen: true,
      });
      if (terminalProjection) {
        projection.terminalVisibleBeforeCount = terminalProjection.beforeCount;
        projection.terminalVisibleAfterCount = terminalProjection.afterCount;
      }
    }
    refreshCompactProjectionAcceptance(projection, input.context);
    input.context.cache.compactProjection = projection;
    if (replacementProjectionEnabled) {
      await appendCompactProjectionEvents(input.context, input.sessionId, projection, input.deps);
    }
    return { blocked: false, messages: providerMessages };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await recordCompactFailure(input.context, input.sessionId, reason, true, input.deps);
    const message =
      input.context.language === "en-US"
        ? "Context compact failed, so this provider request is blocked instead of continuing with partial context."
        : "上下文压缩失败，本次 provider 请求已阻断，不会拿半截上下文继续运行。";
    return { blocked: true, messages: budgeted, message };
  }
}

async function prepareMessagesForProviderWithToolResultBudget(
  messages: ModelMessage[],
  context: TuiContext,
  sessionId: string,
  deps: CompactPreflightDeps,
): Promise<ModelMessage[]> {
  const budgeted = await applyToolResultBudgetToMessages(messages, {
    projectPath: context.projectPath,
    sessionId,
    state: getToolResultBudgetState(context),
  });
  for (const record of budgeted.records) {
    await deps.recordToolResultBudgetEvidence(context, sessionId, record);
  }
  return budgeted.messages;
}

function getToolResultBudgetState(context: TuiContext): ToolResultBudgetState {
  context.toolResultBudgetState ??= { seenIds: new Set(), replacements: new Map() };
  return context.toolResultBudgetState;
}

export function recordCompactBoundary(context: TuiContext, boundary: CompactBoundary): void {
  context.cache.compacted = true;
  context.cache.compactBoundaries.push(boundary);
  if (context.cache.compactBoundaries.length > MAX_COMPACT_BOUNDARIES) {
    context.cache.compactBoundaries.shift();
  }
  void context.compactOutputMemory?.();
}

function getAutoCompactBufferTokens(context: TuiContext, runtime: CompactPreflightRuntime): number {
  const route = getRoleRoute(context.config, runtime.role);
  const contextWindowTokens = getContextWindowForModel(runtime.model, route);
  if (contextWindowTokens >= HUGE_CONTEXT_WINDOW_TOKENS) {
    return HUGE_CONTEXT_BUFFER_TOKENS;
  }
  if (contextWindowTokens >= LARGE_CONTEXT_WINDOW_TOKENS) {
    return LARGE_CONTEXT_BUFFER_TOKENS;
  }
  return AUTOCOMPACT_BUFFER_TOKENS;
}

function getCompactBudgetTokens(
  context: TuiContext,
  runtime: CompactPreflightRuntime,
): {
  contextWindowTokens: number;
  postCompactTargetTokens: number;
} {
  const route = getRoleRoute(context.config, runtime.role);
  const contextWindowTokens = getContextWindowForModel(runtime.model, route);
  const ratioTargetTokens = Math.ceil(contextWindowTokens * POST_COMPACT_TARGET_RATIO);
  return {
    contextWindowTokens,
    postCompactTargetTokens: Math.min(
      POST_COMPACT_TARGET_MAX_TOKENS,
      Math.max(POST_COMPACT_TARGET_MIN_TOKENS, ratioTargetTokens),
    ),
  };
}

export function getPostCompactTargetChars(
  context: TuiContext,
  runtime: CompactPreflightRuntime,
  input?: { contextMaxChars?: number; triggerChars?: number },
): number {
  const { postCompactTargetTokens } = getCompactBudgetTokens(context, runtime);
  const stableTargetChars = postCompactTargetTokens * CONTEXT_CHARS_PER_TOKEN_ESTIMATE;
  const contextMaxChars = input?.contextMaxChars ?? getProviderContextMaxChars(context, runtime);
  const triggerChars = input?.triggerChars ?? getAutoCompactTriggerChars(context, runtime);
  const providerSafeTargetChars = Math.max(
    1,
    contextMaxChars - COMPACT_SUMMARY_TARGET_RESERVE_CHARS,
  );
  const triggerSafeTargetChars = Math.max(1, triggerChars - COMPACT_SUMMARY_TARGET_RESERVE_CHARS);
  return Math.max(1, Math.min(stableTargetChars, providerSafeTargetChars, triggerSafeTargetChars));
}

export function getAutoCompactTriggerChars(
  context: TuiContext,
  runtime: CompactPreflightRuntime,
): number {
  const maxChars = getProviderContextMaxChars(context, runtime);
  const bufferChars =
    getAutoCompactBufferTokens(context, runtime) * CONTEXT_CHARS_PER_TOKEN_ESTIMATE;
  return Math.max(1, maxChars - bufferChars);
}

export function inspectToolPairingSafety(messages: ModelMessage[]): {
  safe: boolean;
  pending: number;
  orphan: number;
  duplicate: number;
} {
  const pending = new Set<string>();
  const seenResults = new Set<string>();
  let orphan = 0;
  let duplicate = 0;
  for (const message of messages) {
    if (message.role === "assistant") {
      for (const toolCall of message.toolCalls ?? []) {
        if (pending.has(toolCall.id)) {
          duplicate += 1;
          continue;
        }
        pending.add(toolCall.id);
      }
      continue;
    }
    if (message.role === "tool") {
      if (!pending.has(message.tool_call_id)) {
        orphan += 1;
        continue;
      }
      if (seenResults.has(message.tool_call_id)) {
        duplicate += 1;
        continue;
      }
      pending.delete(message.tool_call_id);
      seenResults.add(message.tool_call_id);
    }
  }
  return {
    safe: pending.size === 0 && orphan === 0 && duplicate === 0,
    pending: pending.size,
    orphan,
    duplicate,
  };
}

function createCompactProjection(
  context: TuiContext,
  input: {
    boundary: CompactBoundary;
    originalMessages: ModelMessage[];
    compactedMessages: ModelMessage[];
    contextMaxChars: number;
    triggerChars: number;
    postCompactTargetChars: number;
    trigger: CompactPreflightTrigger;
    pairingSafe: boolean;
  },
): CompactProjection {
  const preCompactChars = estimateModelMessageChars(input.originalMessages);
  const postCompactChars = estimateModelMessageChars(input.compactedMessages);
  const savingsRatio = Number(
    ((preCompactChars - postCompactChars) / Math.max(1, preCompactChars)).toFixed(3),
  );
  const removedMessages = Math.max(
    0,
    input.originalMessages.length - input.compactedMessages.length,
  );
  const goal = sanitizeCompactSummaryText(
    context,
    context.memory.lastHandoff?.goal ?? "current interactive coding task",
    220,
  );
  const currentTask = sanitizeCompactSummaryText(
    context,
    context.tools.todos.find((todo) => todo.status !== "completed")?.content ??
      "continue the latest user request",
    220,
  );
  const activeAgents = context.agents
    .filter((agent) => agent.status === "running")
    .slice(0, 5)
    .map(
      (agent) =>
        `agent:${agent.id}:${agent.status}:${sanitizeCompactSummaryText(context, agent.summary || agent.task, 80)}`,
    );
  const activeWorkflows = context.backgroundTasks
    .filter((task) => task.kind === "job" || task.kind === "agent")
    .filter((task) => task.status === "running")
    .slice(0, 5)
    .map(
      (task) =>
        `${task.kind}:${task.id}:${task.status}:${sanitizeCompactSummaryText(context, task.userVisibleSummary, 80)}`,
    );
  const needsAttentionAgents = context.agents
    .filter((agent) => agent.status === "blocked" || agent.status === "failed")
    .slice(0, 5)
    .map(
      (agent) =>
        `agent:${agent.id}:${agent.status}:${sanitizeCompactSummaryText(context, agent.summary || agent.task, 80)}`,
    );
  const needsAttentionWorkflows = context.backgroundTasks
    .filter((task) => task.kind === "job" || task.kind === "agent")
    .filter((task) => task.status === "paused" || task.status === "blocked")
    .slice(0, 5)
    .map(
      (task) =>
        `${task.kind}:${task.id}:${task.status}:${sanitizeCompactSummaryText(context, task.userVisibleSummary, 80)}`,
    );
  const staleResumableAgents = context.agents
    .filter((agent) => agent.status === "stale")
    .slice(0, 5)
    .map(
      (agent) =>
        `agent:${agent.id}:${agent.status}:${sanitizeCompactSummaryText(context, agent.summary || agent.task, 80)}`,
    );
  const staleResumableWorkflows = context.backgroundTasks
    .filter((task) => task.kind === "job" || task.kind === "agent")
    .filter((task) => task.status === "stale")
    .slice(0, 5)
    .map(
      (task) =>
        `${task.kind}:${task.id}:${task.status}:${sanitizeCompactSummaryText(context, task.userVisibleSummary, 80)}`,
    );
  const pending = [
    context.pendingLocalApproval
      ? `local approval pending:${context.pendingLocalApproval.kind}`
      : "",
    context.pendingNaturalCommand ? "natural command pending" : "",
    context.pendingAutopilot ? "autopilot pending" : "",
    ...context.tools.todos
      .filter((todo) => todo.status !== "completed")
      .slice(0, 6)
      .map(
        (todo) => `todo:${todo.status}:${sanitizeCompactSummaryText(context, todo.content, 100)}`,
      ),
  ]
    .filter(Boolean)
    .slice(0, 10);
  const failureLearning = context.failureLearning.records
    .filter((record) => record.status === "active")
    .slice(0, 3)
    .map(
      (record) => `${record.id}:${sanitizeCompactSummaryText(context, record.failureSummary, 100)}`,
    );
  const decisions = context.routeDecisions
    .slice(0, 5)
    .map(
      (item) =>
        `${item.role}:${item.selectedProvider || "paused"}/${item.selectedModel || "paused"}`,
    );
  const evidenceRefs = context.evidence.slice(0, 8).map((item) => item.id);
  const changedFiles = uniqueCompactValues(
    context.tools.changedFiles.map((file) => sanitizeCompactSummaryText(context, file, 120)),
    8,
  );
  const files = uniqueCompactValues(
    [
      ...context.recentlyMentionedFiles,
      ...context.tools.changedFiles,
      ...input.boundary.preservedFiles,
    ].map((file) => sanitizeCompactSummaryText(context, file, 120)),
    12,
  );
  const risks = [
    removedMessages > 0 ? `${removedMessages} older provider messages replaced by summary` : "",
    input.boundary.compactedToolResultIds.length > 0
      ? `${input.boundary.compactedToolResultIds.length} older tool results removed as complete pairs`
      : "",
    ...failureLearning.map((item) => `failure learning:${item}`),
  ].filter(Boolean);
  const restoreContext: CompactRestoreContext = {
    goal,
    currentTask,
    phaseStatus: context.memory.lastHandoff?.phaseStatus ?? "in_progress",
    userConstraints: context.memory.accepted
      .filter((item) => item.scope === "user" || item.taxonomy === "user")
      .slice(0, 4)
      .map((item) => sanitizeCompactSummaryText(context, item.summary, 160)),
    keyFiles: files,
    changedFiles,
    evidenceRefs,
    activeAgentsWorkflows: [...activeAgents, ...activeWorkflows].slice(0, 10),
    needsAttentionAgentsWorkflows: [...needsAttentionAgents, ...needsAttentionWorkflows].slice(
      0,
      10,
    ),
    staleResumableAgentsWorkflows: [...staleResumableAgents, ...staleResumableWorkflows].slice(
      0,
      10,
    ),
    pendingItems: pending,
    decisions,
    risks: risks.slice(0, 10),
    indexStatus: sanitizeCompactSummaryText(context, context.index.status, 80),
    cacheFreshness: sanitizeCompactSummaryText(
      context,
      context.cache.lastFreshness?.changedKeys?.join(",") || "stable-or-unknown",
      160,
    ),
    memoryStatus: `${context.memory.accepted.length} accepted memories`,
    verificationRequirement:
      "Do not claim completion, PASS, or verified results without recorded evidence.",
  };
  const stableProjection = [
    "Linghun compact summary",
    "scope provider-visible recent context projection",
    "role compacted recent provider context",
    `user goal ${restoreContext.goal}`,
    `current task ${restoreContext.currentTask}`,
    `phase status ${restoreContext.phaseStatus}`,
    `user constraints ${restoreContext.userConstraints.join("; ") || "none recorded"}`,
    `key files ${restoreContext.keyFiles.join(", ") || "none"}`,
    "anti hallucination: do not claim compact failure as PASS evidence; preserve evidence-bound claims only",
    `verification requirement ${restoreContext.verificationRequirement}`,
  ].join("\n");
  const diagnosticProjection = [
    "[Compact projection diagnostics]",
    `trigger ${input.trigger}`,
    `decisions ${restoreContext.decisions.join("; ") || "none recorded"}`,
    `evidence refs ${evidenceRefs.map((id) => `evidence:${id}`).join(", ") || "none"}`,
    `active agents/workflows ${restoreContext.activeAgentsWorkflows.join("; ") || "none"}`,
    `needs-attention agents/workflows ${restoreContext.needsAttentionAgentsWorkflows.join("; ") || "none"}`,
    `stale resumable agents/workflows ${restoreContext.staleResumableAgentsWorkflows.join("; ") || "none"}`,
    `pending permissions/tool calls ${restoreContext.pendingItems.join("; ") || "none"}`,
    `failure learning ${failureLearning.join("; ") || "none"}`,
    `index/cache/memory freshness: index ${restoreContext.indexStatus}; cache freshness ${restoreContext.cacheFreshness}; memory ${restoreContext.memoryStatus}`,
    `discarded scope ${restoreContext.risks.join("; ") || "older provider-visible recent context summarized"}`,
    `target budget chars ${input.postCompactTargetChars}`,
    `target budget tokens ${Math.ceil(input.postCompactTargetChars / CONTEXT_CHARS_PER_TOKEN_ESTIMATE)}`,
    `projected savings ${(savingsRatio * 100).toFixed(1)}%`,
    `tool pairing safe ${input.pairingSafe ? "yes" : "no"}`,
  ].join("\n");
  const summary = truncateDisplay(
    [stableProjection, diagnosticProjection].join("\n\n"),
    COMPACT_SUMMARY_MAX_CHARS,
  );
  const projection: CompactProjection = {
    boundaryId: input.boundary.id,
    createdAt: input.boundary.createdAt,
    summary,
    restoreContext,
    windowId: input.boundary.id,
    replacementKind: "provider-visible",
    replacedMessageCount: removedMessages,
    replacementMessageCount: input.compactedMessages.length,
    pressureRatio: Number((preCompactChars / Math.max(1, input.contextMaxChars)).toFixed(3)),
    preCompactChars,
    postCompactChars,
    postCompactTargetChars: input.postCompactTargetChars,
    savingsRatio,
    discardedRange: risks.join("; ") || "older provider-visible recent context summarized",
    toolPairingSafe: input.pairingSafe,
    risks,
    evidenceRefs,
  };
  refreshCompactProjectionAcceptance(projection, context);
  return projection;
}

function refreshCompactProjectionAcceptance(
  projection: CompactProjection,
  context: Pick<TuiContext, "config">,
): void {
  const retainedBudgetEnabled = isFeatureEnabled("compactRetainedBudget", context);
  const replacementProjectionEnabled = isFeatureEnabled("compactReplacementProjection", context);
  const terminalVisibleProjectionEnabled = isFeatureEnabled(
    "compactTerminalVisibleProjection",
    context,
  );
  const budgetHit =
    !retainedBudgetEnabled ||
    projection.postCompactTargetChars === undefined ||
    projection.postCompactChars <= projection.postCompactTargetChars;
  const replacementActive =
    replacementProjectionEnabled &&
    projection.replacementKind === "provider-visible" &&
    (projection.replacedMessageCount ?? 0) > 0 &&
    (projection.replacementMessageCount ?? 0) > 0;
  const terminalVisibleProjection =
    !terminalVisibleProjectionEnabled ||
    projection.terminalVisibleBeforeCount === undefined ||
    projection.terminalVisibleAfterCount === undefined
      ? "unknown"
      : projection.terminalVisibleAfterCount < projection.terminalVisibleBeforeCount
        ? "reduced"
        : "not-reduced";
  const needsAttention =
    !budgetHit ||
    (replacementProjectionEnabled && !replacementActive) ||
    terminalVisibleProjection === "not-reduced" ||
    !projection.toolPairingSafe;

  projection.acceptance = {
    budget: budgetHit ? "hit" : "miss",
    replacementProjection: replacementActive
      ? "active"
      : replacementProjectionEnabled
        ? "missing"
        : "disabled",
    terminalVisibleProjection,
    uiNotice: needsAttention ? "needs-attention" : "quiet-success",
    rollback: replacementProjectionEnabled ? "available" : "active",
    featureFlags: {
      replacementProjection: replacementProjectionEnabled,
      terminalVisibleProjection: terminalVisibleProjectionEnabled,
      retainedBudget: retainedBudgetEnabled,
    },
  };
  projection.progress = {
    status: "complete",
    stages: [
      "scan_context",
      "generate_summary",
      "trim_old_records",
      "restore_context",
      "complete",
    ],
    preCompactChars: projection.preCompactChars,
    postCompactChars: projection.postCompactChars,
    targetChars: projection.postCompactTargetChars,
    savingsRatio: projection.savingsRatio,
  };
}

function uniqueCompactValues(values: string[], limit: number): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
    if (result.length >= limit) break;
  }
  return result;
}

function formatCompactRestoreContext(projection: CompactProjection): string {
  if (!projection.restoreContext) {
    return "";
  }
  return `\n\n[Context restore metadata]\n${JSON.stringify(projection.restoreContext)}`;
}

export function sanitizeCompactSummaryText(
  context: Pick<TuiContext, "projectPath">,
  value: string,
  maxChars: number,
): string {
  const singleLine = value.replace(/\s+/g, " ");
  const withoutSecrets = sanitizeDiagnosticText(redactCommonSecrets(singleLine));
  return truncateDisplay(sanitizeDisplayPaths(withoutSecrets, context.projectPath), maxChars);
}

function injectCompactProjectionMessage(
  messages: ModelMessage[],
  projection: CompactProjection,
): ModelMessage[] {
  const summaryMessage: ModelMessage = {
    role: "user",
    content: `Context compact projection\n${projection.summary}\n\n[Compact boundary diagnostics]\nboundary ${projection.boundaryId}\ncreated at ${projection.createdAt}${formatCompactRestoreContext(projection)}`,
  };
  return insertAfterLeadingSystemMessages(messages, summaryMessage);
}

async function appendCompactProjectionEvents(
  context: TuiContext,
  sessionId: string,
  projection: CompactProjection,
  deps: CompactPreflightDeps,
): Promise<void> {
  await deps.appendSystemEvent(
    context,
    sessionId,
    `${COMPACT_PROJECTION_EVENT_PREFIX}${JSON.stringify(projection)}`,
    "info",
  );
  const evidence = createEvidenceRecord(
    "user_provided",
    `compact boundary ${projection.boundaryId}; scope provider-visible recent context projection; pressure ${projection.pressureRatio}; replacement ${projection.replacedMessageCount ?? "unknown"}->${projection.replacementMessageCount ?? "unknown"}; visible ${projection.terminalVisibleBeforeCount ?? "unknown"}->${projection.terminalVisibleAfterCount ?? "unknown"}; tool pairing safe ${projection.toolPairingSafe ? "yes" : "no"}`,
    `compact:${projection.boundaryId}`,
    ["context_compact_boundary"],
  );
  rememberEvidence(context, evidence);
  await context.store.appendEvent(sessionId, { type: "evidence_record", ...evidence });
}

function recordCompactStrategy(
  context: TuiContext,
  input: {
    trigger: CompactPreflightTrigger;
    contextMaxChars: number;
    triggerChars: number;
    postCompactTargetChars: number;
    finalChars: number;
    steps: CompactStrategyStep[];
  },
): void {
  const appliedLayers = input.steps
    .filter((step) => step.status === "applied")
    .map((step) => step.layer);
  context.cache.compactStrategy = {
    trigger: input.trigger,
    createdAt: new Date().toISOString(),
    contextMaxChars: input.contextMaxChars,
    triggerChars: input.triggerChars,
    postCompactTargetChars: input.postCompactTargetChars,
    finalChars: input.finalChars,
    cacheStablePrefixRisk: appliedLayers.includes("full_summary") ? "medium" : "low",
    steps: input.steps,
  };
}

function toDeepCompactTrigger(trigger: CompactPreflightTrigger): DeepCompactTrigger {
  return trigger === "reactive" ? "request" : trigger;
}

async function recordCompactFailure(
  context: TuiContext,
  sessionId: string,
  reason: string,
  blocked: boolean,
  deps: CompactPreflightDeps,
): Promise<void> {
  const cooldownUntilMs = Date.now() + COMPACT_FAILURE_COOLDOWN_MS;
  context.cache.compactCooldownUntil = cooldownUntilMs;
  context.cache.compactFailure = {
    at: new Date().toISOString(),
    reason: sanitizeCompactSummaryText(context, reason, 220),
    blocked,
    cooldownUntil: new Date(cooldownUntilMs).toISOString(),
  };
  await deps.appendSystemEvent(
    context,
    sessionId,
    `context compact failed: blocked ${blocked ? "yes" : "no"}; reason ${context.cache.compactFailure.reason}; cooldown until ${context.cache.compactFailure.cooldownUntil}`,
    "warning",
  );
  await deps.captureFailureLearning(context, sessionId, {
    category: "resource_cap",
    failureSummary: "context compact failed before provider request",
    rootCauseGuess: context.cache.compactFailure.reason,
    avoidNextTime:
      "Do not continue with partial context after compact failure; retry after cooldown or reduce context pressure",
    sourceRef: "system_event:context_compact_failed",
    relatedTarget: "context compact",
    severity: "medium",
  });
}

export function getProviderContextMaxChars(
  context: TuiContext,
  runtime: CompactPreflightRuntime,
): number {
  const route = getRoleRoute(context.config, runtime.role);
  const contextWindow = getContextWindowForModel(runtime.model, route);
  const maxInputTokens =
    route.maxInputTokens ??
    Math.max(
      1,
      contextWindow -
        (route.maxOutputTokens ??
          context.config.providers[runtime.provider]?.maxOutputTokens ??
          CONTEXT_INPUT_HEADROOM_TOKENS),
    );
  return Math.max(1, maxInputTokens * CONTEXT_CHARS_PER_TOKEN_ESTIMATE);
}
