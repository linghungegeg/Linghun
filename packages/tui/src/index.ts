import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import {
  stderr as defaultStderr,
  stdin as defaultStdin,
  stdout as defaultStdout,
} from "node:process";
import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";
import { type LinghunConfig, loadConfig, resolveStoragePaths } from "@linghun/config";
import {
  type CacheFreshness,
  type CacheTurnStats,
  type CacheWriteTokensSource,
  SessionStore,
  type TranscriptEvent,
  computePromptCacheHitRate,
} from "@linghun/core";
import {
  DeepSeekProvider,
  ModelGateway,
  type ModelMessage,
  type ModelUsage,
} from "@linghun/providers";
import { LINGHUN_NAME, type Language, type PermissionMode } from "@linghun/shared";
import {
  type DiffSummary,
  type TodoItem,
  type ToolContext,
  type ToolName,
  type ToolOutput,
  builtInTools,
  createToolContext,
  runTool,
} from "@linghun/tools";

export type TuiStatus = "ready";

export const tuiStatus: TuiStatus = "ready";

export type RunTuiOptions = {
  stdin?: Readable;
  stdout?: Writable;
  stderr?: Writable;
  projectPath?: string;
};

export type PermissionRule = {
  id: string;
  effect: "allow" | "ask" | "deny";
  toolName: ToolName | "*";
  risk?: "low" | "medium" | "high";
};

export type RecentPermissionRejection = {
  id: string;
  toolName: ToolName;
  mode: PermissionMode;
  reason: string;
  createdAt: string;
};

export type PermissionState = {
  rules: PermissionRule[];
  recentDenied: RecentPermissionRejection[];
};

export type PlanProposal = {
  id: string;
  title: string;
  options: { id: string; title: string; steps: string[]; risks: string[] }[];
};

export type BackgroundTaskStatus = "running" | "paused" | "completed" | "failed" | "cancelled";

export type BackgroundTaskState = {
  id: string;
  kind: "bash" | "verification" | "compact" | "agent" | "job" | "mcp";
  title: string;
  status: BackgroundTaskStatus;
  currentStep?: string;
  progress?: { completed: number; total?: number; label?: string };
  startedAt: string;
  updatedAt: string;
  lastOutputAt?: string;
  estimatedRemainingMs?: number;
  heartbeatIntervalMs: number;
  staleAfterMs: number;
  logPath?: string;
  outputPath?: string;
  hasOutput: boolean;
  result?: "pass" | "fail" | "partial" | "cancelled";
  userVisibleSummary: string;
  nextAction?: string;
};

export type CheckpointState = {
  id: string;
  sessionId: string;
  createdAt: string;
  reason: string;
  changedFiles: string[];
  restoreKind: "git" | "snapshot";
  files: { path: string; existed: boolean; content?: string }[];
};

export type EvidenceRecord = {
  id: string;
  kind:
    | "file_read"
    | "grep_result"
    | "index_query"
    | "command_output"
    | "test_result"
    | "web_source"
    | "user_provided";
  summary: string;
  source: string;
  supportsClaims: string[];
  createdAt: string;
};

export type VerificationStepKind = "test" | "typecheck" | "build" | "lint" | "smoke";

export type VerificationStep = {
  kind: VerificationStepKind;
  command: string;
  reason: string;
};

const VERIFICATION_COMMAND_TIMEOUT_MS = 10 * 60 * 1000;

export type VerificationCommandResult = VerificationStep & {
  status: "pass" | "fail" | "partial" | "skipped";
  exitCode?: number;
  durationMs: number;
  logPath?: string;
  summary: string;
  runnerError?: string;
};

export type VerificationReport = {
  id: string;
  status: "pass" | "fail" | "partial";
  summary: string;
  commands: VerificationCommandResult[];
  unverified: string[];
  risk: string[];
  logPath?: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  nextAction: string;
};

export type CacheHistoryConfig = {
  maxTurns: number;
  warnBelowHitRate: number;
  persistPath: string;
  hintsMuted: boolean;
};

export type LightHint = {
  id: string;
  severity: "info" | "warning";
  message: string;
  suggestedCommand: string;
  dedupeKey: string;
  cooldownMs: number;
};

export type CacheState = {
  config: CacheHistoryConfig;
  history: CacheTurnStats[];
  nextTurn: number;
  lastFreshness?: CacheFreshness;
  hintLastShownAt: Record<string, number>;
  compacted: boolean;
  startedAt: number;
};

export type McpServerState = {
  name: string;
  command: string;
  status: "configured" | "disabled" | "missing" | "error";
  error?: string;
};

export type McpToolState = {
  server: string;
  name: string;
  description: string;
};

export type McpState = {
  enabled: boolean;
  servers: McpServerState[];
  tools: McpToolState[];
  lastDoctor?: string;
};

export type IndexState = {
  enabled: boolean;
  projectName?: string;
  status: "unknown" | "ready" | "missing" | "stale" | "error" | "indexing";
  nodes?: number;
  edges?: number;
  indexedAt?: string;
  changedFiles?: number;
  staleHint?: string;
  safetyWarning?: string;
  error?: string;
  lastQuery?: string;
  lastSummary?: string;
};

export type HandoffPacket = {
  id: string;
  sessionId: string;
  projectPath: string;
  parentSessionId?: string;
  currentPhase: string;
  nextPhase: string;
  phaseStatus: "pending" | "in_progress" | "completed" | "blocked";
  goal: string;
  completed: string[];
  pending: string[];
  mustNotDo: string[];
  todos: TodoItem[];
  keyFiles: string[];
  changedFiles: string[];
  evidenceRefs: Array<Pick<EvidenceRecord, "id" | "kind" | "source" | "summary">>;
  verification: VerificationReport | null;
  risks: string[];
  indexStatus: Pick<
    IndexState,
    "projectName" | "status" | "nodes" | "edges" | "changedFiles" | "staleHint"
  >;
  permissionMode: PermissionMode;
  modelProvider: { provider: string; model: string };
  recentCommit: string;
  budgetUsage: string;
  createdAt: string;
  generatedBy: string;
};

export type MemoryCandidate = {
  id: string;
  scope: "project" | "user";
  summary: string;
  source: string;
  createdAt: string;
};

export type MemoryState = {
  projectRulesPath: string;
  projectRulesExists: boolean;
  projectRulesSummary: string;
  projectRulesError?: string;
  projectDir: string;
  userDir: string;
  sessionDir: string;
  candidates: MemoryCandidate[];
  accepted: MemoryCandidate[];
  lastHandoff?: HandoffPacket;
  lastResumeReadonly?: boolean;
};

type MessageKey =
  | "appTitle"
  | "intro"
  | "currentModel"
  | "unknownCommand"
  | "exit"
  | "status"
  | "statusShort"
  | "help"
  | "inputPrompt"
  | "noSessions"
  | "sessionHeader"
  | "noSummary"
  | "checkpointCreated"
  | "checkpointNone"
  | "checkpointRestored"
  | "checkpointMissing"
  | "backgroundNone"
  | "backgroundEmptyOutput"
  | "backgroundRunning"
  | "interruptIdle"
  | "interruptCancelled"
  | "btwPrefix"
  | "evidenceBlocked"
  | "claimNeedsDisclaimer";

export type TuiContext = {
  store: SessionStore;
  sessionId?: string;
  sessionEnded?: boolean;
  model: string;
  permissionMode: PermissionMode;
  projectPath: string;
  tools: ToolContext;
  permissions: PermissionState;
  language: Language;
  config: LinghunConfig;
  backgroundTasks: BackgroundTaskState[];
  checkpoints: CheckpointState[];
  evidence: EvidenceRecord[];
  cache: CacheState;
  mcp: McpState;
  index: IndexState;
  memory: MemoryState;
  lastVerification?: VerificationReport;
  activePlan?: PlanProposal;
  planAccepted?: boolean;
  interrupt?: { type: "idle" } | { type: "running"; taskId: string; canCancel: boolean };
};

const DEFAULT_CACHE_HISTORY_SIZE = 20;
const MIN_CACHE_HISTORY_SIZE = 1;
const MAX_CACHE_HISTORY_SIZE = 200;
const DEFAULT_CACHE_WARN_BELOW_HIT_RATE = 0.75;
const DEFAULT_LIGHT_HINT_COOLDOWN_MS = 5 * 60 * 1000;
const CHAT_COMPLETIONS_ENDPOINT = "/v1/chat/completions";
const LARGE_INDEX_FILE_BYTES = 1_000_000;
const LARGE_INDEX_FILE_LIMIT = 12;
const LARGE_INDEX_RISK_EXTENSIONS = new Set([".json", ".sql", ".xml"]);
const LARGE_INDEX_RISK_DIRS = new Set([
  ".next",
  ".turbo",
  ".venv",
  "assets",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "public",
  "target",
  "vendor",
  "venv",
]);
const INDEX_SCAN_SKIP_DIRS = new Set([".git", ".codebase-memory", ".linghun"]);
const PROJECT_RULES_SUMMARY_WIDTH = 600;
const PROJECT_RULES_STATUS_WIDTH = 160;

export function createCacheState(
  projectPath: string,
  model = "deepseek-v4-flash",
  mcpToolList: McpToolState[] = [],
): CacheState {
  const freshness = createCacheFreshness({
    systemPrompt: "Linghun Phase 11 engineering assistant",
    toolSchema: builtInTools,
    mcpToolList: stabilizeMcpToolList(mcpToolList),
    model,
    provider: "deepseek",
    projectRules: "local CLAUDE.md rules loaded by harness",
    memory: "Phase 11 memory/handoff not loaded yet",
    compact: "not compacted",
    plugins: [],
  });
  return {
    config: {
      maxTurns: DEFAULT_CACHE_HISTORY_SIZE,
      warnBelowHitRate: DEFAULT_CACHE_WARN_BELOW_HIT_RATE,
      persistPath: join(projectPath, ".linghun", "cache-log.json"),
      hintsMuted: false,
    },
    history: [],
    nextTurn: 1,
    lastFreshness: freshness,
    hintLastShownAt: {},
    compacted: false,
    startedAt: Date.now(),
  };
}

export function createMcpState(config: LinghunConfig): McpState {
  const servers = Object.entries(config.mcp.servers)
    .map(
      ([name, server]) =>
        ({
          name,
          command: server.command,
          status: server.disabled ? "disabled" : "configured",
        }) satisfies McpServerState,
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    enabled: config.mcp.enabledServers.length > 0,
    servers,
    tools: stabilizeMcpToolList(
      servers
        .filter((server) => server.status === "configured")
        .map((server) => ({
          server: server.name,
          name: `${server.name}.status`,
          description:
            "MCP server health and tool discovery placeholder; real tool schemas are not dumped.",
        })),
    ),
  };
}

export function createIndexState(config: LinghunConfig): IndexState {
  return {
    enabled: config.index.enabled,
    status: config.index.enabled ? "unknown" : "missing",
  };
}

export async function createMemoryState(
  config: LinghunConfig,
  projectPath: string,
): Promise<MemoryState> {
  const paths = resolveStoragePaths(config, projectPath);
  const projectRulesPath = join(projectPath, "LINGHUN.md");
  const projectRules = await loadProjectRulesSummary(projectRulesPath);
  return {
    projectRulesPath,
    projectRulesExists: projectRules.exists,
    projectRulesSummary: projectRules.summary,
    ...(projectRules.error ? { projectRulesError: projectRules.error } : {}),
    projectDir: paths.memoryProject,
    userDir: paths.memoryUser,
    sessionDir: paths.memorySession,
    candidates: [],
    accepted: await loadAcceptedMemory(paths.memoryProject, paths.memoryUser),
  };
}

async function loadProjectRulesSummary(
  path: string,
): Promise<{ exists: boolean; summary: string; error?: string }> {
  try {
    const content = await readFile(path, "utf8");
    return { exists: true, summary: summarizeProjectRules(content) };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { exists: false, summary: "missing" };
    }
    return { exists: false, summary: "unreadable", error: formatError(error) };
  }
}

function summarizeProjectRules(content: string): string {
  const normalized = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(" ")
    .replace(/\s+/g, " ");
  return truncateDisplay(normalized || "empty", PROJECT_RULES_SUMMARY_WIDTH);
}

async function loadAcceptedMemory(projectDir: string, userDir: string): Promise<MemoryCandidate[]> {
  const [projectMemory, userMemory] = await Promise.all([
    loadAcceptedMemoryDir(projectDir),
    loadAcceptedMemoryDir(userDir),
  ]);
  return [...projectMemory, ...userMemory].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function loadAcceptedMemoryDir(directory: string): Promise<MemoryCandidate[]> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return [];
  }

  const memory = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json"))
      .map(async (entry) => readMemoryCandidate(join(directory, entry))),
  );
  return memory.filter((item): item is MemoryCandidate => item !== null);
}

async function readMemoryCandidate(path: string): Promise<MemoryCandidate | null> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!isMemoryCandidate(value)) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function isMemoryCandidate(value: unknown): value is MemoryCandidate {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (value.scope === "project" || value.scope === "user") &&
    typeof value.summary === "string" &&
    typeof value.source === "string" &&
    typeof value.createdAt === "string"
  );
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function runTui(options: RunTuiOptions = {}): Promise<number> {
  const input = options.stdin ?? defaultStdin;
  const output = options.stdout ?? defaultStdout;
  const errorOutput = options.stderr ?? defaultStderr;
  const projectPath = options.projectPath ?? process.cwd();
  const config = await loadConfig(projectPath);
  const storagePaths = resolveStoragePaths(config, projectPath);
  const store = new SessionStore({ sessionRootDir: storagePaths.sessions, projectPath });
  const context: TuiContext = {
    store,
    model: config.providers.deepseek.model,
    permissionMode: config.permission.defaultMode,
    projectPath,
    tools: createToolContext(projectPath),
    permissions: await loadPermissionState(projectPath),
    language: config.language,
    config,
    backgroundTasks: [],
    checkpoints: [],
    evidence: [],
    cache: createCacheState(projectPath, config.providers.deepseek.model),
    mcp: createMcpState(config),
    index: createIndexState(config),
    memory: await createMemoryState(config, projectPath),
    interrupt: { type: "idle" },
  };
  const gateway = new ModelGateway([
    new DeepSeekProvider({
      ...config.providers.deepseek,
      id: "deepseek",
      displayName: "DeepSeek",
    }),
  ]);

  writeLine(output, t(context, "appTitle", { name: LINGHUN_NAME }));
  writeStatus(output, context);
  writeLine(output, `${t(context, "intro")}\n`);
  if (!context.memory.projectRulesExists) {
    writeLine(
      output,
      "[hint:info] 缺少 LINGHUN.md 项目规则；如需基础模板，可运行 /memory init。不会自动生成或打断输入。",
    );
  }

  try {
    for await (const line of readInputLines(input, output)) {
      const text = line.trim();
      if (!text) {
        continue;
      }

      const commandResult = await handleSlashCommand(text, context, output);
      if (commandResult === "exit") {
        if (context.sessionId && !context.sessionEnded) {
          await store.appendEvent(context.sessionId, createSessionEndEvent(context.sessionId));
          context.sessionEnded = true;
        }
        writeLine(output, t(context, "exit"));
        return 0;
      }
      if (commandResult === "message") {
        await sendMessage(text, context, gateway, output);
      }
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "TUI 运行失败。";
    writeLine(errorOutput, `错误：${message}`);
    return 1;
  }
}

export async function handleSlashCommand(
  text: string,
  context: TuiContext,
  output: Writable,
): Promise<"handled" | "exit" | "message"> {
  if (!text.startsWith("/")) {
    return "message";
  }

  const [command, ...rest] = text.split(/\s+/);
  if (command === "/help") {
    writeLine(output, formatHelp(context.language));
    return "handled";
  }
  if (command === "/model") {
    writeLine(output, `${t(context, "currentModel")}：${context.model}`);
    writeStatus(output, context);
    return "handled";
  }
  if (command === "/language") {
    await handleLanguageCommand(rest, context, output);
    return "handled";
  }
  if (command === "/mode") {
    await handleModeCommand(rest, context, output);
    return "handled";
  }
  if (command === "/plan") {
    await handlePlanCommand(rest, context, output);
    return "handled";
  }
  if (command === "/permissions") {
    await handlePermissionsCommand(rest, context, output);
    return "handled";
  }
  if (command === "/background") {
    await handleBackgroundCommand(rest, context, output);
    return "handled";
  }
  if (command === "/rewind") {
    await handleRewindCommand(rest, context, output);
    return "handled";
  }
  if (command === "/btw") {
    await handleBtwCommand(rest, context, output);
    return "handled";
  }
  if (command === "/interrupt") {
    await handleInterruptCommand(context, output);
    return "handled";
  }
  if (command === "/claim-check") {
    await handleClaimCheckCommand(rest, context, output);
    return "handled";
  }
  if (command === "/verify") {
    await handleVerifyCommand(rest, context, output);
    return "handled";
  }
  if (command === "/review") {
    await handleReviewCommand(context, output);
    return "handled";
  }
  if (command === "/cache-log") {
    await handleCacheLogCommand(rest, context, output);
    return "handled";
  }
  if (command === "/cache") {
    await handleCacheCommand(rest, context, output);
    return "handled";
  }
  if (command === "/break-cache") {
    await handleBreakCacheCommand(rest, context, output);
    return "handled";
  }
  if (command === "/mcp") {
    await handleMcpCommand(rest, context, output);
    return "handled";
  }
  if (command === "/index") {
    await handleIndexCommand(rest, context, output);
    return "handled";
  }
  if (command === "/resume") {
    await handleResumeCommand(rest, context, output);
    return "handled";
  }
  if (command === "/branch") {
    await handleBranchCommand(rest, context, output);
    return "handled";
  }
  if (command === "/memory") {
    await handleMemoryCommand(rest, context, output);
    return "handled";
  }
  if (command === "/usage") {
    writeLine(output, formatUsage(context));
    return "handled";
  }
  if (command === "/stats") {
    writeLine(output, formatStats(rest, context));
    return "handled";
  }
  if (command === "/status") {
    writeStatus(output, context);
    return "handled";
  }
  if (command === "/tab") {
    await cycleMode(context, output);
    return "handled";
  }
  if (command === "/sessions") {
    if (rest[0] === "resume") {
      const sessionId = rest[1];
      if (!sessionId) {
        writeLine(output, "用法：/sessions resume <id>");
        return "handled";
      }
      await resumeSessionWithHandoff(sessionId, context, output, "sessions resume");
      return "handled";
    }

    const sessions = await context.store.list();
    if (sessions.length === 0) {
      writeLine(output, t(context, "noSessions"));
      return "handled";
    }
    writeLine(output, t(context, "sessionHeader"));
    for (const session of sessions) {
      const marker = session.id === context.sessionId ? "*" : " ";
      writeLine(
        output,
        `${marker} ${session.id}  ${session.updatedAt}  ${session.summary ?? t(context, "noSummary")}`,
      );
    }
    return "handled";
  }
  const toolName = slashCommandToTool(command);
  if (toolName) {
    await handleToolCommand(toolName, rest, context, output);
    return "handled";
  }
  if (command === "/exit") {
    return "exit";
  }

  writeLine(output, `未知命令：${command}。输入 /help 查看可用命令。`);
  return "handled";
}

async function handleModeCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const nextMode = args[0] as PermissionMode | undefined;
  if (!nextMode) {
    writeLine(output, `当前权限模式：${context.permissionMode}`);
    writeLine(output, "可选：default / plan / acceptEdits / dontAsk / auto / bypass");
    return;
  }
  if (!isPermissionMode(nextMode)) {
    writeLine(output, "未知模式。可选：default / plan / acceptEdits / dontAsk / auto / bypass");
    return;
  }
  if (context.permissionMode === "plan" && nextMode === "bypass" && !context.planAccepted) {
    writeLine(
      output,
      "Plan 模式不能直接切到 bypass 执行写入。请先运行 /plan accept <方案> 确认计划，或切回 default。 ",
    );
    return;
  }
  context.permissionMode = nextMode;
  context.planAccepted = false;
  writeLine(output, `已切换权限模式：${nextMode}`);
  if (nextMode === "plan") {
    writeLine(
      output,
      "Plan 模式只允许 Read / Grep / Glob / Diff / Todo 等只读或会话内操作。确认方案后再执行写入。",
    );
  }
  writeStatus(output, context);
}

function cycleMode(context: TuiContext, output: Writable): void {
  const modes: PermissionMode[] = ["default", "plan", "acceptEdits", "auto"];
  const index = modes.indexOf(context.permissionMode);
  context.permissionMode = modes[(index + 1) % modes.length] ?? "default";
  context.planAccepted = false;
  writeLine(output, `已切换模式：${context.permissionMode}（/tab 等价 Shift+Tab）`);
  writeStatus(output, context);
}

async function handlePlanCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0];
  if (action === "accept") {
    if (!context.activePlan) {
      writeLine(output, "当前没有待确认计划。先运行 /plan 生成结构化方案。");
      return;
    }
    const optionId = args[1] ?? context.activePlan.options[0]?.id ?? "a";
    context.planAccepted = true;
    context.permissionMode = "default";
    const sessionId = await ensureSession(context);
    await context.store.appendEvent(sessionId, {
      type: "plan_decision",
      proposalId: context.activePlan.id,
      optionId,
      decision: "accepted",
      createdAt: new Date().toISOString(),
    });
    writeLine(
      output,
      `已确认计划 ${context.activePlan.id} / 方案 ${optionId}，已回到 default 模式，可以执行允许的写入路径。`,
    );
    writeStatus(output, context);
    return;
  }

  const proposal: PlanProposal = {
    id: randomUUID(),
    title: "Phase 06 执行前计划",
    options: [
      {
        id: "a",
        title: "最小权限闭环（推荐）",
        steps: [
          "先用 Read/Grep/Glob/Diff 收集证据",
          "确认写入文件和风险摘要",
          "执行工作区内允许的低/中风险改动",
          "运行最小必要验证",
        ],
        risks: ["需要写入时必须离开 plan 或确认计划", "Bash 不会在 acceptEdits 中自动放行"],
      },
      {
        id: "b",
        title: "只读审查",
        steps: ["保持 plan 模式", "只运行 Read/Grep/Glob/Diff/Todo", "输出建议，不写文件"],
        risks: ["不会完成需要落盘的代码改动"],
      },
    ],
  };
  context.activePlan = proposal;
  context.permissionMode = "plan";
  context.planAccepted = false;
  const sessionId = await ensureSession(context);
  await context.store.appendEvent(sessionId, {
    type: "plan_proposal",
    proposal,
    createdAt: new Date().toISOString(),
  });
  writeLine(output, formatPlanProposal(proposal));
  writeLine(output, "确认执行请运行：/plan accept a；继续只读请保持 /mode plan。 ");
  writeStatus(output, context);
}

async function handleLanguageCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const language = args[0] as Language | undefined;
  if (!language) {
    writeLine(output, `language: ${context.language}`);
    return;
  }
  if (language !== "zh-CN" && language !== "en-US") {
    writeLine(output, "usage: /language zh-CN|en-US");
    return;
  }
  context.language = language;
  writeLine(output, language === "zh-CN" ? "语言已切换为中文。" : "Language switched to English.");
  writeStatus(output, context);
}

async function handlePermissionsCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const [action, ...rest] = args;
  if (!action) {
    writeLine(output, formatPermissionRules(context.permissions));
    return;
  }
  if (action === "recent") {
    if (rest[0] === "clear") {
      context.permissions.recentDenied = [];
      await savePermissionState(context.projectPath, context.permissions);
      writeLine(output, "已清空最近拒绝记录。");
      return;
    }
    if (rest[0] === "delete" || rest[0] === "remove") {
      const id = rest[1];
      if (!id) {
        writeLine(output, "用法：/permissions recent delete <id>");
        return;
      }
      const before = context.permissions.recentDenied.length;
      context.permissions.recentDenied = context.permissions.recentDenied.filter(
        (item) => item.id !== id,
      );
      await savePermissionState(context.projectPath, context.permissions);
      writeLine(
        output,
        before === context.permissions.recentDenied.length
          ? `未找到最近拒绝：${id}`
          : `已删除最近拒绝：${id}`,
      );
      return;
    }
    writeLine(output, formatRecentDenied(context.permissions));
    return;
  }
  if (action === "add") {
    const effect = rest[0] as PermissionRule["effect"] | undefined;
    const toolName = rest[1] as ToolName | "*" | undefined;
    const risk = rest[2] as PermissionRule["risk"] | undefined;
    if (!effect || !["allow", "ask", "deny"].includes(effect) || !toolName) {
      writeLine(output, "用法：/permissions add allow|ask|deny <tool|*> [low|medium|high]");
      return;
    }
    if (toolName !== "*" && !(toolName in builtInTools)) {
      writeLine(output, `未知工具：${toolName}`);
      return;
    }
    const rule: PermissionRule = { id: randomUUID(), effect, toolName, risk };
    context.permissions.rules.push(rule);
    await savePermissionState(context.projectPath, context.permissions);
    writeLine(output, `已添加权限规则：${rule.id} ${effect} ${toolName}${risk ? ` ${risk}` : ""}`);
    return;
  }
  if (action === "remove") {
    const id = rest[0];
    if (!id) {
      writeLine(output, "用法：/permissions remove <id>");
      return;
    }
    const before = context.permissions.rules.length;
    context.permissions.rules = context.permissions.rules.filter((rule) => rule.id !== id);
    await savePermissionState(context.projectPath, context.permissions);
    writeLine(
      output,
      before === context.permissions.rules.length ? `未找到规则：${id}` : `已删除规则：${id}`,
    );
    return;
  }
  writeLine(
    output,
    "用法：/permissions | /permissions add | /permissions remove | /permissions recent",
  );
}

async function handleBackgroundCommand(
  _args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  if (context.backgroundTasks.length === 0) {
    writeLine(output, t(context, "backgroundNone"));
    return;
  }
  for (const task of context.backgroundTasks) {
    writeLine(output, formatBackgroundTask(task, context.language));
  }
}

async function handleRewindCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0];
  if (!action || action === "list") {
    if (context.checkpoints.length === 0) {
      writeLine(output, t(context, "checkpointNone"));
      return;
    }
    writeLine(
      output,
      context.checkpoints
        .map(
          (checkpoint) =>
            `${checkpoint.id}  ${checkpoint.createdAt}  ${checkpoint.changedFiles.join(", ")}`,
        )
        .join("\n"),
    );
    return;
  }
  if (action !== "restore") {
    writeLine(output, "用法：/rewind | /rewind restore <checkpointId>");
    return;
  }
  const checkpointId = args[1] ?? context.checkpoints[0]?.id;
  if (!checkpointId) {
    writeLine(output, t(context, "checkpointNone"));
    return;
  }
  const checkpoint = context.checkpoints.find((item) => item.id === checkpointId);
  if (!checkpoint) {
    writeLine(output, `${t(context, "checkpointMissing")}：${checkpointId}`);
    return;
  }
  for (const file of checkpoint.files) {
    const target = resolve(context.projectPath, file.path);
    if (!file.existed) {
      await rm(target, { force: true });
      continue;
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content ?? "", "utf8");
  }
  context.tools.changedFiles = uniqueStrings([
    ...context.tools.changedFiles,
    ...checkpoint.changedFiles,
  ]);
  const sessionId = await ensureSession(context);
  await context.store.appendEvent(sessionId, {
    type: "checkpoint_restored",
    checkpointId: checkpoint.id,
    createdAt: new Date().toISOString(),
  });
  writeLine(output, `${t(context, "checkpointRestored")}：${checkpoint.id}`);
  writeStatus(output, context);
}

async function handleBtwCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const question = args.join(" ").trim();
  if (!question) {
    writeLine(output, "用法：/btw <临时小问题>");
    return;
  }
  const answer = `${t(context, "btwPrefix")}：${question}\n${context.language === "en-US" ? "This temporary answer does not change Todo, plan, or checkpoints." : "这次临时回答不会修改 Todo、Plan 或 checkpoint。"}`;
  const sessionId = await ensureSession(context);
  await context.store.appendEvent(sessionId, {
    type: "btw_question",
    id: randomUUID(),
    text: question,
    answer,
    createdAt: new Date().toISOString(),
  });
  writeLine(output, answer);
}

async function handleInterruptCommand(context: TuiContext, output: Writable): Promise<void> {
  const running = context.backgroundTasks.find((task) => task.status === "running");
  const sessionId = await ensureSession(context);
  if (!running) {
    await context.store.appendEvent(sessionId, {
      type: "interrupt",
      id: randomUUID(),
      status: "cancelled",
      message: t(context, "interruptIdle"),
      createdAt: new Date().toISOString(),
    });
    writeLine(output, t(context, "interruptIdle"));
    return;
  }
  running.status = "cancelled";
  running.result = "cancelled";
  running.updatedAt = new Date().toISOString();
  running.nextAction =
    context.language === "en-US"
      ? "Review /background before continuing."
      : "继续前可先查看 /background。";
  await appendBackgroundTaskEvent(context, sessionId, running);
  await context.store.appendEvent(sessionId, {
    type: "interrupt",
    id: randomUUID(),
    status: "cancelled",
    message: t(context, "interruptCancelled"),
    createdAt: new Date().toISOString(),
  });
  writeLine(output, t(context, "interruptCancelled"));
}

async function handleClaimCheckCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const claim = args.join(" ").trim();
  if (!claim) {
    writeLine(output, "用法：/claim-check <claim>");
    return;
  }
  const result = checkClaimSupport(claim, context);
  const sessionId = await ensureSession(context);
  await context.store.appendEvent(sessionId, {
    type: "claim_check",
    id: randomUUID(),
    status: result.status,
    unsupportedClaims: result.unsupportedClaims,
    createdAt: new Date().toISOString(),
  });
  writeLine(output, formatClaimCheck(result, context.language));
}

async function handleCacheLogCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  if (args[0] === "config" && args[1] === "size") {
    const size = Number.parseInt(args[2] ?? "", 10);
    if (!Number.isFinite(size) || size < MIN_CACHE_HISTORY_SIZE) {
      writeLine(output, `用法：/cache-log config size <n>，n >= ${MIN_CACHE_HISTORY_SIZE}`);
      return;
    }
    context.cache.config.maxTurns = Math.min(size, MAX_CACHE_HISTORY_SIZE);
    trimCacheHistory(context.cache);
    writeLine(
      output,
      `cache history size：${context.cache.config.maxTurns}，超过上限的旧记录已淘汰。`,
    );
    return;
  }
  if (args[0] === "export") {
    const path = args[1] ? resolve(context.projectPath, args[1]) : context.cache.config.persistPath;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(context.cache.history, null, 2)}\n`, "utf8");
    writeLine(
      output,
      `已导出最近缓存日志：${path}。用于和 provider usage 或账号账单对账，金额仍以账单为准。`,
    );
    return;
  }
  if (args.length > 0) {
    writeLine(output, "用法：/cache-log | /cache-log config size <n> | /cache-log export [path]");
    return;
  }
  writeLine(output, formatCacheLog(context));
}

async function handleCacheCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0];
  if (!action || action === "status") {
    writeLine(output, formatCacheStatus(context));
    return;
  }
  if (action === "warmup" || action === "refresh") {
    const freshness = getCurrentFreshness(context);
    const changedKeys = diffFreshness(context.cache.lastFreshness, freshness);
    context.cache.lastFreshness = { ...freshness, changedKeys };
    writeLine(
      output,
      action === "warmup"
        ? "已尝试预热 cache。该最小路径不保证 provider 一定写入缓存；请用 /cache status 或 provider usage 对账。"
        : "已尝试刷新 cache。该最小路径不保证 provider 一定写入缓存；请用 /cache status 或 provider usage 对账。",
    );
    return;
  }
  writeLine(output, "用法：/cache status | /cache warmup | /cache refresh");
}

async function handleBreakCacheCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  if (args[0] !== "status") {
    writeLine(output, "用法：/break-cache status");
    return;
  }
  writeLine(output, formatBreakCacheStatus(context));
}

async function handleMcpCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0] ?? "status";
  if (action === "status") {
    writeLine(output, formatMcpStatus(context));
    writeStatus(output, context);
    return;
  }
  if (action === "tools") {
    context.mcp.tools = stabilizeMcpToolList(context.mcp.tools);
    refreshCacheFreshness(context);
    writeLine(output, formatMcpTools(context));
    return;
  }
  if (action === "doctor") {
    await runMcpDoctor(context);
    writeLine(output, formatMcpStatus(context));
    writeStatus(output, context);
    return;
  }
  writeLine(output, "用法：/mcp | /mcp status | /mcp tools | /mcp doctor");
}

async function handleResumeCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const sessionId = args[0] ?? (await context.store.list())[0]?.id;
  if (!sessionId) {
    writeLine(output, "还没有可恢复会话。下一步：先正常对话，或用 /sessions 查看历史。");
    return;
  }
  await resumeSessionWithHandoff(sessionId, context, output, "resume");
}

async function handleBranchCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const purpose = args.join(" ").trim() || "试验分支会话";
  const parentSessionId = context.sessionId ?? "none";
  const packet = await loadOrCreateHandoffPacket(context, parentSessionId);
  const branch = await context.store.create({
    model: context.model,
    summary: `branch from ${parentSessionId}: ${purpose}`,
  });
  const branchPacket: HandoffPacket = {
    ...packet,
    id: randomUUID(),
    sessionId: branch.id,
    projectPath: context.projectPath,
    parentSessionId,
    createdAt: new Date().toISOString(),
  };
  const missing = validateHandoffPacket(branchPacket);
  context.memory.lastHandoff = branchPacket;
  context.sessionId = branch.id;
  context.sessionEnded = false;
  await writeHandoffPacket(context, branchPacket);
  await context.store.appendEvent(branch.id, {
    type: "branch_created",
    branch: {
      id: branch.id,
      parentSessionId,
      sourceSession: parentSessionId,
      purpose,
      permissionMode: context.permissionMode,
      mustNotDo: branchPacket.mustNotDo,
      handoffReadonly: missing.length > 0,
    },
    createdAt: new Date().toISOString(),
  });
  await context.store.appendEvent(branch.id, {
    type: "handoff_packet",
    packet: branchPacket,
    createdAt: new Date().toISOString(),
  });
  writeLine(output, `已创建分支会话：${branch.id}`);
  writeLine(output, `来源 session：${parentSessionId}`);
  writeLine(output, `目的：${purpose}`);
  writeLine(
    output,
    `权限边界：${context.permissionMode}；禁止事项：${branchPacket.mustNotDo.join("；")}`,
  );
  if (missing.length > 0) {
    writeLine(output, `handoff 缺少关键字段，分支按只读恢复：${missing.join(", ")}`);
  }
  refreshCacheFreshness(context);
  writeStatus(output, context);
}

async function handleMemoryCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0] ?? "status";
  if (action === "status" || action === "list") {
    writeLine(output, formatMemoryStatus(context));
    return;
  }
  if (action === "storage") {
    writeLine(output, formatMemoryStorage(context));
    return;
  }
  if (action === "review") {
    writeLine(output, formatMemoryReview(context));
    return;
  }
  if (action === "candidate") {
    const summary = args.slice(1).join(" ").trim();
    if (!summary) {
      writeLine(output, "用法：/memory candidate <短小稳定记忆摘要>");
      return;
    }
    const candidate = createMemoryCandidate("project", summary, "manual /memory candidate");
    context.memory.candidates.unshift(candidate);
    const sessionId = await ensureSession(context);
    await context.store.appendEvent(sessionId, {
      type: "memory_candidate",
      candidate,
      createdAt: new Date().toISOString(),
    });
    refreshCacheFreshness(context);
    writeLine(
      output,
      `已创建候选记忆：${candidate.id}。写入长期记忆前请运行 /memory review 和 /memory accept ${candidate.id}`,
    );
    return;
  }
  if (action === "accept") {
    const id = args[1];
    const candidate = context.memory.candidates.find((item) => item.id === id);
    if (!candidate) {
      writeLine(output, "未找到候选记忆。用法：/memory accept <candidate-id>");
      return;
    }
    await acceptMemoryCandidate(candidate, context);
    context.memory.candidates = context.memory.candidates.filter((item) => item.id !== id);
    context.memory.accepted.unshift(candidate);
    const sessionId = await ensureSession(context);
    await context.store.appendEvent(sessionId, {
      type: "memory_accepted",
      memory: candidate,
      createdAt: new Date().toISOString(),
    });
    refreshCacheFreshness(context);
    writeLine(
      output,
      `已写入${candidate.scope === "project" ? "项目" : "用户"}级长期记忆：${candidate.id}`,
    );
    return;
  }
  if (action === "delete") {
    const id = args[1];
    const before = context.memory.candidates.length + context.memory.accepted.length;
    context.memory.candidates = context.memory.candidates.filter((item) => item.id !== id);
    context.memory.accepted = context.memory.accepted.filter((item) => item.id !== id);
    refreshCacheFreshness(context);
    writeLine(
      output,
      before === context.memory.candidates.length + context.memory.accepted.length
        ? "未找到该记忆。"
        : `已删除本会话中的记忆记录：${id}`,
    );
    return;
  }
  if (action === "init") {
    await initLinghunMd(context, output);
    return;
  }
  if (action === "import" && args[1] === "sessions") {
    await importAiSessions(args.slice(2), context, output);
    return;
  }
  writeLine(
    output,
    "用法：/memory | /memory storage | /memory review | /memory candidate <摘要> | /memory accept <id> | /memory delete <id> | /memory init | /memory import sessions [source] [query]",
  );
}

async function resumeSessionWithHandoff(
  sessionId: string,
  context: TuiContext,
  output: Writable,
  source: "resume" | "sessions resume",
): Promise<void> {
  try {
    const resumed = await context.store.resume(sessionId);
    context.sessionId = resumed.session.id;
    context.sessionEnded = isSessionEnded(resumed.transcript);
    context.model = resumed.session.model;
    hydrateResumeContext(context, resumed.transcript);
    const packet = context.memory.lastHandoff ?? createHandoffPacket(context, resumed.transcript);
    const missing = validateHandoffPacket(packet);
    context.memory.lastResumeReadonly = missing.length > 0;
    writeLine(output, `已恢复会话：${resumed.session.id}`);
    writeLine(output, `恢复方式：${source}；不会把完整 transcript 塞回上下文。`);
    writeLine(output, formatResumePacket(packet, missing, context));
    if (context.index.status === "stale" || context.index.status === "missing") {
      writeLine(
        output,
        "索引不是 ready：建议先运行 /index status 或 /index refresh；不会自动刷新。 ",
      );
    }
    writeStatus(output, context);
  } catch (error) {
    writeLine(output, formatError(error));
  }
}

function hydrateResumeContext(context: TuiContext, transcript: TranscriptEvent[]): void {
  const latestTodo = [...transcript].reverse().find((event) => event.type === "todo_update");
  if (latestTodo?.type === "todo_update") {
    context.tools.todos = latestTodo.items.map((item) => ({ ...item }));
  }
  const latestVerification = [...transcript]
    .reverse()
    .find((event) => event.type === "verification_end");
  if (latestVerification?.type === "verification_end") {
    context.lastVerification = latestVerification.report as VerificationReport;
  }
  const evidence = transcript
    .filter(
      (event): event is Extract<TranscriptEvent, { type: "evidence_record" }> =>
        event.type === "evidence_record",
    )
    .slice(-10)
    .map((event) => ({
      id: event.id,
      kind: event.kind,
      summary: event.summary,
      source: event.source,
      supportsClaims: event.supportsClaims,
      createdAt: event.createdAt,
    }));
  context.evidence = [...evidence.reverse(), ...context.evidence].slice(0, 20);
  const handoff = [...transcript].reverse().find((event) => event.type === "handoff_packet");
  if (handoff?.type === "handoff_packet" && isHandoffPacket(handoff.packet)) {
    context.memory.lastHandoff = handoff.packet;
  }
  refreshCacheFreshness(context);
}

async function loadOrCreateHandoffPacket(
  context: TuiContext,
  parentSessionId?: string,
): Promise<HandoffPacket> {
  if (context.memory.lastHandoff) {
    return context.memory.lastHandoff;
  }
  const sessionId = await ensureSession(context);
  const packet = createHandoffPacket(context, [], parentSessionId, sessionId);
  context.memory.lastHandoff = packet;
  await writeHandoffPacket(context, packet);
  await context.store.appendEvent(sessionId, {
    type: "handoff_packet",
    packet,
    createdAt: new Date().toISOString(),
  });
  return packet;
}

function createHandoffPacket(
  context: TuiContext,
  transcript: TranscriptEvent[],
  parentSessionId?: string,
  sessionId = context.sessionId ?? "uncreated",
): HandoffPacket {
  const latestEvidence = context.evidence.slice(0, 8).map((item) => ({
    id: item.id,
    kind: item.kind,
    source: item.source,
    summary: item.summary,
  }));
  const transcriptTodos = [...transcript].reverse().find((event) => event.type === "todo_update");
  const todos =
    context.tools.todos.length > 0
      ? context.tools.todos
      : transcriptTodos?.type === "todo_update"
        ? transcriptTodos.items
        : [];
  return {
    id: randomUUID(),
    sessionId,
    projectPath: context.projectPath,
    ...(parentSessionId ? { parentSessionId } : {}),
    currentPhase: "Phase 11",
    nextPhase: "Phase 12",
    phaseStatus: "in_progress",
    goal: "会话交接与记忆闭环：结构化 handoff、/resume、/branch、LINGHUN.md、memory storage 和 AI sessions 导入入口。",
    completed: [],
    pending: ["完成 Phase 11 验证与交付文档"],
    mustNotDo: [
      "不要进入 Phase 12+",
      "不要复制完整历史聊天到新会话",
      "不要自动写长期记忆",
      "不要自动刷新索引",
      "不要实现 Agent、多模型、Plugins、Hooks、长期任务或 Remote Channels",
    ],
    todos,
    keyFiles: [
      "packages/tui/src/index.ts",
      "packages/config/src/index.ts",
      "packages/core/src/session.ts",
      "docs/delivery/phase-11-sessions-memory.md",
    ],
    changedFiles: [...new Set(context.tools.changedFiles)],
    evidenceRefs: latestEvidence,
    verification: context.lastVerification ?? null,
    risks: context.lastVerification
      ? context.lastVerification.risk
      : ["尚未运行 Phase 11 完整验证"],
    indexStatus: {
      projectName: context.index.projectName,
      status: context.index.status,
      nodes: context.index.nodes,
      edges: context.index.edges,
      changedFiles: context.index.changedFiles,
      staleHint: context.index.staleHint,
    },
    permissionMode: context.permissionMode,
    modelProvider: { provider: "deepseek", model: context.model },
    recentCommit: "unknown until git metadata is checked externally",
    budgetUsage: "local usage only; no billing fields; status bar does not show money",
    createdAt: new Date().toISOString(),
    generatedBy: "Linghun Phase 11 HandoffPacket",
  };
}

function validateHandoffPacket(packet: HandoffPacket): string[] {
  const missing: string[] = [];
  if (!packet.id) missing.push("id");
  if (!packet.sessionId) missing.push("sessionId");
  if (!packet.projectPath) missing.push("projectPath");
  if (!packet.verification) missing.push("verification");
  if (packet.evidenceRefs.length === 0) missing.push("evidenceRefs");
  if (packet.mustNotDo.length === 0) missing.push("mustNotDo");
  if (!packet.indexStatus.status || packet.indexStatus.status === "unknown")
    missing.push("indexStatus");
  return missing;
}

function isHandoffPacket(value: unknown): value is HandoffPacket {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.sessionId === "string" &&
    typeof value.projectPath === "string" &&
    typeof value.currentPhase === "string" &&
    typeof value.nextPhase === "string" &&
    Array.isArray(value.mustNotDo) &&
    Array.isArray(value.evidenceRefs)
  );
}

function formatProjectRulesContext(context: TuiContext): string {
  if (context.memory.projectRulesError) {
    return "unreadable; 可检查文件权限或运行 /memory storage 定位路径";
  }
  if (!context.memory.projectRulesExists) {
    return "missing; 可运行 /memory init 生成基础模板，不会自动生成";
  }
  return truncateDisplay(context.memory.projectRulesSummary, PROJECT_RULES_STATUS_WIDTH);
}

function formatResumePacket(packet: HandoffPacket, missing: string[], context: TuiContext): string {
  return [
    "Resume context package（摘要，不含完整历史）：",
    `- projectRules: ${formatProjectRulesContext(context)}`,
    `- currentPhase: ${packet.currentPhase}`,
    `- phaseStatus: ${packet.phaseStatus}`,
    `- goal: ${packet.goal}`,
    `- todos: ${packet.todos.length}`,
    `- evidenceRefs: ${packet.evidenceRefs.length}`,
    `- keyFiles: ${packet.keyFiles.join(", ")}`,
    `- verification: ${packet.verification?.status ?? "missing"}`,
    `- indexStatus: ${packet.indexStatus.status}`,
    `- readonly: ${missing.length > 0 ? `yes (${missing.join(", ")})` : "no"}`,
    context.memory.projectRulesError
      ? `- projectRules warning: ${context.memory.projectRulesError}`
      : "- projectRules warning: none",
    missing.length > 0
      ? "- 下一步：补齐 handoff 关键字段或先只读检查 /index status、/memory review、/verify last。"
      : "- 下一步：可基于摘要、Todo、证据和关键文件继续。",
  ].join("\n");
}

async function writeHandoffPacket(context: TuiContext, packet: HandoffPacket): Promise<void> {
  await mkdir(context.memory.sessionDir, { recursive: true });
  await writeFile(
    join(context.memory.sessionDir, "handoff-latest.json"),
    `${JSON.stringify(packet, null, 2)}\n`,
    "utf8",
  );
}

function createMemoryCandidate(
  scope: "project" | "user",
  summary: string,
  source: string,
): MemoryCandidate {
  return {
    id: randomUUID(),
    scope,
    summary: truncateDisplay(summary.replace(/\s+/g, " "), 240),
    source,
    createdAt: new Date().toISOString(),
  };
}

async function acceptMemoryCandidate(
  candidate: MemoryCandidate,
  context: TuiContext,
): Promise<void> {
  const directory =
    candidate.scope === "project" ? context.memory.projectDir : context.memory.userDir;
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${candidate.id}.json`);
  await writeFile(path, `${JSON.stringify(candidate, null, 2)}\n`, "utf8");
}

function formatMemoryStatus(context: TuiContext): string {
  return [
    "Memory status",
    `- LINGHUN.md: ${context.memory.projectRulesExists ? "found" : "missing"}`,
    `- projectRulesSummary: ${formatProjectRulesContext(context)}`,
    `- candidates: ${context.memory.candidates.length}`,
    `- accepted: ${context.memory.accepted.length}`,
    ...context.memory.accepted
      .slice(0, 5)
      .map((item) => `  - ${item.id} [${item.scope}] ${item.summary}`),
    `- lastHandoff: ${context.memory.lastHandoff ? context.memory.lastHandoff.createdAt : "none"}`,
    context.memory.projectRulesError
      ? "- hint: LINGHUN.md 读取失败；可运行 /memory storage 定位路径，不会自动生成或打断输入。"
      : context.memory.projectRulesExists
        ? "- note: LINGHUN.md 只用于长期稳定工程规则；这里只显示截断摘要。"
        : "- hint: 缺少 LINGHUN.md。可运行 /memory init 生成基础模板；不会打断输入。",
  ].join("\n");
}

function formatMemoryStorage(context: TuiContext): string {
  const paths = resolveStoragePaths(context.config, context.projectPath);
  return [
    "Memory storage",
    `- project rules: ${context.memory.projectRulesPath}`,
    `- project memory: ${paths.memoryProject}`,
    `- user memory: ${paths.memoryUser}`,
    `- session memory/handoff: ${paths.memorySession}`,
    `- sessions: ${paths.sessions}`,
    `- logs: ${paths.logs}`,
    `- jobs: ${paths.jobs}`,
    `- cache: ${paths.cache}`,
    `- index metadata: ${paths.index}`,
    `- LINGHUN_DATA_DIR: ${process.env.LINGHUN_DATA_DIR ?? "not set; default user data is under ~/.linghun/data"}`,
  ].join("\n");
}

function formatMemoryReview(context: TuiContext): string {
  const accepted = context.memory.accepted.map(
    (item) => `- accepted ${item.id} [${item.scope}] ${item.summary} (source=${item.source})`,
  );
  if (context.memory.candidates.length === 0) {
    return [
      "Memory review：暂无候选记忆。可用 /memory candidate <短小稳定摘要> 创建候选；长期写入前必须 /memory accept。",
      ...accepted,
    ].join("\n");
  }
  return [
    "Memory review（候选，不是长期记忆）",
    ...context.memory.candidates.map(
      (item) => `- candidate ${item.id} [${item.scope}] ${item.summary} (source=${item.source})`,
    ),
    ...accepted,
    "确认写入：/memory accept <id>；删除候选：/memory delete <id>",
  ].join("\n");
}

async function initLinghunMd(context: TuiContext, output: Writable): Promise<void> {
  if (await pathExists(context.memory.projectRulesPath)) {
    context.memory.projectRulesExists = true;
    writeLine(output, `LINGHUN.md 已存在：${context.memory.projectRulesPath}`);
    return;
  }
  const content =
    "# Linghun Project Rules\n\n- 只记录长期稳定工程规则。\n- 不记录临时想法、阶段进度或短期计划；这些内容进入 HandoffPacket。\n- 修改代码后运行项目认可的最小验证。\n- 不要把密钥、完整聊天记录、大日志或完整索引写入长期记忆。\n";
  await writeFile(context.memory.projectRulesPath, content, "utf8");
  context.memory.projectRulesExists = true;
  context.memory.projectRulesSummary = summarizeProjectRules(content);
  context.memory.projectRulesError = undefined;
  refreshCacheFreshness(context);
  writeLine(output, `已生成基础 LINGHUN.md：${context.memory.projectRulesPath}`);
}

async function importAiSessions(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const source = args[0] ?? "auto";
  const query = args.slice(1).join(" ").trim() || basename(context.projectPath);
  const summary = `AI sessions import requested: source=${source}, query=${query}. 当前 Linghun 最小入口只记录摘要和证据引用，不读取或保存敏感聊天原文；如 MCP bridge 不可用，请先配置 ai-sessions。`;
  const sessionId = await ensureSession(context);
  await context.store.appendEvent(sessionId, {
    type: "session_import",
    source,
    summary,
    createdAt: new Date().toISOString(),
  });
  const candidate = createMemoryCandidate(
    "project",
    `外部会话导入线索：${source} / ${query}`,
    "AI sessions import summary",
  );
  context.memory.candidates.unshift(candidate);
  refreshCacheFreshness(context);
  writeLine(output, summary);
  writeLine(output, `已创建候选记忆等待确认：${candidate.id}`);
}

async function handleIndexCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0] ?? "status";
  if (action === "status") {
    await refreshIndexStatus(context);
    writeLine(output, formatIndexStatus(context));
    writeStatus(output, context);
    return;
  }
  if (action === "init" && args[1] === "fast") {
    await runIndexRepository(context, "fast", "init fast", args.includes("--force"));
    writeLine(output, formatIndexStatus(context));
    writeStatus(output, context);
    return;
  }
  if (action === "refresh") {
    await runIndexRepository(
      context,
      context.config.index.mode,
      "refresh",
      args.includes("--force"),
    );
    writeLine(output, formatIndexStatus(context));
    writeStatus(output, context);
    return;
  }
  if (action === "search") {
    const query = args.slice(1).join(" ").trim();
    if (!query) {
      writeLine(output, "用法：/index search <query>");
      return;
    }
    const result = await runIndexQuery(context, "search_code", { pattern: query, limit: 5 });
    await recordIndexEvidence(context, `search ${query}`, result.summary);
    writeLine(output, result.summary);
    writeStatus(output, context);
    return;
  }
  if (action === "architecture") {
    const result = await runIndexQuery(context, "get_architecture", {});
    await recordIndexEvidence(context, "architecture", result.summary);
    writeLine(output, result.summary);
    writeStatus(output, context);
    return;
  }
  writeLine(
    output,
    "用法：/index status | /index init fast | /index refresh | /index search <query> | /index architecture",
  );
}

export function recordModelUsage(context: TuiContext, usage: ModelUsage): CacheTurnStats {
  const freshness = getCurrentFreshness(context);
  const changedKeys = diffFreshness(context.cache.lastFreshness, freshness);
  const cacheReadTokens = usage.cacheReadTokens ?? 0;
  const cacheWriteTokensSource = classifyCacheWriteTokensSource(usage);
  const cacheWriteTokens = usage.cacheWriteTokens ?? 0;
  const stats: CacheTurnStats = {
    turn: context.cache.nextTurn,
    timestamp: Date.now(),
    hitRate: computePromptCacheHitRate({
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      provider: "deepseek",
      model: context.model,
    }),
    cacheReadTokens,
    cacheWriteTokens,
    cacheWriteTokensSource,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    model: context.model,
    provider: "deepseek",
    endpoint: usage.endpoint ?? CHAT_COMPLETIONS_ENDPOINT,
    source:
      usage.cacheReadTokens === undefined && usage.cacheWriteTokensRaw === undefined
        ? "estimated"
        : "api_usage",
    compacted: context.cache.compacted,
    freshness: { ...freshness, changedKeys },
    rawUsage: usage.rawUsage,
  };
  context.cache.nextTurn += 1;
  context.cache.lastFreshness = stats.freshness;
  context.cache.history.push(stats);
  trimCacheHistory(context.cache);
  return stats;
}

async function appendUsageEvents(
  context: TuiContext,
  sessionId: string,
  stats: CacheTurnStats,
): Promise<void> {
  const createdAt = new Date().toISOString();
  await context.store.appendEvent(sessionId, { type: "usage", usage: stats, createdAt });
  await context.store.appendEvent(sessionId, { type: "cache_update", stats, createdAt });
}

function getCodebaseMemoryCommand(context: TuiContext): string {
  return context.config.mcp.servers["codebase-memory"]?.command ?? "codebase-memory-mcp";
}

function getCodebaseMemoryCommandArgs(context: TuiContext): string[] {
  return context.config.mcp.servers["codebase-memory"]?.args ?? [];
}

async function runMcpDoctor(context: TuiContext): Promise<void> {
  for (const server of context.mcp.servers) {
    if (server.status === "disabled") {
      continue;
    }
    const result = await runCommandCapture(
      server.command,
      ["--version"],
      context.projectPath,
      5_000,
    );
    if (result.exitCode === 0) {
      server.status = "configured";
      server.error = undefined;
      continue;
    }
    server.status = result.errorCode === "ENOENT" ? "missing" : "error";
    server.error = result.summary;
  }
  context.mcp.lastDoctor = new Date().toISOString();
  context.mcp.tools = stabilizeMcpToolList(
    context.mcp.servers
      .filter((server) => server.status === "configured")
      .map((server) => ({
        server: server.name,
        name: `${server.name}.status`,
        description:
          "MCP server is available; full tool schemas are intentionally omitted for cache stability.",
      })),
  );
  refreshCacheFreshness(context);
}

function formatMcpStatus(context: TuiContext): string {
  const servers = context.mcp.servers.map((server) => {
    const suffix = server.error ? ` (${truncateDisplay(server.error, 80)})` : "";
    return `- ${server.name}: ${server.status} command=${server.command}${suffix}`;
  });
  return [
    "MCP status",
    `- enabled: ${context.mcp.enabled ? "yes" : "no"}`,
    `- servers: ${context.mcp.servers.length}`,
    `- tools(stable): ${context.mcp.tools.length}`,
    `- lastDoctor: ${context.mcp.lastDoctor ?? "not run"}`,
    ...servers,
    "- note: MCP 启动/检测失败会隔离，不影响普通聊天、本地工具和 cache/status。",
  ].join("\n");
}

function formatMcpTools(context: TuiContext): string {
  if (context.mcp.tools.length === 0) {
    return "MCP tools：暂无稳定工具摘要。可运行 /mcp doctor 检测本机 server；不会输出完整 tool schema。";
  }
  return [
    "MCP tools（稳定排序摘要，不输出完整 schema）",
    ...context.mcp.tools.map((tool) => `- ${tool.server} :: ${tool.name} — ${tool.description}`),
  ].join("\n");
}

async function refreshIndexStatus(context: TuiContext): Promise<void> {
  const projects = await runCodebaseMemoryCli(context, "list_projects", {}, context.projectPath);
  if (!projects.ok) {
    context.index.status = projects.errorCode === "ENOENT" ? "missing" : "error";
    context.index.error = projects.summary;
    return;
  }
  const project = findCurrentIndexProject(projects.data, context.projectPath);
  if (!project) {
    context.index.status = "missing";
    context.index.error = "未找到当前项目索引。请运行 /index init fast 建立索引。";
    return;
  }
  context.index.projectName = project.name;
  const status = await runCodebaseMemoryCli(
    context,
    "index_status",
    { project: project.name },
    context.projectPath,
  );
  if (!status.ok) {
    context.index.status = "error";
    context.index.error = status.summary;
    return;
  }
  const data = status.data as { status?: string; nodes?: number; edges?: number };
  context.index.status = data.status === "ready" ? "ready" : "stale";
  context.index.nodes = data.nodes;
  context.index.edges = data.edges;
  context.index.error = undefined;
  context.index.changedFiles = undefined;
  context.index.staleHint = undefined;
  context.index.safetyWarning = undefined;
  await refreshIndexStaleHint(context, project.name);
}

async function refreshIndexStaleHint(context: TuiContext, projectName: string): Promise<void> {
  const changes = await runCodebaseMemoryCli(
    context,
    "detect_changes",
    { project: projectName },
    context.projectPath,
    15_000,
  );
  if (!changes.ok) {
    context.index.staleHint = `detect_changes 不可用：${changes.summary}。/index status 仍按 index_status 展示；不会自动刷新。`;
    return;
  }
  const data = changes.data as { changed_count?: number; changed_files?: unknown[] };
  const changedCount =
    typeof data.changed_count === "number"
      ? data.changed_count
      : Array.isArray(data.changed_files)
        ? data.changed_files.length
        : 0;
  context.index.changedFiles = changedCount;
  if (changedCount > 0) {
    context.index.status = "stale";
    context.index.staleHint = `detect_changes 发现 ${changedCount} 个变更文件，建议运行 /index refresh；不会自动刷新。`;
  }
}

async function runIndexRepository(
  context: TuiContext,
  mode: "fast" | "moderate" | "full",
  actionLabel: "init fast" | "refresh",
  force: boolean,
): Promise<void> {
  const safety = await scanIndexSafety(context.projectPath);
  if (!force && safety.riskyFiles.length > 0) {
    context.index.status = "stale";
    context.index.safetyWarning = formatIndexSafetyWarning(safety, actionLabel);
    context.index.error =
      "索引前发现未排除的大文件风险；请更新 .linghunignore/.cbmignore，或显式追加 --force。";
    return;
  }
  context.index.safetyWarning =
    safety.riskyFiles.length > 0 ? formatIndexSafetyWarning(safety, actionLabel) : undefined;
  context.index.error = undefined;
  context.index.status = "indexing";
  const result = await runCodebaseMemoryCli(
    context,
    "index_repository",
    { repo_path: context.projectPath, mode, persistence: true },
    context.projectPath,
    120_000,
  );
  if (!result.ok) {
    context.index.status = result.errorCode === "ENOENT" ? "missing" : "error";
    context.index.error = `${result.summary}。请确认已安装 codebase-memory-mcp，或检查 .linghunignore 排除大 JSON/SQL/XML/min.js/生成物后重试。`;
    return;
  }
  await refreshIndexStatus(context);
}

async function runIndexQuery(
  context: TuiContext,
  tool: "search_code" | "get_architecture",
  input: Record<string, unknown>,
): Promise<{ summary: string }> {
  await refreshIndexStatus(context);
  if (context.index.status !== "ready" || !context.index.projectName) {
    const summary = formatIndexStatus(context);
    return { summary };
  }
  const result = await runCodebaseMemoryCli(
    context,
    tool,
    { project: context.index.projectName, ...input },
    context.projectPath,
  );
  if (!result.ok) {
    context.index.status = result.errorCode === "ENOENT" ? "missing" : "error";
    context.index.error = result.summary;
    return { summary: formatIndexStatus(context) };
  }
  const summary = summarizeIndexResult(tool, result.data);
  context.index.lastQuery = tool === "search_code" ? String(input.pattern ?? "") : "architecture";
  context.index.lastSummary = summary;
  return { summary };
}

async function recordIndexEvidence(
  context: TuiContext,
  query: string,
  summary: string,
): Promise<void> {
  const sessionId = await ensureSession(context);
  const evidence: EvidenceRecord = {
    id: randomUUID(),
    kind: "index_query",
    summary: truncateDisplay(summary.replace(/\s+/g, " "), 160),
    source: `codebase-memory:${context.index.projectName ?? "unknown"}:${query}`,
    supportsClaims: ["index_query", query],
    createdAt: new Date().toISOString(),
  };
  context.evidence.unshift(evidence);
  await context.store.appendEvent(sessionId, { type: "evidence_record", ...evidence });
}

function formatIndexStatus(context: TuiContext): string {
  const suggestion =
    context.index.status === "missing"
      ? "建议：运行 /index init fast 建立索引；如仓库很大，先用 .linghunignore 排除大 JSON、SQL、XML、min.js 和生成物。"
      : context.index.status === "stale"
        ? "建议：运行 /index refresh 刷新索引；不会自动重建。"
        : context.index.status === "error"
          ? "建议：确认 codebase-memory-mcp 可执行，或修复索引错误后重试 /index status。"
          : "建议：可用 /index search <query> 或 /index architecture 获取短结果。";
  return [
    "Index status",
    `- enabled: ${context.index.enabled ? "yes" : "no"}`,
    `- project: ${context.index.projectName ?? basename(context.projectPath)}`,
    `- status: ${context.index.status}`,
    `- nodes/edges: ${context.index.nodes ?? "-"}/${context.index.edges ?? "-"}`,
    `- changedFiles: ${context.index.changedFiles ?? "-"}`,
    `- staleHint: ${context.index.staleHint ? truncateDisplay(context.index.staleHint, 160) : "-"}`,
    `- safety: ${context.index.safetyWarning ? truncateDisplay(context.index.safetyWarning, 180) : "-"}`,
    `- error: ${context.index.error ? truncateDisplay(context.index.error, 120) : "-"}`,
    `- lastQuery: ${context.index.lastQuery ?? "-"}`,
    `- ${suggestion}`,
  ].join("\n");
}

function summarizeIndexResult(tool: "search_code" | "get_architecture", data: unknown): string {
  if (tool === "get_architecture" && isRecord(data)) {
    return [
      "Index architecture（短摘要）",
      `- project: ${String(data.project ?? "unknown")}`,
      `- nodes/edges: ${String(data.total_nodes ?? "-")}/${String(data.total_edges ?? "-")}`,
      `- node labels: ${summarizeNamedCounts(data.node_labels)}`,
      `- edge types: ${summarizeNamedCounts(data.edge_types)}`,
    ].join("\n");
  }
  if (isRecord(data)) {
    const raw = Array.isArray(data.results) ? data.results : [];
    const matches = raw
      .slice(0, 5)
      .map((item, index) => `- #${index + 1} ${truncateDisplay(stableStringify(item), 180)}`);
    return [
      "Index search（短摘要，最多 5 条）",
      `- total: ${String(data.total_results ?? raw.length)}`,
      ...matches,
      matches.length === 0
        ? "- no matches"
        : "- truncated: full source is not dumped into transcript/status bar.",
    ].join("\n");
  }
  return `Index result: ${truncateDisplay(stableStringify(data), 500)}`;
}

function summarizeNamedCounts(value: unknown): string {
  if (!Array.isArray(value)) {
    return "-";
  }
  return value
    .slice(0, 6)
    .map((item) => {
      if (!isRecord(item)) {
        return truncateDisplay(String(item), 32);
      }
      return `${String(item.label ?? item.type ?? item.name ?? "?")}=${String(item.count ?? "?")}`;
    })
    .join(", ");
}

type IndexSafetyFile = {
  path: string;
  size: number;
  reason: string;
};

type IndexSafetyResult = {
  riskyFiles: IndexSafetyFile[];
  truncated: boolean;
};

async function scanIndexSafety(projectPath: string): Promise<IndexSafetyResult> {
  const ignorePatterns = await readIndexIgnorePatterns(projectPath);
  const riskyFiles: IndexSafetyFile[] = [];
  let truncated = false;

  async function visit(directory: string): Promise<void> {
    if (riskyFiles.length >= LARGE_INDEX_FILE_LIMIT) {
      truncated = true;
      return;
    }
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (riskyFiles.length >= LARGE_INDEX_FILE_LIMIT) {
        truncated = true;
        return;
      }
      const absolutePath = join(directory, entry.name);
      const relativePath = normalizePath(relative(projectPath, absolutePath));
      if (!relativePath || isIgnoredIndexPath(relativePath, ignorePatterns)) {
        continue;
      }
      if (entry.isDirectory()) {
        if (INDEX_SCAN_SKIP_DIRS.has(entry.name)) {
          continue;
        }
        if (LARGE_INDEX_RISK_DIRS.has(entry.name)) {
          riskyFiles.push({
            path: `${relativePath}/`,
            size: 0,
            reason: "generated/dependency directory",
          });
          continue;
        }
        await visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const fileRisk = getIndexFileRisk(relativePath);
      if (!fileRisk) {
        continue;
      }
      let fileStat: Awaited<ReturnType<typeof stat>>;
      try {
        fileStat = await stat(absolutePath);
      } catch {
        continue;
      }
      if (fileStat.size < LARGE_INDEX_FILE_BYTES) {
        continue;
      }
      riskyFiles.push({ path: relativePath, size: fileStat.size, reason: fileRisk });
    }
  }

  await visit(projectPath);
  return { riskyFiles, truncated };
}

async function readIndexIgnorePatterns(projectPath: string): Promise<string[]> {
  const patterns: string[] = [];
  for (const fileName of [".linghunignore", ".cbmignore"]) {
    try {
      const text = await readFile(join(projectPath, fileName), "utf8");
      patterns.push(
        ...text
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0 && !line.startsWith("#"))
          .map((line) => normalizePath(line)),
      );
    } catch {
      // Ignore file is optional; missing or unreadable files must not break /index commands.
    }
  }
  return patterns;
}

function isIgnoredIndexPath(relativePath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const normalized = pattern.replace(/^\//, "");
    if (!normalized) {
      return false;
    }
    if (normalized.endsWith("/")) {
      return relativePath.startsWith(normalized);
    }
    if (normalized.includes("*")) {
      const escaped = normalized.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
      return (
        new RegExp(`^${escaped}$`).test(relativePath) ||
        new RegExp(`(^|/)${escaped}$`).test(relativePath)
      );
    }
    return relativePath === normalized || relativePath.startsWith(`${normalized}/`);
  });
}

function getIndexFileRisk(relativePath: string): string | null {
  const fileName = basename(relativePath);
  const extension = extname(relativePath).toLowerCase();
  const segments = relativePath.split("/");
  if (fileName.endsWith(".min.js")) {
    return "minified javascript";
  }
  if (LARGE_INDEX_RISK_EXTENSIONS.has(extension)) {
    return `${extension} file`;
  }
  if (segments.some((segment) => LARGE_INDEX_RISK_DIRS.has(segment))) {
    return "generated/resource directory";
  }
  return null;
}

function formatIndexSafetyWarning(
  safety: IndexSafetyResult,
  actionLabel: "init fast" | "refresh",
): string {
  const files = safety.riskyFiles.map((file) => {
    const size = file.size > 0 ? `${formatBytes(file.size)}, ` : "";
    return `- ${file.path} (${size}${file.reason})`;
  });
  return [
    `索引安全门：/index ${actionLabel} 发现未排除的大文件风险，默认阻止索引。`,
    ...files,
    safety.truncated ? `- 仅展示前 ${LARGE_INDEX_FILE_LIMIT} 项风险文件。` : "",
    "建议：把这些路径加入 .linghunignore 或 .cbmignore 后重试；如确认要继续，可显式追加 --force。",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) {
    return `${(bytes / 1_000_000).toFixed(1)} MB`;
  }
  return `${Math.round(bytes / 1_000)} KB`;
}

function findCurrentIndexProject(data: unknown, projectPath: string): { name: string } | null {
  if (!isRecord(data) || !Array.isArray(data.projects)) {
    return null;
  }
  const normalizedProjectPath = normalizePath(projectPath);
  const match = data.projects.find((project) => {
    if (!isRecord(project)) {
      return false;
    }
    return normalizePath(String(project.root_path ?? "")) === normalizedProjectPath;
  });
  if (isRecord(match) && typeof match.name === "string") {
    return { name: match.name };
  }
  return null;
}

async function runCodebaseMemoryCli(
  context: TuiContext,
  tool: string,
  input: Record<string, unknown>,
  cwd: string,
  timeoutMs = 30_000,
): Promise<{ ok: true; data: unknown } | { ok: false; summary: string; errorCode?: string }> {
  const command = getCodebaseMemoryCommand(context);
  const result = await runCommandCapture(
    command,
    [...getCodebaseMemoryCommandArgs(context), "cli", tool, JSON.stringify(input)],
    cwd,
    timeoutMs,
  );
  if (result.exitCode !== 0) {
    return { ok: false, summary: result.summary, errorCode: result.errorCode };
  }
  const jsonLine = [...result.stdout.trim().split(/\r?\n/)]
    .reverse()
    .find((line) => line.trim().startsWith("{"));
  if (!jsonLine) {
    return { ok: false, summary: "codebase-memory-mcp 未返回 JSON。" };
  }
  try {
    return { ok: true, data: JSON.parse(jsonLine) };
  } catch (error) {
    return { ok: false, summary: `无法解析 codebase-memory-mcp 输出：${formatError(error)}` };
  }
}

async function runCommandCapture(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
  summary: string;
  errorCode?: string;
}> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill();
      resolvePromise({
        exitCode: 124,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        summary: `命令超时：${command}`,
      });
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolvePromise({
        exitCode: 127,
        stdout: "",
        stderr: "",
        summary: error.message,
        errorCode: error.code,
      });
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      const out = Buffer.concat(stdout).toString("utf8");
      const err = Buffer.concat(stderr).toString("utf8");
      resolvePromise({
        exitCode: exitCode ?? 1,
        stdout: out,
        stderr: err,
        summary: truncateDisplay((err || out || `exit ${exitCode}`).replace(/\s+/g, " "), 200),
      });
    });
  });
}

function refreshCacheFreshness(context: TuiContext): void {
  const freshness = getCurrentFreshness(context);
  context.cache.lastFreshness = {
    ...freshness,
    changedKeys: diffFreshness(context.cache.lastFreshness, freshness),
  };
}

function stabilizeMcpToolList(tools: McpToolState[]): McpToolState[] {
  return tools
    .map((tool) => ({
      server: tool.server,
      name: tool.name,
      description: truncateDisplay(tool.description.replace(/\s+/g, " "), 120),
    }))
    .sort((a, b) => `${a.server}:${a.name}`.localeCompare(`${b.server}:${b.name}`));
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase();
}

function classifyCacheWriteTokensSource(usage: ModelUsage): CacheWriteTokensSource {
  if (usage.cacheWriteTokensRaw === null) {
    return "missing";
  }
  if (typeof usage.cacheWriteTokensRaw === "number") {
    return usage.cacheWriteTokensRaw === 0 ? "zero_reported" : "reported";
  }
  if (usage.cacheWriteTokensEstimated && typeof usage.cacheWriteTokens === "number") {
    return "estimated";
  }
  if (typeof usage.cacheWriteTokens === "number") {
    return usage.cacheWriteTokens === 0 ? "zero_reported" : "reported";
  }
  return "missing";
}

function trimCacheHistory(cache: CacheState): void {
  while (cache.history.length > cache.config.maxTurns) {
    cache.history.shift();
  }
}

function getCurrentFreshness(context: TuiContext): CacheFreshness {
  return createCacheFreshness({
    systemPrompt:
      context.language === "en-US"
        ? "Linghun Phase 11 EN system prompt"
        : "Linghun Phase 11 ZH system prompt",
    toolSchema: builtInTools,
    mcpToolList: stabilizeMcpToolList(context.mcp.tools),
    model: context.model,
    provider: "deepseek",
    reasoningEffort: "default",
    projectRules: createProjectRulesFreshnessSummary(context),
    memory: createMemoryFreshnessSummary(context),
    compact: context.cache.compacted ? "compacted" : "not compacted",
    plugins: [],
  });
}

function createProjectRulesFreshnessSummary(context: TuiContext): string {
  return stableStringify({
    path: normalizePath(context.memory.projectRulesPath),
    exists: context.memory.projectRulesExists,
    summary: context.memory.projectRulesSummary,
    error: context.memory.projectRulesError ? "unreadable" : "none",
  });
}

function createMemoryFreshnessSummary(context: TuiContext): string {
  return stableStringify({
    projectRules: context.memory.projectRulesSummary,
    candidates: context.memory.candidates.map((item) => ({
      id: item.id,
      scope: item.scope,
      summary: item.summary,
    })),
    accepted: context.memory.accepted.map((item) => ({
      id: item.id,
      scope: item.scope,
      summary: item.summary,
    })),
    handoffCreatedAt: context.memory.lastHandoff?.createdAt ?? "none",
  });
}

function createCacheFreshness(input: {
  systemPrompt: unknown;
  toolSchema: unknown;
  mcpToolList: unknown;
  model: string;
  provider: string;
  reasoningEffort?: unknown;
  projectRules?: unknown;
  memory?: unknown;
  compact?: unknown;
  plugins?: unknown;
}): CacheFreshness {
  return {
    systemPromptHash: stableHash(input.systemPrompt),
    toolSchemaHash: stableHash(input.toolSchema),
    mcpToolListHash: stableHash(input.mcpToolList),
    modelProviderHash: stableHash(`${input.provider}:${input.model}`),
    reasoningEffortHash: stableHash(input.reasoningEffort ?? "default"),
    projectRulesHash: stableHash(input.projectRules ?? "none"),
    memoryHash: stableHash(input.memory ?? "none"),
    compactHash: stableHash(input.compact ?? "none"),
    pluginListHash: stableHash(input.plugins ?? []),
    changedKeys: [],
  };
}

function diffFreshness(previous: CacheFreshness | undefined, current: CacheFreshness): string[] {
  if (!previous) {
    return [];
  }
  const keys: (keyof CacheFreshness)[] = [
    "systemPromptHash",
    "toolSchemaHash",
    "mcpToolListHash",
    "modelProviderHash",
    "reasoningEffortHash",
    "projectRulesHash",
    "memoryHash",
    "compactHash",
    "pluginListHash",
  ];
  return keys.filter((key) => previous[key] !== current[key]);
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex").slice(0, 12);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${key}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? String(value);
}

function formatCacheLog(context: TuiContext): string {
  if (context.cache.history.length === 0) {
    return "最近缓存日志为空。真实 usage 需要 provider 返回 token/cache 字段；可用 /cache warmup 尝试预热。";
  }
  return [
    `Cache log 最近 ${context.cache.history.length}/${context.cache.config.maxTurns} 轮：`,
    ...context.cache.history.map(
      (item) =>
        `#${item.turn} hit=${formatPercent(item.hitRate)} input=${item.inputTokens} output=${item.outputTokens} cache_read=${item.cacheReadTokens} cache_write=${item.cacheWriteTokens} write_source=${item.cacheWriteTokensSource} model=${item.model} provider=${item.provider} endpoint=${item.endpoint ?? "-"} compact=${item.compacted ? "yes" : "no"}`,
    ),
  ].join("\n");
}

function formatCacheStatus(context: TuiContext): string {
  const latest = context.cache.history.at(-1);
  const freshness = latest?.freshness ?? getCurrentFreshness(context);
  const changed =
    latest?.freshness.changedKeys ?? diffFreshness(context.cache.lastFreshness, freshness);
  const source = latest?.cacheWriteTokensSource ?? "missing";
  const zeroNote =
    source === "zero_reported"
      ? "provider 当前返回 cache_creation/cache write 为 0；这只是字段口径，不代表零写入成本。"
      : source === "missing"
        ? "provider 未返回 cache_creation/cache write 字段；不支持真实缓存写入统计。"
        : "cache write/create 字段来自 provider/API usage。";
  return [
    "Cache status",
    `- history: ${context.cache.history.length}/${context.cache.config.maxTurns}`,
    `- latest hitRate: ${formatPercent(latest?.hitRate ?? null)}（公式：cacheRead / (input + cacheWrite + cacheRead)，output 不进分母）`,
    `- read/write tokens: ${latest?.cacheReadTokens ?? 0}/${latest?.cacheWriteTokens ?? 0}`,
    `- cache write source: ${source}`,
    `- compact: ${context.cache.compacted ? "yes" : "no"}`,
    `- freshness changedKeys: ${changed.length > 0 ? changed.join(", ") : "none"}`,
    `- note: ${zeroNote}`,
  ].join("\n");
}

function formatBreakCacheStatus(context: TuiContext): string {
  const current = getCurrentFreshness(context);
  const changed = diffFreshness(context.cache.lastFreshness, current);
  const keys =
    changed.length > 0
      ? changed
      : context.cache.lastFreshness?.changedKeys.length
        ? context.cache.lastFreshness.changedKeys
        : (context.cache.history.at(-1)?.freshness.changedKeys ?? []);
  return [
    "Break-cache status",
    `- systemPromptHash: ${current.systemPromptHash}`,
    `- toolSchemaHash: ${current.toolSchemaHash}`,
    `- mcpToolListHash: ${current.mcpToolListHash}`,
    `- modelProviderHash: ${current.modelProviderHash}`,
    `- reasoningEffortHash: ${current.reasoningEffortHash ?? "-"}`,
    `- projectRulesHash: ${current.projectRulesHash ?? "-"}`,
    `- memoryHash: ${current.memoryHash ?? "-"}`,
    `- compactHash: ${current.compactHash ?? "-"}`,
    `- pluginListHash: ${current.pluginListHash ?? "-"}`,
    `- changedKeys: ${keys.length > 0 ? keys.join(", ") : "none"}`,
    "- suggestion: 如 system prompt / tool schema / MCP list / model/provider / memory / compact / plugin list 变化，可运行 /cache warmup 或 /cache refresh；不会替你自动执行。",
  ].join("\n");
}

function formatUsage(context: TuiContext): string {
  const totals = sumCacheHistory(context.cache.history);
  const latest = context.cache.history.at(-1);
  return [
    "Usage（本会话原始 token/cache usage）",
    `- input tokens: ${totals.inputTokens}`,
    `- output tokens: ${totals.outputTokens}`,
    `- cache read tokens: ${totals.cacheReadTokens}`,
    `- cache write/create tokens: ${totals.cacheWriteTokens}`,
    `- model: ${latest?.model ?? context.model}`,
    `- provider: ${latest?.provider ?? "deepseek"}`,
    `- endpoint: ${latest?.endpoint ?? CHAT_COMPLETIONS_ENDPOINT}`,
    `- compact: ${context.cache.compacted ? "yes" : "no"}`,
    `- rawUsage records: ${context.cache.history.filter((item) => item.rawUsage !== undefined).length}`,
    "- billing: 未记录真实账单字段；任何金额只能标记 estimated。",
  ].join("\n");
}

function formatStats(args: string[], context: TuiContext): string {
  if (args[0] === "endpoints") {
    return formatEndpointStats(context.cache.history);
  }
  const totals = sumCacheHistory(context.cache.history);
  const hitRate = computePromptCacheHitRate({
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    cacheReadTokens: totals.cacheReadTokens,
    cacheWriteTokens: totals.cacheWriteTokens,
    provider: "deepseek",
    model: context.model,
  });
  return [
    "Stats",
    `- samples: ${context.cache.history.length}`,
    `- elapsedMs: ${Date.now() - context.cache.startedAt}`,
    `- model: ${context.model}`,
    "- provider: deepseek",
    `- hitRate: ${formatPercent(hitRate)}`,
    `- tokens: input=${totals.inputTokens}, output=${totals.outputTokens}, cache_read=${totals.cacheReadTokens}, cache_write=${totals.cacheWriteTokens}`,
    "- cost: estimated unavailable（未配置价格；不伪装成真实账单）",
  ].join("\n");
}

function formatEndpointStats(history: CacheTurnStats[]): string {
  if (history.length === 0) {
    return "Endpoint stats：暂无样本。";
  }
  const groups = new Map<string, CacheTurnStats[]>();
  for (const item of history) {
    const key = item.endpoint ?? "unknown";
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [
    "Endpoint stats",
    ...[...groups.entries()].map(([endpoint, items]) => {
      const totals = sumCacheHistory(items);
      const hitRate = computePromptCacheHitRate({
        inputTokens: totals.inputTokens,
        outputTokens: totals.outputTokens,
        cacheReadTokens: totals.cacheReadTokens,
        cacheWriteTokens: totals.cacheWriteTokens,
        provider: items[0]?.provider ?? "unknown",
        model: items[0]?.model ?? "unknown",
      });
      return `- ${endpoint}: samples=${items.length} hitRate=${formatPercent(hitRate)} input=${totals.inputTokens} output=${totals.outputTokens} cache_read=${totals.cacheReadTokens} cache_write=${totals.cacheWriteTokens}`;
    }),
  ].join("\n");
}

function sumCacheHistory(history: CacheTurnStats[]): {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
} {
  return history.reduce(
    (total, item) => ({
      inputTokens: total.inputTokens + item.inputTokens,
      outputTokens: total.outputTokens + item.outputTokens,
      cacheReadTokens: total.cacheReadTokens + item.cacheReadTokens,
      cacheWriteTokens: total.cacheWriteTokens + item.cacheWriteTokens,
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  );
}

function formatPercent(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function collectLightHints(context: TuiContext): LightHint[] {
  const latest = context.cache.history.at(-1);
  const hints: LightHint[] = [];
  if (
    latest?.hitRate !== null &&
    latest?.hitRate !== undefined &&
    latest.hitRate < context.cache.config.warnBelowHitRate
  ) {
    hints.push(
      createLightHint("cache-hit-low", "warning", "cache 命中率下降", "/break-cache status"),
    );
  }
  if ((latest?.inputTokens ?? 0) > 96_000) {
    hints.push(createLightHint("context-long", "info", "context 较长，建议按需压缩", "/compact"));
  }
  if (latest?.cacheWriteTokensSource === "zero_reported" && latest.cacheReadTokens > 0) {
    hints.push(
      createLightHint(
        "cache-zero-create-with-read",
        "info",
        "cache_creation 长期为 0 但 cache_read 很高时通常是 provider 字段口径，不代表零写入成本",
        "/usage",
      ),
    );
  }
  const changedKeys = latest?.freshness.changedKeys ?? [];
  if (
    changedKeys.some((key) =>
      ["systemPromptHash", "toolSchemaHash", "mcpToolListHash"].includes(key),
    )
  ) {
    hints.push(
      createLightHint(
        "freshness-changed",
        "warning",
        "缓存 freshness 关键 hash 已变化",
        "/cache warmup",
      ),
    );
  }
  return hints;
}

function createLightHint(
  dedupeKey: string,
  severity: "info" | "warning",
  message: string,
  suggestedCommand: string,
): LightHint {
  return {
    id: randomUUID(),
    severity,
    message,
    suggestedCommand,
    dedupeKey,
    cooldownMs: DEFAULT_LIGHT_HINT_COOLDOWN_MS,
  };
}

function writeLightHints(output: Writable, context: TuiContext): void {
  if (context.cache.config.hintsMuted) {
    return;
  }
  const now = Date.now();
  for (const hint of collectLightHints(context)) {
    const lastShown = context.cache.hintLastShownAt[hint.dedupeKey] ?? 0;
    if (now - lastShown < hint.cooldownMs) {
      continue;
    }
    context.cache.hintLastShownAt[hint.dedupeKey] = now;
    writeLine(output, `[hint:${hint.severity}] ${hint.message}；建议：${hint.suggestedCommand}`);
  }
}

async function handleVerifyCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0];
  if (action === "last") {
    writeLine(output, formatVerificationLast(context.lastVerification, context.language));
    return;
  }

  const plan = await createVerificationPlan(
    context.projectPath,
    action === "smoke" ? "smoke" : "default",
  );
  if (action === "plan") {
    writeLine(output, formatVerificationPlan(plan, context.language));
    return;
  }
  if (action && action !== "smoke") {
    writeLine(output, "用法：/verify | /verify plan | /verify last | /verify smoke");
    return;
  }

  const sessionId = await ensureSession(context);
  const report = await runVerificationPlan(plan, context, sessionId, output);
  context.lastVerification = report;
  await recordVerificationEvidence(context, sessionId, report);
  writeLine(output, formatVerificationReport(report, context.language));
  writeStatus(output, context);
}

async function handleReviewCommand(context: TuiContext, output: Writable): Promise<void> {
  const report = createReviewReport(context);
  const sessionId = await ensureSession(context);
  await appendSystemEvent(context, sessionId, `review: ${report.replace(/\s+/g, " ")}`, "info");
  writeLine(output, report);
}

async function createVerificationPlan(
  projectPath: string,
  mode: "default" | "smoke",
): Promise<VerificationStep[]> {
  if (mode === "smoke") {
    return [
      {
        kind: "smoke",
        command: "node -e \"console.log('linghun verify smoke')\"",
        reason: "最小 smoke 验证，确认 Verification Runner 可执行命令并归档 evidence。",
      },
    ];
  }

  const packageJson = await safeReadJson(join(projectPath, "package.json"));
  const scripts = isRecord(packageJson?.scripts) ? packageJson.scripts : {};
  const steps: VerificationStep[] = [];
  addPackageStep(steps, scripts, "typecheck", "typecheck", "TypeScript 类型检查。 ");
  addPackageStep(steps, scripts, "test", "test", "项目测试套件。 ");
  addPackageStep(steps, scripts, "lint", "lint", "lint 静态检查。 ");
  addPackageStep(steps, scripts, "build", "build", "构建验证。 ");
  addPackageStep(steps, scripts, "smoke", "smoke", "项目自定义 smoke 验证。 ");

  if (steps.length > 0) {
    return steps;
  }
  return [
    {
      kind: "smoke",
      command: "node --version",
      reason: "未发现项目验证脚本，降级为 Node 运行环境 smoke 检查。",
    },
  ];
}

function addPackageStep(
  steps: VerificationStep[],
  scripts: Record<string, unknown>,
  scriptName: string,
  kind: VerificationStepKind,
  reason: string,
): void {
  if (typeof scripts[scriptName] !== "string") {
    return;
  }
  steps.push({ kind, command: `corepack pnpm ${scriptName}`, reason });
}

async function runVerificationPlan(
  plan: VerificationStep[],
  context: TuiContext,
  sessionId: string,
  output: Writable,
): Promise<VerificationReport> {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const logRoot = join(context.projectPath, ".linghun", "logs", "verification");
  await mkdir(logRoot, { recursive: true });
  const task: BackgroundTaskState = {
    id: runId,
    kind: "verification",
    title: "Verification Runner",
    status: "running",
    currentStep: "preparing verification",
    progress: { completed: 0, total: plan.length, label: "verify" },
    startedAt,
    updatedAt: startedAt,
    heartbeatIntervalMs: 30_000,
    staleAfterMs: 120_000,
    logPath: logRoot,
    hasOutput: false,
    userVisibleSummary: `验证已启动：${plan.length} 个步骤。可用 /background 查看详情。`,
    nextAction: "等待 PASS / FAIL / PARTIAL 结果，失败后按建议修复并复跑 /verify。",
  };
  context.backgroundTasks.unshift(task);
  await context.store.appendEvent(sessionId, {
    type: "verification_start",
    run: { id: runId, plan, startedAt },
    createdAt: startedAt,
  });
  await appendBackgroundTaskEvent(context, sessionId, task);
  writeLine(output, formatBackgroundTask(task, context.language));

  const results: VerificationCommandResult[] = [];
  const unverified: string[] = [];
  const risk: string[] = [];
  for (const [index, step] of plan.entries()) {
    const stepStarted = Date.now();
    task.currentStep = `${step.kind} ${index + 1}/${plan.length}`;
    task.progress = { completed: index, total: plan.length, label: step.kind };
    task.updatedAt = new Date().toISOString();
    await appendBackgroundTaskEvent(context, sessionId, task);
    writeLine(output, `验证步骤：${task.currentStep} · ${step.command}`);

    const logPath = join(logRoot, `${runId}-${index + 1}-${step.kind}.log`);
    const result = await runVerificationCommand(step.command, context.projectPath);
    const durationMs = Date.now() - stepStarted;
    const runnerErrorLine = result.runnerError ? `runnerError=${result.runnerError}\n` : "";
    const fullLog = `$ ${step.command}\nexitCode=${result.exitCode}\n${runnerErrorLine}durationMs=${durationMs}\n\n${result.output}`;
    await writeFile(logPath, fullLog, "utf8");
    const summary = summarizeVerificationOutput(result.output, result.exitCode, result.runnerError);
    const commandStatus = result.runnerError ? "partial" : result.exitCode === 0 ? "pass" : "fail";
    if (commandStatus === "fail") {
      risk.push(`${step.kind} 失败：${summary}`);
    }
    if (commandStatus === "partial") {
      unverified.push(`${step.kind} runner error：${summary}`);
      risk.push(`${step.kind} runner/toolchain 兼容风险：${summary}`);
    }
    results.push({
      ...step,
      status: commandStatus,
      exitCode: result.exitCode,
      durationMs,
      logPath,
      summary,
      runnerError: result.runnerError,
    });
    task.lastOutputAt = new Date().toISOString();
    task.hasOutput = Boolean(result.output.trim());
  }

  const endedAt = new Date().toISOString();
  const failed = results.filter((item) => item.status === "fail");
  const partial = results.filter((item) => item.status === "partial");
  const hasRunnerError = partial.some((item) => item.runnerError);
  const status: VerificationReport["status"] =
    failed.length > 0 ? "fail" : partial.length > 0 || unverified.length > 0 ? "partial" : "pass";
  const report: VerificationReport = {
    id: runId,
    status,
    summary:
      status === "pass"
        ? `PASS：${results.length} 个验证步骤通过。`
        : status === "fail"
          ? `FAIL：${failed.length}/${results.length} 个验证步骤失败。`
          : hasRunnerError
            ? "PARTIAL：验证命令已运行，但 runner/toolchain 退出清理异常。"
            : `PARTIAL：${unverified.length} 项未验证。`,
    commands: results,
    unverified,
    risk,
    logPath: logRoot,
    startedAt,
    endedAt,
    durationMs: Date.parse(endedAt) - Date.parse(startedAt),
    nextAction:
      status === "pass"
        ? "可继续审查结果或进入交付总结。"
        : hasRunnerError
          ? "查看 runner error 日志，记录 Node 版本，并建议用 Node 22 LTS 复核。"
          : "先查看失败命令与日志，修复后复跑 /verify。",
  };
  task.status = status === "fail" ? "failed" : "completed";
  task.result = status;
  task.currentStep = "verification finished";
  task.progress = { completed: plan.length, total: plan.length, label: "verify" };
  task.updatedAt = endedAt;
  task.nextAction = report.nextAction;
  task.userVisibleSummary = report.summary;
  await appendBackgroundTaskEvent(context, sessionId, task);
  await context.store.appendEvent(sessionId, {
    type: "verification_end",
    report,
    createdAt: endedAt,
  });
  return report;
}

async function runVerificationCommand(
  command: string,
  cwd: string,
): Promise<{ exitCode: number; output: string; runnerError?: string }> {
  return new Promise((resolveCommand) => {
    const child = spawn(command, { cwd, shell: true });
    let output = "";
    let settled = false;
    const timeout = setTimeout(() => {
      const runnerError = `runner timeout after ${VERIFICATION_COMMAND_TIMEOUT_MS}ms`;
      child.kill("SIGTERM");
      settle({
        exitCode: 1,
        output: output ? `${output}\n${runnerError}` : runnerError,
        runnerError,
      });
    }, VERIFICATION_COMMAND_TIMEOUT_MS);
    const settle = (result: { exitCode: number; output: string; runnerError?: string }) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolveCommand(result);
    };
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      const runnerError = `runner error: ${error.message}`;
      settle({
        exitCode: 1,
        output: output ? `${output}\n${runnerError}` : runnerError,
        runnerError,
      });
    });
    child.on("close", (code, signal) => {
      const exitCode = code ?? 1;
      const runnerError = detectRunnerCompatibilityError(output, exitCode, signal);
      settle({ exitCode, output, runnerError });
    });
  });
}

function detectRunnerCompatibilityError(
  output: string,
  exitCode: number,
  signal: NodeJS.Signals | null,
): string | undefined {
  if (signal) {
    return `runner stopped by signal ${signal}`;
  }
  if (exitCode === 0) {
    return undefined;
  }
  const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
  const normalized = output.replace(ansiPattern, "");
  const vitestPassed =
    /Test Files\s+\d+\s+passed/i.test(normalized) && /Tests\s+\d+\s+passed/i.test(normalized);
  const nodeCleanupError =
    normalized.includes("TypeError: emitter.removeListener is not a function") ||
    normalized.includes("emitter.removeListener is not a function");
  if (vitestPassed && nodeCleanupError) {
    return "runner/toolchain cleanup error after tests passed; verify again with Node 22 LTS";
  }
  const childSignal = normalized.match(/\bSIG(?:TERM|KILL|INT|HUP|ABRT)\b/);
  if (childSignal) {
    return `runner/child stopped by signal ${childSignal[0]}`;
  }
  return undefined;
}

async function recordVerificationEvidence(
  context: TuiContext,
  sessionId: string,
  report: VerificationReport,
): Promise<void> {
  const evidence: EvidenceRecord = {
    id: randomUUID(),
    kind: "test_result",
    summary: `${report.summary} 日志：${report.logPath ?? "无日志"}`,
    source: report.logPath ?? "Verification Runner",
    supportsClaims: ["已验证", "验证通过", "测试通过", "verified", "tests passed"],
    createdAt: new Date().toISOString(),
  };
  context.evidence.unshift(evidence);
  await context.store.appendEvent(sessionId, {
    type: "evidence_record",
    ...evidence,
  });
}

function createReviewReport(context: TuiContext): string {
  const changedFiles =
    context.tools.changedFiles.length > 0 ? context.tools.changedFiles : ["未记录改动"];
  const verification = context.lastVerification;
  const priority = verification?.status === "fail" ? "P0" : verification ? "P2" : "P1";
  const risk = verification
    ? verification.risk.length > 0
      ? verification.risk.join("; ")
      : `最近验证为 ${verification.status.toUpperCase()}`
    : "尚未运行 /verify，不能声称已验证。";
  const suggestion =
    verification?.status === "fail"
      ? "先按失败命令日志修复，再复跑 /verify。"
      : verification?.status === "partial"
        ? "先查看 runner error 日志；如为 Node/工具链退出清理异常，建议用 Node 22 LTS 复核。"
        : verification
          ? "结合 diff 人工确认需求覆盖；如有新改动请复跑 /verify。"
          : "先运行 /verify 或 /verify plan，形成 test_result evidence。";
  return [
    "Review Report",
    `- Priority: ${priority}`,
    `- Files: ${changedFiles.join(", ")}`,
    `- Risk: ${risk}`,
    `- Suggestion: ${suggestion}`,
  ].join("\n");
}

function formatVerificationPlan(plan: VerificationStep[], language: Language): string {
  const header = language === "en-US" ? "Verification plan:" : "验证计划：";
  return [
    header,
    ...plan.map((step, index) => `${index + 1}. [${step.kind}] ${step.command} — ${step.reason}`),
  ].join("\n");
}

function formatVerificationReport(report: VerificationReport, language: Language): string {
  const lines = [
    `${report.status.toUpperCase()} ${report.summary}`,
    language === "en-US" ? `Duration: ${report.durationMs}ms` : `耗时：${report.durationMs}ms`,
  ];
  for (const command of report.commands) {
    lines.push(
      `- [${command.status.toUpperCase()}] ${command.command} (${command.durationMs}ms) log: ${command.logPath ?? "无日志"}`,
    );
    if (command.status !== "pass") {
      lines.push(`  摘要：${command.summary}`);
    }
  }
  if (report.unverified.length > 0) {
    lines.push(`未验证：${report.unverified.join("; ")}`);
  }
  lines.push(`下一步：${report.nextAction}`);
  return lines.join("\n");
}

function formatVerificationLast(
  report: VerificationReport | undefined,
  language: Language,
): string {
  if (!report) {
    return language === "en-US" ? "No verification has run yet." : "还没有最近验证结果。";
  }
  return formatVerificationReport(report, language);
}

function summarizeVerificationOutput(
  output: string,
  exitCode: number,
  runnerError?: string,
): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const tail = lines.slice(-6).join(" | ");
  const summary = tail ? truncateDisplay(tail, 240) : "无输出";
  return runnerError
    ? `exitCode=${exitCode}; runner error=${runnerError}; ${summary}`
    : `exitCode=${exitCode}; ${summary}`;
}

async function safeReadJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function sendMessage(
  text: string,
  context: TuiContext,
  gateway: ModelGateway,
  output: Writable,
): Promise<void> {
  const sessionId = await ensureSession(context);
  context.sessionEnded = false;
  await context.store.appendEvent(sessionId, createUserMessageEvent(text));
  const gate = checkEvidenceGate(text, context);
  if (gate) {
    await appendSystemEvent(context, sessionId, gate, "warning");
    writeLine(output, gate);
    writeStatus(output, context);
    return;
  }
  writeLine(
    output,
    context.language === "en-US" ? "Status: requesting model..." : "状态：正在请求模型...",
  );

  const assistantEventId = randomUUID();
  let assistantText = "";
  const controller = new AbortController();
  const messages: ModelMessage[] = [
    {
      role: "system",
      content:
        context.language === "en-US"
          ? "You are Linghun Phase 11 engineering assistant. Answer in English by default unless the user explicitly requests another language. Use evidence before code claims; avoid unverified claims."
          : "你是 Linghun Phase 11 的工程型中文助手。默认用中文回答，除非用户明确指定其他语言。涉及代码事实必须先有证据，避免未验证断言。",
    },
    { role: "user", content: text },
  ];

  for await (const event of gateway.stream(
    "deepseek",
    { messages, model: context.model },
    controller.signal,
  )) {
    if (event.type === "assistant_text_delta") {
      assistantText += event.text;
      output.write(event.text);
      continue;
    }
    if (event.type === "usage") {
      const stats = recordModelUsage(context, event.usage);
      await appendUsageEvents(context, sessionId, stats);
      continue;
    }
    if (event.type === "error") {
      writeLine(output, formatError(event.error));
      return;
    }
  }

  if (assistantText) {
    output.write("\n");
    await context.store.appendEvent(sessionId, {
      type: "assistant_text_delta",
      id: assistantEventId,
      text: assistantText,
      createdAt: new Date().toISOString(),
    });
  }
  writeLightHints(output, context);
  writeStatus(output, context);
}

async function* readInputLines(input: Readable, output: Writable): AsyncGenerator<string> {
  if ((input as { isTTY?: boolean }).isTTY !== true) {
    const chunks: Buffer[] = [];
    for await (const chunk of input) {
      chunks.push(toInputBuffer(chunk));
    }
    const text = decodeInput(Buffer.concat(chunks));
    for (const line of text.split(/\r?\n/)) {
      yield line;
    }
    return;
  }

  if ("setEncoding" in input && typeof input.setEncoding === "function") {
    input.setEncoding("utf8");
  }

  const rl = createInterface({ input, output });
  try {
    output.write("你> ");
    for await (const line of rl) {
      yield line;
      output.write("你> ");
    }
  } finally {
    rl.close();
  }
}

function toInputBuffer(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) {
    return chunk;
  }
  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk);
  }
  return Buffer.from(String(chunk), "utf8");
}

function decodeInput(bytes: Buffer): string {
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (!utf8.includes("�")) {
    return utf8;
  }
  return new TextDecoder("gb18030", { fatal: false }).decode(bytes);
}

function formatHelp(language: Language): string {
  if (language === "en-US") {
    return `Available commands:
  /help                 Show help
  /language zh-CN|en-US Switch UI language
  /model                Show current model
  /sessions             List sessions
  /sessions resume <id> Resume a session using structured handoff
  /resume [id]          Resume latest or selected session without full transcript injection
  /branch [purpose]     Create a normal branch session from structured handoff
  /memory               Show memory and handoff status
  /memory storage       Show sessions/memory/log/cache storage paths
  /memory review        Review candidate memories before accepting
  /memory accept <id>   Accept a candidate memory
  /memory delete <id>   Delete a candidate memory in this session
  /memory init          Create a basic LINGHUN.md template on explicit request
  /memory import sessions [source] [query]  Import external AI session summary/evidence only
  /mode                 Show permission mode
  /mode plan|acceptEdits|dontAsk|auto|bypass|default  Switch mode
  /tab                  Shift+Tab equivalent: cycle common modes
  /plan                 Show structured plan options
  /plan accept [id]     Accept a plan and return to default
  /permissions          Show permission rules
  /background           Show collapsed background task summaries
  /rewind               List checkpoints
  /rewind restore <id>  Restore a checkpoint
  /btw <question>       Answer a temporary question without changing Todo/Plan/checkpoints
  /interrupt            Mark current running background task as cancelled
  /claim-check <claim>  Downgrade unsupported final claims
  /verify [plan|last|smoke] Generate or run verification
  /review               Review diff, risks, and verification evidence
  /cache-log            Show recent cache usage records
  /cache-log config size <n>  Set cache history size
  /cache-log export [path]  Export recent cache usage records
  /cache status         Show cache status and freshness
  /cache warmup|refresh Attempt cache warmup or refresh
  /break-cache status   Show cache freshness changes
  /mcp [status]         Show MCP server status
  /mcp tools            Show stable MCP tool summary
  /mcp doctor           Diagnose MCP server availability
  /index status         Show codebase-memory index status
  /index init fast      Build a fast local index on explicit request
  /index refresh        Refresh the current project index
  /index search <query> Query codebase-memory and record evidence
  /index architecture   Show short architecture summary
  /usage                Show token/cache usage summary
  /stats                Show local cache/cost statistics
  /stats endpoints      Group usage by endpoint
  /read <path>          Read file
  /write <path> <text>  Write file
  /edit <path> <old> => <new>  Unique replacement
  /multiedit <path> <old> => <new>  Minimal multi-edit entry
  /grep <pattern> [path] Search text
  /glob <pattern> [path] Match files
  /bash <command>       Run command with collapsed task status and full log
  /todo                 Show tasks
  /diff                 Show changed file summary
  /exit                 Exit

Slash commands, config keys, and transcript event fields stay in English.`;
  }
  return `可用命令：
  /help                 显示帮助
  /language zh-CN|en-US 切换界面语言
  /model                显示当前模型
  /sessions             列出当前项目会话
  /sessions resume <id> 基于结构化 handoff 恢复历史会话
  /resume [id]          恢复最近或指定会话，不注入完整历史
  /branch [目的]        基于结构化 handoff 创建普通分支会话
  /memory               查看记忆与 handoff 状态
  /memory storage       查看会话/记忆/日志/cache 存储路径
  /memory review        审查候选记忆
  /memory accept <id>   确认写入候选记忆
  /memory delete <id>   删除本会话候选/已接收记忆记录
  /memory init          显式生成基础 LINGHUN.md 模板
  /memory import sessions [source] [query]  只导入外部 AI 会话摘要和证据引用
  /mode                 查看权限模式
  /mode plan|acceptEdits|dontAsk|auto|bypass|default  切换模式
  /tab                  等价 Shift+Tab：循环切换常用模式
  /plan                 输出结构化可选方案
  /plan accept [id]     确认方案并回到 default 执行
  /permissions          查看权限规则
  /permissions add allow|ask|deny <tool|*> [risk]  添加规则
  /permissions remove <id> 删除规则
  /permissions recent   查看最近拒绝
  /permissions recent delete <id> 删除单条最近拒绝
  /permissions recent clear  清空最近拒绝
  /background           查看后台任务一行摘要
  /rewind               列出 checkpoint
  /rewind restore <id>  恢复 checkpoint
  /btw <question>       临时插问，不修改 Todo/Plan/checkpoint
  /interrupt            标记当前长任务已取消
  /claim-check <claim>  降级缺少证据的最终结论
  /verify [plan|last|smoke] 生成或运行验证
  /review               按代码审查口径输出风险与建议
  /cache-log            查看最近 cache usage 记录
  /cache-log config size <n>  设置 cache 历史容量
  /cache-log export [path]  导出最近 cache usage 记录
  /cache status         查看 cache 状态与 freshness
  /cache warmup|refresh 尝试预热或刷新 cache
  /break-cache status   查看 cache freshness 变化
  /mcp                  查看 MCP 状态
  /mcp status           查看 MCP server 状态
  /mcp tools            查看稳定排序的 MCP tool 摘要
  /mcp doctor           诊断 MCP server 可用性
  /index status         查看 codebase-memory 索引状态
  /index init fast      显式建立 fast 索引
  /index refresh        显式刷新当前项目索引
  /index search <query> 查询索引并写入 evidence
  /index architecture   输出短架构摘要并写入 evidence
  /usage                查看 token/cache usage 汇总
  /stats                查看本地 cache/cost 统计
  /stats endpoints      按 endpoint 聚合 usage
  /read <path>          读取文件
  /write <path> <text>  写入文件
  /edit <path> <old> => <new>  唯一替换
  /multiedit <path> <old> => <new>  批量编辑的最小入口
  /grep <pattern> [path] 搜索文本
  /glob <pattern> [path] 匹配文件
  /bash <command>       执行命令并保存完整日志
  /todo                 查看任务
  /todo add <text>      添加任务
  /todo start|done|block <id> 更新任务状态
  /diff                 显示本轮工具改动摘要
  /exit                 退出

普通输入会发送给当前 provider/model，并写入 JSONL transcript。工具命令也会写入 transcript。`;
}

function slashCommandToTool(command: string): ToolName | null {
  const mapping: Record<string, ToolName> = {
    "/read": "Read",
    "/write": "Write",
    "/edit": "Edit",
    "/multiedit": "MultiEdit",
    "/grep": "Grep",
    "/glob": "Glob",
    "/bash": "Bash",
    "/todo": "Todo",
    "/diff": "Diff",
  };
  return mapping[command] ?? null;
}

async function handleToolCommand(
  name: ToolName,
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  try {
    const input = parseToolInput(name, args);
    const sessionId = await ensureSession(context);
    const permission = await decidePermission(name, input, context, sessionId);
    await context.store.appendEvent(sessionId, {
      type: "permission_request",
      request: permission.request,
      createdAt: new Date().toISOString(),
    });
    await context.store.appendEvent(sessionId, {
      type: "permission_result",
      requestId: permission.request.id,
      decision: permission.decision,
      reason: permission.reason,
      createdAt: new Date().toISOString(),
    });

    if (permission.decision !== "allow") {
      writeLine(output, formatPermissionDenied(permission.reason, permission.request.summary));
      writeStatus(output, context);
      return;
    }

    if (permission.preflight) {
      writeLine(output, permission.preflight);
    }

    const checkpoint = await maybeCreateCheckpoint(name, input, context, sessionId);
    if (checkpoint) {
      writeLine(output, `${t(context, "checkpointCreated")}：${checkpoint.id}`);
    }
    const task = name === "Bash" ? createBackgroundTask(name, input, context) : undefined;
    if (task) {
      context.backgroundTasks.unshift(task);
      await appendBackgroundTaskEvent(context, sessionId, task);
      writeLine(output, formatBackgroundTask(task, context.language));
    }

    const callId = randomUUID();
    await context.store.appendEvent(sessionId, {
      type: "tool_call_start",
      id: callId,
      name,
      input,
      createdAt: new Date().toISOString(),
    });
    const result = await runTool(name, input, context.tools);
    if (task) {
      task.status = "completed";
      task.result = "pass";
      task.updatedAt = new Date().toISOString();
      task.lastOutputAt = task.updatedAt;
      task.hasOutput = Boolean(result.output.text.trim());
      task.logPath = result.output.fullOutputPath;
      task.outputPath = result.output.fullOutputPath;
      task.nextAction =
        context.language === "en-US"
          ? "Review the summarized output or open the log."
          : "可查看摘要输出或打开完整日志。";
      await appendBackgroundTaskEvent(context, sessionId, task);
    }
    await context.store.appendEvent(sessionId, createToolEndEvent(callId, result.output));
    await appendDerivedToolEvents(context, sessionId, name, result.output);
    await recordToolEvidence(context, sessionId, name, result.output);
    writeLine(output, formatToolOutput(name, result.output, context.language));
    writeStatus(output, context);
  } catch (error) {
    writeLine(output, formatError(error));
  }
}

function parseToolInput(name: ToolName, args: string[]): unknown {
  if (name === "Read") {
    return { path: requireArg(args[0], "用法：/read <path>") };
  }
  if (name === "Write") {
    return {
      path: requireArg(args[0], "用法：/write <path> <text>"),
      content: args.slice(1).join(" "),
    };
  }
  if (name === "Edit" || name === "MultiEdit") {
    const path = requireArg(args[0], `用法：/${name.toLowerCase()} <path> <old> => <new>`);
    const expression = args.slice(1).join(" ");
    const separator = expression.indexOf("=>");
    if (separator < 0) {
      throw new Error(`用法：/${name.toLowerCase()} <path> <old> => <new>`);
    }
    const oldText = expression.slice(0, separator).trim();
    const newText = expression.slice(separator + 2).trim();
    if (name === "MultiEdit") {
      return { path, edits: [{ oldText, newText }] };
    }
    return { path, oldText, newText };
  }
  if (name === "Grep") {
    return { pattern: requireArg(args[0], "用法：/grep <pattern> [path]"), path: args[1] };
  }
  if (name === "Glob") {
    return { pattern: requireArg(args[0], "用法：/glob <pattern> [path]"), path: args[1] };
  }
  if (name === "Bash") {
    return { command: requireArg(args.join(" ").trim(), "用法：/bash <command>") };
  }
  if (name === "Todo") {
    const action = args[0];
    if (!action) {
      return { action: "list" };
    }
    if (action === "add") {
      return {
        action,
        content: requireArg(args.slice(1).join(" ").trim(), "用法：/todo add <text>"),
      };
    }
    if (action === "start" || action === "done" || action === "block") {
      return { action, id: requireArg(args[1], `用法：/todo ${action} <id>`) };
    }
    throw new Error("用法：/todo 或 /todo add|start|done|block ...");
  }
  return {};
}

function requireArg(value: string | undefined, usage: string): string {
  if (!value) {
    throw new Error(usage);
  }
  return value;
}

type PermissionCheck = {
  request: {
    id: string;
    toolName: ToolName;
    mode: PermissionMode;
    risk: "low" | "medium" | "high";
    summary: string;
    files: string[];
    reason: string;
  };
  decision: "allow" | "ask" | "deny";
  reason: string;
  preflight?: string;
};

async function decidePermission(
  name: ToolName,
  input: unknown,
  context: TuiContext,
  sessionId: string,
): Promise<PermissionCheck> {
  const tool = builtInTools[name];
  const files = collectInputFiles(input);
  const hardDeny = getHardDenyReason(name, input, files, context.projectPath);
  const request = {
    id: randomUUID(),
    toolName: name,
    mode: context.permissionMode,
    risk: tool.permission.risk,
    summary: formatPermissionSummary(name, files, tool.permission.risk),
    files,
    reason: tool.permission.reason,
  };
  if (hardDeny) {
    await recordPermissionDenied(context, name, hardDeny);
    return { request, decision: "deny", reason: hardDeny };
  }

  const rule = findPermissionRule(context.permissions.rules, name, tool.permission.risk);
  if (rule) {
    if (rule.effect === "deny") {
      const reason = `命中 deny 规则：${rule.id}`;
      await recordPermissionDenied(context, name, reason);
      return { request, decision: "deny", reason };
    }
    if (rule.effect === "ask") {
      const reason = `命中 ask 规则：${rule.id}。当前最小 REPL 没有交互式审批选择，因此本次不会自动执行。`;
      await recordPermissionDenied(context, name, reason);
      return { request, decision: "ask", reason };
    }
    return { request, decision: "allow", reason: `命中 allow 规则：${rule.id}` };
  }

  if (context.permissionMode === "plan") {
    if (isPlanAllowedTool(name, tool.isReadOnly)) {
      return { request, decision: "allow", reason: "Plan 模式允许只读或会话内规划工具。" };
    }
    const reason =
      "Plan 模式禁止写入、编辑和 Bash 执行；请先 /plan accept 确认方案并切回执行模式。";
    await recordPermissionDenied(context, name, reason);
    return { request, decision: "deny", reason };
  }

  if (context.permissionMode === "dontAsk") {
    if (tool.isReadOnly || name === "Todo" || name === "Diff") {
      return { request, decision: "allow", reason: "dontAsk 模式允许只读或会话内工具。" };
    }
    const reason = "dontAsk 模式无法询问用户，需审批的操作自动拒绝，不会自动允许。";
    await recordPermissionDenied(context, name, reason);
    return { request, decision: "deny", reason };
  }

  if (context.permissionMode === "acceptEdits") {
    if (isLowRiskWorkspaceEdit(name, tool.permission.risk, files)) {
      return {
        request,
        decision: "allow",
        reason: "acceptEdits 自动允许工作区内低风险文件编辑。",
        preflight: formatDiffBeforeWrite(name, files, tool.permission.risk),
      };
    }
    if (tool.isReadOnly || name === "Todo" || name === "Diff") {
      return { request, decision: "allow", reason: "acceptEdits 允许只读或会话内工具。" };
    }
    const reason = "acceptEdits 不自动允许 Bash、高风险或越界操作。";
    await recordPermissionDenied(context, name, reason);
    return { request, decision: "deny", reason };
  }

  if (context.permissionMode === "bypass") {
    return {
      request,
      decision: "allow",
      reason: "bypass 已由用户显式开启，但硬拒绝和安全路径仍生效。",
      preflight: tool.isReadOnly
        ? undefined
        : formatDiffBeforeWrite(name, files, tool.permission.risk),
    };
  }

  if (context.permissionMode === "auto") {
    if (tool.isReadOnly || name === "Todo" || name === "Diff") {
      return { request, decision: "allow", reason: "auto 分类为低风险只读/会话内工具。" };
    }
    const reason = "auto 分类器不可用，需审批操作回退为拒绝，避免默认放行。";
    await recordPermissionDenied(context, name, reason);
    return { request, decision: "deny", reason };
  }

  if (tool.isReadOnly || name === "Todo" || name === "Diff") {
    return { request, decision: "allow", reason: "default 模式允许只读或会话内工具。" };
  }
  return {
    request,
    decision: "allow",
    reason: "default 模式展示风险摘要后允许本次工作区操作。",
    preflight: formatDiffBeforeWrite(name, files, tool.permission.risk),
  };
}

function isPlanAllowedTool(name: ToolName, isReadOnly: boolean): boolean {
  return isReadOnly || name === "Todo";
}

function isLowRiskWorkspaceEdit(
  name: ToolName,
  risk: "low" | "medium" | "high",
  files: string[],
): boolean {
  return (
    (name === "Write" || name === "Edit" || name === "MultiEdit") &&
    risk === "low" &&
    files.length > 0
  );
}

function collectInputFiles(input: unknown): string[] {
  if (typeof input !== "object" || input === null || !("path" in input)) {
    return [];
  }
  const path = (input as { path?: unknown }).path;
  return typeof path === "string" ? [path.replaceAll("\\", "/")] : [];
}

function getHardDenyReason(
  name: ToolName,
  input: unknown,
  files: string[],
  workspaceRoot: string,
): string | null {
  for (const file of files) {
    const target = resolve(workspaceRoot, file);
    const rel = relative(resolve(workspaceRoot), target);
    if (rel.startsWith("..") || (rel === "" && !builtInTools[name].isReadOnly)) {
      return `路径越界或指向工作区根：${file}。只允许操作当前工作区内明确文件。`;
    }
    const normalized = rel.replaceAll("\\", "/");
    if (normalized.startsWith(".git/") || normalized.includes("/.git/")) {
      return "安全保护：禁止修改 .git 目录。";
    }
    if (
      normalized.includes(".ssh/") ||
      normalized.endsWith(".env") ||
      normalized.includes("secret")
    ) {
      return "安全保护：疑似密钥或敏感路径，需要更高阶段的安全流程处理。";
    }
  }
  if (name === "Bash") {
    const command =
      typeof input === "object" && input !== null ? (input as { command?: unknown }).command : "";
    if (typeof command !== "string" || !command.trim()) {
      return "Bash 命令不能为空。";
    }
    if (
      /(rm\s+-rf|curl\s+[^|]+\|\s*(sh|bash)|wget\s+[^|]+\|\s*(sh|bash)|mkfs|shutdown|reboot)/i.test(
        command,
      )
    ) {
      return "安全保护：拒绝高风险删除、远程脚本执行或系统级命令。";
    }
  }
  return null;
}

function findPermissionRule(
  rules: PermissionRule[],
  name: ToolName,
  risk: "low" | "medium" | "high",
): PermissionRule | undefined {
  return rules.find(
    (rule) =>
      (rule.toolName === "*" || rule.toolName === name) && (!rule.risk || rule.risk === risk),
  );
}

async function recordPermissionDenied(
  context: TuiContext,
  toolName: ToolName,
  reason: string,
): Promise<void> {
  context.permissions.recentDenied.unshift({
    id: randomUUID(),
    toolName,
    mode: context.permissionMode,
    reason,
    createdAt: new Date().toISOString(),
  });
  context.permissions.recentDenied = context.permissions.recentDenied.slice(0, 20);
  await savePermissionState(context.projectPath, context.permissions);
}

function formatPermissionSummary(
  name: ToolName,
  files: string[],
  risk: "low" | "medium" | "high",
): string {
  const targets = files.length === 0 ? "无文件路径" : files.join(", ");
  return `工具 ${name}；目标：${targets}；风险：${risk}`;
}

function formatDiffBeforeWrite(
  name: ToolName,
  files: string[],
  risk: "low" | "medium" | "high",
): string {
  const fileText = files.length === 0 ? "未声明文件" : files.join(", ");
  return `写入前摘要：将执行 ${name}\n将影响文件：${fileText}\n风险：${risk}\n原因：工作区内工具操作；本阶段展示轻量摘要，不生成完整 git hunk。`;
}

function formatPermissionDenied(reason: string, summary: string): string {
  return `权限已拒绝：${reason}\n本次请求：${summary}\n建议：查看 /permissions recent，或切换合适模式后重试。`;
}

function isPermissionMode(value: string): value is PermissionMode {
  return ["default", "plan", "acceptEdits", "dontAsk", "auto", "bypass"].includes(value);
}

async function loadPermissionState(projectPath: string): Promise<PermissionState> {
  try {
    const raw = await readFile(permissionStatePath(projectPath), "utf8");
    const parsed = JSON.parse(raw) as Partial<PermissionState>;
    return {
      rules: Array.isArray(parsed.rules) ? parsed.rules : [],
      recentDenied: Array.isArray(parsed.recentDenied) ? parsed.recentDenied : [],
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { rules: [], recentDenied: [] };
    }
    throw error;
  }
}

async function savePermissionState(projectPath: string, state: PermissionState): Promise<void> {
  await mkdir(join(projectPath, ".linghun"), { recursive: true });
  await writeFile(permissionStatePath(projectPath), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function permissionStatePath(projectPath: string): string {
  return join(projectPath, ".linghun", "permissions.json");
}

function formatPermissionRules(state: PermissionState): string {
  if (state.rules.length === 0) {
    return "当前没有持久化权限规则。可用 /permissions add allow|ask|deny <tool|*> [risk] 添加。";
  }
  return state.rules
    .map(
      (rule) => `${rule.id}  ${rule.effect}  ${rule.toolName}${rule.risk ? `  ${rule.risk}` : ""}`,
    )
    .join("\n");
}

function formatRecentDenied(state: PermissionState): string {
  if (state.recentDenied.length === 0) {
    return "最近没有拒绝记录。";
  }
  return state.recentDenied
    .map((item) => `${item.createdAt}  ${item.toolName}  ${item.mode}  ${item.reason}`)
    .join("\n");
}

function formatPlanProposal(proposal: PlanProposal): string {
  const lines = [`PlanProposal ${proposal.id}：${proposal.title}`];
  for (const option of proposal.options) {
    lines.push(`方案 ${option.id}：${option.title}`);
    lines.push(...option.steps.map((step, index) => `  ${index + 1}. ${step}`));
    lines.push(...option.risks.map((risk) => `  风险：${risk}`));
  }
  return lines.join("\n");
}

async function maybeCreateCheckpoint(
  name: ToolName,
  input: unknown,
  context: TuiContext,
  sessionId: string,
): Promise<CheckpointState | null> {
  const files = collectInputFiles(input);
  const needsCheckpoint = !builtInTools[name].isReadOnly && files.length > 0;
  if (!needsCheckpoint) {
    return null;
  }
  const checkpoint: CheckpointState = {
    id: randomUUID(),
    sessionId,
    createdAt: new Date().toISOString(),
    reason: `before ${name}`,
    changedFiles: files,
    restoreKind: "snapshot",
    files: [],
  };
  for (const file of files) {
    const target = resolve(context.projectPath, file);
    try {
      checkpoint.files.push({ path: file, existed: true, content: await readFile(target, "utf8") });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        checkpoint.files.push({ path: file, existed: false });
        continue;
      }
      throw error;
    }
  }
  context.checkpoints.unshift(checkpoint);
  await context.store.appendEvent(sessionId, {
    type: "checkpoint_created",
    checkpoint: {
      id: checkpoint.id,
      sessionId: checkpoint.sessionId,
      createdAt: checkpoint.createdAt,
      reason: checkpoint.reason,
      changedFiles: checkpoint.changedFiles,
      restoreKind: checkpoint.restoreKind,
    },
    createdAt: checkpoint.createdAt,
  });
  return checkpoint;
}

function createBackgroundTask(
  name: ToolName,
  input: unknown,
  context: TuiContext,
): BackgroundTaskState {
  const now = new Date().toISOString();
  const command =
    typeof input === "object" && input !== null ? (input as { command?: unknown }).command : "";
  const title =
    name === "Bash" && typeof command === "string" ? `Bash: ${truncateDisplay(command, 40)}` : name;
  return {
    id: randomUUID(),
    kind: "bash",
    title,
    status: "running",
    currentStep: context.language === "en-US" ? "running command" : "正在执行命令",
    progress: { completed: 0, total: 1, label: "Bash" },
    startedAt: now,
    updatedAt: now,
    heartbeatIntervalMs: 30_000,
    staleAfterMs: 120_000,
    hasOutput: false,
    userVisibleSummary:
      context.language === "en-US"
        ? "Started long task. Use /background for details."
        : "长任务已启动。可用 /background 查看详情。",
    nextAction:
      context.language === "en-US"
        ? "Wait for completion or use /interrupt."
        : "等待完成，或用 /interrupt 中断。",
  };
}

async function appendBackgroundTaskEvent(
  context: TuiContext,
  sessionId: string,
  task: BackgroundTaskState,
): Promise<void> {
  await context.store.appendEvent(sessionId, {
    type: "background_task_update",
    task,
    createdAt: new Date().toISOString(),
  });
}

async function recordToolEvidence(
  context: TuiContext,
  sessionId: string,
  name: ToolName,
  output: ToolOutput,
): Promise<void> {
  const kind =
    name === "Read"
      ? "file_read"
      : name === "Grep" || name === "Glob"
        ? "grep_result"
        : name === "Bash"
          ? "command_output"
          : null;
  if (!kind) {
    return;
  }
  const evidence: EvidenceRecord = {
    id: randomUUID(),
    kind,
    summary: `${name}: ${truncateDisplay(output.text.replace(/\s+/g, " "), 120)}`,
    source: output.fullOutputPath ?? name,
    supportsClaims: [name],
    createdAt: new Date().toISOString(),
  };
  context.evidence.unshift(evidence);
  await context.store.appendEvent(sessionId, {
    type: "evidence_record",
    ...evidence,
  });
}

async function appendSystemEvent(
  context: TuiContext,
  sessionId: string,
  message: string,
  level: "info" | "warning",
): Promise<void> {
  await context.store.appendEvent(sessionId, {
    type: "system_event",
    id: randomUUID(),
    level,
    message,
    createdAt: new Date().toISOString(),
  });
}

function checkEvidenceGate(text: string, context: TuiContext): string | null {
  const lower = text.toLowerCase();
  const asksCodeFact =
    /代码|函数|调用链|实现|修复|验证|code|function|call chain|fixed|verified/.test(lower);
  if (!asksCodeFact) {
    return null;
  }
  if (context.evidence.length > 0) {
    return null;
  }
  return t(context, "evidenceBlocked");
}

type ClaimCheck = {
  status: "passed" | "needs_disclaimer" | "blocked";
  unsupportedClaims: string[];
};

function checkClaimSupport(claim: string, context: TuiContext): ClaimCheck {
  const highRisk = [
    "已修复",
    "已验证",
    "测试通过",
    "代码里",
    "调用链是",
    "不会影响",
    "fixed",
    "verified",
    "tests passed",
    "in the code",
  ];
  const unsupportedClaims = highRisk.filter((item) => claim.includes(item));
  if (unsupportedClaims.length === 0 || context.evidence.length > 0) {
    return { status: "passed", unsupportedClaims: [] };
  }
  return { status: "needs_disclaimer", unsupportedClaims };
}

function formatClaimCheck(result: ClaimCheck, language: Language): string {
  if (result.status === "passed") {
    return language === "en-US" ? "Claim check passed." : "Claim Checker：通过。";
  }
  const claims = result.unsupportedClaims.join(", ");
  return language === "en-US"
    ? `Claim needs disclaimer: ${claims}. Use unverified / pending confirmation wording.`
    : `Claim Checker：缺少证据，需降级表述：${claims}。请改写为“未验证 / 待确认”。`;
}

function formatBackgroundTask(task: BackgroundTaskState, language: Language): string {
  const progress = task.progress ? ` ${task.progress.completed}/${task.progress.total ?? "?"}` : "";
  const output = task.hasOutput
    ? (task.logPath ?? "-")
    : language === "en-US"
      ? "no valid output yet"
      : "尚未产生有效输出";
  return language === "en-US"
    ? `[background] ${task.title} · ${task.status} · ${task.currentStep ?? "-"}${progress} · log: ${output} · next: ${task.nextAction ?? "-"}`
    : `[后台] ${task.title} · ${task.status} · ${task.currentStep ?? "-"}${progress} · 日志：${output} · 下一步：${task.nextAction ?? "-"}`;
}

function createToolEndEvent(id: string, output: ToolOutput): TranscriptEvent {
  return {
    type: "tool_call_end",
    id,
    output,
    createdAt: new Date().toISOString(),
  };
}

async function appendDerivedToolEvents(
  context: TuiContext,
  sessionId: string,
  name: ToolName,
  output: ToolOutput,
): Promise<void> {
  if (name === "Todo") {
    await context.store.appendEvent(sessionId, {
      type: "todo_update",
      items: context.tools.todos as TodoItem[],
      createdAt: new Date().toISOString(),
    });
  }
  if (name === "Diff" && isDiffSummary(output.data)) {
    await context.store.appendEvent(sessionId, {
      type: "diff_update",
      summary: output.data,
      createdAt: new Date().toISOString(),
    });
  }
}

function isDiffSummary(value: unknown): value is DiffSummary {
  return typeof value === "object" && value !== null && "changedFiles" in value;
}

function formatToolOutput(name: ToolName, output: ToolOutput, language: Language): string {
  const lines = [
    language === "en-US" ? `Tool ${name} result:` : `工具 ${name} 结果：`,
    output.text,
  ];
  if (output.truncated && output.fullOutputPath) {
    lines.push(
      language === "en-US"
        ? `Full log: ${output.fullOutputPath}`
        : `完整日志：${output.fullOutputPath}`,
    );
  }
  return lines.join("\n");
}

async function ensureSession(context: TuiContext): Promise<string> {
  if (context.sessionId) {
    return context.sessionId;
  }

  const session = await context.store.create({ model: context.model });
  context.sessionId = session.id;
  context.sessionEnded = false;
  return session.id;
}

function isSessionEnded(transcript: TranscriptEvent[]): boolean {
  return transcript.at(-1)?.type === "session_end";
}

function writeStatus(output: Writable, context: TuiContext): void {
  const background = context.backgroundTasks.filter((task) => task.status === "running").length;
  const latestHitRate = context.cache.history.at(-1)?.hitRate ?? null;
  const status = t(context, "status", {
    session: truncateDisplay(
      context.sessionId ?? (context.language === "en-US" ? "new" : "未创建"),
      8,
    ),
    model: truncateDisplay(context.model, 18),
    mode: context.permissionMode,
    background: String(background),
    cache: formatPercent(latestHitRate),
    index: context.index.status,
  });
  writeLine(output, truncateDisplay(status, 96));
}

function t(context: TuiContext, key: MessageKey, values: Record<string, string> = {}): string {
  let template = messages[context.language][key];
  for (const [name, value] of Object.entries(values)) {
    template = template.replaceAll(`{${name}}`, value);
  }
  return template;
}

const messages: Record<Language, Record<MessageKey, string>> = {
  "zh-CN": {
    appTitle: "{name} Phase 11 TUI / REPL",
    intro: "输入普通消息开始对话；输入 /help 查看命令；输入 /exit 退出。",
    currentModel: "当前模型",
    unknownCommand: "未知命令",
    exit: "已退出 Linghun。",
    status:
      "状态栏：session {session} · model {model} · mode {mode} · bg {background} · cache {cache} · index {index}",
    statusShort: "状态栏：{mode} · bg {background}",
    help: "帮助",
    inputPrompt: "你> ",
    noSessions: "当前项目还没有会话。",
    sessionHeader: "会话ID  更新时间  摘要",
    noSummary: "（无摘要）",
    checkpointCreated: "已创建 checkpoint",
    checkpointNone: "当前没有 checkpoint。",
    checkpointRestored: "已恢复 checkpoint",
    checkpointMissing: "未找到 checkpoint",
    backgroundNone: "当前没有后台任务。",
    backgroundEmptyOutput: "尚未产生有效输出",
    backgroundRunning: "仍在运行",
    interruptIdle: "当前没有正在运行的长任务；状态为 idle。",
    interruptCancelled: "已标记当前长任务为 cancelled。",
    btwPrefix: "临时插问",
    evidenceBlocked:
      "尚未确认，需要先检查。涉及代码事实的结论必须先通过 /read、/grep、索引查询或命令输出获得证据。",
    claimNeedsDisclaimer: "缺少证据，必须降级为未验证或待确认表述。",
  },
  "en-US": {
    appTitle: "{name} Phase 11 TUI / REPL",
    intro: "Type a message to chat; use /help for commands; use /exit to quit.",
    currentModel: "Current model",
    unknownCommand: "Unknown command",
    exit: "Exited Linghun.",
    status:
      "Status: session {session} · model {model} · mode {mode} · bg {background} · cache {cache} · index {index}",
    statusShort: "Status: {mode} · bg {background}",
    help: "Help",
    inputPrompt: "you> ",
    noSessions: "No sessions for this project yet.",
    sessionHeader: "Session ID  Updated At  Summary",
    noSummary: "(no summary)",
    checkpointCreated: "Checkpoint created",
    checkpointNone: "No checkpoints yet.",
    checkpointRestored: "Checkpoint restored",
    checkpointMissing: "Checkpoint not found",
    backgroundNone: "No background tasks.",
    backgroundEmptyOutput: "no valid output yet",
    backgroundRunning: "still running",
    interruptIdle: "No long task is running; state is idle.",
    interruptCancelled: "Current long task marked as cancelled.",
    btwPrefix: "Temporary question",
    evidenceBlocked:
      "Not confirmed yet; evidence is required first. Use /read, /grep, index query, or command output before code-fact claims.",
    claimNeedsDisclaimer:
      "Evidence is missing; downgrade to unverified or pending confirmation wording.",
  },
};

function truncateDisplay(text: string, maxWidth: number): string {
  let width = 0;
  let result = "";
  for (const char of stripAnsi(text)) {
    const charWidth = char.charCodeAt(0) > 0xff ? 2 : 1;
    if (width + charWidth > maxWidth) {
      return `${result}…`;
    }
    width += charWidth;
    result += char;
  }
  return result;
}

function stripAnsi(text: string): string {
  const escapeChar = String.fromCharCode(27);
  return text.replace(new RegExp(`${escapeChar}\\[[0-9;]*m`, "g"), "");
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items)];
}

function createUserMessageEvent(text: string): TranscriptEvent {
  return {
    type: "user_message",
    id: randomUUID(),
    text,
    createdAt: new Date().toISOString(),
  };
}

function createSessionEndEvent(sessionId: string): TranscriptEvent {
  return {
    type: "session_end",
    sessionId,
    createdAt: new Date().toISOString(),
  };
}

function formatError(error: unknown): string {
  if (error instanceof Error && "suggestion" in error && typeof error.suggestion === "string") {
    return `错误：${error.message}\n建议：${error.suggestion}`;
  }
  if (error instanceof Error) {
    return `错误：${error.message}`;
  }
  return "错误：未知错误。";
}

function writeLine(output: Writable, text: string): void {
  output.write(`${text}\n`);
}
