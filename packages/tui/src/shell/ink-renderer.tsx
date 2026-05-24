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
  const instance = render(<ShellApp controller={controller} />, {
    stdin: options.stdin as NodeJS.ReadStream | undefined,
    stdout: options.stdout as NodeJS.WriteStream | undefined,
    stderr: options.stderr as NodeJS.WriteStream | undefined,
    exitOnCtrlC: false,
    alternateScreen: true,
  });
  return {
    rerender: () => instance.rerender(<ShellApp controller={controller} />),
    clear: () => instance.clear(),
    unmount: () => instance.unmount(),
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
