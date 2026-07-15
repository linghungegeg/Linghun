import { mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { defaultConfig, resolveStoragePaths } from "@linghun/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { recordToolEvidence, recordVerificationEvidence } from "./evidence-runtime.js";
import { hydrateResumeContext } from "./handoff-session-runtime.js";
import type { TuiContext } from "./index.js";
import { createCacheState, createHookState } from "./index.js";
import { createIndexState } from "./index-runtime.js";
import { executeLinghunControlToolUse } from "./model-tool-runtime.js";
import { handleVerifyCommand } from "./slash-command-runtime.js";
import { createMemoryState } from "./tui-state-runtime.js";
import { createEvidenceBackedMemoryCandidates } from "./tui-memory-runtime.js";
import { parseUserActionConstraints } from "./user-action-constraints.js";
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

    it("prefers smoke over build as the focused fallback", async () => {
      const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-focused-fallback-"));
      await writeFile(
        join(projectPath, "package.json"),
        JSON.stringify({ scripts: { build: "node build.mjs", smoke: "node smoke.mjs" } }),
        "utf8",
      );
      await writeFile(join(projectPath, "pnpm-lock.yaml"), "", "utf8");

      const plan = await createVerificationPlan(projectPath, "focused");

      expect(plan).toHaveLength(1);
      expect(plan[0]?.kind).toBe("smoke");
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

    it("combines package typecheck with an exact root-owned Vitest target", async () => {
      const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-focused-root-test-"));
      const packagePath = join(projectPath, "packages", "feature");
      await mkdir(join(packagePath, "src"), { recursive: true });
      await Promise.all([
        writeFile(
          join(projectPath, "package.json"),
          JSON.stringify({ scripts: { test: "vitest run" } }),
          "utf8",
        ),
        writeFile(join(projectPath, "package-lock.json"), "", "utf8"),
        writeFile(
          join(packagePath, "package.json"),
          JSON.stringify({ scripts: { typecheck: "tsc --noEmit" } }),
          "utf8",
        ),
        writeFile(join(packagePath, "src", "feature.ts"), "export {};\n", "utf8"),
        writeFile(join(packagePath, "src", "feature.test.ts"), "export {};\n", "utf8"),
      ]);

      const plan = await createVerificationPlan(projectPath, "focused", {
        workspaceRoot: projectPath,
        changedFiles: ["packages/feature/src/feature.ts"],
      });

      expect(plan).toEqual([
        expect.objectContaining({
          kind: "typecheck",
          command: "npm run typecheck",
          cwd: packagePath,
        }),
        expect.objectContaining({
          kind: "test",
          command: "npm run test -- packages/feature/src/feature.test.ts",
          cwd: projectPath,
        }),
      ]);
      expect(plan.every((step) => step.coverageGap === undefined)).toBe(true);
    });

    it("keeps multiple changed packages package-scoped instead of falling back to root full scripts", async () => {
      const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-focused-multi-"));
      await Promise.all([
        writeFile(
          join(projectPath, "package.json"),
          JSON.stringify({
            scripts: {
              typecheck: "root-full-typecheck",
              test: "vitest run",
              lint: "root-full-lint",
            },
          }),
          "utf8",
        ),
        writeFile(join(projectPath, "pnpm-lock.yaml"), "", "utf8"),
      ]);
      for (const name of ["alpha", "beta"]) {
        const packagePath = join(projectPath, "packages", name);
        await mkdir(join(packagePath, "src"), { recursive: true });
        await Promise.all([
          writeFile(
            join(packagePath, "package.json"),
            JSON.stringify({ scripts: { typecheck: "tsc --noEmit" } }),
            "utf8",
          ),
          writeFile(join(packagePath, "src", `${name}.ts`), "export {};\n", "utf8"),
          writeFile(join(packagePath, "src", `${name}.test.ts`), "export {};\n", "utf8"),
        ]);
      }

      const plan = await createVerificationPlan(projectPath, "focused", {
        workspaceRoot: projectPath,
        changedFiles: ["packages/alpha/src/alpha.ts", "packages/beta/src/beta.ts"],
      });

      expect(plan.filter((step) => step.kind === "typecheck")).toHaveLength(2);
      expect(plan.filter((step) => step.kind === "test")).toHaveLength(2);
      expect(plan.filter((step) => step.kind === "test").map((step) => step.command)).toEqual([
        "corepack pnpm test packages/alpha/src/alpha.test.ts",
        "corepack pnpm test packages/beta/src/beta.test.ts",
      ]);
      expect(plan.some((step) => step.cwd === projectPath && step.command === "corepack pnpm typecheck"))
        .toBe(false);
      expect(plan.some((step) => step.command === "corepack pnpm test")).toBe(false);
      expect(plan.some((step) => step.command.includes("root-full"))).toBe(false);
    });

    it("allows root verification fallback for root-owned verification config changes", async () => {
      const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-focused-root-config-"));
      await Promise.all([
        writeFile(
          join(projectPath, "package.json"),
          JSON.stringify({ scripts: { typecheck: "tsc -b", test: "vitest run", lint: "biome lint ." } }),
          "utf8",
        ),
        writeFile(join(projectPath, "pnpm-lock.yaml"), "", "utf8"),
        writeFile(join(projectPath, "vitest.config.ts"), "export default {};\n", "utf8"),
      ]);

      const plan = await createVerificationPlan(projectPath, "focused", {
        workspaceRoot: projectPath,
        changedFiles: ["vitest.config.ts"],
      });

      expect(plan.map((step) => step.kind)).toEqual(["typecheck", "test", "lint"]);
      expect(plan.every((step) => step.cwd === projectPath)).toBe(true);
    });

    it("never interpolates unsafe or escaping changed paths into focused commands", async () => {
      const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-focused-unsafe-"));
      await Promise.all([
        writeFile(
          join(projectPath, "package.json"),
          JSON.stringify({ scripts: { test: "vitest run", typecheck: "tsc -b" } }),
          "utf8",
        ),
        writeFile(join(projectPath, "pnpm-lock.yaml"), "", "utf8"),
      ]);

      const plan = await createVerificationPlan(projectPath, "focused", {
        workspaceRoot: projectPath,
        changedFiles: ["src/value.ts;echo-owned", "../escape.test.ts"],
      });
      const commands = plan.map((step) => step.command).join("\n");

      expect(commands).not.toContain("echo-owned");
      expect(commands).not.toContain("escape.test.ts");
      expect(plan[0]?.coverageGap).toContain("outside the workspace or unsafe");
      expect(plan[0]?.coverageGap).toContain("No relevant focused test");
    });

    it("keeps a 100-package 1,000-path focused plan linear and deduplicated", async () => {
      const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-focused-pressure-"));
      await Promise.all([
        writeFile(join(projectPath, "package.json"), JSON.stringify({ scripts: {} }), "utf8"),
        writeFile(join(projectPath, "pnpm-lock.yaml"), "", "utf8"),
      ]);
      const changedFiles: string[] = [];
      for (let packageIndex = 0; packageIndex < 100; packageIndex += 1) {
        const packagePath = join(projectPath, "packages", `package-${packageIndex}`);
        await mkdir(join(packagePath, "src"), { recursive: true });
        await writeFile(
          join(packagePath, "package.json"),
          JSON.stringify({ scripts: { typecheck: "tsc --noEmit" } }),
          "utf8",
        );
        for (let fileIndex = 0; fileIndex < 10; fileIndex += 1) {
          changedFiles.push(`packages/package-${packageIndex}/src/file-${fileIndex}.ts`);
        }
      }

      const plan = await createVerificationPlan(projectPath, "focused", {
        workspaceRoot: projectPath,
        changedFiles,
      });
      const keys = plan.map((step) => `${step.kind}:${step.cwd}:${step.command}`);

      expect(changedFiles).toHaveLength(1_000);
      expect(plan).toHaveLength(100);
      expect(new Set(keys).size).toBe(plan.length);
    }, 30_000);

    it("treats an explicitly empty changed-files scope as no focused plan", async () => {
      const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-focused-empty-plan-"));
      await writeFile(
        join(projectPath, "package.json"),
        JSON.stringify({ scripts: { typecheck: "root-full-typecheck", test: "vitest run" } }),
        "utf8",
      );

      await expect(createVerificationPlan(projectPath, "focused", {
        workspaceRoot: projectPath,
        changedFiles: [],
      })).resolves.toEqual([]);
    });

    it("rejects a focused package reached through an escaping symlink or junction", async () => {
      const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-focused-link-root-"));
      const externalPath = await mkdtemp(join(tmpdir(), "linghun-verify-focused-link-external-"));
      const linkedPackage = join(projectPath, "packages", "linked");
      await mkdir(join(projectPath, "packages"), { recursive: true });
      await mkdir(join(externalPath, "src"), { recursive: true });
      await Promise.all([
        writeFile(join(projectPath, "package.json"), JSON.stringify({ scripts: {} }), "utf8"),
        writeFile(join(projectPath, "pnpm-lock.yaml"), "", "utf8"),
        writeFile(
          join(externalPath, "package.json"),
          JSON.stringify({ scripts: { test: "node outside-workspace.js" } }),
          "utf8",
        ),
        writeFile(join(externalPath, "src", "changed.ts"), "export {};\n", "utf8"),
      ]);
      await symlink(externalPath, linkedPackage, process.platform === "win32" ? "junction" : "dir");

      const plan = await createVerificationPlan(projectPath, "focused", {
        workspaceRoot: projectPath,
        changedFiles: ["packages/linked/src/changed.ts"],
      });

      expect(plan).toEqual([]);
      expect(plan.some((step) => step.command.includes("outside-workspace"))).toBe(false);
    });
  });

  it("returns PARTIAL when the runner is directly given an empty plan", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-empty-runner-"));
    const context = await createRunnableVerificationContext(projectPath);

    const report = await runVerificationPlan(
      [],
      context,
      "session-empty-runner",
      new MockWritable(),
      async () => {},
    );

    expect(report.status).toBe("partial");
    expect(report.commands).toEqual([]);
    expect(report.unverified).toContain("verification plan contained no executable steps");
  });

  it("filters only forbidden verification kinds at the runner execution boundary", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-kind-filter-"));
    const context = await createRunnableVerificationContext(projectPath);
    const report = await runVerificationPlan(
      [
        {
          kind: "test",
          command: `node -e "require('fs').writeFileSync('test-ran.txt','ok')"`,
          reason: "allowed test",
        },
        {
          kind: "build",
          command: `node -e "require('fs').writeFileSync('build-ran.txt','bad')"`,
          reason: "forbidden build",
        },
      ],
      context,
      "session-kind-filter",
      new MockWritable(),
      async () => {},
      { userActionConstraints: parseUserActionConstraints("不要 build") },
    );

    expect(report.status).toBe("partial");
    expect(report.commands.map((command) => command.kind)).toEqual(["test"]);
    expect(await readdir(projectPath)).toContain("test-ran.txt");
    expect(await readdir(projectPath)).not.toContain("build-ran.txt");
    expect(report.unverified.join(" ")).toContain("build skipped");
  });

  it("returns PARTIAL without spawning when every verification kind is filtered", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-all-filtered-"));
    const context = await createRunnableVerificationContext(projectPath);
    const report = await runVerificationPlan(
      [
        {
          kind: "smoke",
          command: `node -e "require('fs').writeFileSync('smoke-ran.txt','bad')"`,
          reason: "forbidden smoke",
        },
      ],
      context,
      "session-all-filtered",
      new MockWritable(),
      async () => {},
      { userActionConstraints: parseUserActionConstraints("不要 smoke") },
    );

    expect(report).toMatchObject({ status: "partial", commands: [] });
    expect(await readdir(projectPath)).not.toContain("smoke-ran.txt");
  });

  it.each([
    ["default", "partial", false],
    ["plan", "partial", false],
    ["auto-review", "pass", true],
    ["full-access", "pass", true],
  ] as const)(
    "uses the existing Bash permission decision for model-side verification in %s mode",
    async (permissionMode, expectedStatus, shouldRun) => {
      const projectPath = await mkdtemp(join(tmpdir(), `linghun-verify-permission-${permissionMode}-`));
      await writeFile(
        join(projectPath, "package.json"),
        JSON.stringify({ scripts: { test: "node -e \"require('fs').writeFileSync('ran.txt','ok')\"" } }),
        "utf8",
      );
      await writeFile(join(projectPath, "package-lock.json"), "", "utf8");
      const context = await createRunnableVerificationContext(projectPath);
      const plan = (await createVerificationPlan(projectPath, "default")).filter(
        (step) => step.kind === "test",
      );
      const report = await runVerificationPlan(
        plan,
        context,
        `session-permission-${permissionMode}`,
        new MockWritable(),
        async () => {},
        { permissionMode },
      );

      expect(report.status).toBe(expectedStatus);
      expect((await readdir(projectPath)).includes("ran.txt")).toBe(shouldRun);
      if (!shouldRun) {
        expect(report.commands).toEqual([]);
        expect(report.unverified.join(" ")).toContain("Bash permission");
      }
    },
  );

  it("does not let model RunVerification bypass default Bash permission", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-model-permission-"));
    await writeFile(
      join(projectPath, "package.json"),
      JSON.stringify({ scripts: { test: "node -e \"require('fs').writeFileSync('ran.txt','bad')\"" } }),
      "utf8",
    );
    await writeFile(join(projectPath, "package-lock.json"), "", "utf8");
    const context = await createRunnableVerificationContext(projectPath);
    context.permissionMode = "default";
    context.currentRequestTurnId = "request-model-permission";

    const result = await executeLinghunControlToolUse(
      { id: "verify-model-permission", name: "RunVerification", input: { level: "test" } },
      context,
      "session-model-permission",
      new MockWritable(),
      { requestTurnId: "request-model-permission" } as never,
    );

    expect(result).toMatchObject({ ok: false, data: { status: "partial", commands: [] } });
    expect(result.text).toContain("Bash");
    expect(await readdir(projectPath)).not.toContain("ran.txt");
    expect(context.activeVerificationAbortControllers?.size ?? 0).toBe(0);
    expect(context.lastVerification?.status).toBe("partial");
  });

  it("propagates workflow invocation constraints into the runner without widening them", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-workflow-constraints-"));
    await writeFile(
      join(projectPath, "package.json"),
      JSON.stringify({ scripts: { build: "node -e \"require('fs').writeFileSync('built.txt','bad')\"" } }),
      "utf8",
    );
    await writeFile(join(projectPath, "package-lock.json"), "", "utf8");
    const context = await createRunnableVerificationContext(projectPath);
    const report = await runWorkflowVerificationStep("build", context, new MockWritable(), {
      ownerSessionId: "session-workflow-constraints",
      permissionMode: "full-access",
      userActionConstraints: parseUserActionConstraints("不要 build，但可以 typecheck"),
    });

    expect(report).toMatchObject({ status: "partial", commands: [] });
    expect(report.unverified.join(" ")).toContain("build skipped");
    expect(await readdir(projectPath)).not.toContain("built.txt");
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
    const report = await runVerificationPlan(plan, context, "session-1", output, async () => {});

    expect(report.status).toBe("partial");
    expect(report.commands).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "pass", synthetic: true })]),
    );
    expect(report.summary).toContain("synthetic self-check 已通过");
    expect(report.unverified.join(" ")).toContain("real verification did not run");

    const logRoot = join(resolveStoragePaths(defaultConfig, projectPath).logs, "verification");
    expect(logRoot).toContain(isolatedDataDir);
    expect(logRoot).not.toContain(join(projectPath, ".linghun"));
    const files = await readdir(logRoot);
    expect(files.some((file) => file.endsWith("-smoke.log"))).toBe(true);
    await expect(readdir(join(projectPath, ".linghun", "logs", "verification"))).rejects.toThrow();
  });

  it("returns synthetic RunVerification to the model as partial rather than ok", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-synthetic-tool-"));
    const context = await createRunnableVerificationContext(projectPath);
    context.currentRequestTurnId = "request-synthetic";
    context.tools = { changedFiles: [], todos: [] } as unknown as TuiContext["tools"];

    const result = await executeLinghunControlToolUse(
      { id: "verify-synthetic", name: "RunVerification", input: { level: "smoke" } },
      context,
      "session-synthetic",
      new MockWritable(),
      { requestTurnId: "request-synthetic" } as never,
    );

    expect(result.ok).toBe(false);
    expect(result.data).toMatchObject({
      status: "partial",
      commands: [expect.objectContaining({ status: "pass", synthetic: true })],
    });
    expect(result.text).toContain("PARTIAL");
    expect(context.lastVerification?.status).toBe("partial");
    expect(context.evidence.flatMap((item) => item.supportsClaims)).not.toContain(
      "verification_passed",
    );
  });

  it("does not turn synthetic self-check diagnostics into memory candidates", () => {
    const report = makeReport("pass", [{ kind: "smoke", synthetic: true }]);
    const candidates = createEvidenceBackedMemoryCandidates({
      memory: { candidates: [], accepted: [], disabled: [] },
      evidence: [
        {
          id: "synthetic-evidence",
          kind: "test_result",
          summary: "SELF-CHECK synthetic self-check passed",
          source: "Verification Runner",
          supportsClaims: ["verification_self_check_passed", "verification_not_run"],
          createdAt: new Date().toISOString(),
        },
      ],
      tools: { todos: [] },
      lastVerification: report,
    } as unknown as TuiContext);

    expect(candidates).toEqual([]);
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

  it("does not let meta orchestration re-plan or truncate verification steps", async () => {
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
          command: "node -e \"console.log('second')\"",
          reason: "second step",
        },
      ],
      context,
      "session-1",
      new MockWritable(),
      async () => {},
    );

    expect(report.status).toBe("pass");
    expect(report.commands).toHaveLength(2);
    expect(report.unverified.join("\n")).not.toContain("meta orchestration degrade skipped");
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
    const commandLogs = await Promise.all(
      report.commands.map((command) => readFile(command.logPath!, "utf8")),
    );
    expect(commandLogs.join("\n")).toContain("worktree-marker");
    expect(commandLogs.join("\n")).not.toContain("main-marker");
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
    const registeredControllerB = context.activeVerificationAbortControllers?.get(taskB.id);
    if (registeredControllerB) {
      expect(registeredControllerB).toBe(controllerB);
    }
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
        JSON.stringify({
          scripts: {
            typecheck: 'node -e "console.log(\'package scoped typecheck\')"',
            test: 'node -e "console.log(\'package scoped test\')"',
          },
        }),
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
    expect(report.commands).toHaveLength(2);
    expect(report.commands.every((command) => command.status === "pass" && command.cwd === packagePath))
      .toBe(true);
  }, 30_000);

  it("returns PARTIAL when focused typecheck has no relevant test target", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-focused-gap-"));
    const packagePath = join(projectPath, "packages", "feature");
    await mkdir(join(packagePath, "src"), { recursive: true });
    await Promise.all([
      writeFile(
        join(projectPath, "package.json"),
        JSON.stringify({ scripts: { test: "vitest run" } }),
        "utf8",
      ),
      writeFile(join(projectPath, "pnpm-lock.yaml"), "", "utf8"),
      writeFile(
        join(packagePath, "package.json"),
        JSON.stringify({ scripts: { typecheck: 'node -e "console.log(\'typed\')"' } }),
        "utf8",
      ),
      writeFile(join(packagePath, "src", "feature.ts"), "export {};\n", "utf8"),
    ]);
    const context = await createRunnableVerificationContext(projectPath);
    context.currentRequestTurnId = "focused-gap-request";
    context.currentRequestChangedFiles = ["packages/feature/src/feature.ts"];

    const report = await runWorkflowVerificationStep(
      "focused",
      context,
      new MockWritable(),
      { ownerSessionId: "session-focused-gap", requestTurnId: "focused-gap-request" },
    );

    expect(report.status).toBe("partial");
    expect(report.commands).toHaveLength(1);
    expect(report.commands[0]?.status).toBe("pass");
    expect(report.unverified).toEqual([
      expect.stringContaining("No relevant focused test was found"),
    ]);
  }, 30_000);

  it("runs scoped test verification through the focused targeted plan instead of the root test script", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-scoped-test-"));
    const target = "packages/tui/src/shell/view-model.test.ts";
    await mkdir(join(projectPath, "packages", "tui", "src", "shell"), { recursive: true });
    await Promise.all([
      writeFile(
        join(projectPath, "package.json"),
        JSON.stringify({ scripts: { test: "node test-runner.cjs vitest" } }),
        "utf8",
      ),
      writeFile(join(projectPath, "pnpm-lock.yaml"), "", "utf8"),
      writeFile(
        join(projectPath, "test-runner.cjs"),
        [
          `const target = ${JSON.stringify(target)};`,
          "if (!process.argv.includes(target)) {",
          "  console.error(`missing focused target ${target}`);",
          "  process.exit(1);",
          "}",
          "console.log(`focused target ${target}`);",
        ].join("\n"),
        "utf8",
      ),
      writeFile(join(projectPath, target), "export {};\n", "utf8"),
    ]);
    const context = await createRunnableVerificationContext(projectPath);
    context.currentRequestTurnId = "scoped-test-request";
    context.currentRequestChangedFiles = [target];

    const report = await runWorkflowVerificationStep(
      "test",
      context,
      new MockWritable(),
      { ownerSessionId: "session-scoped-test", requestTurnId: "scoped-test-request" },
    );

    expect(report.status).toBe("pass");
    expect(report.commands).toHaveLength(1);
    expect(report.commands[0]?.kind).toBe("test");
    expect(report.commands[0]?.command).toContain(target);
    expect(report.commands[0]?.command).not.toBe("corepack pnpm test");
    expect(report.scope?.changedFiles).toEqual([target]);
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

  it("keeps slash, workflow, and RunVerification empty request scopes PARTIAL", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-empty-entries-"));
    await writeFile(
      join(projectPath, "package.json"),
      JSON.stringify({ scripts: { typecheck: "root-full-typecheck", test: "vitest run" } }),
      "utf8",
    );

    const slashContext = await createRunnableVerificationContext(projectPath);
    slashContext.sessionId = "session-empty-slash";
    slashContext.sessionStoreVerifiedId = "session-empty-slash";
    slashContext.currentRequestTurnId = "request-empty-slash";
    slashContext.currentRequestChangedFiles = [];
    slashContext.currentRequestMentionedFiles = [];
    slashContext.memory = await createMemoryState(defaultConfig, projectPath);
    slashContext.index = createIndexState(defaultConfig);
    slashContext.tools = { changedFiles: ["old-global.ts"], todos: [] } as unknown as TuiContext["tools"];
    await handleVerifyCommand(["focused"], slashContext, new MockWritable());
    expect(slashContext.lastVerification).toMatchObject({ status: "partial", commands: [] });

    const workflowContext = await createRunnableVerificationContext(projectPath);
    workflowContext.currentRequestTurnId = "request-empty-workflow";
    workflowContext.currentRequestChangedFiles = [];
    workflowContext.currentRequestMentionedFiles = [];
    const workflowReport = await runWorkflowVerificationStep(
      "focused",
      workflowContext,
      new MockWritable(),
      { ownerSessionId: "session-empty-workflow", requestTurnId: "request-empty-workflow" },
    );
    expect(workflowReport).toMatchObject({ status: "partial", commands: [] });

    const toolContext = await createRunnableVerificationContext(projectPath);
    toolContext.currentRequestTurnId = "request-empty-tool";
    toolContext.currentRequestChangedFiles = [];
    toolContext.currentRequestMentionedFiles = [];
    toolContext.tools = {
      changedFiles: [],
      todos: [],
      abortSignal: new AbortController().signal,
    } as unknown as TuiContext["tools"];
    const toolResult = await executeLinghunControlToolUse(
      { id: "verify-empty-tool", name: "RunVerification", input: { level: "focused" } },
      toolContext,
      "session-empty-tool",
      new MockWritable(),
      { requestTurnId: "request-empty-tool" } as never,
    );
    expect(toolResult).toMatchObject({
      ok: false,
      data: { status: "partial", level: "focused" },
    });
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
    expect(result).not.toHaveProperty("exitCode");
    expect(await readdir(projectPath)).not.toContain("should-not-exist.txt");
  });

  it("does not synthesize an exit code and confirms timeout process termination", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-timeout-stop-"));
    const result = await runVerificationCommand(
      'node -e "setTimeout(()=>require(\'fs\').writeFileSync(\'timeout-sentinel.txt\',\'late\'),1500)"',
      projectPath,
      undefined,
      25,
    );

    expect(result.outcome).toBe("timeout");
    expect(result).not.toHaveProperty("exitCode");
    await new Promise((resolve) => setTimeout(resolve, 1_700));
    expect(await readdir(projectPath)).not.toContain("timeout-sentinel.txt");
  });

  it("does not synthesize an exit code and confirms cancelled process termination", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-cancel-stop-"));
    const controller = new AbortController();
    const running = runVerificationCommand(
      'node -e "setTimeout(()=>require(\'fs\').writeFileSync(\'cancel-sentinel.txt\',\'late\'),1500)"',
      projectPath,
      controller.signal,
    );
    setTimeout(() => controller.abort(), 25);
    const result = await running;

    expect(result.outcome).toBe("cancelled");
    expect(result).not.toHaveProperty("exitCode");
    await new Promise((resolve) => setTimeout(resolve, 1_700));
    expect(await readdir(projectPath)).not.toContain("cancel-sentinel.txt");
  });

  it("discards PASS when owner cancellation wins the verification_end commit", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-pass-commit-abort-"));
    const context = await createRunnableVerificationContext(projectPath);
    const ownerController = new AbortController();
    const events: Array<{
      type?: string;
      report?: VerificationReport;
      task?: { result?: string };
    }> = [];
    context.store = {
      appendEvent: vi.fn(
        async (
          _sessionId: string,
          event: {
            type?: string;
            report?: VerificationReport;
            task?: { result?: string };
          },
          commitGuard?: () => boolean,
        ) => {
          if (event.type === "background_task_update" && event.task?.result === "pass") {
            ownerController.abort();
          }
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
      async (targetContext, targetSessionId, task, commitGuard) => {
        await targetContext.store.appendEvent(
          targetSessionId,
          {
            type: "background_task_update",
            task,
            createdAt: new Date().toISOString(),
          },
          commitGuard,
        );
      },
      { ownerSignal: ownerController.signal, requestTurnId: "request-pass-race" },
    );

    expect(report.status).toBe("cancelled");
    expect(events.some((event) => event.type === "verification_end" && event.report?.status === "pass"))
      .toBe(false);
    expect(events.some((event) => event.type === "verification_end" && event.report?.status === "cancelled"))
      .toBe(true);
    expect(
      events.some(
        (event) => event.type === "background_task_update" && event.task?.result === "pass",
      ),
    ).toBe(false);
  }, 30_000);

  it("finalizes the task when verification persistence throws", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-persist-failure-"));
    const context = await createRunnableVerificationContext(projectPath);
    const events: Array<{ type?: string; report?: VerificationReport }> = [];
    let failedStart = false;
    context.store = {
      appendEvent: vi.fn(async (_sessionId: string, event: { type?: string; report?: VerificationReport }) => {
        if (event.type === "verification_start" && !failedStart) {
          failedStart = true;
          throw new Error("persist start failed");
        }
        events.push(event);
      }),
    } as unknown as TuiContext["store"];

    const report = await runVerificationPlan(
      [{ kind: "test", command: 'node -e "console.log(\'unused\')"', reason: "persist failure" }],
      context,
      "session-persist-failure",
      new MockWritable(),
      async () => {},
      { requestTurnId: "request-persist-failure" },
    );

    expect(report.status).toBe("partial");
    expect(report.unverified.join(" ")).toContain("persist start failed");
    const task = context.backgroundTasks.find((item) => item.id === report.id);
    expect(task?.status).not.toBe("running");
    expect(task?.result).toBe("partial");
    expect(events.some((event) => event.type === "verification_end" && event.report?.status === "partial"))
      .toBe(true);
    expect(context.activeVerificationAbortControllers?.has(report.id)).toBe(false);
  });

  it("does not replace the authoritative verification run when pre-registration meta persistence fails", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-meta-failure-"));
    const context = await createRunnableVerificationContext(projectPath);
    context.latestVerificationRunId = "existing-run";
    context.latestVerificationRunIds = new Map([["session:session-meta-failure", "existing-run"]]);
    context.store = {
      appendEvent: vi.fn(async () => {
        throw new Error("meta persist failed");
      }),
    } as unknown as TuiContext["store"];

    await expect(
      runVerificationPlan(
        [{ kind: "test", command: 'node -e "console.log(\'unused\')"', reason: "meta failure" }],
        context,
        "session-meta-failure",
        new MockWritable(),
        async () => {},
      ),
    ).rejects.toThrow("meta persist failed");

    expect(context.latestVerificationRunId).toBe("existing-run");
    expect(context.latestVerificationRunIds.get("session:session-meta-failure")).toBe("existing-run");
    expect(context.backgroundTasks).toHaveLength(0);
    expect(context.activeVerificationAbortControllers?.size ?? 0).toBe(0);
  });

  it("persists the downgraded terminal task when verification_end fails once", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-end-retry-"));
    const context = await createRunnableVerificationContext(projectPath);
    const events: Array<{ type?: string; report?: VerificationReport; task?: { result?: string } }> = [];
    let failedEnd = false;
    context.store = {
      appendEvent: vi.fn(async (_sessionId: string, event: { type?: string; report?: VerificationReport; task?: { result?: string } }) => {
        if (event.type === "verification_end" && event.report?.status === "pass" && !failedEnd) {
          failedEnd = true;
          throw new Error("persist end failed once");
        }
        events.push(structuredClone(event));
      }),
    } as unknown as TuiContext["store"];

    const report = await runVerificationPlan(
      [{ kind: "test", command: 'node -e "console.log(\'pass\')"', reason: "end retry" }],
      context,
      "session-end-retry",
      new MockWritable(),
      async (targetContext, targetSessionId, task) => {
        await targetContext.store.appendEvent(targetSessionId, {
          type: "background_task_update",
          task,
          createdAt: new Date().toISOString(),
        });
      },
      { requestTurnId: "request-end-retry" },
    );

    expect(report.status).toBe("partial");
    expect(events.some((event) => event.type === "verification_end" && event.report?.status === "pass"))
      .toBe(false);
    expect(events.some((event) => event.type === "verification_end" && event.report?.status === "partial"))
      .toBe(true);
    const terminalTasks = events.filter((event) => event.type === "background_task_update");
    expect(terminalTasks.at(-1)?.task?.result).toBe("partial");
  }, 30_000);

  it("retries a failed terminal background task update without leaving running authoritative", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-task-retry-"));
    const context = await createRunnableVerificationContext(projectPath);
    const events: Array<{ type?: string; report?: VerificationReport; task?: { status?: string; result?: string } }> = [];
    let failedTerminalTask = false;
    context.store = {
      appendEvent: vi.fn(async (_sessionId: string, event: { type?: string; report?: VerificationReport; task?: { status?: string; result?: string } }) => {
        if (
          event.type === "background_task_update" &&
          event.task?.status !== "running" &&
          !failedTerminalTask
        ) {
          failedTerminalTask = true;
          throw new Error("persist terminal task failed once");
        }
        events.push(structuredClone(event));
      }),
    } as unknown as TuiContext["store"];

    const report = await runVerificationPlan(
      [{ kind: "test", command: 'node -e "console.log(\'pass\')"', reason: "task retry" }],
      context,
      "session-task-retry",
      new MockWritable(),
      async (targetContext, targetSessionId, task) => {
        await targetContext.store.appendEvent(targetSessionId, {
          type: "background_task_update",
          task,
          createdAt: new Date().toISOString(),
        });
      },
      { requestTurnId: "request-task-retry" },
    );

    expect(report.status).toBe("pass");
    const taskUpdates = events.filter((event) => event.type === "background_task_update");
    expect(taskUpdates.at(-1)?.task).toMatchObject({ status: "completed", result: "pass" });
    expect(events.some((event) => event.type === "verification_end" && event.report?.status === "pass"))
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

  it("keeps concurrent workflows under one request independently authoritative", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-workflow-owner-"));
    const context = await createRunnableVerificationContext(projectPath);
    const sharedRequest = {
      ownerSessionId: "session-workflow-owner",
      requestTurnId: "request-workflow-owner",
    };
    const workflowA = runVerificationPlan(
      [
        {
          kind: "test",
          command: 'node -e "setTimeout(()=>console.log(\'workflow-a\'), 300)"',
          reason: "workflow a",
        },
      ],
      context,
      "session-workflow-owner",
      new MockWritable(),
      async () => {},
      { ...sharedRequest, workflowRunId: "workflow-a" },
    );
    await waitFor(() => context.activeVerificationAbortControllers?.size === 1);
    const workflowB = await runVerificationPlan(
      [{ kind: "test", command: 'node -e "console.log(\'workflow-b\')"', reason: "workflow b" }],
      context,
      "session-workflow-owner",
      new MockWritable(),
      async () => {},
      { ...sharedRequest, workflowRunId: "workflow-b" },
    );
    const workflowAReport = await workflowA;

    expect(workflowAReport.status).toBe("pass");
    expect(workflowB.status).toBe("pass");
    expect(workflowAReport.scope?.ownerKey).toBe(
      "workflow:session-workflow-owner:workflow-a",
    );
    expect(workflowB.scope?.ownerKey).toBe("workflow:session-workflow-owner:workflow-b");
    expect(isCurrentVerificationReport(context, workflowAReport)).toBe(true);
    expect(isCurrentVerificationReport(context, workflowB)).toBe(true);
  }, 30_000);

  it("uses agent identity ahead of workflow and request identity", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-verify-agent-owner-"));
    const context = await createRunnableVerificationContext(projectPath);
    const report = await runVerificationPlan(
      [],
      context,
      "session-agent-owner",
      new MockWritable(),
      async () => {},
      {
        ownerAgentId: "agent-owner",
        workflowRunId: "workflow-owner",
        requestTurnId: "request-owner",
      },
    );

    expect(report.scope?.ownerKey).toBe("agent:session-agent-owner:agent-owner");
    expect(isCurrentVerificationReport(context, report)).toBe(true);
  });

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
    const commandLog = await readFile(report.commands[0]!.logPath!, "utf8");
    expect(commandLog).toContain("owned-workflow");
    expect(commandLog).not.toContain("main-workflow");
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
    permissionMode: "full-access",
    permissions: { rules: [], recentDenied: [] },
    tools: { workspaceRoot: projectPath, changedFiles: [], todos: [] },
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
    permissionMode: "full-access",
    permissions: { rules: [], recentDenied: [] },
    tools: { workspaceRoot: projectPath, changedFiles: [], todos: [] },
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
