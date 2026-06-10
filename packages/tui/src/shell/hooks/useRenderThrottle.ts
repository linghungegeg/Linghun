import { useCallback, useRef } from "react";

/**
 * Phase 6 — Render throttle for high-frequency rerender scenarios.
 *
 * Prevents render explosion during scroll/mouse bursts by throttling rerender calls.
 * Uses a trailing-edge throttle: schedules one final render after the burst settles.
 *
 * Behavioral goal (from RENDERER_RUNTIME_MIGRATION_PLAN Phase 6):
 * - No obvious full-screen flicker during sustained scrolling
 * - Avoid full transcript redraw per wheel tick where possible
 *
 * Implementation:
 * - Leading edge: first call in a burst renders immediately
 * - Throttle window: subsequent calls within THROTTLE_WINDOW_MS are queued
 * - Trailing edge: one final render after burst settles
 *
 * @param baseRerender - The actual rerender function to throttle
 * @returns Throttled rerender function
 */

const THROTTLE_WINDOW_MS = 16; // ~60fps

export function useRenderThrottle(baseRerender: () => void): () => void {
  const lastRenderTimeRef = useRef(0);
  const pendingRenderRef = useRef(false);
  const timerIdRef = useRef<NodeJS.Timeout | null>(null);

  return useCallback(() => {
    const now = Date.now();
    const elapsed = now - lastRenderTimeRef.current;

    // Leading edge: render immediately if enough time has passed
    if (elapsed >= THROTTLE_WINDOW_MS) {
      lastRenderTimeRef.current = now;
      pendingRenderRef.current = false;
      if (timerIdRef.current !== null) {
        clearTimeout(timerIdRef.current);
        timerIdRef.current = null;
      }
      baseRerender();
      return;
    }

    // Within throttle window: queue trailing render if not already queued
    if (!pendingRenderRef.current) {
      pendingRenderRef.current = true;
      const remaining = THROTTLE_WINDOW_MS - elapsed;
      timerIdRef.current = setTimeout(() => {
        lastRenderTimeRef.current = Date.now();
        pendingRenderRef.current = false;
        timerIdRef.current = null;
        baseRerender();
      }, remaining);
    }
  }, [baseRerender]);
}
