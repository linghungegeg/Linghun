import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type LinghunConfig, defaultConfig } from "@linghun/config";
// defaultConfig is a const object, not a function — use structuredClone to avoid mutation
import { afterEach, describe, expect, it } from "vitest";
import type { DurableJobState } from "./index.js";
import {
  DEFAULT_JOB_BUDGET_TOKENS,
  DEFAULT_JOB_MAX_STEPS,
  DEFAULT_JOB_TIMEOUT_MS,
  type JobContext,
  MAX_JOB_MAX_STEPS,
  type ParsedJobRunOptions,
  appendJobLog,
  clampPositiveInt,
  countDurableJobAgents,
  createDurableJobAgents,
  deriveAgentDisplayName,
  estimateJobTokens,
  findDurableJob,
  formatJobAgentLabels,
  formatJobList,
  formatJobLogs,
  formatJobPrimary,
  formatJobReport,
  formatJobReportConclusion,
  formatJobStatus,
  getDurableJobMaxSteps,
  getDurableJobPaths,
  getDurableJobStatePath,
  getDurableJobsRoot,
  isDurableJobState,
  listDurableJobs,
  parseJobRunOptions,
  persistDurableJob,
  readDurableJobState,
  rescheduleDurableJobAgents,
  truncateAsciiLabel,
  writeDurableJobReport,
} from "./job-runtime.js";

function createTestJobContext(overrides?: Partial<JobContext>): JobContext {
  return {
    config: structuredClone(defaultConfig),
    projectPath: "/tmp/test-project",
    language: "zh-CN",
    ...overrides,
  };
}

function createMinimalJob(overrides?: Partial<DurableJobState>): DurableJobState {
  return {
    id: "job-test1234",
    goal: "test goal for unit tests",
    projectPath: "/tmp/test-project",
    status: "running",
    phase: "Phase 17A",
    target: "local-durable-jobs",
    plan: ["step 1", "step 2"],
    agents: [
      {
        id: "job-agent-1",
        type: "planner",
        displayName: "test-planner",
        goal: "test goal#1",
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
    timeoutMs: DEFAULT_JOB_TIMEOUT_MS,
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
    logPath: "/tmp/test-project/.linghun/jobs/job-test1234/job.log",
    reportPath: "/tmp/test-project/.linghun/jobs/job-test1234/report.md",
    fullOutputPath: "/tmp/test-project/.linghun/jobs/job-test1234/full-output.log",
    ...overrides,
  } as DurableJobState;
}

describe("parseJobRunOptions", () => {
  it("parses empty args with defaults", () => {
    const result = parseJobRunOptions([]);
    expect(result.goal).toBe("");
    expect(result.phase).toBe("default");
    expect(result.target).toBe("local-durable-jobs");
    expect(result.maxTokens).toBe(DEFAULT_JOB_BUDGET_TOKENS);
    expect(result.maxSteps).toBe(DEFAULT_JOB_MAX_STEPS);
    expect(result.timeoutMs).toBe(DEFAULT_JOB_TIMEOUT_MS);
    expect(result.allowEdit).toBe(false);
    expect(result.allowBash).toBe(false);
    expect(result.allowMultiAgent).toBe(false);
    expect(result.requestedAgents).toBe(1);
  });

  it("parses goal from positional args", () => {
    const result = parseJobRunOptions(["fix", "the", "bug"]);
    expect(result.goal).toBe("fix the bug");
  });

  it("parses --phase flag", () => {
    const result = parseJobRunOptions(["--phase", "Phase 18"]);
    expect(result.phase).toBe("Phase 18");
  });

  it("parses --target flag", () => {
    const result = parseJobRunOptions(["--target", "remote"]);
    expect(result.target).toBe("remote");
  });

  it("parses --agents flag (clamped without --multi-agent)", () => {
    const result = parseJobRunOptions(["--agents", "5", "do stuff"]);
    expect(result.requestedAgents).toBe(1);
  });

  it("parses --agents with --multi-agent", () => {
    const result = parseJobRunOptions(["--multi-agent", "--agents", "5", "do stuff"]);
    expect(result.requestedAgents).toBe(5);
    expect(result.allowMultiAgent).toBe(true);
  });

  it("parses explicit running cap separately from requested agents", () => {
    const result = parseJobRunOptions([
      "--multi-agent",
      "--agents",
      "5",
      "--running-cap",
      "2",
      "do stuff",
    ]);
    expect(result.requestedAgents).toBe(5);
    expect(result.runningCap).toBe(2);
  });

  it("does not clamp requested agents or running cap to a hidden fixed 20", () => {
    const result = parseJobRunOptions([
      "--multi-agent",
      "--agents",
      "24",
      "--running-cap",
      "23",
      "do stuff",
    ]);
    expect(result.requestedAgents).toBe(24);
    expect(result.runningCap).toBe(23);

    const agents = createDurableJobAgents(result, "running", result.runningCap ?? 1);
    expect(agents).toHaveLength(24);
  });

  it("parses --tokens flag", () => {
    const result = parseJobRunOptions(["--tokens", "500000"]);
    expect(result.maxTokens).toBe(500000);
  });

  it("parses --max-steps flag", () => {
    const result = parseJobRunOptions(["--max-steps", "10"]);
    expect(result.maxSteps).toBe(10);
  });

  it("clamps --max-steps to MAX_JOB_MAX_STEPS", () => {
    const result = parseJobRunOptions(["--max-steps", "999"]);
    expect(result.maxSteps).toBe(MAX_JOB_MAX_STEPS);
  });

  it("parses --allow-edit and --allow-bash", () => {
    const result = parseJobRunOptions(["--allow-edit", "--allow-bash"]);
    expect(result.allowEdit).toBe(true);
    expect(result.allowBash).toBe(true);
  });

  it("generates plan array", () => {
    const result = parseJobRunOptions(["fix bug"]);
    expect(result.plan).toHaveLength(4);
    expect(result.plan[0]).toBe("fix bug");
  });

  it("D.14D-R P1-5: default run has no explicit budget", () => {
    const result = parseJobRunOptions(["do work"]);
    expect(result.budgetExplicit).toEqual({ tokens: false, steps: false, runtime: false });
  });

  it("D.14D-R P1-5: explicit budget flags are tracked", () => {
    const result = parseJobRunOptions([
      "do work",
      "--tokens",
      "50000",
      "--max-steps",
      "2",
      "--timeout",
      "60000",
    ]);
    expect(result.budgetExplicit).toEqual({ tokens: true, steps: true, runtime: true });
  });
});

describe("D.14D-R P1-5 job budget display semantics", () => {
  it("default job (no explicit budget) shows budget not set, not default max numbers", () => {
    const job = createMinimalJob();
    job.budget.explicit = undefined; // old state.json / not set
    const status = formatJobStatus(job);
    expect(status).toContain("budget not set");
    // formatJobBudgetLine 用空格分隔 key value；非 = 格式。
    expect(status).toContain("tokens 0/not set");
    expect(status).toContain("steps 0/not set");
    expect(status).toContain("timeout not set");
    // 不展示默认 max 数值。
    expect(status).not.toContain("/120000");
  });

  it("explicitly-budgeted job shows real budget numbers", () => {
    const job = createMinimalJob();
    job.budget.explicit = { tokens: true, steps: true, runtime: true };
    job.budget.maxTokens = 50000;
    job.budget.maxSteps = 2;
    const status = formatJobStatus(job);
    expect(status).toContain("tokens 0/50000");
    expect(status).toContain("steps 0/2");
    expect(status).not.toContain("budget not set");
  });
});

describe("clampPositiveInt", () => {
  it("returns fallback for undefined", () => {
    expect(clampPositiveInt(undefined, 10, 100)).toBe(10);
  });

  it("returns fallback for non-numeric string", () => {
    expect(clampPositiveInt("abc", 10, 100)).toBe(10);
  });

  it("returns fallback for zero", () => {
    expect(clampPositiveInt("0", 10, 100)).toBe(10);
  });

  it("returns fallback for negative", () => {
    expect(clampPositiveInt("-5", 10, 100)).toBe(10);
  });

  it("returns parsed value when valid", () => {
    expect(clampPositiveInt("50", 10, 100)).toBe(50);
  });

  it("clamps to max", () => {
    expect(clampPositiveInt("200", 10, 100)).toBe(100);
  });
});

describe("isDurableJobState", () => {
  it("returns true for valid job state", () => {
    const job = createMinimalJob();
    expect(isDurableJobState(job)).toBe(true);
  });

  it("returns false for null", () => {
    expect(isDurableJobState(null)).toBe(false);
  });

  it("returns false for missing required fields", () => {
    expect(isDurableJobState({ id: "x" })).toBe(false);
  });

  it("returns false for non-object", () => {
    expect(isDurableJobState("string")).toBe(false);
    expect(isDurableJobState(42)).toBe(false);
  });
});

describe("path helpers", () => {
  it("getDurableJobStatePath returns state.json in job dir", () => {
    const job = createMinimalJob();
    const result = getDurableJobStatePath(job);
    expect(result).toContain("state.json");
    expect(result).toContain("job-test1234");
  });

  it("getDurableJobsRoot uses config storage paths", () => {
    const context = createTestJobContext();
    const root = getDurableJobsRoot(context);
    expect(root).toContain("jobs");
  });

  it("getDurableJobPaths returns logPath, reportPath, fullOutputPath", () => {
    const context = createTestJobContext();
    const paths = getDurableJobPaths(context, "job-abc");
    expect(paths.logPath).toContain("job.log");
    expect(paths.reportPath).toContain("report.md");
    expect(paths.fullOutputPath).toContain("full-output.log");
  });
});

describe("formatJobReport/List/Status", () => {
  it("formatJobStatus includes job id and status", () => {
    const job = createMinimalJob();
    const result = formatJobStatus(job);
    expect(result).toContain("job-test1234");
    expect(result).toContain("running");
  });

  it("Run 2 P3-7: job status/report/logs redact absolute paths for display", async () => {
    const root = await mkdtemp(join(tmpdir(), "linghun-user-home-like-"));
    const project = join(root, "project-a");
    const job = createMinimalJob({
      projectPath: project,
      logPath: join(project, ".linghun", "jobs", "job-test1234", "job.log"),
      reportPath: join(root, "data", "jobs", "job-test1234", "report.md"),
      fullOutputPath: join(root, "data", "jobs", "job-test1234", "full-output.log"),
    });
    await mkdir(join(project, ".linghun", "jobs", "job-test1234"), { recursive: true });
    await writeFile(job.logPath, "line\n", "utf8");

    const status = formatJobStatus(job);
    const report = formatJobReport(job);
    const logs = await formatJobLogs(job);

    expect(status).not.toContain(root);
    expect(report).not.toContain(root);
    expect(logs).not.toContain(root);
    expect(status).toContain("/job report job-test1234");
    expect(status).toContain("/job logs job-test1234");
    expect(status).not.toContain(".linghun/jobs/job-test1234/job.log");
    expect(report).toContain(".linghun/jobs/job-test1234/job.log");
    expect(report).toMatch(/\[(?:local-path|user-home)\]\/.*report\.md/u);
    expect(logs).toContain(".linghun/jobs/job-test1234/job.log");
  });

  it("formatJobReport includes job id", () => {
    const job = createMinimalJob();
    const result = formatJobReport(job);
    expect(result).toContain("job-test1234");
    expect(result).toContain("running");
  });

  it("formatJobList shows empty message for no jobs", () => {
    const context = createTestJobContext();
    const result = formatJobList([], context);
    expect(result).toContain("durable job");
  });

  it("formatJobList shows jobs when present", () => {
    const context = createTestJobContext();
    const job = createMinimalJob();
    const result = formatJobList([job], context);
    expect(result).toContain("job-test1234");
    expect(result).toContain("lifecycle running (active now)");
    expect(result).toContain("result partial (incomplete or unverified evidence)");
    expect(result).not.toContain("/tmp/test-project");
    expect(result).not.toContain(".linghun/jobs/job-test1234/job.log");
  });

  it("Phase 7.12: job lifecycle statuses use consistent non-PASS wording", () => {
    const context = createTestJobContext();
    for (const status of [
      "running",
      "blocked",
      "stale",
      "cancelled",
      "timeout",
      "completed",
    ] as const) {
      const job = createMinimalJob({
        id: `job-${status}`,
        status,
        result:
          status === "running"
            ? undefined
            : {
                status: status === "completed" ? "partial" : status,
                summary: `${status} fixture`,
                facts: [],
                evidenceRefs: [],
                generatedAt: "2025-01-01T00:00:02.000Z",
              },
      });
      const list = formatJobList([job], context);
      const statusText = formatJobStatus(job);
      const report = formatJobReport(job);
      const combined = `${list}\n${statusText}\n${report}`;

      expect(combined).toContain(`lifecycle ${status}`);
      expect(combined).toContain("evidence boundary");
      expect(combined).not.toContain("verification PASS");
      expect(combined).not.toContain("PASS evidence");
    }
  });

  it("formatJobPrimary includes goal and status", () => {
    const context = createTestJobContext();
    const job = createMinimalJob();
    const result = formatJobPrimary(job, context);
    expect(result).toContain("test goal");
    expect(result).toContain("running");
  });

  it("formatJobReportConclusion handles stale status", () => {
    const job = createMinimalJob({ status: "stale" });
    const result = formatJobReportConclusion(job);
    expect(result).toContain("stale");
  });

  it("formatJobReportConclusion handles blocked status", () => {
    const job = createMinimalJob({ status: "blocked" });
    const result = formatJobReportConclusion(job);
    expect(result).toContain("blocked");
  });

  it("Phase 7.12: status gives state and next step without full troubleshooting paths", () => {
    const job = createMinimalJob({
      status: "completed",
      verification: { status: "partial", summary: "worker completed; verification pending" },
      result: {
        status: "partial",
        summary: "bounded worker ended",
        facts: ["fact one"],
        evidenceRefs: ["worker-evidence"],
        generatedAt: "2025-01-01T00:00:02.000Z",
      },
    });

    const result = formatJobStatus(job);

    expect(result).toContain("- status: completed (lifecycle ended; review evidence separately)");
    expect(result).toContain("- result: partial (incomplete or unverified evidence)");
    expect(result).toContain("- next action: Review /job report job-test1234");
    expect(result).toContain("/job logs job-test1234");
    expect(result).toContain("/details background job-test1234");
    expect(result).not.toContain("- log path:");
    expect(result).not.toContain("- report path:");
    expect(result).not.toContain("- full output path:");
    expect(result).not.toContain("verification PASS");
  });

  it("Phase 7.12: report summarizes evidence boundary and redacted artifact refs", () => {
    const job = createMinimalJob({
      status: "completed",
      verification: { status: "partial", summary: "not verified yet" },
      evidenceRefs: [
        {
          id: "evidence-1",
          kind: "test_result",
          source: "local",
          summary: "unit checks not run; report is bounded",
        },
      ],
      result: {
        status: "partial",
        summary: "bounded worker ended",
        facts: ["fact one"],
        evidenceRefs: ["worker-evidence"],
        generatedAt: "2025-01-01T00:00:02.000Z",
      },
    });

    const result = formatJobReport(job);

    expect(result).toContain(
      "- status: completed (lifecycle ended; review evidence separately); result partial (incomplete or unverified evidence)",
    );
    expect(result).toContain("- evidence boundary: report summarizes bounded job evidence only");
    expect(result).toContain("evidence-1:test_result");
    expect(result).toContain("worker-evidence:worker-result");
    expect(result).toContain("- log path: .linghun/jobs/job-test1234/job.log");
    expect(result).not.toContain("/tmp/test-project");
    expect(result).not.toContain("verification PASS");
  });

  it("Phase 7.12: logs show bounded tail only and sanitize absolute paths inside log lines", async () => {
    const root = await mkdtemp(join(tmpdir(), "job-rt-test-"));
    const project = join(root, "project");
    const job = createMinimalJob({
      projectPath: project,
      logPath: join(project, ".linghun", "jobs", "job-test1234", "job.log"),
      reportPath: join(project, ".linghun", "jobs", "job-test1234", "report.md"),
      fullOutputPath: join(project, ".linghun", "jobs", "job-test1234", "full-output.log"),
    });
    await mkdir(join(project, ".linghun", "jobs", "job-test1234"), { recursive: true });
    await writeFile(
      job.logPath,
      Array.from({ length: 45 }, (_, index) => {
        const line = index + 1;
        return `line ${line} at ${join(project, "secret", `file-${line}.txt`)}`;
      }).join("\n"),
      "utf8",
    );

    const result = await formatJobLogs(job);

    expect(result).toContain("- tail: bounded last 40/40 lines");
    expect(result).not.toContain("line 1 at");
    expect(result).toContain("line 6 at");
    expect(result).toContain(".linghun/jobs/job-test1234/job.log");
    expect(result).not.toContain(project);
    expect(result).not.toContain(root);
  });
});

describe("read/write roundtrip", () => {
  let tempDir: string;

  afterEach(async () => {
    // cleanup handled by OS temp dir
  });

  it("persistDurableJob + readDurableJobState roundtrip", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "job-rt-test-"));
    const job = createMinimalJob({
      logPath: join(tempDir, "job.log"),
      reportPath: join(tempDir, "report.md"),
      fullOutputPath: join(tempDir, "full-output.log"),
    });
    await persistDurableJob(job);
    const statePath = getDurableJobStatePath(job);
    const loaded = await readDurableJobState(statePath);
    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe("job-test1234");
    expect(loaded?.goal).toBe("test goal for unit tests");
    expect(loaded?.status).toBe("running");
  });

  it("appendJobLog writes to log and fullOutput", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "job-rt-test-"));
    const job = createMinimalJob({
      logPath: join(tempDir, "job.log"),
      reportPath: join(tempDir, "report.md"),
      fullOutputPath: join(tempDir, "full-output.log"),
    });
    await appendJobLog(job, "test message");
    const logContent = await readFile(job.logPath, "utf8");
    const fullContent = await readFile(job.fullOutputPath, "utf8");
    expect(logContent).toContain("test message");
    expect(fullContent).toContain("test message");
  });

  it("keeps large job payload in fullOutput while status/report/log views stay bounded", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "job-rt-test-"));
    const job = createMinimalJob({
      projectPath: tempDir,
      logPath: join(tempDir, "job.log"),
      reportPath: join(tempDir, "report.md"),
      fullOutputPath: join(tempDir, "full-output.log"),
    });
    const sentinel = "JOB_DUP_END_SHOULD_ONLY_BE_IN_FULL_OUTPUT";
    for (let index = 0; index < 45; index += 1) {
      const tail = index === 0 ? sentinel : `line-${index}`;
      await appendJobLog(job, `job payload ${index} ${"j".repeat(1200)} ${tail}`);
    }

    const status = formatJobStatus(job);
    const report = formatJobReport(job);
    const logs = await formatJobLogs(job);
    const fullOutput = await readFile(job.fullOutputPath, "utf8");

    expect(status).not.toContain(sentinel);
    expect(report).not.toContain(sentinel);
    expect(logs).not.toContain(sentinel);
    expect(logs).toContain("- tail: bounded last 40/40 lines");
    expect(fullOutput).toContain(sentinel);
  });

  it("writeDurableJobReport creates report file", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "job-rt-test-"));
    const job = createMinimalJob({
      logPath: join(tempDir, "job.log"),
      reportPath: join(tempDir, "report.md"),
      fullOutputPath: join(tempDir, "full-output.log"),
    });
    await writeDurableJobReport(job);
    const content = await readFile(job.reportPath, "utf8");
    expect(content).toContain("# Job Report job-test1234");
    expect(content).toContain("running");
  });

  it("readDurableJobState returns null for missing file", async () => {
    const result = await readDurableJobState("/nonexistent/path/state.json");
    expect(result).toBeNull();
  });

  it("listDurableJobs returns empty for empty dir", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "job-rt-test-"));
    const jobsDir = join(tempDir, "jobs");
    await mkdir(jobsDir, { recursive: true });
    const config = structuredClone(defaultConfig) as LinghunConfig;
    config.storage.jobs = { scope: "project" };
    const context = createTestJobContext({
      config,
      projectPath: tempDir,
    });
    const jobs = await listDurableJobs(context);
    expect(jobs).toEqual([]);
  });

  it("findDurableJob returns undefined for empty list", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "job-rt-test-"));
    const jobsDir = join(tempDir, "jobs");
    await mkdir(jobsDir, { recursive: true });
    const config = structuredClone(defaultConfig) as LinghunConfig;
    config.storage.jobs = { scope: "project" };
    const context = createTestJobContext({
      config,
      projectPath: tempDir,
    });
    const job = await findDurableJob(context, "nonexistent");
    expect(job).toBeUndefined();
  });

  it("Run 2 P3-7: listDurableJobs filters user-scope history to the current project", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "job-rt-test-"));
    const projectA = join(tempDir, "project-a");
    const projectB = join(tempDir, "project-b");
    const jobsRoot = join(tempDir, "user-data", "jobs");
    const config = structuredClone(defaultConfig) as LinghunConfig;
    config.storage.jobs = { scope: "custom", path: jobsRoot };
    const context = createTestJobContext({ config, projectPath: projectA });
    const jobA = createMinimalJob({
      id: "job-project-a",
      projectPath: projectA,
      logPath: join(jobsRoot, "job-project-a", "job.log"),
      reportPath: join(jobsRoot, "job-project-a", "report.md"),
      fullOutputPath: join(jobsRoot, "job-project-a", "full-output.log"),
    });
    const jobB = createMinimalJob({
      id: "job-project-b",
      projectPath: projectB,
      logPath: join(jobsRoot, "job-project-b", "job.log"),
      reportPath: join(jobsRoot, "job-project-b", "report.md"),
      fullOutputPath: join(jobsRoot, "job-project-b", "full-output.log"),
    });

    await persistDurableJob(jobA);
    await persistDurableJob(jobB);

    const jobs = await listDurableJobs(context);
    expect(jobs.map((job) => job.id)).toEqual(["job-project-a"]);
    expect((await findDurableJob(context, "project-b"))?.id).toBeUndefined();
  });
});

describe("pure computation helpers", () => {
  it("estimateJobTokens estimates based on length/4", () => {
    expect(estimateJobTokens("hello")).toBe(2);
    expect(estimateJobTokens("")).toBe(1);
    expect(estimateJobTokens("a".repeat(100))).toBe(25);
  });

  it("getDurableJobMaxSteps clamps to bounds", () => {
    const job = createMinimalJob();
    expect(getDurableJobMaxSteps(job)).toBe(4);

    const jobHigh = createMinimalJob();
    jobHigh.budget.maxSteps = 999;
    expect(getDurableJobMaxSteps(jobHigh)).toBe(MAX_JOB_MAX_STEPS);
  });

  it("countDurableJobAgents counts by status", () => {
    const job = createMinimalJob({
      agents: [
        {
          id: "a1",
          type: "planner",
          displayName: "p",
          goal: "g",
          status: "running",
          budgetTokens: 1000,
        },
        {
          id: "a2",
          type: "worker",
          displayName: "w",
          goal: "g",
          status: "sleeping",
          budgetTokens: 1000,
        },
        {
          id: "a3",
          type: "verifier",
          displayName: "v",
          goal: "g",
          status: "blocked",
          budgetTokens: 1000,
        },
      ],
    });
    const counts = countDurableJobAgents(job);
    expect(counts.running).toBe(1);
    expect(counts.sleeping).toBe(1);
    expect(counts.blocked).toBe(1);
    expect(counts.completed).toBe(0);
  });

  it("rescheduleDurableJobAgents respects running cap", () => {
    const job = createMinimalJob({
      status: "running",
      budget: { maxTokens: 120000, maxRunningAgents: 1, maxSteps: 4, note: "test" },
      agents: [
        {
          id: "a1",
          type: "planner",
          displayName: "p",
          goal: "g",
          status: "running",
          budgetTokens: 1000,
        },
        {
          id: "a2",
          type: "worker",
          displayName: "w",
          goal: "g",
          status: "running",
          budgetTokens: 1000,
        },
      ],
    });
    rescheduleDurableJobAgents(job);
    expect(job.agents[0]?.status).toBe("running");
    expect(job.agents[1]?.status).toBe("sleeping");
  });

  it("deriveAgentDisplayName produces valid label", () => {
    const name = deriveAgentDisplayName("worker", "fix the authentication bug");
    expect(name).toMatch(/^[a-z0-9-]+$/);
    expect(name.length).toBeLessThanOrEqual(36);
    expect(name).toContain("worker");
  });

  it("truncateAsciiLabel cleans and truncates", () => {
    expect(truncateAsciiLabel("hello-world", 20)).toBe("hello-world");
    expect(truncateAsciiLabel("a".repeat(50), 10)).toHaveLength(10);
    expect(truncateAsciiLabel("", 10)).toBe("agent");
  });
});
