import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  appendMemoryTombstone,
  isMemoryTombstoned,
  loadMemoryTombstoneScope,
  parseMemoryOrigin,
} from "./memory-tombstone-runtime.js";
import { MEMORY_LEARNING_STATE_FILE } from "./runtime-utils.js";
import { formatError, truncateDisplay } from "./startup-runtime.js";
import type {
  MemoryCandidate,
  MemoryScope,
  MemoryTaxonomy,
  MemoryTombstoneIndex,
} from "./tui-data-types.js";

export const MEMORY_MANIFEST_FILE = "MEMORY.md";
const MEMORY_TOPICS_DIR = "topics";
const MEMORY_SUMMARY_WIDTH = 240;
const TOPIC_BODY_WIDTH = 800;
const MEMORY_WRITE_LOCK_DIR = ".write.lock";
const MEMORY_WRITE_LOCK_OWNER_FILE = "owner.json";
const MEMORY_WRITE_LOCK_STALE_MS = 30_000;
const MEMORY_WRITE_LOCK_DEADLINE_MS = 60_000;
const MEMORY_WRITE_LOCK_HEARTBEAT_MS = 5_000;
const MEMORY_WRITE_LOCK_CLEANUP_BATCH_SIZE = 32;

export const MEMORY_TAXONOMY: readonly MemoryTaxonomy[] = [
  "user",
  "feedback",
  "project",
  "reference",
];

const UNSAVEABLE_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  {
    id: "code_structure",
    pattern: /\b(?:src|packages|apps|docs)[\\/][\w./-]+|(?:function|class|interface|type)\s+\w+/iu,
  },
  {
    id: "git_history",
    pattern: /\b(?:git log|commit|branch|rebase|merge|stash|HEAD|SHA)\b|[a-f0-9]{7,40}/iu,
  },
  {
    id: "temporary_task",
    pattern: /(?:本轮|当前阶段|临时|todo|next step|handoff|pre-smoke\s+\d|阶段进度|交付文档)/iu,
  },
  {
    id: "debug_recipe",
    pattern: /(?:复现步骤|debug|stack trace|完整日志|error log|traceback|报错全文|stdout|stderr)/iu,
  },
  {
    id: "existing_rule",
    pattern: /(?:AGENTS\.md|LINGHUN\.md|已有规则|全局工作规则|project-doc)/iu,
  },
  {
    id: "secret",
    pattern:
      /(?:api[_-]?key|token|secret|password|credential|authorization|sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{20,}|-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----)/iu,
  },
  {
    id: "full_dump",
    pattern:
      /(?:完整 transcript|完整索引|完整日志|raw tool_result|raw evidence|full transcript|full index)/iu,
  },
];

type MemoryManifestEntry = {
  id: string;
  taxonomy: MemoryTaxonomy;
  topic: string;
  scope: Exclude<MemoryScope, "session">;
  summary: string;
  status: "accepted" | "disabled";
  updatedAt: string;
};

export type MemoryExtractionDecision =
  | { action: "no-op"; reason: string; blockedBy?: string }
  | {
      action: "create" | "update" | "delete";
      id: string;
      taxonomy: MemoryTaxonomy;
      topic: string;
      scope: Exclude<MemoryScope, "session">;
      summary: string;
      source: string;
      sourceRefs: string[];
      matchedExistingId?: string;
    };

export type MemoryExtractionInput = {
  recentMessages: string[];
  accepted: MemoryCandidate[];
  disabled: MemoryCandidate[];
  candidates?: MemoryCandidate[];
  now?: Date;
};

export type PersistentMemorySnapshot = {
  records: MemoryCandidate[];
  tombstones: MemoryTombstoneIndex;
  updatedAtById: Record<string, number>;
};

export type PersistentMemoryCommitResult = PersistentMemorySnapshot & {
  status: "committed" | "stale" | "tombstoned" | "conflict";
  memory?: MemoryCandidate;
  warnings?: string[];
};

export type PersistentMemoryMutation =
  | {
      action: "upsert";
      next: MemoryCandidate;
      expected?: MemoryCandidate;
      commitGuard?: () => boolean;
      learningStateDirectory?: string;
    }
  | {
      action: "delete";
      expected: MemoryCandidate;
      deletion: { sessionId: string; requestTurnId?: string };
      commitGuard?: () => boolean;
      learningStateDirectory?: string;
    };

export type MemoryExtractionApplyResult = {
  decision: MemoryExtractionDecision;
  memory?: MemoryCandidate;
};

export function decideMemoryExtraction(input: MemoryExtractionInput): MemoryExtractionDecision {
  const text = input.recentMessages
    .map((item) => item.trim())
    .filter(Boolean)
    .join("\n");
  if (text.length < 8) return { action: "no-op", reason: "empty_or_too_short" };
  if (text.length > 2400) return { action: "no-op", reason: "too_long_for_safe_extraction" };

  const blocked = findUnsavableReason(text);
  if (blocked) return { action: "no-op", reason: "unsaveable_content", blockedBy: blocked };
  if (isMemoryLookupQuestion(text)) {
    return { action: "no-op", reason: "memory_lookup_question" };
  }

  const taxonomy = classifyTaxonomy(text);
  if (!taxonomy) return { action: "no-op", reason: "no_long_lived_fact" };

  if (isMemoryForgetRequest(text)) {
    const existing = findRelatedMemoryForIntent(input.accepted, taxonomy, text);
    if (!existing) return { action: "no-op", reason: "memory_forget_target_not_found" };
    return {
      action: "delete",
      id: existing.id,
      taxonomy: existing.taxonomy ?? taxonomy,
      topic: existing.topic ?? topicForSummary(existing.summary, existing.taxonomy ?? taxonomy),
      scope: existing.scope === "session" ? "project" : existing.scope,
      summary: existing.summary,
      source: "memory-extraction:turn",
      sourceRefs: ["turn:recent"],
      matchedExistingId: existing.id,
    };
  }

  const summary = summarizeLongLivedFact(text, taxonomy);
  if (!summary) return { action: "no-op", reason: "insufficient_specificity" };
  const summaryBlocked = findUnsavableReason(summary);
  if (summaryBlocked) {
    return { action: "no-op", reason: "unsaveable_summary", blockedBy: summaryBlocked };
  }

  const topic = topicForSummary(summary, taxonomy);
  const disabled = findRelatedMemory(input.disabled, taxonomy, topic, summary);
  if (disabled) {
    return { action: "no-op", reason: "disabled_existing_memory" };
  }

  const updateRequest = isMemoryUpdateRequest(text);
  const existing = updateRequest
    ? findRelatedMemoryForIntent(input.accepted, taxonomy, text, summary)
    : findRelatedMemory(input.accepted, taxonomy, topic, summary);
  if (updateRequest && !existing) {
    return { action: "no-op", reason: "memory_update_target_not_found" };
  }
  const duplicate = findRelatedMemory(
    [...input.accepted, ...input.disabled, ...(input.candidates ?? [])],
    taxonomy,
    topic,
    summary,
  );
  if (duplicate && normalizeText(duplicate.summary) === normalizeText(summary)) {
    return { action: "no-op", reason: "duplicate_existing_memory" };
  }

  return {
    action: existing ? "update" : "create",
    id: existing?.id ?? randomUUID(),
    taxonomy,
    topic,
    scope: taxonomy === "user" || taxonomy === "feedback" ? "user" : "project",
    summary,
    source: "memory-extraction:turn",
    sourceRefs: ["turn:recent"],
    ...(existing ? { matchedExistingId: existing.id } : {}),
  };
}

export async function applyMemoryExtractionDecision(input: {
  decision: MemoryExtractionDecision;
  existing?: MemoryCandidate;
  now?: Date;
}): Promise<MemoryExtractionApplyResult> {
  if (input.decision.action === "no-op") {
    return { decision: input.decision };
  }
  if (input.decision.action === "delete") {
    return { decision: input.decision };
  }
  const now = (input.now ?? new Date()).toISOString();
  const memory: MemoryCandidate = {
    ...(input.existing ?? {}),
    id: input.decision.id,
    scope: input.decision.scope,
    status: "accepted",
    taxonomy: input.decision.taxonomy,
    topic: input.decision.topic,
    summary: input.decision.summary,
    source: input.decision.source,
    sourceRefs: input.decision.sourceRefs,
    risk: "low",
    inferred: true,
    createdAt: input.existing?.createdAt ?? now,
  };
  return { decision: input.decision, memory };
}

type PersistentMemoryRecord = {
  memory: MemoryCandidate;
  path: string;
  mtimeMs: number;
};

type PersistentMemoryLoad = PersistentMemorySnapshot & {
  detailed: PersistentMemoryRecord[];
  duplicatePaths: string[];
};

export async function loadPersistentMemorySnapshot(
  memoryDir: string,
  scope: Exclude<MemoryScope, "session">,
): Promise<PersistentMemorySnapshot> {
  return withMemoryDirectoryLock(memoryDir, async () => {
    await recoverMemoryReplacementArtifacts(memoryDir);
    const loaded = await loadPersistentMemoryRecords(memoryDir, scope);
    return {
      records: loaded.records,
      tombstones: loaded.tombstones,
      updatedAtById: loaded.updatedAtById,
    };
  });
}

export async function writePersistentMemoryLearningState(
  memoryDir: string,
  content: string,
): Promise<void> {
  await withMemoryDirectoryLock(memoryDir, async (lockToken) => {
    await recoverMemoryReplacementArtifacts(memoryDir);
    await assertMemoryLockOwned(memoryDir, lockToken);
    await atomicWriteMemoryFile(
      join(memoryDir, MEMORY_LEARNING_STATE_FILE),
      content,
      lockToken,
    );
  });
}

export async function readPersistentMemoryLearningState(memoryDir: string): Promise<{
  learningMode: "active" | "off";
  learningModeSource: "persisted";
  learningModeDiagnostic?: string;
} | null> {
  try {
    return await withMemoryDirectoryLock(memoryDir, async () => {
      await recoverMemoryReplacementArtifacts(memoryDir);
      return readPersistentMemoryLearningStateLocked(memoryDir);
    });
  } catch (error) {
    return {
      learningMode: "off",
      learningModeSource: "persisted",
      learningModeDiagnostic: `learning-state unreadable; auto-learning fail-closed off: ${formatError(error)}`,
    };
  }
}

export async function commitPersistentMemoryMutation(
  memoryDir: string,
  scope: Exclude<MemoryScope, "session">,
  mutation: PersistentMemoryMutation,
): Promise<PersistentMemoryCommitResult> {
  let learningModeAllowsCommit = true;
  const commit = async (lockToken: string): Promise<PersistentMemoryCommitResult> => {
    if (!learningModeAllowsCommit || (mutation.commitGuard && !mutation.commitGuard())) {
      const snapshot = await loadPersistentMemoryRecords(memoryDir, scope);
      return {
        status: "stale",
        records: snapshot.records,
        tombstones: snapshot.tombstones,
        updatedAtById: snapshot.updatedAtById,
      };
    }
    await recoverMemoryReplacementArtifacts(memoryDir);
    const before = await loadPersistentMemoryRecords(memoryDir, scope);
    if (before.tombstones.unreadableScopes.has(scope)) {
      throw new Error(`memory tombstone ledger unreadable: ${memoryDir}`);
    }
    const current = before.detailed.find((record) => record.memory.id === mutation.expected?.id);
    if (mutation.expected && (!current || memoryRevision(current.memory) !== memoryRevision(mutation.expected))) {
      return { status: "stale", records: before.records, tombstones: before.tombstones, updatedAtById: before.updatedAtById };
    }
    if (mutation.commitGuard && !mutation.commitGuard()) {
      return { status: "stale", records: before.records, tombstones: before.tombstones, updatedAtById: before.updatedAtById };
    }

    let committedMemory: MemoryCandidate | undefined;
    if (mutation.action === "upsert") {
      if (isMemoryTombstoned(before.tombstones, mutation.next)) {
        return { status: "tombstoned", records: before.records, tombstones: before.tombstones, updatedAtById: before.updatedAtById };
      }
      const key = persistentMemoryLogicalKey(mutation.next);
      const conflicting = key
        ? before.detailed.find(
            (record) => persistentMemoryLogicalKey(record.memory) === key && record.memory.id !== mutation.next.id,
          )
        : undefined;
      if (conflicting) {
        return { status: "conflict", records: before.records, tombstones: before.tombstones, updatedAtById: before.updatedAtById };
      }
      await assertMemoryLockOwned(memoryDir, lockToken);
      const committed = await atomicWriteMemoryFile(
        join(memoryDir, `${mutation.next.id}.json`),
        `${JSON.stringify(mutation.next, null, 2)}\n`,
        lockToken,
        mutation.commitGuard,
      );
      if (!committed) {
        return { status: "stale", records: before.records, tombstones: before.tombstones, updatedAtById: before.updatedAtById };
      }
      committedMemory = mutation.next;
    } else {
      await assertMemoryLockOwned(memoryDir, lockToken);
      const tombstone = await appendMemoryTombstone({
        directory: memoryDir,
        memory: mutation.expected,
        sessionId: mutation.deletion.sessionId,
        requestTurnId: mutation.deletion.requestTurnId,
        commitGuard: mutation.commitGuard,
      });
      if (!tombstone) {
        return { status: "stale", records: before.records, tombstones: before.tombstones, updatedAtById: before.updatedAtById };
      }
      await assertMemoryLockOwned(memoryDir, lockToken);
      await rm(join(memoryDir, `${mutation.expected.id}.json`), { force: true });
    }
    await assertMemoryLockOwned(memoryDir, lockToken);
    for (const duplicatePath of before.duplicatePaths) {
      await rm(duplicatePath, { force: true });
    }

    const after = await loadPersistentMemoryRecords(memoryDir, scope);
    const warnings: string[] = [];
    await rebuildAutoMemoryFiles(memoryDir, after.detailed, lockToken).catch((error) => {
      warnings.push(`memory derived index rebuild failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    return {
      status: "committed",
      memory: committedMemory,
      records: after.records,
      tombstones: after.tombstones,
      updatedAtById: after.updatedAtById,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  };
  const learningStateDirectory = mutation.learningStateDirectory;
  if (!learningStateDirectory) {
    return withMemoryDirectoryLock(memoryDir, commit);
  }
  return withMemoryDirectoryLock(learningStateDirectory, async (learningLockToken) => {
    await recoverMemoryReplacementArtifacts(learningStateDirectory);
    const learningState = await readPersistentMemoryLearningStateLocked(learningStateDirectory);
    learningModeAllowsCommit = !learningState || learningState.learningMode === "active";
    if (learningStateDirectory === memoryDir) {
      return commit(learningLockToken);
    }
    return withMemoryDirectoryLock(memoryDir, commit);
  });
}

async function readPersistentMemoryLearningStateLocked(memoryDir: string): Promise<{
  learningMode: "active" | "off";
  learningModeSource: "persisted";
  learningModeDiagnostic?: string;
} | null> {
  let raw: string;
  try {
    raw = await readFile(join(memoryDir, MEMORY_LEARNING_STATE_FILE), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    const value = JSON.parse(raw) as { learningMode?: unknown };
    if (value.learningMode === "active" || value.learningMode === "off") {
      return { learningMode: value.learningMode, learningModeSource: "persisted" };
    }
  } catch {
    // handled by the fail-closed result below
  }
  return {
    learningMode: "off",
    learningModeSource: "persisted",
    learningModeDiagnostic: "learning-state invalid; auto-learning fail-closed off",
  };
}

async function loadPersistentMemoryRecords(
  memoryDir: string,
  scope: Exclude<MemoryScope, "session">,
): Promise<PersistentMemoryLoad> {
  const tombstones = await loadMemoryTombstoneScope(memoryDir, scope);
  const entries = await readdir(memoryDir, { withFileTypes: true }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  const detailed = await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isFile() && entry.name.endsWith(".json") && entry.name !== MEMORY_LEARNING_STATE_FILE,
      )
      .map((entry) => readPersistentMemoryRecord(join(memoryDir, entry.name), scope)),
  );
  const visible = detailed.filter((record) => !isMemoryTombstoned(tombstones, record.memory));
  const winners = new Map<string, PersistentMemoryRecord>();
  const duplicatePaths: string[] = detailed
    .filter((record) => isMemoryTombstoned(tombstones, record.memory))
    .map((record) => record.path);
  for (const record of visible) {
    const key = persistentMemoryLogicalKey(record.memory) ?? `id\u0000${record.memory.id}`;
    const previous = winners.get(key);
    if (!previous) {
      winners.set(key, record);
      continue;
    }
    const recordWins = record.mtimeMs > previous.mtimeMs ||
      (record.mtimeMs === previous.mtimeMs && record.memory.id.localeCompare(previous.memory.id) < 0);
    if (recordWins) {
      duplicatePaths.push(previous.path);
      winners.set(key, record);
    } else {
      duplicatePaths.push(record.path);
    }
  }
  const selected = [...winners.values()].sort(
    (left, right) => right.mtimeMs - left.mtimeMs || left.memory.id.localeCompare(right.memory.id),
  );
  return {
    records: selected.map((record) => record.memory),
    tombstones,
    updatedAtById: Object.fromEntries(selected.map((record) => [record.memory.id, record.mtimeMs])),
    detailed: selected,
    duplicatePaths,
  };
}

async function readPersistentMemoryRecord(
  path: string,
  expectedScope: Exclude<MemoryScope, "session">,
): Promise<PersistentMemoryRecord> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const before = await stat(path);
    const content = await readFile(path, "utf8");
    const after = await stat(path);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) continue;
    const memory = parsePersistentMemoryCandidate(JSON.parse(content) as unknown, expectedScope, path);
    return { memory, path, mtimeMs: after.mtimeMs };
  }
  throw new Error(`memory record changed while reading: ${path}`);
}

function parsePersistentMemoryCandidate(
  value: unknown,
  expectedScope: Exclude<MemoryScope, "session">,
  path: string,
): MemoryCandidate {
  if (!value || typeof value !== "object") throw new Error(`invalid memory record: ${path}`);
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    record.scope !== expectedScope ||
    (record.status !== "candidate" &&
      record.status !== "accepted" &&
      record.status !== "rejected" &&
      record.status !== "disabled" &&
      record.status !== "retired") ||
    typeof record.summary !== "string" ||
    typeof record.source !== "string" ||
    !Array.isArray(record.sourceRefs) ||
    record.sourceRefs.some((item) => typeof item !== "string") ||
    (record.risk !== "low" && record.risk !== "medium" && record.risk !== "high") ||
    typeof record.inferred !== "boolean" ||
    typeof record.createdAt !== "string"
  ) {
    throw new Error(`invalid memory record: ${path}`);
  }
  const taxonomy = MEMORY_TAXONOMY.includes(record.taxonomy as MemoryTaxonomy)
    ? (record.taxonomy as MemoryTaxonomy)
    : undefined;
  const origin = record.origin === undefined ? undefined : parseMemoryOrigin(record.origin);
  if (record.origin !== undefined && !origin) throw new Error(`invalid memory origin: ${path}`);
  return {
    id: record.id,
    scope: expectedScope,
    status: record.status,
    ...(taxonomy ? { taxonomy } : {}),
    ...(typeof record.topic === "string" ? { topic: record.topic } : {}),
    summary: record.summary,
    source: record.source,
    sourceRefs: record.sourceRefs as string[],
    ...(origin ? { origin } : {}),
    risk: record.risk,
    inferred: record.inferred,
    createdAt: record.createdAt,
  };
}

function persistentMemoryLogicalKey(memory: MemoryCandidate): string | undefined {
  if (memory.scope === "session" || !memory.taxonomy || !memory.topic) return undefined;
  return `${memory.scope}\u0000${memory.taxonomy}\u0000${memory.topic}`;
}

function memoryRevision(memory: MemoryCandidate): string {
  return createHash("sha256").update(stableSerialize(memory), "utf8").digest("hex");
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

async function rebuildAutoMemoryFiles(
  memoryDir: string,
  records: PersistentMemoryRecord[],
  lockToken: string,
): Promise<void> {
  const active = records.filter(
    (record) =>
      (record.memory.status === "accepted" || record.memory.status === "disabled") &&
      record.memory.taxonomy &&
      record.memory.topic,
  );
  const topicsDir = join(memoryDir, MEMORY_TOPICS_DIR);
  await mkdir(topicsDir, { recursive: true });
  const desiredTopics = new Set<string>();
  const manifest: MemoryManifestEntry[] = [];
  for (const record of active) {
    const memory = record.memory;
    const topic = memory.topic!;
    const updatedAt = new Date(record.mtimeMs).toISOString();
    desiredTopics.add(`${topic}.md`);
    await atomicWriteMemoryFile(
      join(topicsDir, `${topic}.md`),
      formatTopicMarkdown(memory, updatedAt),
      lockToken,
    );
    manifest.push({
      id: memory.id,
      taxonomy: memory.taxonomy!,
      topic,
      scope: memory.scope as Exclude<MemoryScope, "session">,
      summary: memory.summary,
      status: memory.status as "accepted" | "disabled",
      updatedAt,
    });
  }
  const topicEntries = await readdir(topicsDir, { withFileTypes: true });
  for (const entry of topicEntries) {
    if (entry.isFile() && entry.name.endsWith(".md") && !desiredTopics.has(entry.name)) {
      await rm(join(topicsDir, entry.name), { force: true });
    }
  }
  await writeManifest(memoryDir, manifest.sort((left, right) => left.topic.localeCompare(right.topic)), lockToken);
}

export async function atomicWriteMemoryFile(
  path: string,
  content: string,
  lockToken: string,
  commitGuard?: () => boolean,
): Promise<boolean> {
  const stagingPath = `${path}.tmp-${lockToken}-${randomUUID()}`;
  const backupPath = `${path}.bak-${lockToken}`;
  await writeFile(stagingPath, content, "utf8");
  try {
    if (commitGuard && !commitGuard()) return false;
    await rename(stagingPath, path);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST" && code !== "EPERM") throw error;
    if (commitGuard && !commitGuard()) return false;
    let backedUp = false;
    try {
      await rename(path, backupPath);
      backedUp = true;
    } catch (backupError) {
      if ((backupError as NodeJS.ErrnoException).code !== "ENOENT") throw backupError;
    }
    try {
      if (commitGuard && !commitGuard()) {
        if (backedUp) await rename(backupPath, path);
        return false;
      }
      await rename(stagingPath, path);
      if (backedUp) await rm(backupPath, { force: true });
      return true;
    } catch (replaceError) {
      if (backedUp) await rename(backupPath, path).catch(() => undefined);
      throw replaceError;
    }
  } finally {
    await rm(stagingPath, { force: true }).catch(() => undefined);
  }
}

export async function recoverMemoryReplacementArtifacts(memoryDir: string): Promise<void> {
  for (const directory of [memoryDir, join(memoryDir, MEMORY_TOPICS_DIR)]) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const backupIndex = entry.name.indexOf(".bak-");
      if (backupIndex >= 0) {
        const backupPath = join(directory, entry.name);
        const targetPath = join(directory, entry.name.slice(0, backupIndex));
        const targetExists = await stat(targetPath).then(() => true).catch(() => false);
        if (targetExists) await rm(backupPath, { force: true });
        else await rename(backupPath, targetPath);
      } else if (entry.name.includes(".tmp-")) {
        await rm(join(directory, entry.name), { force: true });
      }
    }
  }
}

type MemoryLockOwner = {
  token: string;
  pid: number;
  createdAt: number;
  heartbeatAt: number;
};

export async function withMemoryDirectoryLock<T>(
  memoryDir: string,
  run: (lockToken: string) => Promise<T>,
): Promise<T> {
  await mkdir(memoryDir, { recursive: true });
  const lockPath = join(memoryDir, MEMORY_WRITE_LOCK_DIR);
  const preparePrefix = `${MEMORY_WRITE_LOCK_DIR}.prepare-`;
  const stalePreparations = (await readdir(memoryDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(preparePrefix))
    .map((entry) => join(memoryDir, entry.name));
  for (
    let offset = 0;
    offset < stalePreparations.length;
    offset += MEMORY_WRITE_LOCK_CLEANUP_BATCH_SIZE
  ) {
    await Promise.all(
      stalePreparations
        .slice(offset, offset + MEMORY_WRITE_LOCK_CLEANUP_BATCH_SIZE)
        .map((path) => quarantineStaleMemoryLock(path)),
    );
  }
  const ownerPath = join(lockPath, MEMORY_WRITE_LOCK_OWNER_FILE);
  const token = randomUUID();
  const deadline = Date.now() + MEMORY_WRITE_LOCK_DEADLINE_MS;
  const owner: MemoryLockOwner = {
    token,
    pid: process.pid,
    createdAt: Date.now(),
    heartbeatAt: Date.now(),
  };
  let acquired = false;
  try {
    let delayMs = 10;
    while (true) {
      try {
        await mkdir(lockPath);
        acquired = true;
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (await quarantineStaleMemoryLock(lockPath)) continue;
        if (Date.now() >= deadline) throw new Error(`memory write lock timeout: ${memoryDir}`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        delayMs = Math.min(50, delayMs * 2);
      }
    }
    const ownerTempPath = `${ownerPath}.tmp-${token}`;
    await writeFile(ownerTempPath, JSON.stringify(owner), "utf8");
    try {
      await rename(ownerTempPath, ownerPath);
    } finally {
      await rm(ownerTempPath, { force: true }).catch(() => undefined);
    }
  } catch (error) {
    if (acquired) {
      await rm(lockPath, { recursive: true, force: true }).catch(() => undefined);
    }
    throw error;
  }
  const heartbeat = setInterval(() => {
    owner.heartbeatAt = Date.now();
    const now = new Date(owner.heartbeatAt);
    void utimes(lockPath, now, now).catch(() => undefined);
  }, MEMORY_WRITE_LOCK_HEARTBEAT_MS);
  heartbeat.unref?.();
  try {
    return await run(token);
  } finally {
    clearInterval(heartbeat);
    await releaseMemoryDirectoryLock(lockPath, ownerPath, token);
  }
}

async function releaseMemoryDirectoryLock(
  lockPath: string,
  ownerPath: string,
  token: string,
): Promise<void> {
  const releasePath = `${lockPath}.release-${token}`;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const current = await readMemoryLockOwner(ownerPath);
    if (!current) {
      try {
        await stat(lockPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
      continue;
    }
    if (current.token !== token) return;
    try {
      await rename(lockPath, releasePath);
      await rm(releasePath, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY") return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`memory write lock release timeout: ${lockPath}`);
}

async function quarantineStaleMemoryLock(lockPath: string): Promise<boolean> {
  const ownerPath = join(lockPath, MEMORY_WRITE_LOCK_OWNER_FILE);
  const first = await readMemoryLockOwner(ownerPath);
  const firstHeartbeat = await stat(lockPath).then((value) => value.mtimeMs).catch(() => Date.now());
  if (Date.now() - firstHeartbeat <= MEMORY_WRITE_LOCK_STALE_MS) return false;
  await new Promise((resolve) => setTimeout(resolve, 25));
  const second = await readMemoryLockOwner(ownerPath);
  const secondHeartbeat = await stat(lockPath).then((value) => value.mtimeMs).catch(() => Date.now());
  if (firstHeartbeat !== secondHeartbeat) return false;
  if (first || second) {
    if (!first || !second || first.token !== second.token) return false;
    if (isProcessAlive(second.pid)) return false;
  }
  const quarantinePath = `${lockPath}.stale-${second?.token ?? randomUUID()}`;
  try {
    await rename(lockPath, quarantinePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    return false;
  }
  await rm(quarantinePath, { recursive: true, force: true });
  return true;
}

async function assertMemoryLockOwned(memoryDir: string, token: string): Promise<void> {
  const owner = await readMemoryLockOwner(
    join(memoryDir, MEMORY_WRITE_LOCK_DIR, MEMORY_WRITE_LOCK_OWNER_FILE),
  );
  if (owner?.token !== token) throw new Error(`memory write lock ownership lost: ${memoryDir}`);
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readMemoryLockOwner(path: string): Promise<MemoryLockOwner | undefined> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as Partial<MemoryLockOwner>;
    return typeof value.token === "string" && typeof value.heartbeatAt === "number"
      ? {
          token: value.token,
          pid: typeof value.pid === "number" ? value.pid : 0,
          createdAt: typeof value.createdAt === "number" ? value.createdAt : value.heartbeatAt,
          heartbeatAt: value.heartbeatAt,
        }
      : undefined;
  } catch {
    return undefined;
  }
}

export function findUnsavableReason(text: string): string | undefined {
  return UNSAVEABLE_PATTERNS.find((item) => item.pattern.test(text))?.id;
}

function isMemoryLookupQuestion(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  return (
    /(?:我(?:的|有没有|是否|之前|刚才)?.{0,30}(?:偏好|习惯|喜欢|希望|记住|记忆).{0,40}(?:什么|吗|？|\?))/iu.test(
      normalized,
    ) ||
    /(?:what(?:'s| is).{0,40}(?:my|user).{0,30}(?:preference|default|memory)|did you remember.{0,60}(?:my|that))/iu.test(
      normalized,
    )
  );
}

function isMemoryForgetRequest(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  return (
    /(?:忘记|删除|清除|移除).{0,80}(?:偏好|习惯|喜欢|希望|记忆|memory)/iu.test(normalized) ||
    /(?:不要|别|不再).{0,12}(?:记住|保存).{0,80}(?:偏好|习惯|喜欢|希望|记忆)/iu.test(
      normalized,
    ) ||
    /(?:我不再|不再).{0,12}(?:偏好|喜欢|希望)/iu.test(normalized) ||
    /(?:forget|delete|remove|clear).{0,80}(?:my|user)?.{0,30}(?:preference|memory|habit)/iu.test(
      normalized,
    )
  );
}

function isMemoryUpdateRequest(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  return (
    /(?:更新为|改成|改为|换成)/iu.test(normalized) ||
    /(?:update|change|switch).{0,80}\bto\b/iu.test(normalized)
  );
}

function classifyTaxonomy(text: string): MemoryTaxonomy | undefined {
  if (
    /(?:反馈|不喜欢|太啰嗦|太慢|少废话|别空泛|feedback|too verbose|too slow|no fluff)/iu.test(text)
  ) {
    return "feedback";
  }
  if (
    /(?:我(?:习惯|偏好|喜欢|希望)|我的|用户偏好|prefer|preference|my default|i like|i usually)/iu.test(
      text,
    )
  ) {
    return "user";
  }
  if (
    /(?:本项目|这个项目|仓库|workspace|project uses|project should|项目约定|验证命令|默认命令)/iu.test(
      text,
    )
  ) {
    return "project";
  }
  if (/(?:参考|reference|文档|manual|external docs|公开行为|成熟行为)/iu.test(text)) {
    return "reference";
  }
  return undefined;
}

function summarizeLongLivedFact(text: string, taxonomy: MemoryTaxonomy): string | undefined {
  const normalized = text.replace(/\s+/g, " ").trim();
  const updateSummary = summarizeUpdateRequest(normalized, taxonomy);
  if (updateSummary) return updateSummary;
  const explicit =
    normalized.match(/(?:记住|remember|长期记忆|保存为记忆)[:：]?\s*(.{8,180})/iu)?.[1] ??
    normalized.match(
      /(?:我(?:习惯|偏好|喜欢|希望)|prefer|preference|my default|i like|i usually)[:：]?\s*(.{8,180})/iu,
    )?.[1] ??
    normalized.match(
      /(?:本项目|这个项目|项目约定|project uses|project should)[:：]?\s*(.{8,180})/iu,
    )?.[1] ??
    normalized.match(/(?:反馈|feedback)[:：]?\s*(.{8,180})/iu)?.[1];
  const candidate = (explicit ?? normalized).trim();
  if (candidate.length < 8) return undefined;
  const prefix =
    taxonomy === "feedback"
      ? "User feedback"
      : taxonomy === "user"
        ? "User preference"
        : taxonomy === "reference"
          ? "Reference note"
          : "Project memory";
  return truncateDisplay(`${prefix}: ${candidate}`, MEMORY_SUMMARY_WIDTH);
}

function summarizeUpdateRequest(text: string, taxonomy: MemoryTaxonomy): string | undefined {
  if (!isMemoryUpdateRequest(text)) return undefined;
  const match =
    text.match(/(?:请)?(?:把|将)?(.{2,80}?)(?:更新为|改成|改为|换成)\s*(.{2,120})/iu) ??
    text.match(/(?:update|change|switch)\s+(.{2,80}?)\s+to\s+(.{2,120})/iu);
  if (!match) return undefined;
  const subject = cleanUpdateSubject(match[1] ?? "");
  const value = cleanUpdateValue(match[2] ?? "");
  if (!subject || !value) return undefined;
  const prefix =
    taxonomy === "feedback"
      ? "User feedback"
      : taxonomy === "user"
        ? "User preference"
        : taxonomy === "reference"
          ? "Reference note"
          : "Project memory";
  return truncateDisplay(`${prefix}: ${subject}：${value}`, MEMORY_SUMMARY_WIDTH);
}

function cleanUpdateSubject(text: string): string {
  return text
    .replace(/^(?:请|please)\s*/iu, "")
    .replace(/^(?:把|将)\s*/u, "")
    .replace(/^(?:我(?:的|偏好的|偏好)?|my)\s*/iu, "")
    .replace(/^(?:用户)?(?:偏好|preference)\s*/iu, "")
    .replace(/[，,。.\s:：]+$/u, "")
    .trim();
}

function cleanUpdateValue(text: string): string {
  return text.replace(/[，,。.\s]+$/u, "").trim();
}

function findRelatedMemory(
  memories: MemoryCandidate[],
  taxonomy: MemoryTaxonomy,
  topic: string,
  summary: string,
): MemoryCandidate | undefined {
  return memories.find((item) => {
    if (item.taxonomy && item.taxonomy !== taxonomy) return false;
    if (item.topic && item.topic === topic) return true;
    if (hasMeaningfulOverlap(item.summary, summary)) return true;
    return normalizeText(item.summary) === normalizeText(summary);
  });
}

function findRelatedMemoryForIntent(
  memories: MemoryCandidate[],
  taxonomy: MemoryTaxonomy,
  text: string,
  summary?: string,
): MemoryCandidate | undefined {
  return memories.find((item) => {
    if (item.taxonomy && item.taxonomy !== taxonomy) return false;
    if (
      summary &&
      findRelatedMemory([item], taxonomy, topicForSummary(summary, taxonomy), summary)
    ) {
      return true;
    }
    return hasIntentOverlap(item.summary, text);
  });
}

function hasIntentOverlap(summary: string, text: string): boolean {
  const left = intentTokens(summary);
  const right = intentTokens(text);
  let wordOverlap = 0;
  for (const word of left.words) {
    if (right.words.has(word)) wordOverlap += 1;
  }
  let cjkOverlap = 0;
  for (const char of left.cjkChars) {
    if (right.cjkChars.has(char)) cjkOverlap += 1;
  }
  return wordOverlap >= 1 || cjkOverlap >= 4;
}

function intentTokens(text: string): { words: Set<string>; cjkChars: Set<string> } {
  const normalized = normalizeText(text)
    .replace(
      /(?:user|preference|feedback|project|memory|reference|用户|偏好|习惯|喜欢|希望|记忆|请|把|将|忘记|删除|清除|移除|不要|别|不再|记住|保存|更新为|改成|改为|换成|格式|为|用)/giu,
      " ",
    )
    .replace(/\s+/g, " ");
  return {
    words: new Set(
      normalized
        .split(/[^a-z0-9]+/iu)
        .filter((word) => word.length >= 3)
        .filter((word) => !["the", "and", "for", "with"].includes(word)),
    ),
    cjkChars: new Set(Array.from(normalized.replace(/[^\u4e00-\u9fa5]/gu, ""))),
  };
}

function hasMeaningfulOverlap(left: string, right: string): boolean {
  const leftWords = keywords(left);
  const rightWords = keywords(right);
  if (leftWords.size === 0 || rightWords.size === 0) return false;
  let overlap = 0;
  for (const word of leftWords) {
    if (rightWords.has(word)) overlap += 1;
  }
  return overlap >= 2;
}

function keywords(text: string): Set<string> {
  return new Set(
    normalizeText(text)
      .split(/[^a-z0-9\u4e00-\u9fa5]+/iu)
      .filter((word) => word.length >= 2)
      .filter((word) => !["user", "preference", "project", "memory", "feedback"].includes(word)),
  );
}

export function topicForSummary(summary: string, taxonomy: MemoryTaxonomy): string {
  const normalized = normalizeText(summary)
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/giu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${taxonomy}-${normalized || "memory"}`;
}

function normalizeText(text: string): string {
  return text.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

async function writeManifest(
  memoryDir: string,
  entries: MemoryManifestEntry[],
  lockToken: string,
): Promise<void> {
  await mkdir(memoryDir, { recursive: true });
  await atomicWriteMemoryFile(
    join(memoryDir, MEMORY_MANIFEST_FILE),
    [
      "# Linghun Memory",
      "",
      "Long-lived auto memory index. LINGHUN.md remains project rules and is not rewritten here.",
      "",
      ...entries.map(
        (entry) =>
          `- [${entry.id}] (${entry.status}) ${entry.taxonomy}/${entry.topic}: ${truncateDisplay(entry.summary, MEMORY_SUMMARY_WIDTH)} (updated ${entry.updatedAt})`,
      ),
      "",
    ].join("\n"),
    lockToken,
  );
}

function formatTopicMarkdown(memory: MemoryCandidate, updatedAt: string): string {
  return [
    "---",
    `id: ${memory.id}`,
    `taxonomy: ${memory.taxonomy ?? "project"}`,
    `scope: ${memory.scope}`,
    `status: ${memory.status}`,
    `updatedAt: ${updatedAt}`,
    "---",
    "",
    `# ${memory.topic ?? "memory"}`,
    "",
    truncateDisplay(memory.summary.replace(/\s+/g, " "), TOPIC_BODY_WIDTH),
    "",
    `Source: ${memory.source}`,
    `Refs: ${memory.sourceRefs.slice(0, 6).join(", ") || "none"}`,
    "",
  ].join("\n");
}
