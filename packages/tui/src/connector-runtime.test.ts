import { mkdtemp, writeFile } from "node:fs/promises";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Writable } from "node:stream";
import { defaultConfig, getSessionRootDir } from "@linghun/config";
import { SessionStore } from "@linghun/core";
import { createToolContext } from "@linghun/tools";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  executeCapability,
  findCapability,
  handleCapabilitiesCommand,
  listCapabilities,
} from "./capability-runtime.js";
import {
  connectAppConnector,
  disconnectAppConnector,
  formatAppConnectorDoctor,
  formatAppConnectorList,
  handleAppsCommand,
  listAppConnectors,
  validateAppConnectorManifest,
} from "./connector-runtime.js";
import { createFailureLearningState } from "./failure-learning-runtime.js";
import { createIndexState } from "./index-runtime.js";
import { createSolutionCompletenessStatus } from "./model-loop-runtime.js";
import { createProviderCircuitBreakerState } from "./provider-circuit-breaker.js";
import type { TuiContext } from "./tui-context-runtime.js";
import {
  createCacheState,
  createHookState,
  createMcpState,
  createMemoryState,
  createPluginState,
  createRemoteState,
  createSkillState,
  createWorkflowState,
} from "./tui-state-runtime.js";

describe("Connector Runtime Local HTTP", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads a manifest, handshakes with Local HTTP, and registers capabilities", async () => {
    const context = await createConnectorTestContext("default");
    const server = await startMockConnector();
    try {
      const manifestPath = await writeManifest(context.projectPath, server.baseUrl);
      const result = await connectAppConnector(manifestPath, context);

      expect(result.ok).toBe(true);
      expect(findCapability("demo.drawing.describe", context)?.transport).toBe("http");
      expect(listCapabilities(context).map((item) => item.id)).toContain("demo.drawing.paint");
      expect(listAppConnectors(context)[0]?.appId).toBe("demo.drawing");
    } finally {
      await server.close();
      disconnectAppConnector("demo.drawing", context);
    }
  });

  it("/apps connect reaches the local mock server and prints a safe success summary", async () => {
    const context = await createConnectorTestContext("default");
    const output = new MemoryOutput();
    const server = await startMockConnector();
    try {
      const manifestPath = await writeManifest(context.projectPath, server.baseUrl);

      await handleAppsCommand(["connect", manifestPath], context, output);

      expect(output.text).toContain(
        "已连接 Demo Drawing；注册 capability 2 个；写入/外部 app 操作会走权限确认。",
      );
      expect(server.requests.some((item) => item.path === "/linghun/capabilities")).toBe(true);
      expect(output.text).not.toContain('"capabilities"');
      expect(output.text).not.toContain("Authorization");
    } finally {
      await server.close();
      disconnectAppConnector("demo.drawing", context);
    }
  });

  it("/apps validate checks a manifest without contacting the connector", async () => {
    const context = await createConnectorTestContext("default");
    const output = new MemoryOutput();
    const manifestPath = await writeManifest(context.projectPath, "http://127.0.0.1:47831");

    const result = await validateAppConnectorManifest(manifestPath, context);
    await handleAppsCommand(["validate", manifestPath], context, output);

    expect(result).toMatchObject({
      ok: true,
      appId: "demo.drawing",
      capabilityCount: 2,
    });
    expect(output.text).toContain("Manifest 有效");
    expect(output.text).toContain("capabilities=2");
    expect(listAppConnectors(context)).toHaveLength(0);
  });

  it("/apps test-run connects, executes through Capability Runtime, and records evidence", async () => {
    const context = await createConnectorTestContext("default");
    const output = new MemoryOutput();
    const server = await startMockConnector();
    try {
      const manifestPath = await writeManifest(context.projectPath, server.baseUrl);

      await handleAppsCommand(
        ["test-run", manifestPath, "demo.drawing.describe", '{"subject":"circle"}'],
        context,
        output,
      );

      expect(output.text).toContain("已连接 Demo Drawing 并执行 demo.drawing.describe");
      expect(output.text).toContain("摘要：Described circle");
      expect(server.requests.some((item) => item.path === "/linghun/capabilities")).toBe(true);
      expect(server.requests.some((item) => item.path === "/linghun/execute")).toBe(true);
      expect(context.evidence.some((item) => item.summary.includes("capability succeeded"))).toBe(
        true,
      );
      expect(findCapability("demo.drawing.describe", context)).toBeTruthy();
    } finally {
      await server.close();
      disconnectAppConnector("demo.drawing", context);
    }
  });

  it("formats list and doctor without leaking raw keys", async () => {
    vi.stubEnv("LINGHUN_DEMO_DRAWING_KEY", "sk-test-connector-secret");
    const context = await createConnectorTestContext("default");
    const server = await startMockConnector();
    try {
      const manifestPath = await writeManifest(context.projectPath, server.baseUrl, {
        auth: { type: "api_key", env: "LINGHUN_DEMO_DRAWING_KEY" },
      });
      const result = await connectAppConnector(manifestPath, context);

      expect(result.ok).toBe(true);
      const list = formatAppConnectorList(context);
      const doctor = formatAppConnectorDoctor(context);
      expect(list).toContain("Demo Drawing");
      expect(doctor).toContain("authSource=shell-env");
      expect(doctor).toContain("capabilities=2");
      expect(doctor).not.toContain("sk-test-connector-secret");
      expect(doctor).not.toContain("Authorization");
    } finally {
      await server.close();
      disconnectAppConnector("demo.drawing", context);
    }
  });

  it("resolves auth valueRef as a manifest ref without exposing the value in doctor", async () => {
    vi.stubEnv("LINGHUN_DEMO_DRAWING_REF_KEY", "sk-test-value-ref-secret");
    const context = await createConnectorTestContext("default");
    const server = await startMockConnector();
    try {
      const manifestPath = await writeManifest(context.projectPath, server.baseUrl, {
        auth: { type: "api_key", valueRef: "env:LINGHUN_DEMO_DRAWING_REF_KEY" },
      });
      const result = await connectAppConnector(manifestPath, context);

      expect(result.ok).toBe(true);
      const doctor = formatAppConnectorDoctor(context);
      expect(doctor).toContain("authSource=manifest-ref");
      expect(doctor).not.toContain("sk-test-value-ref-secret");
    } finally {
      await server.close();
      disconnectAppConnector("demo.drawing", context);
    }
  });

  it("executes HTTP capability through Capability Runtime and records evidence", async () => {
    const context = await createConnectorTestContext("default");
    const server = await startMockConnector();
    try {
      const manifestPath = await writeManifest(context.projectPath, server.baseUrl);
      await connectAppConnector(manifestPath, context);
      const result = await executeCapability(
        { capabilityId: "demo.drawing.describe", input: { subject: "circle" }, source: "slash" },
        context,
      );

      expect(result.ok).toBe(true);
      expect(result.summary).toContain("Described circle");
      expect(result.evidenceId).toBeTruthy();
      const evidence = context.evidence.find((item) => item.id === result.evidenceId);
      expect(evidence?.summary).toContain("capability succeeded demo.drawing.describe");
      expect(evidence?.supportsClaims).toContain("capability_success");
      expect(evidence?.supportsClaims).toContain("not_verification_pass");
      expect(evidence?.supportsClaims).not.toContain("capability_failure");
      expect(server.requests.some((item) => item.path === "/linghun/execute")).toBe(true);
    } finally {
      await server.close();
      disconnectAppConnector("demo.drawing", context);
    }
  });

  it("records HTTP connector failures as failed, not completed", async () => {
    const context = await createConnectorTestContext("full-access");
    const server = await startMockConnector({ failPaint: true });
    try {
      const manifestPath = await writeManifest(context.projectPath, server.baseUrl);
      await connectAppConnector(manifestPath, context);
      const result = await executeCapability(
        { capabilityId: "demo.drawing.paint", input: { title: "Broken" }, source: "slash" },
        context,
      );

      expect(result.ok).toBe(false);
      expect(result.summary).toContain("paint failed");
      const evidence = context.evidence.find((item) => item.id === result.evidenceId);
      expect(evidence?.summary).toContain("capability failed demo.drawing.paint");
      expect(evidence?.supportsClaims).toContain("capability_failure");
      expect(evidence?.supportsClaims).toContain("not_verification_pass");
      expect(evidence?.supportsClaims).not.toContain("capability_success");
      expect(evidence?.supportsClaims).not.toContain("verification_passed");
      const transcript = JSON.stringify(
        (await context.store.resume(context.sessionId ?? "")).transcript,
      );
      expect(transcript).toContain("capability failed id=demo.drawing.paint");
      expect(transcript).not.toContain("capability completed id=demo.drawing.paint");
    } finally {
      await server.close();
      disconnectAppConnector("demo.drawing", context);
    }
  });

  it("keeps HTTP external_app/write capabilities inside the permission pipeline", async () => {
    const context = await createConnectorTestContext("plan");
    const server = await startMockConnector();
    try {
      const manifestPath = await writeManifest(context.projectPath, server.baseUrl);
      await connectAppConnector(manifestPath, context);
      const denied = await executeCapability(
        { capabilityId: "demo.drawing.paint", input: { title: "Blocked" }, source: "slash" },
        context,
      );

      expect(denied.ok).toBe(false);
      expect(denied.summary).toContain("Permission denied");
      expect(context.permissions.recentDenied.some((item) => item.toolName === "Write")).toBe(true);

      context.permissionMode = "full-access";
      const allowed = await executeCapability(
        { capabilityId: "demo.drawing.paint", input: { title: "Allowed" }, source: "slash" },
        context,
      );

      expect(allowed.ok).toBe(true);
      expect(allowed.summary).toContain("Painted Allowed");
    } finally {
      await server.close();
      disconnectAppConnector("demo.drawing", context);
    }
  });

  it("budgets large HTTP output as artifact/ref without transcript raw payload", async () => {
    const context = await createConnectorTestContext("default");
    const server = await startMockConnector({ largeOutput: "z".repeat(60_000) });
    try {
      const manifestPath = await writeManifest(context.projectPath, server.baseUrl);
      await connectAppConnector(manifestPath, context);
      const result = await executeCapability(
        { capabilityId: "demo.drawing.describe", input: { subject: "large" }, source: "slash" },
        context,
      );

      expect(result.ok).toBe(true);
      expect(result.artifactRef).toBeTruthy();
      const transcript = JSON.stringify(
        (await context.store.resume(context.sessionId ?? "")).transcript,
      );
      expect(transcript).toContain("tool_result_budget_persisted");
      expect(transcript).not.toContain("z".repeat(30_000));
    } finally {
      await server.close();
      disconnectAppConnector("demo.drawing", context);
    }
  });

  it("disconnects apps and removes registered HTTP capabilities", async () => {
    const context = await createConnectorTestContext("default");
    const server = await startMockConnector();
    try {
      const manifestPath = await writeManifest(context.projectPath, server.baseUrl);
      await connectAppConnector(manifestPath, context);
      expect(disconnectAppConnector("demo.drawing", context)).toBe(true);
      expect(findCapability("demo.drawing.describe", context)).toBeUndefined();
      expect(listAppConnectors(context)).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it("returns diagnostic errors for bad manifest, unreachable baseUrl, and invalid response", async () => {
    const context = await createConnectorTestContext("default");
    const badPath = join(context.projectPath, "bad-manifest.json");
    await writeFile(badPath, JSON.stringify({ appId: "bad" }), "utf8");

    await expect(connectAppConnector(badPath, context)).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("name"),
    });

    const rawSecretPath = await writeManifest(context.projectPath, "http://127.0.0.1:9", {
      auth: { type: "api_key", value: "raw-secret" },
    });
    const rawSecret = await connectAppConnector(rawSecretPath, context);
    expect(rawSecret.ok).toBe(false);
    expect(rawSecret.ok ? "" : rawSecret.error).toContain("auth.value is not allowed");
    expect(rawSecret.ok ? "" : rawSecret.error).not.toContain("raw-secret");

    const unreachablePath = await writeManifest(context.projectPath, "http://127.0.0.1:9");
    await expect(connectAppConnector(unreachablePath, context)).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("connector unreachable"),
    });

    const invalid = await startMockConnector({ invalidCapabilities: true });
    try {
      const manifestPath = await writeManifest(context.projectPath, invalid.baseUrl);
      await expect(connectAppConnector(manifestPath, context)).resolves.toMatchObject({
        ok: false,
        error: expect.stringContaining("remote capabilities response is invalid"),
      });
    } finally {
      await invalid.close();
    }
  });

  it("rejects manifests outside the current project", async () => {
    const context = await createConnectorTestContext("default");
    const outsidePath = join(tmpdir(), `linghun-outside-connector-${Date.now()}.json`);
    await writeFile(
      outsidePath,
      JSON.stringify({
        appId: "outside.demo",
        name: "Outside Demo",
        version: "0.1.0",
        transport: "http",
        baseUrl: "http://127.0.0.1:9",
        auth: { type: "none" },
        capabilities: connectorCapabilities(),
      }),
      "utf8",
    );

    const result = await connectAppConnector(outsidePath, context);

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toContain("inside the current project");
  });

  it("rejects Local HTTP baseUrl userinfo before connecting", async () => {
    const context = await createConnectorTestContext("default");
    const manifestPath = await writeManifest(context.projectPath, "http://user:pass@127.0.0.1:9");

    const result = await connectAppConnector(manifestPath, context);

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toContain("username/password");
    expect(result.ok ? "" : result.error).not.toContain("user:pass");
  });

  it("sanitizes app display metadata and keeps doctor summary out of details", async () => {
    const context = await createConnectorTestContext("default");
    const output = new MemoryOutput();
    const server = await startMockConnector();
    try {
      const manifestPath = await writeManifest(context.projectPath, server.baseUrl, {
        name: "Demo sk-app-secret Authorization: Bearer raw-token",
      });

      await handleAppsCommand(["connect", manifestPath], context, output);
      await handleAppsCommand(["list"], context, output);
      await handleAppsCommand(["doctor"], context, output);

      expect(output.text).toContain("sk-***");
      expect(output.text).toContain("Authorization: ***");
      expect(output.text).not.toContain("sk-app-secret");
      expect(output.text).not.toContain("raw-token");
      expect(formatAppConnectorList(context)).not.toContain("sk-app-secret");
      expect(formatAppConnectorDoctor(context)).not.toContain("raw-token");

      context.isInkSession = true;
      await handleAppsCommand(["doctor"], context, new MemoryOutput());
      const summary = context.commandPanelState?.summary?.join("\n") ?? "";
      expect(summary).not.toContain("Details");
      expect(summary).not.toContain("appId=demo.drawing");
    } finally {
      await server.close();
      disconnectAppConnector("demo.drawing", context);
    }
  });

  it("keeps HTTP capabilities isolated by project context", async () => {
    const contextA = await createConnectorTestContext("default");
    const contextB = await createConnectorTestContext("default");
    const capabilitiesListB = new MemoryOutput();
    const capabilitiesDoctorB = new MemoryOutput();
    const outputB = new MemoryOutput();
    const server = await startMockConnector();
    try {
      const manifestPath = await writeManifest(contextA.projectPath, server.baseUrl);
      await connectAppConnector(manifestPath, contextA);

      expect(findCapability("demo.drawing.describe", contextA)).toBeTruthy();
      expect(listCapabilities(contextA).map((item) => item.id)).toContain("demo.drawing.describe");
      expect(findCapability("demo.drawing.describe", contextB)).toBeUndefined();
      expect(listCapabilities(contextB).map((item) => item.id)).not.toContain(
        "demo.drawing.describe",
      );

      await handleAppsCommand(["doctor"], contextB, outputB);
      expect(outputB.text).not.toContain("demo.drawing.describe");
      expect(outputB.text).not.toContain("connected app Demo Drawing");
      await handleCapabilitiesCommand(["list"], contextB, capabilitiesListB);
      await handleCapabilitiesCommand(["doctor"], contextB, capabilitiesDoctorB);
      expect(capabilitiesListB.text).not.toContain("demo.drawing.describe");
      expect(capabilitiesDoctorB.text).not.toContain("demo.drawing.describe");

      const missing = await executeCapability(
        { capabilityId: "demo.drawing.describe", input: { subject: "B" }, source: "slash" },
        contextB,
      );
      expect(missing.ok).toBe(false);
      expect(missing.summary).toContain("Capability not found");
      expect(contextB.evidence).toHaveLength(0);

      const manifestPathB = await writeManifest(contextB.projectPath, server.baseUrl);
      await connectAppConnector(manifestPathB, contextB);
      expect(findCapability("demo.drawing.describe", contextA)).toBeTruthy();
      expect(findCapability("demo.drawing.describe", contextB)).toBeTruthy();

      expect(disconnectAppConnector("demo.drawing", contextA)).toBe(true);
      expect(findCapability("demo.drawing.describe", contextA)).toBeUndefined();
      expect(findCapability("demo.drawing.describe", contextB)).toBeTruthy();
    } finally {
      await server.close();
      disconnectAppConnector("demo.drawing", contextA);
      disconnectAppConnector("demo.drawing", contextB);
    }
  });
});

type MockConnector = {
  baseUrl: string;
  requests: Array<{ method: string; path: string; authorization?: string; body?: unknown }>;
  close(): Promise<void>;
};

async function startMockConnector(
  options: { invalidCapabilities?: boolean; largeOutput?: string; failPaint?: boolean } = {},
): Promise<MockConnector> {
  const requests: MockConnector["requests"] = [];
  const server = createServer(async (req, res) => {
    const body = await readRequestJson(req);
    requests.push({
      method: req.method ?? "GET",
      path: req.url ?? "",
      authorization: req.headers.authorization,
      body,
    });
    if (req.url === "/linghun/capabilities") {
      sendJson(
        res,
        200,
        options.invalidCapabilities ? { bad: true } : { capabilities: connectorCapabilities() },
      );
      return;
    }
    if (req.url === "/linghun/execute") {
      const input = isRecord(body) && isRecord(body.input) ? body.input : {};
      const capabilityId =
        isRecord(body) && typeof body.capabilityId === "string" ? body.capabilityId : "";
      sendJson(res, 200, {
        ok: !(options.failPaint && capabilityId === "demo.drawing.paint"),
        summary:
          options.failPaint && capabilityId === "demo.drawing.paint"
            ? "paint failed"
            : capabilityId === "demo.drawing.paint"
              ? `Painted ${String(input.title ?? "")}`
              : `Described ${String(input.subject ?? "")}`,
        output: options.largeOutput,
      });
      return;
    }
    sendJson(res, 404, { ok: false, summary: "not found" });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("mock connector address missing");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function readRequestJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function writeManifest(
  projectPath: string,
  baseUrl: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const manifest = {
    appId: "demo.drawing",
    name: "Demo Drawing",
    version: "0.1.0",
    transport: "http",
    baseUrl,
    auth: { type: "none" },
    capabilities: connectorCapabilities(),
    ...overrides,
  };
  const path = join(projectPath, `connector-${Math.random().toString(16).slice(2)}.json`);
  await writeFile(path, JSON.stringify(manifest), "utf8");
  return resolve(path);
}

function connectorCapabilities() {
  return [
    {
      id: "demo.drawing.describe",
      appId: "demo.drawing",
      title: "Describe Drawing",
      description: "Describes a local drawing.",
      category: "drawing",
      intents: ["describe drawing"],
      keywords: ["drawing", "describe"],
      transport: "http",
      auth: "none",
      permission: "read",
      riskLevel: "low",
      inputSchema: { type: "object", required: ["subject"] },
      outputSchema: { type: "object", required: ["summary"] },
      supportsRollback: false,
      supportsPreview: false,
    },
    {
      id: "demo.drawing.paint",
      appId: "demo.drawing",
      title: "Paint Drawing",
      description: "Writes to a local drawing app.",
      category: "drawing",
      intents: ["paint drawing"],
      keywords: ["drawing", "paint"],
      transport: "http",
      auth: "none",
      permission: "external_app",
      riskLevel: "medium",
      inputSchema: { type: "object", required: ["title"] },
      outputSchema: { type: "object", required: ["summary"] },
      supportsRollback: true,
      supportsPreview: true,
    },
  ];
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return Boolean(input && typeof input === "object" && !Array.isArray(input));
}

class MemoryOutput extends Writable {
  text = "";

  override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: () => void): void {
    this.text += chunk.toString();
    callback();
  }
}

async function createConnectorTestContext(
  permissionMode: TuiContext["permissionMode"],
): Promise<TuiContext> {
  const project = await mkdtemp(join(tmpdir(), "linghun-connector-runtime-"));
  const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
  const session = await store.create({ model: "deepseek-chat" });
  const config = defaultConfig;
  return {
    store,
    sessionId: session.id,
    model: session.model,
    permissionMode,
    projectPath: project,
    tools: createToolContext(project),
    permissions: { rules: [], recentDenied: [] },
    language: "zh-CN",
    config,
    backgroundTasks: [],
    checkpoints: [],
    evidence: [],
    cache: createCacheState(project, session.model, [], config),
    mcp: createMcpState(config),
    index: createIndexState(config),
    memory: await createMemoryState(config, project),
    failureLearning: createFailureLearningState(project),
    skills: await createSkillState(config, project),
    workflows: createWorkflowState(config),
    agentRegistry: { agents: [], errors: [] },
    workflowRegistry: { workflows: [], errors: [] },
    hooks: await createHookState(config, project),
    plugins: await createPluginState(config, project),
    remote: createRemoteState(config),
    agents: [],
    roleUsage: [],
    routeDecisions: [],
    roleHandoffs: [],
    visionObservations: [],
    imageResults: [],
    interrupt: { type: "idle" },
    recentlyMentionedFiles: [],
    providerBreaker: createProviderCircuitBreakerState(),
    solutionCompleteness: createSolutionCompletenessStatus(),
    discoveredDeferredToolNames: new Set<string>(),
  };
}
