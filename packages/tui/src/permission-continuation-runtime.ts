/**
 * permission-continuation-runtime.ts — Pure permission/tool continuation helpers
 * extracted from index.ts.
 *
 * Contains:
 * - Permission decision helpers (formatPermissionDenied, formatPermissionSummary,
 *   formatDiffBeforeWrite, isLowRiskWorkspaceEdit, collectInputFiles, getHardDenyReason,
 *   findPermissionRule, isPlanAllowedTool, parsePermissionModeInput)
 * - Permission state formatters (formatPermissionRules, formatRecentDenied,
 *   hasRepeatedPermissionDenial, formatPermissionDenialPrimary)
 * - Report write guard helpers (createReportWriteGuard, isReportFileWriteRequest,
 *   extractRequestedReportPath, normalizeReportPath, shouldSendReportEvidenceReminder,
 *   shouldSendReportWriteReminder, shouldSendReportFinalReferenceReminder,
 *   hasReportFinalAnswerShape, doesWriteSatisfyReportGuard, hasReportWriteToolCall,
 *   createReportFinalReferenceReminder, createReportTaskGuard, createReportWriteReminder,
 *   formatModelToolOutput)
 * - Remote redaction (redactRemoteSummary, remoteTranscriptSummary)
 * - Tool name normalization (normalizeToolName)
 *
 * Hard boundary: no sendMessage, no provider stream loop, no TuiContext state machine,
 * no store/session writes, no gateway calls.
 */

import { relative, resolve } from "node:path";
import type { Language, PermissionMode } from "@linghun/shared";
import { isRawPermissionMode, normalizePermissionMode } from "@linghun/shared";
import { type ToolName, type ToolOutput, builtInTools } from "@linghun/tools";
import { truncateDisplay } from "./startup-runtime.js";
import { formatToolOutput } from "./tool-output-presenter.js";

// ---------------------------------------------------------------------------
// Types re-exported for use by index.ts
// ---------------------------------------------------------------------------

export type ReportWriteGuard = {
  requestedPath: string;
  pathExplicit: boolean;
  completed: boolean;
  reminderSent: boolean;
  evidenceReminderSent: boolean;
  finalReferenceReminderSent: boolean;
  nonWriteToolRounds: number;
  evidenceRead: boolean;
};

export type PermissionRule = {
  id: string;
  effect: "allow" | "ask" | "deny";
  toolName: ToolName | "*";
  risk?: "low" | "medium" | "high";
};

export type RecentPermissionRejection = {
  id: string;
  toolName: ToolName;
  mode: PermissionMode;
  reason: string;
  createdAt: string;
};

export type PermissionState = {
  rules: PermissionRule[];
  recentDenied: RecentPermissionRejection[];
};

// ModelToolCall shape needed by report guard helpers
export type ModelToolCallLike = {
  id: string;
  name: string;
  input?: unknown;
};

// ---------------------------------------------------------------------------
// Permission decision helpers
// ---------------------------------------------------------------------------

export function formatPermissionDenialPrimary(language: Language): string {
  return language === "en-US"
    ? "Denied. No file was written; the assistant will receive the denial and adjust."
    : "已拒绝。本轮未写入文件，模型会收到拒绝结果并继续调整。";
}

export function formatPermissionDenied(reason: string, summary: string): string {
  return `权限已拒绝：${reason}\n本次请求：${summary}\n建议：查看 /permissions recent，或切换合适模式后重试。`;
}

export function formatPermissionSummary(
  name: ToolName,
  files: string[],
  risk: "low" | "medium" | "high",
): string {
  const targets = files.length === 0 ? "无文件路径" : files.join(", ");
  return `工具 ${name}；目标：${targets}；风险：${risk}`;
}

export function formatDiffBeforeWrite(
  name: ToolName,
  files: string[],
  risk: "low" | "medium" | "high",
): string {
  const fileText = files.length === 0 ? "未声明文件" : files.join(", ");
  return `写入前摘要：将执行 ${name}\n将影响文件：${fileText}\n风险：${risk}\n原因：工作区内工具操作；本阶段展示轻量摘要，不生成完整 git hunk。`;
}

export function isLowRiskWorkspaceEdit(
  name: ToolName,
  risk: "low" | "medium" | "high",
  files: string[],
): boolean {
  return (
    (name === "Write" || name === "Edit" || name === "MultiEdit") &&
    risk === "low" &&
    files.length > 0
  );
}

export function collectInputFiles(input: unknown): string[] {
  if (typeof input !== "object" || input === null || !("path" in input)) {
    return [];
  }
  const path = (input as { path?: unknown }).path;
  return typeof path === "string" ? [path.replaceAll("\\", "/")] : [];
}

export function getHardDenyReason(
  name: ToolName,
  input: unknown,
  files: string[],
  workspaceRoot: string,
): string | null {
  for (const file of files) {
    // D.13O — UNC / WebDAV / `@SSL@` 风格远程路径必须直接拒绝；resolve()
    // 在某些 Node 版本会把它们规范化成本地路径，会绕过下面的 startsWith("..")
    // 检查。为保守起见，单独 hard-deny。
    if (
      file.startsWith("\\\\") ||
      file.startsWith("//") ||
      /@SSL@\d+|@\d+@SSL/iu.test(file)
    ) {
      return `安全保护：UNC / WebDAV / 远程路径不允许走工作区工具：${file}。`;
    }
    const target = resolve(workspaceRoot, file);
    const rel = relative(resolve(workspaceRoot), target);
    if (rel.startsWith("..") || (rel === "" && !builtInTools[name].isReadOnly)) {
      return `路径越界或指向工作区根：${file}。只允许操作当前工作区内明确文件。`;
    }
    const normalized = rel.replaceAll("\\", "/");
    if (normalized.startsWith(".git/") || normalized.includes("/.git/")) {
      return "安全保护：禁止修改 .git 目录。";
    }
    if (
      normalized.includes(".ssh/") ||
      normalized.endsWith(".env") ||
      normalized.includes("secret")
    ) {
      return "安全保护：疑似密钥或敏感路径，需要更高阶段的安全流程处理。";
    }
  }
  if (name === "Bash") {
    const command =
      typeof input === "object" && input !== null ? (input as { command?: unknown }).command : "";
    if (typeof command !== "string" || !command.trim()) {
      return "Bash 命令不能为空。";
    }
    if (
      /(rm\s+-rf|curl\s+[^|]+\|\s*(sh|bash)|wget\s+[^|]+\|\s*(sh|bash)|mkfs|shutdown|reboot)/i.test(
        command,
      )
    ) {
      return "安全保护：拒绝高风险删除、远程脚本执行或系统级命令。";
    }
  }
  return null;
}

export function findPermissionRule(
  rules: PermissionRule[],
  name: ToolName,
  risk: "low" | "medium" | "high",
): PermissionRule | undefined {
  return rules.find(
    (rule) =>
      (rule.toolName === "*" || rule.toolName === name) && (!rule.risk || rule.risk === risk),
  );
}

export function isPlanAllowedTool(name: ToolName, isReadOnly: boolean): boolean {
  return isReadOnly || name === "Todo";
}

export function parsePermissionModeInput(value: string): PermissionMode | null {
  if (!isRawPermissionMode(value)) return null;
  return normalizePermissionMode(value);
}

// ---------------------------------------------------------------------------
// Permission state formatters
// ---------------------------------------------------------------------------

export function formatPermissionRules(state: PermissionState): string {
  if (state.rules.length === 0) {
    return "当前没有持久化权限规则。可用 /permissions add allow|ask|deny <tool|*> [risk] 添加。";
  }
  return state.rules
    .map(
      (rule) => `${rule.id}  ${rule.effect}  ${rule.toolName}${rule.risk ? `  ${rule.risk}` : ""}`,
    )
    .join("\n");
}

export function formatRecentDenied(state: PermissionState): string {
  if (state.recentDenied.length === 0) {
    return "最近没有拒绝记录。";
  }
  return state.recentDenied
    .map((item) => `${item.createdAt}  ${item.toolName}  ${item.mode}  ${item.reason}`)
    .join("\n");
}

export function hasRepeatedPermissionDenial(recentDenied: RecentPermissionRejection[]): boolean {
  const latest = recentDenied.slice(0, 5);
  const counts = new Map<string, number>();
  for (const item of latest) {
    const key = `${item.toolName}:${item.mode}:${item.reason}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.values()].some((count) => count >= 3);
}

// ---------------------------------------------------------------------------
// Report write guard helpers
// ---------------------------------------------------------------------------

export function createReportWriteGuard(text: string): ReportWriteGuard | undefined {
  if (!isReportFileWriteRequest(text)) {
    return undefined;
  }
  const requestedPath = extractRequestedReportPath(text);
  return {
    requestedPath: requestedPath ?? "report.md",
    pathExplicit: Boolean(requestedPath),
    completed: false,
    reminderSent: false,
    evidenceReminderSent: false,
    finalReferenceReminderSent: false,
    nonWriteToolRounds: 0,
    evidenceRead: false,
  };
}

export function isReportFileWriteRequest(text: string): boolean {
  const asksForReport = /报告|report/iu.test(text);
  const asksToWrite = /生成|写入|创建|保存|输出|写到|写在|generate|write|create|save|output/iu.test(
    text,
  );
  const asksForFile = /根目录|文件|file|\.md\b|写到|写在|保存为|save as|as\s+[^\s]+\.md/iu.test(
    text,
  );
  return asksForReport && asksToWrite && asksForFile;
}

export function extractRequestedReportPath(text: string): string | undefined {
  const quotedMarkdownPath = text.match(
    /[\u201c\u201d\u2018\u2019"""'''`]([^\u201c\u201d\u2018\u2019"""'''`]+\.md)[\u201c\u201d\u2018\u2019"""'''`]/iu,
  )?.[1];
  if (quotedMarkdownPath) {
    return normalizeReportPath(quotedMarkdownPath.trim());
  }
  const markdownPath = text.match(
    /(?:^|[\s`"'\u201c\u201d\u2018\u2019\uff1a:，,。；;()（）])([\w./\\-]*report[\w./\\-]*\.md)\b/iu,
  )?.[1];
  if (markdownPath) {
    return normalizeReportPath(markdownPath);
  }
  const anyMarkdownPath = text.match(
    /(?:^|[\s`"'\u201c\u201d\u2018\u2019\uff1a:，,。；;()（）])([\w./\\-]+\.md)\b/iu,
  )?.[1];
  return anyMarkdownPath ? normalizeReportPath(anyMarkdownPath) : undefined;
}

export function normalizeReportPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//u, "");
}

export function shouldSendReportEvidenceReminder(guard: ReportWriteGuard | undefined): boolean {
  return Boolean(guard && !guard.completed && !guard.evidenceRead && !guard.evidenceReminderSent);
}

export function shouldSendReportWriteReminder(guard: ReportWriteGuard | undefined): boolean {
  return Boolean(guard?.evidenceRead && !guard.completed && !guard.reminderSent);
}

export function shouldSendReportFinalReferenceReminder(
  guard: ReportWriteGuard,
  assistantText: string,
): boolean {
  return (
    guard.completed &&
    !guard.finalReferenceReminderSent &&
    (!assistantText.includes(guard.requestedPath) || !hasReportFinalAnswerShape(assistantText))
  );
}

export function hasReportFinalAnswerShape(text: string): boolean {
  return (
    /结论|conclusion|发现|findings/iu.test(text) && /下一步|next step|建议|recommend/iu.test(text)
  );
}

export function createReportFinalReferenceReminder(
  guard: ReportWriteGuard,
  language: Language,
): string {
  return language === "en-US"
    ? `The report file has been written. Give the final answer now: reference ${guard.requestedPath}, include 2-4 evidence-based conclusions, separate inferred/unconfirmed items, and list next steps. Do not call another tool unless necessary.`
    : `报告文件已经写入。现在请给出最终回答：引用 ${guard.requestedPath}，列出 2-4 条基于证据的核心结论，单独说明推断/未确认项，并给出下一步。除非必要，不要再调用工具。`;
}

export function createReportTaskGuard(guard: ReportWriteGuard, language: Language): string {
  return language === "en-US"
    ? `Task-specific completion requirement for this turn only: the user explicitly asked for a saved report file. Before final answer, call Write with path ${guard.requestedPath}. If you inspect the project first, keep it minimal and still finish by writing ${guard.requestedPath}. The final answer must reference ${guard.requestedPath}, include 2-4 evidence-based conclusions, separate inferred/unconfirmed items, and list next steps.`
    : `仅本轮任务的完成要求：用户明确要求保存报告文件。最终回答前必须调用 Write，path 使用 ${guard.requestedPath}。如需先检查项目，请保持最小必要检查，并仍以写入 ${guard.requestedPath} 收口。最终回答必须引用 ${guard.requestedPath}，列出 2-4 条基于证据的核心结论，单独说明推断/未确认项，并给出下一步。`;
}

export function createReportWriteReminder(guard: ReportWriteGuard, language: Language): string {
  return language === "en-US"
    ? `The user explicitly asked you to generate and save a report file. No saved report exists yet. Call the Write tool now with path ${guard.requestedPath}, then give a final answer that references ${guard.requestedPath}.`
    : `用户明确要求生成并保存报告文件，但当前还没有保存报告。现在请调用 Write 工具写入 ${guard.requestedPath}，然后在最终回答中引用 ${guard.requestedPath}。`;
}

export function doesWriteSatisfyReportGuard(
  guard: ReportWriteGuard | undefined,
  toolCall: ModelToolCallLike,
  result: { ok: boolean; tool: string },
): guard is ReportWriteGuard {
  return Boolean(
    guard && result.ok && result.tool === "Write" && hasReportWriteToolCall(guard, [toolCall]),
  );
}

export function hasReportWriteToolCall(
  guard: ReportWriteGuard,
  toolCalls: ModelToolCallLike[],
): boolean {
  for (const toolCall of toolCalls) {
    if (normalizeToolName(toolCall.name) !== "Write") {
      continue;
    }
    const input = toolCall.input;
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      continue;
    }
    const path = (input as { path?: unknown }).path;
    if (typeof path !== "string") {
      continue;
    }
    const normalizedPath = normalizeReportPath(path);
    if (guard.pathExplicit && normalizedPath === guard.requestedPath) {
      return true;
    }
    const matchesDefaultReport = /(?:^|\/)\w*[\w-]*report[\w-]*\.md$/iu.test(normalizedPath);
    if (!guard.pathExplicit && matchesDefaultReport) {
      guard.requestedPath = normalizedPath;
      return true;
    }
  }
  return false;
}

export function formatModelToolOutput(
  toolName: ToolName,
  output: ToolOutput,
  language: Language,
  evidenceId: string | undefined,
  reportWriteGuard: ReportWriteGuard | undefined,
): string {
  if (!reportWriteGuard) {
    return formatToolOutput(toolName, output, language, evidenceId);
  }
  const changedFile = output.changedFiles?.[0];
  if (toolName === "Write" && changedFile) {
    return language === "en-US" ? `Report saved: ${changedFile}` : `报告已保存：${changedFile}`;
  }
  if (toolName === "Write") {
    return language === "en-US" ? "Report file write completed." : "报告文件写入已完成。";
  }
  if (toolName === "Read" || toolName === "Glob" || toolName === "Grep") {
    return language === "en-US"
      ? `${toolName} completed; continuing the report analysis.`
      : `${toolName} 已完成，继续整理报告分析。`;
  }
  return formatToolOutput(toolName, output, language, evidenceId);
}

// ---------------------------------------------------------------------------
// Tool name normalization
// ---------------------------------------------------------------------------

export function normalizeToolName(name: string): ToolName | null {
  const found = (Object.keys(builtInTools) as ToolName[]).find(
    (item) => item.toLowerCase() === name.toLowerCase(),
  );
  return found ?? null;
}

// ---------------------------------------------------------------------------
// Remote redaction
// ---------------------------------------------------------------------------

export function redactRemoteSummary(value: string): string {
  const bounded = truncateDisplay(value.replace(/\s+/g, " "), 500);
  return bounded
    .replace(
      /(api[_-]?key|token|secret|authorization|provider raw request)\s*[:=]\s*(?:bearer\s+)?[^\s,;]+/giu,
      "$1=[REDACTED]",
    )
    .replace(/\bbearer\s+[^\s,;]+/giu, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]+/gu, "sk-[REDACTED]")
    .replace(/transcript\s*[:=]\s*[^\s,;]+/giu, "transcript=[REDACTED]")
    .replace(/(source|log|index result|evidence)\s*[:=]\s*\{[^}]*\}/giu, "$1=[REDACTED]")
    .replace(/https?:\/\/[^\s]+/giu, "[REDACTED_ENDPOINT]");
}

export function remoteTranscriptSummary(value: string): string {
  return truncateDisplay(redactRemoteSummary(value), 220);
}
