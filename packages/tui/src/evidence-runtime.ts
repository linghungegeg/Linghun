import { randomUUID } from "node:crypto";
import type { TranscriptEvent } from "@linghun/core";
import type { DiffSummary, TodoItem, ToolName, ToolOutput } from "@linghun/tools";
import type { ArchitectureCard } from "./architecture-runtime.js";
import { summarizeArchitectureCard } from "./architecture-runtime.js";
import type { FailureLearningInput } from "./failure-learning-runtime.js";
import { mergeFailureRecord, writeFailureRecord } from "./failure-learning-runtime.js";
import { writeHandoffPacket } from "./handoff-session-runtime.js";
import { deriveToolSupportsClaims } from "./model-loop-runtime.js";
import { classifyProviderFailure } from "./request-lifecycle-presenter.js";
import {
  LINGHUN_DEFAULT_TOOL_RESULT_CHARS,
  LINGHUN_MAX_TOOL_RESULT_BYTES,
} from "./runtime-budget.js";
import { truncateDisplay } from "./startup-runtime.js";
import { formatToolDiagnosticsSummary } from "./tool-output-presenter.js";
import {
  type ToolResultBudgetRecord,
  type ToolResultBudgetState,
  applyToolResultBudgetToMessages,
  formatToolResultBudgetEvidenceSummary,
  formatToolResultBudgetSystemEvent,
} from "./tool-result-budget.js";
import { MAX_EVIDENCE_RECORDS, type TuiContext } from "./tui-context-runtime.js";
import type {
  BackgroundTaskState,
  EvidenceRecord,
  FailureLearningRecord,
  RoleRouteDecision,
  VerificationReport,
} from "./tui-data-types.js";
import type { SelectedModelRuntime } from "./tui-model-runtime.js";

export const TRANSCRIPT_TOOL_OUTPUT_PREVIEW_CHARS = 2_000;
export const TRANSCRIPT_TOOL_OUTPUT_MAX_CHARS = 8_000;
export const MAX_ROUND_ASSISTANT_CHARS_FOR_PROVIDER = 16_000;
export const ROUND_ASSISTANT_HEAD_CHARS = 4_000;
export const ROUND_ASSISTANT_TAIL_CHARS = 4_000;
const RECENT_DIAGNOSTICS_LIMIT = 20;
type CompactDiagnostic = {
  type: string;
  severity?: string;
  evidence: string;
};

export function createEvidenceRecord(
  kind: EvidenceRecord["kind"],
  summary: string,
  source: string,
  supportsClaims: string[],
): EvidenceRecord {
  return {
    id: randomUUID(),
    kind,
    summary: truncateDisplay(summary.replace(/\s+/g, " "), 180),
    source,
    supportsClaims,
    createdAt: new Date().toISOString(),
  };
}

export function rememberEvidence(context: TuiContext, evidence: EvidenceRecord): void {
  context.evidence.unshift(evidence);
  context.evidence = context.evidence.slice(0, MAX_EVIDENCE_RECORDS);
}

export function pickEvidence(
  evidence: EvidenceRecord,
): Pick<EvidenceRecord, "id" | "kind" | "source" | "summary"> {
  return {
    id: evidence.id,
    kind: evidence.kind,
    source: evidence.source,
    summary: evidence.summary,
  };
}

export function truncateRoundAssistantForProvider(
  text: string,
  context: { language: "zh-CN" | "en-US"; projectPath: string },
): string {
  if (text.length <= MAX_ROUND_ASSISTANT_CHARS_FOR_PROVIDER) return text;
  const head = text.slice(0, ROUND_ASSISTANT_HEAD_CHARS);
  const tail = text.slice(-ROUND_ASSISTANT_TAIL_CHARS);
  const omitted = text.length - ROUND_ASSISTANT_HEAD_CHARS - ROUND_ASSISTANT_TAIL_CHARS;
  const separator =
    context.language === "en-US"
      ? `\n\n[... ${omitted} characters omitted — full output preserved in artifact; use /details or Ctrl+O to inspect ...]\n\n`
      : `\n\n[... 中间省略 ${omitted} 个字符 — 完整输出已保存在 artifact 中；用 /details 或 Ctrl+O 查看 ...]\n\n`;
  return head + separator + tail;
}

export async function recordProviderFailureEvidence(
  context: TuiContext,
  sessionId: string,
  error: unknown,
  runtime: SelectedModelRuntime,
): Promise<EvidenceRecord> {
  const code =
    error instanceof Error && "code" in error && typeof error.code === "string"
      ? error.code
      : "PROVIDER_ERROR";
  const message = error instanceof Error ? error.message : String(error);
  const failureKind = classifyProviderFailure(error);
  const transitFailure = failureKind === "transit";
  const summary = `provider failure: kind ${failureKind}; code ${code}; provider ${runtime.provider}; model ${runtime.model}; endpoint profile ${runtime.endpointProfile}; message ${sanitizeProviderFailureText(message)}`;
  const evidence = createEvidenceRecord(
    "command_output",
    summary,
    `provider:${runtime.provider}:failure`,
    ["provider_failure", code, runtime.provider, runtime.model, runtime.endpointProfile],
  );
  rememberEvidence(context, evidence);
  await context.store.appendEvent(sessionId, {
    type: "evidence_record",
    ...evidence,
  });
  await appendSystemEvent(context, sessionId, summary, "warning");
  context.lastProviderFailure = {
    code,
    kind: failureKind,
    provider: runtime.provider,
    model: runtime.model,
    endpointProfile: runtime.endpointProfile,
    summary: evidence.summary,
    evidenceId: evidence.id,
    createdAt: evidence.createdAt,
  };
  await captureFailureLearning(context, sessionId, {
    category: "provider_failure",
    failureSummary: `provider request failed kind=${failureKind} code=${code} message=${sanitizeProviderFailureText(message)}`,
    rootCauseGuess: transitFailure
      ? `provider/network transit failure with ${code}`
      : `model/provider request failed with ${code}`,
    avoidNextTime: transitFailure
      ? "Retry later; if it repeats, check provider transit/gateway stability with /model doctor. Do not change provider route/env/key/model unless diagnostics point there."
      : code === "PROVIDER_RATE_LIMITED"
        ? "Back off / reduce request rate before retrying provider calls"
        : `Check provider config and request shape for ${code} before retrying; do not assume the request succeeded`,
    sourceRef: `evidence:${evidence.id}`,
    relatedTarget: code,
    severity: "high",
  });
  return evidence;
}

export async function recordModelToolFailureForMetaScheduler(
  context: TuiContext,
  sessionId: string,
  result: {
    ok: boolean;
    tool: string;
    text: string;
    pendingApproval?: boolean;
    evidenceId?: string;
  },
): Promise<void> {
  if (result.ok || result.pendingApproval) return;
  if (isUserDecisionToolStop(result.text)) return;
  await appendSystemEvent(
    context,
    sessionId,
    `meta scheduler tool failure: tool ${result.tool}; evidence ${result.evidenceId ?? "none"}`,
    "warning",
  );
  await captureFailureLearning(context, sessionId, {
    category: "tool_failure",
    failureSummary: `tool failed: ${result.tool}: ${truncateDisplay(result.text, 180)}`,
    rootCauseGuess: `${result.tool} returned a failed result in the model tool loop`,
    avoidNextTime:
      "Do not claim the tool action completed; inspect the failure, retry with corrected inputs, or explicitly degrade.",
    sourceRef: result.evidenceId ? `evidence:${result.evidenceId}` : `tool:${result.tool}`,
    relatedTarget: result.tool,
    severity: "medium",
  });
}

function isUserDecisionToolStop(text: string): boolean {
  return /^(?:ask|denied|deny|rejected|cancelled|canceled|block):/iu.test(text.trim());
}

export function sanitizeProviderFailureError(error: unknown): unknown {
  if (!(error instanceof Error)) {
    return sanitizeProviderFailureText(String(error));
  }
  const sanitized = new Error(sanitizeProviderFailureText(error.message));
  if ("suggestion" in error && typeof error.suggestion === "string") {
    Object.assign(sanitized, { suggestion: error.suggestion });
  }
  return sanitized;
}

export function sanitizeProviderFailureText(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]+/gu, "sk-***")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/giu, "Bearer ***")
    .replace(/api[_-]?key=[^\s&]+/giu, "api_key=***")
    .replace(/[A-Z]:[\\/][^\s]+/gu, "[local-path]")
    .replace(/\/[^\s]*?(?:Linghun|linghun)[^\s]*/gu, "[local-path]");
}

export async function recordToolFailureEvidence(
  context: TuiContext,
  sessionId: string,
  name: ToolName,
  summary: string,
): Promise<EvidenceRecord> {
  const evidence = createEvidenceRecord(
    "command_output",
    `${name} failure: ${truncateDisplay(summary.replace(/\s+/g, " "), 140)}`,
    `tool:${name}:failure`,
    [name, "tool_failure"],
  );
  rememberEvidence(context, evidence);
  await context.store.appendEvent(sessionId, {
    type: "evidence_record",
    ...evidence,
  });
  return evidence;
}

export async function captureFailureLearning(
  context: TuiContext,
  sessionId: string,
  input: FailureLearningInput,
): Promise<void> {
  context.lastMetaSchedulerFailureLearningFulfilled = true;
  if (input.category === "tool_failure") {
    context.lastToolFailure = {
      toolName: input.relatedTarget ?? "unknown",
      summary: input.failureSummary,
    };
  }
  let record: FailureLearningRecord | undefined;
  try {
    ({ record } = mergeFailureRecord(context.failureLearning, input));
    await writeFailureRecord(context.failureLearning, record);
    await appendSystemEvent(
      context,
      sessionId,
      `failure_learning recorded category=${record.category} count=${record.count} severity=${record.severity}`,
      "info",
    );
  } catch {
    await appendSystemEvent(
      context,
      sessionId,
      `failure_learning degraded warning=write_failed category=${record?.category ?? input.category}`,
      "warning",
    ).catch(() => undefined);
  }
}

export async function recordArchitectureRuntimeCard(
  context: TuiContext,
  sessionId: string,
  card: ArchitectureCard,
): Promise<EvidenceRecord> {
  const evidence = createEvidenceRecord(
    "command_output",
    context.language === "en-US"
      ? `Architecture audit recorded: ${card.projectFacts.length} fact(s), ${card.verification.length} verification suggestion(s).`
      : `架构审计已记录：${card.projectFacts.length} 条事实，${card.verification.length} 条验证建议。`,
    "architecture-runtime:v1",
    ["architecture_runtime", "architecture_card", card.target],
  );
  rememberEvidence(context, evidence);
  await context.store.appendEvent(sessionId, {
    type: "evidence_record",
    ...evidence,
  });
  await appendSystemEvent(
    context,
    sessionId,
    `architecture runtime triggered: evidence ${evidence.id}; target ${card.target}`,
    "info",
  );
  if (context.memory.lastHandoff) {
    context.memory.lastHandoff.currentArchitectureCard = summarizeArchitectureCard(card);
    await writeHandoffPacket(context, context.memory.lastHandoff);
  }
  return evidence;
}

export async function recordToolEvidence(
  context: TuiContext,
  sessionId: string,
  name: ToolName,
  output: ToolOutput,
  input?: unknown,
): Promise<EvidenceRecord | null> {
  const kind =
    name === "Read" || name === "ReadSnippets" || name === "SourcePack"
      ? "file_read"
      : name === "Grep" || name === "Glob"
        ? "grep_result"
        : name === "Bash" || name === "Write" || name === "Edit" || name === "MultiEdit"
          ? "command_output"
          : null;
  if (!kind) {
    return null;
  }
  const readOnlyEvidence =
    name === "Read" ||
    name === "ReadSnippets" ||
    name === "SourcePack" ||
    name === "Grep" ||
    name === "Glob";
  const evidence = createEvidenceRecord(
    kind,
    readOnlyEvidence
      ? formatReadOnlyToolEvidenceSummary(name, output, input)
      : `${name}: ${truncateDisplay(output.text.replace(/\s+/g, " "), 120)}`,
    output.fullOutputPath ?? name,
    [
      ...deriveToolSupportsClaims(name, input, output),
      ...(readOnlyEvidence ? ["readonly_low_noise_evidence"] : []),
    ],
  );
  rememberEvidence(context, evidence);
  await context.store.appendEvent(sessionId, {
    type: "evidence_record",
    ...evidence,
  });
  return evidence;
}

function formatReadOnlyToolEvidenceSummary(
  name: ToolName,
  output: ToolOutput,
  input: unknown,
): string {
  const target =
    name === "SourcePack"
      ? sourcePackEvidenceTarget(input, output)
      : name === "ReadSnippets"
        ? readSnippetsEvidenceTarget(input)
        : readToolEvidenceTarget(input);
  const artifact = output.fullOutputPath ? "artifact=yes" : "artifact=no";
  const bytes = output.text.length;
  return `${name}: ${target}; output_chars=${bytes}; ${artifact}`;
}

function sourcePackEvidenceTarget(input: unknown, output: ToolOutput): string {
  const query = readStringField(input, "query");
  const paths = extractOutputCandidatePaths(output.data);
  const pathText = paths.length > 0 ? `; paths=${truncateDisplay(paths.slice(0, 4).join(","), 120)}` : "";
  return `query=${truncateDisplay((query ?? "unspecified").replace(/\s+/g, " "), 90)}${pathText}`;
}

function readSnippetsEvidenceTarget(input: unknown): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "ranges=unspecified";
  const ranges = (input as Record<string, unknown>).ranges;
  if (!Array.isArray(ranges)) return "ranges=unspecified";
  const paths = ranges
    .map((item) =>
      item && typeof item === "object" && typeof (item as { path?: unknown }).path === "string"
        ? (item as { path: string }).path
        : undefined,
    )
    .filter((item): item is string => Boolean(item));
  return paths.length > 0
    ? `ranges=${truncateDisplay(paths.slice(0, 4).join(","), 120)}`
    : "ranges=unspecified";
}

function readStringField(input: unknown, key: string): string | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function extractOutputCandidatePaths(data: unknown): string[] {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const record = data as Record<string, unknown>;
  const candidatePaths = record.candidatePaths;
  if (Array.isArray(candidatePaths)) {
    return candidatePaths.filter((item): item is string => typeof item === "string");
  }
  const snippets = record.snippets;
  if (!Array.isArray(snippets)) return [];
  return snippets
    .map((item) =>
      item && typeof item === "object" && typeof (item as { path?: unknown }).path === "string"
        ? (item as { path: string }).path
        : undefined,
    )
    .filter((item): item is string => Boolean(item));
}

function readToolEvidenceTarget(input: unknown): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "target=unspecified";
  const record = input as Record<string, unknown>;
  for (const key of ["path", "file_path", "pattern", "query"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return `${key}=${truncateDisplay(value.replace(/\s+/g, " "), 90)}`;
    }
  }
  const paths = record.paths;
  if (Array.isArray(paths)) {
    const values = paths.filter((item): item is string => typeof item === "string");
    if (values.length > 0) {
      return `paths=${truncateDisplay(values.slice(0, 3).join(","), 90)}`;
    }
  }
  const ranges = record.ranges;
  if (Array.isArray(ranges)) {
    const values = ranges
      .map((item) =>
        item && typeof item === "object" && typeof (item as { path?: unknown }).path === "string"
          ? (item as { path: string }).path
          : undefined,
      )
      .filter((item): item is string => Boolean(item));
    if (values.length > 0) {
      return `ranges=${truncateDisplay(values.slice(0, 3).join(","), 90)}`;
    }
  }
  return "target=unspecified";
}

export async function recordVerificationEvidence(
  context: TuiContext,
  sessionId: string,
  report: VerificationReport,
): Promise<void> {
  const supportsClaims = deriveVerificationSupportsClaims(report);
  const evidence: EvidenceRecord = {
    id: randomUUID(),
    kind: "test_result",
    summary: `${formatVerificationEvidenceStatusSummary(report)} 日志：${report.logPath ?? "无日志"}`,
    source: report.logPath ?? "Verification Runner",
    supportsClaims,
    createdAt: new Date().toISOString(),
  };
  rememberEvidence(context, evidence);
  await context.store.appendEvent(sessionId, {
    type: "evidence_record",
    ...evidence,
  });
  if (report.status === "fail" || report.status === "partial" || report.status === "timeout") {
    const failedCommand = report.commands.find(
      (c) => c.status === "fail" || c.status === "timeout",
    );
    await captureFailureLearning(context, sessionId, {
      category: "verification_failure",
      failureSummary: `verification ${report.status}: ${report.summary}`,
      rootCauseGuess: failedCommand
        ? `verification command failed (exit ${failedCommand.exitCode ?? "n/a"})`
        : `verification did not reach pass (${report.status})`,
      avoidNextTime:
        "Fix the failing verification command and re-run it; do not claim verified/passed until status=pass",
      sourceRef: `evidence:${evidence.id}`,
      relatedTarget: failedCommand?.kind ?? "verification",
      severity: report.status === "fail" ? "high" : "medium",
    });
  }
}

function deriveVerificationSupportsClaims(report: VerificationReport): string[] {
  if (report.status !== "pass") {
    return ["verification attempted", `verification:${report.status}`, "未通过验证", "需要复核"];
  }
  const hasRealPassedCommand = report.commands.some(
    (command) => command.status === "pass" && command.synthetic !== true,
  );
  const claims = new Set<string>(
    hasRealPassedCommand
      ? ["verification_passed"]
      : ["verification_self_check_passed", "verification_not_run"],
  );
  for (const command of report.commands) {
    if (command.status !== "pass") continue;
    if (command.kind === "test") {
      claims.add("test_passed");
    } else if (command.kind === "typecheck") {
      claims.add("typecheck_passed");
    } else if (command.kind === "build") {
      claims.add("build_passed");
    } else if (command.kind === "lint") {
      claims.add("lint_passed");
    } else if (command.kind === "smoke") {
      claims.add(command.synthetic ? "smoke_ran" : "smoke_passed");
    }
  }
  return [...claims];
}

function formatVerificationEvidenceStatusSummary(report: VerificationReport): string {
  const syntheticOnlyPass =
    report.status === "pass" &&
    report.commands.length > 0 &&
    report.commands.every((command) => command.synthetic === true || command.status !== "pass");
  if (syntheticOnlyPass) {
    return "SELF-CHECK：synthetic self-check 已通过；真实验证未运行，不能作为真实 PASS 证据。";
  }
  const statusLabel = report.status.toUpperCase();
  return new RegExp(`^${statusLabel}(?:\\s|:|：)`, "u").test(report.summary)
    ? report.summary
    : `${statusLabel} ${report.summary}`;
}

export async function recordToolResultBudgetEvidence(
  context: TuiContext,
  sessionId: string,
  record: ToolResultBudgetRecord,
): Promise<string> {
  const existing = context.evidence.find(
    (item) =>
      item.fullOutputPath === record.artifact.path ||
      item.outputPath === record.artifact.path ||
      item.summary.includes(record.artifact.relativePath),
  );
  if (existing) return existing.id;

  const evidence = createEvidenceRecord(
    "command_output",
    formatToolResultBudgetEvidenceSummary(record),
    record.artifact.relativePath,
    ["tool_result_budget", "artifact", `toolUseId:${record.toolUseId}`],
  );
  evidence.fullOutputPath = record.artifact.path;
  evidence.outputPath = record.artifact.path;
  rememberEvidence(context, evidence);
  await context.store.appendEvent(sessionId, {
    type: "evidence_record",
    ...evidence,
  });
  await appendSystemEvent(context, sessionId, formatToolResultBudgetSystemEvent(record), "info");
  return evidence.id;
}

export async function appendBackgroundTaskEvent(
  context: TuiContext,
  sessionId: string,
  task: BackgroundTaskState,
): Promise<void> {
  await context.store.appendEvent(sessionId, {
    type: "background_task_update",
    task,
    createdAt: new Date().toISOString(),
  });
}

export async function appendSystemEvent(
  context: TuiContext,
  sessionId: string,
  message: string,
  level: "info" | "warning",
): Promise<void> {
  await context.store.appendEvent(sessionId, {
    type: "system_event",
    id: randomUUID(),
    level,
    message,
    createdAt: new Date().toISOString(),
  });
}

export async function appendRouteDecisionEvent(
  context: TuiContext,
  sessionId: string,
  decision: RoleRouteDecision,
): Promise<void> {
  await appendSystemEvent(
    context,
    sessionId,
    `Role route decision ${decision.id}: trigger ${decision.triggerReason}; role ${decision.role}; selected ${decision.selectedProvider || "paused"}/${decision.selectedModel || "paused"}; fallback candidates ${decision.fallbackCandidates.join(",") || "none"}; capabilities ${decision.requiredCapabilities.join("+")}; budget ${decision.maxCostCny === undefined ? "unconfigured" : decision.maxCostCny}; fallback used ${decision.fallbackUsed ? "yes" : "no"}; budget stop ${decision.budgetStop ? "yes" : "no"}; stop ${decision.stopConditions.join("|") || "none"}`,
    decision.stopConditions.length > 0 ? "warning" : "info",
  );
}

export function createToolEndEvent(id: string, output: ToolOutput): TranscriptEvent {
  return {
    type: "tool_call_end",
    id,
    output: summarizeToolEndOutputForTranscript(output),
    createdAt: new Date().toISOString(),
  };
}

function summarizeToolEndOutputForTranscript(output: ToolOutput): ToolOutput {
  const diagnostics = formatToolDiagnosticsSummary(output);
  const text = compactToolEndTextForTranscript(
    appendCompactDiagnostics(
      output.summary || output.preview || output.text || "tool call completed",
      diagnostics,
    ),
    output.fullOutputPath,
  );
  return {
    text,
    summary:
      output.summary === undefined
        ? undefined
        : compactToolEndTextForTranscript(output.summary, output.fullOutputPath),
    preview:
      output.preview === undefined
        ? undefined
        : compactToolEndTextForTranscript(output.preview, output.fullOutputPath),
    truncated: output.truncated,
    fullOutputPath: output.fullOutputPath,
    evidenceId: output.evidenceId,
    changedFiles: output.changedFiles,
    data: compactDiagnosticsDataForTranscript(output.data),
  };
}

function appendCompactDiagnostics(text: string, diagnostics: string | undefined): string {
  if (!diagnostics || text.includes("Linghun diagnostics:")) return text;
  return `${diagnostics}\n${text}`;
}

function compactToolEndTextForTranscript(text: string, fullOutputPath?: string): string {
  const bytes = Buffer.byteLength(text, "utf8");
  if (
    text.length <= TRANSCRIPT_TOOL_OUTPUT_MAX_CHARS &&
    bytes <= TRANSCRIPT_TOOL_OUTPUT_MAX_CHARS
  ) {
    return text;
  }
  return [
    text.slice(0, TRANSCRIPT_TOOL_OUTPUT_PREVIEW_CHARS),
    "",
    `<transcript-tool-end-output-truncated originalChars=${text.length} originalBytes=${bytes}${fullOutputPath ? ` fullOutputPath=${fullOutputPath}` : ""}>`,
  ].join("\n");
}

export function compactToolOutputForTranscript(output: ToolOutput): ToolOutput {
  const text = typeof output.text === "string" ? output.text : "";
  const textBytes = Buffer.byteLength(text, "utf8");
  if (
    text.length <= TRANSCRIPT_TOOL_OUTPUT_MAX_CHARS &&
    textBytes <= TRANSCRIPT_TOOL_OUTPUT_MAX_CHARS
  ) {
    const compactedDetails =
      typeof output.details === "string" && output.details.length > TRANSCRIPT_TOOL_OUTPUT_MAX_CHARS
        ? `<transcript-tool-output-details-truncated originalChars=${output.details.length}${output.fullOutputPath ? ` fullOutputPath=${output.fullOutputPath}` : ""}>`
        : output.details;
    return compactedDetails === output.details ? output : { ...output, details: compactedDetails };
  }
  const preview = text.slice(0, TRANSCRIPT_TOOL_OUTPUT_PREVIEW_CHARS);
  return {
    ...output,
    text: [
      preview,
      "",
      `<transcript-tool-output-truncated originalChars=${text.length} originalBytes=${textBytes}${output.fullOutputPath ? ` fullOutputPath=${output.fullOutputPath}` : ""}>`,
    ].join("\n"),
    details:
      typeof output.details === "string" &&
      output.details.length > TRANSCRIPT_TOOL_OUTPUT_PREVIEW_CHARS
        ? `<transcript-tool-output-details-truncated originalChars=${output.details.length}${output.fullOutputPath ? ` fullOutputPath=${output.fullOutputPath}` : ""}>`
        : output.details,
    data: compactToolOutputDataForTranscript(output.data),
    truncated: true,
  };
}

function compactToolOutputDataForTranscript(data: unknown): unknown {
  if (!data || typeof data !== "object") return data;
  const serialized = JSON.stringify(data);
  if (
    serialized.length <= LINGHUN_DEFAULT_TOOL_RESULT_CHARS &&
    Buffer.byteLength(serialized, "utf8") <= LINGHUN_MAX_TOOL_RESULT_BYTES
  ) {
    return data;
  }
  return {
    truncated: true,
    originalChars: serialized.length,
    preview: serialized.slice(0, TRANSCRIPT_TOOL_OUTPUT_PREVIEW_CHARS),
    ...compactDiagnosticsDataForTranscript(data),
  };
}

function compactDiagnosticsDataForTranscript(data: unknown): { diagnostics: CompactDiagnostic[] } | undefined {
  const diagnostics = readDiagnosticsForTranscript(data);
  if (!diagnostics) return undefined;
  return { diagnostics };
}

function readDiagnosticsForTranscript(data: unknown): CompactDiagnostic[] | undefined {
  if (!data || typeof data !== "object") return undefined;
  const diagnostics = (data as { diagnostics?: unknown }).diagnostics;
  if (!Array.isArray(diagnostics) || diagnostics.length === 0) return undefined;
  return diagnostics
    .slice(0, 5)
    .map(compactDiagnosticForTranscript)
    .filter((diagnostic): diagnostic is CompactDiagnostic => Boolean(diagnostic));
}

function compactDiagnosticForTranscript(value: unknown): CompactDiagnostic | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : undefined;
  const severity = typeof record.severity === "string" ? record.severity : undefined;
  const evidence =
    typeof record.evidence === "string"
      ? truncateDisplay(record.evidence.replace(/\s+/g, " "), 160)
      : undefined;
  if (!type || !evidence) return undefined;
  return { type, severity, evidence };
}

export function isToolOutputFailure(name: ToolName, output: ToolOutput): boolean {
  if (name === "Bash") {
    const exitCode = (output.data as { exitCode?: unknown } | undefined)?.exitCode;
    return typeof exitCode === "number" && exitCode !== 0;
  }
  return false;
}

export async function appendDerivedToolEvents(
  context: TuiContext,
  sessionId: string,
  name: ToolName,
  output: ToolOutput,
): Promise<void> {
  if (name === "Todo") {
    await context.store.appendEvent(sessionId, {
      type: "todo_update",
      items: context.tools.todos as TodoItem[],
      createdAt: new Date().toISOString(),
    });
  }
  if (name === "Diff" && isDiffSummary(output.data)) {
    await context.store.appendEvent(sessionId, {
      type: "diff_update",
      summary: output.data,
      createdAt: new Date().toISOString(),
    });
  }
}

function isDiffSummary(value: unknown): value is DiffSummary {
  return typeof value === "object" && value !== null && "changedFiles" in value;
}

export function getToolResultBudgetState(context: TuiContext): ToolResultBudgetState {
  context.toolResultBudgetState ??= { seenIds: new Set(), replacements: new Map() };
  return context.toolResultBudgetState;
}

export async function appendDeferredToolResultEvent(
  context: TuiContext,
  sessionId: string,
  toolUseId: string,
  dispatchName: string,
  content: unknown,
  isError: boolean,
  evidenceId?: string,
): Promise<void> {
  const budgetedContent = await budgetToolResultTranscriptContent(
    context,
    sessionId,
    toolUseId,
    content,
  );
  await context.store.appendEvent(sessionId, {
    type: "tool_result",
    toolUseId,
    toolName: dispatchName as unknown as ToolName,
    content: budgetedContent,
    isError,
    evidenceId,
    createdAt: new Date().toISOString(),
  });
}

export async function appendToolResultEvent(
  context: TuiContext,
  sessionId: string,
  toolUseId: string,
  toolName: ToolName,
  content: unknown,
  isError: boolean,
  evidenceId?: string,
): Promise<void> {
  rememberRecentDiagnostics(context, toolName, content, toolUseId, evidenceId);
  const contentWithDiagnostics = appendToolResultContentDiagnostics(content);
  const budgetedContent = await budgetToolResultTranscriptContent(
    context,
    sessionId,
    toolUseId,
    contentWithDiagnostics,
  );
  await context.store.appendEvent(sessionId, {
    type: "tool_result",
    toolUseId,
    toolName,
    content: budgetedContent,
    isError,
    evidenceId,
    createdAt: new Date().toISOString(),
  });
}

function rememberRecentDiagnostics(
  context: TuiContext,
  source: ToolName,
  content: unknown,
  toolUseId: string,
  evidenceId?: string,
): void {
  const diagnostics = readDiagnosticsForTranscript((content as { data?: unknown } | undefined)?.data);
  if (!diagnostics || diagnostics.length === 0) return;
  const createdAt = new Date().toISOString();
  const entries = diagnostics.map((diagnostic) => ({
    source,
    ...diagnostic,
    createdAt,
    toolUseId,
    evidenceId,
  }));
  // newest-first: consumers can read index 0 as the latest diagnostic.
  context.tools.recentDiagnostics = [
    ...entries,
    ...(context.tools.recentDiagnostics ?? []),
  ].slice(0, RECENT_DIAGNOSTICS_LIMIT);
}

function appendToolResultContentDiagnostics(content: unknown): unknown {
  if (!content || typeof content !== "object") return content;
  const output = content as ToolOutput;
  if (typeof output.text !== "string") return content;
  const diagnostics = formatToolDiagnosticsSummary(output);
  if (!diagnostics) return content;
  const compactDiagnostics = compactDiagnosticsDataForTranscript(output.data);
  return {
    ...output,
    data: compactDiagnostics ? { ...(output.data as object), ...compactDiagnostics } : output.data,
    text: appendCompactDiagnostics(output.text, diagnostics),
  };
}

export async function budgetToolResultTranscriptContent(
  context: TuiContext,
  sessionId: string,
  toolUseId: string,
  content: unknown,
): Promise<unknown> {
  const contentText = stringifyToolResultContentForBudget(content);
  if (!contentText || contentText.startsWith("<persisted-tool-result>")) return content;
  if (
    contentText.length <= LINGHUN_DEFAULT_TOOL_RESULT_CHARS &&
    Buffer.byteLength(contentText, "utf8") <= LINGHUN_MAX_TOOL_RESULT_BYTES
  ) {
    return content;
  }

  const budgeted = await applyToolResultBudgetToMessages(
    [{ role: "tool", tool_call_id: toolUseId, content: contentText }],
    { projectPath: context.projectPath, sessionId },
  );
  for (const record of budgeted.records) {
    await recordToolResultBudgetEvidence(context, sessionId, record);
  }
  const replacement = budgeted.messages[0];
  return replacement?.role === "tool" ? replacement.content : content;
}

function stringifyToolResultContentForBudget(content: unknown): string | null {
  if (typeof content === "string") return content;
  try {
    return JSON.stringify(content);
  } catch {
    return null;
  }
}
