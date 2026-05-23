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
  if (layered.details || layered.truncated) {
    lines.push(formatDetailsHint(language));
  }
  return lines.join("\n");
}

function formatDetailsHint(language: Language): string {
  return language === "en-US"
    ? "Details: use /details output <id> for the full result, or /details for recent items."
    : "详情：用 /details output <id> 查看完整结果，或用 /details 查看最近条目。";
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
  const hint =
    language === "en-US"
      ? "Output summarized; use /details output <id> for the full result."
      : "输出已摘要；完整结果可通过 /details output <id> 查看。";
  return { text: `- ${stats.join("; ")}\n- ${hint}`, truncated: true };
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
