import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ensureConfigDirs,
  getProjectConfigDir,
  getProjectSettingsPath,
  getSessionRootDir,
  getUserDataDir,
  loadConfig,
  resolveStoragePaths,
  saveDefaultModel,
} from "./index.js";

describe("config directories", () => {
  it("uses .linghun under the project", () => {
    expect(getProjectConfigDir("/tmp/project").replaceAll("\\", "/")).toBe("/tmp/project/.linghun");
  });

  it("creates the project config directory", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-config-"));
    const dirs = await ensureConfigDirs(project);

    expect(dirs.some((dir) => dir.endsWith(".linghun"))).toBe(true);
  });

  it("uses the user data directory for sessions", () => {
    expect(getUserDataDir("/tmp/home").replaceAll("\\", "/")).toBe("/tmp/home/.linghun/data");
    expect(getSessionRootDir("/tmp/home").replaceAll("\\", "/")).toBe(
      "/tmp/home/.linghun/data/sessions",
    );
  });

  it("saves and loads the Phase 03 default model in project settings", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-config-"));
    const config = await saveDefaultModel("deepseek-v4-pro", project);
    const loaded = await loadConfig(project);
    const raw = await readFile(getProjectSettingsPath(project), "utf8");

    expect(config.defaultModel).toBe("deepseek-v4-pro");
    expect(loaded.providers.deepseek.model).toBe("deepseek-v4-pro");
    expect(raw).toContain("deepseek-v4-pro");
  });

  it("loads Phase 11 storage, MCP, and index defaults", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-config-"));
    const config = await loadConfig(project);
    const paths = resolveStoragePaths(config, project, "/tmp/home");

    expect(config.mcp.enabledServers).toContain("codebase-memory");
    expect(config.mcp.servers["codebase-memory"]?.command).toBeTruthy();
    expect(config.storage.sessions.scope).toBe("user");
    expect(paths.memoryProject.replaceAll("\\", "/")).toContain("/.linghun/memory");
    expect(paths.memoryUser.replaceAll("\\", "/")).toBe("/tmp/home/.linghun/data/memory");
    expect(paths.sessions.replaceAll("\\", "/")).toBe("/tmp/home/.linghun/data/sessions");
    expect(config.index.enabled).toBe(true);
    expect(config.index.mode).toBe("fast");
    expect(config.index.ignoreFile).toBe(".linghunignore");
  });
});
