import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import type { Writable } from "node:stream";
import {
  type McpServerConfig,
  removeMcpServerConfig,
  resolveStoragePaths,
  saveMcpServerConfig,
} from "@linghun/config";
import type { CacheFreshness } from "@linghun/core";
import { diffFreshness } from "./cache-freshness.js";
import { showCommandPanel } from "./command-panel-runtime.js";
import {
  findDeferredTool,
  getCodebaseMemoryToolRisk,
  isCodebaseMemoryToolName,
  isLocalStdioMcpServer,
  listDeferredTools,
  parseMcpDeferredToolName,
  searchDeferredTools,
  summarizeDeferredToolMatch,
  validateCodebaseMemoryToolExecution,
} from "./deferred-tools-catalog.js";
import {
  createIndexTransientExcludes,
  formatIndexAutoSkipDetails,
  formatIndexAutoSkipNextAction,
  formatIndexAutoSkipPrimary,
  scanIndexSafety,
  summarizeIndexResult,
} from "./index-result-presenter.js";
import {
  type CodebaseMemoryBinarySource,
  type CodebaseMemoryBinaryStatus,
  findCurrentIndexProject,
} from "./index-runtime.js";
import type { TuiContext } from "./index.js";
import {
  buildIndexStatusPanel,
  buildMcpStatusPanel,
  formatIndexRefreshSummary,
  formatIndexStatus,
  formatMcpStatus,
} from "./mcp-index-command-runtime.js";
import {
  isPotentiallyMutatingMcpTool,
  runMcpStdioToolCall,
  runMcpStdioToolList,
} from "./mcp-stdio-runtime.js";
import { redactedPath, runCommandCapture } from "./process-command-runtime.js";
import { formatMcpTools } from "./remote-mcp-presenter.js";
import {
  formatError,
  sanitizeDiagnosticText,
  truncateDisplay,
  writeLine,
} from "./startup-runtime.js";
import type { BackgroundTaskState, EvidenceRecord, McpToolState } from "./tui-data-types.js";
import { writeDiagnosticLine } from "./tui-output-surface.js";
import { createMcpState, createMcpToolPlaceholders, pathExists } from "./tui-state-runtime.js";

const CODEBASE_MEMORY_COMMAND = "codebase-memory-mcp";
const CODEBASE_MEMORY_ENV = "LINGHUN_CODEBASE_MEMORY_MCP";

export type CodebaseMemoryResolution = {
  command: string;
  args: string[];
  source: CodebaseMemoryBinarySource;
  status: CodebaseMemoryBinaryStatus;
  version?: string;
  detailPath?: string;
  summary: string;
};

export type ExecuteExtraToolResult =
  | { ok: true; text: string; data?: unknown }
  | { ok: false; text: string };

export type McpIndexRuntimeDeps = {
  getCurrentFreshness: (context: TuiContext) => CacheFreshness;
  writeStatus: (output: Writable, context: TuiContext) => void;
  checkBackgroundStartGuard: (
    context: TuiContext,
    kind: BackgroundTaskState["kind"],
    heavy?: boolean,
    ignoreTaskId?: string,
  ) => string | null;
  ensureSession: (context: TuiContext) => Promise<string>;
  rememberBackgroundTask: (context: TuiContext, task: BackgroundTaskState) => void;
  appendBackgroundTaskEvent: (
    context: TuiContext,
    sessionId: string,
    task: BackgroundTaskState,
  ) => Promise<void>;
  rememberEvidence: (context: TuiContext, evidence: EvidenceRecord) => void;
};

let runtimeDeps: McpIndexRuntimeDeps | undefined;

export function configureMcpIndexRuntime(deps: McpIndexRuntimeDeps): void {
  runtimeDeps = deps;
}

function deps(): McpIndexRuntimeDeps {
  if (!runtimeDeps) {
    throw new Error("mcp-index-runtime deps not configured");
  }
  return runtimeDeps;
}

function refreshCacheFreshness(context: TuiContext): void {
  const freshness = deps().getCurrentFreshness(context);
  context.cache.lastFreshness = {
    ...freshness,
    changedKeys: diffFreshness(context.cache.lastFreshness, freshness),
  };
}

export async function handleMcpCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0] ?? "status";
  if (action === "status") {
    // D.13Q-UX Task Surface — /mcp status 默认走 CommandPanel（降噪），
    // 内部细节（guard / license / runtime / binary / source / schemaLoaded）
    // 进 detailsText 由 Ctrl+O 展开。plain TUI 走旧 writeDiagnosticLine 兼容。
    showCommandPanel(context, output, buildMcpStatusPanel(context));
    return;
  }
  if (action === "tools") {
    context.mcp.tools = stabilizeMcpToolList(context.mcp.tools);
    refreshCacheFreshness(context);
    writeDiagnosticLine(output, formatMcpTools(context.mcp));
    return;
  }
  if (action === "doctor") {
    await runMcpDoctor(context);
    // D.14D-E — /mcp doctor 走降噪 CommandPanel：完整诊断（含 guard / license /
    // runtime / endpoint）进 detailsText（Ctrl+O 展开），非 ink 仍写完整正文。
    const isEn = context.language === "en-US";
    showCommandPanel(context, output, {
      title: "/mcp doctor",
      tone: "neutral",
      summary: [
        isEn ? "MCP doctor — Ctrl+O for full diagnostics." : "MCP 诊断 — Ctrl+O 查看完整诊断。",
      ],
      detailsText: formatMcpStatus(context),
    });
    return;
  }
  if (action === "validate") {
    // D.14D-E — /mcp validate 走降噪 CommandPanel：完整校验结果进 detailsText。
    const isEn = context.language === "en-US";
    showCommandPanel(context, output, {
      title: "/mcp validate",
      tone: "neutral",
      summary: [isEn ? "MCP validate — Ctrl+O for details." : "MCP 校验 — Ctrl+O 查看详情。"],
      detailsText: validateMcpServers(context, args[1]),
    });
    return;
  }
  if (action === "add" || action === "install") {
    const result = await addMcpServer(args.slice(1), context);
    writeLine(output, result);
    return;
  }
  if (action === "enable" || action === "disable") {
    const id = args[1];
    writeLine(
      output,
      id
        ? await setMcpServerEnabled(id, action === "enable", context)
        : `用法：/mcp ${action} <server-id>`,
    );
    return;
  }
  if (action === "remove") {
    const id = args[1];
    writeLine(output, id ? await removeMcpServer(id, context) : "用法：/mcp remove <server-id>");
    return;
  }
  if (action === "update") {
    writeLine(output, await updateMcpServer(args.slice(1), context));
    return;
  }
  writeLine(
    output,
    "用法：/mcp | /mcp status | /mcp tools | /mcp doctor | /mcp validate [id] | /mcp add local <id> <command> [args...] | /mcp update <id> local <command> [args...] | /mcp enable|disable <id> | /mcp remove <id>",
  );
}

export async function handleIndexCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0] ?? "status";
  if (action === "status") {
    await refreshIndexStatus(context, args.includes("--fresh"));
    // D.13Q-UX Task Surface — /index status 默认走 CommandPanel 降噪。
    showCommandPanel(context, output, buildIndexStatusPanel(context));
    if (!context.isInkSession) deps().writeStatus(output, context);
    return;
  }
  if (action === "doctor") {
    await refreshIndexStatus(context, true);
    // D.14D-E — /index doctor 走降噪 CommandPanel：完整状态进 detailsText。
    showCommandPanel(context, output, buildIndexStatusPanel(context));
    if (!context.isInkSession) deps().writeStatus(output, context);
    return;
  }
  if (action === "check") {
    await refreshIndexStatus(context, true);
    // D.14D-E — /index check 走降噪 CommandPanel：完整状态进 detailsText。
    showCommandPanel(context, output, buildIndexStatusPanel(context));
    if (!context.isInkSession) deps().writeStatus(output, context);
    return;
  }
  if (action === "init" && args[1] === "fast") {
    const guard = deps().checkBackgroundStartGuard(context, "index", true);
    if (guard) {
      writeLine(output, guard);
      return;
    }
    await runIndexRepository(context, "fast", "init fast", args.includes("--force"), output);
    if (context.index.status === "ready") {
      if (!context.index.safetyWarning) {
        writeLine(output, formatIndexRefreshSummary(context, "init fast"));
      }
    }
    if (!context.isInkSession) deps().writeStatus(output, context);
    return;
  }
  if (action === "refresh") {
    const guard = deps().checkBackgroundStartGuard(context, "index", true);
    if (guard) {
      writeLine(output, guard);
      return;
    }
    await runIndexRepository(
      context,
      context.config.index.mode,
      "refresh",
      args.includes("--force"),
      output,
    );
    if (context.index.status === "ready") {
      if (!context.index.safetyWarning) {
        writeLine(output, formatIndexRefreshSummary(context, "refresh"));
      }
    }
    if (!context.isInkSession) deps().writeStatus(output, context);
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
    // D.14D-E — /index search 短摘要走降噪 CommandPanel；进度/错误不走面板。
    showCommandPanel(context, output, {
      title: "/index search",
      tone: "neutral",
      summary: [
        context.language === "en-US"
          ? "Index search result — Ctrl+O for details."
          : "索引搜索结果 — Ctrl+O 查看详情。",
      ],
      detailsText: result.summary,
    });
    deps().writeStatus(output, context);
    return;
  }
  if (action === "architecture") {
    const result = await runIndexQuery(context, "get_architecture", {});
    await recordIndexEvidence(context, "architecture", result.summary);
    // D.14D-E — /index architecture 短摘要走降噪 CommandPanel。
    showCommandPanel(context, output, {
      title: "/index architecture",
      tone: "neutral",
      summary: [
        context.language === "en-US"
          ? "Index architecture summary — Ctrl+O for details."
          : "索引架构摘要 — Ctrl+O 查看详情。",
      ],
      detailsText: result.summary,
    });
    deps().writeStatus(output, context);
    return;
  }
  writeLine(
    output,
    "用法：/index status [--fresh] | /index doctor | /index check | /index search <query> | /index architecture（只读） | /index init fast | /index refresh（需确认）",
  );
}

export async function resolveCodebaseMemoryBinary(
  context: TuiContext,
): Promise<CodebaseMemoryResolution> {
  const configured = context.config.mcp.servers["codebase-memory"];
  const configuredCommand = configured?.command?.trim();
  const configuredArgs = configured?.args ?? [];
  const envCommand = process.env[CODEBASE_MEMORY_ENV]?.trim();
  if (envCommand) {
    const spec = await codebaseMemoryCommandSpec(envCommand, []);
    return probeCodebaseMemoryBinary(spec.command, spec.args, "env", context, spec.detailPath);
  }
  if (configuredCommand && configuredCommand !== CODEBASE_MEMORY_COMMAND) {
    const spec = await codebaseMemoryCommandSpec(configuredCommand, configuredArgs);
    return probeCodebaseMemoryBinary(spec.command, spec.args, "env", context, spec.detailPath);
  }

  const managed = await findManagedCodebaseMemoryBinary(context);
  if (managed) {
    return probeCodebaseMemoryBinary(
      managed.command,
      managed.args,
      "managed",
      context,
      managed.detailPath,
    );
  }

  const pathBinary = await findPathCodebaseMemoryBinary();
  if (pathBinary) {
    return probeCodebaseMemoryBinary(
      pathBinary.command,
      pathBinary.args,
      "path",
      context,
      pathBinary.detailPath,
    );
  }

  const pathProbe = await probeCodebaseMemoryBinary(CODEBASE_MEMORY_COMMAND, [], "path", context);
  if (pathProbe.status === "missing") {
    return { ...pathProbe, source: "missing" };
  }
  return pathProbe;
}

export async function codebaseMemoryCommandSpec(
  command: string,
  args: string[],
): Promise<{ command: string; args: string[]; detailPath: string }> {
  const lowerCommand = command.toLowerCase();
  if (lowerCommand.endsWith(".cjs")) {
    return { command: process.execPath, args: [command, ...args], detailPath: command };
  }
  if (
    process.platform === "win32" &&
    (lowerCommand.endsWith(".cmd") || lowerCommand.endsWith(".bat"))
  ) {
    const script = await resolveWindowsShimNodeScript(command);
    if (script) {
      return {
        command: process.execPath,
        args: [script, ...args],
        detailPath: command,
      };
    }
    return {
      command: "cmd.exe",
      args: ["/d", "/c", "call", command, ...args],
      detailPath: command,
    };
  }
  if (process.platform === "win32" && lowerCommand.endsWith(".ps1")) {
    const script = await resolveWindowsShimNodeScript(command);
    if (script) {
      return {
        command: process.execPath,
        args: [script, ...args],
        detailPath: command,
      };
    }
    return {
      command: "powershell.exe",
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", command, ...args],
      detailPath: command,
    };
  }
  return { command, args, detailPath: command };
}

async function resolveWindowsShimNodeScript(command: string): Promise<string | undefined> {
  let content: string;
  try {
    content = await readFile(command, "utf8");
  } catch {
    return undefined;
  }
  const dir = dirname(command);
  const patterns = [
    /(?:node\.exe|node)["']?\s+"([^"]+\.(?:cjs|mjs|js))"/iu,
    /(?:node\.exe|node)["']?\s+'([^']+\.(?:cjs|mjs|js))'/iu,
    /(?:node\.exe|node)["']?\s+([^\s"'`]+\.(?:cjs|mjs|js))/iu,
  ];
  for (const pattern of patterns) {
    const raw = pattern.exec(content)?.[1];
    if (!raw) continue;
    return resolveShimTarget(dir, raw);
  }
  const ps1Match = /(?:&\s*)?\$basedir[\\/ ]*["']?([^"'\r\n]+?\.(?:cjs|mjs|js))["']?/iu.exec(
    content,
  )?.[1];
  return ps1Match ? resolveShimTarget(dir, ps1Match) : undefined;
}

function resolveShimTarget(dir: string, rawTarget: string): string {
  const expanded = rawTarget
    .replace(/%~dp0/giu, dir.endsWith("\\") || dir.endsWith("/") ? dir : `${dir}\\`)
    .replace(/\$basedir/giu, dir);
  return resolve(dir, expanded.replace(/^["']|["']$/g, ""));
}

export async function findManagedCodebaseMemoryBinary(
  context: TuiContext,
): Promise<{ command: string; args: string[]; detailPath: string } | undefined> {
  const paths = resolveStoragePaths(context.config, context.projectPath);
  const candidates = [
    join(context.projectPath, ".linghun", "bin", CODEBASE_MEMORY_COMMAND),
    join(paths.index, "bin", CODEBASE_MEMORY_COMMAND),
    join(paths.userData, "bin", CODEBASE_MEMORY_COMMAND),
  ];
  return findCodebaseMemoryBinaryCandidate(candidates);
}

export async function findPathCodebaseMemoryBinary(): Promise<
  { command: string; args: string[]; detailPath: string } | undefined
> {
  const pathDirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const candidates = pathDirs.map((dir) => join(dir, CODEBASE_MEMORY_COMMAND));
  return findCodebaseMemoryBinaryCandidate(candidates);
}

export async function findCodebaseMemoryBinaryCandidate(
  candidates: string[],
): Promise<{ command: string; args: string[]; detailPath: string } | undefined> {
  const suffixes =
    process.platform === "win32" ? [".cmd", ".exe", ".ps1", ".cjs", ""] : [".cjs", ""];
  for (const candidate of candidates) {
    for (const suffix of suffixes) {
      const path = `${candidate}${suffix}`;
      if (!(await pathExists(path))) {
        continue;
      }
      return await codebaseMemoryCommandSpec(path, []);
    }
  }
  return undefined;
}

export async function probeCodebaseMemoryBinary(
  command: string,
  args: string[],
  source: Exclude<CodebaseMemoryBinarySource, "missing">,
  context: TuiContext,
  detailPath = command,
): Promise<CodebaseMemoryResolution> {
  const result = await runCommandCapture(
    command,
    [...args, "--version"],
    context.projectPath,
    5_000,
  );
  if (result.errorCode === "ENOENT") {
    return {
      command,
      args,
      source,
      status: "missing",
      detailPath,
      summary: "codebase-memory binary not found",
    };
  }
  if (result.exitCode !== 0) {
    return {
      command,
      args,
      source,
      status: "corrupt",
      detailPath,
      summary: `codebase-memory --version failed: ${result.summary}`,
    };
  }
  const version = extractCodebaseMemoryVersion(result.stdout || result.stderr);
  if (!version) {
    return {
      command,
      args,
      source,
      status: "unsupported",
      detailPath,
      summary: "codebase-memory --version did not return a supported version string",
    };
  }
  return {
    command,
    args,
    source,
    status: "ready",
    version,
    detailPath,
    summary: "codebase-memory binary ready",
  };
}

export function extractCodebaseMemoryVersion(output: string): string | undefined {
  const compact = output.replace(/\s+/g, " ").trim();
  const version = compact.match(/\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/)?.[0];
  if (!version) {
    return undefined;
  }
  return version;
}

export function rememberCodebaseMemoryResolution(
  context: TuiContext,
  resolution: CodebaseMemoryResolution,
): void {
  context.index.binarySource = resolution.source;
  context.index.binaryStatus = resolution.status;
  context.index.binaryVersion = resolution.version;
  context.index.binaryCommand = redactedPath(resolution.detailPath);
  context.index.runtime =
    resolution.source === "managed"
      ? "Linghun-managed codebase-memory"
      : resolution.source === "path"
        ? "external fallback from PATH"
        : resolution.source === "env"
          ? "explicit codebase-memory override"
          : "missing codebase-memory runtime";
}

export async function getCodebaseMemoryResolution(
  context: TuiContext,
): Promise<CodebaseMemoryResolution> {
  const resolution = await resolveCodebaseMemoryBinary(context);
  rememberCodebaseMemoryResolution(context, resolution);
  return resolution;
}

export async function runMcpDoctor(context: TuiContext): Promise<void> {
  for (const server of context.mcp.servers) {
    if (server.status === "disabled") {
      continue;
    }
    if (server.name !== "codebase-memory") {
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
      continue;
    }
    const resolution = await getCodebaseMemoryResolution(context);
    server.command = redactedPath(resolution.detailPath);
    server.status =
      resolution.status === "ready"
        ? "configured"
        : resolution.status === "missing"
          ? "missing"
          : "error";
    server.error = resolution.status === "ready" ? undefined : resolution.summary;
  }
  context.mcp.lastDoctor = new Date().toISOString();
  // D.13J tail fix（Block A）：local stdio MCP server 走真实 tools/list 把 server 公布的工具
  // 翻译为 mcp.tools；非 local stdio（无 command / disabled / 远程）保留旧 placeholder 行为。
  // 仅把 server 真实公布的工具名进入 mcp.tools；description / inputSchema 不进入缓存
  // （由 stabilizeMcpToolList 截断 description 防 raw schema 泄露）。
  // tools/list 失败时 fall back 到 placeholder 命名以保留可见性，但 schemaLoaded=false 让
  // listMcpDeferredTools 认定为不可执行（discovery !== "discovered"），从而拒绝 ExecuteExtraTool。
  const discoveredTools: McpToolState[] = [];
  for (const server of context.mcp.servers) {
    if (server.status !== "configured") continue;
    if (server.name === "codebase-memory") {
      discoveredTools.push(...createMcpToolPlaceholders(server.name, "discovered"));
      continue;
    }
    const serverConfig = context.config.mcp.servers[server.name];
    if (!isLocalStdioMcpServer(serverConfig)) {
      // 非 local stdio：保留 placeholder 行为，executable 由 listMcpDeferredTools 在渲染时再裁决。
      discoveredTools.push(...createMcpToolPlaceholders(server.name, "discovered"));
      continue;
    }
    const listResult = await runMcpStdioToolList(
      serverConfig as McpServerConfig,
      context.projectPath,
    );
    if (listResult.ok && listResult.toolNames.length > 0) {
      for (const toolName of listResult.toolNames) {
        discoveredTools.push({
          server: server.name,
          name: toolName,
          description: `MCP tool ${server.name}:${toolName}`,
          discovery: "discovered",
          trusted: true,
          schemaLoaded: true,
          runtimeVersion: "compatible",
        });
      }
    } else {
      // tools/list 失败：暴露 server 仍可被 doctor 看见（status / error），但 deferred 入口
      // 不会标 schemaLoaded=true，因此 listMcpDeferredTools 自然过滤掉。
      discoveredTools.push({
        server: server.name,
        name: `${server.name}.status`,
        description: `MCP server tools/list failed: ${truncateDisplay(listResult.summary, 80)}`,
        discovery: "placeholder",
        trusted: false,
        schemaLoaded: false,
        runtimeVersion: "unknown",
      });
    }
  }
  context.mcp.tools = stabilizeMcpToolList(discoveredTools);
  refreshCacheFreshness(context);
}

export function validateMcpServers(context: TuiContext, id?: string): string {
  const servers = id
    ? context.mcp.servers.filter((server) => server.name === id)
    : context.mcp.servers;
  if (servers.length === 0) {
    return id ? `未找到 MCP server：${id}` : "没有 MCP server 配置。";
  }
  return [
    "MCP validate",
    ...servers.map((server) => {
      const config = context.config.mcp.servers[server.name];
      const problems = [];
      if (!config) problems.push("not registered");
      if (server.status === "disabled") problems.push("disabled");
      if (server.status === "missing") problems.push("missing binary");
      if (server.status === "error") problems.push("doctor error");
      if (config?.trustLevel === "untrusted") problems.push("untrusted");
      return `- ${server.name}: ${problems.length === 0 ? "ok" : problems.join("; ")} source=${config?.sourceUrl ? sanitizeDiagnosticText(config.sourceUrl) : redactedPath(config?.localPath ?? config?.command)} ref=${config?.ref ?? "-"} commit=${config?.commit ?? "-"} permissions=${config?.permissionSummary ?? "tool-discovery"} next=${problems.length === 0 ? "tools/status available" : "run /mcp doctor, then validate/enable after fixing"}`;
    }),
  ].join("\n");
}

export async function addMcpServer(args: string[], context: TuiContext): Promise<string> {
  const [source, id, command, ...commandArgs] = args;
  if (source !== "local" || !id || !command) {
    return [
      "MCP add（Connect Lite）",
      "- usage: /mcp add local <server-id> <command> [args...]",
      "- 本阶段 MCP 只支持本地 command 注册；Git/GitHub install 只用于 skills/plugins。",
      "- add 只写来源/权限记录，不执行 server；运行 /mcp doctor 才做受控 --version 诊断。",
    ].join("\n");
  }
  const server: McpServerConfig = {
    command,
    args: commandArgs,
    localPath: command,
    scope: "project",
    installedAt: new Date().toISOString(),
    disabled: true,
    trustLevel: "untrusted",
    permissionSummary: "tool-discovery",
  };
  context.config = await saveMcpServerConfig(id, server, false, context.projectPath);
  context.mcp = createMcpState(context.config);
  refreshCacheFreshness(context);
  return `已添加 MCP server：${id}；默认 untrusted/disabled，未执行 server。下一步运行 /mcp validate ${id} 或 /mcp doctor；确认信任后再运行 /mcp enable ${id}。`;
}

export async function setMcpServerEnabled(
  id: string,
  enabled: boolean,
  context: TuiContext,
): Promise<string> {
  const current = context.config.mcp.servers[id];
  if (!current) {
    return `未找到 MCP server：${id}`;
  }
  const nextTrustLevel = enabled ? "trusted" : "disabled";
  context.config = await saveMcpServerConfig(
    id,
    { ...current, disabled: !enabled, trustLevel: nextTrustLevel },
    enabled,
    context.projectPath,
  );
  context.mcp = createMcpState(context.config);
  refreshCacheFreshness(context);
  const trustNotice = enabled
    ? "Trust notice：即将启用本地 MCP server；Linghun 不会在 enable 时执行 server，但后续 tools/call 仍必须经过 discovery/schema/required-args 和权限管道。"
    : "";
  return [
    trustNotice,
    `${enabled ? "已启用" : "已禁用"} MCP server：${id}；失败可通过 /mcp doctor 隔离诊断。`,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function updateMcpServer(args: string[], context: TuiContext): Promise<string> {
  const [id, source, command, ...commandArgs] = args;
  const current = id ? context.config.mcp.servers[id] : undefined;
  if (!id || source !== "local" || !command) {
    return "用法：/mcp update <server-id> local <command> [args...]；Connect Lite 不执行 server，只更新 metadata。";
  }
  if (!current) {
    return `未找到 MCP server：${id}`;
  }
  const server: McpServerConfig = {
    ...current,
    command,
    args: commandArgs,
    localPath: command,
    installedAt: new Date().toISOString(),
    disabled: current.disabled ?? !context.config.mcp.enabledServers.includes(id),
    trustLevel: current.trustLevel ?? (current.disabled ? "disabled" : "untrusted"),
    permissionSummary: current.permissionSummary ?? "tool-discovery",
  };
  context.config = await saveMcpServerConfig(id, server, !server.disabled, context.projectPath);
  context.mcp = createMcpState(context.config);
  refreshCacheFreshness(context);
  return `已更新 MCP server：${id}；只更新本地 command metadata，未执行 server。下一步运行 /mcp validate ${id} 或 /mcp doctor。`;
}

export async function removeMcpServer(id: string, context: TuiContext): Promise<string> {
  if (!context.config.mcp.servers[id]) {
    return `未找到 MCP server：${id}`;
  }
  context.config = await removeMcpServerConfig(id, context.projectPath);
  context.mcp = createMcpState(context.config);
  refreshCacheFreshness(context);
  return `已移除 MCP server：${id}；已有普通聊天和本地工具不受影响。`;
}

export async function refreshIndexStatus(context: TuiContext, fresh = false): Promise<void> {
  const resolution = await getCodebaseMemoryResolution(context);
  if (resolution.status !== "ready") {
    context.index.status = "missing";
    context.index.artifactStatus = "unknown";
    context.index.error = `${resolution.summary}。普通聊天不受影响；如需索引，请配置 ${CODEBASE_MEMORY_ENV} 或安装 Linghun-managed codebase-memory。`;
    context.index.projectName = undefined;
    context.index.projectSelectionSource = "missing";
    context.index.safetyRiskyFiles = undefined;
    context.index.safetyAction = undefined;
    return;
  }

  const projects = await runCodebaseMemoryCli(context, "list_projects", {}, context.projectPath);
  if (!projects.ok) {
    context.index.status = projects.errorCode === "ENOENT" ? "missing" : "error";
    context.index.artifactStatus = projects.errorCode === "ENOENT" ? "missing" : "corrupt";
    context.index.error = projects.summary;
    context.index.projectName = undefined;
    context.index.projectSelectionSource = "missing";
    context.index.safetyRiskyFiles = undefined;
    context.index.safetyAction = undefined;
    return;
  }
  const project = findCurrentIndexProject(projects.data, context.projectPath);
  if (!project) {
    context.index.status = "missing";
    context.index.artifactStatus = "missing";
    context.index.artifactPath = undefined;
    context.index.projectName = undefined;
    context.index.projectSelectionSource = "missing";
    context.index.error = "未找到当前项目索引。请运行 /index init fast 建立索引。";
    context.index.safetyRiskyFiles = undefined;
    context.index.safetyAction = undefined;
    return;
  }
  context.index.projectName = project.name;
  context.index.artifactPath = project.rootPath;
  context.index.projectSelectionSource = project.source;
  const status = await runCodebaseMemoryCli(
    context,
    "index_status",
    { project: project.name },
    context.projectPath,
  );
  if (!status.ok) {
    context.index.status = "error";
    context.index.artifactStatus = "corrupt";
    context.index.error = status.summary;
    context.index.safetyRiskyFiles = undefined;
    context.index.safetyAction = undefined;
    return;
  }
  const data = status.data as { status?: string; nodes?: number; edges?: number };
  context.index.status = data.status === "ready" ? "ready" : "stale";
  context.index.artifactStatus = data.status === "ready" ? "ready" : "stale";
  context.index.nodes = data.nodes;
  context.index.edges = data.edges;
  context.index.error = undefined;
  context.index.changedFiles = undefined;
  context.index.staleHint = fresh
    ? undefined
    : "fast status：未运行 detect_changes；需要新鲜度检查请用 /index status --fresh 或 /index check。";
  context.index.safetyWarning = undefined;
  context.index.safetyRiskyFiles = undefined;
  context.index.safetyAction = undefined;
  if (fresh) {
    await refreshIndexStaleHint(context, project.name);
  }
}

export async function refreshIndexStaleHint(
  context: TuiContext,
  projectName: string,
): Promise<void> {
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
    context.index.artifactStatus = "stale";
    context.index.staleHint = `detect_changes 发现 ${changedCount} 个变更文件，建议运行 /index refresh；不会自动刷新。`;
    return;
  }
  context.index.staleHint = "detect_changes 未发现变更；/index refresh 仍只在用户显式执行时运行。";
}

export async function runIndexRepository(
  context: TuiContext,
  mode: "fast" | "moderate" | "full",
  actionLabel: "init fast" | "refresh",
  force: boolean,
  output: Writable,
): Promise<void> {
  const safety = await scanIndexSafety(context.projectPath);
  const transientExcludes =
    !force && safety.riskyFiles.length > 0 ? createIndexTransientExcludes(safety) : [];
  context.index.safetyWarning = undefined;
  context.index.safetyRiskyFiles = safety.riskyFiles.length > 0 ? safety.riskyFiles : undefined;
  context.index.safetyAction = safety.riskyFiles.length > 0 ? actionLabel : undefined;
  context.index.error = undefined;
  context.index.status = "indexing";
  if (transientExcludes.length > 0) {
    await recordIndexEvidence(
      context,
      `auto-skip:${actionLabel}`,
      formatIndexAutoSkipDetails(safety, actionLabel, context.language),
      transientExcludes.map((file) => `skipped_file:${file}`),
    );
  }
  const now = new Date().toISOString();
  const task: BackgroundTaskState = {
    id: `index-${randomUUID().slice(0, 8)}`,
    kind: "index",
    title: `Index ${actionLabel}`,
    status: "running",
    currentStep: "index_repository",
    progress: { completed: 0, total: 1, label: "index" },
    startedAt: now,
    updatedAt: now,
    heartbeatIntervalMs: 30_000,
    staleAfterMs: 120_000,
    hasOutput: false,
    userVisibleSummary: `索引${actionLabel === "refresh" ? "刷新" : "初始化"}正在执行。`,
    nextAction: "等待完成，或用 /interrupt 标记取消后检查 /index status。",
  };
  const sessionId = await deps().ensureSession(context);
  deps().rememberBackgroundTask(context, task);
  await deps().appendBackgroundTaskEvent(context, sessionId, task);
  const result = await runCodebaseMemoryCli(
    context,
    "index_repository",
    {
      repo_path: context.projectPath,
      mode,
      persistence: true,
      ...(transientExcludes.length > 0
        ? {
            transient_exclude_paths: transientExcludes,
            skip_paths: transientExcludes,
          }
        : {}),
    },
    context.projectPath,
    120_000,
  );
  const endedAt = new Date().toISOString();
  task.updatedAt = endedAt;
  task.lastOutputAt = endedAt;
  task.hasOutput = Boolean(result.ok || result.summary);
  if (!result.ok) {
    context.index.status = result.errorCode === "ENOENT" ? "missing" : "error";
    context.index.error = `${result.summary}。请确认索引运行时可用，修复后重试。`;
    task.status = result.summary.includes("命令超时") ? "timeout" : "failed";
    task.result = task.status === "timeout" ? "timeout" : "fail";
    task.currentStep = task.status === "timeout" ? "timeout" : "index failed";
    task.progress = { completed: 1, total: 1, label: "index" };
    task.userVisibleSummary = `Index ${task.status}: ${context.index.error}`;
    task.nextAction = "查看 /index status，修复 runtime/artifact 后重试；不得声称索引刷新成功。";
    await deps().appendBackgroundTaskEvent(context, sessionId, task);
    writeLine(output, `Index: ${context.index.status}. ${context.index.error}`);
    return;
  }
  await refreshIndexStatus(context);
  // P1-2 — index_repository 已成功（result.ok）。若紧随的 refreshIndexStatus 因
  // list_projects/index_status 读回延迟未能确认 ready/stale（回落到 missing/
  // unknown/error），footer 不能显示 `索引?` 这种"从没建过"的假信号。这里把它
  // 升级成一个可解释的成熟状态：索引刚刷新过、新鲜度待确认（stale + staleHint）。
  const statusAfterRefresh: string = context.index.status;
  if (
    statusAfterRefresh === "missing" ||
    statusAfterRefresh === "unknown" ||
    statusAfterRefresh === "error"
  ) {
    context.index.status = "stale";
    context.index.artifactStatus = "stale";
    context.index.indexedAt = new Date().toISOString();
    context.index.error = undefined;
    context.index.staleHint =
      context.language === "en-US"
        ? "Index just refreshed; status read-back is pending. Run /index status to confirm."
        : "索引已刷新，状态待确认。运行 /index status 可确认。";
  } else {
    context.index.indexedAt = new Date().toISOString();
  }
  task.status = "completed";
  task.result = "pass";
  task.currentStep = "index finished";
  task.progress = { completed: 1, total: 1, label: "index" };
  task.userVisibleSummary = `Index ${actionLabel} completed: ${context.index.status}`;
  task.nextAction = "用 /index status 查看详情；需要新鲜度检查时用 /index status --fresh。";
  await deps().appendBackgroundTaskEvent(context, sessionId, task);
  if (transientExcludes.length > 0) {
    context.index.safetyWarning = formatIndexAutoSkipPrimary(
      safety,
      context.index.status,
      actionLabel,
      context.language,
    );
    context.index.safetyRiskyFiles = safety.riskyFiles;
    context.index.safetyAction = actionLabel;
    await recordIndexEvidence(
      context,
      `auto-skip-result:${actionLabel}`,
      formatIndexAutoSkipDetails(safety, actionLabel, context.language),
      transientExcludes.map((file) => `skipped_file:${file}`),
    );
    const nextAction = formatIndexAutoSkipNextAction(context.language);
    const panelTitle =
      context.language === "en-US"
        ? actionLabel === "refresh"
          ? "Index refreshed"
          : "Index initialized"
        : actionLabel === "refresh"
          ? "索引刷新"
          : "索引初始化";
    showCommandPanel(context, output, {
      title: panelTitle,
      tone: context.index.status === "stale" ? "warning" : "neutral",
      summary: [context.index.safetyWarning],
      actions: [nextAction],
      detailsText: formatIndexAutoSkipDetails(safety, actionLabel, context.language),
    });
  }
}

export async function runIndexQuery(
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

export async function recordIndexEvidence(
  context: TuiContext,
  query: string,
  summary: string,
  supportsClaims: string[] = [],
): Promise<void> {
  const sessionId = await deps().ensureSession(context);
  const evidence: EvidenceRecord = {
    id: randomUUID(),
    kind: "index_query",
    summary: truncateDisplay(summary.replace(/\s+/g, " "), 160),
    source: `codebase-memory:${context.index.projectName ?? "unknown"}:${query}`,
    supportsClaims: ["index_query", query, ...supportsClaims],
    createdAt: new Date().toISOString(),
  };
  deps().rememberEvidence(context, evidence);
  await context.store.appendEvent(sessionId, { type: "evidence_record", ...evidence });
}

export async function runCodebaseMemoryCli(
  context: TuiContext,
  tool: string,
  input: Record<string, unknown>,
  cwd: string,
  timeoutMs = 30_000,
): Promise<{ ok: true; data: unknown } | { ok: false; summary: string; errorCode?: string }> {
  const guard = validateCodebaseMemoryToolExecution(tool, input);
  if (!guard.ok) {
    return { ok: false, summary: guard.summary };
  }
  const resolution = await getCodebaseMemoryResolution(context);
  if (resolution.status !== "ready") {
    return { ok: false, summary: resolution.summary, errorCode: resolution.status };
  }
  const result = await runCommandCapture(
    resolution.command,
    [...resolution.args, "cli", tool, JSON.stringify(input)],
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

export function executeSearchExtraTools(
  query: string,
  context: TuiContext,
): {
  ok: boolean;
  text: string;
  data: { matches: ReturnType<typeof summarizeDeferredToolMatch>[]; total: number };
} {
  const all = listDeferredTools(context);
  const filtered = searchDeferredTools(query, all);
  // D.13I tail fix — 仅把"匹配上的"工具名记入本 session 已发现集合。
  // ExecuteExtraTool 需要这个证据来证明模型确实通过 SearchExtraTools 发现过该工具。
  for (const tool of filtered) {
    context.discoveredDeferredToolNames.add(tool.name);
  }
  return {
    ok: true,
    text: `SearchExtraTools matched ${filtered.length}/${all.length} deferred tools (query=${JSON.stringify(query)}).`,
    data: { matches: filtered.map(summarizeDeferredToolMatch), total: filtered.length },
  };
}

export async function executeExtraTool(
  args: { tool_name: unknown; params?: unknown },
  context: TuiContext,
): Promise<ExecuteExtraToolResult> {
  if (typeof args.tool_name !== "string" || args.tool_name.trim() === "") {
    return {
      ok: false,
      text: "ExecuteExtraTool: tool_name 缺失或为空，请先运行 SearchExtraTools 找到目标工具。",
    };
  }
  // D.13I tail fix — gating: 必须先看本 session 的"已发现"集合。
  // listDeferredTools 等价于"白名单存在"，不能等同于"模型已通过 SearchExtraTools 发现过"。
  // Set 命中 → 才允许进入白名单/适配器/必填参数检查。
  if (!context.discoveredDeferredToolNames.has(args.tool_name)) {
    return {
      ok: false,
      text: `ExecuteExtraTool: 工具 ${args.tool_name} 未在本 session 通过 SearchExtraTools 发现过。请先运行 SearchExtraTools 发现该工具。`,
    };
  }
  const all = listDeferredTools(context);
  const target = findDeferredTool(args.tool_name, all);
  if (!target) {
    return {
      ok: false,
      text: `ExecuteExtraTool: 工具 ${args.tool_name} 已被本 session 记为发现过，但已不在当前可用 deferred 工具清单中（白名单或会话状态可能已变化）。请重新运行 SearchExtraTools。`,
    };
  }
  if (!target.executable) {
    return {
      ok: false,
      text: `ExecuteExtraTool: 工具 ${target.name} (${target.kind}) 已发现但当前没有安全执行适配器：${target.reason}`,
    };
  }
  const params = (
    args.params && typeof args.params === "object" && !Array.isArray(args.params) ? args.params : {}
  ) as Record<string, unknown>;
  if (target.kind === "codebase-memory") {
    if (!isCodebaseMemoryToolName(target.name)) {
      return {
        ok: false,
        text: `ExecuteExtraTool: ${target.name} 未通过 codebase-memory 白名单。`,
      };
    }
    const guard = validateCodebaseMemoryToolExecution(target.name, params);
    if (!guard.ok) {
      return { ok: false, text: guard.summary };
    }
    // D.13J Block 3 — mutating 工具需要 session 权限授予。order: whitelist
    // (Set + listDeferredTools) → required-args → permission gate → spawn。
    const risk = getCodebaseMemoryToolRisk(target.name);
    if (risk === "mutating" && !context.codebaseMemoryMutatingGranted) {
      return {
        ok: false,
        text: `ExecuteExtraTool: codebase-memory 工具 ${target.name} 是写操作（mutating），不通过本入口执行。要刷新/重建索引，请直接调用结构化工具 IndexRefresh（或 IndexRepair），它会走 Linghun 受控权限确认路径；也可使用 /index refresh 命令。`,
      };
    }
    const cliResult = await runCodebaseMemoryCli(context, target.name, params, context.projectPath);
    if (!cliResult.ok) {
      return {
        ok: false,
        text: `ExecuteExtraTool(codebase-memory:${target.name}) 失败：${cliResult.summary}${cliResult.errorCode ? ` [${cliResult.errorCode}]` : ""}`,
      };
    }
    return {
      ok: true,
      text: `ExecuteExtraTool(codebase-memory:${target.name}) 完成。`,
      data: cliResult.data,
    };
  }
  // 防御：MCP/skill/plugin 已在上面被 executable=false 拦截，理论上不会到这里。
  if (target.kind === "mcp") {
    // D.13J Block 4 — local stdio MCP runtime adapter.
    // mcp:<server>:<tool> 形态：从 target.name 解析出 server 和 tool name。
    // server 必须存在于 context.config.mcp.servers 且为 local stdio；同时 mutating
    // 工具默认拒绝（沿用 codebase-memory 的 mutating gate 思路）。
    const parsed = parseMcpDeferredToolName(target.name);
    if (!parsed) {
      return {
        ok: false,
        text: `ExecuteExtraTool: 无法解析 MCP 工具名 ${target.name}，期望格式 mcp:<server>:<tool>。`,
      };
    }
    const serverConfig = context.config.mcp.servers[parsed.server];
    if (!isLocalStdioMcpServer(serverConfig)) {
      return {
        ok: false,
        text: `ExecuteExtraTool: MCP server ${parsed.server} 不是本地 stdio（缺少 command 或已禁用），当前没有远程 MCP 传输适配器。`,
      };
    }
    if (!context.mcpStdioMutatingGranted && isPotentiallyMutatingMcpTool(parsed.tool)) {
      return {
        ok: false,
        text: `ExecuteExtraTool: MCP 工具 ${target.name} 看起来是写操作（write/delete/update/index/create 类），不通过本入口执行。若是 codebase-memory 索引写入，请改用结构化工具 IndexRefresh / IndexRepair（走 Linghun 受控权限确认）或 /index refresh；否则请在 server 自身或 .linghun/settings.json 中关闭对应写工具。`,
      };
    }
    const stdio = await runMcpStdioToolCall(
      serverConfig as McpServerConfig,
      parsed.tool,
      params,
      context.projectPath,
    );
    if (!stdio.ok) {
      return {
        ok: false,
        text: `ExecuteExtraTool(${target.name}) 失败：${stdio.summary}${stdio.errorCode ? ` [${stdio.errorCode}]` : ""}`,
      };
    }
    return {
      ok: true,
      text: `ExecuteExtraTool(${target.name}) 完成。`,
      data: stdio.data,
    };
  }
  return {
    ok: false,
    text: `ExecuteExtraTool: 工具 ${target.name} (${target.kind}) 没有可用的安全执行适配器。`,
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
