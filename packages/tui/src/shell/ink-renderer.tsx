import type { Readable, Writable } from "node:stream";
import { render } from "ink";
import React from "react";
import { ShellApp } from "./components/ShellApp.js";
import type { ShellController, ShellRenderOptions } from "./types.js";

export type InkShellInstance = {
  rerender: () => void;
  clear: () => void;
  unmount: () => void;
  waitUntilExit: () => Promise<void>;
  waitUntilRenderFlush: () => Promise<void>;
};

export function shouldUseInkShell(input: Readable, output: Writable): boolean {
  if (process.env.LINGHUN_TUI_PLAIN === "1") return false;
  if (process.env.TERM === "dumb") return false;
  if ((input as { isTTY?: boolean }).isTTY !== true) return false;
  if ((output as { isTTY?: boolean }).isTTY !== true) return false;
  return true;
}

export function renderInkShell(
  controller: ShellController,
  options: ShellRenderOptions = {},
): InkShellInstance {
  const stdout = options.stdout as NodeJS.WriteStream | undefined;
  let instance: ReturnType<typeof render>;

  try {
    instance = render(<ShellApp controller={controller} />, {
      stdin: options.stdin as NodeJS.ReadStream | undefined,
      stdout,
      stderr: options.stderr as NodeJS.WriteStream | undefined,
      exitOnCtrlC: false,
      alternateScreen: true,
      kittyKeyboard: { mode: "auto" },
    });
    hideTerminalCursor(stdout);
  } catch (error) {
    showTerminalCursor(stdout);
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
    showTerminalCursor(stdout);
    // Unref stdin to prevent the process from hanging on exit
    const stdin = options.stdin as { unref?: () => void } | undefined;
    stdin?.unref?.();
  };

  const rerender = () => {
    if (unmounted) return;
    try {
      instance.rerender(<ShellApp controller={controller} />);
    } catch (error) {
      showTerminalCursor(stdout);
      throw error;
    }
  };

  const onResize = () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = undefined;
      if (unmounted) return;
      try {
        instance.clear();
      } catch {
        // Ignore clear errors if stdout is closed
      }
      rerender();
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

function hideTerminalCursor(stdout: NodeJS.WriteStream | undefined): void {
  try {
    stdout?.write("\x1B[?25l");
  } catch {
    // stdout may already be closed
  }
}

function showTerminalCursor(stdout: NodeJS.WriteStream | undefined): void {
  try {
    stdout?.write("\x1B[?25h");
  } catch {
    // stdout may already be closed
  }
}

export function isNoColorTerminal(): boolean {
  return process.env.NO_COLOR === "1" || process.env.FORCE_COLOR === "0";
}
