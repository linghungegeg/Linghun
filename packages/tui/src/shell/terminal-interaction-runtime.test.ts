import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  DISABLE_MODIFY_OTHER_KEYS,
  DISABLE_SGR_MOUSE,
  ENABLE_MODIFY_OTHER_KEYS,
  ENABLE_SGR_MOUSE,
  disableTerminalInteractionModes,
  enableTerminalInteractionModes,
  resolveTerminalInteractionModes,
} from "./terminal-interaction-runtime.js";
import type { TerminalCapability } from "./terminal-capability.js";

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
    shiftEnter: true,
    multilineFallbacks: ["ctrl-j", "alt-enter", "backslash-enter"],
    ...overrides,
  };
}

describe("terminal interaction modes", () => {
  it("enables modifyOtherKeys and mouse tracking for modern terminals", () => {
    expect(resolveTerminalInteractionModes({ capability: capability(), env: {} })).toEqual({
      modifyOtherKeys: true,
      mouseTracking: true,
    });
  });

  it("respects explicit mouse env overrides", () => {
    expect(
      resolveTerminalInteractionModes({
        capability: capability({ tier: "legacy" }),
        env: { LINGHUN_TUI_MOUSE: "1" },
      }).mouseTracking,
    ).toBe(true);
    expect(
      resolveTerminalInteractionModes({
        capability: capability(),
        env: { LINGHUN_TUI_MOUSE: "0" },
      }).mouseTracking,
    ).toBe(false);
  });

  it("writes enable and restore sequences in stable order", () => {
    let output = "";
    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    });
    const modes = { modifyOtherKeys: true, mouseTracking: true };

    enableTerminalInteractionModes(stdout, modes);
    disableTerminalInteractionModes(stdout, modes);

    expect(output).toBe(
      `${ENABLE_MODIFY_OTHER_KEYS}${ENABLE_SGR_MOUSE}${DISABLE_SGR_MOUSE}${DISABLE_MODIFY_OTHER_KEYS}`,
    );
  });
});
