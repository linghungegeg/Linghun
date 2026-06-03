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
const BASH_TAIL_LINE_LIMIT = 3;
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
    summary: output.summary ?? createToolSummary(name, output, language),
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
  const lines = [
    language === "en-US" ? `Tool ${name} completed` : `工具 ${name} 已完成`,
    `- ${language === "en-US" ? "summary" : "摘要"}: ${layered.summary}`,
  ];
  if (layered.preview) {
    lines.push(layered.preview);
  }
  // P1-1 — summary-first preview 已自带一行折叠提示（createSummaryFirstPreview）。
  // 这里只在 preview 尚未包含折叠提示时补一行，避免同一块出现两次 Ctrl+O 提示。
  if (layered.details || layered.truncated) {
    const hint = formatDetailsHint(language);
    if (!layered.preview || !layered.preview.includes(hint)) {
      lines.push(hint);
    }
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
  return language === "en-US" ? `Command exited ${exitCode}` : `命令已退出 ${exitCode}`;
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
  } else if (name === "Write" || name === "Edit" || name === "MultiEdit") {
    arg = str("file_path") ?? str("path");
  } else if (name === "Grep") {
    arg = str("pattern") ?? str("path");
  } else if (name === "Glob") {
    arg = str("pattern") ?? str("path");
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

function formatDetailsHint(language: Language): string {
  // D.13L Section 1 — 主屏只暴露 Ctrl+O 折叠提示，不再泄漏
  // `/details output <id>`。完整结果仍保存在 fullText / fullOutputPath 中，
  // 由 /details 命令或 Ctrl+O 展开访问。
  return language === "en-US"
    ? "Output folded. Press Ctrl+O to expand."
    : "输出已折叠，按 Ctrl+O 展开。";
}

function createToolSummary(name: ToolName, output: ToolOutput, language: Language): string {
  const changed = output.changedFiles?.length ?? 0;
  const suffix = changed > 0 ? `; changedFiles=${changed}` : "";
  if (language === "en-US") {
    return `${name} completed${output.truncated ? " with truncated main output" : ""}${suffix}.`;
  }
  return `${name} 已完成${output.truncated ? "，主输出已截断" : ""}${suffix}。`;
}

function createToolOutputPreview(
  name: ToolName,
  text: string,
  language: Language,
  output?: ToolOutput,
): { text: string; truncated: boolean } {
  if (isSummaryFirstTool(name)) {
    return createSummaryFirstPreview(name, text, language, output);
  }

  if (name === "Todo") {
    const lines = text.split(/\r?\n/u);
    if (lines.length <= TODO_OUTPUT_ITEM_LIMIT) {
      return { text, truncated: false };
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

  return { text, truncated: false };
}

function isSummaryFirstTool(name: ToolName): boolean {
  return (
    name === "Read" ||
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
  const exitCode = readNumber(metadata, "exitCode");
  const stats = [
    language === "en-US"
      ? `${dataLines ?? lines.length} line(s)`
      : `${dataLines ?? lines.length} 行`,
  ];
  if (count !== undefined) {
    stats.push(language === "en-US" ? `${count} match(es)` : `${count} 条结果`);
  }
  if (name === "Bash" && exitCode !== undefined) {
    stats.push(language === "en-US" ? `exit code ${exitCode}` : `退出码 ${exitCode}`);
    if (looksLikeMojibake(text)) {
      stats.push(language === "en-US" ? "possible encoding issue" : "疑似编码问题");
    }
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
          ? `changedFiles ${changedFiles.length}`
          : `changedFiles ${changedFiles.length}`,
      );
    }
    if (readGuard) {
      stats.push(language === "en-US" ? `read guard ${readGuard}` : `读取保护 ${readGuard}`);
    }
  }
  // Run 3 C — Ctrl+O 提示必须和真实可展开内容绑定。
  // 只有当原始输出确实有被隐藏的重要内容时才显示折叠提示。
  const hasHiddenContent =
    Boolean(output?.truncated) ||
    Boolean(output?.details) ||
    Boolean(output?.fullOutputPath) ||
    lines.length > 3 ||
    text.length > 200;
  if (hasHiddenContent) {
    const hint = formatDetailsHint(language);
    const tail = name === "Bash" && !looksLikeMojibake(text) ? formatBashTail(lines, language) : [];
    return { text: [`- ${stats.join("; ")}`, ...tail, `- ${hint}`].join("\n"), truncated: true };
  }
  return { text: `- ${stats.join("; ")}`, truncated: false };
}

function formatBashTail(lines: string[], language: Language): string[] {
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

function looksLikeMojibake(text: string): boolean {
  return /(?:�|Ã.|Â.|Ð.|Ñ.|Ž|¤|¦|µ|¥|¡|¿|乱码|mojibake)/u.test(text);
}
