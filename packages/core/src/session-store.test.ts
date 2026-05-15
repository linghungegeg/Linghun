import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionStore } from "./session-store.js";

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
});
