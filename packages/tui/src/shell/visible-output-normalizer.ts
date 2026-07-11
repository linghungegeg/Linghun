const VISIBLE_TEXT_FIELDS = ["text", "content", "result", "details"] as const;
const TOOL_RESULT_ARTIFACT = /\.linghun[\\/]session[\\/]tool-results[\\/]/iu;
const ESCAPED_ANSI = /\\(?:u001b|x1b)/iu;
const ANSI_SEQUENCE = /\u001B\[[0-?]*[ -/]*m/gu;

export function normalizeVisibleToolText(text: string): string {
  if (!text) return text;

  const wholeJson = unwrapVisibleJson(text);
  const visibleText = wholeJson ?? text.split(/\r?\n/u).map(normalizeVisibleLine).join("\n");
  const wholeReporter = summarizeTestReporterJson(visibleText);
  const normalized =
    wholeReporter ?? visibleText.split(/\r?\n/u).map(normalizeTestReporterLine).join("\n");
  return stripExternalToolSgr(
    sanitizeDangerousTerminalControls(decodeEscapedTerminalText(normalized)),
  );
}

function normalizeVisibleLine(line: string): string {
  const jsonStart = line.indexOf("{");
  const jsonEnd = line.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd <= jsonStart) return line;

  const jsonText = line.slice(jsonStart, jsonEnd + 1);
  if (!TOOL_RESULT_ARTIFACT.test(line) && !ESCAPED_ANSI.test(jsonText)) return line;

  const unwrapped = unwrapVisibleJson(jsonText);
  if (unwrapped === undefined) return line;
  return `${line.slice(0, jsonStart)}${unwrapped}${line.slice(jsonEnd + 1)}`;
}

function unwrapVisibleJson(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return undefined;

  try {
    const parsed = JSON.parse(trimmed.replace(/\\x1b/giu, "\\u001b"));
    if (!isRecord(parsed)) return undefined;

    for (const field of VISIBLE_TEXT_FIELDS) {
      const value = parsed[field];
      if (typeof value === "string" && isVisibleTextWrapper(parsed, field, value, trimmed)) {
        return value;
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function isVisibleTextWrapper(
  parsed: Record<string, unknown>,
  field: (typeof VISIBLE_TEXT_FIELDS)[number],
  value: string,
  source: string,
): boolean {
  if (ESCAPED_ANSI.test(source) || ESCAPED_ANSI.test(value)) return true;
  const keys = Object.keys(parsed);
  if (keys.length === 1) return true;
  if (parsed.type === "text" && (field === "text" || field === "content")) return true;
  return keys.every((key) => VISIBLE_TEXT_FIELDS.includes(key as (typeof VISIBLE_TEXT_FIELDS)[number]));
}

function normalizeTestReporterLine(line: string): string {
  const wholeSummary = summarizeTestReporterJson(line);
  if (wholeSummary !== undefined) return wholeSummary;

  const jsonStart = line.indexOf("{");
  const jsonEnd = line.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd <= jsonStart) return line;

  const summary = summarizeTestReporterJson(line.slice(jsonStart, jsonEnd + 1));
  if (summary === undefined) return line;
  return `${line.slice(0, jsonStart)}${summary}${line.slice(jsonEnd + 1)}`;
}

function summarizeTestReporterJson(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return undefined;

  try {
    const parsed = JSON.parse(trimmed);
    if (!isTestReporterResult(parsed)) return undefined;

    const passed = parsed.numPassedTests;
    const failed = parsed.numFailedTests;
    const skipped = parsed.numPendingTests + parsed.numTodoTests;
    const total = parsed.numTotalTests;
    const accounted = Math.min(total, passed + failed + skipped);
    const ratio = total === 0 ? 1 : accounted / total;
    const progress = formatProgressBar(ratio);
    const skippedStat = skipped > 0 ? ` · ○ ${skipped}` : "";
    return `Tests ${progress} ${accounted}/${total} · ✓ ${passed} · ✗ ${failed}${skippedStat}`;
  } catch {
    return undefined;
  }
}

function isTestReporterResult(value: unknown): value is {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests: number;
  numTodoTests: number;
  testResults: unknown[];
} {
  if (!isRecord(value) || !Array.isArray(value.testResults)) return false;
  return [
    value.numTotalTests,
    value.numPassedTests,
    value.numFailedTests,
    value.numPendingTests,
    value.numTodoTests,
  ].every(isNonNegativeInteger);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function formatProgressBar(ratio: number, width = 10): string {
  const filled = Math.round(Math.max(0, Math.min(1, ratio)) * width);
  return `[${"█".repeat(filled)}${"─".repeat(width - filled)}]`;
}

function decodeEscapedTerminalText(text: string): string {
  if (!ESCAPED_ANSI.test(text)) return text;
  return text
    .replace(/\\u001b/giu, "\u001B")
    .replace(/\\x1b/giu, "\u001B")
    .replace(/\\r\\n/gu, "\n")
    .replace(/\\n/gu, "\n")
    .replace(/\\r/gu, "\r");
}

function stripExternalToolSgr(text: string): string {
  return text.replace(ANSI_SEQUENCE, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
import { sanitizeDangerousTerminalControls } from "../startup-runtime.js";

export { sanitizeDangerousTerminalControls } from "../startup-runtime.js";
