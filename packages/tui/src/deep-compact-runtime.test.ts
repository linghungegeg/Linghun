import type { ModelMessage } from "@linghun/providers";
import { describe, expect, it } from "vitest";
import {
  buildDeepCompactRequestMessages,
  createDeepCompactPacket,
  formatDeepCompactPromptSummary,
  injectDeepCompactSummary,
  insertAfterLeadingSystemMessages,
  isDeepCompactPacket,
  maybeRunDeepCompactBeforeProvider,
  sanitizeProviderStableCompactText,
  shouldRunDeepCompact,
} from "./deep-compact-runtime.js";
import { recordCompactBoundary } from "./compact-preflight-runtime.js";
import { hydrateResumeContext } from "./handoff-session-runtime.js";
import type { DeepCompactPacket } from "./tui-data-types.js";
import type { TuiContext } from "./tui-context-runtime.js";

function makePacket(): DeepCompactPacket {
  return {
    id: "deep-test",
    kind: "deep",
    scope: "full transcript semantic compact",
    summary: "older conversation summary",
    preservedEvidenceRefs: [],
    preservedFiles: [],
    activeAgentsWorkflows: [],
    needsAttentionAgentsWorkflows: [],
    staleResumableAgentsWorkflows: [],
    pendingItems: [],
    decisions: [],
    risks: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    model: "gpt-test",
    provider: "openai-compatible",
    trigger: "request",
    transcriptEventCount: 10,
  };
}

function createOwnedCompactHarness() {
  const appendedEvents: Array<{ type?: string }> = [];
  const boundaries: unknown[] = [];
  const context = {
    language: "en-US",
    projectPath: process.cwd(),
    runtimeContextId: "turn-a",
    currentRequestTurnId: "turn-a",
    cache: { compactBoundaries: [] },
    providerBreaker: { entries: new Map() },
    evidence: [],
    recentlyMentionedFiles: [],
    tools: { changedFiles: [], todos: [] },
    agents: [],
    backgroundTasks: [],
    workflows: { runs: [] },
    todos: [],
    routeDecisions: [],
    failureLearning: { records: [] },
    memory: { accepted: [] },
    index: {},
    store: {
      resume: async () => ({
        transcript: [{ type: "user_message", text: "preserve current task" }],
      }),
      appendEvent: async (
        _sessionId: string,
        event: { type?: string },
        commitGuard?: () => boolean,
      ) => {
        if (commitGuard && !commitGuard()) return;
        appendedEvents.push(event);
      },
    },
  } as unknown as TuiContext;
  const deps = {
    appendSystemEvent: async () => {},
    captureFailureLearning: async () => {},
    refreshCacheFreshness: () => {},
    recordCompactBoundary: (_context: unknown, boundary: unknown) => {
      boundaries.push(boundary);
    },
  };
  return { context, deps, appendedEvents, boundaries };
}

describe("deep compact prompt insertion", () => {
  it("discards partial summary text when the provider resets its attempt", async () => {
    const { context, deps } = createOwnedCompactHarness();
    const gateway = {
      async *stream(
        _provider: string,
        _request: unknown,
        _signal: AbortSignal,
        control?: { onAttemptReset?: () => void },
      ) {
        yield { type: "assistant_text_delta", id: "old", text: "OLD_PARTIAL" };
        control?.onAttemptReset?.();
        yield { type: "assistant_text_delta", id: "new", text: "NEW_COMPLETE" };
        yield { type: "message_stop", id: "new", chunkCount: 1, hadUsage: false };
      },
    };

    const result = await maybeRunDeepCompactBeforeProvider({
      context,
      sessionId: "session-attempt-reset",
      runtime: { model: "test-model", provider: "test-provider" } as never,
      trigger: "manual",
      gateway: gateway as never,
      signal: new AbortController().signal,
      deps,
    });

    expect(result).toMatchObject({ ok: true, packet: { summary: "NEW_COMPLETE" } });
    expect(context.cache.deepCompact?.summary).toBe("NEW_COMPLETE");
  });

  it("reuses the transcript tail reader after an accepted deep compact packet", async () => {
    const packet = makePacket();
    let resumeCalls = 0;
    let stopMatched = false;
    let readOptions:
      | { limit?: number; maxBytes?: number; maxLineBytes?: number; maxDiagnostics?: number }
      | undefined;
    const context = {
      language: "en-US",
      cache: {
        deepCompact: packet,
        deepCompactCooldownUntil: Date.now() + 60_000,
      },
      store: {
        readRecentTranscriptEvents: async (
          _sessionId: string,
          input: {
            limit?: number;
            maxBytes?: number;
            maxLineBytes?: number;
            maxDiagnostics?: number;
            stopPredicate?: (event: unknown) => boolean;
          },
        ) => {
          readOptions = input;
          const boundary = { type: "deep_compact_packet", packet };
          stopMatched = Boolean(input.stopPredicate?.(boundary));
          return { events: [boundary, { type: "user_message", text: "new work" }] };
        },
        resume: async () => {
          resumeCalls += 1;
          return { transcript: [] };
        },
      },
    };

    const result = await maybeRunDeepCompactBeforeProvider({
      context: context as never,
      sessionId: "session-deep-tail",
      runtime: { model: "test-model", provider: "test-provider" } as never,
      trigger: "manual",
      gateway: {} as never,
      deps: {} as never,
    });

    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("cooling down") });
    expect(stopMatched).toBe(true);
    expect(resumeCalls).toBe(0);
    expect(readOptions).toMatchObject({
      limit: 10_000,
      maxBytes: 8 * 1024 * 1024,
      maxLineBytes: 1024 * 1024,
      maxDiagnostics: 20,
    });
  });

  it("keeps the full resume path for the first deep compact", async () => {
    let resumeCalls = 0;
    let tailCalls = 0;
    const context = {
      language: "en-US",
      cache: { deepCompactCooldownUntil: Date.now() + 60_000 },
      store: {
        readRecentTranscriptEvents: async () => {
          tailCalls += 1;
          return { events: [] };
        },
        resume: async () => {
          resumeCalls += 1;
          return { transcript: [{ type: "user_message", text: "first goal" }] };
        },
      },
    } as never;

    await maybeRunDeepCompactBeforeProvider({
      context,
      sessionId: "session-first-deep",
      runtime: { model: "test-model", provider: "test-provider" } as never,
      trigger: "manual",
      gateway: {} as never,
      deps: {} as never,
    });

    expect(resumeCalls).toBe(1);
    expect(tailCalls).toBe(0);
  });

  it("uses the newest persisted packet instead of a stale window cache", async () => {
    const stalePacket = makePacket();
    const newestPacket = { ...makePacket(), id: "deep-newest", summary: "newest summary" };
    const context = {
      language: "en-US",
      cache: { deepCompact: stalePacket },
      store: {
        readRecentTranscriptEvents: async () => ({
          events: [{ type: "deep_compact_packet", packet: newestPacket }],
        }),
      },
    };

    const result = await maybeRunDeepCompactBeforeProvider({
      context: context as never,
      sessionId: "session-newest-packet",
      runtime: { model: "test-model", provider: "test-provider" } as never,
      trigger: "request",
      gateway: {} as never,
      deps: {} as never,
    });

    expect(result).toEqual({ ok: true, packet: newestPacket });
    expect(context.cache.deepCompact).toEqual(newestPacket);
  });

  it("replaces a stale owner without waiting for its blocked stream to settle", async () => {
    let releaseOldStream!: () => void;
    let markOldStreamStarted!: () => void;
    const oldStreamStarted = new Promise<void>((resolve) => {
      markOldStreamStarted = resolve;
    });
    const oldStreamRelease = new Promise<void>((resolve) => {
      releaseOldStream = resolve;
    });
    let releaseNewStream!: () => void;
    let markNewStreamStarted!: () => void;
    const newStreamStarted = new Promise<void>((resolve) => {
      markNewStreamStarted = resolve;
    });
    const newStreamRelease = new Promise<void>((resolve) => {
      releaseNewStream = resolve;
    });
    const { context, deps, appendedEvents, boundaries } = createOwnedCompactHarness();
    const oldController = new AbortController();
    const oldGateway = {
      async *stream() {
        markOldStreamStarted();
        await oldStreamRelease;
        yield* [];
      },
    };
    const newGateway = {
      async *stream() {
        markNewStreamStarted();
        await newStreamRelease;
        yield { type: "assistant_text_delta", id: "new", text: "new owner summary" };
        yield { type: "message_stop", id: "new", chunkCount: 1, hadUsage: false };
      },
    };

    const oldResultPromise = maybeRunDeepCompactBeforeProvider({
      context,
      sessionId: "session-abort-empty",
      runtime: { model: "test-model", provider: "test-provider" } as never,
      trigger: "manual",
      gateway: oldGateway as never,
      signal: oldController.signal,
      deps,
    });
    await oldStreamStarted;
    const oldRun = context.deepCompactInFlight?.promise;
    expect(oldRun).toBeDefined();

    oldController.abort();
    await expect(oldResultPromise).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("cancelled"),
    });
    expect(context.deepCompactInFlight?.promise).toBe(oldRun);

    context.currentRequestTurnId = "turn-b";
    context.runtimeContextId = "turn-b";
    const newResultPromise = maybeRunDeepCompactBeforeProvider({
      context,
      sessionId: "session-abort-empty",
      runtime: { model: "test-model", provider: "test-provider" } as never,
      trigger: "manual",
      gateway: newGateway as never,
      signal: new AbortController().signal,
      deps,
    });
    await newStreamStarted;
    const newRun = context.deepCompactInFlight?.promise;
    expect(newRun).toBeDefined();
    expect(newRun).not.toBe(oldRun);

    releaseOldStream();
    await oldRun;
    expect(context.deepCompactInFlight?.promise).toBe(newRun);

    releaseNewStream();
    await expect(newResultPromise).resolves.toMatchObject({ ok: true });

    expect(context.deepCompactInFlight).toBeUndefined();
    expect(context.cache.deepCompact?.summary).toContain("new owner summary");
    expect(boundaries).toHaveLength(1);
    expect(appendedEvents.filter((event) => event.type === "deep_compact_packet")).toHaveLength(1);
  });

  it("drops the packet when ownership changes while output projection is blocked", async () => {
    let releaseProjection!: () => void;
    let markProjectionStarted!: () => void;
    const projectionStarted = new Promise<void>((resolve) => {
      markProjectionStarted = resolve;
    });
    const projectionRelease = new Promise<void>((resolve) => {
      releaseProjection = resolve;
    });
    const { context, deps, appendedEvents, boundaries } = createOwnedCompactHarness();
    context.compactOutputMemory = async () => {
      markProjectionStarted();
      await projectionRelease;
      return { beforeCount: 8, afterCount: 4 };
    };
    const gateway = {
      async *stream() {
        yield { type: "assistant_text_delta", id: "projection", text: "stale projection" };
        yield { type: "message_stop", id: "projection", chunkCount: 1, hadUsage: false };
      },
    };

    const resultPromise = maybeRunDeepCompactBeforeProvider({
      context,
      sessionId: "session-projection-owner",
      runtime: { model: "test-model", provider: "test-provider" } as never,
      trigger: "manual",
      gateway: gateway as never,
      signal: new AbortController().signal,
      deps,
    });
    await projectionStarted;
    context.currentRequestTurnId = "turn-b";
    context.runtimeContextId = "turn-b";
    releaseProjection();

    await expect(resultPromise).resolves.toMatchObject({ ok: false });
    expect(context.cache.deepCompact).toBeUndefined();
    expect(boundaries).toEqual([]);
    expect(appendedEvents.some((event) => event.type === "deep_compact_packet")).toBe(false);
  });

  it("does not write compact progress when the owner is stale before deep compact starts", async () => {
    const { context, deps } = createOwnedCompactHarness();
    let rerenders = 0;
    context.shellRerender = () => {
      rerenders += 1;
    };
    const gateway = {
      async *stream() {
        yield { type: "assistant_text_delta", id: "stale-start", text: "should not start" };
        yield { type: "message_stop", id: "stale-start", chunkCount: 1, hadUsage: false };
      },
    };

    const result = await maybeRunDeepCompactBeforeProvider({
      context,
      sessionId: "session-stale-start",
      runtime: { model: "test-model", provider: "test-provider" } as never,
      trigger: "manual",
      gateway: gateway as never,
      signal: new AbortController().signal,
      commitGuard: () => false,
      deps,
    });

    expect(result).toMatchObject({ ok: false });
    expect(context.cache.compactProgress).toBeUndefined();
    expect(context.deepCompactInFlight).toBeUndefined();
    expect(rerenders).toBe(0);
  });

  it("does not run an unguarded boundary projection after deep compact commit", async () => {
    const { context, deps } = createOwnedCompactHarness();
    const projections: Array<{ projectMainScreen?: boolean } | undefined> = [];
    context.compactOutputMemory = async (options) => {
      projections.push(options);
      return { beforeCount: 8, afterCount: 4 };
    };
    const gateway = {
      async *stream() {
        yield { type: "assistant_text_delta", id: "single-projection", text: "single projection" };
        yield { type: "message_stop", id: "single-projection", chunkCount: 1, hadUsage: false };
      },
    };

    const result = await maybeRunDeepCompactBeforeProvider({
      context,
      sessionId: "session-single-projection",
      runtime: { model: "test-model", provider: "test-provider" } as never,
      trigger: "manual",
      gateway: gateway as never,
      signal: new AbortController().signal,
      deps: { ...deps, recordCompactBoundary },
    });

    expect(result).toMatchObject({ ok: true });
    expect(projections).toEqual([{ projectMainScreen: true }]);
    expect(context.cache.compactBoundaries).toHaveLength(1);
  });

  it("does not append a deep compact failure event after owner changes during append", async () => {
    const { context, deps, appendedEvents } = createOwnedCompactHarness();
    const failureEvents: string[] = [];
    const gateway = {
      async *stream() {
        yield {
          type: "error",
          error: { code: "provider_failed", message: "stale failure" },
        };
      },
    };

    const result = await maybeRunDeepCompactBeforeProvider({
      context,
      sessionId: "session-failure-append-owner",
      runtime: { model: "test-model", provider: "test-provider" } as never,
      trigger: "manual",
      gateway: gateway as never,
      signal: new AbortController().signal,
      deps: {
        ...deps,
        appendSystemEvent: async (_context, _sessionId, message, level, commitGuard) => {
          context.currentRequestTurnId = "turn-b";
          context.runtimeContextId = "turn-b";
          if (!commitGuard || commitGuard()) {
            appendedEvents.push({ type: "system_event" });
            if (message.includes("deep compact failed")) failureEvents.push(`${level}:${message}`);
          }
        },
      },
    });

    expect(result).toMatchObject({ ok: false });
    expect(failureEvents).toEqual([]);
  });

  it("uses the transcript commit guard when ownership changes during packet append", async () => {
    let releasePacketAppend!: () => void;
    let markPacketAppendStarted!: () => void;
    const packetAppendStarted = new Promise<void>((resolve) => {
      markPacketAppendStarted = resolve;
    });
    const packetAppendRelease = new Promise<void>((resolve) => {
      releasePacketAppend = resolve;
    });
    const { context, deps, appendedEvents, boundaries } = createOwnedCompactHarness();
    const appendEvent = context.store.appendEvent.bind(context.store);
    context.store.appendEvent = async (sessionId, event, commitGuard) => {
      if (event.type === "deep_compact_packet") {
        markPacketAppendStarted();
        await packetAppendRelease;
      }
      await appendEvent(sessionId, event, commitGuard);
    };
    const gateway = {
      async *stream() {
        yield { type: "assistant_text_delta", id: "packet", text: "stale packet" };
        yield { type: "message_stop", id: "packet", chunkCount: 1, hadUsage: false };
      },
    };

    const resultPromise = maybeRunDeepCompactBeforeProvider({
      context,
      sessionId: "session-packet-owner",
      runtime: { model: "test-model", provider: "test-provider" } as never,
      trigger: "manual",
      gateway: gateway as never,
      signal: new AbortController().signal,
      deps,
    });
    await packetAppendStarted;
    context.currentRequestTurnId = "turn-b";
    context.runtimeContextId = "turn-b";
    releasePacketAppend();

    await expect(resultPromise).resolves.toMatchObject({ ok: false });
    expect(context.cache.deepCompact).toBeUndefined();
    expect(boundaries).toEqual([]);
    expect(appendedEvents.some((event) => event.type === "deep_compact_packet")).toBe(false);
  });

  it("does not start deep compact when ownership changes while restoring transcript", async () => {
    let releaseResume!: () => void;
    let markResumeStarted!: () => void;
    const resumeStarted = new Promise<void>((resolve) => {
      markResumeStarted = resolve;
    });
    const resumeRelease = new Promise<void>((resolve) => {
      releaseResume = resolve;
    });
    const { context, deps, appendedEvents, boundaries } = createOwnedCompactHarness();
    context.store.resume = async () => {
      markResumeStarted();
      await resumeRelease;
      return {
        session: {
          id: "session-resume-owner",
          projectPath: process.cwd(),
          projectName: "Linghun",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          model: "test-model",
          permissionMode: "default",
          language: "en-US",
          transcriptPath: "transcript.jsonl",
          cost: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            estimatedUsd: 0,
            estimatedCny: 0,
          },
          cache: {
            hitRate: null,
            readTokens: 0,
            writeTokens: 0,
            historySize: 0,
          },
        },
        transcript: [
          {
            type: "user_message",
            id: "large-restored-transcript",
            text: "large restored transcript ".repeat(10_000),
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        diagnostics: [],
      };
    };
    let providerStarted = false;
    const gateway = {
      async *stream() {
        providerStarted = true;
        yield { type: "assistant_text_delta", id: "resume", text: "stale resume packet" };
        yield { type: "message_stop", id: "resume", chunkCount: 1, hadUsage: false };
      },
    };

    const resultPromise = maybeRunDeepCompactBeforeProvider({
      context,
      sessionId: "session-resume-owner",
      runtime: { model: "test-model", provider: "test-provider" } as never,
      trigger: "manual",
      gateway: gateway as never,
      signal: new AbortController().signal,
      deps,
    });
    await resumeStarted;
    context.currentRequestTurnId = "turn-b";
    context.runtimeContextId = "turn-b";
    releaseResume();

    await expect(resultPromise).resolves.toMatchObject({ ok: false });
    expect(providerStarted).toBe(false);
    expect(context.cache.deepCompact).toBeUndefined();
    expect(boundaries).toEqual([]);
    expect(appendedEvents.some((event) => event.type === "deep_compact_packet")).toBe(false);
  });

  it("feeds one previous authoritative compact plus new events into recompression", () => {
    const packet = {
      ...makePacket(),
      summary: "OLD_GOAL",
      decisions: ["OLD_DECISION"],
      risks: ["OLD_RISK"],
    };
    const context = {
      projectPath: process.cwd(),
      evidence: [],
      recentlyMentionedFiles: [],
      tools: { changedFiles: [], todos: [] },
      agents: [],
      backgroundTasks: [],
      workflows: { runs: [] },
      todos: [],
      routeDecisions: [],
      cache: {},
      failureLearning: { records: [] },
      memory: { accepted: [] },
      index: {},
    } as never;

    const messages = buildDeepCompactRequestMessages(
      context,
      [
        { type: "deep_compact_packet", packet },
        { type: "user_message", text: "NEW_EVENT" },
      ] as never,
      "manual",
    );
    const prompt = messages.map((message) => message.content).join("\n");

    expect(prompt).toContain("OLD_GOAL");
    expect(prompt).toContain("OLD_DECISION");
    expect(prompt).toContain("OLD_RISK");
    expect(prompt).toContain("NEW_EVENT");
    expect(prompt.match(/previous authoritative compact:/gu)).toHaveLength(1);
  });

  it("does not let an invalid newer packet hide post-compact pressure", () => {
    const packet = makePacket();
    const context = { cache: { deepCompact: packet } } as never;
    const transcript = [
      { type: "deep_compact_packet", packet },
      { type: "deep_compact_packet", packet: { summary: "invalid" } },
      ...Array.from({ length: 40 }, (_, index) => ({
        type: "user_message",
        text: `new-${index}`,
      })),
    ] as never;

    expect(shouldRunDeepCompact(context, transcript, "request")).toBe(true);
  });

  it("restores the newest valid packet when a newer persisted packet is invalid", () => {
    const packet = makePacket();
    const context = {
      sessionId: "session-deep-resume",
      projectPath: process.cwd(),
      tools: { todos: [] },
      evidence: [],
      checkpoints: [],
      memory: {
        candidates: [],
        accepted: [],
        rejected: [],
        disabled: [],
        retired: [],
        tombstones: [],
      },
      cache: { compacted: false, compactBoundaries: [], deepCompact: undefined as DeepCompactPacket | undefined },
    };

    hydrateResumeContext(context as never, [
      { type: "deep_compact_packet", packet },
      { type: "deep_compact_packet", packet: { summary: "invalid newer packet" } },
    ] as never);

    expect(context.cache.compacted).toBe(true);
    expect(context.cache.deepCompact).toEqual(packet);
  });

  it("keeps repeated compact chains bounded with one authoritative marker", () => {
    const context = {
      projectPath: process.cwd(),
      evidence: [],
      recentlyMentionedFiles: [],
      tools: { changedFiles: [], todos: [] },
      agents: [],
      backgroundTasks: [],
      workflows: { runs: [] },
      todos: [],
      routeDecisions: [],
      cache: {},
      failureLearning: { records: [] },
      memory: { accepted: [] },
      index: {},
    } as never;
    const runtime = { model: "gpt-test", provider: "test-provider" } as never;
    let packet: DeepCompactPacket = {
      ...makePacket(),
      narrativeSummary: "older conversation summary",
      userMessagesVerbatim: ["ORIGINAL_USER_GOAL"],
    };
    let largestPrompt = 0;

    for (let index = 0; index < 1_000; index += 1) {
      const transcript = [
        { type: "deep_compact_packet", packet },
        { type: "user_message", text: `new event ${index}` },
      ] as never;
      const prompt = buildDeepCompactRequestMessages(context, transcript, "request")
        .map((message) => message.content)
        .join("\n");
      largestPrompt = Math.max(largestPrompt, prompt.length);
      expect(prompt.match(/previous authoritative compact:/gu)).toHaveLength(1);
      packet = createDeepCompactPacket({
        context,
        transcript,
        summary: prompt,
        runtime,
        trigger: "request",
      });
    }

    expect(packet.narrativeSummary).toContain("older conversation summary");
    expect(packet.userMessagesVerbatim).toContain("ORIGINAL_USER_GOAL");
    expect(packet.userMessagesVerbatim).toContain("new event 999");
    expect(largestPrompt).toBeLessThan(30_000);
  });

  it("keeps fresh authoritative fields when the previous packet is saturated", () => {
    const previousPacket = {
      ...makePacket(),
      preservedEvidenceRefs: Array.from({ length: 20 }, (_, index) => `old-evidence-${index}`),
      preservedFiles: Array.from({ length: 20 }, (_, index) => `old-file-${index}.ts`),
      decisions: Array.from({ length: 20 }, (_, index) => `old-decision-${index}`),
      risks: Array.from({ length: 20 }, (_, index) => `old-risk-${index}`),
    };
    const context = {
      projectPath: process.cwd(),
      evidence: [{ id: "fresh-evidence", source: "fresh-file.ts", summary: "fresh proof" }],
      recentlyMentionedFiles: ["fresh-file.ts"],
      tools: { changedFiles: ["fresh-file.ts"], todos: [] },
      agents: [],
      backgroundTasks: [],
      workflows: { runs: [] },
      todos: [],
      routeDecisions: [
        {
          role: "fresh-role",
          selectedProvider: "fresh-provider",
          selectedModel: "fresh-model",
          fallbackUsed: false,
        },
      ],
      cache: {},
      failureLearning: {
        records: [{ category: "test", avoidNextTime: "fresh-risk", status: "active" }],
      },
      memory: { accepted: [] },
      index: {},
    } as never;

    const packet = createDeepCompactPacket({
      context,
      transcript: [{ type: "deep_compact_packet", packet: previousPacket }] as never,
      summary: "latest summary",
      runtime: { model: "gpt-test", provider: "test-provider" } as never,
      trigger: "request",
    });

    expect(packet.preservedEvidenceRefs).toContain("fresh-evidence");
    expect(packet.preservedFiles).toContain("fresh-file.ts");
    expect(packet.decisions).toContain("fresh-role:fresh-provider/fresh-model fallback no");
    expect(packet.risks).toContain("test:fresh-risk");
    expect(packet.preservedEvidenceRefs).toHaveLength(20);
    expect(packet.preservedFiles).toHaveLength(20);
    expect(packet.decisions).toHaveLength(20);
    expect(packet.risks).toHaveLength(20);
  });

  it("inserts compact continuity and optional restore context after all leading system segments", () => {
    const messages: ModelMessage[] = [
      { role: "system", content: "stable system" },
      { role: "system", content: "dynamic system" },
      { role: "user", content: "Context compact projection\nstable recent summary" },
      { role: "user", content: "current request" },
    ];

    const result = injectDeepCompactSummary(messages, makePacket(), [
      { role: "user", content: "Post-compact restored context\nfile src/foo.ts" },
    ]);

    expect(result.map((message) => message.role)).toEqual([
      "system",
      "system",
      "user",
      "user",
      "user",
      "user",
    ]);
    expect(result[0]?.content).toBe("stable system");
    expect(result[1]?.content).toBe("dynamic system");
    expect(result[2]?.content).toContain("Deep compact context");
    expect(result[2]?.content).toContain("latest user request");
    expect(result[2]?.content).not.toContain("[Deep compact diagnostics]");
    expect(result[2]?.content).not.toContain("id deep-test");
    expect(result[3]?.content).toContain("Context compact projection");
    expect(result[4]?.content).toContain("Post-compact restored context");
    expect(result[5]?.content).toBe("current request");
  });

  it("keeps dynamic packet diagnostics out of the stable provider prefix", () => {
    const text = formatDeepCompactPromptSummary(makePacket()) ?? "";

    expect(text).toContain("Deep compact context");
    expect(text).toContain("scope full transcript semantic compact");
    expect(text).not.toContain("deep-test");
    expect(text).not.toContain("created at");
    expect(text).not.toContain("[Deep compact diagnostics]");
    expect(text).not.toContain("id deep-test");
    expect(text).not.toContain("created at 2026-01-01T00:00:00.000Z");
  });

  it("keeps runtime ids and fallback state in the ledger packet but out of provider text", () => {
    const runtimeId = "11111111-2222-4333-8444-555555555555";
    const packet: DeepCompactPacket = {
      ...makePacket(),
      preservedEvidenceRefs: [runtimeId],
      activeAgentsWorkflows: [`agent:${runtimeId}:running:work`],
      needsAttentionAgentsWorkflows: [`workflow:${runtimeId}:blocked:work`],
      toolResultSummaries: [
        `tool_result:Read:is error no; evidence ${runtimeId}; summary ok`,
        `tool_end:${runtimeId}:truncated no; full output path none; summary ok`,
      ],
      decisions: ["executor:test/model fallback yes"],
      risks: ["compactFailure:temporary provider fallback"],
    };
    const text = formatDeepCompactPromptSummary(packet) ?? "";

    expect(packet.preservedEvidenceRefs).toContain(runtimeId);
    expect(packet.activeAgentsWorkflows.join("\n")).toContain(runtimeId);
    expect(text).not.toContain(runtimeId);
    expect(text).not.toContain("fallback yes");
    expect(text).not.toContain("compactFailure");
    expect(text).toContain("active agents/workflows 1");
    expect(text).toContain("needs-attention agents/workflows 1");
  });

  it("removes quoted owner and fallback fields from provider-stable compact text", () => {
    const text = sanitizeProviderStableCompactText(
      '{"requestTurnId":"turn-json-42","ownerId":"owner-json-42","fallbackUsed":true,"path":"src/a.ts"}',
    );

    expect(text).not.toContain("requestTurnId");
    expect(text).not.toContain("turn-json-42");
    expect(text).not.toContain("ownerId");
    expect(text).not.toContain("owner-json-42");
    expect(text).not.toContain("fallbackUsed");
    expect(text).toContain('"path":"src/a.ts"');
  });

  it("omits transcript runtime ids before asking the deep compact model for a summary", () => {
    const { context } = createOwnedCompactHarness();
    const runtimeId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const messages = buildDeepCompactRequestMessages(
      context,
      [
        {
          type: "user_message",
          id: "u1",
          text: "keep the migration goal",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          type: "tool_call_start",
          id: "call-stable",
          name: "Read",
          input: {
            path: "src/a.ts",
            requestTurnId: "turn-json-42",
            ownerId: "owner-json-42",
            fallbackUsed: true,
          },
          createdAt: "2026-01-01T00:00:00.500Z",
        },
        {
          type: "tool_result",
          toolUseId: runtimeId,
          toolName: "Read",
          content: "source summary",
          evidenceId: runtimeId,
          createdAt: "2026-01-01T00:00:01.000Z",
        },
        {
          type: "tool_call_end",
          id: runtimeId,
          name: "Read",
          input: { path: "src/a.ts" },
          output: { text: "source summary", truncated: false },
          createdAt: "2026-01-01T00:00:02.000Z",
        },
        {
          type: "system_event",
          level: "info",
          message:
            'resume {"requestTurnId":"turn-system-42","ownerId":"owner-system-42","fallbackUsed":true} path src/a.ts',
          createdAt: "2026-01-01T00:00:03.000Z",
        },
      ] as never,
      "request",
    );
    const providerText = messages.map((message) => message.content).join("\n");

    expect(providerText).toContain("keep the migration goal");
    expect(providerText).not.toContain(runtimeId);
    expect(providerText).not.toContain("2026-01-01T00:00:01.000Z");
    expect(providerText).not.toContain("turn-json-42");
    expect(providerText).not.toContain("owner-json-42");
    expect(providerText).not.toContain("turn-system-42");
    expect(providerText).not.toContain("owner-system-42");
    expect(providerText).not.toContain("fallbackUsed");
    expect(providerText).toContain("src/a.ts");
  });

  it("accepts old deep compact packets without new fidelity fields", () => {
    expect(isDeepCompactPacket(makePacket())).toBe(true);
  });

  it("keeps high-fidelity packet fields in the compact continuity prompt", () => {
    const context = {
      projectPath: process.cwd(),
      evidence: [{ id: "ev-read", source: "packages/tui/src/foo.ts", summary: "read foo" }],
      recentlyMentionedFiles: ["packages/tui/src/foo.ts"],
      tools: { changedFiles: ["packages/tui/src/foo.ts"], todos: [] },
      agents: [],
      backgroundTasks: [],
      workflows: { runs: [] },
      todos: [],
      routeDecisions: [],
      cache: {},
      failureLearning: { records: [] },
      memory: { accepted: [] },
      index: {},
    } as never;

    const packet = createDeepCompactPacket({
      context,
      summary: "narrative keep exact goals",
      runtime: { model: "gpt-test", provider: "test-provider", role: "main" } as never,
      trigger: "request",
      transcript: [
        { type: "user_message", id: "u1", text: "please preserve exact migration target", createdAt: "2026-01-01T00:00:00.000Z" },
        {
          type: "tool_result",
          toolUseId: "tool-1",
          toolName: "Read",
          content: "```ts\nexport const answer = 42;\n```",
          evidenceId: "ev-read",
          createdAt: "2026-01-01T00:00:01.000Z",
        },
      ],
    });

    expect(packet.userMessagesVerbatim).toEqual(["please preserve exact migration target"]);
    expect(packet.toolResultSummaries?.[0]).toContain("tool_result:Read");
    expect(packet.codeSnippets?.[0]).toContain("export const answer = 42");
    const prompt = formatDeepCompactPromptSummary(packet) ?? "";
    expect(prompt).toContain("user messages verbatim please preserve exact migration target");
    expect(prompt).toContain("tool result summaries tool_result:Read");
    expect(prompt).toContain("code snippets ```ts export const answer = 42; ```");
  });

  it("still inserts at the front when no system prefix exists", () => {
    const result = insertAfterLeadingSystemMessages(
      [{ role: "user", content: "current request" }],
      { role: "user", content: "compact summary" },
    );

    expect(result.map((message) => message.content)).toEqual([
      "compact summary",
      "current request",
    ]);
  });

  it("summarizes cyclic tool results before the compact provider request", () => {
    const cyclic: { rows: string[]; self?: unknown } = {
      rows: Array.from({ length: 20_000 }, (_, index) => `row-${index}`),
    };
    cyclic.self = cyclic;
    const context = {
      projectPath: process.cwd(),
      evidence: [],
      recentlyMentionedFiles: [],
      tools: { changedFiles: [], todos: [] },
      agents: [],
      backgroundTasks: [],
      workflows: { runs: [] },
      todos: [],
      routeDecisions: [],
      cache: {},
      failureLearning: { records: [] },
      memory: { accepted: [] },
      index: {},
    } as never;

    const messages = buildDeepCompactRequestMessages(
      context,
      [
        {
          type: "user_message",
          text: "please investigate oom",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          type: "tool_result",
          toolName: "Read",
          toolUseId: "tool-1",
          content: cyclic,
          isError: false,
          createdAt: "2026-01-01T00:00:01.000Z",
        },
      ] as never,
      "request",
    );

    const compactRequestText = messages.map((message) => message.content).join("\n");
    expect(compactRequestText).toContain("[truncated]");
    expect(compactRequestText.length).toBeLessThan(60_000);
  });
});
