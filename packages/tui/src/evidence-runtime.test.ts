import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SessionStore } from "@linghun/core";
import { describe, expect, it } from "vitest";
import {
  createEvidenceRecord,
  deriveEvidenceClaimSeeds,
  isToolOutputFailure,
  recordToolEvidence,
  recordToolResultBudgetEvidence,
  recordVerificationEvidence,
  stringifyToolResultContentForBudget,
} from "./evidence-runtime.js";
import { readRuntimeLedgerRecords } from "./runtime-storage.js";

describe("evidence-runtime", () => {
  it("links persisted large-result evidence to its tool use", async () => {
    const events: unknown[] = [];
    const context = {
      evidence: [],
      store: {
        appendEvent: async (_sessionId: string, event: unknown) => {
          events.push(event);
        },
      },
    } as never;

    await recordToolResultBudgetEvidence(context, "session-1", {
      toolUseId: "tool-large",
      originalChars: 20_000,
      replacementChars: 200,
      artifact: {
        id: "artifact-large",
        toolUseId: "tool-large",
        path: "F:/tmp/tool-large.txt",
        relativePath: ".linghun/tool-results/tool-large.txt",
        bytes: 20_000,
        chars: 20_000,
        sha256: "a".repeat(64),
        previewChars: 0,
        preview: "",
        hasMore: true,
      },
      reason: "single_result",
    });

    expect(events).toContainEqual(
      expect.objectContaining({ type: "evidence_record", toolUseId: "tool-large" }),
    );
  });

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
    expect(evidence?.supportsClaims).toContain("file:src/main.ts");
    expect(evidence?.claimSeeds).toBeUndefined();
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
    expect([
      ...(sourcePack?.supportsClaims ?? []),
      ...(readSnippets?.supportsClaims ?? []),
    ]).not.toEqual(expect.arrayContaining(["test_passed", "build_passed"]));
    expect(events).toHaveLength(2);
  });

  it("records file edit and web tool claim seeds on evidence events", async () => {
    const events: unknown[] = [];
    const context = {
      evidence: [],
      store: {
        appendEvent: async (_sessionId: string, event: unknown) => {
          events.push(event);
        },
      },
    } as never;

    const edit = await recordToolEvidence(
      context,
      "session-1",
      "Edit",
      { text: "updated" },
      { path: "src/main.ts" },
    );
    const web = await recordToolEvidence(
      context,
      "session-1",
      "WebSearch",
      { text: "OpenAI pricing https://openai.com/pricing" },
      { query: "OpenAI latest pricing" },
    );

    expect(edit?.supportsClaims).toEqual(
      expect.arrayContaining(["Edit", "file_written", "file:src/main.ts"]),
    );
    expect(edit?.claimSeeds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "file_change_claim", evidenceRefs: [edit?.id] }),
      ]),
    );
    expect(web?.kind).toBe("web_source");
    expect(web?.supportsClaims).toEqual(
      expect.arrayContaining(["web_source", "external_current_fact"]),
    );
    expect(web?.claimSeeds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "external_current_fact", evidenceRefs: [web?.id] }),
      ]),
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "evidence_record", claimSeeds: edit?.claimSeeds }),
        expect.objectContaining({ type: "evidence_record", claimSeeds: web?.claimSeeds }),
      ]),
    );
  });

  it("does not record successful web-source evidence for structured Web failures", async () => {
    const events: unknown[] = [];
    const context = {
      evidence: [],
      store: {
        appendEvent: async (_sessionId: string, event: unknown) => {
          events.push(event);
        },
      },
    } as never;
    const output = {
      text: "WebSearch failed: request timed out",
      data: {
        isError: true,
        error: "request timed out",
        errorCode: "TIMEOUT",
        aborted: false,
        timedOut: true,
      },
    };

    const evidence = await recordToolEvidence(
      context,
      "session-1",
      "WebSearch",
      output,
      { query: "latest facts" },
    );

    expect(isToolOutputFailure("WebSearch", output)).toBe(true);
    expect(evidence).toBeNull();
    expect(events).toEqual([]);
  });

  it("records verification claim seeds only for passed verification evidence", async () => {
    const events: unknown[] = [];
    const context = {
      evidence: [],
      store: {
        appendEvent: async (_sessionId: string, event: unknown) => {
          events.push(event);
        },
      },
      failureLearning: { records: [], maxRecords: 50 },
    } as never;

    await recordVerificationEvidence(context, "session-1", {
      id: "vr-1",
      status: "pass",
      summary: "tests passed",
      commands: [
        {
          kind: "test",
          command: "pnpm test",
          reason: "focused",
          status: "pass",
          durationMs: 10,
          summary: "passed",
        },
        {
          kind: "typecheck",
          command: "pnpm typecheck",
          reason: "focused",
          status: "pass",
          durationMs: 10,
          summary: "passed",
        },
      ],
      unverified: [],
      risk: [],
      startedAt: "2025-01-01T00:00:00.000Z",
      endedAt: "2025-01-01T00:00:01.000Z",
      durationMs: 1000,
      nextAction: "none",
    });

    const evidence = (
      context as { evidence: Array<{ claimSeeds?: unknown[]; supportsClaims: string[] }> }
    ).evidence[0];
    expect(evidence.supportsClaims).toEqual(
      expect.arrayContaining(["verification_passed", "test_passed", "typecheck_passed"]),
    );
    expect(evidence.claimSeeds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "test_claim" }),
        expect.objectContaining({ kind: "verification_claim", phrase: "typecheck passed" }),
        expect.objectContaining({ kind: "completion_pass", phrase: "tests passed" }),
      ]),
    );
    expect(events[0]).toEqual(
      expect.objectContaining({ type: "evidence_record", claimSeeds: evidence.claimSeeds }),
    );
  });

  it("derives terminal workflow, agent, git, and action claim seeds but not failure seeds", () => {
    const workflow = createEvidenceRecord("command_output", "workflow completed", "workflow", [
      "workflow_execution",
      "workflow_terminal_status",
      "action_executed",
    ]);
    const agent = createEvidenceRecord("command_output", "agent completed", "agent", [
      "agent_execution",
      "agent_terminal_status",
    ]);
    const git = createEvidenceRecord("command_output", "stable point created", "git-operation", [
      "git_operation",
      "stable_point_created",
    ]);
    const failed = createEvidenceRecord("command_output", "test failed", "Verification Runner", [
      "tool_failure",
      "test_passed",
    ]);

    expect(workflow.claimSeeds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "workflow_status_claim" }),
        expect.objectContaining({ kind: "action_executed" }),
      ]),
    );
    expect(agent.claimSeeds).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "agent_status_claim" })]),
    );
    expect(git.claimSeeds).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "git_operation" })]),
    );
    expect(failed.claimSeeds).toBeUndefined();
    expect(deriveEvidenceClaimSeeds(failed)).toEqual([]);
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
  it("stringifies large cyclic tool results within a bounded budget", () => {
    const cyclic: { rows: string[]; self?: unknown } = {
      rows: Array.from({ length: 20_000 }, (_, index) => `row-${index}`),
    };
    cyclic.self = cyclic;

    const text = stringifyToolResultContentForBudget(cyclic);

    expect(text).toBeTruthy();
    expect(text?.length).toBeLessThan(60_000);
    expect(text).toContain("[truncated]");
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

  it("uses structured Web failure data instead of output text", () => {
    expect(
      isToolOutputFailure("WebFetch", {
        text: "request failed",
        data: { isError: true, errorCode: "HTTP_ERROR" },
      }),
    ).toBe(true);
    expect(
      isToolOutputFailure("WebSearch", {
        text: "No web search results found",
        data: { isError: false, count: 0 },
      }),
    ).toBe(false);
  });
});
