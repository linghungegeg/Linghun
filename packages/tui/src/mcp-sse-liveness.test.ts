import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mcpSseRequest } from "./mcp-sse-runtime.js";

describe("MCP SSE request-local liveness", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("emits still-running progress at 30 seconds and stops after abort settle", async () => {
    globalThis.fetch = vi.fn((_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        const abort = () => reject(new DOMException("Aborted", "AbortError"));
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, { once: true });
      })
    ) as typeof fetch;
    const controller = new AbortController();
    const onProgress = vi.fn();
    const pending = mcpSseRequest(
      "https://mcp.test/liveness",
      "tools/call",
      {},
      100_000_000,
      controller.signal,
      onProgress,
      100_000_000,
    );

    await vi.advanceTimersByTimeAsync(29_999);
    expect(onProgress).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenLastCalledWith({ phase: "waiting", transport: "sse" });

    controller.abort();
    await expect(pending).resolves.toMatchObject({ ok: false, errorCode: "MCP_SSE_ABORTED" });
    const settledProgressCount = onProgress.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onProgress).toHaveBeenCalledTimes(settledProgressCount);
  });

  it("restarts the still-running cadence after a real SSE progress frame", async () => {
    const encoder = new TextEncoder();
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    let requestId = 0;
    globalThis.fetch = vi.fn(async (_url, init) => {
      requestId = Number(JSON.parse(String(init?.body)).id);
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            streamController = controller;
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    }) as typeof fetch;
    const onProgress = vi.fn();
    const pending = mcpSseRequest(
      "https://mcp.test/progress-reset",
      "tools/call",
      {},
      100_000_000,
      undefined,
      onProgress,
      100_000_000,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(onProgress).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(29_999);
    streamController.enqueue(
      encoder.encode(
        `data: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: { progress: 1 } })}\n\n`,
      ),
    );
    await vi.advanceTimersByTimeAsync(0);
    const afterRealProgress = onProgress.mock.calls.length;
    expect(onProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: "receiving", transport: "sse" }),
    );

    await vi.advanceTimersByTimeAsync(29_999);
    expect(onProgress).toHaveBeenCalledTimes(afterRealProgress);
    await vi.advanceTimersByTimeAsync(1);
    expect(onProgress).toHaveBeenCalledTimes(afterRealProgress + 1);
    expect(onProgress).toHaveBeenLastCalledWith({ phase: "waiting", transport: "sse" });

    streamController.enqueue(
      encoder.encode(`data: ${JSON.stringify({ jsonrpc: "2.0", id: requestId, result: {} })}\n\n`),
    );
    streamController.close();
    await expect(pending).resolves.toMatchObject({ ok: true });
    const settledProgressCount = onProgress.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onProgress).toHaveBeenCalledTimes(settledProgressCount);
  });
});
