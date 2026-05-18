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
  if (language === "en-US") {
    return [
      "Permission approval needed",
      `- action: ${permission.toolName}`,
      `- decision: ${permission.decision}`,
      `- risk: ${permission.risk}`,
      `- mode: ${permission.mode}`,
      `- reason: ${permission.reason}`,
      `- scope: ${files}`,
      "- next: type yes/confirm to allow once, or no/cancel to deny. The tool has not run yet.",
    ].join("\n");
  }
  return [
    "需要权限审批",
    `- action: ${permission.toolName}`,
    `- decision: ${permission.decision}`,
    `- risk: ${permission.risk}`,
    `- mode: ${permission.mode}`,
    `- reason: ${permission.reason}`,
    `- scope: ${files}`,
    "- next: 输入 yes/确认/继续 可本次允许；输入 no/取消 可拒绝。工具尚未执行。",
  ].join("\n");
}

export function formatModelToolPermissionPrompt(
  permission: PermissionPromptView,
  language: Language,
): string {
  const files = permission.scope.length > 0 ? permission.scope.join(", ") : "none";
  if (language === "en-US") {
    return [
      "Model tool permission prompt",
      `- action: ${permission.toolName}`,
      `- decision: ${permission.decision}`,
      `- risk: ${permission.risk}`,
      `- mode: ${permission.mode}`,
      `- reason: ${permission.reason}`,
      `- scope: ${files}`,
      "- result: tool not executed; denial was returned to the model as tool_result evidence.",
      "- next: review /permissions recent, use an explicit slash command, or switch to a controlled execution mode and retry.",
    ].join("\n");
  }
  return [
    "模型工具权限提示",
    `- tool: ${permission.toolName}`,
    `- action: ${permission.toolName}`,
    `- decision: ${permission.decision}`,
    `- risk: ${permission.risk}`,
    `- mode: ${permission.mode}`,
    `- reason: ${permission.reason}`,
    `- scope: ${files}`,
    "- result: 工具未执行；拒绝原因已作为 tool_result 证据回灌给模型。",
    "- next: 查看 /permissions recent，改用明确 slash command，或切换到受控执行模式后重试。",
  ].join("\n");
}
