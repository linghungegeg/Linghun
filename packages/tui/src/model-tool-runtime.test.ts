import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { createModelToolDefinitions } from "./model-loop-runtime.js";
import {
  __testBuildForkArgsFromStartAgentInput,
  __testBuildPreEngineFallbackRequiredResult,
  __testBuildStartAgentToolResult,
  __testBuildWorkflowToolResultData,
  __testFormatPreEnginePrimaryText,
  rememberSourcePackCandidatesFromToolData,
  rememberToolFiles,
} from "./model-tool-runtime.js";
import { formatToolOutput } from "./tool-output-presenter.js";
import type { TuiContext } from "./tui-context-runtime.js";
import type { AgentRun, WorkflowRunState } from "./tui-data-types.js";

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
  });
});
