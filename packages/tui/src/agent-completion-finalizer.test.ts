import { describe, expect, it, vi } from "vitest";
import {
  appendAgentCompletionSystemEvent,
  collectPendingAgentCompletionNotices,
  createAgentCompletionState,
  enqueueAgentCompletionNotice,
  formatAgentCompletionDigest,
  formatAgentCompletionMainChainContext,
  markAgentCompletionNoticeDelivered,
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
    expect(context.notifications).toEqual([]);
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
    expect(digest).toContain("智能体结果：1 条待处理通知");
    expect(digest).toContain("不要把结果直接等同于全部通过");
    expect(context.notifications).toEqual([]);

    markAgentCompletionNoticeReported(context, notice.id, "2026-01-01T00:00:03.000Z");
    expect(collectPendingAgentCompletionNotices(context)).toHaveLength(0);
    expect(formatAgentCompletionDigest(context)).toBeNull();
  });

  it("keeps completion notices scoped to their owner session and reports each once", () => {
    const context = createContext();
    const noticeA = enqueueAgentCompletionNotice(context, {
      agent: createAgent({ id: "agent-a", parentSessionId: "session-a" }),
      status: "completed",
      summary: "session A result",
      evidenceRefs: ["ev-a"],
      now: "2026-01-01T00:00:01.000Z",
    });
    const noticeB = enqueueAgentCompletionNotice(context, {
      agent: createAgent({ id: "agent-b", parentSessionId: "session-b" }),
      status: "completed",
      summary: "session B result",
      evidenceRefs: ["ev-b"],
      now: "2026-01-01T00:00:02.000Z",
    });

    context.sessionId = "session-b";
    expect(collectPendingAgentCompletionNotices(context).map((notice) => notice.id)).toEqual([
      noticeB.id,
    ]);
    expect(formatAgentCompletionMainChainContext(context)).toContain("session B result");
    expect(formatAgentCompletionMainChainContext(context)).not.toContain("session A result");
    markAgentCompletionNoticeReported(context, noticeB.id);

    context.sessionId = "session-a";
    expect(collectPendingAgentCompletionNotices(context).map((notice) => notice.id)).toEqual([
      noticeA.id,
    ]);
    expect(formatAgentCompletionDigest(context)).toContain("session A result");
    expect(formatAgentCompletionDigest(context)).not.toContain("session B result");
    markAgentCompletionNoticeReported(context, noticeA.id);
    expect(collectPendingAgentCompletionNotices(context)).toEqual([]);
  });

  it("does not push a pass ProductBlock into the main transcript by default", () => {
    const transcriptBlocks: Array<{ id: string; kind: string; status: string; title: string; summary: string }> = [];
    const context = createContext();
    (context as { pushTranscriptBlock?: (block: unknown) => void }).pushTranscriptBlock = (block) =>
      transcriptBlocks.push(block as (typeof transcriptBlocks)[0]);

    const notice = enqueueAgentCompletionNotice(context, {
      agent: createAgent({ id: "agent-block", displayName: "reviewer" }),
      status: "completed",
      summary: "code review done",
      evidenceRefs: [],
      now: "2026-06-13T00:00:01.000Z",
    });

    expect(notice.status).toBe("completed");
    expect(notice.validity).toBe("partial");
    expect(transcriptBlocks).toHaveLength(0);
    expect(formatAgentCompletionDigest(context)).toContain("不要把结果直接等同于全部通过");
  });

  it("does not push transcript blocks when creating or updating an existing notice", () => {
    const transcriptBlocks: unknown[] = [];
    const context = createContext();
    (context as { pushTranscriptBlock?: (block: unknown) => void }).pushTranscriptBlock = (block) =>
      transcriptBlocks.push(block);

    const agent = createAgent({ id: "agent-dup", displayName: "builder" });
    enqueueAgentCompletionNotice(context, {
      agent,
      status: "completed",
      summary: "first pass",
      evidenceRefs: [],
      now: "2026-06-13T00:00:01.000Z",
    });
    enqueueAgentCompletionNotice(context, {
      agent,
      status: "completed",
      summary: "updated pass",
      evidenceRefs: ["ev-2"],
      now: "2026-06-13T00:00:02.000Z",
    });

    expect(transcriptBlocks).toHaveLength(0);
  });

  it("formats pending completions as internal main-chain context until reported", () => {
    const transcriptBlocks: unknown[] = [];
    const context = createContext();
    (context as { pushTranscriptBlock?: (block: unknown) => void }).pushTranscriptBlock = (block) =>
      transcriptBlocks.push(block);

    const notice = enqueueAgentCompletionNotice(context, {
      agent: createAgent({ id: "agent-main-chain", displayName: "worker" }),
      status: "completed",
      summary: "worker edited the focused test and verified the narrow suite",
      evidenceRefs: ["ev-read", "ev-test"],
      now: "2026-06-13T00:00:01.000Z",
    });

    const promptContext = formatAgentCompletionMainChainContext(context);
    expect(promptContext).toContain("AgentCompletionReturnsForMainChain=");
    expect(promptContext).toContain("agent-main-chain");
    expect(promptContext).toContain("worker edited the focused test");
    expect(promptContext).toContain("ev-test");
    expect(transcriptBlocks).toHaveLength(0);

    markAgentCompletionNoticeReported(context, notice.id, "2026-06-13T00:00:02.000Z");
    expect(formatAgentCompletionMainChainContext(context)).toBeNull();
  });

  it("returns bounded full child reports to the main chain without treating them as verification pass", () => {
    const context = createContext("en-US");
    const fullReport =
      "Full child report:\n" +
      [
        "Finding A: packages/tui/src/a.ts has scoped evidence.",
        "Finding B: packages/tui/src/b.ts still needs parent synthesis.",
      ].join("\n") +
      "\n" +
      "x".repeat(9000);
    const notice = enqueueAgentCompletionNotice(context, {
      agent: createAgent({
        id: "agent-full-report",
        displayName: "worker",
        lastResultFullReport: fullReport,
      }),
      status: "completed",
      summary: "worker completed with a short digest",
      evidenceRefs: ["ev-source"],
      now: "2026-06-13T00:00:01.000Z",
    });

    const promptContext = formatAgentCompletionMainChainContext(context);

    expect(notice.summary).toBe("worker completed with a short digest");
    expect(notice.resultFullReport).toContain("Finding A");
    expect(notice.resultFullReport?.length).toBeLessThanOrEqual(8001);
    expect(promptContext).toContain("resultFullReport");
    expect(promptContext).toContain("Finding B");
    expect(promptContext).toContain("diagnostic context");
    expect(promptContext).toContain("not as independent verification PASS");
  });

  it("refreshes an existing notice full report without pushing transcript blocks", () => {
    const transcriptBlocks: unknown[] = [];
    const context = createContext();
    (context as { pushTranscriptBlock?: (block: unknown) => void }).pushTranscriptBlock = (block) =>
      transcriptBlocks.push(block);
    const agent = createAgent({
      id: "agent-refresh-full-report",
      lastResultFullReport: "first full report",
    });

    enqueueAgentCompletionNotice(context, {
      agent,
      status: "completed",
      summary: "first summary",
      evidenceRefs: ["ev-1"],
      now: "2026-06-13T00:00:01.000Z",
    });
    agent.lastResultFullReport = "updated full report with parent synthesis material";
    enqueueAgentCompletionNotice(context, {
      agent,
      status: "completed",
      summary: "updated summary",
      evidenceRefs: ["ev-2"],
      now: "2026-06-13T00:00:02.000Z",
    });

    expect(collectPendingAgentCompletionNotices(context)).toHaveLength(1);
    expect(formatAgentCompletionMainChainContext(context)).toContain(
      "updated full report with parent synthesis material",
    );
    expect(transcriptBlocks).toHaveLength(0);
  });

  it("keeps delivered but unreported completions out of main-chain reinjection", () => {
    const context = createContext();
    const notice = enqueueAgentCompletionNotice(context, {
      agent: createAgent({ id: "agent-delivered", lastResultFullReport: "full delivered report" }),
      status: "completed",
      summary: "summary delivered to parent",
      evidenceRefs: ["ev-delivered"],
      now: "2026-06-13T00:00:01.000Z",
    });

    expect(formatAgentCompletionMainChainContext(context)).toContain("full delivered report");

    markAgentCompletionNoticeDelivered(context, notice.id, "2026-06-13T00:00:02.000Z");

    expect(formatAgentCompletionMainChainContext(context)).toBeNull();
    expect(collectPendingAgentCompletionNotices(context)).toHaveLength(1);
    expect(formatAgentCompletionDigest(context)).toContain("summary delivered to parent");

    markAgentCompletionNoticeReported(context, notice.id, "2026-06-13T00:00:03.000Z");
    expect(collectPendingAgentCompletionNotices(context)).toHaveLength(0);
  });
});

describe("appendAgentCompletionSystemEvent — reliable parent transcript write", () => {
  function createStoreContext(
    appendEvent: TuiContext["store"]["appendEvent"],
    sessionId?: string,
  ): TuiContext {
    return {
      language: "zh-CN",
      sessionId: sessionId ?? "main-session",
      notifications: [],
      agentCompletions: createAgentCompletionState(),
      store: { appendEvent } as unknown as TuiContext["store"],
    } as unknown as TuiContext;
  }

  it("writes agent_completion system_event to parent session on success", async () => {
    const events: Array<{ sessionId: string; event: unknown }> = [];
    const appendEvent = vi.fn(async (sessionId: string, event: unknown) => {
      events.push({ sessionId, event });
    });
    const context = createStoreContext(appendEvent, "session-test");

    const result = await appendAgentCompletionSystemEvent(context, {
      agentId: "agent-a",
      label: "worker-a",
      status: "completed",
      summary: "finished task",
      targetSession: "parent-session",
    });

    expect(result.written).toBe(true);
    expect(result.fallbackWarning).toBeUndefined();
    expect(appendEvent).toHaveBeenCalledTimes(1);
    const written = events[0];
    expect(written.sessionId).toBe("parent-session");
    expect((written.event as { type: string }).type).toBe("system_event");
    expect((written.event as { message: string }).message).toContain("agent_completion:agent-a");
    expect((written.event as { message: string }).message).toContain("status=completed");
    expect((written.event as { level: string }).level).toBe("info");
  });

  it("uses warning level for failed and cancelled statuses", async () => {
    const events: Array<{ event: unknown }> = [];
    const appendEvent = vi.fn(async (_s: string, event: unknown) => {
      events.push({ event });
    });
    const context = createStoreContext(appendEvent);

    await appendAgentCompletionSystemEvent(context, {
      agentId: "agent-f",
      label: "worker-f",
      status: "failed",
      summary: "provider error",
      targetSession: "parent-session",
    });
    expect((events[0].event as { level: string }).level).toBe("warning");

    await appendAgentCompletionSystemEvent(context, {
      agentId: "agent-c",
      label: "worker-c",
      status: "cancelled",
      summary: "user cancelled",
      targetSession: "parent-session",
    });
    expect((events[1].event as { level: string }).level).toBe("warning");
  });

  it("records observable warning when appendEvent fails instead of silently swallowing", async () => {
    const events: Array<{ sessionId: string; event: unknown }> = [];
    let callCount = 0;
    const appendEvent = vi.fn(async (sessionId: string, event: unknown) => {
      callCount++;
      if (callCount === 1) throw new Error("disk full");
      events.push({ sessionId, event });
      return Promise.resolve();
    });
    const context = createStoreContext(appendEvent, "main-session");

    const result = await appendAgentCompletionSystemEvent(context, {
      agentId: "agent-x",
      label: "worker-x",
      status: "blocked",
      summary: "blocked on permission",
      targetSession: "parent-session",
      fallbackSession: "main-session",
    });

    expect(result.written).toBe(false);
    expect(result.fallbackWarning).toContain("agent_completion_write_failed:agent-x");
    expect(result.fallbackWarning).toContain("disk full");
    expect(appendEvent).toHaveBeenCalledTimes(2);
    expect(events[0].sessionId).toBe("main-session");
    expect((events[0].event as { message: string }).message).toContain("agent_completion_write_failed");
  });

  it("writes separate system_events for multiple sequential agent completions", async () => {
    const events: Array<{ sessionId: string; event: unknown }> = [];
    const appendEvent = vi.fn(async (sessionId: string, event: unknown) => {
      events.push({ sessionId, event });
    });
    const context = createStoreContext(appendEvent);

    await appendAgentCompletionSystemEvent(context, {
      agentId: "agent-1",
      label: "reviewer",
      status: "completed",
      summary: "review done",
      targetSession: "parent-session",
    });
    await appendAgentCompletionSystemEvent(context, {
      agentId: "agent-2",
      label: "builder",
      status: "failed",
      summary: "build failed",
      targetSession: "parent-session",
    });
    await appendAgentCompletionSystemEvent(context, {
      agentId: "agent-3",
      label: "tester",
      status: "blocked",
      summary: "waiting approval",
      targetSession: "parent-session",
    });

    expect(events).toHaveLength(3);
    expect((events[0].event as { message: string }).message).toContain("agent-1");
    expect((events[1].event as { message: string }).message).toContain("agent-2");
    expect((events[2].event as { message: string }).message).toContain("agent-3");
  });

  it("multiple completions with digest still produces correct pending notices", async () => {
    const appendEvent = vi.fn(async () => {});
    const context = createStoreContext(appendEvent, "session-test");

    enqueueAgentCompletionNotice(context, {
      agent: createAgent({ id: "a1", displayName: "reviewer" }),
      status: "completed",
      summary: "done",
      evidenceRefs: ["ev-1"],
      now: "2026-06-13T00:00:01.000Z",
    });
    await appendAgentCompletionSystemEvent(context, {
      agentId: "a1",
      label: "reviewer",
      status: "completed",
      summary: "done",
      targetSession: "parent-session",
    });

    enqueueAgentCompletionNotice(context, {
      agent: createAgent({ id: "a2", displayName: "builder" }),
      status: "failed",
      summary: "build error",
      evidenceRefs: [],
      now: "2026-06-13T00:00:02.000Z",
    });
    await appendAgentCompletionSystemEvent(context, {
      agentId: "a2",
      label: "builder",
      status: "failed",
      summary: "build error",
      targetSession: "parent-session",
    });

    const digest = formatAgentCompletionDigest(context);
    expect(digest).toContain("2 条待处理通知");
    expect(collectPendingAgentCompletionNotices(context)).toHaveLength(2);
  });
});
