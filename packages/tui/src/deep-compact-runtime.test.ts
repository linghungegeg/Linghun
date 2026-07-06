import type { ModelMessage } from "@linghun/providers";
import { describe, expect, it } from "vitest";
import {
  formatDeepCompactPromptSummary,
  injectDeepCompactSummary,
  insertAfterLeadingSystemMessages,
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
  it("inserts compact continuity after all leading system segments", () => {
    const messages: ModelMessage[] = [
      { role: "system", content: "stable system" },
      { role: "system", content: "dynamic system" },
      { role: "user", content: "current request" },
    ];

    const result = injectDeepCompactSummary(messages, makePacket());

    expect(result.map((message) => message.role)).toEqual(["system", "system", "user", "user"]);
    expect(result[0]?.content).toBe("stable system");
    expect(result[1]?.content).toBe("dynamic system");
    expect(result[2]?.content).toContain("Deep compact context");
    expect(result[2]?.content).toContain("latest user request");
    expect(result[2]?.content).toContain("[Deep compact diagnostics]");
    expect(result[2]?.content).toContain("id deep-test");
    expect(result[3]?.content).toBe("current request");
  });

  it("keeps dynamic packet diagnostics out of the stable provider prefix", () => {
    const text = formatDeepCompactPromptSummary(makePacket()) ?? "";
    const prefix = text.split("\n").slice(0, 6).join("\n");

    expect(prefix).toContain("Deep compact context");
    expect(prefix).toContain("scope full transcript semantic compact");
    expect(prefix).not.toContain("deep-test");
    expect(prefix).not.toContain("created at");
    expect(text).toContain("[Deep compact diagnostics]");
    expect(text).toContain("id deep-test");
    expect(text).toContain("created at 2026-01-01T00:00:00.000Z");
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
});
