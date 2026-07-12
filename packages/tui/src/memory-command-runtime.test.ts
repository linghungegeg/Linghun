import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { defaultConfig, resolveStoragePaths } from "@linghun/config";
import { SessionStore } from "@linghun/core";
import { describe, expect, it, vi } from "vitest";
import { isHandoffPacket } from "./handoff-session-runtime.js";
import type { TuiContext } from "./index.js";
import {
  configureMemoryCommandRuntime,
  executeMemoryMutation,
  handleMemoryCommand,
  resumeSessionWithHandoff,
  runAutoLearningOnTurnEnd,
} from "./memory-command-runtime.js";
import { createIndexState } from "./index-runtime.js";
import { createSolutionCompletenessStatus } from "./model-loop-runtime.js";
import { createProviderCircuitBreakerState } from "./provider-circuit-breaker.js";
import { writeMemoryLearningMode } from "./tui-memory-runtime.js";
import { createCacheState } from "./tui-state-runtime.js";
import type { MemoryCandidate } from "./tui-data-types.js";

describe("memory-command-runtime", () => {
  it("clears prior session cache state before hydrating a resumed session", async () => {
    const directory = await mkdtemp(join(tmpdir(), "linghun-memory-resume-cache-"));
    const config = structuredClone(defaultConfig);
    config.storage = {
      projectData: { scope: "project" },
      userData: { scope: "project" },
      sessions: { scope: "project" },
      memory: {
        project: { scope: "project" },
        user: { scope: "project" },
        session: { scope: "project" },
      },
      index: { scope: "project" },
      logs: { scope: "project" },
      jobs: { scope: "project" },
      cache: { scope: "project" },
    };
    const context = {
      projectPath: directory,
      config,
      model: "old-model",
      cache: createCacheState(directory, "old-model", [], config),
      deepCompactInFlight: {
        sessionId: "old-session",
        promise: Promise.resolve({ ok: false, reason: "old" }),
      },
      mcp: { enabled: false, servers: [], tools: [] },
      memory: makeContext(directory, makeMemory()).memory,
      tools: {
        todos: [{ id: "old-todo", content: "old", status: "in_progress" }],
        changedFiles: ["old.ts"],
        readSnapshots: { "old-session\0old.ts": { hash: "old", size: 3 } },
      },
      evidence: [{ id: "old-evidence" }],
      checkpoints: [{ id: "old-checkpoint" }],
      lastVerification: { id: "old-verification", status: "pass", commands: [] },
      pendingLocalApproval: { kind: "model_tool" },
      currentRequestTurnId: "old-request",
      index: createIndexState(config),
      permissionMode: "default",
      solutionCompleteness: createSolutionCompletenessStatus(),
      store: {
        resume: async () => ({
          session: { id: "target-session", model: "target-model" },
          transcript: [],
        }),
        create: async () => ({
          id: "child-session",
          model: "target-model",
        }),
        appendEvent: async () => undefined,
      },
    } as unknown as TuiContext;
    context.cache.deepCompact = { id: "old-deep" } as never;
    context.cache.compactProjection = { boundaryId: "old-projection" } as never;
    context.cache.systemPromptLatch = { compactBoundaryKey: "old" } as never;
    context.cache.postCompactRestoreLatch = { deepCompactId: "old-deep", content: "old" };
    context.cache.postCompactCacheWarmup = { status: "warming" } as never;
    context.cache.lastCacheSafePrefix = { prefixHash: "old" } as never;
    configureMemoryDeps();
    const output = new MockWritable();

    await resumeSessionWithHandoff("target-session", context, output, "resume");

    expect(context.sessionId).toBe("child-session");
    expect(context.model).toBe("target-model");
    expect(context.deepCompactInFlight).toBeUndefined();
    expect(context.cache.deepCompact).toBeUndefined();
    expect(context.cache.compactProjection).toBeUndefined();
    expect(context.cache.systemPromptLatch).toBeUndefined();
    expect(context.cache.postCompactRestoreLatch).toBeUndefined();
    expect(context.cache.postCompactCacheWarmup).toBeUndefined();
    expect(context.cache.lastCacheSafePrefix).toBeUndefined();
    expect(context.tools.todos).toEqual([]);
    expect(context.tools.changedFiles).toEqual([]);
    expect(context.tools.readSnapshots).toEqual({});
    expect(context.evidence).toEqual([]);
    expect(context.checkpoints).toEqual([]);
    expect(context.lastVerification).toBeUndefined();
    expect(context.pendingLocalApproval).toBeUndefined();
    expect(context.currentRequestTurnId).toBeUndefined();
    expect(output.text).toContain("target-session");
    expect(output.text).toContain("child-session");
  });

  it("keeps the current session state unchanged when child creation fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "linghun-memory-resume-create-fail-"));
    const config = structuredClone(defaultConfig);
    const oldTools = {
      workspaceRoot: directory,
      todos: [{ id: "old-todo", content: "old", status: "in_progress" }],
      changedFiles: ["old.ts"],
      readSnapshots: { "old-session\0old.ts": { hash: "old", size: 3 } },
    } as unknown as TuiContext["tools"];
    const oldApproval = { kind: "model_tool" } as unknown as NonNullable<
      TuiContext["pendingLocalApproval"]
    >;
    const context = {
      projectPath: directory,
      config,
      sessionId: "current-session",
      sessionStoreVerifiedId: "current-session",
      model: "old-model",
      cache: createCacheState(directory, "old-model", [], config),
      mcp: { enabled: false, servers: [], tools: [] },
      memory: makeContext(directory, makeMemory()).memory,
      tools: oldTools,
      evidence: [],
      checkpoints: [],
      index: createIndexState(config),
      permissionMode: "default",
      solutionCompleteness: createSolutionCompletenessStatus(),
      pendingLocalApproval: oldApproval,
      currentRequestTurnId: "current-request",
      store: {
        resume: async () => ({
          session: { id: "target-session", model: "target-model" },
          transcript: [],
        }),
        create: async () => {
          throw new Error("create failed");
        },
      },
    } as unknown as TuiContext;
    configureMemoryDeps();
    const output = new MockWritable();

    await resumeSessionWithHandoff("target-session", context, output, "resume");

    expect(context.sessionId).toBe("current-session");
    expect(context.sessionStoreVerifiedId).toBe("current-session");
    expect(context.model).toBe("old-model");
    expect(context.tools).toBe(oldTools);
    expect(context.pendingLocalApproval).toBe(oldApproval);
    expect(context.currentRequestTurnId).toBe("current-request");
    expect(output.text).toContain("create failed");
  });

  it("deletes the candidate child when handoff append fails and keeps later events on the current session", async () => {
    const directory = await mkdtemp(join(tmpdir(), "linghun-memory-resume-append-fail-"));
    const config = structuredClone(defaultConfig);
    const deletedSessionIds: string[] = [];
    const appendedSessionIds: string[] = [];
    const context = {
      projectPath: directory,
      config,
      sessionId: "current-session",
      sessionStoreVerifiedId: "current-session",
      model: "old-model",
      cache: createCacheState(directory, "old-model", [], config),
      mcp: { enabled: false, servers: [], tools: [] },
      memory: makeContext(directory, makeMemory()).memory,
      tools: { todos: [], changedFiles: [], readSnapshots: {} },
      evidence: [],
      checkpoints: [],
      index: createIndexState(config),
      permissionMode: "default",
      solutionCompleteness: createSolutionCompletenessStatus(),
      store: {
        resume: async () => ({
          session: { id: "target-session", model: "target-model" },
          transcript: [],
        }),
        create: async () => ({ id: "child-session", model: "target-model" }),
        delete: async (sessionId: string) => {
          deletedSessionIds.push(sessionId);
        },
        appendEvent: async (sessionId: string) => {
          if (sessionId === "child-session") throw new Error("handoff append failed");
          appendedSessionIds.push(sessionId);
        },
      },
    } as unknown as TuiContext;
    configureMemoryDeps();
    const output = new MockWritable();

    await resumeSessionWithHandoff("target-session", context, output, "resume");

    expect(deletedSessionIds).toEqual(["child-session"]);
    expect(context.sessionId).toBe("current-session");
    expect(context.sessionStoreVerifiedId).toBe("current-session");
    expect(context.model).toBe("old-model");
    expect(output.text).toContain("handoff append failed");

    await context.store.appendEvent(context.sessionId ?? "missing", {
      type: "user_message",
      id: "next-user",
      text: "next event",
      createdAt: new Date().toISOString(),
    });
    expect(appendedSessionIds).toEqual(["current-session"]);
  });

  it("removes the candidate child and partial memory artifacts when handoff file persistence fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "linghun-memory-resume-handoff-fail-"));
    const config = structuredClone(defaultConfig);
    config.storage = {
      projectData: { scope: "project" },
      userData: { scope: "project" },
      sessions: { scope: "project" },
      memory: {
        project: { scope: "project" },
        user: { scope: "project" },
        session: { scope: "project" },
      },
      index: { scope: "project" },
      logs: { scope: "project" },
      jobs: { scope: "project" },
      cache: { scope: "project" },
    };
    const childMemoryDir = join(
      resolveStoragePaths(config, directory).memorySession,
      "child-session",
    );
    await mkdir(join(childMemoryDir, "runtime-ledger.jsonl"), { recursive: true });
    const deletedSessionIds: string[] = [];
    let appendCalled = false;
    const context = {
      projectPath: directory,
      config,
      sessionId: "current-session",
      sessionStoreVerifiedId: "current-session",
      model: "old-model",
      cache: createCacheState(directory, "old-model", [], config),
      mcp: { enabled: false, servers: [], tools: [] },
      memory: makeContext(directory, makeMemory()).memory,
      tools: { todos: [], changedFiles: [], readSnapshots: {} },
      evidence: [],
      checkpoints: [],
      index: createIndexState(config),
      permissionMode: "default",
      solutionCompleteness: createSolutionCompletenessStatus(),
      store: {
        resume: async () => ({
          session: { id: "target-session", model: "target-model" },
          transcript: [],
        }),
        create: async () => ({ id: "child-session", model: "target-model" }),
        delete: async (sessionId: string) => {
          deletedSessionIds.push(sessionId);
        },
        appendEvent: async () => {
          appendCalled = true;
        },
      },
    } as unknown as TuiContext;
    configureMemoryDeps();

    await resumeSessionWithHandoff("target-session", context, new MockWritable(), "resume");

    expect(deletedSessionIds).toEqual(["child-session"]);
    expect(appendCalled).toBe(false);
    expect(context.sessionId).toBe("current-session");
    await expect(stat(childMemoryDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("resumes one source into isolated child sessions without writing the source transcript", async () => {
    const root = await mkdtemp(join(tmpdir(), "linghun-memory-resume-child-"));
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-memory-resume-project-"));
    const store = new SessionStore({ sessionRootDir: root, projectPath });
    const source = await store.create({ model: "target-model" });
    await store.appendEvent(source.id, {
      type: "user_message",
      id: "source-user",
      text: "source-only history",
      createdAt: new Date(0).toISOString(),
    });
    const sourceBefore = await readFile(source.transcriptPath, "utf8");
    const config = structuredClone(defaultConfig);
    config.storage = {
      projectData: { scope: "project" },
      userData: { scope: "project" },
      sessions: { scope: "project" },
      memory: {
        project: { scope: "project" },
        user: { scope: "project" },
        session: { scope: "project" },
      },
      index: { scope: "project" },
      logs: { scope: "project" },
      jobs: { scope: "project" },
      cache: { scope: "project" },
    };
    const createContext = () => ({
      projectPath,
      config,
      model: "old-model",
      cache: createCacheState(projectPath, "old-model", [], config),
      mcp: { enabled: false, servers: [], tools: [] },
      memory: makeContext(projectPath, makeMemory()).memory,
      tools: { todos: [], changedFiles: [] },
      evidence: [],
      checkpoints: [],
      index: createIndexState(config),
      permissionMode: "default",
      solutionCompleteness: createSolutionCompletenessStatus(),
      store,
    }) as unknown as TuiContext;
    configureMemoryDeps();
    const first = createContext();
    const second = createContext();

    await Promise.all([
      resumeSessionWithHandoff(source.id, first, new MockWritable(), "resume"),
      resumeSessionWithHandoff(source.id, second, new MockWritable(), "resume"),
    ]);

    expect(first.sessionId).not.toBe(source.id);
    expect(second.sessionId).not.toBe(source.id);
    expect(first.sessionId).not.toBe(second.sessionId);
    expect(await readFile(source.transcriptPath, "utf8")).toBe(sourceBefore);
    for (const childId of [first.sessionId, second.sessionId]) {
      const child = await store.resume(childId ?? "missing");
      expect(child.transcript.some((event) => event.type === "handoff_packet")).toBe(true);
      expect(child.transcript.some((event) => event.type === "user_message")).toBe(false);
    }

    const firstChildId = first.sessionId ?? "missing";
    await store.appendEvent(firstChildId, {
      type: "todo_update",
      items: [{ id: "fresh-todo", content: "continue fresh child work", status: "in_progress" }],
      createdAt: new Date(1).toISOString(),
    });
    await store.appendEvent(firstChildId, {
      type: "evidence_record",
      id: "fresh-child-evidence",
      kind: "file_read",
      summary: "fresh child evidence",
      source: "src/fresh-child.ts",
      supportsClaims: ["code_fact"],
      createdAt: new Date(2).toISOString(),
    });
    const third = createContext();
    await resumeSessionWithHandoff(firstChildId, third, new MockWritable(), "resume");

    const grandchild = await store.resume(third.sessionId ?? "missing");
    const freshPacketEvent = [...grandchild.transcript]
      .reverse()
      .find((event) => event.type === "handoff_packet");
    expect(freshPacketEvent?.type).toBe("handoff_packet");
    if (freshPacketEvent?.type !== "handoff_packet" || !isHandoffPacket(freshPacketEvent.packet)) {
      throw new Error("missing fresh handoff");
    }
    const freshPacket = freshPacketEvent.packet;
    expect(freshPacket.parentSessionId).toBe(firstChildId);
    expect(freshPacket.goal).toBe("continue fresh child work");
    expect(freshPacket.evidenceRefs).toContainEqual(
      expect.objectContaining({ id: "fresh-child-evidence" }),
    );
    expect(freshPacket.id).not.toBe(first.memory.lastHandoff?.id);
  });

  it("fails closed for unknown memory mutation actions", async () => {
    await expect(
      executeMemoryMutation({} as TuiContext, new MockWritable(), {
        action: "future-action",
      } as never),
    ).rejects.toThrow(/未知 memory mutation action/);
  });

  it("invalidates the old runtime owner across learning off then on", async () => {
    const directory = await mkdtemp(join(tmpdir(), "linghun-memory-mode-owner-"));
    const context = makeContext(directory, makeMemory());
    context.memory.learningMode = "active";
    context.memoryAutoLearningRuntime = {
      latestRequestTurnId: "old-learning-owner",
      inFlight: Promise.resolve(),
      trailing: {
        userText: "old trailing",
        requestTurnId: "old-trailing-owner",
        sessionId: "session-memory-test",
        signal: new AbortController().signal,
      },
    };
    configureMemoryDeps();

    await handleMemoryCommand(["learn", "off"], context, new MockWritable());
    await handleMemoryCommand(["learn", "on"], context, new MockWritable());

    expect(context.memory.learningMode).toBe("active");
    expect(context.memoryAutoLearningRuntime.latestRequestTurnId).toBeUndefined();
    expect(context.memoryAutoLearningRuntime.trailing).toBeUndefined();
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
    await writeFile(join(directory, `${memory.id}.json`), JSON.stringify(memory), "utf8");
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

  it("keeps auto-delete state unchanged when the owned classifier is unavailable", async () => {
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

    expect(result.skippedReason).toBe("memory_extraction:semantic_classifier_unavailable");
    expect(await readFile(ledgerPath, "utf8")).toBe("existing-ledger\n");
    expect(await readFile(recordPath, "utf8")).toContain(memory.id);
    expect(context.memory.accepted).toEqual([memory]);
    expect(systemEvents).toEqual([]);
    expect(evidenceEvents).toEqual([]);
  });

  it("fails closed for owned delete when the semantic classifier is unavailable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "linghun-memory-delete-classifier-offline-"));
    const memory = makeMemory({
      scope: "session",
      taxonomy: "user",
      topic: "user-report-format",
      summary: "User preference: 中文短列表",
      inferred: true,
    });
    const context = makeContext(directory, memory);
    context.memory.learningMode = "active";
    context.sessionId = "session-memory-test";
    configureMemoryDeps();

    const result = await runAutoLearningOnTurnEnd(
      context,
      "引用用户原话：请忘记我偏好中文短列表。",
      {
        requestTurnId: "turn-memory-test",
        sessionId: "session-memory-test",
        signal: new AbortController().signal,
      },
    );

    expect(result.skippedReason).toContain("semantic_classifier_unavailable");
    expect(context.memory.accepted).toEqual([memory]);
    await expect(readFile(join(directory, "tombstones.jsonl"), "utf8")).rejects.toThrow();
  });

  it("rejects semantic delete unless the structured turn kind is memory_control", async () => {
    const directory = await mkdtemp(join(tmpdir(), "linghun-memory-delete-turn-kind-"));
    const memory = makeMemory({
      scope: "session",
      taxonomy: "user",
      topic: "user-report-format",
      summary: "User preference: 中文短列表",
      inferred: true,
    });
    const context = makeContext(directory, memory);
    context.memory.learningMode = "active";
    context.sessionId = "session-memory-test";
    context.config = defaultConfig;
    context.model = defaultConfig.defaultModel;
    context.modelGateway = {
      stream: async function* () {
        yield {
          type: "assistant_text_delta" as const,
          id: "memory-delete-audit",
          text: JSON.stringify({
            action: "delete",
            id: memory.id,
            taxonomy: "user",
            turnKind: "audit",
            stability: "stable",
          }),
        };
        yield {
          type: "message_stop" as const,
          id: "cross-window-off-stop",
          chunkCount: 1,
          hadUsage: false,
        };
        yield {
          type: "message_stop" as const,
          id: "memory-delete-audit-stop",
          chunkCount: 1,
          hadUsage: false,
        };
      },
    } as unknown as TuiContext["modelGateway"];
    configureMemoryDeps();

    const result = await runAutoLearningOnTurnEnd(
      context,
      "审计样本引用：请忘记我偏好中文短列表。",
      {
        requestTurnId: "turn-memory-test",
        sessionId: "session-memory-test",
        signal: new AbortController().signal,
      },
    );

    expect(result.skippedReason).toContain("semantic_delete_not_memory_control");
    expect(context.memory.accepted).toEqual([memory]);
  });

  it("accepts a structured memory_control delete and records the committed lifecycle", async () => {
    const directory = await mkdtemp(join(tmpdir(), "linghun-memory-delete-control-"));
    const memory = makeMemory({
      scope: "session",
      taxonomy: "user",
      topic: "user-report-format",
      summary: "User preference: 中文短列表",
      inferred: true,
    });
    const context = makeContext(directory, memory);
    context.memory.learningMode = "active";
    context.sessionId = "session-memory-test";
    context.config = defaultConfig;
    context.model = defaultConfig.defaultModel;
    let classifierCalls = 0;
    context.modelGateway = {
      stream: async function* () {
        classifierCalls += 1;
        yield {
          type: "assistant_text_delta" as const,
          id: `memory-delete-control-${classifierCalls}`,
          text:
            classifierCalls === 1
              ? JSON.stringify({
                  action: "delete",
                  id: memory.id,
                  taxonomy: "user",
                  turnKind: "memory_control",
                  stability: "stable",
                })
              : JSON.stringify({ veto: false, reason: "direct_memory_control" }),
        };
        yield {
          type: "message_stop" as const,
          id: `memory-delete-control-stop-${classifierCalls}`,
          chunkCount: 1,
          hadUsage: false,
        };
      },
    } as unknown as TuiContext["modelGateway"];
    const systemEvents: string[] = [];
    const evidenceEvents: string[] = [];
    configureMemoryDeps({ systemEvents, evidenceEvents });

    const result = await runAutoLearningOnTurnEnd(context, "请忘记我偏好中文短列表。", {
      requestTurnId: "turn-memory-test",
      sessionId: "session-memory-test",
      signal: new AbortController().signal,
    });

    expect(result.acceptedDeleted).toBe(1);
    expect(context.memory.accepted).toEqual([]);
    expect(systemEvents).toContainEqual(expect.stringContaining("action=deleted"));
    expect(evidenceEvents).toEqual([]);
  });

  it("drops a cross-window learning-off result before persistence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "linghun-memory-cross-window-off-"));
    const transcript: unknown[] = [];
    const context = makeContext(directory, makeMemory(), transcript);
    context.memory.accepted = [];
    context.memory.learningMode = "active";
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const classifierStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    context.modelGateway = {
      stream: async function* () {
        started();
        await gate;
        yield {
          type: "assistant_text_delta" as const,
          id: "cross-window-off",
          text: JSON.stringify({
            action: "create",
            taxonomy: "user",
            summary: "User preference: concise Chinese answers",
            turnKind: "preference",
            stability: "stable",
          }),
        };
        yield {
          type: "message_stop" as const,
          id: "memory-fact-ledger-stop",
          chunkCount: 1,
          hadUsage: false,
        };
      },
    } as unknown as TuiContext["modelGateway"];
    configureMemoryDeps();
    const pending = runAutoLearningOnTurnEnd(context, "请记住：我偏好简短中文回答。", {
      requestTurnId: "turn-memory-test",
      sessionId: "session-memory-test",
      signal: new AbortController().signal,
      isCurrent: () => true,
    });
    await classifierStarted;

    const otherWindow = makeContext(directory, makeMemory());
    otherWindow.memory.learningMode = "off";
    await writeMemoryLearningMode(otherWindow);
    release();
    const result = await pending;

    expect(result.modelCalled).toBe(true);
    expect(result.skippedReason).toContain("learning_mode");
    expect(context.memory.learningMode).toBe("off");
    expect(context.memory.accepted).toEqual([]);
    expect(context.evidence).toEqual([]);
    expect(transcript).toEqual([]);
  });

  it("records classifier failure as model-called degradation without memory evidence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "linghun-memory-classifier-failure-"));
    const context = makeContext(directory, makeMemory());
    context.memory.accepted = [];
    context.memory.learningMode = "active";
    context.modelGateway = {
      stream: async function* () {
        yield { type: "error" as const, error: new Error("classifier unavailable") };
      },
    } as unknown as TuiContext["modelGateway"];
    configureMemoryDeps();

    const result = await runAutoLearningOnTurnEnd(context, "请记住：我偏好简短中文回答。", {
      requestTurnId: "turn-memory-test",
      sessionId: "session-memory-test",
      signal: new AbortController().signal,
      isCurrent: () => true,
    });

    expect(result.modelCalled).toBe(true);
    expect(result.skippedReason).toContain("semantic_classifier_unavailable");
    expect(context.memory.accepted).toEqual([]);
    expect(context.evidence).toEqual([]);
  });

  it("keeps owner-guarded memory_accepted as the sole fact ledger without PASS evidence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "linghun-memory-fact-ledger-"));
    const transcript: unknown[] = [];
    const context = makeContext(directory, makeMemory(), transcript);
    context.memory.accepted = [];
    context.memory.learningMode = "active";
    context.modelGateway = {
      stream: async function* () {
        yield {
          type: "assistant_text_delta" as const,
          id: "memory-fact-ledger",
          text: JSON.stringify({
            action: "create",
            taxonomy: "user",
            summary: "User preference: concise Chinese answers",
            turnKind: "preference",
            stability: "stable",
          }),
        };
        yield {
          type: "message_stop" as const,
          id: "memory-fact-ledger-stop",
          chunkCount: 1,
          hadUsage: false,
        };
      },
    } as unknown as TuiContext["modelGateway"];
    const evidenceEvents: string[] = [];
    configureMemoryDeps({ systemEvents: [], evidenceEvents });

    const result = await runAutoLearningOnTurnEnd(context, "请记住：我偏好简短中文回答。", {
      requestTurnId: "turn-memory-test",
      sessionId: "session-memory-test",
      signal: new AbortController().signal,
      isCurrent: () => true,
    });

    expect(result.acceptedCreated).toBe(1);
    expect(result.modelCalled).toBe(true);
    expect(transcript).toContainEqual(expect.objectContaining({ type: "memory_accepted" }));
    expect(evidenceEvents).toEqual([]);
    expect(context.evidence).toEqual([]);
  });

  it("retries the semantic classifier through the shared provider lifecycle", async () => {
    vi.useFakeTimers();
    try {
      const directory = await mkdtemp(join(tmpdir(), "linghun-memory-classifier-retry-"));
      const context = makeContext(directory, makeMemory());
      context.memory.learningMode = "active";
      context.sessionId = "session-memory-test";
      context.config = defaultConfig;
      context.model = defaultConfig.defaultModel;
      let attempts = 0;
      context.modelGateway = {
        stream: async function* () {
          attempts += 1;
          if (attempts === 1) {
            yield {
              type: "assistant_text_delta" as const,
              id: "stale-memory-attempt",
              text: "STALE_PARTIAL",
            };
            yield {
              type: "error" as const,
              error: Object.assign(new Error("retry"), {
                code: "PROVIDER_NETWORK_ERROR",
                recoverable: true,
              }),
            };
            return;
          }
          yield {
            type: "assistant_text_delta" as const,
            id: "fresh-memory-attempt",
            text: JSON.stringify({ action: "no-op", reason: "temporary_task" }),
          };
          yield {
            type: "message_stop" as const,
            id: "fresh-memory-stop",
            chunkCount: 1,
            hadUsage: false,
          };
        },
      } as unknown as TuiContext["modelGateway"];
      configureMemoryDeps();

      const pending = runAutoLearningOnTurnEnd(context, "请临时检查这个文件，不要长期记忆。", {
        requestTurnId: "turn-memory-test",
        sessionId: "session-memory-test",
        signal: new AbortController().signal,
      });
      await vi.waitFor(() => expect(attempts).toBe(1));
      await vi.advanceTimersByTimeAsync(700);
      const result = await pending;

      expect(attempts).toBe(2);
      expect(result.skippedReason).toBe("memory_extraction:temporary_task");
      expect(context.memory.accepted).toHaveLength(1);
      expect(context.providerBreaker.entries.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

class MockWritable extends Writable {
  text = "";

  _write(chunk: Buffer | string, _encoding: string, callback: () => void): void {
    this.text += String(chunk);
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

function makeContext(
  directory: string,
  memory: MemoryCandidate,
  transcript: unknown[] = [],
): TuiContext {
  return {
    projectPath: directory,
    currentRequestTurnId: "turn-memory-test",
    sessionId: "session-memory-test",
    config: defaultConfig,
    model: defaultConfig.defaultModel,
    providerBreaker: createProviderCircuitBreakerState(),
    evidence: [],
    store: {
      appendEvent: async (_sessionId: string, event: unknown, commitGuard?: () => boolean) => {
        if (!commitGuard || commitGuard()) transcript.push(event);
      },
    },
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
        logicalKeys: new Set(),
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
