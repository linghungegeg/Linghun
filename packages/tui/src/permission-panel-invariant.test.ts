// D.14D-R P0-1 — Permission elevation PermissionPanel invariant.
//
// Locks the discipline that the ink/product shell's permission elevation UI is
// the PermissionPanel (pendingLocalApproval → mapPendingApprovalToPermission →
// view.permission), NOT a bare `writeLine(formatModelToolPermissionPrompt(...))`
// dumped onto the main screen as ordinary assistant/output text.
//
// Plain TUI / non-interactive keeps the textual yes/no fallback (guarded by
// `!context.isInkSession`), so this static check asserts:
//   1. the model-tool permission prompt writeLine is gated behind a non-ink
//      condition (never an unconditional bare writeLine on the ask path);
//   2. the index ignore-write prompt writeLine is likewise gated;
//   3. ask paths set context.pendingLocalApproval (panel render source).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

function readSrc(file: string): string {
  return readFileSync(join(here, file), "utf8");
}

describe("D.14D-R P0-1 permission PermissionPanel invariant", () => {
  const modelToolSrc = readSrc("model-tool-runtime.ts");
  const slashCommandSrc = readSrc("slash-command-runtime.ts");
  const gitDispatchSrc = readSrc("git-tool-dispatch-runtime.ts");

  it("model-tool permission prompt writeLine is gated behind !isInkSession", () => {
    // The formatModelToolPermissionPrompt writeLine must be reachable only when
    // NOT an ink session; ink mode renders the PermissionPanel instead.
    expect(modelToolSrc).toContain("if (!context.isInkSession) {");
    // Guard precedes the writeLine(formatModelToolPermissionPrompt) call in the model-tool path.
    const guardIdx = modelToolSrc.indexOf("if (!context.isInkSession) {");
    expect(guardIdx).toBeGreaterThan(0);
    // Find the next formatModelToolPermissionPrompt after the guard.
    const promptIdx = modelToolSrc.indexOf(
      "formatModelToolPermissionPrompt(toPermissionPromptView(permission)",
      guardIdx,
    );
    expect(promptIdx).toBeGreaterThan(guardIdx);
  });

  it("index ignore-write permission prompt writeLine is gated behind !isInkSession", () => {
    // runIndexIgnoreWritePlan must not bare-writeLine the prompt in ink mode.
    expect(slashCommandSrc).toContain('kind: "index_ignore_write", plan }');
    expect(slashCommandSrc).toMatch(
      /context\.pendingLocalApproval = \{ kind: "index_ignore_write", plan \};[\s\S]{0,260}if \(!context\.isInkSession\) \{/,
    );
  });

  it("ask paths set pendingLocalApproval as the panel render source", () => {
    expect(modelToolSrc).toContain('kind: "model_tool_use"');
    expect(modelToolSrc).toContain("pendingApproval: true");
  });

  it("D.14D-R2: model GitStablePointCreate default ask path sets pendingLocalApproval before performStablePoint", () => {
    const pendingIdx = gitDispatchSrc.indexOf('kind: "git_stable_point"');
    const performIdx = gitDispatchSrc.indexOf("const result = await performStablePoint(");
    expect(pendingIdx).toBeGreaterThan(0);
    expect(performIdx).toBeGreaterThan(pendingIdx);
    expect(gitDispatchSrc).toContain('context.permissionMode === "plan"');
    expect(gitDispatchSrc).toContain('context.permissionMode === "default"');
    expect(gitDispatchSrc).not.toContain('context.permissionMode !== "full-access"');
  });

  it("D.14D-R2 fix: GitStablePointCreate pending writeLine is not duplicated in ink", () => {
    expect(gitDispatchSrc).toMatch(
      /if \(!context\.isInkSession\) \{\s*deps\.writeLine\(output, summaryText\);/s,
    );
  });

  it("D.14D-R2 fix: GitStablePointCreate refuses plan mode without setting git_stable_point pending approval", () => {
    const planIdx = gitDispatchSrc.indexOf('context.permissionMode === "plan"');
    const pendingIdx = gitDispatchSrc.indexOf('kind: "git_stable_point"');
    const notCreatedIdx = gitDispatchSrc.indexOf(
      "stable point was NOT created because Plan mode is read-only.",
    );
    expect(planIdx).toBeGreaterThan(0);
    expect(notCreatedIdx).toBeGreaterThan(planIdx);
    expect(pendingIdx).toBeGreaterThan(planIdx);
  });
});
