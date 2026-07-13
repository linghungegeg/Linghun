import { describe, expect, it } from "vitest";
import {
  hasStructuredArtifactEvidenceForPath,
  pathsReferToSameArtifact,
  pathsReferToSameArtifactHint,
  validateArtifactFreshness,
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

describe("validateArtifactFreshness", () => {
  const now = new Date("2024-01-01T12:00:00.000Z");
  const projectPath = "/workspace/project";

  it("validates artifact with requireFresh=false (existence only)", () => {
    const evidence = {
      data: { artifactHint: { path: "dist/report.md", exists: true } },
      createdAt: new Date(now.getTime() - 60 * 60 * 1000).toISOString(), // 1 hour old
      ownerScope: {
        ownerSessionId: "session-1",
        requestTurnId: "turn-1",
        cwd: projectPath,
      },
      kind: "command_output" as const,
    };

    expect(
      validateArtifactFreshness(
        evidence,
        {
          currentRequestTurnId: "turn-1",
          sessionId: "session-1",
          projectPath,
        },
        { requireFresh: false, now },
      ),
    ).toBe(true);
  });

  it("rejects artifact with missing createdAt when requireFresh=true", () => {
    const evidence = {
      data: { artifactHint: { path: "dist/report.md", exists: true } },
      createdAt: "",
      ownerScope: {
        ownerSessionId: "session-1",
        requestTurnId: "turn-1",
        cwd: projectPath,
      },
      kind: "command_output" as const,
    };

    expect(
      validateArtifactFreshness(
        evidence,
        {
          currentRequestTurnId: "turn-1",
          sessionId: "session-1",
          projectPath,
        },
        { requireFresh: true, now },
      ),
    ).toBe(false);
  });

  it("rejects artifact with invalid createdAt when requireFresh=true", () => {
    const evidence = {
      data: { artifactHint: { path: "dist/report.md", exists: true } },
      createdAt: "invalid-date",
      ownerScope: {
        ownerSessionId: "session-1",
        requestTurnId: "turn-1",
        cwd: projectPath,
      },
      kind: "command_output" as const,
    };

    expect(
      validateArtifactFreshness(
        evidence,
        {
          currentRequestTurnId: "turn-1",
          sessionId: "session-1",
          projectPath,
        },
        { requireFresh: true, now },
      ),
    ).toBe(false);
  });

  it("rejects stale artifact when requireFresh=true", () => {
    const evidence = {
      data: { artifactHint: { path: "dist/report.md", exists: true } },
      createdAt: new Date(now.getTime() - 40 * 60 * 1000).toISOString(), // 40 minutes old
      ownerScope: {
        ownerSessionId: "session-1",
        requestTurnId: "turn-1",
        cwd: projectPath,
      },
      kind: "command_output" as const,
    };

    expect(
      validateArtifactFreshness(
        evidence,
        {
          currentRequestTurnId: "turn-1",
          sessionId: "session-1",
          projectPath,
        },
        { requireFresh: true, maxAgeMs: 30 * 60 * 1000, now },
      ),
    ).toBe(false);
  });

  it("accepts fresh artifact with matching owner when requireFresh=true", () => {
    const evidence = {
      data: { artifactHint: { path: "dist/report.md", exists: true } },
      createdAt: new Date(now.getTime() - 10 * 60 * 1000).toISOString(), // 10 minutes old
      ownerScope: {
        ownerSessionId: "session-1",
        requestTurnId: "turn-1",
        cwd: projectPath,
      },
      kind: "command_output" as const,
    };

    expect(
      validateArtifactFreshness(
        evidence,
        {
          currentRequestTurnId: "turn-1",
          sessionId: "session-1",
          projectPath,
        },
        { requireFresh: true, now },
      ),
    ).toBe(true);
  });

  it("rejects artifact from different requestTurnId when requireFresh=true", () => {
    const evidence = {
      data: { artifactHint: { path: "dist/report.md", exists: true } },
      createdAt: new Date(now.getTime() - 5 * 60 * 1000).toISOString(),
      ownerScope: {
        ownerSessionId: "session-1",
        requestTurnId: "turn-OLD",
        cwd: projectPath,
      },
      kind: "command_output" as const,
    };

    expect(
      validateArtifactFreshness(
        evidence,
        {
          currentRequestTurnId: "turn-NEW",
          sessionId: "session-1",
          projectPath,
        },
        { requireFresh: true, now },
      ),
    ).toBe(false);
  });

  it("rejects artifact from different session when requireFresh=true", () => {
    const evidence = {
      data: { artifactHint: { path: "dist/report.md", exists: true } },
      createdAt: new Date(now.getTime() - 5 * 60 * 1000).toISOString(),
      ownerScope: {
        ownerSessionId: "session-OLD",
        requestTurnId: "turn-1",
        cwd: projectPath,
      },
      kind: "command_output" as const,
    };

    expect(
      validateArtifactFreshness(
        evidence,
        {
          currentRequestTurnId: "turn-1",
          sessionId: "session-NEW",
          projectPath,
        },
        { requireFresh: true, now },
      ),
    ).toBe(false);
  });

  it("rejects artifact from agent when requireFresh=true", () => {
    const evidence = {
      data: { artifactHint: { path: "dist/report.md", exists: true } },
      createdAt: new Date(now.getTime() - 5 * 60 * 1000).toISOString(),
      ownerScope: {
        ownerSessionId: "session-1",
        requestTurnId: "turn-1",
        ownerAgentId: "agent-123",
        cwd: projectPath,
      },
      kind: "command_output" as const,
    };

    expect(
      validateArtifactFreshness(
        evidence,
        {
          currentRequestTurnId: "turn-1",
          sessionId: "session-1",
          projectPath,
        },
        { requireFresh: true, now },
      ),
    ).toBe(false);
  });

  it("rejects artifact without ownerScope when requireFresh=true", () => {
    const evidence = {
      data: { artifactHint: { path: "dist/report.md", exists: true } },
      createdAt: new Date(now.getTime() - 5 * 60 * 1000).toISOString(),
      kind: "command_output" as const,
    };

    expect(
      validateArtifactFreshness(
        evidence,
        {
          currentRequestTurnId: "turn-1",
          sessionId: "session-1",
          projectPath,
        },
        { requireFresh: true, now },
      ),
    ).toBe(false);
  });

  it("accepts user_provided evidence when requireFresh=true", () => {
    const evidence = {
      data: { artifactHint: { path: "dist/report.md", exists: true } },
      createdAt: new Date(now.getTime() - 5 * 60 * 1000).toISOString(),
      kind: "user_provided" as const,
    };

    expect(
      validateArtifactFreshness(
        evidence,
        {
          currentRequestTurnId: "turn-1",
          sessionId: "session-1",
          projectPath,
        },
        { requireFresh: true, now },
      ),
    ).toBe(true);
  });
});
