import {
  useWheelInput,
  useMouseInput,
  useTerminalInput,
  type ParsedTerminalInput,
} from "@linghun/ink-runtime";
import { useCallback, useMemo, useRef } from "react";
import { useScrollRuntime } from "../hooks/useScrollRuntime.js";
import { WheelAccelerator } from "../models/wheel-acceleration.js";
import { isXtermJsTerminal } from "../terminal-capability.js";
import type { ShellInputEvent, TranscriptScrollView } from "../types.js";

/**
 * Phase 7 — Runtime-owned mouse input router.
 *
 * Uses structured runtime hooks (useWheelInput / useMouseInput / useTerminalInput)
 * instead of raw useInput + manual SGR parsing. The runtime tokenizer/parser
 * (Phase 2) classifies terminal bytes before they reach this component.
 *
 * Event routing:
 *   - Wheel events → accelerator → pending delta accumulator → quantized dispatch
 *   - Mouse events → transcript-mouse for selection
 *   - Focus-out (key event) → lost-release recovery
 *   - Mouse fragments / unknown escapes → silently consumed by runtime (never leak)
 *
 * Phase R5 scroll runtime: wheel events accumulate in a pending delta accumulator
 * with frame drain, preventing state-update explosion on high-frequency input.
 *
 * This component must NOT be rendered when mouse tracking is disabled
 * (non-alt-screen fallback). The parent (ShellApp TaskLayout) gates rendering
 * via the `active` prop.
 */
export function MouseInputRouter({
  active,
  scroll,
  selectionActive = true,
  onInput,
}: {
  active: boolean;
  selectionActive?: boolean;
  scroll: TranscriptScrollView | undefined;
  onInput: (event: ShellInputEvent) => void;
}): null {
  const accelerator = useMemo(() => {
    const base = Number.parseInt(process.env.LINGHUN_SCROLL_SPEED ?? "1", 10) || 1;
    const terminalType = isXtermJsTerminal() ? "xterm.js" : "native";
    return new WheelAccelerator({ base, terminalType });
  }, []);
  const scrollRef = useRef(scroll);
  scrollRef.current = scroll;

  const dispatchScroll = useCallback(
    (delta: number) => {
      onInput({ type: "transcript-scroll", delta });
    },
    [onInput],
  );
  const accumulateScroll = useScrollRuntime(dispatchScroll);

  // Wheel events → accelerator → scroll runtime
  useWheelInput(
    useCallback(
      (event) => {
        const step = accelerator.recordEvent(Date.now(), event.direction, scrollRef.current?.viewportHeight);
        if (step !== 0) {
          accumulateScroll(event.direction === "up" ? step : -step);
        }
      },
      [accelerator, accumulateScroll],
    ),
    { isActive: active },
  );

  // Mouse events → transcript-mouse for selection
  useMouseInput(
    useCallback(
      (event) => {
        if (!selectionActive) return;
        onInput({
          type: "transcript-mouse",
          event: {
            x: Math.max(0, event.x - 1),
            y: Math.max(0, event.y - 1),
            button: event.button === 0 || event.button === 3 ? "left" : "other",
            action: event.action === "press" ? "down" : event.action === "release" ? "up" : event.action,
          },
        });
      },
      [onInput, selectionActive],
    ),
    { isActive: active },
  );

  useTerminalInput(
    useCallback(
      (event: ParsedTerminalInput) => {
        if (event.kind !== "terminal-response") return;
        if (event.response !== "\x1B[O") return;
        if (!selectionActive) return;
        onInput({ type: "transcript-mouse", event: { x: 0, y: 0, button: "left", action: "focus-out" } });
      },
      [onInput, selectionActive],
    ),
    { isActive: active },
  );

  return null;
}
