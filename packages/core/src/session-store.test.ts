import { readFileSync } from "node:fs";
import { appendFile, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionStore, assertValidSessionId } from "./session-store.js";
import {
  isUsableDeepCompactPacket,
  parseUsableTranscriptCompactBoundary,
} from "./session.js";

function makeUsableCompactProjection(summary: string) {
  return {
    boundaryId: "compact-boundary",
    createdAt: new Date(1).toISOString(),
    summary,
    pressureRatio: 0.9,
    preCompactChars: 10_000,
    postCompactChars: 2_000,
    discardedRange: "events 1-20",
    toolPairingSafe: true,
    risks: [],
    evidenceRefs: [],
  };
}

describe("SessionStore", () => {
  it("creates sessions with unique ids and lists the current project", async () => {
    const root = await mkdtemp(join(tmpdir(), "linghun-sessions-"));
    const project = await mkdtemp(join(tmpdir(), "linghun-project-"));
    const store = new SessionStore({ sessionRootDir: root, projectPath: project });

    const first = await store.create({ summary: "first" });
    const second = await store.create({ summary: "second" });
    const sessions = await store.list();

    expect(first.id).not.toBe(second.id);
    expect(sessions.map((session) => session.id)).toContain(first.id);
    expect(sessions.map((session) => session.id)).toContain(second.id);
  });

  it("keeps histories isolated per project", async () => {
    const root = await mkdtemp(join(tmpdir(), "linghun-sessions-"));
    const projectA = await mkdtemp(join(tmpdir(), "linghun-project-a-"));
    const projectB = await mkdtemp(join(tmpdir(), "linghun-project-b-"));
    const storeA = new SessionStore({ sessionRootDir: root, projectPath: projectA });
    const storeB = new SessionStore({ sessionRootDir: root, projectPath: projectB });

    const sessionA = await storeA.create({ summary: "project-a" });
    const sessionB = await storeB.create({ summary: "project-b" });

    expect((await storeA.list()).map((session) => session.id)).toEqual([sessionA.id]);
    expect((await storeB.list()).map((session) => session.id)).toEqual([sessionB.id]);
  });

  it("resumes metadata and transcript events", async () => {
    const root = await mkdtemp(join(tmpdir(), "linghun-sessions-"));
    const project = await mkdtemp(join(tmpdir(), "linghun-project-"));
    const store = new SessionStore({ sessionRootDir: root, projectPath: project });
    const session = await store.create();

    await store.appendEvent(session.id, {
      type: "user_message",
      id: "message-1",
      text: "你好",
      createdAt: new Date(0).toISOString(),
    });

    const resumed = await store.resume(session.id);

    expect(resumed.session.id).toBe(session.id);
    expect(resumed.transcript.map((event) => event.type)).toEqual([
      "session_start",
      "user_message",
    ]);
    expect(resumed.diagnostics).toEqual([]);
  });

  it("skips an owned event when its commit guard becomes stale", async () => {
    const root = await mkdtemp(join(tmpdir(), "linghun-sessions-"));
    const project = await mkdtemp(join(tmpdir(), "linghun-project-"));
    const store = new SessionStore({ sessionRootDir: root, projectPath: project });
    const session = await store.create();

    await store.appendEvent(
      session.id,
      {
        type: "tool_result",
        toolUseId: "late-tool",
        toolName: "Read",
        content: "late",
        createdAt: new Date(0).toISOString(),
      },
      () => false,
    );

    const resumed = await store.resume(session.id);
    expect(resumed.transcript.some((event) => event.type === "tool_result")).toBe(false);
  });

  it("linearizes the final owner guard with the transcript append", async () => {
    const root = await mkdtemp(join(tmpdir(), "linghun-sessions-"));
    const project = await mkdtemp(join(tmpdir(), "linghun-project-"));
    const store = new SessionStore({ sessionRootDir: root, projectPath: project });
    const session = await store.create();
    let guardCalls = 0;
    let transcriptObservedAfterGuard = "";

    await store.appendEvent(
      session.id,
      {
        type: "user_message",
        id: "linearized-message",
        text: "linearized",
        createdAt: new Date(0).toISOString(),
      },
      () => {
        guardCalls += 1;
        if (guardCalls === 2) {
          queueMicrotask(() => {
            transcriptObservedAfterGuard = readFileSync(session.transcriptPath, "utf8");
          });
        }
        return true;
      },
    );

    expect(transcriptObservedAfterGuard).toContain("linearized-message");
  });

  it("keeps alternating valid and stale owned appends as valid JSONL", async () => {
    const root = await mkdtemp(join(tmpdir(), "linghun-sessions-"));
    const project = await mkdtemp(join(tmpdir(), "linghun-project-"));
    const store = new SessionStore({ sessionRootDir: root, projectPath: project });
    const session = await store.create();

    await Promise.all(
      Array.from({ length: 200 }, (_, index) =>
        store.appendEvent(
          session.id,
          {
            type: "user_message",
            id: `owned-${index}`,
            text: `owned ${index}`,
            createdAt: new Date(index).toISOString(),
          },
          () => index % 2 === 0,
        ),
      ),
    );

    const resumed = await store.resume(session.id);
    const messages = resumed.transcript.filter((event) => event.type === "user_message");
    expect(messages).toHaveLength(100);
    expect(messages.every((event) => Number(event.id.slice("owned-".length)) % 2 === 0)).toBe(
      true,
    );
    expect(resumed.diagnostics).toEqual([]);
  });

  it("indexes runtime transcript events into the session ledger", async () => {
    const root = await mkdtemp(join(tmpdir(), "linghun-sessions-"));
    const project = await mkdtemp(join(tmpdir(), "linghun-project-"));
    const store = new SessionStore({ sessionRootDir: root, projectPath: project });
    const session = await store.create();
    const createdAt = new Date(0).toISOString();

    await store.appendEvent(session.id, {
      type: "verification_end",
      report: {
        id: "verify-1",
        status: "pass",
        summary: "focused tests passed",
        commands: [],
        unverified: [],
        risk: [],
        logPath: join(project, ".linghun", "verify.log"),
        startedAt: createdAt,
        endedAt: createdAt,
        durationMs: 1,
        nextAction: "none",
      },
      createdAt,
    });
    await store.appendEvent(session.id, {
      type: "background_task_update",
      task: {
        id: "job-1",
        kind: "job",
        title: "Job 1",
        status: "running",
        startedAt: createdAt,
        updatedAt: createdAt,
        heartbeatIntervalMs: 1000,
        staleAfterMs: 2000,
        logPath: join(project, ".linghun", "job.log"),
        hasOutput: true,
        userVisibleSummary: "job running",
      },
      createdAt,
    });
    await store.appendEvent(session.id, {
      type: "agent_end",
      agentId: "agent-1",
      status: "completed",
      summary: "agent completed",
      createdAt,
    });
    await store.appendEvent(session.id, {
      type: "workflow_end",
      workflowId: "workflow-1",
      status: "partial",
      summary: "workflow partial",
      createdAt,
    });
    await store.appendEvent(session.id, {
      type: "tool_call_end",
      id: "tool-1",
      output: { text: "large", fullOutputPath: join(project, ".linghun", "tool.log") },
      createdAt,
    });

    const ledgerText = await readFile(join(session.transcriptPath, "..", "runtime-ledger.jsonl"), "utf8");
    const records = ledgerText.trim().split(/\r?\n/u).map((line) => JSON.parse(line) as {
      kind: string;
      status?: string;
      verificationId?: string;
      jobId?: string;
      agentId?: string;
      workflowId?: string;
      artifactPath?: string;
    });

    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "verification_recorded",
          status: "pass",
          verificationId: "verify-1",
        }),
        expect.objectContaining({ kind: "job_updated", status: "running", jobId: "job-1" }),
        expect.objectContaining({
          kind: "agent_updated",
          status: "completed",
          agentId: "agent-1",
        }),
        expect.objectContaining({
          kind: "workflow_updated",
          status: "partial",
          workflowId: "workflow-1",
        }),
        expect.objectContaining({ kind: "artifact_created", artifactPath: expect.stringContaining("tool.log") }),
      ]),
    );
  });

  it("keeps transcript and metadata writes when runtime ledger write fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "linghun-sessions-"));
    const project = await mkdtemp(join(tmpdir(), "linghun-project-"));
    const ledgerDirectory = await mkdtemp(join(tmpdir(), "linghun-ledger-as-dir-"));
    const times = [
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-01-01T00:00:01.000Z"),
      new Date("2026-01-01T00:00:02.000Z"),
    ];
    let timeIndex = 0;
    const store = new SessionStore({
      sessionRootDir: root,
      projectPath: project,
      now: () => times[Math.min(timeIndex++, times.length - 1)] ?? times.at(-1)!,
      runtimeLedgerPathForTest: () => ledgerDirectory,
    });
    const session = await store.create();

    await store.appendEvent(session.id, {
      type: "verification_end",
      report: {
        id: "verify-ledger-fails",
        status: "pass",
        summary: "pass even though ledger fails",
        commands: [],
        unverified: [],
        risk: [],
        startedAt: "start",
        endedAt: "end",
        durationMs: 1,
        nextAction: "none",
      },
      createdAt: "event-time",
    });

    const resumed = await store.resume(session.id);
    expect(resumed.transcript.some((event) => event.type === "verification_end")).toBe(true);
    expect(resumed.session.updatedAt).toBe("2026-01-01T00:00:02.000Z");
  });

  it("reads recent transcript events from the tail without requiring a full resume", async () => {
    const root = await mkdtemp(join(tmpdir(), "linghun-sessions-"));
    const project = await mkdtemp(join(tmpdir(), "linghun-project-"));
    const store = new SessionStore({ sessionRootDir: root, projectPath: project });
    const session = await store.create();

    const lines = [
      { type: "session_start", sessionId: session.id, projectPath: project, createdAt: "start" },
      ...Array.from({ length: 80 }, (_, index) => ({
        type: "system_event",
        id: `system-${index}`,
        level: "info",
        message: "x".repeat(2048),
        createdAt: new Date(index).toISOString(),
      })),
      { type: "user_message", id: "u1", text: "你好", createdAt: new Date(81).toISOString() },
      { type: "assistant_text_delta", id: "a1", text: "收到", createdAt: new Date(82).toISOString() },
      { type: "user_message", id: "u2", text: "继续", createdAt: new Date(83).toISOString() },
    ];
    await writeFile(
      session.transcriptPath,
      `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
      "utf8",
    );

    const recent = await store.readRecentTranscriptEvents(session.id, {
      limit: 2,
      predicate: (event) =>
        event.type === "user_message" || event.type === "assistant_text_delta",
    });

    expect(recent.events).toEqual([
      { type: "assistant_text_delta", id: "a1", text: "收到", createdAt: new Date(82).toISOString() },
      { type: "user_message", id: "u2", text: "继续", createdAt: new Date(83).toISOString() },
    ]);
    expect(recent.diagnostics).toEqual([]);
  });

  it("stops reverse transcript reads at the latest matching boundary", async () => {
    const root = await mkdtemp(join(tmpdir(), "linghun-sessions-"));
    const project = await mkdtemp(join(tmpdir(), "linghun-project-"));
    const store = new SessionStore({ sessionRootDir: root, projectPath: project });
    const session = await store.create();
    const oldBoundary = {
      type: "system_event",
      level: "info",
      message: "compact_projection:{\"summary\":\"OLD\"}",
    } as const;
    const latestBoundary = {
      type: "system_event",
      level: "info",
      message: "compact_projection:{\"summary\":\"LATEST\"}",
    } as const;
    await writeFile(
      session.transcriptPath,
      [
        "{broken-old-prefix",
        JSON.stringify(oldBoundary),
        JSON.stringify({ type: "user_message", text: "old active" }),
        JSON.stringify(latestBoundary),
        JSON.stringify({ type: "assistant_text_delta", text: "x".repeat(70_000) }),
        JSON.stringify({ type: "user_message", text: "current" }),
        "",
      ].join("\n"),
      "utf8",
    );

    const recent = await store.readRecentTranscriptEvents(session.id, {
      limit: Number.MAX_SAFE_INTEGER,
      predicate: (event) =>
        event.type === "user_message" ||
        event.type === "assistant_text_delta" ||
        (event.type === "system_event" && event.message.startsWith("compact_projection:")),
      stopPredicate: (event) =>
        event.type === "system_event" && event.message.startsWith("compact_projection:"),
    });

    expect(recent.events).toEqual([
      latestBoundary,
      { type: "assistant_text_delta", text: "x".repeat(70_000) },
      { type: "user_message", text: "current" },
    ]);
    expect(recent.diagnostics).toEqual([]);
  });

  it("reports diagnostics for malformed lines while tail-reading recent transcript events", async () => {
    const root = await mkdtemp(join(tmpdir(), "linghun-sessions-"));
    const project = await mkdtemp(join(tmpdir(), "linghun-project-"));
    const store = new SessionStore({ sessionRootDir: root, projectPath: project });
    const session = await store.create();

    await writeFile(
      session.transcriptPath,
      [
        JSON.stringify({
          type: "user_message",
          id: "u1",
          text: "old",
          createdAt: new Date(0).toISOString(),
        }),
        "{broken",
        JSON.stringify({
          type: "assistant_text_delta",
          id: "a1",
          text: "new",
          createdAt: new Date(1).toISOString(),
        }),
        "",
      ].join("\n"),
      "utf8",
    );

    const recent = await store.readRecentTranscriptEvents(session.id, { limit: 3 });

    expect(recent.events.map((event) => event.type)).toEqual([
      "user_message",
      "assistant_text_delta",
    ]);
    expect(recent.diagnostics).toHaveLength(1);
  });

  it("serializes concurrent appendEvent calls for one session", async () => {
    const root = await mkdtemp(join(tmpdir(), "linghun-sessions-"));
    const project = await mkdtemp(join(tmpdir(), "linghun-project-"));
    const store = new SessionStore({ sessionRootDir: root, projectPath: project });
    const session = await store.create();

    await Promise.all(
      Array.from({ length: 20 }, async (_, index) =>
        store.appendEvent(session.id, {
          type: "user_message",
          id: `message-${index}`,
          text: `message ${index}`,
          createdAt: new Date(index).toISOString(),
        }),
      ),
    );

    const resumed = await store.resume(session.id);
    const messages = resumed.transcript.filter((event) => event.type === "user_message");
    expect(messages).toHaveLength(20);
    expect(new Set(messages.map((event) => event.id)).size).toBe(20);
    expect(resumed.diagnostics).toEqual([]);
  });

  it("continues appendEvent queue after a failed append", async () => {
    const root = await mkdtemp(join(tmpdir(), "linghun-sessions-"));
    const project = await mkdtemp(join(tmpdir(), "linghun-project-"));
    const store = new SessionStore({ sessionRootDir: root, projectPath: project });
    const session = await store.create();

    await expect(
      store.appendEvent("missing-session", {
        type: "user_message",
        id: "bad",
        text: "bad",
        createdAt: new Date(0).toISOString(),
      }),
    ).rejects.toThrow(/未找到会话/);
    await store.appendEvent(session.id, {
      type: "user_message",
      id: "good",
      text: "good",
      createdAt: new Date(1).toISOString(),
    });

    const resumed = await store.resume(session.id);
    expect(
      resumed.transcript.some((event) => event.type === "user_message" && event.id === "good"),
    ).toBe(true);
  });

  it("updates summary without changing the session id", async () => {
    const root = await mkdtemp(join(tmpdir(), "linghun-sessions-"));
    const project = await mkdtemp(join(tmpdir(), "linghun-project-"));
    const store = new SessionStore({ sessionRootDir: root, projectPath: project });
    const session = await store.create();

    const updated = await store.updateSummary(session.id, "已发送 3 条消息");
    const resumed = await store.resume(session.id);

    expect(updated.id).toBe(session.id);
    expect(resumed.session.summary).toBe("已发送 3 条消息");
  });

  it("loads a large transcript from its latest usable projection past malformed boundaries", async () => {
    const root = await mkdtemp(join(tmpdir(), "linghun-sessions-"));
    const project = await mkdtemp(join(tmpdir(), "linghun-project-"));
    const store = new SessionStore({ sessionRootDir: root, projectPath: project });
    const session = await store.create();
    await appendFile(
      session.transcriptPath,
      `${JSON.stringify({
        type: "system_event",
        id: "large-old-event",
        level: "info",
        message: "x".repeat(4 * 1024 * 1024),
        createdAt: new Date(0).toISOString(),
      })}\n${JSON.stringify({
        type: "system_event",
        id: "compact-boundary",
        level: "info",
        message: `compact_projection:${JSON.stringify(
          makeUsableCompactProjection("LATEST_VALID_COMPACT"),
        )}`,
        createdAt: new Date(1).toISOString(),
      })}\n${JSON.stringify({
        type: "deep_compact_packet",
        packet: { id: "malformed-newer-boundary" },
        createdAt: new Date(2).toISOString(),
      })}\n${JSON.stringify({
        type: "user_message",
        id: "recent-user",
        text: "recent history",
        createdAt: new Date(3).toISOString(),
      })}\n`,
      "utf8",
    );

    const resumed = await store.resume(session.id);

    expect(resumed.transcript.map((event) => event.type)).toEqual([
      "system_event",
      "deep_compact_packet",
      "user_message",
    ]);
    expect(JSON.stringify(resumed.transcript)).toContain("LATEST_VALID_COMPACT");
    expect(JSON.stringify(resumed.transcript)).not.toContain("large-old-event");
    expect(resumed.diagnostics).toContainEqual({
      line: 0,
      message: expect.stringContaining("partial transcript"),
    });
  });

  it("accepts only structurally complete deep compact packets", () => {
    expect(isUsableDeepCompactPacket({ id: "incomplete" })).toBe(false);
    expect(
      isUsableDeepCompactPacket({
        kind: "deep",
        scope: "full transcript semantic compact",
        id: "deep-boundary",
        summary: "valid deep compact",
        preservedEvidenceRefs: [],
        preservedFiles: [],
        activeAgentsWorkflows: [],
        pendingItems: [],
        decisions: [],
        risks: [],
        createdAt: new Date(0).toISOString(),
        model: "test-model",
        provider: "test-provider",
        trigger: "manual",
        transcriptEventCount: 20,
      }),
    ).toBe(true);
    expect(
      isUsableDeepCompactPacket({
        kind: "deep",
        scope: "full transcript semantic compact",
        id: "deep-boundary",
        summary: "invalid arrays",
        preservedEvidenceRefs: [42],
        preservedFiles: [],
        activeAgentsWorkflows: [],
        pendingItems: [],
        decisions: [],
        risks: [],
        createdAt: new Date(0).toISOString(),
        model: "test-model",
        provider: "test-provider",
        trigger: "manual",
        transcriptEventCount: 20,
      }),
    ).toBe(false);
  });

  it("keeps summary-only compact boundaries compatible and marks complete projections hydratable", () => {
    const validEvent = {
      type: "system_event",
      id: "projection",
      level: "info",
      message: `compact_projection:${JSON.stringify(makeUsableCompactProjection("valid"))}`,
      createdAt: new Date(1).toISOString(),
    } as const;

    expect(parseUsableTranscriptCompactBoundary(validEvent)).toMatchObject({
      kind: "projection",
      projection: { boundaryId: "compact-boundary", summary: "valid" },
      hydrationProjection: { boundaryId: "compact-boundary", summary: "valid" },
    });
    expect(
      parseUsableTranscriptCompactBoundary({
        ...validEvent,
        message: 'compact_projection:{"summary":"incomplete"}',
      }),
    ).toEqual({
      kind: "projection",
      projection: { summary: "incomplete" },
    });
    expect(
      parseUsableTranscriptCompactBoundary({
        ...validEvent,
        message: "compact_projection:{broken",
      }),
    ).toBeUndefined();
  });

  it("records a warning when metadata cannot be parsed", async () => {
    const root = await mkdtemp(join(tmpdir(), "linghun-sessions-"));
    const project = await mkdtemp(join(tmpdir(), "linghun-project-"));
    const store = new SessionStore({ sessionRootDir: root, projectPath: project });
    const session = await store.create();
    await writeFile(join(session.transcriptPath, "..", "session.json"), "{broken", "utf8");

    await expect(store.resume(session.id)).rejects.toThrow(/未找到会话/);

    const transcript = await readFile(session.transcriptPath, "utf8");
    expect(transcript).toContain("session_metadata_read_failed");
    expect(transcript).toContain("system_event");
  });
});

// D.13O — sessionId 路径越界保护：resume / appendEvent / updateSummary 在
// 进入 join() 之前必须先校验，拒绝 `..` / slash / 控制字符 / 绝对路径 / 空。
describe("SessionStore — D.13O sessionId path validation", () => {
  it("assertValidSessionId 接受 randomUUID 形式", () => {
    expect(() => assertValidSessionId("11111111-2222-3333-4444-555555555555")).not.toThrow();
  });

  for (const bad of [
    "",
    "..",
    ".",
    "../etc/passwd",
    "..\\windows\\system32",
    "foo/bar",
    "foo\\bar",
    "/etc/passwd",
    "C:\\Users\\Admin",
    "C:/temp",
    "with space",
    "with\ttab",
    "with\nnewline",
    "with:colon",
    "with*star",
    "with?question",
    "with|pipe",
    'with"quote',
    "with<lt",
    "with>gt",
    "with%percent",
    "x".repeat(200),
  ]) {
    it(`assertValidSessionId 拒绝 ${JSON.stringify(bad)}`, () => {
      expect(() => assertValidSessionId(bad)).toThrow();
    });
  }

  it("assertValidSessionId 拒绝非字符串", () => {
    expect(() => assertValidSessionId(undefined)).toThrow();
    expect(() => assertValidSessionId(null)).toThrow();
    expect(() => assertValidSessionId(42)).toThrow();
    expect(() => assertValidSessionId({})).toThrow();
  });

  it("resume 对非法 sessionId 抛出明确错误，不生成 sessions 目录之外的路径访问", async () => {
    const root = await mkdtemp(join(tmpdir(), "linghun-sessions-"));
    const project = await mkdtemp(join(tmpdir(), "linghun-project-"));
    const store = new SessionStore({ sessionRootDir: root, projectPath: project });

    await expect(store.resume("../escape")).rejects.toThrow(/sessionId/);
    await expect(store.resume("/etc/passwd")).rejects.toThrow(/sessionId/);
    await expect(store.resume("")).rejects.toThrow(/sessionId/);
  });

  it("appendEvent 对非法 sessionId 抛出明确错误", async () => {
    const root = await mkdtemp(join(tmpdir(), "linghun-sessions-"));
    const project = await mkdtemp(join(tmpdir(), "linghun-project-"));
    const store = new SessionStore({ sessionRootDir: root, projectPath: project });

    await expect(
      store.appendEvent("../escape", {
        type: "user_message",
        id: "u1",
        text: "x",
        createdAt: new Date(0).toISOString(),
      }),
    ).rejects.toThrow(/sessionId/);
  });

  it("updateSummary 对非法 sessionId 抛出明确错误", async () => {
    const root = await mkdtemp(join(tmpdir(), "linghun-sessions-"));
    const project = await mkdtemp(join(tmpdir(), "linghun-project-"));
    const store = new SessionStore({ sessionRootDir: root, projectPath: project });

    await expect(store.updateSummary("foo/bar", "summary")).rejects.toThrow(/sessionId/);
  });

  it("合法 sessionId（randomUUID 风格）原行为不变", async () => {
    const root = await mkdtemp(join(tmpdir(), "linghun-sessions-"));
    const project = await mkdtemp(join(tmpdir(), "linghun-project-"));
    const store = new SessionStore({ sessionRootDir: root, projectPath: project });

    const session = await store.create();
    await expect(store.resume(session.id)).resolves.toMatchObject({
      session: { id: session.id },
    });
  });
});
