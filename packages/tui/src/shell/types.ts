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

export type PermissionActionId = "yes" | "no" | "details" | "cancel";

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
};

export type ShellInputEvent =
  | { type: "submit"; text: string }
  | { type: "empty-submit" }
  | { type: "escape" }
  | { type: "shift-enter" }
  | { type: "cycle-permission-mode" };

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
