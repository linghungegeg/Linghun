import type { TerminalInteractionModes } from "@linghun/ink-runtime";
import type { TerminalCapability } from "./terminal-capability.js";

export {
  DISABLE_BRACKETED_PASTE,
  DISABLE_FOCUS_EVENTS,
  DISABLE_KITTY_KEYBOARD,
  DISABLE_MODIFY_OTHER_KEYS,
  DISABLE_SGR_MOUSE,
  DISABLE_ALTERNATE_SCROLL,
  ENABLE_BRACKETED_PASTE,
  ENABLE_FOCUS_EVENTS,
  ENABLE_KITTY_KEYBOARD,
  ENABLE_MODIFY_OTHER_KEYS,
  ENABLE_SGR_MOUSE,
  ENABLE_ALTERNATE_SCROLL,
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
  normalScreenWheel?: boolean;
};

export function resolveTerminalInteractionModes({
  capability,
  env = process.env,
  appOwnedScreen = false,
  normalScreenWheel = false,
}: TerminalInteractionOptions): TerminalInteractionModes {
  const appOwnedInteractive = capability.cursorPositioning && appOwnedScreen && capability.alternateScreen;
  const wheelInteractive = appOwnedInteractive || (capability.cursorPositioning && normalScreenWheel);
  const mouseTracking = (appOwnedInteractive || env.LINGHUN_TUI_MOUSE === "1") && wheelInteractive;
  const wheelMouseTracking = mouseTracking && normalScreenWheel && !appOwnedInteractive;
  const alternateScroll = appOwnedInteractive && env.LINGHUN_TUI_ALTERNATE_SCROLL !== "0";
  const selectionActive = env.LINGHUN_TUI_MOUSE_SELECTION === "1";
  const focusEvents = mouseTracking && selectionActive && env.LINGHUN_TUI_FOCUS === "1";
  return {
    kittyKeyboard:
      capability.kittyKeyboard ||
      capability.keyboardProtocols.includes("kitty") ||
      capability.keyboardProtocols.includes("csi-u"),
    modifyOtherKeys: capability.keyboardProtocols.includes("modifyOtherKeys"),
    mouseTracking,
    wheelMouseTracking,
    alternateScroll,
    focusEvents,
    bracketedPaste: appOwnedInteractive,
  };
}
