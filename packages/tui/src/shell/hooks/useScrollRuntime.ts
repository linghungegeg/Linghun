import { useCallback, useEffect, useRef } from "react";

/**
 * Phase R5 — Scroll runtime with pending delta accumulator and frame drain.
 *
 * High-frequency wheel events accumulate in a pending delta ref without triggering
 * state updates. A setImmediate loop drains the pending delta gradually,
 * dispatching throttled scroll actions to avoid React re-render explosion.
 *
 * Quantization: scroll delta is quantized to SCROLL_QUANTUM bins before dispatch.
 * Small accumulated deltas (<SCROLL_QUANTUM) don't trigger dispatch until they
 * cross the bin boundary, reducing state updates by ~10x on typical wheel bursts.
 *
 * Behavioral reference: CCB useVirtualScroll + render-node-to-output drain
 * (行为级参考，未复制源码).
 *
 * @param dispatch - Callback to dispatch final scroll delta (e.g., onInput with transcript-scroll event)
 * @returns accumulate function to feed wheel deltas
 */

/**
 * Scroll delta quantization bin size (rows).
 *
 * CCB uses OVERSCAN_ROWS >> 1 = 20 rows for virtual scroll range recalculation.
 * We use a smaller value (10 rows) since Linghun doesn't have virtual scroll yet
 * and needs finer-grained updates for the simpler offset-based scroll model.
 *
 * Rationale:
 * - Too large (20+): laggy feel, viewport jumps when bin crosses
 * - Too small (1-5): defeats the purpose, still triggers many state updates
 * - 10 rows: balances responsiveness and update reduction (~5x fewer updates)
 */
const SCROLL_QUANTUM = 10;

/**
 * Frame drain rate (rows/frame).
 *
 * CCB's adaptive drain moves ~200 rows/sec measured at ~60fps (~3.3 rows/frame).
 * We use 5 rows/drain iteration for slightly snappier drain on fast wheel bursts.
 *
 * This ensures pending delta drains within ~200ms even for large bursts (100+ rows
 * from trackpad flick or mouse free-spin), preventing viewport lag.
 */
const DRAIN_PER_FRAME = 5;

/**
 * Idle threshold to stop drain loop (ms).
 *
 * If no new wheel events arrive for this duration and pendingDelta reaches 0,
 * the drain loop stops to save CPU. Next wheel event re-starts the loop.
 */
const DRAIN_IDLE_THRESHOLD_MS = 100;

/**
 * Drain interval (ms).
 *
 * setImmediate drains as fast as event loop allows. For throttling, we use a short
 * timeout to approximate 60fps (~16ms). This is less precise than requestAnimationFrame
 * but sufficient for scroll delta accumulation in a terminal UI.
 */
const DRAIN_INTERVAL_MS = 16;

export function useScrollRuntime(
  dispatch: (delta: number) => void,
): (delta: number) => void {
  const pendingDeltaRef = useRef(0);
  const lastDispatchedBinRef = useRef(0);
  const drainLoopActiveRef = useRef(false);
  const lastWheelTimeRef = useRef(0);
  const timerIdRef = useRef<NodeJS.Timeout | null>(null);

  // Drain loop: runs at ~60fps via setTimeout
  const drainLoop = useCallback(() => {
    const now = Date.now();
    const pending = pendingDeltaRef.current;

    // Stop condition: no pending delta AND idle timeout passed
    if (pending === 0 && now - lastWheelTimeRef.current > DRAIN_IDLE_THRESHOLD_MS) {
      drainLoopActiveRef.current = false;
      timerIdRef.current = null;
      return;
    }

    // Drain step: move up to DRAIN_PER_FRAME rows toward 0
    if (pending !== 0) {
      const drainAmount = Math.min(Math.abs(pending), DRAIN_PER_FRAME);
      const drained = pending > 0 ? drainAmount : -drainAmount;
      pendingDeltaRef.current -= drained;

      // Quantized dispatch: only dispatch when crossing SCROLL_QUANTUM bin boundary
      const currentBin = Math.floor((pendingDeltaRef.current) / SCROLL_QUANTUM);
      const prevBin = lastDispatchedBinRef.current;

      if (currentBin !== prevBin) {
        const binDelta = (prevBin - currentBin) * SCROLL_QUANTUM;
        lastDispatchedBinRef.current = currentBin;
        dispatch(binDelta);
      }
    }

    // Continue loop
    timerIdRef.current = setTimeout(drainLoop, DRAIN_INTERVAL_MS);
  }, [dispatch]);

  // Start drain loop if not already running
  const ensureDrainLoop = useCallback(() => {
    if (!drainLoopActiveRef.current) {
      drainLoopActiveRef.current = true;
      timerIdRef.current = setTimeout(drainLoop, DRAIN_INTERVAL_MS);
    }
  }, [drainLoop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerIdRef.current !== null) {
        clearTimeout(timerIdRef.current);
      }
    };
  }, []);

  // Accumulate function: called by MouseInputRouter on each wheel event
  return useCallback(
    (delta: number) => {
      pendingDeltaRef.current += delta;
      lastWheelTimeRef.current = Date.now();
      ensureDrainLoop();
    },
    [ensureDrainLoop],
  );
}
