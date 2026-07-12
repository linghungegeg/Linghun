import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  parseUsableTranscriptCompactBoundary,
  type TranscriptEvent,
} from "@linghun/core";
import { summarizeArchitectureCard } from "./architecture-runtime.js";
import { createIndexStatusSnapshot, formatIndexRuntimeRef } from "./index-runtime.js";
import type { TuiContext } from "./index.js";
import { isMemoryTombstoned, parseMemoryOrigin } from "./memory-tombstone-runtime.js";
import { recordHandoffInRuntimeLedger } from "./runtime-storage.js";
import type {
  DeepCompactPacket,
  HandoffPacket,
  MemoryCandidate,
  VerificationReport,
} from "./tui-data-types.js";
import { formatProjectRulesContext } from "./tui-memory-runtime.js";
import { getRuntimeStatusProvider } from "./tui-model-runtime.js";
import { isRecord } from "./tui-state-runtime.js";
import {
  createToolResultBudgetFingerprint,
  parseToolResultBudgetLedgerData,
  type ToolResultBudgetRecord,
} from "./tool-result-budget.js";

type PersistedEvidenceEvent = Extract<TranscriptEvent, { type: "evidence_record" }> & {
  fullOutputPath?: string;
  outputPath?: string;
  logPath?: string;
  data?: unknown;
  ownerScope?: import("./tui-data-types.js").EvidenceRecord["ownerScope"];
};
const HANDOFF_KEY_FILE_LIMIT = 12;
const DEFAULT_HANDOFF_KEY_FILES = [
  "README.md",
  "WHITEPAPER.md",
  "docs/developers/capability-runtime-app-bridge.md",
  "package.json",
  "tsconfig.json",
] as const;

export function hydrateResumeContext(context: TuiContext, transcript: TranscriptEvent[]): void {
  const latestTodo = [...transcript].reverse().find((event) => event.type === "todo_update");
  if (latestTodo?.type === "todo_update") {
    context.tools.todos = latestTodo.items.map((item) => ({ ...item }));
  }
  const latestVerification = [...transcript]
    .reverse()
    .find((event) => event.type === "verification_end");
  if (latestVerification?.type === "verification_end") {
    const report = latestVerification.report as VerificationReport;
    context.lastVerification =
      report.status === "cancelled" ||
        report.status === "stale" ||
        report.scope?.ownerAgentId ||
        report.scope?.workflowRunId
        ? undefined
        : report;
  }
  const completedEvidenceIds = new Set(
    transcript
      .filter(
        (event): event is Extract<TranscriptEvent, { type: "tool_result" }> =>
          event.type === "tool_result" && typeof event.evidenceId === "string",
      )
      .map((event) => event.evidenceId as string),
  );
  const completedToolUseIds = new Set(
    transcript
      .filter(
        (event): event is Extract<TranscriptEvent, { type: "tool_result" }> =>
          event.type === "tool_result",
      )
      .map((event) => event.toolUseId),
  );
  const evidence = transcript
    .filter(
      (event): event is PersistedEvidenceEvent =>
        event.type === "evidence_record" &&
        (!event.toolUseId ||
          completedEvidenceIds.has(event.id) ||
          isCompletedToolResultBudgetEvidence(event, completedToolUseIds)),
    )
    .slice(-10)
    .map((event) => restoreEvidenceRecord(context, event));
  context.evidence = [...evidence.reverse(), ...context.evidence].slice(0, 20);
  restoreCheckpoints(context, transcript);
  restoreToolResultBudgetLedger(context, transcript);
  const handoff = [...transcript].reverse().find((event) => event.type === "handoff_packet");
  if (handoff?.type === "handoff_packet" && isHandoffPacket(handoff.packet)) {
    context.memory.lastHandoff = sanitizeHandoffPacket(handoff.packet);
  }
  restoreSessionAcceptedMemory(context, transcript);
  restorePendingMemoryCandidates(context, transcript);
  const deepCompactBoundary = [...transcript]
    .reverse()
    .map(parseUsableTranscriptCompactBoundary)
    .find((boundary) => boundary?.kind === "deep");
  if (deepCompactBoundary?.kind === "deep") {
    context.cache.compacted = true;
    context.cache.deepCompact = deepCompactBoundary.packet as DeepCompactPacket;
  }
  const compactBoundary = [...transcript]
    .reverse()
    .map(parseUsableTranscriptCompactBoundary)
    .find((boundary) => boundary?.kind === "projection");
  if (compactBoundary?.kind === "projection" && compactBoundary.hydrationProjection) {
    const projection = compactBoundary.hydrationProjection as NonNullable<
      TuiContext["cache"]["compactProjection"]
    >;
    context.cache.compacted = true;
    context.cache.compactProjection = projection;
    if (!context.cache.compactBoundaries.some((boundary) => boundary.id === projection.boundaryId)) {
      context.cache.compactBoundaries.push({
        id: projection.boundaryId,
        kind: "micro",
        createdAt: projection.createdAt,
        preCompactTokenEstimate: Math.ceil(projection.preCompactChars / 4),
        postCompactTokenEstimate: Math.ceil(projection.postCompactChars / 4),
        compactedToolResultIds: [],
        preservedEvidenceRefs: projection.restoreContext?.evidenceRefs ?? projection.evidenceRefs,
        preservedFiles: projection.restoreContext?.keyFiles ?? [],
      });
    }
  }
}

function restoreToolResultBudgetLedger(context: TuiContext, transcript: TranscriptEvent[]): void {
  const sessionId = context.sessionId;
  if (!sessionId) return;
  const completedToolUseIds = new Set(
    transcript
      .filter(
        (event): event is Extract<TranscriptEvent, { type: "tool_result" }> =>
          event.type === "tool_result",
      )
      .map((event) => event.toolUseId),
  );
  const legacyBudgetToolUseIds = new Set<string>();
  for (const event of transcript) {
    if (event.type !== "evidence_record" || !event.toolUseId) continue;
    const evidenceEvent = event as PersistedEvidenceEvent;
    const ledger = parseToolResultBudgetLedgerData(evidenceEvent.data);
    if (
      ledger &&
      ledger.record.toolUseId === event.toolUseId &&
      completedToolUseIds.has(event.toolUseId)
    ) {
      const artifactPath = resolveProjectArtifactPath(
        context.projectPath,
        ledger.record.artifact.relativePath,
      );
      if (!artifactPath) {
        legacyBudgetToolUseIds.add(event.toolUseId);
        continue;
      }
      rememberRestoredToolResultBudgetReplacement(
        context,
        sessionId,
        ledger.replacement,
        {
          toolUseId: ledger.record.toolUseId,
          originalChars: ledger.record.originalChars,
          replacementChars: ledger.record.replacementChars,
          reason: ledger.record.reason,
          artifact: {
            ...ledger.record.artifact,
            toolUseId: ledger.record.toolUseId,
            path: artifactPath,
          },
        },
      );
      continue;
    }
    if (evidenceEvent.supportsClaims.includes("tool_result_budget")) {
      legacyBudgetToolUseIds.add(event.toolUseId);
    }
  }
  for (const event of transcript) {
    if (event.type !== "tool_result") continue;
    context.toolResultBudgetState ??= { seenIds: new Set(), replacements: new Map() };
    if (typeof event.content !== "string" || !event.content.startsWith("<persisted-tool-result>")) {
      if (legacyBudgetToolUseIds.has(event.toolUseId)) {
        context.toolResultBudgetState.forcedToolUseIds ??= new Set();
        context.toolResultBudgetState.forcedToolUseIds.add(event.toolUseId);
        continue;
      }
      const providerContent = JSON.stringify({
        tool: event.toolName,
        isError: event.isError ?? false,
        evidenceId: event.evidenceId,
        content: event.content,
      });
      context.toolResultBudgetState.seenIds.add(
        createToolResultBudgetFingerprint(sessionId, event.toolUseId, providerContent),
      );
      continue;
    }
    const metadata = parsePersistedToolResultSummary(event.content);
    if (!metadata) continue;
    const record = {
      toolUseId: event.toolUseId,
      originalChars: metadata.originalChars,
      replacementChars: event.content.length,
      reason: metadata.reason,
      artifact: {
        id: metadata.artifactId,
        path: join(context.projectPath, metadata.artifactPath),
        relativePath: metadata.artifactPath,
        toolUseId: event.toolUseId,
        chars: metadata.originalChars,
        bytes: metadata.originalBytes,
        sha256: metadata.sha256,
        preview: metadata.preview,
        previewChars: metadata.previewChars,
        hasMore: metadata.hasMore,
        createdAt: event.createdAt,
      },
    };
    rememberRestoredToolResultBudgetReplacement(context, sessionId, event.content, record);
  }
}

function isCompletedToolResultBudgetEvidence(
  event: PersistedEvidenceEvent,
  completedToolUseIds: ReadonlySet<string>,
): boolean {
  if (!event.toolUseId || !completedToolUseIds.has(event.toolUseId)) return false;
  const ledger = parseToolResultBudgetLedgerData(event.data);
  return (
    ledger?.record.toolUseId === event.toolUseId ||
    event.supportsClaims.includes("tool_result_budget")
  );
}

function restoreEvidenceRecord(
  context: TuiContext,
  event: PersistedEvidenceEvent,
) {
  const ledger = parseToolResultBudgetLedgerData(event.data);
  const restoredArtifactPath = ledger
    ? resolveProjectArtifactPath(context.projectPath, ledger.record.artifact.relativePath)
    : event.supportsClaims.includes("tool_result_budget")
      ? resolveProjectArtifactPath(context.projectPath, event.source)
      : undefined;
  return {
    id: event.id,
    kind: event.kind,
    summary: event.summary,
    source: event.source,
    ...(event.toolUseId ? { toolUseId: event.toolUseId } : {}),
    ...(restoredArtifactPath || event.fullOutputPath
      ? { fullOutputPath: restoredArtifactPath ?? event.fullOutputPath }
      : {}),
    ...(restoredArtifactPath || event.outputPath
      ? { outputPath: restoredArtifactPath ?? event.outputPath }
      : {}),
    ...(event.logPath ? { logPath: event.logPath } : {}),
    ...(event.data !== undefined ? { data: event.data } : {}),
    ...(event.ownerScope ? { ownerScope: event.ownerScope } : {}),
    supportsClaims: event.supportsClaims,
    createdAt: event.createdAt,
  };
}

function rememberRestoredToolResultBudgetReplacement(
  context: TuiContext,
  sessionId: string,
  summary: string,
  record: ToolResultBudgetRecord,
): void {
  context.toolResultBudgetState ??= { seenIds: new Set(), replacements: new Map() };
  const fingerprint = [
    sessionId,
    record.toolUseId,
    record.originalChars,
    record.artifact.bytes,
    record.artifact.sha256,
  ].join("\0");
  const replacement = { summary, record, fingerprint };
  context.toolResultBudgetState.seenIds.add(fingerprint);
  if (!context.toolResultBudgetState.replacements.has(fingerprint)) {
    context.toolResultBudgetState.replacements.set(fingerprint, replacement);
  }
  const contentFingerprint = [
    sessionId,
    record.originalChars,
    record.artifact.bytes,
    record.artifact.sha256,
  ].join("\0");
  context.toolResultBudgetState.contentReplacements ??= new Map();
  if (!context.toolResultBudgetState.contentReplacements.has(contentFingerprint)) {
    context.toolResultBudgetState.contentReplacements.set(contentFingerprint, {
      ...replacement,
      fingerprint: contentFingerprint,
    });
  }
}

function resolveProjectArtifactPath(projectPath: string, relativePath: string): string | undefined {
  const path = resolve(projectPath, relativePath);
  const relativeToProject = relative(projectPath, path);
  if (relativeToProject.startsWith("..") || isAbsolute(relativeToProject)) return undefined;
  return path;
}

function parsePersistedToolResultSummary(content: string):
  | {
      artifactId: string;
      artifactPath: string;
      originalChars: number;
      originalBytes: number;
      sha256: string;
      previewChars: number;
      preview: string;
      hasMore: boolean;
      reason: "single_result" | "aggregate_message" | "pressure_age";
    }
  | undefined {
  const reason = readPersistedToolResultReason(content);
  const artifactId = readPersistedToolResultField(content, "artifactId");
  const artifactPath = readPersistedToolResultField(content, "artifactPath");
  const originalChars = Number(readPersistedToolResultField(content, "originalChars"));
  const originalBytes = Number(readPersistedToolResultField(content, "originalBytes"));
  const sha256 = readPersistedToolResultField(content, "sha256");
  const previewChars = Number(readPersistedToolResultField(content, "previewChars"));
  const preview = readPersistedToolResultPreview(content);
  if (
    !artifactId ||
    !artifactPath ||
    !sha256 ||
    !Number.isFinite(originalChars) ||
    !Number.isFinite(originalBytes) ||
    !Number.isFinite(previewChars)
  ) {
    return undefined;
  }
  return {
    artifactId,
    artifactPath,
    originalChars,
    originalBytes,
    sha256,
    previewChars,
    preview: preview.preview,
    hasMore: preview.hasMore,
    reason,
  };
}

function readPersistedToolResultField(content: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(new RegExp(`^${escaped}:\\s*(.+)$`, "mu"));
  return match?.[1]?.trim();
}

function readPersistedToolResultReason(
  content: string,
): "single_result" | "aggregate_message" | "pressure_age" {
  const reason = readPersistedToolResultField(content, "reason");
  return reason === "aggregate_message" || reason === "pressure_age" ? reason : "single_result";
}

function readPersistedToolResultPreview(content: string): { preview: string; hasMore: boolean } {
  const marker = "\npreview:\n";
  const start = content.indexOf(marker);
  if (start < 0) return { preview: "", hasMore: true };
  const bodyStart = start + marker.length;
  const endMarker = "\n</persisted-tool-result>";
  const end = content.lastIndexOf(endMarker);
  if (end < bodyStart) return { preview: "", hasMore: true };
  const body = content.slice(bodyStart, end);
  if (body === "...") return { preview: "", hasMore: true };
  if (body.endsWith("\n...")) return { preview: body.slice(0, -4), hasMore: true };
  return { preview: body, hasMore: false };
}

function restoreCheckpoints(context: TuiContext, transcript: TranscriptEvent[]): void {
  const restoredIds = new Set(
    transcript
      .filter((event): event is Extract<TranscriptEvent, { type: "checkpoint_restored" }> => {
        return event.type === "checkpoint_restored";
      })
      .map((event) => event.checkpointId),
  );
  context.checkpoints = context.checkpoints ?? [];
  const known = new Set(context.checkpoints.map((checkpoint) => checkpoint.id));
  const restored = transcript
    .filter((event): event is Extract<TranscriptEvent, { type: "checkpoint_created" }> => {
      return event.type === "checkpoint_created";
    })
    .filter((event) => !restoredIds.has(event.checkpoint.id) && !known.has(event.checkpoint.id))
    .map((event) => {
      const files = Array.isArray(event.checkpoint.files)
        ? event.checkpoint.files.filter(isCheckpointFile)
        : [];
      const restorable =
        event.checkpoint.restorable === true &&
        event.checkpoint.restoreKind === "snapshot" &&
        files.length > 0;
      return {
        id: event.checkpoint.id,
        sessionId: event.checkpoint.sessionId,
        createdAt: event.checkpoint.createdAt,
        reason: event.checkpoint.reason,
        changedFiles: event.checkpoint.changedFiles,
        restoreKind: event.checkpoint.restoreKind,
        restorable,
        restoreUnavailableReason: restorable
          ? undefined
          : "checkpoint metadata was restored, but snapshot file contents are unavailable",
        files,
      };
    })
    .reverse();
  if (restored.length > 0) {
    context.checkpoints = [...restored, ...context.checkpoints].slice(0, 20);
  }
}

function isCheckpointFile(value: unknown): value is {
  path: string;
  existed: boolean;
  content?: string;
} {
  if (!isRecord(value)) return false;
  if (typeof value.path !== "string" || typeof value.existed !== "boolean") return false;
  return value.content === undefined || typeof value.content === "string";
}

function restoreSessionAcceptedMemory(context: TuiContext, transcript: TranscriptEvent[]): void {
  const finalActions = collectMemoryFinalActions(transcript);
  const known = new Set(
    [
      ...context.memory.candidates,
      ...context.memory.accepted,
      ...context.memory.rejected,
      ...context.memory.disabled,
      ...context.memory.retired,
    ].map((item) => item.id),
  );
  const processed = new Set<string>();
  const restored: MemoryCandidate[] = [];
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const event = transcript[index];
    if (!event || event.type !== "memory_accepted") continue;
    const id = readMemoryId(event.memory);
    if (!id || processed.has(id)) continue;
    processed.add(id);
    const memory = parseResumeAcceptedMemory(event.memory);
    if (!memory) continue;
    if (memory.scope !== "session") continue;
    if (known.has(memory.id)) continue;
    const finalAction = finalActions.get(memory.id);
    if (finalAction && finalAction !== "accepted" && finalAction !== "rollback") continue;
    restored.push(memory);
    known.add(memory.id);
  }
  if (restored.length > 0) {
    context.memory.accepted = [...restored, ...context.memory.accepted];
  }
}

function restorePendingMemoryCandidates(context: TuiContext, transcript: TranscriptEvent[]): void {
  const processed = collectMemoryProcessedIds(transcript);

  const known = new Set(
    [
      ...context.memory.candidates,
      ...context.memory.accepted,
      ...context.memory.rejected,
      ...context.memory.disabled,
      ...context.memory.retired,
    ].map((item) => item.id),
  );
  const restored: MemoryCandidate[] = [];
  for (const event of transcript) {
    if (event.type !== "memory_candidate") continue;
    const candidate = parseResumeMemoryCandidate(event.candidate);
    if (!candidate) continue;
    if (isMemoryTombstoned(context.memory.tombstones, candidate)) continue;
    if (processed.has(candidate.id) || known.has(candidate.id)) continue;
    restored.push(candidate);
    known.add(candidate.id);
  }
  if (restored.length > 0) {
    context.memory.candidates = [...restored.reverse(), ...context.memory.candidates];
  }
}

function collectMemoryProcessedIds(transcript: TranscriptEvent[]): Set<string> {
  const processed = new Set<string>();
  for (const event of transcript) {
    if (event.type === "memory_accepted") {
      const id = readMemoryId(event.memory);
      if (id) processed.add(id);
      continue;
    }
    const lifecycle = parseMemoryLifecycleEvent(event);
    if (lifecycle) processed.add(lifecycle.id);
  }
  return processed;
}

function collectMemoryFinalActions(transcript: TranscriptEvent[]): Map<string, string> {
  const actions = new Map<string, string>();
  for (const event of transcript) {
    if (event.type === "memory_accepted") {
      const id = readMemoryId(event.memory);
      if (id) actions.set(id, "accepted");
      continue;
    }
    const lifecycle = parseMemoryLifecycleEvent(event);
    if (lifecycle) actions.set(lifecycle.id, lifecycle.action);
  }
  return actions;
}

function parseMemoryLifecycleEvent(
  event: TranscriptEvent,
): { action: string; id: string } | undefined {
  if (event.type !== "system_event") return undefined;
  const match = event.message.match(/\bmemory_lifecycle action=(\w+) id=([^\s]+)/u);
  if (!match) return undefined;
  const action = match[1] === "auto_deleted" ? "deleted" : match[1];
  if (
    action !== "accepted" &&
    action !== "rejected" &&
    action !== "disabled" &&
    action !== "rollback" &&
    action !== "deleted"
  ) {
    return undefined;
  }
  return { action, id: match[2] };
}

function parseResumeMemoryCandidate(value: unknown): MemoryCandidate | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.id !== "string" ||
    typeof value.summary !== "string" ||
    typeof value.source !== "string" ||
    typeof value.createdAt !== "string"
  ) {
    return undefined;
  }
  if (value.scope !== "project" && value.scope !== "user" && value.scope !== "session") {
    return undefined;
  }
  if (value.status !== "candidate") {
    return undefined;
  }
  const sourceRefs = Array.isArray(value.sourceRefs)
    ? value.sourceRefs.filter((item): item is string => typeof item === "string")
    : [value.source];
  const origin = parseMemoryOrigin(value.origin);
  return {
    id: value.id,
    scope: value.scope,
    status: "candidate",
    summary: value.summary,
    source: value.source,
    sourceRefs: sourceRefs.slice(0, 6),
    ...(origin ? { origin } : {}),
    risk: value.risk === "medium" || value.risk === "high" ? value.risk : "low",
    inferred: value.inferred === true,
    createdAt: value.createdAt,
  };
}

function readMemoryId(value: unknown): string | undefined {
  return isRecord(value) && typeof value.id === "string" ? value.id : undefined;
}

function parseResumeAcceptedMemory(value: unknown): MemoryCandidate | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.id !== "string" ||
    typeof value.summary !== "string" ||
    typeof value.source !== "string" ||
    typeof value.createdAt !== "string"
  ) {
    return undefined;
  }
  if (value.scope !== "session") return undefined;
  const sourceRefs = Array.isArray(value.sourceRefs)
    ? value.sourceRefs.filter((item): item is string => typeof item === "string")
    : [value.source];
  return {
    id: value.id,
    scope: "session",
    status: "accepted",
    summary: value.summary,
    source: value.source,
    sourceRefs: sourceRefs.slice(0, 6),
    risk: value.risk === "medium" || value.risk === "high" ? value.risk : "low",
    inferred: value.inferred === true,
    createdAt: value.createdAt,
  };
}

export async function loadOrCreateHandoffPacket(
  context: TuiContext,
  parentSessionId?: string,
  sessionId = context.sessionId ?? "uncreated",
): Promise<HandoffPacket> {
  const packet = createHandoffPacket(context, [], parentSessionId, sessionId);
  context.memory.lastHandoff = packet;
  await writeHandoffPacket(context, packet);
  await context.store.appendEvent(sessionId, {
    type: "handoff_packet",
    packet,
    createdAt: new Date().toISOString(),
  });
  return packet;
}

export function createHandoffPacket(
  context: TuiContext,
  transcript: TranscriptEvent[],
  parentSessionId?: string,
  sessionId = context.sessionId ?? "uncreated",
): HandoffPacket {
  const latestEvidence = context.evidence.slice(0, 8).map((item) => ({
    id: item.id,
    kind: item.kind,
    source: item.source,
    summary: item.summary,
  }));
  const transcriptTodos = [...transcript].reverse().find((event) => event.type === "todo_update");
  const todos =
    context.tools.todos.length > 0
      ? context.tools.todos
      : transcriptTodos?.type === "todo_update"
        ? transcriptTodos.items
        : [];
  return {
    id: randomUUID(),
    sessionId,
    projectPath: context.projectPath,
    ...(parentSessionId ? { parentSessionId } : {}),
    currentPhase: "Session handoff",
    nextPhase: "Continue current user task",
    phaseStatus: "in_progress",
    goal: todos.find((item) => item.status !== "completed")?.content ?? "继续当前会话任务。",
    completed: [],
    pending: [],
    mustNotDo: ["Do not claim completion, PASS, or verified results without recorded evidence."],
    todos,
    keyFiles: buildHandoffKeyFiles(context, latestEvidence),
    changedFiles: [...new Set(context.tools.changedFiles)],
    evidenceRefs: latestEvidence,
    verdictEvidence: createEmptyVerdictEvidenceScope(),
    verification: context.lastVerification ?? null,
    risks: context.lastVerification ? context.lastVerification.risk : [],
    indexStatus: createIndexStatusSnapshot(context.index),
    permissionMode: context.permissionMode,
    modelProvider: { provider: getRuntimeStatusProvider(context), model: context.model },
    recentCommit: "unknown until git metadata is checked externally",
    budgetUsage:
      "local validation only; no external provider calls; status bar does not show money",
    createdAt: new Date().toISOString(),
    generatedBy: "Linghun HandoffPacket",
    solutionCompleteness: context.solutionCompleteness,
    ...(context.currentArchitectureCard
      ? { currentArchitectureCard: summarizeArchitectureCard(context.currentArchitectureCard) }
      : {}),
  };
}

function buildHandoffKeyFiles(
  context: TuiContext,
  latestEvidence: Array<{ source: string }>,
): string[] {
  const candidates = [
    ...context.tools.changedFiles,
    ...latestEvidence.map((item) => item.source),
    ...DEFAULT_HANDOFF_KEY_FILES,
  ];
  const keyFiles: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const normalized = normalizeHandoffFileRef(candidate);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    keyFiles.push(normalized);
    if (keyFiles.length >= HANDOFF_KEY_FILE_LIMIT) break;
  }
  return keyFiles;
}

function normalizeHandoffFileRef(value: string): string | undefined {
  const trimmed = value.trim().replaceAll("\\", "/");
  if (!trimmed || trimmed.startsWith("[") || /^[a-z]+:/iu.test(trimmed)) return undefined;
  if (trimmed.includes("\n") || trimmed.includes("\0")) return undefined;
  const withoutLine = trimmed.replace(/:\d+(?::\d+)?$/u, "");
  if (!withoutLine.includes("/") && !withoutLine.includes(".")) return undefined;
  return withoutLine;
}

function sanitizeHandoffPacket(packet: HandoffPacket): HandoffPacket {
  const legacyPattern =
    /Runtime readiness evidence guard|Real-project Beta|Beta readiness|verdict gate|coverage matrix|systemic_gap|进入 Beta|后续路线图|readiness|blocked until explicit user confirmation/iu;
  const sanitized: HandoffPacket = {
    ...packet,
    currentPhase: legacyPattern.test(packet.currentPhase) ? "Session handoff" : packet.currentPhase,
    nextPhase: legacyPattern.test(packet.nextPhase)
      ? "Continue current user task"
      : packet.nextPhase,
    phaseStatus: legacyPattern.test(packet.currentPhase) ? "in_progress" : packet.phaseStatus,
    goal: legacyPattern.test(packet.goal) ? "继续当前会话任务。" : packet.goal,
    completed: packet.completed.filter((item) => !legacyPattern.test(item)),
    pending: packet.pending.filter((item) => !legacyPattern.test(item)),
    mustNotDo: packet.mustNotDo.filter((item) => !legacyPattern.test(item)),
    risks: packet.risks.filter((item) => !legacyPattern.test(item)),
    verdictEvidence: legacyPattern.test(JSON.stringify(packet.verdictEvidence))
      ? createEmptyVerdictEvidenceScope()
      : packet.verdictEvidence,
  };
  return sanitized;
}

function createEmptyVerdictEvidenceScope(): HandoffPacket["verdictEvidence"] {
  return {
    scope: "beta",
    status: "PARTIAL",
    evidenceRefs: [],
    validationCommands: [],
    uncoveredItems: [],
    residualRisks: [],
    nextAction: "Continue from current task evidence and runtime state.",
  };
}

export function validateHandoffPacket(packet: HandoffPacket): string[] {
  const missing: string[] = [];
  if (!packet.id) missing.push("id");
  if (!packet.sessionId) missing.push("sessionId");
  if (!packet.projectPath) missing.push("projectPath");
  if (!packet.verification) missing.push("verification");
  if (packet.evidenceRefs.length === 0) missing.push("evidenceRefs");
  if (packet.mustNotDo.length === 0) missing.push("mustNotDo");
  if (!packet.indexStatus.status || packet.indexStatus.status === "unknown")
    missing.push("indexStatus");
  return missing;
}

export function isHandoffPacket(value: unknown): value is HandoffPacket {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.sessionId === "string" &&
    typeof value.projectPath === "string" &&
    typeof value.currentPhase === "string" &&
    typeof value.nextPhase === "string" &&
    Array.isArray(value.mustNotDo) &&
    Array.isArray(value.evidenceRefs)
  );
}

// Module 7 (tui-memory-runtime): formatProjectRulesContext moved out — see
// re-export+import block below.

export function formatResumePacket(
  packet: HandoffPacket,
  missing: string[],
  context: TuiContext,
): string {
  return [
    "Resume context package（摘要，不含完整历史）：",
    `- projectRules: ${formatProjectRulesContext(context)}`,
    `- currentPhase: ${packet.currentPhase}`,
    `- phaseStatus: ${packet.phaseStatus}`,
    `- goal: ${packet.goal}`,
    `- todos: ${packet.todos.length}`,
    `- evidenceRefs: ${packet.evidenceRefs.length}`,
    `- keyFiles: ${packet.keyFiles.join(", ")}`,
    `- verification: ${packet.verification?.status ?? "missing"}`,
    `- indexStatus: ${formatIndexRuntimeRef(packet.indexStatus)}`,
    `- readonly: ${missing.length > 0 ? `yes (${missing.join(", ")})` : "no"}`,
    context.memory.projectRulesError
      ? `- projectRules warning: ${context.memory.projectRulesError}`
      : "- projectRules warning: none",
    missing.length > 0
      ? "- 下一步：补齐 handoff 关键字段或先只读检查 /index status、/memory review、/verify last。"
      : "- 下一步：可基于摘要、Todo、证据和关键文件继续。",
  ].join("\n");
}

export async function writeHandoffPacket(
  context: TuiContext,
  packet: HandoffPacket,
): Promise<void> {
  await mkdir(context.memory.sessionDir, { recursive: true });
  await writeFile(
    join(context.memory.sessionDir, "handoff-latest.json"),
    `${JSON.stringify(packet, null, 2)}\n`,
    "utf8",
  );
  await recordHandoffInRuntimeLedger(context, packet);
}
