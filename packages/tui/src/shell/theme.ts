import type { TerminalCapability } from "./terminal-capability.js";
import type { ProductBlockStatus, ShellThemeMode } from "./types.js";

export type ShellTheme = {
  mode: ShellThemeMode;
  brand: string | undefined;
  accent: string | undefined;
  muted: string | undefined;
  border: string | undefined;
  warning: string | undefined;
  status: Record<ProductBlockStatus, string | undefined>;
};

export function createShellTheme(noColor: boolean): ShellTheme {
  if (noColor) {
    return {
      mode: "no-color",
      brand: undefined,
      accent: undefined,
      muted: undefined,
      border: undefined,
      warning: undefined,
      status: {
        info: undefined,
        running: undefined,
        pass: undefined,
        partial: undefined,
        fail: undefined,
        blocked: undefined,
      },
    };
  }
  return {
    mode: "color",
    brand: "white",
    accent: "cyan",
    muted: "gray",
    border: "gray",
    warning: "redBright",
    status: {
      info: "cyan",
      running: "yellow",
      pass: "green",
      partial: "yellow",
      fail: "red",
      blocked: "yellow",
    },
  };
}

/**
 * Status marker for product blocks.
 * Uses ASCII labels on legacy/no-color terminals, Unicode dots on modern terminals.
 */
export function getStatusMarker(
  status: ProductBlockStatus,
  noColor: boolean,
  capability?: TerminalCapability,
): string {
  const useAscii = noColor || (capability ? !capability.unicodeBox : false);

  if (useAscii) {
    const asciiLabels: Record<ProductBlockStatus, string> = {
      info: "[INFO]",
      running: "[..]",
      pass: "[OK]",
      partial: "[PARTIAL]",
      fail: "[FAIL]",
      blocked: "[BLOCKED]",
    };
    return asciiLabels[status];
  }

  const unicodeLabels: Record<ProductBlockStatus, string> = {
    info: "\u25CF",
    running: "\u25CB",
    pass: "\u2713",
    partial: "\u25D2",
    fail: "\u2717",
    blocked: "\u25A0",
  };
  return unicodeLabels[status];
}
