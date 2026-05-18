export type IndexSafetyRepairContinuation =
  | { action: "repair"; reason: string }
  | { action: "force"; reason: string }
  | { action: "pass"; reason: string };

export type IndexSafetyRepairState = {
  hasSafetyWarning: boolean;
  riskyFileCount: number;
};

const INDEX_TARGET_TERMS = ["index", "索引", "codebase"];
const REPAIR_ACTION_TERMS = [
  "ignore",
  "exclude",
  "skip",
  "add",
  "write",
  "refresh",
  "update",
  "排除",
  "忽略",
  "跳过",
  "写入",
  "加入",
  "添加",
  "刷新",
  "更新",
  "处理",
];
const RISK_OBJECT_TERMS = [
  "large",
  "risky",
  "files",
  "file",
  "大文件",
  "风险文件",
  "这些文件",
  "这些",
];
const FORCE_TERMS = ["force", "rebuild", "--force", "confirm-rebuild", "强制", "重建"];

export function classifyIndexSafetyRepairContinuation(
  text: string,
  state: IndexSafetyRepairState,
): IndexSafetyRepairContinuation {
  if (!state.hasSafetyWarning || state.riskyFileCount === 0) {
    return { action: "pass", reason: "no active index safety blocker" };
  }
  const normalized = text.toLowerCase();
  const mentionsIndex = hasAnyTerm(normalized, INDEX_TARGET_TERMS);
  const mentionsForce = mentionsIndex && hasAnyTerm(normalized, FORCE_TERMS);
  if (mentionsForce) {
    return { action: "force", reason: "natural language requested force or rebuild" };
  }
  const repairScore = countTerms(normalized, REPAIR_ACTION_TERMS);
  const objectScore = countTerms(normalized, RISK_OBJECT_TERMS);
  if (mentionsIndex && repairScore > 0 && objectScore > 0) {
    return { action: "repair", reason: "active index safety blocker plus repair intent" };
  }
  return { action: "pass", reason: "not an index safety repair continuation" };
}

function countTerms(text: string, terms: string[]): number {
  return terms.reduce((count, term) => (text.includes(term) ? count + 1 : count), 0);
}

function hasAnyTerm(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}
