import { type DOMElement, useBoxMetrics, useCursor } from "ink";
import type { TerminalCapability } from "../terminal-capability.js";

/**
 * Compute the absolute origin (in ink-root coordinates) of a DOM node by
 * accumulating yoga-computed left/top up the parent chain.
 *
 * Returns null when:
 *   - the node is detached
 *   - any ancestor lacks a yogaNode
 *   - the chain does not reach ink-root
 *
 * Callers must treat null as "do not position the cursor"; they MUST NOT fall
 * back to the box-metrics left/top values, which are parent-relative only.
 */
function getAbsoluteOrigin(node: DOMElement | null): { x: number; y: number } | null {
  if (!node) return null;
  let x = 0;
  let y = 0;
  let cur: DOMElement | undefined = node;
  while (cur && cur.nodeName !== "ink-root") {
    const yogaNode = cur.yogaNode;
    if (!yogaNode) return null;
    const layout = yogaNode.getComputedLayout();
    x += layout.left;
    y += layout.top;
    cur = cur.parentNode;
  }
  if (!cur || cur.nodeName !== "ink-root") return null;
  return { x, y };
}

/**
 * Anchored cursor foundation.
 *
 * The composer (or any input) declares an internal cursor row/col. This hook
 * resolves it to terminal-absolute coordinates (relative to ink-root) by
 * accumulating yoga layout up the anchor's parent chain, and writes the
 * position via Ink's useCursor.
 *
 * Cursor write timing:
 *   - desiredPosition is computed in render phase from anchorRef.current,
 *     parent-chain yoga layout, and hasMeasured.
 *   - setCursorPosition(desiredPosition) is called directly in render phase.
 *     It is safe to do so because Ink's useCursor's setCursorPosition is
 *     a useCallback that only writes a ref; the actual commit happens inside
 *     useCursor's own useInsertionEffect at commit time. Writing during render
 *     ensures the latest desired position is committed without an effect lag.
 *   - When the terminal cannot reliably position the cursor, when the layout
 *     has not been measured yet, or when the parent chain cannot resolve, we
 *     pass undefined (cursor hidden). No fake inverse-text cursor.
 *
 * useBoxMetrics is observed only to:
 *   - trigger re-runs when layout/resize/sibling content changes
 *   - gate first-frame readiness via hasMeasured
 * Its left/top values are never used as absolute coordinates.
 */
export function useAnchoredCursor(
  declared: { row: number; col: number } | null,
  anchorRef: React.RefObject<DOMElement | null>,
  capability: TerminalCapability,
): void {
  const { setCursorPosition } = useCursor();
  // Subscribe to layout/resize via useBoxMetrics. We do NOT use its left/top
  // (parent-relative); we keep the subscription only for the implicit re-run
  // on resize / sibling layout changes. hasMeasured is intentionally NOT used
  // as a render gate: D13E-P3 cleanup #6 — the first-frame cursor was hidden
  // because useBoxMetrics flips hasMeasured inside a useEffect, one frame
  // after yoga has already committed layout. getAbsoluteOrigin's null-check
  // is sufficient: if parent-chain layout is ready (the common case after
  // first commit), we position the cursor immediately; if it isn't, the
  // intrinsic null path keeps the cursor hidden — same behavior as before.
  useBoxMetrics(anchorRef);

  // Render-phase calculation. setCursorPosition is a ref-write callback in
  // Ink, not a React state setter — calling it during render is safe.
  // When `declared` is null the caller is yielding the cursor (e.g. permission
  // selector owns focus); pass undefined so Ink hides the native cursor.
  let desired: { x: number; y: number } | undefined;
  if (declared && capability.cursorPositioning) {
    let origin: { x: number; y: number } | null = null;
    try {
      origin = getAbsoluteOrigin(anchorRef.current);
    } catch {
      origin = null;
    }
    if (origin) {
      desired = {
        x: Math.max(0, Math.round(origin.x + declared.col)),
        y: Math.max(0, Math.round(origin.y + declared.row)),
      };
    }
  }
  setCursorPosition(desired);
}
