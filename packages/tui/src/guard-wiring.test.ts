import { describe, expect, it } from "vitest";
import {
  formatProviderGuardSummary,
  formatRunnerGuardSummary,
  formatRuntimePathDoctor,
  formatStartupPathDoctor,
  formatVerificationLevelDoctor,
  validateChangeDeclarationHuman,
  validateCompletionClaim,
} from "./guard-wiring.js";
import { classifyRuntimePath, classifyStartupPath } from "./runtime-path-marker.js";
import { createReadinessItems } from "./terminal-readiness-presenter.js";
import { classifyVerificationLevel } from "./verification-level.js";

describe("guard-wiring", () => {
  describe("formatRuntimePathDoctor", () => {
    it("reports ink main path as ok", () => {
      const marker = classifyRuntimePath({ isTTY: true, inkAvailable: true });
      const item = formatRuntimePathDoctor(marker, "zh-CN");
      expect(item.ok).toBe(true);
      expect(item.summary).toContain("Ink 主路径");
    });

    it("reports plain fallback as not ok with explanation", () => {
      const marker = classifyRuntimePath({ isTTY: true, inkAvailable: false });
      const item = formatRuntimePathDoctor(marker, "zh-CN");
      expect(item.ok).toBe(false);
      expect(item.summary).toContain("降级路径");
      expect(item.summary).toContain("不能声称 TUI 已成熟");
      expect(item.nextAction).toContain("真实终端");
    });

    it("reports non-tty as not ok", () => {
      const marker = classifyRuntimePath({ isTTY: false });
      const item = formatRuntimePathDoctor(marker, "en-US");
      expect(item.ok).toBe(false);
      expect(item.summary).toContain("Fallback path");
      expect(item.summary).toContain("TUI maturity cannot be claimed");
    });
  });

  describe("formatStartupPathDoctor", () => {
    it("reports source execution as ok", () => {
      const marker = classifyStartupPath({ isSourceExecution: true });
      const item = formatStartupPathDoctor(marker, "zh-CN");
      expect(item.ok).toBe(true);
      expect(item.summary).toContain("从源码运行");
    });

    it("reports dist as stale risk", () => {
      const marker = classifyStartupPath({ isDistExecution: true });
      const item = formatStartupPathDoctor(marker, "zh-CN");
      expect(item.ok).toBe(false);
      expect(item.summary).toContain("可能已过时");
      expect(item.nextAction).toContain("重新构建");
    });
  });

  describe("formatVerificationLevelDoctor", () => {
    it("reports real-smoke as ok", () => {
      const classification = classifyVerificationLevel({
        realProcessObserved: true,
        fallbackUsed: false,
        mockUsed: false,
      });
      const item = formatVerificationLevelDoctor(classification, "zh-CN");
      expect(item.ok).toBe(true);
      expect(item.summary).toContain("真实 smoke 验证");
    });

    it("reports local level as not ok with next action", () => {
      const classification = classifyVerificationLevel({
        localTestRunner: true,
        mockUsed: false,
      });
      const item = formatVerificationLevelDoctor(classification, "zh-CN");
      expect(item.ok).toBe(false);
      expect(item.summary).toContain("不能声称已成熟");
      expect(item.nextAction).toContain("需要");
    });

    it("reports mock level as not ok", () => {
      const classification = classifyVerificationLevel({ mockUsed: true });
      const item = formatVerificationLevelDoctor(classification, "en-US");
      expect(item.ok).toBe(false);
      expect(item.summary).toContain("Cannot claim mature");
    });
  });

  describe("formatRunnerGuardSummary", () => {
    it("node fallback cannot claim native mature", () => {
      const summary = formatRunnerGuardSummary("node", "node_fallback", "unavailable", "zh-CN");
      expect(summary).toContain("Node 降级方案");
      expect(summary).toContain("不能证明原生 runner 已成熟");
    });

    it("native completed can claim mature", () => {
      const summary = formatRunnerGuardSummary("native", "completed", undefined, "zh-CN");
      expect(summary).toContain("成熟度已验证");
    });

    it("native non-completed cannot claim mature", () => {
      const summary = formatRunnerGuardSummary("native", "running", undefined, "en-US");
      expect(summary).toContain("not a maturity proof");
    });
  });

  describe("formatProviderGuardSummary", () => {
    it("cooldown cannot claim ready", () => {
      const summary = formatProviderGuardSummary(
        { realEndpointHit: true, fallbackUsed: false, mockUsed: false, cooldownActive: true },
        "zh-CN",
      );
      expect(summary).toContain("冷却中");
      expect(summary).toContain("不能声称 provider 已就绪");
    });

    it("mock cannot claim ready", () => {
      const summary = formatProviderGuardSummary(
        { realEndpointHit: false, fallbackUsed: false, mockUsed: true, cooldownActive: false },
        "zh-CN",
      );
      expect(summary).toContain("mock");
      expect(summary).toContain("真实端点请求");
    });

    it("real endpoint hit can claim ready", () => {
      const summary = formatProviderGuardSummary(
        { realEndpointHit: true, fallbackUsed: false, mockUsed: false, cooldownActive: false },
        "zh-CN",
      );
      expect(summary).toContain("就绪状态已确认");
    });

    it("fallback cannot claim ready", () => {
      const summary = formatProviderGuardSummary(
        { realEndpointHit: true, fallbackUsed: true, mockUsed: false, cooldownActive: false },
        "en-US",
      );
      expect(summary).toContain("fallback");
      expect(summary).toContain("Main provider path must succeed");
    });
  });

  describe("validateCompletionClaim", () => {
    it("source-only claim PASS produces inflation warning", () => {
      const result = validateCompletionClaim("PASS", "source", undefined, "zh-CN");
      expect(result.valid).toBe(false);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain("不能声称");
      expect(result.warnings[0]).toContain("仅源码分析");
    });

    it("mock claim mature produces inflation warning", () => {
      const result = validateCompletionClaim("mature", "mock", undefined, "en-US");
      expect(result.valid).toBe(false);
      expect(result.warnings[0]).toContain("Cannot claim");
      expect(result.warnings[0]).toContain("mock/simulated");
    });

    it("real-smoke claim mature is valid", () => {
      const result = validateCompletionClaim("mature", "real-smoke", undefined, "zh-CN");
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it("fallback runtime path blocks mature claim", () => {
      const marker = classifyRuntimePath({ isTTY: false });
      const result = validateCompletionClaim("mature", "real-smoke", marker, "zh-CN");
      expect(result.valid).toBe(false);
      expect(result.warnings.some((w) => w.includes("降级路径"))).toBe(true);
    });

    it("ink main path allows mature claim", () => {
      const marker = classifyRuntimePath({ isTTY: true, inkAvailable: true });
      const result = validateCompletionClaim("mature", "real-smoke", marker, "zh-CN");
      expect(result.valid).toBe(true);
    });

    it("build level claim PASS is valid", () => {
      const result = validateCompletionClaim("PASS", "build", undefined, "en-US");
      expect(result.valid).toBe(true);
    });
  });

  describe("validateChangeDeclarationHuman", () => {
    it("warns on large change without realSmokeRequired in Chinese", () => {
      const warnings = validateChangeDeclarationHuman(
        {
          files: ["a.ts", "b.ts", "c.ts", "d.ts"],
          mainPath: "main",
          verificationLevel: "local",
          realSmokeRequired: [],
        },
        "zh-CN",
      );
      expect(warnings.some((w) => w.includes("大改动"))).toBe(true);
    });

    it("warns on missing mainPath in English", () => {
      const warnings = validateChangeDeclarationHuman({ files: ["a.ts"] }, "en-US");
      expect(warnings.some((w) => w.includes("mainPath"))).toBe(true);
    });

    it("passes for complete declaration", () => {
      const warnings = validateChangeDeclarationHuman(
        {
          files: ["a.ts", "b.ts", "c.ts", "d.ts"],
          mainPath: "main",
          verificationLevel: "build",
          realSmokeRequired: ["TUI rendering"],
        },
        "zh-CN",
      );
      expect(warnings).toHaveLength(0);
    });
  });

  describe("createReadinessItems guard wiring (zh-CN natural language)", () => {
    function makeMinimalView(overrides: Record<string, unknown> = {}) {
      return {
        projectPath: "/test",
        provider: "test",
        model: "test",
        endpointProfile: "default",
        providerLiveVerified: false,
        permissionMode: "default" as const,
        language: "zh-CN" as const,
        index: { status: "ready" },
        cache: { latestHitRate: 0.5, compacted: false, workspaceSnapshot: "ready" },
        memory: { projectRules: "found" as const, candidates: 0, accepted: 0 },
        mcp: { enabled: false, servers: 0, tools: 0, errors: 0 },
        background: { total: 0, running: 0, blocked: 0 },
        freshness: { webSourceEvidence: "missing" as const },
        projectDoctor: {
          status: "pass" as const,
          packageManager: "pnpm",
          scripts: [],
          configFiles: [],
          ciFiles: [],
          projectRules: "found" as const,
          checks: [],
          unknown: [],
        },
        sourceDrift: { status: "pass" as const, checked: [], issues: [], nextAction: "none" },
        contextPicker: {
          status: "pass" as const,
          refs: [],
          evidenceKinds: [],
          indexFreshness: "fresh" as const,
        },
        rollbackCoach: {
          status: "pass" as const,
          changedFiles: 0,
          untrackedFiles: 0,
          checkpoints: 0,
          gitStatus: "clean" as const,
          mode: "advisory-only" as const,
          nextAction: "none",
        },
        costPreview: {
          status: "pass" as const,
          level: "light" as const,
          labels: [],
          nextAction: "none",
        },
        problems: [],
        ...overrides,
      };
    }

    it("runtime-path fallback outputs Chinese natural language, not raw markers", () => {
      const view = makeMinimalView({
        runtimePath: {
          path: "plain",
          kind: "fallback",
          canClaimMature: false,
          degradedReason: "ink-unavailable",
        },
      });
      const items = createReadinessItems(view);
      const rpItem = items.find((i) => i.id === "runtime-path");
      expect(rpItem).toBeDefined();
      // Must contain Chinese natural language
      expect(rpItem?.summary).toContain("不能声称 TUI 已成熟");
      expect(rpItem?.summary).toContain("降级路径");
      expect(rpItem?.nextAction).toContain("真实终端");
      // Must NOT contain raw English marker style
      expect(rpItem?.summary).not.toContain("TUI maturity not claimable");
      expect(rpItem?.nextAction).not.toContain("run in real terminal with Ink support");
    });

    it("verification-level local outputs Chinese natural language, not raw markers", () => {
      const view = makeMinimalView({
        verificationLevel: {
          level: "local",
          canClaimPass: false,
          canClaimMature: false,
          upgradeBlocked: true,
          blockReason: "mock/fallback detected",
        },
      });
      const items = createReadinessItems(view);
      const vlItem = items.find((i) => i.id === "verification-level");
      expect(vlItem).toBeDefined();
      // Must contain Chinese natural language
      expect(vlItem?.summary).toContain("不能声称已成熟");
      expect(vlItem?.nextAction).toContain("需要");
      // Must NOT contain raw English marker style
      expect(vlItem?.summary).not.toContain("real smoke required for mature");
      expect(vlItem?.summary).not.toContain("mature/PASS not claimable");
      expect(vlItem?.nextAction).not.toContain("run real smoke verification");
    });

    it("startup-path dist outputs Chinese natural language, not raw markers", () => {
      const view = makeMinimalView({
        startupPath: {
          entryKind: "dist",
          isVerifiedCurrent: false,
          staleRisk: true,
          staleReason: "dist-may-be-outdated",
        },
      });
      const items = createReadinessItems(view);
      const spItem = items.find((i) => i.id === "startup-path");
      expect(spItem).toBeDefined();
      // Must contain Chinese natural language
      expect(spItem?.summary).toContain("可能已过时");
      expect(spItem?.nextAction).toContain("重新构建");
      // Must NOT contain raw English marker style
      expect(spItem?.summary).not.toContain("may be outdated");
      expect(spItem?.nextAction).not.toContain("rebuild or run from source");
    });

    it("runtime-path main path outputs Chinese ok summary", () => {
      const view = makeMinimalView({
        runtimePath: {
          path: "ink",
          kind: "main",
          canClaimMature: true,
        },
      });
      const items = createReadinessItems(view);
      const rpItem = items.find((i) => i.id === "runtime-path");
      expect(rpItem).toBeDefined();
      expect(rpItem?.status).toBe("pass");
      expect(rpItem?.summary).toContain("Ink 主路径");
    });

    it("en-US mode outputs English natural language", () => {
      const view = makeMinimalView({
        language: "en-US",
        runtimePath: {
          path: "non-tty",
          kind: "fallback",
          canClaimMature: false,
          degradedReason: "non-tty-output",
        },
      });
      const items = createReadinessItems(view);
      const rpItem = items.find((i) => i.id === "runtime-path");
      expect(rpItem).toBeDefined();
      expect(rpItem?.summary).toContain("Fallback path");
      expect(rpItem?.summary).toContain("TUI maturity cannot be claimed");
      expect(rpItem?.nextAction).toContain("real terminal");
    });
  });
});
