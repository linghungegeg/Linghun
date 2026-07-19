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
    expect(prompt).toContain("hard single-time budget");
    expect(prompt).toContain("Run installs non-interactively");
    expect(disabledPrompt).toBe("Fix the project.");
  });

  it("promotes explicit output paths into structured artifact contracts", async () => {
    const { resolveHeadlessBenchConfig } = await import("./headless-bench-runtime.js");
    const project = await mkdtemp(join(tmpdir(), "linghun-headless-artifact-contract-"));

    const config = await resolveHeadlessBenchConfig({
      projectPath: project,
      env: {},
      prompt: [
        "Terminal-Bench task container.",
        'Fit the peaks and write the JSON result to "/app/results.json".',
        "The file should have the following format: { \"G\": { \"x0\": 1 } }",
      ].join("\n"),
    });

    expect(config.requiredArtifacts).toEqual(["/app/results.json"]);
    expect(config.artifactContracts).toMatchObject([
      {
        path: "/app/results.json",
        kind: "json",
        checks: expect.arrayContaining([
          "exists",
          "non_empty",
          "valid_json",
          "json_shape_if_format_hint",
        ]),
      },
    ]);
    expect(config.maxRepairAttempts).toBe(2);
  });

  it("keeps shell deliverables as artifact contracts", async () => {
    const { resolveHeadlessBenchConfig } = await import("./headless-bench-runtime.js");
    const project = await mkdtemp(join(tmpdir(), "linghun-headless-shell-contract-"));

    const config = await resolveHeadlessBenchConfig({
      projectPath: project,
      env: {},
      prompt: "Create the startup script at /app/run.sh.",
    });

    expect(config.requiredArtifacts).toEqual(["/app/run.sh"]);
    expect(config.artifactContracts).toMatchObject([
      {
        path: "/app/run.sh",
        kind: "shell",
        checks: expect.arrayContaining(["exists", "non_empty", "shell_syntax_if_available"]),
      },
    ]);
  });

  it("detects service contracts only from runtime service context", async () => {
    const { resolveHeadlessBenchConfig } = await import("./headless-bench-runtime.js");
    const project = await mkdtemp(join(tmpdir(), "linghun-headless-service-contract-"));

    const serviceConfig = await resolveHeadlessBenchConfig({
      projectPath: project,
      env: {},
      prompt: "Start an HTTP server listening on port 8080.",
    });
    const dataConfig = await resolveHeadlessBenchConfig({
      projectPath: project,
      env: {},
      prompt: "Use port 9000 as an input value in the generated report.",
    });

    expect(serviceConfig.serviceContracts).toMatchObject([
      { host: "127.0.0.1", port: 8080, source: "prompt" },
    ]);
    expect(dataConfig.serviceContracts).toEqual([]);
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
            failureDetails: [
              "test_outputs.py::test_missing: trace=AssertionError: File /app/out.txt does not exist",
            ],
            testStdoutSummary: "FAILED test_outputs.py::test_missing - File /app/out.txt does not exist",
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
    expect(prompt).toContain("Official verifier failure details:");
    expect(prompt).toContain("AssertionError: File /app/out.txt does not exist");
    expect(prompt).toContain("Official verifier stdout tail:");
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

  it("returns verifier failure details and stdout tail from project-local artifacts", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-headless-official-detail-facts-"));
    await mkdir(join(project, "verifier"), { recursive: true });
    await writeFile(join(project, "verifier", "reward.txt"), "0\n", "utf8");
    await writeFile(
      join(project, "verifier", "ctrf.json"),
      JSON.stringify({
        results: {
          summary: { tests: 1, passed: 0, failed: 1, skipped: 0 },
          tests: [
            {
              name: "test_outputs.py::test_out_file",
              status: "failed",
              message: "The test failed in the call phase",
              trace: "AssertionError: File /app/out.txt does not exist",
            },
          ],
        },
      }),
      "utf8",
    );
    await writeFile(
      join(project, "verifier", "test-stdout.txt"),
      "FAILED test_outputs.py::test_out_file - AssertionError: File /app/out.txt does not exist\n",
      "utf8",
    );
    const { __testHeadlessRuntime } = await import("./headless-bench-runtime.js");

    const facts = await __testHeadlessRuntime.readHeadlessOfficialValidationFacts(project);

    expect(facts?.failureDetails?.[0]).toContain("test_outputs.py::test_out_file");
    expect(facts?.failureDetails?.[0]).toContain("/app/out.txt does not exist");
    expect(facts?.testStdoutSummary).toContain("FAILED test_outputs.py::test_out_file");
  });

  it("attaches project-local verifier facts to artifact validation failures", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-headless-artifact-official-facts-"));
    await mkdir(join(project, "verifier"), { recursive: true });
    await writeFile(join(project, "verifier", "reward.txt"), "0\n", "utf8");
    await writeFile(
      join(project, "verifier", "ctrf.json"),
      JSON.stringify({
        results: {
          summary: { tests: 1, passed: 0, failed: 1, skipped: 0 },
          tests: [
            {
              name: "test_outputs.py::test_out_file",
              status: "failed",
              trace: "AssertionError: File /app/out.txt does not exist",
            },
          ],
        },
      }),
      "utf8",
    );
    await writeFile(
      join(project, "verifier", "test-stdout.txt"),
      "FAILED test_outputs.py::test_out_file - AssertionError: File /app/out.txt does not exist\n",
      "utf8",
    );
    const { createHeadlessBenchRepairPrompt, validateHeadlessBenchCompletion } = await import(
      "./headless-bench-runtime.js"
    );

    const result = await validateHeadlessBenchCompletion({
      projectPath: project,
      config: {
        enabled: true,
        profile: "generic",
        testTimeoutMs: 5_000,
        maxRepairAttempts: 1,
        requiredArtifacts: ["/app/out.txt"],
        preflight: false,
        environmentSetupRetries: 0,
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.category).toBe("missing_artifact");
      expect(result.failure.missingArtifacts).toEqual(["/app/out.txt"]);
      expect(result.failure.artifactIssues?.[0]).toMatchObject({
        path: "/app/out.txt",
        kind: "text",
        check: "exists",
      });
      expect(result.failure.summary).toContain("Required artifact contract failed");
      expect(result.failure.summary).toContain("structured project-local verifier facts report non-pass");
      expect(result.failure.officialResult?.facts).toMatchObject({
        source: "project_local",
        reward: 0,
        failedTests: ["test_outputs.py::test_out_file"],
      });
      expect(result.failure.officialResult?.facts?.failureDetails?.[0]).toContain(
        "/app/out.txt does not exist",
      );
      expect(result.failure.officialResult?.facts?.testStdoutSummary).toContain(
        "FAILED test_outputs.py::test_out_file",
      );

      const prompt = createHeadlessBenchRepairPrompt({
        originalPrompt: "Write /app/out.txt.",
        failure: result.failure,
        attempt: 1,
        maxAttempts: 2,
        profile: "generic",
      });
      expect(prompt).toContain("Artifact validation issues: /app/out.txt exists");
      expect(prompt).toContain("Official verifier failure details:");
      expect(prompt).toContain("Official verifier stdout tail:");
      expect(prompt).toContain("FAILED test_outputs.py::test_out_file");
    }
  });

  it("injects external official verifier facts into initial and artifact repair prompts", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-headless-external-official-facts-"));
    const factsFile = join(project, "previous-verifier-facts.json");
    await writeFile(
      factsFile,
      JSON.stringify({
        facts_status: "available",
        facts: {
          reward: 0,
          result_reward: 0,
          ctrf_summary: { tests: 3, passed: 0, failed: 3, skipped: 0 },
          failed_tests: [
            "test_outputs.py::test_vm_execution",
            "test_outputs.py::test_frame_bmp_exists",
          ],
          failure_details: [
            "test_outputs.py::test_frame_bmp_exists: trace=AssertionError: File /tmp/frame.bmp does not exist",
          ],
          test_stdout_summary:
            "FAILED test_outputs.py::test_frame_bmp_exists - AssertionError: File /tmp/frame.bmp does not exist",
        },
      }),
      "utf8",
    );
    const {
      createHeadlessBenchInitialPrompt,
      createHeadlessBenchRepairPrompt,
      resolveHeadlessBenchConfig,
      validateHeadlessBenchCompletion,
    } = await import("./headless-bench-runtime.js");

    const config = await resolveHeadlessBenchConfig({
      projectPath: project,
      prompt: "Terminal-Bench task container. Write generated.txt.",
      env: {
        LINGHUN_HEADLESS_BENCH: "1",
        LINGHUN_HEADLESS_EXTERNAL_VERIFIER: "1",
        LINGHUN_HEADLESS_OFFICIAL_FACTS_FILE: factsFile,
      },
      options: {
        requiredArtifacts: ["generated.txt"],
        preflight: false,
      },
    });
    const initialPrompt = createHeadlessBenchInitialPrompt({
      originalPrompt: "Write generated.txt.",
      config,
    });

    expect(config.externalOfficialFacts).toMatchObject({
      source: "external_file",
      reward: 0,
      resultReward: 0,
      failedTests: [
        "test_outputs.py::test_vm_execution",
        "test_outputs.py::test_frame_bmp_exists",
      ],
    });
    expect(initialPrompt).toContain("Previous official verifier facts from an earlier external run");
    expect(initialPrompt).toContain("test_outputs.py::test_frame_bmp_exists");
    expect(initialPrompt).toContain("/tmp/frame.bmp does not exist");

    const missingResult = await validateHeadlessBenchCompletion({
      projectPath: project,
      config,
    });
    expect(missingResult.ok).toBe(false);
    if (!missingResult.ok) {
      expect(missingResult.failure.category).toBe("missing_artifact");
      expect(missingResult.failure.officialResult?.facts).toMatchObject({
        source: "external_file",
        failedTests: [
          "test_outputs.py::test_vm_execution",
          "test_outputs.py::test_frame_bmp_exists",
        ],
      });
      const repairPrompt = createHeadlessBenchRepairPrompt({
        originalPrompt: "Write generated.txt.",
        failure: missingResult.failure,
        attempt: 1,
        maxAttempts: 2,
        profile: "generic",
      });
      expect(repairPrompt).toContain("Official verifier failure details:");
      expect(repairPrompt).toContain("Official verifier stdout tail:");
      expect(repairPrompt).toContain("/tmp/frame.bmp does not exist");
    }

    await writeFile(join(project, "generated.txt"), "done\n", "utf8");
    const repairedResult = await validateHeadlessBenchCompletion({
      projectPath: project,
      config,
    });

    expect(repairedResult.ok).toBe(false);
    if (!repairedResult.ok) {
      expect(repairedResult.failure.category).toBe("model_patch_failed");
      expect(repairedResult.failure.summary).toContain("structured external verifier facts report non-pass");
      expect(repairedResult.failure.officialResult?.facts).toMatchObject({
        source: "external_file",
        failedTests: [
          "test_outputs.py::test_vm_execution",
          "test_outputs.py::test_frame_bmp_exists",
        ],
      });
    }
  });

  it("does not select multi-task external facts without an explicit task name", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-headless-external-multi-facts-"));
    const factsFile = join(project, "manifest.json");
    await writeFile(
      factsFile,
      JSON.stringify({
        facts_status: "available",
        tasks: {
          alpha: { facts: { task_name: "alpha", reward: 0, failed_tests: ["alpha failed"] } },
          beta: { facts: { task_name: "beta", reward: 0, failed_tests: ["beta failed"] } },
        },
      }),
      "utf8",
    );
    const { resolveHeadlessBenchConfig } = await import("./headless-bench-runtime.js");

    const config = await resolveHeadlessBenchConfig({
      projectPath: project,
      prompt: "Terminal-Bench task container.",
      env: {
        LINGHUN_HEADLESS_BENCH: "1",
        LINGHUN_HEADLESS_OFFICIAL_FACTS_FILE: factsFile,
      },
      options: { preflight: false },
    });

    expect(config.externalOfficialFacts).toBeUndefined();
  });

  it("selects external manifest facts by explicit task name", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-headless-external-task-facts-"));
    const factsFile = join(project, "manifest.json");
    await writeFile(
      factsFile,
      JSON.stringify({
        facts_status: "available",
        tasks: {
          alpha: {
            facts: {
              task_name: "alpha",
              source_trial: "alpha__1",
              reward: 0,
              failed_tests: ["alpha failed"],
            },
          },
          beta: {
            facts: {
              task_name: "beta",
              source_trial: "beta__1",
              previous_outcome: "no_any_pass",
              reward: 0,
              controlled_deadline_reached: true,
              failed_tests: ["test_beta.py::test_output"],
              failure_details: ["test_beta.py::test_output: trace=AssertionError: missing output"],
            },
          },
        },
      }),
      "utf8",
    );
    const { createHeadlessBenchInitialPrompt, resolveHeadlessBenchConfig } = await import(
      "./headless-bench-runtime.js"
    );

    const config = await resolveHeadlessBenchConfig({
      projectPath: project,
      prompt: "Terminal-Bench task container.",
      env: {
        LINGHUN_HEADLESS_BENCH: "1",
        LINGHUN_HEADLESS_OFFICIAL_FACTS_FILE: factsFile,
        LINGHUN_HEADLESS_TASK_NAME: "suite/beta",
      },
      options: { preflight: false },
    });
    const prompt = createHeadlessBenchInitialPrompt({
      originalPrompt: "Fix beta.",
      config,
    });

    expect(config.externalOfficialFacts).toMatchObject({
      source: "external_file",
      taskName: "beta",
      sourceTrial: "beta__1",
      previousOutcome: "no_any_pass",
      reward: 0,
      controlledDeadlineReached: true,
      failedTests: ["test_beta.py::test_output"],
    });
    expect(prompt).toContain("task=beta");
    expect(prompt).toContain("sourceTrial=beta__1");
    expect(prompt).toContain("previousOutcome=no_any_pass");
    expect(prompt).toContain("controlledDeadlineReached=true");
    expect(prompt).toContain("Official verifier repair route:");
    expect(prompt).toContain("deadline was reached");
    expect(prompt).toContain("test_beta.py::test_output");
    expect(prompt).not.toContain("alpha failed");
  });

  it("classifies external controlled-deadline facts as timeout repair failures", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-headless-external-deadline-facts-"));
    const factsFile = join(project, "deadline-facts.json");
    await writeFile(
      factsFile,
      JSON.stringify({
        facts_status: "available",
        facts: {
          task_name: "make-doom-for-mips",
          previous_outcome: "no_any_pass",
          reward: 0,
          controlled_deadline_reached: true,
          failed_tests: ["test_outputs.py::test_vm_execution"],
        },
      }),
      "utf8",
    );
    const { resolveHeadlessBenchConfig, validateHeadlessBenchCompletion } = await import(
      "./headless-bench-runtime.js"
    );

    const config = await resolveHeadlessBenchConfig({
      projectPath: project,
      prompt: "Terminal-Bench task container.",
      env: {
        LINGHUN_HEADLESS_BENCH: "1",
        LINGHUN_HEADLESS_EXTERNAL_VERIFIER: "1",
        LINGHUN_HEADLESS_OFFICIAL_FACTS_FILE: factsFile,
      },
      options: { preflight: false },
    });
    const result = await validateHeadlessBenchCompletion({
      projectPath: project,
      config,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.category).toBe("test_timeout");
      expect(result.failure.summary).toContain("controlledDeadlineReached=true");
      expect(result.failure.officialResult?.facts?.taskName).toBe("make-doom-for-mips");
    }
  });

  it("routes html sanitizer facts to data/security repair guidance", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-headless-external-html-facts-"));
    const factsFile = join(project, "html-facts.json");
    await writeFile(
      factsFile,
      JSON.stringify({
        facts_status: "available",
        facts: {
          task_name: "filter-js-from-html",
          previous_outcome: "no_any_pass",
          reward: 0,
          failed_tests: [
            "test_outputs.py::test_filter_blocks_xss",
            "test_outputs.py::test_clean_html_unchanged",
          ],
          failure_details: [
            "test_outputs.py::test_filter_blocks_xss: trace=AssertionError: script tag was not removed",
          ],
        },
      }),
      "utf8",
    );
    const { createHeadlessBenchInitialPrompt, resolveHeadlessBenchConfig } = await import(
      "./headless-bench-runtime.js"
    );

    const config = await resolveHeadlessBenchConfig({
      projectPath: project,
      prompt: "Terminal-Bench task container.",
      env: {
        LINGHUN_HEADLESS_BENCH: "1",
        LINGHUN_HEADLESS_OFFICIAL_FACTS_FILE: factsFile,
      },
      options: { preflight: false },
    });
    const prompt = createHeadlessBenchInitialPrompt({
      originalPrompt: "Filter unsafe HTML.",
      config,
    });

    expect(prompt).toContain("Official verifier repair route:");
    expect(prompt).toContain("data/security surface");
    expect(prompt).toContain("structured parsing");
    expect(prompt).not.toContain("ml/data surface");
  });

  it("selects a single-task external manifest without a task name", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-headless-external-single-facts-"));
    const factsFile = join(project, "manifest.json");
    await writeFile(
      factsFile,
      JSON.stringify({
        facts_status: "available",
        tasks: {
          solo: {
            facts: {
              task_name: "solo",
              reward: 0,
              failed_tests: ["solo failed"],
            },
          },
        },
      }),
      "utf8",
    );
    const { resolveHeadlessBenchConfig } = await import("./headless-bench-runtime.js");

    const config = await resolveHeadlessBenchConfig({
      projectPath: project,
      prompt: "Terminal-Bench task container.",
      env: {
        LINGHUN_HEADLESS_BENCH: "1",
        LINGHUN_HEADLESS_OFFICIAL_FACTS_FILE: factsFile,
      },
      options: { preflight: false },
    });

    expect(config.externalOfficialFacts).toMatchObject({
      source: "external_file",
      taskName: "solo",
      failedTests: ["solo failed"],
    });
  });

  it("ignores unavailable external official verifier facts files", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-headless-external-facts-unavailable-"));
    const factsFile = join(project, "previous-verifier-facts.json");
    await writeFile(
      factsFile,
      JSON.stringify({
        facts_status: "unavailable",
        unavailable_reason: "post_verifier_not_ready",
      }),
      "utf8",
    );
    const { resolveHeadlessBenchConfig, validateHeadlessBenchCompletion } = await import(
      "./headless-bench-runtime.js"
    );

    const config = await resolveHeadlessBenchConfig({
      projectPath: project,
      prompt: "Terminal-Bench task container. Write vm.js.",
      env: {
        LINGHUN_HEADLESS_BENCH: "1",
        LINGHUN_HEADLESS_EXTERNAL_VERIFIER: "1",
        LINGHUN_HEADLESS_OFFICIAL_FACTS_FILE: factsFile,
      },
      options: {
        requiredArtifacts: ["vm.js"],
        preflight: false,
      },
    });
    const result = await validateHeadlessBenchCompletion({
      projectPath: project,
      config,
    });

    expect(config.externalOfficialFacts).toBeUndefined();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.category).toBe("missing_artifact");
      expect(result.failure.officialResult).toBeUndefined();
    }
  });

  it("keeps artifact validation failures unannotated when verifier artifacts are absent", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-headless-artifact-no-official-facts-"));
    const { createHeadlessBenchRepairPrompt, validateHeadlessBenchCompletion } = await import(
      "./headless-bench-runtime.js"
    );

    const result = await validateHeadlessBenchCompletion({
      projectPath: project,
      config: {
        enabled: true,
        profile: "generic",
        testTimeoutMs: 5_000,
        maxRepairAttempts: 1,
        requiredArtifacts: ["generated.txt"],
        preflight: false,
        environmentSetupRetries: 0,
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.category).toBe("missing_artifact");
      expect(result.failure.officialResult).toBeUndefined();

      const prompt = createHeadlessBenchRepairPrompt({
        originalPrompt: "Write generated.txt.",
        failure: result.failure,
        attempt: 1,
        maxAttempts: 2,
        profile: "generic",
      });
      expect(prompt).not.toContain("Official verifier facts:");
      expect(prompt).not.toContain("Official verifier failure details:");
      expect(prompt).not.toContain("Official verifier stdout tail:");
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

  it("fails no-local-test external verifier validation without current pass evidence", async () => {
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

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.category).toBe("unknown_agent_error");
      expect(result.failure.summary).toContain("pass/fail deferred to external verifier");
      expect(result.failure.summary).toContain("no PASS evidence");
      expect(result.failure.officialResult).toBeUndefined();
    }
  });

  it("does not defer external verifier when an artifact contract is malformed", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-headless-external-bad-json-"));
    await writeFile(join(project, "results.json"), "{bad json", "utf8");
    const { validateHeadlessBenchCompletion } = await import("./headless-bench-runtime.js");

    const result = await validateHeadlessBenchCompletion({
      projectPath: project,
      config: {
        enabled: true,
        profile: "binary_or_artifact",
        testTimeoutMs: 5_000,
        maxRepairAttempts: 1,
        requiredArtifacts: ["results.json"],
        preflight: false,
        environmentSetupRetries: 0,
        externalVerifier: true,
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.category).toBe("missing_artifact");
      expect(result.failure.summary).toContain("valid_json");
      expect(result.failure.artifactIssues?.[0]).toMatchObject({
        path: "results.json",
        kind: "json",
        check: "valid_json",
      });
    }
  });

  it("does not defer external verifier when an explicit JSON shape hint is not satisfied", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-headless-external-json-shape-"));
    await writeFile(join(project, "results.json"), JSON.stringify({ other: 1 }), "utf8");
    const { resolveHeadlessBenchConfig, validateHeadlessBenchCompletion } = await import(
      "./headless-bench-runtime.js"
    );
    const config = await resolveHeadlessBenchConfig({
      projectPath: project,
      env: {},
      prompt: [
        "Write the output to a file called results.json.",
        "The file should have this JSON format: { \"answer\": 1 }",
      ].join("\n"),
      options: {
        externalVerifier: true,
        preflight: false,
      },
    });

    const result = await validateHeadlessBenchCompletion({
      projectPath: project,
      config,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.category).toBe("missing_artifact");
      expect(result.failure.summary).toContain("json_shape_if_format_hint");
      expect(result.failure.artifactIssues?.[0]).toMatchObject({
        path: "results.json",
        kind: "json",
        check: "json_shape_if_format_hint",
      });
    }
  });

  it("does not defer external verifier when an explicit service contract is unreachable", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-headless-external-service-"));
    const { validateHeadlessBenchCompletion } = await import("./headless-bench-runtime.js");

    const result = await validateHeadlessBenchCompletion({
      projectPath: project,
      config: {
        enabled: true,
        profile: "qemu_or_service",
        testTimeoutMs: 5_000,
        maxRepairAttempts: 1,
        requiredArtifacts: [],
        serviceContracts: [{ host: "127.0.0.1", port: 9, source: "prompt" }],
        preflight: false,
        environmentSetupRetries: 0,
        externalVerifier: true,
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.category).toBe("model_patch_failed");
      expect(result.failure.summary).toContain("127.0.0.1:9");
    }
  });

  it("routes no-local-test project-local deadline facts to timeout repair", async () => {
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
      expect(result.failure.category).toBe("test_timeout");
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

  it("fails no-local-test validation when verifier failure facts exist despite request-owned evidence", async () => {
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

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.category).toBe("model_patch_failed");
      expect(result.failure.summary).toContain("reward=0");
      expect(result.failure.summary).toContain("test_outputs.py::test_stale_failure");
    }
  });

  it("classifies explicit external verifier timeout facts separately from model failure", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-headless-verifier-timeout-"));
    await mkdir(join(project, "verifier"), { recursive: true });
    await writeFile(
      join(project, "verifier", "exception.txt"),
      "VerifierTimeoutError: Verifier execution timed out after 360s\n",
      "utf8",
    );
    const { classifyHeadlessFailure, validateHeadlessBenchCompletion } = await import(
      "./headless-bench-runtime.js"
    );

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
      expect(result.failure.category).toBe("verifier_timeout");
      expect(result.failure.summary).toContain("verifierTimeout=true");
      expect(result.failure.officialResult?.facts).toMatchObject({
        verifierTimeout: true,
        verifierTimeoutSummary: "VerifierTimeoutError: Verifier execution timed out after 360s",
      });
    }
    expect(
      classifyHeadlessFailure({
        output: "VerifierTimeoutError: Verifier execution timed out after 360s",
        outcome: "completed",
        exitCode: 1,
      }),
    ).toBe("verifier_timeout");
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
    });
    if (result.ok) {
      expect(result.summary).toContain("project-local official verifier facts report pass");
      expect(result.deferredToExternalVerifier).toBeUndefined();
      expect(result.officialResult?.facts).toMatchObject({
        source: "project_local",
        reward: 1,
      });
    }
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
