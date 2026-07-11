import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Lark from "@larksuiteoapi/node-sdk";
import { type LinghunConfig, defaultConfig, getSessionRootDir } from "@linghun/config";
import { SessionStore } from "@linghun/core";
import { createToolContext } from "@linghun/tools";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFailureLearningState } from "./failure-learning-runtime.js";
import { createIndexState } from "./index-runtime.js";
import { startFeishuLongConnection } from "./feishu-long-connection-runtime.js";
import {
  type TuiContext,
  createRemotePairing,
  feishuReceiveMessageToBridgeEvent,
  getRemoteBridgeDoctor,
  handleRemoteInboundMessage,
  processRemoteInbound,
} from "./index.js";
import { createSolutionCompletenessStatus } from "./model-loop-runtime.js";
import { createProviderCircuitBreakerState } from "./provider-circuit-breaker.js";
import {
  clearRemoteCommandRuntime,
  configureRemoteCommandRuntime,
  handleRemoteCommand,
} from "./remote-command-runtime.js";
import {
  createCacheState,
  createHookState,
  createMcpState,
  createPluginState,
  createRemoteState,
  createSkillState,
  createWorkflowState,
} from "./tui-state-runtime.js";

class MemoryOutput {
  text = "";
  write(chunk: string | Uint8Array): boolean {
    this.text += String(chunk);
    return true;
  }
}

describe("Feishu real inbound adapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("long connection close is awaitable and idempotent", async () => {
    const dispatcherInstances: Array<{ handles: Map<string, unknown> }> = [];
    const close = vi.fn();
    const start = vi.fn();
    vi.spyOn(Lark, "EventDispatcher").mockImplementation(function EventDispatcherMock(this: {
      handles: Map<string, unknown>;
      register: (handles: Record<string, unknown>) => unknown;
    }) {
      this.handles = new Map();
      dispatcherInstances.push(this);
      this.register = (handles: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(handles)) {
          this.handles.set(key, value);
        }
        return this;
      };
      return this;
    } as never);
    vi.spyOn(Lark, "WSClient").mockImplementation(function WSClientMock(this: {
      start: () => Promise<void>;
      close: (params?: { force?: boolean }) => void;
    }) {
      this.start = start.mockResolvedValue(undefined);
      this.close = close;
      return this;
    } as never);

    const handle = await startFeishuLongConnection({
      appId: "app-id",
      appSecret: "app-secret",
      onMessage: async () => undefined,
    });

    expect(dispatcherInstances[0]?.handles.has("im.message.receive_v1")).toBe(true);
    await handle.close();
    await handle.close();

    expect(dispatcherInstances[0]?.handles.has("im.message.receive_v1")).toBe(false);
    expect(close).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith({ force: true });
  });

  it("converts im.message.receive_v1 to RemoteInboundMessage without exposing secrets", () => {
    const event = feishuReceiveMessageToBridgeEvent(
      {
        event_id: "evt-feishu-1",
        sender: { sender_id: { open_id: "ou_real_mobile_source" } },
        message: {
          message_id: "om_real_message_id",
          chat_id: "oc_chat",
          chat_type: "group",
          message_type: "text",
          content: '{"text":"状态"}',
        },
      },
      1_700_000_000_000,
    );
    expect(event).toMatchObject({
      platform: "feishu",
      source: "ou_real_mobile_source",
      userId: "ou_real_mobile_source",
      kind: "status_query",
      messageId: "om_real_message_id",
      nonce: "evt-feishu-1",
      signature: "ref:feishu-long-connection",
    });
    expect(JSON.stringify(event)).not.toMatch(/webhook|appSecret|Authorization|Bearer|sk-/i);
  });

  it("allows first-time /bind source through pairing proof, then rejects replay and expired", async () => {
    const { context, output } = await createRemoteTestContext();
    const feishu = context.remote.channels.find((item) => item.id === "feishu");
    if (!feishu) throw new Error("missing feishu");
    const sessionId = context.sessionId ?? "test-session";
    const pairing = createRemotePairing(
      context.remote,
      feishu,
      context.projectPath,
      sessionId,
      Date.now(),
      "MOB123",
    );
    if (pairing.status !== "created") throw new Error("pairing not created");

    const bindEvent = feishuReceiveMessageToBridgeEvent(
      {
        event_id: "evt-bind",
        sender: { sender_id: { open_id: "new-mobile-source" } },
        message: { message_id: "om-bind", content: '{"text":"/bind MOB123"}' },
      },
      Date.now(),
    );
    const bind = await handleRemoteInboundMessage(
      {
        kind: bindEvent.kind,
        channel: "feishu",
        messageId: bindEvent.messageId,
        nonce: bindEvent.nonce,
        source: bindEvent.source,
        bindingUserId: bindEvent.userId,
        signature: bindEvent.signature,
        expiresAt: bindEvent.expiresAt,
        receivedAt: bindEvent.receivedAt,
        origin: "adapter",
        text: bindEvent.text,
      },
      context,
      undefined,
      output as never,
    );
    expect(bind.status).toBe("accepted");
    expect(feishu.config.trustedSources).toContain("new-mobile-source");
    expect(feishu.config.bindingUserId).toBe("new-mobile-source");

    expect(
      processRemoteInbound(context, {
        kind: "natural_language_message",
        channel: "feishu",
        messageId: "om-bind",
        nonce: "evt-bind",
        source: "new-mobile-source",
        bindingUserId: "new-mobile-source",
        signature: "ref:feishu-long-connection",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        origin: "adapter",
        text: "继续",
      }),
    ).toMatchObject({ status: "replayed" });
    expect(
      processRemoteInbound(context, {
        kind: "natural_language_message",
        channel: "feishu",
        messageId: "om-expired",
        nonce: "evt-expired",
        source: "new-mobile-source",
        bindingUserId: "new-mobile-source",
        signature: "ref:feishu-long-connection",
        expiresAt: new Date(1).toISOString(),
        origin: "adapter",
        text: "继续",
      }),
    ).toMatchObject({ status: "expired" });
  });

  it("keeps fixture/mock origins out of real mobile inbound claims", async () => {
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    const bridgeSrc = await import("node:fs/promises").then((fs) =>
      fs.readFile(join(here, "remote-inbound-bridge-runtime.ts"), "utf8"),
    );
    expect(bridgeSrc).toContain('origin: "fixture"');
    expect(bridgeSrc).toContain('origin: "adapter"');
    expect(bridgeSrc).not.toContain("real mobile inbound: PASS");
  });

  it("bridge start blocks when Feishu app env is missing", async () => {
    const { context, output } = await createRemoteTestContext();
    const calls: string[] = [];
    configureRemoteCommandRuntime({
      appendSystemEvent: async () => undefined,
      ensureSession: async () => context.sessionId ?? "test-session",
      handleRemoteInboundMessage: async () => ({
        kind: "status_query",
        status: "accepted",
        summary: "ok",
        evidenceCreated: false,
      }),
      startFeishuLongConnection: async () => {
        calls.push("start");
        return { close: async () => undefined };
      },
    });

    await handleRemoteCommand(["bridge", "start", "feishu"], context, output as never);

    expect(calls).toEqual([]);
    expect(output.text).toContain("missing env");
    expect(output.text).not.toMatch(/appSecret=.*|Bearer|sk-/i);
  });

  it("bridge start uses env refs and routes simulated events into handleRemoteInboundMessage", async () => {
    vi.stubEnv("LINGHUN_REMOTE_FEISHU_APP_ID", "test-app-id");
    vi.stubEnv("LINGHUN_REMOTE_FEISHU_APP_SECRET", "test-app-secret");
    const { context, output } = await createRemoteTestContext();
    const inboundMessages: string[] = [];
    const closeCalls: string[] = [];
    configureRemoteCommandRuntime({
      appendSystemEvent: async () => undefined,
      ensureSession: async () => context.sessionId ?? "test-session",
      handleRemoteInboundMessage: async (message) => {
        inboundMessages.push(message.messageId);
        return {
          kind: message.kind,
          status: "accepted",
          summary: "routed",
          evidenceCreated: false,
        };
      },
      startFeishuLongConnection: async (options) => {
        await options.onMessage({
          kind: "status_query",
          channel: "feishu",
          messageId: "om-simulated",
          nonce: "evt-simulated",
          source: "old-source",
          bindingUserId: "old-user",
          signature: "ref:feishu-long-connection",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          origin: "adapter",
        });
        return { close: async () => void closeCalls.push("closed") };
      },
    });

    await handleRemoteCommand(["bridge", "start", "feishu"], context, output as never);

    expect(inboundMessages).toEqual(["om-simulated"]);
    expect(output.text).toContain("Long connection started");
    expect(output.text).not.toContain("test-app-secret");

    await handleRemoteCommand(["bot", "stop", "feishu"], context, output as never);
    expect(closeCalls).toEqual(["closed"]);
    expect(output.text).toContain("Remote Bot feishu stopped");
  });

  it("Run 3 closure: start smoke passes on start/ready/close without claiming real inbound", async () => {
    vi.stubEnv("LINGHUN_REMOTE_FEISHU_APP_ID", "test-app-id");
    vi.stubEnv("LINGHUN_REMOTE_FEISHU_APP_SECRET", "test-app-secret");
    const { context, output } = await createRemoteTestContext();
    const closeCalls: string[] = [];
    configureRemoteCommandRuntime({
      appendSystemEvent: async () => undefined,
      ensureSession: async () => context.sessionId ?? "test-session",
      handleRemoteInboundMessage: async (message) => ({
        kind: message.kind,
        status: "accepted",
        summary: "routed",
        evidenceCreated: false,
      }),
      startFeishuLongConnection: async () => ({
        close: async () => void closeCalls.push("closed"),
      }),
    });

    await handleRemoteCommand(["bot", "start", "feishu"], context, output as never);
    expect(output.text).toContain("Feishu Bot start readiness");
    expect(output.text).toContain("Long connection started");
    expect(output.text).not.toMatch(/REAL_INBOUND_PASS|real mobile inbound: PASS/i);

    await handleRemoteCommand(["bot", "stop", "feishu"], context, output as never);
    expect(closeCalls).toEqual(["closed"]);
    expect(output.text).toContain("Remote Bot feishu stopped");
  });

  it("keeps 100 same-project Feishu handles isolated by runtime owner", async () => {
    vi.stubEnv("LINGHUN_REMOTE_FEISHU_APP_ID", "test-app-id");
    vi.stubEnv("LINGHUN_REMOTE_FEISHU_APP_SECRET", "test-app-secret");
    const { context: baseContext } = await createRemoteTestContext();
    const contexts = Array.from({ length: 100 }, () => ({
      ...baseContext,
      remote: createRemoteState(baseContext.config),
      evidence: [],
    })) as TuiContext[];
    let starts = 0;
    let closes = 0;
    configureRemoteCommandRuntime({
      appendSystemEvent: async () => undefined,
      ensureSession: async (context) => context.sessionId ?? "test-session",
      handleRemoteInboundMessage: async (message) => ({
        kind: message.kind,
        status: "accepted",
        summary: "routed",
        evidenceCreated: false,
      }),
      startFeishuLongConnection: async () => {
        starts += 1;
        return { close: async () => void (closes += 1) };
      },
    });

    try {
      await Promise.all(
        contexts.map((context) =>
          handleRemoteCommand(["bot", "start", "feishu"], context, new MemoryOutput() as never),
        ),
      );

      expect(starts).toBe(100);
      expect(contexts.every((context) => context.feishuLongConnectionHandle)).toBe(true);
      await clearRemoteCommandRuntime(contexts[0]!);
      expect(contexts[0]?.feishuLongConnectionHandle).toBeUndefined();
      expect(contexts.slice(1).every((context) => context.feishuLongConnectionHandle)).toBe(true);
      expect(closes).toBe(1);
    } finally {
      await Promise.all(contexts.map((context) => clearRemoteCommandRuntime(context)));
    }

    expect(closes).toBe(100);
  }, 30_000);

  it("keeps status and doctor projected from each runtime owner", async () => {
    vi.stubEnv("LINGHUN_REMOTE_FEISHU_APP_ID", "test-app-id");
    vi.stubEnv("LINGHUN_REMOTE_FEISHU_APP_SECRET", "test-app-secret");
    const { context: runningContext } = await createRemoteTestContext();
    const stoppedContext = {
      ...runningContext,
      remote: createRemoteState(runningContext.config),
      feishuLongConnectionHandle: undefined,
    } as TuiContext;
    runningContext.feishuLongConnectionHandle = { close: async () => undefined };
    const runningStatus = new MemoryOutput();
    const stoppedStatus = new MemoryOutput();
    const runningDoctor = new MemoryOutput();
    const stoppedDoctor = new MemoryOutput();

    await handleRemoteCommand(["status"], runningContext, runningStatus as never);
    await handleRemoteCommand(["status"], stoppedContext, stoppedStatus as never);
    await handleRemoteCommand(["doctor"], runningContext, runningDoctor as never);
    await handleRemoteCommand(["doctor"], stoppedContext, stoppedDoctor as never);

    expect(runningStatus.text).toContain("feishu bot owner: running");
    expect(stoppedStatus.text).toContain("feishu bot owner: bound/ready");
    expect(runningDoctor.text).toContain("bot owner: running");
    expect(stoppedDoctor.text).toContain("bot owner: bound/ready");
  });

  it("keeps a started handle authoritative when audit persistence fails", async () => {
    vi.stubEnv("LINGHUN_REMOTE_FEISHU_APP_ID", "test-app-id");
    vi.stubEnv("LINGHUN_REMOTE_FEISHU_APP_SECRET", "test-app-secret");
    const { context, output } = await createRemoteTestContext();
    const close = vi.fn(async () => undefined);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    configureRemoteCommandRuntime({
      appendSystemEvent: async () => {
        throw new Error("audit unavailable");
      },
      ensureSession: async () => context.sessionId ?? "test-session",
      startFeishuLongConnection: async () => ({ close }),
    });

    await handleRemoteCommand(["bot", "start", "feishu"], context, output as never);

    expect(output.text).toContain("Feishu Bot started");
    expect(context.feishuLongConnectionHandle).toBeDefined();
    expect(close).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining("remote_bridge_start_audit_failed channel=feishu"),
    );
    await clearRemoteCommandRuntime(context);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent starts through the same runtime handle owner", async () => {
    vi.stubEnv("LINGHUN_REMOTE_FEISHU_APP_ID", "test-app-id");
    vi.stubEnv("LINGHUN_REMOTE_FEISHU_APP_SECRET", "test-app-secret");
    const { context } = await createRemoteTestContext();
    let releaseStart!: () => void;
    const startGate = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    const close = vi.fn(async () => undefined);
    const start = vi.fn(async () => {
      await startGate;
      return { close };
    });
    configureRemoteCommandRuntime({
      appendSystemEvent: async () => undefined,
      ensureSession: async () => context.sessionId ?? "test-session",
      startFeishuLongConnection: start,
    });
    const firstOutput = new MemoryOutput();
    const secondOutput = new MemoryOutput();

    const first = handleRemoteCommand(["bot", "start", "feishu"], context, firstOutput as never);
    const second = handleRemoteCommand(["bot", "start", "feishu"], context, secondOutput as never);
    releaseStart();
    await Promise.all([first, second]);

    expect(start).toHaveBeenCalledTimes(1);
    expect(firstOutput.text).toContain("Feishu Bot started");
    expect(secondOutput.text).toContain("already running");
    await clearRemoteCommandRuntime(context);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("does not restore a rejected pending start after runtime cleanup", async () => {
    vi.stubEnv("LINGHUN_REMOTE_FEISHU_APP_ID", "test-app-id");
    vi.stubEnv("LINGHUN_REMOTE_FEISHU_APP_SECRET", "test-app-secret");
    const { context } = await createRemoteTestContext();
    let rejectStart!: (error: Error) => void;
    const startGate = new Promise<never>((_resolve, reject) => {
      rejectStart = reject;
    });
    const start = vi.fn(async () => startGate);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    configureRemoteCommandRuntime({
      appendSystemEvent: async () => undefined,
      ensureSession: async () => context.sessionId ?? "test-session",
      startFeishuLongConnection: start,
    });

    const starting = handleRemoteCommand(
      ["bot", "start", "feishu"],
      context,
      new MemoryOutput() as never,
    );
    const clearing = clearRemoteCommandRuntime(context);
    rejectStart(new Error("connection rejected"));

    await expect(Promise.all([starting, clearing])).resolves.toBeDefined();
    expect(context.feishuLongConnectionHandle).toBeUndefined();
    expect(start).toHaveBeenCalledTimes(1);
    expect(stderr).not.toHaveBeenCalledWith(expect.stringContaining("remote_bridge_start_audit_failed"));

    configureRemoteCommandRuntime({
      appendSystemEvent: async () => undefined,
      ensureSession: async () => context.sessionId ?? "test-session",
      startFeishuLongConnection: async () => ({ close: async () => undefined }),
    });
    await handleRemoteCommand(
      ["bot", "start", "feishu"],
      context,
      new MemoryOutput() as never,
    );
    expect(context.feishuLongConnectionHandle).toBeDefined();
    await clearRemoteCommandRuntime(context);
  });

  it("doctor treats Feishu long connection as ready-to-start without callback verification refs", async () => {
    const { context } = await createRemoteTestContext();
    const report = getRemoteBridgeDoctor(context.remote, "feishu");

    expect(report.readiness).toBe("ready-to-start");
    expect(report.missing).not.toContain("callback verification refs");
    expect(report.nextAction).toBe("/remote bridge start feishu");
  });

  it("doctor keeps webhook notification-only", async () => {
    const { context } = await createRemoteTestContext({
      transport: "webhook",
      endpoint: "https://example.invalid/hook",
      inboundMode: "none",
    });
    const report = getRemoteBridgeDoctor(context.remote, "feishu");

    expect(report.readiness).toBe("notification-only");
    expect(report.capabilities).toEqual(["notification-only"]);
  });
});

async function createRemoteTestContext(
  feishuOverrides: Partial<NonNullable<LinghunConfig["remote"]["channels"]["feishu"]>> = {},
): Promise<{ context: TuiContext; output: MemoryOutput }> {
  const project = await mkdtemp(join(tmpdir(), "linghun-feishu-remote-"));
  const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath: project });
  const session = await store.create({ model: "deepseek-v4-flash" });
  const config: LinghunConfig = {
    ...defaultConfig,
    remote: {
      enabled: true,
      channels: {
        ...defaultConfig.remote.channels,
        feishu: {
          ...defaultConfig.remote.channels.feishu,
          enabled: true,
          transport: "official_cli",
          cliPath: "node",
          inboundMode: "callback",
          appIdRef: "LINGHUN_REMOTE_FEISHU_APP_ID",
          appSecretRef: "LINGHUN_REMOTE_FEISHU_APP_SECRET",
          signingSecretRef: "LINGHUN_REMOTE_FEISHU_INBOUND_PROOF",
          callbackEndpoint: "feishu-long-connection",
          bindingUserId: "old-user",
          trustedSources: ["old-source"],
          ...feishuOverrides,
        },
      },
    },
  };
  const context: TuiContext = {
    store,
    sessionId: session.id,
    model: session.model,
    permissionMode: session.permissionMode,
    projectPath: project,
    tools: createToolContext(project),
    permissions: { rules: [], recentDenied: [] },
    language: "zh-CN",
    config,
    backgroundTasks: [],
    checkpoints: [],
    evidence: [],
    cache: createCacheState(project, session.model),
    mcp: createMcpState(config),
    index: createIndexState(config),
    memory: {
      projectRulesPath: join(project, "LINGHUN.md"),
      projectRulesExists: false,
      projectRulesSummary: "missing",
      projectDir: join(project, ".linghun", "memory"),
      userDir: join(project, ".user-memory"),
      sessionDir: join(project, ".linghun", "memory", "session"),
      candidates: [],
      accepted: [],
      rejected: [],
      disabled: [],
      retired: [],
      learningMode: "off",
    },
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
    lastProviderFailure: undefined,
    providerBreaker: createProviderCircuitBreakerState(),
    solutionCompleteness: createSolutionCompletenessStatus(),
    discoveredDeferredToolNames: new Set<string>(),
  };
  return { context, output: new MemoryOutput() };
}
