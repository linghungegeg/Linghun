import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, createWriteStream, openSync } from "node:fs";
import { mkdir, appendFile, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  type ToolDefinition,
  type ToolFactoryDefinition,
  type ToolLifecycleMetadata,
  createTool,
} from "./tool-runtime.js";
import { toolPrompts } from "./tools/prompts.js";
import { toolUserFacingNames } from "./tools/ui.js";
import { interpretCommandResult } from "./tools/Bash/command-semantics.js";
import { bingSearch, formatSearchOutput, applyDomainFilter } from "./tools/WebSearch/bing-scraper.js";
import type { WebSearchInput, SearchResult } from "./tools/WebSearch/bing-scraper.js";
import { webFetch, formatFetchOutput } from "./tools/WebFetch/web-fetch.js";
import type { WebFetchInput } from "./tools/WebFetch/web-fetch.js";

export type {
  ToolDefinition,
  ToolFactoryDefinition,
  ToolInterruptBehavior,
  ToolLifecycleMetadata,
  ToolPermissionDecision,
} from "./tool-runtime.js";
export { createTool } from "./tool-runtime.js";

export type ToolRisk = "low" | "medium" | "high";

export type ToolPermissionSpec = {
  risk: ToolRisk;
  scope: "workspace" | "command" | "session";
  reason: string;
  phase06Mode: "metadata-only";
};

export type ToolOutput = {
  text: string;
  summary?: string;
  preview?: string;
  details?: string;
  data?: unknown;
  truncated?: boolean;
  fullOutputPath?: string;
  evidenceId?: string;
  changedFiles?: string[];
};

export type ToolProgressEvent = {
  toolName: ToolName;
  stream: "stdout" | "stderr" | "system";
  text: string;
};

export type ToolChildProcessTrackOptions = {
  detached?: boolean;
  label?: string;
  cwd?: string;
  retainAfterExit?: boolean;
};

export type ReadSnapshot = {
  path: string;
  hash: string;
  mtimeMs: number;
  size: number;
};

export type SourcePackCandidate = {
  path: string;
  start: number;
  end: number;
  reason?: string;
  confidence?: number;
};

export type RecentToolDiagnostic = {
  source: ToolName;
  type: string;
  severity?: string;
  evidence: string;
  createdAt: string;
  toolUseId?: string;
  evidenceId?: string;
  command?: string;
  fallback?: string;
  target?: string;
  path?: string;
  targetHost?: string;
  targetPort?: number;
};

export type BashBackgroundResult = {
  taskId: string;
  exitCode: number;
  outcome: "completed" | "timeout" | "cancelled";
  outputPath: string;
  command: string;
};

export type ToolContext = {
  workspaceRoot: string;
  logRoot?: string;
  changedFiles: string[];
  todos: TodoItem[];
  readSnapshots?: Record<string, ReadSnapshot>;
  sourcePackCandidates?: SourcePackCandidate[];
  patchSummaries?: Record<string, DiffSummary>;
  recentDiagnostics?: RecentToolDiagnostic[];
  abortSignal?: AbortSignal;
  isHeadlessBench?: boolean;
  onProgress?: (event: ToolProgressEvent) => void | Promise<void>;
  onBackgroundBashComplete?: (result: BashBackgroundResult) => void;
  trackChildProcess?: (
    child: Pick<ChildProcess, "kill" | "pid" | "exitCode" | "signalCode" | "once">,
    options?: ToolChildProcessTrackOptions,
  ) => boolean;
};

export type ToolContextOptions = {
  sourcePackCandidates?: SourcePackCandidate[];
};

export type ToolName =
  | "Read"
  | "ReadSnippets"
  | "SourcePack"
  | "Write"
  | "Edit"
  | "MultiEdit"
  | "Grep"
  | "Glob"
  | "Bash"
  | "Todo"
  | "Diff"
  | "WebSearch"
  | "WebFetch";

export type TodoStatus = "pending" | "in_progress" | "completed" | "blocked";

export type TodoItem = {
  id: string;
  content: string;
  status: TodoStatus;
  evidence?: string;
};

export type DiffSummary = {
  changedFiles: string[];
  addedLines: number;
  removedLines: number;
  summary: string;
  riskyFiles: string[];
};

export type PatchHunk = {
  oldStart: number;
  newStart: number;
  contextBefore?: string[];
  oldLines: string[];
  newLines: string[];
  contextAfter?: string[];
  oldLineCount: number;
  newLineCount: number;
  truncated?: boolean;
};

export type StructuredPatchFile = {
  path: string;
  hunks: PatchHunk[];
};

export type StructuredPatch = {
  files: StructuredPatchFile[];
};

export type ReadInput = { path: string; offset?: number; limit?: number };
export type ReadSnippetsInput = {
  ranges: { path: string; start: number; end: number }[];
};
export type SourcePackInput = { query: string; limit?: number };
export type WriteInput = { path: string; content: string; expectedHash?: string };
export type EditInput = { path: string; oldText: string; newText: string; expectedHash?: string };
export type MultiEditInput = {
  path: string;
  edits: { oldText: string; newText: string }[];
  expectedHash?: string;
};
export type GrepInput = { pattern: string; path?: string; limit?: number };
export type GlobInput = { pattern: string; path?: string; limit?: number };
export type BashInput = {
  command?: string;
  description?: string;
  timeoutMs?: number;
  runInBackground?: boolean;
  run_in_background?: boolean;
};
type BashDiagnosticType =
  | "missing_command"
  | "missing_python_module"
  | "timeout"
  | "provider_or_network";
type BashDiagnosticSeverity = "info" | "recoverable" | "blocking";
type BashDiagnostic = {
  type: BashDiagnosticType;
  severity: BashDiagnosticSeverity;
  evidence: string;
  suggestion: string;
  command?: string;
  fallback?: string;
};
export type TodoInput =
  | { action: "list" }
  | { action: "add"; content: string; id?: string }
  | { action: "start" | "done" | "block"; id: string; content?: string; evidence?: string };
export type DiffInput = { files?: string[] };
export type { WebSearchInput, SearchResult } from "./tools/WebSearch/bing-scraper.js";
export type { WebFetchInput } from "./tools/WebFetch/web-fetch.js";

export type ToolRunResult = {
  id: string;
  name: ToolName;
  input: unknown;
  output: ToolOutput;
};

export const toolRegistryStatus = "ready" as const;

const DEFAULT_LIMIT = 200;
const DEFAULT_SEARCH_LIMIT = 100;
const DEFAULT_TOOL_TEXT_LIMIT = 50_000;
const MAX_READ_SNIPPET_RANGES = 20;
const MAX_READ_SNIPPET_LINES = 120;
const MAX_READ_SNIPPET_OUTPUT_CHARS = 200_000;
const SOURCE_PACK_DEFAULT_LIMIT = 6;
const SOURCE_PACK_MAX_LIMIT = 12;
const SOURCE_PACK_CONTEXT_LINES = 8;
const SOURCE_PACK_MAX_TERMS = 6;
const BASH_PREVIEW_LIMIT = 30_000;
const BASH_OUTPUT_TRUNCATION_NOTICE = "\n...（输出已截断，完整日志见 fullOutputPath）";
const BASH_DETAILS_TAIL_LINES = 80;
const BASH_TIMEOUT_MS = 120_000;
// Removed: headless auto-background is unsafe (foreground-to-background transition unreliable)
const MAX_TODO_ITEMS = 100;
const SEARCH_EXCLUDED_DIR_NAMES = ["node_modules", "dist", ".git", ".codebase-memory"];
const SEARCH_EXCLUDED_PATH_PREFIXES = [".linghun/logs", ".linghun/agent-runs", ".linghun/failures"];
const SEARCH_EXCLUDED_FILE_SUFFIXES = [".tsbuildinfo"];
const RG_TIMEOUT_MS = 30_000;

export function createToolContext(
  workspaceRoot = process.cwd(),
  options: ToolContextOptions = {},
): ToolContext {
  return {
    workspaceRoot: resolve(workspaceRoot),
    changedFiles: [],
    todos: [],
    readSnapshots: {},
    sourcePackCandidates: options.sourcePackCandidates,
    patchSummaries: {},
    recentDiagnostics: [],
  };
}

/**
 * **UNSAFE LOW-LEVEL PRIMITIVE.** Executes a built-in tool directly without
 * any permission policy check.
 *
 * D.13N — TUI main paths (model tool dispatch, slash commands) MUST go
 * through `decidePermission` (and by extension, the permission-policy-engine)
 * BEFORE calling `runTool`. This entry exists only for callers that have
 * already passed a policy decision (e.g. `executeApprovedModelToolUse` in
 * the TUI package). New consumers should add a permission gate at the
 * call site rather than bypassing here.
 *
 * Do NOT export this through wrapper modules without a permission check.
 */
export async function runTool(
  name: ToolName,
  input: unknown,
  context: ToolContext,
): Promise<ToolRunResult> {
  const tool = builtInTools[name];
  if (!tool) {
    throw new Error(`未知工具：${name}`);
  }

  if (!tool.lifecycle.enabled) {
    throw new Error(`工具已禁用：${name}。建议：运行 /features 或 /doctor 查看当前能力边界。`);
  }
  const validatedInput = tool.validateInput(input);
  const output = await tool.call(validatedInput, context);
  return {
    id: randomUUID(),
    name,
    input: validatedInput,
    output: normalizeToolOutput(output, tool),
  };
}

function defineTool<Input>(definition: ToolFactoryDefinition<Input>): ToolDefinition<Input> {
  return createTool(definition);
}

const toolDefinitions = {
  Read: defineTool<ReadInput>({
    name: "Read",
    title: "读取文件",
    description: "读取工作区文件内容。",
    permission: {
      risk: "low",
      scope: "workspace",
      reason: "只读查看文件内容。",
      phase06Mode: "metadata-only",
    },
    isReadOnly: true,
    isConcurrencySafe: true,
    lifecycle: readOnlyLifecycle(),
    validateInput: validateReadInput,
    call: readTool,
    prompt: () => toolPrompts.Read,
    userFacingName: () => toolUserFacingNames.Read,
    getToolUseSummary: (input) => `Read ${input.path}`,
    getActivityDescription: (input) => `Reading ${input.path}`,
  }),
  ReadSnippets: defineTool<ReadSnippetsInput>({
    name: "ReadSnippets",
    title: "读取代码片段",
    description: "一次读取多个工作区文件范围。",
    permission: {
      risk: "low",
      scope: "workspace",
      reason: "只读查看多个文件片段。",
      phase06Mode: "metadata-only",
    },
    isReadOnly: true,
    isConcurrencySafe: true,
    lifecycle: {
      ...readOnlyLifecycle(),
      maxResultSizeChars: MAX_READ_SNIPPET_OUTPUT_CHARS + 2_000,
    },
    validateInput: validateReadSnippetsInput,
    call: readSnippetsTool,
    prompt: () => toolPrompts.ReadSnippets,
    userFacingName: () => toolUserFacingNames.ReadSnippets,
    getToolUseSummary: (input) => `ReadSnippets ${input.ranges.length} ranges`,
    getActivityDescription: (input) => `Reading ${input.ranges.length} snippets`,
  }),
  SourcePack: defineTool<SourcePackInput>({
    name: "SourcePack",
    title: "定位代码片段",
    description: "按查询定位并返回候选代码片段。",
    permission: {
      risk: "low",
      scope: "workspace",
      reason: "只读搜索并返回候选代码片段。",
      phase06Mode: "metadata-only",
    },
    isReadOnly: true,
    isConcurrencySafe: true,
    lifecycle: {
      ...readOnlyLifecycle(),
      maxResultSizeChars: MAX_READ_SNIPPET_OUTPUT_CHARS + 2_000,
    },
    validateInput: validateSourcePackInput,
    call: sourcePackTool,
    prompt: () => toolPrompts.SourcePack,
    userFacingName: () => toolUserFacingNames.SourcePack,
    getToolUseSummary: (input) => `SourcePack ${input.query}`,
    getActivityDescription: (input) => `Locating snippets for ${input.query}`,
  }),
  Write: defineTool<WriteInput>({
    name: "Write",
    title: "写入文件",
    description: "在工作区内写入完整文件内容。",
    permission: {
      risk: "medium",
      scope: "workspace",
      reason: "会修改工作区文件，Phase 06 将接入权限审批。",
      phase06Mode: "metadata-only",
    },
    isReadOnly: false,
    isConcurrencySafe: false,
    lifecycle: writeLifecycle(),
    validateInput: validateWriteInput,
    call: writeTool,
    prompt: () => toolPrompts.Write,
    userFacingName: () => toolUserFacingNames.Write,
    getToolUseSummary: (input) => `Write ${input.path}`,
    getActivityDescription: (input) => `Writing ${input.path}`,
  }),
  Edit: defineTool<EditInput>({
    name: "Edit",
    title: "编辑文件",
    description: "在工作区内做唯一字符串替换。",
    permission: {
      risk: "low",
      scope: "workspace",
      reason: "会在工作区内做单文件唯一字符串替换，属于低风险编辑。",
      phase06Mode: "metadata-only",
    },
    isReadOnly: false,
    isConcurrencySafe: false,
    lifecycle: writeLifecycle(),
    validateInput: validateEditInput,
    call: editTool,
    prompt: () => toolPrompts.Edit,
    userFacingName: () => toolUserFacingNames.Edit,
    getToolUseSummary: (input) => `Edit ${input.path}`,
    getActivityDescription: (input) => `Editing ${input.path}`,
  }),
  MultiEdit: defineTool<MultiEditInput>({
    name: "MultiEdit",
    title: "批量编辑文件",
    description: "在同一文件内按顺序做多个唯一字符串替换。",
    permission: {
      risk: "medium",
      scope: "workspace",
      reason: "会修改工作区文件，并逐项要求 oldText 唯一。",
      phase06Mode: "metadata-only",
    },
    isReadOnly: false,
    isConcurrencySafe: false,
    lifecycle: writeLifecycle(),
    validateInput: validateMultiEditInput,
    call: multiEditTool,
    prompt: () => toolPrompts.MultiEdit,
    userFacingName: () => toolUserFacingNames.MultiEdit,
    getToolUseSummary: (input) => `MultiEdit ${input.path} (${input.edits.length} edits)`,
    getActivityDescription: (input) => `Editing ${input.path}`,
  }),
  Grep: defineTool<GrepInput>({
    name: "Grep",
    title: "搜索文本",
    description: "在工作区内按正则搜索文本。",
    permission: {
      risk: "low",
      scope: "workspace",
      reason: "只读搜索文件内容。",
      phase06Mode: "metadata-only",
    },
    isReadOnly: true,
    isConcurrencySafe: true,
    lifecycle: readOnlyLifecycle(),
    validateInput: validateGrepInput,
    call: grepTool,
    prompt: () => toolPrompts.Grep,
    userFacingName: () => toolUserFacingNames.Grep,
    getToolUseSummary: (input) => `Grep ${input.pattern}`,
    getActivityDescription: (input) => `Searching ${input.path ?? "."}`,
  }),
  Glob: defineTool<GlobInput>({
    name: "Glob",
    title: "匹配文件",
    description: "在工作区内按 glob 模式匹配文件。",
    permission: {
      risk: "low",
      scope: "workspace",
      reason: "只读列出文件路径。",
      phase06Mode: "metadata-only",
    },
    isReadOnly: true,
    isConcurrencySafe: true,
    lifecycle: readOnlyLifecycle(),
    validateInput: validateGlobInput,
    call: globTool,
    prompt: () => toolPrompts.Glob,
    userFacingName: () => toolUserFacingNames.Glob,
    getToolUseSummary: (input) => `Glob ${input.pattern}`,
    getActivityDescription: (input) => `Matching ${input.path ?? "."}`,
  }),
  Bash: defineTool<BashInput>({
    name: "Bash",
    title: "执行命令",
    description: "在工作区内执行 shell 命令并保存完整日志。",
    permission: {
      risk: "high",
      scope: "command",
      reason: "会执行本地命令；Phase 05 仅声明风险，Phase 06 接入审批。",
      phase06Mode: "metadata-only",
    },
    isReadOnly: false,
    isConcurrencySafe: false,
    isLongRunning: true,
    lifecycle: bashLifecycle(),
    validateInput: validateBashInput,
    call: bashTool,
    prompt: () => toolPrompts.Bash,
    userFacingName: () => toolUserFacingNames.Bash,
    getToolUseSummary: (input) => `Bash ${input.command}`,
    getActivityDescription: () => "Running command",
  }),
  Todo: defineTool<TodoInput>({
    name: "Todo",
    title: "任务列表",
    description: "维护当前会话任务、完成项和阻塞项。",
    permission: {
      risk: "low",
      scope: "session",
      reason: "只修改当前会话内任务状态。",
      phase06Mode: "metadata-only",
    },
    isReadOnly: false,
    isConcurrencySafe: false,
    lifecycle: sessionLifecycle(),
    validateInput: validateTodoInput,
    call: todoTool,
    prompt: () => toolPrompts.Todo,
    userFacingName: () => toolUserFacingNames.Todo,
    getToolUseSummary: (input) => `Todo ${input.action}`,
    getActivityDescription: (input) => `Updating todo ${input.action}`,
  }),
  Diff: defineTool<DiffInput>({
    name: "Diff",
    title: "改动摘要",
    description: "输出本轮工具改动文件列表和摘要。",
    permission: {
      risk: "low",
      scope: "workspace",
      reason: "只读汇总本轮 changedFiles。",
      phase06Mode: "metadata-only",
    },
    isReadOnly: true,
    isConcurrencySafe: true,
    lifecycle: readOnlyLifecycle(),
    validateInput: validateDiffInput,
    call: diffTool,
    prompt: () => toolPrompts.Diff,
    userFacingName: () => toolUserFacingNames.Diff,
    getToolUseSummary: () => "Diff summary",
    getActivityDescription: () => "Summarizing changes",
  }),
  WebSearch: defineTool<WebSearchInput>({
    name: "WebSearch",
    title: "搜索网页",
    description: "通过 Bing 搜索互联网，返回标题、链接和摘要。零 API Key，国内直连。",
    permission: {
      risk: "low",
      scope: "session",
      reason: "只读搜索公开网页信息，不涉及工作区文件。",
      phase06Mode: "metadata-only",
    },
    isReadOnly: true,
    isConcurrencySafe: true,
    lifecycle: {
      enabled: true,
      destructive: false,
      interruptBehavior: "abortable",
      maxResultSizeChars: 20_000,
    },
    validateInput: validateWebSearchInput,
    call: webSearchTool,
    prompt: () => toolPrompts.WebSearch,
    userFacingName: () => toolUserFacingNames.WebSearch,
    getToolUseSummary: (input) => `搜索 "${input.query}"`,
    getActivityDescription: (input) => `搜索网页: ${input.query}`,
  }),
  WebFetch: defineTool<WebFetchInput>({
    name: "WebFetch",
    title: "抓取网页",
    description: "抓取指定 URL 的网页内容并转为纯文本。零 API Key。",
    permission: {
      risk: "low",
      scope: "session",
      reason: "只读抓取公开网页内容，内网地址已拦截。",
      phase06Mode: "metadata-only",
    },
    isReadOnly: true,
    isConcurrencySafe: true,
    lifecycle: {
      enabled: true,
      destructive: false,
      interruptBehavior: "abortable",
      maxResultSizeChars: 60_000,
    },
    validateInput: validateWebFetchInput,
    call: webFetchTool,
    prompt: () => toolPrompts.WebFetch,
    userFacingName: () => toolUserFacingNames.WebFetch,
    getToolUseSummary: (input) => `Fetch ${input.url}`,
    getActivityDescription: (input) => `抓取网页: ${input.url}`,
  }),
} satisfies Record<ToolName, ToolDefinition>;

export const builtInTools: Record<ToolName, ToolDefinition> = toolDefinitions;

function readOnlyLifecycle(): ToolLifecycleMetadata {
  return {
    enabled: true,
    destructive: false,
    interruptBehavior: "abortable",
    maxResultSizeChars: DEFAULT_TOOL_TEXT_LIMIT,
  };
}

function writeLifecycle(): ToolLifecycleMetadata {
  return {
    enabled: true,
    destructive: true,
    interruptBehavior: "best-effort",
    maxResultSizeChars: DEFAULT_TOOL_TEXT_LIMIT,
  };
}

function bashLifecycle(): ToolLifecycleMetadata {
  return {
    enabled: true,
    destructive: true,
    interruptBehavior: "abortable",
    maxResultSizeChars: BASH_PREVIEW_LIMIT,
  };
}

function sessionLifecycle(): ToolLifecycleMetadata {
  return {
    enabled: true,
    destructive: false,
    interruptBehavior: "not-supported",
    maxResultSizeChars: DEFAULT_TOOL_TEXT_LIMIT,
  };
}

function normalizeToolOutput(output: ToolOutput, tool: ToolDefinition): ToolOutput {
  if (output.text.length <= tool.lifecycle.maxResultSizeChars) {
    return output;
  }
  const preview = `${output.text.slice(0, tool.lifecycle.maxResultSizeChars)}\n...（输出已截断，完整内容见 details/fullOutputPath 或 transcript）`;
  const details = output.truncated ? output.details : output.details ?? output.text;
  return {
    ...output,
    text: preview,
    preview: output.preview ?? preview,
    details,
    truncated: true,
  };
}

function validateRecord(input: unknown, toolName: ToolName): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${toolName} 输入必须是对象。建议：按工具 schema 传入 JSON object。`);
  }
  return input as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, key: string, toolName: ToolName): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${toolName}.${key} 必须是非空字符串。`);
  }
  return value;
}

function readOptionalString(
  record: Record<string, unknown>,
  key: string,
  toolName: ToolName,
): string | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${toolName}.${key} 必须是字符串。`);
  }
  return value;
}

function normalizeOptionalWorkspacePath(path: string | undefined): string | undefined {
  if (path === undefined) return undefined;
  return path.trim().length === 0 ? undefined : path;
}

function readOptionalPositiveInteger(
  record: Record<string, unknown>,
  key: string,
  toolName: ToolName,
): number | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`${toolName}.${key} 必须是非负整数。`);
  }
  return value as number;
}

function validateReadInput(input: unknown): ReadInput {
  const record = validateRecord(input, "Read");
  return {
    path: readString(record, "path", "Read"),
    offset: readOptionalPositiveInteger(record, "offset", "Read"),
    limit: readOptionalPositiveInteger(record, "limit", "Read"),
  };
}

function validateReadSnippetsInput(input: unknown): ReadSnippetsInput {
  const record = validateRecord(input, "ReadSnippets");
  const ranges = record.ranges;
  if (!Array.isArray(ranges) || ranges.length === 0) {
    throw new Error("ReadSnippets.ranges 必须是非空数组。");
  }
  if (ranges.length > MAX_READ_SNIPPET_RANGES) {
    throw new Error(`ReadSnippets.ranges 最多 ${MAX_READ_SNIPPET_RANGES} 个范围。`);
  }
  return {
    ranges: ranges.map((item, index) => {
      const range = validateRecord(item, "ReadSnippets");
      const start = readPositiveLineNumber(range, "start", "ReadSnippets");
      const end = readPositiveLineNumber(range, "end", "ReadSnippets");
      if (end < start) {
        throw new Error(`ReadSnippets.ranges[${index}].end 必须大于等于 start。`);
      }
      return {
        path: readString(range, "path", "ReadSnippets"),
        start,
        end,
      };
    }),
  };
}

function validateSourcePackInput(input: unknown): SourcePackInput {
  const record = validateRecord(input, "SourcePack");
  const limit = readOptionalPositiveInteger(record, "limit", "SourcePack");
  return {
    query: readString(record, "query", "SourcePack"),
    limit: limit === undefined ? undefined : Math.min(Math.max(limit, 1), SOURCE_PACK_MAX_LIMIT),
  };
}

function readPositiveLineNumber(
  record: Record<string, unknown>,
  key: string,
  toolName: ToolName,
): number {
  const value = record[key];
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new Error(`${toolName}.${key} 必须是 1-based 正整数行号。`);
  }
  return value as number;
}

function validateWriteInput(input: unknown): WriteInput {
  const record = validateRecord(input, "Write");
  return {
    path: readString(record, "path", "Write"),
    content: readString(record, "content", "Write"),
    expectedHash: readOptionalString(record, "expectedHash", "Write"),
  };
}

function validateEditInput(input: unknown): EditInput {
  const record = validateRecord(input, "Edit");
  return {
    path: readString(record, "path", "Edit"),
    oldText: readString(record, "oldText", "Edit"),
    newText: readString(record, "newText", "Edit"),
    expectedHash: readOptionalString(record, "expectedHash", "Edit"),
  };
}

function validateMultiEditInput(input: unknown): MultiEditInput {
  const record = validateRecord(input, "MultiEdit");
  const edits = record.edits;
  if (!Array.isArray(edits) || edits.length === 0) {
    throw new Error("MultiEdit.edits 必须是非空数组。");
  }
  return {
    path: readString(record, "path", "MultiEdit"),
    expectedHash: readOptionalString(record, "expectedHash", "MultiEdit"),
    edits: edits.map((item) => {
      const edit = validateRecord(item, "MultiEdit");
      return {
        oldText: readString(edit, "oldText", "MultiEdit"),
        newText: readString(edit, "newText", "MultiEdit"),
      };
    }),
  };
}

function validateGrepInput(input: unknown): GrepInput {
  const record = validateRecord(input, "Grep");
  return {
    pattern: readString(record, "pattern", "Grep"),
    path: normalizeOptionalWorkspacePath(readOptionalString(record, "path", "Grep")),
    limit: readOptionalPositiveInteger(record, "limit", "Grep"),
  };
}

function validateGlobInput(input: unknown): GlobInput {
  const record = validateRecord(input, "Glob");
  return {
    pattern: readString(record, "pattern", "Glob"),
    path: normalizeOptionalWorkspacePath(readOptionalString(record, "path", "Glob")),
    limit: readOptionalPositiveInteger(record, "limit", "Glob"),
  };
}

function validateBashInput(input: unknown): BashInput {
  const record = validateRecord(input, "Bash");
  const command = readOptionalString(record, "command", "Bash");
  if (command === undefined) {
    throw new Error("Bash.command 必须提供。");
  }
  const runInBackground =
    record.runInBackground === true || record.run_in_background === true;
  return {
    command,
    description: readOptionalString(record, "description", "Bash"),
    timeoutMs: readOptionalPositiveInteger(record, "timeoutMs", "Bash"),
    ...(runInBackground ? { runInBackground: true } : {}),
  };
}

function validateTodoInput(input: unknown): TodoInput {
  const record = validateRecord(input, "Todo");
  const action = readString(record, "action", "Todo");
  if (action === "list") {
    return { action };
  }
  if (action === "add") {
    return { action, content: readString(record, "content", "Todo") };
  }
  if (action === "start" || action === "done" || action === "block") {
    return {
      action,
      id: readString(record, "id", "Todo"),
      content: readOptionalString(record, "content", "Todo"),
      evidence: readOptionalString(record, "evidence", "Todo"),
    };
  }
  throw new Error("Todo.action 必须是 list/add/start/done/block。");
}

function validateDiffInput(input: unknown): DiffInput {
  const record = validateRecord(input ?? {}, "Diff");
  const files = record.files;
  if (files === undefined) {
    return {};
  }
  if (!Array.isArray(files) || !files.every((item) => typeof item === "string")) {
    throw new Error("Diff.files 必须是字符串数组。");
  }
  return { files };
}

function validateWebSearchInput(input: unknown): WebSearchInput {
  const record = validateRecord(input, "WebSearch");
  const query = readString(record, "query", "WebSearch");
  const num_results = readOptionalPositiveInteger(record, "num_results", "WebSearch") ?? 8;
  const rawAllowedDomains = readOptionalStringArray(record, "allowed_domains", "WebSearch");
  const rawBlockedDomains = readOptionalStringArray(record, "blocked_domains", "WebSearch");
  const allowed_domains =
    rawAllowedDomains && rawAllowedDomains.length > 0 ? rawAllowedDomains : undefined;
  const blocked_domains =
    rawBlockedDomains && rawBlockedDomains.length > 0 ? rawBlockedDomains : undefined;
  if (allowed_domains && blocked_domains) {
    throw new Error("WebSearch: allowed_domains 和 blocked_domains 不能同时使用。");
  }
  return { query, num_results, allowed_domains, blocked_domains };
}

function validateWebFetchInput(input: unknown): WebFetchInput {
  const record = validateRecord(input, "WebFetch");
  const url = readString(record, "url", "WebFetch");
  const prompt = readOptionalString(record, "prompt", "WebFetch");
  return { url, prompt };
}

function readOptionalStringArray(
  record: Record<string, unknown>,
  key: string,
  toolName: ToolName,
): string[] | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${toolName}.${key} 必须是字符串数组或 undefined。`);
  }
  return value;
}

async function readTool(input: ReadInput, context: ToolContext): Promise<ToolOutput> {
  const filePath = resolveWorkspacePath(context.workspaceRoot, input.path);
  const content = await readFile(filePath, "utf8");
  const info = await stat(filePath);
  rememberReadSnapshot(context, filePath, content, info);
  const lines = splitContentLines(content);
  const offset = Math.max(input.offset ?? 0, 0);
  const limit = Math.max(input.limit ?? DEFAULT_LIMIT, 1);
  const selected = lines.slice(offset, offset + limit);
  const windowTruncated = offset > 0 || offset + limit < lines.length;
  const textLines = selected.map((line, index) => `${offset + index + 1}\t${line}`);
  let text = textLines.join("\n");
  const budgetTruncated = text.length > DEFAULT_TOOL_TEXT_LIMIT;
  if (windowTruncated || budgetTruncated) {
    const marker = `...（只显示读取窗口：选中 ${selected.length} 行 / 全文 ${lines.length} 行；不是完整文件）`;
    if (budgetTruncated) {
      text = `${text.slice(0, DEFAULT_TOOL_TEXT_LIMIT - marker.length - 1)}\n${marker}`;
    } else {
      text = `${text}\n${marker}`;
    }
  }
  return {
    text,
    data: {
      path: relativePath(context.workspaceRoot, filePath),
      lines: selected.length,
      selectedLines: selected.length,
      windowLines: selected.length,
      totalLines: lines.length,
      contentLines: lines.length,
      hash: hashText(content),
      newline: detectNewlineStyle(content),
    },
    truncated: windowTruncated || budgetTruncated,
  };
}

type SnippetRangeOutput = {
  path: string;
  start: number;
  end: number;
  content: string;
  requestedStart: number;
  requestedEnd: number;
  totalLines?: number;
  truncated: boolean;
  error?: string;
};

async function readSnippetsTool(
  input: ReadSnippetsInput,
  context: ToolContext,
): Promise<ToolOutput> {
  const ranges: SnippetRangeOutput[] = [];
  let remainingChars = MAX_READ_SNIPPET_OUTPUT_CHARS;
  let safetyTruncated = false;

  for (const range of input.ranges) {
    const requestedEnd = range.end;
    const boundedEnd = Math.min(range.end, range.start + MAX_READ_SNIPPET_LINES - 1);
    const rangeLineTruncated = boundedEnd < requestedEnd;
    try {
      const filePath = resolveWorkspacePath(context.workspaceRoot, range.path);
      const content = await readFile(filePath, "utf8");
      const info = await stat(filePath);
      rememberReadSnapshot(context, filePath, content, info);
      const lines = splitContentLines(content);
      const selected = lines.slice(range.start - 1, boundedEnd);
      const actualEnd = selected.length > 0 ? range.start + selected.length - 1 : range.start - 1;
      const numbered = selected.map((line, index) => `${range.start + index}\t${line}`).join("\n");
      const capped = applySnippetSafetyCap(numbered, remainingChars);
      remainingChars -= capped.usedChars;
      safetyTruncated ||= capped.truncated;
      ranges.push({
        path: relativePath(context.workspaceRoot, filePath),
        start: range.start,
        end: actualEnd,
        content: capped.content,
        requestedStart: range.start,
        requestedEnd,
        totalLines: lines.length,
        truncated: rangeLineTruncated || capped.truncated,
      });
      if (capped.truncated) {
        remainingChars = 0;
      }
    } catch (error) {
      ranges.push({
        path: range.path,
        start: range.start,
        end: boundedEnd,
        content: "",
        requestedStart: range.start,
        requestedEnd,
        truncated: rangeLineTruncated,
        error: formatDiagnosticError(error),
      });
    }
  }

  const text = formatReadSnippetsOutput(ranges, safetyTruncated);
  const okCount = ranges.filter((range) => !range.error).length;
  return {
    text,
    summary: `ReadSnippets: ${okCount}/${ranges.length} ranges`,
    data: {
      ranges,
      count: okCount,
      requestedRanges: input.ranges.length,
      safetyTruncated,
    },
    truncated: ranges.some((range) => range.truncated) || safetyTruncated,
  };
}

function applySnippetSafetyCap(content: string, remainingChars: number): {
  content: string;
  usedChars: number;
  truncated: boolean;
} {
  if (remainingChars <= 0) {
    return {
      content: "...（结果已截断，后续内容省略；如需精读请指定更小范围。）",
      usedChars: 0,
      truncated: true,
    };
  }
  if (content.length <= remainingChars) {
    return { content, usedChars: content.length, truncated: false };
  }
  const suffix = "\n...（结果已截断，后续内容省略；如需精读请指定更小范围。）";
  const sliceLength = Math.max(0, remainingChars - suffix.length);
  return {
    content: `${content.slice(0, sliceLength)}${suffix}`,
    usedChars: remainingChars,
    truncated: true,
  };
}

function formatReadSnippetsOutput(ranges: SnippetRangeOutput[], safetyTruncated: boolean): string {
  const lines: string[] = [];
  for (const range of ranges) {
    const header = `${range.path}:${range.start}-${range.end}`;
    if (range.error) {
      lines.push(`${header}\nERROR: ${range.error}`);
      continue;
    }
    lines.push(`${header}\n${range.content}`);
    if (range.truncated) {
      lines.push("...（该范围已截断；可继续读取后续范围。）");
    }
  }
  if (safetyTruncated) {
    lines.push("...（结果已截断，后续内容省略；如需精读请指定更小范围。）");
  }
  return lines.join("\n\n");
}

type SourcePackMatch = {
  path: string;
  line: number;
  text: string;
  term: string;
  source: "index" | "rg" | "local_scan" | "file_name";
  start?: number;
  end?: number;
  confidence?: number;
  reason?: string;
};

async function sourcePackTool(input: SourcePackInput, context: ToolContext): Promise<ToolOutput> {
  const limit = input.limit ?? SOURCE_PACK_DEFAULT_LIMIT;
  const terms = extractSourcePackTerms(input.query);
  if (terms.length === 0) {
    return {
      text: "empty: query did not contain searchable terms.",
      summary: "SourcePack: 0 snippets",
      data: { query: input.query, snippets: [], count: 0, empty: true },
    };
  }

  const matchResult = await findSourcePackMatches(input.query, terms, context, limit * 4);
  const snippets: Array<
    SnippetRangeOutput & {
      reason: string;
      confidence: number;
      source: SourcePackMatch["source"];
    }
  > = [];
  const seen = new Set<string>();
  let remainingChars = MAX_READ_SNIPPET_OUTPUT_CHARS;
  let safetyTruncated = false;

  for (const match of matchResult.matches) {
    if (snippets.length >= limit) break;
    const start = match.start ?? Math.max(1, match.line - SOURCE_PACK_CONTEXT_LINES);
    const end = match.end ?? match.line + SOURCE_PACK_CONTEXT_LINES;
    const key = `${match.path}:${start}:${end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const filePath = resolveWorkspacePath(context.workspaceRoot, match.path);
      const content = await readFile(filePath, "utf8");
      const info = await stat(filePath);
      rememberReadSnapshot(context, filePath, content, info);
      const lines = splitContentLines(content);
      const boundedEnd = Math.min(end, lines.length);
      const selected = lines.slice(start - 1, boundedEnd);
      const numbered = selected.map((line, index) => `${start + index}\t${line}`).join("\n");
      const capped = applySnippetSafetyCap(numbered, remainingChars);
      remainingChars -= capped.usedChars;
      safetyTruncated ||= capped.truncated;
      snippets.push({
        path: relativePath(context.workspaceRoot, filePath),
        start,
        end: boundedEnd,
        content: capped.content,
        requestedStart: start,
        requestedEnd: end,
        totalLines: lines.length,
        truncated: capped.truncated,
        reason: match.reason ?? `matched "${match.term}" at line ${match.line}`,
        confidence: estimateSourcePackConfidence(input.query, match),
        source: match.source,
      });
      if (capped.truncated) {
        break;
      }
    } catch {
      continue;
    }
  }

  if (snippets.length === 0) {
    return {
      text: "empty: no matching source snippets found.",
      summary: "SourcePack: 0 snippets",
      data: { query: input.query, snippets: [], count: 0, empty: true },
    };
  }

  const text = formatSourcePackOutput(snippets, safetyTruncated);
  return {
    text,
    summary: `SourcePack: ${snippets.length} snippets`,
    data: {
      query: input.query,
      snippets,
      count: snippets.length,
      searchedTerms: terms,
      source: matchResult.source,
      fallback: matchResult.source !== "index",
      candidatePaths: unique(snippets.map((snippet) => snippet.path)),
      safetyTruncated,
    },
    truncated: safetyTruncated || snippets.some((snippet) => snippet.truncated),
  };
}

function splitContentLines(content: string): string[] {
  if (content.length === 0) {
    return [];
  }
  return content.replace(/\r?\n$/, "").split(/\r?\n/);
}

async function writeTool(input: WriteInput, context: ToolContext): Promise<ToolOutput> {
  const filePath = resolveWorkspacePath(context.workspaceRoot, input.path);
  const before = await readExistingFile(filePath);
  const readGuard = ensureReadBeforeEdit(context, filePath, before, input.expectedHash);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, input.content, "utf8");
  const afterInfo = await stat(filePath);
  rememberReadSnapshot(context, filePath, input.content, afterInfo);
  recordChangedFile(context, filePath);
  return createEditOutput(
    context,
    "Write",
    filePath,
    before?.content ?? "",
    input.content,
    readGuard,
  );
}

async function editTool(input: EditInput, context: ToolContext): Promise<ToolOutput> {
  const filePath = resolveWorkspacePath(context.workspaceRoot, input.path);
  const before = await readExistingFile(filePath);
  if (!before) {
    throw new Error(
      `文件不存在：${relativePath(context.workspaceRoot, filePath)}。建议：确认路径或改用 Write 创建新文件。`,
    );
  }
  const readGuard = ensureReadBeforeEdit(context, filePath, before, input.expectedHash);
  try {
    ensureUnique(before.content, input.oldText);
  } catch (error) {
    const message = error instanceof Error ? error.message : "唯一性检查失败。";
    throw new Error(`${message} 建议：重新 Read 文件，确认最新内容后再提交可唯一匹配的编辑。`);
  }
  const next = before.content.replace(input.oldText, input.newText);
  await writeFile(filePath, next, "utf8");
  const afterInfo = await stat(filePath);
  rememberReadSnapshot(context, filePath, next, afterInfo);
  recordChangedFile(context, filePath);
  return createEditOutput(context, "Edit", filePath, before.content, next, readGuard);
}

async function multiEditTool(input: MultiEditInput, context: ToolContext): Promise<ToolOutput> {
  const filePath = resolveWorkspacePath(context.workspaceRoot, input.path);
  if (!Array.isArray(input.edits) || input.edits.length === 0) {
    throw new Error("MultiEdit 需要至少 1 个 edits 项。建议：传入 edits=[{oldText,newText}]。");
  }

  const before = await readExistingFile(filePath);
  if (!before) {
    throw new Error(
      `文件不存在：${relativePath(context.workspaceRoot, filePath)}。建议：确认路径或改用 Write 创建新文件。`,
    );
  }
  const readGuard = ensureReadBeforeEdit(context, filePath, before, input.expectedHash);
  let content = before.content;
  for (const [index, edit] of input.edits.entries()) {
    try {
      ensureUnique(content, edit.oldText);
    } catch (error) {
      const message = error instanceof Error ? error.message : "唯一性检查失败。";
      throw new Error(
        `第 ${index + 1} 个编辑失败：${message} 建议：重新 Read 文件，确认最新内容后再按顺序提交唯一匹配片段。`,
      );
    }
    content = content.replace(edit.oldText, edit.newText);
  }

  await writeFile(filePath, content, "utf8");
  const afterInfo = await stat(filePath);
  rememberReadSnapshot(context, filePath, content, afterInfo);
  recordChangedFile(context, filePath);
  return createEditOutput(
    context,
    "MultiEdit",
    filePath,
    before.content,
    content,
    readGuard,
    input.edits.length,
  );
}

async function grepTool(input: GrepInput, context: ToolContext): Promise<ToolOutput> {
  const root = resolveWorkspacePath(context.workspaceRoot, input.path ?? ".");
  const expression = createGrepExpression(input.pattern);
  const limit = input.limit ?? DEFAULT_SEARCH_LIMIT;
  const rgMatches = await tryRipgrepSearch(input, context, root, limit);
  if (rgMatches) {
    return {
      text: rgMatches.matches.length === 0 ? "未找到匹配内容。" : rgMatches.matches.join("\n"),
      data: { count: rgMatches.matches.length, backend: "rg" },
      truncated: rgMatches.truncated,
    };
  }
  const matches: string[] = [];

  for await (const filePath of listFiles(root, () => matches.length >= limit)) {
    const content = await safeReadText(filePath, context);
    if (content === null) {
      continue;
    }
    const lines = content.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      if (expression.test(line)) {
        matches.push(`${relativePath(context.workspaceRoot, filePath)}:${index + 1}: ${line}`);
        if (matches.length >= limit) {
          break;
        }
      }
    }
  }

  return {
    text: matches.length === 0 ? "未找到匹配内容。" : matches.join("\n"),
    data: { count: matches.length },
    truncated: matches.length >= limit,
  };
}

function createGrepExpression(pattern: string): RegExp {
  if (pattern.startsWith("(?i)")) {
    return new RegExp(pattern.slice(4), "i");
  }
  return new RegExp(pattern);
}

async function globTool(input: GlobInput, context: ToolContext): Promise<ToolOutput> {
  const root = resolveWorkspacePath(context.workspaceRoot, input.path ?? ".");
  const limit = input.limit ?? DEFAULT_SEARCH_LIMIT;
  const rgMatches = await tryRipgrepFiles(input, context, root, limit);
  if (rgMatches) {
    return {
      text: rgMatches.matches.length === 0 ? "未找到匹配文件。" : rgMatches.matches.join("\n"),
      data: { count: rgMatches.matches.length, backend: "rg" },
      truncated: rgMatches.truncated,
    };
  }
  const matcher = globToRegExp(input.pattern);
  const matches: string[] = [];

  for await (const filePath of listFiles(root, () => matches.length >= limit)) {
    const rel = relativePath(context.workspaceRoot, filePath);
    if (matcher.test(rel) || matcher.test(basename(filePath))) {
      matches.push(rel);
    }
    if (matches.length >= limit) {
      break;
    }
  }

  return {
    text: matches.length === 0 ? "未找到匹配文件。" : matches.join("\n"),
    data: { count: matches.length },
    truncated: matches.length >= limit,
  };
}

type SecretPattern = [RegExp, string | ((m: string, ...args: any[]) => string)];

const SECRET_PATTERNS: SecretPattern[] = [
  [/(?:-H\s+|--header\s+)?["']?\s*[Aa]uthorization\s*:\s*Bearer\s+\S+/g, "Authorization: Bearer [REDACTED]"],
  [/(?:-H\s+|--header\s+)?["']?\s*[Aa]uthorization\s*:\s*Basic\s+\S+/g, "Authorization: Basic [REDACTED]"],
  [/(?:-H\s+|--header\s+)?["']?\s*[Xx]-(?:[Aa]pi|[Ff]unctions|[Aa]uth|[Tt]oken)[- ]?[Kk]ey\s*:\s*\S+/g, (m: string) => `${m.split(":")[0]}: [REDACTED_HEADER]`],
  [/--(?:token|api-key|api[_\-]?key|secret|access[_\-]?token|pat)\s+["']?\s*\S+/g, (m: string) => `${m.split(/\s+/)[0] ?? m} [REDACTED]`],
  [/(?:AWS_SECRET_ACCESS_KEY|AWS_ACCESS_KEY_ID|AZURE_OPENAI_API_KEY|GITHUB_TOKEN|GITLAB_TOKEN|NPM_TOKEN|DOCKER_PASSWORD|OPENAI_API_KEY|ANTHROPIC_API_KEY|GOOGLE_API_KEY|COHERE_API_KEY|HF_TOKEN|HUGGINGFACE_TOKEN|DEEPSEEK_API_KEY)\s*[=:]\s*\S+/gi, (m: string) => `${m.split(/[=:]/)[0] ?? m}=[REDACTED_ENV]`],
  [/(?:SECRET|TOKEN|KEY|PASSWORD|PASSWD)\s*[=:]\s*\S{8,}/gi, (m: string) => `${m.split(/[=:]/)[0] ?? m}=[REDACTED]`],
];

function sanitizeSecrets(text: string): string {
  let sanitized = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    sanitized = typeof replacement === "string"
      ? sanitized.replace(pattern, replacement)
      : sanitized.replace(pattern, replacement);
  }
  return sanitized;
}

async function bashTool(input: BashInput, context: ToolContext): Promise<ToolOutput> {
  if (!input.command) {
    throw new Error("Bash.command 必须提供。");
  }
  const logRoot = context.logRoot ?? join(context.workspaceRoot, ".linghun", "logs", "tools");
  await mkdir(logRoot, { recursive: true });
  const fullOutputPath = join(logRoot, `bash-${Date.now()}-${randomUUID()}.log`);
  const timeoutMs = input.timeoutMs ?? BASH_TIMEOUT_MS;
  const adapted = adaptShellCommand(input.command);
  // Background execution: only when explicitly requested via runInBackground=true
  if (input.runInBackground === true) {
    const taskId = randomUUID();
    void runBackgroundBash({
      taskId,
      command: adapted.command,
      originalCommand: input.command,
      cwd: context.workspaceRoot,
      timeoutMs,
      fullOutputPath,
      adapter: adapted.adapter,
      logCommand: adapted.logCommand,
      retainAfterReturn: isHeadlessBenchContext(context),
      abortSignal: context.abortSignal,
      trackChildProcess: context.trackChildProcess,
      onComplete: context.onBackgroundBashComplete,
    });
    return {
      text: `命令已在后台启动。\ntaskId: ${taskId}\noutputPath: ${fullOutputPath}`,
      data: {
        backgroundTaskId: taskId,
        outputPath: fullOutputPath,
        command: sanitizeSecrets(input.command),
      },
    };
  }
  const commandForLog = adapted.logCommand ?? adapted.command;
  const adapterLines =
    adapted.command === input.command && adapted.adapter === "native"
      ? []
      : [
          `adapter ${adapted.adapter}`,
          `original command ${summarizeOriginalShellCommand(input.command)}`,
        ];
  const result = await runShell(
    adapted.command,
    context.workspaceRoot,
    timeoutMs,
    fullOutputPath,
    [`$ ${sanitizeSecrets(commandForLog)}`, ...adapterLines],
    context.abortSignal,
    (stream, text) => void context.onProgress?.({ toolName: "Bash", stream, text }),
    context.trackChildProcess,
  );
  const cmdInterpretation = interpretCommandResult(input.command, result.exitCode);
  const diagnostics = createBashOutcomeDiagnostics(result.outcome);
  const trailerLines = [
    "",
    `exit code ${result.exitCode}`,
    `outcome ${result.outcome}`,
    ...(cmdInterpretation.message ? [`returnCodeInterpretation: ${cmdInterpretation.message}`] : []),
  ];
  await appendFileToPath(fullOutputPath, `${trailerLines.join("\n")}\n`);
  result.capture.appendLogOnly(`${trailerLines.join("\n")}\n`);
  const preview = result.capture.getPreview(BASH_OUTPUT_TRUNCATION_NOTICE);
  const details = createBashDetails(fullOutputPath, result.capture);
  const data =
    adapted.adapter === "native"
      ? { exitCode: result.exitCode, outcome: result.outcome }
      : { exitCode: result.exitCode, outcome: result.outcome, adapter: adapted.adapter };
  const outputData = {
    ...data,
    ...(cmdInterpretation.message ? { returnCodeInterpretation: cmdInterpretation.message } : {}),
    ...(cmdInterpretation.isError === false && result.exitCode !== 0 ? { isError: false } : {}),
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
  };
  const truncated = result.capture.isTruncated();
  return {
    text: preview,
    details,
    data: outputData,
    truncated,
    fullOutputPath,
  };
}

function createBashDetails(fullOutputPath: string, capture: BashOutputCapture): string {
  return [
    `fullOutputPath: ${fullOutputPath}`,
    "--- summary",
    ...capture.getSummaryLines(8),
    "--- tail",
    ...capture.getTailLines(BASH_DETAILS_TAIL_LINES),
  ].join("\n");
}

type BashOutputCapture = {
  appendOutput: (text: string) => void;
  appendSystem: (text: string) => void;
  appendLogOnly: (text: string) => void;
  getPreview: (truncationNotice: string) => string;
  getSummaryLines: (limit: number) => string[];
  getTailLines: (limit: number) => string[];
  isTruncated: () => boolean;
};

function createBashOutputCapture(): BashOutputCapture {
  let outputPreview = "";
  let outputChars = 0;
  let summaryText = "";
  let tailText = "";
  const summaryCharLimit = 8_000;
  const tailCharLimit = 64_000;

  const appendLogText = (text: string): void => {
    if (!text) return;
    if (summaryText.length < summaryCharLimit) {
      summaryText += text.slice(0, summaryCharLimit - summaryText.length);
    }
    tailText = `${tailText}${text}`;
    if (tailText.length > tailCharLimit) {
      tailText = tailText.slice(tailText.length - tailCharLimit);
    }
  };
  const appendOutputText = (text: string): void => {
    if (!text) return;
    outputChars += text.length;
    if (outputPreview.length < BASH_PREVIEW_LIMIT) {
      outputPreview += text.slice(0, BASH_PREVIEW_LIMIT - outputPreview.length);
    }
    appendLogText(text);
  };

  return {
    appendOutput: appendOutputText,
    appendSystem: appendOutputText,
    appendLogOnly: appendLogText,
    getPreview: (truncationNotice) =>
      outputChars > BASH_PREVIEW_LIMIT
        ? `${outputPreview.slice(0, Math.max(0, BASH_PREVIEW_LIMIT - truncationNotice.length))}${truncationNotice}`
        : outputPreview,
    getSummaryLines: (limit) => summaryText.split(/\r?\n/u).slice(0, limit),
    getTailLines: (limit) => tailLines(tailText, limit),
    isTruncated: () => outputChars > BASH_PREVIEW_LIMIT,
  };
}

async function appendFileToPath(path: string, text: string): Promise<void> {
  await appendFile(path, text, "utf8");
}

type BashCommandSegmentIntent = {
  commandName: string;
  argv: string[];
  background: boolean;
  redirections: Array<{ operator: ">" | ">>"; target: string }>;
};

type ServiceIntent = {
  kind: "explicit-port" | "http-server" | "framework-server" | "package-script" | "background-process";
  host: "127.0.0.1";
  port: number;
  confidence: "high" | "medium";
  evidence: string;
};

type BashCommandIntent = {
  binaryCandidates: string[];
  serviceCandidates: ServiceIntent[];
  artifactCandidates: string[];
  backgroundLikely: boolean;
  commandNames: string[];
  segments: BashCommandSegmentIntent[];
  hasShellControl: boolean;
};

const BINARY_HINT_EXTENSIONS = [
  ".bin",
  ".elf",
  ".o",
  ".so",
  ".a",
  ".exe",
  ".dll",
  ".7z",
  ".zip",
  ".gz",
  ".png",
  ".jpg",
  ".jpeg",
  ".pdf",
  ".sqlite",
  ".db",
];
const ARTIFACT_HINT_EXTENSIONS = [
  ".txt",
  ".json",
  ".out",
  ".log",
  ".py",
  ".html",
  ".htm",
  ".csv",
  ".yaml",
  ".yml",
  ".toml",
  ".md",
  ".sh",
  ".bin",
  ".elf",
  ".zip",
  ".7z",
  ".png",
  ".pdf",
  ".sqlite",
  ".db",
];

function parseBashCommandIntent(command: string, _context?: ToolContext): BashCommandIntent {
  const tokens = tokenizeShellLike(command);
  const segments = splitCommandSegments(tokens);
  const commandNames: string[] = [];
  const parsedSegments: BashCommandSegmentIntent[] = [];
  const binaryCandidates = new Set<string>();
  const artifactCandidates = new Set<string>();
  const serviceCandidates: ServiceIntent[] = [];

  for (const segment of segments) {
    const parsed = parseCommandSegment(segment.tokens);
    if (!parsed) continue;
    commandNames.push(parsed.commandName);
    parsedSegments.push({
      commandName: parsed.commandName,
      argv: parsed.argv,
      background: segment.background || parsed.background,
      redirections: collectSegmentRedirections(parsed.argv),
    });
    collectSegmentBinaryCandidates(parsed, binaryCandidates);
    collectSegmentArtifactCandidates(parsed, artifactCandidates);
    serviceCandidates.push(...collectSegmentServiceCandidates(parsed));
  }
  return {
    binaryCandidates: [...binaryCandidates],
    serviceCandidates: dedupeServiceCandidates(serviceCandidates),
    artifactCandidates: [...artifactCandidates],
    backgroundLikely: isBackgroundLikely(segments, serviceCandidates),
    commandNames: unique(commandNames.filter(Boolean)),
    segments: parsedSegments,
    hasShellControl: segments.length !== 1 || tokens.some((token) => isCommandSeparator(token)),
  };
}

const BINARY_COMMAND_NAMES = new Set(["file", "xxd", "readelf", "objdump", "hexdump", "strings", "7z", "7za", "unzip", "tar"]);
const SHELL_RESERVED_COMMAND_NAMES = new Set([
  "if",
  "then",
  "else",
  "elif",
  "fi",
  "for",
  "while",
  "until",
  "do",
  "done",
  "case",
  "esac",
  "in",
  "function",
  "coproc",
]);
const SHELL_SYNTAX_COMMAND_NAMES = new Set([
  "[",
  "[[",
  "test",
  "{",
  "}",
  "(",
  ")",
  "!",
  ":",
  "true",
  "false",
]);
const SHELL_BUILTIN_COMMAND_NAMES = new Set([
  "alias",
  "bg",
  "break",
  "cd",
  "command",
  "continue",
  "dirs",
  "echo",
  "eval",
  "exec",
  "exit",
  "export",
  "fg",
  "hash",
  "jobs",
  "popd",
  "printf",
  "pushd",
  "pwd",
  "read",
  "set",
  "shift",
  "trap",
  "type",
  "ulimit",
  "umask",
  "unalias",
  "unset",
]);
const ARTIFACT_PRODUCING_COMMAND_NAMES = new Set(["touch", "tee"]);
const ARTIFACT_PRODUCING_TOKENS = new Set(["write", "wrote", "written", "create", "created", "generate", "generated", "build", "built", "output"]);

function canSafelyAliasPythonCommand(intent: BashCommandIntent): boolean {
  const segment = intent.segments[0];
  return intent.segments.length === 1 &&
    !intent.hasShellControl &&
    segment?.commandName === "python" &&
    !segment.background &&
    segment.redirections.length === 0;
}

function tokenizeShellLike(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;
  const push = () => {
    if (current.length > 0) tokens.push(current);
    current = "";
  };
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] ?? "";
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = undefined;
      else current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/u.test(char)) {
      push();
      continue;
    }
    if (char === ">" && /^\d+$/u.test(current)) {
      const prefix = current;
      current = "";
      let redirect = `${prefix}>`;
      if (command[index + 1] === ">") {
        redirect += ">";
        index += 1;
      }
      if (command[index + 1] === "&") {
        redirect += "&";
        index += 1;
        while (index + 1 < command.length && /[A-Za-z0-9_/-]/u.test(command[index + 1] ?? "")) {
          redirect += command[index + 1];
          index += 1;
        }
      }
      tokens.push(redirect);
      continue;
    }
    if (char === "(" && current.length === 0) {
      push();
      tokens.push(char);
      continue;
    }
    if ((char === "{" || char === "}") && current.length === 0) {
      push();
      tokens.push(char);
      continue;
    }
    if (char === ")" && !current.includes("$(")) {
      push();
      tokens.push(char);
      continue;
    }
    if (char === "|" || char === ";" || char === "&" || char === ">") {
      push();
      const next = command[index + 1];
      if ((char === "&" && next === "&") || (char === ">" && next === ">")) {
        tokens.push(`${char}${next}`);
        index += 1;
      } else {
        tokens.push(char);
      }
      continue;
    }
    current += char;
  }
  push();
  return tokens;
}

function isCommandSeparator(token: string): boolean {
  return token === "|" || token === "&&" || token === ";" || token === "&";
}

type CommandSegment = {
  tokens: string[];
  background: boolean;
};

type ParsedCommandSegment = {
  commandName: string;
  argv: string[];
  env: Map<string, string>;
  background: boolean;
};

function splitCommandSegments(tokens: string[]): CommandSegment[] {
  const segments: CommandSegment[] = [];
  let current: string[] = [];
  for (const token of tokens) {
    if (!isCommandSeparator(token)) {
      current.push(token);
      continue;
    }
    if (current.length > 0) {
      segments.push({ tokens: current, background: token === "&" });
      current = [];
    }
  }
  if (current.length > 0) segments.push({ tokens: current, background: false });
  return segments;
}

function parseCommandSegment(tokens: string[]): ParsedCommandSegment | undefined {
  const env = new Map<string, string>();
  let index = 0;
  while (index < tokens.length && isShellGroupBoundaryToken(tokens[index] ?? "")) {
    index += 1;
  }
  while (index < tokens.length && isEnvironmentAssignment(tokens[index] ?? "")) {
    const [name, ...rest] = (tokens[index] ?? "").split("=");
    if (name) env.set(name.toUpperCase(), rest.join("="));
    index += 1;
  }
  if (index >= tokens.length) return undefined;
  let commandToken = tokens[index] ?? "";
  if (commandToken === "nohup" || commandToken === "setsid" || commandToken === "time") {
    index += 1;
    commandToken = tokens[index] ?? "";
  }
  if (isShellReservedCommandToken(commandToken)) return undefined;
  if (isShellSyntaxCommandToken(commandToken)) return undefined;
  if (!commandToken) return undefined;
  const commandName = stripExecutableToken(commandToken);
  if (!commandName || isShellReservedCommandToken(commandName) || isShellSyntaxCommandToken(commandName)) {
    return undefined;
  }
  return {
    commandName,
    argv: tokens.slice(index + 1).filter((token) => !isShellGroupBoundaryToken(token)),
    env,
    background: tokens.includes("disown"),
  };
}

function collectSegmentBinaryCandidates(segment: ParsedCommandSegment, target: Set<string>): void {
  if (BINARY_COMMAND_NAMES.has(segment.commandName)) {
    for (const token of segment.argv) {
      if (!isOptionToken(token)) addPathCandidate(target, token);
    }
  }
  for (const token of segment.argv) {
    if (isBinarySuffix(token)) addPathCandidate(target, token);
  }
}

function collectSegmentArtifactCandidates(segment: ParsedCommandSegment, target: Set<string>): void {
  for (let index = 0; index < segment.argv.length; index += 1) {
    const token = segment.argv[index] ?? "";
    if (token === ">" || token === ">>") {
      addPathCandidate(target, segment.argv[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (isOutputFlag(token)) {
      addPathCandidate(target, segment.argv[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (isArtifactSuffix(token) && isArtifactProducingCommand(segment.commandName, segment.argv)) {
      addPathCandidate(target, token);
    }
  }
}

function collectSegmentRedirections(argv: string[]): Array<{ operator: ">" | ">>"; target: string }> {
  const redirections: Array<{ operator: ">" | ">>"; target: string }> = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token !== ">" && token !== ">>") continue;
    const target = argv[index + 1] ?? "";
    if (target) redirections.push({ operator: token, target });
    index += 1;
  }
  return redirections;
}

function collectSegmentServiceCandidates(segment: ParsedCommandSegment): ServiceIntent[] {
  const candidates: ServiceIntent[] = [];
  const envPort = parsePort(segment.env.get("PORT"));
  const explicit = findExplicitServiceTarget(segment.argv, envPort);
  if (isPythonHttpServer(segment)) {
    const port = findFirstPortToken(segment.argv) ?? envPort ?? 8000;
    candidates.push(createServiceIntent("http-server", port, "high", "python -m http.server"));
    return candidates;
  }
  if (segment.commandName === "uvicorn") {
    if (explicit) candidates.push(createServiceIntent("framework-server", explicit.port, "high", explicit.evidence, explicit.host));
    return candidates;
  }
  if (segment.commandName === "flask" && segment.argv[0]?.toLowerCase() === "run") {
    if (explicit) candidates.push(createServiceIntent("framework-server", explicit.port, "high", explicit.evidence, explicit.host));
    return candidates;
  }
  if (segment.commandName === "gunicorn") {
    const bind = findGunicornBindTarget(segment.argv);
    if (bind) candidates.push(createServiceIntent("framework-server", bind.port, "high", bind.evidence, bind.host));
    return candidates;
  }
  if (isPackageScriptCommand(segment)) {
    if (explicit) candidates.push(createServiceIntent("package-script", explicit.port, "medium", explicit.evidence, explicit.host));
    return candidates;
  }
  if (isJsRuntimeCommand(segment.commandName)) {
    if (explicit) candidates.push(createServiceIntent("explicit-port", explicit.port, "medium", explicit.evidence, explicit.host));
    return candidates;
  }
  if (explicit && isKnownServiceCommand(segment.commandName)) {
    candidates.push(createServiceIntent("explicit-port", explicit.port, "medium", explicit.evidence, explicit.host));
  }
  return candidates;
}

function createServiceIntent(
  kind: ServiceIntent["kind"],
  port: number,
  confidence: ServiceIntent["confidence"],
  evidence: string,
  host = "127.0.0.1",
): ServiceIntent {
  return { kind, host: normalizeServiceHost(host), port, confidence, evidence };
}

function isPythonHttpServer(segment: ParsedCommandSegment): boolean {
  return (segment.commandName === "python" || segment.commandName === "python3") &&
    hasAdjacentTokens(segment.argv, "-m", "http.server");
}

function findExplicitServiceTarget(
  argv: string[],
  envPort?: number,
): { host: string; port: number; evidence: string } | undefined {
  let host = "127.0.0.1";
  if (envPort) return { host, port: envPort, evidence: "PORT=" };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--host") host = normalizeServiceHost(argv[index + 1] ?? host);
    if (token === "--port" || token === "-p") {
      const port = parsePort(argv[index + 1]);
      if (port) return { host, port, evidence: token };
    }
    const inlinePort = parseInlineOptionPort(token);
    if (inlinePort) return { host, port: inlinePort, evidence: token.split("=")[0] ?? token };
    const target = parseHostPortToken(token);
    if (target?.port) return { host: target.host ?? host, port: target.port, evidence: "host:port" };
  }
  return undefined;
}

function findGunicornBindTarget(argv: string[]): { host: string; port: number; evidence: string } | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token !== "-b" && token !== "--bind") continue;
    const target = parseHostPortToken(argv[index + 1] ?? "");
    if (target?.port) return { host: target.host ?? "127.0.0.1", port: target.port, evidence: token };
  }
  return undefined;
}

function findFirstPortToken(argv: string[]): number | undefined {
  for (const token of argv) {
    const port = parsePort(token);
    if (port) return port;
  }
  return undefined;
}

function parseInlineOptionPort(token: string): number | undefined {
  if (!token.startsWith("--port=") && !token.startsWith("-p=")) return undefined;
  return parsePort(token.slice(token.indexOf("=") + 1));
}

function parsePort(value: string | undefined): number | undefined {
  if (!value || !/^\d{1,5}$/u.test(value)) return undefined;
  return normalizePort(Number(value));
}

function isPackageScriptCommand(segment: ParsedCommandSegment): boolean {
  if (segment.commandName !== "npm" && segment.commandName !== "pnpm" && segment.commandName !== "yarn") return false;
  const command = segment.argv[0]?.toLowerCase();
  const script = segment.argv[1]?.toLowerCase();
  return command === "start" || command === "dev" || command === "test-server" ||
    (command === "run" && (script === "start" || script === "dev" || script === "test-server"));
}

function isJsRuntimeCommand(commandName: string): boolean {
  return commandName === "node" || commandName === "deno" || commandName === "bun";
}

function isKnownServiceCommand(commandName: string): boolean {
  return commandName === "grpc";
}

function normalizeServiceHost(host: string): "127.0.0.1" {
  return "127.0.0.1";
}

function isBackgroundLikely(segments: CommandSegment[], serviceCandidates: ServiceIntent[]): boolean {
  return segments.some((segment) =>
    segment.background ||
    segment.tokens[0] === "nohup" ||
    segment.tokens[0] === "setsid" ||
    segment.tokens.includes("disown")
  ) || serviceCandidates.some((candidate) =>
    candidate.kind === "http-server" ||
    candidate.kind === "framework-server" ||
    candidate.kind === "package-script"
  );
}

function stripExecutableToken(token: string): string {
  const normalized = token.replace(/^\(+/u, "").replace(/\)+$/u, "");
  if (normalized.includes("/") || normalized.includes("\\")) {
    return normalized.replace(/\.(?:exe|cmd|bat)$/iu, "");
  }
  return basename(normalized).replace(/\.(?:exe|cmd|bat)$/iu, "").toLowerCase();
}

function addPathCandidate(target: Set<string>, token: string): void {
  if (!isStaticPathCandidate(token)) return;
  target.add(token.replaceAll("\\", "/"));
}

function isOptionToken(token: string): boolean {
  return token.startsWith("-") && !/^-?\d+$/u.test(token);
}

function isOutputFlag(token: string): boolean {
  return token === "-o" || token === "--output" || token === "--out" || token === "--dest" || token === "--file";
}

function isEnvironmentAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=.*$/u.test(token);
}

function isShellReservedCommandToken(token: string): boolean {
  return SHELL_RESERVED_COMMAND_NAMES.has(token.toLowerCase());
}

function isShellSyntaxCommandToken(token: string): boolean {
  return SHELL_SYNTAX_COMMAND_NAMES.has(token.toLowerCase());
}

function isShellGroupBoundaryToken(token: string): boolean {
  return token === "(" || token === ")" || token === "{" || token === "}";
}

function isStaticPathCandidate(token: string): boolean {
  if (!token || isOptionToken(token) || token.includes("://")) return false;
  if (token.includes("$") || token.includes("`")) return false;
  if (/^(?:\d+)?>{1,2}(?:&\d+)?$/u.test(token)) return false;
  if (token === "|" || token === ";" || token === "&" || token === "<") return false;
  if (isShellGroupBoundaryToken(token) || isShellSyntaxCommandToken(token)) return false;
  if (/^\d+$/u.test(token)) return false;
  if (token === "/dev/null" || token === "/dev/stdout" || token === "/dev/stderr") return false;
  return true;
}

function isBinarySuffix(token: string): boolean {
  return BINARY_HINT_EXTENSIONS.some((extension) => token.toLowerCase().endsWith(extension));
}

function isArtifactSuffix(token: string): boolean {
  return ARTIFACT_HINT_EXTENSIONS.some((extension) => token.toLowerCase().endsWith(extension));
}

function isArtifactProducingCommand(commandName: string | undefined, tokens: string[]): boolean {
  if (!commandName) return false;
  if (ARTIFACT_PRODUCING_COMMAND_NAMES.has(commandName)) return true;
  return tokens.some((token) => ARTIFACT_PRODUCING_TOKENS.has(token.toLowerCase()));
}

function parseHostPortToken(token: string): { host?: string; port?: number } | undefined {
  const url = tryParseLocalUrl(token);
  if (url) return url;
  const separator = token.lastIndexOf(":");
  if (separator <= 0) return undefined;
  const host = token.slice(0, separator).replace(/^\[(.*)\]$/u, "$1");
  const port = normalizePort(Number(token.slice(separator + 1)));
  if (!port || !isLocalHost(host)) return undefined;
  return normalizeHostPort(host, port);
}

function tryParseLocalUrl(token: string): { host?: string; port?: number } | undefined {
  try {
    const url = new URL(token);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (!isLocalHost(url.hostname)) return undefined;
    const port = normalizePort(Number(url.port));
    if (!port) return undefined;
    return normalizeHostPort(url.hostname, port);
  } catch {
    return undefined;
  }
}

function isLocalHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1";
}

function hasAdjacentTokens(tokens: string[], first: string, second: string): boolean {
  return tokens.some((token, index) =>
    token.toLowerCase() === first && tokens[index + 1]?.toLowerCase() === second
  );
}

function normalizePort(value: number): number | undefined {
  return Number.isInteger(value) && value > 0 && value <= 65_535 ? value : undefined;
}

function dedupeServiceCandidates(candidates: ServiceIntent[]): ServiceIntent[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.host}:${candidate.port}:${candidate.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeHostPort(host: string, port: number): { host: string; port: number } | undefined {
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) return undefined;
  return { host: host === "0.0.0.0" || host === "localhost" ? "127.0.0.1" : host.replace(/^\[(.*)\]$/u, "$1"), port };
}

function isHeadlessBenchContext(context: ToolContext): boolean {
  const record = context as ToolContext & { headlessBench?: { enabled?: boolean } };
  return record.headlessBench?.enabled === true || record.isHeadlessBench === true;
}

function createBashOutcomeDiagnostics(
  outcome: "completed" | "timeout" | "cancelled",
): BashDiagnostic[] {
  if (outcome === "timeout") {
    return [
      {
        type: "timeout",
        severity: "recoverable",
        evidence: "Bash outcome timeout",
        suggestion: "Run the smallest focused check first and avoid repeating long blind commands.",
      },
    ];
  }
  return [];
}

function tailLines(text: string, limit: number): string[] {
  const lines = text.split(/\r?\n/u);
  return lines.slice(Math.max(0, lines.length - limit));
}

type ShellCommandAdapter = {
  command: string;
  adapter: "native" | "powershell-adapted" | "blocked";
  logCommand?: string;
};

export function adaptShellCommand(command: string): ShellCommandAdapter {
  return adaptShellCommandForPlatform(command, process.platform);
}

export function adaptShellCommandForPlatform(
  command: string,
  platform: NodeJS.Platform,
): ShellCommandAdapter {
  if (platform !== "win32") return { command, adapter: "native" };
  if (isExplicitPowerShellCommand(command)) return { command, adapter: "native" };
  const fileWriteBlock = blockWindowsShellFileWriteCommand(command);
  if (fileWriteBlock) return fileWriteBlock;
  const heredoc = convertNodeHereDocForPowerShell(command);
  if (heredoc) return heredoc;
  const nativePowerShell = convertNativePowerShellCommand(command);
  if (nativePowerShell) return nativePowerShell;
  if (looksLikeUnsupportedUnixMultiline(command)) {
    return createBlockedPowerShellAdapter(
      "Unsupported multi-line Unix shell syntax on Windows PowerShell; use PowerShell-safe commands or Node one-liners.",
    );
  }
  const unsupportedPosix = blockUnsupportedPosixShellSyntax(command);
  if (unsupportedPosix) return unsupportedPosix;
  const converted = convertUnixPipelineForPowerShell(command);
  if (converted) return { command: converted, adapter: "powershell-adapted" };
  const readOnlyCommand = convertUnixReadOnlyCommandForPowerShell(command);
  if (readOnlyCommand) return readOnlyCommand;
  if (looksLikeUnsupportedUnixPipeline(command)) {
    const message =
      "Unsupported Unix pipeline on Windows PowerShell; use PowerShell-safe commands or Node one-liners.";
    return createBlockedPowerShellAdapter(message);
  }
  const unsupportedReadOnlyCommand = blockUnsupportedUnixReadOnlyCommand(command);
  if (unsupportedReadOnlyCommand) return unsupportedReadOnlyCommand;
  return { command, adapter: "native" };
}

function isExplicitPowerShellCommand(command: string): boolean {
  return /^(?:powershell(?:\.exe)?|pwsh(?:\.exe)?)\b/iu.test(command.trim());
}

const WINDOWS_SHELL_WRITE_BLOCK_MESSAGE =
  "Linghun Bash does not support shell apply_patch or heredoc file writes on Windows; use Edit/MultiEdit/Write structured tools instead.";

function blockWindowsShellFileWriteCommand(command: string): ShellCommandAdapter | undefined {
  const normalized = command.replace(/\r\n/gu, "\n").trim();
  if (!normalized) return undefined;
  if (
    /\bapply_patch\b/iu.test(normalized) &&
    (/(?:^|\n|;)\s*apply_patch\s*<</iu.test(normalized) ||
      /@['"][\s\S]*?['"]@\s*\|\s*apply_patch\b/iu.test(normalized) ||
      /\$[A-Za-z_][\w]*\s*=\s*@['"][\s\S]*?['"]@/u.test(normalized) ||
      /\$[A-Za-z_][\w]*\s*\|\s*apply_patch\b/u.test(normalized))
  ) {
    return createBlockedPowerShellAdapter(WINDOWS_SHELL_WRITE_BLOCK_MESSAGE);
  }
  if (
    /(?:^|\n|;)\s*cat\b[^\n;]*>\s*\S+/iu.test(normalized) ||
    /(?:^|\n|;)\s*cat\b[^\n;]*<<[^\n]*>\s*\S+/iu.test(normalized) ||
    /(?:^|\n|;)\s*tee\b\s+\S+/iu.test(normalized)
  ) {
    return createBlockedPowerShellAdapter(WINDOWS_SHELL_WRITE_BLOCK_MESSAGE);
  }
  return undefined;
}

function convertNativePowerShellCommand(command: string): ShellCommandAdapter | undefined {
  const normalized = command.trim();
  if (!normalized) return undefined;
  if (isExplicitPowerShellCommand(normalized)) return undefined;
  if (!looksLikePowerShellScript(normalized)) {
    return undefined;
  }
  return {
    command: [
      "powershell.exe -NoProfile -NonInteractive -Command",
      quoteCmdArg(`$ErrorActionPreference='Stop'; ${normalized}`),
    ].join(" "),
    adapter: "powershell-adapted",
    logCommand: `powershell.exe -NoProfile -NonInteractive -Command <powershell script>`,
  };
}

function looksLikePowerShellScript(command: string): boolean {
  const normalized = command.trim();
  if (/^\$[A-Za-z_][\w]*\s*=/u.test(normalized)) return true;
  if (/^\$PWD\.Path\b/iu.test(normalized)) return true;
  if (/@['"][\s\S]*?['"]@/u.test(normalized)) return true;
  if (/^\$[A-Za-z_][\w]*\s*\|/u.test(normalized) || /;\s*\$[A-Za-z_][\w]*\s*\|/u.test(normalized)) {
    return true;
  }
  const cmdlet = /\b(?:Get|Set|New|Remove|Select|ForEach|Where|Test|Resolve|Join|Split|Copy|Move|Write|Out|Measure|Compare|Sort|Format)-[A-Za-z]+\b/u;
  if (!cmdlet.test(normalized)) return false;
  if (/^(?:Get|Set|New|Remove|Select|ForEach|Where|Test|Resolve|Join|Split|Copy|Move|Write|Out|Measure|Compare|Sort|Format)-[A-Za-z]+\b/u.test(normalized)) {
    return true;
  }
  return /[;|]/u.test(normalized) || /\$[A-Za-z_][\w]*(?:\.|\s*\|)/u.test(normalized);
}

function blockUnsupportedPosixShellSyntax(command: string): ShellCommandAdapter | undefined {
  const normalized = command.replace(/\r\n/gu, "\n").trim();
  if (!normalized) return undefined;
  const message =
    "Unsupported POSIX shell syntax on Windows; use PowerShell-safe commands, Node one-liners, or structured tools.";
  if (/<<\s*['"]?[A-Za-z_][\w.-]*['"]?/u.test(normalized)) {
    return createBlockedPowerShellAdapter(message);
  }
  if (/(?:^|\n|;)\s*export\s+[A-Za-z_][\w]*=/u.test(normalized)) {
    return createBlockedPowerShellAdapter(message);
  }
  if (/^(?:[A-Za-z_][\w]*=[^\s]+\s+)+\S+/u.test(normalized)) {
    return createBlockedPowerShellAdapter(message);
  }
  if (/\$\([^)]*\)/u.test(normalized)) {
    return createBlockedPowerShellAdapter(message);
  }
  if (/\n/u.test(normalized)) {
    return createBlockedPowerShellAdapter(message);
  }
  return undefined;
}

function convertNodeHereDocForPowerShell(command: string): ShellCommandAdapter | undefined {
  const normalized = command.replace(/\r\n/gu, "\n");
  const match = normalized.match(
    /^node\s+(-)?\s*<<\s*(['"]?)([A-Za-z_][\w.-]*)\2\s*\n([\s\S]*)\n\3\s*$/u,
  );
  if (!match) return undefined;

  const mode = match[1] === "-" ? "stdin" : "script";
  const body = match[4] ?? "";
  if (!body.trim()) {
    return createBlockedPowerShellAdapter("Unsupported empty node here-doc on Windows PowerShell.");
  }
  const extension = ".cjs";
  const bodyBase64 = Buffer.from(body, "utf8").toString("base64");
  const script = [
    "$ErrorActionPreference='Stop'",
    "$dir = Join-Path ([System.IO.Path]::GetTempPath()) ('linghun-node-heredoc-' + [guid]::NewGuid().ToString('N'))",
    "[System.IO.Directory]::CreateDirectory($dir) | Out-Null",
    `$script = Join-Path $dir ('script${extension}')`,
    `$body = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String(${quotePowerShellString(bodyBase64)}))`,
    "[System.IO.File]::WriteAllText($script, $body, [System.Text.UTF8Encoding]::new($false))",
    "try {",
    "  & node $script",
    "  exit $LASTEXITCODE",
    "} finally {",
    "  Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue",
    "}",
  ].join("; ");

  return {
    command: ["powershell.exe -NoProfile -NonInteractive -Command", quoteCmdArg(script)].join(" "),
    adapter: "powershell-adapted",
    logCommand: `powershell.exe -NoProfile -NonInteractive -Command <node here-doc adapter: ${mode}>`,
  };
}

function createBlockedPowerShellAdapter(message: string): ShellCommandAdapter {
  return {
    command: `powershell.exe -NoProfile -NonInteractive -Command "Write-Error ${quotePowerShellString(message)}; exit 1"`,
    adapter: "blocked",
    logCommand: `powershell.exe -NoProfile -NonInteractive -Command <blocked: ${message}>`,
  };
}

function convertUnixPipelineForPowerShell(command: string): string | undefined {
  const normalized = command.trim();
  const findSed = normalized.match(
    /^find\s+(.+?)\s+-type\s+f\s*\|\s*sed\s+-n\s+['"]?1,(\d+)p['"]?$/iu,
  );
  if (findSed) {
    const root = stripShellQuotes(findSed[1] ?? ".");
    const first = Number.parseInt(findSed[2] ?? "0", 10);
    if (Number.isFinite(first) && first > 0) {
      return [
        "powershell.exe -NoProfile -NonInteractive -Command",
        quoteCmdArg(
          `$ErrorActionPreference='Stop'; Get-ChildItem -LiteralPath ${quotePowerShellString(root)} -File -Recurse | Select-Object -First ${first} | ForEach-Object { $_.FullName }`,
        ),
      ].join(" ");
    }
  }
  const findHead = normalized.match(
    /^find\s+((?:"[^"]+"|'[^']+'|[^\s|]+))(?:\s+-type\s+f)?\s*\|\s*head\s+-n\s+(\d+)$/iu,
  );
  if (findHead) {
    const root = stripShellQuotes(findHead[1] ?? ".");
    const first = Number.parseInt(findHead[2] ?? "0", 10);
    if (Number.isFinite(first) && first > 0) {
      return [
        "powershell.exe -NoProfile -NonInteractive -Command",
        quoteCmdArg(
          `$ErrorActionPreference='Stop'; Get-ChildItem -LiteralPath ${quotePowerShellString(root)} -File -Recurse | Select-Object -First ${first} | ForEach-Object { $_.FullName }`,
        ),
      ].join(" ");
    }
  }
  const sedHead = normalized.match(/^sed\s+-n\s+['"]?1,(\d+)p['"]?\s+(.+)$/iu);
  if (sedHead) {
    const first = Number.parseInt(sedHead[1] ?? "0", 10);
    const file = stripShellQuotes(sedHead[2] ?? "");
    if (Number.isFinite(first) && first > 0 && file) {
      return [
        "powershell.exe -NoProfile -NonInteractive -Command",
        quoteCmdArg(
          `$ErrorActionPreference='Stop'; Get-Content -LiteralPath ${quotePowerShellString(file)} -TotalCount ${first}`,
        ),
      ].join(" ");
    }
  }
  const headFile = normalized.match(/^head\s+-n\s+(\d+)\s+(.+)$/iu);
  if (headFile) {
    const first = Number.parseInt(headFile[1] ?? "0", 10);
    const file = stripShellQuotes(headFile[2] ?? "");
    if (Number.isFinite(first) && first > 0 && file) {
      return [
        "powershell.exe -NoProfile -NonInteractive -Command",
        quoteCmdArg(
          `$ErrorActionPreference='Stop'; Get-Content -LiteralPath ${quotePowerShellString(file)} -TotalCount ${first}`,
        ),
      ].join(" ");
    }
  }
  return undefined;
}

function convertUnixReadOnlyCommandForPowerShell(command: string): ShellCommandAdapter | undefined {
  const tokens = tokenizeSimpleShellCommand(command);
  if (!tokens) return undefined;
  const [program = "", ...args] = tokens;
  const lowerProgram = program.toLowerCase();
  let script: string | undefined;

  if (lowerProgram === "cat") {
    if (args.length === 1) {
      script = `Get-Content -LiteralPath ${quotePowerShellString(args[0] ?? "")}`;
    }
  } else if (lowerProgram === "ls") {
    script = convertLsForPowerShell(args);
  } else if (lowerProgram === "grep") {
    script = convertGrepForPowerShell(args);
  } else if (lowerProgram === "pwd") {
    if (args.length === 0) script = "Get-Location | ForEach-Object { $_.Path }";
  } else if (lowerProgram === "which") {
    if (args.length === 1) {
      script = [
        `$cmd = Get-Command -ErrorAction Stop ${quotePowerShellString(args[0] ?? "")}`,
        "if ($cmd.Source) { $cmd.Source } elseif ($cmd.Path) { $cmd.Path } else { $cmd.Name }",
      ].join("; ");
    }
  }

  if (!script) return undefined;
  return {
    command: [
      "powershell.exe -NoProfile -NonInteractive -Command",
      quoteCmdArg(`$ErrorActionPreference='Stop'; ${script}`),
    ].join(" "),
    adapter: "powershell-adapted",
  };
}

function convertLsForPowerShell(args: string[]): string | undefined {
  let force = false;
  let path = ".";
  for (const arg of args) {
    if (arg === "-a" || arg === "-la" || arg === "-al") {
      force = true;
      continue;
    }
    if (arg === "-l") {
      continue;
    }
    if (arg.startsWith("-")) return undefined;
    if (path !== ".") return undefined;
    path = arg;
  }
  const forceArg = force ? " -Force" : "";
  return `Get-ChildItem -LiteralPath ${quotePowerShellString(path)}${forceArg}`;
}

function convertGrepForPowerShell(args: string[]): string | undefined {
  const recursive = args[0] === "-R" || args[0] === "-r";
  const offset = recursive ? 1 : 0;
  const pattern = args[offset];
  const target = args[offset + 1];
  if (!pattern || !target || args.length !== offset + 2) return undefined;
  if (recursive) {
    return [
      `Get-ChildItem -LiteralPath ${quotePowerShellString(target)} -File -Recurse`,
      `Select-String -Pattern ${quotePowerShellString(pattern)}`,
    ].join(" | ");
  }
  return `Select-String -Pattern ${quotePowerShellString(pattern)} -LiteralPath ${quotePowerShellString(target)}`;
}

function looksLikeUnsupportedUnixPipeline(command: string): boolean {
  return (
    /\bfind\s+.+\|\s*(?:sed|head)\b/iu.test(command) ||
    /\b(?:cat|grep|ls|find|sed|head)\b.+\|\s*(?:sed|head|grep|awk|xargs)\b/isu.test(command) ||
    /\bsed\s+-n\b/iu.test(command) ||
    /\bhead\s+-n\b/iu.test(command)
  );
}

function looksLikeUnsupportedUnixMultiline(command: string): boolean {
  const normalized = command.replace(/\r\n/gu, "\n");
  if (!/\n/u.test(normalized)) return false;
  if (/<<\s*['"]?[A-Za-z_][\w.-]*['"]?/u.test(normalized)) return true;
  return normalized
    .split("\n")
    .some((line) => /^\s*(?:cat|ls|grep|find|sed|head|which|pwd)\b/iu.test(line));
}

function blockUnsupportedUnixReadOnlyCommand(command: string): ShellCommandAdapter | undefined {
  const tokens = tokenizeSimpleShellCommand(command);
  const program =
    tokens?.[0]?.toLowerCase() ??
    command
      .trim()
      .match(/^(\w+)/u)?.[1]
      ?.toLowerCase();
  if (!program || !["cat", "ls", "grep", "pwd", "which"].includes(program)) return undefined;
  return createBlockedPowerShellAdapter(
    `Unsupported ${program} form on Windows PowerShell; use a simple read-only form or a PowerShell-safe command.`,
  );
}

function tokenizeSimpleShellCommand(command: string): string[] | undefined {
  const trimmed = command.trim();
  if (!trimmed || /[\r\n|;&<>]/u.test(trimmed)) return undefined;
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (!char) continue;
    if (quote) {
      if (char === quote) {
        quote = undefined;
        continue;
      }
      current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/u.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (quote) return undefined;
  if (current) tokens.push(current);
  return tokens.length > 0 ? tokens : undefined;
}

function stripShellQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function quotePowerShellString(value: string): string {
  return `'${value.replace(/'/gu, "''")}'`;
}

function quoteCmdArg(value: string): string {
  return `"${value.replace(/"/gu, '\\"')}"`;
}

function summarizeOriginalShellCommand(command: string): string {
  if (!/\n/u.test(command)) return command;
  const lines = command.split(/\r?\n/u);
  const firstLine = lines[0]?.trim() || "multi-line command";
  return `${firstLine} <${lines.length} lines>`;
}

async function todoTool(input: TodoInput, context: ToolContext): Promise<ToolOutput> {
  if (input.action === "add") {
    if (context.todos.length >= MAX_TODO_ITEMS) {
      throw new Error(`Todo 已达到上限 ${MAX_TODO_ITEMS} 条。建议：先完成或清理旧 Todo。`);
    }
    const id = String(context.todos.length + 1);
    context.todos.push({
      id,
      content: input.content,
      status: "pending",
    });
    return {
      text: `Todo created: id=${id}\n${formatTodos(context.todos)}`,
      data: { items: context.todos, createdId: id },
    };
  }
  if (input.action === "start") {
    const item = findTodo(context.todos, input.id, input.content);
    for (const todo of context.todos) {
      if (todo.status === "in_progress") {
        todo.status = "pending";
      }
    }
    item.status = "in_progress";
    item.evidence = input.evidence ?? item.evidence;
  }
  if (input.action === "done") {
    const item = findTodo(context.todos, input.id, input.content);
    item.status = "completed";
    item.evidence = input.evidence ?? item.evidence;
  }
  if (input.action === "block") {
    const item = findTodo(context.todos, input.id, input.content);
    item.status = "blocked";
    item.evidence = input.evidence ?? item.evidence;
  }

  return {
    text: formatTodos(context.todos),
    data: { items: context.todos },
  };
}

async function diffTool(input: DiffInput, context: ToolContext): Promise<ToolOutput> {
  const changedFiles = unique(input.files ?? context.changedFiles);
  const patchSummaries = context.patchSummaries ?? {};
  const addedLines = changedFiles.reduce(
    (total, file) => total + (patchSummaries[file]?.addedLines ?? 0),
    0,
  );
  const removedLines = changedFiles.reduce(
    (total, file) => total + (patchSummaries[file]?.removedLines ?? 0),
    0,
  );
  const riskyFiles = changedFiles.filter(
    (file) => file.includes(".env") || file.startsWith(".git/"),
  );
  const summary: DiffSummary = {
    changedFiles,
    addedLines,
    removedLines,
    summary:
      changedFiles.length === 0
        ? "本轮暂无工具写入改动。"
        : `本轮工具改动 ${changedFiles.length} 个文件，+${addedLines} -${removedLines}。`,
    riskyFiles,
  };
  return {
    text: `${summary.summary}\n${changedFiles.map((file) => `- ${file}`).join("\n")}`.trim(),
    data: summary,
  };
}

// ---------------------------------------------------------------------------
// WebSearch tool
// ---------------------------------------------------------------------------

async function webSearchTool(input: WebSearchInput, _context: ToolContext): Promise<ToolOutput> {
  const start = Date.now();
  const result = await bingSearch(input);

  if (!result.ok) {
    return {
      text: `WebSearch failed: ${result.error}`,
      data: {
        query: input.query,
        results: [],
        searches: 1,
        count: 0,
        durationMs: Date.now() - start,
        error: result.error,
      },
    };
  }

  const filtered = applyDomainFilter(
    result.results,
    input.allowed_domains,
    input.blocked_domains,
  );

  return formatSearchOutput(input.query, filtered, Date.now() - start);
}

// ---------------------------------------------------------------------------
// WebFetch tool
// ---------------------------------------------------------------------------

async function webFetchTool(input: WebFetchInput, _context: ToolContext): Promise<ToolOutput> {
  const start = Date.now();
  const result = await webFetch(input);
  return formatFetchOutput(input.url, result, Date.now() - start);
}

type ExistingFile = {
  content: string;
  hash: string;
  mtimeMs: number;
  size: number;
};

type EditReadGuard = {
  source: "read-snapshot" | "expectedHash" | "new-file";
  beforeHash?: string;
};

function resolveWorkspacePath(workspaceRoot: string, inputPath: string): string {
  if (!inputPath) {
    throw new Error("路径不能为空。建议：传入工作区内相对路径。");
  }
  const target = resolve(workspaceRoot, inputPath);
  const rel = relative(workspaceRoot, target);
  if (
    rel.startsWith("..") ||
    isAbsolute(rel) ||
    (rel === "" && target !== resolve(workspaceRoot))
  ) {
    throw new Error(`路径越界：${inputPath}。建议：只操作当前工作区内文件。`);
  }
  return target;
}

function relativePath(workspaceRoot: string, filePath: string): string {
  return relative(workspaceRoot, filePath).replaceAll("\\", "/") || ".";
}

function resolveArtifactPath(context: ToolContext, inputPath: string): {
  input: string;
  absolute: string;
  relative: string;
} {
  const absolute = resolveWorkspacePath(context.workspaceRoot, inputPath);
  return {
    input: inputPath,
    absolute,
    relative: relativePath(context.workspaceRoot, absolute),
  };
}

function ensureUnique(content: string, oldText: string): void {
  if (!oldText) {
    throw new Error("oldText 不能为空。建议：提供足够上下文的唯一片段。");
  }
  const count = content.split(oldText).length - 1;
  if (count === 0) {
    throw new Error("未找到 oldText。建议：先 Read 文件确认最新内容。");
  }
  if (count > 1) {
    throw new Error(`oldText 出现 ${count} 次，不唯一。建议：增加上下文后重试。`);
  }
}

function recordChangedFile(context: ToolContext, filePath: string): void {
  context.changedFiles = unique([
    ...context.changedFiles,
    relativePath(context.workspaceRoot, filePath),
  ]);
}

async function readExistingFile(filePath: string): Promise<ExistingFile | null> {
  try {
    const [content, info] = await Promise.all([readFile(filePath, "utf8"), stat(filePath)]);
    return { content, hash: hashText(content), mtimeMs: info.mtimeMs, size: info.size };
  } catch (error) {
    const code =
      typeof error === "object" && error !== null ? (error as { code?: string }).code : undefined;
    if (code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function ensureReadBeforeEdit(
  context: ToolContext,
  filePath: string,
  before: ExistingFile | null,
  expectedHash?: string,
): EditReadGuard {
  if (!before) {
    return { source: "new-file" };
  }
  const rel = relativePath(context.workspaceRoot, filePath);
  if (expectedHash) {
    if (expectedHash !== before.hash) {
      throw new Error(
        `文件已变化：${rel} 当前 hash 与 expectedHash 不一致。建议：重新 Read 文件后按最新内容重试，避免覆盖外部修改。`,
      );
    }
    return { source: "expectedHash", beforeHash: before.hash };
  }
  const snapshot = context.readSnapshots?.[rel];
  if (!snapshot) {
    throw new Error(
      `编辑前未读取：${rel}。建议：先运行 Read 获取最新内容，或传入 expectedHash 后再执行写入。`,
    );
  }
  if (
    snapshot.hash !== before.hash ||
    snapshot.mtimeMs !== before.mtimeMs ||
    snapshot.size !== before.size
  ) {
    throw new Error(
      `文件已变化：${rel} 自上次 Read 后被修改。建议：重新 Read 文件后按最新内容重试，避免静默覆盖。`,
    );
  }
  return { source: "read-snapshot", beforeHash: before.hash };
}

function rememberReadSnapshot(
  context: ToolContext,
  filePath: string,
  content: string,
  info: { mtimeMs: number; size: number },
): void {
  const rel = relativePath(context.workspaceRoot, filePath);
  context.readSnapshots = {
    ...(context.readSnapshots ?? {}),
    [rel]: { path: rel, hash: hashText(content), mtimeMs: info.mtimeMs, size: info.size },
  };
}

function createEditOutput(
  context: ToolContext,
  operation: "Write" | "Edit" | "MultiEdit",
  filePath: string,
  before: string,
  after: string,
  readGuard: EditReadGuard,
  editCount = 1,
): ToolOutput {
  const rel = relativePath(context.workspaceRoot, filePath);
  const summary = createPatchSummary([rel], before, after);
  const structuredPatch = createStructuredPatch(rel, before, after);
  const patchHunks = structuredPatch.files.flatMap((file) => file.hunks);
  context.patchSummaries = { ...(context.patchSummaries ?? {}), [rel]: summary };
  const newlineBefore = detectNewlineStyle(before);
  const newlineAfter = detectNewlineStyle(after);
  const text = [
    `${operation} 已完成：${rel}`,
    `- 补丁：+${summary.addedLines} -${summary.removedLines}`,
    `- 改动文件：${rel}`,
    "- 读取保护：已启用",
    `- 换行：${newlineBefore} -> ${newlineAfter}`,
    "- 下一步：用 Diff 或 /details 查看补丁摘要；需要继续编辑请基于最新内容。",
  ].join("\n");
  return {
    text,
    summary: `${operation} ${rel}: +${summary.addedLines} -${summary.removedLines}; changed files 1`,
    preview: text,
    details: createPatchDetails(operation, rel, before, after, readGuard, editCount),
    data: {
      ...summary,
      operation,
      editCount,
      readGuard: readGuard.source,
      beforeHash: readGuard.beforeHash,
      afterHash: hashText(after),
      newlineBefore,
      newlineAfter,
      encoding: "utf8",
      structuredPatch,
      patchHunks,
    },
    changedFiles: [rel],
  };
}

const STRUCTURED_PATCH_LINE_LIMIT = 120;
const STRUCTURED_PATCH_CONTEXT_LINES = 3;

function createStructuredPatch(path: string, before: string, after: string): StructuredPatch {
  const beforeLines = splitPatchLines(before);
  const afterLines = splitPatchLines(after);
  const hunk = createPatchHunk(beforeLines, afterLines);
  return { files: [{ path, hunks: hunk ? [hunk] : [] }] };
}

function splitPatchLines(content: string): string[] {
  if (content.length === 0) return [];
  return content.replace(/\r\n/gu, "\n").replace(/\n$/u, "").split("\n");
}

function createPatchHunk(beforeLines: string[], afterLines: string[]): PatchHunk | undefined {
  let prefix = 0;
  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < beforeLines.length - prefix &&
    suffix < afterLines.length - prefix &&
    beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const oldLines = beforeLines.slice(prefix, beforeLines.length - suffix);
  const newLines = afterLines.slice(prefix, afterLines.length - suffix);
  if (oldLines.length === 0 && newLines.length === 0) return undefined;
  const contextBefore = beforeLines.slice(
    Math.max(0, prefix - STRUCTURED_PATCH_CONTEXT_LINES),
    prefix,
  );
  const contextAfter = beforeLines.slice(
    beforeLines.length - suffix,
    Math.min(beforeLines.length - suffix + STRUCTURED_PATCH_CONTEXT_LINES, beforeLines.length),
  );

  return {
    oldStart: oldLines.length > 0 ? prefix + 1 : prefix,
    newStart: newLines.length > 0 ? prefix + 1 : prefix,
    contextBefore,
    oldLines: oldLines.slice(0, STRUCTURED_PATCH_LINE_LIMIT),
    newLines: newLines.slice(0, STRUCTURED_PATCH_LINE_LIMIT),
    contextAfter,
    oldLineCount: oldLines.length,
    newLineCount: newLines.length,
    truncated: oldLines.length > STRUCTURED_PATCH_LINE_LIMIT || newLines.length > STRUCTURED_PATCH_LINE_LIMIT,
  };
}

function createPatchSummary(changedFiles: string[], before: string, after: string): DiffSummary {
  const beforeLines = before.length > 0 ? before.split(/\r?\n/u) : [];
  const afterLines = after.length > 0 ? after.split(/\r?\n/u) : [];
  const common = new Map<string, number>();
  for (const line of beforeLines) {
    common.set(line, (common.get(line) ?? 0) + 1);
  }
  let unchanged = 0;
  for (const line of afterLines) {
    const count = common.get(line) ?? 0;
    if (count > 0) {
      unchanged += 1;
      common.set(line, count - 1);
    }
  }
  const addedLines = Math.max(afterLines.length - unchanged, 0);
  const removedLines = Math.max(beforeLines.length - unchanged, 0);
  return {
    changedFiles,
    addedLines,
    removedLines,
    summary: `编辑改动 ${changedFiles.length} 个文件，+${addedLines} -${removedLines}。`,
    riskyFiles: changedFiles.filter((file) => file.includes(".env") || file.startsWith(".git/")),
  };
}

function createPatchDetails(
  operation: "Write" | "Edit" | "MultiEdit",
  rel: string,
  before: string,
  after: string,
  readGuard: EditReadGuard,
  editCount: number,
): string {
  const beforeLines = before.split(/\r?\n/u);
  const afterLines = after.split(/\r?\n/u);
  return [
    `operation: ${operation}`,
    `file: ${rel}`,
    `edit count: ${editCount}`,
    "read protection: enabled",
    "encoding: utf8",
    `newline: ${detectNewlineStyle(before)} -> ${detectNewlineStyle(after)}`,
    "--- before (first changed context)",
    ...previewChangedLines(beforeLines, afterLines, "-"),
    "+++ after (first changed context)",
    ...previewChangedLines(afterLines, beforeLines, "+"),
  ].join("\n");
}

function previewChangedLines(primary: string[], other: string[], marker: "-" | "+"): string[] {
  const limit = 12;
  const changed = primary.filter((line, index) => other[index] !== line).slice(0, limit);
  if (changed.length === 0) {
    return [`${marker} <no line-level preview; content hash changed or unchanged>`];
  }
  return changed.map((line) => `${marker} ${line}`);
}

function hashText(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function detectNewlineStyle(content: string): "lf" | "crlf" | "mixed" | "none" {
  const crlf = (content.match(/\r\n/gu) ?? []).length;
  const lf = (content.match(/(?<!\r)\n/gu) ?? []).length;
  if (crlf > 0 && lf > 0) return "mixed";
  if (crlf > 0) return "crlf";
  if (lf > 0) return "lf";
  return "none";
}

async function* listFiles(
  root: string,
  shouldStop?: () => boolean,
  searchRoot = root,
): AsyncGenerator<string> {
  if (shouldStop?.()) return;
  const current = await stat(root);
  if (current.isFile()) {
    yield root;
    return;
  }

  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (shouldStop?.()) return;
    const entryPath = join(root, entry.name);
    if (isDefaultSearchExcludedPath(entryPath, searchRoot, entry)) {
      continue;
    }
    if (entry.isDirectory()) {
      yield* listFiles(entryPath, shouldStop, searchRoot);
      continue;
    }
    if (entry.isFile()) {
      yield entryPath;
    }
  }
}

function isDefaultSearchExcludedPath(
  entryPath: string,
  searchRoot: string,
  entry: { name: string; isDirectory(): boolean; isFile(): boolean },
): boolean {
  if (entry.isDirectory() && SEARCH_EXCLUDED_DIR_NAMES.includes(entry.name)) {
    return true;
  }
  if (
    entry.isFile() &&
    SEARCH_EXCLUDED_FILE_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))
  ) {
    return true;
  }
  const rel = stripCurrentDirectoryPrefix(relative(searchRoot, entryPath).replaceAll("\\", "/"));
  return SEARCH_EXCLUDED_PATH_PREFIXES.some(
    (prefix) => rel === prefix || rel.startsWith(`${prefix}/`),
  );
}

async function safeReadText(filePath: string, context: ToolContext): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    await context.onProgress?.({
      toolName: "Grep",
      stream: "system",
      text: `read skipped: ${relativePath(context.workspaceRoot, filePath)} (${formatDiagnosticError(error)})`,
    });
    return null;
  }
}

function formatDiagnosticError(error: unknown): string {
  return error instanceof Error ? error.message.replace(/\s+/g, " ").trim() : String(error);
}

type SearchBackendResult = {
  matches: string[];
  truncated: boolean;
};

async function tryRipgrepSearch(
  input: GrepInput,
  context: ToolContext,
  root: string,
  limit: number,
): Promise<SearchBackendResult | null> {
  const args = [
    "--line-number",
    "--no-heading",
    "--color",
    "never",
    "--hidden",
    "--no-ignore",
    "--max-columns",
    "500",
    ...createRgExcludeArgs(root, context.workspaceRoot),
  ];
  const pattern = input.pattern.startsWith("(?i)") ? input.pattern.slice(4) : input.pattern;
  if (input.pattern.startsWith("(?i)")) {
    args.push("-i");
  }
  args.push("-e", pattern, relativePath(context.workspaceRoot, root));
  const result = await runRipgrep(args, context, limit, (line) =>
    normalizeRgGrepLine(line, context.workspaceRoot),
  );
  if (!result) return null;
  const matches = result.lines.slice(0, limit);
  return { matches, truncated: result.truncated };
}

async function tryRipgrepFiles(
  input: GlobInput,
  context: ToolContext,
  root: string,
  limit: number,
): Promise<SearchBackendResult | null> {
  const args = [
    "--files",
    "--color",
    "never",
    "--hidden",
    "--no-ignore",
    ...createRgExcludeArgs(root, context.workspaceRoot),
  ];
  args.push(relativePath(context.workspaceRoot, root));
  const matcher = globToRegExp(input.pattern);
  const result = await runRipgrep(args, context, limit, (line) => {
    const normalized = normalizeRgPath(line, context.workspaceRoot, root);
    return matcher.test(normalized) || matcher.test(basename(normalized)) ? normalized : null;
  });
  if (!result) return null;
  return { matches: result.lines.slice(0, limit), truncated: result.truncated };
}

async function findSourcePackMatches(
  query: string,
  terms: string[],
  context: ToolContext,
  limit: number,
): Promise<{ source: SourcePackMatch["source"]; matches: SourcePackMatch[] }> {
  const indexMatches = sourcePackMatchesFromCandidates(query, context.sourcePackCandidates, limit);
  if (indexMatches.length > 0) {
    return { source: "index", matches: indexMatches };
  }
  const rgMatches = await tryRipgrepSourcePack(terms, context, limit);
  if (rgMatches && rgMatches.length > 0) {
    return { source: "rg", matches: rgMatches };
  }
  const matches: SourcePackMatch[] = [];
  for await (const filePath of listFiles(context.workspaceRoot, () => matches.length >= limit)) {
    const content = await safeReadText(filePath, context);
    if (content === null) continue;
    const rel = relativePath(context.workspaceRoot, filePath);
    const pathTerm = terms.find((item) => rel.toLowerCase().includes(item.toLowerCase()));
    if (pathTerm) {
      matches.push({
        path: rel,
        line: 1,
        text: rel,
        term: pathTerm,
        source: "file_name",
        confidence: 0.35,
        reason: `fallback file name matched "${pathTerm}"`,
      });
      if (matches.length >= limit) break;
    }
    const lines = content.split(/\r?\n/u);
    for (const [index, line] of lines.entries()) {
      const lower = line.toLowerCase();
      const term = terms.find((item) => lower.includes(item.toLowerCase()));
      if (!term) continue;
      matches.push({
        path: rel,
        line: index + 1,
        text: line,
        term,
        source: "local_scan",
        confidence: 0.4,
        reason: `fallback local scan matched "${term}" at line ${index + 1}`,
      });
      if (matches.length >= limit) break;
    }
  }
  return { source: matches[0]?.source ?? "local_scan", matches };
}

async function tryRipgrepSourcePack(
  terms: string[],
  context: ToolContext,
  limit: number,
): Promise<SourcePackMatch[] | null> {
  const args = [
    "--line-number",
    "--no-heading",
    "--color",
    "never",
    "--hidden",
    "--no-ignore",
    "--max-columns",
    "500",
    "-i",
    "-F",
    ...createRgExcludeArgs(context.workspaceRoot, context.workspaceRoot),
  ];
  for (const term of terms) {
    args.push("-e", term);
  }
  args.push(".");
  const result = await runRipgrep(args, context, limit, (line) =>
    normalizeRgGrepLine(line, context.workspaceRoot),
  );
  if (!result) return null;
  return result.lines.flatMap((line) => parseSourcePackRgLine(line, terms));
}

function parseSourcePackRgLine(line: string, terms: string[]): SourcePackMatch[] {
  const firstColon = line.indexOf(":");
  const secondColon = firstColon < 0 ? -1 : line.indexOf(":", firstColon + 1);
  if (firstColon < 0 || secondColon < 0) return [];
  const lineNumber = Number.parseInt(line.slice(firstColon + 1, secondColon), 10);
  if (!Number.isInteger(lineNumber)) return [];
  const text = line.slice(secondColon + 1).trim();
  const lower = text.toLowerCase();
  const term = terms.find((item) => lower.includes(item.toLowerCase())) ?? terms[0];
  return [
    {
      path: line.slice(0, firstColon),
      line: lineNumber,
      text,
      term,
      source: "rg",
      confidence: 0.6,
      reason: `rg matched "${term}" at line ${lineNumber}`,
    },
  ];
}

function sourcePackMatchesFromCandidates(
  query: string,
  candidates: SourcePackCandidate[] | undefined,
  limit: number,
): SourcePackMatch[] {
  if (!candidates || candidates.length === 0) return [];
  const terms = extractSourcePackTerms(query);
  return candidates.slice(0, limit).map((candidate) => {
    const start = Math.max(1, candidate.start);
    const end = Math.max(start, candidate.end);
    const term = terms[0] ?? query;
    return {
      path: candidate.path,
      line: start,
      text: candidate.reason ?? candidate.path,
      term,
      source: "index",
      start,
      end,
      confidence: candidate.confidence ?? 0.85,
      reason: candidate.reason ?? `index candidate for "${query}"`,
    };
  });
}

function extractSourcePackTerms(query: string): string[] {
  const terms = query
    .split(/[^\p{L}\p{N}_.$/@-]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2 && !/^\d+$/u.test(term));
  return unique(terms).slice(0, SOURCE_PACK_MAX_TERMS);
}

function estimateSourcePackConfidence(query: string, match: SourcePackMatch): number {
  if (match.confidence !== undefined) return match.confidence;
  const queryTerms = extractSourcePackTerms(query);
  const haystack = `${match.path} ${match.text}`.toLowerCase();
  const hitCount = queryTerms.filter((term) => haystack.includes(term.toLowerCase())).length;
  const base = match.source === "index" ? 0.7 : match.source === "rg" ? 0.45 : 0.25;
  const cap = match.source === "index" ? 0.95 : match.source === "rg" ? 0.75 : 0.55;
  return Math.min(cap, base + hitCount * 0.15);
}

function formatSourcePackOutput(
  snippets: Array<
    SnippetRangeOutput & { reason: string; confidence: number; source: SourcePackMatch["source"] }
  >,
  safetyTruncated: boolean,
): string {
  const lines: string[] = [];
  for (const snippet of snippets) {
    lines.push(
      [
        `${snippet.path}:${snippet.start}-${snippet.end}`,
        `source: ${snippet.source}; reason: ${snippet.reason}; confidence: ${snippet.confidence.toFixed(2)}`,
        snippet.content,
      ].join("\n"),
    );
  }
  if (safetyTruncated) {
    lines.push("...（结果已截断，后续内容省略；如需精读请指定更小范围。）");
  }
  return lines.join("\n\n");
}

function createRgExcludeArgs(root: string, workspaceRoot: string): string[] {
  const searchRootRel = stripCurrentDirectoryPrefix(
    relative(workspaceRoot, root).replaceAll("\\", "/"),
  );
  return [
    ...SEARCH_EXCLUDED_DIR_NAMES.filter(
      (dir) => !isExplicitExcludedDirRoot(searchRootRel, dir),
    ).map((dir) => `!**/${dir}/**`),
    ...SEARCH_EXCLUDED_PATH_PREFIXES.filter((path) => !isSameOrInside(searchRootRel, path)).map(
      (path) => `!**/${path}/**`,
    ),
    ...SEARCH_EXCLUDED_FILE_SUFFIXES.filter((suffix) => !searchRootRel.endsWith(suffix)).map(
      (suffix) => `!**/*${suffix}`,
    ),
  ].flatMap((pattern) => ["--glob", pattern]);
}

function isExplicitExcludedDirRoot(searchRootRel: string, dir: string): boolean {
  return searchRootRel === dir || searchRootRel.endsWith(`/${dir}`);
}

function isSameOrInside(value: string, parent: string): boolean {
  return value === parent || value.startsWith(`${parent}/`);
}

function normalizeRgPath(line: string, workspaceRoot: string, root: string): string {
  const filePath = resolve(workspaceRoot, line);
  const rel = relative(root, filePath);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return stripCurrentDirectoryPrefix(line.replaceAll("\\", "/"));
  }
  return stripCurrentDirectoryPrefix(rel.replaceAll("\\", "/"));
}

function normalizeRgGrepLine(line: string, workspaceRoot: string): string {
  const firstColon = line.indexOf(":");
  if (firstColon < 0) return normalizeRgPath(line, workspaceRoot, workspaceRoot);
  const secondColon = line.indexOf(":", firstColon + 1);
  if (secondColon < 0) return normalizeRgPath(line, workspaceRoot, workspaceRoot);
  const file = normalizeRgPath(line.slice(0, firstColon), workspaceRoot, workspaceRoot);
  return `${file}${line.slice(firstColon)}`;
}

function stripCurrentDirectoryPrefix(value: string): string {
  return value.replace(/^\.\/+/u, "");
}

async function runRipgrep(
  args: string[],
  context: ToolContext,
  limit: number,
  mapLine: (line: string) => string | null = (line) => line,
): Promise<{ lines: string[]; truncated: boolean } | null> {
  return new Promise((resolvePromise) => {
    const child = spawn("rg", args, {
      cwd: context.workspaceRoot,
      shell: false,
      windowsHide: true,
    });
    const lines: string[] = [];
    let pending = "";
    let stderr = "";
    let resolved = false;
    let killedForLimit = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        child.kill();
      }
    }, RG_TIMEOUT_MS);
    const abort = () => child.kill();
    context.abortSignal?.addEventListener("abort", abort, { once: true });
    const finish = (value: { lines: string[]; truncated: boolean } | null) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      context.abortSignal?.removeEventListener("abort", abort);
      resolvePromise(value);
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      pending += chunk;
      const parts = pending.split(/\r?\n/u);
      pending = parts.pop() ?? "";
      for (const line of parts) {
        if (!line) continue;
        const mapped = mapLine(line);
        if (!mapped) continue;
        lines.push(mapped);
        if (lines.length >= limit) {
          killedForLimit = true;
          child.kill();
          break;
        }
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", () => finish(null));
    child.on("close", (code) => {
      if (pending && lines.length < limit) {
        const mapped = mapLine(pending);
        if (mapped) {
          lines.push(mapped);
        }
      }
      if (killedForLimit) {
        finish({ lines, truncated: true });
        return;
      }
      if (code === 0 || code === 1) {
        finish({ lines, truncated: false });
        return;
      }
      if (stderr) {
        finish(null);
        return;
      }
      finish(null);
    });
  });
}

function globToRegExp(pattern: string): RegExp {
  const startsWithDoubleStarSlash = pattern.startsWith("**/");
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "::DOUBLE_STAR::")
    .replace(/\*/g, "[^/]*")
    .replace(/::DOUBLE_STAR::/g, ".*")
    .replace(/\?/g, ".");
  let result = `^${escaped}$`;
  // D.14H Phase 7.5-C：**/ 开头的 pattern 应同时匹配根目录文件和子目录文件。
  // globToRegExp 会把 **/ 转成 .*/，导致根目录文件被排除。
  if (startsWithDoubleStarSlash) {
    result = result.replace(/^\^\.\*\//u, "^(?:.*/)?");
  }
  return new RegExp(result);
}

function runShell(
  command: string,
  cwd: string,
  timeoutMs: number,
  fullOutputPath: string,
  headerLines: string[],
  signal?: AbortSignal,
  onProgress?: (stream: "stdout" | "stderr" | "system", text: string) => void,
  trackChildProcess?: ToolContext["trackChildProcess"],
): Promise<{ exitCode: number; capture: BashOutputCapture; outcome: "completed" | "timeout" | "cancelled" }> {
  return new Promise((resolvePromise) => {
    const detached = process.platform !== "win32";
    const child = spawn(command, { cwd, shell: true, windowsHide: true, detached });
    trackChildProcess?.(child, {
      detached,
      cwd,
      label: `Bash:${command.slice(0, 80)}`,
      retainAfterExit: detached,
    });
    const capture = createBashOutputCapture();
    let logWrite = writeFile(fullOutputPath, `${headerLines.join("\n")}\n\n`, "utf8");
    capture.appendLogOnly(`${headerLines.join("\n")}\n\n`);
    const appendSanitizedChunk = (text: string, countAsOutput: boolean): void => {
      const sanitized = sanitizeSecrets(text);
      if (countAsOutput) {
        capture.appendOutput(sanitized);
      } else {
        capture.appendLogOnly(sanitized);
      }
      logWrite = logWrite.then(() => appendFileToPath(fullOutputPath, sanitized));
    };
    let settled = false;
    let forcedKillTimer: NodeJS.Timeout | undefined;
    let stoppingOutcome: "timeout" | "cancelled" | undefined;
    let childClosed = false;
    const finish = (
      exitCode: number,
      outcome: "completed" | "timeout" | "cancelled" = "completed",
    ) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (forcedKillTimer && outcome === "completed") {
        clearTimeout(forcedKillTimer);
      }
      signal?.removeEventListener("abort", onAbort);
      void logWrite.finally(() => resolvePromise({ exitCode, capture, outcome }));
    };
    const waitForChildClose = (): Promise<void> =>
      new Promise((resolveClose) => {
        if (childClosed || child.exitCode !== null || child.signalCode !== null) {
          resolveClose();
          return;
        }
        child.once("close", () => resolveClose());
      });
    const requestStop = async (force: boolean): Promise<void> => {
      if (process.platform === "win32" && child.pid) {
        await stopWindowsProcessTree(child.pid, cwd);
        return;
      }
      const signalName = force ? "SIGKILL" : "SIGTERM";
      if (detached && child.pid) {
        try {
          process.kill(-child.pid, signalName);
        } catch {
          child.kill(signalName);
        }
      } else {
        child.kill(signalName);
      }
      if (force) {
        await waitForChildClose();
      }
    };
    const scheduleForceStop = () => {
      forcedKillTimer = setTimeout(() => {
        void requestStop(true);
      }, 1_000);
    };
    const onAbort = async () => {
      const message = "\n工具调用已取消，正在终止子进程。\n";
      appendSanitizedChunk(message, true);
      onProgress?.("system", message);
      stoppingOutcome = "cancelled";
      if (process.platform === "win32") {
        await requestStop(true);
      } else {
        void requestStop(false);
        scheduleForceStop();
      }
      finish(1, "cancelled");
    };
    const timer = setTimeout(() => {
      void handleTimeout();
    }, timeoutMs);
    const handleTimeout = async () => {
      const message = `\n命令超时：超过 ${timeoutMs}ms，已尝试终止子进程。\n`;
      appendSanitizedChunk(message, true);
      onProgress?.("system", message);
      stoppingOutcome = "timeout";
      if (process.platform === "win32") {
        await requestStop(true);
      } else {
        void requestStop(false);
        scheduleForceStop();
      }
      finish(1, "timeout");
    };
    if (signal?.aborted) {
      void onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });

    // D.14H Phase 7.5-C：Windows 控制台输出可能为 GBK/GB18030 编码，
    // UTF-8 decode 会产生 � 或 mojibake。优先 UTF-8，检测到问题时回退 GB18030。
    child.stdout.on("data", (chunk: Buffer) => {
      const text = decodeShellChunk(chunk);
      appendSanitizedChunk(text, true);
      onProgress?.("stdout", text);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = decodeShellChunk(chunk);
      appendSanitizedChunk(text, true);
      onProgress?.("stderr", text);
    });
    child.on("close", (code) => {
      childClosed = true;
      if (stoppingOutcome) {
        return;
      }
      finish(code ?? 1);
    });
    child.on("error", (error) => {
      appendSanitizedChunk(`命令执行失败：${error.message}\n`, true);
      finish(1);
    });
  });
}

// ---------------------------------------------------------------------------
// Background Bash execution — spawns and returns immediately; notifies via
// onComplete callback when the process finishes.
// ---------------------------------------------------------------------------

const STALL_THRESHOLD_MS = 45_000;
const PROMPT_PATTERNS = [
  /\(y\/n\)\s*$/i,
  /\[y\/n\]\s*$/i,
  /\(yes\/no\)\s*$/i,
  /Press Enter/i,
  /Continue\?/i,
  /Overwrite\?/i,
  /password[:\s]*$/i,
  /passphrase[:\s]*$/i,
  /\?\s*$/,
];

function looksLikePrompt(tail: string): boolean {
  const lastLine = tail.split(/\r?\n/).filter(Boolean).pop() ?? "";
  return PROMPT_PATTERNS.some((re) => re.test(lastLine));
}

type RunBackgroundBashOptions = {
  taskId: string;
  command: string;
  originalCommand: string;
  cwd: string;
  timeoutMs: number;
  fullOutputPath: string;
  adapter: string;
  logCommand?: string;
  retainAfterReturn?: boolean;
  abortSignal?: AbortSignal;
  onProgress?: (stream: "stdout" | "stderr" | "system", text: string) => void;
  trackChildProcess?: ToolContext["trackChildProcess"];
  onComplete?: (result: BashBackgroundResult) => void;
};

async function runBackgroundBash(opts: RunBackgroundBashOptions): Promise<void> {
  const {
    taskId,
    command,
    originalCommand,
    cwd,
    timeoutMs,
    fullOutputPath,
    adapter,
    logCommand,
    retainAfterReturn,
    abortSignal,
    onProgress,
    trackChildProcess,
    onComplete,
  } = opts;

  await mkdir(dirname(fullOutputPath), { recursive: true }).catch(() => {});
  const fileStream = createWriteStream(fullOutputPath, { encoding: "utf8" });

  const commandForLog = logCommand ?? command;
  const header = [
    `$ ${sanitizeSecrets(commandForLog)}`,
    ...(adapter !== "native" ? [`adapter ${adapter}`, `original command ${summarizeOriginalShellCommand(originalCommand)}`] : []),
    "",
  ].join("\n");
  fileStream.write(header);

  const detached = process.platform !== "win32";
  if (retainAfterReturn) {
    fileStream.write("\n[background] retained process started\n");
    await new Promise<void>((resolveEnd) => fileStream.end(resolveEnd));
    const outFd = openSync(fullOutputPath, "a");
    const errFd = openSync(fullOutputPath, "a");
    const child = spawn(command, {
      cwd,
      shell: true,
      windowsHide: true,
      detached,
      stdio: ["ignore", outFd, errFd],
    });
    closeSync(outFd);
    closeSync(errFd);
    child.unref();
    trackChildProcess?.(child, {
      detached,
      cwd,
      label: `BashBg:${command.slice(0, 80)}`,
      retainAfterExit: true,
    });
    onComplete?.({
      taskId,
      exitCode: 0,
      outcome: "completed",
      outputPath: fullOutputPath,
      command: sanitizeSecrets(originalCommand),
    });
    return;
  }
  const child = spawn(command, { cwd, shell: true, windowsHide: true, detached });
  trackChildProcess?.(child, {
    detached,
    cwd,
    label: `BashBg:${command.slice(0, 80)}`,
    retainAfterExit: detached,
  });

  let tailBuffer = "";
  let lastOutputTime = Date.now();
  let stallTimer: NodeJS.Timeout | undefined;
  let settled = false;
  let outcome: "completed" | "timeout" | "cancelled" = "completed";

  const resetStallTimer = () => {
    lastOutputTime = Date.now();
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(checkStall, STALL_THRESHOLD_MS);
  };

  const checkStall = () => {
    if (Date.now() - lastOutputTime >= STALL_THRESHOLD_MS && looksLikePrompt(tailBuffer)) {
      const msg = "\n[stall watchdog] 检测到交互式提示，可能需要用户输入。\n";
      fileStream.write(msg);
      onProgress?.("system", msg);
    }
  };

  const finish = (exitCode: number) => {
    if (settled) return;
    settled = true;
    if (stallTimer) clearTimeout(stallTimer);
    clearTimeout(timer);
    abortSignal?.removeEventListener("abort", onAbort);

    const footer = `\nexit code ${exitCode}\noutcome ${outcome}\n`;
    fileStream.write(footer);
    fileStream.end();

    onComplete?.({
      taskId,
      exitCode,
      outcome,
      outputPath: fullOutputPath,
      command: sanitizeSecrets(originalCommand),
    });
  };

  const requestStop = async (force: boolean): Promise<void> => {
    if (process.platform === "win32" && child.pid) {
      await stopWindowsProcessTree(child.pid, cwd);
      return;
    }
    const sig = force ? "SIGKILL" : "SIGTERM";
    if (detached && child.pid) {
      try { process.kill(-child.pid, sig); } catch { child.kill(sig); }
    } else {
      child.kill(sig);
    }
  };

  const FORCE_KILL_WAIT_MS = 3000;

  const waitForCloseOrForceKill = () => {
    const forceTimer = setTimeout(() => {
      void requestStop(true);
      setTimeout(() => finish(1), 500);
    }, FORCE_KILL_WAIT_MS);
    child.once("close", () => { clearTimeout(forceTimer); });
  };

  const onAbort = () => {
    if (settled) return;
    outcome = "cancelled";
    const msg = "\n[cancelled] 工具调用已取消，正在终止子进程。\n";
    fileStream.write(msg);
    onProgress?.("system", msg);
    void requestStop(false);
    waitForCloseOrForceKill();
  };

  const timer = setTimeout(() => {
    if (settled) return;
    outcome = "timeout";
    const msg = `\n[timeout] 命令超时：超过 ${timeoutMs}ms，已终止。\n`;
    fileStream.write(msg);
    onProgress?.("system", msg);
    void requestStop(false);
    waitForCloseOrForceKill();
  }, timeoutMs);

  if (abortSignal?.aborted) { onAbort(); return; }
  abortSignal?.addEventListener("abort", onAbort, { once: true });

  child.stdout.on("data", (chunk: Buffer) => {
    const text = decodeShellChunk(chunk);
    fileStream.write(text);
    tailBuffer = (tailBuffer + text).slice(-2000);
    resetStallTimer();
    onProgress?.("stdout", text);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    const text = decodeShellChunk(chunk);
    fileStream.write(text);
    tailBuffer = (tailBuffer + text).slice(-2000);
    resetStallTimer();
    onProgress?.("stderr", text);
  });
  child.on("close", (code) => { finish(code ?? 1); });
  child.on("error", (err) => {
    fileStream.write(`\n[error] ${err.message}\n`);
    finish(1);
  });
}

function decodeShellChunk(chunk: Buffer): string {
  const utf8 = chunk.toString("utf8");
  if (process.platform !== "win32") return utf8;
  if (!utf8.includes("�")) return utf8;

  try {
    const decoder = new TextDecoder("gb18030", { fatal: false });
    const gbk = decoder.decode(chunk);
    const utf8Errors = utf8.split("�").length - 1;
    const gbkErrors = gbk.split("�").length - 1;
    if (gbkErrors < utf8Errors) return gbk;
  } catch {
    // TextDecoder("gb18030") not available on this runtime
  }

  return utf8;
}

async function stopWindowsProcessTree(rootPid: number, cwd: string): Promise<void> {
  const deadline = Date.now() + 900;
  await taskkillWindowsPids([rootPid]);
  while (Date.now() < deadline) {
    await stopWindowsWorkspaceProcesses(rootPid, cwd);
    await sleep(50);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function taskkillWindowsPids(pids: number[]): Promise<void> {
  return new Promise((resolveStop) => {
    const uniquePids = [...new Set(pids.filter((pid) => Number.isInteger(pid) && pid > 0))];
    if (uniquePids.length === 0) {
      resolveStop();
      return;
    }
    const args = [...uniquePids.flatMap((pid) => ["/pid", String(pid)]), "/t", "/f"];
    const killer = spawn("taskkill", args, { windowsHide: true });
    const stopTimeout = setTimeout(() => {
      killer.kill("SIGKILL");
      resolveStop();
    }, 750);
    const finishStop = () => {
      clearTimeout(stopTimeout);
      resolveStop();
    };
    killer.on("error", finishStop);
    killer.on("close", finishStop);
  });
}

function stopWindowsWorkspaceProcesses(rootPid: number, cwd: string): Promise<void> {
  return new Promise((resolveStop) => {
    const script = `
$rootPid = ${rootPid}
$cwd = ${JSON.stringify(cwd)}
$rows = @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine)
$children = @{}
foreach ($row in $rows) {
  $parent = [int]$row.ParentProcessId
  if (-not $children.ContainsKey($parent)) { $children[$parent] = @() }
  $children[$parent] += [int]$row.ProcessId
}
$queue = New-Object System.Collections.Generic.Queue[int]
$seen = New-Object 'System.Collections.Generic.HashSet[int]'
$queue.Enqueue($rootPid)
$pids = @()
while ($queue.Count -gt 0) {
  $pid = $queue.Dequeue()
  if (-not $seen.Add($pid)) { continue }
  $pids += $pid
  if ($children.ContainsKey($pid)) {
    foreach ($childPid in $children[$pid]) { $queue.Enqueue($childPid) }
  }
}
$cwdLower = $cwd.ToLowerInvariant()
foreach ($row in $rows) {
  $cmd = [string]$row.CommandLine
  if ($cmd.ToLowerInvariant().Contains($cwdLower)) { $pids += [int]$row.ProcessId }
}
$pids = $pids | Sort-Object -Unique
foreach ($targetPid in $pids) {
  if ($targetPid -gt 0 -and $targetPid -ne $PID) {
    Stop-Process -Id $targetPid -Force -ErrorAction SilentlyContinue
  }
}
`;
    const killer = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true,
    });
    const stopTimeout = setTimeout(() => {
      killer.kill("SIGKILL");
      resolveStop();
    }, 900);
    const finishStop = () => {
      clearTimeout(stopTimeout);
      resolveStop();
    };
    killer.on("error", finishStop);
    killer.on("close", finishStop);
  });
}

function findTodo(items: TodoItem[], id: string, content?: string): TodoItem {
  const item = items.find((todo) => todo.id === id);
  if (item) return item;

  const normalizedContent = normalizeTodoContent(content);
  if (normalizedContent) {
    const matches = items.filter((todo) => normalizeTodoContent(todo.content) === normalizedContent);
    if (matches.length === 1) return matches[0] as TodoItem;
    if (matches.length > 1) {
      throw new Error(`未找到唯一 Todo：${id}。content 匹配到 ${matches.length} 条；建议：先运行 /todo 查看当前任务。`);
    }
  }

  throw new Error(`未找到 Todo：${id}。建议：先运行 /todo 查看当前任务。`);
}

function normalizeTodoContent(content: string | undefined): string {
  return (content ?? "").trim().replace(/\s+/gu, " ");
}

function formatTodos(items: TodoItem[]): string {
  if (items.length === 0) {
    return "当前没有 Todo。";
  }
  return items
    .map((item) => {
      const evidence = item.evidence ? `（${item.evidence}）` : "";
      return `${item.id}. [${item.status}] ${item.content}${evidence}`;
    })
    .join("\n");
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

// D.14H Phase 7.5-C test entry points
export const __testGlobToRegExp = globToRegExp;
export const __testDecodeShellChunk = decodeShellChunk;
export const __testParseBashCommandIntent = parseBashCommandIntent;
export const __testCanSafelyAliasPythonCommand = canSafelyAliasPythonCommand;
export { interpretCommandResult } from "./tools/Bash/command-semantics.js";
export const __testRunBackgroundBash = runBackgroundBash;
