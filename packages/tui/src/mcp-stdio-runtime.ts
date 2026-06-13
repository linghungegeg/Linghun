import { spawn } from "node:child_process";
import type { McpServerConfig } from "@linghun/config";
import { createProcessGuard } from "./process-guard.js";
import { sanitizeDiagnosticText } from "./startup-runtime.js";

// D.13J Block 4 — mutating heuristic for generic MCP tools。我们不知道具体 server 的工具语义，
// 只能依赖工具名前缀/关键字保守判定：write/delete/update/create/remove/index 等被视为 mutating。
// 默认守门：mutating → 必须 session 权限授予。readonly heuristic miss 不是问题（继续走 spawn）；
// mutating heuristic miss 才是问题（用户明确点名 codebase-memory 的 index_repository / detect_changes
// 必须默认拒绝），因此误报偏 mutating 比误报偏 readonly 更安全。
const MUTATING_MCP_TOOL_KEYWORDS: ReadonlyArray<string> = [
  "write",
  "delete",
  "update",
  "create",
  "remove",
  "index_repository",
  "detect_changes",
  "ingest",
  "manage_adr",
];

export function isPotentiallyMutatingMcpTool(toolName: string): boolean {
  const lower = toolName.toLowerCase();
  return MUTATING_MCP_TOOL_KEYWORDS.some((keyword) => lower.includes(keyword));
}

// D.13J Block 4 — JSON-RPC 2.0 over stdio MCP client。最小可用：
//   1. spawn server with command/args/env (cwd = project)
//   2. send `initialize` (capabilities + clientInfo)，等 result
//   3. send `tools/list`，校验目标 tool 在 server 公布的 list 内（防止虚假发现）
//   4. send `tools/call` (name + arguments)，等 result
//   5. 直接 kill 子进程；不维持长连接（每次 ExecuteExtraTool 一次性 spawn）。
// 设计说明：长连接需要管理 reconnect / inflight 字典 / pendingRequests 状态机，超出 D.13J Block 4
// 范围。一次性 spawn 简单、安全、可测；性能代价由后续 Block 优化。
// D.13J tail fix（Block A）：tools/list 是 tail fix 新增链路，server 必须能返回包含目标 tool 的列表，
// 否则视为 schema 不一致并拒绝执行；这样 deferred discovery 不再依赖 placeholder。
type McpStdioResult = {
  ok: boolean;
  data?: unknown;
  summary: string;
  errorCode?: string;
};

// D.13J tail fix（Block A）：仅探测 tools/list 用于 discovery。仅返回工具名集合 +
// 是否存在 noise/error，不写入 stdio adapter 缓存；调用方负责把它喂给 stabilizeMcpToolList。
type McpStdioToolListResult = {
  ok: boolean;
  toolNames: string[];
  summary: string;
  errorCode?: string;
};

const MCP_STDIO_CALL_TIMEOUT_MS = 15_000;

const MCP_STDIO_PROTOCOL_VERSION = "2025-06-18";

type McpStdioRequestSender = (method: string, params?: unknown) => Promise<unknown>;

type McpStdioRunnerResult<T> =
  | { ok: true; value: T }
  | { ok: false; summary: string; errorCode?: string };

type McpStdioRunnerOptions<T> = {
  server: McpServerConfig;
  cwd: string;
  timeoutMs: number;
  label: string;
  timeoutSummary: string;
  captureStderr: boolean;
  run: (sendRequest: McpStdioRequestSender) => Promise<T>;
};

class McpStdioStructuredError extends Error {
  constructor(
    message: string,
    readonly errorCode?: string,
  ) {
    super(message);
  }
}

export async function createMcpStdioRunner<T>(
  options: McpStdioRunnerOptions<T>,
): Promise<McpStdioRunnerResult<T>> {
  return new Promise((resolvePromise) => {
    let child: ReturnType<typeof spawn>;
    const guard = createProcessGuard();
    try {
      child = spawn(options.server.command, options.server.args ?? [], {
        cwd: options.cwd,
        shell: false,
        windowsHide: true,
        env: options.server.env ? { ...process.env, ...options.server.env } : process.env,
        stdio: ["pipe", "pipe", "pipe"],
      });
      guard.track(child, { label: options.label });
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      resolvePromise({
        ok: false,
        summary: `spawn failed: ${sanitizeDiagnosticText(nodeError.message)}`,
        errorCode: nodeError.code,
      });
      return;
    }

    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (result: McpStdioRunnerResult<T>): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try {
        guard.requestStop(false);
      } catch {
        // ignore
      }
      resolvePromise(result);
    };

    const stderrChunks: Buffer[] = [];
    let stdoutBuffer = "";
    const stdin = child.stdin;
    const stdout = child.stdout;
    const stderr = child.stderr;
    if (!stdin || !stdout || !stderr) {
      settle({ ok: false, summary: "MCP stdio streams unavailable" });
      return;
    }

    timer = setTimeout(() => {
      settle({
        ok: false,
        summary: options.timeoutSummary,
        errorCode: "ETIMEDOUT",
      });
    }, options.timeoutMs);

    type Pending = {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    };
    const pending = new Map<number, Pending>();
    let nextId = 1;

    const sendRequest = (method: string, params2?: unknown): Promise<unknown> => {
      return new Promise((resolveReq, rejectReq) => {
        const id = nextId++;
        pending.set(id, { resolve: resolveReq, reject: rejectReq });
        const message = JSON.stringify({ jsonrpc: "2.0", id, method, params: params2 });
        try {
          stdin.write(`${message}\n`);
        } catch (error) {
          pending.delete(id);
          rejectReq(error as Error);
        }
      });
    };

    stdout.setEncoding("utf8");
    stdout.on("data", (chunk: string) => {
      stdoutBuffer += chunk;
      let newlineIdx = stdoutBuffer.indexOf("\n");
      // line-delimited JSON-RPC; each newline is a frame.
      while (newlineIdx >= 0) {
        const line = stdoutBuffer.slice(0, newlineIdx).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIdx + 1);
        if (line !== "") {
          let frame: unknown;
          try {
            frame = JSON.parse(line);
          } catch (error) {
            process.stderr.write(
              `[linghun] mcp_stdio_non_json_frame line=${sanitizeDiagnosticText(line.slice(0, 240))} reason=${sanitizeDiagnosticText(error instanceof Error ? error.message : String(error))}\n`,
            );
            newlineIdx = stdoutBuffer.indexOf("\n");
            continue;
          }
          const obj = frame as {
            id?: number;
            result?: unknown;
            error?: { message?: string; code?: number | string };
          };
          if (typeof obj.id === "number") {
            const handler = pending.get(obj.id);
            if (handler) {
              pending.delete(obj.id);
              if (obj.error) {
                handler.reject(
                  new Error(
                    `MCP error id=${obj.id}: ${sanitizeDiagnosticText(obj.error.message ?? "unknown")}`,
                  ),
                );
              } else {
                handler.resolve(obj.result);
              }
            }
          }
        }
        newlineIdx = stdoutBuffer.indexOf("\n");
      }
    });
    stderr.on("data", (chunk: Buffer) => {
      if (options.captureStderr) {
        stderrChunks.push(chunk);
      }
    });
    child.on("error", (error: Error) => {
      const nodeError = error as NodeJS.ErrnoException;
      settle({
        ok: false,
        summary: `MCP stdio error: ${sanitizeDiagnosticText(nodeError.message)}`,
        errorCode: nodeError.code,
      });
    });
    child.on("exit", (code, signal) => {
      // 让 settle 决定 outcome：如果 tools/call 已经 resolve 过，settle 会被忽略。
      if (!settled) {
        const stderrText = sanitizeDiagnosticText(
          Buffer.concat(stderrChunks).toString("utf8").slice(0, 400),
        );
        settle({
          ok: false,
          summary: `MCP stdio child exited prematurely (code=${code ?? "?"} signal=${signal ?? "-"})${stderrText ? `: ${stderrText}` : ""}`,
        });
      }
    });

    (async () => {
      try {
        const result = await options.run(sendRequest);
        settle({ ok: true, value: result });
      } catch (error) {
        if (error instanceof McpStdioStructuredError) {
          settle({
            ok: false,
            summary: sanitizeDiagnosticText(error.message),
            errorCode: error.errorCode,
          });
          return;
        }
        settle({
          ok: false,
          summary: sanitizeDiagnosticText((error as Error).message),
        });
      }
    })();
  });
}

export async function runMcpStdioToolCall(
  server: McpServerConfig,
  toolName: string,
  params: Record<string, unknown>,
  cwd: string,
  timeoutMs: number = MCP_STDIO_CALL_TIMEOUT_MS,
): Promise<McpStdioResult> {
  const result = await createMcpStdioRunner({
    server,
    cwd,
    timeoutMs,
    label: `mcp-stdio:${server.command}`,
    timeoutSummary: `MCP stdio timeout after ${timeoutMs}ms (no result for tools/call ${toolName})`,
    captureStderr: true,
    run: async (sendRequest) => {
      await sendRequest("initialize", {
        protocolVersion: MCP_STDIO_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "linghun-tui", version: "0.0.0" },
      });
      // D.13J tail fix（Block A）：tools/list 校验目标 tool 在 server 公布的列表内。
      // 防御 server 静默接受 tools/call 但工具名不存在 / 拼写错误 / server 已下线该工具。
      const listResult = await sendRequest("tools/list", {});
      const toolNames = extractMcpToolNames(listResult);
      if (!toolNames.includes(toolName)) {
        throw new McpStdioStructuredError(
          `tools/list does not contain ${toolName} (server published ${toolNames.length} tools); refusing tools/call`,
          "MCP_TOOL_NOT_FOUND",
        );
      }
      return await sendRequest("tools/call", {
        name: toolName,
        arguments: params,
      });
    },
  });
  if (!result.ok) {
    return { ok: false, summary: result.summary, errorCode: result.errorCode };
  }
  return { ok: true, summary: `tools/call ${toolName} ok`, data: result.value };
}

// D.13J tail fix（Block A）：从 MCP `tools/list` result 中提取工具名集合。
// MCP 规范：result.tools 是 { name: string; description?: string; inputSchema?: object }[]。
// 我们仅取 name，丢弃其余字段（description/inputSchema 不进入 stdio adapter 缓存，避免 raw schema 泄露）。
function extractMcpToolNames(listResult: unknown): string[] {
  if (!listResult || typeof listResult !== "object") return [];
  const tools = (listResult as { tools?: unknown }).tools;
  if (!Array.isArray(tools)) return [];
  const names: string[] = [];
  for (const tool of tools) {
    if (tool && typeof tool === "object") {
      const name = (tool as { name?: unknown }).name;
      if (typeof name === "string" && name.length > 0) names.push(name);
    }
  }
  return names;
}

// D.13J tail fix（Block A）：仅探测 server 的 tools/list，用于 discovery 真实化。
// 与 runMcpStdioToolCall 共享 spawn / settle / JSON-RPC 解析逻辑；区别：不发 tools/call，
// 只回返工具名集合。失败时不抛错，返回 ok=false + errorCode + summary，由调用方决定是否
// 在 deferred discovery 中标 schemaLoaded=false。仅 5s timeout，避免拖慢启动。
export async function runMcpStdioToolList(
  server: McpServerConfig,
  cwd: string,
  timeoutMs = 5_000,
): Promise<McpStdioToolListResult> {
  const result = await createMcpStdioRunner({
    server,
    cwd,
    timeoutMs,
    label: `mcp-stdio-list:${server.command}`,
    timeoutSummary: `MCP stdio tools/list timeout after ${timeoutMs}ms`,
    captureStderr: false,
    run: async (sendRequest) => {
      await sendRequest("initialize", {
        protocolVersion: MCP_STDIO_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "linghun-tui", version: "0.0.0" },
      });
      return extractMcpToolNames(await sendRequest("tools/list", {}));
    },
  });
  if (!result.ok) {
    return { ok: false, toolNames: [], summary: result.summary, errorCode: result.errorCode };
  }
  return {
    ok: true,
    toolNames: result.value,
    summary: `tools/list ok (${result.value.length} tools)`,
  };
}
