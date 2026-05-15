import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import {
  stderr as defaultStderr,
  stdin as defaultStdin,
  stdout as defaultStdout,
} from "node:process";
import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";
import { getSessionRootDir, loadConfig } from "@linghun/config";
import { SessionStore, type TranscriptEvent } from "@linghun/core";
import { DeepSeekProvider, ModelGateway, type ModelMessage } from "@linghun/providers";
import { LINGHUN_NAME, type PermissionMode } from "@linghun/shared";
import {
  type DiffSummary,
  type TodoItem,
  type ToolContext,
  type ToolName,
  type ToolOutput,
  builtInTools,
  createToolContext,
  runTool,
} from "@linghun/tools";

export type TuiStatus = "ready";

export const tuiStatus: TuiStatus = "ready";

export type RunTuiOptions = {
  stdin?: Readable;
  stdout?: Writable;
  stderr?: Writable;
  projectPath?: string;
};

export type PermissionRule = {
  id: string;
  effect: "allow" | "ask" | "deny";
  toolName: ToolName | "*";
  risk?: "low" | "medium" | "high";
};

export type RecentPermissionRejection = {
  id: string;
  toolName: ToolName;
  mode: PermissionMode;
  reason: string;
  createdAt: string;
};

export type PermissionState = {
  rules: PermissionRule[];
  recentDenied: RecentPermissionRejection[];
};

export type PlanProposal = {
  id: string;
  title: string;
  options: { id: string; title: string; steps: string[]; risks: string[] }[];
};

export type TuiContext = {
  store: SessionStore;
  sessionId?: string;
  sessionEnded?: boolean;
  model: string;
  permissionMode: PermissionMode;
  projectPath: string;
  tools: ToolContext;
  permissions: PermissionState;
  activePlan?: PlanProposal;
  planAccepted?: boolean;
};

export async function runTui(options: RunTuiOptions = {}): Promise<number> {
  const input = options.stdin ?? defaultStdin;
  const output = options.stdout ?? defaultStdout;
  const errorOutput = options.stderr ?? defaultStderr;
  const projectPath = options.projectPath ?? process.cwd();
  const config = await loadConfig(projectPath);
  const store = new SessionStore({ sessionRootDir: getSessionRootDir(), projectPath });
  const context: TuiContext = {
    store,
    model: config.providers.deepseek.model,
    permissionMode: config.permission.defaultMode,
    projectPath,
    tools: createToolContext(projectPath),
    permissions: await loadPermissionState(projectPath),
  };
  const gateway = new ModelGateway([
    new DeepSeekProvider({
      ...config.providers.deepseek,
      id: "deepseek",
      displayName: "DeepSeek",
    }),
  ]);

  writeLine(output, `${LINGHUN_NAME} Phase 06 TUI / REPL`);
  writeStatus(output, context);
  writeLine(output, "输入普通消息开始对话；输入 /help 查看命令；输入 /exit 退出。\n");

  try {
    for await (const line of readInputLines(input, output)) {
      const text = line.trim();
      if (!text) {
        continue;
      }

      const commandResult = await handleSlashCommand(text, context, output);
      if (commandResult === "exit") {
        if (context.sessionId && !context.sessionEnded) {
          await store.appendEvent(context.sessionId, createSessionEndEvent(context.sessionId));
          context.sessionEnded = true;
        }
        writeLine(output, "已退出 Linghun。");
        return 0;
      }
      if (commandResult === "message") {
        await sendMessage(text, context, gateway, output);
      }
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "TUI 运行失败。";
    writeLine(errorOutput, `错误：${message}`);
    return 1;
  }
}

export async function handleSlashCommand(
  text: string,
  context: TuiContext,
  output: Writable,
): Promise<"handled" | "exit" | "message"> {
  if (!text.startsWith("/")) {
    return "message";
  }

  const [command, ...rest] = text.split(/\s+/);
  if (command === "/help") {
    writeLine(output, formatHelp());
    return "handled";
  }
  if (command === "/model") {
    writeLine(output, `当前模型：${context.model}`);
    writeStatus(output, context);
    return "handled";
  }
  if (command === "/mode") {
    await handleModeCommand(rest, context, output);
    return "handled";
  }
  if (command === "/plan") {
    await handlePlanCommand(rest, context, output);
    return "handled";
  }
  if (command === "/permissions") {
    await handlePermissionsCommand(rest, context, output);
    return "handled";
  }
  if (command === "/tab") {
    await cycleMode(context, output);
    return "handled";
  }
  if (command === "/sessions") {
    if (rest[0] === "resume") {
      const sessionId = rest[1];
      if (!sessionId) {
        writeLine(output, "用法：/sessions resume <id>");
        return "handled";
      }
      try {
        const resumed = await context.store.resume(sessionId);
        context.sessionId = resumed.session.id;
        context.sessionEnded = isSessionEnded(resumed.transcript);
        context.model = resumed.session.model;
        writeLine(output, `已恢复会话：${resumed.session.id}`);
        writeLine(output, `消息数：${resumed.transcript.length}`);
        writeStatus(output, context);
      } catch (error) {
        writeLine(output, formatError(error));
      }
      return "handled";
    }

    const sessions = await context.store.list();
    if (sessions.length === 0) {
      writeLine(output, "当前项目还没有会话。");
      return "handled";
    }
    writeLine(output, "会话ID  更新时间  摘要");
    for (const session of sessions) {
      const marker = session.id === context.sessionId ? "*" : " ";
      writeLine(
        output,
        `${marker} ${session.id}  ${session.updatedAt}  ${session.summary ?? "（无摘要）"}`,
      );
    }
    return "handled";
  }
  const toolName = slashCommandToTool(command);
  if (toolName) {
    await handleToolCommand(toolName, rest, context, output);
    return "handled";
  }
  if (command === "/exit") {
    return "exit";
  }

  writeLine(output, `未知命令：${command}。输入 /help 查看可用命令。`);
  return "handled";
}

async function handleModeCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const nextMode = args[0] as PermissionMode | undefined;
  if (!nextMode) {
    writeLine(output, `当前权限模式：${context.permissionMode}`);
    writeLine(output, "可选：default / plan / acceptEdits / dontAsk / auto / bypass");
    return;
  }
  if (!isPermissionMode(nextMode)) {
    writeLine(output, "未知模式。可选：default / plan / acceptEdits / dontAsk / auto / bypass");
    return;
  }
  if (context.permissionMode === "plan" && nextMode === "bypass" && !context.planAccepted) {
    writeLine(
      output,
      "Plan 模式不能直接切到 bypass 执行写入。请先运行 /plan accept <方案> 确认计划，或切回 default。 ",
    );
    return;
  }
  context.permissionMode = nextMode;
  context.planAccepted = false;
  writeLine(output, `已切换权限模式：${nextMode}`);
  if (nextMode === "plan") {
    writeLine(
      output,
      "Plan 模式只允许 Read / Grep / Glob / Diff / Todo 等只读或会话内操作。确认方案后再执行写入。",
    );
  }
  writeStatus(output, context);
}

function cycleMode(context: TuiContext, output: Writable): void {
  const modes: PermissionMode[] = ["default", "plan", "acceptEdits", "auto"];
  const index = modes.indexOf(context.permissionMode);
  context.permissionMode = modes[(index + 1) % modes.length] ?? "default";
  context.planAccepted = false;
  writeLine(output, `已切换模式：${context.permissionMode}（/tab 等价 Shift+Tab）`);
  writeStatus(output, context);
}

async function handlePlanCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const action = args[0];
  if (action === "accept") {
    if (!context.activePlan) {
      writeLine(output, "当前没有待确认计划。先运行 /plan 生成结构化方案。");
      return;
    }
    const optionId = args[1] ?? context.activePlan.options[0]?.id ?? "a";
    context.planAccepted = true;
    context.permissionMode = "default";
    const sessionId = await ensureSession(context);
    await context.store.appendEvent(sessionId, {
      type: "plan_decision",
      proposalId: context.activePlan.id,
      optionId,
      decision: "accepted",
      createdAt: new Date().toISOString(),
    });
    writeLine(
      output,
      `已确认计划 ${context.activePlan.id} / 方案 ${optionId}，已回到 default 模式，可以执行允许的写入路径。`,
    );
    writeStatus(output, context);
    return;
  }

  const proposal: PlanProposal = {
    id: randomUUID(),
    title: "Phase 06 执行前计划",
    options: [
      {
        id: "a",
        title: "最小权限闭环（推荐）",
        steps: [
          "先用 Read/Grep/Glob/Diff 收集证据",
          "确认写入文件和风险摘要",
          "执行工作区内允许的低/中风险改动",
          "运行最小必要验证",
        ],
        risks: ["需要写入时必须离开 plan 或确认计划", "Bash 不会在 acceptEdits 中自动放行"],
      },
      {
        id: "b",
        title: "只读审查",
        steps: ["保持 plan 模式", "只运行 Read/Grep/Glob/Diff/Todo", "输出建议，不写文件"],
        risks: ["不会完成需要落盘的代码改动"],
      },
    ],
  };
  context.activePlan = proposal;
  context.permissionMode = "plan";
  context.planAccepted = false;
  const sessionId = await ensureSession(context);
  await context.store.appendEvent(sessionId, {
    type: "plan_proposal",
    proposal,
    createdAt: new Date().toISOString(),
  });
  writeLine(output, formatPlanProposal(proposal));
  writeLine(output, "确认执行请运行：/plan accept a；继续只读请保持 /mode plan。 ");
  writeStatus(output, context);
}

async function handlePermissionsCommand(
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  const [action, ...rest] = args;
  if (!action) {
    writeLine(output, formatPermissionRules(context.permissions));
    return;
  }
  if (action === "recent") {
    if (rest[0] === "clear") {
      context.permissions.recentDenied = [];
      await savePermissionState(context.projectPath, context.permissions);
      writeLine(output, "已清空最近拒绝记录。");
      return;
    }
    if (rest[0] === "delete" || rest[0] === "remove") {
      const id = rest[1];
      if (!id) {
        writeLine(output, "用法：/permissions recent delete <id>");
        return;
      }
      const before = context.permissions.recentDenied.length;
      context.permissions.recentDenied = context.permissions.recentDenied.filter(
        (item) => item.id !== id,
      );
      await savePermissionState(context.projectPath, context.permissions);
      writeLine(
        output,
        before === context.permissions.recentDenied.length
          ? `未找到最近拒绝：${id}`
          : `已删除最近拒绝：${id}`,
      );
      return;
    }
    writeLine(output, formatRecentDenied(context.permissions));
    return;
  }
  if (action === "add") {
    const effect = rest[0] as PermissionRule["effect"] | undefined;
    const toolName = rest[1] as ToolName | "*" | undefined;
    const risk = rest[2] as PermissionRule["risk"] | undefined;
    if (!effect || !["allow", "ask", "deny"].includes(effect) || !toolName) {
      writeLine(output, "用法：/permissions add allow|ask|deny <tool|*> [low|medium|high]");
      return;
    }
    if (toolName !== "*" && !(toolName in builtInTools)) {
      writeLine(output, `未知工具：${toolName}`);
      return;
    }
    const rule: PermissionRule = { id: randomUUID(), effect, toolName, risk };
    context.permissions.rules.push(rule);
    await savePermissionState(context.projectPath, context.permissions);
    writeLine(output, `已添加权限规则：${rule.id} ${effect} ${toolName}${risk ? ` ${risk}` : ""}`);
    return;
  }
  if (action === "remove") {
    const id = rest[0];
    if (!id) {
      writeLine(output, "用法：/permissions remove <id>");
      return;
    }
    const before = context.permissions.rules.length;
    context.permissions.rules = context.permissions.rules.filter((rule) => rule.id !== id);
    await savePermissionState(context.projectPath, context.permissions);
    writeLine(
      output,
      before === context.permissions.rules.length ? `未找到规则：${id}` : `已删除规则：${id}`,
    );
    return;
  }
  writeLine(
    output,
    "用法：/permissions | /permissions add | /permissions remove | /permissions recent",
  );
}

async function sendMessage(
  text: string,
  context: TuiContext,
  gateway: ModelGateway,
  output: Writable,
): Promise<void> {
  const sessionId = await ensureSession(context);
  context.sessionEnded = false;
  await context.store.appendEvent(sessionId, createUserMessageEvent(text));
  writeLine(output, "状态：正在请求模型...");

  const assistantEventId = randomUUID();
  let assistantText = "";
  const controller = new AbortController();
  const messages: ModelMessage[] = [
    {
      role: "system",
      content:
        "你是 Linghun Phase 06 的工程型中文助手。回答要简洁、明确；只能声称具备当前阶段已实现的核心工具、权限与 Plan 能力。",
    },
    { role: "user", content: text },
  ];

  for await (const event of gateway.stream(
    "deepseek",
    { messages, model: context.model },
    controller.signal,
  )) {
    if (event.type === "assistant_text_delta") {
      assistantText += event.text;
      output.write(event.text);
      continue;
    }
    if (event.type === "error") {
      writeLine(output, formatError(event.error));
      return;
    }
  }

  if (assistantText) {
    output.write("\n");
    await context.store.appendEvent(sessionId, {
      type: "assistant_text_delta",
      id: assistantEventId,
      text: assistantText,
      createdAt: new Date().toISOString(),
    });
  }
  writeStatus(output, context);
}

async function* readInputLines(input: Readable, output: Writable): AsyncGenerator<string> {
  if ((input as { isTTY?: boolean }).isTTY !== true) {
    const chunks: Buffer[] = [];
    for await (const chunk of input) {
      chunks.push(toInputBuffer(chunk));
    }
    const text = decodeInput(Buffer.concat(chunks));
    for (const line of text.split(/\r?\n/)) {
      yield line;
    }
    return;
  }

  if ("setEncoding" in input && typeof input.setEncoding === "function") {
    input.setEncoding("utf8");
  }

  const rl = createInterface({ input, output });
  try {
    output.write("你> ");
    for await (const line of rl) {
      yield line;
      output.write("你> ");
    }
  } finally {
    rl.close();
  }
}

function toInputBuffer(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) {
    return chunk;
  }
  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk);
  }
  return Buffer.from(String(chunk), "utf8");
}

function decodeInput(bytes: Buffer): string {
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (!utf8.includes("�")) {
    return utf8;
  }
  return new TextDecoder("gb18030", { fatal: false }).decode(bytes);
}

function formatHelp(): string {
  return `可用命令：
  /help                 显示帮助
  /model                显示当前模型
  /sessions             列出当前项目会话
  /sessions resume <id> 恢复历史会话
  /mode                 查看权限模式
  /mode plan|acceptEdits|dontAsk|auto|bypass|default  切换模式
  /tab                  等价 Shift+Tab：循环切换常用模式
  /plan                 输出结构化可选方案
  /plan accept [id]     确认方案并回到 default 执行
  /permissions          查看权限规则
  /permissions add allow|ask|deny <tool|*> [risk]  添加规则
  /permissions remove <id> 删除规则
  /permissions recent   查看最近拒绝
  /permissions recent delete <id> 删除单条最近拒绝
  /permissions recent clear  清空最近拒绝
  /read <path>          读取文件
  /write <path> <text>  写入文件
  /edit <path> <old> => <new>  唯一替换
  /multiedit <path> <old> => <new>  批量编辑的最小入口
  /grep <pattern> [path] 搜索文本
  /glob <pattern> [path] 匹配文件
  /bash <command>       执行命令并保存完整日志
  /todo                 查看任务
  /todo add <text>      添加任务
  /todo start|done|block <id> 更新任务状态
  /diff                 显示本轮工具改动摘要
  /exit                 退出

普通输入会发送给当前 provider/model，并写入 JSONL transcript。工具命令也会写入 transcript。`;
}

function slashCommandToTool(command: string): ToolName | null {
  const mapping: Record<string, ToolName> = {
    "/read": "Read",
    "/write": "Write",
    "/edit": "Edit",
    "/multiedit": "MultiEdit",
    "/grep": "Grep",
    "/glob": "Glob",
    "/bash": "Bash",
    "/todo": "Todo",
    "/diff": "Diff",
  };
  return mapping[command] ?? null;
}

async function handleToolCommand(
  name: ToolName,
  args: string[],
  context: TuiContext,
  output: Writable,
): Promise<void> {
  try {
    const input = parseToolInput(name, args);
    const sessionId = await ensureSession(context);
    const permission = await decidePermission(name, input, context, sessionId);
    await context.store.appendEvent(sessionId, {
      type: "permission_request",
      request: permission.request,
      createdAt: new Date().toISOString(),
    });
    await context.store.appendEvent(sessionId, {
      type: "permission_result",
      requestId: permission.request.id,
      decision: permission.decision,
      reason: permission.reason,
      createdAt: new Date().toISOString(),
    });

    if (permission.decision !== "allow") {
      writeLine(output, formatPermissionDenied(permission.reason, permission.request.summary));
      writeStatus(output, context);
      return;
    }

    if (permission.preflight) {
      writeLine(output, permission.preflight);
    }

    const callId = randomUUID();
    await context.store.appendEvent(sessionId, {
      type: "tool_call_start",
      id: callId,
      name,
      input,
      createdAt: new Date().toISOString(),
    });
    const result = await runTool(name, input, context.tools);
    await context.store.appendEvent(sessionId, createToolEndEvent(callId, result.output));
    await appendDerivedToolEvents(context, sessionId, name, result.output);
    writeLine(output, formatToolOutput(name, result.output));
    writeStatus(output, context);
  } catch (error) {
    writeLine(output, formatError(error));
  }
}

function parseToolInput(name: ToolName, args: string[]): unknown {
  if (name === "Read") {
    return { path: requireArg(args[0], "用法：/read <path>") };
  }
  if (name === "Write") {
    return {
      path: requireArg(args[0], "用法：/write <path> <text>"),
      content: args.slice(1).join(" "),
    };
  }
  if (name === "Edit" || name === "MultiEdit") {
    const path = requireArg(args[0], `用法：/${name.toLowerCase()} <path> <old> => <new>`);
    const expression = args.slice(1).join(" ");
    const separator = expression.indexOf("=>");
    if (separator < 0) {
      throw new Error(`用法：/${name.toLowerCase()} <path> <old> => <new>`);
    }
    const oldText = expression.slice(0, separator).trim();
    const newText = expression.slice(separator + 2).trim();
    if (name === "MultiEdit") {
      return { path, edits: [{ oldText, newText }] };
    }
    return { path, oldText, newText };
  }
  if (name === "Grep") {
    return { pattern: requireArg(args[0], "用法：/grep <pattern> [path]"), path: args[1] };
  }
  if (name === "Glob") {
    return { pattern: requireArg(args[0], "用法：/glob <pattern> [path]"), path: args[1] };
  }
  if (name === "Bash") {
    return { command: requireArg(args.join(" ").trim(), "用法：/bash <command>") };
  }
  if (name === "Todo") {
    const action = args[0];
    if (!action) {
      return { action: "list" };
    }
    if (action === "add") {
      return {
        action,
        content: requireArg(args.slice(1).join(" ").trim(), "用法：/todo add <text>"),
      };
    }
    if (action === "start" || action === "done" || action === "block") {
      return { action, id: requireArg(args[1], `用法：/todo ${action} <id>`) };
    }
    throw new Error("用法：/todo 或 /todo add|start|done|block ...");
  }
  return {};
}

function requireArg(value: string | undefined, usage: string): string {
  if (!value) {
    throw new Error(usage);
  }
  return value;
}

type PermissionCheck = {
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
};

async function decidePermission(
  name: ToolName,
  input: unknown,
  context: TuiContext,
  sessionId: string,
): Promise<PermissionCheck> {
  const tool = builtInTools[name];
  const files = collectInputFiles(input);
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

  const rule = findPermissionRule(context.permissions.rules, name, tool.permission.risk);
  if (rule) {
    if (rule.effect === "deny") {
      const reason = `命中 deny 规则：${rule.id}`;
      await recordPermissionDenied(context, name, reason);
      return { request, decision: "deny", reason };
    }
    if (rule.effect === "ask") {
      const reason = `命中 ask 规则：${rule.id}。当前最小 REPL 没有交互式审批选择，因此本次不会自动执行。`;
      await recordPermissionDenied(context, name, reason);
      return { request, decision: "ask", reason };
    }
    return { request, decision: "allow", reason: `命中 allow 规则：${rule.id}` };
  }

  if (context.permissionMode === "plan") {
    if (isPlanAllowedTool(name, tool.isReadOnly)) {
      return { request, decision: "allow", reason: "Plan 模式允许只读或会话内规划工具。" };
    }
    const reason =
      "Plan 模式禁止写入、编辑和 Bash 执行；请先 /plan accept 确认方案并切回执行模式。";
    await recordPermissionDenied(context, name, reason);
    return { request, decision: "deny", reason };
  }

  if (context.permissionMode === "dontAsk") {
    if (tool.isReadOnly || name === "Todo" || name === "Diff") {
      return { request, decision: "allow", reason: "dontAsk 模式允许只读或会话内工具。" };
    }
    const reason = "dontAsk 模式无法询问用户，需审批的操作自动拒绝，不会自动允许。";
    await recordPermissionDenied(context, name, reason);
    return { request, decision: "deny", reason };
  }

  if (context.permissionMode === "acceptEdits") {
    if (isLowRiskWorkspaceEdit(name, tool.permission.risk, files)) {
      return {
        request,
        decision: "allow",
        reason: "acceptEdits 自动允许工作区内低风险文件编辑。",
        preflight: formatDiffBeforeWrite(name, files, tool.permission.risk),
      };
    }
    if (tool.isReadOnly || name === "Todo" || name === "Diff") {
      return { request, decision: "allow", reason: "acceptEdits 允许只读或会话内工具。" };
    }
    const reason = "acceptEdits 不自动允许 Bash、高风险或越界操作。";
    await recordPermissionDenied(context, name, reason);
    return { request, decision: "deny", reason };
  }

  if (context.permissionMode === "bypass") {
    return {
      request,
      decision: "allow",
      reason: "bypass 已由用户显式开启，但硬拒绝和安全路径仍生效。",
      preflight: tool.isReadOnly
        ? undefined
        : formatDiffBeforeWrite(name, files, tool.permission.risk),
    };
  }

  if (context.permissionMode === "auto") {
    if (tool.isReadOnly || name === "Todo" || name === "Diff") {
      return { request, decision: "allow", reason: "auto 分类为低风险只读/会话内工具。" };
    }
    const reason = "auto 分类器不可用，需审批操作回退为拒绝，避免默认放行。";
    await recordPermissionDenied(context, name, reason);
    return { request, decision: "deny", reason };
  }

  if (tool.isReadOnly || name === "Todo" || name === "Diff") {
    return { request, decision: "allow", reason: "default 模式允许只读或会话内工具。" };
  }
  return {
    request,
    decision: "allow",
    reason: "default 模式展示风险摘要后允许本次工作区操作。",
    preflight: formatDiffBeforeWrite(name, files, tool.permission.risk),
  };
}

function isPlanAllowedTool(name: ToolName, isReadOnly: boolean): boolean {
  return isReadOnly || name === "Todo";
}

function isLowRiskWorkspaceEdit(
  name: ToolName,
  risk: "low" | "medium" | "high",
  files: string[],
): boolean {
  return (
    (name === "Write" || name === "Edit" || name === "MultiEdit") &&
    risk === "low" &&
    files.length > 0
  );
}

function collectInputFiles(input: unknown): string[] {
  if (typeof input !== "object" || input === null || !("path" in input)) {
    return [];
  }
  const path = (input as { path?: unknown }).path;
  return typeof path === "string" ? [path.replaceAll("\\", "/")] : [];
}

function getHardDenyReason(
  name: ToolName,
  input: unknown,
  files: string[],
  workspaceRoot: string,
): string | null {
  for (const file of files) {
    const target = resolve(workspaceRoot, file);
    const rel = relative(resolve(workspaceRoot), target);
    if (rel.startsWith("..") || (rel === "" && !builtInTools[name].isReadOnly)) {
      return `路径越界或指向工作区根：${file}。只允许操作当前工作区内明确文件。`;
    }
    const normalized = rel.replaceAll("\\", "/");
    if (normalized.startsWith(".git/") || normalized.includes("/.git/")) {
      return "安全保护：禁止修改 .git 目录。";
    }
    if (
      normalized.includes(".ssh/") ||
      normalized.endsWith(".env") ||
      normalized.includes("secret")
    ) {
      return "安全保护：疑似密钥或敏感路径，需要更高阶段的安全流程处理。";
    }
  }
  if (name === "Bash") {
    const command =
      typeof input === "object" && input !== null ? (input as { command?: unknown }).command : "";
    if (typeof command !== "string" || !command.trim()) {
      return "Bash 命令不能为空。";
    }
    if (
      /(rm\s+-rf|curl\s+[^|]+\|\s*(sh|bash)|wget\s+[^|]+\|\s*(sh|bash)|mkfs|shutdown|reboot)/i.test(
        command,
      )
    ) {
      return "安全保护：拒绝高风险删除、远程脚本执行或系统级命令。";
    }
  }
  return null;
}

function findPermissionRule(
  rules: PermissionRule[],
  name: ToolName,
  risk: "low" | "medium" | "high",
): PermissionRule | undefined {
  return rules.find(
    (rule) =>
      (rule.toolName === "*" || rule.toolName === name) && (!rule.risk || rule.risk === risk),
  );
}

async function recordPermissionDenied(
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

function formatPermissionSummary(
  name: ToolName,
  files: string[],
  risk: "low" | "medium" | "high",
): string {
  const targets = files.length === 0 ? "无文件路径" : files.join(", ");
  return `工具 ${name}；目标：${targets}；风险：${risk}`;
}

function formatDiffBeforeWrite(
  name: ToolName,
  files: string[],
  risk: "low" | "medium" | "high",
): string {
  const fileText = files.length === 0 ? "未声明文件" : files.join(", ");
  return `写入前摘要：将执行 ${name}\n将影响文件：${fileText}\n风险：${risk}\n原因：工作区内工具操作；本阶段展示轻量摘要，不生成完整 git hunk。`;
}

function formatPermissionDenied(reason: string, summary: string): string {
  return `权限已拒绝：${reason}\n本次请求：${summary}\n建议：查看 /permissions recent，或切换合适模式后重试。`;
}

function isPermissionMode(value: string): value is PermissionMode {
  return ["default", "plan", "acceptEdits", "dontAsk", "auto", "bypass"].includes(value);
}

async function loadPermissionState(projectPath: string): Promise<PermissionState> {
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

async function savePermissionState(projectPath: string, state: PermissionState): Promise<void> {
  await mkdir(join(projectPath, ".linghun"), { recursive: true });
  await writeFile(permissionStatePath(projectPath), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function permissionStatePath(projectPath: string): string {
  return join(projectPath, ".linghun", "permissions.json");
}

function formatPermissionRules(state: PermissionState): string {
  if (state.rules.length === 0) {
    return "当前没有持久化权限规则。可用 /permissions add allow|ask|deny <tool|*> [risk] 添加。";
  }
  return state.rules
    .map(
      (rule) => `${rule.id}  ${rule.effect}  ${rule.toolName}${rule.risk ? `  ${rule.risk}` : ""}`,
    )
    .join("\n");
}

function formatRecentDenied(state: PermissionState): string {
  if (state.recentDenied.length === 0) {
    return "最近没有拒绝记录。";
  }
  return state.recentDenied
    .map((item) => `${item.createdAt}  ${item.toolName}  ${item.mode}  ${item.reason}`)
    .join("\n");
}

function formatPlanProposal(proposal: PlanProposal): string {
  const lines = [`PlanProposal ${proposal.id}：${proposal.title}`];
  for (const option of proposal.options) {
    lines.push(`方案 ${option.id}：${option.title}`);
    lines.push(...option.steps.map((step, index) => `  ${index + 1}. ${step}`));
    lines.push(...option.risks.map((risk) => `  风险：${risk}`));
  }
  return lines.join("\n");
}

function createToolEndEvent(id: string, output: ToolOutput): TranscriptEvent {
  return {
    type: "tool_call_end",
    id,
    output,
    createdAt: new Date().toISOString(),
  };
}

async function appendDerivedToolEvents(
  context: TuiContext,
  sessionId: string,
  name: ToolName,
  output: ToolOutput,
): Promise<void> {
  if (name === "Todo") {
    await context.store.appendEvent(sessionId, {
      type: "todo_update",
      items: context.tools.todos as TodoItem[],
      createdAt: new Date().toISOString(),
    });
  }
  if (name === "Diff" && isDiffSummary(output.data)) {
    await context.store.appendEvent(sessionId, {
      type: "diff_update",
      summary: output.data,
      createdAt: new Date().toISOString(),
    });
  }
}

function isDiffSummary(value: unknown): value is DiffSummary {
  return typeof value === "object" && value !== null && "changedFiles" in value;
}

function formatToolOutput(name: ToolName, output: ToolOutput): string {
  const lines = [`工具 ${name} 结果：`, output.text];
  if (output.truncated && output.fullOutputPath) {
    lines.push(`完整日志：${output.fullOutputPath}`);
  }
  return lines.join("\n");
}

async function ensureSession(context: TuiContext): Promise<string> {
  if (context.sessionId) {
    return context.sessionId;
  }

  const session = await context.store.create({ model: context.model });
  context.sessionId = session.id;
  context.sessionEnded = false;
  return session.id;
}

function isSessionEnded(transcript: TranscriptEvent[]): boolean {
  return transcript.at(-1)?.type === "session_end";
}

function writeStatus(output: Writable, context: TuiContext): void {
  writeLine(
    output,
    `状态栏：session ${context.sessionId ?? "未创建"} · model ${context.model} · mode ${context.permissionMode} · cache -- · index --`,
  );
}

function createUserMessageEvent(text: string): TranscriptEvent {
  return {
    type: "user_message",
    id: randomUUID(),
    text,
    createdAt: new Date().toISOString(),
  };
}

function createSessionEndEvent(sessionId: string): TranscriptEvent {
  return {
    type: "session_end",
    sessionId,
    createdAt: new Date().toISOString(),
  };
}

function formatError(error: unknown): string {
  if (error instanceof Error && "suggestion" in error && typeof error.suggestion === "string") {
    return `错误：${error.message}\n建议：${error.suggestion}`;
  }
  if (error instanceof Error) {
    return `错误：${error.message}`;
  }
  return "错误：未知错误。";
}

function writeLine(output: Writable, text: string): void {
  output.write(`${text}\n`);
}
