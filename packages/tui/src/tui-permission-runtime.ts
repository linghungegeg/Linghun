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
  recordMetaOrchestrationRuntimeEvent,
} from "./meta-orchestration-runtime.js";
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
import {
  currentRequestUserActionConstraints,
  type UserActionConstraints,
} from "./user-action-constraints.js";

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
   * Set when the policy engine short-circuited to any auto-allow path.
   */
  autoAllowPolicy?: PolicyVerdict;
  /**
   * D.13Q-UX Closure: 为非 auto-allow 路径也附带 PolicyVerdict（semantic /
   * pathSafety / redactedSummary / reason），让 PermissionPanel 可以用真实
   * engine 决策渲染 explanationLines，而不是 toolName 简化推断。
   */
  verdict?: PolicyVerdict;
  architectureDrift?: PermissionArchitectureDriftSignal;
};

export type PermissionArchitectureDriftSignal = {
  warnings: string[];
};

export type PermissionDecisionOptions = {
  architectureDrift?: PermissionArchitectureDriftSignal;
  permissionMode?: PermissionMode;
  userActionConstraints?: UserActionConstraints;
};

export type AddAllowRuleResult =
  | { kind: "added"; rule: PermissionRule; message: string }
  | { kind: "duplicate"; rule: PermissionRule; message: string }
  | { kind: "invalid"; message: string }
  | { kind: "save_failed"; error: Error; message: string };

async function recordPermissionOrchestration(
  context: TuiContext,
  sessionId: string,
  input: {
    status: "consumed" | "completed" | "blocked" | "failed" | "degraded";
    summary: string;
    level?: "info" | "warning";
  },
): Promise<void> {
  await recordMetaOrchestrationRuntimeEvent(context, sessionId, {
    stepId: "permission-gate",
    executor: "permission-runtime",
    status: input.status,
    summary: input.summary,
    level: input.level,
  });
}

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

const FILE_WRITE_TOOL_NAMES = new Set<ToolName>(["Write", "Edit", "MultiEdit"]);
const WRITE_SEMANTICS = new Set<PolicyVerdict["semantic"]>(["mutating", "destructive", "install"]);

function currentUserConstraintDenyReason(
  name: ToolName,
  verdict: PolicyVerdict,
  constraints: UserActionConstraints | undefined,
  language: TuiContext["language"],
): string | undefined {
  if (!constraints) return undefined;
  if (constraints.forbidAllTools) {
    return language === "en-US"
      ? "The current user turn explicitly forbids using tools; the permission layer blocked this tool call."
      : "本轮用户明确要求不要使用工具，权限管道已阻止本次工具调用。";
  }
  if (constraints.forbidShell && name === "Bash") {
    return language === "en-US"
      ? "The current user turn explicitly forbids running shell commands; the permission layer blocked Bash."
      : "本轮用户明确要求不要执行命令，权限管道已阻止 Bash。";
  }
  if (
    (constraints.forbidWrite || constraints.readonlyOnly) &&
    (FILE_WRITE_TOOL_NAMES.has(name) || WRITE_SEMANTICS.has(verdict.semantic))
  ) {
    return language === "en-US"
      ? "The current user turn explicitly forbids writing or modifying files; the permission layer blocked this mutating tool call."
      : "本轮用户明确要求不要写入或修改文件，权限管道已阻止本次变更类工具调用。";
  }
  return undefined;
}

export async function decidePermission(
  name: ToolName,
  input: unknown,
  context: TuiContext,
  _sessionId: string,
  options: PermissionDecisionOptions = {},
): Promise<PermissionCheck> {
  const effectivePermissionMode = options.permissionMode ?? context.permissionMode;
  const effectiveConstraints =
    "userActionConstraints" in options
      ? options.userActionConstraints
      : currentRequestUserActionConstraints(context);
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
    mode: effectivePermissionMode,
    risk: tool.permission.risk,
    summary: formatPermissionSummary(name, files, tool.permission.risk),
    files,
    reason: tool.permission.reason,
  };
  await recordPermissionOrchestration(context, _sessionId, {
    status: "consumed",
    summary: `${name}; mode=${effectivePermissionMode}; risk=${tool.permission.risk}`,
  });
  // D.13Q-UX Closure: 始终算一次 verdict 用于 UI 解释行（即使 auto-allow 不命中）。
  // engine 是纯函数，调用便宜；后续任何 ask/deny 分支返回时都附带 verdict，
  // 让 PermissionPanel 能用真实 semantic / pathSafety / redactedSummary 渲染。
  const verdict = classifyToolRequest({
    toolName: name,
    input,
    workspaceRoot: context.projectPath,
  });

  const constraintDenyReason = currentUserConstraintDenyReason(
    name,
    verdict,
    effectiveConstraints,
    context.language,
  );
  if (constraintDenyReason) {
    await recordPermissionDenied(context, name, constraintDenyReason, effectivePermissionMode);
    await recordPermissionOrchestration(context, _sessionId, {
      status: "failed",
      summary: `${name}; current user constraint deny`,
      level: "warning",
    });
    return { request, decision: "deny", reason: constraintDenyReason, verdict };
  }
  if (hardDeny) {
    await recordPermissionDenied(context, name, hardDeny, effectivePermissionMode);
    await recordPermissionOrchestration(context, _sessionId, {
      status: "failed",
      summary: `${name}; hard deny: ${hardDeny}`,
      level: "warning",
    });
    return { request, decision: "deny", reason: hardDeny, verdict };
  }
  if (toolPermission.behavior === "deny") {
    await recordPermissionDenied(context, name, toolPermission.reason, effectivePermissionMode);
    await recordPermissionOrchestration(context, _sessionId, {
      status: "failed",
      summary: `${name}; tool policy deny: ${toolPermission.reason}`,
      level: "warning",
    });
    return { request, decision: "deny", reason: toolPermission.reason, verdict };
  }
  const rule = findPermissionRule(context.permissions.rules, name, tool.permission.risk);
  if (rule?.effect === "deny") {
    const reason = "命中拒绝规则。";
    await recordPermissionDenied(context, name, reason, effectivePermissionMode);
    await recordPermissionOrchestration(context, _sessionId, {
      status: "failed",
      summary: `${name}; rule deny`,
      level: "warning",
    });
    return { request, decision: "deny", reason, verdict };
  }
  if (rule?.effect === "ask") {
    const reason = "命中需确认规则。需要用户确认后才会执行本次工具。";
    await recordPermissionDenied(context, name, reason, effectivePermissionMode);
    await recordPermissionOrchestration(context, _sessionId, {
      status: "blocked",
      summary: `${name}; rule ask`,
      level: "warning",
    });
    return { request, decision: "ask", reason, verdict };
  }
  if (toolPermission.behavior === "allow" && !rule) {
    return { request, decision: "allow", reason: toolPermission.reason, verdict };
  }

  // 哲学模块 1.3：权限引擎读取调度决策，预加热写入确认。
  const schedulerDecision = context.lastMetaSchedulerDecision;
  if (schedulerDecision?.policyDecision.permissionPlan.requireExplicitGate && verdict.semantic === "mutating") {
    if (effectivePermissionMode === "default") {
      await recordPermissionOrchestration(context, _sessionId, {
        status: "blocked",
        summary: `${name}; scheduler explicit mutating gate`,
        level: "warning",
      });
      return {
        request,
        decision: "ask",
        reason:
          context.language === "en-US"
            ? "Scheduler expects mutating actions this turn; confirmation required."
            : "调度器预测本轮有写入操作，需要确认。",
        verdict,
      };
    }
  }

  // D.13N — policy engine auto_allow_readonly short-circuit.
  // Runs *after* hard-deny and *before* rule / mode policy so the engine can
  // widen the implicit allow surface for safe readonly Bash / Read calls
  // without bypassing user-configured deny rules. Engine itself never auto-
  // denies; conservative path is `require_permission`, which falls through
  // here unchanged so the existing decision tree owns the `ask` / `allow` /
  // `deny` outcome. auto-review intentionally handles the same readonly verdict
  // in its own branch after explicit rules, so user rules still win there too.
  if (effectivePermissionMode !== "plan" && effectivePermissionMode !== "auto-review") {
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
          autoAllowPolicy: verdict,
          verdict,
        };
      }
    }
  }

  if (effectivePermissionMode === "plan") {
    if (isPlanAllowedTool(name, tool.isReadOnly)) {
      return { request, decision: "allow", reason: "Plan 模式允许只读或会话内规划工具。", verdict };
    }
    const reason =
      "Plan 模式禁止写入、编辑和 Bash 执行；请先 /plan accept 确认方案并切回执行模式。";
    await recordPermissionDenied(context, name, reason, effectivePermissionMode);
    await recordPermissionOrchestration(context, _sessionId, {
      status: "failed",
      summary: `${name}; plan mode deny`,
      level: "warning",
    });
    return { request, decision: "deny", reason, verdict };
  }

  if (options.architectureDrift && effectivePermissionMode !== "auto-review") {
    await recordPermissionOrchestration(context, _sessionId, {
      status: "blocked",
      summary: `${name}; architecture drift confirmation required`,
      level: "warning",
    });
    return {
      request,
      decision: "ask",
      reason:
        context.language === "en-US"
          ? `Scope change requires confirmation before this tool use: ${options.architectureDrift.warnings.join("; ")}`
          : `本次工具调用改变约定范围，需要确认后才能执行：${options.architectureDrift.warnings.join("；")}`,
      verdict,
      architectureDrift: options.architectureDrift,
    };
  }

  if (rule?.effect === "allow") {
    return { request, decision: "allow", reason: "命中允许规则。", verdict };
  }

  if (effectivePermissionMode === "full-access") {
    return {
      request,
      decision: "allow",
      reason: "full-access 已由本地用户显式开启，TUI 权限确认已放行。",
      verdict,
      architectureDrift: options.architectureDrift,
    };
  }

  if (toolPermission.behavior === "allow") {
    return { request, decision: "allow", reason: toolPermission.reason, verdict };
  }

  if (effectivePermissionMode === "auto-review") {
    // Policy engine shortcuts take priority even in auto-review.
    if (verdict.decision === "auto_allow_readonly" || verdict.decision === "auto_allow_development") {
      return {
        request,
        decision: "allow",
        reason:
          verdict.decision === "auto_allow_readonly"
            ? `auto-review 放行安全只读动作：${verdict.reason}`
            : `auto-review 放行常规开发动作：${verdict.reason}`,
        autoAllowReadonly: verdict.decision === "auto_allow_readonly" ? verdict : undefined,
        autoAllowPolicy: verdict,
        verdict,
        architectureDrift: options.architectureDrift,
      };
    }
    // Only non-readonly high-risk actions still ask in auto-review.
    if (tool.permission.risk === "high") {
      const reason =
        "auto-review 已放行常规操作，但本次动作涉及高风险，需确认。";
      await recordPermissionOrchestration(context, _sessionId, {
        status: "blocked",
        summary: `${name}; auto-review high-risk ask`,
        level: "warning",
      });
      return { request, decision: "ask", reason, verdict };
    }
    const reason = "auto-review 放行非高风险操作。";
    return {
      request,
      decision: "allow",
      reason,
      verdict,
      architectureDrift: options.architectureDrift,
    };
  }

  if (tool.isReadOnly || name === "Todo" || name === "Diff") {
    return { request, decision: "allow", reason: "default 模式允许只读或会话内工具。", verdict };
  }
  const reason =
    "default 模式不会静默执行 Bash、写入、编辑、删除、配置、安装、联网或权限变更；需要用户确认后才会执行本次工具。";
  await recordPermissionDenied(context, name, reason, effectivePermissionMode);
  await recordPermissionOrchestration(context, _sessionId, {
    status: "blocked",
    summary: `${name}; default mode ask`,
    level: "warning",
  });
  return { request, decision: "ask", reason, verdict };
}

export async function recordPermissionDenied(
  context: TuiContext,
  toolName: ToolName,
  reason: string,
  permissionMode: PermissionMode = context.permissionMode,
): Promise<void> {
  context.permissions.recentDenied.unshift({
    id: randomUUID(),
    toolName,
    mode: permissionMode,
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
