import { describe, expect, it } from "vitest";
import { isToolOutputFailure, recordToolEvidence } from "./evidence-runtime.js";

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

  it("records compact semantic probe tokens for headless semantic service Bash output", async () => {
    const context = {
      evidence: [],
      tools: {
        headlessBench: { enabled: true },
        validationContract: {
          items: [
            {
              kind: "service",
              validation: "semantic",
              semanticTokens: ["sentiment", "confidence", "positive", "negative"],
            },
          ],
        },
      },
      store: {
        appendEvent: async () => undefined,
      },
    } as never;

    const evidence = await recordToolEvidence(
      context,
      "session-1",
      "Bash",
      {
        text: [
          "exit code 0",
          "positive: {'confidence': {'negative': 0.01, 'positive': 0.99}, 'sentiment': 'positive'}",
          "negative: {'confidence': {'negative': 0.98, 'positive': 0.02}, 'sentiment': 'negative'}",
        ].join("\n"),
        data: { exitCode: 0 },
      },
      { command: "python probe.py" },
    );

    expect((evidence?.data as { semanticProbe?: { tokens?: string[] } } | undefined)?.semanticProbe?.tokens).toEqual(
      expect.arrayContaining(["sentiment", "confidence", "positive", "negative"]),
    );
  });

  it("does not record semantic probe tokens from non-probe Bash commands", async () => {
    const context = {
      evidence: [],
      tools: {
        headlessBench: { enabled: true },
        validationContract: {
          items: [
            {
              kind: "service",
              validation: "semantic",
              semanticTokens: ["sentiment", "confidence", "positive", "negative"],
            },
          ],
        },
      },
      store: {
        appendEvent: async () => undefined,
      },
    } as never;

    const evidence = await recordToolEvidence(
      context,
      "session-1",
      "Bash",
      {
        text: "exit code 0\nsource contains sentiment confidence positive negative",
        data: { exitCode: 0 },
      },
      { command: "cat app.py" },
    );

    expect((evidence?.data as { semanticProbe?: unknown } | undefined)?.semanticProbe).toBeUndefined();
  });
});

describe("isToolOutputFailure", () => {
  it("returns false when data.isError === false (grep exit 1 = no matches)", () => {
    const output = {
      text: "exit 1",
      data: { exitCode: 1, isError: false, returnCodeInterpretation: "no matches found" },
    };
    expect(isToolOutputFailure("Bash", output)).toBe(false);
  });

  it("returns true for Bash exit code != 0 without isError field", () => {
    const output = { text: "error", data: { exitCode: 1 } };
    expect(isToolOutputFailure("Bash", output)).toBe(true);
  });

  it("returns false for Bash exit code 0", () => {
    const output = { text: "ok", data: { exitCode: 0 } };
    expect(isToolOutputFailure("Bash", output)).toBe(false);
  });

  it("returns false for non-Bash tools", () => {
    const output = { text: "error", data: { exitCode: 127 } };
    expect(isToolOutputFailure("Read", output)).toBe(false);
  });
});
