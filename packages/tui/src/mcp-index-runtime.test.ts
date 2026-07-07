import { describe, expect, test } from "vitest";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "@linghun/config";
import { createIndexState } from "./index-runtime.js";
import { summarizeIndexResult } from "./index-result-presenter.js";
import {
  configureMcpIndexRuntime,
  executeExtraTool,
  findBundledCodebaseMemoryBinary,
  refreshIndexStatus,
  isSupportiveIndexEvidence,
  runIndexRepository,
} from "./mcp-index-runtime.js";

async function writeMockCodebaseMemory(
  projectPath: string,
  mockDir: string,
  options: {
    projects?: Array<{ name: string; root_path?: string }>;
    status?: string;
    versionExitCode?: number;
  } = {},
): Promise<string> {
  const mockPath = join(mockDir, "codebase-memory-mock.cjs");
  const projects = options.projects ?? [{ name: "F-Linghun", root_path: projectPath }];
  await writeFile(
    mockPath,
    `if (process.argv.includes("--version")) {
  console.log("codebase-memory-mcp mock 0.0.0");
  process.exit(${options.versionExitCode ?? 0});
}
const tool = process.argv[3];
if (tool === "list_projects") {
  console.log(JSON.stringify({ projects: ${JSON.stringify(projects)} }));
} else if (tool === "index_status") {
  console.log(JSON.stringify({ status: ${JSON.stringify(options.status ?? "ready")}, nodes: 11, edges: 7 }));
} else {
  console.log(JSON.stringify({ ok: true }));
}
`,
    "utf8",
  );
  return mockPath;
}

async function writeLocalArtifact(
  projectPath: string,
  artifact: { project?: string; nodes?: number; edges?: number } = {},
): Promise<void> {
  const dir = join(projectPath, ".codebase-memory");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "graph.db.zst"), "mock-graph", "utf8");
  await writeFile(
    join(dir, "artifact.json"),
    JSON.stringify({
      schema_version: 1,
      indexed_at: "2026-06-04T00:00:00Z",
      project: artifact.project ?? "F-Linghun",
      nodes: artifact.nodes ?? 5,
      edges: artifact.edges ?? 4,
    }),
    "utf8",
  );
}

function createIndexContext(projectPath: string, mockPath?: string, enabled = true) {
  const config = {
    ...defaultConfig,
    index: { ...defaultConfig.index, enabled },
    mcp: {
      ...defaultConfig.mcp,
      enabledServers: enabled ? ["codebase-memory"] : [],
      servers: {
        ...defaultConfig.mcp.servers,
        "codebase-memory": {
          ...defaultConfig.mcp.servers["codebase-memory"],
          command: mockPath ?? "missing-codebase-memory-for-test",
          args: [],
        },
      },
    },
  };
  return {
    config,
    projectPath,
    index: createIndexState(config),
  };
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

describe("mcp-index-runtime", () => {
  test("pre-engine deferred tools degrade when the binary is unavailable", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-pre-engine-degrade-"));
    const context = {
      ...createIndexContext(projectPath),
      discoveredDeferredToolNames: new Set<string>(["pre_plan"]),
      mcp: { enabled: false, servers: [], tools: [] },
      skills: { enabled: false, skills: [], trustedIds: [], disabledIds: [] },
      plugins: { enabled: false, plugins: [], trustedIds: [], disabledIds: [] },
    };
    configureMcpIndexRuntime({
      getCurrentFreshness: () => ({} as never),
      writeStatus: () => undefined,
      checkBackgroundStartGuard: () => null,
      ensureSession: async () => "session-test",
      rememberBackgroundTask: () => undefined,
      appendBackgroundTaskEvent: async () => undefined,
      rememberEvidence: () => undefined,
      resolvePreEngineBinary: async () => undefined,
    });

    const result = await executeExtraTool(
      { tool_name: "pre_plan", params: { task: "inspect repository" } },
      context as never,
    );

    expect(result.ok).toBe(true);
    expect(result).toMatchObject({ degraded: true });
    expect(result.text).toContain("降级");
    expect(result.text).toContain("已跳过 AST 预分析");
  });

  test("findBundledCodebaseMemoryBinary resolves platform optional package binaries", async () => {
    const packageRoot = await mkdtemp(join(tmpdir(), "linghun-codebase-memory-pkg-"));
    const platformArch = "win32-x64";
    const binary = join(
      packageRoot,
      "bundled",
      "codebase-memory",
      platformArch,
      "codebase-memory-mcp.exe",
    );
    await mkdir(join(packageRoot, "bundled", "codebase-memory", platformArch), { recursive: true });
    await writeFile(binary, "mock binary", "utf8");
    await chmod(binary, 0o755);
    const previousPlatform = process.env.LINGHUN_CODEBASE_MEMORY_PLATFORM_ARCH_TEST;
    const previousBundledDir = process.env.LINGHUN_CODEBASE_MEMORY_BUNDLED_DIR;
    const previousCliBundledRoot = process.env.LINGHUN_CLI_BUNDLED_ROOT;
    process.env.LINGHUN_CODEBASE_MEMORY_PLATFORM_ARCH_TEST = platformArch;
    delete process.env.LINGHUN_CODEBASE_MEMORY_BUNDLED_DIR;
    delete process.env.LINGHUN_CLI_BUNDLED_ROOT;
    configureMcpIndexRuntime({
      getCurrentFreshness: () => ({} as never),
      writeStatus: () => undefined,
      checkBackgroundStartGuard: () => null,
      ensureSession: async () => "session-test",
      rememberBackgroundTask: () => undefined,
      appendBackgroundTaskEvent: async () => undefined,
      rememberEvidence: () => undefined,
      resolveCodebaseMemoryPackageRoot: (packageName) =>
        packageName === "@linghun/codebase-memory-win32-x64" ? packageRoot : undefined,
    });

    try {
      const bundled = await findBundledCodebaseMemoryBinary();

      expect(bundled?.detailPath).toBe(binary);
      expect(bundled?.command).toBe(binary);
    } finally {
      restoreEnv("LINGHUN_CODEBASE_MEMORY_PLATFORM_ARCH_TEST", previousPlatform);
      restoreEnv("LINGHUN_CODEBASE_MEMORY_BUNDLED_DIR", previousBundledDir);
      restoreEnv("LINGHUN_CLI_BUNDLED_ROOT", previousCliBundledRoot);
    }
  });

  test("refreshIndexStatus resolves real project status when settings enable codebase-memory and artifact exists", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-index-ready-"));
    await writeLocalArtifact(projectPath, { project: "F-Linghun", nodes: 5, edges: 4 });
    const mockPath = await writeMockCodebaseMemory(projectPath, projectPath);
    const context = createIndexContext(projectPath, mockPath);

    await refreshIndexStatus(context as never);

    expect(context.index.status).toBe("ready");
    expect(context.index.projectName).toBe("F-Linghun");
    expect(context.index.nodes).toBe(11);
    expect(context.index.edges).toBe(7);
    expect(context.index.artifactStatus).toBe("ready");
    expect(context.index.status).not.toBe("unknown");
  });

  test("refreshIndexStatus uses the current artifact and CLI project name instead of a hardcoded project", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "custom-index-project-"));
    await writeLocalArtifact(projectPath, { project: "CustomProject", nodes: 3, edges: 2 });
    const mockPath = await writeMockCodebaseMemory(projectPath, projectPath, {
      projects: [{ name: "CustomProject", root_path: projectPath }],
    });
    const context = createIndexContext(projectPath, mockPath);

    await refreshIndexStatus(context as never);

    expect(context.index.status).toBe("ready");
    expect(context.index.projectName).toBe("CustomProject");
    expect(context.index.projectName).not.toBe("F-Linghun");
  });

  test("runIndexRepository enforces resource guard even when called directly", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-index-direct-guard-"));
    const output = { text: "", write(chunk: string) { this.text += chunk; return true; } };
    const context = {
      ...createIndexContext(projectPath),
      language: "zh-CN",
      backgroundTasks: [
        {
          id: "index-existing",
          kind: "index",
          title: "Index refresh",
          status: "running",
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          heartbeatIntervalMs: 30_000,
          staleAfterMs: 120_000,
          hasOutput: false,
          userVisibleSummary: "running",
        },
      ],
    };
    configureMcpIndexRuntime({
      getCurrentFreshness: () => ({} as never),
      writeStatus: () => undefined,
      checkBackgroundStartGuard: () =>
        "并发上限：index 后台任务已达到上限 1；请等待完成、查看 /background，或用 /interrupt 取消后重试。这是 resource/concurrency cap，不是权限拒绝。",
      ensureSession: async () => "session-test",
      rememberBackgroundTask: () => undefined,
      appendBackgroundTaskEvent: async () => undefined,
      rememberEvidence: () => undefined,
    });

    await runIndexRepository(context as never, "fast", "refresh", false, output as never);

    expect(context.index.status).toBe("error");
    expect(context.index.error).toContain("resource/concurrency cap");
    expect(output.text).toContain("index 后台任务已达到上限");
  });

  test("refreshIndexStatus keeps artifact-backed unknown-project distinct from missing", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-index-unmatched-"));
    await writeLocalArtifact(projectPath, { project: "F-Linghun", nodes: 5, edges: 4 });
    const mockPath = await writeMockCodebaseMemory(projectPath, projectPath, {
      projects: [{ name: "other-project", root_path: join(projectPath, "other") }],
    });
    const context = createIndexContext(projectPath, mockPath);

    await refreshIndexStatus(context as never);

    expect(context.index.status).toBe("unknown-project");
    expect(context.index.projectName).toBe("F-Linghun");
    expect(context.index.artifactStatus).toBe("ready");
    expect(context.index.error).toContain("graph.db.zst");
  });

  test("refreshIndexStatus distinguishes disabled and corrupt artifact states", async () => {
    const disabledProject = await mkdtemp(join(tmpdir(), "linghun-index-disabled-"));
    const disabledContext = createIndexContext(disabledProject, undefined, false);
    await refreshIndexStatus(disabledContext as never);
    expect(disabledContext.index.status).toBe("disabled");
    expect(disabledContext.index.artifactStatus).toBe("disabled");

    const corruptProject = await mkdtemp(join(tmpdir(), "linghun-index-corrupt-"));
    await mkdir(join(corruptProject, ".codebase-memory"), { recursive: true });
    await writeFile(join(corruptProject, ".codebase-memory", "graph.db.zst"), "", "utf8");
    const mockPath = await writeMockCodebaseMemory(corruptProject, corruptProject, {
      projects: [],
    });
    const corruptContext = createIndexContext(corruptProject, mockPath);

    await refreshIndexStatus(corruptContext as never);

    expect(corruptContext.index.status).toBe("error");
    expect(corruptContext.index.artifactStatus).toBe("corrupt");
    expect(corruptContext.index.error).toContain("graph.db.zst");
  });

  test("summarizeIndexResult handles search_graph results", () => {
    const searchGraphData = {
      total: 2,
      search_mode: "bm25",
      results: [
        {
          name: "OpenAiCompatibleProvider",
          qualified_name: "F-Linghun.packages.providers.src.OpenAiCompatibleProvider",
          label: "Class",
          file_path: "packages/providers/src/index.ts",
          start_line: 630,
          end_line: 812,
          rank: -16.5,
        },
        {
          name: "constructor",
          qualified_name: "F-Linghun.packages.providers.src.OpenAiCompatibleProvider.constructor",
          label: "Method",
          file_path: "packages/providers/src/index.ts",
          start_line: 631,
          end_line: 634,
          rank: -16.91979686818925,
        },
      ],
      has_more: false,
    };

    const summary = summarizeIndexResult("search_graph", searchGraphData);

    expect(summary).toContain("Index search（语义符号搜索，最多 5 条）");
    expect(summary).toContain("total: 2");
    expect(summary).toContain("search mode: bm25");
    expect(summary).toContain("OpenAiCompatibleProvider");
    expect(summary).toContain("packages/providers/src/index.ts");
    expect(summary).toContain("source: codebase-memory search_graph");
  });

  test("summarizeIndexResult handles empty search_graph results", () => {
    const emptyData = {
      total: 0,
      search_mode: "bm25",
      results: [],
      has_more: false,
    };

    const summary = summarizeIndexResult("search_graph", emptyData);

    expect(summary).toContain("Index search（语义符号搜索，最多 5 条）");
    expect(summary).toContain("total: 0");
    expect(summary).toContain("no matches");
  });

  test("summarizeIndexResult handles get_architecture results", () => {
    const archData = {
      project: "F-Linghun",
      total_nodes: 3725,
      total_edges: 8068,
      node_labels: [
        { label: "Class", count: 100 },
        { label: "Function", count: 500 },
      ],
      edge_types: [
        { type: "CALLS", count: 3000 },
        { type: "IMPORTS", count: 2000 },
      ],
    };

    const summary = summarizeIndexResult("get_architecture", archData);

    expect(summary).toContain("Index architecture（短摘要）");
    expect(summary).toContain("project: F-Linghun");
    expect(summary).toContain("graph: 3725 nodes, 8068 edges");
    expect(summary).toContain("Class 100");
    expect(summary).toContain("CALLS 3000");
  });

  test("isSupportiveIndexEvidence rejects missing/stale/error/status-only summaries", () => {
    const context = {
      index: { status: "ready", projectName: "F-Linghun" },
    };

    expect(isSupportiveIndexEvidence(context as never, "search missing", "Index: missing")).toBe(
      false,
    );
    expect(isSupportiveIndexEvidence(context as never, "search stale", "Index status: stale")).toBe(
      false,
    );
    expect(
      isSupportiveIndexEvidence(context as never, "search none", "Index search\n- no matches"),
    ).toBe(false);
    expect(
      isSupportiveIndexEvidence(context as never, "status", "Index status ready; nodes=10"),
    ).toBe(false);
  });

  test("isSupportiveIndexEvidence accepts ready search summaries with real code facts", () => {
    const context = {
      index: { status: "ready", projectName: "F-Linghun" },
    };

    expect(
      isSupportiveIndexEvidence(
        context as never,
        "search OpenAiCompatibleProvider",
        "Index search\n- #1 path packages/providers/src/index.ts symbol OpenAiCompatibleProvider",
      ),
    ).toBe(true);
  });

  test("isSupportiveIndexEvidence treats architecture aggregates as supplemental only", () => {
    const context = {
      index: { status: "ready", projectName: "F-Linghun" },
    };

    expect(
      isSupportiveIndexEvidence(
        context as never,
        "architecture",
        "Index architecture\n- graph: 3725 nodes, 8068 edges\n- node labels: Class 100, Function 500\n- edge types: CALLS 3000, IMPORTS 2000",
      ),
    ).toBe(false);
  });
});
