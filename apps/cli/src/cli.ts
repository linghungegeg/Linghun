import { randomUUID } from "node:crypto";
import type { TranscriptEvent } from "@linghun/core";
import type { ModelInfo } from "@linghun/providers";
import { LINGHUN_CLI_NAME, LINGHUN_NAME, LINGHUN_VERSION } from "@linghun/shared";

export const helpText = `${LINGHUN_NAME} ${LINGHUN_VERSION}

用法：
  ${LINGHUN_CLI_NAME}                                   进入 Phase 15 preflight 交互式终端
  ${LINGHUN_CLI_NAME} --version                         显示版本号
  ${LINGHUN_CLI_NAME} --help                            显示帮助信息
  ${LINGHUN_CLI_NAME} sessions list [--json]            列出当前项目会话
  ${LINGHUN_CLI_NAME} sessions create [--message 文本]  新建会话，可写入一条用户消息
  ${LINGHUN_CLI_NAME} sessions append <id> --message 文本  追加一条用户消息
  ${LINGHUN_CLI_NAME} sessions resume <id> [--json]     恢复并读取会话 transcript
  ${LINGHUN_CLI_NAME} sessions summary <id> [--text 文本]  查看或更新会话摘要
  ${LINGHUN_CLI_NAME} model                         查看当前模型配置
  ${LINGHUN_CLI_NAME} model set deepseek-v4-pro      切换当前 headless 模型
  ${LINGHUN_CLI_NAME} model doctor                   诊断模型配置
  TUI /model route                                  查看 Phase 13 角色模型路由
  TUI /model route doctor                           诊断角色 provider/model/capability/budget
  TUI /model route set <role> <model>               设置 planner/executor/reviewer/verifier/summarizer/vision/image
  TUI /vision <path>                                记录 VisionObservation evidence
  TUI /image generate <prompt>                      生成 image role 本地资产 metadata
  TUI /skills                                       列出本地 skill metadata 摘要
  TUI /skills add                                   显示本地 skill 注册路径
  TUI /skills enable|disable <id>                   持久化启停 skill
  TUI /workflows                                    列出 workflow 模板、风险和验证建议
  TUI /workflows <name>                             进入 workflow Start Gate
  TUI /plugins                                      列出本地 plugin manifest 与贡献项
  TUI /plugins doctor                               诊断 plugin 信任、权限和加载错误
  TUI /plugins enable|disable <id>                  持久化启停 plugin
  TUI /doctor hooks                                 诊断 hook 来源、事件、timeout 和 cache 影响

Slash 兼容：
  ${LINGHUN_CLI_NAME} /sessions
  ${LINGHUN_CLI_NAME} /sessions resume <id>
  ${LINGHUN_CLI_NAME} /sessions summary <id>
  ${LINGHUN_CLI_NAME} /model
  ${LINGHUN_CLI_NAME} /model set deepseek-v4-pro
  ${LINGHUN_CLI_NAME} /model doctor

说明：
  Phase 15 preflight 在 TUI 中提供 Natural Command Bridge：普通中英文输入先经 Command Capability Catalog 与本地风险裁决。
  Phase 14 主闭环提供本地 skills/workflows/hooks/plugins loader、doctor、启停、信任和权限边界。
  --version / --help 快速路径不会加载 TUI、模型、MCP、索引、验证器、插件或 cache 统计系统。

Windows 兼容：
  Linghun --version 与 linghun --version 行为一致。`;

export type CliResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export async function runCli(argv: string[]): Promise<CliResult> {
  const [command] = argv;

  if (!command) {
    const { runTui } = await import("@linghun/tui");
    const exitCode = await runTui();
    return { stdout: "", stderr: "", exitCode };
  }

  if (command === "--help" || command === "-h") {
    return { stdout: `${helpText}\n`, stderr: "", exitCode: 0 };
  }

  if (command === "--version" || command === "-v") {
    return { stdout: `${LINGHUN_VERSION}\n`, stderr: "", exitCode: 0 };
  }

  const normalized = normalizeSlashCommand(argv);
  if (normalized[0] === "sessions") {
    return runSessionsCommand(normalized.slice(1));
  }
  if (normalized[0] === "model") {
    return runModelCommand(normalized.slice(1));
  }

  return {
    stdout: "",
    stderr: `未知命令：${command}\n运行 ${LINGHUN_CLI_NAME} --help 查看可用命令。\n`,
    exitCode: 2,
  };
}

async function runModelCommand(argv: string[]): Promise<CliResult> {
  const [subcommand, ...rest] = argv;
  const [{ loadConfig, saveDefaultModel }, { deepSeekModels }] = await Promise.all([
    import("@linghun/config"),
    import("@linghun/providers"),
  ]);
  const config = await loadConfig();
  const provider = config.providers.deepseek;
  const modelId = provider.model;
  const model = deepSeekModels.find((item) => item.id === modelId) ?? deepSeekModels[0];

  if (!subcommand) {
    return {
      stdout: formatModelInfo(deepSeekModels, model.id, provider.baseUrl, provider.maxOutputTokens),
      stderr: "",
      exitCode: 0,
    };
  }

  if (subcommand === "set") {
    const [nextModel] = rest;
    const target = deepSeekModels.find((item) => item.id === nextModel);
    if (!target) {
      return usageError(`未知模型：${nextModel ?? "（空）"}`);
    }
    const nextConfig = await saveDefaultModel(target.id, process.cwd(), target.maxOutputTokens);
    const nextProvider = nextConfig.providers.deepseek;
    return {
      stdout: `当前 headless 模型已切换为：${target.id}\n${formatModelInfo(
        deepSeekModels,
        target.id,
        nextProvider.baseUrl,
        nextProvider.maxOutputTokens,
      )}`,
      stderr: "",
      exitCode: 0,
    };
  }

  if (subcommand === "doctor") {
    const problems: string[] = [];
    if (!provider.baseUrl) {
      problems.push("- 缺少 base_url：请设置 LINGHUN_DEEPSEEK_BASE_URL 或配置 provider.baseUrl。");
    }
    if (!provider.apiKey) {
      problems.push(
        "- 缺少 api_key：请设置 LINGHUN_DEEPSEEK_API_KEY，或在本地配置中填写 api_key。",
      );
    }
    const header = `模型诊断：${model.id}\nbase_url：${provider.baseUrl ?? "未配置"}\n`;
    if (problems.length === 0) {
      return { stdout: `${header}状态：配置看起来可用。\n`, stderr: "", exitCode: 0 };
    }
    return {
      stdout: `${header}状态：发现 ${problems.length} 个问题。\n${problems.join("\n")}\n建议：修复后重新运行 /model doctor。\n`,
      stderr: "",
      exitCode: 0,
    };
  }

  return usageError(`未知 model 子命令：${subcommand}`);
}

function formatModelInfo(
  models: ModelInfo[],
  modelId: string,
  baseUrl: string | undefined,
  maxOutputTokens: number | undefined,
): string {
  const model = models.find((item) => item.id === modelId) ?? models[0];
  return `当前模型：${model.displayName} (${model.id})\nprovider：deepseek\nbase_url：${baseUrl ?? "未配置"}\n上下文窗口：${model.contextWindow}\n最大输出：${maxOutputTokens ?? model.maxOutputTokens}\n`;
}

async function runSessionsCommand(argv: string[]): Promise<CliResult> {
  const [subcommand = "list", ...rest] = argv;
  const [{ loadConfig, resolveStoragePaths }, { SessionStore }] = await Promise.all([
    import("@linghun/config"),
    import("@linghun/core"),
  ]);
  const config = await loadConfig();
  const store = new SessionStore({ sessionRootDir: resolveStoragePaths(config).sessions });

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
  if (isSlashCommand(command, "sessions")) {
    return ["sessions", ...rest];
  }
  if (isSlashCommand(command, "model")) {
    return ["model", ...rest];
  }
  return argv;
}

function isSlashCommand(command: string | undefined, name: string): boolean {
  if (!command) {
    return false;
  }
  const normalized = command.replaceAll("\\", "/");
  return normalized === `/${name}` || normalized.endsWith(`/${name}`);
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
