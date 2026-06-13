import { useInput } from "ink";
import { useCallback, useRef } from "react";
import { parseTerminalInput, type ParsedTerminalInput } from "./terminal-input.js";

/**
 * Phase 7 — Structured terminal input hook.
 *
 * Wraps stock Ink useInput and parses raw stdin through the runtime tokenizer,
 * delivering structured ParsedTerminalInput events instead of raw strings.
 *
 * This is the runtime-owned entry point for all terminal input classification.
 * App components should consume this (or the specialized hooks) instead of
 * calling useInput + manual classification.
 *
 * @param callback - Receives each ParsedTerminalInput event
 * @param options.isActive - Whether the hook is active (default: true)
 */
export type TerminalInputHandler = (event: ParsedTerminalInput) => void;

export type UseTerminalInputOptions = {
  isActive?: boolean;
};

export function useTerminalInput(
  callback: TerminalInputHandler,
  options: UseTerminalInputOptions = {},
): void {
  const { isActive = true } = options;
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useInput(
    useCallback((input: string) => {
      const events = parseTerminalInput(input);
      for (const event of events) {
        callbackRef.current(event);
      }
    }, []),
    { isActive },
  );
}
