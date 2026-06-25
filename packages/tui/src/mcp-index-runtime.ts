import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import type { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  type McpServerConfig,
  removeMcpServerConfig,
  resolveStoragePaths,
  saveMcpServerConfig,
} from "@linghun/config";
import type { CacheFreshness } from "@linghun/core";
import { TOGGLE_DETAILS_KEYBIND } from "@linghun/shared";
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
  readLocalIndexArtifactState,
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
import { runMcpSseToolCall } from "./mcp-sse-runtime.js";
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
const CLI_BUNDLED_ROOT_ENV = "LINGHUN_CLI_BUNDLED_ROOT";
const CODEBASE_MEMORY_BUNDLED_ENV = "LINGHUN_CODEBASE_MEMORY_BUNDLED_DIR";
const PRE_ENGINE_BUNDLED_ENV = "LINGHUN_PRE_ENGINE_BUNDLED_DIR";
const CODEBASE_MEMORY_BUNDLED_PLATFORM_ARCHES = new Set([
  "win32-x64",
  "linux-x64",
  "darwin-arm64",
  "darwin-x64",
]);

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
        isEn
          ? `MCP doctor — ${TOGGLE_DETAILS_KEYBIND} for full diagnostics.`
          : `MCP 诊断 — ${TOGGLE_DETAILS_KEYBIND} 查看完整诊断。`,
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
      summary: [
        isEn
          ? `MCP validate — ${TOGGLE_DETAILS_KEYBIND} for details.`
          : `MCP 校验 — ${TOGGLE_DETAILS_KEYBIND} 查看详情。`,
      ],
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
    await runIndexRepository(context, "fast", "init fast", args.includes("--force"), output, {
      guardAlreadyChecked: true,
    });
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
      { guardAlreadyChecked: true },
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
    // P2.4 fix: search_code 在 codebase-memory 0.6.1 中存在路径解析问题，始终返回 0 结果。
    // 优先使用 search_graph（语义符号搜索），它在所有测试场景下都能正常工作。
    const result = await runIndexQuery(context, "search_graph", { query, limit: 5 });
    await recordIndexEvidence(context, `search ${query}`, result.summary);
    // D.14D-E — /index search 短摘要走降噪 CommandPanel；进度/错误不走面板。
    showCommandPanel(context, output, {
      title: "/index search",
      tone:
        result.summary.includes("no matches") &&
        context.index.nodes !== undefined &&
        context.index.nodes > 0
          ? "warning"
          : "neutral",
      summary: [
        context.language === "en-US"
          ? `Index search result — ${TOGGLE_DETAILS_KEYBIND} for details.`
          : `索引搜索结果 — ${TOGGLE_DETAILS_KEYBIND} 查看详情。`,
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
          ? `Index architecture summary — ${TOGGLE_DETAILS_KEYBIND} for details.`
          : `索引架构摘要 — ${TOGGLE_DETAILS_KEYBIND} 查看详情。`,
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

  const bundled = await findBundledCodebaseMemoryBinary();
  if (bundled) {
    return probeCodebaseMemoryBinary(
      bundled.command,
      bundled.args,
      "bundled",
      context,
      bundled.detailPath,
    );
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

export async function findBundledCodebaseMemoryBinary(): Promise<
  { command: string; args: string[]; detailPath: string } | undefined
> {
  const roots = getBundledCodebaseMemoryRoots();
  const platformArch = getCodebaseMemoryPlatformArch();
  if (!CODEBASE_MEMORY_BUNDLED_PLATFORM_ARCHES.has(platformArch)) {
    return undefined;
  }
  const names = platformArch.startsWith("win32")
    ? [`${CODEBASE_MEMORY_COMMAND}.exe`, `${CODEBASE_MEMORY_COMMAND}.cjs`]
    : [CODEBASE_MEMORY_COMMAND, `${CODEBASE_MEMORY_COMMAND}.cjs`];
  for (const root of roots) {
    for (const name of names) {
      const candidate = join(root, platformArch, name);
      if (await pathExists(candidate)) {
        return codebaseMemoryCommandSpec(candidate, []);
      }
    }
  }
  return undefined;
}

export function getBundledCodebaseMemoryRoots(): string[] {
  const roots: string[] = [];
  if (process.env[CODEBASE_MEMORY_BUNDLED_ENV]) {
    roots.push(process.env[CODEBASE_MEMORY_BUNDLED_ENV]);
  }
  if (process.env[CLI_BUNDLED_ROOT_ENV]) {
    roots.push(join(process.env[CLI_BUNDLED_ROOT_ENV], "codebase-memory"));
  }
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  roots.push(join(moduleDir, "..", "bundled", "codebase-memory"));
  roots.push(join(moduleDir, "bundled", "codebase-memory"));
  return roots;
}

export function getCodebaseMemoryPlatformArch(): string {
  const override = process.env.LINGHUN_CODEBASE_MEMORY_PLATFORM_ARCH_TEST;
  if (override && CODEBASE_MEMORY_BUNDLED_PLATFORM_ARCHES.has(override)) {
    return override;
  }
  return `${process.platform}-${process.arch}`;
}

const PRE_ENGINE_COMMAND = "linghun-pre-engine";

class PreEngineDaemon {
  private proc: ReturnType<typeof spawn> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private msgId = 1;

  constructor(
    private readonly binary: string,
    private readonly cwd: string,
  ) {}

  call(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ ok: boolean; summary: string; errorCode?: string; data?: unknown }> {
    return new Promise((resolve, reject) => {
      this.queue = this.queue
        .then(() => this._doCall(toolName, args).then(resolve, reject))
        .catch(() => {});
    });
  }

  private _ensureProc(): Promise<ReturnType<typeof spawn>> {
    if (this.proc) return Promise.resolve(this.proc);
    const proc = spawn(this.binary, [], { cwd: this.cwd, stdio: ["pipe", "pipe", "pipe"] });
    this.proc = proc;
    proc.on("exit", () => { if (this.proc === proc) this.proc = null; });
    return new Promise((resolve) => {
      let buf = "";
      const onData = (chunk: Buffer | string) => {
        buf += chunk.toString();
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.id === 0) {
              proc.stdout!.off("data", onData);
              proc.stdin!.write(
                JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n",
              );
              resolve(proc);
            }
          } catch {}
        }
      };
      proc.stdout!.on("data", onData);
      proc.stdin!.write(
        JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: { rootUri: this.cwd } }) + "\n",
      );
    });
  }

  private _doCall(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ ok: boolean; summary: string; data?: unknown }> {
    this._resetIdle();
    return this._ensureProc().then(
      (proc) =>
        new Promise((resolve) => {
          const id = this.msgId++;
          let buf = "";
          const cleanup = () => {
            proc.stdout!.off("data", onData);
            proc.off("exit", onExit);
          };
          const onExit = () => {
            cleanup();
            resolve({ ok: false, summary: "pre-engine process exited unexpectedly" });
          };
          const onData = (chunk: Buffer | string) => {
            buf += chunk.toString();
            const lines = buf.split("\n");
            buf = lines.pop() ?? "";
            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const msg = JSON.parse(line);
                if (msg.id === id) {
                  cleanup();
                  if (msg.error) {
                    resolve({ ok: false, summary: msg.error.message ?? String(msg.error) });
                  } else {
                    const content = msg.result?.content;
                    const text = Array.isArray(content)
                      ? content.map((c: { text?: string }) => c.text ?? "").join("")
                      : "";
                    resolve({ ok: true, summary: text, data: msg.result });
                  }
                }
              } catch {}
            }
          };
          proc.stdout!.on("data", onData);
          proc.on("exit", onExit);
          proc.stdin!.write(
            JSON.stringify({
              jsonrpc: "2.0",
              id,
              method: "tools/call",
              params: { name: toolName, arguments: args },
            }) + "\n",
          );
        }),
    );
  }

  private _resetIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.proc?.kill();
      this.proc = null;
    }, 30_000);
  }
}

const _preEngineDaemons = new Map<string, PreEngineDaemon>();

function getOrCreatePreEngineDaemon(binary: string, cwd: string): PreEngineDaemon {
  const key = `${binary}\0${cwd}`;
  let d = _preEngineDaemons.get(key);
  if (!d) {
    d = new PreEngineDaemon(binary, cwd);
    _preEngineDaemons.set(key, d);
  }
  return d;
}

export async function resolvePreEngineBinary(): Promise<string | undefined> {
  const platformArch = `${process.platform}-${process.arch}`;
  const fileName = platformArch.startsWith("win32")
    ? `${PRE_ENGINE_COMMAND}.exe`
    : PRE_ENGINE_COMMAND;
  const roots: string[] = [];
  if (process.env[PRE_ENGINE_BUNDLED_ENV]) {
    roots.push(process.env[PRE_ENGINE_BUNDLED_ENV]);
  }
  if (process.env[CLI_BUNDLED_ROOT_ENV]) {
    roots.push(join(process.env[CLI_BUNDLED_ROOT_ENV], "pre-engine"));
  }
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  roots.push(join(moduleDir, "..", "bundled", "pre-engine"));
  roots.push(join(moduleDir, "bundled", "pre-engine"));
  for (const root of roots) {
    const candidate = join(root, platformArch, fileName);
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  const pathDirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const dir of pathDirs) {
    const candidate = join(dir, fileName);
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  return undefined;
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
    resolution.source === "bundled"
      ? "bundled codebase-memory"
      : resolution.source === "managed"
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
      return `- ${server.name}: ${problems.length === 0 ? "ok" : problems.join("; ")}; source ${config?.sourceUrl ? sanitizeDiagnosticText(config.sourceUrl) : redactedPath(config?.localPath ?? config?.command)}; ref ${config?.ref ?? "-"}; commit ${config?.commit ?? "-"}; permissions ${config?.permissionSummary ?? "tool-discovery"}; next ${problems.length === 0 ? "tools/status available" : "run /mcp doctor, then validate/enable after fixing"}`;
    }),
  ].join("\n");
}

export async function addMcpServer(args: string[], context: TuiContext): Promise<string> {
  const [source, id, command, ...commandArgs] = args;
  if (source === "sse" && id && command) {
    const server: McpServerConfig = {
      command: "",
      url: command,
      transport: "sse",
      sourceUrl: command,
      scope: "project",
      installedAt: new Date().toISOString(),
      disabled: true,
      trustLevel: "untrusted",
      permissionSummary: "tool-discovery",
    };
    context.config = await saveMcpServerConfig(id, server, false, context.projectPath);
    context.mcp = createMcpState(context.config);
    refreshCacheFreshness(context);
    return `已添加 MCP SSE server：${id}；默认 untrusted/disabled，未连接远程 endpoint。下一步运行 /mcp validate ${id}；确认信任后再运行 /mcp enable ${id}。`;
  }
  if (source !== "local" || !id || !command) {
    return [
      "MCP add（Connect Lite）",
      "- usage: /mcp add local <server-id> <command> [args...]",
      "- usage: /mcp add sse <server-id> <url>",
      "- 本阶段 MCP 支持本地 command 与 SSE endpoint metadata；Git/GitHub install 只用于 skills/plugins。",
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
  if (!id || (source !== "local" && source !== "sse") || !command) {
    return "用法：/mcp update <server-id> local <command> [args...] 或 /mcp update <server-id> sse <url>；Connect Lite 不执行 server，只更新 metadata。";
  }
  if (!current) {
    return `未找到 MCP server：${id}`;
  }
  if (source === "sse") {
    const server: McpServerConfig = {
      ...current,
      command: "",
      args: [],
      url: command,
      transport: "sse",
      sourceUrl: command,
      installedAt: new Date().toISOString(),
      disabled: current.disabled ?? !context.config.mcp.enabledServers.includes(id),
      trustLevel: current.trustLevel ?? (current.disabled ? "disabled" : "untrusted"),
      permissionSummary: current.permissionSummary ?? "tool-discovery",
    };
    context.config = await saveMcpServerConfig(id, server, !server.disabled, context.projectPath);
    context.mcp = createMcpState(context.config);
    refreshCacheFreshness(context);
    return `已更新 MCP SSE server：${id}；只更新 endpoint metadata，未连接远程 server。下一步运行 /mcp validate ${id} 或 /mcp doctor。`;
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
  if (!context.index.enabled) {
    context.index.status = "disabled";
    context.index.artifactStatus = "disabled";
    context.index.error = "codebase index is disabled in settings.";
    context.index.projectName = undefined;
    context.index.projectSelectionSource = "missing";
    context.index.safetyRiskyFiles = undefined;
    context.index.safetyAction = undefined;
    return;
  }

  await refreshLocalIndexArtifactState(context);
  const resolution = await getCodebaseMemoryResolution(context);
  if (resolution.status !== "ready") {
    context.index.status =
      context.index.artifactStatus === "ready"
        ? "unknown-project"
        : context.index.artifactStatus === "corrupt"
          ? "error"
          : "missing";
    const artifactError = context.index.error;
    context.index.artifactStatus = context.index.artifactStatus ?? "unknown";
    context.index.error = `${resolution.summary}。普通聊天不受影响；如需索引，请配置 ${CODEBASE_MEMORY_ENV} 或安装 Linghun-managed codebase-memory。`;
    if (context.index.status === "error" && artifactError) {
      context.index.error = artifactError;
    }
    if (context.index.status === "missing") context.index.projectName = undefined;
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
    await refreshLocalIndexArtifactState(context);
    context.index.status =
      context.index.artifactStatus === "ready"
        ? "unknown-project"
        : context.index.artifactStatus === "corrupt"
          ? "error"
          : "missing";
    context.index.artifactStatus =
      context.index.artifactStatus === "ready" || context.index.artifactStatus === "corrupt"
        ? context.index.artifactStatus
        : "missing";
    context.index.projectSelectionSource = "missing";
    context.index.error =
      context.index.status === "error"
        ? (context.index.error ?? "本地 codebase-memory artifact 损坏。")
        : context.index.status === "unknown-project"
        ? "检测到本地 .codebase-memory/graph.db.zst，但 codebase-memory list_projects 未能匹配当前项目。请运行 /index status --fresh 或 /index refresh 重新绑定项目。"
        : "未找到当前项目索引。请运行 /index init fast 建立索引。";
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

export async function refreshLocalIndexArtifactState(context: TuiContext): Promise<void> {
  const artifact = await readLocalIndexArtifactState(context.projectPath);
  context.index.artifactStatus = artifact.status === "ready" ? "ready" : artifact.status;
  context.index.artifactPath = artifact.artifactPath;
  if (artifact.status === "ready") {
    context.index.projectName = context.index.projectName ?? artifact.projectName;
    context.index.nodes = context.index.nodes ?? artifact.nodes;
    context.index.edges = context.index.edges ?? artifact.edges;
    context.index.indexedAt = context.index.indexedAt ?? artifact.indexedAt;
    return;
  }
  if (artifact.status === "corrupt") {
    context.index.error = artifact.error;
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
  options: { guardAlreadyChecked?: boolean } = {},
): Promise<void> {
  if (!options.guardAlreadyChecked) {
    const guard = deps().checkBackgroundStartGuard(context, "index", true);
    if (guard) {
      context.index.status = "error";
      context.index.error = guard;
      writeLine(output, guard);
      return;
    }
  }
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
  // P1 — index_repository 已成功（result.ok），但紧随的 refreshIndexStatus
  // 可能因 list_projects/index_status 读回延迟未能确认 ready/stale。这里不用
  // stale 冒充真实过期，而记录更精确的终态：刷新完成但读回/新鲜度待确认。
  const statusAfterRefresh: string = context.index.status;
  if (
    statusAfterRefresh === "missing" ||
    statusAfterRefresh === "unknown" ||
    statusAfterRefresh === "error"
  ) {
    context.index.status = "refresh_completed_but_unverified";
    context.index.artifactStatus = "stale";
    context.index.indexedAt = new Date().toISOString();
    context.index.error = undefined;
    context.index.staleHint =
      context.language === "en-US"
        ? "Index refresh command completed, but status read-back/freshness was not verified. Run /index status --fresh to confirm."
        : "索引刷新命令已完成，但状态读回/新鲜度尚未验证。运行 /index status --fresh 可确认。";
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
    const detailsText = formatIndexAutoSkipDetails(safety, actionLabel, context.language);
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
      detailsText,
      transientExcludes.map((file) => `skipped_file:${file}`),
    );
    context.lastFullOutput = detailsText;
    writeLine(output, context.index.safetyWarning);
    writeLine(output, formatIndexAutoSkipNextAction(context.language));
  }
}

export async function runIndexQuery(
  context: TuiContext,
  tool: "search_code" | "search_graph" | "get_architecture",
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
  context.index.lastQuery =
    tool === "search_code" || tool === "search_graph"
      ? String(input.pattern ?? input.query ?? "")
      : "architecture";
  context.index.lastSummary = summary;
  return { summary };
}

export async function recordIndexEvidence(
  context: TuiContext,
  query: string,
  summary: string,
  supportsClaims: string[] = [],
): Promise<void> {
  const supportsIndexCodeFact = isSupportiveIndexEvidence(context, query, summary);
  const isSupplementalEvidence = supportsClaims.length > 0;
  if (!supportsIndexCodeFact && !isSupplementalEvidence) {
    return;
  }
  const sessionId = await deps().ensureSession(context);
  const evidence: EvidenceRecord = {
    id: randomUUID(),
    kind: "index_query",
    summary: truncateDisplay(summary.replace(/\s+/g, " "), 160),
    source: `codebase-memory:${context.index.projectName ?? "unknown"}:${query}`,
    supportsClaims: [
      "index_query",
      ...(supportsIndexCodeFact ? ["index_code_fact"] : []),
      query,
      ...supportsClaims,
    ],
    createdAt: new Date().toISOString(),
  };
  deps().rememberEvidence(context, evidence);
  await context.store.appendEvent(sessionId, { type: "evidence_record", ...evidence });
}

export function isSupportiveIndexEvidence(
  context: TuiContext,
  query: string,
  summary: string,
): boolean {
  if (context.index.status !== "ready" || !context.index.projectName) {
    return false;
  }
  const text = `${query}\n${summary}`;
  if (
    /(?:missing|stale|error|not ready|no matches|status[:=\s]+(?:missing|stale|error))/iu.test(text)
  ) {
    return false;
  }
  return /(?:\bpath\s*(?:=|:|\s)\s*(?!unknown\b|-)(?:[^\s,;]+)|\bfile_path\s*[:=]\s*(?!unknown\b|-)(?:[^\s,;]+)|\bfile:\s*(?!unknown\b|-)(?:[^\s,;]+)|\bsymbol\s*(?:=|:|\s)\s*(?!unknown\b|-)(?:[^\s,;]+)|\bsnippet\s*=\s*(?!\s*$).+|\bmatch\s*=\s*(?!\s*$).+)/imu.test(
    text,
  );
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
  data: {
    matches: ReturnType<typeof summarizeDeferredToolMatch>[];
    total: number;
    recommendedNext?: DeferredToolRecommendation;
  };
} {
  const all = listDeferredTools(context);
  const filtered = searchDeferredTools(query, all);
  const recommendedNext = recommendDeferredToolCall(query, context, filtered);
  // D.13I tail fix — 仅把"匹配上的"工具名记入本 session 已发现集合。
  // ExecuteExtraTool 需要这个证据来证明模型确实通过 SearchExtraTools 发现过该工具。
  for (const tool of filtered) {
    context.discoveredDeferredToolNames.add(tool.name);
  }
  const recommendationText = recommendedNext
    ? ` Recommended next: ExecuteExtraTool(${recommendedNext.tool_name}, ${JSON.stringify({
        params: recommendedNext.params,
      })}) because ${recommendedNext.reason}.`
    : "";
  return {
    ok: true,
    text: `SearchExtraTools matched ${filtered.length}/${all.length} deferred tools (query=${JSON.stringify(query)}).${recommendationText}`,
    data: { matches: filtered.map(summarizeDeferredToolMatch), total: filtered.length, recommendedNext },
  };
}

type DeferredToolRecommendation = {
  tool_name: string;
  params: Record<string, unknown>;
  reason: string;
};

function recommendDeferredToolCall(
  query: string,
  context: TuiContext,
  matches: ReturnType<typeof listDeferredTools>,
): DeferredToolRecommendation | undefined {
  const has = (name: string) => matches.some((tool) => tool.name === name && tool.executable);
  const task = query.trim();
  if (context.index.status === "ready" && context.index.projectName) {
    if (has("get_architecture")) {
      return {
        tool_name: "get_architecture",
        params: { project: context.index.projectName },
        reason: "codebase-memory index is ready, so index-backed architecture is the broad repository discovery step",
      };
    }
    if (task && has("search_code")) {
      return {
        tool_name: "search_code",
        params: { project: context.index.projectName, pattern: task },
        reason: "codebase-memory index is ready, so indexed search should narrow the repository scope before AST precision",
      };
    }
    if (task && has("search_graph")) {
      return {
        tool_name: "search_graph",
        params: { project: context.index.projectName, query: task },
        reason: "codebase-memory index is ready, so graph search should narrow related symbols before AST precision",
      };
    }
  }
  if (task && has("pre_plan")) {
    return {
      tool_name: "pre_plan",
      params: { task },
      reason: "the codebase index is not ready, so pre-engine should provide the first structured repository-analysis pass",
    };
  }
  return undefined;
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
        text: "该索引写入动作不能通过通用工具入口执行。请使用 /index refresh 或让模型发起结构化的代码索引刷新工具；执行时仍会走 Linghun 权限边界。",
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
  if (target.kind === "pre-engine") {
    const binary = await resolvePreEngineBinary();
    if (!binary) {
      return {
        ok: false,
        text: `ExecuteExtraTool(pre-engine:${target.name}) 失败：找不到 linghun-pre-engine 二进制文件（bundled 或 PATH 均未命中）。`,
      };
    }
    const daemon = getOrCreatePreEngineDaemon(binary, context.projectPath);
    const result = await daemon.call(target.name, params as Record<string, unknown>);
    if (!result.ok) {
      return {
        ok: false,
        text: `ExecuteExtraTool(pre-engine:${target.name}) 失败：${result.summary}`,
      };
    }
    return {
      ok: true,
      text: `ExecuteExtraTool(pre-engine:${target.name}) 完成。`,
      data: result.data,
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
    const isSse = serverConfig?.transport === "sse" && typeof serverConfig.url === "string";
    if (!isLocalStdioMcpServer(serverConfig) && !isSse) {
      return {
        ok: false,
        text: `ExecuteExtraTool: MCP server ${parsed.server} 不是本地 stdio 或 SSE（缺少 command/url 或已禁用）。`,
      };
    }
    if (!context.mcpStdioMutatingGranted && isPotentiallyMutatingMcpTool(parsed.tool)) {
      return {
        ok: false,
        text: "该 MCP 工具看起来会修改工作区，不能通过通用工具入口直接执行。请改用明确的受控命令或让模型发起对应结构化工具；执行时仍会走 Linghun 权限边界。",
      };
    }
    const result = isSse
      ? await runMcpSseToolCall(serverConfig as McpServerConfig, parsed.tool, params)
      : await runMcpStdioToolCall(
          serverConfig as McpServerConfig,
          parsed.tool,
          params,
          context.projectPath,
        );
    if (!result.ok) {
      return {
        ok: false,
        text: `ExecuteExtraTool(${target.name}) 失败：${result.summary}${result.errorCode ? ` [${result.errorCode}]` : ""}`,
      };
    }
    return {
      ok: true,
      text: `ExecuteExtraTool(${target.name}) 完成。`,
      data: result.data,
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
