import type { Writable } from "node:stream";
import type { TerminalCapability } from "./terminal-capability.js";

export const ENABLE_MODIFY_OTHER_KEYS = "\x1B[>4;2m";
export const DISABLE_MODIFY_OTHER_KEYS = "\x1B[>4m";
export const ENABLE_KITTY_KEYBOARD = "\x1B[>1u";
export const DISABLE_KITTY_KEYBOARD = "\x1B[<u";
export const ENABLE_SGR_MOUSE = "\x1B[?1000h\x1B[?1002h\x1B[?1006h";
export const DISABLE_SGR_MOUSE = "\x1B[?1006l\x1B[?1002l\x1B[?1000l";

export type TerminalInteractionOptions = {
  capability: TerminalCapability;
  env?: NodeJS.ProcessEnv;
  appOwnedScreen?: boolean;
};

export type TerminalInteractionModes = {
  kittyKeyboard: boolean;
  modifyOtherKeys: boolean;
  mouseTracking: boolean;
};

export function resolveTerminalInteractionModes({
  capability,
  env = process.env,
  appOwnedScreen = false,
}: TerminalInteractionOptions): TerminalInteractionModes {
  const mouseTracking =
    env.LINGHUN_TUI_MOUSE === "1" && appOwnedScreen && capability.alternateScreen;
  return {
    kittyKeyboard:
      capability.kittyKeyboard ||
      capability.keyboardProtocols.includes("kitty") ||
      capability.keyboardProtocols.includes("csi-u"),
    modifyOtherKeys: capability.keyboardProtocols.includes("modifyOtherKeys"),
    mouseTracking,
  };
}

export function enableTerminalInteractionModes(
  stdout: Writable | undefined,
  modes: TerminalInteractionModes,
): void {
  if (modes.kittyKeyboard) writeBestEffort(stdout, ENABLE_KITTY_KEYBOARD);
  if (modes.modifyOtherKeys) writeBestEffort(stdout, ENABLE_MODIFY_OTHER_KEYS);
  if (modes.mouseTracking) writeBestEffort(stdout, ENABLE_SGR_MOUSE);
}

export function disableTerminalInteractionModes(
  stdout: Writable | undefined,
  modes: TerminalInteractionModes,
): void {
  if (modes.mouseTracking) writeBestEffort(stdout, DISABLE_SGR_MOUSE);
  if (modes.modifyOtherKeys) writeBestEffort(stdout, DISABLE_MODIFY_OTHER_KEYS);
  if (modes.kittyKeyboard) writeBestEffort(stdout, DISABLE_KITTY_KEYBOARD);
}

export function writeBestEffort(stdout: Writable | undefined, text: string): void {
  try {
    stdout?.write(text);
  } catch {
    // stdout may already be closed during terminal teardown.
  }
}
