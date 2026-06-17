import { describe, expect, it } from "vitest";
import { recordToolEvidence } from "./evidence-runtime.js";

describe("evidence-runtime", () => {
  it("records read-only tool evidence with low-noise summaries", async () => {
    const events: unknown[] = [];
    const context = {
      evidence: [],
      store: {
        appendEvent: async (_sessionId: string, event: unknown) => {
          events.push(event);
        },
      },
    } as never;

    const evidence = await recordToolEvidence(
      context,
      "session-1",
      "Read",
      {
        text: "line 1\n".repeat(200),
      },
      { path: "src/main.ts" },
    );

    expect(evidence?.summary).toContain("Read: path=src/main.ts");
    expect(evidence?.summary).toContain("output_chars=");
    expect(evidence?.summary).not.toContain("line 1 line 1");
    expect(evidence?.supportsClaims).toContain("readonly_low_noise_evidence");
    expect(events).toHaveLength(1);
  });

  it("records SourcePack and ReadSnippets targets without pass evidence", async () => {
    const events: unknown[] = [];
    const context = {
      evidence: [],
      store: {
        appendEvent: async (_sessionId: string, event: unknown) => {
          events.push(event);
        },
      },
    } as never;

    const sourcePack = await recordToolEvidence(
      context,
      "session-1",
      "SourcePack",
      {
        text: "src/a.ts:1-1\n1\tconst a = 1;",
        data: { candidatePaths: ["src/a.ts"], snippets: [{ path: "src/a.ts" }] },
      },
      { query: "find a" },
    );
    const readSnippets = await recordToolEvidence(
      context,
      "session-1",
      "ReadSnippets",
      { text: "src/b.ts:1-1\n1\tconst b = 1;" },
      { ranges: [{ path: "src/b.ts", start: 1, end: 1 }] },
    );

    expect(sourcePack?.summary).toContain("query=find a");
    expect(sourcePack?.summary).toContain("paths=src/a.ts");
    expect(readSnippets?.summary).toContain("ranges=src/b.ts");
    expect([...(sourcePack?.supportsClaims ?? []), ...(readSnippets?.supportsClaims ?? [])]).not.toEqual(
      expect.arrayContaining(["test_passed", "build_passed"]),
    );
    expect(events).toHaveLength(2);
  });
});
