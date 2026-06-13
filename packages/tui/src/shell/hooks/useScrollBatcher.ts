import { useCallback, useRef } from "react";

/**
 * Microtask-batched scroll dispatch.
 *
 * Multiple scroll delta events arriving within a single microtask frame
 * (e.g. rapid wheel ticks) are coalesced into a single dispatch call.
 * This avoids redundant Ink re-renders when the terminal fires several
 * scroll events before the next paint.
 */
export function useScrollBatcher(
  dispatch: (delta: number) => void,
): (delta: number) => void {
  const pendingRef = useRef(0);
  const scheduledRef = useRef(false);

  return useCallback(
    (delta: number) => {
      pendingRef.current += delta;
      if (scheduledRef.current) return;
      scheduledRef.current = true;
      queueMicrotask(() => {
        scheduledRef.current = false;
        const batch = pendingRef.current;
        pendingRef.current = 0;
        if (batch !== 0) dispatch(batch);
      });
    },
    [dispatch],
  );
}
