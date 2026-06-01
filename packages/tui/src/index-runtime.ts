import { basename } from "node:path";
import type { LinghunConfig } from "@linghun/config";

export type CodebaseMemoryBinarySource = "env" | "bundled" | "managed" | "path" | "missing";
export type CodebaseMemoryBinaryStatus =
  | "ready"
  | "missing"
  | "corrupt"
  | "unsupported"
  | "unknown";
export type CodebaseMemoryArtifactStatus = "ready" | "missing" | "stale" | "corrupt" | "unknown";
export type CodebaseMemoryProjectSelectionSource = "root_path" | "name-candidate" | "missing";

export type IndexSafetyFile = {
  path: string;
  size: number;
  reason: string;
};

export type IndexState = {
  enabled: boolean;
  projectName?: string;
  status: "unknown" | "ready" | "missing" | "stale" | "error" | "indexing";
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
    status: config.index.enabled ? "unknown" : "missing",
  };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase();
}
