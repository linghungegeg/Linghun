import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { defaultConfig, resolveStoragePaths } from "@linghun/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { recordToolEvidence, recordVerificationEvidence } from "./evidence-runtime.js";
import { hydrateResumeContext } from "./handoff-session-runtime.js";
import type { TuiContext } from "./index.js";
import { createCacheState, createHookState } from "./index.js";
import { executeLinghunControlToolUse } from "./model-tool-runtime.js";
import { createMemoryState } from "./tui-state-runtime.js";
import { runWorkflowVerificationStep } from "./workflow-command-runtime.js";
import type { VerificationReport, VerificationStepKind } from "./tui-data-types.js";
import {
  createVerificationPlan,
  getRequestScopedVerificationChangedFiles,
  isCurrentVerificationReport,
  resolveVerificationScopeCwd,
  runVerificationCommand,
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

  it("persists request scope on Bash verification evidence", async () => {
    const context = createEvidenceContext();
    const verificationScope = {
      ownerKey: "request:session-bash:request-bash",
      cwd: "C:/repo/packages/tui",
      changedFiles: ["packages/tui/src/a.ts"],
      ownerSessionId: "session-bash",
      requestTurnId: "request-bash",
    };

    const evidence = await recordToolEvidence(
      context,
      "session-bash",
      "Bash",
      { text: "typecheck passed", data: { exitCode: 0, outcome: "completed" } } as never,
      { command: "corepack pnpm typecheck", verificationScope },
      undefined,
      "bash-verification-scope",
    );

    expect(evidence?.data).toEqual({ verificationScope });
    expect(context.evidence[0]?.data).toEqual({ verificationScope });
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

  it("does not reuse an old PASS when an owned RunVerification is interrupted", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-control-abort-"));
    await writeFile(
      join(projectPath, "package.json"),
      JSON.stringify({ scripts: { smoke: 'node -e "setTimeout(()=>{}, 1000)"' } }),
      "utf8",
    );
    const events: unknown[] = [];
    const context = await createRunnableVerificationContext(projectPath);
    context.currentRequestTurnId = "request-old";
    context.lastVerification = makeReport("pass", [{ kind: "test" }]);
    context.tools = { changedFiles: [] } as unknown as TuiContext["tools"];
    context.store = {
      appendEvent: vi.fn(async (_sessionId: string, event: unknown) => {
        events.push(event);
      }),
    } as unknown as TuiContext["store"];
    const ownerController = new AbortController();
    const pending = executeLinghunControlToolUse(
      { id: "verify-tool-old", name: "RunVerification", input: { level: "smoke" } },
      context,
      "session-owner",
      new MockWritable(),
      {
        requestTurnId: "request-old",
        abortSignal: ownerController.signal,
      } as never,
    );
    await waitFor(() => context.activeVerificationAbortControllers?.size === 1);

    context.currentRequestTurnId = "request-new";
    ownerController.abort();
    const result = await pending;

    expect(result).toMatchObject({
      ok: false,
      text: "cancelled: stale RunVerification result discarded",
    });
    expect(context.lastVerification.id).toBe("verify-1");
    expect(context.evidence).toEqual([]);
    expect(JSON.stringify(events)).not.toContain("verification_passed");
    expect(
      events.some(
        (event) =>
          typeof event === "object" &&
          event !== null &&
          (event as { type?: unknown }).type === "tool_result" &&
          (event as { toolUseId?: unknown }).toolUseId === "verify-tool-old",
      ),
    ).toBe(false);
  }, 30_000);

  it("does not revive an older PASS when resume ends with cancelled verification", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-resume-cancelled-"));
    const context = await createRunnableVerificationContext(projectPath);
    context.tools = { changedFiles: [], todos: [] } as unknown as TuiContext["tools"];
    context.memory = await createMemoryState(defaultConfig, projectPath);
    const passed = makeReport("pass", [{ kind: "test" }]);
    const cancelled = { ...makeReport("cancelled", [{ kind: "test" }]), id: "verify-cancelled" };
    context.lastVerification = passed;

    hydrateResumeContext(
      context,
      [
        { type: "verification_end", report: passed, createdAt: passed.endedAt },
        { type: "verification_end", report: cancelled, createdAt: cancelled.endedAt },
      ] as never,
    );

    expect(context.lastVerification).toBeUndefined();
  });

  it("does not restore workflow-owned verification as global resume state", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-resume-workflow-"));
    const context = await createRunnableVerificationContext(projectPath);
    context.tools = { changedFiles: [], todos: [] } as unknown as TuiContext["tools"];
    context.memory = await createMemoryState(defaultConfig, projectPath);
    const workflowReport = makeReport("pass", [{ kind: "test" }]);
    workflowReport.scope = {
      ownerKey: "workflow:session-owner:workflow-owned",
      cwd: projectPath,
      changedFiles: [],
      ownerSessionId: "session-owner",
      workflowRunId: "workflow-owned",
    };

    hydrateResumeContext(
      context,
      [{ type: "verification_end", report: workflowReport, createdAt: workflowReport.endedAt }] as never,
    );

    expect(context.lastVerification).toBeUndefined();
  });

  it("scopes a small package change to that package verification cwd", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-scope-root-"));
    const packagePath = join(projectPath, "packages", "feature");
    await mkdir(join(packagePath, "src"), { recursive: true });
    await Promise.all([
      writeFile(
        join(projectPath, "package.json"),
        JSON.stringify({
          scripts: {
            typecheck: 'node -e "throw new Error(\'root typecheck must not run\')"',
            test: 'node -e "throw new Error(\'root test must not run\')"',
            lint: 'node -e "throw new Error(\'root lint must not run\')"',
          },
        }),
        "utf8",
      ),
      writeFile(join(projectPath, "pnpm-lock.yaml"), "", "utf8"),
      writeFile(
        join(packagePath, "package.json"),
        JSON.stringify({ scripts: { typecheck: 'node -e "console.log(\'package scoped\')"' } }),
        "utf8",
      ),
      writeFile(join(packagePath, "src", "changed.ts"), "export {};\n", "utf8"),
    ]);
    const context = await createRunnableVerificationContext(projectPath);
    context.tools = {
      workspaceRoot: projectPath,
      changedFiles: ["packages/feature/src/changed.ts"],
      todos: [],
    } as unknown as TuiContext["tools"];

    const report = await runWorkflowVerificationStep(
      "focused",
      context,
      new MockWritable(),
      { ownerSessionId: "session-scope" },
    );

    expect(await resolveVerificationScopeCwd(projectPath, context.tools.changedFiles)).toBe(
      packagePath,
    );
    expect(report.status).toBe("pass");
    expect(report.scope?.cwd).toBe(packagePath);
    expect(report.commands).toHaveLength(1);
    expect(report.commands[0]?.summary).toContain("package scoped");
  }, 30_000);

  it("does not inherit global changed files into an empty current request scope", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-request-empty-"));
    const context = await createRunnableVerificationContext(projectPath);
    context.tools = {
      changedFiles: ["packages/side-agent/src/old.ts"],
      todos: [],
    } as unknown as TuiContext["tools"];
    context.currentRequestTurnId = "request-new";
    context.currentRequestChangedFiles = [];
    context.currentRequestMentionedFiles = [];

    expect(getRequestScopedVerificationChangedFiles(context)).toEqual([]);

    context.currentRequestTurnId = undefined;
    expect(getRequestScopedVerificationChangedFiles(context)).toEqual([
      "packages/side-agent/src/old.ts",
    ]);
  });

  it("keeps foreground activity and interrupt ownership while verification runs", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-activity-owner-"));
    const context = await createRunnableVerificationContext(projectPath);
    context.tools = {
      workspaceRoot: projectPath,
      changedFiles: [],
      todos: [],
    } as unknown as TuiContext["tools"];
    context.currentRequestTurnId = "request-activity";
    context.interrupt = { type: "running", taskId: "foreground-model", canCancel: true };
    context.requestActivityOwner = { kind: "foreground", requestTurnId: "request-activity" };
    context.requestActivityPhase = "checking_final_evidence";
    context.requestActivityToolUseId = "foreground-final-gate";

    await executeLinghunControlToolUse(
      { id: "verify-background-status", name: "RunVerification", input: { level: "smoke" } },
      context,
      "session-activity",
      new MockWritable(),
      { requestTurnId: "request-activity" } as never,
    );

    expect(context.interrupt).toEqual({
      type: "running",
      taskId: "foreground-model",
      canCancel: true,
    });
    expect(context.requestActivityOwner).toEqual({
      kind: "foreground",
      requestTurnId: "request-activity",
    });
    expect(context.requestActivityToolUseId).toBe("foreground-final-gate");
  }, 30_000);

  it("heartbeats a quiet verification command without taking foreground state", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-heartbeat-"));
    const context = await createRunnableVerificationContext(projectPath);
    const running = runVerificationPlan(
      [
        {
          kind: "test",
          command: 'node -e "setTimeout(()=>console.log(\'done\'), 300)"',
          reason: "quiet heartbeat",
        },
      ],
      context,
      "session-heartbeat",
      new MockWritable(),
      async () => {},
      { heartbeatIntervalMs: 20, staleAfterMs: 60 },
    );
    await waitFor(() => context.backgroundTasks.length === 1);
    const task = context.backgroundTasks[0];
    const startedAt = task.updatedAt;
    await waitFor(() => task.updatedAt !== startedAt);
    const report = await running;

    expect(report.status).toBe("pass");
    expect(task.status).toBe("completed");
  }, 30_000);

  it("does not spawn a verification command for an already cancelled owner", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-pre-abort-"));
    const controller = new AbortController();
    controller.abort();

    const result = await runVerificationCommand(
      'node -e "require(\'fs\').writeFileSync(\'should-not-exist.txt\',\'bad\')"',
      projectPath,
      controller.signal,
    );

    expect(result.outcome).toBe("cancelled");
    expect(await readdir(projectPath)).not.toContain("should-not-exist.txt");
  });

  it("discards PASS when owner cancellation wins the verification_end commit", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-pass-commit-abort-"));
    const context = await createRunnableVerificationContext(projectPath);
    const ownerController = new AbortController();
    const events: Array<{ type?: string; report?: VerificationReport }> = [];
    context.store = {
      appendEvent: vi.fn(
        async (
          _sessionId: string,
          event: { type?: string; report?: VerificationReport },
          commitGuard?: () => boolean,
        ) => {
          if (event.type === "verification_end" && event.report?.status === "pass") {
            ownerController.abort();
          }
          if (!commitGuard || commitGuard()) events.push(event);
        },
      ),
    } as unknown as TuiContext["store"];

    const report = await runVerificationPlan(
      [{ kind: "test", command: 'node -e "console.log(\'pass\')"', reason: "commit race" }],
      context,
      "session-pass-race",
      new MockWritable(),
      async () => {},
      { ownerSignal: ownerController.signal, requestTurnId: "request-pass-race" },
    );

    expect(report.status).toBe("cancelled");
    expect(events.some((event) => event.type === "verification_end" && event.report?.status === "pass"))
      .toBe(false);
    expect(events.some((event) => event.type === "verification_end" && event.report?.status === "cancelled"))
      .toBe(true);
  }, 30_000);

  it("discards PASS when a workflow owner turns terminal at commit", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-workflow-commit-"));
    const context = await createRunnableVerificationContext(projectPath);
    let workflowRunning = true;
    const events: Array<{ type?: string; report?: VerificationReport }> = [];
    context.store = {
      appendEvent: vi.fn(
        async (
          _sessionId: string,
          event: { type?: string; report?: VerificationReport },
          commitGuard?: () => boolean,
        ) => {
          if (event.type === "verification_end" && event.report?.status === "pass") {
            workflowRunning = false;
          }
          if (!commitGuard || commitGuard()) events.push(event);
        },
      ),
    } as unknown as TuiContext["store"];

    const report = await runVerificationPlan(
      [{ kind: "test", command: 'node -e "console.log(\'pass\')"', reason: "workflow race" }],
      context,
      "session-workflow-race",
      new MockWritable(),
      async () => {},
      {
        workflowRunId: "workflow-race",
        commitGuard: () => workflowRunning,
      },
    );

    expect(report.status).toBe("stale");
    expect(events.some((event) => event.type === "verification_end" && event.report?.status === "pass"))
      .toBe(false);
  }, 30_000);

  it("keeps newer verification authoritative for the same request owner", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-same-owner-"));
    const context = await createRunnableVerificationContext(projectPath);
    const owner = { ownerSessionId: "session-same-owner", requestTurnId: "request-same-owner" };
    const older = runVerificationPlan(
      [
        {
          kind: "test",
          command: 'node -e "setTimeout(()=>console.log(\'older\'), 300)"',
          reason: "older",
        },
      ],
      context,
      "session-same-owner",
      new MockWritable(),
      async () => {},
      owner,
    );
    await waitFor(() => context.activeVerificationAbortControllers?.size === 1);
    const newer = await runVerificationPlan(
      [{ kind: "test", command: 'node -e "console.log(\'newer\')"', reason: "newer" }],
      context,
      "session-same-owner",
      new MockWritable(),
      async () => {},
      owner,
    );
    const olderReport = await older;

    expect(newer.status).toBe("pass");
    expect(isCurrentVerificationReport(context, newer)).toBe(true);
    expect(olderReport.status).toBe("stale");
    expect(isCurrentVerificationReport(context, olderReport)).toBe(false);
  }, 30_000);

  it("runs workflow verification only in its owned cwd snapshot", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-workflow-main-"));
    const workflowCwd = await mkdtemp(join(tmpdir(), "linghun-verify-workflow-owned-"));
    const packageJson = JSON.stringify({
      scripts: { test: 'node -e "console.log(require(\'fs\').readFileSync(\'marker.txt\',\'utf8\'))"' },
    });
    await Promise.all([
      writeFile(join(projectPath, "package.json"), packageJson, "utf8"),
      writeFile(join(projectPath, "package-lock.json"), "", "utf8"),
      writeFile(join(projectPath, "marker.txt"), "main-workflow", "utf8"),
      writeFile(join(workflowCwd, "package.json"), packageJson, "utf8"),
      writeFile(join(workflowCwd, "package-lock.json"), "", "utf8"),
      writeFile(join(workflowCwd, "marker.txt"), "owned-workflow", "utf8"),
    ]);
    const context = await createRunnableVerificationContext(projectPath);
    context.workflows = {
      enabled: true,
      templates: [],
      disabledIds: [],
      activeRun: {
        id: "workflow-cwd",
        ownerSessionId: "session-workflow-cwd",
        cwd: workflowCwd,
        changedFiles: ["marker.txt"],
        goal: "verify workflow cwd",
        planId: "workflow-cwd-plan",
        status: "running",
        steps: [],
        startedAt: new Date().toISOString(),
        result: "partial",
      },
    };
    context.tools = {
      workspaceRoot: projectPath,
      changedFiles: [],
      todos: [],
    } as unknown as TuiContext["tools"];

    const report = await runWorkflowVerificationStep("test", context, new MockWritable(), {
      ownerSessionId: "session-workflow-cwd",
      workflowRunId: "workflow-cwd",
      cwd: workflowCwd,
      changedFiles: ["marker.txt"],
    });

    expect(report.status).toBe("pass");
    expect(report.scope).toMatchObject({ cwd: workflowCwd, workflowRunId: "workflow-cwd" });
    expect(report.commands[0]?.summary).toContain("owned-workflow");
    expect(report.commands[0]?.summary).not.toContain("main-workflow");
  }, 30_000);

  it("does not leak a workflow controller for plan-only or unavailable real-smoke", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-workflow-controller-"));
    await writeFile(join(projectPath, "package.json"), JSON.stringify({ scripts: {} }), "utf8");
    const context = await createRunnableVerificationContext(projectPath);
    context.tools = { changedFiles: [], todos: [] } as unknown as TuiContext["tools"];
    context.workflows = {
      enabled: true,
      templates: [],
      disabledIds: [],
      activeRun: {
        id: "workflow-controller",
        ownerSessionId: "session-workflow-controller",
        cwd: projectPath,
        changedFiles: [],
        goal: "controller cleanup",
        planId: "workflow-controller-plan",
        status: "running",
        steps: [],
        startedAt: new Date().toISOString(),
        result: "partial",
      },
    };

    const planOnly = await runWorkflowVerificationStep("plan-only", context, new MockWritable(), {
      ownerSessionId: "session-workflow-controller",
      workflowRunId: "workflow-controller",
    });
    const unavailable = await runWorkflowVerificationStep("real-smoke", context, new MockWritable(), {
      ownerSessionId: "session-workflow-controller",
      workflowRunId: "workflow-controller",
    });

    expect(context.backgroundAbortControllers?.has("workflow-controller")).toBe(false);
    expect(planOnly.scope).toMatchObject({ workflowRunId: "workflow-controller" });
    expect(unavailable.scope).toMatchObject({ workflowRunId: "workflow-controller" });
  });

  it("cleans a shared workflow controller when its creator finishes first", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-workflow-shared-controller-"));
    await writeFile(
      join(projectPath, "package.json"),
      JSON.stringify({
        scripts: {
          test: 'node -e "setTimeout(()=>console.log(\'test done\'),100)"',
          build: 'node -e "setTimeout(()=>console.log(\'build done\'),500)"',
        },
      }),
      "utf8",
    );
    await writeFile(join(projectPath, "package-lock.json"), "", "utf8");
    const context = await createRunnableVerificationContext(projectPath);
    context.tools = { changedFiles: [], todos: [] } as unknown as TuiContext["tools"];
    context.workflows = {
      enabled: true,
      templates: [],
      disabledIds: [],
      activeRun: {
        id: "workflow-shared-controller",
        ownerSessionId: "session-workflow-shared-controller",
        cwd: projectPath,
        changedFiles: [],
        goal: "shared controller cleanup",
        planId: "workflow-shared-controller-plan",
        status: "running",
        steps: [],
        startedAt: new Date().toISOString(),
        result: "partial",
      },
    };
    const first = runWorkflowVerificationStep("test", context, new MockWritable(), {
      ownerSessionId: "session-workflow-shared-controller",
      workflowRunId: "workflow-shared-controller",
    });
    await waitFor(() => context.backgroundAbortControllers?.has("workflow-shared-controller") === true);
    const sharedSignal = context.backgroundAbortControllers?.get("workflow-shared-controller")?.signal;
    const second = runWorkflowVerificationStep("build", context, new MockWritable(), {
      ownerSessionId: "session-workflow-shared-controller",
      ownerSignal: sharedSignal,
      workflowRunId: "workflow-shared-controller",
    });
    await waitFor(
      () =>
        context.backgroundTasks.filter(
          (task) => task.kind === "verification" && task.status === "running",
        ).length === 2,
    );

    await Promise.all([first, second]);

    expect(context.backgroundAbortControllers?.has("workflow-shared-controller")).toBe(false);
  }, 30_000);

  it("keeps a shared workflow controller until terminal verification commits", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-workflow-commit-controller-"));
    await writeFile(
      join(projectPath, "package.json"),
      JSON.stringify({
        scripts: {
          test: 'node -e "setTimeout(()=>console.log(\'test done\'),200)"',
          build: 'node -e "console.log(\'build done\')"',
        },
      }),
      "utf8",
    );
    await writeFile(join(projectPath, "package-lock.json"), "", "utf8");
    const context = await createRunnableVerificationContext(projectPath);
    context.tools = { changedFiles: [], todos: [] } as unknown as TuiContext["tools"];
    context.workflows = {
      enabled: true,
      templates: [],
      disabledIds: [],
      activeRun: {
        id: "workflow-commit-controller",
        ownerSessionId: "session-workflow-commit-controller",
        cwd: projectPath,
        changedFiles: [],
        goal: "shared controller commit guard",
        planId: "workflow-commit-controller-plan",
        status: "running",
        steps: [],
        startedAt: new Date().toISOString(),
        result: "partial",
      },
    };
    let releaseCommit!: () => void;
    let reachCommit!: () => void;
    const commitGate = new Promise<void>((resolveCommit) => {
      releaseCommit = resolveCommit;
    });
    const commitReached = new Promise<void>((resolveReached) => {
      reachCommit = resolveReached;
    });
    context.store = {
      appendEvent: vi.fn(
        async (
          _sessionId: string,
          event: { type?: string; report?: VerificationReport },
          commitGuard?: () => boolean,
        ) => {
          if (
            event.type === "verification_end" &&
            event.report?.status === "pass" &&
            event.report.commands[0]?.kind === "build"
          ) {
            reachCommit();
            await commitGate;
          }
          commitGuard?.();
        },
      ),
    } as unknown as TuiContext["store"];

    const first = runWorkflowVerificationStep("test", context, new MockWritable(), {
      ownerSessionId: "session-workflow-commit-controller",
      workflowRunId: "workflow-commit-controller",
    });
    await waitFor(() => context.backgroundAbortControllers?.has("workflow-commit-controller") === true);
    const sharedController = context.backgroundAbortControllers?.get("workflow-commit-controller");
    const second = runWorkflowVerificationStep("build", context, new MockWritable(), {
      ownerSessionId: "session-workflow-commit-controller",
      ownerSignal: sharedController?.signal,
      workflowRunId: "workflow-commit-controller",
    });
    await commitReached;
    const firstReport = await first;

    expect(firstReport.status).toBe("stale");
    expect(context.backgroundAbortControllers?.get("workflow-commit-controller")).toBe(
      sharedController,
    );
    sharedController?.abort();
    releaseCommit();
    const secondReport = await second;

    expect(secondReport.status).toBe("cancelled");
    expect(context.backgroundAbortControllers?.has("workflow-commit-controller")).toBe(false);
  }, 30_000);

  it("does not spawn workflow verification after its owner is already cancelled", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-workflow-pre-cancel-"));
    await writeFile(
      join(projectPath, "package.json"),
      JSON.stringify({
        scripts: {
          smoke: 'node -e "require(\'fs\').writeFileSync(\'should-not-run.txt\',\'bad\')"',
        },
      }),
      "utf8",
    );
    const context = await createRunnableVerificationContext(projectPath);
    context.tools = { changedFiles: [], todos: [] } as unknown as TuiContext["tools"];
    const ownerController = new AbortController();
    ownerController.abort();
    context.workflows = {
      enabled: true,
      templates: [],
      disabledIds: [],
      activeRun: {
        id: "workflow-pre-cancel",
        ownerSessionId: "session-workflow-pre-cancel",
        cwd: projectPath,
        changedFiles: [],
        goal: "cancel before verifier spawn",
        planId: "workflow-pre-cancel-plan",
        status: "cancelled",
        steps: [],
        startedAt: new Date().toISOString(),
        result: "cancelled",
      },
    };

    const report = await runWorkflowVerificationStep("smoke", context, new MockWritable(), {
      ownerSessionId: "session-workflow-pre-cancel",
      ownerSignal: ownerController.signal,
      workflowRunId: "workflow-pre-cancel",
    });

    expect(report.status).toBe("cancelled");
    expect(await readdir(projectPath)).not.toContain("should-not-run.txt");
    expect(context.lastVerification).toBeUndefined();
    expect(context.evidence).toEqual([]);
  });
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
