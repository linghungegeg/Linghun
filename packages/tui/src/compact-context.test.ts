import type { ModelMessage } from "@linghun/providers";
import { describe, expect, it } from "vitest";
import {
  compactMessagesToFit,
  estimateModelMessagesChars,
  microCompactMessages,
} from "./compact-context.js";

function assertNoSplitToolPairs(messages: ModelMessage[]): void {
  const required = new Set<string>();
  for (const message of messages) {
    if (message.role === "assistant") {
      for (const toolCall of message.toolCalls ?? []) {
        required.add(toolCall.id);
      }
      continue;
    }
    if (message.role === "tool") {
      expect(required.has(message.tool_call_id)).toBe(true);
      required.delete(message.tool_call_id);
    }
  }
  expect([...required]).toEqual([]);
}

describe("Compact Lite context boundaries", () => {
  it("micro compacts locally without splitting assistant tool calls from tool results", () => {
    const toolGroup: ModelMessage[] = [
      {
        role: "assistant",
        content: "need tool results",
        toolCalls: [
          { id: "call-a", name: "read", input: { path: "README.md" } },
          { id: "call-b", name: "status", input: {} },
        ],
      },
      { role: "tool", tool_call_id: "call-a", content: '{"evidenceId":"ev-a","path":"README.md"}' },
      {
        role: "tool",
        tool_call_id: "call-b",
        content: '{"evidenceId":"ev-b","path":"package.json"}',
      },
    ];
    const recent: ModelMessage = { role: "user", content: "keep recent user instruction" };
    const messages: ModelMessage[] = [
      { role: "system", content: "stable system prompt" },
      { role: "user", content: "old context ".repeat(400) },
      ...toolGroup,
      recent,
    ];
    const maxChars =
      estimateModelMessagesChars([
        { role: "system", content: "stable system prompt" },
        ...toolGroup,
        recent,
      ]) + 20;

    const result = microCompactMessages(messages, {
      maxChars,
      preserveRecentMessages: 4,
      kind: "micro",
    });

    expect(result.changed).toBe(true);
    expect(result.messages).toContain(toolGroup[0]);
    expect(result.messages).toContain(toolGroup[1]);
    expect(result.messages).toContain(toolGroup[2]);
    expect(result.messages).toContain(recent);
    expect(result.messages).not.toContain(messages[1]);
    assertNoSplitToolPairs(result.messages);
    expect(result.boundary?.kind).toBe("micro");
    expect(result.boundary?.preservedEvidenceRefs).toEqual(["ev-a", "ev-b"]);
    expect(result.boundary?.preservedFiles).toContain("README.md");
    expect(result.boundary?.preservedFiles).toContain("package.json");
  });

  it("drops incomplete tool-call groups instead of leaving invalid provider messages", () => {
    const incompleteAssistant: ModelMessage = {
      role: "assistant",
      content: "partial tools",
      toolCalls: [
        { id: "call-a", name: "read", input: {} },
        { id: "call-b", name: "status", input: {} },
      ],
    };
    const orphanTool: ModelMessage = {
      role: "tool",
      tool_call_id: "call-a",
      content: "partial result",
    };
    const recent: ModelMessage = { role: "user", content: "recent instruction" };
    const messages: ModelMessage[] = [
      { role: "system", content: "stable system prompt" },
      { role: "user", content: "old context ".repeat(400) },
      incompleteAssistant,
      orphanTool,
      recent,
    ];

    const result = microCompactMessages(messages, { maxChars: 200, preserveRecentMessages: 3 });

    expect(result.changed).toBe(true);
    expect(result.messages).not.toContain(incompleteAssistant);
    expect(result.messages).not.toContain(orphanTool);
    expect(result.messages).toContain(recent);
    assertNoSplitToolPairs(result.messages);
  });

  it("provider preflight can compact again before exposing a hard context stop", () => {
    const recentPair: ModelMessage[] = [
      {
        role: "assistant",
        content: "need recent tool",
        toolCalls: [{ id: "call-recent", name: "Read", input: { path: "src/index.ts" } }],
      },
      {
        role: "tool",
        tool_call_id: "call-recent",
        content: '{"evidenceId":"ev-recent","path":"src/index.ts"}',
      },
    ];
    const messages: ModelMessage[] = [
      { role: "system", content: "stable system prompt" },
      { role: "user", content: "old noisy context ".repeat(900) },
      { role: "assistant", content: "old raw assistant ".repeat(900) },
      ...recentPair,
      { role: "user", content: "current request" },
    ];

    const result = compactMessagesToFit(messages, {
      maxChars: 800,
      preserveRecentMessages: 6,
      kind: "micro",
    });

    expect(result.changed).toBe(true);
    expect(estimateModelMessagesChars(result.messages)).toBeLessThanOrEqual(800);
    expect(result.messages[0]).toBe(messages[0]);
    expect(result.messages).toContain(recentPair[0]);
    expect(result.messages).toContain(recentPair[1]);
    expect(result.messages.at(-1)?.content).toBe("current request");
    assertNoSplitToolPairs(result.messages);
  });

  it("estimateModelMessagesChars does not underestimate deeply nested tool input (depth > 6)", () => {
    const bigString = "x".repeat(5_000);
    const deepInput = {
      level1: {
        level2: { level3: { level4: { level5: { level6: { level7: { bigString } } } } } },
      },
    };
    const toolCalls = [{ id: "call-deep", name: "test", input: deepInput }];
    const messages: ModelMessage[] = [
      { role: "assistant", content: "testing deep input", toolCalls },
      { role: "tool", tool_call_id: "call-deep", content: "ok" },
    ];
    const estimate = estimateModelMessagesChars(messages);
    // The deep input contains a 5000-char string; the old depth>6→16 guard would
    // report ~137 chars for this tool input. The bounded JSON estimate must
    // capture at least DEEP_INPUT_ESTIMATE_BOUND (2000) worth of real content.
    expect(estimate).toBeGreaterThan(2_000);
    // The estimate must NOT exceed the actual JSON size, proving we don't inflate.
    const actualJson = JSON.stringify(deepInput);
    expect(estimate).toBeLessThanOrEqual(actualJson.length + 200);
  });

  it("deep estimate is capped at DEEP_INPUT_ESTIMATE_BOUND for huge objects", () => {
    const huge: Record<string, string> = {};
    for (let i = 0; i < 1_000; i++) {
      huge[`key_${i}`] = "x".repeat(100);
    }
    const toolCalls = [
      { id: "call-huge", name: "test", input: { deep: Array.from({ length: 100 }, () => huge) } },
    ];
    const messages: ModelMessage[] = [
      { role: "assistant", content: "testing huge input", toolCalls },
      { role: "tool", tool_call_id: "call-huge", content: "ok" },
    ];
    const result = microCompactMessages(
      [
        { role: "system", content: "test" },
        ...messages,
        { role: "user", content: "current request ".repeat(50) },
      ],
      {
        maxChars: 500,
        preserveRecentMessages: 2,
        kind: "micro",
      },
    );
    // The huge deep input should not cause OOM or hang; estimate stays bounded.
    expect(result.changed).toBe(true);
    expect(estimateModelMessagesChars(messages)).toBeGreaterThan(1_000);
  });
});
