/**
 * D.14E-R5 — Wheel acceleration algorithm.
 *
 * Pure stateful class that tracks recent wheel event timestamps and returns
 * an accelerated step size for transcript scrolling.
 *
 * Device heuristic:
 *   - Trackpad bursts: many events with avg interval <10ms → no acceleration (always step=1)
 *   - Discrete mouse wheel: fewer events with larger intervals → linear ramp
 *
 * Linear ramp (mouse wheel):
 *   step = min(eventsInWindow, maxStep)
 *   maxStep = floor(viewportHeight / 2) or 10 if no viewport measurement
 */

const WINDOW_MS = 40;
const MAX_HISTORY = 10;
const TRACKPAD_AVG_THRESHOLD_MS = 10;
const MAX_STEP_FALLBACK = 10;

export class WheelAccelerator {
  private timestamps: number[] = [];

  recordEvent(timestamp: number, viewportHeight?: number): number {
    this.timestamps.push(timestamp);
    if (this.timestamps.length > MAX_HISTORY) {
      this.timestamps = this.timestamps.slice(-MAX_HISTORY);
    }

    const windowStart = timestamp - WINDOW_MS;
    const recent = this.timestamps.filter((t) => t >= windowStart);

    if (recent.length < 2) return 1;

    // Device detection: average interval between events in window
    const intervals: number[] = [];
    for (let i = 1; i < recent.length; i++) {
      intervals.push(recent[i]! - recent[i - 1]!);
    }
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;

    // Trackpad: no acceleration, always 1 line
    if (avgInterval < TRACKPAD_AVG_THRESHOLD_MS) return 1;

    // Mouse wheel: linear ramp based on event count in window
    const maxStep = viewportHeight
      ? Math.max(1, Math.floor(viewportHeight / 2))
      : MAX_STEP_FALLBACK;
    return Math.min(recent.length, maxStep);
  }

  reset(): void {
    this.timestamps = [];
  }
}
