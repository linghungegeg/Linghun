import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  type Language,
  type PermissionMode,
  isRawPermissionMode,
  normalizePermissionMode,
} from "@linghun/shared";

export type EndpointProfile = "chat_completions" | "responses";
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

export type McpServerConfig = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
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

export type ConfigRecoveryWarning = {
  path: string;
  reason: string;
  recoveredAt: string;
};

export let lastConfigRecoveryWarning: ConfigRecoveryWarning | undefined;

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
  skills: SkillConfig;
  workflows: WorkflowConfig;
  hooks: HookConfig;
  plugins: PluginConfig;
};

const defaultDeepSeekModel = process.env.LINGHUN_DEEPSEEK_MODEL ?? "deepseek-v4-flash";
const defaultLinghunModel = process.env.LINGHUN_DEFAULT_MODEL ?? defaultDeepSeekModel;
const openAiCompatibleModelPlaceholder = "openai-compatible-model";
const defaultOpenAiEndpointProfile = normalizeEndpointProfile(
  process.env.LINGHUN_OPENAI_ENDPOINT_PROFILE,
);
const defaultReasoningLevel = process.env.LINGHUN_INFERENCE_LEVEL;

export const defaultModelRoutes: ModelRouteConfig = {
  defaultModel: defaultLinghunModel,
  routes: [
    {
      role: "planner",
      provider: "deepseek",
      primaryModel: defaultDeepSeekModel,
      fallbackModels: ["deepseek-v4-pro"],
      requiredCapabilities: ["text"],
      maxOutputTokens: 8_192,
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
      fallbackModels: ["deepseek-v4-pro"],
      requiredCapabilities: ["text"],
      maxOutputTokens: 8_192,
      allowTools: true,
      allowWrite: true,
      allowBash: true,
      requireApprovalBeforeRun: true,
    },
    {
      role: "reviewer",
      provider: "deepseek",
      primaryModel: defaultDeepSeekModel,
      fallbackModels: ["deepseek-v4-pro"],
      requiredCapabilities: ["text"],
      maxOutputTokens: 8_192,
      allowTools: true,
      allowWrite: false,
      allowBash: false,
      requireApprovalBeforeRun: false,
    },
    {
      role: "verifier",
      provider: "deepseek",
      primaryModel: defaultDeepSeekModel,
      fallbackModels: ["deepseek-v4-pro"],
      requiredCapabilities: ["text"],
      maxOutputTokens: 8_192,
      allowTools: true,
      allowWrite: false,
      allowBash: true,
      requireApprovalBeforeRun: false,
    },
    {
      role: "summarizer",
      provider: "deepseek",
      primaryModel: "deepseek-v4-flash",
      fallbackModels: [],
      requiredCapabilities: ["text"],
      maxOutputTokens: 2_048,
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
      baseUrl: process.env.LINGHUN_DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1",
      apiKey: process.env.LINGHUN_DEEPSEEK_API_KEY,
      model: defaultDeepSeekModel,
      maxOutputTokens: 8_192,
    },
    "openai-compatible": {
      type: "openai-compatible",
      baseUrl: process.env.LINGHUN_OPENAI_BASE_URL,
      apiKey: process.env.LINGHUN_OPENAI_API_KEY,
      model: process.env.LINGHUN_OPENAI_MODEL ?? openAiCompatibleModelPlaceholder,
      maxOutputTokens: 4_096,
      endpointProfile: defaultOpenAiEndpointProfile,
      compatibilityProfile: "strict_openai_compatible",
      reasoningLevel: defaultReasoningLevel,
      includeUsage: process.env.LINGHUN_OPENAI_INCLUDE_USAGE === "true",
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
        command: process.env.LINGHUN_CODEBASE_MEMORY_MCP ?? "codebase-memory-mcp",
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
};

export function getUserConfigDir(home = homedir()): string {
  return join(home, ".linghun");
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
    cache: resolveStorageLocation(config.storage.cache, projectPath, home, "cache"),
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
  const root =
    location.scope === "project" ? getProjectConfigDir(projectPath) : getUserDataDir(home);
  return defaultSubdir ? join(root, defaultSubdir) : root;
}

export function getProjectSettingsPath(projectPath = process.cwd()): string {
  return join(getProjectConfigDir(projectPath), "settings.json");
}

export async function loadConfig(projectPath = process.cwd()): Promise<LinghunConfig> {
  const settingsPath = getProjectSettingsPath(projectPath);
  try {
    const raw = await readFile(settingsPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<LinghunConfig>;
    return validateConfig(mergeConfig(parsed));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      lastConfigRecoveryWarning = undefined;
      return defaultConfig;
    }
    lastConfigRecoveryWarning = {
      path: settingsPath,
      reason: error instanceof Error ? error.message : String(error),
      recoveredAt: new Date().toISOString(),
    };
    return defaultConfig;
  }
}

export async function saveDefaultModel(
  model: string,
  projectPath = process.cwd(),
  maxOutputTokens?: number,
): Promise<LinghunConfig> {
  const current = await loadConfig(projectPath);
  const next: LinghunConfig = {
    ...current,
    defaultModel: model,
    providers: {
      ...current.providers,
      deepseek: {
        ...current.providers.deepseek,
        model,
        maxOutputTokens: maxOutputTokens ?? current.providers.deepseek.maxOutputTokens,
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
  const provider = inferProviderForModel(model, current.providers);
  const next: LinghunConfig = {
    ...current,
    modelRoutes: {
      ...current.modelRoutes,
      routes: current.modelRoutes.routes.map((route) =>
        route.role === role ? { ...route, provider, primaryModel: model } : route,
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

function stableUnique(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function normalizeEndpointProfile(value: string | undefined): EndpointProfile {
  return value === "responses" ? "responses" : "chat_completions";
}

async function writeConfig(projectPath: string, config: LinghunConfig): Promise<void> {
  const settingsPath = getProjectSettingsPath(projectPath);
  await mkdir(dirname(settingsPath), { recursive: true });
  const tempPath = `${settingsPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(
    tempPath,
    `${JSON.stringify(removeSensitiveProjectSettings(validateConfig(config)), null, 2)}\n`,
    "utf8",
  );
  await rename(tempPath, settingsPath);
}

function removeSensitiveProjectSettings(config: LinghunConfig): LinghunConfig {
  return {
    ...config,
    providers: Object.fromEntries(
      Object.entries(config.providers).map(([providerId, provider]) => {
        const { apiKey: _apiKey, ...safeProvider } = provider;
        return [providerId, safeProvider];
      }),
    ),
  };
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
  validateExtensions(config.skills, "settings.skills", true);
  validateExtensions(config.plugins, "settings.plugins", true);
  validateExtensions(config.workflows, "settings.workflows", false);
  validateHooks(config.hooks);
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
      provider.endpointProfile !== "responses"
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
    assertNonEmptyString(server.command, `${path}.command`);
    if (server.args !== undefined) {
      assertStringArray(server.args, `${path}.args`);
    }
    if (server.env !== undefined) {
      assertStringRecord(server.env, `${path}.env`);
    }
    assertOptionalBoolean(server.disabled, `${path}.disabled`);
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

function inferProviderForModel(model: string, providers: Record<string, ProviderConfig>): string {
  for (const [providerId, provider] of Object.entries(providers)) {
    if (provider.model === model) {
      return providerId;
    }
  }
  return model.startsWith("deepseek-") ? "deepseek" : "openai-compatible";
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
  };
}
