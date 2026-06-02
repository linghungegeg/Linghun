import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TranscriptEvent } from "@linghun/core";
import { summarizeArchitectureCard } from "./architecture-runtime.js";
import { isDeepCompactPacket } from "./deep-compact-runtime.js";
import {
  createHandoffPendingItems,
  createHandoffRiskItems,
  createPhase15BetaVerdictScope,
} from "./final-answer-gate.js";
import type { TuiContext } from "./index.js";
import type {
  CompactProjection,
  HandoffPacket,
  MemoryCandidate,
  VerificationReport,
} from "./tui-data-types.js";
import { formatProjectRulesContext } from "./tui-memory-runtime.js";
import { getRuntimeStatusProvider } from "./tui-model-runtime.js";
import { isRecord } from "./tui-state-runtime.js";

const COMPACT_PROJECTION_EVENT_PREFIX = "compact_projection:";

export function hydrateResumeContext(context: TuiContext, transcript: TranscriptEvent[]): void {
  const latestTodo = [...transcript].reverse().find((event) => event.type === "todo_update");
  if (latestTodo?.type === "todo_update") {
    context.tools.todos = latestTodo.items.map((item) => ({ ...item }));
  }
  const latestVerification = [...transcript]
    .reverse()
    .find((event) => event.type === "verification_end");
  if (latestVerification?.type === "verification_end") {
    context.lastVerification = latestVerification.report as VerificationReport;
  }
  const evidence = transcript
    .filter(
      (event): event is Extract<TranscriptEvent, { type: "evidence_record" }> =>
        event.type === "evidence_record",
    )
    .slice(-10)
    .map((event) => ({
      id: event.id,
      kind: event.kind,
      summary: event.summary,
      source: event.source,
      supportsClaims: event.supportsClaims,
      createdAt: event.createdAt,
    }));
  context.evidence = [...evidence.reverse(), ...context.evidence].slice(0, 20);
  const handoff = [...transcript].reverse().find((event) => event.type === "handoff_packet");
  if (handoff?.type === "handoff_packet" && isHandoffPacket(handoff.packet)) {
    context.memory.lastHandoff = handoff.packet;
  }
  restorePendingMemoryCandidates(context, transcript);
  const deepCompact = [...transcript]
    .reverse()
    .find((event) => event.type === "deep_compact_packet");
  if (deepCompact?.type === "deep_compact_packet" && isDeepCompactPacket(deepCompact.packet)) {
    context.cache.compacted = true;
    context.cache.deepCompact = deepCompact.packet;
  }
  const compactEvent = [...transcript]
    .reverse()
    .find(
      (event) =>
        event.type === "system_event" && event.message.startsWith(COMPACT_PROJECTION_EVENT_PREFIX),
    );
  if (compactEvent?.type === "system_event") {
    const projection = parseCompactProjectionEvent(compactEvent.message);
    if (projection) {
      context.cache.compacted = true;
      context.cache.compactProjection = projection;
      if (
        !context.cache.compactBoundaries.some((boundary) => boundary.id === projection.boundaryId)
      ) {
        context.cache.compactBoundaries.push({
          id: projection.boundaryId,
          kind: "micro",
          createdAt: projection.createdAt,
          preCompactTokenEstimate: Math.ceil(projection.preCompactChars / 4),
          postCompactTokenEstimate: Math.ceil(projection.postCompactChars / 4),
          compactedToolResultIds: [],
          preservedEvidenceRefs: projection.evidenceRefs,
          preservedFiles: [],
        });
      }
    }
  }
}

function restorePendingMemoryCandidates(context: TuiContext, transcript: TranscriptEvent[]): void {
  const processed = new Set<string>();
  for (const event of transcript) {
    if (event.type === "memory_accepted") {
      const id = readMemoryId(event.memory);
      if (id) processed.add(id);
      continue;
    }
    if (event.type !== "system_event") continue;
    const match = event.message.match(/\bmemory_lifecycle action=(\w+) id=([^\s]+)/u);
    if (!match) continue;
    const action = match[1];
    if (
      action === "accepted" ||
      action === "rejected" ||
      action === "disabled" ||
      action === "rollback" ||
      action === "deleted"
    ) {
      processed.add(match[2]);
    }
  }

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
    if (processed.has(candidate.id) || known.has(candidate.id)) continue;
    restored.push(candidate);
    known.add(candidate.id);
  }
  if (restored.length > 0) {
    context.memory.candidates = [...restored.reverse(), ...context.memory.candidates];
  }
}

function readMemoryId(value: unknown): string | undefined {
  return isRecord(value) && typeof value.id === "string" ? value.id : undefined;
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
  return {
    id: value.id,
    scope: value.scope,
    status: "candidate",
    summary: value.summary,
    source: value.source,
    sourceRefs: sourceRefs.slice(0, 6),
    risk: value.risk === "medium" || value.risk === "high" ? value.risk : "low",
    inferred: value.inferred === true,
    createdAt: value.createdAt,
  };
}

function parseCompactProjectionEvent(message: string): CompactProjection | undefined {
  try {
    const parsed = JSON.parse(message.slice(COMPACT_PROJECTION_EVENT_PREFIX.length));
    if (!isCompactProjection(parsed)) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function isCompactProjection(value: unknown): value is CompactProjection {
  return (
    isRecord(value) &&
    typeof value.boundaryId === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.summary === "string" &&
    typeof value.pressureRatio === "number" &&
    typeof value.preCompactChars === "number" &&
    typeof value.postCompactChars === "number" &&
    typeof value.discardedRange === "string" &&
    typeof value.toolPairingSafe === "boolean" &&
    Array.isArray(value.risks) &&
    Array.isArray(value.evidenceRefs)
  );
}

export async function loadOrCreateHandoffPacket(
  context: TuiContext,
  parentSessionId?: string,
  sessionId = context.sessionId ?? "uncreated",
): Promise<HandoffPacket> {
  if (context.memory.lastHandoff) {
    context.memory.lastHandoff.solutionCompleteness = context.solutionCompleteness;
    await writeHandoffPacket(context, context.memory.lastHandoff);
    return context.memory.lastHandoff;
  }
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
    currentPhase: "Runtime readiness evidence guard",
    nextPhase:
      "Real-project Beta（blocked until explicit user confirmation and real TUI/provider evidence）",
    phaseStatus: "blocked",
    goal: "只关闭 readiness / verdict 结论层 evidence guard；不进入 Beta 或后续路线图阶段。",
    completed: [
      "runtime silent-failure guard is PASS for the tested runtime path",
      "live provider basic text smoke is PASS for the temporary-env smoke only",
      "verdict/readiness claims now require explicit scope, evidence, validation, uncovered paths, and risk",
    ],
    pending: createHandoffPendingItems(context.evidence),
    mustNotDo: [
      "不要进入 Beta，除非用户明确确认且 Beta readiness evidence guard 通过",
      "不要进入后续路线图阶段",
      "不要把 focused PASS、mock PASS、live text PASS、SKIPPED smoke 或 PARTIAL path 写成整体 ready",
      "不要把 Linghun 写成等于 CCB / 成熟工具，除非附 scope/evidence/validation/uncovered/risk",
      "不要复制 CCB / Claude Code / OpenCode 源码、内部 API 或专有实现",
      "不要让 verdict gate / coverage matrix / systemic_gap 污染普通开发请求主输出",
    ],
    todos,
    keyFiles: [
      "packages/tui/src/index.ts",
      "packages/config/src/index.ts",
      "packages/tui/src/index.test.ts",
      "packages/config/src/index.test.ts",
      "apps/cli/src/cli.ts",
      "docs/delivery/phase-14-skills-workflow.md",
    ],
    changedFiles: [...new Set(context.tools.changedFiles)],
    evidenceRefs: latestEvidence,
    verdictEvidence: createPhase15BetaVerdictScope(context.evidence, transcript),
    verification: context.lastVerification ?? null,
    risks: context.lastVerification
      ? context.lastVerification.risk
      : createHandoffRiskItems(context.evidence),
    indexStatus: {
      projectName: context.index.projectName,
      status: context.index.status,
      nodes: context.index.nodes,
      edges: context.index.edges,
      changedFiles: context.index.changedFiles,
      staleHint: context.index.staleHint,
    },
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
    `- indexStatus: ${packet.indexStatus.status}`,
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
}
