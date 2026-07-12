import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Writable } from "node:stream";
import { defaultConfig } from "@linghun/config";
import { SessionStore } from "@linghun/core";
import type { ModelGateway, ModelMessage, ModelRequest, ModelToolCall } from "@linghun/providers";
import { builtInTools, createToolContext, type ToolOutput } from "@linghun/tools";
import { describe, expect, it, vi } from "vitest";
import { createFailureLearningState } from "./failure-learning-runtime.js";
import { evidenceMatchesRequestOwner } from "./evidence-runtime.js";
import { createIndexState } from "./index-runtime.js";
import { INDEX_STATUS_INSPECT } from "./index-tool-runtime.js";
import { configureMcpIndexRuntime } from "./mcp-index-runtime.js";
import { rememberCacheSafePrefix } from "./cache-policy-runtime.js";
import {
  __testExecuteAgentToolCall,
  configureJobAgentCommandRuntime,
  cancelAgent,
  cancelAgentByRef,
  denyAgentToolUse,
  executeApprovedAgentToolUse,
  markRunningAgentsStaleForInterrupt,
  runModelBackedAgent,
} from "./job-agent-command-runtime.js";
import {
  AGENT_CONTROL_TOOL_NAME,
  COMMAND_PROPOSAL_TOOL_NAME,
  EXECUTE_EXTRA_TOOL_NAME,
  INDEX_OPERATION_TOOL_NAME,
  RUN_VERIFICATION_TOOL_NAME,
  RUN_WORKFLOW_TOOL_NAME,
  SEARCH_EXTRA_TOOLS_NAME,
  SEND_MESSAGE_TOOL_NAME,
  START_AGENT_TOOL_NAME,
  WRITE_REPORT_TOOL_NAME,
  createModelToolDefinitionsForTools,
  createSolutionCompletenessStatus,
} from "./model-loop-runtime.js";
import { __testSendMessage } from "./model-stream-runtime.js";
import {
  __testSelectWorkflowCurrentStepForToolResult,
  executeApprovedModelToolUse,
  executeDeferredDispatchToolUse,
  executeLinghunControlToolUse,
  executeModelToolUse,
} from "./model-tool-runtime.js";
import { routeNaturalIntent } from "./natural-command-bridge.js";
import { executePermissionApprove } from "./permission-approval-runtime.js";
import { classifyToolRequest } from "./permission-policy-engine.js";
import { createProviderCircuitBreakerState } from "./provider-circuit-breaker.js";
import {
  configureSlashCommandRuntime,
  handleSlashCommand,
  recordAgentToolEvidence,
} from "./slash-command-runtime.js";
import type { PendingLocalApproval, TuiContext } from "./tui-context-runtime.js";
import type {
  AgentRun,
  BackgroundTaskState,
  MemoryCandidate,
  VerificationReport,
} from "./tui-data-types.js";
import { decidePermission } from "./tui-permission-runtime.js";
import { parseUserActionConstraints } from "./user-action-constraints.js";
import {
  createAgentBackgroundTask,
  registerBackgroundAbortController,
  rememberBackgroundTask,
} from "./tui-agent-job-runtime.js";
import {
  createCacheState,
  createMcpState,
  createMemoryState,
  createRemoteState,
} from "./tui-state-runtime.js";
import type {
  WorkflowBridgeContextRefs,
  WorkflowBridgeRequestProposal,
} from "./workflow-agent-runtime-bridge.js";
import {
  __testExecuteRegistryWorkflowStep,
  __testExecuteWorkflowStep,
  __testNewWorkflowEvidenceRefs,
} from "./workflow-command-runtime.js";

type TestStreamEvent =
  | { type: "assistant_thinking_delta"; text: string }
  | { type: "assistant_text_delta"; text: string; id?: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | {
      type: "usage";
      usage: {
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens?: number;
        cacheWriteTokens?: number;
      };
    }
  | { type: "message_stop"; chunkCount: number; hadUsage: boolean; finishReason?: string }
  | { type: "error"; error: { code?: string; message: string } };

describe("Phase E model stream and tool dispatch main-chain coverage", () => {
  it("sendMessage handles stream deltas, thinking, usage, stop, tool_use, error, and abort paths", async () => {
    const textContext = await createTestContext();
    const textOutput = new MemoryOutput();
    await __testSendMessage(
      "hello",
      textContext,
      gateway([
        { type: "assistant_thinking_delta", text: "thinking" },
        { type: "assistant_text_delta", text: "answer" },
        {
          type: "usage",
          usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 1, cacheWriteTokens: 0 },
        },
        { type: "message_stop", chunkCount: 3, hadUsage: true, finishReason: "stop" },
      ]),
      textOutput,
    );
    expect(textOutput.text).toContain("answer");
    expect(textContext.roleUsage[0]?.inputTokens).toBe(10);

    const anthropicContext = await createTestContext();
    anthropicContext.model = "claude-3-5-sonnet-latest";
    const tokenCountRequests: Array<{ endpointProfile?: string; model?: string }> = [];
    await __testSendMessage(
      "count profile",
      anthropicContext,
      {
        async *stream() {
          yield {
            type: "usage",
            usage: { inputTokens: 7, outputTokens: 1 },
          } satisfies TestStreamEvent;
          yield { type: "assistant_text_delta", text: "counted" } satisfies TestStreamEvent;
          yield {
            type: "message_stop",
            chunkCount: 2,
            hadUsage: true,
            finishReason: "stop",
          } satisfies TestStreamEvent;
        },
        async countMessagesTokensWithAPI(
          _provider: string,
          request: { endpointProfile?: string; model?: string },
        ) {
          tokenCountRequests.push({ endpointProfile: request.endpointProfile, model: request.model });
          return { source: "api", inputTokens: 8 };
        },
      } as unknown as ModelGateway,
      new MemoryOutput(),
    );
    expect(tokenCountRequests).toContainEqual({
      endpointProfile: "anthropic_messages",
      model: "claude-3-5-sonnet-latest",
    });

    const toolContext = await createTestContext();
    const toolOutput = new MemoryOutput();
    await __testSendMessage(
      "todo",
      toolContext,
      gateway([
        { type: "tool_use", id: "tc-todo", name: "Todo", input: { items: [] } },
        { type: "assistant_text_delta", text: "done" },
      ]),
      toolOutput,
    );
    expect(toolContext.tools.todos).toEqual([]);

    const errorContext = await createTestContext();
    const errorOutput = new MemoryOutput();
    await __testSendMessage(
      "error",
      errorContext,
      gateway([{ type: "error", error: { code: "PROVIDER_AUTH_ERROR", message: "unauthorized" } }]),
      errorOutput,
    );
    expect(errorContext.lastProviderFailure?.kind).toBe("auth");

    const abortContext = await createTestContext();
    const abortOutput = new MemoryOutput();
    await __testSendMessage(
      "abort",
      abortContext,
      abortingGateway(abortContext, [
        { type: "assistant_text_delta", text: "partial" },
        { type: "assistant_text_delta", text: "ignored" },
      ]),
      abortOutput,
    );
    expect(abortOutput.text).toContain("已取消");
  }, 60_000);

  it("routes deferred, builtin, index, and seven Linghun control tool branches", async () => {
    const context = await createTestContext();
    const output = new MemoryOutput();
    const sessionId = context.sessionId ?? "session";
    const controlResults = [];

    controlResults.push(
      await executeLinghunControlToolUse(
        call(START_AGENT_TOOL_NAME, { role: "planner", task: "inspect", runInBackground: false }),
        context,
        sessionId,
        output,
      ),
    );
    const agent = createAgentRun(context, { id: "agent-main", status: "idle" });
    context.agents.push(agent);
    controlResults.push(
      await executeLinghunControlToolUse(
        call(AGENT_CONTROL_TOOL_NAME, { action: "list" }),
        context,
        sessionId,
        output,
      ),
    );
    controlResults.push(
      await executeLinghunControlToolUse(
        call(SEND_MESSAGE_TOOL_NAME, { agentRef: "agent-main", message: "mail" }),
        context,
        sessionId,
        output,
      ),
    );
    controlResults.push(
      await executeLinghunControlToolUse(
        call(RUN_WORKFLOW_TOOL_NAME, { workflowId: "missing-workflow", goal: "x" }),
        context,
        sessionId,
        output,
      ),
    );
    controlResults.push(
      await executeLinghunControlToolUse(
        call(INDEX_OPERATION_TOOL_NAME, { action: "unknown" }),
        context,
        sessionId,
        output,
      ),
    );
    controlResults.push(
      await executeLinghunControlToolUse(
        call(RUN_VERIFICATION_TOOL_NAME, { level: "unknown" }),
        context,
        sessionId,
        output,
      ),
    );
    controlResults.push(
      await executeLinghunControlToolUse(
        call(WRITE_REPORT_TOOL_NAME, { path: "phase-e-report.md", content: "ok" }),
        context,
        sessionId,
        output,
      ),
    );

    expect(controlResults.map((result) => result.tool)).toEqual(
      expect.arrayContaining([
        START_AGENT_TOOL_NAME,
        AGENT_CONTROL_TOOL_NAME,
        SEND_MESSAGE_TOOL_NAME,
        RUN_WORKFLOW_TOOL_NAME,
        INDEX_OPERATION_TOOL_NAME,
        RUN_VERIFICATION_TOOL_NAME,
        WRITE_REPORT_TOOL_NAME,
      ]),
    );
    expect(controlResults.some((result) => result.pendingApproval || result.ok)).toBe(true);

    const currentStep = __testSelectWorkflowCurrentStepForToolResult({
      id: "workflow-blocked",
      goal: "blocked nested job",
      planId: "plan-blocked",
      status: "blocked",
      result: "blocked",
      startedAt: new Date().toISOString(),
      steps: [
        {
          id: "slice-implement",
          title: "Run durable multi-agent job batch",
          status: "blocked",
          summary: "slice-implement blocked: nested job failed",
          runtime: "job",
          evidenceRefs: [],
        },
        {
          id: "slice-verify",
          title: "Verify result",
          status: "queued",
          runtime: "verification",
          evidenceRefs: [],
        },
      ],
    });
    expect(currentStep?.id).toBe("slice-implement");
    expect(currentStep?.summary).toContain("slice-implement blocked");

    const search = await executeDeferredDispatchToolUse(
      call(SEARCH_EXTRA_TOOLS_NAME, { query: "codebase memory", limit: 2 }),
      context,
      sessionId,
      output,
    );
    expect(search.tool).toBe(SEARCH_EXTRA_TOOLS_NAME);
    const proposal = await executeDeferredDispatchToolUse(
      call(COMMAND_PROPOSAL_TOOL_NAME, { command: "/doctor", reason: "status" }),
      context,
      sessionId,
      output,
    );
    expect(proposal.ok).toBe(true);
    const extra = await executeDeferredDispatchToolUse(
      call(EXECUTE_EXTRA_TOOL_NAME, { tool_name: "missing_tool", params: {} }),
      context,
      sessionId,
      output,
    );
    expect(extra.ok).toBe(false);

    const builtin = await executeModelToolUse(
      call("Todo", { items: [] }),
      context,
      sessionId,
      output,
    );
    expect(builtin.tool).toBe("Todo");
    const index = await executeModelToolUse(
      call(INDEX_STATUS_INSPECT, {}),
      context,
      sessionId,
      output,
    );
    expect(index.tool).toBe(INDEX_STATUS_INSPECT);
  }, 60_000);

  it("drops stale control tools before they mutate agents, mailboxes, or workflows", async () => {
    const context = await createTestContext();
    const sessionId = context.sessionId ?? "session";
    const agent = createAgentRun(context, { id: "agent-stale-control", status: "running" });
    context.agents.push(agent);
    context.currentRequestTurnId = "request-b";
    const continuation = {
      messages: [],
      provider: "deepseek",
      model: "deepseek-chat",
      endpointProfile: "chat_completions" as const,
      reasoningSent: false,
      requestTurnId: "request-a",
      abortSignal: new AbortController().signal,
    };

    const results = await Promise.all([
      executeLinghunControlToolUse(
        call(START_AGENT_TOOL_NAME, { role: "planner", task: "late start" }),
        context,
        sessionId,
        new MemoryOutput(),
        continuation,
      ),
      executeLinghunControlToolUse(
        call(SEND_MESSAGE_TOOL_NAME, { agentRef: agent.id, message: "late mail" }),
        context,
        sessionId,
        new MemoryOutput(),
        continuation,
      ),
      executeLinghunControlToolUse(
        call(AGENT_CONTROL_TOOL_NAME, { action: "cancel", agentRef: agent.id }),
        context,
        sessionId,
        new MemoryOutput(),
        continuation,
      ),
      executeLinghunControlToolUse(
        call(RUN_WORKFLOW_TOOL_NAME, { goal: "late workflow" }),
        context,
        sessionId,
        new MemoryOutput(),
        continuation,
      ),
    ]);

    expect(results.every((result) => result.ok === false && result.text.includes("stale"))).toBe(true);
    expect(context.agents).toEqual([agent]);
    expect(agent.status).toBe("running");
    expect(agent.mailbox).toEqual([]);
    expect(context.workflows.activeRun).toBeUndefined();
    expect(context.evidence).toEqual([]);
  });

  it("drops an in-flight StartAgent after its request owner changes", async () => {
    const context = await createTestContext();
    const sessionId = context.sessionId ?? "session";
    context.currentRequestTurnId = "request-a";
    let releaseCreate!: () => void;
    let markCreateStarted!: () => void;
    const createStarted = new Promise<void>((resolve) => { markCreateStarted = resolve; });
    const createRelease = new Promise<void>((resolve) => { releaseCreate = resolve; });
    const originalCreate = context.store.create.bind(context.store);
    const deleteSpy = vi.spyOn(context.store, "delete");
    vi.spyOn(context.store, "create").mockImplementationOnce(async (...args) => {
      markCreateStarted();
      await createRelease;
      return originalCreate(...args);
    });

    const pending = executeLinghunControlToolUse(
      call(START_AGENT_TOOL_NAME, { role: "planner", task: "race start" }),
      context,
      sessionId,
      new MemoryOutput(),
      {
        messages: [],
        provider: "deepseek",
        model: "deepseek-chat",
        endpointProfile: "chat_completions",
        reasoningSent: false,
        requestTurnId: "request-a",
        abortSignal: new AbortController().signal,
      },
    );
    await createStarted;
    context.currentRequestTurnId = "request-b";
    releaseCreate();
    const result = await pending;

    expect(result.ok).toBe(false);
    expect(result.text).toContain("stale");
    expect(context.agents).toEqual([]);
    expect(context.evidence).toEqual([]);
    expect(deleteSpy).toHaveBeenCalledTimes(1);
  }, 60_000);

  it("records agent tool evidence under the invocation owner instead of the foreground", async () => {
    const context = await createTestContext();
    context.currentRequestTurnId = "request-b";
    const agent = createAgentRun(context, {
      id: "agent-owner-a",
      invokingRequestTurnId: "request-a",
      cwd: join(context.projectPath, ".worktrees", "agent-owner-a"),
    });
    rememberBackgroundTask(context, {
      ...createBackgroundTask(agent.id, "agent", "running"),
      workflowRunId: "workflow-a",
    });

    const evidenceId = await recordAgentToolEvidence(
      context,
      context.sessionId ?? "session",
      agent,
      "Write",
      { text: "written" },
      { path: "result.txt", content: "done" },
    );
    const evidence = context.evidence.find((item) => item.id === evidenceId);

    expect(evidence?.ownerScope).toMatchObject({
      ownerSessionId: context.sessionId,
      requestTurnId: "request-a",
      ownerAgentId: agent.id,
      workflowRunId: "workflow-a",
      cwd: agent.cwd,
    });
    expect(evidence && evidenceMatchesRequestOwner(evidence, context)).toBe(false);
  });

  it("records passed RunVerification claims for final-answer evidence", async () => {
    const context = await createTestContext();
    context.permissionMode = "full-access";
    await writeFile(
      join(context.projectPath, "package.json"),
      JSON.stringify({ scripts: { test: "node -e \"console.log('test pass')\"" } }),
    );
    const output = new MemoryOutput();
    const result = await executeLinghunControlToolUse(
      call(RUN_VERIFICATION_TOOL_NAME, { level: "test" }),
      context,
      context.sessionId ?? "session",
      output,
    );

    expect(result.ok).toBe(true);
    const evidence = context.evidence.find((item) => item.source === "verification-result");
    expect(evidence?.supportsClaims).toEqual(
      expect.arrayContaining(["verification_passed", "test_passed"]),
    );
  }, 60_000);

  it("returns status for an existing workflow run id instead of treating it as unknown", async () => {
    const context = await createTestContext();
    context.workflows.activeRun = {
      id: "wf-existing-run",
      goal: "multi-agent audit",
      planId: "runtime-plan",
      status: "running",
      result: "partial",
      multiAgent: true,
      steps: [
        {
          id: "s1",
          title: "agent fanout",
          status: "running",
          summary: "agents are working",
          runtime: "agent",
          evidenceRefs: [],
        },
      ],
      startedAt: new Date().toISOString(),
    };
    const sessionId = context.sessionId ?? "session";

    const result = await executeLinghunControlToolUse(
      call(RUN_WORKFLOW_TOOL_NAME, { workflowId: "wf-existing-run" }),
      context,
      sessionId,
      new MemoryOutput(),
    );

    expect(result.ok).toBe(true);
    expect(result.tool).toBe(RUN_WORKFLOW_TOOL_NAME);
    expect(result.text).not.toContain("Unknown workflowId");
    expect(result.data).toMatchObject({
      workflowId: "wf-existing-run",
      status: "running",
      multiAgent: true,
    });
  });
});

describe("Phase E agent, slash, workflow, permission, and natural intent coverage", () => {
  it("drops a late direct pre-engine result after its request owner changes", async () => {
    const context = await createTestContext([]);
    const sessionId = context.sessionId!;
    const controller = new AbortController();
    const started = deferred<void>();
    const lateResult = deferred<{ ok: boolean; summary: string; data?: unknown }>();
    let receivedSignal: AbortSignal | undefined;
    context.currentRequestTurnId = "pre-owner-old";
    configureMcpIndexRuntime({
      getCurrentFreshness: () => ({} as never),
      writeStatus: () => undefined,
      checkBackgroundStartGuard: () => null,
      ensureSession: async () => sessionId,
      rememberBackgroundTask: () => undefined,
      appendBackgroundTaskEvent: async () => undefined,
      rememberEvidence: () => undefined,
      resolvePreEngineBinary: async () => "mock-pre-engine",
      callPreEngineTool: async (_name, _args, _cwd, _binary, signal) => {
        receivedSignal = signal;
        started.resolve();
        return lateResult.promise;
      },
    });

    const pending = executeModelToolUse(
      call("pre_context", { symbol: "staleSymbol" }),
      context,
      sessionId,
      new MemoryOutput(),
      {
        requestTurnId: "pre-owner-old",
        abortSignal: controller.signal,
        messages: [],
      } as never,
    );
    await started.promise;
    context.currentRequestTurnId = "pre-owner-new";
    context.requestActivityOwner = { kind: "foreground", requestTurnId: "pre-owner-new" };
    context.requestActivityToolUseId = "new-tool";
    controller.abort();
    lateResult.resolve({
      ok: true,
      summary: "late",
      data: { candidate_files: ["src/stale.ts"] },
    });
    const result = await pending;

    expect(receivedSignal).toBe(controller.signal);
    expect(result).toMatchObject({
      ok: false,
      text: "cancelled: stale pre-engine tool result discarded",
    });
    expect(context.evidence).toEqual([]);
    expect(context.requestActivityToolUseId).toBe("new-tool");
    expect(context.tools.sourcePackCandidates).toBeUndefined();
    const transcript = (await context.store.resume(sessionId)).transcript;
    expect(transcript.some((event) => event.type === "tool_result")).toBe(false);
    expect(transcript.some((event) => event.type === "evidence_record")).toBe(false);
  });

  it("drops a permission decision when its continuation owner changes while deciding", async () => {
    const context = await createTestContext([]);
    const sessionId = context.sessionId!;
    const controller = new AbortController();
    context.currentRequestTurnId = "permission-owner-old";
    const decisionBlocked = deferred<void>();
    const releaseDecision = deferred<void>();
    const originalAppendEvent = context.store.appendEvent.bind(context.store);
    let blocked = false;
    context.store.appendEvent = async (targetSessionId, event, commitGuard) => {
      if (!blocked) {
        blocked = true;
        decisionBlocked.resolve();
        await releaseDecision.promise;
      }
      return originalAppendEvent(targetSessionId, event, commitGuard);
    };

    const pending = executeModelToolUse(
      call("Write", { path: "stale-permission.txt", content: "stale" }),
      context,
      sessionId,
      new MemoryOutput(),
      {
        requestTurnId: "permission-owner-old",
        abortSignal: controller.signal,
        messages: [],
      } as never,
    );
    await decisionBlocked.promise;
    context.currentRequestTurnId = "permission-owner-new";
    controller.abort();
    releaseDecision.resolve();
    const result = await pending;

    expect(result.ok).toBe(false);
    expect(result.text).toContain("stale foreground tool request discarded");
    expect(context.pendingLocalApproval).toBeUndefined();
    const transcript = (await context.store.resume(sessionId)).transcript;
    expect(transcript.some((event) => event.type === "permission_request")).toBe(false);
    expect(transcript.some((event) => event.type === "permission_result")).toBe(false);
  });

  it("does not start an approved tool after tool_call_start waits behind a stale owner", async () => {
    const context = await createTestContext([]);
    const sessionId = context.sessionId!;
    const controller = new AbortController();
    context.currentRequestTurnId = "tool-start-owner-old";
    const startBlocked = deferred<void>();
    const releaseStart = deferred<void>();
    const originalAppendEvent = context.store.appendEvent.bind(context.store);
    context.store.appendEvent = async (targetSessionId, event, commitGuard) => {
      if ((event as { type?: string }).type === "tool_call_start") {
        startBlocked.resolve();
        await releaseStart.promise;
      }
      return originalAppendEvent(targetSessionId, event, commitGuard);
    };
    const originalWrite = builtInTools.Write.call;
    const writeCall = vi.fn(async () => ({ text: "must not run" }));
    builtInTools.Write.call = writeCall as typeof originalWrite;

    try {
      const pending = executeApprovedModelToolUse(
        call("Write", { path: "stale-start.txt", content: "stale" }),
        "Write",
        context,
        sessionId,
        new MemoryOutput(),
        undefined,
        undefined,
        { requestTurnId: "tool-start-owner-old", signal: controller.signal },
      );
      await startBlocked.promise;
      context.currentRequestTurnId = "tool-start-owner-new";
      controller.abort();
      releaseStart.resolve();
      const result = await pending;

      expect(result.ok).toBe(false);
      expect(result.text).toContain("stale foreground tool request discarded");
      expect(writeCall).not.toHaveBeenCalled();
      const transcript = (await context.store.resume(sessionId)).transcript;
      expect(transcript.some((event) => event.type === "tool_call_start")).toBe(false);
      expect(context.pendingLocalApproval).toBeUndefined();
    } finally {
      builtInTools.Write.call = originalWrite;
    }
  });

  it("does not retain a background Bash task when its queued start event loses owner", async () => {
    const context = await createTestContext([]);
    const sessionId = context.sessionId!;
    const controller = new AbortController();
    context.currentRequestTurnId = "background-owner-old";
    const updateBlocked = deferred<void>();
    const releaseUpdate = deferred<void>();
    const originalAppendEvent = context.store.appendEvent.bind(context.store);
    context.store.appendEvent = async (targetSessionId, event, commitGuard) => {
      if ((event as { type?: string }).type === "background_task_update") {
        updateBlocked.resolve();
        await releaseUpdate.promise;
      }
      return originalAppendEvent(targetSessionId, event, commitGuard);
    };
    const originalBash = builtInTools.Bash.call;
    const bashCall = vi.fn(async () => ({ text: "must not run" }));
    builtInTools.Bash.call = bashCall as typeof originalBash;

    try {
      const pending = executeApprovedModelToolUse(
        call("Bash", { command: "long-running", runInBackground: true }),
        "Bash",
        context,
        sessionId,
        new MemoryOutput(),
        undefined,
        undefined,
        { requestTurnId: "background-owner-old", signal: controller.signal },
      );
      await updateBlocked.promise;
      context.currentRequestTurnId = "background-owner-new";
      controller.abort();
      releaseUpdate.resolve();
      const result = await pending;

      expect(result.ok).toBe(false);
      expect(result.text).toContain("stale foreground tool request discarded");
      expect(bashCall).not.toHaveBeenCalled();
      expect(context.backgroundTasks).toEqual([]);
      const transcript = (await context.store.resume(sessionId)).transcript;
      expect(transcript.some((event) => event.type === "background_task_update")).toBe(false);
    } finally {
      builtInTools.Bash.call = originalBash;
    }
  });

  it("drops a queued background resource-guard failure after owner cancellation", async () => {
    const context = await createTestContext([]);
    const sessionId = context.sessionId!;
    const controller = new AbortController();
    context.currentRequestTurnId = "guard-owner-old";
    context.backgroundTasks = [{
      id: "existing-heavy-task",
      kind: "bash",
      title: "existing",
      status: "running",
      currentStep: "running",
      progress: { completed: 0, total: 1, label: "Bash" },
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      heartbeatIntervalMs: 30_000,
      staleAfterMs: 120_000,
      hasOutput: false,
      userVisibleSummary: "running",
      nextAction: "wait",
    }];
    const evidenceBlocked = deferred<void>();
    const releaseEvidence = deferred<void>();
    const originalAppendEvent = context.store.appendEvent.bind(context.store);
    context.store.appendEvent = async (targetSessionId, event, commitGuard) => {
      if ((event as { type?: string }).type === "evidence_record") {
        evidenceBlocked.resolve();
        await releaseEvidence.promise;
      }
      return originalAppendEvent(targetSessionId, event, commitGuard);
    };

    const pending = executeApprovedModelToolUse(
      call("Bash", { command: "blocked", runInBackground: true }),
      "Bash",
      context,
      sessionId,
      new MemoryOutput(),
      undefined,
      undefined,
      { requestTurnId: "guard-owner-old", signal: controller.signal },
    );
    await evidenceBlocked.promise;
    context.currentRequestTurnId = "guard-owner-new";
    controller.abort();
    releaseEvidence.resolve();
    const result = await pending;

    expect(result.ok).toBe(false);
    expect(result.text).toContain("stale foreground tool request discarded");
    expect(context.evidence).toEqual([]);
    const transcript = (await context.store.resume(sessionId)).transcript;
    expect(transcript.some((event) => event.type === "evidence_record")).toBe(false);
    expect(transcript.some((event) => event.type === "tool_result")).toBe(false);
  });

  it("terminalizes an already-started background Bash when its owner becomes stale", async () => {
    const context = await createTestContext([]);
    const sessionId = context.sessionId!;
    const controller = new AbortController();
    context.currentRequestTurnId = "running-background-old";
    context.backgroundBashTaskMap = new Map();
    const started = deferred<void>();
    const result = deferred<ToolOutput>();
    const originalBash = builtInTools.Bash.call;
    builtInTools.Bash.call = (async (_input, toolContext) => {
      toolContext.onBackgroundBashStart?.("tools-background-id");
      started.resolve();
      return result.promise;
    }) as typeof originalBash;

    try {
      const pending = executeApprovedModelToolUse(
        call("Bash", { command: "long-running", runInBackground: true }),
        "Bash",
        context,
        sessionId,
        new MemoryOutput(),
        undefined,
        undefined,
        { requestTurnId: "running-background-old", signal: controller.signal },
      );
      await started.promise;
      context.currentRequestTurnId = "running-background-new";
      controller.abort();
      result.resolve({
        text: "started",
        data: { backgroundTaskId: "tools-background-id", outputPath: "background.log" },
      });
      const response = await pending;

      expect(response.ok).toBe(false);
      expect(context.backgroundTasks).toHaveLength(1);
      expect(context.backgroundTasks[0]).toMatchObject({
        status: "cancelled",
        result: "cancelled",
        cancelState: "abort_signal_sent",
        outputPath: "background.log",
      });
      expect(context.backgroundBashTaskMap?.get("tools-background-id"))
        .toBe(context.backgroundTasks[0]?.id);
      const transcript = (await context.store.resume(sessionId)).transcript;
      expect(
        transcript.some(
          (event) =>
            event.type === "background_task_update" && event.task.status === "cancelled",
        ),
      ).toBe(true);
    } finally {
      builtInTools.Bash.call = originalBash;
    }
  });

  it("correlates a background Bash completion that arrives before runTool returns", async () => {
    const context = await createTestContext([]);
    const sessionId = context.sessionId!;
    context.currentRequestTurnId = "fast-background-owner";
    context.backgroundBashTaskMap = new Map();
    let completedTuiTaskId: string | undefined;
    context.tools.onBackgroundBashComplete = (completion) => {
      completedTuiTaskId = context.backgroundBashTaskMap?.get(completion.taskId);
      context.backgroundBashTaskMap?.delete(completion.taskId);
      const task = context.backgroundTasks.find((item) => item.id === completedTuiTaskId);
      if (task) {
        task.status = "completed";
        task.result = "pass";
      }
    };
    const originalBash = builtInTools.Bash.call;
    builtInTools.Bash.call = (async (_input, toolContext) => {
      toolContext.onBackgroundBashStart?.("fast-tools-task");
      toolContext.onBackgroundBashComplete?.({
        taskId: "fast-tools-task",
        exitCode: 0,
        outcome: "completed",
        outputPath: "fast.log",
        command: "fast",
      });
      return {
        text: "started",
        data: { backgroundTaskId: "fast-tools-task", outputPath: "fast.log" },
      };
    }) as typeof originalBash;

    try {
      const response = await executeApprovedModelToolUse(
        call("Bash", { command: "fast", runInBackground: true }),
        "Bash",
        context,
        sessionId,
        new MemoryOutput(),
        undefined,
        undefined,
        { requestTurnId: "fast-background-owner", signal: new AbortController().signal },
      );

      expect(response.ok).toBe(true);
      expect(completedTuiTaskId).toBe(context.backgroundTasks[0]?.id);
      expect(context.backgroundTasks[0]).toMatchObject({ status: "completed", result: "pass" });
      expect(context.backgroundBashTaskMap.has("fast-tools-task")).toBe(false);
    } finally {
      builtInTools.Bash.call = originalBash;
    }
  });

  it("runModelBackedAgent completes final answer, consumes mailbox, and lets tool errors self-recover", async () => {
    const context = await createTestContext();
    const agent = createAgentRun(context, { id: "agent-loop", maxTurns: 2 });
    agent.mailbox.push({
      id: "mail-1",
      from: "user",
      to: agent.id,
      text: "extra instruction",
      createdAt: new Date().toISOString(),
      status: "pending",
      summary: "extra instruction",
    });
    context.agents.push(agent);
    const completed = await runModelBackedAgent(agent, context, new MemoryOutput());
    expect(completed.status).toBe("completed");
    expect(agent.mailbox[0]?.status).toBe("consumed");

    const recoveredContext = await createTestContext([
      [
        { type: "tool_use", id: "tc-invalid", name: "Todo", input: {} },
        { type: "message_stop", chunkCount: 1, hadUsage: false, finishReason: "tool_calls" },
      ],
      [
        { type: "assistant_text_delta", text: "tool error observed; recovered with final answer" },
        { type: "message_stop", chunkCount: 1, hadUsage: false, finishReason: "stop" },
      ],
    ]);
    const recoveredAgent = createAgentRun(recoveredContext, { id: "agent-recovered", maxTurns: 2 });
    recoveredContext.agents.push(recoveredAgent);
    const recovered = await runModelBackedAgent(
      recoveredAgent,
      recoveredContext,
      new MemoryOutput(),
    );
    expect(recovered.status, recovered.summary).toBe("completed");
    expect(recovered.summary).toContain("recovered with final answer");
  });

  it("isolates concurrent agent tool abort owners and drops cancelled late results", async () => {
    const context = await createTestContext([
      [
        { type: "tool_use", id: "tool-a", name: "Read", input: { path: "agent-a.txt" } },
        { type: "message_stop", chunkCount: 1, hadUsage: false, finishReason: "tool_calls" },
      ],
      [
        { type: "tool_use", id: "tool-b", name: "Read", input: { path: "agent-b.txt" } },
        { type: "message_stop", chunkCount: 1, hadUsage: false, finishReason: "tool_calls" },
      ],
      [
        { type: "assistant_text_delta", text: "agent B final" },
        { type: "message_stop", chunkCount: 1, hadUsage: false, finishReason: "stop" },
      ],
    ]);
    const childA = await context.store.create({ model: context.model });
    const childB = await context.store.create({ model: context.model });
    const agentA = createAgentRun(context, {
      id: "agent-owner-a",
      maxTurns: 2,
      transcriptPath: childA.transcriptPath,
      transcriptSessionId: childA.id,
    });
    const agentB = createAgentRun(context, {
      id: "agent-owner-b",
      maxTurns: 2,
      transcriptPath: childB.transcriptPath,
      transcriptSessionId: childB.id,
    });
    context.agents.push(agentA, agentB);
    const taskA = createAgentBackgroundTask(agentA, context);
    const taskB = createAgentBackgroundTask(agentB, context);
    rememberBackgroundTask(context, taskA);
    rememberBackgroundTask(context, taskB);
    const controllerA = registerBackgroundAbortController(context, agentA.id);
    const controllerB = registerBackgroundAbortController(context, agentB.id);
    const foregroundController = new AbortController();
    context.tools.abortSignal = foregroundController.signal;
    const delayedA = deferred<ToolOutput>();
    const delayedB = deferred<ToolOutput>();
    const startedA = deferred<void>();
    const startedB = deferred<void>();
    const seenSignals = new Map<string, AbortSignal | undefined>();
    const originalRead = builtInTools.Read.call;
    builtInTools.Read.call = (async (input: unknown, toolContext: { abortSignal?: AbortSignal }) => {
      const path = (input as { path?: string }).path ?? "";
      seenSignals.set(path, toolContext.abortSignal);
      if (path === "agent-a.txt") {
        startedA.resolve();
        return delayedA.promise;
      }
      startedB.resolve();
      return delayedB.promise;
    }) as typeof originalRead;

    try {
      const runA = runModelBackedAgent(agentA, context, new MemoryOutput());
      await startedA.promise;
      const runB = runModelBackedAgent(agentB, context, new MemoryOutput());
      await startedB.promise;
      expect(context.agentToolContexts?.has(agentA.id)).toBe(true);

      await cancelAgent(agentA, context, new MemoryOutput());
      expect(context.agentToolContexts?.has(agentA.id)).toBe(false);
      expect(controllerA.signal.aborted).toBe(true);
      expect(controllerB.signal.aborted).toBe(false);
      expect(foregroundController.signal.aborted).toBe(false);
      expect(seenSignals.get("agent-a.txt")).toBe(controllerA.signal);
      expect(seenSignals.get("agent-b.txt")).toBe(controllerB.signal);

      delayedB.resolve({ text: "B read complete" });
      const resultB = await runB;
      expect(resultB.status).toBe("completed");
      delayedA.resolve({ text: "A late read must be dropped" });
      const resultA = await runA;
      expect(resultA.status).toBe("blocked");

      const transcriptA = (await context.store.resume(childA.id)).transcript;
      expect(transcriptA.some((event) => event.type === "tool_call_end")).toBe(false);
      expect(transcriptA.some((event) => event.type === "tool_result")).toBe(false);
      expect(context.evidence.some((item) => item.summary.includes("A late read"))).toBe(false);
    } finally {
      builtInTools.Read.call = originalRead;
    }
  });

  it("cancels an approved agent tool owner and drops its late result", async () => {
    const context = await createTestContext([]);
    const child = await context.store.create({ model: context.model });
    const agent = createAgentRun(context, {
      id: "agent-approved-owner",
      transcriptPath: child.transcriptPath,
      transcriptSessionId: child.id,
    });
    agent.status = "blocked";
    context.agents.push(agent);
    rememberBackgroundTask(context, createAgentBackgroundTask(agent, context));
    const delayed = deferred<ToolOutput>();
    const started = deferred<void>();
    const originalWrite = builtInTools.Write.call;
    builtInTools.Write.call = (async () => {
      started.resolve();
      return delayed.promise;
    }) as typeof originalWrite;

    try {
      const pending = executeApprovedAgentToolUse(
        agent,
        {
          id: "approved-tool-owner",
          name: "Write",
          input: { path: "late-approved.txt", content: "late" },
        },
        "Write",
        context,
        agent.parentSessionId ?? "session-parent",
      );
      await started.promise;
      expect(agent.status).toBe("running");
      expect(context.agentToolContexts?.has(agent.id)).toBe(true);
      await cancelAgent(agent, context, new MemoryOutput());
      expect(context.agentToolContexts?.has(agent.id)).toBe(false);
      delayed.resolve({ text: "late approved write result" });
      const result = await pending;

      expect(result.cancelled).toBe(true);
      const transcript = (await context.store.resume(child.id)).transcript;
      expect(transcript.some((event) => event.type === "tool_result")).toBe(false);
      expect(context.evidence.some((item) => item.summary.includes("late approved"))).toBe(false);
    } finally {
      builtInTools.Write.call = originalWrite;
    }
  });

  it.each(["permission_gate", "permission_request", "permission_result"] as const)(
    "does not create a late agent approval when cancelled during %s persistence",
    async (gate) => {
      const context = await createTestContext([], undefined, true);
      const child = await context.store.create({ model: context.model });
      const agent = createAgentRun(context, {
        id: `agent-permission-race-${gate}`,
        type: "worker",
        role: "executor",
        allowedTools: ["Write"],
        transcriptPath: child.transcriptPath,
        transcriptSessionId: child.id,
      });
      context.agents.push(agent);
      rememberBackgroundTask(context, createAgentBackgroundTask(agent, context));
      const controller = registerBackgroundAbortController(context, agent.id);
      const reachedGate = deferred<void>();
      const releaseGate = deferred<void>();
      const originalAppend = context.store.appendEvent.bind(context.store);
      let blocked = false;
      const appendSpy = vi
        .spyOn(context.store, "appendEvent")
        .mockImplementation(async (sessionId, event, commitGuard) => {
          const matches = gate === "permission_gate"
            ? event.type === "system_event" &&
              event.message.includes("meta_orchestration:permission-gate") &&
              event.message.includes("status=consumed")
            : event.type === gate;
          if (!blocked && matches) {
            blocked = true;
            reachedGate.resolve();
            await releaseGate.promise;
          }
          return originalAppend(sessionId, event, commitGuard);
        });
      const toolCall = call("Write", {
        path: `${gate}.txt`,
        content: "must not be written",
      });

      try {
        const pending = __testExecuteAgentToolCall(
          agent,
          toolCall,
          context,
          context.sessionId!,
          new MemoryOutput(),
          controller.signal,
        );
        await reachedGate.promise;
        await cancelAgent(agent, context, new MemoryOutput());
        releaseGate.resolve();
        const result = await pending;

        expect(result).toMatchObject({ ok: false, text: "Agent tool call cancelled." });
        expect(agent.status).toBe("cancelled");
        expect(context.pendingLocalApproval).toBeUndefined();
        await expect(readFile(join(context.projectPath, `${gate}.txt`), "utf8")).rejects.toThrow();
        const transcript = (await context.store.resume(child.id)).transcript;
        expect(
          transcript.some(
            (event) =>
              event.type === "system_event" && event.message.includes("agent_permission_pending"),
          ),
        ).toBe(false);
      } finally {
        releaseGate.resolve();
        appendSpy.mockRestore();
      }
    },
  );

  it.each(["background_event", "agent_persist"] as const)(
    "terminalizes an agent cancelled while its pending approval waits on %s",
    async (gate) => {
      const context = await createTestContext([], undefined, true);
      const child = await context.store.create({ model: context.model });
      const agent = createAgentRun(context, {
        id: `agent-pending-race-${gate}`,
        type: "worker",
        role: "executor",
        allowedTools: ["Write"],
        transcriptPath: child.transcriptPath,
        transcriptSessionId: child.id,
      });
      context.agents.push(agent);
      rememberBackgroundTask(context, createAgentBackgroundTask(agent, context));
      const controller = registerBackgroundAbortController(context, agent.id);
      const reachedGate = deferred<void>();
      const releaseGate = deferred<void>();
      const waitAtGate = async (): Promise<void> => {
        reachedGate.resolve();
        await releaseGate.promise;
      };

      const pending = __testExecuteAgentToolCall(
        agent,
        call("Write", { path: `${gate}.txt`, content: "must not be written" }),
        context,
        context.sessionId!,
        new MemoryOutput(),
        controller.signal,
        gate === "background_event"
          ? { appendBackgroundTaskEvent: waitAtGate }
          : { persistAgentRun: waitAtGate },
      );
      await reachedGate.promise;
      expect(context.pendingLocalApproval).toMatchObject({
        kind: "agent_tool_use",
        agentId: agent.id,
      });
      const cancelled = await cancelAgentByRef(agent.id, context, new MemoryOutput());
      releaseGate.resolve();
      const result = await pending;

      expect(cancelled).toBe(agent);
      expect(result).toMatchObject({ ok: false, text: "Agent tool call cancelled." });
      expect(agent.status).toBe("cancelled");
      expect(context.pendingLocalApproval).toBeUndefined();
      await expect(readFile(join(context.projectPath, `${gate}.txt`), "utf8")).rejects.toThrow();
      const transcript = (await context.store.resume(child.id)).transcript;
      expect(
        transcript.some(
          (event) =>
            event.type === "system_event" && event.message.includes("agent_permission_pending"),
        ),
      ).toBe(false);
      const toolResults = transcript.filter((event) => event.type === "tool_result");
      expect(toolResults).toHaveLength(1);
      expect(JSON.stringify(toolResults[0])).toContain("was NOT executed");
    },
  );

  it("keeps an ordinary blocked agent non-cancellable without an owned approval", async () => {
    const context = await createTestContext([]);
    const agent = createAgentRun(context, {
      id: "agent-blocked-without-approval",
      status: "blocked",
      activityStatus: "blocked",
    });
    context.agents.push(agent);

    const cancelled = await cancelAgentByRef(agent.id, context, new MemoryOutput());

    expect(cancelled).toBeUndefined();
    expect(agent.status).toBe("blocked");
  });

  it("keeps 1000 cancelled agent owners from crossing the permission event barrier", async () => {
    const context = await createTestContext([]);
    const releaseGate = deferred<void>();
    const allReached = deferred<void>();
    const controllers: AbortController[] = [];
    const agents: AgentRun[] = [];
    let permissionRequests = 0;
    let toolExecutions = 0;
    const appendSpy = vi
      .spyOn(context.store, "appendEvent")
      .mockImplementation(async (_sessionId, event) => {
        if (event.type === "permission_request") {
          permissionRequests += 1;
          if (permissionRequests === 1_000) allReached.resolve();
          await releaseGate.promise;
        }
      });
    const originalWrite = builtInTools.Write.call;
    builtInTools.Write.call = (async () => {
      toolExecutions += 1;
      return { text: "unexpected execution" };
    }) as typeof originalWrite;

    try {
      const runs = Array.from({ length: 1_000 }, (_, index) => {
        const agent = createAgentRun(context, {
          id: `agent-pressure-${index}`,
          type: "worker",
          role: "executor",
          allowedTools: ["Write"],
          permissionMode: "full-access",
        });
        const controller = new AbortController();
        agents.push(agent);
        controllers.push(controller);
        return __testExecuteAgentToolCall(
          agent,
          {
            id: `pressure-tool-${index}`,
            name: "Write",
            input: { path: `pressure-${index}.txt`, content: "no" },
          },
          context,
          context.sessionId!,
          new MemoryOutput(),
          controller.signal,
        );
      });
      await allReached.promise;
      for (let index = 0; index < agents.length; index += 1) {
        agents[index]!.status = "cancelled";
        controllers[index]!.abort();
      }
      releaseGate.resolve();
      const results = await Promise.all(runs);

      expect(permissionRequests).toBe(1_000);
      expect(results).toHaveLength(1_000);
      expect(results.every((result) => result.text === "Agent tool call cancelled.")).toBe(true);
      expect(toolExecutions).toBe(0);
      expect(context.pendingLocalApproval).toBeUndefined();
    } finally {
      releaseGate.resolve();
      builtInTools.Write.call = originalWrite;
      appendSpy.mockRestore();
    }
  });

  it("does not revive a cancelled agent while recording permission denial", async () => {
    const context = await createTestContext([]);
    const agent = createAgentRun(context, {
      id: "agent-deny-cancelled",
      status: "cancelled",
      activityStatus: "cancelled",
      summary: "cancelled owner remains terminal",
    });
    context.agents.push(agent);

    await denyAgentToolUse(
      agent,
      call("Write", { path: "never.txt", content: "no" }),
      "Write",
      context,
      context.sessionId!,
      "permission cancelled by user",
    );

    expect(agent.status).toBe("cancelled");
    expect(agent.activityStatus).toBe("cancelled");
    expect(agent.summary).toBe("cancelled owner remains terminal");
  });

  it("clears agent tool contexts on stale and permission-denied terminals", async () => {
    const context = await createTestContext([]);
    const childA = await context.store.create({ model: context.model });
    const staleAgent = createAgentRun(context, {
      id: "agent-stale-cleanup",
      transcriptPath: childA.transcriptPath,
      transcriptSessionId: childA.id,
    });
    const childB = await context.store.create({ model: context.model });
    const deniedAgent = createAgentRun(context, {
      id: "agent-denied-cleanup",
      transcriptPath: childB.transcriptPath,
      transcriptSessionId: childB.id,
    });
    deniedAgent.status = "blocked";
    context.agents.push(staleAgent, deniedAgent);
    rememberBackgroundTask(context, createAgentBackgroundTask(staleAgent, context));
    rememberBackgroundTask(context, createAgentBackgroundTask(deniedAgent, context));
    context.agentToolContexts = new Map([
      [staleAgent.id, createToolContext(context.projectPath)],
      [deniedAgent.id, createToolContext(context.projectPath)],
    ]);
    registerBackgroundAbortController(context, staleAgent.id);

    await markRunningAgentsStaleForInterrupt(context, context.sessionId!);
    expect(context.agentToolContexts.has(staleAgent.id)).toBe(false);

    await denyAgentToolUse(
      deniedAgent,
      { id: "denied-cleanup", name: "Write", input: {} },
      "Write",
      context,
      context.sessionId!,
      "denied",
    );
    expect(context.agentToolContexts.has(deniedAgent.id)).toBe(false);
  });

  it("runModelBackedAgent keeps default handoff separate from explicit full-context fork", async () => {
    const parentMessages: ModelMessage[] = [
      { role: "system", content: "PARENT_SYSTEM_SENTINEL stable runtime" },
      { role: "user", content: "PARENT_USER_SENTINEL original task" },
      { role: "assistant", content: "PARENT_ASSISTANT_SENTINEL progress" },
    ];
    const parentTools = createModelToolDefinitionsForTools([builtInTools.Read, builtInTools.Todo]);

    const defaultRequests: ModelRequest[] = [];
    const defaultContext = await createTestContext(undefined, (request) => {
      defaultRequests.push(request);
    });
    rememberCacheSafePrefix(defaultContext.cache, {
      messages: parentMessages,
      model: "deepseek-chat",
      endpointProfile: "chat_completions",
      tools: parentTools,
      toolChoice: "auto",
    });
    await runModelBackedAgent(createAgentRun(defaultContext), defaultContext, new MemoryOutput());

    expect(defaultRequests[0]?.messages.map((message) => message.content)).toEqual([
      "PARENT_SYSTEM_SENTINEL stable runtime",
      expect.stringContaining("Linghun planner child agent"),
      "inspect",
    ]);
    expect(defaultRequests[0]?.messages.map((message) => message.content)).not.toContain(
      "PARENT_USER_SENTINEL original task",
    );

    const fullForkRequests: ModelRequest[] = [];
    const fullForkContext = await createTestContext(undefined, (request) => {
      fullForkRequests.push(request);
    });
    rememberCacheSafePrefix(fullForkContext.cache, {
      messages: parentMessages,
      model: "deepseek-chat",
      endpointProfile: "chat_completions",
      tools: parentTools,
      toolChoice: "auto",
    });
    await runModelBackedAgent(
      createAgentRun(fullForkContext, {
        contextMode: "full_fork",
        task: "CHILD_TASK_SENTINEL inspect current implementation",
      }),
      fullForkContext,
      new MemoryOutput(),
    );

    const fullForkContents = fullForkRequests[0]?.messages.map((message) => message.content) ?? [];
    expect(fullForkContents).toEqual([
      "PARENT_SYSTEM_SENTINEL stable runtime",
      "PARENT_USER_SENTINEL original task",
      "PARENT_ASSISTANT_SENTINEL progress",
      expect.stringContaining("CHILD_TASK_SENTINEL inspect current implementation"),
    ]);
    expect(fullForkContents.at(-1)).toContain("<linghun-full-context-fork>");
  });

  it("keeps an agent on its invocation cache prefix after the foreground changes", async () => {
    const requests: ModelRequest[] = [];
    const context = await createTestContext(undefined, (request) => {
      requests.push(structuredClone(request));
    });
    rememberCacheSafePrefix(context.cache, {
      messages: [{ role: "system", content: "AGENT_A_PREFIX" }],
      model: "deepseek-chat",
      endpointProfile: "chat_completions",
      tools: createModelToolDefinitionsForTools([builtInTools.Read, builtInTools.Todo]),
      toolChoice: "auto",
    });
    const agent = createAgentRun(context, { id: "agent-cache-a" });
    rememberCacheSafePrefix(context.cache, {
      messages: [{ role: "system", content: "FOREGROUND_B_PREFIX" }],
      model: "deepseek-chat",
      endpointProfile: "chat_completions",
      tools: createModelToolDefinitionsForTools([builtInTools.Read, builtInTools.Todo]),
      toolChoice: "auto",
    });

    await runModelBackedAgent(agent, context, new MemoryOutput());

    const payload = JSON.stringify(requests[0]);
    expect(payload).toContain("AGENT_A_PREFIX");
    expect(payload).not.toContain("FOREGROUND_B_PREFIX");
  });

  it("rotates the agent requestContextId when same-provider retry resets the attempt", async () => {
    const requestContextIds: string[] = [];
    const context = await createTestContext(
      [
        [
          { type: "assistant_text_delta", text: "OLD_PARTIAL" },
          { type: "error", error: { code: "PROVIDER_NETWORK_ERROR", message: "retry" } },
        ],
        [
          { type: "assistant_text_delta", text: "NEW_COMPLETE" },
          { type: "message_stop", chunkCount: 1, hadUsage: false, finishReason: "stop" },
        ],
      ],
      (request) => {
        if (request.requestContextId) requestContextIds.push(request.requestContextId);
      },
    );
    context.lastMetaSchedulerDecision = {
      orchestrationPlan: {
        steps: [
          {
            id: "provider-retry",
            executor: "provider-runtime",
            mode: "stop",
            reason: "unrelated foreground retry stop",
          },
        ],
      },
    } as TuiContext["lastMetaSchedulerDecision"];

    const result = await runModelBackedAgent(
      createAgentRun(context, { id: "agent-request-context" }),
      context,
      new MemoryOutput(),
    );

    expect(result.status, result.summary).toBe("completed");
    expect(requestContextIds).toHaveLength(2);
    expect(new Set(requestContextIds).size).toBe(2);
  });

  it("runModelBackedAgent does not recursively inherit a full-context fork prefix", async () => {
    const requests: ModelRequest[] = [];
    const context = await createTestContext(undefined, (request) => {
      requests.push(request);
    });
    rememberCacheSafePrefix(context.cache, {
      messages: [
        { role: "system", content: "PARENT_SYSTEM_SENTINEL stable runtime" },
        { role: "user", content: "<linghun-full-context-fork>\nPARENT_USER_FROM_PRIOR_FORK" },
      ],
      model: "deepseek-chat",
      endpointProfile: "chat_completions",
      tools: createModelToolDefinitionsForTools([builtInTools.Read, builtInTools.Todo]),
      toolChoice: "auto",
    });

    await runModelBackedAgent(
      createAgentRun(context, { contextMode: "full_fork" }),
      context,
      new MemoryOutput(),
    );

    const contents = requests[0]?.messages.map((message) => message.content) ?? [];
    expect(contents).toEqual([
      "PARENT_SYSTEM_SENTINEL stable runtime",
      expect.stringContaining("Linghun planner child agent"),
      "inspect",
    ]);
    expect(contents).not.toContain("<linghun-full-context-fork>\nPARENT_USER_FROM_PRIOR_FORK");
  });

  it("covers slash command runtime routing for ten common commands", async () => {
    const context = await createTestContext();
    const output = new MemoryOutput();
    const seen: string[] = [];
    configureSlashCommandRuntime({
      handleSlashCommand: async (text, _context, out) => {
        seen.push(text);
        out.write(`handled:${text}\n`);
        return text === "/exit" ? "exit" : "handled";
      },
    });

    const commands = [
      "/help",
      "/model",
      "/usage",
      "/context",
      "/permissions",
      "/memory",
      "/agents",
      "/workflows",
      "/index",
      "/details",
    ];
    for (const command of commands) {
      await expect(handleSlashCommand(command, context, output)).resolves.toBe("handled");
    }
    expect(seen).toEqual(commands);
  });

  it("covers workflow main-chain branches and registry unknown action", async () => {
    const context = await createTestContext();
    context.workflows.activeRun = {
      id: "wf-run",
      goal: "goal",
      planId: "wf",
      status: "running",
      result: "partial",
      phaseGateConfirmed: true,
      steps: [],
      startedAt: new Date().toISOString(),
    };
    const output = new MemoryOutput();
    const branches: WorkflowBridgeRequestProposal[] = [
      workflowRequest("details", {
        mainChain: "details",
        view: "evidence",
        refs: ["ev-1"],
        workflowId: "wf",
        phaseId: "phase-e",
        sliceId: "details",
      }),
      workflowRequest("agents", {
        mainChain: "agents",
        action: "list",
        workflowId: "wf",
        phaseId: "phase-e",
        sliceId: "agents",
      }),
      workflowRequest("workflows", {
        mainChain: "workflows",
        action: "list",
        workflowId: "wf",
        phaseId: "phase-e",
        sliceId: "workflows",
      }),
      workflowRequest("verification", {
        mainChain: "verification",
        level: "focused",
        workflowId: "wf",
        phaseId: "phase-e",
        sliceId: "verification",
        evidenceRefs: [],
      }),
      workflowRequest("job", {
        mainChain: "job",
        action: "list",
        phase: "phase-e",
        target: "tests",
        workflowId: "wf",
        phaseId: "phase-e",
        sliceId: "job",
      }),
      workflowRequest("unsupported", null),
    ];

    const results = [];
    for (const request of branches) {
      results.push(await __testExecuteWorkflowStep(request, context, output));
    }
    expect(results.map((result) => result.status)).toEqual(
      expect.arrayContaining(["completed", "blocked"]),
    );

    const runningTask = createBackgroundTask("agent-task", "agent", "running");
    runningTask.workflowRunId = "wf-run";
    context.backgroundTasks.push(runningTask);
    const forkBlocked = await __testExecuteWorkflowStep(
      workflowRequest("fork", {
        mainChain: "fork",
        role: "planner",
        task: "fork task",
        workflowId: "wf",
        phaseId: "phase-e",
        sliceId: "fork",
        contextRefs: emptyWorkflowContextRefs(),
      }),
      context,
      output,
      "wf-run",
      1,
    );
    expect(forkBlocked.status).toBe("blocked");

    const registryUnknown = await __testExecuteRegistryWorkflowStep(
      { id: "reg", name: "Registry", description: "", path: "registry.yml", steps: [] },
      { id: "s1", title: "Unknown", action: "unknown-action" } as never,
      "goal",
      context,
      output,
    );
    expect(registryUnknown.status).toBe("blocked");
  }, 60_000);

  it("keeps workflow verification on its invocation constraints", async () => {
    const context = await createTestContext();
    context.currentRequestTurnId = "foreground-new";
    context.currentUserActionConstraintsRequestTurnId = "foreground-new";
    context.currentUserActionConstraints = parseUserActionConstraints(
      "不要运行 test、build、lint、typecheck 或 shell 命令",
    );
    context.workflows.activeRun = {
      id: "wf-owned-verification",
      goal: "readonly audit",
      planId: "wf",
      status: "running",
      result: "partial",
      phaseGateConfirmed: true,
      confirmedPhaseStopPoints: ["phase-e"],
      permissionMode: "full-access",
      invokingRequestTurnId: "foreground-old",
      userActionConstraints: parseUserActionConstraints("只读审计，不要修改文件"),
      steps: [],
      startedAt: new Date().toISOString(),
    };

    const result = await __testExecuteWorkflowStep(
      workflowRequest("verification-owned", {
        mainChain: "verification",
        level: "focused",
        workflowId: "wf",
        phaseId: "phase-e",
        sliceId: "verification-owned",
        evidenceRefs: [],
      }),
      context,
      new MemoryOutput(),
      "wf-owned-verification",
    );

    expect(result.summary).not.toContain("plan-only requested");
    expect(context.lastVerification?.summary).not.toContain("plan-only requested");
  }, 60_000);

  it("keeps registry Write on the workflow permission and evidence owner", async () => {
    const context = await createTestContext();
    context.permissionMode = "full-access";
    context.currentRequestTurnId = "foreground-b";
    const workflow = {
      id: "registry-owner",
      name: "Registry owner",
      description: "",
      path: "registry.yml",
      steps: [],
    };
    context.workflows.activeRun = {
      id: "workflow-owner-a",
      ownerSessionId: context.sessionId,
      cwd: context.projectPath,
      goal: "readonly workflow",
      planId: workflow.id,
      status: "running",
      result: "partial",
      phaseGateConfirmed: true,
      confirmedPhaseStopPoints: [workflow.id],
      permissionMode: "full-access",
      invokingRequestTurnId: "request-a",
      userActionConstraints: parseUserActionConstraints("只读，不要修改文件"),
      steps: [],
      startedAt: new Date().toISOString(),
    };

    const result = await __testExecuteRegistryWorkflowStep(
      workflow,
      { id: "write-owned", action: "write", path: "owned.txt", content: "x" },
      "goal",
      context,
      new MemoryOutput(),
      "workflow-owner-a",
    );

    expect(result.status).toBe("blocked");
    await expect(readFile(join(context.projectPath, "owned.txt"), "utf8")).rejects.toThrow();
    const evidence = context.evidence.find((item) => item.summary.includes("Write failure"));
    expect(evidence?.ownerScope).toMatchObject({
      ownerSessionId: context.sessionId,
      requestTurnId: "request-a",
      workflowRunId: "workflow-owner-a",
      cwd: context.projectPath,
    });
    expect(evidence && evidenceMatchesRequestOwner(evidence, context)).toBe(false);
  });

  it("keeps registry Bash on the workflow permission and evidence owner", async () => {
    const context = await createTestContext();
    context.permissionMode = "full-access";
    context.currentRequestTurnId = "foreground-b";
    const workflow = {
      id: "registry-bash-owner",
      name: "Registry Bash owner",
      description: "",
      path: "registry.yml",
      steps: [],
    };
    context.workflows.activeRun = {
      id: "workflow-bash-owner-a",
      ownerSessionId: context.sessionId,
      cwd: context.projectPath,
      goal: "readonly workflow",
      planId: workflow.id,
      status: "running",
      result: "partial",
      phaseGateConfirmed: true,
      confirmedPhaseStopPoints: [workflow.id],
      permissionMode: "full-access",
      invokingRequestTurnId: "request-a",
      userActionConstraints: parseUserActionConstraints("不要执行命令"),
      steps: [],
      startedAt: new Date().toISOString(),
    };

    const result = await __testExecuteRegistryWorkflowStep(
      workflow,
      { id: "bash-owned", action: "bash", command: "node -e \"process.exit(0)\"" },
      "goal",
      context,
      new MemoryOutput(),
      "workflow-bash-owner-a",
    );

    expect(result.status).toBe("blocked");
    const evidence = context.evidence.find((item) => item.summary.includes("Bash failure"));
    expect(evidence?.ownerScope).toMatchObject({
      requestTurnId: "request-a",
      workflowRunId: "workflow-bash-owner-a",
      cwd: context.projectPath,
    });
    expect(evidence && evidenceMatchesRequestOwner(evidence, context)).toBe(false);
  });

  it("does not let foreground plan mode downgrade a full-access registry Write", async () => {
    const context = await createTestContext();
    context.permissionMode = "plan";
    context.currentRequestTurnId = "foreground-b";
    context.currentUserActionConstraintsRequestTurnId = "foreground-b";
    context.currentUserActionConstraints = parseUserActionConstraints("只读，不要修改文件");
    const workflow = {
      id: "registry-full-access",
      name: "Registry full access",
      description: "",
      path: "registry.yml",
      steps: [],
    };
    context.workflows.activeRun = {
      id: "workflow-full-access-a",
      ownerSessionId: context.sessionId,
      cwd: context.projectPath,
      goal: "write workflow",
      planId: workflow.id,
      status: "running",
      result: "partial",
      phaseGateConfirmed: true,
      confirmedPhaseStopPoints: [workflow.id],
      permissionMode: "full-access",
      invokingRequestTurnId: "request-a",
      steps: [],
      startedAt: new Date().toISOString(),
    };

    const result = await __testExecuteRegistryWorkflowStep(
      workflow,
      { id: "write-full", action: "write", path: "full.txt", content: "ok" },
      "goal",
      context,
      new MemoryOutput(),
      "workflow-full-access-a",
    );

    expect(result.status).toBe("completed");
    await expect(readFile(join(context.projectPath, "full.txt"), "utf8")).resolves.toBe("ok");
    const evidence = context.evidence.find((item) => item.ownerScope?.workflowRunId === "workflow-full-access-a");
    expect(evidence?.ownerScope).toMatchObject({
      requestTurnId: "request-a",
      workflowRunId: "workflow-full-access-a",
    });
  });

  it("propagates workflow invocation ownership into forked agents", async () => {
    const context = await createTestContext();
    context.permissionMode = "plan";
    context.currentRequestTurnId = "foreground-new";
    context.currentUserActionConstraintsRequestTurnId = "foreground-new";
    context.currentUserActionConstraints = parseUserActionConstraints("只读，不要写文件");
    context.lastMetaSchedulerDecision = {
      policyDecision: {
        engineeringSignal: {
          profile: "binary_or_artifact",
          strategyHint: "unrelated foreground signal",
          artifactTargets: ["foreground.bin"],
        },
      },
      orchestrationPlan: {
        steps: [
          {
            id: "agent-dispatch",
            executor: "agent-runtime",
            mode: "stop",
            reason: "unrelated foreground stop",
          },
        ],
      },
    } as TuiContext["lastMetaSchedulerDecision"];
    context.workflows.activeRun = {
      id: "wf-owned-fork",
      goal: "implement",
      planId: "wf",
      status: "running",
      result: "partial",
      phaseGateConfirmed: true,
      confirmedPhaseStopPoints: ["phase-e"],
      permissionMode: "full-access",
      invokingRequestTurnId: "foreground-old",
      steps: [],
      startedAt: new Date().toISOString(),
    };

    await __testExecuteWorkflowStep(
      workflowRequest("fork-owned", {
        mainChain: "fork",
        role: "worker",
        task: "inspect ownership",
        workflowId: "wf",
        phaseId: "phase-e",
        sliceId: "fork-owned",
        contextRefs: emptyWorkflowContextRefs(),
      }),
      context,
      new MemoryOutput(),
      "wf-owned-fork",
      1,
    );

    const agent = context.agents.find((item) => item.task === "inspect ownership");
    expect(agent?.permissionMode).toBe("full-access");
    expect(agent?.invokingRequestTurnId).toBe("foreground-old");
    expect(agent?.userActionConstraints).toBeUndefined();
    expect(agent?.engineeringSignal).toBeUndefined();
    expect(context.backgroundTasks.find((task) => task.id === agent?.id)?.workflowRunId).toBe(
      "wf-owned-fork",
    );
  }, 60_000);

  it("returns the created registry AgentRun instead of a mutable active workflow", async () => {
    const context = await createTestContext();
    context.permissionMode = "full-access";
    context.workflows.activeRun = {
      id: "workflow-unrelated",
      ownerSessionId: context.sessionId,
      goal: "unrelated",
      planId: "unrelated",
      status: "running",
      result: "partial",
      steps: [],
      startedAt: new Date().toISOString(),
    };
    context.agentRegistry.agents.push({
      id: "registry-reviewer",
      name: "registry-reviewer",
      description: "review",
      prompt: "Review the task",
      path: "registry-reviewer.md",
    });

    const result = await executeLinghunControlToolUse(
      call(RUN_WORKFLOW_TOOL_NAME, {
        workflowId: "agent:registry-reviewer",
        goal: "inspect owner",
        runInBackground: true,
      }),
      context,
      context.sessionId ?? "session",
      new MemoryOutput(),
    );
    const data = result.data as { agentId?: string; workflowId?: string; status?: string };

    expect(result.ok).toBe(true);
    expect(data.agentId).toMatch(/^agent-/u);
    expect(data.workflowId).toBeUndefined();
    expect(context.backgroundTasks.find((task) => task.id === data.agentId)?.workflowRunId).toBeUndefined();
  });

  it("filters 1000 interleaved workflow evidence transitions by explicit owner", async () => {
    const context = await createTestContext();
    context.evidence = Array.from({ length: 1_000 }, (_, index) => ({
      id: `evidence-${index}`,
      kind: "command_output" as const,
      source: `workflow:${index % 2 === 0 ? "workflow-a" : "workflow-b"}`,
      summary: `evidence ${index}`,
      supportsClaims: [],
      ownerScope: {
        ownerSessionId: context.sessionId,
        workflowRunId: index % 2 === 0 ? "workflow-a" : "workflow-b",
        cwd: context.projectPath,
      },
      createdAt: new Date().toISOString(),
    }));

    const refsA = __testNewWorkflowEvidenceRefs([], context, "workflow-a");
    const refsB = __testNewWorkflowEvidenceRefs([], context, "workflow-b");

    expect(refsA).toHaveLength(500);
    expect(refsB).toHaveLength(500);
    expect(refsA.every((id) => Number(id.slice("evidence-".length)) % 2 === 0)).toBe(true);
    expect(refsB.every((id) => Number(id.slice("evidence-".length)) % 2 === 1)).toBe(true);
  });

  it("cancelling an agent terminalizes only its pending tool approval", async () => {
    const context = await createTestContext();
    const agent = createAgentRun(context, { id: "agent-pending-cancel", status: "running" });
    context.agents.push(agent);
    const controller = registerBackgroundAbortController(context, agent.id);
    context.agentToolContexts = new Map([[agent.id, createToolContext(context.projectPath)]]);
    const pendingToolCall = call("Write", { path: "cancelled.txt", content: "no" });
    context.pendingLocalApproval = {
      kind: "agent_tool_use",
      agentId: agent.id,
      agentTranscriptSessionId: agent.transcriptSessionId,
      toolCall: pendingToolCall,
      toolName: "Write",
      sessionId: context.sessionId ?? "session",
    };

    await cancelAgent(agent, context, new MemoryOutput());

    expect(context.pendingLocalApproval).toBeUndefined();
    expect(agent.status).toBe("cancelled");
    expect(controller.signal.aborted).toBe(true);
    expect(context.agentToolContexts.has(agent.id)).toBe(false);
    const transcript = await context.store.readRecentTranscriptEvents(
      agent.transcriptSessionId,
      { limit: 20 },
    );
    expect(transcript.events.some((event) =>
      event.type === "tool_result" &&
      event.toolUseId === pendingToolCall.id &&
      event.isError === true
    )).toBe(true);
    await expect(readFile(join(context.projectPath, "cancelled.txt"), "utf8")).rejects.toThrow();
  });

  it("cancelling one agent preserves another agent pending approval", async () => {
    const context = await createTestContext();
    const agentA = createAgentRun(context, { id: "agent-cancel-a", status: "running" });
    const agentB = createAgentRun(context, { id: "agent-approve-b", status: "running" });
    context.agents.push(agentA, agentB);
    const approval: PendingLocalApproval = {
      kind: "agent_tool_use",
      agentId: agentB.id,
      agentTranscriptSessionId: agentB.transcriptSessionId,
      toolCall: call("Write", { path: "b.txt", content: "b" }),
      toolName: "Write",
      sessionId: context.sessionId ?? "session",
    };
    context.pendingLocalApproval = approval;

    await cancelAgent(agentA, context, new MemoryOutput());

    expect(context.pendingLocalApproval).toBe(approval);
    expect(agentA.status).toBe("cancelled");
    expect(agentB.status).toBe("running");
  });

  it("still aborts and terminalizes an agent when pending approval recording fails", async () => {
    const context = await createTestContext();
    const agent = createAgentRun(context, { id: "agent-approval-error", status: "running" });
    context.agents.push(agent);
    const controller = registerBackgroundAbortController(context, agent.id);
    context.pendingLocalApproval = {
      kind: "agent_tool_use",
      agentId: agent.id,
      agentTranscriptSessionId: agent.transcriptSessionId,
      toolCall: call("Write", { path: "never.txt", content: "no" }),
      toolName: "Write",
      sessionId: context.sessionId ?? "session",
    };
    const originalAppend = context.store.appendEvent.bind(context.store);
    vi.spyOn(context.store, "appendEvent").mockImplementation(async (sessionId, event, commitGuard) => {
      if (event.type === "system_event" && event.message.startsWith("agent_permission_denied:")) {
        throw new Error("approval transcript unavailable");
      }
      return originalAppend(sessionId, event, commitGuard);
    });

    await expect(cancelAgent(agent, context, new MemoryOutput())).resolves.toBeUndefined();

    expect(context.pendingLocalApproval).toBeUndefined();
    expect(controller.signal.aborted).toBe(true);
    expect(agent.status).toBe("cancelled");
    expect(agent.summary).toContain("终结记录降级");
  });

  it("covers executePermissionApprove across all pending approval kinds", async () => {
    const base = await createTestContext();
    const sessionId = base.sessionId ?? "session";
    const approvals: PendingLocalApproval[] = [
      {
        kind: "agent_tool_use",
        agentId: "missing-agent",
        agentTranscriptSessionId: "missing-session",
        toolCall: call("Bash", { command: "echo ok" }),
        toolName: "Bash",
        sessionId,
      },
      {
        kind: "index_ignore_write",
        plan: { path: ".cbmignore", content: "dist/\n", missingEntries: ["dist/"] },
      },
      {
        kind: "architecture_drift",
        toolCall: call("Todo", { items: [] }),
        toolName: "Todo",
        sessionId,
        warnings: ["scope drift"],
      },
      {
        kind: "model_tool_use",
        toolCall: call("Todo", { items: [] }),
        toolName: "Todo",
        sessionId,
      },
      {
        kind: "git_worktree_remove",
        sessionId,
        name: "missing-worktree",
        path: join(base.projectPath, ".linghun", "worktrees", "missing-worktree"),
        force: false,
        strong: false,
      },
      {
        kind: "git_stable_point",
        sessionId,
        message: "phase e stable point",
        includeUntracked: false,
        toolCall: call("GitStablePointCreate", { message: "phase e stable point" }),
      },
      {
        kind: "index_tool",
        indexAction: "refresh",
        toolCall: call("IndexRefresh", { force: false }),
        sessionId,
      },
      {
        kind: "report_write_tool",
        toolCall: call("WriteReport", { path: "report.md", content: "ok" }),
        sessionId,
      },
      {
        kind: "memory_mutation",
        sessionId,
        mutation: { action: "reject", candidate: memoryCandidate("mem-1") },
      },
      { kind: "break_cache_mutation", sessionId, action: "once" },
      {
        kind: "image_generation",
        sessionId,
        prompt: "phase e image",
        id: "image-phase-e",
        assetPath: join(base.projectPath, ".linghun", "assets", "image-phase-e.json"),
        provider: "local",
        model: "metadata",
      },
    ];

    for (const approval of approvals) {
      const context = await cloneContextForApproval(base, approval.kind);
      await expect(
        executePermissionApprove(
          rewriteApprovalSession(approval, context),
          context,
          undefined,
          new MemoryOutput(),
        ),
      ).resolves.toBeUndefined();
    }
  }, 60_000);

  it("drops an approved foreground tool result after its continuation owner becomes stale", async () => {
    const context = await createTestContext();
    const sessionId = context.sessionId ?? "session";
    const toolCall = call("Bash", { command: "vitest --run" });
    const controller = new AbortController();
    const started = deferred<void>();
    const result = deferred<ToolOutput>();
    const originalCall = builtInTools.Bash.call;
    builtInTools.Bash.call = (async () => {
      started.resolve();
      return result.promise;
    }) as typeof originalCall;

    try {
      const approval = executePermissionApprove(
        {
          kind: "model_tool_use",
          toolCall,
          toolName: "Bash",
          sessionId,
          continuation: {
            messages: [
              { role: "user", content: "run tests" },
              { role: "assistant", content: "", toolCalls: [toolCall] },
            ],
            provider: "openai-compatible",
            model: "gpt-test",
            endpointProfile: "chat_completions",
            reasoningSent: false,
            requestTurnId: "invoking-request",
            abortSignal: controller.signal,
          },
        },
        context,
        gateway([]),
        new MemoryOutput(),
      );
      await started.promise;
      context.currentRequestTurnId = "replacement-request";
      controller.abort("replacement-request");
      result.resolve({ text: "late pass", data: { exitCode: 0 } });
      await approval;

      const transcript = (await context.store.resume(sessionId)).transcript;
      expect(
        transcript.some(
          (event) =>
            (event.type === "tool_call_end" && event.id === toolCall.id) ||
            (event.type === "tool_result" && event.toolUseId === toolCall.id) ||
            (event.type === "evidence_record" && event.toolUseId === toolCall.id),
        ),
      ).toBe(false);
      expect(context.evidence.some((evidence) => evidence.toolUseId === toolCall.id)).toBe(false);
      expect(context.currentRequestTurnId).toBe("replacement-request");
    } finally {
      builtInTools.Bash.call = originalCall;
    }
  });

  it("scopes approved Bash verification evidence to the resumed foreground owner", async () => {
    const context = await createTestContext();
    const sessionId = context.sessionId ?? "session";
    const toolCall = call("Bash", { command: "vitest --run" });
    const controller = new AbortController();
    const originalCall = builtInTools.Bash.call;
    builtInTools.Bash.call = (async () => ({
      text: "tests passed",
      data: { exitCode: 0 },
    })) as typeof originalCall;

    try {
      await executePermissionApprove(
        {
          kind: "model_tool_use",
          toolCall,
          toolName: "Bash",
          sessionId,
          continuation: {
            messages: [
              { role: "user", content: "run tests" },
              { role: "assistant", content: "", toolCalls: [toolCall] },
            ],
            provider: "openai-compatible",
            model: "gpt-test",
            endpointProfile: "chat_completions",
            reasoningSent: false,
            requestTurnId: "invoking-request",
            abortSignal: controller.signal,
          },
        },
        context,
        gateway([
          { type: "assistant_text_delta", text: "verification recorded" },
          { type: "message_stop", chunkCount: 1, hadUsage: false, finishReason: "stop" },
        ]),
        new MemoryOutput(),
      );

      const evidence = context.evidence.find((item) => item.toolUseId === toolCall.id);
      const verificationScope = (evidence?.data as { verificationScope?: Record<string, unknown> })
        ?.verificationScope;
      expect(evidence?.supportsClaims).toContain("test_passed");
      expect(evidence?.ownerScope).toMatchObject({
        ownerSessionId: sessionId,
        requestTurnId: verificationScope?.requestTurnId,
        cwd: context.projectPath,
      });
      expect(verificationScope).toMatchObject({
        ownerSessionId: sessionId,
        requestTurnId: "invoking-request",
        cwd: context.projectPath,
        changedFiles: [],
      });
    } finally {
      builtInTools.Bash.call = originalCall;
    }
  });

  it("covers permission policy auto-allow, require-permission, hard-deny, and natural intent branches", async () => {
    const context = await createTestContext();
    expect(
      classifyToolRequest({
        toolName: "Bash",
        input: { command: "git status --short" },
        workspaceRoot: context.projectPath,
      }).decision,
    ).toBe("auto_allow_readonly");
    expect(
      classifyToolRequest({
        toolName: "Bash",
        input: { command: "npm install" },
        workspaceRoot: context.projectPath,
      }).decision,
    ).toBe("auto_allow_development");
    expect(
      classifyToolRequest({
        toolName: "Bash",
        input: { command: "git push" },
        workspaceRoot: context.projectPath,
      }).decision,
    ).toBe("require_permission");
    const denied = await decidePermission(
      "Bash",
      { command: "rm -rf /" },
      context,
      context.sessionId ?? "session",
    );
    expect(denied.decision).toBe("deny");

    const actions = [
      routeNaturalIntent("当前状态").capability?.id,
      routeNaturalIntent("查看模型").capability?.id,
      routeNaturalIntent("帮我重建索引").capability?.id,
      routeNaturalIntent("后台任务状态").capability?.id,
      routeNaturalIntent("任务报告").capability?.id,
      routeNaturalIntent("切到自动审查").capability?.id,
      routeNaturalIntent("持续推进这个任务").capability?.id,
      routeNaturalIntent("解释 /doctor").capability?.id,
    ];
    expect(new Set(actions.filter(Boolean)).size).toBeGreaterThanOrEqual(6);
  });
});

function call(name: string, input: unknown): ModelToolCall {
  return { id: `tc-${name}-${Math.random().toString(16).slice(2)}`, name, input };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function gateway(
  events: TestStreamEvent[],
  onRequest?: (request: ModelRequest) => void,
): ModelGateway {
  return {
    async *stream(...args: unknown[]) {
      const request = findModelRequestArg(args);
      if (request) onRequest?.(request);
      for (const event of events) yield event;
    },
    async countMessagesTokensWithAPI() {
      return { source: "unavailable", reason: "test" };
    },
  } as unknown as ModelGateway;
}

function gatewayByTurn(
  turns: TestStreamEvent[][],
  onRequest?: (request: ModelRequest) => void,
): ModelGateway {
  let index = 0;
  return {
    async *stream(...args: unknown[]) {
      const request = findModelRequestArg(args);
      if (request) onRequest?.(request);
      const events = turns[index] ?? [];
      index += 1;
      for (const event of events) {
        if (event.type === "error") {
          throw Object.assign(new Error(event.error.message), event.error);
        }
        yield event;
      }
    },
    async countMessagesTokensWithAPI() {
      return { source: "unavailable", reason: "test" };
    },
  } as unknown as ModelGateway;
}

function findModelRequestArg(args: unknown[]): ModelRequest | undefined {
  return args.find(
    (arg): arg is ModelRequest =>
      Boolean(arg && typeof arg === "object" && Array.isArray((arg as ModelRequest).messages)),
  );
}

function abortingGateway(context: TuiContext, events: TestStreamEvent[]): ModelGateway {
  return {
    async *stream() {
      for (const [index, event] of events.entries()) {
        yield event;
        if (index === 0) {
          context.activeAbortController?.abort();
        }
      }
    },
    async countMessagesTokensWithAPI() {
      return { source: "unavailable", reason: "test" };
    },
  } as unknown as ModelGateway;
}

function workflowRequest(
  sliceId: string,
  request: WorkflowBridgeRequestProposal["request"],
): WorkflowBridgeRequestProposal {
  return {
    id: `proposal-${sliceId}`,
    proposalOnly: true,
    workflowId: "wf",
    phaseId: "phase-e",
    sliceId,
    status: request ? "runnable" : "blocked",
    reason: request ? "test" : "unsupported nested job request",
    executable: Boolean(request),
    request,
    safety: {
      readonly:
        !request ||
        request.mainChain === "details" ||
        request.mainChain === "agents" ||
        request.mainChain === "workflows",
      mutating: request?.mainChain === "fork" || request?.mainChain === "job",
      requiresStartGate: false,
      requiresPermissionPipeline: false,
      requiredPermissionAction: "none",
      evidencePolicy: "neverTreatCompletionAsPass",
    },
    handoffProposal: emptyWorkflowContextRefs(),
    backgroundProjection: {
      source: "background-task-projection",
      kind: "agent",
      userVisibleSummary: "test",
      nextAction: "none",
    },
    taskSurfaceInput: {
      phaseId: "phase-e",
      sliceId,
      requestStatus: request ? "runnable" : "blocked",
      evidenceRefs: [],
      nextAction: "none",
    },
  } satisfies WorkflowBridgeRequestProposal;
}

function emptyWorkflowContextRefs(): WorkflowBridgeContextRefs {
  return {
    boundedRefs: [],
    workspaceCacheRefs: [],
    evidenceRefs: [],
    keyFilesSummary: [],
    droppedRefKinds: [],
    notIncluded: [],
  };
}

function createBackgroundTask(
  id: string,
  kind: BackgroundTaskState["kind"],
  status: BackgroundTaskState["status"],
): BackgroundTaskState {
  return {
    id,
    kind,
    title: id,
    status,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    heartbeatIntervalMs: 30_000,
    staleAfterMs: 120_000,
    hasOutput: false,
    userVisibleSummary: id,
  };
}

function createAgentRun(context: TuiContext, overrides: Partial<AgentRun> = {}): AgentRun {
  const id = overrides.id ?? "agent-test";
  const agent: AgentRun = {
    id,
    type: "planner",
    role: "planner",
    provider: "deepseek",
    parentSessionId: context.sessionId,
    task: "inspect",
    model: "deepseek-chat",
    allowedTools: ["Read", "Todo"],
    maxTurns: 1,
    permissionMode: "default",
    status: "running",
    activityStatus: "processing",
    transcriptPath: join(context.projectPath, ".sessions", `${id}.jsonl`),
    transcriptSessionId: context.sessionId ?? "session",
    mailbox: [],
    summary: "agent summary",
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
    ...overrides,
  };
  const cacheSafePrefixSnapshot =
    overrides.cacheSafePrefixSnapshot ?? context.cache.lastCacheSafePrefix;
  if (cacheSafePrefixSnapshot) {
    Object.defineProperty(agent, "cacheSafePrefixSnapshot", {
      value: cacheSafePrefixSnapshot,
      enumerable: false,
    });
  }
  return agent;
}

function memoryCandidate(id: string): MemoryCandidate {
  return {
    id,
    scope: "project",
    summary: "candidate memory",
    source: "test",
    sourceRefs: [],
    risk: "low",
    inferred: false,
    status: "candidate",
    createdAt: new Date().toISOString(),
  };
}

async function cloneContextForApproval(
  base: TuiContext,
  kind: PendingLocalApproval["kind"],
): Promise<TuiContext> {
  const context = await createTestContext();
  if (kind === "report_write_tool" || kind === "index_ignore_write") {
    context.permissionMode = "full-access";
  }
  context.memory.candidates = [memoryCandidate("mem-1")];
  return { ...context, config: base.config };
}

function rewriteApprovalSession(
  approval: PendingLocalApproval,
  context: TuiContext,
): PendingLocalApproval {
  const sessionId = context.sessionId ?? "session";
  if (approval.kind === "index_ignore_write") {
    return {
      ...approval,
      plan: { ...approval.plan, path: ".cbmignore" },
    };
  }
  if (approval.kind === "image_generation") {
    return {
      ...approval,
      sessionId,
      assetPath: join(context.projectPath, ".linghun", "assets", `${approval.id}.json`),
    };
  }
  if (approval.kind === "git_worktree_remove") {
    return {
      ...approval,
      sessionId,
      path: join(context.projectPath, ".linghun", "worktrees", approval.name),
    };
  }
  if ("sessionId" in approval) {
    return { ...approval, sessionId } as PendingLocalApproval;
  }
  return approval;
}

async function createTestContext(
  agentEvents?: TestStreamEvent[] | TestStreamEvent[][],
  onAgentRequest?: (request: ModelRequest) => void,
  bridgeAgentApprovals = false,
): Promise<TuiContext> {
  const projectPath = await mkdtemp(join(tmpdir(), "linghun-phase-e-main-"));
  await mkdir(resolve(projectPath, ".linghun"), { recursive: true });
  const store = new SessionStore({ projectPath, sessionRootDir: join(projectPath, ".sessions") });
  const session = await store.create({ model: "deepseek-chat" });
  const memory = await createMemoryState(defaultConfig, projectPath);
  const agentGateway = Array.isArray(agentEvents?.[0])
    ? gatewayByTurn(agentEvents as TestStreamEvent[][], onAgentRequest)
    : gateway((agentEvents as TestStreamEvent[] | undefined) ?? [
        { type: "assistant_text_delta", text: "agent final" },
        { type: "message_stop", chunkCount: 1, hadUsage: false, finishReason: "stop" },
      ], onAgentRequest);
  const context = {
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
    backgroundAbortControllers: new Map(),
    providerBreaker: createProviderCircuitBreakerState(),
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
  } as unknown as TuiContext;
  configureJobAgentCommandRuntime({
    addRoleUsage: () => undefined,
    ensureSession: async (ctx) => ctx.sessionId ?? session.id,
    appendBackgroundTaskEvent: async () => undefined,
    appendRouteDecisionEvent: async () => undefined,
    checkBackgroundStartGuard: () => null,
    checkResourceGuard: () => null,
    createRoleHandoff: (from, to, source, summary) => ({
      from,
      to,
      taskId: source,
      summary,
      evidence: [],
      changedFiles: [],
      keyFiles: [],
      notIncluded: [],
    }),
    refreshBackgroundLifecycle: () => undefined,
    writeStatus: () => undefined,
    captureFailureLearning: async () => undefined,
    recordVerificationEvidence: async (ctx, _sessionId, report) => {
      ctx.lastVerification = report;
    },
    recordAgentExecutionEvidence: async () => "evidence-agent-execution",
    recordAgentMailboxEvidence: async () => "evidence-agent-mailbox",
    recordAgentToolEvidence: async () => undefined,
    recordAgentToolFailureEvidence: async () => "evidence-agent-failure",
    recordToolResultBudgetEvidence: async () => undefined,
    createAgentGatewayContinuation: () => ({
      gateway: agentGateway,
      provider: "deepseek",
      model: "deepseek-chat",
      endpointProfile: "chat_completions",
      reasoningSent: false,
    }),
    prepareProviderPreflight: async (_ctx, _sessionId, messages) => ({
      blocked: false,
      messages: messages as ModelMessage[],
    }),
    createAgentToolApproval: ({
      context: approvalContext,
      agent,
      toolCall,
      toolName,
      parentSessionId,
      permission,
    }) => {
      if (!bridgeAgentApprovals || approvalContext.pendingLocalApproval) return false;
      approvalContext.pendingLocalApproval = {
        kind: "agent_tool_use",
        agentId: agent.id,
        agentTranscriptSessionId: agent.transcriptSessionId,
        toolCall,
        toolName,
        sessionId: parentSessionId,
        verdict: permission.verdict,
      };
      return true;
    },
  });
  return context;
}

function verificationReport(status: VerificationReport["status"]): VerificationReport {
  return {
    id: `verify-${status}`,
    status,
    summary: `${status} summary`,
    commands: [],
    unverified: [],
    risk: [],
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    durationMs: 1,
    nextAction: "none",
  };
}

class MemoryOutput extends Writable {
  text = "";

  override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: () => void): void {
    this.text += chunk.toString();
    callback();
  }
}
