import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createProjectDataNamespace,
  defaultConfig,
  ensureConfigDirs,
  ensureProviderEnvTemplate,
  getProjectConfigDir,
  getProjectSettingsPath,
  getProviderEnvPath,
  getSessionRootDir,
  getUserDataDir,
  lastConfigRecoveryWarning,
  lastProviderEnvWarning,
  loadConfig,
  providerEnvExists,
  readProviderEnvValues,
  removeMcpServerConfig,
  resetExtensionTrustForInstall,
  resolveModelSelection,
  resolveStoragePaths,
  saveDefaultModel,
  saveExtensionEnablement,
  saveMcpServerConfig,
  saveModelRoute,
  saveProviderEnvSetup,
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

  it("keeps Windows path inputs with Chinese characters, spaces, and drive casing", () => {
    const project = process.platform === "win32" ? "g:\\灵魂 项目 空格" : "/tmp/灵魂 项目 空格";
    const paths = resolveStoragePaths(defaultConfig, project, "/tmp/home");
    const normalizedConfig = getProjectConfigDir(project).replaceAll("\\", "/");
    const normalizedSettings = getProjectSettingsPath(project).replaceAll("\\", "/");
    const normalizedProjectData = paths.projectData.replaceAll("\\", "/");

    expect(normalizedConfig).toContain("灵魂 项目 空格/.linghun");
    expect(normalizedSettings).toContain("灵魂 项目 空格/.linghun/settings.json");
    expect(normalizedProjectData).toContain("灵魂 项目 空格/.linghun");
    if (process.platform === "win32") {
      expect(paths.projectData.startsWith("g:\\")).toBe(true);
    }
  });

  it("respects long custom user data paths instead of forcing C drive storage", () => {
    const customDataRoot =
      process.platform === "win32"
        ? `G:\\linghun data 空格\\nested\\${"long-segment-".repeat(12)}`
        : join(tmpdir(), "linghun data 空格", "nested", "long-segment-".repeat(12));
    vi.stubEnv("LINGHUN_DATA_DIR", customDataRoot);

    const paths = resolveStoragePaths(defaultConfig, "/tmp/project", "/tmp/home");

    expect(getUserDataDir("/tmp/home")).toBe(customDataRoot);
    expect(getSessionRootDir("/tmp/home")).toBe(join(customDataRoot, "sessions"));
    expect(paths.sessions).toBe(join(customDataRoot, "sessions"));
    expect(paths.logs).toBe(join(customDataRoot, "logs"));
    expect(paths.jobs).toBe(join(customDataRoot, "jobs"));
    if (process.platform === "win32") {
      expect(paths.sessions.startsWith("G:\\")).toBe(true);
    }
  });

  it("saves and loads the real DeepSeek default model in project settings", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-config-"));
    const config = await saveDefaultModel("deepseek-reasoner", project);
    const loaded = await loadConfig(project);
    const raw = await readFile(getProjectSettingsPath(project), "utf8");

    expect(config.defaultModel).toBe("deepseek-reasoner");
    expect(loaded.providers.deepseek.model).toBe("deepseek-reasoner");
    expect(raw).toContain("deepseek-reasoner");
  });

  it("normalizes legacy DeepSeek aliases before saving default model", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-config-"));
    const config = await saveDefaultModel("deepseek-v4-pro", project);
    const raw = await readFile(getProjectSettingsPath(project), "utf8");

    expect(config.defaultModel).toBe("deepseek-reasoner");
    expect(config.providers.deepseek.model).toBe("deepseek-reasoner");
    expect(raw).toContain("deepseek-reasoner");
    expect(raw).not.toContain("deepseek-v4-pro");
  });

  it("rejects invalid default model before writing project settings", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-config-"));
    await saveDefaultModel("deepseek-chat", project);
    const before = await readFile(getProjectSettingsPath(project), "utf8");

    await expect(saveDefaultModel("deepseek-v4-invalid", project)).rejects.toThrow("未知模型");
    const after = await readFile(getProjectSettingsPath(project), "utf8");

    expect(after).toBe(before);
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
    expect(config.nativeRunner.enabled).toBe(false);
    expect(config.nativeRunner.source).toBe("disabled");
    expect(config.nativeRunner.expectedProtocol).toBe("linghun-native-runner-prototype.v1");
    expect(config.nativeRunner.timeoutMs).toBe(60_000);
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
    const home = await mkdtemp(join(tmpdir(), "linghun-home-"));
    vi.stubEnv("LINGHUN_CONFIG_DIR", join(home, ".linghun"));
    vi.resetModules();
    const { saveModelRoute: cleanSaveModelRoute, loadConfig: cleanLoadConfig } = await import(
      "./index.js"
    );
    const project = await mkdtemp(join(tmpdir(), "linghun-config-"));

    const saved = await cleanSaveModelRoute("planner", "deepseek-reasoner", project);
    const loaded = await cleanLoadConfig(project);

    expect(saved.modelRoutes.routes.find((route) => route.role === "planner")?.primaryModel).toBe(
      "deepseek-reasoner",
    );
    expect(loaded.modelRoutes.routes.find((route) => route.role === "planner")?.provider).toBe(
      "deepseek",
    );
    expect(loaded.modelRoutes.routes.find((route) => route.role === "vision")?.primaryModel).toBe(
      "",
    );
  });

  it("normalizes legacy DeepSeek aliases before saving role routes", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-config-"));

    const saved = await saveModelRoute("executor", "deepseek-v4-flash", project);
    const raw = await readFile(getProjectSettingsPath(project), "utf8");
    const route = saved.modelRoutes.routes.find((item) => item.role === "executor");

    expect(route?.provider).toBe("deepseek");
    expect(route?.primaryModel).toBe("deepseek-chat");
    expect(raw).toContain("deepseek-chat");
    expect(raw).not.toContain("deepseek-v4-flash");
  });

  it("rejects invalid role route model before writing project settings", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-config-"));
    await saveModelRoute("executor", "deepseek-chat", project);
    const before = await readFile(getProjectSettingsPath(project), "utf8");

    await expect(saveModelRoute("executor", "invalid-model", project)).rejects.toThrow("未知模型");
    const after = await readFile(getProjectSettingsPath(project), "utf8");

    expect(after).toBe(before);
  });

  it("resolves DeepSeek real models and legacy display aliases through one validator", () => {
    expect(resolveModelSelection("deepseek-chat", defaultConfig.providers)).toMatchObject({
      model: "deepseek-chat",
      provider: "deepseek",
      legacyAlias: false,
    });
    expect(resolveModelSelection("deepseek-v4-pro", defaultConfig.providers)).toMatchObject({
      model: "deepseek-reasoner",
      provider: "deepseek",
      legacyAlias: true,
    });
    expect(() => resolveModelSelection("deepseek-v4-invalid", defaultConfig.providers)).toThrow(
      "未知模型",
    );
  });

  it("allows env to override default DeepSeek model and Linghun default model", async () => {
    const home = await mkdtemp(join(tmpdir(), "linghun-home-"));
    vi.stubEnv("LINGHUN_CONFIG_DIR", join(home, ".linghun"));
    vi.stubEnv("LINGHUN_DEEPSEEK_MODEL", "deepseek-reasoner");
    vi.stubEnv("LINGHUN_DEFAULT_MODEL", "gpt-5.5");
    vi.resetModules();
    const { defaultConfig: envDefaultConfig, loadConfig: envLoadConfig } = await import(
      "./index.js"
    );
    const project = await mkdtemp(join(tmpdir(), "linghun-config-"));
    const config = await envLoadConfig(project);

    expect(envDefaultConfig.providers.deepseek.model).toBe("deepseek-reasoner");
    expect(config.providers.deepseek.model).toBe("deepseek-reasoner");
    expect(
      envDefaultConfig.modelRoutes.routes.find((route) => route.role === "executor")?.primaryModel,
    ).toBe("deepseek-reasoner");
    expect(config.modelRoutes.routes.find((route) => route.role === "executor")?.primaryModel).toBe(
      "deepseek-reasoner",
    );
    expect(envDefaultConfig.defaultModel).toBe("gpt-5.5");
    expect(config.defaultModel).toBe("gpt-5.5");
  });

  it("normalizes legacy LINGHUN_DEEPSEEK_MODEL before runtime defaults use it", async () => {
    vi.stubEnv("LINGHUN_DEEPSEEK_MODEL", "deepseek-v4-pro");
    vi.resetModules();
    const { defaultConfig: envDefaultConfig } = await import("./index.js");

    expect(envDefaultConfig.providers.deepseek.model).toBe("deepseek-reasoner");
    expect(
      envDefaultConfig.modelRoutes.routes.find((route) => route.role === "executor")?.primaryModel,
    ).toBe("deepseek-reasoner");
  });

  it("normalizes legacy LINGHUN_DEFAULT_MODEL before runtime defaults use it", async () => {
    vi.stubEnv("LINGHUN_DEFAULT_MODEL", "deepseek-v4-flash");
    vi.resetModules();
    const { defaultConfig: envDefaultConfig } = await import("./index.js");

    expect(envDefaultConfig.defaultModel).toBe("deepseek-chat");
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

  it("uses complete shell OpenAI env as the fresh project default route", async () => {
    const home = await mkdtemp(join(tmpdir(), "linghun-home-"));
    vi.stubEnv("LINGHUN_CONFIG_DIR", join(home, ".linghun"));
    vi.stubEnv("LINGHUN_OPENAI_BASE_URL", "https://shell.invalid/v1");
    vi.stubEnv("LINGHUN_OPENAI_API_KEY", "sk-shell-openai-secret");
    vi.stubEnv("LINGHUN_OPENAI_MODEL", "gpt-5.5");
    vi.resetModules();
    const { loadConfig: envLoadConfig } = await import("./index.js");
    const project = await mkdtemp(join(tmpdir(), "linghun-config-"));

    const config = await envLoadConfig(project);
    const executor = config.modelRoutes.routes.find((route) => route.role === "executor");

    expect(config.defaultModel).toBe("gpt-5.5");
    expect(config.providers["openai-compatible"]?.baseUrl).toBe("https://shell.invalid/v1");
    expect(config.providers["openai-compatible"]?.apiKey).toBe("sk-shell-openai-secret");
    expect(config.providers["openai-compatible"]?.model).toBe("gpt-5.5");
    expect(executor?.provider).toBe("openai-compatible");
    expect(executor?.primaryModel).toBe("gpt-5.5");
  });

  it("uses complete shell DeepSeek env as the fresh project default route", async () => {
    const home = await mkdtemp(join(tmpdir(), "linghun-home-"));
    vi.stubEnv("LINGHUN_CONFIG_DIR", join(home, ".linghun"));
    vi.stubEnv("LINGHUN_DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1");
    vi.stubEnv("LINGHUN_DEEPSEEK_API_KEY", "sk-shell-deepseek-secret");
    vi.stubEnv("LINGHUN_DEEPSEEK_MODEL", "deepseek-reasoner");
    vi.resetModules();
    const { loadConfig: envLoadConfig } = await import("./index.js");
    const project = await mkdtemp(join(tmpdir(), "linghun-config-"));

    const config = await envLoadConfig(project);
    const executor = config.modelRoutes.routes.find((route) => route.role === "executor");

    expect(config.defaultModel).toBe("deepseek-reasoner");
    expect(config.providers.deepseek.apiKey).toBe("sk-shell-deepseek-secret");
    expect(config.providers.deepseek.model).toBe("deepseek-reasoner");
    expect(executor?.provider).toBe("deepseek");
    expect(executor?.primaryModel).toBe("deepseek-reasoner");
  });

  it("keeps explicit project routes when shell provider env is complete", async () => {
    const home = await mkdtemp(join(tmpdir(), "linghun-home-"));
    const project = await mkdtemp(join(tmpdir(), "linghun-config-"));
    vi.stubEnv("LINGHUN_CONFIG_DIR", join(home, ".linghun"));
    vi.stubEnv("LINGHUN_OPENAI_BASE_URL", "https://shell.invalid/v1");
    vi.stubEnv("LINGHUN_OPENAI_API_KEY", "sk-shell-openai-secret");
    vi.stubEnv("LINGHUN_OPENAI_MODEL", "gpt-5.5");
    vi.resetModules();
    const {
      getProjectConfigDir: envGetProjectConfigDir,
      getProjectSettingsPath: envGetProjectSettingsPath,
      loadConfig: envLoadConfig,
    } = await import("./index.js");
    await mkdir(envGetProjectConfigDir(project), { recursive: true });
    await writeFile(
      envGetProjectSettingsPath(project),
      JSON.stringify({
        defaultModel: "deepseek-reasoner",
        modelRoutes: {
          defaultModel: "deepseek-reasoner",
          routes: [
            {
              role: "executor",
              provider: "deepseek",
              primaryModel: "deepseek-reasoner",
              fallbackModels: [],
              requiredCapabilities: ["text"],
              allowTools: true,
              allowWrite: true,
              allowBash: true,
              requireApprovalBeforeRun: true,
            },
          ],
        },
      }),
      "utf8",
    );

    const config = await envLoadConfig(project);
    const executor = config.modelRoutes.routes.find((route) => route.role === "executor");

    expect(config.defaultModel).toBe("deepseek-reasoner");
    expect(config.providers["openai-compatible"]?.apiKey).toBe("sk-shell-openai-secret");
    expect(executor?.provider).toBe("deepseek");
    expect(executor?.primaryModel).toBe("deepseek-reasoner");
  });

  it("loads openai endpoint profile and inference level from env", async () => {
    vi.stubEnv("LINGHUN_OPENAI_BASE_URL", "https://api.example.com/v1");
    vi.stubEnv("LINGHUN_OPENAI_ENDPOINT_PROFILE", " Responses ");
    vi.stubEnv("LINGHUN_INFERENCE_LEVEL", "Medium");
    vi.stubEnv("LINGHUN_OPENAI_INCLUDE_USAGE", " True ");
    vi.stubEnv("LINGHUN_OPENAI_MODEL", "gpt-5.5");
    vi.resetModules();
    const { loadConfig: envLoadConfig } = await import("./index.js");
    const project = await mkdtemp(join(tmpdir(), "linghun-config-"));

    const config = await envLoadConfig(project);

    expect(config.providers["openai-compatible"]?.baseUrl).toBe("https://api.example.com/v1");
    expect(config.providers["openai-compatible"]?.endpointProfile).toBe("responses");
    expect(config.providers["openai-compatible"]?.reasoningLevel).toBe("Medium");
    expect(config.providers["openai-compatible"]?.includeUsage).toBe(true);
  });

  it("keeps empty endpoint profile as the chat_completions default", async () => {
    vi.stubEnv("LINGHUN_OPENAI_ENDPOINT_PROFILE", " ");
    vi.resetModules();
    const { loadConfig: envLoadConfig } = await import("./index.js");
    const project = await mkdtemp(join(tmpdir(), "linghun-config-"));

    const config = await envLoadConfig(project);

    expect(config.providers["openai-compatible"]?.endpointProfile).toBe("chat_completions");
  });

  it("normalizes provider.env endpoint profile aliases without falling back to chat", async () => {
    const home = await mkdtemp(join(tmpdir(), "linghun-home-"));
    const project = await mkdtemp(join(tmpdir(), "linghun-config-"));
    vi.stubEnv("LINGHUN_CONFIG_DIR", join(home, ".linghun"));
    vi.resetModules();
    const { getProviderEnvPath: envGetProviderEnvPath, loadConfig: envLoadConfig } = await import(
      "./index.js"
    );
    await mkdir(join(home, ".linghun"), { recursive: true });
    await writeFile(
      envGetProviderEnvPath(home),
      [
        "LINGHUN_OPENAI_BASE_URL=https://provider.invalid",
        "LINGHUN_OPENAI_API_KEY=test-provider-secret",
        "LINGHUN_OPENAI_MODEL=claude-opus-4-7",
        "LINGHUN_OPENAI_ENDPOINT_PROFILE=anthropic-messages",
        "",
      ].join("\n"),
      "utf8",
    );

    const config = await envLoadConfig(project);

    expect(config.providers["openai-compatible"]?.endpointProfile).toBe("anthropic_messages");
  });

  it("warns and falls back when provider.env endpoint profile is invalid", async () => {
    const home = await mkdtemp(join(tmpdir(), "linghun-home-"));
    const project = await mkdtemp(join(tmpdir(), "linghun-config-"));
    vi.stubEnv("LINGHUN_CONFIG_DIR", join(home, ".linghun"));
    vi.resetModules();
    const { getProviderEnvPath: envGetProviderEnvPath, loadConfig: envLoadConfig } = await import(
      "./index.js"
    );
    await mkdir(join(home, ".linghun"), { recursive: true });
    await writeFile(
      envGetProviderEnvPath(home),
      [
        "LINGHUN_OPENAI_BASE_URL=https://provider.invalid",
        "LINGHUN_OPENAI_API_KEY=test-provider-secret",
        "LINGHUN_OPENAI_MODEL=gpt-test",
        "LINGHUN_OPENAI_ENDPOINT_PROFILE=response",
        "",
      ].join("\n"),
      "utf8",
    );

    const config = await envLoadConfig(project);
    const warningModule = await import("./index.js");

    expect(config.providers["openai-compatible"]?.model).toBe("openai-compatible-model");
    expect(warningModule.lastProviderEnvWarning?.reason).toContain(
      "endpointProfile 可选 chat_completions / responses / anthropic_messages",
    );
  });

  it("keeps legacy project apiKey readable but strips apiKey on settings writes", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-config-"));
    await mkdir(getProjectConfigDir(project), { recursive: true });
    await writeFile(
      getProjectSettingsPath(project),
      JSON.stringify({
        providers: {
          deepseek: {
            type: "deepseek",
            baseUrl: "https://api.deepseek.com/v1",
            apiKey: "sk-project-legacy-secret",
            model: "deepseek-v4-flash",
          },
        },
      }),
      "utf8",
    );

    const legacy = await loadConfig(project);
    await saveModelRoute("planner", "deepseek-chat", project);
    const raw = await readFile(getProjectSettingsPath(project), "utf8");

    expect(legacy.providers.deepseek.apiKey).toBe("sk-project-legacy-secret");
    expect(raw).not.toContain("sk-project-legacy-secret");
    expect(raw).not.toContain('"apiKey"');
  });

  it("does not write env apiKey into project settings", async () => {
    vi.stubEnv("LINGHUN_OPENAI_API_KEY", "sk-env-openai-secret");
    vi.stubEnv("LINGHUN_OPENAI_MODEL", "gpt-5.5");
    vi.resetModules();
    const { getProjectSettingsPath: envGetProjectSettingsPath, saveModelRoute: envSaveModelRoute } =
      await import("./index.js");
    const project = await mkdtemp(join(tmpdir(), "linghun-config-"));

    await envSaveModelRoute("planner", "gpt-5.5", project);
    const raw = await readFile(envGetProjectSettingsPath(project), "utf8");

    expect(raw).not.toContain("sk-env-openai-secret");
    expect(raw).not.toContain('"apiKey"');
  });

  it("loads private provider.env below shell env and above project settings", async () => {
    const home = await mkdtemp(join(tmpdir(), "linghun-home-"));
    const project = await mkdtemp(join(tmpdir(), "linghun-config-"));
    vi.stubEnv("LINGHUN_CONFIG_DIR", join(home, ".linghun"));
    vi.stubEnv("LINGHUN_OPENAI_API_KEY", "sk-shell-secret");
    vi.resetModules();
    const {
      getProjectConfigDir: envGetProjectConfigDir,
      getProviderEnvPath: envGetProviderEnvPath,
      loadConfig: envLoadConfig,
      saveModelRoute: envSaveModelRoute,
    } = await import("./index.js");
    await mkdir(envGetProjectConfigDir(project), { recursive: true });
    await writeFile(
      getProjectSettingsPath(project),
      JSON.stringify({
        providers: {
          "openai-compatible": {
            type: "openai-compatible",
            baseUrl: "https://project.invalid/v1",
            apiKey: "sk-project-secret",
            model: "project-model",
          },
        },
      }),
      "utf8",
    );
    await mkdir(join(home, ".linghun"), { recursive: true });
    await writeFile(
      envGetProviderEnvPath(home),
      [
        "# private provider env",
        "LINGHUN_OPENAI_BASE_URL=https://provider.invalid/v1",
        "LINGHUN_OPENAI_API_KEY=test-provider-secret",
        "LINGHUN_OPENAI_MODEL=provider-model",
        "LINGHUN_INFERENCE_LEVEL=High",
        "LINGHUN_OPENAI_INCLUDE_USAGE= TRUE ",
        "",
      ].join("\n"),
      "utf8",
    );

    const config = await envLoadConfig(project);
    await envSaveModelRoute("planner", "provider-model", project);
    const raw = await readFile(getProjectSettingsPath(project), "utf8");

    expect(config.providers["openai-compatible"]?.baseUrl).toBe("https://provider.invalid/v1");
    expect(config.providers["openai-compatible"]?.apiKey).toBe("sk-shell-secret");
    expect(config.providers["openai-compatible"]?.model).toBe("provider-model");
    expect(config.providers["openai-compatible"]?.reasoningLevel).toBe("High");
    expect(config.providers["openai-compatible"]?.includeUsage).toBe(true);
    expect(config.modelRoutes.routes.find((route) => route.role === "executor")?.provider).toBe(
      "openai-compatible",
    );
    expect(raw).not.toContain("sk-shell-secret");
    expect(raw).not.toContain("test-provider-secret");
    expect(raw).not.toContain("sk-project-secret");
  });

  it("creates provider.env template and saves setup atomically in user config dir", async () => {
    const home = await mkdtemp(join(tmpdir(), "linghun-home-"));
    vi.stubEnv("LINGHUN_CONFIG_DIR", join(home, ".linghun"));
    vi.resetModules();
    const {
      ensureProviderEnvTemplate: envEnsureProviderEnvTemplate,
      getProviderEnvPath: envGetProviderEnvPath,
      providerEnvExists: envProviderEnvExists,
      readProviderEnvValues: envReadProviderEnvValues,
      saveProviderEnvSetup: envSaveProviderEnvSetup,
    } = await import("./index.js");

    const path = await envEnsureProviderEnvTemplate(home);
    expect(path).toBe(envGetProviderEnvPath(home));
    expect(await envProviderEnvExists(home)).toBe(true);
    const template = await readFile(path, "utf8");
    expect(template).toContain("#   LINGHUN_OPENAI_BASE_URL=https://api.example.com/v1");
    expect(template).toContain("#   LINGHUN_OPENAI_MODEL=gpt-5.5");
    expect(template).toContain("LINGHUN_OPENAI_ENDPOINT_PROFILE=responses");
    expect(template).toContain("LINGHUN_INFERENCE_LEVEL=High");
    expect(template).toContain("# LINGHUN_DEEPSEEK_BASE_URL=https://api.deepseek.com/v1");
    expect(template).toContain("# LINGHUN_DEEPSEEK_MODEL=deepseek-chat");
    expect(template).toContain("LINGHUN_AUX_MODEL=");

    await envSaveProviderEnvSetup(
      {
        baseUrl: "https://provider.invalid/v1",
        apiKey: "sk-provider-secret",
        model: "provider-model",
        reasoningLevel: "Medium",
      },
      home,
    );
    const raw = await readFile(path, "utf8");
    const values = await envReadProviderEnvValues(home);

    expect(raw).toContain("LINGHUN_OPENAI_BASE_URL=https://provider.invalid/v1");
    expect(raw).toContain("LINGHUN_INFERENCE_LEVEL=Medium");
    expect(values.LINGHUN_OPENAI_API_KEY).toBe("sk-provider-secret");
  });

  it("loads supported DeepSeek fields from provider.env", async () => {
    const home = await mkdtemp(join(tmpdir(), "linghun-home-"));
    const project = await mkdtemp(join(tmpdir(), "linghun-config-"));
    vi.stubEnv("LINGHUN_CONFIG_DIR", join(home, ".linghun"));
    vi.resetModules();
    const { getProviderEnvPath: envGetProviderEnvPath, loadConfig: envLoadConfig } = await import(
      "./index.js"
    );
    await mkdir(join(home, ".linghun"), { recursive: true });
    await writeFile(
      envGetProviderEnvPath(home),
      [
        "LINGHUN_DEEPSEEK_BASE_URL=https://api.deepseek.com/v1",
        "LINGHUN_DEEPSEEK_API_KEY=sk-deepseek-secret",
        "LINGHUN_DEEPSEEK_MODEL=deepseek-chat",
      ].join("\n"),
      "utf8",
    );

    const config = await envLoadConfig(project);

    expect(config.providers.deepseek.baseUrl).toBe("https://api.deepseek.com/v1");
    expect(config.providers.deepseek.apiKey).toBe("sk-deepseek-secret");
    expect(config.providers.deepseek.model).toBe("deepseek-chat");
    expect(config.defaultModel).toBe("deepseek-chat");
    expect(config.modelRoutes.routes.find((route) => route.role === "executor")?.provider).toBe(
      "deepseek",
    );
  });

  it("config dir keeps LINGHUN_CONFIG_DIR provider.env isolated from home provider.env", async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    const project = await mkdtemp(join(tmpdir(), "linghun-config-"));
    const home = await mkdtemp(join(tmpdir(), "linghun-home-"));
    const configDir = await mkdtemp(join(tmpdir(), "linghun-config-dir-"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("USERPROFILE", home);
    vi.stubEnv("LINGHUN_CONFIG_DIR", configDir);
    for (const key of [
      "LINGHUN_OPENAI_BASE_URL",
      "LINGHUN_OPENAI_API_KEY",
      "LINGHUN_OPENAI_MODEL",
      "LINGHUN_DEEPSEEK_BASE_URL",
      "LINGHUN_DEEPSEEK_API_KEY",
      "LINGHUN_DEEPSEEK_MODEL",
      "LINGHUN_DEFAULT_MODEL",
    ]) {
      vi.stubEnv(key, undefined);
    }
    await mkdir(join(home, ".linghun"), { recursive: true });
    await writeFile(
      join(home, ".linghun", "provider.env"),
      [
        "LINGHUN_OPENAI_BASE_URL=https://home-provider.invalid/v1",
        "LINGHUN_OPENAI_API_KEY=sk-home-provider-secret",
        "LINGHUN_OPENAI_MODEL=home-provider-model",
        "",
      ].join("\n"),
      "utf8",
    );

    const indexModule = await import("./index.js");
    const config = await indexModule.loadConfig(project);

    expect(config.providers["openai-compatible"]?.apiKey).toBeUndefined();
    expect(config.providers["openai-compatible"]?.model).toBe("openai-compatible-model");
    expect(config.defaultModel).toBe("deepseek-chat");
    expect(indexModule.lastProviderEnvMerge?.applied).toBe(false);
  });

  it("Run 2 Closure: concurrent provider.env writes do not collide on temp path", async () => {
    const home = await mkdtemp(join(tmpdir(), "linghun-home-"));
    vi.stubEnv("LINGHUN_CONFIG_DIR", join(home, ".linghun"));
    const now = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    vi.resetModules();
    const indexModule = await import("./index.js");

    try {
      await Promise.all([
        indexModule.saveProviderEnvSetup(
          {
            baseUrl: "https://provider.invalid/v1",
            apiKey: "sk-provider-secret-a",
            model: "provider-model-a",
          },
          home,
        ),
        indexModule.saveProviderEnvSetup(
          {
            baseUrl: "https://provider.invalid/v1",
            apiKey: "sk-provider-secret-b",
            model: "provider-model-b",
          },
          home,
        ),
      ]);
    } finally {
      now.mockRestore();
    }
    const path = indexModule.getProviderEnvPath(home);
    const raw = await readFile(path, "utf8");

    expect(raw).toMatch(/LINGHUN_OPENAI_MODEL=provider-model-[ab]/u);
    expect(await indexModule.providerEnvExists(home)).toBe(true);
  });

  it("Run 2 Closure addendum: provider.env replace fallback keeps old file if new rename fails", async () => {
    const home = await mkdtemp(join(tmpdir(), "linghun-home-"));
    vi.stubEnv("LINGHUN_CONFIG_DIR", join(home, ".linghun"));
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    let renameCalls = 0;
    let copyCalls = 0;
    const renameMock = vi.fn(
      async (
        from: Parameters<typeof actualFs.rename>[0],
        to: Parameters<typeof actualFs.rename>[1],
      ) => {
        renameCalls += 1;
        if (renameCalls === 1) {
          throw Object.assign(new Error("replace conflict"), { code: "EPERM" });
        }
        await actualFs.rename(from, to);
      },
    );
    const copyFileMock = vi.fn(
      async (
        from: Parameters<typeof actualFs.copyFile>[0],
        to: Parameters<typeof actualFs.copyFile>[1],
      ) => {
        copyCalls += 1;
        if (copyCalls === 2) {
          throw Object.assign(new Error("new rename failed"), { code: "EIO" });
        }
        await actualFs.copyFile(from, to);
      },
    );
    vi.doMock("node:fs/promises", async () => ({
      ...(await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")),
      copyFile: copyFileMock,
      rename: renameMock,
    }));
    vi.resetModules();
    const indexModule = await import("./index.js");
    const providerEnvPath = indexModule.getProviderEnvPath(home);
    await actualFs.mkdir(join(home, ".linghun"), { recursive: true });
    await actualFs.writeFile(
      providerEnvPath,
      "LINGHUN_OPENAI_MODEL=old-model\nLINGHUN_OPENAI_API_KEY=sk-old-secret\n",
      "utf8",
    );

    await expect(
      indexModule.saveProviderEnvSetup(
        {
          baseUrl: "https://provider.invalid/v1",
          apiKey: "sk-new-secret",
          model: "new-model",
        },
        home,
      ),
    ).rejects.toThrow("new rename failed");

    const raw = await readFile(providerEnvPath, "utf8");
    const lingeringFiles = await readdir(join(home, ".linghun"));
    expect(raw).toContain("LINGHUN_OPENAI_MODEL=old-model");
    expect(raw).toContain("LINGHUN_OPENAI_API_KEY=sk-old-secret");
    expect(raw).not.toContain("new-model");
    expect(lingeringFiles.filter((file) => file.includes(".tmp") || file.includes(".bak"))).toEqual(
      [],
    );
  });

  it("rejects quote-wrapped or quote-prefixed provider API keys before saving", async () => {
    const home = await mkdtemp(join(tmpdir(), "linghun-home-"));

    await expect(
      saveProviderEnvSetup(
        {
          baseUrl: "https://provider.invalid/v1",
          apiKey: "'sk-provider-secret",
          model: "provider-model",
        },
        home,
      ),
    ).rejects.toThrow("API key 不需要包裹引号");
    await expect(
      saveProviderEnvSetup(
        {
          baseUrl: "https://provider.invalid/v1",
          apiKey: 'sk-provider-secret"',
          model: "provider-model",
        },
        home,
      ),
    ).rejects.toThrow("API key 不需要包裹引号");
    expect(await providerEnvExists(home)).toBe(false);
  });

  it("rejects undefined provider API key as a structured validation error", async () => {
    const home = await mkdtemp(join(tmpdir(), "linghun-home-"));

    await expect(
      saveProviderEnvSetup(
        {
          baseUrl: "https://provider.invalid/v1",
          apiKey: undefined as unknown as string,
          model: "provider-model",
        },
        home,
      ),
    ).rejects.toThrow("API key 不能为空。");
    expect(await providerEnvExists(home)).toBe(false);
  });

  it("records actionable warning for broken provider.env and falls back", async () => {
    const home = await mkdtemp(join(tmpdir(), "linghun-home-"));
    const project = await mkdtemp(join(tmpdir(), "linghun-config-"));
    vi.stubEnv("LINGHUN_CONFIG_DIR", join(home, ".linghun"));
    vi.resetModules();
    const {
      getProviderEnvPath: envGetProviderEnvPath,
      lastProviderEnvWarning: envLastProviderEnvWarning,
      loadConfig: envLoadConfig,
    } = await import("./index.js");
    await mkdir(join(home, ".linghun"), { recursive: true });
    await writeFile(
      envGetProviderEnvPath(home),
      "LINGHUN_OPENAI_BASE_URL=https://bad.invalid/v1\n",
      "utf8",
    );

    const config = await envLoadConfig(project);
    const warningModule = await import("./index.js");

    expect(config.providers["openai-compatible"]?.model).toBe("openai-compatible-model");
    expect(warningModule.lastProviderEnvWarning ?? envLastProviderEnvWarning).toMatchObject({
      path: envGetProviderEnvPath(home),
    });
  });

  it("persists Phase 14 extension enablement and Phase 15.5D reinstall trust reset", async () => {
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

    await resetExtensionTrustForInstall("skills", "bug-helper", project);
    const reinstalled = await loadConfig(project);
    expect(reinstalled.skills.disabledIds).toEqual(["bug-helper"]);
    expect(reinstalled.skills.trustedIds).toEqual([]);
  });

  it("deep merges Phase 17B remote channel settings", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-config-"));
    await mkdir(getProjectConfigDir(project), { recursive: true });
    await writeFile(
      getProjectSettingsPath(project),
      JSON.stringify({
        remote: {
          enabled: true,
          channels: {
            feishu: {
              enabled: true,
              bindingUserId: "user-1",
            },
          },
        },
      }),
      "utf8",
    );

    const config = await loadConfig(project);

    expect(config.remote.enabled).toBe(true);
    expect(config.remote.channels.feishu).toMatchObject({
      enabled: true,
      type: "feishu",
      transport: "official_cli",
      cliPath: "feishu-cli",
      bindingUserId: "user-1",
      redactionPolicy: "summary_only",
      trustedSources: [],
      inboundMode: "none",
    });
    expect(config.remote.channels.feishu?.allowedEventTypes).toEqual([
      "approval_request",
      "job_status",
      "job_report",
      "verification_result",
      "failure_summary",
      "stable_point_result",
      "index_result",
    ]);
    expect(config.remote.channels.wecom?.enabled).toBe(false);
    expect(config.remote.channels.dingtalk?.cliPath).toBe("dws");
  });

  it("accepts D.14F remote bridge app refs without storing secret values", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-config-"));
    await mkdir(getProjectConfigDir(project), { recursive: true });
    await writeFile(
      getProjectSettingsPath(project),
      JSON.stringify({
        remote: {
          enabled: true,
          channels: {
            feishu: {
              enabled: true,
              inboundMode: "callback",
              appIdRef: "LINGHUN_REMOTE_FEISHU_APP_ID",
              appSecretRef: "LINGHUN_REMOTE_FEISHU_APP_SECRET",
              encryptKeyRef: "LINGHUN_REMOTE_FEISHU_ENCRYPT_KEY",
              verificationTokenRef: "LINGHUN_REMOTE_FEISHU_VERIFY_TOKEN",
              callbackEndpoint: "local-callback-ref",
              localBridgePort: 18731,
            },
          },
        },
      }),
      "utf8",
    );

    const config = await loadConfig(project);

    expect(config.remote.channels.feishu).toMatchObject({
      inboundMode: "callback",
      appIdRef: "LINGHUN_REMOTE_FEISHU_APP_ID",
      appSecretRef: "LINGHUN_REMOTE_FEISHU_APP_SECRET",
      encryptKeyRef: "LINGHUN_REMOTE_FEISHU_ENCRYPT_KEY",
      verificationTokenRef: "LINGHUN_REMOTE_FEISHU_VERIFY_TOKEN",
      callbackEndpoint: "local-callback-ref",
      localBridgePort: 18731,
    });
    expect(config.remote.channels.feishu?.appSecretRef).not.toContain("secret-value");
  });

  it("deep merges Phase 17C native runner settings", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-config-"));
    await mkdir(getProjectConfigDir(project), { recursive: true });
    await writeFile(
      getProjectSettingsPath(project),
      JSON.stringify({
        nativeRunner: {
          enabled: true,
          path: "./runner 空格/linghun-native-runner",
          source: "project-local",
        },
      }),
      "utf8",
    );

    const config = await loadConfig(project);

    expect(config.nativeRunner).toMatchObject({
      enabled: true,
      path: "./runner 空格/linghun-native-runner",
      source: "project-local",
      expectedProtocol: "linghun-native-runner-prototype.v1",
      timeoutMs: 60_000,
    });
    expect(config.remote.enabled).toBe(false);
  });

  it("accepts Phase 17C.B bundled native runner settings without a manual path", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-config-"));
    await mkdir(getProjectConfigDir(project), { recursive: true });
    await writeFile(
      getProjectSettingsPath(project),
      JSON.stringify({
        nativeRunner: {
          enabled: true,
          source: "bundled",
        },
      }),
      "utf8",
    );

    const config = await loadConfig(project);

    expect(config.nativeRunner).toMatchObject({
      enabled: true,
      source: "bundled",
      expectedProtocol: "linghun-native-runner-prototype.v1",
      timeoutMs: 60_000,
    });
    expect(config.nativeRunner.path).toBeUndefined();
  });

  it("persists Phase 15.5D MCP source and trust records", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-config-"));

    await saveMcpServerConfig(
      "local-demo",
      {
        command: "node",
        args: ["--version"],
        localPath: "node",
        scope: "project",
        installedAt: "2026-05-22T00:00:00.000Z",
        trustLevel: "trusted",
        permissionSummary: "tool-discovery",
      },
      true,
      project,
    );
    const added = await loadConfig(project);
    const addedServer = added.mcp.servers["local-demo"];
    expect(addedServer).toBeDefined();
    if (!addedServer) {
      throw new Error("local-demo MCP server was not saved");
    }
    await saveMcpServerConfig(
      "local-demo",
      { ...addedServer, disabled: true, trustLevel: "disabled" },
      false,
      project,
    );
    const disabled = await loadConfig(project);
    await removeMcpServerConfig("local-demo", project);
    const removed = await loadConfig(project);

    expect(added.mcp.enabledServers).toContain("local-demo");
    expect(added.mcp.servers["local-demo"]?.localPath).toBe("node");
    expect(added.mcp.servers["local-demo"]?.permissionSummary).toBe("tool-discovery");
    expect(disabled.mcp.enabledServers).not.toContain("local-demo");
    expect(disabled.mcp.servers["local-demo"]?.trustLevel).toBe("disabled");
    expect(removed.mcp.servers["local-demo"]).toBeUndefined();
  });

  it.each([
    ["acceptEdits", "auto-review"],
    ["auto", "auto-review"],
    ["bypass", "full-access"],
    ["dontAsk", "default"],
  ])("normalizes legacy permission mode %s on load", async (legacyMode, canonicalMode) => {
    const project = await mkdtemp(join(tmpdir(), "linghun-config-"));
    await mkdir(getProjectConfigDir(project), { recursive: true });
    await writeFile(
      getProjectSettingsPath(project),
      JSON.stringify({ permission: { defaultMode: legacyMode } }),
      "utf8",
    );

    const config = await loadConfig(project);

    expect(config.permission.defaultMode).toBe(canonicalMode);
  });

  it("writes canonical permission modes after loading legacy settings", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-config-"));
    await mkdir(getProjectConfigDir(project), { recursive: true });
    await writeFile(
      getProjectSettingsPath(project),
      JSON.stringify({ permission: { defaultMode: "acceptEdits" } }),
      "utf8",
    );

    await saveModelRoute("planner", "deepseek-chat", project);
    const raw = await readFile(getProjectSettingsPath(project), "utf8");

    expect(raw).toContain('"defaultMode": "auto-review"');
    expect(raw).not.toContain("acceptEdits");
  });

  it("recovers invalid permission modes without escalating", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-config-"));
    await mkdir(getProjectConfigDir(project), { recursive: true });
    await writeFile(
      getProjectSettingsPath(project),
      JSON.stringify({ permission: { defaultMode: "superuser" } }),
      "utf8",
    );

    const config = await loadConfig(project);

    expect(config.permission.defaultMode).toBe("default");
    expect(lastConfigRecoveryWarning?.path).toBe(getProjectSettingsPath(project));
    expect(lastConfigRecoveryWarning?.reason).toContain("settings.permission.defaultMode");
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
    const home = await mkdtemp(join(tmpdir(), "linghun-home-"));
    vi.stubEnv("LINGHUN_CONFIG_DIR", join(home, ".linghun"));
    vi.resetModules();
    const indexModule = await import("./index.js");
    const project = await mkdtemp(join(tmpdir(), "linghun-config-"));
    await mkdir(indexModule.getProjectConfigDir(project), { recursive: true });
    await writeFile(
      indexModule.getProjectSettingsPath(project),
      JSON.stringify({
        providers: { deepseek: { type: "deepseek", model: "deepseek-v4-flash" } },
        modelRoutes: { routes: [{ role: "executor", allowTools: "yes" }] },
      }),
      "utf8",
    );

    const config = await indexModule.loadConfig(project);

    expect(config.defaultModel).toBeTruthy();
    expect(indexModule.lastConfigRecoveryWarning?.path).toBe(
      indexModule.getProjectSettingsPath(project),
    );
    expect(indexModule.lastConfigRecoveryWarning?.reason).toContain("settings.modelRoutes");
  });

  it("D.13H accepts valid contextEditingEnabled + anthropicBetaHeaders on provider config", async () => {
    const project = await mkdtemp(join(tmpdir(), "linghun-config-"));
    await mkdir(getProjectConfigDir(project), { recursive: true });
    await writeFile(
      getProjectSettingsPath(project),
      JSON.stringify({
        providers: {
          deepseek: {
            type: "deepseek",
            model: "deepseek-v4-flash",
            contextEditingEnabled: true,
            // 包含空字符串：CCB filter(Boolean) 语义保留，校验层不应拒绝
            anthropicBetaHeaders: ["context-editing-2025-06-01", ""],
          },
        },
      }),
      "utf8",
    );

    const config = await loadConfig(project);

    expect(config.providers.deepseek.contextEditingEnabled).toBe(true);
    expect(config.providers.deepseek.anthropicBetaHeaders).toEqual([
      "context-editing-2025-06-01",
      "",
    ]);
    // 合法形态不应触发 recovery warning（针对该字段路径）
    expect(lastConfigRecoveryWarning?.reason ?? "").not.toContain(
      "settings.providers.deepseek.contextEditingEnabled",
    );
    expect(lastConfigRecoveryWarning?.reason ?? "").not.toContain(
      "settings.providers.deepseek.anthropicBetaHeaders",
    );
  });

  it("D.13H rejects invalid contextEditingEnabled / non-string anthropicBetaHeaders item", async () => {
    const projectA = await mkdtemp(join(tmpdir(), "linghun-config-"));
    await mkdir(getProjectConfigDir(projectA), { recursive: true });
    await writeFile(
      getProjectSettingsPath(projectA),
      JSON.stringify({
        providers: {
          deepseek: {
            type: "deepseek",
            model: "deepseek-v4-flash",
            contextEditingEnabled: "yes",
          },
        },
      }),
      "utf8",
    );

    await loadConfig(projectA);

    expect(lastConfigRecoveryWarning?.path).toBe(getProjectSettingsPath(projectA));
    expect(lastConfigRecoveryWarning?.reason).toContain(
      "settings.providers.deepseek.contextEditingEnabled",
    );

    const projectB = await mkdtemp(join(tmpdir(), "linghun-config-"));
    await mkdir(getProjectConfigDir(projectB), { recursive: true });
    await writeFile(
      getProjectSettingsPath(projectB),
      JSON.stringify({
        providers: {
          deepseek: {
            type: "deepseek",
            model: "deepseek-v4-flash",
            anthropicBetaHeaders: ["context-editing-2025-06-01", 42],
          },
        },
      }),
      "utf8",
    );

    await loadConfig(projectB);

    expect(lastConfigRecoveryWarning?.path).toBe(getProjectSettingsPath(projectB));
    expect(lastConfigRecoveryWarning?.reason).toContain(
      "settings.providers.deepseek.anthropicBetaHeaders",
    );
  });

  it("D.13J Block 1 isDefaultPlaceholderModel flags deepseek v4 / openai-compatible-model placeholders", async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    const indexModule = await import("./index.js");
    expect(indexModule.isDefaultPlaceholderModel("deepseek-v4-flash")).toBe(true);
    expect(indexModule.isDefaultPlaceholderModel("deepseek-v4-pro")).toBe(true);
    expect(indexModule.isDefaultPlaceholderModel("openai-compatible-model")).toBe(true);
    expect(indexModule.isDefaultPlaceholderModel("deepseek-chat")).toBe(false);
    expect(indexModule.isDefaultPlaceholderModel("deepseek-reasoner")).toBe(false);
    expect(indexModule.isDefaultPlaceholderModel(undefined)).toBe(false);
    expect(indexModule.isDefaultPlaceholderModel("")).toBe(false);
    // 占位集合本身可被 doctor 直接读取（仅做存在性断言，不依赖具体大小避免维护噪声）
    expect(indexModule.defaultPlaceholderModelNames.has("deepseek-v4-flash")).toBe(true);
    expect(indexModule.defaultPlaceholderModelNames.has("openai-compatible-model")).toBe(true);
  });

  it("D.13P default routes do not pre-populate placeholder fallbacks like deepseek-v4-pro", async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    const indexModule = await import("./index.js");
    // 默认 modelRoutes.routes 的 fallbackModels 不再硬塞占位 deepseek-v4-pro。
    // 占位模型仍可在 defaultPlaceholderModelNames / doctor warning 中存在，
    // 但默认配置不应假装它是可运行 fallback。
    for (const route of indexModule.defaultModelRoutes.routes) {
      expect(route.fallbackModels).not.toContain("deepseek-v4-pro");
    }
    // summarizer fallbackModels 之前是 [] + primaryModel 硬编码 deepseek-v4-flash；
    // D.13P 仍允许 primaryModel 跟随 LINGHUN_DEEPSEEK_MODEL/defaultDeepSeekModel，
    // 但不应该把另一个 placeholder 名（v4-pro）当成 fallback。
    const summarizer = indexModule.defaultModelRoutes.routes.find(
      (route) => route.role === "summarizer",
    );
    expect(summarizer?.fallbackModels).toEqual([]);
  });

  it("D.13P-hotfix default DeepSeek routes use deepseek-chat, not placeholder deepseek-v4-flash/pro", async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    const indexModule = await import("./index.js");
    // 运行时默认不再用 placeholder。
    expect(indexModule.defaultConfig.providers.deepseek.model).toBe("deepseek-chat");
    expect(indexModule.defaultConfig.defaultModel).toBe("deepseek-chat");
    // 所有 deepseek 角色 route 的 primaryModel 都不能是 placeholder。
    const deepseekRoutes = indexModule.defaultModelRoutes.routes.filter(
      (route) => route.provider === "deepseek",
    );
    expect(deepseekRoutes.length).toBeGreaterThan(0);
    for (const route of deepseekRoutes) {
      expect(route.primaryModel).not.toBe("deepseek-v4-flash");
      expect(route.primaryModel).not.toBe("deepseek-v4-pro");
      expect(route.primaryModel).toBe("deepseek-chat");
    }
    // placeholder 识别能力保留——doctor / warning 不被削弱。
    expect(indexModule.isDefaultPlaceholderModel("deepseek-v4-flash")).toBe(true);
    expect(indexModule.isDefaultPlaceholderModel("deepseek-v4-pro")).toBe(true);
    expect(indexModule.isDefaultPlaceholderModel("deepseek-chat")).toBe(false);
  });

  it("D.13P-hotfix LINGHUN_DEEPSEEK_MODEL env override propagates into default routes", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINGHUN_DEEPSEEK_MODEL", "custom-deepseek-model");
    vi.resetModules();
    const indexModule = await import("./index.js");
    expect(indexModule.defaultConfig.providers.deepseek.model).toBe("custom-deepseek-model");
    const executor = indexModule.defaultModelRoutes.routes.find(
      (route) => route.role === "executor",
    );
    expect(executor?.primaryModel).toBe("custom-deepseek-model");
    const summarizer = indexModule.defaultModelRoutes.routes.find(
      (route) => route.role === "summarizer",
    );
    expect(summarizer?.primaryModel).toBe("custom-deepseek-model");
    vi.unstubAllEnvs();
  });

  it("D.13J Block 1 records lastProviderEnvMerge applied=no when no provider.env values are set", async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    // 确保 provider.env / settings.json 都没引入 OPENAI_*：直接对一个全新 mkdtemp 项目跑 loadConfig，
    // home 也用一个全新 mkdtemp 替换 HOME（避免把当前用户的 ~/.linghun/provider.env 卷进来）。
    const project = await mkdtemp(join(tmpdir(), "linghun-config-"));
    const home = await mkdtemp(join(tmpdir(), "linghun-home-"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("USERPROFILE", home);
    const indexModule = await import("./index.js");
    await indexModule.loadConfig(project);
    expect(indexModule.lastProviderEnvMerge?.applied).toBe(false);
    expect(indexModule.lastProviderEnvMerge?.providerIds).toEqual([]);
    expect(indexModule.lastProviderEnvMerge?.overrodeModelRoutes).toBe(false);
    expect(indexModule.lastProviderEnvMerge?.overrodeDefaultModel).toBe(false);
  });

  it("D.13J Block 1 records lastProviderEnvMerge applied=yes + provider id list when provider.env defines openai-compatible", async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    const project = await mkdtemp(join(tmpdir(), "linghun-config-"));
    const home = await mkdtemp(join(tmpdir(), "linghun-home-"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("USERPROFILE", home);
    // 写一个有效的 ~/.linghun/provider.env：会触发 mergeProviderEnvConfig 落入 applied=true 分支。
    await mkdir(join(home, ".linghun"), { recursive: true });
    await writeFile(
      join(home, ".linghun", "provider.env"),
      [
        "LINGHUN_OPENAI_BASE_URL=https://relay.example.com",
        "LINGHUN_OPENAI_API_KEY=sk-merge-test-1234567890",
        "LINGHUN_OPENAI_MODEL=gpt-test",
        "",
      ].join("\n"),
      "utf8",
    );
    const indexModule = await import("./index.js");
    const config = await indexModule.loadConfig(project);
    expect(indexModule.lastProviderEnvMerge?.applied).toBe(true);
    expect(indexModule.lastProviderEnvMerge?.providerIds).toContain("openai-compatible");
    // 仅记录布尔 + provider id；apiKey/baseUrl 等不应出现在摘要里
    expect(JSON.stringify(indexModule.lastProviderEnvMerge ?? {})).not.toContain(
      "sk-merge-test-1234567890",
    );
    expect(JSON.stringify(indexModule.lastProviderEnvMerge ?? {})).not.toContain(
      "relay.example.com",
    );
    // provider.env 接管 defaultModel 时，不再保留占位
    expect(config.defaultModel).toBe("gpt-test");
  });

  describe("LINGHUN_DATA_DIR isolation", () => {
    it("isolates project-scoped runtime data under LINGHUN_DATA_DIR", async () => {
      const project = await mkdtemp(join(tmpdir(), "linghun-iso-proj-"));
      const isolatedDataDir = await mkdtemp(join(tmpdir(), "linghun-iso-data-"));

      vi.stubEnv("LINGHUN_DATA_DIR", isolatedDataDir);

      const config = await loadConfig(project);
      const paths = resolveStoragePaths(config, project);

      expect(paths.agentRuns).toContain(isolatedDataDir);
      expect(paths.agentRuns).not.toContain(join(project, ".linghun"));
      expect(paths.failures).toContain(isolatedDataDir);
      expect(paths.failures).not.toContain(join(project, ".linghun"));
      expect(paths.memorySession).toContain(isolatedDataDir);
      expect(paths.memorySession).not.toContain(join(project, ".linghun"));
      expect(paths.jobs).toContain(isolatedDataDir);
      expect(paths.logs).toContain(isolatedDataDir);
      expect(paths.cache).toContain(isolatedDataDir);
    });

    it("still uses project .linghun for config/settings when LINGHUN_DATA_DIR is set", async () => {
      const project = await mkdtemp(join(tmpdir(), "linghun-iso-cfg-"));
      const isolatedDataDir = await mkdtemp(join(tmpdir(), "linghun-iso-cfg-data-"));

      vi.stubEnv("LINGHUN_DATA_DIR", isolatedDataDir);

      const settingsPath = getProjectSettingsPath(project);
      expect(settingsPath).toBe(join(project, ".linghun", "settings.json"));
      expect(settingsPath).not.toContain(isolatedDataDir);
    });

    it("uses project namespace under LINGHUN_DATA_DIR to avoid collision", async () => {
      const project1 = await mkdtemp(join(tmpdir(), "linghun-proj1-"));
      const project2 = await mkdtemp(join(tmpdir(), "linghun-proj2-"));
      const isolatedDataDir = await mkdtemp(join(tmpdir(), "linghun-shared-data-"));

      vi.stubEnv("LINGHUN_DATA_DIR", isolatedDataDir);

      const config1 = await loadConfig(project1);
      const config2 = await loadConfig(project2);

      const paths1 = resolveStoragePaths(config1, project1);
      const paths2 = resolveStoragePaths(config2, project2);

      expect(paths1.agentRuns).not.toBe(paths2.agentRuns);
      expect(paths1.failures).not.toBe(paths2.failures);
      expect(paths1.cache).not.toBe(paths2.cache);
      expect(paths1.memorySession).not.toBe(paths2.memorySession);

      await mkdir(paths1.agentRuns, { recursive: true });
      await writeFile(join(paths1.agentRuns, "agent1.json"), "{}", "utf8");

      await mkdir(paths2.agentRuns, { recursive: true });
      await writeFile(join(paths2.agentRuns, "agent2.json"), "{}", "utf8");

      const files1 = await readdir(paths1.agentRuns);
      const files2 = await readdir(paths2.agentRuns);

      expect(files1).toEqual(["agent1.json"]);
      expect(files2).toEqual(["agent2.json"]);
    });

    it("uses a path-unique safe namespace for projects with the same basename", async () => {
      const rootA = await mkdtemp(join(tmpdir(), "linghun-same-a-"));
      const rootB = await mkdtemp(join(tmpdir(), "linghun-same-b-"));
      const project1 = join(rootA, "same-name");
      const project2 = join(rootB, "same-name");
      const isolatedDataDir = await mkdtemp(join(tmpdir(), "linghun-same-data-"));
      await mkdir(project1, { recursive: true });
      await mkdir(project2, { recursive: true });

      vi.stubEnv("LINGHUN_DATA_DIR", isolatedDataDir);

      const paths1 = resolveStoragePaths(await loadConfig(project1), project1);
      const paths2 = resolveStoragePaths(await loadConfig(project2), project2);
      const expectedNamespace1 = createProjectDataNamespace(project1);
      const expectedNamespace2 = createProjectDataNamespace(project2);
      const namespace1 = paths1.agentRuns
        .slice(isolatedDataDir.length)
        .replaceAll("\\", "/")
        .split("/")
        .filter(Boolean)[1];
      const namespace2 = paths2.agentRuns
        .slice(isolatedDataDir.length)
        .replaceAll("\\", "/")
        .split("/")
        .filter(Boolean)[1];

      expect(paths1.agentRuns).not.toBe(paths2.agentRuns);
      expect(namespace1).toBe(expectedNamespace1);
      expect(namespace2).toBe(expectedNamespace2);
      expect(namespace1).toMatch(/^same-name-[a-f0-9]{16}$/u);
      expect(namespace2).toMatch(/^same-name-[a-f0-9]{16}$/u);
      expect(namespace1).not.toBe(namespace2);
      expect(namespace1).not.toMatch(/[\\/:*?"<>|]/u);
      expect(namespace2).not.toMatch(/[\\/:*?"<>|]/u);
    });

    it("does not isolate when LINGHUN_DATA_DIR is not set", async () => {
      const project = await mkdtemp(join(tmpdir(), "linghun-no-iso-"));

      vi.stubEnv("LINGHUN_DATA_DIR", undefined);

      const config = await loadConfig(project);
      const paths = resolveStoragePaths(config, project);

      expect(paths.agentRuns).toBe(join(project, ".linghun", "agent-runs"));
      expect(paths.failures).toBe(join(project, ".linghun", "failures"));
      expect(paths.memorySession).toBe(join(project, ".linghun", "memory", "session"));
    });
  });
});
