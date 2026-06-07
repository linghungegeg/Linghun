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

const MCP_SSE_TIMEOUT_MS = 15_000;
const MCP_SSE_TOOL_LIST_CACHE_TTL_MS = 5_000;
let nextJsonRpcId = 1;
const toolListCache = new Map<string, { expiresAt: number; toolNames: string[] }>();

export async function runMcpSseToolCall(
  server: McpServerConfig,
  toolName: string,
  params: Record<string, unknown>,
  timeoutMs = MCP_SSE_TIMEOUT_MS,
): Promise<McpSseResult> {
  if (!server.url) {
    return { ok: false, summary: "MCP SSE server url is missing", errorCode: "MCP_SSE_URL_MISSING" };
  }
  const list = await getMcpSseToolNames(server.url, timeoutMs);
  if (!list.ok) return list;
  const toolNames = list.toolNames;
  if (!toolNames.includes(toolName)) {
    return {
      ok: false,
      summary: `tools/list does not contain ${toolName} (server published ${toolNames.length} tools); refusing tools/call`,
      errorCode: "MCP_TOOL_NOT_FOUND",
    };
  }
  const result = await mcpSseRequest(
    server.url,
    "tools/call",
    { name: toolName, arguments: params },
    timeoutMs,
  );
  if (!result.ok) return result;
  return { ok: true, summary: `tools/call ${toolName} ok`, data: result.data };
}

async function getMcpSseToolNames(
  url: string,
  timeoutMs: number,
): Promise<{ ok: true; toolNames: string[] } | { ok: false; summary: string; errorCode?: string }> {
  const cached = toolListCache.get(url);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return { ok: true, toolNames: [...cached.toolNames] };
  }
  const list = await mcpSseRequest(url, "tools/list", {}, timeoutMs);
  if (!list.ok) {
    return { ok: false, summary: list.summary, errorCode: list.errorCode };
  }
  const toolNames = extractMcpToolNames(list.data);
  toolListCache.set(url, {
    expiresAt: now + MCP_SSE_TOOL_LIST_CACHE_TTL_MS,
    toolNames,
  });
  return { ok: true, toolNames };
}

async function mcpSseRequest(
  url: string,
  method: string,
  params: unknown,
  timeoutMs: number,
): Promise<McpSseResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const id = nextMcpSseRequestId();
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream, application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, summary: `MCP SSE HTTP ${response.status}`, errorCode: "MCP_SSE_HTTP_ERROR" };
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("json")) {
      const json = await response.json();
      return unwrapJsonRpc(json, id);
    }
    const text = await response.text();
    return unwrapJsonRpc(parseSseJsonFrame(text, id), id);
  } catch (error) {
    return {
      ok: false,
      summary: `MCP SSE error: ${sanitizeDiagnosticText(error instanceof Error ? error.message : String(error))}`,
      errorCode: error instanceof Error && error.name === "AbortError" ? "ETIMEDOUT" : "MCP_SSE_ERROR",
    };
  } finally {
    clearTimeout(timer);
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

function parseSseJsonFrame(text: string, expectedId: number): unknown {
  const parsedFrames: unknown[] = [];
  const data = text
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .filter((line) => line && line !== "[DONE]");
  for (const frame of data) {
    const parsed = JSON.parse(frame);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (parsed && typeof parsed === "object" && (parsed as { id?: unknown }).id === expectedId) {
      return parsed;
    }
    parsedFrames.push(parsed);
  }
  return parsedFrames[0];
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
