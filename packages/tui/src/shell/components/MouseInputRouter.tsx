import { useInput } from "ink";
import { useCallback, useMemo, useRef } from "react";
import { useScrollBatcher } from "../hooks/useScrollBatcher.js";
import { WheelAccelerator } from "../models/wheel-acceleration.js";
import {
  isSgrMouseInput,
  parseSgrMouseEvent,
} from "../models/transcript-selection-state.js";
import { recoverOrphanMouseTail } from "../models/terminal-input-runtime.js";
import type { ShellInputEvent, TranscriptScrollView } from "../types.js";

/**
 * R5 — App-owned mouse input router.
 *
 * When alt-screen + mouse tracking is active, this component intercepts raw
 * SGR mouse sequences from stdin and dispatches them as structured events:
 *   - Wheel events → transcript-scroll with accelerated step (microtask-batched)
 *   - Click/drag/release → transcript-mouse for selection
 *
 * This component must NOT be rendered when mouse tracking is disabled
 * (non-alt-screen fallback). The parent (ShellApp TaskLayout) gates rendering
 * via the `active` prop.
 */
export function MouseInputRouter({
  active,
  scroll,
  onInput,
}: {
  active: boolean;
  scroll: TranscriptScrollView | undefined;
  onInput: (event: ShellInputEvent) => void;
}): null {
  const accelerator = useMemo(() => new WheelAccelerator(), []);
  const scrollRef = useRef(scroll);
  scrollRef.current = scroll;

  const dispatchScroll = useCallback(
    (delta: number) => {
      onInput({ type: "transcript-scroll", delta });
    },
    [onInput],
  );
  const batchedScroll = useScrollBatcher(dispatchScroll);

  const handleInput = useCallback(
    (input: string) => {
      let seq = input;
      if (!isSgrMouseInput(seq)) {
        const recovered = recoverOrphanMouseTail(seq);
        if (!recovered) return;
        seq = recovered;
      }
      const mouse = parseSgrMouseEvent(seq);
      if (!mouse) return;

      if (mouse.button === "wheel-up" || mouse.button === "wheel-down") {
        const step = accelerator.recordEvent(
          Date.now(),
          scrollRef.current?.viewportHeight,
        );
        const delta = mouse.button === "wheel-up" ? step : -step;
        batchedScroll(delta);
        return;
      }

      onInput({
        type: "transcript-mouse",
        event: {
          x: mouse.x,
          y: mouse.y,
          button: mouse.button,
          action: mouse.action,
        },
      });
    },
    [accelerator, batchedScroll, onInput],
  );

  useInput(
    (input) => {
      handleInput(input);
    },
    { isActive: active },
  );

  return null;
}
