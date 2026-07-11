import type { TranscriptEvent } from "@linghun/core";
import type { Language } from "@linghun/shared";
import { detectArchitectureDrift } from "./architecture-runtime.js";
import {
  hasStructuredArtifactEvidenceForPath,
  readEvidenceDataRecord,
} from "./artifact-evidence-runtime.js";
import { evidenceMatchesRequestOwner } from "./evidence-runtime.js";
import type { TuiContext } from "./index.js";
import {
  evaluateArchitectureAndCompletenessClaims,
  evaluateFinalAnswerClaims,
  extractStructuredFinalAnswerClaims,
  finalAnswerHasCompletenessClassification,
  hasArchitectureEvidenceForClaims,
  type FinalAnswerClaimVerdict,
} from "./model-loop-runtime.js";
import type { EvidenceRecord, VerdictEvidenceScope } from "./tui-data-types.js";

export function needsSolutionCompletenessReportClosure(
  context: TuiContext,
  assistantText: string,
): boolean {
  if (!context.solutionCompleteness.classificationRequired) {
    return false;
  }
  return !/single_issue|systemic_gap/u.test(assistantText);
}

// D.13V-B：在 final answer push 之前对 architecture / completeness 做一次额外 gate。
// 与 D.13U evaluateFinalAnswerClaims 平行，不重写它。共享 finalAnswerClaimRetried 一次重试预算。
export function runArchitectureAndCompletenessFinalGate(
  context: TuiContext,
  assistantText: string,
  evidence: EvidenceRecord[] = context.evidence,
):
  | {
      status: "passed";
    }
  | {
      status: "needs_disclaimer";
      verdict: ReturnType<typeof evaluateArchitectureAndCompletenessClaims>;
    } {
  if (!assistantText) {
    return { status: "passed" };
  }
  const card = context.currentArchitectureCard;
  let driftWarnings: string[] = [];
  if (card) {
    // 用 final answer 文本作为 nextAction.summary，复用 detectArchitectureDrift 的
    // treatsUnknownOrStaleAsFact / violatesNonGoals 检查。toolName 留空，避免触发
    // dependency/file scope 误报；本 gate 只关心"事实层面是否被声明为已闭合"。
    const drift = detectArchitectureDrift(card, { summary: assistantText });
    driftWarnings = drift.warnings;
  }
  const verdict = evaluateArchitectureAndCompletenessClaims(
    assistantText,
    {
      hasActiveCard: Boolean(card),
      driftWarnings,
      hasArchitectureEvidence: hasArchitectureEvidenceForClaims(evidence),
    },
    {
      classificationRequired: context.solutionCompleteness.classificationRequired,
      classification: context.solutionCompleteness.classification,
      textHasClassification: finalAnswerHasCompletenessClassification(assistantText),
    },
  );
  if (verdict.status === "needs_disclaimer") {
    return { status: "needs_disclaimer", verdict };
  }
  return { status: "passed" };
}

export function formatSolutionCompletenessReportBlock(context: TuiContext): string {
  const status = context.solutionCompleteness;
  const classification =
    status.classification === "unknown" ? "systemic_gap" : status.classification;
  const impact = status.impactAreas.length > 0 ? status.impactAreas.join(", ") : "unknown";
  const severity = status.severity === "unknown" ? "blocking_P1" : status.severity;
  return [
    "Solution Completeness Gate report",
    `- classification: ${classification}`,
    `- impactAreas: ${impact}`,
    `- severity: ${severity}`,
    "- phaseBoundary: stay in the current approved scope; do not enter Beta or later roadmap stages automatically.",
    "- validation: list focused tests/check/typecheck/build/diff-check before claiming closure.",
  ].join("\n");
}

export type ClaimCheck = {
  status: "passed" | "needs_disclaimer" | "blocked";
  unsupportedClaims: string[];
  missingEvidenceKinds?: string[];
  verdict?: VerdictEvidenceScope;
};

export function createHandoffPendingItems(evidence: EvidenceRecord[]): string[] {
  return createPhase15BetaVerdictScope(evidence).uncoveredItems;
}

export function createHandoffRiskItems(evidence: EvidenceRecord[]): string[] {
  return createPhase15BetaVerdictScope(evidence).residualRisks;
}

export function createPhase15BetaVerdictScope(
  evidence: EvidenceRecord[] = [],
  transcript: TranscriptEvent[] = [],
): VerdictEvidenceScope {
  const requiredEvidence = [
    {
      key: "real-tui-report-generation",
      missing: "real TUI report-generation path lacks PASS evidence",
      present: hasEvidenceClaim(
        evidence,
        /real[-\s]?tui.*report.*pass|report[-\s]?generation.*pass/iu,
      ),
    },
    {
      key: "deepseek-dual-provider-pass",
      missing: "DeepSeek dual-provider live report evidence is missing",
      present: hasEvidenceClaim(evidence, /deepseek.*(?:gate\s*f|dual[-\s]?provider).*pass/iu),
    },
    {
      key: "openai-compatible-dual-provider-pass",
      missing: "OpenAI-compatible dual-provider live report evidence is missing",
      present: hasEvidenceClaim(
        evidence,
        /openai[-\s]?compatible.*(?:gate\s*f|dual[-\s]?provider).*pass/iu,
      ),
    },
    {
      key: "write-evidence",
      missing: "report Write evidence is missing",
      present: hasReportWriteEvidence(evidence),
    },
    {
      key: "final-answer-report-reference",
      missing: "final answer does not reference the generated report",
      present: hasFinalAnswerReportReference(evidence, transcript),
    },
  ];
  const hasBlockingGate = hasBlockingGateEvidence(evidence, transcript);
  const uncoveredItems = requiredEvidence
    .filter((item) => !item.present)
    .map((item) => item.missing);
  const residualRisks: string[] = [];
  if (uncoveredItems.length > 0) {
    residualRisks.push(
      "live provider basic text PASS is not live provider tool/report PASS",
      "mock provider PASS and focused test PASS cannot prove Beta readiness",
    );
  }
  if (hasBlockingGate) {
    uncoveredItems.push("blocking gate evidence still contains SKIPPED, PARTIAL, or BLOCKED");
    residualRisks.push("blocking gate is not fully closed");
  }
  return {
    scope: "beta",
    status: uncoveredItems.length === 0 ? "PASS" : "PARTIAL",
    evidenceRefs: evidence.filter((item) => isBetaVerdictEvidence(item)).map((item) => item.id),
    validationCommands: [
      "corepack pnpm test -- --run packages/tui/src/index.test.ts packages/tui/src/natural-command-bridge.test.ts",
      "corepack pnpm test",
      "corepack pnpm check",
      "corepack pnpm typecheck",
      "corepack pnpm build",
      "git diff --check",
    ],
    uncoveredItems,
    residualRisks,
    nextAction:
      uncoveredItems.length === 0
        ? "All required Beta readiness evidence is present. User confirmation is still required before Beta."
        : "Fix or re-smoke the real provider + real TUI report-generation path before declaring Beta readiness.",
  };
}

function hasEvidenceClaim(evidence: EvidenceRecord[], pattern: RegExp): boolean {
  return evidence.some((item) =>
    pattern.test([item.summary, item.source, ...item.supportsClaims].join(" ")),
  );
}

function hasReportWriteEvidence(evidence: EvidenceRecord[]): boolean {
  return evidence.some(
    (item) =>
      item.kind === "command_output" &&
      (item.source === "Write" || item.supportsClaims.includes("Write")) &&
      /report|报告|\.md\b/iu.test([item.summary, item.source, ...item.supportsClaims].join(" ")),
  );
}

function hasFinalAnswerReportReference(
  evidence: EvidenceRecord[],
  transcript: TranscriptEvent[],
): boolean {
  if (hasEvidenceClaim(evidence, /final answer.*report|最终回答.*报告|reference.*report/iu)) {
    return true;
  }
  return [...transcript]
    .reverse()
    .some(
      (event) =>
        event.type === "assistant_text_delta" &&
        /(?:report[\w./\\-]*\.md|报告文件|生成的报告|saved report)/iu.test(event.text),
    );
}

function hasBlockingGateEvidence(
  evidence: EvidenceRecord[],
  transcript: TranscriptEvent[],
): boolean {
  const blockingStatusPattern =
    /(?:blocking|阻塞|gate|闸门).{0,80}(?:SKIPPED|PARTIAL|BLOCKED|跳过|部分|阻塞)|(?:SKIPPED|PARTIAL|BLOCKED).{0,80}(?:blocking|阻塞|gate|闸门)/iu;
  if (hasEvidenceClaim(evidence, blockingStatusPattern)) {
    return true;
  }
  return transcript.some((event) => {
    if (event.type === "verification_end") {
      return (
        event.report.status === "partial" ||
        event.report.commands.some(
          (command) => command.status === "partial" || command.status === "skipped",
        )
      );
    }
    if (event.type === "system_event" || event.type === "assistant_text_delta") {
      const text = event.type === "system_event" ? event.message : event.text;
      return blockingStatusPattern.test(text);
    }
    return false;
  });
}

function isBetaVerdictEvidence(item: EvidenceRecord): boolean {
  return (
    /real[-\s]?tui.*report.*pass|report[-\s]?generation.*pass|deepseek.*(?:gate\s*f|dual[-\s]?provider).*pass|openai[-\s]?compatible.*(?:gate\s*f|dual[-\s]?provider).*pass|final answer.*report|最终回答.*报告/iu.test(
      [item.summary, item.source, ...item.supportsClaims].join(" "),
    ) || hasReportWriteEvidence([item])
  );
}

export function checkClaimSupport(claim: string, context: TuiContext): ClaimCheck {
  const headlessDiagnosticsCheck = checkHeadlessRecentDiagnostics(context);
  if (headlessDiagnosticsCheck.status !== "passed") {
    return headlessDiagnosticsCheck;
  }

  // D.13U：只接受模型声明的结构化 claim 契约；不再维护自然语言短语表。
  const structuredClaims = extractStructuredFinalAnswerClaims(claim);
  if (structuredClaims.some((item) => item.kind === "beta_readiness")) {
    return {
      status: "needs_disclaimer",
      unsupportedClaims: [
        ...structuredClaims
          .filter((item) => item.kind === "beta_readiness")
          .map((item) => item.phrase),
      ],
      verdict: createPhase15BetaVerdictScope(context.evidence),
    };
  }

  if (structuredClaims.length === 0) {
    // D.14H Phase 7.5-C：纯自然语言高风险 claim 兜底识别。
    // 无结构化 claim 时，对"测试通过 / PASS / 已完成"等无证据高风险表述
    // 做最小匹配；普通低风险文本不误伤。
    const nlCheck = detectNaturalLanguageHighRiskClaims(claim);
    if (nlCheck.status !== "passed") {
      return nlCheck;
    }
    return { status: "passed", unsupportedClaims: [] };
  }
  if (
    structuredClaims.some(
      (item) => item.kind === "architecture_boundary" || item.kind === "completeness",
    )
  ) {
    const extended = runArchitectureAndCompletenessFinalGate(
      context,
      claim,
      context.currentRequestTurnId
        ? context.evidence.filter((record) => evidenceMatchesRequestOwner(record, context))
        : context.evidence,
    );
    if (extended.status === "needs_disclaimer") {
      return {
        status: "needs_disclaimer",
        unsupportedClaims: [
          ...extended.verdict.matchedClaims.map((item) => item.phrase),
        ],
      };
    }
  }
  const verdict = evaluateFinalAnswerClaims(
    claim,
    context.currentRequestTurnId
      ? context.evidence.filter((record) => evidenceMatchesRequestOwner(record, context))
      : context.evidence,
  );
  if (verdict.status === "passed") {
    return { status: "passed", unsupportedClaims: [] };
  }
  return {
    status: "needs_disclaimer",
    unsupportedClaims: formatUnsupportedStructuredClaims(verdict),
    missingEvidenceKinds: verdict.missingEvidenceKinds,
  };
}

function formatUnsupportedStructuredClaims(verdict: FinalAnswerClaimVerdict): string[] {
  if (verdict.missingEvidenceByClaim.length === 0) {
    return verdict.matchedClaims.map((item) => item.phrase);
  }
  return verdict.missingEvidenceByClaim.map(
    (item) => `${item.phrase} (missing: ${item.missingEvidenceKind})`,
  );
}

function checkHeadlessRecentDiagnostics(context: TuiContext): ClaimCheck {
  const tools = context.tools as TuiContext["tools"] & {
    headlessBench?: { enabled?: boolean };
  };
  if (!tools.headlessBench?.enabled) {
    return { status: "passed", unsupportedClaims: [] };
  }
  const unresolved = (tools.recentDiagnostics ?? []).filter(
    (diagnostic) => !hasStructuredEvidenceForDiagnostic(context, diagnostic),
  );
  if (unresolved.length === 0) {
    return { status: "passed", unsupportedClaims: [] };
  }
  return {
    status: "needs_disclaimer",
    unsupportedClaims: unresolved.map((diagnostic) =>
      `headless bench risk: ${String(diagnostic.type ?? "diagnostic")} ${String(
        diagnostic.evidence ?? "",
      )}`.trim(),
    ),
  };
}

function hasStructuredEvidenceForDiagnostic(context: TuiContext, diagnostic: unknown): boolean {
  if (!diagnostic || typeof diagnostic !== "object") return false;
  const record = diagnostic as Record<string, unknown>;
  if (typeof record.target === "string" || typeof record.targetHost === "string") {
    return hasServiceDiagnosticEvidence(context, record);
  }
  if (typeof record.path === "string") {
    return hasArtifactDiagnosticEvidence(context, record.path);
  }
  return false;
}

function hasServiceDiagnosticEvidence(
  context: TuiContext,
  diagnostic: Record<string, unknown>,
): boolean {
  const targets = new Set<string>();
  for (const key of ["target", "targetHost"] as const) {
    const value = diagnostic[key];
    if (typeof value === "string" && value.trim()) targets.add(value.trim());
  }
  if (typeof diagnostic.targetHost === "string" && typeof diagnostic.targetPort === "number") {
    targets.add(`${diagnostic.targetHost}:${diagnostic.targetPort}`);
  }
  return context.evidence.some((item) => {
    const service = readGenericEvidenceDataRecord(item, "service");
    const serviceHint = readGenericEvidenceDataRecord(item, "serviceHint");
    return serviceMatchesDiagnostic(service, targets) || serviceMatchesDiagnostic(serviceHint, targets);
  });
}

function serviceMatchesDiagnostic(
  data: Record<string, unknown> | undefined,
  targets: Set<string>,
): boolean {
  if (data?.ready !== true) return false;
  if (targets.size === 0) return true;
  const target = typeof data.target === "string" ? data.target : "";
  return target !== "" && Array.from(targets).some((item) => target.includes(item));
}

function hasArtifactDiagnosticEvidence(context: TuiContext, path: string): boolean {
  return hasStructuredArtifactEvidenceForPath(context.evidence, path);
}

function readGenericEvidenceDataRecord(
  evidence: { data?: unknown },
  key: string,
): Record<string, unknown> | undefined {
  return readEvidenceDataRecord(evidence, key);
}

// Phase 7: legacy fallback is a narrow safety net only. Structured
// LinghunFinalAnswerClaims remains the primary path; natural language text is
// checked only when it looks like a final closure statement, not discussion.
const HIGH_RISK_NL_CLAIM_PATTERNS: Array<{ regex: RegExp; label: string }> = [
  {
    regex: /(?:我|本轮|这次|已|已经)?(?:测试|验证|构建|typecheck|lint|smoke)\s*(?:都|全部|已经|已)?通过/iu,
    label: "legacy fallback: verification/test pass evidence",
  },
  {
    regex: /(?:我|本轮|这次|该问题|这个问题)?(?:已完成|已经完成|已修复并已验证|已修复且已验证|已经完成修复|已经修复|已修复)/iu,
    label: "legacy fallback: task completion or fix evidence",
  },
  {
    regex: /(?:全部通过|全部完成|完全通过|可上线|可以上线|达到上线标准)/iu,
    label: "legacy fallback: completion/readiness evidence",
  },
  {
    regex: /\b(?:tests?\s+passed|build\s+passed|type\s*check\s+passed|lint\s+passed|smoke\s*(?:test\s*)?pass(?:ed)?)\b/iu,
    label: "legacy fallback: verification/test pass evidence",
  },
  {
    regex: /\b(?:fixed|completed|verified|beta\s*ready|ready\s*for\s*beta|production\s*ready)\b/iu,
    label: "legacy fallback: task completion or readiness evidence",
  },
];

function detectNaturalLanguageHighRiskClaims(text: string): ClaimCheck {
  if (!looksLikeFinalClosureStatement(text)) {
    return { status: "passed", unsupportedClaims: [] };
  }
  const hitLabels = new Set<string>();
  for (const { regex, label } of HIGH_RISK_NL_CLAIM_PATTERNS) {
    if (regex.test(text)) {
      hitLabels.add(label);
    }
  }
  if (hitLabels.size > 0) {
    return {
      status: "needs_disclaimer",
      unsupportedClaims: Array.from(hitLabels),
      missingEvidenceKinds: Array.from(hitLabels),
    };
  }
  return { status: "passed", unsupportedClaims: [] };
}

function looksLikeFinalClosureStatement(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  if (/(?:可以上线|达到上线标准)/iu.test(normalized)) {
    return true;
  }
  if (/(?:如果|计划|方案|建议|可以|应该|需要|讨论|解释|例如|比如|怎么|如何|\?)|(?:if|plan|proposal|should|could|would|example|explain|how\b)/iu.test(normalized)) {
    return false;
  }
  return /(?:我|本轮|这次|已|已经|完成|修复|验证|测试|构建|通过|上线|ready|passed|fixed|completed|verified)/iu.test(
    normalized,
  );
}

export function formatClaimCheck(result: ClaimCheck, language: Language): string {
  if (result.verdict) {
    const evidenceStatus = result.verdict.evidenceRefs.length > 0 ? "recorded" : "missing";
    const validation = result.verdict.validationCommands.join("; ");
    const uncovered = result.verdict.uncoveredItems.join("; ");
    const risks = result.verdict.residualRisks.join("; ");
    return language === "en-US"
      ? [
          `Claim Checker: verdict ${result.verdict.status}; scope ${result.verdict.scope}.`,
          `Evidence is ${evidenceStatus}; use /details evidence for details.`,
          `Validation: ${validation}.`,
          `Uncovered: ${uncovered}.`,
          `Risk: ${risks}.`,
          `Next: ${result.verdict.nextAction}`,
        ].join("\n")
      : [
          `Claim Checker：verdict ${result.verdict.status}；scope ${result.verdict.scope}。`,
          `证据已${evidenceStatus === "recorded" ? "记录" : "缺失"}；详情用 /details evidence。`,
          `Validation：${validation}。`,
          `Uncovered：${uncovered}。`,
          `Risk：${risks}。`,
          `Next：${result.verdict.nextAction}`,
        ].join("\n");
  }
  if (result.status === "passed") {
    return language === "en-US" ? "Claim check passed." : "Claim Checker：通过。";
  }
  const claims = result.unsupportedClaims.join(", ");
  const missing = result.missingEvidenceKinds?.length
    ? Array.from(new Set(result.missingEvidenceKinds)).join(", ")
    : claims;
  return language === "en-US"
    ? `Claim lacks evidence: ${claims}. Missing evidence: ${missing}. Gather matching evidence or remove the claim.`
    : `Claim Checker：缺少证据：${claims}。缺少 evidence：${missing}。请补齐匹配证据或移除该声明。`;
}
