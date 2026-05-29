import { describe, expect, it } from "vitest";
import {
  type RuntimeStatusSource,
  buildRuntimeStatusForModel,
  createModelCapabilitySummary,
  createPendingNaturalCommand,
  formatCapabilityAnswer,
  formatNaturalClarification,
  formatNaturalPermissionBlock,
  formatNaturalStartGate,
  getCommandCapabilityCatalog,
  matchesNaturalGateConfirmation,
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
  "readiness",
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
    ["现在是什么模型", "model"],
    ["你现在用的哪个模型", "model"],
    ["你用的哪个模型", "model"],
    ["当前模型是什么", "model"],
    ["你是什么模型", "model"],
    ["what model are you using?", "model"],
    ["current model", "model"],
    ["当前权限模式", "mode"],
    ["current permission mode", "mode"],
    ["有哪些工作流", "workflows"],
    ["list workflows", "workflows"],
    ["hook 开了吗", "hooks"],
    ["are hooks enabled?", "hooks"],
  ])("routes first batch phrase %s", (phrase, id) => {
    const intent = routeNaturalIntent(phrase);
    expect(intent.capability?.id).toBe(id);
    expect([
      "execute_readonly",
      "safe_local_action",
      "start_gate",
      "answer",
      "permission_pipeline",
    ]).toContain(intent.action);
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

  it("aligns /doctor natural catalog routing with readiness default", () => {
    const explicit = routeNaturalIntent("请解释 /doctor");
    const readiness = routeNaturalIntent("终端就绪检查");
    const project = routeNaturalIntent("doctor project", "en-US");
    const hooks = routeNaturalIntent("doctor hooks", "en-US");

    expect(explicit.capability?.id).toBe("readiness");
    expect(explicit.command).toBe("/doctor");
    expect(formatCapabilityAnswer(explicit)).toContain("终端就绪诊断");
    expect(readiness.capability?.id).toBe("readiness");
    expect(readiness.action).toBe("execute_readonly");
    expect(project.capability?.id).toBe("readiness");
    expect(project.command).toBe("/doctor");
    expect(formatCapabilityAnswer(project)).toContain("Project Doctor");
    expect(hooks.capability?.id).toBe("hooks");
    expect(hooks.command).toBe("/doctor hooks");
  });

  it.each([
    ["现在是什么模型", "model", "/model"],
    ["你用的哪个模型", "model", "/model"],
    ["what model are you using", "model", "/model"],
    ["模型 key 配好了吗", "model", "/model route doctor"],
    ["模型配置正常吗", "model", "/model route doctor"],
    ["is the model configured correctly", "model", "/model route doctor"],
    ["/model 怎么用", "model", "/model"],
    ["what does /model do", "model", "/model"],
    ["帮我建立索引", "index", "/index init fast"],
    ["帮我给这个项目建立索引", "index", "/index init fast"],
    ["帮我更新项目索引", "index", "/index refresh"],
    ["帮我刷新索引", "index", "/index refresh"],
    ["帮我同步索引", "index", "/index refresh"],
    ["帮我重建索引", "index", "/index refresh --confirm-rebuild"],
    ["索引已经建立了是吧", "index", "/index status"],
    ["索引已经建立了吗", "index", "/index status"],
    ["索引状态怎么样", "index", "/index status"],
    ["is the index ready", "index", "/index status"],
    ["项目规则是什么", "read", "/read LINGHUN.md"],
    ["本仓库规则是什么", "read", "/read LINGHUN.md"],
    ["读一下 LINGHUN.md", "read", "/read LINGHUN.md"],
    ["read project rules", "read", "/read LINGHUN.md"],
    ["缓存状态怎么样", "cache", "/cache status"],
    ["自动记忆是否打开", "memory", "/memory"],
    ["直接 npm install", "bash", "/bash npm install"],
    ["开启 bypass", "mode", "/mode full-access"],
    ["切到自动审查", "mode", "/mode auto-review"],
    ["switch to auto mode", "mode", "/mode auto-review"],
    ["切到完全访问", "mode", "/mode full-access"],
  ])("classifies Natural Intent Contract sample %s", (phrase, id, command) => {
    const intent = routeNaturalIntent(phrase);
    expect(intent.capability?.id).toBe(id);
    expect(intent.command).toBe(command);
    if (
      phrase.includes("模型 key") ||
      phrase.includes("配置正常") ||
      phrase.includes("configured")
    ) {
      expect(intent.inquiry).toBe("doctor");
      expect(intent.action).toBe("execute_readonly");
    }
    if (phrase.includes("现在") || phrase.includes("哪个模型") || phrase.includes("what model")) {
      expect(intent.inquiry).toBe("status");
      expect(intent.action).toBe("execute_readonly");
    }
    if (phrase.includes("怎么用") || phrase.includes("what does")) {
      expect(intent.inquiry).toBe("usage");
      expect(intent.action).toBe("answer");
    }
    if (phrase.includes("建立索引") && !phrase.includes("已经")) {
      expect(intent.inquiry).toBe("execute");
      expect(intent.action).toBe("safe_local_action");
    }
    if (phrase.includes("已经") || phrase.includes("状态") || phrase.includes("index ready")) {
      expect(intent.inquiry).toBe("status");
      expect(intent.action).toBe("execute_readonly");
    }
    if (
      phrase.includes("项目规则") ||
      phrase.includes("本仓库规则") ||
      phrase.includes("LINGHUN.md") ||
      phrase.includes("project rules")
    ) {
      expect(intent.inquiry).toBe("read");
      expect(intent.action).toBe("execute_readonly");
    }
    if (phrase.includes("npm install")) {
      expect(intent.action).toBe("permission_pipeline");
    }
    if (phrase.includes("bypass") || phrase.includes("完全访问")) {
      expect(intent.action).toBe("start_gate");
    }
  });

  it.each([
    ["怎么搜索代码里的 TODO", "grep"],
    ["how do I read a file", "read"],
    ["怎么按模式找文件", "glob"],
    ["todo 怎么用", "todo"],
    ["怎么跑验证", "verify"],
    ["有哪些 agents", "agents"],
    ["后台任务怎么看", "background"],
  ])("routes second batch discovery phrase %s", (phrase, id) => {
    const intent = routeNaturalIntent(phrase);
    expect(intent.capability?.id).toBe(id);
    expect(["answer", "start_gate", "execute_readonly"]).toContain(intent.action);
  });

  it.each([
    ["帮我直接运行 npm install", "bash"],
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

  it.each([
    ["直接开启 bypass", "mode", "/mode full-access"],
    ["切到自动审查", "mode", "/mode auto-review"],
    ["auto mode", "mode", "/mode auto-review"],
    ["切到完全访问", "mode", "/mode full-access"],
    ["model route doctor", "model", "/model route doctor"],
  ])("extracts key natural parameters for %s", (phrase, id, command) => {
    const intent = routeNaturalIntent(phrase);
    expect(intent.capability?.id).toBe(id);
    expect(intent.command).toBe(command);
  });

  it.each(["信任这个项目", "调整工作区信任", "trust this folder", "workspace trust"])(
    "keeps Polish B natural workspace trust phrase off /trust trust: %s",
    (phrase) => {
      const intent = routeNaturalIntent(phrase);
      expect(intent.capability?.id).toBe("trust");
      expect(intent.action).toBe("start_gate");
      expect(intent.command).toBe("/trust status");
      expect(intent.command).not.toBe("/trust trust");
    },
  );

  it.each(["/trust trust", "/trust restricted", "/trust untrust"])(
    "keeps /trust slash fallback discoverable for %s",
    (phrase) => {
      const intent = routeNaturalIntent(phrase);
      expect(intent.capability?.id).toBe("trust");
      expect(intent.action).toBe("answer");
    },
  );

  it("returns low-confidence typos to the model instead of guessing a command", () => {
    expect(routeNaturalIntent("cach statuz").action).toBe("model");
    const multi = routeNaturalIntent("status");
    expect(["ask_clarify", "model", "execute_readonly"]).toContain(multi.action);
  });

  it.each([
    "帮我分析一下这个是什么项目，要怎么部署，将报告输出在根目录下",
    "分析这个 repo 并写一份报告",
    "项目有索引，可以先看看索引，再分析这个项目",
    "请先看索引再分析项目并输出报告",
    "help me understand this project and deploy it",
    "please inspect the code and create a root report",
  ])("leaves ordinary development request to the model loop: %s", (phrase) => {
    const intent = routeNaturalIntent(phrase);
    expect(intent.action).toBe("model");
    expect(intent.riskHandler).toBe("model");
  });

  it("keeps index capability wording aligned with safe local actions", () => {
    const capability = getCommandCapabilityCatalog().find((item) => item.id === "index");
    expect(capability?.descriptionZh).toContain("本地安全动作");
    expect(capability?.descriptionEn).toContain("safe local actions");
    expect(capability?.whenToUseZh).toContain("重建或 force 需精确确认");
    expect(capability?.whenToUseEn).toContain("rebuild or force needs exact confirmation");
  });

  it("keeps permission status queries readonly without changing modes", () => {
    const intent = routeNaturalIntent("当前权限模式是什么");
    expect(intent.capability?.id).toBe("mode");
    expect(intent.command).toBe("/mode");
    expect(intent.inquiry).toBe("status");
    expect(intent.action).toBe("execute_readonly");
  });

  it("routes clear permission mode aliases without ambiguous clarification", () => {
    const intent = routeNaturalIntent("切到自动审查");
    expect(intent.capability?.id).toBe("mode");
    expect(intent.command).toBe("/mode auto-review");
    expect(intent.action).toBe("start_gate");
  });

  it("asks for clarification on ambiguous capability lists", () => {
    const intent = routeNaturalIntent("模型索引缓存");
    expect(intent.action).toBe("ask_clarify");
    expect(formatNaturalClarification(intent)).toContain("请选择一个自然语言方向");
    expect(formatNaturalClarification(intent)).toContain("风险：");
  });
});

describe("Phase 15 pending natural gate hardening", () => {
  const runtime: RuntimeStatusSource = {
    model: "deepseek-v4-flash",
    provider: "deepseek",
    permissionMode: "default",
    projectPath: "/tmp/project",
    language: "zh-CN",
    memory: { projectRulesExists: false, candidates: [], accepted: [] },
    index: { status: "ready", changedFiles: 0 },
    cache: { history: [] },
    skills: { enabled: true, skills: [] },
    plugins: { enabled: true, plugins: [] },
    hooks: { enabled: false, hooks: [] },
  };

  it.each([
    ["帮我更新项目索引", "/index refresh"],
    ["请刷新索引", "/index refresh"],
    ["帮我同步索引", "/index refresh"],
    ["refresh the project index", "/index refresh"],
    ["update the project index", "/index refresh"],
    ["sync the project index", "/index refresh"],
    ["帮我建立索引", "/index init fast"],
    ["请初始化索引", "/index init fast"],
    ["帮我创建索引", "/index init fast"],
    ["build the index", "/index init fast"],
    ["init index", "/index init fast"],
    ["create index", "/index init fast"],
  ])("routes safe index phrase %s as a safe local action", (phrase, command) => {
    const intent = routeNaturalIntent(phrase);
    expect(intent.capability?.id).toBe("index");
    expect(intent.action).toBe("safe_local_action");
    expect(intent.riskHandler).toBe("safe_local_action");
    expect(intent.command).toBe(command);
    expect(createPendingNaturalCommand(intent, runtime)).toBeNull();
  });

  it.each([
    "帮我重建索引",
    "重新索引",
    "重做索引",
    "rebuild the index",
    "reindex",
    "force rebuild index",
  ])("keeps rebuild-style index phrase %s behind exact Start Gate confirmation", (phrase) => {
    const intent = routeNaturalIntent(phrase);
    const gate = createPendingNaturalCommand(intent, runtime, new Date("2026-05-17T00:00:00.000Z"));
    expect(intent.action).toBe("start_gate");
    expect(gate).toMatchObject({
      capabilityId: "index",
      source: "natural",
      exactCommand: "/index refresh --confirm-rebuild",
      risk: "start_gate",
      scope: "current project /tmp/project",
      requiresExactConfirmation: true,
    });
    expect(gate).toBeTruthy();
    if (!gate) return;
    expect(gate.gateId).toMatch(/^ng-/);
    expect(gate.expiresAt).toBe("2026-05-17T00:01:30.000Z");
    expect(matchesNaturalGateConfirmation(gate, "确认", new Date("2026-05-17T00:00:30.000Z"))).toBe(
      "exact_required",
    );
    expect(
      matchesNaturalGateConfirmation(
        gate,
        "/index refresh --confirm-rebuild",
        new Date("2026-05-17T00:00:30.000Z"),
      ),
    ).toBe("confirmed");
  });

  it("expires pending gates before confirmation", () => {
    const intent = routeNaturalIntent("帮我重建索引");
    const gate = createPendingNaturalCommand(intent, runtime, new Date("2026-05-17T00:00:00.000Z"));
    expect(gate).toBeTruthy();
    if (!gate) return;
    expect(matchesNaturalGateConfirmation(gate, "yes", new Date("2026-05-17T00:00:30.000Z"))).toBe(
      "exact_required",
    );
    expect(
      matchesNaturalGateConfirmation(
        gate,
        "/index refresh --confirm-rebuild",
        new Date("2026-05-17T00:00:30.000Z"),
      ),
    ).toBe("confirmed");
    expect(
      matchesNaturalGateConfirmation(
        gate,
        "/index refresh --confirm-rebuild",
        new Date("2026-05-17T00:02:00.000Z"),
      ),
    ).toBe("expired");
  });

  it("keeps full-access mode behind exact Start Gate confirmation", () => {
    const intent = routeNaturalIntent("直接开启 bypass");
    const gate = createPendingNaturalCommand(intent, runtime, new Date("2026-05-17T00:00:00.000Z"));

    expect(intent.action).toBe("start_gate");
    expect(gate).toMatchObject({
      capabilityId: "mode",
      exactCommand: "/mode full-access",
      requiresExactConfirmation: true,
    });
    expect(gate).toBeTruthy();
    if (!gate) return;
    expect(matchesNaturalGateConfirmation(gate, "yes", new Date("2026-05-17T00:00:30.000Z"))).toBe(
      "exact_required",
    );
    expect(
      matchesNaturalGateConfirmation(
        gate,
        "/mode full-access",
        new Date("2026-05-17T00:00:30.000Z"),
      ),
    ).toBe("confirmed");
  });

  it("formats Chinese index rebuild Start Gate as a human-first decision prompt", () => {
    const intent = routeNaturalIntent("帮我重建索引");
    const gate = createPendingNaturalCommand(intent, runtime, new Date("2026-05-17T00:00:00.000Z"));
    const text = formatNaturalStartGate(intent, runtime, gate);

    expect(text).toContain("可以准备执行");
    expect(text).toContain("后续受保护操作仍会单独审批");
    expect(text).toContain("不能只回复“确认”或 yes");
    expect(text).not.toContain("精确命令：/index refresh --confirm-rebuild");
    expect(text).not.toContain("范围：current project /tmp/project");
    expect(text).not.toContain("带安全扫描的本地安全动作");
    expect(text).not.toContain("不应修改源码");
    expect(text).not.toContain("取消方式");
    expect(text).not.toContain("gateId");
    expect(text).not.toContain("expiresAt");
    expect(text).not.toContain("risk=");
    expect(text).not.toContain("readonly=");
    expect(text).not.toContain("writesConfig");
    expect(text).not.toContain("permissionPipeline");
    expect(text).not.toContain("logPath");
    expect(text).not.toContain("Gate：");
  });

  it("formats English index rebuild Start Gate without internal fields", () => {
    const intent = routeNaturalIntent("rebuild the index");
    const englishRuntime: RuntimeStatusSource = { ...runtime, language: "en-US" };
    const gate = createPendingNaturalCommand(
      { ...intent, language: "en-US" },
      englishRuntime,
      new Date("2026-05-17T00:00:00.000Z"),
    );
    const text = formatNaturalStartGate({ ...intent, language: "en-US" }, englishRuntime, gate);

    expect(text).toContain("Ready to prepare");
    expect(text).toContain("Protected follow-up actions still require their own approval");
    expect(text).toContain("plain `yes` is not accepted");
    expect(text).not.toContain("Exact command: /index refresh --confirm-rebuild");
    expect(text).not.toContain("Scope: current project /tmp/project");
    expect(text).not.toContain("safe local actions that run a safety scan");
    expect(text).not.toContain("gateId");
    expect(text).not.toContain("expiresAt");
    expect(text).not.toContain("risk=");
    expect(text).not.toContain("readonly=");
    expect(text).not.toContain("writesConfig");
    expect(text).not.toContain("permissionPipeline");
    expect(text).not.toContain("logPath");
    expect(text).not.toContain("Gate:");
  });

  it("keeps dangerous natural requests human-readable without raw flags", () => {
    const intent = routeNaturalIntent("直接 npm install");
    const text = formatNaturalPermissionBlock(intent);

    expect(intent.action).toBe("permission_pipeline");
    expect(text).toContain("不能由自然语言直通执行");
    expect(text).not.toContain("risk=");
    expect(text).not.toContain("readonly=");
    expect(text).not.toContain("writesConfig");
    expect(text).not.toContain("permissionPipeline");
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

describe("Slice D.9: Long Task / Runner Resilience — Natural Language Route", () => {
  it.each([
    ["继续做", "autopilot"],
    ["持续推进", "autopilot"],
    ["不用每步都问", "autopilot"],
    ["长任务", "background"],
    ["后台任务怎么看", "background"],
    ["后台", "background"],
    ["long task", "background"],
    ["本地任务", "job"],
    ["长期任务", "job"],
    ["任务报告", "job"],
  ])(
    "routes Chinese natural phrase '%s' to capability '%s' without requiring slash command",
    (phrase, expectedId) => {
      const intent = routeNaturalIntent(phrase);
      expect(intent.capability?.id).toBe(expectedId);
      expect(intent.action).not.toBe("model");
    },
  );

  it("routes autopilot natural phrases through start_gate, not bypassing permission", () => {
    const intent = routeNaturalIntent("持续推进这个任务");
    expect(intent.capability?.id).toBe("autopilot");
    expect(intent.action).toBe("start_gate");
    expect(intent.riskHandler).not.toBe("model");
  });

  it("routes job/background status queries as readonly without side effects", () => {
    const bgIntent = routeNaturalIntent("后台任务怎么看");
    expect(bgIntent.capability?.id).toBe("background");
    expect(["answer", "execute_readonly"]).toContain(bgIntent.action);

    const jobIntent = routeNaturalIntent("任务报告");
    expect(jobIntent.capability?.id).toBe("job");
    expect(["answer", "execute_readonly"]).toContain(jobIntent.action);
  });

  it("does not route ordinary development requests to autopilot/job/background", () => {
    const devIntent = routeNaturalIntent("帮我写一个排序算法");
    expect(devIntent.action).toBe("model");
    expect(devIntent.capability?.id).not.toBe("autopilot");
    expect(devIntent.capability?.id).not.toBe("job");
    expect(devIntent.capability?.id).not.toBe("background");
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
    const advancedZh = buildHelpPanelData("advanced", 0, "zh-CN");
    const advancedEn = buildHelpPanelData("advanced", 0, "en-US");
    const slashesZh = advancedZh.entries.map((entry) => entry.slash);
    const slashesEn = advancedEn.entries.map((entry) => entry.slash);
    for (const slash of ["/git", "/worktree", "/checkpoint"]) {
      expect(slashesZh).toContain(slash);
      expect(slashesEn).toContain(slash);
    }
  });
});
