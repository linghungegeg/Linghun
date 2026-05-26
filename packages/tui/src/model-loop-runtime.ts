/**
 * model-loop-runtime.ts — Pure model-loop helper functions
 * extracted from index.ts.
 *
 * Contains:
 * - Tool definition helpers (createToolInputSchema, createModelToolDefinitions,
 *   createModelToolDefinitionsForTools, createModelToolDefinitionsForReportGuard)
 * - Drift summary helpers (createToolUseDriftSummary, readToolInputString)
 * - Freshness pure helpers (needsFreshnessLiteBoundary, formatFreshnessLitePrimaryWarning)
 * - Natural file read pure helpers (isNaturalReadFileRequest, hasModelSynthesisIntent,
 *   looksLikeFilePath, extractNaturalReadPath, normalizeRelativePath,
 *   extractFileSearchKeywords, matchesFileKeywords, extractFileMentions,
 *   formatFileCandidates)
 * - Solution completeness pure helpers (createSolutionCompletenessStatus,
 *   inferSolutionCompletenessImpactAreas, formatSolutionCompletenessTrigger)
 *
 * Hard boundary: no sendMessage, no provider stream loop, no TuiContext state machine,
 * no store/session writes, no gateway calls, no permission state machine.
 */

import type { ModelToolDefinition } from "@linghun/providers";
import type { Language } from "@linghun/shared";
import { type ToolName, builtInTools } from "@linghun/tools";

import type { ReportWriteGuard } from "./permission-continuation-runtime.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FreshnessLiteState = {
  sensitive: boolean;
  webSourceEvidence: "present" | "missing";
};

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
// Freshness pure helpers
// ---------------------------------------------------------------------------

export function needsFreshnessLiteBoundary(text: string): boolean {
  return /最新|当前|现在|今天|今年|实时|外部资料|网页|官网|官方|新闻|版本|价格|latest|current|today|now|real[-\s]?time|external|web|official|news|price|version/iu.test(
    text,
  );
}

export function formatFreshnessLitePrimaryWarning(
  state: FreshnessLiteState,
  language: Language,
): string | undefined {
  if (!state.sensitive || state.webSourceEvidence === "present") {
    return undefined;
  }
  return language === "en-US"
    ? "Freshness note: no web_source evidence is available in this session, so any latest/current/external facts above are unverified and need confirmation."
    : "Freshness \u63d0\u793a\uff1a\u672c\u4f1a\u8bdd\u6ca1\u6709 web_source \u8bc1\u636e\uff0c\u4ee5\u4e0a\u6d89\u53ca\u6700\u65b0/\u5f53\u524d/\u5916\u90e8\u4e8b\u5b9e\u7684\u5185\u5bb9\u5747\u672a\u9a8c\u8bc1\uff0c\u9700\u8981\u8fdb\u4e00\u6b65\u786e\u8ba4\u3002";
}

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
