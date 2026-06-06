import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionStore, assertValidSessionId } from "./session-store.js";

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
