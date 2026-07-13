import type { Language, PermissionMode } from "@linghun/shared";

export type CacheWriteTokensSource = "reported" | "zero_reported" | "missing" | "estimated";

export type CacheFreshness = {
  systemPromptHash: string;
  toolSchemaHash: string;
  mcpToolListHash: string;
  modelProviderHash: string;
  reasoningEffortHash?: string;
  projectRulesHash?: string;
  memoryHash?: string;
  compactHash?: string;
  pluginListHash?: string;
  // D.13F：附加维度，用于 /break-cache status 展示导致缓存失效的具体来源。
  // 不替换原有 9 个维度，仅追加；缺失时按 hash("none") 处理，保持向后兼容。
  endpointProfileHash?: string;
  cacheControlHash?: string;
  cacheTtlHash?: string;
  // D.13H：附加 Anthropic context editing 维度。Hard-disabled 收口阶段也一并暴露 hash，
  // 便于诊断 contextEditingEnabled / anthropicBetaHeaders 变化是否会影响缓存键。
  // 缺失时按 hash("none") 处理，保持向后兼容；不影响 D.13F 既有 keys 顺序。
  contextEditingHash?: string;
  cacheEditingBetaHash?: string;
  // D.13I：deferred tools (MCP/skill/plugin/codebase-memory) 列表变化追踪。
  // 仅记录 name/kind/executable/requiredArgs（不含 raw schema/secret），
  // 与 toolSchemaHash 解耦——固定的 builtIn + SearchExtraTools/ExecuteExtraTool schema 不变，
  // deferred 列表变化只反映在这个 hash 上。缺失时按 hash("none") 处理，向后兼容。
  deferredToolListHash?: string;
  changedKeys: string[];
};

export type CacheTurnStats = {
  turn: number;
  timestamp: number;
  hitRate: number | null;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheWriteTokensSource: CacheWriteTokensSource;
  inputTokens: number;
  outputTokens: number;
  model: string;
  provider: string;
  endpoint?: string;
  source: "api_usage" | "provider_usage" | "estimated";
  compacted: boolean;
  freshness: CacheFreshness;
  rawUsage?: unknown;
  kind?: "main" | "continuation" | "final" | "agent-child" | "side-question" | "deep-compact";
};

export type CacheUsageRaw = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  provider: string;
  model: string;
};

export type CostSummary = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  estimatedUsd: number;
  estimatedCny: number;
  estimatedSavedCny?: number;
  billingReconciled?: boolean;
  billingSource?: string;
  endpoint?: string;
  providerReported?: boolean;
};

export type CacheSummary = {
  hitRate: number | null;
  readTokens: number;
  writeTokens: number;
  historySize: number;
  lastWriteTokensSource?: CacheWriteTokensSource;
  lastFreshness?: CacheFreshness;
};

export type Session = {
  id: string;
  projectPath: string;
  projectName: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  permissionMode: PermissionMode;
  language: Language;
  transcriptPath: string;
  summary?: string;
  cost: CostSummary;
  cache: CacheSummary;
};

export type TranscriptEvent =
  | { type: "session_start"; sessionId: string; projectPath: string; createdAt: string }
  | { type: "user_message"; id: string; text: string; createdAt: string }
  | { type: "assistant_text_delta"; id: string; text: string; createdAt: string }
  | {
      type: "system_event";
      id: string;
      level: "info" | "warning";
      message: string;
      createdAt: string;
    }
  | {
      type: "background_task_update";
      task: {
        id: string;
        kind: "bash" | "verification" | "compact" | "agent" | "job" | "mcp" | "index";
        title: string;
        status:
          | "running"
          | "paused"
          | "completed"
          | "failed"
          | "blocked"
          | "cancelled"
          | "timeout"
          | "stale";
        currentStep?: string;
        progress?: { completed: number; total?: number; label?: string };
        startedAt: string;
        updatedAt: string;
        completedAt?: string;
        lastOutputAt?: string;
        estimatedRemainingMs?: number;
        heartbeatIntervalMs: number;
        staleAfterMs: number;
        logPath?: string;
        outputPath?: string;
        hasOutput: boolean;
        result?: "pass" | "fail" | "partial" | "cancelled" | "timeout" | "stale";
        cancelState?: "abort_signal_sent" | "marked_stale" | "confirmed_exited";
        cancelRequestedAt?: string;
        confirmedExitedAt?: string;
        userVisibleSummary: string;
        nextAction?: string;
      };
      createdAt: string;
    }
  | {
      type: "checkpoint_created";
      checkpoint: {
        id: string;
        sessionId: string;
        createdAt: string;
        reason: string;
        changedFiles: string[];
        restoreKind: "git" | "snapshot";
        restorable?: boolean;
        restoreUnavailableReason?: string;
        files?: { path: string; existed: boolean; content?: string }[];
      };
      createdAt: string;
    }
  | { type: "checkpoint_restored"; checkpointId: string; createdAt: string }
  | { type: "usage"; usage: CacheTurnStats; createdAt: string }
  | { type: "cache_update"; stats: CacheTurnStats; createdAt: string }
  | {
      type: "verification_start";
      run: {
        id: string;
        plan: { kind: string; command: string; reason: string }[];
        startedAt: string;
      };
      createdAt: string;
    }
  | {
      type: "verification_end";
      report: {
        id: string;
        status: "pass" | "fail" | "partial" | "cancelled" | "timeout" | "stale";
        summary: string;
        commands: {
          kind: string;
          command: string;
          status: "pass" | "fail" | "partial" | "skipped" | "cancelled" | "timeout" | "stale";
          exitCode?: number;
          durationMs: number;
          logPath?: string;
          summary: string;
        }[];
        unverified: string[];
        risk: string[];
        logPath?: string;
        startedAt: string;
        endedAt: string;
        durationMs: number;
        nextAction: string;
      };
      createdAt: string;
    }
  | { type: "btw_question"; id: string; text: string; answer: string; createdAt: string }
  | {
      type: "interrupt";
      id: string;
      status: "cancelled" | "paused" | "background";
      message: string;
      createdAt: string;
    }
  | {
      type: "evidence_record";
      id: string;
      kind:
        | "file_read"
        | "grep_result"
        | "index_query"
        | "command_output"
        | "test_result"
        | "web_source"
        | "vision_observation"
        | "image_result"
        | "user_provided";
      summary: string;
      source: string;
      supportsClaims: string[];
      toolUseId?: string;
      fullOutputPath?: string;
      outputPath?: string;
      logPath?: string;
      data?: unknown;
      createdAt: string;
    }
  | {
      type: "claim_check";
      id: string;
      status: "passed" | "needs_disclaimer" | "blocked";
      unsupportedClaims: string[];
      createdAt: string;
    }
  | { type: "tool_call_start"; id: string; name: string; input: unknown; createdAt: string }
  | { type: "tool_call_delta"; id: string; message: string; createdAt: string }
  | {
      type: "tool_call_end";
      id: string;
      output: {
        text: string;
        data?: unknown;
        truncated?: boolean;
        fullOutputPath?: string;
        changedFiles?: string[];
      };
      createdAt: string;
    }
  | {
      type: "tool_result";
      toolUseId: string;
      toolName: string;
      content: unknown;
      isError?: boolean;
      evidenceId?: string;
      createdAt: string;
    }
  | {
      type: "permission_request";
      request: {
        id: string;
        toolName: string;
        mode: PermissionMode;
        risk: "low" | "medium" | "high";
        summary: string;
        files: string[];
        reason: string;
      };
      createdAt: string;
    }
  | {
      type: "permission_result";
      requestId: string;
      decision: "allow" | "ask" | "deny";
      reason: string;
      createdAt: string;
    }
  | {
      type: "plan_proposal";
      proposal: {
        id: string;
        title: string;
        options: { id: string; title: string; steps: string[]; risks: string[] }[];
      };
      createdAt: string;
    }
  | {
      type: "plan_decision";
      proposalId: string;
      optionId: string;
      decision: "accepted" | "rejected";
      createdAt: string;
    }
  | {
      type: "todo_update";
      items: {
        id: string;
        content: string;
        status: "pending" | "in_progress" | "completed" | "blocked";
        evidence?: string;
      }[];
      createdAt: string;
    }
  | {
      type: "diff_update";
      summary: {
        changedFiles: string[];
        addedLines: number;
        removedLines: number;
        summary: string;
        riskyFiles: string[];
      };
      createdAt: string;
    }
  | { type: "handoff_packet"; packet: unknown; createdAt: string }
  | { type: "agent_start"; agent: unknown; createdAt: string }
  | {
      type: "agent_end";
      agentId: string;
      status: "completed" | "failed" | "blocked" | "cancelled";
      summary: string;
      createdAt: string;
    }
  | { type: "workflow_start"; workflow: unknown; createdAt: string }
  | { type: "workflow_step_start"; workflowId: string; step: unknown; createdAt: string }
  | {
      type: "workflow_step_result";
      workflowId: string;
      stepId: string;
      status: "completed" | "partial" | "failed" | "blocked" | "cancelled" | "stale";
      summary: string;
      evidenceRefs: string[];
      createdAt: string;
    }
  | {
      type: "workflow_end";
      workflowId: string;
      status: "completed" | "partial" | "failed" | "blocked" | "cancelled" | "stale";
      summary: string;
      createdAt: string;
    }
  | { type: "memory_candidate"; candidate: unknown; createdAt: string }
  | { type: "memory_accepted"; memory: unknown; createdAt: string }
  | { type: "deep_compact_packet"; packet: unknown; createdAt: string }
  | { type: "branch_created"; branch: unknown; createdAt: string }
  | { type: "session_import"; source: string; summary: string; createdAt: string }
  | { type: "session_end"; sessionId: string; createdAt: string };

export type UsableDeepCompactPacket = Record<string, unknown> & {
  kind: "deep";
  scope: "full transcript semantic compact";
  id: string;
  summary: string;
  preservedEvidenceRefs: string[];
  preservedFiles: string[];
  narrativeSummary?: string;
  userMessagesVerbatim?: string[];
  toolResultSummaries?: string[];
  codeSnippets?: string[];
  activeAgentsWorkflows: string[];
  needsAttentionAgentsWorkflows?: string[];
  staleResumableAgentsWorkflows?: string[];
  pendingItems: string[];
  decisions: string[];
  risks: string[];
  createdAt: string;
  model: string;
  provider: string;
  trigger: "manual" | "request" | "continuation" | "final" | "agent-child" | "workflow";
  transcriptEventCount: number;
};

export type UsableCompactProjection = Record<string, unknown> & {
  summary: string;
  restoreContext?: Record<string, unknown>;
};

export type HydratableCompactProjection = UsableCompactProjection & {
  boundaryId: string;
  createdAt: string;
  pressureRatio: number;
  preCompactChars: number;
  postCompactChars: number;
  discardedRange: string;
  toolPairingSafe: boolean;
  risks: string[];
  evidenceRefs: string[];
};

export type UsableTranscriptCompactBoundary =
  | { kind: "deep"; packet: UsableDeepCompactPacket }
  | {
      kind: "projection";
      projection: UsableCompactProjection;
      hydrationProjection?: HydratableCompactProjection;
    };

const COMPACT_PROJECTION_EVENT_PREFIX = "compact_projection:";

export function isUsableDeepCompactPacket(value: unknown): value is UsableDeepCompactPacket {
  if (!isRecord(value)) return false;
  const packet = value;
  return (
    packet.kind === "deep" &&
    packet.scope === "full transcript semantic compact" &&
    typeof packet.id === "string" &&
    typeof packet.summary === "string" &&
    isStringArray(packet.preservedEvidenceRefs) &&
    isStringArray(packet.preservedFiles) &&
    (packet.narrativeSummary === undefined || typeof packet.narrativeSummary === "string") &&
    (packet.userMessagesVerbatim === undefined || isStringArray(packet.userMessagesVerbatim)) &&
    (packet.toolResultSummaries === undefined || isStringArray(packet.toolResultSummaries)) &&
    (packet.codeSnippets === undefined || isStringArray(packet.codeSnippets)) &&
    isStringArray(packet.activeAgentsWorkflows) &&
    (packet.needsAttentionAgentsWorkflows === undefined ||
      isStringArray(packet.needsAttentionAgentsWorkflows)) &&
    (packet.staleResumableAgentsWorkflows === undefined ||
      isStringArray(packet.staleResumableAgentsWorkflows)) &&
    isStringArray(packet.pendingItems) &&
    isStringArray(packet.decisions) &&
    isStringArray(packet.risks) &&
    typeof packet.createdAt === "string" &&
    typeof packet.model === "string" &&
    typeof packet.provider === "string" &&
    isDeepCompactTrigger(packet.trigger) &&
    typeof packet.transcriptEventCount === "number"
  );
}

function isHydratableCompactProjection(value: unknown): value is HydratableCompactProjection {
  if (!isRecord(value)) return false;
  return (
    typeof value.boundaryId === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.summary === "string" &&
    (value.windowId === undefined || typeof value.windowId === "string") &&
    (value.replacementKind === undefined || value.replacementKind === "provider-visible") &&
    (value.replacedMessageCount === undefined || typeof value.replacedMessageCount === "number") &&
    (value.replacementMessageCount === undefined ||
      typeof value.replacementMessageCount === "number") &&
    (value.terminalVisibleBeforeCount === undefined ||
      typeof value.terminalVisibleBeforeCount === "number") &&
    (value.terminalVisibleAfterCount === undefined ||
      typeof value.terminalVisibleAfterCount === "number") &&
    typeof value.pressureRatio === "number" &&
    typeof value.preCompactChars === "number" &&
    typeof value.postCompactChars === "number" &&
    (value.postCompactTargetChars === undefined ||
      typeof value.postCompactTargetChars === "number") &&
    (value.retriggerGuard === undefined || isCompactRetriggerGuard(value.retriggerGuard)) &&
    (value.savingsRatio === undefined || typeof value.savingsRatio === "number") &&
    (value.acceptance === undefined || isCompactAcceptanceSnapshot(value.acceptance)) &&
    (value.progress === undefined || isCompactProgressSnapshot(value.progress)) &&
    (value.restoreContext === undefined || isCompactRestoreContext(value.restoreContext)) &&
    typeof value.discardedRange === "string" &&
    typeof value.toolPairingSafe === "boolean" &&
    isStringArray(value.risks) &&
    isStringArray(value.evidenceRefs)
  );
}

export function parseUsableTranscriptCompactBoundary(
  event: TranscriptEvent | undefined,
): UsableTranscriptCompactBoundary | undefined {
  if (event?.type === "deep_compact_packet") {
    return isUsableDeepCompactPacket(event.packet)
      ? { kind: "deep", packet: event.packet }
      : undefined;
  }
  if (
    event?.type !== "system_event" ||
    !event.message.startsWith(COMPACT_PROJECTION_EVENT_PREFIX)
  ) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(
      event.message.slice(COMPACT_PROJECTION_EVENT_PREFIX.length),
    );
    if (!isRecord(parsed) || typeof parsed.summary !== "string") return undefined;
    const { restoreContext, ...projectionFields } = parsed;
    const sanitizedSummary = parsed.summary
      .split(/\r?\n/u)
      .filter((line) => !line.startsWith("user constraints "))
      .join("\n");
    const sanitizedRestoreContext = isRecord(restoreContext)
      ? Object.fromEntries(
          Object.entries(restoreContext).filter(([key]) => key !== "userConstraints"),
        )
      : undefined;
    const projection: UsableCompactProjection = {
      ...projectionFields,
      summary: sanitizedSummary,
      ...(sanitizedRestoreContext ? { restoreContext: sanitizedRestoreContext } : {}),
    };
    const hydrationProjection: HydratableCompactProjection | undefined =
      isHydratableCompactProjection(parsed)
        ? {
            ...parsed,
            summary: sanitizedSummary,
            ...(sanitizedRestoreContext ? { restoreContext: sanitizedRestoreContext } : {}),
          }
        : undefined;
    return {
      kind: "projection",
      projection,
      ...(hydrationProjection ? { hydrationProjection } : {}),
    };
  } catch {
    return undefined;
  }
}

function isDeepCompactTrigger(value: unknown): boolean {
  return (
    value === "manual" ||
    value === "request" ||
    value === "continuation" ||
    value === "final" ||
    value === "agent-child" ||
    value === "workflow"
  );
}

function isCompactRetriggerGuard(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.baselineChars === "number" &&
    typeof value.tailGrowthThreshold === "number"
  );
}

function isCompactAcceptanceSnapshot(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.budget === "hit" || value.budget === "miss") &&
    (value.replacementProjection === "active" ||
      value.replacementProjection === "missing" ||
      value.replacementProjection === "disabled") &&
    (value.terminalVisibleProjection === "reduced" ||
      value.terminalVisibleProjection === "not-reduced" ||
      value.terminalVisibleProjection === "unknown") &&
    (value.uiNotice === "quiet-success" || value.uiNotice === "needs-attention") &&
    (value.rollback === "available" ||
      value.rollback === "active" ||
      value.rollback === "legacy-compact-behavior-available") &&
    (value.featureFlags === undefined || isCompactFeatureFlagSnapshot(value.featureFlags))
  );
}

function isCompactFeatureFlagSnapshot(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.replacementProjection === "boolean" &&
    typeof value.terminalVisibleProjection === "boolean" &&
    typeof value.retainedBudget === "boolean"
  );
}

function isCompactProgressSnapshot(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.status === "complete" &&
    isStringArray(value.stages) &&
    typeof value.preCompactChars === "number" &&
    typeof value.postCompactChars === "number" &&
    (value.targetChars === undefined || typeof value.targetChars === "number") &&
    (value.savingsRatio === undefined || typeof value.savingsRatio === "number")
  );
}

function isCompactRestoreContext(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    typeof value.goal === "string" &&
    typeof value.currentTask === "string" &&
    typeof value.phaseStatus === "string" &&
    (value.userConstraints === undefined || isStringArray(value.userConstraints)) &&
    isStringArray(value.keyFiles) &&
    isStringArray(value.changedFiles) &&
    isStringArray(value.evidenceRefs) &&
    isStringArray(value.activeAgentsWorkflows) &&
    isStringArray(value.needsAttentionAgentsWorkflows) &&
    isStringArray(value.staleResumableAgentsWorkflows) &&
    isStringArray(value.pendingItems) &&
    isStringArray(value.decisions) &&
    isStringArray(value.risks) &&
    typeof value.indexStatus === "string" &&
    typeof value.cacheFreshness === "string" &&
    typeof value.memoryStatus === "string" &&
    typeof value.verificationRequirement === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export type SessionListItem = Pick<
  Session,
  "id" | "projectName" | "projectPath" | "createdAt" | "updatedAt" | "summary" | "transcriptPath"
>;

export function createEmptyCostSummary(): CostSummary {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    estimatedUsd: 0,
    estimatedCny: 0,
  };
}

export function createEmptyCacheSummary(): CacheSummary {
  return {
    hitRate: null,
    readTokens: 0,
    writeTokens: 0,
    historySize: 0,
  };
}

export function computePromptCacheHitRate(usage: CacheUsageRaw): number | null {
  const denominator = usage.inputTokens + usage.cacheWriteTokens + usage.cacheReadTokens;
  if (denominator <= 0) {
    return null;
  }
  return usage.cacheReadTokens / denominator;
}
