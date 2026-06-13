/**
 * Phase R5 — Wheel acceleration algorithm with encoder bounce detection,
 * wheel mode, trackpad burst detection, and terminal-specific curves.
 *
 * Behavioral reference: CCB scroll runtime (行为级参考，未复制源码).
 *
 * Device heuristics:
 *   - Trackpad bursts: many events with <5ms gaps → no acceleration (step=1)
 *   - Discrete mouse wheel: encoder bounce detection → wheel mode → exponential decay
 *   - Native terminals: linear ramp fallback when wheel mode not engaged
 *   - xterm.js (VS Code/Cursor/Windsurf): exponential decay with gap-dependent cap
 *
 * Encoder bounce detection (physical wheel only):
 *   - Pattern: direction flip → flip-back within 200ms
 *   - Confirmed bounce → engage wheel mode (sticky until idle >1500ms or trackpad burst)
 *   - Wheel mode: exponential decay curve (better for varied scroll speeds)
 *
 * Direction flip debounce:
 *   - First flip: defer processing, wait for next event
 *   - If next event confirms flip-back → bounce (engage wheel mode)
 *   - If next event persists new direction → real reversal (1 row latency acceptable)
 *
 * Terminal-specific curves:
 *   - xterm.js: exponential decay, momentum = 0.5^(gap/halflife), gap-dependent cap
 *   - Native: linear ramp + wheel mode (exponential decay after bounce confirmed)
 */

const WINDOW_MS = 40;
const MAX_HISTORY = 10;
const TRACKPAD_AVG_THRESHOLD_MS = 10;
const MAX_STEP_FALLBACK = 10;

// Trackpad burst detection
const TRACKPAD_BURST_GAP_MS = 5; // consecutive <5ms → trackpad signature
const TRACKPAD_BURST_COUNT_THRESHOLD = 5; // ≥5 consecutive bursts → trackpad

// Encoder bounce detection
const WHEEL_BOUNCE_GAP_MAX_MS = 200; // flip-back must arrive within this
const WHEEL_MODE_IDLE_DISENGAGE_MS = 1500; // idle gap to exit wheel mode

// Wheel mode (exponential decay after bounce confirmed)
const WHEEL_MODE_STEP = 15;
const WHEEL_MODE_CAP = 15;
const WHEEL_MODE_RAMP = 3; // max mult growth per event (smooth ramp)

// xterm.js exponential decay
const WHEEL_DECAY_HALFLIFE_MS = 150;
const WHEEL_DECAY_STEP = 5;
const WHEEL_DECAY_GAP_MS = 80; // cap boundary
const WHEEL_DECAY_CAP_SLOW = 3; // gap ≥ GAP_MS: precision
const WHEEL_DECAY_CAP_FAST = 6; // gap < GAP_MS: throughput
const WHEEL_DECAY_IDLE_MS = 500; // idle threshold
const WHEEL_DECAY_KICK = 2; // first click after idle

// Native linear ramp (fallback when wheel mode not engaged)
const WHEEL_ACCEL_STEP = 0.3;
const WHEEL_ACCEL_MAX = 6;

export type WheelAcceleratorOptions = {
  /** Base rows/event (configurable via LINGHUN_SCROLL_SPEED). Default: 1 */
  base?: number;
  /** Terminal type: xterm.js uses exponential decay, native uses linear+wheel-mode */
  terminalType?: "xterm.js" | "native";
};

export class WheelAccelerator {
  private timestamps: number[] = [];
  private base: number;
  private terminalType: "xterm.js" | "native";

  // Wheel mode state (native only, sticky after bounce confirmed)
  private wheelMode = false;
  private wheelModeMult = 1;
  private lastWheelModeTime = 0;

  // Direction flip debounce (native only)
  private lastDir: 1 | -1 | 0 = 0;
  private pendingFlip: { dir: 1 | -1; time: number } | null = null;

  // Trackpad burst detection
  private burstCount = 0;

  // xterm.js exponential decay state
  private xtermMult = 1;
  private xtermFrac = 0; // carried fractional scroll
  private lastXtermTime = 0;

  constructor(options: WheelAcceleratorOptions = {}) {
    this.base = options.base ?? 1;
    this.terminalType = options.terminalType ?? "native";
  }

  recordEvent(timestamp: number, direction: "up" | "down", viewportHeight?: number): number {
    const dir: 1 | -1 = direction === "up" ? 1 : -1;

    if (this.terminalType === "xterm.js") {
      return this.recordEventXtermJs(timestamp, dir);
    }

    return this.recordEventNative(timestamp, dir, viewportHeight);
  }

  reset(): void {
    this.timestamps = [];
    this.wheelMode = false;
    this.wheelModeMult = 1;
    this.lastWheelModeTime = 0;
    this.lastDir = 0;
    this.pendingFlip = null;
    this.burstCount = 0;
    this.xtermMult = 1;
    this.xtermFrac = 0;
    this.lastXtermTime = 0;
  }

  private recordEventXtermJs(timestamp: number, dir: 1 | -1): number {
    const gap = this.lastXtermTime > 0 ? timestamp - this.lastXtermTime : WHEEL_DECAY_IDLE_MS + 1;
    this.lastXtermTime = timestamp;

    // Idle threshold: reset to kick value for responsive first click
    if (gap > WHEEL_DECAY_IDLE_MS) {
      this.xtermMult = WHEEL_DECAY_KICK;
      this.xtermFrac = 0;
    } else {
      // Exponential decay: momentum = 0.5^(gap/halflife)
      const momentum = Math.pow(0.5, gap / WHEEL_DECAY_HALFLIFE_MS);
      // mult = 1 + step × m / (1 - m), capped
      const target = 1 + (WHEEL_DECAY_STEP * momentum) / (1 - momentum);
      // Gap-dependent cap
      const cap = gap >= WHEEL_DECAY_GAP_MS ? WHEEL_DECAY_CAP_SLOW : WHEEL_DECAY_CAP_FAST;
      this.xtermMult = Math.min(target, cap);
    }

    // Carry fractional scroll (scrollBy floors, so 1.5 → 1,2,1,2 average)
    const exact = this.xtermMult + this.xtermFrac;
    const step = Math.floor(exact);
    this.xtermFrac = exact - step;

    return step;
  }

  private recordEventNative(timestamp: number, dir: 1 | -1, viewportHeight?: number): number {
    this.timestamps.push(timestamp);
    if (this.timestamps.length > MAX_HISTORY) {
      this.timestamps = this.timestamps.slice(-MAX_HISTORY);
    }

    // Device-switch guard: idle disengage wheel mode
    if (this.wheelMode && timestamp - this.lastWheelModeTime > WHEEL_MODE_IDLE_DISENGAGE_MS) {
      this.wheelMode = false;
      this.wheelModeMult = this.base;
      this.burstCount = 0;
    }

    // Resolve deferred direction flip (encoder bounce detection)
    if (this.pendingFlip) {
      const flipGap = timestamp - this.pendingFlip.time;
      if (dir === this.lastDir && flipGap <= WHEEL_BOUNCE_GAP_MAX_MS) {
        // Flip-back confirmed within bounce window → encoder bounce
        // Swallow the deferred flip and the current flip-back, engage wheel mode
        this.wheelMode = true;
        this.wheelModeMult = this.base;
        this.lastWheelModeTime = timestamp;
        this.burstCount = 0;
        this.pendingFlip = null;
        // Continue processing this event as normal wheel mode event
      } else {
        // Real reversal: gap too long OR direction persisted
        // Commit the deferred flip's direction as lastDir
        this.lastDir = this.pendingFlip.dir;
        this.wheelModeMult = this.base;
        this.burstCount = 0;
        this.pendingFlip = null;

        // Now update lastDir to current dir to process this event
        // (whether it continues the reversal or reverses again)
        this.lastDir = dir;
        // Fall through to normal processing below
      }
    }

    // Direction change detection (only for NEW flips, not resolved pendingFlip)
    if (this.lastDir !== 0 && dir !== this.lastDir && !this.pendingFlip) {
      // Defer first flip for bounce detection
      this.pendingFlip = { dir, time: timestamp };
      return 0; // no-op on deferred flip (caller handles scrollBy(0) = no-op)
    }

    this.lastDir = dir;

    // Trackpad burst detection
    const windowStart = timestamp - WINDOW_MS;
    const recent = this.timestamps.filter((t) => t >= windowStart);
    if (recent.length >= 2) {
      const lastGap = recent[recent.length - 1]! - recent[recent.length - 2]!;
      if (lastGap < TRACKPAD_BURST_GAP_MS) {
        this.burstCount++;
      } else {
        this.burstCount = 0;
      }

      // Trackpad signature: ≥5 consecutive <5ms events
      if (this.burstCount >= TRACKPAD_BURST_COUNT_THRESHOLD) {
        // Disengage wheel mode (device switch to trackpad)
        this.wheelMode = false;
        this.wheelModeMult = this.base;
        // Trackpad: no acceleration, always base
        return this.base;
      }
    }

    // Legacy trackpad detection (avg interval <10ms over window)
    if (recent.length >= 2) {
      const intervals: number[] = [];
      for (let i = 1; i < recent.length; i++) {
        intervals.push(recent[i]! - recent[i - 1]!);
      }
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      if (avgInterval < TRACKPAD_AVG_THRESHOLD_MS) {
        return this.base;
      }
    }

    // Wheel mode (exponential decay after bounce confirmed)
    if (this.wheelMode) {
      const gap = timestamp - this.lastWheelModeTime;
      this.lastWheelModeTime = timestamp;

      // Exponential decay: momentum = 0.5^(gap/halflife)
      const momentum = Math.pow(0.5, gap / WHEEL_DECAY_HALFLIFE_MS);
      const target = this.base + (WHEEL_MODE_STEP * momentum) / (1 - momentum);
      const cappedTarget = Math.min(target, WHEEL_MODE_CAP);

      // Smooth ramp: limit growth per event
      if (cappedTarget > this.wheelModeMult) {
        this.wheelModeMult = Math.min(this.wheelModeMult + WHEEL_MODE_RAMP, cappedTarget);
      } else {
        this.wheelModeMult = cappedTarget;
      }

      return Math.round(this.wheelModeMult);
    }

    // Native linear ramp fallback (wheel mode not yet engaged)
    const maxStep = viewportHeight ? Math.max(1, Math.floor(viewportHeight / 2)) : MAX_STEP_FALLBACK;
    const rampMult = this.base + Math.min(recent.length, maxStep / this.base) * WHEEL_ACCEL_STEP;
    return Math.min(Math.round(rampMult), WHEEL_ACCEL_MAX);
  }
}
