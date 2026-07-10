import { Writable } from "node:stream";
import { defaultConfig } from "@linghun/config";
import { builtInTools, createToolContext, type ToolOutput } from "@linghun/tools";
import { describe, expect, it } from "vitest";
import { interruptAllActiveWork } from "./background-control-runtime.js";
import { executeApprovedModelToolUse } from "./model-tool-runtime.js";
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
  it("drops an interrupted tool result that resolves after a newer turn starts", async () => {
    await runDelayedReadIsolationIteration(1);
  });

  it("pressure: preserves the newer owner across repeated delayed tool completions", async () => {
    for (let iteration = 0; iteration < 200; iteration += 1) {
      await runDelayedReadIsolationIteration(iteration);
    }
  }, 30_000);
});

describe("session-scoped background interrupt", () => {
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
