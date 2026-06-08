// Module 3: tui-permission-runtime
// Pure permission policy + persistence helpers extracted from
// packages/tui/src/index.ts as part of the D.13 mechanical split.
// Behavior is unchanged. Coordinators that depend on i18n (`t`),
// ensureSession, executeIndexIgnoreWritePlan, runIndexRepository,
// executeApprovedModelToolUse, continueModelAfterToolResults, evidence
// recorders, writeLine/writeStatus/writeLightHints stay in index.ts to
// avoid cross-module circular dependencies (Path A safety valve #2).
//
// What moved here:
//   - PermissionCheck type
//   - AddAllowRuleResult type
//   - addAllowRule (pure: only mutates context.permissions + persistence)
//   - decidePermission (pure: policy decision; calls recordPermissionDenied)
//   - recordPermissionDenied (pure: only mutates context.permissions + persistence)
//   - loadPermissionState / savePermissionState / permissionStatePath
//   - toPermissionPromptView (pure projection)
//
// All consumers continue to import via "../index.js"; index.ts re-exports
// the symbols below and also imports them value-side for internal callers.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PermissionMode } from "@linghun/shared";
import { type ToolName, builtInTools } from "@linghun/tools";
import type { TuiContext } from "./index.js";
import {
  type PermissionRule,
  type PermissionState,
  collectInputFiles,
  findPermissionRule,
  formatDiffBeforeWrite,
  formatPermissionSummary,
  getHardDenyReason,
  isLowRiskWorkspaceEdit,
  isPlanAllowedTool,
} from "./permission-continuation-runtime.js";
import { type PolicyVerdict, classifyToolRequest } from "./permission-policy-engine.js";

export type PermissionCheck = {
  request: {
    id: string;
    toolName: ToolName;
    mode: PermissionMode;
    risk: "low" | "medium" | "high";
    summary: string;
    files: string[];
    reason: string;
  };
  decision: "allow" | "ask" | "deny";
  reason: string;
  preflight?: string;
  /**
   * Set when the policy engine short-circuited to auto_allow_readonly.
   * Caller (executeModelToolUse) emits a `permission_auto_allow_readonly`
   * event and can use the verdict to render an explainer line.
   */
  autoAllowReadonly?: PolicyVerdict;
  /**
   * D.13Q-UX Closure: 为非 auto-allow 路径也附带 PolicyVerdict（semantic /
   * pathSafety / redactedSummary / reason），让 PermissionPanel 可以用真实
   * engine 决策渲染 explanationLines，而不是 toolName 简化推断。
   */
  verdict?: PolicyVerdict;
};

export type AddAllowRuleResult =
  | { kind: "added"; rule: PermissionRule; message: string }
  | { kind: "duplicate"; rule: PermissionRule; message: string }
  | { kind: "invalid"; message: string }
  | { kind: "save_failed"; error: Error; message: string };

export async function addAllowRule(
  context: TuiContext,
  toolName: ToolName | "*",
  risk: PermissionRule["risk"] | undefined,
): Promise<AddAllowRuleResult> {
  // 1. 校验工具名
  if (toolName !== "*" && !(toolName in builtInTools)) {
    return { kind: "invalid", message: `未知工具：${toolName}` };
  }
  // 2. 去重（与 PermissionElevationModel.hasExistingAllowRule 同语义）：
  //    - effect 必须是 allow
  //    - toolName 精确匹配，或既有规则是 "*" 通配（umbrella tool）
  //    - 既有规则 risk 为空（umbrella risk）视为覆盖任意 risk；否则要求精确匹配
  //    这样 add allow Bash 之后再 add allow Bash high 应被识别为 duplicate，
  //    避免与 buildElevationOptions 看到 alreadyAllowed=true 时隐藏 allow_always_tool
  //    的判断不一致。
  const existing = context.permissions.rules.find((r) => {
    if (r.effect !== "allow") return false;
    if (r.toolName !== toolName && r.toolName !== "*") return false;
    if (r.risk && r.risk !== risk) return false;
    return true;
  });
  if (existing) {
    return {
      kind: "duplicate",
      rule: existing,
      message: `已存在等价 allow 规则：${existing.id} allow ${existing.toolName}${existing.risk ? ` ${existing.risk}` : ""}`,
    };
  }
  // 3. push + persist；失败则回滚
  const rule: PermissionRule = { id: randomUUID(), effect: "allow", toolName, risk };
  context.permissions.rules.push(rule);
  try {
    await savePermissionState(context.projectPath, context.permissions);
  } catch (error) {
    context.permissions.rules = context.permissions.rules.filter((r) => r.id !== rule.id);
    return {
      kind: "save_failed",
      error: error as Error,
      message: `保存权限规则失败：${(error as Error).message}`,
    };
  }
  return {
    kind: "added",
    rule,
    message: `已添加权限规则：${rule.id} allow ${toolName}${risk ? ` ${risk}` : ""}`,
  };
}

export function toPermissionPromptView(permission: PermissionCheck) {
  return {
    toolName: permission.request.toolName,
    decision: permission.decision,
    risk: permission.request.risk,
    mode: permission.request.mode,
    reason: permission.reason,
    scope: permission.request.files,
  };
}

export async function decidePermission(
  name: ToolName,
  input: unknown,
  context: TuiContext,
  _sessionId: string,
): Promise<PermissionCheck> {
  const tool = builtInTools[name];
  const files = collectInputFiles(input);
  const toolPermission = (() => {
    try {
      return tool.checkPermissions(tool.validateInput(input), context.tools);
    } catch {
      return {
        behavior: "passthrough" as const,
        reason: "tool input validation is handled by the tool runtime",
      };
    }
  })();
  const hardDeny = getHardDenyReason(name, input, files, context.projectPath);
  const request = {
    id: randomUUID(),
    toolName: name,
    mode: context.permissionMode,
    risk: tool.permission.risk,
    summary: formatPermissionSummary(name, files, tool.permission.risk),
    files,
    reason: tool.permission.reason,
  };
  if (hardDeny) {
    await recordPermissionDenied(context, name, hardDeny);
    return { request, decision: "deny", reason: hardDeny };
  }
  if (toolPermission.behavior === "deny") {
    await recordPermissionDenied(context, name, toolPermission.reason);
    return { request, decision: "deny", reason: toolPermission.reason };
  }
  if (toolPermission.behavior === "allow") {
    return { request, decision: "allow", reason: toolPermission.reason };
  }

  // D.13Q-UX Closure: 始终算一次 verdict 用于 UI 解释行（即使 auto-allow 不命中）。
  // engine 是纯函数，调用便宜；后续任何 ask/deny 分支返回时都附带 verdict，
  // 让 PermissionPanel 能用真实 semantic / pathSafety / redactedSummary 渲染。
  const verdict = classifyToolRequest({
    toolName: name,
    input,
    workspaceRoot: context.projectPath,
  });

  // D.13N — policy engine auto_allow_readonly short-circuit.
  // Runs *after* hard-deny and *before* rule / mode policy so the engine can
  // widen the implicit allow surface for safe readonly Bash / Read calls
  // without bypassing user-configured deny rules. Engine itself never auto-
  // denies; conservative path is `require_permission`, which falls through
  // here unchanged so the existing decision tree owns the `ask` / `allow` /
  // `deny` outcome. auto-review intentionally handles the same readonly verdict
  // in its own branch after explicit rules, so user rules still win there too.
  if (context.permissionMode !== "plan" && context.permissionMode !== "auto-review") {
    if (verdict.decision === "auto_allow_readonly") {
      // Honor explicit deny/ask rules even for readonly tools — never override
      // a user-configured decision boundary.
      const existingRule = findPermissionRule(context.permissions.rules, name, tool.permission.risk);
      if (!existingRule) {
        return {
          request,
          decision: "allow",
          reason: `policy auto_allow_readonly: ${verdict.reason}`,
          autoAllowReadonly: verdict,
          verdict,
        };
      }
    }
  }

  if (context.permissionMode === "plan") {
    if (isPlanAllowedTool(name, tool.isReadOnly)) {
      return { request, decision: "allow", reason: "Plan 模式允许只读或会话内规划工具。", verdict };
    }
    const reason =
      "Plan 模式禁止写入、编辑和 Bash 执行；请先 /plan accept 确认方案并切回执行模式。";
    await recordPermissionDenied(context, name, reason);
    return { request, decision: "deny", reason, verdict };
  }

  const rule = findPermissionRule(context.permissions.rules, name, tool.permission.risk);
  if (rule) {
    if (rule.effect === "deny") {
      // D.13Q-UX：reason 不再拼 rule.id（randomUUID）。user-facing 文案稳定，
      // 内部 rule.id 仍可在 system event log / details debug 区追踪。
      const reason = "命中拒绝规则。";
      await recordPermissionDenied(context, name, reason);
      return { request, decision: "deny", reason, verdict };
    }
    if (rule.effect === "ask") {
      const reason = "命中需确认规则。需要用户确认后才会执行本次工具。";
      await recordPermissionDenied(context, name, reason);
      return { request, decision: "ask", reason, verdict };
    }
    return { request, decision: "allow", reason: "命中允许规则。", verdict };
  }

  if (context.permissionMode === "auto-review") {
    if (verdict.decision === "auto_allow_readonly") {
      return {
        request,
        decision: "allow",
        reason: `auto-review 允许安全只读动作：${verdict.reason}`,
        autoAllowReadonly: verdict,
        verdict,
      };
    }
    if (isLowRiskWorkspaceEdit(name, tool.permission.risk, files)) {
      return {
        request,
        decision: "allow",
        reason: "auto-review 自动允许工作区内普通文件编辑。",
        preflight: formatDiffBeforeWrite(name, files, tool.permission.risk),
        verdict,
      };
    }
    if (tool.isReadOnly || name === "Todo" || name === "Diff") {
      return { request, decision: "allow", reason: "auto-review 允许只读或会话内工具。", verdict };
    }
    const reason =
      "auto-review 仅自动放行安全只读动作和低风险工作区编辑；写入、非只读 Bash、安装、联网或权限变更仍需确认，硬拒绝和路径安全仍由权限底座处理。";
    return { request, decision: "ask", reason, verdict };
  }

  if (context.permissionMode === "full-access") {
    return {
      request,
      decision: "allow",
      reason: "full-access 已由本地用户显式开启，但硬拒绝和安全路径仍生效。",
      verdict,
    };
  }

  if (tool.isReadOnly || name === "Todo" || name === "Diff") {
    return { request, decision: "allow", reason: "default 模式允许只读或会话内工具。", verdict };
  }
  const reason =
    "default 模式不会静默执行 Bash、写入、编辑、删除、配置、安装、联网或权限变更；需要用户确认后才会执行本次工具。";
  await recordPermissionDenied(context, name, reason);
  return { request, decision: "ask", reason, verdict };
}

export async function recordPermissionDenied(
  context: TuiContext,
  toolName: ToolName,
  reason: string,
): Promise<void> {
  context.permissions.recentDenied.unshift({
    id: randomUUID(),
    toolName,
    mode: context.permissionMode,
    reason,
    createdAt: new Date().toISOString(),
  });
  context.permissions.recentDenied = context.permissions.recentDenied.slice(0, 20);
  await savePermissionState(context.projectPath, context.permissions);
}

export async function loadPermissionState(projectPath: string): Promise<PermissionState> {
  try {
    const raw = await readFile(permissionStatePath(projectPath), "utf8");
    const parsed = JSON.parse(raw) as Partial<PermissionState>;
    return {
      rules: Array.isArray(parsed.rules) ? parsed.rules : [],
      recentDenied: Array.isArray(parsed.recentDenied) ? parsed.recentDenied : [],
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { rules: [], recentDenied: [] };
    }
    throw error;
  }
}

export async function savePermissionState(
  projectPath: string,
  state: PermissionState,
): Promise<void> {
  await mkdir(join(projectPath, ".linghun"), { recursive: true });
  await writeFile(permissionStatePath(projectPath), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function permissionStatePath(projectPath: string): string {
  return join(projectPath, ".linghun", "permissions.json");
}
