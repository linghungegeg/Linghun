import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __testCreatePreEngineDaemon,
  __testGetOrCreatePreEngineDaemon,
} from "./mcp-index-runtime.js";

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: vi.fn(),
}));

class FakePreEngineProcess extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = { resume: vi.fn() };
  readonly stdin = { write: vi.fn(this.write.bind(this)) };
  killed = false;
  callId?: number;

  constructor(
    private readonly initialize: "reply" | "error" | "hang" = "reply",
    private readonly call: "reply" | "hang" = "reply",
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
    callback?.();
    if (message.method === "initialize" && this.initialize === "reply") {
      queueMicrotask(() => this.stdout.emit("data", `${JSON.stringify({ id: 0, result: {} })}\n`));
    }
    if (message.method === "initialize" && this.initialize === "error") {
      queueMicrotask(() =>
        this.stdout.emit(
          "data",
          `${JSON.stringify({ id: 0, error: { message: "initialize rejected" } })}\n`,
        ),
      );
    }
    if (message.method === "tools/call") {
      this.callId = message.id;
      if (this.call === "reply") queueMicrotask(() => this.respondToCall());
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
    await vi.advanceTimersByTimeAsync(100_000_000);

    await expect(first).resolves.toMatchObject({ ok: false, errorCode: "TIMEOUT" });
    expect(hung.killed).toBe(true);
    expect(hung.stdout.listenerCount("data")).toBe(0);
    await expect(daemon.call("pre_impact", {})).resolves.toMatchObject({ ok: true });
  });

  it("terminates an oversized unterminated frame and lets the queued call recover", async () => {
    const oversized = new FakePreEngineProcess("reply", "hang");
    const healthy = new FakePreEngineProcess("reply", "reply");
    vi.mocked(spawn)
      .mockReturnValueOnce(oversized as never)
      .mockReturnValueOnce(healthy as never);
    const daemon = __testCreatePreEngineDaemon("pre-engine", "F:/repo", 256);

    const first = daemon.call("pre_impact", {});
    await vi.advanceTimersByTimeAsync(0);
    oversized.emitRaw("x".repeat(128));
    oversized.emitRaw("y".repeat(129));

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
