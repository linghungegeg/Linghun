import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";

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

export type ToolInterruptBehavior = "abortable" | "best-effort" | "not-supported";

export type ToolLifecycleMetadata = {
  enabled: boolean;
  destructive: boolean;
  interruptBehavior: ToolInterruptBehavior;
  maxResultSizeChars: number;
};

export type ToolDefinition<Input = unknown> = {
  name: ToolName;
  title: string;
  description: string;
  permission: ToolPermissionSpec;
  isReadOnly: boolean;
  isConcurrencySafe: boolean;
  isLongRunning?: boolean;
  lifecycle: ToolLifecycleMetadata;
  validateInput(input: unknown): Input;
  call(input: Input, context: ToolContext): Promise<ToolOutput>;
};

export type ToolProgressEvent = {
  toolName: ToolName;
  stream: "stdout" | "stderr" | "system";
  text: string;
};

export type ReadSnapshot = {
  path: string;
  hash: string;
  mtimeMs: number;
  size: number;
};

export type ToolContext = {
  workspaceRoot: string;
  logRoot?: string;
  changedFiles: string[];
  todos: TodoItem[];
  readSnapshots?: Record<string, ReadSnapshot>;
  patchSummaries?: Record<string, DiffSummary>;
  abortSignal?: AbortSignal;
  onProgress?: (event: ToolProgressEvent) => void | Promise<void>;
};

export type ToolName =
  | "Read"
  | "Write"
  | "Edit"
  | "MultiEdit"
  | "Grep"
  | "Glob"
  | "Bash"
  | "Todo"
  | "Diff";

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

export type ReadInput = { path: string; offset?: number; limit?: number };
export type WriteInput = { path: string; content: string; expectedHash?: string };
export type EditInput = { path: string; oldText: string; newText: string; expectedHash?: string };
export type MultiEditInput = {
  path: string;
  edits: { oldText: string; newText: string }[];
  expectedHash?: string;
};
export type GrepInput = { pattern: string; path?: string; limit?: number };
export type GlobInput = { pattern: string; path?: string; limit?: number };
export type BashInput = { command: string; timeoutMs?: number };
export type TodoInput =
  | { action: "list" }
  | { action: "add"; content: string }
  | { action: "start" | "done" | "block"; id: string; evidence?: string };
export type DiffInput = { files?: string[] };

export type ToolRunResult = {
  id: string;
  name: ToolName;
  input: unknown;
  output: ToolOutput;
};

export const toolRegistryStatus = "ready" as const;

const DEFAULT_LIMIT = 200;
const DEFAULT_SEARCH_LIMIT = 100;
const DEFAULT_TOOL_TEXT_LIMIT = 8_000;
const BASH_PREVIEW_LIMIT = 4_000;
const BASH_TIMEOUT_MS = 120_000;
const MAX_TODO_ITEMS = 100;

export function createToolContext(workspaceRoot = process.cwd()): ToolContext {
  return {
    workspaceRoot: resolve(workspaceRoot),
    changedFiles: [],
    todos: [],
    readSnapshots: {},
    patchSummaries: {},
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

function defineTool<Input>(definition: ToolDefinition<Input>): ToolDefinition<Input> {
  return definition;
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
  return {
    ...output,
    text: preview,
    preview: output.preview ?? preview,
    details: output.details ?? output.text,
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
    path: readOptionalString(record, "path", "Grep"),
    limit: readOptionalPositiveInteger(record, "limit", "Grep"),
  };
}

function validateGlobInput(input: unknown): GlobInput {
  const record = validateRecord(input, "Glob");
  return {
    pattern: readString(record, "pattern", "Glob"),
    path: readOptionalString(record, "path", "Glob"),
    limit: readOptionalPositiveInteger(record, "limit", "Glob"),
  };
}

function validateBashInput(input: unknown): BashInput {
  const record = validateRecord(input, "Bash");
  return {
    command: readString(record, "command", "Bash"),
    timeoutMs: readOptionalPositiveInteger(record, "timeoutMs", "Bash"),
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

async function readTool(input: ReadInput, context: ToolContext): Promise<ToolOutput> {
  const filePath = resolveWorkspacePath(context.workspaceRoot, input.path);
  const content = await readFile(filePath, "utf8");
  const info = await stat(filePath);
  rememberReadSnapshot(context, filePath, content, info);
  const lines = content.split(/\r?\n/);
  const offset = Math.max(input.offset ?? 0, 0);
  const limit = Math.max(input.limit ?? DEFAULT_LIMIT, 1);
  const selected = lines.slice(offset, offset + limit);
  const text = selected.map((line, index) => `${offset + index + 1}\t${line}`).join("\n");
  return {
    text,
    data: {
      path: relativePath(context.workspaceRoot, filePath),
      lines: selected.length,
      hash: hashText(content),
      newline: detectNewlineStyle(content),
    },
    truncated: offset + limit < lines.length,
  };
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
  const expression = new RegExp(input.pattern);
  const limit = input.limit ?? DEFAULT_SEARCH_LIMIT;
  const matches: string[] = [];

  for (const filePath of await listFiles(root)) {
    if (matches.length >= limit) {
      break;
    }
    const content = await safeReadText(filePath);
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

async function globTool(input: GlobInput, context: ToolContext): Promise<ToolOutput> {
  const root = resolveWorkspacePath(context.workspaceRoot, input.path ?? ".");
  const limit = input.limit ?? DEFAULT_SEARCH_LIMIT;
  const matcher = globToRegExp(input.pattern);
  const matches: string[] = [];

  for (const filePath of await listFiles(root)) {
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

async function bashTool(input: BashInput, context: ToolContext): Promise<ToolOutput> {
  const logRoot = context.logRoot ?? join(context.workspaceRoot, ".linghun", "logs", "tools");
  await mkdir(logRoot, { recursive: true });
  const fullOutputPath = join(logRoot, `bash-${Date.now()}-${randomUUID()}.log`);
  const timeoutMs = input.timeoutMs ?? BASH_TIMEOUT_MS;
  const result = await runShell(
    input.command,
    context.workspaceRoot,
    timeoutMs,
    context.abortSignal,
    (stream, text) => void context.onProgress?.({ toolName: "Bash", stream, text }),
  );
  const fullText = `$ ${input.command}\nexitCode=${result.exitCode}\noutcome=${result.outcome}\n\n${result.output}`;
  await writeFile(fullOutputPath, fullText, "utf8");
  const truncated = fullText.length > BASH_PREVIEW_LIMIT;
  const preview = truncated
    ? `${fullText.slice(0, BASH_PREVIEW_LIMIT)}\n...（输出已截断，完整日志见 fullOutputPath）`
    : fullText;
  return {
    text: preview,
    data: { exitCode: result.exitCode, outcome: result.outcome },
    truncated,
    fullOutputPath,
  };
}

async function todoTool(input: TodoInput, context: ToolContext): Promise<ToolOutput> {
  if (input.action === "add") {
    if (context.todos.length >= MAX_TODO_ITEMS) {
      throw new Error(`Todo 已达到上限 ${MAX_TODO_ITEMS} 条。建议：先完成或清理旧 Todo。`);
    }
    context.todos.push({
      id: String(context.todos.length + 1),
      content: input.content,
      status: "pending",
    });
  }
  if (input.action === "start") {
    const item = findTodo(context.todos, input.id);
    for (const todo of context.todos) {
      if (todo.status === "in_progress") {
        todo.status = "pending";
      }
    }
    item.status = "in_progress";
    item.evidence = input.evidence ?? item.evidence;
  }
  if (input.action === "done") {
    const item = findTodo(context.todos, input.id);
    item.status = "completed";
    item.evidence = input.evidence ?? item.evidence;
  }
  if (input.action === "block") {
    const item = findTodo(context.todos, input.id);
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
  if (rel.startsWith("..") || (rel === "" && target !== resolve(workspaceRoot))) {
    throw new Error(`路径越界：${inputPath}。建议：只操作当前工作区内文件。`);
  }
  return target;
}

function relativePath(workspaceRoot: string, filePath: string): string {
  return relative(workspaceRoot, filePath).replaceAll("\\", "/") || ".";
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
  context.patchSummaries = { ...(context.patchSummaries ?? {}), [rel]: summary };
  const newlineBefore = detectNewlineStyle(before);
  const newlineAfter = detectNewlineStyle(after);
  const text = [
    `${operation} 已完成：${rel}`,
    `- patch: +${summary.addedLines} -${summary.removedLines}`,
    `- changedFiles: ${rel}`,
    `- readGuard: ${readGuard.source}`,
    `- newline: ${newlineBefore} -> ${newlineAfter}`,
    "- 下一步：用 Diff 或 /details 查看补丁摘要；需要继续编辑请基于最新内容。",
  ].join("\n");
  return {
    text,
    summary: `${operation} ${rel}: +${summary.addedLines} -${summary.removedLines}; changedFiles=1`,
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
    },
    changedFiles: [rel],
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
    `editCount: ${editCount}`,
    `readGuard: ${readGuard.source}`,
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

async function listFiles(root: string): Promise<string[]> {
  const current = await stat(root);
  if (current.isFile()) {
    return [root];
  }

  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") {
      continue;
    }
    const entryPath = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(entryPath)));
      continue;
    }
    if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

async function safeReadText(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "::DOUBLE_STAR::")
    .replace(/\*/g, "[^/]*")
    .replace(/::DOUBLE_STAR::/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

function runShell(
  command: string,
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
  onProgress?: (stream: "stdout" | "stderr" | "system", text: string) => void,
): Promise<{ exitCode: number; output: string; outcome: "completed" | "timeout" | "cancelled" }> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, { cwd, shell: true, windowsHide: true });
    let output = "";
    let settled = false;
    let forcedKillTimer: NodeJS.Timeout | undefined;
    const finish = (
      exitCode: number,
      nextOutput = output,
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
      resolvePromise({ exitCode, output: nextOutput, outcome });
    };
    const requestStop = (force: boolean) => {
      if (process.platform === "win32" && child.pid) {
        const args = ["/pid", String(child.pid), "/t"];
        if (force) {
          args.push("/f");
        }
        const killer = spawn("taskkill", args, { windowsHide: true });
        killer.on("error", () => child.kill(force ? "SIGKILL" : "SIGTERM"));
        return;
      }
      child.kill(force ? "SIGKILL" : "SIGTERM");
    };
    const scheduleForceStop = () => {
      forcedKillTimer = setTimeout(() => requestStop(true), 1_000);
    };
    const onAbort = () => {
      const message = "\n工具调用已取消，正在终止子进程。";
      output += message;
      onProgress?.("system", `${message}\n`);
      requestStop(false);
      scheduleForceStop();
      finish(1, output, "cancelled");
    };
    const timer = setTimeout(() => {
      const message = `\n命令超时：超过 ${timeoutMs}ms，已尝试终止子进程。`;
      output += message;
      onProgress?.("system", `${message}\n`);
      requestStop(false);
      scheduleForceStop();
      finish(1, output, "timeout");
    }, timeoutMs);
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      onProgress?.("stdout", text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      onProgress?.("stderr", text);
    });
    child.on("close", (code) => {
      finish(code ?? 1);
    });
    child.on("error", (error) => {
      finish(1, `命令执行失败：${error.message}`);
    });
  });
}

function findTodo(items: TodoItem[], id: string): TodoItem {
  const item = items.find((todo) => todo.id === id);
  if (!item) {
    throw new Error(`未找到 Todo：${id}。建议：先运行 /todo 查看当前任务。`);
  }
  return item;
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
