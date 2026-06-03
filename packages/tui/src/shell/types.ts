import type { Readable, Writable } from "node:stream";
import type { Language } from "@linghun/shared";

export type ShellRuntimeMode = "ink" | "plain";

export type ShellThemeMode = "color" | "no-color";

export type ProductBlockKind =
  | "home"
  | "repo"
  | "setup"
  | "permission"
  | "run"
  | "tool"
  | "error"
  | "details"
  | "command";

export type ProductBlockStatus = "info" | "running" | "pass" | "partial" | "fail" | "blocked";

/**
 * D.13Q-UX — 消息语义维度（与 ProductBlockKind 的"用途"维度正交）。
 *
 * - assistant_text: 普通 assistant 正文 / 最终汇报，走 Markdown，默认色，不卡片化。
 * - assistant_thinking: thinking 块；dim italic，默认收起。
 * - command_transcript: 用户输入 slash 命令的回显；低调单行 ❯ /xxx。
 * - local_command_output: ! shell 输出；dim "⎿ " 前缀 + 默认色正文。
 * - tool_result_success / _error / _cancelled / _rejected: 工具结果四态。
 * - diagnostic: /model doctor 等诊断输出。
 * - notification: 轻提示（cache-low / freshness / shortcut hint），走 notification 栈。
 * - permission_panel: 权限面板，独立顶部脊线容器。
 * - help_panel: /help 面板，分组 core/advanced/details。
 * - status: 短暂状态行（不进 transcript）。
 *
 * 兼容性：未设 messageKind 时回退到旧的 ProductBlockKind + status 渲染路径，
 * D.13L/M/N/O/P 既有形状不受影响。
 */
export type MessageBlockKind =
  | "assistant_text"
  | "assistant_thinking"
  | "command_transcript"
  | "user_text"
  | "local_command_output"
  | "tool_result_success"
  | "tool_result_error"
  | "tool_result_cancelled"
  | "tool_result_rejected"
  | "diagnostic"
  | "notification"
  | "permission_panel"
  | "help_panel"
  | "status";

export type ProductBlockViewModel = {
  id: string;
  kind: ProductBlockKind;
  status: ProductBlockStatus;
  title: string;
  summary: string;
  detail?: string;
  nextAction?: string;
  /** Echo / informational blocks that should not be auto-pruned by the view model. */
  keep?: boolean;
  /**
   * Full normalized text the summary was derived from. Preserved on the block
   * so `/details` (and future Ctrl+O) can reveal the entire body without
   * round-tripping through the (potentially-truncated) summary line.
   */
  fullText?: string;
  /**
   * D.13Q-UX — 消息语义维度。设置后 ProductBlock 按 messageKind 分发渲染：
   * assistant_text 走 Markdown 默认色（不卡片化、不打平）；tool_result_* 按四态
   * 着色；notification / status 等不进 transcript 主流。未设时回退到旧路径。
   */
  messageKind?: MessageBlockKind;
};

/**
 * D.13Q-UX — 轻提示视图模型。CCB Notifications.tsx 范式：
 * priority 决定显示顺序，timeoutMs 控制自动消失，color 留给 dim 之外的强调色。
 * 通知**绝不进 transcript**，由 NotificationStack 右对齐栈单条主显。
 *
 * 过期判定：view-model 在 createShellViewModel 时以 Date.now() 为基准过滤
 * createdAt + timeoutMs <= now 的项；timeoutMs 不设视为常驻。createdAt 由
 * 写入方负责（见 index.ts:writeLightHints）；缺省时 view-model 视为常驻。
 */
export type NotificationView = {
  /** 稳定 key，用于 React 列表 + dedupe。 */
  key: string;
  /** 单行短文案；过长应在数据源就截断。 */
  text: string;
  /** immediate 立即抢占；medium 默认；low 当队列空时显示。 */
  priority: "immediate" | "medium" | "low";
  /** 自动消失（毫秒）；undefined 表示常驻直到状态消失。 */
  timeoutMs?: number;
  /** 写入时间戳（毫秒）；与 timeoutMs 一起决定 view-model 是否过滤。 */
  createdAt?: number;
  /** 可选强调色（warning / error / dim 默认）。 */
  tone?: "default" | "dim" | "warning" | "error" | "success";
};

export type StatusTrayViewModel = {
  project: string;
  model: string;
  permission: string;
  trust: string;
  index: string;
  background: string;
};

export type ComposerViewModel = {
  placeholder: string;
  taskPlaceholder: string;
  submittedHint: string;
  masking: boolean;
  /** Active model setup flow (apiKey / baseUrl / model / confirm). */
  setupActive: boolean;
  /** Setup step label, surfaced near the composer when setup is active. */
  setupStep?: string;
  /**
   * D.13Q-UX Real Smoke Fix v2 — D. busy guard.
   * 模型仍在处理上一条请求时为 true（submitted-pending 首帧 / activity phase 在
   * thinking|tool_running|continuing|permission_waiting / activeAbortController
   * 还在）。Composer 在 busy=true 时仍允许打字保留草稿，但 Enter 不提交、不清空。
   */
  busy?: boolean;
  /** busy=true 时显示的人类可读提示。"按 Ctrl+C 中断" 类。 */
  busyHint?: string;
};

export type ShellViewMode = "home" | "task" | "pending";

export type TaskActivityView = {
  phase: "thinking" | "tool_running" | "permission_waiting" | "continuing" | "completed" | "error";
  text: string;
  toolName?: string;
  elapsed?: string;
};

/**
 * D.13E Step 2 — 扩展为 4 档提权 + 兼容 legacy 别名。
 *
 * - allow_once / allow_always_tool / deny / details / cancel：来自
 *   PermissionElevationModel.buildElevationOptions 的稳定 id。
 * - yes / no：legacy 别名，保留以兼容现有 fallback 测试和老的 onInput 路径。
 *   controller 端把 yes 映射为 allow_once，no 映射为 deny。
 */
export type PermissionActionId =
  | "allow_once"
  | "allow_always_tool"
  | "deny"
  | "details"
  | "cancel"
  | "yes"
  | "no";

export type PermissionAction = {
  id: PermissionActionId;
  label: string;
  /** Single-letter shortcut, e.g. "y" / "n" / "d". Esc handled separately. */
  shortcut?: string;
};

export type TaskPermissionView = {
  toolName: string;
  reason: string;
  risk: "low" | "medium" | "high";
  scope: string[];
  hint: string;
  /**
   * D.13L Block 0-B — 主屏权限卡的"做什么"摘要行，例如：
   *   "运行终端命令：git status"
   *   "写入文件：packages/tui/src/foo.ts"
   *   "使用工具：Glob"
   * 由 mapPendingApprovalToPermission 从 toolCall.input 派生；UI 只读不解析。
   */
  actionSummary?: string;
  /**
   * Selectable actions surfaced as a button row under the card.
   * If absent/empty, the view-model auto-fills the default y/n/d/cancel set
   * via `withPermissionActions(...)`.
   */
  actions?: PermissionAction[];
  /**
   * D.13Q-UX — 详情说明行（多行 user-facing 短句）。由 view-model 调用
   * permission-explanation.explainPolicyVerdict 装配；reason 已去 rule.id。
   * PermissionControl 把这些行 dim 渲染在 actionSummary 下方，提供"为什么问"
   * 的解释，但**不暴露 rule.id / hook id / classifier 内部枚举**。
   * 详情可由 /details 进一步展开 redactedSummary（仍由现有 /details 链路负责）。
   */
  explanationLines?: string[];
};

/**
 * TaskFooter — minimal status footer rendered under the composer in task mode.
 * Only carries the small set of always-on signals: permission mode, model,
 * cache hit rate, index status, and a colored cycle-mode hint. The full
 * StatusTray noise stays out of the task region so the composer + permission
 * flow keep focus.
 *
 * D13E-P3: dropped session id / gate / background fields; added model + cache
 * + cyclePermHint (rendered with status-fail color in ShellApp.TaskFooter).
 */
export type TaskFooterView = {
  permissionMode: string;
  model: string;
  cache: string;
  index: string;
  /** Red-colored Shift+Tab hint, e.g. "（Shift+Tab 切换模式）" / "(Shift+Tab switch mode)". */
  cyclePermHint: string;
  /**
   * D13E-P3 cleanup: optional reasoning level segment, e.g. "推理 High" /
   * "Reasoning High". Absent when the active provider/model does not surface
   * a reasoning level or when the value is empty/未生效.
   */
  reasoning?: string;
  hint?: string;
  /**
   * D.13Q-UX — model 段是否染 dim。setup-needed / "unknown" / "openai-compatible-model"
   * 等占位状态时 true，避免把 stale 兜底（如 deepseek-chat）当成正常 model 显示。
   */
  modelDim?: boolean;
  /**
   * D.13Q-UX — cache 段色调：低命中率染 warning，未知染 dim，默认 muted。
   */
  cacheTone?: "default" | "warning" | "dim";
  /**
   * Footer workspace/worktree line. Keep it short and above runtimeStatus.
   */
  workspaceStatus?: string;
  /**
   * Footer 第二行：当前 active/resumable runtime 状态。历史 terminal 任务不进这里。
   */
  runtimeStatus?: string;
};

/**
 * D.13E Step 2 — ConfigPanel view-model（runInkShell.onInput 拦截 /config 后填充）
 *
 * - panel_list：14 个 panel 的列表视图（cursor 指向当前高亮）。
 * - panel_detail：进入某个 panel 的 actions 列表（actionCursor 指向当前高亮）。
 *
 * panels / actions 数组由 view-model.mapConfigPanelState 用
 * ConfigControlPlane.getConfigPanels / getPanelText / getActionLabel 装配，
 * 已经做过 i18n（zh-CN / en-US），UI 层只渲染 label / summary。
 */
export type ConfigPanelView =
  | {
      phase: "panel_list";
      cursor: number;
      panels: { id: string; title: string; summary: string }[];
    }
  | {
      phase: "panel_detail";
      panel: { id: string; title: string; summary: string };
      actionCursor: number;
      actions: { id: string; label: string }[];
    };

/**
 * D.13Q-UX Task Surface Maturity Sweep — 通用 CommandPanel 视图。
 *
 * 高级命令（/mcp, /memory, /index status, /cache, /background, /job,
 * /plugins, /skills, /remote, /doctor, /model 等）默认输出走这条通道，
 * 不再以 assistant_text 写进 transcript。结构上：
 *   - title：命令名（"/mcp", "/index status"）。
 *   - summary：短状态行（"MCP 已连接：3 / 3"），数组以支持多行轻摘要。
 *   - sections：分组小表（每组一个标题 + 若干行）。
 *   - actions：建议的下一步命令（"/mcp doctor"）。
 *   - detailsText：完整明细文本，供 Ctrl+O / /details 展开。
 *   - tone：neutral / warning / error，控制边框色与状态色。
 *   - cursor / scrollOffset：面板自身可滚动时使用。
 */
export type CommandPanelView = {
  title: string;
  summary?: string[];
  sections?: { title?: string; rows: string[] }[];
  actions?: string[];
  detailsText?: string;
  tone?: "neutral" | "warning" | "error";
  cursor?: number;
  scrollOffset?: number;
  /** 面板内部是否处于"展开 detailsText"状态（受 Ctrl+O toggle 影响）。 */
  expanded?: boolean;
};

export type TranscriptScrollView = {
  scrollOffset: number;
  stickToBottom: boolean;
  hasOverflow?: boolean;
  viewportHeight?: number;
  contentHeight?: number;
  wheelStep?: number;
};

/** Legacy task-scroll model shape; main transcript wiring uses TranscriptScrollView. */
export type TaskScrollView = TranscriptScrollView;

export type TranscriptScrollActionName =
  | "lineUp"
  | "lineDown"
  | "halfPageUp"
  | "halfPageDown"
  | "fullPageUp"
  | "fullPageDown"
  | "wheelUp"
  | "wheelDown"
  | "top"
  | "bottom";

export type ShellViewModel = {
  language: Language;
  projectName: string;
  projectPath: string;
  width: number;
  height: number;
  mode: ShellRuntimeMode;
  themeMode: ShellThemeMode;
  viewMode: ShellViewMode;
  brand: string;
  homeVision: string;
  setupHint?: string;
  activity?: TaskActivityView;
  permission?: TaskPermissionView;
  status: StatusTrayViewModel;
  composer: ComposerViewModel;
  blocks: ProductBlockViewModel[];
  limitations: string[];
  /** Compact task-mode footer. Present in task/pending viewMode; absent in home. */
  taskFooter?: TaskFooterView;
  /** Footer-adjacent background/workflow summary; kept out of transcript blocks. */
  taskRuntimeSummary?: ProductBlockViewModel;
  /**
   * D.13Q-UX — 轻提示队列。NotificationStack 右对齐渲染，单条主显，
   * 不进 transcript（与 blocks 隔离）。空数组时 ShellApp 不渲染。
   */
  notifications?: NotificationView[];
  /**
   * D.13E Step 2 — 由 view-model.taskSuggestions 计算后挂到 view 上，
   * ShellApp 渲染 TaskSuggestionBar；空数组时 ShellApp 不渲染任何东西。
   */
  taskSuggestions?: import("./models/task-suggestion.js").TaskSuggestion[];
  taskSuggestionCursor?: number;
  /**
   * D.13E Step 2 — ConfigPanel UI 状态。idle 时 undefined；
   * 与 view.permission 互斥（permission 优先级更高，ShellApp 互斥渲染）。
   */
  configPanel?: ConfigPanelView;
  /**
   * D.13Q-UX Task Surface — 通用 CommandPanel UI 状态。高级 slash 命令的结果
   * 默认进入此面板（与 transcript 隔离）。空时 ShellApp 不渲染。
   */
  commandPanel?: CommandPanelView;
  /**
   * D.13Q-UX Task Surface — 任务区滚动状态。home 模式不存在；task/pending
   * 模式始终存在，默认 scrollOffset=0 / stickToBottom=true。
   */
  transcriptScroll?: TranscriptScrollView;
  /**
   * D.13Q-UX Closure — HelpPanel UI 状态。打开时显示三组 Tab + 命令列表，
   * Enter dispatch slash，Esc 关闭。
   */
  helpPanel?: {
    group: "core" | "advanced" | "details";
    cursor: number;
    entries: { slash: string; description: string }[];
  };
  /**
   * D.13Q-UX Closure — BtwPanel UI 状态。打开时显示 side question + 回答（spinner / Markdown）。
   */
  btwPanel?: {
    question: string;
    phase: "loading" | "answered" | "error";
    answer?: string;
    error?: string;
  };
  /**
   * D.13Q-UX Closure — SessionsPanel UI 状态。打开时显示按 updatedAt 排序的 session 列表。
   */
  sessionsPanel?: {
    cursor: number;
    entries: {
      id: string;
      title: string;
      updatedAt: string;
      messageCount: number;
      isCurrent: boolean;
    }[];
  };
};

/**
 * D.13E Step 2 — 新增 4 类事件，全部由 ConfigPanel / Composer permission row 触发：
 *   - config-move / config-enter / config-back：ConfigPanel 自身的导航事件，
 *     由 runInkShell.onInput 路由到 reduceConfigState。
 *   - permission-action：Composer 在收到 elevation 行的 y/a/n/d 单字母或 Enter 后
 *     发出，actionId 来自 PermissionElevationModel.buildElevationOptions 的稳定 id。
 */
export type ShellInputEvent =
  | { type: "submit"; text: string }
  | { type: "empty-submit" }
  | { type: "escape" }
  | { type: "shift-enter" }
  | { type: "cycle-permission-mode" }
  | { type: "config-move"; delta: -1 | 1 }
  | { type: "config-enter" }
  | { type: "config-back" }
  | { type: "permission-action"; actionId: PermissionActionId }
  | { type: "task-suggestion-move"; delta: -1 | 1 }
  | { type: "task-suggestion-action"; suggestionId: string }
  /**
   * D.13Q-UX — Ctrl+O 派发：直接触发"展开完整内容"，不写 buffer、不进 transcript
   * 命令行（旧实现 submit "/details" 会让用户输入区里出现 /details）。
   * /details slash 仍保留为兼容命令；本事件是主交互入口。
   */
  | { type: "toggle-details" }
  /**
   * D.13Q-UX Closure — HelpPanel 事件：core / advanced / details 三组导航。
   * help-open 由 index.ts 拦截 /help 后触发；help-move 上下选择；
   * help-switch-group Tab/左右切组；help-enter 派发选中 slash；help-close Esc。
   */
  | { type: "help-open"; group?: "core" | "advanced" | "details" }
  | { type: "help-move"; delta: -1 | 1 }
  | { type: "help-switch-group"; delta: -1 | 1 }
  | { type: "help-enter" }
  | { type: "help-close" }
  /**
   * D.13Q-UX Closure — BtwPanel 事件：side question 独立面板，
   * 不进主 conversation。
   */
  | { type: "btw-open"; question: string }
  | { type: "btw-close" }
  /**
   * D.13Q-UX Closure — SessionsPanel 事件：picker 选择 + 关闭。
   */
  | { type: "sessions-open" }
  | { type: "sessions-move"; delta: -1 | 1 }
  | { type: "sessions-resume" }
  | { type: "sessions-close" }
  /**
   * Transcript scroll events. CCB-compatible behavior is implemented in
   * shell/models/transcript-scroll-state.ts: PgUp/PgDn are page actions,
   * wheel/arrow are line actions, Home/End are absolute top/bottom jumps.
   *   - command-panel-close: Esc 关闭通用 CommandPanel。
   */
  | {
      type: "transcript-scroll";
      action: TranscriptScrollActionName;
    }
  | { type: "transcript-scroll"; delta: number }
  | { type: "transcript-scroll-measure"; viewportHeight: number; contentHeight: number }
  | { type: "transcript-scroll-end" }
  | { type: "transcript-scroll-top" }
  | { type: "command-panel-close" };

export type ShellController = {
  onInput: (event: ShellInputEvent) => Promise<void> | void;
  getViewModel: () => ShellViewModel;
  onResize?: () => void;
};

export type ShellRenderOptions = {
  stdin?: Readable;
  stdout?: Writable;
  stderr?: Writable;
};

export type BackgroundTaskSummary = {
  id: string;
  kind?: string;
  title: string;
  status: string;
  currentStep?: string;
  progress?: { completed: number; total?: number; label?: string };
  result?: string;
  nextAction?: string;
};
