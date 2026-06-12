import type { Language, PermissionMode } from "@linghun/shared";
import { formatContextProgressBar } from "./context-window-runtime.js";
import { truncateDisplay } from "./startup-runtime.js";

export type RuntimeStatusView = {
  session: string;
  provider: string;
  model: string;
  endpointProfile: string;
  reasoningStatus: string;
  mode: PermissionMode;
  background: number;
  cacheHitRate: number | null;
  indexStatus: string;
  gate: "waiting approval" | "waiting confirmation" | "none";
  contextUsage?: { usedTokens: number; maxTokens: number };
};

export function formatRuntimeStatusLine(view: RuntimeStatusView, language: Language): string {
  const model = truncateDisplay(sanitizeStatusValue(view.model), 20);
  const mode = formatPermissionModeLabel(view.mode, language);
  const cache = formatCacheHitRate(view.cacheHitRate, language);
  const contextUsage = view.contextUsage ? formatContextUsage(view.contextUsage, language) : undefined;
  const index = formatIndexStatus(view.indexStatus, language);
  const waitState =
    view.gate === "waiting approval"
      ? language === "en-US"
        ? "waiting for approval"
        : "待批准"
      : view.gate === "waiting confirmation"
        ? language === "en-US"
          ? "waiting for confirmation"
          : "待确认"
        : undefined;
  const parts =
    language === "en-US"
      ? [`Model ${model}`, `Mode ${mode}`, cache, index, `background ${view.background}`]
      : [`模型 ${model}`, `模式 ${mode}`, cache, index, `后台 ${view.background}`];
  if (contextUsage) {
    parts.splice(3, 0, contextUsage);
  }
  if (waitState) {
    parts.push(language === "en-US" ? waitState : `确认 ${waitState}`);
  }
  const line =
    language === "en-US" ? `Status: ${parts.join(" · ")}` : `[Linghun] ${parts.join(" · ")}`;
  return truncateDisplay(line, 99);
}

export function formatPermissionModeLabel(mode: PermissionMode, language: Language): string {
  if (language === "en-US") {
    const labels: Record<PermissionMode, string> = {
      default: "default mode",
      "auto-review": "auto-review",
      plan: "plan mode",
      "full-access": "full access",
    };
    return labels[mode] ?? mode;
  }
  const labels: Record<PermissionMode, string> = {
    default: "默认模式",
    "auto-review": "自动审核",
    plan: "计划模式",
    "full-access": "完全放行",
  };
  return labels[mode] ?? mode;
}

export function permissionModeSymbol(mode: PermissionMode): string {
  const symbols: Record<PermissionMode, string> = {
    default: "○",    // ○
    "auto-review": "◐", // ◐
    plan: "⏵⏵",  // ⏵⏵
    "full-access": "▲", // ▲
  };
  return symbols[mode] ?? mode;
}

export function permissionModeColor(mode: PermissionMode): string {
  if (mode === "full-access") return "#ff6600";
  if (mode === "plan") return "#00aaff";
  return "";
}

function formatCacheHitRate(hitRate: number | null, language: Language): string {
  const label = language === "en-US" ? "Cache" : "缓存";
  if (hitRate === null) return `${label}?`;
  const percent = Math.max(0, Math.min(100, Math.round(hitRate * 100)));
  return `${label} ${percent}%`;
}

function formatContextUsage(
  usage: RuntimeStatusView["contextUsage"],
  language: Language,
): string {
  const label = language === "en-US" ? "Ctx" : "上下文";
  if (!usage) return `${label}?`;
  const max = Number.isFinite(usage.maxTokens) ? Math.max(1, Math.ceil(usage.maxTokens)) : 1;
  const used = Number.isFinite(usage.usedTokens) ? Math.max(0, Math.ceil(usage.usedTokens)) : 0;
  const ratio = Math.min(1, used / max);
  return `${label} ${formatContextProgressBar(ratio, 8)} ${(ratio * 100).toFixed(0)}%`;
}

function formatIndexStatus(status: string, language: Language): string {
  const label = language === "en-US" ? "Index" : "索引";
  const value = sanitizeStatusValue(status);
  if (!value || value === "unknown") return `${label}?`;
  return `${label} ${truncateDisplay(value, 10)}`;
}

function sanitizeStatusValue(value: string): string {
  return (
    value
      .replace(/[\r\n\t]/gu, " ")
      .replace(/\s+/gu, " ")
      .trim() || "unknown"
  );
}
