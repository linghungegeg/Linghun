import { LinghunError } from "@linghun/core";
import { LINGHUN_CLI_NAME, LINGHUN_NAME, LINGHUN_VERSION } from "@linghun/shared";
import { describe, expect, it, vi } from "vitest";
import {
  DeepSeekProvider,
  type LinghunEvent,
  ModelGateway,
  type ModelRequest,
  OpenAiCompatibleProvider,
  type Provider,
  deepSeekModels,
  joinBaseUrlAndEndpoint,
  normalizeProviderError,
  parseAnthropicMessagesStream,
  parseOpenAiStream,
  resolveAnthropicContextEditingDiagnostic,
  resolveEffectiveEndpointProfile,
  resolveProviderBaseUrlDiagnostic,
  resolveProviderRuntimeContract,
} from "./index.js";

const EXPECTED_REQUEST_USER_AGENT = `${LINGHUN_NAME}/${LINGHUN_VERSION} (@linghun/${LINGHUN_CLI_NAME})`;

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

  it("keeps strict OpenAI-compatible chat requests free of non-standard reasoning fields", () => {
    const provider = new OpenAiCompatibleProvider({
      id: "openai-compatible",
      type: "openai-compatible",
      baseUrl: "https://example.com/v1/",
      apiKey: "test-key",
      model: "custom-model",
      reasoningLevel: "Medium",
    });

    const request = provider.createChatRequest({
      messages: [{ role: "user", content: "你好" }],
      reasoningLevel: "High",
    });

    expect(request).not.toHaveProperty("reasoning");
    expect(request).not.toHaveProperty("thinking");
  });

  it("sends chat reasoning and stream usage only when profile capability enables them", () => {
    const provider = new OpenAiCompatibleProvider({
      id: "openai-compatible",
      type: "openai-compatible",
      baseUrl: "https://example.com/v1/",
      apiKey: "test-key",
      model: "custom-model",
      compatibilityProfile: "permissive_openai_compatible",
      reasoningLevel: "Medium",
      includeUsage: true,
    });

    const request = provider.createChatRequest({
      messages: [{ role: "user", content: "你好" }],
    });

    expect(request.reasoning).toEqual({ effort: "Medium" });
    expect(request.stream_options).toEqual({ include_usage: true });
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

  it("exposes provider runtime contract boundaries for doctor diagnostics", () => {
    const deepseek = resolveProviderRuntimeContract({
      id: "deepseek",
      type: "deepseek",
      model: "deepseek-v4-pro",
    });
    const strictChat = resolveProviderRuntimeContract({
      id: "openai-compatible",
      type: "openai-compatible",
      model: "gpt-5.5",
    });
    const responses = resolveProviderRuntimeContract({
      id: "openai-compatible",
      type: "openai-compatible",
      model: "gpt-5.5",
      endpointProfile: "responses",
      reasoningLevel: "Medium",
    });

    expect(deepseek).toMatchObject({
      profile: "deepseek_chat_completions",
      endpointProfile: "chat_completions",
      endpoint: "/chat/completions",
      compatibilityProfile: "deepseek",
      toolSchemaShape: "openai_chat_tools",
      toolResultShape: "chat_tool_message",
      sendReasoning: false,
      retryStatuses: [429, 502, 503, 504],
      maxAttempts: 3,
      requestTimeoutMs: 30_000,
      streamIdleTimeoutMs: 30_000,
    });
    expect(strictChat).toMatchObject({
      profile: "strict_openai_compatible_chat_completions",
      toolSchemaShape: "openai_chat_tools",
      toolResultShape: "chat_tool_message",
      sendReasoning: false,
    });
    expect(responses).toMatchObject({
      profile: "openai_responses",
      endpointProfile: "responses",
      endpoint: "/responses",
      toolSchemaShape: "openai_responses_tools",
      toolResultShape: "responses_function_call_output",
      sendReasoning: true,
    });
  });

  it("does not silently fallback when streaming responses returns server error", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.stream).toBe(true);
      return new Response("bad gateway", { status: 502 });
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
    const collect = async () => {
      const events = [];
      for await (const event of provider.stream(
        { messages: [{ role: "user", content: "hi" }] },
        new AbortController().signal,
      )) {
        events.push(event);
      }
      return events;
    };

    await expect(collect()).rejects.toMatchObject({ code: "PROVIDER_SERVER_ERROR" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).stream).toBe(true);
  });

  it.each([
    ["https://example.com/v1", "chat_completions", "https://example.com/v1/chat/completions"],
    ["https://example.com/v1", "responses", "https://example.com/v1/responses"],
    ["https://sub2api.toioto.org/v1", "responses", "https://sub2api.toioto.org/v1/responses"],
    ["https://example.com/v1/responses", "responses", "https://example.com/v1/responses"],
  ] as const)(
    "normalizes endpoint URL for %s with %s",
    async (baseUrl, endpointProfile, expectedUrl) => {
      const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
            controller.close();
          },
        });
        return new Response(body, { status: 200 });
      });
      vi.stubGlobal("fetch", fetchMock);
      const provider = new OpenAiCompatibleProvider({
        id: "openai-compatible",
        type: "openai-compatible",
        baseUrl,
        apiKey: "test-key",
        model: "gpt-5.5",
        endpointProfile,
      });

      for await (const _event of provider.stream(
        { messages: [{ role: "user", content: "hi" }] },
        new AbortController().signal,
      )) {
        // consume stream
      }

      expect(fetchMock.mock.calls[0]?.[0]).toBe(expectedUrl);
    },
  );

  it("detects full endpoint baseUrl mismatch without changing endpointProfile", () => {
    const diagnostic = resolveProviderBaseUrlDiagnostic(
      "https://example.com/v1/responses",
      "chat_completions",
    );

    expect(diagnostic.normalizedBaseUrl).toBe("https://example.com/v1");
    expect(diagnostic.endpointPath).toBe("/v1/chat/completions");
    expect(diagnostic.fullEndpointSuffix).toBe("responses");
    expect(diagnostic.profileMismatch).toBe(true);
    expect(diagnostic.hasQueryOrFragment).toBe(false);
    expect(diagnostic.recommendation).toContain("baseUrl 应填根路径");
  });

  it("detects query or fragment in provider baseUrl diagnostics", () => {
    const diagnostic = resolveProviderBaseUrlDiagnostic(
      "https://example.com/v1?api_key=private-token#route",
      "chat_completions",
    );

    expect(diagnostic.hasQueryOrFragment).toBe(true);
    expect(diagnostic.endpointPath).toBe("/v1");
    expect(diagnostic.recommendation).toContain("不含 query/fragment");
  });

  it("fails with PROVIDER_REQUEST_TIMEOUT when response headers never arrive", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
      vi.stubGlobal("fetch", fetchMock);
      const provider = new OpenAiCompatibleProvider({
        id: "openai-compatible",
        type: "openai-compatible",
        baseUrl: "https://example.com/v1/",
        apiKey: "test-key",
        model: "custom-model",
      });
      const collect = async () => {
        const events = [];
        for await (const event of provider.stream(
          { messages: [{ role: "user", content: "hi" }] },
          new AbortController().signal,
        )) {
          events.push(event);
        }
        return events;
      };

      const result = expect(collect()).rejects.toMatchObject({ code: "PROVIDER_REQUEST_TIMEOUT" });
      await vi.advanceTimersByTimeAsync(30_000);
      await result;
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("maps abort-aware fetch timeout rejection to PROVIDER_REQUEST_TIMEOUT", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("This operation was aborted", "AbortError")),
              { once: true },
            );
          }),
      );
      vi.stubGlobal("fetch", fetchMock);
      const provider = new OpenAiCompatibleProvider({
        id: "openai-compatible",
        type: "openai-compatible",
        baseUrl: "https://example.com/v1/",
        apiKey: "test-key",
        model: "custom-model",
      });
      const collect = async () => {
        const events = [];
        for await (const event of provider.stream(
          { messages: [{ role: "user", content: "hi" }] },
          new AbortController().signal,
        )) {
          events.push(event);
        }
        return events;
      };

      const result = expect(collect()).rejects.toMatchObject({ code: "PROVIDER_REQUEST_TIMEOUT" });
      await vi.advanceTimersByTimeAsync(30_000);
      await result;
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends safe Linghun request identity headers without leaking request secrets", async () => {
    const promptContent = "secret prompt content should stay in body only";
    const privateBaseUrl = "https://example.com/v1?api_key=private-query-token";
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new Response(body, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiCompatibleProvider({
      id: "openai-compatible",
      type: "openai-compatible",
      baseUrl: privateBaseUrl,
      apiKey: "sk-test-openai-compatible-secret",
      model: "gpt-5.5",
    });

    for await (const _event of provider.stream(
      { messages: [{ role: "user", content: promptContent }] },
      new AbortController().signal,
    )) {
      // consume stream
    }

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init).toBeDefined();
    expect(init?.headers).toMatchObject({
      "User-Agent": EXPECTED_REQUEST_USER_AGENT,
      "X-Title": LINGHUN_NAME,
      "X-OpenRouter-Title": LINGHUN_NAME,
    });
    expect(init?.headers).not.toHaveProperty("HTTP-Referer");

    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-test-openai-compatible-secret");
    const publicHeadersJson = JSON.stringify({ ...headers, authorization: undefined });
    expect(publicHeadersJson).toContain(LINGHUN_NAME);
    expect(publicHeadersJson).not.toContain("sk-");
    expect(publicHeadersJson).not.toContain("api_key");
    expect(publicHeadersJson).not.toContain("Bearer sk-test-openai-compatible-secret");
    expect(publicHeadersJson).not.toContain("F:\\\\Linghun");
    expect(publicHeadersJson).not.toContain("C:\\\\Users");
    expect(publicHeadersJson).not.toContain("/workspace/");
    expect(publicHeadersJson).not.toContain(promptContent);
    expect(publicHeadersJson).not.toContain("private-query-token");
  });

  it("sends the same safe identity headers for DeepSeek requests", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new Response(body, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new DeepSeekProvider({
      apiKey: "sk-test-deepseek-secret",
      model: "deepseek-v4-pro",
    });

    for await (const _event of provider.stream(
      { messages: [{ role: "user", content: "do not leak this prompt" }] },
      new AbortController().signal,
    )) {
      // consume stream
    }

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.headers).toMatchObject({
      "User-Agent": EXPECTED_REQUEST_USER_AGENT,
      "X-Title": LINGHUN_NAME,
      "X-OpenRouter-Title": LINGHUN_NAME,
    });
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-test-deepseek-secret");
    expect(JSON.stringify({ ...headers, authorization: undefined })).not.toContain(
      "sk-test-deepseek-secret",
    );
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

  it("returns a visible diagnostic when provider config disables tool support", async () => {
    const provider = new OpenAiCompatibleProvider({
      id: "openai-compatible",
      type: "openai-compatible",
      baseUrl: "https://example.com/v1/",
      apiKey: "test-key",
      model: "custom-model",
      supportsTools: false,
    });

    const [model] = await provider.listModels();

    expect(model?.supportsTools).toBe(false);
    expect(() =>
      provider.createChatRequest({
        messages: [{ role: "user", content: "hi" }],
        tools: [{ name: "Read", description: "Read a file", inputSchema: { type: "object" } }],
        toolChoice: "auto",
      }),
    ).toThrow(expect.objectContaining({ code: "MODEL_TOOLS_UNSUPPORTED" }));
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
            'data: {"choices":[{"delta":{"tool_calls":[{"function":{"name":"","arguments":"\\"README.md\\"}"}}]}}]}\n\n',
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

  it("converts responses streamed function call argument deltas", async () => {
    const events = await collectOpenAiEvents(
      [
        `data: ${JSON.stringify({ type: "response.output_item.added", output_index: 0, item: { type: "function_call", call_id: "call-1", name: "Read" } })}\n\n`,
        `data: ${JSON.stringify({ type: "response.function_call_arguments.delta", output_index: 0, delta: '{"path":' })}\n\n`,
        `data: ${JSON.stringify({ type: "response.function_call_arguments.delta", output_index: 0, delta: '"README.md"}' })}\n\n`,
        `data: ${JSON.stringify({ type: "response.output_item.done", output_index: 0, item: { type: "function_call", call_id: "call-1", name: "Read" } })}\n\n`,
        "data: [DONE]\n\n",
      ],
      "/v1/responses",
    );

    expect(events).toEqual([
      { type: "tool_use", id: "call-1", name: "Read", input: { path: "README.md" } },
      {
        type: "message_stop",
        id: "assistant",
        finishReason: undefined,
        chunkCount: 4,
        hadUsage: false,
      },
    ]);
  });

  it("emits an error when a stream ends with an unfinished tool call", async () => {
    const events = await collectOpenAiEvents([
      'data: {"choices":[{"delta":{"tool_calls":[{"id":"call-1","function":{"name":"Read","arguments":"{\\"path\\":"}}]}}]}\n\n',
      "data: [DONE]\n\n",
    ]);

    expect(events).toEqual([
      expect.objectContaining({
        type: "error",
        error: expect.objectContaining({ code: "PROVIDER_PARTIAL_TOOL_CALL" }),
      }),
      expect.objectContaining({ type: "message_stop" }),
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

  it("returns a visible error when the selected model lacks tool calling", async () => {
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
    const events: LinghunEvent[] = [];

    for await (const event of gateway.stream(
      "mock",
      {
        model: "mock-no-tools",
        messages: [{ role: "user", content: "hi" }],
        tools: [{ name: "Read", description: "Read", inputSchema: { type: "object" } }],
        toolChoice: "auto",
      },
      new AbortController().signal,
    )) {
      events.push(event);
    }

    expect(captured).toBeUndefined();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "error",
      error: { code: "MODEL_TOOLS_UNSUPPORTED", recoverable: true },
    });
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

  it("classifies HTTP 400 as provider profile and schema diagnostics without leaking secrets", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          '{"error":{"message":"Unknown field reasoning and bad tool_choice sk-test-secret C:/Users/Admin/project prompt text"}}',
          { status: 400 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiCompatibleProvider({
      id: "openai-compatible",
      type: "openai-compatible",
      baseUrl: "https://example.com/v1/",
      apiKey: "test-key",
      model: "custom-model",
    });
    const collect = async () => {
      const events = [];
      for await (const event of provider.stream(
        { messages: [{ role: "user", content: "hi" }] },
        new AbortController().signal,
      )) {
        events.push(event);
      }
      return events;
    };

    await expect(collect()).rejects.toMatchObject({
      code: "PROVIDER_BAD_REQUEST",
      message: expect.stringContaining("provider rejected tools/tool_choice fields"),
      suggestion: expect.stringContaining("compatibilityProfile"),
    });
    await expect(collect()).rejects.not.toMatchObject({
      message: expect.stringMatching(/sk-test-secret|C:\/Users|prompt text/),
      suggestion: expect.stringMatching(/sk-test-secret|C:\/Users|prompt text/),
    });
  });

  it("classifies OpenAI-compatible HTTP 502 with endpoint profile guidance", async () => {
    const fetchMock = vi.fn(
      async () => new Response("bad gateway sk-test-secret prompt", { status: 502 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiCompatibleProvider({
      id: "openai-compatible",
      type: "openai-compatible",
      baseUrl: "https://example.com/v1/responses",
      apiKey: "test-key",
      model: "custom-model",
      endpointProfile: "chat_completions",
    });
    const collect = async () => {
      const events = [];
      for await (const event of provider.stream(
        { messages: [{ role: "user", content: "hi" }] },
        new AbortController().signal,
      )) {
        events.push(event);
      }
      return events;
    };

    await expect(collect()).rejects.toMatchObject({
      code: "PROVIDER_SERVER_ERROR",
      suggestion: expect.stringContaining("endpointProfile"),
    });
    await expect(collect()).rejects.not.toMatchObject({
      message: expect.stringMatching(/sk-test-secret|prompt/),
      suggestion: expect.stringMatching(/sk-test-secret|prompt/),
    });
  });
});

// ---------------------------------------------------------------------------
// Anthropic Messages (Commit 1 protocol-layer closure)
// ---------------------------------------------------------------------------
async function collectAnthropicEvents(
  chunks: string[],
  endpoint = "/v1/messages",
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
  for await (const event of parseAnthropicMessagesStream(body, endpoint)) {
    events.push(event);
  }
  return events;
}

describe("resolveEffectiveEndpointProfile", () => {
  it("prefers explicit request endpointProfile over config and base url", () => {
    const result = resolveEffectiveEndpointProfile({
      requestEndpointProfile: "anthropic_messages",
      configEndpointProfile: "chat_completions",
      configBaseUrl: "https://example.com/v1/chat/completions",
      configModel: "gpt-4o",
      requestModel: "gpt-4o",
    });
    expect(result.endpointProfile).toBe("anthropic_messages");
    expect(result.source).toBe("request");
  });

  it("treats baseUrl /v1/messages suffix as the truth even when config endpointProfile=chat_completions placeholder", () => {
    const result = resolveEffectiveEndpointProfile({
      requestEndpointProfile: undefined,
      configEndpointProfile: "chat_completions",
      configBaseUrl: "https://example.com/v1/messages",
      configModel: "claude-3-5-sonnet-latest",
      requestModel: "claude-3-5-sonnet-latest",
    });
    expect(result.endpointProfile).toBe("anthropic_messages");
    expect(result.source).toBe("base-url-suffix");
    expect(result.warnings.some((w) => w.includes("不一致"))).toBe(true);
  });

  it("infers anthropic_messages from base-url /v1/messages suffix", () => {
    const result = resolveEffectiveEndpointProfile({
      requestEndpointProfile: undefined,
      configEndpointProfile: undefined,
      configBaseUrl: "https://api.anthropic.com/v1/messages",
      configModel: "custom-relay-model",
      requestModel: "custom-relay-model",
    });
    expect(result.endpointProfile).toBe("anthropic_messages");
    expect(result.source).toBe("base-url-suffix");
  });

  it("auto-switches Claude model to anthropic_messages when config is empty endpointProfile", () => {
    const result = resolveEffectiveEndpointProfile({
      requestEndpointProfile: undefined,
      configEndpointProfile: undefined,
      configBaseUrl: "https://relay.example.com/v1",
      configModel: undefined,
      requestModel: "claude-3-5-haiku-latest",
    });
    expect(result.endpointProfile).toBe("anthropic_messages");
    expect(result.source).toBe("auto-claude-model");
  });

  it("auto-switches Claude model to anthropic_messages even when provider.env wrote chat_completions placeholder", () => {
    // 复现真实场景：provider.env 由旧 setup 默认写 LINGHUN_OPENAI_ENDPOINT_PROFILE=chat_completions，
    // 用户后来把 model 改成 claude-opus-4-7，但 endpointProfile 仍是占位 chat_completions。
    // 决策器必须把 chat_completions 视为占位并自动切 anthropic_messages。
    const result = resolveEffectiveEndpointProfile({
      requestEndpointProfile: undefined,
      configEndpointProfile: "chat_completions",
      configBaseUrl: "https://relay.example.com/v1",
      configModel: "claude-opus-4-7",
      requestModel: "claude-opus-4-7",
    });
    expect(result.endpointProfile).toBe("anthropic_messages");
    expect(result.source).toBe("auto-claude-model");
    expect(result.reason).toContain("chat_completions");
  });

  it("respects explicit non-chat config endpointProfile over Claude auto-detection", () => {
    // 用户显式选 responses，即使模型是 Claude，也保留用户选择，只 warn。
    const result = resolveEffectiveEndpointProfile({
      requestEndpointProfile: undefined,
      configEndpointProfile: "responses",
      configBaseUrl: "https://relay.example.com/v1",
      configModel: "claude-opus-4-7",
      requestModel: "claude-opus-4-7",
    });
    expect(result.endpointProfile).toBe("responses");
    expect(result.source).toBe("config-explicit");
    expect(result.warnings.some((w) => w.includes("Claude"))).toBe(true);
  });

  it("falls back to chat_completions when no signal is available", () => {
    const result = resolveEffectiveEndpointProfile({
      requestEndpointProfile: undefined,
      configEndpointProfile: undefined,
      configBaseUrl: "https://relay.example.com/v1",
      configModel: "custom-model",
      requestModel: "custom-model",
    });
    expect(result.endpointProfile).toBe("chat_completions");
    expect(result.source).toBe("default-chat-completions");
  });
});

describe("joinBaseUrlAndEndpoint", () => {
  it("joins anthropic root baseUrl with /v1/messages endpoint without doubling /v1", () => {
    expect(joinBaseUrlAndEndpoint("https://api.anthropic.com", "/v1/messages")).toBe(
      "https://api.anthropic.com/v1/messages",
    );
  });

  it("dedupes /v1 when baseUrl already ends with /v1 and endpoint starts with /v1/", () => {
    expect(joinBaseUrlAndEndpoint("https://api.anthropic.com/v1", "/v1/messages")).toBe(
      "https://api.anthropic.com/v1/messages",
    );
  });

  it("dedupes /v1 even with trailing slash on baseUrl", () => {
    expect(joinBaseUrlAndEndpoint("https://api.anthropic.com/v1/", "/v1/messages")).toBe(
      "https://api.anthropic.com/v1/messages",
    );
  });

  it("joins relay root baseUrl with /v1/messages without dedupe", () => {
    expect(joinBaseUrlAndEndpoint("https://hk.geek2api.com", "/v1/messages")).toBe(
      "https://hk.geek2api.com/v1/messages",
    );
  });

  it("dedupes /v1 for nested relay /api/v1 path", () => {
    expect(joinBaseUrlAndEndpoint("https://relay.example.com/api/v1", "/v1/messages")).toBe(
      "https://relay.example.com/api/v1/messages",
    );
  });

  it("does NOT dedupe /v1 for non-anthropic endpoints (chat_completions / responses)", () => {
    expect(joinBaseUrlAndEndpoint("https://relay.example.com/v1", "/chat/completions")).toBe(
      "https://relay.example.com/v1/chat/completions",
    );
    expect(joinBaseUrlAndEndpoint("https://relay.example.com/v1", "/responses")).toBe(
      "https://relay.example.com/v1/responses",
    );
  });

  it("works alongside diagnostic normalization: full anthropic endpoint baseUrl resolves to single /v1/messages", () => {
    // 用户把完整 endpoint 写进 baseUrl：先经 resolveProviderBaseUrlDiagnostic 剥掉 /v1/messages，
    // 再用 joinBaseUrlAndEndpoint 拼回去，确保不会变成 /v1/v1/messages 或丢路径。
    const diagnostic = resolveProviderBaseUrlDiagnostic(
      "https://hk.geek2api.com/v1/messages",
      "anthropic_messages",
    );
    const url = joinBaseUrlAndEndpoint(diagnostic.normalizedBaseUrl, "/v1/messages");
    expect(url).toBe("https://hk.geek2api.com/v1/messages");
  });
});

describe("resolveProviderRuntimeContract anthropic_messages branch", () => {
  it("D.13G: defaults to supportsTools=true with anthropic schema shapes; respects explicit supportsTools=false", () => {
    // D.13G：anthropic_messages 现已原生支持 tools，contract 默认 supportsTools=true
    // 并使用 Anthropic 原生 schema；只有当用户显式 supportsTools=false 时才禁用。
    const enabled = resolveProviderRuntimeContract({
      id: "claude-relay",
      type: "openai-compatible",
      baseUrl: "https://relay.example.com/v1",
      apiKey: "test-key",
      model: "claude-3-5-sonnet-latest",
      endpointProfile: "anthropic_messages",
    });
    expect(enabled.endpointProfile).toBe("anthropic_messages");
    expect(enabled.endpoint).toBe("/v1/messages");
    expect(enabled.profile).toBe("anthropic_messages");
    expect(enabled.compatibilityProfile).toBe("anthropic_messages");
    expect(enabled.supportsTools).toBe(true);
    expect(enabled.toolSchemaShape).toBe("anthropic_tools");
    expect(enabled.toolResultShape).toBe("anthropic_tool_result");
    expect(enabled.sendReasoning).toBe(false);
    expect(enabled.includeUsage).toBe(false);

    const disabled = resolveProviderRuntimeContract({
      id: "claude-relay",
      type: "openai-compatible",
      baseUrl: "https://relay.example.com/v1",
      apiKey: "test-key",
      model: "claude-3-5-sonnet-latest",
      endpointProfile: "anthropic_messages",
      supportsTools: false,
    });
    expect(disabled.supportsTools).toBe(false);
    expect(disabled.toolSchemaShape).toBe("tools_disabled");
    expect(disabled.toolResultShape).toBe("tools_disabled");
  });

  it("recognizes /v1/messages base-url suffix as anthropic_messages in diagnostic", () => {
    const diagnostic = resolveProviderBaseUrlDiagnostic(
      "https://api.anthropic.com/v1/messages",
      "anthropic_messages",
    );
    expect(diagnostic.fullEndpointSuffix).toBe("anthropic_messages");
    expect(diagnostic.normalizedBaseUrl).toBe("https://api.anthropic.com");
    expect(diagnostic.profileMismatch).toBe(false);
  });
});

describe("Anthropic Messages stream parser", () => {
  it("parses message_start, content_block_delta text and message_delta usage", async () => {
    const events = await collectAnthropicEvents([
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":7,"cache_read_input_tokens":3}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"你"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"好"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ]);

    const text = events
      .filter(
        (event): event is Extract<LinghunEvent, { type: "assistant_text_delta" }> =>
          event.type === "assistant_text_delta",
      )
      .map((event) => event.text)
      .join("");
    expect(text).toBe("你好");

    const usage = events.find(
      (event): event is Extract<LinghunEvent, { type: "usage" }> => event.type === "usage",
    );
    expect(usage?.usage.inputTokens).toBe(7);
    expect(usage?.usage.outputTokens).toBe(5);
    expect(usage?.usage.totalTokens).toBe(12);
    expect(usage?.usage.cacheReadTokens).toBe(3);
    expect(usage?.usage.endpoint).toBe("/v1/messages");

    const stop = events.at(-1);
    expect(stop).toMatchObject({
      type: "message_stop",
      id: "msg_1",
      finishReason: "end_turn",
      hadUsage: true,
    });
  });

  it("emits PROVIDER_STREAM_ERROR on Anthropic error events without leaking JSON shape", async () => {
    const events = await collectAnthropicEvents([
      'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ]);

    const error = events.find(
      (event): event is Extract<LinghunEvent, { type: "error" }> => event.type === "error",
    );
    expect(error?.error.code).toBe("PROVIDER_STREAM_ERROR");
    expect(error?.error.message).toContain("Overloaded");
  });

  it("emits PROVIDER_MALFORMED_STREAM on unparsable JSON payload", async () => {
    const events = await collectAnthropicEvents([
      "event: content_block_delta\ndata: {not-json\n\n",
    ]);

    const error = events.find(
      (event): event is Extract<LinghunEvent, { type: "error" }> => event.type === "error",
    );
    expect(error?.error.code).toBe("PROVIDER_MALFORMED_STREAM");
  });
});

describe("OpenAiCompatibleProvider anthropic_messages dispatch", () => {
  it("D.13G: builds an anthropic tools request without throwing MODEL_TOOLS_UNSUPPORTED", () => {
    // 验收 #2：anthropic_messages contract 现已 supportsTools=true（默认），
    // 带 tools 的请求 builder 不再抛 MODEL_TOOLS_UNSUPPORTED；request body 走
    // Anthropic 原生 tools schema，而不是被搬到 OpenAI chat schema。
    const provider = new OpenAiCompatibleProvider({
      id: "claude-relay",
      type: "openai-compatible",
      baseUrl: "https://relay.example.com/v1",
      apiKey: "test-key",
      model: "claude-3-5-sonnet-latest",
      endpointProfile: "anthropic_messages",
    });
    const body = provider.createAnthropicMessagesRequest({
      messages: [{ role: "user", content: "hi" }],
      tools: [
        { name: "Read", description: "Read file", inputSchema: { type: "object" } },
        { name: "Bash", description: "Run bash", inputSchema: { type: "object" } },
      ],
    });
    expect(body.tools).toBeDefined();
    // tools 必须按 name 字典序稳定排序（用于稳定 prompt cache 前缀 hash）。
    expect(body.tools?.map((tool) => tool.name)).toEqual(["Bash", "Read"]);
    // tools 走 Anthropic 原生 schema：{name, description, input_schema}，
    // 而不是 OpenAI 的 {type:"function", function:{...}} 包装。
    expect(body.tools?.[0]).toMatchObject({
      name: "Bash",
      description: "Run bash",
      input_schema: { type: "object" },
    });
    expect(body.tool_choice).toEqual({ type: "auto" });
  });

  it("D.13G: still throws MODEL_TOOLS_UNSUPPORTED when provider explicitly disables tools", () => {
    // 用户显式 supportsTools=false 时仍要走 MODEL_TOOLS_UNSUPPORTED，避免静默忽略。
    const provider = new OpenAiCompatibleProvider({
      id: "claude-relay",
      type: "openai-compatible",
      baseUrl: "https://relay.example.com/v1",
      apiKey: "test-key",
      model: "claude-3-5-sonnet-latest",
      endpointProfile: "anthropic_messages",
      supportsTools: false,
    });
    expect(() =>
      provider.createAnthropicMessagesRequest({
        messages: [{ role: "user", content: "hi" }],
        tools: [{ name: "Read", description: "Read", inputSchema: { type: "object" } }],
      }),
    ).toThrowError(LinghunError);
  });

  it("builds an anthropic_messages body with system extraction and conversation order", () => {
    const provider = new OpenAiCompatibleProvider({
      id: "claude-relay",
      type: "openai-compatible",
      baseUrl: "https://relay.example.com/v1",
      apiKey: "test-key",
      model: "claude-3-5-sonnet-latest",
      endpointProfile: "anthropic_messages",
      maxOutputTokens: 1024,
    });
    const body = provider.createAnthropicMessagesRequest({
      messages: [
        { role: "system", content: "You are Linghun." },
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
        { role: "user", content: "again" },
      ],
    });
    expect(body).toEqual({
      model: "claude-3-5-sonnet-latest",
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
        { role: "user", content: "again" },
      ],
      max_tokens: 1024,
      stream: true,
      system: "You are Linghun.",
    });
  });

  it("sends x-api-key + anthropic-version headers and POSTs to /v1/messages", async () => {
    const encoder = new TextEncoder();
    const fetchMock = vi.fn(async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1"}}\n\n',
            ),
          );
          controller.enqueue(
            encoder.encode(
              'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}\n\n',
            ),
          );
          controller.enqueue(
            encoder.encode('event: message_stop\ndata: {"type":"message_stop"}\n\n'),
          );
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiCompatibleProvider({
      id: "claude-relay",
      type: "openai-compatible",
      baseUrl: "https://relay.example.com/v1",
      apiKey: "test-key",
      model: "claude-3-5-sonnet-latest",
      endpointProfile: "anthropic_messages",
    });
    const events: LinghunEvent[] = [];
    for await (const event of provider.stream(
      { messages: [{ role: "user", content: "hi" }] },
      new AbortController().signal,
    )) {
      events.push(event);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit] | undefined;
    if (!call) throw new Error("fetch was not called");
    const [url, init] = call;
    expect(url).toBe("https://relay.example.com/v1/messages");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("test-key");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers.authorization).toBe("Bearer test-key");
    expect(headers["User-Agent"]).toBe(EXPECTED_REQUEST_USER_AGENT);
    expect(events.some((event) => event.type === "assistant_text_delta")).toBe(true);
  });

  it("D.13G(real path): Claude config endpointProfile=chat_completions placeholder + request endpointProfile=chat_completions + tools → still POSTs /v1/messages with anthropic tools schema", async () => {
    // 复现 TUI selectedRuntime placeholder 路径：provider.env 写了 chat_completions 占位、
    // SelectedModelRuntime narrow 为 chat_completions | responses 也会把 chat_completions
    // 透传给 gateway.stream。决策器必须把 Claude + chat_completions 视为占位、自动切
    // anthropic_messages，最终 fetch URL 是 /v1/messages，body 是 Anthropic tools schema，
    // 不能被带偏到 OpenAI chat schema。
    const encoder = new TextEncoder();
    const fetchMock = vi.fn(async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_p"}}\n\n',
            ),
          );
          controller.enqueue(
            encoder.encode('event: message_stop\ndata: {"type":"message_stop"}\n\n'),
          );
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiCompatibleProvider({
      id: "claude-relay",
      type: "openai-compatible",
      // Anthropic root baseUrl，没有 /v1 后缀也常见；用 /v1 后缀是 relay 常见配置。
      baseUrl: "https://relay.example.com/v1",
      apiKey: "test-key",
      model: "claude-3-5-sonnet-latest",
      // provider.env 旧 setup 默认值：仍是 chat_completions 占位。
      endpointProfile: "chat_completions",
    });
    const events: LinghunEvent[] = [];
    for await (const event of provider.stream(
      {
        messages: [{ role: "user", content: "hi" }],
        // TUI SelectedModelRuntime 真实路径会把 placeholder 透传给 gateway.stream。
        endpointProfile: "chat_completions",
        tools: [{ name: "Read", description: "Read file", inputSchema: { type: "object" } }],
        toolChoice: "auto",
      },
      new AbortController().signal,
    )) {
      events.push(event);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit] | undefined;
    if (!call) throw new Error("fetch was not called");
    const [url, init] = call;
    // 真实路径必须切到 /v1/messages，不能停留在 /chat/completions。
    expect(url).toBe("https://relay.example.com/v1/messages");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("test-key");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    // body 必须是 Anthropic tools schema：{name, description, input_schema}，
    // 而不是 OpenAI chat 的 {type:"function", function:{...}} 包装。
    const body = JSON.parse(init.body as string) as {
      tools?: Array<{ name?: string; input_schema?: unknown; function?: unknown }>;
      tool_choice?: unknown;
    };
    expect(body.tools?.[0]).toMatchObject({
      name: "Read",
      input_schema: { type: "object" },
    });
    expect(body.tools?.[0].function).toBeUndefined();
    expect(body.tool_choice).toEqual({ type: "auto" });
  });

  it("D.13G(real path): createAnthropicMessagesRequest does NOT throw PROFILE_MISMATCH when Claude placeholder + request.endpointProfile=chat_completions", () => {
    // builder guard 必须先 resolve effective profile，placeholder 不应抛 PROFILE_MISMATCH。
    const provider = new OpenAiCompatibleProvider({
      id: "claude-relay",
      type: "openai-compatible",
      baseUrl: "https://relay.example.com/v1",
      apiKey: "test-key",
      model: "claude-3-5-sonnet-latest",
      endpointProfile: "chat_completions",
    });
    expect(() =>
      provider.createAnthropicMessagesRequest({
        messages: [{ role: "user", content: "hi" }],
        endpointProfile: "chat_completions",
        tools: [{ name: "Read", description: "Read file", inputSchema: { type: "object" } }],
      }),
    ).not.toThrow();
    const body = provider.createAnthropicMessagesRequest({
      messages: [{ role: "user", content: "hi" }],
      endpointProfile: "chat_completions",
      tools: [{ name: "Read", description: "Read file", inputSchema: { type: "object" } }],
    });
    expect(body.tools?.[0]).toMatchObject({ name: "Read", input_schema: { type: "object" } });
    expect(JSON.stringify(body.tools)).not.toContain('"function"');
  });

  it("D.13G(real path): non-Claude model + request endpointProfile=chat_completions stays on OpenAI chat /chat/completions schema", async () => {
    // 反向回归：占位策略只对 Claude 生效；非 Claude 模型 + chat_completions 仍走 OpenAI chat。
    const encoder = new TextEncoder();
    const fetchMock = vi.fn(async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'data: {"id":"x","choices":[{"delta":{"content":"ok"}}]}\n\n',
            ),
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiCompatibleProvider({
      id: "openai-compatible",
      type: "openai-compatible",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-4o-mini",
      endpointProfile: "chat_completions",
    });
    for await (const _event of provider.stream(
      {
        messages: [{ role: "user", content: "hi" }],
        endpointProfile: "chat_completions",
        tools: [{ name: "Read", description: "Read", inputSchema: { type: "object" } }],
        toolChoice: "auto",
      },
      new AbortController().signal,
    )) {
      // drain stream
    }
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit] | undefined;
    if (!call) throw new Error("fetch was not called");
    const [url, init] = call;
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    const body = JSON.parse(init.body as string) as {
      tools?: Array<{ type?: string; function?: { name?: string } }>;
    };
    // OpenAI chat 仍是 {type:"function", function:{name,...}} 包装。
    expect(body.tools?.[0]).toMatchObject({
      type: "function",
      function: { name: "Read" },
    });
  });
});

describe("D.13F Anthropic prompt cache cache_control injection", () => {
  function buildAnthropicProvider() {
    return new OpenAiCompatibleProvider({
      id: "claude-relay",
      type: "openai-compatible",
      baseUrl: "https://relay.example.com/v1",
      apiKey: "test-key",
      model: "claude-3-5-sonnet-latest",
      endpointProfile: "anthropic_messages",
      maxOutputTokens: 1024,
    });
  }

  it("emits string system when promptCacheEnabled is false (no cache_control)", () => {
    const provider = buildAnthropicProvider();
    const body = provider.createAnthropicMessagesRequest({
      messages: [
        { role: "system", content: "You are Linghun." },
        { role: "user", content: "hi" },
      ],
      promptCacheEnabled: false,
    });
    expect(typeof body.system).toBe("string");
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("cache_control");
    expect(serialized).not.toContain("ephemeral");
    expect(serialized).not.toContain("linghun-break-cache");
  });

  it("attaches ephemeral cache_control without ttl literal on default 5m", () => {
    const provider = buildAnthropicProvider();
    const body = provider.createAnthropicMessagesRequest({
      messages: [
        { role: "system", content: "alpha" },
        { role: "system", content: "beta" },
        { role: "user", content: "hi" },
      ],
      promptCacheEnabled: true,
    });
    expect(Array.isArray(body.system)).toBe(true);
    const blocks = body.system as Array<{
      type: "text";
      text: string;
      cache_control?: { type: "ephemeral"; ttl?: string };
    }>;
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.cache_control).toBeUndefined();
    expect(blocks[1]?.cache_control).toEqual({ type: "ephemeral" });
    // 5m 默认禁止 ttl 字面量
    expect(JSON.stringify(blocks[1])).not.toContain('"ttl"');
    expect(JSON.stringify(blocks[1])).not.toContain('"5m"');
  });

  it("sets ttl: \"1h\" only when promptCacheTtl is explicitly 1h", () => {
    const provider = buildAnthropicProvider();
    const body = provider.createAnthropicMessagesRequest({
      messages: [
        { role: "system", content: "alpha" },
        { role: "user", content: "hi" },
      ],
      promptCacheEnabled: true,
      promptCacheTtl: "1h",
    });
    const blocks = body.system as Array<{
      type: "text";
      text: string;
      cache_control?: { type: "ephemeral"; ttl?: string };
    }>;
    expect(blocks[0]?.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
  });

  it("appends linghun-break-cache nonce to last system block when cacheBreakNonce provided", () => {
    const provider = buildAnthropicProvider();
    const body = provider.createAnthropicMessagesRequest({
      messages: [
        { role: "system", content: "alpha" },
        { role: "system", content: "beta" },
        { role: "user", content: "hi" },
      ],
      promptCacheEnabled: true,
      cacheBreakNonce: "nonce-xyz-123",
    });
    const blocks = body.system as Array<{ type: "text"; text: string }>;
    expect(blocks[0]?.text).toBe("alpha");
    expect(blocks[1]?.text).toContain("beta");
    expect(blocks[1]?.text).toContain("<!-- linghun-break-cache:nonce-xyz-123 -->");
  });

  it("does not append nonce when promptCacheEnabled is false", () => {
    const provider = buildAnthropicProvider();
    const body = provider.createAnthropicMessagesRequest({
      messages: [
        { role: "system", content: "alpha" },
        { role: "user", content: "hi" },
      ],
      promptCacheEnabled: false,
      cacheBreakNonce: "nonce-xyz-123",
    });
    expect(typeof body.system).toBe("string");
    expect(body.system as string).not.toContain("linghun-break-cache");
  });
});

describe("D.13F Anthropic ephemeral cache_creation usage parsing", () => {
  it("emits cacheCreationEphemeral5m/1hTokens from message_delta cache_creation", async () => {
    const events = await collectAnthropicEvents([
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_2","usage":{"input_tokens":10}}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"x"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":4,"cache_creation":{"ephemeral_5m_input_tokens":120,"ephemeral_1h_input_tokens":7}}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ]);
    const usage = events.find(
      (event): event is Extract<LinghunEvent, { type: "usage" }> => event.type === "usage",
    );
    expect(usage?.usage.cacheCreationEphemeral5mTokens).toBe(120);
    expect(usage?.usage.cacheCreationEphemeral1hTokens).toBe(7);
  });

  it("leaves ephemeral fields undefined when cache_creation missing", async () => {
    const events = await collectAnthropicEvents([
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_3","usage":{"input_tokens":5}}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ]);
    const usage = events.find(
      (event): event is Extract<LinghunEvent, { type: "usage" }> => event.type === "usage",
    );
    expect(usage?.usage.cacheCreationEphemeral5mTokens).toBeUndefined();
    expect(usage?.usage.cacheCreationEphemeral1hTokens).toBeUndefined();
  });
});

describe("D.13F OpenAI tools stable ordering for prompt cache prefix", () => {
  it("sorts chat tools alphabetically regardless of input order", () => {
    const provider = new OpenAiCompatibleProvider({
      id: "openai-compatible",
      type: "openai-compatible",
      baseUrl: "https://example.com/v1/",
      apiKey: "test-key",
      model: "gpt-x",
    });
    const request = provider.createChatRequest({
      messages: [{ role: "user", content: "hi" }],
      tools: [
        { name: "Zeta", description: "z", inputSchema: { type: "object" } },
        { name: "Alpha", description: "a", inputSchema: { type: "object" } },
        { name: "Mike", description: "m", inputSchema: { type: "object" } },
      ],
    });
    const names = request.tools?.map((tool) => tool.function.name);
    expect(names).toEqual(["Alpha", "Mike", "Zeta"]);
  });

  it("sorts responses tools alphabetically regardless of input order", () => {
    const provider = new OpenAiCompatibleProvider({
      id: "openai-compatible",
      type: "openai-compatible",
      baseUrl: "https://example.com/v1/",
      apiKey: "test-key",
      model: "gpt-x",
      endpointProfile: "responses",
    });
    const request = provider.createResponsesRequest({
      messages: [{ role: "user", content: "hi" }],
      tools: [
        { name: "Zeta", description: "z", inputSchema: { type: "object" } },
        { name: "Alpha", description: "a", inputSchema: { type: "object" } },
        { name: "Mike", description: "m", inputSchema: { type: "object" } },
      ],
    });
    const names = request.tools?.map((tool) => tool.name);
    expect(names).toEqual(["Alpha", "Mike", "Zeta"]);
  });

  it("does not include OpenAI-side prompt_cache_key or prompt_cache_retention", () => {
    const provider = new OpenAiCompatibleProvider({
      id: "openai-compatible",
      type: "openai-compatible",
      baseUrl: "https://example.com/v1/",
      apiKey: "test-key",
      model: "gpt-x",
    });
    const chat = provider.createChatRequest({
      messages: [{ role: "user", content: "hi" }],
      promptCacheEnabled: true,
      promptCacheTtl: "1h",
      cacheBreakNonce: "nonce-abc",
    });
    const responses = new OpenAiCompatibleProvider({
      id: "openai-compatible",
      type: "openai-compatible",
      baseUrl: "https://example.com/v1/",
      apiKey: "test-key",
      model: "gpt-x",
      endpointProfile: "responses",
    }).createResponsesRequest({
      messages: [{ role: "user", content: "hi" }],
      promptCacheEnabled: true,
      promptCacheTtl: "1h",
      cacheBreakNonce: "nonce-abc",
    });
    for (const body of [chat, responses] as unknown[]) {
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain("prompt_cache_key");
      expect(serialized).not.toContain("prompt_cache_retention");
      expect(serialized).not.toContain("cache_control");
      expect(serialized).not.toContain("linghun-break-cache");
    }
  });
});

describe("D.13F end-to-end Anthropic POST body with cache_control", () => {
  it("sends cache_control on last system block over the wire", async () => {
    const encoder = new TextEncoder();
    const fetchMock = vi.fn(async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_5"}}\n\n',
            ),
          );
          controller.enqueue(
            encoder.encode('event: message_stop\ndata: {"type":"message_stop"}\n\n'),
          );
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiCompatibleProvider({
      id: "claude-relay",
      type: "openai-compatible",
      baseUrl: "https://relay.example.com/v1",
      apiKey: "test-key",
      model: "claude-3-5-sonnet-latest",
      endpointProfile: "anthropic_messages",
    });
    const request: ModelRequest = {
      messages: [
        { role: "system", content: "You are Linghun." },
        { role: "user", content: "hi" },
      ],
      promptCacheEnabled: true,
      promptCacheTtl: "1h",
      cacheBreakNonce: "wire-nonce-9",
    };
    for await (const _ of provider.stream(request, new AbortController().signal)) {
      // drain
    }
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit] | undefined;
    if (!call) throw new Error("fetch was not called");
    const [, init] = call;
    const sent = JSON.parse(String(init.body)) as {
      system: Array<{ text: string; cache_control?: { type: string; ttl?: string } }>;
    };
    expect(Array.isArray(sent.system)).toBe(true);
    expect(sent.system.at(-1)?.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(sent.system.at(-1)?.text).toContain("<!-- linghun-break-cache:wire-nonce-9 -->");
  });
});

// ---------------------------------------------------------------------------
// D.13G — Anthropic Messages tools (Claude agent parity)
// ---------------------------------------------------------------------------
describe("D.13G Anthropic tools contract + builder + stream parser", () => {
  function buildAnthropicProvider(
    overrides: Partial<Parameters<typeof resolveProviderRuntimeContract>[0]> = {},
  ) {
    return new OpenAiCompatibleProvider({
      id: "claude-relay",
      type: "openai-compatible",
      baseUrl: "https://relay.example.com/v1",
      apiKey: "test-key",
      model: "claude-3-5-sonnet-latest",
      endpointProfile: "anthropic_messages",
      ...overrides,
    });
  }

  it("contract: anthropic_messages defaults to supportsTools=true and anthropic schema shapes", () => {
    const contract = resolveProviderRuntimeContract({
      id: "claude-relay",
      type: "openai-compatible",
      baseUrl: "https://relay.example.com/v1",
      apiKey: "test-key",
      model: "claude-3-5-sonnet-latest",
      endpointProfile: "anthropic_messages",
    });
    expect(contract.endpointProfile).toBe("anthropic_messages");
    expect(contract.supportsTools).toBe(true);
    expect(contract.toolSchemaShape).toBe("anthropic_tools");
    expect(contract.toolResultShape).toBe("anthropic_tool_result");
  });

  it("regression(验收 #1): Claude config with chat_completions placeholder + continuation hint still resolves to anthropic_messages with anthropic tools schema", () => {
    // Claude provider 配置 endpointProfile=chat_completions（provider.env 旧 setup 占位），
    // request.endpointProfile=chat_completions 看似 continuation 沿用 chat 形态，
    // 但决策器必须把 chat_completions 视为占位并切回 anthropic_messages，
    // 同时 builder 必须走 Anthropic schema（input_schema），不被带偏到 OpenAI chat schema。
    const baseUrlAuto = resolveEffectiveEndpointProfile({
      requestEndpointProfile: undefined,
      configEndpointProfile: "chat_completions",
      configBaseUrl: "https://api.anthropic.com",
      configModel: "claude-3-5-sonnet-latest",
    });
    expect(baseUrlAuto.endpointProfile).toBe("anthropic_messages");
    expect(baseUrlAuto.source).toBe("auto-claude-model");

    const provider = new OpenAiCompatibleProvider({
      id: "claude-relay",
      type: "openai-compatible",
      baseUrl: "https://api.anthropic.com",
      apiKey: "test-key",
      model: "claude-3-5-sonnet-latest",
      endpointProfile: "chat_completions",
    });
    const body = provider.createAnthropicMessagesRequest({
      messages: [{ role: "user", content: "hi" }],
      // 注意：request.endpointProfile 不显式传入；让 provider 自己走 builder。
      tools: [{ name: "Read", description: "Read file", inputSchema: { type: "object" } }],
    });
    expect(body.tools?.[0]).toMatchObject({ name: "Read", input_schema: { type: "object" } });
    // OpenAI chat shape 的 function 包装绝对不应出现在 anthropic body 上。
    expect(JSON.stringify(body.tools)).not.toContain('"function"');
    expect(body.tool_choice).toEqual({ type: "auto" });
  });

  it("builder: tool_choice='none' is honored when explicit", () => {
    const provider = buildAnthropicProvider();
    const body = provider.createAnthropicMessagesRequest({
      messages: [{ role: "user", content: "hi" }],
      tools: [{ name: "Read", description: "Read", inputSchema: { type: "object" } }],
      toolChoice: "none",
    });
    expect(body.tool_choice).toEqual({ type: "none" });
  });

  it("builder: assistant.toolCalls converts to user|assistant tool_use blocks; tool role converts to user tool_result block", () => {
    const provider = buildAnthropicProvider();
    const body = provider.createAnthropicMessagesRequest({
      messages: [
        { role: "user", content: "list README" },
        {
          role: "assistant",
          content: "let me read it",
          toolCalls: [
            { id: "call-1", name: "Read", input: { path: "README.md" } },
          ],
        },
        { role: "tool", tool_call_id: "call-1", content: '{"ok":true}' },
        { role: "assistant", content: "done" },
      ],
      tools: [{ name: "Read", description: "Read file", inputSchema: { type: "object" } }],
    });
    // assistant 转换：text + tool_use 混合 block
    const assistantTurn = body.messages[1];
    expect(assistantTurn.role).toBe("assistant");
    expect(Array.isArray(assistantTurn.content)).toBe(true);
    const assistantBlocks = assistantTurn.content as Array<{ type: string; id?: string; name?: string; input?: unknown }>;
    expect(assistantBlocks).toEqual([
      { type: "text", text: "let me read it" },
      { type: "tool_use", id: "call-1", name: "Read", input: { path: "README.md" } },
    ]);
    // tool 消息：必须折叠到下一个 user 消息的 tool_result block
    const toolResultTurn = body.messages[2];
    expect(toolResultTurn.role).toBe("user");
    const userBlocks = toolResultTurn.content as Array<{ type: string; tool_use_id?: string; content?: string }>;
    expect(userBlocks).toEqual([
      { type: "tool_result", tool_use_id: "call-1", content: '{"ok":true}' },
    ]);
  });

  it("builder: orphan assistant tool_use (no following tool_result) → synthesized is_error tool_result appended", () => {
    const provider = buildAnthropicProvider();
    const body = provider.createAnthropicMessagesRequest({
      messages: [
        { role: "user", content: "go" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call-orphan", name: "Read", input: {} }],
        },
      ],
      tools: [{ name: "Read", description: "Read", inputSchema: { type: "object" } }],
    });
    // 末尾合成 user 消息 + tool_result is_error=true
    const last = body.messages.at(-1);
    expect(last?.role).toBe("user");
    const blocks = last?.content as Array<{ type: string; tool_use_id?: string; is_error?: boolean; content?: string }>;
    expect(blocks).toEqual([
      expect.objectContaining({
        type: "tool_result",
        tool_use_id: "call-orphan",
        is_error: true,
      }),
    ]);
    expect(blocks[0].content).toContain("synthesized by Linghun");
  });

  it("builder: orphan tool_result (no matching tool_use) is dropped to avoid Anthropic 400", () => {
    const provider = buildAnthropicProvider();
    const body = provider.createAnthropicMessagesRequest({
      messages: [
        { role: "user", content: "go" },
        { role: "tool", tool_call_id: "call-ghost", content: '{"x":1}' },
        { role: "assistant", content: "ok" },
      ],
      tools: [{ name: "Read", description: "Read", inputSchema: { type: "object" } }],
    });
    // tool 消息直接被丢弃；只剩 user + assistant
    expect(body.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("builder: cache_control on system + tools array coexist in same request", () => {
    const provider = buildAnthropicProvider();
    const body = provider.createAnthropicMessagesRequest({
      messages: [
        { role: "system", content: "You are Linghun." },
        { role: "user", content: "hi" },
      ],
      tools: [{ name: "Read", description: "Read", inputSchema: { type: "object" } }],
      promptCacheEnabled: true,
    });
    expect(Array.isArray(body.system)).toBe(true);
    const systemBlocks = body.system as Array<{ type: string; cache_control?: unknown }>;
    expect(systemBlocks.at(-1)?.cache_control).toEqual({ type: "ephemeral" });
    expect(body.tools?.[0]).toMatchObject({ name: "Read", input_schema: { type: "object" } });
    expect(body.tool_choice).toEqual({ type: "auto" });
  });

  it("stream parser: content_block_start(tool_use) + multiple input_json_delta + content_block_stop emits one tool_use event", async () => {
    const events = await collectAnthropicEvents([
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_t"}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"call-7","name":"Read"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\\"README.md\\"}"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":3}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ]);
    const toolUse = events.find(
      (event): event is Extract<LinghunEvent, { type: "tool_use" }> => event.type === "tool_use",
    );
    expect(toolUse).toEqual({
      type: "tool_use",
      id: "call-7",
      name: "Read",
      input: { path: "README.md" },
    });
  });

  it("stream parser: mixed text_delta + tool_use stream emits both event types in order", async () => {
    const events = await collectAnthropicEvents([
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_m"}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"思考中"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"call-mix","name":"Bash"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{}"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ]);
    const types = events.map((event) => event.type);
    const textIdx = types.indexOf("assistant_text_delta");
    const toolIdx = types.indexOf("tool_use");
    expect(textIdx).toBeGreaterThanOrEqual(0);
    expect(toolIdx).toBeGreaterThan(textIdx);
  });

  it("stream parser: malformed input_json_delta JSON (unparseable at stop) → PROVIDER_MALFORMED_STREAM", async () => {
    const events = await collectAnthropicEvents([
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_e"}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"call-bad","name":"Read"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{not-json"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ]);
    const error = events.find(
      (event): event is Extract<LinghunEvent, { type: "error" }> => event.type === "error",
    );
    expect(error?.error.code).toBe("PROVIDER_MALFORMED_STREAM");
  });

  it("stream parser: input_json_delta on non-tool_use index → PROVIDER_MALFORMED_STREAM", async () => {
    const events = await collectAnthropicEvents([
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_x"}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{}"}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ]);
    const error = events.find(
      (event): event is Extract<LinghunEvent, { type: "error" }> => event.type === "error",
    );
    expect(error?.error.code).toBe("PROVIDER_MALFORMED_STREAM");
  });
});

// ---------------------------------------------------------------------------
// D.13H — Anthropic Context Editing / cache_edits 事实对齐收口（hard-disabled）
// 默认禁用；即使 contextEditingEnabled=true，但没有非空 anthropicBetaHeaders 时仍不发；
// 永远不发空的 anthropic-beta header；body 永不写入 cache_edits / cache_reference；
// OpenAI chat / responses 路径硬隔离；D.13F prompt cache 与 D.13G tools 行为保留。
// ---------------------------------------------------------------------------

describe("D.13H Anthropic context editing hard-disabled closure", () => {
  function makeAnthropicMessageStreamResponse(): Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_h"}}\n\n',
          ),
        );
        controller.enqueue(
          encoder.encode('event: message_stop\ndata: {"type":"message_stop"}\n\n'),
        );
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }

  function makeOpenAiChatStreamResponse(): Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'),
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }

  it("D.13H anthropic context editing default disabled does not send cache_edits cache_reference or anthropic-beta", async () => {
    const fetchMock = vi.fn(async () => makeAnthropicMessageStreamResponse());
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiCompatibleProvider({
      id: "claude-relay",
      type: "openai-compatible",
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-test-secret",
      model: "claude-3-5-sonnet-latest",
      endpointProfile: "anthropic_messages",
      // 默认：contextEditingEnabled / anthropicBetaHeaders 都未配置。
    });
    const events: LinghunEvent[] = [];
    for await (const event of provider.stream(
      { messages: [{ role: "user", content: "hi" }] },
      new AbortController().signal,
    )) {
      events.push(event);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit] | undefined;
    if (!call) throw new Error("fetch was not called");
    const [url, init] = call;
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const headers = init.headers as Record<string, string>;
    // 严禁出现 anthropic-beta header（任何写入都会让上游半接 cache_edits 报 400）。
    expect(headers["anthropic-beta"]).toBeUndefined();
    expect(Object.keys(headers).map((key) => key.toLowerCase())).not.toContain("anthropic-beta");
    // body JSON 不能包含 cache_edits / cache_reference 任何字符串。
    const bodyText = init.body as string;
    expect(bodyText).not.toContain("cache_edits");
    expect(bodyText).not.toContain("cache_reference");

    // 同时验证诊断 helper 默认行为。
    const contract = resolveProviderRuntimeContract(
      {
        id: "claude-relay",
        type: "openai-compatible",
        baseUrl: "https://api.anthropic.com",
        apiKey: "sk-test-secret",
        model: "claude-3-5-sonnet-latest",
        endpointProfile: "anthropic_messages",
      },
      { messages: [] },
    );
    const diagnostic = resolveAnthropicContextEditingDiagnostic({}, contract);
    expect(diagnostic).toEqual({
      enabled: false,
      sendable: false,
      betaHeaderCount: 0,
      disabledReason: "disabled by config",
    });
  });

  it("D.13H anthropic context editing enabled but empty beta header still does not send cache_edits or anthropic-beta", async () => {
    const fetchMock = vi.fn(async () => makeAnthropicMessageStreamResponse());
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiCompatibleProvider({
      id: "claude-relay",
      type: "openai-compatible",
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-test-secret",
      model: "claude-3-5-sonnet-latest",
      endpointProfile: "anthropic_messages",
      // 即使打开开关，但 beta header 全空，仍按 hard-disabled 处理。
      contextEditingEnabled: true,
      anthropicBetaHeaders: ["", ""],
    });
    const events: LinghunEvent[] = [];
    for await (const event of provider.stream(
      { messages: [{ role: "user", content: "hi" }] },
      new AbortController().signal,
    )) {
      events.push(event);
    }
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit] | undefined;
    if (!call) throw new Error("fetch was not called");
    const [url, init] = call;
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const headers = init.headers as Record<string, string>;
    expect(headers["anthropic-beta"]).toBeUndefined();
    const bodyText = init.body as string;
    expect(bodyText).not.toContain("cache_edits");
    expect(bodyText).not.toContain("cache_reference");

    const contract = resolveProviderRuntimeContract(
      {
        id: "claude-relay",
        type: "openai-compatible",
        baseUrl: "https://api.anthropic.com",
        apiKey: "sk-test-secret",
        model: "claude-3-5-sonnet-latest",
        endpointProfile: "anthropic_messages",
      },
      { messages: [] },
    );
    const diagnostic = resolveAnthropicContextEditingDiagnostic(
      {
        contextEditingEnabled: true,
        anthropicBetaHeaders: [""], // 仅含空字符串
      },
      contract,
    );
    expect(diagnostic).toEqual({
      enabled: true,
      sendable: false,
      betaHeaderCount: 0,
      disabledReason: "missing non-empty beta header",
    });

    // 即使传 [] 也走相同 disabled 分支。
    expect(
      resolveAnthropicContextEditingDiagnostic(
        { contextEditingEnabled: true, anthropicBetaHeaders: [] },
        contract,
      ),
    ).toEqual({
      enabled: true,
      sendable: false,
      betaHeaderCount: 0,
      disabledReason: "missing non-empty beta header",
    });
  });

  it("D.13H openai chat completions does not include cache_edits cache_reference or anthropic-beta even when context editing is enabled", async () => {
    const fetchMock = vi.fn(async () => makeOpenAiChatStreamResponse());
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiCompatibleProvider({
      id: "openai-compatible",
      type: "openai-compatible",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test-secret",
      model: "gpt-4o-mini",
      endpointProfile: "chat_completions",
      // 即使强行打开 context editing 开关并配置 beta header：
      // OpenAI chat / responses 路径必须硬隔离，永远不输出这些字段。
      contextEditingEnabled: true,
      anthropicBetaHeaders: ["context-editing-2025-01-01"],
    });
    const events: LinghunEvent[] = [];
    for await (const event of provider.stream(
      { messages: [{ role: "user", content: "hi" }] },
      new AbortController().signal,
    )) {
      events.push(event);
    }
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit] | undefined;
    if (!call) throw new Error("fetch was not called");
    const [url, init] = call;
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    const headers = init.headers as Record<string, string>;
    expect(headers["anthropic-beta"]).toBeUndefined();
    expect(Object.keys(headers).map((key) => key.toLowerCase())).not.toContain("anthropic-beta");
    const bodyText = init.body as string;
    expect(bodyText).not.toContain("cache_edits");
    expect(bodyText).not.toContain("cache_reference");

    // 诊断 helper 在非 anthropic_messages profile 下也强制返回 sendable=false。
    const contract = resolveProviderRuntimeContract(
      {
        id: "openai-compatible",
        type: "openai-compatible",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-test-secret",
        model: "gpt-4o-mini",
        endpointProfile: "chat_completions",
      },
      { messages: [] },
    );
    const diagnostic = resolveAnthropicContextEditingDiagnostic(
      {
        contextEditingEnabled: true,
        anthropicBetaHeaders: ["context-editing-2025-01-01"],
      },
      contract,
    );
    expect(diagnostic.sendable).toBe(false);
    expect(diagnostic.disabledReason).toBe(
      "unsupported endpoint profile (chat_completions / responses 不支持 cache_edits)",
    );
  });

  it("D.13H anthropic tools and prompt cache coexist with context editing disabled remains v1 messages with input_schema and cache_control", async () => {
    const fetchMock = vi.fn(async () => makeAnthropicMessageStreamResponse());
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiCompatibleProvider({
      id: "claude-relay",
      type: "openai-compatible",
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-test-secret",
      model: "claude-3-5-sonnet-latest",
      endpointProfile: "anthropic_messages",
      // 默认 context editing 关闭；D.13G tools + D.13F prompt cache 不应受影响。
    });
    const events: LinghunEvent[] = [];
    for await (const event of provider.stream(
      {
        messages: [
          { role: "system", content: "you are helpful" },
          { role: "user", content: "hi" },
        ],
        tools: [{ name: "Read", description: "Read file", inputSchema: { type: "object" } }],
        toolChoice: "auto",
        promptCacheEnabled: true,
      },
      new AbortController().signal,
    )) {
      events.push(event);
    }
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit] | undefined;
    if (!call) throw new Error("fetch was not called");
    const [url, init] = call;
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const headers = init.headers as Record<string, string>;
    expect(headers["anthropic-beta"]).toBeUndefined();
    const body = JSON.parse(init.body as string) as {
      tools?: Array<{ name?: string; input_schema?: unknown }>;
      system?: unknown;
    };
    // D.13G：tools 仍按 Anthropic 原生 schema（name + input_schema）。
    expect(body.tools?.[0]).toMatchObject({
      name: "Read",
      input_schema: { type: "object" },
    });
    // D.13F：system 末块仍挂 cache_control: { type: "ephemeral" }。
    expect(Array.isArray(body.system)).toBe(true);
    const systemBlocks = body.system as Array<{
      type: string;
      text: string;
      cache_control?: { type: string; ttl?: string };
    }>;
    const lastBlock = systemBlocks[systemBlocks.length - 1];
    expect(lastBlock?.cache_control).toEqual({ type: "ephemeral" });
    // body 不能包含 cache_edits / cache_reference。
    const bodyText = init.body as string;
    expect(bodyText).not.toContain("cache_edits");
    expect(bodyText).not.toContain("cache_reference");
  });
});
