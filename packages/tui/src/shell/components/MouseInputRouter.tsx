import { parseTerminalInput, useInput } from "@linghun/ink-runtime";
import { useCallback, useMemo, useRef } from "react";
import { useScrollRuntime } from "../hooks/useScrollRuntime.js";
import { WheelAccelerator } from "../models/wheel-acceleration.js";
import { isSgrMouseInput, parseSgrMouseEvent } from "../models/transcript-selection-state.js";
import { recoverOrphanMouseTail } from "../models/terminal-input-runtime.js";
import { isXtermJsTerminal } from "../terminal-capability.js";
import type { ShellInputEvent, TranscriptScrollView } from "../types.js";

/**
 * R5 — App-owned mouse input router.
 *
 * When alt-screen + mouse tracking is active, this component intercepts raw
 * SGR mouse sequences from stdin and dispatches them as structured events:
 *   - Wheel events → transcript-scroll with accelerated step + pending delta drain
 *   - Click/drag/release → transcript-mouse for selection
 *
 * Phase R5 scroll runtime: wheel events accumulate in a pending delta accumulator
 * with requestAnimationFrame drain, preventing state-update explosion on high-frequency
 * input (trackpad flicks, mouse free-spin). Quantized dispatch reduces React re-renders
 * by ~5-10x compared to immediate per-event dispatch.
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

  const handleInput = useCallback(
    (input: string) => {
      if (input === "\x1B[O" || input === "[O") {
        if (selectionActive) {
          onInput({ type: "transcript-mouse", event: { x: 0, y: 0, button: "left", action: "focus-out" } });
        }
        return;
      }

      let dispatched = false;
      for (const event of parseTerminalInput(input)) {
        if (event.kind === "wheel") {
          const step = accelerator.recordEvent(Date.now(), event.direction, scrollRef.current?.viewportHeight);
          if (step !== 0) {
            accumulateScroll(event.direction === "up" ? step : -step);
          }
          dispatched = true;
          continue;
        }
        if (event.kind === "mouse") {
          if (selectionActive) {
            onInput({
              type: "transcript-mouse",
              event: {
                x: Math.max(0, event.x - 1),
                y: Math.max(0, event.y - 1),
                button: event.button === 0 || event.button === 3 ? "left" : "other",
                action: event.action === "press" ? "down" : event.action === "release" ? "up" : event.action,
              },
            });
          }
          dispatched = true;
          continue;
        }
      }
      if (dispatched) return;

      let seq = input;
      if (!isSgrMouseInput(seq)) {
        const recovered = recoverOrphanMouseTail(seq);
        if (!recovered) return;
        seq = recovered;
      }
      const mouse = parseSgrMouseEvent(seq);
      if (!mouse) return;

      if (mouse.button === "wheel-up" || mouse.button === "wheel-down") {
        const direction = mouse.button === "wheel-up" ? "up" : "down";
        const step = accelerator.recordEvent(Date.now(), direction, scrollRef.current?.viewportHeight);
        if (step !== 0) {
          accumulateScroll(mouse.button === "wheel-up" ? step : -step);
        }
        return;
      }

      if (selectionActive) {
        onInput({
          type: "transcript-mouse",
          event: {
            x: mouse.x,
            y: mouse.y,
            button: mouse.button,
            action: mouse.action,
          },
        });
      }
    },
    [accelerator, accumulateScroll, onInput, selectionActive],
  );

  useInput(
    (input) => {
      handleInput(input);
    },
    { isActive: active },
  );

  return null;
}
