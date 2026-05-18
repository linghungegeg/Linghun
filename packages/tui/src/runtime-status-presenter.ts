import type { Language, PermissionMode } from "@linghun/shared";

export type RuntimeStatusView = {
  session: string;
  provider: string;
  model: string;
  reasoningStatus: string;
  mode: PermissionMode;
  background: number;
  cacheHitRate: number | null;
  indexStatus: string;
  gate: "waiting confirmation" | "none";
};

export function formatRuntimeStatusLine(view: RuntimeStatusView, language: Language): string {
  const cache = formatPercent(view.cacheHitRate);
  const model = truncateDisplay(view.model, 24);
  const reasoning = truncateDisplay(view.reasoningStatus, 12);
  const session = truncateDisplay(view.session, 8);
  const line =
    language === "en-US"
      ? `Status: session=${session} model=${model} reasoning=${reasoning} mode=${view.mode} bg=${view.background} cache ${cache} · index ${view.indexStatus} · gate ${view.gate}`
      : `[Linghun] 会话=${session} 模型=${model} 推理=${reasoning} 模式=${view.mode} 后台=${view.background} cache ${cache} · index ${view.indexStatus} · gate ${view.gate}`;
  return truncateDisplay(line, 120);
}

function formatPercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "n/a";
  return `${Math.round(value * 100)}%`;
}

function truncateDisplay(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}
