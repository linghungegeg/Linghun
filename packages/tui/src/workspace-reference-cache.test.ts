import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  type WorkspaceReferenceDimensions,
  createWorkspaceReferenceCache,
  getWorkspaceReferenceSnapshot,
} from "./workspace-reference-cache.js";

function dimensions(
  overrides: Partial<WorkspaceReferenceDimensions> = {},
): WorkspaceReferenceDimensions {
  return {
    configHash: "config-a",
    toolSchemaHash: "tools-a",
    providerModelHash: "provider-model-a",
    mcpToolListHash: "mcp-a",
    indexFreshnessHash: "index-a",
    compactBoundaryHash: "compact-a",
    extensionListHash: "extensions-a",
    ...overrides,
  };
}

describe("workspace reference cache", () => {
  it("uses bounded summaries and hits without repeating full scans", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-workspace-cache-"));
    await writeFile(join(project, "README.md"), "# Demo\nsmall summary only\n", "utf8");
    const cache = createWorkspaceReferenceCache();
    const readmeStat = await stat(join(project, "README.md"));
    const scan = vi.fn(async () => ({
      dimensions: dimensions(),
      files: [
        {
          path: "README.md",
          exists: true,
          readable: true,
          size: readmeStat.size,
          mtimeMs: Math.trunc(readmeStat.mtimeMs),
          hash: "bounded-file-hash",
        },
      ],
      directories: [],
      runtimeStatus: { permissionMode: "default", model: { provider: "deepseek", name: "m" } },
      toolCapabilitySummary: "/read Read files",
      evidenceRefs: ["evidence-1"],
      logRefs: ["logs/run.log"],
    }));
    const input = {
      projectPath: project,
      dimensions: dimensions(),
      runtimeStatus: { permissionMode: "default" },
      toolCapabilitySummary: "/read Read files",
      evidenceRefs: ["evidence-1"],
      logRefs: ["logs/run.log"],
      watchedFiles: ["README.md"],
      watchedDirectories: [],
    };

    const first = await getWorkspaceReferenceSnapshot(cache, input, scan);
    const second = await getWorkspaceReferenceSnapshot(cache, input, scan);

    expect(first.source).toBe("miss");
    expect(second.source).toBe("hit");
    expect(scan).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(second)).not.toContain("small summary only");
    expect(JSON.stringify(second)).not.toContain("sk-");
    expect(JSON.stringify(second)).not.toContain("raw provider request");
    expect(second.files[0]?.hash).toBe("bounded-file-hash");
  });

  it("invalidates on file stats, content hash, and runtime dimensions", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-workspace-cache-"));
    await writeFile(join(project, "README.md"), "alpha", "utf8");
    const cache = createWorkspaceReferenceCache();

    const first = await getWorkspaceReferenceSnapshot(cache, {
      projectPath: project,
      dimensions: dimensions(),
      runtimeStatus: { model: "m" },
      toolCapabilitySummary: "tools",
    });
    await writeFile(join(project, "README.md"), "beta changed", "utf8");
    const fileChanged = await getWorkspaceReferenceSnapshot(cache, {
      projectPath: project,
      dimensions: dimensions(),
      runtimeStatus: { model: "m" },
      toolCapabilitySummary: "tools",
    });
    const dimensionChanged = await getWorkspaceReferenceSnapshot(cache, {
      projectPath: project,
      dimensions: dimensions({ providerModelHash: "provider-model-b" }),
      runtimeStatus: { model: "m" },
      toolCapabilitySummary: "tools",
    });

    expect(first.source).toBe("miss");
    expect(fileChanged.source).toBe("stale");
    expect(fileChanged.changedKeys).toContain("fileStatHash");
    expect(dimensionChanged.source).toBe("stale");
    expect(dimensionChanged.changedKeys).toContain("providerModelHash");
  });

  it("falls back to the original path when cache scan fails", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-workspace-cache-"));
    const cache = createWorkspaceReferenceCache();
    const snapshot = await getWorkspaceReferenceSnapshot(
      cache,
      {
        projectPath: project,
        dimensions: dimensions(),
        runtimeStatus: { index: { status: "unknown" } },
        toolCapabilitySummary: "tools",
      },
      async () => {
        throw new Error("scan failed");
      },
    );

    expect(snapshot.source).toBe("fallback");
    expect(snapshot.changedKeys).toContain("workspaceReferenceUnavailable");
    expect(cache.failures).toBe(1);
  });

  it("tracks directory summary changes without storing directory contents", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-workspace-cache-"));
    await mkdir(join(project, ".linghun"));
    const cache = createWorkspaceReferenceCache();

    await getWorkspaceReferenceSnapshot(cache, {
      projectPath: project,
      dimensions: dimensions(),
      runtimeStatus: {},
      toolCapabilitySummary: "tools",
    });
    await writeFile(join(project, ".linghun", "settings.json"), "{}", "utf8");
    const snapshot = await getWorkspaceReferenceSnapshot(cache, {
      projectPath: project,
      dimensions: dimensions(),
      runtimeStatus: {},
      toolCapabilitySummary: "tools",
    });

    expect(snapshot.source).toBe("stale");
    expect(snapshot.changedKeys).toContain("directorySummaryHash");
    expect(JSON.stringify(snapshot)).not.toContain("settings raw content");
  });

  it("adds metadata-only workspace snapshot lite with ignore boundaries", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-workspace-cache-"));
    await mkdir(join(project, "src"));
    await mkdir(join(project, "node_modules"));
    await mkdir(join(project, "tmp"));
    await mkdir(join(project, "cache"));
    await writeFile(
      join(project, "src", "index.ts"),
      "export const secret = 'not stored';",
      "utf8",
    );
    await writeFile(
      join(project, "package.json"),
      JSON.stringify({ scripts: { test: "vitest" } }),
      "utf8",
    );
    await writeFile(join(project, ".gitignore"), "tmp/\n", "utf8");
    await writeFile(join(project, ".cbmignore"), "cache/\n", "utf8");
    const cache = createWorkspaceReferenceCache();

    const snapshot = await getWorkspaceReferenceSnapshot(cache, {
      projectPath: project,
      dimensions: dimensions(),
      runtimeStatus: {},
      toolCapabilitySummary: "tools",
      watchedFiles: ["package.json", ".gitignore", ".cbmignore"],
      watchedDirectories: ["."],
      fileHashBytes: 8,
    });

    expect(snapshot.workspaceSnapshot?.bounded).toBe(true);
    expect(snapshot.workspaceSnapshot?.counts.directories).toBeGreaterThanOrEqual(1);
    expect(snapshot.workspaceSnapshot?.counts.ignored).toBeGreaterThanOrEqual(3);
    expect(snapshot.workspaceSnapshot?.entries.some((entry) => entry.path === "src")).toBe(true);
    expect(
      snapshot.workspaceSnapshot?.entries.some(
        (entry) => entry.ignoredReason === "hard-skip:node_modules",
      ),
    ).toBe(true);
    expect(
      snapshot.workspaceSnapshot?.entries.some(
        (entry) => entry.ignoredReason === ".gitignore:tmp/",
      ),
    ).toBe(true);
    expect(
      snapshot.workspaceSnapshot?.ignoreSources.some(
        (source) => source.path === ".cbmignore" && source.readable,
      ),
    ).toBe(true);
    expect(
      snapshot.workspaceSnapshot?.entries.some(
        (entry) => entry.ignoredReason === "hard-skip:cache",
      ),
    ).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain("not stored");
    expect(JSON.stringify(snapshot)).not.toContain("vitest");
  });

  it("tracks bounded workspace snapshot changed summary", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-workspace-cache-"));
    const appPath = join(project, "app.ts");
    await writeFile(appPath, "alpha", "utf8");
    const cache = createWorkspaceReferenceCache();

    const first = await getWorkspaceReferenceSnapshot(cache, {
      projectPath: project,
      dimensions: dimensions(),
      runtimeStatus: {},
      toolCapabilitySummary: "tools",
      watchedFiles: ["app.ts"],
      watchedDirectories: ["."],
      fileHashBytes: 4,
    });
    const firstStat = await stat(appPath);
    await writeFile(appPath, "bravo", "utf8");
    await utimes(appPath, firstStat.atime, firstStat.mtime);
    const changed = await getWorkspaceReferenceSnapshot(cache, {
      projectPath: project,
      dimensions: dimensions(),
      runtimeStatus: {},
      toolCapabilitySummary: "tools",
      watchedFiles: ["app.ts"],
      watchedDirectories: ["."],
      fileHashBytes: 4,
    });
    await rm(appPath);
    const deleted = await getWorkspaceReferenceSnapshot(cache, {
      projectPath: project,
      dimensions: dimensions(),
      runtimeStatus: {},
      toolCapabilitySummary: "tools",
      watchedFiles: ["app.ts"],
      watchedDirectories: ["."],
      fileHashBytes: 4,
    });

    expect(first.workspaceSnapshot?.changedSummary?.changedKeys).toEqual([]);
    expect(changed.source).toBe("stale");
    expect(changed.changedKeys).toContain("workspaceSnapshotHash");
    expect(changed.workspaceSnapshot?.changedSummary?.changedKeys).toContain(
      "workspaceSnapshotModified",
    );
    expect(deleted.workspaceSnapshot?.changedSummary?.changedKeys).toContain(
      "workspaceSnapshotDeleted",
    );
  });

  it("keeps watched file hashing on bounded open/read path", async () => {
    const source = await readFile(
      join(process.cwd(), "packages/tui/src/workspace-reference-cache.ts"),
      "utf8",
    );

    expect(source).toContain('await open(absolutePath, "r")');
    expect(source).toContain("handle.read(buffer, 0, bytesToRead, 0)");
    expect(source).not.toContain("await readFile(absolutePath)");
  });
});
