import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { PassThrough, Readable, Writable } from "node:stream";
import {
  type LinghunConfig,
  defaultConfig,
  getProjectSettingsPath,
  getProviderEnvPath,
  getSessionRootDir,
  getUserSettingsPath,
  loadConfig,
  resolveStoragePaths,
  saveProviderEnvSetup,
} from "@linghun/config";
import { SessionStore } from "@linghun/core";
import { computePromptCacheHitRate } from "@linghun/core";
import { createToolContext } from "@linghun/tools";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type BackgroundTaskState,
  type DeferredToolDescriptor,
  type TuiContext,
  USER_VISIBLE_DISPATCH_SLASH_COMMANDS,
  type VerificationReport,
  addAllowRuleForTest,
  containsSecret,
  createCacheState,
  createFailureLearningState,
  createHookState,
  createIndexState,
  createMcpState,
  createMemoryState,
  createModelGateway,
  createModelSystemPrompt,
  createPluginState,
  createRemoteEvent,
  createRemoteState,
  createSkillState,
  createSolutionCompletenessStatus,
  createWorkflowState,
  deferredToolListHashInput,
  executeExtraTool,
  executeSearchExtraTools,
  findDeferredTool,
  formatDeferredToolsSystemReminder,
  getCodebaseMemoryToolRisk,
  handleNaturalInput,
  handleSlashCommand,
  handleTuiKeypress,
  isPotentiallyMutatingMcpTool,
  listDeferredTools,
  parseMcpDeferredToolName,
  processRemoteApprovalForTest,
  recordModelUsage,
  runAutoLearningOnTurnEnd,
  runCommandCaptureForTest,
  runTui,
  runVerificationCommandForTest,
  searchDeferredTools,
  snapshotDeferredTools,
  snapshotDeferredToolsSummary,
  snapshotDiscoveredDeferredToolsSummary,
  sanitizeDiscoveredDeferredToolName,
  validateCodebaseMemoryToolExecution,
  validateExtensionContributionExecution,
  writeLightHintsForTest,
  __testCreateShellBlockOutput,
  __testCreateVerificationLevelForReadiness,
} from "./index.js";
import {
  formatSolutionCompletenessReportBlock,
  needsSolutionCompletenessReportClosure,
} from "./final-answer-gate.js";
import { validateCommandCapabilityCoverage } from "./natural-command-bridge.js";
import { formatModelToolPermissionPrompt } from "./permission-presenter.js";
import { consumeProcessGuardStopResultsForTest } from "./process-guard.js";
import {
  checkProviderCooldown,
  clearProviderBreaker,
  createProviderCircuitBreakerState,
  formatCooldownMessage,
  recordProviderFailure,
} from "./provider-circuit-breaker.js";
import { formatProviderFailurePrimary } from "./request-lifecycle-presenter.js";
import {
  buildFailureLearningSummaryForPrompt,
  loadFailureRecords,
  mergeFailureRecord,
} from "./failure-learning-runtime.js";
import { createOutputBlock, mapPendingApprovalToPermission } from "./shell/view-model.js";
import { formatFooterIndexLabel } from "./shell/models/footer-view.js";
import type { ProductBlockViewModel } from "./shell/types.js";
import {
  type TerminalReadinessView,
  createReadinessItems,
} from "./terminal-readiness-presenter.js";
import { createLayeredToolOutput, formatToolOutput } from "./tool-output-presenter.js";

class MemoryOutput extends Writable {
  text = "";

  override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: () => void): void {
    this.text += chunk.toString();
    callback();
  }
}

class TtyInput extends PassThrough {
  isTTY = true;
  isRaw = false;

  setRawMode(enabled: boolean): this {
    this.isRaw = enabled;
    return this;
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
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
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
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
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
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
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
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
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
    projects?: Array<{ name: string; root_path?: string }>;
  } = {},
): Promise<{ callsPath: string; mockPath: string }> {
  const callsPath = join(mockDir, `${options.fileName ?? "codebase-memory-mock"}-calls.jsonl`);
  const mockPath = join(mockDir, `${options.fileName ?? "codebase-memory-mock"}.cjs`);
  const projects = options.projects ?? [{ name: "test-project", root_path: project }];
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
  console.log(JSON.stringify({ projects: ${JSON.stringify(projects)} }));
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
    projects?: Array<{ name: string; root_path?: string }>;
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

async function readMockCallRecords(
  callsPath: string,
): Promise<Array<{ tool: string; input: Record<string, unknown> }>> {
  try {
    return (await readFile(callsPath, "utf8"))
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { tool: string; input: Record<string, unknown> });
  } catch {
    return [];
  }
}

async function readMockCalls(callsPath: string): Promise<string[]> {
  return (await readMockCallRecords(callsPath)).map((record) => record.tool);
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
    cache: createCacheState(project, session.model),
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
      rejected: [],
      disabled: [],
      retired: [],
      learningMode: "off",
    },
    failureLearning: createFailureLearningState(project),
    skills: await createSkillState(config, project),
    workflows: createWorkflowState(config),
    hooks: await createHookState(config, project),
    plugins: await createPluginState(config, project),
    remote: createRemoteState(config),
    agents: [],
    roleUsage: [],
    routeDecisions: [],
    roleHandoffs: [],
    visionObservations: [],
    imageResults: [],
    interrupt: { type: "idle" },
    recentlyMentionedFiles: [],
    lastProviderFailure: undefined,
    providerBreaker: createProviderCircuitBreakerState(),
    solutionCompleteness: createSolutionCompletenessStatus(),
    discoveredDeferredToolNames: new Set<string>(),
  };
}

async function createMockNativeRunner(
  project: string,
  options: { runnerDir?: string; runnerName?: string } = {},
): Promise<{ path: string; callsPath: string }> {
  const runnerDir = options.runnerDir ?? join(project, "mock runner 空格", "子目录");
  await mkdir(runnerDir, { recursive: true });
  const callsPath = join(runnerDir, "runner-calls.jsonl");
  const runnerPath = join(runnerDir, options.runnerName ?? "linghun-native-runner-mock.cjs");
  await writeFile(
    runnerPath,
    `const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const protocol = "linghun-native-runner-prototype.v1";
const mode = process.env.LINGHUN_MOCK_RUNNER_MODE || "available";
const callsPath = path.join(__dirname, "runner-calls.jsonl");
const argv = process.argv.slice(2);
fs.appendFileSync(callsPath, JSON.stringify({ argv }) + "\\n");
function argValue(name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
}
function print(value) {
  console.log(JSON.stringify(value));
}
if (argv[0] === "version") {
  if (mode === "corrupt-version") {
    console.log("not-json native runner version output");
    process.exit(0);
  }
  print({ ok: true, protocol: mode === "mismatch" ? "wrong-protocol.v0" : protocol, version: "0.1.0" });
  process.exit(0);
}
const id = argValue("--id", "missing");
const root = argValue("--root", path.join(__dirname, "runner-root"));
const jobDir = path.join(root, id);
if (argv[0] === "start") {
  if (mode === "start-fail") {
    console.error("runner start failed token=secret sk-live Authorization: Bearer raw");
    process.exit(2);
  }
  fs.mkdirSync(jobDir, { recursive: true });
  const timeoutMs = Number(argValue("--timeout-ms", "60000"));
  const heartbeatMs = Number(argValue("--heartbeat-ms", "100"));
  const separator = argv.indexOf("--");
  const commandArgs = separator >= 0 ? argv.slice(separator + 1) : [];
  const statePath = path.join(jobDir, "state.json");
  const stdoutPath = path.join(jobDir, "stdout.log");
  const stderrPath = path.join(jobDir, "stderr.log");
  const startedAt = Date.now();
  let child = commandArgs.length > 0 ? cp.spawn(commandArgs[0], commandArgs.slice(1), { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] }) : undefined;
  function writeState(status, extra = {}) {
    const stdoutRef = mode === "absolute-log-refs" ? stdoutPath : "stdout.log";
    const stderrRef = mode === "absolute-log-refs" ? stderrPath : "stderr.log";
    fs.writeFileSync(statePath, JSON.stringify({ protocol, id, status, updatedAt: Date.now(), heartbeatAt: Date.now(), timeoutMs, stdoutPath: stdoutRef, stderrPath: stderrRef, ...extra }, null, 2));
  }
  writeState("running", { pid: child?.pid || process.pid });
  fs.appendFileSync(stdoutPath, JSON.stringify({ kind: "mock-runner", status: "running", heartbeat: 0 }) + "\\n");
  if (child?.stdout) child.stdout.on("data", (chunk) => fs.appendFileSync(stdoutPath, chunk));
  if (child?.stderr) child.stderr.on("data", (chunk) => fs.appendFileSync(stderrPath, chunk));
  let terminal = false;
  let heartbeat = 0;
  const durationMs = Number(commandArgs.at(-1) || "1200");
  const finish = (status, exitCode = status === "completed" ? 0 : 1) => {
    if (terminal) return;
    terminal = true;
    writeState(status, { exitCode, pid: child?.pid || process.pid });
    print({ ok: true, protocol, id, status, exitCode, stdoutPath: "stdout.log", stderrPath: "stderr.log" });
    process.exit(status === "failed" ? 1 : 0);
  };
  if (child) {
    child.on("exit", (code) => finish(code === 0 ? "completed" : "failed", code ?? 1));
    child.on("error", () => finish("failed", 1));
  }
  const interval = setInterval(() => {
    heartbeat += 1;
    fs.appendFileSync(stdoutPath, JSON.stringify({ kind: "mock-runner", status: "heartbeat", heartbeat }) + "\\n");
    if (fs.existsSync(path.join(jobDir, "stop.request"))) {
      child?.kill();
      clearInterval(interval);
      finish("cancelled", 1);
      return;
    }
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= timeoutMs) {
      child?.kill();
      clearInterval(interval);
      finish("timeout", 1);
      return;
    }
    if (elapsedMs >= durationMs) {
      child?.kill();
      clearInterval(interval);
      finish("completed", 0);
      return;
    }
    writeState("running", { pid: child?.pid || process.pid });
  }, heartbeatMs);
  return;
}
if (argv[0] === "status") {
  if (mode === "status-fail") {
    console.error("runner status failed token=secret sk-live Authorization: Bearer raw");
    process.exit(3);
  }
  const statePath = path.join(jobDir, "state.json");
  if (!fs.existsSync(statePath)) {
    print({ ok: true, protocol, id, status: "missing" });
    process.exit(0);
  }
  print(JSON.parse(fs.readFileSync(statePath, "utf8")));
  process.exit(0);
}
if (argv[0] === "stop") {
  fs.mkdirSync(jobDir, { recursive: true });
  fs.writeFileSync(path.join(jobDir, "stop.request"), "stop");
  print({ ok: true, protocol, id, status: "cancelled" });
  process.exit(0);
}
print({ ok: false, protocol, status: "missing" });
process.exit(1);
`,
    "utf8",
  );
  if (process.platform !== "win32") {
    await chmod(runnerPath, 0o755);
  }
  return { path: runnerPath, callsPath };
}

async function readMockNativeRunnerCalls(callsPath: string): Promise<{ argv: string[] }[]> {
  const raw = await readFile(callsPath, "utf8").catch(() => "");
  return raw
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { argv: string[] });
}

async function waitForTestMs(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
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
  // D.14C baseline closure — isolate model env so the real machine's
  // ~/.linghun/provider.env (and any LINGHUN_*/OPENAI/ANTHROPIC keys) cannot
  // override per-test config. getUserConfigDir falls back to homedir()/.linghun
  // when LINGHUN_CONFIG_DIR is unset; without this, the dev box's openai-compat
  // key forces model=claude-opus-4-7 → anthropic_messages and the OpenAI-shaped
  // mocks below are rejected. Tests that need a specific home re-stub
  // LINGHUN_CONFIG_DIR themselves (later stub wins); the file-level afterEach
  // already calls vi.unstubAllEnvs().
  const PHASE06_MODEL_ENV_KEYS = [
    "LINGHUN_OPENAI_API_KEY",
    "LINGHUN_OPENAI_BASE_URL",
    "LINGHUN_OPENAI_MODEL",
    "LINGHUN_OPENAI_ENDPOINT_PROFILE",
    "LINGHUN_OPENAI_INCLUDE_USAGE",
    "LINGHUN_DEEPSEEK_API_KEY",
    "LINGHUN_DEEPSEEK_BASE_URL",
    "LINGHUN_DEEPSEEK_MODEL",
    "LINGHUN_DEFAULT_MODEL",
    "LINGHUN_INFERENCE_LEVEL",
    "LINGHUN_AUX_MODEL",
    "OPENAI_API_KEY",
    "DEEPSEEK_API_KEY",
    "ANTHROPIC_API_KEY",
  ];
  beforeEach(async () => {
    const home = await mkdtemp(join(tmpdir(), "linghun-phase06-home-"));
    await mkdir(join(home, ".linghun", "data"), { recursive: true });
    vi.stubEnv("LINGHUN_CONFIG_DIR", join(home, ".linghun"));
    // jobs/sessions/index default to the user DATA dir (getUserDataDir), which is
    // independent of LINGHUN_CONFIG_DIR. Without isolating it, the dev box's
    // persisted ~/.linghun/data/jobs leak into /job list and /background tests.
    vi.stubEnv("LINGHUN_DATA_DIR", join(home, ".linghun", "data"));
    for (const key of PHASE06_MODEL_ENV_KEYS) {
      vi.stubEnv(key, undefined as unknown as string);
    }
  });

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
    expect(output.text).toContain("项目 linghun-tui-project-");
    expect(output.text).toContain("模型 deepseek-chat");
    expect(output.text).toContain("模式 默认模式");
    expect(output.text).toContain("可以直接说“帮我检查项目状态 / 跑测试 / 解释这个报错”。");
    expect(output.text).toContain("需要精确命令时，用 /help 查看。");
    expect(output.text).not.toContain("Phase 14 TUI / REPL");
  });

  it("shows help, model, and session list", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    const defaultHelpOutput = new MemoryOutput();
    await handleSlashCommand("/help", context, defaultHelpOutput);
    await handleSlashCommand("/status", context, output);
    await handleSlashCommand("/help all", context, output);
    await handleSlashCommand("/model", context, output);
    await handleSlashCommand("/sessions", context, output);

    expect(defaultHelpOutput.text).toContain("帮助：优先直接描述你的目标。");
    expect(defaultHelpOutput.text).toContain("核心入口：");
    expect(defaultHelpOutput.text).not.toContain("/trust");
    expect(defaultHelpOutput.text).not.toContain("/permissions");
    expect(output.text).toContain("/sessions resume <id>");
    expect(output.text).toContain("/resume [id]");
    expect(output.text).toContain("/branch [目的]");
    expect(output.text).toContain("/memory storage");
    expect(output.text).toContain("/memory review");
    expect(output.text).toContain("/memory accept <id>");
    expect(output.text).toContain("可用命令：");
    expect(output.text).not.toContain("Core / 核心");
    expect(output.text).not.toContain("Index & MCP / 索引与 MCP");
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
    expect(output.text).toContain("模式 默认模式");
    expect(output.text).not.toContain("¥--");
    expect(output.text).toContain(session.id);
  });

  it("shows user-scoped missing model config hint without entering setup", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const home = await mkdtemp(join(tmpdir(), "linghun-home-"));
    vi.stubEnv("LINGHUN_CONFIG_DIR", join(home, ".linghun"));
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from(["/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(output.text).toContain("需要配置模型：这是本机一次配置，不是当前仓库配置。");
    expect(output.text).toContain("之后进入其他仓库也会默认复用同一个用户 provider.env");
    expect(output.text).toContain("用户 provider.env 位置：");
    expect(output.text).not.toContain("模型配置向导");
    expect(output.text).not.toContain("runtime");
    expect(output.text).not.toContain("schema");
    expect(output.text).not.toContain("provider contract");
  });

  it("prefers user-scoped setup-needed when project route uses openai-compatible without user provider.env", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-route-openai-"));
    const home = await mkdtemp(join(tmpdir(), "linghun-home-"));
    vi.stubEnv("LINGHUN_CONFIG_DIR", join(home, ".linghun"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      getProjectSettingsPath(project),
      JSON.stringify({
        modelRoutes: {
          defaultModel: "route-openai-model",
          routes: [
            {
              role: "executor",
              provider: "openai-compatible",
              primaryModel: "route-openai-model",
              fallbackModels: [],
              requiredCapabilities: ["text"],
              allowTools: true,
              allowWrite: true,
              allowBash: true,
              requireApprovalBeforeRun: false,
            },
          ],
        },
      }),
      "utf8",
    );
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from(["/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(output.text).toContain("需要配置模型：这是本机一次配置，不是当前仓库配置。");
    expect(output.text).toContain("之后进入其他仓库也会默认复用同一个用户 provider.env");
    expect(output.text).not.toContain("项目模型路由需要处理");
  });

  it("starts natural-language model setup when project route uses openai-compatible without user provider.env", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-route-openai-natural-"));
    const home = await mkdtemp(join(tmpdir(), "linghun-home-"));
    vi.stubEnv("LINGHUN_CONFIG_DIR", join(home, ".linghun"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      getProjectSettingsPath(project),
      JSON.stringify({
        modelRoutes: {
          defaultModel: "route-openai-model",
          routes: [
            {
              role: "executor",
              provider: "openai-compatible",
              primaryModel: "route-openai-model",
              fallbackModels: [],
              requiredCapabilities: ["text"],
              allowTools: true,
              allowWrite: true,
              allowBash: true,
              requireApprovalBeforeRun: false,
            },
          ],
        },
      }),
      "utf8",
    );
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from(["我要配置模型\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(output.text).toContain("模型配置向导");
    expect(output.text).toContain("缺少 API 地址");
    expect(output.text).not.toContain("项目模型路由需要处理");
  });

  it("reuses valid user provider.env in a new project without showing setup-needed", async () => {
    const firstProject = await mkdtemp(join(tmpdir(), "linghun-tui-project-a-"));
    const secondProject = await mkdtemp(join(tmpdir(), "linghun-tui-project-b-"));
    const home = await mkdtemp(join(tmpdir(), "linghun-home-"));
    vi.stubEnv("LINGHUN_CONFIG_DIR", join(home, ".linghun"));
    await saveProviderEnvSetup(
      {
        baseUrl: "https://provider.invalid/v1",
        apiKey: "sk-user-provider-secret",
        model: "user-provider-model",
        reasoningLevel: "Medium",
      },
      home,
    );
    const firstOutput = new MemoryOutput();
    const secondOutput = new MemoryOutput();

    await runTui({
      projectPath: firstProject,
      stdin: Readable.from(["/exit\n"]),
      stdout: firstOutput,
      stderr: new MemoryOutput(),
    });
    await runTui({
      projectPath: secondProject,
      stdin: Readable.from(["/exit\n"]),
      stdout: secondOutput,
      stderr: new MemoryOutput(),
    });

    expect(firstOutput.text).not.toContain("setup-needed");
    expect(firstOutput.text).not.toContain("需要配置模型：这是本机一次配置");
    expect(secondOutput.text).not.toContain("需要配置模型：这是本机一次配置");
    expect(secondOutput.text).toContain("项目 linghun-tui-project-b-");
    expect(secondOutput.text).toContain("[hint:info] 缺少 LINGHUN.md 项目规则");
    expect(secondOutput.text).not.toContain("sk-user-provider-secret");
  });

  it("starts model setup from natural-language setup intent and Enter on setup-needed", async () => {
    const naturalProject = await mkdtemp(join(tmpdir(), "linghun-tui-project-natural-"));
    const enterProject = await mkdtemp(join(tmpdir(), "linghun-tui-project-enter-"));
    const home = await mkdtemp(join(tmpdir(), "linghun-home-"));
    vi.stubEnv("LINGHUN_CONFIG_DIR", join(home, ".linghun"));
    const naturalOutput = new MemoryOutput();
    const enterOutput = new MemoryOutput();

    await runTui({
      projectPath: naturalProject,
      stdin: Readable.from(["我要配置模型\n"]),
      stdout: naturalOutput,
      stderr: new MemoryOutput(),
    });
    await runTui({
      projectPath: enterProject,
      stdin: Readable.from(["\n"]),
      stdout: enterOutput,
      stderr: new MemoryOutput(),
    });

    expect(naturalOutput.text).toContain("模型配置向导");
    expect(naturalOutput.text).toContain("这是本机一次配置");
    expect(naturalOutput.text).toContain("缺少 API 地址");
    expect(enterOutput.text).toContain("模型配置向导");
    expect(enterOutput.text).toContain("缺少 API 地址");
  });

  it("prefills direct setup values and saves only after confirmation without leaking key", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const home = await mkdtemp(join(tmpdir(), "linghun-home-"));
    vi.stubEnv("LINGHUN_CONFIG_DIR", join(home, ".linghun"));
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from([
        "我要配置模型 https://provider.invalid/v1 model=direct-setup-model reasoning High key=sk-direct-setup-secret\nyes\n/exit\n",
      ]),
      stdout: output,
      stderr: new MemoryOutput(),
    });
    const providerEnv = await readFile(getProviderEnvPath(home), "utf8");
    const projectSettings = await readFile(getProjectSettingsPath(project), "utf8").catch(() => "");

    expect(providerEnv).toContain("LINGHUN_OPENAI_BASE_URL=https://provider.invalid/v1");
    expect(providerEnv).toContain("LINGHUN_OPENAI_MODEL=direct-setup-model");
    expect(providerEnv).toContain("LINGHUN_INFERENCE_LEVEL=High");
    expect(output.text).toContain("模型配置摘要");
    expect(output.text).toContain("apiKey=present");
    expect(output.text).toContain("已保存，请重启 Linghun 后使用新的用户级 provider 配置。");
    expect(output.text).not.toContain("sk-direct-setup-secret");
    expect(projectSettings).not.toContain("apiKey");
    expect(projectSettings).not.toContain("sk-direct-setup-secret");
  });

  it("shows project route problems without asking users to re-enter a key", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const home = await mkdtemp(join(tmpdir(), "linghun-home-"));
    vi.stubEnv("LINGHUN_CONFIG_DIR", join(home, ".linghun"));
    await saveProviderEnvSetup(
      {
        baseUrl: "https://provider.invalid/v1",
        apiKey: "sk-valid-user-provider-secret",
        model: "valid-user-provider-model",
        reasoningLevel: "Medium",
      },
      home,
    );
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      getProjectSettingsPath(project),
      JSON.stringify({
        modelRoutes: {
          defaultModel: "missing-route-model",
          routes: [
            {
              role: "executor",
              provider: "missing-provider",
              primaryModel: "missing-route-model",
              fallbackModels: [],
              requiredCapabilities: ["text"],
              allowTools: true,
              allowWrite: true,
              allowBash: true,
              requireApprovalBeforeRun: false,
            },
          ],
        },
      }),
      "utf8",
    );
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from(["/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(output.text).toContain("项目模型路由需要处理");
    expect(output.text).toContain("不是让你重复填写本机用户 API key");
    expect(output.text).not.toContain("需要配置模型：这是本机一次配置");
    expect(output.text).not.toContain("sk-valid-user-provider-secret");
  });

  it("runs /model setup without writing API key to project settings or output", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const home = await mkdtemp(join(tmpdir(), "linghun-home-"));
    vi.stubEnv("LINGHUN_CONFIG_DIR", join(home, ".linghun"));
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from([
        "/model setup\nhttps://provider.invalid/v1\nsk-test-setup-secret\nsetup-model\n\n\nyes\n/exit\n",
      ]),
      stdout: output,
      stderr: new MemoryOutput(),
    });
    const providerEnv = await readFile(getProviderEnvPath(home), "utf8");
    const config = await loadConfig(project);

    expect(providerEnv).toContain("LINGHUN_OPENAI_BASE_URL=https://provider.invalid/v1");
    expect(providerEnv).toContain("LINGHUN_OPENAI_MODEL=setup-model");
    expect(providerEnv).toContain("LINGHUN_INFERENCE_LEVEL=Medium");
    expect(config.providers["openai-compatible"]?.model).toBe("setup-model");
    expect(config.modelRoutes.routes.find((route) => route.role === "executor")?.provider).toBe(
      "openai-compatible",
    );
    expect(output.text).toContain("模型配置摘要");
    expect(output.text).toContain("apiKey=present");
    expect(output.text).toContain("已保存，请重启 Linghun 后使用新的用户级 provider 配置。");
    expect(output.text).toContain("之后进入其他仓库会默认复用");
    expect(output.text).not.toContain("sk-test-setup-secret");
  });

  it("shows provider.env as model doctor API key source without leaking key", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const home = await mkdtemp(join(tmpdir(), "linghun-home-"));
    vi.stubEnv("LINGHUN_CONFIG_DIR", join(home, ".linghun"));
    await mkdir(join(home, ".linghun"), { recursive: true });
    await writeFile(
      getProviderEnvPath(home),
      [
        "LINGHUN_OPENAI_BASE_URL=https://provider.invalid/v1",
        "LINGHUN_OPENAI_API_KEY=sk-provider-env-secret",
        "LINGHUN_OPENAI_MODEL=provider-env-model",
        "LINGHUN_INFERENCE_LEVEL=Low",
        "",
      ].join("\n"),
      "utf8",
    );
    const config = await loadConfig(project);
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: config.defaultModel });
    const context = await createTestContext(project, store, session, config);
    const output = new MemoryOutput();

    await handleSlashCommand("/model doctor", context, output);

    expect(output.text).toContain("source=user-provider-env");
    expect(output.text).toContain("reasoning=ignored/unsupported");
    expect(output.text).toContain("apiKey=present");
    expect(output.text).not.toContain("sk-provider-env-secret");
  });

  it("shows Polish A slash discovery and unknown command suggestions", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleSlashCommand("/", context, output);
    await handleSlashCommand("/?", context, output);
    await handleSlashCommand("/mo", context, output);
    await handleSlashCommand("/modex", context, output);

    expect(output.text).toContain("优先直接描述你的目标。");
    expect(output.text).toContain("核心 slash 入口：");
    expect(output.text).not.toContain("Core / 核心");
    expect(output.text).not.toContain("/trust");
    expect(output.text).toContain("/mo 的候选命令：");
    expect(output.text).toContain("/model");
    expect(output.text).toContain("/mode");
    expect(output.text).toContain("未知命令：/modex");
    expect(output.text).toMatch(/你是不是想用 .*\/model|你是不是想用 .*\/mode/u);

    const englishOutput = new MemoryOutput();
    context.language = "en-US";
    await handleSlashCommand("/", context, englishOutput);

    expect(englishOutput.text).toContain("Describe your goal directly first.");
    expect(englishOutput.text).toContain("Core slash entries:");
    expect(englishOutput.text).toContain("/doctor");
    expect(englishOutput.text).not.toContain("- Index & MCP");
    expect(englishOutput.text).not.toContain("/trust");
  });

  it("keeps Polish A help around 80-column scanable rows", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleSlashCommand("/help", context, output);

    const longEngineeringRows = output.text
      .split(/\r?\n/u)
      .filter(
        (line) =>
          line.length > 90 && /provider|baseURL|apiKey|endpointProfile|reasoningStatus/u.test(line),
      );
    expect(longEngineeringRows).toEqual([]);
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

    const defaultDoctorOutput = new MemoryOutput();
    await handleSlashCommand("/doctor", context, defaultDoctorOutput);
    await handleSlashCommand("/status", context, output);
    await handleSlashCommand("/doctor all", context, output);
    await handleSlashCommand("/problems", context, output);

    expect(defaultDoctorOutput.text).toContain("诊断：BLOCK");
    expect(defaultDoctorOutput.text).toContain("详情：/doctor all");
    expect(defaultDoctorOutput.text).toContain("[BLOCKED] verification");
    expect(defaultDoctorOutput.text).toContain("[PARTIAL] background/tasks");
    expect(defaultDoctorOutput.text).not.toContain("Project Doctor Lite:");
    expect(output.text).toContain("Readiness：本地");
    expect(output.text).toContain("非 smoke/Beta PASS");
    expect(output.text).toContain("诊断详情（仅本地/静态轻量检查；不是真实 smoke）");
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
    expect(englishOutput.text).toContain("Doctor: BLOCK");
    expect(englishOutput.text).toContain("local checks only, not a smoke or Beta verdict");
  });

  it("keeps readiness PASS counts conservative for MCP and freshness evidence", () => {
    const baseView: TerminalReadinessView = {
      projectPath: "F:/Linghun",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      endpointProfile: "chat_completions",
      providerLiveVerified: false,
      permissionMode: "auto-review",
      language: "zh-CN",
      index: { status: "ready", changedFiles: 0 },
      cache: { latestHitRate: null, compacted: false, workspaceSnapshot: "ready" },
      memory: { projectRules: "found", candidates: 0, accepted: 0 },
      mcp: { enabled: true, servers: 1, tools: 0, errors: 0 },
      background: { total: 0, running: 0, blocked: 0 },
      verification: { status: "pass", summary: "local pass", unverified: 0, risk: 0 },
      freshness: { webSourceEvidence: "present" },
      projectDoctor: {
        status: "pass",
        packageManager: "pnpm@10.10.0",
        scripts: ["build", "test"],
        configFiles: [],
        ciFiles: [],
        projectRules: "found",
        checks: [],
        unknown: [],
      },
      sourceDrift: { status: "pass", checked: [], issues: [], nextAction: "no action" },
      contextPicker: { status: "pass", refs: [], evidenceKinds: [], indexFreshness: "fresh" },
      rollbackCoach: {
        status: "pass",
        changedFiles: 0,
        untrackedFiles: 0,
        checkpoints: 0,
        gitStatus: "clean",
        mode: "advisory-only",
        nextAction: "no action",
      },
      costPreview: { status: "pass", level: "light", labels: [], nextAction: "no action" },
      problems: [],
    };

    const items = createReadinessItems(baseView);

    expect(items.find((item) => item.id === "mcp")?.status).toBe("partial");
    expect(items.find((item) => item.id === "freshness")?.status).toBe("partial");
    expect(items.find((item) => item.id === "freshness")?.summary).toContain(
      "local presence is not source validation",
    );
    // D.14A-R-Fix P1-5 — baseView.providerLiveVerified=false → provider 不 pass
    const providerItem = items.find((item) => item.id === "provider");
    expect(providerItem?.status).toBe("partial");
    expect(providerItem?.summary).toContain("not live-verified");
  });

  // D.14A-R-Fix P1-5 — provider/model readiness 口径：
  //   - 无 live evidence（providerLiveVerified=false）→ 非 pass（partial / configured）
  //   - 有真实 provider live evidence（providerLiveVerified=true）→ pass
  //   - last failure → fail（即使 providerLiveVerified 为 true 也由 failure 接管）
  it("provider readiness 没有真实 live evidence 时不 pass", () => {
    const make = (overrides: Partial<TerminalReadinessView>): TerminalReadinessView => ({
      projectPath: "F:/Linghun",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      endpointProfile: "chat_completions",
      providerLiveVerified: false,
      permissionMode: "default",
      language: "zh-CN",
      index: { status: "ready", changedFiles: 0 },
      cache: { latestHitRate: null, compacted: false, workspaceSnapshot: "ready" },
      memory: { projectRules: "found", candidates: 0, accepted: 0 },
      mcp: { enabled: false, servers: 0, tools: 0, errors: 0 },
      background: { total: 0, running: 0, blocked: 0 },
      freshness: { webSourceEvidence: "missing" },
      projectDoctor: {
        status: "pass",
        packageManager: "pnpm",
        scripts: [],
        configFiles: [],
        ciFiles: [],
        projectRules: "found",
        checks: [],
        unknown: [],
      },
      sourceDrift: { status: "pass", checked: [], issues: [], nextAction: "none" },
      contextPicker: { status: "pass", refs: [], evidenceKinds: [], indexFreshness: "fresh" },
      rollbackCoach: {
        status: "pass",
        changedFiles: 0,
        untrackedFiles: 0,
        checkpoints: 0,
        gitStatus: "clean",
        mode: "advisory-only",
        nextAction: "none",
      },
      costPreview: { status: "pass", level: "light", labels: [], nextAction: "none" },
      problems: [],
      ...overrides,
    });

    const notVerified = createReadinessItems(make({ providerLiveVerified: false })).find(
      (item) => item.id === "provider",
    );
    expect(notVerified?.status).toBe("partial");
    expect(notVerified?.summary).toContain("not live-verified");

    const liveVerified = createReadinessItems(make({ providerLiveVerified: true })).find(
      (item) => item.id === "provider",
    );
    expect(liveVerified?.status).toBe("pass");
    expect(liveVerified?.summary).toContain("live-verified");

    const failed = createReadinessItems(
      make({
        providerLiveVerified: true,
        providerFailure: {
          code: "PROVIDER_BAD_REQUEST",
          provider: "deepseek",
          model: "deepseek-v4-flash",
          endpointProfile: "chat_completions",
          summary: "boom",
        },
      }),
    ).find((item) => item.id === "provider");
    expect(failed?.status).toBe("fail");

    const unknownProvider = createReadinessItems(
      make({ provider: "unknown", providerLiveVerified: false }),
    ).find((item) => item.id === "provider");
    expect(unknownProvider?.status).toBe("unknown");
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
    expect(output.text).toContain("Task Cost Preview Lite: [PARTIAL]");
    expect(output.text).toContain("local-only");
    expect(output.text).toContain("advisory-estimate");
    expect(output.text).toContain("Problems Lite：当前 3 个问题");
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
    // D.13R: 文案明确为"会话分支（session branch，不是 git 分支）"，避免与 git branch 混淆。
    expect(output.text).toContain("已创建会话分支");
    expect(output.text).toContain("session branch");
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
    expect(output.text).toContain("summary=长期稳定项目规则");
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
    expect(output.text).toContain("review queue: candidates=0; accepted=1");
    expect(output.text).toContain("项目长期规则只保存稳定工程事实");
    expect(output.text).toContain("memoryHash");
    expect(output.text).toMatch(/changedKeys: .*memoryHash/);
  });

  it("controls Phase 16 memory lifecycle, injection, and stats", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleSlashCommand(
      "/memory candidate 项目约定：只把经确认的长期规则注入 prompt --scope project",
      context,
      output,
    );
    const acceptedId = context.memory.candidates[0]?.id;
    expect(acceptedId).toBeTruthy();
    await handleSlashCommand(`/memory accept ${acceptedId}`, context, output);
    await handleSlashCommand("/memory", context, output);
    await handleSlashCommand("/memory review", context, output);
    await handleSlashCommand("/memory stats", context, output);

    const prompt = createModelSystemPrompt("帮我继续", context, {
      memory: { candidates: 0, accepted: 1 },
    });
    expect(prompt).toContain("ControlledMemorySummary=");
    expect(prompt).toContain("项目约定：只把经确认的长期规则注入 prompt");
    expect(prompt).toContain("MemoryBoundary=acceptedOnly");
    expect(output.text).toContain("autoLearning: off; autoAccept=no");
    expect(output.text).toContain("accept=写入长期且可被 topK 注入；reject=丢弃候选");
    expect(output.text).toContain("自动学习：关闭；autoAccept=no；切换：/memory learn on|off");
    expect(output.text).toContain(
      "session-scope：已接受=0；仅当前 TuiContext / 当前会话生效，不跨新会话持久化",
    );
    expect(output.text).toContain(
      "project/user persistent scope：已接受=1（project=1；user=0）；仅 accepted-only topK 注入 prompt",
    );
    expect(output.text).toContain(
      "candidate：project=0；user=0；session=0；候选不会自动接受或注入",
    );
    expect(output.text).toContain("prompt 注入：acceptedOnly topK=3；injected=1");
    expect(output.text).toContain("完整候选、聊天、日志和索引 dump 不注入 prompt");

    await handleSlashCommand(`/memory disable ${acceptedId}`, context, output);
    const disabledPrompt = createModelSystemPrompt("帮我继续", context, {
      memory: { candidates: 0, accepted: 0 },
    });
    expect(disabledPrompt).not.toContain("项目约定：只把经确认的长期规则注入 prompt");
    expect(context.memory.disabled).toHaveLength(1);

    await handleSlashCommand(`/memory rollback ${acceptedId}`, context, output);
    expect(context.memory.accepted).toHaveLength(1);
    await handleSlashCommand(`/memory delete ${acceptedId}`, context, output);
    expect(context.memory.accepted).toHaveLength(0);
    await expect(
      readFile(join(project, ".linghun", "memory", `${acceptedId}.json`), "utf8"),
    ).rejects.toThrow();

    await handleSlashCommand(
      "/memory candidate 临时错误尝试不应长期保存 --scope session",
      context,
      output,
    );
    const rejectedId = context.memory.candidates[0]?.id;
    await handleSlashCommand(`/memory reject ${rejectedId}`, context, output);
    expect(context.memory.rejected).toHaveLength(1);
    expect(output.text).toContain("已拒绝候选记忆");

    await handleSlashCommand(
      "/memory candidate 仅当前会话可见的临时偏好 --scope session",
      context,
      output,
    );
    const sessionMemoryId = context.memory.candidates[0]?.id;
    expect(sessionMemoryId).toBeTruthy();
    await handleSlashCommand(`/memory accept ${sessionMemoryId}`, context, output);
    const sessionPrompt = createModelSystemPrompt("继续当前任务", context, {
      memory: { candidates: 0, accepted: 1 },
    });
    expect(sessionPrompt).toContain("仅当前会话可见的临时偏好");
    await handleSlashCommand("/memory stats", context, output);
    expect(output.text).toContain(
      "session-scope：已接受=1；仅当前 TuiContext / 当前会话生效，不跨新会话持久化",
    );

    const nextSession = await store.create({ model: "deepseek-v4-flash" });
    const nextContext = await createTestContext(project, store, nextSession);
    nextContext.memory = await createMemoryState(defaultConfig, project);
    const nextPrompt = createModelSystemPrompt("继续新会话", nextContext, {
      memory: { candidates: 0, accepted: 0 },
    });
    expect(nextPrompt).not.toContain("仅当前会话可见的临时偏好");
  });

  it("creates Phase 16 memory learn candidates from bounded evidence without model calls", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    context.evidence.push({
      id: "ev-phase-16",
      kind: "test_result",
      summary: "Phase 16 focused test passed",
      source: "vitest",
      supportsClaims: ["controlled-memory-learning"],
      createdAt: new Date().toISOString(),
    });

    await handleSlashCommand("/memory learn", context, output);

    expect(context.memory.candidates).toHaveLength(1);
    expect(context.memory.candidates[0]?.status).toBe("candidate");
    expect(context.memory.candidates[0]?.sourceRefs).toEqual(["ev-phase-16"]);
    expect(context.memory.lastLearningRun?.modelCalled).toBe(false);
    expect(output.text).toContain("Memory learn（受控 / 只生成候选）");
    expect(output.text).toContain("调用模型：no");
    expect(output.text).toContain("autoAccept=no");
  });

  it("D.14B: defaults to learning mode off and does not auto-generate candidates", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    expect(context.memory.learningMode).toBe("off");

    const result = await runAutoLearningOnTurnEnd(context, "用 vitest 跑测试");
    expect(result.candidatesCreated).toBe(0);
    expect(result.skippedReason).toBe("learning_mode=off");
    expect(context.memory.candidates).toHaveLength(0);
  });

  it("D.14B: /memory learn on enables auto-learning, /memory learn off disables it", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleSlashCommand("/memory learn on", context, output);
    expect(context.memory.learningMode).toBe("active");
    expect(output.text).toContain("自动学习已开启");

    await handleSlashCommand("/memory learn off", context, output);
    expect(context.memory.learningMode).toBe("off");
    expect(output.text).toContain("自动学习已关闭");
  });

  it("D.14B: auto-learning generates candidates from user input when active", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session);

    context.memory.learningMode = "active";
    const result = await runAutoLearningOnTurnEnd(context, "我习惯用 vitest 跑所有测试");
    expect(result.candidatesCreated).toBeGreaterThan(0);
    expect(context.memory.candidates.length).toBeGreaterThan(0);
    expect(context.memory.candidates[0]?.inferred).toBe(true);
    expect(context.memory.candidates[0]?.status).toBe("candidate");
  });

  it("D.14B: candidate not injected into context until accepted", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    context.memory.learningMode = "active";
    await runAutoLearningOnTurnEnd(context, "我偏好：用 pnpm 而不是 npm");
    expect(context.memory.candidates.length).toBeGreaterThan(0);

    const promptBefore = createModelSystemPrompt("继续", context, {
      memory: { candidates: context.memory.candidates.length, accepted: 0 },
    });
    expect(promptBefore).not.toContain("用 pnpm 而不是 npm");

    const candidateId = context.memory.candidates[0]?.id;
    await handleSlashCommand(`/memory accept ${candidateId}`, context, output);
    const promptAfter = createModelSystemPrompt("继续", context, {
      memory: { candidates: 0, accepted: 1 },
    });
    expect(promptAfter).toContain("pnpm");
  });

  it("D.14B: reject/forget removes candidate permanently", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    context.memory.learningMode = "active";
    await runAutoLearningOnTurnEnd(context, "我习惯：先看源码再给命令");
    const candidateId = context.memory.candidates[0]?.id;

    await handleSlashCommand(`/memory forget ${candidateId}`, context, output);
    expect(context.memory.candidates).toHaveLength(0);
    expect(output.text).toContain("已删除记忆记录");
  });

  it("D.14B: secret/key content is never learned", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session);

    context.memory.learningMode = "active";
    const result = await runAutoLearningOnTurnEnd(
      context,
      "我偏好用 sk-1234567890abcdefghijklmnopqrstuvwxyz 这个 key",
    );
    expect(result.candidatesCreated).toBe(0);
    expect(context.memory.candidates).toHaveLength(0);
  });

  it("D.14B: deduplicates high-frequency preferences", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session);

    context.memory.learningMode = "active";
    await runAutoLearningOnTurnEnd(context, "我习惯用 vitest 跑测试");
    const firstCount = context.memory.candidates.length;

    await runAutoLearningOnTurnEnd(context, "我习惯用 vitest 跑测试");
    expect(context.memory.candidates.length).toBe(firstCount);
  });

  it("D.14B: doctor/status shows learning mode dynamically", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleSlashCommand("/memory", context, output);
    expect(output.text).toContain("autoLearning: off");

    await handleSlashCommand("/memory learn on", context, output);
    await handleSlashCommand("/memory", context, output);
    expect(output.text).toContain("autoLearning: on");
  });

  it("D.14B: disabling learning stops new candidate generation", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    context.memory.learningMode = "active";
    await runAutoLearningOnTurnEnd(context, "我偏好：中文回答");
    const countBefore = context.memory.candidates.length;

    await handleSlashCommand("/memory learn off", context, output);
    await runAutoLearningOnTurnEnd(context, "我偏好：简短回答");
    expect(context.memory.candidates.length).toBe(countBefore);
  });

  it("D.14B: containsSecret correctly identifies sensitive content", () => {
    expect(containsSecret("sk-1234567890abcdefghijklmnopqrstuvwxyz")).toBe(true);
    expect(containsSecret("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn")).toBe(true);
    expect(containsSecret("AKIAIOSFODNN7EXAMPLE")).toBe(true);
    expect(containsSecret("-----BEGIN RSA PRIVATE KEY-----")).toBe(true);
    expect(containsSecret("我喜欢用 vitest")).toBe(false);
    expect(containsSecret("prefer pnpm over npm")).toBe(false);
  });

  it("D.14B: real input path does NOT generate candidate when learning is off", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    expect(context.memory.learningMode).toBe("off");
    const result = await handleNaturalInput("我习惯用 pnpm 而不是 npm", context, output);
    expect(result).toBe("message");
    expect(context.memory.candidates).toHaveLength(0);
  });

  it("D.14B: real input path generates candidate when learning is on", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    context.memory.learningMode = "active";
    const result = await handleNaturalInput("我习惯用 pnpm 而不是 npm", context, output);
    expect(result).toBe("message");
    expect(context.memory.candidates.length).toBeGreaterThan(0);
    expect(context.memory.candidates[0]?.inferred).toBe(true);
    expect(context.memory.candidates[0]?.status).toBe("candidate");
  });

  it("D.14B: slash/control commands do NOT trigger auto-learning", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    context.memory.learningMode = "active";
    await handleSlashCommand("/memory", context, output);
    await handleSlashCommand("/doctor", context, output);
    await handleSlashCommand("/help", context, output);
    await handleSlashCommand("/status", context, output);
    expect(context.memory.candidates).toHaveLength(0);
  });

  it("D.14B: secret/setup input does NOT trigger auto-learning via real path", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    context.memory.learningMode = "active";
    // Input containing a secret — whether it reaches model path or gets intercepted,
    // no candidate should be generated
    await handleNaturalInput(
      "我偏好用 sk-abcdefghijklmnopqrstuvwxyz1234567890 这个 key",
      context,
      output,
    );
    expect(context.memory.candidates).toHaveLength(0);
  });

  it("D.14B: real-path candidate still not injected into context until accepted", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    context.memory.learningMode = "active";
    await handleNaturalInput("我偏好：用 vitest 而不是 jest", context, output);
    expect(context.memory.candidates.length).toBeGreaterThan(0);

    const promptBefore = createModelSystemPrompt("继续", context, {
      memory: { candidates: context.memory.candidates.length, accepted: 0 },
    });
    expect(promptBefore).not.toContain("vitest 而不是 jest");

    const candidateId = context.memory.candidates[0]?.id;
    await handleSlashCommand(`/memory accept ${candidateId}`, context, output);
    const promptAfter = createModelSystemPrompt("继续", context, {
      memory: { candidates: 0, accepted: 1 },
    });
    expect(promptAfter).toContain("vitest");
  });

  it("keeps Phase 16 skill evolution as candidate-only metadata", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleSlashCommand(
      "/skills evolve 重复的 bug 修复流程可沉淀为本地 skill",
      context,
      output,
    );
    expect(output.text).toContain("用法：/skills evolve");
    expect(context.skills.evolutionCandidates).toHaveLength(0);

    await handleSlashCommand(
      "/skills evolve candidate 重复的 bug 修复流程可沉淀为本地 skill",
      context,
      output,
    );
    const candidateId = context.skills.evolutionCandidates[0]?.id;
    expect(candidateId).toBeTruthy();
    expect(output.text).toContain("不会自动写文件、安装、信任或启用");
    expect(context.skills.skills).toHaveLength(0);

    await handleSlashCommand("/skills evolve", context, output);
    expect(output.text).toContain("Skill evolution candidates");
    expect(output.text).toContain("autoEnable=no");

    await handleSlashCommand(`/skills evolve reject ${candidateId}`, context, output);
    expect(context.skills.evolutionCandidates).toHaveLength(0);
    expect(context.skills.rejectedEvolutionCandidates).toHaveLength(1);
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

  // ---------------------------------------------------------------------------
  // D.13U — /claim-check shares evaluator with auto Final Answer Gate
  // ---------------------------------------------------------------------------

  it("D.13U: /claim-check rejects '已完成 测试通过 PASS' even when Read evidence is present", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "gpt-4.1" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);
    // 注入仅 Read 类型 evidence —— 旧逻辑会因 evidence.length>0 直接放行；
    // D.13U 必须仍然拦截"PASS / 已完成 / 测试通过"类高风险声明。
    context.evidence.push({
      id: "evid-read-1",
      kind: "file_read",
      summary: "Read: src/index.ts",
      source: "Read",
      supportsClaims: ["Read", "local_read", "file:src/index.ts"],
      createdAt: new Date().toISOString(),
    });

    await handleSlashCommand("/claim-check 已完成，测试通过，PASS。", context, output);

    expect(output.text).toContain("缺少证据");
    expect(output.text).not.toContain("Claim Checker：通过");
  });

  it("D.13U: /claim-check passes 'tests passed' when test_passed evidence exists", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "gpt-4.1" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);
    context.evidence.push({
      id: "evid-test-1",
      kind: "command_output",
      summary: "Bash: vitest run all green",
      source: "Bash",
      supportsClaims: ["Bash", "command_ran", "bash_exit_0", "test_passed"],
      createdAt: new Date().toISOString(),
    });

    await handleSlashCommand("/claim-check 测试通过", context, output);

    expect(output.text).toContain("Claim Checker：通过");
    expect(output.text).not.toContain("缺少证据");
  });

  it("D.13U: ordinary slash output stays free of internal validator names", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "gpt-4.1" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleSlashCommand("/claim-check 已完成", context, output);

    expect(output.text).not.toContain("FinalAnswerClaimGate");
    expect(output.text).not.toContain("EvidenceSummary");
    expect(output.text).not.toContain("SearchExtraTools");
    expect(output.text).not.toContain("ExecuteExtraTool");
    expect(output.text).not.toContain("evidence_id=");
  });

  it("D.13U: '当前分支' query is not a high-risk external_current_fact", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "gpt-4.1" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    // 没有任何 evidence，但 claim 只是描述本地 git 状态 —— 不应该被 /claim-check 拦截。
    await handleSlashCommand("/claim-check 当前分支是 master", context, output);

    expect(output.text).toContain("Claim Checker：通过");
    expect(output.text).not.toContain("缺少证据");
  });

  it("D.13U: source has no FreshnessLite gate restored and has Final Answer Gate wired", async () => {
    const fs = await import("node:fs/promises");
    const indexSrc = await fs.readFile("src/index.ts", "utf8");
    expect(indexSrc).not.toMatch(/needsFreshnessLiteBoundary\s*\(/);
    expect(indexSrc).not.toMatch(/formatFreshnessLitePrimaryWarning\s*\(/);
    expect(indexSrc).toContain("evaluateFinalAnswerClaims(assistantText, context.evidence)");
    expect(indexSrc).toContain("createFinalAnswerClaimReminder(verdict, context.language)");
    expect(indexSrc).not.toMatch(/"FinalAnswerClaimGate"/);
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

  it("D.14D: sanitizes internal prompt-token echoes from the committed answer (ink main-screen source of truth)", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        defaultModel: "leak-model",
        providers: {
          "openai-compatible": {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "leak-model",
          },
        },
      }),
      "utf8",
    );
    // 模拟模型把内部 system-prompt 字段原样复述（用户说"翻译成人话"时常见的泄漏形态）。
    const leaky = [
      "好的，翻译成人话：",
      'RuntimeStatusForModel={"memory":{"linghunMd":"missing"},"index":{"status":"ready"}}',
      "ControlledMemorySummary=accepted:0 candidates:0",
      "MemoryBoundary=acceptedOnly; topK=3; doNotWriteLongTermMemoryWithoutExplicitMemoryAccept",
      "EvidenceSummary=[]",
      "你的环境基本正常。",
    ].join("\n");
    mockOpenAiTextFetch(leaky);
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from(["翻译成人话\n/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    // 真实 ink 主屏从已提交的 assistant_text_delta 事件（block fullText 的同源）
    // 渲染。该提交文本必须已脱去内部 token。注：plain-mode 的 output.write 流式
    // 字节在到达时即写出，无法事后撤回，因此断言落在 mode-independent 的提交文本上。
    const session = (
      await new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project }).list()
    ).at(0);
    expect(session?.id).toBeTruthy();
    const resumed = await new SessionStore({
      sessionRootDir: getSessionRootDir(),
      projectPath: project,
    }).resume(session?.id ?? "missing");
    const finalAnswer = [...resumed.transcript]
      .reverse()
      .find((e) => e.type === "assistant_text_delta") as { text: string } | undefined;
    expect(finalAnswer).toBeDefined();
    const committed = finalAnswer?.text ?? "";
    expect(committed).not.toContain("RuntimeStatusForModel");
    expect(committed).not.toContain("ControlledMemorySummary");
    expect(committed).not.toContain("MemoryBoundary");
    expect(committed).not.toContain("EvidenceSummary");
    expect(committed).not.toContain("doNotWriteLongTermMemoryWithoutExplicitMemoryAccept");
    expect(committed).not.toContain('"linghunMd"');
    // 人话正文仍保留。
    expect(committed).toContain("你的环境基本正常");
  });

  it("includes engineering structure constraints in zh-CN system prompt", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session);

    const prompt = createModelSystemPrompt("帮我写代码", context, {
      model: { provider: "deepseek", name: "deepseek-v4-flash" },
    });

    expect(prompt).toContain("EngineeringStructure=");
    expect(prompt).toContain("god file");
    expect(prompt).toContain("code blob");
    expect(prompt).toContain("超长函数");
    expect(prompt).toContain("不是授权大重构");
  });

  it("includes engineering structure constraints in en-US system prompt", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session);
    context.language = "en-US";
    context.config = { ...context.config, language: "en-US" };

    const prompt = createModelSystemPrompt("help me write code", context, {
      model: { provider: "deepseek", name: "deepseek-v4-flash" },
    });

    expect(prompt).toContain("EngineeringStructure=");
    expect(prompt).toContain("god files");
    expect(prompt).toContain("code blobs");
    expect(prompt).toContain("deep nesting");
    expect(prompt).toContain("not authorization for large refactors");
  });

  it("includes architectureDirective in system prompt when provided", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session);

    const directive = "ArchitectureRuntime=triggered\nAntiCodeBlob=test";
    const prompt = createModelSystemPrompt(
      "实现跨模块功能",
      context,
      {
        model: { provider: "deepseek", name: "deepseek-v4-flash" },
      },
      directive,
    );

    expect(prompt).toContain("ArchitectureRuntime=triggered");
    expect(prompt).toContain("AntiCodeBlob=test");
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
    const inspectAgent = context.agents[0];
    await handleSlashCommand("/fork planner plan agent loop", context, output);
    await handleSlashCommand("/fork verifier verify agent loop", context, output);
    await handleSlashCommand("/agents", context, output);
    await handleSlashCommand(`/agents show ${inspectAgent?.id}`, context, output);
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
    expect(output.text).toContain("session-scoped conservative verification");
    expect(output.text).toContain("不是 durable job、不是第二套 job system、不是 Phase 17");
    expect(output.text).toContain("Agents：");
    expect(output.text).toContain("inspect-cache-explorer");
    expect(output.text).toContain("displayName: inspect-cache-explorer");
    expect(output.text).toContain(
      "displayName does not change type, role route, permission mode, resource guard, evidence, or lifecycle",
    );
    expect(inspectAgent?.displayName).toBe("inspect-cache-explorer");
    expect(inspectAgent?.role).toBe("executor");
    expect(inspectAgent?.permissionMode).toBe("plan");
    expect(output.text).toContain("transcript:");
    expect(output.text).toContain("已降级为同步执行");
    expect(output.text).toContain("- full output: /details evidence <id>");
    expect(output.text).toContain("Background agent-");
    expect(output.text).toContain("Evidence evidence-test-1");
    expect(context.agents.filter((agent) => agent.status === "running")).toHaveLength(0);
    expect(context.agents.length).toBe(4);
    expect(context.backgroundTasks.filter((task) => task.kind === "agent")).not.toContainEqual(
      expect.objectContaining({ result: "pass" }),
    );
    expect(parentTranscript.some((event) => event.type === "agent_start")).toBe(true);
    expect(parentTranscript.some((event) => event.type === "agent_end")).toBe(true);
    expect(agentTranscript.some((event) => event.type === "system_event")).toBe(true);
  });

  it("keeps Polish D agent display names cosmetic, ASCII-safe, and bounded", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-polish-d-agent-label-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleSlashCommand(
      "/fork verifier repair extremely long windows path diagnostics and terminal wrapping without changing permissions",
      context,
      output,
    );
    const verifierAgent = context.agents[0];
    await handleSlashCommand("/fork explorer 修复中文路径显示", context, output);
    const explorerAgent = context.agents[0];
    await handleSlashCommand("/agents", context, output);
    await handleSlashCommand(`/agents show ${explorerAgent?.id}`, context, output);

    expect(verifierAgent?.displayName).toBe("repair-extremely-long-verifier");
    expect(explorerAgent?.displayName).toMatch(/^task-[0-9a-f]{6}-explorer$/u);
    expect(verifierAgent?.role).toBe("verifier");
    expect(explorerAgent?.role).toBe("executor");
    expect(verifierAgent?.permissionMode).toBe("default");
    expect(explorerAgent?.permissionMode).toBe("plan");
    expect(output.text).toContain("repair-extremely-long-verifier");
    expect(output.text).toContain(`displayName: ${explorerAgent?.displayName}`);
    expect(output.text).toContain(
      "displayName does not change type, role route, permission mode, resource guard, evidence, or lifecycle",
    );
    expect(output.text).not.toContain("修复中文路径显示-explorer");
    const keyLines = output.text
      .split("\n")
      .filter(
        (line) => line.includes("repair-extremely-long-verifier") || line.includes("displayName"),
      );
    expect(keyLines.every((line) => line.length <= 160)).toBe(true);
  });

  it("runs Phase 17A durable job loop with persisted state, background reuse, and bounded agents", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const config: LinghunConfig = {
      ...defaultConfig,
      storage: { ...defaultConfig.storage, jobs: { scope: "project" } },
    };
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session, config);
    context.index.status = "ready";
    context.index.projectName = "F-Linghun";
    context.lastVerification = createVerificationReportFixture("partial");
    context.evidence.push({
      id: "ev-phase-17a",
      kind: "test_result",
      summary: "Phase 17A focused evidence",
      source: "vitest",
      supportsClaims: ["phase-17a-focused"],
      createdAt: new Date().toISOString(),
    });

    await handleSlashCommand(
      "/job run implement durable loop --multi-agent --agents 5 --allow-bash --allow-edit --tokens 50000 --timeout 60000",
      context,
      output,
    );
    await handleSlashCommand("/job list", context, output);
    const jobId = context.backgroundTasks.find((task) => task.kind === "job")?.id;
    expect(jobId).toBeTruthy();
    await handleSlashCommand(`/job status ${jobId}`, context, output);
    await handleSlashCommand(`/job report ${jobId}`, context, output);
    await handleSlashCommand(`/job logs ${jobId}`, context, output);
    await handleSlashCommand(`/details background ${jobId}`, context, output);

    const statePath = join(
      resolveStoragePaths(config, project).jobs,
      jobId ?? "missing",
      "state.json",
    );
    const persisted = JSON.parse(await readFile(statePath, "utf8")) as {
      status?: string;
      agents?: { displayName?: string; status?: string; summary?: string }[];
      budget?: {
        maxRunningAgents?: number;
        maxSteps?: number;
        note?: string;
        usedSteps?: number;
        usedTokens?: number;
      };
      worker?: { status?: string; completedSteps?: number };
      result?: { status?: string };
      logPath?: string;
      fullOutputPath?: string;
      reportPath?: string;
    };
    expect(persisted.status).toBe("completed");
    expect(persisted.worker?.status).toBe("completed");
    expect(persisted.worker?.completedSteps).toBe(4);
    expect(persisted.result?.status).toBe("partial");
    expect(persisted.budget?.usedSteps).toBe(4);
    expect(persisted.budget?.maxSteps).toBe(4);
    expect(persisted.budget?.usedTokens).toBeGreaterThan(0);
    expect(persisted.agents).toHaveLength(5);
    expect(persisted.agents?.[0]?.displayName).toBe("implement-durable-loop-planner");
    expect(persisted.agents?.[1]?.displayName).toBe("implement-durable-loop-worker");
    expect(persisted.agents?.filter((agent) => agent.status === "running")).toHaveLength(0);
    expect(persisted.agents?.filter((agent) => agent.status === "completed")).toHaveLength(5);
    expect(persisted.budget?.maxRunningAgents).toBe(3);
    expect(persisted.budget?.note).toContain("8 is benchmark/high-config candidate only");
    expect(persisted.agents?.[0]?.summary).toContain("no full transcript/source/index/log output");
    const report = await readFile(persisted.reportPath ?? "", "utf8");
    expect(report).toContain("Node/TUI runtime remains default");
    expect(report).toContain(
      "Phase 17A bounded worker loop completed local read-only task graph steps",
    );
    expect(report).toContain("no full transcript/source/index/log output is injected");
    expect(report).toContain("## Worker result");
    expect(report).toContain("maxSteps=4; usedSteps=4");
    expect(report).toContain("verification remains partial");
    const log = await readFile(persisted.logPath ?? "", "utf8");
    expect(log).toContain("worker step 4/4");
    expect(log).toContain("worker loop completed without verification PASS");
    const fullOutput = await readFile(persisted.fullOutputPath ?? "", "utf8");
    expect(fullOutput).toContain("worker step 4/4");
    expect(fullOutput).not.toContain("full transcript");
    expect(fullOutput).not.toContain("full source");

    expect(context.backgroundTasks).toContainEqual(
      expect.objectContaining({ id: jobId, kind: "job", status: "completed", result: "partial" }),
    );
    expect(context.backgroundTasks.filter((task) => task.kind === "job")).not.toContainEqual(
      expect.objectContaining({ result: "pass" }),
    );
    expect(output.text).toContain("本地 durable metadata + 统一后台任务");
    expect(output.text).toContain(
      "agents: created=5, running=0, cap=3; displayName is cosmetic only.",
    );
    expect(output.text).toContain(`${jobId}  completed  label=implement-durable-loop-planner`);
    expect(output.text).not.toContain(`${jobId}  running`);
    expect(output.text).toContain(
      "completed/cancelled/timeout/stale/blocked never equals verification PASS",
    );
    expect(output.text).toContain(
      "agent assignment: job-agent-1:implement-durable-loop-planner:completed",
    );
    expect(output.text).toContain("worker=completed");
    expect(output.text).toContain("task graph: 4 steps");
    expect(output.text).toContain("fullOutputPath:");
    expect(output.text).not.toContain("Beta readiness PASS");
  });

  it("recovers Phase 17A durable jobs into background and marks missing owner heartbeat stale", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const config: LinghunConfig = {
      ...defaultConfig,
      storage: { ...defaultConfig.storage, jobs: { scope: "project" } },
    };
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session, config);
    context.index.status = "ready";
    context.index.projectName = "F-Linghun";
    context.lastVerification = createVerificationReportFixture("partial");
    context.evidence.push({
      id: "ev-recovery",
      kind: "test_result",
      summary: "recovery evidence",
      source: "vitest",
      supportsClaims: ["phase-17a-recovery"],
      createdAt: new Date().toISOString(),
    });

    await handleSlashCommand(
      "/job run recover durable job --multi-agent --agents 4",
      context,
      output,
    );
    const jobId = context.backgroundTasks.find((task) => task.kind === "job")?.id;
    const statePath = join(
      resolveStoragePaths(config, project).jobs,
      jobId ?? "missing",
      "state.json",
    );
    const persisted = JSON.parse(await readFile(statePath, "utf8")) as Record<string, unknown>;
    persisted.status = "running";
    persisted.ownerSessionId = undefined;
    persisted.ownerPid = undefined;
    persisted.heartbeatAt = undefined;
    await writeFile(statePath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");

    const freshStore = new SessionStore({
      sessionRootDir: getSessionRootDir(),
      projectPath: project,
    });
    const freshSession = await freshStore.create({ model: "deepseek-v4-flash" });
    const freshContext = await createTestContext(project, freshStore, freshSession, config);
    const freshOutput = new MemoryOutput();

    await handleSlashCommand("/background", freshContext, freshOutput);

    const recovered = JSON.parse(await readFile(statePath, "utf8")) as {
      status?: string;
      pauseReason?: string;
      result?: { status?: string };
    };
    expect(recovered.status).toBe("stale");
    expect(recovered.pauseReason).toBe("recovered_without_owner_or_heartbeat");
    expect(recovered.result?.status).toBe("stale");
    expect(freshContext.backgroundTasks).toContainEqual(
      expect.objectContaining({ id: jobId, kind: "job", status: "stale" }),
    );
    expect(freshContext.backgroundTasks).not.toContainEqual(
      expect.objectContaining({ result: "pass" }),
    );
    expect(freshOutput.text).toContain("stale");
  });

  it("keeps Phase 17A cross-session resource guard and budget stops conservative", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const config: LinghunConfig = {
      ...defaultConfig,
      storage: { ...defaultConfig.storage, jobs: { scope: "project" } },
    };
    const store = new SessionStore({
      sessionRootDir: getSessionRootDir(),
      projectPath: project,
    });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session, config);
    context.index.status = "ready";
    context.index.projectName = "F-Linghun";
    context.lastVerification = createVerificationReportFixture("partial");
    context.evidence.push({
      id: "ev-budget",
      kind: "test_result",
      summary: "budget evidence",
      source: "vitest",
      supportsClaims: ["phase-17a-budget"],
      createdAt: new Date().toISOString(),
    });
    const output = new MemoryOutput();

    await handleSlashCommand(
      "/job run active durable guard --multi-agent --agents 5",
      context,
      output,
    );
    const firstJobId = context.backgroundTasks.find((task) => task.kind === "job")?.id;
    const freshStore = new SessionStore({
      sessionRootDir: getSessionRootDir(),
      projectPath: project,
    });
    const freshSession = await freshStore.create({ model: "deepseek-v4-flash" });
    const freshContext = await createTestContext(project, freshStore, freshSession, config);
    freshContext.index.status = "ready";
    freshContext.index.projectName = "F-Linghun";
    freshContext.lastVerification = createVerificationReportFixture("partial");
    freshContext.evidence = [...context.evidence];

    await handleSlashCommand(
      "/job run guarded second durable job --multi-agent --agents 5",
      freshContext,
      output,
    );
    const jobsRoot = resolveStoragePaths(config, project).jobs;
    const firstState = JSON.parse(
      await readFile(join(jobsRoot, firstJobId ?? "missing", "state.json"), "utf8"),
    ) as {
      status?: string;
    };
    const guardedJob = freshContext.backgroundTasks.find(
      (task) => task.kind === "job" && task.id !== firstJobId,
    );
    const guardedState = JSON.parse(
      await readFile(join(jobsRoot, guardedJob?.id ?? "missing", "state.json"), "utf8"),
    ) as {
      status?: string;
      pauseReason?: string;
      agents?: { status?: string }[];
    };
    expect(firstState.status).toBe("completed");
    expect(guardedState.status).toBe("completed");
    expect(guardedState.pauseReason ?? "").not.toContain("resource_guard");
    expect(guardedState.agents).toHaveLength(5);
    expect(guardedState.agents?.filter((agent) => agent.status === "running")).toHaveLength(0);
    expect(freshContext.backgroundTasks).not.toContainEqual(
      expect.objectContaining({ kind: "job", result: "pass" }),
    );

    const budgetProject = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const budgetStore = new SessionStore({
      sessionRootDir: getSessionRootDir(),
      projectPath: budgetProject,
    });
    const budgetSession = await budgetStore.create({ model: "deepseek-v4-flash" });
    const budgetContext = await createTestContext(
      budgetProject,
      budgetStore,
      budgetSession,
      config,
    );
    budgetContext.index.status = "ready";
    budgetContext.index.projectName = "F-Linghun";
    budgetContext.lastVerification = createVerificationReportFixture("partial");
    budgetContext.evidence = [...context.evidence];
    const budgetOutput = new MemoryOutput();
    await handleSlashCommand(
      "/job run overbudget durable worker --tokens 1",
      budgetContext,
      budgetOutput,
    );
    const budgetJobId = budgetContext.backgroundTasks.find((task) => task.kind === "job")?.id;
    const budgetJobsRoot = resolveStoragePaths(config, budgetProject).jobs;
    const budgetState = JSON.parse(
      await readFile(join(budgetJobsRoot, budgetJobId ?? "missing", "state.json"), "utf8"),
    ) as {
      status?: string;
      pauseReason?: string;
      result?: { status?: string; summary?: string };
    };
    expect(budgetState.status).toBe("blocked");
    expect(budgetState.pauseReason).toContain("budget_exceeded");
    expect(budgetState.result?.status).toBe("overbudget");
    expect(budgetState.result?.summary).toContain("no PASS evidence");
    expect(budgetContext.backgroundTasks).not.toContainEqual(
      expect.objectContaining({ result: "pass" }),
    );

    const maxStepProject = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const maxStepStore = new SessionStore({
      sessionRootDir: getSessionRootDir(),
      projectPath: maxStepProject,
    });
    const maxStepSession = await maxStepStore.create({ model: "deepseek-v4-flash" });
    const maxStepContext = await createTestContext(
      maxStepProject,
      maxStepStore,
      maxStepSession,
      config,
    );
    maxStepContext.index.status = "ready";
    maxStepContext.index.projectName = "F-Linghun";
    maxStepContext.lastVerification = createVerificationReportFixture("partial");
    maxStepContext.evidence = [...context.evidence];
    await handleSlashCommand(
      "/job run max step durable worker --max-steps 2 --tokens 50000",
      maxStepContext,
      new MemoryOutput(),
    );
    const maxStepJobId = maxStepContext.backgroundTasks.find((task) => task.kind === "job")?.id;
    const maxStepState = JSON.parse(
      await readFile(
        join(
          resolveStoragePaths(config, maxStepProject).jobs,
          maxStepJobId ?? "missing",
          "state.json",
        ),
        "utf8",
      ),
    ) as {
      status?: string;
      pauseReason?: string;
      budget?: { usedSteps?: number };
      result?: { status?: string; summary?: string };
    };
    expect(maxStepState.status).toBe("blocked");
    expect(maxStepState.pauseReason).toContain("max_steps_reached");
    expect(maxStepState.budget?.usedSteps).toBe(2);
    expect(maxStepState.result?.status).toBe("blocked");
    expect(maxStepState.result?.summary).toContain("no PASS evidence");
    expect(maxStepContext.backgroundTasks).not.toContainEqual(
      expect.objectContaining({ result: "pass" }),
    );

    const timeoutProject = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const timeoutStore = new SessionStore({
      sessionRootDir: getSessionRootDir(),
      projectPath: timeoutProject,
    });
    const timeoutSession = await timeoutStore.create({ model: "deepseek-v4-flash" });
    const timeoutContext = await createTestContext(
      timeoutProject,
      timeoutStore,
      timeoutSession,
      config,
    );
    timeoutContext.index.status = "ready";
    timeoutContext.index.projectName = "F-Linghun";
    timeoutContext.lastVerification = createVerificationReportFixture("partial");
    timeoutContext.evidence = [...context.evidence];
    await handleSlashCommand(
      "/job create timeout durable worker --max-runtime-ms 1 --tokens 50000",
      timeoutContext,
      new MemoryOutput(),
    );
    const timeoutJobId = timeoutContext.backgroundTasks.find((task) => task.kind === "job")?.id;
    const timeoutStatePath = join(
      resolveStoragePaths(config, timeoutProject).jobs,
      timeoutJobId ?? "missing",
      "state.json",
    );
    const timeoutSeed = JSON.parse(await readFile(timeoutStatePath, "utf8")) as Record<
      string,
      unknown
    >;
    timeoutSeed.startedAt = new Date(Date.now() - 60_000).toISOString();
    await writeFile(timeoutStatePath, `${JSON.stringify(timeoutSeed, null, 2)}\n`, "utf8");
    await handleSlashCommand(`/job resume ${timeoutJobId}`, timeoutContext, new MemoryOutput());
    const timeoutState = JSON.parse(await readFile(timeoutStatePath, "utf8")) as {
      status?: string;
      pauseReason?: string;
      result?: { status?: string; summary?: string };
    };
    expect(timeoutState.status).toBe("timeout");
    expect(timeoutState.pauseReason).toContain("timeout");
    expect(timeoutState.result?.status).toBe("timeout");
    expect(timeoutState.result?.summary).toContain("no PASS evidence");
    expect(timeoutContext.backgroundTasks).not.toContainEqual(
      expect.objectContaining({ result: "pass" }),
    );
  });

  it("blocks Phase 17A jobs when handoff is incomplete and never records PASS evidence", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const config: LinghunConfig = {
      ...defaultConfig,
      storage: { ...defaultConfig.storage, jobs: { scope: "project" } },
    };
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session, config);

    await handleSlashCommand(
      "/job run blocked missing handoff --multi-agent --agents 4",
      context,
      output,
    );
    const jobId = context.backgroundTasks.find((task) => task.kind === "job")?.id;
    await handleSlashCommand(`/job status ${jobId}`, context, output);
    await handleSlashCommand(`/job cancel ${jobId}`, context, output);

    const statePath = join(
      resolveStoragePaths(config, project).jobs,
      jobId ?? "missing",
      "state.json",
    );
    const persisted = JSON.parse(await readFile(statePath, "utf8")) as {
      status?: string;
      pauseReason?: string;
      agents?: { status?: string }[];
    };
    expect(output.text).toContain("needs_handoff_repair");
    expect(output.text).toContain(
      "completed/cancelled/timeout/stale/blocked never equals verification PASS",
    );
    expect(context.backgroundTasks).not.toContainEqual(expect.objectContaining({ result: "pass" }));
    expect(persisted.status).toBe("cancelled");
    expect(persisted.pauseReason).toBe("user_cancelled");
    expect(persisted.agents?.filter((agent) => agent.status === "running")).toHaveLength(0);
  });

  it("covers Phase 17C.B bundled native runner resolution and Node fallback boundaries", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-bundled-runner-"));
    const bundledRoot = join(project, "bundled root 空格");
    const platformArch = `${process.platform}-${process.arch}`;
    const bundledRunner = await createMockNativeRunner(project, {
      runnerDir: join(bundledRoot, platformArch),
      runnerName:
        process.platform === "win32" ? "linghun-native-runner.cjs" : "linghun-native-runner",
    });
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const config: LinghunConfig = {
      ...defaultConfig,
      storage: { ...defaultConfig.storage, jobs: { scope: "project" } },
      nativeRunner: {
        ...defaultConfig.nativeRunner,
        enabled: true,
        source: "bundled",
        timeoutMs: 60_000,
      },
    };
    const context = await createTestContext(project, store, session, config);
    context.index.status = "ready";
    context.index.projectName = "F-Linghun";
    context.lastVerification = createVerificationReportFixture("partial");
    context.evidence.push({
      id: "ev-phase-17cb",
      kind: "test_result",
      summary: "Phase 17C.B focused evidence",
      source: "vitest",
      supportsClaims: ["phase-17cb-focused"],
      createdAt: new Date().toISOString(),
    });
    const output = new MemoryOutput();
    vi.stubEnv("LINGHUN_NATIVE_RUNNER_BUNDLED_DIR", bundledRoot);

    await handleSlashCommand("/doctor runner", context, output);
    await handleSlashCommand(
      "/job run bundled native runner available --tokens 50000",
      context,
      output,
    );

    const jobId = context.backgroundTasks.find((task) => task.kind === "job")?.id;
    const statePath = join(
      resolveStoragePaths(config, project).jobs,
      jobId ?? "missing",
      "state.json",
    );
    const state = JSON.parse(await readFile(statePath, "utf8")) as {
      result?: { status?: string };
      runner?: { adapter?: string; resolution?: string; status?: string; pathRef?: string };
    };
    expect(output.text).toContain("Native Runner Doctor：available");
    expect(output.text).toContain("source: bundled");
    expect(output.text).toContain(`bundled platform/arch: ${platformArch}`);
    expect(output.text).toContain(`bundled candidate: bundled:${platformArch}/`);
    expect(output.text).toContain("resolved path: present:linghun-native-runner");
    expect(output.text).toContain("fallback reason: none");
    expect(output.text).not.toContain(bundledRoot);
    expect(state.runner).toMatchObject({
      adapter: "native",
      resolution: "available",
      status: "running",
    });
    expect(state.runner?.pathRef).toContain("present:linghun-native-runner");
    expect(state.result?.status).toBe("partial");
    expect(context.backgroundTasks).not.toContainEqual(expect.objectContaining({ result: "pass" }));

    const missingProject = await mkdtemp(join(tmpdir(), "linghun-bundled-missing-"));
    const missingStore = new SessionStore({
      sessionRootDir: getSessionRootDir(),
      projectPath: missingProject,
    });
    const missingSession = await missingStore.create({ model: "deepseek-v4-flash" });
    const missingContext = await createTestContext(
      missingProject,
      missingStore,
      missingSession,
      config,
    );
    missingContext.index.status = "ready";
    missingContext.index.projectName = "F-Linghun";
    missingContext.lastVerification = createVerificationReportFixture("partial");
    missingContext.evidence = [...context.evidence];
    const missingOutput = new MemoryOutput();
    vi.stubEnv("LINGHUN_NATIVE_RUNNER_BUNDLED_DIR", join(missingProject, "no-bundled-runner"));
    await handleSlashCommand("/doctor runner", missingContext, missingOutput);
    await handleSlashCommand(
      "/job run bundled missing fallback --tokens 50000",
      missingContext,
      missingOutput,
    );
    const missingJobId = missingContext.backgroundTasks.find((task) => task.kind === "job")?.id;
    const missingState = JSON.parse(
      await readFile(
        join(
          resolveStoragePaths(config, missingProject).jobs,
          missingJobId ?? "missing",
          "state.json",
        ),
        "utf8",
      ),
    ) as { runner?: { adapter?: string; resolution?: string; fallbackReason?: string } };
    expect(missingOutput.text).toContain("Native Runner Doctor：unavailable");
    expect(missingOutput.text).toContain(`bundled candidate: bundled:${platformArch}/`);
    expect(missingOutput.text).toContain("Node fallback=available");
    expect(missingState.runner).toMatchObject({
      adapter: "node",
      resolution: "unavailable",
      fallbackReason: "unavailable",
    });
    expect(missingContext.backgroundTasks).not.toContainEqual(
      expect.objectContaining({ result: "pass" }),
    );

    const mismatchProject = await mkdtemp(join(tmpdir(), "linghun-bundled-mismatch-"));
    const mismatchRoot = join(mismatchProject, "bundled");
    await createMockNativeRunner(mismatchProject, {
      runnerDir: join(mismatchRoot, platformArch),
      runnerName:
        process.platform === "win32" ? "linghun-native-runner.cjs" : "linghun-native-runner",
    });
    const mismatchStore = new SessionStore({
      sessionRootDir: getSessionRootDir(),
      projectPath: mismatchProject,
    });
    const mismatchSession = await mismatchStore.create({ model: "deepseek-v4-flash" });
    const mismatchContext = await createTestContext(
      mismatchProject,
      mismatchStore,
      mismatchSession,
      config,
    );
    mismatchContext.index.status = "ready";
    mismatchContext.index.projectName = "F-Linghun";
    mismatchContext.lastVerification = createVerificationReportFixture("partial");
    mismatchContext.evidence = [...context.evidence];
    const mismatchOutput = new MemoryOutput();
    vi.stubEnv("LINGHUN_NATIVE_RUNNER_BUNDLED_DIR", mismatchRoot);
    vi.stubEnv("LINGHUN_MOCK_RUNNER_MODE", "mismatch");
    await handleSlashCommand("/doctor runner", mismatchContext, mismatchOutput);
    await handleSlashCommand(
      "/job run bundled mismatch fallback --tokens 50000",
      mismatchContext,
      mismatchOutput,
    );
    const mismatchJobId = mismatchContext.backgroundTasks.find((task) => task.kind === "job")?.id;
    const mismatchState = JSON.parse(
      await readFile(
        join(
          resolveStoragePaths(config, mismatchProject).jobs,
          mismatchJobId ?? "missing",
          "state.json",
        ),
        "utf8",
      ),
    ) as { runner?: { adapter?: string; resolution?: string; fallbackReason?: string } };
    expect(mismatchOutput.text).toContain("Native Runner Doctor：protocol_mismatch");
    expect(mismatchOutput.text).toContain("fallback reason: protocol mismatch");
    expect(mismatchState.runner).toMatchObject({
      adapter: "node",
      resolution: "protocol_mismatch",
      fallbackReason: "protocol_mismatch",
    });
    expect(mismatchContext.backgroundTasks).not.toContainEqual(
      expect.objectContaining({ result: "pass" }),
    );
    vi.unstubAllEnvs();

    const corruptProject = await mkdtemp(join(tmpdir(), "linghun-bundled-corrupt-"));
    const corruptRoot = join(corruptProject, "bundled");
    await createMockNativeRunner(corruptProject, {
      runnerDir: join(corruptRoot, platformArch),
      runnerName:
        process.platform === "win32" ? "linghun-native-runner.cjs" : "linghun-native-runner",
    });
    const corruptStore = new SessionStore({
      sessionRootDir: getSessionRootDir(),
      projectPath: corruptProject,
    });
    const corruptSession = await corruptStore.create({ model: "deepseek-v4-flash" });
    const corruptContext = await createTestContext(
      corruptProject,
      corruptStore,
      corruptSession,
      config,
    );
    corruptContext.index.status = "ready";
    corruptContext.index.projectName = "F-Linghun";
    corruptContext.lastVerification = createVerificationReportFixture("partial");
    corruptContext.evidence = [...context.evidence];
    const corruptOutput = new MemoryOutput();
    vi.stubEnv("LINGHUN_NATIVE_RUNNER_BUNDLED_DIR", corruptRoot);
    vi.stubEnv("LINGHUN_MOCK_RUNNER_MODE", "corrupt-version");
    await handleSlashCommand("/doctor runner", corruptContext, corruptOutput);
    await handleSlashCommand(
      "/job run bundled corrupt output fallback --tokens 50000",
      corruptContext,
      corruptOutput,
    );
    const corruptJobId = corruptContext.backgroundTasks.find((task) => task.kind === "job")?.id;
    const corruptState = JSON.parse(
      await readFile(
        join(
          resolveStoragePaths(config, corruptProject).jobs,
          corruptJobId ?? "missing",
          "state.json",
        ),
        "utf8",
      ),
    ) as { runner?: { adapter?: string; resolution?: string; fallbackReason?: string } };
    expect(corruptOutput.text).toContain("Native Runner Doctor：protocol_mismatch");
    expect(corruptOutput.text).toContain("fallback reason: protocol mismatch");
    expect(corruptState.runner).toMatchObject({
      adapter: "node",
      resolution: "protocol_mismatch",
      fallbackReason: "protocol_mismatch",
    });
    expect(corruptContext.backgroundTasks).not.toContainEqual(
      expect.objectContaining({ result: "pass" }),
    );
    vi.unstubAllEnvs();

    const customProject = await mkdtemp(join(tmpdir(), "linghun-custom-runner-"));
    const customRoot = join(customProject, "custom root");
    const bundledRootForCustom = join(customProject, "bundled root");
    const customRunner = await createMockNativeRunner(customProject, {
      runnerDir: customRoot,
      runnerName: "custom-runner.cjs",
    });
    await createMockNativeRunner(customProject, {
      runnerDir: join(bundledRootForCustom, platformArch),
      runnerName:
        process.platform === "win32" ? "linghun-native-runner.cjs" : "linghun-native-runner",
    });
    const customStore = new SessionStore({
      sessionRootDir: getSessionRootDir(),
      projectPath: customProject,
    });
    const customSession = await customStore.create({ model: "deepseek-v4-flash" });
    const customContext = await createTestContext(customProject, customStore, customSession, {
      ...config,
      nativeRunner: { ...config.nativeRunner, source: "custom", path: customRunner.path },
    });
    const customOutput = new MemoryOutput();
    vi.stubEnv("LINGHUN_NATIVE_RUNNER_BUNDLED_DIR", bundledRootForCustom);
    await handleSlashCommand("/doctor runner", customContext, customOutput);
    expect(customOutput.text).toContain("source: custom");
    expect(customOutput.text).toContain("resolved path: present:custom-runner.cjs");
    expect(customOutput.text).toContain(`bundled candidate: bundled:${platformArch}/`);
    expect(customOutput.text).not.toContain(bundledRootForCustom);
    vi.unstubAllEnvs();

    const darwinProject = await mkdtemp(join(tmpdir(), "linghun-darwin-runner-"));
    const darwinRoot = join(darwinProject, "bundled");
    await createMockNativeRunner(darwinProject, {
      runnerDir: join(darwinRoot, "darwin-arm64"),
      runnerName: "linghun-native-runner.cjs",
    });
    const darwinStore = new SessionStore({
      sessionRootDir: getSessionRootDir(),
      projectPath: darwinProject,
    });
    const darwinSession = await darwinStore.create({ model: "deepseek-v4-flash" });
    const darwinContext = await createTestContext(
      darwinProject,
      darwinStore,
      darwinSession,
      config,
    );
    const darwinOutput = new MemoryOutput();
    vi.stubEnv("LINGHUN_NATIVE_RUNNER_BUNDLED_DIR", darwinRoot);
    vi.stubEnv("LINGHUN_NATIVE_RUNNER_PLATFORM_ARCH_TEST", "darwin-arm64");
    await handleSlashCommand("/doctor runner", darwinContext, darwinOutput);
    expect(darwinOutput.text).toContain("bundled platform/arch: darwin-arm64");
    expect(darwinOutput.text).toContain(
      "bundled candidate: bundled:darwin-arm64/linghun-native-runner.cjs",
    );
    expect(darwinOutput.text).not.toContain(darwinRoot);
  }, 20_000);

  it("covers Phase 17C native runner resolver, adapter, fallback, doctor, and non-PASS boundaries", async () => {
    const project = await mkdtemp(join(tmpdir(), "灵魂 runner 空格-"));
    const mockRunner = await createMockNativeRunner(project);
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const config: LinghunConfig = {
      ...defaultConfig,
      storage: { ...defaultConfig.storage, jobs: { scope: "project" } },
      nativeRunner: {
        ...defaultConfig.nativeRunner,
        enabled: true,
        source: "project-local",
        path: mockRunner.path,
        timeoutMs: 60_000,
      },
    };
    const context = await createTestContext(project, store, session, config);
    context.index.status = "ready";
    context.index.projectName = "F-Linghun";
    context.lastVerification = createVerificationReportFixture("partial");
    context.evidence.push({
      id: "ev-phase-17c",
      kind: "test_result",
      summary: "Phase 17C focused evidence",
      source: "vitest",
      supportsClaims: ["phase-17c-focused"],
      createdAt: new Date().toISOString(),
    });
    const doctorOutput = new MemoryOutput();
    const output = new MemoryOutput();

    await handleSlashCommand("/doctor runner", context, doctorOutput);
    vi.stubEnv("LINGHUN_MOCK_RUNNER_MODE", "absolute-log-refs");
    await handleSlashCommand(
      "/job run native runner should not execute raw command rm -rf secret --allow-bash --tokens 50000 --timeout 60000",
      context,
      output,
    );
    const jobId = context.backgroundTasks.find((task) => task.kind === "job")?.id;
    expect(jobId).toBeTruthy();
    await handleSlashCommand(`/job status ${jobId}`, context, output);
    await handleSlashCommand(`/details background ${jobId}`, context, output);

    const jobsRoot = resolveStoragePaths(config, project).jobs;
    const statePath = join(jobsRoot, jobId ?? "missing", "state.json");
    const persisted = JSON.parse(await readFile(statePath, "utf8")) as {
      status?: string;
      result?: { status?: string };
      runner?: {
        adapter?: string;
        status?: string;
        resolution?: string;
        heartbeatAt?: string;
        logRefs?: Record<string, string>;
        spec?: {
          cwd?: string;
          approvedTaskKind?: string;
          envAllowlist?: string[];
          logPaths?: Record<string, string>;
        };
        reportPath?: string;
      };
    };
    expect(persisted.status).toBe("completed");
    expect(persisted.result?.status).toBe("partial");
    expect(persisted.runner).toMatchObject({
      adapter: "native",
      status: "running",
      resolution: "available",
    });
    expect(persisted.runner?.heartbeatAt).toBeTruthy();
    expect(persisted.runner?.logRefs?.stdout).toBe("present:stdout.log");
    expect(persisted.runner?.logRefs?.stderr).toBe("present:stderr.log");
    expect(persisted.runner?.spec).toMatchObject({
      cwd: project,
      approvedTaskKind: "durable_job_supervisor",
      envAllowlist: [],
    });
    expect(persisted.runner?.spec?.logPaths?.stdout).toContain("stdout.log");
    expect(context.backgroundTasks).toContainEqual(
      expect.objectContaining({
        id: jobId,
        kind: "job",
        result: "partial",
        currentStep: expect.stringContaining("runner=native/running"),
      }),
    );
    expect(context.backgroundTasks).not.toContainEqual(expect.objectContaining({ result: "pass" }));
    const runnerStdoutPath = persisted.runner?.spec?.logPaths?.stdout ?? "";
    const runnerStderrPath = persisted.runner?.spec?.logPaths?.stderr ?? "";
    const runnerStdout = await readFile(runnerStdoutPath, "utf8");
    const reportText = await readFile(persisted.runner?.spec?.logPaths?.report ?? "", "utf8");
    expect(runnerStdout).toContain("heartbeat");
    expect(output.text).not.toContain(runnerStdoutPath);
    expect(output.text).not.toContain(runnerStderrPath);
    expect(reportText).toContain("stdout:present:stdout.log");
    expect(reportText).toContain("stderr:present:stderr.log");
    expect(reportText).not.toContain(runnerStdoutPath);
    expect(reportText).not.toContain(runnerStderrPath);
    const calls = await readMockNativeRunnerCalls(mockRunner.callsPath);
    const startCall = calls.find((call) => call.argv[0] === "start");
    expect(startCall?.argv).toContain("--root");
    expect(startCall?.argv).toContain("--heartbeat-ms");
    expect(startCall?.argv.join(" ")).toContain("linghun-approved-runner-task");
    expect(startCall?.argv.join(" ")).not.toContain("process.exit(0)");
    expect(startCall?.argv.join(" ")).not.toContain("rm -rf");
    expect(startCall?.argv.join(" ")).not.toContain("secret");
    expect(calls.some((call) => call.argv[0] === "status")).toBe(true);
    expect(doctorOutput.text).toContain("Native Runner Doctor：available");
    expect(doctorOutput.text).toContain("Node fallback=available");
    expect(doctorOutput.text).toContain("present:linghun-native-runner-mock.cjs");
    expect(doctorOutput.text).not.toContain(project);
    expect(output.text).toContain("runner=native/running");
    expect(output.text).toContain("heartbeat=");
    expect(output.text).toContain(
      "completed/cancelled/timeout/stale/blocked never equals verification PASS",
    );

    await waitForTestMs(1400);
    await handleSlashCommand(`/job status ${jobId}`, context, output);
    vi.unstubAllEnvs();
    const completed = JSON.parse(await readFile(statePath, "utf8")) as {
      runner?: { status?: string };
      result?: { status?: string };
    };
    expect(completed.runner?.status).toBe("completed");
    expect(completed.result?.status).toBe("partial");
    expect(context.backgroundTasks).not.toContainEqual(expect.objectContaining({ result: "pass" }));

    await handleSlashCommand(
      "/job run native runner cancel active task --tokens 50000 --timeout 60000",
      context,
      output,
    );
    const cancelJobId = context.backgroundTasks.find(
      (task) => task.kind === "job" && task.id !== jobId,
    )?.id;
    const cancelStatePath = join(jobsRoot, cancelJobId ?? "missing", "state.json");
    await handleSlashCommand(`/job cancel ${cancelJobId}`, context, output);
    const cancelled = JSON.parse(await readFile(cancelStatePath, "utf8")) as {
      status?: string;
      runner?: { status?: string; lastError?: string };
      result?: { status?: string };
    };
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.runner?.status).toBe("cancelled");
    expect(cancelled.result?.status).toBe("cancelled");
    expect(context.backgroundTasks).not.toContainEqual(expect.objectContaining({ result: "pass" }));
    expect(
      (await readMockNativeRunnerCalls(mockRunner.callsPath)).some(
        (call) => call.argv[0] === "stop",
      ),
    ).toBe(true);

    const timeoutProject = await mkdtemp(join(tmpdir(), "linghun-runner-timeout-"));
    const timeoutRunner = await createMockNativeRunner(timeoutProject);
    const timeoutStore = new SessionStore({
      sessionRootDir: getSessionRootDir(),
      projectPath: timeoutProject,
    });
    const timeoutSession = await timeoutStore.create({ model: "deepseek-v4-flash" });
    const timeoutContext = await createTestContext(timeoutProject, timeoutStore, timeoutSession, {
      ...config,
      nativeRunner: { ...config.nativeRunner, path: timeoutRunner.path, timeoutMs: 200 },
    });
    timeoutContext.index.status = "ready";
    timeoutContext.index.projectName = "F-Linghun";
    timeoutContext.lastVerification = createVerificationReportFixture("partial");
    timeoutContext.evidence = [...context.evidence];
    await handleSlashCommand(
      "/job run timeout stays non pass --tokens 50000 --timeout 200",
      timeoutContext,
      output,
    );
    const timeoutJobId = timeoutContext.backgroundTasks.find((task) => task.kind === "job")?.id;
    await waitForTestMs(450);
    await handleSlashCommand(`/job status ${timeoutJobId}`, timeoutContext, output);
    const timeoutState = JSON.parse(
      await readFile(
        join(
          resolveStoragePaths(config, timeoutProject).jobs,
          timeoutJobId ?? "missing",
          "state.json",
        ),
        "utf8",
      ),
    ) as { status?: string; runner?: { status?: string }; result?: { status?: string } };
    expect(timeoutState.status).toBe("timeout");
    expect(timeoutState.runner?.status).toBe("timeout");
    expect(timeoutState.result?.status).toBe("timeout");
    expect(timeoutContext.backgroundTasks).not.toContainEqual(
      expect.objectContaining({ result: "pass" }),
    );

    const mismatchProject = await mkdtemp(join(tmpdir(), "linghun-runner-mismatch-"));
    const mismatchRunner = await createMockNativeRunner(mismatchProject);
    const mismatchStore = new SessionStore({
      sessionRootDir: getSessionRootDir(),
      projectPath: mismatchProject,
    });
    const mismatchSession = await mismatchStore.create({ model: "deepseek-v4-flash" });
    const mismatchContext = await createTestContext(
      mismatchProject,
      mismatchStore,
      mismatchSession,
      {
        ...config,
        nativeRunner: { ...config.nativeRunner, path: mismatchRunner.path },
      },
    );
    mismatchContext.index.status = "ready";
    mismatchContext.index.projectName = "F-Linghun";
    mismatchContext.lastVerification = createVerificationReportFixture("partial");
    mismatchContext.evidence = [...context.evidence];
    const mismatchOutput = new MemoryOutput();
    vi.stubEnv("LINGHUN_MOCK_RUNNER_MODE", "mismatch");
    await handleSlashCommand("/doctor runner", mismatchContext, mismatchOutput);
    await handleSlashCommand(
      "/job run mismatch fallback --tokens 50000",
      mismatchContext,
      mismatchOutput,
    );
    vi.unstubAllEnvs();
    const mismatchJobId = mismatchContext.backgroundTasks.find((task) => task.kind === "job")?.id;
    const mismatchState = JSON.parse(
      await readFile(
        join(
          resolveStoragePaths(config, mismatchProject).jobs,
          mismatchJobId ?? "missing",
          "state.json",
        ),
        "utf8",
      ),
    ) as {
      runner?: { adapter?: string; status?: string; resolution?: string; fallbackReason?: string };
    };
    expect(mismatchOutput.text).toContain("Native Runner Doctor：protocol_mismatch");
    expect(mismatchOutput.text).toContain("Node fallback=available");
    expect(mismatchState.runner).toMatchObject({
      adapter: "node",
      status: "node_fallback",
      resolution: "protocol_mismatch",
      fallbackReason: "protocol_mismatch",
    });
    expect(mismatchContext.backgroundTasks).not.toContainEqual(
      expect.objectContaining({ result: "pass" }),
    );

    const failedProject = await mkdtemp(join(tmpdir(), "linghun-runner-fail-"));
    const failedRunner = await createMockNativeRunner(failedProject);
    const failedStore = new SessionStore({
      sessionRootDir: getSessionRootDir(),
      projectPath: failedProject,
    });
    const failedSession = await failedStore.create({ model: "deepseek-v4-flash" });
    const failedContext = await createTestContext(failedProject, failedStore, failedSession, {
      ...config,
      nativeRunner: { ...config.nativeRunner, path: failedRunner.path },
    });
    failedContext.index.status = "ready";
    failedContext.index.projectName = "F-Linghun";
    failedContext.lastVerification = createVerificationReportFixture("partial");
    failedContext.evidence = [...context.evidence];
    vi.stubEnv("LINGHUN_MOCK_RUNNER_MODE", "start-fail");
    await handleSlashCommand(
      "/job run start failure fallback --tokens 50000",
      failedContext,
      output,
    );
    vi.unstubAllEnvs();
    const failedJobId = failedContext.backgroundTasks.find((task) => task.kind === "job")?.id;
    const failedState = JSON.parse(
      await readFile(
        join(
          resolveStoragePaths(config, failedProject).jobs,
          failedJobId ?? "missing",
          "state.json",
        ),
        "utf8",
      ),
    ) as {
      runner?: { adapter?: string; status?: string; fallbackReason?: string; lastError?: string };
    };
    expect(failedState.runner).toMatchObject({
      adapter: "node",
      status: "node_fallback",
      fallbackReason: "start_failed",
    });
    expect(failedState.runner?.lastError).not.toContain("sk-live");
    expect(failedState.runner?.lastError).not.toContain("Bearer raw");
    expect(failedContext.backgroundTasks).not.toContainEqual(
      expect.objectContaining({ result: "pass" }),
    );

    const statusFailProject = await mkdtemp(join(tmpdir(), "linghun-runner-status-fail-"));
    const statusFailRunner = await createMockNativeRunner(statusFailProject);
    const statusFailStore = new SessionStore({
      sessionRootDir: getSessionRootDir(),
      projectPath: statusFailProject,
    });
    const statusFailSession = await statusFailStore.create({ model: "deepseek-v4-flash" });
    const statusFailContext = await createTestContext(
      statusFailProject,
      statusFailStore,
      statusFailSession,
      { ...config, nativeRunner: { ...config.nativeRunner, path: statusFailRunner.path } },
    );
    statusFailContext.index.status = "ready";
    statusFailContext.index.projectName = "F-Linghun";
    statusFailContext.lastVerification = createVerificationReportFixture("partial");
    statusFailContext.evidence = [...context.evidence];
    await handleSlashCommand(
      "/job run status failure fallback --tokens 50000",
      statusFailContext,
      output,
    );
    const statusFailJobId = statusFailContext.backgroundTasks.find(
      (task) => task.kind === "job",
    )?.id;
    vi.stubEnv("LINGHUN_MOCK_RUNNER_MODE", "status-fail");
    await handleSlashCommand(`/job status ${statusFailJobId}`, statusFailContext, output);
    vi.unstubAllEnvs();
    const statusFailState = JSON.parse(
      await readFile(
        join(
          resolveStoragePaths(config, statusFailProject).jobs,
          statusFailJobId ?? "missing",
          "state.json",
        ),
        "utf8",
      ),
    ) as {
      runner?: { adapter?: string; status?: string; fallbackReason?: string; lastError?: string };
    };
    expect(statusFailState.runner).toMatchObject({
      adapter: "node",
      status: "node_fallback",
      fallbackReason: "status_failed",
    });
    expect(statusFailState.runner?.lastError).not.toContain("sk-live");
    expect(statusFailState.runner?.lastError).not.toContain("Bearer raw");
    expect(statusFailContext.backgroundTasks).not.toContainEqual(
      expect.objectContaining({ result: "pass" }),
    );
  }, 15_000);

  it("keeps Phase 17B remote channels unaffected by Phase 17C runner commands", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session, {
      ...defaultConfig,
      remote: {
        enabled: true,
        channels: {
          ...defaultConfig.remote.channels,
          feishu: {
            ...defaultConfig.remote.channels.feishu,
            enabled: true,
            transport: "webhook_mock",
            bindingUserId: "user-1",
            trustedSources: ["feishu-user-1"],
          },
        },
      },
    });

    await handleSlashCommand("/doctor runner", context, output);
    await handleSlashCommand("/remote status", context, output);

    expect(output.text).toContain("Native Runner Doctor：disabled");
    expect(output.text).toContain("Remote Channels：已开启");
    expect(output.text).toContain("feishu: ready");
    expect(output.text).toContain("webhook_mock：diagnostic/test-only dry run");
    expect(output.text).not.toContain("Fast Workspace Scanner");
    expect(context.remote.channels.find((channel) => channel.id === "feishu")?.runtimeStatus).toBe(
      "ready",
    );
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

  it("D.13Q-UX Closure: Freshness regex gate has been removed at the source level", async () => {
    // 旧行为：用户输入命中 freshness regex（"最新""当前""version" 等）会让 sendMessage
    // 在 assistantText 末尾追加 "Freshness 提示：本会话没有 web_source 证据..." 警告，
    // 并把 freshness_lite_boundary / freshness_lite_primary_enforced 写进 transcript，
    // 同时给 system prompt 注入 `FreshnessBoundary=...` 段。
    //
    // D.13Q-UX Closure：删除整套 FreshnessLite gate（needsFreshnessLiteBoundary /
    // createFreshnessLiteBoundary / recordFreshnessLiteBoundary / formatFreshnessLite*）。
    // 反幻觉边界改为：
    //   - system prompt 中的静态 FreshnessRule（让模型自己决定是否调 WebSearch）；
    //   - evidence-first 工作流（web_source kind 在 EvidenceSummary 里能直接被模型看到）。
    //
    // 这里通过源码扫描断言 gate 在主仓库源码里彻底不存在；不依赖 runTui 全流程，
    // 也不让 user provider.env 注入的 anthropic_messages provider 干扰断言。
    const indexSrc = await readFile("src/index.ts", "utf8");
    const loopSrc = await readFile("src/model-loop-runtime.ts", "utf8");

    // 1) 删除 FreshnessLite 关键词 gate 与 boundary 相关 helper
    expect(indexSrc).not.toMatch(/needsFreshnessLiteBoundary\s*\(/);
    expect(indexSrc).not.toMatch(/createFreshnessLiteBoundary\s*\(/);
    expect(indexSrc).not.toMatch(/recordFreshnessLiteBoundary\s*\(/);
    expect(loopSrc).not.toMatch(/export\s+function\s+needsFreshnessLiteBoundary/);
    expect(loopSrc).not.toMatch(/export\s+function\s+formatFreshnessLitePrimaryWarning/);

    // 2) 主屏 / transcript 不再硬追加 freshness_lite_* 文案
    expect(indexSrc).not.toContain("Freshness 提示：本会话没有 web_source 证据");
    expect(indexSrc).not.toContain("freshness_lite_boundary");
    expect(indexSrc).not.toContain("freshness_lite_primary_enforced");

    // 3) system prompt 不再以 `FreshnessBoundary=` 段注入 per-turn 状态——
    //    旧 gate 位置已替换为静态 FreshnessRule。
    expect(indexSrc).not.toMatch(/FreshnessBoundary=/);

    // 4) 反幻觉边界仍保留：system prompt 必须有 FreshnessRule 静态规则，
    //    要求外部当前事实在没有 web_source evidence 时只能未验证表达。
    expect(indexSrc).toContain("FreshnessRule=");
    expect(indexSrc).toContain("WebSearch/WebFetch");
    expect(indexSrc).toContain("unverified");
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

  it("D.14D: natural workspace-trust wording falls through to the model, not a local Start Gate", async () => {
    // D.14D — 移除 workspace-trust 自然语言截胡。普通自然语言（含"信任这个项目"）
    // 默认进入模型主链；要调整信任请输入精确 /trust slash。
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session);
    const output = new MemoryOutput();

    const result = await handleNaturalInput("信任这个项目", context, output);

    expect(result).toBe("message");
    expect(context.pendingNaturalCommand).toBeUndefined();
    expect(output.text).not.toContain("我识别到你想调整工作区信任");
    expect(output.text).not.toContain("/trust");
  });

  it("D.14D: English natural workspace-trust wording falls through to the model", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session);
    context.language = "en-US";
    const output = new MemoryOutput();

    const result = await handleNaturalInput("trust this folder", context, output);

    expect(result).toBe("message");
    expect(context.pendingNaturalCommand).toBeUndefined();
    expect(output.text).not.toContain("I recognized that you want to adjust workspace trust");
  });

  it("D.13Q-UX Closure: ordinary model-status wording falls through to the model loop, not the local capability answer", async () => {
    // 旧行为：用户说"现在是什么模型"会被 routeNaturalIntent / formatCapabilityAnswer
    // 截胡，本地输出 "当前模型：role=executor provider=..." 字符串，根本不发模型。
    // D.13Q-UX Closure：handleNaturalInput 不再前置 routeNaturalIntent —— 普通自然
    // 语言（不以 "/" 开头、无 pending approval/Start Gate）默认进入模型/工具循环。
    // 用户要 capability summary 时使用 `/model status` / `/model doctor` 等精确 slash。
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session);
    const output = new MemoryOutput();

    const result = await handleNaturalInput("现在是什么模型", context, output);

    expect(result).toBe("message");
    // 不再本地拼"当前模型：role=executor provider=..." 字符串
    expect(output.text).not.toContain("当前模型：role=executor");
    expect(output.text).not.toContain("formatCapabilityAnswer");
  });

  describe("D.14D natural-language input boundary", () => {
    const ordinaryInputs = [
      "刷新索引",
      "更新索引",
      "帮我看看状态",
      "模型这里是不是有问题",
      "翻译成人话",
      "测试一下",
      "索引和记忆 MCP 打开了吗",
      "信任这个项目",
      "把这些文件加入 ignore 后刷新索引",
      "refresh the index",
      "is the model broken here",
    ];

    for (const input of ordinaryInputs) {
      it(`routes ordinary natural language to the model: ${input}`, async () => {
        const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
        // 配好 provider，避免触发"模型未配置"onboarding 路径，确保本测试只检验
        // 自然语言路由边界（onboarding 是另一条 state-gated 行为，单独测试）。
        await mkdir(join(project, ".linghun"), { recursive: true });
        await writeFile(
          join(project, ".linghun", "settings.json"),
          JSON.stringify({
            defaultModel: "nl-model",
            providers: {
              "openai-compatible": {
                baseUrl: "https://example.test/v1",
                apiKey: "sk-test",
                model: "nl-model",
              },
            },
          }),
          "utf8",
        );
        const config = await loadConfig(project);
        const store = new SessionStore({
          sessionRootDir: getSessionRootDir(),
          projectPath: project,
        });
        const session = await store.create({ model: "nl-model" });
        const context = await createTestContext(project, store, session, config);
        const output = new MemoryOutput();

        const result = await handleNaturalInput(input, context, output);

        expect(result).toBe("message");
        // 不再本地截胡到 composite status / trust gate / index repair。
        expect(output.text).not.toContain("组合本地状态");
        expect(output.text).not.toContain("Composite local status");
        expect(output.text).not.toContain("我识别到你想调整工作区信任");
        expect(output.text).not.toContain("索引安全修复续跑");
        expect(context.pendingNaturalCommand).toBeUndefined();
      });
    }

    it("still dispatches explicit slash commands locally (not to the model)", async () => {
      const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
      const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
      const session = await store.create({ model: "deepseek-v4-flash" });
      const context = await createTestContext(project, store, session);
      const output = new MemoryOutput();

      // handleSlashCommand 处理显式 slash；handleNaturalInput 只处理非 slash 文本。
      const result = await handleSlashCommand("/help", context, output);

      expect(result).toBe("handled");
      expect(output.text.length).toBeGreaterThan(0);
    });

    it("still handles pending-approval yes/no/details locally without sending to the model", async () => {
      const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
      const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
      const session = await store.create({ model: "deepseek-v4-flash" });
      const context = await createTestContext(project, store, session);
      const output = new MemoryOutput();

      context.pendingLocalApproval = {
        kind: "model_tool_use",
        toolName: "Bash",
        toolCall: { id: "call-1", name: "Bash", input: { command: "echo hi" } },
        sessionId: session.id,
      } as NonNullable<TuiContext["pendingLocalApproval"]>;

      const detailsResult = await handleNaturalInput("details", context, output);
      expect(detailsResult).toBe("handled");
      // 仍有 pending approval（details 不消费它）
      expect(context.pendingLocalApproval).toBeDefined();

      const denyResult = await handleNaturalInput("no", context, output);
      expect(denyResult).toBe("handled");
      expect(context.pendingLocalApproval).toBeUndefined();
    });
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
    expect(output.text).toContain("openai-compatible: type=openai-compatible provider=openai-compatible model=gpt-5.5");
    expect(output.text).toContain(
      "角色路由摘要：planner:deepseek/deepseek-v4-pro；executor:deepseek/deepseek-v4-pro",
    );
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
    const modelRequestJson = JSON.stringify(requests[0]);
    expect(modelRequestJson).toContain('{"type":"function","name":"Read"');
    expect(modelRequestJson).toContain('"name":"Write"');
    expect(modelRequestJson).toContain('"expectedHash":{"type":"string"}');
    expect(modelRequestJson).toContain('"name":"Edit"');
    expect(modelRequestJson).toContain('"name":"MultiEdit"');
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
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        ...config,
        defaultModel: "control-plane-model",
        providers: {
          ...config.providers,
          deepseek: { ...(config.providers?.deepseek ?? {}), model: "different-model" },
          "openai-compatible": {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "control-plane-model",
          },
        },
        storage: { ...defaultConfig.storage, jobs: { scope: "project" } },
      }),
      "utf8",
    );
    // 两条直接读文件的自然语言走模型主链路并调用 Read 工具（不被 slash 控制面截胡）。
    mockOpenAiToolFetch("Read", { path: "LINGHUN.md" }, "已读取 LINGHUN.md。");
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
      "当前模型：role=executor provider=openai-compatible model=control-plane-model reasoning=未生效",
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
        "/mcp tools\n/mcp doctor\n/index status\n/index search main\n/index architecture\n/exit\n",
      ]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(output.text).toContain("MCP tools（稳定排序摘要，不输出完整 schema）");
    expect(output.text).toContain("placeholder 表示安全占位摘要");
    expect(output.text).toContain("schemaLoaded=no");
    expect(output.text).toContain("MCP status");
    expect(output.text).toContain("codebase-memory: configured");
    expect(output.text).toContain("codebase-memory source=env");
    expect(output.text).toContain("runtime: explicit codebase-memory override");
    expect(output.text).toContain(
      "guard: codebase-memory deferred tools currently require Linghun static registry + required args before CLI execution",
    );
    expect(output.text).toContain(
      "guard: extension-contributed MCP/skill/plugin tools must pass discovery + trust + schemaLoaded + compatible runtime",
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

  it("D.13Q-UX Closure: control-plane natural phrases fall through to the model, not local capability answers", async () => {
    // 旧行为：含"权限模式""模型配置正常吗""索引状态怎么样""缓存状态怎么样"等
    // 关键词的普通问题会被 isNaturalControlPlaneIntent / formatCapabilityAnswer 截胡，
    // 本地直接拼"当前权限模式：default"/"Model route doctor"/"Index status"/"Cache status"
    // 等条目，requests=0。
    //
    // D.13Q-UX Closure 收窄：handleNaturalInput 默认 fall through 到模型；本地控制
    // 面只接受显式 slash（/mode、/model、/index、/cache 等）。要切模式输入精确
    // slash；要看状态用精确 slash。这避免普通对话里偶尔提到"模式""模型""索引"
    // "缓存"被误识别成命令意图。
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session);

    const phrases = [
      "帮我切到自动模式",
      "切到自动审查",
      "switch to auto mode",
      "当前权限模式是什么",
      "模型配置正常吗",
      "索引状态怎么样",
      "缓存状态怎么样",
    ];
    for (const phrase of phrases) {
      const out = new MemoryOutput();
      const result = await handleNaturalInput(phrase, context, out);
      expect(result).toBe("message");
      // 不再本地拼 capability answer 文本
      expect(out.text).not.toContain("可以准备执行：权限模式");
      expect(out.text).not.toContain("Model route doctor");
      expect(out.text).not.toContain("Index status");
      expect(out.text).not.toContain("Cache status");
    }
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

    // D.13V architecture/completeness gate intercepts systemic-change inputs
    // ("修复这个 bug" / "实现导出报表功能") locally with an evidence-first card,
    // so not every input reaches the provider. The ordinary analysis/report
    // inputs still reach gateway.stream; assert those rather than a fixed count.
    expect(requests.length).toBeGreaterThanOrEqual(2);
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

  it("D.14D: composite readiness wording no longer answers locally; falls through to the model", async () => {
    // D.14D — 移除 composite local status 自然语言截胡。"索引和记忆 MCP 打开了吗"
    // 这类普通自然语言不再本地拼"组合本地状态"，默认进入模型主链。要看综合状态请
    // 使用精确 slash（/doctor、/status、/index status 等）。
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session);
    const output = new MemoryOutput();

    const zhResult = await handleNaturalInput("索引和记忆 MCP 打开了吗", context, output);
    context.language = "en-US";
    const enResult = await handleNaturalInput(
      "Are model, index and permissions ready?",
      context,
      output,
    );

    expect(zhResult).toBe("message");
    expect(enResult).toBe("message");
    expect(output.text).not.toContain("Composite local status");
    expect(output.text).not.toContain("组合本地状态");
    expect(output.text).not.toContain("not sent to the model");
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
    const requests = mockOpenAiToolFetch("Bash", { command: "mkdir SHOULD_NOT_RUN" });
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

  it("D.14D-R P1-3: tool round exhaustion shows a mature summary, not a scary failure box", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(join(project, "a.txt"), "alpha\n", "utf8");
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        defaultModel: "tool-rounds-model",
        providers: {
          deepseek: { model: "different-model" },
          "openai-compatible": {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "tool-rounds-model",
          },
        },
      }),
      "utf8",
    );
    // 4 个只读 Read 工具调用（MAX_MODEL_TOOL_ROUNDS=4），最后一轮触发轮次上限。
    // Read 走 auto-allow（readonly），不会被 permission 打断。
    const requests = mockOpenAiToolSequence(
      [
        { toolName: "Read", input: { path: "a.txt" } },
        { toolName: "Read", input: { path: "a.txt" } },
        { toolName: "Read", input: { path: "a.txt" } },
        { toolName: "Read", input: { path: "a.txt" } },
      ],
      "已综合现有信息回答。",
    );
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from(["请反复读取并分析\n/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    // 成熟摘要文案：不再是"将不再调用工具，并请求模型给出最终回答"这种机械文案。
    expect(output.text).toContain("本轮工具调用已达上限");
    expect(output.text).toContain("/index refresh");
    // 不应出现 provider 失败式的 /model doctor 甩锅（轮次耗尽不是 provider 故障）。
    expect(output.text).not.toContain("已达到工具轮次上限；将不再调用工具");
    expect(requests.length).toBeGreaterThanOrEqual(4);
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
      { command: "mkdir SHOULD_NOT_RUN" },
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
    expect(output.text).toContain("确认 待批准");
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
                            arguments: JSON.stringify({ command: "mkdir build-out" }),
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
        return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
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
          return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
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
          return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
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
          return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
        }
        const body = `data: ${JSON.stringify({ id: "chatcmpl-test-4", choices: [{ delta: { content: "已生成 requested-report.md。\n结论：报告已保存。\n推断/未确认：部署细节需继续核对。\n下一步：打开报告复核。" } }] })}\n\ndata: [DONE]\n\n`;
        return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
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
          return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
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
          return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
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
        return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
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

  it("D.13G real path: Claude placeholder dispatches anthropic tools through executeModelToolUse and continues with /v1/messages tool_result body without chat_completions divert", async () => {
    // 复现 D.13G 真实路径：
    //   - provider.env 旧 setup 默认 endpointProfile=chat_completions（占位）；
    //   - SelectedModelRuntime 把 endpointProfile 收窄为 chat_completions/responses，
    //     即使 Claude 模型最终也会以 chat_completions 透传给 gateway.stream；
    //   - 决策器必须把 Claude + chat_completions 视为占位、自动切 anthropic_messages，
    //     第一轮 fetch 走 /v1/messages 并解析 Anthropic SSE tool_use；
    //   - TUI 既有 executeModelToolUse / 权限 / tool_result 链路被复用（不引入二级 runner）；
    //   - 第二轮 body 必须以 Anthropic user content block { type:"tool_result", tool_use_id, content }
    //     回灌，URL 仍是 /v1/messages（不能被带偏到 /chat/completions），
    //     assistant block 必须携带 tool_use(id, name, input)；
    //   - 不能打印"不支持 tool calling"提示。
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(join(project, "package.json"), JSON.stringify({ name: "demo" }), "utf8");
    // 把可能干扰本测试的环境变量稳定到本测试期望的值。
    // 注意：vi.stubEnv("X", "") 不等于 unset；config 用 process.env.X ?? settings.X 合并，
    // 空字符串会原样透传，所以这里直接 stub 为期望值。
    vi.stubEnv("LINGHUN_OPENAI_BASE_URL", "https://relay.example.com/v1");
    vi.stubEnv("LINGHUN_OPENAI_API_KEY", "sk-test");
    vi.stubEnv("LINGHUN_OPENAI_MODEL", "claude-3-5-sonnet-latest");
    // provider.env 旧 setup 默认值就是 chat_completions，这里也保持这个占位
    vi.stubEnv("LINGHUN_OPENAI_ENDPOINT_PROFILE", "chat_completions");
    vi.stubEnv("LINGHUN_DEFAULT_MODEL", "claude-3-5-sonnet-latest");
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        defaultModel: "claude-3-5-sonnet-latest",
        providers: {
          deepseek: { model: "different-model" },
          "openai-compatible": {
            baseUrl: "https://relay.example.com/v1",
            apiKey: "sk-test",
            model: "claude-3-5-sonnet-latest",
            // 关键：provider.env 旧 setup 默认值，本身就是 chat_completions 占位
            endpointProfile: "chat_completions",
          },
        },
      }),
      "utf8",
    );
    const requests: Array<{
      url: string;
      body: { messages?: Array<{ role: string; content: unknown }> };
    }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as {
          messages?: Array<{ role: string; content: unknown }>;
        };
        requests.push({ url: String(url), body });
        const encoder = new TextEncoder();
        if (requests.length === 1) {
          // 第一轮：Anthropic SSE 单个 tool_use（content_block_start + input_json_delta + stop）
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":10}}}\n\n',
                ),
              );
              controller.enqueue(
                encoder.encode(
                  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_test_1","name":"Read"}}\n\n',
                ),
              );
              controller.enqueue(
                encoder.encode(
                  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"package.json\\"}"}}\n\n',
                ),
              );
              controller.enqueue(
                encoder.encode(
                  'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
                ),
              );
              controller.enqueue(
                encoder.encode(
                  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":5}}\n\n',
                ),
              );
              controller.enqueue(
                encoder.encode('event: message_stop\ndata: {"type":"message_stop"}\n\n'),
              );
              controller.close();
            },
          });
          return new Response(stream, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          });
        }
        // 第二轮：Anthropic SSE 仅 text_delta，最终 stop_reason=end_turn
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_2","usage":{"input_tokens":20}}}\n\n',
              ),
            );
            controller.enqueue(
              encoder.encode(
                'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}\n\n',
              ),
            );
            controller.enqueue(
              encoder.encode(
                'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"已读取 package.json，分析完成。"}}\n\n',
              ),
            );
            controller.enqueue(
              encoder.encode(
                'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
              ),
            );
            controller.enqueue(
              encoder.encode(
                'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":10}}\n\n',
              ),
            );
            controller.enqueue(
              encoder.encode('event: message_stop\ndata: {"type":"message_stop"}\n\n'),
            );
            controller.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }),
    );
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from([
        "帮我分析一下这个项目 看看怎么部署 把分析记在心里\nyes\n/exit\n",
      ]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    // 必须发了两轮请求
    expect(requests).toHaveLength(2);
    // 两轮 URL 都是 /v1/messages，不是 /chat/completions（占位不能带偏 Claude 路径）
    expect(requests[0].url).toBe("https://relay.example.com/v1/messages");
    expect(requests[1].url).toBe("https://relay.example.com/v1/messages");
    expect(requests[0].url.endsWith("/chat/completions")).toBe(false);
    expect(requests[1].url.endsWith("/chat/completions")).toBe(false);

    // 第二轮 body 必须存在 Anthropic user content block 形态的 tool_result（{type:"tool_result", tool_use_id, content}）
    const secondMessages = requests[1].body.messages ?? [];
    const userToolResultMessages = secondMessages.filter(
      (m) => m.role === "user" && Array.isArray(m.content),
    );
    const allUserBlocks = userToolResultMessages.flatMap(
      (m) =>
        (m.content as Array<{ type?: string; tool_use_id?: string; content?: unknown }>) ?? [],
    );
    const toolResult = allUserBlocks.find(
      (b) => b.type === "tool_result" && b.tool_use_id === "toolu_test_1",
    );
    expect(toolResult).toBeTruthy();
    expect(toolResult?.content).toBeDefined();

    // 第二轮 assistant 必须携带 tool_use block（id/name/input）
    const assistantBlocks = secondMessages
      .filter((m) => m.role === "assistant" && Array.isArray(m.content))
      .flatMap(
        (m) =>
          (m.content as Array<{ type?: string; id?: string; name?: string; input?: unknown }>) ??
          [],
      );
    const toolUseBlock = assistantBlocks.find(
      (b) => b.type === "tool_use" && b.id === "toolu_test_1" && b.name === "Read",
    );
    expect(toolUseBlock).toBeTruthy();

    // 不能打印"不支持 tool calling"提示（zh+en 两路都断言）
    expect(output.text).not.toContain("不支持 tool calling");
    expect(output.text).not.toContain("Tool calling is not supported");

    // 占位不能让 body 退化为 OpenAI chat schema：第二轮 body 不应有 choices/openai 风格 tool_calls
    const rawSecondBody = requests[1].body as unknown as {
      tools?: Array<{ name?: string; function?: unknown; input_schema?: unknown }>;
    };
    if (rawSecondBody.tools && rawSecondBody.tools.length > 0) {
      // tools schema 必须是 Anthropic（{name, input_schema}），不是 OpenAI 的 {type:"function", function:{...}}
      expect(rawSecondBody.tools[0].function).toBeUndefined();
      expect(rawSecondBody.tools[0].input_schema).toBeDefined();
    }

    // 最终 assistant 文本应进入 stdout
    expect(output.text).toContain("已读取 package.json");
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
        storage: { ...defaultConfig.storage, jobs: { scope: "project" } },
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
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({ storage: { ...defaultConfig.storage, jobs: { scope: "project" } } }),
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
    // D.14D — 修复路径改为显式 /index repair slash，不再指向自然语言。
    expect(output.text).toContain(
      "修复路径：运行 /index repair 自动追加缺失 ignore 条目并刷新索引；写入 ignore 文件仍会进入权限管道。",
    );
    expect(output.text).toContain("重试命令：/index refresh");
  });

  it("D.14D: /index repair continues after an active safety blocker", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await writeFile(join(project, "large.json"), "x".repeat(1_100_000), "utf8");
    const mockDir = await mkdtemp(join(tmpdir(), "linghun-codebase-memory-mock-"));
    const { config, callsPath } = await createMockCodebaseMemoryConfig(project, mockDir);
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session, config);

    await handleSlashCommand("/index refresh", context, output);
    await handleSlashCommand("/index repair", context, output);
    await handleNaturalInput("确认", context, output);

    expect(await readFile(join(project, ".linghunignore"), "utf8")).toContain("large.json");
    expect(output.text).toContain("索引安全门");
    expect(output.text).toContain("索引安全修复续跑");
    expect(output.text).toContain("需要先确认权限");
    expect(await readMockCalls(callsPath)).toContain("index_repository");
  });

  it("D.14D: /index repair writes ignore then refreshes after Write is allowed", async () => {
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
    await handleSlashCommand("/index repair", context, output);

    expect(await readFile(join(project, ".linghunignore"), "utf8")).toContain("large.json");
    expect(output.text).toContain("索引安全修复续跑");
    expect(output.text).toContain("ignore 文件：.linghunignore");
    expect(output.text).toContain("ignore 写入完成：.linghunignore；条目数量=1");
    expect(output.text).toContain("索引刷新：正在执行...");
    expect(output.text.match(/索引安全门/g)).toHaveLength(1);
    expect(await readMockCalls(callsPath)).toContain("index_repository");
  });

  it("D.14D: English /index repair writes ignore then refreshes after Write is allowed", async () => {
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
    await handleSlashCommand("/index repair", context, output);

    expect(await readFile(join(project, ".linghunignore"), "utf8")).toContain("large.json");
    expect(output.text).toContain("Index safety repair continuation");
    expect(output.text).toContain("ignore file: .linghunignore");
    expect(output.text).toContain("Ignore write completed: .linghunignore; entries=1.");
    expect(await readMockCalls(callsPath)).toContain("index_repository");
  });

  it("D.14D: /index repair does not duplicate existing ignore entries before refresh", async () => {
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
    await handleSlashCommand("/index repair", context, output);

    expect(await readFile(join(project, ".linghunignore"), "utf8")).toBe("large.json\n");
    expect(output.text).toContain("ignore 写入跳过");
    expect(await readMockCalls(callsPath)).toContain("index_repository");
  });

  it("D.14D-R P0-1: /index repair in ink mode sets pendingLocalApproval and does not leak prompt text", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await writeFile(join(project, "large.json"), "x".repeat(1_100_000), "utf8");
    const mockDir = await mkdtemp(join(tmpdir(), "linghun-codebase-memory-mock-"));
    const { config } = await createMockCodebaseMemoryConfig(project, mockDir);
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session, config);
    // P0-1 — ink 主屏：提权走 PermissionPanel，不把文本提示糊到主屏。
    (context as { isInkSession?: boolean }).isInkSession = true;

    await handleSlashCommand("/index refresh", context, output);
    await handleSlashCommand("/index repair", context, output);

    // ask 路径已挂起，等待 PermissionPanel 确认。
    expect((context as { pendingLocalApproval?: { kind?: string } }).pendingLocalApproval?.kind).toBe(
      "index_ignore_write",
    );
    // ink 主屏不再出现文本提权提示（PermissionPanel 是唯一提权 UI）。
    expect(output.text).not.toContain("需要先确认权限");
    // 文件尚未写入（等待确认）。
    await expect(readFile(join(project, ".linghunignore"), "utf8")).rejects.toThrow();
    // PermissionPanel 视图可由 pendingLocalApproval 装配（Write 语义）。
    const view = mapPendingApprovalToPermission(context);
    expect(view?.toolName).toBe("Write");
    expect(view?.scope).toContain(".linghunignore");
  });

  it("D.14D-R P0-2: model IndexRefresh tool routes through permission panel and refreshes after approval", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    const mockDir = await mkdtemp(join(tmpdir(), "linghun-codebase-memory-mock-"));
    const { config, callsPath } = await createMockCodebaseMemoryConfig(project, mockDir, undefined, {
      status: "ready",
    });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        defaultModel: "index-refresh-model",
        providers: {
          deepseek: { model: "different-model" },
          "openai-compatible": {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "index-refresh-model",
          },
        },
        mcp: config.mcp,
      }),
      "utf8",
    );
    // 模型对"更新一下索引"回以结构化 IndexRefresh 工具调用；确认后给最终回答。
    const requests = mockOpenAiToolFetch("IndexRefresh", {}, "索引已刷新完成。");
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from(["更新一下索引\nyes\n/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    // 第一轮模型请求触发 IndexRefresh → 权限确认（plain 文本 yes/no）→ yes → 真实刷新 → 续轮。
    expect(requests.length).toBeGreaterThanOrEqual(2);
    // 真实调用了 index_repository（受控刷新路径），不是文本冒充。
    expect(await readMockCalls(callsPath)).toContain("index_repository");
    // 主屏出现"已刷新"成熟摘要。
    expect(output.text).toContain("索引");
    // final answer 后未把工具结果伪装；transcript 含 index_operation evidence。
    const session = (
      await new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project }).list()
    ).at(0);
    const transcript = await readFile(session?.transcriptPath ?? "", "utf8");
    expect(transcript).toContain("index_operation");
  });

  it("D.14D-R P0-2: model IndexRefresh denied → no index_repository, model told NOT refreshed", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    const mockDir = await mkdtemp(join(tmpdir(), "linghun-codebase-memory-mock-"));
    const { config, callsPath } = await createMockCodebaseMemoryConfig(project, mockDir, undefined, {
      status: "ready",
    });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        defaultModel: "index-deny-model",
        providers: {
          deepseek: { model: "different-model" },
          "openai-compatible": {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "index-deny-model",
          },
        },
        mcp: config.mcp,
      }),
      "utf8",
    );
    const requests = mockOpenAiToolFetch("IndexRefresh", {}, "我不会声称索引已刷新。");
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from(["更新一下索引\nno\n/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    // 拒绝后没有真实刷新索引。
    expect(await readMockCalls(callsPath)).not.toContain("index_repository");
    // 回灌给模型的 tool_result 明确"未刷新"。
    const second = requests[1] as { messages?: { role?: string; content?: string }[] };
    const toolMessage = second?.messages?.find((message) => message.role === "tool");
    expect(toolMessage?.content).toContain("NOT refreshed");
  });

  it("D.14D-R P1-2: index refresh success with delayed status read-back shows a mature footer, not 索引?", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const mockDir = await mkdtemp(join(tmpdir(), "linghun-codebase-memory-mock-"));
    // projects: [] → index_repository 成功，但随后的 list_projects 读不到当前项目
    // （read-back 延迟），refreshIndexStatus 回落 missing。footer 不能显示 索引?。
    const { config } = await createMockCodebaseMemoryConfig(project, mockDir, undefined, {
      projects: [],
    });
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session, config);

    await handleSlashCommand("/index refresh", context, output);

    // 刷新成功后状态升级为成熟的 stale（新鲜度待确认），不再是 missing/unknown。
    expect(context.index.status).toBe("stale");
    expect(context.index.indexedAt).toBeTruthy();
    expect(context.index.staleHint).toContain("待确认");
    // footer 不再显示 `索引?`。
    const footer = formatFooterIndexLabel(context.language, context.index.status);
    expect(footer).not.toBe("索引?");
    expect(footer).toContain("stale");
  });

  it("D.14D-R P1-2: index refresh success with confirmed status shows ready in footer", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const mockDir = await mkdtemp(join(tmpdir(), "linghun-codebase-memory-mock-"));
    const { config } = await createMockCodebaseMemoryConfig(project, mockDir, undefined, {
      status: "ready",
    });
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session, config);

    await handleSlashCommand("/index refresh", context, output);

    expect(context.index.status).toBe("ready");
    const footer = formatFooterIndexLabel(context.language, context.index.status);
    expect(footer).toContain("ready");
    expect(footer).not.toBe("索引?");
  });

  it("D.14D: /index repair does not write or refresh when approval is denied", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await writeFile(join(project, "large.json"), "x".repeat(1_100_000), "utf8");
    const mockDir = await mkdtemp(join(tmpdir(), "linghun-codebase-memory-mock-"));
    const { config, callsPath } = await createMockCodebaseMemoryConfig(project, mockDir);
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session, config);

    await handleSlashCommand("/index refresh", context, output);
    await handleSlashCommand("/index repair", context, output);
    await handleNaturalInput("no", context, output);

    await expect(readFile(join(project, ".linghunignore"), "utf8")).rejects.toThrow();
    expect(output.text).toContain("需要先确认权限");
    expect(output.text).toContain("已拒绝权限。本轮未写入文件，也未刷新索引。");
    expect(await readMockCalls(callsPath)).toEqual([]);
  });

  it("D.14D: /index repair continues after default Write approval", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await writeFile(join(project, "large.json"), "x".repeat(1_100_000), "utf8");
    const mockDir = await mkdtemp(join(tmpdir(), "linghun-codebase-memory-mock-"));
    const { config, callsPath } = await createMockCodebaseMemoryConfig(project, mockDir);
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session, config);

    await handleSlashCommand("/index refresh", context, output);
    await handleSlashCommand("/index repair", context, output);
    await expect(readFile(join(project, ".linghunignore"), "utf8")).rejects.toThrow();
    await handleNaturalInput("确认", context, output);

    expect(await readFile(join(project, ".linghunignore"), "utf8")).toContain("large.json");
    expect(output.text).toContain("需要先确认权限");
    expect(output.text).toContain("ignore 写入完成：.linghunignore；条目数量=1");
    expect(await readMockCalls(callsPath)).toContain("index_repository");
  });

  it("D.14D: /index repair with no active blocker explains how to trigger it", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const mockDir = await mkdtemp(join(tmpdir(), "linghun-codebase-memory-mock-"));
    const { config, callsPath } = await createMockCodebaseMemoryConfig(project, mockDir);
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session, config);

    await handleSlashCommand("/index repair", context, output);

    expect(output.text).toContain("当前没有待处理的索引安全门");
    await expect(readFile(join(project, ".linghunignore"), "utf8")).rejects.toThrow();
    expect(await readMockCalls(callsPath)).toEqual([]);
  });

  it("D.14D: ordinary development requests reach the model loop even after an index safety pause", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await writeFile(join(project, "large.json"), "x".repeat(1_100_000), "utf8");
    const mockDir = await mkdtemp(join(tmpdir(), "linghun-codebase-memory-mock-"));
    const { config } = await createMockCodebaseMemoryConfig(project, mockDir);
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session, config);

    await handleSlashCommand("/index refresh", context, output);

    // D.14D — index safety pause 不再截胡自然语言。"把这些文件加入 ignore 后刷新索引"
    // 这种自然语言也照常进入模型主链；要修复请显式 /index repair。
    await expect(handleNaturalInput("把这些文件加入 ignore 后刷新索引", context, output)).resolves.toBe(
      "message",
    );
    await expect(handleNaturalInput("帮我实现登录功能", context, output)).resolves.toBe("message");
  });

  it("does not execute Bash silently in default mode", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const output = new MemoryOutput();

    // D.13N — engine auto-allows readonly Bash (echo / pwd / git status / …),
    // so to assert "no silent Bash" we use a destructive command that the
    // policy engine never auto-allows. The contract: in default mode any
    // command not in the readonly whitelist must still prompt.
    await runTui({
      projectPath: project,
      stdin: Readable.from(["/bash rm SHOULD_NOT_RUN.txt\n/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(output.text).toContain("default 模式不会静默执行 Bash");
    expect(output.text).not.toContain("SHOULD_NOT_RUN");
    expect(output.text).not.toContain("工具 Bash 结果");
  });

  // D.13N — policy engine auto_allow_readonly: safe readonly Bash (echo,
  // pwd, git status, …) skips the permission card in default mode and the
  // session transcript records a `permission_auto_allow_readonly` event for
  // auditability. Sensitive paths (`.env`, provider.env, .ssh/) and
  // composition operators (`; && || | > $()`) keep the prompt.
  it("D.13N policy engine auto_allow_readonly: /bash echo runs without permission card and emits audit event", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from(["/bash echo D13N_AUTO_ALLOW_OK\n/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(output.text).toContain("D13N_AUTO_ALLOW_OK");
    expect(output.text).not.toContain("default 模式不会静默执行 Bash");

    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const sessions = await store.list();
    const transcript = (await store.resume(sessions[0]?.id ?? "")).transcript;
    expect(
      transcript.some(
        (event) =>
          event.type === "system_event" &&
          event.message.includes("permission_auto_allow_readonly") &&
          event.message.includes("tool=Bash") &&
          event.message.includes("semantic=readonly"),
      ),
    ).toBe(true);
    // Audit event must not leak the actual command argument verbatim — the
    // engine emits a summary, not raw text.
    const autoAllowEvent = transcript.find(
      (event) =>
        event.type === "system_event" &&
        event.message.includes("permission_auto_allow_readonly") &&
        event.message.includes("tool=Bash"),
    );
    expect(
      autoAllowEvent && autoAllowEvent.type === "system_event"
        ? autoAllowEvent.message
        : "",
    ).toContain("summary=");
  });

  it("D.13N policy engine: /bash cat .env still prompts (sensitive_path)", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await writeFile(join(project, ".env"), "API_KEY=must-not-leak\n", "utf8");
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from(["/bash cat .env\n/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(output.text).toContain("default 模式不会静默执行 Bash");
    expect(output.text).not.toContain("must-not-leak");
  });

  it("D.13N policy engine: /bash with composition operator still prompts", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from(["/bash echo a > out.txt\n/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(output.text).toContain("default 模式不会静默执行 Bash");
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
    expect(output.text).toContain("输出已折叠，按 Ctrl+O 展开。");
    expect(output.text).toContain("120 行");
    expect(output.text).toContain("90 条结果");
    expect(output.text).not.toContain("详情：用 /details output <id>");
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
    expect(formatted).toContain("输出已折叠，按 Ctrl+O 展开。");
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
    expect(formatted).toContain("Output folded. Press Ctrl+O to expand.");
    expect(formatted).toContain("Command exited 0");
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
    expect(formatted).toContain("输出已折叠，按 Ctrl+O 展开。");
    expect(formatted).not.toContain("完整日志：.linghun/logs/tools/bash-mojibake.log");
    expect(formatted).not.toContain("Ã¤Â¸Â­Ã¦Â–Â‡");
  });

  it("does not generate LINGHUN.md when direct project-rules file read is missing", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        defaultModel: "missing-rules-model",
        providers: {
          deepseek: { model: "different-model" },
          "openai-compatible": {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "missing-rules-model",
          },
        },
      }),
      "utf8",
    );
    // 模型主动 Read 缺失的 LINGHUN.md → readTool 抛 ENOENT → tool_result 含错误，
    // 模型据此说明而非自动生成。验证：不写入 LINGHUN.md、不出现"已生成基础 LINGHUN.md"。
    mockOpenAiToolFetch(
      "Read",
      { path: "LINGHUN.md" },
      "LINGHUN.md 不存在；可运行 /memory init 生成基础模板，但我不会自动生成。",
    );
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from(["读一下 LINGHUN.md\n/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    // 工具错误（ENOENT）按产品策略不刷主屏原文；主屏只显示 Read 工具调用与模型说明。
    // 核心不变式：缺失 LINGHUN.md 不会被自动生成（无"已生成基础 LINGHUN.md"，文件不存在）。
    expect(output.text).toContain("Read(LINGHUN.md)");
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
    expect(output.text).toContain("provider 与网络传输问题");
    expect(output.text).toContain("不是 Linghun 本地缺陷");
    expect(output.text).not.toContain("Evidence:");
    expect(output.text).not.toContain("证据记录：");
    expect(output.text).not.toContain("tool_result");
    expect(output.text).not.toContain("EvidenceSummary");
    expect(output.text).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu,
    );
    expect(transcript).toContain("provider/transit failure code=PROVIDER_STREAM_ERROR");
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
        return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
      }),
    );
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from(["普通开发请求\n/model doctor\n/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(output.text).toContain("provider 与网络传输问题");
    expect(output.text).toContain("不是 Linghun 本地缺陷");
    expect(output.text).not.toContain("Evidence:");
    expect(output.text).not.toContain("证据记录：");
    expect(output.text).not.toContain("tool_result");
    expect(output.text).not.toContain("EvidenceSummary");
    expect(output.text).not.toContain("evidence=");
    expect(output.text).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu,
    );
    expect(output.text).toContain("last provider failure: kind=provider/transit code=PROVIDER_STREAM_ERROR");
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
    expect(transcript).toContain("provider/transit failure code=PROVIDER_STREAM_ERROR");
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
                primaryModel: "deepseek-chat",
                fallbackModels: ["gpt-4o"],
              }
            : route,
        ),
      },
      providers: {
        ...defaultConfig.providers,
        deepseek: {
          ...defaultConfig.providers.deepseek,
          model: "deepseek-chat",
        },
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

  it("covers Polish B real Esc, Enter, and Shift+Tab key handlers", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-polish-b-real-keys-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    context.pendingNaturalCommand = {
      gateId: "key-gate-exact-secret",
      capabilityId: "mode",
      source: "natural",
      exactCommand: "/mode full-access",
      command: "/mode full-access",
      risk: "start_gate",
      scope: `current project ${project}`,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      requiresExactConfirmation: true,
    };
    await handleTuiKeypress("return", context, output);
    expect(output.text).toContain("/enter 不会绕过精确确认");
    expect(context.pendingNaturalCommand).toBeTruthy();
    expect(context.permissionMode).toBe("default");
    await handleTuiKeypress("escape", context, output);
    expect(context.pendingNaturalCommand).toBeUndefined();

    context.pendingNaturalCommand = {
      gateId: "key-gate-normal-secret",
      capabilityId: "mode",
      source: "natural",
      exactCommand: "/mode plan",
      command: "/mode plan",
      risk: "start_gate",
      scope: `current project ${project}`,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      requiresExactConfirmation: false,
    };
    await handleTuiKeypress("return", context, output);
    expect(context.pendingNaturalCommand).toBeUndefined();
    expect(context.permissionMode).toBe("plan");

    context.permissionMode = "default";
    context.pendingLocalApproval = {
      kind: "index_ignore_write",
      plan: {
        path: ".linghunignore",
        content: "secret.json\n",
        expectedHash: "key-hash-secret",
        missingEntries: ["secret.json"],
      },
    } as NonNullable<TuiContext["pendingLocalApproval"]>;
    await handleTuiKeypress("escape", context, output);
    expect(context.pendingLocalApproval).toBeUndefined();
    await expect(readFile(join(project, ".linghunignore"), "utf8")).rejects.toThrow();

    await handleSlashCommand("/plan", context, output);
    expect(context.activePlan).toBeTruthy();
    await handleTuiKeypress("escape", context, output);
    expect(context.activePlan).toBeUndefined();

    await handleSlashCommand(
      "/autopilot key handler work --steps 1 --tokens 50000",
      context,
      output,
    );
    expect(context.pendingAutopilot).toBeTruthy();
    await handleTuiKeypress("escape", context, output);
    expect(context.pendingAutopilot).toBeUndefined();
    expect(context.backgroundTasks.filter((task) => task.kind === "job")).toHaveLength(0);

    await handleTuiKeypress("shift-tab", context, output);
    expect(context.permissionMode).toBe("plan");
    expect(output.text).toContain("Shift+Tab 只打开这个切换提示；不会开启 full-access");
    expect(output.text).toContain("不能绕过 Start Gate");
  });

  it("covers Polish B pending interaction controls and slash fallbacks with safe details", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-polish-b-controls-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    context.pendingNaturalCommand = {
      gateId: "gate-raw-secret",
      capabilityId: "mode",
      source: "natural",
      exactCommand: "/mode plan",
      command: "/mode plan",
      risk: "start_gate",
      scope: `current project ${project}`,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      requiresExactConfirmation: false,
    };
    await handleNaturalInput("details", context, output);
    expect(output.text).toContain("待确认 Start Gate 详情");
    expect(output.text).not.toContain("gate-raw-secret");
    await handleSlashCommand("/esc", context, output);
    expect(context.pendingNaturalCommand).toBeUndefined();
    expect(context.permissionMode).toBe("default");

    context.pendingNaturalCommand = {
      gateId: "gate-exact-secret",
      capabilityId: "mode",
      source: "natural",
      exactCommand: "/mode full-access",
      command: "/mode full-access",
      risk: "start_gate",
      scope: `current project ${project}`,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      requiresExactConfirmation: true,
    };
    await handleSlashCommand("/enter", context, output);
    expect(output.text).toContain("/enter 不会绕过精确确认");
    expect(context.pendingNaturalCommand).toBeTruthy();
    expect(context.permissionMode).toBe("default");
    await handleSlashCommand("/esc", context, output);

    context.pendingNaturalCommand = {
      gateId: "gate-normal-secret",
      capabilityId: "mode",
      source: "natural",
      exactCommand: "/mode plan",
      command: "/mode plan",
      risk: "start_gate",
      scope: `current project ${project}`,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      requiresExactConfirmation: false,
    };
    await handleSlashCommand("/enter", context, output);
    expect(context.pendingNaturalCommand).toBeUndefined();
    expect(context.permissionMode).toBe("plan");

    context.permissionMode = "default";
    context.pendingLocalApproval = {
      kind: "index_ignore_write",
      plan: {
        path: ".linghunignore",
        content: "raw-schema sk-test-secret request-secret\n",
        expectedHash: "hash-secret",
        missingEntries: ["secret.json"],
      },
    } as NonNullable<TuiContext["pendingLocalApproval"]>;
    await handleNaturalInput("details", context, output);
    expect(output.text).toContain("待确认权限详情");
    expect(output.text).toContain("条目数量：1");
    expect(output.text).not.toContain("sk-test-secret");
    expect(output.text).not.toContain("request-secret");
    expect(output.text).not.toContain("hash-secret");
    await handleSlashCommand("/esc", context, output);
    expect(context.pendingLocalApproval).toBeUndefined();
    await expect(readFile(join(project, ".linghunignore"), "utf8")).rejects.toThrow();

    await handleSlashCommand("/plan", context, output);
    expect(context.activePlan).toBeTruthy();
    await handleSlashCommand("/esc", context, output);
    expect(context.activePlan).toBeUndefined();
    expect(context.planAccepted).toBe(false);
  });

  it("shows Polish B light Workspace Trust on first interactive missing trust and persists confirm", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-polish-b-trust-first-"));
    const userConfig = join(project, "user-config");
    vi.stubEnv("LINGHUN_CONFIG_DIR", userConfig);
    const input = new TtyInput();
    const output = new MemoryOutput();
    const running = runTui({
      projectPath: project,
      stdin: input,
      stdout: output,
      stderr: new MemoryOutput(),
    });

    await waitForTestCondition(() => output.text.includes("选择输出语言 / Choose output language"));
    input.write("\n");
    await waitForTestCondition(() => output.text.includes("工作区信任"));
    await expect(readFile(join(project, ".linghun", "settings.json"), "utf8")).rejects.toThrow();
    expect(await readFile(getUserSettingsPath(), "utf8")).toContain('"language": "zh-CN"');
    expect(output.text).toContain(`│  ${project}`);
    expect(output.text).toContain("是否信任这个项目");
    expect(output.text).toContain("信任此项目 (yes)");
    expect(output.text).toContain("信任后可读写和运行命令；安全审批仍生效");
    input.write("\n");
    await waitForTestCondition(() => output.text.includes("工作区信任：trusted"));
    input.write("/exit\n");

    await expect(running).resolves.toBe(0);
    const settings = await readFile(join(project, ".linghun", "settings.json"), "utf8");
    expect(settings).not.toContain('"language"');
    expect(settings).toContain('"workspaceTrust"');
    expect(settings).toContain('"level": "trusted"');
    expect(settings).toContain('"recorded": true');
  });

  it("keeps Polish B light Workspace Trust restricted when first prompt is cancelled", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-polish-b-trust-cancel-"));
    const userConfig = join(project, "user-config");
    vi.stubEnv("LINGHUN_CONFIG_DIR", userConfig);
    const input = new TtyInput();
    const output = new MemoryOutput();
    const running = runTui({
      projectPath: project,
      stdin: input,
      stdout: output,
      stderr: new MemoryOutput(),
    });

    await waitForTestCondition(() => output.text.includes("选择输出语言 / Choose output language"));
    input.write("\n");
    await waitForTestCondition(() => output.text.includes("工作区信任"));
    input.emit("keypress", "", { name: "escape" });
    await waitForTestCondition(() => output.text.includes("工作区信任：restricted"));
    input.write("/write trust.txt blocked\n/help\n/status\n/doctor readiness\n/exit\n");

    await expect(running).resolves.toBe(0);
    const settings = await readFile(join(project, ".linghun", "settings.json"), "utf8");
    expect(settings).not.toContain('"language"');
    expect(settings).toContain('"level": "restricted"');
    expect(await readFile(getUserSettingsPath(), "utf8")).toContain('"language": "zh-CN"');
    expect(output.text).toContain("已拦截 /write");
    expect(output.text).toContain("帮助");
    expect(output.text).toContain("Readiness：本地");
    await expect(readFile(join(project, "trust.txt"), "utf8")).rejects.toThrow();
  });

  it("shows Polish D first-run language picker only for TTY and persists English", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-polish-d-language-first-"));
    const userConfig = join(project, "user-config");
    vi.stubEnv("LINGHUN_CONFIG_DIR", userConfig);
    const input = new TtyInput();
    const output = new MemoryOutput();
    const running = runTui({
      projectPath: project,
      stdin: input,
      stdout: output,
      stderr: new MemoryOutput(),
    });

    await waitForTestCondition(() => output.text.includes("选择输出语言 / Choose output language"));
    input.write("2\n");
    await waitForTestCondition(() => output.text.includes("Language switched to English."));
    await expect(readFile(join(project, ".linghun", "settings.json"), "utf8")).rejects.toThrow();
    expect(await readFile(getUserSettingsPath(), "utf8")).toContain('"language": "en-US"');
    await waitForTestCondition(() => output.text.includes("Workspace trust"));
    expect(output.text).toContain("Do you trust this project?");
    input.write("no\n");
    await waitForTestCondition(() => output.text.includes("Workspace trust: restricted"));
    input.write("/exit\n");

    await expect(running).resolves.toBe(0);
    const settings = await readFile(join(project, ".linghun", "settings.json"), "utf8");
    expect(settings).not.toContain('"language"');
    expect(settings).toContain('"level": "restricted"');
    expect(await readFile(getUserSettingsPath(), "utf8")).toContain('"language": "en-US"');
    // TTY legacy path now uses product plain shell instead of writeLegacyStartup
    expect(output.text).toContain("LingHun");
  });

  it("persists first-run language to user settings when workspace trust is already recorded", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-polish-d-language-trusted-"));
    const userConfig = join(project, "user-config");
    vi.stubEnv("LINGHUN_CONFIG_DIR", userConfig);
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({ workspaceTrust: { level: "trusted", recorded: true } }),
      "utf8",
    );
    const input = new TtyInput();
    const output = new MemoryOutput();
    const running = runTui({
      projectPath: project,
      stdin: input,
      stdout: output,
      stderr: new MemoryOutput(),
    });

    await waitForTestCondition(() => output.text.includes("选择输出语言 / Choose output language"));
    input.write("2\n");
    await waitForTestCondition(() => output.text.includes("Language switched to English."));
    input.write("/exit\n");

    await expect(running).resolves.toBe(0);
    const settings = await readFile(join(project, ".linghun", "settings.json"), "utf8");
    expect(settings).not.toContain('"language"');
    expect(await readFile(getUserSettingsPath(), "utf8")).toContain('"language": "en-US"');
    expect(output.text).not.toContain("Do you trust this project?");
    // TTY legacy path now uses product plain shell instead of writeLegacyStartup
    expect(output.text).toContain("LingHun");
  });

  it("does not show Polish B interactive Workspace Trust prompt for non-TTY input", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-polish-b-trust-nontty-"));
    const userConfig = join(project, "user-config");
    vi.stubEnv("LINGHUN_CONFIG_DIR", userConfig);
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from(["/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(output.text).toContain("工作区信任尚未记录");
    expect(output.text).not.toContain("选择输出语言 / Choose output language");
    expect(output.text).not.toContain("是否信任这个项目");
    await expect(readFile(join(project, ".linghun", "settings.json"), "utf8")).rejects.toThrow();
    await expect(readFile(getUserSettingsPath(), "utf8")).rejects.toThrow();
  });

  it("uses recorded user language across TTY workspaces without repeating the picker", async () => {
    const root = await mkdtemp(join(tmpdir(), "linghun-polish-d-language-user-"));
    vi.stubEnv("LINGHUN_CONFIG_DIR", join(root, "user-config"));
    await mkdir(join(root, "user-config"), { recursive: true });
    await writeFile(getUserSettingsPath(), JSON.stringify({ language: "en-US" }), "utf8");
    const project = join(root, "workspace");
    await mkdir(project, { recursive: true });
    const input = new TtyInput();
    const output = new MemoryOutput();
    const running = runTui({
      projectPath: project,
      stdin: input,
      stdout: output,
      stderr: new MemoryOutput(),
    });

    await waitForTestCondition(() => output.text.includes("Workspace trust"));
    expect(output.text).not.toContain("选择输出语言 / Choose output language");
    expect(output.text).toContain("Do you trust this project?");
    input.write("no\n");
    await waitForTestCondition(() => output.text.includes("Workspace trust: restricted"));
    input.write("/exit\n");

    await expect(running).resolves.toBe(0);
    const settings = await readFile(join(project, ".linghun", "settings.json"), "utf8");
    expect(settings).not.toContain('"language"');
    expect(settings).toContain('"level": "restricted"');
  });

  it("keeps Polish B trusted workspaces quiet on startup", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-polish-b-trust-quiet-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({ workspaceTrust: { level: "trusted", recorded: true } }),
      "utf8",
    );
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from(["/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(output.text).not.toContain("是否信任这个项目");
    expect(output.text).not.toContain("工作区信任尚未记录");
  });

  it("covers Polish B Workspace Trust boundaries without bypassing permissions", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-polish-b-trust-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleSlashCommand("/trust restricted", context, output);
    expect(context.config.workspaceTrust.level).toBe("restricted");
    expect(context.workspaceTrustEnforced).toBe(true);
    await handleSlashCommand("/status", context, output);
    await handleSlashCommand("/help", context, output);
    await handleSlashCommand("/doctor readiness", context, output);
    await handleSlashCommand("/write trust.txt blocked", context, output);
    await handleSlashCommand("/bash node --version", context, output);
    await handleSlashCommand("/job run blocked by trust", context, output);
    expect(output.text).toContain("已拦截 /write");
    expect(output.text).toContain("已拦截 /bash");
    expect(output.text).toContain("已拦截 /job");
    expect(output.text).toContain("Readiness：本地");
    expect(await readFile(join(project, ".linghun", "settings.json"), "utf8")).toContain(
      '"level": "restricted"',
    );
    await expect(readFile(join(project, "trust.txt"), "utf8")).rejects.toThrow();

    context.config = {
      ...context.config,
      workspaceTrust: { ...context.config.workspaceTrust, level: "trusted" },
    };
    context.workspaceTrustEnforced = false;
    await handleSlashCommand(
      "/autopilot trusted pending --steps 1 --tokens 50000",
      context,
      output,
    );
    expect(context.pendingAutopilot).toBeTruthy();
    await handleSlashCommand("/trust restricted", context, output);
    await handleSlashCommand("/autopilot confirm", context, output);
    expect(output.text).toContain("已拦截 /autopilot");
    expect(context.pendingAutopilot).toBeTruthy();
    expect(context.backgroundTasks.filter((task) => task.kind === "job")).toHaveLength(0);
    await handleSlashCommand("/autopilot cancel", context, output);
    expect(context.pendingAutopilot).toBeUndefined();

    await handleSlashCommand("/trust trust", context, output);
    expect(context.config.workspaceTrust.level).toBe("trusted");
    expect(context.workspaceTrustEnforced).toBe(false);
    await handleSlashCommand("/write trust.txt still-asks", context, output);
    expect(output.text).toContain("权限已拒绝");
    expect(output.text).toContain("需要用户确认后才会执行本次工具");
    await expect(readFile(join(project, "trust.txt"), "utf8")).rejects.toThrow();
  });

  it("covers Polish B bounded autopilot state and job delegation boundaries", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-polish-b-autopilot-"));
    const config: LinghunConfig = {
      ...defaultConfig,
      storage: { ...defaultConfig.storage, jobs: { scope: "project" } },
    };
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session, config);
    context.index.status = "ready";
    context.index.projectName = "F-Linghun";
    context.lastVerification = createVerificationReportFixture("partial");
    context.evidence.push({
      id: "ev-polish-b-autopilot",
      kind: "test_result",
      summary: "Polish B autopilot focused evidence",
      source: "vitest",
      supportsClaims: ["polish-b-autopilot"],
      createdAt: new Date().toISOString(),
    });

    await handleSlashCommand(
      "/autopilot polish b bounded work --steps 2 --tokens 50000 --timeout 60000 --allow-edit --allow-bash",
      context,
      output,
    );
    expect(context.pendingAutopilot).toMatchObject({
      goal: "polish b bounded work",
      maxSteps: 2,
      maxTokens: 50_000,
      timeoutMs: 60_000,
      allowEdit: true,
      allowBash: true,
    });
    expect(context.backgroundTasks.filter((task) => task.kind === "job")).toHaveLength(0);
    await handleSlashCommand("/autopilot status", context, output);
    await handleSlashCommand("/autopilot details", context, output);
    expect(output.text).toContain("持续推进待确认");
    expect(output.text).toContain("steps<=2");
    expect(output.text).toContain("allowEdit=yes");
    await handleSlashCommand("/autopilot cancel", context, output);
    expect(context.pendingAutopilot).toBeUndefined();
    expect(context.backgroundTasks.filter((task) => task.kind === "job")).toHaveLength(0);

    await handleSlashCommand(
      "/autopilot polish b delegated job --steps 2 --tokens 50000",
      context,
      output,
    );
    await handleSlashCommand("/autopilot confirm", context, output);
    const jobId = context.backgroundTasks.find((task) => task.kind === "job")?.id;
    expect(jobId).toBeTruthy();
    expect(context.pendingAutopilot).toBeUndefined();
    expect(context.backgroundTasks).not.toContainEqual(expect.objectContaining({ result: "pass" }));
    expect(context.backgroundTasks).not.toContainEqual(
      expect.objectContaining({ kind: "autopilot" }),
    );
    const state = JSON.parse(
      await readFile(
        join(resolveStoragePaths(config, project).jobs, jobId ?? "missing", "state.json"),
        "utf8",
      ),
    ) as { result?: { status?: string; summary?: string } };
    expect(state.result?.status).not.toBe("pass");
    expect(state.result?.summary).toContain("no PASS evidence");
    expect(output.text).toContain("本地 durable metadata + 统一后台任务");
    expect(output.text).toContain("never equals verification PASS");
  });

  it("keeps Polish B permission mode hard boundaries", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-polish-b-modes-"));
    await writeFile(join(project, "sample.txt"), "alpha", "utf8");
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleNaturalInput("请帮我开启 full-access", context, output);
    expect(context.permissionMode).toBe("default");
    await handleNaturalInput("yes", context, output);
    expect(context.permissionMode).toBe("default");
    // D.13D 移除了自然语言→full-access 的 Start Gate；裸 yes 落到 no-pending 分支，
    // 不放行、不发模型。硬边界仍在（mode 始终保持 default）。
    expect(output.text).toContain("当前没有等待确认的 Start Gate");

    await handleSlashCommand("/mode plan", context, output);
    await handleSlashCommand("/write sample.txt beta", context, output);
    await handleSlashCommand("/bash node --version", context, output);
    expect(output.text).toContain("Plan 模式禁止写入");
    expect(await readFile(join(project, "sample.txt"), "utf8")).toBe("alpha");
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

    // D13E-P3: Shift+Tab cycles 4 canonical modes; full-access still requires
    // local opt-in (LINGHUN_ENABLE_FULL_ACCESS=1) AND planAccepted when leaving
    // plan mode. Without those guards full-access is silently denied.
    process.env.LINGHUN_ENABLE_FULL_ACCESS = "1";
    try {
      await handleSlashCommand("/tab", context, output);
      expect(context.permissionMode).toBe("auto-review");
      await handleSlashCommand("/tab", context, output);
      expect(context.permissionMode).toBe("plan");
      context.planAccepted = true;
      await handleSlashCommand("/tab", context, output);
      expect(context.permissionMode).toBe("full-access");
      await handleSlashCommand("/tab", context, output);
      expect(context.permissionMode).toBe("default");
    } finally {
      delete process.env.LINGHUN_ENABLE_FULL_ACCESS;
    }
    expect(output.text).not.toContain("acceptEdits");
    expect(output.text).not.toContain("dontAsk");
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
    expect(output.text).toContain("自动模式会自动通过低风险动作");
    expect(output.text).toContain("Bash、联网、未知命令和高风险操作仍按权限策略确认或拒绝");
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

    expect(output.text).toContain("命中需确认规则");
    expect(output.text).toContain("需要用户确认后才会执行本次工具");
    expect(output.text).toContain("Write  default");
    expect(output.text).toContain("已删除最近拒绝");
    expect(context.permissions.recentDenied).toHaveLength(0);
    await expect(readFile(join(project, "ask.txt"), "utf8")).rejects.toThrow();
  });

  it("switches i18n output between zh-CN and en-US", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    vi.stubEnv("LINGHUN_CONFIG_DIR", join(project, "user-config"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleSlashCommand("/help", context, output);
    await handleSlashCommand("/language en-US", context, output);
    await handleSlashCommand("/help", context, output);
    await handleSlashCommand("/not-a-command", context, output);
    await handleSlashCommand("/read missing.txt", context, output);

    expect(output.text).toContain("帮助：优先直接描述你的目标。");
    expect(output.text).toContain("Language switched to English.");
    expect(output.text).toContain("Help: describe your goal directly first.");
    expect(output.text).toContain("Status: Session");
    expect(output.text).toContain("Unknown command: /not-a-command");
    expect(output.text).toContain("Something went wrong.");
    expect(context.config.language).toBe("en-US");
    await expect(readFile(join(project, ".linghun", "settings.json"), "utf8")).rejects.toThrow();
    expect(await readFile(getUserSettingsPath(), "utf8")).toContain('"language": "en-US"');

    const prompt = createModelSystemPrompt("continue", context, {
      model: { provider: "deepseek", name: "deepseek-v4-flash" },
    });
    expect(prompt).toContain("Answer in English by default");
    expect(prompt).not.toContain("默认用中文回答");
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
    // D.13R: /rewind 文案明确为 Linghun snapshot checkpoint，不是 git reset。
    expect(output.text).toContain("已恢复 Linghun snapshot checkpoint");
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

    const bashTask = context.backgroundTasks.find((item) => item.kind === "bash");

    expect(output.text).toContain("[后台]");
    expect(output.text).toContain("Bash:");
    expect(bashTask?.status).toBe("completed");
    expect(bashTask?.logPath).toBeTruthy();
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

  it("D.14D-R2 P3-1: from-scratch '写一个 add 函数' reaches the model (no code-fact pre-gate)", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        defaultModel: "code-hygiene-model",
        providers: {
          deepseek: { model: "different-model" },
          "openai-compatible": {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "code-hygiene-model",
          },
        },
      }),
      "utf8",
    );
    const requests = mockOpenAiTextFetch("function add(a, b) { return a + b; }");
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from(["写一个 add 函数\n/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    // 请求到达模型（gate 未前置拦截）。
    expect(requests.length).toBeGreaterThanOrEqual(1);
    // 不应出现"尚未确认，需要先检查"的取证前置文案。
    expect(output.text).not.toContain("尚未确认，需要先检查");
    expect(output.text).toContain("function add");
  });

  it("D.14D-R2 P3-1: current-repo fact claim '这个仓库里 add 函数已经实现了吗' is pre-gated without evidence", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        defaultModel: "fact-model",
        providers: {
          deepseek: { model: "different-model" },
          "openai-compatible": {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "fact-model",
          },
        },
      }),
      "utf8",
    );
    const requests = mockOpenAiTextFetch("已实现。");
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from(["这个仓库里 add 函数已经实现了吗\n/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    // 事实声明被前置取证拦截（无本地代码事实证据）；请求不发给模型。
    expect(output.text).toContain("尚未确认，需要先检查");
    expect(requests.length).toBe(0);
  });

  it("D.14D: /btw is model-backed but isolated from todo, plan, and checkpoints", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        defaultModel: "btw-model",
        providers: {
          "openai-compatible": {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "btw-model",
          },
        },
      }),
      "utf8",
    );
    const config = await loadConfig(project);
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "btw-model" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session, config);
    context.modelGateway = createModelGateway(config);
    mockOpenAiTextFetch("当前在 D.14D 阶段。");

    await handleSlashCommand("/plan", context, output);
    await handleSlashCommand("/todo add 主任务", context, output);
    await handleSlashCommand("/btw 现在是什么阶段？", context, output);

    // D.14D: /btw 现在调模型，plain 路径 writeLine 模型答案（不再是本地备忘文案）。
    expect(output.text).toContain("当前在 D.14D 阶段。");
    expect(output.text).not.toContain("已记下临时备忘");
    // 不污染 Todo / Plan / checkpoint。
    expect(context.activePlan).toBeTruthy();
    expect(context.tools.todos).toHaveLength(1);
    expect(context.checkpoints).toHaveLength(0);
    // 不写 evidence、不进 final-answer / completion gate。
    expect(context.evidence).toHaveLength(0);
    expect(context.solutionCompleteness.triggered).toBeFalsy();
  });

  it("D.14D: /btw calls the model and opens an answered BtwPanel in ink; records btw_question without evidence", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        defaultModel: "btw-model",
        providers: {
          "openai-compatible": {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "btw-model",
          },
        },
      }),
      "utf8",
    );
    const config = await loadConfig(project);
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "btw-model" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session, config);
    context.isInkSession = true;
    context.modelGateway = createModelGateway(config);
    const requests = mockOpenAiTextFetch("这是模型给出的临时回答。");

    await handleSlashCommand("/btw 帮我解释一下这段逻辑", context, output);

    const panel = (
      context as { btwPanelState?: { question: string; phase: string; answer?: string } }
    ).btwPanelState;
    expect(panel).toBeDefined();
    expect(panel?.question).toBe("帮我解释一下这段逻辑");
    expect(panel?.phase).toBe("answered");
    expect(panel?.answer ?? "").toContain("这是模型给出的临时回答。");
    // ink 路径不 writeLine transcript（答案进面板）。
    expect(output.text).toBe("");
    // 真的调了 provider（单轮、无工具）。
    expect(requests.length).toBeGreaterThan(0);
    const body = requests[0] as { tool_choice?: unknown; tools?: unknown };
    expect(body.tools ?? []).toEqual([]);
    // 不污染 Todo / Plan / checkpoint / job / permission / evidence。
    expect(context.activePlan).toBeFalsy();
    expect(context.tools.todos).toHaveLength(0);
    expect(context.checkpoints).toHaveLength(0);
    expect(context.backgroundTasks).toHaveLength(0);
    expect(context.pendingLocalApproval).toBeUndefined();
    expect(context.evidence).toHaveLength(0);
    expect(context.solutionCompleteness.triggered).toBeFalsy();
    // session store 记录 btw_question event（含答案）用于审计 / details。
    const resumed = await store.resume(session.id);
    expect(
      resumed.transcript.some(
        (e) => e.type === "btw_question" && (e as { text: string }).text === "帮我解释一下这段逻辑",
      ),
    ).toBe(true);
  });

  it("D.14D: /btw shows a visible error when the provider fails, without polluting evidence or gates", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        defaultModel: "btw-model",
        providers: {
          "openai-compatible": {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "btw-model",
          },
        },
      }),
      "utf8",
    );
    const config = await loadConfig(project);
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "btw-model" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session, config);
    context.isInkSession = true;
    context.modelGateway = createModelGateway(config);
    mockOpenAiErrorFetch();

    await handleSlashCommand("/btw 这条会失败", context, output);

    const panel = (
      context as { btwPanelState?: { question: string; phase: string; error?: string } }
    ).btwPanelState;
    expect(panel?.phase).toBe("error");
    expect(panel?.error ?? "").toContain("quota exceeded");
    // 失败不写 evidence、不进 completion gate。
    expect(context.evidence).toHaveLength(0);
    expect(context.solutionCompleteness.triggered).toBeFalsy();
  });

  it("D.13Q-UX Closure: /sessions ink path opens SessionsPanel sorted by updatedAt with current session marked", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const sessionA = await store.create({ model: "deepseek-v4-flash", summary: "A 较早" });
    await new Promise((r) => setTimeout(r, 5));
    const sessionB = await store.create({ model: "deepseek-v4-flash", summary: "B 当前" });
    await new Promise((r) => setTimeout(r, 5));
    const sessionC = await store.create({ model: "deepseek-v4-flash", summary: "C 最新" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, sessionB);
    (context as { isInkSession?: boolean }).isInkSession = true;

    await handleSlashCommand("/sessions", context, output);

    const panel = (context as { sessionsPanelState?: { cursor: number; entries: { id: string; isCurrent: boolean; updatedAt: string }[] } }).sessionsPanelState;
    expect(panel).toBeDefined();
    // ink 路径不逐行 writeLine 主屏。
    expect(output.text).toBe("");
    // 按 updatedAt 倒序：C 最新在前，A 最早在后。
    const ids = (panel?.entries ?? []).map((e) => e.id);
    expect(ids[0]).toBe(sessionC.id);
    expect(ids[ids.length - 1]).toBe(sessionA.id);
    // 当前 session 有 isCurrent=true，其它没有。
    const current = (panel?.entries ?? []).filter((e) => e.isCurrent);
    expect(current).toHaveLength(1);
    expect(current[0]?.id).toBe(sessionB.id);
  });

  it("D.13Q-UX Closure: /sessions empty state renders panel without faking entries", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    // 先创建 currentSession 以满足 createTestContext，再删除 store 列表的所有 session
    // —— 这里用一种更轻的方式：直接传一个不在 store.list() 里的 session。
    const phantom = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, phantom);
    (context as { isInkSession?: boolean }).isInkSession = true;
    // 模拟"列表为空"：把 phantom 标为 current 但 store 视图本身只有它。
    await handleSlashCommand("/sessions", context, output);
    const panel = (context as { sessionsPanelState?: { entries: unknown[] } }).sessionsPanelState;
    expect(panel).toBeDefined();
    // 至少 1 项（自己）。空状态成熟性由 SessionsPanel 在 entries.length===0 时
    // 渲染 dim 占位文本（fitText hint.empty）—— 此处通过 entries 数据形态稳定性
    // 间接验证：返回的 entries 都有 id/title/updatedAt/messageCount/isCurrent 五字段，
    // 且不会 fake worktree / 搜索结果。
    for (const entry of panel?.entries ?? []) {
      const e = entry as { id?: unknown; title?: unknown; updatedAt?: unknown; messageCount?: unknown; isCurrent?: unknown };
      expect(typeof e.id).toBe("string");
      expect(typeof e.title).toBe("string");
      expect(typeof e.updatedAt).toBe("string");
      expect(typeof e.messageCount).toBe("number");
      expect(typeof e.isCurrent).toBe("boolean");
    }
  });

  it("D.13Q-UX Closure: /resume without args opens picker; /resume <id> uses structured handoff and never dumps full transcript", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const previous = await store.create({ model: "deepseek-v4-flash", summary: "earlier session" });
    // 给 previous 写入很长的 user_message + assistant_text_delta，验证 /resume <id>
    // 不会把整段 transcript 直接 dump 到 output。
    const longUserText = "用户长消息" + "。".repeat(500);
    const longAssistantText = "助手长回答" + "！".repeat(500);
    await store.appendEvent(previous.id, {
      type: "user_message",
      id: "test-user-1",
      text: longUserText,
      createdAt: new Date().toISOString(),
    });
    await store.appendEvent(previous.id, {
      type: "assistant_text_delta",
      id: "test-assistant-1",
      text: longAssistantText,
      createdAt: new Date().toISOString(),
    });
    await new Promise((r) => setTimeout(r, 5));
    const current = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, current);
    (context as { isInkSession?: boolean }).isInkSession = true;

    // /resume 无参 → ink 路径打开 SessionsPanel picker，不 writeLine 主屏。
    await handleSlashCommand("/resume", context, output);
    const panel = (context as { sessionsPanelState?: { entries: unknown[] } }).sessionsPanelState;
    expect(panel).toBeDefined();
    expect((panel?.entries ?? []).length).toBeGreaterThanOrEqual(2);
    expect(output.text).toBe("");

    // /resume <id> → structured handoff，**不**把 transcript 整段 dump。
    const out2 = new MemoryOutput();
    // 关掉 ink 标志，确认 plain/带参路径走 resumeSessionWithHandoff。
    (context as { isInkSession?: boolean }).isInkSession = false;
    await handleSlashCommand(`/resume ${previous.id}`, context, out2);
    expect(out2.text).toContain("已恢复会话");
    expect(out2.text).toContain(previous.id);
    // 关键不变量：不 dump full transcript 字面量。
    expect(out2.text).not.toContain(longUserText);
    expect(out2.text).not.toContain(longAssistantText);
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

  it("/interrupt sends AbortSignal to a running Bash background task", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);
    context.permissionMode = "full-access";

    const running = handleSlashCommand('/bash node -e "setTimeout(()=>{}, 2000)"', context, output);
    await waitForTestCondition(() => Boolean(context.backgroundAbortControllers?.size));
    await handleSlashCommand("/interrupt", context, output);
    await running;

    expect(output.text).toContain("已发送 AbortSignal");
    expect(context.backgroundTasks[0]?.status).toBe("cancelled");
    expect(context.backgroundTasks[0]?.result).toBe("cancelled");
    expect(context.backgroundAbortControllers?.size ?? 0).toBe(0);
  });

  it("/interrupt uses explicit best-effort wording when no background controller exists", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);
    context.backgroundTasks = [createBackgroundTaskFixture("bash")];

    await handleSlashCommand("/interrupt", context, output);

    expect(output.text).toContain("未找到可用 AbortSignal，仅标记状态");
    expect(context.backgroundTasks[0]?.status).toBe("cancelled");
    expect(context.backgroundTasks[0]?.result).toBe("cancelled");
  });

  it("verification cancel uses process guard and remains non-PASS", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const controller = new AbortController();
    consumeProcessGuardStopResultsForTest();

    const running = runVerificationCommandForTest(
      'node -e "setTimeout(()=>{}, 2000)"',
      project,
      controller.signal,
    );
    controller.abort();
    const result = await running;
    await waitForTestMs(1100);
    const stopResults = consumeProcessGuardStopResultsForTest();

    expect(result.outcome).toBe("cancelled");
    expect(result.exitCode).not.toBe(0);
    expect(result.runnerError).toContain("cancelled");
    expect(stopResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ force: false, kind: "graceful" }),
        expect.objectContaining({ force: true, kind: "force" }),
      ]),
    );
  }, 10_000);

  it("verification timeout uses graceful then force process guard and remains non-PASS", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    consumeProcessGuardStopResultsForTest();

    const result = await runVerificationCommandForTest(
      'node -e "setTimeout(()=>{}, 2000)"',
      project,
      undefined,
      20,
    );
    await waitForTestMs(1100);
    const stopResults = consumeProcessGuardStopResultsForTest();

    expect(result.outcome).toBe("timeout");
    expect(result.exitCode).not.toBe(0);
    expect(result.runnerError).toContain("runner timeout after 20ms");
    expect(stopResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ force: false, kind: "graceful" }),
        expect.objectContaining({ force: true, kind: "force" }),
      ]),
    );
  }, 10_000);

  it("generic command timeout uses process guard without changing result", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    consumeProcessGuardStopResultsForTest();

    const result = await runCommandCaptureForTest(
      process.execPath,
      ["-e", "setTimeout(()=>{}, 2000)"],
      project,
      20,
    );
    const stopResults = consumeProcessGuardStopResultsForTest();

    expect(result).toMatchObject({
      exitCode: 124,
      stdout: "",
      stderr: "",
      summary: `命令超时：present:${process.execPath.split(/[\\\\/]/u).at(-1)}`,
    });
    expect(stopResults).toEqual(
      expect.arrayContaining([expect.objectContaining({ force: false, kind: "graceful" })]),
    );
  }, 10_000);

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

    const verificationTask = context.backgroundTasks.find((item) => item.kind === "verification");
    expect(backgroundOutput.text).toContain("stale");
    expect(context.lastVerification?.status).toBe("stale");
    expect(verificationTask?.status).toBe("stale");
    expect(verificationTask?.result).toBe("stale");
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
    expect(output.text).toContain("project selection: root_path");
    expect(output.text).toContain("fast status：未运行 detect_changes");
    expect(await readMockCalls(callsPath)).toEqual(["list_projects", "index_status"]);
  });

  it("keeps index status root_path project selection ahead of name candidates", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "Linghun-"));
    const mockDir = await mkdtemp(join(tmpdir(), "linghun-codebase-memory-mock-"));
    const projectName = projectRoot.replaceAll("\\", "/").split("/").at(-1) ?? "Linghun";
    const { config, callsPath } = await createMockCodebaseMemoryConfig(
      projectRoot,
      mockDir,
      { changed_count: 0 },
      {
        projects: [{ name: projectName }, { name: "root-match", root_path: projectRoot }],
      },
    );
    const store = new SessionStore({
      sessionRootDir: getSessionRootDir(),
      projectPath: projectRoot,
    });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(projectRoot, store, session, config);

    await handleSlashCommand("/index status", context, output);

    expect(output.text).toContain("project: root-match");
    expect(output.text).toContain("project selection: root_path");
    expect(
      (await readMockCallRecords(callsPath)).find((call) => call.tool === "index_status")?.input,
    ).toMatchObject({
      project: "root-match",
    });
  });

  it("selects index status project by unique basename candidate when root_path is missing", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "linghun-ceshi-"));
    const mockDir = await mkdtemp(join(tmpdir(), "linghun-codebase-memory-mock-"));
    const projectName = projectRoot.replaceAll("\\", "/").split("/").at(-1) ?? "linghun-ceshi";
    const { config, callsPath } = await createMockCodebaseMemoryConfig(
      projectRoot,
      mockDir,
      { changed_count: 0 },
      { projects: [{ name: projectName.toUpperCase() }] },
    );
    const store = new SessionStore({
      sessionRootDir: getSessionRootDir(),
      projectPath: projectRoot,
    });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(projectRoot, store, session, config);

    await handleSlashCommand("/index status", context, output);

    expect(output.text).toContain(`project: ${projectName.toUpperCase()}`);
    expect(output.text).toContain("project selection: name-candidate");
    expect(
      (await readMockCallRecords(callsPath)).find((call) => call.tool === "index_status")?.input,
    ).toMatchObject({
      project: projectName.toUpperCase(),
    });
  });

  it("derives index status Windows drive plus basename candidates from projectPath", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "linghun-ceshi-"));
    const mockDir = await mkdtemp(join(tmpdir(), "linghun-codebase-memory-mock-"));
    const normalizedProject = projectRoot.replaceAll("\\", "/");
    const projectName = normalizedProject.split("/").at(-1) ?? "linghun-ceshi";
    const drive = /^([A-Za-z]):\//.exec(normalizedProject)?.[1];
    const driveCandidate = drive ? `${drive}-${projectName}` : projectName;
    const { config, callsPath } = await createMockCodebaseMemoryConfig(
      projectRoot,
      mockDir,
      { changed_count: 0 },
      { projects: [{ name: driveCandidate.toUpperCase() }] },
    );
    const store = new SessionStore({
      sessionRootDir: getSessionRootDir(),
      projectPath: projectRoot,
    });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(projectRoot, store, session, config);

    await handleSlashCommand("/index status", context, output);

    expect(output.text).toContain(`project: ${driveCandidate.toUpperCase()}`);
    expect(output.text).toContain("project selection: name-candidate");
    expect(
      (await readMockCallRecords(callsPath)).find((call) => call.tool === "index_status")?.input,
    ).toMatchObject({
      project: driveCandidate.toUpperCase(),
    });
  });

  it("does not guess index status project when multiple name candidates are ambiguous", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "linghun-ceshi-"));
    const mockDir = await mkdtemp(join(tmpdir(), "linghun-codebase-memory-mock-"));
    const normalizedProject = projectRoot.replaceAll("\\", "/");
    const projectName = normalizedProject.split("/").at(-1) ?? "linghun-ceshi";
    const drive = /^([A-Za-z]):\//.exec(normalizedProject)?.[1];
    const driveCandidate = drive ? `${drive}-${projectName}` : `drive-${projectName}`;
    const { config, callsPath } = await createMockCodebaseMemoryConfig(
      projectRoot,
      mockDir,
      { changed_count: 0 },
      { projects: [{ name: projectName }, { name: driveCandidate }] },
    );
    const store = new SessionStore({
      sessionRootDir: getSessionRootDir(),
      projectPath: projectRoot,
    });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(projectRoot, store, session, config);

    await handleSlashCommand("/index status", context, output);

    expect(output.text).toContain("status: missing");
    expect(output.text).toContain("project selection: missing");
    expect(await readMockCalls(callsPath)).toEqual(["list_projects"]);
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

    // D.13Q-UX：light hints 不再写主屏 transcript，改推到 context.notifications 队列，
    // 由 view-model 复制给 view.notifications 渲染——这正是"hints 不进 prompt/input 区"的实现。
    const hintTexts = (context.notifications ?? []).map((note) => note.text);
    expect(hintTexts.some((text) => text.includes("Cache reuse dipped a bit"))).toBe(true);
    expect(output.text).not.toContain("你> [hint");
    expect(output.text).not.toContain("you> [hint");
    expect(output.text).not.toContain("[hint:warning]");
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

    expect(output.text).toContain("provider 与网络传输问题");
    expect(output.text).toContain("不是 Linghun 本地缺陷");
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
          return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
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
          return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
        }
        const body = `data: ${JSON.stringify({ id: "chatcmpl-architecture-3", choices: [{ delta: { content: "小修已完成。" } }] })}\n\ndata: [DONE]\n\n`;
        return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
      }),
    );
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from(["加一个导出报表功能\n", "修一个 typo\n", "yes\n", "/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    // D.13V architecture/completeness gate adds one deterministic retry on the
    // systemic input (#1 "加一个导出报表功能") before the small-task Write turn.
    expect(requests).toHaveLength(4);
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
        storage: { ...defaultConfig.storage, jobs: { scope: "project" } },
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

    expect(output.text).toContain("帮助：优先直接描述你的目标。");
    expect(output.text).toContain("索引刷新完成");
    expect(output.text).toContain("当前没有等待确认的 Start Gate");
    expect(requests).toHaveLength(1);
    expect(output.text).toContain("正在思考…");
    expect(output.text).toContain("权限已拒绝");
    expect(output.text).toContain("工具 Write 已完成");
    expect(output.text).toContain("摘要");
    expect(await readFile(join(project, "report.md"), "utf8")).toBe("final");
    expect(output.text).toContain("工具 Bash 已完成");
    expect(output.text).toContain("输出已折叠，按 Ctrl+O 展开。");
    expect(output.text).toContain("Model route doctor");
    expect(output.text).toContain("MCP status");
    expect(output.text).toContain("Cache status");
    expect(output.text).toContain("查看 /permissions recent");
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

  it("covers Phase 17B Remote Channels setup, doctor, redaction, and approval safety", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const config: LinghunConfig = {
      ...defaultConfig,
      remote: {
        enabled: true,
        channels: {
          ...defaultConfig.remote.channels,
          feishu: {
            ...defaultConfig.remote.channels.feishu,
            enabled: true,
            transport: "webhook_mock",
            bindingUserId: "user-1",
            bindingDeviceId: "device-1",
            trustedSources: ["feishu-user-1"],
          },
          wecom: {
            ...defaultConfig.remote.channels.wecom,
            enabled: true,
            transport: "official_cli",
            cliPath: "missing-wecom-cli-for-test",
            bindingUserId: "wecom-user",
            trustedSources: ["wecom-user"],
          },
          dingtalk: {
            ...defaultConfig.remote.channels.dingtalk,
            enabled: true,
            transport: "webhook",
            bindingUserId: "ding-user",
            trustedSources: ["ding-user"],
          },
        },
      },
    };
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session, config);

    expect(defaultConfig.remote.enabled).toBe(false);
    expect(Object.keys(defaultConfig.remote.channels).sort()).toEqual([
      "dingtalk",
      "feishu",
      "wecom",
    ]);
    expect(context.remote.channels.map((channel) => channel.config.type).sort()).toEqual([
      "dingtalk",
      "feishu",
      "wecom",
    ]);

    await handleSlashCommand("/remote setup feishu", context, output);
    await handleSlashCommand("/remote doctor", context, output);
    await handleSlashCommand("/remote test feishu", context, output);
    await handleSlashCommand("/remote status", context, output);

    expect(output.text).toContain("Remote setup：feishu");
    expect(output.text).toContain("/remote test feishu");
    expect(output.text).toContain("Remote Doctor：enabled");
    expect(output.text).toContain("wecom: blocked");
    expect(output.text).toContain("cli_missing");
    expect(output.text).toContain("dingtalk: blocked");
    expect(output.text).toContain("webhook_missing");
    expect(output.text).toContain("Remote test 已发送：feishu");
    expect(output.text).toContain("Remote Channels：已开启");
    expect(output.text).toContain("Secrets/endpoints are redacted");
    expect(output.text).not.toContain("secret-value");

    const feishu = context.remote.channels.find((channel) => channel.id === "feishu");
    expect(feishu).toBeDefined();
    if (!feishu) throw new Error("missing feishu channel");
    const event = createRemoteEvent(
      feishu,
      "approval_request",
      "approve write token=secret-value Bearer abc123 sk-live-secret Authorization: Bearer auth-secret transcript={full} source={code} log={full} index result={full} apiKey=raw-api-key https://example.invalid/hook/full/path",
      ["evidence-ref-1"],
    );
    expect(event.expiresAt).toBeTruthy();
    expect(event.nonce).toBeTruthy();
    expect(event.messageId).toBeTruthy();
    expect(event.redactedSummary).not.toContain("secret-value");
    expect(event.redactedSummary).not.toContain("abc123");
    expect(event.redactedSummary).not.toContain("sk-live-secret");
    expect(event.redactedSummary).not.toContain("auth-secret");
    expect(event.redactedSummary).not.toContain("raw-api-key");
    expect(event.redactedSummary).not.toContain("https://example.invalid/hook/full/path");
    expect(event.redactedSummary).not.toContain("transcript={full}");
    expect(event.redactedSummary).not.toContain("source={code}");
    expect(event.redactedSummary).not.toContain("log={full}");
    expect(event.redactedSummary).not.toContain("index result={full}");

    const baseMessage = {
      eventId: event.id,
      channel: "feishu",
      messageId: event.messageId,
      nonce: event.nonce,
      source: "feishu-user-1",
      bindingUserId: "user-1",
      bindingDeviceId: "device-1",
      signature: `mock:${event.messageId}:${event.nonce}`,
      approve: true,
    };
    expect(
      processRemoteApprovalForTest(
        context,
        { ...event, expiresAt: new Date(Date.now() - 1).toISOString() },
        baseMessage,
      ),
    ).toMatchObject({ status: "expired", evidenceCreated: false });
    expect(
      processRemoteApprovalForTest(context, event, { ...baseMessage, source: "unknown" }),
    ).toMatchObject({ status: "unknown_source", evidenceCreated: false });
    expect(
      processRemoteApprovalForTest(context, event, { ...baseMessage, bindingDeviceId: "wrong" }),
    ).toMatchObject({ status: "wrong_binding", evidenceCreated: false });
    expect(
      processRemoteApprovalForTest(context, event, { ...baseMessage, signature: "bad" }),
    ).toMatchObject({ status: "bad_signature", evidenceCreated: false });
    expect(processRemoteApprovalForTest(context, event, baseMessage)).toMatchObject({
      status: "blocked",
      evidenceCreated: false,
    });
    (context as unknown as { pendingLocalApproval: unknown }).pendingLocalApproval = {
      kind: "model_tool_use",
      toolCall: { id: "call-remote", name: "Write", input: { filePath: "x", content: "y" } },
      toolName: "Write",
      sessionId: session.id,
    };
    expect(processRemoteApprovalForTest(context, event, baseMessage)).toMatchObject({
      status: "approved",
      evidenceCreated: false,
    });
    expect(
      (context as unknown as { pendingLocalApproval: unknown }).pendingLocalApproval,
    ).toBeTruthy();
    expect(processRemoteApprovalForTest(context, event, baseMessage)).toMatchObject({
      status: "replayed",
      evidenceCreated: false,
    });
    await handleSlashCommand("/remote disable feishu", context, output);
    await handleSlashCommand("/remote status", context, output);

    expect(output.text).toContain("Remote channel disabled：feishu");
    expect(output.text).toContain("feishu: disabled");
    expect(output.text).toContain("disabled_by_user");
    expect(context.remote.sessionDisabledChannelIds).toContain("feishu");
    expect(context.evidence).toEqual([]);
    expect(output.text).not.toContain("Native Runner");
    expect(output.text).not.toContain("17C");
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
    expect(output.text).toContain("默认 untrusted/disabled");
    expect(output.text).toContain("MCP validate");
    expect(output.text).toContain("disabled; untrusted");
    expect(output.text).toContain("source=present:node");
    expect(output.text).toContain("permissions=tool-discovery");
    expect(output.text).toContain("已禁用 MCP server：local-demo");
    expect(output.text).toContain("Trust notice：即将启用本地 MCP server");
    expect(output.text).toContain(
      "后续 tools/call 仍必须经过 discovery/schema/required-args 和权限管道",
    );
    expect(output.text).toContain("已启用 MCP server：local-demo");
    expect(output.text).toContain("已更新 MCP server：local-demo");
    expect(output.text).toContain("未执行 server");
    expect(output.text).toContain("已移除 MCP server：local-demo");
  });
});

describe("D.8 provider circuit breaker integration", () => {
  it("2 consecutive recoverable errors enter cooldown, 3rd check is blocked", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-breaker-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "test-model" });
    const context = await createTestContext(project, store, session);

    // First recoverable failure — no cooldown
    recordProviderFailure(context.providerBreaker, "openai", "gpt-4o", "PROVIDER_RATE_LIMITED");
    expect(checkProviderCooldown(context.providerBreaker, "openai", "gpt-4o").blocked).toBe(false);

    // Second recoverable failure — enters cooldown
    recordProviderFailure(context.providerBreaker, "openai", "gpt-4o", "PROVIDER_RATE_LIMITED");
    const check = checkProviderCooldown(context.providerBreaker, "openai", "gpt-4o");
    expect(check.blocked).toBe(true);
    if (check.blocked) {
      expect(check.remainingMs).toBeGreaterThan(0);
      expect(check.remainingMs).toBeLessThanOrEqual(45_000);
    }
  });

  it("cooldown message is human-readable with remaining time and /model doctor, no secrets", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-breaker-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "test-model" });
    const context = await createTestContext(project, store, session);

    recordProviderFailure(context.providerBreaker, "openai", "gpt-4o", "PROVIDER_SERVER_ERROR");
    recordProviderFailure(context.providerBreaker, "openai", "gpt-4o", "PROVIDER_SERVER_ERROR");

    const check = checkProviderCooldown(context.providerBreaker, "openai", "gpt-4o");
    expect(check.blocked).toBe(true);
    if (check.blocked) {
      const msg = formatCooldownMessage("openai", "gpt-4o", check.remainingMs, context.language);
      expect(msg).toContain("openai/gpt-4o");
      expect(msg).toContain("/model doctor");
      expect(msg).toContain("/model");
      expect(msg).toMatch(/\d+/); // contains remaining seconds
      expect(msg).not.toMatch(/sk-[A-Za-z0-9]/);
      expect(msg).not.toMatch(/https?:\/\//);
      expect(msg).not.toMatch(/Bearer/);
    }
  });

  it("PROVIDER_AUTH_ERROR and PROVIDER_SCHEMA_ERROR do not trigger breaker", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-breaker-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "test-model" });
    const context = await createTestContext(project, store, session);

    // Non-recoverable errors should not accumulate
    recordProviderFailure(context.providerBreaker, "openai", "gpt-4o", "PROVIDER_AUTH_ERROR");
    recordProviderFailure(context.providerBreaker, "openai", "gpt-4o", "PROVIDER_AUTH_ERROR");
    recordProviderFailure(context.providerBreaker, "openai", "gpt-4o", "PROVIDER_SCHEMA_ERROR");
    recordProviderFailure(context.providerBreaker, "openai", "gpt-4o", "PROVIDER_BAD_REQUEST");
    recordProviderFailure(context.providerBreaker, "openai", "gpt-4o", "ABORT");

    expect(checkProviderCooldown(context.providerBreaker, "openai", "gpt-4o").blocked).toBe(false);
    expect(context.providerBreaker.entries.size).toBe(0);
  });

  it("one successful request clears failure count", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-breaker-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "test-model" });
    const context = await createTestContext(project, store, session);

    // Accumulate 1 failure
    recordProviderFailure(context.providerBreaker, "openai", "gpt-4o", "PROVIDER_SERVER_ERROR");
    expect(context.providerBreaker.entries.has("openai::gpt-4o")).toBe(true);

    // Simulate successful request clearing the breaker
    clearProviderBreaker(context.providerBreaker, "openai", "gpt-4o");
    expect(context.providerBreaker.entries.has("openai::gpt-4o")).toBe(false);

    // Next failure starts fresh — 1 failure alone does not trigger cooldown
    recordProviderFailure(context.providerBreaker, "openai", "gpt-4o", "PROVIDER_SERVER_ERROR");
    expect(checkProviderCooldown(context.providerBreaker, "openai", "gpt-4o").blocked).toBe(false);
  });

  it("different provider/model combinations do not affect each other", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-breaker-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "test-model" });
    const context = await createTestContext(project, store, session);

    // Provider A enters cooldown
    recordProviderFailure(context.providerBreaker, "openai", "gpt-4o", "PROVIDER_RATE_LIMITED");
    recordProviderFailure(context.providerBreaker, "openai", "gpt-4o", "PROVIDER_RATE_LIMITED");
    expect(checkProviderCooldown(context.providerBreaker, "openai", "gpt-4o").blocked).toBe(true);

    // Provider B is unaffected
    expect(checkProviderCooldown(context.providerBreaker, "anthropic", "claude-3").blocked).toBe(
      false,
    );

    // Same provider, different model is unaffected
    expect(checkProviderCooldown(context.providerBreaker, "openai", "gpt-3.5").blocked).toBe(false);

    // Provider B accumulates independently
    recordProviderFailure(
      context.providerBreaker,
      "anthropic",
      "claude-3",
      "PROVIDER_NETWORK_ERROR",
    );
    expect(checkProviderCooldown(context.providerBreaker, "anthropic", "claude-3").blocked).toBe(
      false,
    );
  });
});

describe("Slice D.9: Long Task / Runner Resilience Closure", () => {
  it("autopilot/job/background enter existing start gate and permission path, not a second system", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-d9-autopilot-gate-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session);
    context.index.status = "ready";
    context.index.projectName = "F-Linghun";
    context.evidence = [
      {
        id: "ev-d9-gate",
        kind: "test_result",
        summary: "D9 gate evidence",
        source: "vitest",
        supportsClaims: ["d9-gate"],
        createdAt: new Date().toISOString(),
      },
    ];
    const output = new MemoryOutput();

    // /autopilot sets pending state, does NOT immediately start a job
    await handleSlashCommand(
      "/autopilot d9 long task gate test --steps 1 --tokens 50000",
      context,
      output,
    );
    expect(context.pendingAutopilot).toBeTruthy();
    expect(context.backgroundTasks.filter((task) => task.kind === "job")).toHaveLength(0);

    // /esc cancels pending autopilot without starting job
    await handleSlashCommand("/esc", context, output);
    expect(context.pendingAutopilot).toBeUndefined();
    expect(context.backgroundTasks.filter((task) => task.kind === "job")).toHaveLength(0);
    expect(output.text).toContain("已取消持续推进确认");
  });

  it("runner completed does not equal verification PASS in job background task", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-d9-runner-nonpass-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const config: LinghunConfig = {
      ...defaultConfig,
      storage: { ...defaultConfig.storage, jobs: { scope: "project" } },
    };
    const context = await createTestContext(project, store, session, config);
    context.index.status = "ready";
    context.index.projectName = "F-Linghun";
    context.lastVerification = createVerificationReportFixture("partial");
    context.evidence = [
      {
        id: "ev-d9-nonpass",
        kind: "test_result",
        summary: "D9 non-pass evidence",
        source: "vitest",
        supportsClaims: ["d9-nonpass"],
        createdAt: new Date().toISOString(),
      },
    ];
    const output = new MemoryOutput();

    await handleSlashCommand(
      "/job run d9 runner completed is not pass --tokens 50000",
      context,
      output,
    );
    const jobId = context.backgroundTasks.find((task) => task.kind === "job")?.id;
    expect(jobId).toBeTruthy();

    // Cancel the job
    await handleSlashCommand(`/job cancel ${jobId}`, context, output);

    // Verify cancelled job is never marked as pass
    expect(context.backgroundTasks).not.toContainEqual(expect.objectContaining({ result: "pass" }));
    expect(output.text).toContain(
      "completed/cancelled/timeout/stale/blocked never equals verification PASS",
    );
  });

  it("timeout does not produce PASS evidence in durable job", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-d9-timeout-nonpass-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const config: LinghunConfig = {
      ...defaultConfig,
      storage: { ...defaultConfig.storage, jobs: { scope: "project" } },
    };
    const context = await createTestContext(project, store, session, config);
    context.index.status = "ready";
    context.index.projectName = "F-Linghun";
    context.lastVerification = createVerificationReportFixture("partial");
    context.evidence = [
      {
        id: "ev-d9-timeout",
        kind: "test_result",
        summary: "D9 timeout evidence",
        source: "vitest",
        supportsClaims: ["d9-timeout"],
        createdAt: new Date().toISOString(),
      },
    ];
    const output = new MemoryOutput();

    // Create a job with very short max-runtime
    await handleSlashCommand(
      "/job create d9 timeout worker --max-runtime-ms 1 --tokens 50000",
      context,
      output,
    );
    const jobId = context.backgroundTasks.find((task) => task.kind === "job")?.id;
    expect(jobId).toBeTruthy();

    // Simulate timeout by manipulating state
    const statePath = join(
      resolveStoragePaths(config, project).jobs,
      jobId ?? "missing",
      "state.json",
    );
    const seed = JSON.parse(await readFile(statePath, "utf8")) as Record<string, unknown>;
    seed.startedAt = new Date(Date.now() - 60_000).toISOString();
    await writeFile(statePath, `${JSON.stringify(seed, null, 2)}\n`, "utf8");

    await handleSlashCommand(`/job resume ${jobId}`, context, new MemoryOutput());
    const state = JSON.parse(await readFile(statePath, "utf8")) as {
      status: string;
      pauseReason?: string;
      result?: { status: string; summary?: string };
    };

    expect(state.status).toBe("timeout");
    expect(state.pauseReason).toContain("timeout");
    expect(state.result?.status).toBe("timeout");
    expect(state.result?.summary).toContain("no PASS evidence");
    expect(context.backgroundTasks).not.toContainEqual(expect.objectContaining({ result: "pass" }));
  });

  it("Windows mock runner cancel/timeout cleanup path sends stop command to runner", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-d9-win-cleanup-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const mockRunner = await createMockNativeRunner(project);
    const config: LinghunConfig = {
      ...defaultConfig,
      storage: { ...defaultConfig.storage, jobs: { scope: "project" } },
      nativeRunner: {
        ...defaultConfig.nativeRunner,
        enabled: true,
        source: "custom",
        path: mockRunner.path,
        timeoutMs: 200,
      },
    };
    const context = await createTestContext(project, store, session, config);
    context.index.status = "ready";
    context.index.projectName = "F-Linghun";
    context.lastVerification = createVerificationReportFixture("partial");
    context.evidence = [
      {
        id: "ev-d9-win-cleanup",
        kind: "test_result",
        summary: "D9 Windows cleanup evidence",
        source: "vitest",
        supportsClaims: ["d9-win-cleanup"],
        createdAt: new Date().toISOString(),
      },
    ];
    const output = new MemoryOutput();

    await handleSlashCommand(
      "/job run d9 windows cleanup test --tokens 50000 --timeout 200",
      context,
      output,
    );
    const jobId = context.backgroundTasks.find((task) => task.kind === "job")?.id;
    expect(jobId).toBeTruthy();

    // Cancel the job — this exercises the runner stop path
    await handleSlashCommand(`/job cancel ${jobId}`, context, output);

    // Verify runner is marked cancelled, not pass
    const statePath = join(
      resolveStoragePaths(config, project).jobs,
      jobId ?? "missing",
      "state.json",
    );
    const state = JSON.parse(await readFile(statePath, "utf8")) as {
      status: string;
      runner?: { status?: string };
    };
    expect(state.status).toBe("cancelled");
    expect(state.runner?.status).toBe("cancelled");
    expect(context.backgroundTasks).not.toContainEqual(expect.objectContaining({ result: "pass" }));

    // Verify mock runner received stop command (runner is responsible for process cleanup)
    const calls = await readMockNativeRunnerCalls(mockRunner.callsPath);
    const stopCall = calls.find((call) => call.argv[0] === "stop");
    expect(stopCall).toBeTruthy();
  });

  it("task activity view displays continuing/tool_running/permission_waiting/error phases", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-d9-activity-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session);
    const output = new MemoryOutput();

    // Verify all RequestActivityPhase values produce human-readable output
    const { formatRequestActivity } = await import("./request-lifecycle-presenter.js");
    const phases = [
      "request_started",
      "waiting_first_delta",
      "tool_running",
      "continuing_after_tool",
      "permission_waiting",
    ] as const;

    for (const phase of phases) {
      const zhText = formatRequestActivity(phase, "zh-CN", { toolName: "Bash" });
      const enText = formatRequestActivity(phase, "en-US", { toolName: "Bash" });
      expect(zhText.length).toBeGreaterThan(0);
      expect(enText.length).toBeGreaterThan(0);
      // Ensure no raw internal identifiers leak
      expect(zhText).not.toContain("undefined");
      expect(enText).not.toContain("undefined");
    }

    // Verify tool_running shows tool name
    const toolRunning = formatRequestActivity("tool_running", "zh-CN", { toolName: "Bash" });
    expect(toolRunning).toContain("Bash");

    // Verify permission_waiting is human-readable
    const permWaiting = formatRequestActivity("permission_waiting", "zh-CN");
    expect(permWaiting).toContain("等待");

    // Verify continuing_after_tool is human-readable
    const continuing = formatRequestActivity("continuing_after_tool", "zh-CN");
    expect(continuing).toContain("继续");
  });

  it("runner ready uses runner; runner missing falls back with user-understandable message", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-d9-fallback-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const mockRunner = await createMockNativeRunner(project);
    const config: LinghunConfig = {
      ...defaultConfig,
      storage: { ...defaultConfig.storage, jobs: { scope: "project" } },
      nativeRunner: {
        ...defaultConfig.nativeRunner,
        enabled: true,
        source: "custom",
        path: mockRunner.path,
        timeoutMs: 60_000,
      },
    };
    const context = await createTestContext(project, store, session, config);
    context.index.status = "ready";
    context.index.projectName = "F-Linghun";
    context.lastVerification = createVerificationReportFixture("partial");
    context.evidence = [
      {
        id: "ev-d9-fallback",
        kind: "test_result",
        summary: "D9 fallback evidence",
        source: "vitest",
        supportsClaims: ["d9-fallback"],
        createdAt: new Date().toISOString(),
      },
    ];
    const output = new MemoryOutput();

    // Runner available — job should use native runner or node fallback
    await handleSlashCommand("/job run d9 runner available test --tokens 50000", context, output);
    const jobId = context.backgroundTasks.find((task) => task.kind === "job")?.id;
    expect(jobId).toBeTruthy();
    const statePath = join(
      resolveStoragePaths(config, project).jobs,
      jobId ?? "missing",
      "state.json",
    );
    const state = JSON.parse(await readFile(statePath, "utf8")) as {
      runner?: { adapter?: string; resolution?: string };
    };
    expect(state.runner?.adapter).toBe("native");
    expect(state.runner?.resolution).toBe("available");

    // Now test missing runner fallback
    const missingProject = await mkdtemp(join(tmpdir(), "linghun-d9-missing-runner-"));
    const missingConfig: LinghunConfig = {
      ...defaultConfig,
      storage: { ...defaultConfig.storage, jobs: { scope: "project" } },
      nativeRunner: {
        ...defaultConfig.nativeRunner,
        enabled: true,
        source: "custom",
        path: join(missingProject, "nonexistent-runner.cjs"),
        timeoutMs: 60_000,
      },
    };
    const missingStore = new SessionStore({
      sessionRootDir: getSessionRootDir(),
      projectPath: missingProject,
    });
    const missingSession = await missingStore.create({ model: "deepseek-v4-flash" });
    const missingContext = await createTestContext(
      missingProject,
      missingStore,
      missingSession,
      missingConfig,
    );
    missingContext.index.status = "ready";
    missingContext.index.projectName = "F-Linghun";
    missingContext.lastVerification = createVerificationReportFixture("partial");
    missingContext.evidence = [...context.evidence];

    await handleSlashCommand(
      "/job run d9 runner missing fallback --tokens 50000",
      missingContext,
      output,
    );
    const missingJobId = missingContext.backgroundTasks.find((task) => task.kind === "job")?.id;
    expect(missingJobId).toBeTruthy();
    const missingStatePath = join(
      resolveStoragePaths(missingConfig, missingProject).jobs,
      missingJobId ?? "missing",
      "state.json",
    );
    const missingState = JSON.parse(await readFile(missingStatePath, "utf8")) as {
      runner?: { adapter?: string; resolution?: string; fallbackReason?: string };
    };
    // Runner should fallback to node
    expect(missingState.runner?.adapter).toBe("node");
    expect(missingState.runner?.resolution).toBe("unavailable");
    expect(missingState.runner?.fallbackReason).toBeTruthy();
    // Background task should not claim pass
    expect(missingContext.backgroundTasks).not.toContainEqual(
      expect.objectContaining({ result: "pass" }),
    );
  });

  it("stale job recovery marks runner terminal and does not produce PASS", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-d9-stale-recovery-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const config: LinghunConfig = {
      ...defaultConfig,
      storage: { ...defaultConfig.storage, jobs: { scope: "project" } },
    };
    const context = await createTestContext(project, store, session, config);
    context.index.status = "ready";
    context.index.projectName = "F-Linghun";
    context.lastVerification = createVerificationReportFixture("partial");
    context.evidence = [
      {
        id: "ev-d9-stale",
        kind: "test_result",
        summary: "D9 stale evidence",
        source: "vitest",
        supportsClaims: ["d9-stale"],
        createdAt: new Date().toISOString(),
      },
    ];
    const output = new MemoryOutput();

    // Create a job
    await handleSlashCommand("/job run d9 stale recovery test --tokens 50000", context, output);
    const jobId = context.backgroundTasks.find((task) => task.kind === "job")?.id;
    expect(jobId).toBeTruthy();

    // Simulate stale by removing heartbeat and owner info from state
    const statePath = join(
      resolveStoragePaths(config, project).jobs,
      jobId ?? "missing",
      "state.json",
    );
    const seed = JSON.parse(await readFile(statePath, "utf8")) as Record<string, unknown>;
    seed.ownerSessionId = undefined;
    seed.ownerPid = undefined;
    seed.heartbeatAt = undefined;
    seed.status = "running";
    await writeFile(statePath, `${JSON.stringify(seed, null, 2)}\n`, "utf8");

    // Hydrate in a fresh context — should detect stale
    const freshStore = new SessionStore({
      sessionRootDir: getSessionRootDir(),
      projectPath: project,
    });
    const freshSession = await freshStore.create({ model: "deepseek-v4-flash" });
    const freshContext = await createTestContext(project, freshStore, freshSession, config);
    freshContext.index.status = "ready";
    freshContext.index.projectName = "F-Linghun";

    await handleSlashCommand("/job list", freshContext, output);

    // Verify the job was recovered as stale
    const recoveredState = JSON.parse(await readFile(statePath, "utf8")) as {
      status: string;
      result?: { status: string; summary?: string };
    };
    expect(recoveredState.status).toBe("stale");
    expect(recoveredState.result?.status).toBe("stale");
    expect(recoveredState.result?.summary).toContain("no PASS evidence");
    expect(freshContext.backgroundTasks).not.toContainEqual(
      expect.objectContaining({ result: "pass" }),
    );
  });
});

// ─── D.13E Step 2 修正 #4 — addAllowRule helper 覆盖 ───────────────────────
//   1. 已存在等价 allow 规则 → duplicate（不重复落盘，rules.length 不变）
//   2. savePermissionState 抛错 → save_failed（内存中的 push 已回滚）
//   3. 正常路径 → added（rules 包含新规则；message 含 "已添加"）
// 这里直接打 addAllowRuleForTest（来自 ./index.js 测试导出），避免误把
// /permissions add allow 当成 helper 单测的代理路径。
describe("D.13E Step 2 — addAllowRule helper", () => {
  it("returns duplicate when an equivalent allow rule already exists", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    // 通过 /permissions add allow 落第一条规则；helper 同源，应去重不再 push
    await handleSlashCommand("/permissions add allow Bash high", context, output);
    const baseline = context.permissions.rules.length;
    expect(baseline).toBeGreaterThanOrEqual(1);

    const result = await addAllowRuleForTest(context, "Bash", "high");
    expect(result.kind).toBe("duplicate");
    if (result.kind === "duplicate") {
      expect(result.message).toContain("已存在等价 allow 规则");
    }
    expect(context.permissions.rules.length).toBe(baseline);
  });

  it("rolls back the in-memory push when savePermissionState throws (save_failed)", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session);

    // 把 storage 设为只读触发 savePermissionState 抛错（Windows 上 chmod 0o444
    // 不一定生效，所以用一个不存在的 projectPath 让 mkdir/write 失败）。
    context.projectPath = join(tmpdir(), "linghun-nonexistent", "\0invalid-path-segment");
    const baseline = context.permissions.rules.length;

    const result = await addAllowRuleForTest(context, "Write", "medium");
    expect(result.kind).toBe("save_failed");
    // 关键不变量：内存中的 rules 不能因失败而保留半状态。
    expect(context.permissions.rules.length).toBe(baseline);
  });

  it("adds and persists the rule on success (added)", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session);

    const baseline = context.permissions.rules.length;
    const result = await addAllowRuleForTest(context, "Edit", "low");
    expect(result.kind).toBe("added");
    expect(context.permissions.rules.length).toBe(baseline + 1);
    if (result.kind === "added") {
      expect(result.rule.effect).toBe("allow");
      expect(result.rule.toolName).toBe("Edit");
      expect(result.rule.risk).toBe("low");
      expect(result.message).toContain("已添加权限规则");
    }
  });
});

// ─── D.13E Step 2 修正 #4 — /permissions add allow 路径覆盖 ────────────────
// `/permissions add allow` 已通过 addAllowRule helper 实现去重；旧的"两次相同
// 命令落两条规则"行为已收紧为去重，覆盖一次新行为防回归。
describe("D.13E Step 2 — /permissions add allow dedup via addAllowRule", () => {
  it("does not duplicate when same allow rule is added twice via slash command", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    await handleSlashCommand("/permissions add allow Bash high", context, output);
    const afterFirst = context.permissions.rules.length;
    expect(afterFirst).toBeGreaterThanOrEqual(1);

    output.text = "";
    await handleSlashCommand("/permissions add allow Bash high", context, output);
    expect(context.permissions.rules.length).toBe(afterFirst);
    expect(output.text).toContain("已存在等价 allow 规则");
  });

  it("returns invalid for unknown tool name without mutating rules", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session);

    const baseline = context.permissions.rules.length;
    const result = await addAllowRuleForTest(context, "TotallyNotARealTool" as never, "medium");
    expect(result.kind).toBe("invalid");
    expect(context.permissions.rules.length).toBe(baseline);
  });

  // D.13E Step 2 修正 #5（去重语义统一）：
  // PermissionElevationModel.hasExistingAllowRule 把"已有 allow <tool> 且 risk
  // 为空"视为可覆盖任意 risk（umbrella allow）。addAllowRule 之前只做精确
  // (effect+toolName+risk) 三元组比较，会让 add allow Bash 之后再 add allow
  // Bash high 落两条规则；与 buildElevationOptions 隐藏 allow_always_tool 的
  // 判断不一致。修正后两侧语义一致：umbrella allow 覆盖具体 risk → duplicate。
  it("treats an umbrella allow rule (risk=undefined) as duplicate for any specific risk", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session);

    // 先落一条 umbrella allow Bash（risk 为空）。
    const umbrella = await addAllowRuleForTest(context, "Bash", undefined);
    expect(umbrella.kind).toBe("added");
    const baseline = context.permissions.rules.length;

    // 再 add allow Bash high / medium / low 都应去重，rules.length 不变。
    for (const risk of ["high", "medium", "low"] as const) {
      const result = await addAllowRuleForTest(context, "Bash", risk);
      expect(result.kind).toBe("duplicate");
      if (result.kind === "duplicate") {
        expect(result.rule.toolName).toBe("Bash");
        // umbrella 规则 risk 为空
        expect(result.rule.risk).toBeUndefined();
      }
      expect(context.permissions.rules.length).toBe(baseline);
    }
  });
});

// ─── D.13I — Self-built deferred tools dispatch ─────────────────────────────
// SearchExtraTools / ExecuteExtraTool 是 Linghun 自研 deferred 调用层，模型必须先
// discover 再 execute；不发 Anthropic defer_loading / tool_reference / anthropic-beta；
// 不新建 runner；执行分层：
//   - codebase-memory：白名单 10 个工具，可执行
//   - MCP server tools：discover-only（无通用 adapter）
//   - skills/plugins：discover-only（无安全 adapter）
// ----------------------------------------------------------------------------
describe("D.13I — Self-built deferred tools dispatch", () => {
  it("D.13I discovery: snapshotDeferredTools returns codebase-memory whitelist + sanitized fields (no raw schema/secret)", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session);

    const snapshot = snapshotDeferredTools(context);
    // codebase-memory whitelist 必须出现
    expect(snapshot.byKind["codebase-memory"]).toBeGreaterThanOrEqual(10);
    expect(snapshot.executableCount).toBe(snapshot.byKind["codebase-memory"]);

    // 任何 descriptor 不得泄露 raw schema / api_key / Bearer 等敏感字段
    const json = JSON.stringify(snapshot);
    expect(json).not.toContain("apiKey");
    expect(json).not.toContain("api_key");
    expect(json).not.toContain("Bearer ");
    expect(json).not.toContain("input_schema");
    expect(json).not.toContain("inputSchema");

    // 每个 descriptor 仅暴露 name/kind/description/requiredArgs/executable/reason
    for (const tool of snapshot.tools) {
      expect(Object.keys(tool).sort()).toEqual(
        ["description", "executable", "kind", "name", "reason", "requiredArgs"].sort(),
      );
    }

    const summary = snapshotDeferredToolsSummary(context);
    expect(summary.total).toBe(snapshot.total);
    expect(summary.byKind).toEqual(snapshot.byKind);
    expect(summary.executableCount).toBe(snapshot.executableCount);

    // SearchExtraTools(query) 仅过滤；空 query 返回全部
    const all = executeSearchExtraTools("", context);
    expect(all.ok).toBe(true);
    expect(all.data.total).toBeGreaterThanOrEqual(snapshot.byKind["codebase-memory"]);

    const filtered = executeSearchExtraTools("trace_path", context);
    expect(filtered.ok).toBe(true);
    expect(filtered.data.matches.some((m) => m.name === "trace_path")).toBe(true);
  });

  it("D.13J Block 2 sanitizeDiscoveredDeferredToolName 仅保留安全字符，超长截断", () => {
    expect(sanitizeDiscoveredDeferredToolName("list_projects")).toBe("list_projects");
    expect(sanitizeDiscoveredDeferredToolName("mcp__server__action")).toBe("mcp__server__action");
    expect(sanitizeDiscoveredDeferredToolName("server:tool-1.2")).toBe("server:tool-1.2");
    // 控制字符 / 引号 / 反斜杠都换成下划线
    expect(sanitizeDiscoveredDeferredToolName("evil\\name'with\"chars\n")).toBe(
      "evil_name_with_chars_",
    );
    // 长度上限 80：第 81 个字符触发截断
    const longName = "a".repeat(120);
    const sanitized = sanitizeDiscoveredDeferredToolName(longName);
    expect(sanitized.length).toBeLessThanOrEqual(82); // 80 + 1 ellipsis 字符（"…" 占 1 个 JS char）
    expect(sanitized.endsWith("…")).toBe(true);
  });

  it("D.13J Block 2 snapshotDiscoveredDeferredToolsSummary 排序、上限 32、截断标记", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session);

    // 0 项时
    const empty = snapshotDiscoveredDeferredToolsSummary(context);
    expect(empty.total).toBe(0);
    expect(empty.names).toEqual([]);
    expect(empty.truncated).toBe(false);

    // 注入若干工具名（直接操作 Set，不走 SearchExtraTools，避免依赖具体白名单工具）
    for (let i = 0; i < 5; i++) {
      context.discoveredDeferredToolNames.add(`zeta_${i}`);
    }
    context.discoveredDeferredToolNames.add("alpha_tool");
    const small = snapshotDiscoveredDeferredToolsSummary(context);
    expect(small.total).toBe(6);
    // 字典序排序：alpha_tool 必须排第一
    expect(small.names[0]).toBe("alpha_tool");
    expect(small.truncated).toBe(false);

    // 注入 40 项触发上限 32 + truncated=true
    for (let i = 0; i < 40; i++) {
      context.discoveredDeferredToolNames.add(`gen_${i.toString().padStart(2, "0")}`);
    }
    const big = snapshotDiscoveredDeferredToolsSummary(context);
    expect(big.total).toBeGreaterThanOrEqual(40);
    expect(big.names.length).toBe(32);
    expect(big.truncated).toBe(true);
  });

  it("D.13I rejection: ExecuteExtraTool rejects undiscovered tool names", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session);

    // 即使先跑过 SearchExtraTools 但 query 没匹配，目标名也不会被记入 Set。
    executeSearchExtraTools("totally_made_up", context);
    const result = await executeExtraTool(
      { tool_name: "totally_made_up_tool", params: { whatever: 1 } },
      context,
    );
    expect(result.ok).toBe(false);
    expect(result.text).toContain("totally_made_up_tool");
    expect(result.text).toContain("SearchExtraTools");

    // 空/非字符串 tool_name 也必须拒绝
    const blank = await executeExtraTool({ tool_name: "" }, context);
    expect(blank.ok).toBe(false);
    const wrongType = await executeExtraTool({ tool_name: 42 as unknown as string }, context);
    expect(wrongType.ok).toBe(false);
  });

  it("D.13I gating: ExecuteExtraTool rejects whitelisted tool when SearchExtraTools 未跑过 (Set 为空)", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session);

    // list_projects 在白名单里、executable=true，但本 session 还没 SearchExtraTools。
    expect(context.discoveredDeferredToolNames.size).toBe(0);
    const tool = findDeferredTool("list_projects", listDeferredTools(context));
    expect(tool?.executable).toBe(true);

    const result = await executeExtraTool({ tool_name: "list_projects", params: {} }, context);
    expect(result.ok).toBe(false);
    expect(result.text).toContain("SearchExtraTools");
    expect(result.text).toContain("list_projects");
  });

  it("D.13I gating: search-with-no-match 不写 Set；search-then-execute 才放行", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    const mockDir = join(project, "mock");
    await mkdir(mockDir, { recursive: true });
    const { mockPath } = await createMockCodebaseMemoryBinary(project, mockDir);
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        defaultModel: "deepseek-v4-flash",
        index: { codebaseMemoryBinary: mockPath },
      }),
      "utf8",
    );
    const config = await loadConfig(project);
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session, config);

    // 1) search 没匹配 → Set 空 → execute 拒绝
    const noMatch = executeSearchExtraTools("absolutely-nope-no-such-tool", context);
    expect(noMatch.ok).toBe(true);
    expect(noMatch.data.total).toBe(0);
    expect(context.discoveredDeferredToolNames.has("list_projects")).toBe(false);

    const blocked = await executeExtraTool({ tool_name: "list_projects", params: {} }, context);
    expect(blocked.ok).toBe(false);
    expect(blocked.text).toContain("SearchExtraTools");

    // 2) search 命中 → Set 含 list_projects → execute 放行
    const hit = executeSearchExtraTools("list_projects", context);
    expect(hit.ok).toBe(true);
    expect(hit.data.matches.some((m) => m.name === "list_projects")).toBe(true);
    expect(context.discoveredDeferredToolNames.has("list_projects")).toBe(true);

    const allowed = await executeExtraTool({ tool_name: "list_projects", params: {} }, context);
    expect(allowed.ok).toBe(true);
  });

  it("D.13I rejection: ExecuteExtraTool rejects codebase-memory call with missing required args (re-uses validateCodebaseMemoryToolExecution)", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session);

    // get_code_snippet 需要 project + qualified_name；缺 qualified_name
    const tool = findDeferredTool("get_code_snippet", listDeferredTools(context));
    expect(tool).toBeTruthy();
    expect(tool?.executable).toBe(true);

    // D.13I tail fix — 必须先 SearchExtraTools 让 Set 记录该名字，否则会被 gating 提前拦截。
    executeSearchExtraTools("get_code_snippet", context);

    const result = await executeExtraTool(
      { tool_name: "get_code_snippet", params: { project: "test" } },
      context,
    );
    expect(result.ok).toBe(false);
    expect(result.text).toContain("required args");
    expect(result.text).toContain("qualified_name");
  });

  it("D.13I execution: codebase-memory tool dispatches through runCodebaseMemoryCli (existing chain) and returns ok with data", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    const mockDir = join(project, "mock");
    await mkdir(mockDir, { recursive: true });
    const { mockPath } = await createMockCodebaseMemoryBinary(project, mockDir);
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        defaultModel: "deepseek-v4-flash",
        index: { codebaseMemoryBinary: mockPath },
      }),
      "utf8",
    );

    const config = await loadConfig(project);
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session, config);

    // D.13I tail fix — 必须先 SearchExtraTools 让 Set 记录 list_projects。
    executeSearchExtraTools("list_projects", context);

    const result = await executeExtraTool(
      { tool_name: "list_projects", params: {} },
      context,
    );
    expect(result.ok).toBe(true);
    expect(result.text).toContain("list_projects");
  });

  it("D.13I execution layering: skill/plugin/MCP entries are discoverable but not blindly executable", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session);

    // 模拟 enabled+trusted 的 skill / plugin / MCP 工具发现
    context.skills.enabled = true;
    context.skills.skills = [
      {
        id: "test-skill",
        name: "Test Skill",
        description: "A test skill manifest",
        version: "0.0.0",
        path: "/tmp/skill",
        scope: "project",
        autoExecute: false,
      } as unknown as (typeof context.skills.skills)[number],
    ];
    context.skills.trustedIds = ["test-skill"];
    context.skills.disabledIds = [];

    context.plugins.enabled = true;
    context.plugins.plugins = [
      {
        id: "test-plugin",
        name: "Test Plugin",
        description: "A test plugin manifest",
        version: "0.0.0",
        path: "/tmp/plugin",
        scope: "project",
      } as unknown as (typeof context.plugins.plugins)[number],
    ];
    context.plugins.trustedIds = ["test-plugin"];
    context.plugins.disabledIds = [];

    context.mcp.enabled = true;
    context.mcp.servers = [
      {
        name: "fake-mcp",
        status: "ready",
      } as unknown as (typeof context.mcp.servers)[number],
    ];
    context.mcp.tools = [
      {
        server: "fake-mcp",
        name: "fake_tool",
        description: "fake tool",
        discovery: "discovered",
        schemaLoaded: true,
        trusted: true,
      } as unknown as (typeof context.mcp.tools)[number],
    ];

    const tools = listDeferredTools(context);
    const skill = tools.find((t) => t.name === "skill:test-skill");
    const plugin = tools.find((t) => t.name === "plugin:test-plugin");
    const mcp = tools.find((t) => t.name === "mcp:fake-mcp:fake_tool");
    expect(skill).toBeTruthy();
    expect(plugin).toBeTruthy();
    expect(mcp).toBeTruthy();

    // 三类必须都是 executable=false
    expect(skill?.executable).toBe(false);
    expect(plugin?.executable).toBe(false);
    expect(mcp?.executable).toBe(false);

    // 先通过 SearchExtraTools 把这三个名字写入 discoveredDeferredToolNames，
    // 这样 ExecuteExtraTool 才能穿过 Set gating 走到 executable=false 分支。
    executeSearchExtraTools("skill:test-skill", context);
    executeSearchExtraTools("plugin:test-plugin", context);
    executeSearchExtraTools("mcp:fake-mcp:fake_tool", context);

    // ExecuteExtraTool 必须拒绝（适配器不存在）
    const skillResult = await executeExtraTool({ tool_name: "skill:test-skill" }, context);
    expect(skillResult.ok).toBe(false);
    expect(skillResult.text).toContain("没有安全执行适配器");

    const pluginResult = await executeExtraTool({ tool_name: "plugin:test-plugin" }, context);
    expect(pluginResult.ok).toBe(false);
    expect(pluginResult.text).toContain("没有安全执行适配器");

    const mcpResult = await executeExtraTool(
      { tool_name: "mcp:fake-mcp:fake_tool", params: {} },
      context,
    );
    expect(mcpResult.ok).toBe(false);
    expect(mcpResult.text).toContain("没有安全执行适配器");
  });

  it("D.13I claude path 真 3 轮：Search → Execute(codebase-memory) → text，全程 /v1/messages，dispatcher 真正穿过 Set gating + tool_result 回灌", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(join(project, "package.json"), JSON.stringify({ name: "demo" }), "utf8");
    const mockDir = join(project, "mock");
    await mkdir(mockDir, { recursive: true });
    const { mockPath } = await createMockCodebaseMemoryBinary(project, mockDir);
    vi.stubEnv("LINGHUN_OPENAI_BASE_URL", "https://relay.example.com/v1");
    vi.stubEnv("LINGHUN_OPENAI_API_KEY", "sk-test");
    vi.stubEnv("LINGHUN_OPENAI_MODEL", "claude-3-5-sonnet-latest");
    vi.stubEnv("LINGHUN_OPENAI_ENDPOINT_PROFILE", "chat_completions");
    vi.stubEnv("LINGHUN_DEFAULT_MODEL", "claude-3-5-sonnet-latest");
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        defaultModel: "claude-3-5-sonnet-latest",
        index: { codebaseMemoryBinary: mockPath },
        providers: {
          deepseek: { model: "different-model" },
          "openai-compatible": {
            baseUrl: "https://relay.example.com/v1",
            apiKey: "sk-test",
            model: "claude-3-5-sonnet-latest",
            endpointProfile: "chat_completions",
          },
        },
      }),
      "utf8",
    );

    const requests: Array<{
      url: string;
      body: { messages?: Array<{ role: string; content: unknown }>; tools?: unknown };
    }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as {
          messages?: Array<{ role: string; content: unknown }>;
          tools?: unknown;
        };
        requests.push({ url: String(url), body });
        const encoder = new TextEncoder();
        if (requests.length === 1) {
          // 第 1 轮：模型请求 SearchExtraTools(query="list_projects")
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":10}}}\n\n',
                ),
              );
              controller.enqueue(
                encoder.encode(
                  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_search_1","name":"SearchExtraTools"}}\n\n',
                ),
              );
              controller.enqueue(
                encoder.encode(
                  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"query\\":\\"list_projects\\"}"}}\n\n',
                ),
              );
              controller.enqueue(
                encoder.encode(
                  'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
                ),
              );
              controller.enqueue(
                encoder.encode(
                  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":5}}\n\n',
                ),
              );
              controller.enqueue(
                encoder.encode('event: message_stop\ndata: {"type":"message_stop"}\n\n'),
              );
              controller.close();
            },
          });
          return new Response(stream, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          });
        }
        if (requests.length === 2) {
          // 第 2 轮：模型请求 ExecuteExtraTool(tool_name="list_projects", params={})
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_2","usage":{"input_tokens":20}}}\n\n',
                ),
              );
              controller.enqueue(
                encoder.encode(
                  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_exec_1","name":"ExecuteExtraTool"}}\n\n',
                ),
              );
              controller.enqueue(
                encoder.encode(
                  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"tool_name\\":\\"list_projects\\",\\"params\\":{}}"}}\n\n',
                ),
              );
              controller.enqueue(
                encoder.encode(
                  'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
                ),
              );
              controller.enqueue(
                encoder.encode(
                  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":8}}\n\n',
                ),
              );
              controller.enqueue(
                encoder.encode('event: message_stop\ndata: {"type":"message_stop"}\n\n'),
              );
              controller.close();
            },
          });
          return new Response(stream, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          });
        }
        // 第 3 轮：text_delta 收尾
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_3","usage":{"input_tokens":30}}}\n\n',
              ),
            );
            controller.enqueue(
              encoder.encode(
                'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}\n\n',
              ),
            );
            controller.enqueue(
              encoder.encode(
                'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"已通过 ExecuteExtraTool 拿到 list_projects 结果，结束。"}}\n\n',
              ),
            );
            controller.enqueue(
              encoder.encode(
                'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
              ),
            );
            controller.enqueue(
              encoder.encode(
                'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":12}}\n\n',
              ),
            );
            controller.enqueue(
              encoder.encode('event: message_stop\ndata: {"type":"message_stop"}\n\n'),
            );
            controller.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }),
    );
    const output = new MemoryOutput();
    await runTui({
      projectPath: project,
      stdin: Readable.from([
        "帮我分析一下这个项目 看看怎么部署 把分析记在心里\nyes\nyes\n/exit\n",
      ]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    // 严格 3 轮请求，全部走 /v1/messages，不得分流到 /chat/completions
    expect(requests.length).toBe(3);
    for (const req of requests) {
      expect(req.url).toBe("https://relay.example.com/v1/messages");
      expect(req.url.endsWith("/chat/completions")).toBe(false);
    }

    // tools schema 必须 Anthropic input_schema 形态，含 SearchExtraTools / ExecuteExtraTool
    const firstTools =
      (requests[0].body.tools as Array<{
        name?: string;
        function?: unknown;
        input_schema?: unknown;
      }>) ?? [];
    expect(firstTools.length).toBeGreaterThan(0);
    expect(firstTools[0].function).toBeUndefined();
    expect(firstTools[0].input_schema).toBeDefined();
    const names = firstTools.map((t) => t.name ?? "");
    expect(names).toContain("SearchExtraTools");
    expect(names).toContain("ExecuteExtraTool");

    // 第 2 轮 messages 必须含 tool_result(toolu_search_1)
    const round2User = (requests[1].body.messages ?? [])
      .filter((m) => m.role === "user" && Array.isArray(m.content))
      .flatMap((m) => (m.content as Array<{ type?: string; tool_use_id?: string }>) ?? []);
    const r2ToolResult = round2User.find(
      (b) => b.type === "tool_result" && b.tool_use_id === "toolu_search_1",
    );
    expect(r2ToolResult).toBeTruthy();

    // 第 3 轮 messages 必须含 tool_result(toolu_exec_1)，证明 dispatcher 真的执行了 ExecuteExtraTool 并把结果回灌
    const round3User = (requests[2].body.messages ?? [])
      .filter((m) => m.role === "user" && Array.isArray(m.content))
      .flatMap((m) => (m.content as Array<{ type?: string; tool_use_id?: string }>) ?? []);
    const r3ToolResult = round3User.find(
      (b) => b.type === "tool_result" && b.tool_use_id === "toolu_exec_1",
    );
    expect(r3ToolResult).toBeTruthy();

    // 不能输出占位话
    expect(output.text).not.toContain("不支持 tool calling");
    expect(output.text).not.toContain("Tool calling is not supported");
  });

  it("D.13I system reminder + hash input: only emit reminder when deferred list non-empty; hash input contains only name/kind/executable/requiredArgs", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session);

    // Default state has codebase-memory whitelist → reminder emitted
    const snapshot = snapshotDeferredTools(context);
    const reminder = formatDeferredToolsSystemReminder(context.language, snapshot);
    expect(reminder).toBeDefined();
    expect(reminder).toContain("SearchExtraTools");
    expect(reminder).toContain("ExecuteExtraTool");

    // Empty snapshot → no reminder
    const empty = formatDeferredToolsSystemReminder(context.language, {
      generatedAt: new Date().toISOString(),
      total: 0,
      byKind: { "codebase-memory": 0, mcp: 0, skill: 0, plugin: 0 },
      executableCount: 0,
      tools: [],
    });
    expect(empty).toBeUndefined();

    // hash input 仅含 name/kind/executable/requiredArgs，且按 name 排序
    const tools: DeferredToolDescriptor[] = [
      {
        name: "z_tool",
        kind: "codebase-memory",
        description: "should not appear in hash",
        requiredArgs: ["b", "a"],
        executable: true,
        reason: "should-not-appear",
      },
      {
        name: "a_tool",
        kind: "mcp",
        description: "raw description not in hash",
        requiredArgs: [],
        executable: false,
        reason: "raw-reason-not-in-hash",
      },
    ];
    const hashInput = deferredToolListHashInput(tools) as Array<Record<string, unknown>>;
    expect(hashInput).toHaveLength(2);
    expect(hashInput[0].name).toBe("a_tool");
    expect(hashInput[1].name).toBe("z_tool");
    // requiredArgs 排序后输出
    expect(hashInput[1].requiredArgs).toEqual(["a", "b"]);
    // 不含 description / reason
    const json = JSON.stringify(hashInput);
    expect(json).not.toContain("should not appear");
    expect(json).not.toContain("raw description");
    expect(json).not.toContain("raw-reason");
  });

  it("D.13I system prompt injection: createModelSystemPrompt embeds DeferredToolsReminder when deferred tools exist", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session);

    // Default codebase-memory whitelist → reminder must be embedded
    const prompt = createModelSystemPrompt("hello", context, { runtime: "test" });
    expect(prompt).toContain("DeferredToolsReminder=");
    expect(prompt).toContain("SearchExtraTools");
    expect(prompt).toContain("ExecuteExtraTool");
  });

  it("D.13I searchDeferredTools / findDeferredTool helpers behave deterministically", () => {
    const tools: DeferredToolDescriptor[] = [
      {
        name: "trace_path",
        kind: "codebase-memory",
        description: "trace function",
        requiredArgs: [],
        executable: true,
        reason: "ok",
      },
      {
        name: "search_code",
        kind: "codebase-memory",
        description: "search across project",
        requiredArgs: [],
        executable: true,
        reason: "ok",
      },
    ];
    expect(searchDeferredTools("", tools)).toEqual(tools);
    expect(searchDeferredTools("trace", tools).map((t) => t.name)).toEqual(["trace_path"]);
    expect(searchDeferredTools("memory", tools).map((t) => t.name).sort()).toEqual([
      "search_code",
      "trace_path",
    ]);
    expect(findDeferredTool("trace_path", tools)?.name).toBe("trace_path");
    expect(findDeferredTool("nope", tools)).toBeUndefined();
  });
});

// ─── D.13J Block 3 — codebase-memory 10 tools risk 分层 ──────────────────────
// readonly 工具放行；mutating 工具必须先获得 session 权限授予。
// order: whitelist (Set + listDeferredTools) → required-args → permission gate → spawn
// ----------------------------------------------------------------------------
describe("D.13J Block 3 — codebase-memory mutating permission gate", () => {
  it("D.13J Block 3 risk classifier: readonly vs mutating split (8 readonly + 2 mutating)", () => {
    expect(getCodebaseMemoryToolRisk("list_projects")).toBe("readonly");
    expect(getCodebaseMemoryToolRisk("index_status")).toBe("readonly");
    expect(getCodebaseMemoryToolRisk("search_code")).toBe("readonly");
    expect(getCodebaseMemoryToolRisk("get_architecture")).toBe("readonly");
    expect(getCodebaseMemoryToolRisk("get_code_snippet")).toBe("readonly");
    expect(getCodebaseMemoryToolRisk("query_graph")).toBe("readonly");
    expect(getCodebaseMemoryToolRisk("trace_path")).toBe("readonly");
    expect(getCodebaseMemoryToolRisk("search_graph")).toBe("readonly");
    expect(getCodebaseMemoryToolRisk("index_repository")).toBe("mutating");
    expect(getCodebaseMemoryToolRisk("detect_changes")).toBe("mutating");
    expect(getCodebaseMemoryToolRisk("nonexistent_tool")).toBe("unknown");
  });

  it("D.13J Block 3 required-args wins over permission denial", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session);

    // 必须先 SearchExtraTools 才能穿过 Set gating
    executeSearchExtraTools("index_repository", context);
    // 不授予权限，且 params 缺 repo_path
    expect(context.codebaseMemoryMutatingGranted).toBeFalsy();

    const result = await executeExtraTool(
      { tool_name: "index_repository", params: {} },
      context,
    );
    expect(result.ok).toBe(false);
    // required-args 必须在 permission gate 之前出现
    expect(result.text).toContain("缺少 required args");
    expect(result.text).toContain("repo_path");
    expect(result.text).not.toContain("权限");
    expect(result.text).not.toContain("mutating 权限");
  });

  it("D.13J Block 3 mutating tool denied without permission grant", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session);

    executeSearchExtraTools("detect_changes", context);
    expect(context.codebaseMemoryMutatingGranted).toBeFalsy();

    // params 满足 required args (project)，但权限缺失
    const result = await executeExtraTool(
      { tool_name: "detect_changes", params: { project: "foo" } },
      context,
    );
    expect(result.ok).toBe(false);
    expect(result.text).toContain("写操作");
    expect(result.text).toContain("detect_changes");
    expect(result.text).toContain("mutating");
    // D.14D-R P0-2：codebase-memory mutating 死路改人话，重定向到结构化工具
    // IndexRefresh / IndexRepair；不写不存在的 /mcp permission / /codebase-memory permission。
    expect(result.text).toContain("IndexRefresh");
    expect(result.text).not.toContain("/mcp permission");
    expect(result.text).not.toContain("/codebase-memory permission");
    expect(result.text).toContain("/index refresh");
  });

  it("D.13J Block 3 readonly tool dispatches without permission grant", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const mockDir = await mkdtemp(join(tmpdir(), "linghun-codebase-memory-mock-"));
    const { config } = await createMockCodebaseMemoryConfig(project, mockDir);
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session, config);

    executeSearchExtraTools("list_projects", context);
    expect(context.codebaseMemoryMutatingGranted).toBeFalsy();

    // readonly 工具 list_projects 不需要权限 → 必须放行
    const result = await executeExtraTool(
      { tool_name: "list_projects", params: {} },
      context,
    );
    expect(result.ok).toBe(true);
    expect(result.text).toContain("list_projects");
  });

  it("D.13J Block 3 mutating tool dispatches when permission granted", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const mockDir = await mkdtemp(join(tmpdir(), "linghun-codebase-memory-mock-"));
    const { config } = await createMockCodebaseMemoryConfig(project, mockDir);
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session, config);

    executeSearchExtraTools("detect_changes", context);
    context.codebaseMemoryMutatingGranted = true;

    const result = await executeExtraTool(
      { tool_name: "detect_changes", params: { project: "foo" } },
      context,
    );
    expect(result.ok).toBe(true);
    expect(result.text).toContain("detect_changes");
  });
});

// ─── D.13J Block 5 — Skill / Plugin 按 manifest 事实裁决 reason ────────────
// 区分 manifest 是否声明了 commands/tools/contributions。两类都 executable=false。
// ----------------------------------------------------------------------------
describe("D.13J Block 5 — skill/plugin manifest contribution reason", () => {
  it("D.13J Block 5 skill with triggers/commands → reason mentions contributes commands/tools", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session);

    context.skills.enabled = true;
    context.skills.skills = [
      {
        id: "skill-with-cmd",
        name: "Skill With Cmd",
        description: "skill that exposes commands",
        triggers: ["cmd-a", "cmd-b"],
      } as unknown as (typeof context.skills.skills)[number],
    ];
    context.skills.trustedIds = ["skill-with-cmd"];
    context.skills.disabledIds = [];

    const tools = listDeferredTools(context);
    const skill = tools.find((t) => t.name === "skill:skill-with-cmd");
    expect(skill).toBeTruthy();
    expect(skill?.executable).toBe(false);
    expect(skill?.reason).toContain("contributes commands/tools");
  });

  it("D.13J Block 5 skill with no commands/triggers → reason mentions metadata-only", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session);

    context.skills.enabled = true;
    context.skills.skills = [
      {
        id: "skill-meta-only",
        name: "Skill Meta Only",
        description: "metadata-only skill",
        triggers: [],
      } as unknown as (typeof context.skills.skills)[number],
    ];
    context.skills.trustedIds = ["skill-meta-only"];
    context.skills.disabledIds = [];

    const tools = listDeferredTools(context);
    const skill = tools.find((t) => t.name === "skill:skill-meta-only");
    expect(skill).toBeTruthy();
    expect(skill?.executable).toBe(false);
    expect(skill?.reason).toContain("metadata-only");
  });

  it("D.13J Block 5 plugin with contributions → reason mentions contributes", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session);

    context.plugins.enabled = true;
    context.plugins.plugins = [
      {
        id: "plugin-with-cmd",
        name: "Plugin With Cmd",
        description: "plugin with command contributions",
        contributions: {
          commands: ["plugin-cmd"],
          mcpServers: [],
          providers: [],
          hooks: [],
          workflows: [],
          skills: [],
        },
      } as unknown as (typeof context.plugins.plugins)[number],
    ];
    context.plugins.trustedIds = ["plugin-with-cmd"];
    context.plugins.disabledIds = [];

    const tools = listDeferredTools(context);
    const plugin = tools.find((t) => t.name === "plugin:plugin-with-cmd");
    expect(plugin).toBeTruthy();
    expect(plugin?.executable).toBe(false);
    expect(plugin?.reason).toContain("contributes");
    expect(plugin?.reason).not.toContain("metadata-only");
  });

  it("D.13J Block 5 plugin with empty contributions → reason mentions metadata-only", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session);

    context.plugins.enabled = true;
    context.plugins.plugins = [
      {
        id: "plugin-meta-only",
        name: "Plugin Meta Only",
        description: "plugin metadata-only",
        contributions: {
          commands: [],
          mcpServers: [],
          providers: [],
          hooks: [],
          workflows: [],
          skills: [],
        },
      } as unknown as (typeof context.plugins.plugins)[number],
    ];
    context.plugins.trustedIds = ["plugin-meta-only"];
    context.plugins.disabledIds = [];

    const tools = listDeferredTools(context);
    const plugin = tools.find((t) => t.name === "plugin:plugin-meta-only");
    expect(plugin).toBeTruthy();
    expect(plugin?.executable).toBe(false);
    expect(plugin?.reason).toContain("metadata-only");
  });
});

// ─── D.13J Block 4 — local stdio MCP runtime adapter ──────────────────────

async function createMockMcpStdioBinary(
  mockDir: string,
  options: {
    fileName?: string;
    failInitialize?: boolean;
    failToolCall?: boolean;
    failToolList?: boolean;
    toolCallResult?: unknown;
    bannerLine?: string;
    publishedTools?: string[];
  } = {},
): Promise<{ mockPath: string; callsPath: string }> {
  const fileName = options.fileName ?? "mock-mcp-stdio";
  const mockPath = join(mockDir, `${fileName}.cjs`);
  const callsPath = join(mockDir, `${fileName}-calls.jsonl`);
  const failInit = options.failInitialize === true;
  const failCall = options.failToolCall === true;
  const failList = options.failToolList === true;
  const callResult = options.toolCallResult ?? {
    content: [{ type: "text", text: "ok-from-mock" }],
  };
  const banner = options.bannerLine ?? "";
  // D.13J tail fix（Block A）：mock 默认公布常见 readonly + mutating + Block 4 兼容工具，
  // 调用方可通过 publishedTools 显式注入"server 不公布该工具"场景。
  const publishedTools = options.publishedTools ?? [
    "list_things",
    "write_value",
    "list_projects",
    "search_code",
    "index_repository",
  ];
  await writeFile(
    mockPath,
    `const fs = require("node:fs");
const callsPath = ${JSON.stringify(callsPath)};
const banner = ${JSON.stringify(banner)};
const publishedTools = ${JSON.stringify(publishedTools)};
if (banner) process.stdout.write(banner + "\\n");
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf("\\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let frame;
    try { frame = JSON.parse(line); } catch { continue; }
    fs.appendFileSync(callsPath, JSON.stringify({ method: frame.method, params: frame.params, id: frame.id }) + "\\n");
    if (frame.method === "initialize") {
      if (${failInit ? "true" : "false"}) {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: frame.id, error: { code: -32000, message: "initialize-fail" } }) + "\\n");
      } else {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: { protocolVersion: "2025-06-18", capabilities: {} } }) + "\\n");
      }
      continue;
    }
    if (frame.method === "tools/list") {
      if (${failList ? "true" : "false"}) {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: frame.id, error: { code: -32002, message: "tools-list-fail" } }) + "\\n");
      } else {
        const tools = publishedTools.map((name) => ({ name, description: "mock tool " + name, inputSchema: { type: "object" } }));
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: { tools } }) + "\\n");
      }
      continue;
    }
    if (frame.method === "tools/call") {
      if (${failCall ? "true" : "false"}) {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: frame.id, error: { code: -32001, message: "tool-call-fail" } }) + "\\n");
      } else {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: ${JSON.stringify(callResult)} }) + "\\n");
      }
      continue;
    }
  }
});
process.stdin.on("end", () => process.exit(0));
`,
    "utf8",
  );
  return { mockPath, callsPath };
}

describe("D.13J Block 4 — local stdio MCP runtime adapter", () => {
  it("D.13J Block 4 parseMcpDeferredToolName: parses mcp:server:tool and rejects malformed", () => {
    expect(parseMcpDeferredToolName("mcp:server:tool_name")).toEqual({
      server: "server",
      tool: "tool_name",
    });
    expect(parseMcpDeferredToolName("mcp:my-server:nested:tool:sub")).toEqual({
      server: "my-server",
      tool: "nested:tool:sub",
    });
    expect(parseMcpDeferredToolName("not-mcp:server:tool")).toBeUndefined();
    expect(parseMcpDeferredToolName("mcp:")).toBeUndefined();
    expect(parseMcpDeferredToolName("mcp:onlyserver")).toBeUndefined();
    expect(parseMcpDeferredToolName("mcp::tool")).toBeUndefined();
    expect(parseMcpDeferredToolName("mcp:server:")).toBeUndefined();
  });

  it("D.13J Block 4 isPotentiallyMutatingMcpTool: keyword detection (case-insensitive)", () => {
    expect(isPotentiallyMutatingMcpTool("write_file")).toBe(true);
    expect(isPotentiallyMutatingMcpTool("delete_node")).toBe(true);
    expect(isPotentiallyMutatingMcpTool("Update_Schema")).toBe(true);
    expect(isPotentiallyMutatingMcpTool("create_thing")).toBe(true);
    expect(isPotentiallyMutatingMcpTool("remove_x")).toBe(true);
    expect(isPotentiallyMutatingMcpTool("index_repository")).toBe(true);
    expect(isPotentiallyMutatingMcpTool("detect_changes")).toBe(true);
    expect(isPotentiallyMutatingMcpTool("ingest_traces")).toBe(true);
    expect(isPotentiallyMutatingMcpTool("manage_adr")).toBe(true);
    expect(isPotentiallyMutatingMcpTool("list_projects")).toBe(false);
    expect(isPotentiallyMutatingMcpTool("get_architecture")).toBe(false);
    expect(isPotentiallyMutatingMcpTool("search_code")).toBe(false);
    expect(isPotentiallyMutatingMcpTool("trace_path")).toBe(false);
  });

  it("D.13J Block 4 listMcpDeferredTools: local stdio server → executable=true; missing command → false", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const config: LinghunConfig = {
      ...defaultConfig,
      mcp: {
        ...defaultConfig.mcp,
        servers: {
          ...defaultConfig.mcp.servers,
          "local-stdio": { command: "node", args: ["mock.cjs"] },
          "no-command": { command: "", args: [] } as unknown as (typeof defaultConfig.mcp.servers)[string],
          "disabled-srv": { command: "node", disabled: true } as unknown as (typeof defaultConfig.mcp.servers)[string],
        },
      },
    };
    const context = await createTestContext(project, store, session, config);
    context.mcp.enabled = true;
    context.mcp.servers = [
      { name: "local-stdio", command: "node", status: "configured" },
      { name: "no-command", command: "", status: "configured" },
      { name: "disabled-srv", command: "node", status: "configured" },
    ];
    context.mcp.tools = [
      {
        server: "local-stdio",
        name: "list_things",
        description: "list things",
        discovery: "discovered",
        trusted: true,
        schemaLoaded: true,
      },
      {
        server: "no-command",
        name: "list_things",
        description: "list things",
        discovery: "discovered",
        trusted: true,
        schemaLoaded: true,
      },
      {
        server: "disabled-srv",
        name: "list_things",
        description: "list things",
        discovery: "discovered",
        trusted: true,
        schemaLoaded: true,
      },
    ];

    const tools = listDeferredTools(context);
    const localStdio = tools.find((t) => t.name === "mcp:local-stdio:list_things");
    const noCommand = tools.find((t) => t.name === "mcp:no-command:list_things");
    const disabled = tools.find((t) => t.name === "mcp:disabled-srv:list_things");
    expect(localStdio?.executable).toBe(true);
    expect(noCommand?.executable).toBe(false);
    expect(disabled?.executable).toBe(false);
  });

  it("D.13J Block 4 executeExtraTool readonly mcp tool: dispatches through stdio adapter", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const mockDir = await mkdtemp(join(tmpdir(), "linghun-tui-mcp-mock-"));
    const { mockPath, callsPath } = await createMockMcpStdioBinary(mockDir, {
      toolCallResult: { content: [{ type: "text", text: "readonly-result" }] },
    });
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const config: LinghunConfig = {
      ...defaultConfig,
      mcp: {
        ...defaultConfig.mcp,
        servers: {
          ...defaultConfig.mcp.servers,
          "test-srv": { command: process.execPath, args: [mockPath] },
        },
      },
    };
    const context = await createTestContext(project, store, session, config);
    context.mcp.enabled = true;
    context.mcp.servers = [{ name: "test-srv", command: process.execPath, status: "configured" }];
    context.mcp.tools = [
      {
        server: "test-srv",
        name: "list_things",
        description: "readonly list",
        discovery: "discovered",
        trusted: true,
        schemaLoaded: true,
      },
    ];
    executeSearchExtraTools("mcp:test-srv:list_things", context);
    const result = await executeExtraTool(
      { tool_name: "mcp:test-srv:list_things", params: { foo: "bar" } },
      context,
    );
    expect(result.ok).toBe(true);
    expect(result.text).toContain("完成");
    const calls = (await readFile(callsPath, "utf8"))
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { method: string; params: unknown; id: number });
    // D.13J tail fix（Block A）：链路顺序必须是 initialize → tools/list → tools/call。
    const methodOrder = calls.map((c) => c.method);
    const initIdx = methodOrder.indexOf("initialize");
    const listIdx = methodOrder.indexOf("tools/list");
    const callIdx = methodOrder.indexOf("tools/call");
    expect(initIdx).toBeGreaterThanOrEqual(0);
    expect(listIdx).toBeGreaterThan(initIdx);
    expect(callIdx).toBeGreaterThan(listIdx);
    const toolCall = calls.find((c) => c.method === "tools/call");
    expect(toolCall?.params).toMatchObject({
      name: "list_things",
      arguments: { foo: "bar" },
    });
  });

  it("D.13J Block 4 tail-fix executeExtraTool: rejects when tools/list does not contain target tool", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const mockDir = await mkdtemp(join(tmpdir(), "linghun-tui-mcp-mock-"));
    // server 仅公布 list_things；尝试调 unpublished_tool 必须在 tools/call 之前被拒绝。
    const { mockPath, callsPath } = await createMockMcpStdioBinary(mockDir, {
      publishedTools: ["list_things"],
    });
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const config: LinghunConfig = {
      ...defaultConfig,
      mcp: {
        ...defaultConfig.mcp,
        servers: {
          ...defaultConfig.mcp.servers,
          "test-srv": { command: process.execPath, args: [mockPath] },
        },
      },
    };
    const context = await createTestContext(project, store, session, config);
    context.mcp.enabled = true;
    context.mcp.servers = [{ name: "test-srv", command: process.execPath, status: "configured" }];
    context.mcp.tools = [
      {
        server: "test-srv",
        name: "unpublished_tool",
        description: "stale discovery; server no longer publishes this tool",
        discovery: "discovered",
        trusted: true,
        schemaLoaded: true,
      },
    ];
    executeSearchExtraTools("mcp:test-srv:unpublished_tool", context);
    const result = await executeExtraTool(
      { tool_name: "mcp:test-srv:unpublished_tool", params: {} },
      context,
    );
    expect(result.ok).toBe(false);
    expect(result.text).toContain("失败");
    expect(result.text).toContain("tools/list");
    const calls = (await readFile(callsPath, "utf8"))
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { method: string });
    // tools/list 必须发出过；tools/call 不能发出。
    expect(calls.find((c) => c.method === "tools/list")).toBeTruthy();
    expect(calls.find((c) => c.method === "tools/call")).toBeUndefined();
  });

  it("D.13J Block 4 executeExtraTool mutating mcp tool: denied without grant", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const mockDir = await mkdtemp(join(tmpdir(), "linghun-tui-mcp-mock-"));
    const { mockPath } = await createMockMcpStdioBinary(mockDir);
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const config: LinghunConfig = {
      ...defaultConfig,
      mcp: {
        ...defaultConfig.mcp,
        servers: {
          ...defaultConfig.mcp.servers,
          "test-srv": { command: process.execPath, args: [mockPath] },
        },
      },
    };
    const context = await createTestContext(project, store, session, config);
    context.mcp.enabled = true;
    context.mcp.servers = [{ name: "test-srv", command: process.execPath, status: "configured" }];
    context.mcp.tools = [
      {
        server: "test-srv",
        name: "write_value",
        description: "mutating writer",
        discovery: "discovered",
        trusted: true,
        schemaLoaded: true,
      },
    ];
    executeSearchExtraTools("mcp:test-srv:write_value", context);
    const result = await executeExtraTool(
      { tool_name: "mcp:test-srv:write_value", params: {} },
      context,
    );
    expect(result.ok).toBe(false);
    expect(result.text).toContain("写操作");
    expect(result.text).toContain("不通过本入口执行");
    // D.14D-R P0-2：mutating 死路文案改人话，指向结构化工具 IndexRefresh / IndexRepair。
    expect(result.text).toContain("IndexRefresh");
    // D.13J tail fix（Block B）：mutating 死路文案禁止再出现 /mcp permission 这种不存在的 slash 入口。
    expect(result.text).not.toContain("/mcp permission");
    expect(result.text).not.toContain("/codebase-memory permission");
  });

  it("D.13J Block 4 executeExtraTool mutating mcp tool: dispatches when permission granted", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const mockDir = await mkdtemp(join(tmpdir(), "linghun-tui-mcp-mock-"));
    const { mockPath, callsPath } = await createMockMcpStdioBinary(mockDir);
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const config: LinghunConfig = {
      ...defaultConfig,
      mcp: {
        ...defaultConfig.mcp,
        servers: {
          ...defaultConfig.mcp.servers,
          "test-srv": { command: process.execPath, args: [mockPath] },
        },
      },
    };
    const context = await createTestContext(project, store, session, config);
    context.mcp.enabled = true;
    context.mcp.servers = [{ name: "test-srv", command: process.execPath, status: "configured" }];
    context.mcp.tools = [
      {
        server: "test-srv",
        name: "write_value",
        description: "mutating writer",
        discovery: "discovered",
        trusted: true,
        schemaLoaded: true,
      },
    ];
    context.mcpStdioMutatingGranted = true;
    executeSearchExtraTools("mcp:test-srv:write_value", context);
    const result = await executeExtraTool(
      { tool_name: "mcp:test-srv:write_value", params: { x: 1 } },
      context,
    );
    expect(result.ok).toBe(true);
    const calls = (await readFile(callsPath, "utf8"))
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { method: string });
    expect(calls.find((c) => c.method === "tools/call")).toBeTruthy();
  });

  it("D.13J Block 4 executeExtraTool: rejects mcp tool when server not local stdio", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const config: LinghunConfig = {
      ...defaultConfig,
      mcp: {
        ...defaultConfig.mcp,
        servers: {
          ...defaultConfig.mcp.servers,
          "remote-srv": {
            command: "",
            args: [],
          } as unknown as (typeof defaultConfig.mcp.servers)[string],
        },
      },
    };
    const context = await createTestContext(project, store, session, config);
    context.mcp.enabled = true;
    context.mcp.servers = [{ name: "remote-srv", command: "", status: "configured" }];
    context.mcp.tools = [
      {
        server: "remote-srv",
        name: "list_things",
        description: "ro",
        discovery: "discovered",
        trusted: true,
        schemaLoaded: true,
      },
    ];
    // Bypass discovery gate so the test reaches the local-stdio check below.
    context.discoveredDeferredToolNames.add("mcp:remote-srv:list_things");
    const result = await executeExtraTool(
      { tool_name: "mcp:remote-srv:list_things", params: {} },
      context,
    );
    expect(result.ok).toBe(false);
    expect(result.text).toContain("not local stdio");
  });

  it("D.13J Block 4 executeExtraTool: surfaces server tools/call error", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const mockDir = await mkdtemp(join(tmpdir(), "linghun-tui-mcp-mock-"));
    const { mockPath } = await createMockMcpStdioBinary(mockDir, { failToolCall: true });
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const config: LinghunConfig = {
      ...defaultConfig,
      mcp: {
        ...defaultConfig.mcp,
        servers: {
          ...defaultConfig.mcp.servers,
          "test-srv": { command: process.execPath, args: [mockPath] },
        },
      },
    };
    const context = await createTestContext(project, store, session, config);
    context.mcp.enabled = true;
    context.mcp.servers = [{ name: "test-srv", command: process.execPath, status: "configured" }];
    context.mcp.tools = [
      {
        server: "test-srv",
        name: "list_things",
        description: "ro",
        discovery: "discovered",
        trusted: true,
        schemaLoaded: true,
      },
    ];
    executeSearchExtraTools("mcp:test-srv:list_things", context);
    const result = await executeExtraTool(
      { tool_name: "mcp:test-srv:list_things", params: {} },
      context,
    );
    expect(result.ok).toBe(false);
    expect(result.text).toContain("失败");
    expect(result.text).toContain("tool-call-fail");
  });
});

// ─── P0-A / P0-B regression: /details lastFullOutput + control-plane ─────────
//
// 这 6 条测试覆盖：
//   1. /model doctor → /details 默认分支可以看到完整正文
//   2. /details 自身不覆盖 lastFullOutput；连续 /details 不套娃
//   3. "你好，只回复：连接成功" → handleNaturalInput 返回 "message"（必须发模型）
//   4. "测试一下" → handleNaturalInput 返回 "message"（必须发模型）
//   5. 明确控制面意图（"/permissions 是什么"）→ handled，并显式输出"已本地处理"
//   6. createOutputBlock 现在保留 fullText（错误正文也能被 /details 展开）

describe("P0-A /details full output + P0-B control-plane intercept", () => {
  it("P0-A 1: /model doctor 之后 /details 默认分支包含完整正文（provider.env / providers / endpointPath）", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session);

    // 首次写入 /model doctor 的"完整正文"（多行）。
    // ShellBlockOutput 的等价行为是：每次 writeLine 把 normalized 整段挂到
    // context.lastFullOutput，让后续 /details 默认分支可以展开。这里用一个
    // 简化的 capturing output 直接驱动 lastFullOutput，等价于 ShellBlockOutput。
    const doctorBody = [
      "Model route doctor",
      "- provider.env merge: openai-compatible -> https://relay.example.com/v1",
      "- endpointPath=/v1/messages",
      "- providers: openai-compatible (claude-3-5-sonnet-latest), deepseek (different-model)",
      "- promptCache: hits=0, misses=0",
      "- deferredTools: 0 discovered",
    ].join("\n");
    context.lastFullOutput = doctorBody;

    const output = new MemoryOutput();
    await handleSlashCommand("/details", context, output);

    expect(output.text).toContain("最近一次输出（完整正文）");
    expect(output.text).toContain("Model route doctor");
    expect(output.text).toContain("provider.env merge");
    expect(output.text).toContain("endpointPath=/v1/messages");
    expect(output.text).toContain("providers: openai-compatible");
  });

  it("P0-A 2: /details 自身不覆盖 lastFullOutput，连续 /details 不套娃", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session);
    const original = "Model route doctor\n- endpointPath=/v1/messages\n- providers: openai-compatible";
    context.lastFullOutput = original;

    const out1 = new MemoryOutput();
    await handleSlashCommand("/details", context, out1);
    expect(out1.text).toContain("endpointPath=/v1/messages");
    // 关键不变量：/details 没把"上一次 /details 的总览"写进 lastFullOutput
    expect(context.lastFullOutput).toBe(original);

    const out2 = new MemoryOutput();
    await handleSlashCommand("/details", context, out2);
    // 连续 /details 仍然展开同一条原始正文，没出现套娃（不会出现"最近一次输出"两次嵌套）。
    expect(out2.text).toContain("endpointPath=/v1/messages");
    expect(out2.text).not.toContain("Linghun details\n- evidence:" + "\nLinghun details");
    expect(context.lastFullOutput).toBe(original);
  });

  it("P0-B 3: 普通问候 \"你好，只回复：连接成功\" 必须放行到模型 (handleNaturalInput → message)", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    const result = await handleNaturalInput("你好，只回复：连接成功", context, output);

    expect(result).toBe("message");
    // 不应该产生本地控制面截胡的提示
    expect(output.text).not.toContain("已本地处理");
    expect(output.text).not.toContain("Handled locally");
  });

  it("P0-B 4: 短句 \"测试一下\" 必须放行到模型 (handleNaturalInput → message)", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    const result = await handleNaturalInput("测试一下", context, output);

    expect(result).toBe("message");
    expect(output.text).not.toContain("已本地处理");
  });

  it("P0-B 5: 普通对话短句 \"/help 怎么用是吗\" 不带前导 / → 必须放行到模型", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    // CCB 边界：自然语言里"提到 /help"不是 slash 命令；只有以 "/" 开头的输入才进
    // handleSlashCommand。这条普通问话应该放行到模型，不再有"自然语言→本地 capability"
    // 的截胡路径。
    const result = await handleNaturalInput("说一下 /help 这个东西怎么用", context, output);

    expect(result).toBe("message");
    expect(output.text).not.toContain("已本地处理");
    expect(output.text).not.toContain("Handled locally");
  });

  it("P0-A 6: createOutputBlock 同时保留 summary 和 fullText（错误正文也可由 /details 展开）", async () => {
    const errorBody = [
      "Provider request failed",
      "- code: PROVIDER_NETWORK_ERROR",
      "- provider: openai-compatible",
      "- endpointPath=/v1/messages",
      "- detail: ECONNRESET while streaming",
    ].join("\n");
    const block = createOutputBlock(errorBody, "zh-CN");

    expect(block.summary).toBe("Provider request failed");
    expect(block.fullText).toBe(errorBody);
    // D.13Q-UX Real Smoke Fix v3：createOutputBlock 不再用关键词扫描决定 fail；
    // 普通 writeLine 一律 kind="details" / status="info"。真正的工具错误由
    // 调用方显式构造 tool_result_error block。/details 仍能展开 fullText。
    expect(block.kind).toBe("details");
    expect(block.status).toBe("info");

    // 模拟 ShellBlockOutput 把这条错误写到 lastFullOutput，然后 /details 展开
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session);
    context.lastFullOutput = errorBody;

    const output = new MemoryOutput();
    await handleSlashCommand("/details", context, output);

    expect(output.text).toContain("Provider request failed");
    expect(output.text).toContain("ECONNRESET while streaming");
    expect(output.text).toContain("endpointPath=/v1/messages");
  });
});

// ─── natural control routing — CCB 边界对齐回归 ─────────────────────────────────
//
// 这一组测试对齐 CCB：普通自然语言（中英）默认必须发送给模型，本地控制面只处理
// pending approval / pending Start Gate / 显式 slash 命令。这些断言会捕捉历史上
// 的两类回归：
//   (a) routeNaturalIntent 把含 "模型/配置/诊断/doctor/status" 的普通句子误识别
//       为本地 capability，再被 readonly 路径吞掉；
//   (b) 中英文新关键词被加进白名单后又把普通对话截胡。
//
// handleNaturalInput 在 (text, context, output) 重载下：返回 "message" 等价于
// processTuiLine 会进入 sendMessage → gateway.stream（即 CCB 行为）。"handled"
// 表示本地控制面或 pending gate 截走，不发模型。

describe("natural control routing — ordinary prompts must reach gateway.stream", () => {
  const ordinaryPromptsZh = [
    "你好，只回复：连接成功",
    "模型这里是不是有问题",
    "帮我看看模型为什么连不上",
    "这个配置怎么写",
    "诊断一下这个 bug",
    "本地控制是不是太强",
  ];

  for (const prompt of ordinaryPromptsZh) {
    it(`zh-CN ordinary prompt 必须放行到模型 (handleNaturalInput → message): ${prompt}`, async () => {
      const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
      const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
      const session = await store.create({ model: "deepseek-v4-flash" });
      const output = new MemoryOutput();
      const context = await createTestContext(project, store, session);

      const result = await handleNaturalInput(prompt, context, output);

      expect(result).toBe("message");
      expect(output.text).not.toContain("已本地处理");
      expect(output.text).not.toContain("Handled locally");
    });
  }

  const ordinaryPromptsEn = [
    "is the model okay or not",
    "explain how the local control plane works in plain words",
    "tell me what is going wrong here right now",
    "describe the runtime behaviour for me",
  ];

  for (const prompt of ordinaryPromptsEn) {
    it(`en-US ordinary prompt 必须放行到模型 (handleNaturalInput → message): ${prompt}`, async () => {
      const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
      const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
      const session = await store.create({ model: "gpt-4.1" });
      const output = new MemoryOutput();
      // 配齐 provider，绕过 shouldOfferUserScopedModelSetup 的本地引导路径——
      // 该路径属于 CCB 的 setup wizard，与控制面截胡无关。这里测试的是普通对话不被
      // 截胡到 routeNaturalIntent。
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
      context.language = "en-US";

      const result = await handleNaturalInput(prompt, context, output);

      expect(result).toBe("message");
      expect(output.text).not.toContain("已本地处理");
      expect(output.text).not.toContain("Handled locally");
    });
  }

  it("/model doctor 必须本地处理（handleSlashCommand → handled），不会进 gateway.stream", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    const result = await handleSlashCommand("/model doctor", context, output);

    // handleSlashCommand 返回 "handled" 表示已被 slash 派发处理；只有 "message" 才会
    // 让 processTuiLine 继续走 sendMessage → gateway.stream。
    expect(result).toBe("handled");
    expect(output.text).toContain("Model route doctor");
  });

  it("/model doctor 之后 /details 必须展开完整 doctor 正文（含 endpointPath=/v1/messages）", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session);

    // 模拟 ShellBlockOutput 把 /model doctor 的 normalized 全文挂上 lastFullOutput。
    const doctorBody = [
      "Model route doctor",
      "- provider.env merge: applied=yes overrodeModelRoutes=yes providers=openai-compatible",
      "- providers:",
      "  - openai-compatible: type=openai-compatible runtimeProfile=anthropic_messages endpointProfile=anthropic_messages endpointPath=/v1/messages apiKey=present",
      "- planner: provider=openai-compatible model=claude-opus-4-7",
    ].join("\n");
    context.lastFullOutput = doctorBody;

    const output = new MemoryOutput();
    await handleSlashCommand("/details", context, output);

    expect(output.text).toContain("Model route doctor");
    expect(output.text).toContain("provider.env merge");
    expect(output.text).toContain("endpointPath=/v1/messages");
    expect(output.text).toContain("openai-compatible");
  });

  it("/details 自身不污染 lastFullOutput（连续 /details 仍展开同一原始正文）", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session);
    const original = "Model route doctor\n- endpointPath=/v1/messages";
    context.lastFullOutput = original;

    const out1 = new MemoryOutput();
    await handleSlashCommand("/details", context, out1);
    expect(context.lastFullOutput).toBe(original);

    const out2 = new MemoryOutput();
    await handleSlashCommand("/details", context, out2);
    expect(out2.text).toContain("endpointPath=/v1/messages");
    expect(context.lastFullOutput).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// D.13M-B — light hint must not pollute lastFullOutput; /details still
// expands the most recent real assistant body even after a light hint fired.
// ---------------------------------------------------------------------------
describe("D.13M-B light hint × /details lastFullOutput", () => {
  it("writeLightHints 推到 notifications 队列，不替换 lastFullOutput", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session);

    // 模拟一段 assistant 正文已经流到主屏，把它当作 "lastFullOutput"
    const assistantBody = "完整答复\n- 第二行\n- 第三行";
    context.lastFullOutput = assistantBody;

    // 触发缓存复用低 → 进 cache-hit-low light hint 路径
    recordModelUsage(context, {
      inputTokens: 100,
      outputTokens: 10,
      totalTokens: 110,
      cacheReadTokens: 1,
      cacheWriteTokens: 0,
      cacheWriteTokensRaw: 0,
    });

    const output = new MemoryOutput();
    writeLightHintsForTest(output, context);

    // D.13Q-UX Closure: light hint 改为推 NotificationStack 队列；
    // 不再写主屏 transcript，所以 output.text 应保持空。
    expect(output.text).toBe("");
    const notifs = (context as { notifications?: { text: string }[] }).notifications ?? [];
    const joined = notifs.map((n) => n.text).join("\n");
    expect(joined).toContain("最近缓存复用变低");
    // 关键不变量：light hint 不能替换 lastFullOutput
    expect(context.lastFullOutput).toBe(assistantBody);
  });

  it("/details 在 light hint 之后仍展开 assistant 完整正文", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session);

    const assistantBody = "完整答复\n- 关键证据 X\n- 关键证据 Y";
    context.lastFullOutput = assistantBody;

    recordModelUsage(context, {
      inputTokens: 100,
      outputTokens: 10,
      totalTokens: 110,
      cacheReadTokens: 1,
      cacheWriteTokens: 0,
      cacheWriteTokensRaw: 0,
    });

    const hintOut = new MemoryOutput();
    writeLightHintsForTest(hintOut, context);

    const detailsOut = new MemoryOutput();
    await handleSlashCommand("/details", context, detailsOut);

    expect(detailsOut.text).toContain("最近一次输出（完整正文）：");
    expect(detailsOut.text).toContain("关键证据 X");
    expect(detailsOut.text).toContain("关键证据 Y");
    // /details 默认分支当然也不能把 lastFullOutput 改写
    expect(context.lastFullOutput).toBe(assistantBody);
  });
});

// ─── D.13Q-UX Real Smoke Fix v3 复核 ────────────────────────────────────────
// writeErrorLine 结构化错误路径：真实错误（provider failure / formatError catch /
// empty response / ignore 写入失败）通过 Ink ShellBlockOutput.writeErrorLine 走
// messageKind=tool_result_error / kind=error / status=fail；普通正文 / /mcp
// status / diagnostic 仍然 info。
describe("D.13Q-UX Real Smoke Fix v3 复核 — writeErrorLine 真实错误路径", () => {
  function makeFakeContext(): TuiContext {
    return {
      language: "zh-CN",
      lastFullOutput: undefined,
      suppressLastFullOutputCapture: false,
    } as unknown as TuiContext;
  }

  it("provider stream failure 文案通过 ShellBlockOutput.writeErrorLine 产 tool_result_error/fail", () => {
    const blocks: ProductBlockViewModel[] = [];
    const output = __testCreateShellBlockOutput(makeFakeContext(), blocks) as unknown as {
      writeErrorLine?: (text: string, title?: string) => void;
    };
    const failure = formatProviderFailurePrimary(
      { code: "PROVIDER_HTTP_ERROR", status: 502, message: "bad gateway" } as unknown as Error,
      "zh-CN",
    );
    output.writeErrorLine?.(failure);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.messageKind).toBe("tool_result_error");
    expect(blocks[0]?.kind).toBe("error");
    expect(blocks[0]?.status).toBe("fail");
  });

  it("formatError catch 文案通过 ShellBlockOutput.writeErrorLine 产 tool_result_error/fail", () => {
    const blocks: ProductBlockViewModel[] = [];
    const output = __testCreateShellBlockOutput(makeFakeContext(), blocks) as unknown as {
      writeErrorLine?: (text: string, title?: string) => void;
    };
    const errorText = "ENOENT: 找不到文件 /tmp/missing.json";
    output.writeErrorLine?.(errorText);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.messageKind).toBe("tool_result_error");
    expect(blocks[0]?.status).toBe("fail");
    expect(blocks[0]?.fullText).toContain("ENOENT");
  });

  it("/mcp status diagnostic 仍走 messageKind=diagnostic / status=info（不染红）", () => {
    const blocks: ProductBlockViewModel[] = [];
    const output = __testCreateShellBlockOutput(makeFakeContext(), blocks) as unknown as {
      writeDiagnosticLine?: (text: string) => void;
    };
    output.writeDiagnosticLine?.(
      "MCP status\n- enabled: yes\n- lastDoctor: 未检测，运行 /mcp doctor 检测",
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.messageKind).toBe("diagnostic");
    expect(blocks[0]?.status).toBe("info");
    expect(blocks[0]?.kind).toBe("details");
  });

  it("普通正文含 error/failed 字样仍 messageKind=assistant_text / status=info", () => {
    const blocks: ProductBlockViewModel[] = [];
    const output = __testCreateShellBlockOutput(makeFakeContext(), blocks);
    output.write("error: build failed but this is just narrative\n");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.messageKind).toBe("assistant_text");
    expect(blocks[0]?.status).toBe("info");
  });

  it("短错误不挂 Ctrl+O hint；多行错误挂 Ctrl+O 错误展开 hint", () => {
    const blocks: ProductBlockViewModel[] = [];
    const output = __testCreateShellBlockOutput(makeFakeContext(), blocks) as unknown as {
      writeErrorLine?: (text: string, title?: string) => void;
    };
    output.writeErrorLine?.("provider 拒绝了本次请求 schema");
    expect(blocks[0]?.nextAction).toBeUndefined();

    const blocks2: ProductBlockViewModel[] = [];
    const output2 = __testCreateShellBlockOutput(makeFakeContext(), blocks2) as unknown as {
      writeErrorLine?: (text: string, title?: string) => void;
    };
    output2.writeErrorLine?.(
      "Provider request failed\n- code: PROVIDER_NETWORK_ERROR\n- detail: ECONNRESET while streaming",
    );
    expect(blocks2[0]?.nextAction).toContain("Ctrl+O");
  });
});

// ---------------------------------------------------------------------------
// D.13V-A item 1 — streaming residue reality check
//   验证 Final Answer Gate retry / downgrade 路径上：
//   - retry：违规原文从 streaming block 与 lastFullOutput 同步消失，下一轮 delta
//     可以正常重新填回同一条 keep:true block。
//   - downgrade：违规原文被替换为安全文本，主屏 / Ctrl+O / details 拉到的
//     都是降级版，不再泄漏 unsupported first-pass final answer。
//   - createVerificationLevelForReadiness 改写后 readiness 走 verification-level
//     分级器，build-only readiness 不再越级 real-smoke。
// ---------------------------------------------------------------------------
describe("D.13V-A item 1: streaming residue cleanup on retry/downgrade", () => {
  function makeFakeContext(): TuiContext {
    return {
      language: "zh-CN",
      lastFullOutput: undefined,
      suppressLastFullOutputCapture: false,
    } as unknown as TuiContext;
  }

  it("discardAssistantBlock 清空 streaming block fullText/summary 与 lastFullOutput", () => {
    const ctx = makeFakeContext();
    const blocks: ProductBlockViewModel[] = [];
    const output = __testCreateShellBlockOutput(ctx, blocks);
    const id = "assistant-stream-test-1";
    output.beginAssistantStream(id);
    output.appendAssistantDelta("已完成所有测试，PASS。");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.fullText).toContain("已完成");
    expect(ctx.lastFullOutput).toContain("已完成");

    output.discardAssistantBlock(id);
    expect(blocks[0]?.fullText).toBe("");
    expect(blocks[0]?.summary).toBe("");
    expect(ctx.lastFullOutput).toBeUndefined();

    output.appendAssistantDelta("我没有跑测试，无法确认。");
    expect(blocks[0]?.fullText).toBe("我没有跑测试，无法确认。");
    expect(ctx.lastFullOutput).toBe("我没有跑测试，无法确认。");
  });

  it("replaceAssistantBlockContent 用降级文本替换 fullText/summary 与 lastFullOutput", () => {
    const ctx = makeFakeContext();
    const blocks: ProductBlockViewModel[] = [];
    const output = __testCreateShellBlockOutput(ctx, blocks);
    const id = "assistant-stream-test-2";
    output.beginAssistantStream(id);
    output.appendAssistantDelta("测试已通过，可以发布。");
    expect(blocks[0]?.fullText).toContain("测试已通过");
    expect(ctx.lastFullOutput).toContain("测试已通过");

    const downgraded = "[未验证] 测试已通过，可以发布。\n（缺少 test_passed 证据。）";
    output.replaceAssistantBlockContent(id, downgraded);
    expect(blocks[0]?.fullText).toBe(downgraded);
    expect(blocks[0]?.summary).toContain("[未验证]");
    expect(ctx.lastFullOutput).toBe(downgraded);
  });

  it("retry 后 discardAssistantBlock 让 Ctrl+O / details 拉不到违规原文", () => {
    const ctx = makeFakeContext();
    const blocks: ProductBlockViewModel[] = [];
    const output = __testCreateShellBlockOutput(ctx, blocks);
    const id = "assistant-stream-test-3";
    output.beginAssistantStream(id);
    output.appendAssistantDelta("已完成，所有 build/test 已通过。");
    output.discardAssistantBlock(id);
    output.appendAssistantDelta("我没有调用任何工具，无法确认 build/test 状态。");

    expect(blocks).toHaveLength(1);
    const fullText = blocks[0]?.fullText ?? "";
    expect(fullText).not.toContain("已完成");
    expect(fullText).not.toContain("通过");
    expect(fullText).toContain("无法确认");
    expect(ctx.lastFullOutput).toBe(fullText);
  });

  it("suppressLastFullOutputCapture=true 时 discard/replace 不会写穿 lastFullOutput", () => {
    const ctx = {
      language: "zh-CN" as const,
      lastFullOutput: "preserved",
      suppressLastFullOutputCapture: true,
    } as unknown as TuiContext;
    const blocks: ProductBlockViewModel[] = [];
    const output = __testCreateShellBlockOutput(ctx, blocks);
    const id = "assistant-stream-test-4";
    output.beginAssistantStream(id);
    output.appendAssistantDelta("已完成，PASS。");
    expect(ctx.lastFullOutput).toBe("preserved");

    output.discardAssistantBlock(id);
    expect(ctx.lastFullOutput).toBe("preserved");

    output.replaceAssistantBlockContent(id, "[未验证] downgrade");
    expect(ctx.lastFullOutput).toBe("preserved");
  });

  it("源码：streamFinalModelAnswerWithoutTools 复用外层 assistantStreamBlockId", async () => {
    const fs = await import("node:fs/promises");
    const indexSrc = await fs.readFile("src/index.ts", "utf8");
    expect(indexSrc).toContain("reuseAssistantStreamBlockId");
    expect(indexSrc).toMatch(
      /assistantStreamBlockId\s*=\s*\n?\s*reuseAssistantStreamBlockId\s*\?\?/,
    );
    expect(indexSrc).toMatch(
      /streamFinalModelAnswerWithoutTools\([^)]*assistantStreamBlockId,?\s*\)/s,
    );
  });

  it("源码：sendMessage / continueModelAfterToolResults 在 retry 后调 discardAssistantBlock", async () => {
    const fs = await import("node:fs/promises");
    const indexSrc = await fs.readFile("src/index.ts", "utf8");
    const occurrences = indexSrc.match(/discardAssistantBlock\(output, assistantStreamBlockId\)/g);
    expect(occurrences?.length).toBeGreaterThanOrEqual(2);
    const downgrade = indexSrc.match(
      /replaceAssistantBlockContent\(output, assistantStreamBlockId, assistantText\)/g,
    );
    expect(downgrade?.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// D.13V-A item 2 — verification classifier 不再被绕过
//   readiness 不再用 `status===pass && unverified=0` 直升 real-smoke。
//   只有真实 smoke kind 命令 pass 才算 realProcessObserved；
//   build/test/typecheck/lint 全 pass 顶到 build 级；
//   partial / unverified / fallback / runnerError 命中 mock 级 + upgradeBlocked。
// ---------------------------------------------------------------------------
describe("D.13V-A item 2: createVerificationLevelForReadiness routes through classifier", () => {
  function makeCtxWithReport(report: VerificationReport | undefined): TuiContext {
    return {
      lastVerification: report,
    } as unknown as TuiContext;
  }
  function step(
    kind: "test" | "typecheck" | "build" | "lint" | "smoke",
    status: "pass" | "fail" | "partial" | "skipped" | "stale" | "cancelled" | "timeout",
    overrides: Partial<{ runnerError: string; synthetic: boolean }> = {},
  ) {
    return {
      kind,
      command: `${kind} command`,
      reason: "test",
      status,
      durationMs: 100,
      summary: `${kind} ${status}`,
      ...overrides,
    };
  }

  it("无 lastVerification 时返回 source 级、不可 pass/mature", () => {
    const result = __testCreateVerificationLevelForReadiness(makeCtxWithReport(undefined));
    expect(result.level).toBe("source");
    expect(result.canClaimPass).toBe(false);
    expect(result.canClaimMature).toBe(false);
    expect(result.upgradeBlocked).toBe(false);
  });

  it("仅 build pass 不再被报告为 real-smoke（修复 P0-3）", () => {
    const report: VerificationReport = {
      id: "r1",
      status: "pass",
      summary: "build only",
      commands: [step("build", "pass")],
      unverified: [],
      risk: [],
      startedAt: "",
      endedAt: "",
      durationMs: 0,
      nextAction: "",
    };
    const result = __testCreateVerificationLevelForReadiness(makeCtxWithReport(report));
    expect(result.level).not.toBe("real-smoke");
    expect(result.canClaimMature).toBe(false);
    expect(result.canClaimPass).toBe(true);
  });

  it("vitest+tsc+build 全 pass 但无 smoke kind → 仍非 real-smoke", () => {
    const report: VerificationReport = {
      id: "r2",
      status: "pass",
      summary: "all but smoke",
      commands: [step("test", "pass"), step("typecheck", "pass"), step("build", "pass")],
      unverified: [],
      risk: [],
      startedAt: "",
      endedAt: "",
      durationMs: 0,
      nextAction: "",
    };
    const result = __testCreateVerificationLevelForReadiness(makeCtxWithReport(report));
    expect(result.level).not.toBe("real-smoke");
    expect(result.canClaimMature).toBe(false);
  });

  it("smoke kind pass + 全 pass + unverified=0 → real-smoke", () => {
    const report: VerificationReport = {
      id: "r3",
      status: "pass",
      summary: "real smoke",
      commands: [step("test", "pass"), step("smoke", "pass")],
      unverified: [],
      risk: [],
      startedAt: "",
      endedAt: "",
      durationMs: 0,
      nextAction: "",
    };
    const result = __testCreateVerificationLevelForReadiness(makeCtxWithReport(report));
    expect(result.level).toBe("real-smoke");
    expect(result.canClaimMature).toBe(true);
    expect(result.canClaimPass).toBe(true);
    expect(result.upgradeBlocked).toBe(false);
  });

  it("status=partial 触发 simulatedOrPartial → upgradeBlocked", () => {
    const report: VerificationReport = {
      id: "r4",
      status: "partial",
      summary: "partial",
      commands: [step("test", "partial")],
      unverified: ["smoke not run"],
      risk: [],
      startedAt: "",
      endedAt: "",
      durationMs: 0,
      nextAction: "",
    };
    const result = __testCreateVerificationLevelForReadiness(makeCtxWithReport(report));
    expect(result.upgradeBlocked).toBe(true);
    expect(result.canClaimMature).toBe(false);
    expect(result.blockReason).toBe("simulated-or-partial");
  });

  it("unverified 列表非空时即使 status=pass 也降级 + upgradeBlocked", () => {
    const report: VerificationReport = {
      id: "r5",
      status: "pass",
      summary: "pass with unverified",
      commands: [step("test", "pass"), step("smoke", "pass")],
      unverified: ["mobile not tested"],
      risk: [],
      startedAt: "",
      endedAt: "",
      durationMs: 0,
      nextAction: "",
    };
    const result = __testCreateVerificationLevelForReadiness(makeCtxWithReport(report));
    expect(result.upgradeBlocked).toBe(true);
    expect(result.canClaimMature).toBe(false);
    expect(result.level).not.toBe("real-smoke");
  });

  it("runnerError 触发 fallbackUsed → mock 级", () => {
    const report: VerificationReport = {
      id: "r6",
      status: "pass",
      summary: "fallback",
      commands: [step("test", "pass", { runnerError: "node fallback used" })],
      unverified: [],
      risk: [],
      startedAt: "",
      endedAt: "",
      durationMs: 0,
      nextAction: "",
    };
    const result = __testCreateVerificationLevelForReadiness(makeCtxWithReport(report));
    expect(result.upgradeBlocked).toBe(true);
    expect(result.blockReason).toBe("fallback-path-used");
    expect(result.canClaimPass).toBe(false);
    expect(result.canClaimMature).toBe(false);
  });

  it("status=stale 触发 fallback → upgradeBlocked", () => {
    const report: VerificationReport = {
      id: "r7",
      status: "stale",
      summary: "stale report",
      commands: [step("test", "pass")],
      unverified: [],
      risk: [],
      startedAt: "",
      endedAt: "",
      durationMs: 0,
      nextAction: "",
    };
    const result = __testCreateVerificationLevelForReadiness(makeCtxWithReport(report));
    expect(result.upgradeBlocked).toBe(true);
    expect(result.canClaimPass).toBe(false);
  });

  it("某条 command timeout 即使 status=pass 也降级", () => {
    const report: VerificationReport = {
      id: "r8",
      status: "pass",
      summary: "one command timed out",
      commands: [step("test", "pass"), step("smoke", "timeout")],
      unverified: [],
      risk: [],
      startedAt: "",
      endedAt: "",
      durationMs: 0,
      nextAction: "",
    };
    const result = __testCreateVerificationLevelForReadiness(makeCtxWithReport(report));
    expect(result.upgradeBlocked).toBe(true);
    expect(result.canClaimMature).toBe(false);
  });

  it("源码：createVerificationLevelForReadiness 调用 classifyVerificationLevel", async () => {
    const fs = await import("node:fs/promises");
    const indexSrc = await fs.readFile("src/index.ts", "utf8");
    expect(indexSrc).toMatch(
      /createVerificationLevelForReadiness[\s\S]{0,5000}classifyVerificationLevel\(/,
    );
    // 旧 P0-3 假升级表达式不能再出现
    expect(indexSrc).not.toMatch(
      /hasRealSmoke\s*\?\s*"real-smoke"\s*:\s*hasBuild\s*\?\s*"build"/,
    );
  });

  // D.14A-R-Fix P1-2 — 合成 smoke（synthetic=true）pass 不得升级 real-smoke；
  // 只有真实（非合成）smoke kind pass 才允许 real-smoke。partial/stale/mock 仍不升级。
  it("合成 smoke（synthetic）pass 不升级 real-smoke", () => {
    const report: VerificationReport = {
      id: "r-syn",
      status: "pass",
      summary: "synthetic smoke",
      commands: [step("smoke", "pass", { synthetic: true })],
      unverified: [],
      risk: [],
      startedAt: "",
      endedAt: "",
      durationMs: 0,
      nextAction: "",
    };
    const result = __testCreateVerificationLevelForReadiness(makeCtxWithReport(report));
    expect(result.level).not.toBe("real-smoke");
    expect(result.canClaimMature).toBe(false);
  });

  it("真实（非合成）smoke pass 才允许 real-smoke", () => {
    const report: VerificationReport = {
      id: "r-real",
      status: "pass",
      summary: "real smoke",
      commands: [step("smoke", "pass", { synthetic: false })],
      unverified: [],
      risk: [],
      startedAt: "",
      endedAt: "",
      durationMs: 0,
      nextAction: "",
    };
    const result = __testCreateVerificationLevelForReadiness(makeCtxWithReport(report));
    expect(result.level).toBe("real-smoke");
    expect(result.canClaimMature).toBe(true);
  });

  it("合成 smoke + partial 仍不升级", () => {
    const report: VerificationReport = {
      id: "r-syn-partial",
      status: "partial",
      summary: "synthetic smoke partial",
      commands: [step("smoke", "pass", { synthetic: true })],
      unverified: ["nothing real verified"],
      risk: [],
      startedAt: "",
      endedAt: "",
      durationMs: 0,
      nextAction: "",
    };
    const result = __testCreateVerificationLevelForReadiness(makeCtxWithReport(report));
    expect(result.level).not.toBe("real-smoke");
    expect(result.upgradeBlocked).toBe(true);
  });

  it("源码：/verify 合成 smoke 标记 synthetic=true，readiness 据此拒绝升级", async () => {
    const fs = await import("node:fs/promises");
    const planSrc = await fs.readFile("src/verification-command-runtime.ts", "utf8");
    expect(planSrc).toContain("synthetic: true");
    const readinessSrc = await fs.readFile("src/terminal-readiness-runtime.ts", "utf8");
    expect(readinessSrc).toMatch(/c\.synthetic\s*!==\s*true/);
  });
});

// ---------------------------------------------------------------------------
// D.13M — Anthropic thinking SSE: thinking-only / thinking+text / thinking+tool_use
// ---------------------------------------------------------------------------
describe("D.13M Anthropic thinking SSE → TUI behavior", () => {
  function setupClaudeAnthropicEnv(project: string) {
    vi.stubEnv("LINGHUN_OPENAI_BASE_URL", "https://relay.example.com/v1");
    vi.stubEnv("LINGHUN_OPENAI_API_KEY", "sk-test");
    vi.stubEnv("LINGHUN_OPENAI_MODEL", "claude-3-5-sonnet-latest");
    vi.stubEnv("LINGHUN_OPENAI_ENDPOINT_PROFILE", "anthropic_messages");
    vi.stubEnv("LINGHUN_DEFAULT_MODEL", "claude-3-5-sonnet-latest");
    return writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        defaultModel: "claude-3-5-sonnet-latest",
        providers: {
          deepseek: { model: "different-model" },
          "openai-compatible": {
            baseUrl: "https://relay.example.com/v1",
            apiKey: "sk-test",
            model: "claude-3-5-sonnet-latest",
            endpointProfile: "anthropic_messages",
          },
        },
      }),
      "utf8",
    );
  }

  function mockAnthropicSseFetch(streams: string[][]): Array<{ url: string }> {
    const requests: Array<{ url: string }> = [];
    const realFetch = globalThis.fetch.bind(globalThis);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        // 只拦截 LLM 调用（/v1/messages）。其它 fetch（如 codebase-memory wasm 加载用的
        // data:application/octet-stream;base64 / file:// 等）原样透传给真实 fetch，
        // 否则它们会被错算成 LLM 请求并消耗 streams[0]，或返回空 buffer 触发 wasm 解析失败。
        if (!u.includes("/v1/messages")) {
          return realFetch(url, init);
        }
        const idx = requests.length;
        requests.push({ url: u });
        const chunks = streams[idx] ?? streams[streams.length - 1] ?? [];
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
            controller.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }),
    );
    return requests;
  }

  it("thinking-only stream → TUI shows thinking-only message; transcript records hadThinking=yes via provider_empty_response", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-think-only-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await setupClaudeAnthropicEnv(project);

    const requests = mockAnthropicSseFetch([
      [
        'event: message_start\ndata: {"type":"message_start","message":{"id":"msg-think-only","usage":{"input_tokens":3}}}\n\n',
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"思考"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig"}}\n\n',
        'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ],
    ]);

    const output = new MemoryOutput();
    await runTui({
      projectPath: project,
      stdin: Readable.from(["请简单回答\n", "/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("https://relay.example.com/v1/messages");
    // thinking-only 文案：必须是新提示，不是通用 empty response 文案
    expect(output.text).toContain("模型已返回思考流但没有最终文本");
    expect(output.text).toContain("/model doctor");
    expect(output.text).not.toContain("模型没有返回有效回答。可运行 /model doctor 查看详情后重试。");

    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const sessions = await store.list();
    const transcript = (await store.resume(sessions[0]?.id ?? "")).transcript;
    expect(
      transcript.some(
        (event) =>
          event.type === "system_event" && event.message.includes("provider_empty_response"),
      ),
    ).toBe(true);
    expect(
      transcript.some(
        (event) => event.type === "system_event" && event.message.includes("hadThinking=yes"),
      ),
    ).toBe(true);
  });

  it("thinking_delta then text_delta → main screen shows only the final text, not the thinking content", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-think-text-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await setupClaudeAnthropicEnv(project);

    const secret = "INNER-THOUGHT-MUST-NOT-LEAK";
    const requests = mockAnthropicSseFetch([
      [
        'event: message_start\ndata: {"type":"message_start","message":{"id":"msg-think-text","usage":{"input_tokens":3}}}\n\n',
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}\n\n',
        `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"${secret}"}}\n\n`,
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"s"}}\n\n',
        'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
        'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"text"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"最终答复"}}\n\n',
        'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":4}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ],
    ]);

    const output = new MemoryOutput();
    await runTui({
      projectPath: project,
      stdin: Readable.from(["你好\n", "/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(requests).toHaveLength(1);
    expect(output.text).toContain("最终答复");
    expect(output.text).not.toContain(secret);
    expect(output.text).not.toContain("模型已返回思考流但没有最终文本");
    expect(output.text).not.toContain("模型没有返回有效回答");
  });

  it("thinking_delta then tool_use → tool/permission continuation is not blocked by empty-response", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-think-tool-"));
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(join(project, "package.json"), JSON.stringify({ name: "demo" }), "utf8");
    await setupClaudeAnthropicEnv(project);

    const requests = mockAnthropicSseFetch([
      [
        'event: message_start\ndata: {"type":"message_start","message":{"id":"msg-think-tool","usage":{"input_tokens":5}}}\n\n',
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"先思考"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"s"}}\n\n',
        'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
        'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_think_1","name":"Read"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"package.json\\"}"}}\n\n',
        'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":7}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ],
      [
        'event: message_start\ndata: {"type":"message_start","message":{"id":"msg-final","usage":{"input_tokens":10}}}\n\n',
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"已读取 package.json，分析完成。"}}\n\n',
        'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ],
    ]);

    const output = new MemoryOutput();
    await runTui({
      projectPath: project,
      stdin: Readable.from(["读一下 package.json\nyes\n/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    // 必须发了至少 2 轮（thinking+tool_use → 工具执行 → 继续模型）
    expect(requests.length).toBeGreaterThanOrEqual(2);
    expect(requests[0].url).toBe("https://relay.example.com/v1/messages");
    expect(requests[1].url).toBe("https://relay.example.com/v1/messages");
    // 不应该被空响应截断：thinking-only 提示和通用 empty response 提示都不应出现
    expect(output.text).not.toContain("模型已返回思考流但没有最终文本");
    expect(output.text).not.toContain("模型没有返回有效回答");
    // 第二轮 text_delta 必须落到主屏
    expect(output.text).toContain("已读取 package.json，分析完成。");
  });
});

// D.13O — Provider abort/timeout 后 continuation 路径必须早返回，不再让迟到
// 的 SSE delta 流入 transcript / 主屏 / continuation messages。直接 mock
// gateway 走 cancel 路径成本高且容易脆，因此用源码事实断言：sendMessage 的
// 主流和 continueModelAfterToolResults 的 continuation 流必须都包含
// `controller.signal.aborted` 的早返回守卫。这是 invariant test，不是镜像。
describe("D.13O safety boundary — provider abort early-return guard", () => {
  it("source: sendMessage main loop has aborted early-return", async () => {
    const text = await readFile("src/index.ts", "utf8");
    // 主流定位：`controller.signal.aborted` + `t(context, "toolInterrupted")`
    expect(text).toContain("if (controller.signal.aborted) {");
    expect(text).toMatch(/D\.13O[\s\S]*abort[\s\S]*continuation/iu);
  });

  it("source: continueModelAfterToolResults has aborted early-return", async () => {
    const text = await readFile("src/index.ts", "utf8");
    const continuationStart = text.indexOf("async function continueModelAfterToolResults");
    expect(continuationStart).toBeGreaterThan(-1);
    const continuationBody = text.slice(continuationStart, continuationStart + 4000);
    expect(continuationBody).toContain("controller.signal.aborted");
    expect(continuationBody).toContain("toolInterrupted");
  });
});

// D.13O — Workspace boundary: getHardDenyReason 必须 hard-deny UNC / WebDAV /
// 远程路径。本测试覆盖到 permission-continuation-runtime.ts 的修补；同时在
// permission-continuation-runtime.test.ts 里有更细粒度的单元覆盖。
describe("D.13O safety boundary — UNC/WebDAV hard deny", () => {
  it("source: getHardDenyReason rejects UNC backslash form", async () => {
    const text = await readFile("src/permission-continuation-runtime.ts", "utf8");
    expect(text).toContain('startsWith("\\\\\\\\")');
    expect(text).toContain('startsWith("//")');
    expect(text).toMatch(/UNC|WebDAV/iu);
  });
});

// D.13V-B/C — 主链接入与默认降噪：源码级 invariant。运行时行为已由
// model-loop-runtime.test.ts / tool-output-presenter.test.ts 单元覆盖；
// 这里只锁定接入点位与降噪点位不被悄悄回退。
describe("D.13V-B/C source invariants", () => {
  it("source: sendMessage 接入 architecture/completeness final gate", async () => {
    const text = await readFile("src/index.ts", "utf8");
    expect(text).toContain("runArchitectureAndCompletenessFinalGate");
    // D.14A-2：gate 判定核心移至 final-answer-gate.ts（行为不变）；
    // index.ts 仍负责把 runArchitectureAndCompletenessFinalGate 接入主链。
    const gate = await readFile("src/final-answer-gate.ts", "utf8");
    expect(gate).toContain("runArchitectureAndCompletenessFinalGate");
    expect(gate).toContain("evaluateArchitectureAndCompletenessClaims");
    expect(text).toContain("createExtendedFinalAnswerReminder");
    expect(text).toContain("buildExtendedDowngradedFinalAnswer");
    // 与 D.13U evaluateFinalAnswerClaims 共享一次重试预算（finalAnswerClaimRetried）
    expect(text).toMatch(/finalAnswerClaimRetried[\s\S]{0,1200}runArchitectureAndCompletenessFinalGate/);
  });

  it("source: continueModelAfterToolResults 镜像同一 gate", async () => {
    const text = await readFile("src/index.ts", "utf8");
    const start = text.indexOf("async function continueModelAfterToolResults");
    expect(start).toBeGreaterThan(-1);
    const body = text.slice(start, start + 12000);
    expect(body).toContain("runArchitectureAndCompletenessFinalGate");
    expect(body).toContain("buildExtendedDowngradedFinalAnswer");
  });

  // D.14A-R-Fix P1-1 — continuation 路径也要追加 Solution Completeness closure block，
  // 与 sendMessage 路径一致；且 closure 必须在安全 final answer 入 transcript 之后，
  // 不得位于 D.13U/D.13V retry/downgrade 之前（否则违规原文会先进 transcript）。
  it("source: continueModelAfterToolResults 镜像 Solution Completeness closure", async () => {
    const text = await readFile("src/index.ts", "utf8");
    const start = text.indexOf("async function continueModelAfterToolResults");
    expect(start).toBeGreaterThan(-1);
    const body = text.slice(start, start + 12000);
    expect(body).toContain("needsSolutionCompletenessReportClosure");
    expect(body).toContain("formatSolutionCompletenessReportBlock");
    // closure 必须在 assistant_text_delta append 之后（安全文本入 transcript 后才追加）
    const appendIdx = body.indexOf('type: "assistant_text_delta"');
    const closureIdx = body.indexOf("needsSolutionCompletenessReportClosure");
    expect(appendIdx).toBeGreaterThan(-1);
    expect(closureIdx).toBeGreaterThan(appendIdx);
    // closure 必须在 downgrade gate（buildExtendedDowngradedFinalAnswer）之后
    const downgradeIdx = body.lastIndexOf("buildExtendedDowngradedFinalAnswer");
    expect(closureIdx).toBeGreaterThan(downgradeIdx);
  });

  // D.14A-R-Fix P1-1 — closure helper 行为锁定：classification 已给出时不追加，
  // classificationRequired 且缺 classification 时才追加；block 文案不含违规原文。
  it("closure helper: 缺 classification 才追加，已分类不追加", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-closure-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session);
    context.solutionCompleteness = {
      ...createSolutionCompletenessStatus(),
      triggered: true,
      classificationRequired: true,
      classification: "unknown",
      impactAreas: ["runtime_behavior"],
    };
    // 最终答复未给 single_issue/systemic_gap → 需要 closure
    expect(needsSolutionCompletenessReportClosure(context, "我做了一些改动。")).toBe(true);
    const block = formatSolutionCompletenessReportBlock(context);
    expect(block).toContain("Solution Completeness Gate report");
    expect(block).toContain("classification:");
    expect(block).not.toContain("我做了一些改动。");
    // 最终答复已显式给出分类 → 不需要 closure
    expect(
      needsSolutionCompletenessReportClosure(context, "结论：这是 systemic_gap，影响面如下。"),
    ).toBe(false);
    // classificationRequired=false → 永不追加
    context.solutionCompleteness = createSolutionCompletenessStatus();
    expect(needsSolutionCompletenessReportClosure(context, "随便一句话")).toBe(false);
  });

  it("source: createModelSystemPrompt 用 projectRuntimeStatusForPrompt 投影 runtimeStatus", async () => {
    const text = await readFile("src/index.ts", "utf8");
    expect(text).toContain("projectRuntimeStatusForPrompt(runtimeStatus)");
    // RuntimeIdentityRule 不再依赖软约束：硬声明 RuntimeStatusForModel 不含 provider
    expect(text).toMatch(
      /RuntimeStatusForModel does not contain provider\/baseUrl\/endpointProfile by default/,
    );
  });

  it("source: deferred tool 主屏 writeLine 走 sanitizeDeferredToolPrimaryText", async () => {
    const text = await readFile("src/index.ts", "utf8");
    // executeDeferredDispatchToolUse 不应再出现 `writeLine(output, result.text)`
    // 直接传 raw text 的写法（这会泄漏 SearchExtraTools/ExecuteExtraTool 字面）。
    const dispatchStart = text.indexOf("async function executeDeferredDispatchToolUse");
    expect(dispatchStart).toBeGreaterThan(-1);
    const body = text.slice(dispatchStart, dispatchStart + 8000);
    expect(body).not.toMatch(/writeLine\(output, result\.text\);/);
    expect(body).toContain("sanitizeDeferredToolPrimaryText");
    expect(body).toContain('dispatchKind: "SearchExtraTools"');
    expect(body).toContain('dispatchKind: "ExecuteExtraTool"');
  });

  it("source: resource guard 文案标注 concurrency cap，不是权限拒绝", async () => {
    const text = await readFile("src/index.ts", "utf8");
    expect(text).toContain("RESOURCE_GUARD_KIND");
    // checkResourceGuard 的所有用户可见返回都应明确"并发上限/不是权限拒绝"。
    const guardStart = text.indexOf("function checkResourceGuard");
    expect(guardStart).toBeGreaterThan(-1);
    const guardBody = text.slice(guardStart, guardStart + 2000);
    expect(guardBody).toContain("并发上限");
    expect(guardBody).toContain("不是权限拒绝");
    // 不允许把 resource guard 声称为新权限模式
    expect(guardBody).not.toMatch(/(?:第五|fifth)\s*(?:权限|permission)/);
  });

  it("source: permission 仍然只有 default/auto-review/plan/full-access 四档", async () => {
    const text = await readFile("src/runtime-status-presenter.ts", "utf8");
    // formatPermissionModeLabel 必须保持四档；新增第五种会破坏分支
    expect(text).toMatch(/default:\s*"default mode"/);
    expect(text).toMatch(/"auto-review":\s*"auto mode"/);
    expect(text).toMatch(/plan:\s*"plan mode"/);
    expect(text).toMatch(/"full-access":\s*"bypass approvals"/);
  });

  // D.14A-R-Fix P1-7 — AntiCodeBlob 锁定为 prompt-only：它只出现在 prompt/directive，
  // 不是 hard gate；architecture-boundary 检测器不接入 Write/Edit/MultiEdit/Bash 主链阻断。
  it("source: AntiCodeBlob 是 prompt-only，不是 hard write gate", async () => {
    const promptSrc = await readFile("src/model-prompt-runtime.ts", "utf8");
    const archSrc = await readFile("src/architecture-runtime.ts", "utf8");
    // AntiCodeBlob/EngineeringStructure 仅作为 prompt/directive 文案存在
    expect(promptSrc).toContain("EngineeringStructure=");
    expect(archSrc).toContain("AntiCodeBlob=");
    // directive 必须显式标注 prompt-only / 不是 hard gate
    expect(archSrc).toContain("prompt-only");
    expect(archSrc).toMatch(/不是 hard gate|不是.*pre-write|不会自动.*阻断/);
    // 主链不得在写入前自动调用 architecture-boundary 检测器阻断
    const indexSrc = await readFile("src/index.ts", "utf8");
    expect(indexSrc).not.toMatch(/checkBoundaries\(/);
    expect(indexSrc).not.toMatch(/checkFileBoundaries\(/);
    expect(indexSrc).not.toMatch(/validateChangeDeclaration\(/);
    // architecture-boundary.ts 自身声明只检测、不改文件
    const boundarySrc = await readFile("src/architecture-boundary.ts", "utf8");
    expect(boundarySrc).toContain("Does NOT modify any files");
  });
});

describe("D.14G git stable point / managed worktree product closure", () => {
  // 在 throwaway 临时仓库里设置 local-only git identity（-c 形式，不写用户全局 config）。
  function gitInitRepo(dir: string): void {
    spawnSync("git", ["init"], { cwd: dir, windowsHide: true });
    spawnSync("git", ["config", "user.email", "test@linghun.local"], { cwd: dir, windowsHide: true });
    spawnSync("git", ["config", "user.name", "linghun-test"], { cwd: dir, windowsHide: true });
    spawnSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir, windowsHide: true });
  }
  function gitCommitAll(dir: string, message: string): void {
    spawnSync("git", ["add", "-A"], { cwd: dir, windowsHide: true });
    spawnSync("git", ["commit", "-m", message], { cwd: dir, windowsHide: true });
  }
  const hasGit = spawnSync("git", ["--version"], { windowsHide: true }).status === 0;
  const gitIt = hasGit ? it : it.skip;

  // runTui-based tests resolve the provider/model from the real machine config
  // (~/.linghun/provider.env) unless isolated. Mirror the CLI test's isolation:
  // point LINGHUN_CONFIG_DIR at a throwaway home and clear provider/model env vars
  // so the project's openai-compatible settings deterministically win.
  const MODEL_ENV_KEYS = [
    "LINGHUN_OPENAI_API_KEY",
    "LINGHUN_OPENAI_BASE_URL",
    "LINGHUN_OPENAI_MODEL",
    "LINGHUN_DEEPSEEK_API_KEY",
    "LINGHUN_DEEPSEEK_BASE_URL",
    "LINGHUN_DEEPSEEK_MODEL",
    "LINGHUN_DEFAULT_MODEL",
    "LINGHUN_INFERENCE_LEVEL",
    "OPENAI_API_KEY",
    "DEEPSEEK_API_KEY",
    "ANTHROPIC_API_KEY",
  ];
  async function isolateModelEnv(): Promise<void> {
    const home = await mkdtemp(join(tmpdir(), "linghun-d14g-home-"));
    await mkdir(join(home, ".linghun"), { recursive: true });
    vi.stubEnv("LINGHUN_CONFIG_DIR", join(home, ".linghun"));
    for (const key of MODEL_ENV_KEYS) {
      vi.stubEnv(key, undefined as unknown as string);
    }
  }
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // SSE-headed mock: the provider requires content-type to include event-stream,
  // so a bare new Response() (text/plain) is rejected as PROVIDER_NON_SSE_STREAM.
  // Each request N replies with toolCalls[N-1] if present, else the final text.
  function mockSseToolSequence(
    toolCalls: Array<{ toolName: string; input: unknown }>,
    finalText: string,
  ): unknown[] {
    const requests: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        requests.push(JSON.parse(String(init.body)));
        const tc = toolCalls[requests.length - 1];
        const body = tc
          ? `data: ${JSON.stringify({ id: `c${requests.length}`, choices: [{ delta: { tool_calls: [{ id: `call-${requests.length}`, type: "function", function: { name: tc.toolName, arguments: JSON.stringify(tc.input) } }] } }] })}\n\ndata: [DONE]\n\n`
          : `data: ${JSON.stringify({ id: `c${requests.length}`, choices: [{ delta: { content: finalText } }] })}\n\ndata: [DONE]\n\n`;
        return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
      }),
    );
    return requests;
  }

  async function makeRepoContext(): Promise<{ project: string; context: TuiContext; store: SessionStore }> {
    const project = await mkdtemp(join(tmpdir(), "linghun-d14g-"));
    gitInitRepo(project);
    await writeFile(join(project, "README.md"), "# repo\n", "utf8");
    gitCommitAll(project, "init");
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const context = await createTestContext(project, store, session);
    return { project, context, store };
  }

  gitIt("/git stable create commits tracked changes and records git_operation evidence", async () => {
    const { project, context } = await makeRepoContext();
    await writeFile(join(project, "README.md"), "# repo\n\nchanged\n", "utf8");
    const output = new MemoryOutput();

    await handleSlashCommand('/git stable create "feat: d14g stable"', context, output);

    expect(output.text).toContain("已建立稳定点");
    // 真实 commit 落地：git log 顶部是我们的 subject。
    const log = spawnSync("git", ["log", "-1", "--format=%s"], { cwd: project, windowsHide: true });
    expect(log.stdout.toString().trim()).toBe("feat: d14g stable");
    // git_operation evidence 记录，可支撑“已建立稳定点”声明。
    expect(
      context.evidence.some((e) => e.supportsClaims.includes("stable_point_created")),
    ).toBe(true);
  });

  gitIt("/git stable create on clean repo skips (no empty commit)", async () => {
    const { project, context } = await makeRepoContext();
    const before = spawnSync("git", ["rev-list", "--count", "HEAD"], { cwd: project, windowsHide: true }).stdout.toString().trim();
    const output = new MemoryOutput();

    await handleSlashCommand('/git stable create "noop"', context, output);

    expect(output.text).toContain("干净");
    const after = spawnSync("git", ["rev-list", "--count", "HEAD"], { cwd: project, windowsHide: true }).stdout.toString().trim();
    expect(after).toBe(before);
  });

  gitIt("/git stable create with only untracked → snapshot, no commit", async () => {
    const { project, context } = await makeRepoContext();
    await writeFile(join(project, "new-untracked.ts"), "export const x = 1;\n", "utf8");
    const before = spawnSync("git", ["rev-list", "--count", "HEAD"], { cwd: project, windowsHide: true }).stdout.toString().trim();
    const output = new MemoryOutput();

    await handleSlashCommand('/git stable create "untracked"', context, output);

    const after = spawnSync("git", ["rev-list", "--count", "HEAD"], { cwd: project, windowsHide: true }).stdout.toString().trim();
    expect(after).toBe(before);
    expect(output.text).toMatch(/snapshot|未跟踪/);
  });

  gitIt("/git stable create --include-untracked excludes sensitive files", async () => {
    const { project, context } = await makeRepoContext();
    await writeFile(join(project, "safe.ts"), "export const y = 2;\n", "utf8");
    await writeFile(join(project, ".env"), "SECRET=should-not-commit\n", "utf8");
    const output = new MemoryOutput();

    await handleSlashCommand('/git stable create "feat: incl" --include-untracked', context, output);

    // safe.ts committed; .env never tracked.
    const tracked = spawnSync("git", ["ls-files"], { cwd: project, windowsHide: true }).stdout.toString();
    expect(tracked).toContain("safe.ts");
    expect(tracked).not.toContain(".env");
  });

  gitIt("/worktree create makes a managed worktree under the controlled root", async () => {
    const { project, context } = await makeRepoContext();
    const output = new MemoryOutput();

    await handleSlashCommand("/worktree create d14g-feat", context, output);

    expect(output.text).toContain("已创建 worktree");
    const list = spawnSync("git", ["worktree", "list"], { cwd: project, windowsHide: true }).stdout.toString();
    expect(list).toContain(".linghun-worktrees");
    expect(list).toContain("d14g-feat");
    expect(
      context.evidence.some((e) => e.supportsClaims.includes("worktree_created")),
    ).toBe(true);
  });

  gitIt("/worktree create rejects an invalid (escaping) name without touching git", async () => {
    const { project, context } = await makeRepoContext();
    const output = new MemoryOutput();

    await handleSlashCommand("/worktree create ../escape", context, output);

    expect(output.text).toMatch(/非法|invalid|不能/);
    const list = spawnSync("git", ["worktree", "list"], { cwd: project, windowsHide: true }).stdout.toString();
    expect(list).not.toContain("escape");
  });

  gitIt("/worktree remove on a clean managed worktree asks for confirmation, then removes on yes", async () => {
    const { project, context } = await makeRepoContext();
    const createOut = new MemoryOutput();
    await handleSlashCommand("/worktree create d14g-rm", context, createOut);
    expect(createOut.text).toContain("已创建 worktree");

    const removeOut = new MemoryOutput();
    await handleSlashCommand("/worktree remove d14g-rm", context, removeOut);
    // 进入确认，未删除。
    expect(removeOut.text).toContain("确认删除");
    expect(context.pendingLocalApproval?.kind).toBe("git_worktree_remove");
    let list = spawnSync("git", ["worktree", "list"], { cwd: project, windowsHide: true }).stdout.toString();
    expect(list).toContain("d14g-rm");

    // 确认 yes → 真正删除。
    const yesOut = new MemoryOutput();
    await handleNaturalInput("yes", context, yesOut);
    expect(yesOut.text).toContain("已删除 worktree");
    expect(context.pendingLocalApproval).toBeUndefined();
    list = spawnSync("git", ["worktree", "list"], { cwd: project, windowsHide: true }).stdout.toString();
    expect(list).not.toContain("d14g-rm");
    expect(
      context.evidence.some((e) => e.supportsClaims.includes("worktree_removed")),
    ).toBe(true);
  });

  gitIt("/worktree remove deny (no) keeps the worktree", async () => {
    const { project, context } = await makeRepoContext();
    await handleSlashCommand("/worktree create d14g-keep", context, new MemoryOutput());

    await handleSlashCommand("/worktree remove d14g-keep", context, new MemoryOutput());
    expect(context.pendingLocalApproval?.kind).toBe("git_worktree_remove");

    const noOut = new MemoryOutput();
    await handleNaturalInput("no", context, noOut);
    expect(context.pendingLocalApproval).toBeUndefined();
    const list = spawnSync("git", ["worktree", "list"], { cwd: project, windowsHide: true }).stdout.toString();
    expect(list).toContain("d14g-keep");
  });

  gitIt("/worktree remove of an unmanaged worktree is refused (no confirmation)", async () => {
    const { project, context } = await makeRepoContext();
    // 在受控目录外创建一个 external worktree。
    const external = await mkdtemp(join(tmpdir(), "linghun-ext-"));
    spawnSync("git", ["worktree", "add", join(external, "ext-wt")], { cwd: project, windowsHide: true });
    const output = new MemoryOutput();

    await handleSlashCommand("/worktree remove ext-wt", context, output);

    expect(output.text).toMatch(/external|受控目录|not_managed|不允许/);
    expect(context.pendingLocalApproval).toBeUndefined();
  });

  gitIt("model GitStablePointCreate tool_use executes a real commit after confirmation and the final answer is evidence-backed", async () => {
    await isolateModelEnv();
    const { project, context, store } = await makeRepoContext();
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        ...defaultConfig,
        defaultModel: "git-model",
        providers: {
          ...defaultConfig.providers,
          "openai-compatible": {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "git-model",
          },
        },
      }),
      "utf8",
    );
    await writeFile(join(project, "README.md"), "# repo\n\nmodel-change\n", "utf8");

    const requests = mockSseToolSequence(
      [{ toolName: "GitStablePointCreate", input: { message: "feat: via model" } }],
      "已建立稳定点。",
    );

    await runTui({
      projectPath: project,
      // D.14D-R2 P1-1：default 模式下模型工具触发的稳定点先进权限确认，yes 后才执行。
      stdin: Readable.from(["帮我建立一个稳定点\n", "yes\n", "/exit\n"]),
      stdout: new MemoryOutput(),
      stderr: new MemoryOutput(),
    });

    // 模型确实发了 tool_call（≥2 轮）。
    expect(requests.length).toBeGreaterThanOrEqual(2);
    // 确认后真实 commit 落地。
    const log = spawnSync("git", ["log", "-1", "--format=%s"], { cwd: project, windowsHide: true });
    expect(log.stdout.toString().trim()).toBe("feat: via model");
    // git_operation evidence 写入 transcript。
    const sessions = await store.list();
    const transcript = (await store.resume(sessions[0]?.id ?? "")).transcript;
    expect(
      transcript.some(
        (e) => e.type === "evidence_record" && e.supportsClaims.includes("stable_point_created"),
      ),
    ).toBe(true);
  });

  gitIt("D.14D-R2 P1-1: model GitStablePointCreate waits for confirmation; deny creates no commit", async () => {
    await isolateModelEnv();
    const { project, store } = await makeRepoContext();
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        ...defaultConfig,
        defaultModel: "git-model",
        providers: {
          ...defaultConfig.providers,
          "openai-compatible": {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "git-model",
          },
        },
      }),
      "utf8",
    );
    await writeFile(join(project, "README.md"), "# repo\n\nuncommitted-change\n", "utf8");
    const baselineLog = spawnSync("git", ["log", "-1", "--format=%s"], {
      cwd: project,
      windowsHide: true,
    }).stdout.toString().trim();

    const requests = mockSseToolSequence(
      [{ toolName: "GitStablePointCreate", input: { message: "feat: should-not-commit" } }],
      "我不会声称已建立稳定点。",
    );
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      // 拒绝确认 → 不创建 commit/snapshot。
      stdin: Readable.from(["建立一个稳定点\n", "no\n", "/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(requests.length).toBeGreaterThanOrEqual(2);
    // HEAD 未变（未创建新 commit）。
    const log = spawnSync("git", ["log", "-1", "--format=%s"], { cwd: project, windowsHide: true });
    expect(log.stdout.toString().trim()).toBe(baselineLog);
    expect(log.stdout.toString().trim()).not.toBe("feat: should-not-commit");
    // 回灌给模型的 tool_result 明确未创建；无 stable_point_created evidence。
    const second = requests[1] as { messages?: { role?: string; content?: string }[] };
    const toolMessage = second?.messages?.find((message) => message.role === "tool");
    expect(toolMessage?.content).toContain("稳定点未创建");
    expect(toolMessage?.content).toContain('"outcome":"denied"');
    const sessions = await store.list();
    const transcript = (await store.resume(sessions[0]?.id ?? "")).transcript;
    expect(
      transcript.some(
        (e) => e.type === "evidence_record" && e.supportsClaims.includes("stable_point_created"),
      ),
    ).toBe(false);
  });

  gitIt("D.14D-R2 fix: model GitStablePointCreate in plan mode is rejected without commit or snapshot", async () => {
    await isolateModelEnv();
    const { project, store } = await makeRepoContext();
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        ...defaultConfig,
        defaultModel: "git-model",
        providers: {
          ...defaultConfig.providers,
          "openai-compatible": {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "git-model",
          },
        },
      }),
      "utf8",
    );
    await writeFile(join(project, "README.md"), "# repo\n\nplan-mode-change\n", "utf8");
    const baselineLog = spawnSync("git", ["log", "-1", "--format=%s"], {
      cwd: project,
      windowsHide: true,
    }).stdout.toString().trim();

    const requests = mockSseToolSequence(
      [{ toolName: "GitStablePointCreate", input: { message: "feat: forbidden in plan" } }],
      "Plan 模式下没有创建稳定点。",
    );
    const output = new MemoryOutput();

    await runTui({
      projectPath: project,
      stdin: Readable.from(["/mode plan\n", "建立一个稳定点\n", "/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    expect(requests.length).toBeGreaterThanOrEqual(2);
    expect(output.text).not.toContain("确认为当前工作区创建稳定点");
    const log = spawnSync("git", ["log", "-1", "--format=%s"], { cwd: project, windowsHide: true });
    expect(log.stdout.toString().trim()).toBe(baselineLog);
    expect(log.stdout.toString().trim()).not.toBe("feat: forbidden in plan");
    const snapshots = spawnSync("git", ["stash", "list"], { cwd: project, windowsHide: true }).stdout.toString();
    expect(snapshots).not.toContain("linghun-stable-point");

    const sessions = await store.list();
    const transcript = (await store.resume(sessions[0]?.id ?? "")).transcript;
    const toolResult = transcript.find(
      (e) => e.type === "tool_result" && e.toolName === "GitStablePointCreate",
    ) as { content?: unknown; isError?: boolean } | undefined;
    expect(toolResult?.isError).toBe(true);
    expect(JSON.stringify(toolResult?.content)).toContain(
      "stable point was NOT created because Plan mode is read-only",
    );
    expect(JSON.stringify(toolResult?.content)).toContain('"outcome":"plan_read_only"');
    expect(
      transcript.some(
        (e) => e.type === "evidence_record" && e.supportsClaims.includes("stable_point_created"),
      ),
    ).toBe(false);
    expect(
      transcript.some(
        (e) =>
          e.type === "system_event" &&
          e.message.includes("operation=stable_point_denied") &&
          e.message.includes("result=plan_read_only"),
      ),
    ).toBe(true);
  });

  gitIt("model claims a stable point WITHOUT calling the tool → final gate downgrades the claim", async () => {
    await isolateModelEnv();
    const { project, store } = await makeRepoContext();
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        ...defaultConfig,
        defaultModel: "git-model",
        providers: {
          ...defaultConfig.providers,
          "openai-compatible": {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "git-model",
          },
        },
      }),
      "utf8",
    );
    const output = new MemoryOutput();
    // 模型不调用工具，两轮都空口声称已建立稳定点。
    mockSseToolSequence([], "已建立稳定点，当前状态已保存。");

    await runTui({
      projectPath: project,
      stdin: Readable.from(["建立一个稳定点\n", "/exit\n"]),
      stdout: output,
      stderr: new MemoryOutput(),
    });

    // 没有 git_operation evidence → final gate 降级，不能让原文“已建立稳定点”原样通过。
    const sessions = await store.list();
    const transcript = (await store.resume(sessions[0]?.id ?? "")).transcript;
    const hasGitEvidence = transcript.some(
      (e) => e.type === "evidence_record" && e.supportsClaims.includes("stable_point_created"),
    );
    expect(hasGitEvidence).toBe(false);
    const downgraded = transcript.some(
      (e) =>
        e.type === "system_event" && /final_answer_claim_gate (?:retry|downgrade)/.test(e.message),
    );
    expect(downgraded).toBe(true);
  });
});

describe("D.14B Failure Learning Runtime — main-chain wiring", () => {
  const hasGit = spawnSync("git", ["--version"], { windowsHide: true }).status === 0;
  const gitIt = hasGit ? it : it.skip;

  function gitInitRepo(dir: string): void {
    spawnSync("git", ["init"], { cwd: dir, windowsHide: true });
    spawnSync("git", ["config", "user.email", "test@linghun.local"], { cwd: dir, windowsHide: true });
    spawnSync("git", ["config", "user.name", "linghun-test"], { cwd: dir, windowsHide: true });
    spawnSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir, windowsHide: true });
  }

  const MODEL_ENV_KEYS = [
    "LINGHUN_OPENAI_API_KEY",
    "LINGHUN_OPENAI_BASE_URL",
    "LINGHUN_OPENAI_MODEL",
    "LINGHUN_DEEPSEEK_API_KEY",
    "LINGHUN_DEEPSEEK_BASE_URL",
    "LINGHUN_DEEPSEEK_MODEL",
    "LINGHUN_DEFAULT_MODEL",
    "LINGHUN_INFERENCE_LEVEL",
    "OPENAI_API_KEY",
    "DEEPSEEK_API_KEY",
    "ANTHROPIC_API_KEY",
  ];
  async function isolateModelEnv(): Promise<void> {
    const home = await mkdtemp(join(tmpdir(), "linghun-d14b-home-"));
    await mkdir(join(home, ".linghun"), { recursive: true });
    vi.stubEnv("LINGHUN_CONFIG_DIR", join(home, ".linghun"));
    for (const key of MODEL_ENV_KEYS) {
      vi.stubEnv(key, undefined as unknown as string);
    }
  }
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function mockSseFinalText(finalText: string): unknown[] {
    const requests: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        requests.push(JSON.parse(String(init.body)));
        const body = `data: ${JSON.stringify({ id: `c${requests.length}`, choices: [{ delta: { content: finalText } }] })}\n\ndata: [DONE]\n\n`;
        return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
      }),
    );
    return requests;
  }

  function mergeFailureRecordForTest(
    context: TuiContext,
    input: Parameters<typeof mergeFailureRecord>[1],
  ) {
    return mergeFailureRecord(context.failureLearning, input).record;
  }

  async function loadFailureRecordsForTest(context: TuiContext) {
    return loadFailureRecords(context.failureLearning);
  }

  async function makePromptContext(): Promise<TuiContext> {
    const project = await mkdtemp(join(tmpdir(), "linghun-d14b-prompt-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "gpt-4.1" });
    return createTestContext(project, store, session);
  }

  async function readFailureFiles(
    project: string,
  ): Promise<Array<{ category: string; failureSummary: string }>> {
    const dir = join(project, ".linghun", "failures");
    const fsp = await import("node:fs/promises");
    let files: string[];
    try {
      files = await fsp.readdir(dir);
    } catch {
      return [];
    }
    const out: Array<{ category: string; failureSummary: string }> = [];
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      out.push(JSON.parse(await fsp.readFile(join(dir, f), "utf8")));
    }
    return out;
  }

  it("user cancel / permission deny is NOT recorded as a model failure", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    await writeFile(join(project, "large.json"), "x".repeat(1_100_000), "utf8");
    const mockDir = await mkdtemp(join(tmpdir(), "linghun-codebase-memory-mock-"));
    const { config } = await createMockCodebaseMemoryConfig(project, mockDir);
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session, config);

    await handleSlashCommand("/index refresh", context, output);
    await handleNaturalInput("帮我排除大文件 然后更新项目索引", context, output);
    await handleNaturalInput("no", context, output);

    // 拒绝/取消走 recordToolFailureEvidence（evidence 层），但绝不进 failure learning。
    expect(context.failureLearning.records).toHaveLength(0);
  });

  it("/failures is summary-first, lists active lessons, and never leaks sourceRef/secret", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "gpt-4.1" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);
    mergeFailureRecordForTest(context, {
      category: "provider_failure",
      failureSummary: "provider request failed code=PROVIDER_RATE_LIMITED https://relay.example.com sk-leak123",
      rootCauseGuess: "rate limited",
      avoidNextTime: "back off before retrying provider calls",
      sourceRef: "evidence:abc123",
      relatedTarget: "PROVIDER_RATE_LIMITED",
      severity: "high",
    });

    await handleSlashCommand("/failures", context, output);

    expect(output.text).toContain("失败学习");
    expect(output.text).toContain("back off");
    // 主屏摘要与 details 都不得泄漏 baseUrl/secret（sourceRef 是内部 evidence id，等同 memory 的 source=，允许）。
    expect(output.text).not.toContain("relay.example.com");
    expect(output.text).not.toContain("sk-leak123");
  });

  it("/failures resolve marks a record resolved and persists it", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "gpt-4.1" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);
    const record = mergeFailureRecordForTest(context, {
      category: "tool_failure",
      failureSummary: "Bash exited non-zero",
      rootCauseGuess: "command failed",
      avoidNextTime: "inspect the output",
      sourceRef: "evidence:abc",
      relatedTarget: "Bash",
      severity: "medium",
    });

    await handleSlashCommand(`/failures resolve ${record.id}`, context, output);

    expect(output.text).toContain("已解决");
    expect(context.failureLearning.records[0].status).toBe("resolved");
    const reloaded = await loadFailureRecordsForTest(context);
    expect(reloaded.find((r) => r.id === record.id)?.status).toBe("resolved");
  });

  it("FailureLearningSummary is injected into system prompt with a risk-hint rule and no secrets", async () => {
    const context = await makePromptContext();
    mergeFailureRecordForTest(context, {
      category: "provider_failure",
      failureSummary: "POST https://relay.example.com sk-leak999 failed",
      rootCauseGuess: "auth Bearer secret.token rejected",
      avoidNextTime: "verify provider config before retrying",
      sourceRef: "evidence:secret-id",
      relatedTarget: "PROVIDER_ERROR",
      severity: "high",
    });

    const prompt = createModelSystemPrompt(
      "继续",
      context,
      undefined,
      undefined,
      null,
      buildFailureLearningSummaryForPrompt(context.failureLearning),
    );

    expect(prompt).toContain("FailureLearningSummary=");
    expect(prompt).toContain("FailureLearningRule=");
    expect(prompt).toContain("verify provider config");
    // gate / anti-hallucination 边界：不得把历史失败当作已修复/已验证证据。
    expect(prompt).toMatch(/do NOT mean the current task has failed, is fixed, or is verified/);
    // 脱敏：prompt 不泄漏 secret/baseUrl/sourceRef。
    expect(prompt).not.toContain("relay.example.com");
    expect(prompt).not.toContain("sk-leak999");
    expect(prompt).not.toContain("secret.token");
    expect(prompt).not.toContain("secret-id");
  });

  it("no active lessons → FailureLearningSummary is not injected", async () => {
    const context = await makePromptContext();
    const prompt = createModelSystemPrompt(
      "继续",
      context,
      undefined,
      undefined,
      null,
      buildFailureLearningSummaryForPrompt(context.failureLearning),
    );
    expect(prompt).not.toContain("FailureLearningSummary=");
  });

  gitIt("final answer gate downgrade records a final_gate_downgrade lesson on disk", async () => {
    await isolateModelEnv();
    const project = await mkdtemp(join(tmpdir(), "linghun-d14b-"));
    gitInitRepo(project);
    await writeFile(join(project, "README.md"), "# repo\n", "utf8");
    spawnSync("git", ["add", "-A"], { cwd: project, windowsHide: true });
    spawnSync("git", ["commit", "-m", "init"], { cwd: project, windowsHide: true });
    await mkdir(join(project, ".linghun"), { recursive: true });
    await writeFile(
      join(project, ".linghun", "settings.json"),
      JSON.stringify({
        ...defaultConfig,
        defaultModel: "fl-model",
        providers: {
          ...defaultConfig.providers,
          "openai-compatible": {
            baseUrl: "https://example.test/v1",
            apiKey: "sk-test",
            model: "fl-model",
          },
        },
      }),
      "utf8",
    );
    // 模型空口声称"已完成、测试通过"，无 evidence → final gate 降级 → failure learning。
    // 输入本身不含代码事实关键词，避免命中输入侧 evidence gate；违规声明出现在模型回答里。
    mockSseFinalText("已完成，测试通过，PASS，一切就绪。");

    await runTui({
      projectPath: project,
      stdin: Readable.from(["帮我看看现在的整体情况\n", "/exit\n"]),
      stdout: new MemoryOutput(),
      stderr: new MemoryOutput(),
    });

    const files = await readFailureFiles(project);
    const categories = files.map((f) => f.category);
    expect(categories).toContain("final_gate_downgrade");
    // 持久化文件不含 secret/baseUrl。
    const raw = JSON.stringify(files);
    expect(raw).not.toContain("example.test");
    expect(raw).not.toContain("sk-test");
  });

  it("D.14B source invariant: business logic lives in failure-learning modules, index.ts only glues", async () => {
    const indexSrc = await readFile("src/index.ts", "utf8");
    // index.ts 只接线：调用 captureFailureLearning / 投影 summary / dispatch slash。
    expect(indexSrc).toContain("captureFailureLearning(context, sessionId");
    expect(indexSrc).toContain("buildFailureLearningSummaryForPrompt(context.failureLearning)");
    expect(indexSrc).toContain('handleFailuresCommand(rest, context, output)');
    // 业务逻辑（脱敏 / 去重 / 投影构建）不在 index.ts 重新实现。
    expect(indexSrc).not.toContain("function sanitizeFailureText");
    expect(indexSrc).not.toContain("function failureDedupeHash");
    expect(indexSrc).not.toContain("function buildFailureLearningSummaryForPrompt");

    const runtimeSrc = await readFile("src/failure-learning-runtime.ts", "utf8");
    expect(runtimeSrc).toContain("export function sanitizeFailureText");
    expect(runtimeSrc).toContain("export function failureDedupeHash");
    expect(runtimeSrc).toContain("export function buildFailureLearningSummaryForPrompt");
  });
});

describe("D.14C Multi-Agent baseline closure — agent failure wiring & source invariants", () => {
  it("D.14C: a forked worker whose write throws is marked failed and recorded as a real D.14B failure", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);
    context.permissionMode = "full-access";

    // 用真实文件系统冲突触发真实异常：在 "blocked" 处先建文件，再让 worker 写
    // "blocked/child.txt"。writeTool 的 mkdir(dirname) 会因父路径是文件而抛 ENOTDIR。
    await writeFile(join(project, "blocked"), "occupied", "utf8");
    await handleSlashCommand("/fork worker write blocked/child.txt hello", context, output);

    // agent 真实失败：状态 failed、background result=fail（不是 cancelled、不是 pass）。
    const failed = context.agents.find((agent) => agent.type === "worker");
    expect(failed?.status).toBe("failed");
    expect(output.text).toContain("执行失败");
    const agentTask = context.backgroundTasks.find((task) => task.id === failed?.id);
    expect(agentTask?.status).toBe("failed");
    expect(agentTask?.result).toBe("fail");

    // 真实失败搭车进 D.14B：落盘一条 tool_failure 教训；不进 context.evidence。
    const failures = await loadFailureRecords(context.failureLearning);
    const agentFailure = failures.find((record) => record.relatedTarget === "agent_worker");
    expect(agentFailure?.category).toBe("tool_failure");
    expect(agentFailure?.inferred).toBe(true);
    expect(context.evidence.some((item) => item.id === agentFailure?.id)).toBe(false);

    // 失败事件进父会话 transcript（status=failed），可追溯。
    const parentTranscript = (await store.resume(session.id)).transcript;
    expect(
      parentTranscript.some(
        (event) => event.type === "agent_end" && event.status === "failed",
      ),
    ).toBe(true);
  });

  it("D.14C: user-cancelled agent is NOT recorded as a model failure", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-tui-project-"));
    const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
    const session = await store.create({ model: "deepseek-v4-flash" });
    const output = new MemoryOutput();
    const context = await createTestContext(project, store, session);

    // 手动塞一个 running agent + 对应 background，再 /agents cancel 走真实取消路径。
    const now = new Date().toISOString();
    const child = await store.create({ model: session.model, summary: "agent:explorer:cancel me" });
    context.agents.unshift({
      id: "agent-cancel-d14c",
      type: "explorer",
      role: "executor",
      provider: "deepseek",
      parentSessionId: session.id,
      forkedFrom: "handoff-test",
      task: "cancel me",
      model: session.model,
      permissionMode: "plan",
      status: "running",
      transcriptPath: child.transcriptPath,
      transcriptSessionId: child.id,
      summary: "agent running",
      contextSummary: "trimmed",
      cost: { inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, estimatedCny: 0 },
      startedAt: now,
      updatedAt: now,
    });
    context.backgroundTasks.unshift({
      id: "agent-cancel-d14c",
      kind: "agent",
      title: "Agent cancel me",
      status: "running",
      startedAt: now,
      updatedAt: now,
      heartbeatIntervalMs: 30_000,
      staleAfterMs: 120_000,
      hasOutput: true,
      userVisibleSummary: "agent running",
    });

    await handleSlashCommand("/agents cancel agent-cancel-d14c", context, output);

    expect(context.agents[0]?.status).toBe("cancelled");
    // 用户取消不是模型失败：不落任何 failure learning 记录。
    const failures = await loadFailureRecords(context.failureLearning);
    expect(failures).toHaveLength(0);
  });

  it("D.14C source invariant: agent business logic lives in job-agent-command-runtime, index.ts only glues", async () => {
    const indexSrc = await readFile("src/index.ts", "utf8");
    // index.ts 只接线：dispatch /agents、/fork，并把 captureFailureLearning 注入运行时。
    expect(indexSrc).toContain("handleAgentsCommand(rest, context, output)");
    expect(indexSrc).toContain("handleForkCommand(rest, context, output)");
    expect(indexSrc).toContain("captureFailureLearning,");
    // agent 生命周期业务逻辑不在 index.ts 重新实现。
    expect(indexSrc).not.toContain("async function completeAgent");
    expect(indexSrc).not.toContain("async function runAgentWork");
    expect(indexSrc).not.toContain("async function runWorkerAgent");
    expect(indexSrc).not.toContain("async function failAgent");
    expect(indexSrc).not.toContain("async function cancelAgent");

    const agentSrc = await readFile("src/job-agent-command-runtime.ts", "utf8");
    expect(agentSrc).toContain("export async function completeAgent");
    expect(agentSrc).toContain("export async function runAgentWork");
    expect(agentSrc).toContain("export async function cancelAgent");
    // 失败接入 D.14B 且只在真实异常路径（completeAgent catch → failAgent）。
    expect(agentSrc).toContain("async function failAgent");
    expect(agentSrc).toContain("captureFailureLearning");
    // cancelAgent 不调用 captureFailureLearning（用户取消不是模型失败）。
    const cancelBody = agentSrc.slice(agentSrc.indexOf("export async function cancelAgent"));
    expect(cancelBody.slice(0, cancelBody.indexOf("\n}\n"))).not.toContain("captureFailureLearning");

    // 并发常量单一来源：job-agent-command-runtime 不再本地重复声明。
    expect(agentSrc).not.toContain("const DEFAULT_JOB_RUNNING_AGENT_CAP = 3");
    expect(agentSrc).not.toContain("const MAX_AGENTS = 20");
    expect(agentSrc).not.toContain("const BACKGROUND_KIND_CAPS");
  });
});
