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
});
