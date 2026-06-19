import type { Language } from "@linghun/shared";
import type { ToolName, ToolOutput } from "@linghun/tools";

export type TuiOutputLayer = "primary" | "details" | "debug";

export type LayeredToolOutput = {
  layer: TuiOutputLayer;
  toolName: ToolName;
  summary: string;
  preview: string;
  details?: string;
  truncated: boolean;
  fullOutputPath?: string;
  evidenceId?: string;
};

const TODO_OUTPUT_ITEM_LIMIT = 8;
const BASH_TAIL_LINE_LIMIT = 0;
const PRIMARY_PREVIEW_LINE_CAP = 5;
const DIAGNOSTICS_SUMMARY_LIMIT = 3;
const DIAGNOSTICS_EVIDENCE_LIMIT = 120;
const RAW_TOOL_USE_PATTERNS = [
  /<tool_use(?:_error)?\b[\s\S]*?<\/tool_use(?:_error)?>/giu,
  /<tool_use(?:_error)?\b[^>]*\/>/giu,
  /<tool_uses\b[\s\S]*?<\/tool_uses>/giu,
  /```(?:json|xml)?\s*[\s\S]*?\btool_use(?:_id)?\b[\s\S]*?```/giu,
  /\{[\s\S]{0,400}?"type"\s*:\s*"tool_use"[\s\S]{0,1600}?\}/giu,
];
const RAW_TOOL_XML_START = /<tool_use(?:_error)?\b|<tool_uses\b/iu;
const RAW_TOOL_PREFIXES = [
  "<",
  "<t",
  "<to",
  "<too",
  "<tool",
  "<tool_",
  "<tool_u",
  "<tool_us",
  "<tool_use_",
  "<tool_use_e",
  "<tool_use_er",
  "<tool_use_err",
  "<tool_use_erro",
];
const INTERNAL_STREAM_LABEL_REPLACEMENTS = [
  ["RunVerification", { "zh-CN": "验证命令", "en-US": "verification command" }],
] as const;
const INTERNAL_STREAM_LABEL_PREFIXES = INTERNAL_STREAM_LABEL_REPLACEMENTS.flatMap(([label]) =>
  Array.from({ length: label.length - 1 }, (_, index) => label.slice(0, index + 1)),
).sort((a, b) => b.length - a.length);

export function createLayeredToolOutput(
  name: ToolName,
  output: ToolOutput,
  language: Language,
  evidenceId?: string,
): LayeredToolOutput {
  const preview = createToolOutputPreview(name, output.preview ?? output.text, language, output);
  const truncated = Boolean(preview.truncated || output.truncated);
  return {
    layer: "primary",
    toolName: name,
    summary: sanitizeToolSummaryForPrimary(
      output.summary ?? createToolSummary(name, output, language),
      language,
    ),
    preview: preview.text,
    details: output.details,
    truncated,
    fullOutputPath: output.fullOutputPath,
    evidenceId: evidenceId ?? output.evidenceId,
  };
}

export function formatToolOutput(
  name: ToolName,
  output: ToolOutput,
  language: Language,
  evidenceId?: string,
): string {
  const layered = createLayeredToolOutput(name, output, language, evidenceId);
  const lead = formatPrimaryToolLead(name, output, layered, language);
  const lines: string[] = lead ? [lead] : [];
  // Phase 18: large response token warning (>10K characters).
  const textLen = output.text?.length ?? 0;
  if (textLen > 10_000) {
    const approxTokens = Math.round(textLen / 4);
    lines.push(
      language === "en-US"
        ? `⚠ Large response · ~${approxTokens} tokens`
        : `⚠ 大响应 · ~${approxTokens} tokens`,
    );
  }
  if (layered.preview) {
    lines.push(layered.preview);
  }
  const diagnostics = formatToolDiagnosticsSummary(output);
  if (diagnostics) {
    lines.push(diagnostics);
  }
  // D.13L Section 4 — Bash 单独再补一行人类可读终态：
  //   "Command exited 0" / "命令已退出 0"
  // 与 CCB AssistantToolUseMessage 的 end-summary 模式对齐；只在能从
  // output.data.exitCode 读出退出码时打印。其他工具不需要这条行——
  // Read/Edit/Write/Glob/Grep 的 stats 行（N 行 / +N -N / N 条结果）
  // 已经能一眼看出工作量。
  const bashEnd = formatBashEndSummary(name, output, language);
  if (bashEnd) {
    lines.push(bashEnd);
  }
  return lines.join("\n");
}

export function formatToolDiagnosticsSummary(output: ToolOutput): string | undefined {
  const metadata = output.data && typeof output.data === "object" ? output.data : undefined;
  const diagnostics = Array.isArray((metadata as { diagnostics?: unknown } | undefined)?.diagnostics)
    ? (metadata as { diagnostics: unknown[] }).diagnostics
    : [];
  const lines = diagnostics
    .map(formatCompactDiagnosticLine)
    .filter((line): line is string => Boolean(line))
    .slice(0, DIAGNOSTICS_SUMMARY_LIMIT);
  if (lines.length === 0) return undefined;
  return ["Linghun diagnostics:", ...lines].join("\n");
}

function formatCompactDiagnosticLine(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type.trim() : "";
  const evidence = typeof record.evidence === "string" ? record.evidence.trim() : "";
  if (!type || !evidence) return undefined;
  return `- ${type}: ${compactDiagnosticEvidence(evidence)}`;
}

function compactDiagnosticEvidence(value: string): string {
  const singleLine = value.replace(/\s+/gu, " ").trim();
  if (singleLine.length <= DIAGNOSTICS_EVIDENCE_LIMIT) return singleLine;
  return `${singleLine.slice(0, DIAGNOSTICS_EVIDENCE_LIMIT - 3)}...`;
}

function formatPrimaryToolLead(
  name: ToolName,
  output: ToolOutput,
  layered: LayeredToolOutput,
  language: Language,
): string {
  const metadata = output.data && typeof output.data === "object" ? output.data : undefined;
  const count = readNumber(metadata, "count");
  const totalLines = readNumber(metadata, "totalLines") ?? readNumber(metadata, "contentLines");
  const visibleLines =
    readNumber(metadata, "windowLines") ?? readNumber(metadata, "lines") ?? lineCount(output.text);
  // Editing tools: show tool name + filename prominently.
  if (isEditingTool(name)) {
    const changedFiles = readStringList(metadata, "changedFiles");
    const filePart = changedFiles.length > 0 ? `**${changedFiles[0]}**` : "";
    const addedLines = readNumber(metadata, "addedLines") ?? 0;
    const removedLines = readNumber(metadata, "removedLines") ?? 0;
    const patchPart = `+${addedLines} -${removedLines}`;
    if (language === "en-US") {
      return filePart
        ? `${name}(${filePart}) ${patchPart}`
        : `${name} ${patchPart}`;
    }
    return filePart
      ? `${name}(${filePart}) ${patchPart}`
      : `${name} ${patchPart}`;
  }
  if (language === "en-US") {
    if (name === "Grep") return `Found **${count ?? 0}** matches.`;
    if (name === "Glob") return `Found **${count ?? visibleLines}** files.`;
    if (name === "Read") {
      const readFile = readStringValue(metadata, "file") ?? readStringValue(metadata, "path");
      const lineLabel = `**${totalLines ?? visibleLines}** lines`;
      return readFile ? `Read(${readFile}) ${lineLabel}.` : `Read ${lineLabel}.`;
    }
    if (name === "ReadSnippets") return `ReadSnippets **${count ?? visibleLines}** ranges.`;
    if (name === "SourcePack") return `SourcePack **${count ?? visibleLines}** snippets.`;
    if (name === "Bash") return formatBashLead(metadata, language);
    // Phase 17: WebSearch / WebFetch dedicated format.
    if (name === "WebSearch") return formatWebSearchLead(output, language);
    if (name === "WebFetch") return formatWebFetchLead(output, language);
    // Phase 18: try structured output for non-built-in tools.
    const enStructured = tryExtractLeadText(output.text);
    if (enStructured) return `${name}: ${enStructured}`;
    return `${name} summary: ${layered.summary}`;
  }
  if (name === "Grep") return `找到 **${count ?? 0}** 处匹配。`;
  if (name === "Glob") return `找到 **${count ?? visibleLines}** 个文件。`;
  if (name === "Read") {
    const readFile = readStringValue(metadata, "file") ?? readStringValue(metadata, "path");
    const lineLabel = `**${totalLines ?? visibleLines}** 行`;
    return readFile ? `Read(${readFile}) ${lineLabel}` : `读取 ${lineLabel}`;
  }
  if (name === "ReadSnippets") return `ReadSnippets **${count ?? visibleLines}** 个范围`;
  if (name === "SourcePack") return `SourcePack **${count ?? visibleLines}** 个片段`;
  if (name === "Bash") return formatBashLead(metadata, language);
  // Phase 17: WebSearch / WebFetch dedicated format.
  if (name === "WebSearch") return formatWebSearchLead(output, language);
  if (name === "WebFetch") return formatWebFetchLead(output, language);
  // Phase 18: try structured output for non-built-in tools.
  const zhStructured = tryExtractLeadText(output.text);
  if (zhStructured) return `${name}：${zhStructured}`;
  return `${name} 摘要：${layered.summary}`;
}

function lineCount(value: string): number {
  if (!value) return 0;
  return value.split(/\r?\n/u).filter((line) => line.trim().length > 0).length;
}

/**
 * Bash lead line: short command summary + exit status indicator.
 * Success: "Bash(git status) ✓"  Failure: "Bash(npm test) ✗ exit 1"
 */
function formatBashLead(
  metadata: object | undefined,
  language: Language,
): string {
  const command = readStringValue(metadata, "command") ?? "";
  const exitCode = readNumber(metadata, "exitCode");
  const shortCmd = command.length > 60 ? `${command.slice(0, 57)}...` : command;
  const cmdPart = shortCmd ? `Bash(${shortCmd})` : "Bash";
  if (exitCode === undefined) {
    return cmdPart;
  }
  if (exitCode === 0) {
    return `${cmdPart} ✓`;
  }
  return language === "en-US"
    ? `${cmdPart} ✗ exit ${exitCode}`
    : `${cmdPart} ✗ 退出 ${exitCode}`;
}

function formatBashEndSummary(
  name: ToolName,
  output: ToolOutput,
  language: Language,
): string | undefined {
  if (name !== "Bash") return undefined;
  const data =
    output.data && typeof output.data === "object"
      ? (output.data as Record<string, unknown>)
      : undefined;
  const exitCode = data && typeof data.exitCode === "number" ? data.exitCode : undefined;
  if (exitCode === undefined) return undefined;
  // 退出码已在 lead 中显示；end summary 只在失败时补充一行用于醒目提示
  if (exitCode === 0) return undefined;
  return language === "en-US" ? `Exit code ${exitCode}` : `退出码 ${exitCode}`;
}

/**
 * Phase 17 — WebSearch lead format: "执行 N 次搜索 · Ss" / "Did N searches in Ss".
 */
function formatWebSearchLead(output: ToolOutput, language: Language): string {
  const data =
    output.data && typeof output.data === "object"
      ? (output.data as Record<string, unknown>)
      : undefined;
  const searches =
    typeof data?.searches === "number"
      ? data.searches
      : typeof data?.count === "number"
        ? data.count
        : undefined;
  const duration =
    typeof data?.duration === "number"
      ? data.duration
      : typeof data?.durationMs === "number"
        ? data.durationMs / 1000
        : undefined;
  const parts: string[] = [];
  if (searches !== undefined) {
    parts.push(
      language === "en-US"
        ? `${searches} ${searches === 1 ? "search" : "searches"}`
        : `执行 ${searches} 次搜索`,
    );
  }
  if (duration !== undefined) {
    parts.push(language === "en-US" ? `${duration.toFixed(1)}s` : `${duration.toFixed(1)}s`);
  }
  if (parts.length === 0) {
    return language === "en-US" ? "WebSearch completed" : "WebSearch 已完成";
  }
  return parts.join(language === "en-US" ? " in " : " · ");
}

/**
 * Phase 17 — WebFetch lead format: "收到 N KB · 200 OK" / "Received N KB · 200 OK".
 */
function formatWebFetchLead(output: ToolOutput, language: Language): string {
  const data =
    output.data && typeof output.data === "object"
      ? (output.data as Record<string, unknown>)
      : undefined;
  const size =
    typeof data?.size === "number"
      ? data.size
      : typeof data?.contentLength === "number"
        ? data.contentLength
        : undefined;
  const status =
    typeof data?.status === "number"
      ? data.status
      : typeof data?.statusCode === "number"
        ? data.statusCode
        : undefined;
  const statusText = typeof data?.statusText === "string" ? data.statusText : undefined;
  const parts: string[] = [];
  if (size !== undefined) {
    const kb = size >= 1024 ? `${(size / 1024).toFixed(1)}KB` : `${size}B`;
    parts.push(language === "en-US" ? `Received ${kb}` : `收到 ${kb}`);
  }
  if (status !== undefined) {
    const code = statusText ? `${status} ${statusText}` : String(status);
    parts.push(code);
  }
  if (parts.length === 0) {
    return language === "en-US" ? "WebFetch completed" : "WebFetch 已完成";
  }
  return parts.join(" · ");
}

/**
 * Redact secret-bearing fragments from a tool-start banner arg before it ever
 * reaches the main screen / lastFullOutput. Applied uniformly to every tool's
 * arg (Bash is the main risk, but a Read/Write path could in theory carry a
 * token too). Only the secret substrings are rewritten; the rest of the
 * command is left intact so plain commands like `git status` are unchanged.
 */
function redactBannerArg(value: string): string {
  return (
    value
      // Bearer tokens: `Bearer <token>` -> `Bearer ***`
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ***")
      // Authorization header (non-Bearer single-token values; Bearer handled above).
      .replace(/\b(Authorization)\s*:\s*(?!Bearer\b)[^\s"'&]+/gi, "$1: ***")
      // Secret env-var assignments (upper-case names), keep name, redact value.
      .replace(
        /\b([A-Z0-9_]*(?:API_KEY|APIKEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|KEY))=\S+/g,
        "$1=***",
      )
      // api_key= / apikey= / api-key= (case-insensitive), value until ws/&/quote.
      .replace(/\b(api[_-]?key)=[^\s&"']+/gi, "$1=***")
      // token= query/value params (case-insensitive).
      .replace(/\b(token)=[^\s&"']+/gi, "$1=***")
      // key= query params in URLs (case-insensitive).
      .replace(/\b(key)=[^\s&"']+/gi, "$1=***")
      // sk-style long secret tokens.
      .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "sk-***")
      // Product banner noise: keep execution details out of the primary row.
      .replace(
        /\b(--?(?:log|log-path|output|output-path|checkpoint-id|checkpoint)\s+)(?:"[^"]*"|'[^']*'|\S+)/giu,
        "$1***",
      )
      .replace(/\bchk_[A-Za-z0-9_-]+\b/gu, "checkpoint-id")
      .replace(/[A-Za-z]:[\\/][^\s"']*(?:log|full-output)[^\s"']*/giu, "[output-log]")
      .replace(/\{[^{}]*(?:"schema"|"raw"|"debug")[\s\S]*\}/giu, "{...}")
  );
}

/**
 * D.13L Section 4 — Tool start banner shown immediately before runTool.
 * Mirrors CCB AssistantToolUseMessage rendering: `<UserFacingName>(<arg>)`.
 *   Bash(<command>) / Read(<path>) / Edit(<file>) / Write(<file>) /
 *   Grep(<pattern>) / Glob(<pattern>) / MultiEdit(<file>).
 *
 * Only emits when we can produce a single readable arg from input; otherwise
 * returns undefined so the caller can skip the writeLine. The arg is redacted
 * for secrets FIRST, then long commands / paths are clamped to 120 chars to
 * keep one transcript line.
 */
export function formatToolStart(name: ToolName, input: unknown): string | undefined {
  const obj = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const str = (key: string): string | undefined => {
    const v = obj[key];
    return typeof v === "string" && v.length > 0 ? v : undefined;
  };
  const clamp = (value: string): string =>
    value.length > 120 ? `${value.slice(0, 117)}...` : value;
  let arg: string | undefined;
  if (name === "Bash") {
    arg = str("command");
  } else if (name === "Read") {
    arg = str("path") ?? str("file_path");
  } else if (name === "ReadSnippets") {
    arg = "ranges";
  } else if (name === "SourcePack") {
    arg = str("query") ?? "query";
  } else if (name === "Write" || name === "Edit" || name === "MultiEdit") {
    arg = str("file_path") ?? str("path");
  } else if (name === "Grep") {
    arg = "search";
  } else if (name === "Glob") {
    arg = "files";
  }
  if (!arg) return undefined;
  return `${name}(${clamp(redactBannerArg(arg))})`;
}

export function sanitizeAssistantPrimaryText(text: string, language: Language): string {
  const result = sanitizeAssistantPrimaryTextWithMetadata(text, language);
  return result.text;
}

export function sanitizeAssistantPrimaryTextWithMetadata(
  text: string,
  language: Language,
): { text: string; removedRawToolProtocol: boolean } {
  let sanitized = text;
  let removed = false;
  let replacedInternalLabel = false;
  for (const pattern of RAW_TOOL_USE_PATTERNS) {
    sanitized = sanitized.replace(pattern, () => {
      removed = true;
      return "";
    });
  }
  for (const [label, replacement] of INTERNAL_STREAM_LABEL_REPLACEMENTS) {
    if (sanitized.includes(label)) {
      sanitized = sanitized.split(label).join(replacement[language]);
      replacedInternalLabel = true;
    }
  }
  if (!removed) {
    return {
      text: replacedInternalLabel ? sanitized : text,
      removedRawToolProtocol: false,
    };
  }
  const compact = sanitized.replace(/\n{3,}/gu, "\n\n");
  const note = language === "en-US" ? "[Tool call details hidden.]\n" : "[工具调用细节已隐藏。]\n";
  return {
    text: compact.trim().length > 0 ? `${note}${compact}` : note,
    removedRawToolProtocol: true,
  };
}

export function createAssistantPrimaryTextSanitizer(language: Language): {
  push(text: string): string;
  flush(): string;
  hadRawToolProtocol(): boolean;
} {
  let pending = "";
  let removedRawToolProtocol = false;

  function sanitizeBuffered(text: string): string {
    if (!text) return "";
    const combined = pending + text;
    const holdAt = findPendingRawToolStart(combined) ?? findRawToolPrefixAtEnd(combined);
    if (holdAt !== undefined) {
      pending = combined.slice(holdAt);
      const result = sanitizeAssistantPrimaryTextWithMetadata(combined.slice(0, holdAt), language);
      removedRawToolProtocol ||= result.removedRawToolProtocol;
      return result.text;
    }
    const internalLabelPrefix = findInternalStreamLabelPrefixAtEnd(combined);
    if (internalLabelPrefix) {
      pending = internalLabelPrefix;
      const result = sanitizeAssistantPrimaryTextWithMetadata(
        combined.slice(0, -internalLabelPrefix.length),
        language,
      );
      removedRawToolProtocol ||= result.removedRawToolProtocol;
      return result.text;
    }
    pending = "";
    const result = sanitizeAssistantPrimaryTextWithMetadata(combined, language);
    removedRawToolProtocol ||= result.removedRawToolProtocol;
    return result.text;
  }

  return {
    push: sanitizeBuffered,
    flush() {
      const result = pending
        ? sanitizeAssistantPrimaryTextWithMetadata(pending, language)
        : { text: "", removedRawToolProtocol: false };
      removedRawToolProtocol ||= result.removedRawToolProtocol;
      pending = "";
      return result.text;
    },
    hadRawToolProtocol() {
      return removedRawToolProtocol;
    },
  };
}

function findInternalStreamLabelPrefixAtEnd(text: string): string | undefined {
  return INTERNAL_STREAM_LABEL_PREFIXES.find((prefix) => text.endsWith(prefix));
}

function findPendingRawToolStart(text: string): number | undefined {
  const match = RAW_TOOL_XML_START.exec(text);
  if (!match || match.index < 0) return undefined;
  const start = match.index;
  const tail = text.slice(start).toLowerCase();
  if (tail.startsWith("<tool_uses")) {
    return tail.includes("</tool_uses>") ? undefined : start;
  }
  if (tail.startsWith("<tool_use_error")) {
    if (tail.includes("/>")) return undefined;
    return tail.includes("</tool_use_error>") ? undefined : start;
  }
  if (tail.includes("/>")) return undefined;
  return tail.includes("</tool_use>") ? undefined : start;
}

function findRawToolPrefixAtEnd(text: string): number | undefined {
  const lower = text.toLowerCase();
  for (const prefix of RAW_TOOL_PREFIXES) {
    if (lower.endsWith(prefix)) return text.length - prefix.length;
  }
  return undefined;
}

function stripLegacyFoldHints(text: string): string {
  if (!text) return text;
  const kept = text.split(/\r?\n/u).filter((line) => {
    const trimmed = line.replace(/^[-\s]+/u, "").trim();
    return !(
      trimmed === "输出已折叠，按 Ctrl+O 展开。" ||
      trimmed === "Output folded. Press Ctrl+O to expand." ||
      /^\[stdout\]\s*\.\.\.\s*(?:更多输出已隐藏；按 Ctrl\+O 展开。|more output hidden; press Ctrl\+O to expand\.)$/iu.test(
        trimmed,
      )
    );
  });
  return kept.join("\n").trim();
}

function createToolSummary(name: ToolName, output: ToolOutput, language: Language): string {
  const changed = output.changedFiles?.length ?? 0;
  if (language === "en-US") {
    const suffix = changed > 0 ? `; changed ${changed} file${changed === 1 ? "" : "s"}` : "";
    return `${name} completed${output.truncated ? " with truncated main output" : ""}${suffix}.`;
  }
  const suffix = changed > 0 ? `；改动 ${changed} 个文件` : "";
  return `${name} 已完成${output.truncated ? "，主输出已截断" : ""}${suffix}。`;
}

function sanitizeToolSummaryForPrimary(summary: string, language: Language): string {
  if (language === "en-US") {
    return summary
      .replace(/\bchangedFiles=(\d+)/gu, "changed files: $1")
      .replace(/\bcontentLines=(\d+)/gu, "content lines: $1")
      .replace(/\bselectedLines=(\d+)/gu, "selected lines: $1")
      .replace(/\bwindowLines=(\d+)/gu, "window lines: $1");
  }
  return summary
    .replace(/\bchangedFiles=(\d+)/gu, "改动文件：$1")
    .replace(/\bcontentLines=(\d+)/gu, "内容行数：$1")
    .replace(/\bselectedLines=(\d+)/gu, "选中行数：$1")
    .replace(/\bwindowLines=(\d+)/gu, "窗口行数：$1");
}

function createToolOutputPreview(
  name: ToolName,
  text: string,
  language: Language,
  output?: ToolOutput,
): { text: string; truncated: boolean } {
  const cleanedText = stripLegacyFoldHints(text);
  if (name === "Todo") {
    const structured = createTodoSurfacePreview(output, language);
    if (structured) return structured;

    const lines = cleanedText.split(/\r?\n/u);
    if (lines.length <= TODO_OUTPUT_ITEM_LIMIT) {
      return { text: cleanedText, truncated: false };
    }
    const remaining = lines.length - TODO_OUTPUT_ITEM_LIMIT;
    return {
      text: [
        ...lines.slice(0, TODO_OUTPUT_ITEM_LIMIT),
        language === "en-US"
          ? `... ${remaining} more todo item(s) hidden from main output.`
          : `... 主输出已隐藏 ${remaining} 条 Todo。`,
      ].join("\n"),
      truncated: true,
    };
  }

  if (isSummaryFirstTool(name)) {
    return createSummaryFirstPreview(name, cleanedText, language, output);
  }

  // Phase 18: try structured JSON unpack for MCP / non-built-in tool outputs.
  const unwrapped = tryUnwrapStructuredText(cleanedText);
  if (unwrapped) return { text: unwrapped, truncated: cleanedText.length > 2000 };

  return { text: cleanedText, truncated: false };
}

/**
 * Phase 18 — attempt to extract human-readable text from structured JSON
 * tool output. MCP tools often return JSON payloads wrapping a single
 * text/content/result field.
 */
function tryUnwrapStructuredText(text: string): string | undefined {
  if (text.length < 3) return undefined;
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const obj = parsed as Record<string, unknown>;
    // Single content/text/result field → unwrap.
    if (typeof obj.content === "string" && obj.content.length > 0) {
      return obj.content;
    }
    if (typeof obj.text === "string" && obj.text.length > 0) {
      return obj.text;
    }
    if (typeof obj.result === "string" && obj.result.length > 0) {
      return obj.result;
    }
    // Array of content items (e.g. [{type:"text", text:"hello"}])
    if (Array.isArray(obj.content) && obj.content.length > 0) {
      const parts = obj.content
        .filter(
          (item): item is Record<string, unknown> => typeof item === "object" && item !== null,
        )
        .map((item) =>
          typeof item.text === "string"
            ? item.text
            : typeof item.content === "string"
              ? item.content
              : "",
        )
        .filter(Boolean);
      if (parts.length > 0) return parts.join("\n");
    }
    // Fallback: pretty-print the JSON compact but readable.
    if (Object.keys(obj).length >= 2) {
      return JSON.stringify(obj, null, 2);
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Phase 18 — extract a short lead text from tool output for the summary line.
 * For JSON-structured outputs, unwrap to first line; for plain text, take
 * first 80 chars; returns undefined if no meaningful text found.
 */
function tryExtractLeadText(text: string): string | undefined {
  if (!text || text.length < 3) return undefined;
  const unwrapped = tryUnwrapStructuredText(text);
  const source = unwrapped ?? text;
  const firstLine = source.split("\n")[0]?.trim() ?? "";
  if (!firstLine) return undefined;
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
}

function createTodoSurfacePreview(
  output: ToolOutput | undefined,
  language: Language,
): { text: string; truncated: boolean } | undefined {
  const items = readTodoItems(output?.data);
  if (!items) return undefined;
  if (items.length === 0) {
    return {
      text: language === "en-US" ? "Todo: no active tasks." : "Todo：暂无任务。",
      truncated: false,
    };
  }
  const counts = {
    in_progress: items.filter((item) => item.status === "in_progress").length,
    pending: items.filter((item) => item.status === "pending").length,
    completed: items.filter((item) => item.status === "completed").length,
    blocked: items.filter((item) => item.status === "blocked").length,
  };
  // Main screen only shows in_progress and blocked items; completed goes to details.
  const activeItems = items.filter(
    (item) => item.status === "in_progress" || item.status === "blocked",
  );
  const parts =
    language === "en-US"
      ? [
          `${counts.in_progress} in progress`,
          `${counts.blocked} blocked`,
          `${counts.pending} pending`,
          `${counts.completed} done`,
        ]
      : [
          `进行中 ${counts.in_progress}`,
          `阻塞 ${counts.blocked}`,
          `待办 ${counts.pending}`,
          `完成 ${counts.completed}`,
        ];
  const lines = [
    language === "en-US" ? `Todo: ${parts.join(" · ")}` : `Todo：${parts.join(" · ")}`,
  ];
  // Show up to PRIMARY_PREVIEW_LINE_CAP - 1 active items (reserve 1 line for header).
  const displayItems = activeItems.slice(0, PRIMARY_PREVIEW_LINE_CAP - 1);
  for (const item of displayItems) {
    const label =
      language === "en-US"
        ? item.status.replace("_", " ")
        : item.status === "in_progress"
          ? "进行中"
          : "阻塞";
    lines.push(`  ${label}: ${item.content}`);
  }
  const hiddenCount = items.length - displayItems.length;
  if (hiddenCount > 0) {
    lines.push(
      language === "en-US"
        ? `... ${hiddenCount} more item(s) in details.`
        : `... 另有 ${hiddenCount} 项在详情中。`,
    );
  }
  return { text: lines.join("\n"), truncated: hiddenCount > 0 };
}

type TodoSurfaceItem = {
  content: string;
  status: "pending" | "in_progress" | "completed" | "blocked";
};

function readTodoItems(data: unknown): TodoSurfaceItem[] | undefined {
  if (!data || typeof data !== "object") return undefined;
  const items = (data as Record<string, unknown>).items;
  if (!Array.isArray(items)) return undefined;
  return items.filter((item): item is TodoSurfaceItem => {
    if (!item || typeof item !== "object") return false;
    const record = item as Record<string, unknown>;
    return (
      typeof record.content === "string" &&
      (record.status === "pending" ||
        record.status === "in_progress" ||
        record.status === "completed" ||
        record.status === "blocked")
    );
  });
}

function isSummaryFirstTool(name: ToolName): boolean {
  return (
    name === "Read" ||
    name === "ReadSnippets" ||
    name === "SourcePack" ||
    name === "Glob" ||
    name === "Grep" ||
    name === "Bash" ||
    name === "Write" ||
    name === "Edit" ||
    name === "MultiEdit"
  );
}

function createSummaryFirstPreview(
  name: ToolName,
  text: string,
  language: Language,
  output?: ToolOutput,
): { text: string; truncated: boolean } {
  const lines = text.length > 0 ? text.split(/\r?\n/u) : [];
  const metadata = output?.data && typeof output.data === "object" ? output.data : undefined;
  const count = readNumber(metadata, "count");
  const dataLines = readNumber(metadata, "lines");
  const windowLines = readNumber(metadata, "windowLines");
  const totalLines = readNumber(metadata, "totalLines");
  const contentLines = readNumber(metadata, "contentLines");
  const exitCode = readNumber(metadata, "exitCode");
  const stats = [
    formatToolLineStat(name, {
      language,
      visibleLines: dataLines ?? lines.length,
      windowLines,
      totalLines,
      contentLines,
      truncated: Boolean(output?.truncated),
    }),
  ];
  if (count !== undefined) {
    stats.push(language === "en-US" ? `${count} match(es)` : `${count} 条结果`);
  }
  // 退出码已移至 end summary，只在失败时显示，避免重复
  if (name === "Bash" && looksLikeMojibake(text)) {
    stats.push(language === "en-US" ? "possible encoding issue" : "疑似编码问题");
  }
  if (isEditingTool(name)) {
    const addedLines = readNumber(metadata, "addedLines") ?? 0;
    const removedLines = readNumber(metadata, "removedLines") ?? 0;
    const changedFiles = readStringList(metadata, "changedFiles");
    const readGuard = readStringValue(metadata, "readGuard");
    stats.push(
      language === "en-US"
        ? `patch +${addedLines} -${removedLines}`
        : `补丁 +${addedLines} -${removedLines}`,
    );
    if (changedFiles.length > 0) {
      stats.push(
        language === "en-US"
          ? `changed ${changedFiles.length} file${changedFiles.length === 1 ? "" : "s"}`
          : `改动文件 ${changedFiles.length}`,
      );
    }
    // readGuard status is shown in footer; omit from per-tool summary to reduce noise.
  }
  // Run 3 C — Ctrl+O 提示必须和真实可展开内容绑定。
  // 只有当原始输出确实有被隐藏的重要内容时才显示折叠提示。
  const hasHiddenContent =
    Boolean(output?.truncated) ||
    Boolean(output?.details) ||
    Boolean(output?.fullOutputPath) ||
    lines.length > 100 ||
    text.length > 10000;
  if (hasHiddenContent) {
    const tail = name === "Bash" && !looksLikeMojibake(text) ? formatBashTail(lines, language) : [];
    // Phase 3 — editing tools: inject compact diff fence from details so
    // MessageMarkdown → StructuredDiff renders a visual patch preview.
    const diffFence = isEditingTool(name) ? extractCompactDiffFence(output?.details) : "";
    return {
      text: [`- ${stats.join("; ")}`, ...tail, diffFence].filter(Boolean).join("\n"),
      truncated: true,
    };
  }
  if (name === "Bash" && !looksLikeMojibake(text)) {
    const tail = formatBashTail(lines, language);
    if (tail.length > 0) {
      return { text: [`- ${stats.join("; ")}`, ...tail].join("\n"), truncated: false };
    }
    // Cap inline Bash output to PRIMARY_PREVIEW_LINE_CAP lines; excess folds into details.
    if (text.trim().length > 0) {
      const nonEmpty = lines.filter((l) => l.trim().length > 0);
      if (nonEmpty.length > PRIMARY_PREVIEW_LINE_CAP) {
        const capped = nonEmpty.slice(0, PRIMARY_PREVIEW_LINE_CAP).join("\n");
        return {
          text: [`- ${stats.join("; ")}`, capped].join("\n"),
          truncated: true,
        };
      }
      return { text: [`- ${stats.join("; ")}`, text].join("\n"), truncated: false };
    }
  }
  return { text: `- ${stats.join("; ")}`, truncated: false };
}

function formatToolLineStat(
  name: ToolName,
  input: {
    language: Language;
    visibleLines: number;
    windowLines?: number;
    totalLines?: number;
    contentLines?: number;
    truncated: boolean;
  },
): string {
  if (name !== "Read" || input.totalLines === undefined) {
    return input.language === "en-US"
      ? `${input.visibleLines} line(s)`
      : `${input.visibleLines} 行`;
  }
  const windowLines = input.windowLines ?? input.visibleLines;
  const contentLines = input.contentLines ?? input.totalLines;
  if (input.truncated) {
    return input.language === "en-US"
      ? `window ${windowLines}/${input.totalLines} line(s); content ${contentLines} line(s)`
      : `窗口 ${windowLines}/${input.totalLines} 行；内容 ${contentLines} 行`;
  }
  return input.language === "en-US"
    ? `total ${input.totalLines} line(s); content ${contentLines} line(s)`
    : `总计 ${input.totalLines} 行；内容 ${contentLines} 行`;
}

function formatBashTail(lines: string[], language: Language): string[] {
  if (BASH_TAIL_LINE_LIMIT === 0) return [];
  const tail = lines
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .slice(-BASH_TAIL_LINE_LIMIT);
  if (tail.length === 0) return [];
  const title = language === "en-US" ? "tail:" : "尾部：";
  return [`- ${title}`, ...tail.map((line) => `  ${line}`)];
}

function readNumber(value: object | undefined, key: string): number | undefined {
  if (!value) return undefined;
  const item = (value as Record<string, unknown>)[key];
  return typeof item === "number" ? item : undefined;
}

function readStringValue(value: object | undefined, key: string): string | undefined {
  if (!value) return undefined;
  const item = (value as Record<string, unknown>)[key];
  return typeof item === "string" ? item : undefined;
}

function readStringList(value: object | undefined, key: string): string[] {
  if (!value) return [];
  const item = (value as Record<string, unknown>)[key];
  return Array.isArray(item)
    ? item.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function isEditingTool(name: ToolName): boolean {
  return name === "Write" || name === "Edit" || name === "MultiEdit";
}

/**
 * Phase 3 — extract the before/after changed-line sections from createPatchDetails()
 * output and wrap them in a ```diff fence so StructuredDiff renders automatically.
 * Caps at EDIT_DIFF_PREVIEW_LINES to keep primary output compact.
 */
const EDIT_DIFF_PREVIEW_LINES = 24;

function extractCompactDiffFence(details: string | undefined): string {
  if (!details) return "";
  // createPatchDetails format:
  //   --- before (first changed context)
  //   - line1
  //   - line2
  //   +++ after (first changed context)
  //   + line1
  //   + line2
  const beforeIdx = details.indexOf("--- before");
  const afterIdx = details.indexOf("+++ after");
  if (beforeIdx < 0 || afterIdx < 0) return "";

  const removedRaw = details
    .slice(beforeIdx, afterIdx)
    .split("\n")
    .slice(1) // skip header
    .filter((l) => l.startsWith("- ") || l.startsWith("-\t"));

  const addedRaw = details
    .slice(afterIdx)
    .split("\n")
    .slice(1) // skip header
    .filter((l) => l.startsWith("+ ") || l.startsWith("+\t"));

  if (removedRaw.length === 0 && addedRaw.length === 0) return "";

  // Build unified-style lines (without real @@ header, StructuredDiff handles bare +/- too)
  const diffLines: string[] = [];
  for (const line of removedRaw.slice(0, EDIT_DIFF_PREVIEW_LINES)) {
    diffLines.push(line); // already starts with "- "
  }
  for (const line of addedRaw.slice(0, EDIT_DIFF_PREVIEW_LINES - diffLines.length)) {
    diffLines.push(line); // already starts with "+ "
  }
  if (diffLines.length === 0) return "";

  return "```diff\n" + diffLines.join("\n") + "\n```";
}

function looksLikeMojibake(text: string): boolean {
  return /(?:�|Ã.|Â.|Ð.|Ñ.|Ž|¤|¦|µ|¥|¡|¿|乱码|mojibake)/u.test(text);
}
