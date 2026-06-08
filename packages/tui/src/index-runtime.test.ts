import { describe, expect, it } from "vitest";
import {
  createCurrentIndexProjectNameCandidates,
  findCurrentIndexProject,
  getCodebaseMemoryArtifactDir,
  getCodebaseMemoryGraphPath,
} from "./index-runtime.js";

describe("index runtime project selection", () => {
  it("keeps codebase-memory artifact path separate from Linghun storage.index metadata", () => {
    expect(getCodebaseMemoryArtifactDir("F:\\Linghun")).toBe("F:\\Linghun\\.codebase-memory");
    expect(getCodebaseMemoryGraphPath("F:\\Linghun")).toBe(
      "F:\\Linghun\\.codebase-memory\\graph.db.zst",
    );
  });

  it("prefers root_path over name candidates", () => {
    const project = findCurrentIndexProject(
      {
        projects: [
          { name: "Linghun", root_path: "F:/Other" },
          { name: "indexed-by-root", root_path: "F:/Linghun" },
        ],
      },
      "F:/Linghun",
    );

    expect(project).toEqual({
      name: "indexed-by-root",
      rootPath: "F:/Linghun",
      source: "root_path",
    });
  });

  it("selects a unique basename candidate", () => {
    const project = findCurrentIndexProject(
      {
        projects: [{ name: "sample-project" }],
      },
      "/tmp/sample-project",
    );

    expect(project).toEqual({ name: "sample-project", source: "name-candidate" });
  });

  it("builds Windows drive and basename candidates dynamically", () => {
    expect(createCurrentIndexProjectNameCandidates("F:\\Linghun")).toEqual(
      new Set(["linghun", "f-linghun"]),
    );

    const project = findCurrentIndexProject(
      {
        projects: [{ name: "F-Linghun", root_path: "" }],
      },
      "F:\\Linghun",
    );

    expect(project).toEqual({
      name: "F-Linghun",
      rootPath: "",
      source: "name-candidate",
    });
  });

  it("matches root_path and name candidates case-insensitively", () => {
    expect(
      findCurrentIndexProject(
        {
          projects: [{ name: "x", root_path: "f:/linghun" }],
        },
        "F:/Linghun",
      ),
    ).toEqual({ name: "x", rootPath: "f:/linghun", source: "root_path" });

    expect(
      findCurrentIndexProject(
        {
          projects: [{ name: "F-LINGHUN" }],
        },
        "F:/Linghun",
      ),
    ).toEqual({ name: "F-LINGHUN", source: "name-candidate" });
  });

  it("does not guess when name candidates are ambiguous", () => {
    const project = findCurrentIndexProject(
      {
        projects: [{ name: "Linghun" }, { name: "F-Linghun" }],
      },
      "F:/Linghun",
    );

    expect(project).toBeNull();
  });

  it("returns null for malformed or missing list_projects data", () => {
    expect(findCurrentIndexProject(null, "F:/Linghun")).toBeNull();
    expect(findCurrentIndexProject({ projects: "bad" }, "F:/Linghun")).toBeNull();
    expect(
      findCurrentIndexProject({ projects: [{ root_path: "F:/Linghun" }] }, "F:/Linghun"),
    ).toBeNull();
  });
});
