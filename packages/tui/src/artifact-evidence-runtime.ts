import { pathsReferToSameLocation } from "@linghun/shared";
import type { EvidenceRecord } from "./tui-data-types.js";

export function hasStructuredArtifactEvidence(
  evidence: Array<Pick<EvidenceRecord, "data" | "ownerScope" | "createdAt">>,
  targets: string[],
  options?: { requireFresh?: boolean; currentOwner?: string; maxAgeMs?: number },
): boolean {
  const normalizedTargets = uniqueArtifactTargets(targets);
  return evidence.some((item) => {
    if (normalizedTargets.length === 0) {
      if (!hasAnyStructuredArtifactEvidence(item)) return false;
    } else if (!normalizedTargets.some((target) => structuredArtifactEvidenceMatchesPath(item, target))) {
      return false;
    }
    return validateArtifactFreshness(item, options);
  });
}

export function hasStructuredArtifactEvidenceForPath(
  evidence: Array<Pick<EvidenceRecord, "data" | "ownerScope" | "createdAt">>,
  path: string,
  options?: { requireFresh?: boolean; currentOwner?: string; maxAgeMs?: number },
): boolean {
  return evidence.some((item) => {
    if (!structuredArtifactEvidenceMatchesPath(item, path)) return false;
    return validateArtifactFreshness(item, options);
  });
}

function validateArtifactFreshness(
  evidence: Pick<EvidenceRecord, "data" | "ownerScope" | "createdAt">,
  options?: { requireFresh?: boolean; currentOwner?: string; maxAgeMs?: number },
): boolean {
  if (!options?.requireFresh) return true;

  // Owner check: artifact must belong to current owner
  if (options.currentOwner) {
    const evidenceOwner = evidence.ownerScope?.ownerSessionId ?? evidence.ownerScope?.ownerAgentId;
    if (!evidenceOwner || evidenceOwner !== options.currentOwner) {
      return false;
    }
  }

  // Freshness check: artifact must be recent
  if (options.maxAgeMs !== undefined && evidence.createdAt) {
    const ageMs = Date.now() - new Date(evidence.createdAt).getTime();
    if (ageMs > options.maxAgeMs) {
      return false;
    }
  }

  return true;
}

export function structuredArtifactEvidenceMatchesPath(
  evidence: Pick<EvidenceRecord, "data">,
  path: string,
): boolean {
  const artifactHint = readEvidenceDataRecord(evidence, "artifactHint");
  if (
    artifactHint?.exists === true &&
    typeof artifactHint.path === "string" &&
    pathsReferToSameArtifact(artifactHint.path, path)
  ) {
    return true;
  }

  const binaryPreflight = readEvidenceDataRecord(evidence, "binaryPreflight");
  return (
    typeof binaryPreflight?.path === "string" &&
    pathsReferToSameArtifact(binaryPreflight.path, path)
  );
}

export function hasAnyStructuredArtifactEvidence(evidence: Pick<EvidenceRecord, "data">): boolean {
  const artifactHint = readEvidenceDataRecord(evidence, "artifactHint");
  if (artifactHint?.exists === true && typeof artifactHint.path === "string") return true;

  const binaryPreflight = readEvidenceDataRecord(evidence, "binaryPreflight");
  return typeof binaryPreflight?.path === "string";
}

export function readEvidenceDataRecord(
  evidence: { data?: unknown },
  key: string,
): Record<string, unknown> | undefined {
  if (!evidence.data || typeof evidence.data !== "object") return undefined;
  const value = (evidence.data as Record<string, unknown>)[key];
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

export function uniqueArtifactTargets(targets: string[]): string[] {
  const out = new Set<string>();
  for (const target of targets) {
    const trimmed = target.trim();
    if (!trimmed) continue;
    out.add(trimmed);
    const basename = trimmed.split(/[\\/]/u).filter(Boolean).at(-1);
    if (basename) out.add(basename);
  }
  return Array.from(out);
}

export function pathsReferToSameArtifact(actual: string, target: string): boolean {
  return pathsReferToSameLocation(actual, target);
}

export function pathsReferToSameArtifactHint(actual: string, target: string): boolean {
  const normalizedActual = normalizeArtifactHintPath(actual);
  const normalizedTarget = normalizeArtifactHintPath(target);
  return (
    normalizedActual === normalizedTarget ||
    basenameLike(normalizedActual) === basenameLike(normalizedTarget)
  );
}

function normalizeArtifactHintPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").toLowerCase();
}

function basenameLike(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}
