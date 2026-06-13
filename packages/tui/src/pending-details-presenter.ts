import { relative } from "node:path";
import { type WorkspaceTrustLevel, getProjectSettingsPath } from "@linghun/config";
import type { TuiContext } from "./index.js";
import type { PendingNaturalCommand } from "./natural-command-bridge.js";
import { truncateDisplay } from "./startup-runtime.js";

type PendingLocalApproval = NonNullable<TuiContext["pendingLocalApproval"]>;

function getEffectiveWorkspaceTrustLevel(context: TuiContext): WorkspaceTrustLevel {
  return context.config.workspaceTrust.recorded
    ? context.config.workspaceTrust.level
    : "restricted";
}

export function formatWorkspaceTrustStatus(context: TuiContext): string {
  const level = getEffectiveWorkspaceTrustLevel(context);
  const path =
    relative(context.projectPath, getProjectSettingsPath(context.projectPath)) ||
    ".linghun/settings.json";

  // 简洁确认：只说明用户选择的状态，不列举所有可能性
  if (level === "trusted") {
    return context.language === "en-US"
      ? `✓ Workspace set to trusted, saved to ${path}`
      : `✓ 工作区已设为 trusted，已保存到 ${path}`;
  }

  return context.language === "en-US"
    ? `✓ Workspace remains restricted, saved to ${path}. Writes and commands require approval.`
    : `✓ 工作区保持 restricted，已保存到 ${path}。写入和命令需要额外确认。`;
}

export function formatPendingApprovalDetails(
  approval: PendingLocalApproval,
  context: TuiContext,
): string {
  if (approval.kind === "index_ignore_write") {
    return context.language === "en-US"
      ? [
          "Pending permission details",
          "- action: update index ignore file, then refresh the index",
          `- file: ${approval.plan.path}`,
          `- entries: ${approval.plan.missingEntries.length}`,
          "- raw content, tokens, request ids, and internal gate ids are hidden.",
          "- next: yes/confirm to allow once; no/cancel/Esc to deny.",
        ].join("\n")
      : [
          "待确认权限详情",
          "- 动作：更新索引 ignore 文件，然后刷新索引",
          `- 文件：${approval.plan.path}`,
          `- 条目数量：${approval.plan.missingEntries.length}`,
          "- raw content、token、request id 和内部 gate id 已隐藏。",
          "- 下一步：yes/确认 允许一次；no/cancel/Esc 拒绝。",
        ].join("\n");
  }
  if (approval.kind === "architecture_drift") {
    const warnings = approval.warnings?.map((item) => truncateDisplay(item, 120)).join("；") || "-";
    return context.language === "en-US"
      ? [
          "Pending permission details",
          `- tool: ${approval.toolName}`,
          `- reason: agreed scope would change (${warnings})`,
          "- tool input, tokens, request ids, and internal gate ids are hidden.",
          "- next: yes/confirm to allow once; no/cancel/Esc to deny.",
        ].join("\n")
      : [
          "待确认权限详情",
          `- 工具：${approval.toolName}`,
          `- 原因：会改变已约定范围（${warnings}）`,
          "- tool input、token、request id 和内部 gate id 已隐藏。",
          "- 下一步：yes/确认 允许一次；no/cancel/Esc 拒绝。",
        ].join("\n");
  }
  if (approval.kind === "git_worktree_remove") {
    return context.language === "en-US"
      ? [
          "Pending confirmation: remove managed worktree",
          `- worktree: ${approval.name}`,
          `- mode: ${approval.strong ? "force (dirty — uncommitted changes will be lost)" : "clean"}`,
          "- action: git worktree remove (no branch deletion, no rm -rf).",
          "- raw path, tokens, request ids, and internal ids are hidden.",
          "- next: yes/confirm to remove once; no/cancel/Esc to keep it.",
        ].join("\n")
      : [
          "待确认：删除 managed worktree",
          `- worktree：${approval.name}`,
          `- 方式：${approval.strong ? "强制（有未提交改动，将丢失）" : "干净"}`,
          "- 动作：git worktree remove（不删分支，不 rm -rf）。",
          "- raw 路径、token、request id 和内部 id 已隐藏。",
          "- 下一步：yes/确认 删除一次；no/cancel/Esc 保留。",
        ].join("\n");
  }
  if (approval.kind === "git_stable_point") {
    return context.language === "en-US"
      ? [
          "Pending confirmation: create stable point",
          "- action: git commit (tracked changes) or Linghun snapshot (untracked-only/clean)",
          "- sensitive/ignored files are never committed; dirty/path/secret boundaries still apply.",
          "- raw paths, tokens, request ids, and internal ids are hidden.",
          "- next: yes/confirm to create once; no/cancel/Esc to skip (no commit/snapshot).",
        ].join("\n")
      : [
          "待确认：创建稳定点",
          "- 动作：git commit（已跟踪改动）或 Linghun snapshot（仅未跟踪/干净）",
          "- 敏感/ignored 文件不会被提交；dirty/path/secret 边界仍生效。",
          "- raw 路径、token、request id 和内部 id 已隐藏。",
          "- 下一步：yes/确认 创建一次；no/cancel/Esc 跳过（不创建 commit/snapshot）。",
        ].join("\n");
  }
  if (approval.kind === "index_tool") {
    const action = approval.indexAction === "repair" ? "repair" : "refresh";
    return context.language === "en-US"
      ? [
          "Pending permission details",
          `- action: index ${action} (rebuild the codebase index, reusing the controlled /index ${action} path)`,
          "- this writes the index artifact and runs the external index runtime.",
          "- raw paths, tokens, request ids, and internal gate ids are hidden.",
          "- next: yes/confirm to allow once; no/cancel/Esc to deny.",
        ].join("\n")
      : [
          "待确认权限详情",
          `- 动作：索引${action === "repair" ? "修复" : "刷新"}（重建代码索引，复用受控的 /index ${action} 路径）`,
          "- 该操作会写入索引产物并运行外部索引 runtime。",
          "- raw 路径、token、request id 和内部 gate id 已隐藏。",
          "- 下一步：yes/确认 允许一次；no/cancel/Esc 拒绝。",
        ].join("\n");
  }
  if (approval.kind === "agent_tool_use") {
    return context.language === "en-US"
      ? [
          "Pending agent permission details",
          `- agent: ${approval.agentId}`,
          `- tool: ${approval.toolName}`,
          "- reason: child agent requested a protected tool; parent approval is required.",
          "- tool input, tokens, request ids, and internal gate ids are hidden.",
          "- next: yes/confirm to allow once; no/cancel/Esc to deny.",
        ].join("\n")
      : [
          "待确认 agent 权限详情",
          `- agent：${approval.agentId}`,
          `- 工具：${approval.toolName}`,
          "- 原因：子 agent 请求受保护工具，需要父会话确认。",
          "- tool input、token、request id 和内部 gate id 已隐藏。",
          "- 下一步：yes/确认 允许一次；no/cancel/Esc 拒绝。",
        ].join("\n");
  }
  return context.language === "en-US"
    ? [
        "Pending permission details",
        `- tool: ${"toolName" in approval ? approval.toolName : "tool"}`,
        "- reason: protected tool requires approval before running",
        "- tool input, tokens, request ids, and internal gate ids are hidden.",
        "- next: yes/confirm to allow once; no/cancel/Esc to deny.",
      ].join("\n")
    : [
        "待确认权限详情",
        `- 工具：${"toolName" in approval ? approval.toolName : "tool"}`,
        "- 原因：受保护工具运行前需要审批",
        "- tool input、token、request id 和内部 gate id 已隐藏。",
        "- 下一步：yes/确认 允许一次；no/cancel/Esc 拒绝。",
      ].join("\n");
}

export function formatPendingNaturalCommandDetails(
  gate: PendingNaturalCommand,
  context: TuiContext,
): string {
  if (gate.capabilityId === "trust") {
    return context.language === "en-US"
      ? [
          "Workspace trust details",
          "- If trusted, Linghun can read, edit, and run commands in the current directory.",
          "- Start Gate, Plan approval, and the permission pipeline still apply.",
          "- /trust remains an advanced recovery/status entry, not the normal user path.",
          "- Yes continues to the safe confirmation path; No/Esc cancels.",
        ].join("\n")
      : [
          "工作区信任详情",
          "- 信任后 Linghun 可以在当前目录读、改、运行命令。",
          "- Start Gate、Plan approval 和 permission pipeline 仍然生效。",
          "- /trust 仍是高级恢复/状态入口，不是普通用户主路径。",
          "- Yes 继续进入安全确认路径；No/Esc 取消。",
        ].join("\n");
  }
  return context.language === "en-US"
    ? [
        "Pending Start Gate details",
        `- command: ${gate.exactCommand}`,
        `- risk: ${gate.risk}`,
        `- scope: ${gate.scope}`,
        `- confirmation: ${gate.requiresExactConfirmation ? "exact command required" : "yes/confirm or /enter allowed"}`,
        "- raw schema, keys, tokens, and internal gate ids are hidden.",
        "- next: confirm as shown, or /esc to cancel.",
      ].join("\n")
    : [
        "待确认 Start Gate 详情",
        `- 命令：${gate.exactCommand}`,
        `- 风险：${gate.risk}`,
        `- 范围：${gate.scope}`,
        `- 确认方式：${gate.requiresExactConfirmation ? "需要输入精确命令" : "可用 yes/确认 或 /enter"}`,
        "- raw schema、key、token 和内部 gate id 已隐藏。",
        "- 下一步：按提示确认，或输入 /esc 取消。",
      ].join("\n");
}
