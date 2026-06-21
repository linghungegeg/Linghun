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
  cwd?: string;
  retainAfterExit?: boolean;
  workspaceSweep?: boolean;
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
  cwd?: string;
  retainAfterExit: boolean;
  childExited: boolean;
  workspaceSweep: boolean;
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
      cwd: options.cwd,
      retainAfterExit: options.retainAfterExit === true,
      childExited: false,
      workspaceSweep: options.workspaceSweep === true,
    });
    const cleanup = () => {
      const entry = this.tracked.get(pid);
      if (!entry) return;
      entry.childExited = true;
      if (!entry.retainAfterExit) {
        this.untrack(pid);
      }
    };
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

  activeSnapshot(): ReturnType<ProcessGuardRegistry["snapshot"]> {
    return Array.from(this.tracked.values())
      .filter((entry) => !entry.retainAfterExit)
      .map((entry) => ({
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
    const removePids: number[] = [];
    for (const entry of this.tracked.values()) {
      if (onlyPids && !onlyPids.has(entry.pid)) {
        continue;
      }
      if (kind === "exit-cleanup" && entry.retainAfterExit) {
        result.skipped += 1;
        continue;
      }
      if (stopEntry(entry, force, deps, allowAsyncWindowsTreeKill, result)) {
        removePids.push(entry.pid);
      }
    }
    for (const pid of removePids) {
      this.untrack(pid);
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

export function cleanupTrackedProcessesBeforeExit(): ProcessGuardStopResult {
  return recordStopResult(defaultRegistry.stopAll("exit-cleanup", false, resolveDeps(), false));
}

export function consumeProcessGuardStopResultsForTest(): ProcessGuardStopResult[] {
  return recentStopResults.splice(0, recentStopResults.length);
}

export function getTrackedProcessSnapshot(): ReturnType<ProcessGuardRegistry["snapshot"]> {
  return defaultRegistry.snapshot();
}

export function getActiveTrackedProcessSnapshot(): ReturnType<ProcessGuardRegistry["snapshot"]> {
  return defaultRegistry.activeSnapshot();
}

export function installProcessGuardExitHandlers(): void {
  if (hooksInstalled) {
    return;
  }
  hooksInstalled = true;
  process.once("beforeExit", () => {
    cleanupTrackedProcessesBeforeExit();
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
): boolean {
  if (entry.stopState === "force" || (entry.stopState === "graceful" && !force)) {
    result.skipped += 1;
    return false;
  }
  entry.stopState = force ? "force" : "graceful";
  result.attempted += 1;
  if (deps.platform === "win32" && allowAsyncWindowsTreeKill) {
    stopWindowsTree(entry, force, deps, result);
    return force;
  }
  return stopWithSignal(entry, force, deps, result);
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
  if (force && entry.cwd && shouldRunWindowsWorkspaceSweep(entry)) {
    stopWindowsWorkspaceProcesses(entry.pid, entry.cwd, deps);
  }
}

function stopWithSignal(
  entry: TrackedProcess,
  force: boolean,
  deps: Required<ProcessGuardDeps>,
  result: ProcessGuardStopResult,
): boolean {
  const signal = force ? "SIGKILL" : "SIGTERM";
  try {
    if (deps.platform !== "win32" && entry.detached) {
      deps.kill(-entry.pid, signal);
      return force;
    }
    entry.child.kill(signal);
    return force;
  } catch (error) {
    if (isProcessGone(error)) {
      return true;
    }
    result.failures.push({ pid: entry.pid, message: formatError(error) });
    return false;
  }
}

function stopWindowsWorkspaceProcesses(
  rootPid: number,
  cwd: string,
  deps: Required<ProcessGuardDeps>,
): void {
  const script = `
$rootPid = ${rootPid}
$cwd = ${JSON.stringify(cwd)}
$cwdLower = $cwd.ToLowerInvariant()
$rows = @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine)
$byPid = @{}
$children = @{}
foreach ($row in $rows) {
  $pidInt = [int]$row.ProcessId
  $parentInt = [int]$row.ParentProcessId
  $byPid[$pidInt] = $row
  if (-not $children.ContainsKey($parentInt)) { $children[$parentInt] = @() }
  $children[$parentInt] += $pidInt
}
$protected = New-Object 'System.Collections.Generic.HashSet[int]'
$cursor = $PID
while ($cursor -gt 0 -and $byPid.ContainsKey($cursor)) {
  [void]$protected.Add($cursor)
  $cursor = [int]$byPid[$cursor].ParentProcessId
}
$targets = New-Object 'System.Collections.Generic.HashSet[int]'
$queue = New-Object 'System.Collections.Generic.Queue[int]'
$queue.Enqueue($rootPid)
while ($queue.Count -gt 0) {
  $pid = $queue.Dequeue()
  if (-not $targets.Add($pid)) { continue }
  if ($children.ContainsKey($pid)) {
    foreach ($childPid in $children[$pid]) { $queue.Enqueue($childPid) }
  }
}
foreach ($row in $rows) {
  $cmd = [string]$row.CommandLine
  if ($cmd.ToLowerInvariant().Contains($cwdLower)) {
    [void]$targets.Add([int]$row.ProcessId)
  }
}
foreach ($targetPid in $targets) {
  if ($targetPid -gt 0 -and -not $protected.Contains($targetPid)) {
    Stop-Process -Id $targetPid -Force -ErrorAction SilentlyContinue
  }
}
`;
  try {
    deps.spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true,
      stdio: "ignore",
    });
  } catch {
    // taskkill remains the primary cleanup path; workspace sweep is best-effort.
  }
}

function isProcessGone(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ESRCH"
  );
}

function shouldRunWindowsWorkspaceSweep(entry: TrackedProcess): boolean {
  return entry.workspaceSweep || process.env.LINGHUN_PROCESS_GUARD_WORKSPACE_SWEEP === "1";
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
