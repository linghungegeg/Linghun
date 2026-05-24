import { basename } from "node:path";
import type { Language } from "@linghun/shared";
import type { TuiContext } from "../index.js";
import { formatPermissionModeLabel } from "../runtime-status-presenter.js";
import type { ProductBlockViewModel, ShellViewModel } from "./types.js";

const shellText = {
  "zh-CN": {
    brand: "L I N G H U N",
    vision: "技术普惠会越来越成熟，而你就是最伟大的梦想家。",
    project: (name: string) => `项目：${name}`,
    model: (name: string) => `模型：${name}`,
    permission: (mode: string) => `权限：${mode}`,
    trust: (value: string) => `信任：${value}`,
    placeholder: "我能帮您做点什么？",
    submittedHint: "已通过同一条 TUI controller 路径提交。",
    setupHint:
      "还没有模型配置。按 Enter 开始，或说\u201c我要配置模型\u201d。高级入口：/model setup。",
    routeTitle: "项目模型路由需要处理",
    routeSummary: (problem: string) =>
      `${problem}。这是项目级 route/settings 问题，不要重复填写用户 API key。`,
    routeNextAction: "用 /model doctor 查看详情，或调整本仓库 .linghun/settings.json。",
    trustUnknown: "信任?",
    trustTrusted: "已信任",
    trustRestricted: "受限",
    index: (status: string) => `索引：${status}`,
    background: (count: number) => `后台：${count}`,
    latestOutputTitle: "最近输出",
    noVisibleOutput: "没有可见输出。",
    latestOutputNext: "如需完整运行时输出，可用 /details。",
  },
  "en-US": {
    brand: "L I N G H U N",
    vision: "Technology will become more accessible, and you are the greatest dreamer.",
    project: (name: string) => `Project: ${name}`,
    model: (name: string) => `Model: ${name}`,
    permission: (mode: string) => `Permission: ${mode}`,
    trust: (value: string) => `Trust: ${value}`,
    placeholder: "What can I help you with?",
    submittedHint: "Submitted through the shared TUI controller.",
    setupHint:
      'No model configured. Press Enter to start, or say "configure provider". Advanced: /model setup.',
    routeTitle: "Project model route needs attention",
    routeSummary: (problem: string) =>
      `${problem}. This is a project-scoped route/settings issue; do not re-enter the user API key.`,
    routeNextAction: "Use /model doctor for details, or update this repo's .linghun/settings.json.",
    trustUnknown: "trust?",
    trustTrusted: "trusted",
    trustRestricted: "restricted",
    index: (status: string) => `Index: ${status}`,
    background: (count: number) => `Background: ${count}`,
    latestOutputTitle: "Latest output",
    noVisibleOutput: "No visible output.",
    latestOutputNext: "Use /details for full runtime output.",
  },
};

export type ShellViewModelOptions = {
  width?: number;
  height?: number;
  noColor?: boolean;
  outputBlocks?: ProductBlockViewModel[];
  setupNeeded?: boolean;
  projectRouteProblem?: string;
  limitations?: string[];
};

export function createShellViewModel(
  context: TuiContext,
  options: ShellViewModelOptions = {},
): ShellViewModel {
  const language = context.language;
  const width = normalizeWidth(options.width);
  const height = normalizeHeight(options.height);
  const projectName = truncateMiddle(
    basename(context.projectPath) || context.projectPath,
    width <= 40 ? 18 : 28,
  );
  const setupNeeded = options.setupNeeded ?? false;
  const text = shellText[language];

  // setup-needed 不再生成 bordered block，改为轻提示
  const setupHint = setupNeeded ? text.setupHint : undefined;

  // blocks 只保留 project-route 和 output（最多 1 条）
  const blocks: ProductBlockViewModel[] = [];
  if (options.projectRouteProblem) {
    blocks.push(createProjectRouteBlock(language, options.projectRouteProblem));
  }
  const outputBlocks = (options.outputBlocks ?? []).slice(-1);
  blocks.push(...outputBlocks);
  const fittedBlocks = blocks.map((block) => fitBlockToWidth(block, width));

  return {
    language,
    projectName,
    projectPath: context.projectPath,
    width,
    height,
    mode: "ink",
    themeMode: options.noColor ? "no-color" : "color",
    brand: text.brand,
    homeVision: text.vision,
    setupHint,
    status: {
      project: text.project(projectName),
      model: text.model(truncateMiddle(context.model || "unknown", width <= 40 ? 12 : 22)),
      permission: text.permission(formatPermissionModeLabel(context.permissionMode, language)),
      trust: text.trust(formatTrust(context, language)),
      index: formatIndex(context.index.status, language),
      background: formatBackground(
        context.backgroundTasks.filter((task) => task.status === "running").length,
        language,
      ),
    },
    composer: {
      placeholder: getComposerPlaceholder(language),
      submittedHint: text.submittedHint,
      masking: context.pendingModelSetup?.step === "apiKey",
    },
    blocks: fittedBlocks,
    limitations: options.limitations ?? [],
  };
}

export function getComposerPlaceholder(language: Language): string {
  return shellText[language].placeholder;
}

export function createOutputBlock(
  text: string,
  language: Language,
  id = `output-${Date.now()}`,
): ProductBlockViewModel {
  const normalized = redactSensitiveText(text.replace(/\r/g, "").trim());
  const firstLine = normalized.split("\n").find((line) => line.trim()) ?? normalized;
  const copy = shellText[language];
  return {
    id,
    kind: "details",
    status: /错误|失败|error|failed/iu.test(normalized) ? "fail" : "info",
    title: copy.latestOutputTitle,
    summary: firstLine || copy.noVisibleOutput,
    nextAction: copy.latestOutputNext,
  };
}

function createProjectRouteBlock(language: Language, problem: string): ProductBlockViewModel {
  const text = shellText[language];
  return {
    id: "project-route-problem",
    kind: "setup",
    status: "blocked",
    title: text.routeTitle,
    summary: text.routeSummary(problem),
    nextAction: text.routeNextAction,
  };
}

function formatTrust(context: TuiContext, language: Language): string {
  const text = shellText[language];
  if (!context.config.workspaceTrust.recorded) {
    return text.trustUnknown;
  }
  return context.config.workspaceTrust.level === "trusted"
    ? text.trustTrusted
    : text.trustRestricted;
}

function formatIndex(status: string, language: Language): string {
  const value = truncateMiddle(status || "unknown", 10);
  return shellText[language].index(value);
}

function formatBackground(count: number, language: Language): string {
  return shellText[language].background(count);
}

function normalizeWidth(width: number | undefined): number {
  if (!width || !Number.isFinite(width)) return 80;
  return Math.max(30, Math.floor(width));
}

function normalizeHeight(height: number | undefined): number {
  if (!height || !Number.isFinite(height)) return 24;
  return Math.max(10, Math.floor(height));
}

function fitBlockToWidth(block: ProductBlockViewModel, width: number): ProductBlockViewModel {
  const contentWidth = Math.max(18, width - (width < 60 ? 4 : 10));
  return {
    ...block,
    title: truncateMiddle(block.title, contentWidth),
    summary: fitLine(block.summary, contentWidth),
    detail: block.detail ? fitLine(block.detail, contentWidth) : undefined,
    nextAction: block.nextAction ? fitLine(block.nextAction, contentWidth) : undefined,
  };
}

function fitLine(value: string, width: number): string {
  return truncateMiddle(value.replace(/\s+/gu, " ").trim(), width);
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]{8,}/gu, "[masked-key]")
    .replace(/(api[_-]?key\s*[=:]\s*)\S+/giu, "$1[masked-key]")
    .replace(/(authorization\s*:\s*bearer\s+)\S+/giu, "$1[masked-key]");
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
