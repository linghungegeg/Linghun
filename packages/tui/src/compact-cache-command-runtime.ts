import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import type { Writable } from "node:stream";
import type { CacheFreshness, CacheTurnStats, CacheWriteTokensSource } from "@linghun/core";
import { computePromptCacheHitRate } from "@linghun/core";
import type { ModelMessage, ModelUsage } from "@linghun/providers";
import { type ToolName, builtInTools } from "@linghun/tools";
import { checkResourceGuard } from "./background-control-runtime.js";
import {
  appendBreakCacheEvent,
  buildPromptCacheRequestFields,
  clearBreakCacheMarker,
  formatBreakCacheStatus,
  writeBreakCacheMarker,
} from "./break-cache-runtime.js";
import {
  buildCacheStatusPanel,
  formatCacheLog,
  formatCompactProgressBar,
  formatCompactStatus,
  writeLightHints,
} from "./cache-command-runtime.js";
import {
  createCacheFreshness,
  createConfigFreshnessSummary,
  diffFreshness,
  stableHash,
  stableStringify,
} from "./cache-freshness.js";
import { showCommandPanel } from "./command-panel-runtime.js";
import { compactBoundaryHash } from "./compact-context.js";
import {
  getAutoCompactTriggerChars,
  getProviderContextMaxChars,
  getProviderContextWindowChars,
  inspectToolPairingSafety,
  prepareMessagesForProviderPreflight,
  recordCompactBoundary,
} from "./compact-preflight-runtime.js";
import { estimateModelMessageChars } from "./context-estimator.js";
import {
  createDeepCompactProgress,
  maybeRunDeepCompactBeforeProvider,
  type runDeepCompact,
} from "./deep-compact-runtime.js";
import { deferredToolListHashInput, listDeferredTools } from "./deferred-tools-catalog.js";
import { ensureSession, writeStatus } from "./details-status-runtime.js";
import {
  appendSystemEvent,
  captureFailureLearning,
  createEvidenceRecord,
  recordToolFailureEvidence,
  recordToolResultBudgetEvidence,
  rememberEvidence,
} from "./evidence-runtime.js";
import type { FailureLearningInput } from "./failure-learning-runtime.js";
import { buildFailureLearningSummaryForPrompt } from "./failure-learning-runtime.js";
import { checkClaimSupport, formatClaimCheck } from "./final-answer-gate.js";
import { stabilizeMcpToolList } from "./mcp-index-runtime.js";
import type { MemoryMutation } from "./memory-command-runtime.js";
import { getRoleRoute } from "./model-doctor-runtime.js";
import { createModelSystemPrompt } from "./model-prompt-runtime.js";
import { buildModelMessagesWithRecentContext } from "./model-stream-runtime.js";
import {
  buildRuntimeStatusForModel,
  createModelCapabilitySummary,
} from "./natural-command-bridge.js";
import { formatPermissionDenied } from "./permission-continuation-runtime.js";
import { formatLocalToolPermissionPrompt } from "./permission-presenter.js";
import { LINGHUN_BYTES_PER_TOKEN } from "./runtime-budget.js";
import { addRoleUsage } from "./slash-command-runtime.js";
import { formatError, truncateDisplay, writeLine } from "./startup-runtime.js";
import { applyToolResultBudgetToMessages } from "./tool-result-budget.js";
import type {
  BreakCacheMutationAction,
  PendingModelContinuation,
  TuiContext,
} from "./tui-context-runtime.js";
import {
  MAX_CACHE_HISTORY_SIZE,
  MEMORY_PROMPT_ITEM_WIDTH,
  MEMORY_PROMPT_TOP_K,
  MEMORY_PROMPT_TOTAL_WIDTH,
  MIN_CACHE_HISTORY_SIZE,
  PROJECT_RULES_STATUS_WIDTH,
} from "./tui-context-runtime.js";
import type { CacheState, DeepCompactPacket, MemoryCandidate } from "./tui-data-types.js";
import {
  countMemoryScopes,
  createControlledMemoryInjection,
  createLinghunMdTemplate,
  formatControlledMemoryForModel,
} from "./tui-memory-runtime.js";
import {
  getActiveEndpointProfileLabel,
  getRuntimeStatusProvider,
  getSelectedModelRuntime,
} from "./tui-model-runtime.js";
import { writeErrorLine } from "./tui-output-surface.js";
import { decidePermission } from "./tui-permission-runtime.js";
import { normalizeMemoryStatus, summarizeProjectRules } from "./tui-state-runtime.js";
import { CHAT_COMPLETIONS_ENDPOINT } from "./usage-stats-presenter.js";
import { runVerificationPlan } from "./verification-command-runtime.js";
import {
  createWorkspaceReferenceCache,
  getWorkspaceReferenceSnapshot,
  workspaceReferenceHash,
} from "./workspace-reference-cache.js";
import type { WorkspaceReferenceCache } from "./workspace-reference-cache.js";

let _builtInToolsHashCache: string | undefined;

// Module 4 — abort controller helpers moved to ./tui-agent-job-runtime.ts

export async function handleClaimCheckCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const claim = args.join(" ").trim();
  if (!claim) {
    writeLine(output, "用法：/claim-check <claim>");
    return;
  }
  const result = checkClaimSupport(claim, context);
  const sessionId = await ensureSession(context);
  await context.store.appendEvent(sessionId, {
    type: "claim_check",
    id: randomUUID(),
    status: result.status,
    unsupportedClaims: result.unsupportedClaims,
    createdAt: new Date().toISOString(),
  });
  writeLine(output, formatClaimCheck(result, context.language));
}

export async function handleCacheLogCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  if (args[0] === "config" && args[1] === "size") {
    const size = Number.parseInt(args[2] ?? "", 10);
    if (!Number.isFinite(size) || size < MIN_CACHE_HISTORY_SIZE) {
      writeLine(output, `用法：/cache-log config size <n>，n >= ${MIN_CACHE_HISTORY_SIZE}`);
      return;
    }
    context.cache.config.maxTurns = Math.min(size, MAX_CACHE_HISTORY_SIZE);
    trimCacheHistory(context.cache);
    writeLine(
      output,
      `cache history size：${context.cache.config.maxTurns}，超过上限的旧记录已淘汰。`,
    );
    return;
  }
  if (args[0] === "export") {
    const path = args[1] ? resolve(context.projectPath, args[1]) : context.cache.config.persistPath;
    const sessionId = await ensureSession(context);
    const permission = await decidePermission(
      "Write",
      { path: relative(context.projectPath, path), content: "cache history export" },
      context,
      sessionId,
    );
    await context.store.appendEvent(sessionId, {
      type: "permission_request",
      request: permission.request,
      createdAt: new Date().toISOString(),
    });
    await context.store.appendEvent(sessionId, {
      type: "permission_result",
      requestId: permission.request.id,
      decision: permission.decision,
      reason: permission.reason,
      createdAt: new Date().toISOString(),
    });
    if (permission.decision !== "allow") {
      await recordToolFailureEvidence(
        context,
        sessionId,
        "Write",
        `cache-log export ${permission.decision}: ${permission.reason}`,
      );
      writeLine(output, formatPermissionDenied(permission.reason, permission.request.summary));
      writeStatus(output, context);
      return;
    }
    if (permission.preflight) {
      writeLine(output, permission.preflight);
    }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(context.cache.history, null, 2)}\n`, "utf8");
    const evidence = createEvidenceRecord(
      "command_output",
      `cache_log_export: ${relative(context.projectPath, path)}`,
      `cache-log:${relative(context.projectPath, path)}`,
      ["cache_log_export", "Write"],
    );
    rememberEvidence(context, evidence);
    await context.store.appendEvent(sessionId, { type: "evidence_record", ...evidence });
    writeLine(
      output,
      `已导出最近缓存日志：${path}。用于和 provider usage 或账号账单对账，金额仍以账单为准。`,
    );
    return;
  }
  if (args.length > 0) {
    writeLine(output, "用法：/cache-log | /cache-log config size <n> | /cache-log export [path]");
    return;
  }
  writeLine(output, formatCacheLog(context));
}

export async function handleCacheCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0];
  if (!action || action === "status") {
    // D.13Q-UX Task Surface — /cache 默认走降噪 CommandPanel。
    showCommandPanel(context, output, buildCacheStatusPanel(context, getCurrentFreshness(context)));
    return;
  }
  if (action === "warmup" || action === "refresh") {
    const runtimeStatus = buildRuntimeStatusForModel({
      ...context,
      provider: getRuntimeStatusProvider(context),
    });
    const snapshot = await refreshWorkspaceReferenceCache(context, runtimeStatus);
    const freshness = getCurrentFreshness(context);
    const changedKeys = diffFreshness(context.cache.lastFreshness, freshness);
    context.cache.lastFreshness = { ...freshness, changedKeys };
    writeLine(
      output,
      action === "warmup"
        ? `已尝试预热 cache。workspace reference ${snapshot.source}；该最小路径不保证 provider 一定写入缓存，请用 /cache status 或 provider usage 对账。`
        : `已尝试刷新 cache。workspace reference ${snapshot.source}；该最小路径不保证 provider 一定写入缓存，请用 /cache status 或 provider usage 对账。`,
    );
    return;
  }
  writeLine(output, "用法：/cache status | /cache warmup | /cache refresh");
}

export async function handleCompactCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0] ?? "run";
  if (action === "status") {
    await refreshCompactPressureSnapshot(context);
    writeLine(output, formatCompactStatus(context));
    return;
  }
  if (action === "manual" || action === "run" || action === "deep") {
    const resourceGuard =
      checkResourceGuard(context, "compact") ?? checkResourceGuard(context, "heavy");
    if (resourceGuard) {
      writeLine(output, resourceGuard);
      return;
    }
    const sessionId = await ensureSession(context);
    const runtime = getSelectedModelRuntime(context);
    if (!context.modelGateway) {
      writeLine(
        output,
        context.language === "en-US"
          ? "Deep compact unavailable: model gateway is not ready."
          : "Deep compact 不可用：模型网关尚未就绪。",
      );
      return;
    }
    const progress = createDeepCompactProgress();
    context.cache.compactProgress = progress;
    context.shellRerender?.();
    let result: Awaited<ReturnType<typeof runDeepCompact>> | undefined;
    try {
      result = await maybeRunDeepCompactBeforeProvider({
        context,
        sessionId,
        runtime,
        trigger: "manual",
        gateway: context.modelGateway,
        deps: compactPreflightDeps.runDeepCompact,
      });
    } finally {
      if (context.cache.compactProgress === progress) {
        context.cache.compactProgress = undefined;
      }
      context.shellRerender?.();
    }
    if (!result) {
      return;
    }
    if (result.ok === false) {
      writeLine(output, formatCompactRunFailure(context, result.message));
      return;
    }
    writeLine(output, formatCompactRunSuccess(context, result.packet));
    return;
  }
  if (action === "auto") {
    writeLine(
      output,
      "Compact auto：provider 压力触发时先尝试 deep compact agent（full transcript semantic compact，tools disabled/toolChoice none），再保留 provider-visible projection 作为 preflight safety layer。",
    );
    return;
  }
  writeLine(output, "用法：/compact status | /compact manual | /compact deep | /compact auto");
}

function formatCompactRunSuccess(context: TuiContext, packet: DeepCompactPacket): string {
  const progress = formatCompactProgressBar({
    status: "running",
    stages: ["complete"],
    preCompactChars: 0,
    postCompactChars: 0,
  });
  const preservedEvidence = packet.preservedEvidenceRefs.length;
  const preservedFiles = packet.preservedFiles.length;
  return [
    context.language === "en-US" ? "Deep compact completed." : "Deep compact 完成。",
    progress ? `- progress: ${progress}` : undefined,
    context.language === "en-US"
      ? `- retained: ${preservedEvidence} evidence refs; ${preservedFiles} files`
      : `- 保留：${preservedEvidence} 条 evidence 引用；${preservedFiles} 个文件线索`,
    context.language === "en-US"
      ? "- next: /compact status or /context for full diagnostics"
      : "- 下一步：用 /compact status 或 /context 查看完整诊断",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function formatCompactRunFailure(context: TuiContext, message: string): string {
  return [
    message,
    context.language === "en-US"
      ? "Full diagnostics are available in /compact status or /context."
      : "完整诊断可用 /compact status 或 /context 查看。",
  ].join("\n");
}

export async function refreshCompactPressureSnapshot(context: TuiContext): Promise<void> {
  if (!context.sessionId) {
    context.cache.compactPressure = undefined;
    return;
  }
  try {
    const runtimeStatus = buildRuntimeStatusForModel({
      ...context,
      provider: getRuntimeStatusProvider(context),
    });
    const systemPrompt = createModelSystemPrompt(
      "",
      context,
      runtimeStatus,
      undefined,
      undefined,
      buildFailureLearningSummaryForPrompt(context.failureLearning),
    );
    const messages = await buildModelMessagesWithRecentContext(
      context,
      context.sessionId,
      systemPrompt,
      "",
      getSelectedModelRuntime(context),
    );
    const runtime = getSelectedModelRuntime(context);
    const estimatedChars = estimateModelMessageChars(messages);
    const maxChars = getProviderContextMaxChars(context, runtime);
    const windowChars = getProviderContextWindowChars(context, runtime);
    const triggerChars = getAutoCompactTriggerChars(context, runtime);
    const updatedAt = new Date().toISOString();
    context.cache.compactPressure = {
      estimatedChars,
      maxChars,
      triggerChars,
      ratio: Number((estimatedChars / Math.max(1, maxChars)).toFixed(3)),
      toolPairingSafe: inspectToolPairingSafety(messages).safe,
      updatedAt,
    };
    context.cache.contextUsage = {
      estimatedChars,
      maxChars: windowChars,
      updatedAt,
      source: "pressure",
    };
  } catch (error) {
    await appendCompactPressureWarning(
      context,
      `compact_pressure_snapshot_failed reason=${formatError(error, context.language).replace(/\s+/g, " ")}`,
    );
    context.cache.compactPressure = undefined;
  }
}

async function appendCompactPressureWarning(context: TuiContext, message: string): Promise<void> {
  if (!context.sessionId) {
    process.stderr.write(`[linghun] ${message}\n`);
    return;
  }
  try {
    await context.store.appendEvent(context.sessionId, {
      type: "system_event",
      id: randomUUID(),
      level: "warning",
      message,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    process.stderr.write(
      `[linghun] ${message}; warning_write_failed=${formatError(error, context.language).replace(/\s+/g, " ")}\n`,
    );
  }
}

export async function handleBreakCacheCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0] ?? "status";
  // D.13F：standalone /break-cache 子命令。marker 写入与 event log 全部在 TUI/runtime 层完成；
  // packages/providers 不读不写本地文件。--clear 可放在第一个或第二个位置。
  const clearFlag = args.includes("--clear");
  if (action === "status" && !clearFlag) {
    writeLine(output, formatBreakCacheStatus(context, getCurrentFreshness(context)));
    return;
  }
  if (clearFlag) {
    if ((await requestBreakCacheMutationApproval(context, output, "clear")) !== "approved") {
      return;
    }
    await executeBreakCacheMutation("clear", context, output);
    return;
  }
  if (action === "once") {
    if ((await requestBreakCacheMutationApproval(context, output, "once")) !== "approved") {
      return;
    }
    await executeBreakCacheMutation("once", context, output);
    return;
  }
  if (action === "always") {
    if ((await requestBreakCacheMutationApproval(context, output, "always")) !== "approved") {
      return;
    }
    await executeBreakCacheMutation("always", context, output);
    return;
  }
  if (action === "off") {
    if ((await requestBreakCacheMutationApproval(context, output, "off")) !== "approved") {
      return;
    }
    await executeBreakCacheMutation("off", context, output);
    return;
  }
  writeLine(
    output,
    "用法：/break-cache status | /break-cache once | /break-cache always | /break-cache off | /break-cache --clear",
  );
}

export async function requestBreakCacheMutationApproval(
  context: TuiContext,
  output: Writable,
  action: BreakCacheMutationAction,
): Promise<"approved" | "blocked" | "pending"> {
  const sessionId = await ensureSession(context);
  const input = {
    path: ".linghun/break-cache",
    content: action,
    reason: `explicit /break-cache ${action}`,
  };
  const permission = await decidePermission("Write", input, context, sessionId);
  await context.store.appendEvent(sessionId, {
    type: "permission_request",
    request: permission.request,
    createdAt: new Date().toISOString(),
  });
  await context.store.appendEvent(sessionId, {
    type: "permission_result",
    requestId: permission.request.id,
    decision: permission.decision,
    reason: permission.reason,
    createdAt: new Date().toISOString(),
  });
  if (permission.decision === "ask") {
    context.pendingLocalApproval = { kind: "break_cache_mutation", sessionId, action };
    if (!context.isInkSession) {
      writeLine(
        output,
        formatLocalToolPermissionPrompt(
          {
            toolName: "Write",
            decision: permission.decision,
            risk: permission.request.risk,
            mode: permission.request.mode,
            reason: permission.reason,
            scope: permission.request.files,
          },
          context.language,
        ),
      );
      writeStatus(output, context);
    }
    return "pending";
  }
  if (permission.decision === "deny") {
    await recordToolFailureEvidence(
      context,
      sessionId,
      "Write",
      `permission ${permission.decision}: ${permission.reason}; break-cache ${action}`,
    );
    writeLine(
      output,
      context.language === "en-US"
        ? `Permission blocked break-cache ${action}: ${permission.reason}`
        : `权限阻止 break-cache ${action}：${permission.reason}`,
    );
    writeStatus(output, context);
    return "blocked";
  }
  if (permission.preflight) {
    writeLine(output, permission.preflight);
  }
  return "approved";
}

export async function executeBreakCacheMutation(
  action: BreakCacheMutationAction,
  context: TuiContext,
  output: Writable,
): Promise<void> {
  if (action === "clear") {
    // /break-cache --clear 或 /break-cache <mode> --clear：清掉 once+always 两个 marker。
    await clearBreakCacheMarker(context, "all");
    await appendBreakCacheEvent(context, "cleared");
    refreshCacheFreshness(context);
    writeLine(output, "已清除 break-cache marker（once + always）。下次请求不再附加 nonce。");
    writeLine(output, formatBreakCacheStatus(context, getCurrentFreshness(context)));
  } else if (action === "once") {
    const nonce = randomUUID();
    await writeBreakCacheMarker(context, "once", nonce);
    await appendBreakCacheEvent(context, "once_set");
    refreshCacheFreshness(context);
    writeLine(
      output,
      "已设置 once：下一次模型请求将附加 cacheBreakNonce 破坏前缀缓存，命中后自动消费。",
    );
  } else if (action === "always") {
    const nonce = randomUUID();
    await writeBreakCacheMarker(context, "always", nonce);
    await appendBreakCacheEvent(context, "always_set");
    refreshCacheFreshness(context);
    writeLine(
      output,
      "已设置 always：固定 break-cache namespace（stable nonce），所有请求共享同一 cacheBreakNonce，相当于切到一个新的 cache 命名空间，并在该命名空间内继续命中前缀缓存；不会每次请求都破坏缓存。运行 /break-cache off 或 --clear 取消。",
    );
  } else {
    await clearBreakCacheMarker(context, "all");
    await appendBreakCacheEvent(context, "off");
    refreshCacheFreshness(context);
    writeLine(output, "已关闭 break-cache：下次请求不再附加 nonce。");
  }
  await recordBreakCacheMutationEvidence(context, await ensureSession(context), action);
}

// Module 7 (tui-memory-runtime): formatMemoryLearningRun /
// createControlledMemoryInjection / estimateMemoryTokens /
// formatControlledMemoryForModel / createLinghunMdTemplate /
// formatProjectRulesRead moved out — see re-export+import block below.

// Module 7 — consolidated re-exports + value imports for /memory + LINGHUN.md helpers
// moved to ./tui-memory-runtime.ts. Coordinators that depend on ensureSession,
// store.appendEvent, appendSystemEvent, refreshCacheFreshness or writeLine stay
// in index.ts (Path A safety valve #2).

export function recordModelUsage(context: TuiContext, usage: ModelUsage): CacheTurnStats {
  const executorRoute = getRoleRoute(context.config, "executor");
  const freshness = getCurrentFreshness(context);
  const changedKeys = diffFreshness(context.cache.lastFreshness, freshness);
  const cacheReadTokens = usage.cacheReadTokens ?? 0;
  const cacheWriteTokensSource = classifyCacheWriteTokensSource(usage);
  const cacheWriteTokens = usage.cacheWriteTokens ?? 0;
  const provider = getRuntimeStatusProvider(context);
  const inputTokens = normalizeCacheInputTokens(usage, provider, cacheReadTokens, cacheWriteTokens);
  addRoleUsage(
    context,
    "executor",
    executorRoute,
    inputTokens,
    usage.outputTokens,
    "provider usage",
    { cacheReadTokens, cacheWriteTokens },
  );
  const stats: CacheTurnStats = {
    turn: context.cache.nextTurn,
    timestamp: Date.now(),
    hitRate: computePromptCacheHitRate({
      inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      provider,
      model: context.model,
    }),
    cacheReadTokens,
    cacheWriteTokens,
    cacheWriteTokensSource,
    inputTokens,
    outputTokens: usage.outputTokens,
    model: context.model,
    provider,
    endpoint: usage.endpoint ?? CHAT_COMPLETIONS_ENDPOINT,
    source:
      usage.cacheReadTokens === undefined && usage.cacheWriteTokens === undefined
        ? "estimated"
        : "api_usage",
    compacted: context.cache.compacted,
    freshness: { ...freshness, changedKeys },
    rawUsage: usage.rawUsage,
  };
  context.cache.nextTurn += 1;
  context.cache.lastFreshness = stats.freshness;
  context.cache.history.push(stats);
  trimCacheHistory(context.cache);
  return stats;
}

function normalizeCacheInputTokens(
  usage: ModelUsage,
  provider: string,
  cacheReadTokens: number,
  cacheWriteTokens: number,
): number {
  const inputTokens = Number.isFinite(usage.inputTokens) ? Math.max(0, usage.inputTokens) : 0;
  if (!isCacheInclusiveOpenAiUsage(usage, provider)) return inputTokens;
  return Math.max(0, inputTokens - cacheReadTokens - cacheWriteTokens);
}

function isCacheInclusiveOpenAiUsage(usage: ModelUsage, provider: string): boolean {
  const endpoint = usage.endpoint ?? CHAT_COMPLETIONS_ENDPOINT;
  if (endpoint === "/v1/messages") return false;
  if (provider !== "deepseek" && provider !== "openai-compatible") return false;
  if (!usage.rawUsage || typeof usage.rawUsage !== "object") return false;

  const rawUsage = usage.rawUsage as Record<string, unknown>;
  return (
    typeof rawUsage.prompt_tokens === "number" ||
    (typeof rawUsage.input_tokens === "number" && rawUsage.input_tokens_details !== undefined)
  );
}

export async function appendUsageEvents(
  context: TuiContext,
  sessionId: string,
  stats: CacheTurnStats,
): Promise<void> {
  const createdAt = new Date().toISOString();
  await context.store.appendEvent(sessionId, { type: "usage", usage: stats, createdAt });
  await context.store.appendEvent(sessionId, { type: "cache_update", stats, createdAt });
}

export function refreshCacheFreshness(context: TuiContext): void {
  const freshness = getCurrentFreshness(context);
  context.cache.lastFreshness = {
    ...freshness,
    changedKeys: diffFreshness(context.cache.lastFreshness, freshness),
  };
}

export async function requestMemoryMutationApproval(
  context: TuiContext,
  output: Writable,
  mutation: MemoryMutation,
): Promise<"approved" | "blocked" | "pending"> {
  const sessionId = await ensureSession(context);
  const input = createMemoryMutationPermissionInput(context, mutation);
  const permission = await decidePermission("Write", input, context, sessionId);
  await context.store.appendEvent(sessionId, {
    type: "permission_request",
    request: permission.request,
    createdAt: new Date().toISOString(),
  });
  await context.store.appendEvent(sessionId, {
    type: "permission_result",
    requestId: permission.request.id,
    decision: permission.decision,
    reason: permission.reason,
    createdAt: new Date().toISOString(),
  });

  if (permission.decision === "ask") {
    context.pendingLocalApproval = { kind: "memory_mutation", sessionId, mutation };
    if (!context.isInkSession) {
      writeLine(
        output,
        formatLocalToolPermissionPrompt(
          {
            toolName: "Write",
            decision: permission.decision,
            risk: permission.request.risk,
            mode: permission.request.mode,
            reason: permission.reason,
            scope: permission.request.files,
          },
          context.language,
        ),
      );
      writeStatus(output, context);
    }
    return "pending";
  }
  if (permission.decision === "deny") {
    await recordToolFailureEvidence(
      context,
      sessionId,
      "Write",
      `permission ${permission.decision}: ${permission.reason}; memory ${mutation.action}`,
    );
    writeLine(
      output,
      context.language === "en-US"
        ? `Permission blocked memory ${mutation.action}: ${permission.reason}`
        : `权限阻止 memory ${mutation.action}：${permission.reason}`,
    );
    writeStatus(output, context);
    return "blocked";
  }
  if (permission.preflight) {
    writeLine(output, permission.preflight);
  }
  return "approved";
}

function createMemoryMutationPermissionInput(
  context: TuiContext,
  mutation: MemoryMutation,
): Record<string, unknown> {
  if (mutation.action === "init") {
    return {
      path: "LINGHUN.md",
      content: createLinghunMdTemplate(context.language),
      reason: "explicit /memory init",
    };
  }
  const memory = "candidate" in mutation ? mutation.candidate : mutation.memory;
  return {
    path: memory.scope === "session" ? ".linghun/session-memory" : memoryFilePermissionPath(memory),
    content: memory.summary,
    reason: `explicit /memory ${mutation.action}`,
  };
}

function memoryFilePermissionPath(memory: MemoryCandidate): string {
  const root =
    memory.scope === "user"
      ? ".linghun/user-memory"
      : memory.scope === "project"
        ? ".linghun/memory"
        : ".linghun/session-memory";
  return `${root}/${memory.id}.json`;
}

export async function recordMemoryMutationEvidence(
  context: TuiContext,
  sessionId: string,
  action: string,
  memory: MemoryCandidate,
): Promise<void> {
  const summary =
    action === "init"
      ? "memory_mutation init: generated LINGHUN.md"
      : `memory_mutation ${action}: scope=${memory.scope} id=${memory.id} status=${memory.status}`;
  const source = action === "init" ? "memory:init:LINGHUN.md" : `memory:${action}:${memory.id}`;
  const evidence = createEvidenceRecord("command_output", summary, source, [
    "memory_mutation",
    `memory_${action}`,
    "Write",
  ]);
  rememberEvidence(context, evidence);
  await context.store.appendEvent(sessionId, { type: "evidence_record", ...evidence });
}

export async function recordBreakCacheMutationEvidence(
  context: TuiContext,
  sessionId: string,
  action: BreakCacheMutationAction,
): Promise<void> {
  const evidence = createEvidenceRecord(
    "command_output",
    `break_cache_mutation ${action}: marker updated`,
    `break-cache:${action}`,
    ["break_cache_mutation", `break_cache_${action}`, "Write"],
  );
  rememberEvidence(context, evidence);
  await context.store.appendEvent(sessionId, { type: "evidence_record", ...evidence });
}

export const compactPreflightDeps = {
  appendSystemEvent,
  captureFailureLearning,
  recordToolResultBudgetEvidence,
  refreshCacheFreshness,
  runDeepCompact: {
    appendSystemEvent,
    captureFailureLearning,
    refreshCacheFreshness,
    recordCompactBoundary,
  },
};

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase();
}

function classifyCacheWriteTokensSource(usage: ModelUsage): CacheWriteTokensSource {
  if (usage.cacheWriteTokensEstimated && typeof usage.cacheWriteTokens === "number") {
    return "estimated";
  }
  if (typeof usage.cacheWriteTokens === "number") {
    return usage.cacheWriteTokens === 0 ? "zero_reported" : "reported";
  }
  return "missing";
}

function trimCacheHistory(cache: CacheState): void {
  while (cache.history.length > cache.config.maxTurns) {
    cache.history.shift();
  }
}

export async function refreshWorkspaceReferenceCache(
  context: TuiContext,
  runtimeStatus: unknown,
): Promise<Awaited<ReturnType<typeof getWorkspaceReferenceSnapshot>>> {
  return getWorkspaceReferenceSnapshot(context.cache.workspaceReference, {
    projectPath: context.projectPath,
    dimensions: createWorkspaceReferenceDimensions(context),
    runtimeStatus,
    toolCapabilitySummary: createModelCapabilitySummary(24),
    evidenceRefs: context.evidence.map((item) => item.id),
    logRefs: context.backgroundTasks
      .flatMap((task) => [task.logPath, task.outputPath])
      .filter(isString),
  });
}

function createWorkspaceReferenceDimensions(context: TuiContext) {
  const runtime = getSelectedModelRuntime(context);
  if (!_builtInToolsHashCache) {
    _builtInToolsHashCache = stableHash(builtInTools);
  }
  return {
    configHash: stableHash(createConfigFreshnessSummary(context.config)),
    toolSchemaHash: _builtInToolsHashCache,
    providerModelHash: stableHash({ provider: runtime.provider, model: runtime.model }),
    mcpToolListHash: stableHash(stabilizeMcpToolList(context.mcp.tools)),
    indexFreshnessHash: stableHash({
      projectName: context.index.projectName,
      status: context.index.status,
      nodes: context.index.nodes,
      edges: context.index.edges,
      changedFiles: context.index.changedFiles,
      artifactStatus: context.index.artifactStatus,
    }),
    compactBoundaryHash: compactBoundaryHash(context.cache.compactBoundaries),
    extensionListHash: stableHash(createExtensionFreshnessSummary(context)),
  };
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function getCurrentFreshness(context: TuiContext): CacheFreshness {
  // Reuse cached builtInTools hash — builtInTools is a static import constant
  if (!_builtInToolsHashCache) {
    _builtInToolsHashCache = stableHash(builtInTools);
  }
  return createCacheFreshness({
    systemPrompt:
      context.language === "en-US" ? "Linghun EN system prompt" : "Linghun ZH system prompt",
    toolSchema: builtInTools,
    _precomputedToolSchemaHash: _builtInToolsHashCache,
    mcpToolList: stabilizeMcpToolList(context.mcp.tools),
    model: context.model,
    provider: getRuntimeStatusProvider(context),
    reasoningEffort: "default",
    projectRules: createProjectRulesFreshnessSummary(context),
    memory: createMemoryFreshnessSummary(context),
    compact: {
      compacted: context.cache.compacted,
      boundaryHash: compactBoundaryHash(context.cache.compactBoundaries),
      deepCompactId: context.cache.deepCompact?.id ?? "none",
    },
    plugins: {
      ...createExtensionFreshnessSummary(context),
      workspaceReferenceHash: workspaceReferenceHash(context.cache.workspaceReference.latest),
    },
    // D.13F：附加 endpointProfile / cacheControl / cacheTtl 维度，
    // 用于 /break-cache status 直接展示 prompt cache 配置变化。
    endpointProfile: getActiveEndpointProfileLabel(context),
    cacheControl: context.config.promptCache.enabled ? "ephemeral" : "off",
    cacheTtl: context.config.promptCache.systemTtl,
    // D.13I：deferred tools list 仅记录 name/kind/executable/requiredArgs，
    // 不含 raw schema/secret；与 toolSchemaHash（固定 builtIn + dispatch 两件套）解耦。
    deferredToolList: deferredToolListHashInput(listDeferredTools(context)),
  });
}

function createProjectRulesFreshnessSummary(context: TuiContext): string {
  return stableStringify({
    path: normalizePath(context.memory.projectRulesPath),
    exists: context.memory.projectRulesExists,
    summary: context.memory.projectRulesSummary,
    error: context.memory.projectRulesError ? "unreadable" : "none",
  });
}

function createMemoryFreshnessSummary(context: TuiContext): string {
  const summarize = (items: MemoryCandidate[]) =>
    items
      .map((item) => ({
        id: item.id,
        scope: item.scope,
        status: normalizeMemoryStatus(item),
        summary: item.summary,
        source: item.source,
      }))
      .sort((a, b) =>
        `${a.status}:${a.scope}:${a.id}:${a.summary}:${a.source}`.localeCompare(
          `${b.status}:${b.scope}:${b.id}:${b.summary}:${b.source}`,
        ),
      );
  return stableStringify({
    projectRules: context.memory.projectRulesSummary,
    candidates: summarize(context.memory.candidates),
    accepted: summarize(context.memory.accepted),
    disabled: summarize(context.memory.disabled),
    rejected: summarize(context.memory.rejected),
  });
}

function createExtensionFreshnessSummary(context: TuiContext): Record<string, unknown> {
  return {
    skills: context.skills.skills
      .map((skill) => ({
        id: skill.id,
        enabled: skill.enabled,
        source: skill.source,
        trusted: skill.trusted,
        triggers: skill.triggers,
        summary: skill.summary,
        permissions: skill.permissions,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    workflows: context.workflows.templates
      .map((workflow) => ({
        id: workflow.id,
        risk: workflow.risk,
        writesFiles: workflow.writesFiles,
        validation: workflow.recommendedValidation,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    hooks: context.hooks.hooks
      .map((hook) => ({
        id: hook.id,
        event: hook.event,
        enabled: hook.enabled,
        trusted: hook.trusted,
        permissions: hook.permissions,
      }))
      .sort((a, b) => `${a.event}:${a.id}`.localeCompare(`${b.event}:${b.id}`)),
    plugins: context.plugins.plugins
      .map((plugin) => ({
        id: plugin.id,
        enabled: plugin.enabled,
        source: plugin.source,
        trusted: plugin.trusted,
        permissions: plugin.permissions,
        contributions: plugin.contributions,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}
