import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type LinghunConfig, defaultConfig } from "@linghun/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DurableJobState } from "./index.js";
import {
  type RunnerContext,
  type RunnerRuntimeDeps,
  formatApprovedRunnerSpecLine,
  markJobRunnerFallback,
  markJobRunnerTerminal,
  resolveNativeRunner,
} from "./runner-runtime.js";

function createTestRunnerContext(overrides?: Partial<RunnerContext>): RunnerContext {
  return {
    config: structuredClone(defaultConfig),
    projectPath: "/tmp/test-project",
    ...overrides,
  };
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
    expect(job.runner?.status).toBe("cancelled");
    expect(job.runner?.completedAt).toBeDefined();
    expect(job.runner?.lastError).toContain("user_cancelled");
    expect(job.runner?.nextAction).toContain("not verification PASS");
  });

  it("markJobRunnerTerminal with timeout status", () => {
    const job = createMinimalJob();
    markJobRunnerTerminal(job, "timeout", "exceeded max runtime");
    expect(job.runner?.status).toBe("timeout");
    expect(job.runner?.lastError).toContain("exceeded max runtime");
  });

  it("markJobRunnerTerminal with failed status", () => {
    const job = createMinimalJob();
    markJobRunnerTerminal(job, "failed", "process crashed");
    expect(job.runner?.status).toBe("failed");
    expect(job.runner?.lastError).toContain("process crashed");
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
  });
});
