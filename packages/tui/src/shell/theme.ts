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
  background: string | undefined;
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
  /** Phase 11 — semantic color layers (CCB-aligned). */
  subtle: string | undefined;
  inactive: string | undefined;
  suggestion: string | undefined;
  /** Phase 1 output-maturity — diff semantic colors. */
  diffAdded: string | undefined;
  diffRemoved: string | undefined;
  diffAddedWord: string | undefined;
  diffRemovedWord: string | undefined;
  /** Phase 1 output-maturity — tool execution state color. */
  toolRunning: string | undefined;
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
      background: undefined,
      subtle: undefined,
      inactive: undefined,
      suggestion: undefined,
      diffAdded: undefined,
      diffRemoved: undefined,
      diffAddedWord: undefined,
      diffRemovedWord: undefined,
      toolRunning: undefined,
    };
  }
  if (mode === "light") {
    return {
      mode: "color",
      brand: "black",
      accent: "blue",
      muted: "#777777",
      border: "#bbbbbb",
      warning: "red",
      userBackground: "#eeeeee",
      status: {
        info: "blue",
        running: "yellow",
        pass: "green",
        partial: "yellow",
        fail: "red",
        blocked: "yellow",
      },
      assistantText: "black",
      dim: "#999999",
      panel: "#f5f5f5",
      permission: "magenta",
      help: "blue",
      diagnostic: "blue",
      notification: "#5a6a7a",
      success: "green",
      error: "#d32f2f",
      inlineCode: "#555555",
      subtle: "#aaaaaa",
      inactive: "#666666",
      suggestion: "blue",
      background: "white",
      diffAdded: "#d4edda",
      diffRemoved: "#f8d7da",
      diffAddedWord: "#28a745",
      diffRemovedWord: "#dc3545",
      toolRunning: "#b8860b",
    };
  }
  return {
    mode: "color",
    brand: "white",
    accent: "cyan",
    muted: "#999999",
    border: "#444444",
    warning: "redBright",
    userBackground: "#363636",
    status: {
      info: "cyan",
      running: "yellow",
      pass: "green",
      partial: "yellow",
      fail: "red",
      blocked: "yellow",
    },
    assistantText: undefined,
    dim: "#888888",
    panel: "#333333",
    permission: "magentaBright",
    help: "blueBright",
    diagnostic: "cyan",
    notification: "#7a8a9a",
    success: "green",
    error: "#ff6b80",
    inlineCode: "#b0b0b0",
    subtle: "#555555",
    inactive: "#666666",
    suggestion: "blueBright",
    background: undefined,
    diffAdded: "#1a3d1a",
    diffRemoved: "#3d1a1a",
    diffAddedWord: "#2ea043",
    diffRemovedWord: "#f85149",
    toolRunning: "#d4a72c",
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
