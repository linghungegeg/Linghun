import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { EndpointProfile } from "@linghun/config";
import type { TranscriptEvent } from "@linghun/core";
import { type ModelInfo, resolveProviderRuntimeContract } from "@linghun/providers";
import { LINGHUN_CLI_NAME, LINGHUN_NAME, LINGHUN_VERSION } from "@linghun/shared";

export const helpText = `${LINGHUN_NAME} ${LINGHUN_VERSION}

用法：
  ${LINGHUN_CLI_NAME}                                   进入交互式终端
  ${LINGHUN_CLI_NAME} --version                         显示版本号
  ${LINGHUN_CLI_NAME} --help                            显示帮助信息
  ${LINGHUN_CLI_NAME} sessions list [--json]            列出当前项目会话
  ${LINGHUN_CLI_NAME} sessions create [--message 文本]  新建会话，可写入一条用户消息
  ${LINGHUN_CLI_NAME} sessions append <id> --message 文本  追加一条用户消息
  ${LINGHUN_CLI_NAME} sessions resume <id> [--json]     恢复并读取会话 transcript
  ${LINGHUN_CLI_NAME} sessions summary <id> [--text 文本]  查看或更新会话摘要
  ${LINGHUN_CLI_NAME} model                         查看当前模型配置
  ${LINGHUN_CLI_NAME} model set <model>             切换当前 headless 模型
  ${LINGHUN_CLI_NAME} model doctor                   诊断模型配置
  TUI /model setup                                  交互式配置 API 地址、key、模型名称和推理等级
  TUI /model route                                  查看角色模型路由
  TUI /model route doctor                           诊断角色 provider/model/capability/budget
  TUI /model route set <role> <model>               设置 planner/executor/reviewer/verifier/summarizer/vision/image
  TUI /vision <path>                                记录 VisionObservation evidence
  TUI /image generate <prompt>                      生成 image role 本地资产 metadata
  TUI /skills                                       列出本地 skill metadata 摘要
  TUI /skills add                                   显示本地 skill 注册路径
  TUI /skills enable|disable <id>                   持久化启停 skill
  TUI /workflows                                    列出 workflow 模板、风险和验证建议
  TUI /workflows <name>                             进入 workflow Start Gate
  TUI /workflows plan <goal>                        生成 Workflow Plan 预览
  TUI /plugins                                      列出本地 plugin manifest 与贡献项
  TUI /plugins doctor                               诊断 plugin 信任、权限和加载错误
  TUI /plugins enable|disable <id>                  持久化启停 plugin
  TUI /doctor hooks                                 诊断 hook 来源、事件、timeout 和 cache 影响

Slash 兼容：
  ${LINGHUN_CLI_NAME} /sessions
  ${LINGHUN_CLI_NAME} /sessions resume <id>
  ${LINGHUN_CLI_NAME} /sessions summary <id>
  ${LINGHUN_CLI_NAME} /model
  ${LINGHUN_CLI_NAME} /model set <model>
  ${LINGHUN_CLI_NAME} /model doctor

说明：
  交互式终端中普通中英文输入默认进入模型/工具链路；slash 命令和确认等结构化入口走本地前置。
  本地扩展系统提供 skills/workflows/hooks/plugins loader、doctor、启停、信任和权限边界。
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
    configureCliBundledRoot();
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

function configureCliBundledRoot(): void {
  if (process.env.LINGHUN_CLI_BUNDLED_ROOT) {
    return;
  }
  process.env.LINGHUN_CLI_BUNDLED_ROOT = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "bundled",
  );
}

async function runModelCommand(argv: string[]): Promise<CliResult> {
  const [subcommand, ...rest] = argv;
  const [configModule, { findKnownModel, resolveProviderBaseUrlDiagnostic }] = await Promise.all([
    import("@linghun/config"),
    import("@linghun/providers"),
  ]);
  const {
    getProjectSettingsPath,
    loadConfig,
    readProviderEnvValues,
    resolveModelSelection,
    saveDefaultModel,
  } = configModule;
  const config = await loadConfig();
  const target = resolveDoctorTarget(config);
  const provider = target.provider;
  const modelId = target.modelId;

  if (!subcommand) {
    return {
      stdout: formatModelInfo(findKnownModel, modelId, provider.baseUrl, target.providerId),
      stderr: "",
      exitCode: 0,
    };
  }

  if (subcommand === "set") {
    const [nextModel] = rest;
    if (!nextModel) {
      return usageError("用法：linghun model set <model>");
    }
    let resolved: ReturnType<typeof resolveModelSelection>;
    try {
      resolved = resolveModelSelection(nextModel, config.providers);
    } catch (error) {
      return usageError(error instanceof Error ? error.message : "模型不可用。");
    }
    const nextConfig = await saveDefaultModel(resolved.model, process.cwd());
    const nextProvider = nextConfig.providers[resolved.provider];
    const aliasNote = resolved.legacyAlias
      ? `说明：${resolved.inputModel} 是 legacy/display alias，已保存为 ${resolved.model}\n`
      : "";
    return {
      stdout: `当前 headless 模型已切换为：${resolved.model}\n${aliasNote}${formatModelInfo(
        findKnownModel,
        resolved.model,
        nextProvider.baseUrl,
        resolved.provider,
      )}`,
      stderr: "",
      exitCode: 0,
    };
  }

  if (subcommand === "doctor") {
    const projectSettingsApiKeyProviders = await readProjectSettingsApiKeyProviders(
      getProjectSettingsPath(process.cwd()),
    );
    const providerEnvApiKeyProviders = await readProviderEnvApiKeyProviders(readProviderEnvValues);
    const target = resolveDoctorTarget(config);
    const keySource = getProviderKeySource(
      target.providerId,
      Boolean(target.provider.apiKey),
      projectSettingsApiKeyProviders,
      providerEnvApiKeyProviders,
    );
    const problems: string[] = [];
    const warnings: string[] = [];
    const envPrefix = target.providerId === "deepseek" ? "LINGHUN_DEEPSEEK" : "LINGHUN_OPENAI";
    if (!target.provider.baseUrl) {
      problems.push(`- 缺少 base_url：请设置 ${envPrefix}_BASE_URL 或配置 provider.baseUrl。`);
    }
    if (!target.provider.apiKey) {
      problems.push(
        `- 缺少 api_key：请设置 ${envPrefix}_API_KEY，或在本机私有 provider.env 中填写。`,
      );
    }
    if (projectSettingsApiKeyProviders.has(target.providerId)) {
      warnings.push(
        `WARN: project-settings provider=${target.providerId} contains apiKey; project .linghun/settings.json 不建议保存 apiKey，请迁移到环境变量或私有配置。`,
      );
    }
    const contract = resolveProviderRuntimeContract({
      id: target.providerId,
      type: target.provider.type,
      baseUrl: target.provider.baseUrl,
      apiKey: target.provider.apiKey,
      model: target.provider.model,
      endpointProfile: target.provider.endpointProfile,
      reasoningLevel: target.provider.reasoningLevel,
    });
    const endpointProfile = contract.endpointProfile;
    const baseUrlDiagnostic = resolveProviderBaseUrlDiagnostic(
      target.provider.baseUrl,
      endpointProfile,
    );
    if (baseUrlDiagnostic.hasQueryOrFragment) {
      warnings.push(
        "WARN: baseUrl contains query/fragment; doctor hides raw value，请改为不含 query/fragment 的 root baseUrl。",
      );
    }
    if (baseUrlDiagnostic.fullEndpointSuffix) {
      warnings.push(
        `WARN: baseUrl contains full endpoint suffix=${baseUrlDiagnostic.fullEndpointSuffix}; endpointPath=${baseUrlDiagnostic.endpointPath}`,
      );
    }
    const apiKeyStatus = target.provider.apiKey
      ? `present source=${keySource} masked=${maskSecret(target.provider.apiKey)}`
      : "missing source=missing";
    const reasoningStatus = contract.sendReasoning
      ? `sent level=${target.provider.reasoningLevel ?? "request"}`
      : target.provider.reasoningLevel
        ? `not-sent level=${target.provider.reasoningLevel}`
        : "not-configured";
    const header = `模型诊断：${target.modelId}\nprovider=${target.providerId} model=${target.modelId} endpointProfile=${endpointProfile} endpointPath=${baseUrlDiagnostic.endpointPath}\nreasoning=${reasoningStatus}\nbaseUrl=${target.provider.baseUrl ? "present" : "missing"}\napiKey=${apiKeyStatus}\nlimited=headless-cli; full route diagnostics: TUI /model doctor\n`;
    const warningText = warnings.length > 0 ? `${warnings.join("\n")}\n` : "";
    if (problems.length === 0) {
      return { stdout: `${header}${warningText}状态：配置看起来可用。\n`, stderr: "", exitCode: 0 };
    }
    return {
      stdout: `${header}${warningText}状态：发现 ${problems.length} 个问题。\n${problems.join("\n")}\n建议：修复后重新运行 /model doctor。\n`,
      stderr: "",
      exitCode: 0,
    };
  }

  return usageError(`未知 model 子命令：${subcommand}`);
}

function formatModelInfo(
  findDeepSeekModel: (modelId: string) => ModelInfo | undefined,
  modelId: string,
  baseUrl: string | undefined,
  providerId = "deepseek",
): string {
  if (providerId === "deepseek") {
    const model = findDeepSeekModel(modelId) ?? findDeepSeekModel("deepseek-chat");
    if (model) {
      return `当前模型：${model.displayName} (${model.id})\nprovider：${providerId}\nbase_url：${baseUrl ? "present" : "missing"}\n上下文窗口：${model.contextWindow}\n厂商最大输出：${model.maxOutputTokens}\n请求输出上限：未设置\n`;
    }
  }
  return `当前模型：${modelId}\nprovider：${providerId}\nbase_url：${baseUrl ? "present" : "missing"}\n上下文窗口：unknown\n厂商最大输出：unknown\n请求输出上限：未设置\n`;
}

type DoctorProviderConfig = {
  type: "openai-compatible" | "deepseek";
  baseUrl?: string;
  apiKey?: string;
  model: string;
  // Run 2 P1-3 修复 — 复用 config 的 canonical EndpointProfile（含 anthropic_messages），
  // 否则 LinghunConfig.providers 不能赋给 DoctorConfig。doctor 只读这些字段做诊断，
  // 不影响 provider/model route 真实选择逻辑。
  endpointProfile?: EndpointProfile;
  reasoningLevel?: string;
};

type DoctorConfig = {
  defaultModel: string;
  providers: Record<string, DoctorProviderConfig>;
  modelRoutes?: {
    defaultModel?: string;
    routes?: Array<{ provider: string; primaryModel: string }>;
  };
};

function resolveDoctorTarget(config: DoctorConfig): {
  providerId: string;
  provider: DoctorProviderConfig;
  modelId: string;
} {
  const modelId = config.defaultModel;
  const route = config.modelRoutes?.routes?.find(
    (item) => item.primaryModel === modelId && Boolean(config.providers[item.provider]),
  );
  if (route) {
    return { providerId: route.provider, provider: config.providers[route.provider], modelId };
  }
  const providerEntry = Object.entries(config.providers).find(([, item]) => item.model === modelId);
  if (providerEntry) {
    return { providerId: providerEntry[0], provider: providerEntry[1], modelId };
  }
  return {
    providerId: "deepseek",
    provider: config.providers.deepseek,
    modelId: config.providers.deepseek.model,
  };
}

async function readProjectSettingsApiKeyProviders(settingsPath: string): Promise<Set<string>> {
  try {
    const raw = await readFile(settingsPath, "utf8");
    const parsed = JSON.parse(raw) as { providers?: Record<string, { apiKey?: unknown }> };
    return new Set(
      Object.entries(parsed.providers ?? {})
        .filter(([, provider]) => typeof provider.apiKey === "string" && provider.apiKey.length > 0)
        .map(([providerId]) => providerId),
    );
  } catch {
    return new Set();
  }
}

async function readProviderEnvApiKeyProviders(
  readProviderEnvValues: () => Promise<Record<string, string>>,
): Promise<Set<string>> {
  try {
    const values = await readProviderEnvValues();
    return new Set([
      ...(values.LINGHUN_OPENAI_API_KEY ? ["openai-compatible"] : []),
      ...(values.LINGHUN_DEEPSEEK_API_KEY ? ["deepseek"] : []),
    ]);
  } catch {
    return new Set();
  }
}

function getProviderKeySource(
  providerId: string,
  hasApiKey: boolean,
  projectSettingsApiKeyProviders: Set<string>,
  providerEnvApiKeyProviders: Set<string>,
): string {
  if (!hasApiKey) return "missing";
  const envName = providerId === "deepseek" ? "LINGHUN_DEEPSEEK_API_KEY" : "LINGHUN_OPENAI_API_KEY";
  if (process.env[envName]) return "shell-env";
  if (providerEnvApiKeyProviders.has(providerId)) {
    return process.env.LINGHUN_CONFIG_DIR ? "config-dir-provider-env" : "user-provider-env";
  }
  if (projectSettingsApiKeyProviders.has(providerId)) return "project-settings-legacy";
  return "missing";
}

function maskSecret(secret: string): string {
  if (secret.length <= 8) return "****";
  return `${secret.slice(0, 3)}…${secret.slice(-4)}`;
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
