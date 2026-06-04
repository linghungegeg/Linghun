import { randomUUID } from "node:crypto";
import type { TranscriptEvent } from "@linghun/core";
import type { ModelGateway, ModelMessage } from "@linghun/providers";
import { type CompactBoundary, createManualCompactBoundary } from "./compact-context.js";
import type { CompactPreflightRuntime } from "./compact-preflight-runtime.js";
import { estimateTranscriptContextChars } from "./context-estimator.js";
import type { FailureLearningInput } from "./failure-learning-runtime.js";
import type { TuiContext } from "./index.js";
import { formatIndexRuntimeRef } from "./index-runtime.js";
import {
  sanitizeDiagnosticText,
  sanitizeDisplayPaths,
  truncateDisplay,
} from "./startup-runtime.js";
import type { DeepCompactPacket, DeepCompactTrigger } from "./tui-data-types.js";

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

export async function maybeRunDeepCompactBeforeProvider(input: {
  context: TuiContext;
  sessionId: string;
  runtime: CompactPreflightRuntime;
  trigger: DeepCompactTrigger;
  gateway?: ModelGateway;
  deps: DeepCompactRuntimeDeps;
}): Promise<DeepCompactRunResult> {
  if (!input.gateway) {
    return failMessage(input.context, "Deep compact unavailable: model gateway is not ready.");
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
    gateway: input.gateway,
  });
}

export async function runDeepCompact(input: {
  context: TuiContext;
  sessionId: string;
  transcript: TranscriptEvent[];
  runtime: CompactPreflightRuntime;
  trigger: DeepCompactTrigger;
  gateway: ModelGateway;
  deps: DeepCompactRuntimeDeps;
}): Promise<DeepCompactRunResult> {
  const now = Date.now();
  if (input.context.cache.compactCooldownUntil && input.context.cache.compactCooldownUntil > now) {
    return failMessage(
      input.context,
      "Deep compact is cooling down after a previous compact failure.",
    );
  }

  const controller = new AbortController();
  const requestMessages = buildDeepCompactRequestMessages(
    input.context,
    input.transcript,
    input.trigger,
  );
  let summary = "";
  try {
    for await (const event of input.gateway.stream(
      input.runtime.provider,
      {
        messages: requestMessages,
        model: input.runtime.model,
        toolChoice: "none",
      },
      controller.signal,
    )) {
      if (event.type === "assistant_text_delta") {
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
    const reason = error instanceof Error ? error.message : String(error);
    await recordDeepCompactFailure(input.context, input.sessionId, reason, input.deps);
    return failMessage(input.context, "Deep compact failed before provider request.");
  }

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
  input.context.cache.deepCompact = packet;
  input.context.cache.compacted = true;
  input.context.cache.compactFailure = undefined;
  input.context.cache.compactCooldownUntil = undefined;
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
  return { ok: true, packet };
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
    `[Deep compact ${packet.id}]`,
    `kind ${packet.kind}`,
    `scope ${packet.scope}`,
    `trigger ${packet.trigger}`,
    `created at ${packet.createdAt}`,
    `provider ${packet.provider}`,
    `model ${packet.model}`,
    `summary ${packet.summary}`,
    `preserved evidence refs ${packet.preservedEvidenceRefs.join(", ") || "none"}`,
    `preserved files ${packet.preservedFiles.join(", ") || "none"}`,
    `active agents/workflows ${packet.activeAgentsWorkflows.join("; ") || "none"}`,
    `needs-attention agents/workflows ${packet.needsAttentionAgentsWorkflows?.join("; ") || "none"}`,
    `stale resumable agents/workflows ${packet.staleResumableAgentsWorkflows?.join("; ") || "none"}`,
    `pending items ${packet.pendingItems.join("; ") || "none"}`,
    `decisions ${packet.decisions.join("; ") || "none"}`,
    `risks ${packet.risks.join("; ") || "none"}`,
    "anti hallucination: Use deep compact only for context continuity; never treat it as PASS engineering evidence.",
  ].join("\n");
}

export function injectDeepCompactSummary(
  messages: ModelMessage[],
  packet: DeepCompactPacket | undefined,
): ModelMessage[] {
  const summary = formatDeepCompactPromptSummary(packet);
  if (!summary) return messages;
  const summaryMessage: ModelMessage = {
    role: "user",
    content: summary,
  };
  if (messages[0]?.role === "system") {
    return [messages[0], summaryMessage, ...messages.slice(1)];
  }
  return [summaryMessage, ...messages];
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

function buildDeepCompactRequestMessages(
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
    `event type counts: ${[...eventTypeCounts.entries()].map(([type, count]) => `${type}:${count}`).join(", ") || "none"}`,
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
        `tool_start:${event.name}:${sanitizeDeepCompactText(context, JSON.stringify(event.input), 220)}`,
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
        /fail|failure|failed|compact|cooldown|risk|decision|scope|blocked|失败|风险|阻断/iu.test(
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
  return /decid|decision|choose|chosen|plan|will|must|should|done|fixed|blocked|risk|决定|选择|计划|必须|应该|已|阻断|风险/iu.test(
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
  return JSON.stringify(content);
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
  const redacted = singleLine
    .replace(
      /(api[_-]?key|apiKey|token|Authorization)(\s*[:=]\s*)(Bearer\s+)?[^\s;&,)}\]]+/giu,
      (_match, key: string, sep: string) => `${key}${sep}***`,
    )
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/giu, "Bearer ***")
    .replace(/sk-[A-Za-z0-9_-]+/gu, "sk-***")
    .replace(/[A-Z]:[\\/][^\s"')\]}]+/gu, "[local-path]");
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
  context.cache.compactCooldownUntil = cooldownUntilMs;
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
            .replace(
              "Deep compact failed before provider request.",
              "Deep compact 在 provider 请求前失败。",
            ),
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
