import { readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { LinghunConfig } from "@linghun/config";
import { isRecord } from "./tui-state-runtime.js";

export type CodebaseMemoryBinarySource = "env" | "bundled" | "managed" | "path" | "missing";
export type CodebaseMemoryBinaryStatus =
  | "ready"
  | "missing"
  | "corrupt"
  | "unsupported"
  | "unknown";
export type CodebaseMemoryArtifactStatus =
  | "ready"
  | "missing"
  | "stale"
  | "corrupt"
  | "disabled"
  | "unknown";
export type CodebaseMemoryProjectSelectionSource = "root_path" | "name-candidate" | "missing";
export type IndexRuntimeStatus =
  | "disabled"
  | "unknown"
  | "unknown-project"
  | "ready"
  | "missing"
  | "stale"
  | "error"
  | "indexing";

export type IndexSafetyFile = {
  path: string;
  size: number;
  reason: string;
};

export type IndexState = {
  enabled: boolean;
  projectName?: string;
  status: IndexRuntimeStatus;
  nodes?: number;
  edges?: number;
  indexedAt?: string;
  changedFiles?: number;
  staleHint?: string;
  safetyWarning?: string;
  safetyRiskyFiles?: IndexSafetyFile[];
  safetyAction?: "init fast" | "refresh";
  error?: string;
  lastQuery?: string;
  lastSummary?: string;
  binarySource?: CodebaseMemoryBinarySource;
  binaryStatus?: CodebaseMemoryBinaryStatus;
  binaryVersion?: string;
  binaryCommand?: string;
  artifactStatus?: CodebaseMemoryArtifactStatus;
  artifactPath?: string;
  projectSelectionSource?: CodebaseMemoryProjectSelectionSource;
  runtime?: string;
};

export type CurrentIndexProject = {
  name: string;
  rootPath?: string;
  source: CodebaseMemoryProjectSelectionSource;
};

export function createIndexState(config: LinghunConfig): IndexState {
  return {
    enabled: config.index.enabled,
    status: config.index.enabled ? "unknown" : "disabled",
    artifactStatus: config.index.enabled ? "unknown" : "disabled",
    projectSelectionSource: config.index.enabled ? undefined : "missing",
  };
}

export type LocalIndexArtifactState =
  | {
      status: "ready";
      artifactPath: string;
      projectName?: string;
      nodes?: number;
      edges?: number;
      indexedAt?: string;
    }
  | { status: "missing"; artifactPath?: string }
  | { status: "corrupt"; artifactPath?: string; error: string };

export async function readLocalIndexArtifactState(
  projectPath: string,
): Promise<LocalIndexArtifactState> {
  const artifactDir = join(projectPath, ".codebase-memory");
  const graphPath = join(artifactDir, "graph.db.zst");
  try {
    const graphStat = await stat(graphPath);
    if (!graphStat.isFile() || graphStat.size <= 0) {
      return { status: "corrupt", artifactPath: graphPath, error: "graph.db.zst is empty" };
    }
  } catch (error) {
    const code =
      typeof error === "object" && error !== null ? (error as { code?: string }).code : "";
    if (code === "ENOENT") {
      return { status: "missing", artifactPath: graphPath };
    }
    return {
      status: "corrupt",
      artifactPath: graphPath,
      error: error instanceof Error ? error.message : "cannot stat graph.db.zst",
    };
  }

  const metadata = await readLocalIndexArtifactMetadata(join(artifactDir, "artifact.json"));
  if (metadata.status === "corrupt") {
    return { ...metadata, artifactPath: graphPath };
  }
  return { status: "ready", artifactPath: graphPath, ...metadata };
}

async function readLocalIndexArtifactMetadata(
  artifactJsonPath: string,
): Promise<
  | { status?: undefined; projectName?: string; nodes?: number; edges?: number; indexedAt?: string }
  | { status: "corrupt"; error: string }
> {
  let raw: string;
  try {
    raw = await readFile(artifactJsonPath, "utf8");
  } catch (error) {
    const code =
      typeof error === "object" && error !== null ? (error as { code?: string }).code : "";
    return code === "ENOENT"
      ? {}
      : {
          status: "corrupt",
          error: error instanceof Error ? error.message : "cannot read artifact.json",
        };
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      projectName: typeof parsed.project === "string" ? parsed.project : undefined,
      nodes: typeof parsed.nodes === "number" ? parsed.nodes : undefined,
      edges: typeof parsed.edges === "number" ? parsed.edges : undefined,
      indexedAt: typeof parsed.indexed_at === "string" ? parsed.indexed_at : undefined,
    };
  } catch {
    return { status: "corrupt", error: "artifact.json is not valid JSON" };
  }
}

export function findCurrentIndexProject(
  data: unknown,
  projectPath: string,
): CurrentIndexProject | null {
  if (!isRecord(data) || !Array.isArray(data.projects)) {
    return null;
  }
  const normalizedProjectPath = normalizePath(projectPath);
  const rootPathMatch = data.projects.find((project) => {
    if (!isRecord(project)) {
      return false;
    }
    return normalizePath(String(project.root_path ?? "")) === normalizedProjectPath;
  });
  if (isRecord(rootPathMatch) && typeof rootPathMatch.name === "string") {
    const rootPath =
      typeof rootPathMatch.root_path === "string" ? rootPathMatch.root_path : undefined;
    return { name: rootPathMatch.name, rootPath, source: "root_path" };
  }

  const candidateNames = createCurrentIndexProjectNameCandidates(projectPath);
  const nameMatches = data.projects.filter((project) => {
    if (!isRecord(project) || typeof project.name !== "string") {
      return false;
    }
    return candidateNames.has(project.name.toLowerCase());
  });
  if (nameMatches.length !== 1) {
    return null;
  }
  const [nameMatch] = nameMatches;
  if (!isRecord(nameMatch) || typeof nameMatch.name !== "string") {
    return null;
  }
  const rootPath = typeof nameMatch.root_path === "string" ? nameMatch.root_path : undefined;
  return { name: nameMatch.name, rootPath, source: "name-candidate" };
}

export function createCurrentIndexProjectNameCandidates(projectPath: string): Set<string> {
  const normalizedPath = projectPath.replaceAll("\\", "/").replace(/\/$/, "");
  const projectName = basename(normalizedPath);
  const candidates = new Set<string>();
  if (projectName) {
    candidates.add(projectName.toLowerCase());
  }
  const drive = /^([A-Za-z]):\//.exec(normalizedPath)?.[1];
  if (drive && projectName) {
    candidates.add(`${drive}-${projectName}`.toLowerCase());
  }
  return candidates;
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase();
}

export function createIndexStatusSnapshot(
  index: IndexState,
): Pick<IndexState, "projectName" | "status" | "nodes" | "edges" | "changedFiles" | "staleHint"> {
  return {
    projectName: index.projectName,
    status: index.status,
    nodes: index.nodes,
    edges: index.edges,
    changedFiles: index.changedFiles,
    staleHint: index.staleHint,
  };
}

export function formatIndexRuntimeRef(
  index: Pick<IndexState, "projectName" | "status" | "nodes" | "edges" | "staleHint">,
): string {
  const project = index.projectName ? `${index.projectName}:` : "";
  const size =
    typeof index.nodes === "number" || typeof index.edges === "number"
      ? ` nodes ${index.nodes ?? "unknown"} edges ${index.edges ?? "unknown"}`
      : "";
  const stale = index.staleHint ? ` stale ${truncateIndexRef(index.staleHint, 80)}` : "";
  return `${project}${index.status}${size}${stale}`;
}

function truncateIndexRef(value: string, max: number): string {
  const compact = value.replace(/\s+/gu, " ").trim();
  return compact.length <= max ? compact : `${compact.slice(0, Math.max(0, max - 1))}…`;
}
