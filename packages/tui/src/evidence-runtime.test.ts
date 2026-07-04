import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SessionStore } from "@linghun/core";
import { isToolOutputFailure, recordToolEvidence } from "./evidence-runtime.js";
import { readRuntimeLedgerRecords } from "./runtime-storage.js";

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

  it("registers persisted evidence in the runtime ledger", async () => {
    const root = await mkdtemp(join(tmpdir(), "linghun-evidence-ledger-root-"));
    const project = await mkdtemp(join(tmpdir(), "linghun-evidence-ledger-project-"));
    const store = new SessionStore({ sessionRootDir: root, projectPath: project });
    const session = await store.create();
    const sessionDir = dirname(session.transcriptPath);
    const context = {
      evidence: [],
      memory: { sessionDir },
      store,
    } as never;

    const evidence = await recordToolEvidence(
      context,
      session.id,
      "Bash",
      {
        text: "ok",
        fullOutputPath: join(sessionDir, "full-output.log"),
      },
      { command: "echo ok" },
    );

    const ledger = await readRuntimeLedgerRecords(sessionDir);
    const outputPath = join(sessionDir, "full-output.log");
    expect(ledger.records).toMatchObject([
      {
        sessionId: session.id,
        kind: "evidence_recorded",
        evidenceId: evidence?.id,
        evidenceKind: "command_output",
        artifactPath: outputPath,
        source: outputPath,
      },
    ]);
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
