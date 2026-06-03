import {
  formatDeferredToolsSystemReminder,
  snapshotDeferredTools,
} from "./deferred-tools-catalog.js";
import type { TuiContext } from "./index.js";
import {
  createSolutionCompletenessStatus,
  projectRuntimeStatusForPrompt,
} from "./model-loop-runtime.js";
import { createModelCapabilitySummary } from "./natural-command-bridge.js";
import { hasRepeatedPermissionDenial } from "./permission-continuation-runtime.js";
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
  }\n${
    context.language === "en-US"
      ? "ShellEnvironment=Respect the actual local OS and shell before proposing or running Bash commands. On Windows/PowerShell, prefer PowerShell cmdlets or Node one-liners for file discovery/transforms; do not use Unix-only pipelines such as find|sed|head unless those tools were verified in this environment."
      : "ShellEnvironment=执行或建议 Bash 命令前必须尊重当前本地 OS 和 shell。Windows/PowerShell 下优先使用 PowerShell cmdlet 或 Node one-liner 做文件发现/转换；除非已验证当前环境存在这些工具，不要使用 find|sed|head 这类 Unix-only 管线。"
  }\nRuntimeIdentityRule=When the user asks in natural language about the current model (e.g. "what model are you", "current model"), answer with the model name only (for example "claude-opus-4-7"). Do not include provider, endpointProfile, route role, baseUrl, or any internal route field in the user-facing answer; do not write "(provider: ...)" or "openai-compatible" in parentheses. Only reveal provider/route/endpointProfile when the user explicitly asks about provider/route/endpoint, or runs /model doctor or /model route doctor. RuntimeStatusForModel does not contain provider/baseUrl/endpointProfile by default; they live in /model doctor.\nPromptHygieneRule=The labelled context fields below (RuntimeStatusForModel, ControlledMemorySummary, MemoryBoundary, EvidenceSummary, CommandCapabilitySummary, SolutionCompleteness, FreshnessRule, FailureLearningSummary, etc.) are internal runtime context for your reasoning only. Never quote, paste, or restate these field labels or their raw contents to the user — not even when asked to "explain in plain words" or "translate". Answer in natural human language; if the user wants raw runtime/diagnostic detail, point them to /model doctor, /status, or /details.\nRuntimeStatusForModel=${JSON.stringify(projectRuntimeStatusForPrompt(runtimeStatus) ?? runtimeStatus)}\nControlledMemorySummary=${formatControlledMemoryForModel(context)}\nMemoryBoundary=acceptedOnly; topK=${MEMORY_PROMPT_TOP_K}; noAutoLearning; noAutoAccept; doNotWriteLongTermMemoryWithoutExplicitMemoryAccept\nEvidenceSummary=${createEvidenceSummaryForModel(context)}\nFreshnessRule=When stating external/current facts (latest API version, prices, news, official site state) without web_source evidence in EvidenceSummary, mark them as unverified or call WebSearch/WebFetch first; do not present them as confirmed.\nSolutionCompleteness=${JSON.stringify(context.solutionCompleteness)}${solutionCompletenessWarning ? `\n${solutionCompletenessWarning}` : ""}${architectureDirective ? `\n${architectureDirective}` : ""}${deferredReminder ? `\nDeferredToolsReminder=${deferredReminder}` : ""}${worktreeContextLine}${failureLearningLine}\nCommandCapabilitySummary=\n${createModelCapabilitySummary(24)}`;
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
  void text;
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
  if (!repeatedDenial) {
    context.solutionCompleteness = createSolutionCompletenessStatus();
  }
  return "";
}

export function collectSolutionCompletenessEvidenceRefs(context: TuiContext): string[] {
  const evidence = context.evidence.slice(0, 3).map((item) => item.id);
  const denied = context.permissions.recentDenied
    .slice(0, 3)
    .map((item) => `permission_denial:${item.toolName}:${item.mode}`);
  return [...evidence, ...denied];
}

// D.14D — 内部 system-prompt 字段标签。这些是注入给模型的运行时上下文键，
// 不应被模型原样复述到主屏（例如用户说"翻译成人话/解释一下"时）。
const INTERNAL_PROMPT_TOKENS = [
  "RuntimeStatusForModel",
  "RuntimeIdentityRule",
  "ControlledMemorySummary",
  "MemoryBoundary",
  "EvidenceSummary",
  "CommandCapabilitySummary",
  "SolutionCompleteness",
  "SYSTEMIC_GAP_WARNING",
  "FreshnessRule",
  "FailureLearningSummary",
  "FailureLearningRule",
  "WorktreeContext",
  "DeferredToolsReminder",
  "OutputStyle",
  "EngineeringStructure",
  "ShellEnvironment",
  "doNotWriteLongTermMemoryWithoutExplicitMemoryAccept",
] as const;

/**
 * D.14D — main-screen prompt hygiene sanitizer。
 *
 * 在 assistant final/main-screen 文本入主屏前调用。如果模型把内部 system-prompt
 * 字段（RuntimeStatusForModel=... / ControlledMemorySummary=... 等）原样复述出来，
 * 把命中的"Token=<内容>"或"Token: <内容>"整行降级为一条人话提示，避免把内部
 * 运行时上下文 token 泄漏到主屏。
 *
 * 设计约束：
 *   - 只处理"内部字段标签 + 紧随的赋值/JSON dump"这种明确泄漏形态，不误伤普通
 *     正文里偶然出现的同名英文单词（必须带 `=` 或 `:` 且后面有内容）。
 *   - 不删除 doctor/details 诊断能力——这些字段仍可经 /model doctor、/details 显式查看；
 *     这里只清理 **assistant 主屏正文** 的泄漏。
 *   - 纯函数、可单测；不依赖 context。
 */
export function sanitizeMainScreenLeakage(
  text: string,
  language: "zh-CN" | "en-US" = "zh-CN",
): string {
  if (!text) return text;
  const tokenAlternation = INTERNAL_PROMPT_TOKENS.join("|");
  // 命中 "Token=..." 或 "Token: ..."（行内或多行 JSON dump 的起始行）。
  const lineRe = new RegExp(`^\\s*(?:${tokenAlternation})\\s*[=:].*$`, "u");
  const naturalLanguageLeakRe = new RegExp(`\\b(?:${tokenAlternation})\\b`, "u");
  const lines = text.split("\n");
  let redacted = false;
  const cleaned = lines.filter((line) => {
    if (lineRe.test(line) || naturalLanguageLeakRe.test(line)) {
      redacted = true;
      return false;
    }
    return true;
  });
  // doNotWriteLongTermMemoryWithoutExplicitMemoryAccept 这类裸 token（无 =）也清掉。
  let result = cleaned.join("\n");
  for (const token of INTERNAL_PROMPT_TOKENS) {
    if (result.includes(token)) {
      result = result.split(token).join("");
      redacted = true;
    }
  }
  result = result.replace(/\n{3,}/gu, "\n\n").trim();
  if (!redacted) return text;
  const note =
    language === "en-US"
      ? "(Internal runtime context was omitted from the main screen; use /model doctor or /details to inspect it.)"
      : "（内部运行时上下文已从主屏省略；需要时用 /model doctor 或 /details 查看。）";
  return result.length > 0 ? `${result}\n${note}` : note;
}
