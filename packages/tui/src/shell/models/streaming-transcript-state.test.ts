import { describe, expect, it } from "vitest";
import {
  appendAssistantStreamDelta,
  assistantStreamVisibleTail,
  createAssistantStreamDisplayState,
  drainAssistantStreamCommits,
  finalizeAssistantStreamDisplayState,
} from "./streaming-transcript-state.js";

describe("assistant stream display state", () => {
  it("splits stable newline-terminated text from live tail", () => {
    let state = createAssistantStreamDisplayState();
    state = appendAssistantStreamDelta(state, "第一行\n第二");

    expect(state.fullText).toBe("第一行\n第二");
    expect(state.pendingStableText).toBe("第一行\n");
    expect(state.liveTail).toBe("第二");
    expect(assistantStreamVisibleTail(state)).toBe("第一行\n第二");
  });

  it("drains stable text in small smooth batches without dropping order", () => {
    let state = createAssistantStreamDisplayState();
    state = appendAssistantStreamDelta(state, "A\nB\nC\nD\nE", 1000);

    const first = drainAssistantStreamCommits(state, 1010);
    expect(first.mode).toBe("smooth");
    expect(first.committedDelta).toBe("A\nB\nC\nD\n");
    expect(first.state.committedText).toBe("A\nB\nC\nD\n");
    expect(first.state.pendingStableText).toBe("");
    expect(first.state.liveTail).toBe("E");
  });

  it("allows tests to request one-line smooth drains", () => {
    let state = createAssistantStreamDisplayState();
    state = appendAssistantStreamDelta(state, "A\nB\nC", 1000);

    const first = drainAssistantStreamCommits(state, 1010, { smoothMaxLines: 1 });
    expect(first.mode).toBe("smooth");
    expect(first.committedDelta).toBe("A\n");
    expect(first.state.committedText).toBe("A\n");
    expect(first.state.pendingStableText).toBe("B\n");
    expect(first.state.liveTail).toBe("C");
  });

  it("uses catch-up when stable queue is old", () => {
    let state = createAssistantStreamDisplayState();
    state = appendAssistantStreamDelta(state, "A\nB\nC\nD", 1000);

    const drained = drainAssistantStreamCommits(state, 1200);
    expect(drained.mode).toBe("catch_up");
    expect(drained.committedDelta).toBe("A\nB\nC\n");
    expect(drained.state.committedText).toBe("A\nB\nC\n");
    expect(drained.state.liveTail).toBe("D");
  });

  it("holds an open markdown table out of the stable queue until it closes", () => {
    let state = createAssistantStreamDisplayState();
    state = appendAssistantStreamDelta(
      state,
      "Intro\n\n| Name | Value |\n| --- | --- |\n| A | 1 |\n",
      1000,
    );

    expect(state.pendingStableText).toBe("Intro\n\n");
    expect(state.liveTail).toContain("| Name | Value |");

    state = appendAssistantStreamDelta(state, "\nAfter\n", 1010);

    expect(state.pendingStableText).toContain("| A | 1 |\n\nAfter\n");
    expect(state.liveTail).toBe("");
  });

  it("streams complete lines inside an open code fence instead of holding the whole block", () => {
    let state = createAssistantStreamDisplayState();
    state = appendAssistantStreamDelta(state, "Before\n```ts\nconst a = 1;\n", 1000);

    expect(state.pendingStableText).toBe("Before\n```ts\nconst a = 1;\n");
    expect(state.liveTail).toBe("");

    state = appendAssistantStreamDelta(state, "```\nAfter\n", 1010);

    expect(state.pendingStableText).toBe("Before\n```ts\nconst a = 1;\n```\nAfter\n");
    expect(state.liveTail).toBe("");
  });

  it("finalizes all remaining text as committed content", () => {
    let state = createAssistantStreamDisplayState();
    state = appendAssistantStreamDelta(state, "A\nB");

    const finalized = finalizeAssistantStreamDisplayState(state);
    expect(finalized.committedText).toBe("A\nB");
    expect(finalized.pendingStableText).toBe("");
    expect(finalized.liveTail).toBe("");
  });
});
