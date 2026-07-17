import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
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
    expect(stdout).toContain("- test_timeout: 1");
    expect(stdout).toContain("- model_patch_failed: 1");
    expect(stdout).not.toContain("agent_timeout");
    expect(stdout).not.toContain("resource_exhausted");
    expect(stdout).not.toContain("environment_missing_tool");
  });
});

async function createHarborFixture() {
  const root = await mkdtemp(join(tmpdir(), "linghun-bench-diagnostics-"));
  await writeJson(join(root, "config.json"), {
    datasets: [{ task_names: ["suite/alpha", "suite/beta", "suite/gamma"] }],
  });
  await writeTrial(root, "alpha__1", {
    taskName: "suite/alpha",
    reward: 0,
    startedAt: "2026-07-17T00:00:00Z",
    failedTests: ["alpha fails"],
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
  await writeJson(join(dir, "config.json"), { task: { name: options.taskName }, trial_name: name });
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
