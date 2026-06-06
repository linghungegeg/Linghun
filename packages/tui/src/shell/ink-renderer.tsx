import type { Readable, Writable } from "node:stream";
import { render } from "ink";
import React from "react";
import { ShellApp } from "./components/ShellApp.js";
import { type TerminalCapability, detectTerminalCapability } from "./terminal-capability.js";
import type { ShellController, ShellRenderOptions } from "./types.js";

const ENABLE_MODIFY_OTHER_KEYS = "\x1B[>4;2m";
const DISABLE_MODIFY_OTHER_KEYS = "\x1B[>4m";
export const ENABLE_SGR_MOUSE = "\x1B[?1000h\x1B[?1002h\x1B[?1006h";
export const DISABLE_SGR_MOUSE = "\x1B[?1006l\x1B[?1002l\x1B[?1000l";

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
  const capability = detectTerminalCapability();
  const enableModifyOtherKeys = capability.keyboardProtocols.includes("modifyOtherKeys");
  const enableKittyKeyboard =
    capability.kittyKeyboard || capability.keyboardProtocols.includes("csi-u");
  // Phase 7.18 repair: transcript virtualization uses an app-owned clipped
  // viewport, so real wheel events must enter the transcript scroll reducer.
  // Alternate screen stays disabled; selection/copy is still not reintroduced.
  const enableMouseTracking = true;
  const useAlternateScreen = false;
  let instance: ReturnType<typeof render>;

  try {
    if (enableModifyOtherKeys) {
      writeBestEffort(stdout, ENABLE_MODIFY_OTHER_KEYS);
    }
    if (enableMouseTracking) {
      writeBestEffort(stdout, ENABLE_SGR_MOUSE);
    }
    instance = render(<ShellApp controller={controller} capability={capability} />, {
      stdin: options.stdin as NodeJS.ReadStream | undefined,
      stdout,
      stderr: options.stderr as NodeJS.WriteStream | undefined,
      exitOnCtrlC: false,
      alternateScreen: useAlternateScreen,
      kittyKeyboard: enableKittyKeyboard ? { mode: "auto" } : undefined,
    });
  } catch (error) {
    if (enableMouseTracking) {
      writeBestEffort(stdout, DISABLE_SGR_MOUSE);
    }
    if (enableModifyOtherKeys) {
      writeBestEffort(stdout, DISABLE_MODIFY_OTHER_KEYS);
    }
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
    if (enableModifyOtherKeys) {
      writeBestEffort(stdout, DISABLE_MODIFY_OTHER_KEYS);
    }
    if (enableMouseTracking) {
      writeBestEffort(stdout, DISABLE_SGR_MOUSE);
    }
    showTerminalCursor(stdout);
    // Unref stdin to prevent the process from hanging on exit
    const stdin = options.stdin as { unref?: () => void } | undefined;
    stdin?.unref?.();
  };

  const rerender = () => {
    if (unmounted) return;
    try {
      instance.rerender(<ShellApp controller={controller} capability={capability} />);
    } catch {
      // Ignore Ink rerender errors from stream close / unmount races
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

function showTerminalCursor(stdout: NodeJS.WriteStream | undefined): void {
  writeBestEffort(stdout, "\x1B[?25h");
}

function writeBestEffort(stdout: NodeJS.WriteStream | undefined, text: string): void {
  try {
    stdout?.write(text);
  } catch {
    // stdout may already be closed
  }
}

export function isNoColorTerminal(): boolean {
  return process.env.NO_COLOR === "1" || process.env.FORCE_COLOR === "0";
}

/** Re-export for external consumers. */
export { detectTerminalCapability } from "./terminal-capability.js";
export type { TerminalCapability } from "./terminal-capability.js";
