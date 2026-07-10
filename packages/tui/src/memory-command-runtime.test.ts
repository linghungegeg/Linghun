import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import type { TuiContext } from "./index.js";
import {
  configureMemoryCommandRuntime,
  executeMemoryMutation,
  runAutoLearningOnTurnEnd,
} from "./memory-command-runtime.js";
import type { MemoryCandidate } from "./tui-data-types.js";

describe("memory-command-runtime", () => {
  it("fails closed for unknown memory mutation actions", async () => {
    await expect(
      executeMemoryMutation({} as TuiContext, new MockWritable(), {
        action: "future-action",
      } as never),
    ).rejects.toThrow(/未知 memory mutation action/);
  });

  it("persists a tombstone before deleting a project memory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "linghun-memory-delete-"));
    const memory = makeMemory();
    await writeFile(join(directory, `${memory.id}.json`), JSON.stringify(memory), "utf8");
    const context = makeContext(directory, memory);
    configureMemoryDeps();

    await executeMemoryMutation(context, new MockWritable(), { action: "delete", memory });

    await expect(readFile(join(directory, `${memory.id}.json`), "utf8")).rejects.toThrow();
    const tombstones = await readFile(join(directory, "tombstones.jsonl"), "utf8");
    expect(tombstones).toContain(memory.id);
    expect(tombstones).not.toContain(memory.summary);
    expect(context.memory.accepted).toEqual([]);
  });

  it("keeps the record and state when tombstone append fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "linghun-memory-delete-fail-"));
    const memory = makeMemory();
    const recordPath = join(directory, `${memory.id}.json`);
    await writeFile(recordPath, JSON.stringify(memory), "utf8");
    await mkdir(join(directory, "tombstones.jsonl"));
    const context = makeContext(directory, memory);
    configureMemoryDeps();

    await expect(
      executeMemoryMutation(context, new MockWritable(), { action: "delete", memory }),
    ).rejects.toThrow();

    expect(await readFile(recordPath, "utf8")).toContain(memory.id);
    expect(context.memory.accepted).toContainEqual(memory);
  });

  it("does not create tombstones for disable and rollback", async () => {
    const directory = await mkdtemp(join(tmpdir(), "linghun-memory-disable-"));
    const memory = makeMemory();
    const context = makeContext(directory, memory);
    configureMemoryDeps();

    await executeMemoryMutation(context, new MockWritable(), { action: "disable", memory });
    const disabled = context.memory.disabled[0];
    if (!disabled) throw new Error("disabled memory missing");
    await executeMemoryMutation(context, new MockWritable(), {
      action: "rollback",
      memory: disabled,
    });

    await expect(readFile(join(directory, "tombstones.jsonl"), "utf8")).rejects.toThrow();
    expect(context.memory.accepted[0]?.status).toBe("accepted");
  });

  it("persists a tombstone for auto-learning delete before restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "linghun-memory-auto-delete-"));
    const memory = makeMemory({
      scope: "user",
      taxonomy: "user",
      topic: "user-report-format",
      summary: "User preference: 中文短列表",
      inferred: true,
    });
    await writeFile(join(directory, `${memory.id}.json`), JSON.stringify(memory), "utf8");
    const context = makeContext(directory, memory);
    context.memory.learningMode = "active";
    configureMemoryDeps();

    const result = await runAutoLearningOnTurnEnd(context, "请忘记我偏好中文短列表。");

    expect(result.acceptedDeleted).toBe(1);
    expect(context.memory.accepted).toEqual([]);
    expect(await readFile(join(directory, "tombstones.jsonl"), "utf8")).toContain(memory.id);
  });

  it("keeps auto-delete state unchanged when the owner expires after staging", async () => {
    const directory = await mkdtemp(join(tmpdir(), "linghun-memory-auto-delete-stale-"));
    const memory = makeMemory({
      scope: "user",
      taxonomy: "user",
      topic: "user-report-format",
      summary: "User preference: 中文短列表",
      inferred: true,
    });
    const recordPath = join(directory, `${memory.id}.json`);
    const ledgerPath = join(directory, "tombstones.jsonl");
    await writeFile(recordPath, JSON.stringify(memory), "utf8");
    await writeFile(ledgerPath, "existing-ledger\n", "utf8");
    const context = makeContext(directory, memory);
    context.memory.learningMode = "active";
    context.sessionId = "session-memory-test";
    const systemEvents: string[] = [];
    const evidenceEvents: string[] = [];
    configureMemoryDeps({ systemEvents, evidenceEvents });
    let abortedReads = 0;
    const signal = {
      get aborted() {
        abortedReads += 1;
        return abortedReads >= 7;
      },
    } as AbortSignal;

    const result = await runAutoLearningOnTurnEnd(
      context,
      "请忘记我偏好中文短列表。",
      { requestTurnId: "turn-memory-test", sessionId: "session-memory-test", signal },
    );

    expect(result.skippedReason).toBe("memory_extraction:stale_request_owner");
    expect(await readFile(ledgerPath, "utf8")).toBe("existing-ledger\n");
    expect(await readFile(recordPath, "utf8")).toContain(memory.id);
    expect(context.memory.accepted).toEqual([memory]);
    expect(systemEvents).toEqual([]);
    expect(evidenceEvents).toEqual([]);
  });
});

class MockWritable extends Writable {
  _write(_chunk: Buffer | string, _encoding: string, callback: () => void): void {
    callback();
  }
}

function configureMemoryDeps(recording?: {
  systemEvents: string[];
  evidenceEvents: string[];
}): void {
  configureMemoryCommandRuntime({
    appendSystemEvent: async (_context, _sessionId, message) => {
      recording?.systemEvents.push(message);
    },
    ensureSession: async () => "session-memory-test",
    requestMemoryMutationApproval: async () => "approved",
    refreshCacheFreshness: () => undefined,
    recordMemoryMutationEvidence: async (_context, _sessionId, action) => {
      recording?.evidenceEvents.push(action);
    },
    writeStatus: () => undefined,
  });
}

function makeContext(directory: string, memory: MemoryCandidate): TuiContext {
  return {
    projectPath: directory,
    currentRequestTurnId: "turn-memory-test",
    memory: {
      projectDir: directory,
      userDir: directory,
      sessionDir: directory,
      candidates: [],
      accepted: [memory],
      rejected: [],
      disabled: [],
      retired: [],
      learningMode: "off",
      tombstones: {
        ids: new Set(),
        origins: new Set(),
        unreadableScopes: new Set(),
        diagnostics: [],
      },
    },
  } as unknown as TuiContext;
}

function makeMemory(overrides: Partial<MemoryCandidate> = {}): MemoryCandidate {
  return {
    id: "memory-delete-test",
    scope: "project",
    status: "accepted",
    summary: "stable test memory",
    source: "test",
    sourceRefs: ["test"],
    risk: "low",
    inferred: false,
    createdAt: "2026-07-10T00:00:00.000Z",
    ...overrides,
  };
}
