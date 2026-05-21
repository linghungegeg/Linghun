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
    expect(drift.warnings.join("\n")).toContain("unmentioned module/file scope");
  });

  it("detects skipped verification", () => {
    const drift = detectArchitectureDrift(baseCard, {
      summary: "skip verification and do not run tests",
      skipVerification: true,
    });

    expect(drift.drift).toBe(true);
    expect(drift.warnings.join("\n")).toContain("skips verification");
  });

  it("detects nonGoal violations", () => {
    const drift = detectArchitectureDrift(baseCard, {
      summary: "新增 agent 和 database 来处理 architecture runtime",
    });

    expect(drift.drift).toBe(true);
    expect(drift.warnings.join("\n")).toContain("nonGoals");
  });

  it("detects recommended approach drift", () => {
    const drift = detectArchitectureDrift(baseCard, {
      recommendedApproach: "改成完整 ADR DB 平台。",
    });

    expect(drift.drift).toBe(true);
    expect(drift.warnings.join("\n")).toContain("recommended approach");
  });

  it("detects unknown or stale external facts treated as confirmed", () => {
    const drift = detectArchitectureDrift(baseCard, {
      summary: "已确认当前最新 provider API 行为，可以直接依赖。",
      treatsUnknownOrStaleAsFact: true,
    });

    expect(drift.drift).toBe(true);
    expect(drift.warnings.join("\n")).toContain("unknown/stale");
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
