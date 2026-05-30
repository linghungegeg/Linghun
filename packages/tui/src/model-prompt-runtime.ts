import type { TuiContext } from "./index.js";
import { createSolutionCompletenessStatus, formatSolutionCompletenessTrigger, inferSolutionCompletenessImpactAreas, projectRuntimeStatusForPrompt } from "./model-loop-runtime.js";
import { createModelCapabilitySummary } from "./natural-command-bridge.js";
import { hasRepeatedPermissionDenial } from "./permission-continuation-runtime.js";
import { formatDeferredToolsSystemReminder, snapshotDeferredTools } from "./deferred-tools-catalog.js";
import { truncateDisplay } from "./startup-runtime.js";
import { formatControlledMemoryForModel } from "./tui-memory-runtime.js";
const MEMORY_PROMPT_TOP_K = 3;

export function createModelSystemPrompt(
  text: string,
  context: TuiContext,
  runtimeStatus: unknown,
  architectureDirective?: string,
  // D.14G — 最小 WorktreeContext 投影（已 redacted，不含 provider/baseUrl）。
  // 由 sendMessage 异步计算后传入；undefined 时不注入。
  worktreeContextSummary?: Record<string, unknown> | null,
  // D.14B — 紧凑 FailureLearningSummary（已脱敏，不含 secret/baseUrl/长路径/sourceRef 内部）。
  // 只投影当前项目少量 active 高价值教训；null/undefined 时不注入。
  failureLearningSummary?: { count: number; text: string } | null,
): string {
  const solutionCompletenessWarning = updateSolutionCompletenessGate(text, context);
  // D.13I：仅当 deferred 列表非空时注入 SearchExtraTools/ExecuteExtraTool 提示。built-in
  // 工具继续直接调用；不暴露 raw schema/secret/参数，仅提示发现-执行两步约束。
  const deferredReminder = formatDeferredToolsSystemReminder(
    context.language,
    snapshotDeferredTools(context),
  );
  const worktreeContextLine =
    worktreeContextSummary && worktreeContextSummary.isWorktree === true
      ? `\nWorktreeContext=${JSON.stringify(worktreeContextSummary)}`
      : "";
  // D.14B — FailureLearningSummary 是历史风险提示，不是已发生/已修复事实，不构成 completion evidence。
  const failureLearningLine =
    failureLearningSummary && failureLearningSummary.count > 0
      ? `\nFailureLearningSummary=${failureLearningSummary.text}\nFailureLearningRule=These are lessons from PAST real failures in this project, surfaced as risk hints only. They do NOT mean the current task has failed, is fixed, or is verified. Use them to double-check risky steps; never cite them as evidence that something is already done/fixed/verified. Say "history shows / may be related", not present-tense facts.`
      : "";
  return `${
    context.language === "en-US"
      ? "You are Linghun, a coding assistant with tool-use capabilities. Answer in English by default unless the user explicitly requests another language. Use evidence before code claims; avoid unverified claims. Natural command execution is decided by local RuntimeStatus and Command Capability Catalog, not by guessing. Use real tool_use events when file/search/edit/bash/todo facts or actions are needed; never describe a tool call as text instead of using a tool event."
      : "你是 Linghun 工程型中文助手，具备工具调用能力。默认用中文回答，除非用户明确指定其他语言。涉及代码事实必须先有证据，避免未验证断言。自然语言命令是否可执行由本地 RuntimeStatus 与 Command Capability Catalog 裁决，不能靠模型猜。需要文件、搜索、编辑、Bash 或 Todo 事实/动作时必须使用真实 tool_use 事件，不要用文本冒充工具调用。"
  }\n${
    context.language === "en-US"
      ? "OutputStyle=summary-first; use plain language on main screen, minimize internal jargon; error messages should suggest next steps; details/debug reserved for advanced info. Default mature engineering for frontend/UI: clear information architecture, responsive layout, complete states (empty/error/loading), readability first."
      : "OutputStyle=summary-first; 主屏用人话、少内部术语；错误提示给下一步；details/debug 保留高级信息。涉及前端/UI 开发时默认要求成熟方案：信息架构清晰、响应式、状态完整（空态/错误态/加载态）、可读性优先，不需要用户额外说\u201C成熟\u201D。"
  }\n${
    context.language === "en-US"
      ? "EngineeringStructure=Do not pile logic into existing large files by default. Avoid god files, code blobs, overly long functions (>200 lines), deep nesting (>3 levels), and unbounded global state. Keep responsibility boundaries clear: UI/state/IO/provider/runner/permission/cache/verification. Prefer reusing existing project modules, helpers, presenters, and runtimes over creating a second system. Do not add zero-benefit abstractions for elegance. Each change must have a verifiable boundary (focused tests, typecheck, check). This is not authorization for large refactors."
      : "EngineeringStructure=默认不把逻辑堆进已有大文件。避免 god file、code blob、超长函数（>200行）、深层嵌套（>3层）、无边界全局状态。职责边界保持清晰：UI/状态/IO/provider/runner/permission/cache/verification。优先复用项目已有模块、helper、presenter、runtime，不新建第二套系统。不为了优雅新增无收益抽象。每个改动要有可验证边界（focused tests、typecheck、check）。这不是授权大重构。"
  }\nRuntimeIdentityRule=When the user asks in natural language about the current model (e.g. "what model are you", "current model"), answer with the model name only (for example "claude-opus-4-7"). Do not include provider, endpointProfile, route role, baseUrl, or any internal route field in the user-facing answer; do not write "(provider: ...)" or "openai-compatible" in parentheses. Only reveal provider/route/endpointProfile when the user explicitly asks about provider/route/endpoint, or runs /model doctor or /model route doctor. RuntimeStatusForModel does not contain provider/baseUrl/endpointProfile by default; they live in /model doctor.\nRuntimeStatusForModel=${JSON.stringify(projectRuntimeStatusForPrompt(runtimeStatus) ?? runtimeStatus)}\nControlledMemorySummary=${formatControlledMemoryForModel(context)}\nMemoryBoundary=acceptedOnly; topK=${MEMORY_PROMPT_TOP_K}; noAutoLearning; noAutoAccept; doNotWriteLongTermMemoryWithoutExplicitMemoryAccept\nEvidenceSummary=${createEvidenceSummaryForModel(context)}\nFreshnessRule=When stating external/current facts (latest API version, prices, news, official site state) without web_source evidence in EvidenceSummary, mark them as unverified or call WebSearch/WebFetch first; do not present them as confirmed.\nSolutionCompleteness=${JSON.stringify(context.solutionCompleteness)}${solutionCompletenessWarning ? `\n${solutionCompletenessWarning}` : ""}${architectureDirective ? `\n${architectureDirective}` : ""}${deferredReminder ? `\nDeferredToolsReminder=${deferredReminder}` : ""}${worktreeContextLine}${failureLearningLine}\nCommandCapabilitySummary=\n${createModelCapabilitySummary(24)}`;
}



export function createEvidenceSummaryForModel(context: TuiContext): string {
  return JSON.stringify(
    context.evidence.slice(0, 5).map((item) => ({
      id: item.id,
      kind: item.kind,
      source: item.source,
      summary: truncateDisplay(item.summary.replace(/\s+/g, " "), 180),
      supportsClaims: item.supportsClaims.slice(0, 5),
    })),
  );
}



export function updateSolutionCompletenessGate(text: string, context: TuiContext): string {
  const userRequestedGate =
    /成品级|不要缝|不要补丁|不要只补|先看\s*ccb|参考\s*ccb|对照\s*ccb|对照成熟项目|全局|有没有漏|系统性|完整性|solution completeness/i.test(
      text,
    );
  const smokeContamination = /smoke.*(污染|contaminat)|真实\s*smoke.*(污染|失真)/i.test(text);
  const auditFinding =
    /(verifier|审计|audit).*(文字补丁|regex|正则|只改文档)|文字补丁|regex\s*补丁|只改文档/i.test(
      text,
    );
  const repeatedDenial = hasRepeatedPermissionDenial(context.permissions.recentDenied);
  if (repeatedDenial) {
    context.solutionCompleteness = {
      ...createSolutionCompletenessStatus(),
      triggerReason: "repeated_denial",
      evidenceRefs: collectSolutionCompletenessEvidenceRefs(context),
      nextRequiredOutput:
        "最近同类权限拒绝已记录；普通任务继续走 model/tool loop，必要时给短 hint 或让用户查看 /permissions recent。",
    };
  }
  if (!userRequestedGate && !smokeContamination && !auditFinding) {
    if (!repeatedDenial) {
      context.solutionCompleteness = createSolutionCompletenessStatus();
    }
    return "";
  }

  const triggerReason = userRequestedGate
    ? "user_request"
    : smokeContamination
      ? "smoke_contamination"
      : "audit_finding";
  const impactAreas = inferSolutionCompletenessImpactAreas(text, triggerReason);
  const classification = "unknown";
  const severity = "unknown";
  const requiredBeforeAction = true;
  const nextRequiredOutput =
    "先给 single_issue/systemic_gap 判断；若 systemic_gap，再列影响面、P0/P1/P2、阶段边界、验证方式和当前阶段/后续登记。";
  const warning = [
    "SYSTEMIC_GAP_WARNING:",
    formatSolutionCompletenessTrigger(triggerReason),
    "回答或修复前必须先判断 single_issue / systemic_gap。",
    `impactAreas=${impactAreas.join(",") || "unknown"}`,
    `severity=${severity}`,
    "必须列出：影响面、P0/P1/P2、阶段边界、验证方式。",
    "若属于当前批准范围外内容，只登记到后续路线图或 not-do，不要扩大实现范围。",
  ].join(" ");
  context.solutionCompleteness = {
    triggered: true,
    triggerReason,
    classificationRequired: true,
    classification,
    impactAreas,
    severity,
    requiredBeforeAction,
    evidenceRefs: collectSolutionCompletenessEvidenceRefs(context),
    sourceRefs: [
      "LINGHUN_IMPLEMENTATION_SPEC.md#11.6",
      "LINGHUN_CCB_MATURITY_COMPARISON_REPORT.md#14",
      "docs/delivery/phase-15-natural-command-bridge.md",
    ],
    nextRequiredOutput,
    checklist: ["single_issue/systemic_gap", "影响面", "P0/P1/P2", "阶段边界", "验证方式"],
    lastWarning: warning,
  };
  return warning;
}



export function collectSolutionCompletenessEvidenceRefs(context: TuiContext): string[] {
  const evidence = context.evidence.slice(0, 3).map((item) => item.id);
  const denied = context.permissions.recentDenied
    .slice(0, 3)
    .map((item) => `permission_denial:${item.toolName}:${item.mode}`);
  return [...evidence, ...denied];
}


