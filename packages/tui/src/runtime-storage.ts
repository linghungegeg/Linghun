import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { appendJsonl, readJsonl, type JsonlReadResult } from "@linghun/core";
import type { TuiContext } from "./tui-context-runtime.js";
import type { EvidenceRecord } from "./tui-data-types.js";

export type RuntimeLedgerRecordKind =
  | "evidence_recorded"
  | "handoff_written"
  | "artifact_created"
  | "verification_recorded"
  | "background_updated"
  | "job_updated"
  | "agent_updated"
  | "workflow_updated";

export type RuntimeLedgerRecord = {
  id: string;
  sessionId: string;
  kind: RuntimeLedgerRecordKind;
  createdAt: string;
  evidenceId?: string;
  evidenceKind?: EvidenceRecord["kind"];
  handoffId?: string;
  agentId?: string;
  workflowId?: string;
  jobId?: string;
  backgroundId?: string;
  verificationId?: string;
  status?: string;
  artifactPath?: string;
  source?: string;
  summary?: string;
};

export type RuntimeLedgerInput = Omit<RuntimeLedgerRecord, "id" | "createdAt"> & {
  id?: string;
  createdAt?: string;
};

const RUNTIME_LEDGER_FILE = "runtime-ledger.jsonl";

export function getRuntimeLedgerPath(sessionDir: string): string {
  return join(sessionDir, RUNTIME_LEDGER_FILE);
}

export async function appendRuntimeLedgerRecord(
  sessionDir: string,
  input: RuntimeLedgerInput,
): Promise<RuntimeLedgerRecord> {
  const record: RuntimeLedgerRecord = {
    ...input,
    id: input.id ?? randomUUID(),
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
  await appendJsonl(getRuntimeLedgerPath(sessionDir), record);
  return record;
}

export async function readRuntimeLedgerRecords(
  sessionDir: string,
): Promise<JsonlReadResult<RuntimeLedgerRecord>> {
  return readJsonl<RuntimeLedgerRecord>(getRuntimeLedgerPath(sessionDir));
}

export async function recordEvidenceInRuntimeLedger(
  context: TuiContext,
  sessionId: string,
  evidence: EvidenceRecord,
): Promise<void> {
  const sessionDir = getContextSessionDir(context);
  if (!sessionDir) return;
  await appendRuntimeLedgerRecord(sessionDir, {
    sessionId,
    kind: "evidence_recorded",
    evidenceId: evidence.id,
    evidenceKind: evidence.kind,
    artifactPath: evidence.fullOutputPath ?? evidence.outputPath ?? evidence.logPath ??
      (looksLikeArtifactPath(evidence.source) ? evidence.source : undefined),
    source: evidence.source,
    summary: evidence.summary,
  });
}

export async function recordHandoffInRuntimeLedger(
  context: TuiContext,
  packet: { id?: string; sessionId?: string; summary?: string; goal?: string },
): Promise<void> {
  const sessionDir = getContextSessionDir(context);
  if (!sessionDir || !packet.sessionId) return;
  await appendRuntimeLedgerRecord(sessionDir, {
    sessionId: packet.sessionId,
    kind: "handoff_written",
    handoffId: packet.id,
    artifactPath: join(sessionDir, "handoff-latest.json"),
    summary: packet.summary ?? packet.goal,
  });
}

function getContextSessionDir(context: TuiContext): string | undefined {
  const sessionDir = (context as { memory?: { sessionDir?: unknown } }).memory?.sessionDir;
  return typeof sessionDir === "string" && sessionDir.length > 0 ? sessionDir : undefined;
}

function looksLikeArtifactPath(value: string): boolean {
  return /[\\/]/u.test(value) || /\.[a-z0-9]{1,12}$/iu.test(value);
}
