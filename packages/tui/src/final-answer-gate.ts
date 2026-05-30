import type { TranscriptEvent } from "@linghun/core";
import type { Language } from "@linghun/shared";
import { detectArchitectureDrift } from "./architecture-runtime.js";
import type { TuiContext } from "./index.js";
import {
  evaluateArchitectureAndCompletenessClaims,
  evaluateFinalAnswerClaims,
  finalAnswerHasCompletenessClassification,
  hasArchitectureEvidenceForClaims,
} from "./model-loop-runtime.js";
import type { EvidenceRecord, VerdictEvidenceScope } from "./tui-data-types.js";
import { messages } from "./tui-messages.js";

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

export function checkEvidenceGate(text: string, context: TuiContext): string | null {
  const lower = text.toLowerCase();
  const asksCodeFact =
    /代码|函数|调用链|实现|修复|验证|code|function|call chain|fixed|verified/.test(lower);
  if (!asksCodeFact) {
    return null;
  }
  // D.13U：不再"任意 evidence 即放行"。要求至少一条本地代码事实证据
  // （file_read / grep_result / index_query 或带 git_local_fact / local_read 标记）。
  const hasLocalCodeEvidence = context.evidence.some(
    (item) =>
      item.kind === "file_read" ||
      item.kind === "grep_result" ||
      item.kind === "index_query" ||
      item.supportsClaims.some((c) => c === "local_read" || c === "git_local_fact"),
  );
  if (hasLocalCodeEvidence) {
    return null;
  }
  return messages[context.language].evidenceBlocked;
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
        : "Fix or re-smoke the real provider + real TUI report-generation path before any Beta readiness PASS claim.",
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

export function isBetaReadinessClaim(normalizedClaim: string): boolean {
  return (
    normalizedClaim.includes("beta") &&
    (normalizedClaim.includes("ready") ||
      normalizedClaim.includes("readiness") ||
      normalizedClaim.includes("pass") ||
      normalizedClaim.includes("完成") ||
      normalizedClaim.includes("就绪") ||
      normalizedClaim.includes("通过"))
  );
}

export function checkClaimSupport(claim: string, context: TuiContext): ClaimCheck {
  const normalizedClaim = claim.toLowerCase();
  if (isBetaReadinessClaim(normalizedClaim)) {
    return {
      status: "needs_disclaimer",
      unsupportedClaims: ["Beta readiness PASS"],
      verdict: createPhase15BetaVerdictScope(context.evidence),
    };
  }

  // D.13U：复用 evaluateFinalAnswerClaims，按 claim 类型匹配 evidence 类型。
  // 任意 evidence > 0 不再当通行证；保留固定中英 phrase 列表用于 unsupportedClaims 文案。
  const highRisk = [
    "已完成",
    "已修复",
    "已验证",
    "无风险",
    "等于 ccb",
    "成熟工具",
    "可以进入 beta",
    "测试通过",
    "代码里",
    "调用链是",
    "不会影响",
    "completed",
    "fixed",
    "verified",
    "no risk",
    "ccb parity",
    "ready for beta",
    "release ready",
    "tests passed",
    "in the code",
  ];
  const unsupportedClaims = highRisk.filter((item) => normalizedClaim.includes(item.toLowerCase()));
  if (unsupportedClaims.length === 0) {
    return { status: "passed", unsupportedClaims: [] };
  }
  const verdict = evaluateFinalAnswerClaims(claim, context.evidence);
  if (verdict.status === "passed") {
    return { status: "passed", unsupportedClaims: [] };
  }
  return { status: "needs_disclaimer", unsupportedClaims };
}

export function formatClaimCheck(result: ClaimCheck, language: Language): string {
  if (result.verdict) {
    const evidenceStatus = result.verdict.evidenceRefs.length > 0 ? "recorded" : "missing";
    const validation = result.verdict.validationCommands.join("; ");
    const uncovered = result.verdict.uncoveredItems.join("; ");
    const risks = result.verdict.residualRisks.join("; ");
    return language === "en-US"
      ? [
          `Claim Checker: verdict=${result.verdict.status}; scope=${result.verdict.scope}.`,
          `Evidence is ${evidenceStatus}; use /details evidence for details.`,
          `Validation: ${validation}.`,
          `Uncovered: ${uncovered}.`,
          `Risk: ${risks}.`,
          `Next: ${result.verdict.nextAction}`,
        ].join("\n")
      : [
          `Claim Checker：verdict=${result.verdict.status}；scope=${result.verdict.scope}。`,
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
    ? `Claim needs disclaimer: ${claims}. Use unverified / pending confirmation wording.`
    : `Claim Checker：缺少证据，需降级表述：${claims}。请改写为“未验证 / 待确认”。`;
}
