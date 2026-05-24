import { basename } from "node:path";
import type { Language } from "@linghun/shared";
import type { TuiContext } from "../index.js";
import { formatPermissionModeLabel } from "../runtime-status-presenter.js";
import type {
  BackgroundTaskSummary,
  ProductBlockViewModel,
  ShellViewMode,
  ShellViewModel,
  TaskActivityView,
  TaskPermissionView,
} from "./types.js";

const shellText = {
  "zh-CN": {
    brand: "LingHun",
    vision: "技术普惠会越来越成熟 而你就是最伟大的梦想家",
    project: (name: string) => `项目：${name}`,
    model: (name: string) => `模型：${name}`,
    permission: (mode: string) => `权限：${mode}`,
    trust: (value: string) => `信任：${value}`,
    placeholder: "我能帮您做点什么？",
    submittedHint: "已通过同一条 TUI controller 路径提交。",
    setupHint: "还没有模型配置。按 Enter 开始，或说\u201c我要配置模型\u201d。",
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
    brand: "LingHun",
    vision: "Technology will become more accessible, and you are the greatest dreamer.",
    project: (name: string) => `Project: ${name}`,
    model: (name: string) => `Model: ${name}`,
    permission: (mode: string) => `Permission: ${mode}`,
    trust: (value: string) => `Trust: ${value}`,
    placeholder: "What can I help you with?",
    submittedHint: "Submitted through the shared TUI controller.",
    setupHint: 'No model configured. Press Enter, or say "configure provider".',
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
  viewMode?: ShellViewMode;
  activity?: TaskActivityView;
  permission?: TaskPermissionView;
  outputBlocks?: ProductBlockViewModel[];
  backgroundSummaries?: BackgroundTaskSummary[];
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

  // blocks 只保留 project-route、background summaries 和 output（最多 1 条）
  // 当 permission pending 时，不显示 output block 以避免权限提示双重显示
  const blocks: ProductBlockViewModel[] = [];
  if (options.projectRouteProblem) {
    blocks.push(createProjectRouteBlock(language, options.projectRouteProblem));
  }
  if (options.backgroundSummaries?.length) {
    blocks.push(...mapBackgroundSummariesToBlocks(options.backgroundSummaries, language));
  }
  if (!options.permission) {
    const outputBlocks = (options.outputBlocks ?? []).slice(-1);
    blocks.push(...outputBlocks);
  }
  const fittedBlocks = blocks.map((block) => fitBlockToWidth(block, width));

  // Determine view mode: task if explicitly set, or if there are output blocks / activity / permission
  const viewMode: ShellViewMode =
    options.viewMode ??
    (options.outputBlocks?.length || options.activity || options.permission ? "task" : "home");

  return {
    language,
    projectName,
    projectPath: context.projectPath,
    width,
    height,
    mode: "ink",
    themeMode: options.noColor ? "no-color" : "color",
    viewMode,
    brand: text.brand,
    homeVision: text.vision,
    setupHint,
    activity: options.activity,
    permission: options.permission,
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

/**
 * Maps a TuiContext's requestActivityPhase to a TaskActivityView for the shell.
 * Returns undefined if no activity is in progress.
 */
export function mapRequestActivityToView(context: TuiContext): TaskActivityView | undefined {
  const phase = (context as { requestActivityPhase?: string }).requestActivityPhase;
  if (!phase) return undefined;

  const phaseMap: Record<string, TaskActivityView["phase"]> = {
    request_started: "thinking",
    request_started_report: "thinking",
    waiting_first_delta: "thinking",
    tool_running: "tool_running",
    continuing_after_tool: "continuing",
    permission_waiting: "permission_waiting",
  };
  const mapped = phaseMap[phase];
  if (!mapped) return undefined;

  const toolName = (context as { requestActivityToolName?: string }).requestActivityToolName;
  const textMap: Record<string, Record<string, string>> = {
    "zh-CN": {
      thinking: "正在思考…",
      tool_running: toolName ? `正在运行 ${toolName}…` : "正在运行工具…",
      continuing: "工具完成，继续处理…",
      permission_waiting: "等待权限确认…",
    },
    "en-US": {
      thinking: "Thinking…",
      tool_running: toolName ? `Running ${toolName}…` : "Running tool…",
      continuing: "Continuing after tool…",
      permission_waiting: "Waiting for permission…",
    },
  };
  const texts = textMap[context.language] ?? textMap["en-US"];
  return {
    phase: mapped,
    text: texts[mapped] ?? "",
    toolName: toolName ?? undefined,
  };
}

/**
 * Maps a TuiContext's pendingLocalApproval to a TaskPermissionView for the shell.
 * Returns undefined if no permission prompt is pending.
 */
export function mapPendingApprovalToPermission(
  context: TuiContext,
): TaskPermissionView | undefined {
  const approval = (
    context as {
      pendingLocalApproval?: {
        kind: string;
        toolName?: string;
        toolCall?: { input?: unknown };
        warnings?: string[];
      };
    }
  ).pendingLocalApproval;
  if (!approval) return undefined;

  if (approval.kind === "model_tool_use" || approval.kind === "architecture_drift") {
    const toolName = approval.toolName ?? "unknown";
    const input = approval.toolCall?.input as
      | { file_path?: string; path?: string; command?: string }
      | undefined;
    const scope: string[] = [];
    if (input?.file_path) scope.push(input.file_path);
    if (input?.path && input.path !== input.file_path) scope.push(input.path);
    if (input?.command) scope.push(input.command.slice(0, 60));

    const reason =
      approval.kind === "architecture_drift"
        ? (approval.warnings ?? []).join("; ") ||
          (context.language === "zh-CN" ? "工具调用改变约定范围" : "Tool use changes agreed scope")
        : context.language === "zh-CN"
          ? `${toolName} 需要用户确认`
          : `${toolName} requires confirmation`;

    const hint =
      context.language === "zh-CN"
        ? "输入 y 允许 / n 拒绝 / details 查看详情"
        : "Enter y to allow / n to deny / details for more";

    return {
      toolName,
      reason,
      risk: toolName === "Bash" ? "high" : "medium",
      scope,
      hint,
    };
  }
  return undefined;
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

function mapBackgroundSummariesToBlocks(
  summaries: BackgroundTaskSummary[],
  language: Language,
): ProductBlockViewModel[] {
  return summaries.map((s) => {
    const statusMap: Record<string, ProductBlockViewModel["status"]> = {
      running: "running",
      completed: "info",
      failed: "fail",
      cancelled: "partial",
      timeout: "blocked",
      stale: "blocked",
      paused: "info",
    };
    const blockStatus = statusMap[s.status] ?? "info";
    const resultSuffix = s.result && s.result !== s.status ? ` (${s.result})` : "";
    const title = language === "zh-CN" ? `后台：${s.title}` : `Background: ${s.title}`;
    const completedNote =
      s.status === "completed"
        ? language === "zh-CN"
          ? "已结束，非验证通过"
          : "finished, not a verification pass"
        : undefined;
    return {
      id: `bg-${s.id}`,
      kind: "run" as const,
      status: blockStatus,
      title,
      summary: `${s.status}${resultSuffix}`,
      nextAction: completedNote,
    };
  });
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
    .replace(/(authorization\s*:\s*bearer\s+)\S+/giu, "$1[masked-key]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/giu, "Bearer [masked-key]");
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

const CJK_WIDE_CHAR_RE =
  /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/u;

function displayWidth(value: string): number {
  let width = 0;
  for (const char of value) {
    width += CJK_WIDE_CHAR_RE.test(char) ? 2 : 1;
  }
  return width;
}

function charWidth(char: string): number {
  return CJK_WIDE_CHAR_RE.test(char) ? 2 : 1;
}
