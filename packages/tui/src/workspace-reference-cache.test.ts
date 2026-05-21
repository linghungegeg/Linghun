import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
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
});
