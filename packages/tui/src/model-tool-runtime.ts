import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { Writable } from "node:stream";
import type { ModelGateway, ModelToolCall } from "@linghun/providers";
import { type Language, isNodeErrorWithCode } from "@linghun/shared";
import {
  type ToolName,
  type ToolOutput,
  type ToolProgressEvent,
  type ToolContext,
  type SourcePackCandidate,
  builtInTools,
  runTool,
} from "@linghun/tools";
import type { RegistryAgentDefinition } from "./agent-workflow-registry.js";
import type { BoundaryEditPreflightResult } from "./architecture-boundary.js";
import { checkBoundaryEditPreflight, detectBashFileWriteTargets } from "./architecture-boundary.js";
import { detectArchitectureDrift } from "./architecture-runtime.js";
import {
  collectPendingAgentCompletionNotices,
  markAgentCompletionNoticeReported,
} from "./agent-completion-finalizer.js";
import {
  checkBackgroundStartGuard,
  finishBackgroundTaskFromToolOutput,
} from "./background-control-runtime.js";
import { showCommandPanel } from "./command-panel-runtime.js";
import {
  findDeferredTool,
  getCodebaseMemoryToolRisk,
  isCodebaseMemoryToolName,
  parseMcpDeferredToolName,
  sanitizeDiscoveredDeferredToolName,
  validateCodebaseMemoryToolExecution,
} from "./deferred-tools-catalog.js";
import { createSilentOutput, ensureSession, t, writeStatus } from "./details-status-runtime.js";
import {
  appendBackgroundTaskEvent,
  appendDeferredToolResultEvent,
  appendDerivedToolEvents,
  appendSystemEvent,
  appendToolResultEvent,
  captureFailureLearning,
  createEvidenceRecord,
  createToolEndEvent,
  isToolOutputFailure,
  recordToolEvidence,
  recordToolFailureEvidence,
  recordToolResultBudgetEvidence,
  rememberEvidence,
} from "./evidence-runtime.js";
import { validateExtensionContributionExecution } from "./extension-command-runtime.js";
import { executeGitToolUse } from "./git-tool-dispatch-runtime.js";
import { isGitToolName } from "./git-tool-runtime.js";
import {
  INDEX_REFRESH,
  INDEX_REPAIR,
  INDEX_STATUS_INSPECT,
  isIndexToolName,
  isMutatingIndexTool,
  parseIndexRefreshInput,
  summarizeIndexRefreshOutcome,
  summarizeIndexStatusInspect,
} from "./index-tool-runtime.js";
import {
  cancelAgentByRef,
  cancelAllAgents,
  handleBackgroundCommand,
  handleForkCommand,
  handleJobCommand,
  sendAgentMessage,
} from "./job-agent-command-runtime.js";
import { formatBackgroundTask } from "./job-runner-presenter.js";
import { formatIndexRefreshSummary, formatIndexStatus } from "./mcp-index-command-runtime.js";
import {
  executeExtraTool,
  executeSearchExtraTools,
  refreshIndexStatus,
  runIndexRepository,
} from "./mcp-index-runtime.js";
import type { McpRuntimeProgress } from "./mcp-sse-runtime.js";
import {
  AGENT_CONTROL_TOOL_NAME,
  COMMAND_PROPOSAL_TOOL_NAME,
  EXECUTE_EXTRA_TOOL_NAME,
  INDEX_OPERATION_TOOL_NAME,
  PRE_CONTEXT_TOOL_NAME,
  PRE_IMPACT_TOOL_NAME,
  PRE_PLAN_TOOL_NAME,
  PRE_VERIFY_TOOL_NAME,
  RUN_VERIFICATION_TOOL_NAME,
  RUN_WORKFLOW_TOOL_NAME,
  SEARCH_EXTRA_TOOLS_NAME,
  SEND_MESSAGE_TOOL_NAME,
  START_AGENT_TOOL_NAME,
  WRITE_REPORT_TOOL_NAME,
  createToolUseDriftSummary,
  extractFileMentions,
  extractNaturalReadPath,
  hasModelSynthesisIntent,
  isPreEngineToolName,
  isNaturalReadFileRequest,
  looksLikeFilePath,
  normalizeRelativePath,
  readToolInputString,
  sanitizeDeferredToolPrimaryText,
} from "./model-loop-runtime.js";
import { clearRequestActivity, startRequestActivity } from "./model-stream-runtime.js";
import {
  type ReportWriteGuard,
  collectInputFiles,
  createReportTaskGuard,
  createReportWriteGuard,
  createReportWriteReminder,
  doesWriteSatisfyReportGuard,
  formatModelToolOutput,
  formatPermissionDenialPrimary,
  formatPermissionDenied,
  getHardDenyReason,
  hasRepeatedPermissionDenial,
  hasReportFinalAnswerShape,
  hasReportWriteToolCall,
  isLowRiskWorkspaceEdit,
  isPlanAllowedTool,
  isReportFileWriteRequest,
  normalizeReportPath,
  normalizeToolName,
  shouldSendReportFinalReferenceReminder,
  shouldSendReportWriteReminder,
} from "./permission-continuation-runtime.js";
import { classifyToolRequest, type PolicyVerdict } from "./permission-policy-engine.js";
import {
  formatLocalToolPermissionPrompt,
  formatModelToolPermissionPrompt,
} from "./permission-presenter.js";
import { runCommandCapture } from "./process-command-runtime.js";
import { createProcessGuard, requestTrackedProcessStop } from "./process-guard.js";
import { consumeRemoteInboundMessage } from "./remote-command-runtime.js";
import { processRemoteBindCommand } from "./remote-inbound-bridge-runtime.js";
import {
  formatReportIncompletePrimary,
} from "./request-lifecycle-presenter.js";
import {
  LINGHUN_BASH_MAX_OUTPUT_DEFAULT,
  LINGHUN_MAX_AGENTIC_TURNS,
  LINGHUN_MAX_EVIDENCE_TOOL_ROUNDS,
  LINGHUN_MAX_TOOL_RESULT_BYTES,
  LINGHUN_TASK_MAX_OUTPUT_DEFAULT,
} from "./runtime-budget.js";
import { gitToolDispatchDeps, runIndexSafetyRepair } from "./slash-command-runtime.js";
import {
  formatError,
  sanitizeDisplayPaths,
  truncateDisplay,
  uniqueStrings,
  writeLine,
} from "./startup-runtime.js";
import { formatToolOutput } from "./tool-output-presenter.js";
import {
  findDurableJob,
  isAgentType,
  listCancellableAgents,
  rememberBackgroundTask,
} from "./tui-agent-job-runtime.js";
import {
  createAgentBackgroundTask,
  createAgentContextSummary,
  getAgentRole,
} from "./tui-agent-job-runtime.js";
import {
  abortBackgroundTask,
  clearBackgroundAbortController,
  findAgent,
  formatAgentSummary,
  registerBackgroundAbortController,
} from "./tui-agent-job-runtime.js";
import { listDurableJobs } from "./tui-agent-job-runtime.js";
import type { PendingModelContinuation, TuiContext } from "./tui-context-runtime.js";
import { MAX_CHECKPOINTS } from "./tui-context-runtime.js";
import { createSingleToolCallContinuation } from "./tui-context-runtime.js";
import type {
  AgentRun,
  AgentType,
  BackgroundTaskState,
  CheckpointState,
  DurableJobState,
  PlanProposal,
  VerificationReport,
  WorkflowRunState,
  WorkflowTemplate,
} from "./tui-data-types.js";
import { getRuntimeStatusProvider } from "./tui-model-runtime.js";
import { getSelectedModelRuntime } from "./tui-model-runtime.js";
import { formatRoutePauseMessage, resolveRoleRoute } from "./tui-model-runtime.js";
import { writeErrorLine, writeLocalCommandOutputLine } from "./tui-output-surface.js";
import { decidePermission, toPermissionPromptView } from "./tui-permission-runtime.js";
import {
  createVerificationPlan,
  formatVerificationPlan,
  runVerificationPlan,
} from "./verification-command-runtime.js";
import {
  findRegistryAgentWorkflow,
  findRegistryWorkflow,
  formatWorkflowStartPrimary,
  handleWorkflowsCommand,
  runRegistryAgentWorkflow,
  runRegistryWorkflow,
  runWorkflowSteps,
  runWorkflowVerificationStep,
} from "./workflow-command-runtime.js";

type StructuredToolProgressEvent = ToolProgressEvent & {
  phase?: "connecting" | "receiving" | "processing";
  transport?: string;
  receivedBytes?: number;
  itemCount?: number;
};

/**
 * Extract a short target summary from tool input for ActivityIndicator display.
 * Returns e.g. "src/router.ts" for file tools, truncated command for Bash, etc.
 */
function extractToolTarget(toolName: string, input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const obj = input as Record<string, unknown>;
  // File-based tools: Read, Write, Edit, etc.
  if (typeof obj.file_path === "string") {
    return basename(obj.file_path);
  }
  if (typeof obj.path === "string" && typeof obj.pattern === "string") {
    // Grep/Glob — show pattern
    return obj.pattern.length > 30 ? `${obj.pattern.slice(0, 27)}…` : obj.pattern;
  }
  if (typeof obj.command === "string") {
    // Bash — first 40 chars of command
    const cmd = obj.command.trim();
    return cmd.length > 40 ? `${cmd.slice(0, 37)}…` : cmd;
  }
  if (typeof obj.query === "string") {
    const q = obj.query.trim();
    return q.length > 30 ? `${q.slice(0, 27)}…` : q;
  }
  return undefined;
}

export function formatAgentRunToolResultData(agent: AgentRun | undefined) {
  if (!agent) {
    return { status: "not_found" };
  }
  return {
    agentId: agent.id,
    status: agent.status,
    lastTerminalStatus: agent.lastTerminalStatus ?? null,
    transcriptSessionId: agent.transcriptSessionId,
    summary: agent.summary,
    recentResult: agent.lastResultSummary ?? agent.summary,
    resultFullReport: agent.lastResultFullReport ?? null,
  };
}

type StartAgentToolResult = {
  ok: boolean;
  text: string;
  data: {
    status: AgentRun["status"] | "blocked" | "not_found";
    agentId?: string;
    lastTerminalStatus?: AgentRun["lastTerminalStatus"] | null;
    transcriptSessionId?: string;
    summary?: string;
    recentResult?: string;
    resultFullReport?: string | null;
    lifecycleStatus: "not_started" | "running" | "terminal" | "blocked";
    terminal: boolean;
    completionClaimAllowed: boolean;
    nextAction: string;
  };
};

function buildStartAgentToolResult(
  agent: AgentRun | undefined,
  notStartedText: string,
  language: TuiContext["language"],
): StartAgentToolResult {
  if (!agent) {
    return {
      ok: false,
      text: notStartedText,
      data: {
        ...formatAgentRunToolResultData(agent),
        status: "blocked",
        lifecycleStatus: "not_started",
        terminal: false,
        completionClaimAllowed: false,
        nextAction:
          language === "en-US"
            ? "Check /background and /model doctor, then retry the real agent runtime."
            : "请先查看 /background 和 /model doctor，再重试真实 agent runtime。",
      },
    };
  }

  const terminalStatus = agent.lastTerminalStatus ?? agent.status;
  const terminal =
    agent.status === "idle" ||
    agent.status === "completed" ||
    terminalStatus === "completed" ||
    terminalStatus === "failed" ||
    terminalStatus === "blocked";
  const lifecycleStatus = terminal
    ? "terminal"
    : agent.status === "running"
      ? "running"
      : "blocked";
  const completionClaimAllowed = terminalStatus === "completed";
  const text =
    lifecycleStatus === "running"
      ? `Agent started and still running: ${agent.id}; ${agent.summary}`
      : lifecycleStatus === "terminal"
        ? `Agent terminal ${terminalStatus}: ${agent.id}; ${agent.summary}`
        : `Agent ${agent.status}: ${agent.id}; ${agent.summary}`;

  return {
    ok: lifecycleStatus === "running" || completionClaimAllowed,
    text,
    data: {
      ...formatAgentRunToolResultData(agent),
      status: agent.status,
      lifecycleStatus,
      terminal,
      completionClaimAllowed,
      nextAction:
        lifecycleStatus === "running"
          ? language === "en-US"
            ? "Do not claim delegated work is complete yet; wait for AgentCompletionReturnsForMainChain or inspect AgentControl show."
            : "不要声称委派工作已完成；等待 AgentCompletionReturnsForMainChain，或用 AgentControl show 查看。"
          : completionClaimAllowed
            ? language === "en-US"
              ? "Use the returned agent summary as child-agent context, not as independent verification PASS."
              : "把返回的 agent 摘要当作子 agent 上下文，不要当作独立验证 PASS。"
            : language === "en-US"
              ? "Inspect the child transcript or continue/cancel the agent before reporting completion."
              : "先查看子 transcript，或继续/取消该 agent，再报告完成状态。",
    },
  };
}

export function __testBuildStartAgentToolResult(
  agent: AgentRun | undefined,
  notStartedText: string,
  language: TuiContext["language"],
): StartAgentToolResult {
  return buildStartAgentToolResult(agent, notStartedText, language);
}

function formatPermissionAutoAllowEvent(toolName: string, verdict: PolicyVerdict): string {
  if (verdict.decision === "auto_allow_readonly") {
    return `permission auto allow readonly: tool ${toolName}; semantic ${verdict.semantic}; path safety ${verdict.pathSafety}; summary ${verdict.redactedSummary}; reason ${verdict.reason}`;
  }
  return `permission ${verdict.decision}: tool ${toolName}; semantic ${verdict.semantic}; path safety ${verdict.pathSafety}; summary ${verdict.redactedSummary}; reason ${verdict.reason}`;
}

export async function executeModelToolUse(
  toolCall: ModelToolCall,
  context: TuiContext,
  sessionId: string,
  output: Writable,
  continuation?: PendingModelContinuation,
  architectureDriftConfirmed = false,
): Promise<{
  ok: boolean;
  tool: string;
  text: string;
  data?: unknown;
  evidenceId?: string;
  pendingApproval?: boolean;
}> {
  // D.13I：SearchExtraTools / ExecuteExtraTool 不走 builtInTools / runTool / permission 分支，
  // 但仍走既有 tool_call_start / tool_result / evidence 链路；不重复 architecture drift /
  // permission 状态机，因为这两个工具本身不写文件、不执行 shell——它们的"风险"由其分发到的
  // 子工具承担（codebase-memory 只读 + 命令白名单 + required args 校验）。
  if (
    toolCall.name === SEARCH_EXTRA_TOOLS_NAME ||
    toolCall.name === EXECUTE_EXTRA_TOOL_NAME ||
    toolCall.name === COMMAND_PROPOSAL_TOOL_NAME
  ) {
    return executeDeferredDispatchToolUse(toolCall, context, sessionId, output, continuation);
  }
  if (isPreEngineToolName(toolCall.name)) {
    return executePreEngineToolUse(toolCall, context, sessionId, output);
  }
  // D.14G — 结构化 Git 能力不走 builtInTools / runTool / 四档 permission；由
  // git-tool-dispatch-runtime 真实执行（status 只读；create safe-create；remove 走确认）。
  if (isGitToolName(toolCall.name)) {
    const gitResult = await executeGitToolUse(
      toolCall,
      context,
      sessionId,
      output,
      gitToolDispatchDeps,
      continuation,
    );
    // D.14B — git 操作真实失败转 failure learning。pendingApproval（等待用户确认）
    // 不是失败，不记录；只有 runtime 真正失败/拒绝（ok=false 且非 pending）才记。
    if (!gitResult.ok && !gitResult.pendingApproval) {
      await captureFailureLearning(context, sessionId, {
        category: "git_operation_failure",
        failureSummary: `git operation failed: ${gitResult.text}`,
        rootCauseGuess: `${toolCall.name} git operation failed or was rejected by runtime validation`,
        avoidNextTime:
          "Check repo/worktree state and arguments before retrying the git operation; do not claim it succeeded",
        sourceRef: gitResult.evidenceId
          ? `evidence:${gitResult.evidenceId}`
          : `tool:${toolCall.name}`,
        relatedTarget: toolCall.name,
        severity: "medium",
      });
    }
    return gitResult;
  }
  // D.14D-R P0-2 — 结构化索引工具不走 builtInTools / runTool；只读 Inspect 直接执行，
  // mutating Refresh/Repair 走既有 pendingLocalApproval / PermissionPanel 确认管道。
  if (isIndexToolName(toolCall.name)) {
    return executeIndexToolUse(toolCall, context, sessionId, output, continuation);
  }
  if (
    toolCall.name === START_AGENT_TOOL_NAME ||
    toolCall.name === AGENT_CONTROL_TOOL_NAME ||
    toolCall.name === SEND_MESSAGE_TOOL_NAME ||
    toolCall.name === RUN_WORKFLOW_TOOL_NAME ||
    toolCall.name === INDEX_OPERATION_TOOL_NAME ||
    toolCall.name === RUN_VERIFICATION_TOOL_NAME ||
    toolCall.name === WRITE_REPORT_TOOL_NAME
  ) {
    return executeLinghunControlToolUse(toolCall, context, sessionId, output, continuation);
  }
  const toolName = normalizeToolName(toolCall.name);
  if (!toolName) {
    return { ok: false, tool: toolCall.name, text: `Unknown tool: ${toolCall.name}` };
  }
  const architectureDrift =
    !architectureDriftConfirmed &&
    context.currentArchitectureCard &&
    shouldConfirmArchitectureDriftForTool(toolName)
      ? detectArchitectureDrift(context.currentArchitectureCard, {
          toolName,
          input: toolCall.input,
          summary: createToolUseDriftSummary(toolName, toolCall.input),
        })
      : undefined;
  const permission = await decidePermission(
    toolName,
    toolCall.input,
    context,
    sessionId,
    architectureDrift?.drift ? { architectureDrift: { warnings: architectureDrift.warnings } } : undefined,
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
  await appendPolicyToolFeedback(
    context,
    sessionId,
    `permission verdict: tool ${toolName}; decision ${permission.decision}; risk ${permission.request.risk}; mode ${permission.request.mode}`,
    permission.decision === "allow" ? "info" : "warning",
  );
  if (permission.architectureDrift) {
    await appendSystemEvent(
      context,
      sessionId,
      `architecture drift ${permission.decision}: tool ${toolName}; mode ${context.permissionMode}; warnings ${permission.architectureDrift.warnings.join("|")}`,
      permission.decision === "allow" ? "info" : "warning",
    );
    await appendPolicyToolFeedback(
      context,
      sessionId,
      `architecture drift ${permission.decision}: tool ${toolName}; warnings ${permission.architectureDrift.warnings.join("|")}`,
      permission.decision === "allow" ? "info" : "warning",
    );
  }
  if (permission.autoAllowPolicy) {
    // Engine short-circuited this tool to an auto-allow policy path.
    // Record a structured event for transparency. Payload is sanitized: the
    // engine returns redactedSummary, never raw command text or absolute
    // sensitive paths, so this event is safe to ship in transcripts.
    const verdict = permission.autoAllowPolicy;
    await appendSystemEvent(
      context,
      sessionId,
      formatPermissionAutoAllowEvent(toolName, verdict),
      "info",
    );
  }
  if (permission.decision !== "allow") {
    clearRequestActivity(context);
    const text = `${permission.decision}: ${permission.reason}`;
    const isAskWithPanel = permission.decision === "ask";
    // P0-1 — ink 主屏的提权 UI 必须是 PermissionPanel（pendingLocalApproval →
    // mapPendingApprovalToPermission → view.permission），不得用 writeLine 把
    // "Linghun 想执行 …？yes/no" 当作普通 assistant/output 文本糊到主屏。
    // ink ask 路径只设 pendingLocalApproval，由 PermissionPanel 渲染；
    // ink deny 路径只回灌工具失败，避免把不可批准的 yes/no prompt 写进主屏 scrollback。
    // plain TUI / 非交互 / 测试仍走文本 yes/no fallback（保留既有断言）。
    if (!context.isInkSession) {
      writeLine(
        output,
        formatModelToolPermissionPrompt(toPermissionPromptView(permission), context.language),
      );
    }
    if (isAskWithPanel) {
      const pendingContinuation = continuation
        ? createSingleToolCallContinuation(continuation, toolCall)
        : undefined;
      context.pendingLocalApproval = permission.architectureDrift
        ? {
            kind: "architecture_drift",
            toolCall,
            toolName,
            sessionId,
            warnings: permission.architectureDrift.warnings,
            continuation: pendingContinuation,
            verdict: permission.verdict,
          }
        : {
            kind: "model_tool_use",
            toolCall,
            toolName,
            sessionId,
            continuation: pendingContinuation,
            verdict: permission.verdict,
          };
      return { ok: false, tool: toolName, text, pendingApproval: true };
    }
    const evidence = await recordToolFailureEvidence(
      context,
      sessionId,
      toolName,
      `permission ${permission.decision}: ${permission.reason}; ${permission.request.summary}`,
    );
    await appendToolResultEvent(context, sessionId, toolCall.id, toolName, text, true, evidence.id);
    return { ok: false, tool: toolName, text, evidenceId: evidence.id };
  }
  const boundaryPreflight =
    context.permissionMode === "full-access" || context.permissionMode === "auto-review"
      ? { decision: "allow" as const, reason: `${context.permissionMode} skips TUI boundary confirmation` }
      : await runBoundaryEditPreflight(toolCall, toolName, context);
  if (boundaryPreflight.decision === "confirm") {
    clearRequestActivity(context);
    const prompt = formatBoundaryEditPreflightPrompt(boundaryPreflight, context.language);
    if (!context.isInkSession) {
      writeLine(output, prompt);
    }
    context.pendingLocalApproval = {
      kind: "model_tool_use",
      toolCall,
      toolName,
      sessionId,
      continuation: continuation
        ? createSingleToolCallContinuation(continuation, toolCall)
        : undefined,
      verdict: permission.verdict,
      boundaryPreflight,
    };
    await appendSystemEvent(
      context,
      sessionId,
      `architecture_boundary_preflight_confirm: tool=${toolName} path=${boundaryPreflight.path} lines=${boundaryPreflight.lineCount} added=${boundaryPreflight.estimatedAddedLines}`,
      "warning",
    );
    return { ok: false, tool: toolName, text: boundaryPreflight.reason, pendingApproval: true };
  }
  return executeApprovedModelToolUse(
    toolCall,
    toolName,
    context,
    sessionId,
    output,
    permission.preflight,
    continuation?.reportWriteGuard,
    continuation?.requestTurnId && continuation.abortSignal
      ? { requestTurnId: continuation.requestTurnId, signal: continuation.abortSignal }
      : undefined,
  );
}

function shouldConfirmArchitectureDriftForTool(toolName: ToolName): boolean {
  return (
    toolName === "Write" ||
    toolName === "Edit" ||
    toolName === "MultiEdit" ||
    toolName === "Bash"
  );
}

async function runBoundaryEditPreflight(
  toolCall: ModelToolCall,
  toolName: ToolName,
  context: TuiContext,
): Promise<BoundaryEditPreflightResult> {
  if (toolName === "Bash") {
    return runBoundaryBashPreflight(toolCall, context);
  }
  if (toolName !== "Write" && toolName !== "Edit" && toolName !== "MultiEdit") {
    return { decision: "allow", reason: "not an edit tool" };
  }
  const [path] = collectInputFiles(toolCall.input);
  if (!path || isReportArtifactPath(path)) {
    return { decision: "allow", reason: "no path or report artifact" };
  }
  const absolutePath = resolve(context.projectPath, path);
  try {
    const source = await readFile(absolutePath, "utf8");
    return checkBoundaryEditPreflight({
      toolName,
      path,
      existingSource: source,
      targetExists: true,
      input: toolCall.input,
      reportArtifact: false,
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { decision: "allow", reason: "target does not exist" };
    }
    return { decision: "allow", reason: "target not readable by boundary preflight" };
  }
}

function isReportArtifactPath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  const fileName = normalized.split("/").pop() ?? normalized;
  return /\.md$/u.test(fileName) && (fileName === "report.md" || /report|报告/u.test(fileName));
}

async function runBoundaryBashPreflight(
  toolCall: ModelToolCall,
  context: TuiContext,
): Promise<BoundaryEditPreflightResult> {
  const command = extractBashCommand(toolCall.input);
  if (!command) return { decision: "allow", reason: "no readable command" };
  const targets = detectBashFileWriteTargets(command);
  if (targets.length === 0) return { decision: "allow", reason: "no file-write pattern detected" };
  for (const target of targets) {
    const absolutePath = resolve(context.projectPath, target);
    try {
      const source = await readFile(absolutePath, "utf8");
      const result = checkBoundaryEditPreflight({
        toolName: "Bash",
        path: target,
        existingSource: source,
        targetExists: true,
        input: toolCall.input,
        reportArtifact: false,
      });
      if (result.decision === "confirm") return result;
    } catch (error) {
      if (!isNodeErrorWithCode(error, "ENOENT")) {
        await appendBoundaryPreflightWarning(
          context,
          `boundary_bash_preflight_read_failed path=${target} reason=${formatError(error, context.language).replace(/\s+/g, " ")}`,
        );
      }
    }
  }
  return { decision: "allow", reason: "no target matched large-file thresholds" };
}

async function appendBoundaryPreflightWarning(context: TuiContext, message: string): Promise<void> {
  if (!context.sessionId) {
    process.stderr.write(`[linghun] ${message}\n`);
    return;
  }
  try {
    await appendSystemEvent(context, context.sessionId, message, "warning");
  } catch (error) {
    process.stderr.write(
      `[linghun] ${message}; warning_write_failed=${formatError(error, context.language).replace(/\s+/g, " ")}\n`,
    );
  }
}

function extractBashCommand(input: unknown): string | undefined {
  if (typeof input === "object" && input !== null) {
    const raw = input as Record<string, unknown>;
    if (typeof raw.command === "string" && raw.command.trim()) return raw.command.trim();
    if (typeof raw.command === "object" && raw.command !== null) {
      const cmdObj = raw.command as Record<string, unknown>;
      if (typeof cmdObj.command === "string" && cmdObj.command.trim()) return cmdObj.command.trim();
    }
  }
  return undefined;
}

export function formatBoundaryEditPreflightPrompt(
  preflight: BoundaryEditPreflightResult & { decision: "confirm" },
  language: Language,
): string {
  if (language === "en-US") {
    return [
      `Architecture boundary check paused ${preflight.path}.`,
      `Existing file has ${preflight.lineCount} lines; this edit appears to add about ${preflight.estimatedAddedLines} lines.`,
      "Choose yes to continue this minimal local edit, or no to ask the assistant for a split plan.",
    ].join("\n");
  }
  return [
    `架构边界检查已暂停 ${preflight.path}。`,
    `目标文件已有 ${preflight.lineCount} 行，本次看起来会新增约 ${preflight.estimatedAddedLines} 行。`,
    "输入 yes 继续这次最小局部改动；输入 no 让模型改为拆分计划或更小改动。",
  ].join("\n");
}

export async function executeApprovedModelToolUse(
  toolCall: ModelToolCall,
  toolName: ToolName,
  context: TuiContext,
  sessionId: string,
  output: Writable,
  preflight?: string,
  reportWriteGuard?: ReportWriteGuard,
  requestOwner?: { requestTurnId: string; signal: AbortSignal },
): Promise<{
  ok: boolean;
  tool: string;
  text: string;
  data?: unknown;
  evidenceId?: string;
  modelContent?: unknown;
}> {
  if (preflight) {
    writeLine(output, preflight);
  }
  if (toolName === "Bash" && shouldTrackBashAsBackground(toolCall.input)) {
    const guard = checkBackgroundStartGuard(context, "bash", true);
    if (guard) {
      const evidence = await recordToolFailureEvidence(context, sessionId, toolName, guard);
      await appendToolResultEvent(
        context,
        sessionId,
        toolCall.id,
        toolName,
        guard,
        true,
        evidence.id,
      );
      return { ok: false, tool: toolName, text: guard, evidenceId: evidence.id };
    }
  }
  const task =
    toolName === "Bash" && shouldTrackBashAsBackground(toolCall.input)
      ? createBackgroundTask(toolName, toolCall.input, context)
      : undefined;
  if (task) {
    task.ownerSessionId = sessionId;
    rememberBackgroundTask(context, task);
    await appendBackgroundTaskEvent(context, sessionId, task);
  }
  const activityOwner = requestOwner
    ? { kind: "foreground" as const, requestTurnId: requestOwner.requestTurnId }
    : undefined;
  const requestIsStale = (): boolean =>
    Boolean(
      requestOwner &&
        (requestOwner.signal.aborted || context.currentRequestTurnId !== requestOwner.requestTurnId),
    );
  startRequestActivity(output, context, "tool_running", {
    toolName,
    toolTarget: extractToolTarget(toolName, toolCall.input),
    toolUseId: toolCall.id,
    ...(requestOwner ? { requestTurnId: requestOwner.requestTurnId } : {}),
  });
  await context.store.appendEvent(sessionId, {
    type: "tool_call_start",
    id: toolCall.id,
    name: toolName,
    input: toolCall.input,
    createdAt: new Date().toISOString(),
  });
  const backgroundController = task
    ? registerBackgroundAbortController(context, task.id)
    : undefined;
  const previousAbortSignal = context.tools.abortSignal;
  if (backgroundController) {
    context.tools.abortSignal = backgroundController.signal;
  }
  const clearToolRequestActivity = (): void => {
    if (context.requestActivityToolUseId === toolCall.id) {
      clearRequestActivity(context, activityOwner);
    }
  };
  const cleanupFinishedTool = (): void => {
    clearBackgroundAbortController(context, task?.id ?? "");
    if (backgroundController && context.tools.abortSignal === backgroundController.signal) {
      context.tools.abortSignal = previousAbortSignal;
    }
    clearToolRequestActivity();
  };
  const dropStaleToolResult = async (
    kind: "result" | "error",
  ): Promise<{ ok: false; tool: string; text: string }> => {
    cleanupFinishedTool();
    context.evidence = context.evidence.filter((item) => item.toolUseId !== toolCall.id);
    await appendSystemEvent(
      context,
      sessionId,
      `stale_tool_${kind}_dropped: tool=${toolName}; toolUseId=${toolCall.id}; requestTurnId=${requestOwner?.requestTurnId ?? "none"}`,
      "warning",
    );
    return {
      ok: false,
      tool: toolName,
      text: `cancelled: stale foreground tool ${kind} discarded`,
    };
  };
  const progress = installToolProgressHandler(
    context,
    sessionId,
    toolCall.id,
    output,
    task,
    requestOwner,
  );
  // R1: tool start banner suppressed by default (noise reduction).
  // Verbose/brief mode (R7) will re-enable when needed.
  try {
    const result = await runTool(toolName, toolCall.input, progress.toolContext);
    progress.restore();
    await Promise.all(progress.pending);
    if (requestIsStale()) {
      return dropStaleToolResult("result");
    }
    clearToolRequestActivity();
    await context.store.appendEvent(
      sessionId,
      createToolEndEvent(toolCall.id, result.output),
      () => !requestIsStale(),
    );
    if (requestIsStale()) {
      return dropStaleToolResult("result");
    }
    await appendDerivedToolEvents(context, sessionId, toolName, result.output);
    if (requestIsStale()) {
      return dropStaleToolResult("result");
    }
    const isError = isToolOutputFailure(toolName, result.output);
    const evidence =
      isError && (toolName === "WebSearch" || toolName === "WebFetch")
        ? await recordToolFailureEvidence(
            context,
            sessionId,
            toolName,
            result.output.text,
            () => !requestIsStale(),
            toolCall.id,
          )
        : await recordToolEvidence(
            context,
            sessionId,
            toolName,
            result.output,
            toolCall.input,
            () => !requestIsStale(),
            toolCall.id,
          );
    if (requestIsStale()) {
      return dropStaleToolResult("result");
    }
    if (
      reportWriteGuard &&
      (toolName === "Read" ||
        toolName === "ReadSnippets" ||
        toolName === "SourcePack" ||
        toolName === "Glob" ||
        toolName === "Grep")
    ) {
      reportWriteGuard.evidenceRead = true;
    }
    rememberToolFiles(context, toolName, toolCall.input, result.output);
    if (task) {
      const bgData = result.output.data as { backgroundTaskId?: string; outputPath?: string } | undefined;
      if (bgData?.backgroundTaskId) {
        // Background bash started — register correlation, don't finish yet
        context.backgroundBashTaskMap?.set(bgData.backgroundTaskId, task.id);
        task.outputPath = bgData.outputPath;
      } else {
        finishBackgroundTaskFromToolOutput(task, result.output, context);
      }
      await appendBackgroundTaskEvent(context, sessionId, task);
    }
    if (requestIsStale()) {
      return dropStaleToolResult("result");
    }
    const modelContent = await appendToolResultEvent(
      context,
      sessionId,
      toolCall.id,
      toolName,
      result.output,
      isError,
      evidence?.id,
      () => !requestIsStale(),
    );
    if (requestIsStale()) {
      return dropStaleToolResult("result");
    }
    const webFailureData =
      isError && (toolName === "WebSearch" || toolName === "WebFetch")
        ? (result.output.data as { aborted?: unknown; timedOut?: unknown } | undefined)
        : undefined;
    if (isError && webFailureData?.aborted !== true) {
      const isWebFailure = webFailureData !== undefined;
      await captureFailureLearning(context, sessionId, {
        category: "tool_failure",
        failureSummary: isWebFailure
          ? `${toolName} ${webFailureData.timedOut === true ? "timed out" : "failed"}: ${result.output.text}`
          : `${toolName} exited non-zero: ${result.output.text}`,
        rootCauseGuess: isWebFailure
          ? webFailureData.timedOut === true
            ? `${toolName} exceeded its request timeout`
            : `${toolName} returned a structured failure result`
          : `${toolName} command returned a non-zero exit code`,
        avoidNextTime: isWebFailure
          ? "Inspect the structured Web failure details and retry or adjust the request without claiming success"
          : "Inspect the command output and exit code; fix the underlying cause before claiming the command passed",
        sourceRef: evidence?.id ? `evidence:${evidence.id}` : `tool:${toolName}`,
        relatedTarget: toolName,
        severity: "medium",
      });
      await appendPolicyToolFeedback(
        context,
        sessionId,
        `tool failure: tool ${toolName}; evidence ${evidence?.id ?? "none"}`,
        "warning",
      );
    }
    const bgStarted = !!(result.output.data as { backgroundTaskId?: string } | undefined)?.backgroundTaskId;
    if (!bgStarted) {
      clearBackgroundAbortController(context, task?.id ?? "");
    }
    if (backgroundController && context.tools.abortSignal === backgroundController.signal) {
      context.tools.abortSignal = previousAbortSignal;
    }
    const userFacingToolOutput = formatModelToolOutput(
      toolName,
      result.output,
      context.language,
      evidence?.id,
      reportWriteGuard,
    );
    if (isError && (toolName === "WebSearch" || toolName === "WebFetch")) {
      writeErrorLine(output, userFacingToolOutput);
    } else if (toolName === "Bash") {
      writeLocalCommandOutputLine(output, userFacingToolOutput);
    } else {
      writeLine(output, userFacingToolOutput);
    }
    return {
      ok: !isError,
      tool: toolName,
      text: result.output.text,
      data: result.output.data,
      evidenceId: evidence?.id,
      modelContent,
    };
  } catch (error) {
    progress.restore();
    await Promise.all(progress.pending);
    cleanupFinishedTool();
    if (requestIsStale()) {
      return dropStaleToolResult("error");
    }
    const text = formatError(error, context.language);
    if (requestIsStale()) {
      return dropStaleToolResult("error");
    }
    const evidence = await recordToolFailureEvidence(
      context,
      sessionId,
      toolName,
      text,
      () => !requestIsStale(),
      toolCall.id,
    );
    if (requestIsStale()) {
      return dropStaleToolResult("error");
    }
    await appendToolResultEvent(
      context,
      sessionId,
      toolCall.id,
      toolName,
      text,
      true,
      evidence.id,
      () => !requestIsStale(),
    );
    await captureFailureLearning(context, sessionId, {
      category: "tool_failure",
      failureSummary: text,
      rootCauseGuess: `${toolName} tool threw an error during execution`,
      avoidNextTime: `Re-check ${toolName} inputs/preconditions before retrying; verify the error, do not assume it succeeded`,
      sourceRef: `evidence:${evidence.id}`,
      relatedTarget: toolName,
      severity: "medium",
    });
    await appendPolicyToolFeedback(
      context,
      sessionId,
      `tool failure: tool ${toolName}; evidence ${evidence.id}`,
      "warning",
    );
    return { ok: false, tool: toolName, text, evidenceId: evidence.id };
  }
}

async function appendPolicyToolFeedback(
  context: TuiContext,
  sessionId: string,
  summary: string,
  level: "info" | "warning" = "info",
): Promise<void> {
  await appendSystemEvent(context, sessionId, `policy_tool_feedback: ${summary}`, level);
}

// Module 3 — toPermissionPromptView 已移至 ./tui-permission-runtime.ts。

// D.13I：deferred dispatch 的特殊执行路径。复用 tool_call_start / tool_result / evidence
// 三件套，但不调用 runTool（因为 SearchExtraTools / ExecuteExtraTool 不在 builtInTools 里）。
// 失败仍写 evidence，便于 verifier / /details 排查。
export async function executeDeferredDispatchToolUse(
  toolCall: ModelToolCall,
  context: TuiContext,
  sessionId: string,
  output: Writable,
  continuation?: PendingModelContinuation,
): Promise<{
  ok: boolean;
  tool: string;
  text: string;
  data?: unknown;
  evidenceId?: string;
}> {
  const dispatchName = toolCall.name;
  const requestTurnId = continuation?.requestTurnId;
  const requestSignal = continuation?.abortSignal ?? context.tools.abortSignal;
  const activityOwner = requestTurnId
    ? { kind: "foreground" as const, requestTurnId }
    : undefined;
  const requestIsStale = () =>
    requestSignal?.aborted === true ||
    Boolean(requestTurnId && context.currentRequestTurnId !== requestTurnId);
  const dropStaleResult = () => {
    context.evidence = context.evidence.filter((item) => item.toolUseId !== toolCall.id);
    return {
      ok: false,
      tool: dispatchName,
      text: "cancelled: stale deferred tool result discarded",
    };
  };
  const initialToolTarget = extractToolTarget(dispatchName, toolCall.input);
  startRequestActivity(output, context, "tool_running", {
    toolName: dispatchName,
    toolTarget: initialToolTarget,
    toolUseId: toolCall.id,
    ...(requestTurnId ? { requestTurnId } : {}),
  });
  const clearDeferredActivity = (): void => {
    if (context.requestActivityToolUseId === toolCall.id) {
      clearRequestActivity(context, activityOwner);
    }
  };
  let lastMcpProgressAt = Number.NEGATIVE_INFINITY;
  let lastMcpProgressPhase: McpRuntimeProgress["phase"] | undefined;
  const updateMcpProgress = (progress: McpRuntimeProgress): void => {
    if (requestIsStale() || context.requestActivityToolUseId !== toolCall.id) return;
    const now = Date.now();
    if (progress.phase === lastMcpProgressPhase && now - lastMcpProgressAt < 1_000) return;
    lastMcpProgressAt = now;
    lastMcpProgressPhase = progress.phase;
    const details = [
      initialToolTarget,
      progress.phase,
      progress.transport,
      progress.receivedBytes !== undefined
        ? formatWebProgressBytes(progress.receivedBytes)
        : undefined,
      progress.itemCount !== undefined ? `${progress.itemCount} items` : undefined,
    ].filter((value): value is string => Boolean(value));
    (context as { requestActivityToolTarget?: string }).requestActivityToolTarget =
      details.join(" · ");
    context.shellRerender?.();
  };
  await context.store.appendEvent(sessionId, {
    type: "tool_call_start",
    id: toolCall.id,
    name: dispatchName,
    input: toolCall.input,
    createdAt: new Date().toISOString(),
  });
  if (requestIsStale()) return dropStaleResult();
  try {
    const input = (
      toolCall.input && typeof toolCall.input === "object" && !Array.isArray(toolCall.input)
        ? toolCall.input
        : {}
    ) as Record<string, unknown>;
    if (dispatchName === SEARCH_EXTRA_TOOLS_NAME) {
      const queryRaw = input.query;
      if (typeof queryRaw !== "string") {
        const text = "SearchExtraTools: query 必须是字符串（可为空字符串）。";
        const evidence = await recordToolFailureEvidence(
          context,
          sessionId,
          "Read",
          `${dispatchName}: ${text}`,
        );
        await appendDeferredToolResultEvent(
          context,
          sessionId,
          toolCall.id,
          dispatchName,
          text,
          true,
          evidence.id,
        );
        clearRequestActivity(context, activityOwner);
        return { ok: false, tool: dispatchName, text, evidenceId: evidence.id };
      }
      const result = executeSearchExtraTools(queryRaw, context);
      const evidence = await recordToolEvidence(context, sessionId, "Read", {
        text: result.text,
        data: result.data,
      } as ToolOutput);
      await appendDeferredToolResultEvent(
        context,
        sessionId,
        toolCall.id,
        dispatchName,
        { text: result.text, data: result.data },
        false,
        evidence?.id,
      );
      clearRequestActivity(context, activityOwner);
      // D.13V-C — 主屏只显示降噪后的产品文案；raw text 已经写入 tool_result store，
      // doctor / details / Ctrl+O 仍可看到。
      writeLine(
        output,
        sanitizeDeferredToolPrimaryText(result.text, context.language, {
          dispatchKind: "SearchExtraTools",
          ok: true,
          matchedCount: result.data.total,
        }),
      );
      return {
        ok: true,
        tool: dispatchName,
        text: result.text,
        data: result.data,
        evidenceId: evidence?.id,
      };
    }
    if (dispatchName === COMMAND_PROPOSAL_TOOL_NAME) {
      const commandRaw = input.command;
      const reasonRaw = input.reason;
      const command = typeof commandRaw === "string" ? commandRaw.trim() : "";
      const reason = typeof reasonRaw === "string" ? reasonRaw.trim() : "";
      if (!command.startsWith("/")) {
        const text =
          context.language === "en-US"
            ? "Command proposal must be an explicit slash command."
            : "命令提案必须是明确的 slash command。";
        await appendDeferredToolResultEvent(
          context,
          sessionId,
          toolCall.id,
          dispatchName,
          text,
          true,
        );
        clearRequestActivity(context, activityOwner);
        return { ok: false, tool: dispatchName, text };
      }
      const structuredTool = executableCommandProposalTool(command);
      if (structuredTool) {
        const text =
          context.language === "en-US"
            ? `CommandProposal is not allowed for executable ${structuredTool} requests. Call the real structured tool instead.`
            : `CommandProposal 不能用于可执行的 ${structuredTool} 请求。请改用真实结构化工具调用。`;
        await appendDeferredToolResultEvent(
          context,
          sessionId,
          toolCall.id,
          dispatchName,
          text,
          true,
        );
        clearRequestActivity(context, activityOwner);
        return { ok: false, tool: dispatchName, text };
      }
      const text =
        context.language === "en-US"
          ? `Suggested command: ${command}${reason ? ` (${reason})` : ""}`
          : `建议命令：${command}${reason ? `（${reason}）` : ""}`;
      await appendDeferredToolResultEvent(
        context,
        sessionId,
        toolCall.id,
        dispatchName,
        { command, reason },
        false,
      );
      clearRequestActivity(context, activityOwner);
      writeLine(output, text);
      return { ok: true, tool: dispatchName, text, data: { command, reason } };
    }
    // ExecuteExtraTool
    // D.13N — record a policy engine verdict for transparency. The actual
    // gate (whitelist + mutating flags inside executeExtraTool) is unchanged;
    // this event is the auditable proof that ExecuteExtraTool runs through
    // the same classifier as built-in tools, so dispatch never silently
    // bypasses permission policy.
    const requestedToolName = typeof input.tool_name === "string" ? input.tool_name : "(unknown)";
    const deferredVerdict = classifyToolRequest({
      toolName: requestedToolName,
      input: input.params,
      workspaceRoot: context.projectPath,
      isDeferred: true,
      manifestReadOnly:
        isCodebaseMemoryToolName(requestedToolName) &&
        getCodebaseMemoryToolRisk(requestedToolName) === "readonly",
    });
    if (deferredVerdict.decision === "auto_allow_readonly") {
      await appendSystemEvent(
        context,
        sessionId,
        `permission auto allow readonly: tool ExecuteExtraTool; target ${deferredVerdict.redactedSummary}; semantic ${deferredVerdict.semantic}; reason ${deferredVerdict.reason}`,
        "info",
      );
    } else {
      await appendSystemEvent(
        context,
        sessionId,
        `permission policy require: tool ExecuteExtraTool; target ${deferredVerdict.redactedSummary}; semantic ${deferredVerdict.semantic}; reason ${deferredVerdict.reason}`,
        "info",
      );
    }
    const result = await executeExtraTool(
      { tool_name: input.tool_name, params: input.params },
      context,
      { signal: requestSignal, onProgress: updateMcpProgress },
    );
    if (requestIsStale()) return dropStaleResult();
    if (!result.ok) {
      if (requestIsStale()) return dropStaleResult();
      const evidence = await recordToolFailureEvidence(
        context,
        sessionId,
        "Read",
        `${dispatchName}: ${result.text}`,
        () => !requestIsStale(),
        toolCall.id,
      );
      if (requestIsStale()) return dropStaleResult();
      await appendDeferredToolResultEvent(
        context,
        sessionId,
        toolCall.id,
        dispatchName,
        result.text,
        true,
        evidence.id,
        () => !requestIsStale(),
      );
      if (requestIsStale()) return dropStaleResult();
      clearDeferredActivity();
      // D.13V-C — 失败也要降噪：主屏不暴露 ExecuteExtraTool / dispatcher 等内部词。
      writeLine(
        output,
        sanitizeDeferredToolPrimaryText(result.text, context.language, {
          dispatchKind: "ExecuteExtraTool",
          ok: false,
        }),
      );
      return { ok: false, tool: dispatchName, text: result.text, evidenceId: evidence.id };
    }
    rememberSourcePackCandidatesFromToolData(context, input.tool_name, result.data);
    if (requestIsStale()) return dropStaleResult();
    const evidence = await recordToolEvidence(context, sessionId, "Read", {
      text: result.text,
      data: result.data,
    } as ToolOutput, undefined, () => !requestIsStale(), toolCall.id);
    if (requestIsStale()) return dropStaleResult();
    await appendDeferredToolResultEvent(
      context,
      sessionId,
      toolCall.id,
      dispatchName,
      { text: result.text, data: result.data },
      false,
      evidence?.id,
      () => !requestIsStale(),
    );
    if (requestIsStale()) return dropStaleResult();
    clearDeferredActivity();
    writeLine(
      output,
      sanitizeDeferredToolPrimaryText(result.text, context.language, {
        dispatchKind: "ExecuteExtraTool",
        ok: true,
      }),
    );
    return {
      ok: true,
      tool: dispatchName,
      text: result.text,
      data: result.data,
      evidenceId: evidence?.id,
    };
  } catch (error) {
    if (requestIsStale()) return dropStaleResult();
    clearDeferredActivity();
    const text = formatError(error, context.language);
    if (requestIsStale()) return dropStaleResult();
    const evidence = await recordToolFailureEvidence(
      context,
      sessionId,
      "Read",
      `${dispatchName}: ${text}`,
      () => !requestIsStale(),
      toolCall.id,
    );
    if (requestIsStale()) return dropStaleResult();
    await appendDeferredToolResultEvent(
      context,
      sessionId,
      toolCall.id,
      dispatchName,
      text,
      true,
      evidence.id,
      () => !requestIsStale(),
    );
    if (requestIsStale()) return dropStaleResult();
    return { ok: false, tool: dispatchName, text, evidenceId: evidence.id };
  }
}

export async function executePreEngineToolUse(
  toolCall: ModelToolCall,
  context: TuiContext,
  sessionId: string,
  output: Writable,
): Promise<{
  ok: boolean;
  tool: string;
  text: string;
  data?: unknown;
  evidenceId?: string;
}> {
  const toolName = toolCall.name;
  startRequestActivity(output, context, "tool_running", {
    toolName,
    toolTarget: extractToolTarget(toolName, toolCall.input),
  });
  await context.store.appendEvent(sessionId, {
    type: "tool_call_start",
    id: toolCall.id,
    name: toolName,
    input: toolCall.input,
    createdAt: new Date().toISOString(),
  });
  try {
    context.discoveredDeferredToolNames.add(toolName);
    const params =
      toolCall.input && typeof toolCall.input === "object" && !Array.isArray(toolCall.input)
        ? (toolCall.input as Record<string, unknown>)
        : {};
    const result = await executeExtraTool({ tool_name: toolName, params }, context);
    if (!result.ok) {
      const evidence = await recordToolFailureEvidence(
        context,
        sessionId,
        "Read",
        `${toolName}: ${result.text}`,
      );
      await appendDeferredToolResultEvent(
        context,
        sessionId,
        toolCall.id,
        toolName,
        result.text,
        true,
        evidence.id,
      );
      clearRequestActivity(context);
      writeLine(output, formatPreEnginePrimaryText(toolName, false, context, toolCall.input));
      return { ok: false, tool: toolName, text: result.text, evidenceId: evidence.id };
    }
    if (result.degraded) {
      const fallbackResult = buildPreEngineFallbackRequiredResult(result, context);
      const evidence = await recordToolEvidence(context, sessionId, "Read", {
        text: fallbackResult.text,
        data: fallbackResult.data,
      } as ToolOutput);
      await appendDeferredToolResultEvent(
        context,
        sessionId,
        toolCall.id,
        toolName,
        fallbackResult,
        false,
        evidence?.id,
      );
      clearRequestActivity(context);
      writeLine(output, formatPreEngineDegradedPrimaryText(context));
      return {
        ok: true,
        tool: toolName,
        text: fallbackResult.text,
        data: fallbackResult.data,
        evidenceId: evidence?.id,
      };
    }
    rememberSourcePackCandidatesFromToolData(context, toolName, result.data);
    const evidence = await recordToolEvidence(context, sessionId, "Read", {
      text: result.text,
      data: result.data,
    } as ToolOutput);
    await appendDeferredToolResultEvent(
      context,
      sessionId,
      toolCall.id,
      toolName,
      { text: result.text, data: result.data },
      false,
      evidence?.id,
    );
    clearRequestActivity(context);
    writeLine(output, formatPreEnginePrimaryText(toolName, true, context, toolCall.input));
    return {
      ok: true,
      tool: toolName,
      text: result.text,
      data: result.data,
      evidenceId: evidence?.id,
    };
  } catch (error) {
    clearRequestActivity(context);
    const text = formatError(error, context.language);
    const evidence = await recordToolFailureEvidence(
      context,
      sessionId,
      "Read",
      `${toolName}: ${text}`,
    );
    await appendDeferredToolResultEvent(
      context,
      sessionId,
      toolCall.id,
      toolName,
      text,
      true,
      evidence.id,
    );
    return { ok: false, tool: toolName, text, evidenceId: evidence.id };
  }
}

const PRE_ENGINE_SYMBOL_MAX_LENGTH = 80;

function formatPreEngineDegradedPrimaryText(context: TuiContext): string {
  return context.language === "zh-CN"
    ? "代码预分析已降级，正在改用真实工具继续取证。"
    : "Code pre-analysis degraded; use real tools to continue gathering evidence.";
}

function buildPreEngineFallbackRequiredResult(
  result: { text: string; data?: unknown },
  context: TuiContext,
): ToolOutput {
  const zh = context.language === "zh-CN";
  const requiredNextAction = zh
    ? "pre 预分析不可用或证据不足。本轮不要把 pre 结果当成完成；必须继续调用真实工具，例如 SearchExtraTools、SourcePack、Grep、Glob、Read 或 ReadSnippets，取得源码证据后再回答或继续修改。"
    : "Pre-analysis is unavailable or insufficient. Do not treat this pre-engine result as completion; call real tools such as SearchExtraTools, SourcePack, Grep, Glob, Read, or ReadSnippets in this turn, gather source evidence, then answer or continue editing.";
  const fallbackData =
    result.data && typeof result.data === "object" && !Array.isArray(result.data)
      ? { ...(result.data as Record<string, unknown>) }
      : { pre_engine_result: result.data };
  return {
    text: `${result.text}\n${requiredNextAction}`,
    data: {
      ...fallbackData,
      degraded: true,
      fallback_required: true,
      required_next_action: requiredNextAction,
    },
  };
}

function formatPreEnginePrimaryText(
  toolName: string,
  ok: boolean,
  context: TuiContext,
  input?: unknown,
): string {
  const zh = context.language === "zh-CN";
  const verify = toolName === "pre_verify";
  if (!ok) {
    if (verify) {
      return zh
        ? "验证检查失败，诊断记录可在 /details 查看。"
        : "Verification check failed. Use /details for diagnostics.";
    }
    return zh
      ? "代码分析未完成，诊断记录可在 /details 查看。"
      : "Code analysis did not finish. Use /details for diagnostics.";
  }
  if (verify) {
    return zh ? "验证检查完成。" : "Verification check finished.";
  }
  if (toolName === "pre_context") {
    const symbol = getPreEngineSymbol(input);
    if (symbol) {
      return zh
        ? `代码上下文分析完成：${symbol}`
        : `Code context analysis finished: ${symbol}`;
    }
    return zh ? "代码上下文分析完成。" : "Code context analysis finished.";
  }
  if (toolName === "pre_impact") {
    return zh ? "代码影响分析完成。" : "Code impact analysis finished.";
  }
  if (toolName === "pre_plan") {
    return zh ? "代码规划分析完成。" : "Code planning analysis finished.";
  }
  return zh ? "代码分析完成。" : "Code analysis finished.";
}

function getPreEngineSymbol(input: unknown): string | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const symbol = (input as { symbol?: unknown }).symbol;
  if (typeof symbol !== "string") {
    return undefined;
  }
  const trimmed = symbol.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.length <= PRE_ENGINE_SYMBOL_MAX_LENGTH) {
    return trimmed;
  }
  return `${trimmed.slice(0, PRE_ENGINE_SYMBOL_MAX_LENGTH - 3)}...`;
}

export function __testFormatPreEnginePrimaryText(
  toolName: string,
  ok: boolean,
  context: TuiContext,
  input?: unknown,
): string {
  return formatPreEnginePrimaryText(toolName, ok, context, input);
}

export function __testBuildPreEngineFallbackRequiredResult(
  result: { text: string; data?: unknown },
  context: TuiContext,
): ToolOutput {
  return buildPreEngineFallbackRequiredResult(result, context);
}

export async function executeLinghunControlToolUse(
  toolCall: ModelToolCall,
  context: TuiContext,
  sessionId: string,
  output: Writable,
  continuation?: PendingModelContinuation,
): Promise<{
  ok: boolean;
  tool: string;
  text: string;
  data?: unknown;
  evidenceId?: string;
  pendingApproval?: boolean;
}> {
  startRequestActivity(output, context, "tool_running", { toolName: toolCall.name, toolTarget: extractToolTarget(toolCall.name, toolCall.input) });
  const previousCommandPanelState = context.commandPanelState;
  await context.store.appendEvent(sessionId, {
    type: "tool_call_start",
    id: toolCall.id,
    name: toolCall.name,
    input: toolCall.input,
    createdAt: new Date().toISOString(),
  });
  try {
    if (toolCall.name === START_AGENT_TOOL_NAME) {
      const input = parseStartAgentToolInput(toolCall.input, context);
      if (!input.ok)
        return await finishControlToolFailure(toolCall, context, sessionId, output, input.text);
      const agent = await handleForkCommand(
        buildForkArgsFromStartAgentInput(input, context),
        context,
        createSilentOutput(),
      );
      const result = buildStartAgentToolResult(
        agent,
        formatStartAgentDidNotStartMessage(input, context),
        context.language,
      );
      if (agent && !input.runInBackground && result.data.terminal) {
        const reportedAt = new Date().toISOString();
        for (const notice of collectPendingAgentCompletionNotices(context)) {
          if (notice.agentId === agent.id) markAgentCompletionNoticeReported(context, notice.id, reportedAt);
        }
      }
      return await finishControlToolResult(
        toolCall,
        context,
        sessionId,
        output,
        result.text,
        !result.ok,
        result.data,
      );
    }
    if (toolCall.name === AGENT_CONTROL_TOOL_NAME) {
      const input = parseAgentControlToolInput(toolCall.input, context);
      if (!input.ok)
        return await finishControlToolFailure(toolCall, context, sessionId, output, input.text);
      if (input.action === "list") {
        const cancellable = listCancellableAgents(context);
        return await finishControlToolResult(
          toolCall,
          context,
          sessionId,
          output,
          `Agent list inspected: ${context.agents.length} agent(s); cancellable ${cancellable.length}: ${cancellable.map((agent) => `${agent.id}:${agent.status}`).join(", ") || "none"}.`,
          false,
          {
            total: context.agents.length,
            cancellable: cancellable.map((agent) => ({ id: agent.id, status: agent.status })),
            teammates: context.agents.map((agent) => ({
              id: agent.id,
              role: agent.role,
              team: agent.teamName ?? null,
              status: agent.status,
              activity: agent.activityStatus ?? null,
              queuedMessages:
                agent.mailbox?.filter((message) => (message.status ?? "pending") === "pending")
                  .length ?? 0,
              activeTask: agent.activeTask
                ? { id: agent.activeTask.id, status: agent.activeTask.status }
                : null,
              recentResult: agent.lastResultSummary ?? agent.summary,
              resultFullReport: agent.lastResultFullReport ?? null,
              transcriptSessionId: agent.transcriptSessionId,
            })),
          },
        );
      }
      if (input.action === "cancel_all" || input.action === "stop_all") {
        const agents = await cancelAllAgents(context, createSilentOutput());
        return await finishControlToolResult(
          toolCall,
          context,
          sessionId,
          output,
          agents.length > 0
            ? `AgentControl ${input.action}: cancelled ${agents.length} agent(s).`
            : `AgentControl ${input.action}: no cancellable agents.`,
          false,
          { cancelled: agents.map((agent) => ({ id: agent.id, status: agent.status })) },
        );
      }
      if (input.action === "show") {
        const agent = findAgent(context, input.agentRef);
        return await finishControlToolResult(
          toolCall,
          context,
          sessionId,
          output,
          agent
            ? `Agent ${agent.status}: ${agent.summary}`
            : `Agent not found: ${input.agentRef ?? "latest"}`,
          !agent,
          formatAgentRunToolResultData(agent),
        );
      }
      const agent = await cancelAgentByRef(input.agentRef, context, output);
      return await finishControlToolResult(
        toolCall,
        context,
        sessionId,
        output,
        agent
          ? `Agent cancelled: ${agent.summary}`
          : `Agent not found: ${input.agentRef ?? "latest"}`,
        !agent,
        { agentId: agent?.id, status: agent?.status ?? "not_found" },
      );
    }
    if (toolCall.name === SEND_MESSAGE_TOOL_NAME) {
      const input = parseSendMessageToolInput(toolCall.input);
      if (!input.ok)
        return await finishControlToolFailure(toolCall, context, sessionId, output, input.text);
      const result = await sendAgentMessage(context, { ...input, from: "model" });
      return await finishControlToolResult(
        toolCall,
        context,
        sessionId,
        output,
        result.text,
        !result.ok,
        {
          delivered: result.delivered,
        },
      );
    }
    if (toolCall.name === RUN_WORKFLOW_TOOL_NAME) {
      const input = parseRunWorkflowToolInput(toolCall.input);
      if (!input.ok)
        return await finishControlToolFailure(toolCall, context, sessionId, output, input.text);
      if (input.workflowId) {
        const registry = findRegistryWorkflow(context, input.workflowId);
        const registryAgent = findRegistryAgentWorkflow(context, input.workflowId);
        const existingRun =
          context.workflows.activeRuns?.find((r) => r.id === input.workflowId) ??
          (context.workflows.activeRun?.id === input.workflowId
            ? context.workflows.activeRun
            : undefined);
        if (!registry && !registryAgent && !existingRun) {
          return await finishControlToolFailure(
            toolCall,
            context,
            sessionId,
            output,
            `Unknown workflowId: ${input.workflowId}`,
          );
        }
        if (existingRun && !registry && !registryAgent) {
          const currentStep = selectWorkflowCurrentStepForToolResult(existingRun);
          const text = formatWorkflowToolResultSummary(
            context.language,
            existingRun.status,
            existingRun.steps.length,
            currentStep?.summary ?? currentStep?.title ?? existingRun.goal,
            false,
            existingRun.multiAgent,
            existingRun.result,
          );
          return await finishControlToolResult(toolCall, context, sessionId, output, text, false, {
            ...buildWorkflowToolResultData(existingRun, input, context.language),
          });
        }
        const workflowGoal = input.goal ?? (input.inputs ? JSON.stringify(input.inputs) : "");
        if (registry) {
          await runRegistryWorkflow(
            registry,
            workflowGoal,
            input.runInBackground,
            context,
            createSilentOutput(),
          );
        } else if (registryAgent) {
          await runRegistryAgentWorkflow(
            registryAgent,
            workflowGoal,
            input.runInBackground,
            context,
            createSilentOutput(),
          );
        }
      } else {
        await runWorkflowSteps(input.goal ?? "", context, createSilentOutput(), {
          ...input,
          ignoreForegroundModelGuard: true,
        });
      }
      const run = context.workflows.activeRun;
      const ok =
        run?.status === "completed" || (input.runInBackground && run?.status === "running");
      const currentStep = selectWorkflowCurrentStepForToolResult(run);
      const text = run
        ? formatWorkflowToolResultSummary(
            context.language,
            run.status,
            run.steps.length,
            currentStep?.summary ?? currentStep?.title ?? "workflow",
            input.runInBackground && run.status === "running",
            run.multiAgent ?? input.multiAgent,
            run.result,
          )
        : "Workflow runtime did not start.";
      return await finishControlToolResult(
        toolCall,
        context,
        sessionId,
        output,
        text,
        !ok,
        buildWorkflowToolResultData(run, input, context.language),
      );
    }
    if (toolCall.name === INDEX_OPERATION_TOOL_NAME) {
      const input = parseIndexOperationToolInput(toolCall.input);
      if (!input.ok)
        return await finishControlToolFailure(toolCall, context, sessionId, output, input.text);
      const mappedName =
        input.action === "inspect"
          ? INDEX_STATUS_INSPECT
          : input.action === "repair"
            ? INDEX_REPAIR
            : INDEX_REFRESH;
      const mappedInput = { force: input.force };
      const action = input.action === "init_fast" ? "init fast" : undefined;
      return executeIndexToolUse(
        { id: toolCall.id, name: mappedName, input: mappedInput },
        context,
        sessionId,
        output,
        continuation,
        action,
        INDEX_OPERATION_TOOL_NAME,
        false,
      );
    }
    if (toolCall.name === RUN_VERIFICATION_TOOL_NAME) {
      const input = parseVerificationToolInput(toolCall.input);
      if (!input.ok)
        return await finishControlToolFailure(toolCall, context, sessionId, output, input.text);
      await runWorkflowVerificationStep(input.level, context, createSilentOutput());
      const report = context.lastVerification;
      const ok = report?.status === "pass";
      const text = report
        ? `Verification ${report.status.toUpperCase()}: ${report.summary}`
        : "Verification runner did not produce a report.";
      await appendPolicyToolFeedback(
        context,
        sessionId,
        `verification result: level ${input.level}; status ${report?.status ?? "partial"}; report ${report?.id ?? "none"}`,
        ok ? "info" : "warning",
      );
      return await finishControlToolResult(toolCall, context, sessionId, output, text, !ok, {
        status: report?.status ?? "partial",
        reportId: report?.id,
        level: input.level,
        commands:
          report?.commands.map((command) => ({
            kind: command.kind,
            status: command.status,
            synthetic: command.synthetic === true,
          })) ?? [],
      });
    }
    if (toolCall.name === WRITE_REPORT_TOOL_NAME) {
      return executeWriteReportToolUse(toolCall, context, sessionId, output, continuation);
    }
    return await finishControlToolFailure(
      toolCall,
      context,
      sessionId,
      output,
      `Unknown Linghun control tool: ${toolCall.name}`,
    );
  } finally {
    context.commandPanelState = previousCommandPanelState;
    clearRequestActivity(context);
  }
}

function formatWorkflowToolResultSummary(
  language: Language,
  status: NonNullable<TuiContext["workflows"]["activeRun"]>["status"],
  steps: number,
  currentStep: string,
  background: boolean,
  multiAgent?: boolean,
  result?: string,
): string {
  if (status === "running") {
    return formatWorkflowStartPrimary({ language, steps, currentPhase: currentStep, background, multiAgent });
  }
  if (multiAgent) {
    if (status === "completed") {
      if (result === "partial") {
        return language === "en-US"
          ? "Multi-agent collaboration returned partial results; main chain continuing."
          : "多智能体协作返回了部分结果，主链继续整理。";
      }
      return language === "en-US"
        ? "Multi-agent collaboration returned results."
        : "多智能体协作已返回结果。";
    }
    if (status === "partial") {
      return language === "en-US"
        ? "Multi-agent collaboration partially done; main chain continuing."
        : "多智能体协作部分完成，主链继续处理。";
    }
    if (language === "en-US") {
      return `Multi-agent collaboration stopped at step: ${currentStep}. Status: ${status}. Use /workflows status for details.`;
    }
    return `多智能体协作停在步骤：${currentStep}。状态：${status}。可用 /workflows status 查看详情。`;
  }
  if (language === "en-US") {
    return `Workflow started, then stopped at step: ${currentStep}. Status: ${status}. Use /workflows status for details.`;
  }
  return `workflow 已启动，随后停在步骤：${currentStep}。状态：${status}。可用 /workflows status 查看详情。`;
}

function buildWorkflowToolResultData(
  run: WorkflowRunState | undefined,
  input: Extract<ReturnType<typeof parseRunWorkflowToolInput>, { ok: true }>,
  language: Language,
): {
  workflowId?: string;
  status: WorkflowRunState["status"] | "blocked";
  result: WorkflowRunState["result"] | "blocked";
  agents?: number;
  multiAgent?: boolean;
  runningCap?: number;
  teamName?: string;
  contextMode?: "handoff" | "full_fork";
  lifecycleStatus: "not_started" | "running" | "terminal";
  terminal: boolean;
  completionClaimAllowed: false;
  verificationClaimAllowed: false;
  nextAction: string;
} {
  const terminal = Boolean(run && run.status !== "running");
  const lifecycleStatus = run ? (terminal ? "terminal" : "running") : "not_started";
  return {
    workflowId: run?.id,
    status: run?.status ?? "blocked",
    result: run?.result ?? "blocked",
    agents: input.agents,
    multiAgent: run?.multiAgent ?? input.multiAgent,
    runningCap: input.runningCap,
    teamName: input.teamName,
    contextMode: input.contextMode,
    lifecycleStatus,
    terminal,
    completionClaimAllowed: false,
    verificationClaimAllowed: false,
    nextAction:
      lifecycleStatus === "running"
        ? language === "en-US"
          ? "Workflow is still running; inspect returned agent/workflow completions before claiming work is complete."
          : "workflow 仍在运行；先检查回流的 agent/workflow 结果，再声称工作完成。"
        : lifecycleStatus === "terminal"
          ? language === "en-US"
            ? "Workflow lifecycle ended; use separate evidence or verification before claiming PASS. If an exact file path is in the task, verify it directly with Read or a read-only Bash existence check; do not infer absence from broad Glob zero matches."
            : "workflow 生命周期已结束；声称 PASS 前必须有独立证据或验证。如任务中有精确文件路径，必须用 Read 或只读 Bash 存在性检查直接验证；不要用宽泛 Glob 零结果推断文件不存在。"
          : language === "en-US"
            ? "Workflow runtime did not start; check workflow id, model route, and background guard."
            : "workflow runtime 未启动；检查 workflow id、模型路由和后台守卫。",
  };
}

export function __testBuildWorkflowToolResultData(
  run: WorkflowRunState | undefined,
  input: Extract<ReturnType<typeof parseRunWorkflowToolInput>, { ok: true }>,
  language: Language,
): ReturnType<typeof buildWorkflowToolResultData> {
  return buildWorkflowToolResultData(run, input, language);
}

function selectWorkflowCurrentStepForToolResult(
  run: TuiContext["workflows"]["activeRun"] | undefined,
): NonNullable<TuiContext["workflows"]["activeRun"]>["steps"][number] | undefined {
  return (
    run?.steps.find(
      (step) =>
        step.status === "blocked" ||
        step.status === "failed" ||
        step.status === "stale" ||
        step.status === "cancelled",
    ) ??
    run?.steps.find((step) => step.status === "running") ??
    run?.steps.find((step) => step.status === "queued") ??
    run?.steps.at(-1)
  );
}

export const __testSelectWorkflowCurrentStepForToolResult = selectWorkflowCurrentStepForToolResult;

function executableCommandProposalTool(command: string): string | undefined {
  const normalized = command.trim().toLowerCase();
  if (/^\/fork\b/u.test(normalized)) return START_AGENT_TOOL_NAME;
  if (/^\/agents?\b/u.test(normalized)) return AGENT_CONTROL_TOOL_NAME;
  if (/^\/workflows?\s+(?:run|plan|enable|disable|[^\s]+)/u.test(normalized)) {
    return RUN_WORKFLOW_TOOL_NAME;
  }
  if (/^\/index\b/u.test(normalized)) return INDEX_OPERATION_TOOL_NAME;
  if (/^\/verify\b/u.test(normalized)) return RUN_VERIFICATION_TOOL_NAME;
  if (/^\/(?:report|review)\b/u.test(normalized)) return WRITE_REPORT_TOOL_NAME;
  if (/^\/(?:write|edit|multiedit)\b/u.test(normalized)) return "Write/Edit";
  return undefined;
}

function parseStartAgentToolInput(
  input: unknown,
  context: TuiContext,
):
  | {
      ok: true;
      role: AgentType;
      task: string;
      name?: string;
      teamName?: string;
      runInBackground: boolean;
      cwd?: string;
      isolation?: "worktree";
      contextMode?: "handoff" | "full_fork";
      registryAgentId?: string;
    }
  | { ok: false; text: string } {
  const obj =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const rawRole =
    typeof obj.role === "string"
      ? obj.role
      : typeof obj.subagent_type === "string"
        ? obj.subagent_type
        : "";
  const task = obj.task;
  const registryAgent = !isAgentType(rawRole)
    ? context.agentRegistry.agents.find((agent) => agent.id === rawRole || agent.name === rawRole)
    : undefined;
  const role = isAgentType(rawRole)
    ? rawRole
    : registryAgent
      ? inferRegistryAgentRole(registryAgent)
      : undefined;
  if (!role || typeof task !== "string" || !task.trim()) {
    return {
      ok: false,
      text: "StartAgent requires role/subagent_type explorer|planner|worker|verifier and task.",
    };
  }
  const isolation = obj.isolation === "worktree" ? "worktree" : undefined;
  const cwd = typeof obj.cwd === "string" && obj.cwd.trim() ? obj.cwd.trim() : undefined;
  const rawContextMode =
    obj.contextMode === "full_fork" || obj.contextMode === "handoff"
      ? obj.contextMode
      : obj.context_mode === "full_fork" || obj.context_mode === "handoff"
        ? obj.context_mode
        : undefined;
  return {
    ok: true,
    role,
    task: task.trim(),
    ...(typeof obj.name === "string" && obj.name.trim() ? { name: obj.name.trim() } : {}),
    ...(typeof obj.teamName === "string" && obj.teamName.trim()
      ? { teamName: obj.teamName.trim() }
      : typeof obj.team_name === "string" && obj.team_name.trim()
        ? { teamName: obj.team_name.trim() }
        : {}),
    runInBackground: obj.runInBackground === true || obj.run_in_background === true,
    ...(cwd && !isolation ? { cwd } : {}),
    ...(isolation ? { isolation } : {}),
    ...(rawContextMode ? { contextMode: rawContextMode } : {}),
    ...(registryAgent ? { registryAgentId: registryAgent.id } : {}),
  };
}

function inferRegistryAgentRole(agent: RegistryAgentDefinition): AgentType {
  const tools = agent.allowedTools ?? [];
  if (tools.some((tool) => ["Write", "Edit", "MultiEdit", "Bash"].includes(tool))) return "worker";
  return "planner";
}

export function __testFormatStartAgentDidNotStartMessage(
  input: Extract<ReturnType<typeof parseStartAgentToolInput>, { ok: true }>,
  context: TuiContext,
): string {
  return formatStartAgentDidNotStartMessage(input, context);
}

export function __testParseStartAgentToolInput(
  input: unknown,
  context: TuiContext,
): ReturnType<typeof parseStartAgentToolInput> {
  return parseStartAgentToolInput(input, context);
}

function formatStartAgentDidNotStartMessage(
  input: Extract<ReturnType<typeof parseStartAgentToolInput>, { ok: true }>,
  context: TuiContext,
): string {
  const workflowTaskId =
    context.workflows.activeRun?.status === "running" ? context.workflows.activeRun.id : undefined;
  const guard = checkBackgroundStartGuard(context, "agent", true, workflowTaskId);
  const route = resolveRoleRoute(context, getAgentRole(input.role), "StartAgent");
  const hints = [
    guard ? `resource=${guard}` : undefined,
    !route.usable
      ? `route=${formatRoutePauseMessage(getAgentRole(input.role), route.decision)}`
      : undefined,
    input.cwd ? `cwd=${input.cwd}` : undefined,
    input.isolation ? `isolation=${input.isolation}` : undefined,
  ].filter((item): item is string => Boolean(item));
  const suffix = hints.length > 0 ? ` ${hints.join(" | ")}` : "";
  return context.language === "en-US"
    ? `Agent runtime did not start: no AgentRun was persisted after StartAgent.${suffix} Check /background and /model doctor, then retry or run /fork manually.`
    : `Agent runtime 未启动：StartAgent 后没有持久化任何 AgentRun。${suffix} 请先查看 /background 和 /model doctor，必要时手动运行 /fork 重试。`;
}

function buildForkArgsFromStartAgentInput(
  input: Extract<ReturnType<typeof parseStartAgentToolInput>, { ok: true }>,
  _context: TuiContext,
): string[] {
  const args = [input.registryAgentId ?? input.role, input.task];
  if (input.runInBackground) args.push("--background");
  if (input.name) args.push("--name", input.name);
  if (input.teamName) args.push("--team", input.teamName);
  if (input.cwd && !input.isolation) args.push("--cwd", input.cwd);
  if (input.isolation) args.push("--isolation", input.isolation);
  if (input.contextMode === "full_fork") args.push("--context-mode", "full_fork");
  return args;
}

export function __testBuildForkArgsFromStartAgentInput(
  input: Extract<ReturnType<typeof parseStartAgentToolInput>, { ok: true }>,
  context: TuiContext,
): string[] {
  return buildForkArgsFromStartAgentInput(input, context);
}

function parseAgentControlToolInput(
  input: unknown,
  context: TuiContext,
):
  | { ok: true; action: "list" | "show" | "cancel" | "cancel_all" | "stop_all"; agentRef?: string }
  | { ok: false; text: string } {
  const obj =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const action = obj.action;
  if (
    action !== "list" &&
    action !== "show" &&
    action !== "cancel" &&
    action !== "cancel_all" &&
    action !== "stop_all"
  ) {
    return {
      ok: false,
      text: "AgentControl requires action list|show|cancel|cancel_all|stop_all.",
    };
  }
  const ref =
    typeof obj.agentId === "string" && obj.agentId.trim()
      ? obj.agentId.trim()
      : typeof obj.agent_id === "string" && obj.agent_id.trim()
        ? obj.agent_id.trim()
        : typeof obj.ref === "string" && obj.ref.trim()
          ? obj.ref.trim()
          : undefined;
  if ((action === "show" || action === "cancel") && !ref && context.agents.length > 1) {
    return { ok: false, text: "AgentControl requires agentId/ref when multiple agents exist." };
  }
  return { ok: true, action, ...(ref ? { agentRef: ref } : {}) };
}

function parseSendMessageToolInput(input: unknown):
  | {
      ok: true;
      to?: string;
      name?: string;
      team?: string;
      teamName?: string;
      team_name?: string;
      targetType?: "id" | "name" | "team";
      broadcastTeam?: boolean;
      kind?: "message" | "task";
      taskId?: string;
      message: string;
    }
  | { ok: false; text: string } {
  const obj =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const message = obj.message;
  if (typeof message !== "string" || !message.trim()) {
    return { ok: false, text: "SendMessage requires message." };
  }
  const targetTypeRaw = obj.targetType ?? obj.target_type;
  const targetType =
    targetTypeRaw === "id" || targetTypeRaw === "name" || targetTypeRaw === "team"
      ? targetTypeRaw
      : undefined;
  return {
    ok: true,
    ...(typeof obj.to === "string" && obj.to.trim() ? { to: obj.to.trim() } : {}),
    ...(typeof obj.name === "string" && obj.name.trim() ? { name: obj.name.trim() } : {}),
    ...(typeof obj.team === "string" && obj.team.trim() ? { team: obj.team.trim() } : {}),
    ...(typeof obj.teamName === "string" && obj.teamName.trim()
      ? { teamName: obj.teamName.trim() }
      : {}),
    ...(typeof obj.team_name === "string" && obj.team_name.trim()
      ? { team_name: obj.team_name.trim() }
      : {}),
    ...(targetType ? { targetType } : {}),
    ...(obj.broadcastTeam === true || obj.broadcast_team === true ? { broadcastTeam: true } : {}),
    ...(obj.kind === "message" || obj.kind === "task" ? { kind: obj.kind } : {}),
    ...(typeof obj.taskId === "string" && obj.taskId.trim()
      ? { taskId: obj.taskId.trim() }
      : typeof obj.task_id === "string" && obj.task_id.trim()
        ? { taskId: obj.task_id.trim() }
        : {}),
    message: message.trim(),
  };
}

function parseRunWorkflowToolInput(input: unknown):
  | {
      ok: true;
      goal?: string;
      workflowId?: string;
      inputs?: Record<string, unknown>;
      runInBackground: boolean;
      agents?: number;
      multiAgent: boolean;
      runningCap?: number;
      teamName?: string;
      contextMode?: "handoff" | "full_fork";
    }
  | { ok: false; text: string } {
  const obj =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const goal = typeof obj.goal === "string" && obj.goal.trim() ? obj.goal.trim() : undefined;
  const workflowId =
    typeof obj.workflowId === "string" && obj.workflowId.trim()
      ? obj.workflowId.trim()
      : typeof obj.workflow_id === "string" && obj.workflow_id.trim()
        ? obj.workflow_id.trim()
        : undefined;
  const agents = normalizePositiveToolInt(obj.agents);
  const runningCap = normalizePositiveToolInt(obj.runningCap ?? obj.running_cap);
  const teamName =
    typeof obj.teamName === "string" && obj.teamName.trim()
      ? obj.teamName.trim()
      : typeof obj.team_name === "string" && obj.team_name.trim()
        ? obj.team_name.trim()
        : undefined;
  const rawContextMode =
    obj.contextMode === "full_fork" || obj.contextMode === "handoff"
      ? obj.contextMode
      : obj.context_mode === "full_fork" || obj.context_mode === "handoff"
        ? obj.context_mode
        : undefined;
  const forkTeam =
    obj.forkTeam === true ||
    obj.fork_team === true ||
    obj.mode === "fork_team";
  const contextMode = rawContextMode ?? (forkTeam ? "full_fork" : undefined);
  if (!goal && !workflowId) {
    return { ok: false, text: "RunWorkflow requires goal or workflowId." };
  }
  return {
    ok: true,
    ...(goal ? { goal } : {}),
    ...(workflowId ? { workflowId } : {}),
    ...(obj.inputs && typeof obj.inputs === "object" && !Array.isArray(obj.inputs)
      ? { inputs: obj.inputs as Record<string, unknown> }
      : {}),
    runInBackground: obj.runInBackground === true || obj.run_in_background === true,
    ...(agents ? { agents } : {}),
    multiAgent:
      obj.multiAgent === true ||
      obj.multi_agent === true ||
      forkTeam ||
      Boolean(agents && agents > 1),
    ...(runningCap ? { runningCap } : {}),
    ...(teamName ? { teamName } : {}),
    ...(contextMode ? { contextMode } : {}),
  };
}

export function __testParseRunWorkflowToolInput(
  input: unknown,
): ReturnType<typeof parseRunWorkflowToolInput> {
  return parseRunWorkflowToolInput(input);
}

function normalizePositiveToolInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    return undefined;
  }
  return Math.max(1, Math.floor(value));
}

function parseIndexOperationToolInput(
  input: unknown,
):
  | { ok: true; action: "inspect" | "refresh" | "init_fast" | "repair"; force?: boolean }
  | { ok: false; text: string } {
  const obj =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const action = obj.action;
  if (
    action !== "inspect" &&
    action !== "refresh" &&
    action !== "init_fast" &&
    action !== "repair"
  ) {
    return { ok: false, text: "IndexOperation requires action inspect|refresh|init_fast|repair." };
  }
  return { ok: true, action, force: typeof obj.force === "boolean" ? obj.force : undefined };
}

function parseVerificationToolInput(
  input: unknown,
):
  | {
      ok: true;
      level: "plan-only" | "smoke" | "focused" | "real-smoke" | "typecheck" | "test" | "build" | "lint";
    }
  | { ok: false; text: string } {
  const obj =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const level = obj.level;
  if (
    level !== "plan-only" &&
    level !== "smoke" &&
    level !== "focused" &&
    level !== "real-smoke" &&
    level !== "typecheck" &&
    level !== "test" &&
    level !== "build" &&
    level !== "lint"
  ) {
    return { ok: false, text: "RunVerification requires a valid level." };
  }
  return { ok: true, level };
}

async function finishControlToolFailure(
  toolCall: ModelToolCall,
  context: TuiContext,
  sessionId: string,
  output: Writable,
  text: string,
) {
  return finishControlToolResult(toolCall, context, sessionId, output, text, true);
}

function controlToolEvidenceSpec(
  toolName: string,
  isError: boolean,
  data?: unknown,
): { source: string; supportsClaims: string[] } {
  if (toolName === START_AGENT_TOOL_NAME) {
    const terminal = isTerminalAgentToolResult(data);
    return {
      source: "agent-execution",
      supportsClaims: isError
        ? ["tool_failure", "agent_execution"]
        : ["agent_execution", "action_executed", ...(terminal ? ["agent_terminal_status"] : [])],
    };
  }
  if (toolName === RUN_WORKFLOW_TOOL_NAME) {
    const terminal = isTerminalWorkflowToolResult(data);
    return {
      source: "workflow-execution",
      supportsClaims: isError
        ? ["tool_failure", "workflow_execution"]
        : [
            "workflow_execution",
            "action_executed",
            ...(terminal ? ["workflow_terminal_status"] : []),
          ],
    };
  }
  if (toolName === INDEX_OPERATION_TOOL_NAME) {
    return {
      source: "index-operation",
      supportsClaims: isError
        ? ["tool_failure", "index_operation"]
        : ["index_operation", "action_executed"],
    };
  }
  if (toolName === RUN_VERIFICATION_TOOL_NAME) {
    return {
      source: "verification-result",
      supportsClaims: isError
        ? ["tool_failure", "verification_result"]
        : deriveRunVerificationSupportsClaims(data),
    };
  }
  if (toolName === WRITE_REPORT_TOOL_NAME) {
    return {
      source: "report-write",
      supportsClaims: isError
        ? ["tool_failure", "report_write"]
        : ["report_write", "write_result", "action_executed"],
    };
  }
  return {
    source: `control-tool:${toolName}`,
    supportsClaims: isError ? ["tool_failure", toolName] : [toolName, "action_executed"],
  };
}

function deriveRunVerificationSupportsClaims(data: unknown): string[] {
  const record = isRecord(data) ? data : {};
  const claims = new Set(["verification_result", "verification_attempted"]);
  if (record.status !== "pass") {
    return [...claims];
  }
  const commands = Array.isArray(record.commands)
    ? record.commands.filter((item): item is Record<string, unknown> => isRecord(item))
    : [];
  const passedCommands = commands.filter((command) => command.status === "pass");
  if (passedCommands.length === 0 || passedCommands.some((command) => command.synthetic !== true)) {
    claims.add("verification_passed");
  } else {
    claims.add("verification_self_check_passed");
    claims.add("verification_not_run");
  }
  for (const command of passedCommands) {
    if (command.kind === "test") claims.add("test_passed");
    else if (command.kind === "typecheck") claims.add("typecheck_passed");
    else if (command.kind === "build") claims.add("build_passed");
    else if (command.kind === "lint") claims.add("lint_passed");
    else if (command.kind === "smoke") {
      claims.add(command.synthetic === true ? "smoke_ran" : "smoke_passed");
    }
  }
  if (passedCommands.length === 0) {
    if (record.level === "test") claims.add("test_passed");
    else if (record.level === "typecheck") claims.add("typecheck_passed");
    else if (record.level === "build") claims.add("build_passed");
    else if (record.level === "lint") claims.add("lint_passed");
    else if (record.level === "smoke") claims.add("smoke_passed");
  }
  return [...claims];
}

function isTerminalAgentToolResult(data: unknown): boolean {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const status = (data as { status?: unknown }).status;
  return status === "completed" || status === "idle";
}

function isTerminalWorkflowToolResult(data: unknown): boolean {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const status = (data as { status?: unknown }).status;
  return status === "completed";
}

async function finishControlToolResult(
  toolCall: ModelToolCall,
  context: TuiContext,
  sessionId: string,
  output: Writable,
  text: string,
  isError: boolean,
  data?: unknown,
) {
  const spec = controlToolEvidenceSpec(toolCall.name, isError, data);
  const evidence = createEvidenceRecord(
    "command_output",
    `${toolCall.name}: ${truncateDisplay(text, 160)}`,
    spec.source,
    spec.supportsClaims,
  );
  rememberEvidence(context, evidence);
  await context.store.appendEvent(sessionId, { type: "evidence_record", ...evidence });
  await appendDeferredToolResultEvent(
    context,
    sessionId,
    toolCall.id,
    toolCall.name,
    { text, data },
    isError,
    evidence?.id,
  );
  if (!shouldSuppressControlToolPrimaryText(toolCall)) {
    writeLine(output, formatControlToolPrimaryText(toolCall.name, text, isError, data, context));
  }
  return { ok: !isError, tool: toolCall.name, text, data, evidenceId: evidence?.id };
}

function shouldSuppressControlToolPrimaryText(toolCall: ModelToolCall): boolean {
  return toolCall.id.startsWith("final-gate-evidence-");
}

function formatControlToolPrimaryText(
  toolName: string,
  text: string,
  isError: boolean,
  data: unknown,
  context: TuiContext,
): string {
  if (isError) return sanitizeControlToolError(text, context.language);
  const zh = context.language === "zh-CN";
  if (toolName === AGENT_CONTROL_TOOL_NAME) {
    const record = isRecord(data) ? data : {};
    if (Array.isArray(record.cancelled)) {
      return record.cancelled.length > 0
        ? zh
          ? `已停止后台智能体 ${record.cancelled.length} 个。`
          : `Stopped ${record.cancelled.length} background agent(s).`
        : zh
          ? "已检查后台智能体，没有可取消项。"
          : "Checked background agents; nothing to cancel.";
    }
    if (typeof record.total === "number") {
      const cancellable = Array.isArray(record.cancellable) ? record.cancellable.length : 0;
      return zh
        ? `已检查后台智能体：共 ${record.total} 个，可取消 ${cancellable} 个。`
        : `Checked background agents: ${record.total} total, ${cancellable} cancellable.`;
    }
    if (typeof record.status === "string") {
      if (record.status === "not_found") {
        return zh ? "未找到指定后台智能体。" : "The requested background agent was not found.";
      }
      return zh ? "已更新后台智能体状态。" : "Updated background agent status.";
    }
  }
  if (toolName === START_AGENT_TOOL_NAME) {
    const status = isRecord(data) && typeof data.status === "string" ? data.status : "";
    if (status === "running") return zh ? "已启动后台智能体。" : "Started a background agent.";
    if (status === "idle" || status === "completed") {
      return zh ? "智能体已完成本次处理。" : "The agent completed this run.";
    }
    return zh ? "智能体启动结果已记录。" : "Recorded the agent start result.";
  }
  if (toolName === RUN_WORKFLOW_TOOL_NAME) {
    const record = isRecord(data) ? data : {};
    const status = typeof record.status === "string" ? record.status : "";
    const isMultiAgent = record.multiAgent === true;
    if (status === "running") {
      return isMultiAgent
        ? zh ? "已启动多智能体协作。" : "Started multi-agent collaboration."
        : zh ? "已启动后台工作流。" : "Started a background workflow.";
    }
    if (status === "completed") {
      if (isMultiAgent && record.result === "partial") {
        return zh
          ? "多智能体协作返回了部分结果，主链继续整理。"
          : "Multi-agent collaboration returned partial results; main chain continuing.";
      }
      return isMultiAgent
        ? zh ? "多智能体协作已返回结果。" : "Multi-agent collaboration returned results."
        : zh ? "工作流已完成。" : "Workflow completed.";
    }
    if (status === "partial") {
      return isMultiAgent
        ? zh ? "多智能体协作部分完成，主链继续处理。" : "Multi-agent collaboration partially done; main chain continuing."
        : zh ? "工作流部分完成。" : "Workflow partially completed.";
    }
    return isMultiAgent
      ? zh ? "多智能体协作结果已记录。" : "Recorded multi-agent collaboration result."
      : zh ? "工作流结果已记录。" : "Recorded the workflow result.";
  }
  if (toolName === RUN_VERIFICATION_TOOL_NAME) {
    const status = isRecord(data) && typeof data.status === "string" ? data.status : "";
    return zh
      ? `验证已结束：${status || "partial"}。`
      : `Verification finished: ${status || "partial"}.`;
  }
  return text;
}

function sanitizeControlToolError(text: string, language: Language): string {
  const internalTerms = [
    "AgentControl",
    "StartAgent",
    "RunWorkflow",
    "RunVerification",
    "WriteReport",
    "IndexOperation",
  ];
  const hasInternalTerm = internalTerms.some((term) => text.includes(term));
  if (!hasInternalTerm) return text;
  return language === "en-US"
    ? "The control action failed. Use /details for the diagnostic record."
    : "控制操作失败。诊断记录可在 /details 查看。";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function executeWriteReportToolUse(
  toolCall: ModelToolCall,
  context: TuiContext,
  sessionId: string,
  output: Writable,
  continuation?: PendingModelContinuation,
) {
  const obj =
    toolCall.input && typeof toolCall.input === "object" && !Array.isArray(toolCall.input)
      ? (toolCall.input as Record<string, unknown>)
      : {};
  const path = obj.path;
  const content = obj.content;
  if (typeof path !== "string" || !path.trim() || typeof content !== "string") {
    return finishControlToolFailure(
      toolCall,
      context,
      sessionId,
      output,
      "WriteReport requires path and content.",
    );
  }
  const writeCall: ModelToolCall = {
    ...toolCall,
    name: "Write",
    input: {
      path,
      content,
      ...(typeof obj.expectedHash === "string" ? { expectedHash: obj.expectedHash } : {}),
    },
  };
  const permission = await decidePermission("Write", writeCall.input, context, sessionId);
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
    context.pendingLocalApproval = {
      kind: "report_write_tool",
      toolCall: writeCall,
      sessionId,
      continuation,
    };
    if (!context.isInkSession) {
      writeLine(
        output,
        formatModelToolPermissionPrompt(toPermissionPromptView(permission), context.language),
      );
    }
    return {
      ok: false,
      tool: WRITE_REPORT_TOOL_NAME,
      text: `ask: ${permission.reason}`,
      pendingApproval: true,
    };
  }
  if (permission.decision !== "allow") {
    const text = `${permission.decision}: ${permission.reason}`;
    const evidence = await recordToolFailureEvidence(context, sessionId, "Write", text);
    await appendToolResultEvent(context, sessionId, toolCall.id, "Write", text, true, evidence.id);
    return { ok: false, tool: WRITE_REPORT_TOOL_NAME, text, evidenceId: evidence.id };
  }
  return executeApprovedModelToolUse(
    writeCall,
    "Write",
    context,
    sessionId,
    output,
    permission.preflight,
    continuation?.reportWriteGuard,
  );
}

// D.14D-R P0-2 — 结构化索引工具执行 glue。
//   IndexStatusInspect（只读）：刷新状态读取并返回摘要，明确"未刷新"，立即执行。
//   IndexRefresh / IndexRepair（mutating）：进入 pendingLocalApproval（PermissionPanel）
//   确认管道；用户确认后由 executeApprovedIndexToolUse 复用 runIndexRepository /
//   runIndexSafetyRepair 真实执行，再回灌工具结果给模型续轮。
export async function executeIndexToolUse(
  toolCall: ModelToolCall,
  context: TuiContext,
  sessionId: string,
  output: Writable,
  continuation?: PendingModelContinuation,
  forcedAction?: "init fast",
  resultToolName?: string,
  appendToolStart = true,
): Promise<{
  ok: boolean;
  tool: string;
  text: string;
  data?: unknown;
  evidenceId?: string;
  pendingApproval?: boolean;
}> {
  const name = toolCall.name;
  const dispatchName = resultToolName ?? name;
  if (appendToolStart) {
    await context.store.appendEvent(sessionId, {
      type: "tool_call_start",
      id: toolCall.id,
      name,
      input: toolCall.input,
      createdAt: new Date().toISOString(),
    });
  }

  if (name === INDEX_STATUS_INSPECT) {
    // 只读：刷新状态读取（不重建），返回摘要。明确标注"仅检查，未刷新"。
    startRequestActivity(output, context, "tool_running", { toolName: name });
    await refreshIndexStatus(context);
    clearRequestActivity(context);
    const text = summarizeIndexStatusInspect(
      context.index.status,
      context.index.projectName,
      context.index.nodes,
      context.index.edges,
      context.language,
    );
    const evidence = createEvidenceRecord(
      "command_output",
      `index_operation inspect: ${text}`,
      "index-operation:inspect",
      ["index_operation", "index_status_inspect"],
    );
    rememberEvidence(context, evidence);
    await context.store.appendEvent(sessionId, { type: "evidence_record", ...evidence });
    await appendDeferredToolResultEvent(
      context,
      sessionId,
      toolCall.id,
      dispatchName,
      { text },
      false,
      evidence.id,
    );
    writeLine(output, text);
    return { ok: true, tool: name, text, evidenceId: evidence.id };
  }

  // IndexRefresh / IndexRepair — mutating：走权限确认。
  const action: "init fast" | "refresh" | "repair" =
    forcedAction ?? (name === INDEX_REPAIR ? "repair" : "refresh");
  const parsed = parseIndexRefreshInput(toolCall.input);
  // 复用既有 decidePermission（Write 语义代表索引写入/外部 runtime 写入）。default /
  // auto-review 下 Write 为 ask；命中允许规则或 full-access 时直接执行。
  const permission = await decidePermission(
    "Write",
    { path: ".linghun/index" },
    context,
    sessionId,
  );
  await context.store.appendEvent(sessionId, {
    type: "permission_request",
    request: { ...permission.request, toolName: name as unknown as ToolName },
    createdAt: new Date().toISOString(),
  });
  await context.store.appendEvent(sessionId, {
    type: "permission_result",
    requestId: permission.request.id,
    decision: permission.decision,
    reason: permission.reason,
    createdAt: new Date().toISOString(),
  });
  if (context.permissionMode === "auto-review" && permission.decision === "ask") {
    await appendSystemEvent(
      context,
      sessionId,
      `index_${action}_auto_review_allowed: ordinary workspace index write uses existing permission pipeline; dangerous shell/network/install/delete remain gated`,
      "info",
    );
    return executeApprovedIndexToolUse(toolCall, action, parsed.force, context, sessionId, output);
  }
  if (permission.decision === "deny") {
    clearRequestActivity(context);
    const text = `deny: ${permission.reason}`;
    if (!context.isInkSession) {
      writeLine(
        output,
        formatModelToolPermissionPrompt(toPermissionPromptView(permission), context.language),
      );
    }
    const evidence = await recordToolFailureEvidence(
      context,
      sessionId,
      "Write",
      `index ${action} ${text}`,
    );
    await appendDeferredToolResultEvent(
      context,
      sessionId,
      toolCall.id,
      dispatchName,
      text,
      true,
      evidence.id,
    );
    return { ok: false, tool: name, text, evidenceId: evidence.id };
  }
  if (permission.decision === "ask") {
    clearRequestActivity(context);
    context.pendingLocalApproval = {
      kind: "index_tool",
      indexAction: action,
      toolCall: { ...toolCall, name: dispatchName },
      sessionId,
      force: parsed.force,
      continuation,
    };
    // ink 主屏走 PermissionPanel；plain 保留文本 yes/no。
    if (!context.isInkSession) {
      writeLine(
        output,
        formatModelToolPermissionPrompt(toPermissionPromptView(permission), context.language),
      );
    }
    return { ok: false, tool: name, text: `ask: ${permission.reason}`, pendingApproval: true };
  }
  // allow（命中允许规则 / full-access）：直接执行。
  return executeApprovedIndexToolUse(
    { ...toolCall, name: dispatchName },
    action,
    parsed.force,
    context,
    sessionId,
    output,
  );
}

// 用户确认（或已允许）后真实执行索引刷新/修复，复用受控 runtime 路径。
export async function executeApprovedIndexToolUse(
  toolCall: ModelToolCall,
  action: "init fast" | "refresh" | "repair",
  force: boolean | undefined,
  context: TuiContext,
  sessionId: string,
  output: Writable,
): Promise<{
  ok: boolean;
  tool: string;
  text: string;
  data?: unknown;
  evidenceId?: string;
}> {
  const name = toolCall.name;
  const evidenceToolName =
    name === INDEX_OPERATION_TOOL_NAME
      ? INDEX_OPERATION_TOOL_NAME
      : action === "repair"
        ? INDEX_REPAIR
        : INDEX_REFRESH;
  if (action !== "repair") {
    const guard = checkBackgroundStartGuard(context, "index", true);
    if (guard) {
      const evidence = await recordToolFailureEvidence(
        context,
        sessionId,
        "Write",
        `index ${action} resource guard: ${guard}`,
      );
      await appendDeferredToolResultEvent(
        context,
        sessionId,
        toolCall.id,
        evidenceToolName,
        guard,
        true,
        evidence.id,
      );
      writeLine(output, guard);
      return { ok: false, tool: name, text: guard, evidenceId: evidence.id };
    }
  }
  if (!context.isInkSession) {
    startRequestActivity(output, context, "tool_running", { toolName: name });
  }
  if (action === "repair") {
    // 复用 /index repair 续跑：追加 ignore 条目后刷新（内部已有 writeLine 摘要）。
    await runIndexSafetyRepair(context, output);
  } else if (action === "init fast") {
    await runIndexRepository(context, "fast", "init fast", Boolean(force), output, {
      guardAlreadyChecked: true,
    });
  } else {
    await runIndexRepository(context, context.config.index.mode, "refresh", Boolean(force), output, {
      guardAlreadyChecked: true,
    });
  }
  clearRequestActivity(context);
  const ok = context.index.status === "ready" || context.index.status === "stale";
  const text = ok
    ? summarizeIndexRefreshOutcome(
        action === "init fast" ? "refresh" : action,
        context.index.status,
        context.language,
      )
    : context.language === "en-US"
      ? `Index ${action} did not complete: status ${context.index.status}. ${context.index.error ?? ""}`.trim()
      : `索引${action === "repair" ? "修复" : action === "init fast" ? "初始化" : "刷新"}未完成：状态 ${context.index.status}。${context.index.error ?? ""}`.trim();
  const primaryText =
    ok && action !== "repair" && context.index.status === "ready"
      ? `${formatIndexRefreshSummary(
          context,
          action === "init fast" ? "init fast" : "refresh",
        )}\n${text}`
      : text;
  if (ok) {
    const panelAlreadyShown = Boolean(context.isInkSession && context.commandPanelState);
    const evidence = createEvidenceRecord(
      "command_output",
      `index_operation ${action}: ${text}`,
      `index-operation:${action}`,
      ["index_operation", `index_${action.replace(" ", "_")}`],
    );
    rememberEvidence(context, evidence);
    await context.store.appendEvent(sessionId, { type: "evidence_record", ...evidence });
    await appendDeferredToolResultEvent(
      context,
      sessionId,
      toolCall.id,
      evidenceToolName,
      { text },
      false,
      evidence.id,
    );
    if (!context.isInkSession) {
      writeLine(output, primaryText);
    } else if (!panelAlreadyShown) {
      writeLine(output, primaryText);
    }
    return { ok: true, tool: name, text, evidenceId: evidence.id };
  }
  const evidence = await recordToolFailureEvidence(
    context,
    sessionId,
    "Write",
    `index ${action}: ${text}`,
  );
  await appendDeferredToolResultEvent(
    context,
    sessionId,
    toolCall.id,
    evidenceToolName,
    text,
    true,
    evidence.id,
  );
  if (!context.isInkSession) {
    writeLine(output, text);
  } else {
    showCommandPanel(context, output, {
      title:
        action === "repair"
          ? context.language === "en-US"
            ? "Index repair"
            : "索引修复"
          : context.language === "en-US"
            ? "Index refresh"
            : "索引刷新",
      tone: "error",
      summary: [text],
      actions: [
        context.language === "en-US" ? "Use index status for details." : "可查看索引状态获取详情。",
      ],
    });
  }
  return { ok: false, tool: name, text, evidenceId: evidence.id };
}

export function rememberToolFiles(
  context: TuiContext,
  name: ToolName,
  input: unknown,
  output: ToolOutput,
): void {
  const paths: string[] = [];
  if (typeof input === "object" && input !== null && "path" in input) {
    const path = (input as { path?: unknown }).path;
    if (typeof path === "string") {
      paths.push(path.replaceAll("\\", "/"));
    }
  }
  if (name === "ReadSnippets" && typeof input === "object" && input !== null) {
    paths.push(...extractPathsFromRanges((input as { ranges?: unknown }).ranges));
  }
  if (Array.isArray(output.changedFiles)) {
    paths.push(...output.changedFiles);
  }
  if (name === "SourcePack" || name === "ReadSnippets") {
    paths.push(...extractPathsFromToolData(output.data));
  }
  if (name === "Glob" || name === "Grep") {
    paths.push(...extractFileMentions(output.text));
  }
  context.recentlyMentionedFiles = uniqueStrings([
    ...paths.filter(Boolean),
    ...context.recentlyMentionedFiles,
  ]).slice(0, 10);
}

export function rememberSourcePackCandidatesFromToolData(
  context: TuiContext,
  toolName: unknown,
  data: unknown,
): void {
  if (!isSourcePackCandidateProducer(toolName)) {
    return;
  }
  const candidates = extractSourcePackCandidates(data);
  context.tools.sourcePackCandidates = candidates.length > 0 ? candidates : undefined;
}

function isSourcePackCandidateProducer(toolName: unknown): boolean {
  if (typeof toolName !== "string") return false;
  const name = toolName.includes(".") ? toolName.split(".").at(-1) : toolName;
  return (
    name === "search_code" ||
    name === "search_graph" ||
    name === "get_code_snippet" ||
    name === "get_architecture"
  );
}

function extractSourcePackCandidates(data: unknown): SourcePackCandidate[] {
  const candidates: SourcePackCandidate[] = [];
  const seen = new Set<string>();
  visitSourcePackCandidateData(data, 0, (record) => {
    const path = readCandidatePath(record);
    if (!path) return;
    const start = readCandidateStart(record);
    const end = readCandidateEnd(record, start);
    const key = `${path}:${start}:${end}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({
      path,
      start,
      end,
      reason: readCandidateReason(record),
      confidence: readCandidateConfidence(record),
    });
  });
  return candidates.slice(0, 12);
}

function visitSourcePackCandidateData(
  value: unknown,
  depth: number,
  visit: (record: Record<string, unknown>) => void,
): void {
  if (depth > 5 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 40)) {
      visitSourcePackCandidateData(item, depth + 1, visit);
    }
    return;
  }
  if (typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  visit(record);
  for (const item of Object.values(record).slice(0, 40)) {
    visitSourcePackCandidateData(item, depth + 1, visit);
  }
}

function readCandidatePath(record: Record<string, unknown>): string | undefined {
  for (const key of ["path", "file", "file_path", "filepath", "source_path", "relative_path"]) {
    const value = record[key];
    if (typeof value !== "string") continue;
    const normalized = value.replaceAll("\\", "/").replace(/^\.\//u, "").trim();
    if (
      normalized &&
      normalized !== "unknown" &&
      !normalized.includes("\n") &&
      !/^https?:\/\//iu.test(normalized)
    ) {
      return normalized;
    }
  }
  return undefined;
}

function readCandidateStart(record: Record<string, unknown>): number {
  const direct = readPositiveNumberField(record, [
    "start",
    "line",
    "line_number",
    "lineNumber",
    "start_line",
    "startLine",
    "lineno",
  ]);
  if (direct !== undefined) return direct;
  const range = typeof record.range === "string" ? record.range.match(/(\d+)(?:\D+(\d+))?/u) : null;
  if (range?.[1]) return Math.max(1, Number.parseInt(range[1], 10));
  return 1;
}

function readCandidateEnd(record: Record<string, unknown>, start: number): number {
  const direct = readPositiveNumberField(record, [
    "end",
    "end_line",
    "endLine",
    "line_end",
    "lineEnd",
  ]);
  if (direct !== undefined) return Math.max(start, direct);
  const range = typeof record.range === "string" ? record.range.match(/(\d+)(?:\D+(\d+))?/u) : null;
  if (range?.[2]) return Math.max(start, Number.parseInt(range[2], 10));
  return start + 24;
}

function readPositiveNumberField(
  record: Record<string, unknown>,
  keys: string[],
): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 1) {
      return Math.trunc(value);
    }
    if (typeof value === "string" && /^\d+$/u.test(value)) {
      return Number.parseInt(value, 10);
    }
  }
  return undefined;
}

function readCandidateReason(record: Record<string, unknown>): string | undefined {
  const parts = ["symbol", "name", "qualified_name", "kind", "type", "label"]
    .map((key) => record[key])
    .filter((value): value is string | number => typeof value === "string" || typeof value === "number")
    .map((value) => String(value).trim())
    .filter(Boolean);
  return parts.length > 0 ? `index candidate: ${parts.slice(0, 3).join(" ")}` : "index candidate";
}

function readCandidateConfidence(record: Record<string, unknown>): number | undefined {
  for (const key of ["confidence", "score", "similarity"]) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      if (value < 0) return undefined;
      return value > 1 ? Math.min(0.95, value / 100) : Math.min(0.95, value);
    }
  }
  return undefined;
}

function extractPathsFromRanges(ranges: unknown): string[] {
  if (!Array.isArray(ranges)) return [];
  return ranges
    .map((item) =>
      item && typeof item === "object" && typeof (item as { path?: unknown }).path === "string"
        ? (item as { path: string }).path.replaceAll("\\", "/")
        : undefined,
    )
    .filter((item): item is string => Boolean(item));
}

function extractPathsFromToolData(data: unknown): string[] {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const record = data as Record<string, unknown>;
  const candidatePaths = record.candidatePaths;
  if (Array.isArray(candidatePaths)) {
    return candidatePaths
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.replaceAll("\\", "/"));
  }
  return [
    ...extractPathsFromRanges(record.ranges),
    ...extractPathsFromRanges(record.snippets),
  ];
}

type NaturalFileReadResult =
  | { status: "none" }
  | { status: "resolved"; path: string };

async function resolveNaturalFileRead(
  text: string,
  context: TuiContext,
): Promise<NaturalFileReadResult> {
  if (!isNaturalReadFileRequest(text)) {
    return { status: "none" };
  }

  if (hasModelSynthesisIntent(text)) {
    return { status: "none" };
  }

  const explicit = extractNaturalReadPath(text);
  if (explicit) {
    return { status: "resolved", path: explicit };
  }

  return { status: "none" };
}

export async function recordReportIncompleteEvidence(
  context: TuiContext,
  sessionId: string,
  guard: ReportWriteGuard,
): Promise<string> {
  const evidence = createEvidenceRecord(
    "command_output",
    `report_incomplete blocked missing Write evidence requestedPath=${guard.requestedPath}`,
    `report:${guard.requestedPath}`,
    ["report_incomplete", "missing_write_evidence", guard.requestedPath],
  );
  rememberEvidence(context, evidence);
  await context.store.appendEvent(sessionId, {
    type: "evidence_record",
    ...evidence,
  });
  await appendSystemEvent(
    context,
    sessionId,
    `report incomplete: missing Write evidence for ${guard.requestedPath}; evidence ${evidence.id}`,
    "warning",
  );
  // D.14B — report guard 未满足转 failure learning。relatedTarget 用脱敏路径基名，不记完整绝对路径。
  await captureFailureLearning(context, sessionId, {
    category: "report_guard",
    failureSummary: `report write blocked: missing Write evidence for ${basename(guard.requestedPath)}`,
    rootCauseGuess: "claimed a report/file was written without an actual Write tool_use",
    avoidNextTime:
      "Actually run the Write tool before claiming a report/file is written; the report guard requires Write evidence",
    sourceRef: `evidence:${evidence.id}`,
    relatedTarget: basename(guard.requestedPath),
    severity: "medium",
  });
  return formatReportIncompletePrimary(guard.requestedPath, context.language);
}

export async function handleToolCommand(
  name: ToolName,
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  try {
    const input = parseToolInput(name, args);
    const sessionId = await ensureSession(context);
    const permission = await decidePermission(name, input, context, sessionId);
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
    if (permission.autoAllowPolicy) {
      // Same audit event as the model-dispatched path. Mirrors the
      // emit in executeModelToolUse so transcripts have a single, uniform
      // signal regardless of whether the tool was triggered by the model
      // or by a user-typed slash command.
      const verdict = permission.autoAllowPolicy;
      await appendSystemEvent(
        context,
        sessionId,
        formatPermissionAutoAllowEvent(name, verdict),
        "info",
      );
    }

    if (permission.decision !== "allow") {
      await recordToolFailureEvidence(
        context,
        sessionId,
        name,
        `permission ${permission.decision}: ${permission.reason}; ${permission.request.summary}`,
      );
      writeLine(output, formatPermissionDenied(permission.reason, permission.request.summary));
      writeStatus(output, context);
      return;
    }

    const boundaryPreflight =
      context.permissionMode === "full-access" || context.permissionMode === "auto-review"
        ? { decision: "allow" as const, reason: `${context.permissionMode} skips TUI boundary confirmation` }
        : await runBoundaryEditPreflight(
            { id: "slash-command-preflight", name, input },
            name,
            context,
          );
    if (boundaryPreflight.decision === "confirm") {
      writeLine(output, formatBoundaryEditPreflightPrompt(boundaryPreflight, context.language));
      context.pendingLocalApproval = undefined;
      writeStatus(output, context);
      return;
    }

    const shouldKeepAutoReviewWorkspaceEditQuiet =
      context.permissionMode === "auto-review" &&
      permission.request.files.length > 0 &&
      (name === "Write" || name === "Edit" || name === "MultiEdit");

    if (permission.preflight && !shouldKeepAutoReviewWorkspaceEditQuiet) {
      writeLine(output, permission.preflight);
    }

    if (name === "Bash") {
      const guard = checkBackgroundStartGuard(context, "bash", true);
      if (guard) {
        writeLine(output, guard);
        writeStatus(output, context);
        return;
      }
    }

    const checkpoint = await maybeCreateCheckpoint(name, input, context, sessionId);
    if (checkpoint && !shouldKeepAutoReviewWorkspaceEditQuiet) {
      writeLine(output, `${t(context, "checkpointCreated")}：${checkpoint.id}`);
    }
    const task = name === "Bash" ? createBackgroundTask(name, input, context) : undefined;
    if (task) {
      task.ownerSessionId = sessionId;
      rememberBackgroundTask(context, task);
      await appendBackgroundTaskEvent(context, sessionId, task);
      writeLine(output, formatBackgroundTask(task, context.language));
    }

    const callId = randomUUID();
    await context.store.appendEvent(sessionId, {
      type: "tool_call_start",
      id: callId,
      name,
      input,
      createdAt: new Date().toISOString(),
    });
    const backgroundController = task
      ? registerBackgroundAbortController(context, task.id)
      : undefined;
    const previousAbortSignal = context.tools.abortSignal;
    if (backgroundController) {
      context.tools.abortSignal = backgroundController.signal;
    }
    const progress = installToolProgressHandler(context, sessionId, callId, output, task);
    // R1: tool start banner suppressed by default (noise reduction).
    let result: Awaited<ReturnType<typeof runTool>>;
    let bgStarted2 = false;
    try {
      result = await runTool(name, input, progress.toolContext);
      bgStarted2 = !!(result.output.data as { backgroundTaskId?: string } | undefined)?.backgroundTaskId;
    } finally {
      progress.restore();
      await Promise.all(progress.pending);
      if (!bgStarted2) {
        clearBackgroundAbortController(context, task?.id ?? "");
      }
      if (backgroundController && context.tools.abortSignal === backgroundController.signal) {
        context.tools.abortSignal = previousAbortSignal;
      }
    }
    if (task) {
      const bgData = result.output.data as { backgroundTaskId?: string; outputPath?: string } | undefined;
      if (bgData?.backgroundTaskId) {
        context.backgroundBashTaskMap?.set(bgData.backgroundTaskId, task.id);
        task.outputPath = bgData.outputPath ?? undefined;
      } else {
        finishBackgroundTaskFromToolOutput(task, result.output, context);
      }
      await appendBackgroundTaskEvent(context, sessionId, task);
    }
    await context.store.appendEvent(sessionId, createToolEndEvent(callId, result.output));
    await appendDerivedToolEvents(context, sessionId, name, result.output);
    const evidence = await recordToolEvidence(context, sessionId, name, result.output, input);
    rememberToolFiles(context, name, input, result.output);
    await appendToolResultEvent(
      context,
      sessionId,
      callId,
      name,
      result.output,
      isToolOutputFailure(name, result.output),
      evidence?.id,
    );
    if (isToolOutputFailure(name, result.output)) {
      await captureFailureLearning(context, sessionId, {
        category: "tool_failure",
        failureSummary: `${name} exited non-zero: ${result.output.text}`,
        rootCauseGuess: `${name} command returned a non-zero exit code`,
        avoidNextTime:
          "Inspect the command output and exit code; fix the underlying cause before claiming the command passed",
        sourceRef: evidence?.id ? `evidence:${evidence.id}` : `tool:${name}`,
        relatedTarget: name,
        severity: "medium",
      });
    }
    writeLine(output, formatToolOutput(name, result.output, context.language, evidence?.id));
    writeStatus(output, context);
  } catch (error) {
    writeErrorLine(output, formatError(error, context.language));
  }
}

function parseToolInput(name: ToolName, args: string[]): unknown {
  if (name === "Read") {
    return { path: requireArg(args.join(" ").trim(), "用法：/read <path>") };
  }
  if (name === "Write") {
    return {
      path: requireArg(args[0], "用法：/write <path> <text>"),
      content: args.slice(1).join(" "),
    };
  }
  if (name === "Edit" || name === "MultiEdit") {
    const path = requireArg(args[0], `用法：/${name.toLowerCase()} <path> <old> => <new>`);
    const expression = args.slice(1).join(" ");
    const separator = expression.indexOf("=>");
    if (separator < 0) {
      throw new Error(`用法：/${name.toLowerCase()} <path> <old> => <new>`);
    }
    const oldText = expression.slice(0, separator).trim();
    const newText = expression.slice(separator + 2).trim();
    if (name === "MultiEdit") {
      return { path, edits: [{ oldText, newText }] };
    }
    return { path, oldText, newText };
  }
  if (name === "Grep") {
    return { pattern: requireArg(args[0], "用法：/grep <pattern> [path]"), path: args[1] };
  }
  if (name === "Glob") {
    return { pattern: requireArg(args[0], "用法：/glob <pattern> [path]"), path: args[1] };
  }
  if (name === "Bash") {
    return { command: requireArg(args.join(" ").trim(), "用法：/bash <command>") };
  }
  if (name === "Todo") {
    const action = args[0];
    if (!action) {
      return { action: "list" };
    }
    if (action === "add") {
      return {
        action,
        content: requireArg(args.slice(1).join(" ").trim(), "用法：/todo add <text>"),
      };
    }
    if (action === "start" || action === "done" || action === "block") {
      return { action, id: requireArg(args[1], `用法：/todo ${action} <id>`) };
    }
    throw new Error("用法：/todo 或 /todo add|start|done|block ...");
  }
  return {};
}

function requireArg(value: string | undefined, usage: string): string {
  if (!value) {
    throw new Error(usage);
  }
  return value;
}

// Module 3 — PermissionCheck / decidePermission / recordPermissionDenied /
// loadPermissionState / savePermissionState / permissionStatePath 已移至
// ./tui-permission-runtime.ts。

export function formatPlanProposal(proposal: PlanProposal): string {
  const lines = [`PlanProposal ${proposal.id}：${proposal.title}`];
  for (const option of proposal.options) {
    lines.push(`方案 ${option.id}：${option.title}`);
    lines.push(...option.steps.map((step, index) => `  ${index + 1}. ${step}`));
    lines.push(...option.risks.map((risk) => `  风险：${risk}`));
  }
  return lines.join("\n");
}

export async function maybeCreateCheckpoint(
  name: ToolName,
  input: unknown,
  context: TuiContext,
  sessionId: string,
): Promise<CheckpointState | null> {
  const files = collectInputFiles(input);
  const needsCheckpoint = !builtInTools[name].isReadOnly && files.length > 0;
  if (!needsCheckpoint) {
    return null;
  }
  const checkpoint: CheckpointState = {
    id: randomUUID(),
    sessionId,
    createdAt: new Date().toISOString(),
    reason: `before ${name}`,
    changedFiles: files,
    restoreKind: "snapshot",
    files: [],
  };
  for (const file of files) {
    const target = resolve(context.projectPath, file);
    try {
      checkpoint.files.push({ path: file, existed: true, content: await readFile(target, "utf8") });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        checkpoint.files.push({ path: file, existed: false });
        continue;
      }
      throw error;
    }
  }
  context.checkpoints.unshift(checkpoint);
  context.checkpoints = context.checkpoints.slice(0, MAX_CHECKPOINTS);
  await context.store.appendEvent(sessionId, {
    type: "checkpoint_created",
      checkpoint: {
        id: checkpoint.id,
        sessionId: checkpoint.sessionId,
        createdAt: checkpoint.createdAt,
        reason: checkpoint.reason,
        changedFiles: checkpoint.changedFiles,
        restoreKind: checkpoint.restoreKind,
        restorable: true,
        files: checkpoint.files,
      },
      createdAt: checkpoint.createdAt,
    });
  return checkpoint;
}

function createBackgroundTask(
  name: ToolName,
  input: unknown,
  context: TuiContext,
): BackgroundTaskState {
  const now = new Date().toISOString();
  const command =
    typeof input === "object" && input !== null ? (input as { command?: unknown }).command : "";
  const title =
    name === "Bash" && typeof command === "string" ? `Bash: ${truncateDisplay(command, 40)}` : name;
  return {
    id: randomUUID(),
    kind: "bash",
    title,
    status: "running",
    currentStep: context.language === "en-US" ? "running command" : "正在执行命令",
    progress: { completed: 0, total: 1, label: "Bash" },
    startedAt: now,
    updatedAt: now,
    heartbeatIntervalMs: 30_000,
    staleAfterMs: 120_000,
    hasOutput: false,
    userVisibleSummary:
      context.language === "en-US"
        ? "Started long task. Use /background for details."
        : "长任务已启动。可用 /background 查看详情。",
    nextAction:
      context.language === "en-US"
        ? "Wait for completion or use /interrupt."
        : "等待完成，或用 /interrupt 中断。",
  };
}

function shouldTrackBashAsBackground(input: unknown): boolean {
  if (typeof input !== "object" || input === null) return false;
  const record = input as { runInBackground?: unknown; run_in_background?: unknown };
  return record.runInBackground === true || record.run_in_background === true;
}

async function appendProgressEventSafely(
  context: TuiContext,
  sessionId: string,
  event: Parameters<TuiContext["store"]["appendEvent"]>[1],
  requestOwner?: { requestTurnId: string; signal: AbortSignal },
): Promise<void> {
  if (
    requestOwner &&
    (requestOwner.signal.aborted || context.currentRequestTurnId !== requestOwner.requestTurnId)
  ) {
    return;
  }
  try {
    await context.store.appendEvent(sessionId, event);
  } catch (error) {
    if (isSessionAppendRace(error)) return;
    throw error;
  }
}

function isSessionAppendRace(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("未找到会话：");
}

function installToolProgressHandler(
  context: TuiContext,
  sessionId: string,
  callId: string,
  output: Writable,
  task?: BackgroundTaskState,
  requestOwner?: { requestTurnId: string; signal: AbortSignal },
): { toolContext: ToolContext; pending: Promise<void>[]; restore: () => void } {
  const previous = context.tools.onProgress;
  const pending: Promise<void>[] = [];
  let visibleProgressLines = 0;
  let progressSuppressed = false;
  let lastWebActivityAt = Number.NEGATIVE_INFINITY;
  let lastWebActivityPhase: StructuredToolProgressEvent["phase"];
  const initialToolTarget = (context as { requestActivityToolTarget?: string })
    .requestActivityToolTarget;
  const handler = (event: StructuredToolProgressEvent) => {
    if (
      requestOwner &&
      (requestOwner.signal.aborted || context.currentRequestTurnId !== requestOwner.requestTurnId)
    ) {
      return;
    }
    if (event.toolName === "WebSearch" || event.toolName === "WebFetch") {
      if (!event.phase || context.requestActivityToolUseId !== callId) {
        return;
      }
      const now = Date.now();
      if (event.phase === lastWebActivityPhase && now - lastWebActivityAt < 1_000) {
        return;
      }
      lastWebActivityAt = now;
      lastWebActivityPhase = event.phase;
      const progress = [
        initialToolTarget,
        event.phase,
        event.transport,
        event.receivedBytes !== undefined ? formatWebProgressBytes(event.receivedBytes) : undefined,
        event.itemCount !== undefined ? `${event.itemCount} items` : undefined,
      ].filter((value): value is string => Boolean(value));
      (context as { requestActivityToolTarget?: string }).requestActivityToolTarget =
        progress.join(" · ");
      context.shellRerender?.();
      return;
    }
    if (event.toolName !== "Bash") {
      void previous?.(event);
      return;
    }
    const message = `[${event.stream}] ${event.text}`;
    const displayText = event.text.replace(/\r/g, "");
    if (task) {
      task.currentStep = event.stream === "stderr" ? "stderr output" : "streaming output";
      task.updatedAt = new Date().toISOString();
      task.lastOutputAt = task.updatedAt;
      task.hasOutput = true;
      task.progress = { completed: 0, total: 1, label: "streaming" };
      pending.push(
        appendProgressEventSafely(context, sessionId, {
          type: "background_task_update",
          task,
          createdAt: new Date().toISOString(),
        }, requestOwner),
      );
    }
    pending.push(
      appendProgressEventSafely(context, sessionId, {
        type: "tool_call_delta",
        id: callId,
        message: truncateDisplay(message.replace(/\s+/g, " "), 500),
        createdAt: new Date().toISOString(),
      }, requestOwner),
    );
    const lines = displayText.split(/\r?\n/u).filter(Boolean);
    context.requestActivityToolLines = (context.requestActivityToolLines ?? 0) + lines.length;
    context.requestActivityToolBytes =
      (context.requestActivityToolBytes ?? 0) + Buffer.byteLength(displayText, "utf-8");
    const remainingLines = Math.max(0, 6 - visibleProgressLines);
    const visibleLines = lines.slice(0, remainingLines);
    if (remainingLines > 0) {
      output.write(`${truncateDisplay(visibleLines.join("\n"), 2_000)}\n`);
      visibleProgressLines += Math.min(lines.length, remainingLines);
    }
    // 确保至少显示前 5 行才允许截断
    const PROGRESS_PREVIEW_LINES = 5;
    if (
      (lines.length > remainingLines || visibleLines.some((line) => line.length > 2_000)) &&
      visibleProgressLines >= PROGRESS_PREVIEW_LINES &&
      !progressSuppressed
    ) {
      output.write(
        context.language === "en-US"
          ? "... more command output hidden; press Ctrl+O for details.\n"
          : "... 更多命令输出已隐藏；按 Ctrl+O 查看完整内容。\n",
      );
      progressSuppressed = true;
    }
  };
  const toolContext = new Proxy(context.tools, {
    get(target, property, receiver) {
      return property === "onProgress" ? handler : Reflect.get(target, property, receiver);
    },
  });
  return {
    toolContext,
    pending,
    restore: () => undefined,
  };
}

function formatWebProgressBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  return `${(bytes / 1_024).toFixed(1)} KB`;
}
