import { describe, expect, it } from "vitest";
import {
  classifyProviderVerificationLevel,
  classifyRunnerVerificationLevel,
  classifyVerificationLevel,
  compareVerificationLevels,
  detectVerificationInflation,
  formatVerificationLevel,
  isNonUpgradeableStatus,
} from "./verification-level.js";

describe("verification-level", () => {
  describe("classifyVerificationLevel", () => {
    it("classifies real smoke when real process observed without fallback", () => {
      const result = classifyVerificationLevel({
        realProcessObserved: true,
        fallbackUsed: false,
        mockUsed: false,
        simulatedOrPartial: false,
      });
      expect(result.level).toBe("real-smoke");
      expect(result.isRealSmoke).toBe(true);
      expect(result.canClaimMature).toBe(true);
      expect(result.canClaimPass).toBe(true);
      expect(result.upgradeBlocked).toBe(false);
    });

    it("classifies real smoke when real provider hit without fallback", () => {
      const result = classifyVerificationLevel({
        realProviderHit: true,
        fallbackUsed: false,
        mockUsed: false,
      });
      expect(result.level).toBe("real-smoke");
      expect(result.canClaimMature).toBe(true);
    });

    it("classifies build level when build passed without mocks", () => {
      const result = classifyVerificationLevel({
        buildPassed: true,
        mockUsed: false,
        fallbackUsed: false,
      });
      expect(result.level).toBe("build");
      expect(result.canClaimPass).toBe(true);
      expect(result.canClaimMature).toBe(false);
    });

    it("classifies local level when local test runner used without mocks", () => {
      const result = classifyVerificationLevel({
        localTestRunner: true,
        mockUsed: false,
      });
      expect(result.level).toBe("local");
      expect(result.canClaimPass).toBe(false);
      expect(result.canClaimMature).toBe(false);
    });

    it("classifies source level when only source analysis", () => {
      const result = classifyVerificationLevel({
        sourceOnlyAnalysis: true,
      });
      expect(result.level).toBe("source");
      expect(result.canClaimPass).toBe(false);
      expect(result.canClaimMature).toBe(false);
    });

    it("classifies source level when local test runner uses mocks", () => {
      const result = classifyVerificationLevel({
        localTestRunner: true,
        mockUsed: true,
      });
      expect(result.level).toBe("source");
      expect(result.upgradeBlocked).toBe(true);
      expect(result.blockReason).toBe("mock-used");
    });

    it("classifies mock level when fallback used", () => {
      const result = classifyVerificationLevel({
        fallbackUsed: true,
      });
      expect(result.level).toBe("mock");
      expect(result.upgradeBlocked).toBe(true);
      expect(result.blockReason).toBe("fallback-path-used");
    });

    it("classifies mock level when simulated or partial", () => {
      const result = classifyVerificationLevel({
        simulatedOrPartial: true,
      });
      expect(result.level).toBe("mock");
      expect(result.upgradeBlocked).toBe(true);
      expect(result.blockReason).toBe("simulated-or-partial");
    });

    it("blocks upgrade even if real process observed but fallback used", () => {
      const result = classifyVerificationLevel({
        realProcessObserved: true,
        fallbackUsed: true,
      });
      // Fallback blocks real-smoke classification
      expect(result.level).toBe("mock");
      expect(result.upgradeBlocked).toBe(true);
      expect(result.canClaimMature).toBe(false);
    });

    it("provides requiredForMature guidance", () => {
      const result = classifyVerificationLevel({
        localTestRunner: true,
        mockUsed: false,
      });
      expect(result.requiredForMature).toContain("real-smoke");
    });
  });

  describe("isNonUpgradeableStatus", () => {
    it("detects partial status", () => {
      expect(isNonUpgradeableStatus("partial")).toBe(true);
      expect(isNonUpgradeableStatus("completed(partial)")).toBe(true);
    });

    it("detects simulated status", () => {
      expect(isNonUpgradeableStatus("simulated")).toBe(true);
    });

    it("detects fallback status", () => {
      expect(isNonUpgradeableStatus("node_fallback")).toBe(true);
      expect(isNonUpgradeableStatus("fallback")).toBe(true);
    });

    it("detects mocked status", () => {
      expect(isNonUpgradeableStatus("mocked")).toBe(true);
    });

    it("detects source-only status", () => {
      expect(isNonUpgradeableStatus("source-only")).toBe(true);
    });

    it("detects skipped and stale", () => {
      expect(isNonUpgradeableStatus("skipped")).toBe(true);
      expect(isNonUpgradeableStatus("stale")).toBe(true);
    });

    it("does not flag normal pass", () => {
      expect(isNonUpgradeableStatus("pass")).toBe(false);
      expect(isNonUpgradeableStatus("completed")).toBe(false);
    });
  });

  describe("detectVerificationInflation", () => {
    it("detects mature claim with mock level", () => {
      const warning = detectVerificationInflation("mature", "mock");
      expect(warning).toContain("Verification inflation");
      expect(warning).toContain("mock");
    });

    it("detects ready claim with source level", () => {
      const warning = detectVerificationInflation("ready", "source");
      expect(warning).toContain("Verification inflation");
    });

    it("detects PASS claim with source level", () => {
      const warning = detectVerificationInflation("PASS", "source");
      expect(warning).toContain("Verification inflation");
    });

    it("allows PASS claim with build level", () => {
      const warning = detectVerificationInflation("PASS", "build");
      expect(warning).toBeUndefined();
    });

    it("allows mature claim with real-smoke level", () => {
      const warning = detectVerificationInflation("mature", "real-smoke");
      expect(warning).toBeUndefined();
    });

    it("does not flag non-mature/non-pass claims", () => {
      const warning = detectVerificationInflation("in-progress", "mock");
      expect(warning).toBeUndefined();
    });
  });

  describe("classifyRunnerVerificationLevel", () => {
    it("classifies node adapter as fallback", () => {
      const result = classifyRunnerVerificationLevel("node", "node_fallback");
      expect(result.level).toBe("mock");
      expect(result.upgradeBlocked).toBe(true);
      expect(result.canClaimMature).toBe(false);
    });

    it("classifies native adapter with completed status as real-smoke", () => {
      const result = classifyRunnerVerificationLevel("native", "completed");
      expect(result.level).toBe("real-smoke");
      expect(result.canClaimMature).toBe(true);
    });

    it("classifies native adapter with running status as local", () => {
      const result = classifyRunnerVerificationLevel("native", "running");
      expect(result.level).toBe("local");
    });

    it("classifies native adapter with fallback reason as blocked", () => {
      const result = classifyRunnerVerificationLevel("native", "available", "start_failed");
      expect(result.upgradeBlocked).toBe(true);
      expect(result.canClaimMature).toBe(false);
    });
  });

  describe("classifyProviderVerificationLevel", () => {
    it("classifies real endpoint hit as real-smoke", () => {
      const result = classifyProviderVerificationLevel({
        realEndpointHit: true,
        fallbackUsed: false,
        mockUsed: false,
        cooldownActive: false,
      });
      expect(result.level).toBe("real-smoke");
      expect(result.canClaimMature).toBe(true);
    });

    it("classifies mock provider as blocked", () => {
      const result = classifyProviderVerificationLevel({
        realEndpointHit: false,
        fallbackUsed: false,
        mockUsed: true,
        cooldownActive: false,
      });
      expect(result.upgradeBlocked).toBe(true);
      expect(result.canClaimMature).toBe(false);
    });

    it("classifies cooldown as blocked", () => {
      const result = classifyProviderVerificationLevel({
        realEndpointHit: true,
        fallbackUsed: false,
        mockUsed: false,
        cooldownActive: true,
      });
      expect(result.upgradeBlocked).toBe(true);
      expect(result.canClaimMature).toBe(false);
    });

    it("classifies fallback provider as blocked", () => {
      const result = classifyProviderVerificationLevel({
        realEndpointHit: true,
        fallbackUsed: true,
        mockUsed: false,
        cooldownActive: false,
      });
      expect(result.upgradeBlocked).toBe(true);
    });
  });

  describe("formatVerificationLevel", () => {
    it("formats a clean real-smoke level", () => {
      const classification = classifyVerificationLevel({
        realProcessObserved: true,
        fallbackUsed: false,
        mockUsed: false,
      });
      const formatted = formatVerificationLevel(classification);
      expect(formatted).toContain("level=real-smoke");
      expect(formatted).not.toContain("blocked");
    });

    it("formats a blocked mock level", () => {
      const classification = classifyVerificationLevel({
        mockUsed: true,
      });
      const formatted = formatVerificationLevel(classification);
      expect(formatted).toContain("level=mock");
      expect(formatted).toContain("blocked=mock-used");
      expect(formatted).toContain("pass=not-claimable");
    });
  });

  describe("compareVerificationLevels", () => {
    it("orders levels correctly", () => {
      expect(compareVerificationLevels("mock", "source")).toBeLessThan(0);
      expect(compareVerificationLevels("source", "local")).toBeLessThan(0);
      expect(compareVerificationLevels("local", "build")).toBeLessThan(0);
      expect(compareVerificationLevels("build", "real-smoke")).toBeLessThan(0);
      expect(compareVerificationLevels("real-smoke", "mock")).toBeGreaterThan(0);
      expect(compareVerificationLevels("build", "build")).toBe(0);
    });
  });
});
