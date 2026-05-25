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
