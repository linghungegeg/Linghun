import { randomUUID } from "node:crypto";
import type { TranscriptEvent } from "@linghun/core";
import { LINGHUN_CLI_NAME, LINGHUN_NAME, LINGHUN_VERSION } from "@linghun/shared";

export const helpText = `${LINGHUN_NAME} ${LINGHUN_VERSION}

用法：
  ${LINGHUN_CLI_NAME} --version                         显示版本号
  ${LINGHUN_CLI_NAME} --help                            显示帮助信息
  ${LINGHUN_CLI_NAME} sessions list [--json]            列出当前项目会话
  ${LINGHUN_CLI_NAME} sessions create [--message 文本]  新建会话，可写入一条用户消息
  ${LINGHUN_CLI_NAME} sessions append <id> --message 文本  追加一条用户消息
  ${LINGHUN_CLI_NAME} sessions resume <id> [--json]     恢复并读取会话 transcript
  ${LINGHUN_CLI_NAME} sessions summary <id> [--text 文本]  查看或更新会话摘要

Slash 兼容：
  ${LINGHUN_CLI_NAME} /sessions
  ${LINGHUN_CLI_NAME} /sessions resume <id>
  ${LINGHUN_CLI_NAME} /sessions summary <id>

说明：
  Phase 02 提供 Session 与 JSONL transcript 闭环。
  当前命令不会加载模型、MCP 或 TUI。

Windows 兼容：
  Linghun --version 与 linghun --version 行为一致。`;

export type CliResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export async function runCli(argv: string[]): Promise<CliResult> {
  const [command] = argv;

  if (!command || command === "--help" || command === "-h") {
    return { stdout: `${helpText}\n`, stderr: "", exitCode: 0 };
  }

  if (command === "--version" || command === "-v") {
    return { stdout: `${LINGHUN_VERSION}\n`, stderr: "", exitCode: 0 };
  }

  const normalized = normalizeSlashCommand(argv);
  if (normalized[0] === "sessions") {
    return runSessionsCommand(normalized.slice(1));
  }

  return {
    stdout: "",
    stderr: `未知命令：${command}\n运行 ${LINGHUN_CLI_NAME} --help 查看可用命令。\n`,
    exitCode: 2,
  };
}

async function runSessionsCommand(argv: string[]): Promise<CliResult> {
  const [subcommand = "list", ...rest] = argv;
  const [{ getSessionRootDir }, { SessionStore }] = await Promise.all([
    import("@linghun/config"),
    import("@linghun/core"),
  ]);
  const store = new SessionStore({ sessionRootDir: getSessionRootDir() });

  try {
    if (subcommand === "list") {
      const sessions = await store.list();
      if (rest.includes("--json")) {
        return jsonResult(sessions);
      }
      if (sessions.length === 0) {
        return { stdout: "当前项目还没有会话。\n", stderr: "", exitCode: 0 };
      }
      const lines = sessions.map((session) => {
        const summary = session.summary ?? "（无摘要）";
        return `${session.id}  ${session.updatedAt}  ${summary}`;
      });
      return { stdout: `会话ID  更新时间  摘要\n${lines.join("\n")}\n`, stderr: "", exitCode: 0 };
    }

    if (subcommand === "create") {
      const session = await store.create();
      const message = readOption(rest, "--message");
      if (message) {
        await store.appendEvent(session.id, createUserMessageEvent(message));
      }
      if (rest.includes("--json")) {
        return jsonResult(session);
      }
      return { stdout: `已创建会话：${session.id}\n`, stderr: "", exitCode: 0 };
    }

    if (subcommand === "append") {
      const [sessionId] = rest;
      const message = readOption(rest, "--message");
      if (!sessionId || !message) {
        return usageError("用法：linghun sessions append <id> --message 文本");
      }
      await store.appendEvent(sessionId, createUserMessageEvent(message));
      return { stdout: `已追加消息到会话：${sessionId}\n`, stderr: "", exitCode: 0 };
    }

    if (subcommand === "resume") {
      const [sessionId] = rest;
      if (!sessionId) {
        return usageError("用法：linghun sessions resume <id>");
      }
      const resumed = await store.resume(sessionId);
      if (rest.includes("--json")) {
        return jsonResult(resumed);
      }
      return {
        stdout: `已恢复会话：${resumed.session.id}\ntranscript：${resumed.session.transcriptPath}\n消息数：${resumed.transcript.length}\n`,
        stderr: formatDiagnostics(resumed.diagnostics),
        exitCode: 0,
      };
    }

    if (subcommand === "summary") {
      const [sessionId] = rest;
      if (!sessionId) {
        return usageError("用法：linghun sessions summary <id> [--text 文本]");
      }
      const text = readOption(rest, "--text");
      if (text) {
        const session = await store.updateSummary(sessionId, text);
        return { stdout: `已更新会话摘要：${session.summary}\n`, stderr: "", exitCode: 0 };
      }
      const resumed = await store.resume(sessionId);
      const summary =
        resumed.session.summary ?? `暂无摘要。transcript 消息数：${resumed.transcript.length}`;
      return {
        stdout: `${summary}\n`,
        stderr: formatDiagnostics(resumed.diagnostics),
        exitCode: 0,
      };
    }

    return usageError(`未知 sessions 子命令：${subcommand}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "会话命令执行失败。";
    return { stdout: "", stderr: `${message}\n`, exitCode: 1 };
  }
}

function normalizeSlashCommand(argv: string[]): string[] {
  const [command, ...rest] = argv;
  if (isSessionsSlashCommand(command)) {
    return ["sessions", ...rest];
  }
  return argv;
}

function isSessionsSlashCommand(command: string | undefined): boolean {
  if (!command) {
    return false;
  }
  const normalized = command.replaceAll("\\", "/");
  return normalized === "/sessions" || normalized.endsWith("/sessions");
}

function readOption(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  return argv[index + 1];
}

function createUserMessageEvent(text: string): TranscriptEvent {
  return {
    type: "user_message",
    id: randomUUID(),
    text,
    createdAt: new Date().toISOString(),
  };
}

function jsonResult(data: unknown): CliResult {
  return { stdout: `${JSON.stringify(data, null, 2)}\n`, stderr: "", exitCode: 0 };
}

function usageError(message: string): CliResult {
  return { stdout: "", stderr: `${message}\n`, exitCode: 2 };
}

function formatDiagnostics(diagnostics: { line: number; message: string }[]): string {
  if (diagnostics.length === 0) {
    return "";
  }
  return `${diagnostics
    .map((diagnostic) => `JSONL 第 ${diagnostic.line} 行已跳过：${diagnostic.message}`)
    .join("\n")}\n`;
}
