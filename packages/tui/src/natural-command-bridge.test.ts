import { describe, expect, it } from "vitest";
import {
  type RuntimeStatusSource,
  buildRuntimeStatusForModel,
  createModelCapabilitySummary,
  getCommandCapabilityCatalog,
  routeNaturalIntent,
  validateCommandCapabilityCoverage,
} from "./natural-command-bridge.js";

describe("Phase 15 Command Capability Catalog", () => {
  it("covers every user-visible slash command and marks internal commands", () => {
    expect(validateCommandCapabilityCoverage()).toEqual([]);
    const catalog = getCommandCapabilityCatalog();
    expect(catalog.some((item) => item.id === "status" && item.hiddenReason)).toBe(true);
    expect(
      catalog.every(
        (item) =>
          item.titleZh && item.titleEn && item.whenToUseZh && item.whenToUseEn && item.group,
      ),
    ).toBe(true);
    expect(catalog.find((item) => item.slash === "/model")?.group).toBe("core");
    expect(catalog.find((item) => item.slash === "/index")?.group).toBe("index-mcp");
    expect(catalog.find((item) => item.slash === "/write")?.group).toBe("edit");
  });

  it("creates a stable short model-visible summary", () => {
    const summary = createModelCapabilitySummary(8);
    expect(summary).toContain("risk ");
    expect(summary).not.toContain("risk=");
    expect(summary).toContain("/cache");
    expect(summary.length).toBeLessThan(1200);
    expect(summary).not.toContain("transcript");
    expect(summary).not.toContain("full log");
  });
});

describe("Phase 5 ordinary language boundary", () => {
  it.each([
    "帮我重建索引后只跑相关测试",
    "当前模型是什么，顺便解释这个报错",
    "后台任务状态和这个 PR 的影响范围一起看",
    "先读项目规则，再改这个局部函数",
    "停止所有智能体，但不要影响正在跑的局部测试",
    "请解释 /model 与当前任务的关系",
    "我们是否应该使用 /index status，而不是跑全局检查？",
    "build the index, then only test the touched package",
    "check the current status and fix this one failing test",
    "review this change without starting a global workflow",
    "continue the task, but keep the scope local",
  ])("delegates ordinary text to the model policy contract: %s", (text) => {
    const intent = routeNaturalIntent(text);

    expect(intent).toMatchObject({
      action: "model",
      candidates: [],
      inquiry: "execute",
      runtimeIntent: { kind: "none" },
      riskHandler: "model",
    });
    expect(intent.capability).toBeUndefined();
  });

  it.each([
    ["/status", "status"],
    ["/model doctor", "model"],
    ["/doctor hooks", "hooks"],
    ["/index status", "index"],
    ["/background", "background"],
  ])("keeps explicit slash control available: %s", (text, capabilityId) => {
    const intent = routeNaturalIntent(text);
    expect(intent.capability?.id).toBe(capabilityId);
    expect(intent.action).not.toBe("model");
  });
});

describe("Phase 15 RuntimeStatusForModel", () => {
  it("uses real short source fields without dumping memory/transcript/index/log", () => {
    const source: RuntimeStatusSource = {
      model: "claude-sonnet-4-6",
      provider: "anthropic",
      permissionMode: "default",
      projectPath: "/tmp/project",
      language: "zh-CN",
      memory: {
        projectRulesExists: true,
        candidates: [{ id: "candidate", text: "long text should not appear" }],
        accepted: [{ id: "accepted", text: "full memory should not appear" }],
      },
      index: { status: "ready", projectName: "F-Linghun", changedFiles: 2 },
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
    expect(status.index).toEqual({ status: "ready", projectName: "F-Linghun", changedFiles: 2 });
    expect(status.cache.latestHitRate).toBe(0.92);
    expect(status.model).toEqual({ provider: "anthropic", name: "claude-sonnet-4-6" });
    const serialized = JSON.stringify(status);
    expect(serialized.length).toBeLessThan(500);
    expect(serialized).not.toContain("long text");
    expect(serialized).not.toContain("full memory");
  });

  it("falls back to unknown provider when source has no provider", () => {
    const source: RuntimeStatusSource = {
      model: "custom-model",
      permissionMode: "default",
      projectPath: "/tmp/project",
      language: "zh-CN",
      memory: { projectRulesExists: false, candidates: [], accepted: [] },
      index: { status: "unknown" },
      cache: { history: [] },
      skills: { enabled: false, skills: [] },
      plugins: { enabled: false, plugins: [] },
      hooks: { enabled: false, hooks: [] },
    };

    expect(buildRuntimeStatusForModel(source).model).toEqual({
      provider: "unknown",
      name: "custom-model",
    });
  });
});

describe("D.13R Git Readiness — /git /worktree /checkpoint 在发现层可见", () => {
  it("git / worktree / checkpoint 在 SLASH_COMMAND_REGISTRY 中可见", async () => {
    const { SLASH_COMMAND_REGISTRY } = await import("./natural-command-bridge.js");
    const slashes = SLASH_COMMAND_REGISTRY.filter((entry) => entry.userVisible).map(
      (entry) => entry.slash,
    );
    expect(slashes).toContain("/git");
    expect(slashes).toContain("/worktree");
    expect(slashes).toContain("/checkpoint");
  });

  it("getCommandCapabilityCatalog 含 git / worktree / checkpoint，risk=readonly，userInvocable", () => {
    const catalog = getCommandCapabilityCatalog();
    for (const id of ["git", "worktree", "checkpoint"]) {
      const cap = catalog.find((item) => item.id === id);
      expect(cap, `${id} should be in catalog`).toBeDefined();
      expect(cap?.risk).toBe("readonly");
      expect(cap?.readonly).toBe(true);
      expect(cap?.userInvocable).toBe(true);
      // readonly 的命令也应当 modelInvocable=true（与 /index、/cache 同级别）。
      expect(cap?.modelInvocable).toBe(true);
      // diagnostics 组（与 /cache、/cache-log 一致）。
      expect(cap?.group).toBe("diagnostics");
    }
  });

  it("getSlashPrefixCandidates 能匹配到 /git / /worktree / /checkpoint 前缀", async () => {
    const { getSlashPrefixCandidates } = await import("./slash-dispatch.js");
    const giCandidates = getSlashPrefixCandidates("/gi").map((c) => c.slash);
    expect(giCandidates).toContain("/git");

    const wkCandidates = getSlashPrefixCandidates("/wo").map((c) => c.slash);
    expect(wkCandidates).toContain("/worktree");

    const ckCandidates = getSlashPrefixCandidates("/check").map((c) => c.slash);
    expect(ckCandidates).toContain("/checkpoint");
  });

  it("/help all 文本含 /git / /worktree / /checkpoint 行", async () => {
    const { formatCatalogHelp } = await import("./slash-dispatch.js");
    const helpEn = formatCatalogHelp("en-US", "default", false, "all");
    const helpZh = formatCatalogHelp("zh-CN", "default", false, "all");
    expect(helpEn).toContain("/git");
    expect(helpEn).toContain("/worktree");
    expect(helpEn).toContain("/checkpoint");
    expect(helpZh).toContain("/git");
    expect(helpZh).toContain("/worktree");
    expect(helpZh).toContain("/checkpoint");
  });

  it("/help advanced 文本含 /git / /worktree / /checkpoint 行", async () => {
    const { formatCatalogHelp } = await import("./slash-dispatch.js");
    const advEn = formatCatalogHelp("en-US", "default", false, "advanced");
    const advZh = formatCatalogHelp("zh-CN", "default", false, "advanced");
    expect(advEn).toContain("/git");
    expect(advEn).toContain("/worktree");
    expect(advEn).toContain("/checkpoint");
    expect(advZh).toContain("/git");
    expect(advZh).toContain("/worktree");
    expect(advZh).toContain("/checkpoint");
  });

  it("HelpPanel advanced 分组含 /git / /worktree / /checkpoint", async () => {
    const { buildHelpPanelData } = await import("./shell/models/help-panel.js");
    const advancedZh = buildHelpPanelData("advanced", 0, 0, "zh-CN");
    const advancedEn = buildHelpPanelData("advanced", 0, 0, "en-US");
    const slashesZh = advancedZh.entries.map((entry) => entry.slash);
    const slashesEn = advancedEn.entries.map((entry) => entry.slash);
    for (const slash of ["/git", "/worktree", "/checkpoint"]) {
      expect(slashesZh).toContain(slash);
      expect(slashesEn).toContain(slash);
    }
  });
});
