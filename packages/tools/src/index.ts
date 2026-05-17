import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
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
  data?: unknown;
  truncated?: boolean;
  fullOutputPath?: string;
  changedFiles?: string[];
};

export type ToolDefinition<Input = unknown> = {
  name: ToolName;
  title: string;
  description: string;
  permission: ToolPermissionSpec;
  isReadOnly: boolean;
  isConcurrencySafe: boolean;
  isLongRunning?: boolean;
  call(input: Input, context: ToolContext): Promise<ToolOutput>;
};

export type ToolContext = {
  workspaceRoot: string;
  logRoot?: string;
  changedFiles: string[];
  todos: TodoItem[];
  abortSignal?: AbortSignal;
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
export type WriteInput = { path: string; content: string };
export type EditInput = { path: string; oldText: string; newText: string };
export type MultiEditInput = { path: string; edits: { oldText: string; newText: string }[] };
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
const BASH_PREVIEW_LIMIT = 4_000;
const BASH_TIMEOUT_MS = 120_000;

export function createToolContext(workspaceRoot = process.cwd()): ToolContext {
  return {
    workspaceRoot: resolve(workspaceRoot),
    changedFiles: [],
    todos: [],
  };
}

export async function runTool(
  name: ToolName,
  input: unknown,
  context: ToolContext,
): Promise<ToolRunResult> {
  const tool = builtInTools[name];
  if (!tool) {
    throw new Error(`未知工具：${name}`);
  }

  const output = await tool.call(input as never, context);
  return {
    id: randomUUID(),
    name,
    input,
    output,
  };
}

export const builtInTools: Record<ToolName, ToolDefinition<never>> = {
  Read: {
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
    call: readTool as ToolDefinition<never>["call"],
  },
  Write: {
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
    call: writeTool as ToolDefinition<never>["call"],
  },
  Edit: {
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
    call: editTool as ToolDefinition<never>["call"],
  },
  MultiEdit: {
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
    call: multiEditTool as ToolDefinition<never>["call"],
  },
  Grep: {
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
    call: grepTool as ToolDefinition<never>["call"],
  },
  Glob: {
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
    call: globTool as ToolDefinition<never>["call"],
  },
  Bash: {
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
    call: bashTool as ToolDefinition<never>["call"],
  },
  Todo: {
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
    call: todoTool as ToolDefinition<never>["call"],
  },
  Diff: {
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
    call: diffTool as ToolDefinition<never>["call"],
  },
};

async function readTool(input: ReadInput, context: ToolContext): Promise<ToolOutput> {
  const filePath = resolveWorkspacePath(context.workspaceRoot, input.path);
  const content = await readFile(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  const offset = Math.max(input.offset ?? 0, 0);
  const limit = Math.max(input.limit ?? DEFAULT_LIMIT, 1);
  const selected = lines.slice(offset, offset + limit);
  const text = selected.map((line, index) => `${offset + index + 1}\t${line}`).join("\n");
  return {
    text,
    data: { path: relativePath(context.workspaceRoot, filePath), lines: selected.length },
    truncated: offset + limit < lines.length,
  };
}

async function writeTool(input: WriteInput, context: ToolContext): Promise<ToolOutput> {
  const filePath = resolveWorkspacePath(context.workspaceRoot, input.path);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, input.content, "utf8");
  recordChangedFile(context, filePath);
  return {
    text: `已写入文件：${relativePath(context.workspaceRoot, filePath)}`,
    changedFiles: [relativePath(context.workspaceRoot, filePath)],
  };
}

async function editTool(input: EditInput, context: ToolContext): Promise<ToolOutput> {
  const filePath = resolveWorkspacePath(context.workspaceRoot, input.path);
  const content = await readFile(filePath, "utf8");
  ensureUnique(content, input.oldText);
  const next = content.replace(input.oldText, input.newText);
  await writeFile(filePath, next, "utf8");
  recordChangedFile(context, filePath);
  return {
    text: `已编辑文件：${relativePath(context.workspaceRoot, filePath)}`,
    changedFiles: [relativePath(context.workspaceRoot, filePath)],
  };
}

async function multiEditTool(input: MultiEditInput, context: ToolContext): Promise<ToolOutput> {
  const filePath = resolveWorkspacePath(context.workspaceRoot, input.path);
  if (!Array.isArray(input.edits) || input.edits.length === 0) {
    throw new Error("MultiEdit 需要至少 1 个 edits 项。建议：传入 edits=[{oldText,newText}]。");
  }

  let content = await readFile(filePath, "utf8");
  for (const [index, edit] of input.edits.entries()) {
    try {
      ensureUnique(content, edit.oldText);
    } catch (error) {
      const message = error instanceof Error ? error.message : "唯一性检查失败。";
      throw new Error(`第 ${index + 1} 个编辑失败：${message}`);
    }
    content = content.replace(edit.oldText, edit.newText);
  }

  await writeFile(filePath, content, "utf8");
  recordChangedFile(context, filePath);
  return {
    text: `已批量编辑文件：${relativePath(context.workspaceRoot, filePath)}，共 ${input.edits.length} 项。`,
    changedFiles: [relativePath(context.workspaceRoot, filePath)],
  };
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
  );
  const fullText = `$ ${input.command}\nexitCode=${result.exitCode}\n\n${result.output}`;
  await writeFile(fullOutputPath, fullText, "utf8");
  const truncated = fullText.length > BASH_PREVIEW_LIMIT;
  const preview = truncated
    ? `${fullText.slice(0, BASH_PREVIEW_LIMIT)}\n...（输出已截断，完整日志见 fullOutputPath）`
    : fullText;
  return {
    text: preview,
    data: { exitCode: result.exitCode },
    truncated,
    fullOutputPath,
  };
}

async function todoTool(input: TodoInput, context: ToolContext): Promise<ToolOutput> {
  if (input.action === "add") {
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
  const riskyFiles = changedFiles.filter(
    (file) => file.includes(".env") || file.startsWith(".git/"),
  );
  const summary: DiffSummary = {
    changedFiles,
    addedLines: 0,
    removedLines: 0,
    summary:
      changedFiles.length === 0
        ? "本轮暂无工具写入改动。"
        : `本轮工具改动 ${changedFiles.length} 个文件。`,
    riskyFiles,
  };
  return {
    text: `${summary.summary}\n${changedFiles.map((file) => `- ${file}`).join("\n")}`.trim(),
    data: summary,
  };
}

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
): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, { cwd, shell: true, windowsHide: true });
    let output = "";
    let settled = false;
    const finish = (exitCode: number, nextOutput = output) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolvePromise({ exitCode, output: nextOutput });
    };
    const onAbort = () => {
      child.kill();
      output += "\n工具调用已取消。";
      finish(1);
    };
    const timer = setTimeout(() => {
      child.kill();
      output += `\n命令超时：超过 ${timeoutMs}ms，已尝试终止。`;
    }, timeoutMs);
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
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
