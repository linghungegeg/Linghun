export const LINGHUN_NAME = "Linghun";
export const LINGHUN_CLI_NAME = "linghun";
export const LINGHUN_VERSION = "0.1.17";
export const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";
export const CODEBASE_MEMORY_COMMAND = "codebase-memory-mcp";
export const CODEBASE_MEMORY_ENV = "LINGHUN_CODEBASE_MEMORY_MCP";
export const TOGGLE_DETAILS_KEYBIND = "Ctrl+O";

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

// MiniMax exposes OpenAI-compatible and Anthropic-compatible endpoints, each with a
// global (minimax.io) and a mainland-China (minimaxi.com) host. A provider keeps a single
// active base URL, so these named constants back the config defaults and env template.
export const DEFAULT_MINIMAX_BASE_URL = "https://api.minimax.io/v1";
export const DEFAULT_MINIMAX_ANTHROPIC_BASE_URL = "https://api.minimax.io/anthropic";
export const DEFAULT_MINIMAX_CN_BASE_URL = "https://api.minimaxi.com/v1";
export const DEFAULT_MINIMAX_CN_ANTHROPIC_BASE_URL = "https://api.minimaxi.com/anthropic";

export const MINIMAX_API_MODELS = ["MiniMax-M3", "MiniMax-M2.7"] as const;
export type MiniMaxApiModel = (typeof MINIMAX_API_MODELS)[number];

export function isMiniMaxApiModel(model: string): model is MiniMaxApiModel {
  return (MINIMAX_API_MODELS as readonly string[]).includes(model);
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

export function canonicalPathKeyForCompare(
  path: string,
  caseInsensitive = process.platform === "win32",
): string {
  const normalized = canonicalPathForCompare(path.trim(), caseInsensitive).replace(/\/+/g, "/");
  return normalized.length > 1 ? normalized.replace(/\/+$/u, "") : normalized;
}

export function pathsReferToSameLocation(
  actualPath: string,
  targetPath: string,
  caseInsensitive = process.platform === "win32",
): boolean {
  return (
    canonicalPathKeyForCompare(actualPath, caseInsensitive) ===
    canonicalPathKeyForCompare(targetPath, caseInsensitive)
  );
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

export function redactCommonSecrets(value: string): string {
  return value
    .replace(
      /(api[_-]?key|apiKey|token|Authorization)(\s*[:=]\s*)(Bearer\s+)?[^\s;&,)}\]]+/giu,
      (_match, key: string, sep: string) => `${key}${sep}***`,
    )
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/giu, "Bearer ***")
    .replace(/sk-[A-Za-z0-9_-]+/gu, "sk-***");
}

export function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export function isNodeErrorWithCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

export function formatDiagnosticError(error: unknown): string {
  return error instanceof Error ? error.message.replace(/\s+/g, " ").trim() : String(error);
}
