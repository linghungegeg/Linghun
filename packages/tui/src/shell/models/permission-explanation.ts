import type { Language } from "@linghun/shared";

/**
 * D.13Q-UX — permission-explanation 翻译层
 *
 * 把 permission-policy-engine.PolicyVerdict.semantic + pathSafety 与
 * tui-permission-runtime.decidePermission 的 reason 文案翻译成 user-facing
 * 中文/英文短句。**绝不暴露 rule.id（randomUUID）**；底层仍可在 details
 * debug 区显示，但主屏 / PermissionPanel 只看本模块输出。
 *
 * 不引入第二套审批系统：本模块只是 presenter 层。
 */

export type PolicySemantic =
  | "readonly"
  | "mutating"
  | "destructive"
  | "network"
  | "install"
  | "secret_read"
  | "outside_workspace"
  | "unknown";

export type PathSafety =
  | "workspace_safe"
  | "workspace_write"
  | "outside_workspace"
  | "sensitive_path"
  | "unknown_path";

/**
 * 把 reason 字符串里的 rule.id（randomUUID 形如
 * `命中 deny 规则：a3b4c2-...` / `命中 allow 规则：xxx`）剥离，
 * 让 user-facing 文本只留语义。
 */
export function sanitizePermissionReason(reason: string): string {
  if (!reason) return "";
  return reason
    .replace(/命中\s*(deny|ask|allow)\s*规则[：:].*/gu, (_match, effect: string) =>
      effect === "deny"
        ? "命中拒绝规则。"
        : effect === "ask"
          ? "命中需确认规则。"
          : "命中允许规则。",
    )
    .replace(/Hit\s+(deny|ask|allow)\s+rule:.*/giu, (_match, effect: string) =>
      effect.toLowerCase() === "deny"
        ? "Hit deny rule."
        : effect.toLowerCase() === "ask"
          ? "Hit ask rule."
          : "Hit allow rule.",
    );
}

/**
 * 把 PolicyVerdict.semantic 翻译成 user-facing 中文/英文短句。
 */
export function explainSemantic(semantic: PolicySemantic, language: Language): string {
  const isEn = language === "en-US";
  switch (semantic) {
    case "readonly":
      return isEn ? "Read-only operation." : "只读操作。";
    case "mutating":
      return isEn ? "May change workspace files." : "可能修改工作区文件。";
    case "destructive":
      return isEn
        ? "Destructive command (delete / overwrite / shutdown)."
        : "破坏性命令（删除 / 覆盖 / 关停）。";
    case "network":
      return isEn ? "Performs network calls." : "会发起网络请求。";
    case "install":
      return isEn ? "Installs or updates dependencies." : "安装或更新依赖。";
    case "secret_read":
      return isEn ? "Reads sensitive files." : "读取敏感文件。";
    case "outside_workspace":
      return isEn ? "Touches paths outside the workspace." : "涉及工作区外的路径。";
    default:
      return isEn ? "Action requires confirmation." : "需要确认后再执行。";
  }
}

/**
 * 把 PathSafety 翻译成 user-facing 中文/英文短句。
 */
export function explainPathSafety(pathSafety: PathSafety, language: Language): string {
  const isEn = language === "en-US";
  switch (pathSafety) {
    case "workspace_safe":
      return isEn ? "Path is workspace-safe." : "路径在工作区且安全。";
    case "workspace_write":
      return isEn ? "Writes inside the workspace." : "在工作区内写入。";
    case "outside_workspace":
      return isEn ? "Touches paths outside the workspace." : "涉及工作区外路径。";
    case "sensitive_path":
      return isEn ? "Touches a sensitive path." : "涉及敏感路径。";
    default:
      return isEn ? "Path classification unknown." : "路径分类未知。";
  }
}

/**
 * 给出"如何永久允许 / 修改规则"的 UI 指引（CCB PermissionRuleExplanation 范式）。
 * 不展示 rule id；仅指向 /permissions 入口。
 */
export function explainHowToUpdate(language: Language): string {
  return language === "en-US"
    ? "Use /permissions to update rules."
    : "可用 /permissions 查看与调整规则。";
}

/**
 * 把 PolicyVerdict 整体翻译成 PermissionPanel 详情区的多行说明。
 * 输入只取 semantic / pathSafety / redactedSummary 三段稳定字段；
 * reason 文本经 sanitizePermissionReason 脱去 rule.id。
 */
export type PolicyVerdictLite = {
  semantic?: PolicySemantic;
  pathSafety?: PathSafety;
  redactedSummary?: string;
  reason?: string;
};

export function explainPolicyVerdict(verdict: PolicyVerdictLite, language: Language): string[] {
  const lines: string[] = [];
  if (verdict.semantic) lines.push(explainSemantic(verdict.semantic, language));
  if (verdict.pathSafety) lines.push(explainPathSafety(verdict.pathSafety, language));
  if (verdict.redactedSummary && verdict.redactedSummary.trim().length > 0) {
    lines.push(verdict.redactedSummary.trim());
  }
  if (verdict.reason) {
    const safe = sanitizePermissionReason(verdict.reason).trim();
    if (safe.length > 0 && !lines.some((existing) => existing === safe)) {
      lines.push(safe);
    }
  }
  lines.push(explainHowToUpdate(language));
  return lines;
}
