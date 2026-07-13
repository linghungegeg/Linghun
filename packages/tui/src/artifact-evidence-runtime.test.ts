import { describe, expect, it } from "vitest";
import {
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
        [{ data: { artifactHint: { path: "dist/report.md", exists: true } } }],
        "docs/report.md",
      ),
    ).toBe(false);
  });

  it("keeps basename matching explicit for user-facing artifact hints", () => {
    expect(pathsReferToSameArtifactHint("dist/report.md", "report.md")).toBe(true);
  });
});
