import { describe, expect, it } from "vitest";
import {
  collectPendingAgentCompletionNotices,
  createAgentCompletionState,
  enqueueAgentCompletionNotice,
  formatAgentCompletionDigest,
  markAgentCompletionNoticeReported,
} from "./agent-completion-finalizer.js";
import type { TuiContext } from "./tui-context-runtime.js";
import type { AgentRun } from "./tui-data-types.js";

function createContext(language: "zh-CN" | "en-US" = "zh-CN"): TuiContext {
  return {
    language,
    notifications: [],
    agentCompletions: createAgentCompletionState(),
  } as unknown as TuiContext;
}

function createAgent(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: "agent-test",
    type: "worker",
    role: "executor",
    provider: "test-provider",
    parentSessionId: "session-test",
    forkedFrom: "handoff-test",
    task: "audit the project",
    model: "test-model",
    permissionMode: "default",
    status: "idle",
    lastTerminalStatus: "completed",
    activityStatus: "idle",
    activitySummary: "done",
    transcriptPath: "transcript.jsonl",
    transcriptSessionId: "child-session",
    mailbox: [],
    summary: "agent completed with source evidence",
    contextSummary: "test context",
    cost: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      estimatedCny: 0,
    },
    startedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("agent-completion-finalizer", () => {
  it("turns a completed agent result into a valid pending notice and batch summary", () => {
    const context = createContext();
    const notice = enqueueAgentCompletionNotice(context, {
      agent: createAgent(),
      status: "completed",
      summary: "Agent completed with source evidence and should be reviewed before pass claims.",
      evidenceRefs: ["ev-source-1"],
      now: "2026-01-01T00:00:01.000Z",
    });

    expect(notice.validity).toBe("valid");
    expect(notice.evidenceRefs).toEqual(["ev-source-1"]);
    expect(collectPendingAgentCompletionNotices(context)).toHaveLength(1);
    expect(context.agentCompletions?.batchSummaries[0]).toMatchObject({
      total: 1,
      valid: 1,
      completed: 1,
      evidenceRefs: ["ev-source-1"],
    });
    expect(context.notifications?.[0]?.text).toContain("已回流");
  });

  it("keeps failed returns invalid until reported and does not equate them with verification pass", () => {
    const context = createContext();
    const notice = enqueueAgentCompletionNotice(context, {
      agent: createAgent({ id: "agent-failed", status: "failed", lastTerminalStatus: "failed" }),
      status: "failed",
      summary: "Provider failed before the agent produced a usable summary.",
      evidenceRefs: [],
      now: "2026-01-01T00:00:02.000Z",
    });

    const digest = formatAgentCompletionDigest(context);
    expect(notice.validity).toBe("invalid");
    expect(digest).toContain("Agent 结果已回流：1 条待处理通知");
    expect(digest).toContain("不要把回流结果直接等同于全部通过");

    markAgentCompletionNoticeReported(context, notice.id, "2026-01-01T00:00:03.000Z");
    expect(collectPendingAgentCompletionNotices(context)).toHaveLength(0);
    expect(formatAgentCompletionDigest(context)).toBeNull();
  });
});
