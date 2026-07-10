import { describe, expect, it } from "vitest";
import { buildSessionPanelEntries, buildSessionPreviewMessages } from "./session-panel.js";

describe("session preview messages", () => {
  it("uses creation time to stabilize sessions with the same update time", () => {
    const entries = buildSessionPanelEntries(
      [
        { id: "older", createdAt: "2026-07-10T10:00:00.001Z", updatedAt: "2026-07-10T10:00:01Z" },
        { id: "newer", createdAt: "2026-07-10T10:00:00.002Z", updatedAt: "2026-07-10T10:00:01Z" },
      ],
      undefined,
    );

    expect(entries.map((entry) => entry.id)).toEqual(["newer", "older"]);
  });

  it("keeps only the latest user and assistant messages in chronological order", () => {
    const events = [
      { type: "session_start", createdAt: "0" },
      ...Array.from({ length: 12 }, (_, index) => ({
        type: index % 2 === 0 ? "user_message" : "assistant_text_delta",
        text: `message ${index + 1}`,
        createdAt: String(index + 1),
      })),
      { type: "tool_result", text: "hidden tool output", createdAt: "13" },
    ];

    const preview = buildSessionPreviewMessages(events, 10);

    expect(preview).toHaveLength(10);
    expect(preview[0]).toMatchObject({ role: "user", text: "message 3" });
    expect(preview.at(-1)).toMatchObject({ role: "assistant", text: "message 12" });
    expect(preview.some((message) => message.text.includes("tool output"))).toBe(false);
  });

  it("drops blank message fragments", () => {
    expect(
      buildSessionPreviewMessages([
        { type: "user_message", text: "   ", createdAt: "1" },
        { type: "assistant_text_delta", text: " answer ", createdAt: "2" },
      ]),
    ).toEqual([{ role: "assistant", text: "answer", createdAt: "2" }]);
  });

  it("coalesces streamed assistant deltas into one visible message", () => {
    expect(
      buildSessionPreviewMessages([
        { type: "user_message", text: "question", createdAt: "1" },
        { type: "assistant_text_delta", text: "first ", createdAt: "2" },
        { type: "assistant_text_delta", text: "second", createdAt: "3" },
      ]),
    ).toEqual([
      { role: "user", text: "question", createdAt: "1" },
      { role: "assistant", text: "first second", createdAt: "3" },
    ]);
  });
});
