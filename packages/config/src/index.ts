import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import {
  CODEBASE_MEMORY_COMMAND,
  CODEBASE_MEMORY_ENV,
  DEEPSEEK_API_MODELS,
  DEFAULT_DEEPSEEK_BASE_URL,
  type Language,
  type PermissionMode,
  canonicalPathForCompare,
  isDeepSeekApiModel,
  isRawPermissionMode,
  normalizeDeepSeekModelName,
  normalizePathSeparators,
  normalizePermissionMode,
} from "@linghun/shared";

export type EndpointProfile = "chat_completions" | "responses" | "anthropic_messages";
export type ProviderCompatibilityProfile =
  | "deepseek"
  | "strict_openai_compatible"
  | "permissive_openai_compatible";

export type ProviderConfig = {
  type: "openai-compatible" | "deepseek";
  baseUrl?: string;
  apiKey?: string;
  model: string;
  maxOutputTokens?: number;
  supportsTools?: boolean;
  endpointProfile?: EndpointProfile;
  compatibilityProfile?: ProviderCompatibilityProfile;
  reasoningLevel?: string;
  includeUsage?: boolean;
  // D.13H：Anthropic Context Editing / cache_edits 收口（hard-disabled）。
  // 默认未配置；只读字段，model-doctor / providers 运行时透传给
  // resolveAnthropicContextEditingDiagnostic。具体语义见 packages/providers ProviderConfig。
  contextEditingEnabled?: boolean;
  anthropicBetaHeaders?: string[];
};

export type ModelRole =
  | "planner"
  | "executor"
  | "reviewer"
  | "verifier"
  | "summarizer"
  | "vision"
  | "image";

export type ModelCapability = "text" | "tools" | "vision" | "image" | "thinking" | "promptCache";

export type RoleModelRoute = {
  role: ModelRole;
  provider: string;
  primaryModel: string;
  fallbackModels: string[];
  requiredCapabilities: ModelCapability[];
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxCostCny?: number;
  allowTools: boolean;
  allowWrite: boolean;
  allowBash: boolean;
  requireApprovalBeforeRun: boolean;
};

export type ModelRouteConfig = {
  defaultModel: string;
  routes: RoleModelRoute[];
};

export type ModelPricing = {
  inputPer1K: number;
  outputPer1K: number;
  currency: "CNY";
  source: "packaged_estimate";
};

export const MODEL_PRICING: Record<string, ModelPricing> = {
  "deepseek-chat": {
    inputPer1K: 0.002,
    outputPer1K: 0.008,
    currency: "CNY",
    source: "packaged_estimate",
  },
  "deepseek-reasoner": {
    inputPer1K: 0.004,
    outputPer1K: 0.016,
    currency: "CNY",
    source: "packaged_estimate",
  },
  "gpt-4.1": {
    inputPer1K: 0.0146,
    outputPer1K: 0.0584,
    currency: "CNY",
    source: "packaged_estimate",
  },
  "gpt-4.1-mini": {
    inputPer1K: 0.0029,
    outputPer1K: 0.0117,
    currency: "CNY",
    source: "packaged_estimate",
  },
  "gpt-4o": {
    inputPer1K: 0.0183,
    outputPer1K: 0.073,
    currency: "CNY",
    source: "packaged_estimate",
  },
  "gpt-4o-mini": {
    inputPer1K: 0.0011,
    outputPer1K: 0.0044,
    currency: "CNY",
    source: "packaged_estimate",
  },
  "gpt-5.5": {
    inputPer1K: 0.0091,
    outputPer1K: 0.073,
    currency: "CNY",
    source: "packaged_estimate",
  },
  "gpt-5.4": {
    inputPer1K: 0.0091,
    outputPer1K: 0.073,
    currency: "CNY",
    source: "packaged_estimate",
  },
  "gpt-5.4-mini": {
    inputPer1K: 0.0018,
    outputPer1K: 0.0146,
    currency: "CNY",
    source: "packaged_estimate",
  },
};

export function findModelPricing(modelName: string | undefined): ModelPricing | undefined {
  const normalized = normalizePricingModelName(modelName);
  if (!normalized) return undefined;
  return MODEL_PRICING[normalized];
}

export function calculateEstimatedCny(
  modelName: string | undefined,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = findModelPricing(modelName);
  if (!pricing) return Number.NaN;
  const safeInput = Number.isFinite(inputTokens) ? Math.max(0, inputTokens) : 0;
  const safeOutput = Number.isFinite(outputTokens) ? Math.max(0, outputTokens) : 0;
  return (safeInput / 1000) * pricing.inputPer1K + (safeOutput / 1000) * pricing.outputPer1K;
}

function normalizePricingModelName(modelName: string | undefined): string {
  const trimmed = (modelName ?? "").trim().toLowerCase();
  if (!trimmed) return "";
  const withoutProvider = trimmed.includes("/") ? (trimmed.split("/").at(-1) ?? trimmed) : trimmed;
  const withoutSnapshot = withoutProvider.replace(/-\d{4}-\d{2}-\d{2}$/u, "");
  if (withoutSnapshot.startsWith("gpt-4.1-mini")) return "gpt-4.1-mini";
  if (withoutSnapshot.startsWith("gpt-4.1")) return "gpt-4.1";
  if (withoutSnapshot.startsWith("gpt-4o-mini")) return "gpt-4o-mini";
  if (withoutSnapshot.startsWith("gpt-4o")) return "gpt-4o";
  if (withoutSnapshot.startsWith("gpt-5.5")) return "gpt-5.5";
  if (withoutSnapshot.startsWith("gpt-5.4-mini")) return "gpt-5.4-mini";
  if (withoutSnapshot.startsWith("gpt-5.4")) return "gpt-5.4";
  if (withoutSnapshot.startsWith("deepseek-chat")) return "deepseek-chat";
  if (withoutSnapshot.startsWith("deepseek-reasoner")) return "deepseek-reasoner";
  return withoutSnapshot;
}

export type McpServerConfig = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  transport?: "stdio" | "sse";
  disabled?: boolean;
  sourceUrl?: string;
  localPath?: string;
  ref?: string;
  commit?: string;
  scope?: "project" | "user";
  installedAt?: string;
  trustLevel?: "trusted" | "untrusted" | "disabled";
  permissionSummary?: string;
};

export type StorageScope = "project" | "user" | "custom";

export type StorageLocation = {
  scope: StorageScope;
  path?: string;
};

export type StorageConfig = {
  projectData: StorageLocation;
  userData: StorageLocation;
  sessions: StorageLocation;
  memory: {
    project: StorageLocation;
    user: StorageLocation;
    session: StorageLocation;
  };
  index: StorageLocation;
  logs: StorageLocation;
  jobs: StorageLocation;
  cache: StorageLocation;
};

export type TrustSource = "local" | "official" | "third-party";

export type SkillConfig = {
  enabled: boolean;
  projectDir: string;
  userDir: string;
  disabledIds: string[];
  trustedIds: string[];
};

export type WorkflowConfig = {
  enabled: boolean;
  disabledIds: string[];
};

export type HookEvent =
  | "PreToolUse"
  | "PostToolUse"
  | "Stop"
  | "Notification"
  | "Workflow"
  | "Plugin";

export type HookConfig = {
  enabled: boolean;
  timeoutMs: number;
  outputLimitBytes: number;
  projectTrusted: boolean;
  disabledIds: string[];
  trustedIds: string[];
};

export type PluginConfig = {
  enabled: boolean;
  projectDir: string;
  userDir: string;
  disabledIds: string[];
  trustedIds: string[];
};

export type RemoteChannelType = "wecom" | "enterprise-wechat" | "feishu" | "lark" | "dingtalk";
export type RemoteTransport = "official_cli" | "webhook_mock" | "webhook";
export type RemoteInboundMode = "none" | "poll" | "callback";
export type RemoteEventType =
  | "approval_request"
  | "job_status"
  | "job_report"
  | "verification_result"
  | "failure_summary"
  | "stable_point_result"
  | "index_result";

export type RemoteChannelConfig = {
  enabled: boolean;
  type: RemoteChannelType;
  transport: RemoteTransport;
  endpoint?: string;
  cliPath?: string;
  appIdRef?: string;
  appSecretRef?: string;
  bindingUserId?: string;
  bindingDeviceId?: string;
  signingSecretRef?: string;
  encryptKeyRef?: string;
  verificationTokenRef?: string;
  tokenRef?: string;
  redactionPolicy: "summary_only";
  allowedEventTypes: RemoteEventType[];
  trustedSources: string[];
  // D.14E — 入站能力分级：none=notification-only（默认）；poll=官方 CLI 拉取消息；
  // callback=已部署回调端点接收手机回传。webhook/webhook_mock 通道恒为 none。
  inboundMode?: RemoteInboundMode;
  // callback 模式下用户已部署的回调端点引用（脱敏，仅 doctor 内部判断 ready）。
  callbackEndpoint?: string;
  localBridgePort?: number;
};

export type RemoteConfig = {
  enabled: boolean;
  channels: Record<string, RemoteChannelConfig>;
};

export type NativeRunnerSource =
  | "disabled"
  | "bundled"
  | "optional-package"
  | "project-local"
  | "custom";

export type NativeRunnerConfig = {
  enabled: boolean;
  path?: string;
  expectedProtocol: string;
  source: NativeRunnerSource;
  timeoutMs: number;
};

export type WorkspaceTrustLevel = "trusted" | "restricted" | "untrusted";

export type WorkspaceTrustConfig = {
  level: WorkspaceTrustLevel;
  recorded: boolean;
  trustedAt?: string;
  updatedAt?: string;
};

export type ConfigRecoveryWarning = {
  path: string;
  reason: string;
  recoveredAt: string;
};

export type ProviderEnvWarning = {
  path: string;
  reason: string;
};

export type ProviderEnvSetup = {
  baseUrl: string;
  apiKey: string;
  model: string;
  reasoningLevel?: "Low" | "Medium" | "High";
  endpointProfile?: EndpointProfile;
  includeUsage?: boolean;
  auxModel?: string;
};

export let lastConfigRecoveryWarning: ConfigRecoveryWarning | undefined;
export let lastProviderEnvWarning: ProviderEnvWarning | undefined;

// D.13J Block 1：占位 / 未成熟模型名集合。
// 这些名字会出现在默认配置里（例如 deepseek-v4-flash / deepseek-v4-pro），
// 但 DeepSeek 官方目前没有 v4 系列；如果用户没有用 LINGHUN_DEEPSEEK_MODEL 覆盖，
// 第一次发请求就会 404。doctor 必须能把这种"占位状态"标出来，让用户在 smoke 之前
// 显式替换为现役模型名（例如 deepseek-chat / deepseek-reasoner）。
export const defaultPlaceholderModelNames: ReadonlySet<string> = new Set([
  "deepseek-v4-flash",
  "deepseek-v4-pro",
  "openai-compatible-model",
]);

export function isDefaultPlaceholderModel(model: string | undefined): boolean {
  if (!model) return false;
  return defaultPlaceholderModelNames.has(model);
}

export type ResolvedModelSelection = {
  inputModel: string;
  model: string;
  provider: string;
  legacyAlias: boolean;
};

export function resolveModelSelection(
  model: string,
  providers: Record<string, ProviderConfig>,
): ResolvedModelSelection {
  const inputModel = model.trim();
  if (!inputModel) {
    throw new Error("模型名不能为空。");
  }
  const normalized = normalizeDeepSeekModelName(inputModel);
  for (const [providerId, provider] of Object.entries(providers)) {
    if (provider.model === normalized) {
      return {
        inputModel,
        model: normalized,
        provider: providerId,
        legacyAlias: normalized !== inputModel,
      };
    }
  }
  if (isDeepSeekApiModel(normalized) && providers.deepseek) {
    return {
      inputModel,
      model: normalized,
      provider: "deepseek",
      legacyAlias: normalized !== inputModel,
    };
  }
  throw new Error(
    `未知模型：${inputModel}。DeepSeek 可用真实模型：${DEEPSEEK_API_MODELS.join("、")}。`,
  );
}

// D.13J Block 1：上一次 mergeProviderEnvConfig 的合并摘要。
// doctor 能据此明确告诉用户："你 ~/.linghun/provider.env 覆盖了 modelRoutes / providers / defaultModel"。
// 仅记录字段是否覆盖、provider id 列表，**绝不**记录 apiKey、baseUrl、modelRoutes 内容等敏感数据。
export type ProviderEnvMergeSummary = {
  // provider.env 是否参与了合并（即 readProviderEnvConfig 返回非空）。
  applied: boolean;
  // provider.env 是否覆盖了项目级 modelRoutes。
  overrodeModelRoutes: boolean;
  // provider.env 是否覆盖了项目级 defaultModel。
  overrodeDefaultModel: boolean;
  // provider.env 引入的 provider id 列表（不含 apiKey、baseUrl、model 值）。
  providerIds: string[];
};

export let lastProviderEnvMerge: ProviderEnvMergeSummary | undefined;

export type LinghunConfig = {
  language: Language;
  defaultModel: string;
  providers: Record<string, ProviderConfig>;
  modelRoutes: ModelRouteConfig;
  permission: {
    defaultMode: PermissionMode;
  };
  mcp: {
    enabledServers: string[];
    servers: Record<string, McpServerConfig>;
  };
  storage: StorageConfig;
  index: {
    enabled: boolean;
    mode: "fast" | "moderate" | "full";
    ignoreFile: ".linghunignore" | ".cbmignore";
  };
  // D.13F：prompt cache 总开关与 Anthropic system block 的 ttl 选择。
  // enabled=false 时，provider 不会输出 cache_control 字段；systemTtl="1h" 仅在用户显式选择时
  // 写入 cache_control.ttl: "1h"，默认 "5m" 表示不传 ttl 字面量（Anthropic 默认 5m）。
  promptCache: {
    enabled: boolean;
    systemTtl: "5m" | "1h";
  };
  skills: SkillConfig;
  workflows: WorkflowConfig;
  hooks: HookConfig;
  plugins: PluginConfig;
  remote: RemoteConfig;
  nativeRunner: NativeRunnerConfig;
  workspaceTrust: WorkspaceTrustConfig;
};

// D.13P-hotfix：默认 DeepSeek 运行时模型不再使用 placeholder `deepseek-v4-flash`。
// 现役默认改为 `deepseek-chat`；当用户设置 LINGHUN_DEEPSEEK_MODEL 时跟随该值。
// `defaultPlaceholderModelNames` 仍保留 deepseek-v4-flash / deepseek-v4-pro / openai-compatible-model
// 用于 doctor warning 与测试 fixture，识别能力不变。
const defaultDeepSeekModel = normalizeDeepSeekModelName(
  process.env.LINGHUN_DEEPSEEK_MODEL ?? "deepseek-chat",
);
const defaultLinghunModel = normalizeDeepSeekModelName(
  process.env.LINGHUN_DEFAULT_MODEL ?? defaultDeepSeekModel,
);
const openAiCompatibleModelPlaceholder = "openai-compatible-model";
const defaultOpenAiEndpointProfile = normalizeEndpointProfile(
  process.env.LINGHUN_OPENAI_ENDPOINT_PROFILE,
);
const defaultReasoningLevel = process.env.LINGHUN_INFERENCE_LEVEL;
const providerEnvFileName = "provider.env";
const providerEnvKeys = new Set([
  "LINGHUN_OPENAI_BASE_URL",
  "LINGHUN_OPENAI_API_KEY",
  "LINGHUN_OPENAI_MODEL",
  "LINGHUN_OPENAI_ENDPOINT_PROFILE",
  "LINGHUN_OPENAI_INCLUDE_USAGE",
  "LINGHUN_DEEPSEEK_BASE_URL",
  "LINGHUN_DEEPSEEK_API_KEY",
  "LINGHUN_DEEPSEEK_MODEL",
  "LINGHUN_INFERENCE_LEVEL",
  "LINGHUN_AUX_MODEL",
]);

export const providerEnvTemplate = `# Linghun private provider config. Do not commit this file.
# Shell env variables with the same names have higher priority.
# Standard OpenAI-compatible / Responses setup.
# Use the root API base URL; do not append /v1/chat/completions or /responses.
# Example:
#   LINGHUN_OPENAI_BASE_URL=https://api.example.com/v1
#   LINGHUN_OPENAI_MODEL=gpt-5.5
LINGHUN_OPENAI_BASE_URL=
LINGHUN_OPENAI_API_KEY=
LINGHUN_OPENAI_MODEL=
# Supported: chat_completions, responses, anthropic_messages.
LINGHUN_OPENAI_ENDPOINT_PROFILE=responses
# Set true only when your gateway returns usage in stream chunks.
LINGHUN_OPENAI_INCLUDE_USAGE=false

# Optional DeepSeek official provider fallback.
# Uncomment and fill these if you want deepseek as the active provider instead.
# LINGHUN_DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
# LINGHUN_DEEPSEEK_API_KEY=
# LINGHUN_DEEPSEEK_MODEL=deepseek-chat

# Supported reasoning levels: Low, Medium, High.
LINGHUN_INFERENCE_LEVEL=High
# Optional: leave empty to let helper roles follow the main model.
LINGHUN_AUX_MODEL=
`;

export const defaultModelRoutes: ModelRouteConfig = {
  defaultModel: defaultLinghunModel,
  // These DeepSeek routes are only packaged defaults; env/project settings can override them.
  routes: [
    {
      role: "planner",
      provider: "deepseek",
      primaryModel: defaultDeepSeekModel,
      fallbackModels: [],
      requiredCapabilities: ["text"],
      maxCostCny: 0,
      allowTools: false,
      allowWrite: false,
      allowBash: false,
      requireApprovalBeforeRun: true,
    },
    {
      role: "executor",
      provider: "deepseek",
      primaryModel: defaultDeepSeekModel,
      fallbackModels: [],
      requiredCapabilities: ["text"],
      allowTools: true,
      allowWrite: true,
      allowBash: true,
      requireApprovalBeforeRun: true,
    },
    {
      role: "reviewer",
      provider: "deepseek",
      primaryModel: defaultDeepSeekModel,
      fallbackModels: [],
      requiredCapabilities: ["text"],
      allowTools: true,
      allowWrite: false,
      allowBash: false,
      requireApprovalBeforeRun: false,
    },
    {
      role: "verifier",
      provider: "deepseek",
      primaryModel: defaultDeepSeekModel,
      fallbackModels: [],
      requiredCapabilities: ["text"],
      allowTools: true,
      allowWrite: false,
      allowBash: true,
      requireApprovalBeforeRun: false,
    },
    {
      role: "summarizer",
      provider: "deepseek",
      primaryModel: defaultDeepSeekModel,
      fallbackModels: [],
      requiredCapabilities: ["text"],
      maxCostCny: 0,
      allowTools: false,
      allowWrite: false,
      allowBash: false,
      requireApprovalBeforeRun: false,
    },
    {
      role: "vision",
      provider: "",
      primaryModel: "",
      fallbackModels: [],
      requiredCapabilities: ["vision"],
      allowTools: false,
      allowWrite: false,
      allowBash: false,
      requireApprovalBeforeRun: true,
    },
    {
      role: "image",
      provider: "",
      primaryModel: "",
      fallbackModels: [],
      requiredCapabilities: ["image"],
      allowTools: false,
      allowWrite: false,
      allowBash: false,
      requireApprovalBeforeRun: true,
    },
  ],
};

export const defaultConfig: LinghunConfig = {
  language: "zh-CN",
  defaultModel: defaultLinghunModel,
  providers: {
    deepseek: {
      type: "deepseek",
      baseUrl: process.env.LINGHUN_DEEPSEEK_BASE_URL ?? DEFAULT_DEEPSEEK_BASE_URL,
      apiKey: process.env.LINGHUN_DEEPSEEK_API_KEY,
      model: defaultDeepSeekModel,
    },
    "openai-compatible": {
      type: "openai-compatible",
      baseUrl: process.env.LINGHUN_OPENAI_BASE_URL,
      apiKey: process.env.LINGHUN_OPENAI_API_KEY,
      model: process.env.LINGHUN_OPENAI_MODEL ?? openAiCompatibleModelPlaceholder,
      endpointProfile: defaultOpenAiEndpointProfile,
      compatibilityProfile: "strict_openai_compatible",
      reasoningLevel: defaultReasoningLevel,
      includeUsage: parseEnvBoolean(process.env.LINGHUN_OPENAI_INCLUDE_USAGE),
    },
  },
  modelRoutes: defaultModelRoutes,
  permission: {
    defaultMode: "default",
  },
  mcp: {
    enabledServers: ["codebase-memory"],
    servers: {
      "codebase-memory": {
        command: process.env[CODEBASE_MEMORY_ENV] ?? CODEBASE_MEMORY_COMMAND,
        args: [],
      },
    },
  },
  storage: {
    projectData: { scope: "project" },
    userData: { scope: "user" },
    sessions: { scope: "user" },
    memory: {
      project: { scope: "project" },
      user: { scope: "user" },
      session: { scope: "project" },
    },
    index: { scope: "project" },
    logs: { scope: "user" },
    jobs: { scope: "user" },
    cache: { scope: "user" },
  },
  index: {
    enabled: true,
    mode: "fast",
    ignoreFile: ".linghunignore",
  },
  promptCache: {
    enabled: true,
    systemTtl: "5m",
  },
  skills: {
    enabled: true,
    projectDir: ".linghun/skills",
    userDir: "~/.linghun/skills",
    disabledIds: [],
    trustedIds: [],
  },
  workflows: {
    enabled: true,
    disabledIds: [],
  },
  hooks: {
    enabled: false,
    timeoutMs: 5_000,
    outputLimitBytes: 4_096,
    projectTrusted: false,
    disabledIds: [],
    trustedIds: [],
  },
  plugins: {
    enabled: true,
    projectDir: ".linghun/plugins",
    userDir: "~/.linghun/plugins",
    disabledIds: [],
    trustedIds: [],
  },
  remote: {
    enabled: false,
    channels: {
      feishu: {
        enabled: false,
        type: "feishu",
        transport: "official_cli",
        cliPath: process.env.LINGHUN_FEISHU_CLI ?? "feishu-cli",
        redactionPolicy: "summary_only",
        allowedEventTypes: [
          "approval_request",
          "job_status",
          "job_report",
          "verification_result",
          "failure_summary",
          "stable_point_result",
          "index_result",
        ],
        trustedSources: [],
        inboundMode: "none",
      },
      wecom: {
        enabled: false,
        type: "wecom",
        transport: "official_cli",
        cliPath: "wecom-cli",
        redactionPolicy: "summary_only",
        allowedEventTypes: [
          "approval_request",
          "job_status",
          "job_report",
          "verification_result",
          "failure_summary",
          "stable_point_result",
          "index_result",
        ],
        trustedSources: [],
        inboundMode: "none",
      },
      dingtalk: {
        enabled: false,
        type: "dingtalk",
        transport: "official_cli",
        cliPath: "dws",
        redactionPolicy: "summary_only",
        allowedEventTypes: [
          "approval_request",
          "job_status",
          "job_report",
          "verification_result",
          "failure_summary",
          "stable_point_result",
          "index_result",
        ],
        trustedSources: [],
        inboundMode: "none",
      },
    },
  },
  nativeRunner: {
    enabled: false,
    expectedProtocol: "linghun-native-runner-prototype.v1",
    source: "disabled",
    timeoutMs: 60_000,
  },
  workspaceTrust: {
    level: "trusted",
    recorded: false,
  },
};

export function getUserConfigDir(home = homedir()): string {
  return process.env.LINGHUN_CONFIG_DIR || join(home, ".linghun");
}

export function getProjectConfigDir(projectPath = process.cwd()): string {
  return join(projectPath, ".linghun");
}

export function getUserDataDir(home = homedir()): string {
  return process.env.LINGHUN_DATA_DIR || join(home, ".linghun", "data");
}

export function getSessionRootDir(home = homedir()): string {
  return join(getUserDataDir(home), "sessions");
}

export type ResolvedStoragePaths = {
  projectData: string;
  userData: string;
  sessions: string;
  memoryProject: string;
  memoryUser: string;
  memorySession: string;
  index: string;
  logs: string;
  jobs: string;
  cache: string;
  agentRuns: string;
  failures: string;
};

export function resolveStoragePaths(
  config: LinghunConfig = defaultConfig,
  projectPath = process.cwd(),
  home = homedir(),
): ResolvedStoragePaths {
  const userData = resolveStorageLocation(config.storage.userData, projectPath, home, "");
  const projectData = resolveStorageLocation(config.storage.projectData, projectPath, home, "");
  return {
    projectData,
    userData,
    sessions: resolveStorageLocation(config.storage.sessions, projectPath, home, "sessions"),
    memoryProject: resolveStorageLocation(
      config.storage.memory.project,
      projectPath,
      home,
      "memory",
    ),
    memoryUser: resolveStorageLocation(config.storage.memory.user, projectPath, home, "memory"),
    memorySession: resolveStorageLocation(
      config.storage.memory.session,
      projectPath,
      home,
      join("memory", "session"),
    ),
    index: resolveStorageLocation(config.storage.index, projectPath, home, "index"),
    logs: resolveStorageLocation(config.storage.logs, projectPath, home, "logs"),
    jobs: resolveStorageLocation(config.storage.jobs, projectPath, home, "jobs"),
    cache: resolveStorageLocation(
      process.env.LINGHUN_DATA_DIR && config.storage.cache.scope === "user"
        ? { scope: "project" }
        : config.storage.cache,
      projectPath,
      home,
      "cache",
    ),
    agentRuns: resolveStorageLocation({ scope: "project" }, projectPath, home, "agent-runs"),
    failures: resolveStorageLocation({ scope: "project" }, projectPath, home, "failures"),
  };
}

function resolveStorageLocation(
  location: StorageLocation,
  projectPath: string,
  home: string,
  defaultSubdir: string,
): string {
  if (location.scope === "custom" && location.path) {
    return location.path;
  }

  // When LINGHUN_DATA_DIR is set and scope is "project", use a project-namespaced
  // subdirectory under the isolated data dir instead of writing to .linghun in the
  // project source directory. This ensures full runtime data isolation for testing,
  // multi-window, and development scenarios.
  const dataRoot = process.env.LINGHUN_DATA_DIR;
  if (location.scope === "project" && dataRoot) {
    const projectNamespace = join("projects", createProjectDataNamespace(projectPath));
    return defaultSubdir
      ? join(dataRoot, projectNamespace, defaultSubdir)
      : join(dataRoot, projectNamespace);
  }

  const root =
    location.scope === "project" ? getProjectConfigDir(projectPath) : getUserDataDir(home);
  return defaultSubdir ? join(root, defaultSubdir) : root;
}

export function createProjectDataNamespace(projectPath: string): string {
  const canonical = canonicalPathForCompare(normalizePathSeparators(resolve(projectPath)), true);
  const hash = createHash("sha256").update(canonical).digest("hex").slice(0, 16);
  const readable = sanitizeProjectNamespaceSegment(basename(resolve(projectPath)) || "project");
  return `${readable}-${hash}`;
}

function sanitizeProjectNamespaceSegment(value: string): string {
  const safe = value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48);
  return safe || "project";
}

export function getProjectSettingsPath(projectPath = process.cwd()): string {
  return join(getProjectConfigDir(projectPath), "settings.json");
}

export function getUserSettingsPath(home = homedir()): string {
  return join(getUserConfigDir(home), "settings.json");
}

export function getProviderEnvPath(home = homedir()): string {
  return join(getUserConfigDir(home), providerEnvFileName);
}

export async function providerEnvExists(home = homedir()): Promise<boolean> {
  try {
    await stat(getProviderEnvPath(home));
    return true;
  } catch {
    return false;
  }
}

export async function ensureProviderEnvTemplate(home = homedir()): Promise<string> {
  const path = getProviderEnvPath(home);
  if (await providerEnvExists(home)) {
    return path;
  }
  await mkdir(dirname(path), { recursive: true });
  const tempPath = createAtomicTempPath(path);
  await writeFile(tempPath, providerEnvTemplate, "utf8");
  try {
    await rename(tempPath, path);
  } catch (error) {
    if (isAtomicReplaceConflict(error) && (await providerEnvExists(home))) {
      await rm(tempPath, { force: true });
      return path;
    }
    await rm(tempPath, { force: true });
    throw error;
  }
  return path;
}

export async function saveProviderEnvSetup(
  setup: ProviderEnvSetup,
  home = homedir(),
): Promise<string> {
  const validated = validateProviderEnvSetup(setup);
  const path = getProviderEnvPath(home);
  await mkdir(dirname(path), { recursive: true });
  const tempPath = createAtomicTempPath(path);
  await writeFile(tempPath, formatProviderEnv(validated), "utf8");
  await replaceProviderEnvFile(tempPath, path);
  return path;
}

function createAtomicTempPath(path: string): string {
  return `${path}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
}

async function replaceProviderEnvFile(tempPath: string, path: string): Promise<void> {
  try {
    await rename(tempPath, path);
    return;
  } catch (error) {
    if (!isAtomicReplaceConflict(error)) {
      await rm(tempPath, { force: true });
      throw error;
    }
  }
  const backupPath = `${path}.${process.pid}.${Date.now()}.${randomUUID()}.bak`;
  try {
    await copyFile(path, backupPath);
    await copyFile(tempPath, path);
  } catch (error) {
    try {
      await copyFile(backupPath, path);
    } catch (restoreError) {
      lastConfigRecoveryWarning = {
        path,
        reason: `provider.env backup restore failed after replace error: ${formatDiagnosticError(restoreError)}`,
        recoveredAt: new Date().toISOString(),
      };
    }
    await rm(tempPath, { force: true });
    await rm(backupPath, { force: true });
    throw error;
  }
  await rm(tempPath, { force: true });
  await rm(backupPath, { force: true });
}

function isAtomicReplaceConflict(error: unknown): boolean {
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  return code === "EEXIST" || code === "EPERM";
}

function formatDiagnosticError(error: unknown): string {
  return error instanceof Error ? error.message.replace(/\s+/g, " ").trim() : String(error);
}

export async function readProviderEnvValues(home = homedir()): Promise<Record<string, string>> {
  const path = getProviderEnvPath(home);
  const raw = await readFile(path, "utf8");
  return parseProviderEnv(raw, path);
}

export function validateProviderEnvSetup(setup: ProviderEnvSetup): ProviderEnvSetup {
  const baseUrl = setup.baseUrl.trim();
  const apiKey = setup.apiKey;
  const model = setup.model.trim();
  const reasoningLevel = normalizeReasoningLevel(setup.reasoningLevel ?? "Medium");
  validateProviderBaseUrl(baseUrl);
  validateProviderApiKey(apiKey);
  validateProviderModel(model);
  return {
    ...setup,
    baseUrl,
    apiKey,
    model,
    reasoningLevel,
    endpointProfile: setup.endpointProfile ?? "chat_completions",
    includeUsage: setup.includeUsage ?? false,
    auxModel: setup.auxModel?.trim(),
  };
}

function validateProviderBaseUrl(value: string): void {
  if (!value) {
    throw new Error("API 地址不能为空。");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("这个地址看起来不对，请填写 root API 地址，例如 https://example.com/v1。");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      "这个地址看起来不对，请填写 http/https root API 地址，例如 https://example.com/v1。",
    );
  }
  if (parsed.search || parsed.hash) {
    throw new Error(
      "API 地址不要包含 query、fragment 或 token 参数，请填写 root API 地址，例如 https://example.com/v1。",
    );
  }
  if (/\/(chat\/completions|responses)\/?$/u.test(parsed.pathname)) {
    throw new Error(
      "API 地址应为 root baseUrl，例如 https://example.com/v1，不要包含 /chat/completions 或 /responses。",
    );
  }
}

function validateProviderApiKey(value: string): void {
  if (!value) {
    throw new Error("API key 不能为空。");
  }
  if (!value.trim()) {
    throw new Error("API key 不能为空。");
  }
  if (value !== value.trim()) {
    throw new Error("API key 首尾不要包含空格，请重新粘贴单行 key。");
  }
  if (/\r|\n/u.test(value)) {
    throw new Error("API key 不能包含换行，请重新粘贴单行 key。");
  }
  if (
    value.startsWith("'") ||
    value.startsWith('"') ||
    value.endsWith("'") ||
    value.endsWith('"')
  ) {
    throw new Error("API key 不需要包裹引号，请去掉首尾引号。");
  }
}

function validateProviderModel(value: string): void {
  if (!value) {
    throw new Error("模型名称不能为空。");
  }
}

function normalizeReasoningLevel(value: string): "Low" | "Medium" | "High" {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return "Medium";
  if (normalized === "low") return "Low";
  if (normalized === "medium") return "Medium";
  if (normalized === "high") return "High";
  throw new Error("推理等级可选 Low / Medium / High，默认 Medium。");
}

function formatProviderEnv(setup: ProviderEnvSetup): string {
  return [
    "# Linghun private provider config. Do not commit this file.",
    "# Shell env variables with the same names have higher priority.",
    `LINGHUN_OPENAI_BASE_URL=${setup.baseUrl}`,
    `LINGHUN_OPENAI_API_KEY=${setup.apiKey}`,
    `LINGHUN_OPENAI_MODEL=${setup.model}`,
    `LINGHUN_OPENAI_ENDPOINT_PROFILE=${setup.endpointProfile ?? "chat_completions"}`,
    `LINGHUN_OPENAI_INCLUDE_USAGE=${setup.includeUsage === true ? "true" : "false"}`,
    `LINGHUN_INFERENCE_LEVEL=${setup.reasoningLevel ?? "Medium"}`,
    `LINGHUN_AUX_MODEL=${setup.auxModel ?? ""}`,
    "",
  ].join("\n");
}

function parseProviderEnv(raw: string, path: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [index, line] of raw.split(/\r?\n/u).entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex <= 0) {
      throw new Error(`${path}:${index + 1} 不是有效的 KEY=VALUE 行。`);
    }
    const key = trimmed.slice(0, equalsIndex).trim();
    if (!providerEnvKeys.has(key)) {
      continue;
    }
    const rawValue = trimmed.slice(equalsIndex + 1).trim();
    values[key] = unquoteProviderEnvValue(rawValue, path, index + 1);
  }
  return values;
}

function unquoteProviderEnvValue(value: string, path: string, line: number): string {
  if (!value) return "";
  const quote = value[0];
  if (quote !== "'" && quote !== '"') {
    return value;
  }
  if (!value.endsWith(quote) || value.length === 1) {
    throw new Error(`${path}:${line} 引号不完整，请检查 provider.env。`);
  }
  return value.slice(1, -1);
}

function providerEnvToConfig(values: Record<string, string>): Partial<LinghunConfig> {
  const hasCompleteShellOpenAiProvider = Boolean(
    process.env.LINGHUN_OPENAI_BASE_URL &&
      process.env.LINGHUN_OPENAI_API_KEY &&
      process.env.LINGHUN_OPENAI_MODEL,
  );
  const hasCompleteShellDeepSeekProvider = Boolean(
    process.env.LINGHUN_DEEPSEEK_BASE_URL &&
      process.env.LINGHUN_DEEPSEEK_API_KEY &&
      process.env.LINGHUN_DEEPSEEK_MODEL,
  );
  const hasMainProviderValue = Boolean(
    hasCompleteShellOpenAiProvider ||
      values.LINGHUN_OPENAI_BASE_URL ||
      values.LINGHUN_OPENAI_API_KEY ||
      values.LINGHUN_OPENAI_MODEL,
  );
  const hasDeepSeekProviderValue = Boolean(
    hasCompleteShellDeepSeekProvider ||
      values.LINGHUN_DEEPSEEK_BASE_URL ||
      values.LINGHUN_DEEPSEEK_API_KEY ||
      values.LINGHUN_DEEPSEEK_MODEL,
  );
  if (!hasMainProviderValue && !hasDeepSeekProviderValue) {
    return {};
  }
  const providerConfig: Record<string, ProviderConfig> = {};
  const openAiProvider: Partial<ProviderConfig> = {};
  if (hasMainProviderValue) {
    validateProviderEnvSetup({
      baseUrl: process.env.LINGHUN_OPENAI_BASE_URL ?? values.LINGHUN_OPENAI_BASE_URL ?? "",
      apiKey: process.env.LINGHUN_OPENAI_API_KEY ?? values.LINGHUN_OPENAI_API_KEY ?? "",
      model: process.env.LINGHUN_OPENAI_MODEL ?? values.LINGHUN_OPENAI_MODEL ?? "",
      reasoningLevel: values.LINGHUN_INFERENCE_LEVEL
        ? normalizeReasoningLevel(values.LINGHUN_INFERENCE_LEVEL)
        : "Medium",
    });
    if (values.LINGHUN_OPENAI_BASE_URL) openAiProvider.baseUrl = values.LINGHUN_OPENAI_BASE_URL;
    if (values.LINGHUN_OPENAI_API_KEY) openAiProvider.apiKey = values.LINGHUN_OPENAI_API_KEY;
    if (values.LINGHUN_OPENAI_MODEL) openAiProvider.model = values.LINGHUN_OPENAI_MODEL;
    openAiProvider.endpointProfile = values.LINGHUN_OPENAI_ENDPOINT_PROFILE
      ? normalizeEndpointProfile(values.LINGHUN_OPENAI_ENDPOINT_PROFILE)
      : "chat_completions";
    if (values.LINGHUN_OPENAI_INCLUDE_USAGE) {
      openAiProvider.includeUsage = parseEnvBoolean(values.LINGHUN_OPENAI_INCLUDE_USAGE);
    }
    openAiProvider.reasoningLevel = values.LINGHUN_INFERENCE_LEVEL
      ? normalizeReasoningLevel(values.LINGHUN_INFERENCE_LEVEL)
      : "Medium";
    providerConfig["openai-compatible"] = {
      type: "openai-compatible",
      model:
        process.env.LINGHUN_OPENAI_MODEL ??
        openAiProvider.model ??
        openAiCompatibleModelPlaceholder,
      ...openAiProvider,
    };
  }
  const deepSeekProvider: Partial<ProviderConfig> = {};
  if (hasDeepSeekProviderValue) {
    if (values.LINGHUN_DEEPSEEK_BASE_URL)
      deepSeekProvider.baseUrl = values.LINGHUN_DEEPSEEK_BASE_URL;
    if (values.LINGHUN_DEEPSEEK_API_KEY) deepSeekProvider.apiKey = values.LINGHUN_DEEPSEEK_API_KEY;
    if (values.LINGHUN_DEEPSEEK_MODEL) deepSeekProvider.model = values.LINGHUN_DEEPSEEK_MODEL;
    providerConfig.deepseek = {
      type: "deepseek",
      model: process.env.LINGHUN_DEEPSEEK_MODEL ?? deepSeekProvider.model ?? defaultDeepSeekModel,
      ...deepSeekProvider,
    };
  }
  const routeProvider = hasCompleteShellOpenAiProvider
    ? "openai-compatible"
    : hasCompleteShellDeepSeekProvider
      ? "deepseek"
      : hasMainProviderValue
        ? "openai-compatible"
        : "deepseek";
  const model =
    routeProvider === "openai-compatible"
      ? (process.env.LINGHUN_OPENAI_MODEL ?? openAiProvider.model)
      : (process.env.LINGHUN_DEEPSEEK_MODEL ?? deepSeekProvider.model);
  return {
    ...(model ? { defaultModel: model } : {}),
    providers: providerConfig,
    modelRoutes: model
      ? {
          defaultModel: model,
          routes: defaultConfig.modelRoutes.routes.map((route) =>
            route.requiredCapabilities.includes("text")
              ? {
                  ...route,
                  provider: routeProvider,
                  primaryModel: model,
                  fallbackModels: [],
                }
              : route,
          ),
        }
      : undefined,
  };
}

async function readProviderEnvConfig(home = homedir()): Promise<Partial<LinghunConfig>> {
  try {
    const values = await readProviderEnvValues(home);
    lastProviderEnvWarning = undefined;
    return providerEnvToConfig(values);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      lastProviderEnvWarning = undefined;
      return providerEnvToConfig({});
    }
    lastProviderEnvWarning = {
      path: getProviderEnvPath(home),
      reason: error instanceof Error ? error.message : String(error),
    };
    return providerEnvToConfig({});
  }
}

function mergeProviderEnvConfig(
  projectSettings: Partial<LinghunConfig>,
  providerEnv: Partial<LinghunConfig>,
  options: { preserveExistingModelRoutes?: boolean } = { preserveExistingModelRoutes: true },
): Partial<LinghunConfig> {
  // D.13J Block 1：记录 provider.env 在本次合并中真正覆盖了哪些字段。
  // doctor 据此对用户说明"~/.linghun/provider.env 已合并/覆盖了 modelRoutes/defaultModel/providers"。
  // 仅记录 provider id 列表，不记录任何 apiKey/baseUrl/model 值。
  const providerEnvProviderIds = providerEnv.providers ? Object.keys(providerEnv.providers) : [];
  const applied =
    Boolean(providerEnv.defaultModel) ||
    Boolean(providerEnv.modelRoutes) ||
    providerEnvProviderIds.length > 0;
  if (applied) {
    const preservedProjectModelRoutes = Boolean(
      options.preserveExistingModelRoutes && projectSettings.modelRoutes,
    );
    lastProviderEnvMerge = {
      applied: true,
      overrodeModelRoutes: Boolean(providerEnv.modelRoutes) && !preservedProjectModelRoutes,
      overrodeDefaultModel:
        Boolean(providerEnv.defaultModel) &&
        Boolean(projectSettings.defaultModel) &&
        !preservedProjectModelRoutes,
      providerIds: providerEnvProviderIds,
    };
  } else {
    lastProviderEnvMerge = {
      applied: false,
      overrodeModelRoutes: false,
      overrodeDefaultModel: false,
      providerIds: [],
    };
  }
  const preserveProjectRoutes = Boolean(
    options.preserveExistingModelRoutes && projectSettings.modelRoutes,
  );
  const envConfig = preserveProjectRoutes ? omitModelRouteOverrides(providerEnv) : providerEnv;
  return {
    ...projectSettings,
    ...envConfig,
    providers: {
      ...projectSettings.providers,
      ...envConfig.providers,
    },
    modelRoutes:
      projectSettings.modelRoutes ??
      providerEnv.modelRoutes ??
      (providerEnv.defaultModel ? undefined : projectSettings.modelRoutes),
  };
}

function omitModelRouteOverrides(config: Partial<LinghunConfig>): Partial<LinghunConfig> {
  const next = { ...config };
  delete next.defaultModel;
  delete next.modelRoutes;
  return next;
}

async function readUserSettings(home = homedir()): Promise<Partial<LinghunConfig>> {
  try {
    const raw = await readFile(getUserSettingsPath(home), "utf8");
    return JSON.parse(raw) as Partial<LinghunConfig>;
  } catch {
    return {};
  }
}

async function loadUserLanguage(home = homedir()): Promise<Language | undefined> {
  const settings = await readUserSettings(home);
  return isLanguage(settings.language) ? settings.language : undefined;
}

function applyUserLanguage(
  projectSettings: Partial<LinghunConfig>,
  userLanguage: Language | undefined,
): Partial<LinghunConfig> {
  if (!userLanguage || isLanguage(projectSettings.language)) {
    return projectSettings;
  }
  return { ...projectSettings, language: userLanguage };
}

function isLanguage(value: unknown): value is Language {
  return value === "zh-CN" || value === "en-US";
}

export async function loadConfig(projectPath = process.cwd()): Promise<LinghunConfig> {
  const settingsPath = getProjectSettingsPath(projectPath);
  const userLanguage = await loadUserLanguage();
  const providerEnv = await readProviderEnvConfig();
  try {
    const raw = await readFile(settingsPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<LinghunConfig>;
    return validateConfig(
      mergeConfig(mergeProviderEnvConfig(applyUserLanguage(parsed, userLanguage), providerEnv)),
    );
  } catch (error) {
    const baseInput = userLanguage ? { language: userLanguage } : {};
    const base = mergeConfig(mergeProviderEnvConfig(baseInput, providerEnv));
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      lastConfigRecoveryWarning = undefined;
      return base;
    }
    lastConfigRecoveryWarning = {
      path: settingsPath,
      reason: error instanceof Error ? error.message : String(error),
      recoveredAt: new Date().toISOString(),
    };
    return base;
  }
}

export async function saveDefaultModel(
  model: string,
  projectPath = process.cwd(),
): Promise<LinghunConfig> {
  const current = await loadConfig(projectPath);
  const resolved = resolveModelSelection(model, current.providers);
  const providerConfig = current.providers[resolved.provider];
  const next: LinghunConfig = {
    ...current,
    defaultModel: resolved.model,
    providers: {
      ...current.providers,
      [resolved.provider]: {
        ...providerConfig,
        model: resolved.model,
      },
    },
  };
  await writeConfig(projectPath, next);
  return next;
}

export async function saveModelRoute(
  role: ModelRole,
  model: string,
  projectPath = process.cwd(),
): Promise<LinghunConfig> {
  const current = await loadConfig(projectPath);
  const resolved = resolveModelSelection(model, current.providers);
  const next: LinghunConfig = {
    ...current,
    modelRoutes: {
      ...current.modelRoutes,
      routes: current.modelRoutes.routes.map((route) =>
        route.role === role
          ? { ...route, provider: resolved.provider, primaryModel: resolved.model }
          : route,
      ),
    },
  };
  await writeConfig(projectPath, next);
  return next;
}

export async function saveExtensionEnablement(
  kind: "skills" | "plugins",
  id: string,
  enabled: boolean,
  projectPath = process.cwd(),
): Promise<LinghunConfig> {
  const current = await loadConfig(projectPath);
  const section = current[kind];
  const disabledIds = enabled
    ? section.disabledIds.filter((item) => item !== id)
    : stableUnique([...section.disabledIds, id]);
  const trustedIds = enabled ? stableUnique([...section.trustedIds, id]) : section.trustedIds;
  const next: LinghunConfig = {
    ...current,
    [kind]: {
      ...section,
      disabledIds,
      trustedIds,
    },
  };
  await writeConfig(projectPath, next);
  return next;
}

export async function resetExtensionTrustForInstall(
  kind: "skills" | "plugins",
  id: string,
  projectPath = process.cwd(),
): Promise<LinghunConfig> {
  const current = await loadConfig(projectPath);
  const section = current[kind];
  const next: LinghunConfig = {
    ...current,
    [kind]: {
      ...section,
      disabledIds: stableUnique([...section.disabledIds, id]),
      trustedIds: section.trustedIds.filter((item) => item !== id),
    },
  };
  await writeConfig(projectPath, next);
  return next;
}

export async function saveMcpServerConfig(
  id: string,
  server: McpServerConfig,
  enabled: boolean,
  projectPath = process.cwd(),
): Promise<LinghunConfig> {
  const current = await loadConfig(projectPath);
  const signature = mcpServerSignature(server);
  const duplicate = Object.entries(current.mcp.servers).find(
    ([existingId, existing]) =>
      existingId !== id && mcpServerSignature(existing) === signature,
  );
  if (duplicate) {
    throw new Error(
      `MCP server duplicate: ${id} has the same transport signature as ${duplicate[0]}. Use the existing MCP server id or change command/url before adding a second entry.`,
    );
  }
  const enabledServers = enabled
    ? stableUnique([...current.mcp.enabledServers, id])
    : current.mcp.enabledServers.filter((item) => item !== id);
  const next: LinghunConfig = {
    ...current,
    mcp: {
      ...current.mcp,
      enabledServers,
      servers: {
        ...current.mcp.servers,
        [id]: server,
      },
    },
  };
  await writeConfig(projectPath, next);
  return next;
}

export function mcpServerSignature(server: McpServerConfig): string {
  if (server.transport === "sse" || server.url) {
    return `url:${(server.url ?? "").trim().replace(/\/+$/u, "")}`;
  }
  return `stdio:${server.command.trim()} ${(server.args ?? []).join(" ")}`.trim();
}

export async function removeMcpServerConfig(
  id: string,
  projectPath = process.cwd(),
): Promise<LinghunConfig> {
  const current = await loadConfig(projectPath);
  const { [id]: _removed, ...servers } = current.mcp.servers;
  const next: LinghunConfig = {
    ...current,
    mcp: {
      ...current.mcp,
      enabledServers: current.mcp.enabledServers.filter((item) => item !== id),
      servers,
    },
  };
  await writeConfig(projectPath, next);
  return next;
}

export async function saveWorkspaceTrust(
  level: WorkspaceTrustLevel,
  projectPath = process.cwd(),
): Promise<LinghunConfig> {
  const current = await loadConfig(projectPath);
  const now = new Date().toISOString();
  const next: LinghunConfig = {
    ...current,
    workspaceTrust: {
      level,
      recorded: true,
      trustedAt: level === "trusted" ? (current.workspaceTrust.trustedAt ?? now) : undefined,
      updatedAt: now,
    },
  };
  await writeConfig(projectPath, next);
  return next;
}

export async function hasRecordedUserLanguage(home = homedir()): Promise<boolean> {
  return (await loadUserLanguage(home)) !== undefined;
}

export async function hasRecordedProjectLanguage(projectPath = process.cwd()): Promise<boolean> {
  try {
    const raw = await readFile(getProjectSettingsPath(projectPath), "utf8");
    const parsed = JSON.parse(raw) as Partial<LinghunConfig>;
    return isLanguage(parsed.language);
  } catch {
    return false;
  }
}

export async function saveUserLanguage(language: Language, home = homedir()): Promise<void> {
  const settingsPath = getUserSettingsPath(home);
  const current = await readUserSettings(home);
  await mkdir(dirname(settingsPath), { recursive: true });
  const tempPath = `${settingsPath}.${process.pid}.${Date.now()}.tmp`;
  const safe = removeSensitiveProjectSettings(current, { includeLanguage: false });
  await writeFile(tempPath, `${JSON.stringify({ ...safe, language }, null, 2)}\n`, "utf8");
  await rename(tempPath, settingsPath);
}

export async function saveProjectLanguage(
  language: Language,
  projectPath = process.cwd(),
): Promise<LinghunConfig> {
  const current = await loadConfig(projectPath);
  const next: LinghunConfig = { ...current, language };
  await writeConfig(projectPath, next, { includeLanguage: true });
  return next;
}

export async function saveLanguage(
  language: Language,
  projectPath = process.cwd(),
): Promise<LinghunConfig> {
  return saveProjectLanguage(language, projectPath);
}

function stableUnique(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function normalizeEndpointProfile(value: string | undefined): EndpointProfile {
  const normalized = value?.trim().toLowerCase().replace(/-/g, "_");
  if (!normalized) return "chat_completions";
  if (normalized === "chat_completions") return "chat_completions";
  if (normalized === "responses") return "responses";
  if (normalized === "anthropic_messages") return "anthropic_messages";
  throw new Error("endpointProfile 可选 chat_completions / responses / anthropic_messages。");
}

function parseEnvBoolean(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

async function writeConfig(
  projectPath: string,
  config: LinghunConfig,
  options: { includeLanguage?: boolean } = {},
): Promise<void> {
  const settingsPath = getProjectSettingsPath(projectPath);
  const hasProjectLanguage = await hasRecordedProjectLanguage(projectPath);
  await mkdir(dirname(settingsPath), { recursive: true });
  const tempPath = `${settingsPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(
    tempPath,
    `${JSON.stringify(
      removeSensitiveProjectSettings(validateConfig(config), {
        includeLanguage: options.includeLanguage === true || hasProjectLanguage,
      }),
      null,
      2,
    )}\n`,
    "utf8",
  );
  await rename(tempPath, settingsPath);
}

function removeSensitiveProjectSettings(
  config: Partial<LinghunConfig>,
  options: { includeLanguage?: boolean } = {},
): Partial<LinghunConfig> {
  const safeConfig: Partial<LinghunConfig> = {
    ...config,
    providers: config.providers
      ? Object.fromEntries(
          Object.entries(config.providers).map(([providerId, provider]) => {
            const { apiKey: _apiKey, ...safeProvider } = provider;
            return [providerId, safeProvider];
          }),
        )
      : config.providers,
  };
  if (options.includeLanguage) {
    return safeConfig;
  }
  const { language: _language, ...projectSettings } = safeConfig;
  return projectSettings;
}

function validateConfig(config: LinghunConfig): LinghunConfig {
  assertRecord(config, "settings");
  if (config.language !== "zh-CN" && config.language !== "en-US") {
    throw new Error("settings.language must be zh-CN or en-US");
  }
  assertNonEmptyString(config.defaultModel, "settings.defaultModel");
  validateProviders(config.providers);
  validateModelRoutes(config.modelRoutes);
  validatePermission(config.permission);
  validateMcp(config.mcp);
  validateStorage(config.storage);
  validateIndex(config.index);
  validatePromptCache(config.promptCache);
  validateExtensions(config.skills, "settings.skills", true);
  validateExtensions(config.plugins, "settings.plugins", true);
  validateExtensions(config.workflows, "settings.workflows", false);
  validateHooks(config.hooks);
  validateRemote(config.remote);
  validateNativeRunner(config.nativeRunner);
  validateWorkspaceTrust(config.workspaceTrust);
  return config;
}

function validateProviders(providers: Record<string, ProviderConfig>): void {
  assertRecord(providers, "settings.providers");
  for (const [providerId, provider] of Object.entries(providers)) {
    assertRecord(provider, `settings.providers.${providerId}`);
    if (provider.type !== "deepseek" && provider.type !== "openai-compatible") {
      throw new Error(`settings.providers.${providerId}.type is invalid`);
    }
    assertNonEmptyString(provider.model, `settings.providers.${providerId}.model`);
    assertOptionalString(provider.baseUrl, `settings.providers.${providerId}.baseUrl`);
    assertOptionalString(provider.apiKey, `settings.providers.${providerId}.apiKey`);
    assertOptionalPositiveNumber(
      provider.maxOutputTokens,
      `settings.providers.${providerId}.maxOutputTokens`,
    );
    assertOptionalBoolean(provider.supportsTools, `settings.providers.${providerId}.supportsTools`);
    if (
      provider.endpointProfile !== undefined &&
      provider.endpointProfile !== "chat_completions" &&
      provider.endpointProfile !== "responses" &&
      provider.endpointProfile !== "anthropic_messages"
    ) {
      throw new Error(`settings.providers.${providerId}.endpointProfile is invalid`);
    }
    if (
      provider.compatibilityProfile !== undefined &&
      provider.compatibilityProfile !== "deepseek" &&
      provider.compatibilityProfile !== "strict_openai_compatible" &&
      provider.compatibilityProfile !== "permissive_openai_compatible"
    ) {
      throw new Error(`settings.providers.${providerId}.compatibilityProfile is invalid`);
    }
    assertOptionalString(
      provider.reasoningLevel,
      `settings.providers.${providerId}.reasoningLevel`,
    );
    assertOptionalBoolean(provider.includeUsage, `settings.providers.${providerId}.includeUsage`);
    // D.13H：Anthropic Context Editing / cache_edits 字段校验。
    // contextEditingEnabled 必须是布尔；anthropicBetaHeaders 若存在必须是 string[]，
    // 允许空字符串（CCB filter(Boolean) 语义保留），由 providers 运行时自行过滤。
    assertOptionalBoolean(
      provider.contextEditingEnabled,
      `settings.providers.${providerId}.contextEditingEnabled`,
    );
    if (provider.anthropicBetaHeaders !== undefined) {
      const headersPath = `settings.providers.${providerId}.anthropicBetaHeaders`;
      if (!Array.isArray(provider.anthropicBetaHeaders)) {
        throw new Error(`${headersPath} must be an array of strings`);
      }
      for (const [headerIndex, headerValue] of provider.anthropicBetaHeaders.entries()) {
        if (typeof headerValue !== "string") {
          throw new Error(`${headersPath}.${headerIndex} must be a string`);
        }
      }
    }
  }
}

function validateModelRoutes(modelRoutes: ModelRouteConfig): void {
  assertRecord(modelRoutes, "settings.modelRoutes");
  assertNonEmptyString(modelRoutes.defaultModel, "settings.modelRoutes.defaultModel");
  if (!Array.isArray(modelRoutes.routes)) {
    throw new Error("settings.modelRoutes.routes must be an array");
  }
  for (const [index, route] of modelRoutes.routes.entries()) {
    const path = `settings.modelRoutes.routes.${index}`;
    assertRecord(route, path);
    assertModelRole(route.role, `${path}.role`);
    assertString(route.provider, `${path}.provider`);
    assertString(route.primaryModel, `${path}.primaryModel`);
    assertStringArray(route.fallbackModels, `${path}.fallbackModels`);
    if (!Array.isArray(route.requiredCapabilities)) {
      throw new Error(`${path}.requiredCapabilities must be an array`);
    }
    for (const [capabilityIndex, capability] of route.requiredCapabilities.entries()) {
      assertCapability(capability, `${path}.requiredCapabilities.${capabilityIndex}`);
    }
    assertOptionalPositiveNumber(route.maxInputTokens, `${path}.maxInputTokens`);
    assertOptionalPositiveNumber(route.maxOutputTokens, `${path}.maxOutputTokens`);
    assertOptionalNonNegativeNumber(route.maxCostCny, `${path}.maxCostCny`);
    assertBoolean(route.allowTools, `${path}.allowTools`);
    assertBoolean(route.allowWrite, `${path}.allowWrite`);
    assertBoolean(route.allowBash, `${path}.allowBash`);
    assertBoolean(route.requireApprovalBeforeRun, `${path}.requireApprovalBeforeRun`);
  }
}

function validatePermission(permission: LinghunConfig["permission"]): void {
  assertRecord(permission, "settings.permission");
  if (
    permission.defaultMode !== "default" &&
    permission.defaultMode !== "auto-review" &&
    permission.defaultMode !== "plan" &&
    permission.defaultMode !== "full-access"
  ) {
    throw new Error("settings.permission.defaultMode is invalid");
  }
}

function validateMcp(mcp: LinghunConfig["mcp"]): void {
  assertRecord(mcp, "settings.mcp");
  assertStringArray(mcp.enabledServers, "settings.mcp.enabledServers");
  assertRecord(mcp.servers, "settings.mcp.servers");
  for (const [serverId, server] of Object.entries(mcp.servers)) {
    const path = `settings.mcp.servers.${serverId}`;
    assertRecord(server, path);
    if (server.transport === "sse" || server.url !== undefined) {
      assertOptionalString(server.command, `${path}.command`);
      assertNonEmptyString(server.url, `${path}.url`);
      if (server.transport !== undefined && server.transport !== "sse") {
        throw new Error(`${path}.transport is invalid`);
      }
    } else {
      assertNonEmptyString(server.command, `${path}.command`);
      if (server.transport !== undefined && server.transport !== "stdio") {
        throw new Error(`${path}.transport is invalid`);
      }
    }
    if (server.args !== undefined) {
      assertStringArray(server.args, `${path}.args`);
    }
    if (server.env !== undefined) {
      assertStringRecord(server.env, `${path}.env`);
    }
    assertOptionalBoolean(server.disabled, `${path}.disabled`);
    assertOptionalString(server.url, `${path}.url`);
    assertOptionalString(server.sourceUrl, `${path}.sourceUrl`);
    assertOptionalString(server.localPath, `${path}.localPath`);
    assertOptionalString(server.ref, `${path}.ref`);
    assertOptionalString(server.commit, `${path}.commit`);
    if (server.scope !== undefined && server.scope !== "project" && server.scope !== "user") {
      throw new Error(`${path}.scope is invalid`);
    }
    assertOptionalString(server.installedAt, `${path}.installedAt`);
    if (
      server.trustLevel !== undefined &&
      server.trustLevel !== "trusted" &&
      server.trustLevel !== "untrusted" &&
      server.trustLevel !== "disabled"
    ) {
      throw new Error(`${path}.trustLevel is invalid`);
    }
    assertOptionalString(server.permissionSummary, `${path}.permissionSummary`);
  }
}

function validateStorage(storage: StorageConfig): void {
  assertRecord(storage, "settings.storage");
  validateStorageLocation(storage.projectData, "settings.storage.projectData");
  validateStorageLocation(storage.userData, "settings.storage.userData");
  validateStorageLocation(storage.sessions, "settings.storage.sessions");
  assertRecord(storage.memory, "settings.storage.memory");
  validateStorageLocation(storage.memory.project, "settings.storage.memory.project");
  validateStorageLocation(storage.memory.user, "settings.storage.memory.user");
  validateStorageLocation(storage.memory.session, "settings.storage.memory.session");
  validateStorageLocation(storage.index, "settings.storage.index");
  validateStorageLocation(storage.logs, "settings.storage.logs");
  validateStorageLocation(storage.jobs, "settings.storage.jobs");
  validateStorageLocation(storage.cache, "settings.storage.cache");
}

function validateStorageLocation(location: StorageLocation, path: string): void {
  assertRecord(location, path);
  if (location.scope !== "project" && location.scope !== "user" && location.scope !== "custom") {
    throw new Error(`${path}.scope is invalid`);
  }
  if (location.scope === "custom") {
    assertNonEmptyString(location.path, `${path}.path`);
    return;
  }
  assertOptionalString(location.path, `${path}.path`);
}

function validateIndex(index: LinghunConfig["index"]): void {
  assertRecord(index, "settings.index");
  assertBoolean(index.enabled, "settings.index.enabled");
  if (index.mode !== "fast" && index.mode !== "moderate" && index.mode !== "full") {
    throw new Error("settings.index.mode is invalid");
  }
  if (index.ignoreFile !== ".linghunignore" && index.ignoreFile !== ".cbmignore") {
    throw new Error("settings.index.ignoreFile is invalid");
  }
}

function validatePromptCache(promptCache: LinghunConfig["promptCache"]): void {
  assertRecord(promptCache, "settings.promptCache");
  assertBoolean(promptCache.enabled, "settings.promptCache.enabled");
  if (promptCache.systemTtl !== "5m" && promptCache.systemTtl !== "1h") {
    throw new Error("settings.promptCache.systemTtl must be '5m' or '1h'");
  }
}

function validateExtensions(
  section: SkillConfig | WorkflowConfig | PluginConfig,
  path: string,
  hasDirs: boolean,
): void {
  assertRecord(section, path);
  assertBoolean(section.enabled, `${path}.enabled`);
  if (hasDirs) {
    const withDirs = section as SkillConfig | PluginConfig;
    assertNonEmptyString(withDirs.projectDir, `${path}.projectDir`);
    assertNonEmptyString(withDirs.userDir, `${path}.userDir`);
    assertStringArray(withDirs.trustedIds, `${path}.trustedIds`);
  }
  assertStringArray(section.disabledIds, `${path}.disabledIds`);
}

function validateHooks(hooks: HookConfig): void {
  assertRecord(hooks, "settings.hooks");
  assertBoolean(hooks.enabled, "settings.hooks.enabled");
  assertPositiveNumber(hooks.timeoutMs, "settings.hooks.timeoutMs");
  assertPositiveNumber(hooks.outputLimitBytes, "settings.hooks.outputLimitBytes");
  assertBoolean(hooks.projectTrusted, "settings.hooks.projectTrusted");
  assertStringArray(hooks.disabledIds, "settings.hooks.disabledIds");
  assertStringArray(hooks.trustedIds, "settings.hooks.trustedIds");
}

function validateRemote(remote: RemoteConfig): void {
  assertRecord(remote, "settings.remote");
  assertBoolean(remote.enabled, "settings.remote.enabled");
  assertRecord(remote.channels, "settings.remote.channels");
  for (const [channelId, channel] of Object.entries(remote.channels)) {
    const path = `settings.remote.channels.${channelId}`;
    assertRecord(channel, path);
    assertBoolean(channel.enabled, `${path}.enabled`);
    if (!["wecom", "enterprise-wechat", "feishu", "lark", "dingtalk"].includes(channel.type)) {
      throw new Error(`${path}.type is invalid`);
    }
    if (!["official_cli", "webhook_mock", "webhook"].includes(channel.transport)) {
      throw new Error(`${path}.transport is invalid`);
    }
    assertOptionalString(channel.endpoint, `${path}.endpoint`);
    assertOptionalString(channel.cliPath, `${path}.cliPath`);
    assertOptionalString(channel.appIdRef, `${path}.appIdRef`);
    assertOptionalString(channel.appSecretRef, `${path}.appSecretRef`);
    assertOptionalString(channel.bindingUserId, `${path}.bindingUserId`);
    assertOptionalString(channel.bindingDeviceId, `${path}.bindingDeviceId`);
    assertOptionalString(channel.signingSecretRef, `${path}.signingSecretRef`);
    assertOptionalString(channel.encryptKeyRef, `${path}.encryptKeyRef`);
    assertOptionalString(channel.verificationTokenRef, `${path}.verificationTokenRef`);
    assertOptionalString(channel.tokenRef, `${path}.tokenRef`);
    if (channel.redactionPolicy !== "summary_only") {
      throw new Error(`${path}.redactionPolicy must be summary_only`);
    }
    assertStringArray(channel.allowedEventTypes, `${path}.allowedEventTypes`);
    for (const [index, eventType] of channel.allowedEventTypes.entries()) {
      if (
        ![
          "approval_request",
          "job_status",
          "job_report",
          "verification_result",
          "failure_summary",
          "stable_point_result",
          "index_result",
        ].includes(eventType)
      ) {
        throw new Error(`${path}.allowedEventTypes.${index} is invalid`);
      }
    }
    assertStringArray(channel.trustedSources, `${path}.trustedSources`);
    if (channel.inboundMode !== undefined) {
      if (!["none", "poll", "callback"].includes(channel.inboundMode)) {
        throw new Error(`${path}.inboundMode is invalid`);
      }
    }
    assertOptionalString(channel.callbackEndpoint, `${path}.callbackEndpoint`);
    assertOptionalPositiveNumber(channel.localBridgePort, `${path}.localBridgePort`);
  }
}

function validateNativeRunner(nativeRunner: NativeRunnerConfig): void {
  assertRecord(nativeRunner, "settings.nativeRunner");
  assertBoolean(nativeRunner.enabled, "settings.nativeRunner.enabled");
  assertOptionalString(nativeRunner.path, "settings.nativeRunner.path");
  assertNonEmptyString(nativeRunner.expectedProtocol, "settings.nativeRunner.expectedProtocol");
  if (
    nativeRunner.source !== "disabled" &&
    nativeRunner.source !== "bundled" &&
    nativeRunner.source !== "optional-package" &&
    nativeRunner.source !== "project-local" &&
    nativeRunner.source !== "custom"
  ) {
    throw new Error("settings.nativeRunner.source is invalid");
  }
  assertPositiveNumber(nativeRunner.timeoutMs, "settings.nativeRunner.timeoutMs");
}

function validateWorkspaceTrust(workspaceTrust: WorkspaceTrustConfig): void {
  assertRecord(workspaceTrust, "settings.workspaceTrust");
  if (
    workspaceTrust.level !== "trusted" &&
    workspaceTrust.level !== "restricted" &&
    workspaceTrust.level !== "untrusted"
  ) {
    throw new Error("settings.workspaceTrust.level is invalid");
  }
  assertBoolean(workspaceTrust.recorded, "settings.workspaceTrust.recorded");
  assertOptionalString(workspaceTrust.trustedAt, "settings.workspaceTrust.trustedAt");
  assertOptionalString(workspaceTrust.updatedAt, "settings.workspaceTrust.updatedAt");
}

function assertRecord(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
}

function assertString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string") {
    throw new Error(`${path} must be a string`);
  }
}

function assertNonEmptyString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
}

function assertOptionalString(value: unknown, path: string): void {
  if (value !== undefined && typeof value !== "string") {
    throw new Error(`${path} must be a string`);
  }
}

function assertBoolean(value: unknown, path: string): asserts value is boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${path} must be a boolean`);
  }
}

function assertOptionalBoolean(value: unknown, path: string): void {
  if (value !== undefined && typeof value !== "boolean") {
    throw new Error(`${path} must be a boolean`);
  }
}

function assertPositiveNumber(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${path} must be a positive number`);
  }
}

function assertOptionalPositiveNumber(value: unknown, path: string): void {
  if (value !== undefined) {
    assertPositiveNumber(value, path);
  }
}

function assertOptionalNonNegativeNumber(value: unknown, path: string): void {
  if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) {
    throw new Error(`${path} must be a non-negative number`);
  }
}

function assertStringArray(value: unknown, path: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${path} must be a string array`);
  }
}

function assertStringRecord(value: unknown, path: string): asserts value is Record<string, string> {
  assertRecord(value, path);
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") {
      throw new Error(`${path}.${key} must be a string`);
    }
  }
}

function assertModelRole(value: unknown, path: string): asserts value is ModelRole {
  if (
    value !== "planner" &&
    value !== "executor" &&
    value !== "reviewer" &&
    value !== "verifier" &&
    value !== "summarizer" &&
    value !== "vision" &&
    value !== "image"
  ) {
    throw new Error(`${path} is invalid`);
  }
}

function assertCapability(value: unknown, path: string): asserts value is ModelCapability {
  if (
    value !== "text" &&
    value !== "tools" &&
    value !== "vision" &&
    value !== "image" &&
    value !== "thinking" &&
    value !== "promptCache"
  ) {
    throw new Error(`${path} is invalid`);
  }
}

export async function ensureConfigDirs(projectPath = process.cwd()): Promise<string[]> {
  const dirs = [getUserConfigDir(), getProjectConfigDir(projectPath)];
  await Promise.all(dirs.map((dir) => mkdir(dir, { recursive: true })));
  return dirs;
}

function mergeModelRoutes(inputRoutes: RoleModelRoute[] | undefined): RoleModelRoute[] {
  if (!inputRoutes) {
    return defaultConfig.modelRoutes.routes;
  }
  return defaultConfig.modelRoutes.routes.map((route) => {
    const override = inputRoutes.find((item) => item.role === route.role);
    return override ? { ...route, ...override } : route;
  });
}

function cleanProviderOverride(
  provider: ProviderConfig | undefined,
  placeholderModel?: string,
): ProviderConfig | undefined {
  if (!provider) {
    return provider;
  }
  return Object.fromEntries(
    Object.entries(provider).filter(([key, value]) => {
      if ((key === "baseUrl" || key === "apiKey") && (value === undefined || value === "")) {
        return false;
      }
      if (key === "model" && value === placeholderModel) {
        return false;
      }
      return true;
    }),
  ) as ProviderConfig;
}

function normalizePermissionConfig(
  permission: Partial<LinghunConfig["permission"]> | undefined,
): LinghunConfig["permission"] {
  const defaultMode = permission?.defaultMode;
  if (defaultMode === undefined) return defaultConfig.permission;
  if (!isRawPermissionMode(defaultMode)) {
    return { ...defaultConfig.permission, defaultMode: defaultMode as PermissionMode };
  }
  return {
    ...defaultConfig.permission,
    ...permission,
    defaultMode: normalizePermissionMode(defaultMode),
  };
}

function mergeRemoteChannels(
  channels: Partial<Record<string, Partial<RemoteChannelConfig>>> | undefined,
): Record<string, RemoteChannelConfig> {
  const merged: Record<string, RemoteChannelConfig> = { ...defaultConfig.remote.channels };
  for (const [channelId, channel] of Object.entries(channels ?? {})) {
    const defaultChannel = defaultConfig.remote.channels[channelId];
    merged[channelId] = defaultChannel
      ? ({ ...defaultChannel, ...channel } as RemoteChannelConfig)
      : (channel as RemoteChannelConfig);
  }
  return merged;
}

function mergeRemoteConfig(remote: Partial<RemoteConfig> | undefined): RemoteConfig {
  return {
    ...defaultConfig.remote,
    ...remote,
    channels: mergeRemoteChannels(remote?.channels),
  };
}

function mergeNativeRunnerConfig(
  nativeRunner: Partial<NativeRunnerConfig> | undefined,
): NativeRunnerConfig {
  return {
    ...defaultConfig.nativeRunner,
    ...nativeRunner,
  };
}

function mergeWorkspaceTrustConfig(
  workspaceTrust: Partial<WorkspaceTrustConfig> | undefined,
): WorkspaceTrustConfig {
  if (!workspaceTrust) {
    return defaultConfig.workspaceTrust;
  }
  return {
    ...defaultConfig.workspaceTrust,
    ...workspaceTrust,
    recorded: workspaceTrust.recorded ?? true,
  };
}

function mergeConfig(input: Partial<LinghunConfig>): LinghunConfig {
  const deepseekProvider = cleanProviderOverride(input.providers?.deepseek);
  const openAiCompatibleProvider = cleanProviderOverride(
    input.providers?.["openai-compatible"],
    process.env.LINGHUN_OPENAI_MODEL ? openAiCompatibleModelPlaceholder : undefined,
  );

  return {
    ...defaultConfig,
    ...input,
    defaultModel:
      process.env.LINGHUN_DEFAULT_MODEL ?? input.defaultModel ?? defaultConfig.defaultModel,
    providers: {
      ...defaultConfig.providers,
      ...input.providers,
      deepseek: {
        ...defaultConfig.providers.deepseek,
        ...deepseekProvider,
        baseUrl:
          process.env.LINGHUN_DEEPSEEK_BASE_URL ??
          deepseekProvider?.baseUrl ??
          defaultConfig.providers.deepseek.baseUrl,
        apiKey:
          process.env.LINGHUN_DEEPSEEK_API_KEY ??
          deepseekProvider?.apiKey ??
          defaultConfig.providers.deepseek.apiKey,
        model:
          process.env.LINGHUN_DEEPSEEK_MODEL ??
          deepseekProvider?.model ??
          defaultConfig.providers.deepseek.model,
      },
      "openai-compatible": {
        ...defaultConfig.providers["openai-compatible"],
        ...openAiCompatibleProvider,
        baseUrl:
          process.env.LINGHUN_OPENAI_BASE_URL ??
          openAiCompatibleProvider?.baseUrl ??
          defaultConfig.providers["openai-compatible"].baseUrl,
        apiKey:
          process.env.LINGHUN_OPENAI_API_KEY ??
          openAiCompatibleProvider?.apiKey ??
          defaultConfig.providers["openai-compatible"].apiKey,
        model:
          process.env.LINGHUN_OPENAI_MODEL ??
          openAiCompatibleProvider?.model ??
          defaultConfig.providers["openai-compatible"].model,
        endpointProfile: normalizeEndpointProfile(
          process.env.LINGHUN_OPENAI_ENDPOINT_PROFILE ??
            openAiCompatibleProvider?.endpointProfile ??
            defaultConfig.providers["openai-compatible"].endpointProfile,
        ),
        reasoningLevel:
          process.env.LINGHUN_INFERENCE_LEVEL ??
          openAiCompatibleProvider?.reasoningLevel ??
          defaultConfig.providers["openai-compatible"].reasoningLevel,
        includeUsage:
          process.env.LINGHUN_OPENAI_INCLUDE_USAGE !== undefined
            ? parseEnvBoolean(process.env.LINGHUN_OPENAI_INCLUDE_USAGE)
            : (openAiCompatibleProvider?.includeUsage ??
              defaultConfig.providers["openai-compatible"].includeUsage),
      },
    },
    modelRoutes: {
      ...defaultConfig.modelRoutes,
      ...input.modelRoutes,
      routes: mergeModelRoutes(input.modelRoutes?.routes),
    },
    permission: normalizePermissionConfig(input.permission),
    mcp: {
      ...defaultConfig.mcp,
      ...input.mcp,
      servers: {
        ...defaultConfig.mcp.servers,
        ...input.mcp?.servers,
      },
    },
    storage: {
      ...defaultConfig.storage,
      ...input.storage,
      memory: {
        ...defaultConfig.storage.memory,
        ...input.storage?.memory,
      },
    },
    index: {
      ...defaultConfig.index,
      ...input.index,
    },
    promptCache: {
      ...defaultConfig.promptCache,
      ...input.promptCache,
    },
    skills: {
      ...defaultConfig.skills,
      ...input.skills,
    },
    workflows: {
      ...defaultConfig.workflows,
      ...input.workflows,
    },
    hooks: {
      ...defaultConfig.hooks,
      ...input.hooks,
    },
    plugins: {
      ...defaultConfig.plugins,
      ...input.plugins,
    },
    remote: mergeRemoteConfig(input.remote),
    nativeRunner: mergeNativeRunnerConfig(input.nativeRunner),
    workspaceTrust: mergeWorkspaceTrustConfig(input.workspaceTrust),
  };
}
