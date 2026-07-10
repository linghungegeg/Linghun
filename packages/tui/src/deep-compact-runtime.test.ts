import type { ModelMessage } from "@linghun/providers";
import { describe, expect, it } from "vitest";
import {
  buildDeepCompactRequestMessages,
  createDeepCompactPacket,
  formatDeepCompactPromptSummary,
  injectDeepCompactSummary,
  insertAfterLeadingSystemMessages,
  isDeepCompactPacket,
} from "./deep-compact-runtime.js";
import type { DeepCompactPacket } from "./tui-data-types.js";

function makePacket(): DeepCompactPacket {
  return {
    id: "deep-test",
    kind: "deep",
    scope: "full transcript semantic compact",
    summary: "older conversation summary",
    preservedEvidenceRefs: [],
    preservedFiles: [],
    activeAgentsWorkflows: [],
    needsAttentionAgentsWorkflows: [],
    staleResumableAgentsWorkflows: [],
    pendingItems: [],
    decisions: [],
    risks: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    model: "gpt-test",
    provider: "openai-compatible",
    trigger: "request",
    transcriptEventCount: 10,
  };
}

describe("deep compact prompt insertion", () => {
  it("inserts compact continuity and optional restore context after all leading system segments", () => {
    const messages: ModelMessage[] = [
      { role: "system", content: "stable system" },
      { role: "system", content: "dynamic system" },
      { role: "user", content: "Context compact projection\nstable recent summary" },
      { role: "user", content: "current request" },
    ];

    const result = injectDeepCompactSummary(messages, makePacket(), [
      { role: "user", content: "Post-compact restored context\nfile src/foo.ts" },
    ]);

    expect(result.map((message) => message.role)).toEqual([
      "system",
      "system",
      "user",
      "user",
      "user",
      "user",
    ]);
    expect(result[0]?.content).toBe("stable system");
    expect(result[1]?.content).toBe("dynamic system");
    expect(result[2]?.content).toContain("Deep compact context");
    expect(result[2]?.content).toContain("latest user request");
    expect(result[2]?.content).not.toContain("[Deep compact diagnostics]");
    expect(result[2]?.content).not.toContain("id deep-test");
    expect(result[3]?.content).toContain("Context compact projection");
    expect(result[4]?.content).toContain("Post-compact restored context");
    expect(result[5]?.content).toBe("current request");
  });

  it("keeps dynamic packet diagnostics out of the stable provider prefix", () => {
    const text = formatDeepCompactPromptSummary(makePacket()) ?? "";

    expect(text).toContain("Deep compact context");
    expect(text).toContain("scope full transcript semantic compact");
    expect(text).not.toContain("deep-test");
    expect(text).not.toContain("created at");
    expect(text).not.toContain("[Deep compact diagnostics]");
    expect(text).not.toContain("id deep-test");
    expect(text).not.toContain("created at 2026-01-01T00:00:00.000Z");
  });

  it("accepts old deep compact packets without new fidelity fields", () => {
    expect(isDeepCompactPacket(makePacket())).toBe(true);
  });

  it("keeps high-fidelity packet fields in the compact continuity prompt", () => {
    const context = {
      projectPath: process.cwd(),
      evidence: [{ id: "ev-read", source: "packages/tui/src/foo.ts", summary: "read foo" }],
      recentlyMentionedFiles: ["packages/tui/src/foo.ts"],
      tools: { changedFiles: ["packages/tui/src/foo.ts"], todos: [] },
      agents: [],
      backgroundTasks: [],
      workflows: { runs: [] },
      todos: [],
      routeDecisions: [],
      cache: {},
      failureLearning: { records: [] },
      memory: { accepted: [] },
      index: {},
    } as never;

    const packet = createDeepCompactPacket({
      context,
      summary: "narrative keep exact goals",
      runtime: { model: "gpt-test", provider: "test-provider", role: "main" } as never,
      trigger: "request",
      transcript: [
        { type: "user_message", id: "u1", text: "please preserve exact migration target", createdAt: "2026-01-01T00:00:00.000Z" },
        {
          type: "tool_result",
          toolUseId: "tool-1",
          toolName: "Read",
          content: "```ts\nexport const answer = 42;\n```",
          evidenceId: "ev-read",
          createdAt: "2026-01-01T00:00:01.000Z",
        },
      ],
    });

    expect(packet.userMessagesVerbatim).toEqual(["please preserve exact migration target"]);
    expect(packet.toolResultSummaries?.[0]).toContain("tool_result:Read");
    expect(packet.codeSnippets?.[0]).toContain("export const answer = 42");
    const prompt = formatDeepCompactPromptSummary(packet) ?? "";
    expect(prompt).toContain("user messages verbatim please preserve exact migration target");
    expect(prompt).toContain("tool result summaries tool_result:Read");
    expect(prompt).toContain("code snippets ```ts export const answer = 42; ```");
  });

  it("still inserts at the front when no system prefix exists", () => {
    const result = insertAfterLeadingSystemMessages(
      [{ role: "user", content: "current request" }],
      { role: "user", content: "compact summary" },
    );

    expect(result.map((message) => message.content)).toEqual([
      "compact summary",
      "current request",
    ]);
  });

  it("summarizes cyclic tool results before the compact provider request", () => {
    const cyclic: { rows: string[]; self?: unknown } = {
      rows: Array.from({ length: 20_000 }, (_, index) => `row-${index}`),
    };
    cyclic.self = cyclic;
    const context = {
      projectPath: process.cwd(),
      evidence: [],
      recentlyMentionedFiles: [],
      tools: { changedFiles: [], todos: [] },
      agents: [],
      backgroundTasks: [],
      workflows: { runs: [] },
      todos: [],
      routeDecisions: [],
      cache: {},
      failureLearning: { records: [] },
      memory: { accepted: [] },
      index: {},
    } as never;

    const messages = buildDeepCompactRequestMessages(
      context,
      [
        {
          type: "user_message",
          text: "please investigate oom",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          type: "tool_result",
          toolName: "Read",
          toolUseId: "tool-1",
          content: cyclic,
          isError: false,
          createdAt: "2026-01-01T00:00:01.000Z",
        },
      ] as never,
      "request",
    );

    const compactRequestText = messages.map((message) => message.content).join("\n");
    expect(compactRequestText).toContain("[truncated]");
    expect(compactRequestText.length).toBeLessThan(60_000);
  });
});
