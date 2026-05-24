import { describe, expect, it } from "vitest";
import { formatRuntimeStatusLine } from "./runtime-status-presenter.js";

describe("Polish A runtime status presenter", () => {
  it("shows Chinese model, mode, cache, and index short summaries", () => {
    const line = formatRuntimeStatusLine(
      {
        session: "session-中文-123456",
        provider: "deepseek",
        model: "deepseek-v4-flash",
        endpointProfile: "chat_completions",
        reasoningStatus: "enabled",
        mode: "default",
        background: 1,
        cacheHitRate: 0.92,
        indexStatus: "ready",
        gate: "none",
      },
      "zh-CN",
    );

    expect(line).toContain("模型 deepseek-v4-flash");
    expect(line).toContain("模式 风险确认");
    expect(line).toContain("缓存 92%");
    expect(line).toContain("索引 ready");
    expect(line.length).toBeLessThanOrEqual(100);
  });

  it("shows model and human permission mode without provider internals", () => {
    const line = formatRuntimeStatusLine(
      {
        session: "session-123456",
        provider: "openai-compatible https://api.example.test?api_key=sk-secret",
        model: "gpt-5.5",
        endpointProfile: "responses",
        reasoningStatus: "enabled",
        mode: "auto-review",
        background: 2,
        cacheHitRate: 0.9,
        indexStatus: "ready",
        gate: "none",
      },
      "en-US",
    );

    expect(line).toContain("Model gpt-5.5");
    expect(line).toContain("Mode review edits");
    expect(line).toContain("Cache 90%");
    expect(line).toContain("Index ready");
    expect(line).not.toContain("openai-compatible");
    expect(line).not.toContain("api.example.test");
    expect(line).not.toContain("sk-secret");
    expect(line).not.toContain("responses");
    expect(line).not.toContain("reasoning");
  });

  it("keeps long model and index values within the status line cap", () => {
    const line = formatRuntimeStatusLine(
      {
        session: "session-very-long-id-1234567890",
        provider: "openai-compatible",
        model: "model-name-that-is-intentionally-very-long-for-status-line-display",
        endpointProfile: "responses",
        reasoningStatus: "enabled",
        mode: "full-access",
        background: 12,
        cacheHitRate: 1.2,
        indexStatus: "ready-but-with-a-very-long-diagnostic-suffix-that-should-not-leak",
        gate: "waiting approval",
      },
      "en-US",
    );

    expect(line).toContain("Cache 100%");
    expect(line).toContain("Index read");
    expect(line).not.toContain("diagnostic-suffix");
    expect(line.length).toBeLessThanOrEqual(100);
  });

  it("uses short Chinese labels for the current mode", () => {
    const line = formatRuntimeStatusLine(
      {
        session: "未创建",
        provider: "deepseek",
        model: "deepseek-v4-flash",
        endpointProfile: "chat_completions",
        reasoningStatus: "未生效",
        mode: "plan",
        background: 0,
        cacheHitRate: null,
        indexStatus: "unknown",
        gate: "waiting confirmation",
      },
      "zh-CN",
    );

    expect(line).toContain("模型 deepseek-v4-flash");
    expect(line).toContain("模式 只规划");
    expect(line).toContain("缓存?");
    expect(line).toContain("索引?");
    expect(line).toContain("确认 待确认");
    expect(line.length).toBeLessThanOrEqual(100);
  });
});
