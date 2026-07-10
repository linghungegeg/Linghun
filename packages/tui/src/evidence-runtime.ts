import { randomUUID } from "node:crypto";
import type { TranscriptEvent } from "@linghun/core";
import type { DiffSummary, TodoItem, ToolName, ToolOutput } from "@linghun/tools";
import type { ArchitectureCard } from "./architecture-runtime.js";
import { summarizeArchitectureCard } from "./architecture-runtime.js";
import { stringifyValueWithinBudget } from "./context-estimator.js";
import type { FailureLearningInput } from "./failure-learning-runtime.js";
import { mergeFailureRecord, writeFailureRecord } from "./failure-learning-runtime.js";
import { writeHandoffPacket } from "./handoff-session-runtime.js";
import { deriveToolSupportsClaims } from "./model-loop-runtime.js";
import { classifyProviderFailure } from "./request-lifecycle-presenter.js";
import { LINGHUN_DEFAULT_TOOL_RESULT_CHARS } from "./runtime-budget.js";
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
  EvidenceClaimSeed,
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
const MODEL_HISTORY_EDIT_DATA_KEYS = [
  "operation",
  "editCount",
  "addedLines",
  "removedLines",
  "changedFiles",
  "readGuard",
  "newlineBefore",
  "newlineAfter",
] as const;
type CompactDiagnostic = {
  type: string;
  severity?: string;
  evidence: string;
  target?: string;
  path?: string;
  targetHost?: string;
  targetPort?: number;
};

export function createEvidenceRecord(
  kind: EvidenceRecord["kind"],
  summary: string,
  source: string,
  supportsClaims: string[],
): EvidenceRecord {
  const evidence: EvidenceRecord = {
    id: randomUUID(),
    kind,
    summary: truncateDisplay(summary.replace(/\s+/g, " "), 180),
    source,
    supportsClaims,
    createdAt: new Date().toISOString(),
  };
  const claimSeeds = deriveEvidenceClaimSeeds(evidence);
  if (claimSeeds.length > 0) {
    evidence.claimSeeds = claimSeeds;
  }
  return evidence;
}

export function deriveEvidenceClaimSeeds(evidence: EvidenceRecord): EvidenceClaimSeed[] {
  if (evidence.supportsClaims.includes("tool_failure")) return [];
  if (evidence.supportsClaims.includes("bash_exit_nonzero")) return [];
  const seeds: EvidenceClaimSeed[] = [];
  const add = (kind: string, phrase: string, evidenceRequired: string[]): void => {
    if (seeds.some((seed) => seed.kind === kind && seed.phrase === phrase)) return;
    seeds.push({
      kind,
      phrase,
      evidenceRequired,
      evidenceRefs: [evidence.id],
      confidence: "explicit",
      source: evidence.kind === "user_provided" ? "runtime" : "tool",
    });
  };
  if (evidence.supportsClaims.includes("test_passed")) {
    add("test_claim", "tests passed", ["test_result"]);
    add("completion_pass", "tests passed", ["test_result"]);
  }
  if (evidence.supportsClaims.includes("typecheck_passed")) {
    add("verification_claim", "typecheck passed", ["test_result"]);
    add("completion_pass", "typecheck passed", ["test_result"]);
  }
  if (evidence.supportsClaims.includes("build_passed")) {
    add("verification_claim", "build passed", ["test_result"]);
    add("completion_pass", "build passed", ["test_result"]);
  }
  if (evidence.supportsClaims.includes("lint_passed")) {
    add("verification_claim", "lint passed", ["test_result"]);
  }
  if (
    evidence.supportsClaims.includes("verification_passed") ||
    evidence.supportsClaims.includes("smoke_passed")
  ) {
    add("verification_claim", "verification passed", ["test_result"]);
  }
  if (
    evidence.supportsClaims.includes("file_written") ||
    evidence.supportsClaims.includes("Write") ||
    evidence.supportsClaims.includes("Edit") ||
    evidence.supportsClaims.includes("MultiEdit")
  ) {
    add("file_change_claim", "files changed", ["command_output"]);
  }
  if (evidence.supportsClaims.includes("workflow_terminal_status")) {
    add("workflow_status_claim", "workflow completed", ["command_output"]);
  }
  if (evidence.supportsClaims.includes("agent_terminal_status")) {
    add("agent_status_claim", "agent completed", ["command_output"]);
  }
  if (evidence.supportsClaims.includes("git_operation")) {
    add("git_operation", "git operation completed", ["command_output"]);
  }
  if (evidence.kind === "web_source" || evidence.supportsClaims.includes("web_source")) {
    add("external_current_fact", "external current fact checked", ["web_source"]);
  }
  if (evidence.supportsClaims.includes("action_executed")) {
    add("action_executed", "action executed", ["command_output"]);
  }
  return seeds;
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
  const code = readProviderFailureString(error, "code") ?? "PROVIDER_ERROR";
  const message = error instanceof Error ? error.message : String(error);
  const failureKind = classifyProviderFailure(error);
  const transitFailure = failureKind === "transit";
  const endpointSummary = summarizeProviderEndpoint(error, message);
  const httpStatus =
    readProviderFailureNumber(error, "status") ?? readProviderFailureNumber(error, "statusCode");
  const contentType = summarizeProviderContentType(error, message);
  const diagnosticParts = [
    `provider failure: kind ${failureKind}`,
    `code ${code}`,
    `provider ${runtime.provider}`,
    `model ${runtime.model}`,
    `endpointProfile ${runtime.endpointProfile}`,
    `status ${httpStatus ?? "unknown"}`,
    `content-type ${contentType}`,
    `endpoint ${endpointSummary}`,
    `message ${sanitizeProviderFailureText(message)}`,
  ];
  const summary = diagnosticParts.join("; ");
  const evidence = createEvidenceRecord(
    "command_output",
    summary,
    `provider:${runtime.provider}:failure`,
    [
      "provider_failure",
      code,
      failureKind,
      runtime.provider,
      runtime.model,
      runtime.endpointProfile,
    ],
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
    endpointSummary,
    httpStatus,
    contentType,
    summary: evidence.summary,
    evidenceId: evidence.id,
    createdAt: evidence.createdAt,
  };
  await captureFailureLearning(context, sessionId, {
    category: "provider_failure",
    failureSummary: `provider request failed kind=${failureKind} code=${code} endpoint=${endpointSummary} status=${httpStatus ?? "unknown"} content-type=${contentType} message=${sanitizeProviderFailureText(message)}`,
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

function readProviderFailureString(error: unknown, key: string): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function readProviderFailureNumber(error: unknown, key: string): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "number" ? value : undefined;
}

function summarizeProviderEndpoint(error: unknown, message: string): string {
  const direct =
    readProviderFailureString(error, "endpoint") ??
    readProviderFailureString(error, "baseUrl") ??
    readProviderFailureString(error, "baseURL") ??
    readProviderFailureString(error, "url");
  const fromMessage = /\b(?:endpoint|baseUrl|base_url|url)=([^，,\s]+)/iu.exec(message)?.[1];
  return sanitizeEndpointSummary(direct ?? fromMessage ?? "unknown");
}

function summarizeProviderContentType(error: unknown, message: string): string {
  const direct =
    readProviderFailureString(error, "contentType") ??
    readProviderFailureString(error, "content-type");
  const fromMessage = /content-type=([^，,]+?)(?:，|,|\s不是|\sis\snot|$)/iu.exec(message)?.[1];
  return sanitizeProviderFailureText((direct ?? fromMessage ?? "unknown").trim());
}

function sanitizeEndpointSummary(value: string): string {
  const sanitized = sanitizeProviderFailureText(value.trim());
  try {
    const parsed = new URL(sanitized);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/u, "") || "unknown";
  } catch {
    return sanitized.replace(/[?&][^\s]+/gu, "?***") || "unknown";
  }
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
        : name === "WebSearch" || name === "WebFetch"
          ? "web_source"
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
    name === "Glob" ||
    name === "WebSearch" ||
    name === "WebFetch";
  const supportsClaims = [
    ...deriveToolSupportsClaims(name, input, output),
    ...(kind === "web_source" ? ["web_source", "external_current_fact"] : []),
    ...(readOnlyEvidence ? ["readonly_low_noise_evidence"] : []),
  ];
  const evidence = createEvidenceRecord(
    kind,
    readOnlyEvidence
      ? formatReadOnlyToolEvidenceSummary(name, output, input)
      : `${name}: ${truncateDisplay(output.text.replace(/\s+/g, " "), 120)}`,
    output.fullOutputPath ?? name,
    supportsClaims,
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
  const pathText =
    paths.length > 0 ? `; paths=${truncateDisplay(paths.slice(0, 4).join(","), 120)}` : "";
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
  for (const key of ["path", "file_path", "pattern", "query", "url"]) {
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
  options: { rememberInContext?: boolean } = {},
): Promise<void> {
  const supportsClaims = deriveVerificationSupportsClaims(report);
  const evidence = createEvidenceRecord(
    "test_result",
    `${formatVerificationEvidenceStatusSummary(report)} 日志：${report.logPath ?? "无日志"}`,
    report.logPath ?? "Verification Runner",
    supportsClaims,
  );
  if (options.rememberInContext !== false) rememberEvidence(context, evidence);
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
    output: summarizeToolEndOutputForTranscript(compactToolOutputForTranscript(output)),
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
    data: compactToolStructuredDataForTranscript(output.data),
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
  const serialized = stringifyValueWithinBudget(output, TRANSCRIPT_TOOL_OUTPUT_MAX_CHARS + 1);
  if (serialized && isWithinTranscriptToolOutputBudget(serialized)) {
    return output;
  }

  const text = typeof output.text === "string" ? output.text : "";
  const fullOutputPath =
    typeof output.fullOutputPath === "string" ? output.fullOutputPath : undefined;
  return {
    ...output,
    text: compactToolEndTextForTranscript(text, fullOutputPath),
    details: compactToolOutputDetailsForTranscript(output.details, fullOutputPath),
    data: compactToolOutputDataForTranscript(output.data),
    truncated: true,
  };
}

function isWithinTranscriptToolOutputBudget(text: string): boolean {
  return (
    text.length <= TRANSCRIPT_TOOL_OUTPUT_MAX_CHARS &&
    Buffer.byteLength(text, "utf8") <= TRANSCRIPT_TOOL_OUTPUT_MAX_CHARS
  );
}

function compactToolOutputDetailsForTranscript(
  details: unknown,
  fullOutputPath?: string,
): string | undefined {
  if (typeof details !== "string") return undefined;
  if (isWithinTranscriptToolOutputBudget(details)) return details;
  return `<transcript-tool-output-details-truncated originalChars=${details.length}${fullOutputPath ? ` fullOutputPath=${fullOutputPath}` : ""}>`;
}

function compactToolOutputDataForTranscript(data: unknown): unknown {
  if (!data || typeof data !== "object") return data;
  const serialized = stringifyValueWithinBudget(data, TRANSCRIPT_TOOL_OUTPUT_MAX_CHARS + 1);
  if (serialized && isWithinTranscriptToolOutputBudget(serialized)) {
    return data;
  }
  return {
    truncated: true,
    originalChars: serialized?.length,
    preview: serialized?.slice(0, TRANSCRIPT_TOOL_OUTPUT_PREVIEW_CHARS),
    ...compactToolStructuredDataForTranscript(data),
  };
}

function compactToolStructuredDataForTranscript(
  data: unknown,
): Record<string, unknown> | undefined {
  const diagnostics = compactDiagnosticsDataForTranscript(data);
  return diagnostics;
}

function compactDiagnosticsDataForTranscript(
  data: unknown,
): { diagnostics: CompactDiagnostic[] } | undefined {
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
  return {
    type,
    severity,
    evidence,
    ...readCompactDiagnosticTargetFields(record),
  };
}

function readCompactDiagnosticTargetFields(
  record: Record<string, unknown>,
): Partial<CompactDiagnostic> {
  const target = typeof record.target === "string" ? record.target : undefined;
  const path = typeof record.path === "string" ? record.path : undefined;
  const command = typeof record.command === "string" ? record.command : undefined;
  const fallback = typeof record.fallback === "string" ? record.fallback : undefined;
  const targetHost = typeof record.targetHost === "string" ? record.targetHost : undefined;
  const targetPort = typeof record.targetPort === "number" ? record.targetPort : undefined;
  return {
    ...(command ? { command } : {}),
    ...(fallback ? { fallback } : {}),
    ...(target ? { target } : {}),
    ...(path ? { path } : {}),
    ...(targetHost ? { targetHost } : {}),
    ...(targetPort !== undefined ? { targetPort } : {}),
  };
}

export function isToolOutputFailure(name: ToolName, output: ToolOutput): boolean {
  if (name === "Bash") {
    const data = output.data as { exitCode?: unknown; isError?: unknown } | undefined;
    if (data?.isError === false) return false;
    const exitCode = data?.exitCode;
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
): Promise<unknown> {
  rememberRecentDiagnostics(context, toolName, content, toolUseId, evidenceId);
  rememberToolEvidenceData(context, evidenceId, content);
  const contentWithDiagnostics = appendToolResultContentDiagnostics(content);
  const modelHistoryContent = compactToolResultForModelHistory(toolName, contentWithDiagnostics);
  const budgetedContent = await budgetToolResultTranscriptContent(
    context,
    sessionId,
    toolUseId,
    modelHistoryContent,
    content,
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
  return budgetedContent;
}

export function compactToolResultForModelHistory(
  toolName: ToolName | string,
  content: unknown,
): unknown {
  if (!isEditingToolName(toolName) || !content || typeof content !== "object") {
    return content;
  }
  const output = content as ToolOutput;
  const data = output.data && typeof output.data === "object"
    ? (output.data as Record<string, unknown>)
    : {};
  const compactData: Record<string, unknown> = {};
  for (const key of MODEL_HISTORY_EDIT_DATA_KEYS) {
    if (data[key] !== undefined) compactData[key] = data[key];
  }
  if (Array.isArray(output.changedFiles) && compactData.changedFiles === undefined) {
    compactData.changedFiles = output.changedFiles;
  }
  const text = output.summary || output.preview || firstNonEmptyLine(output.text) || `${toolName} completed`;
  return {
    text,
    summary: output.summary ?? text,
    data: Object.keys(compactData).length > 0 ? compactData : undefined,
    changedFiles: output.changedFiles,
    truncated: output.truncated,
    evidenceId: output.evidenceId,
  };
}

function isEditingToolName(toolName: ToolName | string): boolean {
  return toolName === "Write" || toolName === "Edit" || toolName === "MultiEdit";
}

function firstNonEmptyLine(text: unknown): string | undefined {
  if (typeof text !== "string") return undefined;
  return text.split(/\r?\n/u).find((line) => line.trim())?.trim();
}

function rememberToolEvidenceData(
  context: TuiContext,
  evidenceId: string | undefined,
  content: unknown,
): void {
  if (!evidenceId || !content || typeof content !== "object") return;
  if (!Array.isArray(context.evidence)) return;
  const output = content as ToolOutput;
  const compact = compactToolEvidenceData(output.data);
  if (!compact) return;
  const evidence = context.evidence.find((item) => item.id === evidenceId);
  if (evidence) {
    evidence.data = {
      ...(typeof evidence.data === "object" && evidence.data ? evidence.data : {}),
      ...compact,
    };
  }
}

function compactToolEvidenceData(data: unknown): Record<string, unknown> | undefined {
  if (!data || typeof data !== "object") return undefined;
  const record = data as Record<string, unknown>;
  const compact: Record<string, unknown> = {};
  for (const key of ["service", "serviceHint", "artifactHint", "binaryHint", "binaryPreflight"]) {
    if (record[key] !== undefined) compact[key] = record[key];
  }
  return Object.keys(compact).length > 0 ? compact : undefined;
}

function rememberRecentDiagnostics(
  context: TuiContext,
  source: ToolName,
  content: unknown,
  toolUseId: string,
  evidenceId?: string,
): void {
  const diagnostics = readDiagnosticsForTranscript(
    (content as { data?: unknown } | undefined)?.data,
  );
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
  context.tools.recentDiagnostics = [...entries, ...(context.tools.recentDiagnostics ?? [])].slice(
    0,
    RECENT_DIAGNOSTICS_LIMIT,
  );
}

function appendToolResultContentDiagnostics(content: unknown): unknown {
  if (!content || typeof content !== "object") return content;
  const output = content as ToolOutput;
  if (typeof output.text !== "string") return content;
  const diagnostics = formatToolDiagnosticsSummary(output);
  const compactData = compactToolStructuredDataForTranscript(output.data);
  if (!diagnostics && !compactData) return content;
  return {
    ...output,
    data: compactData,
    text: diagnostics ? appendCompactDiagnostics(output.text, diagnostics) : output.text,
  };
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readServiceTargetFromHostPort(service: Record<string, unknown>): string | undefined {
  const host = readString(service.targetHost);
  const port = typeof service.targetPort === "number" ? service.targetPort : undefined;
  return host && port !== undefined ? `${host}:${port}` : undefined;
}

function checksOk(checks: Record<string, unknown> | undefined): boolean {
  if (!checks) return true;
  return Object.values(checks).every((value) => {
    const check = readRecord(value);
    return !check || check.ok !== false;
  });
}

function compactArtifactChecks(value: unknown): Record<string, unknown> {
  const checks = readRecord(value);
  if (!checks) return {};
  const compact: Record<string, unknown> = {};
  for (const key of ["header", "json", "executable", "text", "preserve"]) {
    const check = readRecord(checks[key]);
    if (check) compact[key] = compactCheckRecord(check);
  }
  return compact;
}

function compactCheckRecord(record: Record<string, unknown>): Record<string, unknown> {
  const compact: Record<string, unknown> = {};
  for (const key of [
    "ok",
    "mode",
    "status",
    "expectedStatus",
    "missingBody",
    "contains",
    "lineSet",
    "exact",
    "magic",
    "size",
  ]) {
    if (record[key] !== undefined) compact[key] = record[key];
  }
  return compact;
}

export async function budgetToolResultTranscriptContent(
  context: TuiContext,
  sessionId: string,
  toolUseId: string,
  content: unknown,
  artifactContent: unknown = content,
): Promise<unknown> {
  const contentText = stringifyToolResultContentForBudget(content);
  const artifactTextForBudget = stringifyToolResultContentForBudget(artifactContent);
  if (!artifactTextForBudget || artifactTextForBudget.startsWith("<persisted-tool-result>")) {
    return content;
  }
  const contentFits =
    !!contentText &&
    contentText.length <= TRANSCRIPT_TOOL_OUTPUT_MAX_CHARS &&
    Buffer.byteLength(contentText, "utf8") <= TRANSCRIPT_TOOL_OUTPUT_MAX_CHARS;
  if (
    contentFits &&
    artifactTextForBudget.length <= TRANSCRIPT_TOOL_OUTPUT_MAX_CHARS &&
    Buffer.byteLength(artifactTextForBudget, "utf8") <= TRANSCRIPT_TOOL_OUTPUT_MAX_CHARS
  ) {
    return content;
  }

  const artifactText =
    stringifyToolResultContentForArtifact(artifactContent) ?? artifactTextForBudget;
  const budgeted = await applyToolResultBudgetToMessages(
    [{ role: "tool", tool_call_id: toolUseId, content: artifactText }],
    {
      projectPath: context.projectPath,
      sessionId,
      singleResultChars: TRANSCRIPT_TOOL_OUTPUT_MAX_CHARS,
      singleResultBytes: TRANSCRIPT_TOOL_OUTPUT_MAX_CHARS,
    },
  );
  for (const record of budgeted.records) {
    await recordToolResultBudgetEvidence(context, sessionId, record);
  }
  const replacement = budgeted.messages[0];
  if (contentFits && hasCompactModelHistoryData(content)) return content;
  if (replacement?.role === "tool" && replacement.content.startsWith("<persisted-tool-result>")) {
    return replacement.content;
  }
  if (contentFits) return content;
  return replacement?.role === "tool" ? replacement.content : content;
}

function hasCompactModelHistoryData(content: unknown): boolean {
  if (!content || typeof content !== "object") return false;
  const record = content as { data?: unknown; changedFiles?: unknown };
  if (Array.isArray(record.changedFiles) && record.changedFiles.length > 0) return true;
  if (!record.data || typeof record.data !== "object") return false;
  return Object.keys(record.data as Record<string, unknown>).length > 0;
}

export function stringifyToolResultContentForBudget(content: unknown): string | null {
  if (typeof content === "string") return content;
  return stringifyValueWithinBudget(content, TRANSCRIPT_TOOL_OUTPUT_MAX_CHARS + 1);
}

export function stringifyToolResultContentForArtifact(content: unknown): string | null {
  if (typeof content === "string") return content;
  try {
    return JSON.stringify(content);
  } catch {
    return stringifyValueWithinBudget(content, LINGHUN_DEFAULT_TOOL_RESULT_CHARS + 1);
  }
}
