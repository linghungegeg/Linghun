export const LINGHUN_NAME = "Linghun";
export const LINGHUN_CLI_NAME = "linghun";
export const LINGHUN_VERSION = "0.1.0";

export type Language = "zh-CN" | "en-US";

export type PermissionMode = "default" | "auto-review" | "plan" | "full-access";
export type LegacyPermissionMode = "acceptEdits" | "dontAsk" | "auto" | "bypass";
export type RawPermissionMode = PermissionMode | LegacyPermissionMode;

export function normalizePermissionMode(mode: RawPermissionMode): PermissionMode {
  if (mode === "acceptEdits" || mode === "auto") return "auto-review";
  if (mode === "bypass") return "full-access";
  if (mode === "dontAsk") return "default";
  return mode;
}

export function isRawPermissionMode(value: unknown): value is RawPermissionMode {
  return (
    value === "default" ||
    value === "auto-review" ||
    value === "plan" ||
    value === "full-access" ||
    value === "acceptEdits" ||
    value === "dontAsk" ||
    value === "auto" ||
    value === "bypass"
  );
}
