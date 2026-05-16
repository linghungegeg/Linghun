import { describe, expect, it } from "vitest";
import {
  type RuntimeStatusSource,
  buildRuntimeStatusForModel,
  createModelCapabilitySummary,
  formatNaturalPermissionBlock,
  getCommandCapabilityCatalog,
  routeNaturalIntent,
  validateCommandCapabilityCoverage,
} from "./natural-command-bridge.js";

const firstBatch = [
  "memory",
  "index",
  "cache",
  "model",
  "mode",
  "workflows",
  "skills",
  "plugins",
  "hooks",
  "sessions",
  "resume",
  "branch",
];

const secondBatch = [
  "read",
  "grep",
  "glob",
  "todo",
  "verify",
  "review",
  "diff",
  "fork",
  "agents",
  "background",
];
const thirdBatch = [
  "write",
  "edit",
  "multiedit",
  "bash",
  "permissions",
  "mode",
  "cache",
  "index",
  "skills",
  "plugins",
  "memory",
  "rewind",
  "hooks",
];

describe("Phase 15 Command Capability Catalog", () => {
  it("covers every user-visible slash command and marks internal commands", () => {
    expect(validateCommandCapabilityCoverage()).toEqual([]);
    const catalog = getCommandCapabilityCatalog();
    expect(catalog.some((item) => item.id === "status" && item.hiddenReason)).toBe(true);
    expect(
      catalog.every((item) => item.titleZh && item.titleEn && item.whenToUseZh && item.whenToUseEn),
    ).toBe(true);
  });

  it("creates a stable short model-visible summary", () => {
    const summary = createModelCapabilitySummary(8);
    expect(summary).toContain("risk=");
    expect(summary).toContain("/cache");
    expect(summary.length).toBeLessThan(1200);
    expect(summary).not.toContain("transcript");
    expect(summary).not.toContain("full log");
  });
});

describe("Phase 15 Natural Intent Router", () => {
  it.each([
    ["自动记忆功能是否打开", "memory"],
    ["is memory enabled?", "memory"],
    ["帮我建立索引", "index"],
    ["build the index", "index"],
    ["缓存命中怎么样", "cache"],
    ["cache hit rate", "cache"],
    ["你是什么模型", "model"],
    ["what model are you using?", "model"],
    ["当前权限模式", "mode"],
    ["current permission mode", "mode"],
    ["有哪些工作流", "workflows"],
    ["list workflows", "workflows"],
    ["打开 bug-fix 工作流", "workflows"],
    ["start bug-fix workflow", "workflows"],
    ["hook 开了吗", "hooks"],
    ["are hooks enabled?", "hooks"],
    ["恢复上次会话", "resume"],
    ["resume last session", "resume"],
    ["开个分支试试", "branch"],
    ["create a branch session", "branch"],
  ])("routes first batch phrase %s", (phrase, id) => {
    const intent = routeNaturalIntent(phrase);
    expect(intent.capability?.id).toBe(id);
    expect(["execute_readonly", "start_gate", "answer", "permission_pipeline"]).toContain(
      intent.action,
    );
  });

  it.each(firstBatch)(
    "keeps Chinese and English first-batch risk handler consistent for %s",
    (id) => {
      const capability = getCommandCapabilityCatalog().find((item) => item.id === id);
      expect(capability).toBeTruthy();
      const zh = routeNaturalIntent(`${capability?.titleZh} 状态`);
      const en = routeNaturalIntent(`${capability?.titleEn} status`, "en-US");
      expect(zh.capability?.id).toBe(id);
      expect(en.capability?.id).toBe(id);
      expect(zh.riskHandler).toBe(en.riskHandler);
    },
  );

  it.each([
    ["怎么搜索代码里的 TODO", "grep"],
    ["how do I read a file", "read"],
    ["怎么按模式找文件", "glob"],
    ["todo 怎么用", "todo"],
    ["怎么跑验证", "verify"],
    ["帮我做一次 review", "review"],
    ["show me the diff", "diff"],
    ["start a verifier agent", "fork"],
    ["有哪些 agents", "agents"],
    ["后台任务怎么看", "background"],
  ])("routes second batch discovery phrase %s", (phrase, id) => {
    const intent = routeNaturalIntent(phrase);
    expect(intent.capability?.id).toBe(id);
    expect(["answer", "start_gate", "execute_readonly"]).toContain(intent.action);
  });

  it.each([
    ["帮我直接运行 npm install", "bash"],
    ["直接开启 bypass", "mode"],
    ["直接接受所有记忆", "memory"],
    ["force refresh index", "index"],
    ["直接帮我写文件", "write"],
    ["install dependency now", "bash"],
  ])("blocks high-risk natural phrase %s", (phrase, id) => {
    const intent = routeNaturalIntent(phrase);
    expect(intent.capability?.id).toBe(id);
    expect(intent.action).toBe("permission_pipeline");
    expect(formatNaturalPermissionBlock(intent)).toMatch(/没有执行|did not execute/);
  });

  it.each(thirdBatch)("catalog marks third-batch command risk for %s", (id) => {
    const capability = getCommandCapabilityCatalog().find((item) => item.id === id);
    expect(capability).toBeTruthy();
    expect(["dangerous", "start_gate"]).toContain(capability?.risk);
  });

  it("asks for clarification on low confidence and multiple candidates", () => {
    expect(routeNaturalIntent("cach statuz").action).toBe("ask_clarify");
    const multi = routeNaturalIntent("status");
    expect(["ask_clarify", "model", "execute_readonly"]).toContain(multi.action);
  });
});

describe("Phase 15 RuntimeStatusForModel", () => {
  it("uses real short source fields without dumping memory/transcript/index/log", () => {
    const source: RuntimeStatusSource = {
      model: "deepseek-v4-flash",
      permissionMode: "default",
      projectPath: "/tmp/project",
      language: "zh-CN",
      memory: {
        projectRulesExists: true,
        candidates: [{ id: "candidate", text: "long text should not appear" }],
        accepted: [{ id: "accepted", text: "full memory should not appear" }],
      },
      index: { status: "ready", changedFiles: 2 },
      cache: { history: [{ hitRate: 0.92, freshness: { changedKeys: ["modelProviderHash"] } }] },
      skills: { enabled: true, skills: [{ id: "skill" }] },
      plugins: { enabled: false, plugins: [] },
      hooks: { enabled: false, hooks: [{ id: "hook" }] },
    };
    const status = buildRuntimeStatusForModel(source);
    expect(status.memory).toEqual({
      linghunMd: "found",
      candidates: 1,
      accepted: 1,
      autoAccept: false,
    });
    expect(status.index).toEqual({ status: "ready", changedFiles: 2 });
    expect(status.cache.latestHitRate).toBe(0.92);
    const serialized = JSON.stringify(status);
    expect(serialized.length).toBeLessThan(500);
    expect(serialized).not.toContain("long text");
    expect(serialized).not.toContain("full memory");
  });
});
