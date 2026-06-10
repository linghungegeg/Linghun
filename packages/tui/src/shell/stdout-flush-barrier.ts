import type { Writable } from "node:stream";

/**
 * Phase 6 — Stdout flush barrier for critical terminal state changes.
 *
 * Ensures stdout buffer is flushed before critical operations like:
 * - Mode changes (mouse mode enable/disable, alternate screen)
 * - Exit/cleanup (SGR reset, cursor restore)
 * - Terminal state recovery after render error
 *
 * Behavioral goal (from RENDERER_RUNTIME_MIGRATION_PLAN Phase 6):
 * - Exit returns to a clean shell prompt
 * - Render errors do not leave terminal state broken
 *
 * Implementation:
 * - Synchronous flush on Node.js writable streams (stdout.write callback)
 * - Best-effort: if flush fails or stream is closed, continue anyway
 * - No-op on non-TTY streams (pipes, redirected output)
 */

/**
 * Flush stdout buffer and wait for drain event.
 * Returns immediately if stream is not writable or already drained.
 */
export async function flushStdout(stdout: Writable | undefined): Promise<void> {
  if (!stdout) return;

  // Non-TTY streams (pipes) don't need explicit flush
  if (!(stdout as NodeJS.WriteStream).isTTY) return;

  // If stream is closed or destroyed, skip flush
  if (stdout.destroyed || stdout.closed) return;

  // If no buffered data, return immediately
  if (stdout.writableLength === 0) return;

  // Wait for drain event (buffered data flushed to kernel)
  return new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      stdout.off("drain", onDrain);
      resolve(); // Timeout after 100ms (best-effort)
    }, 100);

    const onDrain = () => {
      clearTimeout(timeout);
      resolve();
    };

    stdout.once("drain", onDrain);

    // Trigger drain by writing empty string (no-op if already draining)
    if (stdout.writable && !stdout.destroyed) {
      stdout.write("", (error) => {
        if (error) {
          clearTimeout(timeout);
          stdout.off("drain", onDrain);
          resolve(); // Error is non-fatal, continue cleanup
        }
      });
    } else {
      clearTimeout(timeout);
      stdout.off("drain", onDrain);
      resolve();
    }
  });
}

/**
 * Write SGR reset sequence and flush.
 * Used before exit to clear any leftover styles/modes.
 */
export async function writeSGRResetAndFlush(stdout: Writable | undefined): Promise<void> {
  if (!stdout || stdout.destroyed || stdout.closed) return;
  if ((stdout as NodeJS.WriteStream).isTTY === false) return;

  try {
    // SGR reset: \x1b[0m (reset all attributes)
    // Show cursor: \x1b[?25h
    // Disable SGR mouse: \x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l
    const resetSequence = "\x1b[0m\x1b[?25h\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l";

    if (stdout.writable && !stdout.destroyed) {
      stdout.write(resetSequence);
    }

    await flushStdout(stdout);
  } catch {
    // Best-effort: if write/flush fails, continue cleanup anyway
  }
}

/**
 * Drain pending stdin data to prevent it from leaking into the shell after exit.
 * Non-blocking: reads available data without waiting for more input.
 */
export function drainStdin(stdin: NodeJS.ReadStream | undefined): void {
  if (!stdin || stdin.destroyed || stdin.closed) return;
  if (!stdin.readable || stdin.readableLength === 0) return;

  try {
    // Read all available data without blocking
    while (stdin.readable && stdin.readableLength > 0) {
      stdin.read();
    }
  } catch {
    // Best-effort: if read fails, continue anyway
  }
}
