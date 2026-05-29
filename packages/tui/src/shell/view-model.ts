import { basename } from "node:path";
import type { Language } from "@linghun/shared";
import type { ToolName } from "@linghun/tools";
import type { TuiContext } from "../index.js";
import { formatPermissionModeLabel } from "../runtime-status-presenter.js";
import {
  findConfigPanel,
  getActionLabel,
  getConfigPanels,
  getPanelText,
} from "./models/config-control-plane.js";
import { buildFooterView } from "./models/footer-view.js";
import { buildHelpPanelData } from "./models/help-panel.js";
import { buildElevationOptions } from "./models/permission-elevation.js";
import { explainHowToUpdate, explainPolicyVerdict, explainSemantic, type PathSafety, type PolicySemantic } from "./models/permission-explanation.js";
import { type TaskSuggestion, buildTaskSuggestions } from "./models/task-suggestion.js";
import type {
  BackgroundTaskSummary,
  ConfigPanelView,
  NotificationView,
  PermissionAction,
  ProductBlockViewModel,
  ShellViewMode,
  ShellViewModel,
  TaskActivityView,
  TaskFooterView,
  TaskPermissionView,
} from "./types.js";

const shellText = {
  "zh-CN": {
    brand: "LingHun",
    vision: "技术普惠会越来越成熟 而你就是最伟大的梦想家",
    visionShort: "技术普惠，你是最伟大的梦想家",
    project: (name: string) => `项目：${name}`,
    model: (name: string) => `模型：${name}`,
    permission: (mode: string) => `权限：${mode}`,
    trust: (value: string) => `信任：${value}`,
    placeholder: "我能帮您做点什么？",
    taskPlaceholder: "继续输入…",
    setupPlaceholder: "按 Enter 开始配置模型",
    setupApiKeyPlaceholder: "粘贴 API Key（输入会被遮蔽）",
    setupBaseUrlPlaceholder: "输入 Base URL，回车确认",
    setupModelPlaceholder: "输入模型名，回车确认",
    setupReasoningPlaceholder: "选择 reasoning level（low/medium/high），回车确认",
    setupAuxModelPlaceholder: "输入辅助模型，留空跳过",
    setupConfirmPlaceholder: "y 确认 · n 重填",
    setupStepApiKey: "配置 · API Key",
    setupStepBaseUrl: "配置 · Base URL",
    setupStepModel: "配置 · Model",
    setupStepReasoning: "配置 · Reasoning",
    setupStepAuxModel: "配置 · Aux Model",
    setupStepConfirm: "配置 · 确认",
    permissionPlaceholder: "选择操作：y 同意 · n 拒绝 · d 详情 · Esc 取消",
    permissionActionYes: "同意",
    permissionActionNo: "拒绝",
    permissionActionDetails: "详情",
    permissionActionCancel: "取消",
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
    backgroundShort: (count: number) => `后台:${count}`,
    latestOutputTitle: "最近输出",
    noVisibleOutput: "没有可见输出。",
    latestOutputNext: "按 Ctrl+O 查看完整运行时输出（或 /details）。",
    detailsHint: "Ctrl+O 查看完整内容",
    errorTitle: (tool: string) => `${tool} 失败`,
    errorDetailsHint: "Ctrl+O 查看完整错误",
    activityError: "请求失败，可重试或用 /model doctor 排查。",
    activityCompleted: "已完成。",
    denied: (tool: string) => `已拒绝 ${tool}，工具未执行。`,
    cancelled: (tool: string) => `已取消 ${tool}，工具未执行。`,
  },
  "en-US": {
    brand: "LingHun",
    vision: "Technology will become more accessible, and you are the greatest dreamer.",
    visionShort: "You are the greatest dreamer.",
    project: (name: string) => `Project: ${name}`,
    model: (name: string) => `Model: ${name}`,
    permission: (mode: string) => `Permission: ${mode}`,
    trust: (value: string) => `Trust: ${value}`,
    placeholder: "What can I help you with?",
    taskPlaceholder: "Continue…",
    setupPlaceholder: "Press Enter to configure a model",
    setupApiKeyPlaceholder: "Paste API key (input is masked)",
    setupBaseUrlPlaceholder: "Enter Base URL, press Enter",
    setupModelPlaceholder: "Enter model name, press Enter",
    setupReasoningPlaceholder: "Pick reasoning level (low/medium/high), press Enter",
    setupAuxModelPlaceholder: "Enter aux model, leave blank to skip",
    setupConfirmPlaceholder: "y to confirm · n to redo",
    setupStepApiKey: "Setup · API key",
    setupStepBaseUrl: "Setup · Base URL",
    setupStepModel: "Setup · Model",
    setupStepReasoning: "Setup · Reasoning",
    setupStepAuxModel: "Setup · Aux model",
    setupStepConfirm: "Setup · Confirm",
    permissionPlaceholder: "Choose: y allow · n deny · d details · Esc cancel",
    permissionActionYes: "Allow",
    permissionActionNo: "Deny",
    permissionActionDetails: "Details",
    permissionActionCancel: "Cancel",
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
    backgroundShort: (count: number) => `BG:${count}`,
    latestOutputTitle: "Latest output",
    noVisibleOutput: "No visible output.",
    latestOutputNext: "Press Ctrl+O for full runtime output (or /details).",
    detailsHint: "Ctrl+O for details",
    errorTitle: (tool: string) => `${tool} failed`,
    errorDetailsHint: "Ctrl+O for full error",
    activityError: "Request failed. Retry or use /model doctor.",
    activityCompleted: "Completed.",
    denied: (tool: string) => `Denied ${tool}; tool was not executed.`,
    cancelled: (tool: string) => `Cancelled ${tool}; tool was not executed.`,
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
  /** Set to true immediately after user submits input to prevent home flicker. */
  submitted?: boolean;
  /** Denial/cancel feedback for the most recent permission action. */
  denialFeedback?: { toolName: string; kind: "denied" | "cancelled" };
  /**
   * D.13E Step 2 — slash candidates that are currently visible in the Composer
   * suggestion list. View-model uses this to assemble TaskSuggestionBar entries
   * (read-only mirror, no keyboard focus).
   */
  slashCandidates?: { slash: string; label: string }[];
  /**
   * D.13E Step 2 — ConfigPanel state (panel_list / panel_detail / undefined).
   * View-model maps this to ShellViewModel.configPanel via mapConfigPanelState.
   */
  configPanelState?:
    | { phase: "panel_list"; cursor: number }
    | { phase: "panel_detail"; panelId: string; actionCursor: number };
  /**
   * D13E-P3 cleanup #5 — 当前 executor provider 的 reasoning level（如 "High"）。
   * view-model 只负责把它格式化成 "推理 High" / "Reasoning High" 后挂到
   * taskFooter.reasoning。view-model 不解析 provider 路由，由 runInkShell /
   * runPlainTui 在调用前从 getSelectedModelRuntime 取值。空字符串或 undefined
   * 表示不显示这一段（避免 "推理 unknown" 这种假信号）。
   */
  reasoningLevel?: string;
  /** 是否真的发送给 provider；false 时不在 footer 露出，避免误导用户。 */
  reasoningSent?: boolean;
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

  // Determine effective view mode early to decide block filtering and setupHint visibility
  const effectiveViewMode: ShellViewMode =
    options.viewMode ??
    (options.submitted
      ? "pending"
      : options.outputBlocks?.length ||
          options.activity ||
          options.permission ||
          options.denialFeedback
        ? "task"
        : "home");

  // setup-needed: only surface as setupHint in task/pending mode (not home first-screen).
  // While the model setup flow is actively running (pendingModelSetup), the
  // composer's step label + step placeholder is the single source of truth, so
  // we suppress the redundant setupHint to keep the task region clean.
  const setupActiveFlow = Boolean(context.pendingModelSetup?.step);
  const setupHint =
    setupNeeded && effectiveViewMode !== "home" && !setupActiveFlow ? text.setupHint : undefined;

  // blocks 只保留 project-route、background summaries 和 output（最多 3 条）
  // 当 permission pending 时，不显示 output block 以避免权限提示双重显示
  // Home 首屏不显示 background blocks
  // setup 进行中时，background / 最近输出噪音被收敛，让用户专注配置流程
  const blocks: ProductBlockViewModel[] = [];
  if (options.projectRouteProblem) {
    blocks.push(createProjectRouteBlock(language, options.projectRouteProblem));
  }
  if (effectiveViewMode !== "home" && !setupActiveFlow && options.backgroundSummaries?.length) {
    // Only surface backgrounds the user must act on: running / failed.
    // timeout / stale / cancelled / completed are demoted to /details so the
    // task region keeps focus on the active flow.
    const focusBackgrounds = options.backgroundSummaries.filter(
      (s) => s.status === "running" || s.status === "failed",
    );
    if (focusBackgrounds.length > 0) {
      blocks.push(...mapBackgroundSummariesToBlocks(focusBackgrounds, language));
    }
  }
  if (!options.permission && !setupActiveFlow) {
    const allOutputBlocks = options.outputBlocks ?? [];
    // Prioritize fail/blocking output over normal output
    const failBlocks = allOutputBlocks.filter((b) => b.status === "fail" || b.status === "blocked");
    const normalBlocks = allOutputBlocks.filter(
      (b) => b.status !== "fail" && b.status !== "blocked",
    );
    // keep:true 的 block（例如 slash command 的 transcript row）必须穿透 slice 限流，
    // 否则连续 tool 输出会把用户提交记录推出可视区，破坏 transcript 分层。
    // D.13M-B：assistant streaming block（kind="details" + keep:true）在收到首个
    // delta 之前 fullText 为空，summary 落在 noVisibleOutput 占位字符串上。这种空
    // streaming 占位不应当作可见输出：等待态由 ActivityIndicator 接管，正文为空
    // 时直接从主屏过滤掉，避免 "没有可见输出。" 在 thinking-only / 慢请求等场景
    // 下闪现。
    const isEmptyAssistantStreamBlock = (b: ProductBlockViewModel): boolean =>
      b.keep === true &&
      b.kind === "details" &&
      (b.fullText ?? "").trim().length === 0 &&
      !b.title;
    const keepBlocks = normalBlocks.filter((b) => b.keep && !isEmptyAssistantStreamBlock(b));
    const ephemeralBlocks = normalBlocks.filter((b) => !b.keep);
    // Show all fail/blocking + all keep + up to 3 most recent ephemeral
    // (cap on ephemerals only; fail/keep 不计入 cap，仍作为优先信号保留)。
    const maxEphemeral = Math.max(0, 3 - failBlocks.length);
    const selectedBlocks = [...failBlocks, ...keepBlocks, ...ephemeralBlocks.slice(-maxEphemeral)];
    // Add /details hint only to error/blocked blocks (avoid noise on info rows).
    const outputWithHints = selectedBlocks.map((b) => addDetailsHint(b, language));
    blocks.push(...outputWithHints);
  }

  // Denial/cancel feedback as an output block
  if (options.denialFeedback) {
    const denialText =
      options.denialFeedback.kind === "denied"
        ? text.denied(options.denialFeedback.toolName)
        : text.cancelled(options.denialFeedback.toolName);
    blocks.push({
      id: "denial-feedback",
      kind: "details",
      status: "partial",
      title: denialText,
      summary: denialText,
    });
  }

  const fittedBlocks = blocks.map((block) => fitBlockToWidth(block, width));

  const viewMode = effectiveViewMode;

  // Vision: use short version for narrow terminals
  const homeVision = width <= 40 ? text.visionShort : text.vision;

  // Composer: switch placeholder when permission is pending; setup flow uses
  // step-specific placeholders. Home no longer overrides with setupPlaceholder
  // (the setupHint surface and Enter trigger are the entry points).
  const setupStep = context.pendingModelSetup?.step;
  const setupActive = Boolean(setupStep);
  const setupPlaceholderByStep: Record<string, string> = {
    apiKey: text.setupApiKeyPlaceholder,
    baseUrl: text.setupBaseUrlPlaceholder,
    model: text.setupModelPlaceholder,
    reasoning: text.setupReasoningPlaceholder,
    auxModel: text.setupAuxModelPlaceholder,
    confirm: text.setupConfirmPlaceholder,
  };
  const setupStepLabelByStep: Record<string, string> = {
    apiKey: text.setupStepApiKey,
    baseUrl: text.setupStepBaseUrl,
    model: text.setupStepModel,
    reasoning: text.setupStepReasoning,
    auxModel: text.setupStepAuxModel,
    confirm: text.setupStepConfirm,
  };
  const composerPlaceholder = options.permission
    ? text.permissionPlaceholder
    : setupStep
      ? (setupPlaceholderByStep[setupStep] ?? text.placeholder)
      : text.placeholder;
  const composerSetupStepLabel = setupStep ? setupStepLabelByStep[setupStep] : undefined;

  // TaskFooter — minimal status footer for task/pending viewMode. The full
  // StatusTray noise stays out of the task region; this only carries the
  // signals a user wants while a flow is active: permission mode, model,
  // cache hit rate, index status, and a red-colored Shift+Tab cycle hint.
  // setupHint is intentionally NOT routed through the footer hint slot — long
  // setup sentences belong above the composer (or in /config), not in the
  // 1-line breathing footer. D13E-P3: dropped session id / gate / background.
  // D.13Q-UX: 走 buildFooterView 纯函数，把 model 占位 / cache 低命中渲染成
  // dim/warning 语义；setup-needed 时 model 显示 dim "--"，避免兜底 deepseek-chat
  // 流到主屏。
  const cyclePermHint =
    language === "en-US" ? "(Shift+Tab switch mode)" : "（Shift+Tab 切换模式）";
  const taskFooter: TaskFooterView | undefined =
    viewMode === "home"
      ? undefined
      : buildFooterView({
          language,
          width,
          permissionModeLabel: formatPermissionModeLabel(context.permissionMode, language),
          cyclePermHint,
          effectiveModel: context.model,
          setupNeeded,
          cacheHitRate: context.cache?.history?.at(-1)?.hitRate ?? null,
          indexStatus: context.index.status,
          reasoningLevel: options.reasoningLevel,
          reasoningSent: options.reasoningSent,
        }).view;

  // D.13E Step 2 — TaskSuggestionBar 数据（只读，UI 不接键盘）。
  // 仅在 task / pending 模式渲染，避免 home 首屏被 suggestion 噪音污染。
  const failBlocksForSuggestions = fittedBlocks.filter(
    (b) => b.status === "fail" || b.status === "blocked",
  );
  const taskSuggestions: TaskSuggestion[] | undefined =
    viewMode === "home"
      ? undefined
      : buildTaskSuggestions({
          language,
          setupHint,
          permission: options.permission,
          failBlocks: failBlocksForSuggestions,
          slashCandidates: options.slashCandidates,
          // 修正 v3 #6：不在 SuggestionBar 暴露 14 panel 作为 configHints
        });

  // D.13E Step 2 — ConfigPanel view 装配（runInkShell.onInput 拦截 /config 后填充
  // configPanelState；与 view.permission 互斥渲染由 ShellApp 保证）。
  const configPanel: ConfigPanelView | undefined = options.configPanelState
    ? mapConfigPanelState(options.configPanelState, language)
    : undefined;

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
    homeVision,
    setupHint,
    activity: options.activity,
    permission: options.permission
      ? withPermissionActions(options.permission, language, context)
      : undefined,
    status: {
      project: text.project(projectName),
      model: text.model(truncateMiddle(context.model || "unknown", width <= 40 ? 12 : 22)),
      permission: text.permission(formatPermissionModeLabel(context.permissionMode, language)),
      trust: text.trust(formatTrust(context, language)),
      index: formatIndex(context.index.status, language),
      background: formatBackground(
        context.backgroundTasks.filter((task) => task.status === "running").length,
        language,
        width,
      ),
    },
    composer: {
      placeholder: composerPlaceholder,
      taskPlaceholder: text.taskPlaceholder,
      submittedHint: text.submittedHint,
      masking: context.pendingModelSetup?.step === "apiKey",
      setupActive,
      setupStep: composerSetupStepLabel,
    },
    blocks: fittedBlocks,
    limitations: options.limitations ?? [],
    taskFooter,
    taskSuggestions: taskSuggestions && taskSuggestions.length > 0 ? taskSuggestions : undefined,
    configPanel,
    helpPanel: (() => {
      const state = (context as { helpPanelState?: { group: "core" | "advanced" | "details"; cursor: number } }).helpPanelState;
      if (!state) return undefined;
      return buildHelpPanelData(state.group, state.cursor, language);
    })(),
    btwPanel: (context as { btwPanelState?: NonNullable<ShellViewModel["btwPanel"]> }).btwPanelState,
    sessionsPanel: (context as { sessionsPanelState?: NonNullable<ShellViewModel["sessionsPanel"]> }).sessionsPanelState,
    notifications: (() => {
      const ctxNotifs = (context as { notifications?: NotificationView[] }).notifications;
      if (!ctxNotifs || ctxNotifs.length === 0) return undefined;
      // D.13Q-UX Closure: 按 createdAt + timeoutMs 过滤过期项。
      // - createdAt 缺省 → 视为常驻（向后兼容历史 push 路径）
      // - timeoutMs 缺省 → 常驻直到外部状态显式清空
      // - createdAt + timeoutMs <= now → 过期，丢弃
      const now = Date.now();
      const live = ctxNotifs.filter((n) => {
        if (typeof n.timeoutMs !== "number") return true;
        if (typeof n.createdAt !== "number") return true;
        return n.createdAt + n.timeoutMs > now;
      });
      // 同步把 ctxNotifs 收敛为活动队列，避免无限积累。
      (context as { notifications?: NotificationView[] }).notifications = live;
      return live.length > 0 ? [...live] : undefined;
    })(),
  };
}

/**
 * D.13E Step 2 — 把 controller 持有的 configPanelState 映射成 ShellViewModel.configPanel。
 * 只装配 i18n / 列表数据，不带任何键盘事件；导航事件由 ConfigPanel 组件自己 useInput
 * → controller.onInput({ type: "config-*" }) 触发。
 */
function mapConfigPanelState(
  state:
    | { phase: "panel_list"; cursor: number }
    | { phase: "panel_detail"; panelId: string; actionCursor: number },
  language: Language,
): ConfigPanelView | undefined {
  if (state.phase === "panel_list") {
    const panels = getConfigPanels().map((p) => {
      const t = getPanelText(p, language);
      return { id: p.id, title: t.title, summary: t.summary };
    });
    const total = panels.length;
    const cursor = total === 0 ? 0 : Math.min(Math.max(0, state.cursor), total - 1);
    return { phase: "panel_list", cursor, panels };
  }
  const panel = findConfigPanel(state.panelId as Parameters<typeof findConfigPanel>[0]);
  if (!panel) return undefined;
  const text = getPanelText(panel, language);
  const actions = panel.actions.map((a) => ({ id: a.id, label: getActionLabel(a, language) }));
  const total = actions.length;
  const actionCursor = total === 0 ? 0 : Math.min(Math.max(0, state.actionCursor), total - 1);
  return {
    phase: "panel_detail",
    panel: { id: panel.id, title: text.title, summary: text.summary },
    actionCursor,
    actions,
  };
}

function withPermissionActions(
  permission: TaskPermissionView,
  language: Language,
  context: TuiContext,
): TaskPermissionView {
  if (permission.actions && permission.actions.length > 0) return permission;
  // D.13L Block E — 主屏只暴露 3 个动作：allow_once / allow_always_tool / deny。
  // 仍走 buildElevationOptions（以保留 allow_always_tool 在已有 allow 规则时
  // 自动隐藏的逻辑），但 details 在主屏权限卡里被过滤掉，避免与"减少术语泄漏"
  // 的目标冲突。details 入口由 /details 命令承担。
  const existingRules = context.permissions?.rules ?? [];
  const elevation = buildElevationOptions({
    toolName: permission.toolName as ToolName,
    scope: permission.scope,
    risk: permission.risk,
    existingRules,
    language,
  });
  const visibleIds = new Set(["allow_once", "allow_always_tool", "deny"] as const);
  const actions: PermissionAction[] = elevation
    .filter((o) => visibleIds.has(o.id as "allow_once" | "allow_always_tool" | "deny"))
    .map((o) => ({
      id: o.id,
      label: o.id === "allow_once"
        ? language === "zh-CN" ? "是" : "Yes"
        : o.id === "allow_always_tool"
          ? language === "zh-CN" ? "始终允许" : "Always allow"
          : language === "zh-CN" ? "否" : "No",
      shortcut: o.shortcut,
    }));
  return { ...permission, actions };
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
  const isFail = /错误|失败|error|failed/iu.test(normalized);
  const summary = firstLine || copy.noVisibleOutput;
  // D13E-P3 cleanup #2 — Ctrl+O hint discipline:
  // hasMore must mean "the inline summary actually hides content the user
  // could reveal". Two and only two triggers:
  //   1. body contains 2+ non-empty lines (multi-line tool output / doctor /
  //      error stack — summary inevitably truncates these).
  //   2. body is single-line but at least 16 chars longer than the rendered
  //      summary (a genuinely-truncated long line, not a 1-2-char fluctuation).
  // Short normal final answers / completion confirms / "我能帮您做点什么？"
  // echoes never satisfy either condition and stay clean (no hint row).
  const nonEmptyLineCount = normalized.split("\n").filter((line) => line.trim().length > 0).length;
  const hasMore =
    normalized.length > 0 &&
    (nonEmptyLineCount >= 2 || normalized.length > summary.length + 16);
  return {
    id,
    kind: isFail ? "error" : "details",
    status: isFail ? "fail" : "info",
    // D13E-P3 empty title: drop the fixed "最近输出" / "Latest output" title
    // for normal outputs so ProductBlock renders only the summary line and
    // adjacent normal outputs breathe instead of stacking duplicate banners.
    // Errors keep an explicit title because the alert framing is the signal.
    title: isFail ? copy.errorTitle("output") : "",
    summary,
    nextAction: isFail ? copy.errorDetailsHint : hasMore ? copy.detailsHint : undefined,
    // Preserve the full body so /details can reveal it. The summary keeps the
    // first non-empty line for the inline block; multi-line outputs (e.g. the
    // /model doctor body with provider.env merge / endpointPath / providers)
    // are no longer truncated to the first line at this boundary.
    fullText: normalized,
    // D.13Q-UX: 错误类输出仍走 ProductBlock alert 卡（messageKind: tool_result_error）；
    // 其余正文走 assistant_text，让 ProductBlock 的 messageKind 分支用 Markdown
    // 渲染多行正文，而不是把多行文本压成 cyan/info dot 单行。
    messageKind: isFail ? "tool_result_error" : "assistant_text",
  };
}

/**
 * Adds /details hint to output blocks only when the block actually has more
 * content than its summary. D13E-P3 cleanup #2: discipline tightened — the
 * hint must reflect a *real* fold (multi-line body or a single line that's
 * meaningfully longer than the summary). Final answers / "完成" 类型短行 /
 * "我能帮您做点什么？" 回声不再带 Ctrl+O 行。
 */
function addDetailsHint(block: ProductBlockViewModel, language: Language): ProductBlockViewModel {
  const copy = shellText[language];
  // Error / blocked blocks always get an explicit error-details hint.
  if (block.status === "fail" || block.status === "blocked") {
    return {
      ...block,
      nextAction: block.nextAction || copy.errorDetailsHint,
    };
  }
  // Normal blocks only get the hint when fullText is meaningfully longer than
  // the displayed summary. Final reports / short normal outputs stay clean.
  if (block.nextAction) return block;
  const fullText = block.fullText ?? "";
  const summary = block.summary ?? "";
  const nonEmptyLines = fullText.split("\n").filter((line) => line.trim().length > 0).length;
  const hasMore =
    fullText.length > 0 && (nonEmptyLines >= 2 || fullText.length > summary.length + 16);
  if (!hasMore) return block;
  return { ...block, nextAction: copy.detailsHint };
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
    request_failed: "error",
    error: "error",
    failed: "error",
    completed: "completed",
    request_completed: "completed",
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
      error: shellText["zh-CN"].activityError,
      completed: shellText["zh-CN"].activityCompleted,
    },
    "en-US": {
      thinking: "Thinking…",
      tool_running: toolName ? `Running ${toolName}…` : "Running tool…",
      continuing: "Continuing after tool…",
      permission_waiting: "Waiting for permission…",
      error: shellText["en-US"].activityError,
      completed: shellText["en-US"].activityCompleted,
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
        verdict?: {
          semantic?: PolicySemantic;
          pathSafety?: PathSafety;
          redactedSummary?: string;
          reason?: string;
        };
      };
    }
  ).pendingLocalApproval;
  if (!approval) return undefined;

  if (approval.kind === "model_tool_use" || approval.kind === "architecture_drift") {
    const toolName = approval.toolName ?? "unknown";
    // D.13Q-UX Closure: 优先用 engine 真实 verdict（semantic / pathSafety /
    // redactedSummary / reason）装配 explanationLines；engine 没给时才回落到
    // toolName 简化推断（保兼容）。reason 走 sanitizePermissionReason 脱去
    // rule.id / hook id 等内部字段。
    const verdict = approval.verdict;
    const fallbackSemantic = inferSemanticByToolName(toolName);
    const semantic: PolicySemantic = verdict?.semantic ?? fallbackSemantic;
    const risk: "low" | "medium" | "high" = toolName === "Bash" ? "high" : "medium";
    const explanationLines = verdict
      ? buildPermissionExplanationLinesFromVerdict(
          {
            semantic,
            pathSafety: verdict.pathSafety,
            redactedSummary: verdict.redactedSummary,
            reason: verdict.reason,
          },
          risk,
          context.language,
        )
      : buildPermissionExplanationLines(fallbackSemantic, risk, context.language);
    return {
      toolName,
      reason: "",
      risk,
      scope: [],
      hint: "",
      actionSummary: buildPermissionActionSummary(
        context.language,
        toolName,
        approval.toolCall?.input,
      ),
      actions: [],
      explanationLines,
    };
  }
  return undefined;
}

/**
 * D.13Q-UX Closure — 用真实 PolicyVerdict（semantic / pathSafety /
 * redactedSummary / reason）装配 PermissionPanel 解释行。reason 已经过
 * sanitizePermissionReason 处理（不含 rule.id）。
 */
function buildPermissionExplanationLinesFromVerdict(
  verdict: {
    semantic: PolicySemantic;
    pathSafety?: PathSafety;
    redactedSummary?: string;
    reason?: string;
  },
  risk: "low" | "medium" | "high",
  language: Language,
): string[] {
  const isEn = language === "en-US";
  const lines: string[] = [];
  // 1) verdict 多行解释（semantic + pathSafety + redactedSummary + sanitized reason + how-to-update）
  lines.push(...explainPolicyVerdict(verdict, language));
  // 2) risk 一行
  if (risk === "high") {
    lines.push(isEn ? "Risk: high — review carefully." : "风险：高 — 请仔细确认。");
  } else if (risk === "medium") {
    lines.push(isEn ? "Risk: medium." : "风险：中。");
  } else {
    lines.push(isEn ? "Risk: low." : "风险：低。");
  }
  // 去重（explainPolicyVerdict 末尾就有 /permissions 指引，这里 risk 之后不要再追加）
  return lines.filter((line, idx, arr) => arr.indexOf(line) === idx);
}

/**
 * D.13Q-UX — 用 toolName 粗略推断 PolicySemantic（permission-policy-engine 的精确
 * verdict 仍由 decidePermission 计算；这里只为 UI 装配 user-facing 解释行，
 * 与 engine 解耦）。
 */
function inferSemanticByToolName(toolName: string): PolicySemantic {
  if (toolName === "Bash") return "destructive";
  if (toolName === "Write" || toolName === "Edit" || toolName === "MultiEdit") return "mutating";
  if (toolName === "Read" || toolName === "Glob" || toolName === "Grep") return "readonly";
  if (toolName === "WebFetch") return "network";
  return "unknown";
}

function buildPermissionExplanationLines(
  semantic: PolicySemantic,
  risk: "low" | "medium" | "high",
  language: Language,
): string[] {
  const isEn = language === "en-US";
  const lines: string[] = [];
  lines.push(explainSemantic(semantic, language));
  if (risk === "high") {
    lines.push(isEn ? "Risk: high — review carefully." : "风险：高 — 请仔细确认。");
  } else if (risk === "medium") {
    lines.push(isEn ? "Risk: medium." : "风险：中。");
  } else {
    lines.push(isEn ? "Risk: low." : "风险：低。");
  }
  lines.push(explainHowToUpdate(language));
  return lines;
}

/**
 * D.13L Block 0-B — 把 toolCall.input 转成主屏权限卡可读的"做什么"摘要行。
 *
 *   Bash               → "运行终端命令：<command>"   / "Run terminal command: <command>"
 *   Write/Edit/MultiEdit → "修改文件：<file_path>"   / "Edit file: <file_path>"
 *   Read               → "读取文件：<file_path>"     / "Read file: <file_path>"
 *   Glob/Grep          → "搜索：<pattern 或 path>"   / "Search: <pattern 或 path>"
 *   fallback           → "使用工具：<toolName>"      / "Use tool: <toolName>"
 *
 * D.13L Section 3 — Write 不再单独显示"写入文件"，与 Edit/MultiEdit 统一为
 * "修改文件"，避免主屏出现两套近义词；底层 Write 工具行为不变。
 *
 * 取值不解析、不预览内容；只读 input 上已经有的字符串字段。任何取不到字段
 * 的分支都退回到 fallback，避免主屏出现空摘要。
 */
function buildPermissionActionSummary(
  language: Language,
  toolName: string,
  input: unknown,
): string {
  const zh = language === "zh-CN";
  const obj = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const str = (key: string): string | undefined => {
    const v = obj[key];
    return typeof v === "string" && v.length > 0 ? v : undefined;
  };
  if (toolName === "Bash") {
    const command = str("command");
    if (command) return zh ? `运行终端命令：${command}` : `Run terminal command: ${command}`;
  }
  if (toolName === "Write" || toolName === "Edit" || toolName === "MultiEdit") {
    const path = str("file_path") ?? str("path");
    if (path) return zh ? `修改文件：${path}` : `Edit file: ${path}`;
  }
  if (toolName === "Read") {
    const path = str("path") ?? str("file_path");
    if (path) return zh ? `读取文件：${path}` : `Read file: ${path}`;
  }
  if (toolName === "Glob" || toolName === "Grep") {
    const target = str("pattern") ?? str("path");
    if (target) return zh ? `搜索：${target}` : `Search: ${target}`;
  }
  return zh ? `使用工具：${toolName}` : `Use tool: ${toolName}`;
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
  // D.13L Block D — 主屏后台任务说人话：
  // - 不再泄漏 raw status (running/stale/cancelled/timeout) / raw result / job id；
  // - 不再用 "后台：${unknown}" 当 title，回落到中性 "后台任务"；
  // - 多个后台任务聚合为单条 "后台还有 N 个任务在运行 / 已结束 / 失败"，
  //   细节（job id、raw status、log path、raw result）仍保留在 BackgroundTaskSummary
  //   里，由 /details background 路径渲染。
  if (summaries.length === 0) return [];
  const statusMap: Record<string, ProductBlockViewModel["status"]> = {
    running: "running",
    completed: "partial",
    failed: "fail",
    cancelled: "partial",
    timeout: "blocked",
    stale: "blocked",
    paused: "info",
  };
  const isFail = (s: BackgroundTaskSummary): boolean =>
    s.status === "failed" || s.status === "timeout";
  const isRunning = (s: BackgroundTaskSummary): boolean =>
    s.status === "running" || s.status === "paused" || s.status === "stale";
  const failed = summaries.filter(isFail);
  const running = summaries.filter(isRunning);
  const finished = summaries.filter((s) => !isFail(s) && !isRunning(s));
  const zh = language === "zh-CN";
  const blocks: ProductBlockViewModel[] = [];
  const meaningfulTitle = (s: BackgroundTaskSummary): string => {
    const t = (s.title ?? "").trim();
    const base = !t || t.toLowerCase() === "unknown" ? (zh ? "后台任务" : "Background task") : t;
    return zh ? `后台：${base}` : `Background: ${base}`;
  };
  if (running.length > 0) {
    const head = running[0];
    if (!head) return blocks;
    const title = running.length === 1
      ? meaningfulTitle(head)
      : zh
        ? `后台还有 ${running.length} 个任务在运行`
        : `${running.length} background tasks running`;
    const summary = zh ? "后台任务正在运行。" : "Background task is still running.";
    blocks.push({
      id: `bg-running-${running.length}`,
      kind: "run",
      status: statusMap[head.status] ?? "running",
      title,
      summary,
    });
  }
  if (failed.length > 0) {
    const head = failed[0];
    if (!head) return blocks;
    const title = failed.length === 1
      ? meaningfulTitle(head)
      : zh
        ? `后台还有 ${failed.length} 个任务失败`
        : `${failed.length} background tasks failed`;
    const summary = zh ? "后台任务失败，可稍后查看详情或重试。" : "Background task failed.";
    blocks.push({
      id: `bg-failed-${failed.length}`,
      kind: "run",
      status: statusMap[head.status] ?? "fail",
      title,
      summary,
    });
  }
  if (finished.length > 0) {
    const head = finished[0];
    if (!head) return blocks;
    const title = finished.length === 1
      ? meaningfulTitle(head)
      : zh
        ? `后台还有 ${finished.length} 个任务已结束`
        : `${finished.length} background tasks finished`;
    const summary = zh ? "后台任务已结束。" : "Background task finished.";
    blocks.push({
      id: `bg-finished-${finished.length}`,
      kind: "run",
      status: statusMap[head.status] ?? "partial",
      title,
      summary,
    });
  }
  return blocks;
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
  // D13E-P3: 当 indexer 状态为空 / "unknown" 时不显示噪音文案，
  // 用 "索引?" / "Index?" 替代 "索引：unknown"，避免主屏出现假信号。
  const trimmed = (status ?? "").trim();
  if (!trimmed || trimmed.toLowerCase() === "unknown") {
    return language === "en-US" ? "Index?" : "索引?";
  }
  return shellText[language].index(truncateMiddle(trimmed, 10));
}

function formatBackground(count: number, language: Language, width: number): string {
  if (count === 0) return "";
  if (width < 60) {
    return shellText[language].backgroundShort(count);
  }
  return shellText[language].background(count);
}

// D.13Q-UX: footer 字段计算迁移到 packages/tui/src/shell/models/footer-view.ts。
// 旧的 formatFooterModel / formatFooterCache / formatFooterReasoning 已移除，
// 仅保留 fitBlockToWidth / truncateMiddle 等 block 级 helper（仍在使用）。

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
  // D.13Q-UX: 消息语义 block（assistant_text / tool_result_* / diagnostic /
  // local_command_output）由 ProductBlock 内的 MessageMarkdown 自行处理换行/
  // 段落/列表/代码块，**不应**在此被 fitLine 打平成单行。fitLine 只负责
  // status / footer / suggestion 等真正需要单行截断的场景。
  // title 仍可走 truncateMiddle（标题就是单行语义）；nextAction 是 Ctrl+O hint
  // 单行也合理。summary / detail 在消息语义 block 上保留原样。
  const isMessageBlock =
    block.messageKind === "assistant_text" ||
    block.messageKind === "assistant_thinking" ||
    block.messageKind === "tool_result_success" ||
    block.messageKind === "tool_result_error" ||
    block.messageKind === "tool_result_cancelled" ||
    block.messageKind === "tool_result_rejected" ||
    block.messageKind === "diagnostic" ||
    block.messageKind === "local_command_output";
  return {
    ...block,
    title: truncateMiddle(block.title, contentWidth),
    summary: isMessageBlock ? block.summary : fitLine(block.summary, contentWidth),
    detail: block.detail
      ? isMessageBlock
        ? block.detail
        : fitLine(block.detail, contentWidth)
      : undefined,
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
