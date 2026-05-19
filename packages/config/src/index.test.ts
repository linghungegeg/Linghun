import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureConfigDirs,
  getProjectConfigDir,
  getProjectSettingsPath,
  getSessionRootDir,
  getUserDataDir,
  lastConfigRecoveryWarning,
  loadConfig,
  resolveStoragePaths,
  saveDefaultModel,
  saveExtensionEnablement,
  saveModelRoute,
} from "./index.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

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

  it("loads Phase 13 storage, MCP, index, and model route defaults", async () => {
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
    expect(config.skills.projectDir).toBe(".linghun/skills");
    expect(config.skills.disabledIds).toEqual([]);
    expect(config.workflows.enabled).toBe(true);
    expect(config.hooks.enabled).toBe(false);
    expect(config.hooks.timeoutMs).toBe(5_000);
    expect(config.plugins.projectDir).toBe(".linghun/plugins");
    expect(config.plugins.disabledIds).toEqual([]);
    expect(config.modelRoutes.routes.map((route) => route.role)).toEqual([
      "planner",
      "executor",
      "reviewer",
      "verifier",
      "summarizer",
      "vision",
      "image",
    ]);
    expect(config.modelRoutes.routes.find((route) => route.role === "planner")?.allowWrite).toBe(
      false,
    );
    expect(config.modelRoutes.routes.find((route) => route.role === "executor")?.allowWrite).toBe(
      true,
    );
    expect(config.modelRoutes.routes.find((route) => route.role === "verifier")?.allowBash).toBe(
      true,
    );
    expect(config.modelRoutes.routes.find((route) => route.role === "vision")?.provider).toBe("");
    expect(
      config.modelRoutes.routes.find((route) => route.role === "image")?.requiredCapabilities,
    ).toEqual(["image"]);
  });

  it("saves and loads a Phase 13 role route", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-config-"));

    const saved = await saveModelRoute("planner", "deepseek-v4-pro", project);
    const loaded = await loadConfig(project);

    expect(saved.modelRoutes.routes.find((route) => route.role === "planner")?.primaryModel).toBe(
      "deepseek-v4-pro",
    );
    expect(loaded.modelRoutes.routes.find((route) => route.role === "planner")?.provider).toBe(
      "deepseek",
    );
    expect(loaded.modelRoutes.routes.find((route) => route.role === "vision")?.primaryModel).toBe(
      "",
    );
  });

  it("allows env to override default DeepSeek model and Linghun default model", async () => {
    vi.stubEnv("LINGHUN_DEEPSEEK_MODEL", "deepseek-v4-pro");
    vi.stubEnv("LINGHUN_DEFAULT_MODEL", "gpt-5.5");
    vi.resetModules();
    const { defaultConfig: envDefaultConfig, loadConfig: envLoadConfig } = await import(
      "./index.js"
    );
    const project = await mkdtemp(join(tmpdir(), "linghun-config-"));
    const config = await envLoadConfig(project);

    expect(envDefaultConfig.providers.deepseek.model).toBe("deepseek-v4-pro");
    expect(config.providers.deepseek.model).toBe("deepseek-v4-pro");
    expect(envDefaultConfig.defaultModel).toBe("gpt-5.5");
    expect(config.defaultModel).toBe("gpt-5.5");
  });

  it("keeps LINGHUN_OPENAI_MODEL when project settings contain the placeholder model", async () => {
    vi.stubEnv("LINGHUN_OPENAI_BASE_URL", "https://example.invalid/v1");
    vi.stubEnv("LINGHUN_OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("LINGHUN_OPENAI_MODEL", "gpt-5.5");
    vi.resetModules();
    const { getProjectConfigDir: envGetProjectConfigDir, loadConfig: envLoadConfig } = await import(
      "./index.js"
    );
    const project = await mkdtemp(join(tmpdir(), "linghun-config-"));
    await mkdir(envGetProjectConfigDir(project), { recursive: true });
    await writeFile(
      join(envGetProjectConfigDir(project), "settings.json"),
      JSON.stringify({
        providers: {
          "openai-compatible": {
            type: "openai-compatible",
            baseUrl: "",
            apiKey: "",
            model: "openai-compatible-model",
          },
        },
      }),
      "utf8",
    );

    const config = await envLoadConfig(project);

    expect(config.providers["openai-compatible"]?.baseUrl).toBe("https://example.invalid/v1");
    expect(config.providers["openai-compatible"]?.apiKey).toBe("test-openai-key");
    expect(config.providers["openai-compatible"]?.model).toBe("gpt-5.5");
  });

  it("loads openai endpoint profile and inference level from env", async () => {
    vi.stubEnv("LINGHUN_OPENAI_ENDPOINT_PROFILE", "responses");
    vi.stubEnv("LINGHUN_INFERENCE_LEVEL", "Medium");
    vi.stubEnv("LINGHUN_OPENAI_MODEL", "gpt-5.5");
    vi.resetModules();
    const { loadConfig: envLoadConfig } = await import("./index.js");
    const project = await mkdtemp(join(tmpdir(), "linghun-config-"));

    const config = await envLoadConfig(project);

    expect(config.providers["openai-compatible"]?.endpointProfile).toBe("responses");
    expect(config.providers["openai-compatible"]?.reasoningLevel).toBe("Medium");
  });

  it("persists Phase 14 extension enablement and trust", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-config-"));

    await saveExtensionEnablement("skills", "bug-helper", false, project);
    const disabled = await loadConfig(project);
    await saveExtensionEnablement("skills", "bug-helper", true, project);
    await saveExtensionEnablement("plugins", "local-tools", true, project);
    const enabled = await loadConfig(project);

    expect(disabled.skills.disabledIds).toEqual(["bug-helper"]);
    expect(enabled.skills.disabledIds).toEqual([]);
    expect(enabled.skills.trustedIds).toEqual(["bug-helper"]);
    expect(enabled.plugins.trustedIds).toEqual(["local-tools"]);
  });

  it("recovers from damaged settings with a visible warning", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-config-"));
    await mkdir(getProjectConfigDir(project), { recursive: true });
    await writeFile(getProjectSettingsPath(project), "{ damaged", "utf8");

    const config = await loadConfig(project);

    expect(config.defaultModel).toBeTruthy();
    expect(lastConfigRecoveryWarning?.path).toBe(getProjectSettingsPath(project));
    expect(lastConfigRecoveryWarning?.reason).toContain("JSON");
  });

  it("recovers from invalid nested settings shape with a visible warning", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-config-"));
    await mkdir(getProjectConfigDir(project), { recursive: true });
    await writeFile(
      getProjectSettingsPath(project),
      JSON.stringify({
        providers: { deepseek: { type: "deepseek", model: "deepseek-v4-flash" } },
        modelRoutes: { routes: [{ role: "executor", allowTools: "yes" }] },
      }),
      "utf8",
    );

    const config = await loadConfig(project);

    expect(config.defaultModel).toBeTruthy();
    expect(lastConfigRecoveryWarning?.path).toBe(getProjectSettingsPath(project));
    expect(lastConfigRecoveryWarning?.reason).toContain("settings.modelRoutes");
  });
});
