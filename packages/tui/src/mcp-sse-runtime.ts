import type { McpServerConfig } from "@linghun/config";
import { sanitizeDiagnosticText } from "./startup-runtime.js";

type McpSseResult =
  | {
      ok: true;
      data?: unknown;
      summary: string;
    }
  | {
      ok: false;
      summary: string;
      errorCode?: string;
    };

export type McpRuntimeProgress = {
  phase: "starting" | "initializing" | "listing" | "calling" | "waiting" | "receiving";
  transport: "sse" | "stdio";
  receivedBytes?: number;
  itemCount?: number;
};

type McpRuntimeOptions = {
  idleTimeoutMs?: number;
  onProgress?: (progress: McpRuntimeProgress) => void;
};

export type McpTransportLimits = {
  maxFrameBytes: number;
  maxStreamBytes: number;
  maxFrames: number;
  maxStderrBytes: number;
};

export const MCP_TRANSPORT_LIMITS: Readonly<McpTransportLimits> = Object.freeze({
  maxFrameBytes: 64 * 1024 * 1024,
  maxStreamBytes: 256 * 1024 * 1024,
  maxFrames: 1_000_000,
  maxStderrBytes: 8 * 1024 * 1024,
});

const MCP_SSE_CONNECTION_TIMEOUT_MS = 15_000;
const MCP_SSE_TOOL_CALL_TIMEOUT_MS = 100_000_000;
const MCP_SSE_TOOL_LIST_CACHE_TTL_MS = 5_000;
const MCP_SSE_TOOL_LIST_CACHE_MAX_ENTRIES = 20;
let nextJsonRpcId = 1;
const toolListCache = new Map<string, { expiresAt: number; toolNames: string[] }>();

export async function runMcpSseToolCall(
  server: McpServerConfig,
  toolName: string,
  params: Record<string, unknown>,
  timeoutMs = MCP_SSE_TOOL_CALL_TIMEOUT_MS,
  signal?: AbortSignal,
  options: McpRuntimeOptions = {},
): Promise<McpSseResult> {
  if (!server.url) {
    return { ok: false, summary: "MCP SSE server url is missing", errorCode: "MCP_SSE_URL_MISSING" };
  }
  options.onProgress?.({ phase: "starting", transport: "sse" });
  options.onProgress?.({ phase: "listing", transport: "sse" });
  const list = await getMcpSseToolNames(
    server.url,
    MCP_SSE_CONNECTION_TIMEOUT_MS,
    signal,
    options.onProgress,
  );
  if (!list.ok) return list;
  const toolNames = list.toolNames;
  if (!toolNames.includes(toolName)) {
    return {
      ok: false,
      summary: `tools/list does not contain ${toolName} (server published ${toolNames.length} tools); refusing tools/call`,
      errorCode: "MCP_TOOL_NOT_FOUND",
    };
  }
  options.onProgress?.({ phase: "calling", transport: "sse" });
  const result = await mcpSseRequest(
    server.url,
    "tools/call",
    { name: toolName, arguments: params },
    timeoutMs,
    signal,
    options.onProgress,
    options.idleTimeoutMs ?? timeoutMs,
  );
  if (!result.ok) return result;
  return { ok: true, summary: `tools/call ${toolName} ok`, data: result.data };
}

async function getMcpSseToolNames(
  url: string,
  timeoutMs: number,
  signal?: AbortSignal,
  onProgress?: McpRuntimeOptions["onProgress"],
): Promise<{ ok: true; toolNames: string[] } | { ok: false; summary: string; errorCode?: string }> {
  const cached = toolListCache.get(url);
  const now = Date.now();
  for (const [cachedUrl, entry] of toolListCache) {
    if (entry.expiresAt <= now) toolListCache.delete(cachedUrl);
  }
  if (cached && cached.expiresAt > now) {
    toolListCache.delete(url);
    toolListCache.set(url, cached);
    return { ok: true, toolNames: [...cached.toolNames] };
  }
  const list = await mcpSseRequest(url, "tools/list", {}, timeoutMs, signal, onProgress, timeoutMs);
  if (!list.ok) {
    return { ok: false, summary: list.summary, errorCode: list.errorCode };
  }
  const toolNames = extractMcpToolNames(list.data);
  toolListCache.delete(url);
  toolListCache.set(url, {
    expiresAt: Date.now() + MCP_SSE_TOOL_LIST_CACHE_TTL_MS,
    toolNames,
  });
  while (toolListCache.size > MCP_SSE_TOOL_LIST_CACHE_MAX_ENTRIES) {
    const oldestUrl = toolListCache.keys().next().value;
    if (typeof oldestUrl !== "string") break;
    toolListCache.delete(oldestUrl);
  }
  return { ok: true, toolNames };
}

export async function mcpSseRequest(
  url: string,
  method: string,
  params: unknown,
  timeoutMs: number,
  signal?: AbortSignal,
  onProgress?: McpRuntimeOptions["onProgress"],
  idleTimeoutMs = timeoutMs,
  limits: Readonly<McpTransportLimits> = MCP_TRANSPORT_LIMITS,
): Promise<McpSseResult> {
  const controller = new AbortController();
  let timeoutKind: "idle" | "hard" | undefined;
  const abortFromCaller = () => controller.abort(signal?.reason);
  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener("abort", abortFromCaller, { once: true });
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let hardTimer: ReturnType<typeof setTimeout> | undefined;
  const armInactivityTimeout = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      timeoutKind = "idle";
      controller.abort();
    }, idleTimeoutMs);
  };
  armInactivityTimeout();
  hardTimer = setTimeout(() => {
    timeoutKind = "hard";
    controller.abort();
  }, timeoutMs);
  const id = nextMcpSseRequestId();
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream, application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      signal: controller.signal,
    });
    onProgress?.({ phase: "waiting", transport: "sse" });
    if (!response.ok) {
      return { ok: false, summary: `MCP SSE HTTP ${response.status}`, errorCode: "MCP_SSE_HTTP_ERROR" };
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("json")) {
      const json = await readBoundedJsonResponse(response, limits);
      if (isValidMcpProtocolActivity(json, id)) {
        armInactivityTimeout();
        onProgress?.({ phase: "receiving", transport: "sse" });
      }
      return unwrapJsonRpc(json, id);
    }
    const frame = await readSseJsonFrame(response, id, (receivedBytes) => {
      armInactivityTimeout();
      onProgress?.({ phase: "receiving", transport: "sse", receivedBytes });
    }, limits);
    return unwrapJsonRpc(frame, id);
  } catch (error) {
    if (error instanceof McpSseStructuredError) controller.abort(error);
    const callerAborted = signal?.aborted === true;
    return {
      ok: false,
      summary: `MCP SSE error: ${sanitizeDiagnosticText(error instanceof Error ? error.message : String(error))}`,
      errorCode:
        error instanceof McpSseStructuredError
          ? error.errorCode
          : error instanceof Error && error.name === "AbortError"
          ? callerAborted
            ? "MCP_SSE_ABORTED"
            : timeoutKind
              ? "ETIMEDOUT"
              : "MCP_SSE_ABORTED"
          : "MCP_SSE_ERROR",
    };
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    if (hardTimer) clearTimeout(hardTimer);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

class McpSseStructuredError extends Error {
  constructor(
    message: string,
    readonly errorCode: string,
  ) {
    super(message);
  }
}

async function readBoundedJsonResponse(
  response: Response,
  limits: Readonly<McpTransportLimits>,
): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > limits.maxFrameBytes) {
    throw new McpSseStructuredError(
      `MCP SSE JSON body exceeds ${limits.maxFrameBytes} bytes`,
      "MCP_SSE_BODY_TOO_LARGE",
    );
  }
  const reader = response.body?.getReader();
  if (!reader) return undefined;
  const decoder = new TextDecoder();
  let body = "";
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > limits.maxFrameBytes || receivedBytes > limits.maxStreamBytes) {
        throw new McpSseStructuredError(
          `MCP SSE JSON body exceeds ${Math.min(limits.maxFrameBytes, limits.maxStreamBytes)} bytes`,
          "MCP_SSE_BODY_TOO_LARGE",
        );
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return JSON.parse(body);
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
}

function nextMcpSseRequestId(): number {
  const id = nextJsonRpcId;
  nextJsonRpcId = nextJsonRpcId >= Number.MAX_SAFE_INTEGER ? 1 : nextJsonRpcId + 1;
  return id;
}

function unwrapJsonRpc(value: unknown, expectedId: number): McpSseResult {
  if (Array.isArray(value)) {
    return { ok: false, summary: "MCP SSE returned a JSON-RPC batch; expected one response object", errorCode: "MCP_SSE_BATCH_UNSUPPORTED" };
  }
  if (!value || typeof value !== "object") {
    return { ok: false, summary: "MCP SSE returned an invalid JSON-RPC frame" };
  }
  const frame = value as {
    jsonrpc?: unknown;
    id?: unknown;
    result?: unknown;
    error?: { message?: string; code?: string | number };
  };
  if (frame.jsonrpc !== "2.0" || frame.id !== expectedId) {
    return {
      ok: false,
      summary: "MCP SSE JSON-RPC response id/version mismatch",
      errorCode: "MCP_SSE_ID_MISMATCH",
    };
  }
  if (frame.error) {
    return {
      ok: false,
      summary: sanitizeDiagnosticText(frame.error.message ?? "MCP SSE JSON-RPC error"),
      errorCode: String(frame.error.code ?? "MCP_SSE_JSONRPC_ERROR"),
    };
  }
  return { ok: true, summary: "MCP SSE ok", data: frame.result };
}

export async function readSseJsonFrame(
  response: Response,
  expectedId: number,
  protocolActivity: (receivedBytes: number) => void,
  limits: Readonly<McpTransportLimits> = MCP_TRANSPORT_LIMITS,
): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return undefined;
  const decoder = new TextDecoder();
  let buffer = "";
  let receivedBytes = 0;
  let parsedFrameCount = 0;
  const consumeBlock = (block: string): unknown => {
    if (Buffer.byteLength(block, "utf8") > limits.maxFrameBytes) {
      throw new McpSseStructuredError(
        `MCP SSE frame exceeds ${limits.maxFrameBytes} bytes`,
        "MCP_SSE_FRAME_TOO_LARGE",
      );
    }
    const data = block
      .split(/\r?\n/u)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim())
      .filter((line) => line && line !== "[DONE]")
      .join("\n");
    if (!data) return undefined;
    parsedFrameCount += 1;
    if (parsedFrameCount > limits.maxFrames) {
      throw new McpSseStructuredError(
        `MCP SSE frame count exceeds ${limits.maxFrames}`,
        "MCP_SSE_FRAME_LIMIT_EXCEEDED",
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return undefined;
    }
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (parsed && typeof parsed === "object" && (parsed as { id?: unknown }).id === expectedId) {
      protocolActivity(receivedBytes);
      return parsed;
    }
    if (isValidMcpProgressNotification(parsed)) {
      protocolActivity(receivedBytes);
    }
    return undefined;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > limits.maxStreamBytes) {
        throw new McpSseStructuredError(
          `MCP SSE stream exceeds ${limits.maxStreamBytes} bytes`,
          "MCP_SSE_STREAM_LIMIT_EXCEEDED",
        );
      }
      buffer += decoder.decode(value, { stream: true });
      let boundary = /\r?\n\r?\n/u.exec(buffer);
      while (boundary) {
        const matched = consumeBlock(buffer.slice(0, boundary.index));
        buffer = buffer.slice(boundary.index + boundary[0].length);
        if (matched !== undefined) {
          await reader.cancel();
          return matched;
        }
        boundary = /\r?\n\r?\n/u.exec(buffer);
      }
      if (Buffer.byteLength(buffer, "utf8") > limits.maxFrameBytes) {
        throw new McpSseStructuredError(
          `MCP SSE frame exceeds ${limits.maxFrameBytes} bytes`,
          "MCP_SSE_FRAME_TOO_LARGE",
        );
      }
    }
    buffer += decoder.decode();
    const trailing = consumeBlock(buffer);
    if (trailing !== undefined) return trailing;
    return undefined;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
}

function isValidMcpProgressNotification(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const frame = value as { jsonrpc?: unknown; method?: unknown; params?: unknown };
  return frame.jsonrpc === "2.0" && frame.method === "notifications/progress" && Boolean(frame.params);
}

function isValidMcpProtocolActivity(value: unknown, expectedId: number): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const frame = value as { jsonrpc?: unknown; id?: unknown };
  return (
    (frame.jsonrpc === "2.0" && frame.id === expectedId) || isValidMcpProgressNotification(value)
  );
}

function extractMcpToolNames(listResult: unknown): string[] {
  if (!listResult || typeof listResult !== "object") return [];
  const tools = (listResult as { tools?: unknown }).tools;
  if (!Array.isArray(tools)) return [];
  return tools
    .map((tool) =>
      tool && typeof tool === "object" && typeof (tool as { name?: unknown }).name === "string"
        ? (tool as { name: string }).name
        : "",
    )
    .filter(Boolean);
}
