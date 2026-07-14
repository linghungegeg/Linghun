import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import type { ModelMessage } from "@linghun/providers";
import {
  LINGHUN_DEFAULT_TOOL_RESULT_CHARS,
  LINGHUN_MAX_TOOL_RESULTS_PER_MESSAGE_CHARS,
  LINGHUN_MAX_TOOL_RESULT_BYTES,
  LINGHUN_TOOL_RESULT_PRESSURE_RATIO,
  LINGHUN_TOOL_RESULT_RECENT_RAW_RESULTS,
} from "./runtime-budget.js";

export type ToolResultBudgetArtifact = {
  id: string;
  toolUseId: string;
  path: string;
  relativePath: string;
  bytes: number;
  chars: number;
  sha256: string;
  previewChars: number;
  preview: string;
  hasMore: boolean;
};

export type ToolResultBudgetRecord = {
  toolUseId: string;
  originalChars: number;
  replacementChars: number;
  artifact: ToolResultBudgetArtifact;
  reason: "single_result" | "aggregate_message" | "pressure_age";
};

export type ToolResultBudgetResult = {
  messages: ModelMessage[];
  records: ToolResultBudgetRecord[];
};

export type ToolResultBudgetLedgerResolution = {
  identity?: ToolResultBudgetLedgerEntry;
  content?: ToolResultBudgetLedgerEntry;
};

export type ToolResultBudgetLedgerEntry = {
  record: ToolResultBudgetRecord;
  replacement: string;
  replacementSha256: string;
};

export type ToolResultBudgetLedgerLookup = {
  toolUseId: string;
  contentSha256: string;
};

export type ToolResultBudgetReplacement = {
  summary: string;
  record: ToolResultBudgetRecord;
  fingerprint: string;
};

export type ToolResultBudgetLedgerData = {
  kind: "tool_result_budget_replacement";
  version: 1;
  replacement: string;
  replacementSha256: string;
  record: {
    toolUseId: string;
    originalChars: number;
    replacementChars: number;
    reason: ToolResultBudgetRecord["reason"];
    artifact: {
      id: string;
      relativePath: string;
      bytes: number;
      chars: number;
      sha256: string;
      previewChars: number;
      preview: string;
      hasMore: boolean;
    };
  };
};

export type ToolResultBudgetState = {
  seenIds: Set<string>;
  replacements: Map<string, ToolResultBudgetReplacement>;
  contentReplacements?: Map<string, ToolResultBudgetReplacement>;
  forcedToolUseIds?: Set<string>;
  pendingArtifacts?: Map<string, Promise<ToolResultBudgetArtifact>>;
  pendingEvidenceRecords?: Map<string, Promise<string>>;
  hasLegacyArtifactPaths?: boolean;
};

const TOOL_RESULTS_DIR = "tool-results";
const TOOL_RESULT_PREVIEW_CHARS = 2_000;
const TOOL_RESULT_SUMMARY_ESTIMATE_CHARS = TOOL_RESULT_PREVIEW_CHARS + 2_000;
const TOOL_RESULT_BUDGET_STATE_MAX_ENTRIES = 200;

type Candidate = {
  messageIndex: number;
  toolUseId: string;
  content: string;
  chars: number;
  bytes: number;
  stateKey?: string;
  contentSha256?: string;
  artifactHint?: ToolResultBudgetArtifact;
  reasonHint?: ToolResultBudgetRecord["reason"];
};

type ArtifactWriteResult = {
  artifact: ToolResultBudgetArtifact;
  created: boolean;
  recordOwner: boolean;
};

export async function applyToolResultBudgetToMessages(
  messages: ModelMessage[],
  options: {
    projectPath: string;
    sessionId: string;
    now?: Date;
    state?: ToolResultBudgetState;
    singleResultChars?: number;
    singleResultBytes?: number;
    resolveLedgerRecords?: (
      lookups: readonly ToolResultBudgetLedgerLookup[],
    ) =>
      | readonly ToolResultBudgetLedgerResolution[]
      | Promise<readonly ToolResultBudgetLedgerResolution[]>;
  },
): Promise<ToolResultBudgetResult> {
  const state = options.state;
  const singleResultChars = options.singleResultChars ?? LINGHUN_DEFAULT_TOOL_RESULT_CHARS;
  const singleResultBytes = options.singleResultBytes ?? LINGHUN_MAX_TOOL_RESULT_BYTES;
  if (state) {
    state.contentReplacements ??= new Map();
    pruneToolResultBudgetStateEntries(state);
  }
  const candidates = collectToolResultCandidates(messages, state);
  if (candidates.length === 0) return { messages, records: [] };
  const ledgerResolutions = options.resolveLedgerRecords
    ? await options.resolveLedgerRecords(
        candidates.map((candidate) => ({
          toolUseId: candidate.toolUseId,
          contentSha256: getCandidateContentHash(candidate),
        })),
      )
    : [];

  const cachedReplacements = new Map<string, string>();
  const freshCandidates: Candidate[] = [];
  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    const candidate = candidates[candidateIndex];
    if (!candidate) continue;
    const stateKey = state ? getCandidateStateKey(candidate, options.sessionId) : undefined;
    const ledger = ledgerResolutions[candidateIndex];
    if (ledger?.identity) {
      const record = rebindToolResultBudgetRecord(ledger.identity.record, candidate.toolUseId);
      const summary = ledger.identity.replacement;
      cachedReplacements.set(candidate.toolUseId, summary);
      if (stateKey && state) {
        state.seenIds.add(stateKey);
        state.replacements.set(stateKey, { summary, record, fingerprint: stateKey });
        const contentKey = getCandidateContentKey(candidate, options.sessionId);
        getContentReplacements(state).set(contentKey, {
          summary,
          record,
          fingerprint: contentKey,
        });
      }
      continue;
    }
    const existing = stateKey ? state?.replacements.get(stateKey) : undefined;
    if (existing && !options.resolveLedgerRecords) {
      cachedReplacements.set(candidate.toolUseId, existing.summary);
      continue;
    }
    if (!existing && stateKey && state?.seenIds.has(stateKey)) {
      continue;
    }
    const contentKey = state ? getCandidateContentKey(candidate, options.sessionId) : undefined;
    const existingByContent = state && contentKey
      ? getContentReplacements(state).get(contentKey)
      : undefined;
    const reusableRecord = existing?.record ?? existingByContent?.record ?? ledger?.content?.record;
    if (reusableRecord && options.resolveLedgerRecords) {
      freshCandidates.push({
        ...candidate,
        artifactHint: reusableRecord.artifact,
        reasonHint: reusableRecord.reason,
      });
      continue;
    }
    if (reusableRecord) {
      const record = rebindToolResultBudgetRecord(reusableRecord, candidate.toolUseId);
      const summary = formatToolResultBudgetReplacement(record.artifact, record.reason);
      cachedReplacements.set(candidate.toolUseId, summary);
      if (stateKey && state) {
        state.seenIds.add(stateKey);
        state.replacements.set(stateKey, { summary, record, fingerprint: stateKey });
      }
      continue;
    }
    freshCandidates.push(candidate);
  }

  const selected = new Map<string, Candidate & { reason: ToolResultBudgetRecord["reason"] }>();
  for (const candidate of freshCandidates) {
    if (candidate.artifactHint) {
      selected.set(candidate.toolUseId, {
        ...candidate,
        reason: candidate.reasonHint ?? "single_result",
      });
    } else if (state?.forcedToolUseIds?.has(candidate.toolUseId)) {
      selected.set(candidate.toolUseId, { ...candidate, reason: "pressure_age" });
    } else if (candidate.chars > singleResultChars || candidate.bytes > singleResultBytes) {
      selected.set(candidate.toolUseId, { ...candidate, reason: "single_result" });
    }
  }

  const freshIds = new Set(freshCandidates.map((candidate) => candidate.toolUseId));
  for (const group of groupCandidatesByAssistantToolUse(messages, candidates)) {
    const visibleSize = group.reduce((sum, candidate) => {
      const stateKey = options.state
        ? getCandidateStateKey(candidate, options.sessionId)
        : undefined;
      const replacement = stateKey ? options.state?.replacements.get(stateKey) : undefined;
      return sum + (replacement?.summary.length ?? candidate.chars);
    }, 0);
    if (visibleSize <= LINGHUN_MAX_TOOL_RESULTS_PER_MESSAGE_CHARS) continue;
    let remaining = visibleSize;
    for (const candidate of [...group]
      .filter((item) => freshIds.has(item.toolUseId))
      .sort((a, b) => b.chars - a.chars)) {
      if (remaining <= LINGHUN_MAX_TOOL_RESULTS_PER_MESSAGE_CHARS) break;
      if (!selected.has(candidate.toolUseId)) {
        selected.set(candidate.toolUseId, { ...candidate, reason: "aggregate_message" });
      }
      remaining -= candidate.chars;
    }
  }

  const selectedBeforePressure = selected.size;
  selectCandidatesToFitVisibleBudget({
    candidates,
    selected,
    freshIds,
    cachedReplacements,
    sessionId: options.sessionId,
    state: options.state,
  });
  if (selected.size === selectedBeforePressure) {
    selectOldCandidatesUnderPressure({
      candidates,
      selected,
      freshIds,
      cachedReplacements,
      sessionId: options.sessionId,
      state: options.state,
    });
  }

  if (selected.size === 0) {
    for (const candidate of freshCandidates) {
      options.state?.seenIds.add(getCandidateStateKey(candidate, options.sessionId));
    }
    if (options.state) pruneToolResultBudgetStateEntries(options.state);
    return cachedReplacements.size === 0
      ? { messages, records: [] }
      : { messages: replaceToolResults(messages, cachedReplacements), records: [] };
  }

  const replacements = new Map(cachedReplacements);
  const records: ToolResultBudgetRecord[] = [];
  for (const candidate of Array.from(selected.values())) {
    const { artifact, created, recordOwner } = await persistToolResultArtifact(candidate, options);
    const replacement = formatToolResultBudgetReplacement(artifact, candidate.reason);
    replacements.set(candidate.toolUseId, replacement);
    const record = {
      toolUseId: candidate.toolUseId,
      originalChars: candidate.content.length,
      replacementChars: replacement.length,
      artifact,
      reason: candidate.reason,
    };
    if (options.resolveLedgerRecords ? recordOwner : created) records.push(record);
    const stateKey = getCandidateStateKey(candidate, options.sessionId);
    options.state?.replacements.set(stateKey, {
      summary: replacement,
      record,
      fingerprint: stateKey,
    });
    const contentKey = getCandidateContentKey(candidate, options.sessionId);
    const contentReplacements = options.state ? getContentReplacements(options.state) : undefined;
    contentReplacements?.set(contentKey, {
      summary: replacement,
      record,
      fingerprint: contentKey,
    });
    if (options.state) pruneToolResultBudgetStateEntries(options.state);
  }
  for (const candidate of freshCandidates) {
    options.state?.seenIds.add(getCandidateStateKey(candidate, options.sessionId));
    options.state?.forcedToolUseIds?.delete(candidate.toolUseId);
  }
  if (options.state) pruneToolResultBudgetStateEntries(options.state);

  return {
    messages: replaceToolResults(messages, replacements),
    records,
  };
}

function collectToolResultCandidates(
  messages: ModelMessage[],
  _state?: ToolResultBudgetState,
): Candidate[] {
  const candidates: Candidate[] = [];
  messages.forEach((message, messageIndex) => {
    if (message.role !== "tool") return;
    if (isBudgetSummary(message.content)) return;
    const bytes = Buffer.byteLength(message.content, "utf8");
    candidates.push({
      messageIndex,
      toolUseId: message.tool_call_id,
      content: message.content,
      chars: message.content.length,
      bytes,
    });
  });
  return candidates;
}

function getCandidateStateKey(candidate: Candidate, sessionId: string): string {
  candidate.stateKey ??= createToolResultBudgetFingerprint(
    sessionId,
    candidate.toolUseId,
    candidate.content,
  );
  return candidate.stateKey;
}

export function createToolResultBudgetFingerprint(
  sessionId: string,
  toolUseId: string,
  content: string,
): string {
  return createToolResultBudgetRecordFingerprint(sessionId, {
    toolUseId,
    originalChars: content.length,
    artifact: {
      bytes: Buffer.byteLength(content, "utf8"),
      sha256: createHash("sha256").update(content).digest("hex"),
    },
  });
}

export function createToolResultBudgetRecordFingerprint(
  sessionId: string,
  record: {
    toolUseId: string;
    originalChars: number;
    artifact: { bytes: number; sha256: string };
  },
): string {
  return [
    sessionId,
    record.toolUseId,
    record.originalChars,
    record.artifact.bytes,
    record.artifact.sha256,
  ].join("\0");
}

function getCandidateContentKey(candidate: Candidate, sessionId: string): string {
  return [sessionId, candidate.chars, candidate.bytes, getCandidateContentHash(candidate)].join("\0");
}

function getCandidateContentHash(candidate: Candidate): string {
  candidate.contentSha256 ??= createHash("sha256").update(candidate.content).digest("hex");
  return candidate.contentSha256;
}

export function pruneToolResultBudgetStateEntries(state: ToolResultBudgetState): void {
  pruneOldestSetEntries(state.seenIds, TOOL_RESULT_BUDGET_STATE_MAX_ENTRIES);
  pruneOldestMapEntries(state.replacements, TOOL_RESULT_BUDGET_STATE_MAX_ENTRIES);
  if (state.contentReplacements) {
    pruneOldestMapEntries(state.contentReplacements, TOOL_RESULT_BUDGET_STATE_MAX_ENTRIES);
  }
  if (state.forcedToolUseIds) {
    pruneOldestSetEntries(state.forcedToolUseIds, TOOL_RESULT_BUDGET_STATE_MAX_ENTRIES);
  }
  state.hasLegacyArtifactPaths =
    (state.forcedToolUseIds?.size ?? 0) > 0 ||
    [...state.replacements.values()].some(
      (replacement) => replacement.record.artifact.id !== replacement.record.artifact.sha256,
    );
}

function pruneOldestSetEntries(values: Set<string>, limit: number): void {
  const removeCount = Math.max(0, values.size - limit);
  const iterator = values.values();
  for (let index = 0; index < removeCount; index += 1) {
    const next = iterator.next();
    if (next.done) break;
    values.delete(next.value);
  }
}

function pruneOldestMapEntries<K, V>(values: Map<K, V>, limit: number): void {
  const removeCount = Math.max(0, values.size - limit);
  const iterator = values.keys();
  for (let index = 0; index < removeCount; index += 1) {
    const next = iterator.next();
    if (next.done) break;
    values.delete(next.value);
  }
}

function getContentReplacements(
  state: ToolResultBudgetState,
): Map<string, ToolResultBudgetReplacement> {
  state.contentReplacements ??= new Map();
  return state.contentReplacements;
}

function rebindToolResultBudgetRecord(
  record: ToolResultBudgetRecord,
  toolUseId: string,
): ToolResultBudgetRecord {
  const artifact = { ...record.artifact, toolUseId };
  const replacement = formatToolResultBudgetReplacement(artifact, record.reason);
  return {
    ...record,
    toolUseId,
    replacementChars: replacement.length,
    artifact,
  };
}

function selectCandidatesToFitVisibleBudget(options: {
  candidates: Candidate[];
  selected: Map<string, Candidate & { reason: ToolResultBudgetRecord["reason"] }>;
  freshIds: ReadonlySet<string>;
  cachedReplacements: ReadonlyMap<string, string>;
  sessionId: string;
  state?: ToolResultBudgetState;
}): void {
  let visibleSize = options.candidates.reduce(
    (sum, candidate) => sum + getCandidateVisibleChars(candidate, options),
    0,
  );
  if (visibleSize <= LINGHUN_MAX_TOOL_RESULTS_PER_MESSAGE_CHARS) return;

  const freshCandidates = [...options.candidates]
    .filter((item) => options.freshIds.has(item.toolUseId) && !options.selected.has(item.toolUseId))
    .sort((a, b) => b.chars - a.chars);
  visibleSize = selectCandidatesUntilWithinBudget(freshCandidates, visibleSize, options);
  if (visibleSize <= LINGHUN_MAX_TOOL_RESULTS_PER_MESSAGE_CHARS) return;
}

function selectOldCandidatesUnderPressure(options: {
  candidates: Candidate[];
  selected: Map<string, Candidate & { reason: ToolResultBudgetRecord["reason"] }>;
  freshIds: ReadonlySet<string>;
  cachedReplacements: ReadonlyMap<string, string>;
  sessionId: string;
  state?: ToolResultBudgetState;
}): void {
  const pressureTarget = Math.floor(
    LINGHUN_MAX_TOOL_RESULTS_PER_MESSAGE_CHARS * LINGHUN_TOOL_RESULT_PRESSURE_RATIO,
  );
  let visibleSize = options.candidates.reduce(
    (sum, candidate) => sum + getCandidateVisibleChars(candidate, options),
    0,
  );
  if (visibleSize <= pressureTarget) return;

  const rawCandidates = options.candidates.filter(
    (item) =>
      options.freshIds.has(item.toolUseId) &&
      !options.selected.has(item.toolUseId) &&
      !options.cachedReplacements.has(item.toolUseId) &&
      !getStateReplacement(item, options),
  );
  const recentRawMessageIndexes = new Set(
    rawCandidates
      .slice(-LINGHUN_TOOL_RESULT_RECENT_RAW_RESULTS)
      .map((candidate) => candidate.messageIndex),
  );

  for (const candidate of rawCandidates) {
    if (visibleSize <= pressureTarget) break;
    if (recentRawMessageIndexes.has(candidate.messageIndex)) continue;
    options.selected.set(candidate.toolUseId, { ...candidate, reason: "pressure_age" });
    visibleSize -= Math.max(0, candidate.chars - getEstimatedSummaryChars(candidate));
  }
}

function selectCandidatesUntilWithinBudget(
  candidates: Candidate[],
  visibleSize: number,
  options: {
    selected: Map<string, Candidate & { reason: ToolResultBudgetRecord["reason"] }>;
  },
): number {
  let remaining = visibleSize;
  for (const candidate of candidates) {
    if (remaining <= LINGHUN_MAX_TOOL_RESULTS_PER_MESSAGE_CHARS) break;
    options.selected.set(candidate.toolUseId, { ...candidate, reason: "aggregate_message" });
    remaining -= Math.max(0, candidate.chars - getEstimatedSummaryChars(candidate));
  }
  return remaining;
}

function getCandidateVisibleChars(
  candidate: Candidate,
  options: {
    selected: ReadonlyMap<string, Candidate & { reason: ToolResultBudgetRecord["reason"] }>;
    cachedReplacements: ReadonlyMap<string, string>;
    sessionId: string;
    state?: ToolResultBudgetState;
  },
): number {
  if (options.selected.has(candidate.toolUseId)) return getEstimatedSummaryChars(candidate);
  const cached = options.cachedReplacements.get(candidate.toolUseId);
  if (cached) return cached.length;
  return getStateReplacement(candidate, options)?.summary.length ?? candidate.chars;
}

function getStateReplacement(
  candidate: Candidate,
  options: { sessionId: string; state?: ToolResultBudgetState },
): ToolResultBudgetReplacement | undefined {
  const stateKey = options.state ? getCandidateStateKey(candidate, options.sessionId) : undefined;
  return stateKey ? options.state?.replacements.get(stateKey) : undefined;
}

function getEstimatedSummaryChars(candidate: Candidate): number {
  return Math.min(candidate.chars, TOOL_RESULT_SUMMARY_ESTIMATE_CHARS);
}

function groupCandidatesByAssistantToolUse(
  messages: ModelMessage[],
  candidates: Candidate[],
): Candidate[][] {
  const byMessageIndex = new Map(
    candidates.map((candidate) => [candidate.messageIndex, candidate]),
  );
  const groups: Candidate[][] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role !== "assistant" || !message.toolCalls?.length) continue;
    const ids = new Set(message.toolCalls.map((toolCall) => toolCall.id));
    const group: Candidate[] = [];
    for (let cursor = index + 1; cursor < messages.length; cursor += 1) {
      const next = messages[cursor];
      if (next.role === "assistant") break;
      if (next.role !== "tool") continue;
      if (!ids.has(next.tool_call_id)) continue;
      const candidate = byMessageIndex.get(cursor);
      if (candidate) group.push(candidate);
    }
    if (group.length > 0) groups.push(group);
  }
  return groups;
}

async function persistToolResultArtifact(
  candidate: Candidate,
  options: {
    projectPath: string;
    sessionId: string;
    now?: Date;
    state?: ToolResultBudgetState;
  },
): Promise<ArtifactWriteResult> {
  if (candidate.artifactHint) {
    return {
      artifact: { ...candidate.artifactHint, toolUseId: candidate.toolUseId },
      created: false,
      recordOwner: true,
    };
  }
  const stateKey = getCandidateStateKey(candidate, options.sessionId);
  const pending = options.state?.pendingArtifacts?.get(stateKey);
  if (pending) {
    const artifact = await pending;
    return {
      artifact: { ...artifact, toolUseId: candidate.toolUseId },
      created: false,
      recordOwner: false,
    };
  }
  const write = writeToolResultArtifact(candidate, options);
  if (!options.state) return { ...(await write), recordOwner: true };
  const shared = write.then((result) => result.artifact);
  void shared.catch(() => undefined);
  (options.state.pendingArtifacts ??= new Map()).set(stateKey, shared);
  try {
    return { ...(await write), recordOwner: true };
  } finally {
    if (options.state.pendingArtifacts?.get(stateKey) === shared) {
      options.state.pendingArtifacts.delete(stateKey);
    }
  }
}

async function writeToolResultArtifact(
  candidate: Candidate,
  options: { projectPath: string; sessionId: string; now?: Date },
): Promise<ArtifactWriteResult> {
  const dir = join(options.projectPath, ".linghun", "session", TOOL_RESULTS_DIR, options.sessionId);
  await mkdir(dir, { recursive: true });
  const sha256 = getCandidateContentHash(candidate);
  const artifactId = sha256;
  const path = join(dir, `${artifactId}.txt`);
  let created = true;
  try {
    await writeFile(path, candidate.content, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    created = false;
    const existing = await readFile(path);
    const existingSha256 = createHash("sha256").update(existing).digest("hex");
    if (existing.length !== candidate.bytes || existingSha256 !== sha256) {
      throw new Error(`tool result artifact content mismatch: ${relative(options.projectPath, path)}`);
    }
  }
  const relativePath = relative(options.projectPath, path).replace(/\\/g, "/");
  const preview = candidate.content.slice(0, TOOL_RESULT_PREVIEW_CHARS);
  return {
    created,
    recordOwner: true,
    artifact: {
      id: artifactId,
      toolUseId: candidate.toolUseId,
      path,
      relativePath,
      bytes: candidate.bytes,
      chars: candidate.content.length,
      sha256,
      previewChars: preview.length,
      preview,
      hasMore: preview.length < candidate.content.length,
    },
  };
}

export function formatToolResultBudgetReplacement(
  artifact: ToolResultBudgetArtifact,
  _reason: ToolResultBudgetRecord["reason"],
  toolUseId = artifact.toolUseId,
): string {
  return formatToolResultBudgetReplacementInternal(artifact, toolUseId);
}

function formatToolResultBudgetReplacementInternal(
  artifact: ToolResultBudgetArtifact,
  toolUseId: string,
  legacyReason?: ToolResultBudgetRecord["reason"],
): string {
  return [
    "<persisted-tool-result>",
    ...(legacyReason ? [`reason: ${legacyReason}`] : []),
    `toolUseId: ${toolUseId}`,
    `artifactId: ${artifact.id}`,
    `artifactPath: ${artifact.relativePath}`,
    `originalChars: ${artifact.chars}`,
    `originalBytes: ${artifact.bytes}`,
    `sha256: ${artifact.sha256}`,
    `previewChars: ${artifact.previewChars}`,
    "read: use /details output with the evidence id or read the artifact path if you need the full tool output.",
    "preview:",
    artifact.preview,
    artifact.hasMore ? "..." : "",
    "</persisted-tool-result>",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function createToolResultBudgetLedgerData(
  record: ToolResultBudgetRecord,
): ToolResultBudgetLedgerData {
  const replacement = formatToolResultBudgetReplacement(record.artifact, record.reason);
  return {
    kind: "tool_result_budget_replacement",
    version: 1,
    replacement,
    replacementSha256: createHash("sha256").update(replacement).digest("hex"),
    record: {
      toolUseId: record.toolUseId,
      originalChars: record.originalChars,
      replacementChars: record.replacementChars,
      reason: record.reason,
      artifact: {
        id: record.artifact.id,
        relativePath: record.artifact.relativePath,
        bytes: record.artifact.bytes,
        chars: record.artifact.chars,
        sha256: record.artifact.sha256,
        previewChars: record.artifact.previewChars,
        preview: record.artifact.preview,
        hasMore: record.artifact.hasMore,
      },
    },
  };
}

export function parseToolResultBudgetLedgerData(
  value: unknown,
): ToolResultBudgetLedgerData | undefined {
  if (!isRecord(value) || value.kind !== "tool_result_budget_replacement" || value.version !== 1) {
    return undefined;
  }
  if (
    typeof value.replacement !== "string" ||
    typeof value.replacementSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value.replacementSha256) ||
    !isRecord(value.record)
  ) {
    return undefined;
  }
  const record = value.record;
  const artifact = isRecord(record.artifact) ? record.artifact : undefined;
  if (
    typeof record.toolUseId !== "string" ||
    !isNonNegativeNumber(record.originalChars) ||
    !isNonNegativeNumber(record.replacementChars) ||
    (record.reason !== "single_result" &&
      record.reason !== "aggregate_message" &&
      record.reason !== "pressure_age") ||
    !artifact ||
    typeof artifact.id !== "string" ||
    artifact.id.length === 0 ||
    typeof artifact.relativePath !== "string" ||
    artifact.relativePath.length === 0 ||
    !isNonNegativeNumber(artifact.bytes) ||
    !isNonNegativeNumber(artifact.chars) ||
    typeof artifact.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(artifact.sha256) ||
    !isNonNegativeNumber(artifact.previewChars) ||
    typeof artifact.preview !== "string" ||
    typeof artifact.hasMore !== "boolean"
  ) {
    return undefined;
  }
  const parsedArtifact: ToolResultBudgetArtifact = {
    id: artifact.id,
    toolUseId: record.toolUseId,
    path: artifact.relativePath,
    relativePath: artifact.relativePath,
    bytes: artifact.bytes,
    chars: artifact.chars,
    sha256: artifact.sha256,
    previewChars: artifact.previewChars,
    preview: artifact.preview,
    hasMore: artifact.hasMore,
  };
  const expectedReplacement = formatToolResultBudgetReplacement(
    parsedArtifact,
    record.reason,
  );
  const legacyReplacement = formatToolResultBudgetReplacementInternal(
    parsedArtifact,
    record.toolUseId,
    record.reason,
  );
  if (
    record.originalChars !== artifact.chars ||
    record.replacementChars !== value.replacement.length ||
    artifact.previewChars !== artifact.preview.length ||
    (value.replacement !== expectedReplacement && value.replacement !== legacyReplacement) ||
    value.replacement.length > TOOL_RESULT_SUMMARY_ESTIMATE_CHARS + 2_000 ||
    createHash("sha256").update(value.replacement).digest("hex") !== value.replacementSha256
  ) {
    return undefined;
  }
  return value as unknown as ToolResultBudgetLedgerData;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function replaceToolResults(
  messages: ModelMessage[],
  replacements: ReadonlyMap<string, string>,
): ModelMessage[] {
  let changed = false;
  const next = messages.map((message) => {
    if (message.role !== "tool") return message;
    const replacement = replacements.get(message.tool_call_id);
    if (!replacement || replacement === message.content) return message;
    changed = true;
    return { ...message, content: replacement };
  });
  return changed ? next : messages;
}

function isBudgetSummary(content: string): boolean {
  return content.startsWith("<persisted-tool-result>");
}

export function formatToolResultBudgetEvidenceSummary(record: ToolResultBudgetRecord): string {
  return `tool_result persisted artifact=${record.artifact.relativePath} toolUseId=${record.toolUseId} chars=${record.originalChars} bytes=${record.artifact.bytes} sha256=${record.artifact.sha256}`;
}

export function formatToolResultBudgetSystemEvent(record: ToolResultBudgetRecord): string {
  return `tool_result_budget_persisted evidence artifact=${basename(record.artifact.path)} toolUseId=${record.toolUseId} reason=${record.reason} chars=${record.originalChars} sha256=${record.artifact.sha256}`;
}
