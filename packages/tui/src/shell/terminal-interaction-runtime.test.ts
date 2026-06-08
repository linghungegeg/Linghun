import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import type { TerminalCapability } from "./terminal-capability.js";
import {
  DISABLE_KITTY_KEYBOARD,
  DISABLE_MODIFY_OTHER_KEYS,
  DISABLE_SGR_MOUSE,
  ENABLE_KITTY_KEYBOARD,
  ENABLE_MODIFY_OTHER_KEYS,
  ENABLE_SGR_MOUSE,
  disableTerminalInteractionModes,
  enableTerminalInteractionModes,
  resolveTerminalInteractionModes,
} from "./terminal-interaction-runtime.js";

function capability(overrides: Partial<TerminalCapability> = {}): TerminalCapability {
  return {
    tier: "modern",
    unicodeBox: true,
    cjkWide: true,
    richColor: true,
    keyboardProtocols: ["csi-u", "modifyOtherKeys"],
    kittyKeyboard: true,
    alternateScreen: true,
    cursorPositioning: true,
    shiftEnter: false,
    multilineFallbacks: ["ctrl-j", "backslash-enter"],
    ...overrides,
  };
}

describe("terminal interaction modes", () => {
  it("enables modifyOtherKeys but keeps mouse tracking off on the main screen", () => {
    expect(resolveTerminalInteractionModes({ capability: capability(), env: {} })).toEqual({
      kittyKeyboard: true,
      modifyOtherKeys: true,
      mouseTracking: false,
    });
  });

  it("requires app-owned screen mode before enabling mouse tracking", () => {
    expect(
      resolveTerminalInteractionModes({
        capability: capability(),
        env: { LINGHUN_TUI_MOUSE: "1" },
      }).mouseTracking,
    ).toBe(false);
    expect(
      resolveTerminalInteractionModes({
        capability: capability(),
        env: { LINGHUN_TUI_MOUSE: "1" },
        appOwnedScreen: true,
      }).mouseTracking,
    ).toBe(true);
    expect(
      resolveTerminalInteractionModes({
        capability: capability({ alternateScreen: false }),
        env: { LINGHUN_TUI_MOUSE: "1" },
        appOwnedScreen: true,
      }).mouseTracking,
    ).toBe(false);
  });

  it("enables app-owned wheel tracking by default", () => {
    expect(
      resolveTerminalInteractionModes({
        capability: capability(),
        env: {},
        appOwnedScreen: true,
      }).mouseTracking,
    ).toBe(true);
  });

  it("keeps mouse tracking off when the Ink shell is not using an app-owned screen", () => {
    expect(
      resolveTerminalInteractionModes({
        capability: capability(),
        env: { LINGHUN_TUI_MOUSE: "1" },
        appOwnedScreen: false,
      }).mouseTracking,
    ).toBe(false);
  });

  it("allows disabling app-owned wheel tracking explicitly", () => {
    expect(
      resolveTerminalInteractionModes({
        capability: capability(),
        env: { LINGHUN_TUI_MOUSE: "0" },
        appOwnedScreen: true,
      }).mouseTracking,
    ).toBe(false);
  });

  it("does not enable keyboard protocols when the terminal is not allowlisted", () => {
    expect(
      resolveTerminalInteractionModes({
        capability: capability({ keyboardProtocols: [], kittyKeyboard: false }),
        env: {},
      }),
    ).toEqual({
      kittyKeyboard: false,
      modifyOtherKeys: false,
      mouseTracking: false,
    });
  });

  it("writes enable and restore sequences in stable order", () => {
    let output = "";
    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    });
    const modes = { kittyKeyboard: true, modifyOtherKeys: true, mouseTracking: true };

    enableTerminalInteractionModes(stdout, modes);
    disableTerminalInteractionModes(stdout, modes);

    expect(output).toBe(
      `${ENABLE_KITTY_KEYBOARD}${ENABLE_MODIFY_OTHER_KEYS}${ENABLE_SGR_MOUSE}${DISABLE_SGR_MOUSE}${DISABLE_MODIFY_OTHER_KEYS}${DISABLE_KITTY_KEYBOARD}`,
    );
  });
});
