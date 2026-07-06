import type { EvidenceRecord } from "./tui-data-types.js";

export function hasStructuredArtifactEvidence(
  evidence: Array<Pick<EvidenceRecord, "data">>,
  targets: string[],
): boolean {
  const normalizedTargets = uniqueArtifactTargets(targets);
  return evidence.some((item) => {
    if (normalizedTargets.length === 0) return hasAnyStructuredArtifactEvidence(item);
    return normalizedTargets.some((target) => structuredArtifactEvidenceMatchesPath(item, target));
  });
}

export function hasStructuredArtifactEvidenceForPath(
  evidence: Array<Pick<EvidenceRecord, "data">>,
  path: string,
): boolean {
  return evidence.some((item) => structuredArtifactEvidenceMatchesPath(item, path));
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
  const normalizedActual = normalizeArtifactEvidencePath(actual);
  const normalizedTarget = normalizeArtifactEvidencePath(target);
  return (
    normalizedActual === normalizedTarget ||
    basenameLike(normalizedActual) === basenameLike(normalizedTarget)
  );
}

function normalizeArtifactEvidencePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").toLowerCase();
}

function basenameLike(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}
