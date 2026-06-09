import type { TerminalCapability } from "./terminal-capability.js";
import type { ProductBlockStatus, ShellThemeMode } from "./types.js";

export type ShellTheme = {
  mode: ShellThemeMode;
  brand: string | undefined;
  accent: string | undefined;
  muted: string | undefined;
  border: string | undefined;
  warning: string | undefined;
  userBackground: string | undefined;
  status: Record<ProductBlockStatus, string | undefined>;
  assistantText: string | undefined;
  dim: string | undefined;
  panel: string | undefined;
  permission: string | undefined;
  help: string | undefined;
  diagnostic: string | undefined;
  notification: string | undefined;
  success: string | undefined;
  error: string | undefined;
  inlineCode: string | undefined;
};

export function createShellTheme(
  noColor: boolean,
  mode: "dark" | "light" = resolveShellThemeMode(),
): ShellTheme {
  if (noColor) {
    return {
      mode: "no-color",
      brand: undefined,
      accent: undefined,
      muted: undefined,
      border: undefined,
      warning: undefined,
      userBackground: undefined,
      status: {
        info: undefined,
        running: undefined,
        pass: undefined,
        partial: undefined,
        fail: undefined,
        blocked: undefined,
      },
      assistantText: undefined,
      dim: undefined,
      panel: undefined,
      permission: undefined,
      help: undefined,
      diagnostic: undefined,
      notification: undefined,
      success: undefined,
      error: undefined,
      inlineCode: undefined,
    };
  }
  if (mode === "light") {
    return {
      mode: "color",
      brand: "black",
      accent: "blue",
      muted: "gray",
      border: "gray",
      warning: "red",
      userBackground: "gray",
      status: {
        info: "blue",
        running: "yellow",
        pass: "green",
        partial: "yellow",
        fail: "red",
        blocked: "yellow",
      },
      assistantText: "black",
      dim: "gray",
      panel: "gray",
      permission: "magenta",
      help: "blue",
      diagnostic: "blue",
      notification: "gray",
      success: "green",
      error: "red",
      inlineCode: "gray",
    };
  }
  return {
    mode: "color",
    brand: "white",
    accent: "cyan",
    muted: "gray",
    border: "gray",
    warning: "redBright",
    userBackground: "gray",
    status: {
      info: "cyan",
      running: "yellow",
      pass: "green",
      partial: "yellow",
      fail: "red",
      blocked: "yellow",
    },
    assistantText: undefined,
    dim: "gray",
    panel: "gray",
    permission: "magenta",
    help: "blueBright",
    diagnostic: "cyan",
    notification: "gray",
    success: "green",
    error: "red",
    inlineCode: "gray",
  };
}

function resolveShellThemeMode(): "dark" | "light" {
  const raw = process.env.LINGHUN_THEME?.trim().toLowerCase();
  return raw === "light" ? "light" : "dark";
}

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
    info: "●",
    running: "○",
    pass: "✓",
    partial: "◒",
    fail: "✗",
    blocked: "■",
  };
  return unicodeLabels[status];
}
