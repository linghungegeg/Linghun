import type { TranscriptEvent } from "@linghun/core";
import { describe, expect, it } from "vitest";
import { transcriptEventsToAgentBlocks } from "./agent-transcript-view.js";

describe("agent transcript view model", () => {
  it("projects child transcript events into product blocks", () => {
    const events: TranscriptEvent[] = [
      {
        type: "user_message",
        id: "u1",
        text: "inspect files",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        type: "assistant_text_delta",
        id: "a1",
        text: "found the issue",
        createdAt: "2026-01-01T00:00:01.000Z",
      },
      {
        type: "tool_call_start",
        id: "t1",
        name: "Read",
        input: { path: "packages/tui/src/index.ts" },
        createdAt: "2026-01-01T00:00:02.000Z",
      },
      {
        type: "tool_result",
        toolUseId: "t1",
        toolName: "Read",
        content: "Read 10 lines",
        createdAt: "2026-01-01T00:00:03.000Z",
      },
    ];

    const blocks = transcriptEventsToAgentBlocks(events, "zh-CN");

    expect(blocks.map((block) => block.id)).toEqual([
      "agent-view:user:u1",
      "agent-view:assistant:a1",
      "agent-view:tool-call:t1",
      "agent-view:tool-result:t1",
    ]);
    expect(blocks[0]?.messageKind).toBe("user_text");
    expect(blocks[1]?.messageKind).toBe("assistant_text");
    expect(blocks[2]?.messageKind).toBe("tool_call");
    expect(blocks[3]?.messageKind).toBe("tool_result_success");
    expect(blocks[3]?.fullText).toContain("Read 10 lines");
  });
});
