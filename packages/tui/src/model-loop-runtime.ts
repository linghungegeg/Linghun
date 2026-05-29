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

export const SEARCH_EXTRA_TOOLS_DESCRIPTION =
  "Discover deferred tools provided by enabled MCP servers, trusted skills, trusted plugins, and codebase-memory. Returns name/kind/description/requiredArgs/executable/reason for each match. Pass a free-text query to filter; pass empty string to list all. Use ExecuteExtraTool to actually invoke a discovered tool.";

export const EXECUTE_EXTRA_TOOL_DESCRIPTION =
  "Invoke a deferred tool that was previously returned by SearchExtraTools with executable=true. Built-in tools (Read/Edit/Write/Bash/Grep/Glob/Todo) MUST be called directly, not via this wrapper. tool_name must match a discovered tool exactly; params must include all required args.";

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
      params: { type: "object" },
    },
    required: ["tool_name"],
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
  return [
    ...createModelToolDefinitionsForTools(
      Object.values(builtInTools) as (typeof builtInTools)[ToolName][],
    ),
    ...createDeferredToolDispatchDefinitions(),
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
  | "completion_pass"
  | "code_fact"
  | "external_current_fact"
  | "ccb_parity"
  | "beta_readiness";

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

// D.13V-A — 按 claim 类型分级的 evidence 过期阈值（毫秒）。null 表示不应用过期判断。
// 阈值依据真实工程节奏：
// - completion_pass：测试/构建/typecheck/diff-check/smoke 跑过 30 分钟后，代码可能已被改动，再当 PASS 不安全。
// - code_fact：Read/Grep/index 读到的源码事实，60 分钟后文件可能已变；再当"现在的代码事实"不安全。
// - external_current_fact：web_source 24 小时内变化大；超 24h 不再当"今天最新"。
// - ccb_parity：与文件版本快照绑定，不按时间过期。
// - beta_readiness：由 createPhase15BetaVerdictScope 主管，不在此引入额外 staleness。
const STALE_THRESHOLDS_MS: Record<FinalAnswerClaimKind, number | null> = {
  completion_pass: 30 * 60 * 1000,
  code_fact: 60 * 60 * 1000,
  external_current_fact: 24 * 60 * 60 * 1000,
  ccb_parity: null,
  beta_readiness: null,
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

const COMPLETION_PASS_PATTERNS: RegExp[] = [
  /\u5df2\u5b8c\u6210/u, // \u5df2\u5b8c\u6210
  /\u5df2\u4fee\u590d/u, // \u5df2\u4fee\u590d
  /\u5df2\u9a8c\u8bc1/u, // \u5df2\u9a8c\u8bc1
  /\u6d4b\u8bd5\u901a\u8fc7/u, // \u6d4b\u8bd5\u901a\u8fc7
  /\u6210\u719f\u53ef\u53d1\u5e03/u, // \u6210\u719f\u53ef\u53d1\u5e03
  /\u65e0\u98ce\u9669/u, // \u65e0\u98ce\u9669
  /\bbuild\s+(?:has\s+)?passed\b/iu,
  /\btsc\s+(?:has\s+)?passed\b/iu,
  /\bdiff[-\s]?check\s+passed\b/iu,
  /\btests?\s+passed\b/iu,
  /\bsmoke[-\s]?ready\b/iu,
  /\b(?:release|production)[-\s]?ready\b/iu,
  /\bcompleted\b/iu,
  /\bfixed\b/iu,
  /\bverified\b/iu,
  /(?:^|[\s"'\u201c])PASS(?=[\s.\u3002\u3001!?,;:"'\u201d]|$)/u,
  /\bmature\s+(?:tool|implementation|module)\b/iu,
];

const CODE_FACT_PATTERNS: RegExp[] = [
  /\u4ee3\u7801\u91cc/u, // \u4ee3\u7801\u91cc
  /\u8c03\u7528\u94fe\u662f/u, // \u8c03\u7528\u94fe\u662f
  /(?:\u51fd\u6570|\u65b9\u6cd5).{0,20}\u5728.{0,50}\u6587\u4ef6/u,
  /\u5f53\u524d\u5b9e\u73b0\u662f/u, // \u5f53\u524d\u5b9e\u73b0\u662f
  /\u914d\u7f6e\u662f/u, // \u914d\u7f6e\u662f
  /\bin\s+the\s+code\b/iu,
  /\bcall\s+chain\s+is\b/iu,
  /\bthe\s+function\s+\w+\s+(?:is\s+(?:in|at|defined)|exists)/iu,
  /\bthe\s+config\s+is\b/iu,
];

const CCB_PARITY_PATTERNS: RegExp[] = [
  /\u7b49\u4e8e\s*ccb/iu, // \u7b49\u4e8e CCB
  /\u4e0e\s*ccb\s*(?:\u4e00\u81f4|\u5bf9\u9f50|parity)/iu,
  /\bccb\s+parity\b/iu,
  /\bproduction[-\s]?ready\b/iu,
];

const EXTERNAL_CURRENT_PATTERNS: RegExp[] = [
  /\u4eca\u5929/u, // \u4eca\u5929
  /\u6700\u65b0\u7248\u672c/u, // \u6700\u65b0\u7248\u672c
  /\u6700\u65b0\u6a21\u578b/u, // \u6700\u65b0\u6a21\u578b
  /\u5f53\u524d\u5b98\u7f51/u, // \u5f53\u524d\u5b98\u7f51
  /\u5f53\u524d\u4ef7\u683c/u, // \u5f53\u524d\u4ef7\u683c
  /\u5f53\u524d\s*api/iu, // \u5f53\u524d API
  /\u6700\u65b0\u4ef7\u683c/u, // \u6700\u65b0\u4ef7\u683c
  /\bToday'?s\b/iu,
  /\bcurrent\s+(?:price|version|API|website)/iu,
  /\blatest\s+(?:price|version|model|release)/iu,
];

// \u672c\u5730"\u5f53\u524d X"\u767d\u540d\u5355\uff1a\u5f53\u524d\u5206\u652f/\u76ee\u5f55/\u6587\u4ef6/\u4f1a\u8bdd/\u9879\u76ee/\u914d\u7f6e/\u5de5\u4f5c\u76ee\u5f55 \u7b49
// \u547d\u4e2d\u5373\u4e0d\u7b97 external_current_fact\uff0c\u907f\u514d\u8bef\u4f24\u666e\u901a\u672c\u5730\u67e5\u8be2\u3002
const LOCAL_CURRENT_WHITELIST =
  /\u5f53\u524d(?:\u5206\u652f|\u76ee\u5f55|\u6587\u4ef6|\u4f1a\u8bdd|\u9879\u76ee|\u5de5\u4f5c\u76ee\u5f55|\u6a21\u5f0f|\u7ec4\u4ef6|\u5b9e\u73b0\u662f)/u;

const BETA_READINESS_PATTERNS: RegExp[] = [
  /\bbeta\s+(?:ready|readiness|pass|completed)\b/iu,
  /\u8fdb\u5165\s*beta/u, // \u8fdb\u5165 beta
  /\u53ef\u4ee5\s*(?:\u8fdb\u5165|\u53d1\u5e03)\s*beta/u,
];

function detectMatches(
  text: string,
  patterns: RegExp[],
  kind: FinalAnswerClaimKind,
): FinalAnswerClaimMatch[] {
  const out: FinalAnswerClaimMatch[] = [];
  for (const re of patterns) {
    const match = re.exec(text);
    if (match) {
      out.push({ kind, phrase: match[0] });
    }
  }
  return out;
}

export function detectHighRiskClaims(text: string): FinalAnswerClaimMatch[] {
  if (!text) return [];
  const matches: FinalAnswerClaimMatch[] = [];
  matches.push(...detectMatches(text, BETA_READINESS_PATTERNS, "beta_readiness"));
  matches.push(...detectMatches(text, COMPLETION_PASS_PATTERNS, "completion_pass"));
  matches.push(...detectMatches(text, CODE_FACT_PATTERNS, "code_fact"));
  matches.push(...detectMatches(text, CCB_PARITY_PATTERNS, "ccb_parity"));
  // \u5916\u90e8\u5f53\u524d\u4e8b\u5b9e\uff1a\u5148\u53bb\u9664"\u5f53\u524d\u5206\u652f/\u76ee\u5f55/\u6587\u4ef6..."\u7b49\u672c\u5730\u767d\u540d\u5355\uff0c\u518d\u5339\u914d
  const sanitized = text.replace(LOCAL_CURRENT_WHITELIST, "");
  matches.push(...detectMatches(sanitized, EXTERNAL_CURRENT_PATTERNS, "external_current_fact"));
  return matches;
}

function evidenceTokens(record: EvidenceRecord): string {
  return [record.kind, record.source, record.summary, ...record.supportsClaims]
    .join(" ")
    .toLowerCase();
}

function evidenceSupportsCompletion(record: EvidenceRecord): boolean {
  if (record.kind === "test_result") {
    return /(?:status[=:\s]+)?pass(?![a-z])/iu.test(evidenceTokens(record));
  }
  const tokens = evidenceTokens(record);
  return /(?:test_passed|build_passed|typecheck_passed|diff_check_passed|smoke_passed|verified|tests passed|\u5df2\u9a8c\u8bc1|\u9a8c\u8bc1\u901a\u8fc7|\u6d4b\u8bd5\u901a\u8fc7)/iu.test(
    tokens,
  );
}

function evidenceSupportsCodeFact(record: EvidenceRecord): boolean {
  if (
    record.kind === "file_read" ||
    record.kind === "grep_result" ||
    record.kind === "index_query"
  ) {
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

const REQUIRED_EVIDENCE_LABEL: Record<FinalAnswerClaimKind, string> = {
  completion_pass: "test/build/typecheck/diff-check/smoke",
  code_fact: "Read/Grep/index",
  external_current_fact: "web_source",
  ccb_parity: "ccb-source \u672c\u5730\u8bc1\u636e\u6216 web_source",
  beta_readiness: "Beta readiness verdict (real-tui report-generation PASS)",
};

export function evaluateFinalAnswerClaims(
  text: string,
  evidence: EvidenceRecord[],
  now: Date = new Date(),
): FinalAnswerClaimVerdict {
  const matches = detectHighRiskClaims(text);
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
    if (kind === "completion_pass") {
      supporter = evidenceSupportsCompletion;
    } else if (kind === "code_fact") {
      supporter = evidenceSupportsCodeFact;
    } else if (kind === "external_current_fact") {
      supporter = evidenceSupportsExternalCurrent;
    } else if (kind === "ccb_parity") {
      supporter = evidenceSupportsCcbParity;
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
  const stalePart = hasStale ? "\u90e8\u5206\u65e9\u671f\u8bc1\u636e\u5df2\u8fc7\u671f\u88ab\u5ffd\u7565\u3002" : "";
  return `\u4f60\u4e0a\u6b21\u56de\u7b54\u91cc\u51fa\u73b0\u4e86\u9ad8\u98ce\u9669\u58f0\u660e\uff08${phrases.join(", ")}\uff09\uff0c\u4f46\u5f53\u524d\u4f1a\u8bdd\u6ca1\u6709\u5bf9\u5e94\u7c7b\u578b\u7684\u8bc1\u636e\uff08\u7f3a\uff1a${kinds}\uff09\u3002${stalePart}\u8bf7\u91cd\u5199\u56de\u7b54\uff1a\u5220\u9664\u6216\u964d\u7ea7\u672a\u9a8c\u8bc1\u7684\u58f0\u660e\u4e3a"\u672a\u9a8c\u8bc1 / \u5f85\u786e\u8ba4"\uff0c\u6216\u5148\u8c03\u7528\u5de5\u5177\u8865\u8bc1\u636e\u3002\u4ec5\u672c\u8f6e\u4e00\u6b21\u4fee\u6b63\u673a\u4f1a\u3002`;
}

// \u4fee\u6b63\u5931\u8d25\u540e\u672c\u5730\u964d\u7ea7\uff1a\u628a\u8fdd\u89c4 phrase \u4ece\u539f\u6587\u66ff\u6362\u4e3a"\u672a\u9a8c\u8bc1 / \u5f85\u786e\u8ba4"\uff0c\u5e76\u8ffd\u52a0\u4e00\u6bb5\u4eba\u8bdd\u77ed\u63d0\u793a\u3002
// \u4e0d\u66b4\u9732 internal validator id / FinalAnswerClaimGate / EvidenceSummary \u7b49\u5185\u90e8\u8bcd\u3002
export function buildDowngradedFinalAnswer(
  originalText: string,
  verdict: FinalAnswerClaimVerdict,
  language: Language,
): string {
  let safeText = originalText;
  for (const match of verdict.matchedClaims) {
    if (verdict.unsupportedKinds.includes(match.kind)) {
      const re = new RegExp(escapeRegExp(match.phrase), "giu");
      safeText = safeText.replace(re, language === "en-US" ? "[unverified]" : "[\u672a\u9a8c\u8bc1]");
    }
  }
  const kinds = Array.from(new Set(verdict.missingEvidenceKinds)).join(", ");
  const notice =
    language === "en-US"
      ? `\nI can't confirm these claims due to missing ${kinds} evidence; the reply above has been rephrased as unverified.`
      : `\n\u6211\u4e0d\u80fd\u786e\u8ba4\u8fd9\u4e9b\u58f0\u660e\uff0c\u56e0\u4e3a\u7f3a\u5c11 ${kinds} \u8bc1\u636e\uff1b\u4ee5\u4e0a\u56de\u7b54\u5df2\u6309"\u672a\u9a8c\u8bc1"\u8868\u8ff0\u3002`;
  return safeText + notice;
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
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
