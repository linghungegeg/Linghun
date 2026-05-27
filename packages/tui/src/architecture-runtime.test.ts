import { describe, expect, it } from "vitest";
import {
  type ArchitectureCard,
  collectArchitectureFacts,
  createArchitectureCard,
  createArchitectureRuntimeDirective,
  detectArchitectureDrift,
  formatArchitectureCard,
  shouldTriggerArchitectureRuntime,
} from "./architecture-runtime.js";

const baseCard: ArchitectureCard = {
  target: "实现跨模块 Architecture Runtime",
  projectFacts: ["unknown: no verified README/package/source/index/evidence facts are available"],
  recommendedApproach: "按最小影响面分阶段实现。",
  rejectedApproaches: ["不新增 agent。"],
  stagedBreakdown: ["先写 focused tests。"],
  risks: ["unknown/stale facts must stay bounded。"],
  verification: ["运行 focused tests。"],
  nonGoals: [
    "不改变 default/auto-review/plan/full-access 四权限模式。",
    "不绕过 Start Gate、permission pipeline 或 Plan approval。",
    "不新增未确认的依赖、配置、agent、DB 或长期 memory。",
    "不替代 Freshness/Web Evidence、Verification Runner 或 verifier。",
  ],
};

describe("architecture runtime trigger rules", () => {
  it("does not trigger for small local tasks", () => {
    expect(shouldTriggerArchitectureRuntime("修一个 typo")).toBe(false);
    expect(shouldTriggerArchitectureRuntime("只改这一处单文件小 bug")).toBe(false);
    expect(shouldTriggerArchitectureRuntime("只读状态查询，解释一下即可")).toBe(false);
  });

  it("triggers for cross-module and public API work", () => {
    expect(shouldTriggerArchitectureRuntime("跨模块实现 Architecture Runtime")).toBe(true);
    expect(shouldTriggerArchitectureRuntime("修改 public API 并同步调用方")).toBe(true);
  });

  it("triggers for dependency, config, deployment, performance, and security work", () => {
    expect(shouldTriggerArchitectureRuntime("调整 package.json 依赖和 tsconfig 配置")).toBe(true);
    expect(shouldTriggerArchitectureRuntime("分析部署、性能和安全风险并实现")).toBe(true);
  });

  it("triggers for common new feature requests", () => {
    expect(shouldTriggerArchitectureRuntime("实现登录功能")).toBe(true);
    expect(shouldTriggerArchitectureRuntime("加一个导出报表功能")).toBe(true);
    expect(shouldTriggerArchitectureRuntime("add export report feature")).toBe(true);
  });

  it("triggers for ordinary page/component/UI development requests", () => {
    expect(shouldTriggerArchitectureRuntime("做一个页面")).toBe(true);
    expect(shouldTriggerArchitectureRuntime("做一个登录页面")).toBe(true);
    expect(shouldTriggerArchitectureRuntime("写一个 React 组件")).toBe(true);
    expect(shouldTriggerArchitectureRuntime("帮我做个首页")).toBe(true);
    expect(shouldTriggerArchitectureRuntime("实现一个用户列表页面")).toBe(true);
    expect(shouldTriggerArchitectureRuntime("加一个导航栏")).toBe(true);
    expect(shouldTriggerArchitectureRuntime("build a landing page")).toBe(true);
    expect(shouldTriggerArchitectureRuntime("create a dashboard page")).toBe(true);
    expect(shouldTriggerArchitectureRuntime("make a responsive homepage")).toBe(true);
  });

  it("triggers for bug fix requests that are not trivially small", () => {
    expect(shouldTriggerArchitectureRuntime("修复登录页面的 bug")).toBe(true);
    expect(shouldTriggerArchitectureRuntime("fix a bug in the login form")).toBe(true);
    expect(shouldTriggerArchitectureRuntime("debug this crash issue")).toBe(true);
  });

  it("does not trigger for trivially small bug fixes", () => {
    expect(shouldTriggerArchitectureRuntime("修一个小 bug")).toBe(false);
    expect(shouldTriggerArchitectureRuntime("fix a local small bug")).toBe(false);
  });

  it("triggers when the user requests mature complete reference-aligned work", () => {
    expect(
      shouldTriggerArchitectureRuntime("请做 mature complete reference-aligned no omissions 实现"),
    ).toBe(true);
    expect(shouldTriggerArchitectureRuntime("做成熟、完整、对齐参考源、不要遗漏")).toBe(true);
  });
});

describe("architecture card facts and formatting", () => {
  it("uses unknown when no verified project facts are available", () => {
    expect(collectArchitectureFacts({})).toEqual([
      "unknown: no verified README/package/source/index/evidence facts are available in this request",
    ]);
  });

  it("marks current external facts as stale/freshness-needed instead of confirmed", () => {
    const facts = collectArchitectureFacts({
      evidence: [{ kind: "web_source", source: "unknown", summary: "latest provider API price" }],
    });

    expect(facts.some((fact) => fact.startsWith("stale:"))).toBe(true);
  });

  it("marks latest external facts from the user input as stale when no evidence exists", () => {
    const card = createArchitectureCard(
      "use latest provider API behavior for a mature implementation",
      {},
    );

    expect(card.projectFacts).toContain(
      "stale: user request mentions current/latest external facts; require Freshness/Web Evidence before treating them as facts",
    );
  });

  it("keeps the Architecture Card complete and short", () => {
    const card = createArchitectureCard("跨模块实现成熟 Architecture Runtime", {
      permissionMode: "default",
      index: { status: "ready", projectName: "F-Linghun", nodes: 10, edges: 8 },
    });
    const formatted = formatArchitectureCard(card);

    expect(Object.keys(card)).toEqual([
      "target",
      "projectFacts",
      "recommendedApproach",
      "rejectedApproaches",
      "stagedBreakdown",
      "risks",
      "verification",
      "nonGoals",
    ]);
    expect(formatted).toContain("Architecture Card");
    expect(formatted.length).toBeLessThan(1800);
  });

  it("states that runtime does not alter permissions, Start Gate, Plan, or verifier", () => {
    const directive = createArchitectureRuntimeDirective(baseCard);

    expect(directive).toContain("不授权写入");
    expect(directive).toContain("不改变权限模式");
    expect(directive).toContain("不替代 Plan approval");
    expect(directive).toContain("verifier");
  });

  it("includes maturity defaults and long task hint in the directive", () => {
    const directive = createArchitectureRuntimeDirective(baseCard);

    expect(directive).toContain("MaturityDefaults=");
    expect(directive).toContain("信息架构清晰");
    expect(directive).toContain("响应式布局");
    expect(directive).toContain("空态");
    expect(directive).toContain("错误态");
    expect(directive).toContain("LongTaskHint=");
    expect(directive).toContain("/autopilot");
    expect(directive).toContain("/plan");
  });

  it("includes anti-code-blob engineering structure constraints in the directive", () => {
    const directive = createArchitectureRuntimeDirective(baseCard);

    expect(directive).toContain("AntiCodeBlob=");
    expect(directive).toContain("god file");
    expect(directive).toContain("code blob");
    expect(directive).toContain("超长函数");
    expect(directive).toContain("深层嵌套");
    expect(directive).toContain("无边界全局状态");
    expect(directive).toContain("优先复用项目已有模块");
    expect(directive).toContain("不新建第二套系统");
    expect(directive).toContain("可验证边界");
    expect(directive).toContain("不是授权大重构");
    expect(directive).toContain("最小改动");
  });

  it("D.13P legacy-large-file debt directive treats index.ts as risk signal, not a violation, and asks the user", () => {
    const directive = createArchitectureRuntimeDirective(baseCard);

    // 目录 / 标识
    expect(directive).toContain("LegacyLargeFileDebt=");
    expect(directive).toContain("packages/tui/src/index.ts");
    expect(directive).toContain("legacy-large-file");
    expect(directive).toContain("D.14");

    // 风险口径：是维护风险信号，不是违规；不取代 permission pipeline。
    expect(directive).toContain("maintenance-risk signal");
    expect(directive).toContain("维护风险信号");
    expect(directive).toContain("not a violation");
    expect(directive).toContain("不是违规");
    expect(directive).toContain("does not grant write permission");
    expect(directive).toContain("不授权写入");
    expect(directive).toContain("permission pipeline");

    // 行为：先询问用户、给两条路径。
    expect(directive).toMatch(/prompt|ask user/);
    expect(directive).toContain("询问用户");
    expect(directive).toContain("continue minimal local change");
    expect(directive).toContain("最小局部改动");
    expect(directive).toContain("split plan");
    expect(directive).toContain("拆分计划");
  });
});

describe("architecture drift detection", () => {
  it("detects new dependency and config changes", () => {
    const drift = detectArchitectureDrift(baseCard, {
      toolName: "Bash",
      summary: "pnpm add left-pad and edit package.json",
    });

    expect(drift.drift).toBe(true);
    expect(drift.requiresConfirmation).toBe(true);
    expect(drift.warnings.join("\n")).toContain("dependency/config");
  });

  it("detects expansion to unmentioned modules", () => {
    const drift = detectArchitectureDrift(baseCard, {
      toolName: "Write",
      input: { file_path: "packages/other/src/new-runtime.ts" },
    });

    expect(drift.drift).toBe(true);
    expect(drift.warnings.join("\n")).toContain("scope expanded");
  });

  it("detects skipped verification", () => {
    const drift = detectArchitectureDrift(baseCard, {
      summary: "skip verification and do not run tests",
      skipVerification: true,
    });

    expect(drift.drift).toBe(true);
    expect(drift.warnings.join("\n")).toContain("verification skipped");
  });

  it("detects nonGoal violations", () => {
    const drift = detectArchitectureDrift(baseCard, {
      summary: "新增 agent 和 database 来处理 architecture runtime",
    });

    expect(drift.drift).toBe(true);
    expect(drift.warnings.join("\n")).toContain("non-goal");
  });

  it("does not treat report body DB/deploy/current uncertainty analysis as drift when writing markdown report", () => {
    const card: ArchitectureCard = {
      ...baseCard,
      target: "利用索引分析项目怎么部署，将报告写入 report.md",
      recommendedApproach: "保存部署分析报告到 report.md。",
    };

    const drift = detectArchitectureDrift(card, {
      toolName: "Write",
      input: {
        file_path: "report.md",
        content:
          "# 部署分析\n\n当前项目证据：有 package.json。\n\n数据库导入建议：不确定是否需要 DB，先备份数据。\n\nDB 配置说明：按现有环境变量检查。\n\n部署步骤：运行现有脚本。",
      },
      verificationPlanned: true,
    });

    expect(drift.drift).toBe(false);
  });

  it("still detects actual database additions as nonGoal drift", () => {
    const drift = detectArchitectureDrift(baseCard, {
      toolName: "Write",
      input: {
        file_path: "packages/tui/src/database-layer.ts",
        content: "create DB and add database dependency/config for architecture runtime",
      },
      verificationPlanned: true,
    });

    expect(drift.drift).toBe(true);
    expect(drift.warnings.join("\n")).toContain("non-goal");
  });

  it("still detects real dependency and config file changes", () => {
    const drift = detectArchitectureDrift(baseCard, {
      toolName: "Edit",
      input: {
        file_path: "package.json",
        content: "add deployment database dependency",
      },
      verificationPlanned: true,
    });

    expect(drift.drift).toBe(true);
    expect(drift.warnings.join("\n")).toContain("dependency/config");
  });

  it("detects approach changed drift", () => {
    const drift = detectArchitectureDrift(baseCard, {
      recommendedApproach: "改成完整 ADR DB 平台。",
    });

    expect(drift.drift).toBe(true);
    expect(drift.warnings.join("\n")).toContain("approach changed");
  });

  it("detects unknown or stale external facts treated as confirmed", () => {
    const drift = detectArchitectureDrift(baseCard, {
      summary: "已确认当前最新 provider API 行为，可以直接依赖。",
    });

    expect(drift.drift).toBe(true);
    expect(drift.warnings.join("\n")).toContain("stale facts");
  });

  it("still detects confirmed latest/current facts in report write summary", () => {
    const card: ArchitectureCard = {
      ...baseCard,
      target: "分析项目并写入 report.md",
      recommendedApproach: "保存报告到 report.md。",
    };
    const drift = detectArchitectureDrift(card, {
      toolName: "Write",
      summary: "已确认当前最新 provider API 行为并写入报告。",
      input: {
        file_path: "report.md",
        content: "# 报告\n\n这里可以描述不确定的部署和数据库情况。",
      },
    });

    expect(drift.drift).toBe(true);
    expect(drift.warnings.join("\n")).toContain("stale facts");
  });

  it("does not drift for a covered local small fix", () => {
    const card: ArchitectureCard = {
      ...baseCard,
      target: "只改 packages/tui/src/architecture-runtime.ts 的小修",
      projectFacts: ["source: packages/tui/src/architecture-runtime.ts is in scope"],
    };
    const drift = detectArchitectureDrift(card, {
      toolName: "Edit",
      input: { file_path: "packages/tui/src/architecture-runtime.ts" },
      verificationPlanned: true,
    });

    expect(drift.drift).toBe(false);
  });
});
