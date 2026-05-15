import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";

export type ProjectIdentity = {
  projectId: string;
  projectPath: string;
  projectName: string;
};

export function identifyProject(projectPath = process.cwd()): ProjectIdentity {
  const resolvedPath = resolve(projectPath);
  const normalizedPath = normalizeProjectPath(resolvedPath);
  const hash = createHash("sha256").update(normalizedPath).digest("hex").slice(0, 16);
  const projectName = basename(resolvedPath) || "project";

  return {
    projectId: hash,
    projectPath: resolvedPath,
    projectName,
  };
}

export function normalizeProjectPath(projectPath: string): string {
  return resolve(projectPath).replaceAll("\\", "/").toLowerCase();
}
