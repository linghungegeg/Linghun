import { describe, expect, it } from "vitest";
import { formatRequestActivity, type RequestActivityPhase } from "./request-lifecycle-presenter.js";

describe("formatRequestActivity", () => {
  const phases: RequestActivityPhase[] = [
    "request_started",
    "request_started_report",
    "waiting_first_delta",
    "tool_running",
    "continuing_after_tool",
    "permission_waiting",
    "verifying_final_answer",
    "provider_retrying",
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

  it("provider_retrying includes attempt/max info", () => {
    const result = formatRequestActivity("provider_retrying", "zh-CN", {
      retryAttempt: 2,
      retryMax: 5,
      retryDelaySec: 3,
    });
    expect(result).toContain("2");
    expect(result).toContain("5");
    expect(result).toContain("3");
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
