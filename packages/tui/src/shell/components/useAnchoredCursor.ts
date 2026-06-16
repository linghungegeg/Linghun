import { type DOMElement, useBoxMetrics, useCursor } from "@linghun/ink-runtime";
import { useLayoutEffect, useState } from "react";
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
 *   - render passes the last committed post-layout position to Ink.
 *   - useLayoutEffect recomputes the absolute parent-chain origin after Yoga
 *     commits layout, then schedules a second render only when the position
 *     changed. This catches parent movement from home centering, task bottom
 *     pinning, soft wrapping, and terminal resize.
 *   - When the terminal cannot reliably position the cursor, when the layout
 *     has not been measured yet, or when the parent chain cannot resolve, we
 *     pass undefined (cursor hidden). No fake inverse-text cursor.
 *
 * useBoxMetrics is observed only to:
 *   - trigger re-runs when anchor layout/resize changes
 * Its left/top values are never used as absolute coordinates.
 */
export function useAnchoredCursor(
  declared: { row: number; col: number } | null,
  anchorRef: React.RefObject<DOMElement | null>,
  capability: TerminalCapability,
): void {
  const { setCursorPosition } = useCursor();
  const [committedPosition, setCommittedPosition] = useState<
    { x: number; y: number } | undefined
  >(undefined);
  // Subscribe to layout/resize via useBoxMetrics. We do NOT use its left/top
  // (parent-relative); the absolute parent-chain origin is recomputed below.
  useBoxMetrics(anchorRef);

  // Feed Ink the last post-layout cursor position during render; Ink commits
  // it in its own insertion effect. We refresh this state in a layout effect
  // below so parent-chain moves (home centering, task bottom pinning, resize)
  // do not reuse stale render-phase Yoga coordinates.
  setCursorPosition(committedPosition);

  useLayoutEffect(() => {
    const next = resolveAnchoredCursorPosition(declared, anchorRef, capability);
    setCommittedPosition((previous) => (samePosition(previous, next) ? previous : next));
  });
}

function resolveAnchoredCursorPosition(
  declared: { row: number; col: number } | null,
  anchorRef: React.RefObject<DOMElement | null>,
  capability: TerminalCapability,
): { x: number; y: number } | undefined {
  if (!declared || !capability.cursorPositioning) return undefined;
  let origin: { x: number; y: number } | null = null;
  try {
    origin = getAbsoluteOrigin(anchorRef.current);
  } catch {
    origin = null;
  }
  if (!origin) return undefined;
  return {
    x: Math.max(0, Math.round(origin.x + declared.col)),
    y: Math.max(0, Math.round(origin.y + declared.row)),
  };
}

function samePosition(
  left: { x: number; y: number } | undefined,
  right: { x: number; y: number } | undefined,
): boolean {
  return left?.x === right?.x && left?.y === right?.y;
}
