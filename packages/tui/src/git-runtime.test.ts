import { describe, expect, it } from "vitest";
import {
  formatGitStatusDetails,
  type GitRunResult,
  type GitRunner,
  isGitRepository,
  readGitStatus,
  readWorktreeList,
  suggestStablePoint,
  type GitStatus,
  type WorktreeReport,
} from "./git-runtime.js";

/**
 * Build a deterministic GitRunner that returns scripted results for given
 * argv prefixes. First match wins; missing keys fall back to a generic
 * "unknown command" failure (so tests catch unexpected new git calls).
 */
function makeRunner(
  table: Array<{ args: string[]; result: GitRunResult }>,
): GitRunner {
  return async (_cwd, args) => {
    for (const entry of table) {
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
    return { ok: false, stdout: "", stderr: `runner has no scripted entry for: git ${args.join(" ")}` };
  };
}

const okStdout = (stdout: string): GitRunResult => ({ ok: true, stdout, stderr: "" });
const failStderr = (stderr: string): GitRunResult => ({ ok: false, stdout: "", stderr });

describe("D.13R Git / Worktree / Stable Point — suggestStablePoint", () => {
  const okClean: GitStatus = {
    kind: "ok",
    branch: "main",
    headShort: "abc1234",
    headSubject: "feat: x",
    changedCount: 0,
    untrackedCount: 0,
    staged: [],
    unstaged: [],
    untracked: [],
    ahead: 0,
    behind: 0,
    upstream: "origin/main",
  };

  it("not_a_git_repo: 不推荐稳定点，给出说明", () => {
    const hint = suggestStablePoint({ kind: "not_a_git_repo" });
    expect(hint.recommended).toBe(false);
    expect(hint.reason).toContain("git");
  });

  it("git_unavailable: 不推荐，reason 含错误信息", () => {
    const hint = suggestStablePoint({
      kind: "git_unavailable",
      error: "ENOENT git",
    });
    expect(hint.recommended).toBe(false);
    expect(hint.reason).toContain("ENOENT");
  });

  it("clean tree: 不推荐稳定点", () => {
    const hint = suggestStablePoint(okClean);
    expect(hint.recommended).toBe(false);
    expect(hint.suggestedSubject).toBe("");
  });

  it("only untracked: 不推荐，提示先 review 未跟踪", () => {
    const status: GitStatus = {
      ...okClean,
      untrackedCount: 2,
      untracked: ["a.ts", "b.ts"],
    };
    const hint = suggestStablePoint(status);
    expect(hint.recommended).toBe(false);
    expect(hint.reason).toContain("未跟踪");
  });

  it("dirty tree: 推荐稳定点，subject 含文件数", () => {
    const status: GitStatus = {
      ...okClean,
      changedCount: 3,
      staged: ["src/a.ts"],
      unstaged: ["src/b.ts", "src/c.ts"],
    };
    const hint = suggestStablePoint(status);
    expect(hint.recommended).toBe(true);
    expect(hint.suggestedSubject).toContain("3 file");
    expect(hint.changedCount).toBe(3);
  });
});

describe("D.13R Git — formatGitStatusDetails", () => {
  it("not_a_git_repo: 返回明确说明", () => {
    const out = formatGitStatusDetails(
      { kind: "not_a_git_repo" },
      { kind: "not_a_git_repo" },
    );
    expect(out).toContain("Not a git repository");
  });

  it("ok 状态: 含 branch / HEAD / changed 行", () => {
    const status: GitStatus = {
      kind: "ok",
      branch: "feature-x",
      headShort: "deadbee",
      headSubject: "wip: y",
      changedCount: 1,
      untrackedCount: 1,
      staged: ["a.ts"],
      unstaged: [],
      untracked: ["new.ts"],
      ahead: 1,
      behind: 0,
      upstream: "origin/feature-x",
    };
    const out = formatGitStatusDetails(status, { kind: "ok", entries: [] });
    expect(out).toContain("branch: feature-x");
    expect(out).toContain("HEAD: deadbee");
    expect(out).toContain("changed: 1");
    expect(out).toContain("a.ts");
    expect(out).toContain("new.ts");
  });

  it("worktree 列表: 当前 worktree 用 * 标记", () => {
    const status: GitStatus = {
      kind: "ok",
      branch: "main",
      headShort: "abc",
      headSubject: "x",
      changedCount: 0,
      untrackedCount: 0,
      staged: [],
      unstaged: [],
      untracked: [],
      ahead: 0,
      behind: 0,
      upstream: null,
    };
    const wt: WorktreeReport = {
      kind: "ok",
      entries: [
        { path: "/repo", branch: "main", head: "abc1234", isCurrent: true, bare: false, detached: false },
        { path: "/repo/.claude/worktrees/feat", branch: "feat", head: "def5678", isCurrent: false, bare: false, detached: false },
      ],
    };
    const out = formatGitStatusDetails(status, wt);
    expect(out).toContain("worktrees:");
    expect(out).toContain("* /repo");
    expect(out).toContain("  /repo/.claude/worktrees/feat");
  });
});

// ─── D.13R Git Readiness 复核：fail-closed ───────────────────────────────────

describe("D.13R Git — readGitStatus fail-closed 路径", () => {
  it("repoCheck 明确 'not a git repository' → not_a_git_repo", async () => {
    const runner = makeRunner([
      {
        args: ["rev-parse", "--is-inside-work-tree"],
        result: failStderr("fatal: not a git repository (or any of the parent directories): .git"),
      },
    ]);
    const result = await readGitStatus("/tmp/empty", runner);
    expect(result.kind).toBe("not_a_git_repo");
  });

  it("repoCheck 失败但 stderr 不含 'not a git repository' → git_unavailable（不伪装成 not_a_git_repo）", async () => {
    const runner = makeRunner([
      {
        args: ["rev-parse", "--is-inside-work-tree"],
        result: failStderr(""),
      },
    ]);
    const result = await readGitStatus("/tmp/missing-binary", runner);
    expect(result.kind).toBe("git_unavailable");
  });

  it("repoCheck timeout / lock 错误 → git_unavailable", async () => {
    const runner = makeRunner([
      {
        args: ["rev-parse", "--is-inside-work-tree"],
        result: failStderr("fatal: Unable to create '/repo/.git/index.lock': File exists"),
      },
    ]);
    const result = await readGitStatus("/repo", runner);
    expect(result.kind).toBe("git_unavailable");
    if (result.kind === "git_unavailable") {
      expect(result.error).toContain("index.lock");
    }
  });

  it("rev-parse 异常 stdout（非 'true'） → git_unavailable，不伪装成 not_a_git_repo", async () => {
    const runner = makeRunner([
      {
        args: ["rev-parse", "--is-inside-work-tree"],
        result: okStdout("garbled output not true"),
      },
    ]);
    const result = await readGitStatus("/repo", runner);
    expect(result.kind).toBe("git_unavailable");
  });

  it("status --porcelain 失败 → git_unavailable（不返回 ok/clean）", async () => {
    const runner = makeRunner([
      {
        args: ["rev-parse", "--is-inside-work-tree"],
        result: okStdout("true"),
      },
      {
        args: ["status", "--porcelain=v1", "-b"],
        result: failStderr("fatal: corrupted .git/HEAD"),
      },
      { args: ["log"], result: okStdout("abc1234\twip") },
      { args: ["branch", "--show-current"], result: okStdout("main") },
    ]);
    const result = await readGitStatus("/repo", runner);
    // 关键断言：status 命令失败时绝不能返回 kind="ok" / changedCount=0。
    expect(result.kind).toBe("git_unavailable");
    if (result.kind === "git_unavailable") {
      expect(result.error).toContain("corrupted");
    }
  });

  it("status 成功 + 多文件改动 → ok 块，changedCount 正确", async () => {
    const porcelain = [
      "## main...origin/main [ahead 1]",
      "M  src/a.ts",
      " M src/b.ts",
      "?? new.ts",
    ].join("\n");
    const runner = makeRunner([
      {
        args: ["rev-parse", "--is-inside-work-tree"],
        result: okStdout("true"),
      },
      {
        args: ["status", "--porcelain=v1", "-b"],
        result: okStdout(porcelain),
      },
      { args: ["log"], result: okStdout("deadbee\tfix: y") },
      { args: ["branch", "--show-current"], result: okStdout("main") },
    ]);
    const result = await readGitStatus("/repo", runner);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.branch).toBe("main");
      expect(result.upstream).toBe("origin/main");
      expect(result.ahead).toBe(1);
      expect(result.changedCount).toBe(2);
      expect(result.untrackedCount).toBe(1);
      expect(result.staged).toContain("src/a.ts");
      expect(result.unstaged).toContain("src/b.ts");
      expect(result.untracked).toContain("new.ts");
    }
  });
});

describe("D.13R Git — readWorktreeList fail-closed 路径", () => {
  it("repoCheck 明确 'not a git repository' → not_a_git_repo", async () => {
    const runner = makeRunner([
      {
        args: ["rev-parse", "--is-inside-work-tree"],
        result: failStderr("fatal: not a git repository (or any of the parent directories): .git"),
      },
    ]);
    const result = await readWorktreeList("/tmp/empty", runner);
    expect(result.kind).toBe("not_a_git_repo");
  });

  it("repoCheck 失败但 stderr 非 'not a git repository' → git_unavailable（不伪装）", async () => {
    const runner = makeRunner([
      {
        args: ["rev-parse", "--is-inside-work-tree"],
        result: failStderr("fatal: bad object HEAD"),
      },
    ]);
    const result = await readWorktreeList("/repo", runner);
    expect(result.kind).toBe("git_unavailable");
    if (result.kind === "git_unavailable") {
      expect(result.error).toContain("bad object");
    }
  });

  it("rev-parse 异常 stdout → git_unavailable，不伪装成 not_a_git_repo", async () => {
    const runner = makeRunner([
      {
        args: ["rev-parse", "--is-inside-work-tree"],
        result: okStdout("not-true-marker"),
      },
    ]);
    const result = await readWorktreeList("/repo", runner);
    expect(result.kind).toBe("git_unavailable");
  });

  it("worktree list 自身失败 → git_unavailable（不降级为空列表）", async () => {
    const runner = makeRunner([
      {
        args: ["rev-parse", "--is-inside-work-tree"],
        result: okStdout("true"),
      },
      {
        args: ["rev-parse", "--show-toplevel"],
        result: okStdout("/repo"),
      },
      {
        args: ["worktree", "list", "--porcelain"],
        result: failStderr("fatal: cannot read worktree list"),
      },
    ]);
    const result = await readWorktreeList("/repo", runner);
    expect(result.kind).toBe("git_unavailable");
    if (result.kind === "git_unavailable") {
      expect(result.error).toContain("cannot read");
    }
  });

  it("worktree list 成功 → ok 列表，含当前标记", async () => {
    const list = [
      "worktree /repo",
      "HEAD abc1234",
      "branch refs/heads/main",
      "",
      "worktree /repo/.claude/worktrees/feat",
      "HEAD def5678",
      "branch refs/heads/feat",
      "",
    ].join("\n");
    const runner = makeRunner([
      {
        args: ["rev-parse", "--is-inside-work-tree"],
        result: okStdout("true"),
      },
      {
        args: ["rev-parse", "--show-toplevel"],
        result: okStdout("/repo"),
      },
      {
        args: ["worktree", "list", "--porcelain"],
        result: okStdout(list),
      },
    ]);
    const result = await readWorktreeList("/repo", runner);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.entries).toHaveLength(2);
      expect(result.entries[0]?.isCurrent).toBe(true);
      expect(result.entries[0]?.branch).toBe("main");
      expect(result.entries[1]?.isCurrent).toBe(false);
      expect(result.entries[1]?.branch).toBe("feat");
    }
  });
});

describe("D.13R Git — isGitRepository", () => {
  it("rev-parse 'true' → true", async () => {
    const runner = makeRunner([
      { args: ["rev-parse", "--is-inside-work-tree"], result: okStdout("true") },
    ]);
    expect(await isGitRepository("/repo", runner)).toBe(true);
  });
  it("rev-parse 失败 → false", async () => {
    const runner = makeRunner([
      { args: ["rev-parse", "--is-inside-work-tree"], result: failStderr("fatal: not a git repository") },
    ]);
    expect(await isGitRepository("/tmp", runner)).toBe(false);
  });
});
