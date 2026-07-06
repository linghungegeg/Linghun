import type { ModelMessage } from "@linghun/providers";
import { describe, expect, it } from "vitest";
import {
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
    expect(result[2]?.content).toContain("[Deep compact deep-test]");
    expect(result[2]?.content).toContain("latest user request");
    expect(result[3]?.content).toBe("current request");
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
