import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";

export type ProcessGuardStopKind = "graceful" | "force" | "exit-cleanup";

export type ProcessGuardTrackedChild = Pick<ChildProcess, "kill"> & {
  pid?: number;
  exitCode?: number | null;
  signalCode?: NodeJS.Signals | null;
  once: (event: "exit" | "close", listener: (...args: unknown[]) => void) => unknown;
};

export type ProcessGuardTrackOptions = {
  /** True only for children spawned by this process with detached: true. */
  detached?: boolean;
  label?: string;
};

export type ProcessGuardStopFailure = {
  pid: number;
  message: string;
};

export type ProcessGuardStopResult = {
  kind: ProcessGuardStopKind;
  force: boolean;
  attempted: number;
  skipped: number;
  failures: ProcessGuardStopFailure[];
};

type TrackedProcess = {
  child: ProcessGuardTrackedChild;
  pid: number;
  detached: boolean;
  label?: string;
  stopState?: "graceful" | "force";
};

export type ProcessGuardDeps = {
  platform?: NodeJS.Platform;
  spawn?: typeof spawn;
  kill?: typeof process.kill;
};

export class ProcessGuardRegistry {
  private readonly tracked = new Map<number, TrackedProcess>();

  track(child: ProcessGuardTrackedChild, options: ProcessGuardTrackOptions = {}): boolean {
    const pid = child.pid;
    if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
      return false;
    }
    if (child.exitCode !== undefined && child.exitCode !== null) {
      return false;
    }
    if (child.signalCode !== undefined && child.signalCode !== null) {
      return false;
    }
    this.tracked.set(pid, {
      child,
      pid,
      detached: options.detached === true,
      label: options.label,
    });
    const cleanup = () => this.untrack(pid);
    child.once("exit", cleanup);
    child.once("close", cleanup);
    return true;
  }

  untrack(pid: number | undefined): void {
    if (!pid) {
      return;
    }
    this.tracked.delete(pid);
  }

  snapshot(): ReadonlyArray<{ pid: number; detached: boolean; label?: string }> {
    return Array.from(this.tracked.values()).map((entry) => ({
      pid: entry.pid,
      detached: entry.detached,
      label: entry.label,
    }));
  }

  stopAll(
    kind: ProcessGuardStopKind,
    force: boolean,
    deps: Required<ProcessGuardDeps>,
    allowAsyncWindowsTreeKill: boolean,
    onlyPids?: ReadonlySet<number>,
  ): ProcessGuardStopResult {
    const result: ProcessGuardStopResult = {
      kind,
      force,
      attempted: 0,
      skipped: 0,
      failures: [],
    };
    for (const entry of this.tracked.values()) {
      if (onlyPids && !onlyPids.has(entry.pid)) {
        continue;
      }
      stopEntry(entry, force, deps, allowAsyncWindowsTreeKill, result);
    }
    return result;
  }
}

export type ProcessGuard = {
  track: (child: ProcessGuardTrackedChild, options?: ProcessGuardTrackOptions) => boolean;
  requestStop: (force: boolean) => ProcessGuardStopResult;
  cleanupForExit: () => ProcessGuardStopResult;
  snapshot: () => ReturnType<ProcessGuardRegistry["snapshot"]>;
};

export const PROCESS_GUARD_EXIT_CLEANUP_NOTE =
  "process.on('exit') cleanup is synchronous best-effort only; it cannot guarantee async taskkill completion or parent hard-kill/crash cleanup.";

const defaultRegistry = new ProcessGuardRegistry();
const recentStopResults: ProcessGuardStopResult[] = [];
let hooksInstalled = false;

function resolveDeps(deps: ProcessGuardDeps = {}): Required<ProcessGuardDeps> {
  return {
    platform: deps.platform ?? process.platform,
    spawn: deps.spawn ?? spawn,
    kill: deps.kill ?? process.kill.bind(process),
  };
}

export function createProcessGuard(
  registry: ProcessGuardRegistry = defaultRegistry,
  deps: ProcessGuardDeps = {},
): ProcessGuard {
  const resolvedDeps = resolveDeps(deps);
  const localPids = new Set<number>();
  return {
    track: (child, options) => {
      const tracked = registry.track(child, options);
      if (tracked && child.pid) {
        localPids.add(child.pid);
      }
      return tracked;
    },
    requestStop: (force) =>
      recordStopResult(
        registry.stopAll(force ? "force" : "graceful", force, resolvedDeps, true, localPids),
      ),
    cleanupForExit: () =>
      recordStopResult(registry.stopAll("exit-cleanup", true, resolvedDeps, false, localPids)),
    snapshot: () => registry.snapshot().filter((entry) => localPids.has(entry.pid)),
  };
}

export function trackChildProcess(
  child: ProcessGuardTrackedChild,
  options: ProcessGuardTrackOptions = {},
): boolean {
  return defaultRegistry.track(child, options);
}

export function requestTrackedProcessStop(force: boolean): ProcessGuardStopResult {
  return recordStopResult(
    defaultRegistry.stopAll(force ? "force" : "graceful", force, resolveDeps(), true),
  );
}

export function cleanupTrackedProcessesForExit(): ProcessGuardStopResult {
  return recordStopResult(defaultRegistry.stopAll("exit-cleanup", true, resolveDeps(), false));
}

export function consumeProcessGuardStopResultsForTest(): ProcessGuardStopResult[] {
  return recentStopResults.splice(0, recentStopResults.length);
}

export function getTrackedProcessSnapshot(): ReturnType<ProcessGuardRegistry["snapshot"]> {
  return defaultRegistry.snapshot();
}

export function installProcessGuardExitHandlers(): void {
  if (hooksInstalled) {
    return;
  }
  hooksInstalled = true;
  process.once("beforeExit", () => {
    requestTrackedProcessStop(false);
  });
  process.once("exit", () => {
    cleanupTrackedProcessesForExit();
  });
  process.once("SIGTERM", () => {
    requestTrackedProcessStop(false);
    process.exitCode = 143;
    process.exit(143);
  });
}

function recordStopResult(result: ProcessGuardStopResult): ProcessGuardStopResult {
  recentStopResults.push(result);
  if (recentStopResults.length > 20) {
    recentStopResults.shift();
  }
  return result;
}

function stopEntry(
  entry: TrackedProcess,
  force: boolean,
  deps: Required<ProcessGuardDeps>,
  allowAsyncWindowsTreeKill: boolean,
  result: ProcessGuardStopResult,
): void {
  if (entry.stopState === "force" || (entry.stopState === "graceful" && !force)) {
    result.skipped += 1;
    return;
  }
  entry.stopState = force ? "force" : "graceful";
  result.attempted += 1;
  if (deps.platform === "win32" && allowAsyncWindowsTreeKill) {
    stopWindowsTree(entry, force, deps, result);
    return;
  }
  stopWithSignal(entry, force, deps, result);
}

function stopWindowsTree(
  entry: TrackedProcess,
  force: boolean,
  deps: Required<ProcessGuardDeps>,
  result: ProcessGuardStopResult,
): void {
  const args = ["/pid", String(entry.pid), "/t"];
  if (force) {
    args.push("/f");
  }
  try {
    const killer = deps.spawn("taskkill", args, { windowsHide: true });
    killer.once("error", (error) => {
      result.failures.push({ pid: entry.pid, message: formatError(error) });
      stopWithSignal(entry, force, deps, result);
    });
  } catch (error) {
    result.failures.push({ pid: entry.pid, message: formatError(error) });
    stopWithSignal(entry, force, deps, result);
  }
}

function stopWithSignal(
  entry: TrackedProcess,
  force: boolean,
  deps: Required<ProcessGuardDeps>,
  result: ProcessGuardStopResult,
): void {
  const signal = force ? "SIGKILL" : "SIGTERM";
  try {
    if (deps.platform !== "win32" && entry.detached) {
      deps.kill(-entry.pid, signal);
      return;
    }
    entry.child.kill(signal);
  } catch (error) {
    result.failures.push({ pid: entry.pid, message: formatError(error) });
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
