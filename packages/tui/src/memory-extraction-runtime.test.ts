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
