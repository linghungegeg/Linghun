import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { Writable } from "node:stream";
import {
  builtInTools,
  createToolContext,
  type ToolContext,
  type ToolOutput,
  type ToolProgressEvent,
} from "@linghun/tools";

import { createModelToolDefinitions } from "./model-loop-runtime.js";
import {
  __testBuildForkArgsFromStartAgentInput,
  __testBuildPreEngineFallbackRequiredResult,
  __testBuildStartAgentToolResult,
  __testBuildWorkflowToolResultData,
  __testFormatPreEnginePrimaryText,
  __testParseRunWorkflowToolInput,
  __testParseStartAgentToolInput,
  executeApprovedModelToolUse,
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

function createWebToolTestContext(events: unknown[]): TuiContext {
  return {
    tools: createToolContext(process.cwd()),
    currentRequestTurnId: "turn-web",
    store: {
      appendEvent: async (_sessionId: string, event: unknown) => {
        events.push(event);
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
    const context = createWebToolTestContext(events);
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
    builtInTools.WebSearch.call = (async () => ({
      text: "result",
      data: { isError: false, searches: 1, count: 1 },
    })) as typeof originalCall;
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
      expect(output.errors).toEqual([]);
      expect(output.text).toContain("执行 1 次搜索");
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
