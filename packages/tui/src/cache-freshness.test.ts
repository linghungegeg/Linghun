import type { LinghunConfig } from "@linghun/config";
import { describe, expect, it } from "vitest";
import {
  createCacheFreshness,
  createConfigFreshnessSummary,
  diffFreshness,
  stableHash,
  stableStringify,
} from "./cache-freshness.js";

describe("cache-freshness", () => {
  describe("stableHash", () => {
    it("returns same hash for same input", () => {
      const a = stableHash({ foo: "bar", baz: 42 });
      const b = stableHash({ foo: "bar", baz: 42 });
      expect(a).toBe(b);
    });

    it("returns same hash regardless of key order", () => {
      const a = stableHash({ z: 1, a: 2 });
      const b = stableHash({ a: 2, z: 1 });
      expect(a).toBe(b);
    });

    it("returns different hash for different input", () => {
      const a = stableHash({ foo: "bar" });
      const b = stableHash({ foo: "baz" });
      expect(a).not.toBe(b);
    });

    it("returns a 12-char hex string", () => {
      const hash = stableHash("test");
      expect(hash).toMatch(/^[0-9a-f]{12}$/);
    });
  });

  describe("stableStringify", () => {
    it("stringifies primitives", () => {
      expect(stableStringify("hello")).toBe('"hello"');
      expect(stableStringify(42)).toBe("42");
      expect(stableStringify(true)).toBe("true");
      expect(stableStringify(null)).toBe("null");
    });

    it("stringifies arrays preserving order", () => {
      expect(stableStringify([1, 2, 3])).toBe("[1,2,3]");
    });

    it("stringifies objects with sorted keys", () => {
      const result = stableStringify({ z: 1, a: 2, m: 3 });
      expect(result).toBe("{a:2,m:3,z:1}");
    });

    it("handles nested structures", () => {
      const result = stableStringify({ b: [1, 2], a: { y: "x" } });
      expect(result).toBe('{a:{y:"x"},b:[1,2]}');
    });
  });

  describe("createCacheFreshness", () => {
    it("returns all required hash fields", () => {
      const freshness = createCacheFreshness({
        systemPrompt: "test prompt",
        toolSchema: [{ name: "read" }],
        mcpToolList: [],
        model: "deepseek-v4",
        provider: "deepseek",
      });
      expect(freshness.systemPromptHash).toMatch(/^[0-9a-f]{12}$/);
      expect(freshness.toolSchemaHash).toMatch(/^[0-9a-f]{12}$/);
      expect(freshness.mcpToolListHash).toMatch(/^[0-9a-f]{12}$/);
      expect(freshness.modelProviderHash).toMatch(/^[0-9a-f]{12}$/);
      expect(freshness.reasoningEffortHash).toMatch(/^[0-9a-f]{12}$/);
      expect(freshness.projectRulesHash).toMatch(/^[0-9a-f]{12}$/);
      expect(freshness.memoryHash).toMatch(/^[0-9a-f]{12}$/);
      expect(freshness.compactHash).toMatch(/^[0-9a-f]{12}$/);
      expect(freshness.pluginListHash).toMatch(/^[0-9a-f]{12}$/);
      expect(freshness.changedKeys).toEqual([]);
    });

    it("uses precomputed toolSchemaHash when provided", () => {
      const precomputed = "abcdef123456";
      const freshness = createCacheFreshness({
        systemPrompt: "x",
        toolSchema: [{ name: "write" }],
        mcpToolList: [],
        model: "m",
        provider: "p",
        _precomputedToolSchemaHash: precomputed,
      });
      expect(freshness.toolSchemaHash).toBe(precomputed);
    });

    it("produces deterministic output for same input", () => {
      const input = {
        systemPrompt: "prompt",
        toolSchema: [{ name: "bash" }],
        mcpToolList: [{ server: "s", name: "t" }],
        model: "model-a",
        provider: "provider-a",
        reasoningEffort: "high",
        projectRules: "rules",
        memory: "mem",
        compact: { compacted: true },
        plugins: ["p1"],
      };
      const a = createCacheFreshness(input);
      const b = createCacheFreshness(input);
      expect(a).toEqual(b);
    });
  });

  describe("diffFreshness", () => {
    it("returns empty array when previous is undefined", () => {
      const current = createCacheFreshness({
        systemPrompt: "x",
        toolSchema: [],
        mcpToolList: [],
        model: "m",
        provider: "p",
      });
      expect(diffFreshness(undefined, current)).toEqual([]);
    });

    it("returns empty array when nothing changed", () => {
      const freshness = createCacheFreshness({
        systemPrompt: "x",
        toolSchema: [],
        mcpToolList: [],
        model: "m",
        provider: "p",
      });
      expect(diffFreshness(freshness, freshness)).toEqual([]);
    });

    it("detects changed keys", () => {
      const prev = createCacheFreshness({
        systemPrompt: "old",
        toolSchema: [],
        mcpToolList: [],
        model: "m",
        provider: "p",
      });
      const curr = createCacheFreshness({
        systemPrompt: "new",
        toolSchema: [],
        mcpToolList: [],
        model: "m",
        provider: "p",
      });
      const changed = diffFreshness(prev, curr);
      expect(changed).toContain("systemPromptHash");
      expect(changed).not.toContain("toolSchemaHash");
    });
  });

  describe("D.13H context editing dimensions", () => {
    it("D.13H cache freshness exposes contextEditing and cacheEditingBeta hashes without regressing existing keys", () => {
      const baseInput = {
        systemPrompt: "system",
        toolSchema: [{ name: "Read" }],
        mcpToolList: [],
        model: "claude-3-5-sonnet-latest",
        provider: "claude-relay",
        reasoningEffort: "default",
        projectRules: "rules",
        memory: "mem",
        compact: { compacted: false },
        plugins: [],
        endpointProfile: "anthropic_messages",
        cacheControl: { type: "ephemeral" },
        cacheTtl: "5m",
        contextEditing: { enabled: false, sendable: false },
        cacheEditingBeta: { count: 0 },
      };
      const fresh = createCacheFreshness(baseInput);
      // 新维度
      expect(fresh.contextEditingHash).toMatch(/^[0-9a-f]{12}$/);
      expect(fresh.cacheEditingBetaHash).toMatch(/^[0-9a-f]{12}$/);
      // D.13F 既有维度仍存在
      expect(fresh.endpointProfileHash).toMatch(/^[0-9a-f]{12}$/);
      expect(fresh.cacheControlHash).toMatch(/^[0-9a-f]{12}$/);
      expect(fresh.cacheTtlHash).toMatch(/^[0-9a-f]{12}$/);
      // 原 9 维度仍存在
      expect(fresh.systemPromptHash).toMatch(/^[0-9a-f]{12}$/);
      expect(fresh.toolSchemaHash).toMatch(/^[0-9a-f]{12}$/);
      expect(fresh.mcpToolListHash).toMatch(/^[0-9a-f]{12}$/);
      expect(fresh.modelProviderHash).toMatch(/^[0-9a-f]{12}$/);
      expect(fresh.reasoningEffortHash).toMatch(/^[0-9a-f]{12}$/);
      expect(fresh.projectRulesHash).toMatch(/^[0-9a-f]{12}$/);
      expect(fresh.memoryHash).toMatch(/^[0-9a-f]{12}$/);
      expect(fresh.compactHash).toMatch(/^[0-9a-f]{12}$/);
      expect(fresh.pluginListHash).toMatch(/^[0-9a-f]{12}$/);

      // 改 contextEditing → diff 必须包含 contextEditingHash，其它键不应被错误标记。
      const after = createCacheFreshness({
        ...baseInput,
        contextEditing: { enabled: true, sendable: false },
      });
      const changed = diffFreshness(fresh, after);
      expect(changed).toContain("contextEditingHash");
      expect(changed).not.toContain("cacheEditingBetaHash");
      expect(changed).not.toContain("systemPromptHash");
      expect(changed).not.toContain("toolSchemaHash");

      // 改 cacheEditingBeta → diff 必须包含 cacheEditingBetaHash。
      const after2 = createCacheFreshness({
        ...baseInput,
        cacheEditingBeta: { count: 1 },
      });
      const changed2 = diffFreshness(fresh, after2);
      expect(changed2).toContain("cacheEditingBetaHash");
      expect(changed2).not.toContain("contextEditingHash");

      // 不传新维度时仍按 "none" 处理，hash 稳定（默认值确定）。
      const minimal = createCacheFreshness({
        systemPrompt: "x",
        toolSchema: [],
        mcpToolList: [],
        model: "m",
        provider: "p",
      });
      expect(minimal.contextEditingHash).toMatch(/^[0-9a-f]{12}$/);
      expect(minimal.cacheEditingBetaHash).toMatch(/^[0-9a-f]{12}$/);
      const minimal2 = createCacheFreshness({
        systemPrompt: "x",
        toolSchema: [],
        mcpToolList: [],
        model: "m",
        provider: "p",
      });
      expect(minimal2.contextEditingHash).toBe(minimal.contextEditingHash);
      expect(minimal2.cacheEditingBetaHash).toBe(minimal.cacheEditingBetaHash);
    });
  });

  describe("D.13I deferred tool list dimension", () => {
    it("D.13I deferredToolListHash 与 toolSchemaHash 解耦：fixed schema 稳定，deferred 列表变化才改 deferredToolListHash", () => {
      const baseToolSchema = [
        { name: "Read" },
        { name: "Write" },
        { name: "SearchExtraTools" },
        { name: "ExecuteExtraTool" },
      ];
      const baseInput = {
        systemPrompt: "system",
        toolSchema: baseToolSchema,
        mcpToolList: [],
        model: "claude-3-5-sonnet-latest",
        provider: "claude-relay",
        deferredToolList: [
          { name: "mcp__codebase-memory-mcp__trace_path", kind: "codebase-memory", executable: true, requiredArgs: ["function_name"] },
        ],
      };
      const fresh = createCacheFreshness(baseInput);
      expect(fresh.deferredToolListHash).toMatch(/^[0-9a-f]{12}$/);

      // 改 deferred 列表 → 仅 deferredToolListHash 变化；toolSchemaHash 不动。
      const after = createCacheFreshness({
        ...baseInput,
        deferredToolList: [
          { name: "mcp__codebase-memory-mcp__trace_path", kind: "codebase-memory", executable: true, requiredArgs: ["function_name"] },
          { name: "mcp__some-mcp__tool_x", kind: "mcp", executable: false, requiredArgs: [] },
        ],
      });
      const changed = diffFreshness(fresh, after);
      expect(changed).toContain("deferredToolListHash");
      expect(changed).not.toContain("toolSchemaHash");
      expect(changed).not.toContain("mcpToolListHash");

      // 改固定 toolSchema（builtIn + dispatch 两件套数量变化）→ toolSchemaHash 变化，deferredToolListHash 不动。
      const after2 = createCacheFreshness({
        ...baseInput,
        toolSchema: [...baseToolSchema, { name: "FAKE_NEW_BUILTIN" }],
      });
      const changed2 = diffFreshness(fresh, after2);
      expect(changed2).toContain("toolSchemaHash");
      expect(changed2).not.toContain("deferredToolListHash");

      // 不传 deferredToolList 时按 "none" 处理，hash 稳定。
      const minimal = createCacheFreshness({
        systemPrompt: "x",
        toolSchema: [],
        mcpToolList: [],
        model: "m",
        provider: "p",
      });
      const minimal2 = createCacheFreshness({
        systemPrompt: "x",
        toolSchema: [],
        mcpToolList: [],
        model: "m",
        provider: "p",
      });
      expect(minimal.deferredToolListHash).toBe(minimal2.deferredToolListHash);
    });
  });

  describe("createConfigFreshnessSummary", () => {
    it("produces deterministic summary for same config", () => {
      const config = {
        language: "zh-CN",
        permission: "ask",
        index: { enabled: true },
        defaultModel: "deepseek-v4",
        modelRoutes: {},
        providers: {
          deepseek: {
            type: "deepseek",
            model: "deepseek-v4",
            baseUrl: "https://api.deepseek.com",
            apiKey: "sk-xxx",
            endpointProfile: "default",
            compatibilityProfile: "standard",
            supportsTools: true,
          },
        },
      } as unknown as LinghunConfig;
      const a = createConfigFreshnessSummary(config);
      const b = createConfigFreshnessSummary(config);
      expect(a).toEqual(b);
    });

    it("redacts apiKey and baseUrl to configured/missing", () => {
      const config = {
        language: "en-US",
        permission: "ask",
        index: {},
        defaultModel: "m",
        modelRoutes: {},
        providers: {
          test: {
            type: "openai",
            model: "gpt-4",
            baseUrl: "https://example.com",
            apiKey: "secret-key-123",
            endpointProfile: "default",
            compatibilityProfile: "standard",
            supportsTools: true,
          },
        },
      } as unknown as LinghunConfig;
      const summary = createConfigFreshnessSummary(config) as Record<
        string,
        Record<string, Record<string, string>>
      >;
      expect(summary.providers.test.baseUrl).toBe("configured");
      expect(summary.providers.test.apiKey).toBe("configured");
    });

    it("marks missing baseUrl and apiKey", () => {
      const config = {
        language: "en-US",
        permission: "ask",
        index: {},
        defaultModel: "m",
        modelRoutes: {},
        providers: {
          test: {
            type: "openai",
            model: "gpt-4",
            baseUrl: "",
            apiKey: "",
            endpointProfile: "default",
            compatibilityProfile: "standard",
            supportsTools: true,
          },
        },
      } as unknown as LinghunConfig;
      const summary = createConfigFreshnessSummary(config) as Record<
        string,
        Record<string, Record<string, string>>
      >;
      expect(summary.providers.test.baseUrl).toBe("missing");
      expect(summary.providers.test.apiKey).toBe("missing");
    });
  });

  describe("D.13P createCacheState provider boundary", () => {
    it("does not hardcode deepseek/deepseek-v4-flash when model is unspecified", async () => {
      const { createCacheState } = await import("./tui-state-runtime.js");
      const stateDefault = createCacheState("/tmp/no-real-project");
      // 默认 model 应为 unknown 占位，provider 也不再硬编码 deepseek。
      // 通过 modelProviderHash 比对 unknown:unknown 与硬编码 deepseek:deepseek-v4-flash
      // 应不一致，保证 Claude / OpenAI-compatible 场景下 cache freshness 不会被误染成 DeepSeek。
      const expectedUnknownHash = stableHash("unknown:unknown");
      expect(stateDefault.lastFreshness?.modelProviderHash).toBe(expectedUnknownHash);
      const legacyHardcodedHash = stableHash("deepseek:deepseek-v4-flash");
      expect(stateDefault.lastFreshness?.modelProviderHash).not.toBe(legacyHardcodedHash);
    });

    it("derives provider from model prefix (deepseek-* → deepseek)", async () => {
      const { createCacheState } = await import("./tui-state-runtime.js");
      const dsState = createCacheState("/tmp/p", "deepseek-chat");
      expect(dsState.lastFreshness?.modelProviderHash).toBe(
        stableHash("deepseek:deepseek-chat"),
      );
      const claudeState = createCacheState("/tmp/p", "claude-opus-4-7");
      // 非 deepseek-* 前缀不再被误染成 DeepSeek。
      expect(claudeState.lastFreshness?.modelProviderHash).toBe(
        stableHash("unknown:claude-opus-4-7"),
      );
    });
  });
});
