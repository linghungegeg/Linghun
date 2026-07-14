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

  it("does not run Windows workspace sweep by default", () => {
    const registry = new ProcessGuardRegistry();
    const spawnMock = vi.fn(() => new EventEmitter());
    const child = createFakeChild(2234);
    const guard = createProcessGuard(registry, { platform: "win32", spawn: spawnMock as never });

    guard.track(child, { cwd: "F:\\Linghun" });
    expect(guard.requestStop(true)).toMatchObject({ attempted: 1, failures: [] });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock).toHaveBeenCalledWith("taskkill", ["/pid", "2234", "/t", "/f"], expect.any(Object));
  });

  it("runs Windows workspace sweep only when explicitly enabled", () => {
    const registry = new ProcessGuardRegistry();
    const spawned: Array<{ command: string; args: string[] }> = [];
    const spawnMock = vi.fn((command: string, args: string[]) => {
      spawned.push({ command, args });
      return new EventEmitter();
    });
    const child = createFakeChild(2235);
    const guard = createProcessGuard(registry, { platform: "win32", spawn: spawnMock as never });

    guard.track(child, { cwd: "F:\\Linghun", workspaceSweep: true });
    expect(guard.requestStop(true)).toMatchObject({ attempted: 1, failures: [] });

    expect(spawned.map((item) => item.command)).toEqual(["taskkill", "powershell.exe"]);
    expect(spawned[1]?.args).toContain("-NonInteractive");
  });

  it("runs Windows workspace sweep when the env flag is enabled", () => {
    const previous = process.env.LINGHUN_PROCESS_GUARD_WORKSPACE_SWEEP;
    process.env.LINGHUN_PROCESS_GUARD_WORKSPACE_SWEEP = "1";
    try {
      const registry = new ProcessGuardRegistry();
      const spawned: Array<{ command: string; args: string[] }> = [];
      const spawnMock = vi.fn((command: string, args: string[]) => {
        spawned.push({ command, args });
        return new EventEmitter();
      });
      const child = createFakeChild(2236);
      const guard = createProcessGuard(registry, { platform: "win32", spawn: spawnMock as never });

      guard.track(child, { cwd: "F:\\Linghun" });
      expect(guard.requestStop(true)).toMatchObject({ attempted: 1, failures: [] });

      expect(spawned.map((item) => item.command)).toEqual(["taskkill", "powershell.exe"]);
    } finally {
      if (previous === undefined) {
        delete process.env.LINGHUN_PROCESS_GUARD_WORKSPACE_SWEEP;
      } else {
        process.env.LINGHUN_PROCESS_GUARD_WORKSPACE_SWEEP = previous;
      }
    }
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

  it("waits until a forced process-group stop is confirmed", async () => {
    const registry = new ProcessGuardRegistry();
    const gone = Object.assign(new Error("gone"), { code: "ESRCH" });
    let alive = true;
    const killMock = vi.fn((pid: number, signal: NodeJS.Signals | number) => {
      if (signal === 0) {
        if (alive) return true;
        throw gone;
      }
      if (pid === -5020 && signal === "SIGKILL") alive = false;
      return true;
    });
    const guard = createProcessGuard(registry, { platform: "linux", kill: killMock as never });
    guard.track(createFakeChild(5020), { detached: true });

    await expect(guard.requestStopAndConfirm(true, 100)).resolves.toMatchObject({
      ok: true,
      stopResult: { attempted: 1, force: true, failures: [] },
    });
  });

  it("retains an unconfirmed process for a repeated confirmed stop", async () => {
    const registry = new ProcessGuardRegistry();
    const gone = Object.assign(new Error("gone"), { code: "ESRCH" });
    let forceAttempts = 0;
    let alive = true;
    const killMock = vi.fn((pid: number, signal: NodeJS.Signals | number) => {
      if (signal === 0) {
        if (alive) return true;
        throw gone;
      }
      if (pid === -5021 && signal === "SIGKILL") {
        forceAttempts += 1;
        if (forceAttempts === 2) alive = false;
      }
      return true;
    });
    const guard = createProcessGuard(registry, { platform: "linux", kill: killMock as never });
    guard.track(createFakeChild(5021), { detached: true });

    await expect(guard.requestStopAndConfirm(true, 0)).resolves.toMatchObject({
      ok: false,
      alivePids: [5021],
      reason: expect.stringContaining("pids=5021"),
    });
    expect(guard.snapshot()).toEqual([{ pid: 5021, detached: true, label: undefined }]);

    await expect(guard.requestStopAndConfirm(true, 100)).resolves.toMatchObject({
      ok: true,
      stopResult: { attempted: 1, force: true, failures: [] },
    });
    expect(guard.snapshot()).toEqual([]);
  });

  it("waits for the Windows descendant stopper before confirming stop", async () => {
    const registry = new ProcessGuardRegistry();
    const gone = Object.assign(new Error("gone"), { code: "ESRCH" });
    let alive = true;
    const killMock = vi.fn((_pid: number, signal: NodeJS.Signals | number) => {
      if (signal === 0 && alive) return true;
      if (signal === 0) throw gone;
      return true;
    });
    const spawnMock = vi.fn(() => {
      const killer = new EventEmitter();
      setTimeout(() => {
        alive = false;
        killer.emit("close", 0);
      }, 20);
      return killer;
    });
    const guard = createProcessGuard(registry, {
      platform: "win32",
      kill: killMock as never,
      spawn: spawnMock as never,
    });
    guard.track(createFakeChild(5022));

    await expect(guard.requestStopAndConfirm(true, 100)).resolves.toMatchObject({
      ok: true,
      stopResult: { attempted: 1, force: true, failures: [] },
    });
    expect(spawnMock).toHaveBeenCalledWith(
      "powershell.exe",
      expect.arrayContaining(["-NoProfile", "-NonInteractive", "-Command"]),
      expect.any(Object),
    );
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

  it("retains exited detached process groups until forced cleanup", () => {
    const registry = new ProcessGuardRegistry();
    const killMock = vi.fn();
    const child = createFakeChild(5005);
    const guard = createProcessGuard(registry, { platform: "linux", kill: killMock as never });

    guard.track(child, { detached: true, label: "bash-group", retainAfterExit: true });
    child.emitExit();

    expect(guard.snapshot()).toEqual([{ pid: 5005, detached: true, label: "bash-group" }]);
    const result = guard.requestStop(true);

    expect(result).toMatchObject({ attempted: 1, force: true, failures: [] });
    expect(killMock).toHaveBeenCalledWith(-5005, "SIGKILL");
    expect(guard.snapshot()).toEqual([]);
  });

  it("treats already-gone retained process groups as cleaned", () => {
    const registry = new ProcessGuardRegistry();
    const gone = Object.assign(new Error("gone"), { code: "ESRCH" });
    const killMock = vi.fn(() => {
      throw gone;
    });
    const child = createFakeChild(5006);
    const guard = createProcessGuard(registry, { platform: "linux", kill: killMock as never });

    guard.track(child, { detached: true, retainAfterExit: true });
    child.emitExit();
    const result = guard.requestStop(true);

    expect(result.failures).toEqual([]);
    expect(guard.snapshot()).toEqual([]);
  });

  it("skips retained process groups during exit cleanup", () => {
    const registry = new ProcessGuardRegistry();
    const killMock = vi.fn();
    const child = createFakeChild(5007);
    const guard = createProcessGuard(registry, { platform: "linux", kill: killMock as never });

    guard.track(child, { detached: true, retainAfterExit: true });
    child.emitExit();
    const result = guard.cleanupForExit();

    expect(result).toMatchObject({ kind: "exit-cleanup", attempted: 0, skipped: 1 });
    expect(killMock).not.toHaveBeenCalled();
    expect(guard.snapshot()).toEqual([{ pid: 5007, detached: true }]);
  });

  it("excludes retained process groups from active snapshots", () => {
    const registry = new ProcessGuardRegistry();
    const retained = createFakeChild(5008);
    const active = createFakeChild(5009);
    const guard = createProcessGuard(registry, { platform: "linux" });

    guard.track(retained, { detached: true, retainAfterExit: true, label: "retained-service" });
    guard.track(active, { detached: true, label: "active-child" });
    retained.emitExit();

    expect(registry.activeSnapshot()).toEqual([{ pid: 5009, detached: true, label: "active-child" }]);
    expect(guard.snapshot()).toEqual(
      expect.arrayContaining([
        { pid: 5008, detached: true, label: "retained-service" },
        { pid: 5009, detached: true, label: "active-child" },
      ]),
    );
  });

  it("keeps cleanup scoped to the runtime that owns each child", () => {
    const registry = new ProcessGuardRegistry();
    const guardA = createProcessGuard(registry, { platform: "linux" });
    const guardB = createProcessGuard(registry, { platform: "linux" });
    const childA = createFakeChild(5010);
    const childB = createFakeChild(5011);
    guardA.track(childA, { label: "runtime-a" });
    guardB.track(childB, { label: "runtime-b" });

    expect(guardB.cleanupForExit()).toMatchObject({ attempted: 1, failures: [] });

    expect(childA.killMock).not.toHaveBeenCalled();
    expect(childB.killMock).toHaveBeenCalledWith("SIGKILL");
    expect(guardA.activeSnapshot()).toEqual([{ pid: 5010, detached: false, label: "runtime-a" }]);
    expect(guardB.activeSnapshot()).toEqual([]);
  });

  it("does not stop a newer runtime child when the operating system reuses a pid", () => {
    const registry = new ProcessGuardRegistry();
    const guardA = createProcessGuard(registry, { platform: "linux" });
    const guardB = createProcessGuard(registry, { platform: "linux" });
    const oldChild = createFakeChild(5012);
    const newChild = createFakeChild(5012);
    guardA.track(oldChild, { label: "runtime-a-old" });
    guardB.track(newChild, { label: "runtime-b-new" });

    oldChild.emitExit();
    expect(guardA.cleanupForExit()).toMatchObject({ attempted: 0, failures: [] });

    expect(newChild.killMock).not.toHaveBeenCalled();
    expect(guardB.activeSnapshot()).toEqual([
      { pid: 5012, detached: false, label: "runtime-b-new" },
    ]);
    expect(guardB.cleanupForExit()).toMatchObject({ attempted: 1, failures: [] });
    expect(newChild.killMock).toHaveBeenCalledWith("SIGKILL");
  });

  it("keeps 100 runtime cleanups isolated on one shared registry", () => {
    const registry = new ProcessGuardRegistry();
    const runtimes = Array.from({ length: 100 }, (_, index) => {
      const guard = createProcessGuard(registry, { platform: "linux" });
      const child = createFakeChild(5100 + index);
      guard.track(child, { label: `runtime-${index}` });
      return { guard, child };
    });

    for (const [index, runtime] of runtimes.entries()) {
      expect(runtime.guard.cleanupForExit()).toMatchObject({ attempted: 1, failures: [] });
      expect(runtime.child.killMock).toHaveBeenCalledTimes(1);
      expect(
        runtimes.slice(index + 1).every((candidate) => candidate.child.killMock.mock.calls.length === 0),
      ).toBe(true);
    }
    expect(registry.activeSnapshot()).toEqual([]);
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
        expect.objectContaining({ kind: "exit-cleanup", force: false }),
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
