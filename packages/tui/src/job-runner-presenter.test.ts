import { describe, expect, it } from "vitest";
import type { BackgroundTaskState, DurableJobState } from "./index.js";
import {
  formatBackgroundDetails,
  formatBackgroundOutputDetails,
  formatBackgroundTask,
  formatBackgroundTaskPanelDetails,
  formatBackgroundTaskPanelRow,
  formatElapsedSince,
  formatJobNextAction,
  formatJobRunnerInline,
  formatJobRunnerReportLine,
  formatRunnerDoctor,
  mapDurableJobToBackgroundResult,
  mapDurableJobToBackgroundStatus,
} from "./job-runner-presenter.js";

const baseJob: DurableJobState = {
  id: "job-test",
  goal: "check runner presenter",
  projectPath: "C:\\redacted\\project",
  phase: "Phase 17C",
  target: "presenter",
  plan: ["step one"],
  budget: {
    maxTokens: 50_000,
    maxRunningAgents: 3,
    maxSteps: 4,
    note: "cap note",
    usedTokens: 0,
    remainingTokens: 50_000,
    usedSteps: 0,
    maxRuntimeMs: 60_000,
  },
  timeoutMs: 60_000,
  permissionPolicy: "default",
  allowEdit: false,
  allowBash: false,
  allowMultiAgent: false,
  status: "running",
  agents: [],
  createdAt: "2026-05-23T00:00:00.000Z",
  updatedAt: "2026-05-23T00:00:01.000Z",
  logPath: "job.log",
  reportPath: "report.md",
  fullOutputPath: "full-output.log",
  evidenceRefs: [],
  verification: { status: "partial", summary: "not PASS" },
  adoptedConclusions: [],
  rejectedConclusions: [],
};

const baseBackground: BackgroundTaskState = {
  id: "job-test",
  kind: "job",
  title: "Job: safe",
  status: "timeout",
  currentStep: "timeout",
  progress: { completed: 1, total: 4, label: "worker steps" },
  startedAt: "2026-05-23T00:00:00.000Z",
  updatedAt: "2026-05-23T00:00:01.000Z",
  heartbeatIntervalMs: 30_000,
  staleAfterMs: 60_000,
  logPath: "job.log",
  outputPath: "full-output.log",
  hasOutput: true,
  result: "timeout",
  userVisibleSummary: "Job timeout; no evidence that verification passed was generated.",
  nextAction:
    "Inspect /job report job-test; lifecycle states never count as evidence that verification passed.",
};

describe("job runner presenters", () => {
  it("formats runner disabled, missing, and ready states without claiming full native benefits", () => {
    const disabled = formatRunnerDoctor(
      {
        status: "disabled",
        enabled: false,
        source: "disabled",
        pathRef: "disabled",
        bundledCandidateRef: "bundled:win32-x64/linghun-native-runner.exe",
        platform: "win32",
        arch: "x64",
        platformArch: "win32-x64",
        nodeFallback: "available",
        nextAction: "Native runner is disabled; Node/TUI remains the fallback for durable jobs.",
      },
      "linghun-native-runner-prototype.v1",
      (value) => value,
    );
    expect(disabled).toContain("Native Runner Doctor：disabled");
    expect(disabled).toContain("Node fallback available");
    expect(disabled).toContain("runner only accepts Linghun-approved job specs");
    expect(disabled).not.toContain("Beta PASS");
    expect(disabled).not.toContain("smoke-ready");

    const missing = formatRunnerDoctor(
      {
        status: "unavailable",
        enabled: true,
        source: "bundled",
        pathRef: "missing",
        bundledCandidateRef: "bundled:win32-x64/linghun-native-runner.exe",
        platform: "win32",
        arch: "x64",
        platformArch: "win32-x64",
        nodeFallback: "available",
        lastError: "runner binary is missing or not executable",
        nextAction:
          "Bundled runner is unavailable; reinstall/repair Linghun or continue with Node fallback.",
      },
      "linghun-native-runner-prototype.v1",
      (value) => value,
    );
    expect(missing).toContain("fallback reason: runner binary is missing or not executable");
    expect(missing).toContain("Node fallback available");

    const ready = formatRunnerDoctor(
      {
        status: "available",
        enabled: true,
        source: "bundled",
        pathRef: "present:linghun-native-runner.cjs",
        bundledCandidateRef: "bundled:win32-x64/linghun-native-runner.cjs",
        version: "0.1.0",
        protocol: "linghun-native-runner-prototype.v1",
        platform: "win32",
        arch: "x64",
        platformArch: "win32-x64",
        nodeFallback: "available",
        nextAction:
          "Native runner may supervise approved durable job specs; Node fallback remains available.",
      },
      "linghun-native-runner-prototype.v1",
      (value) => value,
    );
    expect(ready).toContain("Native Runner Doctor：available");
    expect(ready).toContain("fallback reason: none");
    expect(ready).toContain("cannot decide whether verification passed");
  });

  it("formats fallback and placeholder runner summaries without full native-benefit claims", () => {
    expect(formatJobRunnerInline(baseJob)).toBe("runner not started; Node/TUI default");
    expect(formatJobRunnerReportLine(baseJob)).toBe(
      "- runner: not_started; Node/TUI default path remains active.",
    );

    const fallbackJob: DurableJobState = {
      ...baseJob,
      runner: {
        enabled: true,
        status: "node_fallback",
        resolution: "unavailable",
        adapter: "node",
        pathRef: "missing",
        updatedAt: "2026-05-23T00:00:01.000Z",
        lastError: "runner unavailable",
        fallbackReason: "unavailable",
        nextAction: "Node/TUI fallback is active; inspect /job report and logs.",
      },
    };
    expect(formatJobRunnerInline(fallbackJob)).toBe(
      "runner node/node_fallback; resolution unavailable; fallback unavailable",
    );
    expect(formatJobRunnerReportLine(fallbackJob)).toContain("adapter node; status node_fallback");
    expect(formatJobRunnerReportLine(fallbackJob)).toContain("fallback unavailable");
    expect(formatJobRunnerReportLine(fallbackJob)).not.toContain("smoke-ready");
  });

  it("formats durable job background status summaries with status, next action, and artifact refs only", () => {
    expect(mapDurableJobToBackgroundStatus("running")).toBe("running");
    expect(mapDurableJobToBackgroundStatus("created")).toBe("paused");
    expect(mapDurableJobToBackgroundStatus("sleeping")).toBe("paused");
    expect(mapDurableJobToBackgroundStatus("blocked")).toBe("blocked");
    expect(mapDurableJobToBackgroundResult("completed")).toBe("partial");
    expect(mapDurableJobToBackgroundResult("timeout")).toBe("timeout");
    expect(formatJobNextAction(baseJob, "en-US")).toContain("/job cancel job-test");
    expect(
      formatJobNextAction(
        { ...baseJob, status: "blocked", pauseReason: "agent_blocked:agent-1" },
        "zh-CN",
      ),
    ).not.toContain("handoff/evidence/index");
    expect(
      formatJobNextAction(
        { ...baseJob, status: "blocked", pauseReason: "agent_blocked:agent-1" },
        "en-US",
      ),
    ).toContain("blocked child agent cause");
    expect(formatJobNextAction({ ...baseJob, status: "sleeping" }, "en-US")).toContain(
      "/job resume job-test",
    );
    expect(formatJobNextAction({ ...baseJob, status: "stale" }, "en-US")).toContain(
      "owner/heartbeat",
    );
    expect(formatJobNextAction({ ...baseJob, status: "completed" }, "en-US")).toContain(
      "run verification before treating the work as passed",
    );
    expect(formatJobNextAction({ ...baseJob, status: "completed" }, "en-US")).not.toContain("PASS");

    const rendered = formatBackgroundTask(baseBackground, "en-US");
    expect(rendered).toContain("[background] Job: safe · timeout · timeout 1/4 worker steps");
    expect(rendered).toContain("elapsed ");
    expect(rendered).not.toContain("log:");
    expect(rendered).not.toContain("next:");
    expect(rendered).not.toContain("complete raw log line");

    const narrow = formatBackgroundTask(
      {
        ...baseBackground,
        title:
          "Background task with a very long title that should be truncated before it dominates narrow terminals",
        currentStep:
          "collecting diagnostics with a very long step name that should stay bounded in the primary row",
        nextAction:
          "Inspect /job report job-test, then resume only after checking handoff and logs.",
      },
      "en-US",
    );
    expect(narrow.length).toBeLessThanOrEqual(120);
    expect(narrow).toContain("…");
  });

  it("formats task panel rows with title, status, progress, current step, and next action only", () => {
    const task: BackgroundTaskState = {
      ...baseBackground,
      kind: "verification",
      title: "Verification gate",
      status: "stale",
      currentStep: "sourceRef schema debug runner=abc endpoint raw evidence",
      nextAction: "Open /details background job-test instead of raw logs",
      progress: { completed: 2, total: 5, label: "checks" },
    };

    const row = formatBackgroundTaskPanelRow(task, "en-US");
    const details = formatBackgroundTaskPanelDetails(task, "en-US", "C:\\redacted\\project");

    expect(row).toContain("Verification gate");
    expect(row).toContain("stale");
    expect(row).toContain("2/5 checks");
    expect(row).toContain("/details background job-test");
    expect(row).not.toContain("sourceRef");
    expect(row).not.toContain("schema");
    expect(row).not.toContain("endpoint");
    expect(row).not.toContain("runner=");
    expect(details).toContain("- current step:");
    expect(details).toContain("- next action:");
    expect(details).toContain("- details: /details background job-test");
  });

  it("shell/git/process primary background row omits long command, log path, checkpoint id, and raw JSON", () => {
    const task: BackgroundTaskState = {
      ...baseBackground,
      title:
        'powershell -NoProfile -Command "git status --porcelain; Get-Content C:\\secret\\runner.log"',
      currentStep:
        'checkpoint id chk_abcdef1234567890 payload {"schema":{"debug":true},"raw":"value"}',
      logPath: "C:\\secret\\runner.log",
      outputPath: "C:\\secret\\full-output.log",
      userVisibleSummary:
        "full command and raw JSON are available only in details, not the primary row",
    };

    const row = formatBackgroundTask(task, "en-US");

    expect(row).toContain("[background]");
    expect(row).toContain("elapsed ");
    expect(row).not.toContain("C:\\secret");
    expect(row).not.toContain("runner.log");
    expect(row).not.toContain("full-output.log");
    expect(row).not.toContain("chk_abcdef1234567890");
    expect(row).not.toContain('"schema"');
    expect(row).not.toContain('"raw"');
  });

  it("formats bounded elapsed duration for task surfaces", () => {
    expect(
      formatElapsedSince("2026-05-23T00:00:00.000Z", Date.parse("2026-05-23T00:00:42.000Z")),
    ).toBe("42s");
    expect(
      formatElapsedSince("2026-05-23T00:00:00.000Z", Date.parse("2026-05-23T00:03:05.000Z")),
    ).toBe("3m05s");
    expect(
      formatElapsedSince("2026-05-23T00:00:00.000Z", Date.parse("2026-05-23T02:04:00.000Z")),
    ).toBe("2h04m");
  });

  it("formats failed, timeout, and cancelled summaries without secrets when state is already bounded", () => {
    for (const result of ["fail", "timeout", "cancelled"] as const) {
      const task: BackgroundTaskState = {
        ...baseBackground,
        status: result === "fail" ? "failed" : result,
        result,
        userVisibleSummary: `Command ended with ${result}; do not claim it passed.`,
        nextAction: "Inspect the log, fix the issue, then rerun if needed.",
      };
      const rendered = formatBackgroundDetails(task, "en-US");
      expect(rendered).toContain(`result ${result}`);
      expect(rendered).toContain("- why stale/blocked:");
      expect(rendered).toContain("- resume/cancel: Inspect the log");
      expect(rendered).toContain("- summary: Command ended with");
      expect(rendered).not.toMatch(/sk-[A-Za-z0-9_-]+|api[_-]?key|Bearer\s+raw|C:\\secret/u);
    }
  });

  it("keeps details output at artifact boundary without reading files", () => {
    const rendered = formatBackgroundOutputDetails(baseBackground, "zh-CN");
    expect(rendered).toBe(
      [
        "Background output job-test",
        "- path: full-output.log",
        "- hasOutput: true",
        "- status: timeout",
        "- summary: Job timeout; no evidence that verification passed was generated.",
        "- slices: /details output job-test --tail 40 | --grep <pattern> --context 2 | --errors",
      ].join("\n"),
    );
  });

  it("Run 2 P3-7: background presenters redact absolute user paths", () => {
    const rawPath = "C:\\Users\\Admin\\AppData\\Local\\Temp\\linghun\\job.log";
    const task: BackgroundTaskState = {
      ...baseBackground,
      logPath: rawPath,
      outputPath: "C:\\Users\\Admin\\AppData\\Local\\Temp\\linghun\\transcript.jsonl",
      userVisibleSummary: `outputPath: ${rawPath}`,
    };

    const details = formatBackgroundDetails(task, "zh-CN");
    const output = formatBackgroundOutputDetails(task, "zh-CN");
    const row = formatBackgroundTask(task, "zh-CN");

    expect(details).not.toContain("C:\\Users\\Admin");
    expect(output).not.toContain("C:\\Users\\Admin");
    expect(row).not.toContain("C:\\Users\\Admin");
    expect(details).toContain("[user-home]/.../transcript.jsonl");
  });

  it("keeps job lifecycle wording in details without verification-pass claims", () => {
    const rendered = formatBackgroundDetails(baseBackground, "en-US");

    expect(rendered).toContain("no evidence that verification passed was generated");
    expect(rendered).toContain("never count as evidence");
    expect(rendered).not.toContain("PASS evidence");
    expect(rendered).not.toContain("verification PASS");
  });
});
