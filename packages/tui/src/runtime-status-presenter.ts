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
  const model = truncateDisplay(sanitizeStatusValue(view.model), 24);
  const mode = formatPermissionModeLabel(view.mode, language);
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
      ? `Status: Session ${session} · Model ${model} · Mode ${mode} · Gate ${gate} · BG ${view.background}`
      : `[Linghun] 会话 ${session} · 模型 ${model} · 模式 ${mode} · 确认 ${gate} · 后台 ${view.background}`;
  return truncateDisplay(line, 100);
}

export function formatPermissionModeLabel(mode: PermissionMode, language: Language): string {
  if (language === "en-US") {
    const labels: Record<PermissionMode, string> = {
      default: "confirm risky",
      "auto-review": "review edits",
      plan: "plan only",
      "full-access": "local opt-in",
    };
    return labels[mode] ?? mode;
  }
  const labels: Record<PermissionMode, string> = {
    default: "风险确认",
    "auto-review": "低风险顺滑",
    plan: "只规划",
    "full-access": "本地放宽",
  };
  return labels[mode] ?? mode;
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
