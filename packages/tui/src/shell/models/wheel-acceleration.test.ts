import { describe, it, expect } from "vitest";
import { WheelAccelerator } from "./wheel-acceleration.js";

describe("WheelAccelerator", () => {
  describe("Native terminal - linear ramp fallback", () => {
    it("returns base step for single event", () => {
      const acc = new WheelAccelerator({ base: 1, terminalType: "native" });
      expect(acc.recordEvent(1000, "up", 50)).toBe(1);
    });

    it("returns base step for trackpad burst (avg interval <10ms)", () => {
      const acc = new WheelAccelerator({ base: 1, terminalType: "native" });
      expect(acc.recordEvent(1000, "up", 50)).toBe(1);
      expect(acc.recordEvent(1005, "up", 50)).toBe(1);
      expect(acc.recordEvent(1010, "up", 50)).toBe(1);
      expect(acc.recordEvent(1015, "up", 50)).toBe(1);
    });

    it("ramps up for discrete mouse wheel events", () => {
      const acc = new WheelAccelerator({ base: 1, terminalType: "native" });
      expect(acc.recordEvent(1000, "up", 50)).toBe(1);
      expect(acc.recordEvent(1030, "up", 50)).toBeGreaterThan(1);
      expect(acc.recordEvent(1060, "up", 50)).toBeGreaterThan(1);
    });

    it("respects custom base", () => {
      const acc = new WheelAccelerator({ base: 3, terminalType: "native" });
      expect(acc.recordEvent(1000, "up", 50)).toBe(3);
    });
  });

  describe("Native terminal - encoder bounce detection", () => {
    it("defers first direction flip", () => {
      const acc = new WheelAccelerator({ base: 1, terminalType: "native" });
      expect(acc.recordEvent(1000, "up", 50)).toBe(1);
      expect(acc.recordEvent(1030, "up", 50)).toBeGreaterThan(0);
      // Direction flip: deferred
      expect(acc.recordEvent(1060, "down", 50)).toBe(0);
    });

    it("confirms bounce and engages wheel mode on flip-back", () => {
      const acc = new WheelAccelerator({ base: 1, terminalType: "native" });
      expect(acc.recordEvent(1000, "up", 50)).toBe(1);
      expect(acc.recordEvent(1030, "up", 50)).toBeGreaterThan(0);
      // Direction flip: deferred
      expect(acc.recordEvent(1060, "down", 50)).toBe(0);
      // Flip-back within 200ms: confirms bounce, engages wheel mode
      const step = acc.recordEvent(1090, "up", 50);
      expect(step).toBeGreaterThan(0);
    });

    it("confirms real reversal if flip-back too late", () => {
      const acc = new WheelAccelerator({ base: 1, terminalType: "native" });
      expect(acc.recordEvent(1000, "up", 50)).toBe(1);
      expect(acc.recordEvent(1030, "up", 50)).toBeGreaterThan(0);
      // Direction flip: deferred
      expect(acc.recordEvent(1060, "down", 50)).toBe(0);
      // Flip-back >200ms later: real reversal, not bounce
      const step = acc.recordEvent(1300, "up", 50);
      expect(step).toBeGreaterThan(0);
    });

    it("confirms real reversal if direction persists", () => {
      const acc = new WheelAccelerator({ base: 1, terminalType: "native" });
      expect(acc.recordEvent(1000, "up", 50)).toBe(1);
      expect(acc.recordEvent(1030, "up", 50)).toBeGreaterThan(0);
      // Direction flip: deferred
      expect(acc.recordEvent(1060, "down", 50)).toBe(0);
      // Next event same direction: real reversal
      const step = acc.recordEvent(1090, "down", 50);
      expect(step).toBeGreaterThan(0);
    });
  });

  describe("Native terminal - wheel mode (exponential decay after bounce)", () => {
    it("uses exponential decay in wheel mode", () => {
      const acc = new WheelAccelerator({ base: 1, terminalType: "native" });
      // Trigger bounce detection
      expect(acc.recordEvent(1000, "up", 50)).toBe(1);
      expect(acc.recordEvent(1030, "down", 50)).toBe(0); // deferred flip
      expect(acc.recordEvent(1060, "up", 50)).toBeGreaterThan(0); // bounce confirmed, wheel mode engaged

      // Subsequent events use exponential decay
      const step1 = acc.recordEvent(1090, "up", 50);
      const step2 = acc.recordEvent(1120, "up", 50);
      expect(step1).toBeGreaterThan(1);
      expect(step2).toBeGreaterThan(step1);
    });

    it("disengages wheel mode after idle gap >1500ms", () => {
      const acc = new WheelAccelerator({ base: 1, terminalType: "native" });
      // Engage wheel mode
      expect(acc.recordEvent(1000, "up", 50)).toBe(1);
      expect(acc.recordEvent(1030, "down", 50)).toBe(0);
      expect(acc.recordEvent(1060, "up", 50)).toBeGreaterThan(0);

      // Idle gap >1500ms: wheel mode disengaged
      const step = acc.recordEvent(3000, "up", 50);
      expect(step).toBe(1); // back to base
    });

    it("disengages wheel mode on trackpad burst signature", () => {
      const acc = new WheelAccelerator({ base: 1, terminalType: "native" });
      // Engage wheel mode
      expect(acc.recordEvent(1000, "up", 50)).toBe(1);
      expect(acc.recordEvent(1030, "down", 50)).toBe(0);
      expect(acc.recordEvent(1060, "up", 50)).toBeGreaterThan(0);

      // Trackpad burst: ≥5 consecutive <5ms events
      expect(acc.recordEvent(1100, "up", 50)).toBeGreaterThan(0);
      expect(acc.recordEvent(1103, "up", 50)).toBeGreaterThan(0);
      expect(acc.recordEvent(1106, "up", 50)).toBeGreaterThan(0);
      expect(acc.recordEvent(1109, "up", 50)).toBeGreaterThan(0);
      expect(acc.recordEvent(1112, "up", 50)).toBeGreaterThan(0);
      const step = acc.recordEvent(1115, "up", 50);
      expect(step).toBe(1); // wheel mode disengaged, back to base
    });
  });

  describe("xterm.js terminal - exponential decay", () => {
    it("starts with kick value after idle", () => {
      const acc = new WheelAccelerator({ base: 1, terminalType: "xterm.js" });
      const step = acc.recordEvent(1000, "up");
      expect(step).toBe(2); // WHEEL_DECAY_KICK
    });

    it("uses exponential decay for fast events", () => {
      const acc = new WheelAccelerator({ base: 1, terminalType: "xterm.js" });
      const step1 = acc.recordEvent(1000, "up");
      const step2 = acc.recordEvent(1030, "up"); // gap <80ms: fast
      const step3 = acc.recordEvent(1060, "up");
      expect(step1).toBe(2);
      expect(step2).toBeGreaterThan(step1);
      expect(step3).toBeGreaterThanOrEqual(step2);
    });

    it("uses slow cap for slow events (gap ≥80ms)", () => {
      const acc = new WheelAccelerator({ base: 1, terminalType: "xterm.js" });
      acc.recordEvent(1000, "up");
      const step = acc.recordEvent(1100, "up"); // gap ≥80ms: slow
      expect(step).toBeLessThanOrEqual(3); // WHEEL_DECAY_CAP_SLOW
    });

    it("uses fast cap for fast events (gap <80ms)", () => {
      const acc = new WheelAccelerator({ base: 1, terminalType: "xterm.js" });
      acc.recordEvent(1000, "up");
      acc.recordEvent(1030, "up");
      acc.recordEvent(1060, "up");
      const step = acc.recordEvent(1090, "up"); // sustained fast
      expect(step).toBeLessThanOrEqual(6); // WHEEL_DECAY_CAP_FAST
    });

    it("carries fractional scroll", () => {
      const acc = new WheelAccelerator({ base: 1, terminalType: "xterm.js" });
      const results: number[] = [];
      for (let i = 0; i < 10; i++) {
        results.push(acc.recordEvent(1000 + i * 100, "up"));
      }
      // With fractional carry, mult=1.5 → [1,2,1,2,...] pattern
      // Without fractional carry, mult=1.5 → [1,1,1,...] (floor loss)
      const sum = results.reduce((a, b) => a + b, 0);
      expect(sum).toBeGreaterThan(10); // proves fractional carry works
    });

    it("resets to kick value after idle >500ms", () => {
      const acc = new WheelAccelerator({ base: 1, terminalType: "xterm.js" });
      acc.recordEvent(1000, "up");
      acc.recordEvent(1030, "up");
      // Idle >500ms
      const step = acc.recordEvent(2000, "up");
      expect(step).toBe(2); // back to kick
    });
  });

  describe("reset()", () => {
    it("clears all state", () => {
      const acc = new WheelAccelerator({ base: 1, terminalType: "native" });
      acc.recordEvent(1000, "up", 50);
      acc.recordEvent(1030, "up", 50);
      acc.reset();
      expect(acc.recordEvent(2000, "up", 50)).toBe(1); // back to base
    });
  });
});
