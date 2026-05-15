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

export type LinghunConfig = {
  language: Language;
  defaultModel: string;
  providers: Record<string, ProviderConfig>;
  permission: {
    defaultMode: PermissionMode;
  };
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
  permission: {
    defaultMode: "default",
  },
};

export function getUserConfigDir(home = homedir()): string {
  return join(home, ".linghun");
}

export function getProjectConfigDir(projectPath = process.cwd()): string {
  return join(projectPath, ".linghun");
}

export function getUserDataDir(home = homedir()): string {
  return join(home, ".linghun", "data");
}

export function getSessionRootDir(home = homedir()): string {
  return join(getUserDataDir(home), "sessions");
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
  await mkdir(getProjectConfigDir(projectPath), { recursive: true });
  await writeFile(
    getProjectSettingsPath(projectPath),
    `${JSON.stringify(next, null, 2)}\n`,
    "utf8",
  );
  return next;
}

export async function ensureConfigDirs(projectPath = process.cwd()): Promise<string[]> {
  const dirs = [getUserConfigDir(), getProjectConfigDir(projectPath)];
  await Promise.all(dirs.map((dir) => mkdir(dir, { recursive: true })));
  return dirs;
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
    permission: {
      ...defaultConfig.permission,
      ...input.permission,
    },
  };
}
