// D.14B Failure Learning Presenter
//
// /failures 的 summary-first 文本视图。主屏只露出：active/resolved/ignored 计数 +
// 最近高价值 active 教训的人话摘要；完整 details（含 root cause guess、source ref、
// dedupe count、lastSeen）进 detailsText（Ctrl+O 展开）。
// 不泄漏 secret/baseUrl/token/长绝对路径（记录在写入时已脱敏）。

import type { Language } from "@linghun/shared";
import { selectActiveLessons } from "./failure-learning-runtime.js";
import type { CommandPanelView } from "./shell/types.js";
import type { FailureLearningRecord, FailureLearningState } from "./tui-data-types.js";

const CATEGORY_LABEL_ZH: Record<FailureLearningRecord["category"], string> = {
  provider_failure: "模型请求失败",
  tool_failure: "工具失败",
  verification_failure: "验证失败",
  git_operation_failure: "Git 操作失败",
  final_gate_downgrade: "最终回答降级",
  report_guard: "报告守卫未满足",
  resource_cap: "并发上限拒绝",
};

const CATEGORY_LABEL_EN: Record<FailureLearningRecord["category"], string> = {
  provider_failure: "provider request failure",
  tool_failure: "tool failure",
  verification_failure: "verification failure",
  git_operation_failure: "git operation failure",
  final_gate_downgrade: "final answer downgrade",
  report_guard: "report guard unmet",
  resource_cap: "concurrency cap denied",
};

function categoryLabel(record: FailureLearningRecord, language: Language): string {
  return language === "en-US"
    ? CATEGORY_LABEL_EN[record.category]
    : CATEGORY_LABEL_ZH[record.category];
}

export function buildFailureLearningPanel(
  state: FailureLearningState,
  language: Language,
): CommandPanelView {
  const isEn = language === "en-US";
  const active = state.records.filter((r) => r.status === "active");
  const resolved = state.records.filter((r) => r.status === "resolved").length;
  const ignored = state.records.filter((r) => r.status === "ignored").length;
  const lessons = selectActiveLessons(state);

  const summary: string[] = [
    isEn
      ? `Failure learning · active ${active.length} · resolved ${resolved} · ignored ${ignored}`
      : `失败学习 · 活跃 ${active.length} · 已解决 ${resolved} · 已忽略 ${ignored}`,
  ];
  if (active.length === 0) {
    summary.push(
      isEn ? "No active lessons from real failures yet." : "暂无来自真实失败的活跃教训。",
    );
  } else {
    for (const r of lessons.slice(0, 3)) {
      summary.push(
        isEn
          ? `[${categoryLabel(r, language)} ×${r.count}] avoid: ${r.avoidNextTime}`
          : `[${categoryLabel(r, language)} ×${r.count}] 下次避免：${r.avoidNextTime}`,
      );
    }
    summary.push(
      isEn
        ? "These are historical risk hints, not proof anything is fixed."
        : "这些是历史风险提示，不代表问题已修复。",
    );
  }

  const actions: string[] = [];
  if (active.length > 0) {
    actions.push("/failures resolve <id>");
    actions.push("/failures ignore <id>");
  }

  return {
    title: "/failures",
    tone: active.length > 0 ? "warning" : "neutral",
    summary,
    actions,
    detailsText: formatFailureLearningDetails(state, language),
  };
}

export function formatFailureLearningDetails(
  state: FailureLearningState,
  language: Language,
): string {
  const isEn = language === "en-US";
  const lines: string[] = [isEn ? "Failure learning (fact-based)" : "失败学习（基于事实）"];
  const ordered = [...state.records].sort((a, b) => {
    if (a.status !== b.status) {
      const rank = (s: FailureLearningRecord["status"]) =>
        s === "active" ? 0 : s === "ignored" ? 1 : 2;
      return rank(a.status) - rank(b.status);
    }
    return b.lastSeen.localeCompare(a.lastSeen);
  });
  if (ordered.length === 0) {
    lines.push(
      isEn
        ? "- none; lessons are only recorded from real failure events (provider/tool/verification/git/final-gate/report-guard/resource-cap)."
        : "- 无；教训只来自真实失败事件（provider/tool/verification/git/final-gate/report-guard/resource-cap）。",
    );
    return lines.join("\n");
  }
  for (const r of ordered.slice(0, 20)) {
    lines.push(
      `- ${r.id} [${categoryLabel(r, language)}] ${r.status} ×${r.count}${r.relatedTarget ? ` (${r.relatedTarget})` : ""}`,
    );
    lines.push(`    ${isEn ? "summary" : "摘要"}: ${r.failureSummary}`);
    lines.push(`    ${isEn ? "root cause (inferred)" : "根因(推断)"}: ${r.rootCauseGuess}`);
    lines.push(`    ${isEn ? "avoid next time" : "下次避免"}: ${r.avoidNextTime}`);
    lines.push(
      `    ${isEn ? "severity" : "严重度"}=${r.severity}; lastSeen=${r.lastSeen}; source=${r.sourceRef}`,
    );
  }
  lines.push(
    isEn
      ? "Note: inferred root causes are model guesses from evidence; treat as risk hints, not confirmed fixes. Use /failures resolve <id> after you actually fix it; /failures ignore <id> to mute."
      : "说明：根因为基于证据的推断，不是确认事实；当作风险提示，不代表已修复。真正修复后用 /failures resolve <id>；不再关注用 /failures ignore <id>。",
  );
  return lines.join("\n");
}
