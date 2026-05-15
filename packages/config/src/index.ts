import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Language, PermissionMode } from "@linghun/shared";

export type LinghunConfig = {
  language: Language;
  defaultModel: string;
  permission: {
    defaultMode: PermissionMode;
  };
};

export const defaultConfig: LinghunConfig = {
  language: "zh-CN",
  defaultModel: "not-configured",
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

export async function ensureConfigDirs(projectPath = process.cwd()): Promise<string[]> {
  const dirs = [getUserConfigDir(), getProjectConfigDir(projectPath)];
  await Promise.all(dirs.map((dir) => mkdir(dir, { recursive: true })));
  return dirs;
}
