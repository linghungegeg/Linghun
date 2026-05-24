import { basename } from "node:path";
import type { Language } from "@linghun/shared";
import type { TuiContext } from "../index.js";
import { formatPermissionModeLabel } from "../runtime-status-presenter.js";
import type { ProductBlockViewModel, ShellViewModel } from "./types.js";

export type ShellViewModelOptions = {
  width?: number;
  noColor?: boolean;
  outputBlocks?: ProductBlockViewModel[];
  setupNeeded?: boolean;
  limitations?: string[];
};

export function createShellViewModel(
  context: TuiContext,
  options: ShellViewModelOptions = {},
): ShellViewModel {
  const language = context.language;
  const width = normalizeWidth(options.width);
  const projectName = truncateMiddle(
    basename(context.projectPath) || context.projectPath,
    width <= 40 ? 18 : 28,
  );
  const setupNeeded = options.setupNeeded ?? false;
  const blocks: ProductBlockViewModel[] = [createHomeBlock(context, projectName, width)];
  if (setupNeeded) {
    blocks.push(createSetupNeededBlock(language));
  }
  blocks.push(...(options.outputBlocks ?? []).slice(-4));

  return {
    language,
    projectName,
    projectPath: context.projectPath,
    width,
    mode: "ink",
    themeMode: options.noColor ? "no-color" : "color",
    homeTitle: language === "en-US" ? "Linghun coding shell" : "Linghun 编程终端",
    homeSummary:
      language === "en-US"
        ? `Workspace ${projectName}. Describe a goal directly; exact commands remain available with /help.`
        : `当前工作区 ${projectName}。可以直接描述目标；需要精确命令时仍可用 /help。`,
    status: {
      model: truncateMiddle(context.model || "unknown", width <= 40 ? 14 : 24),
      mode: formatPermissionModeLabel(context.permissionMode, language),
      trust: formatTrust(context, language),
      index: formatIndex(context.index.status, language),
      cache: formatCache(context.cache.history.at(-1)?.hitRate ?? null, language),
      background: formatBackground(
        context.backgroundTasks.filter((task) => task.status === "running").length,
        language,
      ),
    },
    composer: {
      placeholder: getComposerPlaceholder(language),
      prompt: language === "en-US" ? "you" : "你",
      hint:
        language === "en-US"
          ? "Enter to send · Esc to cancel · / for commands"
          : "Enter 发送 · Esc 取消 · / 查看命令",
      submittedHint:
        language === "en-US"
          ? "Submitted through the shared TUI controller."
          : "已通过同一条 TUI controller 路径提交。",
      masking: context.pendingModelSetup?.step === "apiKey",
    },
    blocks,
    limitations: options.limitations ?? [],
  };
}

export function getComposerPlaceholder(language: Language): string {
  return language === "en-US" ? "What can I help you with?" : "我能帮您做点什么？";
}

export function createOutputBlock(
  text: string,
  language: Language,
  id = `output-${Date.now()}`,
): ProductBlockViewModel {
  const normalized = text.replace(/\r/g, "").trim();
  const firstLine = normalized.split("\n").find((line) => line.trim()) ?? normalized;
  return {
    id,
    kind: "details",
    status: /错误|失败|error|failed/iu.test(normalized) ? "fail" : "info",
    title: language === "en-US" ? "Latest output" : "最近输出",
    summary: truncateMiddle(
      firstLine || (language === "en-US" ? "No visible output." : "没有可见输出。"),
      96,
    ),
    detail: normalized.length > firstLine.length ? truncateBlock(normalized, 320) : undefined,
    nextAction:
      language === "en-US"
        ? "Use /details for full runtime output."
        : "如需完整运行时输出，可用 /details。",
  };
}

function createHomeBlock(
  context: TuiContext,
  projectName: string,
  width: number,
): ProductBlockViewModel {
  const language = context.language;
  return {
    id: "home",
    kind: "home",
    status: "info",
    title: language === "en-US" ? "Home" : "首页",
    summary:
      language === "en-US"
        ? `Project ${projectName} · Model ${truncateMiddle(context.model, width <= 40 ? 14 : 24)} · ready for natural-language tasks.`
        : `项目 ${projectName} · 模型 ${truncateMiddle(context.model, width <= 40 ? 14 : 24)} · 可以直接描述任务。`,
    nextAction:
      language === "en-US"
        ? "Type a goal, or use /help for exact commands."
        : "直接输入目标，或用 /help 查看精确命令。",
  };
}

function createSetupNeededBlock(language: Language): ProductBlockViewModel {
  return {
    id: "setup-needed",
    kind: "setup",
    status: "blocked",
    title: language === "en-US" ? "Model setup needed" : "需要配置模型",
    summary:
      language === "en-US"
        ? "Model connection is incomplete. You can describe setup intent here, open /model setup, or inspect /model doctor."
        : "模型连接尚未完整。可以直接说明要配置模型，也可以用 /model setup，或用 /model doctor 查看详情。",
    nextAction:
      language === "en-US"
        ? "Primary path: describe what provider to configure; recovery path: /model setup."
        : "主路径：直接说明要配置的 provider；恢复入口：/model setup。",
  };
}

function formatTrust(context: TuiContext, language: Language): string {
  if (!context.config.workspaceTrust.recorded) {
    return language === "en-US" ? "trust?" : "信任?";
  }
  return context.config.workspaceTrust.level === "trusted"
    ? language === "en-US"
      ? "trusted"
      : "已信任"
    : language === "en-US"
      ? "restricted"
      : "受限";
}

function formatIndex(status: string, language: Language): string {
  const value = truncateMiddle(status || "unknown", 10);
  return language === "en-US" ? `index ${value}` : `索引 ${value}`;
}

function formatCache(hitRate: number | null, language: Language): string {
  if (hitRate === null) return language === "en-US" ? "cache?" : "缓存?";
  return language === "en-US"
    ? `cache ${Math.round(hitRate * 100)}%`
    : `缓存 ${Math.round(hitRate * 100)}%`;
}

function formatBackground(count: number, language: Language): string {
  return language === "en-US" ? `bg ${count}` : `后台 ${count}`;
}

function normalizeWidth(width: number | undefined): number {
  if (!width || !Number.isFinite(width)) return 80;
  return Math.max(30, Math.floor(width));
}

function truncateBlock(value: string, max: number): string {
  if (displayWidth(value) <= max) return value;
  return `${sliceDisplay(value, Math.max(0, max - 1))}…`;
}

function truncateMiddle(value: string, max: number): string {
  const normalized = String(value || "unknown")
    .replace(/\s+/gu, " ")
    .trim();
  if (displayWidth(normalized) <= max) return normalized;
  if (max <= 1) return "…";
  const head = Math.max(1, Math.floor((max - 1) / 2));
  const tail = Math.max(1, max - head - 1);
  return `${sliceDisplay(normalized, head)}…${sliceDisplayEnd(normalized, tail)}`;
}

function sliceDisplay(value: string, max: number): string {
  let width = 0;
  let result = "";
  for (const char of value) {
    const next = width + charWidth(char);
    if (next > max) break;
    result += char;
    width = next;
  }
  return result;
}

function sliceDisplayEnd(value: string, max: number): string {
  const chars = Array.from(value);
  let width = 0;
  let result = "";
  for (let index = chars.length - 1; index >= 0; index -= 1) {
    const char = chars[index] ?? "";
    const next = width + charWidth(char);
    if (next > max) break;
    result = `${char}${result}`;
    width = next;
  }
  return result;
}

function displayWidth(value: string): number {
  return Array.from(value).reduce((sum, char) => sum + charWidth(char), 0);
}

function charWidth(char: string): number {
  return /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/u.test(
    char,
  )
    ? 2
    : 1;
}
