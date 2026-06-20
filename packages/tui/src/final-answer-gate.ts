import type { TranscriptEvent } from "@linghun/core";
import type { Language } from "@linghun/shared";
import { detectArchitectureDrift } from "./architecture-runtime.js";
import type { TuiContext } from "./index.js";
import {
  evaluateArchitectureAndCompletenessClaims,
  evaluateFinalAnswerClaims,
  extractStructuredFinalAnswerClaims,
  finalAnswerHasCompletenessClassification,
  hasArchitectureEvidenceForClaims,
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
      hasArchitectureEvidence: hasArchitectureEvidenceForClaims(context.evidence),
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
  const headlessRisk = createHeadlessBenchDiagnosticRiskSummary(context);
  // D.13U：只接受模型声明的结构化 claim 契约；不再维护自然语言短语表。
  const structuredClaims = extractStructuredFinalAnswerClaims(claim);
  if (structuredClaims.some((item) => item.kind === "beta_readiness")) {
    return {
      status: "needs_disclaimer",
      unsupportedClaims: structuredClaims
        .filter((item) => item.kind === "beta_readiness")
        .map((item) => item.phrase),
      verdict: createPhase15BetaVerdictScope(context.evidence),
    };
  }

  if (structuredClaims.length === 0) {
    // D.14H Phase 7.5-C：纯自然语言高风险 claim 兜底识别。
    // 无结构化 claim 时，对"测试通过 / PASS / 已完成"等无证据高风险表述
    // 做最小匹配；普通低风险文本不误伤。
    const nlCheck = detectNaturalLanguageHighRiskClaims(claim);
    if (nlCheck.status !== "passed") return nlCheck;
    if (headlessRisk) {
      return {
        status: "needs_disclaimer",
        unsupportedClaims: [headlessRisk],
      };
    }
    return { status: "passed", unsupportedClaims: [] };
  }
  if (
    structuredClaims.some(
      (item) => item.kind === "architecture_boundary" || item.kind === "completeness",
    )
  ) {
    const extended = runArchitectureAndCompletenessFinalGate(context, claim);
    if (extended.status === "needs_disclaimer") {
      return {
        status: "needs_disclaimer",
        unsupportedClaims: [
          ...extended.verdict.matchedClaims.map((item) => item.phrase),
          ...(headlessRisk ? [headlessRisk] : []),
        ],
      };
    }
  }
  const verdict = evaluateFinalAnswerClaims(claim, context.evidence);
  if (verdict.status === "passed") {
    if (headlessRisk) {
      return {
        status: "needs_disclaimer",
        unsupportedClaims: [headlessRisk],
      };
    }
    return { status: "passed", unsupportedClaims: [] };
  }
  return {
    status: "needs_disclaimer",
    unsupportedClaims: [
      ...structuredClaims.map((item) => item.phrase),
      ...(headlessRisk ? [headlessRisk] : []),
    ],
  };
}

function createHeadlessBenchDiagnosticRiskSummary(context: TuiContext): string | undefined {
  const tools = context.tools as typeof context.tools & {
    headlessBench?: { enabled?: boolean };
    recentDiagnostics?: Array<StructuredDiagnosticRisk>;
  };
  if (tools.headlessBench?.enabled !== true) return undefined;
  const risky = (tools.recentDiagnostics ?? []).slice(0, 10).filter((diagnostic) =>
    (diagnostic.severity === "recoverable" || diagnostic.severity === "blocking") &&
    (
      diagnostic.type === "service_readiness" ||
      diagnostic.type === "artifact_preservation" ||
      diagnostic.type === "binary_tool_missing" ||
      diagnostic.type === "missing_command" ||
      diagnostic.type === "timeout" ||
      diagnostic.type === "provider_or_network"
    ) &&
    !isDiagnosticRiskResolved(diagnostic, context.evidence)
  );
  if (risky.length === 0) return undefined;
  return `headless bench risk: ${risky
    .slice(0, 3)
    .map((diagnostic) => `${diagnostic.type}: ${diagnostic.evidence ?? ""}`.trim())
    .join("; ")}`;
}

type StructuredDiagnosticRisk = {
  type?: string;
  severity?: string;
  evidence?: string;
  target?: string;
  path?: string;
  targetHost?: string;
  targetPort?: number;
};

function isDiagnosticRiskResolved(
  diagnostic: StructuredDiagnosticRisk,
  evidence: EvidenceRecord[],
): boolean {
  if (diagnostic.type === "service_readiness" || diagnostic.type === "timeout") {
    const target = readDiagnosticServiceTarget(diagnostic);
    if (!target) return false;
    return evidence.some((item) => {
      const serviceHint = readEvidenceDataRecord(item, "serviceHint");
      const service = readEvidenceDataRecord(item, "service");
      return (
        serviceHint?.ready === true && serviceHint.target === target
      ) || (
        service?.ready === true && service.target === target
      );
    });
  }
  if (diagnostic.type === "artifact_preservation") {
    if (!diagnostic.path) return false;
    return evidence.some((item) => {
      const artifactHint = readEvidenceDataRecord(item, "artifactHint");
      return artifactHint?.exists === true && artifactHint.path === diagnostic.path;
    });
  }
  if (diagnostic.type === "binary_tool_missing") {
    if (!diagnostic.path) return false;
    return evidence.some((item) =>
      readEvidenceDataRecord(item, "binaryHint")?.path === diagnostic.path ||
      readEvidenceDataRecord(item, "binaryPreflight")?.path === diagnostic.path
    );
  }
  return false;
}

function readDiagnosticServiceTarget(diagnostic: StructuredDiagnosticRisk): string | undefined {
  if (diagnostic.target) return diagnostic.target;
  if (diagnostic.targetHost && diagnostic.targetPort !== undefined) {
    return `${diagnostic.targetHost}:${diagnostic.targetPort}`;
  }
  return undefined;
}

function readEvidenceDataRecord(
  evidence: EvidenceRecord,
  key: "service" | "serviceHint" | "artifactHint" | "binaryHint" | "binaryPreflight",
): Record<string, unknown> | undefined {
  if (!evidence.data || typeof evidence.data !== "object") return undefined;
  const value = (evidence.data as Record<string, unknown>)[key];
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

// D.14H Phase 7.5-C：纯自然语言高风险 claim 最小兜底识别。
// 无结构化 LinghunFinalAnswerClaims 时，对无证据的高风险完成/通过声明做匹配。
// 只拦截明确的自夸式 claim；普通陈述（如"当前分支是 master"）不误伤。
//
// D.14H Phase 7.5-C.1：JS 的 \b 是 ASCII 单词边界，CJK 全部是 \W，
// \b 包住中文短语永远不会命中。中文 pattern 去掉 \b，英文保留。
const HIGH_RISK_NL_CLAIM_PATTERNS: Array<{ regex: RegExp; label: string }> = [
  // ── Chinese patterns（无 \b，CJK 字符无需 ASCII 单词边界）──
  {
    regex: /(?:测试(?:都|全部|已经|已)?通过|全部测试通过|所有测试(?:都)?通过)/iu,
    label: "测试通过",
  },
  {
    regex: /(?:已完成|已修复并已验证|已修复且已验证|已经完成修复|已经修复)/iu,
    label: "已完成/已修复",
  },
  {
    regex: /已修复/iu,
    label: "已修复",
  },
  {
    regex: /(?:全部通过|全部完成|完全通过)/iu,
    label: "全部通过",
  },
  {
    regex: /(?:可上线|可以上线|达到上线标准)/iu,
    label: "可上线",
  },
  {
    regex: /(?:全部(?:单元)?测试(?:已|已经)?通过|所有(?:单元)?测试(?:已|已经)?通过)/iu,
    label: "测试通过",
  },
  // ── English / mixed patterns（保留 \b，避免误伤普通词）──
  {
    regex: /\b(?:beta\s*ready|ready\s*for\s*beta|production\s*ready)\b/iu,
    label: "beta ready",
  },
  {
    regex: /\b(?:smoke\s*(?:test\s*)?pass(?:ed)?)\b/iu,
    label: "smoke pass",
  },
  {
    regex: /smoke\s*通过/iu,
    label: "smoke pass",
  },
  {
    regex: /\bPASS\b/u,
    label: "PASS",
  },
];

function detectNaturalLanguageHighRiskClaims(text: string): ClaimCheck {
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
    };
  }
  return { status: "passed", unsupportedClaims: [] };
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
  return language === "en-US"
    ? `Claim lacks evidence: ${claims}. Gather matching evidence or remove the claim.`
    : `Claim Checker：缺少证据：${claims}。请补齐匹配证据或移除该声明。`;
}
