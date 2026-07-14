import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import {
  builtInTools,
  createToolContext,
  type ToolContext,
  type ToolOutput,
  type ToolProgressEvent,
} from "@linghun/tools";
import { defaultConfig } from "@linghun/config";

import { createIndexState } from "./index-runtime.js";
import { configureMcpIndexRuntime } from "./mcp-index-runtime.js";
import { createModelToolDefinitions } from "./model-loop-runtime.js";
import { createFailureLearningState } from "./failure-learning-runtime.js";
import { withMemoryDirectoryLock } from "./memory-extraction-runtime.js";
import {
  __testBuildForkArgsFromStartAgentInput,
  __testBuildPreEngineFallbackRequiredResult,
  __testBuildStartAgentToolResult,
  __testBuildWorkflowToolResultData,
  __testFormatPreEnginePrimaryText,
  __testParseRunWorkflowToolInput,
  __testParseStartAgentToolInput,
  executeApprovedModelToolUse,
  executeDeferredDispatchToolUse,
  executePreEngineToolUse,
  rememberSourcePackCandidatesFromToolData,
  rememberToolFiles,
} from "./model-tool-runtime.js";
import { formatToolOutput } from "./tool-output-presenter.js";
import type { TuiContext } from "./tui-context-runtime.js";
import type { AgentRun, WorkflowRunState } from "./tui-data-types.js";

class WebToolOutput extends Writable {
  text = "";
  errors: string[] = [];

  override _write(
    chunk: unknown,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.text += String(chunk);
    callback();
  }

  writeErrorLine(text: string): void {
    this.errors.push(text);
  }
}

function createWebToolTestContext(events: unknown[], projectPath = process.cwd()): TuiContext {
  return {
    projectPath,
    sessionId: "session-web",
    tools: createToolContext(projectPath),
    currentRequestTurnId: "turn-web",
    store: {
      appendEvent: async (
        _sessionId: string,
        event: unknown,
        commitGuard?: () => boolean,
      ) => {
        if (!commitGuard || commitGuard()) events.push(event);
      },
    },
    language: "zh-CN",
    evidence: [],
    recentlyMentionedFiles: [],
    backgroundTasks: [],
    backgroundAbortControllers: new Map(),
  } as unknown as TuiContext;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function emitWebProgress(
  context: ToolContext,
  event: ToolProgressEvent & {
    phase: "connecting" | "receiving" | "processing";
    transport: string;
    receivedBytes?: number;
    itemCount?: number;
  },
): void | Promise<void> | undefined {
  return (context.onProgress as ((progress: typeof event) => void | Promise<void>) | undefined)?.(
    event,
  );
}

describe("model-tool-runtime Web terminal output", () => {
  it("routes a current-owner structured Web failure through writeErrorLine", async () => {
    const originalCall = builtInTools.WebSearch.call;
    builtInTools.WebSearch.call = (async () => ({
      text: "搜索超时",
      data: { isError: true, aborted: false, timedOut: true },
    })) as typeof originalCall;
    const events: unknown[] = [];
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-web-failure-"));
    const context = createWebToolTestContext(events, projectPath);
    context.failureLearning = createFailureLearningState(projectPath);
    const output = new WebToolOutput();
    const controller = new AbortController();

    try {
      const result = await executeApprovedModelToolUse(
        { id: "web-failed", name: "WebSearch", input: { query: "linghun" } },
        "WebSearch",
        context,
        "session-web",
        output,
        undefined,
        undefined,
        { requestTurnId: "turn-web", signal: controller.signal },
      );

      expect(result.ok).toBe(false);
      expect(output.errors).toHaveLength(1);
      expect(output.errors[0]).toContain("WebSearch 已超时");
      expect(context.lastToolFailure?.summary).toContain("WebSearch timed out");
      expect(context.lastToolFailure?.summary).not.toContain("exited non-zero");
    } finally {
      builtInTools.WebSearch.call = originalCall;
    }
  });

  it("keeps successful Web output on the normal output path", async () => {
    const originalCall = builtInTools.WebSearch.call;
    let observedSignal: AbortSignal | undefined;
    builtInTools.WebSearch.call = (async (_input, toolContext) => {
      observedSignal = toolContext.abortSignal;
      return {
        text: "result",
        data: { isError: false, searches: 1, count: 1 },
      };
    }) as typeof originalCall;
    const context = createWebToolTestContext([]);
    const output = new WebToolOutput();
    const controller = new AbortController();

    try {
      const result = await executeApprovedModelToolUse(
        { id: "web-success", name: "WebSearch", input: { query: "linghun" } },
        "WebSearch",
        context,
        "session-web",
        output,
        undefined,
        undefined,
        { requestTurnId: "turn-web", signal: controller.signal },
      );

      expect(result.ok).toBe(true);
      expect(observedSignal).toBe(controller.signal);
      expect(output.errors).toEqual([]);
      expect(output.text).toContain("执行 1 次搜索");
    } finally {
      builtInTools.WebSearch.call = originalCall;
    }
  });

  it.each(["timeout", "cancelled"] as const)(
    "routes Bash outcome=%s through the existing failure lifecycle",
    async (outcome) => {
      const originalCall = builtInTools.Bash.call;
      builtInTools.Bash.call = (async () => ({
        text: "stopped",
        data: { outcome },
      })) as typeof originalCall;
      const projectPath = await mkdtemp(join(tmpdir(), "linghun-bash-outcome-"));
      const context = createWebToolTestContext([], projectPath);
      context.failureLearning = createFailureLearningState(projectPath);
      const output = new WebToolOutput();

      try {
        const result = await executeApprovedModelToolUse(
          { id: `bash-${outcome}`, name: "Bash", input: { command: "pnpm test" } },
          "Bash",
          context,
          "session-web",
          output,
        );

        expect(result.ok).toBe(false);
        expect(context.lastToolFailure?.summary).toContain(
          outcome === "timeout" ? "Bash timed out" : "Bash cancelled",
        );
        expect(context.lastToolFailure?.summary).not.toContain("exited non-zero");
      } finally {
        builtInTools.Bash.call = originalCall;
      }
    },
  );

  it("keeps new-owner evidence when a stale request reuses the same tool use id", async () => {
    const originalCall = builtInTools.WebSearch.call;
    builtInTools.WebSearch.call = (async () => ({
      text: "old owner result",
      data: { isError: false, searches: 1, count: 1 },
    })) as typeof originalCall;
    const events: unknown[] = [];
    const context = createWebToolTestContext(events);
    const output = new WebToolOutput();
    const controller = new AbortController();
    const originalAppendEvent = context.store.appendEvent.bind(context.store);
    context.store.appendEvent = async (sessionId, event, commitGuard) => {
      if (
        (event as { type?: string }).type === "tool_result" &&
        context.currentRequestTurnId === "turn-web"
      ) {
        context.currentRequestTurnId = "turn-next";
        context.evidence.push({
          id: "new-owner-evidence",
          kind: "web_source",
          summary: "new owner result",
          source: "WebSearch",
          supportsClaims: ["web_source"],
          toolUseId: "shared-tool-id",
          ownerScope: {
            ownerSessionId: "session-web",
            requestTurnId: "turn-next",
            cwd: context.projectPath,
          },
          createdAt: new Date().toISOString(),
        });
      }
      await originalAppendEvent(sessionId, event, commitGuard);
    };

    try {
      const result = await executeApprovedModelToolUse(
        { id: "shared-tool-id", name: "WebSearch", input: { query: "old owner" } },
        "WebSearch",
        context,
        "session-web",
        output,
        undefined,
        undefined,
        { requestTurnId: "turn-web", signal: controller.signal },
      );

      expect(result).toMatchObject({ ok: false, text: expect.stringContaining("stale") });
      expect(context.evidence).toEqual([
        expect.objectContaining({
          id: "new-owner-evidence",
          toolUseId: "shared-tool-id",
          ownerScope: expect.objectContaining({ requestTurnId: "turn-next" }),
        }),
      ]);
      expect(output.text).not.toContain("执行 1 次搜索");
      expect(output.text).not.toContain("old owner result");
      expect(output.errors).toEqual([]);
    } finally {
      builtInTools.WebSearch.call = originalCall;
    }
  });

  it("drops failure learning and visible output when owner changes while its lock is pending", async () => {
    const originalCall = builtInTools.WebSearch.call;
    builtInTools.WebSearch.call = (async () => ({
      text: "old owner timed out",
      data: { isError: true, aborted: false, timedOut: true },
    })) as typeof originalCall;
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-web-stale-learning-"));
    const events: unknown[] = [];
    const context = createWebToolTestContext(events, projectPath);
    context.failureLearning = createFailureLearningState(projectPath);
    const output = new WebToolOutput();
    const controller = new AbortController();
    let pending: ReturnType<typeof executeApprovedModelToolUse> | undefined;

    try {
      await withMemoryDirectoryLock(context.failureLearning.directory, async () => {
        pending = executeApprovedModelToolUse(
          { id: "stale-failure", name: "WebSearch", input: { query: "old owner" } },
          "WebSearch",
          context,
          "session-web",
          output,
          undefined,
          undefined,
          { requestTurnId: "turn-web", signal: controller.signal },
        );
        await vi.waitFor(() => {
          expect(events.some((event) => (event as { type?: string }).type === "tool_result"))
            .toBe(true);
        });
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
        context.currentRequestTurnId = "turn-next";
      });

      const result = await pending!;
      const files = await readdir(context.failureLearning.directory);
      expect(result).toMatchObject({ ok: false, text: expect.stringContaining("stale") });
      expect(files.filter((file) => file.endsWith(".json"))).toEqual([]);
      expect(context.failureLearning.records).toEqual([]);
      expect(context.lastToolFailure).toBeUndefined();
      expect(JSON.stringify(events)).not.toContain("policy_tool_feedback");
      expect(output.text).not.toContain("已超时");
      expect(output.text).not.toContain("old owner timed out");
      expect(output.errors).toEqual([]);
    } finally {
      builtInTools.WebSearch.call = originalCall;
    }
  });

  it("isolates parallel Web progress by request owner and tool use id", async () => {
    const originalCall = builtInTools.WebSearch.call;
    const firstResult = deferred<ToolOutput>();
    const secondResult = deferred<ToolOutput>();
    const scopedContexts = new Map<string, ToolContext>();
    builtInTools.WebSearch.call = (async (input: unknown, toolContext: ToolContext) => {
      const query = (input as { query: string }).query;
      scopedContexts.set(query, toolContext);
      await emitWebProgress(toolContext, {
        toolName: "WebSearch",
        stream: "system",
        text: "receiving",
        phase: "receiving",
        transport: "https",
        receivedBytes: query === "first" ? 1_024 : 2_048,
        itemCount: query === "first" ? 1 : 2,
      });
      return query === "first" ? firstResult.promise : secondResult.promise;
    }) as typeof originalCall;
    const events: unknown[] = [];
    const context = createWebToolTestContext(events);
    const originalProgress = vi.fn();
    const shellRerender = vi.fn();
    context.tools.onProgress = originalProgress;
    context.shellRerender = shellRerender;
    const controller = new AbortController();

    try {
      const firstPending = executeApprovedModelToolUse(
        { id: "web-first", name: "WebSearch", input: { query: "first" } },
        "WebSearch",
        context,
        "session-web",
        new WebToolOutput(),
        undefined,
        undefined,
        { requestTurnId: "turn-web", signal: controller.signal },
      );
      await vi.waitFor(() => expect(scopedContexts.has("first")).toBe(true));
      const secondPending = executeApprovedModelToolUse(
        { id: "web-second", name: "WebSearch", input: { query: "second" } },
        "WebSearch",
        context,
        "session-web",
        new WebToolOutput(),
        undefined,
        undefined,
        { requestTurnId: "turn-web", signal: controller.signal },
      );
      await vi.waitFor(() => expect(scopedContexts.has("second")).toBe(true));

      expect(scopedContexts.get("first")).not.toBe(scopedContexts.get("second"));
      expect(context.tools.onProgress).toBe(originalProgress);
      expect(context.requestActivityToolUseId).toBe("web-second");
      expect((context as { requestActivityToolTarget?: string }).requestActivityToolTarget)
        .toContain("2.0 KB");
      const secondTarget = (context as { requestActivityToolTarget?: string })
        .requestActivityToolTarget;
      const rerenders = shellRerender.mock.calls.length;

      await emitWebProgress(scopedContexts.get("first")!, {
        toolName: "WebSearch",
        stream: "system",
        text: "processing",
        phase: "processing",
        transport: "https",
        receivedBytes: 8_192,
        itemCount: 8,
      });
      await emitWebProgress(scopedContexts.get("second")!, {
        toolName: "WebSearch",
        stream: "system",
        text: "receiving",
        phase: "receiving",
        transport: "https",
        receivedBytes: 4_096,
        itemCount: 4,
      });

      expect((context as { requestActivityToolTarget?: string }).requestActivityToolTarget)
        .toBe(secondTarget);
      expect(shellRerender).toHaveBeenCalledTimes(rerenders);
      expect(originalProgress).not.toHaveBeenCalled();

      await emitWebProgress(scopedContexts.get("second")!, {
        toolName: "WebSearch",
        stream: "system",
        text: "processing",
        phase: "processing",
        transport: "https",
        receivedBytes: 4_096,
        itemCount: 4,
      });
      const processingTarget = (context as { requestActivityToolTarget?: string })
        .requestActivityToolTarget;
      expect(processingTarget).toContain("processing");
      expect(processingTarget).toContain("4.0 KB");
      expect(shellRerender).toHaveBeenCalledTimes(rerenders + 1);

      firstResult.resolve({ text: "first result", data: { searches: 1, count: 1 } });
      await firstPending;
      expect(context.requestActivityToolUseId).toBe("web-second");

      const eventCount = events.length;
      context.currentRequestTurnId = "turn-next";
      await emitWebProgress(scopedContexts.get("second")!, {
        toolName: "WebSearch",
        stream: "system",
        text: "processing",
        phase: "processing",
        transport: "https",
        receivedBytes: 16_384,
        itemCount: 16,
      });
      expect((context as { requestActivityToolTarget?: string }).requestActivityToolTarget)
        .toBe(processingTarget);
      expect(events).toHaveLength(eventCount);
      expect(events.some((event) => (event as { type?: string }).type === "tool_call_delta"))
        .toBe(false);

      secondResult.resolve({ text: "late second result", data: { searches: 1, count: 1 } });
      await secondPending;
    } finally {
      builtInTools.WebSearch.call = originalCall;
    }
  });
});

describe("model-tool-runtime ReadSnippets and SourcePack integration", () => {
  it("keeps automatic final-gate evidence primary text out of the main screen", () => {
    const source = readFileSync(new URL("./model-tool-runtime.ts", import.meta.url), "utf8");

    expect(source).toContain("shouldSuppressControlToolPrimaryText(toolCall)");
    expect(source).toContain('toolCall.id.startsWith("final-gate-evidence-")');
  });

  it("exposes ReadSnippets and SourcePack in model tool definitions", () => {
    const definitions = createModelToolDefinitions();
    const readSnippets = definitions.find((definition) => definition.name === "ReadSnippets");
    const sourcePack = definitions.find((definition) => definition.name === "SourcePack");

    expect(readSnippets?.description).toContain("Use ReadSnippets");
    expect(sourcePack?.description).toContain("Use SourcePack");
    expect(JSON.stringify(readSnippets?.inputSchema)).toContain("ranges");
    expect(JSON.stringify(sourcePack?.inputSchema)).toContain("query");
  });

  it("keeps ReadSnippets and SourcePack main-screen output free of internal debug wording", () => {
    const readOutput = formatToolOutput(
      "ReadSnippets",
      {
        text: "src/a.ts:1-1\n1\tconst a = 1;",
        data: { count: 1, ranges: [{ path: "src/a.ts", start: 1, end: 1, content: "1\tconst a = 1;" }] },
      },
      "zh-CN",
    );
    const packOutput = formatToolOutput(
      "SourcePack",
      {
        text: "src/a.ts:1-1\nreason: matched \"a\" at line 1; confidence: 0.60\n1\tconst a = 1;",
        data: { count: 1, snippets: [{ path: "src/a.ts", start: 1, end: 1, reason: "matched" }] },
      },
      "zh-CN",
    );

    const combined = `${readOutput}\n${packOutput}`;
    expect(combined).toContain("ReadSnippets");
    expect(combined).toContain("SourcePack");
    expect(combined).not.toMatch(/tool dispatcher|debug|raw evidence|final gate|passEvidence/iu);
    expect(combined).not.toMatch(/预算|字符数|40000|总输出预算|单范围上限/u);
  });

  it("remembers files from ReadSnippets and SourcePack data", () => {
    const context = { recentlyMentionedFiles: ["old.ts"] } as TuiContext;

    rememberToolFiles(
      context,
      "ReadSnippets",
      { ranges: [{ path: "src/from-input.ts", start: 1, end: 2 }] },
      {
        text: "",
        data: {
          ranges: [{ path: "src/from-output.ts", start: 3, end: 4, content: "x" }],
        },
      },
    );
    rememberToolFiles(
      context,
      "SourcePack",
      { query: "needle" },
      {
        text: "",
        data: {
          candidatePaths: ["src/from-pack.ts"],
          snippets: [{ path: "src/from-snippet.ts", start: 1, end: 1, content: "x" }],
        },
      },
    );

    expect(context.recentlyMentionedFiles).toEqual(
      expect.arrayContaining([
        "src/from-input.ts",
        "src/from-output.ts",
        "src/from-pack.ts",
        "old.ts",
      ]),
    );
  });

  it("injects SourcePack candidates from index tool results", () => {
    const context = {
      recentlyMentionedFiles: [],
      tools: {},
    } as unknown as TuiContext;

    rememberSourcePackCandidatesFromToolData(context, "search_graph", {
      results: [
        {
          path: "src/index-hit.ts",
          line: 7,
          symbol: "indexedNeedle",
          score: 0.82,
        },
      ],
    });

    expect(context.tools.sourcePackCandidates).toEqual([
      {
        path: "src/index-hit.ts",
        start: 7,
        end: 31,
        reason: "index candidate: indexedNeedle",
        confidence: 0.82,
      },
    ]);
  });

  it("formats pre_context success with the requested symbol", () => {
    const text = __testFormatPreEnginePrimaryText(
      "pre_context",
      true,
      { language: "zh-CN" } as TuiContext,
      { symbol: "classifyVerificationLevel" },
    );

    expect(text).toBe("代码上下文分析完成：classifyVerificationLevel");
  });

  it("formats pre_context success without undefined when symbol is missing", () => {
    const text = __testFormatPreEnginePrimaryText(
      "pre_context",
      true,
      { language: "zh-CN" } as TuiContext,
      {},
    );

    expect(text).toBe("代码上下文分析完成。");
  });

  it("formats pre_plan success without the generic code analysis message", () => {
    const text = __testFormatPreEnginePrimaryText(
      "pre_plan",
      true,
      { language: "zh-CN" } as TuiContext,
    );

    expect(text).toBe("代码规划分析完成。");
    expect(text).not.toBe("代码分析完成。");
  });

  it("marks pre-engine degradation as requiring real-tool fallback", () => {
    const result = __testBuildPreEngineFallbackRequiredResult(
      {
        text: "ExecuteExtraTool(pre-engine:pre_verify) 降级：verifier unavailable。",
        data: {
          degraded: true,
          reason: "pre-engine-verifier-unavailable",
          fallback_tools: ["SearchExtraTools", "SourcePack", "Grep", "Glob", "Read", "ReadSnippets"],
        },
      },
      { language: "zh-CN" } as TuiContext,
    );

    expect(result.text).toContain("必须继续调用真实工具");
    expect(result.data).toMatchObject({
      degraded: true,
      fallback_required: true,
      reason: "pre-engine-verifier-unavailable",
      required_next_action: expect.stringContaining("ReadSnippets"),
    });
  });

  it("keeps pre fallback on the first-class path and rejects the deferred alias", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-pre-evidence-"));
    const makeContext = () => {
      const events: unknown[] = [];
      const context = createWebToolTestContext(events, projectPath);
      context.config = defaultConfig;
      context.index = createIndexState(defaultConfig);
      context.discoveredDeferredToolNames = new Set(["pre_verify"]);
      context.mcp = { enabled: false, servers: [], tools: [] };
      context.skills = {
        enabled: false,
        skills: [],
        trustedIds: [],
        disabledIds: [],
        projectDir: join(projectPath, ".linghun", "skills"),
        userDir: join(projectPath, ".linghun-user", "skills"),
        evolutionCandidates: [],
        rejectedEvolutionCandidates: [],
      };
      context.plugins = {
        enabled: false,
        plugins: [],
        trustedIds: [],
        disabledIds: [],
        projectDir: join(projectPath, ".linghun", "plugins"),
        userDir: join(projectPath, ".linghun-user", "plugins"),
      };
      return { context, events };
    };
    let payload: Record<string, unknown> = {
      status: "pass",
      verification: { status: "partially_verified", fully_verified: false },
    };
    configureMcpIndexRuntime({
      getCurrentFreshness: () => ({} as never),
      writeStatus: () => undefined,
      checkBackgroundStartGuard: () => null,
      ensureSession: async () => "session-web",
      rememberBackgroundTask: () => undefined,
      appendBackgroundTaskEvent: async () => undefined,
      rememberEvidence: () => undefined,
      resolvePreEngineBinary: async () => "mock-pre-engine",
      callPreEngineTool: async () => ({
        ok: true,
        summary: "ok",
        data: { content: [{ type: "text", text: JSON.stringify(payload) }] },
      }),
    });
    const directContext = makeContext().context;
    const deferredContext = makeContext().context;

    const direct = await executePreEngineToolUse(
      { id: "direct-pre", name: "pre_verify", input: { changed_files: ["src/a.ts"] } },
      directContext,
      "session-web",
      new WebToolOutput(),
    );
    const deferredResult = await executeDeferredDispatchToolUse(
      {
        id: "deferred-pre",
        name: "ExecuteExtraTool",
        input: { tool_name: "pre_verify", params: { changed_files: ["src/a.ts"] } },
      },
      deferredContext,
      "session-web",
      new WebToolOutput(),
    );

    expect(direct.data).toMatchObject({
      degraded: true,
      fallback_required: true,
      required_next_action: expect.any(String),
    });
    expect(deferredResult.ok).toBe(false);
    expect(deferredResult.text).toContain("不在当前可用 deferred 工具清单");
    expect(directContext.evidence).toHaveLength(1);
    expect(directContext.evidence[0]).toMatchObject({ kind: "command_output" });
    expect(directContext.evidence[0]?.supportsClaims).not.toContain("Read");
    expect(directContext.evidence[0]?.supportsClaims).not.toContain("local_read");
    expect(directContext.evidence[0]?.supportsClaims).not.toContain("readonly_low_noise_evidence");
    expect(deferredContext.evidence).toHaveLength(1);
    expect(deferredContext.evidence[0]).toMatchObject({ kind: "command_output" });

    payload = { status: "pass", verification: { status: "verified", fully_verified: true } };
    const normalContext = makeContext().context;
    const normal = await executePreEngineToolUse(
      { id: "direct-pre-normal", name: "pre_verify", input: { changed_files: ["src/a.ts"] } },
      normalContext,
      "session-web",
      new WebToolOutput(),
    );
    expect(normal.data).not.toMatchObject({ fallback_required: true });
    expect(normalContext.evidence[0]).toMatchObject({ kind: "command_output" });

    const searchContext = makeContext().context;
    await executeDeferredDispatchToolUse(
      { id: "search-extra", name: "SearchExtraTools", input: { query: "pre" } },
      searchContext,
      "session-web",
      new WebToolOutput(),
    );
    expect(searchContext.evidence[0]).toMatchObject({ kind: "command_output" });
    expect(searchContext.evidence[0]?.supportsClaims).not.toContain("Read");
  });

  it("validates first-class pre parameters before daemon execution and rejects deferred aliases", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-pre-params-"));
    const calls = vi.fn(async () => ({
      ok: true,
      summary: "ok",
      data: { content: [{ type: "text", text: JSON.stringify({ status: "pass" }) }] },
    }));
    const resolveBinary = vi.fn(async () => "mock-pre-engine");
    configureMcpIndexRuntime({
      getCurrentFreshness: () => ({} as never),
      writeStatus: () => undefined,
      checkBackgroundStartGuard: () => null,
      ensureSession: async () => "session-web",
      rememberBackgroundTask: () => undefined,
      appendBackgroundTaskEvent: async () => undefined,
      rememberEvidence: () => undefined,
      resolvePreEngineBinary: resolveBinary,
      callPreEngineTool: calls,
    });
    const makeContext = () => {
      const context = createWebToolTestContext([], projectPath);
      context.config = defaultConfig;
      context.index = createIndexState(defaultConfig);
      context.discoveredDeferredToolNames = new Set(["pre_context", "pre_impact", "pre_plan", "pre_verify"]);
      context.mcp = { enabled: false, servers: [], tools: [] };
      context.skills = { enabled: false, skills: [], trustedIds: [], disabledIds: [] } as never;
      context.plugins = { enabled: false, plugins: [], trustedIds: [], disabledIds: [] } as never;
      return context;
    };
    const parameterCases = [
      { tool: "pre_context", empty: { symbol: "" }, valid: { symbol: "run" } },
      {
        tool: "pre_impact",
        empty: { changes: [] },
        valid: { changes: [{ path: "src/a.ts", symbols: ["run"] }] },
      },
      { tool: "pre_plan", empty: { task: "" }, valid: { task: "inspect" } },
      {
        tool: "pre_verify",
        empty: { changed_files: [] },
        valid: { changed_files: ["src/a.ts"] },
      },
    ];
    const invalidCases = parameterCases.flatMap((testCase) => [
      { tool: testCase.tool, params: {} },
      { tool: testCase.tool, params: testCase.empty },
      { tool: testCase.tool, params: [] },
    ]);

    for (const [index, testCase] of invalidCases.entries()) {
      const direct = await executePreEngineToolUse(
        { id: `direct-invalid-${index}`, name: testCase.tool, input: testCase.params },
        makeContext(),
        "session-web",
        new WebToolOutput(),
      );
      const deferred = await executeDeferredDispatchToolUse(
        {
          id: `deferred-invalid-${index}`,
          name: "ExecuteExtraTool",
          input: { tool_name: testCase.tool, params: testCase.params },
        },
        makeContext(),
        "session-web",
        new WebToolOutput(),
      );
      expect(deferred.ok).toBe(false);
      expect(direct.ok).toBe(false);
      expect(direct.text).toMatch(/params|缺少或为空/u);
      expect(deferred.text).toContain("不在当前可用 deferred 工具清单");
    }
    expect(resolveBinary).not.toHaveBeenCalled();
    expect(calls).not.toHaveBeenCalled();

    const validCases = parameterCases.map((testCase) => ({
      tool: testCase.tool,
      params: testCase.valid,
    }));
    for (const [index, testCase] of validCases.entries()) {
      const direct = await executePreEngineToolUse(
        { id: `direct-valid-${index}`, name: testCase.tool, input: testCase.params },
        makeContext(),
        "session-web",
        new WebToolOutput(),
      );
      const deferred = await executeDeferredDispatchToolUse(
        {
          id: `deferred-valid-${index}`,
          name: "ExecuteExtraTool",
          input: { tool_name: testCase.tool, params: testCase.params },
        },
        makeContext(),
        "session-web",
        new WebToolOutput(),
      );
      expect(direct.ok).toBe(true);
      expect(deferred.ok).toBe(false);
      expect(deferred.text).toContain("不在当前可用 deferred 工具清单");
    }
    expect(resolveBinary).toHaveBeenCalledTimes(validCases.length);
    expect(calls).toHaveBeenCalledTimes(validCases.length);
  });

  it("records denied ExecuteExtraTool as error tool_result and tool_failure evidence", async () => {
    const events: unknown[] = [];
    const context = createWebToolTestContext(events);
    context.config = defaultConfig;
    context.index = createIndexState(defaultConfig);
    context.discoveredDeferredToolNames = new Set(["list_projects"]);
    context.currentUserActionConstraintsRequestTurnId = "turn-web";
    context.currentUserActionConstraints = {
      readonlyOnly: true,
      forbidWrite: true,
      forbidTests: false,
      forbidBuild: false,
      forbidLint: false,
      forbidTypecheck: false,
      forbidSmoke: false,
      forbidShell: true,
      forbidAllTools: false,
    };
    context.mcp = { enabled: false, servers: [], tools: [] };
    context.skills = { enabled: false, skills: [], trustedIds: [], disabledIds: [] } as never;
    context.plugins = { enabled: false, plugins: [], trustedIds: [], disabledIds: [] } as never;

    const result = await executeDeferredDispatchToolUse(
      {
        id: "denied-extra-tool",
        name: "ExecuteExtraTool",
        input: { tool_name: "list_projects", params: {} },
      },
      context,
      "session-web",
      new WebToolOutput(),
    );

    expect(result.ok).toBe(false);
    expect(result.text).toContain("current request forbids shell commands");
    const toolResult = events.find(
      (event): event is {
        type: "tool_result";
        toolName: string;
        isError: boolean;
        content: string;
        evidenceId?: string;
      } =>
        (event as { type?: string }).type === "tool_result" &&
        (event as { toolName?: string }).toolName === "ExecuteExtraTool",
    );
    expect(toolResult).toMatchObject({
      isError: true,
      content: expect.stringContaining("current request forbids shell commands"),
    });
    expect(toolResult?.evidenceId).toBe(result.evidenceId);
    const evidence = context.evidence.find((record) => record.id === result.evidenceId);
    expect(evidence).toMatchObject({
      kind: "command_output",
      supportsClaims: expect.arrayContaining([
        "deferred_tool_output",
        "list_projects",
        "tool_failure",
      ]),
    });
  });

  it("records forbidAllTools ExecuteExtraTool denial as error tool_result and tool_failure evidence", async () => {
    const events: unknown[] = [];
    const context = createWebToolTestContext(events);
    context.config = defaultConfig;
    context.index = createIndexState(defaultConfig);
    context.discoveredDeferredToolNames = new Set(["list_projects"]);
    context.currentUserActionConstraintsRequestTurnId = "turn-web";
    context.currentUserActionConstraints = {
      readonlyOnly: true,
      forbidWrite: true,
      forbidTests: false,
      forbidBuild: false,
      forbidLint: false,
      forbidTypecheck: false,
      forbidSmoke: false,
      forbidShell: false,
      forbidAllTools: true,
    };
    context.mcp = { enabled: false, servers: [], tools: [] };
    context.skills = { enabled: false, skills: [], trustedIds: [], disabledIds: [] } as never;
    context.plugins = { enabled: false, plugins: [], trustedIds: [], disabledIds: [] } as never;

    const result = await executeDeferredDispatchToolUse(
      {
        id: "denied-all-extra-tool",
        name: "ExecuteExtraTool",
        input: { tool_name: "list_projects", params: {} },
      },
      context,
      "session-web",
      new WebToolOutput(),
    );

    expect(result.ok).toBe(false);
    expect(result.text).toContain("current request forbids all tools");
    const toolResult = events.find(
      (event): event is {
        type: "tool_result";
        toolName: string;
        isError: boolean;
        content: string;
        evidenceId?: string;
      } =>
        (event as { type?: string }).type === "tool_result" &&
        (event as { toolName?: string }).toolName === "ExecuteExtraTool",
    );
    expect(toolResult).toMatchObject({
      isError: true,
      content: expect.stringContaining("current request forbids all tools"),
    });
    expect(toolResult?.evidenceId).toBe(result.evidenceId);
    const evidence = context.evidence.find((record) => record.id === result.evidenceId);
    expect(evidence).toMatchObject({
      kind: "command_output",
      supportsClaims: expect.arrayContaining([
        "deferred_tool_output",
        "list_projects",
        "tool_failure",
      ]),
    });
  });

  it("does not pass cwd to slash fork when StartAgent requests managed worktree isolation", () => {
    const args = __testBuildForkArgsFromStartAgentInput(
      {
        ok: true,
        role: "explorer",
        task: "inspect renderer paths",
        name: "renderer-explorer",
        teamName: "renderer-team",
        runInBackground: true,
        cwd: "F:/Linghun",
        isolation: "worktree",
      },
      {} as TuiContext,
    );

    expect(args).toEqual([
      "explorer",
      "inspect renderer paths",
      "--background",
      "--name",
      "renderer-explorer",
      "--team",
      "renderer-team",
      "--isolation",
      "worktree",
    ]);
    expect(args).not.toContain("--cwd");
  });

  it("passes explicit full context fork mode from StartAgent to slash fork", () => {
    const parsed = __testParseStartAgentToolInput(
      { role: "planner", task: "inspect inherited state", context_mode: "full_fork" },
      { agentRegistry: { agents: [] } } as unknown as TuiContext,
    );

    expect(parsed).toMatchObject({
      ok: true,
      role: "planner",
      task: "inspect inherited state",
      contextMode: "full_fork",
    });
    if (parsed.ok) {
      expect(__testBuildForkArgsFromStartAgentInput(parsed, {} as TuiContext)).toEqual([
        "planner",
        "inspect inherited state",
        "--context-mode",
        "full_fork",
      ]);
    }
  });

  it("parses explicit RunWorkflow fork-team mode without changing daily defaults", () => {
    const defaultParsed = __testParseRunWorkflowToolInput({ goal: "normal workflow" });
    expect(defaultParsed).toMatchObject({
      ok: true,
      goal: "normal workflow",
      multiAgent: false,
    });
    if (defaultParsed.ok) {
      expect(defaultParsed.contextMode).toBeUndefined();
    }

    const forkParsed = __testParseRunWorkflowToolInput({
      goal: "parallel implementation",
      forkTeam: true,
      agents: 4,
      running_cap: 2,
    });
    expect(forkParsed).toMatchObject({
      ok: true,
      goal: "parallel implementation",
      agents: 4,
      runningCap: 2,
      multiAgent: true,
      contextMode: "full_fork",
    });
  });

  it("marks running StartAgent results as started-only instead of completion", () => {
    const result = __testBuildStartAgentToolResult(
      {
        id: "agent-running",
        type: "worker",
        role: "executor",
        provider: "openai-compatible",
        task: "inspect auth",
        model: "test-model",
        permissionMode: "default",
        status: "running",
        activityStatus: "processing",
        transcriptPath: "agent.jsonl",
        transcriptSessionId: "agent-session",
        mailbox: [],
        summary: "agent running",
        contextSummary: "handoff",
        cost: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          estimatedCny: 0,
        },
        startedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      } satisfies AgentRun,
      "not started",
      "zh-CN",
    );

    expect(result.ok).toBe(true);
    expect(result.text).toContain("still running");
    expect(result.data.lifecycleStatus).toBe("running");
    expect(result.data.terminal).toBe(false);
    expect(result.data.completionClaimAllowed).toBe(false);
    expect(result.data.nextAction).toContain("不要声称");
  });

  it("keeps workflow lifecycle separate from completion or verification claims", () => {
    const data = __testBuildWorkflowToolResultData(
      {
        id: "workflow-test",
        goal: "fix auth",
        planId: "plan-test",
        status: "completed",
        result: "partial",
        steps: [],
        startedAt: "2026-01-01T00:00:00.000Z",
      } satisfies WorkflowRunState,
      {
        ok: true,
        goal: "fix auth",
        runInBackground: false,
        multiAgent: true,
        agents: 2,
      } as Parameters<typeof __testBuildWorkflowToolResultData>[1],
      "zh-CN",
    );

    expect(data.lifecycleStatus).toBe("terminal");
    expect(data.terminal).toBe(true);
    expect(data.completionClaimAllowed).toBe(false);
    expect(data.verificationClaimAllowed).toBe(false);
    expect(data.nextAction).toContain("声称 PASS 前");
    expect(data.nextAction).toContain("精确文件路径");
    expect(data.nextAction).toContain("不要用宽泛 Glob 零结果推断文件不存在");
  });
});
