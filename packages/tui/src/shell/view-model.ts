import { basename } from "node:path";
import type { Language } from "@linghun/shared";
import type { TuiContext } from "../index.js";
import { formatPermissionModeLabel } from "../runtime-status-presenter.js";
import type { ProductBlockViewModel, ShellViewModel } from "./types.js";

const shellText = {
  "zh-CN": {
    title: "Linghun 编程终端",
    homeSummary: (projectName: string) =>
      `当前工作区 ${projectName}。可以直接描述目标；需要精确命令时仍可用 /help。`,
    vision: "技术普惠会越来越成熟，而你就是最伟大的梦想家。",
    placeholder: "我能帮您做点什么？",
    prompt: "你",
    hint: "Enter 发送 · Esc 取消 · / 查看命令",
    submittedHint: "已通过同一条 TUI controller 路径提交。",
    homeTitle: "首页",
    homeBlockSummary: (projectName: string, model: string) =>
      `项目 ${projectName} · 模型 ${model} · 可以直接描述任务。`,
    homeCompactSummary: (model: string) => `模型 ${model} · 直接描述任务。`,
    homeNextAction: "直接输入目标；需要精确入口时再用 /help。",
    repoTitle: "项目状态",
    repoSummary: (path: string, trust: string, index: string) => `${path} · ${trust} · ${index}`,
    repoNextAction: "只显示当前最有用的状态摘要；诊断细节可用 /doctor 或 details。",
    setupTitle: "需要配置模型",
    setupSummary: "这是一台电脑的一次模型配置，不是当前仓库配置；保存后其他仓库会默认复用。",
    setupDetail:
      "保存位置是用户级 provider.env（默认 ~/.linghun/provider.env 或 $LINGHUN_CONFIG_DIR/provider.env）。",
    setupNextAction: "主路径：按 Enter 或说“我要配置模型”；高级/恢复：/model setup。",
    routeTitle: "项目模型路由需要处理",
    routeSummary: (problem: string) =>
      `${problem}。这是项目级 route/settings 问题，不要重复填写用户 API key。`,
    routeNextAction: "用 /model doctor 查看详情，或调整本仓库 .linghun/settings.json。",
    trustUnknown: "信任?",
    trustTrusted: "已信任",
    trustRestricted: "受限",
    index: (status: string) => `索引 ${status}`,
    cacheUnknown: "缓存?",
    cache: (hitRate: number) => `缓存 ${Math.round(hitRate * 100)}%`,
    background: (count: number) => `后台 ${count}`,
    latestOutputTitle: "最近输出",
    noVisibleOutput: "没有可见输出。",
    latestOutputNext: "如需完整运行时输出，可用 /details。",
  },
  "en-US": {
    title: "Linghun coding shell",
    homeSummary: (projectName: string) =>
      `Workspace ${projectName}. Describe a goal directly; exact commands remain available with /help.`,
    vision: "Technology will become more accessible, and you are the greatest dreamer.",
    placeholder: "What can I help you with?",
    prompt: "you",
    hint: "Enter to send · Esc to cancel · / for commands",
    submittedHint: "Submitted through the shared TUI controller.",
    homeTitle: "Home",
    homeBlockSummary: (projectName: string, model: string) =>
      `Project ${projectName} · Model ${model} · ready for natural-language tasks.`,
    homeCompactSummary: (model: string) => `Model ${model} · describe a goal.`,
    homeNextAction: "Type a goal directly; use /help only when you need an exact entry.",
    repoTitle: "Project state",
    repoSummary: (path: string, trust: string, index: string) => `${path} · ${trust} · ${index}`,
    repoNextAction:
      "Only the most useful state is shown here; use /doctor or details for diagnostics.",
    setupTitle: "Model setup needed",
    setupSummary:
      "This is one-time setup for this computer, not this repository; after saving, other repositories reuse it by default.",
    setupDetail:
      "The save location is the user provider.env: ~/.linghun/provider.env or $LINGHUN_CONFIG_DIR/provider.env.",
    setupNextAction:
      'Primary: press Enter or say "configure provider"; advanced/recovery: /model setup.',
    routeTitle: "Project model route needs attention",
    routeSummary: (problem: string) =>
      `${problem}. This is a project-scoped route/settings issue; do not re-enter the user API key.`,
    routeNextAction: "Use /model doctor for details, or update this repo's .linghun/settings.json.",
    trustUnknown: "trust?",
    trustTrusted: "trusted",
    trustRestricted: "restricted",
    index: (status: string) => `index ${status}`,
    cacheUnknown: "cache?",
    cache: (hitRate: number) => `cache ${Math.round(hitRate * 100)}%`,
    background: (count: number) => `bg ${count}`,
    latestOutputTitle: "Latest output",
    noVisibleOutput: "No visible output.",
    latestOutputNext: "Use /details for full runtime output.",
  },
};

export type ShellViewModelOptions = {
  width?: number;
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
  const projectName = truncateMiddle(
    basename(context.projectPath) || context.projectPath,
    width <= 40 ? 18 : 28,
  );
  const setupNeeded = options.setupNeeded ?? false;
  const text = shellText[language];
  const repoBlock = createRepoBlock(context, width);
  const blocks: ProductBlockViewModel[] = [createHomeBlock(context, projectName, width), repoBlock];
  if (setupNeeded) {
    blocks.push(createSetupNeededBlock(language));
  }
  if (options.projectRouteProblem) {
    blocks.push(createProjectRouteBlock(language, options.projectRouteProblem));
  }
  blocks.push(...(options.outputBlocks ?? []).slice(-3));
  const fittedBlocks = blocks.map((block) => fitBlockToWidth(block, width));

  return {
    language,
    projectName,
    projectPath: context.projectPath,
    width,
    mode: "ink",
    themeMode: options.noColor ? "no-color" : "color",
    homeTitle: text.title,
    homeSummary: `${text.homeSummary(projectName)} ${text.vision}`,
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
      prompt: text.prompt,
      hint: text.hint,
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

function createHomeBlock(
  context: TuiContext,
  projectName: string,
  width: number,
): ProductBlockViewModel {
  const text = shellText[context.language];
  return {
    id: "home",
    kind: "home",
    status: "info",
    title: text.homeTitle,
    summary:
      width <= 80
        ? text.homeCompactSummary(truncateMiddle(context.model, width <= 40 ? 14 : 22))
        : text.homeBlockSummary(projectName, truncateMiddle(context.model, 24)),
    nextAction: text.homeNextAction,
  };
}

function createRepoBlock(context: TuiContext, width: number): ProductBlockViewModel {
  const text = shellText[context.language];
  const pathLimit = width <= 40 ? 20 : width <= 60 ? 28 : 44;
  return {
    id: "repo-state",
    kind: "repo",
    status: context.config.workspaceTrust.level === "trusted" ? "pass" : "partial",
    title: text.repoTitle,
    summary: text.repoSummary(
      truncatePath(context.projectPath, pathLimit),
      formatTrust(context, context.language),
      formatIndex(context.index.status, context.language),
    ),
    nextAction: width < 60 ? undefined : text.repoNextAction,
  };
}

function createSetupNeededBlock(language: Language): ProductBlockViewModel {
  const text = shellText[language];
  return {
    id: "setup-needed",
    kind: "setup",
    status: "blocked",
    title: text.setupTitle,
    summary: text.setupSummary,
    detail: text.setupDetail,
    nextAction: text.setupNextAction,
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

function formatCache(hitRate: number | null, language: Language): string {
  if (hitRate === null) return shellText[language].cacheUnknown;
  return shellText[language].cache(hitRate);
}

function formatBackground(count: number, language: Language): string {
  return shellText[language].background(count);
}

function normalizeWidth(width: number | undefined): number {
  if (!width || !Number.isFinite(width)) return 80;
  return Math.max(30, Math.floor(width));
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

function truncatePath(value: string, max: number): string {
  const normalized = value.replace(/\\/gu, "/");
  const parts = normalized.split("/").filter(Boolean);
  const tail = parts.slice(-2).join("/") || normalized;
  return truncateMiddle(tail, max);
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
