import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { defaultConfig, resolveStoragePaths } from "@linghun/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { recordVerificationEvidence } from "./evidence-runtime.js";
import type { TuiContext } from "./index.js";
import { createCacheState, createHookState } from "./index.js";
import type { VerificationReport, VerificationStepKind } from "./tui-data-types.js";
import {
  createVerificationPlan,
  isCurrentVerificationReport,
  runVerificationPlan,
} from "./verification-command-runtime.js";

describe("verification-command-runtime", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("createVerificationPlan", () => {
    it("creates smoke plan with synthetic node check", async () => {
      const plan = await createVerificationPlan("/tmp/fake-project", "smoke");
      expect(plan).toHaveLength(1);
      expect(plan[0].kind).toBe("smoke");
      expect(plan[0].synthetic).toBe(true);
    });

    it("creates default plan with typecheck, test, lint, build when scripts exist", async () => {
      // This will read actual package.json from project root
      const plan = await createVerificationPlan(process.cwd(), "default");
      expect(plan.length).toBeGreaterThan(0);
      const kinds = plan.map((step) => step.kind);
      expect(kinds).toContain("typecheck");
    });

    it("filters typecheck from default plan", async () => {
      const defaultPlan = await createVerificationPlan(process.cwd(), "default");
      const typecheckSteps = defaultPlan.filter((step) => step.kind === "typecheck");
      expect(typecheckSteps.length).toBeGreaterThan(0);
      expect(typecheckSteps[0].command).toContain("typecheck");
    });

    it.each([
      ["package-lock.json", "npm run test"],
      ["yarn.lock", "corepack yarn test"],
      ["bun.lockb", "bun run test"],
      ["pnpm-lock.yaml", "corepack pnpm test"],
    ])("uses %s to choose verification command", async (lockFile, expectedCommand) => {
      const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-pm-"));
      await writeFile(
        join(projectPath, "package.json"),
        JSON.stringify({ scripts: { test: "vitest run" } }),
        "utf8",
      );
      await writeFile(join(projectPath, lockFile), "", "utf8");

      const plan = await createVerificationPlan(projectPath, "default");

      expect(plan.find((step) => step.kind === "test")?.command).toBe(expectedCommand);
    });

    it("uses project-specific TUI/provider smoke scripts as real-smoke candidates", async () => {
      const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-real-smoke-"));
      await writeFile(
        join(projectPath, "package.json"),
        JSON.stringify({
          scripts: {
            "smoke:tui-stdin": "linghun < prompt.txt",
            "smoke:live-provider": "node live-provider.mjs",
          },
        }),
        "utf8",
      );
      await writeFile(join(projectPath, "pnpm-lock.yaml"), "", "utf8");

      const plan = await createVerificationPlan(projectPath, "real-smoke");

      expect(plan).toHaveLength(2);
      expect(plan.map((step) => step.command)).toEqual([
        "corepack pnpm smoke:tui-stdin",
        "corepack pnpm smoke:live-provider",
      ]);
      expect(plan.every((step) => step.kind === "smoke" && step.synthetic === false)).toBe(true);
      expect(plan[0].reason).toContain("TUI stdin real-smoke");
      expect(plan[1].reason).toContain("live-provider real-smoke");
    });

    it("prefers the standard smoke script for real-smoke when present", async () => {
      const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-standard-smoke-"));
      await writeFile(
        join(projectPath, "package.json"),
        JSON.stringify({
          scripts: {
            smoke: "node smoke.mjs",
            "smoke:tui-stdin": "linghun < prompt.txt",
          },
        }),
        "utf8",
      );
      await writeFile(join(projectPath, "pnpm-lock.yaml"), "", "utf8");

      const plan = await createVerificationPlan(projectPath, "real-smoke");

      expect(plan).toHaveLength(1);
      expect(plan[0]).toMatchObject({
        kind: "smoke",
        command: "corepack pnpm smoke",
        synthetic: false,
      });
    });
  });

  it("writes verification logs under LINGHUN_DATA_DIR when isolated", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-project-"));
    const isolatedDataDir = await mkdtemp(join(tmpdir(), "linghun-verify-data-"));
    vi.stubEnv("LINGHUN_DATA_DIR", isolatedDataDir);
    const context = {
      projectPath,
      config: defaultConfig,
      language: "zh-CN",
      backgroundTasks: [],
      backgroundAbortControllers: new Map(),
      cache: createCacheState(projectPath),
      hooks: await createHookState(defaultConfig, projectPath),
      store: {
        appendEvent: vi.fn(async () => {}),
      },
    } as unknown as TuiContext;
    const output = new MockWritable();
    const plan = await createVerificationPlan(projectPath, "smoke");
    await runVerificationPlan(plan, context, "session-1", output, async () => {});

    const logRoot = join(resolveStoragePaths(defaultConfig, projectPath).logs, "verification");
    expect(logRoot).toContain(isolatedDataDir);
    expect(logRoot).not.toContain(join(projectPath, ".linghun"));
    const files = await readdir(logRoot);
    expect(files.some((file) => file.endsWith("-smoke.log"))).toBe(true);
    await expect(readdir(join(projectPath, ".linghun", "logs", "verification"))).rejects.toThrow();
  });

  it("records scoped verification evidence without upgrading synthetic smoke to verification pass", async () => {
    const context = createEvidenceContext();
    await recordVerificationEvidence(
      context,
      "session-1",
      makeReport("pass", [{ kind: "smoke", synthetic: true }]),
    );

    expect(context.evidence[0]?.supportsClaims).toContain("verification_self_check_passed");
    expect(context.evidence[0]?.supportsClaims).toContain("verification_not_run");
    expect(context.evidence[0]?.supportsClaims).toContain("smoke_ran");
    expect(context.evidence[0]?.supportsClaims).not.toContain("verification_passed");
    expect(context.evidence[0]?.supportsClaims).not.toContain("test_passed");
    expect(context.evidence[0]?.supportsClaims).not.toContain("smoke_passed");
  });

  it("records typecheck and test pass claims only when those command kinds pass", async () => {
    const context = createEvidenceContext();
    await recordVerificationEvidence(
      context,
      "session-1",
      makeReport("pass", [{ kind: "typecheck" }, { kind: "test" }]),
    );

    expect(context.evidence[0]?.supportsClaims).toEqual(
      expect.arrayContaining(["verification_passed", "typecheck_passed", "test_passed"]),
    );
    expect(context.evidence[0]?.supportsClaims).not.toContain("build_passed");
  });

  it("returns partial without running commands when meta orchestration stops verification", async () => {
    const context = await createVerificationRunContext("stop");
    const report = await runVerificationPlan(
      [
        {
          kind: "test",
          command: "node -e \"throw new Error('should not run')\"",
          reason: "blocked command",
        },
      ],
      context,
      "session-1",
      new MockWritable(),
      async () => {},
    );

    expect(report.status).toBe("partial");
    expect(report.commands).toHaveLength(0);
    expect(report.summary).toContain("中枢调度要求 verification stop");
  });

  it("runs only the first verification step when meta orchestration degrades verification", async () => {
    const context = await createVerificationRunContext("degrade");
    const report = await runVerificationPlan(
      [
        {
          kind: "smoke",
          command: "node -e \"console.log('first')\"",
          reason: "first step",
        },
        {
          kind: "test",
          command: "node -e \"throw new Error('second should be skipped')\"",
          reason: "second step",
        },
      ],
      context,
      "session-1",
      new MockWritable(),
      async () => {},
    );

    expect(report.status).toBe("partial");
    expect(report.commands).toHaveLength(1);
    expect(report.unverified.join("\n")).toContain("meta orchestration degrade skipped 1");
  });

  it("creates and runs verification in the owner worktree cwd", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-main-"));
    const worktreePath = await mkdtemp(join(tmpdir(), "linghun-verify-worktree-"));
    const packageJson = JSON.stringify({
      scripts: {
        test: "node -e \"console.log(require('fs').readFileSync('marker.txt','utf8'))\"",
      },
    });
    await Promise.all([
      writeFile(join(projectPath, "package.json"), packageJson, "utf8"),
      writeFile(join(projectPath, "package-lock.json"), "", "utf8"),
      writeFile(join(projectPath, "marker.txt"), "main-marker", "utf8"),
      writeFile(join(worktreePath, "package.json"), packageJson, "utf8"),
      writeFile(join(worktreePath, "package-lock.json"), "", "utf8"),
      writeFile(join(worktreePath, "marker.txt"), "worktree-marker", "utf8"),
    ]);
    const context = await createRunnableVerificationContext(projectPath);
    const plan = await createVerificationPlan(worktreePath, "default");

    const report = await runVerificationPlan(
      plan,
      context,
      "agent-transcript",
      new MockWritable(),
      async () => {},
      {
        cwd: worktreePath,
        ownerAgentId: "agent-worktree",
        ownerSessionId: "session-owner",
      },
    );

    expect(report.status).toBe("pass");
    expect(report.commands.map((command) => command.summary).join("\n")).toContain(
      "worktree-marker",
    );
    expect(report.commands.map((command) => command.summary).join("\n")).not.toContain(
      "main-marker",
    );
    expect(context.backgroundTasks[0]).toMatchObject({
      ownerAgentId: "agent-worktree",
      ownerSessionId: "session-owner",
      result: "pass",
    });
  }, 30_000);

  it("isolates concurrent verification controllers and prevents cancelled late PASS", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-concurrent-"));
    const context = await createRunnableVerificationContext(projectPath);
    const runA = runVerificationPlan(
      [
        {
          kind: "test",
          command: "node -e \"setTimeout(() => console.log('A done'), 300)\"",
          reason: "concurrent A",
        },
      ],
      context,
      "session-a",
      new MockWritable(),
      async () => {},
      { ownerAgentId: "agent-a", ownerSessionId: "session-a" },
    );
    await waitFor(() => context.activeVerificationAbortControllers?.size === 1);
    const runB = runVerificationPlan(
      [
        {
          kind: "test",
          command: "node -e \"setTimeout(() => console.log('B done'), 500)\"",
          reason: "concurrent B",
        },
      ],
      context,
      "session-b",
      new MockWritable(),
      async () => {},
      { ownerAgentId: "agent-b", ownerSessionId: "session-b" },
    );
    await waitFor(() => context.activeVerificationAbortControllers?.size === 2);
    const taskA = context.backgroundTasks.find((task) => task.ownerAgentId === "agent-a");
    const taskB = context.backgroundTasks.find((task) => task.ownerAgentId === "agent-b");
    const controllerB = taskB
      ? context.activeVerificationAbortControllers?.get(taskB.id)
      : undefined;
    if (!taskA || !taskB || !controllerB) throw new Error("verification owners were not registered");

    context.activeVerificationAbortControllers?.get(taskA.id)?.abort();
    const reportA = await runA;
    expect(reportA.status).toBe("cancelled");
    expect(taskA.status).toBe("cancelled");
    expect(context.activeVerificationAbortControllers?.get(taskB.id)).toBe(controllerB);
    expect(controllerB.signal.aborted).toBe(false);

    const reportB = await runB;
    expect(reportB.status).toBe("pass");
    expect(taskB.result).toBe("pass");
    expect(context.activeVerificationAbortControllers?.size).toBe(0);
  }, 30_000);

  it("binds verifier cancellation to its owner signal without PASS evidence", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-owner-abort-"));
    const context = await createRunnableVerificationContext(projectPath);
    const ownerController = new AbortController();
    const pending = runVerificationPlan(
      [
        {
          kind: "test",
          command: "node -e \"setTimeout(() => console.log('late pass'), 500)\"",
          reason: "owner cancellation",
        },
      ],
      context,
      "agent-transcript",
      new MockWritable(),
      async () => {},
      {
        ownerAgentId: "agent-cancelled-verifier",
        ownerSessionId: "session-owner",
        ownerSignal: ownerController.signal,
      },
    );
    await waitFor(() => context.activeVerificationAbortControllers?.size === 1);
    ownerController.abort();
    const report = await pending;
    if (isCurrentVerificationReport(context, report)) {
      context.lastVerification = report;
      await recordVerificationEvidence(context, "session-owner", report);
    }

    expect(report.status).toBe("cancelled");
    expect(context.lastVerification).toBeUndefined();
    expect(context.evidence).toEqual([]);
    expect(context.backgroundTasks[0]).toMatchObject({
      ownerAgentId: "agent-cancelled-verifier",
      status: "cancelled",
      result: "cancelled",
    });
  }, 30_000);
});

class MockWritable extends Writable {
  _write(_chunk: Buffer | string, _encoding: string, callback: () => void): void {
    callback();
  }
}

function createEvidenceContext(): TuiContext {
  return {
    evidence: [],
    store: {
      appendEvent: vi.fn(async () => {}),
    },
  } as unknown as TuiContext;
}

async function createVerificationRunContext(mode: "degrade" | "stop"): Promise<TuiContext> {
  const projectPath = await mkdtemp(join(tmpdir(), `linghun-verify-${mode}-`));
  return {
    projectPath,
    config: defaultConfig,
    language: "zh-CN",
    backgroundTasks: [],
    backgroundAbortControllers: new Map(),
    evidence: [],
    cache: createCacheState(projectPath),
    hooks: await createHookState(defaultConfig, projectPath),
    store: {
      appendEvent: vi.fn(async () => {}),
    },
    lastMetaSchedulerDecision: {
      orchestrationPlan: {
        primaryAction: "verify",
        steps: [
          {
            id: "verification",
            executor: "verification-runtime",
            mode,
            reason: `${mode} requested by test`,
          },
        ],
        hardStops: mode === "stop" ? ["test_stop"] : [],
        degradationPath: mode === "degrade" ? ["test_degrade"] : [],
      },
    },
  } as unknown as TuiContext;
}

async function createRunnableVerificationContext(projectPath: string): Promise<TuiContext> {
  return {
    projectPath,
    config: defaultConfig,
    language: "zh-CN",
    backgroundTasks: [],
    backgroundAbortControllers: new Map(),
    evidence: [],
    cache: createCacheState(projectPath),
    hooks: await createHookState(defaultConfig, projectPath),
    store: {
      appendEvent: vi.fn(async () => {}),
    },
  } as unknown as TuiContext;
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("timed out waiting for verification state");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function makeReport(
  status: VerificationReport["status"],
  commands: Array<{ kind: VerificationStepKind; synthetic?: boolean }>,
): VerificationReport {
  const startedAt = new Date(0).toISOString();
  return {
    id: "verify-1",
    status,
    summary: `${status.toUpperCase()} verification`,
    commands: commands.map((command) => ({
      kind: command.kind,
      synthetic: command.synthetic,
      command: `run ${command.kind}`,
      reason: command.kind,
      status,
      exitCode: status === "pass" ? 0 : 1,
      durationMs: 1,
      summary: `${command.kind} ${status}`,
    })),
    unverified: [],
    risk: [],
    startedAt,
    endedAt: startedAt,
    durationMs: 1,
    nextAction: "done",
  };
}
