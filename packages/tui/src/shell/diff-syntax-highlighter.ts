import { type Theme, highlight } from "cli-highlight";

export type SyntaxDiffLineKind = "add" | "remove" | "context";

export type SyntaxDiffLine = {
  kind: SyntaxDiffLineKind;
  text: string;
};

export type SyntaxHighlightedHunkOptions = {
  filePath?: string;
  hunkHeader?: string;
  lines: SyntaxDiffLine[];
  themeKey: string;
  width: number;
  noColor: boolean;
};

const CACHE_LIMIT = 80;
const MAX_HIGHLIGHT_LINES = 160;
const MAX_HIGHLIGHT_CHARS = 12_000;
const ESC = "\x1B";
const ANSI_RE = new RegExp(`${ESC}\\[[0-9;]*m`, "gu");

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  bash: "bash",
  cjs: "javascript",
  css: "css",
  html: "xml",
  js: "javascript",
  json: "json",
  jsx: "javascript",
  mjs: "javascript",
  md: "markdown",
  mdx: "markdown",
  scss: "scss",
  sh: "bash",
  ts: "typescript",
  tsx: "typescript",
  txt: "plaintext",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash",
};

const DIFF_SYNTAX_THEME: Theme = {
  keyword: (text) => ansiStyle("35", text),
  built_in: (text) => ansiStyle("36", text),
  type: (text) => ansiStyle("36", text),
  literal: (text) => ansiStyle("35", text),
  number: (text) => ansiStyle("33", text),
  string: (text) => ansiStyle("32", text),
  regexp: (text) => ansiStyle("32", text),
  title: (text) => ansiStyle("36", text),
  function: (text) => ansiStyle("36", text),
  comment: (text) => ansiStyle("2", text),
  meta: (text) => ansiStyle("33", text),
};

const hunkCache = new Map<string, (string | undefined)[]>();
let cacheHits = 0;
let cacheMisses = 0;

export function renderSyntaxHighlightedDiffHunk(
  options: SyntaxHighlightedHunkOptions,
): (string | undefined)[] | undefined {
  if (options.noColor) return undefined;
  const filePath = normalizeDiffPath(options.filePath);
  if (!filePath) return undefined;
  const language = languageForPath(filePath);
  if (!language || language === "plaintext") return undefined;
  if (options.lines.length === 0 || options.lines.length > MAX_HIGHLIGHT_LINES) return undefined;

  const charCount = options.lines.reduce((total, line) => total + line.text.length, 0);
  if (charCount > MAX_HIGHLIGHT_CHARS) return undefined;

  const key = createCacheKey({ ...options, filePath });
  const cached = hunkCache.get(key);
  if (cached) {
    cacheHits += 1;
    hunkCache.delete(key);
    hunkCache.set(key, cached);
    return cached;
  }
  cacheMisses += 1;

  const highlighted = computeSyntaxHighlightedLines(options.lines, language, options.width);
  if (!highlighted) return undefined;
  rememberCacheValue(key, highlighted);
  return highlighted;
}

export function clearDiffSyntaxHighlightCache(): void {
  hunkCache.clear();
  cacheHits = 0;
  cacheMisses = 0;
}

export function getDiffSyntaxHighlightCacheStats(): { size: number; hits: number; misses: number } {
  return { size: hunkCache.size, hits: cacheHits, misses: cacheMisses };
}

export function inferDiffFilePath(rawLines: string[]): string | undefined {
  for (const raw of rawLines) {
    if (raw.startsWith("+++ ")) {
      const nextPath = normalizeDiffPath(raw.slice(4));
      if (nextPath && nextPath !== "/dev/null") return nextPath;
    }
  }
  for (const raw of rawLines) {
    const match = raw.match(/^diff --git\s+a\/(\S+)\s+b\/(\S+)$/u);
    if (match?.[2]) return normalizeDiffPath(match[2]);
  }
  return undefined;
}

function computeSyntaxHighlightedLines(
  lines: SyntaxDiffLine[],
  language: string,
  width: number,
): (string | undefined)[] | undefined {
  const eligibleIndexes: number[] = [];
  const sourceLines: string[] = [];
  lines.forEach((line, index) => {
    if (line.kind === "remove") return;
    eligibleIndexes.push(index);
    sourceLines.push(line.text);
  });
  if (sourceLines.length === 0) return undefined;

  try {
    const highlightedText = highlight(sourceLines.join("\n"), {
      language,
      ignoreIllegals: true,
      theme: DIFF_SYNTAX_THEME,
    }).replace(/\n$/u, "");
    if (!ANSI_RE.test(highlightedText)) return undefined;
    ANSI_RE.lastIndex = 0;
    const highlightedLines = highlightedText.split("\n");
    if (highlightedLines.length !== sourceLines.length) return undefined;

    const result: (string | undefined)[] = Array.from({ length: lines.length }, () => undefined);
    highlightedLines.forEach((line, index) => {
      const rawIndex = eligibleIndexes[index];
      if (rawIndex === undefined) return;
      result[rawIndex] = stripAnsi(line).length <= width ? line : undefined;
    });
    return result.some(Boolean) ? result : undefined;
  } catch {
    return undefined;
  }
}

function rememberCacheValue(key: string, value: (string | undefined)[]): void {
  hunkCache.set(key, value);
  if (hunkCache.size <= CACHE_LIMIT) return;
  const oldest = hunkCache.keys().next().value;
  if (oldest) hunkCache.delete(oldest);
}

function createCacheKey(options: SyntaxHighlightedHunkOptions): string {
  const hunkHash = hashString(
    [options.hunkHeader ?? "", ...options.lines.map((line) => `${line.kind}:${line.text}`)].join(
      "\n",
    ),
  );
  return [options.filePath, options.themeKey, options.width, hunkHash].join("|");
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

function languageForPath(filePath: string): string | undefined {
  const clean = filePath.split(/[?#]/u)[0] ?? filePath;
  const extension = clean.match(/\.([A-Za-z0-9]+)$/u)?.[1]?.toLowerCase();
  return extension ? LANGUAGE_BY_EXTENSION[extension] : undefined;
}

function normalizeDiffPath(filePath: string | undefined): string | undefined {
  const raw = filePath?.trim();
  if (!raw) return undefined;
  const withoutPrefix = raw.replace(/^(?:a|b)\//u, "");
  return withoutPrefix || undefined;
}

function ansiStyle(code: string, text: string): string {
  return `${ESC}[${code}m${text}${ESC}[0m`;
}

function stripAnsi(value: string): string {
  return value.replace(ANSI_RE, "");
}
