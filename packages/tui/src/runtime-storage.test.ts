import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { handleDetailsCommand } from "./details-status-runtime.js";
import {
  appendRuntimeLedgerRecord,
  readRuntimeLedgerRecords,
  recordHandoffInRuntimeLedger,
} from "./runtime-storage.js";
import { writeHandoffPacket } from "./handoff-session-runtime.js";

class MemoryOutput extends Writable {
  text = "";

  override _write(chunk: unknown, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.text += String(chunk);
    callback();
  }
}

describe("runtime-storage ledger", () => {
  it("appends and reads lightweight session ownership records", async () => {
    const sessionDir = await mkdtemp(join(tmpdir(), "linghun-runtime-ledger-"));

    await appendRuntimeLedgerRecord(sessionDir, {
      sessionId: "session-1",
      kind: "evidence_recorded",
      evidenceId: "evidence-1",
      evidenceKind: "test_result",
      artifactPath: "logs/verify.log",
      summary: "focused verification passed",
    });

    const result = await readRuntimeLedgerRecords(sessionDir);
    expect(result.diagnostics).toEqual([]);
    expect(result.records).toMatchObject([
      {
        sessionId: "session-1",
        kind: "evidence_recorded",
        evidenceId: "evidence-1",
        artifactPath: "logs/verify.log",
      },
    ]);
    expect(result.records[0]?.id).toBeTruthy();
    expect(result.records[0]?.createdAt).toBeTruthy();
  });

  it("skips malformed ledger lines with diagnostics", async () => {
    const sessionDir = await mkdtemp(join(tmpdir(), "linghun-runtime-ledger-bad-"));
    await appendRuntimeLedgerRecord(sessionDir, {
      sessionId: "session-1",
      kind: "evidence_recorded",
      evidenceId: "evidence-1",
    });
    await writeFile(
      join(sessionDir, "runtime-ledger.jsonl"),
      '{"kind":"evidence_recorded","sessionId":"session-1"}\nnot-json\n',
      "utf8",
    );

    const result = await readRuntimeLedgerRecords(sessionDir);
    expect(result.records).toHaveLength(1);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("records handoff snapshots without moving the existing handoff file", async () => {
    const sessionDir = await mkdtemp(join(tmpdir(), "linghun-runtime-ledger-handoff-"));
    const context = { memory: { sessionDir } } as never;

    await writeHandoffPacket(context, {
      id: "handoff-1",
      sessionId: "session-1",
      goal: "continue current task",
    } as never);

    const handoff = await readFile(join(sessionDir, "handoff-latest.json"), "utf8");
    const ledger = await readRuntimeLedgerRecords(sessionDir);
    expect(handoff).toContain("handoff-1");
    expect(ledger.records).toMatchObject([
      {
        sessionId: "session-1",
        kind: "handoff_written",
        handoffId: "handoff-1",
      },
    ]);
  });

  it("does not register handoff records without a session owner", async () => {
    const sessionDir = await mkdtemp(join(tmpdir(), "linghun-runtime-ledger-no-session-"));
    await recordHandoffInRuntimeLedger({ memory: { sessionDir } } as never, {
      id: "handoff-1",
    });

    const ledger = await readRuntimeLedgerRecords(sessionDir);
    expect(ledger.records).toEqual([]);
  });

  it("shows current session ledger records through details", async () => {
    const sessionDir = await mkdtemp(join(tmpdir(), "linghun-runtime-ledger-details-"));
    await appendRuntimeLedgerRecord(sessionDir, {
      sessionId: "session-1",
      kind: "workflow_updated",
      workflowId: "workflow-1",
      status: "partial",
      summary: "workflow partial",
    });
    const output = new MemoryOutput();

    await handleDetailsCommand(
      ["ledger"],
      { memory: { sessionDir }, language: "zh-CN" } as never,
      output,
    );

    expect(output.text).toContain("运行时账本");
    expect(output.text).toContain("workflow_updated=1");
    expect(output.text).toContain("workflow=workflow-1");
  });
});
