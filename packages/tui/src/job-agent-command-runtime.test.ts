import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createToolContext } from "@linghun/tools";
import {
  __testFilterChildAgentSummaryEvidence,
  __testRunAgentToolInCwd,
  __testClearAgentAbortController,
  createAgentRuntimeForFallbackModel,
  evaluateChildAgentSummaryClaims,
  resolveAgentRuntimeForModel,
  resolveAgentDispatchRuntimePolicy,
} from "./job-agent-command-runtime.js";
import type { TuiContext } from "./tui-context-runtime.js";
import { formatAgentRunToolResultData } from "./model-tool-runtime.js";
import { formatAgentSummary, getAgentPermissionMode } from "./tui-agent-job-runtime.js";
import type { AgentRun, EvidenceRecord } from "./tui-data-types.js";

function makeAgent(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: "agent-1",
    type: "worker",
    role: "executor",
    provider: "test",
    task: "audit",
    model: "test-model",
    permissionMode: "default",
    status: "idle",
    lastTerminalStatus: "completed",
    summary: "worker completed: short summary",
    contextSummary: "agent context",
    lastResultSummary: "short summary",
    lastResultFullReport: "full child final report with all findings",
    transcriptPath: "agent-1.jsonl",
    transcriptSessionId: "child-session",
    mailbox: [],
    cost: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      estimatedCny: 0,
    },
    startedAt: "2026-06-12T00:00:00.000Z",
    updatedAt: "2026-06-12T00:00:00.000Z",
    ...overrides,
  };
}

describe("agent terminal status and full report consumption", () => {
  it("keeps verifier agents on the invocation permission mode", () => {
    expect(getAgentPermissionMode("verifier", "full-access")).toBe("full-access");
    expect(getAgentPermissionMode("verifier", "auto-review")).toBe("auto-review");
    expect(getAgentPermissionMode("verifier", "plan")).toBe("plan");
    expect(getAgentPermissionMode("explorer", "full-access")).toBe("plan");
  });

  it("formats idle completed agents using lastTerminalStatus instead of plain idle", () => {
    const line = formatAgentSummary(makeAgent(), {} as never);

    expect(line).toContain("completed");
    expect(line).not.toContain("· idle ·");
  });

  it("exposes full child report and transcript id in tool result data", () => {
    const data = formatAgentRunToolResultData(makeAgent());

    expect(data).toMatchObject({
      agentId: "agent-1",
      status: "idle",
      lastTerminalStatus: "completed",
      transcriptSessionId: "child-session",
      recentResult: "short summary",
      resultFullReport: "full child final report with all findings",
    });
  });

  it("keeps missing agents explicit instead of fabricating a report", () => {
    expect(formatAgentRunToolResultData(undefined)).toEqual({ status: "not_found" });
  });
});

describe("agent-owned tool context", () => {
  it("keeps Read snapshots across calls without sharing the main context", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-agent-tools-"));
    await writeFile(join(projectPath, "note.txt"), "before", "utf8");
    const context = {
      projectPath,
      tools: createToolContext(projectPath),
      agentToolContexts: new Map(),
    } as unknown as TuiContext;
    const agent = makeAgent({ id: "agent-snapshot", cwd: projectPath, status: "running" });
    const signal = new AbortController().signal;

    const read = await __testRunAgentToolInCwd(
      "Read",
      { path: "note.txt" },
      agent,
      context,
      signal,
    );
    const edit = await __testRunAgentToolInCwd(
      "Edit",
      { path: "note.txt", oldText: "before", newText: "after" },
      agent,
      context,
      signal,
    );

    expect(read.output.text).toContain("before");
    expect(edit.output.changedFiles).toContain("note.txt");
    expect(await readFile(join(projectPath, "note.txt"), "utf8")).toBe("after");
    expect(context.agentToolContexts?.get(agent.id)?.readSnapshots).toBeDefined();
    expect(context.tools.readSnapshots).toEqual({});
    expect(context.tools.changedFiles).toEqual(["note.txt"]);
  });

  it("isolates 100 interleaved agent snapshots and clears only terminal owners", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-agent-pressure-"));
    const context = {
      projectPath,
      tools: createToolContext(projectPath),
      agentToolContexts: new Map(),
      backgroundAbortControllers: new Map(),
    } as unknown as TuiContext;
    const signal = new AbortController().signal;
    const agents = Array.from({ length: 100 }, (_, index) => {
      const cwd = join(projectPath, `agent-${index}`);
      return makeAgent({ id: `agent-${index}`, cwd, status: "running" });
    });

    await Promise.all(
      agents.map(async (agent, index) => {
        await mkdir(agent.cwd!, { recursive: true });
        await writeFile(join(agent.cwd!, "note.txt"), `before-${index}`, "utf8");
      }),
    );
    await Promise.all(
      agents.map((agent) =>
        __testRunAgentToolInCwd("Read", { path: "note.txt" }, agent, context, signal),
      ),
    );
    await Promise.all(
      agents.map((agent, index) =>
        __testRunAgentToolInCwd(
          "Edit",
          { path: "note.txt", oldText: `before-${index}`, newText: `after-${index}` },
          agent,
          context,
          signal,
        ),
      ),
    );

    expect(context.agentToolContexts?.size).toBe(100);
    expect(context.tools.readSnapshots).toEqual({});
    expect(new Set(context.tools.changedFiles).size).toBe(100);
    expect(context.tools.changedFiles).toHaveLength(100);
    await Promise.all(
      agents.map(async (agent, index) => {
        expect(await readFile(join(agent.cwd!, "note.txt"), "utf8")).toBe(`after-${index}`);
      }),
    );

    context.pendingLocalApproval = {
      kind: "agent_tool_use",
      agentId: agents[0]!.id,
      agentTranscriptSessionId: "child-session",
      toolCall: { id: "tool-1", name: "Edit", input: {} },
      toolName: "Edit",
      sessionId: "session-1",
    };
    for (const agent of agents) __testClearAgentAbortController(context, agent.id);
    expect(context.agentToolContexts?.size).toBe(1);
    expect(context.agentToolContexts?.has(agents[0]!.id)).toBe(true);

    context.pendingLocalApproval = undefined;
    __testClearAgentAbortController(context, agents[0]!.id);
    expect(context.agentToolContexts?.size).toBe(0);
  });
});

describe("child agent summary claim gate", () => {
  const evidence = (
    supportsClaims: string[],
    overrides: Partial<EvidenceRecord> = {},
  ): EvidenceRecord => ({
    id: `ev-${supportsClaims.join("-")}`,
    kind: "command_output",
    summary: "test evidence",
    source: "test",
    supportsClaims,
    createdAt: new Date().toISOString(),
    ...overrides,
  });

  it("does not downgrade ordinary read-only audit findings", () => {
    const result = evaluateChildAgentSummaryClaims(
      "只读审计完成：已读取 README.md 并列出风险边界。",
      [],
      "zh-CN",
    );

    expect(result.status).toBe("passed");
    expect(result.text).toContain("只读审计完成");
  });

  it("does not downgrade readonly audit reports because details mention pass or fixes", () => {
    const report = [
      "**审计结论**",
      "",
      "P0：未发现。TaskBottomPane 本身不解析错误文案，也不按关键词判断失败。",
      "",
      "P1：后台 blocked banner 仍有一条正则/关键词路径，可能误导 running task。",
      "证据：view-model.ts 里仍可看到 resource cap 文案判断。",
      "最小修复：去掉 running 文本分支，改为结构状态字段；历史讨论里出现 updated/fixed/implemented 也只是引用。",
      "",
      "P2：provider failure 残留整体处理较好。",
      "历史文档中提到 PASS 和验证记录，但本报告没有声明测试通过。",
    ].join("\n");

    const result = evaluateChildAgentSummaryClaims(report, [], "zh-CN");

    expect(result.status).toBe("passed");
    expect(result.text).toContain("P1：后台 blocked banner");
    expect(result.text).not.toContain("按当前证据边界清洗");
  });

  it("does not downgrade single-paragraph readonly audit reports with pass and recommendation terms", () => {
    const result = evaluateChildAgentSummaryClaims(
      "只读审计报告：P0 无阻断；P1/P2 为风险分级。PASS 表示本条审计结论可读，不代表测试通过。验证状态：未运行。修复建议：补测试。",
      [],
      "zh-CN",
    );

    expect(result.status).toBe("passed");
    expect(result.text).toContain("P0 无阻断");
    expect(result.text).toContain("修复建议");
    expect(result.missingEvidenceKinds).toEqual([]);
  });

  it("ignores structured claim examples that are not the final child contract", () => {
    const report = [
      "**审计结论**",
      "",
      "P1：prompt 示例中展示了结构化 claims，不能当作本次 child 自己的完成声明。",
      "",
      '示例：LinghunFinalAnswerClaims: {"claims":[{"kind":"test_claim","phrase":"测试通过"}]}',
      "",
      "本报告没有运行测试。",
    ].join("\n");

    const result = evaluateChildAgentSummaryClaims(report, [], "zh-CN");

    expect(result.status).toBe("passed");
    expect(result.text).toContain("本报告没有运行测试");
  });

  it("does not downgrade long report body examples when the final contract has no claims", () => {
    const report = [
      "**审计结论**",
      "",
      "P1：某条历史输出示例写过：已修复完成，测试通过，PASS。",
      "这只是被审计对象的示例文本，不是 child agent 本轮执行结果。",
      "",
      "最终结论：只读审计完成；本报告没有运行测试，也没有修改文件。",
      'LinghunFinalAnswerClaims: {"claims":[]}',
    ].join("\n");

    const result = evaluateChildAgentSummaryClaims(report, [], "zh-CN");

    expect(result.status).toBe("passed");
    expect(result.text).toContain("只读审计完成");
  });

  it("downgrades empty final contracts when the final closure still claims execution", () => {
    const report = [
      "**执行结果**",
      "",
      "检查了相关路径。",
      "",
      "最终结论：已修复完成，测试通过，PASS。",
      'LinghunFinalAnswerClaims: {"claims":[]}',
    ].join("\n");

    const result = evaluateChildAgentSummaryClaims(report, [], "zh-CN");

    expect(result.status).toBe("downgraded");
    expect(result.missingEvidenceKinds).toContain("test result evidence");
    expect(result.missingEvidenceKinds).toContain("file change evidence");
  });

  it("downgrades structured contracts that under-report visible final closure claims", () => {
    const report = [
      "**执行结果**",
      "",
      "检查了相关路径。",
      "",
      "最终结论：已修复完成，测试通过。",
      'LinghunFinalAnswerClaims: {"claims":[{"kind":"test_claim","phrase":"测试通过"}]}',
    ].join("\n");

    const result = evaluateChildAgentSummaryClaims(
      report,
      [evidence(["test_passed"])],
      "zh-CN",
    );

    expect(result.status).toBe("downgraded");
    expect(result.missingEvidenceKinds).toContain("file change evidence");
  });

  it("downgrades final closure claims even when earlier body contains fenced code", () => {
    const report = [
      "**执行结果**",
      "",
      "示例代码：",
      "```ts",
      "const status = 'PASS';",
      "```",
      "",
      "最终结论：已修复完成，测试通过。",
      'LinghunFinalAnswerClaims: {"claims":[]}',
    ].join("\n");

    const result = evaluateChildAgentSummaryClaims(report, [], "zh-CN");

    expect(result.status).toBe("downgraded");
    expect(result.missingEvidenceKinds).toContain("test result evidence");
    expect(result.missingEvidenceKinds).toContain("file change evidence");
  });

  it("cleans unsupported test pass claims before agent summary returns", () => {
    const result = evaluateChildAgentSummaryClaims("测试通过，PASS。", [], "zh-CN");

    expect(result.status).toBe("downgraded");
    expect(result.text).toContain("按当前证据边界清洗");
    expect(result.text).toContain("验证或测试证据");
    expect(result.text).not.toContain("降级");
    expect(result.text).not.toContain("test_claim");
    expect(result.text).not.toContain("completion_pass");
    expect(result.missingEvidenceKinds).toContain("test result evidence");
  });

  it("allows test pass claims when matching test evidence exists", () => {
    const result = evaluateChildAgentSummaryClaims(
      "测试通过，PASS。",
      [evidence(["test_passed"])],
      "zh-CN",
    );

    expect(result.status).toBe("passed");
  });

  it("allows real pass and fix claims when matching child evidence exists", () => {
    const result = evaluateChildAgentSummaryClaims(
      "已修复完成，测试通过，PASS。",
      [evidence(["test_passed"]), evidence(["Edit", "file_written"])],
      "zh-CN",
    );

    expect(result.status).toBe("passed");
    expect(result.missingEvidenceKinds).toEqual([]);
  });

  it("still enforces structured claims in long child reports", () => {
    const report = [
      "**审计结论**",
      "",
      "P0：未发现。",
      "",
      "详细证据已整理。",
      'LinghunFinalAnswerClaims: {"claims":[{"kind":"test_claim","phrase":"测试通过"}]}',
    ].join("\n");

    const result = evaluateChildAgentSummaryClaims(report, [], "zh-CN");

    expect(result.status).toBe("downgraded");
    expect(result.missingEvidenceKinds).toContain("test result evidence");
  });

  it("passes structured claims in long child reports when child evidence matches", () => {
    const report = [
      "**执行结果**",
      "",
      "已修复完成并运行 focused tests。",
      "",
      'LinghunFinalAnswerClaims: {"claims":[{"kind":"test_claim","phrase":"focused tests passed"},{"kind":"file_change_claim","phrase":"已修复完成"}]}',
    ].join("\n");

    const result = evaluateChildAgentSummaryClaims(
      report,
      [evidence(["test_passed"]), evidence(["Edit", "file_written"])],
      "zh-CN",
    );

    expect(result.status).toBe("passed");
    expect(result.missingEvidenceKinds).toEqual([]);
  });

  it("evaluates child summary claims only against current agent request workflow cwd evidence", () => {
    const agent = makeAgent({
      id: "agent-current",
      invokingRequestTurnId: "request-current",
      parentSessionId: "session-current",
      cwd: "F:/repo/worktrees/current",
    });
    const matching = evidence(["test_passed"], {
      id: "ev-matching",
      ownerScope: {
        ownerAgentId: "agent-current",
        requestTurnId: "request-current",
        workflowRunId: "workflow-current",
        ownerSessionId: "session-current",
        cwd: "F:/repo/worktrees/current/src",
      },
    });
    const context = {
      projectPath: "F:/repo",
      language: "zh-CN",
      backgroundTasks: [
        {
          id: "agent-current",
          kind: "agent",
          title: "agent current",
          status: "running",
          startedAt: "2026-06-12T00:00:00.000Z",
          updatedAt: "2026-06-12T00:00:00.000Z",
          heartbeatIntervalMs: 1_000,
          staleAfterMs: 60_000,
          hasOutput: false,
          workflowRunId: "workflow-current",
        },
      ],
      evidence: [
        evidence(["test_passed"], {
          id: "ev-wrong-agent",
          ownerScope: {
            ownerAgentId: "agent-other",
            requestTurnId: "request-current",
            workflowRunId: "workflow-current",
            ownerSessionId: "session-current",
            cwd: "F:/repo/worktrees/current",
          },
        }),
        evidence(["test_passed"], {
          id: "ev-wrong-request",
          ownerScope: {
            ownerAgentId: "agent-current",
            requestTurnId: "request-other",
            workflowRunId: "workflow-current",
            ownerSessionId: "session-current",
            cwd: "F:/repo/worktrees/current",
          },
        }),
        evidence(["test_passed"], {
          id: "ev-wrong-workflow",
          ownerScope: {
            ownerAgentId: "agent-current",
            requestTurnId: "request-current",
            workflowRunId: "workflow-other",
            ownerSessionId: "session-current",
            cwd: "F:/repo/worktrees/current",
          },
        }),
        evidence(["test_passed"], {
          id: "ev-wrong-cwd",
          ownerScope: {
            ownerAgentId: "agent-current",
            requestTurnId: "request-current",
            workflowRunId: "workflow-current",
            ownerSessionId: "session-current",
            cwd: "F:/repo/worktrees/other",
          },
        }),
        evidence(["test_passed"], {
          id: "ev-missing-session",
          ownerScope: {
            ownerAgentId: "agent-current",
            requestTurnId: "request-current",
            workflowRunId: "workflow-current",
            cwd: "F:/repo/worktrees/current",
          },
        }),
        evidence(["test_passed"], {
          id: "ev-wrong-session",
          ownerScope: {
            ownerAgentId: "agent-current",
            requestTurnId: "request-current",
            workflowRunId: "workflow-current",
            ownerSessionId: "session-other",
            cwd: "F:/repo/worktrees/current",
          },
        }),
      ],
    } as unknown as TuiContext;

    const filteredWrongEvidence = __testFilterChildAgentSummaryEvidence(context, agent);
    expect(filteredWrongEvidence).toEqual([]);
    expect(evaluateChildAgentSummaryClaims("测试通过，PASS。", filteredWrongEvidence, "zh-CN").status)
      .toBe("downgraded");

    context.evidence = [...context.evidence, matching];
    const filtered = __testFilterChildAgentSummaryEvidence(context, agent);
    expect(filtered.map((record) => record.id)).toEqual(["ev-matching"]);
    expect(evaluateChildAgentSummaryClaims("测试通过，PASS。", filtered, "zh-CN").status).toBe(
      "passed",
    );
  });

  it("downgrades unsupported file change claims", () => {
    const result = evaluateChildAgentSummaryClaims("已经修复完成。", [], "zh-CN");

    expect(result.status).toBe("downgraded");
    expect(result.missingEvidenceKinds).toContain("file change evidence");
  });
});

describe("agent dispatch runtime policy", () => {
  const action = (mode: "run" | "ask" | "degrade" | "stop") => ({
    mode,
    reason: `${mode} reason`,
    shouldAsk: mode === "ask",
    shouldDegrade: mode === "degrade",
    shouldStop: mode === "stop",
  });

  it("blocks agent dispatch when the scheduler asks or stops", () => {
    expect(
      resolveAgentDispatchRuntimePolicy(action("ask"), {
        kind: "fork-agent",
        type: "worker",
        start: true,
      }),
    ).toEqual({ action: "block", reason: "ask reason" });
    expect(
      resolveAgentDispatchRuntimePolicy(action("stop"), {
        kind: "durable-job",
        start: true,
      }),
    ).toEqual({ action: "block", reason: "stop reason" });
  });

  it("blocks durable job run degrade that would change start intent", () => {
    expect(
      resolveAgentDispatchRuntimePolicy(action("degrade"), {
        kind: "durable-job",
        start: true,
      }),
    ).toEqual({
      action: "block",
      reason:
        "degrade reason; refusing to turn a requested job start into create-only without explicit confirmation",
    });
  });

  it("blocks non-planner fork agent degrade that would change requested role", () => {
    expect(
      resolveAgentDispatchRuntimePolicy(action("degrade"), {
        kind: "fork-agent",
        type: "worker",
        start: true,
      }),
    ).toEqual({
      action: "block",
      reason:
        "degrade reason; refusing to change requested worker agent into planner without explicit confirmation",
    });
  });
});

describe("agent provider reasoning contract", () => {
  const runtime = {
    provider: "gemini",
    model: "gemini-test",
    endpointProfile: "chat_completions" as const,
    reasoningLevel: "High",
    reasoningSent: false,
  };

  it("uses the Gemini contract for the selected agent model", () => {
    const context = {
      config: {
        providers: {
          gemini: { type: "gemini", model: "gemini-test", reasoningLevel: "High" },
        },
      },
    } as unknown as TuiContext;

    expect(resolveAgentRuntimeForModel(context, runtime, "gemini-test")).toMatchObject({
      endpointProfile: "chat_completions",
      reasoningSent: true,
    });
  });

  it("uses the Grok contract for an agent fallback model", () => {
    const context = {
      config: {
        providers: {
          gemini: { type: "gemini", model: "gemini-test", reasoningLevel: "High" },
          grok: { type: "grok", model: "grok-test", reasoningLevel: "High" },
        },
      },
    } as unknown as TuiContext;

    expect(createAgentRuntimeForFallbackModel(context, runtime, "grok-test")).toMatchObject({
      provider: "grok",
      endpointProfile: "responses",
      reasoningSent: false,
    });
  });
});
