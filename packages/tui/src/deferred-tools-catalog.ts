import type { McpServerConfig } from "@linghun/config";
import type { Language } from "@linghun/shared";
import type { TuiContext } from "./index.js";
import { truncateDisplay } from "./startup-runtime.js";
import type { McpToolState, PluginSummary, SkillSummary } from "./tui-data-types.js";
import { codebaseMemoryRequiredArgs } from "./tui-state-runtime.js";

// D.13J Block 3 — codebase-memory 工具 risk 分层。
// readonly = 只读查询，无 session 权限门槛；mutating = 可能写入索引/触发昂贵操作，
// 必须显式权限授予。order: whitelist → required-args → permission gate → spawn。
function codebaseMemoryRiskClass(): Record<string, "readonly" | "mutating"> {
  return {
    list_projects: "readonly",
    index_status: "readonly",
    search_code: "readonly",
    get_architecture: "readonly",
    get_code_snippet: "readonly",
    query_graph: "readonly",
    trace_path: "readonly",
    search_graph: "readonly",
    index_repository: "mutating",
    detect_changes: "mutating",
  };
}

export function getCodebaseMemoryToolRisk(tool: string): "readonly" | "mutating" | "unknown" {
  return codebaseMemoryRiskClass()[tool] ?? "unknown";
}

export function validateCodebaseMemoryToolExecution(
  tool: string,
  input: Record<string, unknown>,
): { ok: true } | { ok: false; summary: string } {
  const requiredArgs = codebaseMemoryRequiredArgs();
  if (!(tool in requiredArgs)) {
    return {
      ok: false,
      summary: `MCP deferred tool guard: ${tool} 尚未经过 discovery/schema/trust/runtime 登记，已拒绝执行。请先运行 /mcp doctor 或使用已发现且可信的工具入口。`,
    };
  }
  const missing = requiredArgs[tool]?.filter(
    (key) => input[key] === undefined || input[key] === null || input[key] === "",
  );
  if (missing && missing.length > 0) {
    return {
      ok: false,
      summary: `MCP deferred tool guard: ${tool} 缺少 required args：${missing.join(", ")}。已拒绝盲执行。`,
    };
  }
  const schemaProblem = validateCodebaseMemoryToolSchema(tool, input);
  if (schemaProblem) {
    return { ok: false, summary: schemaProblem };
  }
  return { ok: true };
}

function validateCodebaseMemoryToolSchema(
  tool: string,
  input: Record<string, unknown>,
): string | undefined {
  const stringArgs = new Set(["project", "projectName", "query", "path", "symbol", "from", "to", "repo_path"]);
  const booleanArgs = new Set(["force"]);
  const numberArgs = new Set(["limit", "max_depth"]);
  for (const [key, value] of Object.entries(input)) {
    if (stringArgs.has(key) && typeof value !== "string") {
      return `MCP deferred tool guard: ${tool}.${key} 必须是 string，已拒绝执行。`;
    }
    if (booleanArgs.has(key) && typeof value !== "boolean") {
      return `MCP deferred tool guard: ${tool}.${key} 必须是 boolean，已拒绝执行。`;
    }
    if (numberArgs.has(key) && typeof value !== "number") {
      return `MCP deferred tool guard: ${tool}.${key} 必须是 number，已拒绝执行。`;
    }
  }
  return undefined;
}

// ===========================================================================
// D.13I — Self-built deferred tools dispatch
// ---------------------------------------------------------------------------
// SearchExtraTools / ExecuteExtraTool 是 Linghun 自研的 deferred 调用层。模型必须
// 先调用 SearchExtraTools 获得 executable=true 的工具，再用 ExecuteExtraTool 调用。
// 不发 Anthropic defer_loading / tool_reference / anthropic-beta；不新建 runner；
// 仍走既有 permission / tool_result / evidence / continuation 链路。
// 执行分层：
//   - codebase-memory：白名单 10 个工具，复用 runCodebaseMemoryCli + validateCodebaseMemoryToolExecution
//   - MCP server tools：仅 schemaLoaded+trusted+server.enabled 时 discoverable；本阶段
//     不接通用 MCP 调用 adapter，所以 executable=false
//   - skills：discover trusted manifest，autoExecute=no，executable=false
//   - plugins：discover trusted manifest contribution，autoExecute=no，executable=false
// ===========================================================================

export type DeferredToolKind = "codebase-memory" | "mcp" | "skill" | "plugin";

export type DeferredToolDescriptor = {
  name: string;
  kind: DeferredToolKind;
  description: string;
  requiredArgs: string[];
  executable: boolean;
  reason: string;
};

export type DeferredToolDiscoverySnapshot = {
  generatedAt: string;
  total: number;
  byKind: Record<DeferredToolKind, number>;
  executableCount: number;
  tools: DeferredToolDescriptor[];
};

const CODEBASE_MEMORY_DESCRIPTIONS: Record<string, string> = {
  list_projects: "List indexed projects in codebase-memory.",
  index_status: "Get current index status (nodes/edges/status) for a project.",
  detect_changes: "Detect uncovered file changes for a project's index.",
  index_repository: "Build or refresh the codebase-memory index for a repo path.",
  search_code: "Pattern search across an indexed project.",
  get_architecture: "Project architecture summary (modules, entry points).",
  get_code_snippet: "Read a code snippet by qualified name in an indexed project.",
  query_graph: "Run a graph query (CALLS / IMPORTS) on an indexed project.",
  trace_path: "Trace a function call chain from -> to in an indexed project.",
  search_graph: "Find similar implementations / SIMILAR_TO entries in a project.",
};

function listCodebaseMemoryDeferredTools(): DeferredToolDescriptor[] {
  const required = codebaseMemoryRequiredArgs();
  return Object.keys(required)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({
      name,
      kind: "codebase-memory" as const,
      description: CODEBASE_MEMORY_DESCRIPTIONS[name] ?? `codebase-memory tool: ${name}`,
      requiredArgs: [...required[name]],
      executable: true,
      reason: "codebase-memory static whitelist; required args validated before execution.",
    }));
}

function listMcpDeferredTools(context: TuiContext): DeferredToolDescriptor[] {
  if (!context.mcp.enabled) return [];
  const enabledServers = new Set(
    context.mcp.servers
      .filter((server) => server.status !== "disabled" && server.status !== "missing")
      .map((server) => server.name),
  );
  return context.mcp.tools
    .filter((tool) => enabledServers.has(tool.server))
    .filter((tool) => tool.discovery === "discovered")
    .filter((tool) => tool.schemaLoaded === true)
    .filter((tool) => tool.trusted === true)
    .map((tool) => {
      // D.13J Block 4 — local stdio MCP runtime adapter.
      // Server is executable iff它在 config 里且有 command（即本地 stdio 启动方式）。
      // 远程/HTTP MCP 仍保持 executable=false：这是 D.13J Block 4 的明确范围边界。
      const serverConfig = context.config.mcp.servers[tool.server];
      const localStdio = isLocalStdioMcpServer(serverConfig);
      const sse = serverConfig?.transport === "sse" && typeof serverConfig.url === "string" && serverConfig.url.trim();
      return {
        name: `mcp:${tool.server}:${tool.name}`,
        kind: "mcp" as const,
        // truncate is already enforced by stabilizeMcpToolList; do not echo raw schema
        description: tool.description || `MCP tool ${tool.server}:${tool.name}`,
        requiredArgs: [],
        executable: Boolean(localStdio || sse),
        reason: localStdio
          ? "MCP server tool discovered (local stdio); JSON-RPC tools/call adapter available. Mutating use needs session permission."
          : sse
            ? "MCP server tool discovered (SSE/HTTP endpoint); JSON-RPC tools/list and tools/call adapter available. Mutating use needs session permission."
            : "MCP server tool discovered with schema and trusted, but server is not local stdio or SSE.",
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// D.13J Block 4 — local stdio identification. command 必须是非空字符串；若 command 缺失
// 表示 server 仅以远程 HTTP 形式注册（不在本 Block 范围）。
export function isLocalStdioMcpServer(server: McpServerConfig | undefined): boolean {
  if (!server) return false;
  if (server.disabled === true) return false;
  if (typeof server.command !== "string") return false;
  if (server.command.trim() === "") return false;
  return true;
}

function listSkillDeferredTools(context: TuiContext): DeferredToolDescriptor[] {
  if (!context.skills.enabled) return [];
  const disabled = new Set(context.skills.disabledIds);
  const trusted = new Set(context.skills.trustedIds);
  return context.skills.skills
    .filter((skill) => !disabled.has(skill.id))
    .filter((skill) => trusted.has(skill.id))
    .map((skill) => ({
      name: `skill:${skill.id}`,
      kind: "skill" as const,
      description: truncateDisplay(
        (skill.description ?? skill.name ?? skill.id).replace(/\s+/g, " "),
        160,
      ),
      requiredArgs: [],
      executable: false,
      reason: skillManifestHasContribution(skill)
        ? "Skill manifest contributes commands/tools (enabled+trusted), but Linghun has no safe Skill executor adapter yet; review manifest manually or run /skills status."
        : "Skill manifest is metadata-only (no command/tool contribution); not executable. Run /skills status for details.",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// D.13J Block 5 — manifest 事实裁决：根据 manifest 字段区分"贡献了 command/tool"
// 与"纯 metadata"。仅读取已加载的 manifest 字段，不执行 postinstall/hook。
// SkillSummary 上没有显式 commands 字段，但 triggers 是 skill 的命令/工具触发入口；
// 同时兼容 manifest 上可能存在的 commands/tools 数组（通过 raw 字段读取）。
function skillManifestHasContribution(skill: SkillSummary): boolean {
  const triggers = skill.triggers ?? [];
  if (Array.isArray(triggers) && triggers.length > 0) return true;
  const raw = skill as unknown as { commands?: unknown; tools?: unknown };
  if (Array.isArray(raw.commands) && raw.commands.length > 0) return true;
  if (Array.isArray(raw.tools) && raw.tools.length > 0) return true;
  return false;
}

function listPluginDeferredTools(context: TuiContext): DeferredToolDescriptor[] {
  if (!context.plugins.enabled) return [];
  const disabled = new Set(context.plugins.disabledIds);
  const trusted = new Set(context.plugins.trustedIds);
  return context.plugins.plugins
    .filter((plugin) => !disabled.has(plugin.id))
    .filter((plugin) => trusted.has(plugin.id))
    .map((plugin) => ({
      name: `plugin:${plugin.id}`,
      kind: "plugin" as const,
      description: truncateDisplay(
        (plugin.description ?? plugin.name ?? plugin.id).replace(/\s+/g, " "),
        160,
      ),
      requiredArgs: [],
      executable: false,
      reason: pluginManifestHasContribution(plugin)
        ? "Plugin manifest contributes commands/tools (enabled+trusted), but Linghun has no safe Plugin executor adapter yet; review contributions manually or run /plugins doctor."
        : "Plugin manifest is metadata-only (no command/tool contribution); not executable. Run /plugins doctor for details.",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function pluginManifestHasContribution(plugin: PluginSummary): boolean {
  const c = plugin.contributions;
  if (!c) return false;
  return (
    (c.commands?.length ?? 0) > 0 ||
    (c.mcpServers?.length ?? 0) > 0 ||
    (c.providers?.length ?? 0) > 0 ||
    (c.hooks?.length ?? 0) > 0 ||
    (c.workflows?.length ?? 0) > 0 ||
    (c.skills?.length ?? 0) > 0
  );
}

export function listDeferredTools(context: TuiContext): DeferredToolDescriptor[] {
  return [
    ...listCodebaseMemoryDeferredTools(),
    ...listMcpDeferredTools(context),
    ...listSkillDeferredTools(context),
    ...listPluginDeferredTools(context),
  ];
}

export function snapshotDeferredTools(context: TuiContext): DeferredToolDiscoverySnapshot {
  const tools = listDeferredTools(context);
  const byKind: Record<DeferredToolKind, number> = {
    "codebase-memory": 0,
    mcp: 0,
    skill: 0,
    plugin: 0,
  };
  let executableCount = 0;
  for (const tool of tools) {
    byKind[tool.kind] += 1;
    if (tool.executable) executableCount += 1;
  }
  return {
    generatedAt: new Date().toISOString(),
    total: tools.length,
    byKind,
    executableCount,
    tools,
  };
}

// D.13I：仅用于 doctor 的非泄漏摘要——不含 raw schema/secret/参数，只输出 total/byKind/executableCount。
export function snapshotDeferredToolsSummary(context: TuiContext): {
  total: number;
  byKind: Record<DeferredToolKind, number>;
  executableCount: number;
} {
  const snapshot = snapshotDeferredTools(context);
  return {
    total: snapshot.total,
    byKind: snapshot.byKind,
    executableCount: snapshot.executableCount,
  };
}

// D.13J Block 2：D.13I session-scoped discovered Set 的 doctor 摘要。
// `executeSearchExtraTools` 把匹配上的 deferred 工具名写入 `context.discoveredDeferredToolNames`，
// `executeExtraTool` 必须先看 Set 才放行。出于排查 ExecuteExtraTool 拒绝的需要，doctor 必须能看见
// 当前 session "已发现"了哪些工具。但只能输出"经过 sanitize 的工具名 + 数量"——
// 不能输出 raw 参数、不能透出 secret，因为发现集合里有可能包含将来引入的非 codebase-memory 工具名。
//
// sanitize 规则：
//   - 仅保留字母/数字/下划线/冒号/连字符/点号；其他字符替换为 "_"
//   - 长度上限 80；超长直接截断（避免日志爆炸）
//   - 总数上限 32；超过则按字典序保留前 32 项 + 一个 "+N more" 提示位
export type DiscoveredDeferredToolsSummary = {
  total: number;
  names: string[];
  truncated: boolean;
};

const DISCOVERED_NAME_MAX_LEN = 80;
const DISCOVERED_NAMES_MAX_COUNT = 32;

export function sanitizeDiscoveredDeferredToolName(name: string): string {
  // 仅保留 A-Za-z0-9_:.- ；其他都替换为 "_"，避免在 doctor 输出里出现奇怪字符。
  const cleaned = name.replace(/[^A-Za-z0-9_:.\-]/g, "_");
  if (cleaned.length <= DISCOVERED_NAME_MAX_LEN) return cleaned;
  return `${cleaned.slice(0, DISCOVERED_NAME_MAX_LEN)}…`;
}

export function snapshotDiscoveredDeferredToolsSummary(
  context: TuiContext,
): DiscoveredDeferredToolsSummary {
  const sorted = Array.from(context.discoveredDeferredToolNames).sort();
  const sanitized = sorted.map(sanitizeDiscoveredDeferredToolName);
  if (sanitized.length <= DISCOVERED_NAMES_MAX_COUNT) {
    return { total: sanitized.length, names: sanitized, truncated: false };
  }
  return {
    total: sanitized.length,
    names: sanitized.slice(0, DISCOVERED_NAMES_MAX_COUNT),
    truncated: true,
  };
}

export function searchDeferredTools(
  query: string,
  tools: DeferredToolDescriptor[],
): DeferredToolDescriptor[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed === "") return tools;
  return tools.filter((tool) => {
    const haystack = `${tool.name} ${tool.description} ${tool.kind}`.toLowerCase();
    return haystack.includes(trimmed);
  });
}

export function findDeferredTool(
  toolName: string,
  tools: DeferredToolDescriptor[],
): DeferredToolDescriptor | undefined {
  return tools.find((tool) => tool.name === toolName);
}

// stableHash 输入：仅暴露 name/kind/executable/requiredArgs；不进 raw schema/secret。
export function deferredToolListHashInput(tools: DeferredToolDescriptor[]): unknown {
  return tools
    .map((tool) => ({
      name: tool.name,
      kind: tool.kind,
      executable: tool.executable,
      requiredArgs: [...tool.requiredArgs].sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// 仅当 deferred 列表非空时给出 system reminder。core tools 仍直接调用，不进 ExecuteExtraTool。
export function formatDeferredToolsSystemReminder(
  language: Language,
  snapshot: DeferredToolDiscoverySnapshot,
): string | undefined {
  if (snapshot.total === 0) return undefined;
  return language === "en-US"
    ? "Additional tools must be discovered via SearchExtraTools, then invoked via ExecuteExtraTool. Built-in tools (Read/Edit/Write/Bash/Grep/Glob/Todo) are still called directly."
    : "Additional tools must be discovered via SearchExtraTools, then invoked via ExecuteExtraTool.";
}

export function isCodebaseMemoryToolName(name: string): boolean {
  return name in codebaseMemoryRequiredArgs();
}

export function summarizeDeferredToolMatch(tool: DeferredToolDescriptor): Record<string, unknown> {
  return {
    name: tool.name,
    kind: tool.kind,
    description: tool.description,
    requiredArgs: tool.requiredArgs,
    executable: tool.executable,
    reason: tool.reason,
  };
}

// D.13J Block 4 — `mcp:<server>:<tool>` 名称解析。server 不能含冒号，tool 名允许出现冒号
// 以兼容 `server.tool` 形态（如 `codebase-memory.list_projects` 或 `srv:tool:sub`）。
export function parseMcpDeferredToolName(
  name: string,
): { server: string; tool: string } | undefined {
  if (!name.startsWith("mcp:")) return undefined;
  const rest = name.slice(4);
  const idx = rest.indexOf(":");
  if (idx <= 0) return undefined;
  const server = rest.slice(0, idx);
  const tool = rest.slice(idx + 1);
  if (server.trim() === "" || tool.trim() === "") return undefined;
  return { server, tool };
}
