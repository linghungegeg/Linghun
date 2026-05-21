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
  const mode = truncateDisplay(view.mode, 8);
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
      ? `Status: session=${session} · mode=${mode} · gate=${gate} · bg=${view.background}`
      : `[Linghun] 会话=${session} · 模式=${mode} · 确认=${gate} · 后台=${view.background}`;
  return truncateDisplay(line, 100);
}

function truncateDisplay(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}
