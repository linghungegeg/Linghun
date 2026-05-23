import { describe, expect, it } from "vitest";
import { formatRuntimeStatusLine } from "./runtime-status-presenter.js";

describe("Polish A runtime status presenter", () => {
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
    expect(line).not.toContain("openai-compatible");
    expect(line).not.toContain("api.example.test");
    expect(line).not.toContain("sk-secret");
    expect(line).not.toContain("responses");
    expect(line).not.toContain("reasoning");
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
    expect(line).toContain("确认 待确认");
    expect(line.length).toBeLessThanOrEqual(100);
  });
});
