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
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

function readSrc(file: string): string {
  return readFileSync(join(here, file), "utf8");
}

describe("D.14D-R P0-1 permission PermissionPanel invariant", () => {
  const src = readSrc("index.ts");

  it("model-tool permission prompt writeLine is gated behind !isInkSession", () => {
    // The formatModelToolPermissionPrompt writeLine must be reachable only when
    // NOT an ink session; ink mode renders the PermissionPanel instead.
    expect(src).toContain("if (!(context.isInkSession && isAskWithPanel)) {");
    // Guard precedes the writeLine(formatModelToolPermissionPrompt) call.
    const guardIdx = src.indexOf("if (!(context.isInkSession && isAskWithPanel)) {");
    const promptIdx = src.indexOf("formatModelToolPermissionPrompt(toPermissionPromptView(permission)");
    expect(guardIdx).toBeGreaterThan(0);
    expect(promptIdx).toBeGreaterThan(guardIdx);
  });

  it("index ignore-write permission prompt writeLine is gated behind !isInkSession", () => {
    // runIndexIgnoreWritePlan must not bare-writeLine the prompt in ink mode.
    expect(src).toContain('kind: "index_ignore_write", plan }');
    expect(src).toMatch(
      /context\.pendingLocalApproval = \{ kind: "index_ignore_write", plan \};[\s\S]{0,260}if \(!context\.isInkSession\) \{/,
    );
  });

  it("ask paths set pendingLocalApproval as the panel render source", () => {
    expect(src).toContain('kind: "model_tool_use"');
    expect(src).toContain("pendingApproval: true");
  });
});
