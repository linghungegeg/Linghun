import type {
  WorkflowAgentRuntimeBridgeResult,
  WorkflowBridgeRequestProposal,
  WorkflowBridgeRequestStatus,
} from "./workflow-agent-runtime-bridge.js";
import type {
  NormalizedWorkflowPlan,
  WorkflowEvidenceKind,
  WorkflowPlanProjection,
} from "./workflow-plan-schema.js";

export type EvidenceMergeVerdict = "PASS" | "PARTIAL" | "BLOCKED";

export type EvidenceMergeRow = {
  ref: string;
  kind: WorkflowEvidenceKind;
  claim: string;
  passEvidenceAllowed: boolean;
  verdict: EvidenceMergeVerdict;
  reason: string;
};

export type CacheBudgetHint = {
  budgetSet: boolean;
  multiAgentPressure: boolean;
  cacheFreshnessRef: string | null;
};

export type WorkflowTaskSurfaceResult = {
  summaryText: string;
  detailsText: string;
  mobileSummary: string;
  evidenceMergeRows: EvidenceMergeRow[];
  evidenceMergeSummary: EvidenceMergeVerdict;
  meta: {
    currentPhase: string;
    slicesDone: number;
    slicesRunning: number;
    slicesBlocked: number;
    slicesQueued: number;
    evidenceCount: number;
    tokenEstimate: string;
    costEstimate: string;
    durationEstimate: string;
    nextAction: string;
    cacheBudgetHint: CacheBudgetHint;
    riskHintCount: number;
  };
};

const PASS_ELIGIBLE_KINDS = new Set<WorkflowEvidenceKind>([
  "file_read",
  "grep_result",
  "index_query",
  "command_output",
  "test_result",
  "verification",
  "provider",
  "architecture",
]);

const PASS_BANNED_KINDS = new Set<WorkflowEvidenceKind>([
  "agent_summary",
  "job_completed",
  "remote_event",
  "failure_learning",
]);

export function projectWorkflowTaskSurface(
  plan: NormalizedWorkflowPlan,
  bridgeResult: WorkflowAgentRuntimeBridgeResult,
  language: "zh-CN" | "en-US" = "en-US",
): WorkflowTaskSurfaceResult {
  const currentPhase =
    plan.phases.find((p) => p.id === bridgeResult.currentPhaseId) ?? plan.phases[0];
  const allSlices = plan.phases.flatMap((p) => p.slices);
  const done = allSlices.filter((s) => s.status === "completed").length;
  const running = allSlices.filter((s) => s.status === "running").length;
  const blocked = allSlices.filter((s) => s.status === "blocked" || s.status === "failed").length;
  const queued = allSlices.filter(
    (s) => s.status === "queued" || s.status === "created" || s.status === "sleeping",
  ).length;

  const evidenceRefs = deduplicateEvidenceRefs(
    bridgeResult.requests.flatMap((r) => r.handoffProposal.evidenceRefs),
  );
  const evidenceCount = evidenceRefs.length;

  const evidenceMergeRows = buildEvidenceMergeRows(evidenceRefs);
  const evidenceMergeSummary = computeOverallVerdict(evidenceMergeRows, bridgeResult.summary);

  const tokenEst = sumTokenEstimates(bridgeResult.requests);
  const costEst = plan.budget.maxCostCny;
  const durationEst = sumDurationEstimates(bridgeResult.requests);

  const nextAction = deriveNextAction(bridgeResult, currentPhase?.stopPoint.reason, language);

  const riskHintCount = evidenceRefs.filter((ev) => ev.kind === "failure_learning").length;
  const failureLearningRefs = evidenceRefs.filter((ev) => ev.kind === "failure_learning");

  const budgetSet = plan.budget.maxCostCny !== undefined || plan.budget.maxTokens !== undefined;
  const multiAgentPressure = allSlices.length > 2;
  const cacheFreshnessRef =
    (plan.references ?? []).find((r) => r.ref === "cache-freshness-hint")?.ref ?? null;
  const cacheBudgetHint: CacheBudgetHint = { budgetSet, multiAgentPressure, cacheFreshnessRef };

  const meta: WorkflowTaskSurfaceResult["meta"] = {
    currentPhase: currentPhase?.title ?? "unknown",
    slicesDone: done,
    slicesRunning: running,
    slicesBlocked: blocked,
    slicesQueued: queued,
    evidenceCount,
    tokenEstimate: tokenEst ? `<=${tokenEst}` : "unset",
    costEstimate: costEst ? `<=${costEst} CNY` : "unset",
    durationEstimate: durationEst ? `<=${durationEst}ms` : "unset",
    nextAction,
    cacheBudgetHint,
    riskHintCount,
  };

  const summaryText = buildSummaryText(
    plan.title,
    meta,
    evidenceMergeSummary,
    bridgeResult.summary,
    language,
  );
  const detailsText = buildDetailsText(
    plan.title,
    plan.references ?? [],
    bridgeResult,
    evidenceMergeRows,
    failureLearningRefs,
  );
  const mobileSummary = buildMobileSummary(
    plan.title,
    meta,
    evidenceMergeSummary,
    bridgeResult.summary,
    riskHintCount,
    language,
  );

  return {
    summaryText,
    detailsText,
    mobileSummary,
    evidenceMergeRows,
    evidenceMergeSummary,
    meta,
  };
}

function buildEvidenceMergeRows(
  evidenceRefs: Array<{
    ref: string;
    kind: WorkflowEvidenceKind;
    claim: string;
    passEvidenceAllowed: boolean;
  }>,
): EvidenceMergeRow[] {
  return evidenceRefs.map((ev) => {
    if (PASS_BANNED_KINDS.has(ev.kind)) {
      return {
        ...ev,
        verdict: "PARTIAL" as const,
        reason: `${ev.kind} is context/status only, never PASS`,
      };
    }
    if (!ev.passEvidenceAllowed) {
      return {
        ...ev,
        verdict: "PARTIAL" as const,
        reason: "passEvidenceAllowed is false",
      };
    }
    if (PASS_ELIGIBLE_KINDS.has(ev.kind)) {
      return {
        ...ev,
        verdict: "PASS" as const,
        reason: "eligible evidence kind with passEvidenceAllowed=true",
      };
    }
    return {
      ...ev,
      verdict: "PARTIAL" as const,
      reason: `evidence kind ${ev.kind} not in PASS-eligible set`,
    };
  });
}

function computeOverallVerdict(
  rows: EvidenceMergeRow[],
  requestSummary: WorkflowAgentRuntimeBridgeResult["summary"],
): EvidenceMergeVerdict {
  if (rows.length === 0) return "BLOCKED";
  const hasBlocked = rows.some((r) => r.verdict === "BLOCKED");
  if (hasBlocked) return "BLOCKED";
  if (requestSummary.blocked > 0) return "BLOCKED";
  const hasPendingRequests =
    requestSummary.startGateNeeded > 0 ||
    requestSummary.queued > 0 ||
    requestSummary.runnable > 0 ||
    requestSummary.statusOnly > 0;
  if (hasPendingRequests) return "PARTIAL";
  const allPass = rows.every((r) => r.verdict === "PASS");
  return allPass ? "PASS" : "PARTIAL";
}

function deduplicateEvidenceRefs(
  refs: Array<{
    ref: string;
    kind: WorkflowEvidenceKind;
    claim: string;
    passEvidenceAllowed: boolean;
  }>,
): Array<{ ref: string; kind: WorkflowEvidenceKind; claim: string; passEvidenceAllowed: boolean }> {
  const seen = new Set<string>();
  const result: typeof refs = [];
  for (const item of refs) {
    const key = `${item.ref}\0${item.kind}\0${item.claim}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function sumTokenEstimates(requests: WorkflowBridgeRequestProposal[]): number | undefined {
  let total = 0;
  let hasAny = false;
  for (const r of requests) {
    if (r.taskSurfaceInput.tokenEstimate) {
      total += r.taskSurfaceInput.tokenEstimate;
      hasAny = true;
    }
  }
  return hasAny ? total : undefined;
}

function sumDurationEstimates(requests: WorkflowBridgeRequestProposal[]): number | undefined {
  let max = 0;
  let hasAny = false;
  for (const r of requests) {
    if (r.taskSurfaceInput.durationEstimateMs) {
      max = Math.max(max, r.taskSurfaceInput.durationEstimateMs);
      hasAny = true;
    }
  }
  return hasAny ? max : undefined;
}

function deriveNextAction(
  bridgeResult: WorkflowAgentRuntimeBridgeResult,
  phaseStopReason: string | undefined,
  language: "zh-CN" | "en-US",
): string {
  const isZh = language === "zh-CN";
  if (bridgeResult.summary.blocked > 0) {
    return isZh ? "先处理受阻任务，再继续推进。" : "Resolve blocked slices before proceeding.";
  }
  if (bridgeResult.summary.startGateNeeded > 0) {
    return isZh
      ? "确认阶段检查点后再开始执行。"
      : (phaseStopReason ?? "Confirm phase stop point before execution.");
  }
  if (bridgeResult.summary.runnable > 0) {
    return isZh
      ? "已有可执行提案，交给主流程继续处理。"
      : "Runnable proposals ready; hand to main-chain dispatcher.";
  }
  if (bridgeResult.summary.queued > 0) {
    return isZh ? "部分任务在排队等待执行窗口。" : "Queued slices waiting for running slots.";
  }
  return isZh
    ? "先检查工作流计划，再决定是否执行。"
    : (phaseStopReason ?? "Review workflow plan before execution.");
}

function buildSummaryText(
  title: string,
  meta: WorkflowTaskSurfaceResult["meta"],
  evidenceVerdict: EvidenceMergeVerdict,
  summary: WorkflowAgentRuntimeBridgeResult["summary"],
  language: "zh-CN" | "en-US",
): string {
  const isZh = language === "zh-CN";
  const status =
    meta.slicesBlocked > 0 || evidenceVerdict === "BLOCKED"
      ? isZh
        ? "需要关注"
        : "Needs attention"
      : meta.slicesRunning > 0 || summary.queued > 0 || summary.runnable > 0
        ? isZh
          ? "推进中"
          : "In progress"
        : isZh
          ? "可审核"
          : "Ready for review";
  const impact = [
    isZh ? `已完成 ${meta.slicesDone}` : `${meta.slicesDone} done`,
    isZh ? `运行中 ${meta.slicesRunning}` : `${meta.slicesRunning} running`,
    isZh ? `受阻 ${meta.slicesBlocked}` : `${meta.slicesBlocked} blocked`,
  ].join(", ");
  const waiting =
    summary.startGateNeeded > 0
      ? isZh
        ? "需要用户确认"
        : "user confirmation needed"
      : summary.queued > 0
        ? isZh
          ? "有任务正在等待"
          : "some work is waiting"
        : isZh
          ? "无需额外确认"
          : "no confirmation needed";
  if (isZh) {
    return [
      `结果：${title} 当前${status}。`,
      `影响：${meta.currentPhase}；${impact}；${waiting}。`,
      `下一步：${meta.nextAction}`,
    ].join("\n");
  }
  return [
    `Result: ${title} is ${status.toLowerCase()}.`,
    `Impact: ${meta.currentPhase}; ${impact}; ${waiting}.`,
    `Next: ${meta.nextAction}`,
  ].join("\n");
}

function buildDetailsText(
  title: string,
  references: NonNullable<NormalizedWorkflowPlan["references"]>,
  bridgeResult: WorkflowAgentRuntimeBridgeResult,
  evidenceRows: EvidenceMergeRow[],
  failureLearningRefs: Array<{ ref: string; kind: WorkflowEvidenceKind; claim: string }>,
): string {
  const header = `Workflow Task Surface details: ${title}`;
  const requestLines = bridgeResult.requests.map((r) => formatRequestRow(r));
  const referenceLines = references.map(
    (ref) => `  reference: ${ref.ref} | ${ref.kind} | ${ref.summary}`,
  );
  const evidenceLines = evidenceRows.map(
    (row) => `  evidence: ${row.ref} | ${row.kind} | ${row.verdict} | ${row.reason}`,
  );
  const riskHintLines =
    failureLearningRefs.length > 0
      ? ["", "Risk Hints:", ...failureLearningRefs.map((r) => `  risk: ${r.ref} | ${r.claim}`)]
      : [];
  return [
    header,
    "",
    "Requests:",
    "  phase | slice | role | status | permission | evidence | nextAction",
    ...requestLines,
    ...(referenceLines.length > 0 ? ["", "References:", ...referenceLines] : []),
    "",
    "Evidence Merge:",
    ...evidenceLines,
    ...riskHintLines,
  ].join("\n");
}

function formatRequestRow(r: WorkflowBridgeRequestProposal): string {
  const phase = r.phaseId;
  const slice = r.sliceId;
  const status = r.status;
  const permission = r.safety.requiredPermissionAction;
  const evidenceRefs = r.taskSurfaceInput.evidenceRefs.join(",") || "none";
  const nextAction = r.taskSurfaceInput.nextAction;
  const role = inferRoleFromRequest(r);
  return `  ${phase} | ${slice} | ${role} | ${status} | ${permission} | ${evidenceRefs} | ${nextAction}`;
}

function inferRoleFromRequest(r: WorkflowBridgeRequestProposal): string {
  if (r.request?.mainChain === "fork") return r.request.role;
  return r.backgroundProjection.kind;
}

function buildMobileSummary(
  title: string,
  meta: WorkflowTaskSurfaceResult["meta"],
  evidenceVerdict: EvidenceMergeVerdict,
  summary: WorkflowAgentRuntimeBridgeResult["summary"],
  riskHintCount: number,
  language: "zh-CN" | "en-US",
): string {
  if (language === "zh-CN") {
    const lines = [
      `工作流：${title}`,
      `阶段：${meta.currentPhase}`,
      `切片：已完成=${meta.slicesDone} 运行中=${meta.slicesRunning} 受阻=${meta.slicesBlocked} 排队=${meta.slicesQueued}`,
      `需要确认：${summary.startGateNeeded > 0 ? "是" : "否"}`,
      `证据：${meta.evidenceCount}（${evidenceVerdict}）`,
      `下一步：${meta.nextAction}`,
    ];
    if (riskHintCount > 0) {
      lines.push(`风险提示：${riskHintCount}`);
    }
    return sanitizeMobileSummary(lines.join("\n"));
  }
  const lines = [
    `Workflow: ${title}`,
    `Phase: ${meta.currentPhase}`,
    `Slices: done ${meta.slicesDone} running ${meta.slicesRunning} blocked ${meta.slicesBlocked} queued ${meta.slicesQueued}`,
    `Approval needed: ${summary.startGateNeeded > 0 ? "yes" : "no"}`,
    `Evidence: ${meta.evidenceCount} (${evidenceVerdict})`,
    `Next: ${meta.nextAction}`,
  ];
  if (riskHintCount > 0) {
    lines.push(`Risk hints: ${riskHintCount}`);
  }
  const raw = lines.join("\n");
  return sanitizeMobileSummary(raw);
}

function sanitizeMobileSummary(value: string): string {
  return value
    .replace(/[A-Za-z]:\\[^\s]+/gu, "[local-path]")
    .replace(/\/(?:Users|home|var|tmp|private|mnt)\/[^\s]+/gu, "[local-path]")
    .replace(/sk-[A-Za-z0-9_-]{8,}/gu, "[masked-key]")
    .replace(/(api[_-]?key\s*[=:]\s*)\S+/giu, "$1[masked-key]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/giu, "Bearer [masked-key]")
    .replace(
      /\b(?:full transcript|raw transcript|full source|raw source|full log|raw log)\b/giu,
      "[redacted-detail]",
    )
    .slice(0, 800);
}
