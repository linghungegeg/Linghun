import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { defaultConfig, resolveStoragePaths } from "@linghun/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { recordVerificationEvidence } from "./evidence-runtime.js";
import type { TuiContext } from "./index.js";
import { createCacheState, createHookState } from "./index.js";
import type { VerificationReport, VerificationStepKind } from "./tui-data-types.js";
import { createVerificationPlan, runVerificationPlan } from "./verification-command-runtime.js";

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

  it("records scoped verification evidence without upgrading synthetic smoke to tests passed", async () => {
    const context = createEvidenceContext();
    await recordVerificationEvidence(
      context,
      "session-1",
      makeReport("pass", [{ kind: "smoke", synthetic: true }]),
    );

    expect(context.evidence[0]?.supportsClaims).toContain("verification_passed");
    expect(context.evidence[0]?.supportsClaims).toContain("smoke_ran");
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
