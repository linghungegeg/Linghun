import { useCallback, useRef } from "react";
import type { ParsedTerminalInput } from "./terminal-input.js";
import { useTerminalInput, type UseTerminalInputOptions } from "./useTerminalInput.js";

/**
 * Phase 7 — Mouse input hook.
 *
 * Subscribes to mouse events only (press/drag/release/hover).
 * Wheel events are NOT delivered here — use useWheelInput for those.
 * Mouse fragments are silently consumed (never leak to text handlers).
 *
 * @param callback - Receives structured mouse event
 * @param options.isActive - Whether the hook is active (default: true)
 */
export type MouseEvent = Extract<ParsedTerminalInput, { kind: "mouse" }>;
export type MouseInputHandler = (event: MouseEvent) => void;

export function useMouseInput(
  callback: MouseInputHandler,
  options: UseTerminalInputOptions = {},
): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useTerminalInput(
    useCallback((event: ParsedTerminalInput) => {
      if (event.kind === "mouse") {
        callbackRef.current(event);
      }
    }, []),
    options,
  );
}
