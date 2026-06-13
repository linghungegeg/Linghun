import { describe, expect, it } from "vitest";
import { recordAgentExecutionEvidence } from "./slash-command-runtime.js";
import type { AgentRun, EvidenceRecord } from "./tui-data-types.js";

function makeAgent(): AgentRun {
  return {
    id: "agent-1",
    type: "worker",
    role: "executor",
    provider: "test",
    task: "audit",
    model: "test-model",
    permissionMode: "default",
    status: "idle",
    summary: "agent idle",
    contextSummary: "agent context",
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
  };
}

function makeContext() {
  const events: unknown[] = [];
  return {
    evidence: [] as EvidenceRecord[],
    store: {
      appendEvent: async (_sessionId: string, event: unknown) => {
        events.push(event);
      },
    },
    events,
  };
}

describe("recordAgentExecutionEvidence", () => {
  it("marks completed agent evidence with agent_terminal_status", async () => {
    const context = makeContext();

    await recordAgentExecutionEvidence(context as never, "session-1", makeAgent(), {
      status: "completed",
      summary: "agent completed",
    });

    expect(context.evidence).toHaveLength(1);
    expect(context.evidence[0].supportsClaims).toContain("agent_terminal_status");
    expect(context.evidence[0].supportsClaims).toContain("action_executed");
  });

  it("does not mark failed agent evidence as terminal successful status", async () => {
    const context = makeContext();

    await recordAgentExecutionEvidence(context as never, "session-1", makeAgent(), {
      status: "failed",
      summary: "agent failed",
    });

    expect(context.evidence).toHaveLength(1);
    expect(context.evidence[0].supportsClaims).toContain("tool_failure");
    expect(context.evidence[0].supportsClaims).not.toContain("agent_terminal_status");
  });
});
