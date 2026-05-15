import { randomUUID } from "node:crypto";
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
import { LINGHUN_NAME } from "@linghun/shared";

export type TuiStatus = "ready";

export const tuiStatus: TuiStatus = "ready";

export type RunTuiOptions = {
  stdin?: Readable;
  stdout?: Writable;
  stderr?: Writable;
  projectPath?: string;
};

export type TuiContext = {
  store: SessionStore;
  sessionId?: string;
  sessionEnded?: boolean;
  model: string;
  permissionMode: string;
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
  };
  const gateway = new ModelGateway([
    new DeepSeekProvider({
      ...config.providers.deepseek,
      id: "deepseek",
      displayName: "DeepSeek",
    }),
  ]);

  writeLine(output, `${LINGHUN_NAME} Phase 04 TUI / REPL`);
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
  if (command === "/exit") {
    return "exit";
  }

  writeLine(output, `未知命令：${command}。输入 /help 查看可用命令。`);
  return "handled";
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
        "你是 Linghun Phase 04 的工程型中文助手。回答要简洁、明确；不要声称具备尚未实现的工具能力。",
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
  /exit                 退出

普通输入会发送给当前 provider/model，并写入 JSONL transcript。`;
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
    `状态栏：session ${context.sessionId ?? "未创建"} · model ${context.model} · mode ${context.permissionMode} · cache -- · ¥-- · index --`,
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
