import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  computeWorktreeContext,
  createGitStablePoint,
  createManagedWorktree,
  defaultStablePointMessage,
  executeManagedWorktreeRemove,
  filterUntrackedForCommit,
  isSensitiveUntrackedPath,
  managedWorktreePath,
  planManagedWorktreeRemove,
  redactWorktreePath,
  resolveManagedWorktreeRoot,
  summarizeRejectedUntracked,
  validateGitRef,
  validateStablePointMessage,
  validateWorktreeName,
} from "./git-operation-runtime.js";
import type { GitRunResult, GitRunner } from "./git-runtime.js";

/**
 * Recording GitRunner: scripted results keyed by argv prefix (first match wins),
 * plus a `calls` log so tests assert the exact execFile argument arrays (no shell
 * string concatenation). Missing keys fail loudly so new git calls are caught.
 */
type Entry = { args: string[]; result: GitRunResult };
function makeRecordingRunner(entries: Entry[]): {
  runner: GitRunner;
  calls: { cwd: string; args: string[] }[];
} {
  const calls: { cwd: string; args: string[] }[] = [];
  const runner: GitRunner = async (cwd, args) => {
    calls.push({ cwd, args });
    for (const entry of entries) {
      if (args.length < entry.args.length) continue;
      let match = true;
      for (let i = 0; i < entry.args.length; i++) {
        if (args[i] !== entry.args[i]) {
          match = false;
          break;
        }
      }
      if (match) return entry.result;
    }
    return { ok: false, stdout: "", stderr: `no scripted entry for: git ${args.join(" ")}` };
  };
  return { runner, calls };
}

const ok = (stdout: string): GitRunResult => ({ ok: true, stdout, stderr: "" });
const fail = (stderr: string): GitRunResult => ({ ok: false, stdout: "", stderr });

// Common read-only probe entries shared by stable-point / worktree tests.
function repoProbe(toplevel: string): Entry[] {
  return [
    { args: ["rev-parse", "--is-inside-work-tree"], result: ok("true") },
    { args: ["rev-parse", "--show-toplevel"], result: ok(toplevel) },
    { args: ["log", "-1"], result: ok("abc1234\tfeat: prior") },
    { args: ["branch", "--show-current"], result: ok("main") },
  ];
}

describe("D.14G validation", () => {
  it("validateStablePointMessage: empty / too long / control char / ok", () => {
    expect(validateStablePointMessage("   ").ok).toBe(false);
    expect(validateStablePointMessage("x".repeat(201)).ok).toBe(false);
    expect(validateStablePointMessage("line1\nline2").ok).toBe(false);
    const good = validateStablePointMessage("  feat: stable  ");
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.message).toBe("feat: stable");
  });

  it("defaultStablePointMessage: safe chore subject with date+time", () => {
    const msg = defaultStablePointMessage(new Date("2026-05-30T09:05:00"));
    expect(msg).toBe("chore: stable point 2026-05-30 09:05");
    expect(validateStablePointMessage(msg).ok).toBe(true);
  });

  it("validateWorktreeName rejects path escape, slash, drive, dotdot, control", () => {
    expect(validateWorktreeName("../escape").ok).toBe(false);
    expect(validateWorktreeName("a/b").ok).toBe(false);
    expect(validateWorktreeName("a\\b").ok).toBe(false);
    expect(validateWorktreeName("C:\\x").ok).toBe(false);
    expect(validateWorktreeName("..").ok).toBe(false);
    expect(validateWorktreeName("a b").ok).toBe(false);
    expect(validateWorktreeName("bad;rm").ok).toBe(false);
    expect(validateWorktreeName("d14b-failure-learning").ok).toBe(true);
  });

  it("validateGitRef allows safe refs, rejects danger", () => {
    expect(validateGitRef("origin/main").ok).toBe(true);
    expect(validateGitRef("feature/x_1.2-3").ok).toBe(true);
    expect(validateGitRef("-bad").ok).toBe(false);
    expect(validateGitRef("a..b").ok).toBe(false);
    expect(validateGitRef("a b").ok).toBe(false);
    expect(validateGitRef("a;rm -rf").ok).toBe(false);
    expect(validateGitRef("refs/heads/x.lock").ok).toBe(false);
  });
});

describe("D.14G managed root + redaction + sensitive filtering", () => {
  it("resolveManagedWorktreeRoot lives in repo parent under .linghun-worktrees/<slug>", () => {
    const root = resolveManagedWorktreeRoot("/work/MyRepo");
    expect(root.replace(/\\/g, "/")).toBe("/work/.linghun-worktrees/MyRepo");
    expect(managedWorktreePath("/work/MyRepo", "feat").replace(/\\/g, "/")).toBe(
      "/work/.linghun-worktrees/MyRepo/feat",
    );
  });

  it("redactWorktreePath collapses managed path and trims long absolute paths", () => {
    expect(redactWorktreePath("/work/.linghun-worktrees/MyRepo/feat")).toBe(
      ".linghun-worktrees/MyRepo/feat",
    );
    expect(redactWorktreePath("/a/b/c/d/e")).toBe("…/d/e");
  });

  it("isSensitiveUntrackedPath flags secrets/env/ignored, allows normal", () => {
    expect(isSensitiveUntrackedPath(".env")).toBe(true);
    expect(isSensitiveUntrackedPath("config/provider.env")).toBe(true);
    expect(isSensitiveUntrackedPath("secrets/api_token.txt")).toBe(true);
    expect(isSensitiveUntrackedPath("node_modules/x.js")).toBe(true);
    expect(isSensitiveUntrackedPath("dist/bundle.js")).toBe(true);
    expect(isSensitiveUntrackedPath("id_rsa")).toBe(true);
    expect(isSensitiveUntrackedPath("src/feature.ts")).toBe(false);
  });

  it("filterUntrackedForCommit splits safe vs sensitive; summary is redacted", () => {
    const { included, rejected } = filterUntrackedForCommit([
      "src/a.ts",
      ".env",
      "docs/readme.md",
      "config/secret-key.json",
    ]);
    expect(included).toEqual(["src/a.ts", "docs/readme.md"]);
    expect(rejected).toEqual([".env", "config/secret-key.json"]);
    const summary = summarizeRejectedUntracked(rejected);
    expect(summary.join(" ")).toContain("(sensitive/ignored)");
    expect(summary.join(" ")).not.toContain("config/");
  });
});

describe("D.14G stable point matrix", () => {
  it("clean repo → skipped, no empty commit", async () => {
    const { runner, calls } = makeRecordingRunner([
      { args: ["rev-parse", "--is-inside-work-tree"], result: ok("true") },
      { args: ["status", "--porcelain=v1", "-b"], result: ok("## main...origin/main") },
      { args: ["log", "-1"], result: ok("abc1234\tfeat: prior") },
      { args: ["branch", "--show-current"], result: ok("main") },
    ]);
    const outcome = await createGitStablePoint("/repo", { message: "x" }, runner);
    expect(outcome.kind).toBe("skipped");
    expect(calls.some((c) => c.args[0] === "commit")).toBe(false);
  });

  it("tracked dirty → git_commit with sha/subject via execFile args arrays", async () => {
    const { runner, calls } = makeRecordingRunner([
      { args: ["rev-parse", "--is-inside-work-tree"], result: ok("true") },
      {
        args: ["status", "--porcelain=v1", "-b"],
        result: ok("## main\n M src/a.ts\nA  src/b.ts"),
      },
      { args: ["log", "-1"], result: ok("def5678\tchore: stable point") },
      { args: ["branch", "--show-current"], result: ok("main") },
      { args: ["rev-parse", "--show-toplevel"], result: ok("/repo") },
      { args: ["add", "--"], result: ok("") },
      { args: ["commit", "-m"], result: ok("") },
    ]);
    const outcome = await createGitStablePoint("/repo", { message: "feat: x" }, runner);
    expect(outcome.kind).toBe("git_commit");
    if (outcome.kind === "git_commit") {
      expect(outcome.sha).toBe("def5678");
      expect(outcome.subject).toBe("chore: stable point");
      expect(outcome.changedCount).toBe(2);
      expect(outcome.includedUntracked).toBe(false);
    }
    const commitCall = calls.find((c) => c.args[0] === "commit");
    // staged paths come before unstaged in the add/commit argv (deterministic order).
    expect(commitCall?.args).toEqual(["commit", "-m", "feat: x", "--", "src/b.ts", "src/a.ts"]);
    // message passed as a discrete argv element — never shell-concatenated.
    expect(commitCall?.args.includes("feat: x")).toBe(true);
  });

  it("only untracked, no include → snapshot (untracked_only_not_included), no commit", async () => {
    const { runner, calls } = makeRecordingRunner([
      { args: ["rev-parse", "--is-inside-work-tree"], result: ok("true") },
      { args: ["status", "--porcelain=v1", "-b"], result: ok("## main\n?? newfile.ts") },
      { args: ["log", "-1"], result: ok("abc1234\tfeat: prior") },
      { args: ["branch", "--show-current"], result: ok("main") },
    ]);
    const outcome = await createGitStablePoint("/repo", { message: "x" }, runner);
    expect(outcome.kind).toBe("snapshot");
    if (outcome.kind === "snapshot") expect(outcome.reason).toBe("untracked_only_not_included");
    expect(calls.some((c) => c.args[0] === "commit")).toBe(false);
  });

  it("includeUntracked → normal untracked included in commit", async () => {
    const { runner, calls } = makeRecordingRunner([
      { args: ["rev-parse", "--is-inside-work-tree"], result: ok("true") },
      { args: ["status", "--porcelain=v1", "-b"], result: ok("## main\n?? newfile.ts") },
      { args: ["log", "-1"], result: ok("aaa1111\tchore: sp") },
      { args: ["branch", "--show-current"], result: ok("main") },
      { args: ["rev-parse", "--show-toplevel"], result: ok("/repo") },
      { args: ["add", "--"], result: ok("") },
      { args: ["commit", "-m"], result: ok("") },
    ]);
    const outcome = await createGitStablePoint(
      "/repo",
      { message: "chore: sp", includeUntracked: true },
      runner,
    );
    expect(outcome.kind).toBe("git_commit");
    const addCall = calls.find((c) => c.args[0] === "add");
    expect(addCall?.args).toEqual(["add", "--", "newfile.ts"]);
  });

  it("includeUntracked but all sensitive → snapshot (include_untracked_empty), no commit", async () => {
    const { runner, calls } = makeRecordingRunner([
      { args: ["rev-parse", "--is-inside-work-tree"], result: ok("true") },
      {
        args: ["status", "--porcelain=v1", "-b"],
        result: ok("## main\n?? .env\n?? secret-token.txt"),
      },
      { args: ["log", "-1"], result: ok("abc1234\tfeat: prior") },
      { args: ["branch", "--show-current"], result: ok("main") },
    ]);
    const outcome = await createGitStablePoint(
      "/repo",
      { message: "x", includeUntracked: true },
      runner,
    );
    expect(outcome.kind).toBe("snapshot");
    if (outcome.kind === "snapshot") expect(outcome.reason).toBe("include_untracked_empty");
    expect(calls.some((c) => c.args[0] === "commit")).toBe(false);
  });

  it("not a git repo → not_a_git_repo (caller falls back to snapshot)", async () => {
    const { runner } = makeRecordingRunner([
      { args: ["rev-parse", "--is-inside-work-tree"], result: fail("fatal: not a git repository") },
    ]);
    const outcome = await createGitStablePoint("/repo", { message: "x" }, runner);
    expect(outcome.kind).toBe("not_a_git_repo");
  });

  it("git commit fails → fail-closed (kind=failed), reason surfaced", async () => {
    const { runner } = makeRecordingRunner([
      { args: ["rev-parse", "--is-inside-work-tree"], result: ok("true") },
      { args: ["status", "--porcelain=v1", "-b"], result: ok("## main\n M a.ts") },
      { args: ["log", "-1"], result: ok("abc1234\tfeat: prior") },
      { args: ["branch", "--show-current"], result: ok("main") },
      { args: ["rev-parse", "--show-toplevel"], result: ok("/repo") },
      { args: ["add", "--"], result: ok("") },
      { args: ["commit", "-m"], result: fail("nothing to commit, working tree clean") },
    ]);
    const outcome = await createGitStablePoint("/repo", { message: "x" }, runner);
    expect(outcome.kind).toBe("failed");
    if (outcome.kind === "failed") expect(outcome.reason).toContain("nothing to commit");
  });
});

describe("D.14G managed worktree create", () => {
  let repoRoot: string;
  let parent: string;

  beforeEach(async () => {
    parent = await mkdtemp(join(tmpdir(), "linghun-wt-"));
    repoRoot = join(parent, "MyRepo");
  });
  afterEach(async () => {
    await rm(parent, { recursive: true, force: true });
  });

  function createEntries(): Entry[] {
    return [
      { args: ["rev-parse", "--is-inside-work-tree"], result: ok("true") },
      {
        args: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
        result: ok(join(repoRoot, ".git")),
      },
      { args: ["rev-parse", "--show-toplevel"], result: ok(repoRoot) },
      {
        args: ["worktree", "list", "--porcelain"],
        result: ok(`worktree ${repoRoot}\nHEAD abc\nbranch refs/heads/main\n`),
      },
      { args: ["worktree", "add"], result: ok("") },
      { args: ["rev-parse", "--short", "HEAD"], result: ok("abc1234") },
      { args: ["branch", "--show-current"], result: ok("feat") },
    ];
  }

  it("valid name → created via execFile args array; cwd unchanged (no chdir call)", async () => {
    const { runner, calls } = makeRecordingRunner(createEntries());
    const outcome = await createManagedWorktree(repoRoot, { name: "feat" }, runner);
    expect(outcome.kind).toBe("created");
    if (outcome.kind === "created") {
      expect(outcome.path).toBe(managedWorktreePath(repoRoot, "feat"));
      expect(outcome.managedRoot).toBe(resolveManagedWorktreeRoot(repoRoot));
    }
    const addCall = calls.find((c) => c.args[0] === "worktree" && c.args[1] === "add");
    expect(addCall?.args).toEqual([
      "worktree",
      "add",
      managedWorktreePath(repoRoot, "feat"),
      "HEAD",
    ]);
  });

  it("with branch → worktree add -b <branch> <path> <ref> args array", async () => {
    const { runner, calls } = makeRecordingRunner(createEntries());
    const outcome = await createManagedWorktree(
      repoRoot,
      { name: "feat", branch: "wt-feat", fromRef: "origin/main" },
      runner,
    );
    expect(outcome.kind).toBe("created");
    const addCall = calls.find((c) => c.args[0] === "worktree" && c.args[1] === "add");
    expect(addCall?.args).toEqual([
      "worktree",
      "add",
      "-b",
      "wt-feat",
      managedWorktreePath(repoRoot, "feat"),
      "origin/main",
    ]);
  });

  it("invalid name (path escape) → invalid, no git add called", async () => {
    const { runner, calls } = makeRecordingRunner(createEntries());
    const outcome = await createManagedWorktree(repoRoot, { name: "../escape" }, runner);
    expect(outcome.kind).toBe("invalid");
    expect(calls.some((c) => c.args[0] === "worktree" && c.args[1] === "add")).toBe(false);
  });

  it("existing managed worktree → resumed, no second add", async () => {
    const target = managedWorktreePath(repoRoot, "feat");
    const { runner, calls } = makeRecordingRunner([
      { args: ["rev-parse", "--is-inside-work-tree"], result: ok("true") },
      {
        args: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
        result: ok(join(repoRoot, ".git")),
      },
      { args: ["rev-parse", "--show-toplevel"], result: ok(repoRoot) },
      {
        args: ["worktree", "list", "--porcelain"],
        result: ok(
          `worktree ${repoRoot}\nHEAD abc\nbranch refs/heads/main\n\nworktree ${target}\nHEAD def\nbranch refs/heads/wt-feat\n`,
        ),
      },
    ]);
    const outcome = await createManagedWorktree(repoRoot, { name: "feat" }, runner);
    expect(outcome.kind).toBe("resumed");
    expect(calls.some((c) => c.args[0] === "worktree" && c.args[1] === "add")).toBe(false);
  });

  it("git worktree add fails → failed (fail-closed)", async () => {
    const entries = createEntries().map((e) =>
      e.args[0] === "worktree" && e.args[1] === "add"
        ? { args: e.args, result: fail("fatal: already exists") }
        : e,
    );
    const { runner } = makeRecordingRunner(entries);
    const outcome = await createManagedWorktree(repoRoot, { name: "feat" }, runner);
    expect(outcome.kind).toBe("failed");
  });

  it("not a git repo → not_a_git_repo", async () => {
    const { runner } = makeRecordingRunner([
      { args: ["rev-parse", "--is-inside-work-tree"], result: fail("fatal: not a git repository") },
    ]);
    const outcome = await createManagedWorktree(repoRoot, { name: "feat" }, runner);
    expect(outcome.kind).toBe("not_a_git_repo");
  });
});

describe("D.14G managed worktree remove", () => {
  const repoRoot = "/work/MyRepo";
  const managedTarget = managedWorktreePath(repoRoot, "feat");

  function listWith(entryPath: string, dirty: boolean): Entry[] {
    return [
      { args: ["rev-parse", "--is-inside-work-tree"], result: ok("true") },
      {
        args: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
        result: ok(`${repoRoot}/.git`),
      },
      { args: ["rev-parse", "--show-toplevel"], result: ok(repoRoot) },
      {
        args: ["worktree", "list", "--porcelain"],
        result: ok(
          `worktree ${repoRoot}\nHEAD abc\nbranch refs/heads/main\n\nworktree ${entryPath}\nHEAD def\nbranch refs/heads/wt-feat\n`,
        ),
      },
      // status probe runs with cwd = entryPath; key by args only.
      {
        args: ["status", "--porcelain=v1", "-b"],
        result: ok(dirty ? "## wt-feat\n M x.ts" : "## wt-feat"),
      },
      { args: ["log", "-1"], result: ok("def5678\twip") },
      { args: ["branch", "--show-current"], result: ok("wt-feat") },
    ];
  }

  it("clean managed → plan kind=clean (needs confirmation)", async () => {
    const { runner } = makeRecordingRunner(listWith(managedTarget, false));
    const plan = await planManagedWorktreeRemove(repoRoot, { name: "feat" }, runner);
    expect(plan.kind).toBe("clean");
  });

  it("dirty without force → dirty_blocked (refused)", async () => {
    const { runner } = makeRecordingRunner(listWith(managedTarget, true));
    const plan = await planManagedWorktreeRemove(repoRoot, { name: "feat" }, runner);
    expect(plan.kind).toBe("dirty_blocked");
  });

  it("dirty with force → dirty_force (strong confirm)", async () => {
    const { runner } = makeRecordingRunner(listWith(managedTarget, true));
    const plan = await planManagedWorktreeRemove(repoRoot, { name: "feat", force: true }, runner);
    expect(plan.kind).toBe("dirty_force");
  });

  it("external (non-managed) worktree → not_managed, refused", async () => {
    const external = "/some/other/place/feat";
    const { runner } = makeRecordingRunner(listWith(external, false));
    const plan = await planManagedWorktreeRemove(repoRoot, { name: "feat" }, runner);
    expect(plan.kind).toBe("not_managed");
  });

  it("missing worktree → not_found", async () => {
    const { runner } = makeRecordingRunner([
      { args: ["rev-parse", "--is-inside-work-tree"], result: ok("true") },
      {
        args: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
        result: ok(`${repoRoot}/.git`),
      },
      { args: ["rev-parse", "--show-toplevel"], result: ok(repoRoot) },
      {
        args: ["worktree", "list", "--porcelain"],
        result: ok(`worktree ${repoRoot}\nHEAD abc\nbranch refs/heads/main\n`),
      },
    ]);
    const plan = await planManagedWorktreeRemove(repoRoot, { name: "feat" }, runner);
    expect(plan.kind).toBe("not_found");
  });

  it("execute → git worktree remove args array; no branch -D, no rm -rf", async () => {
    const { runner, calls } = makeRecordingRunner([
      { args: ["rev-parse", "--is-inside-work-tree"], result: ok("true") },
      {
        args: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
        result: ok(`${repoRoot}/.git`),
      },
      { args: ["rev-parse", "--show-toplevel"], result: ok(repoRoot) },
      { args: ["worktree", "remove"], result: ok("") },
    ]);
    const result = await executeManagedWorktreeRemove(repoRoot, managedTarget, false, runner);
    expect(result.kind).toBe("removed");
    const removeCall = calls.find((c) => c.args[0] === "worktree" && c.args[1] === "remove");
    expect(removeCall?.args).toEqual(["worktree", "remove", managedTarget]);
    expect(calls.some((c) => c.args[0] === "branch" && c.args[1] === "-D")).toBe(false);
  });

  it("execute force → worktree remove --force args array", async () => {
    const { runner, calls } = makeRecordingRunner([
      { args: ["rev-parse", "--is-inside-work-tree"], result: ok("true") },
      {
        args: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
        result: ok(`${repoRoot}/.git`),
      },
      { args: ["rev-parse", "--show-toplevel"], result: ok(repoRoot) },
      { args: ["worktree", "remove"], result: ok("") },
    ]);
    const result = await executeManagedWorktreeRemove(repoRoot, managedTarget, true, runner);
    expect(result.kind).toBe("removed");
    const removeCall = calls.find((c) => c.args[0] === "worktree" && c.args[1] === "remove");
    expect(removeCall?.args).toEqual(["worktree", "remove", "--force", managedTarget]);
  });

  it("git worktree remove fails → failed (fail-closed)", async () => {
    const { runner } = makeRecordingRunner([
      { args: ["rev-parse", "--is-inside-work-tree"], result: ok("true") },
      {
        args: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
        result: ok(`${repoRoot}/.git`),
      },
      { args: ["rev-parse", "--show-toplevel"], result: ok(repoRoot) },
      { args: ["worktree", "remove"], result: fail("fatal: locked") },
    ]);
    const result = await executeManagedWorktreeRemove(repoRoot, managedTarget, false, runner);
    expect(result.kind).toBe("failed");
  });
});

describe("D.14G worktree context", () => {
  it("non-repo → null", async () => {
    const { runner } = makeRecordingRunner([
      { args: ["rev-parse", "--is-inside-work-tree"], result: fail("fatal: not a git repository") },
    ]);
    expect(await computeWorktreeContext("/x", runner)).toBeNull();
  });

  it("main repo (git-dir == common-dir) → isWorktree false", async () => {
    const { runner } = makeRecordingRunner([
      { args: ["rev-parse", "--is-inside-work-tree"], result: ok("true") },
      { args: ["rev-parse", "--show-toplevel"], result: ok("/work/MyRepo") },
      { args: ["rev-parse", "--absolute-git-dir"], result: ok("/work/MyRepo/.git") },
      {
        args: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
        result: ok("/work/MyRepo/.git"),
      },
      { args: ["branch", "--show-current"], result: ok("main") },
    ]);
    const info = await computeWorktreeContext("/work/MyRepo", runner);
    expect(info?.isWorktree).toBe(false);
    expect(info?.managedName).toBeNull();
  });

  it("managed worktree (git-dir != common-dir, under managed root) → isWorktree + managedName", async () => {
    const target = "/work/.linghun-worktrees/MyRepo/feat";
    const { runner } = makeRecordingRunner([
      { args: ["rev-parse", "--is-inside-work-tree"], result: ok("true") },
      { args: ["rev-parse", "--show-toplevel"], result: ok(target) },
      {
        args: ["rev-parse", "--absolute-git-dir"],
        result: ok("/work/MyRepo/.git/worktrees/feat"),
      },
      {
        args: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
        result: ok("/work/MyRepo/.git"),
      },
      { args: ["branch", "--show-current"], result: ok("wt-feat") },
    ]);
    const info = await computeWorktreeContext(target, runner);
    expect(info?.isWorktree).toBe(true);
    expect(info?.managedName).toBe("feat");
    expect(info?.redactedPath).toBe(".linghun-worktrees/MyRepo/feat");
  });
});
