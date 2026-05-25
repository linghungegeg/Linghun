import { defaultConfig } from "@linghun/config";
import type { LinghunConfig, RoleModelRoute } from "@linghun/config";
import { afterEach, describe, expect, it } from "vitest";
import {
  diagnoseConcreteRoute,
  diagnoseRoute,
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

    afterEach(() => {
      if (originalValue === undefined) {
        // biome-ignore lint/performance/noDelete: test cleanup requires actual deletion from process.env
        delete (process.env as Record<string, string | undefined>)[envKey];
      } else {
        process.env[envKey] = originalValue;
      }
    });

    it("returns env when shell env is set", () => {
      process.env[envKey] = "test";
      expect(getProviderKeySource("deepseek", new Set(), new Set())).toBe("env");
    });
    it("returns user-provider-env when in provider env set", () => {
      delete (process.env as Record<string, string | undefined>)[envKey];
      expect(getProviderKeySource("deepseek", new Set(), new Set(["deepseek"]))).toBe(
        "user-provider-env",
      );
    });
    it("returns project-settings-legacy when in project settings", () => {
      delete (process.env as Record<string, string | undefined>)[envKey];
      expect(getProviderKeySource("deepseek", new Set(["deepseek"]), new Set())).toBe(
        "project-settings-legacy",
      );
    });
    it("returns merged-config as fallback", () => {
      delete (process.env as Record<string, string | undefined>)[envKey];
      expect(getProviderKeySource("deepseek", new Set(), new Set())).toBe("merged-config");
    });
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
      expect(output).toContain("provider=deepseek");
      expect(output).toContain("tools=yes");
      expect(output).toContain("/model route doctor");
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
  });

  describe("inferProviderForRouteModel", () => {
    it("matches by provider model field", () => {
      expect(inferProviderForRouteModel("deepseek-chat", baseConfig)).toBe("deepseek");
      expect(inferProviderForRouteModel("gpt-4o", baseConfig)).toBe("openai-compatible");
    });
    it("infers deepseek for deepseek- prefix", () => {
      expect(inferProviderForRouteModel("deepseek-reasoner", baseConfig)).toBe("deepseek");
    });
    it("defaults to openai-compatible for unknown models", () => {
      expect(inferProviderForRouteModel("llama-3-70b", baseConfig)).toBe("openai-compatible");
    });
  });
});
