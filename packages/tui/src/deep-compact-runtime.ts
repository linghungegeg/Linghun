import { randomUUID } from "node:crypto";
import type { TranscriptEvent } from "@linghun/core";
import type { ModelGateway, ModelMessage, ModelRequest } from "@linghun/providers";
import { redactCommonSecrets } from "@linghun/shared";
import {
  applyCacheWritePolicyToRequest,
  recordCacheRequestObservation,
  recordCacheUsageObservation,
  resolveCachePolicy,
} from "./cache-policy-runtime.js";
import { type CompactBoundary, createManualCompactBoundary } from "./compact-context.js";
import type { CompactPreflightRuntime } from "./compact-preflight-runtime.js";
import { estimateTranscriptContextChars, stringifyValueWithinBudget } from "./context-estimator.js";
import type { FailureLearningInput } from "./failure-learning-runtime.js";
import { formatIndexRuntimeRef } from "./index-runtime.js";
import type { TuiContext } from "./index.js";
import { recordMetaOrchestrationRuntimeEvent } from "./meta-orchestration-runtime.js";
import { withProviderRetry } from "./provider-circuit-breaker.js";
import {
  sanitizeDiagnosticText,
  sanitizeDisplayPaths,
  truncateDisplay,
} from "./startup-runtime.js";
import type {
  CompactProgressSnapshot,
  CompactProgressStage,
  DeepCompactPacket,
  DeepCompactTrigger,
} from "./tui-data-types.js";

export type DeepCompactRuntimeDeps = {
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
  refreshCacheFreshness: (context: TuiContext) => void;
  recordCompactBoundary: (context: TuiContext, boundary: CompactBoundary) => void;
};

export type DeepCompactRunResult =
  | { ok: true; packet: DeepCompactPacket }
  | { ok: false; message: string };

export const DEEP_COMPACT_EVENT_TYPE = "deep_compact_packet" as const;

const DEEP_COMPACT_FAILURE_COOLDOWN_MS = 2 * 60 * 1000;
const DEEP_COMPACT_SUMMARY_MAX_CHARS = 4_000;
const DEEP_COMPACT_RERUN_EVENT_THRESHOLD = 40;
const RECENT_TRANSCRIPT_TAIL_EVENTS = 24;
const EVENT_TEXT_LIMIT = 420;
const VERBATIM_USER_MESSAGE_LIMIT = 6;
const TOOL_RESULT_SUMMARY_LIMIT = 12;
const CODE_SNIPPET_LIMIT = 8;
const CODE_SNIPPET_TEXT_LIMIT = 360;

export function createDeepCompactProgress(): CompactProgressSnapshot {
  return {
    status: "running",
    stages: ["scan_context"],
    preCompactChars: 0,
    postCompactChars: 0,
  };
}

export async function maybeRunDeepCompactBeforeProvider(input: {
  context: TuiContext;
  sessionId: string;
  runtime: CompactPreflightRuntime;
  trigger: DeepCompactTrigger;
  gateway?: ModelGateway;
  signal?: AbortSignal;
  deps: DeepCompactRuntimeDeps;
}): Promise<DeepCompactRunResult> {
  if (!input.gateway) {
    return failMessage(input.context, "Deep compact unavailable: model gateway is not ready.");
  }
  const existing = input.context.deepCompactInFlight;
  if (existing?.sessionId === input.sessionId) {
    return waitForDeepCompact(input.context, existing.promise, input.signal);
  }
  const progress = input.context.cache.compactProgress ? undefined : createDeepCompactProgress();
  if (progress) {
    input.context.cache.compactProgress = progress;
    input.context.shellRerender?.();
  }
  const run = runDeepCompactIfNeeded({ ...input, gateway: input.gateway });
  input.context.deepCompactInFlight = { sessionId: input.sessionId, promise: run };
  try {
    return await waitForDeepCompact(input.context, run, input.signal);
  } finally {
    if (input.context.deepCompactInFlight?.promise === run) {
      input.context.deepCompactInFlight = undefined;
    }
    if (progress && input.context.cache.compactProgress === progress) {
      input.context.cache.compactProgress = undefined;
      input.context.shellRerender?.();
    }
  }
}

async function runDeepCompactIfNeeded(input: {
  context: TuiContext;
  sessionId: string;
  runtime: CompactPreflightRuntime;
  trigger: DeepCompactTrigger;
  gateway: ModelGateway;
  signal?: AbortSignal;
  deps: DeepCompactRuntimeDeps;
}): Promise<DeepCompactRunResult> {
  const reusablePacket = await getReusableDeepCompactPacketFromTail(
    input.context,
    input.sessionId,
    input.trigger,
  );
  if (reusablePacket) {
    return { ok: true, packet: reusablePacket };
  }

  const resumed = await input.context.store.resume(input.sessionId);
  if (!shouldRunDeepCompact(input.context, resumed.transcript, input.trigger)) {
    return input.context.cache.deepCompact
      ? { ok: true, packet: input.context.cache.deepCompact }
      : failMessage(input.context, "Deep compact skipped: transcript pressure is below trigger.");
  }
  return runDeepCompact({
    ...input,
    transcript: resumed.transcript,
    signal: input.signal,
  });
}

async function getReusableDeepCompactPacketFromTail(
  context: TuiContext,
  sessionId: string,
  trigger: DeepCompactTrigger,
): Promise<DeepCompactPacket | undefined> {
  const packet = context.cache.deepCompact;
  if (!packet || trigger === "manual" || trigger === "workflow") return undefined;

  try {
    const recent = await context.store.readRecentTranscriptEvents(sessionId, {
      limit: DEEP_COMPACT_RERUN_EVENT_THRESHOLD + 1,
    });
    return recent.events.some((event) => event.type === DEEP_COMPACT_EVENT_TYPE)
      ? packet
      : undefined;
  } catch {
    return undefined;
  }
}

function waitForDeepCompact(
  context: TuiContext,
  promise: Promise<DeepCompactRunResult>,
  signal?: AbortSignal,
): Promise<DeepCompactRunResult> {
  if (!signal) return promise;
  if (signal.aborted)
    return Promise.resolve(failMessage(context, "Deep compact cancelled by user interrupt."));
  return Promise.race([
    promise,
    new Promise<DeepCompactRunResult>((resolve) => {
      const onAbort = () =>
        resolve(failMessage(context, "Deep compact cancelled by user interrupt."));
      signal.addEventListener("abort", onAbort, { once: true });
      promise.finally(() => signal.removeEventListener("abort", onAbort));
    }),
  ]);
}

export async function runDeepCompact(input: {
  context: TuiContext;
  sessionId: string;
  transcript: TranscriptEvent[];
  runtime: CompactPreflightRuntime;
  trigger: DeepCompactTrigger;
  gateway: ModelGateway;
  signal?: AbortSignal;
  deps: DeepCompactRuntimeDeps;
}): Promise<DeepCompactRunResult> {
  const now = Date.now();
  if (
    input.context.cache.deepCompactCooldownUntil &&
    input.context.cache.deepCompactCooldownUntil > now
  ) {
    return failMessage(
      input.context,
      "Deep compact is cooling down after a previous compact failure.",
    );
  }

  const requestMessages = buildDeepCompactRequestMessages(
    input.context,
    input.transcript,
    input.trigger,
  );
  const signal = input.signal ?? new AbortController().signal;
  const providerRequest: ModelRequest = applyCacheWritePolicyToRequest(
    {
      messages: requestMessages,
      model: input.runtime.model,
      requestContext: "agent",
      requestContextId: input.context.runtimeContextId,
      sessionId: input.sessionId,
      toolChoice: "none",
    },
    resolveCachePolicy("deep-compact"),
  );
  recordCacheRequestObservation(
    input.context.cache,
    "deep-compact",
    input.runtime.provider,
    providerRequest,
  );
  advanceDeepCompactProgress(input.context, "scan_context");
  await recordMetaOrchestrationRuntimeEvent(input.context, input.sessionId, {
    stepId: "compact-context",
    executor: "compact-runtime",
    status: "consumed",
    summary: `deep compact trigger=${input.trigger}; messages=${requestMessages.length}`,
  });
  await recordMetaOrchestrationRuntimeEvent(input.context, input.sessionId, {
    stepId: "provider-request",
    executor: "provider-runtime",
    status: "consumed",
    summary: `deep compact provider=${input.runtime.provider}; model=${input.runtime.model}`,
  });
  let summary = "";
  try {
    for await (const event of withProviderRetry(
      input.gateway,
      input.context.providerBreaker,
      input.runtime.provider,
      providerRequest,
      signal,
      { cooldownScope: "sidechain" },
    )) {
      if (signal.aborted) {
        return failMessage(input.context, "Deep compact cancelled by user interrupt.");
      }
      if (event.type === "assistant_text_delta") {
        advanceDeepCompactProgress(input.context, "generate_summary");
        summary += event.text;
        continue;
      }
      if (event.type === "tool_use") {
        await recordDeepCompactFailure(
          input.context,
          input.sessionId,
          `compact_agent_tool_use_blocked:${event.name}`,
          input.deps,
        );
        return failMessage(
          input.context,
          "Deep compact failed because compact agent attempted tool_use while tools are disabled.",
        );
      }
      if (event.type === "usage") {
        recordCacheUsageObservation(input.context.cache, event.usage, "deep-compact");
        continue;
      }
      if (event.type === "error") {
        await recordDeepCompactFailure(
          input.context,
          input.sessionId,
          `compact_agent_error:${event.error.code}:${event.error.message}`,
          input.deps,
        );
        return failMessage(input.context, "Deep compact provider request failed.");
      }
    }
  } catch (error) {
    if (signal.aborted) {
      return failMessage(input.context, "Deep compact cancelled by user interrupt.");
    }
    const reason = error instanceof Error ? error.message : String(error);
    await recordDeepCompactFailure(input.context, input.sessionId, reason, input.deps);
    return failMessage(input.context, "Deep compact failed before provider request.");
  }

  advanceDeepCompactProgress(input.context, "trim_old_records");
  const packet = createDeepCompactPacket({
    context: input.context,
    transcript: input.transcript,
    summary,
    runtime: input.runtime,
    trigger: input.trigger,
  });
  const preChars = estimateTranscriptContextChars(input.transcript);
  const boundary = createManualCompactBoundary({
    preCompactChars: preChars,
    postCompactChars: Math.min(preChars, packet.summary.length),
    preservedEvidenceRefs: packet.preservedEvidenceRefs,
    preservedFiles: packet.preservedFiles,
    handoffPacketId: input.context.memory.lastHandoff?.id,
  });
  input.deps.recordCompactBoundary(input.context, boundary);
  await projectDeepCompactMainScreen(input.context, input.deps, input.sessionId);
  advanceDeepCompactProgress(input.context, "restore_context");
  input.context.cache.deepCompact = packet;
  input.context.cache.compacted = true;
  input.context.cache.compactFailure = undefined;
  input.context.cache.deepCompactCooldownUntil = undefined;
  input.deps.refreshCacheFreshness(input.context);
  await input.context.store.appendEvent(input.sessionId, {
    type: DEEP_COMPACT_EVENT_TYPE,
    packet,
    createdAt: packet.createdAt,
  } as TranscriptEvent);
  await input.deps.appendSystemEvent(
    input.context,
    input.sessionId,
    `deep compact success: id ${packet.id}; scope ${packet.scope}; trigger ${packet.trigger}`,
    "info",
  );
  await recordMetaOrchestrationRuntimeEvent(input.context, input.sessionId, {
    stepId: "compact-context",
    executor: "compact-runtime",
    status: "completed",
    summary: `packet=${packet.id}; scope=${packet.scope}; trigger=${packet.trigger}`,
  });
  await recordMetaOrchestrationRuntimeEvent(input.context, input.sessionId, {
    stepId: "provider-request",
    executor: "provider-runtime",
    status: "completed",
    summary: `deep compact provider request completed; packet=${packet.id}`,
  });
  advanceDeepCompactProgress(input.context, "complete");
  return { ok: true, packet };
}

async function projectDeepCompactMainScreen(
  context: TuiContext,
  deps: DeepCompactRuntimeDeps,
  sessionId: string,
): Promise<void> {
  try {
    await context.compactOutputMemory?.({ projectMainScreen: true });
  } catch (error) {
    await deps.appendSystemEvent(
      context,
      sessionId,
      `deep compact terminal projection failed: ${sanitizeDeepCompactText(
        context,
        error instanceof Error ? error.message : String(error),
        180,
      )}`,
      "warning",
    );
  }
}

function advanceDeepCompactProgress(context: TuiContext, stage: CompactProgressStage): void {
  const progress = context.cache.compactProgress;
  if (!progress || progress.status !== "running") return;
  if (!progress.stages.includes(stage)) {
    progress.stages.push(stage);
  }
  if (stage === "complete") {
    progress.status = "complete";
  }
  context.shellRerender?.();
}

export function shouldRunDeepCompact(
  context: TuiContext,
  transcript: TranscriptEvent[],
  trigger: DeepCompactTrigger,
): boolean {
  if (trigger === "manual" || trigger === "workflow") {
    return true;
  }
  if (context.cache.deepCompact) {
    let latestCompactIndex = -1;
    for (let index = transcript.length - 1; index >= 0; index -= 1) {
      if (transcript[index]?.type === DEEP_COMPACT_EVENT_TYPE) {
        latestCompactIndex = index;
        break;
      }
    }
    const laterEvents =
      latestCompactIndex >= 0 ? transcript.length - latestCompactIndex - 1 : transcript.length;
    return laterEvents > DEEP_COMPACT_RERUN_EVENT_THRESHOLD;
  }
  return true;
}

export function formatDeepCompactPromptSummary(
  packet: DeepCompactPacket | undefined,
): string | undefined {
  if (!packet) return undefined;
  return [
    "Deep compact context",
    `scope ${packet.scope}`,
    "role older context continuity",
    `summary ${packet.summary}`,
    `preserved evidence refs ${packet.preservedEvidenceRefs.join(", ") || "none"}`,
    `preserved files ${packet.preservedFiles.join(", ") || "none"}`,
    `narrative summary ${packet.narrativeSummary || "none"}`,
    `user messages verbatim ${packet.userMessagesVerbatim?.join("\n") || "none"}`,
    `tool result summaries ${packet.toolResultSummaries?.join("\n") || "none"}`,
    `code snippets ${packet.codeSnippets?.join("\n") || "none"}`,
    `active agents/workflows ${packet.activeAgentsWorkflows.join("; ") || "none"}`,
    `needs-attention agents/workflows ${packet.needsAttentionAgentsWorkflows?.join("; ") || "none"}`,
    `stale resumable agents/workflows ${packet.staleResumableAgentsWorkflows?.join("; ") || "none"}`,
    `pending items ${packet.pendingItems.join("; ") || "none"}`,
    `decisions ${packet.decisions.join("; ") || "none"}`,
    `risks ${packet.risks.join("; ") || "none"}`,
    "priority boundary: This deep compact is older context continuity. If it conflicts with later transcript messages or the latest user request, the later/latest request wins.",
    "anti hallucination: Use deep compact only for context continuity; never treat it as PASS engineering evidence.",
  ].join("\n");
}

export function injectDeepCompactSummary(
  messages: ModelMessage[],
  packet: DeepCompactPacket | undefined,
  additionalMessages: ModelMessage[] = [],
): ModelMessage[] {
  const summary = formatDeepCompactPromptSummary(packet);
  if (!summary) return messages;
  const summaryMessage: ModelMessage = {
    role: "user",
    content: summary,
  };
  let index = 0;
  while (messages[index]?.role === "system") index += 1;
  return [
    ...messages.slice(0, index),
    summaryMessage,
    ...additionalMessages,
    ...messages.slice(index),
  ];
}

export function insertAfterLeadingSystemMessages(
  messages: ModelMessage[],
  message: ModelMessage,
): ModelMessage[] {
  let index = 0;
  while (messages[index]?.role === "system") index += 1;
  return [...messages.slice(0, index), message, ...messages.slice(index)];
}

export function createDeepCompactPacket(input: {
  context: TuiContext;
  transcript: TranscriptEvent[];
  summary: string;
  runtime: CompactPreflightRuntime;
  trigger: DeepCompactTrigger;
}): DeepCompactPacket {
  const context = input.context;
  return {
    id: `deep-${randomUUID().slice(0, 8)}`,
    kind: "deep",
    scope: "full transcript semantic compact",
    summary: sanitizeDeepCompactText(
      context,
      input.summary.trim() || synthesizeFallbackSummary(context, input.transcript),
      DEEP_COMPACT_SUMMARY_MAX_CHARS,
    ),
    preservedEvidenceRefs: unique(context.evidence.map((item) => item.id)).slice(0, 20),
    preservedFiles: unique([
      ...context.recentlyMentionedFiles,
      ...context.tools.changedFiles,
      ...context.evidence
        .map((item) => item.source)
        .filter((source) => source.includes(".") || source.includes("/")),
    ])
      .map((file) => sanitizeDeepCompactText(context, file, 180))
      .slice(0, 20),
    narrativeSummary: sanitizeDeepCompactText(
      context,
      input.summary.trim() || synthesizeFallbackSummary(context, input.transcript),
      1_200,
    ),
    userMessagesVerbatim: collectUserMessagesVerbatim(context, input.transcript),
    toolResultSummaries: collectToolResultSummaries(context, input.transcript),
    codeSnippets: collectCodeSnippets(context, input.transcript),
    activeAgentsWorkflows: collectActiveAgentsWorkflows(context),
    needsAttentionAgentsWorkflows: collectNeedsAttentionAgentsWorkflows(context),
    staleResumableAgentsWorkflows: collectStaleResumableAgentsWorkflows(context),
    pendingItems: collectPendingItems(context),
    decisions: collectDecisions(context),
    risks: collectRisks(context),
    createdAt: new Date().toISOString(),
    model: input.runtime.model,
    provider: input.runtime.provider,
    trigger: input.trigger,
    transcriptEventCount: input.transcript.length,
  };
}

export function isDeepCompactPacket(value: unknown): value is DeepCompactPacket {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    obj.kind === "deep" &&
    obj.scope === "full transcript semantic compact" &&
    typeof obj.id === "string" &&
    typeof obj.summary === "string" &&
    Array.isArray(obj.preservedEvidenceRefs) &&
    Array.isArray(obj.preservedFiles) &&
    Array.isArray(obj.activeAgentsWorkflows) &&
    Array.isArray(obj.pendingItems) &&
    Array.isArray(obj.decisions) &&
    Array.isArray(obj.risks) &&
    typeof obj.createdAt === "string" &&
    typeof obj.model === "string" &&
    typeof obj.provider === "string" &&
    typeof obj.trigger === "string"
  );
}

export function buildDeepCompactRequestMessages(
  context: TuiContext,
  transcript: TranscriptEvent[],
  trigger: DeepCompactTrigger,
): ModelMessage[] {
  const outline = buildFullTranscriptSemanticOutline(context, transcript);
  const state = [
    `trigger ${trigger}`,
    `transcript events ${transcript.length}`,
    `project rules ${sanitizeDeepCompactText(context, context.memory.projectRulesSummary || "none", 300)}`,
    `index ${formatIndexRuntimeRef(context.index)}`,
    `cache freshness ${context.cache.lastFreshness?.changedKeys.join(", ") || "stable or unknown"}`,
    `accepted memory ${context.memory.accepted.length}`,
    `failure learning ${
      context.failureLearning.records
        .slice(0, 5)
        .map((item) => sanitizeDeepCompactText(context, item.avoidNextTime, 180))
        .join("; ") || "none"
    }`,
  ];
  return [
    {
      role: "system",
      content: [
        "You are Linghun's deep context compact agent.",
        "Summarize the full transcript semantically for a coding assistant resume/provider prompt.",
        "Do not call tools. Do not request tools. Return text only.",
        "Preserve: user goal, latest task, decisions, files/evidence refs, tool result summaries, agent/workflow state, failures, memory/cache/index freshness, and pending permissions.",
        "Do not include secrets, absolute local paths, raw provider requests, or raw oversized tool results.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        "Create a concise deep compact summary from this deterministic full-transcript semantic outline.",
        state.join("\n"),
        outline.join("\n\n"),
      ].join("\n\n"),
    },
  ];
}

function buildFullTranscriptSemanticOutline(
  context: TuiContext,
  transcript: TranscriptEvent[],
): string[] {
  const userMessages: string[] = [];
  const assistantDecisions: string[] = [];
  const toolSummaries: string[] = [];
  const evidenceRefs: string[] = [];
  const changedOrPreservedFiles: string[] = [];
  const agentWorkflowEvents: string[] = [];
  const verificationFailures: string[] = [];
  const permissionsTodos: string[] = [];
  const eventTypeCounts = new Map<string, number>();

  for (const event of transcript) {
    eventTypeCounts.set(event.type, (eventTypeCounts.get(event.type) ?? 0) + 1);
    collectOutlineEvent(context, event, {
      userMessages,
      assistantDecisions,
      toolSummaries,
      evidenceRefs,
      changedOrPreservedFiles,
      agentWorkflowEvents,
      verificationFailures,
      permissionsTodos,
    });
  }

  const firstUser = transcript.find((event) => event.type === "user_message");
  const latestUser = findLatestEvent(transcript, "user_message");
  const recentTail = transcript
    .slice(-RECENT_TRANSCRIPT_TAIL_EVENTS)
    .map((event) => summarizeTranscriptEvent(context, event));

  return [
    "Full transcript semantic outline:",
    `event type counts: ${Array.from(eventTypeCounts.entries()).map(([type, count]) => `${type}:${count}`).join(", ") || "none"}`,
    `first user goal: ${firstUser?.type === "user_message" ? sanitizeDeepCompactText(context, firstUser.text, EVENT_TEXT_LIMIT) : "none"}`,
    `latest user goal: ${latestUser?.type === "user_message" ? sanitizeDeepCompactText(context, latestUser.text, EVENT_TEXT_LIMIT) : "none"}`,
    formatOutlineSection("key user requirements", userMessages, 24),
    formatOutlineSection("assistant decisions", assistantDecisions, 24),
    formatOutlineSection("tool calls and results", toolSummaries, 28),
    formatOutlineSection("evidence refs", evidenceRefs, 20),
    formatOutlineSection("changed or preserved files", changedOrPreservedFiles, 20),
    formatOutlineSection("agent workflow events", agentWorkflowEvents, 20),
    formatOutlineSection("verification and failure learning", verificationFailures, 20),
    formatOutlineSection("pending permissions and todos", permissionsTodos, 20),
    `recent tail: ${recentTail.join("\n") || "none"}`,
  ];
}

function collectOutlineEvent(
  context: TuiContext,
  event: TranscriptEvent,
  buckets: {
    userMessages: string[];
    assistantDecisions: string[];
    toolSummaries: string[];
    evidenceRefs: string[];
    changedOrPreservedFiles: string[];
    agentWorkflowEvents: string[];
    verificationFailures: string[];
    permissionsTodos: string[];
  },
): void {
  switch (event.type) {
    case "user_message":
      pushEarlyAndRecent(
        buckets.userMessages,
        `user:${sanitizeDeepCompactText(context, event.text, EVENT_TEXT_LIMIT)}`,
      );
      break;
    case "assistant_text_delta":
      if (looksLikeDecision(event.text)) {
        pushEarlyAndRecent(
          buckets.assistantDecisions,
          `assistant:${sanitizeDeepCompactText(context, event.text, EVENT_TEXT_LIMIT)}`,
        );
      }
      break;
    case "tool_call_start":
      pushEarlyAndRecent(
        buckets.toolSummaries,
        `tool_start:${event.name}:${sanitizeDeepCompactText(context, stringifyValueWithinBudget(event.input, 221) ?? "[unserializable]", 220)}`,
      );
      break;
    case "tool_result":
      pushEarlyAndRecent(buckets.toolSummaries, summarizeTranscriptEvent(context, event));
      if (event.evidenceId) {
        pushEarlyAndRecent(buckets.evidenceRefs, `evidence:${event.evidenceId}`);
      }
      break;
    case "tool_call_end":
      pushEarlyAndRecent(buckets.toolSummaries, summarizeTranscriptEvent(context, event));
      if (event.output.fullOutputPath) {
        pushEarlyAndRecent(buckets.changedOrPreservedFiles, "tool_output_artifact:[artifact]");
      }
      for (const file of event.output.changedFiles ?? []) {
        pushEarlyAndRecent(
          buckets.changedOrPreservedFiles,
          sanitizeDeepCompactText(context, file, 180),
        );
      }
      break;
    case "evidence_record":
      pushEarlyAndRecent(
        buckets.evidenceRefs,
        `${event.id}:${event.kind}:${sanitizeDeepCompactText(context, event.summary, EVENT_TEXT_LIMIT)}`,
      );
      pushEarlyAndRecent(
        buckets.changedOrPreservedFiles,
        sanitizeDeepCompactText(context, event.source, 180),
      );
      break;
    case "agent_start":
    case "agent_end":
    case "workflow_start":
    case "workflow_step_result":
    case "workflow_end":
      pushEarlyAndRecent(buckets.agentWorkflowEvents, summarizeTranscriptEvent(context, event));
      break;
    case "verification_end":
      pushEarlyAndRecent(buckets.verificationFailures, summarizeTranscriptEvent(context, event));
      break;
    case "system_event":
      if (
        /fail|failure|failed|compact|cooldown|risk|decision|scope|blocked|失败|风险|阻断/i.test(
          event.message,
        )
      ) {
        pushEarlyAndRecent(buckets.verificationFailures, summarizeTranscriptEvent(context, event));
      }
      break;
    case "permission_request":
    case "permission_result":
    case "todo_update":
      pushEarlyAndRecent(buckets.permissionsTodos, summarizeTranscriptEvent(context, event));
      break;
    default:
      break;
  }
}

function pushEarlyAndRecent(items: string[], value: string, maxItems = 48): void {
  if (!value) return;
  if (items.length < maxItems) {
    items.push(value);
    return;
  }
  const recentReserve = Math.max(1, Math.floor(maxItems / 3));
  items.splice(maxItems - recentReserve, 1);
  items.push(value);
}

function formatOutlineSection(name: string, items: string[], maxItems: number): string {
  if (items.length === 0) return `${name}: none`;
  const shown = items.slice(0, maxItems);
  const omitted = Math.max(0, items.length - shown.length);
  return `${name}: ${shown.join("\n")}${omitted > 0 ? `\n${name} omitted: ${omitted}` : ""}`;
}

function findLatestEvent<T extends TranscriptEvent["type"]>(
  transcript: TranscriptEvent[],
  type: T,
): Extract<TranscriptEvent, { type: T }> | undefined {
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const event = transcript[index];
    if (event?.type === type) {
      return event as Extract<TranscriptEvent, { type: T }>;
    }
  }
  return undefined;
}

function looksLikeDecision(text: string): boolean {
  return /decid|decision|choose|chosen|plan|will|must|should|done|fixed|blocked|risk|决定|选择|计划|必须|应该|已|阻断|风险/i.test(
    text,
  );
}

function summarizeTranscriptEvent(context: TuiContext, event: TranscriptEvent): string {
  switch (event.type) {
    case "user_message":
      return `user:${sanitizeDeepCompactText(context, event.text, EVENT_TEXT_LIMIT)}`;
    case "assistant_text_delta":
      return `assistant:${sanitizeDeepCompactText(context, event.text, EVENT_TEXT_LIMIT)}`;
    case "tool_call_start":
      return `tool_start:${event.name}:${sanitizeDeepCompactText(context, JSON.stringify(event.input), 220)}`;
    case "tool_result":
      return `tool_result:${event.toolName}:is error ${event.isError ? "yes" : "no"}; evidence ${event.evidenceId ?? "none"}; summary ${sanitizeDeepCompactText(context, summarizeToolResultContent(event.content), EVENT_TEXT_LIMIT)}`;
    case "tool_call_end":
      return `tool_end:${event.id}:truncated ${event.output.truncated ? "yes" : "no"}; full output path ${event.output.fullOutputPath ? "[artifact]" : "none"}; summary ${sanitizeDeepCompactText(context, event.output.text, EVENT_TEXT_LIMIT)}`;
    case "verification_end":
      return `verification:${event.report.status}:${sanitizeDeepCompactText(context, event.report.summary, EVENT_TEXT_LIMIT)}`;
    case "todo_update":
      return `todos:${event.items.map((item) => `${item.status}:${sanitizeDeepCompactText(context, item.content, 80)}`).join("; ")}`;
    case "background_task_update":
      return `background:${event.task.kind}:${event.task.status}:${sanitizeDeepCompactText(context, event.task.userVisibleSummary, EVENT_TEXT_LIMIT)}`;
    case "agent_start":
      return `agent_start:${sanitizeDeepCompactText(context, JSON.stringify(event.agent), EVENT_TEXT_LIMIT)}`;
    case "agent_end":
      return `agent_end:${event.status}:${sanitizeDeepCompactText(context, event.summary, EVENT_TEXT_LIMIT)}`;
    case "workflow_start":
      return `workflow_start:${sanitizeDeepCompactText(context, JSON.stringify(event.workflow), EVENT_TEXT_LIMIT)}`;
    case "workflow_step_result":
      return `workflow_step:${event.status}:${sanitizeDeepCompactText(context, event.summary, EVENT_TEXT_LIMIT)} evidence ${event.evidenceRefs.join(",")}`;
    case "workflow_end":
      return `workflow_end:${event.status}:${sanitizeDeepCompactText(context, event.summary, EVENT_TEXT_LIMIT)}`;
    case "permission_request":
      return `permission_request:${event.request.toolName}:${event.request.risk}:${sanitizeDeepCompactText(context, event.request.summary, 220)}`;
    case "permission_result":
      return `permission_result:${event.decision}:${sanitizeDeepCompactText(context, event.reason, 160)}`;
    case DEEP_COMPACT_EVENT_TYPE:
      return "deep_compact_packet:previous summary exists";
    case "system_event":
      return `system:${event.level}:${sanitizeDeepCompactText(context, event.message, EVENT_TEXT_LIMIT)}`;
    default:
      return `${event.type}:${sanitizeDeepCompactText(context, JSON.stringify(event), 220)}`;
  }
}

function summarizeToolResultContent(content: unknown): string {
  if (typeof content === "string") return content;
  return stringifyValueWithinBudget(content, EVENT_TEXT_LIMIT) ?? "[unserializable]";
}

function collectUserMessagesVerbatim(context: TuiContext, transcript: TranscriptEvent[]): string[] {
  return transcript
    .filter((event): event is Extract<TranscriptEvent, { type: "user_message" }> => event.type === "user_message")
    .slice(-VERBATIM_USER_MESSAGE_LIMIT)
    .map((event) => sanitizeDeepCompactText(context, event.text, EVENT_TEXT_LIMIT));
}

function collectToolResultSummaries(context: TuiContext, transcript: TranscriptEvent[]): string[] {
  return transcript
    .filter((event): event is Extract<TranscriptEvent, { type: "tool_result" | "tool_call_end" }> =>
      event.type === "tool_result" || event.type === "tool_call_end",
    )
    .slice(-TOOL_RESULT_SUMMARY_LIMIT)
    .map((event) => summarizeTranscriptEvent(context, event));
}

function collectCodeSnippets(context: TuiContext, transcript: TranscriptEvent[]): string[] {
  const snippets: string[] = [];
  for (const event of transcript) {
    if (event.type !== "tool_result" && event.type !== "tool_call_end") continue;
    const text = event.type === "tool_result" ? summarizeToolResultContent(event.content) : event.output.text;
    const snippet = extractCodeLikeSnippet(text);
    if (!snippet) continue;
    pushEarlyAndRecent(
      snippets,
      sanitizeDeepCompactText(context, snippet, CODE_SNIPPET_TEXT_LIMIT),
      CODE_SNIPPET_LIMIT,
    );
  }
  return snippets;
}

function extractCodeLikeSnippet(value: string): string | undefined {
  const fenced = value.match(/```[\s\S]*?```/)?.[0];
  if (fenced) return fenced;
  const lines = value.split(/\r?\n/).filter((line) => {
    const trimmed = line.trim();
    return (
      trimmed.startsWith("+") ||
      trimmed.startsWith("-") ||
      trimmed.startsWith("@@") ||
      /\b(function|class|const|let|type|interface|export|import)\b/.test(trimmed)
    );
  });
  return lines.length > 0 ? lines.slice(0, 12).join("\n") : undefined;
}

function synthesizeFallbackSummary(context: TuiContext, transcript: TranscriptEvent[]): string {
  const latestUser = [...transcript].reverse().find((event) => event.type === "user_message");
  const latestAssistant = [...transcript]
    .reverse()
    .find((event) => event.type === "assistant_text_delta");
  const evidence = context.evidence
    .slice(0, 5)
    .map((item) => `${item.id}:${item.summary}`)
    .join("; ");
  return [
    `User goal/latest task: ${latestUser?.type === "user_message" ? latestUser.text : "continue current coding task"}`,
    `Latest assistant state: ${latestAssistant?.type === "assistant_text_delta" ? latestAssistant.text : "none"}`,
    `Evidence refs: ${evidence || "none"}`,
  ].join("\n");
}

export function sanitizeDeepCompactText(
  context: Pick<TuiContext, "projectPath">,
  value: string,
  maxChars: number,
): string {
  const singleLine = value.replace(/\s+/g, " ");
  const redacted = redactCommonSecrets(singleLine).replace(
    /[A-Z]:[\\/][^\s"')\]}]+/g,
    "[local-path]",
  );
  return truncateDisplay(
    sanitizeDisplayPaths(sanitizeDiagnosticText(redacted), context.projectPath),
    maxChars,
  );
}

function collectActiveAgentsWorkflows(context: TuiContext): string[] {
  return [
    ...context.agents
      .filter((agent) => agent.status === "running")
      .map(
        (agent) =>
          `agent:${agent.id}:${agent.status}:${sanitizeDeepCompactText(context, agent.summary || agent.task, 140)}`,
      ),
    ...context.backgroundTasks
      .filter((task) => task.status === "running")
      .map(
        (task) =>
          `${task.kind}:${task.id}:${task.status}:${sanitizeDeepCompactText(context, task.userVisibleSummary, 140)}`,
      ),
  ].slice(0, 12);
}

function collectNeedsAttentionAgentsWorkflows(context: TuiContext): string[] {
  return [
    ...context.agents
      .filter((agent) => agent.status === "blocked")
      .map(
        (agent) =>
          `agent:${agent.id}:${agent.status}:${sanitizeDeepCompactText(context, agent.summary || agent.task, 140)}`,
      ),
    ...context.backgroundTasks
      .filter((task) => task.status === "paused" || task.status === "blocked")
      .map(
        (task) =>
          `${task.kind}:${task.id}:${task.status}:${sanitizeDeepCompactText(context, task.userVisibleSummary, 140)}`,
      ),
  ].slice(0, 12);
}

function collectStaleResumableAgentsWorkflows(context: TuiContext): string[] {
  return [
    ...context.agents
      .filter((agent) => agent.status === "stale")
      .map(
        (agent) =>
          `agent:${agent.id}:${agent.status}:${sanitizeDeepCompactText(context, agent.summary || agent.task, 140)}`,
      ),
    ...context.backgroundTasks
      .filter((task) => task.status === "stale")
      .map(
        (task) =>
          `${task.kind}:${task.id}:${task.status}:${sanitizeDeepCompactText(context, task.userVisibleSummary, 140)}`,
      ),
  ].slice(0, 12);
}

function collectPendingItems(context: TuiContext): string[] {
  return [
    context.pendingLocalApproval
      ? `pending local approval:${context.pendingLocalApproval.kind}`
      : "",
    context.pendingNaturalCommand ? "pending natural command" : "",
    context.pendingAutopilot ? "pending autopilot" : "",
    ...context.tools.todos
      .filter((todo) => todo.status !== "completed")
      .map((todo) => `todo:${todo.status}:${sanitizeDeepCompactText(context, todo.content, 140)}`),
  ]
    .filter(Boolean)
    .slice(0, 16);
}

function collectDecisions(context: TuiContext): string[] {
  return context.routeDecisions
    .slice(0, 8)
    .map(
      (item) =>
        `${item.role}:${item.selectedProvider || "paused"}/${item.selectedModel || "paused"} fallback ${item.fallbackUsed ? "yes" : "no"}`,
    );
}

function collectRisks(context: TuiContext): string[] {
  return [
    "Deep compact is context continuity only, not PASS engineering evidence.",
    context.cache.compactFailure ? `compactFailure:${context.cache.compactFailure.reason}` : "",
    ...context.failureLearning.records
      .filter((item) => item.status === "active")
      .slice(0, 5)
      .map(
        (item) => `${item.category}:${sanitizeDeepCompactText(context, item.avoidNextTime, 160)}`,
      ),
  ].filter(Boolean);
}

async function recordDeepCompactFailure(
  context: TuiContext,
  sessionId: string,
  reason: string,
  deps: DeepCompactRuntimeDeps,
): Promise<void> {
  const cooldownUntilMs = Date.now() + DEEP_COMPACT_FAILURE_COOLDOWN_MS;
  context.cache.deepCompactCooldownUntil = cooldownUntilMs;
  context.cache.compactFailure = {
    at: new Date().toISOString(),
    reason: sanitizeDeepCompactText(context, reason, 220),
    blocked: true,
    cooldownUntil: new Date(cooldownUntilMs).toISOString(),
  };
  await deps.appendSystemEvent(
    context,
    sessionId,
    `deep compact failed: blocked yes; reason ${context.cache.compactFailure.reason}; cooldown until ${context.cache.compactFailure.cooldownUntil}`,
    "warning",
  );
  await recordMetaOrchestrationRuntimeEvent(context, sessionId, {
    stepId: "compact-context",
    executor: "compact-runtime",
    status: "failed",
    summary: `deep compact failed: ${context.cache.compactFailure.reason}`,
    level: "warning",
  });
  await recordMetaOrchestrationRuntimeEvent(context, sessionId, {
    stepId: "provider-request",
    executor: "provider-runtime",
    status: "degraded",
    summary: `deep compact provider path failed: ${context.cache.compactFailure.reason}`,
    level: "warning",
  });
  await deps.captureFailureLearning(context, sessionId, {
    category: "resource_cap",
    failureSummary: "deep compact failed before provider request",
    rootCauseGuess: context.cache.compactFailure.reason,
    avoidNextTime:
      "Do not continue with partial context after deep compact failure; retry after cooldown or reduce context pressure",
    sourceRef: "system_event:deep_compact_failed",
    relatedTarget: "deep compact",
    severity: "medium",
  });
}

function failMessage(context: TuiContext, english: string): DeepCompactRunResult {
  return {
    ok: false,
    message:
      context.language === "en-US"
        ? english
        : english
            .replace(
              "Deep compact unavailable: model gateway is not ready.",
              "Deep compact 不可用：模型网关尚未就绪。",
            )
            .replace(
              "Deep compact skipped: transcript pressure is below trigger.",
              "Deep compact 已跳过：transcript 压力未达到触发线。",
            )
            .replace(
              "Deep compact is cooling down after a previous compact failure.",
              "上一次 deep compact 失败后仍在冷却中。",
            )
            .replace(
              "Deep compact failed because compact agent attempted tool_use while tools are disabled.",
              "Deep compact 失败：compact agent 在禁用工具时尝试了 tool_use。",
            )
            .replace("Deep compact provider request failed.", "Deep compact provider 请求失败。")
            .replace("Deep compact cancelled by user interrupt.", "Deep compact 已被用户中断取消。")
            .replace(
              "Deep compact failed before provider request.",
              "Deep compact 在 provider 请求前失败。",
            )
            .replace(
              "Deep compact is already running; waiting for the active compact to finish.",
              "Deep compact 正在运行，正在等待当前压缩完成。",
            ),
  };
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}
