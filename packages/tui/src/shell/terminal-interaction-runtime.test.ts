import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import type { TerminalCapability } from "./terminal-capability.js";
import {
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
  it("keeps mouse tracking off on the main screen by default", () => {
    expect(resolveTerminalInteractionModes({ capability: capability(), env: {} })).toEqual({
      kittyKeyboard: true,
      modifyOtherKeys: true,
      mouseTracking: false,
      focusEvents: false,
      bracketedPaste: false,
    });
  });

  it("requires cursor-positioning terminal capability before enabling mouse tracking", () => {
    expect(
      resolveTerminalInteractionModes({
        capability: capability({ cursorPositioning: false }),
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

  it("does not enable wheel tracking when the Ink shell is not using an app-owned screen", () => {
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
      focusEvents: false,
      bracketedPaste: false,
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
    const modes = {
      kittyKeyboard: true,
      modifyOtherKeys: true,
      mouseTracking: true,
      focusEvents: true,
      bracketedPaste: true,
    };

    enableTerminalInteractionModes(stdout, modes);
    disableTerminalInteractionModes(stdout, modes);

    expect(ENABLE_SGR_MOUSE).toBe("\x1B[?1000h\x1B[?1002h\x1B[?1003h\x1B[?1006h");
    expect(DISABLE_SGR_MOUSE).toBe("\x1B[?1006l\x1B[?1003l\x1B[?1002l\x1B[?1000l");
    expect(output).toBe(
      `${ENABLE_KITTY_KEYBOARD}${ENABLE_MODIFY_OTHER_KEYS}${ENABLE_SGR_MOUSE}${ENABLE_FOCUS_EVENTS}${ENABLE_BRACKETED_PASTE}${DISABLE_BRACKETED_PASTE}${DISABLE_FOCUS_EVENTS}${DISABLE_SGR_MOUSE}${DISABLE_MODIFY_OTHER_KEYS}${DISABLE_KITTY_KEYBOARD}`,
    );
  });

  it("reasserts enabled modes without disabling them", () => {
    let output = "";
    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    });
    const modes = {
      kittyKeyboard: false,
      modifyOtherKeys: false,
      mouseTracking: true,
      focusEvents: true,
      bracketedPaste: true,
    };

    reassertTerminalInteractionModes(stdout, modes);

    expect(output).toBe(`${ENABLE_SGR_MOUSE}${ENABLE_FOCUS_EVENTS}${ENABLE_BRACKETED_PASTE}`);
  });

  it("session disables once and reasserts only while enabled", () => {
    let output = "";
    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    });
    const modes = {
      kittyKeyboard: false,
      modifyOtherKeys: false,
      mouseTracking: true,
      focusEvents: false,
      bracketedPaste: true,
    };
    const session = createTerminalInteractionSession(stdout, modes);

    session.reassert();
    session.enable();
    session.reassert();
    session.disable();
    session.disable();

    expect(output).toBe(
      `${ENABLE_SGR_MOUSE}${ENABLE_BRACKETED_PASTE}${ENABLE_SGR_MOUSE}${ENABLE_BRACKETED_PASTE}${DISABLE_BRACKETED_PASTE}${DISABLE_SGR_MOUSE}`,
    );
  });

  it("binds suspend and resume cleanup without leaving duplicate listeners", () => {
    let output = "";
    const events = new Map<string, () => void>();
    const killed: string[] = [];
    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    });
    const modes = {
      kittyKeyboard: false,
      modifyOtherKeys: false,
      mouseTracking: true,
      focusEvents: true,
      bracketedPaste: true,
    };
    const session = createTerminalInteractionSession(stdout, modes);
    const binding = bindTerminalInteractionSignals(
      {
        platform: "linux",
        pid: 123,
        on: (event: string, listener: () => void) => {
          events.set(event, listener);
        },
        off: (event: string, listener: () => void) => {
          if (events.get(event) === listener) events.delete(event);
        },
        kill: (_pid: number, signal: string) => {
          killed.push(signal);
        },
      },
      session,
    );

    session.enable();
    binding.suspend();
    expect(events.has("SIGTSTP")).toBe(false);
    expect(killed).toEqual(["SIGTSTP"]);
    binding.resume();
    expect(events.has("SIGTSTP")).toBe(true);
    binding.dispose();
    expect(events.size).toBe(0);

    expect(output).toBe(
      `${ENABLE_SGR_MOUSE}${ENABLE_FOCUS_EVENTS}${ENABLE_BRACKETED_PASTE}${DISABLE_BRACKETED_PASTE}${DISABLE_FOCUS_EVENTS}${DISABLE_SGR_MOUSE}${ENABLE_SGR_MOUSE}${ENABLE_FOCUS_EVENTS}${ENABLE_BRACKETED_PASTE}`,
    );
  });
});
