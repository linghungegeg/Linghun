import type { Language } from "@linghun/shared";
import { truncateMiddle } from "../text-utils.js";
import type { TaskFooterView } from "../types.js";

/**
 * D.13Q-UX — footer-view 纯函数模型
 *
 * 把 ShellApp.TaskFooter 的字段计算从 view-model.ts 抽出来：
 * - 区分 "未配置" / "正常 model" / "stale 占位"，避免 footer 显示
 *   `model deepseek-chat` 这类兜底占位（resolveInitialModel 在
 *   default route 未配置时会回退到 deepseek 配置）。
 * - 保留旧的字段（permissionMode / model / cache / index / cyclePermHint /
 *   reasoning / hint），不破坏 ShellApp.TaskFooter 渲染。
 * - 输出可直接给 NotificationStack 用的"低 cache 命中"轻提示（cache pill 自身
 *   仍在 footer 内，notification 是补充）。
 *
 * 调用方在 setupNeeded=true 时传 model="setup-needed"（语义化标记），本模块
 * 把它格式化为 dim `--` 占位，让 stale deepseek-chat 不再出现在主屏。
 */

export type FooterViewInput = {
  language: Language;
  width: number;
  permissionModeLabel: string;
  cyclePermHint: string;
  /**
   * effective runtime model 名（来自 getSelectedModelRuntime(context).model 或
   * context.model）。若为空字符串 / "unknown" / "setup-needed"，footer 显示
   * dim `--`，避免 stale 占位（如 deepseek-chat 兜底）流到主屏。
   */
  effectiveModel: string | undefined;
  /** 是否是 setup-needed / unconfigured 状态。 */
  setupNeeded: boolean;
  /** cache 命中率 0..1。null 表示未知。 */
  cacheHitRate: number | null;
  /** index 状态字符串。 */
  indexStatus: string;
  /** reasoning level 文本（"High" 等）；空表示不显示 reasoning 段。 */
  reasoningLevel?: string;
  /** reasoning 是否真的发送给 provider；false 时不在 footer 露出。 */
  reasoningSent?: boolean;
  /** 本会话累计估算费用；NaN/undefined 表示未知，不显示。 */
  estimatedCostCny?: number;
  /** 上下文利用率短标签，例如 "上下文 15.0% (12k/80k)"。 */
  contextUsageLabel?: string;
  /** 可选短 hint。 */
  hint?: string;
};

const SETUP_PLACEHOLDER_VALUES = new Set([
  "",
  "unknown",
  "setup-needed",
  "openai-compatible-model",
]);

/**
 * 把 effectiveModel 规整成 footer 显示值；setup-needed / unknown / 占位
 * 时返回 dim `--` 标记。调用方在渲染时按返回值决定是否染 dim。
 */
export function formatFooterModelLabel(
  language: Language,
  effectiveModel: string | undefined,
  setupNeeded: boolean,
  width: number,
): { text: string; dim: boolean } {
  const label = language === "en-US" ? "model" : "模型";
  const trimmed = (effectiveModel ?? "").trim();
  const isPlaceholder =
    setupNeeded || SETUP_PLACEHOLDER_VALUES.has(trimmed.toLowerCase()) || trimmed.length === 0;
  if (isPlaceholder) {
    return { text: `${label} --`, dim: true };
  }
  const max = width <= 60 ? 12 : 22;
  return { text: `${label} ${truncateMiddle(trimmed, max)}`, dim: false };
}

export function formatFooterCacheLabel(
  language: Language,
  hitRate: number | null,
): { text: string; tone: "default" | "warning" | "dim" } {
  const label = language === "en-US" ? "cache" : "缓存";
  if (hitRate === null || hitRate === undefined) {
    return { text: `${label}?`, tone: "dim" };
  }
  const percent = Math.max(0, Math.min(100, Math.round(hitRate * 100)));
  const tone: "default" | "warning" = percent < 50 ? "warning" : "default";
  return { text: `${label} ${percent}%`, tone };
}

export function formatFooterIndexLabel(language: Language, status: string): string {
  const label = language === "en-US" ? "Index" : "索引";
  const trimmed = (status ?? "").trim();
  if (!trimmed || trimmed.toLowerCase() === "unknown") {
    return language === "en-US" ? "Index?" : "索引?";
  }
  return `${label} ${truncateMiddle(trimmed, 10)}`;
}

export function formatFooterReasoningLabel(
  language: Language,
  level: string | undefined,
  sent: boolean | undefined,
): string | undefined {
  if (!level) return undefined;
  if (sent === false) return undefined;
  const trimmed = level.trim();
  if (!trimmed) return undefined;
  const label = language === "en-US" ? "Reasoning" : "推理";
  return `${label} ${truncateMiddle(trimmed, 12)}`;
}

export function formatFooterCostLabel(
  language: Language,
  estimatedCostCny: number | undefined,
): string | undefined {
  if (!Number.isFinite(estimatedCostCny)) return undefined;
  const label = language === "en-US" ? "cost" : "费用";
  return `${label} ¥${Math.max(0, estimatedCostCny ?? 0).toFixed(4)} est`;
}

/**
 * 主入口：把所有 footer 字段算出来。返回 TaskFooterView 与 model placeholder
 * 标志（用来让 StatusFooter 把 model 段染 dim）。
 */
export function buildFooterView(input: FooterViewInput): {
  view: TaskFooterView;
  modelDim: boolean;
  cacheTone: "default" | "warning" | "dim";
} {
  const modelInfo = formatFooterModelLabel(
    input.language,
    input.effectiveModel,
    input.setupNeeded,
    input.width,
  );
  const cacheInfo = formatFooterCacheLabel(input.language, input.cacheHitRate);
  const indexLabel = formatFooterIndexLabel(input.language, input.indexStatus);
  const reasoningLabel = formatFooterReasoningLabel(
    input.language,
    input.reasoningLevel,
    input.reasoningSent,
  );
  const costLabel = formatFooterCostLabel(input.language, input.estimatedCostCny);
  return {
    view: {
      permissionMode: input.permissionModeLabel,
      model: modelInfo.text,
      cache: cacheInfo.text,
      index: indexLabel,
      cyclePermHint: input.cyclePermHint,
      reasoning: reasoningLabel,
      cost: costLabel,
      contextUsage: input.contextUsageLabel,
      hint: input.hint,
      modelDim: modelInfo.dim,
      cacheTone: cacheInfo.tone,
    },
    modelDim: modelInfo.dim,
    cacheTone: cacheInfo.tone,
  };
}
