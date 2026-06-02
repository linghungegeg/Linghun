export const LINGHUN_NAME = "Linghun";
export const LINGHUN_CLI_NAME = "linghun";
export const LINGHUN_VERSION = "0.1.0";

export const DEEPSEEK_API_MODELS = ["deepseek-chat", "deepseek-reasoner"] as const;
export type DeepSeekApiModel = (typeof DEEPSEEK_API_MODELS)[number];

export const DEEPSEEK_LEGACY_MODEL_ALIASES: Readonly<Record<string, DeepSeekApiModel>> = {
  "deepseek-v4-flash": "deepseek-chat",
  "deepseek-v4-pro": "deepseek-reasoner",
};

export function normalizeDeepSeekModelName(model: string): string {
  return DEEPSEEK_LEGACY_MODEL_ALIASES[model] ?? model;
}

export function isDeepSeekApiModel(model: string): model is DeepSeekApiModel {
  return (DEEPSEEK_API_MODELS as readonly string[]).includes(model);
}

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

export function normalizePathSeparators(path: string): string {
  return path.replaceAll("\\", "/");
}

export function canonicalPathForCompare(
  path: string,
  caseInsensitive = process.platform === "win32",
): string {
  const normalized = normalizePathSeparators(path);
  return caseInsensitive ? normalized.toLowerCase() : normalized;
}

export function isPathInside(
  candidatePath: string,
  rootPath: string,
  caseInsensitive = process.platform === "win32",
): boolean {
  const candidate = canonicalPathForCompare(candidatePath, caseInsensitive);
  const root = canonicalPathForCompare(rootPath, caseInsensitive);
  if (candidate === root) return true;
  const rootWithSlash = root.endsWith("/") ? root : `${root}/`;
  return candidate.startsWith(rootWithSlash);
}
