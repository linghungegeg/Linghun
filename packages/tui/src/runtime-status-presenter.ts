import type { Language, PermissionMode } from "@linghun/shared";

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
};

export function formatRuntimeStatusLine(view: RuntimeStatusView, language: Language): string {
  const session = truncateDisplay(view.session, 8);
  const model = truncateDisplay(sanitizeStatusValue(view.model), 20);
  const mode = formatPermissionModeLabel(view.mode, language);
  const cache = formatCacheHitRate(view.cacheHitRate, language);
  const index = formatIndexStatus(view.indexStatus, language);
  const gate =
    view.gate === "waiting approval"
      ? language === "en-US"
        ? "approval"
        : "待批准"
      : view.gate === "waiting confirmation"
        ? language === "en-US"
          ? "waiting"
          : "待确认"
        : language === "en-US"
          ? "none"
          : "无";
  const line =
    language === "en-US"
      ? `Status: Session ${session} · Model ${model} · Mode ${mode} · ${cache} · ${index} · Gate ${gate} · BG ${view.background}`
      : `[Linghun] 会话 ${session} · 模型 ${model} · 模式 ${mode} · ${cache} · ${index} · 确认 ${gate} · 后台 ${view.background}`;
  return truncateDisplay(line, 100);
}

export function formatPermissionModeLabel(mode: PermissionMode, language: Language): string {
  if (language === "en-US") {
    const labels: Record<PermissionMode, string> = {
      default: "default mode",
      "auto-review": "auto mode",
      plan: "plan mode",
      "full-access": "bypass approvals",
    };
    return labels[mode] ?? mode;
  }
  const labels: Record<PermissionMode, string> = {
    default: "默认模式",
    "auto-review": "自动模式",
    plan: "计划模式",
    "full-access": "跳过审批",
  };
  return labels[mode] ?? mode;
}

function formatCacheHitRate(hitRate: number | null, language: Language): string {
  const label = language === "en-US" ? "Cache" : "缓存";
  if (hitRate === null) return `${label}?`;
  const percent = Math.max(0, Math.min(100, Math.round(hitRate * 100)));
  return `${label} ${percent}%`;
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

function truncateDisplay(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}
