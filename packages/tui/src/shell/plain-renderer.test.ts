import { describe, expect, it } from "vitest";

import { renderPlainMarkdownLines } from "./plain-renderer.js";

describe("plain markdown renderer", () => {
  it("keeps no-color code fences readable with ASCII boundaries and language title", () => {
    const output = renderPlainMarkdownLines(
      ["# Title", "", "Paragraph", "", "```ts", "const answer = 42;", "```"].join("\n"),
      true,
      { wrapWidth: 40 },
    ).join("\n");

    expect(output).toContain("# Title");
    expect(output).toContain("Paragraph");
    expect(output).toContain("  + ts");
    expect(output).toContain("  | const answer = 42;");
    expect(output).not.toContain("\x1B[");
  });

  it("renders tables wide and falls back to vertical CJK rows on narrow widths", () => {
    const table = [
      "| 名称 | 说明 | 链接 |",
      "| --- | --- | --- |",
      "| 模块 | 包含中文宽字符和 long-token-value | https://example.test/docs |",
    ].join("\n");

    const wide = renderPlainMarkdownLines(table, true, { wrapWidth: 120 }).join("\n");
    expect(wide).toContain("| 名称 |");
    expect(wide).toContain("| ---- |");
    expect(wide).toContain("包含中文宽字符和 long-token-value");
    expect(wide).toContain("https://example.test/docs");

    const narrowLines = renderPlainMarkdownLines(table, true, { wrapWidth: 24 });
    expect(narrowLines).toContain("名称: 模块");
    expect(narrowLines.some((line) => line.startsWith("说明: 包含中文宽字符"))).toBe(true);
    expect(narrowLines.some((line) => line.startsWith("链接: https://example"))).toBe(true);
    expect(narrowLines.some((line) => line.startsWith("| "))).toBe(false);
  });

  it("keeps no-color fallback structure for headings, lists, quotes, links, and inline code", () => {
    const lines = renderPlainMarkdownLines(
      [
        "## Scope",
        "",
        "> keep fallback readable",
        "",
        "- Use `plain-renderer`",
        "- Share [docs](packages/tui/src/shell/plain-renderer.ts)",
      ].join("\n"),
      true,
      { wrapWidth: 80 },
    );

    expect(lines).toEqual([
      "## Scope",
      "",
      "> keep fallback readable",
      "",
      "- Use `plain-renderer`",
      "- Share docs (packages/tui/src/shell/plain-renderer.ts)",
    ]);
    expect(lines.join("\n")).not.toContain("\x1B[");
  });

  it("renders markdown-fenced tables as tables in the plain fallback", () => {
    const output = renderPlainMarkdownLines(
      [
        "```markdown",
        "| Path | State |",
        "| --- | --- |",
        "| plain | readable |",
        "```",
      ].join("\n"),
      true,
      { wrapWidth: 80 },
    ).join("\n");

    expect(output).toContain("| Path");
    expect(output).toContain("| plain");
    expect(output).not.toContain("  + markdown");
    expect(output).not.toContain("  | | Path");
  });
});
