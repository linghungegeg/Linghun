import { useCallback, useRef } from "react";
import type { ParsedTerminalInput } from "./terminal-input.js";
import { useTerminalInput, type UseTerminalInputOptions } from "./useTerminalInput.js";

/**
 * Phase 7 — Paste input hook.
 *
 * Subscribes to bracketed paste events only. Delivers the paste text
 * (already extracted from bracketed paste markers).
 *
 * @param callback - Receives paste text
 * @param options.isActive - Whether the hook is active (default: true)
 */
export type PasteEvent = Extract<ParsedTerminalInput, { kind: "paste" }>;
export type PasteInputHandler = (event: PasteEvent) => void;

export function usePasteInput(
  callback: PasteInputHandler,
  options: UseTerminalInputOptions = {},
): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useTerminalInput(
    useCallback((event: ParsedTerminalInput) => {
      if (event.kind === "paste") {
        callbackRef.current(event);
      }
    }, []),
    options,
  );
}
