import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Language, PermissionMode } from "@linghun/shared";

export type ProviderConfig = {
  type: "openai-compatible" | "deepseek";
  baseUrl?: string;
  apiKey?: string;
  model: string;
  maxOutputTokens?: number;
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

export const defaultModelRoutes: ModelRouteConfig = {
  defaultModel: "deepseek-v4-flash",
  routes: [
    {
      role: "planner",
      provider: "deepseek",
      primaryModel: "deepseek-v4-flash",
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
      primaryModel: "deepseek-v4-flash",
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
      primaryModel: "deepseek-v4-flash",
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
      primaryModel: "deepseek-v4-flash",
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
  defaultModel: "deepseek-v4-flash",
  providers: {
    deepseek: {
      type: "deepseek",
      baseUrl: process.env.LINGHUN_DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1",
      apiKey: process.env.LINGHUN_DEEPSEEK_API_KEY,
      model: "deepseek-v4-flash",
      maxOutputTokens: 8_192,
    },
    "openai-compatible": {
      type: "openai-compatible",
      baseUrl: process.env.LINGHUN_OPENAI_BASE_URL,
      apiKey: process.env.LINGHUN_OPENAI_API_KEY,
      model: process.env.LINGHUN_OPENAI_MODEL ?? "openai-compatible-model",
      maxOutputTokens: 4_096,
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
    return mergeConfig(parsed);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return defaultConfig;
    }
    throw error;
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

function stableUnique(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

async function writeConfig(projectPath: string, config: LinghunConfig): Promise<void> {
  await mkdir(getProjectConfigDir(projectPath), { recursive: true });
  await writeFile(
    getProjectSettingsPath(projectPath),
    `${JSON.stringify(config, null, 2)}\n`,
    "utf8",
  );
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

function mergeConfig(input: Partial<LinghunConfig>): LinghunConfig {
  return {
    ...defaultConfig,
    ...input,
    providers: {
      ...defaultConfig.providers,
      ...input.providers,
      deepseek: {
        ...defaultConfig.providers.deepseek,
        ...input.providers?.deepseek,
      },
      "openai-compatible": {
        ...defaultConfig.providers["openai-compatible"],
        ...input.providers?.["openai-compatible"],
      },
    },
    modelRoutes: {
      ...defaultConfig.modelRoutes,
      ...input.modelRoutes,
      routes: mergeModelRoutes(input.modelRoutes?.routes),
    },
    permission: {
      ...defaultConfig.permission,
      ...input.permission,
    },
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
