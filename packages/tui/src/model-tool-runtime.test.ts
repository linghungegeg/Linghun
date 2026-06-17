import { describe, expect, it } from "vitest";

import { createModelToolDefinitions } from "./model-loop-runtime.js";
import {
  rememberSourcePackCandidatesFromToolData,
  rememberToolFiles,
} from "./model-tool-runtime.js";
import { formatToolOutput } from "./tool-output-presenter.js";
import type { TuiContext } from "./tui-context-runtime.js";

describe("model-tool-runtime ReadSnippets and SourcePack integration", () => {
  it("exposes ReadSnippets and SourcePack in model tool definitions", () => {
    const definitions = createModelToolDefinitions();
    const readSnippets = definitions.find((definition) => definition.name === "ReadSnippets");
    const sourcePack = definitions.find((definition) => definition.name === "SourcePack");

    expect(readSnippets?.description).toContain("Use ReadSnippets");
    expect(sourcePack?.description).toContain("Use SourcePack");
    expect(JSON.stringify(readSnippets?.inputSchema)).toContain("ranges");
    expect(JSON.stringify(sourcePack?.inputSchema)).toContain("query");
  });

  it("keeps ReadSnippets and SourcePack main-screen output free of internal debug wording", () => {
    const readOutput = formatToolOutput(
      "ReadSnippets",
      {
        text: "src/a.ts:1-1\n1\tconst a = 1;",
        data: { count: 1, ranges: [{ path: "src/a.ts", start: 1, end: 1, content: "1\tconst a = 1;" }] },
      },
      "zh-CN",
    );
    const packOutput = formatToolOutput(
      "SourcePack",
      {
        text: "src/a.ts:1-1\nreason: matched \"a\" at line 1; confidence: 0.60\n1\tconst a = 1;",
        data: { count: 1, snippets: [{ path: "src/a.ts", start: 1, end: 1, reason: "matched" }] },
      },
      "zh-CN",
    );

    const combined = `${readOutput}\n${packOutput}`;
    expect(combined).toContain("ReadSnippets");
    expect(combined).toContain("SourcePack");
    expect(combined).not.toMatch(/tool dispatcher|debug|raw evidence|final gate|passEvidence/iu);
    expect(combined).not.toMatch(/预算|字符数|40000|总输出预算|单范围上限/u);
  });

  it("remembers files from ReadSnippets and SourcePack data", () => {
    const context = { recentlyMentionedFiles: ["old.ts"] } as TuiContext;

    rememberToolFiles(
      context,
      "ReadSnippets",
      { ranges: [{ path: "src/from-input.ts", start: 1, end: 2 }] },
      {
        text: "",
        data: {
          ranges: [{ path: "src/from-output.ts", start: 3, end: 4, content: "x" }],
        },
      },
    );
    rememberToolFiles(
      context,
      "SourcePack",
      { query: "needle" },
      {
        text: "",
        data: {
          candidatePaths: ["src/from-pack.ts"],
          snippets: [{ path: "src/from-snippet.ts", start: 1, end: 1, content: "x" }],
        },
      },
    );

    expect(context.recentlyMentionedFiles).toEqual(
      expect.arrayContaining([
        "src/from-input.ts",
        "src/from-output.ts",
        "src/from-pack.ts",
        "old.ts",
      ]),
    );
  });

  it("injects SourcePack candidates from index tool results", () => {
    const context = {
      recentlyMentionedFiles: [],
      tools: {},
    } as unknown as TuiContext;

    rememberSourcePackCandidatesFromToolData(context, "search_graph", {
      results: [
        {
          path: "src/index-hit.ts",
          line: 7,
          symbol: "indexedNeedle",
          score: 0.82,
        },
      ],
    });

    expect(context.tools.sourcePackCandidates).toEqual([
      {
        path: "src/index-hit.ts",
        start: 7,
        end: 31,
        reason: "index candidate: indexedNeedle",
        confidence: 0.82,
      },
    ]);
  });
});
