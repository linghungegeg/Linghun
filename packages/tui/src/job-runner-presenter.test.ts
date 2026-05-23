import { describe, expect, it } from "vitest";
import type { BackgroundTaskState, DurableJobState } from "./index.js";
import {
  formatBackgroundDetails,
  formatBackgroundOutputDetails,
  formatBackgroundTask,
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
  userVisibleSummary: "Job timeout; no PASS evidence generated.",
  nextAction:
    "Inspect /job report job-test; completed/cancelled/timeout/stale/blocked never count as verification PASS.",
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
    expect(disabled).toContain("Node fallback=available");
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
    expect(missing).toContain("Node fallback=available");

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
    expect(ready).toContain("cannot decide verification PASS");
  });

  it("formats fallback and placeholder runner summaries without full native-benefit claims", () => {
    expect(formatJobRunnerInline(baseJob)).toBe("runner=not_started; Node/TUI default");
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
      "runner=node/node_fallback; resolution=unavailable; fallback=unavailable",
    );
    expect(formatJobRunnerReportLine(fallbackJob)).toContain("adapter=node; status=node_fallback");
    expect(formatJobRunnerReportLine(fallbackJob)).toContain("fallback=unavailable");
    expect(formatJobRunnerReportLine(fallbackJob)).not.toContain("smoke-ready");
  });

  it("formats durable job background status summaries with status, next action, and artifact refs only", () => {
    expect(mapDurableJobToBackgroundStatus("running")).toBe("running");
    expect(mapDurableJobToBackgroundStatus("blocked")).toBe("paused");
    expect(mapDurableJobToBackgroundResult("completed")).toBe("partial");
    expect(mapDurableJobToBackgroundResult("timeout")).toBe("timeout");
    expect(formatJobNextAction(baseJob, "en-US")).toContain("/job cancel job-test");

    const rendered = formatBackgroundTask(baseBackground, "en-US");
    expect(rendered).toContain("[background] Job: safe · timeout · timeout 1/4");
    expect(rendered).toContain("log: job.log");
    expect(rendered).toContain("next: Inspect /job report job-test");
    expect(rendered).not.toContain("complete raw log line");
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
      expect(rendered).toContain(`- result: ${result}`);
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
        "- summary: Job timeout; no PASS evidence generated.",
        "- slices: /details output job-test --tail 40 | --grep <pattern> --context 2 | --errors",
      ].join("\n"),
    );
  });
});
