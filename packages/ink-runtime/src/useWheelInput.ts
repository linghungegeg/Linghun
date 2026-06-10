import { useCallback, useRef } from "react";
import type { ParsedTerminalInput } from "./terminal-input.js";
import { useTerminalInput, type UseTerminalInputOptions } from "./useTerminalInput.js";

/**
 * Phase 7 — Wheel input hook.
 *
 * Subscribes to wheel events only. All other event kinds are ignored.
 *
 * @param callback - Receives wheel direction and coordinates
 * @param options.isActive - Whether the hook is active (default: true)
 */
export type WheelEvent = Extract<ParsedTerminalInput, { kind: "wheel" }>;
export type WheelInputHandler = (event: WheelEvent) => void;

export function useWheelInput(
  callback: WheelInputHandler,
  options: UseTerminalInputOptions = {},
): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useTerminalInput(
    useCallback((event: ParsedTerminalInput) => {
      if (event.kind === "wheel") {
        callbackRef.current(event);
      }
    }, []),
    options,
  );
}
