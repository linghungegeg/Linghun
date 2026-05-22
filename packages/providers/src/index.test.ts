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
  normalizeProviderError,
  parseOpenAiStream,
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
