// Module 2: tui-state-runtime
// Pure state-factory helpers extracted from packages/tui/src/index.ts as part
// of the D.13 mechanical split. Behavior is unchanged. The functions here all
// operate on plain inputs (config, projectPath, simple values) and return
// fresh state objects; none mutate TuiContext, so they can live outside
// index.ts cleanly.
//
// `refreshRemoteState` deliberately stays in index.ts because it mutates the
// TuiContext (assigns context.remote and forwards previous fields). Splitting
// it would require re-importing TuiContext into this module, which we want to
// avoid for the reasons documented in tui-data-types.ts.
//
// The leaf helpers `isRecord`, `stabilizeMcpToolList`, `codebaseMemoryRequiredArgs`
// and `getRemoteInstallHint` were originally scattered later in index.ts; they
// move here together with their primary callers so this module stays
// self-contained. index.ts re-exports them so the rest of the file (and the
// existing tests) keep working.

import { spawnSync } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import {
  type LinghunConfig,
  type RemoteChannelConfig,
  type RemoteChannelType,
  resolveStoragePaths,
} from "@linghun/config";
import { builtInTools } from "@linghun/tools";
import { createCacheFreshness } from "./cache-freshness.js";
import { formatError, truncateDisplay } from "./startup-runtime.js";
import { loadMemoryRulesFile, parseMemoryRuleFrontmatter } from "./memory-rules-runtime.js";
import { createReplBridgeState } from "./remote-repl-bridge-runtime.js";
import type {
  CacheState,
  ExtensionLifecycleRecord,
  ExtensionScope,
  ExtensionSource,
  HookState,
  HookSummary,
  McpServerState,
  McpState,
  McpToolState,
  MemoryCandidate,
  MemoryState,
  MemoryStatus,
  PluginState,
  PluginSummary,
  RemoteChannelState,
  RemoteState,
  SkillState,
  SkillSummary,
  WorkflowState,
  WorkflowTemplate,
} from "./tui-data-types.js";
import { createWorkspaceReferenceCache } from "./workspace-reference-cache.js";

const DEFAULT_CACHE_HISTORY_SIZE = 20;
const DEFAULT_CACHE_WARN_BELOW_HIT_RATE = 0.75;
const PROJECT_RULES_SUMMARY_WIDTH = 600;
const MEMORY_LEARNING_STATE_FILE = "learning-state.json";

// D.13P boundary cleanup: cache freshness 默认维度不再硬编码 deepseek/deepseek-v4-flash。
// 调用方（context bootstrap）会传入 resolved initialModel；无 model 时以 unknown 占位，
// 由 model 名前缀推导 provider（保留 deepseek-* 推断），其他情况标 unknown，避免把
// Claude / OpenAI-compatible 的 cache 状态误显示为 DeepSeek。
function inferProviderForCacheModel(model: string): string {
  if (!model || model === "unknown") return "unknown";
  if (model.startsWith("deepseek-")) return "deepseek";
  return "unknown";
}

export function createCacheState(
  projectPath: string,
  model = "unknown",
  mcpToolList: McpToolState[] = [],
  config?: LinghunConfig,
): CacheState {
  const freshness = createCacheFreshness({
    systemPrompt: "Linghun interactive terminal with local extensions and workflows",
    toolSchema: builtInTools,
    mcpToolList: stabilizeMcpToolList(mcpToolList),
    model,
    provider: inferProviderForCacheModel(model),
    projectRules: "local CLAUDE.md rules loaded by harness",
    memory: "memory/handoff context not loaded yet",
    compact: "not compacted",
    plugins: [],
  });
  return {
    config: {
      maxTurns: DEFAULT_CACHE_HISTORY_SIZE,
      warnBelowHitRate: DEFAULT_CACHE_WARN_BELOW_HIT_RATE,
      persistPath: join(resolveStoragePaths(config, projectPath).cache, "cache-log.json"),
      hintsMuted: false,
    },
    history: [],
    nextTurn: 1,
    lastFreshness: freshness,
    hintLastShownAt: {},
    compacted: false,
    compactBoundaries: [],
    compactProjection: undefined,
    deepCompact: undefined,
    compactPressure: undefined,
    compactFailure: undefined,
    compactCooldownUntil: undefined,
    deepCompactCooldownUntil: undefined,
    workspaceReference: createWorkspaceReferenceCache(),
    startedAt: Date.now(),
  };
}

export function createRemoteState(config: LinghunConfig): RemoteState {
  return {
    enabled: config.remote.enabled,
    channels: Object.entries(config.remote.channels)
      .map(([id, channel]) => createRemoteChannelState(id, channel, config.remote.enabled))
      .sort((a, b) => a.id.localeCompare(b.id)),
    events: [],
    processedMessageIds: [],
    sessionDisabledChannelIds: [],
    pairings: [],
    inbox: [],
    localReplBridge: createReplBridgeState(),
  };
}

function createRemoteChannelState(
  id: string,
  config: RemoteChannelConfig,
  remoteEnabled: boolean,
): RemoteChannelState {
  const active = remoteEnabled && config.enabled;
  const bindingStatus = config.bindingUserId ? "bound" : "unbound";
  const transportStatus = active ? getRemoteTransportStatus(config) : "unknown";
  const disabledReason = active ? undefined : "remote_disabled";
  const blockedReason =
    disabledReason ?? getRemoteBlockedReason(config, transportStatus, bindingStatus);
  return {
    id,
    config,
    runtimeStatus: blockedReason
      ? blockedReason === "remote_disabled"
        ? "disabled"
        : "blocked"
      : "ready",
    bindingStatus,
    transportStatus,
    lastError: blockedReason,
    nextAction: getRemoteNextAction(id, config, blockedReason),
  };
}

export function applyRemoteSessionDisables(remote: RemoteState): void {
  for (const channel of remote.channels) {
    if (!remote.sessionDisabledChannelIds.includes(channel.id)) {
      continue;
    }
    channel.runtimeStatus = "disabled";
    channel.lastError = "disabled_by_user";
    channel.nextAction = `/remote setup ${channel.id}`;
  }
}

function getRemoteTransportStatus(
  config: RemoteChannelConfig,
): RemoteChannelState["transportStatus"] {
  if (config.transport === "webhook_mock") {
    return "mock";
  }
  if (config.transport === "webhook") {
    return config.endpoint ? "ready" : "not_configured";
  }
  if (!config.cliPath) {
    return "not_configured";
  }
  const result = spawnSync(config.cliPath, ["--version"], { encoding: "utf8", timeout: 2_000 });
  return result.error ? "missing" : "ready";
}

function getRemoteBlockedReason(
  config: RemoteChannelConfig,
  transportStatus: RemoteChannelState["transportStatus"],
  bindingStatus: RemoteChannelState["bindingStatus"],
): string | undefined {
  if (bindingStatus !== "bound") {
    return "not_bound";
  }
  if (config.transport === "official_cli" && transportStatus !== "ready") {
    return transportStatus === "missing" ? "cli_missing" : "cli_not_configured";
  }
  if (config.transport === "webhook" && transportStatus !== "ready") {
    return "webhook_missing";
  }
  if (!config.trustedSources.length) {
    return "source_not_trusted";
  }
  return undefined;
}

function getRemoteNextAction(
  channelId: string,
  config: RemoteChannelConfig,
  reason: string | undefined,
): string {
  if (!reason || reason === "remote_disabled") {
    return reason ? `/remote setup ${channelId}` : `/remote test ${channelId}`;
  }
  if (reason === "not_bound") {
    return `/remote setup ${channelId}`;
  }
  if (reason === "cli_missing") {
    return getRemoteInstallHint(config.type);
  }
  if (reason === "webhook_missing") {
    return `configure a redacted webhook endpoint or use /remote setup ${channelId}`;
  }
  if (reason === "source_not_trusted") {
    return `bind a trusted source with /remote setup ${channelId}`;
  }
  return "/remote doctor";
}

export function getRemoteInstallHint(type: RemoteChannelType): string {
  if (type === "feishu" || type === "lark") {
    return "install lark-cli/feishu-cli, then run feishu-cli config init or lark-cli auth login";
  }
  if (type === "dingtalk") {
    return "install dws, then run dws auth login or dws device login";
  }
  return "install wecom-cli, then run wecom-cli init/auth";
}

export function createMcpState(config: LinghunConfig): McpState {
  const servers = Object.entries(config.mcp.servers)
    .map(
      ([name, server]) =>
        ({
          name,
          command: server.command,
          status:
            server.disabled || !config.mcp.enabledServers.includes(name)
              ? "disabled"
              : "configured",
        }) satisfies McpServerState,
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    enabled: config.mcp.enabledServers.length > 0,
    servers,
    tools: stabilizeMcpToolList(
      servers
        .filter((server) => server.status === "configured")
        .flatMap((server) => createMcpToolPlaceholders(server.name, "placeholder")),
    ),
  };
}

export function createMcpToolPlaceholders(
  serverName: string,
  discovery: "discovered" | "placeholder",
): McpToolState[] {
  if (serverName !== "codebase-memory") {
    return [
      {
        server: serverName,
        name: `${serverName}.status`,
        description:
          "MCP server health and tool discovery placeholder; real tool schemas are not dumped.",
        discovery,
        trusted: discovery === "discovered",
        schemaLoaded: discovery === "discovered",
        runtimeVersion: discovery === "discovered" ? "compatible" : "unknown",
      },
    ];
  }
  return Object.keys(codebaseMemoryRequiredArgs()).map((tool) => ({
    server: serverName,
    name: `${serverName}.${tool}`,
    description: `codebase-memory ${tool}; schema summary only, full schema omitted.`,
    discovery,
    trusted: discovery === "discovered",
    schemaLoaded: discovery === "discovered",
    runtimeVersion: discovery === "discovered" ? "compatible" : "unknown",
  }));
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
    ...(projectRules.includedPaths ? { projectRulesIncludedPaths: projectRules.includedPaths } : {}),
    ...(projectRules.warnings ? { projectRulesWarnings: projectRules.warnings } : {}),
    ...(projectRules.truncated ? { projectRulesTruncated: projectRules.truncated } : {}),
    projectDir: paths.memoryProject,
    userDir: paths.memoryUser,
    sessionDir: paths.memorySession,
    candidates: await loadMemoryByStatus(paths, "candidate"),
    accepted: await loadMemoryByStatus(paths, "accepted"),
    rejected: await loadMemoryByStatus(paths, "rejected"),
    disabled: await loadMemoryByStatus(paths, "disabled"),
    retired: await loadMemoryByStatus(paths, "retired"),
    ...((await loadMemoryLearningMode(paths)) ?? {
      learningMode: "active" as const,
      learningModeSource: "default" as const,
    }),
  };
}

async function loadProjectRulesSummary(
  path: string,
): Promise<{
  exists: boolean;
  summary: string;
  error?: string;
  includedPaths?: string[];
  warnings?: string[];
  truncated?: boolean;
}> {
  try {
    const loaded = await loadMemoryRulesFile(path);
    const parsed = parseMemoryRuleFrontmatter(loaded.content);
    return {
      exists: true,
      summary: summarizeProjectRules(parsed.body),
      includedPaths: loaded.includedPaths,
      warnings: loaded.warnings,
      truncated: loaded.truncated,
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { exists: false, summary: "missing" };
    }
    return { exists: false, summary: "unreadable", error: formatError(error) };
  }
}

export function summarizeProjectRules(content: string): string {
  const normalized = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(" ")
    .replace(/\s+/g, " ");
  return truncateDisplay(normalized || "empty", PROJECT_RULES_SUMMARY_WIDTH);
}

async function loadMemoryByStatus(
  paths: ReturnType<typeof resolveStoragePaths>,
  status: MemoryStatus,
): Promise<MemoryCandidate[]> {
  const [projectMemory, userMemory] = await Promise.all([
    loadMemoryDirByStatus(paths.memoryProject, status),
    loadMemoryDirByStatus(paths.memoryUser, status),
  ]);
  return [...projectMemory, ...userMemory].sort((a, b) => a.id.localeCompare(b.id));
}

async function loadMemoryLearningMode(
  paths: ReturnType<typeof resolveStoragePaths>,
): Promise<{ learningMode: MemoryState["learningMode"]; learningModeSource: "persisted" } | null> {
  try {
    const value = JSON.parse(
      await readFile(join(paths.memoryUser, MEMORY_LEARNING_STATE_FILE), "utf8"),
    ) as unknown;
    if (!isRecord(value)) return null;
    if (value.learningMode !== "active" && value.learningMode !== "off") return null;
    return { learningMode: value.learningMode, learningModeSource: "persisted" };
  } catch {
    return null;
  }
}

async function loadMemoryDirByStatus(
  directory: string,
  status: MemoryStatus,
): Promise<MemoryCandidate[]> {
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
  return memory.filter(
    (item): item is MemoryCandidate => item !== null && normalizeMemoryStatus(item) === status,
  );
}

async function readMemoryCandidate(path: string): Promise<MemoryCandidate | null> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    return parseMemoryCandidate(value);
  } catch {
    return null;
  }
}

function parseMemoryCandidate(value: unknown): MemoryCandidate | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.id !== "string" ||
    typeof value.summary !== "string" ||
    typeof value.source !== "string" ||
    typeof value.createdAt !== "string"
  ) {
    return null;
  }
  if (value.scope !== "project" && value.scope !== "user" && value.scope !== "session") {
    return null;
  }
  const status =
    value.status === "candidate" ||
    value.status === "accepted" ||
    value.status === "rejected" ||
    value.status === "disabled" ||
    value.status === "retired"
      ? value.status
      : "accepted";
  const risk = value.risk === "medium" || value.risk === "high" ? value.risk : "low";
  const sourceRefs = Array.isArray(value.sourceRefs)
    ? value.sourceRefs.filter((item): item is string => typeof item === "string")
    : [value.source];
  return {
    id: value.id,
    scope: value.scope,
    status,
    summary: truncateDisplay(value.summary.replace(/\s+/g, " "), 240),
    source: value.source,
    sourceRefs: sourceRefs.slice(0, 6),
    risk,
    inferred: value.inferred === true,
    createdAt: value.createdAt,
  };
}

export function normalizeMemoryStatus(item: MemoryCandidate): MemoryStatus {
  return item.status ?? "accepted";
}

function resolveConfiguredDir(projectPath: string, configured: string): string {
  if (configured.startsWith("~/")) {
    return join(homedir(), configured.slice(2));
  }
  return resolve(projectPath, configured);
}

export async function createSkillState(
  config: LinghunConfig,
  projectPath: string,
): Promise<SkillState> {
  const projectDir = resolveConfiguredDir(projectPath, config.skills.projectDir);
  const userDir = resolveConfiguredDir(projectPath, config.skills.userDir);
  try {
    const skills = await loadSkillSummaries(config, projectDir, userDir);
    return {
      enabled: config.skills.enabled,
      projectDir,
      userDir,
      skills,
      disabledIds: [...config.skills.disabledIds].sort((a, b) => a.localeCompare(b)),
      trustedIds: [...config.skills.trustedIds].sort((a, b) => a.localeCompare(b)),
      evolutionCandidates: [],
      rejectedEvolutionCandidates: [],
    };
  } catch (error) {
    return {
      enabled: config.skills.enabled,
      projectDir,
      userDir,
      skills: [],
      disabledIds: config.skills.disabledIds,
      trustedIds: config.skills.trustedIds,
      evolutionCandidates: [],
      rejectedEvolutionCandidates: [],
      lastError: formatError(error),
    };
  }
}

export function createWorkflowState(config: LinghunConfig): WorkflowState {
  return {
    enabled: config.workflows.enabled,
    disabledIds: [...config.workflows.disabledIds].sort((a, b) => a.localeCompare(b)),
    templates: [
      workflow("bug-fix", "定位 bug、做最小修复、运行相关验证", "medium", true, [
        "corepack pnpm test",
        "corepack pnpm typecheck",
      ]),
      workflow("design-to-code", "把已确认设计转成最小代码改动", "high", true, [
        "corepack pnpm test",
        "corepack pnpm build",
      ]),
      workflow("doc-to-code", "按文档差异补齐代码入口和验证", "medium", true, [
        "corepack pnpm test",
        "corepack pnpm check",
      ]),
      workflow("refactor-plan", "只输出重构计划与风险，不直接改代码", "medium", false, [
        "corepack pnpm typecheck",
      ]),
      workflow("release-note", "基于已验证变更生成发布说明", "low", false, ["corepack pnpm check"]),
      workflow("review", "只读审查 diff、风险和验证证据", "low", false, ["corepack pnpm test"]),
      workflow(
        "solution-completeness-check",
        "先判断 single_issue/systemic_gap、影响面、P0/P1/P2、阶段边界和验证方式",
        "low",
        false,
        ["focused Solution Completeness Gate test"],
      ),
    ].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

function workflow(
  id: string,
  purpose: string,
  risk: WorkflowTemplate["risk"],
  writesFiles: boolean,
  recommendedValidation: string[],
): WorkflowTemplate {
  return {
    id,
    purpose,
    risk,
    writesFiles,
    recommendedValidation,
    steps: [
      "Start Gate：启动前先让用户确认范围。",
      "执行中任何写文件、Bash、联网或依赖安装仍走现有权限管道。",
      "结束前提示运行推荐验证，并输出修改文件、验证结果、已知限制和范围边界。",
    ],
  };
}

export async function createHookState(
  config: LinghunConfig,
  projectPath: string,
): Promise<HookState> {
  const hooks = await loadHookSummaries(config, projectPath);
  return {
    enabled: config.hooks.enabled,
    projectTrusted: config.hooks.projectTrusted,
    timeoutMs: config.hooks.timeoutMs,
    outputLimitBytes: config.hooks.outputLimitBytes,
    hooks,
    recentErrors: hooks.flatMap((hook) =>
      hook.lastError ? [`${hook.id}: ${hook.lastError}`] : [],
    ),
  };
}

export async function createPluginState(
  config: LinghunConfig,
  projectPath: string,
): Promise<PluginState> {
  const projectDir = resolveConfiguredDir(projectPath, config.plugins.projectDir);
  const userDir = resolveConfiguredDir(projectPath, config.plugins.userDir);
  try {
    const plugins = await loadPluginSummaries(config, projectDir, userDir);
    return {
      enabled: config.plugins.enabled,
      projectDir,
      userDir,
      plugins,
      disabledIds: [...config.plugins.disabledIds].sort((a, b) => a.localeCompare(b)),
      trustedIds: [...config.plugins.trustedIds].sort((a, b) => a.localeCompare(b)),
    };
  } catch (error) {
    return {
      enabled: config.plugins.enabled,
      projectDir,
      userDir,
      plugins: [],
      disabledIds: config.plugins.disabledIds,
      trustedIds: config.plugins.trustedIds,
      lastError: formatError(error),
    };
  }
}

async function loadSkillSummaries(
  config: LinghunConfig,
  projectDir: string,
  userDir: string,
): Promise<SkillSummary[]> {
  const loaded = await Promise.all([
    loadSkillDir(config, projectDir, "project"),
    loadSkillDir(config, userDir, "user"),
  ]);
  return loaded.flat().sort((a, b) => a.id.localeCompare(b.id));
}

async function loadSkillDir(
  config: LinghunConfig,
  directory: string,
  scope: ExtensionScope,
): Promise<SkillSummary[]> {
  const entries = await readJsonManifestFiles(directory);
  const items = await Promise.all(entries.map((path) => readSkillManifest(config, path, scope)));
  return items.filter((item): item is SkillSummary => item !== null);
}

async function readSkillManifest(
  config: LinghunConfig,
  path: string,
  scope: ExtensionScope,
): Promise<SkillSummary | null> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    const id = stableId(value.id, basename(path, extname(path)));
    const permissions = stringArray(value.permissions).sort((a, b) => a.localeCompare(b));
    const source = parseSource(value.source, scope);
    const trusted = source === "official" || config.skills.trustedIds.includes(id);
    const enabled = config.skills.enabled && !config.skills.disabledIds.includes(id) && trusted;
    return {
      id,
      name: stringValue(value.name, id),
      description: truncateDisplay(stringValue(value.description, "no description"), 240),
      triggers: stringArray(value.triggers).sort((a, b) => a.localeCompare(b)),
      summary: truncateDisplay(stringValue(value.summary, stringValue(value.description, "")), 600),
      source,
      scope,
      path,
      version: stringValue(value.version, "0.0.0"),
      enabled,
      trusted,
      permissions,
      mayWrite: permissions.includes("write"),
      mayExecute: permissions.includes("bash") || permissions.includes("execute"),
      mayNetwork: permissions.includes("network"),
      lifecycle: readLifecycleRecord(value, {
        path,
        source,
        trusted,
        enabled,
        permissions,
        hasSchema: true,
      }),
    };
  } catch (error) {
    return {
      id: basename(path, extname(path)),
      name: basename(path),
      description: "manifest load failed; skill isolated from main session",
      triggers: [],
      summary: "manifest load failed; skill isolated from prompt and tools",
      source: scope === "project" ? "third-party" : "local",
      scope,
      path,
      version: "unknown",
      enabled: false,
      trusted: false,
      permissions: [],
      mayWrite: false,
      mayExecute: false,
      mayNetwork: false,
      lifecycle: {
        localPath: path,
        trustLevel: "disabled",
        permissionSummary: "none",
        discovered: false,
        registered: false,
        schemaLoaded: false,
        runtimeVersion: "unknown",
      },
      lastError: formatError(error),
    };
  }
}

async function loadPluginSummaries(
  config: LinghunConfig,
  projectDir: string,
  userDir: string,
): Promise<PluginSummary[]> {
  const loaded = await Promise.all([
    loadPluginDir(config, projectDir, "project"),
    loadPluginDir(config, userDir, "user"),
  ]);
  return loaded.flat().sort((a, b) => a.id.localeCompare(b.id));
}

async function loadPluginDir(
  config: LinghunConfig,
  directory: string,
  scope: ExtensionScope,
): Promise<PluginSummary[]> {
  const entries = await readJsonManifestFiles(directory);
  const items = await Promise.all(entries.map((path) => readPluginManifest(config, path, scope)));
  return items.filter((item): item is PluginSummary => item !== null);
}

async function readPluginManifest(
  config: LinghunConfig,
  path: string,
  scope: ExtensionScope,
): Promise<PluginSummary | null> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    const id = stableId(value.id, basename(path, extname(path)));
    const permissions = stringArray(value.permissions).sort((a, b) => a.localeCompare(b));
    const source = parseSource(value.source, scope);
    const trusted = source === "official" || config.plugins.trustedIds.includes(id);
    const enabled = config.plugins.enabled && !config.plugins.disabledIds.includes(id) && trusted;
    const contributions = normalizeContributions(value.contributions);
    return {
      id,
      name: stringValue(value.name, id),
      version: stringValue(value.version, "0.0.0"),
      description: truncateDisplay(stringValue(value.description, "no description"), 240),
      source,
      scope,
      path,
      enabled,
      trusted,
      permissions,
      mayWrite: permissions.includes("write"),
      mayExecute: permissions.includes("bash") || permissions.includes("execute"),
      mayNetwork: permissions.includes("network"),
      lifecycle: readLifecycleRecord(value, {
        path,
        source,
        trusted,
        enabled,
        permissions,
        hasSchema: Object.values(contributions).some((items) => items.length > 0),
      }),
      contributions,
    };
  } catch (error) {
    return {
      id: basename(path, extname(path)),
      name: basename(path),
      version: "unknown",
      description: "manifest load failed; plugin isolated from main session",
      source: scope === "project" ? "third-party" : "local",
      scope,
      path,
      enabled: false,
      trusted: false,
      permissions: [],
      mayWrite: false,
      mayExecute: false,
      mayNetwork: false,
      lifecycle: {
        localPath: path,
        trustLevel: "disabled",
        permissionSummary: "none",
        discovered: false,
        registered: false,
        schemaLoaded: false,
        runtimeVersion: "unknown",
      },
      contributions: normalizeContributions(undefined),
      lastError: formatError(error),
    };
  }
}

async function loadHookSummaries(
  config: LinghunConfig,
  projectPath: string,
): Promise<HookSummary[]> {
  const pluginHooks = (await createPluginState(config, projectPath)).plugins.flatMap((plugin) =>
    plugin.contributions.hooks.map((event) => ({ plugin, event })),
  );
  return pluginHooks
    .map(({ plugin, event }) => ({
      id: `${plugin.id}:${event}`,
      event: parseHookEvent(event),
      source: plugin.source,
      scope: plugin.scope,
      path: plugin.path,
      enabled:
        config.hooks.enabled &&
        plugin.enabled &&
        plugin.trusted &&
        (plugin.scope !== "project" || config.hooks.projectTrusted),
      trusted: plugin.trusted && (plugin.scope !== "project" || config.hooks.projectTrusted),
      timeoutMs: config.hooks.timeoutMs,
      outputLimitBytes: config.hooks.outputLimitBytes,
      permissions: plugin.permissions,
      logPath: join(projectPath, ".linghun", "logs", "hooks", `${plugin.id}.log`),
      lastError: plugin.lastError,
    }))
    .sort((a, b) => `${a.event}:${a.id}`.localeCompare(`${b.event}:${b.id}`));
}

function parseHookEvent(value: string): HookSummary["event"] {
  const allowed: HookSummary["event"][] = [
    "Notification",
    "Plugin",
    "PostToolUse",
    "PreToolUse",
    "Stop",
    "Workflow",
  ];
  return allowed.includes(value as HookSummary["event"])
    ? (value as HookSummary["event"])
    : "Plugin";
}

async function readJsonManifestFiles(directory: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => join(directory, entry))
    .sort((a, b) => a.localeCompare(b));
}

function normalizeContributions(value: unknown): PluginSummary["contributions"] {
  const input = isRecord(value) ? value : {};
  return {
    commands: stringArray(input.commands).sort((a, b) => a.localeCompare(b)),
    hooks: stringArray(input.hooks).sort((a, b) => a.localeCompare(b)),
    mcpServers: stringArray(input.mcpServers).sort((a, b) => a.localeCompare(b)),
    providers: stringArray(input.providers).sort((a, b) => a.localeCompare(b)),
    skills: stringArray(input.skills).sort((a, b) => a.localeCompare(b)),
    workflows: stringArray(input.workflows).sort((a, b) => a.localeCompare(b)),
  };
}

function parseSource(value: unknown, scope: ExtensionScope): ExtensionSource {
  if (value === "official" || value === "third-party" || value === "local") {
    return value;
  }
  return scope === "project" ? "third-party" : "local";
}

export function stableId(value: unknown, fallback: string): string {
  return stringValue(value, fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-");
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function permissionSummary(permissions: string[]): string {
  if (permissions.length === 0) {
    return "none";
  }
  const risks = [
    permissions.includes("write") ? "write" : undefined,
    permissions.includes("bash") || permissions.includes("execute") ? "execute" : undefined,
    permissions.includes("network") ? "network" : undefined,
  ].filter((item): item is string => Boolean(item));
  return risks.length > 0 ? risks.join("+") : permissions.join("+");
}

function readLifecycleRecord(
  value: Record<string, unknown>,
  options: {
    path: string;
    source: ExtensionSource;
    trusted: boolean;
    enabled: boolean;
    permissions: string[];
    hasSchema: boolean;
  },
): ExtensionLifecycleRecord {
  const raw = isRecord(value.lifecycle) ? value.lifecycle : value;
  return {
    sourceUrl: typeof raw.sourceUrl === "string" ? raw.sourceUrl : undefined,
    localPath: typeof raw.localPath === "string" ? raw.localPath : options.path,
    ref: typeof raw.ref === "string" ? raw.ref : undefined,
    commit: typeof raw.commit === "string" ? raw.commit : undefined,
    installedAt: typeof raw.installedAt === "string" ? raw.installedAt : undefined,
    trustLevel: options.enabled ? "trusted" : options.trusted ? "disabled" : "untrusted",
    permissionSummary: permissionSummary(options.permissions),
    discovered: true,
    registered: true,
    schemaLoaded: options.hasSchema,
    runtimeVersion: "compatible",
  };
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// Leaf helpers originally scattered later in index.ts. They move here together
// with their primary callers so this module stays self-contained; index.ts
// re-exports them.

export function codebaseMemoryRequiredArgs(): Record<string, string[]> {
  return {
    list_projects: [],
    index_status: ["project"],
    detect_changes: ["project"],
    index_repository: ["repo_path"],
    search_code: ["project", "pattern"],
    get_architecture: ["project"],
    get_code_snippet: ["project", "qualified_name"],
    query_graph: ["project", "query"],
    trace_path: ["project", "from", "to"],
    search_graph: ["project", "query"],
  };
}

export function stabilizeMcpToolList(tools: McpToolState[]): McpToolState[] {
  return tools
    .map((tool) => ({
      server: tool.server,
      name: tool.name,
      description: truncateDisplay(tool.description.replace(/\s+/g, " "), 120),
      discovery: tool.discovery ?? "placeholder",
      trusted: tool.trusted ?? false,
      schemaLoaded: tool.schemaLoaded ?? false,
      runtimeVersion: tool.runtimeVersion ?? "unknown",
    }))
    .sort((a, b) => `${a.server}:${a.name}`.localeCompare(`${b.server}:${b.name}`));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
