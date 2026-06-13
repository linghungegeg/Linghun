import { describe, expect, it } from "vitest";
import type {
  StablePointOutcome,
  WorktreeCreateOutcome,
  WorktreeRemovePlan,
} from "./git-operation-runtime.js";
import {
  createGitToolDefinitions,
  isGitToolName,
  parseStablePointInput,
  parseWorktreeCreateInput,
  parseWorktreeRemoveInput,
  summarizeStablePointOutcome,
  summarizeWorktreeContextForPrompt,
  summarizeWorktreeCreateOutcome,
  summarizeWorktreeRemovePlan,
} from "./git-tool-runtime.js";

describe("D.14G git tool schema", () => {
  it("createGitToolDefinitions exposes structured Git tools", () => {
    const names = createGitToolDefinitions().map((d) => d.name);
    expect(names).toContain("GitStablePointCreate");
    expect(names).toContain("GitStatusInspect");
    expect(names).toContain("GitRollbackExplain");
    expect(names).toContain("ManagedWorktreeCreate");
    expect(names).toContain("ManagedWorktreeRemove");
    expect(names).toHaveLength(5);
  });

  it("isGitToolName recognizes git tools and rejects others", () => {
    expect(isGitToolName("GitStablePointCreate")).toBe(true);
    expect(isGitToolName("GitRollbackExplain")).toBe(true);
    expect(isGitToolName("ManagedWorktreeRemove")).toBe(true);
    expect(isGitToolName("Read")).toBe(false);
    expect(isGitToolName("SearchExtraTools")).toBe(false);
  });

  it("ManagedWorktreeCreate / ManagedWorktreeRemove require name", () => {
    const defs = createGitToolDefinitions();
    const create = defs.find((d) => d.name === "ManagedWorktreeCreate");
    const remove = defs.find((d) => d.name === "ManagedWorktreeRemove");
    const createSchema = create?.inputSchema as { required?: string[] };
    const removeSchema = remove?.inputSchema as { required?: string[] };
    expect(createSchema.required).toContain("name");
    expect(removeSchema.required).toContain("name");
  });

  it("every git tool schema is a closed object (additionalProperties=false)", () => {
    for (const def of createGitToolDefinitions()) {
      const schema = def.inputSchema as { type?: string; additionalProperties?: boolean };
      expect(schema.type).toBe("object");
      expect(schema.additionalProperties).toBe(false);
      expect(def.description).toBeTruthy();
    }
  });
});

describe("D.14G git tool input parsing is conservative on bad types", () => {
  it("parseStablePointInput drops non-string message / non-boolean includeUntracked", () => {
    expect(parseStablePointInput({ message: 123, includeUntracked: "yes" })).toEqual({
      message: undefined,
      includeUntracked: undefined,
      reason: undefined,
    });
    expect(parseStablePointInput(null)).toEqual({
      message: undefined,
      includeUntracked: undefined,
      reason: undefined,
    });
    expect(parseStablePointInput([1, 2, 3])).toEqual({
      message: undefined,
      includeUntracked: undefined,
      reason: undefined,
    });
    expect(parseStablePointInput({ message: "feat: x", includeUntracked: true })).toEqual({
      message: "feat: x",
      includeUntracked: true,
      reason: undefined,
    });
  });

  it("parseWorktreeCreateInput keeps only string fields", () => {
    expect(parseWorktreeCreateInput({ name: 5, branch: {}, fromRef: [], reason: 1 })).toEqual({
      name: undefined,
      branch: undefined,
      fromRef: undefined,
      reason: undefined,
    });
    expect(parseWorktreeCreateInput({ name: "feat", branch: "wt-feat" })).toEqual({
      name: "feat",
      branch: "wt-feat",
      fromRef: undefined,
      reason: undefined,
    });
  });

  it("parseWorktreeRemoveInput keeps name string and force boolean only", () => {
    expect(parseWorktreeRemoveInput({ name: 1, force: "true" })).toEqual({
      name: undefined,
      force: undefined,
      reason: undefined,
    });
    expect(parseWorktreeRemoveInput({ name: "feat", force: true })).toEqual({
      name: "feat",
      force: true,
      reason: undefined,
    });
  });
});

describe("D.14G stable point summaries do not leak long paths / secrets", () => {
  it("git_commit summary shows sha/subject and redacts rejected sensitive untracked to filename + tag", () => {
    const outcome: StablePointOutcome = {
      kind: "git_commit",
      sha: "abc1234",
      subject: "feat: x",
      branch: "main",
      changedCount: 2,
      includedUntracked: false,
      rejectedUntracked: ["/work/repo/config/secret-key.json", "/work/repo/.env"],
    };
    const zh = summarizeStablePointOutcome(outcome, "zh-CN");
    expect(zh.ok).toBe(true);
    expect(zh.text).toContain("已建立稳定点");
    expect(zh.text).toContain("abc1234");
    // rejected untracked redacted: filename + (sensitive/ignored), no full absolute path.
    expect(zh.text).toContain("(sensitive/ignored)");
    expect(zh.text).not.toContain("/work/repo/config/secret-key.json");
    expect(zh.text).not.toContain("/work/repo/.env");
  });

  it("git_unavailable / failed surface as ok=false without claiming success", () => {
    const unavailable = summarizeStablePointOutcome(
      { kind: "git_unavailable", reason: "lock" },
      "zh-CN",
    );
    expect(unavailable.ok).toBe(false);
    expect(unavailable.text).not.toContain("已建立稳定点");
    const failed = summarizeStablePointOutcome({ kind: "failed", reason: "commit error" }, "zh-CN");
    expect(failed.ok).toBe(false);
    expect(failed.text).not.toContain("已建立稳定点");
  });

  it("clean repo skips without empty commit", () => {
    const skipped = summarizeStablePointOutcome(
      { kind: "skipped", reason: "clean", branch: "main", head: "abc1234" },
      "zh-CN",
    );
    expect(skipped.ok).toBe(true);
    expect(skipped.text).toContain("干净");
  });
});

describe("D.14G worktree create / remove summaries", () => {
  const managedPath = "/work/.linghun-worktrees/MyRepo/feat";

  it("created summary uses redacted managed path, not a long absolute path", () => {
    const outcome: WorktreeCreateOutcome = {
      kind: "created",
      path: managedPath,
      name: "feat",
      branch: "wt-feat",
      fromRef: "HEAD",
      head: "abc1234",
      managedRoot: "/work/.linghun-worktrees/MyRepo",
      createdAt: new Date().toISOString(),
    };
    const zh = summarizeWorktreeCreateOutcome(outcome, "zh-CN");
    expect(zh.ok).toBe(true);
    expect(zh.text).toContain("已创建 worktree");
    expect(zh.text).toContain(".linghun-worktrees/MyRepo/feat");
    expect(zh.text).not.toContain("/work/.linghun-worktrees");
  });

  it("resumed summary says reused without overwriting", () => {
    const outcome: WorktreeCreateOutcome = {
      kind: "resumed",
      path: managedPath,
      name: "feat",
      branch: "wt-feat",
      head: "abc1234",
      managedRoot: "/work/.linghun-worktrees/MyRepo",
    };
    const zh = summarizeWorktreeCreateOutcome(outcome, "zh-CN");
    expect(zh.ok).toBe(true);
    expect(zh.text).toContain("已复用");
  });

  it("invalid create request is ok=false with reason", () => {
    const zh = summarizeWorktreeCreateOutcome(
      { kind: "invalid", reason: "worktree 名称不能包含 / 或 \\。" },
      "zh-CN",
    );
    expect(zh.ok).toBe(false);
    expect(zh.text).toContain("非法");
  });

  it("dirty_force remove plan asks for a strong confirmation", () => {
    const plan: WorktreeRemovePlan = {
      kind: "dirty_force",
      path: managedPath,
      name: "feat",
      branch: "wt-feat",
    };
    const summary = summarizeWorktreeRemovePlan(plan, "zh-CN");
    expect(summary.needsConfirmation).toBe(true);
    expect(summary.strong).toBe(true);
    expect(summary.text).toContain(".linghun-worktrees/MyRepo/feat");
    expect(summary.text).not.toContain("/work/.linghun-worktrees");
  });

  it("not_managed remove plan refuses without confirmation", () => {
    const plan: WorktreeRemovePlan = {
      kind: "not_managed",
      reason: "该 worktree 不在 Linghun 受控目录下（external），不允许通过 Linghun 删除。",
      path: "/some/other/place/ext-wt",
    };
    const summary = summarizeWorktreeRemovePlan(plan, "zh-CN");
    expect(summary.ok).toBe(false);
    expect(summary.needsConfirmation).toBe(false);
    expect(summary.text).toContain("受控目录");
  });

  it("clean remove plan asks for a light confirmation (not strong)", () => {
    const plan: WorktreeRemovePlan = {
      kind: "clean",
      path: managedPath,
      name: "feat",
      branch: "wt-feat",
    };
    const summary = summarizeWorktreeRemovePlan(plan, "zh-CN");
    expect(summary.needsConfirmation).toBe(true);
    expect(summary.strong).toBe(false);
  });
});

describe("D.14G worktree context projection", () => {
  it("returns null projection for null context", () => {
    expect(summarizeWorktreeContextForPrompt(null)).toBeNull();
  });

  it("projects redacted path + note when inside a worktree, no provider leak", () => {
    const projected = summarizeWorktreeContextForPrompt({
      isWorktree: true,
      repoRoot: "/work/MyRepo",
      currentPath: "/work/.linghun-worktrees/MyRepo/feat",
      branch: "wt-feat",
      managedName: "feat",
      managedRoot: "/work/.linghun-worktrees/MyRepo",
      redactedPath: ".linghun-worktrees/MyRepo/feat",
    });
    expect(projected).not.toBeNull();
    expect(projected?.isWorktree).toBe(true);
    expect(projected?.path).toBe(".linghun-worktrees/MyRepo/feat");
    expect(JSON.stringify(projected)).not.toContain("provider");
    expect(JSON.stringify(projected)).not.toContain("baseUrl");
  });
});
