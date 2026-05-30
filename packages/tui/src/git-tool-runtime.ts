/**
 * git-tool-runtime.ts — D.14G structured Git capabilities exposed to the model.
 *
 * 这些是 Linghun 自研的结构化 Git 工具（不是 Anthropic defer_loading / tool_reference）：
 *   - GitStablePointCreate
 *   - GitStatusInspect
 *   - ManagedWorktreeCreate
 *   - ManagedWorktreeRemove
 *
 * 设计原则：
 * - 工具进入模型 tool schema（与 built-in 工具同级），模型需要执行时必须调用工具，
 *   不靠本地自然语言 regex 拦截。
 * - 本模块只做：schema 定义、input 解析/归一、result → 人话摘要。真正的 git
 *   操作在 git-operation-runtime.ts；事件/evidence/权限确认在 index.ts 薄 glue。
 * - 工具结果以结构化 result 返回，进入 transcript/evidence；final answer 只能基于
 *   工具结果声明“已创建/已删除/已保存”。
 */

import type { ModelToolDefinition } from "@linghun/providers";
import type { Language } from "@linghun/shared";
import {
  type StablePointOutcome,
  type WorktreeContextInfo,
  type WorktreeCreateOutcome,
  type WorktreeRemovePlan,
  redactWorktreePath,
  summarizeRejectedUntracked,
} from "./git-operation-runtime.js";

export const GIT_STABLE_POINT_CREATE = "GitStablePointCreate" as const;
export const GIT_STATUS_INSPECT = "GitStatusInspect" as const;
export const MANAGED_WORKTREE_CREATE = "ManagedWorktreeCreate" as const;
export const MANAGED_WORKTREE_REMOVE = "ManagedWorktreeRemove" as const;

export const GIT_TOOL_NAMES: readonly string[] = [
  GIT_STABLE_POINT_CREATE,
  GIT_STATUS_INSPECT,
  MANAGED_WORKTREE_CREATE,
  MANAGED_WORKTREE_REMOVE,
];

export function isGitToolName(name: string): boolean {
  return GIT_TOOL_NAMES.includes(name);
}

// ---------------------------------------------------------------------------
// Model tool schema
// ---------------------------------------------------------------------------

export function createGitToolDefinitions(): ModelToolDefinition[] {
  return [
    {
      name: GIT_STABLE_POINT_CREATE,
      description:
        "Create a stable point (safe restore line) for the current workspace. In a git repo with tracked changes this creates a real git commit; clean repo is skipped (no empty commit); untracked-only is saved as a Linghun snapshot unless includeUntracked=true. Sensitive/ignored files are never committed. Call this tool to actually save state — do not claim a stable point was created without calling it.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          message: { type: "string" },
          includeUntracked: { type: "boolean" },
          reason: { type: "string" },
        },
      },
    },
    {
      name: GIT_STATUS_INSPECT,
      description:
        "Inspect git status, current worktree, and recent stable point for the workspace. Read-only; safe to call without confirmation.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          includeDetails: { type: "boolean" },
        },
      },
    },
    {
      name: MANAGED_WORKTREE_CREATE,
      description:
        "Create or resume a Linghun managed git worktree (isolated working copy) under the controlled `.linghun-worktrees` root. name is required and must be a safe slug (letters/digits/._-). Optional branch and fromRef. Does not switch the current process cwd, does not start tmux, does not install hooks. Call this tool to actually create a worktree.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          branch: { type: "string" },
          fromRef: { type: "string" },
          reason: { type: "string" },
        },
        required: ["name"],
      },
    },
    {
      name: MANAGED_WORKTREE_REMOVE,
      description:
        "Request removal of a Linghun managed worktree by name. Only worktrees under the controlled root can be removed. A clean worktree asks for confirmation; a dirty worktree is refused unless force=true (which asks for a stronger confirmation). Never deletes branches and never runs rm -rf. Call this tool to request removal.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          force: { type: "boolean" },
          reason: { type: "string" },
        },
        required: ["name"],
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Input parsing / normalization
// ---------------------------------------------------------------------------

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asBool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export type StablePointToolInput = {
  message?: string;
  includeUntracked?: boolean;
  reason?: string;
};

export function parseStablePointInput(input: unknown): StablePointToolInput {
  const obj = asRecord(input);
  return {
    message: asString(obj.message),
    includeUntracked: asBool(obj.includeUntracked),
    reason: asString(obj.reason),
  };
}

export type WorktreeCreateToolInput = {
  name?: string;
  branch?: string;
  fromRef?: string;
  reason?: string;
};

export function parseWorktreeCreateInput(input: unknown): WorktreeCreateToolInput {
  const obj = asRecord(input);
  return {
    name: asString(obj.name),
    branch: asString(obj.branch),
    fromRef: asString(obj.fromRef),
    reason: asString(obj.reason),
  };
}

export type WorktreeRemoveToolInput = {
  name?: string;
  force?: boolean;
  reason?: string;
};

export function parseWorktreeRemoveInput(input: unknown): WorktreeRemoveToolInput {
  const obj = asRecord(input);
  return {
    name: asString(obj.name),
    force: asBool(obj.force),
    reason: asString(obj.reason),
  };
}

// ---------------------------------------------------------------------------
// Result shaping — outcome → 人话主屏文案（不泄漏长绝对路径 / secrets）
// ---------------------------------------------------------------------------

export function summarizeStablePointOutcome(
  outcome: StablePointOutcome,
  language: Language,
): { ok: boolean; text: string } {
  const isEn = language === "en-US";
  switch (outcome.kind) {
    case "not_a_git_repo":
      return {
        ok: true,
        text: isEn
          ? "Not a git repo; saved a Linghun snapshot stable point instead."
          : "当前不是 git 仓库；已改为创建 Linghun snapshot 稳定点。",
      };
    case "git_unavailable":
      return {
        ok: false,
        text: isEn
          ? `git is unavailable; no stable point created: ${outcome.reason}`
          : `git 不可用，未创建稳定点：${outcome.reason}`,
      };
    case "skipped":
      return {
        ok: true,
        text: isEn
          ? `Workspace is clean on ${outcome.branch ?? "(detached)"} (${outcome.head ?? "?"}); no empty commit created.`
          : `工作区干净（分支 ${outcome.branch ?? "（游离）"}，HEAD ${outcome.head ?? "?"}）；未创建空 commit。`,
      };
    case "snapshot":
      return {
        ok: true,
        text:
          outcome.reason === "untracked_only_not_included"
            ? isEn
              ? "Only untracked files present; saved a Linghun snapshot. Pass includeUntracked to include them in a git commit."
              : "仅有未跟踪文件；已创建 Linghun snapshot。需要纳入 git commit 请显式 includeUntracked。"
            : isEn
              ? "All untracked candidates were sensitive/ignored and excluded; saved a Linghun snapshot instead of a commit."
              : "可纳入的未跟踪文件全部被判定为敏感/ignored 并排除；已创建 Linghun snapshot，未提交。",
      };
    case "git_commit": {
      const rejected =
        outcome.rejectedUntracked.length > 0
          ? isEn
            ? ` Excluded sensitive/ignored: ${summarizeRejectedUntracked(outcome.rejectedUntracked).join(", ")}.`
            : ` 已排除敏感/ignored：${summarizeRejectedUntracked(outcome.rejectedUntracked).join("、")}。`
          : "";
      return {
        ok: true,
        text: isEn
          ? `Stable point created: ${outcome.sha} on ${outcome.branch ?? "(detached)"} — ${outcome.subject} (${outcome.changedCount} file(s)).${rejected}`
          : `已建立稳定点：${outcome.sha}（分支 ${outcome.branch ?? "（游离）"}）— ${outcome.subject}（${outcome.changedCount} 个文件）。${rejected}`,
      };
    }
    case "failed":
      return {
        ok: false,
        text: isEn
          ? `Stable point failed; no commit created: ${outcome.reason}`
          : `稳定点创建失败，未提交：${outcome.reason}`,
      };
  }
}

export function summarizeWorktreeCreateOutcome(
  outcome: WorktreeCreateOutcome,
  language: Language,
): { ok: boolean; text: string } {
  const isEn = language === "en-US";
  switch (outcome.kind) {
    case "not_a_git_repo":
      return {
        ok: false,
        text: isEn
          ? "Not a git repo; cannot create a managed worktree."
          : "当前不是 git 仓库，无法创建 managed worktree。",
      };
    case "git_unavailable":
      return {
        ok: false,
        text: isEn
          ? `git is unavailable; worktree not created: ${outcome.reason}`
          : `git 不可用，未创建 worktree：${outcome.reason}`,
      };
    case "invalid":
      return {
        ok: false,
        text: isEn
          ? `Invalid worktree request: ${outcome.reason}`
          : `worktree 请求非法：${outcome.reason}`,
      };
    case "resumed":
      return {
        ok: true,
        text: isEn
          ? `Worktree "${outcome.name}" already exists at ${redactWorktreePath(outcome.path)} (branch ${outcome.branch ?? "?"}); resumed without overwriting.`
          : `worktree「${outcome.name}」已存在于 ${redactWorktreePath(outcome.path)}（分支 ${outcome.branch ?? "?"}）；已复用，未覆盖。`,
      };
    case "created":
      return {
        ok: true,
        text: isEn
          ? `Worktree created: "${outcome.name}" at ${redactWorktreePath(outcome.path)} (branch ${outcome.branch ?? "?"}, from ${outcome.fromRef}). cwd was NOT changed; cd there to work in it.`
          : `已创建 worktree：「${outcome.name}」位于 ${redactWorktreePath(outcome.path)}（分支 ${outcome.branch ?? "?"}，基于 ${outcome.fromRef}）。当前进程目录未切换；如需在其中工作请手动 cd 过去。`,
      };
    case "failed":
      return {
        ok: false,
        text: isEn
          ? `Worktree creation failed; nothing created: ${outcome.reason}`
          : `worktree 创建失败，未创建：${outcome.reason}`,
      };
  }
}

// remove 是两段式：plan → 确认 → execute。这里只摘要 plan 阶段（拒绝/需确认）。
export function summarizeWorktreeRemovePlan(
  plan: WorktreeRemovePlan,
  language: Language,
): { ok: boolean; needsConfirmation: boolean; strong: boolean; text: string } {
  const isEn = language === "en-US";
  switch (plan.kind) {
    case "not_a_git_repo":
      return {
        ok: false,
        needsConfirmation: false,
        strong: false,
        text: isEn ? "Not a git repo." : "当前不是 git 仓库。",
      };
    case "git_unavailable":
      return {
        ok: false,
        needsConfirmation: false,
        strong: false,
        text: isEn ? `git unavailable: ${plan.reason}` : `git 不可用：${plan.reason}`,
      };
    case "invalid":
      return {
        ok: false,
        needsConfirmation: false,
        strong: false,
        text: isEn ? `Invalid request: ${plan.reason}` : `请求非法：${plan.reason}`,
      };
    case "not_found":
      return {
        ok: false,
        needsConfirmation: false,
        strong: false,
        text: plan.reason,
      };
    case "not_managed":
      return {
        ok: false,
        needsConfirmation: false,
        strong: false,
        text: isEn
          ? `${plan.reason} (${redactWorktreePath(plan.path)})`
          : `${plan.reason}（${redactWorktreePath(plan.path)}）`,
      };
    case "clean":
      return {
        ok: true,
        needsConfirmation: true,
        strong: false,
        text: isEn
          ? `Confirm removing managed worktree "${plan.name}" at ${redactWorktreePath(plan.path)} (clean).`
          : `确认删除 managed worktree「${plan.name}」（${redactWorktreePath(plan.path)}，干净）。`,
      };
    case "dirty_blocked":
      return {
        ok: false,
        needsConfirmation: false,
        strong: false,
        text: isEn
          ? `Worktree "${plan.name}" has uncommitted changes; refused. Pass force=true to remove anyway.`
          : `worktree「${plan.name}」有未提交改动，已拒绝。需要强制删除请传 force=true。`,
      };
    case "dirty_force":
      return {
        ok: true,
        needsConfirmation: true,
        strong: true,
        text: isEn
          ? `Confirm FORCE removing dirty managed worktree "${plan.name}" at ${redactWorktreePath(plan.path)}; uncommitted changes will be lost.`
          : `确认强制删除有改动的 managed worktree「${plan.name}」（${redactWorktreePath(plan.path)}）；未提交改动将丢失。`,
      };
  }
}

export function summarizeWorktreeContextForPrompt(
  info: WorktreeContextInfo | null,
): Record<string, unknown> | null {
  if (!info) return null;
  return {
    isWorktree: info.isWorktree,
    branch: info.branch,
    managedName: info.managedName,
    path: info.redactedPath,
    note: info.isWorktree
      ? "You are in an isolated git worktree. Run task commands here; do not cd back to the main repository root for this task."
      : undefined,
  };
}
