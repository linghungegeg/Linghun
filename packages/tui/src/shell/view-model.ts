import { basename } from "node:path";
import type { CacheTurnStats } from "@linghun/core";
import { type Language, type PermissionMode, TOGGLE_DETAILS_KEYBIND } from "@linghun/shared";
import type { ToolName } from "@linghun/tools";
import { calculateContextPercentages, formatContextProgressBar } from "../context-window-runtime.js";
import type { BackgroundTaskState, TuiContext } from "../index.js";
import { formatElapsedSince } from "../job-runner-presenter.js";
import {
  projectWorkRequestState,
  type WorkRequestState,
} from "../request-lifecycle-presenter.js";
import { DEFAULT_KEYBINDINGS } from "../keybinding-runtime.js";
import { sanitizeMainScreenLeakage } from "../model-prompt-runtime.js";
import { SLASH_COMMAND_REGISTRY } from "../natural-command-bridge.js";
import { formatPermissionModeLabel, permissionModeColor, permissionModeSymbol } from "../runtime-status-presenter.js";
import { buildHelpPanelData } from "./models/help-panel.js";
import { buildElevationOptions } from "./models/permission-elevation.js";
import {
  type PathSafety,
  type PolicySemantic,
  explainHowToUpdate,
  explainPolicyVerdict,
  explainSemantic,
} from "./models/permission-explanation.js";
import {
  type TranscriptSelectionState,
  buildTranscriptScreenBuffer,
  selectionLineIndexesForBlock,
  selectionLineRangesForBlock,
} from "./models/transcript-selection-state.js";
import {
  transcriptSourceToBlocks,
  type TranscriptSource,
} from "./models/transcript-source.js";
import {
  buildAgentProgressTreeView,
  buildBackgroundTaskOverlayView,
  buildTaskListView,
  buildWorkflowProgressView,
} from "./progress-views.js";
import { shouldUseNativeScrollbackTaskFrame } from "./native-scrollback-frame.js";
import { charWidth, truncateMiddle } from "./text-utils.js";
import type {
  BackgroundTaskSummary,
  CommandPanelView,
  ConfigPanelView,
  LegacyShellViewMode,
  NotificationView,
  PermissionAction,
  ProductBlockViewModel,
  ShellViewMode,
  ShellViewModel,
  BottomPaneStatusView,
  TaskActivityView,
  TaskFooterView,
  TaskPermissionView,
  TaskSuggestion,
  TranscriptScrollView,
  VisibleWorkState,
} from "./types.js";

const shellText = {
  "zh-CN": {
    brand: "LingHun",
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
    latestOutputNext: `按 ${TOGGLE_DETAILS_KEYBIND} 查看完整运行时输出（或 /details）。`,
    detailsHint: `${TOGGLE_DETAILS_KEYBIND} 查看完整内容`,
    errorTitle: (tool: string) => `${tool} 失败`,
    errorDetailsHint: `${TOGGLE_DETAILS_KEYBIND} 查看完整错误`,
    activityError: "请求失败，可重试或用 /model doctor 排查。",
    activityCompleted: "已完成。",
    denied: (tool: string) => `已拒绝 ${tool}，工具未执行。`,
    cancelled: (tool: string) => `已取消 ${tool}，工具未执行。`,
  },
  "en-US": {
    brand: "LingHun",
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
    latestOutputNext: `Press ${TOGGLE_DETAILS_KEYBIND} for full runtime output (or /details).`,
    detailsHint: `${TOGGLE_DETAILS_KEYBIND} for details`,
    errorTitle: (tool: string) => `${tool} failed`,
    errorDetailsHint: `${TOGGLE_DETAILS_KEYBIND} for full error`,
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
  viewMode?: LegacyShellViewMode;
  activity?: TaskActivityView;
  permission?: TaskPermissionView;
  outputBlocks?: ProductBlockViewModel[];
  transcriptSource?: TranscriptSource;
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
  /** Rows required by Composer-owned transient overlays such as slash suggestions. */
  composerOverlayRows?: number;
  /** Current Composer draft, used to restore input across renderer remounts. */
  composerDraftText?: string;
  /**
   * D.13E Step 2 — ConfigPanel state (panel_list / panel_detail / undefined).
   * View-model maps this to ShellViewModel.configPanel via mapConfigPanelState.
   */
  configPanelState?:
    | { phase: "panel_list"; cursor: number; scrollOffset: number }
    | { phase: "panel_detail"; panelId: string; actionCursor: number; scrollOffset: number };
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
  const sourceOutputBlocks = options.transcriptSource?.cells.length
    ? transcriptSourceToBlocks(options.transcriptSource)
    : undefined;
  const staticHistoryBlocks = sourceOutputBlocks ?? options.outputBlocks ?? [];

  // Determine effective view mode early to decide block filtering and setupHint visibility.
  // Runtime no longer enters HomeLayout; an idle Ink shell is still a TaskLayout.
  const requestedViewMode = options.viewMode === "home" ? "task" : options.viewMode;
  const effectiveViewMode: ShellViewMode =
    requestedViewMode ?? (options.submitted ? "pending" : "task");

  // D.13Q-UX Real Smoke Fix v2 — A. submitted=true 且 options.activity 缺省时，
  // 合成一条 thinking fallback activity，避免任务页首帧空白（submittedPending
  // 已切到 pending viewMode，但 requestActivityPhase 尚未由 streaming 链路置位
  // 时，主屏没有任何提交反馈，看上去像消息被吞）。
  // 真实 activity（mapRequestActivityToView）会覆盖此 fallback。
  const effectiveActivity: TaskActivityView | undefined =
    options.activity ??
    (options.submitted
      ? {
          phase: "thinking",
          text: language === "en-US" ? "Submitting request…" : "提交请求…",
          language,
          elapsed: formatElapsedSince(
            new Date(options.submittedStartedAt ?? Date.now()).toISOString(),
          ),
        }
      : context.lastModelRequest
        ? deriveBackgroundActivityFallback(context, language)
        : undefined);

  // setup-needed: surface as setupHint in the task surface.
  // While the model setup flow is actively running (pendingModelSetup), the
  // composer's step label + step placeholder is the single source of truth, so
  // we suppress the redundant setupHint to keep the task region clean.
  const setupActiveFlow = Boolean(context.pendingModelSetup?.step);
  const setupHint = setupNeeded && !setupActiveFlow ? text.setupHint : undefined;

  // blocks 只保留 project-route、background summaries 和 output（最多 3 条）
  // 当 permission pending 时，不显示 output block 以避免权限提示双重显示
  // setup 进行中时不显示 background blocks
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
  const taskRuntimeSummary = undefined;
  let hasRecoveredAfterProviderFailure = false;
  if (!options.permission && !setupActiveFlow) {
    // Plan A single ownership: in native scrollback mode, committed rows are
    // physically removed from options.outputBlocks and live in the terminal's
    // own scrollback. The Ink bottom frame must render ONLY the live
    // (uncommitted) blocks, otherwise blocks that already scrolled into
    // terminal history would keep piling into the fixed-height frame and
    // compress after a few turns. transcriptSource stays canonical for the
    // non-native staticHistory replay path and Ctrl+O expansion.
    const allOutputBlocks = shouldUseNativeScrollbackTaskFrame()
      ? (options.outputBlocks ?? [])
      : (sourceOutputBlocks ?? options.outputBlocks ?? []);
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
    const maxEphemeral = 20;
    const dropEphemeralIndices = new Set<number>(
      ephemeralIndices.length > maxEphemeral
        ? ephemeralIndices.slice(0, ephemeralIndices.length - maxEphemeral)
        : [],
    );
    const activeStreamingAssistant = context.streamingAssistant;
    const activeStreamingAssistantId = activeStreamingAssistant?.id;
    const hasActiveProviderFailure = Boolean(context.lastProviderFailure);
    const activeRequestPhase = (context as { requestActivityPhase?: string }).requestActivityPhase;
    const hasActiveRequestActivity = isActiveRequestActivityPhase(activeRequestPhase);
    const hasActiveTaskActivity = isActiveTaskActivity(effectiveActivity);
    const staleProviderFailureBlockIds = new Set<string>();
    const staleCompactBoundaryBlockIds = new Set<string>();
    const activeCompactBoundaryBlockIds = new Set<string>();
    let latestProviderFailureBlockId: string | undefined;
    for (const block of allOutputBlocks) {
      if (block.messageKind === "compact_boundary") {
        activeCompactBoundaryBlockIds.add(block.id);
        continue;
      }
      if (activeCompactBoundaryBlockIds.size > 0 && isCompactBoundarySupersededBy(block)) {
        for (const id of activeCompactBoundaryBlockIds) staleCompactBoundaryBlockIds.add(id);
        activeCompactBoundaryBlockIds.clear();
      }
      if (isProviderFailureOutputBlock(block, language)) {
        latestProviderFailureBlockId = block.id;
        continue;
      }
      if (latestProviderFailureBlockId && isProviderRecoveryProgressBlock(block, language)) {
        staleProviderFailureBlockIds.add(latestProviderFailureBlockId);
        latestProviderFailureBlockId = undefined;
      }
    }
    hasRecoveredAfterProviderFailure = staleProviderFailureBlockIds.size > 0;
    const selectedBlocks = allOutputBlocks.filter((b, i) => {
      if (isEmptyAssistantStreamBlock(b)) return false;
      if (
        isProviderFailureOutputBlock(b, language) &&
        (!hasActiveProviderFailure || hasActiveRequestActivity || staleProviderFailureBlockIds.has(b.id))
      ) {
        return false;
      }
      if (
        b.messageKind === "compact_boundary" &&
        (hasActiveRequestActivity || hasActiveTaskActivity || staleCompactBoundaryBlockIds.has(b.id))
      ) {
        return false;
      }
      if (
        activeStreamingAssistantId &&
        b.id === activeStreamingAssistantId &&
        b.messageKind === "assistant_text"
      ) {
        return (b.fullText ?? "").trim().length > 0;
      }
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

  const fittedBlocks = blocks.map((block) => fitBlockToWidth(block, width));
  const transcriptSelectionState = (
    context as { transcriptSelectionState?: TranscriptSelectionState }
  ).transcriptSelectionState;
  const transcriptRows = transcriptSelectionState
    ? buildTranscriptScreenBuffer(fittedBlocks, Math.max(8, width - 4)).rows
    : [];
  const fullFittedBlocks = transcriptSelectionState
    ? fittedBlocks.map((block) => {
        const selectionLineIndexes = selectionLineIndexesForBlock(
          transcriptSelectionState,
          transcriptRows,
          block.id,
        );
        const selectionLineRanges = selectionLineRangesForBlock(
          transcriptSelectionState,
          transcriptRows,
          block.id,
        );
        return selectionLineIndexes.length > 0 || selectionLineRanges.length > 0
          ? { ...block, selectionLineIndexes, selectionLineRanges }
          : block;
      })
    : fittedBlocks;

  const viewMode = effectiveViewMode;

  const homeVision = "";

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
  const taskFooter: TaskFooterView | undefined = buildTaskFooterView({
    language,
    width,
    permissionModeLabel: formatPermissionModeLabel(context.permissionMode, language),
    permissionMode: context.permissionMode,
    cyclePermHint,
    effectiveModel: context.model,
    setupNeeded,
    cacheHitRate: computeRecentCacheHitRate(context.cache?.history ?? []),
    indexStatus: context.index.status,
    reasoningLevel: options.reasoningLevel,
    reasoningSent: options.reasoningSent,
    estimatedCostCny: sumFiniteNumbers((context.roleUsage ?? []).map((usage) => usage.estimatedCny)),
    contextUsage: context.cache.contextUsage
      ? {
          ...calculateContextPercentages(
            Math.ceil(context.cache.contextUsage.estimatedChars / 4),
            Math.ceil(context.cache.contextUsage.maxChars / 4),
          ),
          savingsRatio: context.cache.contextUsage.savingsRatio,
        }
      : undefined,
    isRemoteMode: context.remote?.enabled ?? false,
  });

  // D.13E Step 2 — TaskSuggestionBar 数据。
  // 在 task / pending 模式渲染。
  const hasProviderFailureOutputBlock = fullFittedBlocks.some((b) =>
    isProviderFailureOutputBlock(b, language),
  );
  const failBlocksForSuggestions = fullFittedBlocks.filter(
    (b) =>
      (b.status === "fail" || b.status === "blocked") &&
      !isProviderFailureOutputBlock(b, language),
  );
  const taskSuggestions: TaskSuggestion[] | undefined = buildTaskSuggestions({
    language,
    setupHint,
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
  // Main transcript scroll：task/pending 模式默认吸底。
  const transcriptScroll: TranscriptScrollView | undefined =
    (context as { transcriptScrollState?: TranscriptScrollView }).transcriptScrollState ?? {
      scrollOffset: 0,
      stickToBottom: true,
    };
  updateUnseenTranscriptCount(context, effectiveViewMode, transcriptScroll, fullFittedBlocks.length);
  const agentProgressTree = buildAgentProgressTreeView(context);
  const taskListView = buildTaskListView(context);
  const visibleWorkState = deriveVisibleWorkState(context);
  const workflowProgressView =
    visibleWorkState.multiAgentWorkflowRunning
      ? undefined
      : buildWorkflowProgressView(context);
  const backgroundTaskOverlay = buildBackgroundTaskOverlayView(
    context,
    options.backgroundSummaries ?? [],
  );
  const unseenMessageCount = !visibleWorkState.scrollDetached ? 0 : visibleWorkState.unseenCount;
  const permissionView = options.permission
    ? withPermissionActions(options.permission, language, context)
    : undefined;
  const permissionActivity = permissionView
    ? createPermissionWaitingActivity(context, permissionView)
    : undefined;
  const visibleActivity = permissionActivity ?? effectiveActivity;
  const workRequestState = deriveWorkRequestState(context, {
    permission: permissionView,
    visibleWorkState,
  });
  const streamingAssistantText = permissionView
    ? undefined
    : selectStreamingAssistantText(context, fullFittedBlocks);
  const bottomPaneStatus = mapBottomPaneStatusToView(context, {
    activity: visibleActivity,
    permission: permissionView,
    visibleWorkState,
    workRequestState,
    suppressProviderFailure: hasProviderFailureOutputBlock || hasRecoveredAfterProviderFailure,
  });

  return {
    language,
    projectName,
    projectPath: context.projectPath,
    keybindings:
      (context as { keybindings?: ShellViewModel["keybindings"] }).keybindings ??
      DEFAULT_KEYBINDINGS,
    width,
    height,
    mode: "ink",
    themeMode: options.noColor ? "no-color" : "color",
    viewMode,
    brand: text.brand,
    homeVision,
    setupHint,
    activity: visibleActivity,
    bottomPaneStatus,
    permission: permissionView,
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
      draftText: options.composerDraftText,
      masking: context.pendingModelSetup?.step === "apiKey",
      setupActive,
      setupStep: composerSetupStepLabel,
      busy: computeComposerBusy({
        submitted: options.submitted,
        activity: visibleActivity,
        context,
      }),
      busyHint: computeComposerBusy({
        submitted: options.submitted,
        activity: visibleActivity,
        context,
      })
        ? language === "en-US"
          ? "Still working on the previous request. Press Ctrl+C to interrupt, then send again."
          : "正在处理上一条，按 Ctrl+C 可中断，稍后再发。"
        : undefined,
    },
    blocks: fullFittedBlocks,
    staticHistoryBlocks,
    staticHistoryReplayGeneration: (context as { transcriptStaticReplayGeneration?: number })
      .transcriptStaticReplayGeneration,
    transcriptVirtualRange: undefined,
    streamingAssistantText,
    ctrlOExpand: ctrlOExpandState?.active
      ? { active: true, ...(ctrlOExpandState.blockId ? { blockId: ctrlOExpandState.blockId } : {}) }
      : { active: false },
    limitations: options.limitations ?? [],
    taskFooter,
    composerOverlayRows: Math.max(0, Math.floor(options.composerOverlayRows ?? 0)),
    taskRuntimeSummary: taskRuntimeSummary ? fitBlockToWidth(taskRuntimeSummary, width) : undefined,
    agentProgressTree,
    taskListView,
    visibleWorkState,
    workflowProgressView,
    backgroundTaskOverlay,
    taskSuggestions: taskSuggestions && taskSuggestions.length > 0 ? taskSuggestions : undefined,
    taskSuggestionCursor,
    configPanel,
    commandPanel,
    transcriptScroll,
    transcriptViewportGeometry: (
      context as { transcriptViewportGeometry?: ShellViewModel["transcriptViewportGeometry"] }
    ).transcriptViewportGeometry,
    unseenMessageCount,
    helpPanel: (() => {
      const state = (
        context as { helpPanelState?: { group: "core" | "advanced" | "details"; cursor: number; scrollOffset: number } }
      ).helpPanelState;
      if (!state) return undefined;
      return buildHelpPanelData(state.group, state.cursor, state.scrollOffset ?? 0, language);
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
      if (live.length !== ctxNotifs.length) {
        (context as { notifications?: NotificationView[] }).notifications = live;
      }
      return live.length > 0 ? [...live] : undefined;
    })(),
  };
}

function sumFiniteNumbers(values: number[]): number | undefined {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return undefined;
  return finite.reduce((total, value) => total + value, 0);
}

function selectStreamingAssistantText(
  context: TuiContext,
  blocks: ProductBlockViewModel[],
): string | undefined {
  if (context.briefMode) return undefined;
  const streaming = context.streamingAssistant;
  if (!streaming) return undefined;
  const previewText = streaming.text || streaming.tailText || "";
  const matchingFinalBlock = blocks.find(
    (block) => block.id === streaming.id && block.messageKind === "assistant_text",
  );
  const committedText = matchingFinalBlock?.fullText || streaming.committedText || "";
  const tailText =
    committedText && previewText.startsWith(committedText)
      ? previewText.slice(committedText.length)
      : (streaming.tailText ?? previewText);
  const text = tailText.trimEnd();
  if (!text) return undefined;
  if ((matchingFinalBlock?.fullText ?? "").trimEnd() === previewText.trimEnd()) return undefined;
  if (committedText.trim().length > 0) return tailText;
  return previewText;
}

function groupTranscriptToolBlocks(
  blocks: ProductBlockViewModel[],
  language: Language,
): ProductBlockViewModel[] {
  const result: ProductBlockViewModel[] = [];
  let group: ProductBlockViewModel[] = [];

  const flush = () => {
    if (group.length >= 3) {
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
    /(?:工作流已完成|已启动后台工作流|工作流结果已记录|Workflow completed|Started a background workflow|Recorded the workflow result|多智能体协作|Multi-agent collaboration)/iu.test(
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

function updateUnseenTranscriptCount(
  context: TuiContext,
  viewMode: "task" | "pending",
  scroll: TranscriptScrollView | undefined,
  blockCount: number,
): void {
  const state = context as {
    unseenMessageCount?: number;
    lastTranscriptBlockCount?: number;
  };
  const previousCount = state.lastTranscriptBlockCount ?? blockCount;
  const delta = Math.max(0, blockCount - previousCount);
  const detached = scroll?.stickToBottom === false;

  if (!detached) {
    state.unseenMessageCount = 0;
  } else if (delta > 0) {
    state.unseenMessageCount = (state.unseenMessageCount ?? 0) + delta;
  }

  state.lastTranscriptBlockCount = blockCount;
}

const CONFIG_PANELS = [
  {
    id: "model",
    slash: "/model",
    titleZh: "模型",
    titleEn: "Model",
    summaryZh: "查看当前模型 / provider / 角色路由。",
    summaryEn: "Show current model / provider / role routing.",
  },
  {
    id: "language",
    slash: "/language",
    titleZh: "语言",
    titleEn: "Language",
    summaryZh: "切换 zh-CN / en-US 体验。",
    summaryEn: "Switch zh-CN / en-US UI.",
  },
  {
    id: "permissions",
    slash: "/permissions",
    titleZh: "权限规则",
    titleEn: "Permissions",
    summaryZh: "查看 / 编辑 allow / ask / deny 规则。",
    summaryEn: "View / edit allow / ask / deny rules.",
  },
  {
    id: "memory",
    slash: "/memory",
    titleZh: "记忆",
    titleEn: "Memory",
    summaryZh: "查看 LINGHUN.md / 候选 / 已接受记忆。",
    summaryEn: "Show LINGHUN.md / candidate / accepted memory.",
  },
  {
    id: "index",
    slash: "/index",
    titleZh: "索引",
    titleEn: "Index",
    summaryZh: "查看 codebase 索引状态与诊断。",
    summaryEn: "Show codebase index status and doctor.",
  },
  {
    id: "mcp",
    slash: "/mcp",
    titleZh: "MCP",
    titleEn: "MCP",
    summaryZh: "查看 MCP server 与工具。",
    summaryEn: "Show MCP servers and tools.",
  },
  {
    id: "cache",
    slash: "/cache",
    titleZh: "缓存",
    titleEn: "Cache",
    summaryZh: "查看缓存命中与日志。",
    summaryEn: "Show cache hit and log.",
  },
  {
    id: "background",
    slash: "/background",
    titleZh: "后台任务",
    titleEn: "Background",
    summaryZh: "查看后台 job 与远程任务。",
    summaryEn: "Show background jobs and remote tasks.",
  },
  {
    id: "remote",
    slash: "/remote",
    titleZh: "远程",
    titleEn: "Remote",
    summaryZh: "查看远程会话与控制平面。",
    summaryEn: "Show remote sessions and control plane.",
  },
  {
    id: "hooks",
    slash: "/doctor",
    titleZh: "Hooks",
    titleEn: "Hooks",
    summaryZh: "查看 hooks 启用与诊断。",
    summaryEn: "Show hook enablement and doctor.",
  },
  {
    id: "plugins",
    slash: "/plugins",
    titleZh: "插件",
    titleEn: "Plugins",
    summaryZh: "查看插件 manifest 与诊断。",
    summaryEn: "Show plugin manifests and doctor.",
  },
  {
    id: "skills",
    slash: "/skills",
    titleZh: "技能",
    titleEn: "Skills",
    summaryZh: "查看本地 skill 摘要。",
    summaryEn: "Show local skill summaries.",
  },
  {
    id: "workflows",
    slash: "/workflows",
    titleZh: "工作流",
    titleEn: "Workflows",
    summaryZh: "查看可用工作流模板。",
    summaryEn: "Show available workflow templates.",
  },
  {
    id: "trust",
    slash: "/trust",
    titleZh: "信任",
    titleEn: "Trust",
    summaryZh: "查看 / 调整本项目信任级别。",
    summaryEn: "Show / adjust project trust level.",
  },
] as const;

/**
 * D.13E Step 2 — 把 controller 持有的 configPanelState 映射成 ShellViewModel.configPanel。
 * 只装配 i18n / 列表数据，不带任何键盘事件；导航事件由 ConfigPanel 组件自己 useInput
 * → controller.onInput({ type: "config-*" }) 触发。
 */

export function buildConfigPanelActions(
  panelId: string,
  language: Language,
): { id: string; label: string }[] {
  const isEn = language === "en-US";
  if (panelId === "language") {
    return [
      { id: "lang-zh", label: isEn ? "Switch to Chinese (zh-CN)" : "切换到中文 (zh-CN)" },
      { id: "lang-en", label: isEn ? "Switch to English (en-US)" : "切换到英文 (en-US)" },
    ];
  }
  return [];
}

function mapConfigPanelState(
  state:
    | { phase: "panel_list"; cursor: number; scrollOffset: number }
    | { phase: "panel_detail"; panelId: string; actionCursor: number; scrollOffset: number },
  language: Language,
): ConfigPanelView | undefined {
  if (state.phase === "panel_detail") {
    const panel = CONFIG_PANELS.find((p) => p.id === state.panelId);
    if (!panel) return undefined;
    const actions = buildConfigPanelActions(state.panelId, language);
    return {
      phase: "panel_detail",
      panel: {
        id: panel.id,
        title: language === "en-US" ? panel.titleEn : panel.titleZh,
        summary: language === "en-US" ? panel.summaryEn : panel.summaryZh,
      },
      actionCursor: Math.min(Math.max(0, state.actionCursor), Math.max(0, actions.length - 1)),
      scrollOffset: state.scrollOffset ?? 0,
      actions,
    };
  }
  const panels = CONFIG_PANELS.map((p) => ({
    id: p.id,
    slash: p.slash,
    title: language === "en-US" ? p.titleEn : p.titleZh,
    summary: language === "en-US" ? p.summaryEn : p.summaryZh,
  }));
  const total = panels.length;
  const cursor =
    total === 0
      ? 0
      : Math.min(Math.max(0, state.phase === "panel_list" ? state.cursor : 0), total - 1);
  return { phase: "panel_list", cursor, scrollOffset: state.scrollOffset ?? 0, panels };
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
  if (context.pendingLocalApproval) return true;
  if (isActiveTaskActivity(activity)) return true;
  if (submitted) return true;
  if (hasActiveAbort) return true;
  return false;
}

function isActiveTaskActivity(activity: TaskActivityView | undefined): boolean {
  const phase = activity?.phase;
  return (
    phase === "thinking" ||
    phase === "tool_running" ||
    phase === "continuing" ||
    phase === "permission_waiting"
  );
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
    if (
      EMBEDDED_FOLD_HINTS.includes(trimmed) ||
      /^\[stdout\]\s*\.\.\.\s*(?:更多输出已隐藏；按 Ctrl\+O 展开。|more output hidden; press Ctrl\+O to expand\.)$/iu.test(
        trimmed,
      )
    ) {
      stripped = true;
      return false;
    }
    return true;
  });
  return { text: kept.join("\n").trim(), stripped };
}

function hasPresenterHiddenSummary(text: string): boolean {
  if (/^\s*\.\.\.\s*(?:另有 \d+ 项在详情中。|\d+ more item\(s\) in details\.)/mu.test(text)) {
    return true;
  }
  const firstLine = text.split(/\r?\n/u).find((line) => line.trim().length > 0) ?? "";
  if (/^(?:Read\(|Read\b|读取)/u.test(firstLine)) {
    const readTotalMatch = text.match(/(?:总计|total)\s+(\d+)\s+(?:行|line(?:\(s\))?)/iu);
    if (readTotalMatch) {
      const readTotal = Number(readTotalMatch[1]);
      return Number.isFinite(readTotal) && readTotal > 100;
    }
  }
  const statMatch = text.match(
    /^[-\s]*(?:(?:窗口|window)\s+(\d+)\/(\d+)\s+(?:行|line\(s\))|(\d+)\s+(?:行|line\(s\)))/mu,
  );
  if (!statMatch) return false;
  const shown = Number(statMatch[1] ?? statMatch[3]);
  const total = statMatch[2] ? Number(statMatch[2]) : shown;
  if (!Number.isFinite(shown) || !Number.isFinite(total)) return false;
  if (/^(?:Bash\(|Bash\b)/u.test(firstLine)) return total > 5;
  if (/^(?:Read\(|Read\b|读取)/u.test(firstLine)) return total > 100 || shown < total;
  if (/^(?:Grep\b|Glob\b|找到\b|Found\b)/u.test(firstLine)) return total > 0;
  if (/^(?:Write|Edit|MultiEdit)(?:\(|\b)/u.test(firstLine)) return true;
  return false;
}

export function createOutputBlock(
  text: string,
  language: Language,
  id = `output-${Date.now()}`,
): ProductBlockViewModel {
  const rawNormalized = sanitizeMainScreenLeakage(
    redactSensitiveText(text.replace(/\r/g, "").trim()),
    language,
  );
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
  const toolCallLike = isToolCallLike(normalized);
  const toolResultLike = !toolCallLike && isToolResultLike(normalized);
  const toolResultErrorLike = toolResultLike && isToolResultErrorLike(normalized);
  const hasMore =
    explicitFold ||
    hasPresenterHiddenSummary(normalized) ||
    (toolResultLike &&
      normalized.length > 0 &&
      (nonEmptyLineCount >= 6 || normalized.length > summary.length + 16));
  const messageKind = toolCallLike
    ? "tool_call"
    : toolResultErrorLike
      ? "tool_result_error"
      : toolResultLike
        ? "tool_result_success"
        : "assistant_text";
  const displayBlock = {
    kind: messageKind,
    title: toolCallLike || toolResultLike ? summary.split("\n", 1)[0] : undefined,
    status: toolCallLike ? "running" : toolResultErrorLike ? "error" : toolResultLike ? "success" : "info",
    summary,
    body: normalized,
    collapsible: hasMore,
    bordered: toolCallLike || toolResultLike,
  } as const;
  return {
    id,
    kind: toolCallLike ? "tool" : toolResultErrorLike ? "error" : "details",
    status: toolCallLike ? "running" : toolResultErrorLike ? "fail" : "info",
    // D13E-P3 empty title: drop the fixed "最近输出" / "Latest output" title
    // for normal outputs so ProductBlock renders only the summary line and
    // adjacent normal outputs breathe instead of stacking duplicate banners.
    title: toolCallLike || toolResultErrorLike ? summary.split("\n", 1)[0] : "",
    summary,
    nextAction: hasMore ? copy.detailsHint : undefined,
    // Preserve the full body so /details can reveal it. The summary keeps the
    // first non-empty line for the inline block; multi-line outputs (e.g. the
    // /model doctor body with provider.env merge / endpointPath / providers)
    // are no longer truncated to the first line at this boundary.
    fullText: normalized,
    messageKind,
    displayBlock,
  };
}

function isToolCallLike(text: string): boolean {
  return /^(?:Bash|Read|ReadSnippets|SourcePack|Write|Edit|MultiEdit|Grep|Glob)\([^\n]{1,160}\)$/u.test(
    text.trim(),
  );
}

function isToolResultLike(text: string): boolean {
  return /^(?:工具\s+\w+\s+已完成|Tool\s+\w+\s+completed|(?:Bash|Read|Grep|Glob|Write|Edit|MultiEdit)\(|Bash\s+(?:✓|✗)|找到\s+\*\*?\d+\*\*?\s+(?:处匹配|个文件)|读取\s+\*\*?\d+\*\*?\s+行|(?:Found|Read)\s+\*\*?\d+\*\*?|(?:Bash|Read|Grep|Glob|Write|Edit|MultiEdit|Todo|Diff)\s+(?:摘要|summary)|Todo[:：]|搜索摘要|文件搜索摘要|读取摘要|Bash 已结束|Search summary|File search summary|Read summary|Bash finished)/u.test(
    text.trim(),
  );
}

function isToolResultErrorLike(text: string): boolean {
  return /^(?:Bash\s+✗|.*(?:退出|exit)\s+\d+)/iu.test(text.trim());
}

function summarizeExplicitFold(text: string): string {
  const lines = text.split("\n");
  const nonEmpty = lines.filter((line) => line.trim().length > 0);
  if (nonEmpty.length <= 1) return nonEmpty[0] ?? text;
  return nonEmpty.slice(0, 5).join("\n");
}

export function createCompactBoundaryBlock(
  preChars: number,
  postChars: number,
  language: Language,
): ProductBlockViewModel {
  const freedPct = preChars > 0 ? Math.round(((preChars - postChars) / preChars) * 100) : 0;
  const freedK = Math.max(0, Math.round((preChars - postChars) / 1024));
  const copy = shellText[language];
  const title =
    language === "en-US"
      ? `Conversation compacted · ~${freedK}K chars freed (${freedPct}%)`
      : `对话已压缩 · 释放约 ${freedK}K 字符 (${freedPct}%)`;
  return {
    id: `compact-boundary-${Date.now()}`,
    kind: "details",
    status: "info",
    title,
    summary: "",
    messageKind: "compact_boundary",
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
    compacting_context: "continuing",
    provider_retrying: "thinking",
    provider_recovering: "continuing",
    provider_switching: "continuing",
    tool_running: "tool_running",
    continuing_after_tool: "continuing",
    checking_final_evidence: "continuing",
    collecting_final_evidence: "continuing",
    rewriting_final_answer: "continuing",
    verifying_final_answer: "continuing",
    permission_waiting: "permission_waiting",
    request_failed: "error",
    error: "error",
    failed: "error",
    completed: "completed",
    request_completed: "completed",
  };
  const mapped = phaseMap[phase];
  if (!mapped) return undefined;

  if (context.briefMode && (mapped === "thinking" || mapped === "continuing")) {
    return undefined;
  }

  const toolName = (context as { requestActivityToolName?: string }).requestActivityToolName;
  const retryInfo = (context as { retryInfo?: { attempt: number; max: number; delaySec: number } })
    .retryInfo;
  const textMap: Record<string, Record<string, string>> = {
    "zh-CN": {
      thinking: "思考中…",
      provider_retrying: retryInfo
        ? `自动重试 ${retryInfo.attempt}/${retryInfo.max} · ${retryInfo.delaySec}s 后继续`
        : "自动重试…",
      provider_recovering: "恢复流并压缩上下文…",
      compacting_context: "正在压缩上下文…",
      provider_switching: "切换备用模型…",
      tool_running: toolName ? `运行 ${toolName}…` : "运行工具…",
      continuing: "整理工具结果…",
      checking_final_evidence: "检查最终证据…",
      collecting_final_evidence: "补齐最终证据…",
      rewriting_final_answer: "重写最终回答…",
      verifying_final_answer: "验证回答…",
      permission_waiting: "等待权限确认",
      error: shellText["zh-CN"].activityError,
      completed: shellText["zh-CN"].activityCompleted,
    },
    "en-US": {
      thinking: "Thinking…",
      provider_retrying: retryInfo
        ? `Automatic retry ${retryInfo.attempt}/${retryInfo.max} · ${retryInfo.delaySec}s remaining`
        : "Retrying…",
      provider_recovering: "Recovering stream and compacting context…",
      compacting_context: "Compacting context…",
      provider_switching: "Switching to backup model…",
      tool_running: toolName ? `Running ${toolName}…` : "Running tool…",
      continuing: "Reviewing tool result…",
      checking_final_evidence: "Checking final evidence…",
      collecting_final_evidence: "Collecting final evidence…",
      rewriting_final_answer: "Rewriting final answer…",
      verifying_final_answer: "Verifying answer…",
      permission_waiting: "Waiting for permission",
      error: shellText["en-US"].activityError,
      completed: shellText["en-US"].activityCompleted,
    },
  };
  const texts = textMap[context.language] ?? textMap["en-US"];
  const thinkingLabelMap: Record<string, Record<string, string>> = {
    "zh-CN": {
      request_started: "连接模型…",
      request_started_report: "生成报告…",
      waiting_first_delta: "等待模型响应…",
      compacting_context: "压缩上下文…",
      provider_retrying: "自动重试…",
      provider_recovering: "恢复中…",
      provider_switching: "切换模型…",
      checking_final_evidence: "检查证据…",
      collecting_final_evidence: "补证据…",
      rewriting_final_answer: "重写回答…",
    },
    "en-US": {
      request_started: "Connecting model…",
      request_started_report: "Generating report…",
      waiting_first_delta: "Waiting for model response…",
      compacting_context: "Compacting context…",
      provider_retrying: "Retrying…",
      provider_recovering: "Recovering…",
      provider_switching: "Switching model…",
      checking_final_evidence: "Checking evidence…",
      collecting_final_evidence: "Collecting evidence…",
      rewriting_final_answer: "Rewriting answer…",
    },
  };
  const thinkingLabels = thinkingLabelMap[context.language] ?? thinkingLabelMap["en-US"];
  const startedAt = (context as { requestActivityStartedAt?: number }).requestActivityStartedAt;
  let elapsed: string | undefined;
  if (startedAt && mapped !== "completed" && mapped !== "error") {
    elapsed = formatElapsedSince(new Date(startedAt).toISOString());
  }
  return {
    phase: mapped,
    text: texts[phase] ?? texts[mapped] ?? "",
    toolName: toolName ?? undefined,
    toolTarget: (context as { requestActivityToolTarget?: string }).requestActivityToolTarget,
    elapsed,
    language: context.language,
    totalLines: (context as { requestActivityToolLines?: number }).requestActivityToolLines,
    totalBytes: (context as { requestActivityToolBytes?: number }).requestActivityToolBytes,
    thinkingLabel: thinkingLabels[phase],
  };
}

function createPermissionWaitingActivity(
  context: TuiContext,
  permission: TaskPermissionView,
): TaskActivityView {
  const startedAt = (context as { requestActivityStartedAt?: number }).requestActivityStartedAt;
  return {
    phase: "permission_waiting",
    text:
      context.language === "en-US"
        ? `Waiting for approval · ${permission.toolName}`
        : `等待确认 · ${permission.toolName}`,
    toolName: permission.toolName,
    elapsed: startedAt ? formatElapsedSince(new Date(startedAt).toISOString()) : undefined,
    language: context.language,
  };
}

function deriveWorkRequestState(
  context: TuiContext,
  input: { permission?: TaskPermissionView; visibleWorkState?: VisibleWorkState },
): WorkRequestState | undefined {
  const retryInfo = (context as { retryInfo?: { attempt: number; max: number; delaySec: number } })
    .retryInfo;
  const phase = (context as { requestActivityPhase?: string }).requestActivityPhase;
  const startedAtMs = (context as { requestActivityStartedAt?: number }).requestActivityStartedAt;
  const visibleWork = input.visibleWorkState;
  return projectWorkRequestState({
    language: context.language,
    requestPhase: phase,
    startedAtMs,
    toolName: (context as { requestActivityToolName?: string }).requestActivityToolName,
    toolTarget: (context as { requestActivityToolTarget?: string }).requestActivityToolTarget,
    retryAttempt: retryInfo?.attempt,
    retryMax: retryInfo?.max,
    retryDelaySec: retryInfo?.delaySec,
    permissionToolName: input.permission?.toolName,
    permissionSummary: input.permission?.actionSummary,
    permissionNextAction: input.permission?.hint,
    agentsRunning: visibleWork?.agentsRunning,
    workflowRunning: visibleWork?.explicitWorkflowRunning,
    multiAgentWorkflowRunning: visibleWork?.multiAgentWorkflowRunning,
    backgroundTasksRunning: visibleWork?.backgroundTasksRunning,
    includeBackgroundRunning: true,
  });
}

function mapWorkRequestStateToBottomPaneStatus(work: WorkRequestState): BottomPaneStatusView {
  return {
    kind: mapWorkRequestPhaseToBottomKind(work.phase),
    source: mapWorkRequestSourceToBottomSource(work.source),
    text: work.title,
    reason: work.summary,
    nextAction: work.nextAction,
    elapsed: formatElapsedMs(work.elapsedMs),
  };
}

function mapWorkRequestPhaseToBottomKind(phase: WorkRequestState["phase"]): BottomPaneStatusView["kind"] {
  if (phase === "permission_waiting") return "action_required";
  if (phase === "verification_running") return "verifying";
  if (phase === "blocked") return "blocked";
  if (phase === "failed") return "failed";
  if (phase === "completed") return "completed_partial";
  return "running";
}

function mapWorkRequestSourceToBottomSource(
  source: WorkRequestState["source"],
): BottomPaneStatusView["source"] {
  if (source === "permission") return "permission";
  if (source === "tool") return "tool";
  if (source === "provider") return "provider";
  if (source === "agent") return "agent_workflow";
  if (source === "background") return "background";
  if (source === "verification") return "final_gate";
  if (source === "runner") return "resource";
  return "request";
}

function isForegroundWorkRequestState(work: WorkRequestState): boolean {
  return work.phase !== "agent_running" && work.phase !== "background_running";
}

function formatElapsedMs(elapsedMs: number | undefined): string | undefined {
  if (elapsedMs === undefined) return undefined;
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return `${minutes}m${rest.toString().padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${(minutes % 60).toString().padStart(2, "0")}m`;
}

export function mapBottomPaneStatusToView(
  context: TuiContext,
  input: {
    activity?: TaskActivityView;
    permission?: TaskPermissionView;
    visibleWorkState?: VisibleWorkState;
    workRequestState?: WorkRequestState;
    suppressProviderFailure?: boolean;
  } = {},
): BottomPaneStatusView | undefined {
  const language = context.language;
  const isEn = language === "en-US";
  const phase = (context as { requestActivityPhase?: string }).requestActivityPhase;

  if (input.workRequestState && isForegroundWorkRequestState(input.workRequestState)) {
    return mapWorkRequestStateToBottomPaneStatus(input.workRequestState);
  }

  const deferredWorkRequestStatus = input.workRequestState
    ? mapWorkRequestStateToBottomPaneStatus(input.workRequestState)
    : undefined;

  if (input.permission) {
    return {
      kind: "action_required",
      source: "permission",
      text: isEn
        ? `Waiting for approval · ${input.permission.toolName}`
        : `等待确认 · ${input.permission.toolName}`,
      reason: input.permission.actionSummary,
      nextAction: input.permission.hint,
      elapsed: input.activity?.elapsed,
    };
  }

  if (phase === "verifying_final_answer") {
    return {
      kind: "verifying",
      source: "final_gate",
      text: isEn ? "Verifying final answer…" : "验证最终回答…",
      nextAction: isEn ? "Keeping the draft out of scrollback until it is final." : "最终文本确认前不会写入 scrollback。",
      elapsed: input.activity?.elapsed,
    };
  }

  if (phase === "provider_recovering") {
    return {
      kind: "running",
      source: "provider",
      text: isEn ? "Recovering provider stream…" : "正在恢复 provider 流…",
      nextAction: isEn
        ? "Retrying with compacted context if needed."
        : "必要时会压缩上下文后重试。",
      elapsed: input.activity?.elapsed,
    };
  }

  if (phase === "provider_switching") {
    return {
      kind: "running",
      source: "provider",
      text: isEn ? "Switching provider/model…" : "正在切换 provider/model…",
      nextAction: isEn ? "Trying the configured fallback route." : "正在尝试配置的 fallback 路线。",
      elapsed: input.activity?.elapsed,
    };
  }

  const compactFailure = context.cache?.compactFailure;
  const compactCooldownUntil = Math.max(
    context.cache?.compactCooldownUntil ?? 0,
    context.cache?.deepCompactCooldownUntil ?? 0,
    compactFailure ? Date.parse(compactFailure.cooldownUntil) || 0 : 0,
  );
  if (compactFailure && (compactFailure.blocked || compactCooldownUntil > Date.now())) {
    return {
      kind: "blocked",
      source: "resource",
      text: isEn ? "Context budget blocked" : "上下文预算受限",
      reason: compactFailure.reason,
      nextAction: isEn
        ? "Retry after cooldown or reduce context pressure."
        : "等待冷却后重试，或降低上下文压力。",
    };
  }

  const fallback = context.lastProviderFallbackAttempt;
  if (fallback?.status === "attempted" || fallback?.status === "failed") {
    return {
      kind: fallback.status === "failed" ? "failed" : "blocked",
      source: "provider",
      text: isEn ? "Provider fallback active" : "Provider fallback 生效中",
      reason: fallback.summary,
      nextAction: isEn ? "Use /model doctor if it does not recover." : "若未恢复，请用 /model doctor 排查。",
      elapsed: input.activity?.elapsed,
    };
  }

  const providerFailure = context.lastProviderFailure;
  if (
    providerFailure &&
    !input.activity &&
    !input.suppressProviderFailure &&
    !isActiveRequestActivityPhase(phase)
  ) {
    const rateLimited = providerFailure.code === "PROVIDER_RATE_LIMITED";
    return {
      kind: rateLimited ? "blocked" : "failed",
      source: "provider",
      text: isEn ? "Provider request failed" : "Provider 请求失败",
      reason: providerFailure.summary,
      nextAction: isEn ? "Run /model doctor or retry after cooldown." : "运行 /model doctor，或冷却后重试。",
    };
  }

  if (input.activity) {
    if (input.activity.phase === "error") {
      return {
        kind: "failed",
        source: input.activity.toolName ? "tool" : "provider",
        text: input.activity.text,
        nextAction: isEn ? "Retry or inspect details." : "请重试或查看详情。",
      };
    }
    if (input.activity.phase === "completed") {
      return {
        kind: "completed_partial",
        source: "request",
        text: input.activity.text,
        nextAction: isEn
          ? "Completion is visible; verification evidence is tracked separately."
          : "结果已可见；验证证据单独追踪。",
      };
    }
    return {
      kind: "running",
      source: input.activity.phase === "tool_running" ? "tool" : "request",
      text: input.activity.text,
      reason:
        input.activity.phase === "tool_running" && input.activity.toolName
          ? `${input.activity.toolName}${input.activity.toolTarget ? `(${input.activity.toolTarget})` : ""}`
          : input.activity.thinkingLabel,
      elapsed: input.activity.elapsed,
    };
  }

  const work = input.visibleWorkState;
  if (deferredWorkRequestStatus) {
    return deferredWorkRequestStatus;
  }
  if (work && (work.agentsRunning > 0 || work.explicitWorkflowRunning || work.multiAgentWorkflowRunning)) {
    return {
      kind: "running",
      source: "agent_workflow",
      text:
        work.agentsRunning > 0
          ? isEn
            ? `${work.agentsRunning} agent(s) running`
            : `${work.agentsRunning} 个智能体运行中`
          : isEn
            ? "Workflow running"
            : "工作流运行中",
      nextAction: isEn ? "Use /agents or /workflows for details." : "可用 /agents 或 /workflows 查看详情。",
    };
  }

  const blockedBackground = (context.backgroundTasks ?? []).find((task) =>
    isActionableBlockedBackgroundTask(task, context.dismissedBackgroundTaskIds),
  );
  if (blockedBackground) {
    return {
      kind: "blocked",
      source: "resource",
      text: isEn ? "Background work is blocked" : "后台任务受阻",
      reason: blockedBackground.userVisibleSummary ?? blockedBackground.result,
      nextAction: blockedBackground.nextAction ?? (isEn ? "Use /background for details." : "用 /background 查看详情。"),
    };
  }

  return undefined;
}

function isActionableBlockedBackgroundTask(
  task: BackgroundTaskState,
  dismissedTaskIds?: Set<string>,
): boolean {
  if (dismissedTaskIds?.has(task.id)) return false;
  if (task.status === "blocked" || task.status === "paused") return true;
  if (task.status !== "running") return false;
  return /resource\/concurrency cap|并发上限/iu.test(
    `${task.result ?? ""} ${task.nextAction ?? ""} ${task.userVisibleSummary ?? ""}`,
  );
}

/**
 * When no explicit request activity exists but background agents/workflows/tools
 * are still active, synthesize a fallback activity indicator so the user sees
 * continuous feedback instead of a blank screen.
 */
function deriveBackgroundActivityFallback(
  context: TuiContext,
  language: Language,
): TaskActivityView | undefined {
  const runningAgents = (context.agents ?? []).filter((a) => a.status === "running");
  const runningWorkflows = (context.workflows?.activeRuns ?? []).filter(
    (r) => r.status === "running",
  );
  const activeRun = context.workflows?.activeRun;
  const runningBgTasks = (context.backgroundTasks ?? []).filter((t) => t.status === "running");

  if (runningAgents.length > 0) {
    const elapsed = formatElapsedForFirstTimestamp(runningAgents.map((agent) => agent.startedAt));
    const text =
      language === "en-US"
        ? runningAgents.length === 1
          ? `Waiting for agent ${runningAgents[0].displayName ?? runningAgents[0].addressableName ?? ""}…`
          : `${runningAgents.length} agents still working…`
        : runningAgents.length === 1
          ? `等待子智能体 ${runningAgents[0].displayName ?? runningAgents[0].addressableName ?? ""}…`
          : `${runningAgents.length} 个智能体仍在工作…`;
    return { phase: "continuing", text, language, elapsed };
  }
  if (runningWorkflows.length > 0 || (activeRun && activeRun.status === "running")) {
    const elapsed = formatElapsedForFirstTimestamp([
      ...runningWorkflows.map((run) => run.startedAt),
      activeRun && activeRun.status === "running" ? activeRun.startedAt : undefined,
    ]);
    const hasMultiAgent =
      runningWorkflows.some((r) => r.multiAgent === true) ||
      (activeRun && activeRun.status === "running" && activeRun.multiAgent === true);
    const text = hasMultiAgent
      ? language === "en-US"
        ? "Multi-agent collaboration running…"
        : "多智能体协作进行中…"
      : language === "en-US"
        ? "Workflow running…"
        : "工作流运行中…";
    return { phase: "continuing", text, language, elapsed };
  }
  if (runningBgTasks.length > 0) {
    const elapsed = formatElapsedForFirstTimestamp(runningBgTasks.map((task) => task.startedAt));
    const text =
      language === "en-US"
        ? `${runningBgTasks.length} background task(s) running…`
        : `${runningBgTasks.length} 个后台任务运行中…`;
    return { phase: "continuing", text, language, elapsed };
  }
  return undefined;
}

function formatElapsedForFirstTimestamp(values: Array<string | undefined>): string | undefined {
  const timestamps = values
    .map((value) => (value ? Date.parse(value) : Number.NaN))
    .filter((value) => Number.isFinite(value));
  if (timestamps.length === 0) return undefined;
  return formatElapsedSince(new Date(Math.min(...timestamps)).toISOString());
}

function deriveVisibleWorkState(context: TuiContext): VisibleWorkState {
  const requestPhase = (context as { requestActivityPhase?: string }).requestActivityPhase;
  const activeAbort = (context as { activeAbortController?: { signal?: { aborted?: boolean } } })
    .activeAbortController;
  const hasActiveAbort = Boolean(activeAbort && activeAbort.signal?.aborted !== true);
  const runningAgents = (context.agents ?? []).filter((a) => a.status === "running");
  const runningBackgroundTasks = (context.backgroundTasks ?? []).filter((t) => t.status === "running");
  const allActiveRuns = [
    ...(context.workflows?.activeRuns ?? []),
    ...(context.workflows?.activeRun ? [context.workflows.activeRun] : []),
  ];
  const runningWorkflows = allActiveRuns.filter((r) => r.status === "running");
  const hasMultiAgentWorkflow =
    runningWorkflows.some((r) => r.multiAgent === true) ||
    (runningAgents.length > 0 && runningWorkflows.length > 0 && !runningWorkflows.some((r) => r.phaseGateConfirmed));
  const hasExplicitWorkflow = runningWorkflows.some((r) => r.phaseGateConfirmed === true);
  const mainChainActive =
    hasActiveAbort ||
    (requestPhase !== undefined &&
      requestPhase !== "completed" &&
      requestPhase !== "request_completed");
  const pendingCompletionCount = (context.agentCompletions?.notices ?? []).filter(
    (n) => !n.reportedAt,
  ).length;
  const scrollState = (context as { transcriptScrollState?: { stickToBottom?: boolean } })
    .transcriptScrollState;
  const scrollDetached = scrollState ? scrollState.stickToBottom === false : false;
  const unseenCount = (context as { unseenMessageCount?: number }).unseenMessageCount ?? 0;
  return {
    mainRequestActive: mainChainActive,
    userInputPending:
      requestPhase === "request_started" || requestPhase === "waiting_first_delta",
    toolsRunning: requestPhase === "tool_running",
    agentsRunning: runningAgents.length,
    backgroundTasksRunning: runningBackgroundTasks.length,
    explicitWorkflowRunning: hasExplicitWorkflow,
    multiAgentWorkflowRunning: hasMultiAgentWorkflow,
    pendingCompletionCount,
    scrollDetached,
    unseenCount,
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
    const path = approval.plan?.path ?? ".cbmignore";
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
      actionSummary:
        approval.kind === "architecture_drift"
          ? buildArchitectureDriftActionSummary(
              context.language,
              toolName,
              approval.toolCall?.input,
            )
          : buildPermissionActionSummary(context.language, toolName, approval.toolCall?.input),
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
  if (
    toolName === "Read" ||
    toolName === "ReadSnippets" ||
    toolName === "SourcePack" ||
    toolName === "Glob" ||
    toolName === "Grep"
  ) {
    return "readonly";
  }
  if (toolName === "WebSearch" || toolName === "WebFetch") return "network";
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
  if (toolName === "Read" || toolName === "ReadSnippets" || toolName === "SourcePack") {
    const path = str("path") ?? str("file_path");
    if (path) return zh ? `读取文件：${path}` : `Read file: ${path}`;
    if (toolName === "ReadSnippets") return zh ? "读取代码片段" : "Read snippets";
    if (toolName === "SourcePack") return zh ? "定位代码片段" : "Locate source snippets";
  }
  if (toolName === "Glob" || toolName === "Grep") {
    const target = str("pattern") ?? str("path");
    if (target) return zh ? `搜索：${target}` : `Search: ${target}`;
  }
  if (toolName === "WebSearch") {
    const query = str("query");
    if (query) return zh ? `搜索网页：${query}` : `Web search: ${query}`;
  }
  if (toolName === "WebFetch") {
    const url = str("url");
    if (url) return zh ? `抓取网页：${url}` : `Web fetch: ${url}`;
  }
  return zh ? `使用工具：${toolName}` : `Use tool: ${toolName}`;
}

function buildArchitectureDriftActionSummary(
  language: Language,
  toolName: string,
  input: unknown,
): string {
  const action = buildPermissionActionSummary(language, toolName, input);
  return language === "en-US" ? `Confirm scope change: ${action}` : `确认范围变化：${action}`;
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

const KNOWN_SLASH_COMMANDS: ReadonlySet<string> = new Set(
  SLASH_COMMAND_REGISTRY.map((entry) => entry.slash),
);

function isKnownSlashCommand(command: string): boolean {
  if (!command.startsWith("/")) return false;
  if (KNOWN_SLASH_COMMANDS.has(command)) return true;
  const head = command.split(/\s+/, 1)[0];
  return Boolean(head && KNOWN_SLASH_COMMANDS.has(head));
}

function isProviderFailureOutputBlock(block: ProductBlockViewModel, language: Language): boolean {
  if (block.messageKind !== "tool_result_error") return false;
  const title = block.title.trim().toLowerCase();
  if (language === "en-US") {
    return title === "model request failed" || title === "provider request failed";
  }
  return title === "模型请求失败" || title === "provider 请求失败";
}

function isProviderRecoveryProgressBlock(block: ProductBlockViewModel, language: Language): boolean {
  if (isProviderFailureOutputBlock(block, language)) return false;
  return (
    block.messageKind === "assistant_text" ||
    block.messageKind === "tool_result_success" ||
    block.messageKind === "diagnostic" ||
    block.messageKind === "local_command_output"
  );
}

function isActiveRequestActivityPhase(phase: string | undefined): boolean {
  return (
    phase === "request_started" ||
    phase === "request_started_report" ||
    phase === "waiting_first_delta" ||
    phase === "compacting_context" ||
    phase === "provider_retrying" ||
    phase === "tool_running" ||
    phase === "continuing_after_tool" ||
    phase === "verifying_final_answer" ||
    phase === "permission_waiting"
  );
}

function isCompactBoundarySupersededBy(block: ProductBlockViewModel): boolean {
  if (block.messageKind === "compact_boundary") return false;
  if (
    block.keep === true &&
    block.kind === "details" &&
    (block.fullText ?? "").trim().length === 0 &&
    !block.title
  ) {
    return false;
  }
  return Boolean(block.messageKind || block.kind === "command");
}

function buildTaskSuggestions(inputs: {
  language: Language;
  setupHint?: string;
  failBlocks?: ProductBlockViewModel[];
  slashCandidates?: { slash: string; label: string }[];
  configHints?: { id: string; label: string; slash: string }[];
}): TaskSuggestion[] {
  const suggestions: TaskSuggestion[] = [];
  if (inputs.failBlocks?.length) {
    const latest = inputs.failBlocks[inputs.failBlocks.length - 1];
    suggestions.push({
      id: `tool_error:details:${latest?.id ?? "latest"}`,
      source: "tool_error",
      label: inputs.language === "en-US" ? "Show full error output" : "查看完整错误",
      hint:
        inputs.language === "en-US"
          ? `Press ${TOGGLE_DETAILS_KEYBIND} for the latest failure output (or /details)`
          : `按 ${TOGGLE_DETAILS_KEYBIND} 查看最近一次失败输出（或 /details）`,
      action: { kind: "slash", command: "/details" },
    });
  }
  if (inputs.setupHint) {
    suggestions.push({
      id: "setup:resume",
      source: "setup",
      label: inputs.language === "en-US" ? "Continue model setup" : "继续模型配置",
      hint: inputs.setupHint,
      action: { kind: "slash", command: "/model" },
    });
  }
  for (const hint of inputs.configHints ?? []) {
    if (!isKnownSlashCommand(hint.slash)) continue;
    suggestions.push({
      id: `config:${hint.id}`,
      source: "config",
      label: hint.label,
      action: { kind: "slash", command: hint.slash },
    });
  }
  for (const candidate of inputs.slashCandidates ?? []) {
    if (!isKnownSlashCommand(candidate.slash)) continue;
    suggestions.push({
      id: `slash:${candidate.slash}`,
      source: "slash",
      label: candidate.slash,
      hint: candidate.label,
      action: { kind: "slash", command: candidate.slash },
    });
  }
  const seen = new Set<string>();
  return suggestions
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .slice(0, 4);
}

type FooterContextUsageInput = ReturnType<typeof calculateContextPercentages> & {
  savingsRatio?: number;
};

type TaskFooterInput = {
  language: Language;
  width: number;
  permissionModeLabel: string;
  permissionMode: PermissionMode;
  cyclePermHint: string;
  effectiveModel: string | undefined;
  setupNeeded: boolean;
  cacheHitRate: number | null;
  indexStatus: string;
  reasoningLevel?: string;
  reasoningSent?: boolean;
  estimatedCostCny?: number;
  contextUsage?: FooterContextUsageInput;
  isRemoteMode: boolean;
};

export function computeRecentCacheHitRate(
  history: Pick<CacheTurnStats, "hitRate" | "inputTokens" | "cacheReadTokens" | "cacheWriteTokens">[],
  windowSize = 20,
): number | null {
  const recent = history.slice(-Math.max(1, windowSize));
  if (recent.length === 0) return null;
  const totals = recent.reduce(
    (acc, item) => {
      const inputTokens = Number.isFinite(item.inputTokens) ? Math.max(0, item.inputTokens) : 0;
      const cacheReadTokens = Number.isFinite(item.cacheReadTokens)
        ? Math.max(0, item.cacheReadTokens)
        : 0;
      const cacheWriteTokens = Number.isFinite(item.cacheWriteTokens)
        ? Math.max(0, item.cacheWriteTokens)
        : 0;
      acc.cacheReadTokens += cacheReadTokens;
      acc.cacheEligibleTokens += inputTokens + cacheReadTokens + cacheWriteTokens;
      return acc;
    },
    { cacheReadTokens: 0, cacheEligibleTokens: 0 },
  );

  if (totals.cacheEligibleTokens > 0) {
    return totals.cacheReadTokens / totals.cacheEligibleTokens;
  }

  const validHitRates = recent
    .map((item) => item.hitRate)
    .filter((value): value is number => Number.isFinite(value));
  if (validHitRates.length === 0) return null;
  return validHitRates.reduce((sum, value) => sum + value, 0) / validHitRates.length;
}

function buildTaskFooterView(input: TaskFooterInput): TaskFooterView {
  const modelInfo = formatFooterModel(
    input.language,
    input.effectiveModel,
    input.setupNeeded,
    input.width,
  );
  return {
    permissionMode: `${permissionModeSymbol(input.permissionMode)} ${input.permissionModeLabel}`,
    permissionModeColor: permissionModeColor(input.permissionMode),
    cyclePermHint: input.cyclePermHint,
    model: modelInfo.text,
    modelDim: modelInfo.dim,
    cache: formatFooterCache(input.language, input.cacheHitRate),
    cacheTone: formatFooterCacheTone(input.cacheHitRate),
    index: formatFooterIndex(input.language, input.indexStatus),
    reasoning: formatFooterReasoning(input.language, input.reasoningLevel, input.reasoningSent),
    contextUsage: formatFooterContextUsage(input.language, input.contextUsage),
    cost: formatFooterCost(input.language, input.estimatedCostCny),
    isRemoteMode: input.isRemoteMode,
  };
}

function formatFooterModel(
  language: Language,
  effectiveModel: string | undefined,
  setupNeeded: boolean,
  width: number,
): { text: string; dim: boolean } {
  const label = language === "en-US" ? "Model" : "模型";
  const trimmed = (effectiveModel ?? "").trim();
  const placeholders = new Set(["", "unknown", "setup-needed", "openai-compatible-model"]);
  if (setupNeeded || placeholders.has(trimmed.toLowerCase()))
    return { text: `${label} --`, dim: true };
  return { text: `${label} ${truncateMiddle(trimmed, width <= 60 ? 12 : 22)}`, dim: false };
}

function formatFooterContextUsage(
  language: Language,
  contextUsage: FooterContextUsageInput | undefined,
): TaskFooterView["contextUsage"] {
  if (!contextUsage) return undefined;
  const label = language === "en-US" ? "ctx" : "上下文";
  const percent = `${Math.round(contextUsage.ratio * 100)}%`;
  const savings = formatFooterContextSavings(contextUsage.savingsRatio);
  const suffix = savings ? ` ${savings}` : "";
  return {
    wide: `${label} ${formatContextProgressBar(contextUsage.ratio, 10)} ${percent}${suffix}`,
    narrow: `${label} ${formatContextProgressBar(contextUsage.ratio, 6)} ${percent}${suffix}`,
    minimal: `${label} ${percent}${suffix}`,
    ratio: contextUsage.ratio,
  };
}

function formatFooterContextSavings(savingsRatio: number | undefined): string | undefined {
  if (savingsRatio === undefined || !Number.isFinite(savingsRatio) || savingsRatio <= 0) {
    return undefined;
  }
  return `↓${Math.round(Math.min(1, savingsRatio) * 100)}%`;
}

function formatFooterCache(language: Language, hitRate: number | null): string {
  const label = language === "en-US" ? "Cache" : "缓存";
  if (hitRate === null || hitRate === undefined) return `${label}?`;
  return `${label} ${formatCachePercent(hitRate)}`;
}

function formatFooterCacheTone(hitRate: number | null): "default" | "warning" | "dim" {
  if (hitRate === null || hitRate === undefined) return "dim";
  return Math.max(0, Math.min(100, Math.round(hitRate * 100))) < 50 ? "warning" : "default";
}

function formatCachePercent(hitRate: number): string {
  return `${Math.max(0, Math.min(100, Math.round(hitRate * 100)))}%`;
}

function formatFooterIndex(language: Language, status: string): string {
  const label = language === "en-US" ? "Index" : "索引";
  const trimmed = (status ?? "").trim();
  if (!trimmed || trimmed.toLowerCase() === "unknown")
    return language === "en-US" ? "Index?" : "索引?";
  if (trimmed === "refresh_completed_but_unverified") return `${label} refresh`;
  return `${label} ${truncateMiddle(trimmed, 10)}`;
}

function formatFooterReasoning(
  language: Language,
  level: string | undefined,
  sent: boolean | undefined,
): string | undefined {
  if (!level || sent === false) return undefined;
  const trimmed = level.trim();
  if (!trimmed) return undefined;
  return `${language === "en-US" ? "Reasoning" : "推理"} ${truncateMiddle(trimmed, 12)}`;
}

function formatFooterCost(
  language: Language,
  estimatedCostCny: number | undefined,
): string | undefined {
  if (!Number.isFinite(estimatedCostCny)) return undefined;
  return `${language === "en-US" ? "cost" : "费用"} ¥${Math.max(0, estimatedCostCny ?? 0).toFixed(4)} est`;
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
  // D.13Q-UX: 消息语义 block（assistant_text / tool_result_* / diagnostic /
  // local_command_output）由 ProductBlock 内的 MessageMarkdown 自行处理换行/
  // 段落/列表/代码块，**不应**在此被 fitLine 打平成单行。fitLine 只负责
  // status / footer / suggestion 等真正需要单行截断的场景。
  // title 仍可走 truncateMiddle（标题就是单行语义）；nextAction 是 Ctrl+O hint
  // 单行也合理。summary / detail 在消息语义 block 上保留原样。
  const isMessageBlock =
    block.messageKind === "assistant_text" ||
    block.messageKind === "assistant_thinking" ||
    block.messageKind === "tool_call" ||
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
