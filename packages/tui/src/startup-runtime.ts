/**
 * startup-runtime.ts — Pure startup/runtime shell helpers extracted from index.ts.
 *
 * Contains:
 * - Basic IO helpers (writeLine, readOutputColumns, readOutputRows)
 * - stdin/TTY runtime (readInputLines, InputKeyHandlers, toInputBuffer, decodeInput)
 * - TTY detection (shouldEnterProductShellCandidate)
 * - Display utilities (truncateDisplay, stripAnsi, uniqueStrings)
 * - Error formatting (formatError, sanitizeUserFacingError, sanitizeDiagnosticText)
 * - Startup warning formatters (formatProviderEnvWarning, formatProjectRouteProblem,
 *   formatUserScopedSetupNeeded, createShellLimitations)
 *
 * Hard boundary: no sendMessage, no provider stream loop, no permission continuation,
 * no tool continuation, no durable job state machine, no TuiContext deep coupling.
 */

import { homedir } from "node:os";
import { basename, relative } from "node:path";
import { clearLine, cursorTo, emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";
import type { Language } from "@linghun/shared";

// ---------------------------------------------------------------------------
// Basic IO helpers
// ---------------------------------------------------------------------------

export function writeLine(output: Writable, text: string): void {
  try {
    output.write(`${text}\n`);
  } catch (error) {
    if (isBenignWriteError(error)) {
      return;
    }
    throw error;
  }
}

function isBenignWriteError(error: unknown): boolean {
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  return (
    code === "EPIPE" || code === "ERR_STREAM_DESTROYED" || code === "ERR_STREAM_WRITE_AFTER_END"
  );
}

export function readOutputColumns(output: Writable): number {
  const columns = (output as { columns?: number }).columns;
  return typeof columns === "number" && Number.isFinite(columns) ? columns : 80;
}

export function readOutputRows(output: Writable): number {
  const rows = (output as { rows?: number }).rows;
  return typeof rows === "number" && Number.isFinite(rows) ? rows : 24;
}

// ---------------------------------------------------------------------------
// Display utilities
// ---------------------------------------------------------------------------

import { charWidth } from "./shell/text-utils.js";

export function truncateDisplay(text: string, maxWidth: number): string {
  let width = 0;
  let result = "";
  for (const char of stripAnsi(text)) {
    const cw = charWidth(char);
    if (width + cw > maxWidth) {
      return `${result}…`;
    }
    width += cw;
    result += char;
  }
  return result;
}

export function stripAnsi(text: string): string {
  const escapeChar = String.fromCharCode(27);
  return text.replace(new RegExp(`${escapeChar}\\[[0-9;]*m`, "g"), "");
}

export function uniqueStrings(items: string[]): string[] {
  return [...new Set(items)];
}

// ---------------------------------------------------------------------------
// Error formatting
// ---------------------------------------------------------------------------

export function sanitizeDiagnosticText(text: string): string {
  return text
    .replace(/prompt=[^\s&]+/giu, "prompt=***")
    .replace(/api[_-]?key=[^\s&]+/giu, "api_key=***")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/giu, "Bearer ***")
    .replace(/sk-[A-Za-z0-9_-]+/gu, "sk-***");
}

export function formatDisplayPath(path: string | undefined, projectPath?: string): string {
  if (!path) return "-";
  const normalized = path.replaceAll("\\", "/");
  if (!isAbsoluteDisplayPath(normalized)) {
    return normalized;
  }
  const project = projectPath?.replaceAll("\\", "/").replace(/\/+$/u, "");
  if (project && (normalized === project || normalized.startsWith(`${project}/`))) {
    const rel = relative(projectPath ?? "", path).replaceAll("\\", "/");
    return rel && rel !== "" ? rel : ".";
  }
  const home = homedir().replaceAll("\\", "/").replace(/\/+$/u, "");
  if (home && (normalized === home || normalized.startsWith(`${home}/`))) {
    return `[user-home]/.../${basename(path)}`;
  }
  return `[local-path]/${basename(path)}`;
}

function isAbsoluteDisplayPath(path: string): boolean {
  return /^[A-Za-z]:\//u.test(path) || path.startsWith("/");
}

export function sanitizeDisplayPaths(text: string, projectPath?: string): string {
  let output = text;
  const protectedSegments: string[] = [];
  const protectSegment = (match: string): string => {
    const token = `__LINGHUN_DISPLAY_PATH_PROTECTED_${protectedSegments.length}__`;
    protectedSegments.push(match);
    return token;
  };

  output = output
    .replace(/\bhttps?:\/\/[^\r\n\s"'<>{}]+/giu, protectSegment)
    .replace(/\bendpointPath=\/[^\r\n\s"'<>{}]+/giu, protectSegment)
    .replace(/\bendpoint\s+path\s+\/[^\r\n\s"'<>{}]+/giu, protectSegment);

  if (projectPath) {
    const normalizedProject = createFlexiblePathPattern(projectPath);
    output = output.replace(new RegExp(`${normalizedProject}[^\r\n\\s"'<>{}]*`, "giu"), (match) =>
      formatDisplayPath(match, projectPath),
    );
  }
  const home = createFlexiblePathPattern(homedir());
  output = output.replace(new RegExp(`${home}[^\r\n\\s"'<>{}]*`, "giu"), (match) =>
    formatDisplayPath(match, projectPath),
  );
  output = output.replace(/[A-Za-z]:[\\/][^\r\n\s"'<>{}]+/gu, (match) =>
    formatDisplayPath(match, projectPath),
  );
  output = output.replace(
    /(^|[\s([{:=,])((?:\/[^\r\n\s"'<>{}/]+){2,})/gu,
    (_match, prefix: string, path: string) => `${prefix}${formatDisplayPath(path, projectPath)}`,
  );
  protectedSegments.forEach((segment, index) => {
    output = output.replaceAll(`__LINGHUN_DISPLAY_PATH_PROTECTED_${index}__`, segment);
  });
  return output;
}

function createFlexiblePathPattern(path: string): string {
  return escapeRegExp(path.replaceAll("\\", "/").replace(/\/+$/u, "")).replaceAll("/", "[\\\\/]");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function sanitizeUserFacingError(value: string): string {
  return sanitizeDiagnosticText(value)
    .replace(/gateId=[^\s,;]+/giu, "gateId=***")
    .replace(/request[_-]?id=[^\s,;]+/giu, "requestId=***")
    .replace(/token=[^\s&]+/giu, "token=***")
    .replace(/Authorization:\s*[^\s]+/giu, "Authorization: ***");
}

export function formatError(error: unknown, language: Language = "zh-CN"): string {
  const rawMessage =
    error instanceof Error ? error.message : language === "en-US" ? "unknown error" : "未知错误";
  const message = sanitizeUserFacingError(rawMessage);
  const suggestion =
    error instanceof Error && "suggestion" in error && typeof error.suggestion === "string"
      ? sanitizeUserFacingError(error.suggestion)
      : language === "en-US"
        ? "open the related details/debug command if you need the full trace"
        : "如需完整 trace，请打开对应 details/debug 入口";
  if (language === "en-US") {
    return [
      "Something went wrong.",
      `- what happened: ${message}`,
      "- impact: the current action did not complete.",
      `- next: ${suggestion}`,
      "- details: use the related /details or doctor command for the full record.",
    ].join("\n");
  }
  return [
    "出错了。",
    `- 发生了什么：${message}`,
    "- 影响范围：当前操作未完成。",
    `- 下一步：${suggestion}`,
    "- 详情：用对应 /details 或 doctor 命令查看完整记录。",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// TTY detection
// ---------------------------------------------------------------------------

export function shouldEnterProductShellCandidate(input: Readable, output: Writable): boolean {
  if (process.env.LINGHUN_TUI_PLAIN === "1") return false;
  if (process.env.TERM === "dumb") return false;
  return (
    (input as { isTTY?: boolean }).isTTY === true && (output as { isTTY?: boolean }).isTTY === true
  );
}

// ---------------------------------------------------------------------------
// Startup warning formatters
// ---------------------------------------------------------------------------

export function formatProviderEnvWarning(reason: string, language: Language): string {
  return language === "en-US"
    ? `provider.env could not be read: ${reason}. Fix it and restart Linghun, or run /model setup to reconfigure the user provider.`
    : `provider.env 读取失败：${reason}。请修正后重启 Linghun，或运行 /model setup 重新配置本机用户 provider。`;
}

export function formatProjectRouteProblem(problem: string, language: Language): string {
  return language === "en-US"
    ? [
        "Project model route needs attention.",
        `- ${problem}`,
        "- This is a project-scoped route/settings issue, not a reason to re-enter your user API key.",
        "- Check /model doctor or update this repo's .linghun/settings.json route/model settings.",
      ].join("\n")
    : [
        "项目模型路由需要处理。",
        `- ${problem}`,
        "- 这是当前项目的 route/settings 问题，不是让你重复填写本机用户 API key。",
        "- 可用 /model doctor 检查，或调整本仓库 .linghun/settings.json 里的 route/model 配置。",
      ].join("\n");
}

export function formatUserScopedSetupNeeded(providerEnvPath: string, language: Language): string {
  return language === "en-US"
    ? [
        "Model setup needed: one-time setup for this computer.",
        "- This saves provider settings in your user config, not in this repository.",
        "- After saving once, other repositories will reuse the same user provider.env by default.",
        '- Say "configure provider" or press Enter to start; /model setup remains the advanced recovery entry.',
        `- User provider.env path: ${providerEnvPath}`,
      ].join("\n")
    : [
        "需要配置模型：这是本机一次配置，不是当前仓库配置。",
        "- 配置会保存到本机用户目录，不会写入这个仓库。",
        "- 配置一次后，之后进入其他仓库也会默认复用同一个用户 provider.env。",
        "- 可以直接说\u201c我要配置模型\u201d或按 Enter 开始；/model setup 保留为高级/恢复入口。",
        `- 用户 provider.env 位置：${providerEnvPath}`,
      ].join("\n");
}

export type ShellLimitationsInput = {
  language: Language;
  providerEnvWarning?: string;
};

export function createShellLimitations(input: ShellLimitationsInput): string[] {
  const limitations: string[] = [];
  if (input.providerEnvWarning) {
    limitations.push(
      input.language === "en-US"
        ? "Provider env could not be read; run /model setup or /model doctor."
        : "provider.env 读取失败；可用 /model setup 或 /model doctor 处理。",
    );
  }
  if (process.env.NO_COLOR === "1" || process.env.FORCE_COLOR === "0") {
    limitations.push(
      input.language === "en-US" ? "No-color mode is active." : "当前为无颜色模式。",
    );
  }
  return limitations;
}

// ---------------------------------------------------------------------------
// stdin/TTY runtime
// ---------------------------------------------------------------------------

export type InputKeyHandlers = {
  prompt?: string;
  onEsc?: () => void | Promise<void>;
  onEnter?: () => void | Promise<void>;
  onShiftTab?: () => void | Promise<void>;
  shouldMaskInput?: () => boolean;
};

export async function* readInputLines(
  input: Readable,
  output: Writable,
  keyHandlers: InputKeyHandlers = {},
): AsyncGenerator<string> {
  if ((input as { isTTY?: boolean }).isTTY !== true) {
    const chunks: Buffer[] = [];
    for await (const chunk of input) {
      chunks.push(toInputBuffer(chunk));
    }
    const text = decodeInput(Buffer.concat(chunks));
    for (const line of text.split(/\r?\n/)) {
      yield line;
    }
    return;
  }

  if ("setEncoding" in input && typeof input.setEncoding === "function") {
    input.setEncoding("utf8");
  }

  const rawInput = input as Readable & { setRawMode?: (enabled: boolean) => void; isRaw?: boolean };
  const wasRaw = rawInput.isRaw === true;
  if (typeof rawInput.setRawMode === "function") {
    rawInput.setRawMode(true);
  }

  const rl = createInterface({ input, output });
  const cleanupKeypress = installInputKeyHandlers(input, output, rl, keyHandlers);
  const prompt = keyHandlers.prompt ?? "你> ";
  let skipNextEmptyLine = false;
  try {
    output.write(prompt);
    for await (const line of rl) {
      if (skipNextEmptyLine && line.trim() === "") {
        skipNextEmptyLine = false;
        output.write(prompt);
        continue;
      }
      yield line;
      output.write(prompt);
    }
  } finally {
    cleanupKeypress();
    if (typeof rawInput.setRawMode === "function" && !wasRaw) {
      rawInput.setRawMode(false);
    }
    rl.close();
  }

  function installInputKeyHandlers(
    target: Readable,
    out: Writable,
    readline: { line?: string },
    handlers: InputKeyHandlers,
  ): () => void {
    if (!handlers.onEsc && !handlers.onEnter && !handlers.onShiftTab) {
      return () => undefined;
    }
    const onKeypress = (_str: string, key: { name?: string; shift?: boolean } = {}) => {
      if (key.name === "escape" && handlers.onEsc) {
        void handlers.onEsc();
        return;
      }
      if (key.name === "tab" && key.shift && handlers.onShiftTab) {
        void handlers.onShiftTab();
        return;
      }
      if (handlers.shouldMaskInput?.()) {
        const currentLine = (readline as unknown as { line?: string }).line ?? "";
        clearLine(out, 0);
        cursorTo(out, 0);
        out.write(`${prompt}${"*".repeat(currentLine.length)}`);
      }
      if (key.name === "return" && handlers.onEnter) {
        const currentLine = (readline as unknown as { line?: string }).line ?? "";
        if (currentLine.trim() === "") {
          skipNextEmptyLine = true;
          void handlers.onEnter();
        }
      }
    };
    emitKeypressEvents(target);
    target.on("keypress", onKeypress);
    return () => target.off("keypress", onKeypress);
  }
}

export function toInputBuffer(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) {
    return chunk;
  }
  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk);
  }
  return Buffer.from(String(chunk), "utf8");
}

export function decodeInput(bytes: Buffer): string {
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (!utf8.includes("�")) {
    return utf8;
  }
  return new TextDecoder("gb18030", { fatal: false }).decode(bytes);
}
