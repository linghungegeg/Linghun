import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import {
  type WorkspaceReferenceDimensions,
  createWorkspaceReferenceCache,
  getWorkspaceReferenceSnapshot,
  isFallbackWorkspaceReferenceSnapshot,
  workspaceReferenceHash,
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

    expect(snapshot.source).toBe("fallback-empty");
    expect(snapshot.changedKeys).toContain("workspaceReferenceUnavailable");
    expect(snapshot.changedKeys).toContain("fallback-empty");
    expect(cache.failures).toBe(1);
    expect(isFallbackWorkspaceReferenceSnapshot(snapshot)).toBe(true);
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

  it("coalesces concurrent probes with identical input into a single scan", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-workspace-cache-"));
    await writeFile(join(project, "README.md"), "# Coalesce test\n", "utf8");
    const cache = createWorkspaceReferenceCache();
    let scanCount = 0;
    const scan = vi.fn(async (input: { projectPath: string }) => {
      scanCount += 1;
      // Simulate async work
      await new Promise((resolve) => setTimeout(resolve, 20));
      const readmeStat = await stat(join(input.projectPath, "README.md"));
      return {
        dimensions: dimensions(),
        files: [
          {
            path: "README.md",
            exists: true,
            readable: true,
            size: readmeStat.size,
            mtimeMs: Math.trunc(readmeStat.mtimeMs),
            hash: "coalesce-hash",
          },
        ],
        directories: [],
        runtimeStatus: { permissionMode: "default" },
        toolCapabilitySummary: "/read Read files",
        evidenceRefs: [],
        logRefs: [],
      };
    });
    const input = {
      projectPath: project,
      dimensions: dimensions(),
      runtimeStatus: { permissionMode: "default" },
      toolCapabilitySummary: "/read Read files",
      evidenceRefs: [],
      logRefs: [],
      watchedFiles: ["README.md"],
      watchedDirectories: [],
    };

    // Fire 3 concurrent calls with identical input
    const [r1, r2, r3] = await Promise.all([
      getWorkspaceReferenceSnapshot(cache, input, scan),
      getWorkspaceReferenceSnapshot(cache, input, scan),
      getWorkspaceReferenceSnapshot(cache, input, scan),
    ]);

    // Only one scan should have been triggered
    expect(scan).toHaveBeenCalledTimes(1);
    // All results should be identical
    expect(r1.key).toBe(r2.key);
    expect(r2.key).toBe(r3.key);
    expect(r1.files[0]?.hash).toBe("coalesce-hash");
    expect(r2.files[0]?.hash).toBe("coalesce-hash");
    expect(r3.files[0]?.hash).toBe("coalesce-hash");
    // After resolution, pending probe should be cleared
    expect(cache._pendingProbe).toBeUndefined();
    expect(cache._pendingProbeInputHash).toBeUndefined();
  });

  it("does not coalesce concurrent probes when evidenceRefs or logRefs or runtimeStatus differ", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-workspace-cache-"));
    await writeFile(join(project, "README.md"), "# No-coalesce test\n", "utf8");
    const cache = createWorkspaceReferenceCache();
    const scan = vi.fn(
      async (input: {
        projectPath: string;
        evidenceRefs?: string[];
        logRefs?: string[];
        runtimeStatus?: unknown;
      }) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        const readmeStat = await stat(join(input.projectPath, "README.md"));
        return {
          dimensions: dimensions(),
          files: [
            {
              path: "README.md",
              exists: true,
              readable: true,
              size: readmeStat.size,
              mtimeMs: Math.trunc(readmeStat.mtimeMs),
              hash: "no-coalesce-hash",
            },
          ],
          directories: [],
          runtimeStatus: input.runtimeStatus ?? { permissionMode: "default" },
          toolCapabilitySummary: "/read Read files",
          evidenceRefs: input.evidenceRefs ?? [],
          logRefs: input.logRefs ?? [],
        };
      },
    );
    const baseInput = {
      projectPath: project,
      dimensions: dimensions(),
      toolCapabilitySummary: "/read Read files",
      watchedFiles: ["README.md"],
      watchedDirectories: [],
    };

    // Concurrent calls with different evidenceRefs
    const [rA, rB] = await Promise.all([
      getWorkspaceReferenceSnapshot(
        cache,
        { ...baseInput, runtimeStatus: { mode: "a" }, evidenceRefs: ["ev-1"], logRefs: [] },
        scan,
      ),
      getWorkspaceReferenceSnapshot(
        cache,
        { ...baseInput, runtimeStatus: { mode: "a" }, evidenceRefs: ["ev-2"], logRefs: [] },
        scan,
      ),
    ]);

    // Must NOT coalesce — scan called at least 2 times
    expect(scan).toHaveBeenCalledTimes(2);
    // Each snapshot preserves its own evidence
    expect(rA.evidenceRefs).toContain("ev-1");
    expect(rB.evidenceRefs).toContain("ev-2");

    // Reset for logRefs test
    scan.mockClear();
    const cache2 = createWorkspaceReferenceCache();
    const [rC, rD] = await Promise.all([
      getWorkspaceReferenceSnapshot(
        cache2,
        { ...baseInput, runtimeStatus: { mode: "x" }, evidenceRefs: [], logRefs: ["log-a"] },
        scan,
      ),
      getWorkspaceReferenceSnapshot(
        cache2,
        { ...baseInput, runtimeStatus: { mode: "x" }, evidenceRefs: [], logRefs: ["log-b"] },
        scan,
      ),
    ]);
    expect(scan).toHaveBeenCalledTimes(2);
    expect(rC.logRefs).toContain("log-a");
    expect(rD.logRefs).toContain("log-b");

    // Reset for runtimeStatus test
    scan.mockClear();
    const cache3 = createWorkspaceReferenceCache();
    const [rE, rF] = await Promise.all([
      getWorkspaceReferenceSnapshot(
        cache3,
        { ...baseInput, runtimeStatus: { model: "gpt-4" }, evidenceRefs: [], logRefs: [] },
        scan,
      ),
      getWorkspaceReferenceSnapshot(
        cache3,
        { ...baseInput, runtimeStatus: { model: "claude" }, evidenceRefs: [], logRefs: [] },
        scan,
      ),
    ]);
    expect(scan).toHaveBeenCalledTimes(2);
    expect(rE.runtimeStatus).toEqual({ model: "gpt-4" });
    expect(rF.runtimeStatus).toEqual({ model: "claude" });

    // Pending probe cleared after all
    expect(cache3._pendingProbe).toBeUndefined();
    expect(cache3._pendingProbeInputHash).toBeUndefined();
  });

  it("keeps watched file hashing on bounded open/read path", async () => {
    const source = await readFile(join(__dirname, "workspace-reference-cache.ts"), "utf8");

    expect(source).toContain('await open(absolutePath, "r")');
    expect(source).toContain("handle.read(buffer, 0, bytesToRead, 0)");
    expect(source).not.toContain("await readFile(absolutePath)");
  });
});

// ---------------------------------------------------------------------------
// D.13V-A item 3 — fallback / stale / fresh 语义可区分
//   修复 P0-4：fallback 路径不再静默冒充上次成功；区分 fallback-stale
//   （cache.latest 存在，复用旧 files 但显式打 source 标）和 fallback-empty
//   （连 cache.latest 也没有）。hash 编码 source，连续两次 fallback 不会被当
//   稳定状态。caller 可用 isFallbackWorkspaceReferenceSnapshot 把 fallback
//   降级为 stale-fallback / missing。
// ---------------------------------------------------------------------------
describe("D.13V-A item 3: workspace reference cache fallback semantics", () => {
  it("fallback-empty 在没有 prev cache 时出现，files/directories 为空", async () => {
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
    expect(snapshot.source).toBe("fallback-empty");
    expect(snapshot.files).toEqual([]);
    expect(snapshot.directories).toEqual([]);
    expect(isFallbackWorkspaceReferenceSnapshot(snapshot)).toBe(true);
  });

  it("fallback-stale 在有 prev cache 时出现，复用旧 files 但 source 显式标 stale", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-workspace-cache-"));
    await writeFile(join(project, "README.md"), "# v1\n", "utf8");
    const cache = createWorkspaceReferenceCache();
    // 第一次成功 scan，让 cache.latest 有内容
    const fresh = await getWorkspaceReferenceSnapshot(cache, {
      projectPath: project,
      dimensions: dimensions(),
      runtimeStatus: {},
      toolCapabilitySummary: "tools",
    });
    expect(["miss", "rescanned", "stale"]).toContain(fresh.source);
    expect(isFallbackWorkspaceReferenceSnapshot(fresh)).toBe(false);

    // 触发 cache miss + 异常 → fallback 路径
    const stale = await getWorkspaceReferenceSnapshot(
      cache,
      {
        projectPath: project,
        dimensions: dimensions({ configHash: "config-b" }),
        runtimeStatus: { index: { status: "ready" } },
        toolCapabilitySummary: "tools",
      },
      async () => {
        throw new Error("scan failed");
      },
    );
    expect(stale.source).toBe("fallback-stale");
    expect(isFallbackWorkspaceReferenceSnapshot(stale)).toBe(true);
    // files/directories 复用了旧 cache.latest（不为空，但 source 已经显式标 stale）
    expect(stale.files.length).toBeGreaterThan(0);
  });

  it("workspaceReferenceHash 把 source 编码进 hash —— fallback 与 fresh 必产不同 hash", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-workspace-cache-"));
    await writeFile(join(project, "README.md"), "# hash check\n", "utf8");
    const cache = createWorkspaceReferenceCache();
    const fresh = await getWorkspaceReferenceSnapshot(cache, {
      projectPath: project,
      dimensions: dimensions(),
      runtimeStatus: {},
      toolCapabilitySummary: "tools",
    });
    const stale = await getWorkspaceReferenceSnapshot(
      cache,
      {
        projectPath: project,
        dimensions: dimensions({ configHash: "config-different" }),
        runtimeStatus: {},
        toolCapabilitySummary: "tools",
      },
      async () => {
        throw new Error("scan failed");
      },
    );
    expect(workspaceReferenceHash(fresh)).not.toBe(workspaceReferenceHash(stale));
  });

  it("isFallbackWorkspaceReferenceSnapshot 对 fresh/missing 返回 false", () => {
    expect(isFallbackWorkspaceReferenceSnapshot(undefined)).toBe(false);
    expect(
      isFallbackWorkspaceReferenceSnapshot({
        key: "k",
        source: "miss",
        createdAt: "",
        changedKeys: [],
        dimensions: dimensions(),
        files: [],
        directories: [],
        runtimeStatus: {},
        toolCapabilitySummary: "tools",
        evidenceRefs: [],
        logRefs: [],
      }),
    ).toBe(false);
    expect(
      isFallbackWorkspaceReferenceSnapshot({
        key: "k",
        source: "rescanned",
        createdAt: "",
        changedKeys: [],
        dimensions: dimensions(),
        files: [],
        directories: [],
        runtimeStatus: {},
        toolCapabilitySummary: "tools",
        evidenceRefs: [],
        logRefs: [],
      }),
    ).toBe(false);
  });

  it("isFallbackWorkspaceReferenceSnapshot 对所有 fallback 变体返回 true", () => {
    for (const source of ["fallback", "fallback-stale", "fallback-empty"] as const) {
      expect(
        isFallbackWorkspaceReferenceSnapshot({
          key: "k",
          source,
          createdAt: "",
          changedKeys: [],
          dimensions: dimensions(),
          files: [],
          directories: [],
          runtimeStatus: {},
          toolCapabilitySummary: "tools",
          evidenceRefs: [],
          logRefs: [],
        }),
      ).toBe(true);
    }
  });
});
