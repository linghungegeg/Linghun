import { describe, expect, it } from "vitest";
import {
  classifyProviderFailure,
  formatProviderFailurePrimary,
  formatRequestActivity,
  projectWorkRequestState,
  type RequestActivityPhase,
} from "./request-lifecycle-presenter.js";

describe("formatRequestActivity", () => {
  const phases: RequestActivityPhase[] = [
    "request_started",
    "request_started_report",
    "waiting_first_delta",
    "compacting_context",
    "tool_running",
    "continuing_after_tool",
    "permission_waiting",
    "verifying_final_answer",
    "provider_retrying",
    "provider_recovering",
    "provider_switching",
  ];

  it("returns non-empty string for every phase in zh-CN", () => {
    for (const phase of phases) {
      const result = formatRequestActivity(phase, "zh-CN");
      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
    }
  });

  it("returns non-empty string for every phase in en-US", () => {
    for (const phase of phases) {
      const result = formatRequestActivity(phase, "en-US");
      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
    }
  });

  it("tool_running includes the tool name", () => {
    expect(formatRequestActivity("tool_running", "zh-CN", { toolName: "Read" })).toContain("Read");
    expect(formatRequestActivity("tool_running", "en-US", { toolName: "Read" })).toContain("Read");
  });

  it("provider_retrying labels the counter as automatic retries", () => {
    const zhResult = formatRequestActivity("provider_retrying", "zh-CN", {
      retryAttempt: 2,
      retryMax: 5,
      retryDelaySec: 3,
    });
    const enResult = formatRequestActivity("provider_retrying", "en-US", {
      retryAttempt: 2,
      retryMax: 5,
      retryDelaySec: 3,
    });
    expect(zhResult).toContain("自动重试 2/5");
    expect(zhResult).toContain("3");
    expect(enResult).toContain("Automatic retry 2/5");
    expect(enResult).toContain("3");
  });

  it("request_started_report includes report path", () => {
    const result = formatRequestActivity("request_started_report", "en-US", {
      reportPath: "docs/report.md",
    });
    expect(result).toContain("docs/report.md");
  });

  it("request_started falls through to default thinking text", () => {
    expect(formatRequestActivity("request_started", "zh-CN")).toContain("思考");
    expect(formatRequestActivity("request_started", "en-US")).toContain("Thinking");
  });
});

describe("projectWorkRequestState", () => {
  it("projects request activity phases into a stable work request lifecycle", () => {
    const startedAtMs = 1_000;
    const state = projectWorkRequestState({
      language: "zh-CN",
      requestPhase: "tool_running",
      startedAtMs,
      nowMs: 3_500,
      toolName: "Read",
      toolTarget: "packages/tui/src/view-model.ts",
    });

    expect(state).toMatchObject({
      phase: "tool_running",
      source: "tool",
      title: "运行 Read…",
      summary: "packages/tui/src/view-model.ts",
      elapsedMs: 2_500,
    });
  });

  it("keeps permission waiting separate from general request activity", () => {
    const state = projectWorkRequestState({
      language: "en-US",
      requestPhase: "tool_running",
      permissionToolName: "Edit",
      permissionSummary: "Edit wants to write TUI-CONTEXT-FOOTER-PLAN.md",
      permissionNextAction: "Enter confirm / d details / Esc cancel",
    });

    expect(state).toMatchObject({
      phase: "permission_waiting",
      source: "permission",
      title: "Waiting for approval · Edit",
      summary: "Edit wants to write TUI-CONTEXT-FOOTER-PLAN.md",
      nextAction: "Enter confirm / d details / Esc cancel",
    });
  });

  it("projects verification, provider recovery, agent, and background sources", () => {
    expect(
      projectWorkRequestState({ language: "en-US", requestPhase: "verifying_final_answer" }),
    ).toMatchObject({ phase: "verification_running", source: "verification" });
    expect(
      projectWorkRequestState({ language: "zh-CN", requestPhase: "provider_switching" }),
    ).toMatchObject({ phase: "provider_recovering", source: "provider" });
    expect(projectWorkRequestState({ language: "en-US", agentsRunning: 2 })).toMatchObject({
      phase: "agent_running",
      source: "agent",
      title: "2 agents running",
    });
    expect(
      projectWorkRequestState({
        language: "zh-CN",
        backgroundTasksRunning: 1,
        includeBackgroundRunning: true,
      }),
    ).toMatchObject({
      phase: "background_running",
      source: "background",
      title: "1 个后台任务运行中",
    });
  });
});

describe("provider failure classification", () => {
  it("splits protocol, malformed stream, and tool stream failures out of transit", () => {
    expect(classifyProviderFailure({ code: "PROVIDER_NON_SSE_STREAM" })).toBe("compatibility");
    expect(classifyProviderFailure({ code: "PROVIDER_MALFORMED_STREAM" })).toBe("stream_parse");
    expect(classifyProviderFailure({ code: "PROVIDER_PARTIAL_TOOL_CALL" })).toBe("tool_stream");
    expect(classifyProviderFailure({ code: "PROVIDER_STREAM_DECODE_ERROR" })).toBe("transit");
  });

  it("formats distinct primary messages for compatibility and tool stream failures", () => {
    const nonSse = formatProviderFailurePrimary({ code: "PROVIDER_NON_SSE_STREAM" }, "zh-CN");
    const malformed = formatProviderFailurePrimary({ code: "PROVIDER_MALFORMED_STREAM" }, "zh-CN");
    const partialTool = formatProviderFailurePrimary({ code: "PROVIDER_PARTIAL_TOOL_CALL" }, "zh-CN");

    expect(nonSse).toContain("SSE");
    expect(nonSse).toContain("endpointProfile");
    expect(malformed).toContain("SSE 流格式异常");
    expect(partialTool).toContain("工具调用流不完整");
    expect(nonSse).not.toContain("暂时异常");
    expect(malformed).not.toContain("请稍后重试");
  });
});
