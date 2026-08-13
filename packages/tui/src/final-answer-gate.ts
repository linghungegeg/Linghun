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
  hasArchitectureEvidenceForClaims,
  type FinalAnswerClaimVerdict,
} from "./model-loop-runtime.js";
import type { EvidenceRecord, VerdictEvidenceScope } from "./tui-data-types.js";

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
  const architectureSignal = context.lastMetaSchedulerDecision?.policyDecision.architectureSignal;
  const card =
    architectureSignal?.candidate && architectureSignal.actualImpact.status !== "confirmed"
      ? undefined
      : context.currentArchitectureCard;
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
    },
  );
  if (verdict.status === "needs_disclaimer") {
    return { status: "needs_disclaimer", verdict };
  }
  return { status: "passed" };
}

export type ClaimCheck = {
  status: "passed" | "needs_disclaimer" | "blocked";
  unsupportedClaims: string[];
  missingEvidenceKinds?: string[];
  verdict?: VerdictEvidenceScope;
  promptForStructuredClaim?: boolean;
};

export function createHandoffPendingItems(evidence: EvidenceRecord[]): string[] {
  return createPhase15BetaVerdictScope(evidence).uncoveredItems;
}

export function createHandoffRiskItems(evidence: EvidenceRecord[]): string[] {
  return createPhase15BetaVerdictScope(evidence).residualRisks;
}

export function createPhase15BetaVerdictScope(
  evidence: EvidenceRecord[] = [],
  _transcript: TranscriptEvent[] = [],
  context?: Pick<TuiContext, "currentRequestTurnId" | "projectPath" | "sessionId">,
): VerdictEvidenceScope {
  const betaEvidence = evidence.filter((item) => isEligibleBetaEvidence(item, context));
  const requiredEvidence = [
    {
      key: "real-tui-report-generation",
      missing: "real TUI report-generation path lacks PASS evidence",
      present: hasBetaEvidence(betaEvidence, "real_tui_report_generation"),
    },
    {
      key: "deepseek-dual-provider-pass",
      missing: "DeepSeek dual-provider live report evidence is missing",
      present: hasBetaEvidence(betaEvidence, "provider_report", "deepseek"),
    },
    {
      key: "openai-compatible-dual-provider-pass",
      missing: "OpenAI-compatible dual-provider live report evidence is missing",
      present: hasBetaEvidence(betaEvidence, "provider_report", "openai-compatible"),
    },
    {
      key: "write-evidence",
      missing: "report Write evidence is missing",
      present: hasReportWriteEvidence(betaEvidence),
    },
    {
      key: "final-answer-report-reference",
      missing: "final answer does not reference the generated report",
      present: hasFinalAnswerReportReference(betaEvidence),
    },
  ];
  const hasBlockingGate = hasBlockingGateEvidence(betaEvidence);
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
    evidenceRefs: betaEvidence.map((item) => item.id),
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

function hasReportWriteEvidence(evidence: EvidenceRecord[]): boolean {
  return hasBetaEvidence(evidence, "report_write");
}

function hasFinalAnswerReportReference(evidence: EvidenceRecord[]): boolean {
  if (hasBetaEvidence(evidence, "final_answer_report_reference")) {
    return true;
  }
  return false;
}

function hasBlockingGateEvidence(evidence: EvidenceRecord[]): boolean {
  return evidence.some((item) => getBetaEvidence(item)?.status !== "pass");
}

function isBetaVerdictEvidence(item: EvidenceRecord): boolean {
  return getBetaEvidence(item) !== undefined;
}

function isEligibleBetaEvidence(
  item: EvidenceRecord,
  context?: Pick<TuiContext, "currentRequestTurnId" | "projectPath" | "sessionId">,
): boolean {
  return (
    isBetaVerdictEvidence(item) &&
    item.kind === "test_result" &&
    item.supportsClaims.includes("verification_passed") &&
    (!context || evidenceMatchesRequestOwner(item, context))
  );
}

type BetaEvidenceRole =
  | "real_tui_report_generation"
  | "provider_report"
  | "report_write"
  | "final_answer_report_reference";

type BetaEvidence = {
  role: BetaEvidenceRole;
  status: "pass" | "partial" | "skipped" | "blocked";
  provider?: "deepseek" | "openai-compatible";
};

function getBetaEvidence(item: EvidenceRecord): BetaEvidence | undefined {
  if (!isRecord(item.data) || !isRecord(item.data.betaEvidence)) return undefined;
  const { role, status, provider } = item.data.betaEvidence;
  if (
    ![
      "real_tui_report_generation",
      "provider_report",
      "report_write",
      "final_answer_report_reference",
    ].includes(String(role)) ||
    !["pass", "partial", "skipped", "blocked"].includes(String(status)) ||
    (provider !== undefined && provider !== "deepseek" && provider !== "openai-compatible")
  ) {
    return undefined;
  }
  return { role: role as BetaEvidenceRole, status: status as BetaEvidence["status"], provider };
}

function hasBetaEvidence(
  evidence: EvidenceRecord[],
  role: BetaEvidenceRole,
  provider?: BetaEvidence["provider"],
): boolean {
  return evidence.some((item) => {
    const betaEvidence = getBetaEvidence(item);
    return (
      betaEvidence?.role === role &&
      betaEvidence.status === "pass" &&
      (provider === undefined || betaEvidence.provider === provider)
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function checkClaimSupport(claim: string, context: TuiContext): ClaimCheck {
  const headlessDiagnosticsCheck = checkHeadlessRecentDiagnostics(context);
  if (headlessDiagnosticsCheck.status !== "passed") {
    return headlessDiagnosticsCheck;
  }

  // 事实裁决只接受模型声明的结构化 claim 契约。
  const structuredClaims = extractStructuredFinalAnswerClaims(claim);
  if (structuredClaims.some((item) => item.kind === "beta_readiness")) {
    return {
      status: "needs_disclaimer",
      unsupportedClaims: [
        ...structuredClaims
          .filter((item) => item.kind === "beta_readiness")
          .map((item) => item.phrase),
      ],
      verdict: createPhase15BetaVerdictScope(context.evidence, [], context),
    };
  }

  if (structuredClaims.length === 0) {
    return {
      status: "passed",
      unsupportedClaims: [],
      ...(hasNaturalLanguageHighRiskClaimHint(claim) ? { promptForStructuredClaim: true } : {}),
    };
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
  const evidence = context.currentRequestTurnId
    ? context.evidence.filter((item) => evidenceMatchesRequestOwner(item, context))
    : context.evidence;
  return evidence.some((item) => {
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
  const evidence = context.currentRequestTurnId
    ? context.evidence.filter((item) => evidenceMatchesRequestOwner(item, context))
    : context.evidence;
  return hasStructuredArtifactEvidenceForPath(evidence, path);
}

function readGenericEvidenceDataRecord(
  evidence: { data?: unknown },
  key: string,
): Record<string, unknown> | undefined {
  return readEvidenceDataRecord(evidence, key);
}

// Compatibility-only prompt patterns. They never decide facts or evidence sufficiency.
const HIGH_RISK_NL_CLAIM_PATTERNS: RegExp[] = [
  /(?:我|本轮|这次|已|已经)?(?:测试|验证|构建|typecheck|lint|smoke)\s*(?:都|全部|已经|已)?通过/iu,
  /(?:我|本轮|这次|该问题|这个问题)?(?:已完成|已经完成|已修复并已验证|已修复且已验证|已经完成修复|已经修复|已修复)/iu,
  /(?:全部通过|全部完成|完全通过|可上线|可以上线|达到上线标准)/iu,
  /\b(?:tests?\s+passed|build\s+passed|type\s*check\s+passed|lint\s+passed|smoke\s*(?:test\s*)?pass(?:ed)?)\b/iu,
  /\b(?:fixed|completed|verified|beta\s*ready|ready\s*for\s*beta|production\s*ready)\b/iu,
];

function hasNaturalLanguageHighRiskClaimHint(text: string): boolean {
  return looksLikeFinalClosureStatement(text) &&
    HIGH_RISK_NL_CLAIM_PATTERNS.some((regex) => regex.test(text));
}

function looksLikeFinalClosureStatement(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  if (/(?:如果|计划|方案|建议|应该|需要|讨论|解释|例如|比如|怎么|如何|吗|[?？])|(?:if|plan|proposal|should|could|would|example|explain|how\b)/iu.test(normalized)) {
    return false;
  }
  if (/(?:可以上线|达到上线标准)/iu.test(normalized)) return true;
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
    if (result.promptForStructuredClaim) {
      return language === "en-US"
        ? "Claim check passed. Hint: this natural-language result was not fact-adjudicated; add LinghunFinalAnswerClaims and matching evidence to verify it."
        : "Claim Checker：通过。提示：该自然语言结论未进入事实裁决；如需核查，请补充 LinghunFinalAnswerClaims 结构化声明和对应 evidence。";
    }
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
