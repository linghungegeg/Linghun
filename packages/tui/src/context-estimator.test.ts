import type { TranscriptEvent } from "@linghun/core";
import type { ModelMessage } from "@linghun/providers";
import { describe, expect, it } from "vitest";
import {
  bytesPerTokenForFileType,
  estimateFileTokens,
  estimateModelMessageChars,
  estimateToolCallsCharsLocal,
  estimateTranscriptContextChars,
  estimateTokensFromBytesForFileType,
  estimateValueChars,
} from "./context-estimator.js";

describe("context-estimator", () => {
  describe("bytesPerTokenForFileType", () => {
    it("uses a tighter JSON estimate and default estimate for other files", () => {
      expect(bytesPerTokenForFileType(".json")).toBe(2);
      expect(bytesPerTokenForFileType("jsonl")).toBe(2);
      expect(bytesPerTokenForFileType(".ts")).toBe(4);
    });

    it("estimates JSON file tokens from extension", () => {
      expect(estimateTokensFromBytesForFileType(100, ".json")).toBe(50);
      expect(estimateTokensFromBytesForFileType(100, ".ts")).toBe(25);
      expect(estimateFileTokens("settings.json", 100)).toBe(50);
    });
  });

  describe("estimateValueChars", () => {
    it("returns 4 for null", () => {
      expect(estimateValueChars(null)).toBe(4);
    });

    it("returns 4 for undefined", () => {
      expect(estimateValueChars(undefined)).toBe(4);
    });

    it("returns string length + 2 for strings (quotes)", () => {
      expect(estimateValueChars("hello")).toBe(7); // 5 + 2
      expect(estimateValueChars("")).toBe(2); // 0 + 2
    });

    it("returns stringified length for numbers", () => {
      expect(estimateValueChars(42)).toBe(2);
      expect(estimateValueChars(3.14)).toBe(4);
      expect(estimateValueChars(-1)).toBe(2);
    });

    it("returns stringified length for booleans", () => {
      expect(estimateValueChars(true)).toBe(4);
      expect(estimateValueChars(false)).toBe(5);
    });

    it("estimates arrays with bracket and comma overhead", () => {
      const result = estimateValueChars([1, 2, 3]);
      // brackets(2) + 3 items each: number_len + 1(comma)
      expect(result).toBeGreaterThan(2);
      expect(result).toBe(2 + (1 + 1) + (1 + 1) + (1 + 1)); // 8
    });

    it("estimates objects with brace, key, colon overhead", () => {
      const result = estimateValueChars({ a: 1 });
      // braces(2) + key_len(1) + 3(quotes+colon) + value(1) + 1(comma) = 8
      expect(result).toBe(8);
    });

    it("caps depth at 8 to prevent stack overflow", () => {
      // Build deeply nested object
      let obj: unknown = "leaf";
      for (let i = 0; i < 12; i++) {
        obj = { nested: obj };
      }
      const result = estimateValueChars(obj);
      // Should not throw and should return a finite number
      expect(result).toBeGreaterThan(0);
      expect(Number.isFinite(result)).toBe(true);
    });

    it("returns 8 for unsupported types (fallback)", () => {
      expect(estimateValueChars(Symbol("test"))).toBe(8);
    });

    it("estimate is not less than simple small payload JSON.stringify length for basic objects", () => {
      const payload = { name: "test", count: 5, active: true };
      const jsonLen = JSON.stringify(payload).length;
      const estimate = estimateValueChars(payload);
      // Estimate should be in the same ballpark — allow up to 2x but not less than 50%
      expect(estimate).toBeGreaterThanOrEqual(jsonLen * 0.5);
    });
  });

  describe("estimateToolCallsCharsLocal", () => {
    it("returns 2 for undefined toolCalls", () => {
      expect(estimateToolCallsCharsLocal(undefined)).toBe(2);
    });

    it("returns 2 for empty toolCalls array", () => {
      expect(estimateToolCallsCharsLocal([])).toBe(2);
    });

    it("estimates non-empty toolCalls with overhead", () => {
      const calls = [{ id: "call_1", name: "readFile", input: { path: "/tmp/test.ts" } }];
      const result = estimateToolCallsCharsLocal(calls);
      // brackets(2) + id_len(6) + name_len(8) + 28 + estimateValueChars(input)
      expect(result).toBeGreaterThan(2 + 6 + 8 + 28);
    });
  });

  describe("estimateModelMessageChars", () => {
    it("estimates user messages by content length", () => {
      const messages: ModelMessage[] = [{ role: "user", content: "hello world" }];
      expect(estimateModelMessageChars(messages)).toBe(11);
    });

    it("estimates assistant messages including toolCalls", () => {
      const messages = [
        {
          role: "assistant" as const,
          content: "done",
          toolCalls: [{ id: "c1", name: "bash", input: { cmd: "ls" } }],
        },
      ] as unknown as ModelMessage[];
      const result = estimateModelMessageChars(messages);
      // content(4) + toolCalls estimate
      expect(result).toBeGreaterThan(4);
    });
  });

  describe("estimateTranscriptContextChars", () => {
    it("sums user_message text lengths", () => {
      const transcript = [
        { type: "user_message" as const, id: "1", text: "hello" },
        { type: "user_message" as const, id: "2", text: "world" },
      ] as unknown as TranscriptEvent[];
      expect(estimateTranscriptContextChars(transcript)).toBe(10);
    });

    it("sums assistant_text_delta text lengths", () => {
      const transcript = [
        { type: "assistant_text_delta" as const, text: "response" },
      ] as unknown as TranscriptEvent[];
      expect(estimateTranscriptContextChars(transcript)).toBe(8);
    });

    it("estimates tool_call_start input", () => {
      const transcript = [
        { type: "tool_call_start" as const, id: "t1", name: "read", input: { path: "/a" } },
      ] as unknown as TranscriptEvent[];
      const result = estimateTranscriptContextChars(transcript);
      expect(result).toBeGreaterThan(0);
    });

    it("estimates tool_result content", () => {
      const transcript = [
        { type: "tool_result" as const, id: "t1", content: "file contents here" },
      ] as unknown as TranscriptEvent[];
      const result = estimateTranscriptContextChars(transcript);
      expect(result).toBeGreaterThan(0);
    });

    it("returns 0 for unknown event types", () => {
      const transcript = [{ type: "unknown_event" }] as unknown as TranscriptEvent[];
      expect(estimateTranscriptContextChars(transcript)).toBe(0);
    });
  });
});
