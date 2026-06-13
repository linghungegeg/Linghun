import { describe, expect, it } from "vitest";
import { recordToolEvidence } from "./evidence-runtime.js";

describe("evidence-runtime", () => {
  it("records read-only tool evidence with low-noise summaries", async () => {
    const events: unknown[] = [];
    const context = {
      evidence: [],
      store: {
        appendEvent: async (_sessionId: string, event: unknown) => {
          events.push(event);
        },
      },
    } as never;

    const evidence = await recordToolEvidence(
      context,
      "session-1",
      "Read",
      {
        text: "line 1\n".repeat(200),
      },
      { path: "src/main.ts" },
    );

    expect(evidence?.summary).toContain("Read: path=src/main.ts");
    expect(evidence?.summary).toContain("output_chars=");
    expect(evidence?.summary).not.toContain("line 1 line 1");
    expect(evidence?.supportsClaims).toContain("readonly_low_noise_evidence");
    expect(events).toHaveLength(1);
  });
});
