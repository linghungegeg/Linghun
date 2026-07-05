import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { defaultConfig } from "@linghun/config";
import { SessionStore } from "@linghun/core";
import type { ModelGateway, ModelMessage } from "@linghun/providers";
import { createToolContext } from "@linghun/tools";
import { describe, expect, it } from "vitest";
import type { CompactBoundary } from "./compact-context.js";
import {
  getProviderContextMaxChars,
  inspectToolPairingSafety,
  prepareMessagesForProviderPreflight,
  sanitizeCompactSummaryText,
} from "./compact-preflight-runtime.js";
import { executeBreakCacheMutation, getCurrentFreshness, refreshCacheFreshness } from "./compact-cache-command-runtime.js";
import { createCacheState, createMemoryState, createMcpState, createRemoteState } from "./tui-state-runtime.js";
import { createIndexState } from "./index-runtime.js";
import { createFailureLearningState } from "./failure-learning-runtime.js";
import { createSolutionCompletenessStatus } from "./model-loop-runtime.js";
import { createProviderCircuitBreakerState } from "./provider-circuit-breaker.js";
import {
  captureFailureLearning,
  recordProviderFailureEvidence,
  recordVerificationEvidence,
} from "./evidence-runtime.js";
import {
  createDeepCompactPacket,
  maybeRunDeepCompactBeforeProvider,
  runDeepCompact,
  shouldRunDeepCompact,
} from "./deep-compact-runtime.js";
import { breakCacheTestHooks } from "./break-cache-runtime.js";
import { hydrateResumeContext, loadOrCreateHandoffPacket } from "./handoff-session-runtime.js";
import { runMcpStdioToolCall } from "./mcp-stdio-runtime.js";
import type { TuiContext } from "./tui-context-runtime.js";
import type { VerificationReport } from "./tui-data-types.js";

describe("Phase E MCP stdio runtime coverage", () => {
  it("covers tools/call ok, tool-not-found, timeout, and spawn error paths", async () => {
    const okServer = await createMcpServerScript(`
      const readline = require("node:readline");
      const rl = readline.createInterface({ input: process.stdin });
      rl.on("line", (line) => {
        const req = JSON.parse(line);
        if (req.method === "initialize") console.log(JSON.stringify({ jsonrpc: "2.0", id: req.id, result: { ok: true } }));
        if (req.method === "tools/list") console.log(JSON.stringify({ jsonrpc: "2.0", id: req.id, result: { tools: [{ name: "demo_tool" }] } }));
        if (req.method === "tools/call") console.log(JSON.stringify({ jsonrpc: "2.0", id: req.id, result: { content: [{ type: "text", text: "ok" }] } }));
      });
    `);
    const ok = await runMcpStdioToolCall(okServer, "demo_tool", { x: 1 }, okServer.cwd, 5_000);
    expect(ok).toMatchObject({ ok: true, summary: "tools/call demo_tool ok" });

    const missing = await runMcpStdioToolCall(okServer, "missing_tool", {}, okServer.cwd, 5_000);
    expect(missing).toMatchObject({ ok: false, errorCode: "MCP_TOOL_NOT_FOUND" });

    const timeoutServer = await createMcpServerScript(`
      setTimeout(() => {}, 10_000);
    `);
    const timeout = await runMcpStdioToolCall(
      timeoutServer,
      "demo_tool",
      {},
      timeoutServer.cwd,
      50,
    );
    expect(timeout).toMatchObject({ ok: false, errorCode: "ETIMEDOUT" });

    const spawnError = await runMcpStdioToolCall(
      { command: "__linghun_missing_mcp_command__", args: [] },
      "demo_tool",
      {},
      okServer.cwd,
      200,
    );
    expect(spawnError.ok).toBe(false);
  });
});

describe("Phase E compact preflight and deep compact coverage", () => {
  it("covers tool pairing safety and compact cooldown/blocking branches", async () => {
    const context = await createTestContext();
    const deps = compactDeps();
    const unsafe: ModelMessage[] = [
      { role: "assistant", content: "", toolCalls: [{ id: "tc1", name: "Read", input: {} }] },
    ];
    expect(inspectToolPairingSafety(unsafe)).toMatchObject({ safe: false, pending: 1 });

    context.cache.compactCooldownUntil = Date.now() + 60_000;
    const blocked = await prepareMessagesForProviderPreflight({
      messages: [
        { role: "system", content: "s" },
        { role: "user", content: "x".repeat(getProviderContextMaxChars(context, runtime()) + 10) },
      ],
      context,
      sessionId: context.sessionId ?? "session",
      runtime: runtime(),
      trigger: "request",
      deps,
    });
    expect(blocked.blocked).toBe(true);
    if (blocked.blocked) {
      expect(blocked.message).toContain("冷却");
    }

    context.cache.compactCooldownUntil = undefined;
    const unsafeBlocked = await prepareMessagesForProviderPreflight({
      messages: unsafe,
      context,
      sessionId: context.sessionId ?? "session",
      runtime: runtime(),
      trigger: "request",
      deps,
    });
    expect(unsafeBlocked.blocked).toBe(false);

    expect(sanitizeCompactSummaryText(context, `${context.projectPath}\\secret sk-abc123`, 200)).not.toContain(
      "sk-abc123",
    );
  });

  it("covers deep compact should-run, success, tool_use failure, and missing gateway paths", async () => {
    const context = await createTestContext();
    const sessionId = context.sessionId ?? "session";
    await context.store.appendEvent(sessionId, {
      type: "user_message",
      id: "u1",
      text: "hello",
      createdAt: new Date().toISOString(),
    });
    expect(shouldRunDeepCompact(context, [], "manual")).toBe(true);
    await expect(
      maybeRunDeepCompactBeforeProvider({
        context,
        sessionId,
        runtime: runtime(),
        trigger: "request",
        deps: deepDeps(),
      }),
    ).resolves.toMatchObject({ ok: false });

    const success = await runDeepCompact({
      context,
      sessionId,
      transcript: [
        { type: "user_message", id: "u1", text: "goal", createdAt: new Date().toISOString() },
      ],
      runtime: runtime(),
      trigger: "manual",
      gateway: gateway([{ type: "assistant_text_delta", text: "summary", id: "a1" }]),
      deps: deepDeps(),
    });
    expect(success.ok).toBe(true);
    if (success.ok) expect(context.cache.deepCompact?.id).toBe(success.packet.id);

    const cancelledController = new AbortController();
    cancelledController.abort();
    const cancelled = await runDeepCompact({
      context: await createTestContext(),
      sessionId,
      transcript: [],
      runtime: runtime(),
      trigger: "manual",
      gateway: gateway([{ type: "assistant_text_delta", text: "late summary", id: "a2" }]),
      signal: cancelledController.signal,
      deps: deepDeps(),
    });
    expect(cancelled).toMatchObject({ ok: false });
    if (!cancelled.ok) expect(cancelled.message).toContain("取消");

    const toolUseFailure = await runDeepCompact({
      context: await createTestContext(),
      sessionId,
      transcript: [],
      runtime: runtime(),
      trigger: "manual",
      gateway: gateway([{ type: "tool_use", id: "tc", name: "Read", input: {} }]),
      deps: deepDeps(),
    });
    expect(toolUseFailure).toMatchObject({ ok: false });

    const packet = createDeepCompactPacket({
      context,
      transcript: [],
      summary: `${context.projectPath} Bearer raw-token`,
      runtime: runtime(),
      trigger: "manual",
    });
    expect(packet.summary).not.toContain("raw-token");
    expect(packet.summary).not.toContain(context.projectPath);
  });
});

describe("Phase E evidence, compact-cache, break-cache, and handoff coverage", () => {
  it("records provider failure, failure learning, and verification evidence", async () => {
    const context = await createTestContext();
    const sessionId = context.sessionId ?? "session";
    await recordProviderFailureEvidence(
      context,
      sessionId,
      Object.assign(new Error("eventstream CRC mismatch sk-secret endpoint=https://api.example.com/v1/messages?api_key=raw-token content-type=text/html"), {
        code: "PROVIDER_STREAM_ERROR",
        status: 502,
      }),
      {
        role: "executor",
        provider: "deepseek",
        model: "deepseek-chat",
        endpointProfile: "chat_completions",
        reasoningStatus: "off",
        reasoningSent: false,
      },
    );
    expect(context.lastProviderFailure?.kind).toBe("transit");
    expect(context.lastProviderFailure?.endpointSummary).toBe("https://api.example.com/v1/messages");
    expect(context.lastProviderFailure?.httpStatus).toBe(502);
    expect(context.lastProviderFailure?.contentType).toBe("text/html");
    expect(context.evidence[0]?.summary).toContain("status 502");
    expect(context.evidence[0]?.summary).toContain("content-type text/html");
    expect(context.evidence[0]?.summary).not.toContain("sk-secret");
    expect(context.evidence[0]?.summary).not.toContain("raw-token");

    await captureFailureLearning(context, sessionId, {
      category: "tool_failure",
      failureSummary: "Read failed",
      rootCauseGuess: "missing file",
      avoidNextTime: "check file exists",
      sourceRef: "tool:Read",
      relatedTarget: "Read",
      severity: "medium",
    });
    expect(context.lastToolFailure?.toolName).toBe("Read");

    await recordVerificationEvidence(context, sessionId, verificationReport("fail"));
    expect(context.evidence[0]?.supportsClaims).toContain("未通过验证");
    await recordVerificationEvidence(context, sessionId, verificationReport("pass"));
    expect(context.evidence[0]?.supportsClaims).toContain("verification_passed");
  });

  it("refreshes freshness, executes break-cache mutations, and consumes request fields safely", async () => {
    const context = await createTestContext();
    context.permissionMode = "full-access";
    const before = getCurrentFreshness(context);
    context.model = "changed-model";
    refreshCacheFreshness(context);
    expect(context.cache.lastFreshness?.modelProviderHash).not.toBe(before.modelProviderHash);

    const output = new MemoryOutput();
    await executeBreakCacheMutation("once", context, output);
    const once = await breakCacheTestHooks.buildPromptCacheFields(
      context.projectPath,
      true,
      "1h",
    );
    expect(once.promptCacheEnabled).toBe(true);
    expect(once.promptCacheTtl).toBe("1h");
    expect(once.cacheBreakNonce).toBeTruthy();
    expect((await breakCacheTestHooks.buildPromptCacheFields(context.projectPath, true, "1h")).cacheBreakNonce).toBeUndefined();

    await executeBreakCacheMutation("always", context, output);
    const alwaysA = await breakCacheTestHooks.buildPromptCacheFields(context.projectPath, true, "5m");
    const alwaysB = await breakCacheTestHooks.buildPromptCacheFields(context.projectPath, true, "5m");
    expect(alwaysA.cacheBreakNonce).toBe(alwaysB.cacheBreakNonce);
    await executeBreakCacheMutation("clear", context, output);
    expect(breakCacheTestHooks.readMarker(context.projectPath).mode).toBe("off");
  });

  it("hydrates resume context and loads or creates a bounded handoff packet", async () => {
    const context = await createTestContext();
    hydrateResumeContext(context, [
      {
        type: "todo_update",
        items: [{ id: "todo-1", content: "continue", status: "pending" }],
        createdAt: new Date().toISOString(),
      },
      {
        type: "verification_end",
        report: verificationReport("pass"),
        createdAt: new Date().toISOString(),
      },
      {
        type: "evidence_record",
        id: "ev-1",
        kind: "command_output",
        summary: "summary",
        source: "src/a.ts",
        supportsClaims: ["claim"],
        createdAt: new Date().toISOString(),
      },
      {
        type: "handoff_packet",
        packet: {
          id: "handoff-1",
          sessionId: "session-old",
          projectPath: context.projectPath,
          currentPhase: "Beta readiness blocked until explicit user confirmation",
          nextPhase: "Real-project Beta",
          phaseStatus: "blocked",
          goal: "Beta readiness",
          completed: ["Beta readiness evidence guard"],
          pending: [],
          mustNotDo: ["Do not claim completion"],
          todos: [],
          keyFiles: [],
          changedFiles: [],
          evidenceRefs: [],
          verdictEvidence: {
            scope: "beta",
            status: "PARTIAL",
            evidenceRefs: [],
            validationCommands: [],
            uncoveredItems: [],
            residualRisks: [],
            nextAction: "blocked",
          },
          verification: null,
          risks: [],
          indexStatus: { status: "ready" },
          permissionMode: "default",
          modelProvider: { provider: "deepseek", model: "deepseek-chat" },
          recentCommit: "unknown",
          budgetUsage: "unknown",
          createdAt: new Date().toISOString(),
          generatedBy: "test",
        },
        createdAt: new Date().toISOString(),
      },
    ]);
    expect(context.tools.todos[0]?.content).toBe("continue");
    expect(context.lastVerification?.status).toBe("pass");
    expect(context.evidence[0]?.id).toBe("ev-1");
    expect(context.memory.lastHandoff?.currentPhase).toBe("Session handoff");

    const packet = await loadOrCreateHandoffPacket(context, "parent-session");
    expect(packet.id).toBe("handoff-1");
    expect(packet.solutionCompleteness).toBe(context.solutionCompleteness);

    context.memory.lastHandoff = undefined;
    const created = await loadOrCreateHandoffPacket(context, "parent-session", context.sessionId);
    expect(created.evidenceRefs.length).toBeGreaterThan(0);
    expect(created.keyFiles).toContain("src/a.ts");
  });
});

async function createMcpServerScript(source: string): Promise<{ command: string; args: string[]; cwd: string }> {
  const cwd = await mkdtemp(join(tmpdir(), "linghun-phase-e-mcp-"));
  const script = join(cwd, "server.cjs");
  await writeFile(script, source, "utf8");
  return { command: process.execPath, args: [script], cwd };
}

function runtime() {
  return {
    role: "executor" as const,
    provider: "deepseek",
    model: "deepseek-chat",
    endpointProfile: "chat_completions" as const,
    reasoningStatus: "off",
    reasoningSent: false,
  };
}

function gateway(events: unknown[]): ModelGateway {
  return {
    async *stream() {
      for (const event of events) yield event as never;
    },
  } as unknown as ModelGateway;
}

function compactDeps() {
  return {
    appendSystemEvent: async () => undefined,
    captureFailureLearning: async () => undefined,
    recordToolResultBudgetEvidence: async () => undefined,
    refreshCacheFreshness: (context: TuiContext) => refreshCacheFreshness(context),
  };
}

function deepDeps() {
  return {
    appendSystemEvent: async () => undefined,
    captureFailureLearning: async () => undefined,
    refreshCacheFreshness: (context: TuiContext) => refreshCacheFreshness(context),
    recordCompactBoundary: (context: TuiContext, boundary: CompactBoundary) => {
      context.cache.compacted = true;
      context.cache.compactBoundaries.push(boundary);
    },
  };
}

function verificationReport(status: VerificationReport["status"]): VerificationReport {
  return {
    id: `verify-${status}`,
    status,
    summary: `${status} summary`,
    commands: [
      {
        kind: "test",
        command: "pnpm test",
        reason: "focused",
        status: status === "pass" ? "pass" : "fail",
        exitCode: status === "pass" ? 0 : 1,
        durationMs: 1,
        summary: `${status} command`,
      },
    ],
    unverified: [],
    risk: [],
    logPath: "logs/verify.log",
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    durationMs: 1,
    nextAction: "none",
  };
}

async function createTestContext(): Promise<TuiContext> {
  const projectPath = await mkdtemp(join(tmpdir(), "linghun-phase-e-context-"));
  const store = new SessionStore({ projectPath, sessionRootDir: join(projectPath, ".sessions") });
  const session = await store.create({ model: "deepseek-chat" });
  const memory = await createMemoryState(defaultConfig, projectPath);
  return {
    store,
    sessionId: session.id,
    model: "deepseek-chat",
    permissionMode: "default",
    projectPath,
    tools: createToolContext(projectPath),
    permissions: { rules: [], recentDenied: [] },
    language: "zh-CN",
    config: defaultConfig,
    backgroundTasks: [],
    checkpoints: [],
    evidence: [],
    cache: createCacheState(projectPath, "deepseek-chat", [], defaultConfig),
    mcp: createMcpState(defaultConfig),
    index: createIndexState(defaultConfig),
    memory,
    failureLearning: createFailureLearningState(projectPath, defaultConfig),
    skills: { enabled: false, skills: [], errors: [] },
    workflows: { templates: [], activeRun: undefined, history: [] },
    agentRegistry: { agents: [], errors: [] },
    workflowRegistry: { workflows: [], errors: [] },
    hooks: { enabled: false, hooks: [], errors: [] },
    plugins: { enabled: false, plugins: [], errors: [] },
    remote: createRemoteState(defaultConfig),
    agents: [],
    roleUsage: [],
    routeDecisions: [],
    roleHandoffs: [],
    visionObservations: [],
    imageResults: [],
    interrupt: { type: "idle" },
    recentlyMentionedFiles: [],
    solutionCompleteness: createSolutionCompletenessStatus(),
    discoveredDeferredToolNames: new Set<string>(),
    providerBreaker: createProviderCircuitBreakerState(),
  } as unknown as TuiContext;
}

class MemoryOutput extends Writable {
  text = "";

  override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: () => void): void {
    this.text += chunk.toString();
    callback();
  }
}
