import { describe, expect, it } from "vitest";
import {
  buildBtwMessages,
  classifyBtwIntent,
  extractBtwResult,
  runBtwSideQuestion,
} from "./btw-runtime.js";

describe("D.14D btw-runtime", () => {
  it("discards partial visible state when the provider resets its attempt", async () => {
    const gateway = {
      async *stream(
        _provider: string,
        _request: unknown,
        _signal: AbortSignal,
        control?: { onAttemptReset?: () => void },
      ) {
        yield { type: "assistant_text_delta", id: "old", text: "OLD_PARTIAL" };
        yield { type: "assistant_thinking_delta", id: "old", text: "old thinking" };
        control?.onAttemptReset?.();
        yield { type: "assistant_text_delta", id: "new", text: "NEW_COMPLETE" };
        yield { type: "message_stop", id: "new", chunkCount: 1, hadUsage: false };
      },
    };

    const result = await runBtwSideQuestion(
      "question",
      gateway as never,
      {
        provider: "test-provider",
        model: "test-model",
        endpointProfile: "chat_completions",
        reasoningSent: false,
      },
      "en-US",
      new AbortController().signal,
    );

    expect(result).toEqual({ status: "answered", answer: "NEW_COMPLETE" });
  });

  describe("buildBtwMessages", () => {
    it("builds an isolated system+user pair without injecting runtime/internal tokens", () => {
      const messages = buildBtwMessages("解释这段逻辑", "zh-CN");
      expect(messages).toHaveLength(2);
      expect(messages[0]?.role).toBe("system");
      expect(messages[1]).toEqual({ role: "user", content: "解释这段逻辑" });
      const joined = messages.map((m) => m.content).join("\n");
      // side question 不得携带主链内部字段。
      expect(joined).not.toContain("RuntimeStatusForModel");
      expect(joined).not.toContain("EvidenceSummary");
      expect(joined).not.toContain("ControlledMemorySummary");
      expect(joined).not.toContain("CommandCapabilitySummary");
    });

    it("uses an English isolation prompt for en-US", () => {
      const messages = buildBtwMessages("explain this", "en-US");
      expect(messages[0]?.content).toContain("side question");
      expect(messages[0]?.content).toContain("do not call any tools");
    });
  });

  describe("extractBtwResult", () => {
    it("returns answered for non-empty text", () => {
      const result = extractBtwResult({ text: "  这是答案  ", hadThinking: false }, "zh-CN");
      expect(result).toEqual({ status: "answered", answer: "这是答案" });
    });

    it("surfaces provider errors as visible error", () => {
      const result = extractBtwResult(
        { text: "", hadThinking: false, providerError: "quota exceeded" },
        "zh-CN",
      );
      expect(result).toEqual({ status: "error", error: "quota exceeded" });
    });

    it("downgrades thinking-only empty responses to a visible error, not a fake answer", () => {
      const result = extractBtwResult({ text: "", hadThinking: true }, "zh-CN");
      expect(result.status).toBe("error");
      if (result.status === "error") {
        expect(result.error).toContain("内部思考");
      }
    });

    it("downgrades empty responses to a visible error", () => {
      const result = extractBtwResult({ text: "   ", hadThinking: false }, "en-US");
      expect(result.status).toBe("error");
      if (result.status === "error") {
        expect(result.error).toContain("empty response");
      }
    });
  });

  describe("classifyBtwIntent", () => {
    it("routes readonly status intent to local status answers", () => {
      expect(
        classifyBtwIntent({
          action: "execute_readonly",
          confidence: 0.9,
          reason: "readonly status",
          candidates: [],
          language: "zh-CN",
          inquiry: "status",
          runtimeIntent: { kind: "runtime_status_query", subject: "current_work" },
          riskHandler: "readonly",
        }),
      ).toBe("status_query");
    });

    it("does not inspect question text to infer status", () => {
      expect(
        classifyBtwIntent({
          action: "execute_readonly",
          confidence: 0.9,
          reason: "readonly status",
          candidates: [],
          language: "zh-CN",
          inquiry: "status",
          runtimeIntent: { kind: "none" },
          riskHandler: "readonly",
        }),
      ).toBe("general_side_question");
    });

    it("keeps non-status questions model-backed", () => {
      expect(
        classifyBtwIntent({
          action: "model",
          confidence: 0,
          reason: "no catalog match",
          candidates: [],
          language: "zh-CN",
          inquiry: "howto",
          riskHandler: "model",
        }),
      ).toBe("general_side_question");
    });
  });
});
