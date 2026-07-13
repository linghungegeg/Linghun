import { describe, expect, it } from "vitest";
import {
  hasStructuredArtifactEvidence,
  hasStructuredArtifactEvidenceForPath,
  pathsReferToSameArtifact,
  pathsReferToSameArtifactHint,
} from "./artifact-evidence-runtime.js";

describe("artifact evidence path matching", () => {
  it("matches the same artifact path across separators and Windows casing", () => {
    expect(pathsReferToSameArtifact("DIST\\Report.md", "dist/report.md")).toBe(
      process.platform === "win32",
    );
    expect(pathsReferToSameArtifact("dist\\report.md", "dist/report.md")).toBe(true);
    expect(pathsReferToSameArtifact("dist/report.md/", "dist/report.md")).toBe(true);
  });

  it("does not treat same-basename artifacts in different directories as the same evidence", () => {
    expect(pathsReferToSameArtifact("dist/report.md", "docs/report.md")).toBe(false);
    expect(
      hasStructuredArtifactEvidenceForPath(
        [{ data: { artifactHint: { path: "dist/report.md", exists: true } }, createdAt: new Date().toISOString() }],
        "docs/report.md",
      ),
    ).toBe(false);
  });

  it("keeps basename matching explicit for user-facing artifact hints", () => {
    expect(pathsReferToSameArtifactHint("dist/report.md", "report.md")).toBe(true);
  });
});

describe("artifact evidence freshness validation", () => {
  it("accepts artifacts without freshness requirements", () => {
    const evidence = [
      {
        data: { artifactHint: { path: "out.txt", exists: true } },
        createdAt: new Date(Date.now() - 60_000).toISOString(),
      },
    ];
    expect(hasStructuredArtifactEvidenceForPath(evidence, "out.txt")).toBe(true);
  });

  it("rejects stale artifacts when freshness is required", () => {
    const staleEvidence = [
      {
        data: { artifactHint: { path: "out.txt", exists: true } },
        createdAt: new Date(Date.now() - 10_000).toISOString(),
        ownerScope: { ownerSessionId: "session-1" },
      },
    ];
    expect(
      hasStructuredArtifactEvidenceForPath(staleEvidence, "out.txt", {
        requireFresh: true,
        maxAgeMs: 5_000,
      }),
    ).toBe(false);
  });

  it("accepts fresh artifacts when freshness is required", () => {
    const freshEvidence = [
      {
        data: { artifactHint: { path: "out.txt", exists: true } },
        createdAt: new Date(Date.now() - 2_000).toISOString(),
        ownerScope: { ownerSessionId: "session-1" },
      },
    ];
    expect(
      hasStructuredArtifactEvidenceForPath(freshEvidence, "out.txt", {
        requireFresh: true,
        maxAgeMs: 5_000,
      }),
    ).toBe(true);
  });

  it("rejects artifacts from different owner when owner check is required", () => {
    const wrongOwnerEvidence = [
      {
        data: { artifactHint: { path: "out.txt", exists: true } },
        createdAt: new Date().toISOString(),
        ownerScope: { ownerSessionId: "session-old" },
      },
    ];
    expect(
      hasStructuredArtifactEvidenceForPath(wrongOwnerEvidence, "out.txt", {
        requireFresh: true,
        currentOwner: "session-new",
      }),
    ).toBe(false);
  });

  it("accepts artifacts from current owner", () => {
    const correctOwnerEvidence = [
      {
        data: { artifactHint: { path: "out.txt", exists: true } },
        createdAt: new Date().toISOString(),
        ownerScope: { ownerSessionId: "session-current" },
      },
    ];
    expect(
      hasStructuredArtifactEvidenceForPath(correctOwnerEvidence, "out.txt", {
        requireFresh: true,
        currentOwner: "session-current",
      }),
    ).toBe(true);
  });

  it("works with hasStructuredArtifactEvidence for multiple targets", () => {
    const mixedEvidence = [
      {
        data: { artifactHint: { path: "fresh.txt", exists: true } },
        createdAt: new Date(Date.now() - 1_000).toISOString(),
        ownerScope: { ownerSessionId: "session-1" },
      },
      {
        data: { artifactHint: { path: "stale.txt", exists: true } },
        createdAt: new Date(Date.now() - 20_000).toISOString(),
        ownerScope: { ownerSessionId: "session-1" },
      },
    ];
    expect(
      hasStructuredArtifactEvidence(mixedEvidence, ["fresh.txt"], {
        requireFresh: true,
        maxAgeMs: 5_000,
      }),
    ).toBe(true);
    expect(
      hasStructuredArtifactEvidence(mixedEvidence, ["stale.txt"], {
        requireFresh: true,
        maxAgeMs: 5_000,
      }),
    ).toBe(false);
  });
});
