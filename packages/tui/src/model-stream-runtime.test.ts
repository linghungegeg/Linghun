import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "@linghun/config";
import type { ModelGateway } from "@linghun/providers";
import { createToolContext } from "@linghun/tools";
import {
  __testRunFinalGateEvidenceAction,
  __testStreamFinalModelAnswerWithoutTools,
  buildFinalGateClaimAlignmentFallback,
  buildEvidenceBackedFinalBoundaryAnswer,
  createToolFailureRecoveryFingerprint,
  createToolBatchFailFastSkippedResult,
  evaluateAggregatedFinalAnswerGate,
  handleNaturalInput,
  isToolBatchFailure,
  planFinalGateEvidenceGapAction,
  shouldRewriteFinalGateClaimAlignment,
  shouldContinueAfterToolFailureWithoutToolCall,
  shouldRetryHighReasoningToolsEmptyResponse,
  updateToolFailureRecoveryState,
} from "./model-stream-runtime.js";
import { createProviderCircuitBreakerState } from "./provider-circuit-breaker.js";
import { createShellBlockOutputForTest } from "./tui-output-surface.js";
import type { EvidenceRecord } from "./tui-data-types.js";

function withClaims(text: string, claims: Array<{ kind: string; phrase: string }>): string {
  return `${text}\nLinghunFinalAnswerClaims: ${JSON.stringify({ claims })}`;
}

function makeGateContext() {
  return {
    evidence: [],
    currentArchitectureCard: undefined,
    solutionCompleteness: {
      triggered: false,
      classificationRequired: true,
      classification: "systemic_gap",
      impactAreas: [],
      severity: "unknown",
    },
  };
}

function makeEvidence(partial: Partial<EvidenceRecord>): EvidenceRecord {
  return {
    id: "evid-stream-test",
    kind: "command_output",
    summary: "",
    source: "",
    supportsClaims: [],
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

class MemoryOutput extends Writable {
  text = "";

  override _write(chunk: unknown, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.text += String(chunk);
    callback();
  }
}

type TestStreamEvent =
  | { type: "assistant_text_delta"; text: string }
  | { type: "message_stop"; chunkCount: number; hadUsage: boolean; finishReason?: string };

function gatewayByTurn(turns: TestStreamEvent[][], calls: { count: number }): ModelGateway {
  return {
    async *stream() {
      const events = turns[calls.count] ?? [];
      calls.count += 1;
      for (const event of events) yield event;
    },
    async countMessagesTokensWithAPI() {
      return { source: "unavailable", reason: "test" };
    },
  } as unknown as ModelGateway;
}

function makeDispatcherContext(projectPath: string) {
  const events: Array<{ sessionId: string; event: unknown }> = [];
  const context = {
    store: {
      appendEvent: async (sessionId: string, event: unknown) => {
        events.push({ sessionId, event });
      },
    },
    sessionId: "session-final-gate-dispatch",
    model: "test-model",
    permissionMode: "default",
    projectPath,
    tools: createToolContext(projectPath),
    permissions: { rules: [], recentDenied: [] },
    language: "zh-CN",
    backgroundTasks: [],
    checkpoints: [],
    evidence: [],
    cache: { history: [] },
    mcp: { servers: [] },
    index: { status: "ready" },
    memory: {},
    failureLearning: { records: [] },
    skills: { items: [] },
    workflows: {},
    agentRegistry: { agents: [], errors: [] },
    workflowRegistry: { workflows: [], errors: [] },
    hooks: { hooks: [] },
    plugins: { plugins: [] },
    remote: {},
    agents: [],
    roleUsage: [],
    routeDecisions: [],
    roleHandoffs: [],
    visionObservations: [],
    imageResults: [],
    interrupt: { type: "idle" },
    recentlyMentionedFiles: [],
    providerBreaker: {},
    solutionCompleteness: makeGateContext().solutionCompleteness,
    discoveredDeferredToolNames: new Set<string>(),
    isInkSession: true,
  };
  return { context: context as never, events };
}

function makeNaturalInputContext(language: "zh-CN" | "en-US" = "zh-CN") {
  return {
    language,
    pendingLocalApproval: undefined,
    pendingNaturalCommand: undefined,
    pendingAutopilot: undefined,
    backgroundTasks: [],
    cache: { history: [] },
    memory: { learningMode: "off", candidates: [], accepted: [] },
    permissionMode: "default",
    index: { status: "ready" },
    model: "test-model",
    config: {
      defaultModel: "test-model",
      providers: {
        test: {
          type: "deepseek",
          model: "test-model",
          apiKey: "test-key",
        },
      },
      modelRoutes: {
        routes: [{ role: "executor", provider: "test", primaryModel: "test-model" }],
      },
    },
  };
}

describe("tool batch fail-fast helpers", () => {
  it("counts failed tool results as failures even when they carry evidence", () => {
    expect(isToolBatchFailure({ ok: false, evidenceId: "evidence-1" } as never)).toBe(true);
    expect(isToolBatchFailure({ ok: true, evidenceId: "evidence-1" } as never)).toBe(false);
  });

  it("creates skipped tool result with the original tool call id handled by caller", () => {
    const skipped = createToolBatchFailFastSkippedResult(
      { id: "call-4", name: "Read", input: { file_path: "x.ts" } },
      "Read failed",
    );

    expect(skipped).toMatchObject({
      ok: false,
      tool: "Read",
      data: { skipped: true, reason: "tool_batch_fail_fast", lastFailure: "Read failed" },
    });
  });
});

describe("tool failure recovery guard", () => {
  it("does not stop while the model changes failed tool inputs", () => {
    let state = { repeatedFailureRounds: 0 };
    const first = createToolFailureRecoveryFingerprint(
      { name: "Edit", input: { file_path: "a.ts", old_string: "old one", new_string: "new" } },
      { tool: "Edit", text: "old_string not found" },
    );
    let result = updateToolFailureRecoveryState(state, [first], 4);
    expect(result.shouldStop).toBe(false);
    expect(result.state.repeatedFailureRounds).toBe(1);

    const changedInput = createToolFailureRecoveryFingerprint(
      { name: "Edit", input: { file_path: "a.ts", old_string: "old two", new_string: "new" } },
      { tool: "Edit", text: "old_string not found" },
    );
    result = updateToolFailureRecoveryState(result.state, [changedInput], 4);
    expect(result.shouldStop).toBe(false);
    expect(result.state.repeatedFailureRounds).toBe(1);

    state = result.state;
    const changedTool = createToolFailureRecoveryFingerprint(
      { name: "Read", input: { file_path: "a.ts" } },
      { tool: "Read", text: "file not found" },
    );
    result = updateToolFailureRecoveryState(state, [changedTool], 4);
    expect(result.shouldStop).toBe(false);
    expect(result.state.repeatedFailureRounds).toBe(1);
  });

  it("stops only after the same failed action repeats past the enlarged limit", () => {
    let state = { repeatedFailureRounds: 0 };
    const fingerprint = createToolFailureRecoveryFingerprint(
      { name: "Edit", input: { file_path: "a.ts", old_string: "same", new_string: "new" } },
      { tool: "Edit", text: "old_string not found" },
    );

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const result = updateToolFailureRecoveryState(state, [fingerprint], 4);
      expect(result.shouldStop).toBe(false);
      expect(result.state.repeatedFailureRounds).toBe(attempt);
      state = result.state;
    }

    const stopped = updateToolFailureRecoveryState(state, [fingerprint], 4);
    expect(stopped.shouldStop).toBe(true);
    expect(stopped.state.repeatedFailureRounds).toBe(5);
  });

  it("continues after a failed tool round when the next assistant turn has no tool call", () => {
    expect(
      shouldContinueAfterToolFailureWithoutToolCall({ repeatedFailureRounds: 1 }, 0, 4),
    ).toBe(true);
    expect(
      shouldContinueAfterToolFailureWithoutToolCall({ repeatedFailureRounds: 1 }, 4, 4),
    ).toBe(false);
    expect(
      shouldContinueAfterToolFailureWithoutToolCall({ repeatedFailureRounds: 0 }, 0, 4),
    ).toBe(false);
  });
});

describe("high reasoning tool empty response retry", () => {
  it("retries once for High reasoning tool-capable Responses and Anthropic profiles", () => {
    expect(
      shouldRetryHighReasoningToolsEmptyResponse({
        endpointProfile: "responses",
        reasoningLevel: "High",
        reasoningSent: true,
        toolsEnabled: true,
        alreadyRetried: false,
      }),
    ).toBe(true);
    expect(
      shouldRetryHighReasoningToolsEmptyResponse({
        endpointProfile: "anthropic_messages",
        reasoningLevel: "High",
        reasoningSent: true,
        toolsEnabled: true,
        alreadyRetried: false,
      }),
    ).toBe(true);
  });

  it("does not retry by lowering non-High reasoning or after the retry was used", () => {
    expect(
      shouldRetryHighReasoningToolsEmptyResponse({
        endpointProfile: "responses",
        reasoningLevel: "Medium",
        reasoningSent: true,
        toolsEnabled: true,
        alreadyRetried: false,
      }),
    ).toBe(false);
    expect(
      shouldRetryHighReasoningToolsEmptyResponse({
        endpointProfile: "responses",
        reasoningLevel: "High",
        reasoningSent: true,
        toolsEnabled: true,
        alreadyRetried: true,
      }),
    ).toBe(false);
  });
});

describe("final answer gate aggregation", () => {
  it("aggregates claim gate and extended gate issues in one verdict", () => {
    const result = evaluateAggregatedFinalAnswerGate(
      makeGateContext() as never,
      withClaims("测试通过，架构已闭合。", [
        { kind: "completion_pass", phrase: "测试通过" },
        { kind: "completeness", phrase: "架构已闭合" },
      ]),
    );

    expect(result.status).toBe("needs_disclaimer");
    if (result.status !== "needs_disclaimer") return;
    expect(result.claimVerdict?.unsupportedKinds).toContain("completion_pass");
    expect(result.extendedVerdict?.unsupportedKinds).toContain("completeness");
    expect(result.unsupportedKinds).toEqual(
      expect.arrayContaining(["completion_pass", "completeness"]),
    );
  });

  it("can skip the extended gate when the scheduler disables it", () => {
    const result = evaluateAggregatedFinalAnswerGate(
      makeGateContext() as never,
      withClaims("架构已闭合。", [{ kind: "completeness", phrase: "架构已闭合" }]),
      false,
    );

    expect(result.status).toBe("passed");
  });

  it("builds an evidence-backed boundary answer instead of a user-visible checklist", () => {
    const result = evaluateAggregatedFinalAnswerGate(
      makeGateContext() as never,
      withClaims("测试通过。", [{ kind: "completion_pass", phrase: "测试通过" }]),
      false,
    );

    expect(result.status).toBe("needs_disclaimer");
    if (result.status !== "needs_disclaimer") return;
    const answer = buildEvidenceBackedFinalBoundaryAnswer(result, "zh-CN");
    expect(answer).toContain("基于当前已记录证据");
    expect(answer).toContain("验证或测试证据");
    expect(answer).toContain("证据范围");
    expect(answer).not.toContain("任务状态");
    expect(answer).not.toContain("下一步");
    expect(answer).not.toContain("完成或验证声明");
    expect(answer).not.toContain("completion_pass");
  });

  it("evidence-backed boundary answer includes a compact evidence summary", () => {
    const result = evaluateAggregatedFinalAnswerGate(
      makeGateContext() as never,
      withClaims("测试通过。", [{ kind: "completion_pass", phrase: "测试通过" }]),
      false,
    );

    expect(result.status).toBe("needs_disclaimer");
    if (result.status !== "needs_disclaimer") return;
    const answer = buildEvidenceBackedFinalBoundaryAnswer(result, "zh-CN", [
      {
        id: "evidence-1",
        kind: "test_result",
        summary: "focused tests passed",
        source: "verify.log",
        supportsClaims: ["verification_passed"],
        createdAt: new Date(0).toISOString(),
      },
    ]);
    expect(answer).toContain("证据范围");
    expect(answer).toContain("已有 1 条记录");
    expect(answer).toContain("验证记录");
    expect(answer).not.toContain("任务状态：最终回答等待证据确认");
    expect(answer).not.toContain("下一步");
    expect(answer).not.toContain("verification=");
    expect(answer).not.toContain("focused tests passed");
    expect(answer).not.toContain("command_output:");
  });

  it("rewrites claim alignment instead of showing the checklist when fresh test_passed evidence exists", () => {
    const context = {
      ...makeGateContext(),
      evidence: [
        makeEvidence({
          kind: "command_output",
          summary: "Bash: vitest run exited 0",
          supportsClaims: ["Bash", "command_ran", "bash_exit_0", "test_passed"],
        }),
      ],
    };
    const result = evaluateAggregatedFinalAnswerGate(
      context as never,
      withClaims("已完成，测试通过。", [{ kind: "completion_claim", phrase: "已完成" }]),
      false,
    );

    expect(result.status).toBe("needs_disclaimer");
    expect(shouldRewriteFinalGateClaimAlignment(result, context as never)).toBe(true);
    const fallback = buildFinalGateClaimAlignmentFallback("zh-CN");
    expect(fallback).not.toMatch(
      /当前证据不足|任务状态|缺少证据|当前证据|下一步|LinghunFinalAnswerClaims|completion_claim|task completion evidence|unsupportedKinds|retry|downgrade|被拦截的声明类型/iu,
    );
  });

  it("rewrites claim alignment instead of showing the checklist when fresh verification_passed evidence exists", () => {
    const context = {
      ...makeGateContext(),
      evidence: [
        makeEvidence({
          kind: "test_result",
          summary: "focused verification passed",
          supportsClaims: ["verification_passed"],
        }),
      ],
    };
    const result = evaluateAggregatedFinalAnswerGate(
      context as never,
      withClaims("已完成。", [{ kind: "completion_claim", phrase: "已完成" }]),
      false,
    );

    expect(result.status).toBe("needs_disclaimer");
    expect(shouldRewriteFinalGateClaimAlignment(result, context as never)).toBe(true);
    if (result.status !== "needs_disclaimer") return;
    const visibleFallback = buildEvidenceBackedFinalBoundaryAnswer(result, "zh-CN", context.evidence);
    expect(visibleFallback).toContain("证据范围");
    expect(visibleFallback).not.toContain("任务状态");
    expect(visibleFallback).not.toContain("下一步");
  });

  it("no-tool final rewrites claim alignment through the model before committing", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-no-tool-final-"));
    const { context } = makeDispatcherContext(projectPath);
    Object.assign(context, {
      config: defaultConfig,
      providerBreaker: createProviderCircuitBreakerState(),
      evidence: [
        makeEvidence({
          kind: "test_result",
          summary: "focused verification passed",
          supportsClaims: ["verification_passed"],
        }),
      ],
      cache: { history: [], deepCompact: undefined },
    });
    const blocks: Array<{ id: string; fullText?: string; summary?: string }> = [];
    const output = createShellBlockOutputForTest(context, blocks as never);
    const calls = { count: 0 };
    const rawDraft = withClaims("已完成。", [{ kind: "completion_claim", phrase: "已完成" }]);
    const alignedAnswer = withClaims("已按已有验证证据收窄：验证通过。", [
      { kind: "verification_claim", phrase: "验证通过" },
    ]);

    const finalText = await __testStreamFinalModelAnswerWithoutTools(
      {
        messages: [{ role: "user", content: "请给最终结论" }],
        provider: "test",
        model: "test-model",
        endpointProfile: "chat_completions",
        reasoningSent: false,
      },
      context,
      gatewayByTurn(
        [
          [
            { type: "assistant_text_delta", text: rawDraft },
            { type: "message_stop", chunkCount: 1, hadUsage: false, finishReason: "stop" },
          ],
          [
            { type: "assistant_text_delta", text: alignedAnswer },
            { type: "message_stop", chunkCount: 1, hadUsage: false, finishReason: "stop" },
          ],
        ],
        calls,
      ),
      "session-no-tool-final",
      output,
      new AbortController().signal,
    );

    const serializedBlocks = JSON.stringify(blocks);
    expect(calls.count).toBe(2);
    expect(finalText).toContain("验证通过");
    expect(finalText).not.toMatch(
      /当前证据不足|任务状态|当前证据|下一步|LinghunFinalAnswerClaims|completion_claim|task completion evidence|unsupportedKinds|retry|downgrade/iu,
    );
    expect(serializedBlocks).toContain("验证通过");
    expect(serializedBlocks).not.toContain(rawDraft);
    expect((context as { lastFullOutput?: string }).lastFullOutput ?? "").not.toContain(rawDraft);
  });

  it("no-tool final gathers git evidence and returns to the model instead of downgrading", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-no-tool-git-final-"));
    const { context, events } = makeDispatcherContext(projectPath);
    Object.assign(context, {
      config: defaultConfig,
      providerBreaker: createProviderCircuitBreakerState(),
      cache: { history: [], deepCompact: undefined },
    });
    const blocks: Array<{ id: string; fullText?: string; summary?: string }> = [];
    const output = createShellBlockOutputForTest(context, blocks as never);
    const calls = { count: 0 };
    const rawDraft = withClaims("稳定点已经确认。", [
      { kind: "git_operation", phrase: "稳定点已经确认" },
    ]);
    const repairedAnswer = "当前只是完成了 Git 状态检查，还没有创建提交。";

    const finalText = await __testStreamFinalModelAnswerWithoutTools(
      {
        messages: [{ role: "user", content: "确认 Git 状态后回答" }],
        provider: "test",
        model: "test-model",
        endpointProfile: "chat_completions",
        reasoningSent: false,
      },
      context,
      gatewayByTurn(
        [
          [
            { type: "assistant_text_delta", text: rawDraft },
            { type: "message_stop", chunkCount: 1, hadUsage: false, finishReason: "stop" },
          ],
          [
            { type: "assistant_text_delta", text: repairedAnswer },
            { type: "message_stop", chunkCount: 1, hadUsage: false, finishReason: "stop" },
          ],
        ],
        calls,
      ),
      "session-no-tool-git-final",
      output,
      new AbortController().signal,
    );

    const eventsText = JSON.stringify(events);
    expect(calls.count).toBe(2);
    expect(eventsText).toContain("GitStatusInspect");
    expect(finalText).toContain("还没有创建提交");
    expect(finalText).not.toContain("任务状态");
    expect(finalText).not.toContain("当前证据");
    expect(finalText).not.toContain("git_operation");
    expect(JSON.stringify(blocks)).not.toContain(rawDraft);
  });

  it("still plans evidence gathering or permission when no matching evidence exists", () => {
    const context = { ...makeGateContext(), permissionMode: "default", language: "zh-CN" };
    const result = evaluateAggregatedFinalAnswerGate(
      context as never,
      withClaims("已完成。", [{ kind: "completion_claim", phrase: "已完成" }]),
      false,
    );

    expect(result.status).toBe("needs_disclaimer");
    expect(shouldRewriteFinalGateClaimAlignment(result, context as never)).toBe(false);
    if (result.status !== "needs_disclaimer") return;
    const plan = planFinalGateEvidenceGapAction({
      result,
      context: context as never,
      userText: "继续修复",
    });
    expect(plan.action).toBe("verification_request");
  });

  it("engineering boundary answer uses user-facing wording instead of raw boundary hints", () => {
    const answer = buildEvidenceBackedFinalBoundaryAnswer(
      {
        status: "needs_disclaimer",
        engineeringVerdict: {
          unsupportedKinds: ["engineering_service_unverified"],
          message: "final should state whether service/port/log/health checks were actually verified",
        },
        unsupportedKinds: ["engineering_service_unverified"],
      } as never,
      "zh-CN",
      [],
    );

    expect(answer).toContain("服务运行证据");
    expect(answer).toContain("证据范围");
    expect(answer).not.toContain("final should state");
    expect(answer).not.toContain("service/port/log/health");
  });

  it("does not keep stale provider-error engineering signal after provider recovery", () => {
    const context = {
      ...makeGateContext(),
      lastMetaSchedulerDecision: {
        policyDecision: {
          engineeringSignal: { failureCategory: "provider_error" },
        },
      },
    };

    const recovered = evaluateAggregatedFinalAnswerGate(
      context as never,
      "已基于当前记录完成回复。",
      false,
    );
    expect(recovered.status).toBe("passed");

    const activeFailure = evaluateAggregatedFinalAnswerGate(
      {
        ...context,
        lastProviderFailure: {
          code: "PROVIDER_STREAM_ERROR",
          kind: "transit",
          provider: "openai-compatible",
          model: "gpt-5.5",
          endpointProfile: "responses",
          summary: "provider stream interrupted",
          evidenceId: "provider-failure",
          createdAt: new Date().toISOString(),
        },
      } as never,
      "已完成并验证通过。",
      false,
    );
    expect(activeFailure.status).toBe("needs_disclaimer");
    if (activeFailure.status !== "needs_disclaimer") return;
    expect(activeFailure.unsupportedKinds).toContain("engineering_provider_error");
  });

  it("first final-gate retry runs the runtime evidence action dispatcher", async () => {
    const source = await readFile(new URL("./model-stream-runtime.ts", import.meta.url), "utf8");
    expect(source).toContain("runFinalGateEvidenceAction");
    expect(source).toContain("executeModelToolUse(");
    expect(source).toContain("final_answer_gap_action dispatch");
    expect(source).toContain("final_answer_gap_planner final_no_tools=yes");
    expect(source).toContain("final_answer_gap_planner final_safety=yes");
    expect(source).toContain("final_answer_gap_planner continuation_final_safety=yes");
    expect(source).not.toContain("content: createAggregatedFinalAnswerReminder");
  });

  it("keeps claim-alignment rewrite reachable after evidence_recorded and in continuation", async () => {
    const source = await readFile(new URL("./model-stream-runtime.ts", import.meta.url), "utf8");
    expect(source).not.toContain("if (!finalAnswerClaimRetried && assistantText)");
    expect(source).toContain("final_answer_claim_alignment_rewrite attempt=");
    expect(source).toContain("final_answer_claim_alignment_rewrite continuation=yes");
    expect(source).toContain("final_answer_claim_alignment_rewrite final_safety=yes");
    expect(source).toContain("final_answer_claim_alignment_rewrite continuation_final_safety=yes");
    expect(source).toContain("actionResult.status === \"evidence_recorded\"");
  });

  it("plans verification gaps in plan mode without Bash or automatic test execution", () => {
    const result = evaluateAggregatedFinalAnswerGate(
      makeGateContext() as never,
      withClaims("测试通过。", [{ kind: "completion_pass", phrase: "测试通过" }]),
      false,
    );

    expect(result.status).toBe("needs_disclaimer");
    if (result.status !== "needs_disclaimer") return;
    const plan = planFinalGateEvidenceGapAction({
      result,
      context: { ...makeGateContext(), permissionMode: "plan", language: "zh-CN" } as never,
      userText: "只定位，不要运行测试",
    });

    expect(plan.action).toBe("blocked_explanation");
    expect(plan.directive).toContain("不要执行命令/测试");
    expect(plan.directive).not.toContain("Bash");
    expect(plan.directive).not.toContain("RunVerification");
    expect(plan.evidenceAction).toBeUndefined();
  });

  it("blocks automatic verification when the user says not to modify", () => {
    const result = evaluateAggregatedFinalAnswerGate(
      makeGateContext() as never,
      withClaims("已验证。", [{ kind: "verification_claim", phrase: "已验证" }]),
      false,
    );

    expect(result.status).toBe("needs_disclaimer");
    if (result.status !== "needs_disclaimer") return;
    const plan = planFinalGateEvidenceGapAction({
      result,
      context: { ...makeGateContext(), permissionMode: "full-access", language: "zh-CN" } as never,
      userText: "先定位，不要改",
    });

    expect(plan.action).toBe("blocked_explanation");
    expect(plan.reason).toBe("user_forbid_commands");
    expect(plan.directive).not.toContain("RunVerification");
    expect(plan.evidenceAction).toBeUndefined();
  });

  it("plans verification gaps in default mode through the permission-aware verification path", () => {
    const result = evaluateAggregatedFinalAnswerGate(
      makeGateContext() as never,
      withClaims("已验证。", [{ kind: "verification_claim", phrase: "已验证" }]),
      false,
    );

    expect(result.status).toBe("needs_disclaimer");
    if (result.status !== "needs_disclaimer") return;
    const plan = planFinalGateEvidenceGapAction({
      result,
      context: { ...makeGateContext(), permissionMode: "default", language: "zh-CN" } as never,
      userText: "继续修复",
    });

    expect(plan.action).toBe("verification_request");
    expect(plan.directive).toContain("Bash");
    expect(plan.directive).toContain("decidePermission");
    expect(plan.directive).toContain("pendingLocalApproval");
    expect(plan.directive).toContain("PermissionPanel");
    expect(plan.directive).toContain("不要用 RunVerification 绕过 ask 模式");
    expect(plan.evidenceAction).toMatchObject({
      toolName: "Bash",
      strategy: "minimal_bash_verification",
    });
  });

  it("plans verification gaps in full-access mode with a minimal RunVerification path", () => {
    const result = evaluateAggregatedFinalAnswerGate(
      makeGateContext() as never,
      withClaims("已验证。", [{ kind: "verification_claim", phrase: "已验证" }]),
      false,
    );

    expect(result.status).toBe("needs_disclaimer");
    if (result.status !== "needs_disclaimer") return;
    const plan = planFinalGateEvidenceGapAction({
      result,
      context: { ...makeGateContext(), permissionMode: "full-access", language: "zh-CN" } as never,
      userText: "继续修复",
    });

    expect(plan.action).toBe("verification_request");
    expect(plan.directive).toContain("RunVerification");
    expect(plan.directive).toContain("focused/typecheck");
    expect(plan.directive).toContain("不要直接跑全量套件");
    expect(plan.evidenceAction).toMatchObject({
      toolName: "RunVerification",
      input: { level: "typecheck" },
    });
  });

  it("plans verification gaps in auto-review mode with the same minimal RunVerification path", () => {
    const result = evaluateAggregatedFinalAnswerGate(
      makeGateContext() as never,
      withClaims("已验证。", [{ kind: "verification_claim", phrase: "已验证" }]),
      false,
    );

    expect(result.status).toBe("needs_disclaimer");
    if (result.status !== "needs_disclaimer") return;
    const plan = planFinalGateEvidenceGapAction({
      result,
      context: { ...makeGateContext(), permissionMode: "auto-review", language: "zh-CN" } as never,
      userText: "继续修复",
    });

    expect(plan.action).toBe("verification_request");
    expect(plan.evidenceAction).toMatchObject({
      toolName: "RunVerification",
      input: { level: "typecheck" },
    });
  });

  it("plans artifact gaps as readonly file confirmation first", () => {
    const plan = planFinalGateEvidenceGapAction({
      result: {
        status: "needs_disclaimer",
        unsupportedKinds: ["file_change_claim"],
      },
      context: { ...makeGateContext(), permissionMode: "default", language: "zh-CN" } as never,
      userText: "检查报告",
    });

    expect(plan.action).toBe("readonly_check");
    expect(plan.directive).toContain("Read, Grep, Glob");
    expect(plan.directive).toContain("不要运行 Bash");
    expect(plan.evidenceAction?.toolName).toBe("Glob");
    expect(plan.evidenceAction?.input).toMatchObject({ pattern: "**/*.{md,txt,json,log}" });
  });

  it("plans artifact gaps with a direct Read when the draft names a file", () => {
    const plan = planFinalGateEvidenceGapAction({
      result: {
        status: "needs_disclaimer",
        unsupportedKinds: ["file_change_claim"],
      },
      context: { ...makeGateContext(), permissionMode: "default", language: "zh-CN" } as never,
      assistantText: "已生成报告 reports/final-audit.md。",
    });

    expect(plan.action).toBe("readonly_check");
    expect(plan.evidenceAction).toMatchObject({
      toolName: "Read",
      input: { path: "reports/final-audit.md" },
    });
  });

  it("plans git gaps as readonly GitStatusInspect first", () => {
    const plan = planFinalGateEvidenceGapAction({
      result: {
        status: "needs_disclaimer",
        unsupportedKinds: ["git_operation"],
      },
      context: { ...makeGateContext(), permissionMode: "default", language: "zh-CN" } as never,
      userText: "确认 git 状态",
    });

    expect(plan.action).toBe("readonly_check");
    expect(plan.directive).toContain("GitStatusInspect");
    expect(plan.directive).toContain("不要创建 commit");
    expect(plan.evidenceAction).toMatchObject({
      toolName: "GitStatusInspect",
      input: { includeDetails: true },
    });
  });

  it("plans service/runtime gaps as readonly evidence checks, not verification passes", () => {
    const plan = planFinalGateEvidenceGapAction({
      result: {
        status: "needs_disclaimer",
        unsupportedKinds: ["engineering_service_unverified"],
      },
      context: { ...makeGateContext(), permissionMode: "default", language: "zh-CN" } as never,
      assistantText: "服务状态见 logs/server.log，端口已经正常。",
    });

    expect(plan.action).toBe("readonly_check");
    expect(plan.reason).toBe("service_runtime_gap_readonly");
    expect(plan.directive).toContain("不要启动服务");
    expect(plan.directive).toContain("不要运行 Bash");
    expect(plan.evidenceAction).toMatchObject({
      toolName: "Read",
      input: { path: "logs/server.log" },
    });
    expect(plan.evidenceAction?.toolName).not.toBe("RunVerification");
  });

  it("plans service/runtime gaps without a path as readonly grep evidence", () => {
    const plan = planFinalGateEvidenceGapAction({
      result: {
        status: "needs_disclaimer",
        unsupportedKinds: ["runtime_health_missing"],
      },
      context: { ...makeGateContext(), permissionMode: "default", language: "zh-CN" } as never,
      userText: "确认服务健康状态",
    });

    expect(plan.action).toBe("readonly_check");
    expect(plan.evidenceAction).toMatchObject({
      toolName: "Grep",
      input: { path: ".", limit: 30 },
    });
    expect(JSON.stringify(plan.evidenceAction?.input)).toContain("health");
  });

  it("dispatches default verification evidence through Bash permission approval without committing held draft", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-final-gate-dispatch-"));
    await writeFile(
      join(project, "package.json"),
      JSON.stringify({ scripts: { typecheck: "tsc --noEmit" } }),
      "utf8",
    );
    const { context, events } = makeDispatcherContext(project);
    const blocks: Array<{ id: string; fullText?: string }> = [];
    const terminalWrites: string[] = [];
    let stagedText = "";
    const output = createShellBlockOutputForTest(context, blocks as never, () => undefined, {
      stageStableAssistantText: (text) => {
        stagedText += text;
      },
      commitStableAssistantText: () => {
        terminalWrites.push(stagedText);
        stagedText = "";
        return true;
      },
      rollbackStableAssistantText: () => {
        stagedText = "";
      },
    });
    const rawDraft = "原始最终回答：测试已经全部通过。";

    output.beginAssistantStream("assistant-held-final", { holdStableCommit: true });
    output.appendAssistantDelta(rawDraft);
    output.discardAssistantBlock("assistant-held-final");

    const plan = planFinalGateEvidenceGapAction({
      result: {
        status: "needs_disclaimer",
        unsupportedKinds: ["verification_claim"],
      },
      context,
      userText: "继续修复",
      assistantText: rawDraft,
    });
    expect(plan.evidenceAction).toMatchObject({
      toolName: "Bash",
      strategy: "minimal_bash_verification",
    });

    const result = await __testRunFinalGateEvidenceAction({
      actionPlan: plan,
      context,
      output,
      sessionId: "session-final-gate-dispatch",
      messages: [{ role: "user", content: "继续修复" }],
      runtime: {
        provider: "test",
        model: "test-model",
        endpointProfile: "chat_completions",
        reasoningSent: false,
      },
    });

    expect(result.status).toBe("permission_pending");
    expect(
      (context as { pendingLocalApproval?: { kind?: string; toolName?: string; toolCall?: { name?: string } } })
        .pendingLocalApproval,
    ).toMatchObject({
      kind: "model_tool_use",
      toolName: "Bash",
      toolCall: { name: "Bash" },
    });
    expect(events.some((item) => (item.event as { type?: string }).type === "permission_request")).toBe(true);
    expect(events.some((item) => (item.event as { type?: string }).type === "permission_result")).toBe(true);
    expect(blocks.some((block) => JSON.stringify(block).includes(rawDraft))).toBe(false);
    expect((context as { lastFullOutput?: string }).lastFullOutput ?? "").not.toContain(rawDraft);
    expect(terminalWrites).toEqual([]);
  });
});

describe("natural input routing", () => {
  it.each(["继续", "确认", "yes"])(
    "lets bare confirmation word %s reach the model when nothing is pending",
    async (input) => {
      const output = new MemoryOutput();
      const result = await handleNaturalInput(input, makeNaturalInputContext() as never, output);

      expect(result).toBe("message");
      expect(output.text).toBe("");
    },
  );
});
