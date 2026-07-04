import { useCallback, useEffect, useRef } from "react";

/**
 * Phase R5 — Scroll runtime with pending delta accumulator.
 *
 * High-frequency wheel events accumulate in a pending delta ref without triggering
 * one state update per terminal chunk. A microtask flush coalesces bursts that
 * arrive in the same JS turn while keeping single wheel notches responsive.
 *
 * @param dispatch - Callback to dispatch final scroll delta (e.g., onInput with transcript-scroll event)
 * @returns accumulate function to feed wheel deltas
 */

export function useScrollRuntime(
  dispatch: (delta: number) => void,
): (delta: number) => void {
  const pendingDeltaRef = useRef(0);
  const scheduledRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      pendingDeltaRef.current = 0;
      scheduledRef.current = false;
    };
  }, []);

  return useCallback(
    (delta: number) => {
      pendingDeltaRef.current += delta;
      if (scheduledRef.current) return;
      scheduledRef.current = true;
      queueMicrotask(() => {
        if (!mountedRef.current) return;
        scheduledRef.current = false;
        const pending = pendingDeltaRef.current;
        pendingDeltaRef.current = 0;
        if (pending !== 0) dispatch(pending);
      });
    },
    [dispatch],
  );
}
