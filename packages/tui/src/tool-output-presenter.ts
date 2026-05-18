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
const TOOL_OUTPUT_LINE_LIMIT = 80;
const TOOL_OUTPUT_CHAR_LIMIT = 6_000;
const BASH_OUTPUT_LINE_LIMIT = 20;
const BASH_OUTPUT_CHAR_LIMIT = 2_000;

export function createLayeredToolOutput(
  name: ToolName,
  output: ToolOutput,
  language: Language,
  evidenceId?: string,
): LayeredToolOutput {
  const preview = createToolOutputPreview(name, output.preview ?? output.text, language);
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
    language === "en-US" ? `Tool ${name} result:` : `工具 ${name} 结果：`,
    `- ${language === "en-US" ? "summary" : "摘要"}: ${layered.summary}`,
    layered.preview,
  ];
  if (layered.truncated) {
    lines.push(
      layered.fullOutputPath
        ? language === "en-US"
          ? `Full log: ${layered.fullOutputPath}`
          : `完整日志：${layered.fullOutputPath}`
        : language === "en-US"
          ? "Full result remains in the tool_result transcript/evidence record."
          : "完整结果仍保留在 tool_result transcript/evidence 记录中。",
    );
  }
  if (layered.evidenceId) {
    lines.push(
      language === "en-US" ? `Evidence: ${layered.evidenceId}` : `证据记录：${layered.evidenceId}`,
    );
  }
  return lines.join("\n");
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
): { text: string; truncated: boolean } {
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

  if (name === "Bash") {
    return truncatePreview(text, BASH_OUTPUT_LINE_LIMIT, BASH_OUTPUT_CHAR_LIMIT, language);
  }

  if (name !== "Read" && name !== "Grep" && name !== "Glob") {
    return { text, truncated: false };
  }

  return truncatePreview(text, TOOL_OUTPUT_LINE_LIMIT, TOOL_OUTPUT_CHAR_LIMIT, language);
}

function truncatePreview(
  text: string,
  lineLimit: number,
  charLimit: number,
  language: Language,
): { text: string; truncated: boolean } {
  const lines = text.split(/\r?\n/u);
  const byLine = lines.length > lineLimit;
  const byChar = text.length > charLimit;
  if (!byLine && !byChar) {
    return { text, truncated: false };
  }

  let preview = lines.slice(0, lineLimit).join("\n");
  if (preview.length > charLimit) {
    preview = preview.slice(0, charLimit);
  }
  const hiddenLines = Math.max(0, lines.length - preview.split(/\r?\n/u).length);
  const suffix =
    language === "en-US"
      ? `... output truncated in main view${hiddenLines > 0 ? `; ${hiddenLines} line(s) hidden` : ""}.`
      : `... 主输出已截断${hiddenLines > 0 ? `，隐藏 ${hiddenLines} 行` : ""}。`;
  return { text: `${preview}\n${suffix}`, truncated: true };
}
