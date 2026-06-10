import { useCallback, useRef } from "react";
import type { ParsedTerminalInput } from "./terminal-input.js";
import { useTerminalInput, type UseTerminalInputOptions } from "./useTerminalInput.js";

/**
 * Phase 7 — Terminal response hook.
 *
 * Subscribes to terminal response events only (DA1/DA2/DECRPM/cursor-position
 * reports, OSC replies, DCS replies). These never reach text input handlers.
 *
 * @param callback - Receives terminal response event
 * @param options.isActive - Whether the hook is active (default: true)
 */
export type TerminalResponseEvent = Extract<ParsedTerminalInput, { kind: "terminal-response" }>;
export type TerminalResponseHandler = (event: TerminalResponseEvent) => void;

export function useTerminalResponse(
  callback: TerminalResponseHandler,
  options: UseTerminalInputOptions = {},
): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useTerminalInput(
    useCallback((event: ParsedTerminalInput) => {
      if (event.kind === "terminal-response") {
        callbackRef.current(event);
      }
    }, []),
    options,
  );
}
