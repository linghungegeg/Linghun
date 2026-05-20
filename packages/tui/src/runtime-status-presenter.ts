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
  gate: "waiting confirmation" | "none";
};

export function formatRuntimeStatusLine(view: RuntimeStatusView, language: Language): string {
  const cache = formatPercent(view.cacheHitRate);
  const provider = truncateDisplay(view.provider, 14);
  const model = truncateDisplay(view.model, 20);
  const endpointProfile = truncateDisplay(view.endpointProfile, 16);
  const reasoning = truncateDisplay(view.reasoningStatus, 8);
  const session = truncateDisplay(view.session, 8);
  const mode = truncateDisplay(view.mode, 8);
  const index = truncateDisplay(view.indexStatus, 10);
  const gate = view.gate === "waiting confirmation" ? "waiting" : "none";
  const line =
    language === "en-US"
      ? `Status: session=${session} provider=${provider} model=${model} endpointProfile=${endpointProfile} reasoning=${reasoning} cache ${cache} · index ${index} · mode=${mode} bg=${view.background} gate=${gate}`
      : `[Linghun] 会话=${session} provider=${provider} 模型=${model} endpointProfile=${endpointProfile} 推理=${reasoning} cache ${cache} · index ${index} · 模式=${mode} 后台=${view.background} gate=${gate}`;
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
