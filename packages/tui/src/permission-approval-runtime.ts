import { randomUUID } from "node:crypto";
import type { Writable } from "node:stream";
import type { ModelGateway, ModelMessage } from "@linghun/providers";
import type { PermissionMode } from "@linghun/shared";
import { type ToolName, builtInTools } from "@linghun/tools";
import {
  checkBackgroundStartGuard,
  refreshBackgroundLifecycle,
} from "./background-control-runtime.js";
import { writeLightHints } from "./cache-command-runtime.js";
import { showCommandPanel } from "./command-panel-runtime.js";
import { executeBreakCacheMutation } from "./compact-cache-command-runtime.js";
import { ensureSession, t, writeStatus } from "./details-status-runtime.js";
import {
  appendDeferredToolResultEvent,
  appendToolResultEvent,
  getToolResultBudgetState,
  recordToolFailureEvidence,
  recordToolResultBudgetEvidence,
} from "./evidence-runtime.js";
import { appendSystemEvent, recordModelToolFailureForMetaScheduler } from "./evidence-runtime.js";
import {
  resolveStablePointApprove,
  resolveStablePointDeny,
  resolveWorktreeRemoveApprove,
  resolveWorktreeRemoveDeny,
} from "./git-tool-dispatch-runtime.js";
import { denyAgentToolUse, executeApprovedAgentToolUse } from "./job-agent-command-runtime.js";
import { handleJobCommand } from "./job-agent-command-runtime.js";
import { parseJobRunOptions } from "./job-runtime.js";
import { executeMemoryMutation } from "./memory-command-runtime.js";
import { WRITE_REPORT_TOOL_NAME } from "./model-loop-runtime.js";
import { continueModelAfterToolResults, handleNaturalInput } from "./model-stream-runtime.js";
import {
  executeApprovedIndexToolUse,
  executeApprovedModelToolUse,
  formatBoundaryEditPreflightPrompt,
  formatPlanProposal,
} from "./model-tool-runtime.js";
import type { PermissionRule } from "./permission-continuation-runtime.js";
import {
  doesWriteSatisfyReportGuard,
  formatPermissionDenialPrimary,
  formatPermissionDenied,
  formatPermissionRules,
  formatRecentDenied,
  normalizeToolName,
  parsePermissionModeInput,
} from "./permission-continuation-runtime.js";
import { formatLocalToolPermissionPrompt } from "./permission-presenter.js";
import { formatModelToolPermissionPrompt } from "./permission-presenter.js";
import { LINGHUN_PROVIDER_TOOL_RESULT_CHARS } from "./runtime-budget.js";
import {
  createWorktreeRemoveResolveDeps,
  executeImageGeneration,
  executeIndexIgnoreWritePlan,
  runIndexRepairRefresh,
  startPendingAutopilot,
} from "./slash-command-runtime.js";
import { writeLine } from "./startup-runtime.js";
import { applyToolResultBudgetToMessages } from "./tool-result-budget.js";
import { truncateDisplay } from "./startup-runtime.js";
import { isRuntimeActiveBackgroundTask } from "./tui-agent-job-runtime.js";
import type { PendingLocalApproval, TuiContext } from "./tui-context-runtime.js";
import { createSingleToolCallContinuation } from "./tui-context-runtime.js";
import type { PendingAutopilotRequest } from "./tui-context-runtime.js";
import type { PlanProposal } from "./tui-data-types.js";
import {
  addAllowRule,
  decidePermission,
  savePermissionState,
  toPermissionPromptView,
} from "./tui-permission-runtime.js";

async function appendBudgetedToolResultToContinuation(
  context: TuiContext,
  sessionId: string,
  messages: ModelMessage[],
  toolCallId: string,
  result: unknown,
): Promise<void> {
  const toolMessage: ModelMessage = {
    role: "tool",
    tool_call_id: toolCallId,
    content: JSON.stringify(result),
  };
  const budgeted = await applyToolResultBudgetToMessages([toolMessage], {
    projectPath: context.projectPath,
    sessionId,
    state: getToolResultBudgetState(context),
    singleResultChars: LINGHUN_PROVIDER_TOOL_RESULT_CHARS,
  });
  for (const record of budgeted.records) {
    await recordToolResultBudgetEvidence(context, sessionId, record);
  }
  messages.push(...budgeted.messages);
}

export async function handleTuiKeypress(
  key: "escape" | "return" | "shift-tab",
  context: TuiContext,
  output: Writable,
): Promise<void> {
  if (key === "escape") {
    if (context.ctrlOExpandState?.active) {
      context.ctrlOExpandState = { active: false };
      return;
    }
    await cancelPendingInteraction(context, output, "Esc");
    return;
  }
  if (key === "shift-tab") {
    await cycleMode(context, output);
    const continued = await reevaluatePendingLocalApprovalAfterModeChange(
      context,
      context.modelGateway,
      output,
    );
    if (continued) {
      writeStatus(output, context);
    }
    return;
  }
  if (hasPendingEnterConfirmation(context)) {
    await confirmPendingInteraction(context, output);
  }
}

export async function cancelPendingInteraction(
  context: TuiContext,
  output: Writable,
  source: string,
): Promise<void> {
  if (context.pendingLocalApproval) {
    const approval = context.pendingLocalApproval;
    context.pendingLocalApproval = undefined;
    if (approval.kind === "index_ignore_write") {
      await executePermissionDeny(approval, context, context.modelGateway, output, true, source);
    } else if (approval.kind === "git_worktree_remove") {
      await executePermissionDeny(approval, context, context.modelGateway, output, true, source);
    } else {
      await executePermissionDeny(approval, context, context.modelGateway, output, true, source);
    }
    return;
  }
  if (context.pendingNaturalCommand) {
    context.pendingNaturalCommand = undefined;
    writeLine(output, `${source} 已取消待确认动作；没有执行命令。可重新描述目标或输入 /help。`);
    writeStatus(output, context);
    return;
  }
  if (context.pendingAutopilot) {
    context.pendingAutopilot = undefined;
    writeLine(output, "已取消持续推进确认；没有启动 job。可用 /autopilot <目标> 重新设置边界。");
    writeStatus(output, context);
    return;
  }
  if (context.activePlan && !context.planAccepted) {
    context.activePlan = undefined;
    context.planAccepted = false;
    writeLine(output, "已取消待确认计划；没有进入执行。可重新运行 /plan 或继续说明修改意见。");
    writeStatus(output, context);
    return;
  }
  if (hasActiveInterruptibleWork(context)) {
    if (!context.notifications) context.notifications = [];
    context.notifications.push({
      key: `esc-no-interrupt:${Date.now()}`,
      text:
        context.language === "en-US"
          ? "Esc does not stop tasks; press Ctrl+C or run /interrupt to stop."
          : "Esc 不会停止任务；按 Ctrl+C 或 /interrupt 停止。",
      priority: "medium",
      timeoutMs: 4000,
      createdAt: Date.now(),
      tone: "dim",
    });
  }
}

export async function reevaluatePendingLocalApprovalAfterModeChange(
  context: TuiContext,
  gateway: ModelGateway | undefined,
  output: Writable,
): Promise<boolean> {
  const approval = context.pendingLocalApproval;
  if (!approval || approval.kind !== "model_tool_use") return false;
  const permission = await decidePermission(
    approval.toolName,
    approval.toolCall.input,
    context,
    approval.sessionId,
  );
  approval.verdict = permission.verdict;
  if (permission.decision !== "allow") return false;
  context.pendingLocalApproval = undefined;
  await executePermissionApprove(approval, context, gateway, output);
  return true;
}

function hasActiveInterruptibleWork(context: TuiContext): boolean {
  if (context.activeAbortController) return true;
  if (context.activeVerificationAbortController) return true;
  if (context.backgroundAbortControllers && context.backgroundAbortControllers.size > 0)
    return true;
  if (context.interrupt?.type === "running") return true;
  if (
    context.backgroundTasks.some(
      (task) =>
        isRuntimeActiveBackgroundTask(task) ||
        task.status === "paused" ||
        task.status === "blocked",
    )
  ) {
    return true;
  }
  const workflowStatus = context.workflows.activeRun?.status;
  return workflowStatus === "running" || workflowStatus === "blocked";
}

export function hasPendingEnterConfirmation(context: TuiContext): boolean {
  return Boolean(
    context.pendingLocalApproval ||
      context.pendingNaturalCommand ||
      context.pendingAutopilot ||
      (context.activePlan && !context.planAccepted),
  );
}

export async function confirmPendingInteraction(
  context: TuiContext,
  output: Writable,
): Promise<void> {
  if (context.pendingNaturalCommand?.requiresExactConfirmation) {
    writeLine(
      output,
      "该动作需要输入精确 slash command；/enter 不会绕过精确确认。输入 /esc 可取消。",
    );
    writeStatus(output, context);
    return;
  }
  if (context.pendingAutopilot) {
    await startPendingAutopilot(context, output);
    return;
  }
  if (context.pendingLocalApproval) {
    await handleNaturalInput("yes", context, output);
    return;
  }
  if (context.pendingNaturalCommand) {
    await handleNaturalInput("yes", context, output);
    return;
  }
  if (context.activePlan && !context.planAccepted) {
    await handlePlanCommand(
      ["accept", "manual", context.activePlan.options[0]?.id ?? "a"],
      context,
      output,
    );
    return;
  }
  writeLine(output, "当前没有等待确认的显式选择；请提交输入或先发起需要确认的请求。");
  writeStatus(output, context);
}

export async function handleModeCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const rawMode = args[0] === "set" ? args[1] : args[0];
  if (!rawMode) {
    writeLine(output, t(context, "modeCurrent", { mode: context.permissionMode }));
    writeLine(output, t(context, "modeOptions"));
    writeLine(output, t(context, "modeBoundary"));
    return;
  }
  const nextMode = parsePermissionModeInput(rawMode);
  if (!nextMode) {
    writeLine(output, t(context, "modeUnknown"));
    return;
  }
  await setPermissionMode(context, output, nextMode, `mode command -> ${nextMode}`);
}

export async function cycleMode(context: TuiContext, output: Writable): Promise<void> {
  const modes: PermissionMode[] = ["default", "auto-review", "plan", "full-access"];
  const index = modes.indexOf(context.permissionMode);
  const nextMode = modes[(index + 1) % modes.length] ?? "default";
  await setPermissionMode(context, output, nextMode, "tab mode cycle");
}

function openModeSwitch(context: TuiContext, output: Writable): void {
  writeLine(
    output,
    context.language === "en-US"
      ? [
          "Mode switch",
          `- current: ${context.permissionMode}`,
          "- options: default / auto-review / plan / full-access",
          "- Shift+Tab cycles modes directly; /mode <mode> switches directly.",
          "- switching mode does not bypass hard denies; dangerous actions still go through the permission pipeline.",
        ].join("\n")
      : [
          "模式切换",
          `- 当前：${context.permissionMode}`,
          "- 可选：default / auto-review / plan / full-access",
          "- Shift+Tab 会直接循环切换模式；/mode <mode> 可直接切换。",
          "- 切换模式不等于绕过硬拒绝；危险动作仍受权限底座约束。",
        ].join("\n"),
  );
  writeStatus(output, context);
}

async function setPermissionMode(
  context: TuiContext,
  output: Writable,
  nextMode: PermissionMode,
  reason: string,
): Promise<void> {
  const previousMode = context.permissionMode;
  const previousPlanAccepted = context.planAccepted;
  const sessionId = await ensureSession(context);
  try {
    await appendSystemEvent(
      context,
      sessionId,
      `permission mode change: ${previousMode} -> ${nextMode}; reason ${reason}; boundary Start Gate and permission pipeline remain active`,
      "info",
    );
    context.permissionMode = nextMode;
    context.planAccepted = false;
  } catch (error) {
    context.permissionMode = previousMode;
    context.planAccepted = previousPlanAccepted;
    throw error;
  }
  writeLine(output, t(context, "modeSwitched", { mode: nextMode }));
  if (nextMode === "plan") {
    writeLine(output, t(context, "modePlanBoundary"));
  }
  writeStatus(output, context);
}

export async function handlePlanCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0];
  if (action === "accept") {
    if (!context.activePlan) {
      writeLine(output, "当前没有待确认计划。先运行 /plan 生成结构化方案。");
      return;
    }
    const boundary = args[1] ?? "manual";
    if (boundary !== "manual" && boundary !== "auto-review") {
      writeLine(
        output,
        "用法：/plan accept manual|auto-review。批准计划不等于授权所有工具；Bash/联网/依赖/权限仍走权限管道。",
      );
      return;
    }
    const optionId = args[2] ?? context.activePlan.options[0]?.id ?? "a";
    context.planAccepted = true;
    context.permissionMode = boundary === "auto-review" ? "auto-review" : "default";
    const sessionId = await ensureSession(context);
    await context.store.appendEvent(sessionId, {
      type: "plan_decision",
      proposalId: context.activePlan.id,
      optionId,
      decision: "accepted",
      createdAt: new Date().toISOString(),
    });
    await appendSystemEvent(
      context,
      sessionId,
      `plan approved: proposal ${context.activePlan.id}; option ${optionId}; boundary ${boundary}; note does not authorize all tools`,
      "info",
    );
    writeLine(
      output,
      `已确认计划 ${context.activePlan.id} / 方案 ${optionId}；边界=${boundary}；当前模式=${context.permissionMode}。写入、Bash、联网、依赖和权限变更仍走权限管道。`,
    );
    writeStatus(output, context);
    return;
  }
  if (action === "reject") {
    if (!context.activePlan) {
      writeLine(output, "当前没有待拒绝计划。先运行 /plan 生成结构化方案。");
      return;
    }
    const feedback = args.slice(1).join(" ") || "no feedback";
    const sessionId = await ensureSession(context);
    await context.store.appendEvent(sessionId, {
      type: "plan_decision",
      proposalId: context.activePlan.id,
      optionId: context.activePlan.options[0]?.id ?? "a",
      decision: "rejected",
      createdAt: new Date().toISOString(),
    });
    await appendSystemEvent(context, sessionId, `plan_rejected: ${feedback}`, "info");
    context.planAccepted = false;
    writeLine(output, `已拒绝当前计划并保留 plan 模式。反馈：${feedback}`);
    writeStatus(output, context);
    return;
  }

  const proposal: PlanProposal = {
    id: randomUUID(),
    title: "Phase 06 执行前计划",
    options: [
      {
        id: "a",
        title: "最小权限闭环（推荐）",
        steps: [
          "先用 Read/Grep/Glob/Diff 收集证据",
          "确认写入文件和风险摘要",
          "执行工作区内允许的低/中风险改动",
          "运行最小必要验证",
        ],
        risks: ["需要写入时必须离开 plan 或确认计划", "Bash 不会在 auto-review 中自动放行"],
      },
      {
        id: "b",
        title: "只读审查",
        steps: ["保持 plan 模式", "只运行 Read/Grep/Glob/Diff/Todo", "输出建议，不写文件"],
        risks: ["不会完成需要落盘的代码改动"],
      },
    ],
  };
  context.activePlan = proposal;
  context.permissionMode = "plan";
  context.planAccepted = false;
  const sessionId = await ensureSession(context);
  await context.store.appendEvent(sessionId, {
    type: "plan_proposal",
    proposal,
    createdAt: new Date().toISOString(),
  });
  writeLine(output, formatPlanProposal(proposal));
  writeLine(
    output,
    "确认执行请运行：/plan accept manual a 或 /plan accept auto-review a；拒绝请运行 /plan reject <反馈>。批准计划不授权 Bash/联网/依赖/权限变更。",
  );
  writeStatus(output, context);
}

// ---------------------------------------------------------------------------
// D.13E Step 2 — permission helpers（修正 #3 + #4）
// ---------------------------------------------------------------------------
// Module 3 (permission-runtime) — addAllowRule、decidePermission、
// recordPermissionDenied、loadPermissionState、savePermissionState、
// permissionStatePath、toPermissionPromptView、PermissionCheck、
// AddAllowRuleResult 都迁移到 ./tui-permission-runtime.ts。
// 保留在 index.ts 的协调器：executePermissionApprove / executePermissionDeny /
// handlePermissionsCommand / setPermissionMode / getModeChangeGuard，因为它们
// 依赖 i18n（t）/ ensureSession / executeIndexIgnoreWritePlan /
// runIndexRepairRefresh / executeApprovedModelToolUse /
// continueModelAfterToolResults / writeLightHints / writeStatus 等
// index.ts 内部协调函数，跨模块迁移会引入循环依赖。
// ---------------------------------------------------------------------------

// 测试导出：让 index.test.ts 直接覆盖去重 / 失败回滚 / 成功落盘三条核心路径。
export async function addAllowRuleForTest(
  context: TuiContext,
  toolName: ToolName | "*",
  risk: PermissionRule["risk"] | undefined,
): Promise<import("./tui-permission-runtime.js").AddAllowRuleResult> {
  return addAllowRule(context, toolName, risk);
}

/**
 * executePermissionApprove — 把 handleNaturalInput 的 yes 分支主体抽成
 * 函数。语义与原 yes 路径完全一致。**调用方负责清空 pendingLocalApproval**
 * （与原 inline 分支保持一致，避免双清空）。
 */
export async function executePermissionApprove(
  approval: PendingLocalApproval,
  context: TuiContext,
  gateway: ModelGateway | undefined,
  output: Writable,
): Promise<void> {
  await recordPermissionUserDecision(context, approval, "approved", "approve");
  if (approval.kind === "agent_tool_use") {
    const agent = context.agents.find((item) => item.id === approval.agentId);
    if (!agent) {
      const evidence = await recordToolFailureEvidence(
        context,
        approval.sessionId,
        approval.toolName,
        `agent approval target missing: ${approval.agentId}`,
      );
      await appendToolResultEvent(
        context,
        approval.sessionId,
        approval.toolCall.id,
        approval.toolName,
        `agent ${approval.agentId} is no longer available; ${approval.toolName} was not executed.`,
        true,
        evidence.id,
      );
      writeLine(output, `agent ${approval.agentId} 不存在，未执行 ${approval.toolName}。`);
      writeStatus(output, context);
      return;
    }
    const result = await executeApprovedAgentToolUse(
      agent,
      approval.toolCall,
      approval.toolName,
      context,
      approval.sessionId,
    );
    await appendToolResultEvent(
      context,
      approval.sessionId,
      approval.toolCall.id,
      approval.toolName,
      result.text,
      !result.ok,
      result.evidenceId,
    );
    writeLine(
      output,
      result.ok
        ? `agent ${agent.id} 已执行 ${approval.toolName}；子 agent 已继续处理，当前状态 ${agent.status}。可检查 /agents show ${agent.id}。`
        : `agent ${agent.id} 执行 ${approval.toolName} 失败：${truncateDisplay(result.text, 160)}`,
    );
    writeStatus(output, context);
    return;
  }
  if (approval.kind === "index_ignore_write") {
    const written = await executeIndexIgnoreWritePlan(approval.plan, context, output);
    if (written) {
      await runIndexRepairRefresh(context, output);
    }
    if (!context.isInkSession) writeStatus(output, context);
    return;
  }
  if (approval.kind === "architecture_drift") {
    const result = await executeApprovedModelToolUse(
      approval.toolCall,
      approval.toolName,
      context,
      approval.sessionId,
      output,
      undefined,
      approval.continuation?.reportWriteGuard,
    );
    await recordModelToolFailureForMetaScheduler(context, approval.sessionId, result);
    const reportWriteGuard = approval.continuation?.reportWriteGuard;
    if (doesWriteSatisfyReportGuard(reportWriteGuard, approval.toolCall, result)) {
      reportWriteGuard.completed = true;
    }
    if (gateway && approval.continuation) {
      await appendBudgetedToolResultToContinuation(
        context,
        approval.sessionId,
        approval.continuation.messages,
        approval.toolCall.id,
        result,
      );
      await continueModelAfterToolResults(approval.continuation, context, gateway, output);
    } else if (approval.continuation) {
      await appendApprovalContinuationWarning(
        context,
        approval.sessionId,
        approval.toolName,
        result.text,
      );
    }
    writeLightHints(output, context);
    writeStatus(output, context);
    return;
  }
  if (approval.kind === "model_tool_use") {
    const result = await executeApprovedModelToolUse(
      approval.toolCall,
      approval.toolName,
      context,
      approval.sessionId,
      output,
      approval.boundaryPreflight
        ? formatBoundaryEditPreflightPrompt(approval.boundaryPreflight, context.language)
        : undefined,
      approval.continuation?.reportWriteGuard,
    );
    const reportWriteGuard = approval.continuation?.reportWriteGuard;
    if (doesWriteSatisfyReportGuard(reportWriteGuard, approval.toolCall, result)) {
      reportWriteGuard.completed = true;
    }
    if (gateway && approval.continuation) {
      await appendBudgetedToolResultToContinuation(
        context,
        approval.sessionId,
        approval.continuation.messages,
        approval.toolCall.id,
        result,
      );
      await continueModelAfterToolResults(approval.continuation, context, gateway, output);
    } else if (approval.continuation) {
      await appendApprovalContinuationWarning(
        context,
        approval.sessionId,
        approval.toolName,
        result.text,
      );
    }
    writeLightHints(output, context);
    writeStatus(output, context);
    return;
  }
  if (approval.kind === "git_worktree_remove") {
    await resolveWorktreeRemoveApprove(
      approval,
      context,
      output,
      createWorktreeRemoveResolveDeps(gateway),
    );
    return;
  }
  if (approval.kind === "git_stable_point") {
    // D.14D-R2 P1-1 — 用户确认后真实创建稳定点，并把工具结果回灌模型续轮。
    await resolveStablePointApprove(
      approval,
      context,
      output,
      createWorktreeRemoveResolveDeps(gateway),
    );
    return;
  }
  if (approval.kind === "index_tool") {
    // D.14D-R P0-2 — 用户确认后真实刷新/修复索引，并把工具结果回灌模型续轮。
    const result = await executeApprovedIndexToolUse(
      approval.toolCall,
      approval.indexAction,
      approval.force,
      context,
      approval.sessionId,
      output,
    );
    if (gateway && approval.continuation) {
      await appendBudgetedToolResultToContinuation(
        context,
        approval.sessionId,
        approval.continuation.messages,
        approval.toolCall.id,
        result,
      );
      await continueModelAfterToolResults(approval.continuation, context, gateway, output);
    } else if (approval.continuation) {
      await appendApprovalContinuationWarning(
        context,
        approval.sessionId,
        approval.toolCall.name,
        result.text,
      );
    }
    if (!context.isInkSession) {
      writeLightHints(output, context);
      writeStatus(output, context);
    }
    return;
  }
  if (approval.kind === "report_write_tool") {
    const result = await executeApprovedModelToolUse(
      { ...approval.toolCall, name: "Write" },
      "Write",
      context,
      approval.sessionId,
      output,
      undefined,
      approval.continuation?.reportWriteGuard,
    );
    const reportWriteGuard = approval.continuation?.reportWriteGuard;
    if (doesWriteSatisfyReportGuard(reportWriteGuard, approval.toolCall, result)) {
      reportWriteGuard.completed = true;
    }
    if (gateway && approval.continuation) {
      await appendBudgetedToolResultToContinuation(
        context,
        approval.sessionId,
        approval.continuation.messages,
        approval.toolCall.id,
        result,
      );
      await continueModelAfterToolResults(approval.continuation, context, gateway, output);
    } else if (approval.continuation) {
      await appendApprovalContinuationWarning(
        context,
        approval.sessionId,
        WRITE_REPORT_TOOL_NAME,
        result.text,
      );
    }
    if (!context.isInkSession) {
      writeLightHints(output, context);
      writeStatus(output, context);
    }
    return;
  }
  if (approval.kind === "memory_mutation") {
    await executeMemoryMutation(context, output, approval.mutation);
    if (!context.isInkSession) writeStatus(output, context);
    return;
  }
  if (approval.kind === "break_cache_mutation") {
    await executeBreakCacheMutation(approval.action, context, output);
    if (!context.isInkSession) writeStatus(output, context);
    return;
  }
  if (approval.kind === "image_generation") {
    await executeImageGeneration(approval, context, output);
    if (!context.isInkSession) writeStatus(output, context);
    return;
  }
}

/**
 * executePermissionDeny — 把 handleNaturalInput 的 no 分支主体抽成函数。
 * 与原 no 路径行为一致；cancelled=true 写 "cancelled by user"，否则
 * "denied by user"。**调用方负责清空 pendingLocalApproval**。
 */
export async function executePermissionDeny(
  approval: PendingLocalApproval,
  context: TuiContext,
  gateway: ModelGateway | undefined,
  output: Writable,
  cancelled: boolean,
  decisionSource = cancelled ? "cancel" : "deny",
): Promise<void> {
  const sessionId = await ensureSession(context);
  const outcomeText = cancelled ? "permission cancelled by user" : "permission denied by user";
  await recordPermissionUserDecision(
    context,
    approval,
    cancelled ? "cancelled" : "denied",
    decisionSource,
  );
  if (approval.kind === "agent_tool_use") {
    const agent = context.agents.find((item) => item.id === approval.agentId);
    if (!agent) {
      const evidence = await recordToolFailureEvidence(
        context,
        approval.sessionId,
        approval.toolName,
        `agent approval target missing after deny: ${approval.agentId}`,
      );
      await appendToolResultEvent(
        context,
        approval.sessionId,
        approval.toolCall.id,
        approval.toolName,
        `agent ${approval.agentId} is no longer available; ${approval.toolName} was not executed.`,
        true,
        evidence.id,
      );
      writeLine(output, `agent ${approval.agentId} 不存在，未执行 ${approval.toolName}。`);
      writeStatus(output, context);
      return;
    }
    const result = await denyAgentToolUse(
      agent,
      approval.toolCall,
      approval.toolName,
      context,
      approval.sessionId,
      outcomeText,
    );
    await appendToolResultEvent(
      context,
      approval.sessionId,
      approval.toolCall.id,
      approval.toolName,
      result.text,
      true,
      result.evidenceId,
    );
    writeLine(output, `已拒绝 agent ${agent.id} 的 ${approval.toolName}；工具未执行。`);
    writeStatus(output, context);
    return;
  }
  if (approval.kind === "index_ignore_write") {
    await recordToolFailureEvidence(
      context,
      sessionId,
      "Write",
      `${outcomeText}: ${approval.plan.path}`,
    );
    writeLine(
      output,
      context.language === "en-US"
        ? "Permission denied. No file was written and the index was not refreshed."
        : "已拒绝权限。本轮未写入文件，也未刷新索引。",
    );
    writeStatus(output, context);
    return;
  }
  if (approval.kind === "architecture_drift") {
    const text =
      approval.toolName === "Write" ||
      approval.toolName === "Edit" ||
      approval.toolName === "MultiEdit"
        ? `${outcomeText}; ${approval.toolName} was NOT written / NOT created.`
        : outcomeText;
    const evidence = await recordToolFailureEvidence(
      context,
      approval.sessionId,
      approval.toolName,
      `${outcomeText}: architecture drift confirmation required`,
    );
    const deniedResult = {
      ok: false,
      tool: approval.toolName,
      text,
      outcome: cancelled ? "cancelled" : "denied",
      evidenceId: evidence.id,
      architectureDrift: approval.warnings,
    };
    await appendToolResultEvent(
      context,
      approval.sessionId,
      approval.toolCall.id,
      approval.toolName,
      deniedResult.text,
      true,
      evidence.id,
    );
    if (gateway && approval.continuation) {
      writeLine(output, formatPermissionDenialPrimary(context.language));
      if (
        approval.toolName === "Write" ||
        approval.toolName === "Edit" ||
        approval.toolName === "MultiEdit"
      ) {
        writeLine(output, `${approval.toolName} was NOT written / NOT created.`);
      }
      approval.continuation.messages.push({
        role: "tool",
        tool_call_id: approval.toolCall.id,
        content: JSON.stringify(deniedResult),
      });
      await continueModelAfterToolResults(approval.continuation, context, gateway, output);
      writeLightHints(output, context);
      writeStatus(output, context);
      return;
    }
    await appendDenialContinuationWarning(context, approval.sessionId, approval.toolName, deniedResult.text);
  }
  if (approval.kind === "model_tool_use") {
    const evidence = await recordToolFailureEvidence(
      context,
      approval.sessionId,
      approval.toolName,
      `${outcomeText}: ${approval.toolName}`,
    );
    const deniedResult = {
      ok: false,
      tool: approval.toolName,
      text:
        approval.toolName === "Write" ||
        approval.toolName === "Edit" ||
        approval.toolName === "MultiEdit"
          ? `${outcomeText}; ${approval.toolName} was NOT written / NOT created.`
          : outcomeText,
      outcome: cancelled ? "cancelled" : "denied",
      evidenceId: evidence.id,
    };
    await appendToolResultEvent(
      context,
      approval.sessionId,
      approval.toolCall.id,
      approval.toolName,
      deniedResult.text,
      true,
      evidence.id,
    );
    if (gateway && approval.continuation) {
      writeLine(output, formatPermissionDenialPrimary(context.language));
      if (
        approval.toolName === "Write" ||
        approval.toolName === "Edit" ||
        approval.toolName === "MultiEdit"
      ) {
        writeLine(output, `${approval.toolName} was NOT written / NOT created.`);
      }
      approval.continuation.messages.push({
        role: "tool",
        tool_call_id: approval.toolCall.id,
        content: JSON.stringify(deniedResult),
      });
      await continueModelAfterToolResults(approval.continuation, context, gateway, output);
      writeLightHints(output, context);
      writeStatus(output, context);
      return;
    }
    await appendDenialContinuationWarning(context, approval.sessionId, approval.toolName, deniedResult.text);
  }
  if (approval.kind === "git_worktree_remove") {
    await resolveWorktreeRemoveDeny(
      approval,
      context,
      output,
      cancelled,
      createWorktreeRemoveResolveDeps(gateway),
    );
    return;
  }
  if (approval.kind === "git_stable_point") {
    // D.14D-R2 P1-1 — 拒绝稳定点：不创建 commit/snapshot，回灌"NOT created"给模型。
    await resolveStablePointDeny(
      approval,
      context,
      output,
      cancelled,
      createWorktreeRemoveResolveDeps(gateway),
    );
    return;
  }
  if (approval.kind === "index_tool") {
    // D.14D-R P0-2 — 拒绝索引刷新/修复：记录失败，回灌"未执行"工具结果给模型，
    // 让 final answer 不会声称索引已刷新。
    const evidence = await recordToolFailureEvidence(
      context,
      approval.sessionId,
      "Write",
      `${outcomeText}: index ${approval.indexAction}`,
    );
    const deniedResult = {
      ok: false,
      tool: approval.toolCall.name,
      text: `${outcomeText}; the index was NOT refreshed.`,
      outcome: cancelled ? "cancelled" : "denied",
      evidenceId: evidence.id,
    };
    await appendDeferredToolResultEvent(
      context,
      approval.sessionId,
      approval.toolCall.id,
      approval.toolCall.name,
      deniedResult.text,
      true,
      evidence.id,
    );
    if (gateway && approval.continuation) {
      writeLine(output, formatPermissionDenialPrimary(context.language));
      approval.continuation.messages.push({
        role: "tool",
        tool_call_id: approval.toolCall.id,
        content: JSON.stringify(deniedResult),
      });
      await continueModelAfterToolResults(approval.continuation, context, gateway, output);
      writeLightHints(output, context);
      writeStatus(output, context);
      return;
    }
    await appendDenialContinuationWarning(context, approval.sessionId, approval.toolCall.name, deniedResult.text);
  }
  if (approval.kind === "report_write_tool") {
    const evidence = await recordToolFailureEvidence(
      context,
      approval.sessionId,
      "Write",
      `${outcomeText}: WriteReport`,
    );
    const deniedResult = {
      ok: false,
      tool: WRITE_REPORT_TOOL_NAME,
      text: `${outcomeText}; the report file was NOT written.`,
      outcome: cancelled ? "cancelled" : "denied",
      evidenceId: evidence.id,
    };
    await appendDeferredToolResultEvent(
      context,
      approval.sessionId,
      approval.toolCall.id,
      WRITE_REPORT_TOOL_NAME,
      deniedResult.text,
      true,
      evidence.id,
    );
    if (gateway && approval.continuation) {
      writeLine(output, formatPermissionDenialPrimary(context.language));
      approval.continuation.messages.push({
        role: "tool",
        tool_call_id: approval.toolCall.id,
        content: JSON.stringify(deniedResult),
      });
      await continueModelAfterToolResults(approval.continuation, context, gateway, output);
      writeLightHints(output, context);
      writeStatus(output, context);
      return;
    }
    await appendDenialContinuationWarning(context, approval.sessionId, WRITE_REPORT_TOOL_NAME, deniedResult.text);
  }
  if (approval.kind === "memory_mutation") {
    await recordToolFailureEvidence(
      context,
      approval.sessionId,
      "Write",
      `${outcomeText}: memory ${approval.mutation.action}`,
    );
    writeLine(
      output,
      context.language === "en-US"
        ? "Permission denied. No memory file was written or deleted."
        : "已拒绝权限。本轮未写入或删除记忆文件。",
    );
    writeStatus(output, context);
    return;
  }
  if (approval.kind === "break_cache_mutation") {
    await recordToolFailureEvidence(
      context,
      approval.sessionId,
      "Write",
      `${outcomeText}: break-cache ${approval.action}`,
    );
    writeLine(
      output,
      context.language === "en-US"
        ? "Permission denied. Break-cache marker was not changed."
        : "已拒绝权限。本轮未修改 break-cache marker。",
    );
    writeStatus(output, context);
    return;
  }
  if (approval.kind === "image_generation") {
    await recordToolFailureEvidence(
      context,
      approval.sessionId,
      "Write",
      `${outcomeText}: image generate ${approval.id}`,
    );
    writeLine(
      output,
      context.language === "en-US"
        ? "Permission denied. Image metadata was not written."
        : "已拒绝权限。本轮未写入 image metadata。",
    );
    writeStatus(output, context);
    return;
  }
  writeLine(output, formatPermissionDenialPrimary(context.language));
  writeStatus(output, context);
}

async function appendDenialContinuationWarning(
  context: TuiContext,
  sessionId: string,
  toolName: string,
  summary: string,
): Promise<void> {
  await appendSystemEvent(
    context,
    sessionId,
    `permission_continuation_terminal: outcome=denied_or_cancelled; tool=${toolName}; continuation=unavailable; model_resumed=no; summary=${truncateDisplay(summary, 200)}`,
    "warning",
  );
}

async function appendApprovalContinuationWarning(
  context: TuiContext,
  sessionId: string,
  toolName: string,
  summary: string,
): Promise<void> {
  await appendSystemEvent(
    context,
    sessionId,
    `permission_continuation_terminal: outcome=approved; tool=${toolName}; continuation=unavailable; model_resumed=no; summary=${truncateDisplay(summary, 200)}`,
    "warning",
  );
}

async function recordPermissionUserDecision(
  context: TuiContext,
  approval: PendingLocalApproval,
  decision: "approved" | "denied" | "cancelled",
  source: string,
): Promise<void> {
  const sessionId = await ensureSession(context);
  const toolName = permissionApprovalToolName(approval);
  const continuation =
    "continuation" in approval && approval.continuation ? "available" : "none";
  await appendSystemEvent(
    context,
    sessionId,
    `permission_user_decision: decision=${decision}; source=${source}; kind=${approval.kind}; tool=${toolName}; continuation=${continuation}`,
    decision === "approved" ? "info" : "warning",
  );
}

function permissionApprovalToolName(approval: PendingLocalApproval): string {
  if ("toolName" in approval) return approval.toolName;
  if ("toolCall" in approval && approval.toolCall) return approval.toolCall.name;
  if (approval.kind === "index_ignore_write") return "Write";
  if (approval.kind === "memory_mutation") return "Write";
  if (approval.kind === "break_cache_mutation") return "Write";
  if (approval.kind === "image_generation") return "Write";
  return approval.kind;
}

export async function handlePermissionsCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const [action, ...rest] = args;
  if (!action) {
    writeLine(output, formatPermissionRules(context.permissions));
    return;
  }
  if (action === "recent") {
    if (rest[0] === "clear") {
      context.permissions.recentDenied = [];
      await savePermissionState(context.projectPath, context.permissions);
      writeLine(output, "已清空最近拒绝记录。");
      return;
    }
    if (rest[0] === "delete" || rest[0] === "remove") {
      const id = rest[1];
      if (!id) {
        writeLine(output, "用法：/permissions recent delete <id>");
        return;
      }
      const before = context.permissions.recentDenied.length;
      context.permissions.recentDenied = context.permissions.recentDenied.filter(
        (item) => item.id !== id,
      );
      await savePermissionState(context.projectPath, context.permissions);
      writeLine(
        output,
        before === context.permissions.recentDenied.length
          ? `未找到最近拒绝：${id}`
          : `已删除最近拒绝：${id}`,
      );
      return;
    }
    // D.14E+ — /permissions recent 走 CommandPanel 避免刷屏：
    // 主屏显示总数+最近 5 条，完整列表进 detailsText。
    const denied = context.permissions.recentDenied;
    if (denied.length === 0) {
      writeLine(output, "最近没有拒绝记录。");
      return;
    }
    const recent = denied.slice(0, 5);
    const summaryLines = [
      `最近拒绝记录（共 ${denied.length} 条，显示最近 5 条）：`,
      ...recent.map((item) => `${item.createdAt}  ${item.toolName}  ${item.mode}  ${item.reason}`),
    ];
    if (denied.length > 5) {
      summaryLines.push(`... 另有 ${denied.length - 5} 条（完整列表见 details）`);
    }
    const detailsText = denied
      .map((item) => `${item.createdAt}  ${item.toolName}  ${item.mode}  ${item.reason}`)
      .join("\n");
    showCommandPanel(context, output, {
      title: "/permissions recent",
      tone: "neutral",
      summary: summaryLines,
      actions: ["/permissions recent clear", "/permissions recent delete <id>"],
      detailsText,
    });
    return;
  }
  if (action === "add") {
    const effect = rest[0] as PermissionRule["effect"] | undefined;
    const toolName = rest[1] as ToolName | "*" | undefined;
    const risk = rest[2] as PermissionRule["risk"] | undefined;
    if (!effect || !["allow", "ask", "deny"].includes(effect) || !toolName) {
      writeLine(output, "用法：/permissions add allow|ask|deny <tool|*> [low|medium|high]");
      return;
    }
    if (effect === "allow") {
      // D.13E Step 2 修正 #4：复用 addAllowRule helper（去重 + 失败回滚 + 审计文案）
      const result = await addAllowRule(context, toolName, risk);
      writeLine(output, result.message);
      return;
    }
    // ask / deny 仍走原 inline 逻辑（去重语义只对 allow 收紧）
    if (toolName !== "*" && !(toolName in builtInTools)) {
      writeLine(output, `未知工具：${toolName}`);
      return;
    }
    const rule: PermissionRule = { id: randomUUID(), effect, toolName, risk };
    context.permissions.rules.push(rule);
    await savePermissionState(context.projectPath, context.permissions);
    writeLine(output, `已添加权限规则：${rule.id} ${effect} ${toolName}${risk ? ` ${risk}` : ""}`);
    return;
  }
  if (action === "remove") {
    const id = rest[0];
    if (!id) {
      writeLine(output, "用法：/permissions remove <id>");
      return;
    }
    const before = context.permissions.rules.length;
    context.permissions.rules = context.permissions.rules.filter((rule) => rule.id !== id);
    await savePermissionState(context.projectPath, context.permissions);
    writeLine(
      output,
      before === context.permissions.rules.length ? `未找到规则：${id}` : `已删除规则：${id}`,
    );
    return;
  }
  writeLine(
    output,
    "用法：/permissions | /permissions add | /permissions remove | /permissions recent",
  );
}
