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
  const instance = render(<ShellApp controller={controller} />, {
    stdin: options.stdin as NodeJS.ReadStream | undefined,
    stdout,
    stderr: options.stderr as NodeJS.WriteStream | undefined,
    exitOnCtrlC: false,
    alternateScreen: true,
    kittyKeyboard: { mode: "auto" },
  });

  let unmounted = false;
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  const doUnmount = () => {
    if (unmounted) return;
    unmounted = true;
    if (resizeTimer) {
      clearTimeout(resizeTimer);
      resizeTimer = undefined;
    }
    stdout?.off("resize", onResize);
    instance.unmount();
    // Unref stdin to prevent the process from hanging on exit
    const stdin = options.stdin as { unref?: () => void } | undefined;
    stdin?.unref?.();
  };

  const rerender = () => {
    if (unmounted) return;
    instance.rerender(<ShellApp controller={controller} />);
  };

  const onResize = () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = undefined;
      if (unmounted) return;
      instance.clear();
      rerender();
    }, 60);
  };

  // Handle stdin close/error (Windows cmd window close, pipe break)
  const stdinStream = options.stdin as NodeJS.ReadStream | undefined;
  stdinStream?.on("close", doUnmount);
  stdinStream?.on("end", doUnmount);
  stdinStream?.on("error", doUnmount);
  stdout?.on("resize", onResize);

  return {
    rerender,
    clear: () => instance.clear(),
    unmount: doUnmount,
    waitUntilExit: async () => {
      await instance.waitUntilExit();
    },
    waitUntilRenderFlush: async () => {
      await instance.waitUntilRenderFlush();
    },
  };
}

export function isNoColorTerminal(): boolean {
  return process.env.NO_COLOR === "1" || process.env.FORCE_COLOR === "0";
}
