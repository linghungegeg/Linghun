import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { Readable, Writable } from "node:stream";
import { type LinghunConfig, defaultConfig, getSessionRootDir } from "@linghun/config";
import { SessionStore } from "@linghun/core";
import { computePromptCacheHitRate } from "@linghun/core";
import { createToolContext } from "@linghun/tools";
import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyIndexSafetyRepairContinuation } from "./index-safety-repair.js";
import {
  type BackgroundTaskState,
  type TuiContext,
  USER_VISIBLE_DISPATCH_SLASH_COMMANDS,
  type VerificationReport,
  createCacheState,
  createHookState,
  createIndexState,
  createMcpState,
  createMemoryState,
  createModelSystemPrompt,
  createPluginState,
  createSkillState,
  createSolutionCompletenessStatus,
  createWorkflowState,
  handleNaturalInput,
  handleSlashCommand,
  recordModelUsage,
  runTui,
  validateCodebaseMemoryToolExecution,
  validateExtensionContributionExecution,
  writeLightHintsForTest,
} from "./index.js";
import { validateCommandCapabilityCoverage } from "./natural-command-bridge.js";
import { formatModelToolPermissionPrompt } from "./permission-presenter.js";
import { formatProviderFailurePrimary } from "./request-lifecycle-presenter.js";
import { createLayeredToolOutput, formatToolOutput } from "./tool-output-presenter.js";

class MemoryOutput extends Writable {
  text = "";

  override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: () => void): void {
    this.text += chunk.toString();
    callback();
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function mockOpenAiTextFetch(finalText = "done"): unknown[] {
  const requests: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)));
      const body = `data: ${JSON.stringify({ id: "chatcmpl-test", choices: [{ delta: { content: finalText } }] })}\n\ndata: [DONE]\n\n`;
      return new Response(body, { status: 200 });
    }),
  );
  return requests;
}

function mockOpenAiEmptyFetch(body = "data: [DONE]\n\n"): unknown[] {
  const requests: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)));
      return new Response(body, { status: 200 });
    }),
  );
  return requests;
}

function mockOpenAiErrorFetch(): unknown[] {
  const requests: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)));
      const body = `data: ${JSON.stringify({ error: { message: "quota exceeded" } })}\n\ndata: [DONE]\n\n`;
      return new Response(body, { status: 200 });
    }),
  );
  return requests;
}

function mockOpenAiToolFetch(toolName: string, input: unknown, finalText = "done"): unknown[] {
  return mockOpenAiToolSequence([{ toolName, input }], finalText);
}

function mockOpenAiToolSequence(
  toolCalls: Array<{ toolName: string; input: unknown }>,
  finalText = "done",
): unknown[] {
  const requests: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)));
      const toolCall = toolCalls[requests.length - 1];
      const body = toolCall
        ? [
            `data: ${JSON.stringify({
              id: `chatcmpl-test-${requests.length}`,
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        id: `call-${requests.length}`,
                        type: "function",
                        function: {
                          name: toolCall.toolName,
                          arguments: JSON.stringify(toolCall.input),
                        },
                      },
                    ],
                  },
                },
              ],
            })}\n\n`,
            "data: [DONE]\n\n",
          ].join("")
        : `data: ${JSON.stringify({ id: `chatcmpl-test-${requests.length}`, choices: [{ delta: { content: finalText } }] })}\n\ndata: [DONE]\n\n`;
      return new Response(body, { status: 200 });
    }),
  );
  return requests;
}

async function createMockCodebaseMemoryBinary(
  project: string,
  mockDir: string,
  changes: { changed_count?: number; changed_files?: string[] } = { changed_count: 0 },
  options: {
    versionOutput?: string;
    versionExitCode?: number;
    status?: string;
    fileName?: string;
  } = {},
): Promise<{ callsPath: string; mockPath: string }> {
  const callsPath = join(mockDir, `${options.fileName ?? "codebase-memory-mock"}-calls.jsonl`);
  const mockPath = join(mockDir, `${options.fileName ?? "codebase-memory-mock"}.cjs`);
  await writeFile(
    mockPath,
    `const fs = require("node:fs");
if (process.argv.includes("--version")) {
  ${options.versionExitCode && options.versionExitCode !== 0 ? `console.error(${JSON.stringify(options.versionOutput ?? "broken mock")});\n  process.exit(${options.versionExitCode});` : `console.log(${JSON.stringify(options.versionOutput ?? "codebase-memory-mcp mock 0.0.0")});\n  process.exit(0);`}
}
const tool = process.argv[3];
const input = JSON.parse(process.argv[4] || "{}");
fs.appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify({ tool, input }) + "\\n");
if (tool === "list_projects") {
  console.log(JSON.stringify({ projects: [{ name: "test-project", root_path: ${JSON.stringify(project)} }] }));
} else if (tool === "index_status") {
  console.log(JSON.stringify({ status: ${JSON.stringify(options.status ?? "ready")}, nodes: 2, edges: 1 }));
} else if (tool === "detect_changes") {
  console.log(JSON.stringify(${JSON.stringify(changes)}));
} else if (tool === "index_repository") {
  console.log(JSON.stringify({ ok: true }));
} else if (tool === "search_code") {
  console.log(JSON.stringify({
    total_results: 7,
    results: [{
      path: "src/入口.ts",
      symbol: "main",
      raw_source: "RAW_SOURCE_HEAD " + "x".repeat(1000) + " RAW_SOURCE_TAIL_SHOULD_NOT_DUMP"
    }]
  }));
} else if (tool === "get_architecture") {
  console.log(JSON.stringify({
    project: "test-project",
    total_nodes: 12,
    total_edges: 8,
    node_labels: [{ label: "File", count: 3 }, { label: "Function", count: 9 }],
    edge_types: [{ type: "CALLS", count: 4 }, { type: "IMPORTS", count: 4 }],
    graph: "FULL_GRAPH_SHOULD_NOT_DUMP " + "x".repeat(1000)
  }));
} else {
  console.error("unexpected tool " + tool);
  process.exit(2);
}
`,
    "utf8",
  );
  return { callsPath, mockPath };
}

async function createMockCodebaseMemoryConfig(
  project: string,
  mockDir: string,
  changes: { changed_count?: number; changed_files?: string[] } = { changed_count: 0 },
  options: {
    versionOutput?: string;
    versionExitCode?: number;
    status?: string;
    fileName?: string;
  } = {},
): Promise<{ config: LinghunConfig; callsPath: string; mockPath: string }> {
  const { callsPath, mockPath } = await createMockCodebaseMemoryBinary(
    project,
    mockDir,
    changes,
    options,
  );
  return {
    callsPath,
    mockPath,
    config: {
      ...defaultConfig,
      mcp: {
        ...defaultConfig.mcp,
        servers: {
          ...defaultConfig.mcp.servers,
          "codebase-memory": {
            command: mockPath,
            args: [],
          },
        },
      },
    },
  };
}

async function readMockCalls(callsPath: string): Promise<string[]> {
  try {
    return (await readFile(callsPath, "utf8"))
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line).tool as string);
  } catch {
    return [];
  }
}

const windowsIt = process.platform === "win32" ? it : it.skip;

async function createTestContext(
  project: string,
  store: SessionStore,
  session: { id: string; model: string; permissionMode: TuiContext["permissionMode"] },
  config: LinghunConfig = defaultConfig,
): Promise<TuiContext> {
  return {
    store,
    sessionId: session.id,
    model: session.model,
    permissionMode: session.permissionMode,
    projectPath: project,
    tools: createToolContext(project),
    permissions: { rules: [], recentDenied: [] },
    language: "zh-CN",
    config,
    backgroundTasks: [],
    checkpoints: [],
    evidence: [],
    cache: createCacheState(project),
    mcp: createMcpState(config),
    index: createIndexState(config),
    memory: {
      projectRulesPath: join(project, "LINGHUN.md"),
      projectRulesExists: false,
      projectRulesSummary: "missing",
      projectDir: join(project, ".linghun", "memory"),
      userDir: join(project, ".user-memory"),
      sessionDir: join(project, ".linghun", "memory", "session"),
      candidates: [],
      accepted: [],
    },
    skills: await createSkillState(config, project),
    workflows: createWorkflowState(config),
    hooks: await createHookState(config, project),
    plugins: await createPluginState(config, project),
    agents: [],
    roleUsage: [],
    routeDecisions: [],
    roleHandoffs: [],
    visionObservations: [],
    imageResults: [],
    interrupt: { type: "idle" },
    recentlyMentionedFiles: [],
    lastProviderFailure: undefined,
    solutionCompleteness: createSolutionCompletenessStatus(),
  };
}

function createBackgroundTaskFixture(
  kind: BackgroundTaskState["kind"],
  overrides: Partial<BackgroundTaskState> = {},
): BackgroundTaskState {
  const now = new Date().toISOString();
  return {
    id: `${kind}-${Math.random().toString(16).slice(2, 8)}`,
    kind,
    title: `${kind} fixture`,
    status: "running",
    currentStep: "running",
    progress: { completed: 0, total: 1, label: kind },
    startedAt: now,
    updatedAt: now,
    lastOutputAt: now,
    heartbeatIntervalMs: 30_000,
    staleAfterMs: 120_000,
    logPath: join(tmpdir(), `${kind}.log`),
    outputPath: join(tmpdir(), `${kind}.log`),
    hasOutput: true,
    userVisibleSummary: `${kind} is running`,
    nextAction: "wait or interrupt",
    ...overrides,
  };
}

function createVerificationReportFixture(status: VerificationReport["status"]): VerificationReport {
  const now = new Date().toISOString();
  return {
    id: `verify-${status}`,
    status,
    summary: `${status.toUpperCase()} fixture`,
    commands: [
      {
        kind: "smoke",
        command: "node --version",
        reason: "fixture",
        status,
        exitCode: status === "pass" ? 0 : 1,
        durationMs: 1,
        logPath: join(tmpdir(), `verify-${status}.log`),
        summary: `${status} command`,
      },
    ],
    unverified: status === "pass" ? [] : [`${status} not verified`],
    risk: status === "pass" ? [] : [`${status} risk`],
    logPath: join(tmpdir(), `verify-${status}`),
    startedAt: now,
    endedAt: now,
    durationMs: 1,
    nextAction: status === "pass" ? "review" : "rerun /verify",
  };
}

async function waitForTestCondition(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for test condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("Phase 06 TUI slash commands", () => {
  it("detects catalog drift against real user-visible slash dispatch", () => {
    expect(validateCommandCapabilityCoverage([...USER_VISIBLE_DISPATCH_SLASH_COMMANDS])).toEqual(
      [],
    );
    expect(
      validateCommandCapabilityCoverage([
        ...USER_VISIBLE_DISPATCH_SLASH_COMMANDS,
        "/missing-command",
      ]),
    ).toContain("dispatch missing registry /missing-command");
  });

  it("shows a non-misleading TUI title on startup", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from(["/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(output.text).toContain("Linghun TUI / REPL");
    expect(output.text).not.toContain("Phase 14 TUI / REPL");
  });

  it("shows help, model, and session list", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleSlashCommand("/status", context, output);
    await handleSlashCommand("/help", context, output);
    await handleSlashCommand("/model", context, output);
    await handleSlashCommand("/sessions", context, output);

    expect(output.text).toContain("/sessions resume <id>");
    expect(output.text).toContain("/resume [id]");
    expect(output.text).toContain("/branch [目的]");
    expect(output.text).toContain("/memory storage");
    expect(output.text).toContain("/memory review");
    expect(output.text).toContain("/memory accept <id>");
    expect(output.text).toContain("/features");
    expect(output.text).toContain("/model doctor");
    expect(output.text).toContain("/model route");
    expect(output.text).toContain("/model route doctor");
    expect(output.text).toContain("/model route set <role> <model>");
    expect(output.text).toContain("provider=deepseek model=deepseek-v4-flash");
    expect(output.text).toContain("角色路由摘要");
    expect(output.text).toContain("/vision <path>");
    expect(output.text).toContain("/image generate <prompt>");
    expect(output.text).toContain("/skills");
    expect(output.text).toContain("/skills enable <id>");
    expect(output.text).toContain("/workflows <name>");
    expect(output.text).toContain("/plugins doctor");
    expect(output.text).toContain("/doctor [readiness]");
    expect(output.text).toContain("/doctor hooks");
    expect(output.text).toContain("/problems");
    expect(output.text).toContain("Readiness：本地");
    expect(output.text).toContain("非 smoke/Beta PASS");
    expect(output.text).toContain("/agents");
    expect(output.text).toContain("/fork <类型> <任务>");
    expect(output.text).toContain("/cache-log config size <n>");
    expect(output.text).toContain("/cache-log export [path]");
    expect(output.text).toContain("/cache status");
    expect(output.text).toContain("/cache warmup|refresh");
    expect(output.text).toContain("/compact");
    expect(output.text).toContain("/break-cache status");
    expect(output.text).toContain("/mcp status");
    expect(output.text).toContain("/mcp tools");
    expect(output.text).toContain("/index status");
    expect(output.text).toContain("/index search <query>");
    expect(output.text).toContain("/index architecture");
    expect(output.text).toContain("/usage");
    expect(output.text).toContain("/stats endpoints");
    expect(output.text).toContain("/doctor project");
    expect(output.text).toContain("/doctor hooks");
    expect(output.text).toContain("/problems");
    expect(output.text).toContain(
      "当前模型：role=executor provider=deepseek model=deepseek-v4-flash reasoning=未生效",
    );
    expect(output.text).toContain("模式=default");
    expect(output.text).not.toContain("¥--");
    expect(output.text).toContain(session.id);
  });

  it("shows Phase 15.5F readiness doctor and Problems Lite without raw debug leaks", async () => {
    const project = await mkdtemp(join(tmpdir(), "灵魂-readiness-项目-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);
    context.index.status = "stale";
    context.index.staleHint = "changed files need refresh";
    context.lastVerification = createVerificationReportFixture("timeout");
    context.backgroundTasks.push(
      createBackgroundTaskFixture("verification", {
        status: "timeout",
        result: "timeout",
        userVisibleSummary: "timeout at C:\\secret\\Linghun\\raw.log api_key=raw-secret",
        nextAction: "open C:\\secret\\Linghun\\raw.log",
      }),
    );
    context.lastProviderFailure = {
      code: "PROVIDER_BAD_REQUEST",
      provider: "deepseek",
      model: "deepseek-v4-flash-with-a-very-long-model-name-that-should-not-flood-terminal",
      endpointProfile: "chat_completions",
      summary: "raw body sk-test-secret C:\\secret\\Linghun\\provider.json",
      evidenceId: "ev-provider",
      createdAt: new Date().toISOString(),
    };

    await handleSlashCommand("/status", context, output);
    await handleSlashCommand("/doctor", context, output);
    await handleSlashCommand("/problems", context, output);

    expect(output.text).toContain("Readiness：本地");
    expect(output.text).toContain("非 smoke/Beta PASS");
    expect(output.text).toContain(
      "Terminal readiness doctor（仅本地/静态轻量检查；不是真实 smoke）",
    );
    expect(output.text).toContain("这不是 Beta PASS、smoke-ready 或 open-source-ready");
    expect(output.text).toContain("[BLOCKED] verification");
    expect(output.text).toContain("[PARTIAL] background/tasks");
    expect(output.text).toContain("Problems Lite：当前");
    expect(output.text).toContain("Project Doctor Lite: [PARTIAL]");
    expect(output.text).toContain("Source-of-Truth Drift Linter Lite");
    expect(output.text).toContain("Context Picker Lite");
    expect(output.text).toContain("Rollback Coach Lite");
    expect(output.text).toContain("Task Cost Preview Lite");
    expect(output.text).toContain("freshness");
    expect(output.text).toContain("provider");
    expect(output.text).toContain("project");
    expect(output.text).toContain("drift");
    expect(output.text).toContain("context");
    expect(output.text).toContain("rollback");
    expect(output.text).toContain("local-only");
    expect(output.text).toContain("no-real-smoke");
    expect(output.text).not.toContain("¥");
    expect(output.text).not.toContain("$");
    expect(output.text).not.toContain("git reset");
    expect(output.text).not.toContain("git checkout");
    expect(output.text).not.toContain("sk-test-secret");
    expect(output.text).not.toContain("api_key=raw-secret");
    expect(output.text).not.toContain("C:\\secret");
    expect(output.text).not.toContain(project);

    const englishOutput = new MemoryOutput();
    context.language = "en-US";
    await handleSlashCommand("/doctor readiness", context, englishOutput);
    expect(englishOutput.text).toContain(
      "Terminal readiness doctor (local/static only; not real smoke)",
    );
    expect(englishOutput.text).toContain(
      "This is not Beta PASS, smoke-ready, or open-source-ready.",
    );
  });

  it("shows Phase 15.5F Project Doctor, context picker, rollback coach, and cost preview Lite", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-readiness-lite-"));
    await mkdir(join(project, "docs", "delivery"), { recursive: true });
    await mkdir(join(project, ".github", "workflows"), { recursive: true });
    await writeFile(
      join(project, "package.json"),
      JSON.stringify({
        packageManager: "pnpm@10.10.0",
        scripts: {
          build: "tsc -b",
          check: "biome check .",
          test: "vitest run",
          typecheck: "tsc -b",
        },
      }),
      "utf8",
    );
    await writeFile(join(project, "tsconfig.json"), "{}", "utf8");
    await writeFile(join(project, "vitest.config.ts"), "export default {};", "utf8");
    await writeFile(join(project, "biome.json"), "{}", "utf8");
    await writeFile(join(project, "pnpm-lock.yaml"), "lockfileVersion: '9.0'", "utf8");
    await writeFile(join(project, ".github", "workflows", "ci.yml"), "name: ci", "utf8");
    await writeFile(join(project, "LINGHUN.md"), "project rules", "utf8");
    await writeFile(join(project, "LINGHUN_PHASED_DELIVERY_BLUEPRINT.md"), "Phase 15.5F", "utf8");
    await writeFile(join(project, "LINGHUN_IMPLEMENTATION_SPEC.md"), "ProjectFacts", "utf8");
    await writeFile(
      join(project, "docs", "delivery", "pre-open-source-terminal-product-completion-gate.md"),
      "Project Doctor Lite",
      "utf8",
    );
    for (const reportName of [
      "phase-15-5a-performance-context.md",
      "phase-15-5b-resource-task-lifecycle.md",
      "phase-15-5c-editing-tool-ux.md",
      "phase-15-5c-plus-log-artifact-runtime-lite.md",
      "phase-15-5c-plus-plus-workspace-snapshot-lite.md",
      "phase-15-5d-connect-lite.md",
      "phase-15-5e-provider-freshness.md",
    ]) {
      await writeFile(join(project, "docs", "delivery", reportName), "done", "utf8");
    }
    await writeFile(
      join(project, "docs", "delivery", "phase-15-5f-terminal-product-readiness.md"),
      [
        "Project Doctor Lite",
        "Source-of-Truth Drift",
        "未执行真实 full smoke",
        "不代表 Beta PASS、smoke-ready 或 open-source-ready",
        "未进入 Phase 16 / 17 / 18",
        "未 commit",
      ].join("\n"),
      "utf8",
    );
    spawnSync("git", ["init"], { cwd: project, windowsHide: true });
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session);
    context.memory.projectRulesExists = true;
    context.index.status = "ready";
    context.tools.changedFiles.push("packages/tui/src/index.ts");
    context.evidence.push({
      id: "ev-web",
      kind: "web_source",
      summary: "short source",
      source: "https://example.com/source",
      supportsClaims: ["freshness"],
      createdAt: new Date().toISOString(),
    });
    const output = new MemoryOutput();

    await handleSlashCommand("/doctor project", context, output);
    await handleSlashCommand("/problems", context, output);

    expect(output.text).toContain("Project Doctor Lite: [PASS]");
    expect(output.text).toContain("packageManager=pnpm@10.10.0");
    expect(output.text).toContain("scripts=build,check,test,typecheck");
    expect(output.text).toContain("script:test=ok");
    expect(output.text).toContain("script:typecheck=ok");
    expect(output.text).toContain("script:check=ok");
    expect(output.text).toContain("script:build=ok");
    expect(output.text).toContain("Source-of-Truth Drift Linter Lite: [PASS]");
    expect(output.text).toContain("Context Picker Lite: [PARTIAL]");
    expect(output.text).toContain("web-source-evidence");
    expect(output.text).toContain("Rollback Coach Lite: [PARTIAL]");
    expect(output.text).toContain("gitStatus=dirty");
    expect(output.text).toContain("mode=advisory-only");
    expect(output.text).toContain("Task Cost Preview Lite: [PASS]");
    expect(output.text).toContain("local-only");
    expect(output.text).toContain("Problems Lite：当前 2 个问题");
    expect(output.text).toContain("context");
    expect(output.text).toContain("rollback");
    expect(output.text).not.toContain(project);
    expect(output.text).not.toContain("git reset");
    expect(output.text).not.toContain("¥");
    expect(output.text).not.toContain("$");
  });

  it("does not intercept ordinary development requests with the readiness doctor", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-readiness-provider-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        models: { deepseek: { provider: "deepseek", model: "deepseek-v4-flash" } },
        defaultModel: "deepseek-v4-flash",
        providers: {
          deepseek: {
            type: "deepseek",
            baseUrl: "https://api.deepseek.example",
            apiKey: "test-key",
          },
        },
      }),
      "utf8",
    );
    const requests = mockOpenAiTextFetch("普通开发请求已到达 provider。﹤DONE﹥");
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from(["普通开发请求\n/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(requests).toHaveLength(1);
    expect(output.text).toContain("普通开发请求已到达 provider。");
    expect(output.text).not.toContain("Terminal readiness doctor");
  });

  it("reports Compact Lite boundaries without running tools or provider calls", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    context.evidence.push({
      id: "ev-compact",
      kind: "user_provided",
      source: "test",
      summary: "compact evidence",
      supportsClaims: ["compact"],
      createdAt: new Date().toISOString(),
    });
    context.recentlyMentionedFiles.push("README.md");

    await handleSlashCommand("/compact status", context, output);
    await handleSlashCommand("/compact auto", context, output);
    await handleSlashCommand("/compact manual", context, output);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(output.text).toContain("Compact Lite status");
    expect(output.text).toContain("无工具、无文件写入、无额外模型调用");
    expect(output.text).toContain("不执行工具、不写项目文件、不写长期记忆、不启动后台任务");
    expect(context.cache.compactBoundaries).toHaveLength(1);
    expect(context.cache.compactBoundaries[0]?.kind).toBe("manual");
    expect(context.cache.compactBoundaries[0]?.preservedEvidenceRefs).toEqual(["ev-compact"]);
    expect(context.cache.compactBoundaries[0]?.preservedFiles).toEqual(["README.md"]);
    expect(context.permissionMode).toBe("default");
  });

  it("resumes a previous session through structured handoff", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const current = await store.create({ model: "deepseek-v4-flash" });
    const previous = await store.create({ model: "deepseek-v4-pro" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, current);

    await handleSlashCommand(`/sessions resume ${previous.id}`, context, output);

    expect(context.sessionId).toBe(previous.id);
    expect(context.model).toBe("deepseek-v4-pro");
    expect(output.text).toContain(`已恢复会话：${previous.id}`);
    expect(output.text).toContain("不会把完整 transcript 塞回上下文");
    expect(output.text).toContain("Resume context package");
  });

  it("handles Phase 11 memory, resume, branch, and cache freshness", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleSlashCommand("/memory", context, output);
    await handleSlashCommand("/memory storage", context, output);
    await handleSlashCommand("/memory candidate 项目长期规则只保存稳定工程事实", context, output);
    const candidateId = context.memory.candidates[0]?.id;
    await handleSlashCommand("/memory review", context, output);
    await handleSlashCommand(`/memory accept ${candidateId}`, context, output);
    await handleSlashCommand("/break-cache status", context, output);
    await handleSlashCommand("/resume", context, output);
    await handleSlashCommand("/branch 试验另一种实现", context, output);

    expect(output.text).toContain("缺少 LINGHUN.md");
    expect(output.text).toContain("Memory storage");
    expect(output.text).toContain("Memory review");
    expect(output.text).toContain("已写入项目级长期记忆");
    expect(output.text).toContain("memoryHash");
    expect(output.text).toContain("changedKeys: memoryHash");
    expect(output.text).toContain("已创建分支会话");
    expect(output.text).toContain("禁止事项");
  });

  it("loads LINGHUN.md stable summary into resume and freshness", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await writeFile(
      join(project, "LINGHUN.md"),
      `${"长期稳定项目规则 ".repeat(80)}\n- 不要把完整规则文件塞进 prompt/status。`,
      "utf8",
    );
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const loaded = await createMemoryState(defaultConfig, project);
    const context = await createTestContext(project, store, session);
    context.memory = loaded;

    await handleSlashCommand("/memory", context, output);
    await handleSlashCommand("/break-cache status", context, output);
    await handleSlashCommand("/resume", context, output);

    expect(loaded.projectRulesExists).toBe(true);
    expect(loaded.projectRulesSummary).toContain("长期稳定项目规则");
    expect(loaded.projectRulesSummary.length).toBeLessThan(700);
    expect(output.text).toContain("projectRulesSummary");
    expect(output.text).toContain("projectRulesHash");
    expect(output.text).toMatch(/changedKeys: .*projectRulesHash/);
    expect(output.text).toContain("projectRules:");
    expect(output.text).not.toContain(
      "长期稳定项目规则 长期稳定项目规则 长期稳定项目规则 长期稳定项目规则 长期稳定项目规则 长期稳定项目规则 长期稳定项目规则 长期稳定项目规则 长期稳定项目规则 长期稳定项目规则 长期稳定项目规则",
    );
  });

  it("loads accepted memory from disk and uses it in memory freshness", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleSlashCommand("/memory candidate 项目长期规则只保存稳定工程事实", context, output);
    const candidateId = context.memory.candidates[0]?.id;
    await handleSlashCommand(`/memory accept ${candidateId}`, context, output);

    const loaded = await createMemoryState(defaultConfig, project);
    const reloadedContext = await createTestContext(project, store, session);
    reloadedContext.memory = loaded;
    await handleSlashCommand("/memory", reloadedContext, output);
    await handleSlashCommand("/memory review", reloadedContext, output);
    await handleSlashCommand("/break-cache status", reloadedContext, output);

    expect(loaded.accepted).toHaveLength(1);
    expect(loaded.accepted[0]?.summary).toBe("项目长期规则只保存稳定工程事实");
    expect(output.text).toContain("accepted: 1");
    expect(output.text).toContain("项目长期规则只保存稳定工程事实");
    expect(output.text).toContain("memoryHash");
    expect(output.text).toMatch(/changedKeys: .*memoryHash/);
  });

  it("records complete handoff identity and branch parent source", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "gpt-4.1" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session, {
      ...defaultConfig,
      providers: {
        ...defaultConfig.providers,
        "openai-compatible": {
          ...defaultConfig.providers["openai-compatible"],
          apiKey: "test-openai-key",
          baseUrl: "https://example.test/v1",
          model: "gpt-4.1",
        },
      },
    });

    await handleSlashCommand("/branch hardening", context, output);
    const branchId = context.sessionId;
    const resumed = await store.resume(branchId ?? "missing");
    const handoff = resumed.transcript.find((event) => event.type === "handoff_packet");
    const branch = resumed.transcript.find((event) => event.type === "branch_created");

    expect(handoff?.type).toBe("handoff_packet");
    expect(branch?.type).toBe("branch_created");
    expect((handoff as { packet?: { id?: string } }).packet?.id).toBeTruthy();
    expect((handoff as { packet?: { sessionId?: string } }).packet?.sessionId).toBe(branchId);
    expect((handoff as { packet?: { projectPath?: string } }).packet?.projectPath).toBe(project);
    expect((handoff as { packet?: { parentSessionId?: string } }).packet?.parentSessionId).toBe(
      session.id,
    );
    expect(
      (handoff as { packet?: { modelProvider?: { provider?: string } } }).packet?.modelProvider
        ?.provider,
    ).toBe("openai-compatible");
    expect((branch as { branch?: { parentSessionId?: string } }).branch?.parentSessionId).toBe(
      session.id,
    );
    expect((branch as { branch?: { sourceSession?: string } }).branch?.sourceSession).toBe(
      session.id,
    );
    expect(output.text).toContain(`来源 session：${session.id}`);
  });

  it("adds evidence-bound Beta readiness verdict to handoff packets", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "gpt-4.1" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleSlashCommand("/branch verdict gate", context, output);
    const resumed = await store.resume(context.sessionId ?? "missing");
    const handoff = resumed.transcript.find((event) => event.type === "handoff_packet");
    const verdict = (handoff as { packet?: { verdictEvidence?: Record<string, unknown> } }).packet
      ?.verdictEvidence;

    expect(verdict?.scope).toBe("beta");
    expect(verdict?.status).toBe("PARTIAL");
    expect(verdict?.validationCommands).toEqual(
      expect.arrayContaining([expect.stringContaining("pnpm test")]),
    );
    expect(verdict?.uncoveredItems).toEqual(
      expect.arrayContaining([expect.stringContaining("real TUI report-generation")]),
    );
    expect(verdict?.residualRisks).toEqual(
      expect.arrayContaining([expect.stringContaining("mock provider PASS")]),
    );
    expect(output.text).not.toContain("Beta readiness PASS");
  });

  it("downgrades Beta readiness claim when live/report evidence is missing", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "gpt-4.1" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleSlashCommand("/claim-check Beta readiness is PASS", context, output);

    expect(output.text).toContain("verdict=PARTIAL");
    expect(output.text).toContain("scope=beta");
    expect(output.text).toContain("证据已缺失；详情用 /details evidence。");
    expect(output.text).not.toContain("Evidence:");
    expect(output.text).toContain("real TUI report-generation path lacks PASS evidence");
  });

  it("keeps Beta readiness partial when only Write evidence exists", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "gpt-4.1" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);
    context.evidence.push({
      id: "123e4567-e89b-12d3-a456-426614174000",
      kind: "command_output",
      source: "Write",
      summary: "Write: 已写入文件：report.md",
      supportsClaims: ["Write"],
      createdAt: new Date().toISOString(),
    });

    await handleSlashCommand("/claim-check Beta readiness is PASS", context, output);

    expect(output.text).toContain("verdict=PARTIAL");
    expect(output.text).toContain("证据已记录；详情用 /details evidence。");
    expect(output.text).toContain("DeepSeek dual-provider live report evidence is missing");
    expect(output.text).not.toContain("Evidence:");
    expect(output.text).not.toContain("123e4567-e89b-12d3-a456-426614174000");
    expect(output.text).not.toContain("verdict=PASS");
  });

  it("guards deferred codebase-memory tools before blind execution", () => {
    expect(validateCodebaseMemoryToolExecution("get_code_snippet", { project: "test" })).toEqual({
      ok: false,
      summary:
        "MCP deferred tool guard: get_code_snippet 缺少 required args：qualified_name。已拒绝盲执行。",
    });
    expect(validateCodebaseMemoryToolExecution("unknown_tool", {})).toEqual({
      ok: false,
      summary:
        "MCP deferred tool guard: unknown_tool 尚未经过 discovery/schema/trust/runtime 登记，已拒绝执行。请先运行 /mcp doctor 或使用已发现且可信的工具入口。",
    });
    expect(
      validateCodebaseMemoryToolExecution("get_code_snippet", {
        project: "test",
        qualified_name: "packages/tui/src/index.ts#createMcpState",
      }),
    ).toEqual({ ok: true });
  });

  it("rejects unsupported PASS claims without evidence refs", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "gpt-4.1" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleSlashCommand(
      "/claim-check focused tests PASS，mock provider PASS，所以已完成",
      context,
      output,
    );

    expect(output.text).toContain("缺少证据");
    expect(output.text).toContain("已完成");
    expect(output.text).not.toContain("Claim Checker：通过");
  });

  it("keeps Verdict Evidence Gate internals out of ordinary development requests", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        defaultModel: "ordinary-model",
        providers: {
          deepseek: { model: "different-model" },
          "openai-compatible": {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "ordinary-model",
          },
        },
      }),
      "utf8",
    );
    mockOpenAiTextFetch("可以，我会先查看相关文件。﹤DONE﹥");
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from(["帮我修一个普通 bug\n/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(output.text).toContain("可以，我会先查看相关文件");
    expect(output.text).not.toContain("Verdict Evidence Gate");
    expect(output.text).not.toContain("coverage matrix");
    expect(output.text).not.toContain("systemic_gap");
    expect(output.text).not.toContain("verdict=PARTIAL");
  });

  it("keeps Solution Completeness Gate quiet for normal requests", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session);

    const prompt = createModelSystemPrompt("帮我修 bug", context, {
      model: { provider: "deepseek", name: "deepseek-v4-flash" },
    });

    expect(prompt).not.toContain("SYSTEMIC_GAP_WARNING");
    expect(context.solutionCompleteness).toEqual(createSolutionCompletenessStatus());
  });

  it("adds a short report block when triggered output omits classification", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        defaultModel: "solution-gate-model",
        providers: {
          deepseek: { model: "different-model" },
          "openai-compatible": {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "solution-gate-model",
          },
        },
      }),
      "utf8",
    );
    const requests = mockOpenAiTextFetch("我会先检查。﹤DONE﹥");
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from(["不要补丁，先看 CCB，全局有没有漏\n/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(output.text).toContain("Solution Completeness Gate report");
    expect(output.text).toContain("- classification: systemic_gap");
    expect(output.text).toContain("- impactAreas: reference_parity, runtime_behavior");
    expect(output.text).toContain("- phaseBoundary: stay in the current approved scope");
    expect(requests).toHaveLength(1);
    expect(JSON.stringify(requests[0])).toContain("SYSTEMIC_GAP_WARNING");
  });

  it("records Solution Completeness Gate decision in model prompt and handoff", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    const prompt = createModelSystemPrompt("不要缝缝补补，先看 CCB 有没有漏", context, {
      model: { provider: "deepseek", name: "deepseek-v4-flash" },
    });

    expect(prompt).toContain("SYSTEMIC_GAP_WARNING");
    expect(prompt).toContain("single_issue / systemic_gap");
    expect(prompt).toContain("impactAreas=reference_parity,runtime_behavior");
    expect(prompt).toContain("P0/P1/P2");
    expect(prompt).toContain("阶段边界");
    expect(prompt).toContain("验证方式");
    expect(context.solutionCompleteness).toMatchObject({
      triggered: true,
      triggerReason: "user_request",
      classificationRequired: true,
      classification: "unknown",
      impactAreas: ["reference_parity", "runtime_behavior"],
      severity: "unknown",
      requiredBeforeAction: true,
      sourceRefs: [
        "LINGHUN_IMPLEMENTATION_SPEC.md#11.6",
        "LINGHUN_CCB_MATURITY_COMPARISON_REPORT.md#14",
        "docs/delivery/phase-15-natural-command-bridge.md",
      ],
    });
    expect(context.solutionCompleteness.nextRequiredOutput).toContain("single_issue/systemic_gap");

    context.permissions.recentDenied = [
      {
        id: "1",
        toolName: "Bash",
        mode: "plan",
        reason: "Plan 模式禁止写入、编辑和 Bash 执行",
        createdAt: new Date().toISOString(),
      },
      {
        id: "2",
        toolName: "Bash",
        mode: "plan",
        reason: "Plan 模式禁止写入、编辑和 Bash 执行",
        createdAt: new Date().toISOString(),
      },
      {
        id: "3",
        toolName: "Bash",
        mode: "plan",
        reason: "Plan 模式禁止写入、编辑和 Bash 执行",
        createdAt: new Date().toISOString(),
      },
    ];
    const repeatedPrompt = createModelSystemPrompt("帮我继续修", context, {
      model: { provider: "deepseek", name: "deepseek-v4-flash" },
    });
    expect(repeatedPrompt).not.toContain("SYSTEMIC_GAP_WARNING");
    expect(repeatedPrompt).not.toContain("最近同类权限拒绝反复出现");
    expect(context.solutionCompleteness).toMatchObject({
      triggerReason: "repeated_denial",
      classificationRequired: false,
      classification: "unknown",
      impactAreas: [],
      severity: "unknown",
      requiredBeforeAction: false,
    });
    expect(context.solutionCompleteness.evidenceRefs).toContain("permission_denial:Bash:plan");

    await handleSlashCommand("/branch solution gate", context, output);
    const resumed = await store.resume(context.sessionId ?? "missing");
    const handoff = resumed.transcript.find((event) => event.type === "handoff_packet");

    expect(handoff?.type).toBe("handoff_packet");
    expect(
      (handoff as { packet?: { solutionCompleteness?: { classificationRequired?: boolean } } })
        .packet?.solutionCompleteness?.classificationRequired,
    ).toBe(false);
    expect(
      (handoff as { packet?: { solutionCompleteness?: { classification?: string } } }).packet
        ?.solutionCompleteness?.classification,
    ).toBe("unknown");
  });

  it("runs Phase 12 agents with trimmed context, transcript, status, and cancel path", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleSlashCommand("/fork explorer inspect cache", context, output);
    await handleSlashCommand("/fork planner plan agent loop", context, output);
    await handleSlashCommand("/fork verifier verify agent loop", context, output);
    await handleSlashCommand("/agents", context, output);
    await handleSlashCommand(`/agents show ${context.agents[0]?.id}`, context, output);
    await handleSlashCommand("/fork explorer cancellable --background", context, output);
    await handleSlashCommand("/details", context, output);
    await handleSlashCommand(
      `/details background ${context.backgroundTasks[0]?.id}`,
      context,
      output,
    );
    context.evidence.unshift({
      id: "evidence-test-1",
      kind: "command_output",
      source: "test",
      summary: "details evidence summary",
      supportsClaims: ["details full access"],
      createdAt: new Date().toISOString(),
    });
    await handleSlashCommand("/details evidence evidence-test-1", context, output);
    await handleSlashCommand("/details output evidence-test-1", context, output);

    const parentTranscript = (await store.resume(session.id)).transcript;
    const agentTranscript = (
      await store.resume(context.agents[1]?.transcriptSessionId ?? "missing")
    ).transcript;

    expect(output.text).toContain("Agent context package (trimmed)");
    expect(output.text).toContain("notIncluded=full transcript/full memory/full index/large logs");
    expect(output.text).toContain("explorer 摘要");
    expect(output.text).toContain("planner 摘要");
    expect(output.text).toContain("verifier 摘要");
    expect(output.text).toContain("Agents:");
    expect(output.text).toContain("transcript:");
    expect(output.text).toContain("已降级为同步执行");
    expect(output.text).toContain("- full output: /details evidence <id>");
    expect(output.text).toContain("Background agent-");
    expect(output.text).toContain("Evidence evidence-test-1");
    expect(context.agents.filter((agent) => agent.status === "running")).toHaveLength(0);
    expect(context.agents.length).toBe(4);
    expect(parentTranscript.some((event) => event.type === "agent_start")).toBe(true);
    expect(parentTranscript.some((event) => event.type === "agent_end")).toBe(true);
    expect(agentTranscript.some((event) => event.type === "system_event")).toBe(true);
  });

  it("routes Phase 13 roles, handoffs, vision, image, and usage", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleSlashCommand("/model route", context, output);
    await handleSlashCommand("/model doctor", context, output);
    await handleSlashCommand("/model route doctor", context, output);
    await handleSlashCommand("/model route set planner deepseek-v4-pro", context, output);
    await handleSlashCommand("/model route set verifier deepseek-v4-pro", context, output);
    await handleSlashCommand("/fork planner plan route loop", context, output);
    await handleSlashCommand("/fork verifier verify route loop", context, output);
    await handleSlashCommand("/agents", context, output);
    await handleSlashCommand("/review", context, output);
    await handleSlashCommand("/vision screenshot.png", context, output);
    await handleSlashCommand("/model route set vision deepseek-vl", context, output);
    await handleSlashCommand("/vision screenshot.png", context, output);
    await handleSlashCommand("/image generate logo concept", context, output);
    await handleSlashCommand("/model route set image deepseek-image", context, output);
    await handleSlashCommand("/image generate logo concept", context, output);
    await handleSlashCommand("/usage", context, output);
    await handleSlashCommand("/stats", context, output);

    expect(output.text).toContain("Model routes（多模型按角色触发");
    expect(output.text).toContain("Model route doctor");
    expect(output.text).toContain("已设置 planner role");
    expect(output.text).toContain("已设置 verifier role");
    expect(output.text).toContain("role=planner");
    expect(output.text).toContain("role=verifier");
    expect(output.text).toContain("Role handoff: executor -> reviewer");
    expect(output.text).toContain("vision role 未就绪");
    expect(output.text).toContain("VisionObservation:");
    expect(output.text).toContain("image role 未就绪");
    expect(output.text).toContain("ImageGenerationResult:");
    expect(output.text).toContain("role usage (estimated)");
    expect(output.text).toContain("role/model/provider usage (estimated)");
    expect(context.roleHandoffs.some((handoff) => handoff.to === "reviewer")).toBe(true);
    expect(context.visionObservations).toHaveLength(1);
    expect(context.imageResults).toHaveLength(1);
    expect(context.roleUsage.some((usage) => usage.role === "planner")).toBe(true);
    expect(context.roleUsage.some((usage) => usage.role === "verifier")).toBe(true);
    expect(context.roleUsage.some((usage) => usage.role === "vision")).toBe(true);
    expect(context.roleUsage.some((usage) => usage.role === "image")).toBe(true);
    expect(context.routeDecisions.some((decision) => decision.role === "planner")).toBe(true);
    expect(output.text).toContain("fallbackUsed=");
    expect(output.text).not.toContain("¥--");
  });

  it("enforces Freshness Lite warning in primary output when current external facts lack web evidence", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        defaultModel: "freshness-missing-model",
        providers: {
          deepseek: { model: "different-model" },
          "openai-compatible": {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "freshness-missing-model",
          },
        },
      }),
      "utf8",
    );
    const requests = mockOpenAiTextFetch("OpenAI API 当前版本是 example-v1。﹤DONE﹥");
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from(["最新 OpenAI API 版本是什么\n/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(requests).toHaveLength(1);
    expect(JSON.stringify(requests[0])).toContain("FreshnessBoundary=");
    expect(JSON.stringify(requests[0])).toContain("web_source_evidence=missing");
    expect(output.text).toContain("OpenAI API 当前版本是 example-v1");
    expect(output.text).toContain("Freshness 提示：本会话没有 web_source 证据");
    const session = (
      await new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project }).list()
    ).at(0);
    const transcript = await readFile(session?.transcriptPath ?? "", "utf8");
    expect(transcript).toContain(
      "freshness_lite_boundary: sensitive=yes web_source_evidence=missing",
    );
    expect(transcript).toContain("freshness_lite_primary_enforced");
    expect(transcript).toContain("Freshness 提示：本会话没有 web_source 证据");
  });

  it("does not add Freshness Lite primary warning when web_source evidence is present", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        defaultModel: "freshness-present-model",
        providers: {
          deepseek: { model: "different-model" },
          "openai-compatible": {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "freshness-present-model",
          },
        },
      }),
      "utf8",
    );
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const existing = await store.create({ model: "freshness-present-model" });
    await store.appendEvent(existing.id, {
      type: "evidence_record",
      id: "web-source-test",
      kind: "web_source",
      summary: "Official API docs checked in test fixture.",
      source: "https://example.test/docs",
      supportsClaims: ["OpenAI API current version"],
      createdAt: new Date().toISOString(),
    });
    const requests = mockOpenAiTextFetch("根据已有来源，当前版本是 example-v2。﹤DONE﹥");
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from([
        `/sessions resume ${existing.id}\n最新 official OpenAI API 版本是什么\n/exit\n`,
      ]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(requests).toHaveLength(1);
    expect(JSON.stringify(requests[0])).toContain("web_source_evidence=present");
    expect(output.text).toContain("当前版本是 example-v2");
    expect(output.text).not.toContain("Freshness 提示：本会话没有 web_source 证据");
    const transcript = await readFile(existing.transcriptPath, "utf8");
    expect(transcript).toContain(
      "freshness_lite_boundary: sensitive=yes web_source_evidence=present",
    );
    expect(transcript).not.toContain("freshness_lite_primary_enforced");
  });

  it("does not show Freshness Lite warning for ordinary non-freshness requests", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        defaultModel: "ordinary-freshness-model",
        providers: {
          deepseek: { model: "different-model" },
          "openai-compatible": {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "ordinary-freshness-model",
          },
        },
      }),
      "utf8",
    );
    const requests = mockOpenAiTextFetch("我会先整理本地思路。﹤DONE﹥");
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from(["帮我写一句问候\n/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(requests).toHaveLength(1);
    expect(JSON.stringify(requests[0])).not.toContain("FreshnessBoundary=");
    expect(output.text).toContain("我会先整理本地思路");
    expect(output.text).not.toContain("Freshness 提示");
    const session = (
      await new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project }).list()
    ).at(0);
    const transcript = await readFile(session?.transcriptPath ?? "", "utf8");
    expect(transcript).not.toContain("freshness_lite_boundary");
  });

  it("humanizes provider schema mismatch without leaking raw diagnostics in primary output", () => {
    const error = new Error(
      "400 bad request: tool_choice schema mismatch for https://example.invalid/v1?api_key=private-token rawBody request-id=123e4567-e89b-12d3-a456-426614174000",
    ) as Error & { code: string };
    error.code = "PROVIDER_BAD_REQUEST";

    const primary = formatProviderFailurePrimary(error, "en-US");

    expect(primary).toContain("provider rejected the request schema");
    expect(primary).toContain("/model doctor");
    expect(primary).toContain("tool_choice");
    expect(primary).not.toContain("example.invalid");
    expect(primary).not.toContain("private-token");
    expect(primary).not.toContain("123e4567");
  });

  it("preprocesses high-confidence natural model-status wording locally", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        defaultModel: "status-model",
        providers: {
          deepseek: { model: "different-model" },
          "openai-compatible": {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "status-model",
          },
        },
      }),
      "utf8",
    );
    const output = new MemoryOutput();
    const requests = mockOpenAiTextFetch("SHOULD_NOT_CALL_PROVIDER");

    await runTui({
      projectPath: project,
      stdin: Readable.from(["现在是什么模型\n/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(requests).toHaveLength(0);
    expect(output.text).toContain(
      "当前模型：role=executor provider=openai-compatible model=status-model",
    );
    expect(output.text).not.toContain("正在思考…");
    expect(output.text).not.toContain("SHOULD_NOT_CALL_PROVIDER");
    expect(output.text).not.toContain("Start Gate：");
  });

  it("uses executor route for status, model output, doctor, and ordinary requests", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        defaultModel: "gpt-5.5",
        providers: {
          deepseek: {
            type: "deepseek",
            baseUrl: "https://api.deepseek.com/v1",
            apiKey: "sk-test-deepseek-secret",
            model: "deepseek-v4-pro",
          },
          "openai-compatible": {
            type: "openai-compatible",
            baseUrl: "https://example.invalid/v1",
            apiKey: "sk-test-openai-compatible-secret",
            model: "gpt-5.5",
          },
        },
        modelRoutes: {
          defaultModel: "gpt-5.5",
          routes: [
            { role: "planner", provider: "deepseek", primaryModel: "deepseek-v4-pro" },
            { role: "executor", provider: "deepseek", primaryModel: "deepseek-v4-pro" },
          ],
        },
      }),
      "utf8",
    );
    const requests = mockOpenAiTextFetch("ok");
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from(["/model\n/model doctor\n写一个简短计划\n/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(output.text).toContain("provider=deepseek model=deepseek-v4-pro");
    expect(output.text).toContain("defaultModel=gpt-5.5");
    expect(output.text).toContain("普通开发请求按 executor route=deepseek/deepseek-v4-pro 执行");
    expect(output.text).toContain("正在思考…");
    expect(output.text).not.toContain("正在思考… provider=");
    expect(output.text).toContain(
      "deepseek: type=deepseek provider=deepseek model=deepseek-v4-pro runtimeProfile=deepseek_chat_completions endpointProfile=chat_completions compatibilityProfile=deepseek baseUrl=present endpointPath=/v1/chat/completions tools=enabled toolSchema=openai_chat_tools toolResult=chat_tool_message retry=429/502/503/504x3 timeoutMs=30000 idleTimeoutMs=30000 includeUsage=no reasoning=not configured/未生效",
    );
    expect(output.text).toContain("apiKey=present");
    expect(output.text).toContain("masked=sk-…cret");
    expect(output.text).not.toContain("provider=deepseek model=gpt-5.5");
    expect(output.text).not.toContain("openai-compatible/gpt-5.5");
    expect(output.text).not.toContain("sk-test-openai-compatible-secret");
    expect(requests[0]).toMatchObject({ model: "deepseek-v4-pro" });
    expect(output.text).not.toContain("source=user-settings");
  });

  it("marks strict chat reasoning ignored before ordinary model requests", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        providers: {
          "openai-compatible": {
            type: "openai-compatible",
            baseUrl: "https://example.invalid/v1",
            apiKey: "sk-test-openai-compatible-secret",
            model: "gpt-5.5",
            endpointProfile: "chat_completions",
            reasoningLevel: "Medium",
          },
        },
        modelRoutes: {
          routes: [{ role: "executor", provider: "openai-compatible", primaryModel: "gpt-5.5" }],
        },
      }),
      "utf8",
    );
    const requests = mockOpenAiTextFetch("ok");
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from(["/model doctor\n普通开发请求\n/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(requests[0]).not.toHaveProperty("reasoning");
    expect(output.text).toContain("endpointProfile=chat_completions");
    expect(output.text).toContain(
      "reasoning=ignored/unsupported/未生效 compatibilityProfile=strict_openai_compatible",
    );
    expect(output.text).toContain("正在思考…");
    expect(output.text).not.toContain("正在思考… provider=");
    expect(output.text).not.toContain("sk-test-openai-compatible-secret");
  });

  it("records selected runtime profile before ordinary model requests", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        providers: {
          "openai-compatible": {
            type: "openai-compatible",
            baseUrl: "https://example.invalid/v1",
            apiKey: "sk-test-openai-compatible-secret",
            model: "gpt-5.5",
            endpointProfile: "responses",
            reasoningLevel: "Medium",
          },
        },
        modelRoutes: {
          routes: [{ role: "executor", provider: "openai-compatible", primaryModel: "gpt-5.5" }],
        },
      }),
      "utf8",
    );
    const requests = mockOpenAiTextFetch("ok");
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from(["普通开发请求\n/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });
    const session = (
      await new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project }).list()
    ).at(0);
    expect(session?.id).toBeTruthy();
    const resumed = await new SessionStore({
      sessionRootDir: getSessionRootDir(),
      projectPath: project,
    }).resume(session?.id ?? "missing");

    expect(requests[0]).toMatchObject({
      model: "gpt-5.5",
      max_output_tokens: 4_096,
      reasoning: { effort: "Medium" },
    });
    expect(JSON.stringify(requests[0])).toContain('"tools":[{"type":"function","name":"Read"');
    expect(output.text).toContain("正在思考…");
    expect(output.text).not.toContain("正在思考… provider=");
    expect(output.text).not.toContain("baseUrl=");
    expect(output.text).not.toContain("sk-test-openai-compatible-secret");
    expect(output.text).not.toMatch(/Status: requesting model.*ok/s);
    expect(
      resumed.transcript.some(
        (event) =>
          event.type === "system_event" &&
          event.message.includes("selectedRole=executor") &&
          event.message.includes("provider=openai-compatible") &&
          event.message.includes("model=gpt-5.5") &&
          event.message.includes("endpointProfile=responses") &&
          event.message.includes("reasoningLevel=Medium") &&
          event.message.includes("tools=yes"),
      ),
    ).toBe(true);
  });

  it("keeps exact Start Gate confirmation strict when a gate is pending", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session);
    const output = new MemoryOutput();
    context.pendingNaturalCommand = {
      gateId: "ng-test",
      capabilityId: "index",
      source: "natural",
      exactCommand: "/index refresh --confirm-rebuild",
      command: "/index refresh --confirm-rebuild",
      risk: "start_gate",
      scope: "index refresh",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      requiresExactConfirmation: true,
    };

    await handleNaturalInput("把这些大文件忽略掉再刷新索引", context, output);
    context.pendingNaturalCommand = {
      gateId: "ng-test",
      capabilityId: "index",
      source: "natural",
      exactCommand: "/index refresh --confirm-rebuild",
      command: "/index refresh --confirm-rebuild",
      risk: "start_gate",
      scope: "index refresh",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      requiresExactConfirmation: true,
    };
    await handleNaturalInput("确认", context, output);

    expect(output.text).toContain("该动作需要输入精确 slash command 才能继续；这条输入未执行。");
    expect(output.text).toContain("该动作需要精确确认；普通 yes/确认 未放行。");
    expect(output.text).not.toContain("Index: start refresh");
    expect(output.text).not.toContain("gate ng-");
    expect(output.text).not.toContain("risk=");
    expect(output.text).not.toContain("readonly=");
    expect(output.text).not.toContain("writesConfig");
    expect(output.text).not.toContain("permissionPipeline");
  });

  it("keeps slash control-plane paths and direct file reads outside ordinary catalog routing", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await writeFile(join(project, "LINGHUN.md"), "# 项目规则\n\n- 只做最小必要改动。", "utf8");
    const mockDir = await mkdtemp(join(tmpdir(), "linghun-codebase-memory-mock-"));
    const { config, callsPath } = await createMockCodebaseMemoryConfig(project, mockDir);
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(join(project, ".linghun", "settings.json"), JSON.stringify(config), "utf8");
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from([
        "/model\n",
        "/model doctor\n",
        "/index init fast\n",
        "/index status\n",
        "读一下 LINGHUN.md\n",
        "看看这个文件\n",
        "/cache status\n",
        "/memory\n",
        "/exit\n",
      ]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(output.text).toContain(
      "当前模型：role=executor provider=deepseek model=deepseek-v4-flash reasoning=未生效",
    );
    expect(output.text).toContain("Model route doctor");
    expect(output.text).toContain("索引初始化完成");
    expect(output.text).not.toContain("Index: start init fast");
    expect(output.text).toContain("status: ready");
    expect(output.text).toContain("只做最小必要改动");
    expect(output.text.match(/工具 Read 已完成/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(output.text).toContain("Cache status");
    expect(output.text).toContain("Memory status");
    expect(output.text).not.toContain("I can prepare this action");
    expect(output.text).not.toContain("gateId");
    expect(output.text).not.toContain("expiresAt");
    expect(output.text).not.toContain("risk=");
    expect(output.text).not.toContain("/memory：记忆");
    expect(
      (await readMockCalls(callsPath)).filter((tool) => tool === "index_repository"),
    ).toHaveLength(1);
  });

  it("sends ordinary MCP/index enablement wording to the model loop", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        defaultModel: "mcp-request-model",
        providers: {
          deepseek: { model: "different-model" },
          "openai-compatible": {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "mcp-request-model",
          },
        },
      }),
      "utf8",
    );
    const output = new MemoryOutput();
    const requests = mockOpenAiTextFetch("我会通过主模型链路解释索引能力。");

    await runTui({
      projectPath: project,
      stdin: Readable.from(["帮我打开 mcp 的索引功能\n/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(requests).toHaveLength(1);
    expect(output.text).toContain("正在思考…");
    expect(output.text).toContain("我会通过主模型链路解释索引能力");
    expect(output.text).not.toContain("/index：代码索引");
    expect(output.text).not.toContain("工具 Bash 结果");
  });

  it("resolves codebase-memory from env before managed path", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun", "bin"), { recursive: true });
    const envDir = await mkdtemp(join(tmpdir(), "linghun-codebase-memory-env-"));
    const managedDir = join(project, ".linghun", "bin");
    const envMock = await createMockCodebaseMemoryBinary(
      project,
      envDir,
      { changed_count: 0 },
      {
        fileName: "env-codebase-memory",
        versionOutput: "codebase-memory-mcp 1.2.3",
      },
    );
    const managedMock = await createMockCodebaseMemoryBinary(
      project,
      managedDir,
      { changed_count: 0 },
      {
        fileName: "codebase-memory-mcp",
        versionOutput: "codebase-memory-mcp 9.9.9",
      },
    );
    vi.stubEnv("LINGHUN_CODEBASE_MEMORY_MCP", envMock.mockPath);
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleSlashCommand("/index doctor", context, output);

    expect(output.text).toContain("source=env");
    expect(output.text).toContain("binary status: ready");
    expect(output.text).toContain("binary command: present:env-codebase-memory.cjs");
    expect(output.text).toContain("version: 1.2.3");
    expect(output.text).toContain("runtime: explicit codebase-memory override");
    expect(output.text).not.toContain(envDir);
    expect(await readMockCalls(envMock.callsPath)).toEqual([
      "list_projects",
      "index_status",
      "detect_changes",
    ]);
    expect(await readMockCalls(managedMock.callsPath)).toEqual([]);
  });

  it("resolves Linghun-managed codebase-memory before PATH fallback with Windows-safe paths", async () => {
    const project = await mkdtemp(join(tmpdir(), "灵魂 项目 with spaces-"));
    await mkdir(join(project, ".linghun", "bin"), { recursive: true });
    const managedDir = join(project, ".linghun", "bin");
    const pathDir = await mkdtemp(join(tmpdir(), "linghun-codebase-memory-path-"));
    const managedMock = await createMockCodebaseMemoryBinary(
      project,
      managedDir,
      { changed_count: 0 },
      {
        fileName: "codebase-memory-mcp",
        versionOutput: "codebase-memory-mcp 2.0.0",
      },
    );
    const pathMock = await createMockCodebaseMemoryBinary(
      project,
      pathDir,
      { changed_count: 0 },
      {
        fileName: "codebase-memory-mcp",
        versionOutput: "codebase-memory-mcp 3.0.0",
      },
    );
    vi.stubEnv("PATH", `${pathDir}${delimiter}${process.env.PATH ?? ""}`);
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleSlashCommand("/index status", context, output);

    expect(output.text).toContain("source=managed");
    expect(output.text).toContain("binary command: present:codebase-memory-mcp.cjs");
    expect(output.text).toContain("version: 2.0.0");
    expect(output.text).toContain("runtime: Linghun-managed codebase-memory");
    expect(output.text).toContain("fast status：未运行 detect_changes");
    expect(output.text).not.toContain(managedDir);
    expect(output.text).not.toContain(pathDir);
    expect(await readMockCalls(managedMock.callsPath)).toEqual(["list_projects", "index_status"]);
    expect(await readMockCalls(pathMock.callsPath)).toEqual([]);
  });

  it("falls back to PATH codebase-memory when env and managed paths are absent", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const pathDir = await mkdtemp(join(tmpdir(), "linghun-codebase-memory-path-"));
    const pathMock = await createMockCodebaseMemoryBinary(
      project,
      pathDir,
      { changed_count: 0 },
      {
        fileName: "codebase-memory-mcp",
        versionOutput: "codebase-memory-mcp 4.0.0",
      },
    );
    vi.stubEnv("PATH", `${pathDir}${delimiter}${process.env.PATH ?? ""}`);
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleSlashCommand("/index status", context, output);

    expect(output.text).toContain("source=path");
    expect(output.text).toContain("version: 4.0.0");
    expect(output.text).toContain("runtime: external fallback from PATH");
    expect(await readMockCalls(pathMock.callsPath)).toEqual(["list_projects", "index_status"]);
  });

  windowsIt(
    "wraps Windows PATH .cmd codebase-memory shim without leaking private paths",
    async () => {
      const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
      const pathDir = await mkdtemp(join(tmpdir(), "linghun-codebase-memory-cmd path-"));
      const pathMock = await createMockCodebaseMemoryBinary(
        project,
        pathDir,
        { changed_count: 0 },
        {
          fileName: "codebase-memory-worker",
          versionOutput: "codebase-memory-mcp 5.0.0",
        },
      );
      const shimPath = join(pathDir, "codebase-memory-mcp.cmd");
      await writeFile(
        shimPath,
        `@echo off\r\n"${process.execPath}" "${pathMock.mockPath}" %*\r\n`,
        "utf8",
      );
      vi.stubEnv("PATH", `${pathDir}${delimiter}${process.env.PATH ?? ""}`);
      const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
      const session = await store.create({ model: "deepseek-v4-flash" });
      const output = new MemoryOutput();
      const context = await createTestContext(project, store, session);

      await handleSlashCommand("/index status", context, output);

      expect(output.text).toContain("source=path");
      expect(output.text).toContain("binary status: ready");
      expect(output.text).toContain("binary command: present:codebase-memory-mcp.cmd");
      expect(output.text).toContain("version: 5.0.0");
      expect(output.text).toContain("status: ready");
      expect(output.text).not.toContain(pathDir);
      expect(await readMockCalls(pathMock.callsPath)).toEqual(["list_projects", "index_status"]);
    },
  );

  it("degrades unsupported and corrupt codebase-memory versions without crashing", async () => {
    for (const [versionOutput, versionExitCode, expected] of [
      ["codebase-memory-mcp dev-build", undefined, "unsupported"],
      ["broken binary", 1, "corrupt"],
    ] as const) {
      const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
      const mockDir = await mkdtemp(join(tmpdir(), "linghun-codebase-memory-bad-"));
      const { config, callsPath } = await createMockCodebaseMemoryConfig(
        project,
        mockDir,
        { changed_count: 0 },
        {
          versionOutput,
          versionExitCode,
        },
      );
      const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
      const session = await store.create({ model: "deepseek-v4-flash" });
      const output = new MemoryOutput();
      const context = await createTestContext(project, store, session, config);

      await handleSlashCommand("/index status", context, output);

      expect(output.text).toContain(`binary status: ${expected}`);
      expect(output.text).toContain("status: missing");
      expect(output.text).toContain("普通聊天不受影响");
      expect(output.text).toContain("next action: 建议：配置 LINGHUN_CODEBASE_MEMORY_MCP");
      expect(await readMockCalls(callsPath)).toEqual([]);
    }
  });

  it("summarizes current MCP/index runtime without bundled or raw graph claims", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    const mockDir = await mkdtemp(join(tmpdir(), "linghun-codebase-memory-mock-"));
    const { config, callsPath } = await createMockCodebaseMemoryConfig(project, mockDir);
    await writeFile(join(project, ".linghun", "settings.json"), JSON.stringify(config), "utf8");
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from([
        "/mcp doctor\n/index status\n/index search main\n/index architecture\n/exit\n",
      ]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(output.text).toContain("MCP status");
    expect(output.text).toContain("codebase-memory: configured");
    expect(output.text).toContain("codebase-memory source=env");
    expect(output.text).toContain("runtime: explicit codebase-memory override");
    expect(output.text).toContain(
      "guard: deferred MCP tools require discovery + trusted server + schemaLoaded + compatible runtime",
    );
    expect(output.text).toContain(
      "license/NOTICE: Linghun-managed codebase-memory must be shipped with license/NOTICE metadata",
    );
    expect(output.text).toContain("fast status：未运行 detect_changes");
    expect(output.text).toContain("Index search（短摘要");
    expect(output.text).toContain("Index architecture（短摘要）");
    expect(output.text).toContain("nodes/edges: 12/8");
    expect(output.text).not.toContain("RAW_SOURCE_TAIL_SHOULD_NOT_DUMP");
    expect(output.text).not.toContain("FULL_GRAPH_SHOULD_NOT_DUMP");
    expect(await readMockCalls(callsPath)).toEqual(
      expect.arrayContaining(["list_projects", "index_status", "search_code", "get_architecture"]),
    );
    expect(await readMockCalls(callsPath)).not.toContain("detect_changes");
  });

  it("degrades clearly when codebase-memory is missing without blocking normal chat", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        defaultModel: "missing-index-chat-model",
        mcp: {
          ...defaultConfig.mcp,
          servers: {
            ...defaultConfig.mcp.servers,
            "codebase-memory": { command: "definitely-missing-codebase-memory-mcp" },
          },
        },
        providers: {
          deepseek: { model: "different-model" },
          "openai-compatible": {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "missing-index-chat-model",
          },
        },
      }),
      "utf8",
    );
    const output = new MemoryOutput();
    const requests = mockOpenAiTextFetch("普通聊天仍然可继续。");

    await runTui({
      projectPath: project,
      stdin: Readable.from(["/mcp doctor\n/index status\n普通聊天\n/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(requests).toHaveLength(1);
    expect(output.text).toContain("codebase-memory: missing");
    expect(output.text).toContain("status: missing");
    expect(output.text).toContain("配置 LINGHUN_CODEBASE_MEMORY_MCP");
    expect(output.text).toContain("普通聊天仍然可继续");
    expect(output.text).toContain("binary status: missing");
    expect(output.text).toContain("runtime: explicit codebase-memory override");
    expect(output.text).not.toContain("bundled 内置");
  });

  it("returns message for real-project Beta ordinary project/deploy/index requests", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await expect(
      handleNaturalInput(
        "帮我看看这是什么项目 该怎么部署 把报告更新在根目录下 有索引 优先使用索引",
        context,
        output,
      ),
    ).resolves.toBe("message");
    await expect(
      handleNaturalInput("分析这个项目并输出部署报告，优先使用索引", context, output),
    ).resolves.toBe("message");
    await expect(
      handleNaturalInput(
        "use the index if available and tell me how to deploy this project",
        context,
        output,
      ),
    ).resolves.toBe("message");
    expect(output.text).not.toContain("/index：代码索引");
  });

  it("preprocesses high-confidence control-plane natural inputs locally before provider", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const requests = mockOpenAiTextFetch("SHOULD_NOT_CALL_PROVIDER");
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from([
        "帮我切到自动模式\n",
        "切到自动审查\n",
        "switch to auto mode\n",
        "当前权限模式是什么\n",
        "模型配置正常吗\n",
        "索引状态怎么样\n",
        "缓存状态怎么样\n",
        "/exit\n",
      ]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(requests).toHaveLength(0);
    expect(output.text).toContain("可以准备执行：权限模式。");
    expect(output.text).toContain("后续受保护操作仍会单独审批。");
    expect(output.text).toContain("当前权限模式：default");
    expect(output.text).toContain("Model route doctor");
    expect(output.text).toContain("Index status");
    expect(output.text).toContain("Cache status");
    expect(output.text).not.toContain("正在思考…");
    expect(output.text).not.toContain("SHOULD_NOT_CALL_PROVIDER");
  });

  it("keeps ordinary report deploy feature and bug-fix requests on provider path", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        defaultModel: "ordinary-routing-model",
        providers: {
          deepseek: { model: "different-model" },
          "openai-compatible": {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "ordinary-routing-model",
          },
        },
      }),
      "utf8",
    );
    const requests = mockOpenAiTextFetch("普通任务进入模型主链路。");
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from([
        "帮我分析一下这是什么项目，技术栈是什么，怎么部署，输出报告在根目录\n",
        "有索引，优先使用索引，帮我分析项目并生成报告\n",
        "修复这个 bug\n",
        "帮我实现导出报表功能\n",
        "/exit\n",
      ]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(requests.length).toBeGreaterThanOrEqual(4);
    expect(output.text).toContain("普通任务进入模型主链路");
    expect(output.text).not.toContain("/index：代码索引");
    expect(output.text).not.toContain("我可以准备执行：权限模式");
  });

  it("sends real-project Beta deploy/index stdin smoke input to provider path", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        defaultModel: "beta-smoke-model",
        providers: {
          deepseek: { model: "different-model" },
          "openai-compatible": {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "beta-smoke-model",
          },
        },
      }),
      "utf8",
    );
    const output = new MemoryOutput();
    const requests = mockOpenAiTextFetch("我会先按模型主链路分析项目部署。");

    await runTui({
      projectPath: project,
      stdin: Readable.from([
        "帮我看看这是什么项目 该怎么部署 把报告更新在根目录下 有索引 优先使用索引\n",
        "/exit\n",
      ]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(requests).toHaveLength(1);
    expect(output.text).toContain("正在思考…");
    expect(output.text).toContain("我会先按模型主链路分析项目部署");
    expect(output.text).not.toContain("/index：代码索引");
  });

  it("answers composite Chinese and English readiness locally", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({ language: "en-US" }),
      "utf8",
    );
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from([
        "索引和记忆 MCP 打开了吗\n",
        "Are model, index and permissions ready?\n",
        "/exit\n",
      ]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(output.text).toContain("Composite local status");
    expect(output.text).toContain("- index: status=");
    expect(output.text).toContain("- memory: projectRules=");
    expect(output.text).toContain("- mcp: enabled=");
    expect(output.text).toContain("- model/provider: provider=");
    expect(output.text).toContain("- permissions: mode=");
    expect(output.text).toContain("not sent to the model");
    expect(output.text).not.toContain("Status: requesting model");
  });

  it("shows model tool permission prompts and waits for local approval", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        defaultModel: "tool-test-model",
        providers: {
          deepseek: { model: "different-model" },
          "openai-compatible": {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "tool-test-model",
          },
        },
      }),
      "utf8",
    );
    const requests = mockOpenAiToolFetch("Bash", { command: "echo SHOULD_NOT_RUN" });
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from(["请检查当前环境\n/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(output.text).toContain("Linghun 想执行 Bash。");
    expect(output.text).toContain("允许本次执行？yes / no");
    expect(output.text).not.toContain("- action：Bash");
    expect(output.text).not.toContain("- reason：");
    expect(output.text).not.toContain("- risk：高");
    expect(output.text).not.toContain("- scope：none");
    expect(output.text).not.toContain("- 当前模式：default");
    expect(output.text).not.toContain("- decision:");
    expect(output.text).not.toContain("- risk:");
    expect(output.text).not.toContain("- mode:");
    expect(output.text).not.toContain("工具 Bash 结果");
    expect(requests).toHaveLength(1);
  });

  it("continues after denied model tool permission as a tool_result", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        defaultModel: "tool-deny-model",
        providers: {
          deepseek: { model: "different-model" },
          "openai-compatible": {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "tool-deny-model",
          },
        },
      }),
      "utf8",
    );
    const requests = mockOpenAiToolFetch(
      "Bash",
      { command: "echo SHOULD_NOT_RUN" },
      "我已收到拒绝结果，将改用不执行命令的说明。",
    );
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from(["请检查当前环境\nno\n/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(requests).toHaveLength(2);
    const second = requests[1] as { messages?: { role?: string; content?: string }[] };
    const toolMessage = second.messages?.find((message) => message.role === "tool");
    expect(toolMessage?.content).toContain('"ok":false');
    expect(toolMessage?.content).toContain("permission denied by user");
    const session = (
      await new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project }).list()
    ).at(0);
    const transcript = await readFile(session?.transcriptPath ?? "", "utf8");
    expect(output.text).toContain("已拒绝。本轮未写入文件，模型会收到拒绝结果并继续调整。");
    expect(output.text).toContain("我已收到拒绝结果，将改用不执行命令的说明。");
    expect(output.text).not.toContain("SHOULD_NOT_RUN");
    expect(output.text).not.toContain("tool_result");
    expect(transcript).toContain('"type":"tool_result"');
  });

  it("continues after cancelled model tool permission as a distinct tool_result", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        defaultModel: "tool-cancel-model",
        providers: {
          deepseek: { model: "different-model" },
          "openai-compatible": {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "tool-cancel-model",
          },
        },
      }),
      "utf8",
    );
    const requests = mockOpenAiToolFetch(
      "Write",
      { path: "cancelled.txt", content: "no" },
      "我已收到取消结果，不会继续写文件。",
    );
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from(["请准备一个文件\ncancel\n/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(requests).toHaveLength(2);
    const second = requests[1] as { messages?: { role?: string; content?: string }[] };
    const toolMessage = second.messages?.find((message) => message.role === "tool");
    expect(toolMessage?.content).toContain('"ok":false');
    expect(toolMessage?.content).toContain('"outcome":"cancelled"');
    expect(toolMessage?.content).toContain("permission cancelled by user");
    const session = (
      await new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project }).list()
    ).at(0);
    const transcript = await readFile(session?.transcriptPath ?? "", "utf8");
    expect(output.text).toContain("已拒绝。本轮未写入文件，模型会收到拒绝结果并继续调整。");
    expect(output.text).toContain("我已收到取消结果，不会继续写文件。");
    expect(output.text).not.toContain("tool_result");
    expect(transcript).toContain('"type":"tool_result"');
    await expect(readFile(join(project, "cancelled.txt"), "utf8")).rejects.toThrow();
  });

  it("keeps pending approval across ordinary follow-up and slash status queries", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        defaultModel: "tool-pending-model",
        providers: {
          deepseek: { model: "different-model" },
          "openai-compatible": {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "tool-pending-model",
          },
        },
      }),
      "utf8",
    );
    const requests = mockOpenAiToolFetch(
      "Write",
      { path: "allowed-after-pending.txt", content: "ok" },
      "已写入 allowed-after-pending.txt。",
    );
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from(["请准备一个文件\n这期间能解释一下吗？\n/status\n/mode\nyes\n/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(requests).toHaveLength(2);
    expect(output.text).toContain("这条输入不会发送给模型");
    expect(output.text).toContain("确认=待批准");
    expect(output.text).toContain("当前权限模式：default");
    expect(output.text).toContain("已写入 allowed-after-pending.txt。");
    await expect(readFile(join(project, "allowed-after-pending.txt"), "utf8")).resolves.toBe("ok");
  });

  it("continues denied model tool permission without orphaning sibling tool calls", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        defaultModel: "tool-deny-sibling-model",
        providers: {
          deepseek: { model: "different-model" },
          "openai-compatible": {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "tool-deny-sibling-model",
          },
        },
      }),
      "utf8",
    );
    const requests: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        requests.push(JSON.parse(String(init.body)));
        const isFirst = requests.length === 1;
        const body = isFirst
          ? [
              `data: ${JSON.stringify({
                id: "chatcmpl-test",
                choices: [
                  {
                    delta: {
                      content: "先查看目录。",
                      tool_calls: [
                        {
                          id: "call-bash",
                          type: "function",
                          function: {
                            name: "Bash",
                            arguments: JSON.stringify({ command: "ls -la" }),
                          },
                        },
                        {
                          id: "call-glob",
                          type: "function",
                          function: {
                            name: "Glob",
                            arguments: JSON.stringify({ pattern: "**/*" }),
                          },
                        },
                      ],
                    },
                  },
                ],
              })}\n\n`,
              "data: [DONE]\n\n",
            ].join("")
          : `data: ${JSON.stringify({ id: "chatcmpl-test-2", choices: [{ delta: { content: "已收到拒绝结果。" } }] })}\n\ndata: [DONE]\n\n`;
        return new Response(body, { status: 200 });
      }),
    );
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from(["请检查当前环境\nno\n/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(requests).toHaveLength(2);
    const second = requests[1] as {
      messages?: {
        role?: string;
        tool_call_id?: string;
        tool_calls?: { id?: string }[];
      }[];
    };
    const assistant = second.messages?.find((message) => message.role === "assistant");
    const toolMessage = second.messages?.find((message) => message.role === "tool");
    expect(assistant?.tool_calls).toHaveLength(1);
    expect(assistant?.tool_calls?.[0]?.id).toBe("call-bash");
    expect(toolMessage?.tool_call_id).toBe("call-bash");
    expect(output.text).toContain("已收到拒绝结果。");
  });

  it("keeps model Write/Edit tool calls behind default permission prompt", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        defaultModel: "tool-write-model",
        providers: {
          deepseek: { model: "different-model" },
          "openai-compatible": {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "tool-write-model",
          },
        },
      }),
      "utf8",
    );
    mockOpenAiToolFetch("Write", { path: "blocked.txt", content: "no" });
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from(["请准备一个文件\n/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(output.text).toContain("Linghun 想执行 Write blocked.txt。");
    expect(output.text).toContain("允许本次执行？yes / no");
    expect(output.text).not.toContain("- action：Write blocked.txt");
    expect(output.text).not.toContain("- scope：blocked.txt");
    expect(output.text).not.toContain("- decision:");
    expect(output.text).not.toContain("- risk:");
    expect(output.text).not.toContain("- mode:");
    await expect(readFile(join(project, "blocked.txt"), "utf8")).rejects.toThrow();
  });

  it("formats report Write prompts with the actual pending target path", () => {
    for (const reportPath of ["report.md", "docs/deploy-report.md"] as const) {
      const prompt = formatModelToolPermissionPrompt(
        {
          toolName: "Write",
          decision: "ask",
          risk: "medium",
          mode: "default",
          reason: "model requested report write",
          scope: [reportPath],
        },
        "zh-CN",
      );

      expect(prompt).toBe(`写入 ${reportPath}\n允许本次写入？yes / no`);
      expect(prompt).not.toContain("Linghun 想");
      expect(prompt).not.toContain("permission pipeline");
      expect(prompt).not.toContain("risk=");
      expect(prompt).not.toContain("tool_result");
      expect(prompt).not.toContain("证据记录");
      if (reportPath !== "report.md") {
        expect(prompt).not.toContain("写入 report.md");
      }

      const englishPrompt = formatModelToolPermissionPrompt(
        {
          toolName: "Write",
          decision: "ask",
          risk: "medium",
          mode: "default",
          reason: "model requested report write",
          scope: [reportPath],
        },
        "en-US",
      );
      expect(englishPrompt).toBe(`Write ${reportPath}\nAllow this write? yes / no`);
      expect(englishPrompt).not.toContain("Linghun wants");
      expect(englishPrompt).not.toContain("permission pipeline");
      expect(englishPrompt).not.toContain("risk=");
      expect(englishPrompt).not.toContain("tool_result");
      if (reportPath !== "report.md") {
        expect(englishPrompt).not.toContain("Write report.md");
      }
    }
  });

  it("marks explicit report generation incomplete when Write evidence is missing", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        defaultModel: "report-missing-model",
        providers: {
          deepseek: { model: "different-model" },
          "openai-compatible": {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "report-missing-model",
          },
        },
      }),
      "utf8",
    );
    mockOpenAiTextFetch("我已经整理好了报告内容。");
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from(["请生成报告 missing-report.md 在根目录下\n/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(output.text).toContain("报告生成受阻：尚未在 missing-report.md 生成报告文件。");
    expect(output.text).not.toContain("报告生成 incomplete/BLOCKED");
    expect(output.text).not.toContain("可在详情中查看记录");
    await expect(readFile(join(project, "missing-report.md"), "utf8")).rejects.toThrow();
    const session = (
      await new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project }).list()
    ).at(0);
    const transcript = await readFile(session?.transcriptPath ?? "", "utf8");
    expect(transcript).toContain("report_incomplete");
    expect(transcript).toContain("missing_write_evidence");
    expect(transcript).toContain('"type":"evidence_record"');
    expect(transcript).toContain('"type":"system_event"');
  });

  it("uses a local report write reminder for explicit custom report files", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        defaultModel: "report-prompt-model",
        providers: {
          deepseek: { model: "different-model" },
          "openai-compatible": {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "report-prompt-model",
          },
        },
      }),
      "utf8",
    );
    await writeFile(
      join(project, "package.json"),
      JSON.stringify({ scripts: { build: "tsc" } }),
      "utf8",
    );
    const requests: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        requests.push(JSON.parse(String(init.body)));
        if (requests.length === 1) {
          const body = `data: ${JSON.stringify({ id: "chatcmpl-test-1", choices: [{ delta: { content: "我先看一下。" } }] })}\n\ndata: [DONE]\n\n`;
          return new Response(body, { status: 200 });
        }
        if (requests.length === 2) {
          const body = `data: ${JSON.stringify({
            id: "chatcmpl-test-2",
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      id: "call-read",
                      type: "function",
                      function: {
                        name: "Read",
                        arguments: JSON.stringify({ path: "package.json" }),
                      },
                    },
                  ],
                },
              },
            ],
          })}\n\ndata: [DONE]\n\n`;
          return new Response(body, { status: 200 });
        }
        if (requests.length === 3) {
          const body = `data: ${JSON.stringify({
            id: "chatcmpl-test-3",
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      id: "call-write",
                      type: "function",
                      function: {
                        name: "Write",
                        arguments: JSON.stringify({
                          path: "requested-report.md",
                          content: "# Requested Report",
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          })}\n\ndata: [DONE]\n\n`;
          return new Response(body, { status: 200 });
        }
        const body = `data: ${JSON.stringify({ id: "chatcmpl-test-4", choices: [{ delta: { content: "已生成 requested-report.md。\n结论：报告已保存。\n推断/未确认：部署细节需继续核对。\n下一步：打开报告复核。" } }] })}\n\ndata: [DONE]\n\n`;
        return new Response(body, { status: 200 });
      }),
    );
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from([
        "请分析这个项目怎么部署，并生成报告 requested-report.md 在根目录下\n",
        "yes\n",
        "/details\n",
        "/exit\n",
      ]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    const firstRequest = requests[0] as { messages: Array<{ role: string; content: string }> };
    expect(firstRequest.messages[0]?.content).not.toContain(
      "必须最终调用 Write 工具写入指定报告文件",
    );
    expect(firstRequest.messages[0]?.content).not.toContain("requested-report.md");
    const secondRequest = requests[1] as { messages: Array<{ role: string; content: string }> };
    expect(
      secondRequest.messages.some((message) => message.content?.includes("requested-report.md")),
    ).toBe(true);
    expect(requests).toHaveLength(4);
    expect(output.text).toContain("报告已保存：requested-report.md");
    expect(output.text).toContain("file_read Read");
    expect(output.text).toContain("command_output Write");
    expect(output.text).toContain("已生成 requested-report.md");
    expect(output.text).toContain("结论：报告已保存");
    await expect(readFile(join(project, "requested-report.md"), "utf8")).resolves.toBe(
      "# Requested Report",
    );
  });

  it("generates Chinese report paths with spaces through Write after permission approval", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        defaultModel: "windows-path-report-model",
        providers: {
          deepseek: { model: "different-model" },
          "openai-compatible": {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "windows-path-report-model",
          },
        },
      }),
      "utf8",
    );
    await writeFile(
      join(project, "package.json"),
      JSON.stringify({ name: "中文路径测试" }),
      "utf8",
    );
    const reportPath = "中文 目录/部署 报告.md";
    const report = "# 中文报告\n\n- Windows 中文路径与空格路径 smoke。";
    const requests = mockOpenAiToolSequence(
      [
        { toolName: "Read", input: { path: "package.json" } },
        { toolName: "Write", input: { path: reportPath, content: report } },
      ],
      `已生成 ${reportPath}。\n结论：报告已保存。\n推断/未确认：部署细节需继续核对。\n下一步：打开报告复核。`,
    );
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from([`请生成报告 "${reportPath}" 在根目录下\nyes\n/exit\n`]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(requests).toHaveLength(3);
    expect(output.text).toContain(`写入 ${reportPath}`);
    expect(output.text).toContain("允许本次写入？yes / no");
    expect(output.text).not.toContain("需要写入");
    expect(output.text).not.toContain("- 安全级别：");
    expect(output.text).toContain(`报告已保存：${reportPath}`);
    expect(output.text).toContain(`已生成 ${reportPath}`);
    await expect(readFile(join(project, reportPath), "utf8")).resolves.toBe(report);
  });

  it("generates project analysis report through model tool_call Write after permission approval", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, "package.json"),
      JSON.stringify({ scripts: { build: "tsc" } }),
      "utf8",
    );
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        defaultModel: "tool-report-model",
        providers: {
          deepseek: { model: "different-model" },
          "openai-compatible": {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "tool-report-model",
          },
        },
      }),
      "utf8",
    );
    const report =
      "# 项目分析报告\n\n- 类型：Node 项目\n- 部署：运行 npm install && npm run build。";
    const requests = mockOpenAiToolSequence(
      [
        { toolName: "Read", input: { path: "package.json" } },
        { toolName: "Write", input: { path: "report.md", content: report } },
      ],
      "已生成 report.md。\n结论：这是 Node 项目；部署依赖 package.json 脚本。\n推断/未确认：运行环境变量需实机核对。\n下一步：打开 report.md 复核部署命令。",
    );
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from([
        "帮我分析一下这个项目 看看怎么部署 把报告生成在根目录下\n",
        "yes\n",
        "/exit\n",
      ]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(requests).toHaveLength(3);
    const firstRequest = requests[0] as {
      tools?: Array<{ name?: string; function?: { name?: string } }>;
    };
    const toolNames = firstRequest.tools?.map((tool) => tool.name ?? tool.function?.name);
    expect(toolNames).toContain("Read");
    expect(toolNames).toContain("Grep");
    expect(toolNames).toContain("Glob");
    expect(toolNames).not.toContain("Write");
    expect(toolNames).not.toContain("Bash");
    expect(output.text).toContain("正在检查项目证据，随后把报告保存到 report.md。");
    expect(output.text).toContain("Read 已完成，继续整理报告分析。");
    expect(output.text).toContain("写入 report.md");
    expect(output.text).toContain("允许本次写入？yes / no");
    expect(output.text).not.toContain("需要写入 report.md");
    expect(output.text).not.toContain("- 文件：report.md");
    expect(output.text).not.toContain("- 安全级别：");
    expect(output.text).toContain("报告已保存：report.md");
    expect(output.text).toContain("结论：这是 Node 项目");
    expect(output.text).toContain("推断/未确认：运行环境变量需实机核对");
    expect(output.text).toContain("下一步：打开 report.md 复核部署命令");
    expect(output.text).not.toContain("证据记录：");
    expect(output.text).not.toContain("tool_result");
    expect(output.text).not.toContain("Architecture Card");
    expect(output.text).not.toContain("systemic_gap");
    expect(output.text).not.toContain("blocking_P1");
    expect(output.text).not.toContain("Solution Completeness Gate report");
    expect(output.text).not.toContain("当前最小 REPL 没有交互式审批 UI");
    expect(output.text).not.toContain("改用明确 slash command");
    expect(output.text).not.toContain("- decision:");
    expect(output.text).not.toContain("- risk:");
    expect(output.text).not.toContain("- mode:");
    expect(output.text).not.toContain('"tool_result"');
    await expect(readFile(join(project, "report.md"), "utf8")).resolves.toBe(report);

    const sessions = await new SessionStore({
      sessionRootDir: getSessionRootDir(),
      projectPath: project,
    }).list();
    const transcript = await readFile(sessions[0]?.transcriptPath ?? "", "utf8");
    expect(transcript).toContain('"type":"tool_call_start"');
    expect(transcript).toContain('"name":"Write"');
    expect(transcript).toContain('"type":"tool_result"');
    expect(transcript).toContain('"toolName":"Write"');
    expect(transcript).toContain('"isError":false');
    expect(transcript).toContain('"evidenceId"');
  });

  it("continues approved model tool results through another tool_use before final answer", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(join(project, "package.json"), JSON.stringify({ name: "demo" }), "utf8");
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        defaultModel: "tool-chain-model",
        providers: {
          deepseek: { model: "different-model" },
          "openai-compatible": {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "tool-chain-model",
          },
        },
      }),
      "utf8",
    );
    const requests: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        requests.push(JSON.parse(String(init.body)));
        if (requests.length === 1) {
          const body = `data: ${JSON.stringify({
            id: "chatcmpl-test-1",
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      id: "call-read",
                      type: "function",
                      function: {
                        name: "Read",
                        arguments: JSON.stringify({ path: "package.json" }),
                      },
                    },
                  ],
                },
              },
            ],
          })}\n\ndata: [DONE]\n\n`;
          return new Response(body, { status: 200 });
        }
        if (requests.length === 2) {
          const body = `data: ${JSON.stringify({
            id: "chatcmpl-test-2",
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      id: "call-write",
                      type: "function",
                      function: {
                        name: "Write",
                        arguments: JSON.stringify({ path: "report.md", content: "# Report" }),
                      },
                    },
                  ],
                },
              },
            ],
          })}\n\ndata: [DONE]\n\n`;
          return new Response(body, { status: 200 });
        }
        const body = `data: ${JSON.stringify({
          id: "chatcmpl-test-3",
          choices: [
            {
              delta: {
                content:
                  "已写入 report.md 并读取 package.json。\n结论：报告已保存。\n推断/未确认：部署细节需继续核对。\n下一步：打开 report.md 复核。",
              },
            },
          ],
        })}\n\ndata: [DONE]\n\n`;
        return new Response(body, { status: 200 });
      }),
    );
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from([
        "帮我分析一下这个项目 看看怎么部署 把报告生成在根目录下\nyes\n/exit\n",
      ]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(requests).toHaveLength(3);
    const third = requests[2] as { messages?: { role?: string; tool_call_id?: string }[] };
    expect(third.messages?.some((message) => message.tool_call_id === "call-write")).toBe(true);
    expect(third.messages?.some((message) => message.tool_call_id === "call-read")).toBe(true);
    expect(output.text).toContain("报告已保存：report.md");
    expect(output.text).toContain("Read 已完成，继续整理报告分析。");
    expect(output.text).toContain("已写入 report.md 并读取 package.json。");
  });

  it("returns Bash non-zero exits as failed model-visible tool_results", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        defaultModel: "tool-bash-failure-model",
        providers: {
          deepseek: { model: "different-model" },
          "openai-compatible": {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "tool-bash-failure-model",
          },
        },
      }),
      "utf8",
    );
    const requests = mockOpenAiToolFetch(
      "Bash",
      { command: 'node -e "process.exit(7)"' },
      "Bash 失败结果已收到，我会改用现有证据说明。",
    );
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from(["请运行检查命令\nyes\n/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(requests).toHaveLength(2);
    const second = requests[1] as { messages?: { role?: string; content?: string }[] };
    const toolMessage = second.messages?.find((message) => message.role === "tool");
    expect(toolMessage?.content).toContain('"ok":false');
    expect(toolMessage?.content).toContain('"exitCode":7');
    expect(output.text).toContain("工具 Bash 已完成");
    expect(output.text).toContain("Bash 失败结果已收到");

    const session = (
      await new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project }).list()
    ).at(0);
    const transcript = await readFile(session?.transcriptPath ?? "", "utf8");
    expect(transcript).toContain('"type":"tool_result"');
    expect(transcript).toContain('"toolName":"Bash"');
    expect(transcript).toContain('"isError":true');
  });

  it("records failed model tool_result evidence for follow-up prompts", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        defaultModel: "tool-failure-model",
        providers: {
          deepseek: { model: "different-model" },
          "openai-compatible": {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "tool-failure-model",
          },
        },
      }),
      "utf8",
    );
    const requests = mockOpenAiToolFetch("Read", { path: "missing.txt" });
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from(["请查看这个文件\n/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    const second = requests[1] as { messages?: { role?: string; content?: string }[] };
    const toolMessage = second.messages?.find((message) => message.role === "tool");
    expect(toolMessage?.content).toContain('"ok":false');
    expect(toolMessage?.content).toContain('"evidenceId"');
  });

  it("shows index safety repair loop for large files", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await writeFile(
      join(project, "large.json"),
      JSON.stringify({ data: "x".repeat(1_100_000) }),
      "utf8",
    );
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from(["/index refresh\n/index status\n/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(output.text).toContain("索引安全门");
    expect(output.text).toContain("阻塞原因");
    expect(output.text).toContain("主屏不展开完整风险清单");
    expect(output.text).toContain("建议 ignore 文件：.linghunignore 或 .cbmignore");
    expect(output.text).not.toContain("- large.json");
    expect(output.text).toContain(
      "修复路径：可以用自然语言要求排除这些大文件并更新索引；写入 ignore 文件仍会进入权限管道。",
    );
    expect(output.text).toContain("重试命令：/index refresh");
  });

  it("continues index safety repair after an active safety blocker", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await writeFile(join(project, "large.json"), "x".repeat(1_100_000), "utf8");
    const mockDir = await mkdtemp(join(tmpdir(), "linghun-codebase-memory-mock-"));
    const { config, callsPath } = await createMockCodebaseMemoryConfig(project, mockDir);
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session, config);

    await handleSlashCommand("/index refresh", context, output);
    await handleNaturalInput("帮我排除大文件更新索引", context, output);
    await handleNaturalInput("确认", context, output);

    expect(await readFile(join(project, ".linghunignore"), "utf8")).toContain("large.json");
    expect(output.text).toContain("索引安全门");
    expect(output.text).toContain("索引安全修复续跑");
    expect(output.text).toContain("需要先确认权限");
    expect(await readMockCalls(callsPath)).toContain("index_repository");
  });

  it("continues index safety repair from Chinese natural language after permission allows Write", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await writeFile(join(project, "large.json"), "x".repeat(1_100_000), "utf8");
    const mockDir = await mkdtemp(join(tmpdir(), "linghun-codebase-memory-mock-"));
    const { config, callsPath } = await createMockCodebaseMemoryConfig(project, mockDir);
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session, config);

    await handleSlashCommand("/permissions add allow Write medium", context, output);
    await handleSlashCommand("/index refresh", context, output);
    await handleNaturalInput("帮我排除大文件 然后更新项目索引", context, output);

    expect(await readFile(join(project, ".linghunignore"), "utf8")).toContain("large.json");
    expect(output.text).toContain("索引安全修复续跑");
    expect(output.text).toContain("ignore 文件：.linghunignore");
    expect(output.text).toContain("ignore 写入完成：.linghunignore；条目数量=1");
    expect(output.text).toContain("索引刷新：正在执行...");
    expect(output.text.match(/索引安全门/g)).toHaveLength(1);
    expect(await readMockCalls(callsPath)).toContain("index_repository");
  });

  it("continues index safety repair from English natural language", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await writeFile(join(project, "large.json"), "x".repeat(1_100_000), "utf8");
    const mockDir = await mkdtemp(join(tmpdir(), "linghun-codebase-memory-mock-"));
    const { config, callsPath } = await createMockCodebaseMemoryConfig(project, mockDir);
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session, config);
    context.language = "en-US";

    await handleSlashCommand("/permissions add allow Write medium", context, output);
    await handleSlashCommand("/index refresh", context, output);
    await handleNaturalInput(
      "exclude those large files and refresh the project index",
      context,
      output,
    );

    expect(await readFile(join(project, ".linghunignore"), "utf8")).toContain("large.json");
    expect(output.text).toContain("Index safety repair continuation");
    expect(output.text).toContain("ignore file: .linghunignore");
    expect(output.text).toContain("Ignore write completed: .linghunignore; entries=1.");
    expect(await readMockCalls(callsPath)).toContain("index_repository");
  });

  it("does not duplicate existing ignore entries before continuing refresh", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await writeFile(join(project, "large.json"), "x".repeat(1_100_000), "utf8");
    const mockDir = await mkdtemp(join(tmpdir(), "linghun-codebase-memory-mock-"));
    const { config, callsPath } = await createMockCodebaseMemoryConfig(project, mockDir);
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session, config);

    await handleSlashCommand("/index refresh", context, output);
    await writeFile(join(project, ".linghunignore"), "large.json\n", "utf8");
    await handleNaturalInput("帮我排除这些大文件并刷新索引", context, output);

    expect(await readFile(join(project, ".linghunignore"), "utf8")).toBe("large.json\n");
    expect(output.text).toContain("ignore 写入跳过");
    expect(await readMockCalls(callsPath)).toContain("index_repository");
  });

  it("does not write or refresh when index safety repair approval is denied", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await writeFile(join(project, "large.json"), "x".repeat(1_100_000), "utf8");
    const mockDir = await mkdtemp(join(tmpdir(), "linghun-codebase-memory-mock-"));
    const { config, callsPath } = await createMockCodebaseMemoryConfig(project, mockDir);
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session, config);

    await handleSlashCommand("/index refresh", context, output);
    await handleNaturalInput("帮我排除大文件 然后更新项目索引", context, output);
    await handleNaturalInput("no", context, output);

    await expect(readFile(join(project, ".linghunignore"), "utf8")).rejects.toThrow();
    expect(output.text).toContain("需要先确认权限");
    expect(output.text).toContain("已拒绝权限。本轮未写入文件，也未刷新索引。");
    expect(await readMockCalls(callsPath)).toEqual([]);
  });

  it("continues index safety repair after default Write approval", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await writeFile(join(project, "large.json"), "x".repeat(1_100_000), "utf8");
    const mockDir = await mkdtemp(join(tmpdir(), "linghun-codebase-memory-mock-"));
    const { config, callsPath } = await createMockCodebaseMemoryConfig(project, mockDir);
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session, config);

    await handleSlashCommand("/index refresh", context, output);
    await handleNaturalInput("帮我排除大文件 然后更新项目索引", context, output);
    await expect(readFile(join(project, ".linghunignore"), "utf8")).rejects.toThrow();
    await handleNaturalInput("确认", context, output);

    expect(await readFile(join(project, ".linghunignore"), "utf8")).toContain("large.json");
    expect(output.text).toContain("需要先确认权限");
    expect(output.text).toContain("ignore 写入完成：.linghunignore；条目数量=1");
    expect(await readMockCalls(callsPath)).toContain("index_repository");
  });

  it("does not allow natural-language force or rebuild through index safety continuation", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await writeFile(join(project, "large.json"), "x".repeat(1_100_000), "utf8");
    const mockDir = await mkdtemp(join(tmpdir(), "linghun-codebase-memory-mock-"));
    const { config, callsPath } = await createMockCodebaseMemoryConfig(project, mockDir);
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session, config);

    await handleSlashCommand("/index refresh", context, output);
    await handleNaturalInput("force rebuild the index", context, output);

    expect(output.text).toContain("索引 force/rebuild 不能通过自然语言直通");
    expect(await readMockCalls(callsPath)).toEqual([]);
  });

  it("leaves ordinary development requests to the model loop even after index safety pause", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await writeFile(join(project, "large.json"), "x".repeat(1_100_000), "utf8");
    const mockDir = await mkdtemp(join(tmpdir(), "linghun-codebase-memory-mock-"));
    const { config } = await createMockCodebaseMemoryConfig(project, mockDir);
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session, config);

    await handleSlashCommand("/index refresh", context, output);

    await expect(handleNaturalInput("帮我实现登录功能", context, output)).resolves.toBe("message");
  });

  it("classifies index safety continuation from active blocker state", () => {
    const state = { hasSafetyWarning: true, riskyFileCount: 2 };

    expect(
      classifyIndexSafetyRepairContinuation("把这些文件加入 ignore 后刷新索引", state).action,
    ).toBe("repair");
    expect(
      classifyIndexSafetyRepairContinuation(
        "please skip risky files and update the codebase index",
        state,
      ).action,
    ).toBe("repair");
    expect(classifyIndexSafetyRepairContinuation("force rebuild the index", state).action).toBe(
      "force",
    );
    expect(classifyIndexSafetyRepairContinuation("帮我实现登录功能", state).action).toBe("pass");
    expect(
      classifyIndexSafetyRepairContinuation("把这些文件加入 ignore 后刷新索引", {
        hasSafetyWarning: false,
        riskyFileCount: 0,
      }).action,
    ).toBe("pass");
  });

  it("does not execute Bash silently in default mode", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from(["/bash echo SHOULD_NOT_RUN\n/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(output.text).toContain("default 模式不会静默执行 Bash");
    expect(output.text).not.toContain("SHOULD_NOT_RUN");
    expect(output.text).not.toContain("工具 Bash 结果");
  });

  it("exposes layered tool output fields for presenter callers", () => {
    const layered = createLayeredToolOutput(
      "Read",
      {
        text: Array.from({ length: 90 }, (_, index) => `line ${index + 1}`).join("\n"),
        summary: "read summary",
        details: "full details stay outside primary output",
        fullOutputPath: "logs/read-full.txt",
        evidenceId: "ev-read-1",
      },
      "en-US",
    );

    expect(layered.layer).toBe("primary");
    expect(layered.summary).toBe("read summary");
    expect(layered.details).toBe("full details stay outside primary output");
    expect(layered.truncated).toBe(true);
    expect(layered.fullOutputPath).toBe("logs/read-full.txt");
    expect(layered.evidenceId).toBe("ev-read-1");
    expect(layered.preview).not.toContain("line 90");
  });

  it("keeps Read, Grep, and Glob primary output summary-first without raw result floods", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, "src"), { recursive: true });
    await writeFile(
      join(project, "long.txt"),
      Array.from({ length: 120 }, (_, index) => `line ${index + 1}`).join("\n"),
      "utf8",
    );
    for (let index = 0; index < 90; index += 1) {
      await writeFile(join(project, "src", `match-${index}.txt`), `needle ${index}\n`, "utf8");
    }
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    for (let index = 0; index < 10; index += 1) {
      await handleSlashCommand(`/todo add task-${index + 1}`, context, output);
    }
    await handleSlashCommand("/read long.txt", context, output);
    await handleSlashCommand("/grep needle src", context, output);
    await handleSlashCommand("/glob *.txt src", context, output);

    expect(output.text).toContain("主输出已隐藏 2 条 Todo");
    expect(output.text).toContain("输出已摘要");
    expect(output.text).toContain("120 行");
    expect(output.text).toContain("90 条结果");
    expect(output.text).toContain("更多详情可通过 /details 查看");
    expect(output.text).not.toContain("主屏为 summary-first");
    expect(output.text).not.toContain("完整结果已保存在主屏之外");
    expect(output.text).not.toContain("tool_result");
    expect(output.text).not.toContain("Evidence:");
    expect(output.text).not.toContain("1\tline 1");
    expect(output.text).not.toContain("120\tline 120");
    expect(output.text).not.toContain("needle 0");
    expect(output.text).not.toContain("match-89.txt");
  });

  it("keeps editing output summary-first with patch metadata outside raw details", () => {
    const formatted = formatToolOutput(
      "Edit",
      {
        text: "raw edit preview should stay summarized\nline 2",
        summary: "Edit sample.txt: +1 -1; changedFiles=1",
        details: "operation: Edit\n- before\n+ after",
        data: {
          changedFiles: ["sample.txt"],
          addedLines: 1,
          removedLines: 1,
          readGuard: "expectedHash",
        },
        changedFiles: ["sample.txt"],
      },
      "zh-CN",
      "ev-edit-1",
    );

    expect(formatted).toContain("工具 Edit 已完成");
    expect(formatted).toContain("补丁 +1 -1");
    expect(formatted).toContain("读取保护 expectedHash");
    expect(formatted).toContain("更多详情可通过 /details 查看。");
    expect(formatted).not.toContain("raw edit preview");
    expect(formatted).not.toContain("operation: Edit");
    expect(formatted).not.toContain("ev-edit-1");
  });

  it("keeps Bash output summary-first while preserving a full log path", () => {
    const text = Array.from({ length: 50 }, (_, index) => `bash line ${index + 1}`).join("\n");
    const formatted = formatToolOutput(
      "Bash",
      {
        text,
        fullOutputPath: ".linghun/logs/tools/bash-test.log",
        truncated: false,
        data: { exitCode: 0 },
      },
      "en-US",
      "ev-bash-1",
    );

    expect(formatted).toContain("Tool Bash completed");
    expect(formatted).toContain("50 line(s)");
    expect(formatted).toContain("exit code 0");
    expect(formatted).toContain("Output summarized; use /details for the full result.");
    expect(formatted).toContain("More details are available with /details.");
    expect(formatted).not.toContain("Primary output is summary-first");
    expect(formatted).not.toContain("Full log: .linghun/logs/tools/bash-test.log");
    expect(formatted).not.toContain("Evidence: ev-bash-1");
    expect(formatted).not.toContain("bash line 1");
    expect(formatted).not.toContain("bash line 50");
  });

  it("summarizes possible Windows Bash mojibake without dumping garbled stdout", () => {
    const formatted = formatToolOutput(
      "Bash",
      {
        text: "Ã¤Â¸Â­Ã¦Â–Â‡ output should stay out of primary",
        fullOutputPath: ".linghun/logs/tools/bash-mojibake.log",
        data: { exitCode: 0 },
      },
      "zh-CN",
    );

    expect(formatted).toContain("疑似编码问题");
    expect(formatted).toContain("更多详情可通过 /details 查看。");
    expect(formatted).not.toContain("完整日志：.linghun/logs/tools/bash-mojibake.log");
    expect(formatted).not.toContain("Ã¤Â¸Â­Ã¦Â–Â‡");
  });

  it("does not generate LINGHUN.md when direct project-rules file read is missing", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from(["读一下 LINGHUN.md\n/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(output.text).toContain("ENOENT");
    expect(output.text).toContain("LINGHUN.md");
    expect(output.text).toContain("/memory init");
    expect(output.text).not.toContain("已生成基础 LINGHUN.md");
    await expect(readFile(join(project, "LINGHUN.md"), "utf8")).rejects.toThrow();
  });

  it("keeps provider failure primary output clean while preserving evidence", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        defaultModel: "failure-primary-model",
        providers: {
          deepseek: { model: "different-model" },
          "openai-compatible": {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "failure-primary-model",
          },
        },
      }),
      "utf8",
    );
    const requests = mockOpenAiErrorFetch();
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from(["普通开发请求\n/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    const session = (
      await new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project }).list()
    ).at(0);
    const transcript = await readFile(session?.transcriptPath ?? "", "utf8");

    expect(requests).toHaveLength(1);
    expect(output.text).toContain("模型请求未完成。可运行 /model doctor 查看详情后重试。");
    expect(output.text).not.toContain("Evidence:");
    expect(output.text).not.toContain("证据记录：");
    expect(output.text).not.toContain("tool_result");
    expect(output.text).not.toContain("EvidenceSummary");
    expect(output.text).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu,
    );
    expect(transcript).toContain("provider_failure code=PROVIDER_STREAM_ERROR");
    expect(transcript).toContain('"type":"evidence_record"');
    expect(transcript).toContain('"type":"system_event"');
  });

  it("persists provider failure evidence and shows last failure in doctor", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        defaultModel: "failure-model",
        providers: {
          deepseek: { model: "different-model" },
          "openai-compatible": {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "failure-model",
          },
        },
      }),
      "utf8",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const body = `data: ${JSON.stringify({ error: { message: "quota exceeded sk-provider-secret C:/Users/Admin/Linghun api_key=private" } })}\n\ndata: [DONE]\n\n`;
        return new Response(body, { status: 200 });
      }),
    );
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from(["普通开发请求\n/model doctor\n/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(output.text).toContain("模型请求未完成。可运行 /model doctor 查看详情后重试。");
    expect(output.text).not.toContain("Evidence:");
    expect(output.text).not.toContain("证据记录：");
    expect(output.text).not.toContain("tool_result");
    expect(output.text).not.toContain("EvidenceSummary");
    expect(output.text).not.toContain("evidence=");
    expect(output.text).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu,
    );
    expect(output.text).toContain("last provider failure: code=PROVIDER_STREAM_ERROR");
    expect(output.text).toContain("provider=openai-compatible model=failure-model");
    expect(output.text).toContain("endpointProfile=chat_completions");
    expect(output.text).toContain("details: /details evidence");
    expect(output.text).not.toContain("sk-provider-secret");
    expect(output.text).not.toContain("C:/Users/Admin/Linghun");
    expect(output.text).not.toContain("api_key=private");
    const session = (
      await new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project }).list()
    ).at(0);
    const transcript = await readFile(session?.transcriptPath ?? "", "utf8");
    expect(transcript).toContain("provider_failure code=PROVIDER_STREAM_ERROR");
    expect(transcript).toContain('"type":"evidence_record"');
    expect(transcript).toContain('"type":"system_event"');
    expect(transcript).not.toContain("sk-provider-secret");
    expect(transcript).not.toContain("C:/Users/Admin/Linghun");
    expect(transcript).not.toContain("api_key=private");
  });

  it("handles slash model doctor without leaking API keys", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        providers: {
          "openai-compatible": {
            baseUrl: "https://example.invalid/v1",
            apiKey: "test-openai-secret",
            model: "openai-compatible-model",
          },
        },
        modelRoutes: {
          routes: [{ role: "vision", provider: "openai-compatible", primaryModel: "gpt-4o" }],
        },
      }),
      "utf8",
    );
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from(["/model doctor\n/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(output.text).toContain("Model route doctor");
    expect(output.text).toContain("openai-compatible 缺已确认模型");
    expect(output.text).toContain("LINGHUN_OPENAI_API_KEY");
    expect(output.text).not.toContain("test-openai-secret");
    expect(output.text).not.toContain("Start Gate：");
  });

  it("reports unknown provider when the current model has no provider match", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "unmatched-model" });
    const output = new MemoryOutput();
    const config: LinghunConfig = {
      ...defaultConfig,
      providers: {
        ...defaultConfig.providers,
        deepseek: {
          ...defaultConfig.providers.deepseek,
          model: "different-model",
        },
      },
    };
    const context = await createTestContext(project, store, session, config);

    await handleSlashCommand("/model", context, output);
    await handleSlashCommand("/usage", context, output);
    await handleSlashCommand("/stats", context, output);

    expect(output.text).toContain("provider=unknown model=unmatched-model");
    expect(output.text).toContain("- provider: unknown");
    expect(output.text).not.toContain("provider=deepseek model=unmatched-model");
    expect(output.text).not.toContain("- provider: deepseek");
  });

  it("shows WARN when primary route is usable but fallback is unavailable", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const config: LinghunConfig = {
      ...defaultConfig,
      modelRoutes: {
        ...defaultConfig.modelRoutes,
        routes: defaultConfig.modelRoutes.routes.map((route) =>
          route.role === "planner"
            ? {
                ...route,
                provider: "deepseek",
                primaryModel: "deepseek-v4-pro",
                fallbackModels: ["gpt-4o"],
              }
            : route,
        ),
      },
      providers: {
        ...defaultConfig.providers,
        "openai-compatible": {
          ...defaultConfig.providers["openai-compatible"],
          baseUrl: undefined,
          apiKey: undefined,
          model: "openai-compatible-model",
        },
      },
    };
    const context = await createTestContext(project, store, session, config);

    await handleSlashCommand("/model route doctor", context, output);

    expect(output.text).toContain("- planner: WARN");
    expect(output.text).toContain("fallback 不可用 gpt-4o");
    expect(output.text).not.toContain("- planner: BLOCK");
  });

  it("records route decisions and uses fallback when primary route is unavailable", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const config: LinghunConfig = {
      ...defaultConfig,
      modelRoutes: {
        ...defaultConfig.modelRoutes,
        routes: defaultConfig.modelRoutes.routes.map((route) =>
          route.role === "planner"
            ? {
                ...route,
                provider: "openai-compatible",
                primaryModel: "gpt-4o",
                fallbackModels: ["deepseek-v4-pro"],
              }
            : route,
        ),
      },
      providers: {
        ...defaultConfig.providers,
        "openai-compatible": {
          ...defaultConfig.providers["openai-compatible"],
          baseUrl: undefined,
          apiKey: undefined,
          model: "openai-compatible-model",
        },
      },
    };
    const context = await createTestContext(project, store, session, config);

    await handleSlashCommand("/fork planner test route decision", context, output);
    await handleSlashCommand("/stats", context, output);
    const parentTranscript = (await store.resume(session.id)).transcript;

    expect(context.agents[0]?.model).toBe("deepseek-v4-pro");
    expect(context.routeDecisions[0]?.fallbackUsed).toBe(true);
    expect(context.routeDecisions[0]?.selectedModel).toBe("deepseek-v4-pro");
    expect(parentTranscript.some((event) => event.type === "system_event")).toBe(true);
    expect(output.text).toContain("fallbackUsed=yes");
  });

  it("pauses unavailable routes with repair advice and diagnoses openai-compatible config", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const config: LinghunConfig = {
      ...defaultConfig,
      modelRoutes: {
        ...defaultConfig.modelRoutes,
        routes: defaultConfig.modelRoutes.routes.map((route) =>
          route.role === "vision"
            ? {
                ...route,
                provider: "openai-compatible",
                primaryModel: "gpt-4o",
                fallbackModels: [],
              }
            : route,
        ),
      },
      providers: {
        ...defaultConfig.providers,
        "openai-compatible": {
          ...defaultConfig.providers["openai-compatible"],
          baseUrl: undefined,
          apiKey: undefined,
          model: "openai-compatible-model",
        },
      },
    };
    const context = await createTestContext(project, store, session, config);

    await handleSlashCommand("/model route doctor", context, output);
    await handleSlashCommand("/vision screenshot.png", context, output);
    await handleSlashCommand("/model route doctor", context, output);

    expect(output.text).toContain("openai-compatible 缺 baseUrl");
    expect(output.text).toContain("openai-compatible 缺 apiKey");
    expect(output.text).toContain("LINGHUN_OPENAI_BASE_URL");
    expect(output.text).toContain("LINGHUN_OPENAI_API_KEY");
    expect(output.text).toContain("LINGHUN_OPENAI_MODEL");
    expect(output.text).toContain("重启 Linghun");
    expect(output.text).toContain("检查 .linghun/settings.json");
    expect(output.text).not.toContain("test-openai-secret");
    expect(output.text).toContain("vision role 未就绪");
    expect(output.text).toContain("修复建议");
    expect(output.text).toContain("recent route decisions");
    expect(context.routeDecisions[0]?.stopConditions.length).toBeGreaterThan(0);
    expect(context.visionObservations).toHaveLength(0);
  });

  it("warns when openai-compatible baseUrl contains a mismatched full endpoint", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const config: LinghunConfig = {
      ...defaultConfig,
      providers: {
        ...defaultConfig.providers,
        "openai-compatible": {
          ...defaultConfig.providers["openai-compatible"],
          baseUrl: "https://example.com/v1/responses",
          apiKey: "sk-test-openai-secret",
          model: "gpt-5.5",
          endpointProfile: "chat_completions",
        },
      },
    };
    const context = await createTestContext(project, store, session, config);

    await handleSlashCommand("/model route doctor", context, output);

    expect(output.text).toContain("provider=openai-compatible");
    expect(output.text).toContain("model=gpt-5.5");
    expect(output.text).toContain("endpointProfile=chat_completions");
    expect(output.text).toContain("compatibilityProfile=strict_openai_compatible");
    expect(output.text).toContain("baseUrl=present");
    expect(output.text).toContain("endpointPath=/v1/chat/completions");
    expect(output.text).toContain("warning: baseUrl 包含完整 endpoint suffix=responses");
    expect(output.text).toContain("profile/baseUrl 不匹配");
    expect(output.text).toContain("baseUrl 应填根路径，例如 https://example.com/v1");
    expect(output.text).toContain("apiKey=present");
    expect(output.text).toContain("masked=sk-…cret");
    expect(output.text).not.toContain("sk-test-openai-secret");
  });

  it("warns when doctor reads apiKey from project settings without leaking it", async () => {
    vi.stubEnv("LINGHUN_OPENAI_API_KEY", undefined);
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        providers: {
          "openai-compatible": {
            type: "openai-compatible",
            baseUrl: "https://example.invalid/v1",
            apiKey: "sk-project-doctor-secret",
            model: "gpt-5.5",
          },
        },
      }),
      "utf8",
    );
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from(["/model doctor\n/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(output.text).toContain("Model route doctor");
    expect(output.text).toContain("apiKey=present source=project-settings");
    expect(output.text).toContain(
      "WARN: project-settings provider=openai-compatible contains apiKey",
    );
    expect(output.text).toContain("建议保存 apiKey");
    expect(output.text).toContain("环境变量或私有配置");
    expect(output.text).toContain("masked=sk-…cret");
    expect(output.text).not.toContain("sk-project-doctor-secret");
    expect(output.text).not.toContain(project);
    expect(output.text).not.toContain("模型 key 配好了吗");
  });

  it("shows env source when env apiKey overrides project settings", async () => {
    vi.stubEnv("LINGHUN_OPENAI_API_KEY", "sk-env-doctor-secret");
    vi.stubEnv("LINGHUN_OPENAI_MODEL", "gpt-5.5");
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        providers: {
          "openai-compatible": {
            type: "openai-compatible",
            baseUrl: "https://example.invalid/v1",
            apiKey: "sk-project-overridden-secret",
            model: "openai-compatible-model",
          },
        },
      }),
      "utf8",
    );
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from(["/model doctor\n/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(output.text).toContain("apiKey=present source=env");
    expect(output.text).toContain("masked=sk-…cret");
    expect(output.text).toContain(
      "WARN: project-settings provider=openai-compatible contains apiKey",
    );
    expect(output.text).not.toContain("sk-project-overridden-secret");
    expect(output.text).not.toContain("sk-env-doctor-secret");
    expect(output.text).not.toContain(project);
    expect(output.text).not.toContain("/model doctor");
  });

  it("pauses openai-compatible routes when model is still unconfirmed", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const config: LinghunConfig = {
      ...defaultConfig,
      modelRoutes: {
        ...defaultConfig.modelRoutes,
        routes: defaultConfig.modelRoutes.routes.map((route) =>
          route.role === "vision"
            ? {
                ...route,
                provider: "openai-compatible",
                primaryModel: "gpt-4o",
                fallbackModels: [],
              }
            : route,
        ),
      },
      providers: {
        ...defaultConfig.providers,
        "openai-compatible": {
          ...defaultConfig.providers["openai-compatible"],
          baseUrl: "https://example.invalid/v1",
          apiKey: "test-openai-secret",
          model: "openai-compatible-model",
        },
      },
    };
    const context = await createTestContext(project, store, session, config);

    await handleSlashCommand("/vision screenshot.png", context, output);
    await handleSlashCommand("/model route doctor", context, output);

    expect(output.text).toContain("openai-compatible 缺已确认模型");
    expect(output.text).toContain("检查 .linghun/settings.json");
    expect(output.text).not.toContain("test-openai-secret");
    expect(output.text).toContain("vision role 未就绪");
    expect(context.routeDecisions[0]?.stopConditions).toContain("openai-compatible 缺已确认模型");
    expect(context.visionObservations).toHaveLength(0);
  });

  it("keeps worker writes behind the permission pipeline", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleSlashCommand("/mode plan", context, output);
    await handleSlashCommand("/fork worker write agent.txt hello", context, output);
    context.permissionMode = "full-access";
    await handleSlashCommand("/fork worker write agent.txt hello", context, output);

    expect(output.text).toContain("权限管道拒绝写入 agent.txt");
    expect(output.text).toContain("Plan 模式禁止写入");
    expect(output.text).toContain("已通过权限管道执行低风险写入 agent.txt");
    expect(await readFile(join(project, "agent.txt"), "utf8")).toBe("hello");
  });

  it("creates LINGHUN.md only on explicit memory init", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleSlashCommand("/memory init", context, output);

    expect(output.text).toContain("已生成基础 LINGHUN.md");
    const template = await readFile(join(project, "LINGHUN.md"), "utf8");
    expect(template).toContain("# 项目规则");
    expect(template).toContain("事实优先：先读代码、项目索引、文档或命令结果");
    expect(template).toContain("自然语言命令不能绕过 Start Gate 或权限审批");
    expect(template).toContain("长期记忆默认先生成候选");
    expect(template).toContain("改代码后运行项目认可的最小必要验证");
    expect(template).toContain("## 工程纪律");
    expect(template).toContain("默认只做完成当前任务所必需的最小改动");
    expect(template).toContain("不顺手修无关问题");
    expect(template).toContain("避免继续放大屎山");
    expect(template).toContain("涉及超过 3 个文件");
    expect(template).toContain("修 bug 要定位直接原因");
    expect(template).not.toContain("# Linghun Project Rules");

    const existingOutput = new MemoryOutput();
    await handleSlashCommand("/memory init", context, existingOutput);
    expect(existingOutput.text).toContain("LINGHUN.md 已存在");
    expect(await readFile(join(project, "LINGHUN.md"), "utf8")).toBe(template);
  });

  it("enforces plan permissions and records recent denials", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await writeFile(join(project, "sample.txt"), "alpha", "utf8");
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleSlashCommand("/permissions add allow Write medium", context, output);
    await handleSlashCommand("/permissions add allow Edit low", context, output);
    await handleSlashCommand("/permissions add allow Bash high", context, output);
    await handleSlashCommand("/mode plan", context, output);
    await handleSlashCommand("/read sample.txt", context, output);
    await handleSlashCommand("/write sample.txt beta", context, output);
    await handleSlashCommand("/edit sample.txt alpha => beta", context, output);
    await handleSlashCommand("/bash node --version", context, output);
    await handleSlashCommand("/permissions recent", context, output);

    expect(output.text).toContain("已切换权限模式：plan");
    expect(output.text).toContain("工具 Read 已完成");
    expect(output.text).toContain("权限已拒绝");
    expect(output.text).toContain("Plan 模式禁止写入");
    expect(output.text).not.toContain("命中 allow 规则");
    expect(await readFile(join(project, "sample.txt"), "utf8")).toBe("alpha");
  });

  it("creates and accepts structured plan proposals with explicit boundaries", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleSlashCommand("/plan", context, output);
    await handleSlashCommand("/plan accept manual a", context, output);

    expect(output.text).toContain("PlanProposal");
    expect(output.text).toContain("方案 a");
    expect(output.text).toContain("已确认计划");
    expect(output.text).toContain("写入、Bash、联网、依赖和权限变更仍走权限管道");
    expect(context.permissionMode).toBe("default");
  });

  it("shows only canonical modes and normalizes legacy aliases", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleSlashCommand("/mode", context, output);
    await handleSlashCommand("/mode acceptEdits", context, output);
    await handleSlashCommand("/mode dontAsk", context, output);
    await handleSlashCommand("/mode auto", context, output);

    expect(output.text).toContain("可选：default / auto-review / plan / full-access");
    expect(output.text).not.toContain(
      "可选：default / plan / acceptEdits / dontAsk / auto / bypass",
    );
    expect(output.text).toContain("已切换权限模式：auto-review");
    expect(output.text).toContain("已切换权限模式：default");
    expect(context.permissionMode).toBe("auto-review");
  });

  it("cycles canonical common modes and excludes legacy modes", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleSlashCommand("/tab", context, output);
    expect(context.permissionMode).toBe("auto-review");
    await handleSlashCommand("/tab", context, output);
    expect(context.permissionMode).toBe("plan");
    await handleSlashCommand("/tab", context, output);
    expect(context.permissionMode).toBe("default");
    expect(output.text).not.toContain("acceptEdits");
    expect(output.text).not.toContain("dontAsk");
    expect(output.text).not.toContain("bypass");
  });

  it("gates full-access aliases before local opt-in", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleSlashCommand("/mode bypass", context, output);
    await handleSlashCommand("/mode full-access", context, output);

    expect(output.text).toContain("full-access 必须本地显式 opt-in");
    expect(context.permissionMode).toBe("default");
  });

  it("allows auto-review low-risk edits but denies bash and medium writes", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await writeFile(join(project, "sample.txt"), "alpha", "utf8");
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleSlashCommand("/mode acceptEdits", context, output);
    await handleSlashCommand("/read sample.txt", context, output);
    await handleSlashCommand("/edit sample.txt alpha => beta", context, output);
    await handleSlashCommand("/write medium.txt should-not-write", context, output);
    await handleSlashCommand("/bash node --version", context, output);

    expect(output.text).toContain("已切换权限模式：auto-review");
    expect(output.text).toContain("写入前摘要");
    expect(output.text).toContain("工具 Edit 已完成");
    expect(output.text).toContain("auto-review 不自动允许 Bash");
    expect(output.text).toContain("风险：low");
    expect(await readFile(join(project, "sample.txt"), "utf8")).toBe("beta");
    await expect(readFile(join(project, "medium.txt"), "utf8")).rejects.toThrow();
  });

  it("keeps full-access behind hard denies", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);
    context.permissionMode = "full-access";

    await handleSlashCommand("/write .env secret", context, output);
    await handleSlashCommand("/bash rm -rf tmp", context, output);

    expect(output.text).toContain("安全保护：疑似密钥或敏感路径");
    expect(output.text).toContain("安全保护：拒绝高风险删除");
    await expect(readFile(join(project, ".env"), "utf8")).rejects.toThrow();
  });

  it("persists permission rules", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleSlashCommand("/permissions add deny Bash high", context, output);
    await handleSlashCommand("/permissions", context, output);
    const ruleId = context.permissions.rules[0]?.id;
    await handleSlashCommand(`/permissions remove ${ruleId}`, context, output);

    expect(output.text).toContain("已添加权限规则");
    expect(output.text).toContain("deny  Bash  high");
    expect(output.text).toContain("已删除规则");
  });

  it("records ask rules and deletes recent denials by id", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleSlashCommand("/permissions add ask Write medium", context, output);
    await handleSlashCommand("/write ask.txt should-not-write", context, output);
    await handleSlashCommand("/permissions recent", context, output);
    const recentId = context.permissions.recentDenied[0]?.id;
    await handleSlashCommand(`/permissions recent delete ${recentId}`, context, output);

    expect(output.text).toContain("命中 ask 规则");
    expect(output.text).toContain("需要用户确认后才会执行本次工具");
    expect(output.text).toContain("Write  default");
    expect(output.text).toContain("已删除最近拒绝");
    expect(context.permissions.recentDenied).toHaveLength(0);
    await expect(readFile(join(project, "ask.txt"), "utf8")).rejects.toThrow();
  });

  it("switches i18n output between zh-CN and en-US", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleSlashCommand("/help", context, output);
    await handleSlashCommand("/language en-US", context, output);
    await handleSlashCommand("/help", context, output);
    await handleSlashCommand("/not-a-command", context, output);
    await handleSlashCommand("/read missing.txt", context, output);

    expect(output.text).toContain("可用命令");
    expect(output.text).toContain("Language switched to English.");
    expect(output.text).toContain("Available commands");
    expect(output.text).toContain("Status: session");
    expect(output.text).toContain("Unknown command: /not-a-command");
    expect(output.text).toContain("Error:");
  });

  it("creates checkpoints and restores them with rewind", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await writeFile(join(project, "sample.txt"), "alpha", "utf8");
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);
    context.permissionMode = "full-access";

    await handleSlashCommand("/write sample.txt beta", context, output);
    const checkpointId = context.checkpoints[0]?.id;
    await handleSlashCommand("/rewind", context, output);
    await handleSlashCommand(`/rewind restore ${checkpointId}`, context, output);

    expect(output.text).toContain("已创建 checkpoint");
    expect(output.text).toContain("已恢复 checkpoint");
    expect(await readFile(join(project, "sample.txt"), "utf8")).toBe("alpha");
  });

  it("tracks background task status and empty output state", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);
    context.permissionMode = "full-access";

    await handleSlashCommand("/bash node --version", context, output);
    await handleSlashCommand("/background", context, output);

    expect(output.text).toContain("[后台]");
    expect(output.text).toContain("Bash:");
    expect(context.backgroundTasks[0]?.status).toBe("completed");
    expect(context.backgroundTasks[0]?.logPath).toBeTruthy();
  });

  it("guards foreground model requests and background resource caps", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);
    context.permissionMode = "full-access";

    context.activeAbortController = new AbortController();
    await expect(handleNaturalInput("普通模型请求", context, output)).resolves.toBe("handled");
    expect(output.text).toContain("已有前台模型请求正在运行");
    context.activeAbortController = undefined;

    context.backgroundTasks = [
      createBackgroundTaskFixture("mcp"),
      createBackgroundTaskFixture("job"),
      createBackgroundTaskFixture("compact"),
      createBackgroundTaskFixture("bash"),
    ];
    await handleSlashCommand("/verify smoke", context, output);
    expect(output.text).toContain("后台任务已达到全局上限 4");

    context.backgroundTasks = [createBackgroundTaskFixture("bash")];
    await handleSlashCommand("/bash node --version", context, output);
    expect(output.text).toContain("bash 后台任务已达到上限 1");

    context.backgroundTasks = [createBackgroundTaskFixture("verification")];
    await handleSlashCommand("/verify smoke", context, output);
    expect(output.text).toContain("verification 后台任务已达到上限 1");

    context.backgroundTasks = [createBackgroundTaskFixture("index")];
    await handleSlashCommand("/index refresh", context, output);
    expect(output.text).toContain("index 后台任务已达到上限 1");

    context.backgroundTasks = [
      createBackgroundTaskFixture("agent"),
      createBackgroundTaskFixture("agent"),
      createBackgroundTaskFixture("agent"),
    ];
    await handleSlashCommand("/fork explorer inspect cache", context, output);
    expect(output.text).toContain("agent 后台任务已达到上限 3");

    context.backgroundTasks = [createBackgroundTaskFixture("verification")];
    await handleSlashCommand("/bash node --version", context, output);
    expect(output.text).toContain("已有重任务正在运行：verification");
    expect(context.permissionMode).toBe("full-access");
  });

  it("marks stale background tasks and preserves log traceability", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);
    const old = new Date(Date.now() - 10_000).toISOString();
    context.backgroundTasks = [
      createBackgroundTaskFixture("bash", {
        id: "bash-stale",
        updatedAt: old,
        lastOutputAt: old,
        staleAfterMs: 1,
        logPath: join(project, ".linghun", "logs", "bash-stale.log"),
      }),
      createBackgroundTaskFixture("verification", {
        id: "verify-timeout",
        status: "timeout",
        result: "timeout",
        userVisibleSummary: "TIMEOUT：验证超时，未生成 PASS 证据。",
      }),
      createBackgroundTaskFixture("agent", {
        id: "agent-cancelled",
        status: "cancelled",
        result: "cancelled",
        userVisibleSummary: "agent cancelled",
      }),
    ];

    await handleSlashCommand("/background", context, output);
    await handleSlashCommand("/details background bash-stale", context, output);
    await handleSlashCommand("/details output bash-stale", context, output);

    expect(context.backgroundTasks.find((task) => task.id === "bash-stale")?.status).toBe("stale");
    expect(output.text).toContain("stale");
    expect(output.text).toContain("timeout");
    expect(output.text).toContain("cancelled");
    expect(output.text).toContain("bash-stale.log");
    expect(output.text).toContain("Background output bash-stale");
    expect(output.text).toContain("- path:");
  });

  it("reads known log artifacts through details output slices summary-first", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const logDir = join(project, ".linghun", "logs", "tools");
    await mkdir(logDir, { recursive: true });
    const logPath = join(logDir, "bash-artifact.log");
    await writeFile(
      logPath,
      [
        "line 1 should stay out of tail",
        "Authorization: Bearer sk-secret123456789",
        "before failure",
        "TypeError: failed candidate",
        "after failure",
        "最后一行中文输出",
      ].join("\n"),
      "utf8",
    );
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);
    context.backgroundTasks = [
      createBackgroundTaskFixture("bash", {
        id: "bash-artifact",
        status: "failed",
        result: "fail",
        outputPath: logPath,
        logPath,
        userVisibleSummary: "command failed; inspect candidates only",
      }),
    ];
    const srcDir = join(project, "src");
    await mkdir(srcDir, { recursive: true });
    const ordinarySource = join(srcDir, "app.ts");
    const explicitEvidenceOutput = join(project, "evidence-output.log");
    await writeFile(ordinarySource, "ordinary source must not be sliced", "utf8");
    await writeFile(
      explicitEvidenceOutput,
      ["explicit evidence output start", "explicit evidence output tail"].join("\n"),
      "utf8",
    );
    context.evidence = [
      {
        id: "ev-explicit",
        kind: "command_output",
        source: ordinarySource,
        fullOutputPath: explicitEvidenceOutput,
        summary: "has explicit output artifact",
        supportsClaims: [],
        createdAt: new Date().toISOString(),
      },
    ];

    await handleSlashCommand("/details output bash-artifact --tail 2", context, output);
    await handleSlashCommand("/details output ev-explicit --tail 1", context, output);
    await handleSlashCommand(
      "/details output bash-artifact --grep TypeError --context 1",
      context,
      output,
    );
    await handleSlashCommand("/details output bash-artifact --errors", context, output);
    await handleSlashCommand("/details output missing --tail 2", context, output);

    expect(output.text).toContain("Log artifact tail 切片");
    expect(output.text).toContain("Log artifact grep 切片");
    expect(output.text).toContain("Log artifact errors 切片");
    expect(output.text).toContain("最后一行中文输出");
    expect(output.text).toContain("sourcePath: .linghun/logs/tools/bash-artifact.log");
    expect(output.text).toContain("sourcePath: redacted:evidence-output.log");
    expect(output.text).toContain("explicit evidence output tail");
    expect(output.text).toContain("before failure");
    expect(output.text).toContain("TypeError: failed candidate");
    expect(output.text).toContain("do not change verification PASS/PARTIAL/FAIL");
    expect(output.text).toContain("未找到 output");
    expect(output.text).toContain("完整日志不会进入主屏、prompt、memory 或 handoff");
    expect(output.text).not.toContain("sk-secret123456789");
  });

  it("blocks code-fact answers without evidence and downgrades unsupported claims", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleSlashCommand("/claim-check", context, output);
    await handleSlashCommand("/claim-check 已修复并已验证", context, output);

    expect(output.text).toContain("用法：/claim-check <claim>");
    expect(output.text).toContain("缺少证据");
    expect(output.text).toContain("未验证 / 待确认");
  });

  it("keeps /btw isolated from todo, plan, and checkpoints", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleSlashCommand("/plan", context, output);
    await handleSlashCommand("/todo add 主任务", context, output);
    await handleSlashCommand("/btw 现在是什么阶段？", context, output);

    expect(output.text).toContain("临时插问");
    expect(context.activePlan).toBeTruthy();
    expect(context.tools.todos).toHaveLength(1);
    expect(context.checkpoints).toHaveLength(0);
  });

  it("records interrupt state clearly", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleSlashCommand("/interrupt", context, output);

    expect(output.text).toContain("状态为 idle");
  });

  it("/interrupt cancels active verification without pass evidence", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await writeFile(
      join(project, "package.json"),
      JSON.stringify({ scripts: { smoke: 'node -e "setTimeout(()=>{}, 2000)"' } }),
      "utf8",
    );
    const sessionRoot = await mkdtemp(join(tmpdir(), "linghun-tui-sessions-"));
    const store = new SessionStore({ sessionRootDir: sessionRoot, projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    const running = handleSlashCommand("/verify", context, output);
    await waitForTestCondition(
      () => Boolean(context.activeVerificationAbortController) && output.text.includes("验证步骤"),
    );
    await handleSlashCommand("/interrupt", context, output);
    await running;

    expect(context.lastVerification?.status).toBe("cancelled");
    expect(context.backgroundTasks[0]?.status).toBe("cancelled");
    expect(context.backgroundTasks[0]?.result).toBe("cancelled");
    expect(context.evidence[0]?.supportsClaims).not.toContain("已验证");
    expect(context.evidence[0]?.supportsClaims).toContain("verification:cancelled");
    expect(output.text).toContain("CANCELLED");
    expect(output.text).toContain("未生成 PASS 证据");
  });

  it("keeps stale verification conservative even if the command later succeeds", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await writeFile(
      join(project, "package.json"),
      JSON.stringify({
        scripts: { smoke: 'node -e "setTimeout(()=>{console.log(\\"eventual pass\\")}, 500)"' },
      }),
      "utf8",
    );
    const sessionRoot = await mkdtemp(join(tmpdir(), "linghun-tui-sessions-"));
    const store = new SessionStore({ sessionRootDir: sessionRoot, projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const backgroundOutput = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    const running = handleSlashCommand("/verify", context, output);
    await waitForTestCondition(
      () => Boolean(context.activeVerificationAbortController) && output.text.includes("验证步骤"),
    );
    const task = context.backgroundTasks[0];
    const old = new Date(Date.now() - 5_000).toISOString();
    task.staleAfterMs = 1;
    task.lastOutputAt = old;
    task.updatedAt = old;
    await handleSlashCommand("/background", context, backgroundOutput);
    await running;

    expect(backgroundOutput.text).toContain("stale");
    expect(context.lastVerification?.status).toBe("stale");
    expect(context.backgroundTasks[0]?.status).toBe("stale");
    expect(context.backgroundTasks[0]?.result).toBe("stale");
    expect(context.evidence[0]?.supportsClaims).not.toContain("已验证");
    expect(context.evidence[0]?.supportsClaims).toContain("verification:stale");
    expect(output.text).toContain("STALE");
    expect(output.text).toContain("未生成 PASS 证据");
  });

  it("keeps review and evidence conservative for non-pass verification outcomes", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleSlashCommand("/review", context, output);
    expect(output.text).toContain("CONSERVATIVE_NO_PASS");
    expect(output.text).toContain("尚未运行 /verify");

    for (const status of ["fail", "partial", "cancelled", "timeout", "stale"] as const) {
      context.lastVerification = createVerificationReportFixture(status);
      await handleSlashCommand("/review", context, output);
      await handleSlashCommand("/claim-check 已验证", context, output);
      expect(output.text).toContain("CONSERVATIVE_NO_PASS");
      expect(output.text).toContain("缺少证据");
    }

    context.lastVerification = createVerificationReportFixture("pass");
    await handleSlashCommand("/review", context, output);
    expect(output.text).toContain("SCOPED_PASS_WITH_EVIDENCE");
  });

  it("generates and runs verification plans with transcript evidence", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await writeFile(
      join(project, "package.json"),
      JSON.stringify({ scripts: { smoke: "node -e \"console.log('ok')\"" } }),
      "utf8",
    );
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleSlashCommand("/verify plan", context, output);
    await handleSlashCommand("/verify", context, output);
    await handleSlashCommand("/verify last", context, output);

    const transcript = (await store.resume(session.id)).transcript;
    expect(output.text).toContain("验证计划");
    expect(output.text).toContain("PASS");
    expect(output.text).toContain("日志：");
    expect(context.lastVerification?.status).toBe("pass");
    expect(context.backgroundTasks[0]?.kind).toBe("verification");
    expect(context.backgroundTasks[0]?.result).toBe("pass");
    expect(transcript.some((event) => event.type === "verification_start")).toBe(true);
    expect(transcript.some((event) => event.type === "verification_end")).toBe(true);
    expect(
      transcript.some((event) => event.type === "evidence_record" && event.kind === "test_result"),
    ).toBe(true);
  });

  it("reports failed verification with log path and next action", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await writeFile(
      join(project, "package.json"),
      JSON.stringify({ scripts: { smoke: 'node -e "process.exit(3)"' } }),
      "utf8",
    );
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleSlashCommand("/verify", context, output);

    expect(context.lastVerification?.status).toBe("fail");
    expect(output.text).toContain("FAIL");
    expect(output.text).toContain("复跑 /verify");
    expect(output.text).toContain("log:");
    expect(context.lastVerification?.commands[0]?.logPath).toBeTruthy();
  }, 10_000);

  it("classifies Vitest cleanup crashes after passing tests as runner partial", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await writeFile(
      join(project, "package.json"),
      JSON.stringify({
        scripts: {
          smoke:
            "node -e \"console.log('Test Files  10 passed'); console.log('Tests  48 passed'); console.error('TypeError: emitter.removeListener is not a function'); process.exit(1)\"",
        },
      }),
      "utf8",
    );
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleSlashCommand("/verify", context, output);
    await handleSlashCommand("/verify last", context, output);
    await handleSlashCommand("/review", context, output);

    expect(context.lastVerification?.status).toBe("partial");
    expect(context.lastVerification?.commands[0]?.status).toBe("partial");
    expect(output.text).toContain("PARTIAL");
    expect(output.text).toContain("runner error");
    expect(output.text).toContain("Node 22 LTS");
    expect(output.text).toContain("log:");
    expect(context.backgroundTasks[0]?.result).toBe("partial");
  });

  it("classifies masked child signals as runner partial", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await writeFile(
      join(project, "package.json"),
      JSON.stringify({
        scripts: {
          smoke:
            "node -e \"console.log('before signal'); console.error('SIGTERM'); process.exit(1)\"",
        },
      }),
      "utf8",
    );
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleSlashCommand("/verify", context, output);

    expect(context.lastVerification?.status).toBe("partial");
    expect(context.lastVerification?.commands[0]?.runnerError).toContain("SIGTERM");
    expect(output.text).toContain("runner error");
  });

  it("supports smoke verification, review output, and claim evidence", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleSlashCommand("/claim-check 已验证", context, output);
    await handleSlashCommand("/verify smoke", context, output);
    await handleSlashCommand("/review", context, output);
    await handleSlashCommand("/claim-check 已验证", context, output);

    expect(output.text).toContain("缺少证据");
    expect(output.text).toContain("Review Report");
    expect(output.text).toContain("Priority");
    expect(output.text).toContain("Suggestion");
    expect(output.text).toContain("Claim Checker：通过");
  });

  it("keeps verification background summaries out of the input area", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleSlashCommand("/verify smoke", context, output);
    await handleSlashCommand("/background", context, output);

    expect(output.text).toContain("[后台]");
    expect(output.text).not.toContain("你> [后台]");
    expect(output.text).not.toContain("you> [background]");
  });

  it("computes cache hit rate without output tokens in denominator", () => {
    expect(
      computePromptCacheHitRate({
        inputTokens: 100,
        outputTokens: 900,
        cacheReadTokens: 50,
        cacheWriteTokens: 50,
        provider: "deepseek",
        model: "deepseek-v4-flash",
      }),
    ).toBe(0.25);
    expect(
      computePromptCacheHitRate({
        inputTokens: 0,
        outputTokens: 100,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        provider: "deepseek",
        model: "deepseek-v4-flash",
      }),
    ).toBeNull();
  });

  it("records cache usage, classifies write sources, and trims cache history", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "gpt-4.1" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session, {
      ...defaultConfig,
      providers: {
        ...defaultConfig.providers,
        "openai-compatible": {
          ...defaultConfig.providers["openai-compatible"],
          apiKey: "test-openai-key",
          baseUrl: "https://example.test/v1",
          model: "gpt-4.1",
        },
      },
    });

    const reported = recordModelUsage(context, {
      inputTokens: 100,
      outputTokens: 900,
      totalTokens: 1000,
      cacheReadTokens: 50,
      cacheWriteTokens: 50,
      cacheWriteTokensRaw: 50,
      endpoint: "/v1/messages",
    });
    const zeroReported = recordModelUsage(context, {
      inputTokens: 100,
      outputTokens: 10,
      totalTokens: 110,
      cacheReadTokens: 80,
      cacheWriteTokens: 0,
      cacheWriteTokensRaw: 0,
      endpoint: "/v1/responses",
    });
    const missing = recordModelUsage(context, {
      inputTokens: 10,
      outputTokens: 1,
      totalTokens: 11,
      endpoint: "/v1/chat/completions",
    });
    const estimated = recordModelUsage(context, {
      inputTokens: 10,
      outputTokens: 1,
      totalTokens: 11,
      cacheReadTokens: 2,
      cacheWriteTokens: 3,
      cacheWriteTokensEstimated: true,
      endpoint: "/v1/chat/completions",
    });

    expect(reported.cacheWriteTokensSource).toBe("reported");
    expect(zeroReported.cacheWriteTokensSource).toBe("zero_reported");
    expect(missing.cacheWriteTokensSource).toBe("missing");
    expect(estimated.cacheWriteTokensSource).toBe("estimated");
    expect(reported.hitRate).toBe(0.25);
    expect(reported.provider).toBe("openai-compatible");
    expect(context.cache.history.every((item) => item.provider === "openai-compatible")).toBe(true);

    await handleSlashCommand("/cache-log", context, output);
    await handleSlashCommand("/cache-log config size 2", context, output);
    await handleSlashCommand("/cache-log", context, output);

    expect(context.cache.history).toHaveLength(2);
    expect(context.cache.history[0]?.turn).toBe(3);
    expect(output.text).toContain("Cache log 最近");
    expect(output.text).toContain("write_source=zero_reported");
    expect(output.text).toContain("cache history size：2");
  });

  it("shows cache status, break-cache status, usage, and endpoint stats conservatively", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    recordModelUsage(context, {
      inputTokens: 100,
      outputTokens: 10,
      totalTokens: 110,
      cacheReadTokens: 80,
      cacheWriteTokens: 0,
      cacheWriteTokensRaw: 0,
      endpoint: "/v1/responses",
      rawUsage: { prompt_tokens: 100, cache_creation_tokens: 0 },
    });

    await handleSlashCommand("/cache status", context, output);
    context.model = "deepseek-v4-pro";
    recordModelUsage(context, {
      inputTokens: 20,
      outputTokens: 5,
      totalTokens: 25,
      cacheReadTokens: 5,
      cacheWriteTokens: 5,
      cacheWriteTokensRaw: 5,
      endpoint: "/v1/messages",
    });
    await handleSlashCommand("/break-cache status", context, output);
    await handleSlashCommand("/usage", context, output);
    await handleSlashCommand("/stats", context, output);
    await handleSlashCommand("/stats endpoints", context, output);
    await handleSlashCommand("/status", context, output);

    expect(output.text).toContain("cache write source");
    expect(output.text).toContain("freshness changedKeys");
    expect(output.text).toContain("modelProviderHash");
    expect(output.text).toContain("/cache warmup");
    expect(output.text).toContain("cache_creation/cache write 为 0");
    expect(output.text).toContain("不代表零写入成本");
    expect(output.text).toContain("任何金额只能标记 estimated");
    expect(output.text).toContain("cost: estimated unavailable");
    expect(output.text).toContain("/v1/responses: samples=1");
    expect(output.text).toContain("/v1/messages: samples=1");
    expect(output.text).not.toContain("零成本");
    expect(output.text).not.toContain("¥");
  });

  it("keeps index status fast by default without detect_changes", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const mockDir = await mkdtemp(join(tmpdir(), "linghun-codebase-memory-mock-"));
    const { config, callsPath } = await createMockCodebaseMemoryConfig(project, mockDir, {
      changed_count: 2,
    });
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session, config);

    await handleSlashCommand("/index status", context, output);

    expect(output.text).toContain("status: ready");
    expect(output.text).toContain("fast status：未运行 detect_changes");
    expect(await readMockCalls(callsPath)).toEqual(["list_projects", "index_status"]);
  });

  it("marks index status stale from explicit fresh check without refreshing", async () => {
    for (const command of ["/index status --fresh", "/index check"]) {
      const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
      const mockDir = await mkdtemp(join(tmpdir(), "linghun-codebase-memory-mock-"));
      const { config, callsPath } = await createMockCodebaseMemoryConfig(project, mockDir, {
        changed_files: ["src/a.ts", "src/b.ts"],
      });
      const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
      const session = await store.create({ model: "deepseek-v4-flash" });
      const output = new MemoryOutput();
      const context = await createTestContext(project, store, session, config);

      await handleSlashCommand(command, context, output);

      expect(output.text).toContain("status: stale");
      expect(output.text).toContain("changedFiles: 2");
      expect(output.text).toContain("detect_changes 发现 2 个变更文件");
      expect(output.text).toContain("不会自动刷新");
      expect(await readMockCalls(callsPath)).toEqual([
        "list_projects",
        "index_status",
        "detect_changes",
      ]);
    }
  });

  it("blocks index commands on unignored generated directories by default", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, "node_modules", "large-package"), { recursive: true });
    await writeFile(
      join(project, "node_modules", "large-package", "big.json"),
      "x".repeat(1_100_000),
      "utf8",
    );
    const mockDir = await mkdtemp(join(tmpdir(), "linghun-codebase-memory-mock-"));
    const { config, callsPath } = await createMockCodebaseMemoryConfig(project, mockDir);
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session, config);

    await handleSlashCommand("/index init fast", context, output);
    await handleSlashCommand("/index refresh", context, output);

    expect(output.text).toContain("索引安全门：/index init fast");
    expect(output.text).toContain("索引安全门：/index refresh");
    expect(output.text).toContain("主屏不展开完整风险清单");
    expect(output.text).not.toContain("- node_modules/");
    expect(output.text).not.toContain("generated/dependency directory");
    expect(output.text).toContain(".linghunignore 或 .cbmignore");
    expect(
      context.evidence.some((item) => item.supportsClaims.includes("risky_file:node_modules/")),
    ).toBe(true);
    expect(await readMockCalls(callsPath)).toEqual([]);
  });

  it("allows forced index commands to reach the index_repository path", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, "dist"), { recursive: true });
    await writeFile(join(project, "dist", "bundle.min.js"), "x".repeat(1_100_000), "utf8");
    const mockDir = await mkdtemp(join(tmpdir(), "linghun-codebase-memory-mock-"));
    const { config, callsPath } = await createMockCodebaseMemoryConfig(project, mockDir);
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session, config);

    await handleSlashCommand("/index init fast --force", context, output);
    await handleSlashCommand("/index refresh --force", context, output);

    const calls = await readMockCalls(callsPath);
    expect(calls.filter((tool) => tool === "index_repository")).toHaveLength(2);
    expect(output.text).not.toContain("索引前发现未排除的大文件风险");
  });

  it("keeps light hints out of the prompt/input area", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    recordModelUsage(context, {
      inputTokens: 100,
      outputTokens: 10,
      totalTokens: 110,
      cacheReadTokens: 1,
      cacheWriteTokens: 0,
      cacheWriteTokensRaw: 0,
    });
    await handleSlashCommand("/cache status", context, output);
    await handleSlashCommand("/status", context, output);
    context.language = "en-US";
    writeLightHintsForTest(output, context);

    expect(output.text).toContain(
      "[hint:warning] Cache hit rate dropped; suggestion: /break-cache status",
    );
    expect(output.text).not.toContain("你> [hint");
    expect(output.text).not.toContain("you> [hint");
    expect(output.text).not.toContain("¥");
  });

  it("uses actual provider and model in cache freshness hash", async () => {
    async function modelProviderHashFor(model: string, providerId: string): Promise<string> {
      const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
      const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
      const session = await store.create({ model });
      const output = new MemoryOutput();
      const config: LinghunConfig = {
        ...defaultConfig,
        providers: {
          ...defaultConfig.providers,
          [providerId]: {
            ...defaultConfig.providers.deepseek,
            type: providerId === "deepseek" ? "deepseek" : "openai-compatible",
            model,
          },
        },
      };
      const context = await createTestContext(project, store, session, config);

      await handleSlashCommand("/break-cache status", context, output);
      const match = output.text.match(/modelProviderHash: ([a-f0-9]+)/);
      expect(match).toBeTruthy();
      return match?.[1] ?? "";
    }

    const deepseekHash = await modelProviderHashFor("shared-model", "deepseek");
    const openaiHash = await modelProviderHashFor("shared-model", "openai-compatible");

    expect(openaiHash).not.toBe(deepseekHash);
  });

  it("keeps extension freshness hash stable across manifest and contribution order", async () => {
    async function writeExtensionFixtures(project: string, reversed: boolean): Promise<void> {
      await mkdir(join(project, ".linghun", "skills"), { recursive: true });
      await mkdir(join(project, ".linghun", "plugins"), { recursive: true });
      const skills = [
        [
          "a-skill.json",
          {
            id: "a-skill",
            triggers: ["z", "a"],
            permissions: ["write", "bash"],
            body: "full skill body must not affect freshness",
          },
        ],
        [
          "b-skill.json",
          { id: "b-skill", triggers: ["review", "bug"], permissions: ["network", "read"] },
        ],
      ] as const;
      const plugins = [
        [
          "a-plugin.json",
          {
            id: "a-plugin",
            source: "local",
            permissions: ["network", "bash"],
            contributions: {
              commands: ["/z", "/a"],
              hooks: ["PostToolUse", "PreToolUse"],
              workflows: ["review", "bug-fix"],
              skills: ["b-skill", "a-skill"],
              providers: ["z-provider", "a-provider"],
              mcpServers: ["z-mcp", "a-mcp"],
            },
          },
        ],
        [
          "b-plugin.json",
          {
            id: "b-plugin",
            source: "local",
            permissions: ["write", "read"],
            contributions: {
              commands: ["/b", "/a"],
              hooks: ["Workflow", "Notification"],
              workflows: ["refactor-plan", "doc-to-code"],
              skills: ["z-skill", "a-skill"],
              providers: ["b-provider", "a-provider"],
              mcpServers: ["b-mcp", "a-mcp"],
            },
          },
        ],
      ] as const;
      const orderedSkills = reversed ? [...skills].reverse() : skills;
      const orderedPlugins = reversed ? [...plugins].reverse() : plugins;
      for (const [file, value] of orderedSkills) {
        await writeFile(
          join(project, ".linghun", "skills", file),
          JSON.stringify({
            name: value.id,
            description: value.id,
            summary: value.id,
            source: "local",
            version: "1.0.0",
            fullBody: reversed
              ? "changed full body must not affect freshness"
              : "full body must not affect freshness",
            ...value,
            triggers: reversed ? [...value.triggers].reverse() : value.triggers,
            permissions: reversed ? [...value.permissions].reverse() : value.permissions,
          }),
          "utf8",
        );
      }
      for (const [file, value] of orderedPlugins) {
        await writeFile(
          join(project, ".linghun", "plugins", file),
          JSON.stringify({
            name: value.id,
            version: "1.0.0",
            description: value.id,
            ...value,
            permissions: reversed ? [...value.permissions].reverse() : value.permissions,
            contributions: Object.fromEntries(
              Object.entries(value.contributions).map(([key, items]) => [
                key,
                reversed ? [...items].reverse() : items,
              ]),
            ),
          }),
          "utf8",
        );
      }
    }

    async function pluginListHashFor(project: string, reverseTopLevel = false): Promise<string> {
      const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
      const session = await store.create({ model: "deepseek-v4-flash" });
      const output = new MemoryOutput();
      const context = await createTestContext(project, store, session);
      if (reverseTopLevel) {
        context.skills.skills.reverse();
        context.workflows.templates.reverse();
        context.hooks.hooks.reverse();
        context.plugins.plugins.reverse();
      }
      await handleSlashCommand("/break-cache status", context, output);
      const match = output.text.match(/pluginListHash: ([a-f0-9]+)/);
      expect(match).toBeTruthy();
      return match?.[1] ?? "";
    }

    const firstProject = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const secondProject = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await writeExtensionFixtures(firstProject, false);
    await writeExtensionFixtures(secondProject, true);
    const expectedHash = await pluginListHashFor(firstProject);

    await expect(pluginListHashFor(secondProject, true)).resolves.toBe(expectedHash);
  });

  it("shows default feature policy without enabling dangerous automation", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleSlashCommand("/features", context, output);

    expect(output.text).toContain("Recommended foundation");
    expect(output.text).toContain("Advanced/high-cost/automation");
    expect(output.text).toContain("Dangerous defaults");
    expect(output.text).toContain("Unsupported / pending");
    expect(output.text).toContain("auto full-repo index on startup=no");
    expect(output.text).toContain(
      "skills: discover manifests=yes; autoExecute=no; trustedIds=none",
    );
    expect(output.text).toContain("workflows: discover templates=yes; autoRun=no");
    expect(output.text).toContain(
      "plugins: discover manifests=yes; autoExecute=no; trustedIds=none",
    );
    expect(output.text).toContain(
      "full-access permission: default off; requires LINGHUN_ENABLE_FULL_ACCESS=1",
    );
    expect(output.text).toContain("hooks: enabled=no; projectTrusted=no; auto execution=no");
    expect(output.text).toContain("continuous phase progression=no");
    expect(output.text).not.toContain("EvidenceSummary");
    expect(output.text).not.toContain("tool_result");
    expect(output.text).not.toContain("Evidence:");
    expect(context.config.permission.defaultMode).toBe("default");
    expect(context.hooks.enabled).toBe(false);
    expect(context.hooks.projectTrusted).toBe(false);
    expect(context.skills.trustedIds).toEqual([]);
    expect(context.plugins.trustedIds).toEqual([]);
  });

  it("surfaces empty model streams as provider_empty_response instead of silent prompt return", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        ...defaultConfig,
        defaultModel: "empty-model",
        providers: {
          ...defaultConfig.providers,
          "openai-compatible": {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "empty-model",
          },
        },
      }),
      "utf8",
    );
    const output = new MemoryOutput();
    const requests = mockOpenAiEmptyFetch(
      'data: {"id":"chatcmpl-empty","choices":[]}\n\ndata: {"usage":{"prompt_tokens":3,"completion_tokens":0,"total_tokens":3}}\n\ndata: [DONE]\n\n',
    );

    await runTui({
      projectPath: project,
      stdin: Readable.from(["帮我分析一下这个项目怎么部署，并生成报告在根目录下\n", "/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const sessions = await store.list();
    const transcript = (await store.resume(sessions[0]?.id ?? "")).transcript;

    expect(requests).toHaveLength(1);
    expect(output.text).toContain("模型没有返回有效回答。可运行 /model doctor 查看详情后重试。");
    expect(output.text).toContain("/model doctor");
    expect(output.text).not.toContain("证据记录：");
    expect(output.text).not.toContain("Evidence:");
    expect(output.text).not.toContain("tool_result");
    expect(output.text).not.toContain("EvidenceSummary");
    expect(output.text).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu,
    );
    expect(output.text).not.toMatch(/正在思考…\.\.\.\s*[^模]*Linghun/u);
    expect(
      transcript.some(
        (event) =>
          event.type === "evidence_record" &&
          event.supportsClaims.includes("provider_empty_response"),
      ),
    ).toBe(true);
    expect(
      transcript.some(
        (event) =>
          event.type === "system_event" && event.message.includes("provider_empty_response"),
      ),
    ).toBe(true);
  });

  it("lets read-and-summarize requests reach the model loop", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(join(project, "README.md"), "# Test\n", "utf8");
    await writeFile(join(project, "docs-README.md"), "# Other\n", "utf8");
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        ...defaultConfig,
        defaultModel: "summary-model",
        providers: {
          ...defaultConfig.providers,
          "openai-compatible": {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "summary-model",
          },
        },
      }),
      "utf8",
    );
    const output = new MemoryOutput();
    const requests = mockOpenAiTextFetch("README 摘要");

    await runTui({
      projectPath: project,
      stdin: Readable.from(["请读取 README 并总结\n", "/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(requests).toHaveLength(1);
    expect(output.text).toContain("README 摘要");
    expect(output.text).not.toContain("找到多个可能文件");
  });

  it("shows provider stream errors as actionable model errors", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        ...defaultConfig,
        defaultModel: "error-model",
        providers: {
          ...defaultConfig.providers,
          "openai-compatible": {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "error-model",
          },
        },
      }),
      "utf8",
    );
    const output = new MemoryOutput();
    mockOpenAiErrorFetch();

    await runTui({
      projectPath: project,
      stdin: Readable.from(["请读取项目并总结\n", "/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(output.text).toContain("模型请求未完成。可运行 /model doctor 查看详情后重试。");
    expect(output.text).toContain("/model doctor");
    expect(output.text).not.toContain("quota exceeded");
    expect(output.text).not.toContain("Evidence:");
    expect(output.text).not.toContain("证据记录：");
  });

  it("clears a previous Architecture Card before a non-triggering small task tool_use", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        ...defaultConfig,
        defaultModel: "architecture-card-scope-model",
        providers: {
          ...defaultConfig.providers,
          "openai-compatible": {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "architecture-card-scope-model",
          },
        },
      }),
      "utf8",
    );
    const requests: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        requests.push(JSON.parse(String(init.body)));
        if (requests.length === 1) {
          const body = `data: ${JSON.stringify({ id: "chatcmpl-architecture-1", choices: [{ delta: { content: "已记录 Architecture Card。" } }] })}\n\ndata: [DONE]\n\n`;
          return new Response(body, { status: 200 });
        }
        if (requests.length === 2) {
          const body = `data: ${JSON.stringify({
            id: "chatcmpl-architecture-2",
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      id: "call-small-write",
                      type: "function",
                      function: {
                        name: "Write",
                        arguments: JSON.stringify({
                          path: "packages/other/src/small.ts",
                          content: "// typo fix\n",
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          })}\n\ndata: [DONE]\n\n`;
          return new Response(body, { status: 200 });
        }
        const body = `data: ${JSON.stringify({ id: "chatcmpl-architecture-3", choices: [{ delta: { content: "小修已完成。" } }] })}\n\ndata: [DONE]\n\n`;
        return new Response(body, { status: 200 });
      }),
    );
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from(["加一个导出报表功能\n", "修一个 typo\n", "yes\n", "/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(requests).toHaveLength(3);
    expect(output.text).not.toContain("Architecture drift");
    expect(output.text).toContain("Linghun 想执行 Write packages/other/src/small.ts。");
    expect(output.text).toContain("允许本次执行？yes / no");
    expect(output.text).toContain("工具 Write 已完成");
    await expect(readFile(join(project, "packages/other/src/small.ts"), "utf8")).resolves.toBe(
      "// typo fix\n",
    );
  });

  it("runs model Write tool_use through permission ask, yes, real write, and evidence", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        ...defaultConfig,
        defaultModel: "write-model",
        providers: {
          ...defaultConfig.providers,
          "openai-compatible": {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "write-model",
          },
        },
      }),
      "utf8",
    );
    await writeFile(
      join(project, "package.json"),
      JSON.stringify({ scripts: { build: "tsc" } }),
      "utf8",
    );
    const output = new MemoryOutput();
    const requests = mockOpenAiToolSequence(
      [
        { toolName: "Read", input: { path: "package.json" } },
        {
          toolName: "Write",
          input: {
            path: "deploy-report.md",
            content: "# 部署报告\n\n通过模型 Write 生成。",
          },
        },
      ],
      "已生成 deploy-report.md。\n结论：报告已保存。\n推断/未确认：部署细节需继续核对。\n下一步：打开 deploy-report.md 复核。",
    );

    await runTui({
      projectPath: project,
      stdin: Readable.from([
        "帮我分析一下这个项目怎么部署，并生成报告在根目录下\n",
        "yes\n",
        "/exit\n",
      ]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    const report = await readFile(join(project, "deploy-report.md"), "utf8");
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const sessions = await store.list();
    const transcript = (await store.resume(sessions[0]?.id ?? "")).transcript;

    expect(requests).toHaveLength(3);
    expect(output.text).toContain("写入 deploy-report.md");
    expect(output.text).toContain("允许本次写入？yes / no");
    expect(output.text).not.toContain("需要写入 deploy-report.md");
    expect(output.text).not.toContain("- 安全级别：");
    expect(output.text).toContain("报告已保存：deploy-report.md");
    expect(output.text).not.toContain("证据记录：");
    expect(output.text).not.toContain("Evidence:");
    expect(output.text).not.toContain("tool_result");
    expect(report).toContain("通过模型 Write 生成");
    expect(
      transcript.some((event) => event.type === "tool_result" && event.toolName === "Write"),
    ).toBe(true);
    expect(
      transcript.some(
        (event) => event.type === "evidence_record" && event.supportsClaims.includes("Write"),
      ),
    ).toBe(true);
    expect(output.text).not.toContain("raw tool_result");
    expect(output.text).not.toContain("systemic_gap");
  });

  it("keeps no-pending yes/no local and away from the model", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    const result = await handleNaturalInput("yes", context, output);

    expect(result).toBe("handled");
    expect(output.text).toContain("当前没有等待确认的 Start Gate");
  });

  it("runs Phase 15 pre-Beta end-to-end CCB user journey smoke", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(join(project, "LINGHUN.md"), "# 项目规则\n\n- 保持 summary-first。", "utf8");
    const mockDir = await mkdtemp(join(tmpdir(), "linghun-codebase-memory-mock-"));
    const { config, callsPath } = await createMockCodebaseMemoryConfig(project, mockDir);
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        ...config,
        defaultModel: "journey-model",
        providers: {
          ...config.providers,
          deepseek: { model: "different-model" },
          "openai-compatible": {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "journey-model",
          },
        },
      }),
      "utf8",
    );
    const output = new MemoryOutput();
    const requests = mockOpenAiTextFetch(
      "我会进入普通 model/tool loop，并在需要写入时走权限路径。﹤DONE﹥",
    );

    await runTui({
      projectPath: project,
      stdin: Readable.from([
        "/help\n",
        "/index status\n",
        "/index refresh\n",
        "yes\n",
        "请分析项目并生成报告\n",
        "/write report.md draft\n",
        "/permissions add allow Write medium\n",
        "/write report.md final\n",
        "/permissions add allow Bash high\n",
        "/bash node -e \"for (let i = 0; i < 60; i += 1) console.log('journey-line-' + i)\"\n",
        "/model route doctor\n",
        "/mcp status\n",
        "/cache status\n",
        "/permissions recent\n",
        "/index status\n",
        "/exit\n",
      ]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(output.text).toContain("可用命令");
    expect(output.text).toContain("索引刷新完成");
    expect(output.text).toContain("当前没有等待确认的 Start Gate");
    expect(requests).toHaveLength(1);
    expect(output.text).toContain("正在思考…");
    expect(output.text).toContain("权限已拒绝");
    expect(output.text).toContain("工具 Write 已完成");
    expect(output.text).toContain("摘要");
    expect(await readFile(join(project, "report.md"), "utf8")).toBe("final");
    expect(output.text).toContain("工具 Bash 已完成");
    expect(output.text).toContain("输出已摘要");
    expect(output.text).toContain("Model route doctor");
    expect(output.text).toContain("MCP status");
    expect(output.text).toContain("Cache status");
    expect(output.text).toContain("最近拒绝");
    expect(output.text).toContain("Index status");
    expect(output.text).not.toContain("证据记录：");
    expect(await readMockCalls(callsPath)).toContain("index_repository");
    expect(output.text).not.toContain("systemic_gap");
    expect(output.text).not.toContain("blocking_P1");
    expect(output.text).not.toContain("Solution Completeness Gate report");
    expect(output.text).not.toContain("- decision:");
    expect(output.text).not.toContain("- risk:");
    expect(output.text).not.toContain("- mode:");
    expect(output.text).not.toContain("Index: start refresh");
    expect(output.text).not.toContain("Index refresh completed\n- status: ready\n- nodes/edges");
    expect(output.text).not.toContain("journey-line-59");
  });

  it("handles Phase 14 skills, workflows, plugins, hooks, and freshness", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun", "skills"), { recursive: true });
    await mkdir(join(project, ".linghun", "plugins"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "skills", "bug-helper.json"),
      JSON.stringify({
        id: "bug-helper",
        name: "Bug Helper",
        source: "third-party",
        version: "1.0.0",
        description: "Help debug local failures without loading full body.",
        triggers: ["bug", "failure"],
        summary: "Stable summary only.",
        permissions: ["write", "bash"],
      }),
      "utf8",
    );
    await writeFile(join(project, ".linghun", "skills", "broken-skill.json"), "{", "utf8");
    await writeFile(
      join(project, ".linghun", "plugins", "local-tools.json"),
      JSON.stringify({
        id: "local-tools",
        name: "Local Tools",
        source: "third-party",
        version: "0.1.0",
        description: "Local manifest contributions.",
        permissions: ["network", "bash"],
        contributions: {
          commands: ["/local-test"],
          hooks: ["PreToolUse"],
          workflows: ["bug-fix"],
          skills: ["bug-helper"],
          providers: ["local-provider"],
          mcpServers: ["local-mcp"],
        },
      }),
      "utf8",
    );
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleSlashCommand("/skills", context, output);
    await handleSlashCommand("/skills add", context, output);
    await handleSlashCommand("/skills enable broken-skill", context, output);
    await handleSlashCommand("/skills enable bug-helper", context, output);
    await handleSlashCommand("/skills disable bug-helper", context, output);
    await handleSlashCommand("/workflows", context, output);
    await handleSlashCommand("/workflows bug-fix", context, output);
    await handleSlashCommand("/plugins", context, output);
    await handleSlashCommand("/plugins doctor", context, output);
    await handleSlashCommand("/plugins enable local-tools", context, output);
    await handleSlashCommand("/plugins disable local-tools", context, output);
    await handleSlashCommand("/doctor hooks", context, output);
    await handleSlashCommand("/break-cache status", context, output);

    const orphanOutput = new MemoryOutput();
    const orphanContext = await createTestContext(project, store, session);
    await handleSlashCommand("/skills enable ghost-skill", orphanContext, orphanOutput);
    await handleSlashCommand("/plugins enable ghost-plugin", orphanContext, orphanOutput);

    expect(output.text).toContain("Skills（summary-first");
    expect(output.text).toContain("summary-first / load-on-demand");
    expect(output.text).toContain("broken-skill");
    expect(output.text).toContain("manifest load failed; skill isolated from prompt and tools");
    expect(output.text).toContain("lastError");
    expect(output.text).toContain("skill manifest 加载失败，不能启用：broken-skill");
    expect(output.text).toContain("Trust notice：即将启用 skill bug-helper");
    expect(output.text).toContain("已禁用 skill：bug-helper");
    expect(output.text).toContain("Workflows（本地模板");
    expect(output.text).toContain("bug-fix");
    expect(output.text).toContain("Workflow Start Gate：bug-fix");
    expect(output.text).toContain("recommended validation");
    expect(output.text).toContain("是否越界");
    expect(output.text).toContain("Plugins doctor");
    expect(output.text).toContain("Trust notice：即将启用 plugin local-tools");
    expect(output.text).toContain("已禁用 plugin：local-tools");
    expect(output.text).toContain("Hooks doctor");
    expect(output.text).toContain("timeoutMs");
    expect(output.text).toContain("outputLimitBytes");
    expect(output.text).toContain("logPath");
    expect(output.text).toContain("hook 诊断只检查来源、边界和可见状态");
    expect(output.text).toContain("pluginListHash");
    expect(output.text).not.toContain("完整 skill 正文");
    expect(orphanOutput.text).toContain("未知 skill：ghost-skill");
    expect(orphanOutput.text).toContain("未知 plugin：ghost-plugin");
  });

  it("handles Phase 15.5D Connect Lite extension lifecycle and guards", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const skillSource = join(project, "skill-source");
    const pluginSource = join(project, "plugin-source");
    await mkdir(skillSource, { recursive: true });
    await mkdir(pluginSource, { recursive: true });
    await writeFile(
      join(skillSource, "skill.json"),
      JSON.stringify({
        id: "connect-skill",
        name: "Connect Skill",
        description: "Connect Lite skill metadata.",
        summary: "Connect Lite summary.",
        triggers: ["connect"],
        permissions: ["write", "network"],
      }),
      "utf8",
    );
    await writeFile(
      join(pluginSource, "plugin.json"),
      JSON.stringify({
        id: "connect-plugin",
        name: "Connect Plugin",
        version: "1.0.0",
        description: "Connect Lite plugin metadata.",
        permissions: ["network"],
        contributions: { commands: ["/connect-plugin"], hooks: ["PreToolUse"] },
      }),
      "utf8",
    );
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleSlashCommand(`/skills install local ${skillSource}`, context, output);
    expect(
      validateExtensionContributionExecution("skills", "connect-skill", "connect", context),
    ).toEqual({
      ok: false,
      summary:
        "Connect Lite guard: skills:connect-skill 未启用或未信任，已拒绝执行。请先 validate/enable/doctor。",
    });
    await handleSlashCommand("/skills status", context, output);
    await handleSlashCommand("/skills validate connect-skill", context, output);
    await handleSlashCommand("/skills disable connect-skill", context, output);
    await handleSlashCommand("/skills enable connect-skill", context, output);
    expect(
      validateExtensionContributionExecution("skills", "connect-skill", "connect", context),
    ).toEqual({ ok: true });
    await handleSlashCommand("/skills update connect-skill", context, output);
    expect(
      validateExtensionContributionExecution("skills", "connect-skill", "connect", context),
    ).toEqual({
      ok: false,
      summary:
        "Connect Lite guard: skills:connect-skill 未启用或未信任，已拒绝执行。请先 validate/enable/doctor。",
    });
    await handleSlashCommand("/skills enable connect-skill", context, output);
    await handleSlashCommand("/skills install github owner/repo --ref main", context, output);
    await handleSlashCommand("/skills install github:owner/repo", context, output);
    await handleSlashCommand(`/plugins install ${pluginSource}`, context, output);
    expect(
      validateExtensionContributionExecution(
        "plugins",
        "connect-plugin",
        "/connect-plugin",
        context,
      ),
    ).toEqual({
      ok: false,
      summary:
        "Connect Lite guard: plugins:connect-plugin 未启用或未信任，已拒绝执行。请先 validate/enable/doctor。",
    });
    await handleSlashCommand("/plugins status", context, output);
    await handleSlashCommand("/plugins validate connect-plugin", context, output);
    await handleSlashCommand("/plugins enable connect-plugin", context, output);
    expect(
      validateExtensionContributionExecution(
        "plugins",
        "connect-plugin",
        "/connect-plugin",
        context,
      ),
    ).toEqual({ ok: true });
    await handleSlashCommand("/plugins update connect-plugin", context, output);
    expect(
      validateExtensionContributionExecution(
        "plugins",
        "connect-plugin",
        "/connect-plugin",
        context,
      ),
    ).toEqual({
      ok: false,
      summary:
        "Connect Lite guard: plugins:connect-plugin 未启用或未信任，已拒绝执行。请先 validate/enable/doctor。",
    });
    await handleSlashCommand("/plugins enable connect-plugin", context, output);
    await handleSlashCommand("/plugins install https://github.com/owner/repo", context, output);
    await handleSlashCommand("/plugins install github invalid --confirm-network", context, output);

    const resumed = await store.resume(session.id);
    expect(
      resumed.transcript.some(
        (event) =>
          event.type === "system_event" &&
          event.message.includes("connect_lite_network_start_gate_confirmed") &&
          event.message.includes("boundary=exact-command_start_gate_not_full_permission_approval"),
      ),
    ).toBe(true);

    expect(output.text).toContain("已安装 skill manifest：connect-skill");
    expect(output.text).toContain("Skills Connect Lite status");
    expect(output.text).toContain("localPath=present:skill-source");
    expect(output.text).toContain("Skills validate");
    expect(output.text).toContain("Trust notice：即将启用 skill connect-skill");
    expect(output.text).toContain("Connect Lite Start Gate：skills install github");
    expect(output.text).toContain("/skills install github owner/repo --ref main --confirm-network");
    expect(output.text).toContain("已安装 plugin manifest：connect-plugin");
    expect(output.text).toContain("Plugins Connect Lite status");
    expect(output.text).toContain("Plugins validate");
    expect(output.text).toContain("Trust notice：即将启用 plugin connect-plugin");
    expect(output.text).toContain("不执行仓库脚本、postinstall、hook、依赖安装或任意第三方代码");
    expect(
      validateExtensionContributionExecution("skills", "connect-skill", "connect", context),
    ).toEqual({ ok: true });
    expect(
      validateExtensionContributionExecution("skills", "connect-skill", "missing", context),
    ).toEqual({
      ok: false,
      summary: "Connect Lite guard: skill:connect-skill 未注册触发项 missing，已拒绝盲执行。",
    });
    expect(
      validateExtensionContributionExecution(
        "plugins",
        "connect-plugin",
        "/connect-plugin",
        context,
      ),
    ).toEqual({ ok: true });
    expect(
      validateExtensionContributionExecution("plugins", "connect-plugin", "/missing", context),
    ).toEqual({
      ok: false,
      summary: "Connect Lite guard: plugin:connect-plugin 未注册贡献项 /missing，已拒绝盲执行。",
    });
  });

  it("handles Phase 15.5D MCP Connect Lite lifecycle without running servers", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleSlashCommand("/mcp add local local-demo node --version", context, output);
    await handleSlashCommand("/mcp validate local-demo", context, output);
    await handleSlashCommand("/mcp disable local-demo", context, output);
    await handleSlashCommand("/mcp enable local-demo", context, output);
    await handleSlashCommand("/mcp update local-demo local node --help", context, output);
    await handleSlashCommand("/mcp remove local-demo", context, output);

    expect(output.text).toContain("已添加 MCP server：local-demo");
    expect(output.text).toContain("MCP validate");
    expect(output.text).toContain("source=present:node");
    expect(output.text).toContain("permissions=tool-discovery");
    expect(output.text).toContain("已禁用 MCP server：local-demo");
    expect(output.text).toContain("已启用 MCP server：local-demo");
    expect(output.text).toContain("已更新 MCP server：local-demo");
    expect(output.text).toContain("未执行 server");
    expect(output.text).toContain("已移除 MCP server：local-demo");
  });
});
