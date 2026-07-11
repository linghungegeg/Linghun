import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "@linghun/config";
import { describe, expect, it } from "vitest";
import {
  applyMemoryExtractionDecision,
  commitPersistentMemoryMutation,
  decideMemoryExtraction,
  loadPersistentMemorySnapshot,
  writePersistentMemoryLearningState,
} from "./memory-extraction-runtime.js";
import { createControlledMemoryInjection } from "./tui-memory-runtime.js";
import { refreshPersistentMemoryState } from "./tui-state-runtime.js";
import type { TuiContext } from "./tui-context-runtime.js";
import type { MemoryCandidate } from "./tui-data-types.js";

describe("memory extraction runtime", () => {
  it("creates accepted user memory with manifest and topic markdown", async () => {
    const dir = await mkdtemp(join(tmpdir(), "linghun-memory-extract-"));
    const decision = decideMemoryExtraction({
      recentMessages: ["请记住：我偏好先用 focused tests 验证，再跑完整 build。"],
      accepted: [],
      disabled: [],
    });

    expect(decision.action).toBe("create");
    if (decision.action === "no-op") throw new Error("expected create");
    expect(decision.taxonomy).toBe("user");
    expect(decision.scope).toBe("user");

    const applied = await applyMemoryExtractionDecision({ decision });
    expect(applied.memory).toMatchObject({
      status: "accepted",
      taxonomy: "user",
      scope: "user",
      inferred: true,
    });
    await commitPersistentMemoryMutation(dir, "user", {
      action: "upsert",
      next: applied.memory!,
    });
    const manifest = await readFile(join(dir, "MEMORY.md"), "utf8");
    expect(manifest).toContain("user/");
    expect(manifest).toContain(applied.memory?.id);
    const topic = await readFile(join(dir, "topics", `${applied.memory?.topic}.md`), "utf8");
    expect(topic).toContain("taxonomy: user");
    expect(topic).toContain("focused tests");
  });

  it("updates the same topic instead of creating duplicates", () => {
    const accepted: MemoryCandidate[] = [
      makeMemory({
        id: "memory-1",
        taxonomy: "user",
        topic: "user-user-preference-focused-tests",
        summary: "User preference: 先用 focused tests 验证。",
      }),
    ];

    const decision = decideMemoryExtraction({
      recentMessages: ["请记住：我偏好先用 focused tests 验证，再补 typecheck。"],
      accepted,
      disabled: [],
    });

    expect(decision.action).toBe("update");
    if (decision.action === "no-op") throw new Error("expected update");
    expect(decision.id).toBe("memory-1");
  });

  it("does not save code structure, git history, temporary work, logs, or secrets", () => {
    const cases = [
      "packages/tui/src/meta-scheduler-runtime.ts 里有 function matchesFrustrated",
      "git log 里这个 commit abc1234 已经修了",
      "本轮 Pre-Smoke 2 当前阶段进度是完成一半",
      "完整日志 stdout stderr 都保存下来",
      "我的 api_key 是 sk-1234567890abcdefghijklmnopqrstuvwxyz",
    ];

    for (const text of cases) {
      const decision = decideMemoryExtraction({
        recentMessages: [text],
        accepted: [],
        disabled: [],
      });
      expect(decision.action).toBe("no-op");
      if (decision.action === "no-op") expect(decision.reason).toContain("unsaveable");
    }
  });

  it("does not save memory lookup questions as preferences", () => {
    const cases = [
      "我偏好的压测报告格式是什么？不要调用工具；如果没有记忆就说没有记忆。",
      "我有没有记住中断测试代号？如果没有这条记忆就回答没有。",
      "What is my preference for stress-test reports?",
    ];

    for (const text of cases) {
      const decision = decideMemoryExtraction({
        recentMessages: [text],
        accepted: [],
        disabled: [],
      });
      expect(decision).toMatchObject({
        action: "no-op",
        reason: "memory_lookup_question",
      });
    }
  });

  it("turns natural-language forget requests into delete only when a target exists", () => {
    const accepted = [
      makeMemory({
        id: "memory-short-list",
        taxonomy: "user",
        topic: "user-report-format",
        summary: "User preference: 中文短列表",
      }),
    ];

    const deleteDecision = decideMemoryExtraction({
      recentMessages: ["请忘记我偏好中文短列表。"],
      accepted,
      disabled: [],
    });
    expect(deleteDecision).toMatchObject({
      action: "delete",
      id: "memory-short-list",
      matchedExistingId: "memory-short-list",
    });

    const noTargetDecision = decideMemoryExtraction({
      recentMessages: ["以后不要记住我偏好中文短列表。"],
      accepted: [],
      disabled: [],
    });
    expect(noTargetDecision).toMatchObject({
      action: "no-op",
      reason: "memory_forget_target_not_found",
    });
  });

  it("updates existing memory from natural-language update requests instead of creating malformed memory", () => {
    const accepted = [
      makeMemory({
        id: "memory-report-format",
        taxonomy: "user",
        topic: "user-report-format",
        summary: "User preference: 压测报告用中文短列表。",
      }),
    ];

    const updateDecision = decideMemoryExtraction({
      recentMessages: ["请把我偏好的压测报告格式更新为英文表格。"],
      accepted,
      disabled: [],
    });
    expect(updateDecision).toMatchObject({
      action: "update",
      id: "memory-report-format",
      matchedExistingId: "memory-report-format",
    });
    if (updateDecision.action !== "update") throw new Error("expected update");
    expect(updateDecision.summary).toContain("压测报告格式");
    expect(updateDecision.summary).toContain("英文表格");

    const noTargetDecision = decideMemoryExtraction({
      recentMessages: ["请把我偏好的压测报告格式更新为英文表格。"],
      accepted: [],
      disabled: [],
    });
    expect(noTargetDecision).toMatchObject({
      action: "no-op",
      reason: "memory_update_target_not_found",
    });
  });

  it("refreshes markdown manifest after disable and delete", async () => {
    const dir = await mkdtemp(join(tmpdir(), "linghun-memory-refresh-"));
    const memory = makeMemory({
      taxonomy: "feedback",
      topic: "feedback-no-fluff",
      summary: "User feedback: 少废话，先给事实。",
    });

    await commitPersistentMemoryMutation(dir, "user", { action: "upsert", next: memory });
    expect(await readFile(join(dir, "MEMORY.md"), "utf8")).toContain("accepted");

    await commitPersistentMemoryMutation(dir, "user", {
      action: "upsert",
      next: { ...memory, status: "disabled" },
      expected: memory,
    });
    expect(await readFile(join(dir, "MEMORY.md"), "utf8")).toContain("disabled");

    await commitPersistentMemoryMutation(dir, "user", {
      action: "delete",
      expected: { ...memory, status: "disabled" },
      deletion: { sessionId: "session-delete" },
    });
    expect(await readFile(join(dir, "MEMORY.md"), "utf8")).not.toContain(memory.id);
  });

  it("removes stale topic markdown when an accepted memory changes topic", async () => {
    const dir = await mkdtemp(join(tmpdir(), "linghun-memory-update-topic-"));
    const first = makeMemory({
      id: "memory-report-format",
      taxonomy: "user",
      topic: "user-report-format-short-list",
      summary: "User preference: 压测报告用中文短列表。",
    });
    const second = {
      ...first,
      topic: "user-report-format-english-table",
      summary: "User preference: 压测报告格式：英文表格",
    };

    const firstApplied = await applyMemoryExtractionDecision({
      decision: {
        action: "update",
        id: first.id,
        taxonomy: first.taxonomy ?? "user",
        topic: first.topic ?? "user-report-format-short-list",
        scope: "user",
        summary: first.summary,
        source: "test",
        sourceRefs: ["test"],
        matchedExistingId: first.id,
      },
      existing: first,
    });
    await commitPersistentMemoryMutation(dir, "user", {
      action: "upsert",
      next: firstApplied.memory!,
    });
    const secondApplied = await applyMemoryExtractionDecision({
      decision: {
        action: "update",
        id: second.id,
        taxonomy: second.taxonomy ?? "user",
        topic: second.topic ?? "user-report-format-english-table",
        scope: "user",
        summary: second.summary,
        source: "test",
        sourceRefs: ["test"],
        matchedExistingId: second.id,
      },
      existing: first,
    });
    await commitPersistentMemoryMutation(dir, "user", {
      action: "upsert",
      next: secondApplied.memory!,
      expected: firstApplied.memory!,
    });

    await expect(readFile(join(dir, "topics", `${first.topic}.md`), "utf8")).rejects.toThrow();
    expect(await readFile(join(dir, "topics", `${second.topic}.md`), "utf8")).toContain(
      "英文表格",
    );
    expect(await readFile(join(dir, "MEMORY.md"), "utf8")).not.toContain(first.topic);
  });

  it("allows only one concurrent create for the same logical topic", async () => {
    const dir = await mkdtemp(join(tmpdir(), "linghun-memory-concurrent-topic-"));
    const results = await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        commitPersistentMemoryMutation(dir, "user", {
          action: "upsert",
          next: makeMemory({
            id: `memory-${index}`,
            topic: "user-concurrent-topic",
            summary: `User preference concurrent ${index}`,
          }),
        }),
      ),
    );

    expect(results.filter((result) => result.status === "committed")).toHaveLength(1);
    expect(results.filter((result) => result.status === "conflict")).toHaveLength(99);
    const snapshot = await loadPersistentMemorySnapshot(dir, "user");
    expect(snapshot.records).toHaveLength(1);
    const rootEntries = await readdir(dir);
    const jsonFiles = rootEntries.filter((entry) => entry.endsWith(".json"));
    expect(jsonFiles).toHaveLength(1);
    expect(rootEntries.some((entry) => entry.startsWith(".write.lock"))).toBe(false);
    expect(rootEntries.some((entry) => entry.includes(".tmp-") || entry.includes(".bak-"))).toBe(false);
  }, 30_000);

  it("does not let a stale writer recreate a tombstoned logical topic", async () => {
    const dir = await mkdtemp(join(tmpdir(), "linghun-memory-tombstoned-topic-"));
    const memory = makeMemory({ id: "memory-deleted", topic: "user-deleted-topic" });
    expect((await commitPersistentMemoryMutation(dir, "user", { action: "upsert", next: memory })).status)
      .toBe("committed");
    expect((await commitPersistentMemoryMutation(dir, "user", {
      action: "delete",
      expected: memory,
      deletion: { sessionId: "session-delete" },
    })).status).toBe("committed");

    const stale = await commitPersistentMemoryMutation(dir, "user", {
      action: "upsert",
      next: { ...memory, id: "memory-stale-recreate" },
    });
    expect(stale.status).toBe("tombstoned");
    expect((await loadPersistentMemorySnapshot(dir, "user")).records).toEqual([]);
  });

  it("refreshes a stale window before injection and drops disabled memory", async () => {
    const root = await mkdtemp(join(tmpdir(), "linghun-memory-window-refresh-"));
    const projectDir = join(root, "project-memory");
    const userDir = join(root, "user-memory");
    const sessionDir = join(root, "session-memory");
    await Promise.all([mkdir(projectDir), mkdir(userDir), mkdir(sessionDir)]);
    const memory = makeMemory({
      id: "project-build-memory",
      scope: "project",
      taxonomy: "project",
      topic: "project-build-command",
      summary: "Project verification uses focused build command",
    });
    await commitPersistentMemoryMutation(projectDir, "project", { action: "upsert", next: memory });
    const context = makeRefreshContext(root, projectDir, userDir, sessionDir);

    expect(await refreshPersistentMemoryState(context)).toBe("refreshed");
    expect(createControlledMemoryInjection(context, "focused build command").items).toHaveLength(1);

    await commitPersistentMemoryMutation(projectDir, "project", {
      action: "upsert",
      next: { ...memory, status: "disabled" },
      expected: memory,
    });
    expect(context.memory.accepted).toHaveLength(1);
    expect(await refreshPersistentMemoryState(context)).toBe("refreshed");
    expect(context.memory.accepted).toEqual([]);
    expect(context.memory.disabled).toHaveLength(1);
    expect(createControlledMemoryInjection(context, "focused build command").items).toEqual([]);
  });

  it("does not commit a persistent refresh after the request owner expires", async () => {
    const root = await mkdtemp(join(tmpdir(), "linghun-memory-window-stale-"));
    const projectDir = join(root, "project-memory");
    const userDir = join(root, "user-memory");
    const sessionDir = join(root, "session-memory");
    await Promise.all([mkdir(projectDir), mkdir(userDir), mkdir(sessionDir)]);
    await commitPersistentMemoryMutation(projectDir, "project", {
      action: "upsert",
      next: makeMemory({ scope: "project", taxonomy: "project", topic: "project-stale" }),
    });
    const context = makeRefreshContext(root, projectDir, userDir, sessionDir);
    let guardCalls = 0;
    const status = await refreshPersistentMemoryState(context, () => ++guardCalls === 1);
    expect(status).toBe("stale");
    expect(context.memory.accepted).toEqual([]);
  });

  it("does not inject unrelated user memory ahead of a relevant project memory", () => {
    const context = makeRefreshContext("C:/repo", "C:/project", "C:/user", "C:/session");
    context.memory.accepted = [
      makeMemory({ id: "a-user", summary: "User preference: report color blue" }),
      makeMemory({ id: "b-user", summary: "User preference: use compact tables" }),
      makeMemory({ id: "c-user", summary: "User preference: answer in English" }),
      makeMemory({
        id: "z-project",
        scope: "project",
        taxonomy: "project",
        topic: "project-focused-build",
        summary: "Project verification uses focused build command",
      }),
    ];

    expect(createControlledMemoryInjection(context, "run focused build verification").items.map((item) => item.id))
      .toEqual(["z-project"]);
  });

  it("serializes concurrent learning-mode writes through the same memory lock", async () => {
    const dir = await mkdtemp(join(tmpdir(), "linghun-memory-learning-mode-"));
    let lastCompleted: "active" | "off" = "off";
    await Promise.all(
      Array.from({ length: 100 }, async (_, index) => {
        const learningMode = index % 2 === 0 ? "active" as const : "off" as const;
        await writePersistentMemoryLearningState(
          dir,
          `${JSON.stringify({ learningMode, updatedAt: String(index) })}\n`,
        );
        lastCompleted = learningMode;
      }),
    );

    const persisted = JSON.parse(await readFile(join(dir, "learning-state.json"), "utf8")) as {
      learningMode: "active" | "off";
    };
    expect(persisted.learningMode).toBe(lastCompleted);
    expect((await readdir(dir)).some((entry) => entry.startsWith(".write.lock"))).toBe(false);
  }, 30_000);

  it("recovers a backup-only record during a read-only snapshot refresh", async () => {
    const dir = await mkdtemp(join(tmpdir(), "linghun-memory-read-recovery-"));
    const memory = makeMemory({ id: "memory-crash-recovery" });
    const target = join(dir, `${memory.id}.json`);
    const backup = `${target}.bak-crashed-writer`;
    await writeFile(backup, `${JSON.stringify(memory)}\n`, "utf8");

    const snapshot = await loadPersistentMemorySnapshot(dir, "user");
    expect(snapshot.records).toContainEqual(memory);
    expect(JSON.parse(await readFile(target, "utf8"))).toMatchObject({ id: memory.id });
    await expect(readFile(backup, "utf8")).rejects.toThrow();
  });

  it("reclaims an old ownerless lock during a read-only snapshot refresh", async () => {
    const dir = await mkdtemp(join(tmpdir(), "linghun-memory-ownerless-lock-"));
    const memory = makeMemory({ id: "memory-ownerless-lock" });
    await writeFile(join(dir, `${memory.id}.json`), `${JSON.stringify(memory)}\n`, "utf8");
    const lockPath = join(dir, ".write.lock");
    await mkdir(lockPath);
    const staleAt = new Date(Date.now() - 60_000);
    await utimes(lockPath, staleAt, staleAt);

    const snapshot = await loadPersistentMemorySnapshot(dir, "user");

    expect(snapshot.records).toContainEqual(memory);
    expect((await readdir(dir)).some((entry) => entry.startsWith(".write.lock"))).toBe(false);
  });

  it("does not overwrite a newer live lock while a prepared acquisition waits", async () => {
    const dir = await mkdtemp(join(tmpdir(), "linghun-memory-prepared-lock-"));
    const memory = makeMemory({ id: "memory-prepared-lock" });
    await writeFile(join(dir, `${memory.id}.json`), `${JSON.stringify(memory)}\n`, "utf8");
    const lockPath = join(dir, ".write.lock");
    await mkdir(lockPath);
    await writeFile(
      join(lockPath, "owner.json"),
      JSON.stringify({
        token: "newer-live-owner",
        pid: process.pid,
        createdAt: Date.now(),
        heartbeatAt: Date.now(),
      }),
      "utf8",
    );

    const pendingSnapshot = loadPersistentMemorySnapshot(dir, "user");
    let prepared = false;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      prepared = (await readdir(dir)).some((entry) => entry.startsWith(".write.lock.prepare-"));
      if (prepared) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    const currentOwner = JSON.parse(await readFile(join(lockPath, "owner.json"), "utf8")) as {
      token: string;
    };
    await rm(lockPath, { recursive: true, force: true });
    const snapshot = await pendingSnapshot;

    expect(prepared).toBe(true);
    expect(currentOwner.token).toBe("newer-live-owner");
    expect(snapshot.records).toContainEqual(memory);
    expect((await readdir(dir)).some((entry) => entry.startsWith(".write.lock"))).toBe(false);
  });

  it("does not recreate a disabled memory from similar later input", () => {
    const disabled = makeMemory({
      status: "disabled",
      taxonomy: "user",
      topic: "user-user-preference-focused-tests",
      summary: "User preference: 先用 focused tests 验证。",
    });

    const decision = decideMemoryExtraction({
      recentMessages: ["请记住：我偏好先用 focused tests 验证，再补 typecheck。"],
      accepted: [],
      disabled: [disabled],
    });

    expect(decision).toMatchObject({
      action: "no-op",
      reason: "disabled_existing_memory",
    });
  });
});

function makeMemory(overrides: Partial<MemoryCandidate> = {}): MemoryCandidate {
  return {
    id: "memory-1",
    scope: "user",
    status: "accepted",
    taxonomy: "user",
    topic: "user-default",
    summary: "User preference: focused tests",
    source: "test",
    sourceRefs: ["test"],
    risk: "low",
    inferred: true,
    createdAt: "2026-06-07T00:00:00.000Z",
    ...overrides,
  };
}

function makeRefreshContext(
  projectPath: string,
  projectDir: string,
  userDir: string,
  sessionDir: string,
): TuiContext {
  return {
    config: defaultConfig,
    projectPath,
    memory: {
      projectDir,
      userDir,
      sessionDir,
      candidates: [],
      accepted: [],
      rejected: [],
      disabled: [],
      retired: [],
      learningMode: "active",
    },
  } as unknown as TuiContext;
}
