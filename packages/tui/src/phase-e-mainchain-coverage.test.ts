import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Writable } from "node:stream";
import { defaultConfig } from "@linghun/config";
import { SessionStore } from "@linghun/core";
import type { ModelGateway, ModelMessage, ModelRequest, ModelToolCall } from "@linghun/providers";
import { builtInTools, createToolContext, type ToolOutput } from "@linghun/tools";
import { describe, expect, it } from "vitest";
import { createFailureLearningState } from "./failure-learning-runtime.js";
import { createIndexState } from "./index-runtime.js";
import { INDEX_STATUS_INSPECT } from "./index-tool-runtime.js";
import { rememberCacheSafePrefix } from "./cache-policy-runtime.js";
import {
  configureJobAgentCommandRuntime,
  cancelAgent,
  executeApprovedAgentToolUse,
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
  executeDeferredDispatchToolUse,
  executeLinghunControlToolUse,
  executeModelToolUse,
} from "./model-tool-runtime.js";
import { routeNaturalIntent } from "./natural-command-bridge.js";
import { executePermissionApprove } from "./permission-approval-runtime.js";
import { classifyToolRequest } from "./permission-policy-engine.js";
import { createProviderCircuitBreakerState } from "./provider-circuit-breaker.js";
import { configureSlashCommandRuntime, handleSlashCommand } from "./slash-command-runtime.js";
import type { PendingLocalApproval, TuiContext } from "./tui-context-runtime.js";
import type {
  AgentRun,
  BackgroundTaskState,
  MemoryCandidate,
  VerificationReport,
} from "./tui-data-types.js";
import { decidePermission } from "./tui-permission-runtime.js";
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

  it("records passed RunVerification claims for final-answer evidence", async () => {
    const context = await createTestContext();
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

      await cancelAgent(agentA, context, new MemoryOutput());
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
      await cancelAgent(agent, context, new MemoryOutput());
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
      for (const event of events) yield event;
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
  return {
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
    createAgentToolApproval: () => false,
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
