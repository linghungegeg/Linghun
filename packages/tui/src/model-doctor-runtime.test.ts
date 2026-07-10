import { existsSync, mkdirSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "@linghun/config";
import { getProviderEnvPath } from "@linghun/config";
import type { LinghunConfig, RoleModelRoute } from "@linghun/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { breakCacheTestHooks } from "./index.js";
import {
  diagnoseConcreteRoute,
  diagnoseRoute,
  formatModelRouteDoctor,
  formatModelRouteSummary,
  formatModelRoutes,
  getProviderKeySource,
  getRoleRoute,
  getRouteBlockingProblems,
  getRouteDoctorLevel,
  hasOpenAiCompatibleDoctorProblem,
  hasOpenAiCompatiblePlaceholderProblem,
  hasOpenAiCompatibleProviderSetupProblem,
  inferProviderForRouteModel,
  isDefaultExecutorRoute,
  isModelRole,
  maskSecret,
  readProviderEnvApiKeyProviders,
  routeSupportsCapability,
} from "./model-doctor-runtime.js";

const baseConfig: LinghunConfig = {
  ...defaultConfig,
  providers: {
    deepseek: {
      type: "deepseek",
      baseUrl: "https://api.deepseek.com",
      apiKey: "sk-test-key-12345678",
      model: "deepseek-chat",
    },
    "openai-compatible": {
      type: "openai-compatible",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-openai-key-12345678",
      model: "gpt-4o",
    },
  },
  modelRoutes: {
    ...defaultConfig.modelRoutes,
    routes: [
      {
        role: "executor",
        provider: "deepseek",
        primaryModel: "deepseek-chat",
        fallbackModels: ["gpt-4o"],
        requiredCapabilities: ["text", "tools"],
        allowTools: true,
        allowWrite: true,
        allowBash: true,
        requireApprovalBeforeRun: false,
      },
      {
        role: "planner",
        provider: "deepseek",
        primaryModel: "deepseek-chat",
        fallbackModels: [],
        requiredCapabilities: ["text", "thinking"],
        allowTools: false,
        allowWrite: false,
        allowBash: false,
        requireApprovalBeforeRun: true,
      },
    ],
  },
};

describe("model-doctor-runtime", () => {
  describe("maskSecret", () => {
    it("masks short secrets completely", () => {
      expect(maskSecret("abc")).toBe("****");
      expect(maskSecret("12345678")).toBe("****");
    });
    it("shows prefix and suffix for longer secrets", () => {
      expect(maskSecret("sk-abcdefghijklmnop")).toBe("sk-…mnop");
    });
    it("never reveals full key", () => {
      const key = "sk-very-long-secret-key-value-here";
      const masked = maskSecret(key);
      expect(masked).not.toBe(key);
      expect(masked.length).toBeLessThan(key.length);
    });
  });

  describe("getProviderKeySource", () => {
    const envKey = "LINGHUN_DEEPSEEK_API_KEY";
    const originalValue = process.env[envKey];
    const originalConfigDir = process.env.LINGHUN_CONFIG_DIR;

    afterEach(() => {
      if (originalValue === undefined) {
        delete (process.env as Record<string, string | undefined>)[envKey];
      } else {
        process.env[envKey] = originalValue;
      }
      if (originalConfigDir === undefined) {
        delete (process.env as Record<string, string | undefined>).LINGHUN_CONFIG_DIR;
      } else {
        process.env.LINGHUN_CONFIG_DIR = originalConfigDir;
      }
    });

    it("returns shell-env when shell env is set", () => {
      process.env[envKey] = "test";
      expect(getProviderKeySource("deepseek", "deepseek", new Set(), new Set())).toBe(
        "shell-env",
      );
    });
    it("returns user-provider-env when in provider env set", () => {
      delete (process.env as Record<string, string | undefined>)[envKey];
      delete (process.env as Record<string, string | undefined>).LINGHUN_CONFIG_DIR;
      expect(getProviderKeySource("deepseek", "deepseek", new Set(), new Set(["deepseek"]))).toBe(
        "user-provider-env",
      );
    });
    it("returns config-dir-provider-env when provider env comes from LINGHUN_CONFIG_DIR", () => {
      delete (process.env as Record<string, string | undefined>)[envKey];
      process.env.LINGHUN_CONFIG_DIR = "isolated-config-dir";
      expect(getProviderKeySource("deepseek", "deepseek", new Set(), new Set(["deepseek"]))).toBe(
        "config-dir-provider-env",
      );
    });
    it("returns project-settings-legacy when in project settings", () => {
      delete (process.env as Record<string, string | undefined>)[envKey];
      expect(getProviderKeySource("deepseek", "deepseek", new Set(["deepseek"]), new Set())).toBe(
        "project-settings-legacy",
      );
    });
    it("returns merged-config as fallback", () => {
      delete (process.env as Record<string, string | undefined>)[envKey];
      expect(getProviderKeySource("deepseek", "deepseek", new Set(), new Set())).toBe("merged-config");
    });
  });

  it("detects provider.env API key source for all built-in providers", async () => {
    const home = await mkdtemp(join(tmpdir(), "linghun-doctor-home-"));
    try {
      vi.stubEnv("LINGHUN_CONFIG_DIR", join(home, ".linghun"));
      await mkdir(join(home, ".linghun"), { recursive: true });
      await writeFile(
        getProviderEnvPath(home),
        [
          "LINGHUN_OPENAI_API_KEY=sk-openai-secret",
          "LINGHUN_DEEPSEEK_API_KEY=sk-deepseek-secret",
          "LINGHUN_GEMINI_API_KEY=sk-gemini-secret",
          "LINGHUN_GROK_API_KEY=sk-grok-secret",
        ].join("\n"),
        "utf8",
      );

      const providers = await readProviderEnvApiKeyProviders();

      expect(providers.has("openai-compatible")).toBe(true);
      expect(providers.has("deepseek")).toBe(true);
      expect(providers.has("gemini")).toBe(true);
      expect(providers.has("grok")).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("keeps empty LINGHUN_CONFIG_DIR isolated from home provider.env", async () => {
    const home = await mkdtemp(join(tmpdir(), "linghun-doctor-home-"));
    const configDir = await mkdtemp(join(tmpdir(), "linghun-doctor-config-dir-"));
    try {
      vi.stubEnv("HOME", home);
      vi.stubEnv("USERPROFILE", home);
      vi.stubEnv("LINGHUN_CONFIG_DIR", configDir);
      await mkdir(join(home, ".linghun"), { recursive: true });
      await writeFile(
        join(home, ".linghun", "provider.env"),
        [
          "LINGHUN_OPENAI_API_KEY=sk-home-openai-secret",
          "LINGHUN_DEEPSEEK_API_KEY=sk-home-deepseek-secret",
        ].join("\n"),
        "utf8",
      );

      const providers = await readProviderEnvApiKeyProviders();

      expect(providers.has("openai-compatible")).toBe(false);
      expect(providers.has("deepseek")).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  describe("isModelRole", () => {
    it("accepts valid roles", () => {
      expect(isModelRole("planner")).toBe(true);
      expect(isModelRole("executor")).toBe(true);
      expect(isModelRole("reviewer")).toBe(true);
      expect(isModelRole("verifier")).toBe(true);
      expect(isModelRole("summarizer")).toBe(true);
      expect(isModelRole("vision")).toBe(true);
      expect(isModelRole("image")).toBe(true);
    });
    it("rejects invalid roles", () => {
      expect(isModelRole("admin")).toBe(false);
      expect(isModelRole("")).toBe(false);
      expect(isModelRole("Executor")).toBe(false);
    });
  });

  describe("getRoleRoute", () => {
    it("returns configured route for existing role", () => {
      const route = getRoleRoute(baseConfig, "executor");
      expect(route.provider).toBe("deepseek");
      expect(route.primaryModel).toBe("deepseek-chat");
      expect(route.allowTools).toBe(true);
    });
    it("returns default empty route for unconfigured role", () => {
      const route = getRoleRoute(baseConfig, "summarizer");
      expect(route.role).toBe("summarizer");
      expect(route.provider).toBe("");
      expect(route.primaryModel).toBe("");
      expect(route.allowTools).toBe(false);
    });
  });

  describe("isDefaultExecutorRoute", () => {
    it("returns true for default deepseek route", () => {
      const route: RoleModelRoute = {
        role: "executor",
        provider: "deepseek",
        primaryModel: defaultConfig.providers.deepseek.model,
        fallbackModels: [],
        requiredCapabilities: ["text"],
        allowTools: true,
        allowWrite: true,
        allowBash: true,
        requireApprovalBeforeRun: false,
      };
      expect(isDefaultExecutorRoute(route, baseConfig)).toBe(true);
    });
    it("returns false for non-default route", () => {
      const route: RoleModelRoute = {
        role: "executor",
        provider: "openai-compatible",
        primaryModel: "gpt-4o",
        fallbackModels: [],
        requiredCapabilities: ["text"],
        allowTools: true,
        allowWrite: true,
        allowBash: true,
        requireApprovalBeforeRun: false,
      };
      expect(isDefaultExecutorRoute(route, baseConfig)).toBe(false);
    });
  });

  describe("formatModelRouteSummary", () => {
    it("includes role and provider info", () => {
      const summary = formatModelRouteSummary(baseConfig);
      expect(summary).toContain("executor:deepseek/deepseek-chat");
      expect(summary).toContain("planner:deepseek/deepseek-chat");
    });
    it("shows 未配置 for empty config", () => {
      const emptyConfig = {
        ...baseConfig,
        modelRoutes: { ...baseConfig.modelRoutes, routes: [] },
      };
      const summary = formatModelRouteSummary(emptyConfig);
      expect(summary).toContain("未配置");
    });
  });

  describe("formatModelRoutes", () => {
    it("includes route details", () => {
      const output = formatModelRoutes(baseConfig);
      expect(output).toContain("executor");
      expect(output).toContain("provider deepseek");
      expect(output).toContain("tool route hint yes");
      expect(output).toContain("availability configured");
      expect(output).toContain("/model route doctor");
    });

    it("marks reserved multimodal routes as disabled rather than usable", () => {
      const output = formatModelRoutes(defaultConfig);
      expect(output).toContain("vision: provider 未配置");
      expect(output).toContain("image: provider 未配置");
      expect(output).toContain("availability reserved/disabled (vision provider/model 未配置；不是可用能力)");
      expect(output).toContain("availability reserved/disabled (image provider/model 未配置；不是可用能力)");
    });
  });

  describe("hasOpenAiCompatibleProviderSetupProblem", () => {
    it("returns true when baseUrl missing", () => {
      expect(
        hasOpenAiCompatibleProviderSetupProblem({
          type: "openai-compatible",
          baseUrl: "",
          apiKey: "sk-test",
          model: "gpt-4o",
        }),
      ).toBe(true);
    });
    it("returns true when apiKey missing", () => {
      expect(
        hasOpenAiCompatibleProviderSetupProblem({
          type: "openai-compatible",
          baseUrl: "https://api.example.com/v1",
          apiKey: "",
          model: "gpt-4o",
        }),
      ).toBe(true);
    });
    it("returns true when model is placeholder", () => {
      expect(
        hasOpenAiCompatibleProviderSetupProblem({
          type: "openai-compatible",
          baseUrl: "https://api.example.com/v1",
          apiKey: "sk-test",
          model: "openai-compatible-model",
        }),
      ).toBe(true);
    });
    it("returns false when fully configured", () => {
      expect(
        hasOpenAiCompatibleProviderSetupProblem({
          type: "openai-compatible",
          baseUrl: "https://api.example.com/v1",
          apiKey: "sk-test",
          model: "gpt-4o",
        }),
      ).toBe(false);
    });
    it("returns false for non-openai-compatible type", () => {
      expect(
        hasOpenAiCompatibleProviderSetupProblem({
          type: "deepseek",
          baseUrl: "",
          apiKey: "",
          model: "",
        }),
      ).toBe(false);
    });
  });

  describe("hasOpenAiCompatibleDoctorProblem", () => {
    it("returns true when openai-compatible provider has issues", () => {
      const config = {
        ...baseConfig,
        providers: {
          ...baseConfig.providers,
          "openai-compatible": {
            type: "openai-compatible" as const,
            baseUrl: "",
            apiKey: "sk-test",
            model: "gpt-4o",
          },
        },
      };
      expect(hasOpenAiCompatibleDoctorProblem(config)).toBe(true);
    });
    it("returns false when openai-compatible is fully configured", () => {
      expect(hasOpenAiCompatibleDoctorProblem(baseConfig)).toBe(false);
    });
  });

  describe("hasOpenAiCompatiblePlaceholderProblem", () => {
    it("returns true when model is placeholder", () => {
      const config = {
        ...baseConfig,
        providers: {
          ...baseConfig.providers,
          "openai-compatible": {
            type: "openai-compatible" as const,
            baseUrl: "https://api.example.com/v1",
            apiKey: "sk-test",
            model: "openai-compatible-model",
          },
        },
      };
      expect(hasOpenAiCompatiblePlaceholderProblem(config)).toBe(true);
    });
    it("returns false when model is real", () => {
      expect(hasOpenAiCompatiblePlaceholderProblem(baseConfig)).toBe(false);
    });
  });

  describe("routeSupportsCapability", () => {
    const route: RoleModelRoute = {
      role: "executor",
      provider: "deepseek",
      primaryModel: "deepseek-chat",
      fallbackModels: [],
      requiredCapabilities: ["text"],
      allowTools: true,
      allowWrite: true,
      allowBash: true,
      requireApprovalBeforeRun: false,
    };

    it("text requires a model name", () => {
      expect(routeSupportsCapability(route, "text")).toBe(true);
      expect(routeSupportsCapability({ ...route, primaryModel: "" }, "text")).toBe(false);
    });
    it("vision checks model name pattern", () => {
      expect(routeSupportsCapability({ ...route, primaryModel: "gpt-4o" }, "vision")).toBe(true);
      expect(routeSupportsCapability({ ...route, primaryModel: "qwen-vl-max" }, "vision")).toBe(
        true,
      );
      expect(routeSupportsCapability({ ...route, primaryModel: "claude-3-opus" }, "vision")).toBe(
        true,
      );
      expect(routeSupportsCapability({ ...route, primaryModel: "llama-3-70b" }, "vision")).toBe(
        false,
      );
    });
    it("image checks model name pattern", () => {
      expect(routeSupportsCapability({ ...route, primaryModel: "dall-e-3" }, "image")).toBe(true);
      expect(routeSupportsCapability({ ...route, primaryModel: "gpt-image-1" }, "image")).toBe(
        true,
      );
      expect(routeSupportsCapability({ ...route, primaryModel: "deepseek-chat" }, "image")).toBe(
        false,
      );
    });
    it("tools checks allowTools flag", () => {
      expect(routeSupportsCapability(route, "tools")).toBe(true);
      expect(routeSupportsCapability({ ...route, allowTools: false }, "tools")).toBe(false);
    });
    it("thinking checks model name pattern", () => {
      expect(
        routeSupportsCapability({ ...route, primaryModel: "deepseek-reasoner" }, "thinking"),
      ).toBe(true);
      expect(routeSupportsCapability({ ...route, primaryModel: "o1-pro" }, "thinking")).toBe(true);
    });
    it("promptCache checks model name pattern", () => {
      expect(routeSupportsCapability(route, "promptCache")).toBe(true);
      expect(routeSupportsCapability({ ...route, primaryModel: "llama-3" }, "promptCache")).toBe(
        false,
      );
    });
  });

  describe("diagnoseConcreteRoute", () => {
    const route: RoleModelRoute = {
      role: "executor",
      provider: "deepseek",
      primaryModel: "deepseek-chat",
      fallbackModels: [],
      requiredCapabilities: ["text", "tools"],
      allowTools: true,
      allowWrite: true,
      allowBash: true,
      requireApprovalBeforeRun: false,
    };

    it("returns empty for valid route", () => {
      const problems = diagnoseConcreteRoute(route, "deepseek-chat", "deepseek", baseConfig);
      expect(problems).toEqual([]);
    });
    it("reports missing provider", () => {
      const problems = diagnoseConcreteRoute(route, "deepseek-chat", "", baseConfig);
      expect(problems).toContain("缺 provider");
    });
    it("reports unconfigured provider", () => {
      const problems = diagnoseConcreteRoute(route, "deepseek-chat", "nonexistent", baseConfig);
      expect(problems).toContain("provider 未配置");
    });
    it("reports missing model", () => {
      const problems = diagnoseConcreteRoute(route, "", "deepseek", baseConfig);
      expect(problems).toContain("缺模型");
    });
    it("reports capability mismatch", () => {
      const noToolsRoute = { ...route, allowTools: false };
      const problems = diagnoseConcreteRoute(noToolsRoute, "deepseek-chat", "deepseek", baseConfig);
      expect(problems.some((p) => p.includes("tools"))).toBe(true);
    });
  });

  describe("diagnoseRoute", () => {
    it("reports missing fallback", () => {
      const route: RoleModelRoute = {
        role: "executor",
        provider: "deepseek",
        primaryModel: "deepseek-chat",
        fallbackModels: [],
        requiredCapabilities: ["text"],
        allowTools: true,
        allowWrite: true,
        allowBash: true,
        requireApprovalBeforeRun: false,
      };
      const problems = diagnoseRoute(route, baseConfig);
      expect(problems).toContain("fallbackModels 未配置");
    });
    it("reports missing budget", () => {
      const route: RoleModelRoute = {
        role: "executor",
        provider: "deepseek",
        primaryModel: "deepseek-chat",
        fallbackModels: ["gpt-4o"],
        requiredCapabilities: ["text"],
        allowTools: true,
        allowWrite: true,
        allowBash: true,
        requireApprovalBeforeRun: false,
      };
      const problems = diagnoseRoute(route, baseConfig);
      expect(problems).toContain("预算未配置");
    });
    it("reports permission too wide for planner", () => {
      const route: RoleModelRoute = {
        role: "planner",
        provider: "deepseek",
        primaryModel: "deepseek-chat",
        fallbackModels: ["gpt-4o"],
        requiredCapabilities: ["text"],
        allowTools: false,
        allowWrite: true,
        allowBash: false,
        requireApprovalBeforeRun: true,
      };
      const problems = diagnoseRoute(route, baseConfig);
      expect(problems.some((p) => p.includes("权限过宽"))).toBe(true);
    });
  });

  describe("getRouteBlockingProblems", () => {
    it("filters out non-blocking problems", () => {
      const problems = ["预算未配置", "fallbackModels 未配置", "缺 provider", "能力不足：tools"];
      const blocking = getRouteBlockingProblems(problems);
      expect(blocking).toContain("缺 provider");
      expect(blocking).toContain("能力不足：tools");
      expect(blocking).not.toContain("预算未配置");
      expect(blocking).not.toContain("fallbackModels 未配置");
    });
  });

  describe("getRouteDoctorLevel", () => {
    it("returns ok for healthy route", () => {
      const route = baseConfig.modelRoutes.routes[0];
      const problems = ["预算未配置", "fallbackModels 未配置"];
      expect(getRouteDoctorLevel(route, problems, baseConfig)).toBe("WARN");
    });
    it("returns BLOCK when primary has blocking problems and no usable fallback", () => {
      const route: RoleModelRoute = {
        role: "executor",
        provider: "",
        primaryModel: "",
        fallbackModels: [],
        requiredCapabilities: ["text"],
        allowTools: true,
        allowWrite: true,
        allowBash: true,
        requireApprovalBeforeRun: false,
      };
      const problems = diagnoseRoute(route, baseConfig);
      expect(getRouteDoctorLevel(route, problems, baseConfig)).toBe("BLOCK");
    });
    // D.13J tail fix（Block D）：placeholder primaryModel 必须 BLOCK，不能 WARN 后假装可请求。
    it("D.13J tail fix Block D: placeholder primary with placeholder fallback → BLOCK", () => {
      const placeholderConfig: LinghunConfig = {
        ...baseConfig,
        providers: {
          ...baseConfig.providers,
          deepseek: {
            type: "deepseek",
            baseUrl: "https://api.deepseek.com",
            apiKey: "sk-test-key-12345678",
            model: "deepseek-v4-flash",
          },
        },
      };
      const route: RoleModelRoute = {
        role: "executor",
        provider: "deepseek",
        primaryModel: "deepseek-v4-flash",
        fallbackModels: ["deepseek-v4-pro"],
        requiredCapabilities: ["text"],
        allowTools: true,
        allowWrite: true,
        allowBash: true,
        requireApprovalBeforeRun: false,
      };
      const problems = diagnoseRoute(route, placeholderConfig);
      expect(problems.some((p) => p.includes("placeholder"))).toBe(true);
      expect(getRouteDoctorLevel(route, problems, placeholderConfig)).toBe("BLOCK");
    });
    // D.13J tail fix（Block D）：placeholder primary + 现役 fallback 应 WARN（fallback 可救场）。
    it("D.13J tail fix Block D: placeholder primary with valid fallback → WARN", () => {
      const route: RoleModelRoute = {
        role: "executor",
        provider: "deepseek",
        primaryModel: "deepseek-v4-flash",
        fallbackModels: ["deepseek-chat"],
        requiredCapabilities: ["text"],
        allowTools: true,
        allowWrite: true,
        allowBash: true,
        requireApprovalBeforeRun: false,
      };
      const problems = diagnoseRoute(route, baseConfig);
      expect(getRouteDoctorLevel(route, problems, baseConfig)).toBe("WARN");
    });
  });

  describe("getRouteBlockingProblems D.13J tail fix Block D", () => {
    it("treats placeholder model as blocking", () => {
      const blocking = getRouteBlockingProblems([
        "模型 placeholder 未替换为现役模型：deepseek-v4-flash",
        "预算未配置",
      ]);
      expect(blocking.some((p) => p.includes("placeholder"))).toBe(true);
      expect(blocking).not.toContain("预算未配置");
    });
  });

  describe("inferProviderForRouteModel", () => {
    it("matches by provider model field", () => {
      expect(inferProviderForRouteModel("deepseek-chat", baseConfig)).toBe("deepseek");
      expect(inferProviderForRouteModel("gpt-4o", baseConfig)).toBe("openai-compatible");
    });
    it("defaults to openai-compatible for models without a matching provider", () => {
      expect(inferProviderForRouteModel("deepseek-reasoner", baseConfig)).toBe("openai-compatible");
    });
    it("defaults to openai-compatible for unknown models", () => {
      expect(inferProviderForRouteModel("llama-3-70b", baseConfig)).toBe("openai-compatible");
    });
    it("fails closed when multiple providers expose the same model", () => {
      const config: LinghunConfig = {
        ...baseConfig,
        providers: {
          ...baseConfig.providers,
          gemini: {
            type: "gemini",
            baseUrl: "https://api.example.com/v1",
            apiKey: "sk-gemini-key",
            model: "gpt-4o",
          },
        },
      };
      expect(inferProviderForRouteModel("gpt-4o", config)).toBe("unknown");
    });
  });

  describe("formatModelRouteDoctor D.13F prompt cache section", () => {
    function makeContext(config: LinghunConfig) {
      return {
        config,
        projectPath: "F:/__no_such_dir__",
        language: "zh-CN" as const,
        routeDecisions: [],
      };
    }

    it("shows prompt cache enabled yes system ttl 5m by default", async () => {
      const output = await formatModelRouteDoctor(makeContext(baseConfig));
      expect(output).toContain("- prompt cache: enabled yes; system ttl 5m");
      expect(output).toContain("5m 默认 cache_control 无 ttl 字面量");
    });

    it("marks default vision/image routes as reserved and disabled in doctor", async () => {
      const output = await formatModelRouteDoctor(makeContext(defaultConfig));
      expect(output).toContain("reserved multimodal routes: vision(vision),image(image)");
      expect(output).toContain("reserved/disabled");
      expect(output).toContain("不是可用能力");
    });

    it("shows prompt cache enabled no when disabled", async () => {
      const config: LinghunConfig = {
        ...baseConfig,
        promptCache: { enabled: false, systemTtl: "5m" },
      };
      const output = await formatModelRouteDoctor(makeContext(config));
      expect(output).toContain("- prompt cache: enabled no; system ttl 5m");
    });

    it("shows prompt cache system ttl 1h when configured", async () => {
      const config: LinghunConfig = {
        ...baseConfig,
        promptCache: { enabled: true, systemTtl: "1h" },
      };
      const output = await formatModelRouteDoctor(makeContext(config));
      expect(output).toContain("- prompt cache: enabled yes; system ttl 1h");
    });

    it("annotates anthropic_messages provider with cache_control + usage fields", async () => {
      const config: LinghunConfig = {
        ...baseConfig,
        providers: {
          ...baseConfig.providers,
          "claude-relay": {
            type: "openai-compatible",
            baseUrl: "https://relay.example.com/v1",
            apiKey: "sk-test-claude-1234567890",
            model: "claude-3-5-sonnet-latest",
            endpointProfile: "anthropic_messages",
          },
        },
        promptCache: { enabled: true, systemTtl: "1h" },
      };
      const output = await formatModelRouteDoctor(makeContext(config));
      expect(output).toContain("anthropic prompt cache:");
      expect(output).toContain("cache_control injected; ttl 1h");
      expect(output).toContain("ephemeral_5m_input_tokens/ephemeral_1h_input_tokens");
    });

    it("shows cache_control=off when promptCache disabled, even on anthropic_messages", async () => {
      const config: LinghunConfig = {
        ...baseConfig,
        providers: {
          ...baseConfig.providers,
          "claude-relay": {
            type: "openai-compatible",
            baseUrl: "https://relay.example.com/v1",
            apiKey: "sk-test-claude-1234567890",
            model: "claude-3-5-sonnet-latest",
            endpointProfile: "anthropic_messages",
          },
        },
        promptCache: { enabled: false, systemTtl: "5m" },
      };
      const output = await formatModelRouteDoctor(makeContext(config));
      expect(output).toContain("cache_control off");
    });

    it("D.13G: anthropic_messages provider does NOT emit tools-disabled-reason; emits 'anthropic tools: enabled' annotation by default", async () => {
      // 验收 #2：anthropic_messages contract 现在默认 supportsTools=true，
      // /model doctor 输出必须显式标注 enabled，不能再印旧的 "tools disabled reason"。
      const config: LinghunConfig = {
        ...baseConfig,
        providers: {
          ...baseConfig.providers,
          "claude-relay": {
            type: "openai-compatible",
            baseUrl: "https://relay.example.com/v1",
            apiKey: "sk-test-claude-1234567890",
            model: "claude-3-5-sonnet-latest",
            endpointProfile: "anthropic_messages",
          },
        },
      };
      const output = await formatModelRouteDoctor(makeContext(config));
      expect(output).not.toContain("tools disabled reason:");
      expect(output).toContain("anthropic tools: enabled; schema anthropic_tools");
      expect(output).toContain("tools enabled");
      expect(output).toContain("tool schema anthropic_tools");
      expect(output).toContain("tool result anthropic_tool_result");
    });

    it("D.13G: anthropic_messages provider with explicit supportsTools=false still emits tools-disabled-reason", async () => {
      const config: LinghunConfig = {
        ...baseConfig,
        providers: {
          ...baseConfig.providers,
          "claude-relay": {
            type: "openai-compatible",
            baseUrl: "https://relay.example.com/v1",
            apiKey: "sk-test-claude-1234567890",
            model: "claude-3-5-sonnet-latest",
            endpointProfile: "anthropic_messages",
            supportsTools: false,
          },
        },
      };
      const output = await formatModelRouteDoctor(makeContext(config));
      expect(output).toContain("tools disabled reason:");
      expect(output).toContain("anthropic_messages profile 已原生支持 tools");
    });

    it("Run 3 closure: openai-compatible doctor gives root/baseUrl endpoint guidance", async () => {
      const config: LinghunConfig = {
        ...baseConfig,
        providers: {
          ...baseConfig.providers,
          "openai-compatible": {
            type: "openai-compatible",
            baseUrl: "https://relay.example.com",
            apiKey: "sk-test-openai-1234567890",
            model: "gpt-4o-mini",
            endpointProfile: "chat_completions",
          },
        },
      };
      const output = await formatModelRouteDoctor(makeContext(config));
      expect(output).toContain("root baseUrl + responses 可能可用");
      expect(output).toContain("chat_completions 通常需要 /v1 root");
      expect(output).toContain("content type text/html");
      expect(output).toContain("少了 /v1");
      expect(output).not.toContain("sk-test-openai-1234567890");
    });

    it("D.13K: anthropic_messages provider + reasoningLevel=High → reasoning=effective/sent level=High", async () => {
      const config: LinghunConfig = {
        ...baseConfig,
        providers: {
          ...baseConfig.providers,
          "claude-relay": {
            type: "openai-compatible",
            baseUrl: "https://relay.example.com/v1",
            apiKey: "sk-test-claude-1234567890",
            model: "claude-opus-4-7",
            endpointProfile: "anthropic_messages",
            reasoningLevel: "High",
          },
        },
      };
      const output = await formatModelRouteDoctor(makeContext(config));
      expect(output).toContain("reasoning effective/sent thinking.budget_tokens=8192");
      expect(output).not.toContain("reasoning ignored/unsupported");
    });

    it("D.13K: anthropic_messages provider + reasoningLevel=Low matches provider budget 1024", async () => {
      const config: LinghunConfig = {
        ...baseConfig,
        providers: {
          ...baseConfig.providers,
          "claude-relay": {
            type: "openai-compatible",
            baseUrl: "https://relay.example.com/v1",
            apiKey: "sk-test-claude-1234567890",
            model: "claude-opus-4-7",
            endpointProfile: "anthropic_messages",
            reasoningLevel: "Low",
          },
        },
      };
      const output = await formatModelRouteDoctor(makeContext(config));
      expect(output).toContain("reasoning effective/sent thinking.budget_tokens=1024");
      expect(output).not.toContain("thinking.budget_tokens=2048");
    });

    it("D.13K: anthropic_messages provider 无 reasoningLevel → reasoning=not configured/未生效", async () => {
      const config: LinghunConfig = {
        ...baseConfig,
        providers: {
          ...baseConfig.providers,
          "claude-relay": {
            type: "openai-compatible",
            baseUrl: "https://relay.example.com/v1",
            apiKey: "sk-test-claude-1234567890",
            model: "claude-opus-4-7",
            endpointProfile: "anthropic_messages",
          },
        },
      };
      const output = await formatModelRouteDoctor(makeContext(config));
      expect(output).toContain("reasoning not configured/未生效");
    });

    it("never leaks raw apiKey or prompt text", async () => {
      const config: LinghunConfig = {
        ...baseConfig,
        providers: {
          ...baseConfig.providers,
          deepseek: {
            type: "deepseek",
            baseUrl: "https://api.deepseek.com",
            apiKey: "sk-very-secret-VALUE-DO-NOT-LEAK",
            model: "deepseek-chat",
          },
        },
      };
      const output = await formatModelRouteDoctor(makeContext(config));
      expect(output).not.toContain("sk-very-secret-VALUE-DO-NOT-LEAK");
      // doctor 摘要不应出现请求体 / system prompt 关键字
      expect(output.toLowerCase()).not.toContain("system prompt content");
      expect(output).not.toContain("cacheBreakNonce=");
    });

    it("shows effective endpointProfile decision and reason", async () => {
      const output = await formatModelRouteDoctor(makeContext(baseConfig));
      expect(output).toContain("endpoint profile decision:");
      expect(output).toContain("source ");
      expect(output).toContain("reason ");
    });

    it("uses runtime contract endpoint profile for responses suffix reasoning diagnostics", async () => {
      const config: LinghunConfig = {
        ...baseConfig,
        providers: {
          ...baseConfig.providers,
          "openai-compatible": {
            type: "openai-compatible",
            baseUrl: "https://relay.example.com/responses",
            apiKey: "sk-test-secret",
            model: "gpt-5.5",
            reasoningLevel: "High",
          },
        },
      };

      const output = await formatModelRouteDoctor(makeContext(config));

      expect(output).toContain(
        "provider openai-compatible; model gpt-5.5; runtime profile openai_responses; endpoint profile responses",
      );
      expect(output).toContain("endpoint path /responses");
      expect(output).toContain("reasoning effective/sent reasoning.effort=High");
      expect(output).not.toContain("reasoning ignored/unsupported");
    });

    it("D.13H model doctor shows anthropic context editing disabled reason without leaking apiKey", async () => {
      // 默认 contextEditingEnabled 未配置 → enabled no、sendable no、reason "disabled by config"。
      // 即使 apiKey 配置了完整字符串，doctor 也不能在输出里出现 raw apiKey 或 raw beta header。
      const config: LinghunConfig = {
        ...baseConfig,
        providers: {
          ...baseConfig.providers,
          "claude-relay": {
            type: "openai-compatible",
            baseUrl: "https://relay.example.com/v1",
            apiKey: "sk-test-secret-DO-NOT-LEAK-AAAA",
            model: "claude-3-5-sonnet-latest",
            endpointProfile: "anthropic_messages",
          },
        },
      };
      const output = await formatModelRouteDoctor(makeContext(config));
      // 必须出现 D.13H 诊断行，且明确 disabled。
      expect(output).toContain("anthropic context editing:");
      expect(output).toContain("enabled no");
      expect(output).toContain("sendable no");
      expect(output).toContain("beta headers 0");
      expect(output).toContain("reason disabled by config");
      expect(output).toContain("cache_edits/cache_reference body 字段 hard-disabled");
      // 严禁泄露 raw apiKey。
      expect(output).not.toContain("sk-test-secret-DO-NOT-LEAK-AAAA");

      // 配置 enabled=true 但全空 beta header → reason="missing non-empty beta header"，不出现 raw header。
      const configEmptyBeta: LinghunConfig = {
        ...config,
        providers: {
          ...config.providers,
          "claude-relay": {
            ...config.providers["claude-relay"],
            contextEditingEnabled: true,
            anthropicBetaHeaders: [""],
          },
        },
      };
      const output2 = await formatModelRouteDoctor(makeContext(configEmptyBeta));
      expect(output2).toContain("enabled yes");
      expect(output2).toContain("sendable no");
      expect(output2).toContain("beta headers 0");
      expect(output2).toContain("reason missing non-empty beta header");
      expect(output2).not.toContain("sk-test-secret-DO-NOT-LEAK-AAAA");

      // 配置 enabled=true + 非空 beta header → sendable yes、beta headers 计数 1，但 raw header 不输出。
      const sentinelBetaHeader = "context-editing-2025-SENTINEL-XYZ";
      const configReal: LinghunConfig = {
        ...config,
        providers: {
          ...config.providers,
          "claude-relay": {
            ...config.providers["claude-relay"],
            contextEditingEnabled: true,
            anthropicBetaHeaders: [sentinelBetaHeader],
          },
        },
      };
      const output3 = await formatModelRouteDoctor(makeContext(configReal));
      expect(output3).toContain("enabled yes");
      expect(output3).toContain("sendable yes");
      expect(output3).toContain("beta headers 1");
      expect(output3).toContain("reason ok");
      expect(output3).not.toContain(sentinelBetaHeader);
      expect(output3).not.toContain("sk-test-secret-DO-NOT-LEAK-AAAA");
    });
  });

  describe("D.13F break-cache marker + event log persistence", () => {
    let projectPath = "";

    afterEach(async () => {
      if (projectPath) {
        await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
        projectPath = "";
      }
    });

    async function makeProject(): Promise<string> {
      const dir = await mkdtemp(join(tmpdir(), "linghun-break-cache-test-"));
      projectPath = dir;
      return dir;
    }

    it("once: writes marker, consumeNonce returns it once and deletes marker", async () => {
      const dir = await makeProject();
      await breakCacheTestHooks.writeMarker(dir, "once", "nonce-once-1");
      const beforeMarker = breakCacheTestHooks.readMarker(dir);
      expect(beforeMarker.mode).toBe("once");
      expect(beforeMarker.nonce).toBe("nonce-once-1");

      const consumed = await breakCacheTestHooks.consumeNonce(dir);
      expect(consumed).toBe("nonce-once-1");

      // marker 文件应已被删除
      expect(existsSync(breakCacheTestHooks.paths(dir).onceMarker)).toBe(false);
      const afterMarker = breakCacheTestHooks.readMarker(dir);
      expect(afterMarker.mode).toBe("off");

      // 第二次消费应为 undefined
      const second = await breakCacheTestHooks.consumeNonce(dir);
      expect(second).toBeUndefined();
    });

    it("once: buildPromptCacheRequestFields injects nonce only once", async () => {
      const dir = await makeProject();
      await breakCacheTestHooks.writeMarker(dir, "once", "nonce-bp-1");
      const first = await breakCacheTestHooks.buildPromptCacheFields(dir, true, "5m");
      expect(first.promptCacheEnabled).toBe(true);
      expect(first.cacheBreakNonce).toBe("nonce-bp-1");
      expect(first.promptCacheTtl).toBeUndefined();

      const second = await breakCacheTestHooks.buildPromptCacheFields(dir, true, "5m");
      expect(second.promptCacheEnabled).toBe(true);
      expect(second.cacheBreakNonce).toBeUndefined();
    });

    it("buildPromptCacheRequestFields returns empty object when enabled=false", async () => {
      const dir = await makeProject();
      await breakCacheTestHooks.writeMarker(dir, "always", "nonce-disabled-1");
      const fields = await breakCacheTestHooks.buildPromptCacheFields(dir, false, "5m");
      expect(fields).toEqual({});
    });

    it("always: marker is NOT consumed, persists across calls (stable nonce / fixed namespace)", async () => {
      const dir = await makeProject();
      await breakCacheTestHooks.writeMarker(dir, "always", "nonce-always-1");
      const first = await breakCacheTestHooks.consumeNonce(dir);
      const second = await breakCacheTestHooks.consumeNonce(dir);
      expect(first).toBe("nonce-always-1");
      expect(second).toBe("nonce-always-1");
      expect(existsSync(breakCacheTestHooks.paths(dir).alwaysMarker)).toBe(true);
    });

    it("off + clear: deletes both once and always markers", async () => {
      const dir = await makeProject();
      await breakCacheTestHooks.writeMarker(dir, "once", "nonce-c-1");
      await breakCacheTestHooks.writeMarker(dir, "always", "nonce-c-2");
      await breakCacheTestHooks.clearMarker(dir, "all");
      expect(existsSync(breakCacheTestHooks.paths(dir).onceMarker)).toBe(false);
      expect(existsSync(breakCacheTestHooks.paths(dir).alwaysMarker)).toBe(false);
      expect(breakCacheTestHooks.readMarker(dir).mode).toBe("off");
    });

    it("event log only contains action/createdAt — no nonce, prompt, apiKey, raw request/response", async () => {
      const dir = await makeProject();
      await breakCacheTestHooks.writeMarker(dir, "once", "secret-nonce-AAA-BBB-CCC");
      // 触发 once_consumed 事件
      await breakCacheTestHooks.consumeNonce(dir);
      await breakCacheTestHooks.appendEvent(dir, "always_set");
      await breakCacheTestHooks.appendEvent(dir, "off");

      const eventsLogPath = breakCacheTestHooks.paths(dir).eventsLog;
      const raw = await readFile(eventsLogPath, "utf8");
      // 不能泄露 nonce / 任何敏感原文
      expect(raw).not.toContain("secret-nonce-AAA-BBB-CCC");
      expect(raw).not.toContain("apiKey");
      expect(raw).not.toContain("api_key");
      expect(raw).not.toContain("prompt:");
      expect(raw).not.toContain("system:");
      expect(raw).not.toContain("authorization");
      expect(raw).not.toContain("Bearer ");

      // 解析每行：仅含 action + createdAt 两个字段
      const lines = raw.split(/\r?\n/).filter((line) => line.length > 0);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        const obj = JSON.parse(line) as Record<string, unknown>;
        expect(Object.keys(obj).sort()).toEqual(["action", "createdAt"]);
        expect(typeof obj.action).toBe("string");
        expect(typeof obj.createdAt).toBe("string");
      }
    });

    it("event log truncates to 200 lines (BREAK_CACHE_EVENTS_MAX_LINES)", async () => {
      const dir = await makeProject();
      const max = breakCacheTestHooks.eventsMaxLines;
      expect(max).toBe(200);
      const oldLines = Array.from({ length: max + 24 }, (_, i) =>
        JSON.stringify({ action: `bulk_${i}`, createdAt: "2026-01-01T00:00:00.000Z" }),
      );
      const eventsLogPath = breakCacheTestHooks.paths(dir).eventsLog;
      mkdirSync(join(dir, ".linghun"), { recursive: true });
      await writeFile(eventsLogPath, `${oldLines.join("\n")}\n`, "utf8");
      await breakCacheTestHooks.appendEvent(dir, `bulk_${max + 24}`);
      const raw = await readFile(eventsLogPath, "utf8");
      const lines = raw.split(/\r?\n/).filter((line) => line.length > 0);
      expect(lines.length).toBeLessThanOrEqual(max);
      // 应保留最近的事件（bulk_<max+24>），裁掉早期的（bulk_0）
      expect(raw).toContain(`bulk_${max + 24}`);
      expect(raw).not.toContain('"action":"bulk_0"');
    });

    it("readRecentEvents returns only the requested tail length", async () => {
      const dir = await makeProject();
      for (let i = 0; i < 10; i++) {
        await breakCacheTestHooks.appendEvent(dir, `step_${i}`);
      }
      const recent = breakCacheTestHooks.readRecentEvents(dir, 3);
      expect(recent).toHaveLength(3);
      expect(recent[0]?.action).toBe("step_7");
      expect(recent[2]?.action).toBe("step_9");
    });

    it("readMarker returns off when project dir has no marker files", async () => {
      const dir = await makeProject();
      expect(breakCacheTestHooks.readMarker(dir).mode).toBe("off");
      const fields = await breakCacheTestHooks.buildPromptCacheFields(dir, true, "1h");
      expect(fields).toEqual({ promptCacheEnabled: true, promptCacheTtl: "1h" });
    });
  });

  describe("D.13I deferredTools doctor reporting", () => {
    it("D.13I formatModelRouteDoctor 输出 deferredTools 摘要：仅 total/byKind/executableCount，不暴露 raw schema/secret", async () => {
      const projectPath = await mkdtemp(join(tmpdir(), "linghun-doctor-deferred-"));
      try {
        const ctx = {
          config: baseConfig,
          projectPath,
          language: "zh-CN" as const,
          routeDecisions: [],
          deferredToolsSummary: {
            total: 12,
            byKind: { "codebase-memory": 10, "pre-engine": 0, mcp: 2, skill: 0, plugin: 0 },
            executableCount: 10,
          },
        };
        const text = await formatModelRouteDoctor(ctx);
        // 必须出现 deferredTools 行 + 三个 count 字段
        expect(text).toContain("deferred tools:");
        expect(text).toContain("total 12");
        expect(text).toContain("executable 10");
        expect(text).toContain("codebase-memory 10");
        expect(text).toContain("mcp 2");
        expect(text).toContain("skill 0");
        expect(text).toContain("plugin 0");
        // 不允许暴露 raw schema / 参数原文 / apiKey 字面量
        expect(text).not.toContain("input_schema");
        expect(text).not.toContain("inputSchema");
        expect(text).not.toContain("requiredArgs");
        expect(text).not.toContain("sk-test-key-12345678");
        expect(text).not.toContain("sk-openai-key-12345678");
      } finally {
        await rm(projectPath, { recursive: true, force: true });
      }
    });

    it("D.13I deferredToolsSummary 缺省时 doctor 不输出 deferredTools 行（向后兼容）", async () => {
      const projectPath = await mkdtemp(join(tmpdir(), "linghun-doctor-deferred-"));
      try {
        const ctx = {
          config: baseConfig,
          projectPath,
          language: "zh-CN" as const,
          routeDecisions: [],
        };
        const text = await formatModelRouteDoctor(ctx);
        expect(text).not.toContain("deferredTools:");
        expect(text).not.toContain("deferred tools:");
      } finally {
        await rm(projectPath, { recursive: true, force: true });
      }
    });
  });

  describe("D.13J Block 1 placeholder model + provider.env merge surfacing", () => {
    it("doctor 标记 deepseek-v4-flash / deepseek-v4-pro 占位模型", async () => {
      const projectPath = await mkdtemp(join(tmpdir(), "linghun-doctor-placeholder-"));
      try {
        const placeholderConfig: LinghunConfig = {
          ...baseConfig,
          providers: {
            deepseek: {
              type: "deepseek",
              baseUrl: "https://api.deepseek.com",
              apiKey: "sk-deepseek-key-12345678",
              model: "deepseek-v4-flash",
            },
          },
          modelRoutes: {
            ...baseConfig.modelRoutes,
            routes: [
              {
                role: "executor",
                provider: "deepseek",
                primaryModel: "deepseek-v4-pro",
                fallbackModels: ["deepseek-v4-flash"],
                requiredCapabilities: ["text", "tools"],
                allowTools: true,
                allowWrite: true,
                allowBash: true,
                requireApprovalBeforeRun: false,
              },
            ],
          },
        };
        const ctx = {
          config: placeholderConfig,
          projectPath,
          language: "zh-CN" as const,
          routeDecisions: [],
        };
        const text = await formatModelRouteDoctor(ctx);
        expect(text).toContain("WARN placeholder model:");
        expect(text).toContain("deepseek -> deepseek-v4-flash");
        expect(text).toContain("executor.primary -> deepseek-v4-pro");
        expect(text).toContain("executor.fallback -> deepseek-v4-flash");
        expect(text).toContain("LINGHUN_DEEPSEEK_MODEL");
        expect(text).toContain("现役模型名");
      } finally {
        await rm(projectPath, { recursive: true, force: true });
      }
    });

    it("doctor 在使用现役模型名时不打 placeholder 警告", async () => {
      const projectPath = await mkdtemp(join(tmpdir(), "linghun-doctor-no-placeholder-"));
      try {
        const ctx = {
          config: baseConfig,
          projectPath,
          language: "zh-CN" as const,
          routeDecisions: [],
        };
        const text = await formatModelRouteDoctor(ctx);
        expect(text).not.toContain("WARN placeholder model:");
      } finally {
        await rm(projectPath, { recursive: true, force: true });
      }
    });

    it("provider.env merge 摘要：applied=no 时显式提示未覆盖", async () => {
      // 通过真实的 loadConfig 路径触发 lastProviderEnvMerge 写入；ESM 的 let export 在消费端是只读绑定，
      // 直接赋值会抛 "has only a getter"，所以必须走 mergeProviderEnvConfig 真实路径。
      // 临时切换 HOME 到空目录，确保 ~/.linghun/provider.env 不存在 → applied=false。
      const projectPath = await mkdtemp(join(tmpdir(), "linghun-doctor-merge-no-"));
      const homePath = await mkdtemp(join(tmpdir(), "linghun-home-merge-no-"));
      const originalHome = process.env.HOME;
      const originalUserProfile = process.env.USERPROFILE;
      try {
        process.env.HOME = homePath;
        process.env.USERPROFILE = homePath;
        const cfgModule = await import("@linghun/config");
        await cfgModule.loadConfig(projectPath);
        const doctorModule = await import("./model-doctor-runtime.js");
        const ctx = {
          config: baseConfig,
          projectPath,
          language: "zh-CN" as const,
          routeDecisions: [],
        };
        const text = await doctorModule.formatModelRouteDoctor(ctx);
        expect(text).toContain("provider.env merge: applied no");
      } finally {
        if (originalHome === undefined) process.env.HOME = undefined;
        else process.env.HOME = originalHome;
        if (originalUserProfile === undefined) process.env.USERPROFILE = undefined;
        else process.env.USERPROFILE = originalUserProfile;
        await rm(projectPath, { recursive: true, force: true });
        await rm(homePath, { recursive: true, force: true });
      }
    });

    it("P2.7: provider.env 文案不诱导用户泄露凭据（不建议 cat/type）", async () => {
      const projectPath = await mkdtemp(join(tmpdir(), "linghun-doctor-p27-"));
      try {
        // 直接测试 formatModelRouteDoctor 输出中有 applied=yes 的文案
        // 通过导入时已有的 lastProviderEnvMerge 状态（其他测试或真实环境可能设置过）
        const text = await formatModelRouteDoctor({
          config: baseConfig,
          projectPath,
          language: "zh-CN" as const,
          routeDecisions: [],
        });
        // 如果文本包含 provider.env merge: applied=yes，必须同时包含安全提示
        if (text.includes("provider.env merge: applied yes")) {
          expect(text).toContain("安全提示");
          expect(text).toContain("不要 cat/type");
          expect(text).toContain("含敏感凭据");
        }
        // 无论是否 applied，都禁止建议用户直接打印文件内容
        expect(text).not.toContain("cat ~/.linghun/provider.env");
        expect(text).not.toContain("type ~/.linghun/provider.env");
        expect(text).not.toContain("cat provider.env");
        expect(text).not.toContain("type provider.env");
      } finally {
        await rm(projectPath, { recursive: true, force: true });
      }
    });
  });

  describe("D.13J Block 2 discovered deferred tools doctor surfacing", () => {
    it("renders quota or balance exhausted doctor note in zh-CN and en-US", async () => {
      const projectPath = await mkdtemp(join(tmpdir(), "linghun-doctor-quota-"));
      try {
        const common = {
          config: baseConfig,
          projectPath,
          routeDecisions: [],
          lastProviderFailure: {
            code: "PROVIDER_QUOTA_EXHAUSTED",
            kind: "quota_or_balance_exhausted",
            provider: "openai-compatible",
            model: "gpt-4o",
            endpointProfile: "chat_completions",
          },
        };

        const zh = await formatModelRouteDoctor({ ...common, language: "zh-CN" as const });
        const en = await formatModelRouteDoctor({ ...common, language: "en-US" as const });

        expect(zh).toContain("最近模型服务失败");
        expect(zh).toContain("额度或余额不足");
        expect(zh).toContain("额度/余额说明");
        expect(en).toContain("last model-service failure");
        expect(en).toContain("quota or balance exhausted");
        expect(en).toContain("quota/balance note");
      } finally {
        await rm(projectPath, { recursive: true, force: true });
      }
    });

    it("renders zh-CN fallback success status in doctor", async () => {
      const projectPath = await mkdtemp(join(tmpdir(), "linghun-doctor-fallback-"));
      try {
        const text = await formatModelRouteDoctor({
          config: baseConfig,
          projectPath,
          language: "zh-CN",
          routeDecisions: [],
          lastProviderFallbackAttempt: {
            fromProvider: "openai-compatible",
            fromModel: "primary-model",
            toProvider: "openai-compatible",
            toModel: "fallback-model",
            reasonKind: "rate_limit",
            reasonCode: "PROVIDER_RATE_LIMITED",
            status: "succeeded",
            summary: "ignored in doctor",
          },
        });

        expect(text).toContain("最近备用模型尝试");
        expect(text).toContain("状态 已成功");
        expect(text).toContain("原因 限流");
      } finally {
        await rm(projectPath, { recursive: true, force: true });
      }
    });

    it("discoveredDeferredToolsSummary total=0 时输出排查指引", async () => {
      const projectPath = await mkdtemp(join(tmpdir(), "linghun-doctor-discovered-empty-"));
      try {
        const ctx = {
          config: baseConfig,
          projectPath,
          language: "zh-CN" as const,
          routeDecisions: [],
          discoveredDeferredToolsSummary: { total: 0, names: [], truncated: false },
        };
        const text = await formatModelRouteDoctor(ctx);
        expect(text).toContain("discoveredDeferredTools: 0");
        expect(text).toContain("SearchExtraTools");
      } finally {
        await rm(projectPath, { recursive: true, force: true });
      }
    });

    it("discoveredDeferredToolsSummary 有内容时按 names 列出，提示 session-scoped", async () => {
      const projectPath = await mkdtemp(join(tmpdir(), "linghun-doctor-discovered-some-"));
      try {
        const ctx = {
          config: baseConfig,
          projectPath,
          language: "zh-CN" as const,
          routeDecisions: [],
          discoveredDeferredToolsSummary: {
            total: 3,
            names: ["alpha_tool", "list_projects", "trace_path"],
            truncated: false,
          },
        };
        const text = await formatModelRouteDoctor(ctx);
        expect(text).toContain("discovered deferred tools: total 3");
        expect(text).toContain("alpha_tool");
        expect(text).toContain("list_projects");
        expect(text).toContain("trace_path");
        expect(text).toContain("session 重启即清零");
      } finally {
        await rm(projectPath, { recursive: true, force: true });
      }
    });

    it("discoveredDeferredToolsSummary truncated=true 时附加 +N more 标记", async () => {
      const projectPath = await mkdtemp(join(tmpdir(), "linghun-doctor-discovered-trunc-"));
      try {
        const ctx = {
          config: baseConfig,
          projectPath,
          language: "zh-CN" as const,
          routeDecisions: [],
          discoveredDeferredToolsSummary: {
            total: 50,
            names: Array.from({ length: 32 }, (_, i) => `tool_${i.toString().padStart(2, "0")}`),
            truncated: true,
          },
        };
        const text = await formatModelRouteDoctor(ctx);
        expect(text).toContain("discovered deferred tools: total 50");
        expect(text).toContain("+18 more");
      } finally {
        await rm(projectPath, { recursive: true, force: true });
      }
    });

    it("discoveredDeferredToolsSummary 缺省时 doctor 不输出 discoveredDeferredTools 行（向后兼容）", async () => {
      const projectPath = await mkdtemp(join(tmpdir(), "linghun-doctor-discovered-absent-"));
      try {
        const ctx = {
          config: baseConfig,
          projectPath,
          language: "zh-CN" as const,
          routeDecisions: [],
        };
        const text = await formatModelRouteDoctor(ctx);
        expect(text).not.toContain("discoveredDeferredTools");
      } finally {
        await rm(projectPath, { recursive: true, force: true });
      }
    });
  });
});
