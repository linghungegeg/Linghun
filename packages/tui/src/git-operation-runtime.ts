/**
 * git-operation-runtime.ts — D.14G Git / Stable Point / Managed Worktree
 * mutating operations.
 *
 * 设计原则：
 * - 与 git-runtime.ts（只读探测）分层：本模块负责 commit / worktree add / worktree
 *   remove 等 mutating 操作，但仍只走 git 子命令的 **execFile 参数数组** 形态，
 *   绝不 shell 拼接，绝不接受 user-controlled 绝对路径。
 * - 纯逻辑 + git 子进程 + managed root mkdir；不触碰 TuiContext / store / evidence。
 *   事件、evidence、权限确认由 index.ts 薄 glue 负责。
 * - slug/name/branch/ref 在任何副作用（git 命令、mkdir）之前同步校验，防 path escape。
 * - 失败一律 fail-closed：返回 kind="failed" / "invalid"，绝不假成功。
 * - 参考 CCB worktree.ts 的产品行为（受控目录、slug 校验、git worktree remove 而非
 *   rm -rf、dirty fail-closed），不复制其源码实现、不做 hooks/tmux/symlink/
 *   .worktreeinclude/stale 自动清理/branch -D。
 */

import { mkdir } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import {
  type GitRunner,
  type GitStatus,
  createGitRunner,
  readGitStatus,
  readWorktreeList,
} from "./git-runtime.js";

// worktree add / commit 比只读探测慢；给更宽的超时，但仍有界，避免挂死。
const GIT_MUTATION_TIMEOUT_MS = 20_000;

const defaultMutatingRunner: GitRunner = createGitRunner(GIT_MUTATION_TIMEOUT_MS);

// ---------------------------------------------------------------------------
// Validation — slug / name / ref / message
// ---------------------------------------------------------------------------

export const MAX_STABLE_POINT_MESSAGE_LENGTH = 200;
export const MAX_WORKTREE_NAME_LENGTH = 64;
export const MAX_GIT_REF_LENGTH = 200;

// worktree name 允许的字符：字母数字 . _ -（不含 slash/backslash/盘符/shell 特殊字符）。
const VALID_WORKTREE_NAME = /^[A-Za-z0-9._-]+$/u;
// git ref 安全字符集：允许 / 用于 origin/main 形态；禁止 git 禁用字符与空白。
const VALID_GIT_REF = /^[A-Za-z0-9._/-]+$/u;

// 换行、回车、制表符、其它 C0/C1 控制字符与 DEL。用 codepoint 判定，避免在正则字面量里
// 嵌入控制字符（既触发 lint，又难以维护）。
function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
      return true;
    }
  }
  return false;
}

export type ValidationOk<T> = { ok: true } & T;
export type ValidationErr = { ok: false; reason: string };

export function validateStablePointMessage(
  message: string,
): ValidationOk<{ message: string }> | ValidationErr {
  const trimmed = message.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "stable point message 不能为空。" };
  }
  if (trimmed.length > MAX_STABLE_POINT_MESSAGE_LENGTH) {
    return {
      ok: false,
      reason: `stable point message 过长（最多 ${MAX_STABLE_POINT_MESSAGE_LENGTH} 字符）。`,
    };
  }
  if (hasControlChar(trimmed)) {
    return { ok: false, reason: "stable point message 不能包含换行或控制字符。" };
  }
  return { ok: true, message: trimmed };
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export function defaultStablePointMessage(now: Date = new Date()): string {
  const date = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const time = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  return `chore: stable point ${date} ${time}`;
}

export function validateWorktreeName(
  name: string,
): ValidationOk<{ slug: string; displayName: string }> | ValidationErr {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "worktree 名称不能为空。" };
  }
  if (trimmed.length > MAX_WORKTREE_NAME_LENGTH) {
    return {
      ok: false,
      reason: `worktree 名称过长（最多 ${MAX_WORKTREE_NAME_LENGTH} 字符）。`,
    };
  }
  if (hasControlChar(trimmed)) {
    return { ok: false, reason: "worktree 名称不能包含控制字符。" };
  }
  if (trimmed === "." || trimmed === "..") {
    return { ok: false, reason: 'worktree 名称不能是 "." 或 ".."。' };
  }
  // 显式拒绝 slash/backslash/盘符，避免 path escape；这些在 VALID_WORKTREE_NAME 之外，
  // 但单独给出更清晰的拒绝原因。
  if (/[\\/]/u.test(trimmed)) {
    return { ok: false, reason: "worktree 名称不能包含 / 或 \\。" };
  }
  if (/:/u.test(trimmed)) {
    return { ok: false, reason: "worktree 名称不能包含盘符或冒号。" };
  }
  if (!VALID_WORKTREE_NAME.test(trimmed)) {
    return {
      ok: false,
      reason: "worktree 名称只能包含字母、数字、点、下划线和连字符。",
    };
  }
  return { ok: true, slug: trimmed, displayName: trimmed };
}

export function validateGitRef(ref: string): ValidationOk<{ ref: string }> | ValidationErr {
  const trimmed = ref.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "git ref 不能为空。" };
  }
  if (trimmed.length > MAX_GIT_REF_LENGTH) {
    return { ok: false, reason: "git ref 过长。" };
  }
  if (hasControlChar(trimmed) || /\s/u.test(trimmed)) {
    return { ok: false, reason: "git ref 不能包含空白或控制字符。" };
  }
  if (trimmed.startsWith("-")) {
    return { ok: false, reason: "git ref 不能以 - 开头。" };
  }
  if (trimmed.includes("..")) {
    return { ok: false, reason: 'git ref 不能包含 ".."。' };
  }
  if (trimmed.endsWith("/") || trimmed.endsWith(".lock")) {
    return { ok: false, reason: "git ref 形态非法。" };
  }
  if (!VALID_GIT_REF.test(trimmed)) {
    return {
      ok: false,
      reason: "git ref 含非法字符；只允许字母、数字、点、下划线、斜杠和连字符。",
    };
  }
  return { ok: true, ref: trimmed };
}

// ---------------------------------------------------------------------------
// Managed worktree root — 受控目录，不接受任意绝对路径
// ---------------------------------------------------------------------------

export const MANAGED_WORKTREE_DIRNAME = ".linghun-worktrees";

function sanitizeRepoSlug(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]/gu, "-").replace(/^-+|-+$/gu, "");
  return cleaned.length > 0 ? cleaned : "repo";
}

/**
 * managed worktree root = `<repo 父级>/.linghun-worktrees/<repo-slug>`。
 * 放在仓库父级而不是仓库内，避免 worktree 嵌套进主仓库工作树本身。
 */
export function resolveManagedWorktreeRoot(repoRoot: string): string {
  const slug = sanitizeRepoSlug(basename(repoRoot.replace(/[\\/]+$/u, "")));
  return join(dirname(repoRoot), MANAGED_WORKTREE_DIRNAME, slug);
}

export function managedWorktreePath(repoRoot: string, slug: string): string {
  return join(resolveManagedWorktreeRoot(repoRoot), slug);
}

function normalizePath(value: string): string {
  return value.replace(/\\/gu, "/").replace(/\/+$/u, "").toLowerCase();
}

function isUnderManagedRoot(repoRoot: string, candidatePath: string): boolean {
  const root = normalizePath(resolveManagedWorktreeRoot(repoRoot));
  const target = normalizePath(candidatePath);
  return target === root || target.startsWith(`${root}/`);
}

/**
 * 给 prompt / 主屏用的 redacted 路径：在 managed root 下时压成
 * `.linghun-worktrees/<repo>/<name>`；否则只保留尾部两段，避免长绝对路径污染。
 */
export function redactWorktreePath(absolutePath: string): string {
  const normalized = absolutePath.replace(/\\/gu, "/").replace(/\/+$/u, "");
  const idx = normalized.lastIndexOf(`/${MANAGED_WORKTREE_DIRNAME}/`);
  if (idx >= 0) {
    return normalized.slice(idx + 1);
  }
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length <= 2) return normalized;
  return `…/${segments.slice(-2).join("/")}`;
}

// ---------------------------------------------------------------------------
// Sensitive untracked filtering — includeUntracked 时绝不提交敏感/ignored 文件
// ---------------------------------------------------------------------------

const SENSITIVE_UNTRACKED_PATTERNS: RegExp[] = [
  /(?:^|\/)\.env(?:\.|$)/iu,
  /\.env$/iu,
  /(?:^|\/)provider\.env$/iu,
  /key|token|secret|password|credential/iu,
  /(?:^|\/)\.git(?:\/|$)/iu,
  /(?:^|\/)node_modules(?:\/|$)/iu,
  /(?:^|\/)dist(?:\/|$)/iu,
  /\.pem$|\.key$|id_rsa/iu,
];

export function isSensitiveUntrackedPath(path: string): boolean {
  const normalized = path.replace(/\\/gu, "/");
  return SENSITIVE_UNTRACKED_PATTERNS.some((re) => re.test(normalized));
}

export function filterUntrackedForCommit(untracked: string[]): {
  included: string[];
  rejected: string[];
} {
  const included: string[] = [];
  const rejected: string[] = [];
  for (const path of untracked) {
    if (isSensitiveUntrackedPath(path)) {
      rejected.push(path);
    } else {
      included.push(path);
    }
  }
  return { included, rejected };
}

// redacted 摘要：只保留文件名 + 安全标签，不泄漏完整敏感路径内容。
export function summarizeRejectedUntracked(rejected: string[]): string[] {
  return rejected.slice(0, 8).map((path) => {
    const name = path.replace(/\\/gu, "/").split("/").pop() ?? path;
    return `${name} (sensitive/ignored)`;
  });
}

// ---------------------------------------------------------------------------
// Stable point — GitStablePointCreate / slash stable create 共用
// ---------------------------------------------------------------------------

export type StablePointOutcome =
  | { kind: "not_a_git_repo" }
  | { kind: "git_unavailable"; reason: string }
  | { kind: "skipped"; reason: string; branch: string | null; head: string | null }
  | { kind: "snapshot"; reason: "untracked_only_not_included" | "include_untracked_empty" }
  | {
      kind: "git_commit";
      sha: string;
      subject: string;
      branch: string | null;
      changedCount: number;
      includedUntracked: boolean;
      rejectedUntracked: string[];
    }
  | { kind: "failed"; reason: string };

function uniquePaths(...lists: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const path of list) {
      if (!seen.has(path)) {
        seen.add(path);
        out.push(path);
      }
    }
  }
  return out;
}

/**
 * 创建 git 稳定点。read git status → 分支决策：
 *   - not git repo / git unavailable → 交给调用方走 snapshot stable point。
 *   - clean → skipped（不创建空 commit）。
 *   - 仅 untracked 且未 includeUntracked → snapshot（untracked_only_not_included）。
 *   - tracked 改动（或 includeUntracked 纳入了 untracked）→ execFile 数组执行
 *     git add -- <files> + git commit -m <message> -- <files>，读回 sha/subject。
 *   - git 失败 → failed（fail-closed）。
 *
 * subject/message 必须已通过 validateStablePointMessage；本函数不二次确认（slash 或
 * 模型工具调用即执行意图）。
 */
export async function createGitStablePoint(
  cwd: string,
  options: { message: string; includeUntracked?: boolean },
  runner: GitRunner = defaultMutatingRunner,
): Promise<StablePointOutcome> {
  const status: GitStatus = await readGitStatus(cwd, runner);
  if (status.kind === "not_a_git_repo") {
    return { kind: "not_a_git_repo" };
  }
  if (status.kind === "git_unavailable") {
    return { kind: "git_unavailable", reason: status.error };
  }

  if (status.changedCount === 0 && status.untrackedCount === 0) {
    return {
      kind: "skipped",
      reason: "工作区干净，没有可提交的改动；未创建空 commit。",
      branch: status.branch,
      head: status.headShort,
    };
  }

  const includeUntracked = options.includeUntracked === true;
  const tracked = uniquePaths(status.staged, status.unstaged);
  let included: string[] = [];
  let rejected: string[] = [];
  if (includeUntracked) {
    const filtered = filterUntrackedForCommit(status.untracked);
    included = filtered.included;
    rejected = filtered.rejected;
  }
  const toCommit = uniquePaths(tracked, included);

  if (toCommit.length === 0) {
    // 走到这里说明非 clean，但没有可提交文件：要么仅 untracked 且未 include，
    // 要么 include 后全部被敏感过滤掉。
    return {
      kind: "snapshot",
      reason: includeUntracked ? "include_untracked_empty" : "untracked_only_not_included",
    };
  }

  // git 操作以 repo toplevel 为 cwd，使 porcelain 相对路径正确解析。
  const toplevelResult = await runner(cwd, ["rev-parse", "--show-toplevel"]);
  const repoRoot =
    toplevelResult.ok && toplevelResult.stdout.trim() ? toplevelResult.stdout.trim() : cwd;

  const addResult = await runner(repoRoot, ["add", "--", ...toCommit]);
  if (!addResult.ok) {
    return { kind: "failed", reason: addResult.stderr || "git add 失败" };
  }
  const commitResult = await runner(repoRoot, ["commit", "-m", options.message, "--", ...toCommit]);
  if (!commitResult.ok) {
    return { kind: "failed", reason: commitResult.stderr || "git commit 失败" };
  }
  const headResult = await runner(repoRoot, ["log", "-1", "--format=%h\t%s"]);
  let sha = "";
  let subject = options.message;
  if (headResult.ok) {
    const [shaPart, ...rest] = headResult.stdout.split("\t");
    if (shaPart) sha = shaPart.trim();
    if (rest.length > 0) subject = rest.join("\t");
  }
  return {
    kind: "git_commit",
    sha,
    subject,
    branch: status.branch,
    changedCount: toCommit.length,
    includedUntracked: included.length > 0,
    rejectedUntracked: rejected,
  };
}

// ---------------------------------------------------------------------------
// Managed worktree create — safe-create，不二次确认
// ---------------------------------------------------------------------------

export type WorktreeCreateOutcome =
  | { kind: "not_a_git_repo" }
  | { kind: "git_unavailable"; reason: string }
  | { kind: "invalid"; reason: string }
  | {
      kind: "resumed";
      path: string;
      name: string;
      branch: string | null;
      head: string | null;
      managedRoot: string;
    }
  | {
      kind: "created";
      path: string;
      name: string;
      branch: string | null;
      fromRef: string;
      head: string | null;
      managedRoot: string;
      createdAt: string;
    }
  | { kind: "failed"; reason: string };

async function resolveRepoRoot(
  cwd: string,
  runner: GitRunner,
): Promise<{ ok: true; repoRoot: string } | { ok: false; outcome: WorktreeCreateOutcome }> {
  const repoCheck = await runner(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (!repoCheck.ok) {
    if (repoCheck.stderr.toLowerCase().includes("not a git repository")) {
      return { ok: false, outcome: { kind: "not_a_git_repo" } };
    }
    return {
      ok: false,
      outcome: { kind: "git_unavailable", reason: repoCheck.stderr || "git rev-parse failed" },
    };
  }
  const common = await runner(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (common.ok && common.stdout.trim()) {
    // common-dir 形如 <main>/.git；其 dirname 即主仓库根，保证 managed root 始终
    // 落在主仓库父级，即使当前已在某个 worktree 内。
    const commonDir = common.stdout.trim();
    const mainRoot = basename(commonDir) === ".git" ? dirname(commonDir) : null;
    if (mainRoot) return { ok: true, repoRoot: mainRoot };
  }
  const toplevel = await runner(cwd, ["rev-parse", "--show-toplevel"]);
  if (toplevel.ok && toplevel.stdout.trim()) {
    return { ok: true, repoRoot: toplevel.stdout.trim() };
  }
  return {
    ok: false,
    outcome: { kind: "git_unavailable", reason: "无法解析 git 仓库根目录。" },
  };
}

export async function createManagedWorktree(
  cwd: string,
  options: { name: string; branch?: string; fromRef?: string },
  runner: GitRunner = defaultMutatingRunner,
  now: Date = new Date(),
): Promise<WorktreeCreateOutcome> {
  const nameCheck = validateWorktreeName(options.name);
  if (!nameCheck.ok) {
    return { kind: "invalid", reason: nameCheck.reason };
  }
  let branch: string | undefined;
  if (options.branch !== undefined && options.branch !== "") {
    const branchCheck = validateGitRef(options.branch);
    if (!branchCheck.ok) {
      return { kind: "invalid", reason: `branch 非法：${branchCheck.reason}` };
    }
    branch = branchCheck.ref;
  }
  let fromRef = "HEAD";
  if (options.fromRef !== undefined && options.fromRef !== "") {
    const refCheck = validateGitRef(options.fromRef);
    if (!refCheck.ok) {
      return { kind: "invalid", reason: `fromRef 非法：${refCheck.reason}` };
    }
    fromRef = refCheck.ref;
  }

  const rootResult = await resolveRepoRoot(cwd, runner);
  if (!rootResult.ok) {
    return rootResult.outcome;
  }
  const repoRoot = rootResult.repoRoot;
  const managedRoot = resolveManagedWorktreeRoot(repoRoot);
  const targetPath = managedWorktreePath(repoRoot, nameCheck.slug);

  // 已存在的 worktree？同 managed path → resume，不覆盖、不重复创建。
  const list = await readWorktreeList(cwd, runner);
  if (list.kind === "git_unavailable") {
    return { kind: "git_unavailable", reason: list.error };
  }
  if (list.kind === "ok") {
    const existing = list.entries.find(
      (entry) => normalizePath(entry.path) === normalizePath(targetPath),
    );
    if (existing) {
      return {
        kind: "resumed",
        path: targetPath,
        name: nameCheck.displayName,
        branch: existing.branch,
        head: existing.head,
        managedRoot,
      };
    }
  }

  await mkdir(managedRoot, { recursive: true });

  const addArgs = branch
    ? ["worktree", "add", "-b", branch, targetPath, fromRef]
    : ["worktree", "add", targetPath, fromRef];
  const addResult = await runner(repoRoot, addArgs);
  if (!addResult.ok) {
    return { kind: "failed", reason: addResult.stderr || "git worktree add 失败" };
  }

  let head: string | null = null;
  const headResult = await runner(targetPath, ["rev-parse", "--short", "HEAD"]);
  if (headResult.ok && headResult.stdout.trim()) {
    head = headResult.stdout.trim();
  }
  let resolvedBranch: string | null = branch ?? null;
  if (!resolvedBranch) {
    const branchResult = await runner(targetPath, ["branch", "--show-current"]);
    if (branchResult.ok && branchResult.stdout.trim()) {
      resolvedBranch = branchResult.stdout.trim();
    }
  }
  return {
    kind: "created",
    path: targetPath,
    name: nameCheck.displayName,
    branch: resolvedBranch,
    fromRef,
    head,
    managedRoot,
    createdAt: now.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Managed worktree remove — 危险操作，先 plan（轻/强确认），再 execute
// ---------------------------------------------------------------------------

export type WorktreeRemovePlan =
  | { kind: "not_a_git_repo" }
  | { kind: "git_unavailable"; reason: string }
  | { kind: "invalid"; reason: string }
  | { kind: "not_found"; reason: string }
  | { kind: "not_managed"; reason: string; path: string }
  | { kind: "clean"; path: string; name: string; branch: string | null }
  | { kind: "dirty_blocked"; path: string; name: string }
  | { kind: "dirty_force"; path: string; name: string; branch: string | null };

export async function planManagedWorktreeRemove(
  cwd: string,
  options: { name: string; force?: boolean },
  runner: GitRunner = defaultMutatingRunner,
): Promise<WorktreeRemovePlan> {
  const nameCheck = validateWorktreeName(options.name);
  if (!nameCheck.ok) {
    return { kind: "invalid", reason: nameCheck.reason };
  }
  const rootResult = await resolveRepoRoot(cwd, runner);
  if (!rootResult.ok) {
    if (rootResult.outcome.kind === "not_a_git_repo") return { kind: "not_a_git_repo" };
    return {
      kind: "git_unavailable",
      reason:
        rootResult.outcome.kind === "git_unavailable"
          ? rootResult.outcome.reason
          : "git unavailable",
    };
  }
  const repoRoot = rootResult.repoRoot;
  const targetPath = managedWorktreePath(repoRoot, nameCheck.slug);

  const list = await readWorktreeList(cwd, runner);
  if (list.kind === "git_unavailable") {
    return { kind: "git_unavailable", reason: list.error };
  }
  if (list.kind !== "ok") {
    return { kind: "not_a_git_repo" };
  }
  const entry = list.entries.find((item) => normalizePath(item.path) === normalizePath(targetPath));
  if (!entry) {
    // 也可能用户给了一个 external worktree 的名字；区分 not_found vs not_managed：
    // external worktree 不在 managed root 下，拒绝 remove。
    const externalByName = list.entries.find(
      (item) => basename(item.path.replace(/[\\/]+$/u, "")) === nameCheck.slug,
    );
    if (externalByName && !isUnderManagedRoot(repoRoot, externalByName.path)) {
      return {
        kind: "not_managed",
        reason: "该 worktree 不在 Linghun 受控目录下（external），不允许通过 Linghun 删除。",
        path: externalByName.path,
      };
    }
    return {
      kind: "not_found",
      reason: `未找到受控 worktree：${nameCheck.displayName}。`,
    };
  }
  if (!isUnderManagedRoot(repoRoot, entry.path)) {
    return {
      kind: "not_managed",
      reason: "该 worktree 不在 Linghun 受控目录下（external），不允许通过 Linghun 删除。",
      path: entry.path,
    };
  }

  // dirty check：以 worktree 自身路径为 cwd 读 status；不可用一律按 dirty（fail-closed）。
  const status = await readGitStatus(entry.path, runner);
  const dirty = status.kind !== "ok" || status.changedCount > 0 || status.untrackedCount > 0;
  if (!dirty) {
    return { kind: "clean", path: entry.path, name: nameCheck.displayName, branch: entry.branch };
  }
  if (options.force === true) {
    return {
      kind: "dirty_force",
      path: entry.path,
      name: nameCheck.displayName,
      branch: entry.branch,
    };
  }
  return { kind: "dirty_blocked", path: entry.path, name: nameCheck.displayName };
}

export type WorktreeRemoveResult =
  | { kind: "removed"; path: string }
  | { kind: "failed"; reason: string };

/**
 * 已确认后真正删除。只走 `git worktree remove [--force] <path>`，绝不 rm -rf，
 * 绝不 branch -D。path 必须来自 planManagedWorktreeRemove 的受控结果。
 */
export async function executeManagedWorktreeRemove(
  cwd: string,
  path: string,
  force: boolean,
  runner: GitRunner = defaultMutatingRunner,
): Promise<WorktreeRemoveResult> {
  const rootResult = await resolveRepoRoot(cwd, runner);
  const repoRoot = rootResult.ok ? rootResult.repoRoot : cwd;
  const args = force ? ["worktree", "remove", "--force", path] : ["worktree", "remove", path];
  const result = await runner(repoRoot, args);
  if (!result.ok) {
    return { kind: "failed", reason: result.stderr || "git worktree remove 失败" };
  }
  return { kind: "removed", path };
}

// ---------------------------------------------------------------------------
// Worktree context — 给模型最小投影：是否在隔离工作区
// ---------------------------------------------------------------------------

export type WorktreeContextInfo = {
  isWorktree: boolean;
  repoRoot: string | null;
  currentPath: string;
  branch: string | null;
  managedName: string | null;
  managedRoot: string | null;
  redactedPath: string;
};

export async function computeWorktreeContext(
  cwd: string,
  runner: GitRunner = defaultMutatingRunner,
): Promise<WorktreeContextInfo | null> {
  const repoCheck = await runner(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (!repoCheck.ok || repoCheck.stdout.trim() !== "true") {
    return null;
  }
  const [topResult, gitDirResult, commonDirResult, branchResult] = await Promise.all([
    runner(cwd, ["rev-parse", "--show-toplevel"]),
    runner(cwd, ["rev-parse", "--absolute-git-dir"]),
    runner(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
    runner(cwd, ["branch", "--show-current"]),
  ]);
  const currentPath = topResult.ok && topResult.stdout.trim() ? topResult.stdout.trim() : cwd;
  const gitDir = gitDirResult.ok ? gitDirResult.stdout.trim() : "";
  const commonDir = commonDirResult.ok ? commonDirResult.stdout.trim() : "";
  // 链接 worktree：--absolute-git-dir 形如 <main>/.git/worktrees/<name>，
  // 与 --git-common-dir（<main>/.git）不同；主仓库两者相同。
  const isWorktree =
    gitDir !== "" && commonDir !== "" && normalizePath(gitDir) !== normalizePath(commonDir);
  const mainRoot = commonDir && basename(commonDir) === ".git" ? dirname(commonDir) : currentPath;
  const branch = branchResult.ok && branchResult.stdout.trim() ? branchResult.stdout.trim() : null;
  let managedName: string | null = null;
  let managedRoot: string | null = null;
  if (isWorktree && isUnderManagedRoot(mainRoot, currentPath)) {
    managedRoot = resolveManagedWorktreeRoot(mainRoot);
    managedName = basename(currentPath.replace(/[\\/]+$/u, ""));
  }
  return {
    isWorktree,
    repoRoot: mainRoot,
    currentPath,
    branch,
    managedName,
    managedRoot,
    redactedPath: redactWorktreePath(currentPath),
  };
}

export function isAbsoluteWorktreeInput(value: string): boolean {
  return isAbsolute(value);
}
