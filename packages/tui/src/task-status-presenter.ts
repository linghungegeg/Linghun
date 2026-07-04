import type { Language } from "@linghun/shared";
import type { EvidenceRecord } from "./tui-data-types.js";

export type EvidenceSummary = {
  total: number;
  counts: Record<string, number>;
  recent: Array<Pick<EvidenceRecord, "id" | "kind" | "summary">>;
};

export function summarizeEvidenceRecords(evidence: EvidenceRecord[]): EvidenceSummary {
  const counts: Record<string, number> = {};
  for (const item of evidence) {
    const category = categorizeEvidence(item);
    counts[category] = (counts[category] ?? 0) + 1;
  }
  return {
    total: evidence.length,
    counts,
    recent: evidence.slice(0, 3).map((item) => ({
      id: item.id,
      kind: item.kind,
      summary: item.summary,
    })),
  };
}

export function formatFinalGateTaskStatus(input: {
  language: Language;
  missingLabels: string[];
  evidence: EvidenceRecord[];
}): string {
  const { language } = input;
  const missing = input.missingLabels.length > 0
    ? input.missingLabels.join(language === "en-US" ? ", " : "、")
    : (language === "en-US" ? "matching evidence" : "匹配证据");
  const summary = summarizeEvidenceRecords(input.evidence);
  const evidenceLine = formatEvidenceSummaryLine(summary, language);
  return language === "en-US"
    ? [
        "Task status: final answer is waiting on evidence.",
        `- Missing: ${missing}.`,
        `- Current evidence: ${evidenceLine}.`,
        "- Next: gather the smallest matching evidence with tools or verification; if blocked, say why and avoid completion claims.",
      ].join("\n")
    : [
        "任务状态：最终回答等待证据确认。",
        `- 缺少：${missing}。`,
        `- 当前证据：${evidenceLine}。`,
        "- 下一步：用工具或验证补齐最小匹配证据；若权限或预算阻塞，说明阻塞原因并避免完成声明。",
      ].join("\n");
}

function formatEvidenceSummaryLine(summary: EvidenceSummary, language: Language): string {
  if (summary.total === 0) {
    return language === "en-US" ? "none" : "暂无";
  }
  const categories = Object.keys(summary.counts)
    .map((kind) => formatEvidenceCategoryLabel(kind, language))
    .filter(Boolean);
  const uniqueCategories = Array.from(new Set(categories));
  if (language === "en-US") {
    const label = uniqueCategories.length > 0 ? uniqueCategories.join(", ") : "runtime records";
    return `${summary.total} recorded item(s), including ${label}; raw details are available in /details`;
  }
  const label = uniqueCategories.length > 0 ? uniqueCategories.join("、") : "运行记录";
  return `已有 ${summary.total} 条记录，包含${label}；原始细节可在 /details 查看`;
}

function formatEvidenceCategoryLabel(kind: string, language: Language): string {
  const zh: Record<string, string> = {
    verification: "验证记录",
    source_read: "文件读取",
    source_search: "搜索记录",
    file_change: "文件变更",
    artifact: "产物记录",
    runtime: "运行状态记录",
    workflow: "工作流记录",
    permission: "权限记录",
    other: "其他记录",
  };
  const en: Record<string, string> = {
    verification: "verification",
    source_read: "file reads",
    source_search: "searches",
    file_change: "file changes",
    artifact: "artifacts",
    runtime: "runtime checks",
    workflow: "workflow records",
    permission: "permission records",
    other: "other records",
  };
  return (language === "en-US" ? en : zh)[kind] ?? (language === "en-US" ? "other records" : "其他记录");
}

function categorizeEvidence(evidence: EvidenceRecord): string {
  const haystack = [evidence.kind, evidence.source, evidence.summary, ...evidence.supportsClaims]
    .join(" ")
    .toLowerCase();
  if (evidence.kind === "test_result" || /verification|test|typecheck|build|lint|smoke/u.test(haystack)) {
    return "verification";
  }
  if (evidence.kind === "file_read") return "source_read";
  if (evidence.kind === "grep_result" || evidence.kind === "index_query") return "source_search";
  if (/write|edit|diff|changed|file_change/u.test(haystack)) return "file_change";
  if (/artifact|report|full-output|log/u.test(haystack) || evidence.fullOutputPath || evidence.outputPath || evidence.logPath) {
    return "artifact";
  }
  if (/service|server|port|health|runtime/u.test(haystack)) return "runtime";
  if (/workflow|agent|job/u.test(haystack)) return "workflow";
  if (/permission|approval|denied|cancelled/u.test(haystack)) return "permission";
  return "other";
}
