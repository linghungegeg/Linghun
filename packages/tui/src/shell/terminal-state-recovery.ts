import type { Writable } from "node:stream";
import { writeSGRResetAndFlush } from "./stdout-flush-barrier.js";

/**
 * Phase 6 — Terminal state recovery on render error.
 *
 * When Ink render crashes or throws, terminal state may be left in a broken state:
 * - Hidden cursor
 * - SGR mouse modes still enabled
 * - Alternate screen still active
 * - Leftover styles/colors
 *
 * This module provides recovery functions to restore terminal state after errors.
 *
 * Behavioral goal (from RENDERER_RUNTIME_MIGRATION_PLAN Phase 6):
 * - Render errors do not leave terminal state broken
 * - Exit returns to a clean shell prompt
 */

export type TerminalStateSnapshot = {
  cursorVisible: boolean;
  mouseEnabled: boolean;
  alternateScreen: boolean;
  timestamp: number;
};

/**
 * Create initial terminal state snapshot.
 * Assumes clean terminal at startup.
 */
export function createTerminalStateSnapshot(): TerminalStateSnapshot {
  return {
    cursorVisible: true,
    mouseEnabled: false,
    alternateScreen: false,
    timestamp: Date.now(),
  };
}

/**
 * Recover terminal state after render error.
 *
 * Attempts to restore terminal to a known-good state by:
 * 1. Showing cursor
 * 2. Disabling mouse modes
 * 3. Resetting SGR attributes
 * 4. Optionally exiting alternate screen
 *
 * Best-effort: if any write fails, continues with remaining recovery steps.
 */
export async function recoverTerminalState(
  stdout: Writable | undefined,
  options: {
    exitAlternateScreen?: boolean;
    logError?: (message: string) => void;
  } = {},
): Promise<void> {
  if (!stdout || stdout.destroyed || stdout.closed) return;
  if ((stdout as NodeJS.WriteStream).isTTY === false) return;

  const { exitAlternateScreen = false, logError } = options;

  try {
    const recoverySequences: string[] = [];

    // Show cursor
    recoverySequences.push("\x1b[?25h");

    // Disable all mouse modes
    recoverySequences.push("\x1b[?1000l"); // X10 mouse
    recoverySequences.push("\x1b[?1002l"); // Button motion
    recoverySequences.push("\x1b[?1003l"); // Any motion
    recoverySequences.push("\x1b[?1006l"); // SGR mouse

    // Disable focus events
    recoverySequences.push("\x1b[?1004l");

    // Disable bracketed paste
    recoverySequences.push("\x1b[?2004l");

    // Reset SGR attributes (colors, bold, etc)
    recoverySequences.push("\x1b[0m");

    // Exit alternate screen if requested
    if (exitAlternateScreen) {
      recoverySequences.push("\x1b[?1049l");
    }

    // Move cursor to start of line and clear line (clean up any partial output)
    recoverySequences.push("\r\x1b[K");

    const fullSequence = recoverySequences.join("");

    if (stdout.writable && !stdout.destroyed) {
      stdout.write(fullSequence, (error) => {
        if (error && logError) {
          const message = error instanceof Error ? error.message : String(error);
          logError(`Terminal state recovery write failed: ${message}`);
        }
      });
    }

    // Flush to ensure recovery sequences reach terminal
    await writeSGRResetAndFlush(stdout);
  } catch (error) {
    if (logError) {
      const message = error instanceof Error ? error.message : String(error);
      logError(`Terminal state recovery failed: ${message}`);
    }
    // Continue despite error - we tried our best
  }
}

/**
 * Create a terminal state recovery handler that can be used in error boundaries.
 *
 * Returns a cleanup function that should be called when recovering from an error.
 */
export function createTerminalStateRecoveryHandler(
  stdout: Writable | undefined,
  options: {
    exitAlternateScreen?: boolean;
    logError?: (message: string) => void;
  } = {},
): () => Promise<void> {
  return async () => {
    await recoverTerminalState(stdout, options);
  };
}
