/**
 * git-slash-runtime.ts — D.14G-Refactor-Closure
 *
 * /git stable create、/checkpoint create、/worktree create、/worktree remove 的
 * 参数解析与 runtime 调用。index.ts 只调用薄 wrapper（handleGitStableCreateSlash /
 * handleWorktreeCreateSlash / handleWorktreeRemoveSlash）。
 *
 * 设计原则：
 * - **不 value import ./index.js**；TuiContext 只 `import type`。
 * - slash 与模型工具共用同一 git-operation runtime（经 git-tool-dispatch-runtime 的
 *   performStablePoint / performWorktreeCreate），保证 slash 与工具行为一致。
 * - index-owned 的 ensureSession / writeLine / writeStatus 与 dispatch deps 经
 *   `GitSlashDeps` 注入，不制造运行时环。
 * - 行为与 D.14G 完全一致。
 */

import type { Writable } from "node:stream";
import { planManagedWorktreeRemove } from "./git-operation-runtime.js";
import {
  type GitToolDispatchDeps,
  appendGitOperationEvent,
  performStablePoint,
  performWorktreeCreate,
} from "./git-tool-dispatch-runtime.js";
import { summarizeWorktreeRemovePlan } from "./git-tool-runtime.js";
import type { TuiContext } from "./index.js";

export type GitSlashDeps = {
  dispatch: GitToolDispatchDeps;
  ensureSession: (context: TuiContext) => Promise<string>;
  writeLine: (output: Writable, text: string) => void;
  writeStatus: (output: Writable, context: TuiContext) => void;
};

export function parseStablePointSlashArgs(args: string[]): {
  message?: string;
  includeUntracked: boolean;
} {
  let includeUntracked = false;
  const messageParts: string[] = [];
  for (const arg of args) {
    if (arg === "--include-untracked") {
      includeUntracked = true;
      continue;
    }
    messageParts.push(arg);
  }
  const raw = messageParts.join(" ").trim();
  const message = raw.replace(/^["'“‘]|["'”’]$/gu, "").trim();
  return { message: message || undefined, includeUntracked };
}

// 解析 worktree create/remove 参数：<name> [--branch <b>] [--from <ref>] [--force]。
export function parseWorktreeSlashArgs(args: string[]): {
  name?: string;
  branch?: string;
  fromRef?: string;
  force: boolean;
} {
  let name: string | undefined;
  let branch: string | undefined;
  let fromRef: string | undefined;
  let force = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg === "--branch" || arg === "-b") {
      branch = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--from") {
      fromRef = args[i + 1];
      i += 1;
      continue;
    }
    if (!name && !arg.startsWith("-")) {
      name = arg;
    }
  }
  return { name, branch, fromRef, force };
}

export async function runStablePointCreateSlash(
  args: string[],
  context: TuiContext,
  output: Writable,
  deps: GitSlashDeps,
): Promise<void> {
  const parsed = parseStablePointSlashArgs(args);
  const sessionId = await deps.ensureSession(context);
  // Run 2 P1-1 修复 — slash /git stable create、/checkpoint create 在 plan 模式必须
  // 直接只读拒绝：不创建 commit，也不创建 Linghun snapshot 安全垫。稳定点是安全增益
  // 动作，default/auto-review/full-access 下 slash 是显式用户动作，直接执行；唯独 plan
  // 守住只读边界。与模型工具 runStablePointTool 的 plan 拒绝语义一致。
  if (context.permissionMode === "plan") {
    const text =
      context.language === "en-US"
        ? "stable point was NOT created because Plan mode is read-only."
        : "stable point was NOT created because Plan mode is read-only. 稳定点未创建：计划模式只读。";
    await appendGitOperationEvent(
      deps.dispatch,
      context,
      sessionId,
      {
        operation: "stable_point_denied",
        createdAt: new Date().toISOString(),
        project: context.projectPath,
        includeUntracked: parsed.includeUntracked,
        result: "plan_read_only",
        source: "slash",
      },
      "warning",
    );
    deps.writeLine(output, text);
    deps.writeStatus(output, context);
    return;
  }
  const result = await performStablePoint(
    context,
    sessionId,
    { message: parsed.message, includeUntracked: parsed.includeUntracked },
    deps.dispatch,
  );
  deps.writeLine(output, result.text);
  deps.writeStatus(output, context);
}

export async function runWorktreeCreateSlash(
  args: string[],
  context: TuiContext,
  output: Writable,
  deps: GitSlashDeps,
): Promise<void> {
  const parsed = parseWorktreeSlashArgs(args);
  if (!parsed.name) {
    deps.writeLine(output, "用法：/worktree create <name> [--branch <branch>] [--from <ref>]");
    return;
  }
  const sessionId = await deps.ensureSession(context);
  const result = await performWorktreeCreate(
    context,
    sessionId,
    { name: parsed.name, branch: parsed.branch, fromRef: parsed.fromRef },
    deps.dispatch,
  );
  deps.writeLine(output, result.text);
  deps.writeStatus(output, context);
}

export async function runWorktreeRemoveSlash(
  args: string[],
  context: TuiContext,
  output: Writable,
  deps: GitSlashDeps,
): Promise<void> {
  const parsed = parseWorktreeSlashArgs(args);
  if (!parsed.name) {
    deps.writeLine(output, "用法：/worktree remove <name> [--force]");
    return;
  }
  const sessionId = await deps.ensureSession(context);
  const plan = await planManagedWorktreeRemove(context.projectPath, {
    name: parsed.name,
    force: parsed.force,
  });
  const summary = summarizeWorktreeRemovePlan(plan, context.language);
  if (summary.needsConfirmation && (plan.kind === "clean" || plan.kind === "dirty_force")) {
    // slash 路径也走 pendingLocalApproval 轻/强确认；无 continuation（不回灌模型）。
    context.pendingLocalApproval = {
      kind: "git_worktree_remove",
      sessionId,
      name: plan.name,
      path: plan.path,
      force: plan.kind === "dirty_force",
      strong: summary.strong,
    };
    await appendGitOperationEvent(
      deps.dispatch,
      context,
      sessionId,
      {
        operation: "worktree_remove_requested",
        createdAt: new Date().toISOString(),
        name: plan.name,
        path: plan.path,
        force: plan.kind === "dirty_force",
        result: "pending_confirmation",
      },
      "info",
    );
    deps.writeLine(output, summary.text);
    deps.writeStatus(output, context);
    return;
  }
  if (plan.kind === "dirty_blocked" || plan.kind === "not_managed") {
    await appendGitOperationEvent(
      deps.dispatch,
      context,
      sessionId,
      {
        operation: "worktree_remove_denied",
        createdAt: new Date().toISOString(),
        name: parsed.name,
        reason: summary.text,
        result: "denied",
      },
      "warning",
    );
  }
  deps.writeLine(output, summary.text);
  deps.writeStatus(output, context);
}
