import type { ProductBlockStatus, ShellThemeMode } from "./types.js";

export type ShellTheme = {
  mode: ShellThemeMode;
  brand: string;
  accent: string;
  muted: string;
  border: string;
  warning: string;
  status: Record<ProductBlockStatus, string>;
};

export function createShellTheme(noColor: boolean): ShellTheme {
  if (noColor) {
    return {
      mode: "no-color",
      brand: "white",
      accent: "white",
      muted: "white",
      border: "white",
      warning: "white",
      status: {
        info: "white",
        running: "white",
        pass: "white",
        partial: "white",
        fail: "white",
        blocked: "white",
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

export function getStatusMarker(status: ProductBlockStatus, noColor: boolean): string {
  const labels: Record<ProductBlockStatus, string> = {
    info: noColor ? "[INFO]" : "●",
    running: noColor ? "[RUN]" : "●",
    pass: noColor ? "[OK]" : "●",
    partial: noColor ? "[PARTIAL]" : "●",
    fail: noColor ? "[FAIL]" : "●",
    blocked: noColor ? "[BLOCKED]" : "●",
  };
  return labels[status];
}
