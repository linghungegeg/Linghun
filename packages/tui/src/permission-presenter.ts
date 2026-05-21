import type { Language, PermissionMode } from "@linghun/shared";
import type { ToolName } from "@linghun/tools";

export type PermissionPromptView = {
  toolName: ToolName;
  decision: "allow" | "ask" | "deny";
  risk: "low" | "medium" | "high";
  mode: PermissionMode;
  reason: string;
  scope: string[];
};

export function formatLocalToolPermissionPrompt(
  permission: PermissionPromptView,
  language: Language,
): string {
  const files = permission.scope.length > 0 ? permission.scope.join(", ") : "none";
  const risk = formatRisk(permission.risk, language);
  if (language === "en-US") {
    return [
      "Permission needed before running this tool",
      `- Tool: ${permission.toolName}`,
      `- Why paused: ${permission.reason}`,
      `- Safety level: ${risk}`,
      `- Scope: ${files}`,
      "- Next: type yes/confirm to allow once, or no/cancel to deny. The tool has not run yet.",
    ].join("\n");
  }
  return [
    "需要先确认权限",
    `- 工具：${permission.toolName}`,
    `- 暂停原因：${permission.reason}`,
    `- 安全级别：${risk}`,
    `- 影响范围：${files}`,
    "- 下一步：输入 yes/确认/继续 可本次允许；输入 no/取消 可拒绝。工具尚未执行。",
  ].join("\n");
}

export function formatModelToolPermissionPrompt(
  permission: PermissionPromptView,
  language: Language,
): string {
  const files = permission.scope.length > 0 ? permission.scope.join(", ") : "none";
  const action = formatPermissionAction(permission);
  const risk = formatRisk(permission.risk, language);
  const isReportWrite = isReportWritePrompt(permission);
  if (language === "en-US") {
    if (isReportWrite) {
      return [`Write ${files}`, "Allow this write? yes / no"].join("\n");
    }
    return [
      `Linghun wants to run ${action}. Allow this action once?`,
      `- action: ${action}`,
      `- scope: ${files}`,
      `- risk: ${risk}`,
      `- reason: ${permission.reason}`,
      "- choices: type yes/confirm to allow this pending tool once; type no/cancel to deny.",
      "- boundary: the tool has not run yet, and allowing once does not change the permission mode.",
    ].join("\n");
  }
  if (isReportWrite) {
    return [`写入 ${files}`, "允许本次写入？yes / no"].join("\n");
  }
  return [
    `Linghun 想执行 ${action}，是否允许本次执行？`,
    `- action：${action}`,
    `- scope：${files}`,
    `- risk：${risk}`,
    `- reason：${permission.reason}`,
    "- choices：输入 yes/确认/继续 可本次允许当前工具；输入 no/取消 可拒绝。",
    "- boundary：工具尚未执行；本次允许只适用于当前 pending tool，不会切换权限模式。",
  ].join("\n");
}

function formatPermissionAction(permission: PermissionPromptView): string {
  const files = permission.scope.length > 0 ? permission.scope.join(", ") : "none";
  if (permission.toolName === "Write") {
    return `Write ${files}`;
  }
  if (permission.toolName === "Edit" || permission.toolName === "MultiEdit") {
    return `${permission.toolName} ${files}`;
  }
  return permission.toolName;
}

function isReportWritePrompt(permission: PermissionPromptView): boolean {
  if (permission.toolName !== "Write" || permission.scope.length !== 1) {
    return false;
  }
  const file = permission.scope[0].replace(/\\/g, "/").toLowerCase();
  const fileName = file.split("/").pop() ?? file;
  return /\.md$/.test(fileName) && (/report|报告/.test(fileName) || fileName === "report.md");
}

function formatRisk(risk: PermissionPromptView["risk"], language: Language): string {
  if (language === "en-US") {
    if (risk === "high") return "high — can execute commands or modify important state";
    if (risk === "medium") return "medium — can modify workspace files";
    return "low — read-only or session-scoped";
  }
  if (risk === "high") return "高 — 可能执行命令或改变重要状态";
  if (risk === "medium") return "中 — 可能修改工作区文件";
  return "低 — 只读或仅影响当前会话";
}
