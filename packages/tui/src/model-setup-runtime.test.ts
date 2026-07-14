import { describe, expect, it } from "vitest";
import {
  type PendingModelSetup,
  applyModelSetupValues,
  formatModelSetupFallbackError,
  formatModelSetupMessage,
  formatModelSetupSaved,
  formatModelSetupSummary,
  getModelSetupPromptMessage,
  getNextModelSetupStep,
  looksLikeModelSetupInput,
  normalizeModelSetupProviderType,
  normalizeModelSetupReasoningLevel,
  parseModelSetupPrefill,
  validateModelSetupPartial,
} from "./model-setup-runtime.js";

describe("model-setup-runtime", () => {
  describe("getNextModelSetupStep", () => {
    it("returns provider when no values", () => {
      expect(getNextModelSetupStep({})).toBe("provider");
    });
    it("returns apiKey when baseUrl present", () => {
      expect(
        getNextModelSetupStep({
          providerType: "openai-compatible",
          baseUrl: "https://api.example.com/v1",
        }),
      ).toBe("apiKey");
    });
    it("returns model when baseUrl and apiKey present", () => {
      expect(
        getNextModelSetupStep({
          providerType: "openai-compatible",
          baseUrl: "https://api.example.com/v1",
          apiKey: "sk-test",
        }),
      ).toBe("model");
    });
    it("returns reasoning when baseUrl, apiKey, model present", () => {
      expect(
        getNextModelSetupStep({
          baseUrl: "https://api.example.com/v1",
          providerType: "openai-compatible",
          apiKey: "sk-test",
          model: "gpt-4o",
        }),
      ).toBe("reasoning");
    });
    it("returns confirm when all required fields present", () => {
      expect(
        getNextModelSetupStep({
          baseUrl: "https://api.example.com/v1",
          providerType: "openai-compatible",
          apiKey: "sk-test",
          model: "gpt-4o",
          reasoningLevel: "Medium",
        }),
      ).toBe("confirm");
    });
    it("skips configurable reasoning for Grok", () => {
      expect(
        getNextModelSetupStep({
          providerType: "grok",
          baseUrl: "https://api.example.com/v1",
          apiKey: "sk-test",
          model: "grok-4.20-reasoning",
        }),
      ).toBe("confirm");
    });
  });

  describe("parseModelSetupPrefill", () => {
    it("extracts URL", () => {
      const result = parseModelSetupPrefill("配置 https://api.deepseek.com/v1");
      expect(result.baseUrl).toBe("https://api.deepseek.com/v1");
    });
    it("extracts native provider type", () => {
      expect(parseModelSetupPrefill("provider=gemini").providerType).toBe("gemini");
      expect(normalizeModelSetupProviderType("grok")).toBe("grok");
      expect(normalizeModelSetupProviderType("openai")).toBe("openai-compatible");
      expect(() => normalizeModelSetupProviderType("unknown")).toThrow("provider 可选");
    });
    it("extracts model name", () => {
      const result = parseModelSetupPrefill("model=deepseek-chat");
      expect(result.model).toBe("deepseek-chat");
    });
    it("extracts model name with Chinese keyword", () => {
      const result = parseModelSetupPrefill("模型：gpt-4o");
      expect(result.model).toBe("gpt-4o");
    });
    it("extracts extended reasoning levels case-insensitively", () => {
      expect(parseModelSetupPrefill("reasoning=xhigh").reasoningLevel).toBe("XHigh");
      expect(parseModelSetupPrefill("reasoning=MAX").reasoningLevel).toBe("Max");
    });
    it("extracts API key with sk- prefix", () => {
      const result = parseModelSetupPrefill("sk-abcdefgh12345678");
      expect(result.apiKey).toBe("sk-abcdefgh12345678");
    });
    it("extracts API key with explicit keyword", () => {
      const result = parseModelSetupPrefill("apikey=my-secret-key-value");
      expect(result.apiKey).toBe("my-secret-key-value");
    });
    it("extracts multiple fields from one line", () => {
      const result = parseModelSetupPrefill(
        "https://api.example.com/v1 model=gpt-4o reasoning=Low",
      );
      expect(result.baseUrl).toBe("https://api.example.com/v1");
      expect(result.model).toBe("gpt-4o");
      expect(result.reasoningLevel).toBe("Low");
    });
    it("returns empty for unrelated text", () => {
      const result = parseModelSetupPrefill("hello world");
      expect(result).toEqual({});
    });
  });

  describe("normalizeModelSetupReasoningLevel", () => {
    it("normalizes Low", () => {
      expect(normalizeModelSetupReasoningLevel("low")).toBe("Low");
      expect(normalizeModelSetupReasoningLevel("Low")).toBe("Low");
      expect(normalizeModelSetupReasoningLevel("低")).toBe("Low");
    });
    it("normalizes High", () => {
      expect(normalizeModelSetupReasoningLevel("high")).toBe("High");
      expect(normalizeModelSetupReasoningLevel("High")).toBe("High");
      expect(normalizeModelSetupReasoningLevel("高")).toBe("High");
    });
    it("normalizes Medium, XHigh, and Max", () => {
      expect(normalizeModelSetupReasoningLevel("medium")).toBe("Medium");
      expect(normalizeModelSetupReasoningLevel("中")).toBe("Medium");
      expect(normalizeModelSetupReasoningLevel("xHiGh")).toBe("XHigh");
      expect(normalizeModelSetupReasoningLevel("MAX")).toBe("Max");
    });
    it("rejects unsupported levels instead of falling back to Medium", () => {
      expect(() => normalizeModelSetupReasoningLevel("anything")).toThrow(
        "Low / Medium / High / XHigh / Max",
      );
    });
  });

  describe("looksLikeModelSetupInput", () => {
    it("matches Chinese setup phrases", () => {
      expect(looksLikeModelSetupInput("配置模型")).toBe(true);
      expect(looksLikeModelSetupInput("我要配置模型")).toBe(true);
      expect(looksLikeModelSetupInput("设置 api key")).toBe(true);
    });
    it("matches English setup phrases", () => {
      expect(looksLikeModelSetupInput("model setup")).toBe(true);
      expect(looksLikeModelSetupInput("configure model")).toBe(true);
      expect(looksLikeModelSetupInput("setup provider")).toBe(true);
    });
    it("matches when prefill data is present", () => {
      expect(looksLikeModelSetupInput("https://api.example.com/v1")).toBe(true);
    });
    it("rejects unrelated text", () => {
      expect(looksLikeModelSetupInput("hello world")).toBe(false);
      expect(looksLikeModelSetupInput("fix the bug")).toBe(false);
    });
    it("handles diagnostic-like text with prefill", () => {
      expect(looksLikeModelSetupInput("模型正常吗？")).toBe(false);
      expect(looksLikeModelSetupInput("模型正常吗？ https://api.example.com/v1")).toBe(true);
    });
  });

  describe("applyModelSetupValues", () => {
    it("merges values into setup", () => {
      const setup: PendingModelSetup = {
        step: "baseUrl",
        providerEnvPath: "/tmp/provider.env",
        createdTemplate: false,
        values: {},
      };
      applyModelSetupValues(setup, { baseUrl: "https://api.example.com/v1" });
      expect(setup.values.baseUrl).toBe("https://api.example.com/v1");
    });
    it("preserves existing values when merging", () => {
      const setup: PendingModelSetup = {
        step: "apiKey",
        providerEnvPath: "/tmp/provider.env",
        createdTemplate: false,
        values: { baseUrl: "https://api.example.com/v1" },
      };
      applyModelSetupValues(setup, { apiKey: "sk-test12345678" });
      expect(setup.values.baseUrl).toBe("https://api.example.com/v1");
      expect(setup.values.apiKey).toBe("sk-test12345678");
    });
  });

  describe("validateModelSetupPartial", () => {
    it("does not throw for valid partial values", () => {
      expect(() =>
        validateModelSetupPartial({ baseUrl: "https://api.example.com/v1" }),
      ).not.toThrow();
    });
    it("does not throw for empty values", () => {
      expect(() => validateModelSetupPartial({})).not.toThrow();
    });
    it("validates only supplied partial fields", () => {
      expect(() => validateModelSetupPartial({ baseUrl: "not-a-url" })).toThrow();
      expect(() => validateModelSetupPartial({ apiKey: "" })).toThrow();
      expect(() => validateModelSetupPartial({ model: "" })).toThrow();
    });
  });

  describe("formatModelSetupMessage", () => {
    const setup: PendingModelSetup = {
      step: "baseUrl",
      providerEnvPath: "/home/user/.linghun/provider.env",
      createdTemplate: true,
      values: {},
    };

    it("returns Chinese intro message", () => {
      const msg = formatModelSetupMessage("intro", "zh-CN", setup);
      expect(msg).toContain("模型配置向导");
      expect(msg).toContain("provider.env");
    });
    it("returns English intro message", () => {
      const msg = formatModelSetupMessage("intro", "en-US", setup);
      expect(msg).toContain("Model setup wizard");
      expect(msg).toContain("provider.env");
    });
    it("offers extended levels only for openai-compatible setup", () => {
      const openAi = formatModelSetupMessage("reasoningPrompt", "en-US", {
        ...setup,
        values: { providerType: "openai-compatible" },
      });
      const gemini = formatModelSetupMessage("reasoningPrompt", "en-US", {
        ...setup,
        values: { providerType: "gemini" },
      });
      expect(openAi).toContain("Low / Medium / High / XHigh / Max");
      expect(gemini).toContain("Low / Medium / High");
      expect(gemini).not.toContain("XHigh");
      expect(gemini).not.toContain("Max");
    });
    it("returns baseUrl prompt in Chinese", () => {
      const msg = formatModelSetupMessage("baseUrlPrompt", "zh-CN", setup);
      expect(msg).toContain("API 地址");
    });
    it("returns cancelled message", () => {
      const msg = formatModelSetupMessage("cancelled", "zh-CN", setup);
      expect(msg).toContain("已取消");
    });
    it("returns details with safety notes", () => {
      const msg = formatModelSetupMessage("details", "en-US", setup);
      expect(msg).toContain("Safety notes");
      expect(msg).toContain("provider.env path");
    });
  });

  describe("getModelSetupPromptMessage", () => {
    it("returns the correct prompt for current step", () => {
      const setup: PendingModelSetup = {
        step: "apiKey",
        providerEnvPath: "/tmp/provider.env",
        createdTemplate: false,
        values: { baseUrl: "https://api.example.com/v1" },
      };
      const msg = getModelSetupPromptMessage(setup, "zh-CN");
      expect(msg).toContain("API key");
    });
  });

  describe("formatModelSetupSummary", () => {
    it("shows present/missing status without raw key", () => {
      const setup: PendingModelSetup = {
        step: "confirm",
        providerEnvPath: "/tmp/provider.env",
        createdTemplate: false,
        values: {
          providerType: "gemini",
          baseUrl: "https://api.example.com/v1",
          apiKey: "sk-secret-key-12345678",
          model: "gpt-4o",
          reasoningLevel: "Medium",
        },
      };
      const msg = formatModelSetupSummary(setup, "zh-CN");
      expect(msg).toContain("base URL present");
      expect(msg).toContain("api key present");
      expect(msg).toContain("model gpt-4o");
      expect(msg).toContain("provider gemini");
      expect(msg).not.toContain("sk-secret-key-12345678");
    });
    it("shows missing for absent values", () => {
      const setup: PendingModelSetup = {
        step: "confirm",
        providerEnvPath: "/tmp/provider.env",
        createdTemplate: false,
        values: {},
      };
      const msg = formatModelSetupSummary(setup, "en-US");
      expect(msg).toContain("base URL missing");
      expect(msg).toContain("api key missing");
      expect(msg).toContain("model missing");
    });
  });

  describe("formatModelSetupSaved", () => {
    it("includes path and restart instruction in Chinese", () => {
      const msg = formatModelSetupSaved("/home/user/.linghun/provider.env", "zh-CN");
      expect(msg).toContain("已保存");
      expect(msg).toContain("/home/user/.linghun/provider.env");
      expect(msg).toContain("重启");
    });
    it("includes path and restart instruction in English", () => {
      const msg = formatModelSetupSaved("/home/user/.linghun/provider.env", "en-US");
      expect(msg).toContain("Saved");
      expect(msg).toContain("/home/user/.linghun/provider.env");
      expect(msg).toContain("Restart");
    });
  });

  describe("formatModelSetupFallbackError", () => {
    it("returns Chinese error", () => {
      expect(formatModelSetupFallbackError("zh-CN")).toContain("检查未通过");
    });
    it("returns English error", () => {
      expect(formatModelSetupFallbackError("en-US")).toContain("Validation failed");
    });
  });
});
