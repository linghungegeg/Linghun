import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { createInterface } from "node:readline";
import { isPathInside, normalizePathSeparators } from "@linghun/shared";

export type LogArtifactSource = {
  backgroundId?: string;
  evidenceId?: string;
  path?: string;
};

export type LogArtifactMode = "tail" | "grep" | "errors";

export type LogArtifactSlice = {
  sourcePath: string;
  mode: LogArtifactMode;
  byteRange?: { start: number; end: number };
  lineRange?: { start?: number; end?: number };
  truncated: boolean;
  matches?: Array<{ line: number; text: string }>;
  content: string;
  warnings?: string[];
};

export type LogArtifactRequest = {
  mode: LogArtifactMode;
  lines?: number;
  pattern?: string;
  contextLines?: number;
  maxBytes?: number;
  maxLines?: number;
  maxMatches?: number;
  timeoutMs?: number;
};

export type LogArtifactRegistry = {
  workspaceRoot: string;
  logRoots?: string[];
  backgrounds?: Array<{ id: string; outputPath?: string; logPath?: string }>;
  evidence?: Array<{
    id: string;
    source?: string;
    fullOutputPath?: string;
    outputPath?: string;
    logPath?: string;
    integrity?: { bytes: number; sha256: string };
  }>;
};

const DEFAULT_TAIL_LINES = 40;
const MAX_TAIL_LINES = 200;
const DEFAULT_MAX_BYTES = 64 * 1024;
const DEFAULT_SCAN_BYTES = 1024 * 1024;
const DEFAULT_MAX_MATCHES = 20;
const DEFAULT_MAX_OUTPUT_LINES = 200;
const DEFAULT_TIMEOUT_MS = 2_000;
const MAX_CONTEXT_LINES = 5;
const UTF8_BOUNDARY_PADDING_BYTES = 4;
const MAX_EXACT_LINE_PREFIX_BYTES = 256 * 1024;
const RELATIVE_LINE_NUMBER_WARNING =
  "Line numbers are relative to the bounded scan window; exact prefix scan was skipped for performance.";
const COMPLETE_ARTIFACT_WITHHELD_WARNING =
  "Complete artifact withheld; showing a bounded slice only.";
const ERROR_CANDIDATE_PATTERN =
  /\b(error|failed|exception|panic|fatal)\b|traceback|AssertionError|TypeError|SyntaxError|\bFAIL(?:ED)?\b|TS\d{4}|exitCode=[1-9]\d*|exit code [1-9]\d*|non-zero|command failed/iu;

export async function readLogArtifactSlice(
  source: LogArtifactSource,
  request: LogArtifactRequest,
  registry: LogArtifactRegistry,
): Promise<LogArtifactSlice> {
  const sourcePath = await resolveLogArtifactPath(source, registry);
  const info = await stat(sourcePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      throw new Error(`日志 artifact 不存在：${sourcePath}。请确认任务已产生输出。`);
    }
    throw error;
  });
  if (!info.isFile()) {
    throw new Error(`日志 artifact 不是文件：${sourcePath}。`);
  }
  await verifyEvidenceArtifactIntegrity(source, sourcePath, info.size, registry);

  if (request.mode === "tail") {
    return readTail(sourcePath, info.size, request);
  }
  if (request.mode === "grep") {
    return readGrep(sourcePath, info.size, request, compileUserPattern(request.pattern));
  }
  return readErrors(sourcePath, info.size, request);
}

async function verifyEvidenceArtifactIntegrity(
  source: LogArtifactSource,
  sourcePath: string,
  actualBytes: number,
  registry: LogArtifactRegistry,
): Promise<void> {
  if (!source.evidenceId) return;
  const evidence = registry.evidence?.find(
    (item) => item.id === source.evidenceId || item.id.endsWith(source.evidenceId ?? ""),
  );
  const integrity = evidence?.integrity;
  if (!integrity) return;
  if (actualBytes !== integrity.bytes) {
    throw new Error("Evidence artifact integrity check failed: size mismatch; artifact may be stale or changed.");
  }
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(sourcePath)) hash.update(chunk);
  if (hash.digest("hex") !== integrity.sha256) {
    throw new Error("Evidence artifact integrity check failed: SHA256 mismatch; artifact may be stale or changed.");
  }
}

export function formatLogArtifactSlice(
  slice: LogArtifactSlice,
  language: "zh-CN" | "en-US",
): string {
  const title =
    language === "en-US" ? `Log artifact ${slice.mode}` : `Log artifact ${slice.mode} 切片`;
  const lines = [
    title,
    `- sourcePath: ${formatDisplaySourcePath(slice.sourcePath)}`,
    `- mode: ${slice.mode}`,
    `- range: ${formatRange(slice)}`,
    `- truncated: ${slice.truncated ? "true" : "false"}`,
  ];
  if (slice.matches) {
    lines.push(`- matches: ${slice.matches.length}`);
  }
  if (slice.warnings?.length) {
    for (const warning of slice.warnings) {
      lines.push(`- warning: ${warning}`);
    }
  }
  lines.push(
    language === "en-US"
      ? "- boundary: bounded read only; full log was not inserted into the main screen, prompt, memory, or handoff."
      : "- boundary: 仅有界读取；完整日志不会进入主屏、prompt、memory 或 handoff。",
  );
  if (slice.content.trim()) {
    lines.push("", slice.content);
  } else {
    lines.push("", language === "en-US" ? "No matching log content." : "未找到匹配日志内容。");
  }
  return lines.join("\n");
}

async function resolveLogArtifactPath(
  source: LogArtifactSource,
  registry: LogArtifactRegistry,
): Promise<string> {
  if (source.backgroundId) {
    const background = registry.backgrounds?.find(
      (item) => item.id === source.backgroundId || item.id.endsWith(source.backgroundId ?? ""),
    );
    if (!background) {
      throw new Error(`未找到 background：${source.backgroundId}。请用 /background 查看可用任务。`);
    }
    const candidate = background.outputPath ?? background.logPath;
    if (!candidate) {
      throw new Error(`Background ${background.id} 尚无 log/output artifact。`);
    }
    return ensureAllowedPath(candidate, registry);
  }

  if (source.evidenceId) {
    const evidence = registry.evidence?.find(
      (item) => item.id === source.evidenceId || item.id.endsWith(source.evidenceId ?? ""),
    );
    if (!evidence) {
      throw new Error(
        `未找到 evidence：${source.evidenceId}。请用 /details evidence 查看可用证据。`,
      );
    }
    const explicitArtifact = evidence.fullOutputPath ?? evidence.outputPath ?? evidence.logPath;
    if (explicitArtifact) {
      return ensureAllowedPath(explicitArtifact, registry);
    }
    if (!evidence.source) {
      throw new Error(`Evidence ${evidence.id} 尚无 source artifact。`);
    }
    return ensureEvidenceSourceArtifactPath(evidence.source, registry);
  }

  if (source.path) {
    return ensureAllowedPath(source.path, registry);
  }

  throw new Error("缺少 log artifact source：需要 backgroundId、evidenceId 或 path。");
}

async function ensureAllowedPath(path: string, registry: LogArtifactRegistry): Promise<string> {
  const resolved = resolve(registry.workspaceRoot, path);
  const roots = [registry.workspaceRoot, ...(registry.logRoots ?? [])].map((root) => resolve(root));
  if (!roots.some((root) => isPathInside(resolved, root))) {
    throw new Error("拒绝读取日志 artifact：路径不在 workspace 或已知 log root 内。");
  }
  const realResolved = await realpath(resolved).catch(() => resolved);
  const realRoots = await Promise.all(roots.map((root) => realpath(root).catch(() => root)));
  if (!realRoots.some((root) => isPathInside(realResolved, root))) {
    throw new Error("拒绝读取日志 artifact：路径不在 workspace 或已知 log root 内。");
  }
  return realResolved;
}

async function ensureEvidenceSourceArtifactPath(
  path: string,
  registry: LogArtifactRegistry,
): Promise<string> {
  const resolved = await ensureAllowedPath(path, registry);
  const logRoots = (
    registry.logRoots?.length
      ? registry.logRoots
      : [resolve(registry.workspaceRoot, ".linghun", "logs")]
  ).map((root) => resolve(root));
  const realLogRoots = await Promise.all(logRoots.map((root) => realpath(root).catch(() => root)));
  if (realLogRoots.some((root) => isPathInside(resolved, root))) {
    return resolved;
  }
  throw new Error(
    "Evidence source 不是 log/output artifact：请用 Read 或其他合适工具查看普通 workspace 文件。",
  );
}

async function readTail(
  sourcePath: string,
  fileSize: number,
  request: LogArtifactRequest,
): Promise<LogArtifactSlice> {
  const maxBytes = clampPositive(request.maxBytes, DEFAULT_MAX_BYTES, DEFAULT_MAX_BYTES);
  const lines = clampPositive(request.lines, DEFAULT_TAIL_LINES, MAX_TAIL_LINES);
  const readStart = Math.max(0, fileSize - maxBytes - UTF8_BOUNDARY_PADDING_BYTES);
  const readLength = Math.max(0, fileSize - readStart);
  const buffer = Buffer.alloc(readLength);
  const file = await open(sourcePath, "r");
  try {
    await file.read(buffer, 0, readLength, readStart);
  } finally {
    await file.close();
  }
  const decoded = buffer.toString("utf8");
  const allLines = decoded.split(/\r?\n/u);
  const usableLines = readStart > 0 ? allLines.slice(1) : allLines;
  const selected = preventCompleteLineDump(usableLines.slice(-lines), usableLines.length);
  const truncated = readStart > 0 || usableLines.length > selected.lines.length;
  const numbering = await resolveLineNumberOffset(sourcePath, readStart);
  const firstUsableLine = readStart > 0 ? numbering.countBeforeStart + 2 : 1;
  const tailStartLine = firstUsableLine + Math.max(0, usableLines.length - lines);
  const selectedStartLine =
    selected.lines.length > 0 ? tailStartLine + (selected.withheld ? 1 : 0) : undefined;
  const selectedEndLine =
    selectedStartLine === undefined ? undefined : selectedStartLine + selected.lines.length - 1;
  const warnings = [
    ...(selected.withheld ? [COMPLETE_ARTIFACT_WITHHELD_WARNING] : []),
    ...(truncated ? ["Output capped; increase --tail lines only when necessary."] : []),
    ...(!numbering.exact ? [RELATIVE_LINE_NUMBER_WARNING] : []),
  ];
  return {
    sourcePath,
    mode: "tail",
    byteRange: { start: readStart, end: fileSize },
    lineRange: { start: selectedStartLine, end: selectedEndLine },
    truncated,
    content: redactLogContent(selected.lines.join("\n")),
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

async function readGrep(
  sourcePath: string,
  fileSize: number,
  request: LogArtifactRequest,
  pattern: RegExp,
): Promise<LogArtifactSlice> {
  const maxBytes = clampPositive(request.maxBytes, DEFAULT_SCAN_BYTES, DEFAULT_SCAN_BYTES);
  const maxMatches = clampPositive(request.maxMatches, DEFAULT_MAX_MATCHES, DEFAULT_MAX_MATCHES);
  const maxOutputLines = clampPositive(
    request.maxLines,
    DEFAULT_MAX_OUTPUT_LINES,
    DEFAULT_MAX_OUTPUT_LINES,
  );
  const timeoutMs = clampPositive(request.timeoutMs, DEFAULT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const startedAt = Date.now();
  const contextLines = Math.min(
    clampPositive(request.contextLines, 0, MAX_CONTEXT_LINES),
    MAX_CONTEXT_LINES,
  );
  const readStart = Math.max(0, fileSize - maxBytes - UTF8_BOUNDARY_PADDING_BYTES);
  const numbering = await resolveLineNumberOffset(sourcePath, readStart);
  let lineNumber = numbering.countBeforeStart;
  const stream = createReadStream(sourcePath, { encoding: "utf8", start: readStart });
  const reader = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
  const before: Array<{ line: number; text: string }> = [];
  const outputLines: Array<{ line: number; text: string }> = [];
  const emitted = new Set<number>();
  const matches: Array<{ line: number; text: string }> = [];
  let skippedPartialLine = readStart === 0;
  let afterRemaining = 0;
  let truncated = fileSize > maxBytes;

  for await (const line of reader) {
    if (Date.now() - startedAt > timeoutMs) {
      truncated = true;
      break;
    }
    if (!skippedPartialLine) {
      skippedPartialLine = true;
      lineNumber += 1;
      continue;
    }
    lineNumber += 1;
    if (pattern.test(line)) {
      matches.push({ line: lineNumber, text: redactLogContent(line) });
      for (const item of before) {
        pushLine(outputLines, emitted, item);
      }
      pushLine(outputLines, emitted, { line: lineNumber, text: line });
      afterRemaining = contextLines;
      if (matches.length >= maxMatches || outputLines.length >= maxOutputLines) {
        truncated = true;
        break;
      }
      continue;
    }
    if (afterRemaining > 0) {
      pushLine(outputLines, emitted, { line: lineNumber, text: line });
      afterRemaining -= 1;
      if (outputLines.length >= maxOutputLines) {
        truncated = true;
        break;
      }
    }
    before.push({ line: lineNumber, text: line });
    if (before.length > contextLines) {
      before.shift();
    }
  }
  reader.close();
  stream.destroy();

  const selected = preventCompleteNumberedLineDump(
    outputLines,
    lineNumber,
    truncated,
    new Set(matches.map((match) => match.line)),
  );
  const warnings = [
    ...(selected.withheld ? [COMPLETE_ARTIFACT_WITHHELD_WARNING] : []),
    ...(truncated
      ? ["Output capped; narrow the pattern or inspect a smaller artifact slice."]
      : []),
    ...(!numbering.exact ? [RELATIVE_LINE_NUMBER_WARNING] : []),
    ...(matches.length === 0 ? ["No matches found in the bounded scan window."] : []),
  ];

  return {
    sourcePath,
    mode: "grep",
    byteRange: { start: readStart, end: fileSize },
    lineRange: { start: selected.lines[0]?.line, end: selected.lines.at(-1)?.line },
    truncated: truncated || selected.withheld,
    matches,
    content: formatNumberedLines(selected.lines),
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

async function readErrors(
  sourcePath: string,
  fileSize: number,
  request: LogArtifactRequest,
): Promise<LogArtifactSlice> {
  const slice = await readGrep(
    sourcePath,
    fileSize,
    { ...request, contextLines: request.contextLines ?? 2 },
    ERROR_CANDIDATE_PATTERN,
  );
  return {
    ...slice,
    mode: "errors",
    warnings: [
      "Error candidates are diagnostic slices only; they do not change verification PASS/PARTIAL/FAIL semantics or identify root cause.",
      ...(slice.warnings ?? []),
    ],
  };
}

function pushLine(
  outputLines: Array<{ line: number; text: string }>,
  emitted: Set<number>,
  item: { line: number; text: string },
): void {
  if (emitted.has(item.line)) {
    return;
  }
  emitted.add(item.line);
  outputLines.push({ line: item.line, text: redactLogContent(item.text) });
}

async function resolveLineNumberOffset(
  sourcePath: string,
  offset: number,
): Promise<{ countBeforeStart: number; exact: boolean }> {
  if (offset <= 0) {
    return { countBeforeStart: 0, exact: true };
  }
  if (offset > MAX_EXACT_LINE_PREFIX_BYTES) {
    return { countBeforeStart: 0, exact: false };
  }
  return { countBeforeStart: await countLineBreaksBeforeOffset(sourcePath, offset), exact: true };
}

async function countLineBreaksBeforeOffset(sourcePath: string, offset: number): Promise<number> {
  return new Promise((resolveCount, reject) => {
    let count = 0;
    const stream = createReadStream(sourcePath, { start: 0, end: offset - 1 });
    stream.on("data", (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      for (const byte of buffer) {
        if (byte === 10) {
          count += 1;
        }
      }
    });
    stream.on("error", reject);
    stream.on("end", () => resolveCount(count));
  });
}

function preventCompleteLineDump(
  lines: string[],
  totalLinesInWindow: number,
): { lines: string[]; withheld: boolean } {
  if (lines.length === 0 || lines.length < totalLinesInWindow) {
    return { lines, withheld: false };
  }
  if (lines.length === 1) {
    return { lines: [], withheld: true };
  }
  return { lines: lines.slice(1), withheld: true };
}

function preventCompleteNumberedLineDump(
  lines: Array<{ line: number; text: string }>,
  scannedLines: number,
  alreadyTruncated: boolean,
  matchLineNumbers: Set<number>,
): { lines: Array<{ line: number; text: string }>; withheld: boolean } {
  if (alreadyTruncated || lines.length === 0 || lines.length < scannedLines) {
    return { lines, withheld: false };
  }
  if (lines.length === 1) {
    return { lines: [], withheld: true };
  }
  let indexToWithhold = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!matchLineNumbers.has(lines[index]?.line ?? 0)) {
      indexToWithhold = index;
      break;
    }
  }
  return {
    lines: lines.filter((_, index) => index !== indexToWithhold),
    withheld: true,
  };
}

function formatNumberedLines(lines: Array<{ line: number; text: string }>): string {
  return lines.map((line) => `${line.line}: ${line.text}`).join("\n");
}

function compileUserPattern(pattern: string | undefined): RegExp {
  if (!pattern?.trim()) {
    throw new Error("grep 模式缺失。用法：/details output <id> --grep <pattern> [--context N]");
  }
  return new RegExp(escapeRegExp(pattern), "iu");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clampPositive(value: number | undefined, fallback: number, max: number): number {
  if (!Number.isFinite(value) || value === undefined || value <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(value), max);
}

function formatDisplaySourcePath(sourcePath: string): string {
  const normalized = normalizePathSeparators(sourcePath);
  const logRootIndex = normalized.indexOf("/.linghun/logs/");
  if (logRootIndex >= 0) {
    return normalized.slice(logRootIndex + 1);
  }
  if (normalized.startsWith(".linghun/logs/")) {
    return normalized;
  }
  return `redacted:${basename(sourcePath)}`;
}

function formatRange(slice: LogArtifactSlice): string {
  if (slice.byteRange) {
    return `bytes ${slice.byteRange.start}-${slice.byteRange.end}`;
  }
  if (slice.lineRange) {
    return `lines ${slice.lineRange.start ?? "?"}-${slice.lineRange.end ?? "?"}`;
  }
  return "bounded";
}

export function redactLogContent(text: string): string {
  return text
    .replace(/(Authorization\s*:\s*)[^\r\n]+/giu, "$1[REDACTED]")
    .replace(/(Cookie\s*:\s*)[^\r\n]+/giu, "$1[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, "sk-[REDACTED]")
    .replace(/((?:api[_-]?key|token|cookie)\s*[:=]\s*)[^\s;]+/giu, "$1[REDACTED]");
}
