import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __testCreatePreEngineDaemon,
  __testGetOrCreatePreEngineDaemon,
  disposePreEngineDaemonsForOwner,
} from "./mcp-index-runtime.js";
import {
  createPreContextInputSchema,
  createPreImpactInputSchema,
  createPrePlanInputSchema,
  createPreVerifyInputSchema,
} from "./model-loop-runtime.js";

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: vi.fn(),
}));

class FakePreEngineProcess extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = Object.assign(new EventEmitter(), { resume: vi.fn() });
  readonly stdin = Object.assign(new EventEmitter(), { write: vi.fn(this.write.bind(this)) });
  killed = false;
  callId?: number;

  constructor(
    private readonly initialize: "reply" | "error" | "hang" | "exit" = "reply",
    private readonly call: "reply" | "hang" | "epipe" = "reply",
    private readonly initializeResult: unknown = {
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "linghun-pre-engine", version: "0.1.0" },
    },
    private readonly toolsResult: unknown = {
      tools: [
        { name: "pre_context", inputSchema: createPreContextInputSchema() },
        { name: "pre_impact", inputSchema: createPreImpactInputSchema() },
        { name: "pre_plan", inputSchema: createPrePlanInputSchema() },
        { name: "pre_verify", inputSchema: createPreVerifyInputSchema() },
      ],
    },
  ) {
    super();
  }

  kill(): boolean {
    if (this.killed) return false;
    this.killed = true;
    queueMicrotask(() => this.emit("exit", 0));
    return true;
  }

  respondToCall(): void {
    if (this.callId === undefined) throw new Error("tool call was not written");
    this.stdout.emit(
      "data",
      `${JSON.stringify({ id: this.callId, result: { content: [{ type: "text", text: "ok" }] } })}\n`,
    );
  }

  emitRaw(text: string): void {
    this.stdout.emit("data", text);
  }

  private write(
    chunk: string,
    callback?: (error?: Error | null) => void,
  ): boolean {
    const message = JSON.parse(chunk) as { id?: number; method?: string };
    if (message.method !== "tools/call" || this.call !== "epipe") callback?.();
    if (message.method === "initialize" && this.initialize === "reply") {
      queueMicrotask(() =>
        this.stdout.emit(
          "data",
          `${JSON.stringify({ id: 0, result: this.initializeResult })}\n`,
        ),
      );
    }
    if (message.method === "initialize" && this.initialize === "error") {
      queueMicrotask(() =>
        this.stdout.emit(
          "data",
          `${JSON.stringify({ id: 0, error: { message: "initialize rejected" } })}\n`,
        ),
      );
    }
    if (message.method === "initialize" && this.initialize === "exit") {
      queueMicrotask(() => {
        this.stderr.emit("data", "libc.so.6: version `GLIBC_2.39' not found\n");
        this.emit("exit", 127, null);
      });
    }
    if (message.method === "tools/list") {
      queueMicrotask(() =>
        this.stdout.emit(
          "data",
          `${JSON.stringify({ id: message.id, result: this.toolsResult })}\n`,
        ),
      );
    }
    if (message.method === "tools/call") {
      this.callId = message.id;
      if (this.call === "reply") queueMicrotask(() => this.respondToCall());
      if (this.call === "epipe") {
        const error = Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
        callback?.(error);
        queueMicrotask(() => this.stdin.emit("error", error));
      }
    }
    return true;
  }
}

describe("PreEngineDaemon lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(spawn).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("isolates daemon queues by the existing runtime owner", () => {
    const first = __testGetOrCreatePreEngineDaemon("pre-engine", "F:/repo", "runtime-a");
    const same = __testGetOrCreatePreEngineDaemon("pre-engine", "F:/repo", "runtime-a");
    const other = __testGetOrCreatePreEngineDaemon("pre-engine", "F:/repo", "runtime-b");

    expect(same).toBe(first);
    expect(other).not.toBe(first);
  });

  it("aborts an active call, kills its process, and lets the next queued call continue", async () => {
    const hung = new FakePreEngineProcess("reply", "hang");
    const healthy = new FakePreEngineProcess("reply", "reply");
    vi.mocked(spawn)
      .mockReturnValueOnce(hung as never)
      .mockReturnValueOnce(healthy as never);
    const daemon = __testCreatePreEngineDaemon("pre-engine", "F:/repo");
    const controller = new AbortController();

    const first = daemon.call("pre_plan", { task: "first" }, controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();

    await expect(first).resolves.toMatchObject({ ok: false, errorCode: "ABORTED" });
    expect(hung.killed).toBe(true);
    expect(hung.stdout.listenerCount("data")).toBe(0);
    hung.respondToCall();
    await expect(daemon.call("pre_plan", { task: "second" })).resolves.toMatchObject({ ok: true });
    expect(healthy.killed).toBe(false);
  });

  it("does not let a hung runtime owner block another runtime owner", async () => {
    const hung = new FakePreEngineProcess("reply", "hang");
    const healthy = new FakePreEngineProcess("reply", "reply");
    vi.mocked(spawn)
      .mockReturnValueOnce(hung as never)
      .mockReturnValueOnce(healthy as never);
    const first = __testGetOrCreatePreEngineDaemon("pre-engine", "F:/shared", "runtime-hung");
    const second = __testGetOrCreatePreEngineDaemon("pre-engine", "F:/shared", "runtime-healthy");
    const controller = new AbortController();

    const blocked = first.call("pre_plan", { task: "blocked" }, controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    await expect(second.call("pre_plan", { task: "healthy" })).resolves.toMatchObject({ ok: true });
    controller.abort();
    await expect(blocked).resolves.toMatchObject({ ok: false, errorCode: "ABORTED" });
  });

  it("disposes only the terminal runtime owner and settles its active call", async () => {
    const owned = new FakePreEngineProcess("reply", "hang");
    const other = new FakePreEngineProcess("reply", "reply");
    vi.mocked(spawn)
      .mockReturnValueOnce(owned as never)
      .mockReturnValueOnce(other as never);
    const first = __testGetOrCreatePreEngineDaemon("pre-engine", "F:/terminal", "runtime-terminal");
    const second = __testGetOrCreatePreEngineDaemon("pre-engine", "F:/terminal", "runtime-other");

    const pending = first.call("pre_plan", { task: "pending" });
    const queued = first.call("pre_plan", { task: "queued" });
    await vi.advanceTimersByTimeAsync(0);
    await expect(second.call("pre_plan", { task: "healthy" })).resolves.toMatchObject({ ok: true });
    disposePreEngineDaemonsForOwner("runtime-terminal");

    await expect(pending).resolves.toMatchObject({ ok: false, errorCode: "OWNER_DISPOSED" });
    await expect(queued).resolves.toMatchObject({ ok: false, errorCode: "OWNER_DISPOSED" });
    expect(owned.killed).toBe(true);
    expect(owned.stdout.listenerCount("data")).toBe(0);
    expect(owned.listenerCount("error")).toBe(0);
    expect(owned.listenerCount("exit")).toBe(0);
    expect(other.killed).toBe(false);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(__testGetOrCreatePreEngineDaemon("pre-engine", "F:/terminal", "runtime-terminal"))
      .not.toBe(first);
    disposePreEngineDaemonsForOwner("runtime-other");
    disposePreEngineDaemonsForOwner("runtime-terminal");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("times out initialize without permanently occupying the queue", async () => {
    const hung = new FakePreEngineProcess("hang", "hang");
    const healthy = new FakePreEngineProcess("reply", "reply");
    vi.mocked(spawn)
      .mockReturnValueOnce(hung as never)
      .mockReturnValueOnce(healthy as never);
    const daemon = __testCreatePreEngineDaemon("pre-engine", "F:/repo");

    const first = daemon.call("pre_context", { symbol: "first" });
    await vi.advanceTimersByTimeAsync(30_000);

    await expect(first).resolves.toMatchObject({ ok: false, summary: "pre-engine initialize timed out" });
    expect(hung.killed).toBe(true);
    await expect(daemon.call("pre_context", { symbol: "second" })).resolves.toMatchObject({ ok: true });
  });

  it("rejects an initialize error response and releases the queue", async () => {
    const rejected = new FakePreEngineProcess("error", "hang");
    const healthy = new FakePreEngineProcess("reply", "reply");
    vi.mocked(spawn)
      .mockReturnValueOnce(rejected as never)
      .mockReturnValueOnce(healthy as never);
    const daemon = __testCreatePreEngineDaemon("pre-engine", "F:/repo");

    await expect(daemon.call("pre_context", { symbol: "first" })).resolves.toMatchObject({
      ok: false,
      summary: "initialize rejected",
    });
    expect(rejected.killed).toBe(true);
    await expect(daemon.call("pre_context", { symbol: "second" })).resolves.toMatchObject({ ok: true });
  });

  it.each([
    [
      "stale protocol",
      {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "linghun-pre-engine", version: "0.1.0" },
      },
      "pre-engine protocol mismatch",
    ],
    [
      "stale server version",
      {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "linghun-pre-engine", version: "0.0.9" },
      },
      "pre-engine server mismatch",
    ],
    [
      "missing tools capability",
      {
        protocolVersion: "2025-06-18",
        capabilities: {},
        serverInfo: { name: "linghun-pre-engine", version: "0.1.0" },
      },
      "pre-engine capability mismatch",
    ],
  ])("degrades %s and lets the next healthy binary recover", async (_name, snapshot, summary) => {
    const stale = new FakePreEngineProcess("reply", "hang", snapshot);
    const healthy = new FakePreEngineProcess("reply", "reply");
    vi.mocked(spawn).mockReturnValueOnce(stale as never).mockReturnValueOnce(healthy as never);
    const daemon = __testCreatePreEngineDaemon("pre-engine", "F:/repo");

    await expect(daemon.call("pre_context", { symbol: "first" })).resolves.toMatchObject({
      ok: false,
      summary: expect.stringContaining(summary),
    });
    expect(stale.killed).toBe(true);
    expect(stale.stdout.listenerCount("data")).toBe(0);
    expect(stale.listenerCount("error")).toBe(0);
    expect(stale.listenerCount("exit")).toBe(0);
    await expect(daemon.call("pre_context", { symbol: "second" })).resolves.toMatchObject({
      ok: true,
    });
  });

  it.each([
    [
      "missing tool",
      {
        tools: [
          { name: "pre_context", inputSchema: createPreContextInputSchema() },
          { name: "pre_impact", inputSchema: createPreImpactInputSchema() },
          { name: "pre_plan", inputSchema: createPrePlanInputSchema() },
        ],
      },
    ],
    [
      "tool order drift",
      {
        tools: [
          { name: "pre_impact", inputSchema: createPreImpactInputSchema() },
          { name: "pre_context", inputSchema: createPreContextInputSchema() },
          { name: "pre_plan", inputSchema: createPrePlanInputSchema() },
          { name: "pre_verify", inputSchema: createPreVerifyInputSchema() },
        ],
      },
    ],
    [
      "schema drift",
      {
        tools: [
          { name: "pre_context", inputSchema: createPreContextInputSchema() },
          { name: "pre_impact", inputSchema: createPreImpactInputSchema() },
          { name: "pre_plan", inputSchema: createPrePlanInputSchema() },
          { name: "pre_verify", inputSchema: { type: "object" } },
        ],
      },
    ],
  ])("rejects %s from the initialized daemon", async (_name, toolsResult) => {
    const process = new FakePreEngineProcess("reply", "hang", undefined, toolsResult);
    vi.mocked(spawn).mockReturnValueOnce(process as never);
    const daemon = __testCreatePreEngineDaemon("pre-engine", "F:/repo");

    await expect(daemon.call("pre_context", { symbol: "first" })).resolves.toMatchObject({
      ok: false,
      summary: expect.stringContaining("pre-engine tools/list mismatch"),
    });
    expect(process.killed).toBe(true);
  });

  it("reports bounded stderr and exit status when the binary cannot initialize", async () => {
    const incompatible = new FakePreEngineProcess("exit", "hang");
    vi.mocked(spawn).mockReturnValueOnce(incompatible as never);
    const daemon = __testCreatePreEngineDaemon("pre-engine", "F:/repo");

    const result = await daemon.call("pre_context", { symbol: "first" });

    expect(result).toMatchObject({ ok: false });
    expect(result.summary).toContain("pre-engine process exited during initialize");
    expect(result.summary).toContain("code=127");
    expect(result.summary).toContain("GLIBC_2.39");
  });

  it("contains stdin EPIPE and lets the next call restart the daemon", async () => {
    const broken = new FakePreEngineProcess("reply", "epipe");
    const healthy = new FakePreEngineProcess("reply", "reply");
    vi.mocked(spawn)
      .mockReturnValueOnce(broken as never)
      .mockReturnValueOnce(healthy as never);
    const daemon = __testCreatePreEngineDaemon("pre-engine", "F:/repo");

    const result = await daemon.call("pre_context", { symbol: "first" });

    expect(result).toMatchObject({ ok: false });
    expect(result.summary).toContain("write EPIPE");
    expect(broken.killed).toBe(true);
    await expect(daemon.call("pre_context", { symbol: "second" })).resolves.toMatchObject({ ok: true });
  });

  it("starts idle cleanup only after the active call settles", async () => {
    const process = new FakePreEngineProcess("reply", "hang");
    vi.mocked(spawn).mockReturnValueOnce(process as never);
    const daemon = __testCreatePreEngineDaemon("pre-engine", "F:/repo");

    const pending = daemon.call("pre_verify", {});
    await vi.advanceTimersByTimeAsync(30_000);
    expect(process.killed).toBe(false);

    process.respondToCall();
    await expect(pending).resolves.toMatchObject({ ok: true });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(process.killed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(process.killed).toBe(true);
  });

  it("hard-times out a hung tool call and releases the queue", async () => {
    const hung = new FakePreEngineProcess("reply", "hang");
    const healthy = new FakePreEngineProcess("reply", "reply");
    vi.mocked(spawn)
      .mockReturnValueOnce(hung as never)
      .mockReturnValueOnce(healthy as never);
    const daemon = __testCreatePreEngineDaemon("pre-engine", "F:/repo");

    const first = daemon.call("pre_impact", {});
    const second = daemon.call("pre_impact", {});
    let settled = false;
    void first.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(149_999);
    expect(settled).toBe(false);
    expect(hung.killed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await expect(first).resolves.toMatchObject({ ok: false, errorCode: "TIMEOUT" });
    expect(hung.killed).toBe(true);
    expect(hung.stdout.listenerCount("data")).toBe(0);
    expect(hung.listenerCount("error")).toBe(0);
    expect(hung.listenerCount("exit")).toBe(0);
    await expect(second).resolves.toMatchObject({ ok: true });
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(healthy.killed).toBe(false);
  });

  it("terminates an oversized unterminated frame and lets the queued call recover", async () => {
    const oversized = new FakePreEngineProcess("reply", "hang");
    const healthy = new FakePreEngineProcess("reply", "reply");
    vi.mocked(spawn)
      .mockReturnValueOnce(oversized as never)
      .mockReturnValueOnce(healthy as never);
    const daemon = __testCreatePreEngineDaemon("pre-engine", "F:/repo", 2_048);

    const first = daemon.call("pre_impact", {});
    await vi.advanceTimersByTimeAsync(0);
    oversized.emitRaw("x".repeat(1_024));
    oversized.emitRaw("y".repeat(1_025));

    await expect(first).resolves.toMatchObject({
      ok: false,
      errorCode: "FRAME_TOO_LARGE",
    });
    expect(oversized.killed).toBe(true);
    expect(oversized.stdout.listenerCount("data")).toBe(0);
    await expect(daemon.call("pre_impact", {})).resolves.toMatchObject({ ok: true });
  });

  it("settles 1,000 call and abort transitions across 100 runtime owners", async () => {
    const processes: FakePreEngineProcess[] = [];
    vi.mocked(spawn).mockImplementation(() => {
      const process = new FakePreEngineProcess("reply", "reply");
      processes.push(process);
      return process as never;
    });
    const daemons = Array.from({ length: 100 }, (_, index) =>
      __testGetOrCreatePreEngineDaemon(
        "pre-engine",
        "F:/stress-shared",
        `runtime-stress-${index}`,
      ),
    );

    const results = await Promise.all(
      Array.from({ length: 1_000 }, (_, index) => {
        const controller = new AbortController();
        const pending = daemons[index % daemons.length].call(
          "pre_context",
          { symbol: `symbol-${index}` },
          controller.signal,
        );
        if (index % 4 === 0) controller.abort();
        return pending;
      }),
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(results).toHaveLength(1_000);
    expect(results.every((result) => result.ok || result.errorCode === "ABORTED")).toBe(true);
    expect(processes.length).toBeLessThanOrEqual(100);
    expect(processes.every((process) => process.stdout.listenerCount("data") === 0)).toBe(true);
  });
});
