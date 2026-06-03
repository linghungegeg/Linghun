/**
 * model-loop-runtime.ts — Pure model-loop helper functions
 * extracted from index.ts.
 *
 * Contains:
 * - Tool definition helpers (createToolInputSchema, createModelToolDefinitions,
 *   createModelToolDefinitionsForTools, createModelToolDefinitionsForReportGuard)
 * - Drift summary helpers (createToolUseDriftSummary, readToolInputString)
 * - Natural file read pure helpers (isNaturalReadFileRequest, hasModelSynthesisIntent,
 *   looksLikeFilePath, extractNaturalReadPath, normalizeRelativePath,
 *   extractFileSearchKeywords, matchesFileKeywords, extractFileMentions,
 *   formatFileCandidates)
 * - Solution completeness pure helpers (createSolutionCompletenessStatus,
 *   inferSolutionCompletenessImpactAreas, formatSolutionCompletenessTrigger)
 *
 * Hard boundary: no sendMessage, no provider stream loop, no TuiContext state machine,
 * no store/session writes, no gateway calls, no permission state machine.
 *
 * D.13Q-UX Closure: 删除了过度设计的 FreshnessLite regex gate。
 * 反幻觉边界已下沉到 system prompt + evidence rule（"外部当前事实没有
 * web_source 证据时不得断言"），不在用户输入侧用关键词正则猜中文/英文语义。
 */

import type { ModelToolDefinition } from "@linghun/providers";
import type { Language } from "@linghun/shared";
import { type ToolName, builtInTools } from "@linghun/tools";

import { createGitToolDefinitions } from "./git-tool-runtime.js";
import { createIndexToolDefinitions } from "./index-tool-runtime.js";
import type { ReportWriteGuard } from "./permission-continuation-runtime.js";
import type { EvidenceRecord } from "./tui-data-types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SolutionCompletenessClassification = "single_issue" | "systemic_gap" | "unknown";

export type SolutionCompletenessSeverity =
  | "P0"
  | "blocking_P1"
  | "P1"
  | "P2"
  | "later"
  | "not_do"
  | "unknown";

export type SolutionCompletenessStatus = {
  triggered: boolean;
  triggerReason:
    | "none"
    | "user_request"
    | "repeated_denial"
    | "smoke_contamination"
    | "audit_finding";
  classificationRequired: boolean;
  classification: SolutionCompletenessClassification;
  impactAreas: string[];
  severity: SolutionCompletenessSeverity;
  requiredBeforeAction: boolean;
  evidenceRefs: string[];
  sourceRefs: string[];
  nextRequiredOutput: string;
  checklist: string[];
  lastWarning?: string;
};

// ---------------------------------------------------------------------------
// Tool definition helpers
// ---------------------------------------------------------------------------

export function createToolInputSchema(name: ToolName): unknown {
  const base = { type: "object", additionalProperties: false } as const;
  if (name === "Read") {
    return {
      ...base,
      properties: {
        path: { type: "string" },
        offset: { type: "number" },
        limit: { type: "number" },
      },
      required: ["path"],
    };
  }
  if (name === "Write") {
    return {
      ...base,
      properties: {
        path: { type: "string" },
        content: { type: "string" },
        expectedHash: { type: "string" },
      },
      required: ["path", "content"],
    };
  }
  if (name === "Edit") {
    return {
      ...base,
      properties: {
        path: { type: "string" },
        oldText: { type: "string" },
        newText: { type: "string" },
        expectedHash: { type: "string" },
      },
      required: ["path", "oldText", "newText"],
    };
  }
  if (name === "MultiEdit") {
    return {
      ...base,
      properties: {
        path: { type: "string" },
        expectedHash: { type: "string" },
        edits: {
          type: "array",
          items: {
            type: "object",
            properties: {
              oldText: { type: "string" },
              newText: { type: "string" },
            },
            required: ["oldText", "newText"],
            additionalProperties: false,
          },
        },
      },
      required: ["path", "edits"],
    };
  }
  if (name === "Grep") {
    return {
      ...base,
      properties: {
        pattern: { type: "string" },
        path: { type: "string" },
        limit: { type: "number" },
      },
      required: ["pattern"],
    };
  }
  if (name === "Glob") {
    return {
      ...base,
      properties: {
        pattern: { type: "string" },
        path: { type: "string" },
        limit: { type: "number" },
      },
      required: ["pattern"],
    };
  }
  if (name === "Bash") {
    return {
      ...base,
      properties: {
        command: { type: "string" },
        timeoutMs: { type: "number" },
      },
      required: ["command"],
    };
  }
  if (name === "Todo") {
    return {
      ...base,
      properties: {
        action: {
          type: "string",
          enum: ["list", "add", "start", "done", "block"],
        },
        content: { type: "string" },
        id: { type: "string" },
        evidence: { type: "string" },
      },
      required: ["action"],
    };
  }
  return {
    ...base,
    properties: { files: { type: "array", items: { type: "string" } } },
  };
}

// D.13I：Self-built deferred tools。两个固定 schema 工具，进入 toolSchemaHash 时排序稳定。
// 不发 Anthropic defer_loading / tool_reference / anthropic-beta；只是 Linghun 自己的两个常规工具。
// 动态发现的 MCP/skill/plugin 列表不进 toolSchemaHash，进 deferredToolListHash。
export const SEARCH_EXTRA_TOOLS_NAME = "SearchExtraTools" as const;
export const EXECUTE_EXTRA_TOOL_NAME = "ExecuteExtraTool" as const;
export const COMMAND_PROPOSAL_TOOL_NAME = "CommandProposal" as const;
export const START_AGENT_TOOL_NAME = "StartAgent" as const;
export const SEND_MESSAGE_TOOL_NAME = "SendMessage" as const;
export const RUN_WORKFLOW_TOOL_NAME = "RunWorkflow" as const;
export const INDEX_OPERATION_TOOL_NAME = "IndexOperation" as const;
export const RUN_VERIFICATION_TOOL_NAME = "RunVerification" as const;
export const WRITE_REPORT_TOOL_NAME = "WriteReport" as const;

export const SEARCH_EXTRA_TOOLS_DESCRIPTION =
  "Discover deferred tools provided by enabled MCP servers, trusted skills, trusted plugins, and codebase-memory. Returns name/kind/description/requiredArgs/executable/reason for each match. Pass a free-text query to filter; pass empty string to list all. Use ExecuteExtraTool to actually invoke a discovered tool.";

export const EXECUTE_EXTRA_TOOL_DESCRIPTION =
  "Invoke a deferred tool that was previously returned by SearchExtraTools with executable=true. Built-in tools (Read/Edit/Write/Bash/Grep/Glob/Todo) MUST be called directly, not via this wrapper. tool_name must match a discovered tool exactly; params must include all required args.";

export const COMMAND_PROPOSAL_DESCRIPTION =
  "Fallback only: propose an explicit Linghun slash command when the requested capability cannot be executed by an available structured tool. Do not use this as the default path for agent, workflow, index, verification, or report-writing requests.";

export const START_AGENT_DESCRIPTION =
  "Start a real Linghun agent runtime for user requests such as multi-agent work, explorer/planner/worker/verifier delegation, or /fork-style role work. Supports addressable name/team, safe cwd/worktree isolation, and true background launch. Runs through validation, start/background guard, permission pipeline, sidechain transcript, evidence, and final agent status.";

export const SEND_MESSAGE_DESCRIPTION =
  "Send a text message to a running Linghun agent or team by id/name/team. The message enters the target agent mailbox and transcript; fail closed if no running target is found.";

export const RUN_WORKFLOW_DESCRIPTION =
  "Run a real Linghun workflow for requests such as splitting work into a workflow or executing workflow steps. Emits workflow start/step/result/failure events and returns completed/partial/blocked status with evidence refs.";

export const INDEX_OPERATION_DESCRIPTION =
  "Run a real Linghun index operation for requests such as inspect index status, refresh index, initialize fast index, or repair index ignore rules. Mutating operations use the existing permission pipeline.";

export const RUN_VERIFICATION_DESCRIPTION =
  "Run Linghun Verification Runner for requests such as run verification, typecheck, tests, build, lint, or smoke checks. Uses the existing verification runtime and records evidence.";

export const WRITE_REPORT_DESCRIPTION =
  "Write a report or controlled file using Linghun's real Write/Edit permission pipeline. Use for requests that explicitly ask to write a report file; do not answer as if a report was written without this tool result.";

export function createSearchExtraToolsInputSchema(): unknown {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      query: { type: "string" },
    },
    required: ["query"],
  };
}

export function createExecuteExtraToolInputSchema(): unknown {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      tool_name: { type: "string" },
      params: { type: "object", additionalProperties: true },
    },
    required: ["tool_name"],
  };
}

export function createCommandProposalInputSchema(): unknown {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      command: { type: "string" },
      reason: { type: "string" },
    },
    required: ["command", "reason"],
  };
}

export function createStartAgentInputSchema(): unknown {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      role: { type: "string", enum: ["explorer", "planner", "worker", "verifier"] },
      subagent_type: { type: "string" },
      task: { type: "string" },
      name: { type: "string" },
      teamName: { type: "string" },
      team_name: { type: "string" },
      runInBackground: { type: "boolean" },
      run_in_background: { type: "boolean" },
      cwd: { type: "string" },
      isolation: { type: "string", enum: ["worktree"] },
    },
    required: ["task"],
  };
}

export function createSendMessageInputSchema(): unknown {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      to: { type: "string" },
      name: { type: "string" },
      team: { type: "string" },
      teamName: { type: "string" },
      team_name: { type: "string" },
      message: { type: "string" },
    },
    required: ["message"],
  };
}

export function createRunWorkflowInputSchema(): unknown {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      goal: { type: "string" },
      workflowId: { type: "string" },
      workflow_id: { type: "string" },
      inputs: { type: "object", additionalProperties: true },
      runInBackground: { type: "boolean" },
      run_in_background: { type: "boolean" },
    },
  };
}

export function createIndexOperationInputSchema(): unknown {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      action: { type: "string", enum: ["inspect", "refresh", "init_fast", "repair"] },
      force: { type: "boolean" },
    },
    required: ["action"],
  };
}

export function createRunVerificationInputSchema(): unknown {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      level: {
        type: "string",
        enum: ["smoke", "focused", "typecheck", "test", "build", "lint"],
      },
    },
    required: ["level"],
  };
}

export function createWriteReportInputSchema(): unknown {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      path: { type: "string" },
      content: { type: "string" },
      expectedHash: { type: "string" },
    },
    required: ["path", "content"],
  };
}

export function createDeferredToolDispatchDefinitions(): ModelToolDefinition[] {
  return [
    {
      name: SEARCH_EXTRA_TOOLS_NAME,
      description: SEARCH_EXTRA_TOOLS_DESCRIPTION,
      inputSchema: createSearchExtraToolsInputSchema(),
    },
    {
      name: EXECUTE_EXTRA_TOOL_NAME,
      description: EXECUTE_EXTRA_TOOL_DESCRIPTION,
      inputSchema: createExecuteExtraToolInputSchema(),
    },
  ];
}

export function createModelToolDefinitions(): ModelToolDefinition[] {
  // D.13I：full-tool 模式才附加 deferred dispatch（SearchExtraTools / ExecuteExtraTool）；
  // reportGuard 受限子集走 createModelToolDefinitionsForTools，不附加。
  // D.14G：full-tool 模式附加结构化 Git 能力（stable point / status / managed worktree），
  // 让模型需要执行 Git 时调用真实工具，而不是靠本地自然语言 regex 拦截。
  return [
    ...createModelToolDefinitionsForTools(
      Object.values(builtInTools) as (typeof builtInTools)[ToolName][],
    ),
    ...createDeferredToolDispatchDefinitions(),
    {
      name: START_AGENT_TOOL_NAME,
      description: START_AGENT_DESCRIPTION,
      inputSchema: createStartAgentInputSchema(),
    },
    {
      name: SEND_MESSAGE_TOOL_NAME,
      description: SEND_MESSAGE_DESCRIPTION,
      inputSchema: createSendMessageInputSchema(),
    },
    {
      name: RUN_WORKFLOW_TOOL_NAME,
      description: RUN_WORKFLOW_DESCRIPTION,
      inputSchema: createRunWorkflowInputSchema(),
    },
    {
      name: INDEX_OPERATION_TOOL_NAME,
      description: INDEX_OPERATION_DESCRIPTION,
      inputSchema: createIndexOperationInputSchema(),
    },
    {
      name: RUN_VERIFICATION_TOOL_NAME,
      description: RUN_VERIFICATION_DESCRIPTION,
      inputSchema: createRunVerificationInputSchema(),
    },
    {
      name: WRITE_REPORT_TOOL_NAME,
      description: WRITE_REPORT_DESCRIPTION,
      inputSchema: createWriteReportInputSchema(),
    },
    ...createGitToolDefinitions(),
    // D.14D-R P0-2 — 结构化索引能力：模型需要"看索引 / 更新索引"时调用真实工具，
    // 而不是文本冒充执行，也不是本地 NL 正则；mutating 刷新/修复走权限确认。
    ...createIndexToolDefinitions(),
    {
      name: COMMAND_PROPOSAL_TOOL_NAME,
      description: COMMAND_PROPOSAL_DESCRIPTION,
      inputSchema: createCommandProposalInputSchema(),
    },
  ];
}

export function createModelToolDefinitionsForTools(
  tools: (typeof builtInTools)[ToolName][],
): ModelToolDefinition[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: createToolInputSchema(tool.name),
  }));
}

export function createModelToolDefinitionsForReportGuard(
  guard: ReportWriteGuard | undefined,
): ModelToolDefinition[] {
  if (!guard || guard.completed) {
    return createModelToolDefinitions();
  }
  if (!guard.evidenceRead) {
    return createModelToolDefinitionsForTools([
      builtInTools.Read,
      builtInTools.Grep,
      builtInTools.Glob,
    ]);
  }
  if (guard.nonWriteToolRounds < 1) {
    return createModelToolDefinitionsForTools(
      (Object.values(builtInTools) as (typeof builtInTools)[ToolName][]).filter(
        (tool) => tool.name !== "Bash",
      ),
    );
  }
  return createModelToolDefinitionsForTools([builtInTools.Write]);
}

// ---------------------------------------------------------------------------
// Drift summary helpers
// ---------------------------------------------------------------------------

export function createToolUseDriftSummary(toolName: ToolName, input: unknown): string {
  const path = readToolInputString(input, "path") ?? readToolInputString(input, "file_path");
  if ((toolName === "Write" || toolName === "Edit" || toolName === "MultiEdit") && path) {
    return `${toolName}: ${path}`;
  }
  return `${toolName}: ${JSON.stringify(input ?? {})}`;
}

export function readToolInputString(input: unknown, key: string): string | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

// ---------------------------------------------------------------------------
// Freshness pure helpers — D.13Q-UX Closure: 已删除
// ---------------------------------------------------------------------------
//
// 旧的 needsFreshnessLiteBoundary / formatFreshnessLitePrimaryWarning 是过度
// 设计的"普通输入 regex gate"：用 /最新|当前|今天|now|version|.../ 关键词
// 误伤普通中英文输入（"当前分支""now"），并把"未验证"提示硬追加到 assistant
// 末尾，污染 transcript。
//
// 反幻觉边界改放在 system prompt + evidence rule：
// - 模型自己负责决定是否调 WebSearch / WebFetch；
// - 没有 web_source 证据的"外部当前事实"在 system prompt 里规定不能断言；
// - 本地事实（git/branch、文件、配置）走本地工具证据，不需要 web_source。

// ---------------------------------------------------------------------------
// Natural file read pure helpers
// ---------------------------------------------------------------------------

export function isNaturalReadFileRequest(text: string): boolean {
  return /(?:\u8bfb|\u8bfb\u53d6|\u6253\u5f00|\u770b\u770b|\u67e5\u770b|show|read|open|view)\s*(?:\u4e00\u4e0b|\u4e0b)?/iu.test(
    text,
  );
}

export function hasModelSynthesisIntent(text: string): boolean {
  return /\u603b\u7ed3|\u6458\u8981|\u5206\u6790|\u89e3\u91ca|\u5f52\u7eb3|summary|summari[sz]e|analy[sz]e|explain/iu.test(
    text,
  );
}

export function looksLikeFilePath(value: string): boolean {
  return /[\\/]/u.test(value) || /\.[a-z0-9]{1,12}$/iu.test(value);
}

export function extractNaturalReadPath(text: string): string | null {
  const quoted =
    /["\u2018\u2019\u201c\u201d'`]([^"\u2018\u2019\u201c\u201d'`]+)["\u2018\u2019\u201c\u201d'`]/u.exec(
      text,
    )?.[1];
  if (quoted && looksLikeFilePath(quoted)) {
    return normalizeRelativePath(quoted);
  }

  const token = text
    .split(/\s+/)
    .map((item) => item.replace(/[\uff0c\u3002,.!?\uff1b;\uff1a:\uff09)]+$/u, ""))
    .find(looksLikeFilePath);
  return token ? normalizeRelativePath(token) : null;
}

export function normalizeRelativePath(path: string): string {
  return path.trim().replaceAll("\\", "/").replace(/^\.\//u, "");
}

export function extractFileSearchKeywords(text: string): string[] {
  return text
    .replace(/["\u2018\u2019\u201c\u201d'`]/gu, " ")
    .split(/[^\p{L}\p{N}_.-]+/u)
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length >= 2)
    .filter(
      (item) =>
        ![
          "read",
          "open",
          "view",
          "show",
          "file",
          "the",
          "this",
          "that",
          "previous",
          "recent",
          "\u8bfb\u53d6",
          "\u6253\u5f00",
          "\u67e5\u770b",
          "\u770b\u770b",
          "\u6587\u4ef6",
          "\u8fd9\u4e2a",
          "\u521a\u624d",
          "\u4e0a\u9762",
          "\u6700\u8fd1",
        ].includes(item),
    );
}

export function matchesFileKeywords(file: string, keywords: string[]): boolean {
  if (keywords.length === 0) {
    return false;
  }
  const normalized = file.toLowerCase();
  const name = normalized.split("/").pop() ?? normalized;
  return keywords.some((keyword) => normalized.includes(keyword) || name.includes(keyword));
}

export function extractFileMentions(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.split(":")[0]?.trim() ?? "")
    .filter((line) => /[\\/]|\.[a-z0-9]+$/iu.test(line))
    .map((line) => line.replaceAll("\\", "/"));
}

export function formatFileCandidates(candidates: string[], language: Language): string {
  const lines = candidates.map((candidate) => `- ${candidate}`);
  return language === "en-US"
    ? [
        "Multiple files match that request. Please choose one with an explicit command:",
        ...lines,
        "Example: /read <path>",
      ].join("\n")
    : [
        "\u627e\u5230\u591a\u4e2a\u53ef\u80fd\u6587\u4ef6\uff0c\u8bf7\u7528\u660e\u786e\u547d\u4ee4\u9009\u62e9\u4e00\u4e2a\uff1a",
        ...lines,
        "\u793a\u4f8b\uff1a/read <path>",
      ].join("\n");
}

// ---------------------------------------------------------------------------
// Solution completeness pure helpers
// ---------------------------------------------------------------------------

export function createSolutionCompletenessStatus(): SolutionCompletenessStatus {
  return {
    triggered: false,
    triggerReason: "none",
    classificationRequired: false,
    classification: "unknown",
    impactAreas: [],
    severity: "unknown",
    requiredBeforeAction: false,
    evidenceRefs: [],
    sourceRefs: [],
    nextRequiredOutput: "none",
    checklist: [],
  };
}

export function inferSolutionCompletenessImpactAreas(
  text: string,
  triggerReason: SolutionCompletenessStatus["triggerReason"],
): string[] {
  const areas = new Set<string>();
  const lower = text.toLowerCase();
  if (
    /ccb|opencode|\u6210\u719f\u9879\u76ee|\u5bf9\u7167|\u5168\u5c40|\u7cfb\u7edf\u6027|\u5b8c\u6574\u6027/u.test(
      lower,
    )
  ) {
    areas.add("reference_parity");
    areas.add("runtime_behavior");
  }
  if (
    /\u6743\u9650|permission|denial|\u62d2\u7edd/u.test(lower) ||
    triggerReason === "repeated_denial"
  ) {
    areas.add("permission_pipeline");
    areas.add("tool_loop");
  }
  if (
    /smoke|tui|\u4ea4\u4e92|\u624b\u611f|\u6c61\u67d3|\u5931\u771f/u.test(lower) ||
    triggerReason === "smoke_contamination"
  ) {
    areas.add("tui_smoke");
    areas.add("natural_command_bridge");
  }
  if (
    /\u6587\u5b57\u8865\u4e01|regex|\u6b63\u5219|\u53ea\u6539\u6587\u6863|verifier|\u5ba1\u8ba1|audit/u.test(
      lower,
    )
  ) {
    areas.add("implementation_scope");
    areas.add("verification");
  }
  return [...areas];
}

export function formatSolutionCompletenessTrigger(
  triggerReason: SolutionCompletenessStatus["triggerReason"],
): string {
  if (triggerReason === "user_request") {
    return "\u7528\u6237\u660e\u786e\u8981\u6c42\u6210\u54c1\u7ea7/\u4e0d\u8981\u7f1d\u8865/\u5148\u5bf9\u7167\u6210\u719f\u53c2\u8003/\u5168\u5c40\u68c0\u67e5\u9057\u6f0f\u3002";
  }
  if (triggerReason === "smoke_contamination") {
    return "\u771f\u5b9e smoke \u5df2\u51fa\u73b0\u6c61\u67d3\u6216\u4ea4\u4e92\u5931\u771f\u3002";
  }
  if (triggerReason === "audit_finding") {
    return "verifier/\u5ba1\u8ba1\u6307\u51fa\u6587\u5b57\u8865\u4e01\u3001regex \u8865\u4e01\u6216\u53ea\u6539\u6587\u6863\u98ce\u9669\u3002";
  }
  if (triggerReason === "repeated_denial") {
    return "\u6700\u8fd1\u540c\u7c7b\u6743\u9650\u62d2\u7edd\u53cd\u590d\u51fa\u73b0\u3002";
  }
  return "\u672a\u89e6\u53d1\u3002";
}

// ---------------------------------------------------------------------------
// D.13U \u2014 Final Answer Claim Gate pure helpers
// ---------------------------------------------------------------------------
//
// \u8bbe\u8ba1\u539f\u5219\uff08\u4e0d\u6062\u590d FreshnessLite\uff09\uff1a
// - \u4e0d\u5728\u7528\u6237\u8f93\u5165\u4fa7\u505a\u5173\u952e\u8bcd\u62e6\u622a\uff08"\u5f53\u524d/\u6700\u65b0/\u4eca\u5929/now/\u9a8c\u8bc1"\uff09\u3002
// - \u53ea\u5728\u6700\u7ec8 assistantText \u5165 transcript \u524d\u5bf9"\u9ad8\u98ce\u9669\u58f0\u660e"\u505a\u8bc1\u636e\u5339\u914d\u3002
// - claim \u7c7b\u578b\u9a71\u52a8 evidence \u7c7b\u578b\uff1b\u4e0d\u518d `evidence.length > 0` \u4e07\u80fd\u653e\u884c\u3002
// - \u666e\u901a\u8f93\u5165\uff08\u95f2\u804a/\u6982\u5ff5\u89e3\u91ca/\u65b9\u6848\u8ba8\u8bba\uff09\u4e0d\u5e94\u89e6\u53d1\u3002

export type FinalAnswerClaimKind =
  | "completion_claim"
  | "test_claim"
  | "file_change_claim"
  | "verification_claim"
  | "workflow_status_claim"
  | "agent_status_claim"
  | "completion_pass"
  | "code_fact"
  | "external_current_fact"
  | "ccb_parity"
  | "beta_readiness"
  | "git_operation"
  | "action_executed";

export type FinalAnswerClaimMatch = {
  kind: FinalAnswerClaimKind;
  phrase: string;
};

export type FinalAnswerClaimVerdict = {
  status: "passed" | "needs_disclaimer";
  matchedClaims: FinalAnswerClaimMatch[];
  unsupportedKinds: FinalAnswerClaimKind[];
  missingEvidenceKinds: string[];
  // D.13V-A: kinds whose only matching evidence was filtered out as stale.
  // 仅在 status==="needs_disclaimer" 且确有过期证据被忽略时出现；不影响 D.13U 的现有判定语义。
  staleKinds?: FinalAnswerClaimKind[];
};

export const STRUCTURED_FINAL_ANSWER_CLAIM_PREFIX = "LinghunFinalAnswerClaims:";

// D.13V-A — 按 claim 类型分级的 evidence 过期阈值（毫秒）。null 表示不应用过期判断。
// 阈值依据真实工程节奏：
// - completion_pass：测试/构建/typecheck/diff-check/smoke 跑过 30 分钟后，代码可能已被改动，再当 PASS 不安全。
// - code_fact：Read/Grep/index 读到的源码事实，60 分钟后文件可能已变；再当"现在的代码事实"不安全。
// - external_current_fact：web_source 24 小时内变化大；超 24h 不再当"今天最新"。
// - ccb_parity：与文件版本快照绑定，不按时间过期。
// - beta_readiness：由 createPhase15BetaVerdictScope 主管，不在此引入额外 staleness。
const STALE_THRESHOLDS_MS: Record<FinalAnswerClaimKind, number | null> = {
  completion_claim: 30 * 60 * 1000,
  test_claim: 30 * 60 * 1000,
  file_change_claim: 30 * 60 * 1000,
  verification_claim: 30 * 60 * 1000,
  workflow_status_claim: null,
  agent_status_claim: null,
  completion_pass: 30 * 60 * 1000,
  code_fact: 60 * 60 * 1000,
  external_current_fact: 24 * 60 * 60 * 1000,
  ccb_parity: null,
  beta_readiness: null,
  // D.14G：git 稳定点/worktree 操作绑定到本会话真实 git_operation evidence，不按时间过期。
  git_operation: null,
  // Run 2 P1-2：mutating 动作（install/Bash/Write/Edit/index refresh）的"已执行成功"声明，
  // 绑定到本会话真实成功 evidence；执行成功通常 30 分钟内有效，超时按需重新验证。
  action_executed: 30 * 60 * 1000,
};

export function isEvidenceStaleForClaim(
  record: EvidenceRecord,
  kind: FinalAnswerClaimKind,
  now: Date = new Date(),
): boolean {
  const threshold = STALE_THRESHOLDS_MS[kind];
  if (threshold === null) return false;
  const created = Date.parse(record.createdAt);
  if (Number.isNaN(created)) return false;
  return now.getTime() - created > threshold;
}

type ClaimPhraseSpec = {
  kind: FinalAnswerClaimKind;
  phrase: string;
  aliases?: FinalAnswerClaimKind[];
};

const FINAL_ANSWER_CLAIM_KINDS: readonly FinalAnswerClaimKind[] = [
  "completion_claim",
  "test_claim",
  "file_change_claim",
  "verification_claim",
  "workflow_status_claim",
  "agent_status_claim",
  "completion_pass",
  "code_fact",
  "external_current_fact",
  "ccb_parity",
  "beta_readiness",
  "git_operation",
  "action_executed",
];

const LEGACY_TEXT_CLAIM_PHRASES: ClaimPhraseSpec[] = [
  { kind: "completion_claim", phrase: "\u5df2\u5b8c\u6210", aliases: ["completion_pass"] },
  { kind: "completion_claim", phrase: "\u5168\u90e8\u5b8c\u6210", aliases: ["completion_pass"] },
  { kind: "completion_claim", phrase: "\u5df2\u4fee\u590d", aliases: ["completion_pass"] },
  { kind: "completion_claim", phrase: "completed", aliases: ["completion_pass"] },
  { kind: "completion_claim", phrase: "fixed", aliases: ["completion_pass"] },
  { kind: "test_claim", phrase: "\u6d4b\u8bd5\u901a\u8fc7", aliases: ["completion_pass"] },
  { kind: "test_claim", phrase: "tests passed", aliases: ["completion_pass"] },
  { kind: "test_claim", phrase: "test passed", aliases: ["completion_pass"] },
  { kind: "test_claim", phrase: "PASS", aliases: ["completion_pass"] },
  { kind: "verification_claim", phrase: "\u5df2\u9a8c\u8bc1", aliases: ["completion_pass"] },
  { kind: "verification_claim", phrase: "verified", aliases: ["completion_pass"] },
  {
    kind: "completion_claim",
    phrase: "\u6210\u719f\u53ef\u53d1\u5e03",
    aliases: ["completion_pass"],
  },
  { kind: "completion_claim", phrase: "\u65e0\u98ce\u9669", aliases: ["completion_pass"] },
  { kind: "completion_claim", phrase: "\u65e0\u95ee\u9898", aliases: ["completion_pass"] },
  { kind: "completion_claim", phrase: "\u6ca1\u95ee\u9898", aliases: ["completion_pass"] },
  { kind: "completion_claim", phrase: "build passed", aliases: ["completion_pass"] },
  { kind: "completion_claim", phrase: "tsc passed", aliases: ["completion_pass"] },
  { kind: "completion_claim", phrase: "diff-check passed", aliases: ["completion_pass"] },
  { kind: "completion_claim", phrase: "diff check passed", aliases: ["completion_pass"] },
  { kind: "completion_claim", phrase: "smoke-ready", aliases: ["completion_pass"] },
  { kind: "completion_claim", phrase: "release-ready", aliases: ["completion_pass"] },
  {
    kind: "completion_claim",
    phrase: "production-ready",
    aliases: ["completion_pass", "ccb_parity"],
  },
  { kind: "code_fact", phrase: "\u4ee3\u7801\u91cc" },
  { kind: "code_fact", phrase: "\u8c03\u7528\u94fe\u662f" },
  { kind: "code_fact", phrase: "\u5f53\u524d\u5b9e\u73b0\u662f" },
  { kind: "code_fact", phrase: "\u914d\u7f6e\u662f" },
  { kind: "code_fact", phrase: "in the code" },
  { kind: "code_fact", phrase: "call chain is" },
  { kind: "code_fact", phrase: "the config is" },
  { kind: "external_current_fact", phrase: "\u4eca\u5929" },
  { kind: "external_current_fact", phrase: "\u6700\u65b0\u7248\u672c" },
  { kind: "external_current_fact", phrase: "\u6700\u65b0\u6a21\u578b" },
  { kind: "external_current_fact", phrase: "\u5f53\u524d\u5b98\u7f51" },
  { kind: "external_current_fact", phrase: "\u5f53\u524d\u4ef7\u683c" },
  { kind: "external_current_fact", phrase: "\u6700\u65b0\u4ef7\u683c" },
  { kind: "external_current_fact", phrase: "today's" },
  { kind: "external_current_fact", phrase: "current price" },
  { kind: "external_current_fact", phrase: "current version" },
  { kind: "external_current_fact", phrase: "current api" },
  { kind: "external_current_fact", phrase: "current website" },
  { kind: "external_current_fact", phrase: "latest price" },
  { kind: "external_current_fact", phrase: "latest version" },
  { kind: "external_current_fact", phrase: "latest model" },
  { kind: "external_current_fact", phrase: "latest release" },
  { kind: "ccb_parity", phrase: "\u7b49\u4e8e ccb" },
  { kind: "ccb_parity", phrase: "\u4e0e ccb \u4e00\u81f4" },
  { kind: "ccb_parity", phrase: "\u4e0e ccb \u5bf9\u9f50" },
  { kind: "ccb_parity", phrase: "ccb parity" },
  { kind: "beta_readiness", phrase: "beta ready" },
  { kind: "beta_readiness", phrase: "beta readiness" },
  { kind: "beta_readiness", phrase: "beta pass" },
  { kind: "beta_readiness", phrase: "beta completed" },
  { kind: "beta_readiness", phrase: "\u8fdb\u5165 beta" },
  { kind: "git_operation", phrase: "\u5df2\u5efa\u7acb\u7a33\u5b9a\u70b9" },
  { kind: "git_operation", phrase: "\u5df2\u521b\u5efa\u7a33\u5b9a\u70b9" },
  { kind: "git_operation", phrase: "\u5df2\u4fdd\u5b58\u5f53\u524d\u72b6\u6001" },
  { kind: "git_operation", phrase: "\u5df2\u521b\u5efa worktree" },
  { kind: "git_operation", phrase: "\u5df2\u751f\u6210 worktree" },
  { kind: "git_operation", phrase: "\u5df2\u5220\u9664 worktree" },
  { kind: "git_operation", phrase: "worktree created" },
  { kind: "git_operation", phrase: "worktree removed" },
  { kind: "git_operation", phrase: "worktree deleted" },
  { kind: "git_operation", phrase: "stable point created" },
  { kind: "git_operation", phrase: "stable point saved" },
  {
    kind: "file_change_claim",
    phrase: "\u5df2\u6210\u529f\u5199\u5165",
    aliases: ["action_executed"],
  },
  {
    kind: "file_change_claim",
    phrase: "\u5df2\u5199\u5165\u6587\u4ef6",
    aliases: ["action_executed"],
  },
  {
    kind: "file_change_claim",
    phrase: "\u6587\u4ef6\u5df2\u4fee\u6539",
    aliases: ["action_executed"],
  },
  { kind: "file_change_claim", phrase: "file changed", aliases: ["action_executed"] },
  { kind: "file_change_claim", phrase: "file modified", aliases: ["action_executed"] },
  { kind: "file_change_claim", phrase: "file written", aliases: ["action_executed"] },
  { kind: "action_executed", phrase: "\u5df2\u5b89\u88c5" },
  { kind: "action_executed", phrase: "\u5df2\u6210\u529f\u5b89\u88c5" },
  { kind: "action_executed", phrase: "\u5b89\u88c5\u6210\u529f" },
  { kind: "action_executed", phrase: "\u5b89\u88c5\u5b8c\u6210" },
  { kind: "action_executed", phrase: "\u4f9d\u8d56\u5df2\u5b89\u88c5" },
  { kind: "action_executed", phrase: "\u5df2\u6267\u884c" },
  { kind: "action_executed", phrase: "\u5df2\u6210\u529f\u6267\u884c" },
  { kind: "action_executed", phrase: "\u547d\u4ee4\u5df2\u6267\u884c" },
  { kind: "action_executed", phrase: "\u547d\u4ee4\u5df2\u6210\u529f\u6267\u884c" },
  { kind: "action_executed", phrase: "\u547d\u4ee4\u5df2\u8fd0\u884c" },
  { kind: "action_executed", phrase: "\u547d\u4ee4\u5df2\u6210\u529f\u8fd0\u884c" },
  { kind: "action_executed", phrase: "\u7d22\u5f15\u5df2\u5237\u65b0" },
  { kind: "action_executed", phrase: "\u7d22\u5f15\u5df2\u91cd\u5efa" },
  { kind: "action_executed", phrase: "\u5df2\u5237\u65b0\u7d22\u5f15" },
  { kind: "action_executed", phrase: "\u5df2\u91cd\u5efa\u7d22\u5f15" },
  { kind: "action_executed", phrase: "\u751f\u56fe\u7ed3\u679c\u5df2\u843d\u76d8" },
  { kind: "action_executed", phrase: "\u56fe\u7247\u7ed3\u679c\u5df2\u751f\u6210" },
  { kind: "action_executed", phrase: "image result generated" },
  { kind: "action_executed", phrase: "image result saved" },
  { kind: "action_executed", phrase: "successfully installed" },
  { kind: "action_executed", phrase: "successfully ran" },
  { kind: "action_executed", phrase: "successfully executed" },
  { kind: "action_executed", phrase: "index refreshed" },
  { kind: "action_executed", phrase: "index rebuilt" },
  { kind: "workflow_status_claim", phrase: "workflow completed" },
  { kind: "workflow_status_claim", phrase: "workflow done" },
  { kind: "workflow_status_claim", phrase: "\u5de5\u4f5c\u6d41\u5df2\u5b8c\u6210" },
  { kind: "agent_status_claim", phrase: "agent completed" },
  { kind: "agent_status_claim", phrase: "agents completed" },
  { kind: "agent_status_claim", phrase: "multi-agent completed" },
  { kind: "agent_status_claim", phrase: "\u591a agent \u5df2\u5b8c\u6210" },
  { kind: "agent_status_claim", phrase: "\u591a\u667a\u80fd\u4f53\u5df2\u5b8c\u6210" },
];

const LOCAL_CURRENT_PHRASES = [
  "\u5f53\u524d\u5206\u652f",
  "\u5f53\u524d\u76ee\u5f55",
  "\u5f53\u524d\u6587\u4ef6",
  "\u5f53\u524d\u4f1a\u8bdd",
  "\u5f53\u524d\u9879\u76ee",
  "\u5f53\u524d\u5de5\u4f5c\u76ee\u5f55",
  "\u5f53\u524d\u6a21\u5f0f",
  "\u5f53\u524d\u7ec4\u4ef6",
  "\u5f53\u524d\u5b9e\u73b0\u662f",
];

function normalizedClaimText(text: string): string {
  return text.toLocaleLowerCase().replace(/\s+/gu, " ").trim();
}

function findPhraseIndex(text: string, phrase: string): number {
  if (phrase === "PASS") {
    const index = text.indexOf("PASS");
    if (index < 0) return -1;
    const before = text[index - 1] ?? " ";
    const after = text[index + phrase.length] ?? " ";
    if (isAsciiLetterOrDigit(before) || isAsciiLetterOrDigit(after)) return -1;
    return index;
  }
  return normalizedClaimText(text).indexOf(normalizedClaimText(phrase));
}

function isAsciiLetterOrDigit(value: string): boolean {
  const code = value.charCodeAt(0);
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function pushStructuredClaim(
  out: FinalAnswerClaimMatch[],
  seen: Set<string>,
  kind: FinalAnswerClaimKind,
  phrase: string,
): void {
  const key = `${kind}\u0000${phrase}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push({ kind, phrase });
}

// 元讨论检测：文本在解释/讨论系统机制本身（反幻觉、gate、evidence、验证系统等），
// 而非对当前任务做事实声明时，不应触发 completion/code/action 类 claim。
function isMetaDiscussion(text: string): boolean {
  const lowered = normalizedClaimText(text);
  return [
    "\u53cd\u5e7b\u89c9\u7cfb\u7edf",
    "final answer gate",
    "claim gate",
    "evidence",
    "\u8bc1\u636e\u673a\u5236",
    "\u9a8c\u8bc1\u7cfb\u7edf",
    "\u4e0d\u80fd\u8bf4",
    "\u4e0d\u8ba9\u4f60\u8bf4",
    "\u4f1a\u88ab\u62e6\u622a",
    "\u88ab\u964d\u7ea7",
  ].some((phrase) => lowered.includes(normalizedClaimText(phrase)));
}

function isQuotedExample(text: string, index: number, phrase: string): boolean {
  const before = text[index - 1];
  const after = text[index + phrase.length];
  return (
    (before === "'" && after === "'") ||
    (before === '"' && after === '"') ||
    (before === "\u201c" && after === "\u201d") ||
    (before === "\u2018" && after === "\u2019")
  );
}

function isMetaDiscussionExampleMatch(text: string, match: FinalAnswerClaimMatch): boolean {
  if (!isMetaDiscussion(text)) return false;
  const index = text.indexOf(match.phrase);
  if (index < 0) return false;
  const window = text.slice(Math.max(0, index - 60), index + match.phrase.length + 60);
  if (isQuotedExample(text, index, match.phrase)) return true;
  const before = text.slice(Math.max(0, index - 60), index);
  return [
    "\u4f1a\u68c0\u6d4b",
    "\u68c0\u6d4b",
    "\u8bc6\u522b",
    "\u547d\u4e2d",
    "\u62e6\u622a",
    "\u964d\u7ea7",
    "\u4e0d\u80fd\u8bf4",
    "\u4e0d\u8ba9\u4f60\u8bf4",
    "phrases like",
    "detects phrases",
    "detect phrases",
    "requires evidence",
  ].some((phrase) => normalizedClaimText(before).includes(phrase));
}

export function extractStructuredFinalAnswerClaims(text: string): FinalAnswerClaimMatch[] {
  return parseStructuredFinalAnswerClaims(text);
}

export function extractLegacyTextRiskClaims(text: string): FinalAnswerClaimMatch[] {
  if (!text) return [];
  const matches: FinalAnswerClaimMatch[] = [];
  const seen = new Set<string>();
  const localCurrentOnly = LOCAL_CURRENT_PHRASES.some((phrase) =>
    normalizedClaimText(text).includes(normalizedClaimText(phrase)),
  );
  for (const spec of LEGACY_TEXT_CLAIM_PHRASES) {
    if (spec.kind === "external_current_fact" && localCurrentOnly) continue;
    const phraseIndex = findPhraseIndex(text, spec.phrase);
    if (phraseIndex < 0) continue;
    const match = {
      kind: spec.kind,
      phrase: text.slice(phraseIndex, phraseIndex + spec.phrase.length),
    };
    if (isMetaDiscussionExampleMatch(text, match)) continue;
    pushStructuredClaim(matches, seen, spec.kind, match.phrase);
    for (const alias of spec.aliases ?? []) {
      pushStructuredClaim(matches, seen, alias, match.phrase);
    }
  }
  return matches;
}

export function detectHighRiskClaims(text: string): FinalAnswerClaimMatch[] {
  return extractLegacyTextRiskClaims(text);
}

function parseStructuredFinalAnswerClaims(text: string): FinalAnswerClaimMatch[] {
  if (!text) return [];
  const line = text
    .split(/\r?\n/u)
    .map((item) => item.trim())
    .find((item) => item.startsWith(STRUCTURED_FINAL_ANSWER_CLAIM_PREFIX));
  if (!line) return [];
  const payload = line.slice(STRUCTURED_FINAL_ANSWER_CLAIM_PREFIX.length).trim();
  if (!payload) return [];
  try {
    const parsed: unknown = JSON.parse(payload);
    const claims = Array.isArray(parsed)
      ? parsed
      : isPlainRecord(parsed) && Array.isArray(parsed.claims)
        ? parsed.claims
        : [];
    const out: FinalAnswerClaimMatch[] = [];
    const seen = new Set<string>();
    for (const item of claims) {
      if (!isPlainRecord(item)) continue;
      const kind = item.kind;
      if (!isFinalAnswerClaimKind(kind)) continue;
      const phrase =
        typeof item.phrase === "string" && item.phrase.trim() ? item.phrase.trim() : kind;
      pushStructuredClaim(out, seen, kind, phrase);
    }
    return out;
  } catch {
    return [];
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFinalAnswerClaimKind(value: unknown): value is FinalAnswerClaimKind {
  return (
    typeof value === "string" && FINAL_ANSWER_CLAIM_KINDS.includes(value as FinalAnswerClaimKind)
  );
}

export function stripStructuredFinalAnswerClaims(text: string): string {
  if (!text) return text;
  return text
    .split(/\r?\n/u)
    .filter((line) => !line.trim().startsWith(STRUCTURED_FINAL_ANSWER_CLAIM_PREFIX))
    .join("\n")
    .trim();
}

function evidenceTokens(record: EvidenceRecord): string {
  return [record.kind, record.source, record.summary, ...record.supportsClaims]
    .join(" ")
    .toLowerCase();
}

function claimWindow(text: string, phrase: string): string {
  const index = text.indexOf(phrase);
  if (index < 0) return phrase;
  return text.slice(Math.max(0, index - 48), index + phrase.length + 48).toLowerCase();
}

function isTestCompletionClaim(text: string, phrase: string): boolean {
  const lowered = phrase.toLowerCase();
  return /(?:测试|tests?\s+passed|vitest|jest|pytest|go\s+test|cargo\s+test)/iu.test(lowered);
}

function isTypecheckCompletionClaim(text: string, phrase: string): boolean {
  const lowered = phrase.toLowerCase();
  return (
    /(?:typecheck|type\s+check|tsc|类型检查)/iu.test(lowered) ||
    (lowered === "pass" &&
      /(?:typecheck|type\s+check|tsc|类型检查)/iu.test(claimWindow(text, phrase)))
  );
}

function isBuildCompletionClaim(text: string, phrase: string): boolean {
  const lowered = phrase.toLowerCase();
  return (
    /(?:build|构建)/iu.test(lowered) ||
    (lowered === "pass" && /(?:build|构建)/iu.test(claimWindow(text, phrase)))
  );
}

function isDiffCheckCompletionClaim(text: string, phrase: string): boolean {
  const lowered = phrase.toLowerCase();
  return (
    /(?:diff[-\s]?check|git\s+diff\s+--check)/iu.test(lowered) ||
    (lowered === "pass" &&
      /(?:diff[-\s]?check|git\s+diff\s+--check)/iu.test(claimWindow(text, phrase)))
  );
}

function isSmokeCompletionClaim(text: string, phrase: string): boolean {
  const lowered = phrase.toLowerCase();
  return (
    /(?:smoke|冒烟)/iu.test(lowered) ||
    (lowered === "pass" && /(?:smoke|冒烟)/iu.test(claimWindow(text, phrase)))
  );
}

function evidenceSupportsTaskCompletion(record: EvidenceRecord): boolean {
  const tokens = evidenceTokens(record);
  return (
    /(?:task_completed|completion_evidence|任务完成证据)/iu.test(tokens) &&
    /(?:scope[:=]|scope_|范围[:=]|范围_)/iu.test(tokens) &&
    /(?:validation[:=]|validation_|验证[:=]|验证_)/iu.test(tokens) &&
    /(?:remaining[_\s-]?risk[:=]|remaining[_\s-]?risk_|residual[_\s-]?risk[:=]|risk[:=]|剩余风险[:=]|剩余风险_)/iu.test(
      tokens,
    )
  );
}

function evidenceSupportsCommandClaim(
  record: EvidenceRecord,
  claim: "test" | "typecheck" | "build" | "diff_check" | "smoke",
): boolean {
  if (claim === "test") {
    return record.supportsClaims.includes("test_passed");
  }
  if (claim === "typecheck") {
    return record.supportsClaims.includes("typecheck_passed");
  }
  if (claim === "build") {
    return record.supportsClaims.includes("build_passed");
  }
  if (claim === "diff_check") {
    return record.supportsClaims.includes("diff_check_passed");
  }
  return (
    record.supportsClaims.includes("smoke_passed") || record.supportsClaims.includes("smoke_ran")
  );
}

function evidenceSupportsCompletionClaim(
  record: EvidenceRecord,
  text: string,
  match: FinalAnswerClaimMatch,
): boolean {
  if (isTestCompletionClaim(text, match.phrase)) {
    return evidenceSupportsCommandClaim(record, "test");
  }
  if (isTypecheckCompletionClaim(text, match.phrase)) {
    return evidenceSupportsCommandClaim(record, "typecheck");
  }
  if (isBuildCompletionClaim(text, match.phrase)) {
    return evidenceSupportsCommandClaim(record, "build");
  }
  if (isDiffCheckCompletionClaim(text, match.phrase)) {
    return evidenceSupportsCommandClaim(record, "diff_check");
  }
  if (isSmokeCompletionClaim(text, match.phrase)) {
    return evidenceSupportsCommandClaim(record, "smoke");
  }
  return evidenceSupportsTaskCompletion(record);
}

function evidenceSupportsVerificationClaim(record: EvidenceRecord): boolean {
  if (record.kind !== "test_result" && record.kind !== "command_output") return false;
  if (record.supportsClaims.includes("tool_failure")) return false;
  return (
    record.supportsClaims.includes("verification_passed") ||
    record.supportsClaims.includes("test_passed") ||
    record.supportsClaims.includes("typecheck_passed") ||
    record.supportsClaims.includes("build_passed") ||
    record.supportsClaims.includes("diff_check_passed") ||
    record.supportsClaims.includes("smoke_passed")
  );
}

function evidenceSupportsFileChangeClaim(record: EvidenceRecord): boolean {
  if (record.kind !== "command_output") return false;
  if (record.supportsClaims.includes("tool_failure")) return false;
  if (record.supportsClaims.includes("bash_exit_nonzero")) return false;
  return (
    record.supportsClaims.includes("file_written") ||
    record.supportsClaims.includes("Write") ||
    record.supportsClaims.includes("Edit") ||
    record.supportsClaims.includes("MultiEdit")
  );
}

function evidenceSupportsWorkflowStatusClaim(record: EvidenceRecord): boolean {
  if (record.kind !== "command_output") return false;
  if (record.supportsClaims.includes("tool_failure")) return false;
  return (
    record.supportsClaims.includes("workflow_execution") &&
    record.supportsClaims.includes("action_executed")
  );
}

function evidenceSupportsAgentStatusClaim(record: EvidenceRecord): boolean {
  if (record.kind !== "command_output") return false;
  if (record.supportsClaims.includes("tool_failure")) return false;
  return (
    record.supportsClaims.includes("agent_execution") &&
    record.supportsClaims.includes("action_executed")
  );
}

function evidenceSupportsIndexCodeFact(record: EvidenceRecord): boolean {
  if (record.kind !== "index_query") {
    return false;
  }
  if (!record.supportsClaims.includes("index_code_fact")) {
    return false;
  }
  const tokens = evidenceTokens(record);
  if (
    /(?:missing|stale|error|not ready|no matches|status[:=\s]+(?:missing|stale|error))/iu.test(
      tokens,
    )
  ) {
    return false;
  }
  return /(?:\bpath\s*=\s*(?!unknown\b|-)(?:[^\s,;]+)|\bfile_path\s*[:=]\s*(?!unknown\b|-)(?:[^\s,;]+)|\bfile:\s*(?!unknown\b|-)(?:[^\s,;]+)|\bsymbol\s*=\s*(?!unknown\b|-)(?:[^\s,;]+)|\bsnippet\s*=\s*(?!\s*$).+|\bmatch\s*=\s*(?!\s*$).+)/imu.test(
    tokens,
  );
}

export function evidenceSupportsLocalCodeFact(record: EvidenceRecord): boolean {
  if (record.kind === "index_query") {
    return evidenceSupportsIndexCodeFact(record);
  }
  if (record.kind === "file_read" || record.kind === "grep_result") {
    return true;
  }
  const tokens = evidenceTokens(record);
  return /(?:local_read|grep_match|file:|git_local_fact|git_status)/iu.test(tokens);
}

function evidenceSupportsExternalCurrent(record: EvidenceRecord): boolean {
  if (record.kind === "web_source") return true;
  return /(?:web_source|external_current_fact)/iu.test(evidenceTokens(record));
}

function evidenceSupportsCcbParity(record: EvidenceRecord): boolean {
  const tokens = evidenceTokens(record);
  if (/(?:ccb_parity_verified|ccb_audit)/iu.test(tokens)) return true;
  // /ccb-source \u8def\u5f84\u4e0b\u7684 file_read / grep_result \u4e5f\u7b97
  if (
    (record.kind === "file_read" || record.kind === "grep_result") &&
    /ccb-source|\bccb\b/iu.test(tokens)
  ) {
    return true;
  }
  return false;
}

// D.14G\uff1agit \u64cd\u4f5c evidence\u3002recordGitOperationEvidence \u5199\u5165 supportsClaims \u542b
// git_operation \u4e0e\u5177\u4f53\u64cd\u4f5c\u6807\u7b7e\uff08stable_point_created / worktree_created /
// worktree_removed\uff09\uff0c\u4e14\u4ec5\u5728\u771f\u5b9e runtime \u6210\u529f\u6267\u884c\u540e\u5199\u5165\u3002
function evidenceSupportsGitOperation(record: EvidenceRecord): boolean {
  return record.supportsClaims.some(
    (claim) =>
      claim === "git_operation" ||
      claim === "stable_point_created" ||
      claim === "worktree_created" ||
      claim === "worktree_resumed" ||
      claim === "worktree_removed",
  );
}

// Run 2 P1-2 — mutating 动作"已执行成功"的 evidence 支撑。要求一条 command_output
// 类 evidence，且它不是 tool_failure / denied / cancelled / 非零退出。被拒绝或取消的
// 动作只会产生 `tool_failure` evidence（recordToolFailureEvidence，supportsClaims 含
// tool_failure），因此无法支撑该 claim；真实执行成功的 Bash/Write/Edit/index 才放行。
function evidenceSupportsActionExecuted(record: EvidenceRecord): boolean {
  if (record.kind === "image_result") {
    return record.supportsClaims.includes("image_result");
  }
  if (record.kind !== "command_output" && record.kind !== "test_result") {
    return false;
  }
  if (record.supportsClaims.includes("tool_failure")) {
    return false;
  }
  // 非零退出的 Bash 命令"执行了但失败"，不能支撑"已成功执行"。
  if (record.supportsClaims.includes("bash_exit_nonzero")) {
    return false;
  }
  const tokens = evidenceTokens(record);
  if (/(?:denied|cancelled|canceled|permission denied|failure|未执行|拒绝|取消)/iu.test(tokens)) {
    return false;
  }
  // 真实执行过的 Bash/Write/Edit/MultiEdit/index operation（runtime 成功后写入这些标签）。
  return record.supportsClaims.some(
    (claim) =>
      claim === "Bash" ||
      claim === "Write" ||
      claim === "Edit" ||
      claim === "MultiEdit" ||
      claim === "command_ran" ||
      claim === "file_written" ||
      claim === "index_operation" ||
      claim === "index_refresh" ||
      claim === "index_init_fast" ||
      claim === "index_repair" ||
      claim === "image_result",
  );
}

const REQUIRED_EVIDENCE_LABEL: Record<FinalAnswerClaimKind, string> = {
  completion_claim: "task completion evidence",
  test_claim: "test result evidence",
  file_change_claim: "file change evidence",
  verification_claim: "verification evidence",
  workflow_status_claim: "terminal successful workflow runtime evidence",
  agent_status_claim: "terminal successful agent runtime evidence",
  completion_pass: "test/build/typecheck/diff-check/smoke",
  code_fact: "Read/Grep/index",
  external_current_fact: "web_source",
  ccb_parity: "ccb-source \u672c\u5730\u8bc1\u636e\u6216 web_source",
  beta_readiness: "Beta readiness verdict (real-tui report-generation PASS)",
  git_operation: "git_operation evidence (real stable point / worktree create / worktree remove)",
  action_executed: "real successful command_output (install / Bash / Write / index refresh)",
};

export function evaluateFinalAnswerClaims(
  text: string,
  evidence: EvidenceRecord[],
  now: Date = new Date(),
): FinalAnswerClaimVerdict {
  const structured = extractStructuredFinalAnswerClaims(text);
  return evaluateStructuredFinalAnswerClaims(
    structured.length > 0 ? structured : extractLegacyTextRiskClaims(text),
    evidence,
    now,
    text,
  );
}

export function evaluateStructuredFinalAnswerClaims(
  matches: FinalAnswerClaimMatch[],
  evidence: EvidenceRecord[],
  now: Date = new Date(),
  sourceText = "",
): FinalAnswerClaimVerdict {
  if (matches.length === 0) {
    return {
      status: "passed",
      matchedClaims: [],
      unsupportedKinds: [],
      missingEvidenceKinds: [],
    };
  }
  const matchedKinds = new Set<FinalAnswerClaimKind>(matches.map((item) => item.kind));
  const unsupported: FinalAnswerClaimKind[] = [];
  // D.13V-A\uff1a\u8bb0\u5f55"\u66fe\u7ecf\u547d\u4e2d\u4f46\u5168\u90e8 stale \u800c\u88ab\u5ffd\u7565"\u7684 claim \u7c7b\u578b\uff0c\u7528\u4e8e reminder/downgrade \u63d0\u793a\u3002
  const staleKinds: FinalAnswerClaimKind[] = [];
  for (const kind of matchedKinds) {
    let supported = false;
    let supporter: (record: EvidenceRecord) => boolean;
    if (kind === "completion_claim") {
      const matching = evidence.filter(evidenceSupportsTaskCompletion);
      const fresh = matching.filter((rec) => !isEvidenceStaleForClaim(rec, kind, now));
      supported = fresh.length > 0;
      if (!supported) {
        unsupported.push(kind);
        if (matching.length > 0 && fresh.length === 0) {
          staleKinds.push(kind);
        }
      }
      continue;
    }
    if (kind === "test_claim") {
      const matching = evidence.filter((record) => evidenceSupportsCommandClaim(record, "test"));
      const fresh = matching.filter((rec) => !isEvidenceStaleForClaim(rec, kind, now));
      supported = fresh.length > 0;
      if (!supported) {
        unsupported.push(kind);
        if (matching.length > 0 && fresh.length === 0) {
          staleKinds.push(kind);
        }
      }
      continue;
    }
    if (kind === "verification_claim") {
      const matching = evidence.filter(evidenceSupportsVerificationClaim);
      const fresh = matching.filter((rec) => !isEvidenceStaleForClaim(rec, kind, now));
      supported = fresh.length > 0;
      if (!supported) {
        unsupported.push(kind);
        if (matching.length > 0 && fresh.length === 0) {
          staleKinds.push(kind);
        }
      }
      continue;
    }
    if (kind === "completion_pass") {
      const completionMatches = matches.filter((item) => item.kind === "completion_pass");
      const matching = evidence.filter((record) =>
        completionMatches.some((match) =>
          evidenceSupportsCompletionClaim(record, sourceText, match),
        ),
      );
      const fresh = matching.filter((rec) => !isEvidenceStaleForClaim(rec, kind, now));
      supported = completionMatches.every((match) =>
        fresh.some((record) => evidenceSupportsCompletionClaim(record, sourceText, match)),
      );
      if (!supported) {
        unsupported.push(kind);
        if (matching.length > 0 && fresh.length === 0) {
          staleKinds.push(kind);
        }
      }
      continue;
    }
    if (kind === "code_fact") {
      supporter = evidenceSupportsLocalCodeFact;
    } else if (kind === "external_current_fact") {
      supporter = evidenceSupportsExternalCurrent;
    } else if (kind === "file_change_claim") {
      supporter = evidenceSupportsFileChangeClaim;
    } else if (kind === "workflow_status_claim") {
      supporter = evidenceSupportsWorkflowStatusClaim;
    } else if (kind === "agent_status_claim") {
      supporter = evidenceSupportsAgentStatusClaim;
    } else if (kind === "ccb_parity") {
      supporter = evidenceSupportsCcbParity;
    } else if (kind === "git_operation") {
      supporter = evidenceSupportsGitOperation;
    } else if (kind === "action_executed") {
      supporter = evidenceSupportsActionExecuted;
    } else {
      // beta_readiness \u7531 createPhase15BetaVerdictScope \u4e3b\u7ba1\uff0cevaluator \u6c38\u8fdc\u4e0d\u653e\u884c\u3002
      supporter = () => false;
    }
    const matching = evidence.filter(supporter);
    const fresh = matching.filter((rec) => !isEvidenceStaleForClaim(rec, kind, now));
    supported = fresh.length > 0;
    if (!supported) {
      unsupported.push(kind);
      // \u4ec5\u5f53\u5b58\u5728\u88ab\u5254\u9664\u7684 stale \u8bc1\u636e\u65f6\u8bb0\u5f55\uff1b\u7eaf\u7cb9\u7f3a\u8bc1\u636e\u7684\u4e0d\u7b97 stale\u3002
      if (matching.length > 0 && fresh.length === 0) {
        staleKinds.push(kind);
      }
    }
  }
  if (unsupported.length === 0) {
    return {
      status: "passed",
      matchedClaims: matches,
      unsupportedKinds: [],
      missingEvidenceKinds: [],
    };
  }
  const missingEvidenceKinds = unsupported.map((kind) => REQUIRED_EVIDENCE_LABEL[kind]);
  const verdict: FinalAnswerClaimVerdict = {
    status: "needs_disclaimer",
    matchedClaims: matches,
    unsupportedKinds: unsupported,
    missingEvidenceKinds,
  };
  if (staleKinds.length > 0) {
    verdict.staleKinds = staleKinds;
  }
  return verdict;
}

// \u7ed9\u6a21\u578b\u6ce8\u5165\u7684 user reminder\uff08\u4ec5\u4e00\u8f6e\uff09\u3002\u4e2d\u6587\u77ed\u53e5 + \u5217\u51fa\u7f3a\u4ec0\u4e48\u7c7b\u578b\u8bc1\u636e\u3002
export function createFinalAnswerClaimReminder(
  verdict: FinalAnswerClaimVerdict,
  language: Language,
): string {
  const phrases = Array.from(new Set(verdict.matchedClaims.map((m) => m.phrase))).slice(0, 6);
  const kinds = Array.from(new Set(verdict.missingEvidenceKinds)).join(", ");
  const hasStale = verdict.staleKinds && verdict.staleKinds.length > 0;
  if (language === "en-US") {
    const stalePart = hasStale
      ? " Some prior evidence was ignored because it is too old to support these claims."
      : "";
    return `Your last reply contains high-risk claims (${phrases.join(", ")}) but the session has no matching evidence (missing: ${kinds}).${stalePart} Rewrite the reply: drop or downgrade unverified claims to "unverified / pending confirmation", or call a tool first to gather evidence. You have only one rewrite chance.`;
  }
  const stalePart = hasStale
    ? "\u90e8\u5206\u65e9\u671f\u8bc1\u636e\u5df2\u8fc7\u671f\u88ab\u5ffd\u7565\u3002"
    : "";
  return `\u4f60\u4e0a\u6b21\u56de\u7b54\u91cc\u51fa\u73b0\u4e86\u9ad8\u98ce\u9669\u58f0\u660e\uff08${phrases.join(", ")}\uff09\uff0c\u4f46\u5f53\u524d\u4f1a\u8bdd\u6ca1\u6709\u5bf9\u5e94\u7c7b\u578b\u7684\u8bc1\u636e\uff08\u7f3a\uff1a${kinds}\uff09\u3002${stalePart}\u8bf7\u91cd\u5199\u56de\u7b54\uff1a\u5220\u9664\u6216\u964d\u7ea7\u672a\u9a8c\u8bc1\u7684\u58f0\u660e\u4e3a"\u672a\u9a8c\u8bc1 / \u5f85\u786e\u8ba4"\uff0c\u6216\u5148\u8c03\u7528\u5de5\u5177\u8865\u8bc1\u636e\u3002\u4ec5\u672c\u8f6e\u4e00\u6b21\u4fee\u6b63\u673a\u4f1a\u3002`;
}

// \u4fee\u6b63\u5931\u8d25\u540e\u672c\u5730\u964d\u7ea7\uff1a\u628a\u8fdd\u89c4 phrase \u4ece\u539f\u6587\u66ff\u6362\u4e3a"\u672a\u9a8c\u8bc1 / \u5f85\u786e\u8ba4"\uff0c\u5e76\u8ffd\u52a0\u4e00\u6bb5\u4eba\u8bdd\u77ed\u63d0\u793a\u3002
// \u4e0d\u66b4\u9732 internal validator id / FinalAnswerClaimGate / EvidenceSummary \u7b49\u5185\u90e8\u8bcd\u3002
export function buildDowngradedFinalAnswer(
  originalText: string,
  verdict: FinalAnswerClaimVerdict,
  language: Language,
): string {
  let safeText = stripStructuredFinalAnswerClaims(originalText);
  for (const match of verdict.matchedClaims) {
    if (verdict.unsupportedKinds.includes(match.kind)) {
      const re = new RegExp(escapeRegExp(match.phrase), "giu");
      safeText = safeText.replace(
        re,
        language === "en-US" ? "[unverified]" : "[\u672a\u9a8c\u8bc1]",
      );
    }
  }
  const notice =
    language === "en-US"
      ? "\nI can only state this as unverified because matching evidence is missing."
      : '\n\u7531\u4e8e\u7f3a\u5c11\u5339\u914d\u8bc1\u636e\uff0c\u8fd9\u4e2a\u7ed3\u8bba\u53ea\u80fd\u6309"\u672a\u9a8c\u8bc1"\u8868\u8ff0\u3002';
  return safeText + notice;
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// D.13V-B \u2014 Architecture / Completeness final answer gates (pure helpers)
// ---------------------------------------------------------------------------
//
// \u8bbe\u8ba1\u539f\u5219\uff1a
// - \u4e0d\u91cd\u5199 evaluateFinalAnswerClaims\uff1b\u4ec5\u4f5c\u4e3a\u989d\u5916\u7684 final-answer hook \u4e0e D.13U \u5e76\u8054\u3002
// - \u4e0d\u5728\u666e\u901a\u8f93\u5165\u4fa7\u505a\u5173\u952e\u8bcd\u62e6\u622a\uff1b\u53ea\u5728 final answer \u51fa\u73b0"\u58f0\u79f0\u7b26\u5408\u67b6\u6784\u8fb9\u754c / \u6ca1\u6709\u67b6\u6784\u6f02\u79fb
//   / \u5168\u90e8\u5b8c\u6210\u3001\u6ca1\u6709\u9057\u6f0f"\u7b49\u9ad8\u98ce\u9669\u7ed3\u8bba\u65f6\u68c0\u67e5\u3002
// - \u6ca1\u6709 architecture card / drift \u68c0\u67e5 / completeness \u5206\u7c7b\u65f6\uff0c\u76f8\u5e94 claim \u88ab\u6807\u8bb0\u4e3a
//   needs_disclaimer\uff0c\u89e6\u53d1 retry \u6216\u672c\u5730\u964d\u7ea7\u3002
// - \u590d\u7528\u73b0\u6709 architecture-runtime \u7684 detectArchitectureDrift / architecture-boundary \u7684
//   validateChangeDeclaration \u80fd\u529b\uff0c\u4e0d\u65b0\u5efa\u7b2c\u4e8c\u5957\u7cfb\u7edf\u3002

const ARCHITECTURE_BOUNDARY_CLAIM_PATTERNS: RegExp[] = [
  /\u7b26\u5408\u67b6\u6784\u8fb9\u754c/u, // \u7b26\u5408\u67b6\u6784\u8fb9\u754c
  /\u67b6\u6784\u5df2\u95ed\u5408/u, // \u67b6\u6784\u5df2\u95ed\u5408
  /\u67b6\u6784\u8fb9\u754c\u5df2\u95ed\u5408/u, // \u67b6\u6784\u8fb9\u754c\u5df2\u95ed\u5408
  /\u6ca1\u6709\u67b6\u6784\u6f02\u79fb/u, // \u6ca1\u6709\u67b6\u6784\u6f02\u79fb
  /\u67b6\u6784\u6ca1\u6709\u6f02\u79fb/u, // \u67b6\u6784\u6ca1\u6709\u6f02\u79fb
  /\u67b6\u6784\u4e0d\u4f1a\u6f02\u79fb/u, // \u67b6\u6784\u4e0d\u4f1a\u6f02\u79fb
  /\bno\s+architecture\s+drift\b/iu,
  /\barchitecture\s+(?:is\s+)?(?:closed|aligned|clean|consistent)\b/iu,
  /\barchitecture\s+boundaries?\s+(?:closed|clean|respected)\b/iu,
  /\bboundaries?\s+(?:are\s+)?(?:respected|honored|clean)\b/iu,
];

const COMPLETENESS_CLAIM_PATTERNS: RegExp[] = [
  /\u6240\u6709\u4efb\u52a1\u5b8c\u6574\u5b8c\u6210/u, // \u6240\u6709\u4efb\u52a1\u5b8c\u6574\u5b8c\u6210
  /\u6240\u6709\u95ee\u9898\u90fd\u5df2\u89e3\u51b3/u, // \u6240\u6709\u95ee\u9898\u90fd\u5df2\u89e3\u51b3
  /\u6ca1\u6709\u9057\u6f0f/u, // \u6ca1\u6709\u9057\u6f0f
  /\u4e00\u4e2a\u90fd\u4e0d\u5c11/u, // \u4e00\u4e2a\u90fd\u4e0d\u5c11
  /\u5168\u90e8\u5b8c\u6574/u, // \u5168\u90e8\u5b8c\u6574
  /\u5168\u9762\u8986\u76d6/u, // \u5168\u9762\u8986\u76d6
  /\b(?:no|zero)\s+omissions?\b/iu,
  /\bnothing\s+left\s+behind\b/iu,
  /\ball\s+(?:tasks|items|issues)\s+(?:are\s+)?(?:complete|completed|resolved)\b/iu,
  /\bfull(?:ly)?\s+(?:complete|comprehensive|covered)\b/iu,
];

export type FinalAnswerArchitectureCheckInput = {
  hasActiveCard: boolean;
  driftWarnings?: string[];
  hasArchitectureEvidence?: boolean;
};

export type FinalAnswerCompletenessCheckInput = {
  classificationRequired: boolean;
  classification: SolutionCompletenessClassification;
  textHasClassification: boolean;
};

export type FinalAnswerExtendedClaimKind = "architecture_boundary" | "completeness";

export type FinalAnswerExtendedVerdict = {
  status: "passed" | "needs_disclaimer";
  matchedClaims: { kind: FinalAnswerExtendedClaimKind; phrase: string }[];
  unsupportedKinds: FinalAnswerExtendedClaimKind[];
  missingEvidenceKinds: string[];
};

// \u4e0e D.13U \u5e73\u884c\u7684\u7eaf\u51fd\u6570\uff1a\u68c0\u67e5\u6700\u7ec8\u56de\u7b54\u662f\u5426\u58f0\u79f0"\u7b26\u5408\u67b6\u6784\u8fb9\u754c"\u6216"\u65e0\u9057\u6f0f"\u3002
// \u4e0e evaluateFinalAnswerClaims \u4e0d\u540c\uff1a\u672c\u68c0\u67e5\u4e0d\u9700\u8981 EvidenceRecord \u6570\u7ec4\uff0c
// \u800c\u662f\u4f9d\u8d56 sendMessage \u5f53\u8f6e\u5df2\u7ecf\u6536\u96c6\u5230\u7684\u8fd0\u884c\u671f\u4fe1\u53f7\uff08card / drift / classification\uff09\u3002
export function evaluateArchitectureAndCompletenessClaims(
  text: string,
  architecture: FinalAnswerArchitectureCheckInput,
  completeness: FinalAnswerCompletenessCheckInput,
): FinalAnswerExtendedVerdict {
  const matched: { kind: FinalAnswerExtendedClaimKind; phrase: string }[] = [];
  for (const re of ARCHITECTURE_BOUNDARY_CLAIM_PATTERNS) {
    const match = re.exec(text);
    if (match) {
      matched.push({ kind: "architecture_boundary", phrase: match[0] });
    }
  }
  for (const re of COMPLETENESS_CLAIM_PATTERNS) {
    const match = re.exec(text);
    if (match) {
      matched.push({ kind: "completeness", phrase: match[0] });
    }
  }
  if (matched.length === 0) {
    return {
      status: "passed",
      matchedClaims: [],
      unsupportedKinds: [],
      missingEvidenceKinds: [],
    };
  }
  const unsupported: FinalAnswerExtendedClaimKind[] = [];
  const missing: string[] = [];
  const matchedKinds = new Set(matched.map((m) => m.kind));
  if (matchedKinds.has("architecture_boundary")) {
    const supported =
      architecture.hasActiveCard &&
      (architecture.driftWarnings?.length ?? 0) === 0 &&
      architecture.hasArchitectureEvidence !== false;
    if (!supported) {
      unsupported.push("architecture_boundary");
      missing.push("Architecture Card \u4e0e drift check");
    }
  }
  if (matchedKinds.has("completeness")) {
    // \u6709\u58f0\u660e\u4f46\u672a\u505a single_issue/systemic_gap \u5206\u7c7b \u2192 \u4e0d\u653e\u884c\u3002
    const supported =
      !completeness.classificationRequired ||
      (completeness.classification !== "unknown" && completeness.textHasClassification);
    if (!supported) {
      unsupported.push("completeness");
      missing.push("Solution Completeness classification (single_issue / systemic_gap)");
    }
  }
  if (unsupported.length === 0) {
    return {
      status: "passed",
      matchedClaims: matched,
      unsupportedKinds: [],
      missingEvidenceKinds: [],
    };
  }
  return {
    status: "needs_disclaimer",
    matchedClaims: matched,
    unsupportedKinds: unsupported,
    missingEvidenceKinds: missing,
  };
}

export function createExtendedFinalAnswerReminder(
  verdict: FinalAnswerExtendedVerdict,
  language: Language,
): string {
  const phrases = Array.from(new Set(verdict.matchedClaims.map((m) => m.phrase))).slice(0, 6);
  const kinds = Array.from(new Set(verdict.missingEvidenceKinds)).join(", ");
  if (language === "en-US") {
    return `Your last reply contains high-risk claims (${phrases.join(", ")}) but the session has no matching support (missing: ${kinds}). Rewrite the reply: drop or downgrade unverified claims to "unverified / pending confirmation", or run a tool / call /claim-check to gather evidence first. You have only one rewrite chance.`;
  }
  return `\u4f60\u4e0a\u6b21\u56de\u7b54\u91cc\u51fa\u73b0\u4e86\u9ad8\u98ce\u9669\u58f0\u660e\uff08${phrases.join(", ")}\uff09\uff0c\u4f46\u5f53\u524d\u4f1a\u8bdd\u6ca1\u6709\u5bf9\u5e94\u8bc1\u636e\uff08\u7f3a\uff1a${kinds}\uff09\u3002\u8bf7\u91cd\u5199\u56de\u7b54\uff1a\u5220\u9664\u6216\u964d\u7ea7\u672a\u9a8c\u8bc1\u7684\u58f0\u660e\u4e3a"\u672a\u9a8c\u8bc1 / \u5f85\u786e\u8ba4"\uff0c\u6216\u5148\u8c03\u7528\u5de5\u5177 / \u5148\u8d70 /claim-check \u8865\u8bc1\u636e\u3002\u4ec5\u672c\u8f6e\u4e00\u6b21\u4fee\u6b63\u673a\u4f1a\u3002`;
}

export function buildExtendedDowngradedFinalAnswer(
  originalText: string,
  verdict: FinalAnswerExtendedVerdict,
  language: Language,
): string {
  let safeText = originalText;
  for (const match of verdict.matchedClaims) {
    if (verdict.unsupportedKinds.includes(match.kind)) {
      const re = new RegExp(escapeRegExp(match.phrase), "giu");
      safeText = safeText.replace(
        re,
        language === "en-US" ? "[unverified]" : "[\u672a\u9a8c\u8bc1]",
      );
    }
  }
  const notice =
    language === "en-US"
      ? "\nI can only state this as unverified because matching support is missing."
      : '\n\u7531\u4e8e\u7f3a\u5c11\u5339\u914d\u652f\u6491\uff0c\u8fd9\u4e2a\u7ed3\u8bba\u53ea\u80fd\u6309"\u672a\u9a8c\u8bc1"\u8868\u8ff0\u3002';
  return safeText + notice;
}

export function finalAnswerHasCompletenessClassification(text: string): boolean {
  return /\b(single_issue|systemic_gap)\b/u.test(text);
}

export function hasArchitectureEvidenceForClaims(
  evidence: { supportsClaims: string[]; kind?: string; source?: string }[],
): boolean {
  // \u63a5\u53d7\u4ee5\u4e0b\u4efb\u4e00\u4f5c\u4e3a"\u67b6\u6784\u8fb9\u754c"\u5c42\u9762\u8bc1\u636e\uff1a
  // - supportsClaims \u4e2d\u542b "architecture_boundary_check"\uff08\u672a\u6765\u7531 architecture-boundary \u63a5\u5165\u4ea7\u751f\uff09
  // - architecture-runtime \u7684 system_event card \u5728 evidence \u4e2d\u4fdd\u7559 supportsClaims=["architecture_card"]
  // - evidence source \u547d\u4e2d\u672c\u4ed3\u5e93\u5185 architecture-* \u6a21\u5757\u7684 file_read\uff08\u8bf4\u660e\u6a21\u578b\u786e\u5b9e\u8bfb\u8fc7\u67b6\u6784\u76f8\u5173\u6e90\u7801\uff09
  return evidence.some((rec) => {
    const claims = rec.supportsClaims ?? [];
    if (
      claims.includes("architecture_boundary_check") ||
      claims.includes("architecture_card") ||
      claims.includes("architecture_runtime")
    ) {
      return true;
    }
    const source = (rec.source ?? "").toLowerCase();
    if (rec.kind === "file_read" && /architecture-(?:boundary|runtime)/.test(source)) {
      return true;
    }
    return false;
  });
}

// ---------------------------------------------------------------------------
// D.13V-C \u2014 RuntimeStatus prompt projection (split internal / external)
// ---------------------------------------------------------------------------
//
// \u65e7 system prompt \u76f4\u63a5 JSON.stringify(runtimeStatus)\uff0c\u628a provider/baseUrl/endpointProfile
// \u5f53\u539f\u6587\u585e\u8fdb prompt\uff0c\u4f9d\u8d56 RuntimeIdentityRule \u8f6f\u7ea6\u675f\u8ba9\u6a21\u578b\u4e0d\u8981\u6cc4\u6f0f\u3002
// \u62c6\u6210 internalForLog / externalForPrompt\uff1a
// - externalForPrompt \u53ea\u542b\u6a21\u578b\u56de\u7b54\u81ea\u7136\u8bed\u8a00\u65f6\u786e\u5b9e\u9700\u8981\u7684\u5b57\u6bb5\uff08model name\u3001permission mode\u3001
//   index/cache \u6982\u89c8\u3001\u6269\u5c55\u5de5\u5177\u662f\u5426\u542f\u7528\u3001memory \u6982\u89c8\uff09\u3002
// - \u4e0d\u542b provider / baseUrl / endpointProfile / \u8def\u7531\u4fe1\u606f\u3002
// - \u7528\u6237\u95ee provider/route/doctor \u65f6\u4ecd\u53ef\u901a\u8fc7 /model doctor\u3001/model route doctor \u66b4\u9732\u5b8c\u6574\u4fe1\u606f\u3002

export type RuntimeStatusForPrompt = {
  memory: {
    linghunMd: "found" | "missing" | "unreadable";
    candidates: number;
    accepted: number;
    autoAccept: boolean;
  };
  index: { status: string; changedFiles: number | null };
  cache: { latestHitRate: number | null; changedKeys: string[] };
  model: { name: string };
  permissionMode: string;
  extensions: {
    skills: { enabled: boolean; count: number };
    plugins: { enabled: boolean; count: number };
    hooks: { enabled: boolean; count: number };
  };
};

export function projectRuntimeStatusForPrompt(
  runtimeStatus: unknown,
): RuntimeStatusForPrompt | null {
  if (!runtimeStatus || typeof runtimeStatus !== "object") return null;
  const r = runtimeStatus as Record<string, unknown>;
  const model =
    r.model && typeof r.model === "object"
      ? ((r.model as { name?: string }).name ?? "unknown")
      : "unknown";
  const memory = (r.memory ?? {}) as Record<string, unknown>;
  const index = (r.index ?? {}) as Record<string, unknown>;
  const cache = (r.cache ?? {}) as Record<string, unknown>;
  const extensions = (r.extensions ?? {}) as Record<string, unknown>;
  const skills = (extensions.skills ?? {}) as Record<string, unknown>;
  const plugins = (extensions.plugins ?? {}) as Record<string, unknown>;
  const hooks = (extensions.hooks ?? {}) as Record<string, unknown>;
  return {
    memory: {
      linghunMd: ((memory.linghunMd as RuntimeStatusForPrompt["memory"]["linghunMd"]) ??
        "missing") as RuntimeStatusForPrompt["memory"]["linghunMd"],
      candidates: typeof memory.candidates === "number" ? memory.candidates : 0,
      accepted: typeof memory.accepted === "number" ? memory.accepted : 0,
      autoAccept: memory.autoAccept === true,
    },
    index: {
      status: typeof index.status === "string" ? index.status : "unknown",
      changedFiles: typeof index.changedFiles === "number" ? (index.changedFiles as number) : null,
    },
    cache: {
      latestHitRate:
        typeof cache.latestHitRate === "number" ? (cache.latestHitRate as number) : null,
      changedKeys: Array.isArray(cache.changedKeys)
        ? (cache.changedKeys as string[]).filter((k) => typeof k === "string")
        : [],
    },
    model: { name: typeof model === "string" ? model : "unknown" },
    permissionMode: typeof r.permissionMode === "string" ? r.permissionMode : "default",
    extensions: {
      skills: {
        enabled: skills.enabled === true,
        count: typeof skills.count === "number" ? (skills.count as number) : 0,
      },
      plugins: {
        enabled: plugins.enabled === true,
        count: typeof plugins.count === "number" ? (plugins.count as number) : 0,
      },
      hooks: {
        enabled: hooks.enabled === true,
        count: typeof hooks.count === "number" ? (hooks.count as number) : 0,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// D.13V-C \u2014 deferred tool \u9ed8\u8ba4\u4e3b\u5c4f\u6587\u6848\u964d\u566a\uff08pure helper\uff09
// ---------------------------------------------------------------------------
//
// SearchExtraTools / ExecuteExtraTool \u7684 result.text \u542b\u5b57\u9762\u5de5\u5177\u540d\uff08"SearchExtraTools matched ..."\u3001
// "ExecuteExtraTool: \u5de5\u5177 ..."\uff09\uff0c\u8fd9\u4e9b\u662f\u7ed9 verifier / tool_result / details \u770b\u7684\u5185\u90e8\u8bf4\u660e\u3002
// \u4e3b\u5c4f\uff08writeLine\uff09\u9ed8\u8ba4\u663e\u793a\u4ea7\u54c1\u8bed\u8a00\uff1a
//   - "\u5df2\u53d1\u73b0 N \u4e2a\u6269\u5c55\u5de5\u5177"
//   - "\u6269\u5c55\u5de5\u5177\u8c03\u7528\u5b8c\u6210 / \u5931\u8d25\uff1a<\u539f\u56e0\u6458\u8981>"
// raw text \u4ecd\u4fdd\u7559\u5728 store \u7684 tool_result \u4e8b\u4ef6\u91cc\uff0cdoctor / details / Ctrl+O \u80fd\u770b\u5230\u3002

export function sanitizeDeferredToolPrimaryText(
  rawText: string,
  language: Language,
  options: {
    dispatchKind: "SearchExtraTools" | "ExecuteExtraTool";
    ok: boolean;
    matchedCount?: number;
  },
): string {
  if (options.dispatchKind === "SearchExtraTools" && options.ok) {
    const count = options.matchedCount ?? extractMatchedCount(rawText);
    return language === "en-US"
      ? `Found ${count} extension tool(s).`
      : `\u5df2\u53d1\u73b0 ${count} \u4e2a\u6269\u5c55\u5de5\u5177\u3002`;
  }
  if (options.dispatchKind === "ExecuteExtraTool" && options.ok) {
    return language === "en-US"
      ? "Extension tool finished."
      : "\u6269\u5c55\u5de5\u5177\u8c03\u7528\u5b8c\u6210\u3002";
  }
  // \u5931\u8d25\uff1a\u53bb\u6389\u524d\u7f00\u5b57\u9762\uff0c\u53ea\u4fdd\u7559\u53ef\u8bfb\u539f\u56e0\u3002raw text \u4ecd\u5199\u5165 tool_result store\u3002
  const reason = stripDeferredInternalTokens(rawText);
  return language === "en-US"
    ? `Extension tool call failed: ${reason}`
    : `\u6269\u5c55\u5de5\u5177\u8c03\u7528\u5931\u8d25\uff1a${reason}`;
}

function extractMatchedCount(text: string): number {
  const m = /matched\s+(\d+)/iu.exec(text);
  return m?.[1] ? Number.parseInt(m[1], 10) : 0;
}

function stripDeferredInternalTokens(text: string): string {
  return text
    .replace(/^SearchExtraTools[:\s]+/iu, "")
    .replace(/^ExecuteExtraTool[\s(:][^\uff1a:]*[\uff09)]?[:\s]*/iu, "")
    .replace(/SearchExtraTools/giu, "")
    .replace(/ExecuteExtraTool/giu, "")
    .replace(/executeDeferredDispatchToolUse/giu, "")
    .replace(/dispatcher/giu, "")
    .replace(/\s{2,}/gu, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// D.13U \u2014 recordToolEvidence supportsClaims \u6d3e\u751f\u5668\uff08\u7eaf\u51fd\u6570\uff09
// ---------------------------------------------------------------------------
//
// \u65e7 recordToolEvidence \u4ec5\u5199 [name]\uff0c\u5bfc\u81f4\u4efb\u4f55\u5de5\u5177\u8c03\u7528\u90fd\u88ab\u5f53\u6210\u4e07\u80fd\u8bc1\u636e\u3002
// \u65b0\u7248\u6309 \u5de5\u5177 + \u547d\u4ee4\u6587\u672c + exit code \u6d3e\u751f\u5177\u4f53 claim \u7c7b\u578b\u3002

export function deriveToolSupportsClaims(
  name: ToolName,
  input: unknown,
  output: { text?: string; data?: unknown },
): string[] {
  const claims = new Set<string>([name]);
  const inputObj = (input ?? {}) as Record<string, unknown>;

  if (name === "Read") {
    claims.add("local_read");
    const filePath = typeof inputObj.file_path === "string" ? inputObj.file_path : undefined;
    if (filePath) claims.add(`file:${filePath}`);
  }
  if (name === "Grep") {
    claims.add("local_read");
    claims.add("grep_match");
    const pattern = typeof inputObj.pattern === "string" ? inputObj.pattern : undefined;
    if (pattern) claims.add(`pattern:${pattern.slice(0, 60)}`);
  }
  if (name === "Glob") {
    claims.add("local_read");
    claims.add("grep_match");
  }
  if (name === "Write" || name === "Edit" || name === "MultiEdit") {
    claims.add("file_written");
    const filePath = typeof inputObj.file_path === "string" ? inputObj.file_path : undefined;
    if (filePath) claims.add(`file:${filePath}`);
  }
  if (name === "Bash") {
    const command = typeof inputObj.command === "string" ? inputObj.command : "";
    claims.add("command_ran");
    const dataExit = (output.data as { exitCode?: unknown } | undefined)?.exitCode;
    const exitOk =
      (typeof dataExit === "number" && dataExit === 0) ||
      (typeof dataExit !== "number" && /(?:^|\s)exit\s*code\s*0(?:\s|$)/iu.test(output.text ?? ""));
    claims.add(exitOk ? "bash_exit_0" : "bash_exit_nonzero");
    const cmd = command.toLowerCase();
    if (exitOk) {
      if (
        /(?:^|[\s&|;])(?:vitest|jest|pytest|go\s+test|cargo\s+test|mocha|jasmine|tap\b)/iu.test(cmd)
      ) {
        claims.add("test_passed");
      }
      if (/(?:^|[\s&|;])(?:tsc)(?:\s|$)/iu.test(cmd) || /tsc\s+--noemit/iu.test(cmd)) {
        claims.add("typecheck_passed");
      }
      if (
        /(?:^|[\s&|;])(?:pnpm|npm|yarn)\s+(?:run\s+)?build(?:\s|$)/iu.test(cmd) ||
        /(?:^|[\s&|;])(?:cargo|go)\s+build(?:\s|$)/iu.test(cmd)
      ) {
        claims.add("build_passed");
      }
      if (/git\s+diff\s+--check/iu.test(cmd)) {
        claims.add("diff_check_passed");
      }
      if (/(?:^|[\s&|;])(?:smoke|run-smoke|.*\bsmoke\b.*)/iu.test(cmd)) {
        claims.add("smoke_ran");
      }
      if (/git\s+(?:status|branch|rev-parse|log|show-ref|symbolic-ref)/iu.test(cmd)) {
        claims.add("git_status");
        claims.add("git_local_fact");
      }
    }
  }
  return Array.from(claims);
}
