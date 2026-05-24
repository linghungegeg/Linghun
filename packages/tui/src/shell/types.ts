import type { Readable, Writable } from "node:stream";
import type { Language } from "@linghun/shared";

export type ShellRuntimeMode = "ink" | "plain";

export type ShellThemeMode = "color" | "no-color";

export type ProductBlockKind =
  | "home"
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
};

export type StatusTrayViewModel = {
  model: string;
  mode: string;
  trust: string;
  index: string;
  cache: string;
  background: string;
};

export type ComposerViewModel = {
  placeholder: string;
  prompt: string;
  hint: string;
  submittedHint: string;
  masking: boolean;
};

export type ShellViewModel = {
  language: Language;
  projectName: string;
  projectPath: string;
  width: number;
  mode: ShellRuntimeMode;
  themeMode: ShellThemeMode;
  homeTitle: string;
  homeSummary: string;
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
};

export type ShellRenderOptions = {
  stdin?: Readable;
  stdout?: Writable;
  stderr?: Writable;
};
