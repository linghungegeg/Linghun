import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { summarizeJobDir } from "./harbor-job-diagnostics.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

describe("bench diagnostics", () => {
  it("aggregates Harbor trial facts by configured task without counting stopped tails", async () => {
    const root = await createHarborFixture();

    const summary = await summarizeJobDir(root);

    expect(summary.officialSubmissionConfig).toMatchObject({
      ok: true,
      checkedTrials: 4,
      violationCount: 0,
    });
    expect(summary.trialTasks.configuredTaskCount).toBe(3);
    expect(summary.trialTasks.trialCount).toBe(4);
    expect(summary.trialTasks.effectiveTrialCount).toBe(3);
    expect(summary.trialTasks.stopTailCancelledCount).toBe(1);
    expect(summary.trialTasks.controlledDeadlineCount).toBe(1);
    expect(summary.trialTasks.verifierTimeoutCount).toBe(1);
    expect(summary.trialTasks.firstUnique).toEqual({ pass: 0, total: 2, rate: 0 });
    expect(summary.trialTasks.anyPass).toEqual({ pass: 1, total: 3, rate: 0.333333 });
    expect(summary.trialTasks.recoveredAfterFirstFailure).toMatchObject([
      {
        taskName: "alpha",
        first: { reward: 0, failedTests: ["alpha fails"] },
        recovered: { reward: 1 },
      },
    ]);
    expect(summary.trialTasks.noAnyPass).toHaveLength(1);
    expect(summary.trialTasks.failureCategories).toEqual({
      interrupted: 1,
      model_patch_failed: 1,
      resolved: 1,
      test_timeout: 1,
    });
  });

  it("reports structured Harbor facts without classifying arbitrary result text", async () => {
    const root = await createHarborFixture();
    await writeJson(join(root, "nested", "results.json"), {
      results: [
        {
          is_resolved: false,
          log: "agent timed out, no space left, command not found, missing artifact",
        },
      ],
    });

    const { stdout } = await execFileAsync(process.execPath, [join(repoRoot, "scripts", "terminal-bench-report.mjs"), root], {
      cwd: repoRoot,
      encoding: "utf8",
      windowsHide: true,
    });

    expect(stdout).toContain("results: 1/3 (33.3%)");
    expect(stdout).toContain("first unique: 0/2 (0.0%)");
    expect(stdout).toContain("official submission config: PASS");
    expect(stdout).toContain("- test_timeout: 1");
    expect(stdout).toContain("- model_patch_failed: 1");
    expect(stdout).not.toContain("- agent_timeout:");
    expect(stdout).not.toContain("- resource_exhausted:");
    expect(stdout).not.toContain("- environment_missing_tool:");
    expect(stdout).not.toContain("--global-agent-timeout-sec");
  }, 10_000);

  it("flags non-default timeout multipliers before official submission", async () => {
    const root = await createHarborFixture({
      trialOverrides: {
        alpha__1: {
          agent_timeout_multiplier: 2,
          verifier_timeout_multiplier: 2,
        },
      },
    });

    const summary = await summarizeJobDir(root);

    expect(summary.officialSubmissionConfig.ok).toBe(false);
    expect(summary.officialSubmissionConfig.violationCount).toBe(2);
    expect(summary.officialSubmissionConfig.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: "alpha__1/config.json",
          field: "agent_timeout_multiplier",
          value: 2,
        }),
        expect.objectContaining({
          file: "alpha__1/config.json",
          field: "verifier_timeout_multiplier",
          value: 2,
        }),
      ]),
    );
  });

  it("returns non-zero from the official submission check on config drift", async () => {
    const root = await createHarborFixture({
      trialOverrides: {
        alpha__1: {
          agent_timeout_multiplier: 2,
        },
      },
    });

    try {
      await execFileAsync(
        process.execPath,
        [
          join(repoRoot, "scripts", "harbor-job-diagnostics.mjs"),
          root,
          "--official-submission-check",
        ],
        {
          cwd: repoRoot,
          encoding: "utf8",
          windowsHide: true,
        },
      );
      throw new Error("expected official submission check to fail");
    } catch (error) {
      expect(error).toMatchObject({ code: 2 });
      expect(error.stdout).toContain("official submission config:");
      expect(error.stdout).toContain("- status: fail");
      expect(error.stdout).toContain("agent_timeout_multiplier");
    }

    try {
      await execFileAsync(
        process.execPath,
        [
          join(repoRoot, "scripts", "terminal-bench-report.mjs"),
          root,
          "--official-submission-check",
        ],
        {
          cwd: repoRoot,
          encoding: "utf8",
          windowsHide: true,
        },
      );
      throw new Error("expected terminal bench report official submission check to fail");
    } catch (error) {
      expect(error).toMatchObject({ code: 2 });
      expect(error.stdout).toContain("official submission config: FAIL");
      expect(error.stdout).toContain("agent_timeout_multiplier");
    }
  }, 15_000);

  it("writes repair facts from structured Harbor trial artifacts", async () => {
    const root = await createHarborFixture();
    const outputDir = await mkdtemp(join(tmpdir(), "linghun-bench-repair-facts-"));

    await execFileAsync(
      process.execPath,
      [
        join(repoRoot, "scripts", "harbor-job-diagnostics.mjs"),
        root,
        `--write-repair-facts-dir=${outputDir}`,
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        windowsHide: true,
      },
    );

    const manifest = JSON.parse(await readFile(join(outputDir, "manifest.json"), "utf8"));
    const alphaFacts = JSON.parse(await readFile(join(outputDir, "alpha.json"), "utf8"));
    const betaFacts = JSON.parse(await readFile(join(outputDir, "beta.json"), "utf8"));

    expect(manifest.tasks.alpha.facts).toMatchObject({
      task_name: "alpha",
      source_trial: "alpha__1",
      recovered_trial: "alpha__2",
      previous_outcome: "recovered_after_failure",
      reward: 0,
      failed_tests: ["alpha fails"],
    });
    expect(alphaFacts.facts).toMatchObject(manifest.tasks.alpha.facts);
    expect(betaFacts.facts).toMatchObject({
      task_name: "beta",
      source_trial: "beta__1",
      previous_outcome: "no_any_pass",
      verifier_timeout: true,
    });
    expect(manifest.tasks).not.toHaveProperty("gamma");
  }, 15_000);
});

async function createHarborFixture(options = {}) {
  const root = await mkdtemp(join(tmpdir(), "linghun-bench-diagnostics-"));
  await writeJson(join(root, "config.json"), {
    datasets: [{ task_names: ["suite/alpha", "suite/beta", "suite/gamma"] }],
    ...(options.jobConfig ?? {}),
  });
  await writeTrial(root, "alpha__1", {
    taskName: "suite/alpha",
    reward: 0,
    startedAt: "2026-07-17T00:00:00Z",
    failedTests: ["alpha fails"],
    configOverrides: options.trialOverrides?.alpha__1,
  });
  await writeTrial(root, "alpha__2", {
    taskName: "suite/alpha",
    reward: 1,
    startedAt: "2026-07-17T00:01:00Z",
  });
  await writeTrial(root, "beta__1", {
    taskName: "beta",
    reward: 0,
    startedAt: "2026-07-17T00:02:00Z",
    exceptionType: "VerifierTimeoutError",
  });
  await writeTrial(root, "gamma__stop", {
    taskName: "gamma",
    reward: 0,
    startedAt: "2026-07-17T00:03:00Z",
    exceptionType: "CancelledError",
    controlledDeadlineReached: true,
  });
  return root;
}

async function writeTrial(root, name, options) {
  const dir = join(root, name);
  await writeJson(join(dir, "config.json"), {
    task: { name: options.taskName },
    trial_name: name,
    ...(options.configOverrides ?? {}),
  });
  await writeJson(join(dir, "result.json"), {
    trial_name: name,
    task_id: { name: options.taskName },
    started_at: options.startedAt,
    finished_at: options.startedAt,
    verifier_result: { rewards: { reward: options.reward } },
    exception_info: options.exceptionType ? { exception_type: options.exceptionType } : undefined,
    agent_result: { metadata: { controlled_deadline_reached: options.controlledDeadlineReached } },
  });
  await writeJson(join(dir, "agent", "linghun-metadata.json"), {
    cli_exit_code: options.reward === 1 ? 0 : 6,
    controlled_deadline_reached: options.controlledDeadlineReached,
    cross_trial_state_shared: false,
  });
  await writeJson(join(dir, "verifier", "ctrf.json"), {
    results: {
      summary: {
        tests: options.failedTests?.length ? options.failedTests.length : 1,
        passed: options.failedTests?.length ? 0 : 1,
        failed: options.failedTests?.length ?? 0,
      },
      tests: (options.failedTests ?? []).map((test) => ({ name: test, status: "failed" })),
    },
  });
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2), "utf8");
}
