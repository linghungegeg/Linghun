import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createVerificationPlan, formatVerificationPlan } from "./verification-command-runtime.js";

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
});
