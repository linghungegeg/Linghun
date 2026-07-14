import { Writable } from "node:stream";
import { defaultConfig } from "@linghun/config";
import type { TranscriptEvent } from "@linghun/core";
import { builtInTools, createToolContext, type ToolOutput } from "@linghun/tools";
import { describe, expect, it } from "vitest";
import { interruptAllActiveWork } from "./background-control-runtime.js";
import { appendDeferredToolResultEvent } from "./evidence-runtime.js";
import { hydrateResumeContext } from "./handoff-session-runtime.js";
import {
  executeApprovedModelToolUse,
  executeDeferredDispatchToolUse,
  executeModelToolUse,
} from "./model-tool-runtime.js";
import type { TuiContext } from "./tui-context-runtime.js";

class MemoryOutput extends Writable {
  text = "";

  override _write(chunk: unknown, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.text += String(chunk);
    callback();
  }
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function makeContext(events: unknown[]): TuiContext {
  return {
    tools: createToolContext(process.cwd()),
    currentRequestTurnId: "turn-a",
    requestActivityOwner: { kind: "foreground", requestTurnId: "turn-a" },
    requestActivityPhase: "tool_running",
    store: {
      appendEvent: async (_sessionId: string, event: unknown) => {
        events.push(event);
      },
    },
    language: "zh-CN",
    evidence: [],
    backgroundTasks: [],
    backgroundAbortControllers: new Map(),
  } as unknown as TuiContext;
}

async function runDelayedReadIsolationIteration(iteration: number): Promise<void> {
  const events: unknown[] = [];
  const context = makeContext(events);
  const output = new MemoryOutput();
  const controllerA = new AbortController();
  context.tools.abortSignal = controllerA.signal;
  const result = deferred<ToolOutput>();
  const started = deferred<void>();
  const originalRead = builtInTools.Read.call;
  builtInTools.Read.call = (async () => {
    started.resolve();
    return result.promise;
  }) as typeof originalRead;

  try {
    const pending = executeApprovedModelToolUse(
      { id: `read-${iteration}`, name: "Read", input: { path: "README.md" } },
      "Read",
      context,
      "session-delayed-tool",
      output,
      undefined,
      undefined,
      { requestTurnId: "turn-a", signal: controllerA.signal },
    );
    await started.promise;

    controllerA.abort();
    const controllerB = new AbortController();
    const progressB = () => undefined;
    context.currentRequestTurnId = "turn-b";
    context.requestActivityOwner = { kind: "foreground", requestTurnId: "turn-b" };
    context.requestActivityPhase = "request_started";
    context.tools.abortSignal = controllerB.signal;
    context.tools.onProgress = progressB;
    result.resolve({ text: `late result ${iteration}` });

    await expect(pending).resolves.toMatchObject({
      ok: false,
      text: expect.stringContaining("cancelled: stale foreground tool result discarded"),
    });
    expect(context.currentRequestTurnId).toBe("turn-b");
    expect(context.requestActivityOwner).toEqual({ kind: "foreground", requestTurnId: "turn-b" });
    expect(context.requestActivityPhase).toBe("request_started");
    expect(context.tools.abortSignal).toBe(controllerB.signal);
    expect(context.tools.onProgress).toBe(progressB);
    expect(context.evidence).toEqual([]);
    expect(output.text).not.toContain(`late result ${iteration}`);

    const eventTypes = events.map((event) => (event as { type?: string }).type);
    expect(eventTypes).toContain("tool_call_start");
    expect(eventTypes).not.toContain("tool_call_end");
    expect(eventTypes).not.toContain("tool_result");
    expect(eventTypes).not.toContain("evidence_record");
    expect(
      events.some((event) =>
        JSON.stringify(event).includes("stale_tool_result_dropped"),
      ),
    ).toBe(true);
  } finally {
    builtInTools.Read.call = originalRead;
  }
}

describe("foreground delayed tool ownership", () => {
  it("rejects stale SearchExtraTools before discovery, evidence, or transcript mutation", async () => {
    const events: unknown[] = [];
    const context = makeContext(events);
    context.currentRequestTurnId = "turn-b";
    context.discoveredDeferredToolNames = new Set(["existing-tool"]);
    const controller = new AbortController();
    controller.abort("old turn");

    const result = await executeDeferredDispatchToolUse(
      { id: "stale-search", name: "SearchExtraTools", input: { query: "repo" } },
      context,
      "session-stale-search",
      new MemoryOutput(),
      {
        messages: [],
        provider: "test",
        model: "test",
        endpointProfile: "responses",
        reasoningSent: false,
        requestTurnId: "turn-a",
        abortSignal: controller.signal,
      },
    );

    expect(result).toMatchObject({
      ok: false,
      text: "cancelled: stale deferred tool result discarded",
    });
    expect([...context.discoveredDeferredToolNames]).toEqual(["existing-tool"]);
    expect(context.evidence).toEqual([]);
    expect(events).toEqual([]);
  });

  it.each([
    ["CommandProposal", { command: "/status" }],
    ["IndexStatusInspect", {}],
    ["GitStatusInspect", {}],
  ])("rejects stale %s before side-path execution", async (name, input) => {
    const events: unknown[] = [];
    const context = makeContext(events);
    context.currentRequestTurnId = "turn-b";
    const controller = new AbortController();
    controller.abort("old turn");

    const result = await executeModelToolUse(
      { id: `stale-${name}`, name, input },
      context,
      "session-stale-side-path",
      new MemoryOutput(),
      {
        messages: [],
        provider: "test",
        model: "test",
        endpointProfile: "responses",
        reasoningSent: false,
        requestTurnId: "turn-a",
        abortSignal: controller.signal,
      },
    );

    expect(result.ok).toBe(false);
    expect(result.text).toContain("stale");
    expect(context.evidence).toEqual([]);
    expect(events).toEqual([]);
  });

  it("drops an interrupted tool result that resolves after a newer turn starts", async () => {
    await runDelayedReadIsolationIteration(1);
  });

  it("pressure: preserves the newer owner across repeated delayed tool completions", async () => {
    for (let iteration = 0; iteration < 200; iteration += 1) {
      await runDelayedReadIsolationIteration(iteration);
    }
  }, 30_000);

  it("does not commit MCP evidence when interrupted during the evidence append", async () => {
    const events: unknown[] = [];
    const context = makeContext(events);
    const evidenceAppendStarted = deferred<void>();
    const releaseEvidenceAppend = deferred<void>();
    context.store.appendEvent = async (
      _sessionId: string,
      event: unknown,
      commitGuard?: () => boolean,
    ) => {
      if ((event as { type?: string }).type === "evidence_record") {
        evidenceAppendStarted.resolve();
        await releaseEvidenceAppend.promise;
      }
      if (commitGuard && !commitGuard()) return;
      events.push(event);
    };
    const output = new MemoryOutput();
    const controllerA = new AbortController();
    const lateResponse = deferred<Response>();
    const toolCallStarted = deferred<void>();
    let toolCallRequestId = 0;
    context.projectPath = process.cwd();
    context.config = {
      ...defaultConfig,
      mcp: {
        ...defaultConfig.mcp,
        servers: {
          remote: { command: "", transport: "sse", url: "https://example.com/mcp" },
        },
      },
    };
    context.mcp = {
      enabled: true,
      servers: [{ name: "remote", command: "", status: "configured" }],
      tools: [
        {
          server: "remote",
          name: "demo",
          description: "demo",
          discovery: "discovered",
          trusted: true,
          schemaLoaded: true,
          runtimeVersion: "compatible",
        },
      ],
    };
    context.skills = {
      enabled: false,
      projectDir: process.cwd(),
      userDir: process.cwd(),
      skills: [],
      disabledIds: [],
      trustedIds: [],
      evolutionCandidates: [],
      rejectedEvolutionCandidates: [],
    };
    context.plugins = {
      enabled: false,
      projectDir: process.cwd(),
      userDir: process.cwd(),
      plugins: [],
      disabledIds: [],
      trustedIds: [],
    };
    context.index = { status: "unknown" } as TuiContext["index"];
    context.discoveredDeferredToolNames = new Set(["mcp:remote:demo"]);
    context.evidence = [];
    context.tools.abortSignal = controllerA.signal;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { id: number; method: string };
      if (request.method === "tools/list") {
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { tools: [{ name: "demo" }] } }),
          { headers: { "content-type": "application/json" } },
        );
      }
      toolCallRequestId = request.id;
      toolCallStarted.resolve();
      return lateResponse.promise;
    }) as typeof fetch;

    try {
      const pending = executeDeferredDispatchToolUse(
        {
          id: "mcp-late",
          name: "ExecuteExtraTool",
          input: { tool_name: "mcp:remote:demo", params: {} },
        },
        context,
        "session-delayed-mcp",
        output,
        {
          messages: [],
          provider: "deepseek",
          model: "deepseek-chat",
          endpointProfile: "chat_completions",
          reasoningSent: false,
          requestTurnId: "turn-a",
          abortSignal: controllerA.signal,
        },
      );
      await Promise.race([
        toolCallStarted.promise,
        pending.then((result) => {
          throw new Error(`MCP call finished before tools/call: ${JSON.stringify(result)}`);
        }),
      ]);

      lateResponse.resolve(
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: toolCallRequestId,
            error: { code: -32000, message: "late failure" },
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );
      await evidenceAppendStarted.promise;

      controllerA.abort();
      context.currentRequestTurnId = "turn-b";
      context.requestActivityOwner = { kind: "foreground", requestTurnId: "turn-b" };
      context.requestActivityPhase = "request_started";
      context.requestActivityToolUseId = "turn-b-tool";
      (context as { requestActivityToolTarget?: string }).requestActivityToolTarget = "new turn";
      context.tools.abortSignal = new AbortController().signal;
      releaseEvidenceAppend.resolve();

      await expect(pending).resolves.toMatchObject({
        ok: false,
        text: "cancelled: stale deferred tool result discarded",
      });
      expect(context.currentRequestTurnId).toBe("turn-b");
      expect(context.requestActivityOwner).toEqual({ kind: "foreground", requestTurnId: "turn-b" });
      expect(context.requestActivityToolUseId).toBe("turn-b-tool");
      expect((context as { requestActivityToolTarget?: string }).requestActivityToolTarget).toBe("new turn");
      expect(context.evidence).toEqual([]);
      expect(output.text).not.toContain("late failure");
      expect(events.some((event) => (event as { type?: string }).type === "tool_result")).toBe(false);
      expect(
        events.find((event) => (event as { type?: string }).type === "evidence_record"),
      ).toBeUndefined();

      const resumed = makeContext([]);
      resumed.memory = {
        candidates: [],
        accepted: [],
        rejected: [],
        disabled: [],
        retired: [],
      } as unknown as TuiContext["memory"];
      resumed.cache = {
        history: [],
        compactBoundaries: [],
      } as unknown as TuiContext["cache"];
      resumed.checkpoints = [];
      hydrateResumeContext(resumed, events as TranscriptEvent[]);
      expect(resumed.evidence).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not commit a deferred tool_result when its queued owner becomes stale", async () => {
    const events: unknown[] = [];
    const context = makeContext(events);
    const resultAppendStarted = deferred<void>();
    const releaseResultAppend = deferred<void>();
    let current = true;
    context.store.appendEvent = async (
      _sessionId: string,
      event: unknown,
      commitGuard?: () => boolean,
    ) => {
      if ((event as { type?: string }).type === "tool_result") {
        resultAppendStarted.resolve();
        await releaseResultAppend.promise;
      }
      if (commitGuard && !commitGuard()) return;
      events.push(event);
    };

    const pending = appendDeferredToolResultEvent(
      context,
      "session-delayed-result",
      "mcp-delayed-result",
      "ExecuteExtraTool",
      { text: "late MCP result" },
      false,
      undefined,
      () => current,
    );
    await resultAppendStarted.promise;
    current = false;
    releaseResultAppend.resolve();
    await pending;

    expect(events.some((event) => (event as { type?: string }).type === "tool_result")).toBe(false);
  });
});

describe("session-scoped background interrupt", () => {
  it("releases a captured foreground controller on persistence failure without clearing a replacement", async () => {
    const runCase = async (installReplacement: boolean) => {
      const context = makeContext([]);
      context.sessionId = "session-interrupt-failure";
      context.sessionStoreVerifiedId = context.sessionId;
      context.projectPath = process.cwd();
      context.config = defaultConfig;
      context.memory = { sessionDir: "" } as TuiContext["memory"];
      context.interrupt = { type: "running", taskId: "noncooperative", canCancel: true };
      const capturedController = new AbortController();
      const replacementController = new AbortController();
      context.activeAbortController = capturedController;
      context.tools.abortSignal = capturedController.signal;
      context.store.appendEvent = async (_sessionId: string, event: unknown) => {
        if ((event as { type?: string }).type !== "interrupt") return;
        if (installReplacement) {
          context.activeAbortController = replacementController;
          context.tools.abortSignal = replacementController.signal;
          context.interrupt = { type: "running", taskId: "replacement", canCancel: true };
        }
        throw new Error("interrupt persistence failed");
      };

      await expect(interruptAllActiveWork(context)).rejects.toThrow("interrupt persistence failed");
      return { capturedController, context, replacementController };
    };

    const released = await runCase(false);
    expect(released.capturedController.signal.aborted).toBe(true);
    expect(released.context.activeAbortController).toBeUndefined();
    expect(released.context.foregroundAbortPendingUntilMs).toBeGreaterThan(Date.now());
    expect(released.context.requestActivityOwner).toBeUndefined();
    expect(released.context.interrupt).toEqual({ type: "idle" });

    const replaced = await runCase(true);
    expect(replaced.capturedController.signal.aborted).toBe(true);
    expect(replaced.replacementController.signal.aborted).toBe(false);
    expect(replaced.context.activeAbortController).toBe(replaced.replacementController);
    expect(replaced.context.tools.abortSignal).toBe(replaced.replacementController.signal);
    expect(replaced.context.interrupt).toEqual({
      type: "running",
      taskId: "replacement",
      canCancel: true,
    });
  });

  it("does not cancel another session's background owner", async () => {
    const events: unknown[] = [];
    const context = makeContext(events);
    context.sessionId = "session-b";
    context.sessionStoreVerifiedId = "session-b";
    context.projectPath = process.cwd();
    context.config = defaultConfig;
    context.memory = { sessionDir: "" } as TuiContext["memory"];
    context.agents = [];
    context.workflows = {
      enabled: true,
      templates: [],
      disabledIds: [],
      activeRuns: [],
    };
    const taskA = {
      id: "background-a",
      kind: "bash" as const,
      ownerSessionId: "session-a",
      title: "session A task",
      status: "running" as const,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      heartbeatIntervalMs: 30_000,
      staleAfterMs: 120_000,
      hasOutput: false,
      userVisibleSummary: "A running",
    };
    const taskB = {
      ...taskA,
      id: "background-b",
      ownerSessionId: "session-b",
      title: "session B task",
    };
    context.backgroundTasks = [taskA, taskB];
    const controllerA = new AbortController();
    const controllerB = new AbortController();
    context.backgroundAbortControllers = new Map([
      [taskA.id, controllerA],
      [taskB.id, controllerB],
    ]);

    const result = await interruptAllActiveWork(context);

    expect(result).toEqual({ cancelled: 1, abortSignalsSent: 1, markedOnly: 0 });
    expect(controllerA.signal.aborted).toBe(false);
    expect(taskA.status).toBe("running");
    expect(controllerB.signal.aborted).toBe(true);
    expect(taskB.status).toBe("cancelled");
  });
});
