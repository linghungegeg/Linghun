/**
 * Native runner resolution and lifecycle helpers.
 * Extracted from index.ts (Slice D.10C) — behavior-preserving move only.
 */
import { spawn } from "node:child_process";
import { constants, accessSync, existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { LinghunConfig, NativeRunnerConfig, NativeRunnerSource } from "@linghun/config";
import type {
  ApprovedRunnerJobSpec,
  DurableJobState,
  NativeRunnerLifecycleStatus,
  NativeRunnerResolutionStatus,
} from "./index.js";
import { formatJobRunnerInline } from "./job-runner-presenter.js";
import { redactedPath } from "./process-command-runtime.js";
import { sanitizeDiagnosticText } from "./startup-runtime.js";
import { isRecord } from "./tui-state-runtime.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NATIVE_RUNNER_VERSION_TIMEOUT_MS = 2_000;
const NATIVE_RUNNER_VERSION_CACHE_TTL_MS = 5_000;
const NATIVE_RUNNER_STATUS_REFRESH_TTL_MS = 750;
const NATIVE_RUNNER_START_STATE_WAIT_MS = 1_500;
const NATIVE_RUNNER_APPROVED_TASK_HEARTBEAT_MS = 100;
const CLI_BUNDLED_ROOT_ENV = "LINGHUN_CLI_BUNDLED_ROOT";
const NATIVE_RUNNER_BUNDLED_PLATFORM_ARCHES = new Set([
  "win32-x64",
  "linux-x64",
  "darwin-arm64",
  "darwin-x64",
]);
export const NATIVE_RUNNER_PROCESS_GUARD_CONTRACT = [
  "Windows native runner SHOULD use a Job Object with kill-on-job-close for supervised children.",
  "Unix native runner SHOULD create and manage a child process group, then kill that group on stop/exit.",
  "Parent death cleanup is only proven by a real native runner smoke; Node tests do not prove orphan cleanup.",
] as const;

/** Tracks native runner process PIDs for orphan cleanup when the runner binary is unavailable. */
const _runnerPids = new Map<string, number>();

const NATIVE_RUNNER_APPROVED_TASK_SCRIPT = [
  "const durationMs = Number(process.argv[1] || '1000');",
  "const heartbeatMs = 100;",
  "const startedAt = Date.now();",
  "let tick = 0;",
  "console.log(JSON.stringify({ kind: 'linghun-approved-runner-task', status: 'started', tick, elapsedMs: 0 }));",
  "const timer = setInterval(() => {",
  "  tick += 1;",
  "  const elapsedMs = Date.now() - startedAt;",
  "  console.log(JSON.stringify({ kind: 'linghun-approved-runner-task', status: elapsedMs >= durationMs ? 'completed' : 'heartbeat', tick, elapsedMs }));",
  "  if (elapsedMs >= durationMs) {",
  "    clearInterval(timer);",
  "    process.exitCode = 0;",
  "  }",
  "}, heartbeatMs);",
].join("\n");

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

type NativeRunnerProbeCacheStatus = "fresh" | "cached" | "stale";

type NativeRunnerResolution = {
  status: NativeRunnerResolutionStatus;
  enabled: boolean;
  source: NativeRunnerSource;
  processGuardContract: readonly string[];
  path?: string;
  pathRef: string;
  bundledCandidateRef: string;
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  platformArch: string;
  nodeFallback: "available";
  version?: string;
  protocol?: string;
  lastError?: string;
  probeCacheStatus?: NativeRunnerProbeCacheStatus;
  nextAction: string;
};

type NativeRunnerCandidate = {
  path: string | undefined;
  ref: string;
  platformArch: string;
  supported: boolean;
};

type NativeRunnerCommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  raw: string;
  error?: Error;
  timedOut: boolean;
};

type NativeRunnerVersionCacheEntry = {
  expiresAt: number;
  resolution: NativeRunnerResolution;
};

type NativeRunnerAdapterResult = {
  status: NativeRunnerLifecycleStatus;
  adapter: "native" | "node";
  protocol?: string;
  version?: string;
  heartbeatAt?: string;
  logRefs?: {
    state: string;
    stdout: string;
    stderr: string;
  };
  lastError?: string;
  fallbackReason?: string;
};

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

/** Minimal context subset needed by runner helpers. */
export type RunnerContext = {
  config: LinghunConfig;
  projectPath: string;
};

/** Dependency callbacks to avoid circular imports with job-runtime logic. */
export type RunnerRuntimeDeps = {
  appendJobLog: (job: DurableJobState, message: string) => Promise<void>;
  rescheduleDurableJobAgents: (job: DurableJobState) => void;
};

// ---------------------------------------------------------------------------
// Private utility duplicates (avoid circular import from index.ts)
// ---------------------------------------------------------------------------

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

// ---------------------------------------------------------------------------
// Runner resolution
// ---------------------------------------------------------------------------

export function resolveNativeRunner(config: LinghunConfig): NativeRunnerResolution {
  const runner = config.nativeRunner;
  const bundledCandidate = getBundledNativeRunnerCandidate();
  const base = {
    processGuardContract: NATIVE_RUNNER_PROCESS_GUARD_CONTRACT,
    bundledCandidateRef: bundledCandidate.ref,
    platform: process.platform,
    arch: process.arch,
    platformArch: bundledCandidate.platformArch,
    nodeFallback: "available" as const,
  };
  if (!runner.enabled) {
    return {
      status: "disabled",
      enabled: false,
      source: "disabled",
      pathRef: "disabled",
      ...base,
      nextAction: "Native runner is disabled; Node/TUI remains the fallback for durable jobs.",
    };
  }
  const resolvedPath = resolveNativeRunnerPath(runner, bundledCandidate);
  if (!resolvedPath) {
    return {
      status: "unavailable",
      enabled: true,
      source: runner.source,
      pathRef: "missing",
      ...base,
      lastError:
        runner.source === "bundled" && !bundledCandidate.supported
          ? `bundled runner platform is not supported: ${bundledCandidate.platformArch}`
          : "runner path is not configured",
      nextAction:
        runner.source === "bundled"
          ? "Install a Linghun package with a bundled runner for this platform, or keep using Node fallback."
          : "Configure a project-local/custom runner path for development, or keep using Node fallback.",
    };
  }
  if (!existsSync(resolvedPath) || !isExecutableNativeRunnerCandidate(resolvedPath)) {
    return {
      status: "unavailable",
      enabled: true,
      source: runner.source,
      path: resolvedPath,
      pathRef: redactedPath(resolvedPath),
      ...base,
      lastError: "runner binary is missing or not executable",
      nextAction:
        runner.source === "bundled"
          ? "Bundled runner is unavailable; reinstall/repair Linghun or continue with Node fallback."
          : "Repair runner execution permissions or keep using Node fallback.",
    };
  }
  return {
    status: "unavailable",
    enabled: true,
    source: runner.source,
    path: resolvedPath,
    pathRef: redactedPath(resolvedPath),
    ...base,
    lastError: "runner version probe not started",
    nextAction: "Run the async runner probe before starting native supervision; Node fallback remains available.",
  };
}

const nativeRunnerVersionCache = new Map<string, NativeRunnerVersionCacheEntry>();

export async function resolveNativeRunnerAsync(config: LinghunConfig): Promise<NativeRunnerResolution> {
  const staticResolution = resolveNativeRunner(config);
  if (!staticResolution.path || staticResolution.status !== "unavailable") {
    return staticResolution;
  }
  if (staticResolution.lastError !== "runner version probe not started") {
    return staticResolution;
  }
  const runner = config.nativeRunner;
  const cacheKey = `${staticResolution.path}\0${runner.expectedProtocol}`;
  const cached = nativeRunnerVersionCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return { ...cached.resolution, probeCacheStatus: "cached" };
  }

  const probed = await probeNativeRunnerVersion(staticResolution, runner.expectedProtocol);
  if (probed.status === "available") {
    nativeRunnerVersionCache.set(cacheKey, {
      expiresAt: now + NATIVE_RUNNER_VERSION_CACHE_TTL_MS,
      resolution: { ...probed, probeCacheStatus: undefined },
    });
    return probed;
  }
  if (cached) {
    return {
      ...cached.resolution,
      probeCacheStatus: "stale",
      lastError: probed.lastError ?? cached.resolution.lastError,
      nextAction:
        "Runner probe failed; using stale cached runner metadata for this short window, with Node fallback still available.",
    };
  }
  return probed;
}

async function probeNativeRunnerVersion(
  base: NativeRunnerResolution,
  expectedProtocol: string,
): Promise<NativeRunnerResolution> {
  if (!base.path) return base;
  const versionCommand = createNativeRunnerCommand(base.path, ["version"]);
  const version = await runNativeRunnerCommand(versionCommand, {
    cwd: dirname(base.path),
    timeoutMs: NATIVE_RUNNER_VERSION_TIMEOUT_MS,
  });
  if (version.error || version.status !== 0) {
    return {
      ...base,
      status: "unavailable",
      lastError: sanitizeDiagnosticText(
        version.error instanceof Error ? version.error.message : version.raw || "version probe failed",
      ),
      probeCacheStatus: "fresh",
      nextAction: "Repair runner execution permissions or keep using Node fallback.",
    };
  }
  const parsed = parseRunnerJson(version.raw);
  const protocol = stringValue(parsed.protocol, "unknown");
  const runnerVersion = stringValue(parsed.version, "unknown");
  if (protocol !== expectedProtocol) {
    return {
      ...base,
      status: "protocol_mismatch",
      version: runnerVersion,
      protocol,
      lastError: `protocol mismatch: expected ${expectedProtocol}, got ${protocol}`,
      probeCacheStatus: "fresh",
      nextAction:
        "Use a compatible bundled/project-local runner build, or continue with Node fallback.",
    };
  }
  return {
    ...base,
    status: "available",
    version: runnerVersion,
    protocol,
    lastError: undefined,
    probeCacheStatus: "fresh",
    nextAction:
      "Native runner may supervise approved durable job specs; Node fallback remains available.",
  };
}

function resolveNativeRunnerPath(
  runner: NativeRunnerConfig,
  bundledCandidate: NativeRunnerCandidate,
): string | undefined {
  if (runner.source === "bundled") {
    return bundledCandidate.path;
  }
  if (runner.path) {
    return resolve(runner.path);
  }
  return undefined;
}

function getBundledNativeRunnerCandidate(): NativeRunnerCandidate {
  const platformArch = getNativeRunnerPlatformArch();
  const supported = NATIVE_RUNNER_BUNDLED_PLATFORM_ARCHES.has(platformArch);
  const targetPlatform = platformArch.split("-")[0];
  const names =
    targetPlatform === "win32"
      ? ["linghun-native-runner.exe", "linghun-native-runner.cjs"]
      : ["linghun-native-runner", "linghun-native-runner.cjs"];
  const rootCandidates = getBundledNativeRunnerRoots();
  for (const root of rootCandidates) {
    for (const name of names) {
      const candidate = join(root, platformArch, name);
      if (existsSync(candidate)) {
        return {
          path: candidate,
          ref: `bundled:${platformArch}/${name}`,
          platformArch,
          supported,
        };
      }
    }
  }
  return {
    path:
      supported && rootCandidates[0]
        ? join(rootCandidates[0], platformArch, names[0] ?? "linghun-native-runner")
        : undefined,
    ref: `bundled:${platformArch}/${names[0] ?? "linghun-native-runner"}`,
    platformArch,
    supported,
  };
}

function getNativeRunnerPlatformArch(): string {
  const override = process.env.LINGHUN_NATIVE_RUNNER_PLATFORM_ARCH_TEST;
  if (override && NATIVE_RUNNER_BUNDLED_PLATFORM_ARCHES.has(override)) {
    return override;
  }
  return `${process.platform}-${process.arch}`;
}

function getBundledNativeRunnerRoots(): string[] {
  const roots: string[] = [];
  if (process.env.LINGHUN_NATIVE_RUNNER_BUNDLED_DIR) {
    roots.push(process.env.LINGHUN_NATIVE_RUNNER_BUNDLED_DIR);
  }
  if (process.env[CLI_BUNDLED_ROOT_ENV]) {
    roots.push(join(process.env[CLI_BUNDLED_ROOT_ENV], "native-runner"));
  }
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  roots.push(join(moduleDir, "..", "bundled", "native-runner"));
  roots.push(join(moduleDir, "bundled", "native-runner"));
  // Legacy paths for backward compat
  roots.push(join(moduleDir, "..", "native-runner"));
  roots.push(join(moduleDir, "native-runner"));
  return roots;
}

function isExecutableNativeRunnerCandidate(path: string): boolean {
  try {
    accessSync(
      path,
      process.platform === "win32" ? constants.R_OK : constants.R_OK | constants.X_OK,
    );
    return true;
  } catch {
    return false;
  }
}

function parseRunnerJson(raw: string): Record<string, unknown> {
  for (const line of raw.split(/\r?\n/u).filter(Boolean).reverse()) {
    try {
      const parsed = JSON.parse(line) as unknown;
      if (isRecord(parsed)) return parsed;
    } catch {
      // keep looking for the short JSON protocol line
    }
  }
  return {};
}

function createNativeRunnerCommand(
  runnerPath: string,
  args: string[],
): { command: string; args: string[] } {
  if (runnerPath.endsWith(".js") || runnerPath.endsWith(".cjs") || runnerPath.endsWith(".mjs")) {
    return { command: process.execPath, args: [runnerPath, ...args] };
  }
  return { command: runnerPath, args };
}

async function runNativeRunnerCommand(
  command: { command: string; args: string[] },
  options: { cwd?: string; timeoutMs: number },
): Promise<NativeRunnerCommandResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const child = spawn(command.command, command.args, {
      cwd: options.cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs);
    const finish = (result: Omit<NativeRunnerCommandResult, "stdout" | "stderr" | "raw" | "timedOut">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ...result,
        stdout,
        stderr,
        raw: `${stdout}\n${stderr}`.trim(),
        timedOut,
      });
    };
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      finish({ status: null, error: error instanceof Error ? error : new Error(String(error)) });
    });
    child.once("close", (status) => {
      finish({
        status,
        error: timedOut ? new Error(`runner command timed out after ${options.timeoutMs}ms`) : undefined,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Runner spec and lifecycle
// ---------------------------------------------------------------------------

export function formatNativeRunnerProcessGuardContract(): string {
  return NATIVE_RUNNER_PROCESS_GUARD_CONTRACT.map(
    (line) => `- process guard contract: ${line}`,
  ).join("\n");
}

export function formatApprovedRunnerSpecLine(job: DurableJobState): string {
  const spec = job.runner?.spec;
  if (!spec) {
    return `- approved spec: none\n${formatNativeRunnerProcessGuardContract()}`;
  }
  return [
    `- approved spec: id=${spec.id}; taskKind=${spec.approvedTaskKind}; cwdRef=${redactedPath(spec.cwd)}; timeoutMs=${spec.timeoutMs}; expectedProtocol=${spec.expectedProtocol}; envAllowlist=${spec.envAllowlist.join(",") || "none"}; redactedEnvRefs=${spec.redactedEnvRefs.join(",") || "none"}; evidenceRefs=${spec.evidenceRefs.join(",") || "none"}; logRefs=state/stdout/stderr/jobLog/fullOutput/report`,
    formatNativeRunnerProcessGuardContract(),
  ].join("\n");
}

export function createApprovedRunnerJobSpec(
  context: RunnerContext,
  job: DurableJobState,
  resolution: NativeRunnerResolution,
): ApprovedRunnerJobSpec {
  const runnerRoot = join(dirname(job.logPath), "runner");
  return {
    id: job.id,
    approvedTaskKind: "durable_job_supervisor",
    cwd: context.projectPath,
    envAllowlist: [],
    redactedEnvRefs: ["PATH:runtime-only"],
    timeoutMs: Math.min(job.timeoutMs, context.config.nativeRunner.timeoutMs),
    logPaths: {
      state: join(runnerRoot, job.id, "state.json"),
      stdout: join(runnerRoot, job.id, "stdout.log"),
      stderr: join(runnerRoot, job.id, "stderr.log"),
      jobLog: job.logPath,
      fullOutput: job.fullOutputPath,
      report: job.reportPath,
    },
    expectedProtocol: resolution.protocol ?? context.config.nativeRunner.expectedProtocol,
    permissionRef: job.permissionPolicy,
    evidenceRefs: job.evidenceRefs.map((item) => item.id),
    runnerRoot,
  };
}

export async function startRunnerForDurableJob(
  context: RunnerContext,
  job: DurableJobState,
  deps: RunnerRuntimeDeps,
): Promise<void> {
  const resolution = await resolveNativeRunnerAsync(context.config);
  const spec = createApprovedRunnerJobSpec(context, job, resolution);
  const result = await startApprovedRunnerSpec(context, spec, resolution);
  const now = new Date().toISOString();
  job.runner = {
    enabled: resolution.enabled,
    status: result.status,
    resolution: resolution.status,
    adapter: result.adapter,
    protocol: result.protocol ?? resolution.protocol,
    version: result.version ?? resolution.version,
    pathRef: resolution.pathRef,
    spec,
    startedAt: now,
    updatedAt: now,
    completedAt:
      result.status === "completed" || result.status === "node_fallback" ? now : undefined,
    heartbeatAt: result.heartbeatAt,
    logRefs: result.logRefs,
    lastError: result.lastError,
    fallbackReason: result.fallbackReason,
    nextAction:
      result.status === "node_fallback"
        ? "Node/TUI fallback is active; runner fallback is non-PASS and visible in report/background."
        : result.status === "running"
          ? "Native runner is supervising an approved long-running task; verification remains partial until verified separately."
          : "Native runner reached a terminal lifecycle state; verification remains partial until verified separately.",
  };
  await deps.appendJobLog(
    job,
    `runner adapter ${job.runner.adapter}; status ${job.runner.status}; resolution ${job.runner.resolution}; fallback ${job.runner.fallbackReason ?? "none"}`,
  );
}

async function startApprovedRunnerSpec(
  _context: RunnerContext,
  spec: ApprovedRunnerJobSpec,
  resolution: NativeRunnerResolution,
): Promise<NativeRunnerAdapterResult> {
  if (resolution.status !== "available" || !resolution.path) {
    return {
      status: "node_fallback",
      adapter: "node",
      protocol: resolution.protocol,
      version: resolution.version,
      lastError: resolution.lastError,
      fallbackReason: resolution.status,
    };
  }
  await mkdir(spec.runnerRoot, { recursive: true });
  const taskDurationMs =
    spec.timeoutMs <= NATIVE_RUNNER_APPROVED_TASK_HEARTBEAT_MS * 8
      ? spec.timeoutMs + NATIVE_RUNNER_APPROVED_TASK_HEARTBEAT_MS * 5
      : 1_200;
  const startCommand = createNativeRunnerCommand(resolution.path, [
    "start",
    "--id",
    spec.id,
    "--root",
    spec.runnerRoot,
    "--timeout-ms",
    String(spec.timeoutMs),
    "--heartbeat-ms",
    String(NATIVE_RUNNER_APPROVED_TASK_HEARTBEAT_MS),
    "--",
    process.execPath,
    "-e",
    NATIVE_RUNNER_APPROVED_TASK_SCRIPT,
    String(taskDurationMs),
  ]);
  let child!: ReturnType<typeof spawn>;
  let spawnError: string | undefined;
  try {
    child = spawn(startCommand.command, startCommand.args, {
      cwd: spec.cwd,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", (error) => {
      spawnError = sanitizeDiagnosticText(error instanceof Error ? error.message : String(error));
    });
    child.unref();
    if (child.pid) _runnerPids.set(spec.id, child.pid);
  } catch (error) {
    return {
      status: "node_fallback",
      adapter: "node",
      protocol: resolution.protocol,
      version: resolution.version,
      lastError: sanitizeDiagnosticText(error instanceof Error ? error.message : String(error)),
      fallbackReason: "start_failed",
    };
  }

  const state = await waitForRunnerState(spec, NATIVE_RUNNER_START_STATE_WAIT_MS);
  if (!state) {
    const failed = await new Promise<boolean>((resolve) => {
      if (child.exitCode !== null) {
        resolve(true);
        return;
      }
      child.once("exit", () => resolve(true));
      setTimeout(() => resolve(false), 25);
    });
    return {
      status: "node_fallback",
      adapter: "node",
      protocol: resolution.protocol,
      version: resolution.version,
      lastError: spawnError
        ? `runner spawn error: ${spawnError}`
        : failed
        ? "runner start failed before writing observable state"
        : "runner did not write observable state before startup timeout",
      fallbackReason: "start_failed",
    };
  }
  const status = mapNativeRunnerStatus(stringValue(state.status, "running"));
  return {
    status,
    adapter: "native",
    protocol: stringValue(state.protocol, resolution.protocol ?? "unknown"),
    version: resolution.version,
    heartbeatAt: runnerHeartbeatValue(state),
    logRefs: runnerLogRefs(spec, state),
    lastError:
      status === "failed"
        ? sanitizeDiagnosticText(stringValue(state.error, "runner start failed"))
        : undefined,
  };
}

async function waitForRunnerState(
  spec: ApprovedRunnerJobSpec,
  timeoutMs: number,
): Promise<Record<string, unknown> | undefined> {
  const started = Date.now();
  while (Date.now() - started <= timeoutMs) {
    const state = await readRunnerState(spec);
    if (state) return state;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return undefined;
}

async function readRunnerState(
  spec: ApprovedRunnerJobSpec,
): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed = JSON.parse(await readFile(spec.logPaths.state, "utf8")) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function runnerHeartbeatValue(state: Record<string, unknown>): string | undefined {
  const heartbeatAt = state.heartbeatAt;
  if (typeof heartbeatAt === "number" || typeof heartbeatAt === "string") {
    return String(heartbeatAt);
  }
  const updatedAt = state.updatedAt;
  return typeof updatedAt === "number" || typeof updatedAt === "string"
    ? String(updatedAt)
    : undefined;
}

function runnerLogRefs(
  spec: ApprovedRunnerJobSpec,
  state: Record<string, unknown>,
): { state: string; stdout: string; stderr: string } {
  return {
    state: "state.json",
    stdout: safeRunnerLogRef(state.stdoutPath, spec.logPaths.stdout),
    stderr: safeRunnerLogRef(state.stderrPath, spec.logPaths.stderr),
  };
}

function safeRunnerLogRef(value: unknown, fallbackPath: string): string {
  const fallback = basename(fallbackPath);
  if (typeof value !== "string" || value.trim().length === 0) {
    return isSafeRunnerRelativeLogRef(fallback) ? fallback : "log";
  }
  const ref = sanitizeDiagnosticText(value.trim());
  if (isSafeRunnerRelativeLogRef(ref)) {
    return ref;
  }
  const redactedBasename = ref.replaceAll("\\", "/").split("/").filter(Boolean).at(-1);
  if (redactedBasename && isSafeRunnerRelativeLogRef(redactedBasename)) {
    return `present:${redactedBasename}`;
  }
  return isSafeRunnerRelativeLogRef(fallback) ? `present:${fallback}` : "present:log";
}

function isSafeRunnerRelativeLogRef(ref: string): boolean {
  return /^[A-Za-z0-9._-]+$/u.test(ref) && !ref.includes("..") && !ref.includes(":");
}

function mapNativeRunnerStatus(status: string): NativeRunnerLifecycleStatus {
  if (status === "timeout") return "timeout";
  if (status === "cancelled") return "cancelled";
  if (status === "failed" || status === "duplicate" || status === "missing") return "failed";
  if (status === "running") return "running";
  if (status === "completed") return "completed";
  return "failed";
}

export async function refreshRunnerStatusForJob(
  context: RunnerContext,
  job: DurableJobState,
  deps: RunnerRuntimeDeps,
): Promise<void> {
  if (!job.runner?.spec || job.runner.adapter !== "native") return;
  const refreshedAt = Date.parse(job.runner.updatedAt);
  if (
    !Number.isNaN(refreshedAt) &&
    Date.now() - refreshedAt < NATIVE_RUNNER_STATUS_REFRESH_TTL_MS &&
    (job.runner.status === "starting" || job.runner.status === "running")
  ) {
    return;
  }
  const resolution = await resolveNativeRunnerAsync(context.config);
  if (resolution.status !== "available" || !resolution.path) {
    markJobRunnerFallback(job, resolution.status, resolution.lastError ?? resolution.status);
    return;
  }
  const statusCommand = createNativeRunnerCommand(resolution.path, [
    "status",
    "--id",
    job.runner.spec.id,
    "--root",
    job.runner.spec.runnerRoot,
  ]);
  const status = await runNativeRunnerCommand(statusCommand, {
    timeoutMs: NATIVE_RUNNER_VERSION_TIMEOUT_MS,
  });
  if (status.error || status.status !== 0) {
    markJobRunnerFallback(job, "available", status.raw || "runner status failed", "status_failed");
    return;
  }
  const parsed = parseRunnerJson(status.raw);
  const mapped = mapNativeRunnerStatus(stringValue(parsed.status, job.runner.status));
  const now = new Date().toISOString();
  job.runner.status = mapped;
  job.runner.updatedAt = now;
  job.runner.heartbeatAt = runnerHeartbeatValue(parsed) ?? job.runner.heartbeatAt;
  job.runner.logRefs = runnerLogRefs(job.runner.spec, parsed);
  if (mapped !== "running") job.runner.completedAt ??= now;
  if (mapped === "timeout" || mapped === "cancelled" || mapped === "failed") {
    job.status = mapped;
    job.pauseReason = `runner_${mapped}`;
    job.updatedAt = now;
    job.endedAt = now;
    job.result = {
      status: mapped,
      summary: `Native runner reported ${mapped}; no PASS evidence generated.`,
      facts: [formatJobRunnerInline(job)],
      evidenceRefs: job.evidenceRefs.map((item) => item.id),
      generatedAt: now,
    };
    deps.rescheduleDurableJobAgents(job);
  }
}

export async function stopRunnerForDurableJob(
  context: RunnerContext,
  job: DurableJobState,
  deps: RunnerRuntimeDeps,
): Promise<void> {
  if (!job.runner?.spec || job.runner.adapter !== "native") {
    markJobRunnerTerminal(job, "cancelled", "node fallback or no native runner to stop");
    return;
  }
  const resolution = await resolveNativeRunnerAsync(context.config);
  let stopRequested = false;
  let fallbackKillAttempted = false;
  if (resolution.status === "available" && resolution.path) {
    const stopCommand = createNativeRunnerCommand(resolution.path, [
      "stop",
      "--id",
      job.runner.spec.id,
      "--root",
      job.runner.spec.runnerRoot,
    ]);
    await runNativeRunnerCommand(stopCommand, {
      timeoutMs: NATIVE_RUNNER_VERSION_TIMEOUT_MS,
    });
    stopRequested = true;
  } else {
    const pid = _runnerPids.get(job.runner.spec.id);
    if (pid !== undefined) {
      try {
        if (process.platform === "win32") {
          await runNativeRunnerCommand(
            { command: "taskkill", args: ["/pid", String(pid), "/t", "/f"] },
            { timeoutMs: NATIVE_RUNNER_VERSION_TIMEOUT_MS },
          );
        } else {
          try {
            process.kill(-pid, "SIGKILL");
          } catch {
            process.kill(pid, "SIGKILL");
          }
        }
        fallbackKillAttempted = true;
      } catch {
        /* fallback kill failed */
      }
    }
  }
  _runnerPids.delete(job.runner.spec.id);
  markJobRunnerTerminal(job, "cancelled", "user_cancelled");
  await deps.appendJobLog(
    job,
    stopRequested
      ? "runner stop --id requested; cancelled is non-PASS"
      : fallbackKillAttempted
        ? "runner binary unavailable; fallback pid/taskkill used; cancelled is non-PASS"
        : "runner stop unavailable; no pid/taskkill fallback available; cancelled is non-PASS",
  );
}

export function markJobRunnerTerminal(
  job: DurableJobState,
  status: NativeRunnerLifecycleStatus,
  reason: string,
): void {
  const now = new Date().toISOString();
  const shouldSyncActiveJob =
    job.status === "created" || job.status === "running" || job.status === "sleeping";
  if (
    shouldSyncActiveJob &&
    (status === "cancelled" || status === "timeout" || status === "failed" || status === "stale")
  ) {
    job.status = status;
    job.pauseReason = `runner_${status}`;
    job.updatedAt = now;
    job.endedAt = now;
    job.result = {
      status,
      summary: `Native runner moved to ${status}; no PASS evidence generated.`,
      facts: [sanitizeDiagnosticText(reason), formatJobRunnerInline(job)],
      evidenceRefs: job.evidenceRefs.map((item) => item.id),
      generatedAt: now,
    };
  }
  job.runner = {
    enabled: job.runner?.enabled ?? false,
    status,
    resolution: job.runner?.resolution ?? "unavailable",
    adapter: job.runner?.adapter ?? "node",
    protocol: job.runner?.protocol,
    version: job.runner?.version,
    pathRef: job.runner?.pathRef,
    spec: job.runner?.spec,
    startedAt: job.runner?.startedAt,
    updatedAt: now,
    completedAt: now,
    heartbeatAt: job.runner?.heartbeatAt,
    logRefs: job.runner?.logRefs,
    lastError: sanitizeDiagnosticText(reason),
    fallbackReason: job.runner?.fallbackReason,
    nextAction: "Inspect /job report and logs; runner terminal states are not verification PASS.",
  };
}

export function markJobRunnerFallback(
  job: DurableJobState,
  resolution: NativeRunnerResolutionStatus,
  reason: string,
  fallbackReason: string = resolution,
): void {
  const now = new Date().toISOString();
  job.runner = {
    enabled: job.runner?.enabled ?? true,
    status: "node_fallback",
    resolution,
    adapter: "node",
    protocol: job.runner?.protocol,
    version: job.runner?.version,
    pathRef: job.runner?.pathRef,
    spec: job.runner?.spec,
    startedAt: job.runner?.startedAt,
    updatedAt: now,
    completedAt: now,
    heartbeatAt: job.runner?.heartbeatAt,
    logRefs: job.runner?.logRefs,
    lastError: sanitizeDiagnosticText(reason),
    fallbackReason,
    nextAction:
      "Node/TUI fallback is active; runner fallback is non-PASS and visible in report/background.",
  };
}
