import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { defaultConfig } from "@linghun/config";
import { SessionStore } from "@linghun/core";
import type { ModelGateway, ModelMessage } from "@linghun/providers";
import { createToolContext } from "@linghun/tools";
import { describe, expect, it } from "vitest";
import { breakCacheTestHooks } from "./break-cache-runtime.js";
import {
  executeBreakCacheMutation,
  getCurrentFreshness,
  refreshCacheFreshness,
} from "./compact-cache-command-runtime.js";
import type { CompactBoundary } from "./compact-context.js";
import {
  getAutoCompactTriggerChars,
  getPostCompactTargetChars,
  getProviderContextMaxChars,
  inspectToolPairingSafety,
  prepareMessagesForProviderPreflight,
  sanitizeCompactSummaryText,
} from "./compact-preflight-runtime.js";
import { estimateModelMessageChars } from "./context-estimator.js";
import {
  DEEP_COMPACT_EVENT_TYPE,
  createDeepCompactPacket,
  maybeRunDeepCompactBeforeProvider,
  runDeepCompact,
  shouldRunDeepCompact,
} from "./deep-compact-runtime.js";
import {
  captureFailureLearning,
  recordProviderFailureEvidence,
  recordVerificationEvidence,
} from "./evidence-runtime.js";
import { createFailureLearningState } from "./failure-learning-runtime.js";
import { hydrateResumeContext, loadOrCreateHandoffPacket } from "./handoff-session-runtime.js";
import { createIndexState } from "./index-runtime.js";
import { runMcpStdioToolCall } from "./mcp-stdio-runtime.js";
import { createSolutionCompletenessStatus } from "./model-loop-runtime.js";
import { createProviderCircuitBreakerState } from "./provider-circuit-breaker.js";
import type { TuiContext } from "./tui-context-runtime.js";
import type {
  AgentRun,
  BackgroundTaskState,
  CompactProjection,
  RoleRouteDecision,
  VerificationReport,
} from "./tui-data-types.js";
import {
  createCacheState,
  createMcpState,
  createMemoryState,
  createRemoteState,
} from "./tui-state-runtime.js";

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
  it("locks auto compact trigger thresholds and provider preflight boundaries", async () => {
    const context = await createTestContext();

    setExecutorMaxInputTokens(context, 399_999);
    expect(getAutoCompactTriggerChars(context, runtime()) / 4).toBe(386_999);

    setExecutorMaxInputTokens(context, 400_000);
    expect(getAutoCompactTriggerChars(context, runtime()) / 4).toBe(370_000);

    setExecutorMaxInputTokens(context, 800_000);
    expect(getAutoCompactTriggerChars(context, runtime()) / 4).toBe(750_000);

    setExecutorMaxInputTokens(context, 1_000_000);
    expect(getAutoCompactTriggerChars(context, runtime()) / 4).toBe(950_000);

    setExecutorMaxInputTokens(context, 20_000);
    expect(getPostCompactTargetChars(context, runtime()) / 4).toBe(6_000);

    setExecutorMaxInputTokens(context, 200_000);
    expect(getPostCompactTargetChars(context, runtime()) / 4).toBe(60_000);

    setExecutorMaxInputTokens(context, 1_000_000);
    expect(getPostCompactTargetChars(context, runtime()) / 4).toBe(80_000);

    setExecutorMaxInputTokens(context, 20_000);
    context.tools.todos = [
      { id: "todo-restore", content: "keep the latest request", status: "pending" },
    ];
    context.tools.changedFiles = ["src/changed.ts"];
    context.recentlyMentionedFiles = ["src/mentioned.ts"];
    context.evidence = [
      {
        id: "ev-restore",
        kind: "file_read",
        summary: "read src/mentioned.ts",
        source: "src/mentioned.ts",
        supportsClaims: ["code_fact"],
        createdAt: new Date().toISOString(),
      },
    ];
    context.memory.accepted = [
      {
        id: "mem-user",
        scope: "user",
        status: "accepted",
        taxonomy: "user",
        summary:
          "User prefers evidence-bound implementation notes with token=SECRET_TOKEN redacted",
        source: "test",
        sourceRefs: [],
        risk: "low",
        inferred: false,
        createdAt: new Date().toISOString(),
      },
    ];
    const deps = compactDeps();
    const triggerChars = getAutoCompactTriggerChars(context, runtime());
    const belowTrigger: ModelMessage[] = [
      { role: "system", content: "s" },
      { role: "user", content: "x".repeat(triggerChars - 2) },
    ];

    const below = await prepareMessagesForProviderPreflight({
      messages: belowTrigger,
      context,
      sessionId: context.sessionId ?? "session",
      runtime: runtime(),
      trigger: "request",
      deps,
    });
    expect(below.blocked).toBe(false);
    if (!below.blocked) expect(below.messages).toEqual(belowTrigger);
    expect(context.cache.compactProjection).toBeUndefined();
    expect(context.cache.compactStrategy?.steps.map((step) => step.layer)).toEqual([
      "payload_trim",
      "semantic_deep",
      "full_summary",
    ]);
    expect(context.cache.compactStrategy?.steps.at(-1)).toMatchObject({
      layer: "full_summary",
      status: "skipped",
    });

    const oldOversized = "OVERSIZED_OLD_CONTEXT".repeat(1_600);
    const overLimit: ModelMessage[] = [
      { role: "system", content: "s" },
      { role: "user", content: oldOversized },
      { role: "assistant", content: oldOversized },
      { role: "user", content: oldOversized },
      { role: "user", content: "keep the latest request" },
    ];
    expect(estimateModelMessageChars(overLimit)).toBeGreaterThan(
      getProviderContextMaxChars(context, runtime()),
    );

    const compacted = await prepareMessagesForProviderPreflight({
      messages: overLimit,
      context,
      sessionId: context.sessionId ?? "session",
      runtime: runtime(),
      trigger: "request",
      deps,
    });

    expect(compacted.blocked).toBe(false);
    if (!compacted.blocked) {
      expect(estimateModelMessageChars(compacted.messages)).toBeLessThanOrEqual(
        context.cache.compactProjection?.postCompactTargetChars ?? Number.POSITIVE_INFINITY,
      );
      expect(compacted.messages.map((message) => message.content).join("\n")).not.toContain(
        "OVERSIZED_OLD_CONTEXT",
      );
    }
    expect(context.cache.compactProjection?.preCompactChars).toBeGreaterThan(
      context.cache.compactProjection?.postCompactChars ?? 0,
    );
    expect(context.cache.compactProjection?.postCompactTargetChars).toBe(
      getPostCompactTargetChars(context, runtime()),
    );
    expect(context.cache.compactProjection?.savingsRatio).toBeGreaterThan(0);
    expect(context.cache.compactProjection?.replacementKind).toBe("provider-visible");
    expect(context.cache.compactProjection?.replacedMessageCount).toBe(
      overLimit.length - (compacted.blocked ? 0 : compacted.messages.length - 1),
    );
    expect(context.cache.compactProjection?.replacementMessageCount).toBeGreaterThan(0);
    expect(context.cache.compactProjection?.acceptance).toMatchObject({
      budget: "hit",
      replacementProjection: "active",
      terminalVisibleProjection: "unknown",
      uiNotice: "quiet-success",
      rollback: "available",
      featureFlags: {
        replacementProjection: true,
        terminalVisibleProjection: true,
        retainedBudget: true,
      },
    });
    expect(context.cache.compactProjection?.progress).toMatchObject({
      status: "complete",
      stages: [
        "scan_context",
        "generate_summary",
        "trim_old_records",
        "restore_context",
        "complete",
      ],
    });
    expect(context.cache.compactProjection?.restoreContext).toMatchObject({
      currentTask: "keep the latest request",
      keyFiles: expect.arrayContaining(["src/mentioned.ts", "src/changed.ts"]),
      changedFiles: ["src/changed.ts"],
      evidenceRefs: ["ev-restore"],
    });
    expect(context.cache.compactProjection?.restoreContext?.pendingItems).toContain(
      "todo:pending:keep the latest request",
    );
    expect(
      context.cache.compactProjection?.restoreContext?.userConstraints.join("\n"),
    ).not.toContain("SECRET_TOKEN");
    if (!compacted.blocked) {
      const compactMessage = compacted.messages.map((message) => message.content).join("\n");
      expect(compactMessage).toContain("[Context restore metadata]");
      expect(compactMessage).toContain('"currentTask":"keep the latest request"');
      expect(compactMessage).toContain('"keyFiles":["src/mentioned.ts","src/changed.ts"]');
    }
    expect(context.cache.compactProjection?.summary).toContain("target budget tokens");
    expect(context.cache.compactProjection?.progress?.targetChars).toBe(
      context.cache.compactProjection?.postCompactTargetChars,
    );
    expect(context.cache.compactProjection?.progress?.savingsRatio).toBe(
      context.cache.compactProjection?.savingsRatio,
    );
    expect(context.cache.compactStrategy?.cacheStablePrefixRisk).toBe("medium");
    expect(context.cache.compactStrategy?.steps).toContainEqual(
      expect.objectContaining({ layer: "full_summary", status: "applied" }),
    );
  });

  it("can roll back provider-visible replacement projection with a feature flag", async () => {
    const context = await createTestContext();
    context.config = {
      ...context.config,
      features: { compactReplacementProjection: false },
    } as typeof defaultConfig & { features: { compactReplacementProjection: boolean } };
    setExecutorMaxInputTokens(context, 20_000);
    const oldOversized = "LEGACY_ROLLBACK_CONTEXT".repeat(1_600);
    const messages: ModelMessage[] = [
      { role: "system", content: "s" },
      { role: "user", content: oldOversized },
      { role: "assistant", content: oldOversized },
      { role: "user", content: oldOversized },
      { role: "user", content: "keep latest after rollback" },
    ];

    const compacted = await prepareMessagesForProviderPreflight({
      messages,
      context,
      sessionId: context.sessionId ?? "session",
      runtime: runtime(),
      trigger: "request",
      deps: compactDeps(),
    });

    expect(compacted.blocked).toBe(false);
    expect(context.cache.compactProjection?.acceptance).toMatchObject({
      replacementProjection: "disabled",
      rollback: "active",
      featureFlags: {
        replacementProjection: false,
        terminalVisibleProjection: true,
        retainedBudget: true,
      },
    });
    expect(context.cache.compactStrategy?.steps).toContainEqual(
      expect.objectContaining({
        layer: "full_summary",
        status: "applied",
        reason: "legacy_compacted_window_feature_flag",
      }),
    );
    if (!compacted.blocked) {
      const text = compacted.messages.map((message) => message.content).join("\n");
      expect(text).not.toContain("Context compact projection");
      expect(text).not.toContain("LEGACY_ROLLBACK_CONTEXT");
    }
  });

  it("records reactive compact as a bounded retry layer", async () => {
    const context = await createTestContext();
    setExecutorMaxInputTokens(context, 20_000);
    const oldOversized = "REACTIVE_OLD_CONTEXT".repeat(1_600);
    const messages: ModelMessage[] = [
      { role: "system", content: "s" },
      { role: "user", content: oldOversized },
      { role: "assistant", content: oldOversized },
      { role: "user", content: oldOversized },
      { role: "user", content: "keep after provider context error" },
    ];

    const compacted = await prepareMessagesForProviderPreflight({
      messages,
      context,
      sessionId: context.sessionId ?? "session",
      runtime: runtime(),
      trigger: "reactive",
      deps: compactDeps(),
    });

    expect(compacted.blocked).toBe(false);
    expect(context.cache.compactStrategy?.trigger).toBe("reactive");
    expect(context.cache.compactStrategy?.steps).toContainEqual(
      expect.objectContaining({ layer: "reactive", status: "applied" }),
    );
    if (!compacted.blocked) {
      expect(compacted.messages.map((message) => message.content).join("\n")).not.toContain(
        "REACTIVE_OLD_CONTEXT",
      );
    }
  });

  it("stress compacts huge provider windows to the retained target", async () => {
    const context = await createTestContext();
    setExecutorMaxInputTokens(context, 1_000_000);
    const oldChunk = `STALE_STRESS_CONTEXT_${"x".repeat(31_980)}`;
    const latestRequest = "LATEST_STRESS_REQUEST keep this";
    const stressMessages: ModelMessage[] = [
      { role: "system", content: "system guard" },
      ...Array.from(
        { length: 130 },
        (_, index): ModelMessage => ({
          role: "user",
          content: `${oldChunk}_${index}`,
        }),
      ),
      { role: "user", content: latestRequest },
    ];

    expect(estimateModelMessageChars(stressMessages)).toBeGreaterThan(
      getProviderContextMaxChars(context, runtime()),
    );

    const compacted = await prepareMessagesForProviderPreflight({
      messages: stressMessages,
      context,
      sessionId: context.sessionId ?? "session",
      runtime: runtime(),
      trigger: "request",
      deps: compactDeps(),
    });

    expect(compacted.blocked).toBe(false);
    if (!compacted.blocked) {
      expect(estimateModelMessageChars(compacted.messages)).toBeLessThanOrEqual(
        context.cache.compactProjection?.postCompactTargetChars ?? 0,
      );
      expect(compacted.messages.some((message) => message.content === latestRequest)).toBe(true);
    }
    expect((context.cache.compactProjection?.postCompactTargetChars ?? 0) / 4).toBe(80_000);
    expect(context.cache.compactProjection?.postCompactChars).toBeLessThanOrEqual(
      (context.cache.compactProjection?.postCompactTargetChars ?? 0) - 4_000,
    );
  });

  it("bounds restore context under noisy compact pressure", async () => {
    const context = await createTestContext();
    setExecutorMaxInputTokens(context, 20_000);
    context.tools.todos = Array.from({ length: 25 }, (_, index) => ({
      id: `todo-${index}`,
      content: `restore task ${index} with apiKey=SECRET_${index}`,
      status: "pending" as const,
    }));
    context.tools.changedFiles = Array.from(
      { length: 20 },
      (_, index) => `src/changed-${index}.ts`,
    );
    context.recentlyMentionedFiles = [
      ...Array.from({ length: 20 }, (_, index) => `src/mentioned-${index}.ts`),
      "src/mentioned-0.ts",
    ];
    context.evidence = Array.from({ length: 20 }, (_, index) => ({
      id: `ev-${index}`,
      kind: "command_output" as const,
      summary: `evidence ${index}`,
      source: `src/evidence-${index}.ts`,
      supportsClaims: ["stress"],
      createdAt: new Date().toISOString(),
    }));
    context.memory.accepted = Array.from({ length: 12 }, (_, index) => ({
      id: `mem-${index}`,
      scope: "user" as const,
      status: "accepted" as const,
      taxonomy: "user" as const,
      summary: `memory ${index} token=SECRET_${index} ${"x".repeat(240)}`,
      source: "stress-test",
      sourceRefs: [],
      risk: "low" as const,
      inferred: false,
      createdAt: new Date().toISOString(),
    }));
    context.agents = [
      ...Array.from({ length: 8 }, (_, index) => stressAgent(`run-${index}`, "running")),
      ...Array.from({ length: 8 }, (_, index) => stressAgent(`blocked-${index}`, "blocked")),
      ...Array.from({ length: 8 }, (_, index) => stressAgent(`stale-${index}`, "stale")),
    ];
    context.backgroundTasks = [
      ...Array.from({ length: 8 }, (_, index) =>
        stressBackgroundTask(`job-run-${index}`, "running"),
      ),
      ...Array.from({ length: 8 }, (_, index) =>
        stressBackgroundTask(`job-block-${index}`, "blocked"),
      ),
      ...Array.from({ length: 8 }, (_, index) =>
        stressBackgroundTask(`job-stale-${index}`, "stale"),
      ),
    ];
    context.cache.lastFreshness = {
      systemPromptHash: "system",
      toolSchemaHash: "tools",
      mcpToolListHash: "mcp",
      modelProviderHash: "model",
      changedKeys: Array.from({ length: 20 }, (_, index) => `key-${index}`),
    };
    context.routeDecisions = Array.from(
      { length: 12 },
      (_, index): RoleRouteDecision => ({
        id: `route-${index}`,
        triggerReason: "stress",
        role: "executor",
        selectedProvider: `provider-${index}`,
        selectedModel: `model-${index}`,
        fallbackCandidates: [],
        requiredCapabilities: [],
        stopConditions: [],
        repairSuggestions: [],
        fallbackUsed: false,
        budgetStop: false,
        createdAt: new Date().toISOString(),
      }),
    );

    const compacted = await prepareMessagesForProviderPreflight({
      messages: [
        { role: "system", content: "system guard" },
        { role: "user", content: "NOISY_OLD_CONTEXT".repeat(5_000) },
        { role: "user", content: "latest noisy request" },
      ],
      context,
      sessionId: context.sessionId ?? "session",
      runtime: runtime(),
      trigger: "request",
      deps: compactDeps(),
    });

    expect(compacted.blocked).toBe(false);
    const restore = context.cache.compactProjection?.restoreContext;
    expect(restore).toBeDefined();
    expect(restore?.keyFiles).toHaveLength(12);
    expect(new Set(restore?.keyFiles).size).toBe(restore?.keyFiles.length);
    expect(restore?.changedFiles).toHaveLength(8);
    expect(restore?.evidenceRefs).toEqual(Array.from({ length: 8 }, (_, index) => `ev-${index}`));
    expect(restore?.userConstraints).toHaveLength(4);
    expect(restore?.pendingItems).toHaveLength(6);
    expect(restore?.decisions).toHaveLength(5);
    expect(restore?.activeAgentsWorkflows).toHaveLength(10);
    expect(restore?.needsAttentionAgentsWorkflows).toHaveLength(10);
    expect(restore?.staleResumableAgentsWorkflows).toHaveLength(10);
    expect(JSON.stringify(restore)).not.toContain("SECRET_");
    expect(
      Math.max(...(restore?.userConstraints.map((item) => item.length) ?? [0])),
    ).toBeLessThanOrEqual(161);
    expect(Math.max(...(restore?.keyFiles.map((item) => item.length) ?? [0]))).toBeLessThanOrEqual(
      120,
    );
    if (!compacted.blocked) {
      const compactMessage = compacted.messages.map((message) => message.content).join("\n");
      expect(compactMessage).toContain("[Context restore metadata]");
      expect(compactMessage).not.toContain("SECRET_");
      expect(estimateModelMessageChars(compacted.messages)).toBeLessThanOrEqual(
        context.cache.compactProjection?.postCompactTargetChars ?? 0,
      );
    }
  });

  it("covers tool pairing safety and compact cooldown/blocking branches", async () => {
    const context = await createTestContext();
    const events: string[] = [];
    const deps = {
      ...compactDeps(),
      appendSystemEvent: async (_context: TuiContext, _sessionId: string, message: string) => {
        events.push(message);
      },
    };
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
      expect(blocked.message).toContain("不会把超压的半截上下文继续发给 provider");
    }
    expect(events).toContain("context_compact_cooldown_active");

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

    expect(
      sanitizeCompactSummaryText(context, `${context.projectPath}\\secret sk-abc123`, 200),
    ).not.toContain("sk-abc123");
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
      gateway: gateway([
        { type: "assistant_text_delta", text: "summary", id: "a1" },
        { type: "message_stop", id: "a1", chunkCount: 1, hadUsage: false },
      ]),
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
      gateway: gateway([
        { type: "assistant_text_delta", text: "late summary", id: "a2" },
        { type: "message_stop", id: "a2", chunkCount: 1, hadUsage: false },
      ]),
      signal: cancelledController.signal,
      deps: deepDeps(),
    });
    expect(cancelled).toMatchObject({ ok: false, message: expect.stringContaining("取消") });

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

  it("reuses a recent deep compact packet from tail without full transcript resume", async () => {
    const context = await createTestContext();
    const sessionId = context.sessionId ?? "session";
    const packet = createDeepCompactPacket({
      context,
      transcript: [],
      summary: "cached summary",
      runtime: runtime(),
      trigger: "manual",
    });
    context.cache.deepCompact = packet;
    await context.store.appendEvent(sessionId, {
      type: DEEP_COMPACT_EVENT_TYPE,
      packet,
      createdAt: packet.createdAt,
    } as never);

    let resumeCalls = 0;
    context.store.resume = async () => {
      resumeCalls += 1;
      throw new Error("full transcript resume should not run for recent deep compact packet");
    };

    const result = await maybeRunDeepCompactBeforeProvider({
      context,
      sessionId,
      runtime: runtime(),
      trigger: "request",
      gateway: gateway([]),
      deps: deepDeps(),
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.packet.id).toBe(packet.id);
    expect(resumeCalls).toBe(0);
  });

  it("deduplicates concurrent deep compact preflights, reuses the owner result, and exposes progress", async () => {
    const context = await createTestContext();
    const sessionId = context.sessionId ?? "session";
    await context.store.appendEvent(sessionId, {
      type: "user_message",
      id: "concurrent-u1",
      text: "compact concurrent marker",
      createdAt: new Date().toISOString(),
    });
    const progressSnapshots: Array<string[] | undefined> = [];
    context.shellRerender = () => {
      const stages = context.cache.compactProgress?.stages;
      progressSnapshots.push(stages ? [...stages] : undefined);
    };
    let streamCalls = 0;
    let release!: () => void;
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gatedGateway = {
      async *stream() {
        streamCalls += 1;
        await releasePromise;
        yield { type: "assistant_text_delta", text: "shared summary", id: "a1" } as never;
        yield { type: "message_stop", id: "a1", chunkCount: 1, hadUsage: false } as never;
      },
    } as unknown as ModelGateway;

    const first = maybeRunDeepCompactBeforeProvider({
      context,
      sessionId,
      runtime: runtime(),
      trigger: "request",
      gateway: gatedGateway,
      deps: deepDeps(),
    });
    const second = maybeRunDeepCompactBeforeProvider({
      context,
      sessionId,
      runtime: runtime(),
      trigger: "continuation",
      gateway: gatedGateway,
      deps: deepDeps(),
    });

    expect(context.deepCompactInFlight?.sessionId).toBe(sessionId);
    expect(context.cache.compactProgress?.stages).toEqual(["scan_context"]);
    release();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(streamCalls).toBe(1);
    expect(firstResult.ok).toBe(true);
    expect(secondResult.ok).toBe(true);
    if (firstResult.ok && secondResult.ok) {
      expect(secondResult.packet.id).toBe(firstResult.packet.id);
    }
    expect(context.cache.deepCompact?.summary).toContain("shared summary");
    expect(progressSnapshots[0]).toEqual(["scan_context"]);
    expect(progressSnapshots.some((stages) => stages?.includes("generate_summary"))).toBe(true);
    expect(progressSnapshots.at(-1)).toBeUndefined();
    expect(context.cache.compactProgress).toBeUndefined();
    expect(context.deepCompactInFlight).toBeUndefined();
  });

  it("projects the main screen after successful deep compact", async () => {
    const context = await createTestContext();
    const sessionId = context.sessionId ?? "session";
    const projections: Array<{ projectMainScreen?: boolean }> = [];
    context.compactOutputMemory = (options = {}) => {
      projections.push(options);
      return { beforeCount: 6, afterCount: 3 };
    };

    const result = await runDeepCompact({
      context,
      sessionId,
      transcript: [
        {
          type: "user_message",
          id: "screen-u1",
          text: "goal",
          createdAt: new Date().toISOString(),
        },
      ],
      runtime: runtime(),
      trigger: "manual",
      gateway: gateway([
        { type: "assistant_text_delta", text: "summary for screen", id: "a1" },
        { type: "message_stop", id: "a1", chunkCount: 1, hadUsage: false },
      ]),
      deps: deepDeps(),
    });

    expect(result.ok).toBe(true);
    expect(projections).toContainEqual({ projectMainScreen: true });
  });
});

describe("Phase E evidence, compact-cache, break-cache, and handoff coverage", () => {
  it("records provider failure, failure learning, and verification evidence", async () => {
    const context = await createTestContext();
    const sessionId = context.sessionId ?? "session";
    await recordProviderFailureEvidence(
      context,
      sessionId,
      Object.assign(
        new Error(
          "eventstream CRC mismatch sk-secret endpoint=https://api.example.com/v1/messages?api_key=raw-token content-type=text/html",
        ),
        {
          code: "PROVIDER_STREAM_ERROR",
          status: 502,
        },
      ),
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
    expect(context.lastProviderFailure?.endpointSummary).toBe(
      "https://api.example.com/v1/messages",
    );
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
    const once = await breakCacheTestHooks.buildPromptCacheFields(context.projectPath, true, "1h");
    expect(once.promptCacheEnabled).toBe(true);
    expect(once.promptCacheTtl).toBe("1h");
    expect(once.cacheBreakNonce).toBeTruthy();
    expect(
      (await breakCacheTestHooks.buildPromptCacheFields(context.projectPath, true, "1h"))
        .cacheBreakNonce,
    ).toBeUndefined();

    await executeBreakCacheMutation("always", context, output);
    const alwaysA = await breakCacheTestHooks.buildPromptCacheFields(
      context.projectPath,
      true,
      "5m",
    );
    const alwaysB = await breakCacheTestHooks.buildPromptCacheFields(
      context.projectPath,
      true,
      "5m",
    );
    expect(alwaysA.cacheBreakNonce).toBe(alwaysB.cacheBreakNonce);
    await executeBreakCacheMutation("clear", context, output);
    expect(breakCacheTestHooks.readMarker(context.projectPath).mode).toBe("off");
  });

  it("hydrates resume context and loads or creates a bounded handoff packet", async () => {
    const context = await createTestContext();
    const projection: CompactProjection = {
      boundaryId: "boundary-restore",
      createdAt: new Date().toISOString(),
      summary: "projection summary",
      restoreContext: {
        goal: "continue compact phase",
        currentTask: "restore phase five metadata",
        phaseStatus: "in_progress",
        userConstraints: ["keep evidence references"],
        keyFiles: ["src/a.ts", "src/restore.ts"],
        changedFiles: ["src/restore.ts"],
        evidenceRefs: ["ev-1"],
        activeAgentsWorkflows: ["agent:a1:running:scan"],
        needsAttentionAgentsWorkflows: [],
        staleResumableAgentsWorkflows: [],
        pendingItems: ["todo:pending:continue"],
        decisions: ["executor:deepseek/deepseek-chat"],
        risks: ["context continuity only"],
        indexStatus: "ready",
        cacheFreshness: "stable-or-unknown",
        memoryStatus: "1 accepted memories",
        verificationRequirement:
          "Do not claim completion, PASS, or verified results without recorded evidence.",
      },
      replacementKind: "provider-visible",
      replacedMessageCount: 4,
      replacementMessageCount: 2,
      pressureRatio: 1.2,
      preCompactChars: 1000,
      postCompactChars: 200,
      postCompactTargetChars: 400,
      savingsRatio: 0.8,
      discardedRange: "older provider-visible recent context summarized",
      toolPairingSafe: true,
      risks: ["context continuity only"],
      evidenceRefs: ["ev-legacy"],
    };
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
        type: "system_event",
        id: "compact-event-1",
        level: "info",
        message: `compact_projection:${JSON.stringify(projection)}`,
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
    expect(context.cache.compactProjection?.restoreContext?.currentTask).toBe(
      "restore phase five metadata",
    );
    expect(context.cache.compactBoundaries.at(-1)).toMatchObject({
      id: "boundary-restore",
      preservedEvidenceRefs: ["ev-1"],
      preservedFiles: ["src/a.ts", "src/restore.ts"],
    });

    const packet = await loadOrCreateHandoffPacket(context, "parent-session");
    expect(packet.id).toBe("handoff-1");
    expect(packet.solutionCompleteness).toBe(context.solutionCompleteness);

    context.memory.lastHandoff = undefined;
    const created = await loadOrCreateHandoffPacket(context, "parent-session", context.sessionId);
    expect(created.evidenceRefs.length).toBeGreaterThan(0);
    expect(created.keyFiles).toContain("src/a.ts");
  });
});

async function createMcpServerScript(
  source: string,
): Promise<{ command: string; args: string[]; cwd: string }> {
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

function setExecutorMaxInputTokens(context: TuiContext, maxInputTokens: number): void {
  context.config = {
    ...context.config,
    modelRoutes: {
      ...context.config.modelRoutes,
      routes: context.config.modelRoutes.routes.map((route) =>
        route.role === "executor" ? { ...route, maxInputTokens } : route,
      ),
    },
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

function stressAgent(id: string, status: "running" | "blocked" | "stale"): AgentRun {
  return {
    id,
    type: "worker",
    role: "executor",
    provider: "deepseek",
    task: `agent task ${id}`,
    model: "deepseek-chat",
    permissionMode: "default",
    status,
    transcriptPath: `agents/${id}.jsonl`,
    transcriptSessionId: `session-${id}`,
    mailbox: [],
    summary: `agent ${id} summary with token=SECRET_AGENT_${id}`,
    contextSummary: "context",
    cost: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      estimatedCny: 0,
    },
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function stressBackgroundTask(
  id: string,
  status: "running" | "blocked" | "stale",
): BackgroundTaskState {
  return {
    id,
    kind: "job",
    title: `job ${id}`,
    status,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    heartbeatIntervalMs: 1_000,
    staleAfterMs: 10_000,
    hasOutput: false,
    userVisibleSummary: `background ${id} with apiKey=SECRET_JOB_${id}`,
  };
}

class MemoryOutput extends Writable {
  text = "";

  override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: () => void): void {
    this.text += chunk.toString();
    callback();
  }
}
