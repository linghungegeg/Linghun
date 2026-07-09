import { Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TuiContext } from "./index.js";
import {
  clearRequestActivity,
  recordRequestFirstDelta,
  startRequestActivity,
} from "./model-stream-runtime.js";

class MemoryWritable extends Writable {
  override _write(_chunk: Buffer | string, _encoding: BufferEncoding, callback: () => void): void {
    callback();
  }
}

describe("request activity timing", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("records first provider delta timing on the completed model request", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const context = { language: "zh-CN" } as TuiContext;

    startRequestActivity(new MemoryWritable(), context, "request_started");
    vi.setSystemTime(1_123);
    recordRequestFirstDelta(context, "assistant_thinking_delta");
    vi.setSystemTime(1_400);
    recordRequestFirstDelta(context, "assistant_text_delta");
    vi.setSystemTime(1_600);
    clearRequestActivity(context);

    expect(context.lastModelRequest?.phase).toBe("request_started");
    expect(context.lastModelRequest?.firstDeltaMs).toBe(123);
    expect(context.lastModelRequest?.firstDeltaType).toBe("assistant_thinking_delta");
    expect(context.lastModelRequest?.durationMs).toBe(600);
    expect((context as { requestActivityFirstDeltaAt?: number }).requestActivityFirstDeltaAt).toBeUndefined();
  });

  it("clears retryInfo with request activity", () => {
    const context = {
      language: "zh-CN",
      requestActivityPhase: "provider_retrying",
      retryInfo: { attempt: 1, max: 10, delaySec: 3 },
    } as TuiContext;

    clearRequestActivity(context);

    expect(context.retryInfo).toBeUndefined();
    expect(context.requestActivityPhase).toBeUndefined();
  });

  it("keeps background activity from overwriting the foreground owner", () => {
    const context = { language: "zh-CN" } as TuiContext;

    startRequestActivity(new MemoryWritable(), context, "request_started", {
      requestTurnId: "turn-a",
    });
    startRequestActivity(new MemoryWritable(), context, "tool_running", {
      ownerKind: "background",
      toolName: "Agent",
    });

    expect(context.requestActivityPhase).toBe("request_started");
    expect(context.requestActivityOwner).toEqual({
      kind: "foreground",
      requestTurnId: "turn-a",
    });

    clearRequestActivity(context, { kind: "background" });
    expect(context.requestActivityPhase).toBe("request_started");

    clearRequestActivity(context, { kind: "foreground", requestTurnId: "turn-a" });
    expect(context.requestActivityPhase).toBeUndefined();
    expect(context.requestActivityOwner).toBeUndefined();
  });
});
