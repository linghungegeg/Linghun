import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyMemoryExtractionDecision,
  decideMemoryExtraction,
  refreshAutoMemoryFiles,
} from "./memory-extraction-runtime.js";
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

    const applied = await applyMemoryExtractionDecision({ decision, memoryDir: dir });
    expect(applied.memory).toMatchObject({
      status: "accepted",
      taxonomy: "user",
      scope: "user",
      inferred: true,
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

    await refreshAutoMemoryFiles(dir, [memory], []);
    expect(await readFile(join(dir, "MEMORY.md"), "utf8")).toContain("accepted");

    await refreshAutoMemoryFiles(dir, [], [{ ...memory, status: "disabled" }]);
    expect(await readFile(join(dir, "MEMORY.md"), "utf8")).toContain("disabled");

    await refreshAutoMemoryFiles(dir, [], []);
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

    await applyMemoryExtractionDecision({
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
      memoryDir: dir,
      existing: first,
    });
    await applyMemoryExtractionDecision({
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
      memoryDir: dir,
      existing: first,
    });

    await expect(readFile(join(dir, "topics", `${first.topic}.md`), "utf8")).rejects.toThrow();
    expect(await readFile(join(dir, "topics", `${second.topic}.md`), "utf8")).toContain(
      "英文表格",
    );
    expect(await readFile(join(dir, "MEMORY.md"), "utf8")).not.toContain(first.topic);
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
