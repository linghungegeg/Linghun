import type { TerminalInteractionModes } from "@linghun/ink-runtime";
import type { TerminalCapability } from "./terminal-capability.js";

export {
  DISABLE_BRACKETED_PASTE,
  DISABLE_FOCUS_EVENTS,
  DISABLE_KITTY_KEYBOARD,
  DISABLE_MODIFY_OTHER_KEYS,
  DISABLE_SGR_MOUSE,
  ENABLE_BRACKETED_PASTE,
  ENABLE_FOCUS_EVENTS,
  ENABLE_KITTY_KEYBOARD,
  ENABLE_MODIFY_OTHER_KEYS,
  ENABLE_SGR_MOUSE,
  bindTerminalInteractionSignals,
  createTerminalInteractionSession,
  disableTerminalInteractionModes,
  enableTerminalInteractionModes,
  reassertTerminalInteractionModes,
  writeBestEffort,
} from "@linghun/ink-runtime";
export type { TerminalInteractionModes } from "@linghun/ink-runtime";

export type TerminalInteractionOptions = {
  capability: TerminalCapability;
  env?: NodeJS.ProcessEnv;
  appOwnedScreen?: boolean;
};

export function resolveTerminalInteractionModes({
  capability,
  env = process.env,
  appOwnedScreen = false,
}: TerminalInteractionOptions): TerminalInteractionModes {
  const appOwnedInteractive = capability.cursorPositioning && appOwnedScreen && capability.alternateScreen;
  const mouseTracking = env.LINGHUN_TUI_MOUSE !== "0" && appOwnedInteractive;
  return {
    kittyKeyboard:
      capability.kittyKeyboard ||
      capability.keyboardProtocols.includes("kitty") ||
      capability.keyboardProtocols.includes("csi-u"),
    modifyOtherKeys: capability.keyboardProtocols.includes("modifyOtherKeys"),
    mouseTracking,
    focusEvents: appOwnedInteractive,
    bracketedPaste: appOwnedInteractive,
  };
}
