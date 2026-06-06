import { basename } from "node:path";
import type { Language } from "@linghun/shared";
import type { ToolName } from "@linghun/tools";
import type { TuiContext } from "../index.js";
import { formatElapsedSince } from "../job-runner-presenter.js";
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
import {
  type PathSafety,
  type PolicySemantic,
  explainHowToUpdate,
  explainPolicyVerdict,
  explainSemantic,
} from "./models/permission-explanation.js";
import { type TaskSuggestion, buildTaskSuggestions } from "./models/task-suggestion.js";
import { charWidth, displayWidth } from "./text-utils.js";
import type {
  BackgroundTaskSummary,
  CommandPanelView,
  ConfigPanelView,
  NotificationView,
  PermissionAction,
  ProductBlockViewModel,
  ShellViewMode,
  ShellViewModel,
  TaskActivityView,
  TaskFooterView,
  TaskPermissionView,
  TranscriptScrollView,
  TranscriptVirtualRangeView,
} from "./types.js";

type TranscriptBlockHeightCache = Record<
  string,
  { height: number; width: number; textHash: string }
>;

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
  /** Stable start time for submitted fallback activity; avoids resetting elapsed on rerender. */
  submittedStartedAt?: number;
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
  // P1-4 — commandPanelState 也是 task 触发条件：高级 slash 面板（/model、/index
  // doctor、/memory review 等）即使没有 output block，也应进入 TaskLayout 渲染
  // CommandPanel，而不是停留在 Home（CommandPanel 只在 TaskLayout 渲染）。
  const hasCommandPanel = Boolean((context as { commandPanelState?: unknown }).commandPanelState);
  const effectiveViewMode: ShellViewMode =
    options.viewMode ??
    (options.submitted
      ? "pending"
      : options.outputBlocks?.length ||
          options.activity ||
          options.permission ||
          options.denialFeedback ||
          hasCommandPanel
        ? "task"
        : "home");

  // D.13Q-UX Real Smoke Fix v2 — A. submitted=true 且 options.activity 缺省时，
  // 合成一条 thinking fallback activity，避免任务页首帧空白（submittedPending
  // 已切到 pending viewMode，但 requestActivityPhase 尚未由 streaming 链路置位
  // 时，主屏没有任何"正在思考…"反馈，看上去像消息被吞）。
  // 真实 activity（mapRequestActivityToView）会覆盖此 fallback。
  const effectiveActivity: TaskActivityView | undefined =
    options.activity ??
    (options.submitted
      ? {
          phase: "thinking",
          text: language === "en-US" ? "Thinking…" : "正在思考…",
          elapsed: formatElapsedSince(
            new Date(options.submittedStartedAt ?? Date.now()).toISOString(),
          ),
        }
      : undefined);

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
  const ctrlOExpandState = (
    context as {
      ctrlOExpandState?: { active?: boolean; blockId?: string };
    }
  ).ctrlOExpandState;
  if (options.projectRouteProblem) {
    blocks.push(createProjectRouteBlock(language, options.projectRouteProblem));
  }
  const backgroundSummaryInput = selectBackgroundSummaryInput(options.backgroundSummaries, context);
  const taskRuntimeSummary =
    effectiveViewMode !== "home" && !setupActiveFlow && backgroundSummaryInput.length > 0
      ? mapBackgroundSummariesToBlocks(backgroundSummaryInput, language)[0]
      : undefined;
  if (!options.permission && !setupActiveFlow) {
    const allOutputBlocks = options.outputBlocks ?? [];
    // D.13Q-UX Real Smoke Fix v3 — transcript 必须严格按 append 时间顺序排列。
    // 旧实现 [...failBlocks, ...keepBlocks, ...ephemeralBlocks] 会按类型重排，
    // 让失败块插队到旧消息上方、ephemeral 推到 keep 后面，破坏 user → assistant
    // → diagnostic → user → assistant 的真实时间线。
    //
    // 新策略：
    //   - 不按 status / keep 重排，原顺序保留；
    //   - 只对 ephemeral（!keep && status != fail/blocked）做"最后 N 条"限制，
    //     超过 cap 的 ephemeral 从最早的起依次丢弃；
    //   - keep:true 与 fail/blocked 一律保留，按原位出现（不被推到顶部，也不被淘汰）；
    //   - empty assistant streaming placeholder 仍过滤掉。
    // D.13M-B：assistant streaming block（kind="details" + keep:true）在收到首个
    // delta 之前 fullText 为空。这种空 streaming 占位不应当作可见输出：等待态由
    // ActivityIndicator 接管，正文为空时直接从主屏过滤掉。
    const isEmptyAssistantStreamBlock = (b: ProductBlockViewModel): boolean =>
      b.keep === true && b.kind === "details" && (b.fullText ?? "").trim().length === 0 && !b.title;
    const isEphemeral = (b: ProductBlockViewModel): boolean =>
      !b.keep && b.status !== "fail" && b.status !== "blocked";
    const ephemeralIndices = allOutputBlocks
      .map((b, i) => (isEphemeral(b) ? i : -1))
      .filter((i) => i >= 0);
    const maxEphemeral = 3;
    const dropEphemeralIndices = new Set<number>(
      ephemeralIndices.length > maxEphemeral
        ? ephemeralIndices.slice(0, ephemeralIndices.length - maxEphemeral)
        : [],
    );
    const selectedBlocks = allOutputBlocks.filter((b, i) => {
      if (isEmptyAssistantStreamBlock(b)) return false;
      if (dropEphemeralIndices.has(i)) return false;
      return true;
    });
    const groupedBlocks = groupTranscriptToolBlocks(selectedBlocks, language);
    // Add /details hint only to error/blocked blocks (avoid noise on info rows).
    const outputWithHints = groupedBlocks.map((b) =>
      applyCtrlOExpandState(addDetailsHint(b, language), ctrlOExpandState),
    );
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

  // Phase 7.10: ordinary main-screen transcript no longer renders app-owned
  // blue selection. Native terminal selection/copy is the default surface.
  const fittedBlocks = blocks.map((block) => fitBlockToWidth(block, width));
  const fullFittedBlocks = fittedBlocks;

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
  const cyclePermHint = language === "en-US" ? "(Shift+Tab switch mode)" : "（Shift+Tab 切换模式）";
  const taskFooter: TaskFooterView | undefined =
    viewMode === "home"
      ? undefined
      : {
          ...buildFooterView({
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
          }).view,
          // Phase 6.6: workspaceStatus / runtimeStatus are no longer default
          // in the footer. They surface via /details, /status, /doctor or
          // explicit expand paths instead. The formatting functions remain
          // available for those commands to populate the fields.
        };

  // D.13E Step 2 — TaskSuggestionBar 数据。
  // 仅在 task / pending 模式渲染，避免 home 首屏被 suggestion 噪音污染。
  const failBlocksForSuggestions = fullFittedBlocks.filter(
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
        }).filter((item) => !context.handledTaskSuggestionIds?.has(item.id));
  const taskSuggestionCursor =
    taskSuggestions && taskSuggestions.length > 0
      ? Math.max(
          0,
          Math.min(context.taskSuggestionCursor ?? 0, Math.max(0, taskSuggestions.length - 1)),
        )
      : 0;

  // D.13E Step 2 — ConfigPanel view 装配（runInkShell.onInput 拦截 /config 后填充
  // configPanelState；与 view.permission 互斥渲染由 ShellApp 保证）。
  const configPanel: ConfigPanelView | undefined = options.configPanelState
    ? mapConfigPanelState(options.configPanelState, language)
    : undefined;

  // D.13Q-UX Task Surface — CommandPanel view 装配。controller 持有
  // context.commandPanelState，view-model 直接透传给 UI；UI 层不解析数据，
  // 只负责渲染 title/sections/actions/detailsText。空状态时 commandPanel 为 undefined。
  const commandPanel: CommandPanelView | undefined =
    (context as { commandPanelState?: CommandPanelView }).commandPanelState ?? undefined;

  // Main transcript scroll：home 模式不暴露；task/pending 模式默认吸底。
  const transcriptScroll: TranscriptScrollView | undefined =
    effectiveViewMode === "home"
      ? undefined
      : ((context as { transcriptScrollState?: TranscriptScrollView }).transcriptScrollState ?? {
          scrollOffset: 0,
          stickToBottom: true,
        });
  const streamingAssistantText = selectStreamingAssistantText(context, fullFittedBlocks);
  const tailHeight = estimateTranscriptTailHeight({
    streamingAssistantText,
    activity: effectiveActivity,
    suggestions: taskSuggestions,
    limitations: options.limitations ?? [],
    width,
  });
  const virtualized = buildTranscriptVirtualWindow({
    context,
    blocks: fullFittedBlocks,
    width,
    height,
    scroll: transcriptScroll,
    tailHeight,
    enabled: effectiveViewMode !== "home",
  });

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
    activity: effectiveActivity,
    permission: options.permission
      ? withPermissionActions(options.permission, language, context)
      : undefined,
    status: {
      project: text.project(projectName),
      model: text.model(truncateMiddle(context.model || "--", width <= 40 ? 12 : 22)),
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
      busy: computeComposerBusy({
        submitted: options.submitted,
        activity: effectiveActivity,
        context,
      }),
      busyHint: computeComposerBusy({
        submitted: options.submitted,
        activity: effectiveActivity,
        context,
      })
        ? language === "en-US"
          ? "Still working on the previous request. Press Ctrl+C to interrupt, then send again."
          : "正在处理上一条，按 Ctrl+C 可中断，稍后再发。"
        : undefined,
    },
    blocks: virtualized.blocks,
    transcriptVirtualRange: virtualized.range,
    streamingAssistantText,
    ctrlOExpand: ctrlOExpandState?.active
      ? { active: true, ...(ctrlOExpandState.blockId ? { blockId: ctrlOExpandState.blockId } : {}) }
      : { active: false },
    limitations: options.limitations ?? [],
    taskFooter,
    taskRuntimeSummary: taskRuntimeSummary ? fitBlockToWidth(taskRuntimeSummary, width) : undefined,
    taskSuggestions: taskSuggestions && taskSuggestions.length > 0 ? taskSuggestions : undefined,
    taskSuggestionCursor,
    configPanel,
    commandPanel,
    transcriptScroll,
    transcriptViewportGeometry: (
      context as { transcriptViewportGeometry?: ShellViewModel["transcriptViewportGeometry"] }
    ).transcriptViewportGeometry,
    helpPanel: (() => {
      const state = (
        context as { helpPanelState?: { group: "core" | "advanced" | "details"; cursor: number } }
      ).helpPanelState;
      if (!state) return undefined;
      return buildHelpPanelData(state.group, state.cursor, language);
    })(),
    btwPanel: (context as { btwPanelState?: NonNullable<ShellViewModel["btwPanel"]> })
      .btwPanelState,
    sessionsPanel: (
      context as { sessionsPanelState?: NonNullable<ShellViewModel["sessionsPanel"]> }
    ).sessionsPanelState,
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

function selectStreamingAssistantText(
  context: TuiContext,
  blocks: ProductBlockViewModel[],
): string | undefined {
  const streaming = (context as { streamingAssistant?: { id: string; text: string } })
    .streamingAssistant;
  if (!streaming) return undefined;
  const text = streaming.text.trimEnd();
  if (!text) return undefined;
  const matchingFinalBlock = blocks.find(
    (block) => block.id === streaming.id && block.messageKind === "assistant_text",
  );
  if ((matchingFinalBlock?.fullText ?? "").trimEnd() === text) return undefined;
  return streaming.text;
}

function groupTranscriptToolBlocks(
  blocks: ProductBlockViewModel[],
  language: Language,
): ProductBlockViewModel[] {
  const result: ProductBlockViewModel[] = [];
  let group: ProductBlockViewModel[] = [];

  const flush = () => {
    if (group.length >= 2) {
      result.push(createGroupedToolBlock(group, language));
    } else {
      result.push(...group);
    }
    group = [];
  };

  for (const block of blocks) {
    if (classifyToolGroupingBlock(block)) {
      group.push(block);
      continue;
    }
    flush();
    result.push(block);
  }
  flush();
  return result;
}

type ToolGroupingKind = "read" | "search" | "extension" | "agent" | "workflow" | "verification";

function classifyToolGroupingBlock(block: ProductBlockViewModel): ToolGroupingKind | undefined {
  if (block.status === "fail" || block.status === "blocked") return undefined;
  const text = `${block.title}\n${block.summary}\n${block.fullText ?? ""}`.trim();
  if (/^(?:Read\(|读取摘要|Read summary)/iu.test(text)) return "read";
  if (/^(?:Grep\(|Glob\(|搜索摘要|文件搜索摘要|Search summary|File search summary)/iu.test(text)) {
    return "search";
  }
  if (
    /(?:已发现\s+\d+\s+个扩展工具|扩展工具调用(?:完成|失败)|Found\s+\d+\s+extension tool|Extension tool (?:finished|call failed))/iu.test(
      text,
    )
  ) {
    return "extension";
  }
  if (
    /(?:已(?:启动|停止|检查|更新)后台智能体|智能体已完成|background agent|agent completed|Checked background agents|Stopped \d+ background agent)/iu.test(
      text,
    )
  ) {
    return "agent";
  }
  if (
    /(?:工作流已完成|已启动后台工作流|工作流结果已记录|Workflow completed|Started a background workflow|Recorded the workflow result)/iu.test(
      text,
    )
  ) {
    return "workflow";
  }
  if (/(?:验证已结束|Verification finished)/iu.test(text)) return "verification";
  return undefined;
}

function createGroupedToolBlock(
  blocks: ProductBlockViewModel[],
  language: Language,
): ProductBlockViewModel {
  const counts = new Map<ToolGroupingKind, number>();
  for (const block of blocks) {
    const kind = classifyToolGroupingBlock(block);
    if (!kind) continue;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const summary = formatToolGroupSummary(counts, blocks.length, language);
  const details = blocks
    .map((block, index) => {
      const body = (block.fullText ?? block.summary ?? block.title).trim();
      return `${index + 1}. ${body}`;
    })
    .join("\n\n");
  return {
    id: `tool-group-${blocks[0]?.id ?? Date.now()}-${blocks.length}`,
    kind: "tool",
    status: blocks.some((block) => block.status === "partial") ? "partial" : "info",
    title: "",
    summary,
    fullText: details,
    nextAction: shellText[language].detailsHint,
    ctrlOCollapsed: true,
    messageKind: "tool_result_success",
  };
}

function formatToolGroupSummary(
  counts: Map<ToolGroupingKind, number>,
  fallbackCount: number,
  language: Language,
): string {
  const ordered: ToolGroupingKind[] = [
    "read",
    "search",
    "extension",
    "agent",
    "workflow",
    "verification",
  ];
  const zhLabels: Record<ToolGroupingKind, string> = {
    read: "读取",
    search: "搜索",
    extension: "扩展工具",
    agent: "后台智能体",
    workflow: "工作流",
    verification: "验证",
  };
  const enLabels: Record<ToolGroupingKind, string> = {
    read: "read",
    search: "search",
    extension: "extension",
    agent: "agent",
    workflow: "workflow",
    verification: "verification",
  };
  const parts = ordered.flatMap((kind) => {
    const count = counts.get(kind) ?? 0;
    if (count <= 0) return [];
    return language === "en-US"
      ? [`${enLabels[kind]} ${count}`]
      : [`${zhLabels[kind]} ${count} 项`];
  });
  if (language === "en-US") {
    return `Tool activity grouped: ${parts.join(", ") || `${fallbackCount} item(s)`}.`;
  }
  return `工具活动已分组：${parts.join("，") || `${fallbackCount} 项`}。`;
}

function estimateTranscriptTailHeight({
  streamingAssistantText,
  activity,
  suggestions,
  limitations,
  width,
}: {
  streamingAssistantText?: string;
  activity?: TaskActivityView;
  suggestions?: TaskSuggestion[];
  limitations: string[];
  width: number;
}): number {
  let height = 0;
  if (streamingAssistantText)
    height += 1 + estimateWrappedTextHeight(streamingAssistantText, width);
  if (activity) height += 2;
  if (suggestions && suggestions.length > 0) height += 1;
  if (limitations.length > 0) height += 1 + limitations.length;
  return height;
}

function buildTranscriptVirtualWindow({
  context,
  blocks,
  width,
  height,
  scroll,
  tailHeight,
  enabled,
}: {
  context: TuiContext;
  blocks: ProductBlockViewModel[];
  width: number;
  height: number;
  scroll: TranscriptScrollView | undefined;
  tailHeight: number;
  enabled: boolean;
}): { blocks: ProductBlockViewModel[]; range?: TranscriptVirtualRangeView } {
  if (!enabled || blocks.length === 0) {
    return { blocks };
  }

  const cacheOwner = context as { transcriptBlockHeightCache?: TranscriptBlockHeightCache };
  cacheOwner.transcriptBlockHeightCache ??= {};
  const cache = cacheOwner.transcriptBlockHeightCache;
  const heights = blocks.map((block) => estimateBlockHeight(block, width, cache));
  const blockContentHeight = heights.reduce((sum, value) => sum + value, 0);
  const estimatedContentHeight = blockContentHeight + tailHeight;
  const viewportHeight = scroll?.viewportHeight ?? Math.max(1, height - 8);
  const maxOffset = Math.max(0, estimatedContentHeight - viewportHeight);
  const bottomOffset =
    (scroll?.stickToBottom ?? true) ? 0 : Math.min(scroll?.scrollOffset ?? 0, maxOffset);
  const topOffset = Math.max(0, maxOffset - bottomOffset);
  const overscan = Math.max(8, Math.ceil(viewportHeight * 0.75));
  const windowTop = Math.max(0, topOffset - overscan);
  const windowBottom = Math.min(estimatedContentHeight, topOffset + viewportHeight + overscan);

  let startIndex = 0;
  let cursor = 0;
  while (startIndex < blocks.length) {
    const currentHeight = heights[startIndex] ?? 1;
    if (cursor + currentHeight > windowTop) break;
    cursor += currentHeight;
    startIndex += 1;
  }
  let endIndex = startIndex;
  let endCursor = cursor;
  while (endIndex < blocks.length && endCursor < windowBottom) {
    endCursor += heights[endIndex] ?? 1;
    endIndex += 1;
  }

  if (startIndex >= blocks.length && blocks.length > 0) {
    startIndex = Math.max(0, blocks.length - 1);
    endIndex = blocks.length;
    cursor = blockContentHeight - (heights[startIndex] ?? 1);
    endCursor = blockContentHeight;
  }

  const rendered = blocks.slice(startIndex, endIndex);
  const range: TranscriptVirtualRangeView = {
    startIndex,
    endIndex,
    topSpacer: cursor,
    bottomSpacer: Math.max(0, blockContentHeight - endCursor),
    estimatedContentHeight,
    renderedBlockCount: rendered.length,
    totalBlockCount: blocks.length,
  };
  return { blocks: rendered, range };
}

function estimateBlockHeight(
  block: ProductBlockViewModel,
  width: number,
  cache: TranscriptBlockHeightCache,
): number {
  const textHash = blockTextHash(block);
  const cached = cache[block.id];
  if (
    cached &&
    cached.width === width &&
    (cached.textHash === textHash || cached.textHash === "measured")
  ) {
    return cached.height;
  }
  const estimated = estimateBlockHeightUncached(block, width);
  cache[block.id] = { height: estimated, width, textHash };
  return estimated;
}

function estimateBlockHeightUncached(block: ProductBlockViewModel, width: number): number {
  const contentWidth = Math.max(8, width - 4);
  const body = (block.fullText ?? block.summary ?? block.title ?? "").trim();
  let lines = estimateWrappedTextHeight(body || block.summary || block.title || "", contentWidth);
  if (block.title && !body.includes(block.title)) lines += 1;
  if (block.detail) lines += estimateWrappedTextHeight(block.detail, contentWidth);
  if (block.nextAction) lines += 1;
  if (block.kind === "command" || block.messageKind === "user_text") lines += 1;
  if (block.messageKind === "assistant_text") lines += 1;
  if (block.messageKind === "assistant_thinking") lines += 1;
  if (block.kind === "permission" || block.kind === "error" || block.status === "fail") lines += 2;
  return Math.max(1, lines);
}

function estimateWrappedTextHeight(text: string, width: number): number {
  const normalized = text.replace(/\r/g, "").trim();
  if (!normalized) return 1;
  const wrapWidth = Math.max(8, width);
  return normalized.split("\n").reduce((total, line) => {
    const lineWidth = displayWidth(line || " ");
    return total + Math.max(1, Math.ceil(lineWidth / wrapWidth));
  }, 0);
}

function blockTextHash(block: ProductBlockViewModel): string {
  const text = `${block.kind}\n${block.status}\n${block.messageKind ?? ""}\n${block.title}\n${block.summary}\n${block.detail ?? ""}\n${block.nextAction ?? ""}\n${block.fullText ?? ""}`;
  if (text.length <= 160) return `${text.length}:${text}`;
  return `${text.length}:${text.slice(0, 80)}:${text.slice(-80)}`;
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

/**
 * D.13Q-UX Real Smoke Fix v2 — D. busy guard。
 * 模型仍在处理上一条请求时返回 true：
 *   - submitted=true 且 activity 还没出真实 phase（首帧 fallback）
 *   - activity.phase ∈ {thinking, tool_running, continuing, permission_waiting}
 *   - context.activeAbortController 存在（streaming 在跑）
 */
function computeComposerBusy(args: {
  submitted?: boolean;
  activity: TaskActivityView | undefined;
  context: TuiContext;
}): boolean {
  const { submitted, activity, context } = args;
  const hasActiveAbort = Boolean(
    (context as { activeAbortController?: { signal?: { aborted?: boolean } } })
      .activeAbortController,
  );
  const phase = activity?.phase;
  if (
    phase === "thinking" ||
    phase === "tool_running" ||
    phase === "continuing" ||
    phase === "permission_waiting"
  ) {
    return true;
  }
  if (submitted) return true;
  if (hasActiveAbort) return true;
  return false;
}

function withPermissionActions(
  permission: TaskPermissionView,
  language: Language,
  context: TuiContext,
): TaskPermissionView {
  if (permission.actions && permission.actions.length > 0) return permission;
  // 主屏暴露 4 个成熟动作：allow_once / allow_always_tool / deny / details。
  // 仍走 buildElevationOptions（以保留 allow_always_tool 在已有 allow 规则时
  // 自动隐藏的逻辑）。
  const existingRules = context.permissions?.rules ?? [];
  const elevation = buildElevationOptions({
    toolName: permission.toolName as ToolName,
    scope: permission.scope,
    risk: permission.risk,
    existingRules,
    language,
  });
  const visibleIds = new Set(["allow_once", "allow_always_tool", "deny", "details"] as const);
  const actions: PermissionAction[] = elevation
    .filter((o) => visibleIds.has(o.id as "allow_once" | "allow_always_tool" | "deny"))
    .map((o) => ({
      id: o.id,
      label:
        o.id === "allow_once"
          ? language === "zh-CN"
            ? "是"
            : "Yes"
          : o.id === "allow_always_tool"
            ? buildAllowAlwaysLabel(permission.toolName, language)
            : o.id === "details"
              ? language === "zh-CN"
                ? "详情"
                : "Details"
              : language === "zh-CN"
                ? "否"
                : "No",
      shortcut: o.shortcut,
    }));
  return { ...permission, actions };
}

function buildOneShotPermissionActions(language: Language): PermissionAction[] {
  const isEn = language === "en-US";
  return [
    { id: "allow_once", label: isEn ? "Yes" : "是", shortcut: "y" },
    { id: "deny", label: isEn ? "No" : "否", shortcut: "n" },
    { id: "details", label: isEn ? "Details" : "详情", shortcut: "d" },
  ];
}

function buildAllowAlwaysLabel(toolName: string, language: Language): string {
  const isEn = language === "en-US";
  if (toolName === "Bash") {
    return isEn ? "Allow future similar Bash actions" : "允许以后这类 Bash 操作";
  }
  if (toolName === "Write" || toolName === "Edit" || toolName === "MultiEdit") {
    return isEn ? "Allow future similar file changes" : "允许以后这类文件修改";
  }
  return isEn ? "Allow future similar actions" : "允许以后这类操作";
}

export function getComposerPlaceholder(language: Language): string {
  return shellText[language].placeholder;
}

// P1-1 — tool-output-presenter 在正文里内嵌的折叠提示行。ink 主屏统一用
// block.nextAction 渲染 Ctrl+O 提示，所以 createOutputBlock 在装配 block 前
// 把这些内嵌行剥掉，避免同一块出现两次 Ctrl+O。两种语言、可能带 "- " 前缀。
const EMBEDDED_FOLD_HINTS = [
  "输出已折叠，按 Ctrl+O 展开。",
  "Output folded. Press Ctrl+O to expand.",
];

function stripEmbeddedFoldHint(text: string): { text: string; stripped: boolean } {
  if (!text) return { text, stripped: false };
  const lines = text.split("\n");
  let stripped = false;
  const kept = lines.filter((line) => {
    const trimmed = line.replace(/^[-\s]+/, "").trim();
    if (EMBEDDED_FOLD_HINTS.includes(trimmed)) {
      stripped = true;
      return false;
    }
    return true;
  });
  return { text: kept.join("\n").trim(), stripped };
}

export function createOutputBlock(
  text: string,
  language: Language,
  id = `output-${Date.now()}`,
): ProductBlockViewModel {
  const rawNormalized = redactSensitiveText(text.replace(/\r/g, "").trim());
  // P1-1 — Ctrl+O hint 单一来源：tool-output-presenter 在正文里自带一行折叠
  // 提示（"输出已折叠，按 Ctrl+O 展开。" / "Output folded. Press Ctrl+O to
  // expand."）。ink 主屏的 Ctrl+O 提示统一由 block.nextAction（detailsHint）
  // 渲染，所以这里把正文内嵌的折叠提示行剥掉，避免同一块出现两次 Ctrl+O。
  // 命中折叠提示即视为"显式折叠"，强制挂 nextAction。
  const foldHintStripped = stripEmbeddedFoldHint(rawNormalized);
  const normalized = foldHintStripped.text;
  const explicitFold = foldHintStripped.stripped;
  const copy = shellText[language];
  const summary =
    (explicitFold ? summarizeExplicitFold(normalized) : normalized) || copy.noVisibleOutput;
  // D.13Q-UX Real Smoke Fix v3 — 不再用正文关键词（错误|失败|error|failed）
  // 决定 block 是否失败。/mcp status 这类 diagnostic 文案里出现"启动或检测
  // 失败会隔离"会被旧实现整块标红，造成用户以为 MCP 不可用。失败必须由结构化
  // 来源（tool_result_error、command exit fail、明确 error block）显式传入；
  // 普通 writeLine 一律走 info / assistant_text，由 ProductBlock 的
  // assistant_text 分支用 Markdown 渲染多行正文。
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
  const toolResultLike = isToolResultLike(normalized);
  const hasMore =
    explicitFold ||
    (toolResultLike &&
      normalized.length > 0 &&
      (nonEmptyLineCount >= 6 || normalized.length > summary.length + 16));
  return {
    id,
    kind: "details",
    status: "info",
    // D13E-P3 empty title: drop the fixed "最近输出" / "Latest output" title
    // for normal outputs so ProductBlock renders only the summary line and
    // adjacent normal outputs breathe instead of stacking duplicate banners.
    title: "",
    summary,
    nextAction: hasMore ? copy.detailsHint : undefined,
    // Preserve the full body so /details can reveal it. The summary keeps the
    // first non-empty line for the inline block; multi-line outputs (e.g. the
    // /model doctor body with provider.env merge / endpointPath / providers)
    // are no longer truncated to the first line at this boundary.
    fullText: normalized,
    // D.13Q-UX: 普通 writeLine 走 assistant_text，让 ProductBlock 的 messageKind
    // 分支用 Markdown 渲染多行正文，而不是把多行文本压成 cyan/info dot 单行。
    // 真正的工具错误由调用方走显式的 tool_result_error block / fail status，
    // 不再由这里的关键词扫描决定。
    messageKind: "assistant_text",
  };
}

function isToolResultLike(text: string): boolean {
  return /^(?:工具\s+\w+\s+已完成|Tool\s+\w+\s+completed|(?:Bash|Read|Grep|Glob|Write|Edit|MultiEdit|Todo|Diff)\s+(?:摘要|summary)|搜索摘要|文件搜索摘要|读取摘要|Bash 已结束|Search summary|File search summary|Read summary|Bash finished)/u.test(
    text.trim(),
  );
}

function summarizeExplicitFold(text: string): string {
  const lines = text.split("\n");
  const nonEmpty = lines.filter((line) => line.trim().length > 0);
  if (nonEmpty.length <= 1) return nonEmpty[0] ?? text;
  return nonEmpty.slice(0, 5).join("\n");
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
  // D.13Q-UX Real Smoke Fix v3 — Ctrl+O hint 必须只在真正可展开时显示。
  //   - fullText 比 summary 多内容（多行 / 单行长出 16 字符以上）才算"被折叠"；
  //   - 普通块 / 错误块共用同一判定，避免短错误（"已拒绝 Bash"）也挂 Ctrl+O。
  // 区别仅在文案：fail/blocked 用 errorDetailsHint（"按 Ctrl+O 查看完整错误"），
  // 其余用 detailsHint（"Ctrl+O 查看完整内容"）。
  const fullText = block.fullText ?? "";
  const summary = block.summary ?? "";
  const nonEmptyLines = fullText.split("\n").filter((line) => line.trim().length > 0).length;
  const toolResultLike = isToolResultLike(fullText);
  const messageKind = block.messageKind;
  const foldableNonAssistant =
    messageKind !== undefined &&
    messageKind !== "assistant_text" &&
    messageKind !== "assistant_thinking" &&
    messageKind !== "user_text";
  const isFailLike = block.status === "fail" || block.status === "blocked";
  const hasMore =
    fullText.length > 0 &&
    (Boolean(block.nextAction && /Ctrl\+O/i.test(block.nextAction)) ||
      Boolean(block.ctrlOCollapsed) ||
      (isFailLike && (nonEmptyLines >= 2 || fullText.length > summary.length + 16)) ||
      (foldableNonAssistant && nonEmptyLines >= 2) ||
      (toolResultLike && (nonEmptyLines >= 6 || fullText.length > summary.length + 16)));
  if (!hasMore) return block;
  const existingCtrlOHint = block.nextAction && /Ctrl\+O/i.test(block.nextAction);
  const nonCtrlOAction = block.nextAction && !existingCtrlOHint;
  if (nonCtrlOAction) return block;
  return {
    ...block,
    nextAction: block.nextAction ?? (isFailLike ? copy.errorDetailsHint : copy.detailsHint),
    ctrlOCollapsed: true,
  };
}

function applyCtrlOExpandState(
  block: ProductBlockViewModel,
  state: { active?: boolean; blockId?: string } | undefined,
): ProductBlockViewModel {
  if (!state?.active) return block;
  if (state.blockId && state.blockId !== block.id) return block;
  const fullText = (block.fullText ?? "").trim();
  if (!fullText) return block;
  return {
    ...block,
    summary: fullText,
    nextAction: undefined,
    ctrlOCollapsed: false,
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
  const startedAt = (context as { requestActivityStartedAt?: number }).requestActivityStartedAt;
  let elapsed: string | undefined;
  if (startedAt && mapped !== "completed" && mapped !== "error") {
    elapsed = formatElapsedSince(new Date(startedAt).toISOString());
  }
  return {
    phase: mapped,
    text: texts[mapped] ?? "",
    toolName: toolName ?? undefined,
    elapsed,
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
        plan?: { path?: string };
        indexAction?: "init fast" | "refresh" | "repair";
        mutation?: { action?: string };
        action?: string;
        assetPath?: string;
        agentId?: string;
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

  // P0-1 — /index repair 的 ignore 写入也是一次 Write 提权；ink 主屏必须走
  // PermissionPanel，而不是 writeLine 文本。映射成 Write 语义的权限视图。
  if (approval.kind === "index_ignore_write") {
    const path = approval.plan?.path ?? ".linghunignore";
    const isEn = context.language === "en-US";
    return {
      toolName: "Write",
      reason: "",
      risk: "medium",
      scope: [path],
      hint: "",
      actionSummary: isEn ? `Edit file: ${path}` : `修改文件：${path}`,
      actions: buildOneShotPermissionActions(context.language),
      explanationLines: buildPermissionExplanationLines("mutating", "medium", context.language),
    };
  }

  // D.14D-R P0-2 — 结构化索引工具（IndexRefresh / IndexRepair）的 mutating 提权，
  // ink 主屏走同一 PermissionPanel；动作说明用人话。
  if (approval.kind === "index_tool") {
    const isEn = context.language === "en-US";
    const action =
      approval.indexAction === "repair"
        ? "repair"
        : approval.indexAction === "init fast"
          ? "init fast"
          : "refresh";
    const actionSummary = isEn
      ? action === "repair"
        ? "Repair and refresh the codebase index"
        : action === "init fast"
          ? "Initialize the codebase index in fast mode"
          : "Refresh (rebuild) the codebase index"
      : action === "repair"
        ? "修复并刷新代码索引"
        : action === "init fast"
          ? "快速初始化代码索引"
          : "刷新（重建）代码索引";
    return {
      toolName:
        action === "repair"
          ? "修复代码索引"
          : action === "init fast"
            ? "初始化代码索引"
            : "刷新代码索引",
      reason: "",
      risk: "medium",
      scope: [],
      hint: "",
      actionSummary,
      actions: buildOneShotPermissionActions(context.language),
      explanationLines: buildPermissionExplanationLines("mutating", "medium", context.language),
    };
  }

  if (approval.kind === "memory_mutation") {
    const isEn = context.language === "en-US";
    const action = approval.mutation?.action ?? "update";
    return {
      toolName: "Write",
      reason: "",
      risk: "medium",
      scope: [],
      hint: "",
      actionSummary: isEn ? `Update controlled memory: ${action}` : `更新受控记忆：${action}`,
      actions: buildOneShotPermissionActions(context.language),
      explanationLines: buildPermissionExplanationLines("mutating", "medium", context.language),
    };
  }

  if (approval.kind === "break_cache_mutation") {
    const isEn = context.language === "en-US";
    const action = approval.action ?? "update";
    return {
      toolName: "Write",
      reason: "",
      risk: "medium",
      scope: [".linghun/break-cache"],
      hint: "",
      actionSummary: isEn
        ? `Update break-cache marker: ${action}`
        : `更新 break-cache marker：${action}`,
      actions: buildOneShotPermissionActions(context.language),
      explanationLines: buildPermissionExplanationLines("mutating", "medium", context.language),
    };
  }

  if (approval.kind === "image_generation") {
    const isEn = context.language === "en-US";
    return {
      toolName: "Write",
      reason: "",
      risk: "medium",
      scope: approval.assetPath ? [approval.assetPath] : [".linghun/assets"],
      hint: "",
      actionSummary: isEn ? "Write image metadata" : "写入 image metadata",
      actions: buildOneShotPermissionActions(context.language),
      explanationLines: buildPermissionExplanationLines("mutating", "medium", context.language),
    };
  }

  // D.14D-R2 P1-1 — 模型工具 GitStablePointCreate 的提权，ink 主屏走同一 PermissionPanel。
  if (approval.kind === "git_stable_point") {
    const isEn = context.language === "en-US";
    return {
      toolName: "GitStablePointCreate",
      reason: "",
      risk: "medium",
      scope: [],
      hint: "",
      actionSummary: isEn
        ? "Create a stable point (git commit / snapshot) for the workspace"
        : "为工作区创建稳定点（git commit / snapshot）",
      actions: buildOneShotPermissionActions(context.language),
      explanationLines: buildPermissionExplanationLines("mutating", "medium", context.language),
    };
  }

  if (
    approval.kind === "model_tool_use" ||
    approval.kind === "architecture_drift" ||
    approval.kind === "agent_tool_use"
  ) {
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
      actions:
        approval.kind === "model_tool_use" ? [] : buildOneShotPermissionActions(context.language),
      explanationLines:
        approval.kind === "agent_tool_use"
          ? [
              context.language === "en-US"
                ? `Child agent ${approval.agentId ?? "unknown"} requested this tool.`
                : `子 agent ${approval.agentId ?? "unknown"} 请求该工具。`,
              ...explanationLines,
            ]
          : explanationLines,
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

function selectBackgroundSummaryInput(
  summaries: BackgroundTaskSummary[] | undefined,
  context: TuiContext,
): BackgroundTaskSummary[] {
  if (summaries === undefined) return [];
  const selected: BackgroundTaskSummary[] = [];
  const seen = new Set<string>();
  const add = (candidate: Partial<BackgroundTaskSummary>): void => {
    if (
      typeof candidate.id !== "string" ||
      typeof candidate.title !== "string" ||
      typeof candidate.status !== "string" ||
      seen.has(candidate.id)
    ) {
      return;
    }
    seen.add(candidate.id);
    selected.push(candidate as BackgroundTaskSummary);
  };
  for (const summary of summaries) add(summary);
  for (const summary of context.backgroundTasks ?? []) {
    if (isMainScreenBackgroundSummary(summary)) add(summary);
  }
  return selected;
}

function mapBackgroundSummariesToBlocks(
  summaries: BackgroundTaskSummary[],
  language: Language,
): ProductBlockViewModel[] {
  const visibleSummaries = summaries.filter(isMainScreenBackgroundSummary);
  if (visibleSummaries.length === 0) return [];
  const zh = language === "zh-CN";
  const running = visibleSummaries.filter((s) => s.status === "running").length;
  const needConfirm = visibleSummaries.filter((s) => s.status === "paused").length;
  const blocked = visibleSummaries.filter((s) => s.status === "blocked").length;
  const stale = visibleSummaries.filter((s) => s.status === "stale").length;
  const timeout = visibleSummaries.filter((s) => s.status === "timeout").length;
  const failed = visibleSummaries.filter((s) => s.status === "failed").length;
  const cancelled = visibleSummaries.filter((s) => s.status === "cancelled").length;
  const completed = visibleSummaries.filter((s) => s.status === "completed").length;
  const agents = visibleSummaries.filter((s) => s.kind === "agent").length;
  const current =
    visibleSummaries.find((s) => s.status === "blocked") ??
    visibleSummaries.find((s) => s.status === "running") ??
    visibleSummaries.find((s) => s.status === "paused") ??
    visibleSummaries.find((s) => s.status === "stale") ??
    visibleSummaries.find((s) => s.status === "timeout") ??
    visibleSummaries.find((s) => s.status === "failed") ??
    visibleSummaries.find((s) => s.status === "cancelled") ??
    visibleSummaries.find((s) => s.status === "completed") ??
    visibleSummaries[0];
  const nextAction =
    createBackgroundNextAction(current, language) ??
    (zh
      ? "这是后台任务状态；用 /background 查看任务面板。"
      : "This is background task status; use /background for the task panel.");
  return [
    {
      id: "bg-summary",
      kind: "run",
      status: backgroundBlockStatus({
        running,
        needConfirm,
        blocked,
        stale,
        timeout,
        failed,
        cancelled,
      }),
      title: formatBackgroundSummaryTitle(
        {
          total: visibleSummaries.length,
          agents,
          needConfirm,
          blocked,
          running,
          stale,
          timeout,
          failed,
          cancelled,
          completed,
        },
        language,
      ),
      summary: current
        ? summarizeBackgroundStep(current, language)
        : zh
          ? "后台任务摘要已折叠。"
          : "Background task summary is folded.",
      nextAction,
    },
  ];
}

function createBackgroundNextAction(
  task: BackgroundTaskSummary | undefined,
  language: Language,
): string | undefined {
  if (!task) return undefined;
  const zh = language === "zh-CN";
  return zh
    ? "查看 /background；完整排查入口在 /details、/job report 或日志。"
    : "Use /background; full troubleshooting lives in /details, /job report, or logs.";
}

function formatFooterRuntimeStatus(
  block: ProductBlockViewModel,
  language: Language,
  summaries: BackgroundTaskSummary[],
): string {
  const zh = language === "zh-CN";
  const visibleSummaries = summaries.filter(
    (summary) => summary.kind !== "agent" || summary.status === "running",
  );
  const running = visibleSummaries.filter((task) => task.status === "running").length;
  const needConfirm = visibleSummaries.filter((task) => task.status === "paused").length;
  const blocked = visibleSummaries.filter((task) => task.status === "blocked").length;
  const total = visibleSummaries.length;
  const agents = visibleSummaries.filter((task) => task.kind === "agent").length;
  const pieces = [zh ? `后台 ${total}` : `background ${total}`];
  if (agents > 0) pieces.push(zh ? `智能体 ${agents}` : `agents ${agents}`);
  if (needConfirm > 0)
    pieces.push(zh ? `需要确认 ${needConfirm}` : `need attention ${needConfirm}`);
  if (blocked > 0) pieces.push(zh ? `阻塞 ${blocked}` : `blocked ${blocked}`);
  if (running > 0) pieces.push(zh ? `运行中 ${running}` : `running ${running}`);
  pieces.push(zh ? "详情 /background" : "details /background");
  return pieces.join(" · ");
}

function formatFooterWorkspaceStatus(
  context: TuiContext,
  projectName: string,
  language: Language,
): string {
  const zh = language === "zh-CN";
  const label = zh ? "工作树" : "Workspace";
  const path = basename(context.projectPath) || projectName;
  return `${label}：${truncateMiddle(path, 36)}`;
}

function summarizeBackgroundStep(task: BackgroundTaskSummary, language: Language): string {
  const zh = language === "zh-CN";
  switch (task.status) {
    case "running":
      return zh
        ? "后台任务正在运行；详情、日志和报告请到展开入口查看。"
        : "Background task is running; use details, logs, or report for full output.";
    case "blocked":
    case "paused":
      return zh
        ? "后台任务需要处理；主屏只显示摘要。"
        : "Background task needs attention; the main screen shows only a summary.";
    case "stale":
      return zh
        ? "后台任务可能卡住或长时间无输出；请查看详情或日志。"
        : "Background task may be stale or quiet; inspect details or logs.";
    case "timeout":
      return zh
        ? "后台任务已超时；不要把它当作通过。"
        : "Background task timed out; do not treat it as passed.";
    case "cancelled":
      return zh
        ? "后台任务已取消；需要时从详情或日志继续排查。"
        : "Background task was cancelled; inspect details or logs if needed.";
    case "completed":
      return zh
        ? "后台任务已结束；结果以详情、日志或报告为准。"
        : "Background task completed; trust details, logs, or report for the result.";
    case "failed":
      return zh
        ? "后台任务异常结束；请查看详情、日志或报告。"
        : "Background task ended with a problem; inspect details, logs, or report.";
    default:
      return zh
        ? "后台任务摘要已折叠；完整内容在详情、日志或报告。"
        : "Background task summary is folded; full content is in details, logs, or report.";
  }
}

function isMainScreenBackgroundSummary(summary: BackgroundTaskSummary): boolean {
  return (
    summary.status === "running" ||
    summary.status === "paused" ||
    summary.status === "blocked" ||
    summary.status === "stale" ||
    summary.status === "cancelled" ||
    summary.status === "timeout" ||
    summary.status === "completed" ||
    summary.status === "failed"
  );
}

function backgroundBlockStatus(counts: {
  running: number;
  needConfirm: number;
  blocked: number;
  stale: number;
  timeout: number;
  failed: number;
  cancelled: number;
}): ProductBlockViewModel["status"] {
  if (counts.blocked > 0 || counts.needConfirm > 0 || counts.stale > 0) return "blocked";
  if (counts.timeout > 0 || counts.failed > 0) return "fail";
  if (counts.running > 0) return "running";
  if (counts.cancelled > 0) return "partial";
  return "info";
}

function formatBackgroundSummaryTitle(
  counts: {
    total: number;
    agents: number;
    needConfirm: number;
    blocked: number;
    running: number;
    stale: number;
    timeout: number;
    failed: number;
    cancelled: number;
    completed: number;
  },
  language: Language,
): string {
  const zh = language === "zh-CN";
  const pieces = [zh ? `后台 ${counts.total}` : `Background ${counts.total}`];
  if (counts.agents > 0) pieces.push(zh ? `智能体 ${counts.agents}` : `agents ${counts.agents}`);
  if (counts.needConfirm > 0)
    pieces.push(zh ? `需要确认 ${counts.needConfirm}` : `need attention ${counts.needConfirm}`);
  if (counts.blocked > 0) pieces.push(zh ? `阻塞 ${counts.blocked}` : `blocked ${counts.blocked}`);
  if (counts.running > 0)
    pieces.push(zh ? `运行中 ${counts.running}` : `running ${counts.running}`);
  if (counts.stale > 0) pieces.push(zh ? `可能卡住 ${counts.stale}` : `stale ${counts.stale}`);
  if (counts.timeout > 0) pieces.push(zh ? `超时 ${counts.timeout}` : `timeout ${counts.timeout}`);
  if (counts.failed > 0) pieces.push(zh ? `异常 ${counts.failed}` : `failed ${counts.failed}`);
  if (counts.cancelled > 0)
    pieces.push(zh ? `已取消 ${counts.cancelled}` : `cancelled ${counts.cancelled}`);
  if (counts.completed > 0)
    pieces.push(zh ? `已结束 ${counts.completed}` : `completed ${counts.completed}`);
  return pieces.join(" · ");
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
