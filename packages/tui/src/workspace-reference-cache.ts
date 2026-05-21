import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_FILE_HASH_BYTES = 256 * 1024;
const DEFAULT_WATCHED_FILES = [
  "README.md",
  "package.json",
  "LINGHUN.md",
  "CLAUDE.md",
  ".linghun/settings.json",
  ".linghunignore",
  ".cbmignore",
];
const DEFAULT_WATCHED_DIRECTORIES = [".", ".linghun"];

export type WorkspaceReferenceCacheSource = "hit" | "miss" | "stale" | "fallback";

export type WorkspaceReferenceDimensions = {
  configHash: string;
  toolSchemaHash: string;
  providerModelHash: string;
  mcpToolListHash: string;
  indexFreshnessHash: string;
  compactBoundaryHash: string;
  extensionListHash: string;
};

export type WorkspaceReferenceFileSummary = {
  path: string;
  exists: boolean;
  readable: boolean;
  size: number;
  mtimeMs: number;
  hash: string;
};

export type WorkspaceReferenceDirectorySummary = {
  path: string;
  readable: boolean;
  files: number;
  directories: number;
  entryHash: string;
};

export type WorkspaceReferenceSnapshot = {
  key: string;
  source: WorkspaceReferenceCacheSource;
  createdAt: string;
  changedKeys: string[];
  dimensions: WorkspaceReferenceDimensions;
  files: WorkspaceReferenceFileSummary[];
  directories: WorkspaceReferenceDirectorySummary[];
  runtimeStatus: unknown;
  toolCapabilitySummary: string;
  evidenceRefs: string[];
  logRefs: string[];
  error?: string;
};

export type WorkspaceReferenceCache = {
  latest?: WorkspaceReferenceSnapshot;
  hits: number;
  misses: number;
  failures: number;
};

export type WorkspaceReferenceInput = {
  projectPath: string;
  dimensions: WorkspaceReferenceDimensions;
  runtimeStatus: unknown;
  toolCapabilitySummary: string;
  evidenceRefs?: string[];
  logRefs?: string[];
  watchedFiles?: string[];
  watchedDirectories?: string[];
  fileHashBytes?: number;
};

export type WorkspaceReferenceScan = Pick<
  WorkspaceReferenceSnapshot,
  "files" | "directories" | "runtimeStatus" | "toolCapabilitySummary" | "evidenceRefs" | "logRefs"
> & {
  dimensions: WorkspaceReferenceDimensions;
};

export async function getWorkspaceReferenceSnapshot(
  cache: WorkspaceReferenceCache,
  input: WorkspaceReferenceInput,
  scan: (
    input: WorkspaceReferenceInput,
  ) => Promise<WorkspaceReferenceScan> = scanWorkspaceReference,
): Promise<WorkspaceReferenceSnapshot> {
  try {
    if (cache.latest) {
      const probe = await probeWorkspaceReference(input);
      if (workspaceReferenceProbeMatches(cache.latest, input.dimensions, probe)) {
        cache.hits += 1;
        return { ...cache.latest, source: "hit", changedKeys: [] };
      }
    }

    const scanned = await scan(input);
    const key = workspaceReferenceKey(scanned);
    const previous = cache.latest;
    if (previous?.key === key) {
      cache.hits += 1;
      return { ...previous, source: "hit", changedKeys: [] };
    }

    const changedKeys = diffWorkspaceReference(previous, key, scanned);
    const snapshot: WorkspaceReferenceSnapshot = {
      key,
      source: previous ? "stale" : "miss",
      createdAt: new Date().toISOString(),
      changedKeys,
      dimensions: scanned.dimensions,
      files: scanned.files,
      directories: scanned.directories,
      runtimeStatus: scanned.runtimeStatus,
      toolCapabilitySummary: truncateText(input.toolCapabilitySummary, 2_000),
      evidenceRefs: sanitizeRefs(scanned.evidenceRefs),
      logRefs: sanitizeRefs(scanned.logRefs),
    };
    cache.latest = snapshot;
    cache.misses += 1;
    return snapshot;
  } catch (error) {
    cache.failures += 1;
    return {
      key: cache.latest?.key ?? "fallback",
      source: "fallback",
      createdAt: new Date().toISOString(),
      changedKeys: ["workspaceReferenceUnavailable"],
      dimensions: input.dimensions,
      files: cache.latest?.files ?? [],
      directories: cache.latest?.directories ?? [],
      runtimeStatus: input.runtimeStatus,
      toolCapabilitySummary: truncateText(input.toolCapabilitySummary, 2_000),
      evidenceRefs: sanitizeRefs(input.evidenceRefs ?? []),
      logRefs: sanitizeRefs(input.logRefs ?? []),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function createWorkspaceReferenceCache(): WorkspaceReferenceCache {
  return { hits: 0, misses: 0, failures: 0 };
}

export function workspaceReferenceHash(snapshot: WorkspaceReferenceSnapshot | undefined): string {
  if (!snapshot) {
    return stableHash("none");
  }
  return stableHash({ key: snapshot.key, changedKeys: snapshot.changedKeys });
}

async function scanWorkspaceReference(
  input: WorkspaceReferenceInput,
): Promise<WorkspaceReferenceScan> {
  const watchedFiles = input.watchedFiles ?? DEFAULT_WATCHED_FILES;
  const watchedDirectories = input.watchedDirectories ?? DEFAULT_WATCHED_DIRECTORIES;
  const fileHashBytes = input.fileHashBytes ?? DEFAULT_FILE_HASH_BYTES;
  const [files, directories] = await Promise.all([
    Promise.all(watchedFiles.map((path) => summarizeFile(input.projectPath, path, fileHashBytes))),
    Promise.all(watchedDirectories.map((path) => summarizeDirectory(input.projectPath, path))),
  ]);
  return {
    dimensions: input.dimensions,
    files,
    directories,
    runtimeStatus: input.runtimeStatus,
    toolCapabilitySummary: truncateText(input.toolCapabilitySummary, 2_000),
    evidenceRefs: sanitizeRefs(input.evidenceRefs ?? []),
    logRefs: sanitizeRefs(input.logRefs ?? []),
  };
}

type WorkspaceReferenceProbe = Pick<WorkspaceReferenceSnapshot, "files" | "directories">;

async function probeWorkspaceReference(
  input: WorkspaceReferenceInput,
): Promise<WorkspaceReferenceProbe> {
  const watchedFiles = input.watchedFiles ?? DEFAULT_WATCHED_FILES;
  const watchedDirectories = input.watchedDirectories ?? DEFAULT_WATCHED_DIRECTORIES;
  const fileHashBytes = input.fileHashBytes ?? DEFAULT_FILE_HASH_BYTES;
  const [files, directories] = await Promise.all([
    Promise.all(watchedFiles.map((path) => summarizeFile(input.projectPath, path, fileHashBytes))),
    Promise.all(watchedDirectories.map((path) => summarizeDirectory(input.projectPath, path))),
  ]);
  return { files, directories };
}

function workspaceReferenceProbeMatches(
  previous: WorkspaceReferenceSnapshot,
  dimensions: WorkspaceReferenceDimensions,
  probe: WorkspaceReferenceProbe,
): boolean {
  return (
    stableHash(previous.dimensions) === stableHash(dimensions) &&
    stableHash(previous.files.map((file) => fileStatKey(file))) ===
      stableHash(probe.files.map((file) => fileStatKey(file))) &&
    stableHash(previous.directories) === stableHash(probe.directories)
  );
}

function fileStatKey(file: WorkspaceReferenceFileSummary): unknown {
  return {
    path: file.path,
    exists: file.exists,
    readable: file.readable,
    size: file.size,
    mtimeMs: file.mtimeMs,
  };
}

async function summarizeFile(
  projectPath: string,
  relativePath: string,
  maxHashBytes: number,
): Promise<WorkspaceReferenceFileSummary> {
  const normalized = normalizeRelativePath(relativePath);
  const absolutePath = join(projectPath, normalized);
  try {
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) {
      return missingFile(normalized);
    }
    const content = await readFile(absolutePath);
    const bounded = content.subarray(0, Math.max(0, maxHashBytes));
    const hash = stableHash({
      size: fileStat.size,
      mtimeMs: Math.trunc(fileStat.mtimeMs),
      contentHash: sha256(bounded),
      truncated: content.length > bounded.length,
    });
    return {
      path: normalized,
      exists: true,
      readable: true,
      size: fileStat.size,
      mtimeMs: Math.trunc(fileStat.mtimeMs),
      hash,
    };
  } catch {
    return missingFile(normalized);
  }
}

async function summarizeFileStat(
  projectPath: string,
  relativePath: string,
): Promise<WorkspaceReferenceFileSummary> {
  const normalized = normalizeRelativePath(relativePath);
  try {
    const fileStat = await stat(join(projectPath, normalized));
    if (!fileStat.isFile()) {
      return missingFile(normalized);
    }
    return {
      path: normalized,
      exists: true,
      readable: true,
      size: fileStat.size,
      mtimeMs: Math.trunc(fileStat.mtimeMs),
      hash: stableHash({ size: fileStat.size, mtimeMs: Math.trunc(fileStat.mtimeMs) }),
    };
  } catch {
    return missingFile(normalized);
  }
}

function missingFile(path: string): WorkspaceReferenceFileSummary {
  return { path, exists: false, readable: false, size: 0, mtimeMs: 0, hash: stableHash("missing") };
}

async function summarizeDirectory(
  projectPath: string,
  relativePath: string,
): Promise<WorkspaceReferenceDirectorySummary> {
  const normalized = normalizeRelativePath(relativePath);
  try {
    const entries = await readdir(join(projectPath, normalized), { withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile()).length;
    const directories = entries.filter((entry) => entry.isDirectory()).length;
    const entryHash = stableHash(
      entries
        .map((entry) => ({
          name: entry.name,
          kind: entry.isDirectory() ? "dir" : entry.isFile() ? "file" : "other",
        }))
        .sort((a, b) => `${a.kind}:${a.name}`.localeCompare(`${b.kind}:${b.name}`)),
    );
    return { path: normalized, readable: true, files, directories, entryHash };
  } catch {
    return {
      path: normalized,
      readable: false,
      files: 0,
      directories: 0,
      entryHash: stableHash("missing"),
    };
  }
}

function workspaceReferenceKey(scan: WorkspaceReferenceScan): string {
  return stableHash({
    dimensions: scan.dimensions,
    files: scan.files,
    directories: scan.directories,
    runtimeStatus: scan.runtimeStatus,
    toolCapabilitySummary: scan.toolCapabilitySummary,
    evidenceRefs: scan.evidenceRefs,
    logRefs: scan.logRefs,
  });
}

function diffWorkspaceReference(
  previous: WorkspaceReferenceSnapshot | undefined,
  key: string,
  scan: WorkspaceReferenceScan,
): string[] {
  if (!previous) {
    return [];
  }
  const changed = new Set<string>();
  if (previous.key !== key) changed.add("workspaceReferenceHash");
  for (const [name, value] of Object.entries(scan.dimensions) as Array<
    [keyof WorkspaceReferenceDimensions, string]
  >) {
    if (previous.dimensions[name] !== value) {
      changed.add(name);
    }
  }
  if (stableHash(previous.files) !== stableHash(scan.files)) changed.add("fileStatHash");
  if (stableHash(previous.directories) !== stableHash(scan.directories)) {
    changed.add("directorySummaryHash");
  }
  return [...changed].sort((a, b) => a.localeCompare(b));
}

function sanitizeRefs(refs: string[]): string[] {
  return refs.map((ref) => truncateText(ref.replace(/\s+/g, " "), 240)).slice(0, 20);
}

function normalizeRelativePath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
  return normalized || ".";
}

function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

function stableHash(value: unknown): string {
  return sha256(Buffer.from(stableStringify(value), "utf8")).slice(0, 12);
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${key}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? String(value);
}
