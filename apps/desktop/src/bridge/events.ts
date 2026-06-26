import type { TranscriptEvent } from "@linghun/core";

// ─── Main → Renderer（引擎事件流） ────────────────────────────────────────────

export type EngineEvent =
  | { type: "session_start"; sessionId: string; projectPath: string }
  | { type: "user_message"; id: string; text: string }
  | { type: "assistant_delta"; id: string; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown; risk: "low" | "medium" | "high" }
  | { type: "tool_result"; id: string; output: string; error?: string }
  | { type: "task_update"; task: Extract<TranscriptEvent, { type: "background_task_update" }>["task"] }
  | { type: "permission_request"; id: string; actionSummary: string; risk: "low" | "medium" | "high" }
  | { type: "checkpoint"; files: string[] }
  | { type: "done"; exitCode: number }
  | { type: "error"; message: string };

// ─── Renderer → Main（用户命令） ─────────────────────────────────────────────

export type EngineCommand =
  | { type: "send_message"; text: string; projectPath: string }
  | { type: "permission_reply"; id: string; action: "allow_once" | "allow_always" | "deny" }
  | { type: "abort" }
  | { type: "open_project"; path: string }
  | { type: "new_session" }
  | { type: "load_session"; id: string };

// ─── 窗口控制（frameless 自绘标题栏） ────────────────────────────────────────

export type WindowControlAction = "minimize" | "toggle_maximize" | "close";

// process.platform 的字面量联合，避免在 renderer/bridge 层引入整套 @types/node。
export type Platform =
  | "aix"
  | "android"
  | "darwin"
  | "freebsd"
  | "haiku"
  | "linux"
  | "openbsd"
  | "sunos"
  | "win32"
  | "cygwin"
  | "netbsd";

export type WindowState = {
  maximized: boolean;
  platform: Platform;
};

// ─── Diff 查询（右栏 review 面板，request/response） ─────────────────────────

export type DiffLine = {
  kind: "add" | "del" | "context" | "hunk";
  text: string;
  oldNo?: number;
  newNo?: number;
};

export type DiffFile = {
  path: string;
  status: "modified" | "added" | "deleted" | "renamed" | "untracked";
  additions: number;
  deletions: number;
  lines: DiffLine[];
};

export type DiffResult = {
  ok: boolean;
  files: DiffFile[];
  error?: string;
};

// ─── Session 元数据 ───────────────────────────────────────────────────────────

export type SessionMeta = {
  id: string;
  title: string;
  projectPath: string;
  createdAt: string;
  updatedAt: string;
};

// ─── 项目切换（左栏 ProjectSwitcher，request/response） ───────────────────────

export type ProjectInfo = {
  // 绝对路径；进程启动时的默认工作目录用 "." 占位。
  path: string;
  // git 仓库名（rev-parse 顶层目录的 basename），非仓库时回退为目录名。
  name: string;
  isGitRepo: boolean;
};

export type PickProjectResult =
  | { ok: true; project: ProjectInfo }
  | { ok: false; canceled?: boolean; error?: string };
