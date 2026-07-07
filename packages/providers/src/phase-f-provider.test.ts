import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OpenAiCompatibleProvider,
  normalizeProviderError,
  type LinghunEvent,
} from "./index.js";

describe("Phase F provider contract, fallback, and error classification", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back to a non-streaming request for plain text stream HTTP failures", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("server overload", { status: 503 })).mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: "fallback ok" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiCompatibleProvider({
      id: "openai-compatible",
      type: "openai-compatible",
      baseUrl: "https://example.com/v1",
      apiKey: "test-key",
      model: "custom-model",
    });

    const events: LinghunEvent[] = [];
    for await (const event of provider.stream({
      messages: [{ role: "user", content: "hello" }],
      toolChoice: "none",
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "assistant_text_delta", id: "non-streaming-fallback", text: "fallback ok" },
      {
        type: "message_stop",
        id: "non-streaming-fallback",
        finishReason: "non_streaming_fallback",
        chunkCount: 1,
        hadUsage: false,
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({ stream: false });
  });

  it("does not fallback for tool requests that could duplicate tool execution", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("server overload", { status: 503 })));
    const provider = new OpenAiCompatibleProvider({
      id: "openai-compatible",
      type: "openai-compatible",
      baseUrl: "https://example.com/v1",
      apiKey: "test-key",
      model: "custom-model",
    });

    await expect(async () => {
      for await (const _event of provider.stream({
        messages: [{ role: "user", content: "hello" }],
        tools: [{ name: "Read", description: "Read", inputSchema: { type: "object" } }],
        toolChoice: "auto",
      })) {
        // consume stream
      }
    }).rejects.toMatchObject({ code: "PROVIDER_SERVER_ERROR" });
  });

  it("classifies named provider failures without leaking raw provider objects", () => {
    expect(normalizeProviderError(new Error("prompt_too_long maximum context")).code).toBe(
      "PROVIDER_ERROR",
    );
    expect(normalizeProviderError(new Error("ssl certificate verify failed")).message).toContain(
      "ssl certificate",
    );
  });
});
