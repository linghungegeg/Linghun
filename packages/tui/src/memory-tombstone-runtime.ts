import { createHash, randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  MemoryCandidate,
  MemoryOrigin,
  MemoryScope,
  MemoryTombstoneIndex,
} from "./tui-data-types.js";

const MEMORY_TOMBSTONE_FILE = "tombstones.jsonl";

export type MemoryTombstone = {
  version: 1;
  eventId: string;
  memoryId: string;
  scope: "project" | "user";
  deletedAt: string;
  sessionId: string;
  requestTurnId?: string;
  origin?: MemoryOrigin;
};

export function createEmptyMemoryTombstoneIndex(): MemoryTombstoneIndex {
  return {
    ids: new Set(),
    origins: new Set(),
    unreadableScopes: new Set(),
    diagnostics: [],
  };
}

export async function loadMemoryTombstoneIndex(
  projectDirectory: string,
  userDirectory: string,
): Promise<MemoryTombstoneIndex> {
  const index = createEmptyMemoryTombstoneIndex();
  await Promise.all([
    loadMemoryTombstoneFile(projectDirectory, "project", index),
    loadMemoryTombstoneFile(userDirectory, "user", index),
  ]);
  return index;
}

export function isMemoryTombstoned(
  index: MemoryTombstoneIndex | undefined,
  memory: Pick<MemoryCandidate, "id" | "scope" | "origin">,
): boolean {
  if (!index || memory.scope === "session") return false;
  if (index.unreadableScopes.has(memory.scope)) return true;
  if (index.ids.has(memoryIdKey(memory.scope, memory.id))) return true;
  return Boolean(memory.origin && index.origins.has(memoryOriginKey(memory.scope, memory.origin)));
}

export async function appendMemoryTombstone(input: {
  directory: string;
  memory: MemoryCandidate;
  sessionId: string;
  requestTurnId?: string;
  commitGuard?: () => boolean;
}): Promise<MemoryTombstone | undefined> {
  if (input.memory.scope === "session") return undefined;
  if (input.commitGuard && !input.commitGuard()) return undefined;
  const tombstone: MemoryTombstone = {
    version: 1,
    eventId: randomUUID(),
    memoryId: input.memory.id,
    scope: input.memory.scope,
    deletedAt: new Date().toISOString(),
    sessionId: input.sessionId,
    ...(input.requestTurnId ? { requestTurnId: input.requestTurnId } : {}),
    ...(input.memory.origin ? { origin: input.memory.origin } : {}),
  };
  const path = join(input.directory, MEMORY_TOMBSTONE_FILE);
  if (input.commitGuard && !input.commitGuard()) return undefined;
  await mkdir(input.directory, { recursive: true });
  if (input.commitGuard && !input.commitGuard()) return undefined;
  const line = `${JSON.stringify(tombstone)}\n`;
  const stagingPath = `${path}.${tombstone.eventId}.tmp`;
  try {
    await writeFile(stagingPath, line, "utf8");
    if (input.commitGuard && !input.commitGuard()) return undefined;
    appendFileSync(path, line, "utf8");
    return tombstone;
  } finally {
    await rm(stagingPath, { force: true }).catch(() => undefined);
  }
}

export function rememberMemoryTombstone(
  index: MemoryTombstoneIndex | undefined,
  tombstone: MemoryTombstone | undefined,
): void {
  if (!index || !tombstone) return;
  index.ids.add(memoryIdKey(tombstone.scope, tombstone.memoryId));
  if (tombstone.origin) {
    index.origins.add(memoryOriginKey(tombstone.scope, tombstone.origin));
  }
}

export function createAiSessionsImportOrigin(source: string, query: string): MemoryOrigin {
  const canonical = JSON.stringify({
    kind: "ai_sessions_import",
    source: source.normalize("NFC").trim(),
    query: query.normalize("NFC").trim(),
  });
  return {
    kind: "ai_sessions_import",
    key: createHash("sha256").update(canonical, "utf8").digest("hex"),
  };
}

export function parseMemoryOrigin(value: unknown): MemoryOrigin | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind !== "ai_sessions_import") return undefined;
  if (typeof value.key !== "string" || !/^[a-f0-9]{64}$/u.test(value.key)) return undefined;
  return { kind: value.kind, key: value.key };
}

async function loadMemoryTombstoneFile(
  directory: string,
  scope: "project" | "user",
  index: MemoryTombstoneIndex,
): Promise<void> {
  const path = join(directory, MEMORY_TOMBSTONE_FILE);
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    index.unreadableScopes.add(scope);
    index.diagnostics.push(`${path}: read failed`);
    return;
  }
  for (const [lineIndex, line] of content.split(/\r?\n/u).entries()) {
    if (!line.trim()) continue;
    try {
      const tombstone = parseMemoryTombstone(JSON.parse(line) as unknown, scope);
      if (!tombstone) {
        index.diagnostics.push(`${path}:${lineIndex + 1}: invalid tombstone`);
        index.unreadableScopes.add(scope);
        continue;
      }
      rememberMemoryTombstone(index, tombstone);
    } catch {
      index.diagnostics.push(`${path}:${lineIndex + 1}: invalid JSON`);
      index.unreadableScopes.add(scope);
    }
  }
}

function parseMemoryTombstone(
  value: unknown,
  expectedScope: "project" | "user",
): MemoryTombstone | undefined {
  if (!isRecord(value) || value.version !== 1 || value.scope !== expectedScope) return undefined;
  if (
    typeof value.eventId !== "string" ||
    typeof value.memoryId !== "string" ||
    typeof value.deletedAt !== "string" ||
    typeof value.sessionId !== "string"
  ) {
    return undefined;
  }
  const origin = value.origin === undefined ? undefined : parseMemoryOrigin(value.origin);
  if (value.origin !== undefined && !origin) return undefined;
  if (value.requestTurnId !== undefined && typeof value.requestTurnId !== "string") return undefined;
  return {
    version: 1,
    eventId: value.eventId,
    memoryId: value.memoryId,
    scope: expectedScope,
    deletedAt: value.deletedAt,
    sessionId: value.sessionId,
    ...(typeof value.requestTurnId === "string" ? { requestTurnId: value.requestTurnId } : {}),
    ...(origin ? { origin } : {}),
  };
}

function memoryIdKey(scope: MemoryScope, memoryId: string): string {
  return `${scope}\0${memoryId}`;
}

function memoryOriginKey(scope: MemoryScope, origin: MemoryOrigin): string {
  return `${scope}\0${origin.kind}\0${origin.key}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
