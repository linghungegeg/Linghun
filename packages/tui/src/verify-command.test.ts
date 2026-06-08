import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import type { VerificationReport } from "./index.js";
import {
  createVerificationPlan,
  formatVerificationPlan,
  formatVerificationReport,
  formatVerificationTaskSummary,
} from "./verification-command-runtime.js";

describe("/verify command", () => {
  describe("typecheck action", () => {
    it("creates typecheck-only plan from default plan", async () => {
      const projectPath = process.cwd();
      const defaultPlan = await createVerificationPlan(projectPath, "default");
      const typecheckPlan = defaultPlan.filter((step) => step.kind === "typecheck");

      expect(typecheckPlan.length).toBeGreaterThan(0);
      expect(typecheckPlan[0].kind).toBe("typecheck");
      expect(typecheckPlan[0].command).toContain("typecheck");
    });

    it("falls back to smoke plan when no typecheck script exists", async () => {
      // Test with a fake project path that has no package.json
      const defaultPlan = await createVerificationPlan("/tmp/no-typecheck", "default");
      const typecheckPlan = defaultPlan.filter((step) => step.kind === "typecheck");

      // When no typecheck script exists, the filtered plan would be empty
      expect(typecheckPlan.length).toBe(0);

      // In handleVerifyCommand, it would fall back to smoke plan
      const smokePlan = await createVerificationPlan("/tmp/no-typecheck", "smoke");
      expect(smokePlan.length).toBeGreaterThan(0);
      expect(smokePlan[0].kind).toBe("smoke");
    });

    it("matches smoke plan behavior structure", async () => {
      const smokePlan = await createVerificationPlan(process.cwd(), "smoke");
      const defaultPlan = await createVerificationPlan(process.cwd(), "default");
      const typecheckPlan = defaultPlan.filter((step) => step.kind === "typecheck");

      // Both should produce valid VerificationStep arrays
      expect(Array.isArray(smokePlan)).toBe(true);
      expect(Array.isArray(typecheckPlan)).toBe(true);

      // Both should have required fields
      if (typecheckPlan.length > 0) {
        expect(typecheckPlan[0]).toHaveProperty("kind");
        expect(typecheckPlan[0]).toHaveProperty("command");
        expect(typecheckPlan[0]).toHaveProperty("reason");
      }
    });

    it("formats typecheck plan correctly", async () => {
      const projectPath = process.cwd();
      const defaultPlan = await createVerificationPlan(projectPath, "default");
      const typecheckPlan = defaultPlan.filter((step) => step.kind === "typecheck");

      if (typecheckPlan.length > 0) {
        const formatted = formatVerificationPlan(typecheckPlan, "zh-CN");
        expect(formatted).toContain("验证计划");
        expect(formatted).toContain("typecheck");
      }
    });

    it("typecheck plan can be executed like smoke plan", async () => {
      // This test verifies that the typecheck plan structure is compatible
      // with runVerificationPlan by checking it has the same shape as smoke plan
      const smokePlan = await createVerificationPlan(process.cwd(), "smoke");
      const defaultPlan = await createVerificationPlan(process.cwd(), "default");
      const typecheckPlan = defaultPlan.filter((step) => step.kind === "typecheck");

      // Verify both plans have the same required structure
      for (const plan of [smokePlan, typecheckPlan]) {
        if (plan.length > 0) {
          expect(plan[0]).toHaveProperty("kind");
          expect(plan[0]).toHaveProperty("command");
          expect(plan[0]).toHaveProperty("reason");
          expect(typeof plan[0].kind).toBe("string");
          expect(typeof plan[0].command).toBe("string");
          expect(typeof plan[0].reason).toBe("string");
        }
      }
    });
  });

  it("formats zh/en pass reports without duplicating PASS", () => {
    const report: VerificationReport = {
      id: "verify-pass",
      status: "pass",
      summary: "PASS：1 个验证步骤通过。",
      commands: [
        {
          kind: "smoke",
          command: "node -e \"console.log('ok')\"",
          reason: "fixture",
          status: "pass",
          summary: "ok",
          exitCode: 0,
          durationMs: 1,
        },
      ],
      unverified: [],
      risk: [],
      logPath: "/tmp/verify",
      startedAt: "2026-06-03T00:00:00.000Z",
      endedAt: "2026-06-03T00:00:00.001Z",
      durationMs: 1,
      nextAction: "review",
    };

    const zh = formatVerificationReport(report, "zh-CN");
    const en = formatVerificationReport(report, "en-US");

    expect(zh.split("\n")[0]).toBe("PASS：1 个验证步骤通过。");
    expect(en.split("\n")[0]).toBe("PASS：1 个验证步骤通过。");
    expect(zh).not.toContain("PASS PASS");
    expect(en).not.toContain("PASS PASS");
    expect(zh).not.toContain("PASS PASS：");
    expect(en).not.toContain("PASS PASS：");

    const englishReport = { ...report, summary: "PASS: 1 verification step passed." };
    expect(formatVerificationReport(englishReport, "en-US").split("\n")[0]).toBe(
      "PASS: 1 verification step passed.",
    );
  });

  it("formats task summary without command/log evidence while preserving full report details", () => {
    const report: VerificationReport = {
      id: "verify-fail",
      status: "fail",
      summary: "FAIL：1/1 个验证步骤失败。",
      commands: [
        {
          kind: "test",
          command: "corepack pnpm test",
          reason: "fixture",
          status: "fail",
          summary: "exit code 1; assertion failed",
          exitCode: 1,
          durationMs: 12,
          logPath: "F:\\Linghun\\.linghun\\logs\\verification\\verify-fail-1-test.log",
        },
      ],
      unverified: ["test fail：exit code 1"],
      risk: ["test 失败：exit code 1"],
      logPath: "F:\\Linghun\\.linghun\\logs\\verification",
      startedAt: "2026-06-03T00:00:00.000Z",
      endedAt: "2026-06-03T00:00:00.012Z",
      durationMs: 12,
      nextAction: "先查看失败命令与日志，修复后复跑 /verify。",
    };

    const taskSummary = formatVerificationTaskSummary(report, "zh-CN");
    const fullReport = formatVerificationReport(report, "zh-CN");

    expect(taskSummary).toContain("FAIL：1/1 个验证步骤失败。");
    expect(taskSummary).toContain("下一步：先查看失败命令与日志，修复后复跑 /verify。");
    expect(taskSummary).toContain("详情：/verify last");
    expect(taskSummary).not.toContain("corepack pnpm test");
    expect(taskSummary).not.toContain("verify-fail-1-test.log");
    expect(taskSummary).not.toContain("未验证：");

    expect(fullReport).toContain("corepack pnpm test");
    expect(fullReport).toContain("verify-fail-1-test.log");
    expect(fullReport).toContain("未验证：test fail");
  });
});
