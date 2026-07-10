import { appendFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { defaultConfig, resolveStoragePaths } from "@linghun/config";
import type { TranscriptEvent } from "@linghun/core";
import { describe, expect, it } from "vitest";
import { hydrateResumeContext } from "./handoff-session-runtime.js";
import { importAiSessions } from "./memory-command-runtime.js";
import {
  appendMemoryTombstone,
  createAiSessionsImportOrigin,
  createEmptyMemoryTombstoneIndex,
  isMemoryTombstoned,
  loadMemoryTombstoneIndex,
  rememberMemoryTombstone,
} from "./memory-tombstone-runtime.js";
import type { TuiContext } from "./tui-context-runtime.js";
import type { MemoryCandidate } from "./tui-data-types.js";
import { createMemoryState } from "./tui-state-runtime.js";

describe("memory tombstone runtime", () => {
  it("treats missing ledgers as an empty compatible store", async () => {
    const root = await createTempDirectory("linghun-memory-tombstone-missing-");
    const index = await loadMemoryTombstoneIndex(join(root, "project"), join(root, "user"));

    expect(index.ids.size).toBe(0);
    expect(index.origins.size).toBe(0);
    expect(index.diagnostics).toEqual([]);
  });

  it("loads valid project and user tombstones while diagnosing malformed lines", async () => {
    const root = await createTempDirectory("linghun-memory-tombstone-load-");
    const projectDirectory = join(root, "project");
    const userDirectory = join(root, "user");
    const projectMemory = makeMemory({ id: "project-deleted", scope: "project" });
    const userMemory = makeMemory({ id: "user-deleted", scope: "user" });

    await appendMemoryTombstone({
      directory: projectDirectory,
      memory: projectMemory,
      sessionId: "session-project",
    });
    await appendMemoryTombstone({
      directory: userDirectory,
      memory: userMemory,
      sessionId: "session-user",
    });
    await appendFile(join(projectDirectory, "tombstones.jsonl"), "{broken\n", "utf8");

    const index = await loadMemoryTombstoneIndex(projectDirectory, userDirectory);
    expect(isMemoryTombstoned(index, projectMemory)).toBe(true);
    expect(isMemoryTombstoned(index, userMemory)).toBe(true);
    expect(index.diagnostics).toHaveLength(1);
    expect(index.unreadableScopes.has("project")).toBe(true);
  });

  it("fails the damaged scope closed so stale JSON cannot revive", async () => {
    const project = await createTempDirectory("linghun-memory-tombstone-corrupt-");
    const paths = resolveStoragePaths(defaultConfig, project);
    const stale = makeMemory({ id: "corrupt-ledger-stale", status: "accepted" });
    await mkdir(paths.memoryProject, { recursive: true });
    await writeFile(
      join(paths.memoryProject, `${stale.id}.json`),
      `${JSON.stringify(stale)}\n`,
      "utf8",
    );
    await writeFile(join(paths.memoryProject, "tombstones.jsonl"), "{broken\n", "utf8");

    const state = await createMemoryState(defaultConfig, project);

    expect(state.accepted.some((item) => item.id === stale.id)).toBe(false);
    expect(state.tombstones?.unreadableScopes.has("project")).toBe(true);
  });

  it("does not commit a tombstone when its owner expires during directory preparation", async () => {
    const root = await createTempDirectory("linghun-memory-tombstone-owner-");
    const directory = join(root, "new-store");
    let guardChecks = 0;

    const tombstone = await appendMemoryTombstone({
      directory,
      memory: makeMemory({ id: "stale-owner-memory" }),
      sessionId: "session-owner",
      requestTurnId: "turn-owner",
      commitGuard: () => {
        guardChecks += 1;
        return guardChecks < 3;
      },
    });

    expect(tombstone).toBeUndefined();
    await expect(readFile(join(directory, "tombstones.jsonl"), "utf8")).rejects.toThrow();
  });

  it("does not commit staged tombstone content after its owner expires", async () => {
    const directory = await createTempDirectory("linghun-memory-tombstone-staged-owner-");
    const ledgerPath = join(directory, "tombstones.jsonl");
    await writeFile(ledgerPath, "existing-ledger\n", "utf8");
    let guardChecks = 0;

    const tombstone = await appendMemoryTombstone({
      directory,
      memory: makeMemory({ id: "stale-staged-memory" }),
      sessionId: "session-owner",
      requestTurnId: "turn-owner",
      commitGuard: () => {
        guardChecks += 1;
        return guardChecks < 4;
      },
    });

    expect(tombstone).toBeUndefined();
    expect(await readFile(ledgerPath, "utf8")).toBe("existing-ledger\n");
  });

  it("serializes concurrent tombstone commits without losing either deletion", async () => {
    const directory = await createTempDirectory("linghun-memory-tombstone-concurrent-");
    const first = makeMemory({ id: "concurrent-delete-first" });
    const second = makeMemory({ id: "concurrent-delete-second" });

    await Promise.all([
      appendMemoryTombstone({ directory, memory: first, sessionId: "session-owner" }),
      appendMemoryTombstone({ directory, memory: second, sessionId: "session-owner" }),
    ]);

    const index = await loadMemoryTombstoneIndex(directory, join(directory, "user"));
    expect(isMemoryTombstoned(index, first)).toBe(true);
    expect(isMemoryTombstoned(index, second)).toBe(true);
  });

  it("stores only identifiers and a structured origin digest", async () => {
    const directory = await createTempDirectory("linghun-memory-tombstone-redaction-");
    const origin = createAiSessionsImportOrigin("private-source", "private query text");
    await appendMemoryTombstone({
      directory,
      memory: makeMemory({
        id: "import-deleted",
        summary: "private summary text",
        source: "private source text",
        sourceRefs: ["private ref text"],
        origin,
      }),
      sessionId: "session-import",
      requestTurnId: "turn-import",
    });

    const raw = await readFile(join(directory, "tombstones.jsonl"), "utf8");
    expect(raw).toContain(origin.key);
    expect(raw).not.toContain("private query text");
    expect(raw).not.toContain("private summary text");
    expect(raw).not.toContain("private source text");
    expect(raw).not.toContain("private ref text");
  });

  it("filters stale candidate and accepted records when the store reloads", async () => {
    const project = await createTempDirectory("linghun-memory-tombstone-reload-");
    const paths = resolveStoragePaths(defaultConfig, project);
    await mkdir(paths.memoryProject, { recursive: true });
    const candidate = makeMemory({ id: "stale-candidate", status: "candidate" });
    const accepted = makeMemory({ id: "stale-accepted", status: "accepted" });
    await writeFile(
      join(paths.memoryProject, `${candidate.id}.json`),
      `${JSON.stringify(candidate)}\n`,
      "utf8",
    );
    await writeFile(
      join(paths.memoryProject, `${accepted.id}.json`),
      `${JSON.stringify(accepted)}\n`,
      "utf8",
    );
    await appendMemoryTombstone({
      directory: paths.memoryProject,
      memory: candidate,
      sessionId: "session-reload",
    });
    await appendMemoryTombstone({
      directory: paths.memoryProject,
      memory: accepted,
      sessionId: "session-reload",
    });

    const state = await createMemoryState(defaultConfig, project);
    expect(state.candidates.some((item) => item.id === candidate.id)).toBe(false);
    expect(state.accepted.some((item) => item.id === accepted.id)).toBe(false);
  });

  it("does not restore a tombstoned candidate from an old transcript", () => {
    const candidate = makeMemory({ id: "resume-deleted", status: "candidate" });
    const accepted = makeMemory({ id: "resume-accepted", status: "accepted" });
    const disabled = makeMemory({ id: "resume-disabled", status: "disabled" });
    const tombstones = createEmptyMemoryTombstoneIndex();
    rememberMemoryTombstone(tombstones, {
      version: 1,
      eventId: "delete-event",
      memoryId: candidate.id,
      scope: "project",
      deletedAt: "2026-07-10T00:00:00.000Z",
      sessionId: "session-old",
    });
    rememberMemoryTombstone(tombstones, {
      version: 1,
      eventId: "delete-accepted-event",
      memoryId: accepted.id,
      scope: "project",
      deletedAt: "2026-07-10T00:00:00.000Z",
      sessionId: "session-old",
    });
    const context = {
      memory: {
        candidates: [],
        accepted: [],
        rejected: [],
        disabled: [disabled],
        retired: [],
        tombstones,
      },
      evidence: [],
      checkpoints: [],
      cache: { history: [], compactBoundaries: [] },
      tools: { todos: [] },
    } as unknown as TuiContext;

    hydrateResumeContext(context, [
      {
        type: "memory_candidate",
        candidate,
        createdAt: candidate.createdAt,
      },
      {
        type: "memory_candidate",
        candidate: { ...disabled, status: "candidate" },
        createdAt: disabled.createdAt,
      },
      {
        type: "memory_accepted",
        memory: accepted,
        createdAt: accepted.createdAt,
      },
    ] as TranscriptEvent[]);

    expect(context.memory.candidates).toEqual([]);
    expect(context.memory.accepted).toEqual([]);
    expect(context.memory.disabled).toEqual([disabled]);
  });

  it("restores accepted transcript memory only for session scope", () => {
    const projectMemory = makeMemory({ id: "old-project-accepted", scope: "project" });
    const userMemory = makeMemory({ id: "old-user-accepted", scope: "user" });
    const sessionMemory = makeMemory({ id: "old-session-accepted", scope: "session" });
    const context = {
      memory: {
        candidates: [],
        accepted: [],
        rejected: [],
        disabled: [],
        retired: [],
        tombstones: createEmptyMemoryTombstoneIndex(),
      },
      evidence: [],
      checkpoints: [],
      cache: { history: [], compactBoundaries: [] },
      tools: { todos: [] },
    } as unknown as TuiContext;

    hydrateResumeContext(
      context,
      [projectMemory, userMemory, sessionMemory].map((memory) => ({
        type: "memory_accepted",
        memory,
        createdAt: memory.createdAt,
      })) as TranscriptEvent[],
    );

    expect(context.memory.accepted).toEqual([sessionMemory]);
  });

  it("does not re-import a deleted structured source under a new UUID", async () => {
    const root = await createTempDirectory("linghun-memory-tombstone-import-");
    const origin = createAiSessionsImportOrigin("codex", "project query");
    const tombstone = await appendMemoryTombstone({
      directory: root,
      memory: makeMemory({ id: "old-import", origin }),
      sessionId: "session-old-import",
    });
    const tombstones = createEmptyMemoryTombstoneIndex();
    rememberMemoryTombstone(tombstones, tombstone);
    const context = {
      projectPath: join(root, "project"),
      memory: { candidates: [], tombstones },
    } as unknown as TuiContext;
    const output = new MemoryOutput();

    await importAiSessions(["codex", "project", "query"], context, output);

    expect(context.memory.candidates).toEqual([]);
    expect(output.text).toContain("不会从同一结构化来源自动重建");
    expect(
      isMemoryTombstoned(tombstones, {
        id: "different-import",
        scope: "project",
        origin: createAiSessionsImportOrigin("codex", "different query"),
      }),
    ).toBe(false);
  });
});

class MemoryOutput extends Writable {
  text = "";

  override _write(
    chunk: unknown,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.text += String(chunk);
    callback();
  }
}

async function createTempDirectory(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

function makeMemory(overrides: Partial<MemoryCandidate> = {}): MemoryCandidate {
  return {
    id: "memory-1",
    scope: "project",
    status: "accepted",
    summary: "test memory",
    source: "test",
    sourceRefs: ["test"],
    risk: "low",
    inferred: false,
    createdAt: "2026-07-10T00:00:00.000Z",
    ...overrides,
  };
}
