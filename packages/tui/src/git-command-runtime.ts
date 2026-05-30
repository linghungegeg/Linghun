import type { Writable } from "node:stream";
import type { TuiContext } from "./index.js";
import { formatGitStatusDetails, isGitRepository, readGitStatus, readWorktreeList, suggestStablePoint, type GitStatus, type StablePointHint, type WorktreeReport } from "./git-runtime.js";
import { showCommandPanel } from "./command-panel-runtime.js";
import { resolveManagedWorktreeRoot, redactWorktreePath, MANAGED_WORKTREE_DIRNAME } from "./git-operation-runtime.js";
import {
  type GitSlashDeps,
  runStablePointCreateSlash,
  runWorktreeCreateSlash,
  runWorktreeRemoveSlash,
} from "./git-slash-runtime.js";

/**
 * D.13R/D.14G Git / Worktree / Stable Point slash 入口。
 *
 * 只读路径（不确认）：/git, /git status, /git stable, /git worktree, /git doctor。
 * mutating slash 路径（确定入口，直接走 runtime，不经模型）：
 *   /git stable create "<message>" [--include-untracked]
 *   /worktree create <name> [--branch <b>] [--from <ref>]
 *   /worktree remove <name> [--force]
 * slash 与模型工具共用同一 git-operation-runtime；worktree remove 走 pendingLocalApproval
 * 轻/强确认。危险 git mutating（reset / checkout overwrite / branch -D）本阶段不提供。
 */
export async function handleGitCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
  deps: GitSlashDeps,
): Promise<void> {
  const action = (args[0] ?? "status").toLowerCase();
  if (action === "stable") {
    const sub = (args[1] ?? "").toLowerCase();
    if (sub === "create") {
      await runStablePointCreateSlash(args.slice(2), context, output, deps);
      return;
    }
    await renderStablePointPanel(context, output);
    return;
  }
  if (action === "worktree") {
    await renderWorktreePanel(context, output);
    return;
  }
  await renderGitStatusPanel(context, output, action === "doctor");
}

export async function handleWorktreeCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
  deps: GitSlashDeps,
): Promise<void> {
  const action = (args[0] ?? "list").toLowerCase();
  if (action === "create") {
    await runWorktreeCreateSlash(args.slice(1), context, output, deps);
    return;
  }
  if (action === "remove") {
    await runWorktreeRemoveSlash(args.slice(1), context, output, deps);
    return;
  }
  await renderWorktreePanel(context, output);
}

export async function handleCheckpointCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
  deps: GitSlashDeps,
): Promise<void> {
  const action = (args[0] ?? "list").toLowerCase();
  if (action === "create") {
    // /checkpoint create 与 /git stable create 同义：先 snapshot 安全垫，再按 git 状态决定。
    await runStablePointCreateSlash(args.slice(1), context, output, deps);
    return;
  }
  if (action === "stable") {
    await renderStablePointPanel(context, output);
    return;
  }
  await renderCheckpointPanel(context, output);
}


export async function renderGitStatusPanel(
  context: TuiContext,
  output: Writable,
  expanded: boolean,
): Promise<void> {
  const isEn = context.language === "en-US";
  const status: GitStatus = await readGitStatus(context.projectPath);
  const worktrees: WorktreeReport = await readWorktreeList(context.projectPath);
  if (status.kind === "not_a_git_repo") {
    showCommandPanel(context, output, {
      title: "/git",
      tone: "neutral",
      summary: [isEn ? "Not a git repository." : "当前目录不是 git 仓库。"],
      actions: [],
    });
    return;
  }
  if (status.kind === "git_unavailable") {
    showCommandPanel(context, output, {
      title: "/git",
      tone: "warning",
      summary: [
        isEn
          ? "git binary unavailable; status cannot be probed."
          : "git 不可用，无法读取状态。",
      ],
      detailsText: status.error,
    });
    return;
  }
  const stable = suggestStablePoint(status);
  const dirty = status.changedCount > 0 || status.untrackedCount > 0;
  const summary: string[] = [
    isEn
      ? `Branch ${status.branch ?? "(detached)"}${status.upstream ? ` ↔ ${status.upstream}` : ""}${dirty ? " · dirty" : " · clean"}`
      : `分支 ${status.branch ?? "（游离）"}${status.upstream ? ` ↔ ${status.upstream}` : ""}${dirty ? " · 有改动" : " · 干净"}`,
  ];
  if (status.headShort) {
    summary.push(
      isEn
        ? `HEAD ${status.headShort}${status.headSubject ? `  ${status.headSubject}` : ""}`
        : `HEAD ${status.headShort}${status.headSubject ? `  ${status.headSubject}` : ""}`,
    );
  }
  if (dirty) {
    summary.push(
      isEn
        ? `${status.changedCount} changed · ${status.untrackedCount} untracked`
        : `已改动 ${status.changedCount} · 未跟踪 ${status.untrackedCount}`,
    );
  }
  if (status.ahead > 0 || status.behind > 0) {
    summary.push(
      isEn
        ? `ahead ${status.ahead} · behind ${status.behind}`
        : `领先 ${status.ahead} · 落后 ${status.behind}`,
    );
  }
  if (stable.recommended) {
    summary.push(
      isEn
        ? `Stable point: ${stable.suggestedSubject}`
        : `稳定点建议：${stable.suggestedSubject}`,
    );
  }
  const actions: string[] = [];
  if (dirty) actions.push('/git stable create "<message>"');
  actions.push("/worktree");
  actions.push("/git doctor");
  showCommandPanel(context, output, {
    title: "/git",
    tone: dirty ? "warning" : "neutral",
    summary,
    actions,
    detailsText: formatGitStatusDetails(status, worktrees),
    expanded: expanded ? true : undefined,
  });
}



export async function renderStablePointPanel(
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const isEn = context.language === "en-US";
  const status = await readGitStatus(context.projectPath);
  const stable: StablePointHint = suggestStablePoint(status);
  if (status.kind !== "ok") {
    showCommandPanel(context, output, {
      title: "/git stable",
      tone: status.kind === "git_unavailable" ? "warning" : "neutral",
      summary: [stable.reason],
    });
    return;
  }
  if (!stable.recommended) {
    showCommandPanel(context, output, {
      title: "/git stable",
      tone: "neutral",
      summary: [stable.reason],
      actions: status.untrackedCount > 0 ? ["/git status"] : [],
      detailsText: formatGitStatusDetails(status, await readWorktreeList(context.projectPath)),
    });
    return;
  }
  const summary: string[] = [
    isEn
      ? `Recommended: commit ${stable.changedCount} file${stable.changedCount === 1 ? "" : "s"}.`
      : `建议：将 ${stable.changedCount} 个改动提交为稳定点。`,
    isEn
      ? `Suggested subject: ${stable.suggestedSubject}`
      : `建议提交标题：${stable.suggestedSubject}`,
    isEn
      ? "This is a read-only suggestion; Linghun will not auto-commit."
      : "这是只读建议；Linghun 不会自动提交，需要您显式确认。",
  ];
  const detailsParts: string[] = [];
  detailsParts.push(stable.reason);
  if (stable.staged.length > 0) {
    detailsParts.push("");
    detailsParts.push(isEn ? "staged (preview):" : "已暂存（预览）：");
    for (const path of stable.staged) detailsParts.push(`  + ${path}`);
  }
  if (stable.unstaged.length > 0) {
    detailsParts.push("");
    detailsParts.push(isEn ? "unstaged (preview):" : "未暂存（预览）：");
    for (const path of stable.unstaged) detailsParts.push(`  M ${path}`);
  }
  if (stable.untracked.length > 0) {
    detailsParts.push("");
    detailsParts.push(isEn ? "untracked (preview):" : "未跟踪（预览）：");
    for (const path of stable.untracked) detailsParts.push(`  ? ${path}`);
  }
  showCommandPanel(context, output, {
    title: "/git stable",
    tone: "neutral",
    summary,
    actions: ['/git stable create "<message>"', "/git status", "/git doctor"],
    detailsText: detailsParts.join("\n"),
  });
}



export async function renderWorktreePanel(
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const isEn = context.language === "en-US";
  if (!(await isGitRepository(context.projectPath))) {
    showCommandPanel(context, output, {
      title: "/worktree",
      tone: "neutral",
      summary: [isEn ? "Not a git repository." : "当前目录不是 git 仓库。"],
    });
    return;
  }
  const report = await readWorktreeList(context.projectPath);
  if (report.kind !== "ok") {
    showCommandPanel(context, output, {
      title: "/worktree",
      tone: "warning",
      summary: [
        isEn ? "git worktree list unavailable." : "无法读取 git worktree 列表。",
      ],
      detailsText: report.kind === "git_unavailable" ? report.error : "",
    });
    return;
  }
  const current = report.entries.find((entry) => entry.isCurrent);
  const managedRoot = resolveManagedWorktreeRoot(context.projectPath);
  const managedPrefix = `${MANAGED_WORKTREE_DIRNAME}/`;
  const isManaged = (path: string): boolean =>
    redactWorktreePath(path).startsWith(managedPrefix);
  const summary: string[] = [
    isEn
      ? `${report.entries.length} worktree${report.entries.length === 1 ? "" : "s"} · current: ${current?.branch ?? current?.path ?? "(unknown)"}`
      : `共 ${report.entries.length} 个 worktree · 当前：${current?.branch ?? current?.path ?? "（未知）"}`,
    isEn
      ? `Managed root: ${redactWorktreePath(managedRoot)}`
      : `受控目录：${redactWorktreePath(managedRoot)}`,
    isEn
      ? "Create/remove managed worktrees via slash; external worktrees are listed but cannot be removed here."
      : "用 slash 创建/删除受控 worktree；external worktree 仅列出，不允许在此删除。",
  ];
  const sections = [
    {
      title: isEn ? "Worktrees" : "worktree 列表",
      rows: report.entries.slice(0, 8).map((entry) => {
        const marker = entry.isCurrent ? "*" : " ";
        const branch = entry.branch ?? (entry.detached ? "(detached)" : entry.bare ? "(bare)" : "(no branch)");
        const head = entry.head ? entry.head.slice(0, 7) : "-";
        const tag = isManaged(entry.path) ? "" : isEn ? "  [external]" : "  [external]";
        return `${marker} ${redactWorktreePath(entry.path)}  ${branch}  ${head}${tag}`;
      }),
    },
  ];
  showCommandPanel(context, output, {
    title: "/worktree",
    tone: "neutral",
    summary,
    sections,
    actions: ["/worktree create <name>", "/worktree remove <name>"],
    detailsText: formatGitStatusDetails(await readGitStatus(context.projectPath), report),
  });
}



export async function renderCheckpointPanel(
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const isEn = context.language === "en-US";
  const checkpoints = context.checkpoints ?? [];
  if (checkpoints.length === 0) {
    showCommandPanel(context, output, {
      title: "/checkpoint",
      tone: "neutral",
      summary: [
        isEn
          ? "No Linghun snapshot checkpoints yet. Linghun snapshots are in-memory file snapshots, not git commits."
          : "暂无 Linghun snapshot checkpoint。Linghun snapshot 是内存文件快照，不是 git commit。",
      ],
      actions: ['/checkpoint create "<message>"', "/git stable"],
    });
    return;
  }
  const summary: string[] = [
    isEn
      ? `${checkpoints.length} snapshot checkpoint${checkpoints.length === 1 ? "" : "s"} (Linghun in-memory snapshots, not git commits).`
      : `共 ${checkpoints.length} 个 snapshot checkpoint（Linghun 内存快照，不是 git commit）。`,
    isEn
      ? 'For a real git stable point use /checkpoint create "<message>" or /git stable create.'
      : '需要真实 git 稳定点请用 /checkpoint create "<message>" 或 /git stable create。',
  ];
  const sections = [
    {
      title: isEn ? "Recent checkpoints" : "最近 checkpoint",
      rows: checkpoints.slice(0, 8).map((checkpoint) => {
        const reason = checkpoint.reason ?? "";
        return `${checkpoint.id}  ${checkpoint.createdAt}  ${reason}`;
      }),
    },
  ];
  const detailsText = checkpoints
    .slice(0, 5)
    .map(
      (checkpoint) =>
        `${checkpoint.id}  ${checkpoint.createdAt}\n  reason: ${checkpoint.reason}\n  changedFiles: ${checkpoint.changedFiles.join(", ")}\n  restoreKind: ${checkpoint.restoreKind}`,
    )
    .join("\n\n");
  showCommandPanel(context, output, {
    title: "/checkpoint",
    tone: "neutral",
    summary,
    sections,
    actions: ["/rewind restore <id>", "/git stable"],
    detailsText,
  });
}



