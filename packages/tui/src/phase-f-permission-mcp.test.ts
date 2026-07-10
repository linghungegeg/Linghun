import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { builtInTools, createToolContext } from "@linghun/tools";
import { defaultConfig, mcpServerSignature, saveMcpServerConfig } from "@linghun/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  listDeferredTools,
  validateCodebaseMemoryToolExecution,
} from "./deferred-tools-catalog.js";
import { executeExtraTool, executeSearchExtraTools } from "./mcp-index-runtime.js";
import { runMcpSseToolCall } from "./mcp-sse-runtime.js";
import { DANGEROUS_DIRECTORIES, DANGEROUS_FILES, getPlatformPathDenyReason } from "./platform-security.js";
import { hasRepeatedPermissionDenial } from "./permission-continuation-runtime.js";
import type { TuiContext } from "./tui-context-runtime.js";
import { decidePermission } from "./tui-permission-runtime.js";

describe("Phase F permission contract and Windows safety coverage", () => {
  it("uses tool checkPermissions passthrough and preserves explicit allow/deny behavior", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "linghun-phase-f-perm-"));
    const context = minimalContext(workspace);

    expect(builtInTools.Write.checkPermissions({ path: "a.txt", content: "x" }, context.tools).behavior).toBe(
      "passthrough",
    );
    expect(builtInTools.Read.checkPermissions({ path: "a.txt" }, context.tools).behavior).toBe(
      "allow",
    );
    await expect(decidePermission("Read", { path: "a.txt" }, context, "session")).resolves.toMatchObject({
      decision: "allow",
    });
  });

  it("hard-denies Windows ADS, 8.3, DOS devices, and dangerous path lists", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "linghun-phase-f-path-"));
    expect(getPlatformPathDenyReason("file.txt:secret", workspace)).toContain("ADS");
    expect(getPlatformPathDenyReason("PROGRA~1/config", workspace)).toContain("8.3");
    expect(getPlatformPathDenyReason("CON", workspace)).toContain("DOS device");
    expect(DANGEROUS_FILES.has(".gitconfig")).toBe(true);
    expect(DANGEROUS_DIRECTORIES.has(".ssh")).toBe(true);

    const context = minimalContext(workspace);
    await expect(decidePermission("Write", { path: "file.txt:secret", content: "x" }, context, "session")).resolves.toMatchObject({
      decision: "deny",
    });
  });

  it("triggers denial escalation for repeated denials and total retention cap", () => {
    const recent = Array.from({ length: 20 }, (_, index) => ({
      id: `deny-${index}`,
      toolName: "Bash" as const,
      mode: "default" as const,
      reason: index < 3 ? "same" : `reason-${index}`,
      createdAt: new Date().toISOString(),
    }));

    expect(hasRepeatedPermissionDenial(recent.slice(0, 3))).toBe(true);
    expect(hasRepeatedPermissionDenial(recent)).toBe(true);
  });
});

describe("Phase F MCP duplicate, schema, and SSE coverage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("dedupes MCP servers by transport signature", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "linghun-phase-f-mcp-"));
    expect(mcpServerSignature({ command: "node", args: ["server.js"] })).toBe("stdio:node server.js");
    await saveMcpServerConfig(
      "one",
      { command: "node", args: ["server.js"], disabled: true },
      false,
      workspace,
    );
    await expect(
      saveMcpServerConfig("two", { command: "node", args: ["server.js"], disabled: true }, false, workspace),
    ).rejects.toThrow("MCP server duplicate");
  });

  it("validates codebase-memory required args and simple schema types", () => {
    expect(validateCodebaseMemoryToolExecution("search_code", { project: "F-Linghun", pattern: "route" })).toEqual({
      ok: true,
    });
    expect(validateCodebaseMemoryToolExecution("search_code", { project: 1, pattern: "route" })).toMatchObject({
      ok: false,
    });
    expect(validateCodebaseMemoryToolExecution("search_code", { project: "F-Linghun", pattern: {} })).toEqual({
      ok: false,
      summary: "MCP deferred tool guard: search_code.pattern 必须是 string，已拒绝执行。",
    });
  });

  it("executes an SSE MCP tools/list plus tools/call round trip", async () => {
    const seenIds: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { id: number; method: string };
        seenIds.push(body.id);
        if (body.method === "tools/list") {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "demo" }] } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: "ok" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    await expect(
      runMcpSseToolCall({ command: "", transport: "sse", url: "https://example.com/mcp" }, "demo", {
        x: 1,
      }),
    ).resolves.toMatchObject({ ok: true, data: { content: "ok" } });
    expect(new Set(seenIds).size).toBe(seenIds.length);
  });

  it("rejects SSE JSON-RPC id mismatch and JSON-RPC batch responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { id: number; method: string };
        if (body.method === "tools/list") {
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: body.id + 1, result: { tools: [{ name: "demo" }] } }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    await expect(
      runMcpSseToolCall({ command: "", transport: "sse", url: "https://example.com/mismatch" }, "demo", {}),
    ).resolves.toMatchObject({ ok: false, errorCode: "MCP_SSE_ID_MISMATCH" });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify([{ jsonrpc: "2.0", id: 1, result: { tools: [] } }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    await expect(
      runMcpSseToolCall({ command: "", transport: "sse", url: "https://example.com/batch" }, "demo", {}),
    ).resolves.toMatchObject({ ok: false, errorCode: "MCP_SSE_BATCH_UNSUPPORTED" });
  });

  it("caches SSE tools/list per endpoint while preserving tools/call ids", async () => {
    let listCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { id: number; method: string };
        if (body.method === "tools/list") {
          listCalls += 1;
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "demo" }] } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: "ok" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const server = { command: "", transport: "sse" as const, url: "https://example.com/cache" };
    await expect(runMcpSseToolCall(server, "demo", {})).resolves.toMatchObject({ ok: true });
    await expect(runMcpSseToolCall(server, "demo", {})).resolves.toMatchObject({ ok: true });
    expect(listCalls).toBe(1);
  });

  it("passes caller abort signals into MCP SSE requests", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        if (init.signal?.aborted) {
          throw new DOMException("aborted", "AbortError");
        }
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    await expect(
      runMcpSseToolCall(
        { command: "", transport: "sse", url: "https://example.com/abort-signal" },
        "demo",
        {},
        15_000,
        controller.signal,
      ),
    ).resolves.toMatchObject({ ok: false, errorCode: "MCP_SSE_ABORTED" });
  });

  it("finishes an MCP SSE call when the matching frame arrives before stream close", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const request = JSON.parse(String(init.body)) as { id: number; method: string };
        if (request.method === "tools/list") {
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { tools: [{ name: "demo" }] } }),
            { headers: { "content-type": "application/json" } },
          );
        }
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                `: heartbeat\n\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { content: "ok" } })}\n\n`,
              ),
            );
          },
        });
        return new Response(stream, { headers: { "content-type": "text/event-stream" } });
      }),
    );

    await expect(
      runMcpSseToolCall(
        { command: "", transport: "sse", url: "https://example.com/open-stream" },
        "demo",
        {},
        1_000,
      ),
    ).resolves.toMatchObject({ ok: true, data: { content: "ok" } });
  });

  it("does not let SSE noise or arbitrary ping renew the hard deadline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const request = JSON.parse(String(init.body)) as { id: number; method: string };
        if (request.method === "tools/list") {
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { tools: [{ name: "demo" }] } }),
            { headers: { "content-type": "application/json" } },
          );
        }
        let interval: ReturnType<typeof setInterval> | undefined;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            interval = setInterval(() => {
              controller.enqueue(
                new TextEncoder().encode(
                  `data: not-json\n\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "ping", params: {} })}\n\n`,
                ),
              );
            }, 10);
            init.signal?.addEventListener("abort", () => {
              if (interval) clearInterval(interval);
              controller.error(new DOMException("aborted", "AbortError"));
            });
          },
          cancel() {
            if (interval) clearInterval(interval);
          },
        });
        return new Response(stream, { headers: { "content-type": "text/event-stream" } });
      }),
    );

    await expect(
      runMcpSseToolCall(
        { command: "", transport: "sse", url: "https://example.com/noise-hard-cap" },
        "demo",
        {},
        120,
        undefined,
        { idleTimeoutMs: 1_000 },
      ),
    ).resolves.toMatchObject({ ok: false, errorCode: "ETIMEDOUT" });
  });

  it("lets valid SSE progress frames renew idle until a response before hard deadline", async () => {
    const progress: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const request = JSON.parse(String(init.body)) as { id: number; method: string };
        if (request.method === "tools/list") {
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { tools: [{ name: "demo" }] } }),
            { headers: { "content-type": "application/json" } },
          );
        }
        let interval: ReturnType<typeof setInterval> | undefined;
        let responseTimer: ReturnType<typeof setTimeout> | undefined;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            interval = setInterval(() => {
              controller.enqueue(
                new TextEncoder().encode(
                  `data: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: { progress: 1 } })}\n\n`,
                ),
              );
            }, 30);
            responseTimer = setTimeout(() => {
              if (interval) clearInterval(interval);
              controller.enqueue(
                new TextEncoder().encode(
                  `data: ${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { content: "ok" } })}\n\n`,
                ),
              );
            }, 180);
          },
          cancel() {
            if (interval) clearInterval(interval);
            if (responseTimer) clearTimeout(responseTimer);
          },
        });
        return new Response(stream, { headers: { "content-type": "text/event-stream" } });
      }),
    );

    await expect(
      runMcpSseToolCall(
        { command: "", transport: "sse", url: "https://example.com/valid-progress" },
        "demo",
        {},
        500,
        undefined,
        {
          idleTimeoutMs: 60,
          onProgress: (event) => {
            progress.push(event.phase);
          },
        },
      ),
    ).resolves.toMatchObject({ ok: true, data: { content: "ok" } });
    expect(progress).toContain("receiving");
  });

  it("fails closed for skill/plugin deferred entries without safe executors", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "linghun-deferred-extension-"));
    const context = minimalContext(workspace);
    context.skills.enabled = true;
    context.skills.trustedIds = ["local-skill"];
    context.skills.skills = [
      {
        id: "local-skill",
        name: "Local Skill",
        description: "test skill",
        triggers: ["run"],
        summary: "test",
        source: "local",
        scope: "project",
        path: "skill.json",
        version: "1.0.0",
        enabled: true,
        trusted: true,
        permissions: [],
        mayWrite: false,
        mayExecute: false,
        mayNetwork: false,
        lifecycle: {
          trustLevel: "trusted",
          permissionSummary: "none",
          discovered: true,
          registered: true,
          schemaLoaded: true,
          runtimeVersion: "compatible",
        },
      },
    ];
    context.plugins.enabled = true;
    context.plugins.trustedIds = ["local-plugin"];
    context.plugins.plugins = [
      {
        id: "local-plugin",
        name: "Local Plugin",
        version: "1.0.0",
        description: "test plugin",
        source: "local",
        scope: "project",
        path: "plugin.json",
        enabled: true,
        trusted: true,
        permissions: [],
        mayWrite: false,
        mayExecute: false,
        mayNetwork: false,
        lifecycle: {
          trustLevel: "trusted",
          permissionSummary: "none",
          discovered: true,
          registered: true,
          schemaLoaded: true,
          runtimeVersion: "compatible",
        },
        contributions: {
          commands: ["hello"],
          mcpServers: [],
          providers: [],
          hooks: [],
          workflows: [],
          skills: [],
        },
      },
    ];

    const tools = listDeferredTools(context);
    expect(tools.find((tool) => tool.name === "skill:local-skill")?.executable).toBe(false);
    expect(tools.find((tool) => tool.name === "plugin:local-plugin")?.executable).toBe(false);

    executeSearchExtraTools("local", context);
    await expect(executeExtraTool({ tool_name: "skill:local-skill", params: {} }, context)).resolves.toMatchObject({
      ok: false,
    });
    await expect(executeExtraTool({ tool_name: "plugin:local-plugin", params: {} }, context)).resolves.toMatchObject({
      ok: false,
    });
  });
});

function minimalContext(projectPath: string): TuiContext {
  return {
    projectPath,
    language: "zh-CN",
    permissionMode: "default",
    config: defaultConfig,
    tools: createToolContext(projectPath),
    store: {
      appendEvent: async () => {},
    },
    sessionId: "session",
    permissions: { rules: [], recentDenied: [] },
    mcp: { enabled: false, servers: [], tools: [] },
    skills: {
      enabled: false,
      projectDir: projectPath,
      userDir: projectPath,
      skills: [],
      disabledIds: [],
      trustedIds: [],
      evolutionCandidates: [],
      rejectedEvolutionCandidates: [],
    },
    plugins: {
      enabled: false,
      projectDir: projectPath,
      userDir: projectPath,
      plugins: [],
      disabledIds: [],
      trustedIds: [],
    },
    discoveredDeferredToolNames: new Set<string>(),
    index: { status: "unknown" },
  } as unknown as TuiContext;
}
