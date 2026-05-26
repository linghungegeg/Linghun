import { defaultConfig } from "@linghun/config";
import type { LinghunConfig, RoleModelRoute } from "@linghun/config";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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

  describe("formatModelRouteDoctor D.13F prompt cache section", () => {
    function makeContext(config: LinghunConfig) {
      return {
        config,
        projectPath: "F:/__no_such_dir__",
        language: "zh-CN" as const,
        routeDecisions: [],
      };
    }

    it("shows promptCache enabled=yes systemTtl=5m by default", async () => {
      const output = await formatModelRouteDoctor(makeContext(baseConfig));
      expect(output).toContain("- promptCache: enabled=yes systemTtl=5m");
      expect(output).toContain("5m 默认 cache_control 无 ttl 字面量");
    });

    it("shows promptCache enabled=no when disabled", async () => {
      const config: LinghunConfig = {
        ...baseConfig,
        promptCache: { enabled: false, systemTtl: "5m" },
      };
      const output = await formatModelRouteDoctor(makeContext(config));
      expect(output).toContain("- promptCache: enabled=no systemTtl=5m");
    });

    it("shows promptCache systemTtl=1h when configured", async () => {
      const config: LinghunConfig = {
        ...baseConfig,
        promptCache: { enabled: true, systemTtl: "1h" },
      };
      const output = await formatModelRouteDoctor(makeContext(config));
      expect(output).toContain("- promptCache: enabled=yes systemTtl=1h");
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
      expect(output).toContain("cache_control=injected ttl=1h");
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
      expect(output).toContain("cache_control=off");
    });

    it("emits tools-disabled-reason for anthropic_messages provider", async () => {
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
      expect(output).toContain("tools disabled reason:");
      expect(output).toContain("anthropic_messages profile 不支持 OpenAI 风格 tools/tool calling");
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
      expect(output).toContain("endpointProfile decision:");
      expect(output).toContain("source=");
      expect(output).toContain("reason=");
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
      // 写入 max + 25 条事件
      for (let i = 0; i < max + 25; i++) {
        await breakCacheTestHooks.appendEvent(dir, `bulk_${i}`);
      }
      const raw = await readFile(breakCacheTestHooks.paths(dir).eventsLog, "utf8");
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
});
