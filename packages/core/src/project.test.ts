import { describe, expect, it } from "vitest";
import { identifyProject, normalizeProjectPath } from "./project.js";

describe("project identity", () => {
  it("creates a stable project id for the same path", () => {
    const left = identifyProject("F:/Linghun");
    const right = identifyProject("F:/Linghun");

    expect(left.projectId).toBe(right.projectId);
    expect(left.projectName).toBe("Linghun");
  });

  it("normalizes Windows path separators and case", () => {
    expect(normalizeProjectPath("F:/Linghun")).toBe(normalizeProjectPath("f:\\Linghun"));
  });

  it("does not use raw path characters in project id", () => {
    const identity = identifyProject("F:/Linghun");

    expect(identity.projectId).toMatch(/^[a-f0-9]{16}$/);
    expect(identity.projectId).not.toContain(":");
    expect(identity.projectId).not.toContain("\\");
  });
});
