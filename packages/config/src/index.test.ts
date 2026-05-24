import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
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
    expect(
      envDefaultConfig.modelRoutes.routes.find((route) => route.role === "executor")?.primaryModel,
    ).toBe("deepseek-v4-pro");
    expect(config.modelRoutes.routes.find((route) => route.role === "executor")?.primaryModel).toBe(
      "deepseek-v4-pro",
    );
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
    vi.stubEnv("LINGHUN_OPENAI_BASE_URL", "https://sub2api.toioto.org/v1");
    vi.stubEnv("LINGHUN_OPENAI_ENDPOINT_PROFILE", "responses");
    vi.stubEnv("LINGHUN_INFERENCE_LEVEL", "Medium");
    vi.stubEnv("LINGHUN_OPENAI_MODEL", "gpt-5.5");
    vi.resetModules();
    const { loadConfig: envLoadConfig } = await import("./index.js");
    const project = await mkdtemp(join(tmpdir(), "linghun-config-"));

    const config = await envLoadConfig(project);

    expect(config.providers["openai-compatible"]?.baseUrl).toBe("https://sub2api.toioto.org/v1");
    expect(config.providers["openai-compatible"]?.endpointProfile).toBe("responses");
    expect(config.providers["openai-compatible"]?.reasoningLevel).toBe("Medium");
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
    await saveModelRoute("planner", "deepseek-v4-flash", project);
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
        "LINGHUN_OPENAI_API_KEY=sk-provider-secret",
        "LINGHUN_OPENAI_MODEL=provider-model",
        "LINGHUN_INFERENCE_LEVEL=High",
        "LINGHUN_OPENAI_INCLUDE_USAGE=true",
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
    expect(raw).not.toContain("sk-provider-secret");
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
    });
    expect(config.remote.channels.feishu?.allowedEventTypes).toEqual([
      "approval_request",
      "job_status",
      "job_report",
      "verification_result",
    ]);
    expect(config.remote.channels.wecom?.enabled).toBe(false);
    expect(config.remote.channels.dingtalk?.cliPath).toBe("dws");
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

    await saveModelRoute("planner", "deepseek-v4-flash", project);
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
