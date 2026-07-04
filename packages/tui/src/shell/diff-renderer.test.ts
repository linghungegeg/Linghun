import { describe, expect, it } from "vitest";

import { renderPlainDiffLines } from "./diff-renderer.js";
import {
  clearDiffSyntaxHighlightCache,
  getDiffSyntaxHighlightCacheStats,
} from "./diff-syntax-highlighter.js";

const ESC = "\x1B";
const ANSI_RE = new RegExp(`${ESC}\\[[0-9;]*m`, "gu");

function stripAnsi(value: string): string {
  return value.replace(ANSI_RE, "");
}

describe("diff-renderer", () => {
  it("adds token-level emphasis for adjacent removed and added lines", () => {
    const rendered = renderPlainDiffLines(["-const label = 'old';", "+const label = 'new';"], {
      noColor: false,
      wrapWidth: 80,
      prefix: "",
    });

    const output = rendered.join("\n");
    expect(stripAnsi(output)).toContain("const label = 'old';");
    expect(stripAnsi(output)).toContain("const label = 'new';");
    expect(output).toContain("\x1B[1m\x1B[31mold\x1B[0m\x1B[0m");
    expect(output).toContain("\x1B[1m\x1B[32mnew\x1B[0m\x1B[0m");
  });

  it("keeps large diff rendering at line-level coloring", () => {
    const lines = Array.from({ length: 90 }, (_, index) =>
      index % 2 === 0 ? `-old value ${index}` : `+new value ${index}`,
    );
    const output = renderPlainDiffLines(lines, {
      noColor: false,
      wrapWidth: 80,
      prefix: "",
    }).join("\n");

    expect(output).toContain("\x1B[31mold value 0\x1B[0m");
    expect(output).toContain("\x1B[32mnew value 1\x1B[0m");
    expect(output).not.toContain("\x1B[1m");
  });

  it("syntax-highlights added and context lines by inferred file extension", () => {
    clearDiffSyntaxHighlightCache();

    const lines = [
      "--- a/src/example.ts",
      "+++ b/src/example.ts",
      "@@ -1,1 +1,2 @@",
      " const keep = true;",
      "+const answer: number = 42;",
    ];
    const output = renderPlainDiffLines(lines, {
      noColor: false,
      wrapWidth: 120,
      prefix: "",
    }).join("\n");

    expect(stripAnsi(output)).toContain("const answer: number = 42;");
    const numberHighlightRe = new RegExp(`${ESC}\\[[0-9;]*mnumber${ESC}\\[0m`, "u");
    expect(output).toMatch(numberHighlightRe);
    expect(getDiffSyntaxHighlightCacheStats()).toMatchObject({ size: 1, hits: 0, misses: 1 });

    renderPlainDiffLines(lines, {
      noColor: false,
      wrapWidth: 120,
      prefix: "",
    });
    expect(getDiffSyntaxHighlightCacheStats()).toMatchObject({ size: 1, hits: 1, misses: 1 });
  });

  it("falls back to line-level diff coloring for unknown extensions and no-color mode", () => {
    clearDiffSyntaxHighlightCache();

    const unknownOutput = renderPlainDiffLines(
      ["--- a/file.unknown", "+++ b/file.unknown", "@@ -1,0 +1,1 @@", "+const value = 1;"],
      {
        noColor: false,
        wrapWidth: 120,
        prefix: "",
      },
    ).join("\n");
    expect(unknownOutput).toContain("\x1B[32mconst value = 1;\x1B[0m");
    expect(getDiffSyntaxHighlightCacheStats()).toMatchObject({ size: 0, hits: 0, misses: 0 });

    const noColorOutput = renderPlainDiffLines(
      ["--- a/file.ts", "+++ b/file.ts", "@@ -1,0 +1,1 @@", "+const value: number = 1;"],
      {
        noColor: true,
        wrapWidth: 120,
        prefix: "",
      },
    ).join("\n");
    expect(noColorOutput).toContain("const value: number = 1;");
    expect(noColorOutput).not.toContain("\x1B[");
  });
});
