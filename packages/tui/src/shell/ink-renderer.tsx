import type { Readable, Writable } from "node:stream";
import { render } from "@linghun/ink-runtime";
import React from "react";
import { ShellApp } from "./components/ShellApp.js";
import { type TerminalCapability, detectTerminalCapability } from "./terminal-capability.js";
import {
  bindTerminalInteractionSignals,
  createTerminalInteractionSession,
  resolveTerminalInteractionModes,
  writeBestEffort,
} from "./terminal-interaction-runtime.js";
import { drainStdin, writeSGRResetAndFlush } from "./stdout-flush-barrier.js";
import { recoverTerminalState } from "./terminal-state-recovery.js";
import type { ShellController, ShellRenderOptions } from "./types.js";

export type InkShellInstance = {
  rerender: () => void;
  clear: () => void;
  unmount: () => void;
  waitUntilExit: () => Promise<void>;
  waitUntilRenderFlush: () => Promise<void>;
};

type InkStdout = NodeJS.WriteStream & { __linghunRawStdout?: NodeJS.WriteStream };

export function shouldUseInkShell(input: Readable, output: Writable): boolean {
  if (process.env.LINGHUN_TUI_PLAIN === "1") return false;
  if (process.env.TERM === "dumb") return false;
  if ((input as { isTTY?: boolean }).isTTY !== true) return false;
  if ((output as { isTTY?: boolean }).isTTY !== true) return false;

  // Ink works on any TTY with cursor positioning — alternate screen is optional.
  // Only truly incapable terminals (legacy Windows cmd conhost) fall to plain.
  const capability = detectTerminalCapability();
  if (!capability.cursorPositioning) return false;

  return true;
}

export function renderInkShell(
  controller: ShellController,
  options: ShellRenderOptions = {},
): InkShellInstance {
  const stdout = options.stdout as NodeJS.WriteStream | undefined;
  const inkStdout = createInkStdout(stdout);
  const capability = detectTerminalCapability();
  const useAlternateScreen = resolveAlternateScreen(capability);
  const terminalInteractionModes = resolveTerminalInteractionModes({
    capability,
    appOwnedScreen: useAlternateScreen,
  });
  const terminalInteractionSession = createTerminalInteractionSession(
    stdout,
    terminalInteractionModes,
  );
  const terminalInteractionSignals = bindTerminalInteractionSignals(
    process,
    terminalInteractionSession,
  );
  let instance: ReturnType<typeof render>;

  try {
    terminalInteractionSession.enable();
    instance = render(<ShellApp controller={controller} capability={capability} />, {
      stdin: options.stdin as NodeJS.ReadStream | undefined,
      stdout: inkStdout,
      stderr: options.stderr as NodeJS.WriteStream | undefined,
      exitOnCtrlC: false,
      alternateScreen: useAlternateScreen,
    });
  } catch (error) {
    // Phase 6: Terminal state recovery on render startup error
    terminalInteractionSession.disable();
    void recoverTerminalState(stdout, {
      exitAlternateScreen: useAlternateScreen,
      logError: (msg) => {
        const stderr = options.stderr as NodeJS.WriteStream | undefined;
        stderr?.write(`[linghun] ${msg}\n`);
      },
    }).catch(() => {
      // Recovery failed, but still throw original error
    });
    throw error;
  }

  let unmounted = false;
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  let waitUntilExitPromise: Promise<void> | undefined;
  const doUnmount = () => {
    if (unmounted) return;
    unmounted = true;
    if (resizeTimer) {
      clearTimeout(resizeTimer);
      resizeTimer = undefined;
    }
    terminalInteractionSignals.dispose();
    stdout?.off("resize", onResize);
    stdinStream?.off("close", doUnmount);
    stdinStream?.off("end", doUnmount);
    stdinStream?.off("error", doUnmount);
    stdout?.off("close", doUnmount);
    stdout?.off("error", doUnmount);
    try {
      instance.unmount();
    } catch {
      // stdout/stdin may already be closed (e.g. Windows cmd window close)
    }
    terminalInteractionSession.disable();

    // Phase 6: Exit cleanup - drain stdin and reset SGR state (async, non-blocking)
    drainStdin(stdinStream);
    void writeSGRResetAndFlush(stdout).catch(() => {
      // Best-effort: ignore flush errors during unmount
    });

    showTerminalCursor(stdout);
    // Unref stdin to prevent the process from hanging on exit
    const stdin = options.stdin as { unref?: () => void } | undefined;
    stdin?.unref?.();
  };

  const rerender = () => {
    if (unmounted) return;
    try {
      instance.rerender(<ShellApp controller={controller} capability={capability} />);
    } catch (error) {
      // Phase 6/7: Log rerender error but do NOT call recoverTerminalState here.
      // This is a mid-session error (e.g. stream-close race) — the terminal session
      // is still active and the interaction session manages modes. Heavy-handed
      // recovery (cursor show, mouse disable, SGR reset) would interfere with the
      // ongoing session. Full recovery runs only on unmount/exit.
      const stderr = options.stderr as NodeJS.WriteStream | undefined;
      const message = error instanceof Error ? error.message : String(error);
      stderr?.write(`[linghun] Render error: ${message}\n`);
    }
  };

  const onResize = () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = undefined;
      if (unmounted) return;
      // Resize changes the terminal's physical wrap width. In app-owned
      // alternate screen, reassert modes and let Ink redraw the frame in-place.
      // Normal-screen fallback still clears the current viewport before
      // rerendering so old-width frames do not remain visible.
      if (!useAlternateScreen) {
        writeBestEffort(stdout, "\x1B[2J\x1B[H");
      }
      terminalInteractionSession.reassert();
      rerender();
      // Note: Viewport clamp happens automatically in ScrollViewport's useEffect
      // after rerender measures new dimensions and calls onMeasure callback
    }, 60);
  };

  // Handle stdin/stdout close/error (Windows cmd window close, pipe break)
  const stdinStream = options.stdin as NodeJS.ReadStream | undefined;
  stdinStream?.on("close", doUnmount);
  stdinStream?.on("end", doUnmount);
  stdinStream?.on("error", doUnmount);
  stdout?.on("close", doUnmount);
  stdout?.on("error", doUnmount);
  stdout?.on("resize", onResize);

  return {
    rerender,
    clear: () => instance.clear(),
    unmount: doUnmount,
    waitUntilExit: async () => {
      if (unmounted) return;
      waitUntilExitPromise ??= instance.waitUntilExit().then(() => undefined);
      await waitUntilExitPromise;
    },
    waitUntilRenderFlush: async () => {
      await instance.waitUntilRenderFlush();
    },
  };
}

export function resolveAlternateScreen(capability: TerminalCapability): boolean {
  // Full-screen Ink shell owns the screen by default when the terminal can
  // safely provide an alternate buffer. Plain/headless/pipe paths never reach
  // this renderer, and LINGHUN_FULLSCREEN=0 keeps the normal-screen fallback.
  if (process.env.LINGHUN_FULLSCREEN === "0") return false;
  if (!capability.alternateScreen) return false;
  if (process.env.TMUX_PANE || process.env.TERM_PROGRAM === "tmux") return false;
  return true;
}

function showTerminalCursor(stdout: NodeJS.WriteStream | undefined): void {
  writeBestEffort(stdout, "\x1B[?25h");
}

function createInkStdout(stdout: NodeJS.WriteStream | undefined): NodeJS.WriteStream | undefined {
  if (!stdout) return undefined;
  const wrapped = Object.create(stdout) as InkStdout;
  wrapped.__linghunRawStdout = stdout;
  wrapped.write = ((chunk: unknown, ...args: unknown[]) => {
    const next =
      typeof chunk === "string"
        ? chunk.replace(/\x1B\[3J/g, "")
        : Buffer.isBuffer(chunk)
          ? Buffer.from(chunk.toString().replace(/\x1B\[3J/g, ""))
          : chunk;
    return (stdout.write as (...writeArgs: unknown[]) => boolean).call(stdout, next, ...args);
  }) as NodeJS.WriteStream["write"];
  return wrapped;
}

export function isNoColorTerminal(): boolean {
  return process.env.NO_COLOR === "1" || process.env.FORCE_COLOR === "0";
}

/** Re-export for external consumers. */
export { detectTerminalCapability } from "./terminal-capability.js";
export type { TerminalCapability } from "./terminal-capability.js";
