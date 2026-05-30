import { execFile } from "node:child_process";
import { promisify } from "node:util";

/**
 * D.13R Git / Worktree / Stable Point Maturity Sweep — 只读 git 探测。
 *
 * 设计原则：
 * - 仅运行 git 子命令的**只读**形式：status --porcelain / branch --show-current /
 *   log -1 / worktree list / rev-parse / show。
 * - **绝不**执行 commit / reset / checkout / worktree add/remove / branch -D 等
 *   mutating 操作 —— 那些必须走 Bash 工具 + permission-policy-engine 四档权限链。
 * - cwd 永远是项目工作区根；不接受 user-controlled 路径，避免命令注入。
 * - 失败保守返回 "not_a_git_repo" / "git_unavailable"，不抛异常。
 *
 * 不引入新依赖（与 LingHun 现有依赖收敛保持一致）；不复制 CCB 源码实现。
 */

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 5000;

/**
 * D.13R: git 子命令执行结果的轻量结构。仅用于 git-runtime 内部和单测注入。
 */
export type GitRunResult = { stdout: string; ok: boolean; stderr: string };

export type GitRunner = (cwd: string, args: string[]) => Promise<GitRunResult>;

export type GitStatus =
  | { kind: "not_a_git_repo" }
  | { kind: "git_unavailable"; error: string }
  | {
      kind: "ok";
      branch: string | null;
      headShort: string | null;
      headSubject: string | null;
      changedCount: number;
      untrackedCount: number;
      staged: string[];
      unstaged: string[];
      untracked: string[];
      ahead: number;
      behind: number;
      upstream: string | null;
    };

export type WorktreeEntry = {
  path: string;
  branch: string | null;
  head: string | null;
  isCurrent: boolean;
  bare: boolean;
  detached: boolean;
};

export type WorktreeReport =
  | { kind: "not_a_git_repo" }
  | { kind: "git_unavailable"; error: string }
  | { kind: "ok"; entries: WorktreeEntry[] };

export type StablePointHint = {
  recommended: boolean;
  reason: string;
  suggestedSubject: string;
  changedCount: number;
  staged: string[];
  unstaged: string[];
  untracked: string[];
};

/**
 * Default git runner: spawn the `git` binary with `cwd`, 5s timeout, and
 * ASKPASS / TERMINAL_PROMPT disabled so we never block on credential prompts.
 *
 * Failures are not swallowed silently for unexpected codes — caller logs via
 * the structured report kinds, not via thrown exceptions. Tests inject a
 * custom runner to exercise the fail-closed branches (status fail / repoCheck
 * non-stderr error / worktree list lock).
 */
/**
 * Build a GitRunner with the given spawn timeout. Credential prompts are
 * disabled so we never block on /dev/tty or askpass GUIs. Mutating callers
 * (git-operation-runtime: commit / worktree add) reuse this factory with a
 * longer timeout than the 5s read-only probe default.
 */
export function createGitRunner(timeoutMs: number): GitRunner {
  return async (cwd: string, args: string[]): Promise<GitRunResult> => {
    try {
      const { stdout, stderr } = await execFileAsync("git", args, {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 4 * 1024 * 1024,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          GIT_ASKPASS: "",
        },
      });
      return { stdout: stdout.toString().trimEnd(), ok: true, stderr: stderr.toString() };
    } catch (error) {
      const stderr =
        error && typeof error === "object" && "stderr" in error
          ? String((error as { stderr?: unknown }).stderr ?? "")
          : "";
      return { stdout: "", ok: false, stderr };
    }
  };
}

const defaultRunGit: GitRunner = createGitRunner(GIT_TIMEOUT_MS);

export async function isGitRepository(
  cwd: string,
  runner: GitRunner = defaultRunGit,
): Promise<boolean> {
  const result = await runner(cwd, ["rev-parse", "--is-inside-work-tree"]);
  return result.ok && result.stdout.trim() === "true";
}

/**
 * Read-only git status snapshot. Parses `git status --porcelain=v1 -b` and
 * `git log -1 --format=%h%x09%s` to produce a UI-ready summary.
 *
 * Fail-closed contract:
 *   - 明确 "not a git repository" → not_a_git_repo
 *   - git binary 缺失 / spawn 失败 / timeout / lock / 其他 git 内部错 → git_unavailable
 *   - status --porcelain 自身失败 → git_unavailable（**不**降级为 ok/clean）
 *   - 调用方因此可以信任 kind="ok" + changedCount=0 真的是干净工作区，
 *     而不是 status 命令失败被静默吞掉。
 */
export async function readGitStatus(
  cwd: string,
  runner: GitRunner = defaultRunGit,
): Promise<GitStatus> {
  // First: detect git availability + repo membership in one shot.
  const repoCheck = await runner(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (!repoCheck.ok) {
    // 仅在 stderr 明确包含 "not a git repository" 时才报告 not_a_git_repo。
    // 其余失败（ENOENT / timeout / lock / 未知错误）一律 git_unavailable —
    // 这是 fail-closed 的关键：让调用方明确区分"工作区不是 git 仓库"vs
    // "git 自己不可用"，后者不能伪装成前者。
    if (repoCheck.stderr.toLowerCase().includes("not a git repository")) {
      return { kind: "not_a_git_repo" };
    }
    return { kind: "git_unavailable", error: repoCheck.stderr || "git rev-parse failed" };
  }
  if (repoCheck.stdout.trim() !== "true") {
    // rev-parse exit 0 但 stdout 不是 "true" 的情况理论上不会发生；保守归为
    // git_unavailable 而不是 not_a_git_repo —— 异常输出不能映射为明确的结论。
    return {
      kind: "git_unavailable",
      error: `unexpected rev-parse stdout: ${repoCheck.stdout.slice(0, 80)}`,
    };
  }

  const [statusResult, logResult, branchResult] = await Promise.all([
    runner(cwd, ["status", "--porcelain=v1", "-b"]),
    runner(cwd, ["log", "-1", "--format=%h\t%s"]),
    runner(cwd, ["branch", "--show-current"]),
  ]);

  // 关键 fail-closed 点：status 失败时**绝不**返回 ok/clean。
  // 例如 `git status` 因为 .git/index.lock / 损坏的 .git/HEAD / 文件系统
  // 权限错误而失败，旧实现会继续构造 ok 块且 changedCount=0，给用户一个
  // 假的"工作区干净"信号；现在直接报告 git_unavailable，让上层提示用户。
  if (!statusResult.ok) {
    return {
      kind: "git_unavailable",
      error: statusResult.stderr || "git status --porcelain failed",
    };
  }

  const branch =
    branchResult.ok && branchResult.stdout.trim().length > 0
      ? branchResult.stdout.trim()
      : null;

  let headShort: string | null = null;
  let headSubject: string | null = null;
  if (logResult.ok) {
    const [shaPart, ...rest] = logResult.stdout.split("\t");
    if (shaPart) headShort = shaPart;
    if (rest.length > 0) headSubject = rest.join("\t");
  }

  const staged: string[] = [];
  const unstaged: string[] = [];
  const untracked: string[] = [];
  let ahead = 0;
  let behind = 0;
  let upstream: string | null = null;

  const lines = statusResult.stdout.split("\n");
  for (const rawLine of lines) {
    if (!rawLine) continue;
    if (rawLine.startsWith("##")) {
      // Branch header line: `## branch...origin/branch [ahead 1, behind 2]`
      const match = rawLine.match(/##\s*([^\s.]+)(?:\.{2,3}([^\s]+))?(?:\s*\[([^\]]+)\])?/);
      if (match) {
        if (match[2]) upstream = match[2];
        const tag = match[3] ?? "";
        const aheadMatch = tag.match(/ahead (\d+)/);
        const behindMatch = tag.match(/behind (\d+)/);
        if (aheadMatch?.[1]) ahead = parseInt(aheadMatch[1], 10);
        if (behindMatch?.[1]) behind = parseInt(behindMatch[1], 10);
      }
      continue;
    }
    const code = rawLine.slice(0, 2);
    const path = rawLine.slice(3);
    if (code === "??") {
      untracked.push(path);
      continue;
    }
    const [indexFlag, worktreeFlag] = [code[0] ?? " ", code[1] ?? " "];
    if (indexFlag !== " " && indexFlag !== "?") staged.push(path);
    if (worktreeFlag !== " " && worktreeFlag !== "?") unstaged.push(path);
  }

  return {
    kind: "ok",
    branch,
    headShort,
    headSubject,
    changedCount: staged.length + unstaged.length,
    untrackedCount: untracked.length,
    staged,
    unstaged,
    untracked,
    ahead,
    behind,
    upstream,
  };
}

/**
 * Read-only worktree list parser. `git worktree list --porcelain` emits one
 * record per worktree with `worktree <path>` / `HEAD <sha>` / `branch <ref>` /
 * `bare` / `detached` lines separated by blank lines.
 *
 * Fail-closed contract（与 readGitStatus 一致）：
 *   - 仅 stderr 明确含 "not a git repository" 时返回 not_a_git_repo
 *   - rev-parse 其他失败 / worktree list 失败 → git_unavailable（不降级为空列表）
 *   - 调用方因此可以信任 entries=[] 真的是 worktree 列表为空，而不是命令失败。
 */
export async function readWorktreeList(
  cwd: string,
  runner: GitRunner = defaultRunGit,
): Promise<WorktreeReport> {
  const repoCheck = await runner(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (!repoCheck.ok) {
    if (repoCheck.stderr.toLowerCase().includes("not a git repository")) {
      return { kind: "not_a_git_repo" };
    }
    return { kind: "git_unavailable", error: repoCheck.stderr || "git rev-parse failed" };
  }
  if (repoCheck.stdout.trim() !== "true") {
    return {
      kind: "git_unavailable",
      error: `unexpected rev-parse stdout: ${repoCheck.stdout.slice(0, 80)}`,
    };
  }
  const [topLevelResult, listResult] = await Promise.all([
    runner(cwd, ["rev-parse", "--show-toplevel"]),
    runner(cwd, ["worktree", "list", "--porcelain"]),
  ]);
  if (!listResult.ok) {
    return {
      kind: "git_unavailable",
      error: listResult.stderr || "git worktree list failed",
    };
  }
  const currentTop = topLevelResult.ok ? topLevelResult.stdout.trim() : "";
  const entries: WorktreeEntry[] = [];
  let pending: Partial<WorktreeEntry> & { path?: string } = {};
  const flush = (): void => {
    if (!pending.path) return;
    entries.push({
      path: pending.path,
      branch: pending.branch ?? null,
      head: pending.head ?? null,
      isCurrent: false,
      bare: pending.bare ?? false,
      detached: pending.detached ?? false,
    });
    pending = {};
  };
  for (const rawLine of listResult.stdout.split("\n")) {
    const line = rawLine.trim();
    if (line === "") {
      flush();
      continue;
    }
    if (line.startsWith("worktree ")) {
      flush();
      pending.path = line.slice("worktree ".length);
      continue;
    }
    if (line.startsWith("HEAD ")) {
      pending.head = line.slice("HEAD ".length);
      continue;
    }
    if (line.startsWith("branch ")) {
      pending.branch = line.slice("branch ".length).replace(/^refs\/heads\//u, "");
      continue;
    }
    if (line === "bare") pending.bare = true;
    if (line === "detached") pending.detached = true;
  }
  flush();
  // Mark current worktree by path-prefix match against `git rev-parse --show-toplevel`.
  if (currentTop) {
    for (const entry of entries) {
      if (normalizePath(entry.path) === normalizePath(currentTop)) {
        entry.isCurrent = true;
      }
    }
  }
  return { kind: "ok", entries };
}

function normalizePath(value: string): string {
  return value.replace(/\\/gu, "/").replace(/\/+$/u, "").toLowerCase();
}

/**
 * Stable-point recommendation: derive a short suggestion subject + whether a
 * commit looks worth doing right now. **Read-only**; does not invoke commit.
 *
 * Heuristic:
 * - 0 changed + 0 untracked → not recommended; tree is already clean.
 * - >0 changed → recommended; suggested subject = "wip: <N> file(s) updated"
 *   with a hint to replace the prefix with feat/fix/chore once the user
 *   reviews the diff.
 * - Only untracked → not recommended; suggest reviewing untracked first.
 */
export function suggestStablePoint(status: GitStatus): StablePointHint {
  if (status.kind !== "ok") {
    const reason =
      status.kind === "not_a_git_repo"
        ? "当前目录不是 git 仓库，跳过 stable point。"
        : `git 不可用：${status.error}`;
    return {
      recommended: false,
      reason,
      suggestedSubject: "",
      changedCount: 0,
      staged: [],
      unstaged: [],
      untracked: [],
    };
  }
  const staged = status.staged.slice(0, 5);
  const unstaged = status.unstaged.slice(0, 5);
  const untracked = status.untracked.slice(0, 5);
  if (status.changedCount === 0 && status.untrackedCount === 0) {
    return {
      recommended: false,
      reason: "工作区干净，没有可提交的改动。",
      suggestedSubject: "",
      changedCount: 0,
      staged,
      unstaged,
      untracked,
    };
  }
  if (status.changedCount === 0 && status.untrackedCount > 0) {
    return {
      recommended: false,
      reason: `仅有 ${status.untrackedCount} 个未跟踪文件；先 review 未跟踪内容再决定是否纳入提交。`,
      suggestedSubject: "",
      changedCount: 0,
      staged,
      unstaged,
      untracked,
    };
  }
  const subject = `wip: ${status.changedCount} file${status.changedCount === 1 ? "" : "s"} updated`;
  return {
    recommended: true,
    reason: "工作区有改动，可以提交一个稳定点；建议 review 后用 feat/fix/chore 等前缀替换 wip。",
    suggestedSubject: subject,
    changedCount: status.changedCount,
    staged,
    unstaged,
    untracked,
  };
}

/**
 * Format a long-form text dump (used as commandPanel detailsText / Ctrl+O
 * expansion target) covering: branch, upstream, ahead/behind, HEAD, full
 * staged/unstaged/untracked lists, worktree list. Pure formatter — no IO.
 */
export function formatGitStatusDetails(
  status: GitStatus,
  worktrees: WorktreeReport,
): string {
  if (status.kind === "not_a_git_repo") {
    return "Not a git repository.";
  }
  if (status.kind === "git_unavailable") {
    return `git unavailable: ${status.error || "unknown error"}`;
  }
  const lines: string[] = [];
  lines.push(`branch: ${status.branch ?? "(detached)"}`);
  if (status.upstream) {
    lines.push(`upstream: ${status.upstream} ahead=${status.ahead} behind=${status.behind}`);
  }
  if (status.headShort) {
    lines.push(`HEAD: ${status.headShort}${status.headSubject ? `  ${status.headSubject}` : ""}`);
  }
  lines.push(`changed: ${status.changedCount}; untracked: ${status.untrackedCount}`);
  if (status.staged.length > 0) {
    lines.push("");
    lines.push("staged:");
    for (const path of status.staged) lines.push(`  + ${path}`);
  }
  if (status.unstaged.length > 0) {
    lines.push("");
    lines.push("unstaged:");
    for (const path of status.unstaged) lines.push(`  M ${path}`);
  }
  if (status.untracked.length > 0) {
    lines.push("");
    lines.push("untracked:");
    for (const path of status.untracked) lines.push(`  ? ${path}`);
  }
  if (worktrees.kind === "ok" && worktrees.entries.length > 0) {
    lines.push("");
    lines.push("worktrees:");
    for (const entry of worktrees.entries) {
      const marker = entry.isCurrent ? "*" : " ";
      const branchLabel = entry.branch ?? (entry.detached ? "(detached)" : entry.bare ? "(bare)" : "(no branch)");
      const head = entry.head ? entry.head.slice(0, 7) : "-";
      lines.push(`  ${marker} ${entry.path}  ${branchLabel}  ${head}`);
    }
  }
  return lines.join("\n");
}
