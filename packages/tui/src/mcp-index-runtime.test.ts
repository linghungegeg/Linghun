import { describe, expect, test } from "vitest";
import { summarizeIndexResult } from "./index-result-presenter.js";

describe("mcp-index-runtime", () => {
  test("summarizeIndexResult handles search_graph results", () => {
    const searchGraphData = {
      total: 2,
      search_mode: "bm25",
      results: [
        {
          name: "OpenAiCompatibleProvider",
          qualified_name: "F-Linghun.packages.providers.src.OpenAiCompatibleProvider",
          label: "Class",
          file_path: "packages/providers/src/index.ts",
          start_line: 630,
          end_line: 812,
          rank: -16.5,
        },
        {
          name: "constructor",
          qualified_name: "F-Linghun.packages.providers.src.OpenAiCompatibleProvider.constructor",
          label: "Method",
          file_path: "packages/providers/src/index.ts",
          start_line: 631,
          end_line: 634,
          rank: -16.91979686818925,
        },
      ],
      has_more: false,
    };

    const summary = summarizeIndexResult("search_graph", searchGraphData);

    expect(summary).toContain("Index search（语义符号搜索，最多 5 条）");
    expect(summary).toContain("total: 2");
    expect(summary).toContain("search_mode: bm25");
    expect(summary).toContain("OpenAiCompatibleProvider");
    expect(summary).toContain("packages/providers/src/index.ts");
    expect(summary).toContain("source: codebase-memory search_graph");
  });

  test("summarizeIndexResult handles empty search_graph results", () => {
    const emptyData = {
      total: 0,
      search_mode: "bm25",
      results: [],
      has_more: false,
    };

    const summary = summarizeIndexResult("search_graph", emptyData);

    expect(summary).toContain("Index search（语义符号搜索，最多 5 条）");
    expect(summary).toContain("total: 0");
    expect(summary).toContain("no matches");
  });

  test("summarizeIndexResult handles get_architecture results", () => {
    const archData = {
      project: "F-Linghun",
      total_nodes: 3725,
      total_edges: 8068,
      node_labels: [
        { label: "Class", count: 100 },
        { label: "Function", count: 500 },
      ],
      edge_types: [
        { type: "CALLS", count: 3000 },
        { type: "IMPORTS", count: 2000 },
      ],
    };

    const summary = summarizeIndexResult("get_architecture", archData);

    expect(summary).toContain("Index architecture（短摘要）");
    expect(summary).toContain("project: F-Linghun");
    expect(summary).toContain("nodes/edges: 3725/8068");
    expect(summary).toContain("Class=100");
    expect(summary).toContain("CALLS=3000");
  });
});
