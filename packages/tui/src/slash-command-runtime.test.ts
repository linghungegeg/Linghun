import { describe, expect, it } from "vitest";
import {
  recordAgentExecutionEvidence,
  recordAgentMailboxEvidence,
} from "./slash-command-runtime.js";
import type { AgentMailboxMessage, AgentRun, EvidenceRecord } from "./tui-data-types.js";

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
    ...overrides,
  };
}

function makeContext() {
  const events: unknown[] = [];
  return {
    projectPath: "F:/repo",
    currentRequestTurnId: "request-current",
    backgroundTasks: [
      {
        id: "agent-1",
        kind: "agent",
        title: "agent 1",
        status: "running",
        startedAt: "2026-06-12T00:00:00.000Z",
        updatedAt: "2026-06-12T00:00:00.000Z",
        heartbeatIntervalMs: 1_000,
        staleAfterMs: 60_000,
        hasOutput: false,
        workflowRunId: "workflow-1",
      },
    ],
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

  it("scopes terminal and mailbox evidence to the invoking agent owner", async () => {
    const context = makeContext();
    const agent = makeAgent({
      invokingRequestTurnId: "request-invoking",
      cwd: "F:/repo/worktrees/agent-1",
    });
    const message: AgentMailboxMessage = {
      id: "msg-1",
      from: "user",
      to: "agent-1",
      text: "continue",
      createdAt: "2026-06-12T00:00:01.000Z",
      status: "consumed",
      summary: "continue request",
    };

    await recordAgentExecutionEvidence(context as never, "session-1", agent, {
      status: "completed",
      summary: "agent completed",
    });
    await recordAgentMailboxEvidence(context as never, "session-1", agent, [message]);

    expect(context.evidence).toHaveLength(2);
    expect(context.evidence.map((item) => item.ownerScope)).toEqual([
      expect.objectContaining({
        ownerSessionId: "session-1",
        requestTurnId: "request-invoking",
        ownerAgentId: "agent-1",
        workflowRunId: "workflow-1",
        cwd: "F:/repo/worktrees/agent-1",
      }),
      expect.objectContaining({
        ownerSessionId: "session-1",
        requestTurnId: "request-invoking",
        ownerAgentId: "agent-1",
        workflowRunId: "workflow-1",
        cwd: "F:/repo/worktrees/agent-1",
      }),
    ]);
    expect(context.evidence.map((item) => item.ownerScope?.requestTurnId)).not.toContain(
      "request-current",
    );
  });
});
