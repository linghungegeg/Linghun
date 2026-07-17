import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("headless-bench-runtime", () => {
  it("keeps exact failure paths and line numbers in repair evidence", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-headless-raw-failure-"));
    const script = join(project, "failure.js");
    await writeFile(script, "console.error('src/file.ts:123:45 exact failure'); process.exit(1);", "utf8");
    const { validateHeadlessBenchCompletion } = await import("./headless-bench-runtime.js");

    const result = await validateHeadlessBenchCompletion({
      projectPath: project,
      config: {
        enabled: true,
        profile: "generic",
        testCommand: `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`,
        testTimeoutMs: 5_000,
        maxRepairAttempts: 1,
        requiredArtifacts: [],
        preflight: false,
        environmentSetupRetries: 0,
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.summary).toContain("src/file.ts:123:45 exact failure");
  });

  it("returns no project-local structured facts when verifier artifacts are absent", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-headless-no-official-facts-"));
    const { __testHeadlessRuntime } = await import("./headless-bench-runtime.js");

    await expect(
      __testHeadlessRuntime.readHeadlessOfficialValidationFacts(project),
    ).resolves.toBeUndefined();
  });

  it("adds bounded bench guardrails without changing disabled prompts", async () => {
    const { createHeadlessBenchInitialPrompt } = await import("./headless-bench-runtime.js");

    const prompt = createHeadlessBenchInitialPrompt({
      originalPrompt: "Fix the project.",
      config: {
        enabled: true,
        profile: "generic",
        testTimeoutMs: 600_000,
        maxRepairAttempts: 1,
        requiredArtifacts: [],
        preflight: false,
        environmentSetupRetries: 0,
      },
    });
    const disabledPrompt = createHeadlessBenchInitialPrompt({
      originalPrompt: "Fix the project.",
      config: {
        enabled: false,
        profile: "generic",
        testTimeoutMs: 600_000,
        maxRepairAttempts: 1,
        requiredArtifacts: [],
        preflight: false,
        environmentSetupRetries: 0,
      },
    });

    expect(prompt).toContain("Before long builds, training, or full suites");
    expect(prompt).toContain("Run installs non-interactively");
    expect(disabledPrompt).toBe("Fix the project.");
  });

  it("includes remaining deadline and verifier facts in repair prompts", async () => {
    const { createHeadlessBenchRepairPrompt } = await import("./headless-bench-runtime.js");

    const prompt = createHeadlessBenchRepairPrompt({
      originalPrompt: "Fix the project.",
      failure: {
        category: "model_patch_failed",
        summary: "structured verifier failed",
        logPath: "/tmp/local.log",
        officialResult: {
          command: "bash /tests/run-tests.sh",
          exitCode: 0,
          outcome: "completed",
          logPath: "/tmp/verifier.log",
          durationMs: 123,
          facts: {
            source: "project_local",
            reward: 0,
            resultReward: 0,
            cliExitCode: 6,
            controlledDeadlineReached: true,
            ctrfSummary: { tests: 2, passed: 1, failed: 1, skipped: 0 },
            failedTests: ["test_outputs.py::test_missing", "test_outputs.py::test_bad"],
          },
        },
      },
      attempt: 1,
      maxAttempts: 2,
      profile: "generic",
      remainingDeadline: "42s remaining",
      preflight: {
        checkedTools: ["rg"],
        missingTools: ["rg"],
        summary: "tools checked: 1; missing: rg",
      },
    });

    expect(prompt).toContain("Remaining deadline before repair: 42s remaining");
    expect(prompt).toContain("rg is missing");
    expect(prompt).toContain("Official verifier facts: reward=0; resultReward=0");
    expect(prompt).toContain("ctrfFailed=1/2");
    expect(prompt).toContain("failedTests=test_outputs.py::test_missing, test_outputs.py::test_bad");
    expect(prompt).toContain("cliExitCode=6");
    expect(prompt).toContain("controlledDeadlineReached=true");
    expect(prompt).toContain("Official verifier log: /tmp/verifier.log");
  });

  it("uses bench-only noninteractive child env while redacting secrets", async () => {
    const { __testHeadlessRuntime } = await import("./headless-bench-runtime.js");

    const env = __testHeadlessRuntime.createSanitizedChildEnv({
      PATH: "bin",
      CUSTOM_TOKEN: "secret",
      DEBIAN_FRONTEND: "dialog",
    });

    expect(env.PATH).toBe("bin");
    expect(env.CUSTOM_TOKEN).toBeUndefined();
    expect(env.DEBIAN_FRONTEND).toBe("noninteractive");
    expect(env.PIP_NO_INPUT).toBe("1");
    expect(env.PIP_DISABLE_PIP_VERSION_CHECK).toBe("1");
  });

  it("includes project-local structured official verifier artifacts in validation results", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-headless-official-facts-"));
    const script = join(project, "failure.js");
    await mkdir(join(project, "verifier"), { recursive: true });
    await mkdir(join(project, "agent"), { recursive: true });
    await writeFile(script, "process.exit(1);", "utf8");
    await writeFile(join(project, "verifier", "reward.txt"), "0\n", "utf8");
    await writeFile(
      join(project, "verifier", "ctrf.json"),
      JSON.stringify({
        results: {
          summary: { tests: 2, passed: 1, failed: 1, skipped: 0 },
          tests: [
            { name: "test_outputs.py::test_ok", status: "passed" },
            { name: "test_outputs.py::test_missing_artifact", status: "failed" },
          ],
        },
      }),
      "utf8",
    );
    await writeFile(
      join(project, "result.json"),
      JSON.stringify({
        verifier_result: { rewards: { reward: 0 } },
        agent_result: { metadata: { cli_exit_code: 6, controlled_deadline_reached: true } },
      }),
      "utf8",
    );
    await writeFile(
      join(project, "agent", "linghun-metadata.json"),
      JSON.stringify({ cli_exit_code: 6, controlled_deadline_reached: true }),
      "utf8",
    );
    const { validateHeadlessBenchCompletion } = await import("./headless-bench-runtime.js");

    const result = await validateHeadlessBenchCompletion({
      projectPath: project,
      config: {
        enabled: true,
        profile: "generic",
        testCommand: `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`,
        testTimeoutMs: 5_000,
        maxRepairAttempts: 1,
        requiredArtifacts: [],
        preflight: false,
        environmentSetupRetries: 0,
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.officialResult?.facts).toMatchObject({
        source: "project_local",
        reward: 0,
        resultReward: 0,
        cliExitCode: 6,
        controlledDeadlineReached: true,
        ctrfSummary: { tests: 2, passed: 1, failed: 1, skipped: 0 },
        failedTests: ["test_outputs.py::test_missing_artifact"],
      });
    }
  });

  it("does not pass when project-local structured facts report verifier failure", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-headless-facts-fail-"));
    const script = join(project, "success.js");
    await mkdir(join(project, "verifier"), { recursive: true });
    await writeFile(script, "process.exit(0);", "utf8");
    await writeFile(join(project, "verifier", "reward.txt"), "0\n", "utf8");
    await writeFile(
      join(project, "verifier", "ctrf.json"),
      JSON.stringify({
        results: {
          summary: { tests: 1, passed: 0, failed: 1, skipped: 0 },
          tests: [{ name: "test_outputs.py::test_failure", status: "failed" }],
        },
      }),
      "utf8",
    );
    const { validateHeadlessBenchCompletion } = await import("./headless-bench-runtime.js");

    const result = await validateHeadlessBenchCompletion({
      projectPath: project,
      config: {
        enabled: true,
        profile: "generic",
        testCommand: `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`,
        testTimeoutMs: 5_000,
        maxRepairAttempts: 1,
        requiredArtifacts: [],
        preflight: false,
        environmentSetupRetries: 0,
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.summary).toContain("structured project-local verifier facts report non-pass");
      expect(result.failure.officialResult?.facts).toMatchObject({
        source: "project_local",
        reward: 0,
        ctrfSummary: { tests: 1, passed: 0, failed: 1, skipped: 0 },
        failedTests: ["test_outputs.py::test_failure"],
      });
    }
  });

  it("marks no-local-test external verifier validation as deferred without test pass", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-headless-external-deferred-"));
    const { validateHeadlessBenchCompletion } = await import("./headless-bench-runtime.js");

    const result = await validateHeadlessBenchCompletion({
      projectPath: project,
      config: {
        enabled: true,
        profile: "generic",
        testTimeoutMs: 5_000,
        maxRepairAttempts: 1,
        requiredArtifacts: [],
        preflight: false,
        environmentSetupRetries: 0,
        externalVerifier: true,
      },
    });

    expect(result).toMatchObject({
      ok: true,
      testRan: false,
      deferredToExternalVerifier: true,
    });
    if (result.ok) {
      expect(result.summary).toContain("pass/fail deferred to external verifier");
      expect(result.officialResult).toBeUndefined();
    }
  });

  it("fails no-local-test validation when project-local verifier facts report failure", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-headless-external-facts-fail-"));
    await mkdir(join(project, "verifier"), { recursive: true });
    await mkdir(join(project, "agent"), { recursive: true });
    await writeFile(join(project, "verifier", "reward.txt"), "0\n", "utf8");
    await writeFile(
      join(project, "verifier", "ctrf.json"),
      JSON.stringify({
        results: {
          summary: { tests: 1, passed: 0, failed: 1, skipped: 0 },
          tests: [{ name: "test_outputs.py::test_external_failure", status: "failed" }],
        },
      }),
      "utf8",
    );
    await writeFile(
      join(project, "agent", "linghun-metadata.json"),
      JSON.stringify({ cli_exit_code: 6, controlled_deadline_reached: true }),
      "utf8",
    );
    const { validateHeadlessBenchCompletion } = await import("./headless-bench-runtime.js");

    const result = await validateHeadlessBenchCompletion({
      projectPath: project,
      config: {
        enabled: true,
        profile: "generic",
        testTimeoutMs: 5_000,
        maxRepairAttempts: 1,
        requiredArtifacts: [],
        preflight: false,
        environmentSetupRetries: 0,
        externalVerifier: true,
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.category).toBe("model_patch_failed");
      expect(result.failure.summary).toContain("reward=0");
      expect(result.failure.summary).toContain("cliExitCode=6");
      expect(result.failure.summary).toContain("controlledDeadlineReached=true");
      expect(result.failure.officialResult?.facts).toMatchObject({
        source: "project_local",
        reward: 0,
        cliExitCode: 6,
        controlledDeadlineReached: true,
        failedTests: ["test_outputs.py::test_external_failure"],
      });
    }
  });

  it("defers no-local-test validation when request-owned evidence supersedes stale failure facts", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-headless-external-facts-owned-evidence-"));
    await mkdir(join(project, "verifier"), { recursive: true });
    await writeFile(join(project, "verifier", "reward.txt"), "0\n", "utf8");
    await writeFile(
      join(project, "verifier", "ctrf.json"),
      JSON.stringify({
        results: {
          summary: { tests: 1, passed: 0, failed: 1, skipped: 0 },
          tests: [{ name: "test_outputs.py::test_stale_failure", status: "failed" }],
        },
      }),
      "utf8",
    );
    const { validateHeadlessBenchCompletion } = await import("./headless-bench-runtime.js");

    const result = await validateHeadlessBenchCompletion({
      projectPath: project,
      requestOwnedVerificationEvidence: true,
      config: {
        enabled: true,
        profile: "generic",
        testTimeoutMs: 5_000,
        maxRepairAttempts: 1,
        requiredArtifacts: [],
        preflight: false,
        environmentSetupRetries: 0,
        externalVerifier: true,
      },
    });

    expect(result).toMatchObject({
      ok: true,
      testRan: false,
      deferredToExternalVerifier: true,
    });
    if (result.ok) expect(result.officialResult).toBeUndefined();
  });

  it("keeps no-local-test validation deferred when project-local verifier facts report pass", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-headless-external-facts-pass-"));
    await mkdir(join(project, "verifier"), { recursive: true });
    await writeFile(join(project, "verifier", "reward.txt"), "1\n", "utf8");
    await writeFile(
      join(project, "verifier", "ctrf.json"),
      JSON.stringify({
        results: {
          summary: { tests: 1, passed: 1, failed: 0, skipped: 0 },
          tests: [{ name: "test_outputs.py::test_ok", status: "passed" }],
        },
      }),
      "utf8",
    );
    const { validateHeadlessBenchCompletion } = await import("./headless-bench-runtime.js");

    const result = await validateHeadlessBenchCompletion({
      projectPath: project,
      config: {
        enabled: true,
        profile: "generic",
        testTimeoutMs: 5_000,
        maxRepairAttempts: 1,
        requiredArtifacts: [],
        preflight: false,
        environmentSetupRetries: 0,
        externalVerifier: true,
      },
    });

    expect(result).toMatchObject({
      ok: true,
      testRan: false,
      deferredToExternalVerifier: true,
    });
    if (result.ok) expect(result.officialResult).toBeUndefined();
  });

  it("confirms a timed-out official process tree is gone before returning", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-headless-timeout-tree-"));
    const childScript = join(project, "child.js");
    const parentScript = join(project, "parent.js");
    const pidFile = join(project, "child.pid");
    await writeFile(childScript, "setInterval(()=>{},1000);", "utf8");
    await writeFile(
      parentScript,
      [
        "const {spawn}=require('node:child_process');",
        "const fs=require('node:fs');",
        `const child=spawn(process.execPath,[${JSON.stringify(childScript)}],{stdio:'ignore'});`,
        `fs.writeFileSync(${JSON.stringify(pidFile)},String(child.pid));`,
        "setInterval(()=>{},1000);",
      ].join(""),
      "utf8",
    );
    const { validateHeadlessBenchCompletion } = await import("./headless-bench-runtime.js");
    let childPid: number | undefined;

    try {
      const result = await validateHeadlessBenchCompletion({
        projectPath: project,
        config: {
          enabled: true,
          profile: "generic",
          testCommand: `${JSON.stringify(process.execPath)} ${JSON.stringify(parentScript)}`,
          testTimeoutMs: 500,
          maxRepairAttempts: 1,
          requiredArtifacts: [],
          preflight: false,
          environmentSetupRetries: 0,
        },
      });
      childPid = Number(await readFile(pidFile, "utf8"));

      expect(result).toMatchObject({ ok: false, failure: { category: "test_timeout" } });
      expect(() => process.kill(childPid!, 0)).toThrow();
    } finally {
      if (childPid) {
        try {
          process.kill(childPid, "SIGKILL");
        } catch {}
      }
    }
  }, 15_000);

  describe("workspace change detection", () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), "linghun-headless-change-"));
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it("detects same-file content changes", async () => {
      const { collectHeadlessArtifactChecklist } = await import("./headless-bench-runtime.js");
      const file = join(tempDir, "test.txt");
      await writeFile(file, "initial content", "utf8");

      const checklist1 = await collectHeadlessArtifactChecklist({
        projectPath: tempDir,
        config: {
          enabled: true,
          profile: "generic",
          testTimeoutMs: 1000,
          maxRepairAttempts: 1,
          requiredArtifacts: [],
          preflight: false,
          environmentSetupRetries: 0,
        },
        changedFiles: ["test.txt"],
      });

      await writeFile(file, "modified content", "utf8");

      const checklist2 = await collectHeadlessArtifactChecklist({
        projectPath: tempDir,
        config: {
          enabled: true,
          profile: "generic",
          testTimeoutMs: 1000,
          maxRepairAttempts: 1,
          requiredArtifacts: [],
          preflight: false,
          environmentSetupRetries: 0,
        },
        changedFiles: ["test.txt"],
      });

      expect(checklist1.workspaceChangeHash).toBeDefined();
      expect(checklist2.workspaceChangeHash).toBeDefined();
      expect(checklist1.workspaceChangeHash).not.toBe(checklist2.workspaceChangeHash);
    });

    it("detects equal-length changes after the first 1000 characters", async () => {
      const { collectHeadlessArtifactChecklist } = await import("./headless-bench-runtime.js");
      const file = join(tempDir, "large.txt");
      await writeFile(file, `${"a".repeat(1_500)}x`, "utf8");
      const config = {
        enabled: true,
        profile: "generic" as const,
        testTimeoutMs: 1000,
        maxRepairAttempts: 1,
        requiredArtifacts: [],
        preflight: false,
        environmentSetupRetries: 0,
      };
      const before = await collectHeadlessArtifactChecklist({
        projectPath: tempDir,
        config,
        changedFiles: ["large.txt"],
      });

      await writeFile(file, `${"a".repeat(1_500)}y`, "utf8");
      const after = await collectHeadlessArtifactChecklist({
        projectPath: tempDir,
        config,
        changedFiles: ["large.txt"],
      });

      expect(after.workspaceChangeHash).not.toBe(before.workspaceChangeHash);
    });

    it("streams multi-megabyte files through the workspace hash", async () => {
      const { collectHeadlessArtifactChecklist } = await import("./headless-bench-runtime.js");
      const file = join(tempDir, "large.bin");
      await writeFile(file, Buffer.alloc(8 * 1024 * 1024, 1));
      const config = {
        enabled: true,
        profile: "generic" as const,
        testTimeoutMs: 1000,
        maxRepairAttempts: 1,
        requiredArtifacts: [],
        preflight: false,
        environmentSetupRetries: 0,
      };
      const before = await collectHeadlessArtifactChecklist({
        projectPath: tempDir,
        config,
        changedFiles: ["large.bin"],
      });
      const changed = Buffer.alloc(8 * 1024 * 1024, 1);
      changed[changed.length - 1] = 2;
      await writeFile(file, changed);
      const after = await collectHeadlessArtifactChecklist({
        projectPath: tempDir,
        config,
        changedFiles: ["large.bin"],
      });

      expect(after.workspaceChangeHash).not.toBe(before.workspaceChangeHash);
    });

    it("includes changed files after the first 50 entries", async () => {
      const { collectHeadlessArtifactChecklist } = await import("./headless-bench-runtime.js");
      const changedFiles = Array.from({ length: 51 }, (_, index) => `file-${String(index).padStart(2, "0")}.txt`);
      await Promise.all(changedFiles.map((file) => writeFile(join(tempDir, file), "stable", "utf8")));
      const config = {
        enabled: true,
        profile: "generic" as const,
        testTimeoutMs: 1000,
        maxRepairAttempts: 1,
        requiredArtifacts: [],
        preflight: false,
        environmentSetupRetries: 0,
      };
      const before = await collectHeadlessArtifactChecklist({ projectPath: tempDir, config, changedFiles });

      await writeFile(join(tempDir, changedFiles[50]!), "change", "utf8");
      const after = await collectHeadlessArtifactChecklist({ projectPath: tempDir, config, changedFiles });

      expect(after.workspaceChangeHash).not.toBe(before.workspaceChangeHash);
    });

    it("returns same hash for unchanged content", async () => {
      const { collectHeadlessArtifactChecklist } = await import("./headless-bench-runtime.js");
      const file = join(tempDir, "test.txt");
      await writeFile(file, "stable content", "utf8");

      const checklist1 = await collectHeadlessArtifactChecklist({
        projectPath: tempDir,
        config: {
          enabled: true,
          profile: "generic",
          testTimeoutMs: 1000,
          maxRepairAttempts: 1,
          requiredArtifacts: [],
          preflight: false,
          environmentSetupRetries: 0,
        },
        changedFiles: ["test.txt"],
      });

      const checklist2 = await collectHeadlessArtifactChecklist({
        projectPath: tempDir,
        config: {
          enabled: true,
          profile: "generic",
          testTimeoutMs: 1000,
          maxRepairAttempts: 1,
          requiredArtifacts: [],
          preflight: false,
          environmentSetupRetries: 0,
        },
        changedFiles: ["test.txt"],
      });

      expect(checklist1.workspaceChangeHash).toBe(checklist2.workspaceChangeHash);
    });

    it("returns empty hash when no files changed", async () => {
      const { collectHeadlessArtifactChecklist } = await import("./headless-bench-runtime.js");

      const checklist = await collectHeadlessArtifactChecklist({
        projectPath: tempDir,
        config: {
          enabled: true,
          profile: "generic",
          testTimeoutMs: 1000,
          maxRepairAttempts: 1,
          requiredArtifacts: [],
          preflight: false,
          environmentSetupRetries: 0,
        },
        changedFiles: [],
      });

      expect(checklist.workspaceChangeHash).toBe("empty");
    });

    it("detects new file additions", async () => {
      const { collectHeadlessArtifactChecklist } = await import("./headless-bench-runtime.js");
      const file1 = join(tempDir, "file1.txt");
      await writeFile(file1, "content", "utf8");

      const checklist1 = await collectHeadlessArtifactChecklist({
        projectPath: tempDir,
        config: {
          enabled: true,
          profile: "generic",
          testTimeoutMs: 1000,
          maxRepairAttempts: 1,
          requiredArtifacts: [],
          preflight: false,
          environmentSetupRetries: 0,
        },
        changedFiles: ["file1.txt"],
      });

      const file2 = join(tempDir, "file2.txt");
      await writeFile(file2, "new content", "utf8");

      const checklist2 = await collectHeadlessArtifactChecklist({
        projectPath: tempDir,
        config: {
          enabled: true,
          profile: "generic",
          testTimeoutMs: 1000,
          maxRepairAttempts: 1,
          requiredArtifacts: [],
          preflight: false,
          environmentSetupRetries: 0,
        },
        changedFiles: ["file1.txt", "file2.txt"],
      });

      expect(checklist1.workspaceChangeHash).not.toBe(checklist2.workspaceChangeHash);
    });
  });
});
