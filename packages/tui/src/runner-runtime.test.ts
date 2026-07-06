import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type LinghunConfig, defaultConfig } from "@linghun/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DurableJobState } from "./index.js";
import {
  type RunnerContext,
  type RunnerRuntimeDeps,
  formatApprovedRunnerSpecLine,
  formatNativeRunnerProcessGuardContract,
  markJobRunnerFallback,
  markJobRunnerTerminal,
  resolveNativeRunner,
  resolveNativeRunnerAsync,
  stopRunnerForDurableJob,
} from "./runner-runtime.js";

function createTestRunnerContext(overrides?: Partial<RunnerContext>): RunnerContext {
  return {
    config: structuredClone(defaultConfig),
    projectPath: "/tmp/test-project",
    ...overrides,
  };
}

async function createMockRunner(project: string): Promise<{ path: string; callsPath: string }> {
  const runnerPath = join(project, "mock-runner.cjs");
  const callsPath = join(project, "runner-calls.jsonl");
  await writeFile(
    runnerPath,
    `#!/usr/bin/env node
const fs = require("node:fs");
const callsPath = ${JSON.stringify(callsPath)};
fs.appendFileSync(callsPath, JSON.stringify({ argv: process.argv.slice(2) }) + "\\n");
if (process.argv[2] === "version") {
  console.log(JSON.stringify({ protocol: "linghun-native-runner-prototype.v1", version: "0.1.0" }));
  process.exit(0);
}
if (process.argv[2] === "stop") {
  console.log(JSON.stringify({ ok: true }));
  process.exit(0);
}
process.exit(0);
`,
    "utf8",
  );
  if (process.platform !== "win32") {
    await chmod(runnerPath, 0o755);
  }
  return { path: runnerPath, callsPath };
}

function createMinimalJob(overrides?: Partial<DurableJobState>): DurableJobState {
  return {
    id: "job-runner-test",
    goal: "test runner resolution",
    projectPath: "/tmp/test-project",
    status: "running",
    phase: "Phase 17A",
    target: "local-durable-jobs",
    plan: ["step 1"],
    agents: [
      {
        id: "job-agent-1",
        type: "planner",
        displayName: "test-planner",
        goal: "test#1",
        status: "running",
        budgetTokens: 60000,
        heartbeatAt: "2025-01-01T00:00:00.000Z",
        summary: "running",
      },
    ],
    budget: {
      maxTokens: 120000,
      maxRunningAgents: 3,
      maxSteps: 4,
      note: "test budget",
    },
    timeoutMs: 30 * 60 * 1000,
    permissionPolicy: "ask",
    allowEdit: false,
    allowBash: false,
    allowMultiAgent: false,
    handoffPacket: undefined,
    evidenceRefs: [],
    adoptedConclusions: [],
    rejectedConclusions: [],
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:01.000Z",
    logPath: "/tmp/test-project/.linghun/jobs/job-runner-test/job.log",
    reportPath: "/tmp/test-project/.linghun/jobs/job-runner-test/report.md",
    fullOutputPath: "/tmp/test-project/.linghun/jobs/job-runner-test/full-output.log",
    ...overrides,
  } as DurableJobState;
}

describe("runner path resolution", () => {
  it("resolveNativeRunner returns disabled when runner is disabled", () => {
    const config = structuredClone(defaultConfig);
    config.nativeRunner.enabled = false;
    const result = resolveNativeRunner(config);
    expect(result.status).toBe("disabled");
    expect(result.enabled).toBe(false);
    expect(result.nodeFallback).toBe("available");
  });

  it("resolveNativeRunner returns unavailable when enabled but no binary", () => {
    const config = structuredClone(defaultConfig);
    config.nativeRunner.enabled = true;
    config.nativeRunner.source = "bundled";
    const result = resolveNativeRunner(config);
    // Binary won't exist in test env
    expect(["unavailable", "available"]).toContain(result.status);
    expect(result.enabled).toBe(true);
    expect(result.nodeFallback).toBe("available");
  });

  it("resolveNativeRunner includes platform and arch info", () => {
    const config = structuredClone(defaultConfig);
    const result = resolveNativeRunner(config);
    expect(result.platform).toBe(process.platform);
    expect(result.arch).toBe(process.arch);
    expect(result.platformArch).toContain(process.platform);
  });

  it("resolveNativeRunner respects LINGHUN_NATIVE_RUNNER_PLATFORM_ARCH_TEST env", () => {
    const config = structuredClone(defaultConfig);
    config.nativeRunner.enabled = true;
    config.nativeRunner.source = "bundled";
    vi.stubEnv("LINGHUN_NATIVE_RUNNER_PLATFORM_ARCH_TEST", "linux-x64");
    const result = resolveNativeRunner(config);
    expect(result.platformArch).toBe("linux-x64");
    vi.unstubAllEnvs();
  });

  it("resolveNativeRunnerAsync probes version asynchronously and reuses the short TTL cache", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-runner-probe-"));
    const runner = await createMockRunner(project);
    const config = structuredClone(defaultConfig);
    config.nativeRunner.enabled = true;
    config.nativeRunner.source = "custom";
    config.nativeRunner.path = runner.path;

    const first = await resolveNativeRunnerAsync(config);
    const second = await resolveNativeRunnerAsync(config);

    expect(first.status).toBe("available");
    expect(first.probeCacheStatus).toBe("fresh");
    expect(second.status).toBe("available");
    expect(second.probeCacheStatus).toBe("cached");
    const calls = (await readFile(runner.callsPath, "utf8"))
      .trim()
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { argv: string[] });
    expect(calls.filter((call) => call.argv[0] === "version")).toHaveLength(1);
  });
});

describe("missing fallback", () => {
  it("markJobRunnerFallback sets node_fallback status", () => {
    const job = createMinimalJob();
    markJobRunnerFallback(job, "unavailable", "binary not found");
    expect(job.runner?.status).toBe("node_fallback");
    expect(job.runner?.adapter).toBe("node");
    expect(job.runner?.lastError).toContain("binary not found");
    expect(job.runner?.nextAction).toContain("Node/TUI fallback");
  });

  it("markJobRunnerFallback preserves existing runner fields", () => {
    const job = createMinimalJob();
    job.runner = {
      enabled: true,
      status: "running",
      resolution: "available",
      adapter: "native",
      protocol: "linghun-runner-v1",
      version: "0.1.0",
      pathRef: "present:linghun-native-runner",
      startedAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
      nextAction: "running",
    };
    markJobRunnerFallback(job, "unavailable", "lost connection", "connection_lost");
    expect(job.runner.status).toBe("node_fallback");
    expect(job.runner.protocol).toBe("linghun-runner-v1");
    expect(job.runner.version).toBe("0.1.0");
    expect(job.runner.fallbackReason).toBe("connection_lost");
  });
});

describe("terminal state no PASS", () => {
  it("markJobRunnerTerminal sets terminal status", () => {
    const job = createMinimalJob();
    markJobRunnerTerminal(job, "cancelled", "user_cancelled");
    expect(job.status).toBe("cancelled");
    expect(job.result?.status).toBe("cancelled");
    expect(job.result?.summary).toContain("no PASS evidence");
    expect(job.runner?.status).toBe("cancelled");
    expect(job.runner?.completedAt).toBeDefined();
    expect(job.runner?.lastError).toContain("user_cancelled");
    expect(job.runner?.nextAction).toContain("not verification PASS");
  });

  it("markJobRunnerTerminal with timeout status", () => {
    const job = createMinimalJob();
    markJobRunnerTerminal(job, "timeout", "exceeded max runtime");
    expect(job.status).toBe("timeout");
    expect(job.result?.status).toBe("timeout");
    expect(job.runner?.status).toBe("timeout");
    expect(job.runner?.lastError).toContain("exceeded max runtime");
  });

  it("markJobRunnerTerminal with failed status", () => {
    const job = createMinimalJob();
    markJobRunnerTerminal(job, "failed", "process crashed");
    expect(job.status).toBe("failed");
    expect(job.result?.status).toBe("failed");
    expect(job.runner?.status).toBe("failed");
    expect(job.runner?.lastError).toContain("process crashed");
  });

  it("markJobRunnerTerminal preserves an already terminal job status", () => {
    const job = createMinimalJob({
      status: "blocked",
      pauseReason: "architecture boundary risk",
      result: {
        status: "blocked",
        summary: "Blocked by architecture boundary risk.",
        facts: [],
        evidenceRefs: [],
        generatedAt: "2025-01-01T00:00:02.000Z",
      },
    });
    markJobRunnerTerminal(job, "cancelled", "stop after blocked transition");
    expect(job.status).toBe("blocked");
    expect(job.result?.status).toBe("blocked");
    expect(job.runner?.status).toBe("cancelled");
  });

  it("terminal states never produce standalone PASS claim in nextAction", () => {
    const job = createMinimalJob();
    for (const status of ["cancelled", "timeout", "failed"] as const) {
      markJobRunnerTerminal(job, status, `reason_${status}`);
      // nextAction says "not verification PASS" — it must NOT say just "PASS" without negation
      expect(job.runner?.nextAction).toContain("not verification PASS");
      expect(job.runner?.nextAction).not.toMatch(/\bPASS\b(?!\.)/);
    }
  });
});

describe("formatApprovedRunnerSpecLine", () => {
  it("returns 'none' when no spec", () => {
    const job = createMinimalJob();
    const result = formatApprovedRunnerSpecLine(job);
    expect(result).toContain("approved spec: none");
    expect(result).toContain("Windows native runner SHOULD use a Job Object");
  });

  it("formats spec fields when present", () => {
    const job = createMinimalJob();
    job.runner = {
      enabled: true,
      status: "running",
      resolution: "available",
      adapter: "native",
      spec: {
        id: "job-runner-test",
        approvedTaskKind: "durable_job_supervisor",
        cwd: "/tmp/test-project",
        envAllowlist: [],
        redactedEnvRefs: ["PATH:runtime-only"],
        timeoutMs: 1800000,
        logPaths: {
          state: "/tmp/state.json",
          stdout: "/tmp/stdout.log",
          stderr: "/tmp/stderr.log",
          jobLog: "/tmp/job.log",
          fullOutput: "/tmp/full-output.log",
          report: "/tmp/report.md",
        },
        expectedProtocol: "linghun-runner-v1",
        permissionRef: "default",
        evidenceRefs: [],
        runnerRoot: "/tmp/runner",
      },
      startedAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
      nextAction: "running",
    };
    const result = formatApprovedRunnerSpecLine(job);
    expect(result).toContain("approved spec: id=job-runner-test");
    expect(result).toContain("taskKind=durable_job_supervisor");
    expect(result).toContain("expectedProtocol=linghun-runner-v1");
    expect(result).toContain("Unix native runner SHOULD create and manage a child process group");
  });
});

describe("native runner process guard contract", () => {
  it("exposes the contract in doctor/report helpers", () => {
    const contract = formatNativeRunnerProcessGuardContract();

    expect(contract).toContain("Windows native runner SHOULD use a Job Object");
    expect(contract).toContain("Unix native runner SHOULD create and manage a child process group");
    expect(contract).toContain("real native runner smoke");
  });

  it("stopRunnerForDurableJob sends runner stop --id instead of naked pid kill", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-runner-stop-"));
    const runner = await createMockRunner(project);
    const context = createTestRunnerContext({
      projectPath: project,
      config: {
        ...structuredClone(defaultConfig),
        nativeRunner: {
          ...structuredClone(defaultConfig.nativeRunner),
          enabled: true,
          source: "custom",
          path: runner.path,
        },
      },
    });
    const job = createMinimalJob({ projectPath: project });
    job.runner = {
      enabled: true,
      status: "running",
      resolution: "available",
      adapter: "native",
      protocol: "linghun-native-runner-prototype.v1",
      version: "0.1.0",
      pathRef: "present:mock-runner.cjs",
      startedAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
      spec: {
        id: job.id,
        approvedTaskKind: "durable_job_supervisor",
        cwd: project,
        envAllowlist: [],
        redactedEnvRefs: [],
        timeoutMs: 60_000,
        logPaths: {
          state: join(project, "state.json"),
          stdout: join(project, "stdout.log"),
          stderr: join(project, "stderr.log"),
          jobLog: job.logPath,
          fullOutput: job.fullOutputPath,
          report: job.reportPath,
        },
        expectedProtocol: "linghun-native-runner-prototype.v1",
        permissionRef: "default",
        evidenceRefs: [],
        runnerRoot: project,
      },
      nextAction: "running",
    };
    const deps: RunnerRuntimeDeps = {
      appendJobLog: vi.fn(async () => undefined),
      rescheduleDurableJobAgents: vi.fn(),
    };

    await stopRunnerForDurableJob(context, job, deps);

    const calls = (await readFile(runner.callsPath, "utf8"))
      .trim()
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { argv: string[] });
    expect(calls).toContainEqual({ argv: ["stop", "--id", job.id, "--root", project] });
    expect(calls.flatMap((call) => call.argv)).not.toContain("taskkill");
    expect(calls.flatMap((call) => call.argv)).not.toContain("/pid");
    expect(job.status).toBe("cancelled");
    expect(job.result?.status).toBe("cancelled");
    expect(job.runner?.status).toBe("cancelled");
  });
});
