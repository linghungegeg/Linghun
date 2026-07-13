import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { defaultConfig } from "@linghun/config";
import { describe, expect, it, vi } from "vitest";
import { createCacheState, createHookState } from "./index.js";
import { createIndexState } from "./index-runtime.js";
import type { TuiContext } from "./tui-context-runtime.js";
import { createMemoryState } from "./tui-state-runtime.js";
import { runVerificationPlan } from "./verification-command-runtime.js";
import { runWorkflowVerificationStep } from "./workflow-command-runtime.js";
import type { WorkflowRunState } from "./tui-data-types.js";

class MockWritable extends Writable {
  _write(_chunk: unknown, _encoding: string, callback: () => void): void {
    callback();
  }
}

describe("verification scope wiring", () => {
  it("passes originalTask and targetPackage from runVerificationPlan options to scope", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-scope-"));
    await writeFile(
      join(projectPath, "package.json"),
      JSON.stringify({ name: "test-project" }),
      "utf8",
    );
    const context = await createTestContext(projectPath);

    const report = await runVerificationPlan(
      [
        {
          kind: "smoke",
          command: "node --version",
          reason: "smoke check",
          synthetic: true,
        },
      ],
      context,
      "session-scope-test",
      new MockWritable(),
      async () => {},
      {
        originalTask: "implement feature X",
        targetPackage: "packages/core",
        requestTurnId: "turn-123",
      },
    );

    expect(report.scope).toBeDefined();
    expect(report.scope?.originalTask).toBe("implement feature X");
    expect(report.scope?.targetPackage).toBe("packages/core");
    expect(report.scope?.requestTurnId).toBe("turn-123");
  });

  it("passes originalTask from workflow goal to verification scope", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-workflow-scope-"));
    await writeFile(
      join(projectPath, "package.json"),
      JSON.stringify({ name: "test-project" }),
      "utf8",
    );
    const context = await createTestContext(projectPath);
    const workflowRunId = "workflow-run-123";
    const workflowRun: WorkflowRunState = {
      id: workflowRunId,
      goal: "fix bug in user authentication",
      planId: "plan-1",
      status: "running",
      steps: [],
      startedAt: new Date().toISOString(),
      result: "partial",
    };
    context.workflows = {
      runs: [workflowRun],
    };

    const report = await runWorkflowVerificationStep("smoke", context, new MockWritable(), {
      workflowRunId,
      originalTask: workflowRun.goal,
    });

    expect(report.scope).toBeDefined();
    expect(report.scope?.originalTask).toBe("fix bug in user authentication");
    expect(report.scope?.workflowRunId).toBe(workflowRunId);
  });

  it("derives targetPackage from verification cwd when different from project root", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-package-scope-"));
    const packagePath = join(projectPath, "packages", "core");
    await mkdir(packagePath, { recursive: true });
    await writeFile(
      join(projectPath, "package.json"),
      JSON.stringify({ name: "test-monorepo" }),
      "utf8",
    );
    await writeFile(
      join(packagePath, "package.json"),
      JSON.stringify({ name: "core" }),
      "utf8",
    );
    const context = await createTestContext(projectPath);

    const report = await runVerificationPlan(
      [
        {
          kind: "smoke",
          command: "node --version",
          reason: "smoke check",
          synthetic: true,
        },
      ],
      context,
      "session-package-scope",
      new MockWritable(),
      async () => {},
      {
        cwd: packagePath,
        originalTask: "update core package",
        targetPackage: "packages/core",
      },
    );

    expect(report.scope).toBeDefined();
    expect(report.scope?.originalTask).toBe("update core package");
    expect(report.scope?.targetPackage).toBe("packages/core");
    expect(report.scope?.cwd).toBe(packagePath);
  });

  it("omits originalTask and targetPackage from scope when not provided", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-no-scope-"));
    await writeFile(
      join(projectPath, "package.json"),
      JSON.stringify({ name: "test-project" }),
      "utf8",
    );
    const context = await createTestContext(projectPath);

    const report = await runVerificationPlan(
      [
        {
          kind: "smoke",
          command: "node --version",
          reason: "smoke check",
          synthetic: true,
        },
      ],
      context,
      "session-no-scope",
      new MockWritable(),
      async () => {},
      {},
    );

    expect(report.scope).toBeDefined();
    expect(report.scope?.originalTask).toBeUndefined();
    expect(report.scope?.targetPackage).toBeUndefined();
  });
});

async function createTestContext(projectPath: string): Promise<TuiContext> {
  return {
    projectPath,
    config: defaultConfig,
    language: "zh-CN",
    backgroundTasks: [],
    backgroundAbortControllers: new Map(),
    evidence: [],
    permissionMode: "full-access",
    permissions: { rules: [], recentDenied: [] },
    tools: { workspaceRoot: projectPath, changedFiles: [], todos: [] },
    cache: createCacheState(projectPath),
    hooks: await createHookState(defaultConfig, projectPath),
    mcp: { servers: [], lastMcpSchemaUpdate: new Date().toISOString() },
    index: createIndexState(),
    memory: createMemoryState(),
    failureLearning: {
      facts: [],
      lessons: [],
      migrations: { completed: [], pending: [], errors: [] },
    },
    skills: {
      installed: [],
      trustedIds: [],
      evolutionCandidates: [],
      rejectedEvolutionCandidates: [],
    },
    workflows: { runs: [] },
    agentRegistry: { agents: [], errors: [] },
    workflowRegistry: { workflows: [], errors: [] },
    plugins: { installed: [], errors: [] },
    remote: { channels: [] },
    agents: [],
    roleUsage: [],
    routeDecisions: [],
    roleHandoffs: [],
    visionObservations: [],
    imageResults: [],
    checkpoints: [],
    recentlyMentionedFiles: [],
    discoveredDeferredToolNames: new Set(),
    providerBreaker: {
      failures: [],
      circuitOpen: false,
      lastStateChange: new Date().toISOString(),
    },
    solutionCompleteness: {
      status: "not_started",
      lastAssessment: new Date().toISOString(),
    },
    store: {
      appendEvent: vi.fn(async () => {}),
    },
  } as unknown as TuiContext;
}
