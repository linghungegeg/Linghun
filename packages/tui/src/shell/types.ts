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
  | "details";

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

export type TaskPermissionView = {
  toolName: string;
  reason: string;
  risk: "low" | "medium" | "high";
  scope: string[];
  hint: string;
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
};

export type ShellInputEvent =
  | { type: "submit"; text: string }
  | { type: "empty-submit" }
  | { type: "escape" }
  | { type: "shift-enter" };

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
