import { describe, expect, it } from "vitest";
import { evaluateChildAgentSummaryClaims } from "./job-agent-command-runtime.js";
import { formatAgentRunToolResultData } from "./model-tool-runtime.js";
import { formatAgentSummary } from "./tui-agent-job-runtime.js";
import type { AgentRun, EvidenceRecord } from "./tui-data-types.js";

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

describe("child agent summary claim gate", () => {
  const evidence = (supportsClaims: string[]): EvidenceRecord => ({
    id: `ev-${supportsClaims.join("-")}`,
    kind: "command_output",
    summary: "test evidence",
    source: "test",
    supportsClaims,
    createdAt: new Date().toISOString(),
  });

  it("does not downgrade ordinary read-only audit findings", () => {
    const result = evaluateChildAgentSummaryClaims(
      "只读审计完成：已读取 README.md 并列出风险边界。",
      [],
      "zh-CN",
    );

    expect(result.status).toBe("passed");
    expect(result.text).toContain("只读审计完成");
  });

  it("downgrades unsupported test pass claims before agent summary returns", () => {
    const result = evaluateChildAgentSummaryClaims("测试通过，PASS。", [], "zh-CN");

    expect(result.status).toBe("downgraded");
    expect(result.text).toContain("高风险结论");
    expect(result.missingEvidenceKinds).toContain("test result evidence");
  });

  it("allows test pass claims when matching test evidence exists", () => {
    const result = evaluateChildAgentSummaryClaims(
      "测试通过，PASS。",
      [evidence(["test_passed"])],
      "zh-CN",
    );

    expect(result.status).toBe("passed");
  });

  it("downgrades unsupported file change claims", () => {
    const result = evaluateChildAgentSummaryClaims("已经修复完成。", [], "zh-CN");

    expect(result.status).toBe("downgraded");
    expect(result.missingEvidenceKinds).toContain("file change evidence");
  });
});
