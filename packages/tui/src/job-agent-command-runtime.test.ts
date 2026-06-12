import { describe, expect, it } from "vitest";
import { formatAgentRunToolResultData } from "./model-tool-runtime.js";
import { formatAgentSummary } from "./tui-agent-job-runtime.js";
import type { AgentRun } from "./tui-data-types.js";

function makeAgent(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: "agent-1",
    type: "worker",
    role: "executor",
    provider: "test",
    task: "audit",
    model: "test-model",
    permissionMode: "default",
    status: "idle",
    lastTerminalStatus: "completed",
    summary: "worker completed: short summary",
    contextSummary: "agent context",
    lastResultSummary: "short summary",
    lastResultFullReport: "full child final report with all findings",
    transcriptPath: "agent-1.jsonl",
    transcriptSessionId: "child-session",
    mailbox: [],
    cost: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      estimatedCny: 0,
    },
    startedAt: "2026-06-12T00:00:00.000Z",
    updatedAt: "2026-06-12T00:00:00.000Z",
    ...overrides,
  };
}

describe("agent terminal status and full report consumption", () => {
  it("formats idle completed agents using lastTerminalStatus instead of plain idle", () => {
    const line = formatAgentSummary(makeAgent(), {} as never);

    expect(line).toContain("completed");
    expect(line).not.toContain("· idle ·");
  });

  it("exposes full child report and transcript id in tool result data", () => {
    const data = formatAgentRunToolResultData(makeAgent());

    expect(data).toMatchObject({
      agentId: "agent-1",
      status: "idle",
      lastTerminalStatus: "completed",
      transcriptSessionId: "child-session",
      recentResult: "short summary",
      resultFullReport: "full child final report with all findings",
    });
  });

  it("keeps missing agents explicit instead of fabricating a report", () => {
    expect(formatAgentRunToolResultData(undefined)).toEqual({ status: "not_found" });
  });
});
