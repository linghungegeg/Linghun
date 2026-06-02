import { randomUUID } from "node:crypto";
import type { ModelRole } from "@linghun/config";
import type { ModelMessage } from "@linghun/providers";
import { findKnownModel } from "@linghun/providers";
import { type CompactBoundary, compactMessagesToFit } from "./compact-context.js";
import { estimateModelMessageChars } from "./context-estimator.js";
import {
  type DeepCompactRuntimeDeps,
  injectDeepCompactSummary,
  maybeRunDeepCompactBeforeProvider,
} from "./deep-compact-runtime.js";
import type { FailureLearningInput } from "./failure-learning-runtime.js";
import type { TuiContext } from "./index.js";
import { getRoleRoute } from "./model-doctor-runtime.js";
import {
  sanitizeDiagnosticText,
  sanitizeDisplayPaths,
  truncateDisplay,
} from "./startup-runtime.js";
import {
  type ToolResultBudgetRecord,
  applyToolResultBudgetToMessages,
} from "./tool-result-budget.js";
import type { EvidenceRecord } from "./tui-data-types.js";
import type { CompactProjection } from "./tui-data-types.js";

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
const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000;
const CONTEXT_INPUT_HEADROOM_TOKENS = 8_192;
const CONTEXT_CHARS_PER_TOKEN_ESTIMATE = 4;
const CCB_LIKE_AUTOCOMPACT_BUFFER_TOKENS = 13_000;
const CCB_LIKE_LARGE_CONTEXT_BUFFER_TOKENS = 30_000;
const CCB_LIKE_HUGE_CONTEXT_BUFFER_TOKENS = 50_000;
const CCB_LIKE_LARGE_CONTEXT_WINDOW_TOKENS = 400_000;
const CCB_LIKE_HUGE_CONTEXT_WINDOW_TOKENS = 800_000;
const COMPACT_FAILURE_COOLDOWN_MS = 2 * 60 * 1000;
const COMPACT_SUMMARY_MAX_CHARS = 3_200;
const COMPACT_SUMMARY_TARGET_RESERVE_CHARS = 4_000;
const COMPACT_PROJECTION_EVENT_PREFIX = "compact_projection:";
const MAX_COMPACT_BOUNDARIES = 20;
const MAX_EVIDENCE_RECORDS = 50;

export async function prepareMessagesForProviderPreflight(input: {
  messages: ModelMessage[];
  context: TuiContext;
  sessionId: string;
  runtime: CompactPreflightRuntime;
  trigger: "request" | "continuation" | "final" | "agent-child";
  deps: CompactPreflightDeps;
}): Promise<ProviderPreflightCompactResult> {
  const budgeted = await prepareMessagesForProviderWithToolResultBudget(
    input.messages,
    input.context,
    input.sessionId,
    input.deps,
  );
  const contextMaxChars = getProviderContextMaxChars(input.context, input.runtime);
  const triggerChars = getAutoCompactTriggerChars(input.context, input.runtime);
  const currentChars = estimateModelMessageChars(budgeted);
  if (currentChars <= triggerChars) {
    const withDeep = injectDeepCompactSummary(budgeted, input.context.cache.deepCompact);
    if (estimateModelMessageChars(withDeep) <= contextMaxChars) {
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
    if (currentChars > contextMaxChars) {
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
    if (input.deps.runDeepCompact) {
      const deep = await maybeRunDeepCompactBeforeProvider({
        context: input.context,
        sessionId: input.sessionId,
        runtime: input.runtime,
        trigger: input.trigger,
        gateway: input.context.modelGateway,
        deps: input.deps.runDeepCompact,
      });
      if (!deep.ok) {
        await recordCompactFailure(
          input.context,
          input.sessionId,
          `deep_compact_failed:${deep.message}`,
          true,
          input.deps,
        );
        return { blocked: true, messages: budgeted, message: deep.message };
      }
    }
    const compacted = compactMessagesToFit(budgeted, {
      maxChars: Math.max(1, triggerChars - COMPACT_SUMMARY_TARGET_RESERVE_CHARS),
      preserveRecentMessages: MAX_CONTEXT_MESSAGES,
      kind: "micro",
    });
    if (!compacted.changed || !compacted.boundary) {
      return { blocked: false, messages: budgeted };
    }
    const projection = createCompactProjection(input.context, {
      boundary: compacted.boundary,
      originalMessages: budgeted,
      compactedMessages: compacted.messages,
      contextMaxChars,
      triggerChars,
      trigger: input.trigger,
      pairingSafe: pairing.safe,
    });
    const providerMessages = injectDeepCompactSummary(
      injectCompactProjectionMessage(compacted.messages, projection),
      input.context.cache.deepCompact,
    );
    if (estimateModelMessageChars(providerMessages) > contextMaxChars) {
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
    input.context.cache.compactProjection = projection;
    input.context.cache.compactFailure = undefined;
    input.context.cache.compactCooldownUntil = undefined;
    input.deps.refreshCacheFreshness(input.context);
    await appendCompactProjectionEvents(input.context, input.sessionId, projection, input.deps);
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
  });
  if (budgeted.records.length === 0) return messages;
  for (const record of budgeted.records) {
    await deps.recordToolResultBudgetEvidence(context, sessionId, record);
  }
  return budgeted.messages;
}

export function recordCompactBoundary(context: TuiContext, boundary: CompactBoundary): void {
  context.cache.compacted = true;
  context.cache.compactBoundaries.push(boundary);
  if (context.cache.compactBoundaries.length > MAX_COMPACT_BOUNDARIES) {
    context.cache.compactBoundaries.shift();
  }
}

function getAutoCompactBufferTokens(context: TuiContext, runtime: CompactPreflightRuntime): number {
  const route = getRoleRoute(context.config, runtime.role);
  const known = findKnownModel(runtime.model);
  const contextWindowTokens =
    route.maxInputTokens ?? known?.contextWindow ?? DEFAULT_CONTEXT_WINDOW_TOKENS;
  if (contextWindowTokens >= CCB_LIKE_HUGE_CONTEXT_WINDOW_TOKENS) {
    return CCB_LIKE_HUGE_CONTEXT_BUFFER_TOKENS;
  }
  if (contextWindowTokens >= CCB_LIKE_LARGE_CONTEXT_WINDOW_TOKENS) {
    return CCB_LIKE_LARGE_CONTEXT_BUFFER_TOKENS;
  }
  return CCB_LIKE_AUTOCOMPACT_BUFFER_TOKENS;
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
    trigger: "request" | "continuation" | "final" | "agent-child";
    pairingSafe: boolean;
  },
): CompactProjection {
  const preCompactChars = estimateModelMessageChars(input.originalMessages);
  const postCompactChars = estimateModelMessageChars(input.compactedMessages);
  const removedMessages = Math.max(
    0,
    input.originalMessages.length - input.compactedMessages.length,
  );
  const activeAgents = context.agents
    .filter((agent) => agent.status === "running" || agent.status === "stale")
    .slice(0, 5)
    .map(
      (agent) =>
        `${agent.id}:${agent.status}:${sanitizeCompactSummaryText(context, agent.summary || agent.task, 80)}`,
    );
  const activeWorkflows = context.backgroundTasks
    .filter((task) => task.kind === "job" || task.kind === "agent")
    .filter(
      (task) => task.status === "running" || task.status === "paused" || task.status === "stale",
    )
    .slice(0, 5)
    .map(
      (task) =>
        `${task.kind}:${task.status}:${sanitizeCompactSummaryText(context, task.userVisibleSummary, 80)}`,
    );
  const pending = [
    context.pendingLocalApproval ? "local approval pending" : "",
    context.pendingNaturalCommand ? "natural command pending" : "",
    context.pendingAutopilot ? "autopilot pending" : "",
  ].filter(Boolean);
  const failureLearning = context.failureLearning.records
    .slice(0, 3)
    .map(
      (record) => `${record.id}:${sanitizeCompactSummaryText(context, record.failureSummary, 100)}`,
    );
  const evidenceRefs = context.evidence.slice(0, 8).map((item) => item.id);
  const files = [
    ...new Set([
      ...context.recentlyMentionedFiles.slice(0, 8),
      ...context.tools.changedFiles.slice(0, 8),
      ...input.boundary.preservedFiles.slice(0, 8),
    ]),
  ]
    .map((file) => sanitizeCompactSummaryText(context, file, 120))
    .slice(0, 12);
  const risks = [
    removedMessages > 0 ? `${removedMessages} older provider messages replaced by summary` : "",
    input.boundary.compactedToolResultIds.length > 0
      ? `${input.boundary.compactedToolResultIds.length} older tool results removed as complete pairs`
      : "",
  ].filter(Boolean);
  const summary = truncateDisplay(
    [
      "Linghun compact summary",
      "scope=provider-visible recent context projection",
      `trigger=${input.trigger}`,
      `userGoal=${sanitizeCompactSummaryText(context, context.memory.lastHandoff?.goal ?? "current interactive coding task", 220)}`,
      `currentTask=${sanitizeCompactSummaryText(context, context.tools.todos.find((todo) => todo.status !== "completed")?.content ?? "continue the latest user request", 220)}`,
      `decisions=${
        context.routeDecisions
          .slice(0, 3)
          .map(
            (item) =>
              `${item.role}:${item.selectedProvider || "paused"}/${item.selectedModel || "paused"}`,
          )
          .join("; ") || "none recorded"
      }`,
      `filesOrEvidenceRefs=${[...files, ...evidenceRefs.map((id) => `evidence:${id}`)].join(", ") || "none"}`,
      `activeAgentsWorkflows=${[...activeAgents, ...activeWorkflows].join("; ") || "none"}`,
      `pendingPermissionsToolCalls=${pending.join("; ") || "none"}`,
      `failureLearning=${failureLearning.join("; ") || "none"}`,
      "antiHallucination=do not claim compact failure as PASS evidence; preserve evidence-bound claims only",
      `indexCacheMemoryFreshness=index:${context.index.status}; cacheFreshness:${context.cache.lastFreshness?.changedKeys?.join(",") || "stable-or-unknown"}; memory:${context.memory.accepted.length} accepted`,
      `discardedScope=${risks.join("; ") || "older provider-visible recent context summarized"}`,
      `toolPairingSafe=${input.pairingSafe ? "yes" : "no"}`,
    ].join("\n"),
    COMPACT_SUMMARY_MAX_CHARS,
  );
  return {
    boundaryId: input.boundary.id,
    createdAt: input.boundary.createdAt,
    summary,
    pressureRatio: Number((preCompactChars / Math.max(1, input.contextMaxChars)).toFixed(3)),
    preCompactChars,
    postCompactChars,
    discardedRange: risks.join("; ") || "older provider-visible recent context summarized",
    toolPairingSafe: input.pairingSafe,
    risks,
    evidenceRefs,
  };
}

export function sanitizeCompactSummaryText(
  context: Pick<TuiContext, "projectPath">,
  value: string,
  maxChars: number,
): string {
  const singleLine = value.replace(/\s+/g, " ");
  const withoutSecrets = sanitizeDiagnosticText(redactCompactSecrets(singleLine));
  return truncateDisplay(sanitizeDisplayPaths(withoutSecrets, context.projectPath), maxChars);
}

function redactCompactSecrets(value: string): string {
  return value
    .replace(
      /(api[_-]?key|apiKey|token|Authorization)(\s*[:=]\s*)(Bearer\s+)?[^\s;&,)}\]]+/giu,
      (_match, key: string, sep: string) => `${key}${sep}***`,
    )
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/giu, "Bearer ***")
    .replace(/sk-[A-Za-z0-9_-]+/gu, "sk-***");
}

function injectCompactProjectionMessage(
  messages: ModelMessage[],
  projection: CompactProjection,
): ModelMessage[] {
  const summaryMessage: ModelMessage = {
    role: "user",
    content: `[Context compact boundary ${projection.boundaryId}]\n${projection.summary}`,
  };
  if (messages[0]?.role === "system") {
    return [messages[0], summaryMessage, ...messages.slice(1)];
  }
  return [summaryMessage, ...messages];
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
    `compact boundary ${projection.boundaryId}; scope=provider-visible recent context projection; pressure=${projection.pressureRatio}; toolPairingSafe=${projection.toolPairingSafe ? "yes" : "no"}`,
    `compact:${projection.boundaryId}`,
    ["context_compact_boundary"],
  );
  rememberEvidence(context, evidence);
  await context.store.appendEvent(sessionId, { type: "evidence_record", ...evidence });
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
    `context_compact_failed blocked=${blocked ? "yes" : "no"} reason=${context.cache.compactFailure.reason} cooldownUntil=${context.cache.compactFailure.cooldownUntil}`,
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

function createEvidenceRecord(
  kind: EvidenceRecord["kind"],
  summary: string,
  source: string,
  supportsClaims: string[],
): EvidenceRecord {
  return {
    id: randomUUID(),
    kind,
    summary: truncateDisplay(summary.replace(/\s+/g, " "), 180),
    source,
    supportsClaims,
    createdAt: new Date().toISOString(),
  };
}

function rememberEvidence(context: TuiContext, evidence: EvidenceRecord): void {
  context.evidence.unshift(evidence);
  context.evidence = context.evidence.slice(0, MAX_EVIDENCE_RECORDS);
}

export function getProviderContextMaxChars(
  context: TuiContext,
  runtime: CompactPreflightRuntime,
): number {
  const route = getRoleRoute(context.config, runtime.role);
  const known = findKnownModel(runtime.model);
  const maxInputTokens =
    route.maxInputTokens ??
    Math.max(
      1,
      (known?.contextWindow ?? DEFAULT_CONTEXT_WINDOW_TOKENS) -
        (route.maxOutputTokens ??
          context.config.providers[runtime.provider]?.maxOutputTokens ??
          CONTEXT_INPUT_HEADROOM_TOKENS),
    );
  return Math.max(1, maxInputTokens * CONTEXT_CHARS_PER_TOKEN_ESTIMATE);
}
