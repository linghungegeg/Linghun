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
  const risk = formatRisk(permission.risk, language);
  if (language === "en-US") {
    return [
      "Tool paused for permission",
      `- Tool: ${permission.toolName}`,
      `- Why paused: ${permission.reason}`,
      `- Safety level: ${risk}`,
      `- Scope: ${files}`,
      "- Result: the tool did not run; the denial was returned to the model as tool_result evidence.",
      "- Next: review /permissions recent, use an explicit slash command, or switch to a controlled execution mode and retry.",
    ].join("\n");
  }
  return [
    "工具已暂停，等待权限边界处理",
    `- 工具：${permission.toolName}`,
    `- 暂停原因：${permission.reason}`,
    `- 安全级别：${risk}`,
    `- 影响范围：${files}`,
    "- 结果：工具未执行；拒绝原因已作为 tool_result 证据回灌给模型。",
    "- 下一步：查看 /permissions recent，改用明确 slash command，或切换到受控执行模式后重试。",
  ].join("\n");
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
