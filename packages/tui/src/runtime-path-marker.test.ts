import { describe, expect, it } from "vitest";
import {
  canClaimCurrentVerification,
  canClaimTuiMaturity,
  classifyRuntimePath,
  classifyStartupPath,
  detectRuntimePathInflation,
  formatRuntimePathMarker,
  formatStartupPathMarker,
} from "./runtime-path-marker.js";

describe("runtime-path-marker", () => {
  describe("classifyRuntimePath", () => {
    it("classifies ink as main path when ink available and TTY", () => {
      const result = classifyRuntimePath({
        isTTY: true,
        inkAvailable: true,
      });
      expect(result.path).toBe("ink");
      expect(result.kind).toBe("main");
      expect(result.isMainPath).toBe(true);
      expect(result.isFallback).toBe(false);
      expect(result.canClaimMature).toBe(true);
      expect(result.detectionMethod).toBe("ink-available");
    });

    it("classifies non-tty as fallback", () => {
      const result = classifyRuntimePath({
        isTTY: false,
        inkAvailable: true,
      });
      expect(result.path).toBe("non-tty");
      expect(result.kind).toBe("fallback");
      expect(result.isFallback).toBe(true);
      expect(result.canClaimMature).toBe(false);
      expect(result.degradedReason).toBe("non-tty-output");
    });

    it("classifies CI environment as non-tty fallback", () => {
      const result = classifyRuntimePath({
        isTTY: true,
        inkAvailable: true,
        isCI: true,
      });
      expect(result.path).toBe("non-tty");
      expect(result.kind).toBe("fallback");
      expect(result.degradedReason).toBe("ci-environment");
    });

    it("classifies forced-legacy by config", () => {
      const result = classifyRuntimePath({
        isTTY: true,
        inkAvailable: true,
        forcedLegacy: true,
      });
      expect(result.path).toBe("forced-legacy");
      expect(result.kind).toBe("fallback");
      expect(result.canClaimMature).toBe(false);
      expect(result.detectionMethod).toBe("forced-by-config");
    });

    it("classifies plain when TTY but no ink", () => {
      const result = classifyRuntimePath({
        isTTY: true,
        inkAvailable: false,
      });
      expect(result.path).toBe("plain");
      expect(result.kind).toBe("fallback");
      expect(result.canClaimMature).toBe(false);
      expect(result.degradedReason).toBe("ink-unavailable");
    });

    it("env override takes priority over everything", () => {
      const result = classifyRuntimePath({
        isTTY: true,
        inkAvailable: true,
        envOverride: "plain",
      });
      expect(result.path).toBe("plain");
      expect(result.kind).toBe("fallback");
      expect(result.detectionMethod).toBe("env-override");
    });

    it("env override ink is main path", () => {
      const result = classifyRuntimePath({
        isTTY: false,
        inkAvailable: false,
        envOverride: "ink",
      });
      expect(result.path).toBe("ink");
      expect(result.kind).toBe("main");
      expect(result.canClaimMature).toBe(true);
    });

    it("defaults to plain fallback when no signals", () => {
      const result = classifyRuntimePath({});
      expect(result.path).toBe("plain");
      expect(result.kind).toBe("fallback");
      expect(result.detectionMethod).toBe("default");
    });
  });

  describe("classifyStartupPath", () => {
    it("classifies source execution as verified current", () => {
      const result = classifyStartupPath({
        isSourceExecution: true,
      });
      expect(result.entryKind).toBe("source");
      expect(result.isVerifiedCurrent).toBe(true);
      expect(result.staleRisk).toBe(false);
    });

    it("classifies dist execution as stale risk", () => {
      const result = classifyStartupPath({
        isDistExecution: true,
      });
      expect(result.entryKind).toBe("dist");
      expect(result.isVerifiedCurrent).toBe(false);
      expect(result.staleRisk).toBe(true);
      expect(result.staleReason).toBe("dist-may-be-outdated");
    });

    it("classifies global bin as stale risk", () => {
      const result = classifyStartupPath({
        isGlobalBin: true,
      });
      expect(result.entryKind).toBe("global-bin");
      expect(result.staleRisk).toBe(true);
      expect(result.staleReason).toBe("global-bin-may-be-outdated");
    });

    it("classifies desktop cmd as stale risk", () => {
      const result = classifyStartupPath({
        isDesktopCmd: true,
      });
      expect(result.entryKind).toBe("desktop-cmd");
      expect(result.staleRisk).toBe(true);
    });

    it("classifies unknown entry as stale risk", () => {
      const result = classifyStartupPath({});
      expect(result.entryKind).toBe("unknown");
      expect(result.staleRisk).toBe(true);
    });
  });

  describe("canClaimTuiMaturity", () => {
    it("allows maturity claim for ink main path", () => {
      const marker = classifyRuntimePath({ isTTY: true, inkAvailable: true });
      expect(canClaimTuiMaturity(marker)).toBe(true);
    });

    it("denies maturity claim for plain fallback", () => {
      const marker = classifyRuntimePath({ isTTY: true, inkAvailable: false });
      expect(canClaimTuiMaturity(marker)).toBe(false);
    });

    it("denies maturity claim for non-tty", () => {
      const marker = classifyRuntimePath({ isTTY: false });
      expect(canClaimTuiMaturity(marker)).toBe(false);
    });
  });

  describe("canClaimCurrentVerification", () => {
    it("allows for source execution", () => {
      const marker = classifyStartupPath({ isSourceExecution: true });
      expect(canClaimCurrentVerification(marker)).toBe(true);
    });

    it("denies for dist execution", () => {
      const marker = classifyStartupPath({ isDistExecution: true });
      expect(canClaimCurrentVerification(marker)).toBe(false);
    });
  });

  describe("detectRuntimePathInflation", () => {
    it("detects mature claim on fallback path", () => {
      const marker = classifyRuntimePath({ isTTY: true, inkAvailable: false });
      const warning = detectRuntimePathInflation("mature", marker);
      expect(warning).toContain("Runtime path inflation");
      expect(warning).toContain("plain");
    });

    it("detects ink-verified claim on non-tty", () => {
      const marker = classifyRuntimePath({ isTTY: false });
      const warning = detectRuntimePathInflation("ink-verified", marker);
      expect(warning).toContain("Runtime path inflation");
    });

    it("allows mature claim on ink main path", () => {
      const marker = classifyRuntimePath({ isTTY: true, inkAvailable: true });
      const warning = detectRuntimePathInflation("mature", marker);
      expect(warning).toBeUndefined();
    });

    it("does not flag non-mature claims", () => {
      const marker = classifyRuntimePath({ isTTY: false });
      const warning = detectRuntimePathInflation("in-progress", marker);
      expect(warning).toBeUndefined();
    });
  });

  describe("formatRuntimePathMarker", () => {
    it("formats main path marker", () => {
      const marker = classifyRuntimePath({ isTTY: true, inkAvailable: true });
      const formatted = formatRuntimePathMarker(marker);
      expect(formatted).toContain("path=ink");
      expect(formatted).toContain("kind=main");
      expect(formatted).not.toContain("degraded");
    });

    it("formats fallback marker with degraded reason", () => {
      const marker = classifyRuntimePath({ isTTY: false });
      const formatted = formatRuntimePathMarker(marker);
      expect(formatted).toContain("path=non-tty");
      expect(formatted).toContain("kind=fallback");
      expect(formatted).toContain("degraded=");
      expect(formatted).toContain("mature=not-claimable");
    });
  });

  describe("formatStartupPathMarker", () => {
    it("formats source entry", () => {
      const marker = classifyStartupPath({ isSourceExecution: true });
      const formatted = formatStartupPathMarker(marker);
      expect(formatted).toContain("entry=source");
      expect(formatted).toContain("verified=true");
    });

    it("formats stale dist entry", () => {
      const marker = classifyStartupPath({ isDistExecution: true });
      const formatted = formatStartupPathMarker(marker);
      expect(formatted).toContain("entry=dist");
      expect(formatted).toContain("verified=false");
      expect(formatted).toContain("stale-risk=");
    });
  });
});
