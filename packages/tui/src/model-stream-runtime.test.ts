import { describe, expect, it, vi } from "vitest";
import { Writable } from "node:stream";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "@linghun/config";
import { LinghunError, SessionStore } from "@linghun/core";
import type { ModelGateway, ModelMessage, ModelRequest } from "@linghun/providers";
import { builtInTools, createToolContext } from "@linghun/tools";
import { interruptAllActiveWork } from "./background-control-runtime.js";
import {
  createPostCompactCacheWarmup,
  recordCacheRequestObservation,
} from "./cache-policy-runtime.js";
import {
  __testApplyPromptCacheKey,
  __testBuildModelMessagesWithRecentContext,
  __testCurrentVerificationReportForRequest,
  __testPrepareMessagesForProviderPreflightWithActivity,
  __testScheduleApiTokenCountDiagnostics,
  __testSendMessage,
  __testStreamFinalModelAnswerWithoutTools,
  __testFinalGapHasProgress,
  __testEvidenceMatchesFinalGapAction,
  __testCaptureFinalGapProgressState,
  buildAggregatedDowngradedFinalAnswer,
  buildEvidenceBackedFinalBoundaryAnswer,
  beginForegroundRequestTurn,
  canRunToolCallInParallelReadonlyBatch,
  createToolFallbackRecoveryReminder,
  createToolFailureRecoveryFingerprint,
  createPreFallbackHardCutSkippedToolResult,
  createToolExecutionBatches,
  continueModelAfterToolResults,
  evaluateAggregatedFinalAnswerGate,
  handleNaturalInput,
  isPreEngineToolCall,
  isRealFallbackToolProgress,
  isToolBatchFailure,
  modelStreamAutoLearningTestHooks,
  isToolBatchFallbackRequired,
  planFinalGateEvidenceGapAction,
  recordInterruptedForegroundTurn,
  recordSuccessfulToolExecutionProgress,
  shouldRewriteFinalGateClaimAlignment,
  shouldContinueAfterToolFailureWithoutToolCall,
  shouldRetryHighReasoningToolsEmptyResponse,
  updateToolFailureRecoveryState,
} from "./model-stream-runtime.js";
import {
  commitFailureLearningInput,
  createFailureLearningState,
  loadFailureRecords,
  setFailureRecordStatus,
  writeFailureRecord,
} from "./failure-learning-runtime.js";
import { createIndexState } from "./index-runtime.js";
import { createSolutionCompletenessStatus } from "./model-loop-runtime.js";
import { cancelPendingInteraction } from "./permission-approval-runtime.js";
import { createProviderCircuitBreakerState } from "./provider-circuit-breaker.js";
import type { TuiContext } from "./tui-context-runtime.js";
import { createShellBlockOutputForTest } from "./tui-output-surface.js";
import { writeMemoryLearningMode } from "./tui-memory-runtime.js";
import type { EvidenceRecord } from "./tui-data-types.js";
import {
  createCacheState,
  createMcpState,
  createMemoryState,
  createRemoteState,
} from "./tui-state-runtime.js";

function withClaims(text: string, claims: Array<{ kind: string; phrase: string }>): string {
  return `${text}\nLinghunFinalAnswerClaims: ${JSON.stringify({ claims })}`;
}

function makeCompactRestoreContext(overrides: Record<string, unknown> = {}) {
  return {
    goal: "continue",
    currentTask: "current task",
    phaseStatus: "in_progress",
    sessionMemoryRecords: [],
    keyFiles: [],
    changedFiles: [],
    evidenceRefs: [],
    activeAgentsWorkflows: [],
    needsAttentionAgentsWorkflows: [],
    staleResumableAgentsWorkflows: [],
    pendingItems: [],
    decisions: [],
    risks: [],
    indexStatus: "ready",
    cacheFreshness: "fresh",
    memoryStatus: "none",
    verificationRequirement: "verify with evidence",
    ...overrides,
  };
}

function seedPostCompactWarmupObservation(context: TuiContext): unknown {
  const request: ModelRequest = {
    messages: [
      { role: "system", content: "system" },
      { role: "user", content: "hello" },
    ],
    model: "test-model",
    endpointProfile: "anthropic_messages",
    promptCacheEnabled: true,
  };
  const baseline = recordCacheRequestObservation(context.cache, "main", "anthropic", request);
  context.cache.postCompactCacheWarmup = createPostCompactCacheWarmup({
    projection: {
      boundaryId: "compact-boundary",
      createdAt: "2026-07-12T00:00:00.000Z",
      summary: "summary",
      restoreContext: makeCompactRestoreContext(),
      replacementKind: "provider-visible",
      replacementMessageCount: 1,
      pressureRatio: 0.9,
      preCompactChars: 100,
      postCompactChars: 10,
      discardedRange: "events 1-2",
      toolPairingSafe: true,
      risks: [],
      evidenceRefs: [],
    },
    baseline,
    totalTurns: 2,
  });
  return {
    ...context.cache.postCompactCacheWarmup,
    lastChangedKeys: [...context.cache.postCompactCacheWarmup.lastChangedKeys],
  };
}

function makeCompactProjection(summary: string, overrides: Record<string, unknown> = {}) {
  return {
    boundaryId: "compact-boundary-test",
    createdAt: "2026-07-12T00:00:00.000Z",
    summary,
    pressureRatio: 0.9,
    preCompactChars: 10_000,
    postCompactChars: 2_000,
    discardedRange: "events 1-20",
    toolPairingSafe: true,
    risks: [],
    evidenceRefs: [],
    ...overrides,
  };
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

describe("continuation abort ownership", () => {
  it("does not let a superseded compact preflight overwrite the new request activity", async () => {
    const { context } = await makeSendMessageContext();
    const oldController = new AbortController();
    context.currentRequestTurnId = "compact-old";
    context.activeAbortController = oldController;
    context.requestActivityOwner = { kind: "foreground", requestTurnId: "compact-old" };
    context.requestActivityPhase = "request_started";
    let releaseDeepCompact!: () => void;
    let markDeepCompactStarted!: () => void;
    const deepCompactStarted = new Promise<void>((resolve) => {
      markDeepCompactStarted = resolve;
    });
    const deepCompactGate = new Promise<void>((resolve) => {
      releaseDeepCompact = resolve;
    });
    context.modelGateway = {
      async *stream() {
        markDeepCompactStarted();
        await deepCompactGate;
        yield { type: "assistant_text_delta", id: "compact", text: "owned summary" } as const;
        yield { type: "message_stop", id: "compact", chunkCount: 1, hadUsage: false } as const;
      },
    } as unknown as ModelGateway;

    const running = __testPrepareMessagesForProviderPreflightWithActivity(
      new MemoryOutput(),
      context,
      {
        messages: [
          { role: "system", content: "system" },
          ...Array.from({ length: 18 }, (_, index) => ({
            role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
            content: `old context ${index} ${"x".repeat(60_000)}`,
          })),
          { role: "user", content: "latest request" },
        ],
        context,
        sessionId: context.sessionId!,
        runtime: { role: "executor", provider: "test", model: "deepseek-chat" },
        trigger: "request",
        deps: {
          appendSystemEvent: async () => undefined,
          captureFailureLearning: async () => undefined,
          recordToolResultBudgetEvidence: async () => undefined,
          refreshCacheFreshness: () => undefined,
          runDeepCompact: {
            appendSystemEvent: async () => undefined,
            captureFailureLearning: async () => undefined,
            refreshCacheFreshness: () => undefined,
            recordCompactBoundary: () => undefined,
          },
        },
      },
    );

    await deepCompactStarted;
    const oldDeepCompactRun = context.deepCompactInFlight?.promise;
    expect(context.requestActivityOwner).toEqual({
      kind: "foreground",
      requestTurnId: "compact-old",
    });
    expect(context.requestActivityPhase).toBe("compacting_context");

    oldController.abort();
    context.currentRequestTurnId = "compact-new";
    context.activeAbortController = new AbortController();
    context.requestActivityOwner = { kind: "foreground", requestTurnId: "compact-new" };
    context.requestActivityPhase = "request_started";
    await running;

    expect(context.requestActivityOwner).toEqual({
      kind: "foreground",
      requestTurnId: "compact-new",
    });
    expect(context.requestActivityPhase).toBe("request_started");
    releaseDeepCompact();
    await oldDeepCompactRun;
    expect(context.cache.compactBoundaries).toHaveLength(0);
    expect(context.cache.compactProjection).toBeUndefined();
    expect(context.cache.postCompactCacheWarmup).toBeUndefined();
    expect(context.evidence).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ supportsClaims: expect.arrayContaining(["context_compact_boundary"]) }),
      ]),
    );
  });

  it("does not half-commit compact state when terminal projection loses ownership", async () => {
    const { context } = await makeSendMessageContext();
    const oldController = new AbortController();
    context.currentRequestTurnId = "terminal-old";
    context.activeAbortController = oldController;
    context.requestActivityOwner = { kind: "foreground", requestTurnId: "terminal-old" };
    context.requestActivityPhase = "request_started";
    const transcriptBlocks: unknown[] = [];
    context.pushTranscriptBlock = (block) => {
      transcriptBlocks.push(block);
    };
    let refreshCount = 0;
    let releaseProjection!: () => void;
    let markProjectionStarted!: () => void;
    const projectionStarted = new Promise<void>((resolve) => {
      markProjectionStarted = resolve;
    });
    const projectionRelease = new Promise<void>((resolve) => {
      releaseProjection = resolve;
    });
    context.compactOutputMemory = async () => {
      markProjectionStarted();
      await projectionRelease;
      return { beforeCount: 12, afterCount: 5 };
    };
    const messages: ModelMessage[] = [
      { role: "system", content: "system" },
      ...Array.from({ length: 18 }, (_, index) => ({
        role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
        content: `old terminal projection context ${index} ${"x".repeat(60_000)}`,
      })),
      { role: "user", content: "latest request" },
    ];

    const running = __testPrepareMessagesForProviderPreflightWithActivity(
      new MemoryOutput(),
      context,
      {
        messages,
        context,
        sessionId: context.sessionId!,
        runtime: { role: "executor", provider: "test", model: "deepseek-chat" },
        trigger: "request",
        deps: {
          appendSystemEvent: async (_context, _sessionId, message, level, commitGuard) => {
            if (message.startsWith("compact_projection:")) {
              await _context.store.appendEvent(_sessionId, {
                type: "system_event",
                id: "compact-projection-before-evidence-test",
                level,
                message,
                createdAt: new Date().toISOString(),
              }, commitGuard);
            }
          },
          captureFailureLearning: async () => undefined,
          recordToolResultBudgetEvidence: async () => undefined,
          refreshCacheFreshness: () => {
            refreshCount += 1;
          },
        },
      },
    );

    await Promise.race([
      projectionStarted,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("terminal projection did not start")), 1_000),
      ),
    ]);
    expect(context.requestActivityPhase).toBe("compacting_context");

    oldController.abort();
    context.currentRequestTurnId = "terminal-new";
    context.activeAbortController = new AbortController();
    context.requestActivityOwner = { kind: "foreground", requestTurnId: "terminal-new" };
    context.requestActivityPhase = "request_started";
    releaseProjection();

    const result = await running;

    expect(result).toEqual({ blocked: false, messages });
    expect(context.requestActivityOwner).toEqual({
      kind: "foreground",
      requestTurnId: "terminal-new",
    });
    expect(context.requestActivityPhase).toBe("request_started");
    expect(context.cache.compactBoundaries).toHaveLength(0);
    expect(context.cache.compactProjection).toBeUndefined();
    expect(context.cache.postCompactCacheWarmup).toBeUndefined();
    expect(context.cache.compactStrategy).toBeUndefined();
    expect(context.cache.contextUsage).toBeUndefined();
    expect(context.evidence).toEqual([]);
    expect(transcriptBlocks).toEqual([]);
    expect(refreshCount).toBe(0);
  });

  it("does not half-commit compact state when projection append loses owner before durable transcript write", async () => {
    const { context, events } = await makeSendMessageContext();
    const oldController = new AbortController();
    context.currentRequestTurnId = "projection-before-write-old";
    context.activeAbortController = oldController;
    context.requestActivityOwner = {
      kind: "foreground",
      requestTurnId: "projection-before-write-old",
    };
    context.requestActivityPhase = "request_started";
    const transcriptBlocks: unknown[] = [];
    context.pushTranscriptBlock = (block) => {
      transcriptBlocks.push(block);
    };
    let refreshCount = 0;
    let enterProjectionAppend: (() => void) | undefined;
    let releaseProjectionAppend: (() => void) | undefined;
    const projectionAppendEntered = new Promise<void>((resolve) => {
      enterProjectionAppend = resolve;
    });
    const projectionAppendGate = new Promise<void>((resolve) => {
      releaseProjectionAppend = resolve;
    });
    context.compactOutputMemory = async () => ({ beforeCount: 12, afterCount: 5 });
    const messages: ModelMessage[] = [
      { role: "system", content: "system" },
      ...Array.from({ length: 18 }, (_, index) => ({
        role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
        content: `old projection before write context ${index} ${"x".repeat(60_000)}`,
      })),
      { role: "user", content: "latest request" },
    ];

    const running = __testPrepareMessagesForProviderPreflightWithActivity(
      new MemoryOutput(),
      context,
      {
        messages,
        context,
        sessionId: context.sessionId!,
        runtime: { role: "executor", provider: "test", model: "deepseek-chat" },
        trigger: "request",
        deps: {
          appendSystemEvent: async (_context, _sessionId, message, level, commitGuard) => {
            if (message.startsWith("compact_projection:")) {
              enterProjectionAppend?.();
              await projectionAppendGate;
              await _context.store.appendEvent(_sessionId, {
                type: "system_event",
                id: "compact-projection-before-write-owner-test",
                level,
                message,
                createdAt: new Date().toISOString(),
              }, commitGuard);
            }
          },
          captureFailureLearning: async () => undefined,
          recordToolResultBudgetEvidence: async () => undefined,
          refreshCacheFreshness: () => {
            refreshCount += 1;
          },
        },
      },
    );

    await Promise.race([
      projectionAppendEntered,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("compact projection append did not start")), 1_000),
      ),
    ]);
    oldController.abort();
    context.currentRequestTurnId = "projection-before-write-new";
    context.activeAbortController = new AbortController();
    context.requestActivityOwner = {
      kind: "foreground",
      requestTurnId: "projection-before-write-new",
    };
    context.requestActivityPhase = "request_started";
    releaseProjectionAppend?.();

    const result = await running;

    expect(result).toEqual({ blocked: false, messages });
    expect(context.cache.compactBoundaries).toHaveLength(0);
    expect(context.cache.compactProjection).toBeUndefined();
    expect(context.cache.postCompactCacheWarmup).toBeUndefined();
    expect(context.cache.compactStrategy).toBeUndefined();
    expect(context.cache.contextUsage).toBeUndefined();
    expect(context.evidence).toEqual([]);
    expect(transcriptBlocks).toEqual([]);
    expect(refreshCount).toBe(0);
    expect(
      events.some(
        (event) =>
          (event as { type?: string; message?: string }).type === "system_event" &&
          (event as { message?: string }).message?.startsWith("compact_projection:"),
      ),
    ).toBe(false);
    expect(events.some((event) => (event as { type?: string }).type === "evidence_record")).toBe(
      false,
    );
  });

  it("commits compact state when durable projection append becomes the commit point", async () => {
    const { context, events } = await makeSendMessageContext();
    const oldController = new AbortController();
    context.currentRequestTurnId = "projection-durable-old";
    context.activeAbortController = oldController;
    context.requestActivityOwner = { kind: "foreground", requestTurnId: "projection-durable-old" };
    context.requestActivityPhase = "request_started";
    const transcriptBlocks: unknown[] = [];
    context.pushTranscriptBlock = (block) => {
      transcriptBlocks.push(block);
    };
    let refreshCount = 0;
    let enterProjectionAppend: (() => void) | undefined;
    let releaseProjectionAppend: (() => void) | undefined;
    const projectionAppendEntered = new Promise<void>((resolve) => {
      enterProjectionAppend = resolve;
    });
    const projectionAppendGate = new Promise<void>((resolve) => {
      releaseProjectionAppend = resolve;
    });
    let projectionDurablyAppended = false;
    context.compactOutputMemory = async () => ({ beforeCount: 12, afterCount: 5 });
    const messages: ModelMessage[] = [
      { role: "system", content: "system" },
      ...Array.from({ length: 18 }, (_, index) => ({
        role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
        content: `old durable projection context ${index} ${"x".repeat(60_000)}`,
      })),
      { role: "user", content: "latest request" },
    ];

    const running = __testPrepareMessagesForProviderPreflightWithActivity(
      new MemoryOutput(),
      context,
      {
        messages,
        context,
        sessionId: context.sessionId!,
        runtime: { role: "executor", provider: "test", model: "deepseek-chat" },
        trigger: "request",
        deps: {
          appendSystemEvent: async (_context, _sessionId, message, level, commitGuard) => {
            if (message.startsWith("compact_projection:")) {
              await _context.store.appendEvent(_sessionId, {
                type: "system_event",
                id: "compact-projection-durable-owner-test",
                level,
                message,
                createdAt: new Date().toISOString(),
              }, commitGuard);
              projectionDurablyAppended = true;
              enterProjectionAppend?.();
              await projectionAppendGate;
            }
          },
          captureFailureLearning: async () => undefined,
          recordToolResultBudgetEvidence: async () => undefined,
          refreshCacheFreshness: () => {
            refreshCount += 1;
          },
        },
      },
    );

    await Promise.race([
      projectionAppendEntered,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("compact projection append did not start")), 1_000),
      ),
    ]);
    oldController.abort();
    context.currentRequestTurnId = "projection-durable-new";
    context.activeAbortController = new AbortController();
    context.requestActivityOwner = { kind: "foreground", requestTurnId: "projection-durable-new" };
    context.requestActivityPhase = "request_started";
    releaseProjectionAppend?.();

    const result = await running;

    expect(result).toEqual({ blocked: false, messages });
    expect(projectionDurablyAppended).toBe(true);
    expect(context.cache.compactBoundaries).toHaveLength(1);
    expect(context.cache.compactProjection).toBeDefined();
    expect(context.cache.postCompactCacheWarmup).toBeDefined();
    expect(context.cache.compactStrategy).toBeDefined();
    expect(context.cache.contextUsage).toBeDefined();
    expect(context.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ supportsClaims: expect.arrayContaining(["context_compact_boundary"]) }),
      ]),
    );
    expect(transcriptBlocks).toHaveLength(1);
    expect(refreshCount).toBe(1);
    expect(
      events.some(
        (event) =>
          (event as { type?: string; message?: string }).type === "system_event" &&
          (event as { message?: string }).message?.startsWith("compact_projection:"),
      ),
    ).toBe(true);
  });

  it("does not half-commit compact state when retrigger warning append loses ownership", async () => {
    const { context } = await makeSendMessageContext();
    const oldController = new AbortController();
    context.config = {
      ...context.config,
      modelRoutes: {
        ...context.config.modelRoutes,
        routes: context.config.modelRoutes.routes.map((route) =>
          route.role === "executor" ? { ...route, maxInputTokens: 210_000 } : route,
        ),
      },
    };
    context.currentRequestTurnId = "compact-retrigger-old";
    context.activeAbortController = oldController;
    context.requestActivityOwner = { kind: "foreground", requestTurnId: "compact-retrigger-old" };
    context.requestActivityPhase = "request_started";
    const transcriptBlocks: unknown[] = [];
    context.pushTranscriptBlock = (block) => {
      transcriptBlocks.push(block);
    };
    let refreshCount = 0;
    let enterRetriggerAppend: (() => void) | undefined;
    let releaseRetriggerAppend: (() => void) | undefined;
    const retriggerAppendEntered = new Promise<void>((resolve) => {
      enterRetriggerAppend = resolve;
    });
    const retriggerAppendGate = new Promise<void>((resolve) => {
      releaseRetriggerAppend = resolve;
    });
    context.compactOutputMemory = async () => ({ beforeCount: 12, afterCount: 5 });
    const messages: ModelMessage[] = [
      { role: "system", content: "system" },
      ...Array.from({ length: 18 }, (_, index) => ({
        role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
        content: `old retrigger append context ${index} ${"x".repeat(10_000)}`,
      })),
      { role: "user", content: `latest request ${"x".repeat(790_000)}` },
    ];

    const running = __testPrepareMessagesForProviderPreflightWithActivity(
      new MemoryOutput(),
      context,
      {
        messages,
        context,
        sessionId: context.sessionId!,
        runtime: { role: "executor", provider: "test", model: "deepseek-chat" },
        trigger: "request",
        deps: {
          appendSystemEvent: async (_context, _sessionId, message) => {
            if (message.startsWith("context_compact_retrigger_risk:")) {
              enterRetriggerAppend?.();
              await retriggerAppendGate;
            }
          },
          captureFailureLearning: async () => undefined,
          recordToolResultBudgetEvidence: async () => undefined,
          refreshCacheFreshness: () => {
            refreshCount += 1;
          },
        },
      },
    );

    await Promise.race([
      retriggerAppendEntered,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("compact retrigger append did not start")), 1_000),
      ),
    ]);
    oldController.abort();
    context.currentRequestTurnId = "compact-retrigger-new";
    context.activeAbortController = new AbortController();
    context.requestActivityOwner = {
      kind: "foreground",
      requestTurnId: "compact-retrigger-new",
    };
    context.requestActivityPhase = "request_started";
    releaseRetriggerAppend?.();

    const result = await running;

    expect(result).toEqual({ blocked: false, messages });
    expect(context.cache.compactBoundaries).toHaveLength(0);
    expect(context.cache.compactProjection).toBeUndefined();
    expect(context.cache.postCompactCacheWarmup).toBeUndefined();
    expect(context.cache.compactStrategy).toBeUndefined();
    expect(context.cache.contextUsage).toBeUndefined();
    expect(context.evidence).toEqual([]);
    expect(transcriptBlocks).toEqual([]);
    expect(refreshCount).toBe(0);
  });

  it("keeps compact state committed when evidence append loses ownership after projection commit", async () => {
    const { context, events } = await makeSendMessageContext();
    const oldController = new AbortController();
    context.currentRequestTurnId = "compact-evidence-old";
    context.activeAbortController = oldController;
    context.requestActivityOwner = { kind: "foreground", requestTurnId: "compact-evidence-old" };
    context.requestActivityPhase = "request_started";
    const transcriptBlocks: unknown[] = [];
    context.pushTranscriptBlock = (block) => {
      transcriptBlocks.push(block);
    };
    let refreshCount = 0;
    let enterEvidenceAppend: (() => void) | undefined;
    let releaseEvidenceAppend: (() => void) | undefined;
    const evidenceAppendEntered = new Promise<void>((resolve) => {
      enterEvidenceAppend = resolve;
    });
    const evidenceAppendGate = new Promise<void>((resolve) => {
      releaseEvidenceAppend = resolve;
    });
    const appendEvent = context.store.appendEvent.bind(context.store);
    context.store.appendEvent = async (sessionId, event, commitGuard) => {
      if ((event as { type?: string }).type === "evidence_record") {
        enterEvidenceAppend?.();
        await evidenceAppendGate;
      }
      return appendEvent(sessionId, event, commitGuard);
    };
    context.compactOutputMemory = async () => ({ beforeCount: 12, afterCount: 5 });
    const messages: ModelMessage[] = [
      { role: "system", content: "system" },
      ...Array.from({ length: 18 }, (_, index) => ({
        role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
        content: `old evidence append context ${index} ${"x".repeat(60_000)}`,
      })),
      { role: "user", content: "latest request" },
    ];

    const running = __testPrepareMessagesForProviderPreflightWithActivity(
      new MemoryOutput(),
      context,
      {
        messages,
        context,
        sessionId: context.sessionId!,
        runtime: { role: "executor", provider: "test", model: "deepseek-chat" },
        trigger: "request",
        deps: {
          appendSystemEvent: async () => undefined,
          captureFailureLearning: async () => undefined,
          recordToolResultBudgetEvidence: async () => undefined,
          refreshCacheFreshness: () => {
            refreshCount += 1;
          },
        },
      },
    );

    await Promise.race([
      evidenceAppendEntered,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("compact evidence append did not start")), 1_000),
      ),
    ]);
    oldController.abort();
    context.currentRequestTurnId = "compact-evidence-new";
    context.activeAbortController = new AbortController();
    context.requestActivityOwner = {
      kind: "foreground",
      requestTurnId: "compact-evidence-new",
    };
    context.requestActivityPhase = "request_started";
    releaseEvidenceAppend?.();

    const result = await running;

    expect(result).toEqual({ blocked: false, messages });
    expect(context.cache.compactBoundaries).toHaveLength(1);
    expect(context.cache.compactProjection).toBeDefined();
    expect(context.cache.postCompactCacheWarmup).toBeDefined();
    expect(context.cache.compactStrategy).toBeDefined();
    expect(context.cache.contextUsage).toBeDefined();
    expect(context.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ supportsClaims: expect.arrayContaining(["context_compact_boundary"]) }),
      ]),
    );
    expect(transcriptBlocks).toHaveLength(1);
    expect(refreshCount).toBe(1);
    expect(events.some((event) => (event as { type?: string }).type === "evidence_record")).toBe(
      true,
    );
  });

  it("does not commit compact failure cooldown when warning append loses ownership", async () => {
    const { context } = await makeSendMessageContext();
    const oldController = new AbortController();
    context.config = {
      ...context.config,
      modelRoutes: {
        ...context.config.modelRoutes,
        routes: context.config.modelRoutes.routes.map((route) =>
          route.role === "executor" ? { ...route, maxInputTokens: 10 } : route,
        ),
      },
    };
    context.currentRequestTurnId = "compact-failure-old";
    context.activeAbortController = oldController;
    context.requestActivityOwner = { kind: "foreground", requestTurnId: "compact-failure-old" };
    context.requestActivityPhase = "request_started";
    let enterFailureAppend: (() => void) | undefined;
    let releaseFailureAppend: (() => void) | undefined;
    const failureAppendEntered = new Promise<void>((resolve) => {
      enterFailureAppend = resolve;
    });
    const failureAppendGate = new Promise<void>((resolve) => {
      releaseFailureAppend = resolve;
    });
    let failureLearningCount = 0;
    const messages: ModelMessage[] = [
      { role: "system", content: "system" },
      {
        role: "assistant",
        content: `pending tool ${"x".repeat(1_000)}`,
        toolCalls: [{ id: "pending-tool", name: "Read", input: { path: "src/a.ts" } }],
      },
    ];

    const running = __testPrepareMessagesForProviderPreflightWithActivity(
      new MemoryOutput(),
      context,
      {
        messages,
        context,
        sessionId: context.sessionId!,
        runtime: { role: "executor", provider: "test", model: "deepseek-chat" },
        trigger: "request",
        deps: {
          appendSystemEvent: async (_context, _sessionId, message) => {
            if (message.startsWith("context compact failed:")) {
              enterFailureAppend?.();
              await failureAppendGate;
            }
          },
          captureFailureLearning: async () => {
            failureLearningCount += 1;
          },
          recordToolResultBudgetEvidence: async () => undefined,
          refreshCacheFreshness: () => undefined,
        },
      },
    );

    await Promise.race([
      failureAppendEntered,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("compact failure append did not start")), 1_000),
      ),
    ]);
    oldController.abort();
    context.currentRequestTurnId = "compact-failure-new";
    context.activeAbortController = new AbortController();
    context.requestActivityOwner = {
      kind: "foreground",
      requestTurnId: "compact-failure-new",
    };
    context.requestActivityPhase = "request_started";
    releaseFailureAppend?.();

    const result = await running;

    expect(result).toEqual({ blocked: false, messages });
    expect(context.cache.compactFailure).toBeUndefined();
    expect(context.cache.compactCooldownUntil).toBeUndefined();
    expect(failureLearningCount).toBe(0);
  });

  it("does not revive a continuation whose inherited signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort("stale owner");
    let providerStarted = false;
    const gateway = {
      async *stream() {
        providerStarted = true;
        yield { type: "message_stop", chunkCount: 0, hadUsage: false };
      },
    } as unknown as ModelGateway;

    await continueModelAfterToolResults(
      {
        messages: [],
        provider: "openai-compatible",
        model: "gpt-test",
        endpointProfile: "responses",
        reasoningSent: false,
        abortSignal: controller.signal,
      },
      {} as TuiContext,
      gateway,
      new MemoryOutput(),
    );

    expect(providerStarted).toBe(false);
  });

  it("does not revive a continuation owned by a replaced request", async () => {
    let providerStarted = false;
    const gateway = {
      async *stream() {
        providerStarted = true;
        yield { type: "message_stop", chunkCount: 0, hadUsage: false };
      },
    } as unknown as ModelGateway;

    await continueModelAfterToolResults(
      {
        messages: [],
        provider: "openai-compatible",
        model: "gpt-test",
        endpointProfile: "responses",
        reasoningSent: false,
        requestTurnId: "request-old",
      },
      { currentRequestTurnId: "request-new" } as TuiContext,
      gateway,
      new MemoryOutput(),
    );

    expect(providerStarted).toBe(false);
  });

  it("does not overwrite a replacement owner while ensureSession is pending", async () => {
    const { context } = await makeSendMessageContext();
    const store = context.store as SessionStore;
    const originalResume = store.resume.bind(store);
    context.sessionStoreVerifiedId = undefined;
    const oldRequestTurnId = beginForegroundRequestTurn(context, "old-owner");
    let enterResume: (() => void) | undefined;
    let releaseResume: (() => void) | undefined;
    const resumeEntered = new Promise<void>((resolve) => {
      enterResume = resolve;
    });
    const resumeGate = new Promise<void>((resolve) => {
      releaseResume = resolve;
    });
    store.resume = async (sessionId) => {
      enterResume?.();
      await resumeGate;
      return originalResume(sessionId);
    };
    const replacementController = new AbortController();
    const stream = vi.fn(async function* () {
      yield { type: "message_stop", chunkCount: 0, hadUsage: false } as const;
    });

    try {
      const running = continueModelAfterToolResults(
        {
          messages: [],
          provider: "openai-compatible",
          model: "gpt-test",
          endpointProfile: "responses",
          reasoningSent: false,
          requestTurnId: oldRequestTurnId,
        },
        context,
        { stream } as unknown as ModelGateway,
        new MemoryOutput(),
      );
      await resumeEntered;
      context.currentRequestTurnId = "replacement-owner";
      context.activeAbortController = replacementController;
      context.tools.abortSignal = replacementController.signal;
      context.interrupt = { type: "running", taskId: "replacement", canCancel: true };
      releaseResume?.();
      await running;

      expect(stream).not.toHaveBeenCalled();
      expect(context.currentRequestTurnId).toBe("replacement-owner");
      expect(context.activeAbortController).toBe(replacementController);
      expect(context.tools.abortSignal).toBe(replacementController.signal);
      expect(context.interrupt).toEqual({ type: "running", taskId: "replacement", canCancel: true });
    } finally {
      releaseResume?.();
      store.resume = originalResume;
    }
  });

  it("does not overwrite a same-turn replacement controller while ensureSession is pending", async () => {
    const { context } = await makeSendMessageContext();
    const store = context.store as SessionStore;
    const originalResume = store.resume.bind(store);
    context.sessionStoreVerifiedId = undefined;
    const requestTurnId = beginForegroundRequestTurn(context, "same-turn-entry-owner");
    const entryController = new AbortController();
    context.activeAbortController = entryController;
    context.tools.abortSignal = entryController.signal;
    let enterResume: (() => void) | undefined;
    let releaseResume: (() => void) | undefined;
    const resumeEntered = new Promise<void>((resolve) => {
      enterResume = resolve;
    });
    const resumeGate = new Promise<void>((resolve) => {
      releaseResume = resolve;
    });
    store.resume = async (sessionId) => {
      enterResume?.();
      await resumeGate;
      return originalResume(sessionId);
    };
    const replacementController = new AbortController();
    const stream = vi.fn(async function* () {
      yield { type: "message_stop", chunkCount: 0, hadUsage: false } as const;
    });

    try {
      const running = continueModelAfterToolResults(
        {
          messages: [],
          provider: "openai-compatible",
          model: "gpt-test",
          endpointProfile: "responses",
          reasoningSent: false,
          requestTurnId,
          abortSignal: entryController.signal,
        },
        context,
        { stream } as unknown as ModelGateway,
        new MemoryOutput(),
      );
      await resumeEntered;
      context.activeAbortController = replacementController;
      context.tools.abortSignal = replacementController.signal;
      context.interrupt = { type: "running", taskId: "same-turn-replacement", canCancel: true };
      releaseResume?.();
      await running;

      expect(stream).not.toHaveBeenCalled();
      expect(context.currentRequestTurnId).toBe(requestTurnId);
      expect(context.activeAbortController).toBe(replacementController);
      expect(context.tools.abortSignal).toBe(replacementController.signal);
      expect(context.interrupt).toEqual({
        type: "running",
        taskId: "same-turn-replacement",
        canCancel: true,
      });
    } finally {
      releaseResume?.();
      store.resume = originalResume;
    }
  });

  it("terminalizes an expired continuation as a wall-clock timeout before provider work", async () => {
    const { context, events } = await makeSendMessageContext();
    const requestTurnId = beginForegroundRequestTurn(context, "deadline-user");
    const stream = vi.fn(async function* () {
      yield { type: "message_stop", chunkCount: 0, hadUsage: false } as const;
    });

    await continueModelAfterToolResults(
      {
        messages: [{ role: "user", content: "continue" }],
        provider: "openai-compatible",
        model: "gpt-test",
        endpointProfile: "responses",
        reasoningSent: false,
        requestTurnId,
        deadlineAtMs: Date.now() - 1,
      },
      context,
      { stream } as unknown as ModelGateway,
      new MemoryOutput(),
    );

    expect(stream).not.toHaveBeenCalled();
    expect(context.lastInterruptedTurn).toMatchObject({ requestTurnId, reason: "model_timeout" });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "interrupt",
        status: "cancelled",
        message: expect.stringContaining("reason=model_timeout"),
      }),
    );
  });

  it("does not clear a newer main-request signal generation with the same turn id", async () => {
    const { context } = await makeSendMessageContext();
    const ownerController = new AbortController();
    const replacementController = new AbortController();
    let enterStream: (() => void) | undefined;
    let releaseStream: (() => void) | undefined;
    const streamEntered = new Promise<void>((resolve) => {
      enterStream = resolve;
    });
    const streamGate = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });
    const stream = vi.fn(async function* () {
      enterStream?.();
      await streamGate;
      yield { type: "message_stop", chunkCount: 0, hadUsage: false } as const;
    });

    const running = __testSendMessage(
      "same-turn main generation",
      context,
      { stream } as unknown as ModelGateway,
      new MemoryOutput(),
      ownerController,
    );
    await streamEntered;
    const requestTurnId = context.currentRequestTurnId;
    expect(requestTurnId).toBeTruthy();
    context.activeAbortController = replacementController;
    context.tools.abortSignal = replacementController.signal;
    context.interrupt = { type: "running", taskId: "replacement-main", canCancel: true };
    ownerController.abort("superseded");
    releaseStream?.();
    await running;

    expect(context.currentRequestTurnId).toBe(requestTurnId);
    expect(context.activeAbortController).toBe(replacementController);
    expect(context.tools.abortSignal).toBe(replacementController.signal);
    expect(context.interrupt).toEqual({
      type: "running",
      taskId: "replacement-main",
      canCancel: true,
    });
    expect(context.lastInterruptedTurn).toBeUndefined();
  });

  it("cleans the released main owner after a cooperative interrupt", async () => {
    const { context } = await makeSendMessageContext();
    let enterStream: (() => void) | undefined;
    const streamEntered = new Promise<void>((resolve) => {
      enterStream = resolve;
    });
    const stream = vi.fn(async function* (
      _providerId: string,
      _request: unknown,
      signal: AbortSignal,
    ) {
      enterStream?.();
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
    });

    const running = __testSendMessage(
      "interrupt the active main request",
      context,
      { stream } as unknown as ModelGateway,
      new MemoryOutput(),
    );
    await streamEntered;
    const requestTurnId = context.currentRequestTurnId!;
    context.preEngineFallbackPreference = {
      projectPath: context.projectPath,
      requestTurnId,
      active: true,
      activatedAt: new Date().toISOString(),
      reason: "fallback_required",
    };

    const result = await interruptAllActiveWork(context);
    await running;

    expect(result.abortSignalsSent).toBe(1);
    expect(context.lastInterruptedTurn).toMatchObject({ requestTurnId, reason: "user_interrupt" });
    expect(context.currentRequestTurnId).toBeUndefined();
    expect(context.currentRequestUserMessageId).toBeUndefined();
    expect(context.activeAbortController).toBeUndefined();
    expect(context.tools.abortSignal).toBeUndefined();
    expect(context.preEngineFallbackPreference).toBeUndefined();
    expect(context.foregroundAbortPendingUntilMs).toBeUndefined();
    expect(context.interrupt).toEqual({ type: "idle" });
  });

  it("does not clear a newer continuation signal generation with the same turn id", async () => {
    const { context } = await makeSendMessageContext();
    const requestTurnId = beginForegroundRequestTurn(context, "continuation-owner");
    const replacementController = new AbortController();
    let enterStream: (() => void) | undefined;
    let releaseStream: (() => void) | undefined;
    const streamEntered = new Promise<void>((resolve) => {
      enterStream = resolve;
    });
    const streamGate = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });
    const stream = vi.fn(async function* () {
      enterStream?.();
      await streamGate;
      yield { type: "message_stop", chunkCount: 0, hadUsage: false } as const;
    });

    const running = continueModelAfterToolResults(
      {
        messages: [{ role: "user", content: "continue" }],
        provider: "openai-compatible",
        model: "gpt-test",
        endpointProfile: "responses",
        reasoningSent: false,
        requestTurnId,
      },
      context,
      { stream } as unknown as ModelGateway,
      new MemoryOutput(),
    );
    await streamEntered;
    const ownerController = context.activeAbortController;
    expect(ownerController).toBeTruthy();
    context.activeAbortController = replacementController;
    context.tools.abortSignal = replacementController.signal;
    context.interrupt = { type: "running", taskId: "replacement-continuation", canCancel: true };
    ownerController?.abort("superseded");
    releaseStream?.();
    await running;

    expect(context.currentRequestTurnId).toBe(requestTurnId);
    expect(context.activeAbortController).toBe(replacementController);
    expect(context.tools.abortSignal).toBe(replacementController.signal);
    expect(context.interrupt).toEqual({
      type: "running",
      taskId: "replacement-continuation",
      canCancel: true,
    });
    expect(context.lastInterruptedTurn).toBeUndefined();
  });

  it("cleans the released continuation owner after a cooperative interrupt", async () => {
    const { context } = await makeSendMessageContext();
    const requestTurnId = beginForegroundRequestTurn(context, "continuation-interrupt-user");
    let enterStream: (() => void) | undefined;
    const streamEntered = new Promise<void>((resolve) => {
      enterStream = resolve;
    });
    const stream = vi.fn(async function* (
      _providerId: string,
      _request: unknown,
      signal: AbortSignal,
    ) {
      enterStream?.();
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
    });

    const running = continueModelAfterToolResults(
      {
        messages: [{ role: "user", content: "continue" }],
        provider: "openai-compatible",
        model: "gpt-test",
        endpointProfile: "responses",
        reasoningSent: false,
        requestTurnId,
      },
      context,
      { stream } as unknown as ModelGateway,
      new MemoryOutput(),
    );
    await streamEntered;
    context.preEngineFallbackPreference = {
      projectPath: context.projectPath,
      requestTurnId,
      active: true,
      activatedAt: new Date().toISOString(),
      reason: "fallback_required",
    };

    const result = await interruptAllActiveWork(context);
    await running;

    expect(result.abortSignalsSent).toBe(1);
    expect(context.lastInterruptedTurn).toMatchObject({ requestTurnId, reason: "user_interrupt" });
    expect(context.currentRequestTurnId).toBeUndefined();
    expect(context.currentRequestUserMessageId).toBeUndefined();
    expect(context.activeAbortController).toBeUndefined();
    expect(context.tools.abortSignal).toBeUndefined();
    expect(context.preEngineFallbackPreference).toBeUndefined();
    expect(context.foregroundAbortPendingUntilMs).toBeUndefined();
    expect(context.interrupt).toEqual({ type: "idle" });
  });

  it("cleans continuation foreground state when stream initialization throws", async () => {
    const { context } = await makeSendMessageContext();
    const requestTurnId = beginForegroundRequestTurn(context, "continuation-init-error");
    const output = Object.assign(new MemoryOutput(), {
      beginAssistantStream: () => {
        throw new Error("stream initialization failed");
      },
    });
    const stream = vi.fn(async function* () {
      yield { type: "message_stop", chunkCount: 0, hadUsage: false } as const;
    });

    await expect(
      continueModelAfterToolResults(
        {
          messages: [{ role: "user", content: "continue" }],
          provider: "openai-compatible",
          model: "gpt-test",
          endpointProfile: "responses",
          reasoningSent: false,
          requestTurnId,
        },
        context,
        { stream } as unknown as ModelGateway,
        output,
      ),
    ).rejects.toThrow("stream initialization failed");

    expect(stream).not.toHaveBeenCalled();
    expect(context.currentRequestTurnId).toBeUndefined();
    expect(context.activeAbortController).toBeUndefined();
    expect(context.tools.abortSignal).toBeUndefined();
    expect(context.requestActivity).toBeUndefined();
    expect(context.interrupt).toEqual({ type: "idle" });
  });

  it("keeps the foreground owner current while background Bash borrows the tool signal", async () => {
    const { context } = await makeSendMessageContext();
    context.permissionMode = "full-access";
    const originalCall = builtInTools.Bash.call;
    let releaseTool: (() => void) | undefined;
    const toolGate = new Promise<void>((resolve) => {
      releaseTool = resolve;
    });
    let enterTool: (() => void) | undefined;
    const toolEntered = new Promise<void>((resolve) => {
      enterTool = resolve;
    });
    builtInTools.Bash.call = (async () => {
      expect(context.activeAbortController).toBeTruthy();
      expect(context.tools.abortSignal).not.toBe(context.activeAbortController?.signal);
      enterTool?.();
      await toolGate;
      return { text: "background command started", data: { exitCode: 0 } };
    }) as typeof originalCall;
    let streamRound = 0;
    const stream = vi.fn(async function* () {
      streamRound += 1;
      if (streamRound === 1) {
        yield {
          type: "tool_use",
          id: "call-background-bash",
          name: "Bash",
          input: { command: "echo background", runInBackground: true },
        } as const;
        await toolEntered;
        try {
          yield { type: "message_stop", chunkCount: 1, hadUsage: false } as const;
        } finally {
          releaseTool?.();
        }
        return;
      }
      yield {
        type: "assistant_text_delta",
        id: "background-final",
        text: "后台工具结果已处理。",
      } as const;
      yield { type: "message_stop", chunkCount: 1, hadUsage: false } as const;
    });
    const output = new MemoryOutput();

    try {
      await __testSendMessage(
        "运行后台 Bash 并继续处理结果",
        context,
        { stream } as unknown as ModelGateway,
        output,
      );

      expect(stream).toHaveBeenCalledTimes(2);
      expect(output.text).toContain("后台工具结果已处理。");
      expect(context.currentRequestTurnId).toBeUndefined();
      expect(context.activeAbortController).toBeUndefined();
      expect(context.tools.abortSignal).toBeUndefined();
    } finally {
      releaseTool?.();
      builtInTools.Bash.call = originalCall;
    }
  });

  it("keeps the continuation owner current while background Bash borrows the tool signal", async () => {
    const { context } = await makeSendMessageContext();
    context.permissionMode = "full-access";
    const requestTurnId = beginForegroundRequestTurn(context, "continuation-background-bash");
    const originalCall = builtInTools.Bash.call;
    let releaseTool: (() => void) | undefined;
    const toolGate = new Promise<void>((resolve) => {
      releaseTool = resolve;
    });
    let enterTool: (() => void) | undefined;
    const toolEntered = new Promise<void>((resolve) => {
      enterTool = resolve;
    });
    builtInTools.Bash.call = (async () => {
      expect(context.activeAbortController).toBeTruthy();
      expect(context.tools.abortSignal).not.toBe(context.activeAbortController?.signal);
      enterTool?.();
      await toolGate;
      return { text: "background command started", data: { exitCode: 0 } };
    }) as typeof originalCall;
    let streamRound = 0;
    const stream = vi.fn(async function* () {
      streamRound += 1;
      if (streamRound === 1) {
        yield {
          type: "tool_use",
          id: "call-continuation-background-bash",
          name: "Bash",
          input: { command: "echo background", runInBackground: true },
        } as const;
        await toolEntered;
        try {
          yield { type: "message_stop", chunkCount: 1, hadUsage: false } as const;
        } finally {
          releaseTool?.();
        }
        return;
      }
      yield {
        type: "assistant_text_delta",
        id: "continuation-background-final",
        text: "continuation handled the background result",
      } as const;
      yield { type: "message_stop", chunkCount: 1, hadUsage: false } as const;
    });
    const output = new MemoryOutput();

    try {
      await continueModelAfterToolResults(
        {
          messages: [{ role: "user", content: "continue with background Bash" }],
          provider: "openai-compatible",
          model: "gpt-test",
          endpointProfile: "responses",
          reasoningSent: false,
          requestTurnId,
        },
        context,
        { stream } as unknown as ModelGateway,
        output,
      );

      expect(stream).toHaveBeenCalledTimes(2);
      expect(output.text).toContain("continuation handled the background result");
      expect(context.currentRequestTurnId).toBeUndefined();
      expect(context.activeAbortController).toBeUndefined();
      expect(context.tools.abortSignal).toBeUndefined();
    } finally {
      releaseTool?.();
      builtInTools.Bash.call = originalCall;
    }
  });

  it("cleans the foreground owner when interrupt crosses a background Bash signal borrow", async () => {
    const { context } = await makeSendMessageContext();
    context.permissionMode = "full-access";
    const originalCall = builtInTools.Bash.call;
    let enterTool: (() => void) | undefined;
    let releaseTool: (() => void) | undefined;
    let finishTool: (() => void) | undefined;
    const toolEntered = new Promise<void>((resolve) => {
      enterTool = resolve;
    });
    const toolGate = new Promise<void>((resolve) => {
      releaseTool = resolve;
    });
    const toolFinished = new Promise<void>((resolve) => {
      finishTool = resolve;
    });
    let observeProviderAbort: (() => void) | undefined;
    let releaseProvider: (() => void) | undefined;
    const providerAbortObserved = new Promise<void>((resolve) => {
      observeProviderAbort = resolve;
    });
    const providerGate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    builtInTools.Bash.call = (async () => {
      expect(context.activeAbortController).toBeTruthy();
      expect(context.tools.abortSignal).not.toBe(context.activeAbortController?.signal);
      enterTool?.();
      await toolGate;
      finishTool?.();
      return { text: "late background result", data: { exitCode: 0 } };
    }) as typeof originalCall;
    const stream = vi.fn(async function* (
      _providerId: string,
      _request: unknown,
      signal: AbortSignal,
    ) {
      yield {
        type: "tool_use",
        id: "call-interrupted-background-bash",
        name: "Bash",
        input: { command: "echo background", runInBackground: true },
      } as const;
      await toolEntered;
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
      observeProviderAbort?.();
      await providerGate;
    });

    try {
      const running = __testSendMessage(
        "interrupt background Bash while it borrows the signal",
        context,
        { stream } as unknown as ModelGateway,
        new MemoryOutput(),
      );
      await toolEntered;
      const requestTurnId = context.currentRequestTurnId!;
      context.preEngineFallbackPreference = {
        projectPath: context.projectPath,
        requestTurnId,
        active: true,
        activatedAt: new Date().toISOString(),
        reason: "fallback_required",
      };

      const interrupted = interruptAllActiveWork(context);
      await providerAbortObserved;
      const result = await interrupted;
      expect(context.activeAbortController).toBeUndefined();
      expect(context.foregroundAbortPendingUntilMs).toBeGreaterThan(Date.now());
      releaseProvider?.();
      await running;

      expect(context.currentRequestTurnId).toBeUndefined();
      expect(context.activeAbortController).toBeUndefined();
      expect(context.tools.abortSignal).toBeUndefined();
      expect(context.currentRequestUserMessageId).toBeUndefined();
      expect(context.preEngineFallbackPreference).toBeUndefined();
      expect(context.foregroundAbortPendingUntilMs).toBeUndefined();
      expect(context.interrupt).toEqual({ type: "idle" });
      releaseTool?.();
      await toolFinished;

      expect(result.abortSignalsSent).toBeGreaterThanOrEqual(1);
      expect(context.lastInterruptedTurn).toMatchObject({ requestTurnId, reason: "user_interrupt" });
      expect(context.currentRequestUserMessageId).toBeUndefined();
      expect(context.tools.abortSignal).toBeUndefined();
      expect(context.preEngineFallbackPreference).toBeUndefined();
      expect(context.foregroundAbortPendingUntilMs).toBeUndefined();
      expect(context.interrupt).toEqual({ type: "idle" });
    } finally {
      releaseProvider?.();
      releaseTool?.();
      builtInTools.Bash.call = originalCall;
    }
  });
});

describe("runtime-local auto-learning drain", () => {
  it("returns immediately while a classifier is pending", async () => {
    const { context } = await makeSendMessageContext();
    isolateAutoLearningMemory(context);
    context.memory.learningMode = "active";
    await writeMemoryLearningMode(context);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const classifierStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    context.modelGateway = {
      stream: async function* () {
        started();
        await gate;
        yield {
          type: "assistant_text_delta" as const,
          id: "memory-slow",
          text: JSON.stringify({ action: "no-op", reason: "test" }),
        };
        yield { type: "message_stop" as const, id: "memory-slow-stop", chunkCount: 1, hadUsage: false };
      },
    } as unknown as ModelGateway;
    const controller = new AbortController();

    const startedAt = performance.now();
    modelStreamAutoLearningTestHooks.enqueueAutoLearningAfterSuccessfulTurn(
      context,
      "请记住：我偏好简短中文回答。",
      { requestTurnId: "learning-slow", sessionId: context.sessionId!, signal: controller.signal },
    );
    expect(performance.now() - startedAt).toBeLessThan(100);
    await classifierStarted;
    release();
    while (context.memoryAutoLearningRuntime?.inFlight) {
      await context.memoryAutoLearningRuntime.inFlight;
    }
  });

  it("resolves sendMessage with final output while the turn-end classifier is still pending", async () => {
    const { context } = await makeSendMessageContext();
    isolateAutoLearningMemory(context);
    context.memory.learningMode = "active";
    await writeMemoryLearningMode(context);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const classifierStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    context.modelGateway = {
      stream: async function* () {
        started();
        await gate;
        yield {
          type: "assistant_text_delta" as const,
          id: "memory-after-final",
          text: JSON.stringify({ action: "no-op", reason: "test" }),
        };
        yield {
          type: "message_stop" as const,
          id: "memory-after-final-stop",
          chunkCount: 1,
          hadUsage: false,
        };
      },
    } as unknown as ModelGateway;
    const mainGateway = {
      stream: async function* () {
        yield { type: "assistant_text_delta" as const, id: "main-final", text: "这是普通回答。" };
        yield { type: "message_stop" as const, id: "main-final-stop", chunkCount: 1, hadUsage: false };
      },
      async countMessagesTokensWithAPI() {
        return { source: "unavailable", reason: "test" } as const;
      },
    } as unknown as ModelGateway;
    const output = new MemoryOutput();
    let finalCommitted!: () => void;
    const finalAssistantCommitted = new Promise<void>((resolve) => {
      finalCommitted = resolve;
    });
    const appendEvent = context.store.appendEvent.bind(context.store);
    context.store.appendEvent = async (sessionId, event, commitGuard) => {
      await appendEvent(sessionId, event, commitGuard);
      if (event.type === "assistant_text_delta" && event.text === "这是普通回答。") finalCommitted();
    };
    const sending = __testSendMessage("请记住：我偏好简短中文回答。", context, mainGateway, output);
    await finalAssistantCommitted;
    const finalCommittedAt = performance.now();
    const completedWithin100Ms = await Promise.race([
      sending.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 100)),
    ]);

    expect(completedWithin100Ms).toBe(true);
    expect(performance.now() - finalCommittedAt).toBeLessThan(100);
    expect(output.text).toContain("这是普通回答");
    await classifierStarted;
    release();
    while (context.memoryAutoLearningRuntime?.inFlight) {
      await context.memoryAutoLearningRuntime.inFlight;
    }
  });

  it("keeps one in-flight and only the latest trailing turn across 1,000 owners", async () => {
    const { context } = await makeSendMessageContext();
    isolateAutoLearningMemory(context);
    context.memory.learningMode = "active";
    await writeMemoryLearningMode(context);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const classifierStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    let calls = 0;
    let active = 0;
    let maxActive = 0;
    const requestContextIds: Array<string | undefined> = [];
    context.modelGateway = {
      stream: async function* (_providerId: string, request: { requestContextId?: string }) {
        calls += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        requestContextIds.push(request.requestContextId);
        try {
          if (calls === 1) {
            started();
            await gate;
          }
          yield {
            type: "assistant_text_delta" as const,
            id: `memory-${calls}`,
            text: JSON.stringify({ action: "no-op", reason: "test" }),
          };
          yield {
            type: "message_stop" as const,
            id: `memory-stop-${calls}`,
            chunkCount: 1,
            hadUsage: false,
          };
        } finally {
          active -= 1;
        }
      },
    } as unknown as ModelGateway;

    modelStreamAutoLearningTestHooks.enqueueAutoLearningAfterSuccessfulTurn(
      context,
      "first stable memory turn",
      { requestTurnId: "learning-0", sessionId: context.sessionId!, signal: new AbortController().signal },
    );
    await classifierStarted;
    const singleDrain = context.memoryAutoLearningRuntime?.inFlight;
    for (let index = 1; index < 1_000; index += 1) {
      modelStreamAutoLearningTestHooks.enqueueAutoLearningAfterSuccessfulTurn(
        context,
        `stable memory turn ${index}`,
        {
          requestTurnId: `learning-${index}`,
          sessionId: context.sessionId!,
          signal: new AbortController().signal,
        },
      );
      expect(context.memoryAutoLearningRuntime?.inFlight).toBe(singleDrain);
    }
    expect(context.memoryAutoLearningRuntime?.trailing?.requestTurnId).toBe("learning-999");
    release();
    while (context.memoryAutoLearningRuntime?.inFlight) {
      await context.memoryAutoLearningRuntime.inFlight;
    }

    expect(calls).toBe(2);
    expect(maxActive).toBe(1);
    expect(requestContextIds).toEqual(["learning-0", "learning-999"]);
    expect(context.memoryAutoLearningRuntime?.trailing).toBeUndefined();
  });

  it("drains an item enqueued immediately after the previous in-flight completes", async () => {
    const { context } = await makeSendMessageContext();
    isolateAutoLearningMemory(context);
    context.memory.learningMode = "active";
    await writeMemoryLearningMode(context);
    let calls = 0;
    context.modelGateway = {
      stream: async function* () {
        calls += 1;
        yield {
          type: "assistant_text_delta" as const,
          id: `memory-boundary-${calls}`,
          text: JSON.stringify({ action: "no-op", reason: "test" }),
        };
        yield {
          type: "message_stop" as const,
          id: `memory-boundary-stop-${calls}`,
          chunkCount: 1,
          hadUsage: false,
        };
      },
    } as unknown as ModelGateway;
    modelStreamAutoLearningTestHooks.enqueueAutoLearningAfterSuccessfulTurn(
      context,
      "first boundary turn",
      { requestTurnId: "boundary-1", sessionId: context.sessionId!, signal: new AbortController().signal },
    );
    const first = context.memoryAutoLearningRuntime?.inFlight;
    first?.then(() => {
      modelStreamAutoLearningTestHooks.enqueueAutoLearningAfterSuccessfulTurn(
        context,
        "latest boundary turn",
        { requestTurnId: "boundary-2", sessionId: context.sessionId!, signal: new AbortController().signal },
      );
    });
    await first;
    while (context.memoryAutoLearningRuntime?.inFlight) {
      await context.memoryAutoLearningRuntime.inFlight;
    }
    expect(calls).toBe(2);
  });

  it("does not revive an old in-flight owner after learning off then on", async () => {
    const { context, events } = await makeSendMessageContext();
    isolateAutoLearningMemory(context);
    context.memory.learningMode = "active";
    await writeMemoryLearningMode(context);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const classifierStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    context.modelGateway = {
      stream: async function* () {
        started();
        await gate;
        yield {
          type: "assistant_text_delta" as const,
          id: "old-owner-after-mode-toggle",
          text: JSON.stringify({
            action: "create",
            taxonomy: "user",
            summary: "User preference: stale owner must not commit",
            turnKind: "preference",
            stability: "stable",
          }),
        };
      },
    } as unknown as ModelGateway;
    modelStreamAutoLearningTestHooks.enqueueAutoLearningAfterSuccessfulTurn(
      context,
      "remember stale owner",
      { requestTurnId: "mode-old", sessionId: context.sessionId!, signal: new AbortController().signal },
    );
    await classifierStarted;

    context.memory.learningMode = "off";
    context.memoryAutoLearningRuntime!.latestRequestTurnId = undefined;
    context.memoryAutoLearningRuntime!.trailing = undefined;
    context.memory.learningMode = "active";
    await writeMemoryLearningMode(context);
    release();
    while (context.memoryAutoLearningRuntime?.inFlight) {
      await context.memoryAutoLearningRuntime.inFlight;
    }

    expect(context.memory.accepted).toEqual([]);
    expect(context.evidence).toEqual([]);
    expect(events.some((event) => (event as { type?: string }).type === "memory_accepted")).toBe(false);
    expect(events.some((event) => (event as { type?: string }).type === "evidence_record")).toBe(false);
  });

  it("keeps the last real learning run when an owned background drain throws", async () => {
    const { context } = await makeSendMessageContext();
    isolateAutoLearningMemory(context);
    context.memory.learningMode = "active";
    await writeMemoryLearningMode(context);
    const previousRun = {
      trigger: "manual" as const,
      candidatesCreated: 0,
      modelCalled: true,
      skippedReason: "previous-real-run",
      createdAt: new Date(0).toISOString(),
    };
    context.memory.lastLearningRun = previousRun;
    Object.defineProperty(context, "modelGateway", {
      configurable: true,
      get() {
        throw new Error("classifier setup failed");
      },
    });

    modelStreamAutoLearningTestHooks.enqueueAutoLearningAfterSuccessfulTurn(
      context,
      "background failure turn",
      { requestTurnId: "failure-owner", sessionId: context.sessionId!, signal: new AbortController().signal },
    );
    while (context.memoryAutoLearningRuntime?.inFlight) {
      await context.memoryAutoLearningRuntime.inFlight;
    }

    expect(context.memory.lastLearningRun).toBe(previousRun);
    expect(context.memory.learningModeDiagnostic).toContain("classifier setup failed");
  });
});

type TestStreamEvent =
  | { type: "assistant_text_delta"; text: string }
  | { type: "usage"; usage: { inputTokens: number; outputTokens: number; totalTokens: number } }
  | { type: "message_stop"; chunkCount: number; hadUsage: boolean; finishReason?: string };

function gatewayByTurn(
  turns: TestStreamEvent[][],
  calls: { count: number; requests?: Array<{ messages?: unknown }> },
): ModelGateway {
  return {
    async *stream(_providerId: string, request?: { messages?: unknown }) {
      calls.requests?.push({ messages: request?.messages });
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

async function makeSendMessageContext() {
  const projectPath = await mkdtemp(join(tmpdir(), "linghun-model-owner-"));
  const store = new SessionStore({ projectPath, sessionRootDir: join(projectPath, ".sessions") });
  const session = await store.create({ model: "deepseek-chat" });
  const events: unknown[] = [];
  const appendEvent = store.appendEvent.bind(store);
  store.appendEvent = async (sessionId, event, commitGuard) => {
    await appendEvent(sessionId, event, commitGuard);
    if (!commitGuard || commitGuard()) events.push(event);
  };
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
    memory: await createMemoryState(defaultConfig, projectPath),
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
  return { context, events };
}

function isolateAutoLearningMemory(context: TuiContext): void {
  context.memory.userDir = join(context.projectPath, ".test-user-memory");
  context.memory.projectDir = join(context.projectPath, ".test-project-memory");
  context.memory.sessionDir = join(context.projectPath, ".test-session-memory");
  context.memory.accepted = [];
  context.memory.candidates = [];
  context.memory.disabled = [];
}

describe("cross-window failure-learning refresh", () => {
  it("loads a new failure before the prompt and drops it after another window resolves it", async () => {
    const { context } = await makeSendMessageContext();
    context.memory.learningMode = "off";
    const writer = createFailureLearningState(context.projectPath, defaultConfig);
    const committed = await commitFailureLearningInput(writer, {
      category: "tool_failure",
      failureSummary: "focused verifier failed",
      rootCauseGuess: "synthetic cross-window failure",
      avoidNextTime: "run the focused verifier before reporting success",
      sourceRef: "test:cross-window",
      relatedTarget: "RunVerification",
    });
    expect(committed.status).toBe("committed");
    const requests: unknown[] = [];
    const gateway = {
      stream: async function* (_providerId: string, request: unknown) {
        requests.push(request);
        yield { type: "assistant_text_delta" as const, id: "answer", text: "已检查。" };
        yield { type: "message_stop" as const, chunkCount: 1, hadUsage: false };
      },
      async countMessagesTokensWithAPI() {
        return { source: "unavailable", reason: "test" } as const;
      },
    } as unknown as ModelGateway;

    await __testSendMessage("检查当前失败风险", context, gateway, new MemoryOutput());
    expect(JSON.stringify(requests.at(-1))).toContain("run the focused verifier");

    const [record] = await loadFailureRecords(writer);
    setFailureRecordStatus(record, "resolved");
    await writeFailureRecord(writer, { ...record, status: "resolved" });
    await __testSendMessage("再次检查当前失败风险", context, gateway, new MemoryOutput());
    expect(JSON.stringify(requests.at(-1))).not.toContain("run the focused verifier");
  });
});

describe("model message prompt cache layout", () => {
  it("grows provider messages as an append-only prefix across turns", async () => {
    let events: Array<{ type: "user_message" | "assistant_text_delta"; text: string }> = [];
    const context = {
      model: "test-model",
      cache: { history: [] },
      store: {
        readRecentTranscriptEvents: async () => ({ events }),
        appendEvent: async () => undefined,
      },
    };
    const runtime = {
      role: "executor" as const,
      provider: "test",
      model: "test-model",
      endpointProfile: "responses" as const,
      reasoningSent: false,
      reasoningStatus: "off" as const,
    };
    const systemPrompt = [
      { content: "stable system", promptCache: "cacheable" as const },
      { content: "session-latched runtime", promptCache: "cacheable" as const },
    ];

    const first = await __testBuildModelMessagesWithRecentContext(
      context as never,
      "session-append-only",
      systemPrompt,
      "first user",
      runtime,
    );
    events = [
      { type: "user_message", text: "first user" },
      { type: "assistant_text_delta", text: "first assistant" },
    ];
    const second = await __testBuildModelMessagesWithRecentContext(
      context as never,
      "session-append-only",
      systemPrompt,
      "second user",
      runtime,
    );

    expect(second.slice(0, first.length)).toEqual(first);
  });

  it("keeps the complete append-only conversation beyond twelve messages", async () => {
    const events = Array.from({ length: 14 }, (_, index) => ({
      type: index % 2 === 0 ? "user_message" as const : "assistant_text_delta" as const,
      text: `history ${index}`,
    }));
    const context = {
      model: "test-model",
      cache: { history: [] },
      store: {
        readRecentTranscriptEvents: async (_sessionId: string, input: { limit: number }) => ({
          events: events.slice(-input.limit),
        }),
        appendEvent: async () => undefined,
      },
    };

    const messages = await __testBuildModelMessagesWithRecentContext(
      context as never,
      "session-beyond-twelve",
      "stable system",
      "current user",
      {
        role: "executor",
        provider: "test",
        model: "test-model",
        endpointProfile: "responses",
        reasoningSent: false,
        reasoningStatus: "off",
      },
    );

    expect(messages.map((message) => message.content)).toEqual([
      "stable system",
      ...events.map((event) => event.text),
      "current user",
    ]);
  });

  it("keeps a tool call and result paired beyond the former history window", async () => {
    const events = [
      ...Array.from({ length: 13 }, (_, index) => ({
        type: index % 2 === 0 ? "user_message" as const : "assistant_text_delta" as const,
        text: `history ${index}`,
      })),
      { type: "tool_call_start" as const, id: "call-late", name: "Read", input: { path: "late.ts" } },
      {
        type: "tool_result" as const,
        toolUseId: "call-late",
        toolName: "Read",
        content: { text: "late result" },
      },
    ];
    const context = {
      model: "test-model",
      cache: { history: [] },
      evidence: [],
      store: {
        readRecentTranscriptEvents: async () => ({ events }),
        appendEvent: async () => undefined,
      },
    };

    const messages = await __testBuildModelMessagesWithRecentContext(
      context as never,
      "session-tool-pair-beyond-twelve",
      "stable system",
      "current user",
      {
        role: "executor",
        provider: "test",
        model: "test-model",
        endpointProfile: "responses",
        reasoningSent: false,
        reasoningStatus: "off",
      },
    );

    expect(messages.at(-3)).toMatchObject({
      role: "assistant",
      toolCalls: [{ id: "call-late", name: "Read" }],
    });
    expect(messages.at(-2)).toMatchObject({ role: "tool", tool_call_id: "call-late" });
    expect(messages.at(-1)).toMatchObject({ role: "user", content: "current user" });
  });

  it("resolves 1000 tool-result ledger lookups in one batch while preserving message order", async () => {
    const events = Array.from({ length: 1_000 }, (_, index) => [
      {
        type: "tool_call_start" as const,
        id: `call-batch-${index}`,
        name: "Read",
        input: { path: `src/file-${index}.ts` },
      },
      {
        type: "tool_result" as const,
        toolUseId: `call-batch-${index}`,
        toolName: "Read",
        content: { text: `result-${index}` },
      },
    ]).flat();
    const readRecentTranscriptEvents = vi.fn(
      async (_sessionId: string, input: { limit: number }) => ({
        events: input.limit === 1 ? [] : events,
      }),
    );
    const context = {
      projectPath: "",
      model: "test-model",
      cache: { history: [] },
      evidence: [],
      toolResultBudgetState: {
        seenIds: new Set<string>(),
        replacements: new Map(),
        hasLegacyArtifactPaths: true,
      },
      store: {
        readRecentTranscriptEvents,
        appendEvent: async () => undefined,
      },
    };

    const messages = await __testBuildModelMessagesWithRecentContext(
      context as never,
      "session-ledger-batch",
      "stable system",
      "current user",
      {
        role: "executor",
        provider: "test",
        model: "test-model",
        endpointProfile: "responses",
        reasoningSent: false,
        reasoningStatus: "off",
      },
    );

    const toolMessages = messages.filter((message) => message.role === "tool");
    expect(readRecentTranscriptEvents).toHaveBeenCalledTimes(2);
    expect(toolMessages).toHaveLength(1_000);
    expect(toolMessages[0]).toMatchObject({ tool_call_id: "call-batch-0" });
    expect(toolMessages.at(-1)).toMatchObject({ tool_call_id: "call-batch-999" });
  });

  it("tracks foreground turn ids and records interrupted turns once", async () => {
    const appended: unknown[] = [];
    const context = {
      tools: createToolContext(process.cwd()),
      store: {
        appendEvent: async (_sessionId: string, event: unknown) => {
          appended.push(event);
        },
      },
    };

    const firstTurnId = beginForegroundRequestTurn(context as never, "user-1");
    Object.assign(context, {
      currentUserActionConstraints: { readonlyOnly: true, forbidWrite: true },
      currentUserActionConstraintsRequestTurnId: firstTurnId,
      requestActivityOwner: { kind: "foreground", requestTurnId: firstTurnId },
      requestActivityPhase: "request_started",
    });
    const secondTurnId = beginForegroundRequestTurn(context as never, "user-2");

    expect(firstTurnId).not.toBe(secondTurnId);
    expect((context as { runtimeContextId?: string }).runtimeContextId).toBe(secondTurnId);
    expect((context as { currentRequestTurnId?: string }).currentRequestTurnId).toBe(secondTurnId);
    expect((context as { currentRequestUserMessageId?: string }).currentRequestUserMessageId).toBe(
      "user-2",
    );
    expect((context as { currentUserActionConstraints?: unknown }).currentUserActionConstraints).toBeUndefined();
    expect(
      (context as { currentUserActionConstraintsRequestTurnId?: string })
        .currentUserActionConstraintsRequestTurnId,
    ).toBeUndefined();
    expect((context as { requestActivityOwner?: unknown }).requestActivityOwner).toBeUndefined();
    expect((context as { requestActivityPhase?: unknown }).requestActivityPhase).toBeUndefined();

    await recordInterruptedForegroundTurn(context as never, "session-turn", {
      requestTurnId: secondTurnId,
      reason: "user_interrupt",
      userMessageId: "user-2",
    });
    await recordInterruptedForegroundTurn(context as never, "session-turn", {
      requestTurnId: secondTurnId,
      reason: "model_abort",
      userMessageId: "user-2",
    });

    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({
      type: "interrupt",
      status: "cancelled",
      message: expect.stringContaining(`requestTurnId=${secondTurnId}`),
    });
    expect((context as { lastInterruptedTurn?: unknown }).lastInterruptedTurn).toMatchObject({
      requestTurnId: secondTurnId,
      reason: "user_interrupt",
      userMessageId: "user-2",
    });
  });

  it("lets a natural request reach the provider while an unrelated workflow is blocked", async () => {
    const { context, events } = await makeSendMessageContext();
    context.workflows.activeRun = {
      id: "wf-blocked",
      goal: "old workflow",
      planId: "plan-blocked",
      status: "blocked",
      steps: [],
      startedAt: new Date(0).toISOString(),
      result: "blocked",
    };
    const stream = vi.fn(async function* () {
      yield { type: "assistant_text_delta", text: "可以继续回答这个普通问题。" } as const;
      yield { type: "message_stop", chunkCount: 1, hadUsage: false, finishReason: "stop" } as const;
    });
    const gateway = {
      stream,
      async countMessagesTokensWithAPI() {
        return { source: "unavailable", reason: "test" } as const;
      },
    } as unknown as ModelGateway;

    await __testSendMessage("解释当前代码路径", context, gateway, new MemoryOutput());

    expect(stream).toHaveBeenCalledTimes(1);
    expect(
      events.some((event) => JSON.stringify(event).includes("meta_scheduler:blocked_runtime_hint")),
    ).toBe(true);
    expect(
      events.some((event) => JSON.stringify(event).includes("meta_scheduler:blocked_runtime_stop")),
    ).toBe(false);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "assistant_text_delta",
        text: "可以继续回答这个普通问题。",
      }),
    );
  }, 30_000);

  it("does not create a request owner after a caller-owned controller aborts during session init", async () => {
    const { context, events } = await makeSendMessageContext();
    const store = context.store as SessionStore;
    const originalCreate = store.create.bind(store);
    let releaseCreate: (() => void) | undefined;
    const createGate = new Promise<void>((resolve) => { releaseCreate = resolve; });
    vi.spyOn(store, "create").mockImplementation(async (metadata) => {
      await createGate;
      return originalCreate(metadata);
    });
    context.sessionId = undefined;
    const controller = new AbortController();
    const stream = vi.fn(async function* () {
      yield { type: "assistant_text_delta", text: "must not run" } as const;
    });
    const gateway = { stream } as unknown as ModelGateway;

    const running = __testSendMessage(
      "must not start",
      context,
      gateway,
      new MemoryOutput(),
      controller,
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort("deadline");
    releaseCreate?.();
    await running;

    expect(stream).not.toHaveBeenCalled();
    expect(context.currentRequestTurnId).toBeUndefined();
    expect(events.some((event) => (event as { type?: string }).type === "user_message")).toBe(false);
  });

  it("does not carry historical tool or verification failures into a new request", async () => {
    const { context } = await makeSendMessageContext();
    context.turnContinuity = {
      consecutiveFailures: 2,
      consecutiveSuccesses: 0,
      dominantTaskKind: "edit",
      taskDomainSwitched: false,
      lastUserStateKind: "neutral",
      userStatePersistence: 1,
      totalTurns: 2,
      messageLengthTrend: "stable",
      trustScore: 50,
    };
    context.lastToolFailure = { toolName: "Bash", summary: "old command failed" };
    context.lastVerification = {
      id: "verification-old",
      status: "fail",
      commands: [],
      summary: "old verification failed",
      unverified: [],
      risk: [],
      startedAt: new Date(0).toISOString(),
      endedAt: new Date(0).toISOString(),
      durationMs: 1,
      nextAction: "retry",
      scope: {
        ownerKey: `request:${context.sessionId}:request-old`,
        cwd: context.projectPath,
        changedFiles: [],
        ownerSessionId: context.sessionId ?? "session-missing",
        requestTurnId: "request-old",
      },
    };
    context.evidence = [
      makeEvidence({
        id: "verification-evidence-old",
        kind: "test_result",
        supportsClaims: ["verification_passed", "test_passed"],
        ownerScope: {
          ownerSessionId: context.sessionId,
          requestTurnId: "request-old",
          cwd: context.projectPath,
        },
        data: {
          verificationScope: {
            ownerKey: `request:${context.sessionId}:request-old`,
            cwd: context.projectPath,
            changedFiles: [],
            ownerSessionId: context.sessionId,
            requestTurnId: "request-old",
          },
        },
      }),
    ];
    const gateway = {
      async *stream() {
        yield { type: "assistant_text_delta", text: "这是当前修改说明。" } as const;
        yield { type: "message_stop", chunkCount: 1, hadUsage: false, finishReason: "stop" } as const;
      },
      async countMessagesTokensWithAPI() {
        return { source: "unavailable", reason: "test" } as const;
      },
    } as unknown as ModelGateway;

    await __testSendMessage("修改 meta-scheduler-runtime.ts 的问题", context, gateway, new MemoryOutput());

    expect(context.turnContinuity.consecutiveFailures).toBe(0);
    expect(context.lastMetaSchedulerDecision?.policyDecision.taskKind).toBe("edit");
    expect(context.lastMetaSchedulerDecision?.policyDecision.verificationSignal.lastStatus).toBeUndefined();
    expect(
      context.lastMetaSchedulerDecision?.policyDecision.verificationSignal.route.evidenceFreshness,
    ).toBe("missing");
  });

  it.each([
    "不要 build，只运行 focused test",
    "别修改 vendor 目录",
    "停止自动发布但继续审计",
    "重新说明当前调用链",
    "这不对外开放，只做本地验证",
    "你的回答不对外公开",
    "你理解错误码后继续",
    "上次判断不对称矩阵需要覆盖",
    "check the wrong path fallback",
  ])("does not treat an ordinary constraint as assistant correction: %s", async (userText) => {
    const { context } = await makeSendMessageContext();
    context.turnContinuity = {
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      dominantTaskKind: null,
      taskDomainSwitched: false,
      lastUserStateKind: "neutral",
      userStatePersistence: 1,
      totalTurns: 0,
      messageLengthTrend: "stable",
      trustScore: 50,
    };
    const gateway = {
      async *stream() {
        yield { type: "assistant_text_delta", text: "这是当前说明。" } as const;
        yield { type: "message_stop", chunkCount: 1, hadUsage: false, finishReason: "stop" } as const;
      },
      async countMessagesTokensWithAPI() {
        return { source: "unavailable", reason: "test" } as const;
      },
    } as unknown as ModelGateway;

    await __testSendMessage(userText, context, gateway, new MemoryOutput());

    expect(context.turnContinuity.trustScore).toBe(51);
  });

  it.each(["不对，你误解了上一轮结论。", "You misunderstood what I asked."])(
    "recognizes an explicit correction: %s",
    async (userText) => {
      const { context } = await makeSendMessageContext();
      context.turnContinuity = {
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
        dominantTaskKind: null,
        taskDomainSwitched: false,
        lastUserStateKind: "neutral",
        userStatePersistence: 1,
        totalTurns: 0,
        messageLengthTrend: "stable",
        trustScore: 50,
      };
      const gateway = {
        async *stream() {
          yield { type: "assistant_text_delta", text: "这是更正后的说明。" } as const;
          yield { type: "message_stop", chunkCount: 1, hadUsage: false, finishReason: "stop" } as const;
        },
        async countMessagesTokensWithAPI() {
          return { source: "unavailable", reason: "test" } as const;
        },
      } as unknown as ModelGateway;

      await __testSendMessage(userText, context, gateway, new MemoryOutput());

      expect(context.turnContinuity.trustScore).toBe(42);
    },
  );

  it("drops a final assistant event when the main owner changes inside queued append", async () => {
    const { context, events } = await makeSendMessageContext();
    const store = context.store as SessionStore;
    const appendEvent = store.appendEvent.bind(store);
    let enterAppend: (() => void) | undefined;
    let releaseAppend: (() => void) | undefined;
    const appendEntered = new Promise<void>((resolve) => { enterAppend = resolve; });
    const appendGate = new Promise<void>((resolve) => { releaseAppend = resolve; });
    store.appendEvent = async (sessionId, event, commitGuard) => {
      if (event.type === "assistant_text_delta") {
        enterAppend?.();
        await appendGate;
      }
      return appendEvent(sessionId, event, commitGuard);
    };
    const gateway = gatewayByTurn(
      [[
        { type: "assistant_text_delta", text: "old owner final" },
        { type: "message_stop", chunkCount: 1, hadUsage: false, finishReason: "stop" },
      ]],
      { count: 0 },
    );

    const running = __testSendMessage("old request", context, gateway, new MemoryOutput());
    await appendEntered;
    beginForegroundRequestTurn(context, "new request");
    releaseAppend?.();
    await running;

    expect(
      events.some(
        (event) =>
          (event as { type?: string; text?: string }).type === "assistant_text_delta" &&
          (event as { text?: string }).text === "old owner final",
      ),
    ).toBe(false);
  });

  it("drops a final assistant event when the continuation owner changes inside queued append", async () => {
    const { context, events } = await makeSendMessageContext();
    const store = context.store as SessionStore;
    const appendEvent = store.appendEvent.bind(store);
    let enterAppend: (() => void) | undefined;
    let releaseAppend: (() => void) | undefined;
    const appendEntered = new Promise<void>((resolve) => { enterAppend = resolve; });
    const appendGate = new Promise<void>((resolve) => { releaseAppend = resolve; });
    store.appendEvent = async (sessionId, event, commitGuard) => {
      if (event.type === "assistant_text_delta") {
        enterAppend?.();
        await appendGate;
      }
      return appendEvent(sessionId, event, commitGuard);
    };
    const gateway = gatewayByTurn(
      [[
        { type: "assistant_text_delta", text: "old continuation final" },
        { type: "message_stop", chunkCount: 1, hadUsage: false, finishReason: "stop" },
      ]],
      { count: 0 },
    );

    const running = continueModelAfterToolResults(
      {
        messages: [{ role: "user", content: "continue" }],
        provider: "deepseek",
        model: "deepseek-chat",
        endpointProfile: "chat_completions",
        reasoningSent: false,
      },
      context,
      gateway,
      new MemoryOutput(),
    );
    await appendEntered;
    beginForegroundRequestTurn(context, "new request");
    releaseAppend?.();
    await running;

    expect(
      events.some(
        (event) =>
          (event as { type?: string; text?: string }).type === "assistant_text_delta" &&
          (event as { text?: string }).text === "old continuation final",
      ),
    ).toBe(false);
  });

  it("does not commit main usage/cache when owner changes inside queued usage append", async () => {
    const { context, events } = await makeSendMessageContext();
    let warmupBefore: unknown;
    let enterUsageAppend: (() => void) | undefined;
    let releaseUsageAppend: (() => void) | undefined;
    const usageAppendEntered = new Promise<void>((resolve) => {
      enterUsageAppend = resolve;
    });
    const usageAppendGate = new Promise<void>((resolve) => {
      releaseUsageAppend = resolve;
    });
    let historyAtUsageAppend: unknown[] = [];
    let contextUsageAtUsageAppend: unknown;
    let nextTurnAtUsageAppend = 0;
    let roleUsageAtUsageAppend: unknown[] = [];
    const appendEvent = context.store.appendEvent.bind(context.store);
    context.store.appendEvent = async (sessionId, event, commitGuard) => {
      if ((event as { type?: string }).type === "assistant_text_delta" && !warmupBefore) {
        warmupBefore = seedPostCompactWarmupObservation(context);
      }
      if ((event as { type?: string }).type === "usage") {
        historyAtUsageAppend = [...context.cache.history];
        contextUsageAtUsageAppend = context.cache.contextUsage
          ? { ...context.cache.contextUsage }
          : undefined;
        nextTurnAtUsageAppend = context.cache.nextTurn;
        roleUsageAtUsageAppend = context.roleUsage.map((item) => ({ ...item }));
        enterUsageAppend?.();
        await usageAppendGate;
      }
      return appendEvent(sessionId, event, commitGuard);
    };
    const gateway = gatewayByTurn(
      [[
        { type: "assistant_text_delta", text: "old main usage" },
        { type: "usage", usage: { inputTokens: 40, outputTokens: 4, totalTokens: 44 } },
        { type: "message_stop", chunkCount: 2, hadUsage: true, finishReason: "stop" },
      ]],
      { count: 0 },
    );

    const running = __testSendMessage("old main usage", context, gateway, new MemoryOutput());
    await usageAppendEntered;
    const oldController = context.activeAbortController;
    beginForegroundRequestTurn(context, "new main request");
    context.activeAbortController = new AbortController();
    oldController?.abort("owner_replaced");
    releaseUsageAppend?.();
    await running;

    expect(events.some((event) => (event as { type?: string }).type === "usage")).toBe(false);
    expect(context.cache.history).toEqual(historyAtUsageAppend);
    expect(context.cache.contextUsage).toEqual(contextUsageAtUsageAppend);
    expect(context.cache.nextTurn).toBe(nextTurnAtUsageAppend);
    expect(context.cache.postCompactCacheWarmup).toEqual(warmupBefore);
    expect(context.roleUsage).toEqual(roleUsageAtUsageAppend);
  });

  it("does not commit final usage/cache when owner changes inside queued usage append", async () => {
    const { context, events } = await makeSendMessageContext();
    let warmupBefore: unknown;
    const requestTurnId = beginForegroundRequestTurn(context, "old final request");
    const oldController = new AbortController();
    context.activeAbortController = oldController;
    let enterUsageAppend: (() => void) | undefined;
    let releaseUsageAppend: (() => void) | undefined;
    const usageAppendEntered = new Promise<void>((resolve) => {
      enterUsageAppend = resolve;
    });
    const usageAppendGate = new Promise<void>((resolve) => {
      releaseUsageAppend = resolve;
    });
    let historyAtUsageAppend: unknown[] = [];
    let contextUsageAtUsageAppend: unknown;
    let nextTurnAtUsageAppend = 0;
    let roleUsageAtUsageAppend: unknown[] = [];
    const appendEvent = context.store.appendEvent.bind(context.store);
    context.store.appendEvent = async (sessionId, event, commitGuard) => {
      if ((event as { type?: string }).type === "assistant_text_delta" && !warmupBefore) {
        warmupBefore = seedPostCompactWarmupObservation(context);
      }
      if ((event as { type?: string }).type === "usage") {
        historyAtUsageAppend = [...context.cache.history];
        contextUsageAtUsageAppend = context.cache.contextUsage
          ? { ...context.cache.contextUsage }
          : undefined;
        nextTurnAtUsageAppend = context.cache.nextTurn;
        roleUsageAtUsageAppend = context.roleUsage.map((item) => ({ ...item }));
        enterUsageAppend?.();
        await usageAppendGate;
      }
      return appendEvent(sessionId, event, commitGuard);
    };

    const running = __testStreamFinalModelAnswerWithoutTools(
      {
        messages: [{ role: "user", content: "final" }],
        provider: "test",
        model: "test-model",
        endpointProfile: "chat_completions",
        reasoningSent: false,
        originalUserText: "final",
        requestTurnId,
        abortSignal: oldController.signal,
      },
      context,
      gatewayByTurn(
        [[
          { type: "assistant_text_delta", text: "old final usage" },
          { type: "usage", usage: { inputTokens: 50, outputTokens: 5, totalTokens: 55 } },
          { type: "message_stop", chunkCount: 2, hadUsage: true, finishReason: "stop" },
        ]],
        { count: 0 },
      ),
      context.sessionId!,
      new MemoryOutput(),
      oldController.signal,
    );

    await usageAppendEntered;
    beginForegroundRequestTurn(context, "new final request");
    context.activeAbortController = new AbortController();
    oldController.abort("owner_replaced");
    releaseUsageAppend?.();
    await running;

    expect(events.some((event) => (event as { type?: string }).type === "usage")).toBe(false);
    expect(context.cache.history).toEqual(historyAtUsageAppend);
    expect(context.cache.contextUsage).toEqual(contextUsageAtUsageAppend);
    expect(context.cache.nextTurn).toBe(nextTurnAtUsageAppend);
    expect(context.cache.postCompactCacheWarmup).toEqual(warmupBefore);
    expect(context.roleUsage).toEqual(roleUsageAtUsageAppend);
  });

  it("does not commit continuation usage/cache when owner changes inside queued usage append", async () => {
    const { context, events } = await makeSendMessageContext();
    let warmupBefore: unknown;
    let enterUsageAppend: (() => void) | undefined;
    let releaseUsageAppend: (() => void) | undefined;
    const usageAppendEntered = new Promise<void>((resolve) => {
      enterUsageAppend = resolve;
    });
    const usageAppendGate = new Promise<void>((resolve) => {
      releaseUsageAppend = resolve;
    });
    let historyAtUsageAppend: unknown[] = [];
    let contextUsageAtUsageAppend: unknown;
    let nextTurnAtUsageAppend = 0;
    let roleUsageAtUsageAppend: unknown[] = [];
    const appendEvent = context.store.appendEvent.bind(context.store);
    context.store.appendEvent = async (sessionId, event, commitGuard) => {
      if ((event as { type?: string }).type === "assistant_text_delta" && !warmupBefore) {
        warmupBefore = seedPostCompactWarmupObservation(context);
      }
      if ((event as { type?: string }).type === "usage") {
        historyAtUsageAppend = [...context.cache.history];
        contextUsageAtUsageAppend = context.cache.contextUsage
          ? { ...context.cache.contextUsage }
          : undefined;
        nextTurnAtUsageAppend = context.cache.nextTurn;
        roleUsageAtUsageAppend = context.roleUsage.map((item) => ({ ...item }));
        enterUsageAppend?.();
        await usageAppendGate;
      }
      return appendEvent(sessionId, event, commitGuard);
    };
    const gateway = gatewayByTurn(
      [[
        { type: "assistant_text_delta", text: "old continuation usage" },
        { type: "usage", usage: { inputTokens: 60, outputTokens: 6, totalTokens: 66 } },
        { type: "message_stop", chunkCount: 2, hadUsage: true, finishReason: "stop" },
      ]],
      { count: 0 },
    );

    const running = continueModelAfterToolResults(
      {
        messages: [{ role: "user", content: "continue" }],
        provider: "deepseek",
        model: "deepseek-chat",
        endpointProfile: "chat_completions",
        reasoningSent: false,
      },
      context,
      gateway,
      new MemoryOutput(),
    );
    await usageAppendEntered;
    const oldController = context.activeAbortController;
    beginForegroundRequestTurn(context, "new continuation request");
    context.activeAbortController = new AbortController();
    oldController?.abort("owner_replaced");
    releaseUsageAppend?.();
    await running;

    expect(events.some((event) => (event as { type?: string }).type === "usage")).toBe(false);
    expect(context.cache.history).toEqual(historyAtUsageAppend);
    expect(context.cache.contextUsage).toEqual(contextUsageAtUsageAppend);
    expect(context.cache.nextTurn).toBe(nextTurnAtUsageAppend);
    expect(context.cache.postCompactCacheWarmup).toEqual(warmupBefore);
    expect(context.roleUsage).toEqual(roleUsageAtUsageAppend);
  });

  it("commits usage only from the terminal provider attempt after a partial retry", async () => {
    const { context, events } = await makeSendMessageContext();
    let attempts = 0;
    const gateway = {
      async *stream() {
        attempts += 1;
        if (attempts === 1) {
          yield { type: "assistant_text_delta", id: "partial", text: "partial" } as const;
          yield {
            type: "usage",
            usage: { inputTokens: 900, outputTokens: 90, totalTokens: 990 },
          } as const;
          yield {
            type: "error",
            error: new LinghunError({
              code: "PROVIDER_SERVER_ERROR",
              message: "retry this attempt",
              recoverable: true,
            }),
          } as const;
          return;
        }
        yield { type: "assistant_text_delta", id: "final", text: "最终回答" } as const;
        yield {
          type: "usage",
          usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
        } as const;
        yield {
          type: "message_stop",
          id: "stop-final",
          chunkCount: 3,
          hadUsage: true,
          finishReason: "stop",
        } as const;
      },
      async countMessagesTokensWithAPI() {
        return { source: "unavailable", reason: "test" } as const;
      },
    } as unknown as ModelGateway;

    await __testSendMessage("测试 attempt usage", context, gateway, new MemoryOutput());

    const usageEvents = events.filter(
      (event): event is { type: "usage"; usage: { totalTokens?: number } } =>
        (event as { type?: string }).type === "usage",
    );
    expect(attempts).toBe(2);
    expect(usageEvents).toHaveLength(1);
    expect(usageEvents[0]?.usage).toMatchObject({ inputTokens: 100, outputTokens: 10 });
    expect(context.cache.contextUsage?.confirmedUsedTokens).toBe(100);
    expect(context.cache.history.at(-1)?.kind).toBe("main");
    expect(JSON.stringify(events)).not.toContain('"totalTokens":990');
  }, 30_000);

  it("records final and continuation usage with their production cache kinds", async () => {
    const finalRuntime = await makeSendMessageContext();
    await __testStreamFinalModelAnswerWithoutTools(
      {
        messages: [{ role: "user", content: "final" }],
        provider: "test",
        model: "test-model",
        endpointProfile: "chat_completions",
        reasoningSent: false,
        originalUserText: "final",
      },
      finalRuntime.context,
      gatewayByTurn(
        [[
          { type: "assistant_text_delta", text: "final answer" },
          { type: "usage", usage: { inputTokens: 20, outputTokens: 2, totalTokens: 22 } },
          { type: "message_stop", chunkCount: 2, hadUsage: true, finishReason: "stop" },
        ]],
        { count: 0 },
      ),
      finalRuntime.context.sessionId!,
      new MemoryOutput(),
      new AbortController().signal,
    );
    expect(finalRuntime.context.cache.history.at(-1)?.kind).toBe("final");

    const continuationRuntime = await makeSendMessageContext();
    await continueModelAfterToolResults(
      {
        messages: [{ role: "user", content: "continue" }],
        provider: "test",
        model: "test-model",
        endpointProfile: "chat_completions",
        reasoningSent: false,
        originalUserText: "continue",
      },
      continuationRuntime.context,
      gatewayByTurn(
        [[
          { type: "assistant_text_delta", text: "continued answer" },
          { type: "usage", usage: { inputTokens: 30, outputTokens: 3, totalTokens: 33 } },
          { type: "message_stop", chunkCount: 2, hadUsage: true, finishReason: "stop" },
        ]],
        { count: 0 },
      ),
      new MemoryOutput(),
    );
    expect(continuationRuntime.context.cache.history.at(-1)?.kind).toBe("continuation");
  });

  it("starts a complete tool_use before message_stop while preserving terminal usage", async () => {
    const { context, events } = await makeSendMessageContext();
    await writeFile(join(context.projectPath, "early-read.txt"), "early tool content", "utf8");
    let releaseMessageStop!: () => void;
    const messageStopGate = new Promise<void>((resolve) => {
      releaseMessageStop = resolve;
    });
    let toolUseYielded!: () => void;
    const toolUseSeen = new Promise<void>((resolve) => {
      toolUseYielded = resolve;
    });
    let attempts = 0;
    const gateway = {
      async *stream() {
        attempts += 1;
        if (attempts === 1) {
          yield {
            type: "tool_use",
            id: "tool-early-read",
            name: "Read",
            input: { path: "early-read.txt" },
          } as const;
          toolUseYielded();
          await messageStopGate;
          yield {
            type: "usage",
            usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
          } as const;
          yield {
            type: "message_stop",
            id: "stop-tool",
            chunkCount: 3,
            hadUsage: true,
            finishReason: "tool_use",
          } as const;
          return;
        }
        yield { type: "assistant_text_delta", id: "final", text: "读取完成。" } as const;
        yield {
          type: "message_stop",
          id: "stop-final",
          chunkCount: 2,
          hadUsage: false,
          finishReason: "stop",
        } as const;
      },
      async countMessagesTokensWithAPI() {
        return { source: "unavailable", reason: "test" } as const;
      },
    } as unknown as ModelGateway;

    const running = __testSendMessage("读取 early-read.txt", context, gateway, new MemoryOutput());
    await toolUseSeen;
    await vi.waitFor(() => {
      expect(events.some((event) => (event as { type?: string }).type === "tool_call_start")).toBe(
        true,
      );
    });
    expect(attempts).toBe(1);

    releaseMessageStop();
    await running;

    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(
      events.filter((event) => (event as { type?: string }).type === "usage"),
    ).toHaveLength(1);
    expect(JSON.stringify(events)).toContain("early tool content");
  }, 30_000);

  it("starts every complete readonly tool_use before message_stop and keeps result order", async () => {
    const { context, events } = await makeSendMessageContext();
    await writeFile(join(context.projectPath, "early-a.txt"), "early A", "utf8");
    await writeFile(join(context.projectPath, "early-b.txt"), "early B", "utf8");
    let releaseMessageStop!: () => void;
    const messageStopGate = new Promise<void>((resolve) => {
      releaseMessageStop = resolve;
    });
    let secondToolYielded!: () => void;
    const secondToolSeen = new Promise<void>((resolve) => {
      secondToolYielded = resolve;
    });
    let attempts = 0;
    const gateway = {
      async *stream() {
        attempts += 1;
        if (attempts === 1) {
          yield {
            type: "tool_use",
            id: "tool-early-a",
            name: "Read",
            input: { path: "early-a.txt" },
          } as const;
          yield {
            type: "tool_use",
            id: "tool-early-b",
            name: "Read",
            input: { path: "early-b.txt" },
          } as const;
          secondToolYielded();
          await messageStopGate;
          yield {
            type: "usage",
            usage: { inputTokens: 120, outputTokens: 12, totalTokens: 132 },
          } as const;
          yield {
            type: "message_stop",
            id: "stop-multi-tool",
            chunkCount: 4,
            hadUsage: true,
            finishReason: "tool_use",
          } as const;
          return;
        }
        yield { type: "assistant_text_delta", id: "final", text: "两份读取完成。" } as const;
        yield {
          type: "message_stop",
          id: "stop-final",
          chunkCount: 2,
          hadUsage: false,
          finishReason: "stop",
        } as const;
      },
      async countMessagesTokensWithAPI() {
        return { source: "unavailable", reason: "test" } as const;
      },
    } as unknown as ModelGateway;

    const running = __testSendMessage("读取两份文件", context, gateway, new MemoryOutput());
    await secondToolSeen;
    await vi.waitFor(() => {
      expect(
        events.filter((event) => (event as { type?: string }).type === "tool_call_start"),
      ).toHaveLength(2);
    });
    expect(attempts).toBe(1);

    releaseMessageStop();
    await running;

    const serialized = JSON.stringify(events);
    expect(serialized).toContain("early A");
    expect(serialized).toContain("early B");
    expect(serialized.indexOf("tool-early-a")).toBeLessThan(serialized.indexOf("tool-early-b"));
    expect(events.filter((event) => (event as { type?: string }).type === "usage")).toHaveLength(1);
  }, 30_000);

  it("executes an independent fourth tool after three failures and returns an evidence-backed partial", async () => {
    const { context, events } = await makeSendMessageContext();
    let attempts = 0;
    const gateway = {
      async *stream() {
        attempts += 1;
        if (attempts === 1) {
          for (let index = 1; index <= 4; index += 1) {
            yield {
              type: "tool_use",
              id: `tool-missing-${index}`,
              name: "Read",
              input: { path: `missing-${index}.txt` },
            } as const;
          }
          yield {
            type: "message_stop",
            id: "stop-failed-batch",
            chunkCount: 4,
            hadUsage: false,
            finishReason: "tool_use",
          } as const;
          return;
        }
        yield {
          type: "assistant_text_delta",
          id: `failure-summary-${attempts}`,
          text: "读取仍未恢复。",
        } as const;
        yield {
          type: "message_stop",
          id: `stop-failure-summary-${attempts}`,
          chunkCount: 1,
          hadUsage: false,
          finishReason: "stop",
        } as const;
      },
      async countMessagesTokensWithAPI() {
        return { source: "unavailable", reason: "test" } as const;
      },
    } as unknown as ModelGateway;

    await __testSendMessage("读取四个不存在的文件", context, gateway, new MemoryOutput());

    expect(
      events.filter((event) => (event as { type?: string }).type === "tool_call_start"),
    ).toHaveLength(4);
    expect(JSON.stringify(events)).not.toContain("tool_batch_fail_fast");
    const final = events
      .filter(
        (event): event is { type: string; text?: string } =>
          (event as { type?: string }).type === "assistant_text_delta",
      )
      .at(-1);
    expect(final?.text).toContain("执行失败");
    expect(final?.text).not.toContain("部分完成");
    expect(final?.text).toContain("已有 4 条记录");
    expect(final?.text).not.toContain("重新发起请求");
  }, 30_000);

  it("commits repeated raw tool protocol as an evidence-backed partial without fake tool results", async () => {
    const { context, events } = await makeSendMessageContext();
    let attempts = 0;
    const rawProtocol =
      '<tool_use id="toolu_raw" name="Write"><input>{"path":"report.md","content":"fake"}</input></tool_use>';
    const gateway = {
      async *stream() {
        attempts += 1;
        yield { type: "assistant_text_delta", id: `raw-${attempts}`, text: rawProtocol } as const;
        yield {
          type: "message_stop",
          id: `raw-stop-${attempts}`,
          chunkCount: 1,
          hadUsage: false,
          finishReason: "stop",
        } as const;
      },
      async countMessagesTokensWithAPI() {
        return { source: "unavailable", reason: "test" } as const;
      },
    } as unknown as ModelGateway;

    await __testSendMessage("写入 report.md", context, gateway, new MemoryOutput());

    const serialized = JSON.stringify(events);
    const final = events
      .filter(
        (event): event is { type: string; text?: string } =>
          (event as { type?: string }).type === "assistant_text_delta",
      )
      .at(-1);
    expect(attempts).toBe(2);
    expect(final?.text).toContain("执行失败");
    expect(final?.text).not.toContain("部分完成");
    expect(final?.text).toContain("没有执行任何非结构化工具请求");
    expect(serialized).not.toContain('"type":"tool_result"');
    expect(serialized).not.toContain(rawProtocol);
  }, 30_000);

  it("commits repeated continuation raw tool protocol through the same partial final gate", async () => {
    const { context, events } = await makeSendMessageContext();
    let attempts = 0;
    const rawProtocol =
      '{"type":"tool_use","id":"toolu_cont_raw","name":"Write","input":{"path":"report.md","content":"fake"}}';
    const gateway = {
      async *stream() {
        attempts += 1;
        yield {
          type: "assistant_text_delta",
          id: `cont-raw-${attempts}`,
          text: rawProtocol,
        } as const;
        yield {
          type: "message_stop",
          id: `cont-raw-stop-${attempts}`,
          chunkCount: 1,
          hadUsage: false,
          finishReason: "stop",
        } as const;
      },
      async countMessagesTokensWithAPI() {
        return { source: "unavailable", reason: "test" } as const;
      },
    } as unknown as ModelGateway;

    await continueModelAfterToolResults(
      {
        messages: [{ role: "user", content: "继续写入 report.md" }],
        provider: "deepseek",
        model: "deepseek-chat",
        endpointProfile: "chat_completions",
        reasoningSent: false,
      },
      context,
      gateway,
      new MemoryOutput(),
    );

    const serialized = JSON.stringify(events);
    const final = events
      .filter(
        (event): event is { type: string; text?: string } =>
          (event as { type?: string }).type === "assistant_text_delta",
      )
      .at(-1);
    expect(attempts).toBe(2);
    expect(final?.text).toContain("执行失败");
    expect(final?.text).not.toContain("部分完成");
    expect(final?.text).toContain("没有执行任何非结构化工具请求");
    expect(serialized).not.toContain('"type":"tool_result"');
    expect(serialized).not.toContain(rawProtocol);
  }, 30_000);

  it("clears an owned pending tool approval when the provider fails before message_stop", async () => {
    const { context } = await makeSendMessageContext();
    let releaseProviderError!: () => void;
    const providerErrorGate = new Promise<void>((resolve) => {
      releaseProviderError = resolve;
    });
    const gateway = {
      async *stream() {
        yield {
          type: "tool_use",
          id: "tool-approval-provider-error",
          name: "Write",
          input: { path: "approval.txt", content: "not written" },
        } as const;
        await providerErrorGate;
        yield {
          type: "error",
          error: new LinghunError({
            code: "PROVIDER_STREAM_ERROR",
            message: "stream failed after approval request",
            recoverable: true,
          }),
        } as const;
      },
      async countMessagesTokensWithAPI() {
        return { source: "unavailable", reason: "test" } as const;
      },
    } as unknown as ModelGateway;

    const running = __testSendMessage("写入 approval.txt", context, gateway, new MemoryOutput());
    await vi.waitFor(() => {
      expect(context.pendingLocalApproval).toMatchObject({ kind: "model_tool_use" });
    });
    releaseProviderError();
    await running;

    expect(context.pendingLocalApproval).toBeUndefined();
  }, 30_000);

  it("clears an owned pending tool approval when ESC aborts the request", async () => {
    const { context } = await makeSendMessageContext();
    const controller = new AbortController();
    const gateway = {
      async *stream(_providerId: string, _request: unknown, signal: AbortSignal) {
        yield {
          type: "tool_use",
          id: "tool-approval-abort",
          name: "Write",
          input: { path: "approval-abort.txt", content: "not written" },
        } as const;
        await new Promise<void>((resolve) => {
          if (signal.aborted) {
            resolve();
            return;
          }
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
      async countMessagesTokensWithAPI() {
        return { source: "unavailable", reason: "test" } as const;
      },
    } as unknown as ModelGateway;

    const running = __testSendMessage(
      "写入 approval-abort.txt",
      context,
      gateway,
      new MemoryOutput(),
      controller,
    );
    await vi.waitFor(() => {
      expect(context.pendingLocalApproval).toMatchObject({ kind: "model_tool_use" });
    });
    controller.abort("ESC");
    await running;

    expect(context.pendingLocalApproval).toBeUndefined();
  }, 30_000);

  it("preserves progress state across main-to-continuation approval without counting unrelated success", async () => {
    const { context } = await makeSendMessageContext();
    await writeFile(join(context.projectPath, "source.txt"), "source\n", "utf8");
    const output = new MemoryOutput();
    let attempts = 0;
    const gateway = {
      async *stream() {
        attempts += 1;
        if (attempts === 1) {
          yield {
            type: "assistant_text_delta",
            id: "approval-gap",
            text: withClaims("测试通过。", [{ kind: "completion_pass", phrase: "测试通过" }]),
          } as const;
        } else if (attempts === 2) {
          yield {
            type: "tool_use",
            id: "approval-read",
            name: "Read",
            input: { path: "source.txt" },
          } as const;
        } else if (attempts === 3) {
          yield {
            type: "tool_use",
            id: "approval-write",
            name: "Write",
            input: { path: "approved.txt", content: "approved\n" },
          } as const;
        } else {
          yield {
            type: "assistant_text_delta",
            id: "approval-final",
            text: "已记录审批结果。",
          } as const;
        }
        yield { type: "message_stop", finishReason: attempts >= 2 && attempts <= 3 ? "tool_use" : "stop" } as const;
      },
      async countMessagesTokensWithAPI() {
        return { source: "unavailable", reason: "test" } as const;
      },
    } as unknown as ModelGateway;

    await __testSendMessage("完成当前修改并验证", context, gateway, output);

    const approval = context.pendingLocalApproval;
    expect(approval).toMatchObject({ kind: "model_tool_use" });
    if (!approval || !("continuation" in approval) || !approval.continuation) {
      throw new Error("expected a model tool approval continuation");
    }
    const continuation = approval.continuation;
    expect(continuation.finalAnswerEvidenceActionRetries).toBe(1);
    expect(continuation.finalGapProgressState?.attemptedCommandFingerprints.size).toBe(0);

    await handleNaturalInput("yes", context, gateway, output);

    expect(continuation.finalAnswerEvidenceActionRetries).toBe(1);
    expect(continuation.finalGapProgressState?.attemptedCommandFingerprints.size).toBe(0);
    expect(attempts).toBe(4);
  }, 30_000);

  it.each([
    ["permission denial", "deny", "permission_denied", "用户拒绝权限"],
    ["user cancellation", "cancel", "user_cancelled", "用户取消"],
  ] as const)(
    "reports only the matching final-gap conclusion as blocked after %s",
    async (_label, decision, expectedReason, expectedText) => {
      const { context, events } = await makeSendMessageContext();
      const output = new MemoryOutput();
      context.permissions.rules.push({
        id: `ask-bash-${decision}`,
        effect: "ask",
        toolName: "Bash",
      });
      const originalCall = builtInTools.Bash.call;
      const execute = vi.fn(async () => ({ text: "must not run", data: { exitCode: 0 } }));
      builtInTools.Bash.call = execute as typeof originalCall;
      let attempts = 0;
      const gateway = {
        async *stream() {
          attempts += 1;
          if (attempts === 2) {
            yield {
              type: "tool_use",
              id: `blocked-test-${decision}`,
              name: "Bash",
              input: { command: "pnpm test" },
            } as const;
            yield {
              type: "message_stop",
              chunkCount: 1,
              hadUsage: false,
              finishReason: "tool_use",
            } as const;
            return;
          }
          yield {
            type: "assistant_text_delta",
            text: withClaims("测试已经通过。", [{ kind: "completion_pass", phrase: "测试已经通过" }]),
          } as const;
          yield {
            type: "message_stop",
            chunkCount: 1,
            hadUsage: false,
            finishReason: "stop",
          } as const;
        },
        async countMessagesTokensWithAPI() {
          return { source: "unavailable", reason: "test" } as const;
        },
      } as unknown as ModelGateway;
      context.modelGateway = gateway;

      try {
        await __testSendMessage("完成修改并确认测试通过", context, gateway, output);
        const approval = context.pendingLocalApproval;
        expect(approval).toMatchObject({ kind: "model_tool_use", toolName: "Bash" });
        if (!approval || !("continuation" in approval) || !approval.continuation) {
          throw new Error("expected a Bash final-gap approval continuation");
        }
        const continuation = approval.continuation;

        if (decision === "deny") {
          await handleNaturalInput("no", context, gateway, output);
        } else {
          await cancelPendingInteraction(context, output, "Esc");
        }

        const finalAssistantText = events
          .filter((event): event is { type: "assistant_text_delta"; text: string } =>
            typeof event === "object" &&
            event !== null &&
            (event as { type?: string }).type === "assistant_text_delta" &&
            typeof (event as { text?: unknown }).text === "string")
          .at(-1)?.text ?? "";
        expect(execute).not.toHaveBeenCalled();
        expect(attempts).toBe(3);
        expect(continuation.finalGapProgressState?.externalBlockReason).toBe(expectedReason);
        expect(finalAssistantText).toContain(expectedText);
        expect(finalAssistantText).toContain("仅对应的无证据结论受阻");
        expect(finalAssistantText).not.toContain("所有可用且不重复");
        expect(finalAssistantText).not.toContain("执行失败");
      } finally {
        builtInTools.Bash.call = originalCall;
      }
    },
    30_000,
  );

  it("records an empty provider stream as a structured resumable failure", async () => {
    const { context, events } = await makeSendMessageContext();
    const blocks: Array<Record<string, unknown>> = [];
    const output = createShellBlockOutputForTest(context, blocks as never);
    const gateway = {
      async *stream() {
        yield {
          type: "message_stop",
          chunkCount: 0,
          hadUsage: false,
          finishReason: "stop",
        } as const;
      },
      async countMessagesTokensWithAPI() {
        return { source: "unavailable", reason: "test" } as const;
      },
    } as unknown as ModelGateway;

    await __testSendMessage("继续当前请求", context, gateway, output);

    expect(context.lastProviderFailure).toMatchObject({
      code: "PROVIDER_EMPTY_RESPONSE",
      outcome: "empty_response",
      recoverability: "resumable",
      requestTurnId: expect.any(String),
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "evidence_record",
        supportsClaims: expect.arrayContaining([
          "provider_failure",
          "PROVIDER_EMPTY_RESPONSE",
        ]),
      }),
    );
    expect(blocks).toContainEqual(
      expect.objectContaining({
        messageKind: "tool_result_error",
        failureDomain: "provider",
        failureOutcome: "empty_response",
        failureRequestTurnId: context.lastProviderFailure?.requestTurnId,
      }),
    );
  }, 30_000);

  it("drops an empty-stream failure when a newer request takes ownership during evidence append", async () => {
    const { context, events } = await makeSendMessageContext();
    const blocks: Array<Record<string, unknown>> = [];
    const output = createShellBlockOutputForTest(context, blocks as never);
    const appendEvent = context.store.appendEvent.bind(context.store);
    let superseded = false;
    context.store.appendEvent = async (sessionId, event, commitGuard) => {
      if (
        !superseded &&
        event.type === "evidence_record" &&
        event.supportsClaims.includes("provider_failure")
      ) {
        superseded = true;
        context.activeAbortController?.abort();
        beginForegroundRequestTurn(context, "user-new");
      }
      await appendEvent(sessionId, event, commitGuard);
    };
    const gateway = {
      async *stream() {
        yield {
          type: "message_stop",
          chunkCount: 0,
          hadUsage: false,
          finishReason: "stop",
        } as const;
      },
      async countMessagesTokensWithAPI() {
        return { source: "unavailable", reason: "test" } as const;
      },
    } as unknown as ModelGateway;

    await __testSendMessage("旧请求", context, gateway, output);

    expect(superseded).toBe(true);
    expect(context.lastProviderFailure).toBeUndefined();
    expect(context.evidence.some((item) => item.supportsClaims.includes("provider_failure"))).toBe(
      false,
    );
    expect(
      events.some(
        (event) =>
          (event as { type?: string; supportsClaims?: string[] }).type === "evidence_record" &&
          (event as { supportsClaims?: string[] }).supportsClaims?.includes("provider_failure"),
      ),
    ).toBe(false);
    expect(blocks.some((block) => block.failureDomain === "provider")).toBe(false);
  }, 30_000);

  it("keeps volatile current-turn context after the compact and transcript cache prefix", async () => {
    const compactBoundary = {
      type: "system_event" as const,
      level: "info" as const,
      message: `compact_projection:${JSON.stringify(
        makeCompactProjection("stable compact summary"),
      )}`,
    };
    let events = [
      compactBoundary,
      { type: "user_message" as const, text: "previous user" },
      { type: "assistant_text_delta" as const, text: "previous assistant" },
    ];
    const context = {
      model: "test-model",
      cache: { history: [] },
      store: {
        readRecentTranscriptEvents: async () => ({ events }),
        appendEvent: async () => undefined,
      },
    };

    const first = await __testBuildModelMessagesWithRecentContext(
      context as never,
      "session-cache-layout",
      [{ content: "stable system", promptCache: "cacheable" }],
      "current user",
      {
        role: "executor",
        provider: "test",
        model: "test-model",
        endpointProfile: "responses",
        reasoningSent: false,
        reasoningStatus: "off",
      },
      [{ content: "volatile diagnostics one", promptCache: "volatile" }],
    );

    expect(first.map((message) => `${message.role}:${message.content}`)).toEqual([
      "system:stable system",
      "user:Context compact projection\nstable compact summary",
      "user:previous user",
      "assistant:previous assistant",
      "user:Current-turn internal context (not user-authored; do not quote it to the user):\nvolatile diagnostics one",
      "user:current user",
    ]);
    expect(first[0]).toMatchObject({ promptCache: "cacheable" });
    expect(first.at(-2)).toMatchObject({ promptCache: "volatile" });

    events = [
      compactBoundary,
      { type: "user_message", text: "previous user" },
      { type: "assistant_text_delta", text: "previous assistant" },
      { type: "user_message", text: "current user" },
      { type: "assistant_text_delta", text: "current assistant" },
    ];
    const second = await __testBuildModelMessagesWithRecentContext(
      context as never,
      "session-cache-layout",
      [{ content: "stable system", promptCache: "cacheable" }],
      "next user",
      {
        role: "executor",
        provider: "test",
        model: "test-model",
        endpointProfile: "responses",
        reasoningSent: false,
        reasoningStatus: "off",
      },
      [{ content: "volatile diagnostics two", promptCache: "volatile" }],
    );
    const firstVolatileIndex = first.findIndex(
      (message) => "promptCache" in message && message.promptCache === "volatile",
    );
    const secondVolatileIndex = second.findIndex(
      (message) => "promptCache" in message && message.promptCache === "volatile",
    );

    expect(firstVolatileIndex).toBeGreaterThan(1);
    expect(secondVolatileIndex).toBeGreaterThan(firstVolatileIndex);
    expect(second.slice(0, firstVolatileIndex)).toEqual(first.slice(0, firstVolatileIndex));
    expect(second.at(-2)?.content).toContain("volatile diagnostics two");
    expect(second.at(-1)).toMatchObject({ role: "user", content: "next user" });
  });

  it("exhausts multiple runtime fallbacks once without cycling", async () => {
    const { context } = await makeSendMessageContext();
    context.model = "primary-model";
    context.config = {
      ...defaultConfig,
      defaultModel: "primary-model",
      providers: {
        primary: { type: "deepseek", model: "primary-model", apiKey: "test-key" },
        fallbackB: { type: "deepseek", model: "fallback-b", apiKey: "test-key" },
        fallbackC: { type: "deepseek", model: "fallback-c", apiKey: "test-key" },
      },
      modelRoutes: {
        defaultModel: "primary-model",
        routes: [
          {
            ...defaultConfig.modelRoutes.routes.find((route) => route.role === "executor")!,
            role: "executor",
            provider: "primary",
            primaryModel: "primary-model",
            fallbackModels: ["fallback-b", "fallback-c"],
            allowTools: true,
          },
        ],
      },
    };
    const attemptedModels: string[] = [];
    const gateway = {
      async *stream(_provider: string, request: { model?: string }) {
        attemptedModels.push(request.model ?? "");
        yield {
          type: "error",
          error: new LinghunError({
            code: "PROVIDER_QUOTA_EXHAUSTED",
            message: "quota exhausted",
            recoverable: true,
          }),
        } as const;
      },
      async countMessagesTokensWithAPI() {
        return { source: "unavailable", reason: "test" } as const;
      },
    } as unknown as ModelGateway;

    await __testSendMessage("检查 fallback 有界性", context, gateway, new MemoryOutput());

    expect(attemptedModels).toEqual(["primary-model", "fallback-b", "fallback-c"]);
  });

  it("bounds a verification directive after an unrelated Read without cycling", async () => {
    const { context, events } = await makeSendMessageContext();
    await writeFile(join(context.projectPath, "unrelated.txt"), "unrelated evidence\n", "utf8");
    let attempts = 0;
    const gateway = {
      async *stream() {
        attempts += 1;
        if (attempts === 2) {
          yield {
            type: "tool_use",
            id: "unrelated-read",
            name: "Read",
            input: { path: "unrelated.txt" },
          } as const;
          yield {
            type: "message_stop",
            chunkCount: 1,
            hadUsage: false,
            finishReason: "tool_use",
          } as const;
          return;
        }
        yield {
          type: "assistant_text_delta",
          text: attempts < 4 ? "测试已经通过。" : "本请求尚未获得测试通过证据。",
        } as const;
        yield {
          type: "message_stop",
          chunkCount: 1,
          hadUsage: false,
          finishReason: "stop",
        } as const;
      },
      async countMessagesTokensWithAPI() {
        return { source: "unavailable", reason: "test" } as const;
      },
    } as unknown as ModelGateway;

    await __testSendMessage("确认测试是否通过", context, gateway, new MemoryOutput());

    expect(attempts).toBe(3);
    expect(JSON.stringify(events)).toContain("final_answer_gap_returned_to_model_loop");
    expect(JSON.stringify(events)).toContain("unrelated evidence");
    expect(JSON.stringify(events)).toContain("我已确认目前检查覆盖到的部分");
    expect(JSON.stringify(events)).not.toContain("所有可用且不重复");
    expect(JSON.stringify(events)).not.toContain("执行失败");
  }, 30_000);

  it("cuts model history at the latest compact projection boundary", async () => {
    const projection = makeCompactProjection("STABLE_COMPACT_SUMMARY", {
      boundaryId: "compact-boundary-test",
      restoreContext: makeCompactRestoreContext({ currentTask: "continue after compact" }),
    });
    const context = {
      model: "test-model",
      cache: { history: [] },
      store: {
        readRecentTranscriptEvents: async () => ({
          events: [
            { type: "user_message", text: "RAW_OLD_CONTEXT user" },
            { type: "assistant_text_delta", text: "RAW_OLD_CONTEXT assistant" },
            {
              type: "tool_result",
              toolUseId: "old-call",
              toolName: "Read",
              content: "RAW_OLD_CONTEXT tool_result",
            },
            {
              type: "system_event",
              level: "info",
              message: `compact_projection:${JSON.stringify(projection)}`,
            },
            { type: "user_message", text: "new request after compact" },
            { type: "assistant_text_delta", text: "new answer after compact" },
            { type: "user_message", text: "current user" },
          ],
        }),
        appendEvent: async () => undefined,
      },
    };

    const messages = await __testBuildModelMessagesWithRecentContext(
      context as never,
      "session-compact-boundary",
      [{ content: "stable system", promptCache: "cacheable" }],
      "current user",
      {
        role: "executor",
        provider: "test",
        model: "test-model",
        endpointProfile: "responses",
        reasoningSent: false,
        reasoningStatus: "off",
      },
    );
    const serialized = JSON.stringify(messages);

    expect(serialized).toContain("STABLE_COMPACT_SUMMARY");
    expect(serialized).toContain("new request after compact");
    expect(serialized).toContain("new answer after compact");
    expect(serialized).not.toContain("RAW_OLD_CONTEXT");
  });

  it("keeps latest user request and current prohibitions after compact resume metadata", async () => {
    const projection = makeCompactProjection("OLD_COMPACT_SUMMARY_RUN_TESTS", {
      boundaryId: "compact-boundary-current-request",
      restoreContext: makeCompactRestoreContext({
        currentTask: "OLD_TODO_WRITE_PATCH",
        pendingItems: ["todo:in_progress:OLD_PENDING_TODO_EDIT"],
        risks: ["HISTORICAL_FINDING_NOT_AUTHORIZATION"],
      }),
    });
    const latestText = [
      "LATEST_USER_REQUEST_READ_ONLY_EXPLORER",
      "FORBID_WRITE_CURRENT_TURN",
      "CURRENT_ONLY_NEXT_STEP_REPORT_TEST_LANDING",
    ].join("\n");
    const context = {
      model: "test-model",
      cache: { history: [] },
      store: {
        readRecentTranscriptEvents: async () => ({
          events: [
            {
              type: "system_event",
              level: "info",
              message: `compact_projection:${JSON.stringify(projection)}`,
            },
            { type: "user_message", text: "old request after compact" },
            { type: "assistant_text_delta", text: "old answer after compact" },
          ],
        }),
        appendEvent: async () => undefined,
      },
    };

    const messages = await __testBuildModelMessagesWithRecentContext(
      context as never,
      "session-compact-current-request",
      [{ content: "stable system", promptCache: "cacheable" }],
      latestText,
      {
        role: "executor",
        provider: "test",
        model: "test-model",
        endpointProfile: "responses",
        reasoningSent: false,
        reasoningStatus: "off",
      },
    );
    const serialized = JSON.stringify(messages);

    expect(messages.at(-1)).toMatchObject({ role: "user", content: latestText });
    expect(messages.at(-1)?.content).toContain("LATEST_USER_REQUEST_READ_ONLY_EXPLORER");
    expect(messages.at(-1)?.content).toContain("FORBID_WRITE_CURRENT_TURN");
    expect(messages.at(-1)?.content).toContain("CURRENT_ONLY_NEXT_STEP_REPORT_TEST_LANDING");
    expect(messages.at(-1)?.content).not.toContain("OLD_COMPACT_SUMMARY_RUN_TESTS");
    expect(messages.at(-1)?.content).not.toContain("OLD_TODO_WRITE_PATCH");
    expect(messages.at(-1)?.content).not.toContain("HISTORICAL_FINDING_NOT_AUTHORIZATION");
    expect(serialized.indexOf("LATEST_USER_REQUEST_READ_ONLY_EXPLORER")).toBeGreaterThan(
      serialized.indexOf("OLD_COMPACT_SUMMARY_RUN_TESTS"),
    );
    expect(serialized.indexOf("CURRENT_ONLY_NEXT_STEP_REPORT_TEST_LANDING")).toBeGreaterThan(
      serialized.indexOf("OLD_TODO_WRITE_PATCH"),
    );
    expect(serialized).toContain("risk count: 1");
    expect(serialized).not.toContain("HISTORICAL_FINDING_NOT_AUTHORIZATION");
    expect(serialized).not.toContain("AUTHORIZED_BY_HISTORY");
  });

  it("stops the reverse transcript scan at the latest compact boundary", async () => {
    const projection = makeCompactProjection("STABLE_COMPACT_SUMMARY_OUTSIDE_TAIL", {
      boundaryId: "compact-boundary-outside-tail",
      restoreContext: makeCompactRestoreContext({
        currentTask: "continue beyond the bounded tail",
      }),
    });
    const boundary = {
      type: "system_event",
      level: "info",
      message: `compact_projection:${JSON.stringify(projection)}`,
    };
    const activeTail = [
      ...Array.from({ length: 30 }, (_, index) => ({
        type: "assistant_text_delta",
        text: `post-boundary answer ${index}`,
      })),
      { type: "user_message", text: "current user" },
    ];
    const readLimits: number[] = [];
    const readByteLimits: number[] = [];
    const readLineLimits: number[] = [];
    const stopPredicates: boolean[] = [];
    const context = {
      model: "test-model",
      cache: { history: [] },
      store: {
        readRecentTranscriptEvents: async (
          _sessionId: string,
          input: {
            limit: number;
            maxBytes?: number;
            maxLineBytes?: number;
            stopPredicate?: (event: unknown) => boolean;
          },
        ) => {
          readLimits.push(input.limit);
          readByteLimits.push(input.maxBytes ?? 0);
          readLineLimits.push(input.maxLineBytes ?? 0);
          stopPredicates.push(Boolean(input.stopPredicate?.(boundary)));
          return { events: [boundary, ...activeTail], diagnostics: [] };
        },
        appendEvent: async () => undefined,
      },
    };

    const messages = await __testBuildModelMessagesWithRecentContext(
      context as never,
      "session-boundary-outside-tail",
      [{ content: "stable system", promptCache: "cacheable" }],
      "current user",
      {
        role: "executor",
        provider: "test",
        model: "test-model",
        endpointProfile: "responses",
        reasoningSent: false,
        reasoningStatus: "off",
      },
    );
    const serialized = JSON.stringify(messages);

    expect(readLimits).toEqual([10_000]);
    expect(readByteLimits).toEqual([4 * 1024 * 1024]);
    expect(readLineLimits).toEqual([1024 * 1024]);
    expect(stopPredicates).toEqual([true]);
    expect(serialized).toContain("STABLE_COMPACT_SUMMARY_OUTSIDE_TAIL");
    expect(serialized).toContain("post-boundary answer 0");
    expect(serialized).toContain("post-boundary answer 29");
  });

  it("marks bounded transcript continuity without exposing raw loader diagnostics", async () => {
    const context = {
      model: "test-model",
      cache: { history: [] },
      store: {
        readRecentTranscriptEvents: async () => ({
          events: [
            { type: "assistant_text_delta", text: "recent bounded answer" },
            { type: "user_message", text: "current user" },
          ],
          diagnostics: [
            {
              line: 0,
              message: "jsonl_tail_truncated: scanned the newest 4194304 bytes",
            },
          ],
        }),
        appendEvent: async () => undefined,
      },
    };

    const messages = await __testBuildModelMessagesWithRecentContext(
      context as never,
      "session-bounded-tail",
      [{ content: "stable system", promptCache: "cacheable" }],
      "current user",
      {
        role: "executor",
        provider: "test",
        model: "test-model",
        endpointProfile: "responses",
        reasoningSent: false,
        reasoningStatus: "off",
      },
    );
    const serialized = JSON.stringify(messages);

    expect(serialized).toContain("Transcript continuity notice");
    expect(serialized).toContain("recent bounded answer");
    expect(serialized).not.toContain("jsonl_tail_truncated");
  });

  it("does not add a bounded-tail notice when the event limit includes a usable boundary", async () => {
    const boundary = {
      type: "system_event",
      level: "info",
      message: `compact_projection:${JSON.stringify(
        makeCompactProjection("BOUNDARY_AT_EVENT_LIMIT"),
      )}`,
    };
    const events = [
      boundary,
      ...Array.from({ length: 9_998 }, (_, index) => ({
        type: "assistant_text_delta",
        text: `bounded answer ${index}`,
      })),
      { type: "user_message", text: "current user" },
    ];
    const context = {
      model: "test-model",
      cache: { history: [] },
      store: {
        readRecentTranscriptEvents: async () => ({ events, diagnostics: [] }),
        appendEvent: async () => undefined,
      },
    };

    const messages = await __testBuildModelMessagesWithRecentContext(
      context as never,
      "session-boundary-at-limit",
      [{ content: "stable system", promptCache: "cacheable" }],
      "current user",
      {
        role: "executor",
        provider: "test",
        model: "test-model",
        endpointProfile: "responses",
        reasoningSent: false,
        reasoningStatus: "off",
      },
    );
    const serialized = JSON.stringify(messages);

    expect(events).toHaveLength(10_000);
    expect(serialized).toContain("BOUNDARY_AT_EVENT_LIMIT");
    expect(serialized).not.toContain("Transcript continuity notice");
  });

  it("skips unusable compact records and stops at the latest usable boundary", async () => {
    const validBoundary = {
      type: "system_event",
      level: "info",
      message: `compact_projection:${JSON.stringify(
        makeCompactProjection("VALID_COMPACT_SUMMARY"),
      )}`,
    };
    const events = [
      { type: "user_message", text: "RAW_BEFORE_VALID" },
      validBoundary,
      { type: "user_message", text: "between valid and invalid" },
      { type: "system_event", level: "info", message: "compact_projection:{broken" },
      { type: "deep_compact_packet", packet: { summary: "invalid packet" } },
      { type: "assistant_text_delta", text: "tail after invalid boundaries" },
      { type: "user_message", text: "current user" },
    ];
    const context = {
      model: "test-model",
      cache: { history: [] },
      store: {
        readRecentTranscriptEvents: async (
          _sessionId: string,
          input: {
            limit: number;
            predicate?: (event: unknown) => boolean;
            stopPredicate?: (event: unknown) => boolean;
          },
        ) => {
          const selected: unknown[] = [];
          for (let index = events.length - 1; index >= 0; index -= 1) {
            const event = events[index]!;
            if (!input.predicate || input.predicate(event)) selected.push(event);
            if (input.stopPredicate?.(event) || selected.length >= input.limit) break;
          }
          return { events: selected.reverse() };
        },
        appendEvent: async () => undefined,
      },
    };

    const messages = await __testBuildModelMessagesWithRecentContext(
      context as never,
      "session-invalid-boundary",
      [{ content: "stable system", promptCache: "cacheable" }],
      "current user",
      {
        role: "executor",
        provider: "test",
        model: "test-model",
        endpointProfile: "responses",
        reasoningSent: false,
        reasoningStatus: "off",
      },
    );
    const serialized = JSON.stringify(messages);

    expect(serialized).toContain("VALID_COMPACT_SUMMARY");
    expect(serialized).toContain("between valid and invalid");
    expect(serialized).toContain("tail after invalid boundaries");
    expect(serialized).not.toContain("RAW_BEFORE_VALID");
  });

  it("strips legacy memory constraints from persisted compact projections", async () => {
    const projection = makeCompactProjection(
      "Linghun compact summary\nuser constraints OLD_DELETED_MEMORY",
      {
      boundaryId: "compact-memory-boundary",
      postCompactTargetChars: 160_000,
      restoreContext: makeCompactRestoreContext({
        userConstraints: ["OLD_DELETED_MEMORY"],
        memoryStatus: "1 accepted memories",
      }),
      },
    );
    const context = {
      model: "test-model",
      cache: { history: [] },
      memory: {
        accepted: [
          {
            id: "current-memory",
            scope: "user",
            status: "accepted",
            summary: "CURRENT_MEMORY",
            source: "test",
            sourceRefs: [],
            risk: "low",
            inferred: false,
            createdAt: new Date().toISOString(),
          },
        ],
      },
      store: {
        readRecentTranscriptEvents: async () => ({
          events: [
            {
              type: "system_event",
              level: "info",
              message: `compact_projection:${JSON.stringify(projection)}`,
            },
          ],
        }),
        appendEvent: async () => undefined,
      },
    };

    const messages = await __testBuildModelMessagesWithRecentContext(
      context as never,
      "session-compact-memory",
      "stable system",
      "current user",
      {
        role: "executor",
        provider: "test",
        model: "test-model",
        endpointProfile: "responses",
        reasoningSent: false,
        reasoningStatus: "off",
      },
    );
    const serialized = JSON.stringify(messages);

    expect(serialized).not.toContain("OLD_DELETED_MEMORY");
    expect(serialized).not.toContain("CURRENT_MEMORY");
  });

  it("cuts model history at a deep compact packet boundary", async () => {
    const context = {
      model: "test-model",
      cache: { history: [] },
      store: {
        readRecentTranscriptEvents: async () => ({
          events: [
            { type: "user_message", text: "RAW_OLD_DEEP_CONTEXT" },
            {
              type: "deep_compact_packet",
              packet: {
                id: "deep-boundary-test",
                kind: "deep",
                scope: "full transcript semantic compact",
                summary: "STABLE_DEEP_COMPACT_SUMMARY",
                preservedEvidenceRefs: ["ev-deep"],
                preservedFiles: ["src/deep.ts"],
                activeAgentsWorkflows: [],
                pendingItems: [],
                decisions: [],
                risks: [],
                createdAt: "2026-07-10T00:00:00.000Z",
                model: "test-model",
                provider: "test",
                trigger: "request",
                transcriptEventCount: 1,
              },
            },
            { type: "assistant_text_delta", text: "new deep-boundary answer" },
            { type: "user_message", text: "current user" },
          ],
        }),
        appendEvent: async () => undefined,
      },
    };

    const messages = await __testBuildModelMessagesWithRecentContext(
      context as never,
      "session-deep-boundary",
      [{ content: "stable system", promptCache: "cacheable" }],
      "current user",
      {
        role: "executor",
        provider: "test",
        model: "test-model",
        endpointProfile: "responses",
        reasoningSent: false,
        reasoningStatus: "off",
      },
    );
    const serialized = JSON.stringify(messages);

    expect(serialized).toContain("STABLE_DEEP_COMPACT_SUMMARY");
    expect(serialized).toContain("new deep-boundary answer");
    expect(serialized).not.toContain("RAW_OLD_DEEP_CONTEXT");
  });

  it("keeps an interrupted-turn hint on the append-only user message", async () => {
    const context = {
      model: "test-model",
      cache: { history: [] },
      store: {
        readRecentTranscriptEvents: async () => ({
          events: [
            { type: "user_message", text: "old task" },
            {
              type: "interrupt",
              status: "cancelled",
              message:
                "turn_interrupted: requestTurnId=turn-old; reason=user_interrupt; userMessageId=user-old",
            },
            { type: "user_message", text: "current user" },
          ],
        }),
        appendEvent: async () => undefined,
      },
    };

    const messages = await __testBuildModelMessagesWithRecentContext(
      context as never,
      "session-interrupted-boundary",
      [{ content: "stable system", promptCache: "cacheable" }],
      "current user",
      {
        role: "executor",
        provider: "test",
        model: "test-model",
        endpointProfile: "responses",
        reasoningSent: false,
        reasoningStatus: "off",
      },
    );

    expect(messages.filter((message) => message.role === "system")).toHaveLength(1);
    expect(messages.at(-1)).toMatchObject({ role: "user" });
    expect(messages.at(-1)?.content).toContain("current user");
    expect(messages.at(-1)?.content).toContain(
      "Previous foreground turn was interrupted (reason: user_interrupt). Treat this user message as the authoritative task.",
    );
  });

  it("rebuilds the same interrupted user tail as stable history on the next turn", async () => {
    let events: Array<Record<string, unknown>> = [
      { type: "user_message", text: "old task" },
      {
        type: "interrupt",
        message: "turn_interrupted: requestTurnId=turn-old; reason=user_interrupt; userMessageId=user-old",
      },
      { type: "user_message", text: "replacement task" },
    ];
    const context = {
      model: "test-model",
      cache: { history: [] },
      store: {
        readRecentTranscriptEvents: async () => ({ events }),
        appendEvent: async () => undefined,
      },
    };
    const runtime = {
      role: "executor" as const,
      provider: "test",
      model: "test-model",
      endpointProfile: "responses" as const,
      reasoningSent: false,
      reasoningStatus: "off" as const,
    };

    const first = await __testBuildModelMessagesWithRecentContext(
      context as never,
      "session-interrupt-prefix",
      "stable system",
      "replacement task",
      runtime,
    );
    events = [
      ...events,
      { type: "assistant_text_delta", text: "replacement answer" },
      { type: "user_message", text: "next task" },
    ];
    const second = await __testBuildModelMessagesWithRecentContext(
      context as never,
      "session-interrupt-prefix",
      "stable system",
      "next task",
      runtime,
    );

    expect(second.slice(0, first.length)).toEqual(first);
  });

  it("keeps legacy edit tool_result internals out of model-visible history", async () => {
    const context = {
      projectPath: await mkdtemp(join(tmpdir(), "linghun-model-history-")),
      model: "test-model",
      cache: { history: [] },
      evidence: [],
      store: {
        readRecentTranscriptEvents: async () => ({
          events: [
            {
              type: "tool_call_start",
              id: "call-edit",
              name: "Edit",
              input: { path: "sample.ts", oldText: "old", newText: "new" },
            },
            {
              type: "tool_result",
              toolUseId: "call-edit",
              toolName: "Edit",
              isError: false,
              evidenceId: "ev-edit",
              content: {
                text: "Edit 已完成：sample.ts",
                details: "INTERNAL_DETAILS_SHOULD_NOT_REACH_MODEL",
                data: {
                  operation: "Edit",
                  addedLines: 1,
                  removedLines: 1,
                  structuredPatch: { files: [{ path: "sample.ts", hunks: ["RAW_PATCH"] }] },
                  patchHunks: ["RAW_HUNK"],
                  afterHash: "hash-after",
                },
                changedFiles: ["sample.ts"],
              },
            },
          ],
        }),
        appendEvent: async () => undefined,
      },
    };

    const messages = await __testBuildModelMessagesWithRecentContext(
      context as never,
      "session-model-history",
      [{ content: "stable system", promptCache: "cacheable" }],
      "continue",
      {
        role: "executor",
        provider: "test",
        model: "test-model",
        endpointProfile: "responses",
        reasoningSent: false,
        reasoningStatus: "off",
      },
    );
    const serialized = JSON.stringify(messages);

    expect(serialized).toContain("Edit");
    expect(serialized).toContain("sample.ts");
    expect(serialized).not.toContain("structuredPatch");
    expect(serialized).not.toContain("patchHunks");
    expect(serialized).not.toContain("INTERNAL_DETAILS_SHOULD_NOT_REACH_MODEL");
    expect(serialized).not.toContain("hash-after");
  });

  it("keeps persisted tool_result previews out of model-visible history", async () => {
    const leakedPreview = "MODEL_HISTORY_PREVIEW_SHOULD_NOT_LEAK";
    const persisted = [
      "<persisted-tool-result>",
      "reason: single_result",
      "toolUseId: call-read",
      "artifactId: call-read-abc123",
      "artifactPath: .linghun/session/tool-results/session-preview/call-read-abc123.txt",
      "originalChars: 90000",
      "originalBytes: 90000",
      "sha256: abc123",
      "read: use /details output with the evidence id or read the artifact path if you need the full tool output.",
      "preview:",
      leakedPreview,
      "</persisted-tool-result>",
    ].join("\n");
    const context = {
      projectPath: await mkdtemp(join(tmpdir(), "linghun-model-history-preview-")),
      model: "test-model",
      cache: { history: [] },
      evidence: [],
      store: {
        readRecentTranscriptEvents: async () => ({
          events: [
            {
              type: "tool_call_start",
              id: "call-read",
              name: "Read",
              input: { path: "large.log" },
            },
            {
              type: "tool_result",
              toolUseId: "call-read",
              toolName: "Read",
              isError: false,
              evidenceId: "ev-read",
              content: persisted,
            },
          ],
        }),
        appendEvent: async () => undefined,
      },
    };

    const messages = await __testBuildModelMessagesWithRecentContext(
      context as never,
      "session-preview",
      [{ content: "stable system", promptCache: "cacheable" }],
      "continue",
      {
        role: "executor",
        provider: "test",
        model: "test-model",
        endpointProfile: "responses",
        reasoningSent: false,
        reasoningStatus: "off",
      },
    );
    const serialized = JSON.stringify(messages);

    expect(serialized).toContain("artifactPath");
    expect(serialized).toContain("omitted from model history");
    expect(serialized).not.toContain(leakedPreview);
  });

  it("strips newly budgeted large tool_result previews before provider history reuse", async () => {
    const leakedPreview = "NEW_BUDGET_PREVIEW_SHOULD_NOT_LEAK";
    const context = {
      projectPath: await mkdtemp(join(tmpdir(), "linghun-model-history-budget-")),
      model: "test-model",
      cache: { history: [] },
      evidence: [],
      store: {
        readRecentTranscriptEvents: async () => ({
          events: [
            {
              type: "tool_call_start",
              id: "call-bash",
              name: "Bash",
              input: { command: "large output" },
            },
            {
              type: "tool_result",
              toolUseId: "call-bash",
              toolName: "Bash",
              isError: false,
              evidenceId: "ev-bash",
              content: `${leakedPreview}\n${"x".repeat(70_000)}`,
            },
          ],
        }),
        appendEvent: async () => undefined,
      },
    };

    const messages = await __testBuildModelMessagesWithRecentContext(
      context as never,
      "session-budget-preview",
      [{ content: "stable system", promptCache: "cacheable" }],
      "continue",
      {
        role: "executor",
        provider: "test",
        model: "test-model",
        endpointProfile: "responses",
        reasoningSent: false,
        reasoningStatus: "off",
      },
    );
    const serialized = JSON.stringify(messages);

    expect(serialized).toContain("<persisted-tool-result>");
    expect(serialized).toContain("artifactPath");
    expect(serialized).toContain("omitted from model history");
    expect(serialized).not.toContain(leakedPreview);
  });

  it("does not rewrite earlier tool_result history when later results add pressure", async () => {
    const toolResult = "x".repeat(10_000);
    let events: Array<Record<string, unknown>> = Array.from({ length: 7 }, (_, index) => [
      {
        type: "tool_call_start",
        id: `call-${index}`,
        name: "Read",
        input: { path: `file-${index}.txt` },
      },
      {
        type: "tool_result",
        toolUseId: `call-${index}`,
        toolName: "Read",
        content: toolResult,
      },
    ]).flat();
    const context = {
      projectPath: await mkdtemp(join(tmpdir(), "linghun-model-history-pressure-")),
      model: "test-model",
      cache: { history: [] },
      evidence: [],
      store: {
        readRecentTranscriptEvents: async () => ({ events }),
        appendEvent: async () => undefined,
      },
    };
    const runtime = {
      role: "executor" as const,
      provider: "test",
      model: "test-model",
      endpointProfile: "responses" as const,
      reasoningSent: false,
      reasoningStatus: "off" as const,
    };

    const first = await __testBuildModelMessagesWithRecentContext(
      context as never,
      "session-tool-pressure-prefix",
      "stable system",
      "first user",
      runtime,
    );
    events = [
      ...events,
      { type: "user_message", text: "first user" },
      { type: "assistant_text_delta", text: "first answer" },
      ...Array.from({ length: 6 }, (_, offset) => {
        const index = offset + 7;
        return [
          {
            type: "tool_call_start",
            id: `call-${index}`,
            name: "Read",
            input: { path: `file-${index}.txt` },
          },
          {
            type: "tool_result",
            toolUseId: `call-${index}`,
            toolName: "Read",
            content: toolResult,
          },
        ];
      }).flat(),
    ];
    const second = await __testBuildModelMessagesWithRecentContext(
      context as never,
      "session-tool-pressure-prefix",
      "stable system",
      "second user",
      runtime,
    );

    expect(second.slice(0, first.length)).toEqual(first);
    expect(JSON.stringify(first)).not.toContain("<persisted-tool-result>");
  });
});

describe("responses prompt cache key", () => {
  it("keeps dynamic tool schema out of the responses prompt cache key", () => {
    const baseContext = makeNaturalInputContext() as never;
    const request = {
      endpointProfile: "responses" as const,
      promptCacheEnabled: true,
      model: "test-model",
      messages: [{ role: "user" as const, content: "hello" }],
      tools: [
        {
          name: "Read",
          description: "Read file",
          inputSchema: { type: "object", properties: { path: { type: "string" } } },
          source: "built-in",
        },
        {
          name: "mcp__search",
          description: "Search v1",
          inputSchema: { type: "object", properties: { q: { type: "string" } } },
          source: "mcp",
        },
      ],
    };

    const first = __testApplyPromptCacheKey(request as never, baseContext, "session-1");
    const dynamicChanged = __testApplyPromptCacheKey(
      {
        ...request,
        tools: [
          request.tools[0],
          {
            name: "mcp__search",
            description: "Search v2",
            inputSchema: { type: "object", properties: { query: { type: "string" } } },
            source: "mcp",
          },
        ],
      } as never,
      baseContext,
      "session-1",
    );
    const stableChanged = __testApplyPromptCacheKey(
      {
        ...request,
        tools: [
          {
            ...request.tools[0],
            description: "Read file v2",
          },
          request.tools[1],
        ],
      } as never,
      baseContext,
      "session-1",
    );

    expect(dynamicChanged.promptCacheKey).toBe(first.promptCacheKey);
    expect(stableChanged.promptCacheKey).not.toBe(first.promptCacheKey);
  });
});

describe("tool batch execution helpers", () => {
  it("separates failed tool results from required pre-analysis fallbacks", () => {
    const fallbackResult = {
      ok: true,
      evidenceId: "evidence-1",
      data: { fallback_required: true },
    } as never;

    expect(isToolBatchFailure({ ok: false, evidenceId: "evidence-1" } as never)).toBe(true);
    expect(isToolBatchFailure(fallbackResult)).toBe(false);
    expect(isToolBatchFallbackRequired(fallbackResult)).toBe(true);
    expect(isToolBatchFallbackRequired({ ok: true, evidenceId: "evidence-1" } as never)).toBe(false);
    expect(isToolBatchFailure({ ok: true, evidenceId: "evidence-1" } as never)).toBe(false);
  });

  it("separates real fallback tool progress from pre-analysis discovery or degradation", () => {
    const okResult = { ok: true, evidenceId: "evidence-1", data: { nodes: [] } } as never;
    const fallbackResult = { ok: true, evidenceId: "evidence-2", data: { fallback_required: true } } as never;

    expect(isRealFallbackToolProgress({ name: "SearchExtraTools", input: {} } as never, okResult)).toBe(false);
    expect(isRealFallbackToolProgress({ name: "pre_plan", input: {} } as never, okResult)).toBe(false);
    expect(isRealFallbackToolProgress({ name: "Grep", input: { pattern: "x" } } as never, okResult)).toBe(true);
    expect(isRealFallbackToolProgress({ name: "Read", input: { path: "packages/tui/src/a.ts" } } as never, okResult)).toBe(true);
    expect(
      isRealFallbackToolProgress(
        { name: "ExecuteExtraTool", input: { tool_name: "search_code", params: { project: "F-linghun" } } } as never,
        okResult,
      ),
    ).toBe(true);
    expect(
      isRealFallbackToolProgress(
        { name: "ExecuteExtraTool", input: { tool_name: "pre_plan", params: { task: "x" } } } as never,
        okResult,
      ),
    ).toBe(false);
    expect(isRealFallbackToolProgress({ name: "Grep", input: { pattern: "x" } } as never, fallbackResult)).toBe(false);
  });

  it("detects pre-engine direct and deferred tool calls for hard-cut fallback", () => {
    expect(isPreEngineToolCall({ name: "pre_plan", input: {} } as never)).toBe(true);
    expect(
      isPreEngineToolCall(
        { name: "ExecuteExtraTool", input: { tool_name: "pre_context", params: { symbol: "x" } } } as never,
      ),
    ).toBe(true);
    expect(
      isPreEngineToolCall(
        { name: "ExecuteExtraTool", input: { tool_name: "search_code", params: { query: "x" } } } as never,
      ),
    ).toBe(false);
    expect(isPreEngineToolCall({ name: "Read", input: { path: "x.ts" } } as never)).toBe(false);
  });

  it("creates pre fallback hard-cut skipped results as recovery-required signals", () => {
    const skipped = createPreFallbackHardCutSkippedToolResult(
      { id: "call-pre", name: "pre_plan", input: { task: "x" } } as never,
    );

    expect(skipped.ok).toBe(true);
    expect(skipped.data).toMatchObject({ skipped: true, reason: "pre_engine_fallback_hard_cut" });
    expect(isToolBatchFailure(skipped)).toBe(false);
    expect(isToolBatchFallbackRequired(skipped)).toBe(true);
  });

  it("creates strict pre-analysis fallback recovery reminders", () => {
    const first = createToolFallbackRecoveryReminder("en-US");
    const repeated = createToolFallbackRecoveryReminder("zh-CN", 1);

    expect(first).toContain("fallback_required");
    expect(first).toContain("MUST call at least one real workspace tool");
    expect(first).toContain("Do not produce a final natural-language answer");
    expect(first).toContain("pre_context/pre_plan/pre_impact/pre_verify");
    expect(repeated).toContain("已经进入 pre 降级恢复模式");
    expect(repeated).toContain("后续默认改用真实工作区工具");
    expect(repeated).toContain("下一轮回复必须至少调用一个真实工作区工具");
  });

  it("groups only bounded readonly tools into parallel execution batches", () => {
    const calls = [
      { id: "call-read", name: "Read", input: { path: "packages/tui/src/a.ts" } },
      { id: "call-grep", name: "Grep", input: { pattern: "x", path: "packages/tui/src" } },
      { id: "call-write", name: "Write", input: { path: "out.txt", content: "x" } },
      { id: "call-pre", name: "pre_context", input: { symbol: "run", path: "src/a.ts" } },
      { id: "call-glob", name: "Glob", input: { pattern: "*.ts" } },
      { id: "call-diff", name: "Diff", input: {} },
    ];

    expect(createToolExecutionBatches(calls as never)).toEqual([
      { mode: "parallel_readonly", toolCalls: calls.slice(0, 2) },
      { mode: "serial", toolCalls: [calls[2]] },
      { mode: "parallel_readonly", toolCalls: calls.slice(3, 5) },
      { mode: "serial", toolCalls: [calls[5]] },
    ]);
  });

  it("does not turn meta-scheduler tool ask into an empty local approval wait", async () => {
    const source = await readFile(new URL("./model-stream-runtime.ts", import.meta.url), "utf8");
    const shortCircuitStart = source.indexOf("if (orchestration.shouldStop || orchestration.shouldAsk)");
    const shortCircuitEnd = source.indexOf("const first = toolCalls[processedCount++]!", shortCircuitStart);
    const shortCircuit = source.slice(shortCircuitStart, shortCircuitEnd);

    expect(shortCircuit).toContain("createMetaOrchestrationSkippedToolResult");
    expect(shortCircuit).not.toContain("pendingApproval: orchestration.shouldAsk");
    expect(shortCircuit).not.toContain("context.pendingLocalApproval");
    expect(source).not.toContain("tool_batch_fail_fast");
  });

  it("keeps sensitive or outside Read calls out of parallel readonly batches", () => {
    expect(canRunToolCallInParallelReadonlyBatch({ name: "Read", input: { path: "src/index.ts" } })).toBe(true);
    expect(canRunToolCallInParallelReadonlyBatch({ name: "Read", input: { path: "../secret.txt" } })).toBe(false);
    expect(canRunToolCallInParallelReadonlyBatch({ name: "Read", input: { path: "C:/Users/me/key.txt" } })).toBe(false);
    expect(canRunToolCallInParallelReadonlyBatch({ name: "Read", input: { path: ".env" } })).toBe(false);
    expect(canRunToolCallInParallelReadonlyBatch({ name: "Bash", input: { command: "pwd" } })).toBe(false);
  });

  it("keeps readonly parallel batches bounded without a batch failure cutoff", () => {
    const calls = [
      { id: "call-read", name: "Read", input: { path: "packages/tui/src/a.ts" } },
      { id: "call-grep", name: "Grep", input: { pattern: "x", path: "packages/tui/src" } },
      { id: "call-glob", name: "Glob", input: { pattern: "*.ts" } },
    ];

    expect(createToolExecutionBatches(calls as never)).toEqual([
      { mode: "parallel_readonly", toolCalls: calls.slice(0, 2) },
      { mode: "serial", toolCalls: [calls[2]] },
    ]);
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

  it("continues after an incomplete tool round when the next assistant turn has no tool call", () => {
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
  it("treats structured claims as hints when visible text asserts a stronger result", () => {
    const result = evaluateAggregatedFinalAnswerGate(
      makeGateContext() as never,
      withClaims("测试已经通过。", [{ kind: "code_fact", phrase: "查看了代码" }]),
      false,
    );

    expect(result.status).toBe("needs_disclaimer");
    if (result.status === "needs_disclaimer") {
      expect(result.unsupportedKinds).toContain("test_claim");
    }
  });

  it("does not let an older request PASS support the current visible claim", () => {
    const context = {
      ...makeGateContext(),
      projectPath: "C:/repo",
      sessionId: "session-owner",
      currentRequestTurnId: "request-new",
      evidence: [
        makeEvidence({
          kind: "test_result",
          supportsClaims: ["verification_passed", "test_passed"],
          ownerScope: {
            ownerSessionId: "session-owner",
            requestTurnId: "request-old",
            cwd: "C:/repo",
          },
          data: {
            verificationScope: {
              ownerKey: "request:session-owner:request-old",
              cwd: "C:/repo",
              changedFiles: [],
              ownerSessionId: "session-owner",
              requestTurnId: "request-old",
            },
          },
        }),
      ],
    };

    expect(evaluateAggregatedFinalAnswerGate(context as never, "测试已经通过。", false).status)
      .toBe("needs_disclaimer");
    context.evidence[0]!.ownerScope!.requestTurnId = "request-new";
    const scope = (context.evidence[0]!.data as { verificationScope: { requestTurnId: string; ownerKey: string } })
      .verificationScope;
    scope.requestTurnId = "request-new";
    scope.ownerKey = "request:session-owner:request-new";
    expect(evaluateAggregatedFinalAnswerGate(context as never, "测试已经通过。", false).status)
      .toBe("passed");
  });

  it("keeps owner-scoped verification deterministic across 1000 request transitions", () => {
    const evidence = makeEvidence({
      kind: "test_result",
      supportsClaims: ["verification_passed", "test_passed"],
      ownerScope: {
        ownerSessionId: "session-pressure",
        requestTurnId: "request-current",
        cwd: "C:/repo",
      },
      data: {
        verificationScope: {
          ownerKey: "request:session-pressure:request-current",
          cwd: "C:/repo",
          changedFiles: [],
          ownerSessionId: "session-pressure",
          requestTurnId: "request-current",
        },
      },
    });
    const context = {
      ...makeGateContext(),
      projectPath: "C:/repo",
      sessionId: "session-pressure",
      currentRequestTurnId: "request-current",
      evidence: [evidence],
    };
    const scope = evidence.data as { verificationScope: { ownerKey: string; requestTurnId: string } };

    for (let index = 0; index < 1_000; index += 1) {
      const requestTurnId = index % 2 === 0 ? "request-current" : `request-stale-${index}`;
      evidence.ownerScope!.requestTurnId = requestTurnId;
      scope.verificationScope.requestTurnId = requestTurnId;
      scope.verificationScope.ownerKey = `request:session-pressure:${requestTurnId}`;
      expect(evaluateAggregatedFinalAnswerGate(context as never, "测试已经通过。", false).status)
        .toBe(index % 2 === 0 ? "passed" : "needs_disclaimer");
    }
  });

  it("does not turn negative or proposed work into success claims", () => {
    for (const text of [
      "测试未通过，需要继续修复。",
      "agent 未完成，建议执行下一条命令。",
      "Tests did not pass; we should run another command.",
    ]) {
      expect(evaluateAggregatedFinalAnswerGate(makeGateContext() as never, text, false).status)
        .toBe("passed");
    }
  });

  it("keeps an earlier success claim visible when later work is only proposed", () => {
    for (const text of [
      "测试已通过，建议再跑 build。",
      "Tests passed, but we should run build.",
    ]) {
      expect(evaluateAggregatedFinalAnswerGate(makeGateContext() as never, text, false).status)
        .toBe("needs_disclaimer");
    }
  });

  it("keeps a later success claim visible after an earlier proposal or failure clause", () => {
    for (const text of [
      "建议先观察，测试已通过。",
      "We should investigate, tests passed.",
      "测试未通过，修复后测试通过。",
    ]) {
      expect(evaluateAggregatedFinalAnswerGate(makeGateContext() as never, text, false).status)
        .toBe("needs_disclaimer");
    }
  });

  it("requires target evidence for every claim of the same kind", () => {
    const context = {
      ...makeGateContext(),
      evidence: [
        makeEvidence({
          kind: "file_read",
          summary: "Read packages/a.ts",
          source: "Read",
          ownerScope: { cwd: "C:/repo", targets: ["packages/a.ts"] },
        }),
      ],
    };
    const answer = withClaims("A 和 B 的代码事实如下。", [
      { kind: "code_fact", phrase: "packages/a.ts code fact" },
      { kind: "code_fact", phrase: "packages/b.ts code fact" },
    ]);

    expect(evaluateAggregatedFinalAnswerGate(context as never, answer, false).status)
      .toBe("needs_disclaimer");
  });

  it("requires evidence for every visible target and every visible match", () => {
    const context = {
      ...makeGateContext(),
      evidence: [
        makeEvidence({
          summary: "Edited packages/a.ts",
          source: "Edit",
          supportsClaims: ["file_written", "Edit"],
          ownerScope: { cwd: "C:/repo", targets: ["packages/a.ts"] },
        }),
      ],
    };

    for (const answer of [
      "修改 packages/a.ts 和 packages/b.ts 文件。",
      "修改 packages/a.ts 文件。修改 packages/b.ts 文件。",
    ]) {
      expect(evaluateAggregatedFinalAnswerGate(context as never, answer, false).status)
        .toBe("needs_disclaimer");
    }
  });

  it("does not satisfy a target with a path suffix or owner id prefix collision", () => {
    const fileContext = {
      ...makeGateContext(),
      evidence: [
        makeEvidence({
          summary: "Edited data.ts",
          source: "Edit",
          supportsClaims: ["file_written", "Edit"],
          ownerScope: { cwd: "C:/repo", targets: ["data.ts"] },
        }),
      ],
    };
    expect(evaluateAggregatedFinalAnswerGate(fileContext as never, "修改 a.ts 文件。", false).status)
      .toBe("needs_disclaimer");

    const agentContext = {
      ...makeGateContext(),
      evidence: [
        makeEvidence({
          summary: "agent-10 completed",
          source: "agent:agent-10",
          supportsClaims: ["agent_execution", "agent_terminal_status"],
          ownerScope: { cwd: "C:/repo", ownerAgentId: "agent-10" },
        }),
      ],
    };
    expect(evaluateAggregatedFinalAnswerGate(agentContext as never, "agent-1 已完成。", false).status)
      .toBe("needs_disclaimer");
  });

  it("matches the same path across absolute relative slash and case normalization", () => {
    const context = {
      ...makeGateContext(),
      evidence: [
        makeEvidence({
          summary: "Edited packages/a.ts",
          source: "Edit",
          supportsClaims: ["file_written", "Edit"],
          ownerScope: { cwd: "C:/repo", targets: ["C:\\repo\\packages\\A.ts"] },
        }),
      ],
    };

    expect(evaluateAggregatedFinalAnswerGate(context as never, "修改 packages/a.ts 文件。", false).status)
      .toBe("passed");
  });

  it("rejects the same relative suffix from a different repository root", () => {
    const context = {
      ...makeGateContext(),
      projectPath: "C:/repo",
      sessionId: "session-cwd",
      currentRequestTurnId: "request-cwd",
      evidence: [
        makeEvidence({
          summary: "Edited D:/other/packages/a.ts",
          source: "Edit",
          supportsClaims: ["file_written", "Edit"],
          ownerScope: {
            ownerSessionId: "session-cwd",
            requestTurnId: "request-cwd",
            cwd: "D:/other",
            targets: ["D:/other/packages/a.ts"],
          },
        }),
      ],
    };

    expect(evaluateAggregatedFinalAnswerGate(context as never, "修改 packages/a.ts 文件。", false).status)
      .toBe("needs_disclaimer");
  });

  it("rejects verification evidence produced under a different repository cwd", () => {
    const context = {
      ...makeGateContext(),
      projectPath: "C:/repo",
      sessionId: "session-verify-cwd",
      currentRequestTurnId: "request-verify-cwd",
      currentRequestMentionedFiles: [],
      evidence: [
        makeEvidence({
          kind: "test_result",
          supportsClaims: ["verification_passed", "test_passed"],
          ownerScope: {
            ownerSessionId: "session-verify-cwd",
            requestTurnId: "request-verify-cwd",
            cwd: "D:/other",
          },
          data: {
            verificationScope: {
              ownerKey: "request:session-verify-cwd:request-verify-cwd",
              cwd: "D:/other",
              changedFiles: [],
              ownerSessionId: "session-verify-cwd",
              requestTurnId: "request-verify-cwd",
            },
          },
        }),
      ],
    };

    expect(evaluateAggregatedFinalAnswerGate(context as never, "测试已经通过。", false).status)
      .toBe("needs_disclaimer");
  });

  it("rejects session-scoped verification evidence without the current request owner", () => {
    const evidence = makeEvidence({
      kind: "test_result",
      supportsClaims: ["verification_passed", "test_passed"],
      ownerScope: {
        ownerSessionId: "session-request-required",
        cwd: "C:/repo",
      },
      data: {
        verificationScope: {
          ownerKey: "session:session-request-required",
          cwd: "C:/repo",
          changedFiles: [],
          ownerSessionId: "session-request-required",
        },
      },
    });
    const context = {
      ...makeGateContext(),
      projectPath: "C:/repo",
      sessionId: "session-request-required",
      currentRequestTurnId: "request-current",
      currentRequestMentionedFiles: [],
      evidence: [evidence],
    };

    expect(evaluateAggregatedFinalAnswerGate(context as never, "测试已经通过。", false).status)
      .toBe("needs_disclaimer");
    const scope = (evidence.data as { verificationScope: { requestTurnId?: string } }).verificationScope;
    scope.requestTurnId = "request-current";
    expect(evaluateAggregatedFinalAnswerGate(context as never, "测试已经通过。", false).status)
      .toBe("needs_disclaimer");
    evidence.ownerScope!.requestTurnId = "request-current";
    expect(evaluateAggregatedFinalAnswerGate(context as never, "测试已经通过。", false).status)
      .toBe("passed");
  });

  it("downgrades a structured completion claim for an actively blocked workflow", () => {
    const context = {
      ...makeGateContext(),
      evidence: [
        makeEvidence({
          source: "workflow-execution",
          summary: "Workflow completed before becoming blocked",
          supportsClaims: ["workflow_execution", "action_executed", "workflow_terminal_status"],
        }),
      ],
      lastMetaSchedulerDecision: {
        shouldStopForBlockedRuntime: true,
        policyDecision: { engineeringSignal: undefined },
      },
    };

    const result = evaluateAggregatedFinalAnswerGate(
      context as never,
      withClaims("Workflow 已完成。", [
        { kind: "workflow_status_claim", phrase: "Workflow 已完成" },
      ]),
    );

    expect(result.status).toBe("needs_disclaimer");
    if (result.status !== "needs_disclaimer") return;
    expect(result.runtimeVerdict?.unsupportedKinds).toContain("workflow_status_claim");
    expect(result.unsupportedKinds).toContain("workflow_status_claim");
  });

  it("does not downgrade unrelated explanatory text for a blocked workflow", () => {
    const result = evaluateAggregatedFinalAnswerGate(
      {
        ...makeGateContext(),
        lastMetaSchedulerDecision: {
          shouldStopForBlockedRuntime: true,
          policyDecision: { engineeringSignal: undefined },
        },
      } as never,
      "当前可以继续解释其他问题。",
    );

    expect(result.status).toBe("passed");
  });

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
    expect(answer).toContain("我已确认目前检查覆盖到的部分");
    expect(answer).toContain("验证或测试证据");
    expect(answer).not.toContain("证据范围");
    expect(answer).not.toContain("完整闭环");
    expect(answer).not.toContain("匹配证据");
    expect(answer).not.toContain("尚未被匹配证据支撑");
    expect(answer).not.toContain("任务状态");
    expect(answer).not.toContain("下一步");
    expect(answer).not.toContain("完成或验证声明");
    expect(answer).not.toContain("completion_pass");
    expect(answer).not.toContain("如果继续");
  });

  it("routes the legacy downgraded final answer helper through the evidence-backed boundary", () => {
    const result = evaluateAggregatedFinalAnswerGate(
      makeGateContext() as never,
      withClaims("测试通过。", [{ kind: "completion_pass", phrase: "测试通过" }]),
      false,
    );

    expect(result.status).toBe("needs_disclaimer");
    if (result.status !== "needs_disclaimer") return;
    const answer = buildAggregatedDowngradedFinalAnswer(result, "zh-CN");
    expect(answer).toContain("我已确认目前检查覆盖到的部分");
    expect(answer).not.toContain("任务状态");
    expect(answer).not.toContain("当前证据");
    expect(answer).not.toContain("下一步");
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
    expect(answer).toContain("我已确认目前检查覆盖到的部分");
    expect(answer).toContain("已有 1 条记录");
    expect(answer).toContain("验证记录");
    expect(answer).not.toContain("证据范围");
    expect(answer).not.toContain("完整闭环");
    expect(answer).not.toContain("匹配证据");
    expect(answer).not.toContain("尚未被匹配证据支撑");
    expect(answer).not.toContain("任务状态：最终回答等待证据确认");
    expect(answer).not.toContain("下一步");
    expect(answer).not.toContain("verification=");
    expect(answer).not.toContain("focused tests passed");
    expect(answer).not.toContain("command_output:");
  });

  it("rewrites claim alignment instead of using the old visible fallback when fresh test_passed evidence exists", async () => {
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
    const source = await readFile(new URL("./model-stream-runtime.ts", import.meta.url), "utf8");
    expect(source).not.toContain("buildFinalGateClaimAlignmentFallback");
    expect(source).not.toContain("我只能确认已记录检查覆盖到的验证范围");
  });

  it("rewrites claim alignment instead of showing the checklist when fresh verification_passed evidence exists", () => {
    const context = {
      ...makeGateContext(),
      evidence: [
        makeEvidence({
          kind: "command_output",
          source: "Bash",
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
    expect(visibleFallback).toContain("我已确认目前检查覆盖到的部分");
    expect(visibleFallback).not.toContain("证据范围");
    expect(visibleFallback).not.toContain("任务状态");
    expect(visibleFallback).not.toContain("下一步");
  });

  it("adds a final evidence preflight prompt before no-tool final generation", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-final-preflight-"));
    const { context } = makeDispatcherContext(projectPath);
    Object.assign(context, {
      config: defaultConfig,
      providerBreaker: createProviderCircuitBreakerState(),
      currentRequestTurnId: "request-current-preflight",
      evidence: [
        makeEvidence({
          kind: "command_output",
          summary: "current focused tests passed",
          supportsClaims: ["test_passed"],
          ownerScope: {
            ownerSessionId: "session-final-gate-dispatch",
            requestTurnId: "request-current-preflight",
            cwd: projectPath,
          },
          data: {
            verificationScope: {
              ownerKey: "request:session-final-gate-dispatch:request-current-preflight",
              ownerSessionId: "session-final-gate-dispatch",
              requestTurnId: "request-current-preflight",
              cwd: projectPath,
              changedFiles: [],
            },
          },
        }),
        makeEvidence({
          kind: "command_output",
          summary: "stale full tests passed",
          supportsClaims: ["test_passed"],
          ownerScope: {
            ownerSessionId: "session-final-gate-dispatch",
            requestTurnId: "request-stale-preflight",
            cwd: projectPath,
          },
          data: {
            verificationScope: {
              ownerKey: "request:session-final-gate-dispatch:request-stale-preflight",
              ownerSessionId: "session-final-gate-dispatch",
              requestTurnId: "request-stale-preflight",
              cwd: projectPath,
              changedFiles: [],
            },
          },
        }),
      ],
      cache: { history: [], deepCompact: undefined },
    });
    const calls: { count: number; requests: Array<{ messages?: unknown }> } = {
      count: 0,
      requests: [],
    };

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
            { type: "assistant_text_delta", text: "验证通过。" },
            { type: "message_stop", chunkCount: 1, hadUsage: false, finishReason: "stop" },
          ],
        ],
        calls,
      ),
      "session-final-preflight",
      new MemoryOutput(),
      new AbortController().signal,
    );

    expect(finalText).toContain("验证通过");
    expect(JSON.stringify(calls.requests[0]?.messages ?? [])).toContain("最终回答证据前置检查");
    expect(JSON.stringify(calls.requests[0]?.messages ?? [])).toContain("已有 1 条记录");
    expect(JSON.stringify(calls.requests[0]?.messages ?? [])).not.toContain("已有 2 条记录");
    expect((context as { requestActivityPhase?: string }).requestActivityPhase).toBeUndefined();
  });

  it("reports raw protocol from the no-tool final stream as an execution failure", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-no-tool-raw-protocol-"));
    const { context, events } = makeDispatcherContext(projectPath);
    Object.assign(context, {
      config: defaultConfig,
      providerBreaker: createProviderCircuitBreakerState(),
      cache: { history: [], deepCompact: undefined },
    });
    const blocks: Array<{ id: string; fullText?: string; summary?: string }> = [];
    const output = createShellBlockOutputForTest(context, blocks as never);
    const calls = { count: 0 };
    const rawProtocol =
      '<tool_use id="toolu_final_raw" name="Write"><input>{"path":"report.md","content":"fake"}</input></tool_use>';

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
            { type: "assistant_text_delta", text: rawProtocol },
            { type: "message_stop", chunkCount: 1, hadUsage: false, finishReason: "stop" },
          ],
        ],
        calls,
      ),
      "session-no-tool-raw-protocol",
      output,
      new AbortController().signal,
    );

    expect(calls.count).toBe(1);
    expect(finalText).toContain("执行失败");
    expect(finalText).not.toContain("部分完成");
    expect(finalText).toContain("没有执行任何非结构化工具请求");
    expect(finalText).not.toContain(rawProtocol);
    expect(JSON.stringify(blocks)).toContain("执行失败");
    expect(JSON.stringify(events)).not.toContain('"type":"tool_result"');
  });

  it("no-tool final deterministically downgrades unsupported completion claims", async () => {
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
        ],
        calls,
      ),
      "session-no-tool-final",
      output,
      new AbortController().signal,
    );

    const serializedBlocks = JSON.stringify(blocks);
    expect(calls.count).toBe(1);
    expect(finalText).toContain("本请求未能证实");
    expect(finalText).not.toContain("如果继续");
    expect(finalText).not.toContain("LinghunFinalAnswerClaims");
    expect(serializedBlocks).toContain("本请求未能证实");
    expect(serializedBlocks).not.toContain(rawDraft);
    expect((context as { lastFullOutput?: string }).lastFullOutput ?? "").not.toContain(rawDraft);
  });

  it("does not start a second model rewrite for unsupported final claims", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-stale-final-rewrite-"));
    const { context, events } = makeDispatcherContext(projectPath);
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
    const controller = new AbortController();
    const turnA = beginForegroundRequestTurn(context, "user-a");
    const ownerSessionId = (context as unknown as TuiContext).sessionId ?? "session-stale-final-rewrite";
    (context as unknown as TuiContext).evidence[0].data = {
      verificationScope: {
        ownerKey: `request:${ownerSessionId}:${turnA}`,
        cwd: projectPath,
        changedFiles: [],
        ownerSessionId,
        requestTurnId: turnA,
      },
    };
    let streamCalls = 0;
    const rawDraft = withClaims("已完成。", [{ kind: "completion_claim", phrase: "已完成" }]);
    const gateway = {
      async *stream() {
        streamCalls += 1;
        yield { type: "assistant_text_delta", text: rawDraft } as const;
        yield { type: "message_stop", chunkCount: 1, hadUsage: false, finishReason: "stop" } as const;
      },
      async countMessagesTokensWithAPI() {
        return { source: "unavailable", reason: "test" } as const;
      },
    } as unknown as ModelGateway;

    const finalText = await __testStreamFinalModelAnswerWithoutTools(
      {
        messages: [{ role: "user", content: "请给最终结论" }],
        provider: "test",
        model: "test-model",
        endpointProfile: "chat_completions",
        reasoningSent: false,
        requestTurnId: turnA,
        abortSignal: controller.signal,
      },
      context,
      gateway,
      "session-stale-final-rewrite",
      output,
      controller.signal,
    );

    expect(streamCalls).toBe(1);
    expect(finalText).toContain("本请求未能证实");
    expect(JSON.stringify(blocks)).not.toContain(rawDraft);
    expect(events.some(({ event }) => (event as { type?: string }).type === "assistant_message")).toBe(false);
  }, 15_000);

  it("clears active provider failure as soon as a later stream recovers", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "linghun-provider-recovered-"));
    const { context, events } = makeDispatcherContext(projectPath);
    Object.assign(context, {
      config: defaultConfig,
      providerBreaker: createProviderCircuitBreakerState(),
      lastProviderFailure: {
        code: "PROVIDER_STREAM_ERROR",
        kind: "gateway",
        provider: "test",
        model: "test-model",
        endpointProfile: "chat_completions",
        summary: "provider failure: gateway",
        evidenceId: "provider-failure-1",
        createdAt: new Date().toISOString(),
      },
      cache: { history: [], deepCompact: undefined },
    });
    const blocks: Array<{ id: string; fullText?: string; summary?: string }> = [];
    const output = createShellBlockOutputForTest(context, blocks as never);
    const calls = { count: 0 };

    const finalText = await __testStreamFinalModelAnswerWithoutTools(
      {
        messages: [{ role: "user", content: "继续" }],
        provider: "test",
        model: "test-model",
        endpointProfile: "chat_completions",
        reasoningSent: false,
      },
      context,
      gatewayByTurn(
        [
          [
            { type: "assistant_text_delta", text: "网关已恢复，继续输出。" },
            { type: "message_stop", chunkCount: 1, hadUsage: false, finishReason: "stop" },
          ],
        ],
        calls,
      ),
      "session-provider-recovered",
      output,
      new AbortController().signal,
    );

    expect(finalText).toContain("网关已恢复");
    expect((context as { lastProviderFailure?: unknown }).lastProviderFailure).toBeUndefined();
    expect(JSON.stringify(events)).toContain("provider failure recovered");
  });

  it("no-tool final downgrades unsupported git claims without auto-probing", async () => {
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
        ],
        calls,
      ),
      "session-no-tool-git-final",
      output,
      new AbortController().signal,
    );

    const eventsText = JSON.stringify(events);
    expect(calls.count).toBe(1);
    expect(eventsText).not.toContain("GitStatusInspect");
    expect(finalText).toContain("本请求未能证实");
    expect(finalText).not.toContain("git_operation");
    expect(JSON.stringify(blocks)).not.toContain(rawDraft);
  });

  it("plans completion gaps through minimal verification immediately", () => {
    const context = {
      ...makeGateContext(),
      projectPath: "/test",
      currentRequestTurnId: "turn-artifact-search",
      permissionMode: "default",
      language: "zh-CN",
    };
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
    expect(plan.reason).toBe("completion_gap_verification_requires_permission");
    expect(plan.directive).toContain("Bash");
    expect(plan.directive).toContain("pendingLocalApproval");
    expect(plan.evidenceAction).toMatchObject({
      toolName: "Bash",
      input: { level: "typecheck" },
      strategy: "minimal_bash_verification",
    });
  });

  it("does not schedule the same broad completion verification twice", () => {
    const context = {
      ...makeGateContext(),
      projectPath: "/test",
      currentRequestTurnId: "turn-completion-repeat",
      permissionMode: "full-access",
      language: "zh-CN",
    };
    const result = evaluateAggregatedFinalAnswerGate(
      context as never,
      withClaims("已完成。", [{ kind: "completion_claim", phrase: "已完成" }]),
      false,
    );

    expect(result.status).toBe("needs_disclaimer");
    if (result.status !== "needs_disclaimer") return;
    const first = planFinalGateEvidenceGapAction({
      result,
      context: context as never,
      userText: "继续修复",
    });
    const state = __testCaptureFinalGapProgressState(
      result,
      context as never,
      first.evidenceAction,
    );
    state.attemptedCommandFingerprints.add(state.commandFingerprint!);
    const plan = planFinalGateEvidenceGapAction({
      result,
      context: context as never,
      userText: "继续修复",
      evidenceActionRetryCount: 1,
      attemptedEvidenceActionFingerprints: state.attemptedCommandFingerprints,
    });
    expect(plan.action).toBe("downgrade_only");
    expect(plan.reason).toBe("final_gate_no_new_evidence_path");
  });

  it("does not turn a historical question into current-request verification", () => {
    const context = {
      ...makeGateContext(),
      permissionMode: "full-access",
      language: "zh-CN",
      lastMetaSchedulerDecision: {
        policyDecision: { taskKind: "chat" },
      },
    };
    const result = evaluateAggregatedFinalAnswerGate(
      context as never,
      withClaims("上一轮已完成。", [{ kind: "completion_claim", phrase: "已完成" }]),
      false,
    );

    expect(result.status).toBe("needs_disclaimer");
    if (result.status !== "needs_disclaimer") return;
    const plan = planFinalGateEvidenceGapAction({
      result,
      context: context as never,
      userText: "上一轮完成了吗？",
    });
    expect(plan.action).toBe("downgrade_only");
    expect(plan.reason).toBe("non_executable_request_evidence_gap");
  });

  it.each(["engineering_full_suite_unverified", "engineering_test_timeout"])(
    "selects test verification for %s",
    (unsupportedKind) => {
      const plan = planFinalGateEvidenceGapAction({
        result: {
          status: "needs_disclaimer",
          unsupportedKinds: [unsupportedKind],
        },
        context: {
          ...makeGateContext(),
          permissionMode: "full-access",
          language: "zh-CN",
        } as never,
        userText: "继续当前修复",
      });

      expect(plan.action).toBe("verification_request");
      expect(plan.evidenceAction).toMatchObject({
        toolName: "RunVerification",
        input: { level: "test" },
      });
    },
  );

  it("chases test evidence for a tests-passed completion claim", () => {
    const context = { ...makeGateContext(), permissionMode: "full-access", language: "zh-CN" };
    const result = evaluateAggregatedFinalAnswerGate(
      context as never,
      withClaims("测试通过。", [{ kind: "completion_pass", phrase: "测试通过" }]),
      false,
    );

    expect(result.status).toBe("needs_disclaimer");
    if (result.status !== "needs_disclaimer") return;
    const plan = planFinalGateEvidenceGapAction({
      result,
      context: context as never,
      userText: "继续修复",
      evidenceActionRetryCount: 1,
    });
    expect(plan.action).toBe("verification_request");
    expect(plan.evidenceAction).toMatchObject({
      toolName: "RunVerification",
      input: { level: "test" },
    });
  });

  it("keeps gathering verification evidence after an attempt that did not prove pass", () => {
    const context = {
      ...makeGateContext(),
      permissionMode: "full-access",
      language: "zh-CN",
      evidence: [
        makeEvidence({
          summary: "RunVerification: Verification PASS",
          supportsClaims: ["verification_result", "verification_attempted"],
        }),
      ],
    };
    const result = evaluateAggregatedFinalAnswerGate(
      context as never,
      withClaims("已验证。", [{ kind: "verification_claim", phrase: "已验证" }]),
      false,
    );

    expect(result.status).toBe("needs_disclaimer");
    if (result.status !== "needs_disclaimer") return;
    const plan = planFinalGateEvidenceGapAction({
      result,
      context: context as never,
      userText: "继续修复",
    });
    expect(plan.action).toBe("verification_request");
    expect(plan.reason).toBe("verification_allowed_by_mode");
    expect(plan.evidenceAction).toMatchObject({
      toolName: "RunVerification",
      input: { level: "typecheck" },
    });
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
    expect(answer).toContain("我已确认目前检查覆盖到的部分");
    expect(answer).not.toContain("证据范围");
    expect(answer).not.toContain("完整闭环");
    expect(answer).not.toContain("匹配证据");
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

  it("accepts binary preflight artifact evidence for the requested target", () => {
    const context = {
      ...makeGateContext(),
      projectPath: "C:/repo",
      sessionId: "session-binary",
      currentRequestTurnId: "request-binary",
      lastMetaSchedulerDecision: {
        policyDecision: {
          engineeringSignal: {
            profile: "binary_or_artifact",
            artifactTargets: ["dist/app.bin"],
          },
        },
      },
      evidence: [
        makeEvidence({
          data: { binaryPreflight: { path: "dist/app.bin" } },
          ownerScope: {
            ownerSessionId: "session-binary",
            requestTurnId: "request-binary",
            cwd: "C:/repo",
          },
        }),
      ],
    };

    const result = evaluateAggregatedFinalAnswerGate(
      context as never,
      "dist/app.bin 产物存在。",
      false,
    );

    expect(result.status).toBe("passed");
  });

  it("does not turn an ordinary code-fact question into a verification retry", async () => {
    const { context, events } = await makeSendMessageContext();
    let attempts = 0;
    const gateway = {
      async *stream() {
        attempts += 1;
        yield {
          type: "assistant_text_delta",
          text: attempts === 1
            ? withClaims("测试已经通过。", [{ kind: "completion_pass", phrase: "测试已经通过" }])
            : "本轮没有运行测试，因此不能确认测试结果。",
        } as const;
        yield {
          type: "message_stop",
          chunkCount: 1,
          hadUsage: false,
          finishReason: "stop",
        } as const;
      },
      async countMessagesTokensWithAPI() {
        return { source: "unavailable", reason: "test" } as const;
      },
    } as unknown as ModelGateway;

    await __testSendMessage("检查当前代码并准确汇报", context, gateway, new MemoryOutput());

    expect(attempts).toBe(1);
    expect(JSON.stringify(events)).not.toContain("final_answer_gap_returned_to_model_loop");
    expect(JSON.stringify(events)).not.toContain("final_answer_gap_action dispatch");
  });

  it("closes a shrinking final gap identically in main and continuation loops", async () => {
    const runCase = async (entry: "main" | "continuation") => {
      const { context, events } = await makeSendMessageContext();
      context.permissionMode = "full-access";
      await writeFile(join(context.projectPath, "fact.ts"), "export const answer = () => 42;\n", "utf8");
      let rounds = 0;
      const gateway = {
        async *stream() {
          rounds += 1;
          if (rounds === 2) {
            yield {
              type: "tool_use",
              id: `${entry}-read-fact`,
              name: "Read",
              input: { path: "fact.ts" },
            } as const;
            yield {
              type: "message_stop",
              chunkCount: 1,
              hadUsage: false,
              finishReason: "tool_use",
            } as const;
            return;
          }
          yield {
            type: "assistant_text_delta",
            text: withClaims("fact.ts 中的 answer 函数返回 42。", [
              { kind: "code_fact", phrase: "fact.ts 中的 answer 函数返回 42" },
            ]),
          } as const;
          yield {
            type: "message_stop",
            chunkCount: 1,
            hadUsage: false,
            finishReason: "stop",
          } as const;
        },
        async countMessagesTokensWithAPI() {
          return { source: "unavailable", reason: "test" } as const;
        },
      } as unknown as ModelGateway;
      const output = new MemoryOutput();
      const userText = "完成修复并汇报 fact.ts 的结果";

      if (entry === "main") {
        await __testSendMessage(userText, context, gateway, output);
      } else {
        await continueModelAfterToolResults(
          {
            messages: [{ role: "user", content: userText }],
            provider: "deepseek",
            model: "deepseek-chat",
            endpointProfile: "chat_completions",
            reasoningSent: false,
            originalUserText: userText,
          },
          context,
          gateway,
          output,
        );
      }

      const finalText = events
        .filter(
          (event): event is { type: string; text: string } =>
            (event as { type?: string }).type === "assistant_text_delta" &&
            typeof (event as { text?: unknown }).text === "string",
        )
        .at(-1)?.text ?? "";
      return { rounds, finalText, output: output.text, events };
    };

    for (const entry of ["main", "continuation"] as const) {
      const result = await runCase(entry);
      expect(result.rounds).toBe(5);
      expect(result.finalText).toContain("answer 函数返回 42");
      expect(result.output).toContain("Read(fact.ts)");
      expect(result.output).toContain("ReadSnippets");
      expect(result.finalText).not.toMatch(/PARTIAL|部分完成|如果继续|round.?limit|轮次上限/iu);
      expect(JSON.stringify(result.events)).toContain("final_answer_gap_returned_to_model_loop");
    }
  }, 30_000);

  it("auto-executes an ignored final-gap directive through the existing executor", async () => {
    const runCase = async (entry: "main" | "continuation") => {
      const { context, events } = await makeSendMessageContext();
      context.permissionMode = "full-access";
      await writeFile(join(context.projectPath, "ignored.ts"), "export const value = 42;\n", "utf8");
      let rounds = 0;
      const gateway = {
        async *stream() {
          rounds += 1;
          if (rounds > 6) throw new Error("final-gap directive auto execution did not converge");
          yield {
            type: "assistant_text_delta",
            text: withClaims("ignored.ts 导出 value 42。", [
              { kind: "code_fact", phrase: "ignored.ts 已完成修复" },
            ]),
          } as const;
          yield {
            type: "message_stop",
            chunkCount: 1,
            hadUsage: false,
            finishReason: "stop",
          } as const;
        },
        async countMessagesTokensWithAPI() {
          return { source: "unavailable", reason: "test" } as const;
        },
      } as unknown as ModelGateway;
      const output = new MemoryOutput();
      const userText = "完成 ignored.ts 修复并验证";

      if (entry === "main") {
        await __testSendMessage(userText, context, gateway, output);
      } else {
        await continueModelAfterToolResults(
          {
            messages: [{ role: "user", content: userText }],
            provider: "deepseek",
            model: "deepseek-chat",
            endpointProfile: "chat_completions",
            reasoningSent: false,
            originalUserText: userText,
          },
          context,
          gateway,
          output,
        );
      }

      const finalText = events
        .filter(
          (event): event is { type: string; text: string } =>
            (event as { type?: string }).type === "assistant_text_delta" &&
            typeof (event as { text?: unknown }).text === "string",
        )
        .at(-1)?.text ?? "";
      return { rounds, finalText, output: output.text, serializedEvents: JSON.stringify(events) };
    };

    for (const entry of ["main", "continuation"] as const) {
      const result = await runCase(entry);
      expect(result.rounds).toBe(5);
      expect(result.finalText).toContain("ignored.ts 导出 value 42");
      expect(result.output).not.toContain("所有可用且不重复的真实补证路径均已尝试");
      expect(result.output).toContain("ReadSnippets");
      expect(result.finalText).not.toMatch(/PARTIAL|部分完成|如果继续|round.?limit|轮次上限/iu);
      expect(result.serializedEvents).toContain("final_answer_gap_auto_execute");
      expect(result.serializedEvents).toContain("tool_call_start");
      expect(result.serializedEvents).toContain("tool_result");
    }
  }, 30_000);

  it.each(["main", "continuation"] as const)(
    "does not commit a synthetic final-gap result after owner replacement in the %s loop",
    async (entry) => {
      const { context, events } = await makeSendMessageContext();
      context.permissionMode = "full-access";
      await writeFile(join(context.projectPath, "owner.ts"), "export const owner = true;\n", "utf8");
      const appendEvent = context.store.appendEvent.bind(context.store);
      context.store.appendEvent = async (sessionId, event, commitGuard) => {
        await appendEvent(sessionId, event, commitGuard);
        if (
          event.type === "tool_call_start" &&
          event.id.startsWith("final-gate-evidence-")
        ) {
          context.currentRequestTurnId = "replacement-owner";
          context.activeAbortController?.abort("user_interrupt");
        }
      };
      let rounds = 0;
      const gateway = {
        async *stream() {
          rounds += 1;
          if (rounds > 4) throw new Error("stale synthetic action continued after owner replacement");
          yield {
            type: "assistant_text_delta",
            text: withClaims("owner.ts 导出 owner。", [
              { kind: "code_fact", phrase: "owner.ts 导出 owner" },
            ]),
          } as const;
          yield { type: "message_stop", chunkCount: 1, hadUsage: false, finishReason: "stop" } as const;
        },
        async countMessagesTokensWithAPI() {
          return { source: "unavailable", reason: "test" } as const;
        },
      } as unknown as ModelGateway;
      const output = new MemoryOutput();
      const userText = "确认 owner.ts 的导出";

      if (entry === "main") {
        await __testSendMessage(userText, context, gateway, output);
      } else {
        await continueModelAfterToolResults(
          {
            messages: [{ role: "user", content: userText }],
            provider: "deepseek",
            model: "deepseek-chat",
            endpointProfile: "chat_completions",
            reasoningSent: false,
            originalUserText: userText,
          },
          context,
          gateway,
          output,
        );
      }

      const syntheticStarts = events.filter(
        (event): event is { type: "tool_call_start"; id: string } =>
          typeof event === "object" &&
          event !== null &&
          (event as { type?: unknown }).type === "tool_call_start" &&
          typeof (event as { id?: unknown }).id === "string" &&
          (event as { id: string }).id.startsWith("final-gate-evidence-"),
      );
      expect(syntheticStarts).toHaveLength(1);
      const syntheticId = syntheticStarts[0]!.id;
      expect(
        events.some(
          (event) =>
            typeof event === "object" &&
            event !== null &&
            (event as { type?: unknown }).type === "tool_result" &&
            (event as { toolUseId?: unknown }).toolUseId === syntheticId,
        ),
      ).toBe(false);
      expect(context.evidence.some((record) => record.toolUseId === syntheticId)).toBe(false);
    },
  );

  it("aborts only the latest running verification for the current request owner", async () => {
    const { context } = await makeSendMessageContext();
    context.permissionMode = "full-access";
    await writeFile(
      join(context.projectPath, "package.json"),
      JSON.stringify({ private: true, scripts: { typecheck: "node -e \"process.exit(0)\"" } }),
      "utf8",
    );
    const sessionController = new AbortController();
    const olderOwnerController = new AbortController();
    const latestOwnerController = new AbortController();
    let rounds = 0;
    const gateway = {
      async *stream() {
        rounds += 1;
        if (rounds === 1) {
          const requestTurnId = context.currentRequestTurnId!;
          const ownerKey = `request:${context.sessionId}:${requestTurnId}`;
          context.backgroundTasks.push(
            {
              id: "session-running",
              kind: "verification",
              ownerSessionId: context.sessionId,
              title: "session verification",
              status: "running",
              startedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              heartbeatIntervalMs: 30_000,
              staleAfterMs: 120_000,
              hasOutput: false,
              userVisibleSummary: "session running",
            },
            {
              id: "owner-running-older",
              kind: "verification",
              ownerSessionId: context.sessionId,
              requestTurnId,
              title: "older owner verification",
              status: "running",
              startedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              heartbeatIntervalMs: 30_000,
              staleAfterMs: 120_000,
              hasOutput: false,
              userVisibleSummary: "older owner running",
            },
            {
              id: "owner-running-latest",
              kind: "verification",
              ownerSessionId: context.sessionId,
              requestTurnId,
              title: "latest owner verification",
              status: "running",
              startedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              heartbeatIntervalMs: 30_000,
              staleAfterMs: 120_000,
              hasOutput: false,
              userVisibleSummary: "latest owner running",
            },
          );
          context.activeVerificationAbortControllers = new Map([
            ["session-running", sessionController],
            ["owner-running-older", olderOwnerController],
            ["owner-running-latest", latestOwnerController],
          ]);
          context.latestVerificationRunIds = new Map([[ownerKey, "owner-running-latest"]]);
        }
        yield {
          type: "assistant_text_delta",
          text: withClaims("类型检查已通过。", [
            { kind: "verification_claim", phrase: "类型检查已通过" },
          ]),
        } as const;
        yield { type: "message_stop", chunkCount: 1, hadUsage: false, finishReason: "stop" } as const;
      },
      async countMessagesTokensWithAPI() {
        return { source: "unavailable", reason: "test" } as const;
      },
    } as unknown as ModelGateway;

    await __testSendMessage("验证当前类型检查", context, gateway, new MemoryOutput());

    expect(sessionController.signal.aborted).toBe(false);
    expect(olderOwnerController.signal.aborted).toBe(false);
    expect(latestOwnerController.signal.aborted).toBe(true);
  }, 30_000);

  it("keeps a running verification through the synthetic default-mode Bash permission boundary", async () => {
    const { context, events } = await makeSendMessageContext();
    await writeFile(
      join(context.projectPath, "package.json"),
      JSON.stringify({ private: true, scripts: { typecheck: "node -e \"process.exit(0)\"" } }),
      "utf8",
    );
    const latestOwnerController = new AbortController();
    const originalCall = builtInTools.Bash.call;
    const execute = vi.fn(async () => ({ text: "must not run", data: { exitCode: 0 } }));
    builtInTools.Bash.call = execute as typeof originalCall;
    let rounds = 0;
    const gateway = {
      async *stream() {
        rounds += 1;
        if (rounds === 1) {
          const requestTurnId = context.currentRequestTurnId!;
          const ownerKey = `request:${context.sessionId}:${requestTurnId}`;
          context.backgroundTasks.push({
            id: "default-owner-running-latest",
            kind: "verification",
            ownerSessionId: context.sessionId,
            requestTurnId,
            title: "latest owner verification",
            status: "running",
            startedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            heartbeatIntervalMs: 30_000,
            staleAfterMs: 120_000,
            hasOutput: false,
            userVisibleSummary: "latest owner running",
          });
          context.activeVerificationAbortControllers = new Map([
            ["default-owner-running-latest", latestOwnerController],
          ]);
          context.latestVerificationRunIds = new Map([
            [ownerKey, "default-owner-running-latest"],
          ]);
        }
        yield {
          type: "assistant_text_delta",
          text: withClaims("类型检查已通过。", [
            { kind: "verification_claim", phrase: "类型检查已通过" },
          ]),
        } as const;
        yield { type: "message_stop", chunkCount: 1, hadUsage: false, finishReason: "stop" } as const;
      },
      async countMessagesTokensWithAPI() {
        return { source: "unavailable", reason: "test" } as const;
      },
    } as unknown as ModelGateway;
    context.modelGateway = gateway;

    try {
      await __testSendMessage("验证当前类型检查", context, gateway, new MemoryOutput());
      const approval = context.pendingLocalApproval;
      expect(approval).toMatchObject({ kind: "model_tool_use", toolName: "Bash" });
      if (!approval || approval.kind !== "model_tool_use" || !approval.continuation) {
        throw new Error("expected synthetic Bash approval continuation");
      }
      expect(approval.toolCall.id).toMatch(/^final-gate-evidence-/u);
      expect(approval.continuation.finalGapProgressState?.attemptedCommandFingerprints.size).toBe(0);
      expect(latestOwnerController.signal.aborted).toBe(false);

      await cancelPendingInteraction(context, new MemoryOutput(), "Esc");

      expect(latestOwnerController.signal.aborted).toBe(false);
      expect(execute).not.toHaveBeenCalled();
      expect(approval.continuation.finalGapProgressState?.externalBlockReason).toBe(
        "user_cancelled",
      );
      const syntheticEvidence = context.evidence.filter(
        (record) => record.toolUseId === approval.toolCall.id,
      );
      expect(
        syntheticEvidence.some((record) => record.supportsClaims.includes("verification_passed")),
      ).toBe(false);
      expect(
        events.some(
          (event) =>
            typeof event === "object" &&
            event !== null &&
            (event as { type?: unknown }).type === "verification_start",
        ),
      ).toBe(false);
    } finally {
      builtInTools.Bash.call = originalCall;
    }
  }, 30_000);

  it("keeps a running verifier when synthetic default-mode Bash is denied", async () => {
    const { context, events } = await makeSendMessageContext();
    await writeFile(
      join(context.projectPath, "package.json"),
      JSON.stringify({ private: true, scripts: { typecheck: "node -e \"process.exit(0)\"" } }),
      "utf8",
    );
    context.permissions.rules.push({
      id: "deny-synthetic-final-gap-bash",
      effect: "deny",
      toolName: "Bash",
    });
    const latestOwnerController = new AbortController();
    const originalCall = builtInTools.Bash.call;
    const execute = vi.fn(async () => ({ text: "must not run", data: { exitCode: 0 } }));
    builtInTools.Bash.call = execute as typeof originalCall;
    let rounds = 0;
    const gateway = {
      async *stream() {
        rounds += 1;
        if (rounds === 1) {
          const requestTurnId = context.currentRequestTurnId!;
          const ownerKey = `request:${context.sessionId}:${requestTurnId}`;
          context.backgroundTasks.push({
            id: "denied-owner-running-latest",
            kind: "verification",
            ownerSessionId: context.sessionId,
            requestTurnId,
            title: "latest owner verification",
            status: "running",
            startedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            heartbeatIntervalMs: 30_000,
            staleAfterMs: 120_000,
            hasOutput: false,
            userVisibleSummary: "latest owner running",
          });
          context.activeVerificationAbortControllers = new Map([
            ["denied-owner-running-latest", latestOwnerController],
          ]);
          context.latestVerificationRunIds = new Map([
            [ownerKey, "denied-owner-running-latest"],
          ]);
        }
        yield {
          type: "assistant_text_delta",
          text: withClaims("类型检查已通过。", [
            { kind: "verification_claim", phrase: "类型检查已通过" },
          ]),
        } as const;
        yield { type: "message_stop", chunkCount: 1, hadUsage: false, finishReason: "stop" } as const;
      },
      async countMessagesTokensWithAPI() {
        return { source: "unavailable", reason: "test" } as const;
      },
    } as unknown as ModelGateway;

    try {
      await __testSendMessage("验证当前类型检查", context, gateway, new MemoryOutput());

      expect(latestOwnerController.signal.aborted).toBe(false);
      expect(context.pendingLocalApproval).toBeUndefined();
      expect(execute).not.toHaveBeenCalled();
      const serializedEvents = JSON.stringify(events);
      expect(serializedEvents).toContain('"decision":"deny"');
      expect(serializedEvents).toContain("permission deny");
      expect(serializedEvents).not.toContain('"type":"verification_start"');
      expect(
        context.evidence.some((record) =>
          record.supportsClaims.includes("verification_passed")
        ),
      ).toBe(false);
    } finally {
      builtInTools.Bash.call = originalCall;
    }
  }, 30_000);

  it.each(["main", "continuation"] as const)(
    "bounds an ignored default verification directive when %s has no executable level",
    async (entry) => {
      const { context } = await makeSendMessageContext();
      await writeFile(join(context.projectPath, "package.json"), JSON.stringify({ private: true }), "utf8");
      let rounds = 0;
      const gateway = {
        async *stream() {
          rounds += 1;
          if (rounds > 4) throw new Error("missing verification command looped to wall clock");
          yield {
            type: "assistant_text_delta",
            text: withClaims("类型检查已通过。", [
              { kind: "verification_claim", phrase: "类型检查已通过" },
            ]),
          } as const;
          yield { type: "message_stop", chunkCount: 1, hadUsage: false, finishReason: "stop" } as const;
        },
        async countMessagesTokensWithAPI() {
          return { source: "unavailable", reason: "test" } as const;
        },
      } as unknown as ModelGateway;
      const output = new MemoryOutput();
      const userText = "验证当前类型检查";

      if (entry === "main") {
        await __testSendMessage(userText, context, gateway, output);
      } else {
        await continueModelAfterToolResults(
          {
            messages: [{ role: "user", content: userText }],
            provider: "deepseek",
            model: "deepseek-chat",
            endpointProfile: "chat_completions",
            reasoningSent: false,
            originalUserText: userText,
          },
          context,
          gateway,
          output,
        );
      }

      expect(rounds).toBe(2);
      expect(output.text).toContain("我已确认目前检查覆盖到的部分");
      expect(output.text).toContain("本请求未能证实");
      expect(output.text).not.toContain("执行失败");
      expect(output.text).not.toContain("所有可用且不重复的真实补证路径均已尝试");
    },
  );

  it("switches from a repeated Read to SourcePack and completes in both loops", async () => {
    const runCase = async (
      entry: "main" | "continuation",
      schedulerDecision?: TuiContext["lastMetaSchedulerDecision"],
    ) => {
      const { context } = await makeSendMessageContext();
      context.permissionMode = "full-access";
      if (schedulerDecision) context.lastMetaSchedulerDecision = schedulerDecision;
      await writeFile(join(context.projectPath, "repeat.txt"), "same result\n", "utf8");
      let rounds = 0;
      const gateway = {
        async *stream() {
          rounds += 1;
          if (rounds <= 2) {
            yield {
              type: "tool_use",
              id: `${entry}-read-${rounds}`,
              name: "Read",
              input: { path: "repeat.txt", offset: rounds },
            } as const;
          } else if (rounds === 3) {
            yield {
              type: "tool_use",
              id: `${entry}-source-pack`,
              name: "SourcePack",
              input: { query: "same result", limit: 2 },
            } as const;
          } else {
            yield { type: "assistant_text_delta", text: "repeat.txt 包含 same result。" } as const;
          }
          yield {
            type: "message_stop",
            chunkCount: 1,
            hadUsage: false,
            finishReason: rounds <= 3 ? "tool_use" : "stop",
          } as const;
        },
        async countMessagesTokensWithAPI() {
          return { source: "unavailable", reason: "test" } as const;
        },
      } as unknown as ModelGateway;
      const output = new MemoryOutput();
      const userText = "检查 repeat.txt 并据实回答";

      if (entry === "main") {
        await __testSendMessage(userText, context, gateway, output);
      } else {
        await continueModelAfterToolResults(
          {
            messages: [{ role: "user", content: userText }],
            provider: "deepseek",
            model: "deepseek-chat",
            endpointProfile: "chat_completions",
            reasoningSent: false,
            originalUserText: userText,
          },
          context,
          gateway,
          output,
        );
      }
      return {
        rounds,
        output: output.text,
        schedulerDecision: context.lastMetaSchedulerDecision,
      };
    };

    const main = await runCase("main");
    const continuation = await runCase("continuation", main.schedulerDecision);
    expect(main.rounds).toBe(continuation.rounds);
    for (const result of [main, continuation]) {
      expect(result.rounds).toBe(4);
      expect(result.output).toContain("SourcePack");
      expect(result.output).toContain("repeat.txt 包含 same result");
      expect(result.output).not.toMatch(/PARTIAL|部分完成|如果继续|round.?limit|轮次上限/iu);
    }
  }, 30_000);

  it.each(["main", "continuation"] as const)(
    "allows focused FAIL then Edit then same-level PASS in the %s loop",
    async (entry) => {
      const { context, events } = await makeSendMessageContext();
      context.permissionMode = "full-access";
      await writeFile(
        join(context.projectPath, "package.json"),
        JSON.stringify({ private: true, scripts: { test: "node focused-check.cjs" } }),
        "utf8",
      );
      await writeFile(join(context.projectPath, "focused-check.cjs"), "process.exit(1);\n", "utf8");
      let rounds = 0;
      const gateway = {
        async *stream() {
          rounds += 1;
          if (rounds === 2) {
            yield {
              type: "tool_use",
              id: `${entry}-verify-${rounds}`,
              name: "RunVerification",
              input: { level: "test" },
            } as const;
          } else if (rounds === 3) {
            yield {
              type: "tool_use",
              id: `${entry}-read-check`,
              name: "Read",
              input: { path: "focused-check.cjs" },
            } as const;
          } else if (rounds === 4) {
            yield {
              type: "tool_use",
              id: `${entry}-edit-check`,
              name: "Edit",
              input: {
                path: "focused-check.cjs",
                oldText: "process.exit(1);",
                newText: "process.exit(0);",
              },
            } as const;
          } else {
            yield {
              type: "assistant_text_delta",
              text: withClaims("测试已通过。", [
                { kind: "completion_pass", phrase: "测试已通过" },
              ]),
            } as const;
          }
          yield {
            type: "message_stop",
            chunkCount: 1,
            hadUsage: false,
            finishReason: [2, 3, 4].includes(rounds) ? "tool_use" : "stop",
          } as const;
        },
        async countMessagesTokensWithAPI() {
          return { source: "unavailable", reason: "test" } as const;
        },
      } as unknown as ModelGateway;
      const output = new MemoryOutput();
      const userText = "修复 focused check 并验证";

      if (entry === "main") {
        await __testSendMessage(userText, context, gateway, output);
      } else {
        await continueModelAfterToolResults(
          {
            messages: [{ role: "user", content: userText }],
            provider: "deepseek",
            model: "deepseek-chat",
            endpointProfile: "chat_completions",
            reasoningSent: false,
            originalUserText: userText,
          },
          context,
          gateway,
          output,
        );
      }

      expect(rounds).toBeLessThanOrEqual(8);
      expect(
        await readFile(join(context.projectPath, "focused-check.cjs"), "utf8"),
        output.text,
      ).toContain("process.exit(0)");
      const serializedEvents = JSON.stringify(events);
      expect(serializedEvents).toContain("Verification FAIL");
      expect(serializedEvents).toContain("Verification PASS");
      expect(serializedEvents).toContain("final_answer_gap_auto_execute");
      expect(serializedEvents).not.toMatch(/PARTIAL|部分完成|如果继续|round.?limit|轮次上限/iu);
    },
    60_000,
  );

  it("keeps a mixed duplicate and fresh readonly batch running in both loops", async () => {
    const runCase = async (entry: "main" | "continuation") => {
      const { context, events } = await makeSendMessageContext();
      context.permissionMode = "full-access";
      await writeFile(join(context.projectPath, "repeat-a.txt"), "same result\n", "utf8");
      await writeFile(join(context.projectPath, "repeat-b.txt"), "fresh result\n", "utf8");
      let rounds = 0;
      const gateway = {
        async *stream() {
          rounds += 1;
          if (rounds === 1) {
            yield { type: "tool_use", id: `${entry}-seed-a`, name: "Read", input: { path: "repeat-a.txt" } } as const;
            yield { type: "message_stop", chunkCount: 1, hadUsage: false, finishReason: "tool_use" } as const;
            return;
          }
          if (rounds === 2) {
            yield { type: "tool_use", id: `${entry}-repeat-a`, name: "Read", input: { path: "repeat-a.txt" } } as const;
            yield { type: "tool_use", id: `${entry}-fresh-b`, name: "Read", input: { path: "repeat-b.txt" } } as const;
            yield { type: "message_stop", chunkCount: 2, hadUsage: false, finishReason: "tool_use" } as const;
            return;
          }
          yield { type: "assistant_text_delta", text: "已读取两条不同证据。" } as const;
          yield { type: "message_stop", chunkCount: 1, hadUsage: false, finishReason: "stop" } as const;
        },
        async countMessagesTokensWithAPI() {
          return { source: "unavailable", reason: "test" } as const;
        },
      } as unknown as ModelGateway;
      const output = new MemoryOutput();

      if (entry === "main") {
        await __testSendMessage("读取两份证据并回答", context, gateway, output);
      } else {
        await continueModelAfterToolResults(
          {
            messages: [{ role: "user", content: "读取两份证据并回答" }],
            provider: "deepseek",
            model: "deepseek-chat",
            endpointProfile: "chat_completions",
            reasoningSent: false,
            originalUserText: "读取两份证据并回答",
          },
          context,
          gateway,
          output,
        );
      }

      expect(rounds).toBe(3);
      expect(output.text).toContain("repeat-b.txt");
      expect(JSON.stringify(events)).not.toContain("repeated_readonly_evidence_path_stopped");
    };

    await runCase("main");
    await runCase("continuation");
  }, 30_000);

  it("keeps claim-alignment rewrite reachable after evidence_recorded and in continuation", async () => {
    const source = await readFile(new URL("./model-stream-runtime.ts", import.meta.url), "utf8");
    expect(source).not.toContain("if (!finalAnswerClaimRetried && assistantText)");
    expect(source).toContain("final_answer_claim_alignment_rewrite attempt=");
    expect(source).toContain("final_answer_claim_alignment_rewrite continuation=yes");
    expect(source).toContain("final_answer_claim_alignment_rewrite final_safety=yes");
    expect(source).toContain("final_answer_claim_alignment_rewrite continuation_final_safety=yes");
    expect(source).not.toContain("final_answer_gap_action dispatch");
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
    expect(plan.directive).toContain("只读/plan 模式");
    expect(plan.directive).toContain("请求授权");
    expect(plan.evidenceAction).toBeUndefined();
  });

  it("does not block automatic verification when the user only says not to modify", () => {
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

    expect(plan.action).toBe("verification_request");
    expect(plan.directive).toContain("RunVerification");
    expect(plan.evidenceAction?.toolName).toBe("RunVerification");
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
    expect(plan.directive).toContain("类型检查");
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
    expect(plan.directive).toContain("Read, ReadSnippets, SourcePack, Grep, Glob");
    expect(plan.directive).toContain("不要运行 Bash");
    expect(plan.evidenceAction?.toolName).toBe("SourcePack");
  });

  it("keeps artifact readonly evidence available when the user only forbids tests", () => {
    const plan = planFinalGateEvidenceGapAction({
      result: {
        status: "needs_disclaimer",
        unsupportedKinds: ["file_change_claim"],
      },
      context: { ...makeGateContext(), permissionMode: "default", language: "zh-CN" } as never,
      userText: "不要跑测试，但可以 Read/Grep 看源码",
    });

    expect(plan.action).toBe("readonly_check");
    expect(plan.evidenceAction?.toolName).toBe("SourcePack");
  });

  it("plans artifact gaps from changed files before broad globbing", () => {
    const context = {
      ...makeGateContext(),
      permissionMode: "default",
      language: "zh-CN",
      tools: { changedFiles: ["reports/final-audit.md"] },
      recentlyMentionedFiles: [],
    };
    const plan = planFinalGateEvidenceGapAction({
      result: {
        status: "needs_disclaimer",
        unsupportedKinds: ["engineering_missing_artifact"],
      },
      context: context as never,
      userText: "继续确认产物",
    });

    expect(plan.action).toBe("readonly_check");
    expect(plan.evidenceAction).toMatchObject({
      toolName: "Read",
      input: { path: "reports/final-audit.md" },
      strategy: "artifact_readonly_check",
    });
  });

  it("continues artifact evidence search with grep after SourcePack executes", () => {
    const result = {
      status: "needs_disclaimer" as const,
      unsupportedKinds: ["engineering_missing_artifact"],
    };
    const context = {
      ...makeGateContext(),
      projectPath: "/test",
      currentRequestTurnId: "turn-artifact-search",
      permissionMode: "default",
      language: "zh-CN",
    };
    const first = planFinalGateEvidenceGapAction({
      result,
      context: context as never,
      userText: "继续确认产物",
    });
    const state = __testCaptureFinalGapProgressState(result, context as never, first.evidenceAction);
    state.attemptedCommandFingerprints.add(state.commandFingerprint!);
    const plan = planFinalGateEvidenceGapAction({
      result: {
        status: "needs_disclaimer",
        unsupportedKinds: ["engineering_missing_artifact"],
      },
      context: context as never,
      userText: "继续确认产物",
      attemptedEvidenceActionFingerprints: state.attemptedCommandFingerprints,
    });

    expect(plan.action).toBe("readonly_check");
    expect(plan.evidenceAction).toMatchObject({
      toolName: "Grep",
      strategy: "artifact_readonly_check",
    });
  });

  it("stops artifact recovery only after each distinct readonly path was tried", () => {
    const result = {
      status: "needs_disclaimer" as const,
      unsupportedKinds: ["engineering_missing_artifact"],
    };
    const context = {
      ...makeGateContext(),
      projectPath: "/test",
      currentRequestTurnId: "turn-artifact-exhaustion",
      permissionMode: "default",
      language: "zh-CN",
    };
    const first = planFinalGateEvidenceGapAction({
      result,
      context: context as never,
      userText: "继续确认产物",
    });
    const firstState = __testCaptureFinalGapProgressState(result, context as never, first.evidenceAction);
    firstState.attemptedCommandFingerprints.add(firstState.commandFingerprint!);
    const second = planFinalGateEvidenceGapAction({
      result,
      context: context as never,
      userText: "继续确认产物",
      attemptedEvidenceActionFingerprints: firstState.attemptedCommandFingerprints,
    });
    const secondState = __testCaptureFinalGapProgressState(
      result,
      context as never,
      second.evidenceAction,
      firstState,
    );
    secondState.attemptedCommandFingerprints.add(secondState.commandFingerprint!);
    const third = planFinalGateEvidenceGapAction({
      result,
      context: context as never,
      userText: "继续确认产物",
      attemptedEvidenceActionFingerprints: secondState.attemptedCommandFingerprints,
    });
    const thirdState = __testCaptureFinalGapProgressState(
      result,
      context as never,
      third.evidenceAction,
      secondState,
    );
    thirdState.attemptedCommandFingerprints.add(thirdState.commandFingerprint!);
    const plan = planFinalGateEvidenceGapAction({
      result,
      context: context as never,
      userText: "继续确认产物",
      attemptedEvidenceActionFingerprints: thirdState.attemptedCommandFingerprints,
    });

    expect(first.evidenceAction?.toolName).toBe("SourcePack");
    expect(second.evidenceAction?.toolName).toBe("Grep");
    expect(third.evidenceAction?.toolName).toBe("Glob");
    expect(plan.action).toBe("downgrade_only");
    expect(plan.reason).toBe("final_gate_no_new_evidence_path");
  });

  it.each(["running", "failed", "cancelled", "timeout", "stale"] as const)(
    "keeps current-scope verification runnable after a %s verification task",
    (status) => {
    const plan = planFinalGateEvidenceGapAction({
      result: {
        status: "needs_disclaimer",
        unsupportedKinds: ["verification_claim"],
      },
      context: {
        ...makeGateContext(),
        permissionMode: "full-access",
        language: "zh-CN",
        currentRequestTurnId: "request-stale-verification",
        sessionId: "session-stale-verification",
        backgroundTasks: [
          {
            id: "verification-stale",
            kind: "verification",
            ownerSessionId: "session-stale-verification",
            requestTurnId: "request-stale-verification",
            title: "Verification Runner",
            status,
            startedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            heartbeatIntervalMs: 30_000,
            staleAfterMs: 120_000,
            hasOutput: false,
            userVisibleSummary: `${status}/resumable`,
          },
        ],
      } as never,
      userText: "继续输出当前结论",
    });

      expect(plan.action).toBe("verification_request");
      expect(plan.evidenceAction).toMatchObject({
        toolName: "RunVerification",
        input: { level: "typecheck" },
      });
    },
  );

  it("only accepts verification evidence owned by the current request scope", () => {
    const context = {
      ...makeGateContext(),
      projectPath: "C:/repo",
      currentRequestTurnId: "request-b",
      currentRequestChangedFiles: ["packages/tui/src/a.ts"],
      sessionId: "session-scope",
      tools: { changedFiles: ["packages/tui/src/a.ts"] },
      evidence: [
        makeEvidence({
          kind: "test_result",
          supportsClaims: ["verification_passed", "typecheck_passed"],
          ownerScope: {
            ownerSessionId: "session-scope",
            requestTurnId: "request-a",
            cwd: "C:/repo/packages/tui",
          },
          data: {
            verificationScope: {
              ownerKey: "request:session-scope:request-a",
              cwd: "C:/repo/packages/tui",
              changedFiles: ["packages/tui/src/a.ts"],
              ownerSessionId: "session-scope",
              requestTurnId: "request-a",
            },
          },
        }),
      ],
    } as unknown as TuiContext;
    const claim = withClaims("类型检查已通过。", [
      { kind: "verification_claim", phrase: "类型检查已通过" },
    ]);

    expect(evaluateAggregatedFinalAnswerGate(context, claim, false).status).toBe(
      "needs_disclaimer",
    );
    const scope = (context.evidence[0]?.data as { verificationScope: { requestTurnId: string } })
      .verificationScope;
    scope.requestTurnId = "request-b";
    context.evidence[0]!.ownerScope!.requestTurnId = "request-b";
    expect(evaluateAggregatedFinalAnswerGate(context, claim, false).status).toBe("passed");
    context.currentRequestChangedFiles?.push("packages/tui/src/b.ts");
    expect(evaluateAggregatedFinalAnswerGate(context, claim, false).status).toBe(
      "needs_disclaimer",
    );
  });

  it("does not let an older terminal verification suppress current scoped verification", () => {
    const plan = planFinalGateEvidenceGapAction({
      result: {
        status: "needs_disclaimer",
        unsupportedKinds: ["verification_claim"],
      },
      context: {
        ...makeGateContext(),
        permissionMode: "full-access",
        language: "zh-CN",
        currentRequestTurnId: "request-new",
        sessionId: "session-old-timeout",
        backgroundTasks: [
          {
            id: "verification-old-timeout",
            kind: "verification",
            ownerSessionId: "session-old-timeout",
            requestTurnId: "request-old",
            title: "Verification Runner",
            status: "timeout",
            startedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            heartbeatIntervalMs: 30_000,
            staleAfterMs: 120_000,
            hasOutput: false,
            userVisibleSummary: "old timeout",
          },
        ],
      } as never,
      userText: "验证当前改动",
    });

    expect(plan.action).toBe("verification_request");
  });

  it("ignores an older request timeout for the next follow-up", () => {
    const context = {
      currentRequestTurnId: "request-new",
      sessionId: "session-timeout",
      tools: { changedFiles: ["packages/tui/src/a.ts"] },
      lastVerification: {
        id: "verification-old-timeout",
        status: "timeout",
        summary: "TIMEOUT",
        commands: [],
        unverified: ["timeout"],
        risk: [],
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        durationMs: 1,
        nextAction: "resume",
        scope: {
          ownerKey: "request:session-timeout:request-old",
          cwd: "C:/repo/packages/tui",
          changedFiles: ["packages/tui/src/a.ts"],
          ownerSessionId: "session-timeout",
          requestTurnId: "request-old",
        },
      },
    } as unknown as TuiContext;

    expect(__testCurrentVerificationReportForRequest(context)).toBeUndefined();
  });

  it("ignores a session-level verification report while a request owner is active", () => {
    const context = {
      currentRequestTurnId: "request-new",
      sessionId: "session-timeout",
      tools: { changedFiles: [] },
      lastVerification: {
        id: "verification-session-timeout",
        status: "timeout",
        summary: "TIMEOUT",
        commands: [],
        unverified: ["timeout"],
        risk: [],
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        durationMs: 1,
        nextAction: "resume",
        scope: {
          ownerKey: "session:session-timeout",
          cwd: "C:/repo",
          changedFiles: [],
          ownerSessionId: "session-timeout",
        },
      },
    } as unknown as TuiContext;

    expect(__testCurrentVerificationReportForRequest(context)).toBeUndefined();
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
      strategy: "artifact_readonly_check",
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

  it("does not schedule the same git inspection twice", () => {
    const result = {
      status: "needs_disclaimer" as const,
      unsupportedKinds: ["git_operation"],
    };
    const context = {
      ...makeGateContext(),
      projectPath: "/test",
      currentRequestTurnId: "turn-git-repeat",
      permissionMode: "default",
      language: "zh-CN",
    };
    const first = planFinalGateEvidenceGapAction({
      result,
      context: context as never,
      userText: "确认 git 状态",
    });
    const state = __testCaptureFinalGapProgressState(result, context as never, first.evidenceAction);
    state.attemptedCommandFingerprints.add(state.commandFingerprint!);
    const plan = planFinalGateEvidenceGapAction({
      result,
      context: context as never,
      userText: "确认 git 状态",
      attemptedEvidenceActionFingerprints: state.attemptedCommandFingerprints,
    });

    expect(plan.action).toBe("downgrade_only");
    expect(plan.reason).toBe("final_gate_no_new_evidence_path");
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

describe("api token count diagnostics", () => {
  it("does not wait for token count before preserving cache history", async () => {
    let resolveCount: ((value: { source: "api"; inputTokens: number }) => void) | undefined;
    const countStarted: string[] = [];
    const gateway = {
      countMessagesTokensWithAPI: async (provider: string) => {
        countStarted.push(provider);
        return await new Promise<{ source: "api"; inputTokens: number }>((resolve) => {
          resolveCount = resolve;
        });
      },
    } as unknown as ModelGateway;
    const context = {
      currentRequestTurnId: "turn-current",
      cache: { history: [{ provider: "kept", createdAt: "before" }] },
    } as never;

    __testScheduleApiTokenCountDiagnostics({
      context,
      gateway,
      runtime: { provider: "test", model: "model" },
      messages: [{ role: "user", content: "hello" }],
      signal: new AbortController().signal,
      requestTurnId: "turn-current",
    });

    expect(countStarted).toEqual(["test"]);
    expect((context as { cache: { history: unknown[] }; lastApiTokenCount?: unknown }).cache.history).toEqual([
      { provider: "kept", createdAt: "before" },
    ]);
    expect((context as { lastApiTokenCount?: unknown }).lastApiTokenCount).toBeUndefined();

    resolveCount?.({ source: "api", inputTokens: 7 });
    await vi.waitFor(() => {
      expect((context as { lastApiTokenCount?: { source?: string; inputTokens?: number } }).lastApiTokenCount).toMatchObject({
        source: "api",
        inputTokens: 7,
      });
    });

    expect((context as { cache: { history: unknown[] } }).cache.history).toEqual([
      { provider: "kept", createdAt: "before" },
    ]);
  });

  it("does not let a late final-answer token count overwrite a newer runtime context", async () => {
    let resolveCount: ((value: { source: "api"; inputTokens: number }) => void) | undefined;
    const gateway = {
      countMessagesTokensWithAPI: async () =>
        await new Promise<{ source: "api"; inputTokens: number }>((resolve) => {
          resolveCount = resolve;
        }),
    } as unknown as ModelGateway;
    const context = {
      runtimeContextId: "final-old",
      cache: { history: [] },
      lastApiTokenCount: {
        provider: "newer",
        model: "model",
        source: "api",
        inputTokens: 99,
        createdAt: "newer",
      },
    } as never;

    __testScheduleApiTokenCountDiagnostics({
      context,
      gateway,
      runtime: { provider: "old-final", model: "model" },
      messages: [{ role: "user", content: "hello" }],
      signal: new AbortController().signal,
      runtimeContextId: "final-old",
    });

    (context as { runtimeContextId: string }).runtimeContextId = "final-new";
    resolveCount?.({ source: "api", inputTokens: 7 });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect((context as { lastApiTokenCount?: { provider?: string; inputTokens?: number } }).lastApiTokenCount).toMatchObject({
      provider: "newer",
      inputTokens: 99,
    });
    expect((context as { cache: { history: unknown[] } }).cache.history).toEqual([]);
  });

  it("does not let a late failed token count overwrite a newer foreground turn", async () => {
    const gateway = {
      countMessagesTokensWithAPI: async () => {
        throw new Error("token count unavailable");
      },
    } as unknown as ModelGateway;
    const context = { currentRequestTurnId: "turn-newer", cache: { history: [] } } as never;

    __testScheduleApiTokenCountDiagnostics({
      context,
      gateway,
      runtime: { provider: "test", model: "model" },
      messages: [{ role: "user", content: "hello" }],
      signal: new AbortController().signal,
      requestTurnId: "turn-old",
    });
    await Promise.resolve();
    await Promise.resolve();

    expect((context as { lastApiTokenCount?: unknown }).lastApiTokenCount).toBeUndefined();
    expect((context as { cache: { history: unknown[] } }).cache.history).toEqual([]);
  });
});

describe("Final Gap Progress Detection (Stage 4)", () => {
  it.each([
    [
      { toolName: "Read", input: { path: "src/a.ts", offset: 1, limit: 20 } },
      { toolName: "Read", input: { path: "src/a.ts", offset: 200, limit: 5 } },
    ],
    [
      { toolName: "ReadSnippets", input: { ranges: [{ path: "src/a.ts", start: 1, end: 20 }] } },
      { toolName: "ReadSnippets", input: { ranges: [{ path: "src/a.ts", start: 200, end: 240 }] } },
    ],
    [
      { toolName: "SourcePack", input: { query: "first query", limit: 2 } },
      { toolName: "SourcePack", input: { query: "second query", limit: 10 } },
    ],
    [
      { toolName: "Grep", input: { path: "src", pattern: "first", limit: 20 } },
      { toolName: "Grep", input: { path: "src", pattern: "second", limit: 200 } },
    ],
    [
      { toolName: "Glob", input: { path: "src", pattern: "**/*.ts", limit: 20 } },
      { toolName: "Glob", input: { path: "src", pattern: "**/*.tsx", limit: 200 } },
    ],
  ])("normalizes dynamic readonly inputs for one final-gap evidence path", (left, right) => {
    const context = {
      evidence: [],
      currentRequestTurnId: "turn-path-hash",
      sessionId: "session-path-hash",
      projectPath: "/test",
      tools: { changedFiles: [] },
    } as unknown as TuiContext;
    const result = {
      status: "needs_disclaimer" as const,
      unsupportedKinds: ["artifact_claim"],
    };
    const makeAction = (action: typeof left) => ({
      ...action,
      strategy: "artifact_readonly_check" as const,
      summary: "inspect artifact evidence",
    });

    const leftState = __testCaptureFinalGapProgressState(result, context, makeAction(left));
    const rightState = __testCaptureFinalGapProgressState(result, context, makeAction(right));

    expect(leftState.commandFingerprint).toBe(rightState.commandFingerprint);
  });

  it("records a matching readonly path without treating it as final-gap progress", () => {
    const context = {
      evidence: [
        {
          id: "matching-read",
          kind: "source_read",
          summary: "read src/a.ts",
          source: "Read",
          supportsClaims: [],
          createdAt: new Date(0).toISOString(),
          ownerScope: {
            ownerSessionId: "session-1",
            requestTurnId: "turn-1",
            cwd: "/test",
            targets: ["src/a.ts"],
          },
        },
      ],
      currentRequestTurnId: "turn-1",
      sessionId: "session-1",
      projectPath: "/test",
    } as unknown as TuiContext;
    const continuation = {
      finalGapProgressState: {
        unsupportedKinds: ["artifact_claim"],
        relevantEvidenceIds: new Set<string>(),
        evidenceAction: {
          toolName: "Read",
          input: { path: "src/a.ts" },
          summary: "read claimed artifact",
        },
        attemptedCommandFingerprints: new Set<string>(),
      },
    };
    const toolCall = { name: "Read", input: { path: "src/a.ts" } };
    const result = {
      ok: true,
      tool: "Read",
      text: "Read(src/a.ts) 10 lines",
      evidenceId: "matching-read",
    };

    expect(recordSuccessfulToolExecutionProgress(continuation, toolCall, result, context)).toBe(false);
    expect(continuation.finalGapProgressState.attemptedCommandFingerprints.size).toBe(1);

    expect(recordSuccessfulToolExecutionProgress(continuation, toolCall, result, context)).toBe(false);
  });

  it("does not count unrelated evidence and records an attempted path only when it executes", () => {
    const context = {
      evidence: [],
      currentRequestTurnId: "turn-1",
      sessionId: "session-1",
      projectPath: "/test",
    } as unknown as TuiContext;
    const makeContinuation = () => ({
      finalGapProgressState: {
        unsupportedKinds: ["artifact_claim"],
        relevantEvidenceIds: new Set<string>(),
        evidenceAction: {
          toolName: "Read",
          input: { path: "src/required.ts" },
          strategy: "artifact_readonly_check" as const,
          summary: "read required artifact",
        },
        attemptedCommandFingerprints: new Set<string>(),
      },
    });
    const unrelated = makeContinuation();

    expect(recordSuccessfulToolExecutionProgress(
      unrelated,
      { name: "Read", input: { path: "src/unrelated.ts" } },
      { ok: true, tool: "Read", text: "unrelated", evidenceId: "unrelated-read" },
      context,
    )).toBe(false);
    expect(unrelated.finalGapProgressState.attemptedCommandFingerprints.size).toBe(1);

    const failed = makeContinuation();
    expect(recordSuccessfulToolExecutionProgress(
      failed,
      { name: "Read", input: { path: "src/required.ts" } },
      { ok: false, tool: "Read", text: "read failed" },
      context,
    )).toBe(false);
    expect(failed.finalGapProgressState.attemptedCommandFingerprints.size).toBe(1);
  });

  it("matches real Bash verification and normalizes Grep patterns by evidence path", () => {
    const context = {
      evidence: [],
      currentRequestTurnId: "turn-1",
      sessionId: "session-1",
      projectPath: "/test",
    } as unknown as TuiContext;
    const continuationFor = (evidenceAction: {
      toolName: string;
      input: unknown;
      strategy?: "minimal_bash_verification" | "artifact_readonly_check";
      summary: string;
    }) => ({
      finalGapProgressState: {
        unsupportedKinds: ["verification_claim"],
        relevantEvidenceIds: new Set<string>(),
        evidenceAction,
        attemptedCommandFingerprints: new Set<string>(),
      },
    });
    const bash = continuationFor({
      toolName: "Bash",
      input: { level: "test" },
      strategy: "minimal_bash_verification",
      summary: "run one focused test",
    });
    context.evidence.push({
      id: "pwd-attempt",
      kind: "command_output",
      summary: "Bash: pwd",
      source: "Bash",
      supportsClaims: ["Bash", "command_ran", "bash_exit_nonzero"],
      createdAt: new Date(0).toISOString(),
      ownerScope: {
        ownerSessionId: "session-1",
        requestTurnId: "turn-1",
        cwd: "/test",
      },
    });
    recordSuccessfulToolExecutionProgress(
      bash,
      { name: "Bash", input: { command: "pwd" } },
      { ok: false, tool: "Bash", text: "failed", evidenceId: "pwd-attempt" },
      context,
    );
    expect(bash.finalGapProgressState.attemptedCommandFingerprints.size).toBe(0);
    context.evidence.push({
      id: "test-attempt",
      kind: "command_output",
      summary: "Bash: corepack pnpm test",
      source: "Bash",
      supportsClaims: ["Bash", "command_ran", "bash_exit_nonzero", "test_attempted"],
      createdAt: new Date(1).toISOString(),
      ownerScope: {
        ownerSessionId: "session-1",
        requestTurnId: "turn-1",
        cwd: "/test",
      },
    });
    recordSuccessfulToolExecutionProgress(
      bash,
      { name: "Bash", input: { command: "corepack pnpm test", description: "focused test" } },
      { ok: false, tool: "Bash", text: "failed", evidenceId: "test-attempt" },
      context,
    );
    expect(bash.finalGapProgressState.attemptedCommandFingerprints.size).toBe(1);

    const grep = continuationFor({
      toolName: "Grep",
      input: { path: "src", pattern: "required-symbol" },
      strategy: "artifact_readonly_check",
      summary: "find required symbol",
    });
    recordSuccessfulToolExecutionProgress(
      grep,
      { name: "Grep", input: { path: "src", pattern: "unrelated-symbol" } },
      { ok: false, tool: "Grep", text: "no matches" },
      context,
    );
    expect(grep.finalGapProgressState.attemptedCommandFingerprints.size).toBe(1);
    recordSuccessfulToolExecutionProgress(
      grep,
      { name: "Grep", input: { path: "src", pattern: "required-symbol", limit: 20 } },
      { ok: false, tool: "Grep", text: "no matches" },
      context,
    );
    expect(grep.finalGapProgressState.attemptedCommandFingerprints.size).toBe(1);
  });

  it("does not count rotating pre-gap Read evidence without an active gap", () => {
    const context = {
      evidence: [],
      currentRequestTurnId: "turn-scope",
      sessionId: "session-scope",
      projectPath: "/test",
    } as unknown as TuiContext;
    const continuation = {};

    for (let index = 0; index < 250; index += 1) {
      const evidenceId = `scope-${index}`;
      context.evidence.push({
        id: evidenceId,
        kind: "file_read",
        summary: `read src/file-${index}.ts`,
        source: "Read",
        supportsClaims: ["code_fact"],
        createdAt: new Date(index).toISOString(),
        ownerScope: {
          ownerSessionId: "session-scope",
          requestTurnId: "turn-scope",
          cwd: "/test",
          targets: [`src/file-${index}.ts`],
        },
      });
      expect(recordSuccessfulToolExecutionProgress(
        continuation,
        { name: "Read", input: { path: `src/file-${index}.ts` } },
        {
          ok: true,
          tool: "Read",
          text: `content-${index}`,
          evidenceId,
        },
        context,
      )).toBe(false);
    }
  });

  describe("finalGapHasProgress", () => {
    it("does not treat the first observed gap as progress", () => {
      const context = {
        evidence: [],
        currentRequestTurnId: "turn-1",
        sessionId: "session-1",
        projectPath: "/test",
      } as unknown as TuiContext;
      const result = {
        status: "needs_disclaimer" as const,
        unsupportedKinds: ["test_claim"],
      };

      expect(__testFinalGapHasProgress(result, context, undefined)).toBe(false);
    });

    it("returns true when gap shrinks (fewer unsupported kinds)", () => {
      const context = {
        evidence: [],
        currentRequestTurnId: "turn-1",
        sessionId: "session-1",
        projectPath: "/test",
      } as unknown as TuiContext;

      const previous = {
        unsupportedKinds: ["test_claim", "completion_claim"],
        relevantEvidenceIds: new Set<string>(),
        attemptedCommandFingerprints: new Set<string>(),
      };

      const result = {
        status: "needs_disclaimer" as const,
        unsupportedKinds: ["test_claim"],
      };

      expect(__testFinalGapHasProgress(result, context, previous)).toBe(true);
    });

    it("does not treat a changed readonly range as gap progress", () => {
      const context = {
        evidence: [
          {
            id: "new-read",
            kind: "source_read",
            source: "Read",
            supportsClaims: [],
            ownerScope: {
              requestTurnId: "turn-1",
              ownerSessionId: "session-1",
              cwd: "/test",
              targets: ["test.ts"],
            },
          },
        ],
        currentRequestTurnId: "turn-1",
        sessionId: "session-1",
        projectPath: "/test",
      } as unknown as TuiContext;

      const previous = {
        unsupportedKinds: ["test_claim"],
        relevantEvidenceIds: new Set<string>(),
        evidenceAction: {
          toolName: "Read",
          input: { path: "test.ts" },
          summary: "read test file",
        },
        attemptedCommandFingerprints: new Set<string>(),
      };

      const result = {
        status: "needs_disclaimer" as const,
        unsupportedKinds: ["test_claim"],
      };

      expect(__testFinalGapHasProgress(result, context, previous)).toBe(false);
    });

    it("allows same-level verification after the changed-file scope changes", () => {
      const context = {
        evidence: [],
        currentRequestTurnId: "turn-1",
        sessionId: "session-1",
        projectPath: "/test",
        currentRequestChangedFiles: [],
      } as unknown as TuiContext;

      const result = {
        status: "needs_disclaimer" as const,
        unsupportedKinds: ["test_claim"],
      };
      const evidenceAction = {
        toolName: "RunVerification",
        input: { level: "test" },
        summary: "run focused test",
      } as const;
      const previous = __testCaptureFinalGapProgressState(
        result,
        context,
        evidenceAction,
      );
      previous.attemptedCommandFingerprints.add(previous.commandFingerprint!);
      context.evidence.push({
        id: "file-written",
        kind: "command_output",
        source: "Edit",
        summary: "Edit: src/a.ts",
        supportsClaims: ["Edit", "file_written"],
        ownerScope: {
          requestTurnId: "turn-1",
          ownerSessionId: "session-1",
          cwd: "/test",
          targets: ["src/a.ts"],
        },
      } as unknown as EvidenceRecord);
      context.currentRequestChangedFiles = ["src/a.ts"];

      expect(__testFinalGapHasProgress(result, context, previous)).toBe(true);
    });

    it("does not revive a verification action for unrelated evidence or readonly files", () => {
      const context = {
        evidence: [],
        currentRequestTurnId: "turn-1",
        sessionId: "session-1",
        projectPath: "/test",
        currentRequestChangedFiles: [],
        currentRequestMentionedFiles: [],
        tools: { changedFiles: [] },
      } as unknown as TuiContext;
      const result = {
        status: "needs_disclaimer" as const,
        unsupportedKinds: ["test_claim"],
      };
      const evidenceAction = {
        toolName: "RunVerification",
        input: { level: "test" },
        summary: "run focused test",
      } as const;
      const continuation = {
        finalGapProgressState: __testCaptureFinalGapProgressState(
          result,
          context,
          evidenceAction,
        ),
      };
      const actionFingerprint = continuation.finalGapProgressState.commandFingerprint!;
      continuation.finalGapProgressState.attemptedCommandFingerprints.add(actionFingerprint);
      context.currentRequestMentionedFiles = ["src/readonly.ts"];

      for (let index = 0; index < 1_000; index += 1) {
        context.evidence.push({
          id: `unrelated-${index}`,
          kind: "command_output",
          source: "IndexOperation",
          summary: `index operation ${index}`,
          supportsClaims: ["index_operation"],
          ownerScope: {
            requestTurnId: "turn-1",
            ownerSessionId: "session-1",
            cwd: "/test",
          },
        } as unknown as EvidenceRecord);
      }

      expect(__testFinalGapHasProgress(result, context, continuation.finalGapProgressState)).toBe(
        false,
      );
      expect(recordSuccessfulToolExecutionProgress(
        continuation,
        { name: "IndexOperation", input: { action: "status" } },
        {
          ok: true,
          tool: "IndexOperation",
          text: "indexed",
          evidenceId: "unrelated-999",
        },
        context,
      )).toBe(false);
      expect(continuation.finalGapProgressState.attemptedCommandFingerprints).toContain(
        actionFingerprint,
      );
    });

    it("counts only new evidence that directly supports the selected gap action", () => {
      const context = {
        evidence: [],
        currentRequestTurnId: "turn-1",
        sessionId: "session-1",
        projectPath: "/test",
        tools: { changedFiles: [] },
      } as unknown as TuiContext;
      const result = {
        status: "needs_disclaimer" as const,
        unsupportedKinds: ["test_claim"],
      };
      const evidenceAction = {
        toolName: "RunVerification",
        input: { level: "test" },
        summary: "run focused test",
      } as const;
      const previous = __testCaptureFinalGapProgressState(
        result,
        context,
        evidenceAction,
      );
      context.evidence.push({
        id: "matching-test-pass",
        kind: "test_result",
        source: "Verification Runner",
        summary: "focused test passed",
        supportsClaims: ["test_passed"],
        ownerScope: {
          requestTurnId: "turn-1",
          ownerSessionId: "session-1",
          cwd: "/test",
        },
        data: {
          verificationScope: {
            ownerKey: "request:session-1:turn-1",
            ownerSessionId: "session-1",
            requestTurnId: "turn-1",
            cwd: "/test",
            changedFiles: [],
          },
        },
      } as unknown as EvidenceRecord);

      expect(__testFinalGapHasProgress(result, context, previous)).toBe(true);
    });

    it("returns false when the same action fingerprint already made no gap progress", () => {
      const context = {
        evidence: [],
        currentRequestTurnId: "turn-1",
        sessionId: "session-1",
        projectPath: "/test",
      } as unknown as TuiContext;
      const result = {
        status: "needs_disclaimer" as const,
        unsupportedKinds: ["test_claim"],
      };
      const previous = {
        unsupportedKinds: ["test_claim"],
        relevantEvidenceIds: new Set<string>(),
        evidenceAction: {
          toolName: "RunVerification",
          input: { level: "test" },
          summary: "run test",
        },
        commandFingerprint: "same-action",
        attemptedCommandFingerprints: new Set(["same-action"]),
      };

      expect(__testFinalGapHasProgress(result, context, previous)).toBe(false);
    });
  });

  describe("evidenceMatchesFinalGapAction", () => {
    it("matches test evidence to test-level verification action", () => {
      const record = {
        id: "test-1",
        kind: "test_result",
        source: "Bash",
        supportsClaims: ["test_passed"],
      } as unknown as EvidenceRecord;

      const action = {
        toolName: "Bash",
        input: { level: "test" },
        summary: "run test",
      } as const;

      expect(__testEvidenceMatchesFinalGapAction(record, action)).toBe(true);
    });

    it("rejects typecheck evidence for test-level action", () => {
      const record = {
        id: "typecheck-1",
        kind: "test_result",
        source: "Verification Runner",
        supportsClaims: ["typecheck_passed"],
      } as unknown as EvidenceRecord;

      const action = {
        toolName: "Bash",
        input: { level: "test" },
        summary: "run test",
      } as const;

      expect(__testEvidenceMatchesFinalGapAction(record, action)).toBe(false);
    });

    it("rejects failed test_result evidence for test-level action", () => {
      const record = {
        id: "failed-test-1",
        kind: "test_result",
        source: "Verification Runner",
        supportsClaims: ["verification attempted", "verification:fail"],
      } as unknown as EvidenceRecord;
      const action = {
        toolName: "RunVerification",
        input: { level: "test" },
        summary: "run test",
      } as const;

      expect(__testEvidenceMatchesFinalGapAction(record, action)).toBe(false);
    });

    it("matches build evidence to build-level action", () => {
      const record = {
        id: "build-1",
        kind: "command_output",
        source: "Bash",
        supportsClaims: ["build_passed"],
      } as unknown as EvidenceRecord;

      const action = {
        toolName: "Bash",
        input: { level: "build" },
        summary: "run build",
      } as const;

      expect(__testEvidenceMatchesFinalGapAction(record, action)).toBe(true);
    });

    it("rejects test evidence for build-level action", () => {
      const record = {
        id: "test-1",
        kind: "test_result",
        source: "Bash",
        supportsClaims: ["test_passed"],
      } as unknown as EvidenceRecord;

      const action = {
        toolName: "Bash",
        input: { level: "build" },
        summary: "run build",
      } as const;

      expect(__testEvidenceMatchesFinalGapAction(record, action)).toBe(false);
    });

    it("matches any verification evidence to unspecified level", () => {
      const typecheckRecord = {
        id: "typecheck-1",
        kind: "command_output",
        source: "Bash",
        supportsClaims: ["typecheck_passed"],
      } as unknown as EvidenceRecord;

      const action = {
        toolName: "Bash",
        input: {},
        summary: "run verification",
      } as const;

      expect(__testEvidenceMatchesFinalGapAction(typecheckRecord, action)).toBe(true);
    });
  });

  describe("captureFinalGapProgressState", () => {
    it("records the planned action fingerprint without consuming it", () => {
      const context = {
        evidence: [],
        currentRequestTurnId: "turn-1",
        sessionId: "session-1",
        projectPath: "/test",
      } as unknown as TuiContext;

      const result = {
        status: "needs_disclaimer" as const,
        unsupportedKinds: ["test_claim"],
      };

      const evidenceAction = {
        toolName: "Bash",
        input: { level: "test" },
        summary: "run test",
      } as const;

      const previous = {
        unsupportedKinds: ["test_claim"],
        relevantEvidenceIds: new Set<string>(),
        commandFingerprint: "previous-action",
        attemptedCommandFingerprints: new Set(["previous-action"]),
      };

      const state = __testCaptureFinalGapProgressState(
        result,
        context,
        evidenceAction,
        previous,
      );

      expect(state.commandFingerprint).toBeDefined();
      expect(state.attemptedCommandFingerprints.has("previous-action")).toBe(true);
      expect(state.attemptedCommandFingerprints.has(state.commandFingerprint!)).toBe(false);
    });

    it("does not mark the first scheduled action as attempted", () => {
      const context = {
        evidence: [],
        currentRequestTurnId: "turn-1",
        sessionId: "session-1",
        projectPath: "/test",
      } as unknown as TuiContext;

      const result = {
        status: "needs_disclaimer" as const,
        unsupportedKinds: ["test_claim"],
      };

      const evidenceAction = {
        toolName: "Bash",
        input: { level: "test" },
        summary: "run test",
      } as const;

      const state = __testCaptureFinalGapProgressState(
        result,
        context,
        evidenceAction,
      );

      expect(state.commandFingerprint).toBeDefined();
      expect(state.attemptedCommandFingerprints).toEqual(new Set());
    });

    it("does not consume a repeated plan until its tool executes", () => {
      const context = {
        evidence: [],
        currentRequestTurnId: "turn-123",
        sessionId: "session-1",
        projectPath: "/test",
      } as unknown as TuiContext;

      const result = {
        status: "needs_disclaimer" as const,
        unsupportedKinds: ["test_claim"],
      };

      const evidenceAction = {
        toolName: "Bash",
        input: { level: "test" },
        summary: "run test",
      } as const;

      const first = __testCaptureFinalGapProgressState(
        result,
        context,
        evidenceAction,
      );
      const state = __testCaptureFinalGapProgressState(result, context, evidenceAction, first);

      expect(state.commandFingerprint).toBe(first.commandFingerprint);
      expect(state.attemptedCommandFingerprints.has(first.commandFingerprint!)).toBe(false);
      expect(state.attemptedCommandFingerprints.size).toBe(0);
    });

    it("keeps an ignored directive available until a real tool result records the attempt", () => {
      const context = {
        evidence: [],
        currentRequestTurnId: "turn-ignored-directive",
        sessionId: "session-1",
        projectPath: "/test",
      } as unknown as TuiContext;
      const result = {
        status: "needs_disclaimer" as const,
        unsupportedKinds: ["test_claim"],
      };
      const evidenceAction = {
        toolName: "RunVerification",
        input: { level: "test" },
        summary: "run focused verification",
      } as const;

      const first = __testCaptureFinalGapProgressState(
        result,
        context,
        evidenceAction,
      );

      const reissued = __testCaptureFinalGapProgressState(
        result,
        context,
        evidenceAction,
        first,
      );
      expect(reissued.attemptedCommandFingerprints).toEqual(new Set());

      const stillRunnable = planFinalGateEvidenceGapAction({
        result,
        context: {
          ...context,
          language: "zh-CN",
          permissionMode: "full-access",
        },
        attemptedEvidenceActionFingerprints: reissued.attemptedCommandFingerprints,
      });
      expect(stillRunnable.action).toBe("verification_request");
      expect(stillRunnable.evidenceAction?.toolName).toBe("RunVerification");
    });
  });
});
