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
};

export type ShellViewMode = "home" | "task" | "pending";

export type TaskActivityView = {
  phase: "thinking" | "tool_running" | "permission_waiting" | "continuing" | "completed" | "error";
  text: string;
  toolName?: string;
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
   * Selectable actions surfaced as a button row under the card.
   * If absent/empty, the view-model auto-fills the default y/n/d/cancel set
   * via `withPermissionActions(...)`.
   */
  actions?: PermissionAction[];
};

/**
 * TaskFooter — minimal status footer rendered under the composer in task mode.
 * Only carries the small set of always-on signals: permission mode, index
 * status, optional one-line hint. The full StatusTray noise stays out of the
 * task region so the composer + permission flow keep focus.
 */
export type TaskFooterView = {
  permissionMode: string;
  index: string;
  hint?: string;
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
  /**
   * D.13E Step 2 — 由 view-model.taskSuggestions 计算后挂到 view 上，
   * ShellApp 渲染只读 TaskSuggestionBar；空数组时 ShellApp 不渲染任何东西。
   */
  taskSuggestions?: import("./models/task-suggestion.js").TaskSuggestion[];
  /**
   * D.13E Step 2 — ConfigPanel UI 状态。idle 时 undefined；
   * 与 view.permission 互斥（permission 优先级更高，ShellApp 互斥渲染）。
   */
  configPanel?: ConfigPanelView;
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
  | { type: "permission-action"; actionId: PermissionActionId };

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
  title: string;
  status: string;
  result?: string;
};
