import { LinghunError } from "@linghun/core";
import { describe, expect, it, vi } from "vitest";
import {
  DeepSeekProvider,
  type LinghunEvent,
  ModelGateway,
  type ModelRequest,
  OpenAiCompatibleProvider,
  type Provider,
  deepSeekModels,
  normalizeProviderError,
  parseOpenAiStream,
} from "./index.js";

describe("DeepSeek model capabilities", () => {
  it("records DeepSeek V4 Flash and V4 Pro 1M limits", () => {
    const flash = deepSeekModels.find((model) => model.id === "deepseek-v4-flash");
    const pro = deepSeekModels.find((model) => model.id === "deepseek-v4-pro");

    expect(flash?.displayName).toBe("DeepSeek V4 Flash");
    expect(flash?.contextWindow).toBe(128_000);
    expect(flash?.maxOutputTokens).toBe(8_192);
    expect(pro?.displayName).toBe("DeepSeek V4 Pro 1M");
    expect(pro?.contextWindow).toBe(1_048_576);
    expect(pro?.maxOutputTokens).toBe(16_384);
  });
});

describe("OpenAI compatible provider", () => {
  it("constructs a streaming chat completion request", () => {
    const provider = new OpenAiCompatibleProvider({
      id: "openai-compatible",
      type: "openai-compatible",
      baseUrl: "https://example.com/v1/",
      apiKey: "test-key",
      model: "custom-model",
      maxOutputTokens: 2_000,
    });

    const request = provider.createChatRequest({
      messages: [{ role: "user", content: "你好" }],
      maxOutputTokens: 4_000,
    });

    expect(request).toEqual({
      model: "custom-model",
      messages: [{ role: "user", content: "你好" }],
      stream: true,
      max_tokens: 2_000,
    });
  });

  it("uses OpenAI tool schemas and assistant tool results", () => {
    const provider = new OpenAiCompatibleProvider({
      id: "openai-compatible",
      type: "openai-compatible",
      baseUrl: "https://example.com/v1/",
      apiKey: "test-key",
      model: "custom-model",
    });

    const request = provider.createChatRequest({
      messages: [
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call-1", name: "Read", input: { path: "README.md" } }],
        },
        { role: "tool", tool_call_id: "call-1", content: "ok" },
      ],
      tools: [{ name: "Read", description: "Read a file", inputSchema: { type: "object" } }],
      toolChoice: "auto",
    });

    expect(request.tools).toEqual([
      {
        type: "function",
        function: { name: "Read", description: "Read a file", parameters: { type: "object" } },
      },
    ]);
    expect(request.tool_choice).toBe("auto");
    expect(request.messages).toEqual([
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: { name: "Read", arguments: '{"path":"README.md"}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "call-1", content: "ok" },
    ]);
  });

  it("constructs a responses request with native tool schema and reasoning effort", () => {
    const provider = new OpenAiCompatibleProvider({
      id: "openai-compatible",
      type: "openai-compatible",
      baseUrl: "https://example.com/v1/",
      apiKey: "test-key",
      model: "gpt-5.5",
      endpointProfile: "responses",
      reasoningLevel: "Medium",
    });

    const request = provider.createResponsesRequest({
      messages: [{ role: "user", content: "你好" }],
      tools: [{ name: "Read", description: "Read a file", inputSchema: { type: "object" } }],
      toolChoice: "auto",
    });

    expect(request).toEqual({
      model: "gpt-5.5",
      input: [{ role: "user", content: "你好" }],
      stream: true,
      max_output_tokens: 4_096,
      tools: [
        {
          type: "function",
          name: "Read",
          description: "Read a file",
          parameters: { type: "object" },
        },
      ],
      tool_choice: "auto",
      reasoning: { effort: "Medium" },
    });
  });

  it("converts responses tool results to function_call_output input items", () => {
    const provider = new OpenAiCompatibleProvider({
      id: "openai-compatible",
      type: "openai-compatible",
      baseUrl: "https://example.com/v1/",
      apiKey: "test-key",
      model: "gpt-5.5",
      endpointProfile: "responses",
    });

    const request = provider.createResponsesRequest({
      messages: [
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call-1", name: "Read", input: { path: "README.md" } }],
        },
        { role: "tool", tool_call_id: "call-1", content: "ok" },
      ],
    });

    expect(request.input).toEqual([
      {
        type: "function_call",
        call_id: "call-1",
        name: "Read",
        arguments: '{"path":"README.md"}',
      },
      { type: "function_call_output", call_id: "call-1", output: "ok" },
    ]);
  });

  it("falls back to non-streaming responses when streaming responses returns server error", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.stream === true) {
        return new Response("bad gateway", { status: 502 });
      }
      return Response.json({
        id: "resp-1",
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "ok" }],
          },
        ],
        usage: { input_tokens: 3, output_tokens: 1, total_tokens: 4 },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiCompatibleProvider({
      id: "openai-compatible",
      type: "openai-compatible",
      baseUrl: "https://example.com/v1/",
      apiKey: "test-key",
      model: "gpt-5.5",
      endpointProfile: "responses",
    });
    const events = [];

    for await (const event of provider.stream(
      { messages: [{ role: "user", content: "hi" }] },
      new AbortController().signal,
    )) {
      events.push(event);
    }

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).stream).toBe(true);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).stream).toBe(false);
    expect(events).toEqual([
      { type: "assistant_text_delta", id: "resp-1", text: "ok" },
      {
        type: "usage",
        usage: {
          inputTokens: 3,
          outputTokens: 1,
          totalTokens: 4,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
          cacheWriteTokensRaw: null,
          rawUsage: { input_tokens: 3, output_tokens: 1, total_tokens: 4 },
          endpoint: "/v1/responses",
        },
      },
      {
        type: "message_stop",
        id: "resp-1",
        finishReason: undefined,
        chunkCount: 1,
        hadUsage: true,
      },
    ]);
  });

  it("keeps chat completions profile without reasoning payload for DeepSeek compatibility", () => {
    const provider = new DeepSeekProvider({
      apiKey: "test-key",
      model: "deepseek-v4-pro",
      reasoningLevel: "Medium",
    });

    const request = provider.createChatRequest({
      messages: [{ role: "user", content: "你好" }],
    });

    expect(request.max_tokens).toBe(16_384);
    expect(request).not.toHaveProperty("reasoning");
  });

  it("does not send OpenAI tools when provider config disables tool support", async () => {
    const provider = new OpenAiCompatibleProvider({
      id: "openai-compatible",
      type: "openai-compatible",
      baseUrl: "https://example.com/v1/",
      apiKey: "test-key",
      model: "custom-model",
      supportsTools: false,
    });

    const request = provider.createChatRequest({
      messages: [{ role: "user", content: "hi" }],
      tools: [{ name: "Read", description: "Read a file", inputSchema: { type: "object" } }],
      toolChoice: "auto",
    });
    const [model] = await provider.listModels();

    expect(model?.supportsTools).toBe(false);
    expect(request.tools).toBeUndefined();
    expect(request.tool_choice).toBeUndefined();
  });

  it("uses the DeepSeek default base URL", async () => {
    const provider = new DeepSeekProvider({ model: "deepseek-v4-pro" });
    const models = await provider.listModels();

    expect(models[0]?.id).toBe("deepseek-v4-pro");
    expect(models[0]?.contextWindow).toBe(1_048_576);
  });
});

async function collectOpenAiEvents(
  chunks: string[],
  endpoint = "/v1/chat/completions",
): Promise<LinghunEvent[]> {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  const events: LinghunEvent[] = [];
  for await (const event of parseOpenAiStream(body, endpoint)) {
    events.push(event);
  }
  return events;
}

describe("OpenAI stream parser", () => {
  it("converts text deltas and usage into Linghun events", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode('data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"你"}}]}\n\n'),
        );
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"content":"好"}}],"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6}}\n\n',
          ),
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const events = [];

    for await (const event of parseOpenAiStream(body)) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "assistant_text_delta", id: "chatcmpl-1", text: "你" },
      { type: "assistant_text_delta", id: "assistant", text: "好" },
      {
        type: "usage",
        usage: {
          inputTokens: 4,
          outputTokens: 2,
          totalTokens: 6,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
          cacheWriteTokensRaw: null,
          rawUsage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
          endpoint: "/v1/chat/completions",
        },
      },
      {
        type: "message_stop",
        id: "chatcmpl-1",
        finishReason: undefined,
        chunkCount: 2,
        hadUsage: true,
      },
    ]);
  });

  it("converts streamed tool call deltas into tool_use events", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"tool_calls":[{"id":"call-1","function":{"name":"Read","arguments":"{\\"path\\":"}}]}}]}\n\n',
          ),
        );
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"tool_calls":[{"function":{"arguments":"\\"README.md\\"}"}}]}}]}\n\n',
          ),
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const events = [];

    for await (const event of parseOpenAiStream(body)) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "tool_use", id: "call-1", name: "Read", input: { path: "README.md" } },
      {
        type: "message_stop",
        id: "assistant",
        finishReason: undefined,
        chunkCount: 2,
        hadUsage: false,
      },
    ]);
  });

  it("converts reasoning-only deltas without treating them as assistant text", async () => {
    const events = await collectOpenAiEvents([
      'data: {"id":"chatcmpl-reasoning","choices":[{"delta":{"reasoning_content":"thinking"},"finish_reason":"stop"}]}\n\n',
      "data: [DONE]\n\n",
    ]);

    expect(events).toEqual([
      { type: "assistant_thinking_delta", id: "chatcmpl-reasoning", text: "thinking" },
      {
        type: "message_stop",
        id: "chatcmpl-reasoning",
        finishReason: "stop",
        chunkCount: 1,
        hadUsage: false,
      },
    ]);
  });

  it("converts responses endpoint text, tool, usage, and error events", async () => {
    const events = await collectOpenAiEvents(
      [
        `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "ok" })}\n\n`,
        `data: ${JSON.stringify({ type: "response.output_item.done", item: { type: "function_call", call_id: "call-1", name: "Read", arguments: '{"path":"README.md"}' } })}\n\n`,
        `data: ${JSON.stringify({ type: "response.completed", response: { id: "resp-1", usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5, input_tokens_details: { cached_tokens: 1 } } } })}\n\n`,
        `data: ${JSON.stringify({ type: "response.failed" })}\n\n`,
        "data: [DONE]\n\n",
      ],
      "/v1/responses",
    );

    expect(events).toEqual([
      { type: "assistant_text_delta", id: "assistant", text: "ok" },
      { type: "tool_use", id: "call-1", name: "Read", input: { path: "README.md" } },
      {
        type: "usage",
        usage: {
          inputTokens: 3,
          outputTokens: 2,
          totalTokens: 5,
          cacheReadTokens: 1,
          cacheWriteTokens: undefined,
          cacheWriteTokensRaw: null,
          rawUsage: {
            input_tokens: 3,
            output_tokens: 2,
            total_tokens: 5,
            input_tokens_details: { cached_tokens: 1 },
          },
          endpoint: "/v1/responses",
        },
      },
      expect.objectContaining({ type: "error" }),
      {
        type: "message_stop",
        id: "resp-1",
        finishReason: undefined,
        chunkCount: 4,
        hadUsage: true,
      },
    ]);
  });

  it("converts message.content and message.tool_calls fallback chunks", async () => {
    const events = await collectOpenAiEvents([
      `data: ${JSON.stringify({
        id: "chatcmpl-message",
        choices: [
          {
            message: {
              content: "final",
              tool_calls: [
                {
                  id: "call-message",
                  type: "function",
                  function: { name: "Write", arguments: JSON.stringify({ path: "report.md" }) },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      })}\n\n`,
      "data: [DONE]\n\n",
    ]);

    expect(events).toEqual([
      { type: "assistant_text_delta", id: "chatcmpl-message", text: "final" },
      { type: "tool_use", id: "call-message", name: "Write", input: { path: "report.md" } },
      {
        type: "message_stop",
        id: "chatcmpl-message",
        finishReason: "tool_calls",
        chunkCount: 1,
        hadUsage: false,
      },
    ]);
  });

  it("keeps usage-only and empty choices as non-answer chunks", async () => {
    const events = await collectOpenAiEvents([
      'data: {"id":"chatcmpl-empty","choices":[]}\n\n',
      'data: {"usage":{"prompt_tokens":3,"completion_tokens":0,"total_tokens":3}}\n\n',
      "data: [DONE]\n\n",
    ]);

    expect(events).toEqual([
      {
        type: "usage",
        usage: {
          inputTokens: 3,
          outputTokens: 0,
          totalTokens: 3,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
          cacheWriteTokensRaw: null,
          rawUsage: { prompt_tokens: 3, completion_tokens: 0, total_tokens: 3 },
          endpoint: "/v1/chat/completions",
        },
      },
      {
        type: "message_stop",
        id: "chatcmpl-empty",
        finishReason: undefined,
        chunkCount: 2,
        hadUsage: true,
      },
    ]);
  });

  it("converts provider error chunks and malformed chunks into error events", async () => {
    const providerErrorEvents = await collectOpenAiEvents([
      'data: {"error":{"message":"bad gateway"}}\n\n',
    ]);
    const malformedEvents = await collectOpenAiEvents(["data: {not-json}\n\n"]);

    expect(providerErrorEvents[0]).toMatchObject({
      type: "error",
      error: { code: "PROVIDER_STREAM_ERROR", message: expect.stringContaining("bad gateway") },
    });
    expect(malformedEvents[0]).toMatchObject({
      type: "error",
      error: { code: "PROVIDER_MALFORMED_STREAM" },
    });
  });
});

describe("ModelGateway", () => {
  it("streams provider text and usage events", async () => {
    const provider: Provider = {
      id: "mock",
      displayName: "Mock",
      supports: { streaming: true, usage: true },
      async listModels() {
        return [
          {
            id: "mock-model",
            displayName: "Mock Model",
            providerId: "mock",
            contextWindow: 8_000,
            maxOutputTokens: 1_000,
            supportsTools: false,
            supportsVision: false,
            supportsThinking: false,
            supportsPromptCache: false,
          },
        ];
      },
      async *stream(_request: ModelRequest): AsyncGenerator<LinghunEvent> {
        yield { type: "assistant_text_delta", id: "a1", text: "你" };
        yield { type: "assistant_text_delta", id: "a1", text: "好" };
        yield { type: "usage", usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } };
      },
    };
    const gateway = new ModelGateway([provider]);
    const events = [];

    for await (const event of gateway.stream(
      "mock",
      { messages: [{ role: "user", content: "hi" }] },
      new AbortController().signal,
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "assistant_text_delta", id: "a1", text: "你" },
      { type: "assistant_text_delta", id: "a1", text: "好" },
      { type: "usage", usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } },
    ]);
  });

  it("does not send tools or toolChoice when the selected model lacks tool calling", async () => {
    let captured: ModelRequest | undefined;
    const provider: Provider = {
      id: "mock",
      displayName: "Mock",
      supports: { streaming: true, usage: true },
      async listModels() {
        return [
          {
            id: "mock-no-tools",
            displayName: "Mock No Tools",
            providerId: "mock",
            contextWindow: 8_000,
            maxOutputTokens: 1_000,
            supportsTools: false,
            supportsVision: false,
            supportsThinking: false,
            supportsPromptCache: false,
          },
        ];
      },
      async *stream(request: ModelRequest): AsyncGenerator<LinghunEvent> {
        captured = request;
        yield { type: "assistant_text_delta", id: "a1", text: "ok" };
      },
    };
    const gateway = new ModelGateway([provider]);

    for await (const _event of gateway.stream(
      "mock",
      {
        model: "mock-no-tools",
        messages: [{ role: "user", content: "hi" }],
        tools: [{ name: "Read", description: "Read", inputSchema: { type: "object" } }],
        toolChoice: "auto",
      },
      new AbortController().signal,
    )) {
      // drain stream
    }

    expect(captured?.tools).toBeUndefined();
    expect(captured?.toolChoice).toBeUndefined();
  });

  it("normalizes provider errors to LinghunError events", async () => {
    const provider: Provider = {
      id: "mock",
      displayName: "Mock",
      supports: { streaming: true, usage: true },
      async listModels() {
        return [];
      },
      async *stream(): AsyncGenerator<LinghunEvent> {
        if (Date.now() < 0) {
          yield { type: "assistant_text_delta", id: "unused", text: "" };
        }
        throw new TypeError("fetch failed");
      },
    };
    const gateway = new ModelGateway([provider]);
    const events = [];

    for await (const event of gateway.stream(
      "mock",
      { messages: [{ role: "user", content: "hi" }] },
      new AbortController().signal,
    )) {
      events.push(event);
    }

    expect(events[0]?.type).toBe("error");
    expect(events[0]).toMatchObject({
      error: {
        code: "PROVIDER_NETWORK_ERROR",
        message: "模型请求失败：无法连接到模型服务。",
        recoverable: true,
      },
    });
  });

  it("keeps LinghunError provider failures readable", () => {
    const error = normalizeProviderError(
      new LinghunError({
        code: "MODEL_API_KEY_MISSING",
        message: "模型配置缺少 api_key。",
        suggestion: "请运行 /model doctor。",
        recoverable: true,
      }),
    );

    expect(error.code).toBe("MODEL_API_KEY_MISSING");
    expect(error.message).toBe("模型配置缺少 api_key。");
  });

  it("normalizes API key errors with Chinese guidance", () => {
    const error = normalizeProviderError({ status: 401, message: "Unauthorized" });

    expect(error.code).toBe("PROVIDER_API_KEY_ERROR");
    expect(error.message).toContain("API Key 无效或没有权限");
    expect(error.suggestion).toContain("检查当前 provider 的 api_key");
  });

  it("classifies HTTP 400 as provider request-format diagnostics", () => {
    const error = normalizeProviderError({ status: 400, message: "Bad Request" });

    expect(error.code).toBe("PROVIDER_BAD_REQUEST");
    expect(error.message).toContain("HTTP 400");
    expect(error.suggestion).toContain("tools/tool_choice");
    expect(error.suggestion).toContain("tool_result");
  });
});
