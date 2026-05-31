import { readFile, readdir, stat } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import { stableStringify } from "./cache-freshness.js";
import type { IndexSafetyFile } from "./index-runtime.js";
import { truncateDisplay } from "./startup-runtime.js";
import { isRecord } from "./tui-state-runtime.js";

const LARGE_INDEX_FILE_BYTES = 1_000_000;
const LARGE_INDEX_FILE_LIMIT = 12;
// Run 2 P2-6 — 把 log 类大文本/转储/数据文件纳入大文件风险扫描。大 .log / dump /
// ndjson / csv / tsv 与大 JSON/SQL/XML 一样会放大索引成本和噪声，之前被静默跳过。
const LARGE_INDEX_RISK_EXTENSIONS = new Set([
  ".json",
  ".sql",
  ".xml",
  ".log",
  ".ndjson",
  ".csv",
  ".tsv",
  ".dump",
]);
const LARGE_INDEX_RISK_DIRS = new Set([
  ".next",
  ".turbo",
  ".venv",
  "assets",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "public",
  "target",
  "vendor",
  "venv",
]);
const INDEX_SCAN_SKIP_DIRS = new Set([".git", ".codebase-memory", ".linghun"]);

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase();
}

export function summarizeIndexResult(
  tool: "search_code" | "get_architecture",
  data: unknown,
): string {
  if (tool === "get_architecture" && isRecord(data)) {
    return [
      "Index architecture（短摘要）",
      `- project: ${String(data.project ?? "unknown")}`,
      `- nodes/edges: ${String(data.total_nodes ?? "-")}/${String(data.total_edges ?? "-")}`,
      `- node labels: ${summarizeNamedCounts(data.node_labels)}`,
      `- edge types: ${summarizeNamedCounts(data.edge_types)}`,
    ].join("\n");
  }
  if (isRecord(data)) {
    const raw = Array.isArray(data.results) ? data.results : [];
    const matches = raw
      .slice(0, 5)
      .map((item, index) => `- #${index + 1} ${summarizeIndexSearchItem(item)}`);
    return [
      "Index search（短摘要，最多 5 条）",
      `- total: ${String(data.total_results ?? raw.length)}`,
      ...matches,
      matches.length === 0
        ? "- no matches"
        : "- truncated: full source is not dumped into transcript/status bar.",
    ].join("\n");
  }
  return `Index result: ${truncateDisplay(stableStringify(data), 500)}`;
}

function summarizeIndexSearchItem(item: unknown): string {
  if (!isRecord(item)) {
    return truncateDisplay(String(item), 120);
  }
  const path = String(item.path ?? item.file ?? item.file_path ?? "unknown");
  const symbol = item.symbol ?? item.name ?? item.qualified_name;
  const kind = item.kind ?? item.type ?? item.label;
  const parts = [`path=${truncateDisplay(path, 80)}`];
  if (symbol !== undefined) {
    parts.push(`symbol=${truncateDisplay(String(symbol), 60)}`);
  }
  if (kind !== undefined) {
    parts.push(`kind=${truncateDisplay(String(kind), 40)}`);
  }
  return parts.join(" ");
}

function summarizeNamedCounts(value: unknown): string {
  if (!Array.isArray(value)) {
    return "-";
  }
  return value
    .slice(0, 6)
    .map((item) => {
      if (!isRecord(item)) {
        return truncateDisplay(String(item), 32);
      }
      return `${String(item.label ?? item.type ?? item.name ?? "?")}=${String(item.count ?? "?")}`;
    })
    .join(", ");
}

export type IndexSafetyResult = {
  riskyFiles: IndexSafetyFile[];
  truncated: boolean;
};

export async function scanIndexSafety(projectPath: string): Promise<IndexSafetyResult> {
  const ignorePatterns = await readIndexIgnorePatterns(projectPath);
  const riskyFiles: IndexSafetyFile[] = [];
  let truncated = false;

  async function visit(directory: string): Promise<void> {
    if (riskyFiles.length >= LARGE_INDEX_FILE_LIMIT) {
      truncated = true;
      return;
    }
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (riskyFiles.length >= LARGE_INDEX_FILE_LIMIT) {
        truncated = true;
        return;
      }
      const absolutePath = join(directory, entry.name);
      const relativePath = normalizePath(relative(projectPath, absolutePath));
      if (!relativePath || isIgnoredIndexPath(relativePath, ignorePatterns)) {
        continue;
      }
      if (entry.isDirectory()) {
        if (INDEX_SCAN_SKIP_DIRS.has(entry.name)) {
          continue;
        }
        if (LARGE_INDEX_RISK_DIRS.has(entry.name)) {
          riskyFiles.push({
            path: `${relativePath}/`,
            size: 0,
            reason: "generated/dependency directory",
          });
          continue;
        }
        await visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const fileRisk = getIndexFileRisk(relativePath);
      if (!fileRisk) {
        continue;
      }
      let fileStat: Awaited<ReturnType<typeof stat>>;
      try {
        fileStat = await stat(absolutePath);
      } catch {
        continue;
      }
      if (fileStat.size < LARGE_INDEX_FILE_BYTES) {
        continue;
      }
      riskyFiles.push({ path: relativePath, size: fileStat.size, reason: fileRisk });
    }
  }

  await visit(projectPath);
  return { riskyFiles, truncated };
}

export async function readIndexIgnorePatterns(projectPath: string): Promise<string[]> {
  const patterns: string[] = [];
  for (const fileName of [".linghunignore", ".cbmignore"]) {
    try {
      const text = await readFile(join(projectPath, fileName), "utf8");
      patterns.push(
        ...text
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0 && !line.startsWith("#"))
          .map((line) => normalizePath(line)),
      );
    } catch {
      // Ignore file is optional; missing or unreadable files must not break /index commands.
    }
  }
  return patterns;
}

export function isIgnoredIndexPath(relativePath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const normalized = pattern.replace(/^\//, "");
    if (!normalized) {
      return false;
    }
    if (normalized.endsWith("/")) {
      return relativePath.startsWith(normalized);
    }
    if (normalized.includes("*")) {
      const escaped = normalized.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
      return (
        new RegExp(`^${escaped}$`).test(relativePath) ||
        new RegExp(`(^|/)${escaped}$`).test(relativePath)
      );
    }
    return relativePath === normalized || relativePath.startsWith(`${normalized}/`);
  });
}

function getIndexFileRisk(relativePath: string): string | null {
  const fileName = basename(relativePath);
  const extension = extname(relativePath).toLowerCase();
  const segments = relativePath.split("/");
  if (fileName.endsWith(".min.js")) {
    return "minified javascript";
  }
  if (LARGE_INDEX_RISK_EXTENSIONS.has(extension)) {
    return `${extension} file`;
  }
  if (segments.some((segment) => LARGE_INDEX_RISK_DIRS.has(segment))) {
    return "generated/resource directory";
  }
  return null;
}

export function createIndexTransientExcludes(safety: IndexSafetyResult): string[] {
  return uniqueStrings(safety.riskyFiles.map((file) => file.path));
}

export function formatIndexAutoSkipPrimary(
  safety: IndexSafetyResult,
  status: string,
  actionLabel: "init fast" | "refresh",
  language: "zh-CN" | "en-US",
): string {
  const count = safety.riskyFiles.length;
  const isRefresh = actionLabel === "refresh";
  if (language === "en-US") {
    if (status === "stale") {
      return `Index ${isRefresh ? "refresh" : "init"} ran and skipped ${count} large/generated item${count === 1 ? "" : "s"}; current status is still stale.`;
    }
    return `Index ${isRefresh ? "refreshed" : "initialized"}; automatically skipped ${count} large/generated item${count === 1 ? "" : "s"}.`;
  }
  if (status === "stale") {
    return `索引${isRefresh ? "刷新" : "初始化"}已执行，已跳过 ${count} 项大文件/生成物；当前状态仍为 stale。`;
  }
  return isRefresh
    ? `索引已刷新，已自动跳过 ${count} 项大文件/生成物。`
    : `索引已初始化，已自动跳过 ${count} 项大文件/生成物。`;
}

export function formatIndexAutoSkipNextAction(language: "zh-CN" | "en-US"): string {
  return language === "en-US"
    ? "To persist ignore rules, run index repair."
    : "如需持久化忽略规则，可运行索引修复。";
}

export function formatIndexAutoSkipDetails(
  safety: IndexSafetyResult,
  actionLabel: "init fast" | "refresh",
  language: "zh-CN" | "en-US",
): string {
  const files = safety.riskyFiles.map((file) => {
    const size = file.size > 0 ? `${formatBytes(file.size)}, ` : "";
    return `- ${file.path} (${size}${file.reason})`;
  });
  const ignoreEntries = safety.riskyFiles.map((file) => `  ${file.path}`);
  if (language === "en-US") {
    return [
      `Index ${actionLabel} used transient excludes for this run only.`,
      "Skipped files/directories:",
      ...files,
      safety.truncated
        ? `- Only the first ${LARGE_INDEX_FILE_LIMIT} risky items were recorded.`
        : "",
      "Persistent ignore suggestions:",
      "- Write these entries only via /index repair; normal refresh does not edit repository files.",
      "- Suggested ignore files: .linghunignore or .cbmignore",
      "Suggested entries:",
      ...ignoreEntries,
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    `本次 /index ${actionLabel} 使用 transient exclude，仅对本次刷新生效。`,
    "已跳过清单：",
    ...files,
    safety.truncated ? `- 仅记录前 ${LARGE_INDEX_FILE_LIMIT} 项风险文件。` : "",
    "持久化忽略建议：",
    "- 只有 /index repair 会写入这些条目；普通 refresh 不修改仓库文件。",
    "- 建议 ignore 文件：.linghunignore 或 .cbmignore",
    "建议加入条目：",
    ...ignoreEntries,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) {
    return `${(bytes / 1_000_000).toFixed(1)} MB`;
  }
  return `${Math.round(bytes / 1_000)} KB`;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
