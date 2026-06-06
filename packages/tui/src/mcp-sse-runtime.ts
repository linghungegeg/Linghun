import type { McpServerConfig } from "@linghun/config";
import { sanitizeDiagnosticText } from "./startup-runtime.js";

type McpSseResult = {
  ok: boolean;
  data?: unknown;
  summary: string;
  errorCode?: string;
};

const MCP_SSE_TIMEOUT_MS = 15_000;

export async function runMcpSseToolCall(
  server: McpServerConfig,
  toolName: string,
  params: Record<string, unknown>,
  timeoutMs = MCP_SSE_TIMEOUT_MS,
): Promise<McpSseResult> {
  if (!server.url) {
    return { ok: false, summary: "MCP SSE server url is missing", errorCode: "MCP_SSE_URL_MISSING" };
  }
  const list = await mcpSseRequest(server.url, "tools/list", {}, timeoutMs);
  if (!list.ok) return list;
  const toolNames = extractMcpToolNames(list.data);
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

async function mcpSseRequest(
  url: string,
  method: string,
  params: unknown,
  timeoutMs: number,
): Promise<McpSseResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream, application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, summary: `MCP SSE HTTP ${response.status}`, errorCode: "MCP_SSE_HTTP_ERROR" };
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("json")) {
      const json = await response.json();
      return unwrapJsonRpc(json);
    }
    const text = await response.text();
    return unwrapJsonRpc(parseSseJsonFrame(text));
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

function unwrapJsonRpc(value: unknown): McpSseResult {
  if (!value || typeof value !== "object") {
    return { ok: false, summary: "MCP SSE returned an invalid JSON-RPC frame" };
  }
  const frame = value as { result?: unknown; error?: { message?: string; code?: string | number } };
  if (frame.error) {
    return {
      ok: false,
      summary: sanitizeDiagnosticText(frame.error.message ?? "MCP SSE JSON-RPC error"),
      errorCode: String(frame.error.code ?? "MCP_SSE_JSONRPC_ERROR"),
    };
  }
  return { ok: true, summary: "MCP SSE ok", data: frame.result };
}

function parseSseJsonFrame(text: string): unknown {
  const data = text
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .find((line) => line && line !== "[DONE]");
  if (!data) return undefined;
  return JSON.parse(data);
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
