import { describe, expect, it } from "vitest";

import { tryJsonFormatContent } from "./output-utils.js";

describe("output-utils", () => {
  it("unwraps visible wrapper JSON instead of pretty-printing the raw artifact", () => {
    const output = tryJsonFormatContent('{"text":"\\u001b[31mFAIL\\u001b[39m\\nretry"}');

    expect(output).toBe("FAIL\nretry");
    expect(output).not.toContain('{"text"');
    expect(output).not.toContain("\\u001b");
    expect(output).not.toContain("[31m");
  });

  it("unwraps artifact JSON embedded after a tool-result path", () => {
    const output = tryJsonFormatContent(
      '.linghun/session/tool-results/run/result.txt:{"text":"\\u001b[31mFAIL\\u001b[39m"}',
    );

    expect(output).toContain(".linghun/session/tool-results/run/result.txt:FAIL");
    expect(output).not.toContain('{"text"');
    expect(output).not.toContain("\\u001b");
  });

  it("summarizes test reporter JSON as a compact progress line", () => {
    const output = tryJsonFormatContent(
      '{"numTotalTests":47,"numPassedTests":40,"numFailedTests":1,"numPendingTests":5,"numTodoTests":1,"testResults":[]}',
    );

    expect(output).toBe("Tests [██████████] 47/47 · ✓ 40 · ✗ 1 · ○ 6");
    expect(output).not.toContain("testResults");
  });

  it("keeps reporter-like business JSON on the existing formatting path", () => {
    expect(tryJsonFormatContent('{"numTotalTests":2,"numPassedTests":2,"testResults":"not-an-array"}')).toContain(
      '"testResults": "not-an-array"',
    );
  });

  it("keeps ordinary JSON on the existing formatting path", () => {
    expect(tryJsonFormatContent('{"ok":true,"value":1}')).toBe(
      '{\n  "ok": true,\n  "value": 1\n}',
    );
  });

  it("preserves Markdown tables and fenced code", () => {
    const markdown = [
      "Summary",
      "",
      "| Name | Value |",
      "| --- | --- |",
      "| result | kept |",
      "",
      "```ts",
      "const kept = true;",
      "```",
    ].join("\n");

    expect(tryJsonFormatContent(markdown)).toBe(markdown);
  });
});
