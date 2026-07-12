import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cleanupMocks = vi.hoisted(() => ({
  active: true,
  spawn: vi.fn(),
  track: vi.fn(),
  requestStop: vi.fn(),
  activeSnapshot: vi.fn(),
}));

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: cleanupMocks.spawn,
}));

vi.mock("./process-guard.js", () => ({
  createProcessGuard: () => ({
    track: cleanupMocks.track,
    requestStop: cleanupMocks.requestStop,
    activeSnapshot: cleanupMocks.activeSnapshot,
  }),
}));

import { createMcpStdioRunner } from "./mcp-stdio-runtime.js";

class FakeReadable extends EventEmitter {
  setEncoding(): this {
    return this;
  }
}

class StubbornMcpChild extends EventEmitter {
  readonly pid = 4242;
  readonly exitCode = null;
  readonly signalCode = null;
  readonly stdin = { write: vi.fn(() => true) };
  readonly stdout = new FakeReadable();
  readonly stderr = new EventEmitter();
  readonly kill = vi.fn(() => true);
}

describe("MCP stdio bounded process cleanup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    cleanupMocks.active = true;
    cleanupMocks.spawn.mockReset();
    cleanupMocks.track.mockReset();
    cleanupMocks.requestStop.mockReset();
    cleanupMocks.activeSnapshot.mockReset();
    cleanupMocks.spawn.mockReturnValue(new StubbornMcpChild());
    cleanupMocks.activeSnapshot.mockImplementation(() =>
      cleanupMocks.active ? [{ pid: 4242, detached: false, label: "stubborn-mcp" }] : []
    );
    cleanupMocks.requestStop.mockImplementation((force: boolean) => {
      if (force) cleanupMocks.active = false;
      return {
        kind: force ? "force" : "graceful",
        force,
        attempted: 1,
        skipped: 0,
        failures: [],
      };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("escalates a still-active child once after the graceful window", async () => {
    await expect(
      createMcpStdioRunner({
        server: { command: "stubborn-mcp", args: [] },
        cwd: "F:/repo",
        timeoutMs: 5_000,
        label: "stubborn-mcp",
        timeoutSummary: "timeout",
        captureStderr: false,
        run: async () => "ok",
      }),
    ).resolves.toEqual({ ok: true, value: "ok" });

    expect(cleanupMocks.requestStop).toHaveBeenCalledTimes(1);
    expect(cleanupMocks.requestStop).toHaveBeenLastCalledWith(false);
    await vi.advanceTimersByTimeAsync(499);
    expect(cleanupMocks.requestStop).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(cleanupMocks.requestStop).toHaveBeenCalledTimes(2);
    expect(cleanupMocks.requestStop).toHaveBeenLastCalledWith(true);
    await vi.advanceTimersByTimeAsync(500);
    expect(cleanupMocks.requestStop).toHaveBeenCalledTimes(2);
  });

  it("emits still-running progress at 30 seconds and stops after settle", async () => {
    let finishRun!: (value: string) => void;
    const runResult = new Promise<string>((resolve) => {
      finishRun = resolve;
    });
    const onProgress = vi.fn();
    const pending = createMcpStdioRunner({
      server: { command: "stubborn-mcp", args: [] },
      cwd: "F:/repo",
      timeoutMs: 100_000_000,
      label: "mcp-liveness",
      timeoutSummary: "timeout",
      captureStderr: false,
      onProgress,
      run: async () => await runResult,
    });

    await vi.advanceTimersByTimeAsync(29_999);
    expect(onProgress).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenLastCalledWith({ phase: "waiting", transport: "stdio" });

    finishRun("ok");
    await expect(pending).resolves.toEqual({ ok: true, value: "ok" });
    const settledProgressCount = onProgress.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onProgress).toHaveBeenCalledTimes(settledProgressCount);
  });

  it("restarts the still-running cadence after a real protocol progress frame", async () => {
    const onProgress = vi.fn();
    const pending = createMcpStdioRunner({
      server: { command: "stubborn-mcp", args: [] },
      cwd: "F:/repo",
      timeoutMs: 100_000_000,
      label: "mcp-progress-reset",
      timeoutSummary: "timeout",
      captureStderr: false,
      onProgress,
      run: async (sendRequest) => await sendRequest("initialize", {}),
    });
    await vi.advanceTimersByTimeAsync(0);
    const child = cleanupMocks.spawn.mock.results[0]?.value as StubbornMcpChild;
    expect(onProgress).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(29_999);
    child.stdout.emit(
      "data",
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: {} })}\n`,
    );
    await vi.advanceTimersByTimeAsync(0);
    const afterRealProgress = onProgress.mock.calls.length;
    expect(onProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: "receiving", transport: "stdio" }),
    );

    await vi.advanceTimersByTimeAsync(29_999);
    expect(onProgress).toHaveBeenCalledTimes(afterRealProgress);
    await vi.advanceTimersByTimeAsync(1);
    expect(onProgress).toHaveBeenCalledTimes(afterRealProgress + 1);
    expect(onProgress).toHaveBeenLastCalledWith({ phase: "waiting", transport: "stdio" });

    child.stdout.emit("data", `${JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} })}\n`);
    await expect(pending).resolves.toEqual({ ok: true, value: {} });
    const settledProgressCount = onProgress.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onProgress).toHaveBeenCalledTimes(settledProgressCount);
  });
});
