import { createHash } from "node:crypto";
import { lstat, open, opendir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_FILE_HASH_BYTES = 256 * 1024;
const DEFAULT_IGNORE_FILE_BYTES = 64 * 1024;
const DEFAULT_TOP_LEVEL_ENTRY_LIMIT = 80;
const HARD_SKIP_DIRS = new Set([
  ".git",
  ".linghun/cache",
  ".next",
  ".turbo",
  ".cache",
  "build",
  "cache",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
]);
const IGNORE_FILES = [".linghunignore", ".cbmignore", ".gitignore"];
const DEFAULT_WATCHED_FILES = [
  "README.md",
  "package.json",
  "LINGHUN.md",
  "CLAUDE.md",
  ".linghun/settings.json",
  ".linghunignore",
  ".cbmignore",
  ".gitignore",
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

export type WorkspaceSnapshotLiteEntry = {
  path: string;
  kind: "file" | "directory" | "symlink" | "other";
  size: number;
  mtimeMs: number;
  hashPrefix?: string;
  ignoredReason?: string;
};

export type WorkspaceSnapshotLite = {
  schemaVersion: 1;
  root: ".";
  bounded: true;
  partial: boolean;
  limits: {
    topLevelEntryLimit: number;
    fileHashBytes: number;
  };
  counts: {
    files: number;
    directories: number;
    symlinks: number;
    other: number;
    ignored: number;
    storedEntries: number;
  };
  ignoreSources: { path: string; readable: boolean; hashPrefix?: string }[];
  entries: WorkspaceSnapshotLiteEntry[];
  changedSummary?: {
    added: number;
    modified: number;
    deleted: number;
    changedKeys: string[];
  };
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
  workspaceSnapshot?: WorkspaceSnapshotLite;
  error?: string;
};

export type WorkspaceReferenceCache = {
  latest?: WorkspaceReferenceSnapshot;
  hits: number;
  misses: number;
  failures: number;
  _pendingProbe?: Promise<WorkspaceReferenceSnapshot>;
  _pendingProbeInputHash?: string;
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
  | "files"
  | "directories"
  | "runtimeStatus"
  | "toolCapabilitySummary"
  | "evidenceRefs"
  | "logRefs"
  | "workspaceSnapshot"
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
  // Probe coalescing: if an identical probe is already in-flight, reuse it
  const inputHash = stableHash({
    projectPath: input.projectPath,
    dimensions: input.dimensions,
    runtimeStatus: input.runtimeStatus,
    toolCapabilitySummary: input.toolCapabilitySummary,
    evidenceRefs: input.evidenceRefs ?? [],
    logRefs: input.logRefs ?? [],
    watchedFiles: input.watchedFiles ?? DEFAULT_WATCHED_FILES,
    watchedDirectories: input.watchedDirectories ?? DEFAULT_WATCHED_DIRECTORIES,
    fileHashBytes: input.fileHashBytes ?? DEFAULT_FILE_HASH_BYTES,
  });
  if (cache._pendingProbe && cache._pendingProbeInputHash === inputHash) {
    return cache._pendingProbe;
  }

  const promise = _getWorkspaceReferenceSnapshotInner(cache, input, scan);
  cache._pendingProbe = promise;
  cache._pendingProbeInputHash = inputHash;
  try {
    return await promise;
  } finally {
    if (cache._pendingProbe === promise) {
      cache._pendingProbe = undefined;
      cache._pendingProbeInputHash = undefined;
    }
  }
}

async function _getWorkspaceReferenceSnapshotInner(
  cache: WorkspaceReferenceCache,
  input: WorkspaceReferenceInput,
  scan: (input: WorkspaceReferenceInput) => Promise<WorkspaceReferenceScan>,
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
      workspaceSnapshot: attachWorkspaceSnapshotChangedSummary(
        scanned.workspaceSnapshot,
        previous?.workspaceSnapshot,
      ),
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
      workspaceSnapshot: cache.latest?.workspaceSnapshot,
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
  const [files, directories, workspaceSnapshot] = await Promise.all([
    Promise.all(watchedFiles.map((path) => summarizeFile(input.projectPath, path, fileHashBytes))),
    Promise.all(watchedDirectories.map((path) => summarizeDirectory(input.projectPath, path))),
    summarizeWorkspaceSnapshotLite(input.projectPath, fileHashBytes),
  ]);
  return {
    dimensions: input.dimensions,
    files,
    directories,
    runtimeStatus: input.runtimeStatus,
    toolCapabilitySummary: truncateText(input.toolCapabilitySummary, 2_000),
    evidenceRefs: sanitizeRefs(input.evidenceRefs ?? []),
    logRefs: sanitizeRefs(input.logRefs ?? []),
    workspaceSnapshot,
  };
}

type WorkspaceReferenceProbe = Pick<
  WorkspaceReferenceSnapshot,
  "files" | "directories" | "workspaceSnapshot"
>;

async function probeWorkspaceReference(
  input: WorkspaceReferenceInput,
): Promise<WorkspaceReferenceProbe> {
  const watchedFiles = input.watchedFiles ?? DEFAULT_WATCHED_FILES;
  const watchedDirectories = input.watchedDirectories ?? DEFAULT_WATCHED_DIRECTORIES;
  const fileHashBytes = input.fileHashBytes ?? DEFAULT_FILE_HASH_BYTES;
  const [files, directories, workspaceSnapshot] = await Promise.all([
    Promise.all(watchedFiles.map((path) => summarizeFile(input.projectPath, path, fileHashBytes))),
    Promise.all(watchedDirectories.map((path) => summarizeDirectory(input.projectPath, path))),
    summarizeWorkspaceSnapshotLite(input.projectPath, fileHashBytes),
  ]);
  return { files, directories, workspaceSnapshot };
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
    stableHash(previous.directories) === stableHash(probe.directories) &&
    (!previous.workspaceSnapshot ||
      stableHash(stripWorkspaceSnapshotChangedSummary(previous.workspaceSnapshot)) ===
        stableHash(stripWorkspaceSnapshotChangedSummary(probe.workspaceSnapshot)))
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
    const bounded = await readFilePrefix(absolutePath, fileStat.size, maxHashBytes);
    const hash = stableHash({
      size: fileStat.size,
      mtimeMs: Math.trunc(fileStat.mtimeMs),
      contentHash: sha256(bounded),
      truncated: fileStat.size > bounded.length,
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
    workspaceSnapshot: stripWorkspaceSnapshotChangedSummary(scan.workspaceSnapshot),
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
  if (
    stableHash(stripWorkspaceSnapshotChangedSummary(previous.workspaceSnapshot)) !==
    stableHash(stripWorkspaceSnapshotChangedSummary(scan.workspaceSnapshot))
  ) {
    changed.add("workspaceSnapshotHash");
  }
  return [...changed].sort((a, b) => a.localeCompare(b));
}

async function summarizeWorkspaceSnapshotLite(
  projectPath: string,
  fileHashBytes: number,
): Promise<WorkspaceSnapshotLite> {
  const entries: WorkspaceSnapshotLiteEntry[] = [];
  const counts = { files: 0, directories: 0, symlinks: 0, other: 0, ignored: 0, storedEntries: 0 };
  let partial = false;
  const ignoreSources = await readIgnoreSources(projectPath);
  const directory = await opendir(projectPath);
  try {
    for await (const entry of directory) {
      const relativePath = normalizeRelativePath(entry.name);
      const ignoredReason = getIgnoredReason(relativePath, entry.name, ignoreSources);
      if (ignoredReason) {
        counts.ignored += 1;
        if (entries.length >= DEFAULT_TOP_LEVEL_ENTRY_LIMIT) {
          partial = true;
          continue;
        }
        entries.push({
          path: relativePath,
          kind: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
          size: 0,
          mtimeMs: 0,
          ignoredReason,
        });
        continue;
      }
      if (entries.length >= DEFAULT_TOP_LEVEL_ENTRY_LIMIT) {
        partial = true;
        continue;
      }
      const absolutePath = join(projectPath, entry.name);
      const entryStat = await lstat(absolutePath);
      const kind = entryStat.isSymbolicLink()
        ? "symlink"
        : entryStat.isDirectory()
          ? "directory"
          : entryStat.isFile()
            ? "file"
            : "other";
      incrementWorkspaceSnapshotCount(counts, kind);
      entries.push({
        path: relativePath,
        kind,
        size: entryStat.size,
        mtimeMs: Math.trunc(entryStat.mtimeMs),
        hashPrefix:
          kind === "file"
            ? await hashFilePrefix(absolutePath, entryStat.size, fileHashBytes)
            : undefined,
      });
    }
  } finally {
    await directory.close().catch(() => undefined);
  }
  counts.storedEntries = entries.length;
  return {
    schemaVersion: 1,
    root: ".",
    bounded: true,
    partial,
    limits: { topLevelEntryLimit: DEFAULT_TOP_LEVEL_ENTRY_LIMIT, fileHashBytes },
    counts,
    ignoreSources: ignoreSources.map(({ path, readable, hashPrefix }) => ({
      path,
      readable,
      hashPrefix,
    })),
    entries: entries.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

type IgnoreSource = { path: string; readable: boolean; patterns: string[]; hashPrefix?: string };

type WorkspaceSnapshotCounts = WorkspaceSnapshotLite["counts"];

async function readIgnoreSources(projectPath: string): Promise<IgnoreSource[]> {
  return Promise.all(
    IGNORE_FILES.map(async (path) => {
      const absolutePath = join(projectPath, path);
      try {
        const fileStat = await stat(absolutePath);
        if (!fileStat.isFile()) {
          return { path, readable: false, patterns: [] };
        }
        const content = await readFilePrefix(
          absolutePath,
          fileStat.size,
          DEFAULT_IGNORE_FILE_BYTES,
        );
        return {
          path,
          readable: true,
          patterns: parseIgnorePatterns(content.toString("utf8")),
          hashPrefix: sha256(content).slice(0, 12),
        };
      } catch {
        return { path, readable: false, patterns: [] };
      }
    }),
  );
}

function getIgnoredReason(
  relativePath: string,
  name: string,
  ignoreSources: IgnoreSource[],
): string | undefined {
  if (HARD_SKIP_DIRS.has(relativePath) || HARD_SKIP_DIRS.has(name)) {
    return `hard-skip:${name}`;
  }
  for (const source of ignoreSources) {
    if (!source.readable) {
      continue;
    }
    const matched = source.patterns.find((pattern) =>
      ignorePatternMatches(pattern, relativePath, name),
    );
    if (matched) {
      return `${source.path}:${matched}`;
    }
  }
  return undefined;
}

function parseIgnorePatterns(content: string): string[] {
  return content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("!"))
    .slice(0, 200);
}

function ignorePatternMatches(pattern: string, relativePath: string, name: string): boolean {
  const normalized = normalizeRelativePath(pattern).replace(/^\//, "");
  const directoryPattern = pattern.endsWith("/") ? normalized.replace(/\/$/, "") : normalized;
  if (!directoryPattern || directoryPattern.includes("*")) {
    return false;
  }
  return relativePath === directoryPattern || name === directoryPattern;
}

function incrementWorkspaceSnapshotCount(
  counts: WorkspaceSnapshotCounts,
  kind: WorkspaceSnapshotLiteEntry["kind"],
): void {
  if (kind === "file") counts.files += 1;
  if (kind === "directory") counts.directories += 1;
  if (kind === "symlink") counts.symlinks += 1;
  if (kind === "other") counts.other += 1;
}

function attachWorkspaceSnapshotChangedSummary(
  current: WorkspaceSnapshotLite | undefined,
  previous: WorkspaceSnapshotLite | undefined,
): WorkspaceSnapshotLite | undefined {
  if (!current) {
    return undefined;
  }
  return {
    ...current,
    changedSummary: diffWorkspaceSnapshotLite(previous, current),
  };
}

function diffWorkspaceSnapshotLite(
  previous: WorkspaceSnapshotLite | undefined,
  current: WorkspaceSnapshotLite,
): WorkspaceSnapshotLite["changedSummary"] {
  if (!previous) {
    return { added: 0, modified: 0, deleted: 0, changedKeys: [] };
  }
  const previousEntries = new Map(previous.entries.map((entry) => [entry.path, stableHash(entry)]));
  const currentEntries = new Map(current.entries.map((entry) => [entry.path, stableHash(entry)]));
  let added = 0;
  let modified = 0;
  let deleted = 0;
  for (const [path, hash] of currentEntries) {
    const previousHash = previousEntries.get(path);
    if (!previousHash) {
      added += 1;
      continue;
    }
    if (previousHash !== hash) {
      modified += 1;
    }
  }
  for (const path of previousEntries.keys()) {
    if (!currentEntries.has(path)) {
      deleted += 1;
    }
  }
  const changedKeys = [
    ...(added > 0 ? ["workspaceSnapshotAdded"] : []),
    ...(modified > 0 ? ["workspaceSnapshotModified"] : []),
    ...(deleted > 0 ? ["workspaceSnapshotDeleted"] : []),
  ];
  return { added, modified, deleted, changedKeys };
}

function stripWorkspaceSnapshotChangedSummary(
  snapshot: WorkspaceSnapshotLite | undefined,
): Omit<WorkspaceSnapshotLite, "changedSummary"> | undefined {
  if (!snapshot) {
    return undefined;
  }
  const { changedSummary: _changedSummary, ...rest } = snapshot;
  return rest;
}

async function hashFilePrefix(
  absolutePath: string,
  size: number,
  maxBytes: number,
): Promise<string> {
  return sha256(await readFilePrefix(absolutePath, size, maxBytes)).slice(0, 12);
}

async function readFilePrefix(
  absolutePath: string,
  size: number,
  maxBytes: number,
): Promise<Buffer> {
  const bytesToRead = Math.max(0, Math.min(size, maxBytes));
  if (bytesToRead === 0) {
    return Buffer.alloc(0);
  }
  const handle = await open(absolutePath, "r");
  try {
    const buffer = Buffer.alloc(bytesToRead);
    const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
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
