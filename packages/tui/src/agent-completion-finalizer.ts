import { randomUUID } from "node:crypto";
import { truncateDisplay } from "./startup-runtime.js";
import type { TuiContext } from "./tui-context-runtime.js";
import type {
  AgentCompletionBatchSummary,
  AgentCompletionNotice,
  AgentCompletionState,
  AgentCompletionStatus,
  AgentCompletionValidity,
  AgentRun,
  BackgroundTaskState,
} from "./tui-data-types.js";

export type AgentCompletionInput = {
  agent: AgentRun;
  task?: BackgroundTaskState;
  status: AgentCompletionStatus;
  summary: string;
  evidenceRefs?: string[];
  parentSessionId?: string;
  workflowRunId?: string;
  now?: string;
};

const MAX_AGENT_COMPLETION_NOTICES = 80;
const MAX_AGENT_COMPLETION_BATCHES = 24;
const MAX_REPORTED_NOTICE_IDS = 200;

export function createAgentCompletionState(): AgentCompletionState {
  return {
    notices: [],
    batchSummaries: [],
    lastNotificationAt: {},
    reportedNoticeIds: [],
  };
}

export function enqueueAgentCompletionNotice(
  context: TuiContext,
  input: AgentCompletionInput,
): AgentCompletionNotice {
  const state = ensureAgentCompletionState(context);
  const now = input.now ?? new Date().toISOString();
  const existing = state.notices.find((notice) => notice.agentId === input.agent.id);
  const notice: AgentCompletionNotice = {
    id: existing?.id ?? randomUUID(),
    agentId: input.agent.id,
    agentType: input.agent.type,
    agentRole: input.agent.role,
    ...(input.agent.displayName ? { displayName: input.agent.displayName } : {}),
    ...(input.agent.teamName ? { teamName: input.agent.teamName } : {}),
    ...((input.parentSessionId ?? input.agent.parentSessionId)
      ? { parentSessionId: input.parentSessionId ?? input.agent.parentSessionId }
      : {}),
    ...((input.workflowRunId ?? input.task?.workflowRunId)
      ? { workflowRunId: input.workflowRunId ?? input.task?.workflowRunId }
      : {}),
    task: input.agent.task,
    status: input.status,
    validity: classifyAgentCompletionValidity(input.status, input.evidenceRefs ?? []),
    summary: truncateDisplay(input.summary.replace(/\s+/g, " ").trim(), 220),
    evidenceRefs: Array.from(new Set(input.evidenceRefs ?? [])),
    nextAction: formatNoticeNextAction(context, input.status, input.agent.id),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    ...(existing?.reportedAt ? { reportedAt: existing.reportedAt } : {}),
  };

  if (existing) {
    Object.assign(existing, notice);
  } else {
    state.notices.unshift(notice);
  }
  state.notices = state.notices.slice(0, MAX_AGENT_COMPLETION_NOTICES);
  refreshAgentCompletionBatchSummaries(context, now);
  return notice;
}

export function collectPendingAgentCompletionNotices(context: TuiContext): AgentCompletionNotice[] {
  const state = ensureAgentCompletionState(context);
  const reported = new Set(state.reportedNoticeIds);
  return state.notices.filter((notice) => !notice.reportedAt && !reported.has(notice.id));
}

export function markAgentCompletionNoticeReported(
  context: TuiContext,
  noticeId: string,
  now: string = new Date().toISOString(),
): void {
  const state = ensureAgentCompletionState(context);
  const notice = state.notices.find((item) => item.id === noticeId);
  if (notice) notice.reportedAt = now;
  state.reportedNoticeIds = [
    noticeId,
    ...state.reportedNoticeIds.filter((id) => id !== noticeId),
  ].slice(0, MAX_REPORTED_NOTICE_IDS);
}

export function formatAgentCompletionDigest(context: TuiContext): string | null {
  const pending = collectPendingAgentCompletionNotices(context);
  if (pending.length === 0) return null;
  const state = ensureAgentCompletionState(context);
  const latestBatch = state.batchSummaries[0];
  const isEn = context.language === "en-US";
  const counts = summarizeNotices(pending);
  const lines = [
    isEn
      ? `Agent results returned: ${pending.length} pending notice(s).`
      : `智能体结果：${pending.length} 条待处理通知。`,
    isEn
      ? `Trust: ${counts.valid} valid, ${counts.partial} partial, ${counts.invalid} invalid; source evidence is tracked separately from verification.`
      : `可信度：${counts.valid} 个有效，${counts.partial} 个部分有效，${counts.invalid} 个无效；源码/执行证据与验证结论分开标记。`,
  ];
  if (latestBatch) {
    lines.push(isEn ? `Latest batch: ${latestBatch.summary}` : `最近批次：${latestBatch.summary}`);
  }
  for (const notice of pending.slice(0, 5)) {
    lines.push(
      `- ${formatAgentLabel(notice)}: ${notice.status}/${notice.validity}; ${notice.summary}`,
    );
  }
  if (pending.length > 5) {
    lines.push(
      isEn ? `- ...and ${pending.length - 5} more.` : `- ……另有 ${pending.length - 5} 条。`,
    );
  }
  lines.push(
    isEn
      ? "Next: inspect /agents or /background before claiming all work passed."
      : "下一步：查看 /agents 或 /background；不要把结果直接等同于全部通过。",
  );
  return lines.join("\n");
}

export function formatAgentCompletionMainChainContext(context: TuiContext): string | null {
  const pending = collectPendingAgentCompletionNotices(context);
  if (pending.length === 0) return null;
  const state = ensureAgentCompletionState(context);
  const latestBatch = state.batchSummaries[0];
  const isEn = context.language === "en-US";
  const lines = [
    isEn
      ? "AgentCompletionReturnsForMainChain=Child agent/workflow results returned to the main chain. Use them as structured context for your natural answer. Do not print this label or raw fields. Do not treat child-agent completion as final verification PASS unless evidence supports it."
      : "AgentCompletionReturnsForMainChain=子智能体/workflow 结果已回流主链。请把它作为结构化上下文，自然消化后回复用户；不要原样输出本标签或字段；不要把子智能体完成直接等同最终验证 PASS。",
  ];
  if (latestBatch) {
    lines.push(`batch=${latestBatch.summary}`);
  }
  for (const notice of pending.slice(0, 8)) {
    lines.push(
      JSON.stringify({
        noticeId: notice.id,
        agentId: notice.agentId,
        label: formatAgentLabel(notice),
        status: notice.status,
        validity: notice.validity,
        task: truncateDisplay(notice.task.replace(/\s+/g, " "), 120),
        summary: notice.summary,
        evidenceRefs: notice.evidenceRefs.slice(0, 8),
        nextAction: notice.nextAction,
      }),
    );
  }
  if (pending.length > 8) {
    lines.push(isEn ? `additional=${pending.length - 8}` : `另有=${pending.length - 8}`);
  }
  return lines.join("\n");
}

export function refreshAgentCompletionBatchSummaries(
  context: TuiContext,
  now: string = new Date().toISOString(),
): AgentCompletionBatchSummary[] {
  const state = ensureAgentCompletionState(context);
  const groups = new Map<string, AgentCompletionNotice[]>();
  for (const notice of state.notices) {
    const key = getNoticeScopeKey(notice);
    const group = groups.get(key) ?? [];
    group.push(notice);
    groups.set(key, group);
  }
  const batches = Array.from(groups.entries())
    .map(([scopeKey, notices]) => createBatchSummary(context, scopeKey, notices, now))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, MAX_AGENT_COMPLETION_BATCHES);
  state.batchSummaries = batches;
  return batches;
}

function ensureAgentCompletionState(context: TuiContext): AgentCompletionState {
  context.agentCompletions ??= createAgentCompletionState();
  return context.agentCompletions;
}

function classifyAgentCompletionValidity(
  status: AgentCompletionStatus,
  evidenceRefs: string[],
): AgentCompletionValidity {
  if (status === "completed") return evidenceRefs.length > 0 ? "valid" : "partial";
  if (status === "blocked" || status === "stale") return "partial";
  return "invalid";
}

function formatNoticeNextAction(
  context: TuiContext,
  status: AgentCompletionStatus,
  agentId: string,
): string {
  const isEn = context.language === "en-US";
  if (status === "completed") {
    return isEn ? `Review /agents show ${agentId}.` : `查看 /agents show ${agentId}。`;
  }
  if (status === "stale") {
    return isEn
      ? `Resume or cancel /agents show ${agentId}.`
      : `恢复或取消 /agents show ${agentId}。`;
  }
  return isEn
    ? `Inspect /agents show ${agentId} before retrying.`
    : `重试前查看 /agents show ${agentId}。`;
}

function createBatchSummary(
  context: TuiContext,
  scopeKey: string,
  notices: AgentCompletionNotice[],
  now: string,
): AgentCompletionBatchSummary {
  const counts = summarizeNotices(notices);
  const first = notices[0];
  const evidenceRefs = Array.from(new Set(notices.flatMap((notice) => notice.evidenceRefs))).slice(
    0,
    20,
  );
  return {
    id: `batch:${scopeKey}`,
    scopeKey,
    ...(first?.teamName ? { teamName: first.teamName } : {}),
    ...(first?.parentSessionId ? { parentSessionId: first.parentSessionId } : {}),
    ...(first?.workflowRunId ? { workflowRunId: first.workflowRunId } : {}),
    total: notices.length,
    valid: counts.valid,
    partial: counts.partial,
    invalid: counts.invalid,
    completed: counts.completed,
    failed: counts.failed,
    blocked: counts.blocked,
    stale: counts.stale,
    cancelled: counts.cancelled,
    evidenceRefs,
    summary: formatBatchSummaryText(context, counts, evidenceRefs.length),
    createdAt: now,
  };
}

function summarizeNotices(notices: AgentCompletionNotice[]): Record<string, number> {
  const counts = {
    valid: 0,
    partial: 0,
    invalid: 0,
    completed: 0,
    failed: 0,
    blocked: 0,
    stale: 0,
    cancelled: 0,
  };
  for (const notice of notices) {
    counts[notice.validity] += 1;
    counts[notice.status] += 1;
  }
  return counts;
}

function formatBatchSummaryText(
  context: TuiContext,
  counts: Record<string, number>,
  evidenceCount: number,
): string {
  if (context.language === "en-US") {
    return `${counts.completed} completed, ${counts.blocked} blocked, ${counts.failed} failed, ${counts.stale} stale, ${counts.cancelled} cancelled; ${evidenceCount} evidence ref(s).`;
  }
  return `${counts.completed} 个完成，${counts.blocked} 个阻塞，${counts.failed} 个失败，${counts.stale} 个 stale，${counts.cancelled} 个取消；${evidenceCount} 条证据引用。`;
}

function getNoticeScopeKey(notice: AgentCompletionNotice): string {
  return notice.workflowRunId
    ? `workflow:${notice.workflowRunId}`
    : notice.teamName
      ? `team:${notice.teamName}`
      : notice.parentSessionId
        ? `session:${notice.parentSessionId}`
        : `agent:${notice.agentId}`;
}

function formatAgentLabel(notice: AgentCompletionNotice): string {
  return notice.displayName ?? notice.agentType ?? notice.agentId;
}

export type AppendAgentCompletionEventInput = {
  agentId: string;
  label: string;
  status: AgentCompletionStatus;
  summary: string;
  targetSession: string;
  fallbackSession?: string;
};

export async function appendAgentCompletionSystemEvent(
  context: TuiContext,
  input: AppendAgentCompletionEventInput,
): Promise<{ written: boolean; fallbackWarning?: string }> {
  const level = input.status === "failed" || input.status === "cancelled" ? "warning" : "info";
  const message = `agent_completion:${input.agentId}; status=${input.status}; label=${input.label}; summary=${truncateDisplay(input.summary, 120)}`;
  try {
    await context.store.appendEvent(input.targetSession, {
      type: "system_event",
      id: randomUUID(),
      level,
      message,
      createdAt: new Date().toISOString(),
    });
    return { written: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const fallbackMessage = `agent_completion_write_failed:${input.agentId}; target=${input.targetSession}; error=${truncateDisplay(reason, 100)}`;
    const fallbackTarget = input.fallbackSession ?? input.targetSession;
    context.store.appendEvent(fallbackTarget, {
      type: "system_event",
      id: randomUUID(),
      level: "warning",
      message: fallbackMessage,
      createdAt: new Date().toISOString(),
    }).catch(() => {});
    return { written: false, fallbackWarning: fallbackMessage };
  }
}
