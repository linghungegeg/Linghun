import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  PROCESS_GUARD_EXIT_CLEANUP_NOTE,
  ProcessGuardRegistry,
  type ProcessGuardTrackedChild,
  createProcessGuard,
} from "./process-guard.js";

function createFakeChild(pid: number): ProcessGuardTrackedChild & {
  emitExit: () => void;
  killMock: ReturnType<typeof vi.fn>;
} {
  const events = new EventEmitter();
  const killMock = vi.fn(() => true);
  return {
    pid,
    exitCode: null,
    signalCode: null,
    kill: killMock,
    once: (event: string | symbol, listener: (...args: unknown[]) => void) => {
      events.once(event, listener);
      return events as never;
    },
    emitExit: () => {
      events.emit("exit", 0, null);
    },
    killMock,
  };
}

describe("ProcessGuard", () => {
  it("uses Windows taskkill /pid <pid> /t and adds /f for force", () => {
    const registry = new ProcessGuardRegistry();
    const spawned: Array<{ command: string; args: string[] }> = [];
    const spawnMock = vi.fn((command: string, args: string[]) => {
      spawned.push({ command, args });
      return new EventEmitter();
    });
    const child = createFakeChild(1234);
    const guard = createProcessGuard(registry, { platform: "win32", spawn: spawnMock as never });

    expect(guard.track(child)).toBe(true);
    expect(guard.requestStop(false)).toMatchObject({ attempted: 1, skipped: 0, force: false });
    expect(guard.requestStop(true)).toMatchObject({ attempted: 1, skipped: 0, force: true });

    expect(spawned).toEqual([
      { command: "taskkill", args: ["/pid", "1234", "/t"] },
      { command: "taskkill", args: ["/pid", "1234", "/t", "/f"] },
    ]);
    expect(child.killMock).not.toHaveBeenCalled();
  });

  it("uses negative pid for Unix detached process-group children", () => {
    const registry = new ProcessGuardRegistry();
    const killMock = vi.fn();
    const child = createFakeChild(4321);
    const guard = createProcessGuard(registry, { platform: "linux", kill: killMock as never });

    guard.track(child, { detached: true });
    const result = guard.requestStop(false);

    expect(result.failures).toEqual([]);
    expect(killMock).toHaveBeenCalledWith(-4321, "SIGTERM");
    expect(child.killMock).not.toHaveBeenCalled();
  });

  it("falls back to child.kill for Unix non-detached children", () => {
    const registry = new ProcessGuardRegistry();
    const killMock = vi.fn();
    const child = createFakeChild(4322);
    const guard = createProcessGuard(registry, { platform: "darwin", kill: killMock as never });

    guard.track(child, { detached: false });
    const result = guard.requestStop(true);

    expect(result.failures).toEqual([]);
    expect(killMock).not.toHaveBeenCalled();
    expect(child.killMock).toHaveBeenCalledWith("SIGKILL");
  });

  it("makes repeated stop idempotent for the same stop strength", () => {
    const registry = new ProcessGuardRegistry();
    const child = createFakeChild(5001);
    const guard = createProcessGuard(registry, { platform: "linux" });

    guard.track(child);
    expect(guard.requestStop(false)).toMatchObject({ attempted: 1, skipped: 0 });
    expect(guard.requestStop(false)).toMatchObject({ attempted: 0, skipped: 1 });

    expect(child.killMock).toHaveBeenCalledTimes(1);
  });

  it("does not throw on guard failure and records the failure", () => {
    const registry = new ProcessGuardRegistry();
    const child = createFakeChild(5002);
    child.killMock.mockImplementationOnce(() => {
      throw new Error("kill denied");
    });
    const guard = createProcessGuard(registry, { platform: "linux" });

    guard.track(child);
    const result = guard.requestStop(false);

    expect(result.attempted).toBe(1);
    expect(result.failures).toEqual([{ pid: 5002, message: "kill denied" }]);
  });

  it("removes exited children from the tracked registry", () => {
    const registry = new ProcessGuardRegistry();
    const child = createFakeChild(5003);
    const guard = createProcessGuard(registry, { platform: "linux" });

    guard.track(child, { detached: true, label: "test-child" });
    expect(guard.snapshot()).toEqual([{ pid: 5003, detached: true, label: "test-child" }]);

    child.emitExit();

    expect(guard.snapshot()).toEqual([]);
  });

  it("documents exit cleanup as synchronous best-effort only", () => {
    const registry = new ProcessGuardRegistry();
    const child = createFakeChild(5004);
    const guard = createProcessGuard(registry, { platform: "win32" });

    guard.track(child);
    const result = guard.cleanupForExit();

    expect(result).toMatchObject({ kind: "exit-cleanup", force: true, attempted: 1 });
    expect(child.killMock).toHaveBeenCalledWith("SIGKILL");
    expect(PROCESS_GUARD_EXIT_CLEANUP_NOTE).toContain("best-effort");
    expect(PROCESS_GUARD_EXIT_CLEANUP_NOTE).toContain("hard-kill/crash");
  });

  it("SIGTERM handler calls cleanup and preserves termination intent", async () => {
    vi.resetModules();
    const previousExitCode = process.exitCode;
    const listeners = new Map<string | symbol, (...args: unknown[]) => void>();
    const onceSpy = vi.spyOn(process, "once").mockImplementation((event, listener) => {
      listeners.set(event, listener as (...args: unknown[]) => void);
      return process;
    });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
      code?: string | number | null,
    ) => {
      throw new Error(`process.exit ${code}`);
    }) as typeof process.exit);

    try {
      const guardModule = await import("./process-guard.js");

      guardModule.installProcessGuardExitHandlers();
      const handler = listeners.get("SIGTERM");

      expect(handler).toBeDefined();
      expect(() => handler?.()).toThrow("process.exit 143");
      expect(exitSpy).toHaveBeenCalledWith(143);
      expect(process.exitCode).toBe(143);
      expect(guardModule.consumeProcessGuardStopResultsForTest()).toContainEqual(
        expect.objectContaining({ kind: "graceful", force: false }),
      );
    } finally {
      process.exitCode = previousExitCode;
      exitSpy.mockRestore();
      onceSpy.mockRestore();
      vi.resetModules();
    }
  });

  it("keeps installProcessGuardExitHandlers idempotent", async () => {
    vi.resetModules();
    const listeners = new Map<string | symbol, (...args: unknown[]) => void>();
    const onceSpy = vi.spyOn(process, "once").mockImplementation((event, listener) => {
      listeners.set(event, listener as (...args: unknown[]) => void);
      return process;
    });

    try {
      const guardModule = await import("./process-guard.js");

      guardModule.installProcessGuardExitHandlers();
      guardModule.installProcessGuardExitHandlers();

      expect(onceSpy).toHaveBeenCalledTimes(3);
      expect(listeners.has("beforeExit")).toBe(true);
      expect(listeners.has("exit")).toBe(true);
      expect(listeners.has("SIGTERM")).toBe(true);
    } finally {
      onceSpy.mockRestore();
      vi.resetModules();
    }
  });

  it("keeps beforeExit and exit cleanup best-effort note accurate", async () => {
    vi.resetModules();
    const listeners = new Map<string | symbol, (...args: unknown[]) => void>();
    const onceSpy = vi.spyOn(process, "once").mockImplementation((event, listener) => {
      listeners.set(event, listener as (...args: unknown[]) => void);
      return process;
    });

    try {
      const guardModule = await import("./process-guard.js");

      guardModule.installProcessGuardExitHandlers();
      listeners.get("beforeExit")?.();
      listeners.get("exit")?.();

      expect(guardModule.consumeProcessGuardStopResultsForTest()).toEqual([
        expect.objectContaining({ kind: "graceful", force: false }),
        expect.objectContaining({ kind: "exit-cleanup", force: true }),
      ]);
      expect(PROCESS_GUARD_EXIT_CLEANUP_NOTE).toContain("synchronous best-effort");
      expect(PROCESS_GUARD_EXIT_CLEANUP_NOTE).toContain("hard-kill/crash");
    } finally {
      onceSpy.mockRestore();
      vi.resetModules();
    }
  });
});
