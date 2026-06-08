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
        lastOutputAt?: string;
        estimatedRemainingMs?: number;
        heartbeatIntervalMs: number;
        staleAfterMs: number;
        logPath?: string;
        outputPath?: string;
        hasOutput: boolean;
        result?: "pass" | "fail" | "partial" | "cancelled" | "timeout" | "stale";
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
